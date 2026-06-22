#!/usr/bin/env node
/**
 * Diagnostic: Analyze DisplayLists binary structure for USB hub case TOP
 * Focuses on face #0 and faces #59-67 (the 10 FAIL faces with 2.0mm dist, 45-54% match)
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

function readFloat32s(buf, offset, count) {
    const vals = [];
    for (let i = 0; i < count; i++) {
        vals.push(buf.readFloatLE(offset + i * 4));
    }
    return vals;
}

// ============================================================
// Main
// ============================================================

const SLDPRT = path.join('..', 'test files original', 'usb hub case (ultimate test)', 'USB hub case TOP.SLDPRT');
const STEP   = path.join('..', 'test files original', 'usb hub case (ultimate test)', 'USB hub case TOP ORIGINAL.STEP');

console.log('Loading SLDPRT...');
const buf = fs.readFileSync(SLDPRT);
const { extractMesh: _, ...rest } = require('./sldprt-extractor.js');

// We need the raw DisplayLists data. Re-do the extraction manually.
const { parseOLE2, readStream, ensureBuffer } = require('./ole2-parser.js');
let dlData = null;

// Check if modern format
const isOLE2 = buf[0] === 0xD0 && buf[1] === 0xCF && buf[2] === 0x11 && buf[3] === 0xE0;
if (!isOLE2) {
    // Modern format - use findDisplayLists logic inline
    // We need to use the decompressor
    const zlib = require('zlib');
    const inflate = {
        inflateRaw: (b) => zlib.inflateRawSync(Buffer.from(b)),
        inflate: (b) => zlib.inflateSync(Buffer.from(b)),
        brotli: (b) => zlib.brotliDecompressSync(b)
    };

    function rolByte(b, shift) {
        shift &= 7;
        if (shift === 0) return b;
        return ((b << shift) | (b >>> (8 - shift))) & 0xFF;
    }

    function findAllIn(buf, pattern) {
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

    const key = buf[7];
    const marker = new Uint8Array([0x14, 0x00, 0x06, 0x00, 0x08, 0x00]);
    const streams = {};

    for (const mp of findAllIn(buf, marker)) {
        const si = mp - 4;
        if (si < 0 || si + 0x1E > buf.length) continue;
        const f1 = buf.readUInt32LE(si + 0x0E);
        const csz = buf.readUInt32LE(si + 0x12);
        const nsz = buf.readUInt32LE(si + 0x1A);
        if (nsz > 1024 || csz > 50 * 1024 * 1024) continue;
        const nameStart = si + 0x1E;
        const nameEnd = nameStart + nsz;
        if (nameEnd > buf.length) continue;
        const rawName = buf.subarray(nameStart, nameEnd);
        let name = '';
        for (let i = 0; i < nsz; i++) name += String.fromCharCode(rolByte(rawName[i], key));
        if (name.length === 0) continue;
        const dataStart = nameEnd;
        const dataEnd = dataStart + csz;
        if (dataEnd > buf.length) continue;
        if (f1 >= 65536 && csz > 0) {
            const compressed = buf.subarray(dataStart, dataEnd);
            let decompressed = null;
            try { decompressed = inflate.inflateRaw(compressed); } catch(e) {}
            if (!decompressed || decompressed.length === 0) {
                try { decompressed = inflate.inflate(compressed); } catch(e) {}
            }
            if (decompressed && decompressed.length > 0 && !streams[name]) {
                streams[name] = decompressed;
            }
        }
    }

    for (const [name, data] of Object.entries(streams)) {
        if (name.toLowerCase().includes('displaylist') && data.length > 100) {
            const d = ensureBuffer(data);
            if (d.readUInt32LE(0) === 1 && d.readUInt32LE(4) === 1) {
                dlData = data;
                break;
            }
        }
    }
}

if (!dlData) {
    console.error('Failed to get DisplayLists data');
    process.exit(1);
}

dlData = ensureBuffer(dlData);
console.log(`DisplayLists: ${dlData.length} bytes`);

// ============================================================
// Find all markers and parse face records
// ============================================================

const MARKER = new Uint8Array([0x0c, 0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00]);
const markerPositions = findAll(dlData, MARKER);
console.log(`\nFound ${markerPositions.length} marker positions`);

// Parse each face record
const faces = [];
for (let mi = 0; mi < markerPositions.length; mi++) {
    const mp = markerPositions[mi];
    if (mp < 4) continue;
    const edgeCount = dlData.readUInt32LE(mp - 4);
    if (edgeCount < 1 || edgeCount > 500) continue;
    const faceType = dlData.readUInt32LE(mp + 8);
    if (faceType !== 2) continue;
    const vertexCount = dlData.readUInt32LE(mp + 12);
    if (vertexCount < 3 || vertexCount > 5000) continue;
    const vertStart = mp + 16;
    if (vertStart + vertexCount * 12 > dlData.length) continue;

    // Validate vertices
    let valid = true;
    const verts = [];
    for (let i = 0; i < vertexCount; i++) {
        const off = vertStart + i * 12;
        const x = dlData.readFloatLE(off);
        const y = dlData.readFloatLE(off + 4);
        const z = dlData.readFloatLE(off + 8);
        if (!isFinite(x) || !isFinite(y) || !isFinite(z)) { valid = false; break; }
        if (Math.abs(x) > 100000 || Math.abs(y) > 100000 || Math.abs(z) > 100000) { valid = false; break; }
        verts.push([x, y, z]);
    }
    if (!valid) continue;

    const endOffset = vertStart + vertexCount * 12;

    faces.push({
        mi,
        mp,
        edgeCount,
        faceType,
        vertexCount,
        vertStart,
        endOffset,
        verts,
    });
}

console.log(`Parsed ${faces.length} valid face records\n`);

// ============================================================
// Compare OK vs FAIL faces
// ============================================================

// Known FAIL faces from validation (by index into the extracted mesh)
// #0, #59-67 - but these are indices into the 68-face result, not the raw records
// The faces are parsed in order, so face index = sequential order

console.log('=== FACE RECORD STRUCTURE ===\n');
console.log('Each face record layout (relative to marker):');
console.log('  mp-4:  edgeCount (uint32 LE)');
console.log('  mp+0:  marker bytes [0x0C 0x00 0x00 0x00 0x64 0x00 0x00 0x00]');
console.log('  mp+8:  faceType (uint32 LE, must be 2)');
console.log('  mp+12: vertexCount (uint32 LE)');
console.log('  mp+16: vertex data (vertexCount * 12 bytes, floats)');
console.log('');

// Print all face records
for (let i = 0; i < faces.length; i++) {
    const f = faces[i];
    const prevEnd = i > 0 ? faces[i - 1].endOffset : 0;
    const gapBytes = f.mp - 4 - prevEnd;
    
    // Read bytes before the marker (the gap between previous face end and this face start)
    const beforeMarker = [];
    for (let b = Math.max(0, f.mp - 32); b < f.mp; b++) {
        beforeMarker.push(dlData[b]);
    }

    // Read bytes after the marker, before vertex data
    const afterMarker = [];
    for (let b = f.mp + 8; b < Math.min(dlData.length, f.mp + 16); b++) {
        afterMarker.push(dlData[b]);
    }

    // Check what's between this face's end and next face's marker
    let betweenHex = '';
    if (i < faces.length - 1) {
        const nextMp = faces[i + 1].mp;
        const start = f.endOffset;
        const end = nextMp - 4; // next face's edgeCount
        const betweenLen = end - start;
        if (betweenLen > 0 && betweenLen <= 200) {
            betweenHex = printBytes(dlData, start, Math.min(betweenLen, 64));
        }
    }

    // Compute bounding box
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, y, z] of f.verts) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }

    console.log(`--- Face #${i} (record at mp=0x${hex32(f.mp)}, verts=${f.vertexCount}) ---`);
    console.log(`  edgeCount=0x${hex32(f.edgeCount)} (${f.edgeCount}), faceType=${f.faceType}, vertexCount=${f.vertexCount}`);
    console.log(`  data range: 0x${hex32(f.vertStart)} - 0x${hex32(f.endOffset)} (${f.vertexCount * 12} bytes)`);
    console.log(`  gap from prev: ${gapBytes} bytes`);
    console.log(`  bbox: X[${minX.toFixed(4)}, ${maxX.toFixed(4)}] Y[${minY.toFixed(4)}, ${maxY.toFixed(4)}] Z[${minZ.toFixed(4)}, ${maxZ.toFixed(4)}]`);
    console.log(`  first 3 verts: ${f.verts.slice(0, 3).map(v => `(${v[0].toFixed(4)}, ${v[1].toFixed(4)}, ${v[2].toFixed(4)})`).join(', ')}`);
    
    if (betweenHex) {
        console.log(`  gap-to-next (${faces[i+1].mp - 4 - f.endOffset} bytes): ${betweenHex}`);
    }
    console.log('');
}

// ============================================================
// Analyze the inter-marker gaps more carefully
// ============================================================

console.log('\n=== INTER-MARKER GAP ANALYSIS ===\n');
console.log('Looking for surface IDs or group IDs between face records...\n');

for (let i = 0; i < faces.length; i++) {
    const f = faces[i];
    const recordStart = f.mp - 4; // edgeCount before marker
    const recordEnd = f.endOffset; // after last vertex byte

    // The "record" is from recordStart to recordEnd
    // The "header" before vertex data is from recordStart to f.vertStart (20 bytes: 4+8+4+4)
    const headerBytes = [];
    for (let b = recordStart; b < Math.min(recordStart + 20, dlData.length); b++) {
        headerBytes.push(dlData[b]);
    }

    // Look at 8 bytes BEFORE the edgeCount (before the entire record)
    const preRecord = [];
    for (let b = Math.max(0, recordStart - 8); b < recordStart; b++) {
        preRecord.push(dlData[b]);
    }

    // Look at bytes between record end and next record start
    let postRecord = [];
    if (i < faces.length - 1) {
        const nextRecordStart = faces[i + 1].mp - 4;
        for (let b = recordEnd; b < nextRecordStart; b++) {
            postRecord.push(dlData[b]);
        }
    }

    const preHex = preRecord.length > 0 ? printBytes(dlData, recordStart - 8, 8) : '(start)';
    const headerHex = headerBytes.map(b => hex8(b)).join(' ');
    const postHex = postRecord.length > 0 ? printBytes(dlData, recordEnd, Math.min(postRecord.length, 32)) : '(end)';
    const postLen = postRecord.length;

    console.log(`Face #${String(i).padStart(2)} | verts=${String(f.vertexCount).padStart(4)} | head: ${headerHex} | gap-to-next: ${String(postLen).padStart(4)} bytes`);
    if (postLen > 0 && postLen <= 64) {
        console.log(`         gap bytes: ${postHex}`);
    }
    if (postLen > 64) {
        console.log(`         gap bytes (first 32): ${printBytes(dlData, recordEnd, 32)}`);
    }
    console.log('');
}

// ============================================================
// Detailed byte dump around each FAIL face's header region
// ============================================================

console.log('\n=== DETAILED BYTE DUMPS AROUND FAIL FACES ===\n');

// The FAIL faces are: #0, #59-67 in the validation output
// These correspond to face records at certain positions
// Let me check which raw records produce which validation faces

// Load STEP for validation
const stepText = fs.readFileSync(STEP, 'utf8');
const ents = parseSTEP(stepText);
const lookup = buildLookup(ents);

// Now re-run the extraction with the same logic as the validator to map faces
const mesh = extractMesh(buf);
for (const v of mesh.vertices) { v[0] *= 1000; v[1] *= 1000; v[2] *= 1000; }

function triArea(a, b, c) {
    const e1 = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
    const e2 = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
    const n = [e1[1]*e2[2]-e1[2]*e2[1], e1[2]*e2[0]-e1[0]*e2[2], e1[0]*e2[1]-e1[1]*e2[0]];
    return Math.sqrt(n[0]*n[0]+n[1]*n[1]+n[2]*n[2]) / 2;
}

function findMatchingSTEPFace(slVerts, stepFaces, lookup, tolerance) {
    let bestFace = null, bestScore = -1;
    for (const sf of stepFaces) {
        const surf = lookup.surfData[sf.surfId];
        if (!surf || !surf.a2p3d) continue;
        let matchCount = 0;
        for (const v of slVerts) {
            const d = distToSurface(v, surf, lookup);
            if (d !== null && d < tolerance) matchCount++;
        }
        const score = matchCount / slVerts.length;
        if (score > bestScore) { bestScore = score; bestFace = sf; }
    }
    return { face: bestFace, score: bestScore };
}

// Map validation face indices to raw record indices
// The validator iterates mesh.faces which are produced by _extractModernSurfaces
// which iterates markerPositions in order. So mesh face index = valid record index.
// Let me verify this by checking if the counts match.

console.log(`Mesh has ${mesh.faces.length} faces, raw parser has ${faces.length} records`);
console.log('');

// For each FAIL face, find which raw record it maps to, and examine the raw bytes more closely
const FAIL_INDICES = [0, 59, 60, 61, 62, 63, 64, 65, 66, 67];

for (const fi of FAIL_INDICES) {
    if (fi >= faces.length) continue;
    const f = faces[fi];
    const recordStart = f.mp - 4;

    // Dump 64 bytes BEFORE the record start
    console.log(`\n--- FAIL Face #${fi} (raw record at 0x${hex32(recordStart)}) ---`);
    console.log(`  Vertex count: ${f.vertexCount}, edgeCount: ${f.edgeCount}`);

    // 64 bytes before the record
    const before = Math.max(0, recordStart - 64);
    console.log(`  64 bytes BEFORE record (0x${hex32(before)}):`);
    console.log(`    ${printBytes(dlData, before, 64)}`);

    // The header (20 bytes from recordStart)
    console.log(`  Header (20 bytes from 0x${hex32(recordStart)}):`);
    console.log(`    ${printBytes(dlData, recordStart, 20)}`);

    // First 36 bytes of vertex data (3 vertices)
    console.log(`  First 3 vertices (36 bytes from 0x${hex32(f.vertStart)}):`);
    console.log(`    ${printBytes(dlData, f.vertStart, 36)}`);

    // Dump the 3 vertices as floats
    console.log(`  Vertex float values:`);
    for (let i = 0; i < Math.min(6, f.vertexCount); i++) {
        const off = f.vertStart + i * 12;
        const x = dlData.readFloatLE(off);
        const y = dlData.readFloatLE(off + 4);
        const z = dlData.readFloatLE(off + 8);
        console.log(`    v${i}: (${x.toFixed(6)}, ${y.toFixed(6)}, ${z.toFixed(6)})`);
    }
    if (f.vertexCount > 6) console.log(`    ... (${f.vertexCount - 6} more vertices)`);

    // Find what STEP surface this matches
    const vertsScaled = f.verts.map(v => [v[0]*1000, v[1]*1000, v[2]*1000]);
    const { face: stepF, score } = findMatchingSTEPFace(vertsScaled, lookup.faces, lookup, 0.5);
    if (stepF) {
        const surf = lookup.surfData[stepF.surfId];
        console.log(`  Best STEP match: face #${stepF.id} (${surf?.type || '?'}) score=${(score*100).toFixed(0)}%`);

        // Check distance for each vertex to this surface
        let maxDist = 0;
        let matchCount = 0;
        for (const v of vertsScaled) {
            const d = distToSurface(v, surf, lookup);
            if (d !== null && d < 0.5) matchCount++;
            if (d !== null && d > maxDist) maxDist = d;
        }
        console.log(`  maxDist=${maxDist.toFixed(3)}, matchCount=${matchCount}/${f.vertexCount} (${(matchCount/f.vertexCount*100).toFixed(0)}%)`);
    }

    // Now look at the gap between this face's end and the next face
    if (fi < faces.length - 1) {
        const next = faces[fi + 1];
        const gapStart = f.endOffset;
        const gapEnd = next.mp - 4;
        const gapLen = gapEnd - gapStart;
        console.log(`  Gap to next record: ${gapLen} bytes (0x${hex32(gapStart)} - 0x${hex32(gapEnd)})`);
        if (gapLen > 0 && gapLen <= 128) {
            console.log(`  Gap bytes: ${printBytes(dlData, gapStart, Math.min(gapLen, 64))}`);
            if (gapLen > 64) {
                console.log(`    ... + ${gapLen - 64} more bytes`);
            }
        }
    } else {
        console.log(`  (Last face record)`);
    }
}

// ============================================================
// Compare OK faces vs FAIL faces header patterns
// ============================================================

console.log('\n\n=== HEADER PATTERN COMPARISON: OK vs FAIL ===\n');

// Run validation to get status for each face
const faceResults = [];
for (let fi = 0; fi < mesh.faces.length; fi++) {
    const face = mesh.faces[fi];
    if (face.length < 3) { faceResults.push('SKIP'); continue; }
    const verts = face.map(idx => mesh.vertices[idx]);
    const { face: stepF, score } = findMatchingSTEPFace(verts, lookup.faces, lookup, 0.5);
    if (!stepF || score < 0.3) { faceResults.push('MISS'); continue; }
    const surf = lookup.surfData[stepF.surfId];
    let faceMaxDist = 0;
    for (const v of verts) {
        const d = distToSurface(v, surf, lookup);
        if (d !== null && d > faceMaxDist) faceMaxDist = d;
    }
    faceResults.push(faceMaxDist < 0.5 ? 'OK' : faceMaxDist < 1.5 ? 'WARN' : 'FAIL');
}

console.log('Face # | Status | edgeCount | header bytes (20)               | gap-to-next');
console.log('-------|--------|-----------|----------------------------------|------------');

for (let i = 0; i < Math.min(faces.length, faceResults.length); i++) {
    const f = faces[i];
    const status = faceResults[i];
    const headerBytes = [];
    for (let b = f.mp - 4; b < f.mp + 16; b++) {
        headerBytes.push(hex8(dlData[b]));
    }

    let gapLen = '?';
    if (i < faces.length - 1) {
        gapLen = String(faces[i + 1].mp - 4 - f.endOffset);
    }

    console.log(`${String(i).padStart(6)} | ${status.padStart(6)} | 0x${hex32(f.edgeCount)} | ${headerBytes.join(' ')} | ${gapLen}`);
}

// ============================================================
// Deep analysis: look for patterns in the 4 bytes BEFORE edgeCount
// ============================================================

console.log('\n\n=== 4-BYTE PRE-HEADER ANALYSIS (bytes before edgeCount) ===\n');
console.log('Looking for surface ID or group ID patterns...\n');

// Group faces by status
const okIndices = [], failIndices = [];
for (let i = 0; i < faceResults.length; i++) {
    if (faceResults[i] === 'OK') okIndices.push(i);
    if (faceResults[i] === 'FAIL') failIndices.push(i);
}

console.log('OK faces pre-header (4 bytes before edgeCount):');
for (const i of okIndices) {
    if (i >= faces.length) continue;
    const f = faces[i];
    const pre = [];
    for (let b = f.mp - 8; b < f.mp - 4; b++) pre.push(hex8(dlData[b]));
    console.log(`  Face #${String(i).padStart(2)}: ${pre.join(' ')}  (as uint32: 0x${hex32(dlData.readUInt32LE(f.mp - 8))})`);
}

console.log('\nFAIL faces pre-header (4 bytes before edgeCount):');
for (const i of failIndices) {
    if (i >= faces.length) continue;
    const f = faces[i];
    const pre = [];
    for (let b = f.mp - 8; b < f.mp - 4; b++) pre.push(hex8(dlData[b]));
    console.log(`  Face #${String(i).padStart(2)}: ${pre.join(' ')}  (as uint32: 0x${hex32(dlData.readUInt32LE(f.mp - 8))})`);
}

// ============================================================
// Look for any additional markers or structures
// ============================================================

console.log('\n\n=== SEARCHING FOR ADDITIONAL STRUCTURE MARKERS ===\n');

// Look for patterns that appear before groups of faces
// Check if there's a "surface group" header

// Look for uint32 values that appear consistently before face groups
// Check 8-12 bytes before each face's edgeCount
console.log('Bytes at -12 to -4 relative to each face record:');
console.log('Face# | -12..-8 (hex)           | -8..-4 (hex)           | -4..-0 (edgeCount hex)');
console.log('------|-------------------------|------------------------|------------------------');

for (let i = 0; i < faces.length; i++) {
    const f = faces[i];
    const r = f.mp - 4; // record start (edgeCount)
    const b12 = [];
    const b8 = [];
    const b4 = [];
    for (let b = r - 12; b < r - 8; b++) b12.push(hex8(dlData[b]));
    for (let b = r - 8; b < r - 4; b++) b8.push(hex8(dlData[b]));
    for (let b = r - 4; b < r; b++) b4.push(hex8(dlData[b]));
    console.log(`${String(i).padStart(5)} | ${b12.join(' ')} | ${b8.join(' ')} | ${b4.join(' ')}  (${faceResults[i] || '?'})`);
}

// ============================================================
// Final: check if the vertex data itself contains sub-face boundaries
// ============================================================

console.log('\n\n=== CHECKING FOR INTERNAL FACE BOUNDARIES WITHIN FAIL FACES ===\n');
console.log('If a face has vertices from multiple STEP surfaces, there may be\n');
console.log('discontinuities in the vertex sequence that indicate sub-boundaries.\n');

for (const fi of failIndices) {
    if (fi >= faces.length) continue;
    const f = faces[fi];
    const vertsScaled = f.verts.map(v => [v[0]*1000, v[1]*1000, v[2]*1000]);

    // Find which STEP surfaces the vertices belong to
    const surfHits = new Map(); // surfId -> count
    for (const v of vertsScaled) {
        let bestSurf = null, bestDist = Infinity;
        for (const sf of lookup.faces) {
            const surf = lookup.surfData[sf.surfId];
            if (!surf || !surf.a2p3d) continue;
            const d = distToSurface(v, surf, lookup);
            if (d !== null && d < bestDist) { bestDist = d; bestSurf = sf.surfId; }
        }
        if (bestSurf !== null && bestDist < 0.5) {
            surfHits.set(bestSurf, (surfHits.get(bestSurf) || 0) + 1);
        }
    }

    console.log(`Face #${fi} (${f.vertexCount} verts) - surface distribution:`);
    const sorted = [...surfHits.entries()].sort((a, b) => b[1] - a[1]);
    for (const [sid, count] of sorted) {
        const sf = lookup.faces.find(f => f.surfId === sid);
        const surf = lookup.surfData[sid];
        console.log(`  surfId=${sid} (${surf?.type || '?'}): ${count} verts (${(count/f.vertexCount*100).toFixed(0)}%)`);
    }

    // Now look for discontinuities: find where consecutive vertices jump between surfaces
    let transitions = 0;
    let lastSurf = null;
    for (let vi = 0; vi < vertsScaled.length; vi++) {
        const v = vertsScaled[vi];
        let bestSurf = null, bestDist = Infinity;
        for (const sf of lookup.faces) {
            const surf = lookup.surfData[sf.surfId];
            if (!surf || !surf.a2p3d) continue;
            const d = distToSurface(v, surf, lookup);
            if (d !== null && d < bestDist) { bestDist = d; bestSurf = sf.surfId; }
        }
        if (bestSurf !== null && bestDist < 0.5) {
            if (lastSurf !== null && bestSurf !== lastSurf) transitions++;
            lastSurf = bestSurf;
        }
    }
    console.log(`  Surface transitions in vertex order: ${transitions}`);
    console.log('');
}

console.log('\nDone.');
