#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { readSLDPRT, findStream } = require('./sldprt-reader');

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node src/convert.js <input.sldprt> [output.stl|output.obj]');
    console.log('');
    console.log('Converts a SolidWorks SLDPRT file to STL and OBJ format.');
    console.log('If no output path is given, writes <input>_converted.stl and <input>_converted.obj');
    process.exit(0);
}

const filePath = path.resolve(args[0]);
if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
}

let stlOut, objOut;
if (args[1]) {
    const ext = path.extname(args[1]);
    const base = args[1].replace(/\.(stl|obj)$/i, '');
    stlOut = base + '.stl';
    objOut = base + '.obj';
} else {
    stlOut = filePath.replace(/\.sldprt$/i, '_converted.stl');
    objOut = filePath.replace(/\.sldprt$/i, '_converted.obj');
}

console.log(`Reading ${path.basename(filePath)}...`);
const { raw, streams } = readSLDPRT(filePath);

const dlStream = findStream(streams, 'Contents/DisplayLists');
if (!dlStream) {
    console.error('Error: DisplayLists stream not found in SLDPRT file');
    process.exit(1);
}
const dl = dlStream.data;
const dv = new DataView(dl.buffer, dl.byteOffset, dl.byteLength);
const SCALE = 1000;

function findAll(buf, pattern) {
    const pos = [];
    for (let i = 0; i <= buf.length - pattern.length; i++) {
        let ok = true;
        for (let j = 0; j < pattern.length; j++) {
            if (buf[i + j] !== pattern[j]) { ok = false; break; }
        }
        if (ok) pos.push(i);
    }
    return pos;
}

const marker = new Uint8Array([0x0c, 0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00]);
const markerPositions = findAll(dl, marker);

const faces = [];
for (const mp of markerPositions) {
    const edgeCount = dv.getUint32(mp - 4, true);
    if (edgeCount < 1 || edgeCount > 500) continue;
    const faceType = dv.getUint32(mp + 8, true);
    if (faceType !== 2) continue;
    const vertexCount = dv.getUint32(mp + 12, true);
    if (vertexCount < 3 || vertexCount > 5000) continue;
    const vertStart = mp + 16;
    if (vertStart + vertexCount * 12 > dl.length) continue;
    const verts = [];
    for (let i = 0; i < vertexCount; i++) {
        const off = vertStart + i * 12;
        verts.push([
            dv.getFloat32(off, true) * SCALE,
            dv.getFloat32(off + 4, true) * SCALE,
            dv.getFloat32(off + 8, true) * SCALE
        ]);
    }
    faces.push({ mp, edgeCount, faceType, vertexCount, verts });
}

console.log(`Extracted ${faces.length} faces from DisplayLists`);

function triArea(a, b, c) {
    const e1 = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
    const e2 = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
    const n = [e1[1]*e2[2]-e1[2]*e2[1], e1[2]*e2[0]-e1[0]*e2[2], e1[0]*e2[1]-e1[1]*e2[0]];
    return Math.sqrt(n[0]*n[0]+n[1]*n[1]+n[2]*n[2]) / 2;
}

function convexHull2D(points) {
    if (points.length < 3) return points;
    const pts = points.map(p => [...p]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (O, A, B) => (A[0]-O[0])*(B[1]-O[1]) - (A[1]-O[1])*(B[0]-O[0]);
    const lower = [];
    for (const p of pts) {
        while (lower.length >= 2 && cross(lower[lower.length-2], lower[lower.length-1], p) <= 0) lower.pop();
        lower.push(p);
    }
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
        const p = pts[i];
        while (upper.length >= 2 && cross(upper[upper.length-2], upper[upper.length-1], p) <= 0) upper.pop();
        upper.push(p);
    }
    upper.pop(); lower.pop();
    return lower.concat(upper);
}

function isCleanCircle(pts) {
    if (pts.length < 3) return true;
    const cx = pts.reduce((s,p)=>s+p[0],0)/pts.length;
    const cz = pts.reduce((s,p)=>s+p[2],0)/pts.length;
    const angles = pts.map(p => Math.atan2(p[2]-cz, p[0]-cx));
    let signChanges = 0;
    for (let i = 2; i < angles.length; i++) {
        let d1 = angles[i-1] - angles[i-2];
        if (d1 > Math.PI) d1 -= 2*Math.PI;
        if (d1 < -Math.PI) d1 += 2*Math.PI;
        let d2 = angles[i] - angles[i-1];
        if (d2 > Math.PI) d2 -= 2*Math.PI;
        if (d2 < -Math.PI) d2 += 2*Math.PI;
        if (d1 * d2 < 0) signChanges++;
    }
    return signChanges === 0;
}

const allVerts = [];
const vertMap = new Map();
function addVert(v) {
    const key = v[0].toFixed(6) + ',' + v[1].toFixed(6) + ',' + v[2].toFixed(6);
    if (vertMap.has(key)) return vertMap.get(key);
    const idx = allVerts.length;
    allVerts.push([...v]);
    vertMap.set(key, idx);
    return idx;
}

const tris = [];

for (let fi = 0; fi < faces.length; fi++) {
    const f = faces[fi];
    const v = f.verts;
    if (v.length < 3) continue;

    const yVals = v.map(p => p[1]);
    const yMin = Math.min(...yVals);
    const yMax = Math.max(...yVals);
    const yRange = yMax - yMin;

    let altCount = 0;
    for (let i = 1; i < v.length; i++) {
        if (Math.abs(yVals[i] - yVals[i-1]) > yRange * 0.3) altCount++;
    }
    const isAlternating = altCount > v.length * 0.3;

    if (yRange < 0.01) {
        if (yMin > 4.0) continue;
        const projected = v.map(p => [p[0], p[2]]);
        const hull = convexHull2D(projected);
        if (hull.length < 3) continue;
        const hull3D = hull.map(h => {
            const match = v.find(p => Math.abs(p[0]-h[0]) < 0.001 && Math.abs(p[2]-h[1]) < 0.001);
            return match || [h[0], yMin, h[1]];
        });
        const cx = hull3D.reduce((s, p) => s + p[0], 0) / hull3D.length;
        const cy = yMin;
        const cz = hull3D.reduce((s, p) => s + p[2], 0) / hull3D.length;
        const ci = addVert([cx, cy, cz]);
        for (let i = 0; i < hull3D.length; i++) {
            const next = (i + 1) % hull3D.length;
            tris.push([ci, addVert(hull3D[i]), addVert(hull3D[next])]);
        }
        continue;
    }

    if (v.length === 4 && !isAlternating) {
        tris.push([addVert(v[0]), addVert(v[1]), addVert(v[2])]);
        tris.push([addVert(v[0]), addVert(v[2]), addVert(v[3])]);
        continue;
    }

    if (isAlternating) {
        const curve0 = [], curve1 = [];
        for (let i = 0; i < v.length; i++) {
            const isLow = Math.abs(yVals[i] - yMin) < Math.abs(yVals[i] - yMax);
            if (isLow) curve0.push(v[i]);
            else curve1.push(v[i]);
        }

        const minLen = Math.min(curve0.length, curve1.length);
        if (minLen < 2) continue;
        let c0 = curve0.slice(0, minLen);
        let c1 = curve1.slice(0, minLen);

        if (!isCleanCircle(c0) || !isCleanCircle(c1)) {
            const centroid0 = [0, 0, 0];
            const centroid1 = [0, 0, 0];
            for (const p of c0) { centroid0[0] += p[0]; centroid0[2] += p[2]; }
            for (const p of c1) { centroid1[0] += p[0]; centroid1[2] += p[2]; }
            centroid0[0] /= minLen; centroid0[2] /= minLen;
            centroid1[0] /= minLen; centroid1[2] /= minLen;
            const angles0 = c0.map(p => Math.atan2(p[2]-centroid0[2], p[0]-centroid0[0]));
            const angles1 = c1.map(p => Math.atan2(p[2]-centroid1[2], p[0]-centroid1[0]));
            const matched1 = new Array(minLen).fill(-1);
            const used1 = new Set();
            for (let i = 0; i < minLen; i++) {
                let bestJ = -1, bestDist = Infinity;
                for (let j = 0; j < minLen; j++) {
                    if (used1.has(j)) continue;
                    let diff = Math.abs(angles0[i] - angles1[j]);
                    if (diff > Math.PI) diff = 2 * Math.PI - diff;
                    if (diff < bestDist) { bestDist = diff; bestJ = j; }
                }
                if (bestJ >= 0) { matched1[i] = bestJ; used1.add(bestJ); }
            }
            const c1orig = [...c1];
            c1 = new Array(minLen);
            for (let i = 0; i < minLen; i++) {
                c1[i] = matched1[i] >= 0 ? c1orig[matched1[i]] : c1orig[i];
            }
        }

        const nu = Math.max(minLen, 8);
        const nv = Math.max(Math.ceil(yRange / 1.5), 2);

        const grid = [];
        for (let iv = 0; iv <= nv; iv++) {
            const row = [];
            const t = iv / nv;
            for (let iu = 0; iu <= nu; iu++) {
                const frac = iu / nu;
                const idx = frac * (minLen - 1);
                const i0 = Math.floor(idx);
                const i1 = Math.min(i0 + 1, minLen - 1);
                const localT = idx - i0;
                const p0 = [
                    c0[i0][0] + localT * (c0[i1][0] - c0[i0][0]),
                    c0[i0][1] + localT * (c0[i1][1] - c0[i0][1]),
                    c0[i0][2] + localT * (c0[i1][2] - c0[i0][2])
                ];
                const p1 = [
                    c1[i0][0] + localT * (c1[i1][0] - c1[i0][0]),
                    c1[i0][1] + localT * (c1[i1][1] - c1[i0][1]),
                    c1[i0][2] + localT * (c1[i1][2] - c1[i0][2])
                ];
                row.push([
                    p0[0] + t * (p1[0] - p0[0]),
                    p0[1] + t * (p1[1] - p0[1]),
                    p0[2] + t * (p1[2] - p0[2])
                ]);
            }
            grid.push(row);
        }
        for (let iv = 0; iv < nv; iv++) {
            for (let iu = 0; iu < nu; iu++) {
                tris.push([addVert(grid[iv][iu]), addVert(grid[iv+1][iu]), addVert(grid[iv+1][iu+1])]);
                tris.push([addVert(grid[iv][iu]), addVert(grid[iv+1][iu+1]), addVert(grid[iv][iu+1])]);
            }
        }
        continue;
    }

    const unique = [];
    const seen = new Set();
    for (const p of v) {
        const key = p[0].toFixed(4)+','+p[1].toFixed(4)+','+p[2].toFixed(4);
        if (!seen.has(key)) { seen.add(key); unique.push([...p]); }
    }
    if (unique.length < 3) continue;
    const cx = unique.reduce((s, p) => s + p[0], 0) / unique.length;
    const cy = unique.reduce((s, p) => s + p[1], 0) / unique.length;
    const cz = unique.reduce((s, p) => s + p[2], 0) / unique.length;
    const ci = addVert([cx, cy, cz]);
    let nx = 0, ny = 0, nz = 0;
    for (let i = 2; i < unique.length; i++) {
        const e1 = [unique[1][0]-unique[0][0], unique[1][1]-unique[0][1], unique[1][2]-unique[0][2]];
        const e2 = [unique[i][0]-unique[0][0], unique[i][1]-unique[0][1], unique[i][2]-unique[0][2]];
        nx = e1[1]*e2[2]-e1[2]*e2[1]; ny = e1[2]*e2[0]-e1[0]*e2[2]; nz = e1[0]*e2[1]-e1[1]*e2[0];
        if (nx*nx+ny*ny+nz*nz > 0.01) break;
    }
    const nl = Math.sqrt(nx*nx+ny*ny+nz*nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    let uAxis, vAxis;
    if (Math.abs(ny) > 0.9) { uAxis = [1,0,0]; vAxis = [0,0,1]; }
    else if (Math.abs(nx) > 0.9) { uAxis = [0,1,0]; vAxis = [0,0,1]; }
    else { uAxis = [1,0,0]; vAxis = [0,1,0]; }
    const indexed = unique.map((p, i) => {
        const dx = p[0]-cx, dy = p[1]-cy, dz = p[2]-cz;
        const pu = dx*uAxis[0]+dy*uAxis[1]+dz*uAxis[2];
        const pv = dx*vAxis[0]+dy*vAxis[1]+dz*vAxis[2];
        return { i, angle: Math.atan2(pv, pu) };
    });
    indexed.sort((a, b) => a.angle - b.angle);
    const sorted = indexed.map(x => unique[x.i]);
    for (let i = 0; i < sorted.length; i++) {
        const next = (i + 1) % sorted.length;
        tris.push([ci, addVert(sorted[i]), addVert(sorted[next])]);
    }
}

const stlBuf = Buffer.alloc(84 + tris.length * 50);
stlBuf.writeUInt32LE(tris.length, 80);
let off = 84;
let ourArea = 0;
for (const [i0, i1, i2] of tris) {
    const v0 = allVerts[i0], v1 = allVerts[i1], v2 = allVerts[i2];
    ourArea += triArea(v0, v1, v2);
    const e1 = [v1[0]-v0[0], v1[1]-v0[1], v1[2]-v0[2]];
    const e2 = [v2[0]-v0[0], v2[1]-v0[1], v2[2]-v0[2]];
    let n = [e1[1]*e2[2]-e1[2]*e2[1], e1[2]*e2[0]-e1[0]*e2[2], e1[0]*e2[1]-e1[1]*e2[0]];
    const nl2 = Math.sqrt(n[0]*n[0]+n[1]*n[1]+n[2]*n[2]) || 1;
    n = n.map(x => x/nl2);
    stlBuf.writeFloatLE(n[0], off); stlBuf.writeFloatLE(n[1], off+4); stlBuf.writeFloatLE(n[2], off+8); off += 12;
    stlBuf.writeFloatLE(v0[0], off); stlBuf.writeFloatLE(v0[1], off+4); stlBuf.writeFloatLE(v0[2], off+8); off += 12;
    stlBuf.writeFloatLE(v1[0], off); stlBuf.writeFloatLE(v1[1], off+4); stlBuf.writeFloatLE(v1[2], off+8); off += 12;
    stlBuf.writeFloatLE(v2[0], off); stlBuf.writeFloatLE(v2[1], off+4); stlBuf.writeFloatLE(v2[2], off+8); off += 12;
    stlBuf.writeUInt16LE(0, off); off += 2;
}

fs.writeFileSync(stlOut, stlBuf);

let obj = '# SLDPRT converted to OBJ\n';
for (const v of allVerts) obj += `v ${v[0].toFixed(6)} ${v[1].toFixed(6)} ${v[2].toFixed(6)}\n`;
for (const [i0, i1, i2] of tris) obj += `f ${i0+1} ${i1+1} ${i2+1}\n`;
fs.writeFileSync(objOut, obj);

console.log(`Wrote ${path.basename(stlOut)} (${tris.length} triangles, ${allVerts.length} vertices)`);
console.log(`Wrote ${path.basename(objOut)}`);
console.log(`Surface area: ${ourArea.toFixed(1)} mm²`);
