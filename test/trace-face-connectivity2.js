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

// Surface 0 info (from previous analysis):
// Face count: 4, counts=[8,2,3,3], 16 verts
// Vertices: 0x12D4 - 0x1394
// Normal count: 13 at 0x1394
// Normals end: 0x1434

const s0VertStart = 0x12D4;
const s0VertEnd = 0x1394;
const s0NormalCount = 13;
const s0NormalEnd = 0x1434;

console.log('\n=== SURFACE 0 FACE CONNECTIVITY ANALYSIS ===');
console.log('Vertices: 0x' + s0VertStart.toString(16) + ' - 0x' + s0VertEnd.toString(16));
console.log('Normals end: 0x' + s0NormalEnd.toString(16));

// After normals, the face connectivity structure
// Let me read it very carefully
console.log('\nData after Surface 0 normals (detailed):');
let off = s0NormalEnd;
for (let i = 0; i < 50; i++) {
    const o = off + i * 4;
    if (o + 4 > dl.length) break;
    const v = u32(o);
    const f = f32(o);
    let extra = '';
    if (isFinite(f) && Math.abs(f) > 0.0001 && Math.abs(f) < 100) {
        extra = ` (float=${f.toFixed(6)})`;
    }
    console.log(`  [${String(i).padStart(2)}] @0x${o.toString(16).padStart(5)}: ${v}${extra}`);
}

// The byte offsets we found: 750, 761, 774, 808
// Let me check if they're relative to the start of the vertex data
console.log('\n=== CHECKING IF BYTE OFFSETS ARE RELATIVE TO VERTEX START ===');
const byteOffsets = [750, 761, 774, 808];
for (const bOff of byteOffsets) {
    const absOff = s0VertStart + bOff;
    console.log(`\nByte offset ${bOff} (relative to vert start 0x${s0VertStart.toString(16)}):`);
    console.log(`  Absolute: 0x${absOff.toString(16)}`);
    if (absOff + 40 <= dl.length) {
        for (let i = 0; i < 10; i++) {
            const o = absOff + i * 4;
            const v = u32(o);
            const f = f32(o);
            let extra = '';
            if (isFinite(f) && Math.abs(f) > 0.0001 && Math.abs(f) < 100) {
                extra = ` (float=${f.toFixed(6)})`;
            }
            console.log(`    [${i}] ${v}${extra}`);
        }
    }
}

// Check if byte offsets are relative to the start of the DisplayLists
console.log('\n=== CHECKING IF BYTE OFFSETS ARE ABSOLUTE (from DL start) ===');
for (const bOff of byteOffsets) {
    console.log(`\nByte offset ${bOff} (0x${bOff.toString(16)}):`);
    if (bOff + 40 <= dl.length) {
        for (let i = 0; i < 10; i++) {
            const o = bOff + i * 4;
            const v = u32(o);
            const f = f32(o);
            let extra = '';
            if (isFinite(f) && Math.abs(f) > 0.0001 && Math.abs(f) < 100) {
                extra = ` (float=${f.toFixed(6)})`;
            }
            console.log(`    [${i}] ${v}${extra}`);
        }
    }
}

// Now let me look at Surface 1 which has 7 faces
// Surface 1 is at 0x15f8 (face count), 0x1600 (byte offsets)
// Counts=[8,2,3,4,4,12,1] = 30 verts
console.log('\n\n=== SURFACE 1 ANALYSIS ===');
// Surface 1 starts at 0x15f8 (face count = 7)
// Then at 0x1600: the byte offsets with 48015 interspersed

const s1HeaderOff = 0x15f8;
const s1FaceCount = u32(s1HeaderOff);
console.log('Surface 1 header at 0x' + s1HeaderOff.toString(16));
console.log('Face count:', s1FaceCount);

// Read the byte offset pattern
console.log('\nSurface 1 byte offset pattern:');
for (let i = 0; i < 20; i++) {
    const o = s1HeaderOff + 4 + i * 4;
    if (o + 4 > dl.length) break;
    const v = u32(o);
    console.log(`  [${String(i).padStart(2)}] @0x${o.toString(16).padStart(5)}: ${v}`);
}

// Surface 1 vertex data starts after the header
// Let me find it by looking for the first valid vertex
console.log('\nSearching for Surface 1 vertex data...');
let s1VertStart = -1;
for (let p = s1HeaderOff + 4 + s1FaceCount * 4; p < s1HeaderOff + 500 && p + 12 <= dl.length; p += 4) {
    const x = f32(p), y = f32(p+4), z = f32(p+8);
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) continue;
    const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
    if (ax > 1.0 || ay > 1.0 || az > 1.0) continue;
    if ((ax >= 0.0005 ? 1 : 0) + (ay >= 0.0005 ? 1 : 0) + (az >= 0.0005 ? 1 : 0) < 2) continue;
    
    if (p + 24 <= dl.length) {
        const x2 = f32(p+12), y2 = f32(p+16), z2 = f32(p+20);
        if (!isFinite(x2) || !isFinite(y2) || !isFinite(z2)) continue;
        const ax2 = Math.abs(x2), ay2 = Math.abs(y2), az2 = Math.abs(z2);
        if (ax2 > 1.0 || ay2 > 1.0 || az2 > 1.0) continue;
        if ((ax2 >= 0.0005 ? 1 : 0) + (ay2 >= 0.0005 ? 1 : 0) + (az2 >= 0.0005 ? 1 : 0) < 2) continue;
        
        s1VertStart = p;
        break;
    }
}

if (s1VertStart > 0) {
    console.log('Surface 1 vertices start at 0x' + s1VertStart.toString(16));
    const s1TotalVerts = 30; // 8+2+3+4+4+12+1
    const s1VertEnd = s1VertStart + s1TotalVerts * 12;
    console.log('Surface 1 vertices end at 0x' + s1VertEnd.toString(16));
    
    // Check what's at the byte offsets from Surface 1
    // The byte offsets in the pattern were: 766, 750, 761, 771, 774, 808, 792
    const s1ByteOffsets = [766, 750, 761, 771, 774, 808, 792];
    
    console.log('\nSurface 1 byte offsets (from pattern):');
    for (let i = 0; i < s1ByteOffsets.length; i++) {
        const bOff = s1ByteOffsets[i];
        // Try relative to vertex start
        const absOff = s1VertStart + bOff;
        console.log(`  Face ${i}: byte offset ${bOff} -> 0x${absOff.toString(16)}`);
        if (absOff + 20 <= dl.length) {
            const vals = [];
            for (let j = 0; j < 5; j++) {
                vals.push(u32(absOff + j * 4));
            }
            console.log(`    Values: ${vals.join(', ')}`);
        }
    }
}

// Let me also check: what if the byte offsets are relative to the
// START of the face connectivity block (after normals)?
console.log('\n=== CHECKING IF BYTE OFFSETS ARE RELATIVE TO FACE CONNECTIVITY START ===');
const fcStart = s0NormalEnd;
for (const bOff of byteOffsets) {
    const absOff = fcStart + bOff;
    console.log(`\nByte offset ${bOff} (relative to FC start 0x${fcStart.toString(16)}):`);
    console.log(`  Absolute: 0x${absOff.toString(16)}`);
    if (absOff + 40 <= dl.length) {
        for (let i = 0; i < 10; i++) {
            const o = absOff + i * 4;
            const v = u32(o);
            const f = f32(o);
            let extra = '';
            if (isFinite(f) && Math.abs(f) > 0.0001 && Math.abs(f) < 100) {
                extra = ` (float=${f.toFixed(6)})`;
            }
            console.log(`    [${i}] ${v}${extra}`);
        }
    }
}

// NEW INSIGHT: Look at the data at 0x1600 more carefully
// It shows: 766, 48015, 750, 48015, 761, 48015, 771, 48015, 774, 48015, 808, 48015, 792, 48015
// 48015 = 0xBB8F
// What if 48015 is a sentinel/marker, and the byte offsets are the actual data?
// And what if these byte offsets point to a GLOBAL index buffer?

console.log('\n\n=== SEARCHING FOR GLOBAL INDEX BUFFER ===');
// The byte offsets we've seen: 750, 761, 766, 771, 774, 792, 808
// What if there's a global buffer somewhere in the DisplayLists that contains
// triangle indices, and the byte offsets point into it?

// Let me search for blocks of u32 values that could be triangle indices
// (all in range 0..maxVertsSeen so far)
const maxVerts = 1000; // reasonable upper bound
console.log('Searching for potential index buffer blocks...');

for (let start = 0; start < dl.length - 100; start += 4) {
    // Check if this could be a block of triangle indices
    // Look for: u32 count, then count*3 u32 values all in range 0..maxVerts
    const count = u32(start);
    if (count < 3 || count > 500) continue;
    
    const expectedSize = count * 3;
    if (start + 4 + expectedSize * 4 > dl.length) continue;
    
    let allValid = true;
    for (let i = 0; i < expectedSize; i++) {
        const idx = u32(start + 4 + i * 4);
        if (idx >= maxVerts) { allValid = false; break; }
    }
    
    if (allValid) {
        console.log(`\nFound potential index buffer at 0x${start.toString(16)}:`);
        console.log(`  Triangle count: ${count}`);
        const indices = [];
        for (let i = 0; i < Math.min(expectedSize, 30); i++) {
            indices.push(u32(start + 4 + i * 4));
        }
        console.log(`  First ${Math.min(expectedSize, 30)} indices: ${indices.join(', ')}`);
        
        // Check if these indices reference Surface 0's vertices (0-15)
        let refsS0 = 0;
        for (let i = 0; i < expectedSize; i++) {
            const idx = u32(start + 4 + i * 4);
            if (idx < 16) refsS0++;
        }
        console.log(`  Indices referencing Surface 0 (0-15): ${refsS0}/${expectedSize}`);
    }
}

// Let me also try: what if the byte offsets are in a DIFFERENT unit?
// Like 8-byte records instead of 4-byte?
console.log('\n=== TRYING DIFFERENT RECORD SIZES ===');
for (const bOff of byteOffsets) {
    for (const unitSize of [1, 2, 4, 8, 12, 16]) {
        const absOff = bOff * unitSize;
        if (absOff + 20 > dl.length) continue;
        
        // Check if the values at this offset look like triangle indices
        const vals = [];
        for (let i = 0; i < 5; i++) {
            vals.push(u32(absOff + i * 4));
        }
        
        // Check if they form valid triangles (groups of 3, all < 16)
        let validTris = 0;
        for (let i = 0; i + 2 < vals.length; i += 3) {
            if (vals[i] < 16 && vals[i+1] < 16 && vals[i+2] < 16) validTris++;
        }
        
        if (validTris > 0) {
            console.log(`  Byte offset ${bOff} * unit ${unitSize} = 0x${absOff.toString(16)}: ${vals.join(', ')} (${validTris} valid tris)`);
        }
    }
}
