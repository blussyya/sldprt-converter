#!/usr/bin/env node
/**
 * SLDPRT Validate & Convert CLI (v0.3.0)
 * Extracts mesh from SLDPRT, validates against STEP (if provided), exports STL
 *
 * Usage:
 *   node validate.js <file.sldprt>                         → extract + export STL
 *   node validate.js <file.sldprt> <file.STEP>             → extract + validate + export STL
 *   node validate.js <file.sldprt> --tolerance 0.1         → set tolerance (mm)
 *   node validate.js <file.sldprt> --format obj            → export as OBJ
 *   node validate.js <file.sldprt> --format binary-stl     → export as binary STL
 *   node validate.js <file.sldprt> -v                      → verbose output
 */

const fs = require('fs');
const path = require('path');
const { extractMesh, toOBJ, toSTL, toBinarySTL, toSTEP, setVerbose, setFaceSurface } = require('./sldprt-extractor.js');
const { parseSTEP, buildLookup, evalA2P3D, distToSurface, extractFaceBoundaries } = require('./step-parse.js');
const { triArea } = require('./utils.js');

function findMatchingSTEPFace(slVerts, stepFaces, lookup, tolerance) {
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

function uniqueFilename(base, ext, outDir) {
    if (!outDir) outDir = process.cwd();
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    let candidate = path.join(outDir, base + ext);
    if (!fs.existsSync(candidate)) return candidate;
    let i = 2;
    while (fs.existsSync(path.join(outDir, `${base}_v${i}${ext}`))) i++;
    return path.join(outDir, `${base}_v${i}${ext}`);
}

function parseArgs(args) {
    const opts = { files: [], tolerance: 0.5, format: 'binary-stl', verbose: false, output: null };
    let i = 0;
    while (i < args.length) {
        const a = args[i];
        if (a === '-v' || a === '--verbose') opts.verbose = true;
        else if (a === '-o' || a === '--output') opts.output = args[++i];
        else if (a === '--format' || a === '-f') opts.format = args[++i];
        else if (a === '--tolerance') opts.tolerance = parseFloat(args[++i]);
        else if (!a.startsWith('-')) opts.files.push(a);
        else { console.error(`Unknown option: ${a}`); process.exit(1); }
        i++;
    }
    return opts;
}

function run() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.log(`SLDPRT Validate & Convert (v0.3.1)

Usage:
  node validate.js <input.sldprt> [input.STEP] [options]

Options:
  -o, --output <path>     Output file path (default: auto-generated)
  -f, --format <fmt>      Output: binary-stl (default), stl, obj
  --tolerance <mm>        STEP comparison tolerance (default: 0.5)
  -v, --verbose           Show detailed logs

Examples:
  node validate.js part.sldprt                    # extract + export STL
  node validate.js part.sldprt part.STEP          # extract + validate + export
  node validate.js part.sldprt --format obj       # export as OBJ`);
        process.exit(0);
    }

    const opts = parseArgs(args);
    setVerbose(opts.verbose);

    if (opts.files.length === 0) {
        console.error('No input file specified.');
        process.exit(1);
    }

    const sldprtPath = path.resolve(opts.files[0]);
    if (!fs.existsSync(sldprtPath)) {
        console.error(`File not found: ${sldprtPath}`);
        process.exit(1);
    }

    let stepPath = null;
    if (opts.files.length > 1) {
        stepPath = path.resolve(opts.files[1]);
        if (!fs.existsSync(stepPath)) {
            console.error(`STEP file not found: ${stepPath}`);
            process.exit(1);
        }
    }

    // Step 1: Extract SLDPRT
    console.log(`\n=== SLDPRT Extraction ===\n`);
    console.log(`File: ${path.basename(sldprtPath)}`);

    const buf = fs.readFileSync(sldprtPath);
    const mesh = extractMesh(buf);

    if (mesh.errors.length > 0) {
        console.error(`Errors:`, mesh.errors);
        process.exit(1);
    }

    for (const w of mesh.warnings) console.log(`  ${w}`);

    if (mesh.vertices.length === 0) {
        console.error('No vertex data extracted.');
        process.exit(1);
    }

    // Scale from meters to mm
    for (const v of mesh.vertices) {
        v[0] *= 1000;
        v[1] *= 1000;
        v[2] *= 1000;
    }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, y, z] of mesh.vertices) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }

    let totalArea = 0;
    for (const face of mesh.faces) {
        if (face.length < 3) continue;
        for (let i = 1; i < face.length - 1; i++) {
            totalArea += triArea(mesh.vertices[face[0]], mesh.vertices[face[i]], mesh.vertices[face[i + 1]]);
        }
    }

    console.log(`\nVertices: ${mesh.vertices.length}`);
    console.log(`Faces:    ${mesh.faces.length} (${mesh.faces.reduce((s,f)=>s+Math.max(0,f.length-2),0)} tris)`);
    console.log(`Area:     ${totalArea.toFixed(1)} mm²`);
    console.log(`BBox:     (${minX.toFixed(2)}, ${minY.toFixed(2)}, ${minZ.toFixed(2)}) → (${maxX.toFixed(2)}, ${maxY.toFixed(2)}, ${maxZ.toFixed(2)})`);
    console.log(`Size:     ${(maxX-minX).toFixed(2)} × ${(maxY-minY).toFixed(2)} × ${(maxZ-minZ).toFixed(2)} mm`);

    // Step 2: Validate against STEP (if provided)
    if (stepPath) {
        console.log(`\n=== STEP Validation ===\n`);

        const stepText = fs.readFileSync(stepPath, 'utf8');
        const ents = parseSTEP(stepText);
        const lookup = buildLookup(ents);
        const faceBounds = extractFaceBoundaries(lookup);

        console.log(`STEP entities: ${Object.keys(ents).length}`);
        console.log(`STEP faces:    ${lookup.faces.length}`);

        const surfTypes = {};
        for (const af of lookup.faces) {
            const sd = lookup.surfData[af.surfId];
            const t = sd ? sd.type : '?';
            surfTypes[t] = (surfTypes[t] || 0) + 1;
        }
        console.log(`Surface types: ${JSON.stringify(surfTypes)}`);

        // Build SLDPRT faces from vertex data (same approach as sldprt-faces.js)
        const slFaces = [];
        for (let fi = 0; fi < mesh.faces.length; fi++) {
            const face = mesh.faces[fi];
            if (face.length < 3) continue;
            const verts = face.map(idx => mesh.vertices[idx]);
            let area = 0;
            for (let i = 1; i < verts.length - 1; i++) {
                area += triArea(verts[0], verts[i], verts[i + 1]);
            }
            slFaces.push({ index: fi, vertexCount: face.length, verts, area });
        }

        let matchedFaces = 0, unmatchedFaces = 0, totalVerts = 0, matchedVerts = 0;
        let maxDist = 0, sumDist = 0, distCount = 0;

        console.log(`\nSLDPRT faces: ${slFaces.length}`);
        console.log(`\nSLDPRT# | Verts | Area     | STEP#  | Type | Match% | MaxDist  | Status`);
        console.log(`--------|-------|----------|--------|------|--------|----------|--------`);

        const faceResults = [];

        for (const slF of slFaces) {
            const { face: stepF, score } = findMatchingSTEPFace(slF.verts, lookup.faces, lookup, opts.tolerance);

            if (!stepF || score < 0.3) {
                unmatchedFaces++;
                const stepId = stepF ? `#${stepF.id}` : 'none';
                const stepType = stepF ? (lookup.surfData[stepF.surfId]?.type || '?') : '-';
                console.log(`  #${String(slF.index).padStart(3)} | ${String(slF.vertexCount).padStart(5)} | ${slF.area.toFixed(1).padStart(8)} | ${stepId.padStart(6)} | ${stepType.padStart(4)} | ${(score*100).toFixed(0).padStart(4)}%  | ${'N/A'.padStart(8)} | MISS`);
                faceResults.push({ slIndex: slF.index, stepId: stepF?.id, match: score, status: 'MISS' });
                continue;
            }

            matchedFaces++;
            const surf = lookup.surfData[stepF.surfId];

            const evalResult = evalA2P3D(stepF.surfId, lookup);
            if (evalResult && surf) {
                const surfParams = {
                    center: evalResult.center,
                    normal: evalResult.normal,
                    refDir: evalResult.refDir,
                    sideDir: evalResult.sideDir,
                };
                if (surf.type === 'CYL') surfParams.radius = surf.radius;
                if (surf.type === 'CON') { surfParams.radius = surf.radius; surfParams.halfAngle = surf.halfAngle; }
                if (surf.type === 'PLANE') {
                    const bounds = faceBounds.get(stepF.id);
                    if (bounds) {
                        const S = 0.001;
                        surfParams.outerBoundary = bounds.outer.map(p => [p[0]*S, p[1]*S, p[2]*S]);
                        surfParams.holeBoundaries = bounds.holes.map(h => h.map(p => [p[0]*S, p[1]*S, p[2]*S]));
                    }
                }
                setFaceSurface(mesh, slF.index, surf.type, surfParams);
            }

            let faceMaxDist = 0, faceMatchedVerts = 0;

            for (const v of slF.verts) {
                const d = distToSurface(v, surf, lookup);
                if (d !== null) {
                    if (d < opts.tolerance) faceMatchedVerts++;
                    if (d > faceMaxDist) faceMaxDist = d;
                    if (d > maxDist) maxDist = d;
                    sumDist += d;
                    distCount++;
                }
            }

            totalVerts += slF.verts.length;
            matchedVerts += faceMatchedVerts;

            const status = faceMaxDist < opts.tolerance ? 'OK' : faceMaxDist < opts.tolerance * 3 ? 'WARN' : 'FAIL';
            console.log(`  #${String(slF.index).padStart(3)} | ${String(slF.vertexCount).padStart(5)} | ${slF.area.toFixed(1).padStart(8)} | #${String(stepF.id).padStart(4)} | ${(surf?.type||'?').padStart(4)} | ${(score*100).toFixed(0).padStart(4)}%  | ${faceMaxDist.toFixed(3).padStart(8)} | ${status}`);
            faceResults.push({ slIndex: slF.index, stepId: stepF.id, surfType: surf?.type, match: score, maxDist: faceMaxDist, status });
        }

        const statusCounts = { OK: 0, WARN: 0, FAIL: 0, MISS: 0 };
        for (const r of faceResults) statusCounts[r.status]++;

        console.log(`\n=== Validation Summary ===\n`);
        console.log(`Matched faces:   ${matchedFaces}/${slFaces.length}`);
        console.log(`Unmatched faces: ${unmatchedFaces}/${slFaces.length}`);
        console.log(`Vertex match:    ${matchedVerts}/${totalVerts} (${(matchedVerts/Math.max(1,totalVerts)*100).toFixed(1)}%)`);
        if (distCount > 0) {
            console.log(`Max distance:    ${maxDist.toFixed(4)} mm`);
            console.log(`Avg distance:    ${(sumDist/distCount).toFixed(4)} mm`);
        }
        console.log(`Status: ${statusCounts.OK} OK, ${statusCounts.WARN} warn, ${statusCounts.FAIL} fail, ${statusCounts.MISS} miss`);
    }

    // Step 3: Export
    const baseName = path.basename(sldprtPath, path.extname(sldprtPath));
    const extMap = { 'obj': '.obj', 'stl': '.stl', 'binary-stl': '.stl', 'step': '.step' };
    const ext = extMap[opts.format] || '.stl';

    let outPath;
    if (opts.output) {
        outPath = path.resolve(opts.output);
    } else {
        outPath = uniqueFilename(baseName + '_extracted', ext, path.dirname(sldprtPath));
    }

    console.log(`\n=== Export ===\n`);

    let output;
    if (opts.format === 'obj') {
        output = toOBJ(mesh);
    } else if (opts.format === 'stl') {
        output = toSTL(mesh);
    } else if (opts.format === 'step') {
        output = toSTEP(mesh);
    } else {
        output = toBinarySTL(mesh);
    }

    fs.writeFileSync(outPath, output);
    console.log(`Exported: ${outPath} (${(output.length / 1024).toFixed(1)} KB)`);

    // Always export STEP alongside the primary format
    if (opts.format !== 'step') {
        const stepPath = outPath.replace(/\.[^.]+$/, '.step');
        const stepOutput = toSTEP(mesh);
        fs.writeFileSync(stepPath, stepOutput);
        console.log(`Exported: ${stepPath} (${(stepOutput.length / 1024).toFixed(1)} KB)`);
    }
}

run();
