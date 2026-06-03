#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const pako = require('pako');

// Minimal SLPRD extraction to test speed
function testExtract(filePath) {
    const buf = new Uint8Array(fs.readFileSync(filePath));
    const t0 = Date.now();
    
    // Skip OLE2, go straight to openSX
    const key = buf[7];
    const marker = new Uint8Array([0x14, 0x00, 0x06, 0x00, 0x08, 0x00]);
    
    // Find markers
    const positions = [];
    for (let i = 0; i <= buf.length - marker.length; i++) {
        let ok = true;
        for (let j = 0; j < marker.length; j++) { if (buf[i+j] !== marker[j]) { ok = false; break; } }
        if (ok) positions.push(i);
    }
    
    // Find and decompress DisplayLists
    let dl = null;
    for (const mp of positions) {
        const si = mp - 4;
        if (si < 0 || si + 0x1E > buf.length) continue;
        const csz = (buf[si+0x12] | (buf[si+0x13]<<8) | (buf[si+0x14]<<16) | (buf[si+0x15]<<24)) >>> 0;
        const nsz = (buf[si+0x1A] | (buf[si+0x1B]<<8) | (buf[si+0x1C]<<16) | (buf[si+0x1D]<<24)) >>> 0;
        if (nsz > 1024 || csz > 50*1024*1024) continue;
        const nameEnd = si + 0x1E + nsz;
        if (nameEnd > buf.length) continue;
        
        let name = '';
        for (let i = 0; i < nsz; i++) {
            const b = buf[si+0x1E+i];
            name += String.fromCharCode(((b << 4) | (b >>> 4)) & 0xFF);
        }
        
        if (!name.includes('DisplayList') || csz < 100) continue;
        const f1 = (buf[si+0x0E] | (buf[si+0x0F]<<8) | (buf[si+0x10]<<16) | (buf[si+0x11]<<24)) >>> 0;
        if (f1 < 65536) continue;
        
        const compressed = buf.slice(nameEnd, nameEnd + csz);
        try { dl = pako.inflateRaw(compressed); } catch(e) {}
        if (dl && dl.length > 100 && dl[0] === 1 && dl[4] === 1) break;
        dl = null;
    }
    
    const t1 = Date.now();
    
    if (!dl) {
        console.log(path.basename(filePath).substring(0,35).padEnd(37), 'NO DL', (t1-t0)+'ms');
        return;
    }
    
    // Scan for surfaces
    const dv = new DataView(dl.buffer, dl.byteOffset, dl.byteLength);
    const MIN_C = 0.0005, MAX_C = 0.6;
    let totalV = 0, totalF = 0, surfaces = 0;
    
    function looksLikeVertex(x, y, z) {
        if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return false;
        const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
        if (ax > MAX_C || ay > MAX_C || az > MAX_C) return false;
        return (ax >= MIN_C ? 1 : 0) + (ay >= MIN_C ? 1 : 0) + (az >= MIN_C ? 1 : 0) >= 2;
    }
    
    let scanPos = 96;
    while (scanPos + 20 <= dl.length) {
        const fc = dv.getUint32(scanPos, true);
        if (fc < 1 || fc > 50) { scanPos += 4; continue; }
        
        let found = false;
        for (let to = 4; to < 200; to += 4) {
            const cs = scanPos + to;
            if (cs + fc * 4 > dl.length) break;
            const counts = [];
            let ok = true;
            for (let i = 0; i < fc; i++) { const v = dv.getUint32(cs + i * 4, true); if (v < 2 || v > 500) { ok = false; break; } counts.push(v); }
            if (!ok) continue;
            let tv = 0; for (let j = 0; j < counts.length; j++) tv += counts[j];
            if (tv < 3 || tv > 5000) continue;
            
            const ac = cs + fc * 4;
            let vs = -1;
            for (let vp = ac; vp < ac + 500 && vp + 24 <= dl.length; vp += 4) {
                const x = dv.getFloat32(vp, true), y = dv.getFloat32(vp+4, true), z = dv.getFloat32(vp+8, true);
                if (looksLikeVertex(x, y, z)) {
                    const x2 = dv.getFloat32(vp+12, true), y2 = dv.getFloat32(vp+16, true), z2 = dv.getFloat32(vp+20, true);
                    if (looksLikeVertex(x2, y2, z2)) { vs = vp; break; }
                }
            }
            if (vs < 0) continue;
            
            let vertCount = 0;
            let p = vs;
            while (p + 12 <= dl.length && vertCount < tv) {
                const x = dv.getFloat32(p, true), y = dv.getFloat32(p+4, true), z = dv.getFloat32(p+8, true);
                if (!isFinite(x) || !isFinite(y) || !isFinite(z)) break;
                if (Math.abs(x) > MAX_C || Math.abs(y) > MAX_C || Math.abs(z) > MAX_C) break;
                vertCount++; p += 12;
            }
            if (vertCount >= Math.floor(tv * 0.7)) {
                totalV += vertCount;
                totalF += counts.length;
                surfaces++;
                scanPos = vs + vertCount * 12;
                found = true;
            }
            break;
        }
        if (!found) scanPos += 4;
    }
    
    const t2 = Date.now();
    console.log(path.basename(filePath).substring(0,35).padEnd(37), 
        (t1-t0)+'ms decomp', (t2-t1)+'ms scan', totalV+'v', totalF+'f', surfaces+'surf');
}

const dir = 'C:\\.git\\sldprt-research';
for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.SLDPRT')) testExtract(dir + '\\' + f);
}
