#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { readSLDPRT, findStream } = require('./sldprt-reader');
const { findAll } = require('./utils');

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
    const ext = path.extname(args[1]).toLowerCase();
    if (ext === '.stl' || ext === '.obj') {
        stlOut = args[1].replace(/\.(stl|obj)$/i, '.stl');
        objOut = args[1].replace(/\.(stl|obj)$/i, '.obj');
    } else {
        stlOut = args[1] + '.stl';
        objOut = args[1] + '.obj';
    }
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

const marker = new Uint8Array([0x0c, 0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00]);
const markerPositions = findAll(dl, marker);

const faces = [];
for (const mp of markerPositions) {
    if (mp < 4) continue;
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

function isCleanStrip(v, yMin, yMax) {
    const yMid = (yMin + yMax) / 2;
    let lastWasLow = v[0][1] <= yMid;
    let alt = 0;
    for (let i = 1; i < v.length; i++) {
        const isLow = v[i][1] <= yMid;
        if (isLow !== lastWasLow) alt++;
        lastWasLow = isLow;
    }
    return alt >= v.length * 0.8;
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

function fanFlatFace(v) {
    const unique = [];
    const seen = new Set();
    for (const p of v) {
        const key = p[0].toFixed(6) + ',' + p[1].toFixed(6) + ',' + p[2].toFixed(6);
        if (!seen.has(key)) { seen.add(key); unique.push([...p]); }
    }
    if (unique.length < 3) return [];

    const cx = unique.reduce((s, p) => s + p[0], 0) / unique.length;
    const cy = unique.reduce((s, p) => s + p[1], 0) / unique.length;
    const cz = unique.reduce((s, p) => s + p[2], 0) / unique.length;

    let nx = 0, ny = 0, nz = 0;
    for (let i = 2; i < unique.length; i++) {
        const e1 = [unique[1][0]-unique[0][0], unique[1][1]-unique[0][1], unique[1][2]-unique[0][2]];
        const e2 = [unique[i][0]-unique[0][0], unique[i][1]-unique[0][1], unique[i][2]-unique[0][2]];
        nx = e1[1]*e2[2]-e1[2]*e2[1]; ny = e1[2]*e2[0]-e1[0]*e2[2]; nz = e1[0]*e2[1]-e1[1]*e2[0];
        if (nx*nx+ny*ny+nz*nz > 0.01) break;
    }
    const nl = Math.sqrt(nx*nx+ny*ny+nz*nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;

    let u, vAxis;
    if (Math.abs(ny) > 0.9) { u = [1,0,0]; vAxis = [0,0,1]; }
    else if (Math.abs(nx) > 0.9) { u = [0,1,0]; vAxis = [0,0,1]; }
    else { u = [1,0,0]; vAxis = [0,1,0]; }

    const indexed = unique.map((p, i) => {
        const dx = p[0]-cx, dy = p[1]-cy, dz = p[2]-cz;
        const pu = dx*u[0]+dy*u[1]+dz*u[2];
        const pv = dx*vAxis[0]+dy*vAxis[1]+dz*vAxis[2];
        return { i, angle: Math.atan2(pv, pu) };
    });
    indexed.sort((a, b) => a.angle - b.angle);
    const sorted = indexed.map(x => unique[x.i]);

    const ci = addVert([cx, cy, cz]);
    const result = [];
    for (let i = 0; i < sorted.length; i++) {
        const next = (i + 1) % sorted.length;
        result.push([ci, addVert(sorted[i]), addVert(sorted[next])]);
    }
    return result;
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

    // Detect flat face: Y constant, or X constant, or Z constant
    let isFlat = false;
    if (yRange < 0.01) {
        isFlat = true;
    } else {
        const xVals = v.map(p => p[0]);
        const xRange = Math.max(...xVals) - Math.min(...xVals);
        if (xRange < 0.01) isFlat = true;
        const zVals = v.map(p => p[2]);
        const zRange = Math.max(...zVals) - Math.min(...zVals);
        if (zRange < 0.01) isFlat = true;
    }

    // Simple quad (4V, not alternating)
    if (v.length === 4 && !isCleanStrip(v, yMin, yMax)) {
        tris.push([addVert(v[0]), addVert(v[1]), addVert(v[2])]);
        tris.push([addVert(v[0]), addVert(v[2]), addVert(v[3])]);
        continue;
    }

    // Clean strip surface (standoffs, cones, transitions)
    if (!isFlat && yRange > 0.01 && isCleanStrip(v, yMin, yMax)) {
        for (let i = 0; i < v.length - 2; i++) {
            tris.push([addVert(v[i]), addVert(v[i+1]), addVert(v[i+2])]);
        }
        continue;
    }

    // Flat face or non-clean: angular fan from centroid
    tris.push(...fanFlatFace(v));
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

const origPath = filePath.replace(/\.sldprt$/i, ' ORIGINAL.STL');
if (fs.existsSync(origPath)) {
    const origBuf = new Uint8Array(fs.readFileSync(origPath));
    const origDv = new DataView(origBuf.buffer, origBuf.byteOffset, origBuf.byteLength);
    const origTriCount = origDv.getUint32(80, true);
    let origArea = 0;
    for (let i = 0; i < origTriCount; i++) {
        const base = 84 + i * 50 + 12;
        const p0 = [origDv.getFloat32(base, true), origDv.getFloat32(base+4, true), origDv.getFloat32(base+8, true)];
        const p1 = [origDv.getFloat32(base+12, true), origDv.getFloat32(base+16, true), origDv.getFloat32(base+20, true)];
        const p2 = [origDv.getFloat32(base+24, true), origDv.getFloat32(base+28, true), origDv.getFloat32(base+32, true)];
        origArea += triArea(p0, p1, p2);
    }
    console.log(`Original: ${origTriCount} tris, area=${origArea.toFixed(1)} mm²`);
    console.log(`Area ratio: ${(ourArea/origArea*100).toFixed(1)}%`);
}
