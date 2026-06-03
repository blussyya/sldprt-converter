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

// Step 1: Find the MFC class names - these tell us what objects are in the stream
console.log('\n=== MFC CLASS NAMES ===');
let pos = 0x60; // Start after the float64 metadata header
while (pos < dl.length - 4) {
    const b0 = dl[pos], b1 = dl[pos+1];
    
    if (b0 === 0xFF && b1 === 0xFF) {
        // New class
        if (pos + 4 > dl.length) break;
        const classId = dv.getUint16(pos + 2, true);
        // Read name length (u16 LE) then name bytes
        if (pos + 6 > dl.length) break;
        const nameLen = dv.getUint16(pos + 4, true);
        if (nameLen > 200 || pos + 6 + nameLen > dl.length) {
            console.log(`@0x${pos.toString(16)}: class ${classId}, invalid nameLen ${nameLen}`);
            break;
        }
        let name = '';
        for (let k = 0; k < nameLen; k++) {
            const ch = dl[pos + 6 + k];
            name += (ch >= 0x20 && ch < 0x7F) ? String.fromCharCode(ch) : '?';
        }
        console.log(`@0x${pos.toString(16)}: NEW class ${classId} "${name}" (nameLen=${nameLen})`);
        pos += 6 + nameLen;
    } else if (b0 === 0xFF && b1 === 0xFE) {
        // Backref
        if (pos + 4 > dl.length) break;
        const refId = dv.getUint16(pos + 2, true);
        console.log(`@0x${pos.toString(16)}: BACKREF class ${refId}`);
        pos += 4;
    } else {
        // Not MFC - this is data
        console.log(`@0x${pos.toString(16)}: END OF MFC CLASSES (byte: ${b0.toString(16)} ${b1.toString(16)})`);
        break;
    }
}

// Step 2: After MFC classes, look for the actual data structures
// Let's dump a wide range around the first vertex data
console.log('\n=== SEARCHING FOR FACE COUNT + VERTEX DATA PATTERNS ===');

// The production extractor finds surfaces starting with a u32 faceCount
// Let's look for small u32 values (1-50) followed by plausible vertex data
for (let off = 0x60; off < dl.length - 100; off += 4) {
    const fc = dv.getUint32(off, true);
    if (fc < 1 || fc > 50) continue;
    
    // Check if next fc u32s look like vertex counts (2-500)
    let ok = true;
    const counts = [];
    for (let i = 0; i < fc; i++) {
        if (off + 4 + i * 4 + 4 > dl.length) { ok = false; break; }
        const c = dv.getUint32(off + 4 + i * 4, true);
        if (c < 1 || c > 500) { ok = false; break; }
        counts.push(c);
    }
    if (!ok || counts.length !== fc) continue;
    
    // Check if after the counts, there are float32 vertices
    const vertStart = off + 4 + fc * 4;
    let totalVerts = 0;
    for (const c of counts) totalVerts += c;
    
    if (vertStart + totalVerts * 12 > dl.length) continue;
    
    // Check first few vertices
    let vertsOk = true;
    for (let i = 0; i < Math.min(6, totalVerts); i++) {
        const x = dv.getFloat32(vertStart + i * 12, true);
        const y = dv.getFloat32(vertStart + i * 12 + 4, true);
        const z = dv.getFloat32(vertStart + i * 12 + 8, true);
        if (!isFinite(x) || !isFinite(y) || !isFinite(z) || Math.abs(x) > 10 || Math.abs(y) > 10 || Math.abs(z) > 10) {
            vertsOk = false;
            break;
        }
    }
    if (!vertsOk) continue;
    
    const vertEnd = vertStart + totalVerts * 12;
    
    // SUCCESS! Found a surface. Now check what comes AFTER the vertices
    console.log(`\nSURFACE at 0x${off.toString(16)}: fc=${fc} counts=[${counts.join(',')}] vertStart=0x${vertStart.toString(16)} vertEnd=0x${vertEnd.toString(16)}`);
    
    // Show first 3 vertices
    for (let i = 0; i < Math.min(3, totalVerts); i++) {
        const x = dv.getFloat32(vertStart + i * 12, true);
        const y = dv.getFloat32(vertStart + i * 12 + 4, true);
        const z = dv.getFloat32(vertStart + i * 12 + 8, true);
        console.log(`  v${i}: (${x.toFixed(4)}, ${y.toFixed(4)}, ${z.toFixed(4)})`);
    }
    
    // What's after the vertices? This is where face INDEX DATA should be
    if (vertEnd + 200 < dl.length) {
        console.log(`  Data after vertices (0x${vertEnd.toString(16)}):`);
        
        // Dump 200 bytes as hex
        let hex = '  ';
        for (let i = 0; i < 200 && vertEnd + i < dl.length; i++) {
            hex += dl[vertEnd + i].toString(16).padStart(2, '0') + ' ';
            if ((i + 1) % 32 === 0) hex += '\n  ';
        }
        console.log(hex);
        
        // Try interpreting as u16 indices
        console.log('  As u16:');
        const u16s = [];
        for (let i = 0; i < 50 && vertEnd + i * 2 + 2 <= dl.length; i++) {
            u16s.push(dv.getUint16(vertEnd + i * 2, true));
        }
        // Print in rows of 10
        for (let i = 0; i < u16s.length; i += 10) {
            console.log('    ' + u16s.slice(i, i + 10).map(v => v.toString().padStart(5)).join(' '));
        }
        
        // Try interpreting as u32 indices  
        console.log('  As u32:');
        const u32s = [];
        for (let i = 0; i < 30 && vertEnd + i * 4 + 4 <= dl.length; i++) {
            u32s.push(dv.getUint32(vertEnd + i * 4, true));
        }
        for (let i = 0; i < u32s.length; i += 8) {
            console.log('    ' + u32s.slice(i, i + 8).map(v => v.toString().padStart(8)).join(' '));
        }
    }
    
    // Only show first 3 surfaces
    break; // Remove this to see more
}
