/**
 * analyze_lwdata.js — Deep analysis of Config-0-LWDATA stream
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

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
    s &= 7;
    if (s === 0) return b;
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
        const ns = si + 0x1E;
        const ne = ns + nsz;
        if (ne > buf.length) continue;
        const rn = buf.subarray(ns, ne);
        let n = '';
        for (let i = 0; i < nsz; i++) n += String.fromCharCode(rolByte(rn[i], key));
        if (!n.length) continue;
        const ds = ne;
        const de = ds + csz;
        if (de > buf.length) continue;
        if (f1 >= 65536 && csz > 0) {
            try {
                const d = zlib.inflateRawSync(Buffer.from(buf.subarray(ds, de)));
                if (d && d.length > 0 && !streams[n]) streams[n] = d;
            } catch (e) {
                try {
                    const d = zlib.inflateSync(Buffer.from(buf.subarray(ds, de)));
                    if (d && d.length > 0 && !streams[n]) streams[n] = d;
                } catch (e2) {}
            }
        }
    }
    return streams;
}

const BASE = path.resolve(__dirname, '..');
const FILES = {
    bottom: path.join(BASE, 'test files original', 'usb hub case (ultimate test)', 'USB hub case BOTTOM.SLDPRT'),
    top: path.join(BASE, 'test files original', 'usb hub case (ultimate test)', 'USB hub case TOP.SLDPRT'),
    gear: path.join(BASE, 'test files original', 'Helical Bevel Gear.SLDPRT'),
    dekor: path.join(BASE, 'test files original', 'Dekor.SLDPRT'),
};

for (const [label, filePath] of Object.entries(FILES)) {
    console.log('\n' + '='.repeat(70));
    console.log('  ' + label.toUpperCase());
    console.log('='.repeat(70));

    const buf = fs.readFileSync(filePath);
    const streams = decompress(buf);
    const lwdata = streams['Contents/Config-0-LWDATA'];
    if (!lwdata) { console.log('  No LWDATA stream found'); continue; }

    const d = Buffer.from(lwdata);
    console.log('  Size: ' + d.length + ' bytes');

    // Header
    console.log('\n  Header (first 32 bytes as u32s):');
    for (let i = 0; i < Math.min(8, Math.floor(d.length / 4)); i++) {
        const v = d.readUInt32LE(i * 4);
        console.log('    [' + (i * 4).toString(16).padStart(4, '0') + '] = ' + String(v).padStart(10) + ' (0x' + v.toString(16).padStart(8, '0') + ')');
    }

    // Byte distribution
    const byteFreq = new Uint32Array(256);
    for (let i = 0; i < d.length; i++) byteFreq[d[i]]++;
    let entropy = 0;
    for (let i = 0; i < 256; i++) {
        if (byteFreq[i] > 0) {
            const p = byteFreq[i] / d.length;
            entropy -= p * Math.log2(p);
        }
    }
    console.log('\n  Entropy: ' + entropy.toFixed(2) + ' bits/byte');
    console.log('  Zero bytes: ' + (byteFreq[0] / d.length * 100).toFixed(1) + '%');

    // String scan
    console.log('\n  Embedded strings (ASCII, len >= 3):');
    let cur = '';
    let curStart = 0;
    const strings = [];
    for (let i = 0; i < d.length; i++) {
        const c = d[i];
        if (c >= 0x20 && c < 0x7f) {
            if (cur.length === 0) curStart = i;
            cur += String.fromCharCode(c);
        } else {
            if (cur.length >= 3) strings.push({ str: cur, offset: curStart });
            cur = '';
        }
    }
    if (cur.length >= 3) strings.push({ str: cur, offset: curStart });
    for (const s of strings) {
        console.log('    +' + s.offset.toString(16).padStart(6, '0') + ': "' + s.str + '"');
    }

    // u32 distribution
    console.log('\n  u32 distribution (first 64 u32s):');
    const u32s = [];
    for (let i = 0; i < Math.min(64, Math.floor(d.length / 4)); i++) {
        u32s.push(d.readUInt32LE(i * 4));
    }
    // Show as hex dump
    for (let i = 0; i < u32s.length; i += 4) {
        const row = [];
        for (let j = 0; j < 4 && i + j < u32s.length; j++) {
            row.push(u32s[i + j].toString(16).padStart(8, '0'));
        }
        console.log('    +' + (i * 4).toString(16).padStart(4, '0') + ': ' + row.join(' '));
    }

    // Check for known patterns
    console.log('\n  Known pattern search:');
    // Search for face markers
    const faceMarkers = findAll(d, new Uint8Array([0x0c, 0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00]));
    console.log('    Face markers [12,0,0,0,100,0,0,0]: ' + faceMarkers.length);

    // Search for topo headers
    let topoHeaders = 0;
    for (let i = 0; i <= d.length - 16; i += 4) {
        if (d.readUInt32LE(i) === 4 && d.readUInt32LE(i + 4) === 8 && d.readUInt32LE(i + 8) === 2) {
            topoHeaders++;
        }
    }
    console.log('    Topo headers [4,8,2,N]: ' + topoHeaders);

    // Search for [1,1] headers
    let dlHeaders = 0;
    for (let i = 0; i <= d.length - 8; i += 4) {
        if (d.readUInt32LE(i) === 1 && d.readUInt32LE(i + 4) === 1) dlHeaders++;
    }
    console.log('    [1,1] headers: ' + dlHeaders);

    // Search for float32 sequences
    let floatCount = 0;
    for (let i = 0; i <= d.length - 4; i += 4) {
        const f = d.readFloatLE(i);
        if (isFinite(f) && Math.abs(f) < 1000 && Math.abs(f) > 0.001) floatCount++;
    }
    console.log('    Plausible float32 values: ' + floatCount + ' / ' + Math.floor(d.length / 4));

    // Cross-reference with main DisplayLists
    const mainDL = streams['Contents/DisplayLists'];
    if (mainDL) {
        const md = Buffer.from(mainDL);
        console.log('\n  Cross-reference with main DisplayLists (' + md.length + ' bytes):');
        // Check if any u32 values in LWDATA appear as face counts in main DL
        const lwU32Set = new Set();
        for (let i = 0; i <= d.length - 4; i += 4) lwU32Set.add(d.readUInt32LE(i));
        console.log('    Unique u32 values in LWDATA: ' + lwU32Set.size);
        // Check overlap with vertex counts in main DL
        let overlap = 0;
        for (const v of lwU32Set) {
            // Check if v appears as a vertexCount in main DL
            for (let i = 0; i <= md.length - 16; i += 4) {
                if (md.readUInt32LE(i) === 12 && md.readUInt32LE(i + 4) === 100 &&
                    md.readUInt32LE(i + 8) === 2 && md.readUInt32LE(i + 12) === v) {
                    overlap++;
                    break;
                }
            }
        }
        console.log('    LWDATA u32 values matching main DL vertexCounts: ' + overlap);
    }
}
