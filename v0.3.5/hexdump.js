const fs = require('fs');
const { _extractModernSurfaces, _ensureBuffer, _findAll } = require('./src/sldprt-extractor.js');

// We need to get the decompressed DisplayLists data
// Let me look at how extractMesh works to get the raw decompressed buffer
const path = require('path');

// Replicate the extraction pipeline to get raw decompressed data
function getDecompressedData(filepath) {
    const fileData = fs.readFileSync(filepath);
    const buf = _ensureBuffer(fileData);

    // Find DisplayLists stream
    const streamSig = Buffer.from([0x3c, 0x3c, 0x3c, 0x20, 0x44, 0x69, 0x73, 0x70]);
    let streamStart = -1;
    for (let i = 0; i < buf.length - 16; i++) {
        if (buf[i] === 0x3c && buf[i+1] === 0x3c && buf[i+2] === 0x3c && buf[i+3] === 0x20 &&
            buf[i+4] === 0x44 && buf[i+5] === 0x69 && buf[i+6] === 0x73 && buf[i+7] === 0x70) {
            streamStart = i;
            break;
        }
    }
    if (streamStart < 0) {
        // Try looking for the raw marker in the file
        console.log('No DisplayLists stream found, searching raw file for markers...');
        return buf;
    }

    // Find the end of the header region and the compressed data
    // The stream format: "<<< DisplayLists" header, then compressed data follows
    // We need to find where the compressed data starts
    let headerEnd = streamStart;
    for (let i = streamStart; i < Math.min(streamStart + 200, buf.length - 4); i++) {
        if (buf[i] === 0x0c && buf[i+1] === 0x00 && buf[i+2] === 0x00 && buf[i+3] === 0x00 &&
            buf[i+4] === 0x64 && buf[i+5] === 0x00 && buf[i+6] === 0x00 && buf[i+7] === 0x00) {
            headerEnd = i;
            break;
        }
    }

    // Look for zlib-compressed data (0x78 0x9C or 0x78 0x01 or 0x78 0xDA)
    let zlibStart = -1;
    for (let i = streamStart; i < Math.min(streamStart + 500, buf.length - 2); i++) {
        if (buf[i] === 0x78 && (buf[i+1] === 0x9C || buf[i+1] === 0x01 || buf[i+1] === 0xDA)) {
            zlibStart = i;
            break;
        }
    }

    console.log('streamStart:', streamStart, '(0x' + streamStart.toString(16) + ')');
    console.log('zlibStart:', zlibStart, '(0x' + (zlibStart >= 0 ? zlibStart.toString(16) : 'N/A') + ')');

    if (zlibStart < 0) {
        console.log('No zlib data found, returning raw buffer');
        return buf;
    }

    const zlib = require('zlib');
    try {
        const compressed = buf.slice(zlibStart);
        const decompressed = zlib.inflateRawSync(compressed);
        console.log('Decompressed:', decompressed.length, 'bytes');
        return decompressed;
    } catch(e) {
        console.log('Decompression failed:', e.message);
        return buf;
    }
}

const data = getDecompressedData('C:\\Users\\basha\\Desktop\\soldiworks research\\test files original\\Helical Bevel Gear.SLDPRT');

// Search for markers in the decompressed data
const MARKER = new Uint8Array([0x0c, 0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00]);
const markerPositions = _findAll(data, MARKER);
console.log('Marker positions in decompressed data:', markerPositions.length);

const MAX_C = 100000.0;
let faceIdx = 0;
const allFaces = [];

for (const mp of markerPositions) {
    if (mp < 4) continue;
    const edgeCount = data.readUInt32LE(mp - 4);
    if (edgeCount < 1 || edgeCount > 1000) continue;
    const faceType = data.readUInt32LE(mp + 8);
    if (faceType !== 2) continue;
    const vertexCount = data.readUInt32LE(mp + 12);
    if (vertexCount < 3 || vertexCount > 5000) continue;

    const vertStart = mp + 16;
    if (vertStart + vertexCount * 12 > data.length) continue;

    let valid = true;
    for (let i = 0; i < vertexCount; i++) {
        const off = vertStart + i * 12;
        const x = data.readFloatLE(off);
        const y = data.readFloatLE(off + 4);
        const z = data.readFloatLE(off + 8);
        if (!isFinite(x) || !isFinite(y) || !isFinite(z)) { valid = false; break; }
        if (Math.abs(x) > MAX_C || Math.abs(y) > MAX_C || Math.abs(z) > MAX_C) { valid = false; break; }
    }
    if (!valid) continue;

    allFaces.push({ faceIdx, mp, edgeCount, vertexCount, vertStart });
    faceIdx++;
}

console.log('Valid faces:', faceIdx);
console.log('');

// Dump topology for ALL faces
for (const face of allFaces) {
    const fi = face.faceIdx;
    const mp = face.mp;
    const edgeCount = face.edgeCount;
    const vertexCount = face.vertexCount;
    const vertStart = face.vertStart;
    const vertEnd = vertStart + vertexCount * 12;
    const normalsStart = vertEnd + 16;
    const topoStart = normalsStart + vertexCount * 12;

    console.log('='.repeat(80));
    console.log('Face #' + fi + ': edgeCount=' + edgeCount + ', vertexCount=' + vertexCount);
    console.log('  mp=0x' + mp.toString(16) + ', vertStart=0x' + vertStart.toString(16));
    console.log('  vertEnd=0x' + vertEnd.toString(16) + ', topoStart=0x' + topoStart.toString(16));

    // Dump gap marker at vertEnd
    var gapHex = [];
    for (var i = 0; i < 16 && vertEnd + i < data.length; i++) {
        gapHex.push(data[vertEnd + i].toString(16).padStart(2, '0'));
    }
    console.log('  Gap marker: ' + gapHex.join(' '));

    // Dump topology u32s
    var topoU32s = [];
    for (var i = 0; i < 80; i++) {
        var off = topoStart + i * 4;
        if (off + 4 > data.length) break;
        topoU32s.push(data.readUInt32LE(off));
    }

    // Print first 40 values
    var count = Math.min(topoU32s.length, 40);
    for (var row = 0; row < count; row += 8) {
        var slice = topoU32s.slice(row, Math.min(row + 8, count));
        var hexParts = [];
        var decParts = [];
        for (var j = 0; j < slice.length; j++) {
            hexParts.push(slice[j].toString(16).padStart(8, '0'));
            decParts.push(String(slice[j]).padStart(8));
        }
        console.log('  [' + String(row * 4).padStart(3) + '] hex: ' + hexParts.join(' '));
        console.log('        dec: ' + decParts.join(' '));
    }

    // Analysis: try different slicing interpretations
    console.log('  --- Analysis ---');

    // Test 1: skip [4,8,2] header, read remaining as loop vertex counts
    if (topoU32s[0] === 4 && topoU32s[1] === 8 && topoU32s[2] === 2) {
        var rem = vertexCount;
        var loops = [];
        for (var i = 3; i < topoU32s.length && rem > 0; i++) {
            var v = topoU32s[i];
            if (v >= 3 && v <= rem) { loops.push(v); rem -= v; }
            else break;
        }
        if (rem === 0 && loops.length >= 2) {
            console.log('  TEST1 [4,8,2]+counts: ' + loops.length + ' loops: ' + loops.join('+') + ' = ' + vertexCount + ' **EXACT**');
        } else {
            console.log('  TEST1 [4,8,2]+counts: remaining=' + rem + ', got ' + loops.length + ' values: ' + loops.join('+'));
        }
    }

    // Test 2: first value after [4,8,2] is numLoops, then that many counts
    if (topoU32s[0] === 4 && topoU32s[1] === 8 && topoU32s[2] === 2) {
        var numLoops = topoU32s[3];
        if (numLoops >= 1 && numLoops <= 50) {
            var sum2 = 0;
            var loops2 = [];
            for (var i = 4; i < 4 + numLoops && i < topoU32s.length; i++) {
                loops2.push(topoU32s[i]);
                sum2 += topoU32s[i];
            }
            if (sum2 === vertexCount && loops2.length === numLoops) {
                console.log('  TEST2 numLoops+counts: ' + numLoops + ' loops: ' + loops2.join('+') + ' = ' + sum2 + ' **EXACT**');
            } else {
                console.log('  TEST2 numLoops=' + numLoops + ': sum=' + sum2 + ', count=' + loops2.length + ', vals=' + loops2.join(','));
            }
        }
    }

    // Test 3: Maybe edgeCount encodes number of boundary segments
    // Try reading edgeCount values from position 3
    var sum3 = 0;
    var loops3 = [];
    for (var i = 3; i < 3 + edgeCount && i < topoU32s.length; i++) {
        var v = topoU32s[i];
        if (v >= 3 && v <= vertexCount) { loops3.push(v); sum3 += v; }
        else break;
    }
    if (sum3 === vertexCount && loops3.length >= 2) {
        console.log('  TEST3 edgeCount values: ' + loops3.length + ' loops: ' + loops3.join('+') + ' = ' + sum3 + ' **EXACT**');
    } else {
        console.log('  TEST3 edgeCount(' + edgeCount + ') values: sum=' + sum3 + ', got ' + loops3.length);
    }

    console.log('');
}
