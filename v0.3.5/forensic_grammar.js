/**
 * forensic_grammar.js — Block 1 Grammar Discovery + Loop Correspondence + DisplayLists Audit
 *
 * Read-only forensic investigation. No parser modifications.
 *
 * Usage:
 *   node forensic_grammar.js                  # all 4 files, full report
 *   node forensic_grammar.js --file bottom    # single file
 *   node forensic_grammar.js --grammar-only   # skip loop/displaylist sections
 */

const fs = require('fs');
const path = require('path');
const { extractMesh } = require('./src/sldprt-extractor.js');

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

function classify(v) {
    if (v === 0) return 'ZERO';
    if (v === 1) return 'ONE';
    if (v <= 255) return 'SMALL';
    return 'LARGE';
}

function seqKey(cls) { return cls; }

function pad(n, w) { return String(n).padStart(w || 8); }

// ============================================================
// Internal: parse faces directly from decompressed DisplayLists buffer
// ============================================================

const zlib = require('zlib');

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

function decompressOpenSX(buf) {
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
            try { decompressed = zlib.inflateRawSync(Buffer.from(compressed)); } catch (e) {}
            if (!decompressed || decompressed.length === 0) {
                try { decompressed = zlib.inflateSync(Buffer.from(compressed)); } catch (e) {}
            }
            if (decompressed && decompressed.length > 0 && !streams[name]) {
                streams[name] = decompressed;
            }
        }
    }
    return streams;
}

function findDisplayListsStreams(buf) {
    const streams = decompressOpenSX(buf);
    const results = [];
    for (const [name, data] of Object.entries(streams)) {
        if (name.toLowerCase().includes('displaylist')) {
            results.push({ name, data, size: data.length });
        }
    }
    return { allStreams: streams, displayListStreams: results };
}

// ============================================================
// Face parser for raw Block 1/Block 2 data
// ============================================================

function parseFacesRaw(dlData) {
    const d = Buffer.isBuffer(dlData) ? dlData : Buffer.from(dlData);
    const MARKER = new Uint8Array([0x0c, 0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00]);
    const markerPositions = findAll(d, MARKER);

    const faces = [];

    for (const mp of markerPositions) {
        if (mp < 4) continue;
        const edgeCount = d.readUInt32LE(mp - 4);
        if (edgeCount < 1 || edgeCount > 500) continue;
        const faceType = d.readUInt32LE(mp + 8);
        if (faceType !== 2) continue;
        const vertexCount = d.readUInt32LE(mp + 12);
        if (vertexCount < 3 || vertexCount > 10000) continue;
        const vertStart = mp + 16;
        if (vertStart + vertexCount * 12 > d.length) continue;

        // Validate vertices
        let valid = true;
        for (let i = 0; i < vertexCount; i++) {
            const off = vertStart + i * 12;
            const x = d.readFloatLE(off);
            const y = d.readFloatLE(off + 4);
            const z = d.readFloatLE(off + 8);
            if (!isFinite(x) || !isFinite(y) || !isFinite(z)) { valid = false; break; }
            if (Math.abs(x) > 100000 || Math.abs(y) > 100000 || Math.abs(z) > 100000) { valid = false; break; }
        }
        if (!valid) continue;

        const vertEnd = vertStart + vertexCount * 12;

        // Normals
        const normStart = vertEnd + 16;
        const normEnd = normStart + vertexCount * 12;

        // Block 1 header
        const topoStart = vertEnd + 16 + vertexCount * 12;
        if (topoStart + 16 > d.length) continue;
        const h0 = d.readUInt32LE(topoStart);
        const h1 = d.readUInt32LE(topoStart + 4);
        const h2 = d.readUInt32LE(topoStart + 8);
        const block1N = d.readUInt32LE(topoStart + 12);
        if (h0 !== 4 || h1 !== 8 || h2 !== 2) continue;
        if (block1N < 1 || block1N > 100000) continue;

        // Block 1 body
        const b1Start = topoStart + 16;
        const b1End = topoStart + (block1N + 4) * 4;
        if (b1End > d.length) continue;

        const block1Vals = [];
        for (let i = 0; i < block1N; i++) {
            block1Vals.push(d.readUInt32LE(b1Start + i * 4));
        }

        // Block 2
        let block2Vals = [];
        let block2N = 0;
        if (b1End + 16 <= d.length &&
            d.readUInt32LE(b1End) === 4 &&
            d.readUInt32LE(b1End + 4) === 8 &&
            d.readUInt32LE(b1End + 8) === 2) {
            block2N = d.readUInt32LE(b1End + 12);
            if (block2N > 0 && block2N < 10000) {
                for (let i = 0; i < block2N; i++) {
                    block2Vals.push(d.readUInt32LE(b1End + 16 + i * 4));
                }
            }
        }

        // Count ONEs in Block 1
        let oneCount = 0;
        for (const v of block1Vals) if (v === 1) oneCount++;

        faces.push({
            fi: faces.length,
            ec: edgeCount,
            vc: vertexCount,
            block1N,
            block1Vals,
            block2N,
            block2Vals,
            oneCount,
            topoStart,
            facePos: mp - 4,
        });
    }

    return faces;
}

// ============================================================
// PRIORITY 1: Grammar Discovery
// ============================================================

function analyzeGrammar(faces, fileName) {
    console.log('\n' + '='.repeat(80));
    console.log('  PRIORITY 1: BLOCK 1 GRAMMAR DISCOVERY — ' + fileName);
    console.log('='.repeat(80));

    // Phase 1: Classify all u32s across all faces
    console.log('\n--- PHASE 1: Classification per face ---');
    console.log('  Face    vc    B1_N   ZERO   ONE   SMALL LARGE  ZERO%   ONE%');
    console.log('  ' + '-'.repeat(72));

    for (const f of faces) {
        const counts = { ZERO: 0, ONE: 0, SMALL: 0, LARGE: 0 };
        for (const v of f.block1Vals) counts[classify(v)]++;
        const n = f.block1N;
        console.log(
            '  #' + pad(f.fi, 3) +
            '  ' + pad(f.vc, 5) +
            '  ' + pad(f.block1N, 5) +
            '  ' + pad(counts.ZERO, 5) +
            '  ' + pad(counts.ONE, 4) +
            '  ' + pad(counts.SMALL, 5) +
            '  ' + pad(counts.LARGE, 5) +
            '  ' + (counts.ZERO / n * 100).toFixed(1).padStart(5) + '%' +
            '  ' + (counts.ONE / n * 100).toFixed(1).padStart(5) + '%'
        );
    }

    // Phase 2: Full sequences for small faces (vc <= 30)
    console.log('\n--- PHASE 2: Full classification sequences (faces with B1_N <= 60) ---');
    for (const f of faces) {
        if (f.block1N > 60) {
            // For large faces, show first 80 and last 20
            const seq = f.block1Vals.map(v => classify(v));
            const first = seq.slice(0, 80).join(' ');
            const last = seq.slice(-20).join(' ');
            console.log('\n  Face #' + f.fi + ' (vc=' + f.vc + ', B1_N=' + f.block1N + '):');
            console.log('    FIRST 80: ' + first);
            console.log('    LAST  20: ' + last);
            // Show compressed: collapse runs
            const compressed = compressSequence(seq);
            console.log('    COMPRESSED: ' + compressed);
        } else {
            const seq = f.block1Vals.map(v => classify(v));
            console.log('\n  Face #' + f.fi + ' (vc=' + f.vc + ', B1_N=' + f.block1N + '):');
            console.log('    ' + seq.join(' '));
            // Also show the raw values
            console.log('    RAW:  ' + f.block1Vals.join(','));
        }
    }

    // Phase 3: Run-length encoding analysis
    console.log('\n--- PHASE 3: Run-length encoding (RLE) analysis ---');
    const allRuns = []; // { class, length, faceIdx }
    for (const f of faces) {
        let i = 0;
        while (i < f.block1Vals.length) {
            const cls = classify(f.block1Vals[i]);
            let len = 1;
            while (i + len < f.block1Vals.length && classify(f.block1Vals[i + len]) === cls) len++;
            allRuns.push({ cls, len, fi: f.fi });
            i += len;
        }
    }

    // Run length distribution per class
    for (const cls of ['ZERO', 'ONE', 'SMALL', 'LARGE']) {
        const runs = allRuns.filter(r => r.cls === cls);
        if (runs.length === 0) continue;
        const lengths = runs.map(r => r.len);
        const lenDist = {};
        for (const l of lengths) lenDist[l] = (lenDist[l] || 0) + 1;
        const sorted = Object.entries(lenDist).sort((a, b) => Number(b[0]) - Number(a[0]));
        console.log('\n  Class ' + cls + ': ' + runs.length + ' runs, total u32s = ' + lengths.reduce((a, b) => a + b, 0));
        console.log('    Top run lengths: ' + sorted.slice(0, 10).map(([l, c]) => 'len=' + l + ' ×' + c).join(', '));
        console.log('    Min=' + Math.min(...lengths) + ' Max=' + Math.max(...lengths) + ' Median=' + lengths.sort((a, b) => a - b)[Math.floor(lengths.length / 2)]);
    }

    // Phase 4: Bigram analysis (pair transitions)
    console.log('\n--- PHASE 4: Bigram (2-gram) transitions ---');
    const bigrams = {};
    for (const f of faces) {
        const seq = f.block1Vals.map(v => classify(v));
        for (let i = 0; i < seq.length - 1; i++) {
            const bg = seq[i] + '→' + seq[i + 1];
            bigrams[bg] = (bigrams[bg] || 0) + 1;
        }
    }
    const sortedBG = Object.entries(bigrams).sort((a, b) => b[1] - a[1]);
    console.log('  Top 20 bigrams:');
    for (const [bg, count] of sortedBG.slice(0, 20)) {
        console.log('    ' + bg.padEnd(20) + ' ×' + count);
    }

    // Phase 5: Trigram analysis
    console.log('\n--- PHASE 5: Trigram (3-gram) transitions ---');
    const trigrams = {};
    for (const f of faces) {
        const seq = f.block1Vals.map(v => classify(v));
        for (let i = 0; i < seq.length - 2; i++) {
            const tg = seq[i] + '→' + seq[i + 1] + '→' + seq[i + 2];
            trigrams[tg] = (trigrams[tg] || 0) + 1;
        }
    }
    const sortedTG = Object.entries(trigrams).sort((a, b) => b[1] - a[1]);
    console.log('  Top 15 trigrams:');
    for (const [tg, count] of sortedTG.slice(0, 15)) {
        console.log('    ' + tg.padEnd(30) + ' ×' + count);
    }

    // Phase 6: Look for production rules / grammar patterns
    console.log('\n--- PHASE 6: Production rule candidates ---');

    // Check if Block 1 always starts with ONE
    let startsWithOne = 0;
    for (const f of faces) if (f.block1Vals[0] === 1) startsWithOne++;
    console.log('  Faces starting with ONE: ' + startsWithOne + '/' + faces.length);

    // Check if ONEs are always followed by specific patterns
    const afterOne = {};
    for (const f of faces) {
        for (let i = 0; i < f.block1Vals.length - 1; i++) {
            if (f.block1Vals[i] === 1) {
                const next = classify(f.block1Vals[i + 1]);
                afterOne[next] = (afterOne[next] || 0) + 1;
            }
        }
    }
    console.log('  After ONE: ' + Object.entries(afterOne).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ×' + v).join(', '));

    // Check what appears before ONE
    const beforeOne = {};
    for (const f of faces) {
        for (let i = 1; i < f.block1Vals.length; i++) {
            if (f.block1Vals[i] === 1) {
                const prev = classify(f.block1Vals[i - 1]);
                beforeOne[prev] = (beforeOne[prev] || 0) + 1;
            }
        }
    }
    console.log('  Before ONE: ' + Object.entries(beforeOne).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ×' + v).join(', '));

    // Check if ONEs appear at regular intervals
    console.log('\n  ONE positions per face:');
    for (const f of faces) {
        const positions = [];
        for (let i = 0; i < f.block1Vals.length; i++) {
            if (f.block1Vals[i] === 1) positions.push(i);
        }
        if (positions.length <= 30) {
            // Compute deltas between consecutive ONEs
            const deltas = [];
            for (let i = 1; i < positions.length; i++) deltas.push(positions[i] - positions[i - 1]);
            const uniqueDeltas = [...new Set(deltas)].sort((a, b) => a - b);
            console.log('    Face #' + f.fi + ' (' + positions.length + ' ONEs): positions=' +
                positions.join(',') +
                ' deltas=' + deltas.join(','));
        } else {
            console.log('    Face #' + f.fi + ' (' + positions.length + ' ONEs): too many to list, first 20: ' + positions.slice(0, 20).join(','));
        }
    }

    // Phase 7: Section analysis — look for ZERO delimiters
    console.log('\n--- PHASE 7: Section analysis (ZERO-delimited sections) ---');
    for (const f of faces) {
        if (f.block1N > 200) continue; // skip huge faces
        // Split by runs of 3+ ZEROs
        const sections = splitByZeroRuns(f.block1Vals, 3);
        if (sections.length > 1) {
            console.log('  Face #' + f.fi + ' (vc=' + f.vc + '): ' + sections.length + ' sections');
            for (let s = 0; s < Math.min(sections.length, 10); s++) {
                const sec = sections[s];
                const cls = sec.map(v => classify(v));
                console.log('    Section ' + s + ' (len=' + sec.length + '): ' + cls.join(' '));
                console.log('      RAW: ' + sec.join(','));
            }
            if (sections.length > 10) console.log('    ... and ' + (sections.length - 10) + ' more sections');
        }
    }
}

function splitByZeroRuns(vals, minRun) {
    const sections = [];
    let current = [];
    let zeroRun = 0;
    for (const v of vals) {
        if (v === 0) {
            zeroRun++;
            if (zeroRun >= minRun && current.length > 0) {
                sections.push(current);
                current = [];
            }
            if (zeroRun >= minRun) {
                current.push(v); // include the zeros in the separator
            }
        } else {
            zeroRun = 0;
            current.push(v);
        }
    }
    if (current.length > 0) sections.push(current);
    return sections;
}

function compressSequence(seq) {
    const parts = [];
    let i = 0;
    while (i < seq.length) {
        let j = i;
        while (j < seq.length && seq[j] === seq[i]) j++;
        const len = j - i;
        if (len === 1) {
            parts.push(seq[i]);
        } else {
            parts.push(seq[i] + '[' + len + ']');
        }
        i = j;
    }
    return parts.join(' ');
}

// ============================================================
// PRIORITY 2: Loop Correspondence
// ============================================================

function analyzeLoopCorrespondence(faces, fileName) {
    console.log('\n' + '='.repeat(80));
    console.log('  PRIORITY 2: LOOP CORRESPONDENCE — ' + fileName);
    console.log('='.repeat(80));

    console.log('\n  Face    vc    B1_N  B2_N  ONEs  Match?  B1_N/vc  B1_N/ONEs');
    console.log('  ' + '-'.repeat(72));

    let perfectMatches = 0;
    let totalFaces = 0;

    for (const f of faces) {
        totalFaces++;
        const b2n = f.block2N;
        const ones = f.oneCount;
        const loopCount = b2n; // Block 2 entries = loop count (verified)

        const match = (ones === loopCount) ? 'YES' : (ones === loopCount + 1 ? '+1' : 'NO');
        if (ones === loopCount || ones === loopCount + 1) perfectMatches++;

        console.log(
            '  #' + pad(f.fi, 3) +
            '  ' + pad(f.vc, 5) +
            '  ' + pad(f.block1N, 5) +
            '  ' + pad(b2n, 4) +
            '  ' + pad(ones, 4) +
            '  ' + match.padEnd(7) +
            '  ' + (f.block1N / f.vc).toFixed(3).padStart(7) +
            '  ' + (ones > 0 ? (f.block1N / ones).toFixed(1) : 'INF').padStart(8)
        );
    }

    console.log('\n  Summary: ' + perfectMatches + '/' + totalFaces + ' faces have ONEs matching B2_N or B2_N+1');

    // Check ONE position relative to B2 structure
    console.log('\n  Detailed ONE analysis:');
    for (const f of faces) {
        if (f.block1N > 200) continue;
        const onePositions = [];
        for (let i = 0; i < f.block1Vals.length; i++) {
            if (f.block1Vals[i] === 1) onePositions.push(i);
        }
        // Show what's between consecutive ONEs
        console.log('  Face #' + f.fi + ' (vc=' + f.vc + ', B2=' + f.block2N + ', ONEs=' + onePositions.length + '):');
        for (let i = 0; i < Math.min(onePositions.length, 5); i++) {
            const start = onePositions[i];
            const end = i + 1 < onePositions.length ? onePositions[i + 1] : f.block1Vals.length;
            const between = f.block1Vals.slice(start, end);
            const cls = between.map(v => classify(v));
            console.log('    ONE@' + start + ' → next ONE@' + (i + 1 < onePositions.length ? onePositions[i + 1] : 'END') +
                ' [' + between.length + ' u32s]: ' + cls.join(' '));
        }
        if (onePositions.length > 5) console.log('    ... (' + (onePositions.length - 5) + ' more)');
    }

    // Cross-face: does ONE count always match loop count?
    console.log('\n  EXCEPTIONS (faces where ONEs ≠ B2_N):');
    let found = false;
    for (const f of faces) {
        if (f.oneCount !== f.block2N) {
            console.log('    Face #' + f.fi + ': ONEs=' + f.oneCount + ' B2_N=' + f.block2N + ' diff=' + (f.oneCount - f.block2N));
            found = true;
        }
    }
    if (!found) console.log('    None found — ONE count exactly equals B2 entry count in all faces');
}

// ============================================================
// PRIORITY 3: Small DisplayLists Stream
// ============================================================

function analyzeDisplayLists(allStreams, displayListStreams, fileName) {
    console.log('\n' + '='.repeat(80));
    console.log('  PRIORITY 3: DISPLAYLISTS STREAM AUDIT — ' + fileName);
    console.log('='.repeat(80));

    // Show ALL streams
    console.log('\n--- ALL DECOMPRESSED STREAMS ---');
    const sorted = Object.entries(allStreams).sort((a, b) => b[1].length - a[1].length);
    console.log('  Total streams: ' + sorted.length);
    console.log('  ' + 'Name'.padEnd(45) + 'Size'.padStart(10) + '  Header (first 16 bytes)');
    console.log('  ' + '-'.repeat(80));
    for (const [name, data] of sorted) {
        const header = [];
        const d = Buffer.from(data);
        for (let i = 0; i < Math.min(4, Math.floor(d.length / 4)); i++) {
            header.push(d.readUInt32LE(i * 4));
        }
        const isDL = name.toLowerCase().includes('displaylist');
        console.log(
            '  ' + (isDL ? '* ' : '  ') +
            name.padEnd(45) +
            String(data.length).padStart(10) +
            '  [' + header.map(h => '0x' + h.toString(16)).join(', ') + ']'
        );
    }

    // Analyze each DisplayLists stream
    for (const dl of displayListStreams) {
        console.log('\n--- Stream: ' + dl.name + ' (' + dl.size + ' bytes) ---');
        const d = Buffer.from(dl.data);

        // Phase 1: Header analysis
        console.log('\n  Header (first 64 bytes as u32s):');
        const headerU32s = [];
        for (let i = 0; i < Math.min(16, Math.floor(d.length / 4)); i++) {
            headerU32s.push(d.readUInt32LE(i * 4));
        }
        for (let i = 0; i < headerU32s.length; i++) {
            console.log('    [' + (i * 4).toString(16).padStart(4, '0') + '] = ' +
                pad(headerU32s[i], 10) + ' (0x' + headerU32s[i].toString(16).padStart(8, '0') + ')');
        }

        // Phase 2: Byte distribution
        console.log('\n  Byte distribution:');
        const byteFreq = new Uint32Array(256);
        for (let i = 0; i < d.length; i++) byteFreq[d[i]]++;
        let entropy = 0;
        for (let i = 0; i < 256; i++) {
            if (byteFreq[i] > 0) {
                const p = byteFreq[i] / d.length;
                entropy -= p * Math.log2(p);
            }
        }
        console.log('    Entropy: ' + entropy.toFixed(2) + ' bits/byte (max 8.0)');
        const zeroPct = (byteFreq[0] / d.length * 100).toFixed(1);
        console.log('    Zero bytes: ' + zeroPct + '%');

        // Phase 3: String scan
        console.log('\n  Embedded strings (ASCII, len >= 4):');
        const strings = [];
        let cur = '';
        let curStart = 0;
        for (let i = 0; i < d.length; i++) {
            const c = d[i];
            if (c >= 0x20 && c < 0x7f) {
                if (cur.length === 0) curStart = i;
                cur += String.fromCharCode(c);
            } else {
                if (cur.length >= 4) {
                    strings.push({ str: cur, offset: curStart });
                }
                cur = '';
            }
        }
        if (cur.length >= 4) strings.push({ str: cur, offset: curStart });
        // Deduplicate
        const seen = new Set();
        for (const s of strings) {
            if (!seen.has(s.str)) {
                seen.add(s.str);
                console.log('    +' + s.offset.toString(16).padStart(6, '0') + ': "' + s.str + '"');
            }
        }
        if (strings.length === 0) console.log('    (none found)');

        // Phase 4: Structure scan — find known markers
        console.log('\n  Known markers:');
        // Search for face markers [12, 0, 0, 0, 100, 0, 0, 0]
        const faceMarkers = findAll(d, new Uint8Array([0x0c, 0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00]));
        console.log('    Face markers [12,0,0,0,100,0,0,0]: ' + faceMarkers.length + ' occurrences');
        for (const pos of faceMarkers.slice(0, 5)) {
            console.log('      at +' + pos.toString(16) + ' (u32 LE: ' + d.readUInt32LE(pos) + ', ' + d.readUInt32LE(pos + 4) + ')');
        }

        // Search for topology headers [4, 8, 2, N]
        let topoHeaders = 0;
        for (let i = 0; i <= d.length - 16; i += 4) {
            if (d.readUInt32LE(i) === 4 && d.readUInt32LE(i + 4) === 8 &&
                d.readUInt32LE(i + 8) === 2) {
                topoHeaders++;
                if (topoHeaders <= 5) {
                    const n = d.readUInt32LE(i + 12);
                    console.log('    Topo header [4,8,2,' + n + '] at +' + i.toString(16));
                }
            }
        }
        console.log('    Total topology headers [4,8,2,N]: ' + topoHeaders);

        // Search for [1, 1] header (start of large DisplayLists)
        let dlHeaders = 0;
        for (let i = 0; i <= d.length - 8; i += 4) {
            if (d.readUInt32LE(i) === 1 && d.readUInt32LE(i + 4) === 1) {
                dlHeaders++;
                if (dlHeaders <= 5) {
                    console.log('    DL header [1,1] at +' + i.toString(16));
                }
            }
        }
        console.log('    Total [1,1] headers: ' + dlHeaders);

        // Phase 5: u32 distribution
        console.log('\n  u32 distribution:');
        const u32Freq = new Map();
        for (let i = 0; i <= d.length - 4; i += 4) {
            const v = d.readUInt32LE(i);
            u32Freq.set(v, (u32Freq.get(v) || 0) + 1);
        }
        const topU32 = [...u32Freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
        for (const [val, count] of topU32) {
            console.log('    ' + pad(val, 10) + ' × ' + count + ' (' + (count / (d.length / 4) * 100).toFixed(1) + '%)');
        }

        // Phase 6: Cross-reference — do any u32 values in this stream match
        // positions in the large DisplayLists?
        console.log('\n  Stream size categories:');
        const sizes = [];
        for (let i = 0; i <= d.length - 4; i += 4) sizes.push(d.readUInt32LE(i));
        console.log('    Zero: ' + sizes.filter(v => v === 0).length);
        console.log('    One: ' + sizes.filter(v => v === 1).length);
        console.log('    Small (2-255): ' + sizes.filter(v => v >= 2 && v <= 255).length);
        console.log('    Medium (256-65535): ' + sizes.filter(v => v >= 256 && v <= 65535).length);
        console.log('    Large (>65535): ' + sizes.filter(v => v > 65535).length);
    }
}

// ============================================================
// Main
// ============================================================

async function main() {
    const args = process.argv.slice(2);
    const fileArg = args.includes('--file') ? args[args.indexOf('--file') + 1] : null;
    const grammarOnly = args.includes('--grammar-only');

    const files = fileArg ? { [fileArg]: FILES[fileArg] } : FILES;

    for (const [label, filePath] of Object.entries(files)) {
        if (!fs.existsSync(filePath)) {
            console.log('SKIP: ' + filePath + ' not found');
            continue;
        }

        console.log('\n' + '#'.repeat(80));
        console.log('#  FILE: ' + label + ' — ' + path.basename(filePath));
        console.log('#'.repeat(80));

        // Decompress and find streams
        const raw = fs.readFileSync(filePath);
        const { allStreams, displayListStreams } = findDisplayListsStreams(raw);

        // Find main DisplayLists (the large one with face data)
        let mainDL = null;
        for (const dl of displayListStreams) {
            const d = Buffer.from(dl.data);
            if (d.readUInt32LE(0) === 1 && d.readUInt32LE(4) === 1 && d.length > 10000) {
                mainDL = dl;
                break;
            }
        }

        if (!mainDL) {
            console.log('No main DisplayLists stream found for ' + label);
            continue;
        }

        // Parse faces
        const faces = parseFacesRaw(mainDL.data);
        console.log('\nParsed ' + faces.length + ' faces from main DisplayLists stream (' + mainDL.size + ' bytes)');

        // Priority 1: Grammar
        analyzeGrammar(faces, label);

        // Priority 2: Loop correspondence
        analyzeLoopCorrespondence(faces, label);

        // Priority 3: DisplayLists audit
        if (!grammarOnly) {
            analyzeDisplayLists(allStreams, displayListStreams, label);
        }
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
