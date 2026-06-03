#!/usr/bin/env node
'use strict';
const fs = require('fs');
const pako = require('pako');

function getDisplayLists(filePath) {
    const buf = new Uint8Array(fs.readFileSync(filePath));
    const marker = new Uint8Array([0x14, 0x00, 0x06, 0x00, 0x08, 0x00]);
    for (let i = 0; i <= buf.length - marker.length; i++) {
        let ok = true;
        for (let j = 0; j < marker.length; j++) { if (buf[i+j] !== marker[j]) { ok = false; break; } }
        if (!ok) continue;
        const si = i - 4;
        if (si < 0 || si + 0x1E > buf.length) continue;
        const csz = (buf[si+0x12] | (buf[si+0x13]<<8) | (buf[si+0x14]<<16) | (buf[si+0x15]<<24)) >>> 0;
        const nsz = (buf[si+0x1A] | (buf[si+0x1B]<<8) | (buf[si+0x1C]<<16) | (buf[si+0x1D]<<24)) >>> 0;
        if (nsz > 1024 || csz > 50*1024*1024) continue;
        const nameEnd = si + 0x1E + nsz;
        if (nameEnd > buf.length) continue;
        let name = '';
        for (let k = 0; k < nsz; k++) {
            const b = buf[si+0x1E+k];
            name += String.fromCharCode(((b << 4) | (b >>> 4)) & 0xFF);
        }
        if (!name.includes('DisplayList') || csz < 100) continue;
        const f1 = (buf[si+0x0E] | (buf[si+0x0F]<<8) | (buf[si+0x10]<<16) | (buf[si+0x11]<<24)) >>> 0;
        if (f1 < 65536) continue;
        const compressed = buf.slice(nameEnd, nameEnd + csz);
        try {
            const dl = pako.inflateRaw(compressed);
            if (dl.length > 100 && dl[0] === 1 && dl[4] === 1) return dl;
        } catch(e) {}
    }
    return null;
}

const dl = getDisplayLists('C:\\\\.git\\\\sldprt-research\\\\PTC GE8080-8.SLDPRT');
if (!dl) { console.log('No DisplayLists'); process.exit(1); }
const dv = new DataView(dl.buffer, dl.byteOffset, dl.byteLength);
console.log('DisplayLists:', dl.length, 'bytes');

// The key insight: after each surface's vertices and normals,
// there's a structure that contains face connectivity data.
// Let me trace through Surface 0 in detail.

// Surface 0 at 0x12c0: fc=4 counts=[8,2,3,3] totalVerts=16
// Vertices at 0x12d4 (16 * 12 = 192 bytes)
// Vertices end at 0x1394
// normalCount=13 at 0x1394
// 13 normals * 3 * 4 = 156 bytes of normals at 0x1398-0x1434

const surf0VertEnd = 0x1394;
const surf0NormalEnd = 0x1434;

console.log('\n=== SURFACE 0 DETAIL ===');
console.log('Vertices end at:', '0x' + surf0VertEnd.toString(16));
console.log('Normals end at:', '0x' + surf0NormalEnd.toString(16));

// After normals: the face connectivity structure
// Let me read it as a sequence of u32 values and try to understand the pattern
console.log('\nData after normals (u32 stream):');
let off = surf0NormalEnd;
for (let i = 0; i < 60; i++) {
    const v = dv.getUint32(off + i * 4, true);
    const line = `  [${i.toString().padStart(2)}] @${(off + i*4).toString(16).padStart(5)}: ${v.toString().padStart(8)} (0x${v.toString(16).padStart(8, '0')})`;
    
    // Also try as float32
    const f = dv.getFloat32(off + i * 4, true);
    if (isFinite(f) && Math.abs(f) < 10 && Math.abs(f) > 0.0001) {
        console.log(line + `  float=${f.toFixed(6)}`);
    } else {
        console.log(line);
    }
}

// The pattern after normals for Surface 0:
// 04 00 00 00 = 4 (face count)
// 08 00 00 00 = 8 (face 0 vertex count)
// 02 00 00 00 = 2 (face 1 vertex count)
// 14 00 00 00 = 20 (face 2 vertex count? No, original was 3)
// 
// Wait - 20 doesn't match. Let me re-examine.
// Maybe the structure is:
// u32 faceCount
// u32 face0ByteCount
// u32 face1ByteCount
// u32 face2ByteCount
// u32 face3ByteCount
// Then: per-face data with byte offsets

// Let me check: if face0 has 8 vertices and each vertex is referenced by
// a u16 index pair (edge), then face0 needs 8 * 2 = 16 bytes = 0x10
// But the value is 8, not 16.

// Alternative: the values are the number of EDGES per face
// Face 0: 8 edges
// Face 1: 2 edges
// Face 2: 20 edges? (doesn't match 3 vertices)

// Let me look at this differently. What if after the normals,
// the structure is NOT face counts but something else entirely?

// Let me look at the bytes as a raw hex dump
console.log('\nRaw hex dump after normals:');
for (let row = 0; row < 10; row++) {
    let hex = '', ascii = '';
    for (let col = 0; col < 16; col++) {
        const b = dl[surf0NormalEnd + row * 16 + col];
        hex += b.toString(16).padStart(2, '0') + ' ';
        ascii += (b >= 0x20 && b < 0x7F) ? String.fromCharCode(b) : '.';
    }
    console.log(`  ${(surf0NormalEnd + row * 16).toString(16).padStart(5)}: ${hex} ${ascii}`);
}

// Now let me look at a DIFFERENT surface - Surface 2 at 0x1640
// fc=1 counts=[101] totalVerts=101
// normalCount=805
// This is a large surface with 101 vertices and 805 normals
console.log('\n=== SURFACE 2 DETAIL ===');
const surf2VertStart = 0x1648;
const surf2VertEnd = surf2VertStart + 101 * 12;
const surf2NormalCount = 805;
const surf2NormalEnd = surf2VertEnd + 4 + surf2NormalCount * 3 * 4;
console.log('Vertices:', surf2VertStart.toString(16), '-', surf2VertEnd.toString(16));
console.log('Normals end:', surf2NormalEnd.toString(16));

// After normals for Surface 2
console.log('\nData after Surface 2 normals (u32 stream):');
off = surf2NormalEnd;
for (let i = 0; i < 40; i++) {
    const v = dv.getUint32(off + i * 4, true);
    console.log(`  [${i.toString().padStart(2)}] @${(off + i*4).toString(16).padStart(5)}: ${v.toString().padStart(8)} (0x${v.toString(16).padStart(8, '0')})`);
}

// Key insight: for Surface 2 with 101 vertices, the data after normals
// should contain triangle indices. If the indices are u32 and reference
// the 101 vertices, they should be in range 0-100.
// Let me check if any u32 values in the stream are in this range.

console.log('\n=== SEARCHING FOR TRIANGLE INDICES ===');
// For each surface, after the normals, look for a block of u32 values
// that could be triangle indices (all in range 0..vertexCount-1)

function analyzeAfterNormals(vertEnd, normalCount, totalVerts) {
    const normalEnd = vertEnd + 4 + normalCount * 3 * 4;
    if (normalEnd + 20 > dl.length) return null;
    
    // Read u32 values after normals
    const vals = [];
    for (let i = 0; i < 100 && normalEnd + i * 4 + 4 <= dl.length; i++) {
        vals.push(dv.getUint32(normalEnd + i * 4, true));
    }
    
    // Check if these look like triangle indices
    let validAsIndices = 0;
    for (const v of vals) {
        if (v < totalVerts) validAsIndices++;
    }
    
    // Check if they form valid triangles (groups of 3)
    let validTriangles = 0;
    for (let i = 0; i + 2 < vals.length; i += 3) {
        const a = vals[i], b = vals[i+1], c = vals[i+2];
        if (a < totalVerts && b < totalVerts && c < totalVerts && a !== b && b !== c && a !== c) {
            validTriangles++;
        }
    }
    
    return { normalEnd, vals: vals.slice(0, 30), validAsIndices, validTriangles, totalVerts };
}

// Analyze first few surfaces
const surfaces = [
    { vertEnd: 0x1394, normalCount: 13, totalVerts: 16, name: 'Surface 0' },
    { vertEnd: 0x15bc, normalCount: 0, totalVerts: 31, name: 'Surface 1' },
    { vertEnd: 0x1b04, normalCount: 805, totalVerts: 101, name: 'Surface 2' },
];

for (const s of surfaces) {
    const result = analyzeAfterNormals(s.vertEnd, s.normalCount, s.totalVerts);
    if (result) {
        console.log(`\n${s.name} (${s.totalVerts} verts, ${s.normalCount} normals):`);
        console.log(`  After normals at ${result.normalEnd.toString(16)}:`);
        console.log(`  First 30 u32s: ${result.vals.join(', ')}`);
        console.log(`  Valid as indices (0..${s.totalVerts-1}): ${result.validAsIndices}/${result.vals.length}`);
        console.log(`  Valid triangles: ${result.validTriangles}`);
    }
}

// The REAL question: what if the face vertex counts are NOT polygon vertex counts
// but TRIANGLE counts? And the vertices are stored as indexed (shared)?
// In that case, the vertex array is a local vertex pool, and we need to find
// the triangle index array somewhere after it.

// Let me check: for Surface 0 with counts=[8,2,3,3]:
// If these are triangle counts: 8+2+3+3 = 16 triangles
// Each triangle has 3 indices, so 48 indices needed
// At 4 bytes each = 192 bytes of index data
// But we only have 16 vertices, so indices should be 0-15

// After the 16 vertices (192 bytes) and 13 normals (156 bytes),
// we have 348 bytes of data before the next surface.
// 48 indices * 4 bytes = 192 bytes - this could fit!

// Let me check if the u32 values after normals form valid triangles
console.log('\n=== CHECKING IF COUNTS ARE TRIANGLE COUNTS ===');
const s0normalEnd = 0x1434;
const s0totalVerts = 16;

// Read all u32 values from after normals to next surface
const s0data = [];
for (let i = 0; s0normalEnd + i * 4 < 0x1434 + 200; i++) {
    s0data.push(dv.getUint32(s0normalEnd + i * 4, true));
}

// If the first value is the triangle count (4 faces * ? triangles each)
// Let me try: what if the structure is:
// u32 totalTriangleCount
// u32[] triangleIndices (totalTriangleCount * 3 values)

const maybeTriCount = s0data[0];
console.log(`Maybe triangle count: ${maybeTriCount}`);
if (maybeTriCount > 0 && maybeTriCount < 1000) {
    // Check if next maybeTriCount*3 values are valid indices
    let allValid = true;
    for (let i = 1; i <= maybeTriCount * 3 && i < s0data.length; i++) {
        if (s0data[i] >= s0totalVerts) { allValid = false; break; }
    }
    console.log(`Next ${maybeTriCount * 3} values all valid indices: ${allValid}`);
    
    if (allValid) {
        console.log('FOUND TRIANGLE INDICES!');
        for (let t = 0; t < maybeTriCount; t++) {
            const a = s0data[1 + t * 3];
            const b = s0data[1 + t * 3 + 1];
            const c = s0data[1 + t * 3 + 2];
            console.log(`  Triangle ${t}: ${a}, ${b}, ${c}`);
        }
    }
}

// Try alternative: what if the first few u32s are face metadata,
// and the actual triangle indices start later?
// Let me scan for a block of consecutive u32 values all in range 0..15
console.log('\n=== SCANNING FOR INDEX BLOCKS ===');
for (let start = 0; start < s0data.length - 9; start++) {
    let allInRange = true;
    for (let i = 0; i < 10; i++) {
        if (s0data[start + i] >= s0totalVerts) { allInRange = false; break; }
    }
    if (allInRange) {
        console.log(`Found block of 10+ valid indices starting at offset ${start}:`);
        console.log(`  Values: ${s0data.slice(start, start + 20).join(', ')}`);
    }
}
