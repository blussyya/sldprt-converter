#!/usr/bin/env node
/**
 * Diagnostic Part 2: Deep dive into gap structure for larger faces
 * Focus on: edge connectivity data, the sub-header structure, and what's between faces
 */

const fs = require('fs');
const path = require('path');
const { ensureBuffer } = require('./ole2-parser.js');
const zlib = require('zlib');

function hex8(b) { return b.toString(16).padStart(2, '0'); }
function hex32(v) { return v.toString(16).padStart(8, '0'); }
function dec(v) { return v.toString().padStart(6); }

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
// Extract DisplayLists
// ============================================================

const SLDPRT = path.join('..', '..', 'test files original', 'usb hub case (ultimate test)', 'USB hub case BOTTOM.SLDPRT');
const buf = fs.readFileSync(SLDPRT);
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
            break;
        }
    }
}

console.log(`DisplayLists: ${dlData.length} bytes`);

// ============================================================
// Find and parse all faces
// ============================================================

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

    faces.push({
        idx: faces.length,
        markerOffset: mp,
        edgeCount,
        vertStart,
        vertEnd: vertStart + vertexCount * 12,
        vertexCount,
    });
}

// Compute gaps
for (let i = 0; i < faces.length; i++) {
    const f = faces[i];
    f.gapStart = f.vertEnd;
    f.gapEnd = (i + 1 < faces.length) ? faces[i + 1].markerOffset - 4 : dlData.length;
    f.gapSize = f.gapEnd - f.gapStart;
}

console.log(`Parsed ${faces.length} faces\n`);

// ============================================================
// ANALYSIS 1: Sub-header structure
// ============================================================

console.log('='.repeat(80));
console.log('ANALYSIS 1: SUB-HEADER STRUCTURE (gap start)');
console.log('='.repeat(80));
console.log('');
console.log('The gap starts with a 16-byte "sub-header" that repeats the face marker.');
console.log('Layout: [0x0C:u32] [0x64:u32] [faceType:u32] [vertexCount:u32]');
console.log('');

for (let i = 0; i < Math.min(10, faces.length); i++) {
    const f = faces[i];
    if (f.gapSize < 16) continue;
    
    const sh0 = dlData.readUInt32LE(f.gapStart);
    const sh1 = dlData.readUInt32LE(f.gapStart + 4);
    const sh2 = dlData.readUInt32LE(f.gapStart + 8);
    const sh3 = dlData.readUInt32LE(f.gapStart + 12);
    
    const isMarker = sh0 === 0x0C && sh1 === 0x64 && sh2 === 2;
    const vertMatch = sh3 === f.vertexCount;
    
    console.log(`Face #${String(i).padStart(2)} | edge=${String(f.edgeCount).padStart(3)} vert=${String(f.vertexCount).padStart(4)} gap=${String(f.gapSize).padStart(5)} | sub-hdr: [${dec(sh0)},${dec(sh1)},${dec(sh2)},${dec(sh3)}] marker=${isMarker} vertMatch=${vertMatch}`);
}

// ============================================================
// ANALYSIS 2: What comes AFTER the sub-header + normals?
// ============================================================

console.log('\n' + '='.repeat(80));
console.log('ANALYSIS 2: DATA AFTER SUB-HEADER + NORMALS');
console.log('='.repeat(80));
console.log('');
console.log('Layout: [sub-header:16] [normals:vertCount×12] [??? unknown] [unicode_string] [trailer]');
console.log('');

for (let i = 0; i < Math.min(6, faces.length); i++) {
    const f = faces[i];
    if (f.gapSize < 16 + f.vertexCount * 12) continue;
    
    const afterNormals = f.gapStart + 16 + f.vertexCount * 12;
    const remaining = f.gapEnd - afterNormals;
    
    console.log(`--- Face #${i} (edge=${f.edgeCount}, vert=${f.vertexCount}) ---`);
    console.log(`  Gap: ${f.gapSize} bytes`);
    console.log(`  Sub-header: 16 bytes`);
    console.log(`  Normals: ${f.vertexCount * 12} bytes`);
    console.log(`  Remaining after normals: ${remaining} bytes`);
    
    if (remaining <= 0) {
        console.log('  No data after normals!');
        continue;
    }
    
    // Search for unicode string (UTF-16LE pattern: alternating ASCII + 0x00)
    let unicodeStart = -1;
    for (let off = 0; off < Math.min(remaining, 200); off += 2) {
        const absOff = afterNormals + off;
        const ch = dlData[absOff];
        const zero = dlData[absOff + 1];
        if (ch >= 0x41 && ch <= 0x7A && zero === 0) {
            // Looks like ASCII letter in UTF-16LE
            if (unicodeStart === -1) unicodeStart = off;
        } else if (unicodeStart !== -1) {
            // End of unicode sequence - check if it's a surface name
            const len = off - unicodeStart;
            if (len >= 8) {
                let str = '';
                for (let j = unicodeStart; j < off; j += 2) {
                    const c = dlData[afterNormals + j];
                    str += String.fromCharCode(c);
                }
                console.log(`  Unicode string at +${unicodeStart}: "${str}" (${len} bytes)`);
            }
            unicodeStart = -1;
        }
    }
    
    // Dump first 32 u32s after normals
    console.log(`  First 32 u32s after normals:`);
    for (let off = 0; off < Math.min(128, remaining); off += 4) {
        const absOff = afterNormals + off;
        const u = dlData.readUInt32LE(absOff);
        const f32 = dlData.readFloatLE(absOff);
        const isValidVert = u < f.vertexCount;
        console.log(`    [+${String(off).padStart(3)}] u32=${dec(u)} (0x${hex32(u)})  float=${f32.toFixed(6).padStart(12)}  ${isValidVert ? '<- idx' : ''}`);
    }
    console.log('');
}

// ============================================================
// ANALYSIS 3: The Unicode strings between faces
// ============================================================

console.log('='.repeat(80));
console.log('ANALYSIS 3: UNICODE SURFACE IDENTIFICATION STRINGS');
console.log('='.repeat(80));
console.log('');

for (let i = 0; i < Math.min(8, faces.length - 1); i++) {
    const f = faces[i];
    const nextF = faces[i + 1];
    
    // Search backwards from next face for the unicode string
    const searchStart = Math.max(f.gapStart, nextF.markerOffset - 4 - 200);
    
    // Find UTF-16LE string by looking for sequences of [char, 0x00]
    let bestStr = '';
    let bestStart = -1;
    let curStr = '';
    let curStart = -1;
    
    for (let off = searchStart; off < nextF.markerOffset - 4; off += 2) {
        const ch = dlData[off];
        const zero = dlData[off + 1];
        if (ch >= 0x20 && ch <= 0x7E && zero === 0) {
            if (curStart === -1) curStart = off;
            curStr += String.fromCharCode(ch);
        } else {
            if (curStr.length > bestStr.length) {
                bestStr = curStr;
                bestStart = curStart;
            }
            curStr = '';
            curStart = -1;
        }
    }
    if (curStr.length > bestStr.length) {
        bestStr = curStr;
        bestStart = curStart;
    }
    
    if (bestStr.length > 5) {
        console.log(`Face #${i} → Face #${i + 1}: "${bestStr}" at 0x${hex32(bestStart)}`);
        
        // Show bytes after the string
        const strEnd = bestStart + bestStr.length * 2;
        const trailer = [];
        for (let off = strEnd; off < Math.min(strEnd + 32, nextF.markerOffset - 4); off += 4) {
            trailer.push(dlData.readUInt32LE(off));
        }
        console.log(`  Trailer u32s: ${trailer.map(v => dec(v)).join(', ')}`);
    }
}

// ============================================================
// ANALYSIS 4: Face #4 (edgeCount=13, vertexCount=50) - deep dive
// ============================================================

console.log('\n' + '='.repeat(80));
console.log('ANALYSIS 4: DEEP DIVE - Face #4 (edge=13, vert=50)');
console.log('='.repeat(80));
console.log('');

const f4 = faces[4];
console.log(`Face #4: edgeCount=${f4.edgeCount} vertexCount=${f4.vertexCount}`);
console.log(`Gap: ${f4.gapSize} bytes (0x${hex32(f4.gapStart)} - 0x${hex32(f4.gapEnd)})`);
console.log('');

const afterNormals4 = f4.gapStart + 16 + f4.vertexCount * 12;
const remaining4 = f4.gapEnd - afterNormals4;
console.log(`After normals: ${remaining4} bytes remaining`);
console.log('');

// Dump all data after normals in structured blocks
console.log('Data after normals (structured dump):');
for (let off = 0; off < Math.min(remaining4, 400); off += 4) {
    const absOff = afterNormals4 + off;
    const u = dlData.readUInt32LE(absOff);
    const f32 = dlData.readFloatLE(absOff);
    
    // Is it a valid vertex index?
    const isValidIdx = u < f4.vertexCount;
    // Is it a small integer that could be a count?
    const isSmallInt = u >= 0 && u <= 20;
    // Does it look like a float in reasonable range?
    const isReasonableFloat = isFinite(f32) && Math.abs(f32) < 1000 && Math.abs(f32) > 0.001;
    
    let marker = '';
    if (isValidIdx) marker = '<- INDEX';
    else if (isSmallInt && off < 200) marker = '<- count?';
    else if (isReasonableFloat) marker = '<- float';
    
    console.log(`  [+${String(off).padStart(4)}] u32=${dec(u)} (0x${hex32(u)})  float=${f32.toFixed(6).padStart(12)}  ${marker}`);
}

// ============================================================
// ANALYSIS 5: Search for triangle strip patterns
// ============================================================

console.log('\n' + '='.repeat(80));
console.log('ANALYSIS 5: TRIANGLE STRIP / INDEX SEARCH');
console.log('='.repeat(80));
console.log('');
console.log('Looking for sequences of u32 values that could be vertex indices');
console.log('(all values < vertexCount, forming triples for triangles)');
console.log('');

// For each face, scan the extra data for sequences of valid vertex indices
for (let i = 0; i < Math.min(10, faces.length); i++) {
    const f = faces[i];
    if (f.gapSize < 16 + f.vertexCount * 12 + 12) continue;
    
    const afterNormals = f.gapStart + 16 + f.vertexCount * 12;
    const remaining = f.gapEnd - afterNormals;
    if (remaining < 12) continue;
    
    // Scan for runs of valid vertex indices
    let runs = [];
    let curRun = [];
    let curRunStart = -1;
    
    for (let off = 0; off < remaining; off += 4) {
        const absOff = afterNormals + off;
        const u = dlData.readUInt32LE(absOff);
        
        if (u < f.vertexCount) {
            if (curRun.length === 0) curRunStart = off;
            curRun.push(u);
        } else {
            if (curRun.length >= 3) {
                runs.push({ start: curRunStart, count: curRun.length, vals: curRun.slice(0, 20) });
            }
            curRun = [];
        }
    }
    if (curRun.length >= 3) {
        runs.push({ start: curRunStart, count: curRun.length, vals: curRun.slice(0, 20) });
    }
    
    if (runs.length > 0) {
        console.log(`Face #${i} (vert=${f.vertexCount}): ${runs.length} runs of valid indices`);
        for (const r of runs) {
            const triples = Math.floor(r.count / 3);
            console.log(`  offset=+${String(r.start).padStart(4)} len=${String(r.count).padStart(3)} triples=${String(triples).padStart(3)} vals=[${r.vals.join(',')}${r.count > 20 ? '...' : ''}]`);
        }
    }
}

// ============================================================
// ANALYSIS 6: Check if the "extra data" repeats the face structure
// ============================================================

console.log('\n' + '='.repeat(80));
console.log('ANALYSIS 6: REPEATED FACE STRUCTURE IN GAP');
console.log('='.repeat(80));
console.log('');
console.log('Checking if the gap contains another face header (edgeCount + marker + faceType + vertexCount)');
console.log('');

for (let i = 0; i < Math.min(6, faces.length); i++) {
    const f = faces[i];
    if (f.gapSize < 32) continue;
    
    console.log(`--- Face #${i} (edge=${f.edgeCount}, vert=${f.vertexCount}) ---`);
    
    // Check every 4-byte aligned position in the gap for a face header pattern
    let found = [];
    for (let off = 0; off < f.gapSize - 16; off += 4) {
        const absOff = f.gapStart + off;
        const v0 = dlData.readUInt32LE(absOff);      // potential edgeCount
        const v1 = dlData.readUInt32LE(absOff + 4);   // potential marker[0]
        const v2 = dlData.readUInt32LE(absOff + 8);   // potential marker[1]
        const v3 = dlData.readUInt32LE(absOff + 12);  // potential faceType
        const v4 = dlData.readUInt32LE(absOff + 16);  // potential vertexCount
        
        if (v1 === 0x0C && v2 === 0x64 && v3 === 2 && v4 >= 3 && v4 <= 5000) {
            found.push({ off, edgeCount: v0, vertexCount: v4 });
        }
    }
    
    if (found.length > 0) {
        console.log(`  Found ${found.length} face-header-like patterns:`);
        for (const fh of found) {
            console.log(`    gap+${String(fh.off).padStart(4)}: edgeCount=${fh.edgeCount} vertexCount=${fh.vertexCount}`);
        }
    } else {
        console.log(`  No face-header patterns found in gap`);
    }
}

// ============================================================
// ANALYSIS 7: Boundary bytes - what exactly separates faces?
// ============================================================

console.log('\n' + '='.repeat(80));
console.log('ANALYSIS 7: FACE BOUNDARY STRUCTURE');
console.log('='.repeat(80));
console.log('');
console.log('Examining the exact bytes at each face boundary');
console.log('');

for (let i = 0; i < Math.min(6, faces.length - 1); i++) {
    const f = faces[i];
    const nextF = faces[i + 1];
    
    // The boundary is: [face i gap data] ... [face i+1 edgeCount] [face i+1 marker...]
    // Look at 32 bytes before face i+1's edgeCount
    const lookback = 32;
    const startOff = Math.max(f.gapStart, nextF.markerOffset - 4 - lookback);
    
    console.log(`--- Face #${i} → Face #${i + 1} ---`);
    console.log(`  Face #${i + 1} edgeCount at: 0x${hex32(nextF.markerOffset - 4)}`);
    
    // Dump the last 32 bytes of face i's gap
    for (let off = startOff; off < nextF.markerOffset - 4; off += 4) {
        const u = dlData.readUInt32LE(off);
        const inGap = off >= f.gapStart && off < f.gapEnd;
        const marker = off === nextF.markerOffset - 4 - 4 ? ' <- last u32 before next face' : '';
        console.log(`  0x${hex32(off)}: u32=${dec(u)} (0x${hex32(u)})  ${inGap ? '[in gap]' : '[??]'}${marker}`);
    }
    console.log('');
}

// ============================================================
// ANALYSIS 8: Quantify the "extra" data per face
// ============================================================

console.log('='.repeat(80));
console.log('ANALYSIS 8: EXTRA DATA QUANTIFICATION');
console.log('='.repeat(80));
console.log('');
console.log('Face#  edgeCnt  vertCnt  gapSize  subHdr  normals  extra   extra/vert  extra/edge');
console.log('');

for (let i = 0; i < Math.min(20, faces.length); i++) {
    const f = faces[i];
    const subHdr = 16;
    const normals = f.vertexCount * 12;
    const extra = f.gapSize - subHdr - normals;
    const extraPerVert = f.vertexCount > 0 ? (extra / f.vertexCount).toFixed(1) : '?';
    const extraPerEdge = f.edgeCount > 0 ? (extra / f.edgeCount).toFixed(1) : '?';
    
    console.log(`  ${String(i).padStart(3)}    ${String(f.edgeCount).padStart(5)}    ${String(f.vertexCount).padStart(5)}    ${String(f.gapSize).padStart(5)}   ${String(subHdr).padStart(4)}   ${String(normals).padStart(6)}   ${String(extra).padStart(5)}    ${String(extraPerVert).padStart(7)}    ${String(extraPerEdge).padStart(7)}`);
}

// ============================================================
// ANALYSIS 9: Try reading extra data as pairs of u16 (edge vertex indices)
// ============================================================

console.log('\n' + '='.repeat(80));
console.log('ANALYSIS 9: EDGE VERTEX INDEX PAIRS (u16)');
console.log('='.repeat(80));
console.log('');
console.log('Reading extra data as u16 pairs (v0, v1) - potential edge definitions');
console.log('');

for (let i = 0; i < Math.min(6, faces.length); i++) {
    const f = faces[i];
    const afterNormals = f.gapStart + 16 + f.vertexCount * 12;
    const remaining = f.gapEnd - afterNormals;
    if (remaining < 8) continue;
    
    console.log(`--- Face #${i} (edge=${f.edgeCount}, vert=${f.vertexCount}, extra=${remaining} bytes) ---`);
    
    // Read as u16 pairs
    const pairs = [];
    for (let off = 0; off < remaining; off += 4) {
        const absOff = afterNormals + off;
        if (absOff + 4 > f.gapEnd) break;
        const lo = dlData.readUInt16LE(absOff);
        const hi = dlData.readUInt16LE(absOff + 2);
        pairs.push({ lo, hi, off });
    }
    
    // Show first 20 pairs
    console.log(`  First 20 u16 pairs (lo, hi):`);
    for (let j = 0; j < Math.min(20, pairs.length); j++) {
        const p = pairs[j];
        const loValid = p.lo < f.vertexCount;
        const hiValid = p.hi < f.vertexCount;
        const bothValid = loValid && hiValid;
        console.log(`    [+${String(p.off).padStart(3)}] (${String(p.lo).padStart(4)}, ${String(p.hi).padStart(4)})  ${bothValid ? '<- BOTH VALID' : (loValid ? '<- lo valid' : (hiValid ? '<- hi valid' : ''))}`);
    }
    
    // Count how many pairs have both values < vertexCount
    const validPairs = pairs.filter(p => p.lo < f.vertexCount && p.hi < f.vertexCount);
    console.log(`  Valid pairs (both < ${f.vertexCount}): ${validPairs.length} out of ${pairs.length}`);
    console.log('');
}

console.log('\nDone.');
