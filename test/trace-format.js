#!/usr/bin/env node
'use strict';
const fs = require('fs');
const pako = require('pako');
const path = require('path');

// Decompress DisplayLists from modern SLDPRT
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

// ============================================================
// STEP 1: Parse MFC class definitions
// ============================================================
console.log('\n========== STEP 1: MFC CLASS DEFINITIONS ==========');
let pos = 0x60;
const classNames = {};
while (pos < dl.length - 6) {
    if (dl[pos] === 0xFF && dl[pos+1] === 0xFF) {
        const classId = dv.getUint16(pos + 2, true);
        const nameLen = dv.getUint16(pos + 4, true);
        if (nameLen > 200 || pos + 6 + nameLen > dl.length) break;
        let name = '';
        for (let k = 0; k < nameLen; k++) {
            const ch = dl[pos + 6 + k];
            name += (ch >= 0x20 && ch < 0x7F) ? String.fromCharCode(ch) : '?';
        }
        classNames[classId] = name;
        console.log(`  @${hex(pos)}: class ${classId} "${name}" (${nameLen} bytes)`);
        pos += 6 + nameLen;
    } else if (dl[pos] === 0xFF && dl[pos+1] === 0xFE) {
        const refId = dv.getUint16(pos + 2, true);
        console.log(`  @${hex(pos)}: backref class ${refId}`);
        pos += 4;
    } else {
        break;
    }
}
console.log(`  Data starts at: ${hex(pos)}`);

// ============================================================
// STEP 2: Parse the serialized object data
// The MFC serialization format for SolidWorks DisplayLists:
// After class definitions, objects are serialized in schema order.
// Each object starts with either:
//   FF FF = new class instance
//   FF FE = backref to existing class
// followed by the class's serialized data
// ============================================================
console.log('\n========== STEP 2: SERIALIED OBJECT DATA ==========');

// Let's trace through the first 2000 bytes of data after MFC classes
// to understand the structure
let dataPos = pos;
let objectCount = 0;

while (dataPos < dl.length && dataPos < pos + 5000) {
    const b0 = dl[dataPos], b1 = dl[dataPos + 1];
    
    if (b0 === 0xFF && b1 === 0xFF) {
        // New class instance
        const classId = dv.getUint16(dataPos + 2, true);
        console.log(`  @${hex(dataPos)}: NEW class ${classId} (${classNames[classId] || '?'})`);
        dataPos += 4;
        objectCount++;
    } else if (b0 === 0xFF && b1 === 0xFE) {
        // Backref
        const refId = dv.getUint16(dataPos + 2, true);
        console.log(`  @${hex(dataPos)}: BACKREF class ${refId} (${classNames[refId] || '?'})`);
        dataPos += 4;
        objectCount++;
    } else {
        // This is serialized data for the current object
        // Let's dump the next 64 bytes to understand the format
        console.log(`  @${hex(dataPos)}: DATA (${b0.toString(16)} ${b1.toString(16)} ...)`);
        
        // Try to interpret the data
        // Look for patterns: u32 counts, float32 coordinates, u16 indices
        
        // Check if this looks like a face count (small u32)
        const maybeCount = dv.getUint32(dataPos, true);
        if (maybeCount > 0 && maybeCount < 100) {
            console.log(`    Maybe count: ${maybeCount}`);
            
            // Check what follows
            const next1 = dv.getUint32(dataPos + 4, true);
            const next2 = dv.getUint32(dataPos + 8, true);
            const next3 = dv.getUint32(dataPos + 12, true);
            console.log(`    Next u32s: ${next1}, ${next2}, ${next3}`);
            
            // Check if next values could be face vertex counts
            if (next1 > 0 && next1 < 500 && next2 > 0 && next2 < 500) {
                console.log(`    -> Could be face vertex counts!`);
            }
            
            // Check if this could be a normal count followed by normals
            if (maybeCount > 0 && maybeCount < 1000) {
                const floatCheck = dv.getFloat32(dataPos + 4, true);
                if (isFinite(floatCheck) && Math.abs(floatCheck) < 2) {
                    console.log(`    -> Could be normal count + normals (float: ${floatCheck})`);
                }
            }
        }
        
        // Check if this looks like float32 vertex data
        const fx = dv.getFloat32(dataPos, true);
        const fy = dv.getFloat32(dataPos + 4, true);
        const fz = dv.getFloat32(dataPos + 8, true);
        if (isFinite(fx) && isFinite(fy) && isFinite(fz) && 
            Math.abs(fx) < 1 && Math.abs(fy) < 1 && Math.abs(fz) < 1 &&
            (Math.abs(fx) > 0.0001 || Math.abs(fy) > 0.0001 || Math.abs(fz) > 0.0001)) {
            console.log(`    -> Float32 vertex: (${fx.toFixed(4)}, ${fy.toFixed(4)}, ${fz.toFixed(4)})`);
        }
        
        // Check if this looks like u16 index data
        const u16a = dv.getUint16(dataPos, true);
        const u16b = dv.getUint16(dataPos + 2, true);
        const u16c = dv.getUint16(dataPos + 4, true);
        if (u16a < 500 && u16b < 500 && u16c < 500) {
            console.log(`    -> u16 indices: ${u16a}, ${u16b}, ${u16c}`);
        }
        
        // Dump 64 bytes
        let hexLine = '    Hex: ';
        for (let i = 0; i < 64 && dataPos + i < dl.length; i++) {
            hexLine += dl[dataPos + i].toString(16).padStart(2, '0') + ' ';
            if ((i + 1) % 16 === 0) hexLine += '\n         ';
        }
        console.log(hexLine);
        
        break; // Stop after first data block for analysis
    }
}

// ============================================================
// STEP 3: Find ALL surfaces and trace their complete structure
// ============================================================
console.log('\n========== STEP 3: COMPLETE SURFACE TRACING ==========');

// Parse surfaces by following the MFC serialization
function parseSurfacesFromMFC(startPos) {
    const surfaces = [];
    let pos = startPos;
    
    // Skip past MFC class definitions and initial objects
    // Look for the pattern: faceCount u32, faceVertexCounts u32[], vertices float32[]
    
    while (pos + 20 < dl.length) {
        const fc = dv.getUint32(pos, true);
        
        if (fc >= 1 && fc <= 50) {
            // Check if this could be a surface header
            let ok = true;
            const counts = [];
            for (let i = 0; i < fc; i++) {
                if (pos + 4 + (i + 1) * 4 > dl.length) { ok = false; break; }
                const c = dv.getUint32(pos + 4 + i * 4, true);
                if (c < 1 || c > 5000) { ok = false; break; }
                counts.push(c);
            }
            
            if (ok && counts.length === fc) {
                let totalV = 0;
                for (const c of counts) totalV += c;
                
                if (totalV >= 3 && totalV <= 10000) {
                    const vertStart = pos + 4 + fc * 4;
                    
                    // Validate first few vertices
                    let vertsOk = true;
                    for (let i = 0; i < Math.min(6, totalV); i++) {
                        const x = dv.getFloat32(vertStart + i * 12, true);
                        const y = dv.getFloat32(vertStart + i * 12 + 4, true);
                        const z = dv.getFloat32(vertStart + i * 12 + 8, true);
                        if (!isFinite(x) || !isFinite(y) || !isFinite(z) || 
                            Math.abs(x) > 2 || Math.abs(y) > 2 || Math.abs(z) > 2) {
                            vertsOk = false;
                            break;
                        }
                    }
                    
                    if (vertsOk) {
                        const vertEnd = vertStart + totalV * 12;
                        
                        // Now trace what comes AFTER the vertices
                        // This is where normals and triangle indices should be
                        const afterVerts = traceAfterVertices(vertEnd, totalV, fc, counts);
                        
                        surfaces.push({
                            offset: pos,
                            fc,
                            counts,
                            totalVerts: totalV,
                            vertStart,
                            vertEnd,
                            ...afterVerts
                        });
                        
                        // Skip past this surface
                        pos = afterVerts.endOffset || vertEnd;
                        continue;
                    }
                }
            }
        }
        pos += 4;
    }
    return surfaces;
}

function traceAfterVertices(vertEnd, totalVerts, fc, counts) {
    const result = { endOffset: vertEnd, normalCount: 0, indexCount: 0 };
    
    if (vertEnd + 4 > dl.length) return result;
    
    // Read the first u32 after vertices
    const firstU32 = dv.getUint32(vertEnd, true);
    
    // Check if this is a normal count
    // Normals are stored as float32 xyz triples
    // So normalCount * 3 * 4 bytes should follow
    if (firstU32 > 0 && firstU32 < 10000) {
        const normalBytes = firstU32 * 3 * 4; // float32 xyz per normal
        const afterNormals = vertEnd + 4 + normalBytes;
        
        if (afterNormals <= dl.length) {
            // Validate first normal
            const nx = dv.getFloat32(vertEnd + 4, true);
            const ny = dv.getFloat32(vertEnd + 8, true);
            const nz = dv.getFloat32(vertEnd + 12, true);
            
            if (isFinite(nx) && isFinite(ny) && isFinite(nz) && 
                Math.abs(nx) <= 1.1 && Math.abs(ny) <= 1.1 && Math.abs(nz) <= 1.1) {
                result.normalCount = firstU32;
                result.normalEnd = afterNormals;
                
                // After normals, look for triangle index data
                if (afterNormals + 4 <= dl.length) {
                    const indexHeader = dv.getUint32(afterNormals, true);
                    console.log(`  After normals at ${hex(afterNormals)}: indexHeader=${indexHeader}`);
                    
                    // Dump the next 100 bytes
                    let hexLine = '  ';
                    for (let i = 0; i < 100 && afterNormals + i < dl.length; i++) {
                        hexLine += dl[afterNormals + i].toString(16).padStart(2, '0') + ' ';
                        if ((i + 1) % 32 === 0) hexLine += '\n  ';
                    }
                    console.log(hexLine);
                    
                    result.endOffset = afterNormals;
                }
            }
        }
    }
    
    return result;
}

// ============================================================
// STEP 4: Detailed analysis of first 3 surfaces
// ============================================================
console.log('\n========== STEP 4: DETAILED SURFACE ANALYSIS ==========');

const surfaces = parseSurfacesFromMFC(0x60);
console.log(`Found ${surfaces.length} surfaces`);

for (let si = 0; si < Math.min(surfaces.length, 5); si++) {
    const s = surfaces[si];
    console.log(`\n--- Surface ${si} at ${hex(s.offset)} ---`);
    console.log(`  fc=${s.fc} counts=[${s.counts.join(',')}] totalVerts=${s.totalVerts}`);
    console.log(`  vertStart=${hex(s.vertStart)} vertEnd=${hex(s.vertEnd)}`);
    console.log(`  normalCount=${s.normalCount}`);
    
    if (s.normalCount > 0 && s.normalEnd) {
        console.log(`  normalEnd=${hex(s.normalEnd)}`);
        
        // Analyze what's after the normals
        const afterNorm = s.normalEnd;
        if (afterNorm + 200 < dl.length) {
            // Look for triangle index patterns
            // Triangle indices should be u16 values in range 0..totalVerts-1
            let possibleIndices = [];
            for (let i = 0; i < 100 && afterNorm + i * 2 + 2 <= dl.length; i++) {
                const idx = dv.getUint16(afterNorm + i * 2, true);
                possibleIndices.push(idx);
            }
            
            // Check if these look like valid indices
            let validCount = 0;
            for (const idx of possibleIndices) {
                if (idx < s.totalVerts) validCount++;
            }
            
            console.log(`  u16 values (first 50): ${possibleIndices.slice(0, 50).join(', ')}`);
            console.log(`  Valid indices (0..${s.totalVerts-1}): ${validCount}/${possibleIndices.length}`);
            
            // Check if they form triplets (triangles)
            if (possibleIndices.length >= 3) {
                let validTriangles = 0;
                for (let i = 0; i + 2 < possibleIndices.length; i += 3) {
                    const a = possibleIndices[i], b = possibleIndices[i+1], c = possibleIndices[i+2];
                    if (a < s.totalVerts && b < s.totalVerts && c < s.totalVerts && 
                        a !== b && b !== c && a !== c) {
                        validTriangles++;
                    }
                }
                console.log(`  Valid triangles (u16 triplets): ${validTriangles}`);
            }
        }
    }
}

// ============================================================
// STEP 5: Alternative approach - scan for u16 index arrays
// that reference the vertex data we already found
// ============================================================
console.log('\n========== STEP 5: SCANNING FOR U16 INDEX ARRAYS ==========');

// For each surface, collect its vertices
const surfaceVertices = [];
for (const s of surfaces) {
    const verts = [];
    for (let i = 0; i < s.totalVerts; i++) {
        verts.push([
            dv.getFloat32(s.vertStart + i * 12, true),
            dv.getFloat32(s.vertStart + i * 12 + 4, true),
            dv.getFloat32(s.vertStart + i * 12 + 8, true)
        ]);
    }
    surfaceVertices.push(verts);
}

// Now look for u16 arrays that could be triangle indices
// They should be groups of 3 values, each in range 0..vertexCount-1
console.log('\nSearching for u16 triangle index arrays in entire stream...');

let foundIndexArrays = 0;
for (let off = 0; off + 30 <= dl.length; off += 2) {
    // Read a potential triplet
    const a = dv.getUint16(off, true);
    const b = dv.getUint16(off + 2, true);
    const c = dv.getUint16(off + 4, true);
    
    // Check if this could be a valid triangle
    // Find which surface this might belong to
    for (let si = 0; si < Math.min(surfaces.length, 3); si++) {
        const s = surfaces[si];
        if (a < s.totalVerts && b < s.totalVerts && c < s.totalVerts &&
            a !== b && b !== c && a !== c) {
            // Check if next triplet also works
            const d = dv.getUint16(off + 6, true);
            const e = dv.getUint16(off + 8, true);
            const f = dv.getUint16(off + 10, true);
            
            if (d < s.totalVerts && e < s.totalVerts && f < s.totalVerts) {
                // Found a potential index array!
                if (foundIndexArrays < 5) {
                    console.log(`\nPotential index array at ${hex(off)} for surface ${si}:`);
                    console.log(`  Triangles: [${a},${b},${c}], [${d},${e},${f}], ...`);
                    
                    // Show the actual triangle vertices
                    const v0 = surfaceVertices[si][a], v1 = surfaceVertices[si][b], v2 = surfaceVertices[si][c];
                    console.log(`  Triangle 0: v${a}=(${v0[0].toFixed(4)},${v0[1].toFixed(4)},${v0[2].toFixed(4)})`);
                    console.log(`              v${b}=(${v1[0].toFixed(4)},${v1[1].toFixed(4)},${v1[2].toFixed(4)})`);
                    console.log(`              v${c}=(${v2[0].toFixed(4)},${v2[1].toFixed(4)},${v2[2].toFixed(4)})`);
                    
                    // Show more triplets
                    let triCount = 0;
                    for (let t = off; t + 6 <= dl.length && triCount < 10; t += 6) {
                        const ta = dv.getUint16(t, true);
                        const tb = dv.getUint16(t + 2, true);
                        const tc = dv.getUint16(t + 4, true);
                        if (ta >= s.totalVerts || tb >= s.totalVerts || tc >= s.totalVerts) break;
                        triCount++;
                    }
                    console.log(`  Consecutive valid triangles: ${triCount}`);
                    
                    foundIndexArrays++;
                }
                break;
            }
        }
    }
}

console.log(`\nTotal potential index arrays found: ${foundIndexArrays}`);

// ============================================================
// STEP 6: The REAL structure - look at what SolidWorks API produces
// ============================================================
console.log('\n========== STEP 6: SOLIDWORKS API STRUCTURE ==========');
console.log('From the SW API (tsFaceTessellationHandle_c):');
console.log('  VertexCoords() -> float64[] xyz per vertex');
console.log('  NormComp() -> float64[] normal components');
console.log('  IndexedTriangleIndices() -> int[] triangle indices');
console.log('  NumFacets() -> int face count');
console.log('');
console.log('The key: IndexedTriangleIndices() returns FLAT array of indices');
console.log('Each group of 3 consecutive values = one triangle');
console.log('Values are indices into the VertexCoords() array');
console.log('');
console.log('So the structure should be:');
console.log('  [vertex pool] [normal pool] [triangle index array]');
console.log('');

// Let's look for this pattern: after ALL surfaces, there should be a global
// vertex pool and a global triangle index array

// First, find where all surface data ends
let lastSurfaceEnd = 0;
for (const s of surfaces) {
    const end = s.normalEnd || s.vertEnd;
    if (end > lastSurfaceEnd) lastSurfaceEnd = end;
}

console.log(`All surface data ends at: ${hex(lastSurfaceEnd)}`);
console.log(`Remaining bytes: ${dl.length - lastSurfaceEnd}`);

// Look for a large block of float32 data that could be a global vertex pool
// followed by u16 index data
console.log('\nScanning for global vertex pool after surface data...');

for (let off = lastSurfaceEnd; off + 100 < dl.length; off += 4) {
    // Check if this could be start of vertex pool
    const x = dv.getFloat32(off, true);
    const y = dv.getFloat32(off + 4, true);
    const z = dv.getFloat32(off + 8, true);
    
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) continue;
    if (Math.abs(x) > 2 || Math.abs(y) > 2 || Math.abs(z) > 2) continue;
    if (Math.abs(x) < 0.0001 && Math.abs(y) < 0.0001 && Math.abs(z) < 0.0001) continue;
    
    // Count consecutive valid vertices
    let vertCount = 0;
    let p = off;
    while (p + 12 <= dl.length && vertCount < 10000) {
        const vx = dv.getFloat32(p, true);
        const vy = dv.getFloat32(p + 4, true);
        const vz = dv.getFloat32(p + 8, true);
        if (!isFinite(vx) || !isFinite(vy) || !isFinite(vz)) break;
        if (Math.abs(vx) > 2 || Math.abs(vy) > 2 || Math.abs(vz) > 2) break;
        vertCount++;
        p += 12;
    }
    
    if (vertCount >= 10) {
        console.log(`\nPotential vertex pool at ${hex(off)}: ${vertCount} vertices`);
        console.log(`  First: (${dv.getFloat32(off,true).toFixed(4)}, ${dv.getFloat32(off+4,true).toFixed(4)}, ${dv.getFloat32(off+8,true).toFixed(4)})`);
        console.log(`  Last: (${dv.getFloat32(p-12,true).toFixed(4)}, ${dv.getFloat32(p-8,true).toFixed(4)}, ${dv.getFloat32(p-4,true).toFixed(4)})`);
        
        // Check what comes after the vertex pool
        if (p + 20 < dl.length) {
            console.log(`  After vertex pool at ${hex(p)}:`);
            
            // Could be u16 indices
            const u16sample = [];
            for (let i = 0; i < 20 && p + i * 2 + 2 <= dl.length; i++) {
                u16sample.push(dv.getUint16(p + i * 2, true));
            }
            console.log(`  u16: ${u16sample.join(', ')}`);
            
            // Check if indices are in valid range
            let validIdx = 0;
            for (const idx of u16sample) {
                if (idx < vertCount) validIdx++;
            }
            console.log(`  Valid indices: ${validIdx}/${u16sample.length}`);
        }
        
        break; // Only show first candidate
    }
}

// Helper function
function hex(n) { return '0x' + n.toString(16); }
