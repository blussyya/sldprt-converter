#!/usr/bin/env node
/**
 * Diagnostic: Find exact offset of per-vertex normals in gap data
 */

const fs = require('fs');
const path = require('path');
const { ensureBuffer } = require('./ole2-parser.js');
const zlib = require('zlib');
const inflate = { inflateRaw: (b) => zlib.inflateRawSync(Buffer.from(b)), inflate: (b) => zlib.inflateSync(Buffer.from(b)) };
function rolByte(b, shift) { shift &= 7; return shift === 0 ? b : ((b << shift) | (b >>> (8 - shift))) & 0xFF; }
function findAllIn(buf, pattern) {
    const pos = [];
    for (let i = 0; i <= buf.length - pattern.length; i++) {
        let ok = true;
        for (let j = 0; j < pattern.length; j++) { if (buf[i + j] !== pattern[j]) { ok = false; break; } }
        if (ok) pos.push(i);
    }
    return pos;
}

const SLDPRT = path.join('..', 'test files original', 'usb hub case (ultimate test)', 'USB hub case TOP.SLDPRT');
const buf = fs.readFileSync(SLDPRT);
const key = buf[7];
const streamMarker = new Uint8Array([0x14, 0x00, 0x06, 0x00, 0x08, 0x00]);
const streams = {};
for (const mp of findAllIn(buf, streamMarker)) {
    const si = mp - 4;
    if (si < 0 || si + 0x1E > buf.length) continue;
    const f1 = buf.readUInt32LE(si + 0x0E);
    const csz = buf.readUInt32LE(si + 0x12);
    const nsz = buf.readUInt32LE(si + 0x1A);
    if (nsz > 1024 || csz > 50 * 1024 * 1024) continue;
    const nameStart = si + 0x1E;
    const nameEnd = nameStart + nsz;
    if (nameEnd > buf.length) continue;
    let name = '';
    for (let i = 0; i < nsz; i++) name += String.fromCharCode(rolByte(buf[nameStart + i], key));
    if (name.length === 0) continue;
    const dataEnd = nameEnd + csz;
    if (dataEnd > buf.length) continue;
    if (f1 >= 65536 && csz > 0) {
        let decompressed = null;
        try { decompressed = inflate.inflateRaw(buf.subarray(nameEnd, dataEnd)); } catch(e) {}
        if (!decompressed || decompressed.length === 0) {
            try { decompressed = inflate.inflate(buf.subarray(nameEnd, dataEnd)); } catch(e) {}
        }
        if (decompressed && decompressed.length > 0 && !streams[name]) streams[name] = decompressed;
    }
}
let dlData;
for (const [name, data] of Object.entries(streams)) {
    if (name.toLowerCase().includes('displaylist') && data.length > 100) {
        const d = ensureBuffer(data);
        if (d.readUInt32LE(0) === 1 && d.readUInt32LE(4) === 1) { dlData = data; break; }
    }
}
dlData = ensureBuffer(dlData);
console.log(`DisplayLists: ${dlData.length} bytes`);

const MARKER = new Uint8Array([0x0c, 0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00]);
const markerPositions = findAllIn(dlData, MARKER);

const faces = [];
for (const mp of markerPositions) {
    if (mp < 4) continue;
    const edgeCount = dlData.readUInt32LE(mp - 4);
    if (edgeCount < 1 || edgeCount > 500) continue;
    const faceType = dlData.readUInt32LE(mp + 8);
    if (faceType !== 2) continue;
    const vertexCount = dlData.readUInt32LE(mp + 12);
    if (vertexCount < 3 || vertexCount > 5000) continue;
    const vertStart = mp + 16;
    if (vertStart + vertexCount * 12 > dlData.length) continue;
    let valid = true;
    for (let i = 0; i < vertexCount; i++) {
        const off = vertStart + i * 12;
        const x = dlData.readFloatLE(off);
        const y = dlData.readFloatLE(off + 4);
        const z = dlData.readFloatLE(off + 8);
        if (!isFinite(x) || !isFinite(y) || !isFinite(z)) { valid = false; break; }
        if (Math.abs(x) > 100000 || Math.abs(y) > 100000 || Math.abs(z) > 100000) { valid = false; break; }
    }
    if (!valid) continue;
    const verts = [];
    for (let i = 0; i < vertexCount; i++) {
        const off = vertStart + i * 12;
        verts.push([dlData.readFloatLE(off), dlData.readFloatLE(off+4), dlData.readFloatLE(off+8)]);
    }
    faces.push({ mp, edgeCount, vertexCount, vertStart, endOffset: vertStart + vertexCount * 12, verts });
}

// For face #0 (FAIL), analyze the gap data structure
console.log('\n=== FACE #0 GAP ANALYSIS ===\n');
const f0 = faces[0];
const f0_gapStart = f0.endOffset;
const f0_gapEnd = faces[1].mp - 4;
const f0_gapLen = f0_gapEnd - f0_gapStart;
console.log(`Gap: ${f0_gapLen} bytes`);
console.log(`  vertexCount: ${f0.vertexCount}`);
console.log(`  Expected normals: ${f0.vertexCount * 12} bytes`);

// Read second header
console.log('\nSecond header:');
for (let off = 0; off < 20; off += 4) {
    const u = dlData.readUInt32LE(f0_gapStart + off);
    const f = dlData.readFloatLE(f0_gapStart + off);
    console.log(`  [+${String(off).padStart(3)}] uint32=0x${u.toString(16).padStart(8,'0')}  float=${f.toFixed(6)}`);
}

// Find where per-vertex normals could be
// Normals should be unit vectors: sqrt(nx^2+ny^2+nz^2) ≈ 1.0
console.log('\nScanning for normal data (unit vectors):');
const vertexCount = f0.vertexCount;
for (let startOff = 16; startOff < Math.min(f0_gapLen - vertexCount * 12, 200); startOff += 4) {
    let allUnit = true;
    let allFinite = true;
    const normals = [];
    for (let i = 0; i < Math.min(vertexCount, 10); i++) {
        const off = f0_gapStart + startOff + i * 12;
        if (off + 12 > dlData.length) { allFinite = false; break; }
        const nx = dlData.readFloatLE(off);
        const ny = dlData.readFloatLE(off + 4);
        const nz = dlData.readFloatLE(off + 8);
        if (!isFinite(nx) || !isFinite(ny) || !isFinite(nz)) { allFinite = false; break; }
        const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
        normals.push([nx/len, ny/len, nz/len]);
        if (len < 0.8 || len > 1.2) allUnit = false;
    }
    if (allFinite && allUnit && normals.length === Math.min(vertexCount, 10)) {
        console.log(`  [${String(startOff).padStart(3)}] First 10 normals ARE unit vectors!`);
        // Show first 5 normals
        for (let i = 0; i < Math.min(5, normals.length); i++) {
            console.log(`    v${i}: (${normals[i][0].toFixed(4)}, ${normals[i][1].toFixed(4)}, ${normals[i][2].toFixed(4)})`);
        }
    }
}

// Also check OK face #36
console.log('\n=== FACE #36 (OK) GAP ANALYSIS ===\n');
const f36 = faces[36];
const f36_gapStart = f36.endOffset;
const f36_gapEnd = faces[37].mp - 4;
const f36_gapLen = f36_gapEnd - f36_gapStart;
console.log(`Gap: ${f36_gapLen} bytes`);
console.log(`  vertexCount: ${f36.vertexCount}`);

console.log('\nSecond header:');
for (let off = 0; off < 20; off += 4) {
    const u = dlData.readUInt32LE(f36_gapStart + off);
    const f = dlData.readFloatLE(f36_gapStart + off);
    console.log(`  [+${String(off).padStart(3)}] uint32=0x${u.toString(16).padStart(8,'0')}  float=${f.toFixed(6)}`);
}

console.log('\nScanning for normal data (unit vectors):');
for (let startOff = 16; startOff < Math.min(f36_gapLen - f36.vertexCount * 12, 200); startOff += 4) {
    let allUnit = true;
    let allFinite = true;
    const normals = [];
    for (let i = 0; i < Math.min(f36.vertexCount, 10); i++) {
        const off = f36_gapStart + startOff + i * 12;
        if (off + 12 > dlData.length) { allFinite = false; break; }
        const nx = dlData.readFloatLE(off);
        const ny = dlData.readFloatLE(off + 4);
        const nz = dlData.readFloatLE(off + 8);
        if (!isFinite(nx) || !isFinite(ny) || !isFinite(nz)) { allFinite = false; break; }
        const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
        normals.push([nx/len, ny/len, nz/len]);
        if (len < 0.8 || len > 1.2) allUnit = false;
    }
    if (allFinite && allUnit && normals.length === Math.min(f36.vertexCount, 10)) {
        console.log(`  [${String(startOff).padStart(3)}] First 10 normals ARE unit vectors!`);
        for (let i = 0; i < Math.min(5, normals.length); i++) {
            console.log(`    v${i}: (${normals[i][0].toFixed(4)}, ${normals[i][1].toFixed(4)}, ${normals[i][2].toFixed(4)})`);
        }
    }
}

console.log('\nDone.');
