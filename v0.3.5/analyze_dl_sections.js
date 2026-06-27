/**
 * analyze_dl_sections.js — Map DisplayLists internal section structure
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
    gear: path.join(BASE, 'test files original', 'Helical Bevel Gear.SLDPRT'),
};

for (const [label, filePath] of Object.entries(FILES)) {
    console.log('\n' + '#'.repeat(70));
    console.log('#  ' + label.toUpperCase() + ' — DisplayLists Section Map');
    console.log('#'.repeat(70));

    const buf = fs.readFileSync(filePath);
    const streams = decompress(buf);
    const mainDL = streams['Contents/DisplayLists'];
    if (!mainDL) { console.log('No main DL'); continue; }

    const d = Buffer.from(mainDL);
    console.log('  Total size: ' + d.length + ' bytes');

    // Find all [1,1] section headers
    const sectionStarts = [];
    for (let i = 0; i <= d.length - 8; i += 4) {
        if (d.readUInt32LE(i) === 1 && d.readUInt32LE(i + 4) === 1) {
            sectionStarts.push(i);
        }
    }

    console.log('  Section headers [1,1]: ' + sectionStarts.length);
    console.log('  Section map:');
    for (let s = 0; s < sectionStarts.length; s++) {
        const start = sectionStarts[s];
        const end = s + 1 < sectionStarts.length ? sectionStarts[s + 1] : d.length;
        const size = end - start;

        // Count face markers in this section
        let faceCount = 0;
        let topoCount = 0;
        let stringCount = 0;

        for (let i = start; i < end - 8; i += 4) {
            if (d.readUInt32LE(i) === 12 && d.readUInt32LE(i + 4) === 100 &&
                d.readUInt32LE(i + 8) === 2) faceCount++;
            if (d.readUInt32LE(i) === 4 && d.readUInt32LE(i + 4) === 8 &&
                d.readUInt32LE(i + 8) === 2) topoCount++;
        }

        // Count strings
        let cur = '';
        for (let i = start; i < end; i++) {
            const c = d[i];
            if (c >= 0x20 && c < 0x7f) {
                cur += String.fromCharCode(c);
            } else {
                if (cur.length >= 4) stringCount++;
                cur = '';
            }
        }

        // Read first few u32s
        const header = [];
        for (let i = 0; i < Math.min(6, Math.floor((end - start) / 4)); i++) {
            header.push(d.readUInt32LE(start + i * 4));
        }

        // Find first string
        let firstStr = '';
        cur = '';
        for (let i = start; i < Math.min(start + 200, end); i++) {
            const c = d[i];
            if (c >= 0x20 && c < 0x7f) {
                cur += String.fromCharCode(c);
            } else {
                if (cur.length >= 4) { firstStr = cur; break; }
                cur = '';
            }
        }

        console.log('    Section ' + s + ': +' + start.toString(16).padStart(6, '0') +
            ' size=' + String(size).padStart(8) +
            ' faces=' + String(faceCount).padStart(3) +
            ' topo=' + String(topoCount).padStart(3) +
            ' strs=' + String(stringCount).padStart(3) +
            ' hdr=' + header.map(h => '0x' + h.toString(16)).join(',') +
            (firstStr ? ' str="' + firstStr.substring(0, 30) + '"' : '')
        );
    }

    // Also find face blocks with their sizes
    console.log('\n  Face blocks (first 10):');
    const MARKER = new Uint8Array([0x0c, 0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00]);
    const faceMarkers = findAll(d, MARKER);
    let faceIdx = 0;
    for (const mp of faceMarkers) {
        if (mp < 4) continue;
        const ec = d.readUInt32LE(mp - 4);
        if (ec < 1 || ec > 500) continue;
        const ft = d.readUInt32LE(mp + 8);
        if (ft !== 2) continue;
        const vc = d.readUInt32LE(mp + 12);
        if (vc < 3 || vc > 10000) continue;

        // Find next face or section boundary
        let nextPos = d.length;
        for (const mp2 of faceMarkers) {
            if (mp2 > mp + 16) { nextPos = mp2 - 4; break; }
        }

        const faceStart = mp - 4;
        const faceSize = nextPos - faceStart;

        if (faceIdx < 10) {
            console.log('    Face ' + faceIdx + ': +' + faceStart.toString(16).padStart(6, '0') +
                ' ec=' + ec + ' vc=' + vc + ' size=' + faceSize);
        }
        faceIdx++;
    }
    console.log('    Total face blocks: ' + faceIdx);
}
