/**
 * grammar_reconstruct.js — Formal Grammar Reconstruction of Block 1 ONE-delimited sections
 *
 * Read-only forensic analysis. No parser modifications.
 *
 * Treats Block 1 as an unknown serialized language.
 * Does not assign semantics to tokens.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ============================================================
// File manifest
// ============================================================

const BASE = path.resolve(__dirname, '..');
const FILES = {
    bottom: path.join(BASE, 'test files original', 'usb hub case (ultimate test)', 'USB hub case BOTTOM.SLDPRT'),
    top:    path.join(BASE, 'test files original', 'usb hub case (ultimate test)', 'USB hub case TOP.SLDPRT'),
    gear:   path.join(BASE, 'test files original', 'Helical Bevel Gear.SLDPRT'),
    dekor:  path.join(BASE, 'test files original', 'Dekor.SLDPRT'),
};

// ============================================================
// Utility
// ============================================================

function findAll(buf, pat) {
    const p = [];
    for (let i = 0; i <= buf.length - pat.length; i++) {
        let ok = true;
        for (let j = 0; j < pat.length; j++) {
            if (buf[i + j] !== pat[j]) { ok = false; break; }
        }
        if (ok) p.push(i);
    }
    return p;
}

function rolByte(b, s) {
    s &= 7; if (s === 0) return b;
    return ((b << s) | (b >>> (8 - s))) & 0xFF;
}

function decompress(buf) {
    const key = buf[7];
    const marker = new Uint8Array([0x14, 0x00, 0x06, 0x00, 0x08, 0x00]);
    const streams = {};
    for (const mp of findAll(buf, marker)) {
        const si = mp - 4;
        if (si < 0 || si + 0x1E > buf.length) continue;
        const f1 = buf.readUInt32LE(si + 0x0E);
        const csz = buf.readUInt32LE(si + 0x12);
        const nsz = buf.readUInt32LE(si + 0x1A);
        if (nsz > 1024 || csz > 50 * 1024 * 1024) continue;
        const ns = si + 0x1E, ne = ns + nsz;
        if (ne > buf.length) continue;
        const rn = buf.subarray(ns, ne);
        let n = '';
        for (let i = 0; i < nsz; i++) n += String.fromCharCode(rolByte(rn[i], key));
        if (!n.length) continue;
        const ds = ne, de = ds + csz;
        if (de > buf.length) continue;
        if (f1 >= 65536 && csz > 0) {
            try { const d = zlib.inflateRawSync(Buffer.from(buf.subarray(ds, de))); if (d && d.length > 0 && !streams[n]) streams[n] = d; } catch (e) {
                try { const d = zlib.inflateSync(Buffer.from(buf.subarray(ds, de))); if (d && d.length > 0 && !streams[n]) streams[n] = d; } catch (e2) {}
            }
        }
    }
    return streams;
}

function classify(v) {
    if (v === 0) return 'ZERO';
    if (v === 1) return 'ONE';
    if (v <= 255) return 'SMALL';
    return 'LARGE';
}

function pad(s, w) { return String(s).padStart(w || 8); }

// ============================================================
// Face parser
// ============================================================

function parseFaces(dlData) {
    const d = Buffer.isBuffer(dlData) ? dlData : Buffer.from(dlData);
    const MARKER = new Uint8Array([0x0c, 0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00]);
    const faces = [];

    for (const mp of findAll(d, MARKER)) {
        if (mp < 4) continue;
        const edgeCount = d.readUInt32LE(mp - 4);
        if (edgeCount < 1 || edgeCount > 500) continue;
        if (d.readUInt32LE(mp + 8) !== 2) continue;
        const vertexCount = d.readUInt32LE(mp + 12);
        if (vertexCount < 3 || vertexCount > 10000) continue;
        const vertStart = mp + 16;
        if (vertStart + vertexCount * 12 > d.length) continue;

        let valid = true;
        for (let i = 0; i < vertexCount; i++) {
            const off = vertStart + i * 12;
            if (!isFinite(d.readFloatLE(off)) || !isFinite(d.readFloatLE(off + 4)) || !isFinite(d.readFloatLE(off + 8))) { valid = false; break; }
            if (Math.abs(d.readFloatLE(off)) > 100000 || Math.abs(d.readFloatLE(off + 4)) > 100000 || Math.abs(d.readFloatLE(off + 8)) > 100000) { valid = false; break; }
        }
        if (!valid) continue;

        const vertEnd = vertStart + vertexCount * 12;
        const topoStart = vertEnd + 16 + vertexCount * 12;
        if (topoStart + 16 > d.length) continue;
        if (d.readUInt32LE(topoStart) !== 4 || d.readUInt32LE(topoStart + 4) !== 8 || d.readUInt32LE(topoStart + 8) !== 2) continue;
        const block1N = d.readUInt32LE(topoStart + 12);
        if (block1N < 1 || block1N > 100000) continue;

        const b1Start = topoStart + 16;
        const b1End = topoStart + (block1N + 4) * 4;
        if (b1End > d.length) continue;

        const block1Vals = [];
        for (let i = 0; i < block1N; i++) block1Vals.push(d.readUInt32LE(b1Start + i * 4));

        // Block 2
        let block2Vals = [], block2N = 0;
        if (b1End + 16 <= d.length && d.readUInt32LE(b1End) === 4 && d.readUInt32LE(b1End + 4) === 8 && d.readUInt32LE(b1End + 8) === 2) {
            block2N = d.readUInt32LE(b1End + 12);
            if (block2N > 0 && block2N < 10000) {
                for (let i = 0; i < block2N; i++) block2Vals.push(d.readUInt32LE(b1End + 16 + i * 4));
            }
        }

        faces.push({ fi: faces.length, ec: edgeCount, vc: vertexCount, block1N, block1Vals, block2N, block2Vals });
    }
    return faces;
}

// ============================================================
// Section extractor — split Block 1 into ONE-delimited sections
// ============================================================

function extractSections(block1Vals) {
    const sections = [];
    let current = [];
    let currentStart = 0;

    for (let i = 0; i < block1Vals.length; i++) {
        if (block1Vals[i] === 1) {
            if (current.length > 0) {
                sections.push({ vals: current, startIdx: currentStart, endIdx: i - 1 });
            }
            current = [1];
            currentStart = i;
        } else {
            current.push(block1Vals[i]);
        }
    }
    if (current.length > 0) {
        sections.push({ vals: current, startIdx: currentStart, endIdx: block1Vals.length - 1 });
    }
    return sections;
}

// ============================================================
// Section property recorder
// ============================================================

function analyzeSection(section, block2Vals, sectionIdx, totalSections) {
    const vals = section.vals;
    const len = vals.length;

    // Classify tokens
    const tokens = vals.map(v => classify(v));

    // Count tokens
    const counts = { ZERO: 0, ONE: 0, SMALL: 0, LARGE: 0 };
    for (const t of tokens) counts[t]++;

    // Positions of LARGE values
    const largePositions = [];
    for (let i = 0; i < tokens.length; i++) {
        if (tokens[i] === 'LARGE') largePositions.push(i);
    }

    // Positions of ZERO values
    const zeroPositions = [];
    for (let i = 0; i < tokens.length; i++) {
        if (tokens[i] === 'ZERO') zeroPositions.push(i);
    }

    // First and last token
    const firstToken = tokens[0];
    const lastToken = tokens[tokens.length - 1];

    // Transition frequencies
    const transitions = {};
    for (let i = 0; i < tokens.length - 1; i++) {
        const tr = tokens[i] + '→' + tokens[i + 1];
        transitions[tr] = (transitions[tr] || 0) + 1;
    }

    // Block 2 loop size (for this section)
    const loopSize = sectionIdx < block2Vals.length ? (block2Vals[sectionIdx] + 2) >> 1 : null;

    // Compressed sequence
    const compressed = [];
    let i = 0;
    while (i < tokens.length) {
        let j = i;
        while (j < tokens.length && tokens[j] === tokens[i]) j++;
        const runLen = j - i;
        compressed.push(runLen === 1 ? tokens[i] : tokens[i] + '[' + runLen + ']');
        i = j;
    }

    return {
        sectionIdx,
        len,
        loopSize,
        zeroCount: counts.ZERO,
        oneCount: counts.ONE,
        smallCount: counts.SMALL,
        largeCount: counts.LARGE,
        largePositions,
        zeroPositions,
        firstToken,
        lastToken,
        transitions,
        tokens,
        compressed: compressed.join(' '),
        raw: vals,
    };
}

// ============================================================
// Main analysis
// ============================================================

async function main() {
    const allSections = []; // all sections across all files
    const fileSections = {}; // sections per file

    for (const [label, filePath] of Object.entries(FILES)) {
        if (!fs.existsSync(filePath)) { console.log('SKIP: ' + label); continue; }

        const buf = fs.readFileSync(filePath);
        const streams = decompress(buf);

        // Find main DisplayLists
        let mainDL = null;
        for (const [name, data] of Object.entries(streams)) {
            if (name.toLowerCase().includes('displaylist') && data.length > 10000) {
                const d = Buffer.from(data);
                if (d.readUInt32LE(0) === 1 && d.readUInt32LE(4) === 1) { mainDL = data; break; }
            }
        }
        if (!mainDL) continue;

        const faces = parseFaces(mainDL);
        console.log(label + ': ' + faces.length + ' faces');

        const fileSecs = [];
        for (const f of faces) {
            const sections = extractSections(f.block1Vals);
            for (let s = 0; s < sections.length; s++) {
                const analysis = analyzeSection(sections[s], f.block2Vals, s, sections.length);
                analysis.file = label;
                analysis.faceIdx = f.fi;
                analysis.faceVc = f.vc;
                analysis.faceEc = f.ec;
                analysis.faceB1N = f.block1N;
                analysis.faceB2N = f.block2N;
                analysis.totalSectionsInFace = sections.length;
                fileSecs.push(analysis);
                allSections.push(analysis);
            }
        }
        fileSections[label] = fileSecs;
    }

    console.log('\nTotal sections across all files: ' + allSections.length);

    // ============================================================
    // PRIORITY 1: Section property table
    // ============================================================

    console.log('\n' + '='.repeat(100));
    console.log('  SECTION PROPERTY TABLE (first 50 sections)');
    console.log('='.repeat(100));
    console.log('  File    Face  Sec  Len  LoopSize  ZEROS  ONES  SMALL LARGE  First  Last   Compressed');
    console.log('  ' + '-'.repeat(96));

    for (const s of allSections.slice(0, 50)) {
        console.log(
            '  ' + s.file.padEnd(8) +
            '#' + String(s.faceIdx).padStart(4) +
            '  S' + String(s.sectionIdx).padStart(2) +
            '  ' + pad(s.len, 4) +
            '  ' + (s.loopSize !== null ? pad(s.loopSize, 4) : ' INF') +
            '  ' + pad(s.zeroCount, 5) +
            '  ' + pad(s.oneCount, 4) +
            '  ' + pad(s.smallCount, 5) +
            '  ' + pad(s.largeCount, 5) +
            '  ' + s.firstToken.padEnd(6) +
            '  ' + s.lastToken.padEnd(6) +
            '  ' + s.compressed.substring(0, 60)
        );
    }

    // ============================================================
    // PRIORITY 2: Question 1 — Does section length predict loop size?
    // ============================================================

    console.log('\n' + '='.repeat(100));
    console.log('  Q1: DOES SECTION LENGTH PREDICT BLOCK 2 LOOP SIZE?');
    console.log('='.repeat(100));

    // For each section where we have both len and loopSize
    const withLoopSize = allSections.filter(s => s.loopSize !== null);
    console.log('  Sections with loop size: ' + withLoopSize.length + ' / ' + allSections.length);

    // Group by (len, loopSize)
    const lenLoopMap = {};
    for (const s of withLoopSize) {
        const key = s.len + ',' + s.loopSize;
        if (!lenLoopMap[key]) lenLoopMap[key] = { len: s.len, loopSize: s.loopSize, count: 0, examples: [] };
        lenLoopMap[key].count++;
        if (lenLoopMap[key].examples.length < 3) lenLoopMap[key].examples.push(s.file + '#F' + s.faceIdx + 'S' + s.sectionIdx);
    }

    console.log('\n  (len, loopSize) pairs:');
    const sorted = Object.values(lenLoopMap).sort((a, b) => a.len - b.len || a.loopSize - b.loopSize);
    for (const entry of sorted) {
        console.log('    len=' + pad(entry.len, 4) + ' loopSize=' + pad(entry.loopSize, 4) +
            '  ×' + pad(entry.count, 4) + '  ' + entry.examples.join(', '));
    }

    // Check if len uniquely determines loopSize
    const lenToLoops = {};
    for (const s of withLoopSize) {
        if (!lenToLoops[s.len]) lenToLoops[s.len] = new Set();
        lenToLoops[s.len].add(s.loopSize);
    }
    let lenPredicts = true;
    for (const [len, loops] of Object.entries(lenToLoops)) {
        if (loops.size > 1) {
            console.log('\n  COUNTEREXAMPLE: len=' + len + ' maps to loopSizes: ' + [...loops].join(', '));
            lenPredicts = false;
        }
    }
    if (lenPredicts) {
        console.log('\n  RESULT: Section length uniquely predicts loop size in all tested sections');
    }

    // ============================================================
    // PRIORITY 3: Question 2 — One grammar or multiple?
    // ============================================================

    console.log('\n' + '='.repeat(100));
    console.log('  Q2: ONE GRAMMAR OR MULTIPLE GRAMMARS?');
    console.log('='.repeat(100));

    // Check if all sections with the same loop size have the same token pattern
    const loopSizeGroups = {};
    for (const s of withLoopSize) {
        if (!loopSizeGroups[s.loopSize]) loopSizeGroups[s.loopSize] = [];
        loopSizeGroups[s.loopSize].push(s);
    }

    console.log('\n  Sections grouped by loop size:');
    for (const [ls, group] of Object.entries(loopSizeGroups).sort((a, b) => Number(a[0]) - Number(b[0]))) {
        // Get unique compressed patterns
        const patterns = new Set(group.map(s => s.compressed));
        console.log('    loopSize=' + pad(ls, 4) + '  count=' + pad(group.length, 4) +
            '  unique_patterns=' + patterns.size +
            (patterns.size <= 5 ? '  patterns: ' + [...patterns].join(' | ') : ''));
    }

    // ============================================================
    // PRIORITY 4: Question 3 — Template clustering
    // ============================================================

    console.log('\n' + '='.repeat(100));
    console.log('  Q3: TEMPLATE CLUSTERING');
    console.log('='.repeat(100));

    // Cluster by compressed pattern
    const patternGroups = {};
    for (const s of allSections) {
        const pat = s.compressed;
        if (!patternGroups[pat]) patternGroups[pat] = [];
        patternGroups[pat].push(s);
    }

    console.log('\n  Unique compressed patterns: ' + Object.keys(patternGroups).length);
    console.log('\n  Top 20 patterns by frequency:');
    const sortedPats = Object.entries(patternGroups).sort((a, b) => b[1].length - a[1].length);
    for (let i = 0; i < Math.min(20, sortedPats.length); i++) {
        const [pat, group] = sortedPats[i];
        const files = [...new Set(group.map(s => s.file))];
        const loopSizes = [...new Set(group.map(s => s.loopSize).filter(x => x !== null))];
        console.log('    ×' + pad(group.length, 4) + '  loopSizes=[' + loopSizes.join(',') + ']  files=[' + files.join(',') + ']');
        console.log('      ' + pat.substring(0, 100));
    }

    // ============================================================
    // PRIORITY 5: Question 4 — Optional productions
    // ============================================================

    console.log('\n' + '='.repeat(100));
    console.log('  Q4: OPTIONAL PRODUCTIONS');
    console.log('='.repeat(100));

    // For sections with the same loop size, find positions where tokens vary
    for (const [ls, group] of Object.entries(loopSizeGroups).sort((a, b) => Number(a[0]) - Number(b[0]))) {
        if (group.length < 2) continue;
        // All sections with this loop size should have the same length
        const lens = [...new Set(group.map(s => s.len))];
        if (lens.length > 1) {
            console.log('\n  loopSize=' + ls + ': DIFFERENT LENGTHS: ' + lens.join(', '));
            continue;
        }
        const len = lens[0];
        // Check token at each position
        const optionalPositions = [];
        for (let pos = 0; pos < len; pos++) {
            const tokensAtPos = [...new Set(group.map(s => s.tokens[pos]))];
            if (tokensAtPos.length > 1) {
                optionalPositions.push({ pos, tokens: tokensAtPos });
            }
        }
        if (optionalPositions.length > 0) {
            console.log('\n  loopSize=' + ls + ' (len=' + len + '):');
            for (const op of optionalPositions) {
                console.log('    Position ' + op.pos + ': optional tokens: ' + op.tokens.join(' | '));
            }
        }
    }

    // ============================================================
    // PRIORITY 6: Question 5 — Recursive/repeated subsequences
    // ============================================================

    console.log('\n' + '='.repeat(100));
    console.log('  Q5: RECURSIVE/REPEATED SUBSEQUENCES');
    console.log('='.repeat(100));

    // Find repeated subsequences of length 2-6
    for (const subseqLen of [2, 3, 4]) {
        const subseqs = {};
        for (const s of allSections) {
            for (let i = 0; i <= s.tokens.length - subseqLen; i++) {
                const sub = s.tokens.slice(i, i + subseqLen).join(' ');
                subseqs[sub] = (subseqs[sub] || 0) + 1;
            }
        }
        const sorted = Object.entries(subseqs).filter(([k, v]) => v >= 5).sort((a, b) => b[1] - a[1]);
        console.log('\n  ' + subseqLen + '-grams (×5 or more):');
        for (const [sub, count] of sorted.slice(0, 15)) {
            console.log('    ' + sub.padEnd(30) + ' ×' + count);
        }
    }

    // Check for repetition within sections
    console.log('\n  Internal repetition analysis:');
    const repStats = { none: 0, partial: 0, full: 0 };
    for (const s of allSections) {
        const t = s.tokens.join(' ');
        // Check if the section contains a repeated substring
        let hasRep = false;
        for (let subLen = 2; subLen <= Math.floor(s.len / 2); subLen++) {
            for (let i = 0; i <= s.len - subLen * 2; i++) {
                const sub = s.tokens.slice(i, i + subLen).join(' ');
                const rest = t.substring(i + subLen);
                if (rest.includes(sub)) { hasRep = true; break; }
            }
            if (hasRep) break;
        }
        if (hasRep) repStats.partial++;
        else repStats.none++;
    }
    console.log('    Sections with internal repetition: ' + repStats.partial + ' / ' + allSections.length);

    // ============================================================
    // PRIORITY 7: Question 6 — FSM expressibility
    // ============================================================

    console.log('\n' + '='.repeat(100));
    console.log('  Q6: FSM EXPRESSIBILITY');
    console.log('='.repeat(100));

    // Build a transition matrix from all sections
    const allTransitions = {};
    for (const s of allSections) {
        for (let i = 0; i < s.tokens.length - 1; i++) {
            const from = s.tokens[i];
            const to = s.tokens[i + 1];
            if (!allTransitions[from]) allTransitions[from] = {};
            allTransitions[from][to] = (allTransitions[from][to] || 0) + 1;
        }
    }

    console.log('\n  Global transition matrix:');
    const states = ['ONE', 'ZERO', 'LARGE', 'SMALL'];
    for (const from of states) {
        if (!allTransitions[from]) continue;
        const targets = Object.entries(allTransitions[from]).sort((a, b) => b[1] - a[1]);
        console.log('    ' + from + ' → ' + targets.map(([t, c]) => t + '(' + c + ')').join(' '));
    }

    // Check if transitions are deterministic (same state, same next state)
    console.log('\n  Determinism check:');
    let deterministic = true;
    for (const [from, tos] of Object.entries(allTransitions)) {
        const total = Object.values(tos).reduce((a, b) => a + b, 0);
        for (const [to, count] of Object.entries(tos)) {
            if (count / total < 0.95) {
                console.log('    NON-DETERMINISTIC: ' + from + ' → ' + to + ' (' + (count / total * 100).toFixed(1) + '%)');
                deterministic = false;
            }
        }
    }
    if (deterministic) {
        console.log('    All transitions are >95% deterministic');
    }

    // Check if first token is always ONE
    const firstTokens = [...new Set(allSections.map(s => s.firstToken))];
    console.log('\n  First token: ' + firstTokens.join(', '));

    // Check if last token is always the same
    const lastTokens = [...new Set(allSections.map(s => s.lastToken))];
    console.log('  Last token: ' + lastTokens.join(', '));

    // Check for position-dependent token distributions
    console.log('\n  Position-dependent token distribution (sections with loopSize=1):');
    const ls1 = allSections.filter(s => s.loopSize === 1);
    if (ls1.length > 0) {
        const maxLen = Math.max(...ls1.map(s => s.len));
        for (let pos = 0; pos < Math.min(maxLen, 20); pos++) {
            const tokensAtPos = {};
            for (const s of ls1) {
                if (pos < s.tokens.length) {
                    tokensAtPos[s.tokens[pos]] = (tokensAtPos[s.tokens[pos]] || 0) + 1;
                }
            }
            const total = Object.values(tokensAtPos).reduce((a, b) => a + b, 0);
            const dist = Object.entries(tokensAtPos).map(([t, c]) => t + ':' + (c / total * 100).toFixed(0) + '%').join(' ');
            console.log('    pos=' + pad(pos, 2) + ': ' + dist);
        }
    }

    // ============================================================
    // SUMMARY
    // ============================================================

    console.log('\n' + '='.repeat(100));
    console.log('  SUMMARY');
    console.log('='.repeat(100));

    console.log('\n  Q1: Does section length predict loop size?');
    console.log('    → Check output above for counterexamples');

    console.log('\n  Q2: One grammar or multiple?');
    const uniquePatterns = Object.keys(patternGroups).length;
    console.log('    → ' + uniquePatterns + ' unique compressed patterns across ' + allSections.length + ' sections');

    console.log('\n  Q3: Template clustering?');
    console.log('    → Top pattern: ×' + sortedPats[0][1].length + ' sections');
    console.log('    → ' + sortedPats.filter(([k, v]) => v.length >= 3).length + ' patterns appear ≥3 times');

    console.log('\n  Q4: Optional productions?');
    console.log('    → Check position-dependent analysis above');

    console.log('\n  Q5: Recursive subsequences?');
    console.log('    → Check 2/3/4-gram frequencies above');

    console.log('\n  Q6: FSM expressible?');
    console.log('    → Check determinism check above');
}

main().catch(err => { console.error(err); process.exit(1); });
