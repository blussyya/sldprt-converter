#!/usr/bin/env node
'use strict';
/**
 * TEST: B1 values as indices into a virtual table in the pre-face region.
 *
 * Key observation: max(B1) ≈ pre_face_bytes / 4 for GEAR and DEKOR.
 * This suggests B1 values are u32 indices into a table stored before the faces.
 *
 * The table might not start at byte 0. It might start at a base offset.
 * We need to find the base by testing offsets.
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

for (const f of files) {
    if (!fs.existsSync(f.path)) continue;
    const buf = fs.readFileSync(f.path);
    const dl = findDisplayLists(buf);
    if (!dl) continue;

    const faces = extractFaces(dl);
    const allB1 = faces.flatMap(fa => fa.block1).filter(v => v > 0);
    const sortedB1 = [...allB1].sort((a, b) => a - b);
    const maxB1 = sortedB1[sortedB1.length - 1];
    const minB1 = sortedB1[0];
    const firstFaceOff = Math.min(...faces.map(fa => fa.mp - 4));

    console.log(`\n${'='.repeat(70)}`);
    console.log(`${f.name}: dlSize=${dl.length}, faces=${faces.length}, B1 range=[${minB1},${maxB1}]`);
    console.log(`First face at offset ${firstFaceOff} (${(firstFaceOff / 1024).toFixed(1)} KB)`);
    console.log(`Pre-face region: ${firstFaceOff} bytes = ${(firstFaceOff / 4).toFixed(0)} u32s`);
    console.log(`maxB1 / (pre_face/4) = ${(maxB1 / (firstFaceOff / 4) * 100).toFixed(1)}%`);

    // TEST A: Scan all possible base offsets to find which base makes B1 values
    // point to consistent data structures
    console.log(`\nTEST A: Find base offset where B1[index] points to structured data`);
    console.log('Testing base offsets in steps of 4 bytes...');

    let bestBase = 0;
    let bestScore = 0;
    const baseScores = [];

    for (let base = 0; base < firstFaceOff; base += 4) {
        let score = 0;
        let checked = 0;

        for (const v of allB1) {
            const idx = base + v * 4;
            if (idx + 4 > dl.length) continue;
            checked++;
            const val = dl.readUInt32LE(idx);

            // Score: prefer values that look like valid u32 (not NaN, not huge floats)
            if (val < 1000000) score++;

            // Bonus: values that appear elsewhere in the stream
            // (structural consistency)
        }

        if (checked > 0) {
            const normalizedScore = score / checked;
            baseScores.push({ base, score: normalizedScore, checked });
            if (normalizedScore > bestScore) {
                bestScore = normalizedScore;
                bestBase = base;
            }
        }
    }

    baseScores.sort((a, b) => b.score - a.score);
    console.log(`Top 10 base offsets by consistency:`);
    for (const { base, score, checked } of baseScores.slice(0, 10)) {
        console.log(`  base=${base} (${(base / 4).toFixed(0)} u32s): score=${(score * 100).toFixed(1)}% checked=${checked}`);
    }

    // TEST B: For the best base, check what the "table" looks like
    console.log(`\nTEST B: Table contents at base=${bestBase} (${(bestBase / 4).toFixed(0)} u32s)`);
    console.log('First 50 entries of the virtual table:');

    for (let i = 0; i < 50; i++) {
        const idx = bestBase + i * 4;
        if (idx + 4 > dl.length) break;
        const val = dl.readUInt32LE(idx);
        const flt = dl.readFloatLE(idx);
        const isFloat = isFinite(flt) && Math.abs(flt) > 0.001 && Math.abs(flt) < 10000;
        console.log(`  [${i}] offset=${idx} u32=${val} ${isFloat ? `flt=${flt.toFixed(4)}` : ''}`);
    }

    // TEST C: Check if B1 values index into the table at specific entries
    // If the table has N entries, and B1 values are in range [0, N-1],
    // then for each face's Block 1, the table entries should be consistent
    // (e.g., all pointing to face data, or all of a specific type)
    console.log(`\nTEST C: Table entries referenced by Block 1 values (first 5 faces)`);

    for (let fi = 0; fi < Math.min(5, faces.length); fi++) {
        const face = faces[fi];
        console.log(`\n  Face #${fi} (ec=${face.ec}, vc=${face.vc}, B1=[${face.block1.join(',')}]):`);
        for (const v of face.block1.slice(0, 8)) {
            if (v === 0) continue;
            const idx = bestBase + v * 4;
            if (idx + 16 > dl.length) continue;
            const u32 = [
                dl.readUInt32LE(idx),
                dl.readUInt32LE(idx + 4),
                dl.readUInt32LE(idx + 8),
                dl.readUInt32LE(idx + 12)
            ];
            const flt = [
                dl.readFloatLE(idx),
                dl.readFloatLE(idx + 4),
                dl.readFloatLE(idx + 8),
                dl.readFloatLE(idx + 12)
            ];
            const hasStruct = u32[0] === 4 && u32[1] === 8 && u32[2] === 2;
            console.log(`    B1=${v} → table[${v}] u32=[${u32.join(',')}] ${hasStruct ? 'HAS_HEADER!' : ''}`);
        }
    }

    // TEST D: What if B1 values are NOT indices but byte offsets?
    // Test: B1 value = byte offset from base
    console.log(`\nTEST D: B1 values as byte offsets from base 0`);
    console.log('Checking if B1 values point to [4,8,2,...] headers:');

    let headerHits = 0;
    for (const v of allB1) {
        if (v + 12 > dl.length) continue;
        if (dl.readUInt32LE(v) === 4 && dl.readUInt32LE(v + 4) === 8 && dl.readUInt32LE(v + 8) === 2) {
            headerHits++;
            if (headerHits <= 5) {
                console.log(`  B1=${v} → byte offset ${v} HAS [4,8,2,${dl.readUInt32LE(v + 12)}] header!`);
            }
        }
    }
    console.log(`  Total: ${headerHits}/${allB1.length} (${(headerHits / allB1.length * 100).toFixed(1)}%)`);

    // TEST E: B1 value = byte offset / 4 (u32 index from byte 0)
    console.log(`\nTEST E: B1 values as u32 indices from byte 0 (B1*4 = byte offset)`);
    headerHits = 0;
    for (const v of allB1) {
        const off = v * 4;
        if (off + 12 > dl.length) continue;
        if (dl.readUInt32LE(off) === 4 && dl.readUInt32LE(off + 4) === 8 && dl.readUInt32LE(off + 8) === 2) {
            headerHits++;
            if (headerHits <= 5) {
                console.log(`  B1=${v} → byte ${off} HAS [4,8,2,${dl.readUInt32LE(off + 12)}] header!`);
            }
        }
    }
    console.log(`  Total: ${headerHits}/${allB1.length} (${(headerHits / allB1.length * 100).toFixed(1)}%)`);

    // TEST F: What if B1 values index into a table of [4,8,2,N]+body records?
    // The table would be at some base, and each entry is a record of variable size.
    // To index into it, you'd need to skip entries. B1 might be a sequential index.
    console.log(`\nTEST F: B1 values as sequential record indices`);
    console.log('Collecting [4,8,2,N] records in pre-face region:');

    const records = [];
    for (let i = 0; i < firstFaceOff - 16; i += 4) {
        if (dl.readUInt32LE(i) === 4 && dl.readUInt32LE(i + 4) === 8 && dl.readUInt32LE(i + 8) === 2) {
            const N = dl.readUInt32LE(i + 12);
            if (N > 0 && N < 100000) {
                const bodyEnd = i + 16 + N * 4;
                if (bodyEnd <= firstFaceOff) {
                    records.push({ offset: i, N, bodyEnd });
                }
            }
        }
    }

    console.log(`  Found ${records.length} [4,8,2,N] records in pre-face region`);
    console.log(`  maxB1 = ${maxB1}, records.length = ${records.length}`);
    console.log(`  maxB1 / records.length = ${(maxB1 / records.length).toFixed(2)}`);

    // If B1 values are record indices, then B1[i] should index records[i]
    // But records might be of different sizes...
    // Let's check: for each face's Block 1, do the indexed records have consistent N?
    if (records.length > maxB1) {
        console.log(`\n  Records indexed by B1 values (first 5 faces):`);
        for (let fi = 0; fi < Math.min(5, faces.length); fi++) {
            const face = faces[fi];
            const indexedRecords = face.block1
                .filter(v => v > 0 && v < records.length)
                .map(v => ({ b1: v, ...records[v] }));
            console.log(`  Face #${fi}: B1 values index ${indexedRecords.length} records`);
            for (const r of indexedRecords.slice(0, 5)) {
                console.log(`    B1=${r.b1} → record at offset=${r.offset}, N=${r.N}`);
            }
        }
    } else {
        console.log(`  NOT enough records (${records.length}) for maxB1 (${maxB1})`);
        console.log(`  B1 values cannot be sequential record indices`);
    }
}
