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

// Helper: read u32 at offset
function u32(off) { return dv.getUint32(off, true); }
function f32(off) { return dv.getFloat32(off, true); }

// First, let's find ALL surfaces by scanning the stream
console.log('\n=== FINDING ALL SURFACES ===');
const surfaces = [];
let scanPos = 96; // After header (8 bytes header + 11*8 metadata = 96)

function tryReadSurface(pos) {
    if (pos + 8 > dl.length) return null;
    const faceCount = u32(pos);
    if (faceCount < 1 || faceCount > 100) return null;
    
    for (let tryOff = 4; tryOff < 200; tryOff += 4) {
        const countStart = pos + tryOff;
        if (countStart + faceCount * 4 > dl.length) break;
        
        const counts = [];
        let ok = true;
        for (let i = 0; i < faceCount; i++) {
            const v = u32(countStart + i * 4);
            if (v < 1 || v > 500) { ok = false; break; }
            counts.push(v);
        }
        if (!ok) continue;
        
        const totalVerts = counts.reduce((a, b) => a + b, 0);
        if (totalVerts < 3 || totalVerts > 5000) continue;
        
        const afterCounts = countStart + faceCount * 4;
        
        // Find vertex data
        let vertStart = -1;
        for (let vp = afterCounts; vp < afterCounts + 500 && vp + 12 <= dl.length; vp += 4) {
            const x = f32(vp), y = f32(vp+4), z = f32(vp+8);
            if (!isFinite(x) || !isFinite(y) || !isFinite(z)) continue;
            const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
            if (ax > 1.0 || ay > 1.0 || az > 1.0) continue;
            if ((ax >= 0.0005 ? 1 : 0) + (ay >= 0.0005 ? 1 : 0) + (az >= 0.0005 ? 1 : 0) < 2) continue;
            
            if (vp + 24 <= dl.length) {
                const x2 = f32(vp+12), y2 = f32(vp+16), z2 = f32(vp+20);
                if (!isFinite(x2) || !isFinite(y2) || !isFinite(z2)) continue;
                const ax2 = Math.abs(x2), ay2 = Math.abs(y2), az2 = Math.abs(z2);
                if (ax2 > 1.0 || ay2 > 1.0 || az2 > 1.0) continue;
                if ((ax2 >= 0.0005 ? 1 : 0) + (ay2 >= 0.0005 ? 1 : 0) + (az2 >= 0.0005 ? 1 : 0) < 2) continue;
                
                vertStart = vp;
                break;
            }
        }
        
        if (vertStart < 0) continue;
        
        const verts = [];
        let p = vertStart;
        while (p + 12 <= dl.length && verts.length < totalVerts) {
            const x = f32(p), y = f32(p+4), z = f32(p+8);
            if (!isFinite(x) || !isFinite(y) || !isFinite(z)) break;
            if (Math.abs(x) > 1.0 || Math.abs(y) > 1.0 || Math.abs(z) > 1.0) break;
            if (Math.abs(x) < 0.0005 && Math.abs(y) < 0.0005 && Math.abs(z) < 0.0005) break;
            verts.push([x, y, z]);
            p += 12;
        }
        
        if (verts.length < Math.floor(totalVerts * 0.7)) continue;
        
        return {
            headerOffset: pos,
            faceCountOffset: countStart,
            vertOffset: vertStart,
            counts,
            totalVerts,
            verts,
        };
    }
    return null;
}

while (scanPos + 20 <= dl.length) {
    const surf = tryReadSurface(scanPos);
    if (surf) {
        surfaces.push(surf);
        scanPos = surf.vertOffset + surf.verts.length * 12;
    } else {
        scanPos += 4;
    }
}

console.log(`Found ${surfaces.length} surfaces`);

// Now, for each surface, trace the data AFTER vertices to find normals and face connectivity
console.log('\n=== DETAILED SURFACE ANALYSIS ===');

for (let si = 0; si < Math.min(surfaces.length, 5); si++) {
    const s = surfaces[si];
    console.log(`\n--- Surface ${si} ---`);
    console.log(`  Header @ 0x${s.headerOffset.toString(16)}`);
    console.log(`  Face count: ${s.faceCount}`);
    console.log(`  Face vertex counts: [${s.counts.join(', ')}]`);
    console.log(`  Total vertices: ${s.totalVerts}`);
    console.log(`  Vertices @ 0x${s.vertOffset.toString(16)} - 0x${(s.vertOffset + s.totalVerts * 12).toString(16)}`);
    
    const vertEnd = s.vertOffset + s.totalVerts * 12;
    
    // After vertices: normalCount (u32), then normals (xyz float32 triples)
    if (vertEnd + 4 <= dl.length) {
        const normalCount = u32(vertEnd);
        console.log(`  Normal count: ${normalCount}`);
        
        if (normalCount > 0 && normalCount < 10000) {
            const normalEnd = vertEnd + 4 + normalCount * 3 * 4;
            console.log(`  Normals end @ 0x${normalEnd.toString(16)}`);
            
            // Now trace the face connectivity structure after normals
            console.log(`  Data after normals:`);
            for (let i = 0; i < 30 && normalEnd + i * 4 + 4 <= dl.length; i++) {
                const off = normalEnd + i * 4;
                const v = u32(off);
                const f = f32(off);
                let line = `    [${String(i).padStart(2)}] @0x${off.toString(16).padStart(5)}: u32=${String(v).padStart(10)}`;
                if (isFinite(f) && Math.abs(f) > 0.0001 && Math.abs(f) < 100) {
                    line += `  f32=${f.toFixed(6)}`;
                }
                console.log(line);
            }
        } else {
            console.log(`  Normal count out of range, skipping`);
        }
    }
}

// Deep dive into Surface 0's face connectivity
console.log('\n=== SURFACE 0 DEEP DIVE ===');
const s0 = surfaces[0];
const vertEnd0 = s0.vertOffset + s0.totalVerts * 12;
const normalCount0 = u32(vertEnd0);
const normalEnd0 = vertEnd0 + 4 + normalCount0 * 3 * 4;

console.log(`Surface 0: ${s0.faceCount} faces, counts=[${s0.counts.join(',')}], ${s0.totalVerts} verts`);
console.log(`Vertices: 0x${s0.vertOffset.toString(16)} - 0x${vertEnd0.toString(16)}`);
console.log(`Normals: 0x${(vertEnd0+4).toString(16)} - 0x${normalEnd0.toString(16)} (${normalCount0} normals)`);

// Read the face connectivity block
const fcBlockStart = normalEnd0;
const fcBlock = [];
for (let i = 0; i < 40; i++) {
    if (fcBlockStart + i * 4 + 4 > dl.length) break;
    fcBlock.push(u32(fcBlockStart + i * 4));
}

console.log('\nFace connectivity block (first 40 u32s):');
for (let i = 0; i < fcBlock.length; i++) {
    const off = fcBlockStart + i * 4;
    console.log(`  [${String(i).padStart(2)}] @0x${off.toString(16).padStart(5)}: ${fcBlock[i]}`);
}

// The byte offsets we found: 750, 761, 774, 808
// Let me check what's at those offsets in the DisplayLists
console.log('\n=== CHECKING BYTE OFFSET DESTINATIONS ===');
const byteOffsets = [750, 761, 774, 808];
for (const bOff of byteOffsets) {
    console.log(`\nByte offset ${bOff} (0x${bOff.toString(16)}):`);
    if (bOff + 40 <= dl.length) {
        for (let i = 0; i < 10; i++) {
            const off = bOff + i * 4;
            const v = u32(off);
            const f = f32(off);
            let line = `  [${i}] @0x${off.toString(16).padStart(5)}: u32=${String(v).padStart(10)}`;
            if (isFinite(f) && Math.abs(f) > 0.0001 && Math.abs(f) < 100) {
                line += `  f32=${f.toFixed(6)}`;
            }
            console.log(line);
        }
    }
}

// Now let's look at the structure differently.
// What if the byte offsets are RELATIVE to the start of the face connectivity block?
console.log('\n=== TESTING RELATIVE OFFSETS ===');
for (const bOff of byteOffsets) {
    const absOff = fcBlockStart + bOff;
    console.log(`\nRelative offset ${bOff} -> absolute 0x${absOff.toString(16)}:`);
    if (absOff + 40 <= dl.length) {
        for (let i = 0; i < 8; i++) {
            const off = absOff + i * 4;
            const v = u32(off);
            const f = f32(off);
            let line = `  [${i}] u32=${String(v).padStart(10)}`;
            if (isFinite(f) && Math.abs(f) > 0.0001 && Math.abs(f) < 100) {
                line += `  f32=${f.toFixed(6)}`;
            }
            console.log(line);
        }
    }
}

// Let me also check: what if the byte offsets are relative to the start of vertex data?
console.log('\n=== TESTING OFFSETS RELATIVE TO VERTEX START ===');
for (const bOff of byteOffsets) {
    const absOff = s0.vertOffset + bOff;
    console.log(`\nRelative to vert start (${bOff}) -> absolute 0x${absOff.toString(16)}:`);
    if (absOff + 40 <= dl.length) {
        for (let i = 0; i < 8; i++) {
            const off = absOff + i * 4;
            const v = u32(off);
            const f = f32(off);
            let line = `  [${i}] u32=${String(v).padStart(10)}`;
            if (isFinite(f) && Math.abs(f) > 0.0001 && Math.abs(f) < 100) {
                line += `  f32=${f.toFixed(6)}`;
            }
            console.log(line);
        }
    }
}

// Let me look at the complete structure between surfaces
// Surface 0 header to Surface 1 header
if (surfaces.length > 1) {
    const s1 = surfaces[1];
    console.log('\n=== DATA BETWEEN SURFACE 0 AND SURFACE 1 ===');
    console.log(`Surface 0 header: 0x${s0.headerOffset.toString(16)}`);
    console.log(`Surface 1 header: 0x${s1.headerOffset.toString(16)}`);
    
    // Find the face connectivity structure
    // After Surface 0's normals, we expect:
    // - Face connectivity data
    // - Possibly padding or alignment
    // - Then Surface 1's header
    
    const gapStart = normalEnd0;
    const gapEnd = s1.headerOffset;
    const gapSize = gapEnd - gapStart;
    console.log(`Gap between Surface 0 normals end and Surface 1 header: ${gapSize} bytes`);
    
    // Read all data in the gap
    console.log('\nGap data (u32s):');
    for (let i = 0; i * 4 < gapSize; i++) {
        const off = gapStart + i * 4;
        const v = u32(off);
        console.log(`  [${String(i).padStart(2)}] @0x${off.toString(16).padStart(5)}: ${v} (0x${v.toString(16).padStart(8, '0')})`);
    }
}
