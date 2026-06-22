'use strict';

const fs = require('fs');
const path = require('path');
const { parseSTEP, buildLookup, evalA2P3D } = require('./step-parse');
const { extractFacesFromSLDPRT } = require('./sldprt-faces');

const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const add = (a, b) => [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
const scl = (v, s) => [v[0]*s, v[1]*s, v[2]*s];
const dot = (a, b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const crs = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const vlen = v => Math.sqrt(v[0]**2+v[1]**2+v[2]**2);
const vnorm = v => { const l = vlen(v); return l > 1e-12 ? [v[0]/l, v[1]/l, v[2]/l] : [0, 0, 0]; };
const dist3 = (a, b) => vlen(sub(a, b));

function distToPlane(p, ap) {
    return Math.abs(dot(sub(p, ap.center), ap.normal));
}

function distToCylinder(p, ap, radius) {
    const v = sub(p, ap.center);
    const radial = sub(v, scl(ap.normal, dot(v, ap.normal)));
    return Math.abs(vlen(radial) - radius);
}

function distToCone(p, ap, baseRadius, halfAngle) {
    const v = sub(p, ap.center);
    const t = dot(v, ap.normal);
    const expectedR = baseRadius + t * Math.tan(halfAngle);
    const radial = sub(v, scl(ap.normal, t));
    return Math.abs(vlen(radial) - expectedR);
}

function distToSurface(p, surf, lookup) {
    if (!surf) return null;

    const ap = evalA2P3D(surf.a2p3d, lookup);
    if (!ap) return null;

    switch (surf.type) {
        case 'PLANE':
            return distToPlane(p, ap);
        case 'CYL':
            return distToCylinder(p, ap, surf.radius);
        case 'CON':
            return distToCone(p, ap, surf.radius, surf.halfAngle);
        default:
            return null;
    }
}

function findMatchingSTEPFace(slFace, stepFaces, lookup, tolerance) {
    const slVerts = slFace.verts;

    let bestFace = null;
    let bestScore = -1;

    for (const sf of stepFaces) {
        const surf = lookup.surfData[sf.surfId];
        if (!surf || !surf.a2p3d) continue;

        let matchCount = 0;
        for (const v of slVerts) {
            const d = distToSurface(v, surf, lookup);
            if (d !== null && d < tolerance) matchCount++;
        }

        const score = matchCount / slVerts.length;
        if (score > bestScore) {
            bestScore = score;
            bestFace = sf;
        }
    }

    return { face: bestFace, score: bestScore };
}

function compare(stepPath, sldprtPath, tolerance) {
    tolerance = tolerance || 0.5;

    console.log(`\nSTEP file: ${path.basename(stepPath)}`);
    console.log(`SLDPRT:    ${path.basename(sldprtPath)}`);
    console.log(`Tolerance: ${tolerance} mm\n`);

    const stepText = fs.readFileSync(stepPath, 'utf8');
    const ents = parseSTEP(stepText);
    const lookup = buildLookup(ents);

    console.log(`STEP entities: ${Object.keys(ents).length}`);
    console.log(`STEP faces: ${lookup.faces.length}`);

    const surfTypes = {};
    for (const af of lookup.faces) {
        const sd = lookup.surfData[af.surfId];
        const t = sd ? sd.type : '?';
        surfTypes[t] = (surfTypes[t] || 0) + 1;
    }
    console.log(`Surface types: ${JSON.stringify(surfTypes)}`);
    console.log();

    const { faces: slFaces, error } = extractFacesFromSLDPRT(sldprtPath);
    if (error) {
        console.error(`SLDPRT extraction failed: ${error}`);
        return;
    }
    console.log(`SLDPRT faces: ${slFaces.length}`);

    let totalArea = 0;
    for (const f of slFaces) totalArea += f.area;
    console.log(`SLDPRT total area: ${totalArea.toFixed(1)} mm²\n`);

    let matched = 0, unmatched = 0, totalVerts = 0, matchedVerts = 0;
    let maxDist = 0, sumDist = 0, distCount = 0;

    console.log('=== Per-face comparison ===\n');
    console.log('SLDPRT# | Verts | Area     | STEP#  | Type | Match% | MaxDist  | Status');
    console.log('--------|-------|----------|--------|------|--------|----------|--------');

    const faceResults = [];

    for (const slF of slFaces) {
        const { face: stepF, score } = findMatchingSTEPFace(slF, lookup.faces, lookup, tolerance);

        if (!stepF || score < 0.3) {
            unmatched++;
            const stepId = stepF ? `#${stepF.id}` : 'none';
            const stepType = stepF ? (lookup.surfData[stepF.surfId]?.type || '?') : '-';
            console.log(`  #${String(slF.index).padStart(3)} | ${String(slF.vertexCount).padStart(5)} | ${slF.area.toFixed(1).padStart(8)} | ${stepId.padStart(6)} | ${stepType.padStart(4)} | ${(score * 100).toFixed(0).padStart(4)}%  | ${'N/A'.padStart(8)} | MISS`);
            faceResults.push({ slIndex: slF.index, stepId: stepF?.id, match: score, status: 'MISS' });
            continue;
        }

        matched++;
        const surf = lookup.surfData[stepF.surfId];
        let faceMaxDist = 0;
        let faceMatchedVerts = 0;

        for (const v of slF.verts) {
            const d = distToSurface(v, surf, lookup);
            if (d !== null) {
                if (d < tolerance) faceMatchedVerts++;
                if (d > faceMaxDist) faceMaxDist = d;
                if (d > maxDist) maxDist = d;
                sumDist += d;
                distCount++;
            }
        }

        totalVerts += slF.verts.length;
        matchedVerts += faceMatchedVerts;

        const status = faceMaxDist < tolerance ? 'OK' : faceMaxDist < tolerance * 3 ? 'WARN' : 'FAIL';
        console.log(`  #${String(slF.index).padStart(3)} | ${String(slF.vertexCount).padStart(5)} | ${slF.area.toFixed(1).padStart(8)} | #${String(stepF.id).padStart(4)} | ${(surf?.type || '?').padStart(4)} | ${(score * 100).toFixed(0).padStart(4)}%  | ${faceMaxDist.toFixed(3).padStart(8)} | ${status}`);
        faceResults.push({ slIndex: slF.index, stepId: stepF.id, surfType: surf?.type, match: score, maxDist: faceMaxDist, status });
    }

    console.log('\n=== Summary ===\n');
    console.log(`Matched faces:   ${matched}/${slFaces.length}`);
    console.log(`Unmatched faces: ${unmatched}/${slFaces.length}`);
    console.log(`Vertex match:    ${matchedVerts}/${totalVerts} (${(matchedVerts / Math.max(1, totalVerts) * 100).toFixed(1)}%)`);
    if (distCount > 0) {
        console.log(`Max distance:    ${maxDist.toFixed(4)} mm`);
        console.log(`Avg distance:    ${(sumDist / distCount).toFixed(4)} mm`);
    }

    const statusCounts = { OK: 0, WARN: 0, FAIL: 0, MISS: 0 };
    for (const r of faceResults) statusCounts[r.status]++;
    console.log(`\nStatus: ${statusCounts.OK} OK, ${statusCounts.WARN} warn, ${statusCounts.FAIL} fail, ${statusCounts.MISS} miss`);

    return faceResults;
}

if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.log('Usage: node compare.js <file.STEP> <file.SLDPRT> [tolerance_mm]');
        process.exit(1);
    }
    const tolerance = args[2] ? parseFloat(args[2]) : 0.5;
    compare(args[0], args[1], tolerance);
}

module.exports = { compare };
