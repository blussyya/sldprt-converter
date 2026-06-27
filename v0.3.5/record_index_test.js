#!/usr/bin/env node
'use strict';
/**
 * DISCRIMINATING EXPERIMENT: Block 1 values as record indices
 *
 * Hypothesis: Block 1 values are indices into record arrays found in
 * non-face regions. Value × record_stride = byte offset into array.
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
        results.push({ ec, vc, mp, block1, block2, topoStart, vertEnd: normEnd, normEnd });
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
    if (!dl) { console.log(`${f.name}: no DisplayLists`); continue; }

    const faces = extractFaces(dl);
    const maxB1 = Math.max(...faces.flatMap(fa => fa.block1));
    const maxB2 = Math.max(...faces.flatMap(fa => fa.block2));

    console.log(`\n${'='.repeat(60)}`);
    console.log(`${f.name}: ${faces.length} faces, maxB1=${maxB1}, maxB2=${maxB2}, dlSize=${dl.length}`);

    // Test 1: Value × stride lands outside face regions?
    // Common strides: the record sizes found by universe_discovery
    const strides = [4, 8, 12, 16, 20, 24, 32, 48, 64, 100, 128, 256];
    const faceRegions = faces.map(fa => ({
        start: fa.mp - 4,
        end: fa.normEnd + fa.vc * 12
    }));

    console.log(`\nTEST 1: B1_value × stride → non-face offset`);
    console.log('stride | inRange/total | pct  | sample_offset');
    console.log('-------|---------------|------|--------------');

    for (const stride of strides) {
        let inRange = 0;
        let total = 0;
        let sampleOff = -1;

        for (const face of faces) {
            for (const v of face.block1) {
                if (v === 0) continue;
                total++;
                const offset = v * stride;
                if (offset < dl.length) {
                    const inFace = faceRegions.some(r => offset >= r.start && offset < r.end);
                    if (!inFace) {
                        inRange++;
                        if (sampleOff < 0) sampleOff = offset;
                    }
                }
            }
        }

        const pct = (inRange / total * 100).toFixed(1);
        console.log(`${String(stride).padStart(6)} | ${String(inRange).padStart(5)}/${String(total).padStart(5)} | ${String(pct).padStart(5)}% | ${sampleOff >= 0 ? sampleOff : 'N/A'}`);
    }

    // Test 2: For the best stride, inspect what's at the hit offsets
    // Pick stride where highest pct of B1 values land outside faces
    let bestStride = 12;
    let bestPct = 0;
    for (const stride of strides) {
        let inRange = 0;
        let total = 0;
        for (const face of faces) {
            for (const v of face.block1) {
                if (v === 0) continue;
                total++;
                const offset = v * stride;
                if (offset < dl.length) {
                    const inFace = faceRegions.some(r => offset >= r.start && offset < r.end);
                    if (!inFace) inRange++;
                }
            }
        }
        const pct = inRange / total;
        if (pct > bestPct) { bestPct = pct; bestStride = stride; }
    }

    console.log(`\nTEST 2: Best stride = ${bestStride} (${(bestPct * 100).toFixed(1)}% non-face)`);
    console.log('Inspecting data at B1_value × stride offsets:');

    let hitCount = 0;
    const hitTypes = { struct: 0, float: 0, integer: 0, zero: 0, other: 0 };

    for (const face of faces.slice(0, 5)) {
        for (const v of face.block1.slice(0, 10)) {
            if (v === 0) continue;
            const offset = v * bestStride;
            if (offset + 16 > dl.length) continue;
            const inFace = faceRegions.some(r => offset >= r.start && offset < r.end);
            if (inFace) continue;

            const u32 = [
                dl.readUInt32LE(offset),
                dl.readUInt32LE(offset + 4),
                dl.readUInt32LE(offset + 8),
                dl.readUInt32LE(offset + 12)
            ];
            const flt = [
                dl.readFloatLE(offset),
                dl.readFloatLE(offset + 4),
                dl.readFloatLE(offset + 8),
                dl.readFloatLE(offset + 12)
            ];

            const isStruct = u32[0] === 4 && u32[1] === 8 && u32[2] === 2;
            const isFloat = flt.some(f => Math.abs(f) > 0.001 && Math.abs(f) < 10000 && !isNaN(f));
            const isZero = u32.every(v => v === 0);
            const type = isStruct ? 'struct' : isFloat ? 'float' : isZero ? 'zero' : 'integer';

            hitTypes[type]++;
            hitCount++;

            if (hitCount <= 20) {
                console.log(`  B1=${v} → off=${offset} u32=[${u32.join(',')}] flt=[${flt.map(x => x.toFixed(3)).join(',')}] → ${type}`);
            }
        }
    }

    console.log(`\nType distribution: struct=${hitTypes.struct} float=${hitTypes.float} integer=${hitTypes.integer} zero=${hitTypes.zero} other=${hitTypes.other} (of ${hitCount})`);

    // Test 3: B1 values as offsets into a specific region
    // Check if B1 values could be byte offsets (divided by 4) into Block 1/2 arrays
    console.log(`\nTEST 3: B1 values as u32 array indices`);
    console.log('If B1[i] indexes a virtual u32 array, what is the array length?');
    const allB1 = faces.flatMap(fa => fa.block1).filter(v => v > 0);
    const sortedB1 = [...allB1].sort((a, b) => a - b);
    console.log(`  B1 range: ${sortedB1[0]}-${sortedB1[sortedB1.length - 1]}, count=${allB1.length}`);
    console.log(`  If array of u32: ${(sortedB1[sortedB1.length - 1] + 1) * 4} bytes = ${((sortedB1[sortedB1.length - 1] + 1) * 4 / 1024).toFixed(1)} KB`);

    // Test 4: B1 values as relative offsets within the pre-face region
    console.log(`\nTEST 4: B1 values as byte offsets within pre-face region`);
    const firstFaceOffset = Math.min(...faces.map(fa => fa.mp - 4));
    console.log(`  First face starts at offset ${firstFaceOffset} (${(firstFaceOffset / 1024).toFixed(1)} KB)`);
    let inPreFace = 0;
    for (const v of allB1) {
        if (v * 4 < firstFaceOffset) inPreFace++; // assuming u32 array
        if (v < firstFaceOffset) inPreFace++; // assuming byte offset
    }
    console.log(`  As u32 index: ${inPreFace / 2}/${allB1.length} (${(inPreFace / 2 / allB1.length * 100).toFixed(1)}%) in pre-face`);
    console.log(`  As byte offset: ${inPreFace / 2}/${allB1.length} (${(inPreFace / 2 / allB1.length * 100).toFixed(1)}%) in pre-face`);
}
