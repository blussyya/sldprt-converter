#!/usr/bin/env node
'use strict';
/**
 * DISCRIMINATING EXPERIMENT: Are Block 1 values global vertex indices?
 *
 * Protocol:
 * 1. For every face where geometry is available, build the mesh edge set
 *    from the existing triangulation (strip or earcut). Do not invent connectivity.
 * 2. For each Block 1 section, interpret VALUE tokens as candidate vertex IDs.
 * 3. Test every consecutive VALUE pair (including wrap-around).
 * 4. Measure: total candidate edges, edges found in mesh, %, false pos/neg.
 * 5. Produce counterexamples if hypothesis fails.
 *
 * Do NOT modify the parser. Read-only observation.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ============================================================
// SLDPRT decompression (copy from working script)
// ============================================================

function rolByte(b, shift) {
    shift &= 7; if (shift === 0) return b;
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
        for (let i = 0; i < nsz; i++) name += String.fromCharCode(rolByte(rawName[i], key));
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
            if (decompressed && decompressed.length > 0 && !streams[name]) streams[name] = decompressed;
        }
    }
    return streams;
}

function findDisplayLists(buf) {
    const streams = decompressOpenSX(buf);
    for (const [name, data] of Object.entries(streams)) {
        if (name.toLowerCase().includes('displaylist') && data.length > 100) {
            const d = Buffer.isBuffer(data) ? data : Buffer.from(data);
            if (d.readUInt32LE(0) === 1 && d.readUInt32LE(4) === 1) return data;
        }
    }
    return null;
}

// ============================================================
// Face extraction (read-only, no parser modification)
// ============================================================

function extractFaces(dlData) {
    const data = dlData;
    const results = [];
    const MARKER = Buffer.from([0x0c, 0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00]);
    for (const mp of findAll(data, MARKER)) {
        if (mp < 4) continue;
        const edgeCount = data.readUInt32LE(mp - 4);
        if (edgeCount < 1 || edgeCount > 500) continue;
        if (data.readUInt32LE(mp + 8) !== 2) continue;
        const vertexCount = data.readUInt32LE(mp + 12);
        if (vertexCount < 3 || vertexCount > 5000) continue;
        const vertStart = mp + 16;
        if (vertStart + vertexCount * 12 > data.length) continue;
        let valid = true;
        const verts = [];
        for (let i = 0; i < vertexCount; i++) {
            const x = data.readFloatLE(vertStart + i * 12);
            const y = data.readFloatLE(vertStart + i * 12 + 4);
            const z = data.readFloatLE(vertStart + i * 12 + 8);
            if (!isFinite(x) || !isFinite(y) || !isFinite(z)) { valid = false; break; }
            if (Math.abs(x) > 100000 || Math.abs(y) > 100000 || Math.abs(z) > 100000) { valid = false; break; }
            verts.push([x, y, z]);
        }
        if (!valid) continue;
        const vertEnd = vertStart + vertexCount * 12;
        const normStart = vertEnd + 16;
        const normEnd = normStart + vertexCount * 12;
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
        results.push({ edgeCount, vertexCount, verts, block1, block2, N, M: block2.length });
    }
    return results;
}

// ============================================================
// Build global vertex table (all face vertices concatenated)
// ============================================================

function buildGlobalVertexTable(faces) {
    const globalVerts = [];
    const faceVertOffsets = [];
    for (const f of faces) {
        faceVertOffsets.push(globalVerts.length);
        for (const v of f.verts) globalVerts.push(v);
    }
    return { globalVerts, faceVertOffsets };
}

// ============================================================
// Build mesh edge set from triangulation (existing parser logic)
// ============================================================

function buildMeshEdges(faces, globalVerts, faceVertOffsets) {
    const edgeSet = new Set();
    let totalTris = 0;

    for (let fi = 0; fi < faces.length; fi++) {
        const face = faces[fi];
        const baseIdx = faceVertOffsets[fi];
        const n = face.vertexCount;

        // Build face vertex indices (local to global)
        const faceIndices = [];
        for (let i = 0; i < n; i++) faceIndices.push(baseIdx + i);

        // Replicate the strip triangulation from _processStripFace
        // This is the EXISTING parser logic, not invented
        for (let i = 0; i < n - 2; i++) {
            const i0 = faceIndices[i], i1 = faceIndices[i + 1], i2 = faceIndices[i + 2];
            if (i0 === i1 || i1 === i2 || i0 === i2) continue;
            const v0 = globalVerts[i0], v1 = globalVerts[i1], v2 = globalVerts[i2];
            if (!v0 || !v1 || !v2) continue;
            const d01 = (v0[0]-v1[0])**2+(v0[1]-v1[1])**2+(v0[2]-v1[2])**2;
            const d12 = (v1[0]-v2[0])**2+(v1[1]-v2[1])**2+(v1[2]-v2[2])**2;
            const d02 = (v0[0]-v2[0])**2+(v0[1]-v2[1])**2+(v0[2]-v2[2])**2;
            if (d01 < 1e-24 || d12 < 1e-24 || d02 < 1e-24) continue;

            // Add edges (canonical: smaller index first)
            let e01, e12, e02;
            if (i0 < i1) e01 = `${i0}-${i1}`; else e01 = `${i1}-${i0}`;
            if (i1 < i2) e12 = `${i1}-${i2}`; else e12 = `${i2}-${i1}`;
            if (i0 < i2) e02 = `${i0}-${i2}`; else e02 = `${i2}-${i0}`;

            edgeSet.add(e01);
            edgeSet.add(e12);
            edgeSet.add(e02);
            totalTris++;
        }

        // Also add boundary edges (consecutive vertices in face loop)
        for (let i = 0; i < n; i++) {
            const a = faceIndices[i];
            const b = faceIndices[(i + 1) % n];
            if (a === b) continue;
            const key = a < b ? `${a}-${b}` : `${b}-${a}`;
            edgeSet.add(key);
        }
    }

    return { edgeSet, totalTris };
}

// ============================================================
// Split Block 1 into ONE-delimited sections
// ============================================================

function extractSections(block1Vals) {
    const sections = [];
    let current = [];
    for (let i = 0; i < block1Vals.length; i++) {
        if (block1Vals[i] === 1) {
            if (current.length > 0) sections.push(current);
            current = [];
        }
        current.push(block1Vals[i]);
    }
    if (current.length > 0) sections.push(current);
    return sections;
}

// ============================================================
// MAIN EXPERIMENT
// ============================================================

const RESEARCH_DIR = 'C:\\Users\\basha\\Desktop\\soldiworks research';
const files = [
    { name: 'BOTTOM', path: path.join(RESEARCH_DIR, 'test files original', 'usb hub case (ultimate test)', 'USB hub case BOTTOM.SLDPRT') },
    { name: 'TOP', path: path.join(RESEARCH_DIR, 'test files original', 'usb hub case (ultimate test)', 'USB hub case TOP.SLDPRT') },
    { name: 'GEAR', path: path.join(RESEARCH_DIR, 'test files original', 'Helical Bevel Gear.SLDPRT') },
    { name: 'DEKOR', path: path.join(RESEARCH_DIR, 'test files original', 'Dekor.SLDPRT') }
];

console.log('='.repeat(70));
console.log('DISCRIMINATING EXPERIMENT: Block 1 values as global vertex indices');
console.log('='.repeat(70));
console.log('Hypothesis: Block 1 VALUE tokens are global vertex indices into');
console.log('the face vertex table (all face vertices concatenated).');
console.log('Consecutive non-zero VALUE pairs should form edges in the mesh.');
console.log('');

const grandStats = {
    totalSections: 0,
    totalCandidateEdges: 0,
    totalFound: 0,
    totalFalsePos: 0,
    sectionsWithMatch: 0,
    sectionsWithZeroMatch: 0,
    counterexamples: []
};

for (const f of files) {
    if (!fs.existsSync(f.path)) { console.log(`SKIP: ${f.name}`); continue; }
    const buf = fs.readFileSync(f.path);
    const dl = findDisplayLists(buf);
    if (!dl) { console.log(`NO DisplayLists: ${f.name}`); continue; }
    const faces = extractFaces(dl);
    const { globalVerts, faceVertOffsets } = buildGlobalVertexTable(faces);
    const { edgeSet, totalTris } = buildMeshEdges(faces, globalVerts, faceVertOffsets);

    console.log(`\n--- ${f.name}: ${faces.length} faces, ${globalVerts.length} global verts, ${edgeSet.size} mesh edges, ${totalTris} tris ---`);

    const fileStats = {
        sections: 0,
        candidateEdges: 0,
        found: 0,
        falsePos: 0,
        sectionsZeroMatch: 0,
        examples: []
    };

    for (let fi = 0; fi < faces.length; fi++) {
        const face = faces[fi];
        const sections = extractSections(face.block1);

        for (let si = 0; si < sections.length; si++) {
            const sec = sections[si];
            fileStats.sections++;
            grandStats.totalSections++;

            // Extract non-zero VALUE tokens (skip ONE at position 0)
            const values = [];
            for (let i = 1; i < sec.length; i++) {
                if (sec[i] !== 0) values.push(sec[i]);
            }

            if (values.length < 2) continue;

            // Test consecutive pairs (including wrap-around for loops)
            let sectionFound = 0;
            let sectionTotal = 0;
            const sectionFalsePos = [];

            for (let i = 0; i < values.length; i++) {
                const a = values[i];
                const b = values[(i + 1) % values.length]; // wrap-around
                if (a === b) continue; // skip self-loops

                sectionTotal++;
                const key = a < b ? `${a}-${b}` : `${b}-${a}`;
                if (edgeSet.has(key)) {
                    sectionFound++;
                } else {
                    sectionFalsePos.push([a, b]);
                }
            }

            fileStats.candidateEdges += sectionTotal;
            fileStats.found += sectionFound;
            fileStats.falsePos += sectionFalsePos.length;
            grandStats.totalCandidateEdges += sectionTotal;
            grandStats.totalFound += sectionFound;
            grandStats.totalFalsePos += sectionFalsePos.length;

            if (sectionFound > 0) fileStats.sectionsWithMatch++;
            else fileStats.sectionsWithZeroMatch++;

            // Collect counterexamples (sections with 0% match but >2 candidate edges)
            if (sectionFound === 0 && sectionTotal >= 2) {
                const cex = {
                    file: f.name,
                    faceIdx: fi,
                    sectionIdx: si,
                    sectionLen: sec.length,
                    values: values.slice(0, 10),
                    candidateEdges: sectionTotal,
                    falsePos: sectionFalsePos.slice(0, 5),
                    vertRange: `face vc=${face.vertexCount} globalVG=${globalVerts.length}`
                };
                fileStats.examples.push(cex);
                grandStats.counterexamples.push(cex);
            }
        }
    }

    const pct = fileStats.candidateEdges > 0
        ? (100 * fileStats.found / fileStats.candidateEdges).toFixed(1)
        : 'N/A';
    console.log(`  Sections: ${fileStats.sections}`);
    console.log(`  Candidate edges: ${fileStats.candidateEdges}`);
    console.log(`  Found in mesh: ${fileStats.found} (${pct}%)`);
    console.log(`  False positives: ${fileStats.falsePos}`);
    console.log(`  Sections with 0% match: ${fileStats.sectionsZeroMatch}`);
    if (fileStats.examples.length > 0) {
        console.log(`  Counterexamples:`);
        for (const cex of fileStats.examples.slice(0, 3)) {
            console.log(`    Face#${cex.faceIdx} S${cex.sectionIdx} len=${cex.sectionLen}: [${cex.values.join(',')}] → 0/${cex.candidateEdges} edges found`);
        }
    }
}

console.log(`\n${'='.repeat(70)}`);
console.log(`GRAND TOTALS`);
console.log(`${'='.repeat(70)}`);
const grandPct = grandStats.totalCandidateEdges > 0
    ? (100 * grandStats.totalFound / grandStats.totalCandidateEdges).toFixed(1)
    : 'N/A';
console.log(`Sections: ${grandStats.totalSections}`);
console.log(`Candidate edges: ${grandStats.totalCandidateEdges}`);
console.log(`Found in mesh: ${grandStats.totalFound} (${grandPct}%)`);
console.log(`False positives: ${grandStats.totalFalsePos}`);
console.log(`Sections with any match: ${grandStats.sectionsWithMatch}`);
console.log(`Sections with 0% match: ${grandStats.sectionsWithZeroMatch}`);
console.log(`Counterexamples (0% match, ≥2 candidates): ${grandStats.counterexamples.length}`);

// ============================================================
// ALTERNATIVE TEST: Check if Block 1 values index into a 
// DIFFERENT vertex table (not the face vertices)
// ============================================================

console.log(`\n${'='.repeat(70)}`);
console.log(`ALTERNATIVE TEST: Do Block 1 values index beyond the face vertex table?`);
console.log(`${'='.repeat(70)}`);

let outOfRangeCount = 0;
let totalValues = 0;
const maxBlock1Value = { val: 0, file: '', face: 0 };

for (const f of files) {
    if (!fs.existsSync(f.path)) continue;
    const buf = fs.readFileSync(f.path);
    const dl = findDisplayLists(buf);
    if (!dl) continue;
    const faces = extractFaces(dl);
    const { globalVerts } = buildGlobalVertexTable(faces);

    for (let fi = 0; fi < faces.length; fi++) {
        const face = faces[fi];
        const sections = extractSections(face.block1);
        for (const sec of sections) {
            for (let i = 1; i < sec.length; i++) {
                if (sec[i] === 0) continue;
                totalValues++;
                if (sec[i] >= globalVerts.length) outOfRangeCount++;
                if (sec[i] > maxBlock1Value.val) {
                    maxBlock1Value.val = sec[i];
                    maxBlock1Value.file = f.name;
                    maxBlock1Value.face = fi;
                }
            }
        }
    }
}

console.log(`Total non-zero Block 1 values: ${totalValues}`);
console.log(`Values beyond global vertex table range [0, ${maxBlock1Value.val}]: ${outOfRangeCount} (${(100*outOfRangeCount/totalValues).toFixed(1)}%)`);
console.log(`Max Block 1 value: ${maxBlock1Value.val} (file=${maxBlock1Value.file} face=${maxBlock1Value.face})`);
console.log(`This means ${outOfRangeCount} values CANNOT be vertex indices into the face vertex table.`);

// ============================================================
// ALTERNATIVE TEST 2: Check if Block 1 values match the
// face's OWN vertex indices (local, not global)
// ============================================================

console.log(`\n${'='.repeat(70)}`);
console.log(`ALTERNATIVE TEST 2: Do Block 1 values match face-local vertex indices?`);
console.log(`${'='.repeat(70)}`);

let localMatch = 0, localTotal = 0;
for (const f of files) {
    if (!fs.existsSync(f.path)) continue;
    const buf = fs.readFileSync(f.path);
    const dl = findDisplayLists(buf);
    if (!dl) continue;
    const faces = extractFaces(dl);
    for (const face of faces) {
        const sections = extractSections(face.block1);
        for (const sec of sections) {
            for (let i = 1; i < sec.length; i++) {
                if (sec[i] === 0) continue;
                localTotal++;
                if (sec[i] < face.vertexCount) localMatch++;
            }
        }
    }
}
console.log(`Values matching face-local index [0, vc): ${localMatch}/${localTotal} (${(100*localMatch/localTotal).toFixed(1)}%)`);
