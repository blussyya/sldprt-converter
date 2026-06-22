'use strict';
const fs = require('fs');

function ensureBuffer(data) {
    if (Buffer.isBuffer(data)) return data;
    const arr = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data);
    return Object.assign(arr, {
        readUInt16LE: function(off) { return this[off] | (this[off + 1] << 8); },
        readInt32LE: function(off) { return (this[off] | (this[off + 1] << 8) | (this[off + 2] << 16) | (this[off + 3] << 24)); },
        readUInt32LE: function(off) { return (this[off] | (this[off + 1] << 8) | (this[off + 2] << 16) | (this[off + 3] << 24)) >>> 0; },
        readFloatLE: function(off) {
            if (!this._dv) this._dv = new DataView(this.buffer, this.byteOffset, this.byteLength);
            return this._dv.getFloat32(off, true);
        },
        subarray: function(s, e) { return Buffer.from(this).subarray(s, e); },
        slice: function(s, e) { return Buffer.from(this).slice(s, e); }
    });
}

const file = 'C:\\Users\\basha\\Desktop\\soldiworks research\\test files original\\usb hub case (ultimate test)\\USB hub case BOTTOM.SLDPRT';
const buf = fs.readFileSync(file);

// Extract DisplayLists using the same method as the parser
const { extractMesh } = require('./src/sldprt-extractor');

// First get the DisplayLists data
const { findDisplayLists } = (function() {
    // We need to access findDisplayLists - let's just use extractMesh to get info
    // but also directly access the internal
    const extractor = require('./src/sldprt-extractor');
    // Can't easily access internal functions, so let's reconstruct
    
    const { parseOLE2, readStream, ensureBuffer } = require('./src/ole2-parser');
    const pako = require('pako');
    
    function rolByte(b, shift) {
        shift &= 7;
        if (shift === 0) return b;
        return ((b << shift) | (b >>> (8 - shift))) & 0xFF;
    }
    
    function decompressOpenSX(buf) {
        buf = ensureBuffer(buf);
        const key = buf[7];
        const marker = new Uint8Array([0x14, 0x00, 0x06, 0x00, 0x08, 0x00]);
        const streams = {};
        
        // Simple findAll
        function findAll(data, pattern) {
            const pos = [];
            for (let i = 0; i <= data.length - pattern.length; i++) {
                let ok = true;
                for (let j = 0; j < pattern.length; j++) {
                    if (data[i + j] !== pattern[j]) { ok = false; break; }
                }
                if (ok) pos.push(i);
            }
            return pos;
        }
        
        for (const mp of findAll(buf, marker)) {
            const si = mp - 4;
            if (si < 0 || si + 0x1E > buf.length) continue;
            const f1 = buf.readUInt32LE(si + 0x0E);
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
            if (f1 >= 65536 && csz > 0) {
                const compressed = buf.subarray(dataStart, dataEnd);
                let decompressed = null;
                try { decompressed = pako.inflateRaw(compressed); } catch (e) {}
                if (!decompressed || decompressed.length === 0) {
                    try { decompressed = pako.inflate(compressed); } catch (e) {}
                }
                if (decompressed && decompressed.length > 0 && !streams[name]) {
                    streams[name] = decompressed;
                }
            }
        }
        return streams;
    }
    
    function findDL(buf) {
        buf = ensureBuffer(buf);
        // Try old format (OLE2) first
        try {
            const ole = parseOLE2(buf);
            let dlEntry = ole.entries.find(e => e.name === 'DisplayLists' && e.type === 2);
            if (dlEntry) {
                const dlData = readStream(buf, ole.fat, dlEntry, ole.ss);
                if (dlData && dlData.length > 100) return dlData;
            }
            dlEntry = ole.entries.find(e => e.name === 'DisplayLists__Zip' && e.type === 2);
            if (dlEntry) {
                const dlData = readStream(buf, ole.fat, dlEntry, ole.ss);
                if (dlData && dlData.length > 100 && pako.brotliDecompressSync) {
                    try {
                        const decompressed = pako.brotliDecompressSync(dlData.subarray(14));
                        if (decompressed && decompressed.length > 100) return decompressed;
                    } catch (e) {}
                }
            }
        } catch (e) {}
        
        // Try new format (openswx)
        try {
            const streams = decompressOpenSX(buf);
            for (const [name, data] of Object.entries(streams)) {
                if (name.toLowerCase().includes('displaylist') && data.length > 100) {
                    const d = ensureBuffer(data);
                    if (d.readUInt32LE(0) === 1 && d.readUInt32LE(4) === 1) {
                        return data;
                    }
                }
            }
        } catch (e) {}
        return null;
    }
    
    return { findDisplayLists: findDL };
})();

const dlData = findDisplayLists(buf);
if (!dlData) {
    console.log('No DisplayLists found');
    process.exit(1);
}

// Wrap in ensureBuffer for read helpers
const dl = ensureBuffer(dlData);

console.log(`DisplayLists size: ${dl.length} bytes`);
console.log(`First 8 bytes: ${Array.from(dl.slice(0, 8)).map(b => b.toString(16).padStart(2,'0')).join(' ')}`);
console.log(`First 8 as u32: ${dl.readUInt32LE(0)} ${dl.readUInt32LE(4)}`);

// Dump the first 200 bytes
console.log('\nHex dump of first 200 bytes:');
for (let i = 0; i < 200; i += 16) {
    const hex = Array.from(dl.slice(i, Math.min(i+16, dl.length))).map(b => b.toString(16).padStart(2,'0')).join(' ');
    const ascii = Array.from(dl.slice(i, Math.min(i+16, dl.length))).map(b => b >= 32 && b < 127 ? String.fromCharCode(b) : '.').join('');
    const floats = [];
    for (let f = 0; f < 16 && i+f+3 < dl.length; f += 4) {
        floats.push(dl.readFloatLE(i+f).toFixed(3));
    }
    console.log(`${i.toString(16).padStart(4,'0')}: ${hex.padEnd(47)} ${ascii}  [${floats.join(', ')}]`);
}

// Now look for areas that look like vertex data (plausible coordinates)
console.log('\n\nScanning for plausible vertex clusters...');
let found = 0;
for (let i = 0; i < dl.length - 12; i += 4) {
    const x = dl.readFloatLE(i);
    const y = dl.readFloatLE(i + 4);
    const z = dl.readFloatLE(i + 8);
    
    // Check if this looks like a vertex (reasonable coordinates)
    if (isFinite(x) && isFinite(y) && isFinite(z) &&
        Math.abs(x) < 100 && Math.abs(y) < 100 && Math.abs(z) < 100 &&
        (Math.abs(x) > 0.0001 || Math.abs(y) > 0.0001 || Math.abs(z) > 0.0001)) {
        
        // Check if next 12 bytes also look like a vertex
        if (i + 24 <= dl.length) {
            const x2 = dl.readFloatLE(i + 12);
            const y2 = dl.readFloatLE(i + 16);
            const z2 = dl.readFloatLE(i + 20);
            if (isFinite(x2) && isFinite(y2) && isFinite(z2) &&
                Math.abs(x2) < 100 && Math.abs(y2) < 100 && Math.abs(z2) < 100) {
                if (found < 20) {
                    console.log(`  Offset ${i} (0x${i.toString(16)}): (${x.toFixed(4)}, ${y.toFixed(4)}, ${z.toFixed(4)}) -> (${x2.toFixed(4)}, ${y2.toFixed(4)}, ${z2.toFixed(4)})`);
                    found++;
                }
            }
        }
    }
}
console.log(`Total plausible vertex clusters found: ${found}`);

// Also look for the huge coordinates the parser found
console.log('\n\nLooking for extreme coordinate values (near 89129):');
for (let i = 0; i < dl.length - 4; i += 4) {
    const val = dl.readFloatLE(i);
    if (Math.abs(val - 89129) < 1) {
        console.log(`  Offset ${i} (0x${i.toString(16)}): ${val}`);
        // Show surrounding bytes
        const start = Math.max(0, i - 16);
        const end = Math.min(dl.length, i + 20);
        const hex = Array.from(dl.slice(start, end)).map(b => b.toString(16).padStart(2,'0')).join(' ');
        console.log(`    Context: ${hex}`);
        for (let f = 0; f < 36 && start+f+3 < dl.length; f += 4) {
            console.log(`    float@${start+f}: ${dl.readFloatLE(start+f)}`);
        }
    }
}
