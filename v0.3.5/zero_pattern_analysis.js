#!/usr/bin/env node
'use strict';
/**
 * Block 1 Zero-Pattern Analysis
 * 
 * Block 1 values are global vertex indices (confirmed).
 * Section = [ONE, v1, v2, ..., vN] where vi are vertex indices or zeros.
 * 
 * Question: What do the zeros mean? Hypothesis: zeros mark loop boundaries
 * or indicate that consecutive vertices are the SAME (degenerate edge).
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function rolByte(b, shift) { shift &= 7; if (shift === 0) return b; return ((b << shift) | (b >>> (8 - shift))) & 0xFF; }
function findAll(buf, pattern) {
    const pos = [];
    for (let i = 0; i <= buf.length - pattern.length; i++) {
        let ok = true;
        for (let j = 0; j < pattern.length; j++) { if (buf[i + j] !== pattern[j]) { ok = false; break; } }
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

function extractFacesWithBlock1(dlData) {
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
        for (let i = 0; i < vertexCount; i++) {
            const x = data.readFloatLE(vertStart + i * 12);
            const y = data.readFloatLE(vertStart + i * 12 + 4);
            const z = data.readFloatLE(vertStart + i * 12 + 8);
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
        for (let i = 0; i < N; i++) block1.push(data.readUInt32LE(topoStart + 16 + i * 4));
        const b2Start = topoStart + (N + 4) * 4;
        let block2 = [];
        if (b2Start + 12 <= data.length) {
            const b2h0 = data.readUInt32LE(b2Start);
            const b2h1 = data.readUInt32LE(b2Start + 4);
            const b2h2 = data.readUInt32LE(b2Start + 8);
            if (b2h0 === 4 && b2h1 === 8 && b2h2 === 2) {
                const M = data.readUInt32LE(b2Start + 12);
                for (let i = 0; i < M; i++) block2.push(data.readUInt32LE(b2Start + 16 + i * 4));
            }
        }
        const verts = [];
        for (let i = 0; i < vertexCount; i++) {
            verts.push({
                x: data.readFloatLE(vertStart + i * 12),
                y: data.readFloatLE(vertStart + i * 12 + 4),
                z: data.readFloatLE(vertStart + i * 12 + 8)
            });
        }
        results.push({ edgeCount, vertexCount, block1, block2, N, M: block2.length, verts });
    }
    return results;
}

function extractSections(block1Vals) {
    const sections = [];
    let current = [];
    for (let i = 0; i < block1Vals.length; i++) {
        if (block1Vals[i] === 1) { if (current.length > 0) sections.push(current); current = []; }
        current.push(block1Vals[i]);
    }
    if (current.length > 0) sections.push(current);
    return sections;
}

// ============================================================
// Load BOTTOM file
// ============================================================

const RESEARCH_DIR = 'C:\\Users\\basha\\Desktop\\soldiworks research';
const buf = fs.readFileSync(path.join(RESEARCH_DIR, 'test files original', 'usb hub case (ultimate test)', 'USB hub case BOTTOM.SLDPRT'));
const streams = decompressOpenSX(buf);
const dl = streams['Contents/DisplayLists'];
const faces = extractFacesWithBlock1(dl);

// Build global vertex table (all vertices from all faces, in order)
const globalVerts = [];
const faceVertOffsets = []; // offset into globalVerts for each face
for (const f of faces) {
    faceVertOffsets.push(globalVerts.length);
    for (const v of f.verts) globalVerts.push(v);
}
console.log(`Global vertex table: ${globalVerts.length} vertices`);

// ============================================================
// ANALYSIS
// ============================================================

console.log(`\n${'='.repeat(70)}`);
console.log(`ZERO-PATTERN ANALYSIS`);
console.log(`${'='.repeat(70)}`);

// For each face, extract sections and analyze
for (let fi = 0; fi < Math.min(faces.length, 10); fi++) {
    const face = faces[fi];
    const sections = extractSections(face.block1);
    const baseVertIdx = faceVertOffsets[fi];
    
    console.log(`\n--- FACE #${fi} (ec=${face.edgeCount}, vc=${face.vertexCount}, B2=[${face.block2.join(',')}]) ---`);
    
    for (let si = 0; si < sections.length; si++) {
        const sec = sections[si];
        const loopSize = si < face.block2.length ? face.block2[si] : null;
        const nonzeroPositions = [];
        const zeroPositions = [];
        for (let i = 1; i < sec.length; i++) { // skip ONE at position 0
            if (sec[i] !== 0) nonzeroPositions.push(i);
            else zeroPositions.push(i);
        }
        
        // Extract vertex indices (non-zero, non-ONE values)
        const vertexIndices = sec.slice(1).filter(v => v !== 0);
        
        // Check if vertex indices are in global range
        const inGlobalRange = vertexIndices.filter(v => v < globalVerts.length);
        
        // Look up vertices
        const loopVerts = inGlobalRange.map(idx => globalVerts[idx]);
        
        // Calculate loop properties
        let perimeter = 0;
        let isClosed = false;
        if (loopVerts.length >= 3) {
            for (let i = 0; i < loopVerts.length; i++) {
                const a = loopVerts[i], b = loopVerts[(i+1) % loopVerts.length];
                perimeter += Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2 + (a.z-b.z)**2);
            }
            // Check if first and last vertex are close (closed loop)
            const first = loopVerts[0], last = loopVerts[loopVerts.length-1];
            const gap = Math.sqrt((first.x-last.x)**2 + (first.y-last.y)**2 + (first.z-last.z)**2);
            isClosed = gap < 0.001; // within 0.001mm
        }
        
        console.log(`  S${si}: len=${sec.length} B2=${loopSize} vertices=${vertexIndices.length} inRange=${inGlobalRange.length} perimeter=${perimeter.toFixed(4)}mm closed=${isClosed}`);
        console.log(`    vals: [${sec.join(', ')}]`);
        if (loopVerts.length > 0 && loopVerts.length <= 8) {
            console.log(`    verts: ${loopVerts.map(v => `(${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)})`).join(' ')}`);
        }
        
        // Zero positions analysis
        console.log(`    nonzero at positions: [${nonzeroPositions.join(',')}] zero at positions: [${zeroPositions.join(',')}]`);
        
        // Check: are zeros at even body positions? (body = positions 1..end)
        const bodyEvenZero = zeroPositions.filter(p => (p-1) % 2 === 0);
        const bodyOddZero = zeroPositions.filter(p => (p-1) % 2 === 1);
        console.log(`    zeros at body-even: [${bodyEvenZero.join(',')}] body-odd: [${bodyOddZero.join(',')}]`);
    }
}

// ============================================================
// Global hypothesis: zero pattern = which vertex pairs share an edge
// ============================================================

console.log(`\n${'='.repeat(70)}`);
console.log(`HYPOTHESIS: Zero = same vertex pair (degenerate edge)`);
console.log(`${'='.repeat(70)}`);

// For BOTTOM face #0: section [1, 516, 532, 0, 527, 522]
// Vertices: 516, 532, (0), 527, 522
// If zero means "skip edge", then loop = 516→532→527→522 (4 vertices)
// But section length = 6 = loopSize, so 6 includes the zero

// Check: does removing zeros give the correct vertex count?
for (let fi = 0; fi < Math.min(faces.length, 5); fi++) {
    const face = faces[fi];
    const sections = extractSections(face.block1);
    
    console.log(`\nFACE #${fi}:`);
    for (let si = 0; si < sections.length; si++) {
        const sec = sections[si];
        const loopSize = si < face.block2.length ? face.block2[si] : null;
        const nonzeroCount = sec.slice(1).filter(v => v !== 0).length;
        const zeroCount = sec.slice(1).filter(v => v === 0).length;
        
        // Hypothesis: loopSize = nonzeroCount + zeroCount = len (confirmed)
        // Hypothesis: loop vertex count = nonzeroCount
        // Hypothesis: zeroCount = number of "same edge" repetitions
        
        console.log(`  S${si}: len=${loopSize} nonzero=${nonzeroCount} zeros=${zeroCount} (len = ${nonzeroCount}+${zeroCount})`);
    }
}
