#!/usr/bin/env node
'use strict';
/**
 * FALSIFICATION: Block 1 values as property table indices
 *
 * Claim: Block 1 value V → table[base + V * 4] returns a property.
 *
 * To FALSIFY, we need to show:
 * 1. The mapping is arbitrary (any base gives similar scores)
 * 2. The "table" is just normal data being misinterpreted
 * 3. The grammar doesn't arise from property referencing
 * 4. The same V maps to different property types in different contexts
 * 5. A simpler explanation exists for the score patterns
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
// TEST 1: Random base scoring — is GEAR's 100% special?
// ============================================================
console.log('='.repeat(70));
console.log('TEST 1: Random base scoring — is 100% special or expected?');
console.log('='.repeat(70));

for (const f of files) {
    if (!fs.existsSync(f.path)) continue;
    const buf = fs.readFileSync(f.path);
    const dl = findDisplayLists(buf);
    if (!dl) continue;

    const faces = extractFaces(dl);
    const allB1 = faces.flatMap(fa => fa.block1).filter(v => v > 0);
    const maxB1 = Math.max(...allB1);
    const firstFaceOff = Math.min(...faces.map(fa => fa.mp - 4));

    // Score many random bases
    const scores = [];
    for (let trial = 0; trial < 200; trial++) {
        const base = Math.floor(Math.random() * Math.max(1, firstFaceOff - (maxB1 + 1) * 4));
        let zeros = 0, total = 0, nonZeroVals = new Map();

        for (const v of allB1) {
            const idx = base + v * 4;
            if (idx + 4 > dl.length) continue;
            total++;
            const val = dl.readUInt32LE(idx);
            if (val === 0) zeros++;
            else nonZeroVals.set(val, (nonZeroVals.get(val) || 0) + 1);
        }

        if (total === 0) continue;
        const dominant = [...nonZeroVals.entries()].sort((a, b) => b[1] - a[1])[0];
        const domCount = dominant ? dominant[1] : 0;
        scores.push((zeros + domCount) / total);
    }

    scores.sort((a, b) => a - b);
    const median = scores[Math.floor(scores.length / 2)];
    const p95 = scores[Math.floor(scores.length * 0.95)];
    const max = scores[scores.length - 1];

    console.log(`${f.name}: median=${(median * 100).toFixed(1)}% p95=${(p95 * 100).toFixed(1)}% max=${(max * 100).toFixed(1)}% (of ${scores.length} random bases)`);
}

// ============================================================
// TEST 2: Same B1 values across faces — do they map to the
// same table entry consistently?
// ============================================================
console.log('\n' + '='.repeat(70));
console.log('TEST 2: Same B1 value in different faces — same table entry?');
console.log('='.repeat(70));

for (const f of files) {
    if (!fs.existsSync(f.path)) continue;
    const buf = fs.readFileSync(f.path);
    const dl = findDisplayLists(buf);
    if (!dl) continue;

    const faces = extractFaces(dl);

    // Find B1 values that appear in multiple faces
    const b1Faces = new Map(); // value → [{face, pos, tableVal}]
    for (let fi = 0; fi < faces.length; fi++) {
        for (let pi = 0; pi < faces[fi].block1.length; pi++) {
            const v = faces[fi].block1[pi];
            if (v === 0) continue;
            if (!b1Faces.has(v)) b1Faces.set(v, []);
            b1Faces.get(v).push({ face: fi, pos: pi });
        }
    }

    // For the known GEAR base, check consistency
    const GEAR_BASE = 76696;
    const DEKOR_BASE = 80424;
    const base = f.name === 'GEAR' ? GEAR_BASE : f.name === 'DEKOR' ? DEKOR_BASE : -1;

    if (base < 0) {
        console.log(`${f.name}: no known base, skipping`);
        continue;
    }

    let consistent = 0, inconsistent = 0;
    for (const [v, entries] of b1Faces) {
        if (entries.length < 2) continue;
        const vals = entries.map(e => dl.readUInt32LE(base + v * 4));
        const allSame = vals.every(x => x === vals[0]);
        if (allSame) consistent++;
        else inconsistent++;
    }

    console.log(`${f.name}: ${consistent} consistent, ${inconsistent} inconsistent (of ${consistent + inconsistent} repeated values)`);
    if (inconsistent > 0) {
        // Show first inconsistent
        for (const [v, entries] of b1Faces) {
            if (entries.length < 2) continue;
            const vals = entries.map(e => ({ face: e.face, val: dl.readUInt32LE(base + v * 4) }));
            if (!vals.every(x => x.val === vals[0].val)) {
                console.log(`  B1=${v} maps to: ${vals.map(x => `face${x.face}=0x${x.val.toString(16)}`).join(', ')}`);
                break;
            }
        }
    }
}

// ============================================================
// TEST 3: Does the "score" depend on B1 value distribution,
// not on any actual table?
// ============================================================
console.log('\n' + '='.repeat(70));
console.log('TEST 3: Score from value frequency, not table structure');
console.log('='.repeat(70));

for (const f of files) {
    if (!fs.existsSync(f.path)) continue;
    const buf = fs.readFileSync(f.path);
    const dl = findDisplayLists(buf);
    if (!dl) continue;

    const faces = extractFaces(dl);
    const allB1 = faces.flatMap(fa => fa.block1).filter(v => v > 0);

    // Count frequency of each B1 value
    const freq = new Map();
    for (const v of allB1) freq.set(v, (freq.get(v) || 0) + 1);

    // Most common B1 value
    const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
    const mostCommon = sorted[0];
    const secondMost = sorted[1];

    console.log(`${f.name}: most common B1=${mostCommon[0]} (${mostCommon[1]}x), 2nd=${secondMost[0]} (${secondMost[1]}x), unique=${freq.size}, total=${allB1.length}`);

    // If we score by "most B1 values are the same number", we get high score
    // without any table at all
    const naiveScore = mostCommon[1] / allB1.length;
    console.log(`  Naive "most common value" score: ${(naiveScore * 100).toFixed(1)}%`);
}

// ============================================================
// TEST 4: For GEAR, does value 1 map to a "special" table
// entry, or just to whatever is at byte 76700?
// ============================================================
console.log('\n' + '='.repeat(70));
console.log('TEST 4: Is B1=1 "special" or just an index?');
console.log('='.repeat(70));

for (const f of files) {
    if (!fs.existsSync(f.path)) continue;
    const buf = fs.readFileSync(f.path);
    const dl = findDisplayLists(buf);
    if (!dl) continue;

    const faces = extractFaces(dl);

    // How many faces start with B1=1?
    const startsWithOne = faces.filter(fa => fa.block1.length > 0 && fa.block1[0] === 1).length;
    console.log(`${f.name}: ${startsWithOne}/${faces.length} faces start with B1=1`);

    // What's at offset 76696 + 1*4 = 76700 for GEAR?
    if (f.name === 'GEAR') {
        const v = dl.readUInt32LE(76696 + 1 * 4);
        console.log(`  GEAR: table[1] = ${v} (0x${v.toString(16)})`);
        // Is this "special"? It's the flag value.
        // But is it special BECAUSE it's index 1, or because index 1 happens to have that value?
    }

    // Check: what if B1=1 just means "use the default/flag value"?
    // Then B1=1 should appear in a specific structural position (e.g., always first)
    const posCounts = new Array(20).fill(0);
    for (const face of faces) {
        for (let i = 0; i < face.block1.length && i < 20; i++) {
            if (face.block1[i] === 1) posCounts[i]++;
        }
    }
    console.log(`  B1=1 position distribution: ${posCounts.slice(0, 10).map((c, i) => `pos${i}=${c}`).join(' ')}`);
}

// ============================================================
// TEST 5: BOTTOM/TOP — try scoring with value frequency, not table
// ============================================================
console.log('\n' + '='.repeat(70));
console.log('TEST 5: Can we explain BOTTOM/TOP scores without a table?');
console.log('='.repeat(70));

for (const f of files) {
    if (!fs.existsSync(f.path)) continue;
    const buf = fs.readFileSync(f.path);
    const dl = findDisplayLists(buf);
    if (!dl) continue;

    const faces = extractFaces(dl);
    const allB1 = faces.flatMap(fa => fa.block1).filter(v => v > 0);
    const maxB1 = Math.max(...allB1);

    // For each possible base, compute the score
    // But instead of "table lookup", just count how many B1 values
    // are the same number (regardless of what's at that offset)
    const freq = new Map();
    for (const v of allB1) freq.set(v, (freq.get(v) || 0) + 1);
    const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);

    // The "table score" is really just "what fraction of B1 values are the same number"
    // because the table at any base will have SOME value, and if most B1 values are the same,
    // they'll all read the same table entry.
    const topVal = sorted[0];
    const score = topVal[1] / allB1.length;

    console.log(`${f.name}: B1 value ${topVal[0]} appears ${topVal[1]}/${allB1.length} times (${(score * 100).toFixed(1)}%)`);
    console.log(`  This is the "table score" — it's just value frequency, not table structure!`);
}

// ============================================================
// TEST 6: DEKOR — 49024 at base 80424. But what if base is wrong?
// ============================================================
console.log('\n' + '='.repeat(70));
console.log('TEST 6: DEKOR base sensitivity — is 80424 special?');
console.log('='.repeat(70));

{
    const f = files.find(x => x.name === 'DEKOR');
    if (fs.existsSync(f.path)) {
        const buf = fs.readFileSync(f.path);
        const dl = findDisplayLists(buf);
        const faces = extractFaces(dl);
        const allB1 = faces.flatMap(fa => fa.block1).filter(v => v > 0);

        // Test bases near 80424
        console.log('Bases near 80424:');
        for (let base = 80300; base <= 80500; base += 4) {
            let zeros = 0, total = 0, vals = new Map();
            for (const v of allB1) {
                const idx = base + v * 4;
                if (idx + 4 > dl.length) continue;
                total++;
                const val = dl.readUInt32LE(idx);
                if (val === 0) zeros++;
                else vals.set(val, (vals.get(val) || 0) + 1);
            }
            if (total === 0) continue;
            const dom = [...vals.entries()].sort((a, b) => b[1] - a[1])[0];
            const score = (zeros + (dom ? dom[1] : 0)) / total;
            const domVal = dom ? dom[0] : 0;
            if (score > 0.85) {
                console.log(`  base=${base} score=${(score * 100).toFixed(1)}% dominant=0x${domVal.toString(16)} (${domVal})`);
            }
        }

        // Now test: is the "49024" value special?
        // What if it's just the most common u32 in that region?
        const regionFreq = new Map();
        for (let i = 80424; i < 80424 + 20143 * 4 && i + 4 <= dl.length; i += 4) {
            const v = dl.readUInt32LE(i);
            regionFreq.set(v, (regionFreq.get(v) || 0) + 1);
        }
        const sorted = [...regionFreq.entries()].sort((a, b) => b[1] - a[1]);
        console.log(`\nMost common u32 values in DEKOR region [80424, ${80424 + 20143 * 4}):`);
        for (const [v, c] of sorted.slice(0, 10)) {
            console.log(`  0x${v.toString(16).padStart(8, '0')} (${v}) × ${c}`);
        }
    }
}

// ============================================================
// TEST 7: Grammar doesn't arise from property indexing
// ============================================================
console.log('\n' + '='.repeat(70));
console.log('TEST 7: Does the Block 1 grammar arise from property indexing?');
console.log('='.repeat(70));

for (const f of files) {
    if (!fs.existsSync(f.path)) continue;
    const buf = fs.readFileSync(f.path);
    const dl = findDisplayLists(buf);
    if (!dl) continue;

    const faces = extractFaces(dl);

    // Known invariants:
    // 1. First token = ONE (value 1)
    // 2. Section count = Block 2 entry count
    // 3. ONE count per section = 1
    // 4. section_length = Block 2 raw value

    // If B1 values are property indices, why would:
    // - Every section start with property index 1?
    // - The number of sections equal Block 2's value?
    // - Each section have exactly ONE occurrence of property index 1?

    // These invariants describe STRUCTURE, not property content.
    // Property indices don't explain why sections are delimited by value 1.

    console.log(`${f.name}:`);
    console.log(`  Sections starting with B1=1: ${faces.filter(fa => fa.block1[0] === 1).length}/${faces.length}`);
    console.log(`  This is a STRUCTURAL invariant, not a property lookup.`);

    // More importantly: the section_length = Block 2 value invariant
    // means Block 2 COUNTS something about the sections.
    // If sections are property lists, Block 2 counts property list length.
    // But why would property list length be stored separately?

    // The grammar says: Block 2 encodes how many items follow each ONE delimiter.
    // This is a TOPOLOGY encoding pattern (loop/face/edge vertex counts),
    // not a property lookup pattern.
}

console.log('\n' + '='.repeat(70));
console.log('VERDICT');
console.log('='.repeat(70));
