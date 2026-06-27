#!/usr/bin/env node
'use strict';
/**
 * UNIVERSE DISCOVERY: What owns the IDs in Block 1?
 *
 * For each file, scan the entire decompressed DisplayLists for:
 * 1. u32 counts that approximate max(Block1)+1
 * 2. Repeated u32 values outside Block 1 that fall in the Block 1 range
 * 3. Offset tables (arrays of u32 that point to positions within the stream)
 * 4. Repeated patterns at regular intervals (record arrays)
 * 5. Any structure whose size ≈ max(Block1) * sizeof(record)
 *
 * Assign no semantics. Only report candidate object universes.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function rolByte(b, shift) { shift &= 7; if (shift === 0) return b; return ((b << shift) | (b >>> (8 - shift))) & 0xFF; }
function findAll(buf, pattern) { const pos = []; for (let i = 0; i <= buf.length - pattern.length; i++) { let ok = true; for (let j = 0; j < pattern.length; j++) { if (buf[i + j] !== pattern[j]) { ok = false; break; } } if (ok) pos.push(i); } return pos; }
function decompressOpenSX(buf) { const key = buf[7]; const marker = [0x14, 0x00, 0x06, 0x00, 0x08, 0x00]; const streams = {}; for (const mp of findAll(buf, marker)) { const si = mp - 4; if (si < 0 || si + 0x1E > buf.length) continue; const csz = buf.readUInt32LE(si + 0x12); const nsz = buf.readUInt32LE(si + 0x1A); if (nsz > 1024 || csz > 50 * 1024 * 1024) continue; const nameStart = si + 0x1E; const nameEnd = nameStart + nsz; if (nameEnd > buf.length) continue; const rawName = buf.subarray(nameStart, nameEnd); let name = ''; for (let i = 0; i < nsz; i++) name += String.fromCharCode(rolByte(rawName[i], key)); if (name.length === 0) continue; const dataStart = nameEnd; const dataEnd = dataStart + csz; if (dataEnd > buf.length) continue; const f1 = buf.readUInt32LE(si + 0x0E); if (f1 >= 65536 && csz > 0) { const compressed = buf.subarray(dataStart, dataEnd); let decompressed = null; try { decompressed = zlib.inflateRawSync(Buffer.from(compressed)); } catch (e) { try { decompressed = zlib.inflateSync(Buffer.from(compressed)); } catch (e2) {} } if (decompressed && decompressed.length > 0 && !streams[name]) streams[name] = decompressed; } } return streams; }
function findDisplayLists(buf) { const streams = decompressOpenSX(buf); for (const [name, data] of Object.entries(streams)) { if (name.toLowerCase().includes('displaylist') && data.length > 100) { const d = Buffer.isBuffer(data) ? data : Buffer.from(data); if (d.readUInt32LE(0) === 1 && d.readUInt32LE(4) === 1) return data; } } return null; }

function extractFacesBlock1(dlData) {
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
        results.push({ ec, vc, mp, block1, block2, topoStart, vertStart });
    }
    return results;
}

// ============================================================
// Main
// ============================================================

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
    const faces = extractFacesBlock1(dl);

    // Collect all Block 1 values (non-zero, non-ONE)
    const b1Values = new Set();
    let maxB1 = 0;
    for (const face of faces) {
        for (const v of face.block1) {
            if (v !== 0 && v !== 1) { b1Values.add(v); if (v > maxB1) maxB1 = v; }
        }
    }

    console.log(`\n${'='.repeat(70)}`);
    console.log(`FILE: ${f.name}`);
    console.log(`DisplayLists: ${dl.length} bytes`);
    console.log(`Faces: ${faces.length}`);
    console.log(`Block 1 unique values: ${b1Values.size}, max: ${maxB1}`);
    console.log(`Target range to search: [0, ${maxB1}]`);
    console.log(`${'='.repeat(70)}`);

    // ============================================================
    // SCAN 1: u32 values across the ENTIRE DisplayLists
    // Count frequency of every u32 value
    // ============================================================
    console.log(`\n--- SCAN 1: u32 frequency histogram across entire DisplayLists ---`);
    const u32freq = new Map();
    for (let i = 0; i <= dl.length - 4; i += 4) {
        const v = dl.readUInt32LE(i);
        u32freq.set(v, (u32freq.get(v) || 0) + 1);
    }

    // Find u32 values that appear multiple times AND are in Block 1 range
    const repeatedInB1Range = [];
    for (const [v, count] of u32freq) {
        if (v > 0 && v <= maxB1 && count >= 3) {
            repeatedInB1Range.push({ value: v, count, inB1: b1Values.has(v) });
        }
    }
    repeatedInB1Range.sort((a, b) => b.count - a.count);

    console.log(`  u32 values in Block 1 range [1, ${maxB1}] appearing >= 3 times:`);
    console.log(`  Total candidates: ${repeatedInB1Range.length}`);
    const inB1count = repeatedInB1Range.filter(x => x.inB1).length;
    const notInB1count = repeatedInB1Range.filter(x => !x.inB1).length;
    console.log(`  Also in Block 1: ${inB1count}`);
    console.log(`  NOT in Block 1 (new candidates): ${notInB1count}`);
    console.log(`  Top 20 by frequency:`);
    for (const { value, count, inB1 } of repeatedInB1Range.slice(0, 20)) {
        console.log(`    value=${String(value).padStart(6)}  freq=${String(count).padStart(5)}  ${inB1 ? 'IN_B1' : 'NEW'}`);
    }

    // ============================================================
    // SCAN 2: u32 counts that approximate maxB1+1
    // ============================================================
    console.log(`\n--- SCAN 2: u32 values near maxB1+1 = ${maxB1 + 1} ---`);
    const nearMax = [];
    for (const [v, count] of u32freq) {
        if (Math.abs(v - (maxB1 + 1)) <= Math.max(10, maxB1 * 0.05)) {
            nearMax.push({ value: v, count });
        }
    }
    nearMax.sort((a, b) => Math.abs(a.value - maxB1 - 1) - Math.abs(b.value - maxB1 - 1));
    console.log(`  Values within ±5% of ${maxB1 + 1}:`);
    for (const { value, count } of nearMax.slice(0, 20)) {
        console.log(`    value=${String(value).padStart(6)}  freq=${String(count).padStart(5)}  delta=${value - maxB1 - 1}`);
    }

    // ============================================================
    // SCAN 3: Offset-like tables (sorted u32 arrays with small deltas)
    // ============================================================
    console.log(`\n--- SCAN 3: Potential offset/pointer tables ---`);
    // Look for runs of 4+ u32 values that are monotonically increasing with small deltas
    const offsetRuns = [];
    for (let i = 0; i <= dl.length - 20; i += 4) {
        const vals = [];
        for (let j = 0; j < 8 && i + j * 4 + 4 <= dl.length; j++) {
            vals.push(dl.readUInt32LE(i + j * 4));
        }
        // Check if first 4+ values are monotonically increasing
        let monotonicallyIncreasing = true;
        let smallDeltas = true;
        for (let j = 1; j < Math.min(vals.length, 6); j++) {
            if (vals[j] <= vals[j - 1]) monotonicallyIncreasing = false;
            if (vals[j] - vals[j - 1] > 10000) smallDeltas = false;
        }
        if (monotonicallyIncreasing && smallDeltas && vals[3] > 0) {
            // Check if any value falls in Block 1 range
            const inRange = vals.filter(v => v > 0 && v <= maxB1).length;
            if (inRange > 0) {
                offsetRuns.push({ offset: i, values: vals.slice(0, 8), inRange });
            }
        }
    }
    console.log(`  Runs of monotonically increasing u32s with values in B1 range: ${offsetRuns.length}`);
    for (const run of offsetRuns.slice(0, 10)) {
        console.log(`    offset=${run.offset}: [${run.values.join(', ')}]`);
    }

    // ============================================================
    // SCAN 4: Repeated u32 values at regular intervals (record arrays)
    // ============================================================
    console.log(`\n--- SCAN 4: Regular-interval patterns (record arrays) ---`);
    // For each frequent u32 value in B1 range, check if it appears at regular intervals
    const topFrequent = repeatedInB1Range.slice(0, 10);
    for (const { value, count } of topFrequent) {
        const positions = [];
        for (let i = 0; i <= dl.length - 4; i += 4) {
            if (dl.readUInt32LE(i) === value) positions.push(i);
        }
        if (positions.length < 3) continue;

        // Check for regular spacing
        const deltas = [];
        for (let i = 1; i < positions.length; i++) deltas.push(positions[i] - positions[i - 1]);
        const uniqueDeltas = [...new Set(deltas)];
        const mostCommonDelta = deltas.sort((a, b) =>
            deltas.filter(v => v === a).length - deltas.filter(v => v === b).length
        ).pop();

        const atRegularInterval = deltas.filter(d => d === mostCommonDelta).length;
        const regularPct = (100 * atRegularInterval / deltas.length).toFixed(0);

        console.log(`  value=${String(value).padStart(6)} freq=${String(count).padStart(5)} positions=${positions.slice(0, 5).join(',')}... delta_mode=${mostCommonDelta} regular=${regularPct}%`);
    }

    // ============================================================
    // SCAN 5: Non-face regions of DisplayLists
    // ============================================================
    console.log(`\n--- SCAN 5: Non-face regions ---`);
    // Mark bytes occupied by face blocks
    const faceRegions = new Set();
    for (const face of faces) {
        const end = face.mp + 16 + face.vc * 12 + 16 + face.vc * 12 + 16 + face.block1.length * 4 + 16 + face.block2.length * 4;
        for (let i = face.mp - 4; i < end && i < dl.length; i++) faceRegions.add(i);
    }

    // Find non-face regions
    let nonFaceBytes = 0;
    let nonFaceU32inB1Range = 0;
    const nonFaceFreq = new Map();
    for (let i = 0; i <= dl.length - 4; i += 4) {
        if (!faceRegions.has(i)) {
            nonFaceBytes += 4;
            const v = dl.readUInt32LE(i);
            if (v > 0 && v <= maxB1) {
                nonFaceU32inB1Range++;
                nonFaceFreq.set(v, (nonFaceFreq.get(v) || 0) + 1);
            }
        }
    }
    console.log(`  Non-face bytes: ${nonFaceBytes} (${(100 * nonFaceBytes / dl.length).toFixed(1)}% of stream)`);
    console.log(`  u32 values in B1 range outside face blocks: ${nonFaceU32inB1Range}`);
    const nonFaceRepeated = [...nonFaceFreq.entries()].filter(([v, c]) => c >= 2).sort((a, b) => b[1] - a[1]);
    console.log(`  Repeated (>=2x) values in non-face regions: ${nonFaceRepeated.length}`);
    for (const [v, c] of nonFaceRepeated.slice(0, 15)) {
        console.log(`    value=${String(v).padStart(6)}  freq=${c}`);
    }

    // ============================================================
    // SCAN 6: Section headers and structure markers
    // ============================================================
    console.log(`\n--- SCAN 6: Structure markers (non-face) ---`);
    // Look for [4, 8, 2, N] patterns outside face blocks (potential record array headers)
    const b2Header = Buffer.from([0x04, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00]);
    const headerPositions = findAll(dl, b2Header);
    console.log(`  [4,8,2,...] patterns found: ${headerPositions.length}`);
    let outsideFace = 0;
    for (const pos of headerPositions) {
        if (!faceRegions.has(pos)) {
            outsideFace++;
            const N = dl.readUInt32LE(pos + 12);
            if (outsideFace <= 10) {
                console.log(`    offset=${pos}: [4,8,2,${N}] (N in B1 range: ${N > 0 && N <= maxB1})`);
            }
        }
    }
    console.log(`  Outside face blocks: ${outsideFace}`);

    // ============================================================
    // SCAN 7: Byte-level — what's between face blocks?
    // ============================================================
    console.log(`\n--- SCAN 7: Inter-face gap analysis ---`);
    const sortedFaces = faces.sort((a, b) => a.mp - b.mp);
    const gaps = [];
    for (let i = 1; i < sortedFaces.length; i++) {
        const prevEnd = sortedFaces[i - 1].mp + 16 + sortedFaces[i - 1].vc * 12 * 2 + 16 + 16 + sortedFaces[i - 1].block1.length * 4 + 16 + sortedFaces[i - 1].block2.length * 4;
        const currStart = sortedFaces[i].mp - 4;
        const gapSize = currStart - prevEnd;
        if (gapSize > 0) {
            gaps.push({ from: prevEnd, to: currStart, size: gapSize });
        }
    }
    // Also check pre-first-face and post-last-face
    if (sortedFaces.length > 0) {
        const firstFaceStart = sortedFaces[0].mp - 4;
        if (firstFaceStart > 0) gaps.unshift({ from: 0, to: firstFaceStart, size: firstFaceStart });
        const lastFace = sortedFaces[sortedFaces.length - 1];
        const lastFaceEnd = lastFace.mp + 16 + lastFace.vc * 12 * 2 + 16 + 16 + lastFace.block1.length * 4 + 16 + lastFace.block2.length * 4;
        if (lastFaceEnd < dl.length) gaps.push({ from: lastFaceEnd, to: dl.length, size: dl.length - lastFaceEnd });
    }
    console.log(`  Gaps between/around face blocks: ${gaps.length}`);
    let totalGapBytes = 0;
    for (const gap of gaps) {
        totalGapBytes += gap.size;
        if (gap.size > 16) {
            // Check what's in this gap
            const gapData = dl.slice(gap.from, Math.min(gap.to, gap.from + 200));
            const u32s = [];
            for (let i = 0; i < Math.min(gapData.length, 80); i += 4) {
                if (i + 4 <= gapData.length) u32s.push(gapData.readUInt32LE(i));
            }
            const inB1 = u32s.filter(v => v > 0 && v <= maxB1).length;
            console.log(`    gap@[${gap.from}-${gap.to}] size=${gap.size} b1_values_in_first_20=${inB1}`);
            if (u32s.length > 0 && gap.size <= 500) {
                console.log(`      first u32s: [${u32s.slice(0, 12).join(', ')}]`);
            }
        }
    }
    console.log(`  Total gap bytes: ${totalGapBytes} (${(100 * totalGapBytes / dl.length).toFixed(1)}% of stream)`);
}
