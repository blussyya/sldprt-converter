#!/usr/bin/env node
'use strict';
const fs = require('fs');
const pako = require('pako');

function getDisplayLists(filePath) {
    const buf = new Uint8Array(fs.readFileSync(filePath));
    const marker = new Uint8Array([0x14, 0x00, 0x06, 0x00, 0x08, 0x00]);
    
    for (let i = 0; i <= buf.length - marker.length; i++) {
        let ok = true;
        for (let j = 0; j < marker.length; j++) { if (buf[i+j] !== marker[j]) { ok = false; break; } }
        if (!ok) continue;
        
        const si = i - 4;
        if (si < 0 || si + 0x1E > buf.length) continue;
        const csz = (buf[si+0x12] | (buf[si+0x13]<<8) | (buf[si+0x14]<<16) | (buf[si+0x15]<<24)) >>> 0;
        const nsz = (buf[si+0x1A] | (buf[si+0x1B]<<8) | (buf[si+0x1C]<<16) | (buf[si+0x1D]<<24)) >>> 0;
        if (nsz > 1024 || csz > 50*1024*1024) continue;
        const nameEnd = si + 0x1E + nsz;
        if (nameEnd > buf.length) continue;
        
        let name = '';
        for (let k = 0; k < nsz; k++) {
            const b = buf[si+0x1E+k];
            name += String.fromCharCode(((b << 4) | (b >>> 4)) & 0xFF);
        }
        
        if (!name.includes('DisplayList') || csz < 100) continue;
        const f1 = (buf[si+0x0E] | (buf[si+0x0F]<<8) | (buf[si+0x10]<<16) | (buf[si+0x11]<<24)) >>> 0;
        if (f1 < 65536) continue;
        
        const compressed = buf.slice(nameEnd, nameEnd + csz);
        try {
            const dl = pako.inflateRaw(compressed);
            if (dl.length > 100 && dl[0] === 1 && dl[4] === 1) return dl;
        } catch(e) {}
    }
    return null;
}

const dl = getDisplayLists('C:\\\\.git\\\\sldprt-research\\\\PTC GE8080-8.SLDPRT');
if (!dl) { console.log('No DisplayLists found'); process.exit(1); }

const dv = new DataView(dl.buffer, dl.byteOffset, dl.byteLength);
console.log('DisplayLists size:', dl.length, 'bytes');

// Dump the first 256 bytes to understand the header
console.log('\n=== FIRST 256 BYTES ===');
for (let off = 0; off < 256; off += 16) {
    let hex = '', ascii = '';
    for (let i = 0; i < 16 && off + i < dl.length; i++) {
        const b = dl[off + i];
        hex += b.toString(16).padStart(2, '0') + ' ';
        ascii += (b >= 0x20 && b < 0x7F) ? String.fromCharCode(b) : '.';
    }
    console.log(off.toString(16).padStart(4, '0') + ': ' + hex + ' ' + ascii);
}

// Dump as various interpretations
console.log('\n=== HEADER INTERPRETATION ===');
console.log('u32 LE values from offset 0:');
for (let i = 0; i < 24; i++) {
    const v = dv.getUint32(i * 4, true);
    const f = dv.getFloat32(i * 4, true);
    console.log(`  @${(i*4).toString(16).padStart(4,'0')}: u32=${v}  float=${f.toFixed(6)}`);
}

// Look for the MFC header pattern
console.log('\n=== SEARCHING FOR MFC HEADER ===');
// MFC typically starts with version info
// Let's look for common patterns
for (let off = 0; off < Math.min(512, dl.length); off += 4) {
    const v = dv.getUint32(off, true);
    // Common MFC header values
    if (v === 0x0001 || v === 0x0002 || v === 131072 || v === 131073) {
        console.log(`  Potential MFC header at 0x${off.toString(16)}: ${v}`);
    }
}

// Now let's try the approach that works in the production extractor
// Look for the actual working extraction by scanning for float32 vertices
console.log('\n=== SCANNING FOR VERTEX CLUSTERS ===');
const MIN_C = 0.0005, MAX_C = 0.6;
function looksLikeVertex(x, y, z) {
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return false;
    const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
    if (ax > MAX_C || ay > MAX_C || az > MAX_C) return false;
    return (ax >= MIN_C ? 1 : 0) + (ay >= MIN_C ? 1 : 0) + (az >= MIN_C ? 1 : 0) >= 2;
}

// Find all positions where consecutive float32 triplets look like vertices
const vertexRuns = [];
for (let off = 0; off + 24 <= dl.length; off += 4) {
    const x1 = dv.getFloat32(off, true), y1 = dv.getFloat32(off+4, true), z1 = dv.getFloat32(off+8, true);
    const x2 = dv.getFloat32(off+12, true), y2 = dv.getFloat32(off+16, true), z2 = dv.getFloat32(off+20, true);
    
    if (looksLikeVertex(x1, y1, z1) && looksLikeVertex(x2, y2, z2)) {
        // Count consecutive vertices
        let count = 2;
        let p = off + 24;
        while (p + 12 <= dl.length && count < 5000) {
            const x = dv.getFloat32(p, true), y = dv.getFloat32(p+4, true), z = dv.getFloat32(p+8, true);
            if (!looksLikeVertex(x, y, z)) break;
            count++;
            p += 12;
        }
        if (count >= 3) {
            vertexRuns.push({ offset: off, count: count });
            off = p - 4; // skip past this run
        }
    }
}

console.log(`Found ${vertexRuns.length} vertex runs`);
for (let i = 0; i < Math.min(vertexRuns.length, 20); i++) {
    const r = vertexRuns[i];
    const x = dv.getFloat32(r.offset, true);
    const y = dv.getFloat32(r.offset + 4, true);
    const z = dv.getFloat32(r.offset + 8, true);
    console.log(`  Run ${i}: offset=0x${r.offset.toString(16)} count=${r.count} start=(${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)})`);
}

// Now the KEY question: what's BETWEEN vertex runs? That's where face indices live!
console.log('\n=== DATA BETWEEN VERTEX RUNS (potential face indices) ===');
for (let i = 0; i < Math.min(vertexRuns.length - 1, 10); i++) {
    const endOfCurrent = vertexRuns[i].offset + vertexRuns[i].count * 12;
    const startOfNext = vertexRuns[i+1].offset;
    const gap = startOfNext - endOfCurrent;
    
    if (gap > 0 && gap < 200) {
        console.log(`\nGap between run ${i} and ${i+1}: ${gap} bytes at 0x${endOfCurrent.toString(16)}`);
        // Dump as various types
        let asU16 = [], asU32 = [], asHex = '';
        for (let j = 0; j < gap; j += 2) {
            if (j + 2 <= gap) asU16.push(dv.getUint16(endOfCurrent + j, true));
        }
        for (let j = 0; j < gap; j += 4) {
            if (j + 4 <= gap) asU32.push(dv.getUint32(endOfCurrent + j, true));
        }
        for (let j = 0; j < gap; j++) {
            asHex += dl[endOfCurrent + j].toString(16).padStart(2, '0') + ' ';
        }
        console.log('  Hex:', asHex);
        console.log('  u16:', asU16.join(', '));
        console.log('  u32:', asU32.join(', '));
    }
}
