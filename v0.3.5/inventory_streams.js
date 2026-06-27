const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const filePath = process.argv[2] || 'C:\\Users\\basha\\Desktop\\soldiworks research\\test files original\\usb hub case (ultimate test)\\USB hub case BOTTOM.SLDPRT';

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
        first32Hex: '',
        displayListsSig: false,
        hasFloats: false,
        hasTopology: false,
        hasASCII: false,
        hasFaceBlocks: false,
        hasFaceType2: false,
        patterns: []
    };

    // First 32 bytes as hex
    const first32 = data.subarray(0, Math.min(32, data.length));
    result.first32Hex = Array.from(first32).map(b => b.toString(16).padStart(2, '0')).join(' ');

    // Check DisplayLists signature [1,1]
    if (data.length >= 8) {
        const a = data.readUInt32LE(0);
        const b = data.readUInt32LE(4);
        if (a === 1 && b === 1) {
            result.displayListsSig = true;
            result.patterns.push('[1,1] DisplayLists sig');
        }
    }

    // Check for float32 vertex data
    let validFloatCount = 0;
    const maxCheck = Math.min(data.length - 3, 10000);
    for (let i = 0; i <= maxCheck - 12; i += 4) {
        const f = data.readFloatLE(i);
        if (isFinite(f) && Math.abs(f) > 0.001 && Math.abs(f) < 10000) {
            validFloatCount++;
        }
    }
    if (validFloatCount > 100) {
        result.hasFloats = true;
        result.patterns.push(`float32 vertex data (~${validFloatCount} valid floats in first ${maxCheck} bytes)`);
    }

    // Check for topology blocks [4,8,2,...]
    for (let i = 0; i <= data.length - 12; i += 4) {
        if (data.readUInt32LE(i) === 4 && data.readUInt32LE(i + 4) === 8 && data.readUInt32LE(i + 8) === 2) {
            result.hasTopology = true;
            result.patterns.push(`[4,8,2] topology block at offset 0x${i.toString(16)}`);
            break;
        }
    }

    // Check for face marker [12,100,2]
    const faceMarker = new Uint8Array([0x0c, 0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00]);
    for (let i = 0; i <= data.length - faceMarker.length; i++) {
        let match = true;
        for (let j = 0; j < faceMarker.length; j++) {
            if (data[i + j] !== faceMarker[j]) { match = false; break; }
        }
        if (match) {
            result.hasFaceBlocks = true;
            result.patterns.push(`[12,100,2] face block at offset 0x${i.toString(16)}`);
            break;
        }
    }

    // Check for u32(2) face type markers (0x02,0x00,0x00,0x00)
    let faceType2Count = 0;
    for (let i = 0; i <= data.length - 4; i += 4) {
        if (data.readUInt32LE(i) === 2) faceType2Count++;
    }
    if (faceType2Count > 5) {
        result.hasFaceType2 = true;
        result.patterns.push(`u32(2) face type markers: ${faceType2Count} occurrences`);
    }

    // Check for ASCII text
    let asciiCount = 0;
    let printableCount = 0;
    for (let i = 0; i < Math.min(data.length, 2000); i++) {
        const b = data[i];
        if (b >= 0x20 && b < 0x7F) printableCount++;
        if ((b >= 0x41 && b <= 0x5A) || (b >= 0x61 && b <= 0x7A)) asciiCount++;
    }
    if (asciiCount > 50 && printableCount > data.length * 0.3) {
        result.hasASCII = true;
        let text = '';
        for (let i = 0; i < Math.min(data.length, 200); i++) {
            const b = data[i];
            text += (b >= 0x20 && b < 0x7F) ? String.fromCharCode(b) : '.';
        }
        result.patterns.push(`ASCII text: "${text.substring(0, 120)}${text.length > 120 ? '...' : ''}"`);
    }

    // Check for unicode text patterns (UTF-16LE)
    let unicodePairs = 0;
    for (let i = 0; i < Math.min(data.length - 1, 2000); i += 2) {
        const lo = data[i];
        const hi = data[i + 1];
        if (hi === 0 && lo >= 0x20 && lo < 0x7F) unicodePairs++;
    }
    if (unicodePairs > 50) {
        result.patterns.push(`UTF-16LE text: ~${unicodePairs} printable chars in first 2000 bytes`);
    }

    return result;
}

// Sort by decompressed size (largest first)
streams.sort((a, b) => {
    const sa = a.decompressed ? a.decompressed.length : 0;
    const sb = b.decompressed ? b.decompressed.length : 0;
    return sb - sa;
});

// Print inventory table
console.log('='.repeat(140));
console.log('COMPLETE STREAM INVENTORY');
console.log('='.repeat(140));
console.log('');

const header = [
    '#'.padStart(3),
    'Name'.padEnd(32),
    'Compressed'.padStart(12),
    'Decompressed'.padStart(14),
    'First 32 bytes (hex)'.padEnd(36),
    'Patterns'.padEnd(40)
].join(' | ');
console.log(header);
console.log('-'.repeat(140));

let streamIdx = 0;
for (const s of streams) {
    streamIdx++;
    const name = s.name.substring(0, 32).padEnd(32);
    const csz = s.csz.toString().padStart(12);
    const dsz = s.decompressed ? s.decompressed.length.toString().padStart(14) : 'FAILED'.padStart(14);
    const first32 = s.decompressed ? (s.decompressed.length > 0 ? Array.from(s.decompressed.subarray(0, Math.min(16, s.decompressed.length))).map(b => b.toString(16).padStart(2, '0')).join(' ') : '(empty)') : s.error;

    let patterns = [];
    if (s.decompressed && s.decompressed.length > 0) {
        const analysis = analyzeStream(s.decompressed);
        patterns = analysis.patterns;
    } else if (s.error) {
        patterns = [`DECOMPRESS ERROR: ${s.error}`];
    } else if (s.csz === 0) {
        patterns = ['(zero compressed size)'];
    }

    console.log(`${String(streamIdx).padStart(3)} | ${name} | ${csz} | ${dsz} | ${(first32 || '(no data)').padEnd(36)} | ${patterns.join('; ')}`);
}

console.log('');
console.log('='.repeat(140));
console.log('SUMMARY');
console.log('='.repeat(140));
console.log(`Total streams found: ${streams.length}`);

let decompressedOk = 0;
let decompressedFail = 0;
let totalDecompressed = 0;
const nameMap = {};

for (const s of streams) {
    if (s.decompressed && s.decompressed.length > 0) {
        decompressedOk++;
        totalDecompressed += s.decompressed.length;
        nameMap[s.name] = (nameMap[s.name] || 0) + 1;
    } else {
        decompressedFail++;
    }
}

console.log(`Successfully decompressed: ${decompressedOk}`);
console.log(`Failed to decompress: ${decompressedFail}`);
console.log(`Total decompressed data: ${totalDecompressed.toLocaleString()} bytes`);
console.log('');

// Check for duplicate names
const dupes = Object.entries(nameMap).filter(([_, count]) => count > 1);
if (dupes.length > 0) {
    console.log('DUPLICATE STREAM NAMES:');
    for (const [name, count] of dupes) {
        console.log(`  "${name}" appears ${count} times`);
    }
    console.log('');
}

// Categorize streams
console.log('STREAM CATEGORIES:');
const categories = {
    'DisplayLists': [],
    'Vertex/Float data': [],
    'Topology': [],
    'ASCII/Text': [],
    'Face blocks': [],
    'Other': []
};

for (const s of streams) {
    if (!s.decompressed || s.decompressed.length === 0) continue;
    const analysis = analyzeStream(s.decompressed);

    if (s.name.toLowerCase().includes('displaylist') || analysis.displayListsSig) {
        categories['DisplayLists'].push(s);
    } else if (analysis.hasASCII) {
        categories['ASCII/Text'].push(s);
    } else if (analysis.hasFloats && analysis.hasFaceBlocks) {
        categories['Vertex/Float data'].push(s);
        categories['Topology'].push(s);
    } else if (analysis.hasFloats) {
        categories['Vertex/Float data'].push(s);
    } else if (analysis.hasTopology || analysis.hasFaceBlocks) {
        categories['Topology'].push(s);
    } else {
        categories['Other'].push(s);
    }
}

for (const [cat, items] of Object.entries(categories)) {
    const unique = [...new Set(items)];
    if (unique.length > 0) {
        console.log(`  ${cat}: ${unique.length} streams`);
        for (const s of unique) {
            console.log(`    - ${s.name} (${s.decompressed.length.toLocaleString()} bytes)`);
        }
    }
}
