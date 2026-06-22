#!/usr/bin/env node
/**
 * Diagnostic: Deep binary structure analysis of DisplayLists face records
 * Goal: Find triangle connectivity / index data in the face chunks
 * 
 * Tests the hypothesis that triangle indices are stored AFTER vertex data + normals,
 * before the next face starts.
 */

const fs = require('fs');
const path = require('path');
const { ensureBuffer } = require('./ole2-parser.js');
const zlib = require('zlib');

// ============================================================
// Helpers
// ============================================================

function hex8(b) { return b.toString(16).padStart(2, '0'); }
function hex32(v) { return v.toString(16).padStart(8, '0'); }
function dec(v) { return v.toString().padStart(6); }

function printBytes(buf, offset, count) {
    const parts = [];
    for (let i = 0; i < count && offset + i < buf.length; i++) {
        parts.push(hex8(buf[offset + i]));
    }
    return parts.join(' ');
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

function rolByte(b, shift) {
    shift &= 7;
    if (shift === 0) return b;
    return ((b << shift) | (b >>> (8 - shift))) & 0xFF;
}

// ============================================================
// Extract DisplayLists from SLDPRT (openswx format)
// ============================================================

const SLDPRT = path.join('..', '..', 'test files original', 'usb hub case (ultimate test)', 'USB hub case BOTTOM.SLDPRT');
console.log(`Loading: ${SLDPRT}`);
const buf = fs.readFileSync(SLDPRT);
console.log(`File size: ${buf.length} bytes`);

// Decompress openswx streams
const key = buf[7];
const streamMarker = new Uint8Array([0x14, 0x00, 0x06, 0x00, 0x08, 0x00]);
const streams = {};
for (const mp of findAll(buf, streamMarker)) {
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
        try { decompressed = zlib.inflateRawSync(Buffer.from(buf.subarray(nameEnd, dataEnd))); } catch(e) {}
        if (!decompressed || decompressed.length === 0) {
            try { decompressed = zlib.inflateSync(Buffer.from(buf.subarray(nameEnd, dataEnd))); } catch(e) {}
        }
        if (decompressed && decompressed.length > 0 && !streams[name]) streams[name] = decompressed;
    }
}

let dlData = null;
for (const [name, data] of Object.entries(streams)) {
    if (name.toLowerCase().includes('displaylist') && data.length > 100) {
        const d = ensureBuffer(data);
        if (d.readUInt32LE(0) === 1 && d.readUInt32LE(4) === 1) {
            dlData = ensureBuffer(data);
            console.log(`Found DisplayLists stream "${name}": ${dlData.length} bytes`);
            break;
        }
    }
}

if (!dlData) {
    console.error('ERROR: Could not find DisplayLists stream');
    process.exit(1);
}

// ============================================================
// Find face records using the MARKER pattern
// ============================================================

const MARKER = new Uint8Array([0x0c, 0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00]);
const markerPositions = findAll(dlData, MARKER);
console.log(`\nFound ${markerPositions.length} MARKER positions (0x0C, 0x64)`);

// Parse each face record
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

    // Validate vertices
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

    faces.push({
        idx: faces.length,
        markerOffset: mp,
        edgeCountOffset: mp - 4,
        edgeCount,
        headerStart: mp - 4,  // where edgeCount u32 starts
        vertStart,
        vertEnd: vertStart + vertexCount * 12,
        vertexCount,
    });
}

console.log(`Parsed ${faces.length} valid face records\n`);

// Compute gap sizes (bytes between one face's vertex data end and the next face's edgeCount start)
for (let i = 0; i < faces.length; i++) {
    const f = faces[i];
    if (i + 1 < faces.length) {
        f.gapStart = f.vertEnd;
        f.gapEnd = faces[i + 1].headerStart;
        f.gapSize = f.gapEnd - f.gapStart;
    } else {
        f.gapStart = f.vertEnd;
        f.gapEnd = dlData.length;
        f.gapSize = f.gapEnd - f.gapStart;
    }
}

// ============================================================
// SECTION 1: Dump header bytes for first 4 faces
// ============================================================

console.log('='.repeat(80));
console.log('SECTION 1: FACE HEADER STRUCTURE (first 4 faces)');
console.log('='.repeat(80));
console.log('');
console.log('Layout: [edgeCount:u32] [0x0C:u32] [0x64:u32] [faceType:u32] [vertexCount:u32] [vertices...]');
console.log('Offsets: mp-4           mp         mp+4       mp+8          mp+12          mp+16');
console.log('');

for (let i = 0; i < Math.min(4, faces.length); i++) {
    const f = faces[i];
    console.log(`--- Face #${i} ---`);
    console.log(`  Header offset range: 0x${hex32(f.headerStart)} - 0x${hex32(f.vertStart - 1)} (${f.vertStart - f.headerStart} bytes)`);
    
    // Dump raw bytes of the header (20 bytes: edgeCount + marker(8) + faceType + vertexCount)
    console.log(`  Raw header bytes (${f.headerStart}..${f.vertStart - 1}):`);
    console.log(`    ${printBytes(dlData, f.headerStart, 20)}`);
    
    // Parse each u32 in the header
    for (let off = 0; off < 20; off += 4) {
        const absOff = f.headerStart + off;
        const u = dlData.readUInt32LE(absOff);
        const f32 = dlData.readFloatLE(absOff);
        let label = '';
        if (off === 0) label = 'edgeCount';
        else if (off === 4) label = 'marker[0] = 0x0C';
        else if (off === 8) label = 'marker[1] = 0x64';
        else if (off === 12) label = 'faceType';
        else if (off === 16) label = 'vertexCount';
        
        const isFloat = isFinite(f32) && Math.abs(f32) < 100000 && Math.abs(f32) > 0.001;
        console.log(`    [+${String(off).padStart(2)}] u32=${dec(u)} (0x${hex32(u)})  float=${f32.toFixed(6)}  ${label}  ${isFloat ? '← also valid float' : ''}`);
    }
    console.log('');
}

// ============================================================
// SECTION 2: Gap analysis - what's between faces?
// ============================================================

console.log('='.repeat(80));
console.log('SECTION 2: GAP BETWEEN FACES (vertex data end → next face header)');
console.log('='.repeat(80));
console.log('');
console.log('The gap contains: [padding? 16 bytes] [normals: vertexCount × 12 bytes] [??? unknown data]');
console.log('');

for (let i = 0; i < Math.min(4, faces.length); i++) {
    const f = faces[i];
    if (f.gapSize <= 0) continue;
    
    console.log(`--- Face #${i} → Face #${i + 1} ---`);
    console.log(`  Vertex data: ${f.vertexCount} verts × 12 bytes = ${f.vertexCount * 12} bytes`);
    console.log(`  Gap: ${f.gapSize} bytes (0x${hex32(f.gapStart)} - 0x${hex32(f.gapEnd)})`);
    
    // What the code currently expects: 16 bytes padding + vertexCount * 12 bytes normals
    const expectedNormals = f.vertexCount * 12;
    const expectedTotal = 16 + expectedNormals;
    console.log(`  Expected (16 pad + ${f.vertexCount} × 12 normals): ${expectedTotal} bytes`);
    console.log(`  Actual gap: ${f.gapSize} bytes`);
    console.log(`  Extra bytes beyond normals: ${f.gapSize - expectedTotal}`);
    
    // Dump the first 48 bytes of the gap (16-byte header + 8 floats)
    console.log(`  First 48 bytes of gap:`);
    for (let off = 0; off < Math.min(48, f.gapSize); off += 4) {
        const absOff = f.gapStart + off;
        const u = dlData.readUInt32LE(absOff);
        const f32 = dlData.readFloatLE(absOff);
        const marker = off < 16 ? 'HEADER' : (off === 16 ? 'vertCount?' : (off >= 20 && off < 20 + expectedNormals ? 'NORMALS' : '???'));
        console.log(`    [+${String(off).padStart(3)}] u32=${dec(u)} (0x${hex32(u)})  float=${f32.toFixed(6).padStart(12)}  ${marker}`);
    }
    console.log('');
}

// ============================================================
// SECTION 3: Hex dump of the first 4 faces' full chunk
// ============================================================

console.log('='.repeat(80));
console.log('SECTION 3: FULL HEX DUMP OF FACE CHUNKS (header + vertices + gap)');
console.log('='.repeat(80));
console.log('');

for (let i = 0; i < Math.min(4, faces.length); i++) {
    const f = faces[i];
    const chunkStart = f.headerStart;
    const chunkEnd = f.gapEnd;
    const chunkSize = chunkEnd - chunkStart;
    
    console.log(`--- Face #${i}: 0x${hex32(chunkStart)} - 0x${hex32(chunkEnd)} (${chunkSize} bytes) ---`);
    console.log(`  edgeCount=${f.edgeCount} vertexCount=${f.vertexCount}`);
    console.log(`  Bytes: header(20) + vertices(${f.vertexCount * 12}) + gap(${f.gapSize})`);
    
    // Dump hex in rows of 16 bytes
    const maxBytes = Math.min(chunkSize, 512); // limit output
    for (let row = 0; row < maxBytes; row += 16) {
        const rowOff = chunkStart + row;
        const hexParts = [];
        const asciiParts = [];
        for (let col = 0; col < 16 && row + col < chunkSize; col++) {
            const b = dlData[rowOff + col];
            hexParts.push(hex8(b));
            asciiParts.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.');
        }
        // Mark boundaries
        let boundary = '';
        if (row === 0) boundary = ' ← HEADER START (edgeCount)';
        if (row === 4) boundary = ' ← MARKER 0x0C';
        if (row === 8) boundary = ' ← MARKER 0x64';
        if (row === 12) boundary = ' ← faceType';
        if (row === 16) boundary = ' ← vertexCount';
        if (row === 20) boundary = ' ← VERTEX DATA START';
        const vertDataBytes = f.vertexCount * 12;
        if (row === 20 + vertDataBytes) boundary = ' ← GAP START (normals/data)';
        
        console.log(`  ${hex32(rowOff)}: ${hexParts.join(' ')}  ${asciiParts.join('')}${boundary}`);
    }
    if (chunkSize > maxBytes) {
        console.log(`  ... (${chunkSize - maxBytes} more bytes)`);
    }
    console.log('');
}

// ============================================================
// SECTION 4: Search for triangle index data
// ============================================================

console.log('='.repeat(80));
console.log('SECTION 4: SEARCH FOR TRIANGLE INDEX DATA');
console.log('='.repeat(80));
console.log('');
console.log('Testing hypothesis: triangle indices stored as u32 values after normals');
console.log('');

for (let i = 0; i < Math.min(4, faces.length); i++) {
    const f = faces[i];
    if (f.gapSize <= 16) continue;
    
    const afterNormals = f.gapStart + 16 + f.vertexCount * 12;
    const remaining = f.gapEnd - afterNormals;
    
    console.log(`--- Face #${i} ---`);
    console.log(`  After normals: offset=0x${hex32(afterNormals)}, remaining=${remaining} bytes`);
    
    if (remaining <= 0) {
        console.log('  No data after normals!');
        continue;
    }
    
    // Check if remaining bytes could be u32 triangle indices
    // For a face with N vertices, triangulation produces ~(N-2) triangles = ~3*(N-2) indices
    const expectedTriCount = f.vertexCount - 2;
    const expectedTriBytes = expectedTriCount * 3 * 4;
    console.log(`  Expected triangulation: ~${expectedTriCount} triangles = ~${expectedTriBytes} bytes of indices`);
    console.log(`  Actual remaining: ${remaining} bytes`);
    console.log(`  Remaining / 4 = ${remaining / 4} u32s`);
    console.log(`  Remaining / 2 = ${remaining / 2} u16s`);
    
    // Dump the remaining bytes
    if (remaining > 0) {
        console.log(`  Raw bytes after normals:`);
        for (let off = 0; off < Math.min(remaining, 128); off += 4) {
            const absOff = afterNormals + off;
            const u = dlData.readUInt32LE(absOff);
            const f32 = dlData.readFloatLE(absOff);
            const u16a = dlData.readUInt16LE(absOff);
            const u16b = dlData.readUInt16LE(absOff + 2);
            
            // Check if it looks like vertex indices (small integers < vertexCount)
            const looksLikeIndices = u < f.vertexCount && u >= 0 && u16a < f.vertexCount && u16b < f.vertexCount;
            
            console.log(`    [+${String(off).padStart(3)}] u32=${dec(u)} (0x${hex32(u)})  float=${f32.toFixed(6).padStart(12)}  u16=${u16a},${u16b}  ${looksLikeIndices ? '← POSSIBLE INDICES' : ''}`);
        }
    }
    console.log('');
}

// ============================================================
// SECTION 5: Analyze the full gap structure more carefully
// ============================================================

console.log('='.repeat(80));
console.log('SECTION 5: FULL GAP ANALYSIS - ALL DATA BETWEEN FACES');
console.log('='.repeat(80));
console.log('');
console.log('Detailed byte-by-byte analysis of the gap for Face #0:');
console.log('');

const f0 = faces[0];
const gapLen = f0.gapSize;
console.log(`Gap: ${gapLen} bytes`);
console.log('');

// Try to identify structure by looking at repeating patterns
// The gap might have: [16-byte sub-header] [per-vertex data] [index data]

// First 16 bytes: looks like a second copy of the header
console.log('Sub-header (first 16 bytes):');
for (let off = 0; off < Math.min(16, gapLen); off += 4) {
    const u = dlData.readUInt32LE(f0.gapStart + off);
    const f32 = dlData.readFloatLE(f0.gapStart + off);
    console.log(`  [${String(off).padStart(2)}] u32=${dec(u)} (0x${hex32(u)})  float=${f32.toFixed(6)}`);
}

// After sub-header: should be vertexCount u32 value + then normals
const subHdrVertCount = dlData.readUInt32LE(f0.gapStart + 16);
console.log(`\n  Sub-header vertexCount field: ${subHdrVertCount} (matches face vertexCount=${f0.vertexCount}? ${subHdrVertCount === f0.vertexCount})`);

// Check if the sub-header has different values than the main header
const mainEdgeCount = dlData.readUInt32LE(f0.headerStart);
const subEdgeCount = dlData.readUInt32LE(f0.gapStart);
console.log(`  Main header edgeCount: ${mainEdgeCount}`);
console.log(`  Sub-header edgeCount: ${subEdgeCount}`);

// After the 16-byte sub-header, check what's there
console.log(`\nData after sub-header (bytes 16..${gapLen - 1}):`);
const afterSubHdr = gapLen - 16;
console.log(`  ${afterSubHdr} bytes remaining`);
console.log(`  /4 = ${afterSubHdr / 4} u32s`);
console.log(`  /12 = ${afterSubHdr / 12} float triples (normals?)`);

// Check if afterSubHdr / 12 == vertexCount (normals match)
if (Math.abs(afterSubHdr / 12 - f0.vertexCount) < 0.1) {
    console.log(`  ✓ Divides evenly by 12 → likely ${f0.vertexCount} normal vectors`);
} else {
    console.log(`  ✗ Does NOT divide evenly by 12 → extra data beyond normals!`);
    const normalBytes = f0.vertexCount * 12;
    const extraBytes = afterSubHdr - normalBytes;
    console.log(`  Normals: ${normalBytes} bytes`);
    console.log(`  Extra: ${extraBytes} bytes`);
    console.log(`  Extra / 4 = ${extraBytes / 4} u32s`);
    
    if (extraBytes > 0) {
        console.log(`\n  EXTRA DATA after normals:`);
        for (let off = 0; off < Math.min(extraBytes, 256); off += 4) {
            const absOff = f0.gapStart + 16 + normalBytes + off;
            if (absOff + 4 > f0.gapEnd) break;
            const u = dlData.readUInt32LE(absOff);
            const f32 = dlData.readFloatLE(absOff);
            const looksLikeIdx = u < f0.vertexCount && u >= 0;
            console.log(`    [+${String(off).padStart(3)}] u32=${dec(u)} (0x${hex32(u)})  float=${f32.toFixed(6).padStart(12)}  ${looksLikeIdx ? '← POSSIBLE INDEX' : ''}`);
        }
    }
}

// ============================================================
// SECTION 6: Compare gap sizes across all faces
// ============================================================

console.log('\n' + '='.repeat(80));
console.log('SECTION 6: GAP SIZE ANALYSIS ACROSS ALL FACES');
console.log('='.repeat(80));
console.log('');

console.log('Face#  edgeCount  vertCount  gapSize  gap-16-normals  (gap-16)/vertCount');
for (let i = 0; i < Math.min(20, faces.length); i++) {
    const f = faces[i];
    const normalBytes = f.vertexCount * 12;
    const extra = f.gapSize - 16 - normalBytes;
    const ratio = f.gapSize > 0 ? ((f.gapSize - 16) / f.vertexCount).toFixed(1) : '?';
    console.log(`  ${String(i).padStart(3)}    ${String(f.edgeCount).padStart(5)}      ${String(f.vertexCount).padStart(5)}    ${String(f.gapSize).padStart(6)}    ${String(extra).padStart(6)}         ${ratio}`);
}

// ============================================================
// SECTION 7: Look for u16 triangle strip indices
// ============================================================

console.log('\n' + '='.repeat(80));
console.log('SECTION 7: SEARCH FOR u16 TRIANGLE STRIP INDICES');
console.log('='.repeat(80));
console.log('');
console.log('Some formats use u16 indices. Check if the extra data contains u16 values < vertexCount');
console.log('');

for (let i = 0; i < Math.min(4, faces.length); i++) {
    const f = faces[i];
    const afterNormals = f.gapStart + 16 + f.vertexCount * 12;
    const remaining = f.gapEnd - afterNormals;
    if (remaining < 4) continue;
    
    console.log(`--- Face #${i} (${f.vertexCount} verts, ${remaining} bytes after normals) ---`);
    
    // Scan for u16 pairs that look like vertex indices
    let consecutiveIndices = 0;
    let maxConsecutive = 0;
    let totalIndices = 0;
    
    for (let off = 0; off < remaining; off += 2) {
        const absOff = afterNormals + off;
        if (absOff + 2 > f.gapEnd) break;
        const u16 = dlData.readUInt16LE(absOff);
        if (u16 < f.vertexCount) {
            totalIndices++;
            consecutiveIndices++;
            if (consecutiveIndices > maxConsecutive) maxConsecutive = consecutiveIndices;
        } else {
            consecutiveIndices = 0;
        }
    }
    
    const totalU16 = remaining / 2;
    console.log(`  Total u16 values: ${totalU16}`);
    console.log(`  Values < vertexCount: ${totalIndices} (${(totalIndices / totalU16 * 100).toFixed(1)}%)`);
    console.log(`  Max consecutive valid: ${maxConsecutive}`);
    
    // Show first 32 u16 values
    console.log(`  First 32 u16 values:`);
    const vals = [];
    for (let off = 0; off < Math.min(64, remaining); off += 2) {
        const absOff = afterNormals + off;
        if (absOff + 2 > f.gapEnd) break;
        vals.push(dlData.readUInt16LE(absOff));
    }
    console.log(`    ${vals.map(v => String(v).padStart(5)).join(' ')}`);
    console.log('');
}

// ============================================================
// SECTION 8: Look at the bytes right BEFORE the next face's edgeCount
// ============================================================

console.log('='.repeat(80));
console.log('SECTION 8: BYTES JUST BEFORE NEXT FACE (possible index trailer)');
console.log('='.repeat(80));
console.log('');

for (let i = 0; i < Math.min(4, faces.length); i++) {
    const f = faces[i];
    if (i + 1 >= faces.length) continue;
    
    const nextFaceStart = faces[i + 1].headerStart;
    const lookback = 64;
    const startOff = Math.max(f.vertEnd, nextFaceStart - lookback);
    
    console.log(`--- Face #${i} → Face #${i + 1} (looking back ${lookback} bytes from next face) ---`);
    console.log(`  Next face edgeCount at: 0x${hex32(nextFaceStart)}`);
    console.log(`  Looking at bytes: 0x${hex32(startOff)} - 0x${hex32(nextFaceStart - 1)}`);
    console.log('');
    
    for (let off = startOff; off < nextFaceStart; off += 16) {
        const hexParts = [];
        const valParts = [];
        for (let col = 0; col < 16 && off + col < nextFaceStart; col++) {
            const absOff = off + col;
            hexParts.push(hex8(dlData[absOff]));
            if (col % 4 === 0 && absOff + 4 <= nextFaceStart) {
                const u = dlData.readUInt32LE(absOff);
                valParts.push(`u32=${dec(u)}`);
            }
        }
        const marker = off === nextFaceStart - 4 ? ' ← NEXT FACE edgeCount' : '';
        console.log(`  ${hex32(off)}: ${hexParts.join(' ')}  ${valParts.join(' | ')}${marker}`);
    }
    console.log('');
}

console.log('\nDone.');
