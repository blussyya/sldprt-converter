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
if (!dl) { console.log('No DisplayLists found'); process.exit(1); }

const dv = new DataView(dl.buffer, dl.byteOffset, dl.byteLength);
console.log('DisplayLists size:', dl.length, 'bytes');

// Let's trace through the first surface in detail
// Surface at 0x12c0: fc=4 counts=[8,2,3,3]
const surfOff = 0x12c0;
console.log('\n=== SURFACE AT 0x' + surfOff.toString(16) + ' ===');

// Read fc and counts
const fc = dv.getUint32(surfOff, true);
const counts = [];
for (let i = 0; i < fc; i++) {
    counts.push(dv.getUint32(surfOff + 4 + i * 4, true));
}
console.log('faceCount:', fc, 'counts:', counts);

const totalVerts = counts.reduce((a, b) => a + b, 0);
const vertStart = surfOff + 4 + fc * 4;
const vertEnd = vertStart + totalVerts * 12;
console.log('vertStart: 0x' + vertStart.toString(16), 'vertEnd: 0x' + vertEnd.toString(16));

// Read all vertices
console.log('\nAll vertices:');
let vi = 0;
for (let f = 0; f < fc; f++) {
    console.log(`  Face ${f} (${counts[f]} verts):`);
    for (let j = 0; j < counts[f]; j++) {
        const x = dv.getFloat32(vertEnd - totalVerts * 12 + vi * 12, true);
        const y = dv.getFloat32(vertEnd - totalVerts * 12 + vi * 12 + 4, true);
        const z = dv.getFloat32(vertEnd - totalVerts * 12 + vi * 12 + 8, true);
        console.log(`    v${vi}: (${x.toFixed(6)}, ${y.toFixed(6)}, ${z.toFixed(6)})`);
        vi++;
    }
}

// Now trace what comes after the vertices
console.log('\n=== DATA AFTER VERTICES (0x' + vertEnd.toString(16) + ') ===');
let off = vertEnd;

// Read u32s and try to interpret
console.log('u32 stream:');
for (let i = 0; i < 40; i++) {
    const v = dv.getUint32(off + i * 4, true);
    const vHex = '0x' + v.toString(16).padStart(8, '0');
    console.log(`  [${i}] @0x${(off + i*4).toString(16)}: ${v} ${vHex}`);
}

// Let's try a completely different approach
// The SolidWorks API uses FaceTessData which has a specific binary layout
// Let's look for the pattern: faceCount u32, then per face: vertexCount u32, then vertices
// But also look for INDEX DATA that maps faces to a global vertex pool

// Actually, let me look at the ENTIRE stream structure
// by dumping large sections as different interpretations

console.log('\n=== LOOKING FOR GLOBAL VERTEX POOL ===');
// The stream might have: [header] [per-surface data] [global vertex pool] [global index pool]
// Or: [per-surface: header + vertex pool + index pool]

// Let's look for the largest contiguous block of valid float32 vertices
let bestRun = { start: 0, count: 0 };
let curRun = { start: 0, count: 0 };

for (let off = 0; off + 12 <= dl.length; off += 4) {
    const x = dv.getFloat32(off, true);
    const y = dv.getFloat32(off + 4, true);
    const z = dv.getFloat32(off + 8, true);
    
    if (isFinite(x) && isFinite(y) && isFinite(z) && 
        Math.abs(x) < 10 && Math.abs(y) < 10 && Math.abs(z) < 10) {
        if (curRun.count === 0) curRun.start = off;
        curRun.count++;
    } else {
        if (curRun.count > bestRun.count) bestRun = { ...curRun };
        curRun = { start: 0, count: 0 };
    }
}
if (curRun.count > bestRun.count) bestRun = { ...curRun };

console.log('Largest vertex block:', bestRun.count, 'vertices at 0x' + bestRun.start.toString(16));
console.log('  First vertex:', 
    dv.getFloat32(bestRun.start, true).toFixed(4),
    dv.getFloat32(bestRun.start + 4, true).toFixed(4),
    dv.getFloat32(bestRun.start + 8, true).toFixed(4));
console.log('  Last vertex:',
    dv.getFloat32(bestRun.start + (bestRun.count-1) * 12, true).toFixed(4),
    dv.getFloat32(bestRun.start + (bestRun.count-1) * 12 + 4, true).toFixed(4),
    dv.getFloat32(bestRun.start + (bestRun.count-1) * 12 + 8, true).toFixed(4));

// The total unique vertices should be around 540 (from the production extractor)
// If the largest block is much larger, it's the global pool
// If it's smaller, vertices are per-surface

// Let's also check: are the same vertex positions repeated across surfaces?
console.log('\n=== CHECKING FOR VERTEX SHARING ===');
// Collect all vertices from all surfaces
const allSurfaces = [];
let scanOff = 0x60;
while (scanOff + 8 < dl.length) {
    const fc = dv.getUint32(scanOff, true);
    if (fc < 1 || fc > 50) { scanOff += 4; continue; }
    
    const counts = [];
    let ok = true;
    for (let i = 0; i < fc; i++) {
        if (scanOff + 4 + i * 4 + 4 > dl.length) { ok = false; break; }
        const c = dv.getUint32(scanOff + 4 + i * 4, true);
        if (c < 1 || c > 500) { ok = false; break; }
        counts.push(c);
    }
    if (!ok || counts.length !== fc) { scanOff += 4; continue; }
    
    let totalV = 0;
    for (const c of counts) totalV += c;
    const vStart = scanOff + 4 + fc * 4;
    if (vStart + totalV * 12 > dl.length) { scanOff += 4; continue; }
    
    // Check first vertex
    const x = dv.getFloat32(vStart, true);
    const y = dv.getFloat32(vStart + 4, true);
    const z = dv.getFloat32(vStart + 8, true);
    if (!isFinite(x) || !isFinite(y) || !isFinite(z) || Math.abs(x) > 10) { scanOff += 4; continue; }
    
    allSurfaces.push({ offset: scanOff, fc, counts, vertStart: vStart, totalVerts: totalV });
    scanOff = vStart + totalV * 12;
}

console.log('Total surfaces found:', allSurfaces.length);

// Count total vertices across all surfaces
let totalAllVerts = 0;
for (const s of allSurfaces) totalAllVerts += s.totalVerts;
console.log('Total vertices (with duplication):', totalAllVerts);

// Check if vertices are shared by comparing first vertices of adjacent surfaces
let sharedCount = 0;
for (let i = 0; i < allSurfaces.length - 1; i++) {
    const s1 = allSurfaces[i];
    const s2 = allSurfaces[i + 1];
    
    // Last vertex of s1 vs first vertex of s2
    const lastOff = s1.vertStart + (s1.totalVerts - 1) * 12;
    const firstOff = s2.vertStart;
    
    const x1 = dv.getFloat32(lastOff, true), y1 = dv.getFloat32(lastOff + 4, true), z1 = dv.getFloat32(lastOff + 8, true);
    const x2 = dv.getFloat32(firstOff, true), y2 = dv.getFloat32(firstOff + 4, true), z2 = dv.getFloat32(firstOff + 8, true);
    
    if (Math.abs(x1 - x2) < 0.0001 && Math.abs(y1 - y2) < 0.0001 && Math.abs(z1 - z2) < 0.0001) {
        sharedCount++;
    }
}
console.log('Shared vertices between adjacent surfaces:', sharedCount, 'of', allSurfaces.length - 1);

// The key insight: if vertices are NOT shared between surfaces,
// then each surface is independent and the face counts ARE the vertex counts per face
// The triangle fan approach would be correct for convex faces
// But for non-convex faces, we need the actual triangle connectivity

// Let's check: what if the face vertex counts are actually the number of TRIANGLES per face?
// For a quad, you'd have 2 triangles. For a complex face, you might have many.
console.log('\n=== CHECKING IF COUNTS REPRESENT TRIANGLES ===');
for (let i = 0; i < Math.min(allSurfaces.length, 5); i++) {
    const s = allSurfaces[i];
    console.log(`Surface ${i}: fc=${s.fc} counts=[${s.counts.join(',')}] totalVerts=${s.totalVerts}`);
}

// If counts are triangle counts, then vertices are stored as triplets (3 per triangle)
// totalVerts should be sum(counts) * 3
// Let's check: for surface 0 with counts [8,2,3,3], if counts are triangle counts:
// totalVerts = (8+2+3+3) * 3 = 48, but we have 16 vertices
// That doesn't match.

// If counts are vertex counts per face (as we assumed):
// totalVerts = 8+2+3+3 = 16, which matches
// But 8 vertices per face is unusual unless it's a polygon

// Actually, maybe the faces are POLYGONS, not triangles
// A polygon with 8 vertices would be rendered as a triangle fan or triangle strip
// But the SolidWorks API uses indexed triangles...

// Let me look at this from a different angle
// What if the data structure is:
// [u32 faceCount] [u32[] faceVertexCounts] [float32[] vertexPositions] [u16[] faceIndices] [float32[] normals]
// And the face indices tell us which vertices form each triangle?

// For surface 0: 4 faces, 16 vertices total
// If face 0 has 8 vertices, and we need triangle indices...
// Maybe after the 16 vertices, there are indices like: 0,1,2, 0,2,3, 0,3,4, 0,4,5, 0,5,6, 0,6,7
// That's 6 triangles * 3 indices = 18 u16 values

// Let's check what's at vertEnd for surface 0
console.log('\n=== DETAILED DATA AFTER SURFACE 0 VERTICES ===');
const s0 = allSurfaces[0];
const s0vertEnd = s0.vertStart + s0.totalVerts * 12;
console.log('Surface 0 vertEnd: 0x' + s0vertEnd.toString(16));

// Dump 300 bytes
for (let i = 0; i < 300 && s0vertEnd + i < dl.length; i += 4) {
    const u32 = dv.getUint32(s0vertEnd + i, true);
    const f64 = (i % 8 === 0 && s0vertEnd + i + 8 <= dl.length) ? dv.getFloat64(s0vertEnd + i, true) : null;
    const u16a = dv.getUint16(s0vertEnd + i, true);
    const u16b = (s0vertEnd + i + 2 < dl.length) ? dv.getUint16(s0vertEnd + i + 2, true) : null;
    
    let line = `@${(s0vertEnd + i).toString(16).padStart(5)}: u32=${u32.toString().padStart(10)} u16=[${u16a.toString().padStart(5)}, ${u16b !== null ? u16b.toString().padStart(5) : '-----'}]`;
    if (f64 !== null) line += ` f64=${f64.toFixed(4)}`;
    console.log(line);
}
