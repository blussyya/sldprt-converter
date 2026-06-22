#!/usr/bin/env node
/**
 * Diagnostic: Deep analysis of gap data structure
 * Goal: Find how sub-faces are encoded within each face record's gap data
 */

const fs = require('fs');
const path = require('path');
const { extractMesh } = require('./sldprt-extractor.js');
const { parseSTEP, buildLookup, evalA2P3D } = require('./step-parse.js');

const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const dot = (a, b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const vlen = v => Math.sqrt(v[0]**2+v[1]**2+v[2]**2);
const scl = (v, s) => [v[0]*s, v[1]*s, v[2]*s];
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const vnorm = v => { const l=vlen(v); return l>1e-12?[v[0]/l,v[1]/l,v[2]/l]:[0,0,0]; };

function distToSurface(p, surf, lookup) {
    if (!surf || !surf.a2p3d) return null;
    const ap = evalA2P3D(surf.a2p3d, lookup);
    if (!ap) return null;
    switch (surf.type) {
        case 'PLANE': return Math.abs(dot(sub(p, ap.center), ap.normal));
        case 'CYL': {
            const v = sub(p, ap.center);
            const radial = sub(v, scl(ap.normal, dot(v, ap.normal)));
            return Math.abs(vlen(radial) - surf.radius);
        }
        default: return null;
    }
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

function hex8(b) { return b.toString(16).padStart(2, '0'); }
function hex32(v) { return v.toString(16).padStart(8, '0'); }
function printBytes(buf, offset, count) {
    const parts = [];
    for (let i = 0; i < count && offset + i < buf.length; i++) {
        parts.push(hex8(buf[offset + i]));
    }
    return parts.join(' ');
}

const SLDPRT = path.join('..', 'test files original', 'usb hub case (ultimate test)', 'USB hub case TOP.SLDPRT');
const STEP   = path.join('..', 'test files original', 'usb hub case (ultimate test)', 'USB hub case TOP ORIGINAL.STEP');

console.log('Loading files...');
const buf = fs.readFileSync(SLDPRT);
const stepText = fs.readFileSync(STEP, 'utf8');
const ents = parseSTEP(stepText);
const lookup = buildLookup(ents);

// Extract DisplayLists
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
const markerPositions = findAll(dlData, MARKER);

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

const FAIL_SET = new Set([0, 59, 60, 61, 62, 63, 64, 65, 66, 67]);

// ============================================================
// KEY ANALYSIS: Read the "second header" and surface parameters
// from each face's gap data
// ============================================================

console.log('\n=== GAP DATA STRUCTURE: SECOND HEADER + SURFACE PARAMS ===\n');
console.log('Layout after vertex data end:\n');
console.log('  [second_header: 16 bytes] [surface_params: varies] [per_vertex_data: varies]\n');

for (let fi = 0; fi < faces.length; fi++) {
    const f = faces[fi];
    if (fi >= faces.length - 1) continue;
    const status = FAIL_SET.has(fi) ? 'FAIL' : 'OK';

    const gapStart = f.endOffset;
    const gapEnd = faces[fi + 1].mp - 4;
    const gapLen = gapEnd - gapStart;
    if (gapLen < 32) continue;

    // Read the second header (should mirror the first)
    const sh_edgeCount = dlData.readUInt32LE(gapStart);
    const sh_marker0 = dlData.readUInt32LE(gapStart + 4);
    const sh_marker1 = dlData.readUInt32LE(gapStart + 8);
    const sh_faceType = dlData.readUInt32LE(gapStart + 12);
    const sh_vertCount = dlData.readUInt32LE(gapStart + 16);

    const markerOk = sh_marker0 === 0x0000000c && sh_marker1 === 0x00000064 && sh_faceType === 2;
    const vertCountMatch = sh_vertCount === f.vertexCount;

    // Read surface parameters (next 16-32 bytes after second header)
    const params16 = [];
    for (let j = 0; j < 4; j++) {
        params16.push(dlData.readFloatLE(gapStart + 16 + j * 4)); // overlap with vertCount at +16
    }
    // Actually second header is at gapStart+0..+15, then params start at gapStart+16
    const p = [];
    for (let j = 0; j < 8; j++) {
        p.push(dlData.readFloatLE(gapStart + 16 + j * 4));
    }

    console.log(`Face #${String(fi).padStart(2)} (${status.padStart(4)}) | gap=${String(gapLen).padStart(5)} | 2nd_hdr: markerOk=${markerOk} vertMatch=${vertCountMatch} | params: ${p.map(v => v.toFixed(4)).join(', ')}`);
}

// ============================================================
// DETAILED ANALYSIS: Read ALL gap data as structured fields
// For FAIL face #0, dump every uint32 and float in the gap
// ============================================================

console.log('\n\n=== DETAILED GAP BYTE ANALYSIS FOR FACE #0 ===\n');

const f0 = faces[0];
const f0_gapStart = f0.endOffset;
const f0_gapEnd = faces[1].mp - 4;
const f0_gapLen = f0_gapEnd - f0_gapStart;
console.log(`Gap: ${f0_gapLen} bytes (0x${hex32(f0_gapStart)} - 0x${hex32(f0_gapEnd)})`);

// Read second header
console.log('\nSecond header (16 bytes):');
console.log(`  edgeCount: ${dlData.readUInt32LE(f0_gapStart)} (0x${hex32(dlData.readUInt32LE(f0_gapStart))})`);
console.log(`  marker: ${printBytes(dlData, f0_gapStart + 4, 8)}`);
console.log(`  faceType: ${dlData.readUInt32LE(f0_gapStart + 12)}`);
console.log(`  vertexCount: ${dlData.readUInt32LE(f0_gapStart + 16)} (0x${hex32(dlData.readUInt32LE(f0_gapStart + 16))})`);

// Read floats after second header
console.log('\nFloats after second header (starting at gapStart+20):');
for (let j = 0; j < 12; j++) {
    const off = f0_gapStart + 20 + j * 4;
    if (off + 4 > f0_gapEnd) break;
    const f32 = dlData.readFloatLE(off);
    const u32 = dlData.readUInt32LE(off);
    console.log(`  [+${String(20 + j * 4).padStart(3)}] float=${f32.toFixed(6)}  uint32=0x${hex32(u32)}`);
}

// Now compare: the per-vertex data starts where?
// After second header (16 bytes) + some params
// Let's see if the remaining bytes divide evenly as float triples
const afterHdr = f0_gapLen - 16;
console.log(`\nBytes after second header: ${afterHdr}`);
console.log(`  /4 = ${afterHdr/4} uint32s`);
console.log(`  /12 = ${afterHdr/12} float triples`);
console.log(`  /16 = ${afterHdr/16} quads`);

// Check if there's a "count" field that tells us how many sub-faces
// Look for a uint32 that could be the number of sub-faces
console.log('\nLooking for sub-face count field:');
for (let off = 20; off < Math.min(80, f0_gapLen); off += 4) {
    const v = dlData.readUInt32LE(f0_gapStart + off);
    if (v >= 2 && v <= 20) {
        console.log(`  gapOffset=${off}: uint32=${v} (possible sub-face count)`);
    }
}

// ============================================================
// COMPARISON: Gap structure of OK face #36 vs FAIL face #0
// Both match STEP face #149 (CYL)
// ============================================================

console.log('\n\n=== COMPARISON: OK FACE #36 vs FAIL FACE #0 (both match STEP #149 CYL) ===\n');

const f36 = faces[36];
const f36_gapStart = f36.endOffset;
const f36_gapEnd = faces[37].mp - 4;
const f36_gapLen = f36_gapEnd - f36_gapStart;

console.log(`Face #36 (OK): ${f36.vertexCount} verts, gap=${f36_gapLen} bytes`);
console.log(`Face #0  (FAIL): ${f0.vertexCount} verts, gap=${f0_gapLen} bytes`);

// Compare the gap data structure
console.log('\nGap data for Face #36 (first 80 bytes after vertex end):');
for (let off = 0; off < Math.min(80, f36_gapLen); off += 4) {
    const u = dlData.readUInt32LE(f36_gapStart + off);
    const f = dlData.readFloatLE(f36_gapStart + off);
    console.log(`  [${String(off).padStart(3)}] uint32=0x${hex32(u)}  float=${f.toFixed(6)}`);
}

console.log('\nGap data for Face #0 (first 80 bytes after vertex end):');
for (let off = 0; off < Math.min(80, f0_gapLen); off += 4) {
    const u = dlData.readUInt32LE(f0_gapStart + off);
    const f = dlData.readFloatLE(f0_gapStart + off);
    console.log(`  [${String(off).padStart(3)}] uint32=0x${hex32(u)}  float=${f.toFixed(6)}`);
}

// ============================================================
// NEW INSIGHT: Look at the gap data as a STRUCTURE
// The gap might contain: [second_hdr:16][face_params:N][index_data:M][vertex_data:V]
// ============================================================

console.log('\n\n=== HYPOTHESIS: Gap contains face normal + index ranges ===\n');

// For OK face #36 (159 verts on single CYL surface):
// The face normal at each vertex should be consistent (pointing radially)
// Let's compute the actual normals and see if they cluster

function computeFaceNormals(verts) {
    const normals = [];
    for (let i = 0; i < verts.length; i++) {
        const prev = verts[(i - 1 + verts.length) % verts.length];
        const curr = verts[i];
        const next = verts[(i + 1) % verts.length];
        const e1 = sub(curr, prev);
        const e2 = sub(next, curr);
        const n = vnorm(cross(e1, e2));
        normals.push(n);
    }
    return normals;
}

// For each FAIL face, compute normals and detect surface boundaries
console.log('Surface boundary detection via normal analysis:\n');

for (const fi of [0, 59, 60, 61, 62, 63, 64, 65, 66, 67]) {
    const f = faces[fi];
    const normals = computeFaceNormals(f.verts);
    
    // Find boundaries: consecutive vertices where normal angle > threshold
    const THRESHOLD_DEG = 20;
    const threshold = Math.cos(THRESHOLD_DEG * Math.PI / 180);
    
    const boundaries = [];
    for (let i = 0; i < normals.length; i++) {
        const next = (i + 1) % normals.length;
        const d = dot(normals[i], normals[next]);
        if (d < threshold) {
            boundaries.push({ idx: i, angle: Math.acos(Math.max(-1, Math.min(1, d))) * 180 / Math.PI });
        }
    }
    
    // Compute sub-face ranges
    const subFaces = [];
    if (boundaries.length === 0) {
        subFaces.push({ start: 0, end: f.vertexCount });
    } else {
        for (let b = 0; b < boundaries.length; b++) {
            const start = boundaries[b].idx + 1;
            const end = b + 1 < boundaries.length ? boundaries[b + 1].idx + 1 : f.vertexCount;
            if (end > start) {
                subFaces.push({ start, count: end - start });
            } else if (end < start) {
                // Wrap around
                subFaces.push({ start, count: f.vertexCount - start });
                if (end > 0) subFaces.push({ start: 0, count: end });
            }
        }
        // Handle wrap from last boundary to first
        if (boundaries.length > 0) {
            const lastEnd = boundaries[0].idx + 1;
            const firstStart = boundaries[boundaries.length - 1].idx + 1;
            // This is already handled above
        }
    }
    
    console.log(`Face #${String(fi).padStart(2)} (${String(f.vertexCount).padStart(4)} verts): ${boundaries.length} boundaries → ${subFaces.length} sub-faces`);
    if (boundaries.length > 0 && boundaries.length <= 10) {
        for (const b of boundaries) {
            console.log(`  boundary at vert ${b.idx}→${b.idx+1}: ${b.angle.toFixed(1)}°`);
        }
    }
    if (subFaces.length > 1 && subFaces.length <= 10) {
        for (const sf of subFaces) {
            console.log(`  sub-face: verts ${sf.start}..${sf.start + sf.count - 1} (${sf.count} verts)`);
        }
    }
}

// ============================================================
// VALIDATE: For each sub-face, check which STEP surface it matches
// ============================================================

console.log('\n\n=== VALIDATION: Sub-face STEP matching ===\n');

const mesh = extractMesh(buf);
for (const v of mesh.vertices) { v[0] *= 1000; v[1] *= 1000; v[2] *= 1000; }

function findBestSTEPFace(verts, lookup) {
    let bestFace = null, bestScore = -1;
    for (const sf of lookup.faces) {
        const surf = lookup.surfData[sf.surfId];
        if (!surf || !surf.a2p3d) continue;
        let matchCount = 0;
        for (const v of verts) {
            const d = distToSurface(v, surf, lookup);
            if (d !== null && d < 0.5) matchCount++;
        }
        const score = matchCount / verts.length;
        if (score > bestScore) { bestScore = score; bestFace = sf; }
    }
    return { face: bestFace, score: bestScore };
}

function triArea(a, b, c) {
    const e1 = sub(b, a), e2 = sub(c, a);
    const n = cross(e1, e2);
    return vlen(n) / 2;
}

for (const fi of [0, 59, 60, 61, 62, 63, 64, 65, 66, 67]) {
    const f = faces[fi];
    const normals = computeFaceNormals(f.verts);
    
    const THRESHOLD_DEG = 20;
    const threshold = Math.cos(THRESHOLD_DEG * Math.PI / 180);
    
    const boundaries = [];
    for (let i = 0; i < normals.length; i++) {
        const next = (i + 1) % normals.length;
        const d = dot(normals[i], normals[next]);
        if (d < threshold) {
            boundaries.push(i);
        }
    }
    
    // Build sub-faces
    const subFaceRanges = [];
    if (boundaries.length === 0) {
        subFaceRanges.push([0, f.vertexCount]);
    } else {
        for (let b = 0; b < boundaries.length; b++) {
            const start = (boundaries[b] + 1) % f.vertexCount;
            const endIdx = (b + 1) % boundaries.length;
            let end;
            if (b + 1 < boundaries.length) {
                end = boundaries[b + 1] + 1;
            } else {
                end = f.vertexCount; // wraps to start
            }
            // Calculate count correctly
            let count;
            if (end > start) {
                count = end - start;
            } else {
                count = f.vertexCount - start + end;
            }
            if (count > 0) subFaceRanges.push([start, count]);
        }
    }
    
    console.log(`\nFace #${fi} (${f.vertexCount} verts, ${subFaceRanges.length} sub-faces):`);
    
    for (let si = 0; si < subFaceRanges.length; si++) {
        const [start, count] = subFaceRanges[si];
        const subVerts = [];
        for (let i = 0; i < count; i++) {
            const idx = (start + i) % f.vertexCount;
            subVerts.push(f.verts[idx].map(v => v * 1000)); // scale to mm
        }
        
        if (subVerts.length < 3) {
            console.log(`  sub #${si}: ${subVerts.length} verts (too few, skip)`);
            continue;
        }
        
        const { face: stepF, score } = findBestSTEPFace(subVerts, lookup);
        let maxDist = 0;
        if (stepF) {
            const surf = lookup.surfData[stepF.surfId];
            for (const v of subVerts) {
                const d = distToSurface(v, surf, lookup);
                if (d !== null && d > maxDist) maxDist = d;
            }
        }
        
        const stepId = stepF ? `#${stepF.id}` : 'none';
        const surfType = stepF ? (lookup.surfData[stepF.surfId]?.type || '?') : '-';
        console.log(`  sub #${si}: verts ${start}..${(start+count-1)} (${String(count).padStart(3)} verts) → STEP ${stepId.padStart(5)} (${surfType.padStart(5)}) score=${(score*100).toFixed(0).padStart(3)}% maxDist=${maxDist.toFixed(3)}`);
    }
}

console.log('\nDone.');
