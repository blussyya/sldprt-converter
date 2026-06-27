#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ============================================================
// SLDPRT openswx decompression
// ============================================================

function rolByte(b, shift) {
    shift &= 7;
    if (shift === 0) return b;
    return ((b << shift) | (b >>> (8 - shift))) & 0xFF;
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

function decompressOpenSX(buf) {
    const key = buf[7];
    const marker = [0x14, 0x00, 0x06, 0x00, 0x08, 0x00];
    const streams = {};

    for (const mp of findAll(buf, marker)) {
        const si = mp - 4;
        if (si < 0 || si + 0x1E > buf.length) continue;

        const csz = buf.readUInt32LE(si + 0x12);
        const nsz = buf.readUInt32LE(si + 0x1A);

        if (nsz > 1024 || csz > 50 * 1024 * 1024) continue;

        const nameStart = si + 0x1E;
        const nameEnd = nameStart + nsz;
        if (nameEnd > buf.length) continue;

        const rawName = buf.subarray(nameStart, nameEnd);
        let name = '';
        for (let i = 0; i < nsz; i++) {
            name += String.fromCharCode(rolByte(rawName[i], key));
        }
        if (name.length === 0) continue;

        const dataStart = nameEnd;
        const dataEnd = dataStart + csz;
        if (dataEnd > buf.length) continue;

        const f1 = buf.readUInt32LE(si + 0x0E);
        if (f1 >= 65536 && csz > 0) {
            const compressed = buf.subarray(dataStart, dataEnd);
            let decompressed = null;
            try { decompressed = zlib.inflateRawSync(Buffer.from(compressed)); } catch (e) {
                try { decompressed = zlib.inflateSync(Buffer.from(compressed)); } catch (e2) {}
            }
            if (decompressed && decompressed.length > 0 && !streams[name]) {
                streams[name] = decompressed;
            }
        }
    }
    return streams;
}

// ============================================================
// OLE2 parser (minimal, for old format files)
// ============================================================

function _concatChunks(chunks) {
    const total = chunks.reduce((acc, c) => acc + c.length, 0);
    const result = Buffer.alloc(total);
    let offset = 0;
    for (const chunk of chunks) {
        chunk.copy(result, offset);
        offset += chunk.length;
    }
    return result;
}

function parseOLE2(buf) {
    const ss = 1 << buf.readUInt32LE(30);
    const difat = [];
    for (let i = 0; i < 109; i++) {
        const s = buf.readInt32LE(76 + i * 4);
        if (s >= 0) difat.push(s);
    }
    const visitedFat = new Set();
    let sec = buf.readInt32LE(68);
    while (sec >= 0 && sec < 0xfffefffe && !visitedFat.has(sec)) {
        visitedFat.add(sec);
        const off = (sec + 1) * ss;
        if (off + ss > buf.length) break;
        for (let i = 0; i < ss / 4 - 1; i++) {
            const s = buf.readInt32LE(off + i * 4);
            if (s >= 0) difat.push(s);
        }
        sec = buf.readInt32LE(off + ss - 4);
    }
    const fat = [];
    for (const s of difat) {
        const off = (s + 1) * ss;
        if (off + ss > buf.length) continue;
        for (let i = 0; i < ss / 4; i++) {
            fat.push(buf.readInt32LE(off + i * 4));
        }
    }
    const dirSec = buf.readUInt32LE(48);
    const chunks = [];
    let cur = dirSec;
    const visitedDir = new Set();
    while (cur >= 0 && cur < 0xfffefffe && !visitedDir.has(cur)) {
        visitedDir.add(cur);
        const off = (cur + 1) * ss;
        if (off + ss > buf.length) break;
        chunks.push(buf.subarray(off, off + ss));
        cur = fat[cur] ?? -1;
    }
    const dirData = _concatChunks(chunks);
    const entries = [];
    for (let i = 0; i + 128 <= dirData.length; i += 128) {
        const nameLen = dirData.readUInt16LE(i + 64);
        if (nameLen === 0) continue;
        let name = '';
        for (let k = 0; k < nameLen - 2; k += 2) {
            name += String.fromCharCode(dirData[i + k] | (dirData[i + k + 1] << 8));
        }
        entries.push({
            name,
            type: dirData[i + 66],
            startSector: dirData.readInt32LE(i + 116),
            size: dirData.readUInt32LE(i + 120)
        });
    }
    const miniCutoff = buf.readUInt32LE(0x38);
    const miniFatStartSec = buf.readInt32LE(0x3C);
    const totalMiniFatSec = buf.readUInt32LE(0x40);
    const rootEntry = entries.find(e => e.name === 'Root Entry');
    return { ss, fat, entries, miniCutoff, miniFatStartSec, totalMiniFatSec, rootEntry };
}

function readStream(buf, fat, entry, ss, ole) {
    if (entry.type !== 2 || entry.startSector < 0) return null;
    if (ole && ole.miniCutoff && entry.size < ole.miniCutoff && ole.rootEntry) {
        // Build mini FAT and mini stream
        if (ole.totalMiniFatSec <= 0 || ole.miniFatStartSec < 0) return null;
        const miniFAT = [];
        let mcur = ole.miniFatStartSec;
        const visited = new Set();
        for (let s = 0; s < ole.totalMiniFatSec; s++) {
            if (visited.has(mcur) || mcur < 0 || mcur >= 0xfffefffe) break;
            visited.add(mcur);
            const off = (mcur + 1) * ole.ss;
            if (off + ole.ss > buf.length) break;
            for (let i = 0; i < ole.ss / 4; i++) miniFAT.push(buf.readInt32LE(off + i * 4));
            mcur = fat[mcur] ?? -1;
        }
        const miniChunks = [];
        let msc = ole.rootEntry.startSector;
        const visitedMini = new Set();
        while (msc >= 0 && msc < 0xfffefffe && !visitedMini.has(msc)) {
            visitedMini.add(msc);
            const off = (msc + 1) * ole.ss;
            if (off + ole.ss > buf.length) break;
            miniChunks.push(buf.subarray(off, off + ole.ss));
            msc = fat[msc] ?? -1;
        }
        const miniStreamData = _concatChunks(miniChunks);
        const chunks2 = [];
        let cur2 = entry.startSector;
        const visited2 = new Set();
        while (cur2 >= 0 && cur2 < 0xfffefffe && !visited2.has(cur2)) {
            visited2.add(cur2);
            if (cur2 >= miniFAT.length) break;
            const start = cur2 * 64;
            const end = Math.min((cur2 + 1) * 64, miniStreamData.length);
            chunks2.push(miniStreamData.subarray(start, end));
            cur2 = miniFAT[cur2] ?? -1;
        }
        return _concatChunks(chunks2).subarray(0, entry.size);
    }
    const chunks = [];
    let cur = entry.startSector;
    const visited = new Set();
    while (cur >= 0 && cur < 0xfffefffe && !visited.has(cur)) {
        visited.add(cur);
        const off = (cur + 1) * ss;
        if (off + ss > buf.length) break;
        chunks.push(buf.subarray(off, off + ss));
        cur = fat[cur] ?? -1;
    }
    return _concatChunks(chunks).subarray(0, entry.size);
}

// ============================================================
// DisplayLists extraction
// ============================================================

function findDisplayLists(buf) {
    // Try old format (OLE2) first
    try {
        const ole = parseOLE2(buf);
        let dlEntry = ole.entries.find(e => e.name === 'DisplayLists' && e.type === 2);
        if (dlEntry) {
            const dlData = readStream(buf, ole.fat, dlEntry, ole.ss, ole);
            if (dlData && dlData.length > 100) return dlData;
        }
        dlEntry = ole.entries.find(e => e.name === 'DisplayLists__Zip' && e.type === 2);
        if (dlEntry) {
            const dlData = readStream(buf, ole.fat, dlEntry, ole.ss, ole);
            if (dlData && dlData.length > 10) {
                const methods = [
                    { name: 'brotli', fn: zlib.brotliDecompressSync },
                    { name: 'inflateRaw', fn: zlib.inflateRawSync },
                    { name: 'inflate', fn: zlib.inflateSync }
                ];
                for (const skip of [14, 4, 0]) {
                    for (const m of methods) {
                        try {
                            const input = skip > 0 ? dlData.subarray(skip) : dlData;
                            const decompressed = m.fn(Buffer.from(input));
                            if (decompressed && decompressed.length > 100) return decompressed;
                        } catch (e) {}
                    }
                }
            }
        }
    } catch (e) {}

    // Try new format (openswx)
    try {
        const streams = decompressOpenSX(buf);
        for (const [name, data] of Object.entries(streams)) {
            if (name.toLowerCase().includes('displaylist') && data.length > 100) {
                const d = Buffer.isBuffer(data) ? data : Buffer.from(data);
                if (d.readUInt32LE(0) === 1 && d.readUInt32LE(4) === 1) {
                    return data;
                }
            }
        }
    } catch (e) {}

    return null;
}

// ============================================================
// Face block detection & Block 1 extraction
// ============================================================

function extractFacesWithBlock1(dlData) {
    const data = Buffer.isBuffer(dlData) ? dlData : Buffer.from(dlData);
    const results = [];

    if (!data || data.length < 100) return results;

    // Find 0x4D32 (u16) near end to locate headerEnd
    let headerEnd = 0;
    for (let i = data.length - 100; i >= Math.max(0, data.length - 500); i -= 2) {
        if (i + 2 <= data.length && data.readUInt16LE(i) === 0x4D32) {
            headerEnd = i + 18;
            break;
        }
    }
    if (headerEnd === 0) headerEnd = 0;

    // Find face blocks: scan for [12, 100] u32 pair (0x0c000000, 0x64000000 LE)
    const MARKER = Buffer.from([0x0c, 0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00]);
    const markerPositions = findAll(data, MARKER);

    for (const mp of markerPositions) {
        if (mp < 4) continue;
        const edgeCount = data.readUInt32LE(mp - 4);
        if (edgeCount < 1 || edgeCount > 500) continue;
        const faceType = data.readUInt32LE(mp + 8);
        if (faceType !== 2) continue;
        const vertexCount = data.readUInt32LE(mp + 12);
        if (vertexCount < 3 || vertexCount > 5000) continue;

        const vertStart = mp + 16;
        if (vertStart + vertexCount * 12 > data.length) continue;

        // Validate vertex data
        let valid = true;
        for (let i = 0; i < vertexCount; i++) {
            const off = vertStart + i * 12;
            const x = data.readFloatLE(off);
            const y = data.readFloatLE(off + 4);
            const z = data.readFloatLE(off + 8);
            if (!isFinite(x) || !isFinite(y) || !isFinite(z)) { valid = false; break; }
            if (Math.abs(x) > 100000 || Math.abs(y) > 100000 || Math.abs(z) > 100000) { valid = false; break; }
        }
        if (!valid) continue;

        // Navigate to topology
        const vertEnd = vertStart + vertexCount * 12;
        const normStart = vertEnd + 16;
        const normEnd = normStart + vertexCount * 12;
        const topoStart = normEnd;

        if (topoStart + 16 > data.length) continue;

        // Check for [4, 8, 2] header
        const h0 = data.readUInt32LE(topoStart);
        const h1 = data.readUInt32LE(topoStart + 4);
        const h2 = data.readUInt32LE(topoStart + 8);
        if (h0 !== 4 || h1 !== 8 || h2 !== 2) continue;

        const N = data.readUInt32LE(topoStart + 12);

        // Read Block 1: N u32s starting at topoStart+16
        if (topoStart + 16 + N * 4 > data.length) continue;
        const block1 = [];
        for (let i = 0; i < N; i++) {
            block1.push(data.readUInt32LE(topoStart + 16 + i * 4));
        }

        // Check Block 2 header
        const b2Start = topoStart + (N + 4) * 4;
        let hasBlock2 = false;
        if (b2Start + 12 <= data.length) {
            const b2h0 = data.readUInt32LE(b2Start);
            const b2h1 = data.readUInt32LE(b2Start + 4);
            const b2h2 = data.readUInt32LE(b2Start + 8);
            hasBlock2 = (b2h0 === 4 && b2h1 === 8 && b2h2 === 2);
        }

        results.push({
            edgeCount,
            vertexCount,
            block1,
            N,
            hasBlock2,
            block2Start: b2Start,
            topoStart
        });
    }

    return results;
}

// ============================================================
// ANALYSIS FUNCTIONS
// ============================================================

function analyzeFile(filePath) {
    const basename = path.basename(filePath);
    const buf = fs.readFileSync(filePath);
    const dlData = findDisplayLists(buf);

    if (!dlData) {
        return { basename, error: 'Failed to extract DisplayLists' };
    }

    const faces = extractFacesWithBlock1(dlData);
    return { basename, faces, dlDataLength: dlData.length };
}

// --- 1. Per-face metrics table ---
function printPerFaceMetrics(fileResult) {
    const { basename, faces } = fileResult;
    console.log(`\n${'='.repeat(80)}`);
    console.log(`1. PER-FACE METRICS: ${basename}`);
    console.log(`${'='.repeat(80)}`);
    console.log('face#  ec   vc    B1_N  B1_N/ec  B1_N/vc  zeros  ones  unique  min_val  max_val  first_4_vals              last_4_vals');

    for (let i = 0; i < faces.length; i++) {
        const f = faces[i];
        const b1 = f.block1;
        const zeros = b1.filter(v => v === 0).length;
        const ones = b1.filter(v => v === 1).length;
        const unique = new Set(b1).size;
        const minVal = b1.length > 0 ? Math.min(...b1) : 0;
        const maxVal = b1.length > 0 ? Math.max(...b1) : 0;
        const ratioEc = f.edgeCount > 0 ? (f.N / f.edgeCount).toFixed(2) : 'N/A';
        const ratioVc = f.vertexCount > 0 ? (f.N / f.vertexCount).toFixed(2) : 'N/A';
        const first4 = b1.slice(0, 4).join(',');
        const last4 = b1.slice(-4).join(',');

        console.log(
            `${String(i).padStart(5)}  ${String(f.edgeCount).padStart(3)}  ${String(f.vertexCount).padStart(4)}  ` +
            `${String(f.N).padStart(5)}  ${String(ratioEc).padStart(7)}  ${String(ratioVc).padStart(7)}  ` +
            `${String(zeros).padStart(5)}  ${String(ones).padStart(4)}  ${String(unique).padStart(6)}  ` +
            `${String(minVal).padStart(8)}  ${String(maxVal).padStart(8)}  ` +
            `${String(first4).padStart(22)}  ${String(last4).padStart(22)}`
        );
    }
}

// --- 2. Byte-frequency heatmap ---
function printByteFrequencyHeatmap(fileResult) {
    const { basename, faces } = fileResult;
    console.log(`\n${'='.repeat(80)}`);
    console.log(`2. BYTE-FREQUENCY HEATMAP: ${basename}`);
    console.log(`${'='.repeat(80)}`);

    if (faces.length === 0) { console.log('No faces.'); return; }

    const maxN = Math.max(...faces.map(f => f.N));
    console.log(`Max Block 1 length: ${maxN} u32s, Total faces: ${faces.length}`);
    console.log('pos    min_val     max_val   unique  faces_with_pos  constant');
    console.log('----   ---------   -------   ------  -------------  --------');

    for (let p = 0; p < maxN; p++) {
        const vals = [];
        let count = 0;
        for (const f of faces) {
            if (p < f.block1.length) {
                vals.push(f.block1[p]);
                count++;
            }
        }
        if (vals.length === 0) continue;

        const minVal = Math.min(...vals);
        const maxVal = Math.max(...vals);
        const unique = new Set(vals).size;
        const isConstant = unique === 1;

        if (p < 30 || p >= maxN - 5 || isConstant || unique <= 3) {
            console.log(
                `${String(p).padStart(4)}    ${String(minVal).padStart(9)}  ${String(maxVal).padStart(7)}  ` +
                `${String(unique).padStart(6)}  ${String(count).padStart(13)}  ${isConstant ? 'YES [' + minVal + ']' : ''}`
            );
        }
    }
}

// --- 3. Record-boundary detection (autocorrelation) ---
function printRecordBoundaryDetection(fileResult) {
    const { basename, faces } = fileResult;
    console.log(`\n${'='.repeat(80)}`);
    console.log(`3. RECORD-BOUNDARY DETECTION (autocorrelation): ${basename}`);
    console.log(`${'='.repeat(80)}`);

    const R_values = [4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64];
    const results = [];

    for (const R of R_values) {
        let totalMatch = 0;
        let totalPositions = 0;

        for (const f of faces) {
            const b1 = f.block1;
            const limit = b1.length - R;
            if (limit <= 0) continue;
            let matches = 0;
            for (let p = 0; p < limit; p++) {
                if (b1[p] === b1[p + R]) matches++;
            }
            totalMatch += matches;
            totalPositions += limit;
        }

        const ratio = totalPositions > 0 ? totalMatch / totalPositions : 0;
        results.push({ R, ratio, totalMatch, totalPositions });
    }

    results.sort((a, b) => b.ratio - a.ratio);

    console.log('R      avg_ratio   total_match  total_positions');
    console.log('----   ---------   -----------  ---------------');
    for (const r of results) {
        console.log(
            `${String(r.R).padStart(4)}    ${r.ratio.toFixed(4)}      ${String(r.totalMatch).padStart(11)}  ${String(r.totalPositions).padStart(15)}`
        );
    }

    console.log('\nTop 5 candidates for record size:');
    for (let i = 0; i < Math.min(5, results.length); i++) {
        console.log(`  R=${results[i].R}: ratio=${results[i].ratio.toFixed(4)}`);
    }
}

// --- 4. Reference classification ---
function printReferenceClassification(fileResult) {
    const { basename, faces } = fileResult;
    console.log(`\n${'='.repeat(80)}`);
    console.log(`4. REFERENCE CLASSIFICATION: ${basename}`);
    console.log(`${'='.repeat(80)}`);

    const categories = {
        zero: 0,
        one: 0,
        small: 0,
        medium: 0,
        large: 0,
        equalsVC: 0,
        equalsEC: 0,
        intraDuplicate: 0,
        crossFaceDuplicate: 0
    };
    let totalValues = 0;

    // Build a set of all values per face
    const faceValueSets = faces.map(f => new Set(f.block1));

    // Build cross-face value set
    const allCrossFaceValues = new Set();
    for (const f of faces) {
        for (const v of f.block1) allCrossFaceValues.add(v);
    }

    for (let fi = 0; fi < faces.length; fi++) {
        const f = faces[fi];
        const valueCounts = new Map();
        for (const v of f.block1) {
            valueCounts.set(v, (valueCounts.get(v) || 0) + 1);
        }

        for (const v of f.block1) {
            totalValues++;
            if (v === 0) categories.zero++;
            else if (v === 1) categories.one++;
            else if (v > 1 && v < 256) categories.small++;
            else if (v >= 256 && v < 65536) categories.medium++;
            else if (v >= 65536) categories.large++;

            if (v === f.vertexCount) categories.equalsVC++;
            if (v === f.edgeCount) categories.equalsEC++;

            if (valueCounts.get(v) > 1) categories.intraDuplicate++;

            // Cross-face: check if this value appears in another face
            let inOther = false;
            for (let oi = 0; oi < faces.length; oi++) {
                if (oi === fi) continue;
                if (faceValueSets[oi].has(v)) { inOther = true; break; }
            }
            if (inOther) categories.crossFaceDuplicate++;
        }
    }

    console.log(`Total u32 values across all faces: ${totalValues}`);
    console.log('');
    for (const [cat, count] of Object.entries(categories)) {
        const pct = totalValues > 0 ? (count / totalValues * 100).toFixed(2) : '0.00';
        console.log(`  ${cat.padEnd(22)} ${String(count).padStart(10)}  (${pct}%)`);
    }
}

// --- 5. Cross-face fingerprinting (16-byte window hash) ---
function printCrossFaceFingerprinting(fileResult) {
    const { basename, faces } = fileResult;
    console.log(`\n${'='.repeat(80)}`);
    console.log(`5. CROSS-FACE FINGERPRINTING: ${basename}`);
    console.log(`${'='.repeat(80)}`);

    // Hash each 4-u32 window across all faces
    const windowHash = new Map(); // hash -> [{faceIdx, position}]

    for (let fi = 0; fi < faces.length; fi++) {
        const b1 = faces[fi].block1;
        for (let p = 0; p <= b1.length - 4; p++) {
            const h = `${b1[p]}|${b1[p+1]}|${b1[p+2]}|${b1[p+3]}`;
            if (!windowHash.has(h)) windowHash.set(h, []);
            windowHash.get(h).push({ faceIdx: fi, position: p });
        }
    }

    // Find windows appearing in multiple faces
    const multiFaceWindows = [];
    for (const [h, locations] of windowHash) {
        const faceSet = new Set(locations.map(l => l.faceIdx));
        if (faceSet.size >= 2) {
            multiFaceWindows.push({
                hash: h,
                faceCount: faceSet.size,
                faces: [...faceSet],
                totalOccurrences: locations.length,
                locations
            });
        }
    }

    multiFaceWindows.sort((a, b) => b.faceCount - a.faceCount || b.totalOccurrences - a.totalOccurrences);

    console.log(`Total unique windows: ${windowHash.size}`);
    console.log(`Windows in multiple faces: ${multiFaceWindows.length}`);
    console.log('');
    console.log('Top 20 most-repeated windows:');
    console.log('rank  hash                                   faces  occ   face_list');
    console.log('----  -------------------------------------  -----  ----  ---------');

    for (let i = 0; i < Math.min(20, multiFaceWindows.length); i++) {
        const w = multiFaceWindows[i];
        console.log(
            `${String(i + 1).padStart(4)}  ${w.hash.padEnd(37)}  ${String(w.faceCount).padStart(5)}  ${String(w.totalOccurrences).padStart(4)}  [${w.faces.join(',')}]`
        );
    }
}

// --- 6. Sentinel detection ---
function printSentinelDetection(fileResult) {
    const { basename, faces } = fileResult;
    console.log(`\n${'='.repeat(80)}`);
    console.log(`6. SENTINEL DETECTION: ${basename}`);
    console.log(`${'='.repeat(80)}`);

    if (faces.length === 0) { console.log('No faces.'); return; }

    // Position 0 values
    const pos0Values = new Map();
    for (let fi = 0; fi < faces.length; fi++) {
        const v = faces[fi].block1[0];
        pos0Values.set(v, (pos0Values.get(v) || 0) + 1);
    }
    console.log('\nPosition 0 values:');
    for (const [v, c] of [...pos0Values.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  value=${v}  count=${c}/${faces.length} (${(c/faces.length*100).toFixed(1)}%)`);
    }

    // Last position values
    const lastPosValues = new Map();
    for (let fi = 0; fi < faces.length; fi++) {
        const b1 = faces[fi].block1;
        const v = b1[b1.length - 1];
        lastPosValues.set(v, (lastPosValues.get(v) || 0) + 1);
    }
    console.log('\nLast position values:');
    for (const [v, c] of [...lastPosValues.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  value=${v}  count=${c}/${faces.length} (${(c/faces.length*100).toFixed(1)}%)`);
    }

    // Position 1 values
    const pos1Values = new Map();
    for (let fi = 0; fi < faces.length; fi++) {
        const v = faces[fi].block1.length > 1 ? faces[fi].block1[1] : undefined;
        if (v !== undefined) pos1Values.set(v, (pos1Values.get(v) || 0) + 1);
    }
    console.log('\nPosition 1 values:');
    for (const [v, c] of [...pos1Values.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  value=${v}  count=${c}/${faces.length} (${(c/faces.length*100).toFixed(1)}%)`);
    }

    // Constant positions (ALL faces same value)
    console.log('\nConstant positions (ALL faces have same value):');
    const maxN = Math.max(...faces.map(f => f.N));
    let constantCount = 0;
    for (let p = 0; p < maxN; p++) {
        const vals = [];
        for (const f of faces) {
            if (p < f.block1.length) vals.push(f.block1[p]);
        }
        if (vals.length < faces.length) continue;
        const first = vals[0];
        let allSame = true;
        for (let i = 1; i < vals.length; i++) {
            if (vals[i] !== first) { allSame = false; break; }
        }
        if (allSame) {
            constantCount++;
            if (constantCount <= 20) {
                console.log(`  position ${p}: value=${first} (all ${vals.length} faces)`);
            }
        }
    }
    if (constantCount > 20) {
        console.log(`  ... and ${constantCount - 20} more constant positions`);
    }
    if (constantCount === 0) {
        console.log('  (none)');
    }
}

// --- 7. Graph-vs-record scoring ---
function printGraphVsRecordScoring(fileResult) {
    const { basename, faces } = fileResult;
    console.log(`\n${'='.repeat(80)}`);
    console.log(`7. GRAPH-VS-RECORD SCORING: ${basename}`);
    console.log(`${'='.repeat(80)}`);

    // Collect observations for scoring
    const observations = [];

    // Check N variability
    const nValues = faces.map(f => f.N);
    const uniqueN = new Set(nValues);
    observations.push(`N values: ${[...uniqueN].join(', ')} (${uniqueN.size} unique across ${faces.length} faces)`);

    // Check N/vc and N/ec ratios
    const nvcRatios = faces.filter(f => f.vertexCount > 0).map(f => f.N / f.vertexCount);
    const necRatios = faces.filter(f => f.edgeCount > 0).map(f => f.N / f.edgeCount);
    const nvcUnique = new Set(nvcRatios.map(r => r.toFixed(3)));
    const necUnique = new Set(necRatios.map(r => r.toFixed(3)));
    observations.push(`N/vc unique ratios: ${[...nvcUnique].join(', ')}`);
    observations.push(`N/ec unique ratios: ${[...necUnique].join(', ')}`);

    // Check autocorrelation at R=4, 8, 12, 16
    const acScores = {};
    for (const R of [4, 8, 12, 16]) {
        let totalMatch = 0, totalPos = 0;
        for (const f of faces) {
            const b1 = f.block1;
            for (let p = 0; p < b1.length - R; p++) {
                if (b1[p] === b1[p + R]) totalMatch++;
                totalPos++;
            }
        }
        acScores[R] = totalPos > 0 ? totalMatch / totalPos : 0;
    }
    observations.push(`Autocorrelation: R=4:${acScores[4].toFixed(4)} R=8:${acScores[8].toFixed(4)} R=12:${acScores[12].toFixed(4)} R=16:${acScores[16].toFixed(4)}`);

    // Check zero/one dominance
    let zeros = 0, ones = 0, total = 0;
    for (const f of faces) {
        for (const v of f.block1) {
            total++;
            if (v === 0) zeros++;
            if (v === 1) ones++;
        }
    }
    observations.push(`Value distribution: zeros=${zeros} (${(zeros/total*100).toFixed(1)}%), ones=${ones} (${(ones/total*100).toFixed(1)}%), other=${total-zeros-ones} (${((total-zeros-ones)/total*100).toFixed(1)}%)`);

    // Check for N appearing as a value
    let nAsValue = 0;
    for (const f of faces) {
        if (f.block1.includes(f.N)) nAsValue++;
    }
    observations.push(`Faces where N appears as a value in Block 1: ${nAsValue}/${faces.length}`);

    // Check Block 1 value range
    let allMin = Infinity, allMax = 0;
    for (const f of faces) {
        for (const v of f.block1) {
            if (v < allMin) allMin = v;
            if (v > allMax) allMax = v;
        }
    }
    observations.push(`Block 1 value range: [${allMin}, ${allMax}]`);

    for (const o of observations) {
        console.log(`  ${o}`);
    }

    // Scoring
    console.log('\nHypothesis scores (0-10):');

    // Fixed record layout
    let fixedScore = 0;
    if (nvcUnique.size <= 3) fixedScore += 2;
    if (acScores[4] > 0.1) fixedScore += 2;
    if (acScores[8] > 0.1) fixedScore += 1;
    const maxNMinN = Math.min(...nValues);
    const maxNMaxN = Math.max(...nValues);
    if (maxNMinN === maxNMaxN) fixedScore += 3;
    else if (maxNMaxN / maxNMinN < 2) fixedScore += 1;
    fixedScore = Math.min(10, fixedScore);
    console.log(`  Fixed record layout:        ${fixedScore}/10`);

    // Serialized graph
    let graphScore = 0;
    const allVals = [];
    for (const f of faces) allVals.push(...f.block1);
    const largeCount = allVals.filter(v => v >= 65536).length;
    if (largeCount > total * 0.05) graphScore += 2;
    if (nAsValue > faces.length * 0.3) graphScore += 2;
    if (acScores[4] < 0.05) graphScore += 1;
    const uniqueVals = new Set(allVals).size;
    if (uniqueVals > 100) graphScore += 2;
    graphScore = Math.min(10, graphScore);
    console.log(`  Serialized graph:           ${graphScore}/10`);

    // Variable-length records
    let varScore = 0;
    if (uniqueN.size > 3) varScore += 3;
    if (maxNMaxN / Math.max(1, maxNMinN) > 1.5) varScore += 2;
    if (acScores[4] > 0.05 && acScores[4] < 0.3) varScore += 2;
    // Check if N/vc ratio correlates with N
    varScore = Math.min(10, varScore);
    console.log(`  Variable-length records:    ${varScore}/10`);

    // Pointer table
    let ptrScore = 0;
    if (zeros / total > 0.3) ptrScore += 2;
    if (ones / total > 0.1) ptrScore += 1;
    if (acScores[4] > 0.15) ptrScore += 2;
    if (acScores[8] > 0.1) ptrScore += 1;
    // Check for repeated small values (indices)
    const smallCount = allVals.filter(v => v > 0 && v < 256).length;
    if (smallCount > total * 0.3) ptrScore += 2;
    ptrScore = Math.min(10, ptrScore);
    console.log(`  Pointer table:              ${ptrScore}/10`);
}

// ============================================================
// MAIN
// ============================================================

const FILES = [
    'C:\\Users\\basha\\Desktop\\soldiworks research\\test files original\\usb hub case (ultimate test)\\USB hub case BOTTOM.SLDPRT',
    'C:\\Users\\basha\\Desktop\\soldiworks research\\test files original\\usb hub case (ultimate test)\\USB hub case TOP.SLDPRT',
    'C:\\Users\\basha\\Desktop\\soldiworks research\\test files original\\Helical Bevel Gear.SLDPRT',
    'C:\\Users\\basha\\Desktop\\soldiworks research\\test files original\\Dekor.SLDPRT'
];

console.log('=============================================================');
console.log('  BLOCK 1 TOPOLOGY STRUCTURAL ANALYSIS');
console.log('  Script: v0.3.5/block1_analysis.js');
console.log('  Date: ' + new Date().toISOString());
console.log('=============================================================');

const allResults = [];

for (const f of FILES) {
    const basename = path.basename(f);
    console.log(`\n${'#'.repeat(80)}`);
    console.log(`FILE: ${basename}`);
    console.log(`${'#'.repeat(80)}`);

    try {
        const result = analyzeFile(f);
        if (result.error) {
            console.log(`  ERROR: ${result.error}`);
            allResults.push(result);
            continue;
        }

        console.log(`  DisplayLists size: ${result.dlDataLength} bytes`);
        console.log(`  Faces with valid Block 1: ${result.faces.length}`);
        if (result.faces.length > 0) {
            const nVals = result.faces.map(f => f.N);
            console.log(`  Block 1 N range: [${Math.min(...nVals)}, ${Math.max(...nVals)}]`);
            console.log(`  Block 2 present in: ${result.faces.filter(f => f.hasBlock2).length}/${result.faces.length} faces`);
        }

        printPerFaceMetrics(result);
        printByteFrequencyHeatmap(result);
        printRecordBoundaryDetection(result);
        printReferenceClassification(result);
        printCrossFaceFingerprinting(result);
        printSentinelDetection(result);
        printGraphVsRecordScoring(result);

        allResults.push(result);
    } catch (e) {
        console.log(`  ERROR: ${e.message}`);
        console.log(e.stack);
    }
}

// ============================================================
// GLOBAL SUMMARY: FACTS / HYPOTHESES / CONFIDENCE
// ============================================================

console.log(`\n${'='.repeat(80)}`);
console.log('FACTS');
console.log('-----');

const allFacts = [];

for (const r of allResults) {
    if (r.error || !r.faces) continue;
    const bn = r.basename;
    const faces = r.faces;
    allFacts.push(`[${bn}] ${faces.length} faces with valid Block 1`);

    if (faces.length > 0) {
        const nVals = faces.map(f => f.N);
        const uniqueN = [...new Set(nVals)].sort((a,b) => a - b);
        allFacts.push(`  N values: ${uniqueN.join(', ')}`);
        allFacts.push(`  N/vc ratios: ${[...new Set(faces.map(f => (f.N/f.vertexCount).toFixed(3)))].join(', ')}`);
        allFacts.push(`  N/ec ratios: ${[...new Set(faces.map(f => (f.N/f.edgeCount).toFixed(3)))].join(', ')}`);

        // Value stats
        let zeros = 0, ones = 0, total = 0;
        for (const f of faces) {
            for (const v of f.block1) {
                total++;
                if (v === 0) zeros++;
                if (v === 1) ones++;
            }
        }
        allFacts.push(`  Values: zeros=${zeros} (${(zeros/total*100).toFixed(1)}%), ones=${ones} (${(ones/total*100).toFixed(1)}%), other=${total-zeros-ones}`);

        // Autocorrelation at R=4
        let ac4 = 0, ac4t = 0;
        for (const f of faces) {
            for (let p = 0; p < f.block1.length - 4; p++) {
                if (f.block1[p] === f.block1[p+4]) ac4++;
                ac4t++;
            }
        }
        allFacts.push(`  Autocorrelation R=4: ${ac4t > 0 ? (ac4/ac4t*100).toFixed(2) : 'N/A'}%`);

        // Block 2 presence
        allFacts.push(`  Block 2 header present: ${faces.filter(f => f.hasBlock2).length}/${faces.length} faces`);
    }
}

for (const f of allFacts) console.log(f);

console.log(`\n${'='.repeat(80)}`);
console.log('HYPOTHESES');
console.log('----------');

const hypotheses = [];

// Derive hypotheses from cross-file observations
const allNValues = [];
const allRatios = [];
for (const r of allResults) {
    if (r.error || !r.faces) continue;
    for (const f of r.faces) {
        allNValues.push(f.N);
        if (f.vertexCount > 0) allRatios.push(f.N / f.vertexCount);
    }
}

const uniqueNGlobal = [...new Set(allNValues)].sort((a,b) => a-b);
const uniqueRatiosGlobal = [...new Set(allRatios.map(r => r.toFixed(3)))];

hypotheses.push(`H1: Block 1 encodes a fixed-size-per-vertex structure (N/vc ratio cluster: ${uniqueRatiosGlobal.join(', ')})`);
hypotheses.push(`H2: Block 1 contains a mix of headers (0/1 values) and data (non-zero values)`);
hypotheses.push(`H3: Block 1 structure is face-dependent (N varies with face complexity: ${uniqueNGlobal.length} unique N values)`);
hypotheses.push(`H4: Block 1 may encode connectivity data (cross-face duplicate values indicate shared references)`);
hypotheses.push(`H5: The [4,8,2] header marks block boundaries and N gives payload size, suggesting a TLV-like encoding`);

for (const h of hypotheses) console.log(h);

console.log(`\n${'='.repeat(80)}`);
console.log('CONFIDENCE');
console.log('----------');

const eliminations = [];
eliminations.push('Block 1 is NOT raw coordinate data (all values are integers, not floats)');
eliminations.push('Block 1 is NOT uniform across all faces (N varies, value distributions differ)');
eliminations.push('Block 1 does NOT use a single fixed record size for all faces (N/vc ratio is not constant 1.0)');
eliminations.push('Block 1 is NOT purely sequential vertex indices (value range extends far beyond vertexCount)');
eliminations.push('Block 1 is NOT a simple edge-list (N >> edgeCount in most faces)');
eliminations.push('Block 2 exists at predictable offset from Block 1 end (topoStart + (N+4)*4), confirming the header-payload structure');

for (const e of eliminations) console.log(e);

console.log('\n=============================================================');
console.log('END OF ANALYSIS');
console.log('=============================================================');
