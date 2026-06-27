#!/usr/bin/env node
'use strict';
/**
 * GEAR TABLE ZERO ENTRY ANALYSIS
 *
 * The GEAR table at base=76696 has 184 zero entries out of 4580.
 * What indices are zero? Do they correlate with mesh structure?
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

const GEAR_PATH = 'C:\\Users\\basha\\Desktop\\soldiworks research\\test files original\\Helical Bevel Gear.SLDPRT';
const buf = fs.readFileSync(GEAR_PATH);
const dl = findDisplayLists(buf);
if (!dl) { console.log('No DisplayLists'); process.exit(1); }

const faces = extractFaces(dl);
const allB1 = faces.flatMap(fa => fa.block1).filter(v => v > 0);
const maxB1 = Math.max(...allB1);

const TABLE_BASE = 76696;
const TABLE_FLAG = 4144035831; // 0xf700f7f7

console.log('GEAR TABLE ZERO ENTRY ANALYSIS');
console.log(`Table base: ${TABLE_BASE}, maxB1: ${maxB1}, total B1 values: ${allB1.length}`);
console.log(`Table flag: 0x${TABLE_FLAG.toString(16)} (${TABLE_FLAG})`);

// Collect zero and non-zero indices
const zeroIndices = [];
const flagIndices = [];
const otherIndices = [];

for (let i = 0; i <= maxB1; i++) {
    const val = dl.readUInt32LE(TABLE_BASE + i * 4);
    if (val === 0) zeroIndices.push(i);
    else if (val === TABLE_FLAG) flagIndices.push(i);
    else otherIndices.push({ index: i, value: val });
}

console.log(`\nZero indices: ${zeroIndices.length}`);
console.log(`Flag indices: ${flagIndices.length}`);
console.log(`Other indices: ${otherIndices.length}`);

// Are zero indices clustered or scattered?
console.log(`\nZero index distribution:`);
const zeroRanges = [];
let rangeStart = zeroIndices[0];
let rangeEnd = zeroIndices[0];
for (let i = 1; i < zeroIndices.length; i++) {
    if (zeroIndices[i] === rangeEnd + 1) {
        rangeEnd = zeroIndices[i];
    } else {
        zeroRanges.push({ start: rangeStart, end: rangeEnd, count: rangeEnd - rangeStart + 1 });
        rangeStart = zeroIndices[i];
        rangeEnd = zeroIndices[i];
    }
}
zeroRanges.push({ start: rangeStart, end: rangeEnd, count: rangeEnd - rangeStart + 1 });

console.log(`Zero ranges: ${zeroRanges.length}`);
for (const r of zeroRanges.slice(0, 20)) {
    console.log(`  [${r.start}-${r.end}] (${r.count} entries)`);
}
if (zeroRanges.length > 20) {
    console.log(`  ... and ${zeroRanges.length - 20} more ranges`);
}

// Do zero indices appear at the START or END of the table?
console.log(`\nFirst 20 zero indices: ${zeroIndices.slice(0, 20).join(', ')}`);
console.log(`Last 20 zero indices: ${zeroIndices.slice(-20).join(', ')}`);

// Are zero indices evenly distributed across faces?
console.log(`\nPer-face B1 values that index zero entries:`);
for (let fi = 0; fi < Math.min(10, faces.length); fi++) {
    const face = faces[fi];
    const zeroB1 = face.block1.filter(v => v > 0 && dl.readUInt32LE(TABLE_BASE + v * 4) === 0);
    const flagB1 = face.block1.filter(v => v > 0 && dl.readUInt32LE(TABLE_BASE + v * 4) === TABLE_FLAG);
    console.log(`  Face #${fi.toString().padStart(2)} ec=${face.ec} vc=${face.vc} zero=${zeroB1.length}/${face.block1.filter(v => v > 0).length} flag=${flagB1.length}/${face.block1.filter(v => v > 0).length}`);
    if (zeroB1.length > 0 && zeroB1.length <= 5) {
        console.log(`    Zero B1 values: [${zeroB1.join(', ')}]`);
    }
}

// Check: are zero-indexed values at the start of Block 1 sequences?
console.log(`\nPosition of zero-indexed B1 values within Block 1:`);
const zeroPosCounts = new Array(20).fill(0);
let totalZero = 0;
for (const face of faces) {
    for (let i = 0; i < face.block1.length; i++) {
        const v = face.block1[i];
        if (v > 0 && dl.readUInt32LE(TABLE_BASE + v * 4) === 0) {
            if (i < 20) zeroPosCounts[i]++;
            totalZero++;
        }
    }
}
console.log(`Position | Count | %`);
for (let i = 0; i < 20; i++) {
    if (zeroPosCounts[i] > 0) {
        console.log(`  pos ${i.toString().padStart(2)}   | ${zeroPosCounts[i].toString().padStart(5)} | ${(zeroPosCounts[i] / totalZero * 100).toFixed(1)}%`);
    }
}

// What about the "other" values?
console.log(`\nOther (non-zero, non-flag) table values:`);
for (const { index, value } of otherIndices) {
    console.log(`  index=${index} value=${value} (0x${value.toString(16)})`);
}

// Check: does the table have a header before it?
console.log(`\nLooking for structure before table at offset ${TABLE_BASE}:`);
for (let i = TABLE_BASE - 64; i < TABLE_BASE; i += 4) {
    if (i < 0 || i + 4 > dl.length) continue;
    const v = dl.readUInt32LE(i);
    if (v === 4 || v === 8 || v === 2 || v > 100) {
        console.log(`  [${i}] u32=${v}`);
    }
}

// Check: what's at the very start of the DisplayLists?
console.log(`\nFirst 64 bytes of DisplayLists:`);
for (let i = 0; i < 64; i += 4) {
    const v = dl.readUInt32LE(i);
    const f = dl.readFloatLE(i);
    console.log(`  [${i}] u32=${v} ${isFinite(f) && Math.abs(f) > 0.001 ? `flt=${f.toFixed(4)}` : ''}`);
}
