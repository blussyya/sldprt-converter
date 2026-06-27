const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const filePath = process.argv[2] || 'C:\\Users\\basha\\Desktop\\soldiworks research\\test files original\\Helical Bevel Gear.SLDPRT';

const buf = fs.readFileSync(filePath);
console.log(`File: ${path.basename(filePath)}`);
console.log(`File size: ${buf.length} bytes (0x${buf.length.toString(16)})`);
console.log(`Key byte (pos 7): ${buf[7]}`);
console.log('');

const key = buf[7];

function rolByte(b, shift) {
    shift &= 7;
    if (shift === 0) return b;
    return ((b << shift) | (b >>> (8 - shift))) & 0xFF;
}

function findAll(pattern) {
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

const MARKER = [0x14, 0x00, 0x06, 0x00, 0x08, 0x00];
const markerPositions = findAll(MARKER);
console.log(`Found ${markerPositions.length} stream markers`);
console.log('');

const streams = [];

for (const mp of markerPositions) {
    const si = mp - 4;
    if (si < 0 || si + 0x1E > buf.length) continue;

    const f1 = buf.readUInt32LE(si + 0x0E);
    const csz = buf.readUInt32LE(si + 0x12);
    const nsz = buf.readUInt32LE(si + 0x1A);

    if (nsz > 1024 || csz > 50 * 1024 * 1024 || nsz === 0) continue;

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

    let decompressed = null;
    let error = null;

    if (csz > 0 && f1 >= 65536) {
        const compressed = buf.subarray(dataStart, dataEnd);
        try {
            decompressed = zlib.inflateRawSync(Buffer.from(compressed));
        } catch (e) {
            error = e.message;
            try {
                decompressed = zlib.inflateSync(Buffer.from(compressed));
            } catch (e2) {
                error = `${e.message} / ${e2.message}`;
            }
        }
    }

    streams.push({
        markerOffset: mp,
        si,
        f1,
        csz,
        nsz,
        name,
        dataOffset: dataStart,
        decompressed,
        error
    });
}

// Analyze each decompressed stream
function analyzeStream(data) {
    const result = {
        decompressedSize: data.length,
        first64Hex: '',
        faceMarkerCount: 0,
        topoBlockCount: 0,
        validFloatTriples: 0
    };

    // First 64 bytes as hex
    const first64 = data.subarray(0, Math.min(64, data.length));
    result.first64Hex = Array.from(first64).map(b => b.toString(16).padStart(2, '0')).join(' ');

    // Count [12,100,2] face markers: bytes 0x0c,0x00,0x00,0x00,0x64,0x00,0x00,0x00
    const faceMarker = new Uint8Array([0x0c, 0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00]);
    for (let i = 0; i <= data.length - faceMarker.length; i++) {
        let match = true;
        for (let j = 0; j < faceMarker.length; j++) {
            if (data[i + j] !== faceMarker[j]) { match = false; break; }
        }
        if (match) result.faceMarkerCount++;
    }

    // Count [4,8,2] topology blocks
    for (let i = 0; i <= data.length - 12; i += 4) {
        if (data.readUInt32LE(i) === 4 && data.readUInt32LE(i + 4) === 8 && data.readUInt32LE(i + 8) === 2) {
            result.topoBlockCount++;
        }
    }

    // Count valid float32 triples (each triple = 3 floats = 12 bytes)
    // Range: -200 to 200, all three floats in range = one valid triple
    for (let i = 0; i <= data.length - 12; i += 4) {
        const x = data.readFloatLE(i);
        const y = data.readFloatLE(i + 4);
        const z = data.readFloatLE(i + 8);
        if (isFinite(x) && isFinite(y) && isFinite(z) &&
            x >= -200 && x <= 200 &&
            y >= -200 && y <= 200 &&
            z >= -200 && z <= 200) {
            result.validFloatTriples++;
        }
    }

    return result;
}

// Sort by decompressed size (largest first)
streams.sort((a, b) => {
    const sa = a.decompressed ? a.decompressed.length : 0;
    const sb = b.decompressed ? b.decompressed.length : 0;
    return sb - sa;
});

// Print stream details
console.log('='.repeat(160));
console.log('STREAM ANALYSIS');
console.log('='.repeat(160));
console.log('');

let streamIdx = 0;
for (const s of streams) {
    streamIdx++;
    console.log(`--- Stream #${streamIdx}: "${s.name}" ---`);
    console.log(`  Compressed size:   ${s.csz.toLocaleString()} bytes`);
    if (s.decompressed && s.decompressed.length > 0) {
        const analysis = analyzeStream(s.decompressed);
        console.log(`  Decompressed size: ${analysis.decompressedSize.toLocaleString()} bytes`);
        console.log(`  First 64 bytes:    ${analysis.first64Hex}`);
        console.log(`  Face markers [12,100,2]: ${analysis.faceMarkerCount}`);
        console.log(`  Topology blocks [4,8,2]: ${analysis.topoBlockCount}`);
        console.log(`  Valid float32 triples (-200..200): ${analysis.validFloatTriples}`);
    } else if (s.error) {
        console.log(`  Decompress FAILED: ${s.error}`);
    } else if (s.csz === 0) {
        console.log(`  (zero compressed size - no data)`);
    }
    console.log('');
}

// Print summary
console.log('='.repeat(160));
console.log('SUMMARY');
console.log('='.repeat(160));
console.log(`Total streams found: ${streams.length}`);
console.log('');

let decompressedOk = 0;
let decompressedFail = 0;
let totalDecompressed = 0;

for (const s of streams) {
    if (s.decompressed && s.decompressed.length > 0) {
        decompressedOk++;
        totalDecompressed += s.decompressed.length;
    } else {
        decompressedFail++;
    }
}

console.log(`Successfully decompressed: ${decompressedOk}`);
console.log(`Failed to decompress: ${decompressedFail}`);
console.log(`Total decompressed data: ${totalDecompressed.toLocaleString()} bytes`);
console.log('');

// Highlight streams with geometry data
console.log('GEOMETRY-CONTAINING STREAMS:');
console.log('-'.repeat(80));
for (const s of streams) {
    if (!s.decompressed || s.decompressed.length === 0) continue;
    const analysis = analyzeStream(s.decompressed);
    const hasGeometry = analysis.faceMarkerCount > 0 || analysis.topoBlockCount > 0 || analysis.validFloatTriples > 10;
    if (hasGeometry) {
        console.log(`  "${s.name}"`);
        console.log(`    Size: ${analysis.decompressedSize.toLocaleString()} bytes`);
        console.log(`    Face markers: ${analysis.faceMarkerCount}, Topo blocks: ${analysis.topoBlockCount}, Float triples: ${analysis.validFloatTriples}`);
    }
}
