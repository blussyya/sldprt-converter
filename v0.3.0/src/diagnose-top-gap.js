#!/usr/bin/env node
/**
 * Deep diagnostic: Analyze inter-record gap structures
 * Look for sub-face boundaries, surface IDs, or grouping markers within gaps
 */

const fs = require('fs');
const path = require('path');
const { extractMesh, setVerbose } = require('./sldprt-extractor.js');
const { parseSTEP, buildLookup, evalA2P3D } = require('./step-parse.js');

const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const dot = (a, b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const vlen = v => Math.sqrt(v[0]**2+v[1]**2+v[2]**2);
const scl = (v, s) => [v[0]*s, v[1]*s, v[2]*s];

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

// Extract DisplayLists (same as diagnose-top.js)
const { ensureBuffer } = require('./ole2-parser.js');
let dlData = null;
const zlib = require('zlib');
const inflate = {
    inflateRaw: (b) => zlib.inflateRawSync(Buffer.from(b)),
    inflate: (b) => zlib.inflateSync(Buffer.from(b)),
};
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
console.log(`Total markers found: ${markerPositions.length}`);

// Parse all 68 valid face records
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
console.log(`Parsed ${faces.length} valid face records\n`);

// ============================================================
// ANALYSIS 1: Look for repeated patterns in gap data between OK and FAIL faces
// ============================================================

console.log('=== GAP SIZE ANALYSIS ===\n');
console.log('Face# | Status | Verts | Gap-to-next | edgeCount | VertCount');
console.log('------|--------|-------|-------------|-----------|----------');

const FAIL_SET = new Set([0, 59, 60, 61, 62, 63, 64, 65, 66, 67]);

for (let i = 0; i < faces.length; i++) {
    const f = faces[i];
    const status = FAIL_SET.has(i) ? 'FAIL' : 'OK';
    let gap = '-';
    if (i < faces.length - 1) {
        gap = String(faces[i+1].mp - 4 - f.endOffset);
    }
    console.log(`${String(i).padStart(5)} | ${status.padStart(6)} | ${String(f.vertexCount).padStart(5)} | ${String(gap).padStart(11)} | 0x${hex32(f.edgeCount)} | 0x${hex32(f.vertexCount)}`);
}

// ============================================================
// ANALYSIS 2: Look for "sub-record" headers within the gap data
// The gap between face records contains index/connectivity data.
// Look for patterns that might indicate sub-face boundaries.
// ============================================================

console.log('\n\n=== GAP DATA STRUCTURE ANALYSIS ===\n');
console.log('Looking for patterns within gap data that indicate sub-face boundaries...\n');

for (let fi = 0; fi < faces.length; fi++) {
    const f = faces[fi];
    if (fi >= faces.length - 1) continue;
    
    const gapStart = f.endOffset;
    const gapEnd = faces[fi + 1].mp - 4;
    const gapLen = gapEnd - gapStart;
    
    if (gapLen <= 0 || gapLen > 20000) continue;
    
    // Look for uint32 values that could be sub-face counts or IDs
    // The gap likely contains: index data, normal data, possibly surface IDs
    
    // Check if the gap starts with any recognizable pattern
    const first16 = [];
    for (let b = gapStart; b < Math.min(gapStart + 16, gapEnd); b++) {
        first16.push(dlData[b]);
    }
    
    // Look for sequences of uint32 values that could be face counts
    // In the gap, look for uint32 values that sum to the vertex count
    let sumCheck = 0;
    let subFaceCount = 0;
    let foundSubStructure = false;
    
    // Try reading first N uint32s and see if they sum to vertexCount
    for (let n = 1; n <= Math.min(20, Math.floor(gapLen / 4)); n++) {
        let sum = 0;
        let valid = true;
        for (let j = 0; j < n; j++) {
            const v = dlData.readUInt32LE(gapStart + j * 4);
            if (v > 10000) { valid = false; break; }
            sum += v;
        }
        if (valid && sum === f.vertexCount) {
            subFaceCount = n;
            foundSubStructure = true;
            break;
        }
    }
    
    if (foundSubStructure) {
        console.log(`Face #${fi} (verts=${f.vertexCount}): Gap starts with ${subFaceCount} uint32s summing to vertexCount!`);
        const subCounts = [];
        for (let j = 0; j < subFaceCount; j++) {
            subCounts.push(dlData.readUInt32LE(gapStart + j * 4));
        }
        console.log(`  Sub-face counts: [${subCounts.join(', ')}] (sum=${subCounts.reduce((a,b)=>a+b,0)})`);
        console.log(`  Gap bytes (first ${subFaceCount * 4 + 16}): ${printBytes(dlData, gapStart, subFaceCount * 4 + 16)}`);
        console.log('');
    }
}

// ============================================================
// ANALYSIS 3: Look for 4-byte values between the edgeCount and
// the marker (i.e., in the 4 bytes at mp-8 to mp-4) that might
// be a surface/group ID
// ============================================================

console.log('\n=== PRE-RECORD UINT32 ANALYSIS ===\n');
console.log('Bytes at mp-8..mp-4 (before edgeCount) - possible surface/group ID:\n');

for (let i = 0; i < faces.length; i++) {
    const f = faces[i];
    const status = FAIL_SET.has(i) ? 'FAIL' : 'OK';
    const val8 = dlData.readUInt32LE(f.mp - 8);
    const val12 = dlData.readUInt32LE(f.mp - 12);
    const val16 = dlData.readUInt32LE(f.mp - 16);
    console.log(`Face #${String(i).padStart(2)} (${status.padStart(4)}) | mp-16=0x${hex32(val16)} | mp-12=0x${hex32(val12)} | mp-8=0x${hex32(val8)} | edgeCount=0x${hex32(f.edgeCount)} | verts=${f.vertexCount}`);
}

// ============================================================
// ANALYSIS 4: For FAIL faces, look at what's between vertex data
// end and the NEXT valid face - specifically looking for a pattern
// that indicates how to split the mixed-surface vertices
// ============================================================

console.log('\n\n=== DETAILED GAP BYTE ANALYSIS FOR FAIL FACES ===\n');

for (const fi of [0, 59, 60, 61, 62, 63, 64, 65, 66, 67]) {
    if (fi >= faces.length - 1) continue;
    const f = faces[fi];
    const gapStart = f.endOffset;
    const gapEnd = faces[fi + 1].mp - 4;
    const gapLen = gapEnd - gapStart;
    
    console.log(`\n--- Face #${fi} (verts=${f.vertexCount}, gap=${gapLen} bytes) ---`);
    
    // Read the first 128 bytes of gap data as uint32s
    console.log('  First 32 uint32s in gap:');
    for (let j = 0; j < Math.min(32, Math.floor(gapLen / 4)); j++) {
        const v = dlData.readUInt32LE(gapStart + j * 4);
        const hex = hex32(v);
        const isSmall = v <= 100;
        process.stdout.write(`    [${String(j).padStart(2)}] 0x${hex} (${v})${isSmall ? ' <-- possible count' : ''}\n`);
    }
    
    // Check if first uint32 matches edgeCount (possible "group count")
    const firstU32 = dlData.readUInt32LE(gapStart);
    console.log(`  First uint32 in gap: ${firstU32} (edgeCount was ${f.edgeCount})`);
    
    // Check if there are repeated sub-structures
    // Pattern: count1 + count2 + ... + countN = vertexCount, where each count is a sub-face
    console.log(`  Looking for partition of ${f.vertexCount} vertices...`);
    
    // Try to find a sequence of small uint32 values that sum to vertexCount
    for (let startOff = 0; startOff < Math.min(64, gapLen); startOff += 4) {
        let sum = 0;
        let count = 0;
        let parts = [];
        let tooBig = false;
        for (let j = startOff; j < gapLen && count < 100; j += 4) {
            const v = dlData.readUInt32LE(gapStart + j);
            if (v > 500) { tooBig = true; break; }
            sum += v;
            parts.push(v);
            count++;
            if (sum === f.vertexCount) {
                console.log(`  FOUND partition at gap offset ${startOff}: [${parts.join(', ')}] (${count} parts, sum=${sum})`);
                break;
            }
            if (sum > f.vertexCount) break;
        }
    }
}

// ============================================================
// ANALYSIS 5: Compare the FIRST face record vs subsequent records
// in the same "group" to understand nesting
// ============================================================

console.log('\n\n=== MARKER OCCURRENCE ANALYSIS ===\n');
console.log('For each valid face, how many markers appear in its gap data?\n');

for (let fi = 0; fi < faces.length; fi++) {
    const f = faces[fi];
    if (fi >= faces.length - 1) continue;
    
    const gapStart = f.endOffset;
    const gapEnd = faces[fi + 1].mp - 4;
    
    // Count markers in gap
    let markersInGap = 0;
    for (const mp of markerPositions) {
        if (mp >= gapStart && mp < gapEnd) markersInGap++;
    }
    
    const status = FAIL_SET.has(fi) ? 'FAIL' : 'OK';
    if (markersInGap > 0) {
        console.log(`Face #${String(fi).padStart(2)} (${status.padStart(4)}) | verts=${String(f.vertexCount).padStart(4)} | gap=${String(gapEnd-gapStart).padStart(5)} bytes | ${markersInGap} markers in gap`);
    }
}

// ============================================================
// ANALYSIS 6: For OK faces that match the SAME STEP surface as
// FAIL faces, compare their gap structures
// ============================================================

console.log('\n\n=== COMPARING OK vs FAIL FACES ON SAME STEP SURFACES ===\n');

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

// Find which STEP surface each face matches
const faceStepMatch = [];
for (let fi = 0; fi < mesh.faces.length; fi++) {
    const face = mesh.faces[fi];
    if (face.length < 3) { faceStepMatch.push(null); continue; }
    const verts = face.map(idx => mesh.vertices[idx]);
    const { face: stepF } = findBestSTEPFace(verts, lookup);
    faceStepMatch.push(stepF ? stepF.surfId : null);
}

// Group faces by STEP surface
const surfGroups = new Map();
for (let fi = 0; fi < faceStepMatch.length; fi++) {
    const sid = faceStepMatch[fi];
    if (!sid) continue;
    if (!surfGroups.has(sid)) surfGroups.set(sid, []);
    surfGroups.get(sid).push(fi);
}

// Show surfaces that have BOTH OK and FAIL faces
console.log('STEP surfaces with mixed OK/FAIL faces:\n');
for (const [sid, faceIndices] of surfGroups) {
    const hasOk = faceIndices.some(fi => !FAIL_SET.has(fi));
    const hasFail = faceIndices.some(fi => FAIL_SET.has(fi));
    if (hasOk && hasFail) {
        const surf = lookup.surfData[sid];
        console.log(`Surface #${sid} (${surf?.type || '?'}):`);
        for (const fi of faceIndices) {
            const status = FAIL_SET.has(fi) ? 'FAIL' : 'OK';
            const f = faces[fi];
            const vf = mesh.faces[fi];
            console.log(`  Face #${String(fi).padStart(2)} (${status.padStart(4)}) | edgeCount=0x${hex32(f.edgeCount)} | verts=${String(f.vertexCount).padStart(4)} | meshVerts=${vf.length}`);
        }
        console.log('');
    }
}

console.log('\nDone.');
