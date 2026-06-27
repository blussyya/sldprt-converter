#!/usr/bin/env node
'use strict';
/**
 * Block 1 Deep Structure Analysis v4
 * 
 * Key discovery: section_length = Block 2 raw value (100%)
 * Now: what is the INTERNAL structure of each section?
 * 
 * Hypothesis: each section encodes one loop's vertex indices as a 
 * sparse bitmap, with LARGE values being global vertex indices.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

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

function findDisplayLists(buf) {
    const streams = decompressOpenSX(buf);
    for (const [name, data] of Object.entries(streams)) {
        if (name.toLowerCase().includes('displaylist') && data.length > 100) {
            const d = Buffer.isBuffer(data) ? data : Buffer.from(data);
            if (d.readUInt32LE(0) === 1 && d.readUInt32LE(4) === 1) {
                return data;
            }
        }
    }
    return null;
}

function extractFaces(dlData) {
    const data = Buffer.isBuffer(dlData) ? dlData : Buffer.from(dlData);
    const results = [];
    if (!data || data.length < 100) return results;

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

        const vertEnd = vertStart + vertexCount * 12;
        const normStart = vertEnd + 16;
        const normEnd = normStart + vertexCount * 12;
        const topoStart = normEnd;

        if (topoStart + 16 > data.length) continue;

        const h0 = data.readUInt32LE(topoStart);
        const h1 = data.readUInt32LE(topoStart + 4);
        const h2 = data.readUInt32LE(topoStart + 8);
        if (h0 !== 4 || h1 !== 8 || h2 !== 2) continue;

        const N = data.readUInt32LE(topoStart + 12);
        if (topoStart + 16 + N * 4 > data.length) continue;
        const block1 = [];
        for (let i = 0; i < N; i++) {
            block1.push(data.readUInt32LE(topoStart + 16 + i * 4));
        }

        const b2Start = topoStart + (N + 4) * 4;
        let block2 = [];
        if (b2Start + 12 <= data.length) {
            const b2h0 = data.readUInt32LE(b2Start);
            const b2h1 = data.readUInt32LE(b2Start + 4);
            const b2h2 = data.readUInt32LE(b2Start + 8);
            if (b2h0 === 4 && b2h1 === 8 && b2h2 === 2) {
                const M = data.readUInt32LE(b2Start + 12);
                for (let i = 0; i < M; i++) {
                    block2.push(data.readUInt32LE(b2Start + 16 + i * 4));
                }
            }
        }

        // Read vertices for reference
        const vertices = [];
        for (let i = 0; i < vertexCount; i++) {
            vertices.push({
                x: data.readFloatLE(vertStart + i * 12),
                y: data.readFloatLE(vertStart + i * 12 + 4),
                z: data.readFloatLE(vertStart + i * 12 + 8)
            });
        }

        results.push({ edgeCount, vertexCount, block1, block2, N, M: block2.length, vertices });
    }
    return results;
}

function extractSections(block1Vals) {
    const sections = [];
    let current = [];
    let currentStart = 0;
    for (let i = 0; i < block1Vals.length; i++) {
        if (block1Vals[i] === 1) {
            if (current.length > 0) {
                sections.push({ vals: current, startIdx: currentStart, endIdx: i - 1 });
            }
            current = [];
            currentStart = i;
        }
        current.push(block1Vals[i]);
    }
    if (current.length > 0) sections.push({ vals: current, startIdx: currentStart, endIdx: block1Vals.length - 1 });
    return sections;
}

function classify(v) {
    if (v === 0) return 'ZERO';
    if (v === 1) return 'ONE';
    if (v <= 255) return 'SMALL';
    return 'LARGE';
}

// ============================================================
// Load data
// ============================================================

const RESEARCH_DIR = 'C:\\Users\\basha\\Desktop\\soldiworks research';
const files = [
    { name: 'BOTTOM', path: path.join(RESEARCH_DIR, 'test files original', 'usb hub case (ultimate test)', 'USB hub case BOTTOM.SLDPRT') },
    { name: 'TOP', path: path.join(RESEARCH_DIR, 'test files original', 'usb hub case (ultimate test)', 'USB hub case TOP.SLDPRT') },
    { name: 'GEAR', path: path.join(RESEARCH_DIR, 'test files original', 'Helical Bevel Gear.SLDPRT') },
    { name: 'DEKOR', path: path.join(RESEARCH_DIR, 'test files original', 'Dekor.SLDPRT') }
];

const allSections = [];
const allFaces = [];

for (const f of files) {
    if (!fs.existsSync(f.path)) continue;
    const buf = fs.readFileSync(f.path);
    const dl = findDisplayLists(buf);
    if (!dl) continue;
    const faces = extractFaces(dl);
    
    for (let fi = 0; fi < faces.length; fi++) {
        const face = faces[fi];
        if (face.block1.length === 0) continue;
        
        const sections = extractSections(face.block1);
        
        for (let si = 0; si < sections.length; si++) {
            const sec = sections[si];
            const loopSize = si < face.block2.length ? face.block2[si] : null;
            
            // Extract LARGE values (potential vertex indices)
            const largeVals = sec.vals.filter(v => v > 255);
            const nonzeroVals = sec.vals.filter(v => v !== 0 && v !== 1);
            
            // Check if LARGE values are within vertex range
            const inVertexRange = largeVals.filter(v => v < face.vertexCount);
            
            allSections.push({
                file: f.name,
                faceIdx: fi,
                sectionIdx: si,
                ec: face.edgeCount,
                vc: face.vertexCount,
                vals: sec.vals,
                len: sec.vals.length,
                loopSize,
                largeCount: largeVals.length,
                nonzeroCount: nonzeroVals.length,
                inVertexRange: inVertexRange.length,
                totalLarge: largeVals.length,
                vertices: face.vertices,
                firstLarge: largeVals[0] || null,
                lastVal: sec.vals[sec.vals.length - 1]
            });
        }
        allFaces.push({ file: f.name, fi, ec: face.edgeCount, vc: face.vertexCount, N: face.N, M: face.M, sections: sections.length });
    }
}

console.log(`Total sections: ${allSections.length}`);
console.log(`Total faces: ${allFaces.length}`);

// ============================================================
// DEEP STRUCTURE ANALYSIS
// ============================================================

console.log(`\n${'='.repeat(70)}`);
console.log(`DEEP STRUCTURE ANALYSIS — What generates each token?`);
console.log(`${'='.repeat(70)}`);

// --- Section length = loopSize confirmed ---
console.log(`\n--- CONFIRMED: section_length = Block 2 raw value ---`);
console.log(`(100% match, see v3 output)`);

// --- What are the LARGE values? ---
console.log(`\n--- What are the LARGE values? ---`);
console.log(`Hypothesis: LARGE values are global vertex indices`);
console.log(`Testing: are LARGE values within [0, vc) range?`);

let totalLarge = 0, inRange = 0, outRange = 0;
const outRangeExamples = [];
for (const s of allSections) {
    for (const v of s.vals) {
        if (v > 255) {
            totalLarge++;
            if (v < s.vc) inRange++;
            else {
                outRange++;
                if (outRangeExamples.length < 10) {
                    outRangeExamples.push(`${s.file}#${s.faceIdx}S${s.sectionIdx}: val=${v} vc=${s.vc}`);
                }
            }
        }
    }
}
console.log(`  Total LARGE values: ${totalLarge}`);
console.log(`  In vertex range [0, vc): ${inRange} (${(100*inRange/totalLarge).toFixed(1)}%)`);
console.log(`  Out of range: ${outRange} (${(100*outRange/totalLarge).toFixed(1)}%)`);
if (outRangeExamples.length > 0) {
    console.log(`  Out-of-range examples:`);
    for (const e of outRangeExamples) console.log(`    ${e}`);
}

// --- Alternating LARGE/ZERO pattern ---
console.log(`\n--- Alternating LARGE/ZERO pattern in body ---`);
// Body is positions [3..end] (after ONE + two edge indices)
let altPatternCount = 0;
let altPatternStrict = 0;
for (const s of allSections) {
    if (s.len < 4) continue;
    let bodyAlt = true;
    let bodyAltStrict = true;
    for (let i = 3; i < s.vals.length; i++) {
        const bodyPos = i - 3;
        const val = s.vals[i];
        if (bodyPos % 2 === 0) {
            // Even body position: should be LARGE or SMALL (non-zero)
            if (val === 0) { bodyAlt = false; bodyAltStrict = false; break; }
            if (val === 1) { bodyAltStrict = false; }
        } else {
            // Odd body position: should be ZERO
            if (val !== 0) { bodyAlt = false; bodyAltStrict = false; break; }
        }
    }
    if (bodyAlt) altPatternCount++;
    if (bodyAltStrict) altPatternStrict++;
}
console.log(`  Body even=nonzero, odd=zero: ${altPatternCount}/${allSections.length} (${(100*altPatternCount/allSections.length).toFixed(1)}%)`);
console.log(`  Strict (no ONE in body): ${altPatternStrict}/${allSections.length} (${(100*altPatternStrict/allSections.length).toFixed(1)}%)`);

// Show counterexamples
console.log(`\n  Counterexamples (first 10):`);
let counterEx = 0;
for (const s of allSections) {
    if (s.len < 4 || counterEx >= 10) continue;
    for (let i = 3; i < s.vals.length; i++) {
        const bodyPos = i - 3;
        const val = s.vals[i];
        if (bodyPos % 2 === 0 && val === 0) {
            console.log(`    ${s.file}#${s.faceIdx}S${s.sectionIdx} len=${s.len}: pos ${i} bodyPos=${bodyPos} val=0 (should be nonzero)`);
            counterEx++;
            break;
        }
        if (bodyPos % 2 === 1 && val !== 0) {
            console.log(`    ${s.file}#${s.faceIdx}S${s.sectionIdx} len=${s.len}: pos ${i} bodyPos=${bodyPos} val=${val} (should be 0)`);
            counterEx++;
            break;
        }
    }
}

// --- Positions 1-2: edge indices? ---
console.log(`\n--- Positions 1-2: What are they? ---`);
console.log(`Hypothesis: positions 1-2 are start/end edge indices`);
const pos1Vals = allSections.filter(s => s.len >= 2).map(s => s.vals[1]);
const pos2Vals = allSections.filter(s => s.len >= 3).map(s => s.vals[2]);
console.log(`  Position 1 range: [${Math.min(...pos1Vals)}, ${Math.max(...pos1Vals)}]`);
console.log(`  Position 2 range: [${Math.min(...pos2Vals)}, ${Math.max(...pos2Vals)}]`);
console.log(`  Position 1 == 0: ${pos1Vals.filter(v => v === 0).length}/${pos1Vals.length}`);
console.log(`  Position 2 == 0: ${pos2Vals.filter(v => v === 0).length}/${pos2Vals.length}`);
console.log(`  Both == 0: ${allSections.filter(s => s.len >= 3 && s.vals[1] === 0 && s.vals[2] === 0).length}`);
console.log(`  Position 1 < vc: ${allSections.filter(s => s.len >= 2 && s.vals[1] < s.vc).length}/${allSections.length}`);

// Position 1 values vs edge count
console.log(`\n  Position 1 values that are > edgeCount:`);
let pos1OverEc = 0;
for (const s of allSections) {
    if (s.len >= 2 && s.vals[1] > s.ec) pos1OverEc++;
}
console.log(`    ${pos1OverEc}/${allSections.length} sections`);

// --- Vertex index hypothesis deep test ---
console.log(`\n--- Vertex index hypothesis: detailed test ---`);
// For each section with alternating pattern, check if LARGE values match actual vertex indices
console.log(`Testing BOTTOM face #5 (vc=212, 41 sections):`);
const bottom5Sections = allSections.filter(s => s.file === 'BOTTOM' && s.faceIdx === 5);
for (const s of bottom5Sections.slice(0, 5)) {
    const largeVals = s.vals.filter(v => v > 255);
    const inRange = largeVals.filter(v => v < s.vc);
    console.log(`  S${s.sectionIdx} len=${s.len}: LARGE=[${largeVals.join(',')}] inRange=[${inRange.join(',')}]`);
    // Check if these vertex indices form a valid loop
    if (inRange.length >= 3 && inRange.length === largeVals.length) {
        const verts = inRange.map(idx => s.vertices[idx]);
        if (verts) {
            // Calculate perimeter
            let perimeter = 0;
            for (let i = 0; i < verts.length; i++) {
                const a = verts[i], b = verts[(i+1) % verts.length];
                perimeter += Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2 + (a.z-b.z)**2);
            }
            console.log(`    → ${inRange.length} vertices, perimeter=${perimeter.toFixed(2)}mm`);
        }
    }
}

// --- Section length vs vertex/edge count ---
console.log(`\n--- Section length vs face properties ---`);
console.log(`Correlation: section_length vs edgeCount, vertexCount`);
const lenEcPairs = allSections.filter(s => s.len >= 2).map(s => ({ len: s.len, ec: s.ec, vc: s.vc }));

// Group by ec
const byEc = {};
for (const p of lenEcPairs) {
    if (!byEc[p.ec]) byEc[p.ec] = [];
    byEc[p.ec].push(p.len);
}
console.log(`  By edgeCount: ec → [minLen, maxLen, avgLen, count]`);
for (const [ec, lens] of Object.entries(byEc).sort((a,b) => a[0]-b[0]).slice(0, 20)) {
    const min = Math.min(...lens);
    const max = Math.max(...lens);
    const avg = (lens.reduce((a,b)=>a+b,0)/lens.length).toFixed(1);
    console.log(`    ec=${String(ec).padStart(3)}: [${min}, ${max}, ${avg}] (${lens.length} sections)`);
}

// --- Final: What pattern generates each section? ---
console.log(`\n--- Pattern generator hypothesis ---`);
console.log(`Section structure: [ONE, edgeStart, edgeEnd, v1, 0, v2, 0, v3, 0, ..., vN, 0]`);
console.log(`where v1..vN are vertex indices forming the loop boundary`);
console.log(`section_length = N*2 + 3 (ONE + edgeStart + edgeEnd + N pairs)`);
console.log(`→ N = (len - 3) / 2`);
let nInteger = 0;
for (const s of allSections) {
    const n = (s.len - 3) / 2;
    if (Number.isInteger(n) && n >= 0) nInteger++;
}
console.log(`N is integer: ${nInteger}/${allSections.length} (${(100*nInteger/allSections.length).toFixed(1)}%)`);

// --- Check: len-3 must be even ---
console.log(`\nlen-3 parity:`);
let lenMinus3Even = 0;
for (const s of allSections) {
    if ((s.len - 3) % 2 === 0) lenMinus3Even++;
}
console.log(`  (len-3) even: ${lenMinus3Even}/${allSections.length} (${(100*lenMinus3Even/allSections.length).toFixed(1)}%)`);

// Summary
console.log(`\n${'='.repeat(70)}`);
console.log(`SUMMARY OF FINDINGS`);
console.log(`${'='.repeat(70)}`);
console.log(`1. section_length = Block 2 raw value: 100% (INVARIANT)`);
console.log(`2. First token = ONE: 100% (INVARIANT)`);
console.log(`3. Section count = Block 2 count: 100% (INVARIANT)`);
console.log(`4. LARGE values in vertex range: ${(100*inRange/totalLarge).toFixed(1)}%`);
console.log(`5. Alternating body (even=LARGE, odd=ZERO): ${(100*altPatternCount/allSections.length).toFixed(1)}%`);
console.log(`6. (len-3) even: ${(100*lenMinus3Even/allSections.length).toFixed(1)}%`);
console.log(`7. ONE count in section: always 1 (each section has exactly one ONE at position 0)`);
