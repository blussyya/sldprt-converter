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

// Step 1: Parse ALL surfaces and collect their vertex data
const surfaces = [];
let scanOff = 0x60;

// Skip MFC class header
while (scanOff < dl.length - 4) {
    const b0 = dl[scanOff], b1 = dl[scanOff + 1];
    if (b0 === 0xFF && (b1 === 0xFF || b1 === 0xFE)) {
        if (b1 === 0xFF) {
            // New class: FF FF id_lo id_hi nameLen_lo nameLen_hi name...
            if (scanOff + 6 > dl.length) break;
            const nameLen = dv.getUint16(scanOff + 4, true);
            scanOff += 6 + nameLen;
        } else {
            // Backref: FF FE ref_lo ref_hi
            scanOff += 4;
        }
    } else {
        break; // End of MFC classes, start of data
    }
}

console.log('Data starts at: 0x' + scanOff.toString(16));

// Step 2: Now parse surfaces with full structure understanding
// Each surface: [u32 faceCount] [u32[] faceVertexCounts] [float32[] vertices] [u32 normalCount] [normals] [??? connectivity]

function parseSurfaces(startOff) {
    const result = [];
    let off = startOff;
    
    while (off + 8 < dl.length) {
        const fc = dv.getUint32(off, true);
        if (fc < 1 || fc > 100) { off += 4; continue; }
        
        const counts = [];
        let ok = true;
        for (let i = 0; i < fc; i++) {
            if (off + 4 + (i + 1) * 4 > dl.length) { ok = false; break; }
            const c = dv.getUint32(off + 4 + i * 4, true);
            if (c < 1 || c > 5000) { ok = false; break; }
            counts.push(c);
        }
        if (!ok || counts.length !== fc) { off += 4; continue; }
        
        let totalV = 0;
        for (const c of counts) totalV += c;
        const vStart = off + 4 + fc * 4;
        if (vStart + totalV * 12 > dl.length) { off += 4; continue; }
        
        // Validate first vertex
        const x0 = dv.getFloat32(vStart, true);
        const y0 = dv.getFloat32(vStart + 4, true);
        const z0 = dv.getFloat32(vStart + 8, true);
        if (!isFinite(x0) || !isFinite(y0) || !isFinite(z0) || Math.abs(x0) > 10 || Math.abs(y0) > 10 || Math.abs(z0) > 10) {
            off += 4; continue;
        }
        
        // Validate last vertex
        const lastV = vStart + (totalV - 1) * 12;
        const xL = dv.getFloat32(lastV, true);
        const yL = dv.getFloat32(lastV + 4, true);
        const zL = dv.getFloat32(lastV + 8, true);
        if (!isFinite(xL) || !isFinite(yL) || !isFinite(zL) || Math.abs(xL) > 10 || Math.abs(yL) > 10 || Math.abs(zL) > 10) {
            off += 4; continue;
        }
        
        const vertEnd = vStart + totalV * 12;
        
        // Read vertices
        const vertices = [];
        for (let i = 0; i < totalV; i++) {
            vertices.push([
                dv.getFloat32(vStart + i * 12, true),
                dv.getFloat32(vStart + i * 12 + 4, true),
                dv.getFloat32(vStart + i * 12 + 8, true)
            ]);
        }
        
        // After vertices: normalCount u32, then normals
        let normalCount = 0;
        let normalEnd = vertEnd;
        if (vertEnd + 4 <= dl.length) {
            normalCount = dv.getUint32(vertEnd, true);
            if (normalCount > 0 && normalCount < 10000) {
                // Normals could be stored as float32 xyz triples
                const normalsEnd = vertEnd + 4 + normalCount * 12;
                if (normalsEnd <= dl.length) {
                    // Validate first normal
                    const nx = dv.getFloat32(vertEnd + 4, true);
                    const ny = dv.getFloat32(vertEnd + 8, true);
                    const nz = dv.getFloat32(vertEnd + 12, true);
                    if (isFinite(nx) && isFinite(ny) && isFinite(nz) && Math.abs(nx) <= 1.1 && Math.abs(ny) <= 1.1 && Math.abs(nz) <= 1.1) {
                        normalEnd = normalsEnd;
                    }
                }
            }
        }
        
        result.push({
            offset: off,
            fc,
            counts,
            vertStart: vStart,
            totalVerts: totalV,
            vertices,
            normalCount,
            normalEnd,
            dataStart: normalEnd // Data after normals = connectivity info?
        });
        
        off = normalEnd;
    }
    
    return result;
}

const allSurfaces = parseSurfaces(scanOff);
console.log('Total surfaces:', allSurfaces.length);

// Step 3: Analyze the data after normals for each surface
console.log('\n=== CONNECTIVITY DATA ANALYSIS ===');
for (let si = 0; si < Math.min(allSurfaces.length, 10); si++) {
    const s = allSurfaces[si];
    const ds = s.dataStart;
    
    if (ds + 4 > dl.length) continue;
    
    // Read u32s after the normals
    const u32s = [];
    for (let i = 0; i < 20 && ds + i * 4 + 4 <= dl.length; i++) {
        u32s.push(dv.getUint32(ds + i * 4, true));
    }
    
    console.log(`\nSurface ${si} (fc=${s.fc}, verts=${s.totalVerts}) at 0x${s.offset.toString(16)}:`);
    console.log(`  counts: [${s.counts.join(',')}]`);
    console.log(`  normalCount: ${s.normalCount}`);
    console.log(`  data after normals: [${u32s.slice(0, 15).join(', ')}]`);
    
    // Check if the first few u32s match the face counts (repeated?)
    if (u32s[0] === s.fc) {
        console.log(`  → First u32 matches faceCount!`);
    }
    
    // Check if u32s could be vertex indices (should be < totalVerts)
    let allValidIndices = true;
    for (let i = 0; i < Math.min(u32s.length, 10); i++) {
        if (u32s[i] >= s.totalVerts * 100) { allValidIndices = false; break; }
    }
    if (allValidIndices) {
        console.log(`  → Could be vertex indices`);
    }
}

// Step 4: The GLOBAL VERTEX POOL approach
// Find the largest contiguous block of valid float32 vertices
console.log('\n=== GLOBAL VERTEX POOL SEARCH ===');
let bestStart = 0, bestCount = 0;
let curStart = 0, curCount = 0;

for (let off = 0; off + 12 <= dl.length; off += 4) {
    const x = dv.getFloat32(off, true);
    const y = dv.getFloat32(off + 4, true);
    const z = dv.getFloat32(off + 8, true);
    
    if (isFinite(x) && isFinite(y) && isFinite(z) && 
        Math.abs(x) < 10 && Math.abs(y) < 10 && Math.abs(z) < 10 &&
        (Math.abs(x) > 0.0001 || Math.abs(y) > 0.0001 || Math.abs(z) > 0.0001)) {
        if (curCount === 0) curStart = off;
        curCount++;
    } else {
        if (curCount > bestCount) { bestStart = curStart; bestCount = curCount; }
        curCount = 0;
    }
}
if (curCount > bestCount) { bestStart = curStart; bestCount = curCount; }

console.log('Largest non-zero vertex block:', bestCount, 'vertices at 0x' + bestStart.toString(16));

// Show first and last few vertices
console.log('First 5:');
for (let i = 0; i < 5; i++) {
    console.log(`  v${i}: (${dv.getFloat32(bestStart + i*12, true).toFixed(4)}, ${dv.getFloat32(bestStart + i*12+4, true).toFixed(4)}, ${dv.getFloat32(bestStart + i*12+8, true).toFixed(4)})`);
}
console.log('Last 5:');
for (let i = bestCount - 5; i < bestCount; i++) {
    console.log(`  v${i}: (${dv.getFloat32(bestStart + i*12, true).toFixed(4)}, ${dv.getFloat32(bestStart + i*12+4, true).toFixed(4)}, ${dv.getFloat32(bestStart + i*12+8, true).toFixed(4)})`);
}

// Step 5: Check if surface vertices match positions in the global pool
console.log('\n=== CHECKING VERTEX MATCHES ===');
const globalVerts = [];
for (let i = 0; i < bestCount; i++) {
    globalVerts.push([
        dv.getFloat32(bestStart + i * 12, true),
        dv.getFloat32(bestStart + i * 12 + 4, true),
        dv.getFloat32(bestStart + i * 12 + 8, true)
    ]);
}

// For first surface, check if its vertices exist in the global pool
const s0 = allSurfaces[0];
console.log(`Surface 0 has ${s0.totalVerts} vertices`);
let matched = 0;
for (let i = 0; i < s0.totalVerts; i++) {
    const [sx, sy, sz] = s0.vertices[i];
    let found = false;
    for (let j = 0; j < globalVerts.length; j++) {
        const [gx, gy, gz] = globalVerts[j];
        if (Math.abs(sx - gx) < 0.0001 && Math.abs(sy - gy) < 0.0001 && Math.abs(sz - gz) < 0.0001) {
            found = true;
            matched++;
            break;
        }
    }
}
console.log(`Matched ${matched}/${s0.totalVerts} vertices in global pool`);

// Step 6: Now let's look at the REAL structure
// Maybe the format is: per-face data includes INDEXED TRIANGLES
// The face vertex counts might actually be the number of TRIANGLES per face
// And the vertices are stored as triplets (one per triangle)

console.log('\n=== TESTING TRIANGLE HYPOTHESIS ===');
for (let si = 0; si < Math.min(allSurfaces.length, 5); si++) {
    const s = allSurfaces[si];
    // If counts are triangle counts, total vertices = sum(counts) * 3
    const triVerts = s.counts.reduce((a, b) => a + b, 0) * 3;
    console.log(`Surface ${si}: fc=${s.fc} counts=[${s.counts.join(',')}] actualVerts=${s.totalVerts} triVerts=${triVerts} match=${triVerts === s.totalVerts}`);
}
