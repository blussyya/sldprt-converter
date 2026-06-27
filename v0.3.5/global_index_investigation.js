#!/usr/bin/env node
'use strict';
/**
 * Block 1 Global Index Investigation
 * 
 * LARGE values (e.g., 516, 532) are NOT local vertex indices (vc=4).
 * They must index into something global. What is it?
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function rolByte(b, shift) {
    shift &= 7;
    if (shift === 0) return b;
    return ((b << shift) | (b >>> (8 - shift))) & 0xFF;
}

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

function decompressOpenSX(buf) {
    const key = buf[7];
    const marker = [0x14, 0x00, 0x06, 0x00, 0x08, 0x00];
    const streams = {};
    for (const mp of findAll(buf, marker)) {
        const si = mp - 4;
        if (si < 0 || si + 0x1E > buf.length) continue;
        const csz = buf.readUInt32LE(si + 0x12);
        const nsz = buf.readUInt32LE(si + 0x1A);
        if (nsz > 1024 || csz > 50 * 1024 * 1024) continue;
        const nameStart = si + 0x1E;
        const nameEnd = nameStart + nsz;
        if (nameEnd > buf.length) continue;
        const rawName = buf.subarray(nameStart, nameEnd);
        let name = '';
        for (let i = 0; i < nsz; i++) {
            name += String.fromCharCode(rolByte(rawName[i], key));
        }
        if (name.length === 0) continue;
        const dataStart = nameEnd;
        const dataEnd = dataStart + csz;
        if (dataEnd > buf.length) continue;
        const f1 = buf.readUInt32LE(si + 0x0E);
        if (f1 >= 65536 && csz > 0) {
            const compressed = buf.subarray(dataStart, dataEnd);
            let decompressed = null;
            try { decompressed = zlib.inflateRawSync(Buffer.from(compressed)); } catch (e) {
                try { decompressed = zlib.inflateSync(Buffer.from(compressed)); } catch (e2) {}
            }
            if (decompressed && decompressed.length > 0 && !streams[name]) {
                streams[name] = decompressed;
            }
        }
    }
    return streams;
}

// ============================================================
// Load BOTTOM file
// ============================================================

const RESEARCH_DIR = 'C:\\Users\\basha\\Desktop\\soldiworks research';
const bottomPath = path.join(RESEARCH_DIR, 'test files original', 'usb hub case (ultimate test)', 'USB hub case BOTTOM.SLDPRT');
const buf = fs.readFileSync(bottomPath);
const streams = decompressOpenSX(buf);

console.log(`Streams: ${Object.keys(streams).length}`);
for (const [name, data] of Object.entries(streams).sort((a,b) => b[1].length - a[1].length)) {
    console.log(`  ${name}: ${data.length} bytes`);
}

// ============================================================
// Check DisplayLists for global vertex table
// ============================================================

const dl = streams['Contents/DisplayLists'];
console.log(`\nDisplayLists: ${dl.length} bytes`);
console.log(`First 32 bytes: ${Array.from(dl.slice(0, 32)).map(v => v.toString(16).padStart(2, '0')).join(' ')}`);

// Search for float32 arrays that could be vertex data
// Vertices are typically: 3 consecutive float32 values that are "reasonable" coordinates
console.log(`\nScanning for potential vertex float32 data...`);

// Count total faces first
const MARKER = Buffer.from([0x0c, 0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00]);
const faceMarkers = findAll(dl, MARKER);
console.log(`Face markers found: ${faceMarkers.length}`);

// For each face, extract its vertices
const faceData = [];
for (const mp of faceMarkers) {
    if (mp < 4) continue;
    const ec = dl.readUInt32LE(mp - 4);
    if (ec < 1 || ec > 500) continue;
    const ft = dl.readUInt32LE(mp + 8);
    if (ft !== 2) continue;
    const vc = dl.readUInt32LE(mp + 12);
    if (vc < 3 || vc > 5000) continue;
    
    const vertStart = mp + 16;
    if (vertStart + vc * 12 > dl.length) continue;
    
    let valid = true;
    const verts = [];
    for (let i = 0; i < vc; i++) {
        const x = dl.readFloatLE(vertStart + i * 12);
        const y = dl.readFloatLE(vertStart + i * 12 + 4);
        const z = dl.readFloatLE(vertStart + i * 12 + 8);
        if (!isFinite(x) || !isFinite(y) || !isFinite(z)) { valid = false; break; }
        if (Math.abs(x) > 100000 || Math.abs(y) > 100000 || Math.abs(z) > 100000) { valid = false; break; }
        verts.push({ x, y, z });
    }
    if (!valid) continue;
    faceData.push({ ec, vc, verts, markerPos: mp });
}

console.log(`Faces extracted: ${faceData.length}`);

// Collect ALL vertices from ALL faces
const allVertices = [];
for (const f of faceData) {
    for (const v of f.verts) {
        allVertices.push(v);
    }
}
console.log(`Total vertices across all faces: ${allVertices.length}`);

// Build a vertex→index map
const vertToIdx = new Map();
for (let i = 0; i < allVertices.length; i++) {
    const key = `${allVertices[i].x.toFixed(6)},${allVertices[i].y.toFixed(6)},${allVertices[i].z.toFixed(6)}`;
    if (!vertToIdx.has(key)) vertToIdx.set(key, []);
    vertToIdx.get(key).push(i);
}
console.log(`Unique vertices: ${vertToIdx.size}`);

// Check max vertex index
const maxVertIdx = allVertices.length - 1;
console.log(`Max vertex index: ${maxVertIdx}`);

// Now check Block 1 values against global vertex indices
// Parse face topology
function extractFacesWithBlock1(dlData) {
    const data = dlData;
    const results = [];
    const MARKER2 = Buffer.from([0x0c, 0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00]);
    const markerPositions = findAll(data, MARKER2);

    for (const mp of markerPositions) {
        if (mp < 4) continue;
        const edgeCount = data.readUInt32LE(mp - 4);
        if (edgeCount < 1 || edgeCount > 500) continue;
        const faceType = data.readUInt32LE(mp + 8);
        if (faceType !== 2) continue;
        const vertexCount = data.readUInt32LE(mp + 12);
        if (vertexCount < 3 || vertexCount > 5000) continue;

        const vertStart = mp + 16;
        if (vertStart + vertexCount * 12 > data.length) continue;

        let valid = true;
        for (let i = 0; i < vertexCount; i++) {
            const off = vertStart + i * 12;
            const x = data.readFloatLE(off);
            const y = data.readFloatLE(off + 4);
            const z = data.readFloatLE(off + 8);
            if (!isFinite(x) || !isFinite(y) || !isFinite(z)) { valid = false; break; }
            if (Math.abs(x) > 100000 || Math.abs(y) > 100000 || Math.abs(z) > 100000) { valid = false; break; }
        }
        if (!valid) continue;

        const vertEnd = vertStart + vertexCount * 12;
        const normStart = vertEnd + 16;
        const normEnd = normStart + vertexCount * 12;
        const topoStart = normEnd;

        if (topoStart + 16 > data.length) continue;

        const h0 = data.readUInt32LE(topoStart);
        const h1 = data.readUInt32LE(topoStart + 4);
        const h2 = data.readUInt32LE(topoStart + 8);
        if (h0 !== 4 || h1 !== 8 || h2 !== 2) continue;

        const N = data.readUInt32LE(topoStart + 12);
        if (topoStart + 16 + N * 4 > data.length) continue;
        const block1 = [];
        for (let i = 0; i < N; i++) {
            block1.push(data.readUInt32LE(topoStart + 16 + i * 4));
        }

        const b2Start = topoStart + (N + 4) * 4;
        let block2 = [];
        if (b2Start + 12 <= data.length) {
            const b2h0 = data.readUInt32LE(b2Start);
            const b2h1 = data.readUInt32LE(b2Start + 4);
            const b2h2 = data.readUInt32LE(b2Start + 8);
            if (b2h0 === 4 && b2h1 === 8 && b2h2 === 2) {
                const M = data.readUInt32LE(b2Start + 12);
                for (let i = 0; i < M; i++) {
                    block2.push(data.readUInt32LE(b2Start + 16 + i * 4));
                }
            }
        }

        // Get vertices for this face
        const verts = [];
        for (let i = 0; i < vertexCount; i++) {
            verts.push({
                x: data.readFloatLE(vertStart + i * 12),
                y: data.readFloatLE(vertStart + i * 12 + 4),
                z: data.readFloatLE(vertStart + i * 12 + 8)
            });
        }

        results.push({ edgeCount, vertexCount, block1, block2, N, M: block2.length, verts });
    }
    return results;
}

const faces = extractFacesWithBlock1(dl);

// For BOTTOM face #0: check if Block 1 values are global vertex indices
console.log(`\n--- Checking BOTTOM face #0 (ec=4, vc=4) ---`);
const f0 = faces[0];
console.log(`Block 1: [${f0.block1.join(', ')}]`);
console.log(`Block 2: [${f0.block2.join(', ')}]`);

// Split into sections
function extractSections(block1Vals) {
    const sections = [];
    let current = [];
    for (let i = 0; i < block1Vals.length; i++) {
        if (block1Vals[i] === 1) {
            if (current.length > 0) sections.push(current);
            current = [];
        }
        current.push(block1Vals[i]);
    }
    if (current.length > 0) sections.push(current);
    return sections;
}

const f0sections = extractSections(f0.block1);
for (let si = 0; si < f0sections.length; si++) {
    const sec = f0sections[si];
    const largeVals = sec.filter(v => v > 255);
    console.log(`\n  Section ${si} (len=${sec.length}): [${sec.join(', ')}]`);
    console.log(`  LARGE values: [${largeVals.join(', ')}]`);
    
    // Try to look up each LARGE value as a global vertex index
    for (const idx of largeVals) {
        if (idx < allVertices.length) {
            const v = allVertices[idx];
            console.log(`    idx ${idx}: (${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`);
        } else {
            console.log(`    idx ${idx}: OUT OF RANGE (max=${maxVertIdx})`);
        }
    }
}

// Check if Block 1 values are into a different vertex table
// Maybe the vertex table is within the section's face, not global
console.log(`\n--- Alternative: Block 1 values as face-local indices offset by some base ---`);
// For face #0: vc=4, but values are ~500-600
// Could they be: value = base + localIdx?
// base would need to be ~500
// Check: value % vc? 516 % 4 = 0, 532 % 4 = 0, 527 % 4 = 3, 522 % 4 = 2
// That gives local indices [0, 0, 3, 2] — not a valid loop (duplicated 0)

console.log(`\n--- Alternative: Block 1 values are into vertex pool ---`);
// Maybe there's a vertex pool somewhere in the DisplayLists
// Look for large float32 arrays between face markers

// Check bytes between last face marker and end of DisplayLists
const lastFace = faceMarkers[faceMarkers.length - 1];
const afterLastFace = dl.slice(lastFace + 16);
console.log(`\nAfter last face marker: ${afterLastFace.length} bytes`);
console.log(`First 64 bytes: ${Array.from(afterLastFace.slice(0, 64)).map(v => v.toString(16).padStart(2, '0')).join(' ')}`);

// Check if there's a vertex buffer at the beginning of DisplayLists
// The stream starts with [1, 1] section headers
console.log(`\nDisplayLists header: ${dl.readUInt32LE(0)}, ${dl.readUInt32LE(4)}, ${dl.readUInt32LE(8)}, ${dl.readUInt32LE(12)}`);

// Look for float32 data in the first 200 bytes
console.log(`\nFirst 200 bytes as float32 pairs:`);
for (let i = 0; i < 200; i += 8) {
    const f1 = dl.readFloatLE(i);
    const f2 = dl.readFloatLE(i + 4);
    if (isFinite(f1) && isFinite(f2) && Math.abs(f1) < 1000 && Math.abs(f2) < 1000) {
        console.log(`  offset ${i}: ${f1.toFixed(3)}, ${f2.toFixed(3)}`);
    }
}
