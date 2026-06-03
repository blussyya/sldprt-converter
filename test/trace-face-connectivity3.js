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

function u32(off) { return dv.getUint32(off, true); }
function f32(off) { return dv.getFloat32(off, true); }

// Surface 0: fc=4, counts=[8,2,3,3], 16 verts, 13 normals
// Vertices: 0x12D4 - 0x1394
// Normals end: 0x1434

console.log('\n=== DETAILED FACE CONNECTIVITY STRUCTURE ===');

// After normals at 0x1434, let me trace the EXACT structure
const fcStart = 0x1434;
console.log('Face connectivity starts at 0x' + fcStart.toString(16));

// Read and interpret the structure
let pos = fcStart;

// First u32: face count
const fc = u32(pos);
console.log(`[${pos.toString(16)}] faceCount = ${fc}`);
pos += 4;

// Next fc u32s: face vertex counts
const counts = [];
for (let i = 0; i < fc; i++) {
    const c = u32(pos);
    counts.push(c);
    console.log(`[${pos.toString(16)}] faceVertexCount[${i}] = ${c}`);
    pos += 4;
}
console.log(`Face vertex counts: [${counts.join(', ')}]`);
console.log(`Total vertices needed: ${counts.reduce((a,b) => a+b, 0)}`);

// Now: for each face, there should be vertex indices
// But first, let me see what comes next
console.log('\nData after face vertex counts:');
for (let i = 0; i < 30; i++) {
    const o = pos + i * 4;
    if (o + 4 > dl.length) break;
    const v = u32(o);
    console.log(`  [${String(i).padStart(2)}] @${o.toString(16).padStart(5)}: ${v}`);
}

// The pattern after face vertex counts is:
// For each face: (byteOffset, flag) pairs
// Let me check if the byte offsets are relative to the vertex data start

console.log('\n=== TESTING BYTE OFFSET INTERPRETATION ===');
const vertStart = 0x12D4;

// After face vertex counts, we have alternating values
// Let me read them as pairs
let pairPos = pos;
const faceData = [];
for (let i = 0; i < fc; i++) {
    const offset = u32(pairPos);
    const flag = u32(pairPos + 4);
    faceData.push({ offset, flag });
    console.log(`Face ${i}: offset=${offset} (0x${offset.toString(16)}), flag=${flag}`);
    pairPos += 8;
}

// Now let's check: what if the offset is relative to the start of vertex data?
// And what if it points to the START of the face's vertex indices in a global buffer?

console.log('\n=== CHECKING BYTE OFFSET DESTINATIONS ===');
for (let i = 0; i < faceData.length; i++) {
    const { offset, flag } = faceData[i];
    
    // Try relative to vertex start
    const absOff1 = vertStart + offset;
    console.log(`\nFace ${i}: offset ${offset} relative to vertStart (0x${vertStart.toString(16)}):`);
    console.log(`  Absolute: 0x${absOff1.toString(16)}`);
    if (absOff1 + 20 <= dl.length) {
        const vals = [];
        for (let j = 0; j < 5; j++) vals.push(u32(absOff1 + j * 4));
        console.log(`  Values: ${vals.join(', ')}`);
    }
    
    // Try absolute offset
    console.log(`Face ${i}: offset ${offset} as absolute:`);
    if (offset + 20 <= dl.length) {
        const vals = [];
        for (let j = 0; j < 5; j++) vals.push(u32(offset + j * 4));
        console.log(`  Values: ${vals.join(', ')}`);
    }
}

// NEW APPROACH: What if the structure after face vertex counts is:
// For each face: u32 numTriangles, u32[] triangleIndices (groups of 3)
// Let me check if the counts are actually triangle counts per face

console.log('\n=== CHECKING IF COUNTS ARE TRIANGLE COUNTS ===');
// Surface 0 counts: [8, 2, 3, 3]
// If these are triangle counts: 8+2+3+3 = 16 triangles
// Each triangle has 3 indices, so 48 indices needed
// At 4 bytes each = 192 bytes of index data

// Let me check if the data after face vertex counts forms valid triangles
let triStart = pos;
let totalTriangles = 0;
const faceTriangles = [];

for (let fi = 0; fi < fc; fi++) {
    const numTris = counts[fi];
    totalTriangles += numTris;
    
    console.log(`\nFace ${fi}: ${numTris} triangles`);
    const tris = [];
    for (let t = 0; t < numTris; t++) {
        const a = u32(triStart);
        const b = u32(triStart + 4);
        const c = u32(triStart + 8);
        tris.push([a, b, c]);
        console.log(`  Triangle ${t}: ${a}, ${b}, ${c}`);
        triStart += 12;
    }
    faceTriangles.push(tris);
}

console.log(`\nTotal triangles: ${totalTriangles}`);
console.log(`Total indices: ${totalTriangles * 3}`);
console.log(`Data consumed: ${totalTriangles * 3 * 4} bytes`);

// Check if all indices are valid (0-15 for 16 vertices)
let allValid = true;
for (const tris of faceTriangles) {
    for (const [a, b, c] of tris) {
        if (a >= 16 || b >= 16 || c >= 16) {
            allValid = false;
            break;
        }
    }
}
console.log(`All indices valid (0-15): ${allValid}`);

// If not valid, try different interpretations
if (!allValid) {
    console.log('\n=== TRYING ALTERNATIVE INTERPRETATION ===');
    
    // What if the counts are NOT triangle counts but something else?
    // Let me look at the data more carefully
    
    // Reset to start of face data
    triStart = pos;
    
    // What if the structure is:
    // u32 numIndices (total for this face)
    // u32[] indices (numIndices values, forming triangles)
    
    console.log('\nTrying: numIndices per face, then indices...');
    triStart = pos;
    for (let fi = 0; fi < fc; fi++) {
        const numIndices = counts[fi];
        console.log(`\nFace ${fi}: ${numIndices} indices`);
        const indices = [];
        for (let j = 0; j < numIndices; j++) {
            const idx = u32(triStart);
            indices.push(idx);
            triStart += 4;
        }
        console.log(`  Indices: ${indices.join(', ')}`);
        
        // Check if they form valid triangles
        const numTris = Math.floor(numIndices / 3);
        let valid = true;
        for (let t = 0; t < numTris; t++) {
            const a = indices[t*3], b = indices[t*3+1], c = indices[t*3+2];
            if (a >= 16 || b >= 16 || c >= 16) valid = false;
        }
        console.log(`  Forms valid triangles: ${valid}`);
    }
}

// Let me also check: what if the byte offsets (750, 761, 774, 808)
// point to where the INDICES for each face are stored in a global buffer?

console.log('\n=== GLOBAL INDEX BUFFER APPROACH ===');
// The byte offsets from the face data: 750, 761, 774, 808
// What if these point to a global buffer that contains ALL triangle indices?

const byteOffsets = faceData.map(f => f.offset);
console.log('Byte offsets:', byteOffsets.join(', '));

// Check what's at these offsets (as absolute offsets in the DL)
for (let i = 0; i < byteOffsets.length; i++) {
    const bOff = byteOffsets[i];
    console.log(`\nByte offset ${bOff} (0x${bOff.toString(16)}):`);
    if (bOff + 40 <= dl.length) {
        for (let j = 0; j < 10; j++) {
            const v = u32(bOff + j * 4);
            console.log(`  [${j}] ${v}`);
        }
    }
}

// What if the byte offsets are in units of u32 (4 bytes)?
console.log('\n=== TRYING U32 UNITS ===');
for (let i = 0; i < byteOffsets.length; i++) {
    const bOff = byteOffsets[i];
    const absOff = bOff * 4;
    console.log(`\nByte offset ${bOff} * 4 = ${absOff} (0x${absOff.toString(16)}):`);
    if (absOff + 40 <= dl.length) {
        for (let j = 0; j < 10; j++) {
            const v = u32(absOff + j * 4);
            console.log(`  [${j}] ${v}`);
        }
    }
}

// What if the byte offsets are in units of u16 (2 bytes)?
console.log('\n=== TRYING U16 UNITS ===');
for (let i = 0; i < byteOffsets.length; i++) {
    const bOff = byteOffsets[i];
    const absOff = bOff * 2;
    console.log(`\nByte offset ${bOff} * 2 = ${absOff} (0x${absOff.toString(16)}):`);
    if (absOff + 40 <= dl.length) {
        for (let j = 0; j < 10; j++) {
            const v = u32(absOff + j * 4);
            console.log(`  [${j}] ${v}`);
        }
    }
}

// What if the byte offsets are in units of 12 bytes (3 * u32)?
console.log('\n=== TRYING 12-BYTE UNITS ===');
for (let i = 0; i < byteOffsets.length; i++) {
    const bOff = byteOffsets[i];
    const absOff = bOff * 12;
    console.log(`\nByte offset ${bOff} * 12 = ${absOff} (0x${absOff.toString(16)}):`);
    if (absOff + 40 <= dl.length) {
        for (let j = 0; j < 10; j++) {
            const v = u32(absOff + j * 4);
            console.log(`  [${j}] ${v}`);
        }
    }
}

// Let me look at what's at the byte offsets from the trace-format2 output
// The byte offsets were: 750, 761, 774, 808
// From the previous analysis, these were interleaved with 48015 (0xBB8F)
// Let me check if 48015 is a special value

console.log('\n=== ANALYZING 48015 (0xBB8F) PATTERN ===');
// 48015 = 0xBB8F
// In binary: 1011101110001111
// This doesn't look like a standard sentinel value

// But wait - what if the pattern is:
// u16 low, u16 high for each value?
// 750 = 0x02EE, 48015 = 0xBB8F
// Combined as u32: 0xBB8F02EE = 3146711726

// Or maybe the values are actually:
// u16 faceVertexCount, u16 normalIndex?
// 750 = 0x02EE -> faceVertexCount = 0x02EE = 750 (too large)

// Let me reconsider the structure entirely
console.log('\n=== RECONSIDERING STRUCTURE ===');
console.log('What if the structure after normals is:');
console.log('1. u32 faceCount');
console.log('2. For each face: u16 faceVertexCount, u16 normalIndex');
console.log('3. Then: u32[] triangleIndices (global buffer)');

// Let me check if the data at pos (after face vertex counts) fits this
pos = fcStart + 4; // skip face count
const faceDataAlt = [];
for (let i = 0; i < fc; i++) {
    const low = u32(pos);
    const high = u32(pos + 4);
    faceDataAlt.push({ low, high });
    console.log(`Face ${i}: low=${low}, high=${high}`);
    pos += 8;
}

// If low is faceVertexCount and high is normalIndex:
console.log('\nIf low=faceVertexCount, high=normalIndex:');
for (let i = 0; i < faceDataAlt.length; i++) {
    const { low, high } = faceDataAlt[i];
    console.log(`Face ${i}: vertexCount=${low}, normalIndex=${high}`);
}

// But wait - the original counts were [8, 2, 3, 3]
// And the low values are [750, 761, 774, 808]
// These don't match!

// Unless... the low values are BYTE OFFSETS into a different part of the stream
// Let me check if they point to the triangle index data

console.log('\n=== FINAL HYPOTHESIS ===');
console.log('The byte offsets point to TRIANGLE INDEX data in a global buffer.');
console.log('Let me check what triangle indices are stored at those offsets.');

for (let i = 0; i < faceData.length; i++) {
    const { offset, flag } = faceData[i];
    const numTris = counts[i];
    
    console.log(`\nFace ${i}: ${numTris} triangles, offset=${offset}`);
    
    // The offset might be in bytes from the start of a global index buffer
    // Let me search for where this buffer might be
    
    // First, check if offset is relative to the face connectivity block
    const relOff = fcStart + offset;
    console.log(`  Relative to FC start: 0x${relOff.toString(16)}`);
    if (relOff + numTris * 12 <= dl.length) {
        const tris = [];
        for (let t = 0; t < numTris; t++) {
            const a = u32(relOff + t * 12);
            const b = u32(relOff + t * 12 + 4);
            const c = u32(relOff + t * 12 + 8);
            tris.push([a, b, c]);
        }
        console.log(`  Triangles: ${JSON.stringify(tris)}`);
        
        // Check if valid
        let valid = true;
        for (const [a, b, c] of tris) {
            if (a >= 16 || b >= 16 || c >= 16) valid = false;
        }
        console.log(`  Valid indices: ${valid}`);
    }
}
