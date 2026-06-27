#!/usr/bin/env node
'use strict';
/**
 * FORMAL LANGUAGE CHARACTERIZATION of Block 1
 *
 * Treat Block 1 as an unknown formal language.
 * Determine whether parsing depends only on token sequence or also on parser state.
 * Report only observations and measurable properties.
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

// ============================================================
// Collect all Block 1 sections across all files
// ============================================================

const RESEARCH_DIR = 'C:\\Users\\basha\\Desktop\\soldiworks research';
const files = [
    { name: 'BOTTOM', path: path.join(RESEARCH_DIR, 'test files original', 'usb hub case (ultimate test)', 'USB hub case BOTTOM.SLDPRT') },
    { name: 'TOP', path: path.join(RESEARCH_DIR, 'test files original', 'usb hub case (ultimate test)', 'USB hub case TOP.SLDPRT') },
    { name: 'GEAR', path: path.join(RESEARCH_DIR, 'test files original', 'Helical Bevel Gear.SLDPRT') },
    { name: 'DEKOR', path: path.join(RESEARCH_DIR, 'test files original', 'Dekor.SLDPRT') }
];

const allSections = []; // {file, faceIdx, section, b2vals}
const allTokens = new Set();
const tokenFreq = new Map();
let totalSections = 0;
let totalTokens = 0;

for (const f of files) {
    if (!fs.existsSync(f.path)) continue;
    const buf = fs.readFileSync(f.path);
    const dl = findDisplayLists(buf);
    if (!dl) continue;

    const faces = extractFaces(dl);
    for (let fi = 0; fi < faces.length; fi++) {
        const face = faces[fi];
        if (face.block1.length === 0) continue;

        // Split by ONE (value 1) delimiters
        const sections = [];
        let current = [];
        for (const v of face.block1) {
            if (v === 1) {
                if (current.length > 0) sections.push(current);
                current = [];
            } else {
                current.push(v);
            }
        }
        if (current.length > 0) sections.push(current);

        // Each section: ONE + section_content
        // The ONE is implicit (we split by it)
        for (const section of sections) {
            allSections.push({
                file: f.name,
                faceIdx: fi,
                section,
                ec: face.ec,
                vc: face.vc,
                b2vals: face.block2
            });
            totalSections++;

            for (const v of section) {
                allTokens.add(v);
                tokenFreq.set(v, (tokenFreq.get(v) || 0) + 1);
                totalTokens++;
            }
        }
    }
}

console.log('FORMAL LANGUAGE CHARACTERIZATION OF BLOCK 1');
console.log('='.repeat(70));
console.log(`Total sections: ${totalSections}`);
console.log(`Total tokens (non-ONE): ${totalTokens}`);
console.log(`Unique token values: ${allTokens.size}`);
console.log(`Token alphabet size: ${allTokens.size}`);

// ============================================================
// SECTION 1: Section length distribution
// ============================================================
console.log('\n' + '='.repeat(70));
console.log('1. SECTION LENGTH DISTRIBUTION');
console.log('='.repeat(70));

const lengthFreq = new Map();
for (const s of allSections) {
    lengthFreq.set(s.section.length, (lengthFreq.get(s.section.length) || 0) + 1);
}
const sortedLengths = [...lengthFreq.entries()].sort((a, b) => a[0] - b[0]);
console.log('length | count | pct');
console.log('-------|-------|-----');
for (const [len, count] of sortedLengths) {
    console.log(`${String(len).padStart(6)} | ${String(count).padStart(5)} | ${(count / totalSections * 100).toFixed(1)}%`);
}

// ============================================================
// SECTION 2: Positional token distribution
// ============================================================
console.log('\n' + '='.repeat(70));
console.log('2. POSITIONAL TOKEN DISTRIBUTION');
console.log('='.repeat(70));

// Find max section length
const maxLen = Math.max(...allSections.map(s => s.section.length));

// For each position, count token frequencies
for (let pos = 0; pos < Math.min(maxLen, 20); pos++) {
    const posFreq = new Map();
    let count = 0;
    for (const s of allSections) {
        if (pos < s.section.length) {
            const v = s.section[pos];
            posFreq.set(v, (posFreq.get(v) || 0) + 1);
            count++;
        }
    }
    if (count === 0) continue;

    const sorted = [...posFreq.entries()].sort((a, b) => b[1] - a[1]);
    const top3 = sorted.slice(0, 3);
    const entropy = -sorted.reduce((sum, [, c]) => {
        const p = c / count;
        return sum + p * Math.log2(p);
    }, 0);

    console.log(`pos ${String(pos).padStart(2)}: n=${String(count).padStart(5)} entropy=${entropy.toFixed(2)} top=[${top3.map(([v, c]) => `${v}(${c})`).join(',')}]`);
}

// ============================================================
// SECTION 3: Transition matrix (bigram analysis)
// ============================================================
console.log('\n' + '='.repeat(70));
console.log('3. TRANSITION MATRIX (bigram analysis)');
console.log('='.repeat(70));

// Classify tokens: ONE=1, ZERO=0, SMALL(<100), LARGE(>=100)
function classify(v) {
    if (v === 1) return 'ONE';
    if (v === 0) return 'ZERO';
    if (v < 100) return 'SMALL';
    return 'LARGE';
}

const transitions = new Map(); // "CLASS_A -> CLASS_B" => count
const classFreq = new Map();

for (const s of allSections) {
    const seq = [1, ...s.section]; // Prepend ONE (implicit delimiter)
    for (let i = 0; i < seq.length; i++) {
        const cls = classify(seq[i]);
        classFreq.set(cls, (classFreq.get(cls) || 0) + 1);

        if (i < seq.length - 1) {
            const nextCls = classify(seq[i + 1]);
            const key = `${cls} -> ${nextCls}`;
            transitions.set(key, (transitions.get(key) || 0) + 1);
        }
    }
}

console.log('Class frequencies:');
for (const [cls, count] of [...classFreq.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cls}: ${count} (${(count / totalTokens * 100).toFixed(1)}%)`);
}

console.log('\nTransition counts:');
const sortedTrans = [...transitions.entries()].sort((a, b) => b[1] - a[1]);
for (const [key, count] of sortedTrans.slice(0, 20)) {
    console.log(`  ${key}: ${count}`);
}

// Compute transition entropy
console.log('\nTransition entropy per source class:');
for (const srcCls of ['ONE', 'ZERO', 'SMALL', 'LARGE']) {
    const outgoing = new Map();
    let total = 0;
    for (const [key, count] of transitions) {
        if (key.startsWith(srcCls + ' -> ')) {
            const dstCls = key.split(' -> ')[1];
            outgoing.set(dstCls, count);
            total += count;
        }
    }
    if (total === 0) continue;

    const entropy = -[...outgoing.values()].reduce((sum, c) => {
        const p = c / total;
        return sum + p * Math.log2(p);
    }, 0);

    const maxEntropy = Math.log2(outgoing.size);
    console.log(`  ${srcCls}: entropy=${entropy.toFixed(3)} max=${maxEntropy.toFixed(3)} ratio=${(entropy / maxEntropy).toFixed(3)} transitions=${outgoing.size}`);
}

// ============================================================
// SECTION 4: ZERO behavior analysis
// ============================================================
console.log('\n' + '='.repeat(70));
console.log('4. ZERO BEHAVIOR ANALYSIS');
console.log('='.repeat(70));

// Where does ZERO appear in sections?
const zeroPosFreq = new Map();
const nonZeroSections = allSections.filter(s => s.section.some(v => v === 0));
const zeroSections = allSections.filter(s => !s.section.some(v => v === 0));

console.log(`Sections with ZERO: ${nonZeroSections.length}/${totalSections} (${(nonZeroSections.length / totalSections * 100).toFixed(1)}%)`);
console.log(`Sections without ZERO: ${zeroSections.length}/${totalSections} (${(zeroSections.length / totalSections * 100).toFixed(1)}%)`);

// For sections with ZERO, what positions have ZERO?
console.log('\nZERO position distribution (within section content, excluding leading ONE):');
const zeroPosCount = new Map();
for (const s of nonZeroSections) {
    for (let i = 0; i < s.section.length; i++) {
        if (s.section[i] === 0) {
            zeroPosCount.set(i, (zeroPosCount.get(i) || 0) + 1);
        }
    }
}
const sortedZeroPos = [...zeroPosCount.entries()].sort((a, b) => a[0] - b[0]);
for (const [pos, count] of sortedZeroPos.slice(0, 20)) {
    console.log(`  pos ${String(pos).padStart(2)}: ${count}`);
}

// Does ZERO always appear in pairs?
let zeroPairs = 0;
let zeroSingles = 0;
let zeroTriples = 0;
for (const s of nonZeroSections) {
    let i = 0;
    while (i < s.section.length) {
        if (s.section[i] === 0) {
            let run = 1;
            while (i + run < s.section.length && s.section[i + run] === 0) run++;
            if (run === 1) zeroSingles++;
            else if (run === 2) zeroPairs++;
            else if (run === 3) zeroTriples++;
            i += run;
        } else {
            i++;
        }
    }
}
console.log(`\nZERO run lengths: singles=${zeroSingles} pairs=${zeroPairs} triples=${zeroTriples}`);

// What follows ZERO?
console.log('\nWhat follows ZERO (in section content)?');
const afterZero = new Map();
for (const s of nonZeroSections) {
    for (let i = 0; i < s.section.length - 1; i++) {
        if (s.section[i] === 0) {
            const next = s.section[i + 1];
            afterZero.set(next, (afterZero.get(next) || 0) + 1);
        }
    }
}
const sortedAfterZero = [...afterZero.entries()].sort((a, b) => b[1] - a[1]);
for (const [v, c] of sortedAfterZero.slice(0, 10)) {
    console.log(`  after ZERO: ${v} (${c}x)`);
}

// What does ZERO follow?
console.log('\nWhat precedes ZERO (in section content)?');
const beforeZero = new Map();
for (const s of nonZeroSections) {
    for (let i = 1; i < s.section.length; i++) {
        if (s.section[i] === 0) {
            const prev = s.section[i - 1];
            beforeZero.set(prev, (beforeZero.get(prev) || 0) + 1);
        }
    }
}
const sortedBeforeZero = [...beforeZero.entries()].sort((a, b) => b[1] - a[1]);
for (const [v, c] of sortedBeforeZero.slice(0, 10)) {
    console.log(`  before ZERO: ${v} (${c}x)`);
}

// ============================================================
// SECTION 5: Contextual behavior — same token, different positions
// ============================================================
console.log('\n' + '='.repeat(70));
console.log('5. CONTEXTUAL BEHAVIOR — same token, different positions');
console.log('='.repeat(70));

// Pick tokens that appear at multiple positions
const tokenPositions = new Map(); // token → Set of positions
for (const s of allSections) {
    for (let i = 0; i < s.section.length; i++) {
        const v = s.section[i];
        if (!tokenPositions.has(v)) tokenPositions.set(v, new Set());
        tokenPositions.get(v).add(i);
    }
}

// Find tokens that appear at 3+ different positions
const multiPosTokens = [...tokenPositions.entries()]
    .filter(([v, positions]) => positions.size >= 3 && v !== 0)
    .sort((a, b) => b[1].size - a[1].size);

console.log('Tokens appearing at 3+ different positions:');
for (const [v, positions] of multiPosTokens.slice(0, 15)) {
    const posList = [...positions].sort((a, b) => a - b);
    console.log(`  token=${v}: positions=[${posList.join(',')}]`);
}

// For each such token, check if the FOLLOWING token differs by position
console.log('\nContext sensitivity test: does the token AFTER a given value depend on position?');
for (const [v, positions] of multiPosTokens.slice(0, 5)) {
    const posList = [...positions].sort((a, b) => a - b);
    console.log(`\n  token=${v} at positions ${posList.join(',')}:`);

    for (const pos of posList.slice(0, 5)) {
        const afterValues = new Map();
        for (const s of allSections) {
            if (pos < s.section.length && pos + 1 < s.section.length) {
                if (s.section[pos] === v) {
                    const next = s.section[pos + 1];
                    afterValues.set(next, (afterValues.get(next) || 0) + 1);
                }
            }
        }
        const sorted = [...afterValues.entries()].sort((a, b) => b[1] - a[1]);
        console.log(`    pos ${pos}: after=[${sorted.slice(0, 3).map(([val, c]) => `${val}(${c})`).join(',')}]`);
    }
}

// ============================================================
// SECTION 6: Section length = Block 2 value correlation
// ============================================================
console.log('\n' + '='.repeat(70));
console.log('6. SECTION LENGTH = BLOCK 2 VALUE CORRELATION');
console.log('='.repeat(70));

// For each face, check if section lengths match Block 2 values
let b2Match = 0;
let b2Mismatch = 0;
const matchExamples = [];
const mismatchExamples = [];

for (const s of allSections) {
    if (s.b2vals.length === 0) continue;

    // Section length should equal some Block 2 value
    const sectionLen = s.section.length;
    const matched = s.b2vals.some(b2v => b2v === sectionLen);

    if (matched) {
        b2Match++;
        if (matchExamples.length < 3) {
            matchExamples.push({ file: s.file, face: s.faceIdx, sectionLen, b2vals: s.b2vals.join(',') });
        }
    } else {
        b2Mismatch++;
        if (mismatchExamples.length < 3) {
            mismatchExamples.push({ file: s.file, face: s.faceIdx, sectionLen, b2vals: s.b2vals.join(',') });
        }
    }
}

console.log(`Section length found in Block 2: ${b2Match}/${b2Match + b2Mismatch} (${(b2Match / (b2Match + b2Mismatch) * 100).toFixed(1)}%)`);
console.log(`Section length NOT found in Block 2: ${b2Mismatch}/${b2Match + b2Mismatch}`);
for (const ex of matchExamples) {
    console.log(`  MATCH: ${ex.file} face${ex.face} len=${ex.sectionLen} b2=[${ex.b2vals}]`);
}
for (const ex of mismatchExamples) {
    console.log(`  MISMATCH: ${ex.file} face${ex.face} len=${ex.sectionLen} b2=[${ex.b2vals}]`);
}

// ============================================================
// SECTION 7: Try to construct FSM states
// ============================================================
console.log('\n' + '='.repeat(70));
console.log('7. FSM STATE ANALYSIS');
console.log('='.repeat(70));

// Build equivalence classes: two positions are equivalent if they
// have the same set of possible next tokens
const positionContexts = new Map(); // "token -> Set of next tokens" → state ID
const stateForPosition = new Map();

for (const s of allSections) {
    const seq = [1, ...s.section]; // Prepend ONE
    for (let i = 0; i < seq.length; i++) {
        const token = seq[i];
        const nextSet = i < seq.length - 1 ? classify(seq[i + 1]) : 'END';
        const context = `${classify(token)}:${nextSet}`;

        if (!positionContexts.has(context)) {
            positionContexts.set(context, positionContexts.size);
        }
        stateForPosition.set(context, positionContexts.get(context));
    }
}

console.log(`Distinct contexts (token_class:next_class): ${positionContexts.size}`);
console.log('Contexts:');
for (const [ctx, id] of [...positionContexts.entries()].sort((a, b) => a[1] - b[1])) {
    console.log(`  state ${id}: ${ctx}`);
}

// ============================================================
// SECTION 8: Grammar vs instruction stream test
// ============================================================
console.log('\n' + '='.repeat(70));
console.log('8. GRAMMAR vs INSTRUCTION STREAM');
console.log('='.repeat(70));

// Key test: does the language have nested/recursive structure?
// If grammar: expect matching delimiters, nested patterns
// If instruction stream: expect linear progression, no nesting

// Test: count ZERO pairs that bracket non-ZERO content
let bracketCount = 0;
let linearCount = 0;

for (const s of allSections) {
    // Look for pattern: ZERO ... non-ZERO ... ZERO (bracketing)
    const zeros = [];
    for (let i = 0; i < s.section.length; i++) {
        if (s.section[i] === 0) zeros.push(i);
    }

    // Check if zeros come in pairs
    if (zeros.length >= 2) {
        for (let i = 0; i < zeros.length - 1; i += 2) {
            const start = zeros[i];
            const end = zeros[i + 1];
            if (end > start + 1) {
                const inner = s.section.slice(start + 1, end);
                if (inner.some(v => v !== 0)) {
                    bracketCount++;
                }
            }
        }
    } else {
        linearCount++;
    }
}

console.log(`Bracket patterns (ZERO ... non-ZERO ... ZERO): ${bracketCount}`);
console.log(`Linear patterns (no bracketing): ${linearCount}`);
console.log(`Nesting indicator: ${bracketCount > 0 ? 'GRAMMAR (nested)' : 'INSTRUCTION STREAM (linear)'}`);

// Test: are section lengths predictable from position?
console.log('\nSection length predictability:');
const lenByPos = new Map(); // position → [lengths]
for (const s of allSections) {
    // Can we predict section length from the first non-ONE token?
    if (s.section.length > 0) {
        const firstToken = s.section[0];
        if (!lenByPos.has(firstToken)) lenByPos.set(firstToken, []);
        lenByPos.get(firstToken).push(s.section.length);
    }
}

let posEntropy = 0;
for (const [token, lengths] of lenByPos) {
    const uniqueLens = new Set(lengths);
    if (uniqueLens.size > 1) {
        // Multiple possible lengths for this first token
        const freq = new Map();
        for (const l of lengths) freq.set(l, (freq.get(l) || 0) + 1);
        const entropy = -[...freq.values()].reduce((sum, c) => {
            const p = c / lengths.length;
            return sum + p * Math.log2(p);
        }, 0);
        posEntropy += entropy;
    }
}

console.log(`First-token → length predictability: ${lenByPos.size} distinct first tokens`);
for (const [token, lengths] of [...lenByPos.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 10)) {
    const uniqueLens = [...new Set(lengths)].sort((a, b) => a - b);
    console.log(`  first_token=${token}: ${lengths.length} sections, lengths=[${uniqueLens.join(',')}]`);
}

// ============================================================
// SECTION 9: Measurable properties summary
// ============================================================
console.log('\n' + '='.repeat(70));
console.log('9. MEASURABLE PROPERTIES SUMMARY');
console.log('='.repeat(70));

console.log(`Token alphabet size: ${allTokens.size}`);
console.log(`Section count: ${totalSections}`);
console.log(`Section length range: ${Math.min(...allSections.map(s => s.section.length))}-${Math.max(...allSections.map(s => s.section.length))}`);
console.log(`Sections with ZERO: ${nonZeroSections.length}/${totalSections} (${(nonZeroSections.length / totalSections * 100).toFixed(1)}%)`);
console.log(`Sections without ZERO: ${zeroSections.length}/${totalSections} (${(zeroSections.length / totalSections * 100).toFixed(1)}%)`);
console.log(`Bracket patterns: ${bracketCount}`);
console.log(`Linear patterns: ${linearCount}`);
console.log(`Distinct contexts: ${positionContexts.size}`);
console.log(`Multi-position tokens: ${multiPosTokens.length}`);
console.log(`B2-match rate: ${(b2Match / (b2Match + b2Mismatch) * 100).toFixed(1)}%`);
