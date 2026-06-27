#!/usr/bin/env node
'use strict';
/**
 * Deep analysis of the DEKOR virtual table at base=80424.
 * 
 * Discovery: B1 values index into a table at offset 80424 in DEKOR's DisplayLists.
 * Table contains only 0 and 49024 (0xBF80 = -1.0 in float16).
 * 92.8% consistency score.
 *
 * Questions:
 * 1. What is the exact table structure?
 * 2. Is there a header before the table?
 * 3. Can we find the same pattern in other files?
 * 4. Does the table contain meaningful data or is it a mask?
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function rolByte(b, shift) { shift &= 7; if (shift === 0) return b; return ((b << shift) | (b >>> (8 - shift))) & 0xFF; }
function findAll(buf, pattern) { const pos = []; for (let i = 0; i <= buf.length - pattern.length; i++) { let ok = true; for (let j = 0; j < pattern.length; j++) { if (buf[i + j] !== pattern[j]) { ok = false; break; } } if (ok) pos.push(i); } return pos; }
function decompressOpenSX(buf) { const key = buf[7]; const marker = [0x14, 0x00, 0x06, 0x00, 0x08, 0x00]; const streams = {}; for (const mp of findAll(buf, marker)) { const si = mp - 4; if (si < 0 || si + 0x1E > buf.length) continue; const csz = buf.readUInt32LE(si + 0x12); const nsz = buf.readUInt32LE(si + 0x1A); if (nsz > 1024 || csz > 50 * 1024 * 1024) continue; const nameStart = si + 0x1E; const nameEnd = nameStart + nsz; if (nameEnd > buf.length) continue; const rawName = buf.subarray(nameStart, nameEnd); let name = ''; for (let i = 0; i < nsz; i++) name += String.fromCharCode(rolByte(rawName[i], key)); if (name.length === 0) continue; const dataStart = nameEnd; const dataEnd = dataStart + csz; if (dataEnd > buf.length) continue; const f1 = buf.readUInt32LE(si + 0x0E); if (f1 >= 65536 && csz > 0) { const compressed = buf.subarray(dataStart, dataEnd); let decompressed = null; try { decompressed = zlib.inflateRawSync(Buffer.from(compressed)); } catch (e) { try { decompressed = zlib.inflateSync(Buffer.from(compressed)); } catch (e2) {} } if (decompressed && decompressed.length > 0 && !streams[name]) streams[name] = decompressed; } } return streams; }
function findDisplayLists(buf) { const streams = decompressOpenSX(buf); for (const [name, data] of Object.entries(streams)) { if (name.toLowerCase().includes('displaylist') && data.length > 100) { const d = Buffer.isBuffer(data) ? data : Buffer.from(data); if (d.readUInt32LE(0) === 1 && d.readUInt32LE(4) === 1) return data; } } return null; }

function extractFaces(dlData) {
    const data = dlData;
    const results = [];
    const MARKER = Buffer.from([0x0c, 0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00]);
    for (const mp of findAll(data, MARKER)) {
        if (mp < 4) continue;
        const ec = data.readUInt32LE(mp - 4);
        if (ec < 1 || ec > 500) continue;
        if (data.readUInt32LE(mp + 8) !== 2) continue;
        const vc = data.readUInt32LE(mp + 12);
        if (vc < 3 || vc > 5000) continue;
        const vertStart = mp + 16;
        if (vertStart + vc * 12 > data.length) continue;
        let valid = true;
        for (let i = 0; i < vc; i++) {
            const x = data.readFloatLE(vertStart + i * 12);
            if (!isFinite(x) || Math.abs(x) > 100000) { valid = false; break; }
        }
        if (!valid) continue;
        const vertEnd = vertStart + vc * 12;
        const normStart = vertEnd + 16;
        const normEnd = normStart + vc * 12;
        const topoStart = normEnd;
        if (topoStart + 16 > data.length) continue;
        if (data.readUInt32LE(topoStart) !== 4 || data.readUInt32LE(topoStart + 4) !== 8 || data.readUInt32LE(topoStart + 8) !== 2) continue;
        const N = data.readUInt32LE(topoStart + 12);
        if (topoStart + 16 + N * 4 > data.length) continue;
        const block1 = [];
        for (let i = 0; i < N; i++) block1.push(data.readUInt32LE(topoStart + 16 + i * 4));
        const b2Start = topoStart + (N + 4) * 4;
        let block2 = [];
        if (b2Start + 12 <= data.length && data.readUInt32LE(b2Start) === 4 && data.readUInt32LE(b2Start + 4) === 8 && data.readUInt32LE(b2Start + 8) === 2) {
            const M = data.readUInt32LE(b2Start + 12);
            for (let i = 0; i < M; i++) block2.push(data.readUInt32LE(b2Start + 16 + i * 4));
        }
        results.push({ ec, vc, mp, block1, block2, topoStart, vertEnd: normEnd, normEnd, vertStart });
    }
    return results;
}

const RESEARCH_DIR = 'C:\\Users\\basha\\Desktop\\soldiworks research';
const files = [
    { name: 'BOTTOM', path: path.join(RESEARCH_DIR, 'test files original', 'usb hub case (ultimate test)', 'USB hub case BOTTOM.SLDPRT') },
    { name: 'TOP', path: path.join(RESEARCH_DIR, 'test files original', 'usb hub case (ultimate test)', 'USB hub case TOP.SLDPRT') },
    { name: 'GEAR', path: path.join(RESEARCH_DIR, 'test files original', 'Helical Bevel Gear.SLDPRT') },
    { name: 'DEKOR', path: path.join(RESEARCH_DIR, 'test files original', 'Dekor.SLDPRT') }
];

// ============================================================
// ANALYSIS 1: DEKOR table structure
// ============================================================
function analyzeDekorTable(dl) {
    const BASE = 80424;
    const faces = extractFaces(dl);
    const allB1 = faces.flatMap(fa => fa.block1).filter(v => v > 0);
    const maxB1 = Math.max(...allB1);

    console.log(`\n${'='.repeat(70)}`);
    console.log('DEKOR TABLE ANALYSIS');
    console.log(`${'='.repeat(70)}`);

    // What's immediately before the table?
    console.log(`\nBytes before table (offset ${BASE-64} to ${BASE}):`);
    for (let i = BASE - 64; i < BASE; i += 4) {
        const v = dl.readUInt32LE(i);
        const f = dl.readFloatLE(i);
        console.log(`  [${i}] u32=${v} ${isFinite(f) && Math.abs(f) > 0.001 ? `flt=${f.toFixed(4)}` : ''}`);
    }

    // Table header scan: look for [4,8,2,N] before the table
    console.log(`\nLooking for [4,8,2,N] header before table:`);
    for (let i = BASE - 100; i < BASE; i += 4) {
        if (i + 16 > dl.length) continue;
        if (dl.readUInt32LE(i) === 4 && dl.readUInt32LE(i + 4) === 8 && dl.readUInt32LE(i + 8) === 2) {
            console.log(`  FOUND at offset ${i}: [4,8,2,${dl.readUInt32LE(i + 12)}]`);
        }
    }

    // Unique values in the table
    const valueCounts = new Map();
    for (let i = BASE; i < BASE + (maxB1 + 1) * 4 && i + 4 <= dl.length; i += 4) {
        const v = dl.readUInt32LE(i);
        valueCounts.set(v, (valueCounts.get(v) || 0) + 1);
    }

    console.log(`\nUnique values in table (0 to maxB1):`);
    for (const [v, c] of [...valueCounts.entries()].sort((a, b) => b[1] - a[1])) {
        const f16_low = v & 0xFFFF;
        const f16_high = (v >>> 16) & 0xFFFF;
        console.log(`  u32=${v} (0x${v.toString(16).padStart(8, '0')}) count=${c} f16_low=${f16_low} (0x${f16_low.toString(16).padStart(4, '0')}) f16_high=${f16_high} (0x${f16_high.toString(16).padStart(4, '0')})`);
    }

    // What fraction of table entries are 0 vs non-zero?
    let zeros = 0, nonzeros = 0;
    for (let i = BASE; i < BASE + (maxB1 + 1) * 4 && i + 4 <= dl.length; i += 4) {
        if (dl.readUInt32LE(i) === 0) zeros++;
        else nonzeros++;
    }
    console.log(`\nTable entries: ${zeros} zeros, ${nonzeros} non-zero (${(nonzeros / (zeros + nonzeros) * 100).toFixed(1)}% non-zero)`);

    // Does each face have a consistent mix of 0/non-zero B1 values?
    console.log(`\nPer-face B1 value patterns (0 vs non-zero):`);
    for (let fi = 0; fi < Math.min(20, faces.length); fi++) {
        const face = faces[fi];
        const b1NonZero = face.block1.filter(v => v > 0);
        const b1Zero = face.block1.filter(v => v === 0);
        const tableVals = b1NonZero.map(v => dl.readUInt32LE(BASE + v * 4));
        const tableZeros = tableVals.filter(v => v === 0).length;
        const tableNonZeros = tableVals.filter(v => v !== 0).length;
        console.log(`  Face #${fi.toString().padStart(2)} ec=${face.ec} vc=${face.vc} B1_len=${face.block1.length} nonZero=${b1NonZero.length} zero=${b1Zero.length} tableZero=${tableZeros} tableNonZero=${tableNonZeros}`);
    }

    // Are the non-zero table values all 49024?
    let all49024 = true;
    for (let i = BASE; i < BASE + (maxB1 + 1) * 4 && i + 4 <= dl.length; i += 4) {
        const v = dl.readUInt32LE(i);
        if (v !== 0 && v !== 49024) {
            all49024 = false;
            console.log(`\n  NON-49024 value at offset ${i}: u32=${v}`);
        }
    }
    console.log(`\nAll non-zero values are 49024: ${all49024}`);
}

// ============================================================
// ANALYSIS 2: Find the table in other files
// ============================================================
function findTableInFile(name, dl) {
    const faces = extractFaces(dl);
    const allB1 = faces.flatMap(fa => fa.block1).filter(v => v > 0);
    const maxB1 = Math.max(...allB1);

    console.log(`\n${'='.repeat(70)}`);
    console.log(`${name}: Searching for table pattern`);
    console.log(`${'='.repeat(70)}`);

    // Strategy: For each possible base, count how many B1 values index
    // to entries that are either 0 or a single repeated non-zero value
    let bestBase = 0;
    let bestScore = 0;
    let bestNonZeroVal = 0;

    // Only test bases in the pre-face region
    const firstFaceOff = Math.min(...faces.map(fa => fa.mp - 4));

    for (let base = 0; base < firstFaceOff; base += 4) {
        // Collect unique non-zero values at B1-indexed positions
        const nonZeroVals = new Map();
        let zeros = 0;
        let total = 0;
        let valid = true;

        for (const v of allB1) {
            const idx = base + v * 4;
            if (idx + 4 > dl.length) { valid = false; break; }
            total++;
            const val = dl.readUInt32LE(idx);
            if (val === 0) {
                zeros++;
            } else {
                nonZeroVals.set(val, (nonZeroVals.get(val) || 0) + 1);
            }
        }

        if (!valid || total === 0) continue;

        // Score: prefer tables where all non-zero values are the same
        if (nonZeroVals.size <= 3) {
            const dominantVal = [...nonZeroVals.entries()].sort((a, b) => b[1] - a[1])[0];
            const dominantCount = dominantVal ? dominantVal[1] : 0;
            const score = (zeros + dominantCount) / total;

            if (score > bestScore) {
                bestScore = score;
                bestBase = base;
                bestNonZeroVal = dominantVal ? dominantVal[0] : 0;
            }
        }
    }

    console.log(`Best base: ${bestBase} (${(bestBase / 4).toFixed(0)} u32s)`);
    console.log(`Score: ${(bestScore * 100).toFixed(1)}%`);
    console.log(`Non-zero value: ${bestNonZeroVal} (0x${bestNonZeroVal.toString(16)})`);

    // Show unique values at this base
    const valueCounts = new Map();
    for (const v of allB1) {
        const idx = bestBase + v * 4;
        if (idx + 4 > dl.length) continue;
        const val = dl.readUInt32LE(idx);
        valueCounts.set(val, (valueCounts.get(val) || 0) + 1);
    }
    console.log(`Unique table values:`);
    for (const [v, c] of [...valueCounts.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  u32=${v} (0x${v.toString(16).padStart(8, '0')}) count=${c}`);
    }

    // Show what's before the table
    console.log(`\nBytes before table (offset ${bestBase - 32} to ${bestBase}):`);
    for (let i = bestBase - 32; i < bestBase; i += 4) {
        if (i < 0 || i + 4 > dl.length) continue;
        const v = dl.readUInt32LE(i);
        console.log(`  [${i}] u32=${v}`);
    }

    return { base: bestBase, score: bestScore, nonZeroVal: bestNonZeroVal };
}

// ============================================================
// MAIN
// ============================================================
for (const f of files) {
    if (!fs.existsSync(f.path)) continue;
    const buf = fs.readFileSync(f.path);
    const dl = findDisplayLists(buf);
    if (!dl) continue;

    if (f.name === 'DEKOR') {
        analyzeDekorTable(dl);
    } else {
        findTableInFile(f.name, dl);
    }
}
