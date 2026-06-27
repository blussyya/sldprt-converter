const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const { extractMesh } = require('./src/sldprt-extractor.js');

const filePath = process.argv[2] || 'C:\\Users\\basha\\Desktop\\soldiworks research\\test files original\\usb hub case (ultimate test)\\USB hub case BOTTOM.SLDPRT';

const buf = fs.readFileSync(filePath);
console.log('='.repeat(100));
console.log('DEEP STREAM ANALYSIS');
console.log('='.repeat(100));
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

function findAllInBuffer(data, pattern) {
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

const MARKER = [0x14, 0x00, 0x06, 0x00, 0x08, 0x00];
const markerPositions = findAll(MARKER);
console.log(`Found ${markerPositions.length} stream markers`);

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

console.log(`Parsed ${streams.length} streams`);
console.log('');

// Print all stream names
console.log('ALL STREAM NAMES:');
for (let i = 0; i < streams.length; i++) {
    const s = streams[i];
    const dsz = s.decompressed ? s.decompressed.length : 0;
    console.log(`  [${i}] "${s.name}" compressed=${s.csz} decompressed=${dsz}`);
}
console.log('');

// ============================================================
// Helper: hex dump
// ============================================================
function hexDump(data, start, count, bytesPerLine) {
    bytesPerLine = bytesPerLine || 8;
    const lines = [];
    for (let i = 0; i < count; i += bytesPerLine) {
        const offset = start + i;
        const hex = [];
        const ascii = [];
        for (let j = 0; j < bytesPerLine && i + j < count; j++) {
            const b = data[offset + j];
            hex.push(b.toString(16).padStart(2, '0'));
            ascii.push((b >= 0x20 && b < 0x7F) ? String.fromCharCode(b) : '.');
        }
        lines.push(`  ${offset.toString(16).padStart(8, '0')}: ${hex.join(' ')}  ${ascii.join('')}`);
    }
    return lines.join('\n');
}

// ============================================================
// Helper: print u32 array
// ============================================================
function printU32Array(data, start, count, perLine) {
    perLine = perLine || 8;
    const lines = [];
    for (let i = 0; i < count; i += perLine) {
        const vals = [];
        for (let j = 0; j < perLine && i + j < count; j++) {
            const off = start + (i + j) * 4;
            if (off + 4 > data.length) break;
            vals.push(data.readUInt32LE(off));
        }
        lines.push(`  [${String((i) * 4).padStart(6)}] ${vals.map(v => String(v).padStart(10)).join(' ')}`);
    }
    return lines.join('\n');
}

// ============================================================
// Helper: find all u32(2) markers
// ============================================================
function findU32_2Markers(data) {
    const positions = [];
    for (let i = 0; i <= data.length - 4; i += 4) {
        if (data.readUInt32LE(i) === 2) positions.push(i);
    }
    return positions;
}

// ============================================================
// Helper: find [12,100,2] face markers (as u32 triplets)
// ============================================================
function findFaceMarkers(data) {
    const positions = [];
    const FACE_MARKER_U32 = [12, 100, 2];
    for (let i = 0; i <= data.length - 12; i += 4) {
        if (data.readUInt32LE(i) === 12 &&
            data.readUInt32LE(i + 4) === 100 &&
            data.readUInt32LE(i + 8) === 2) {
            positions.push(i);
        }
    }
    return positions;
}

// ============================================================
// Helper: find [4,8,2] topology blocks
// ============================================================
function findTopologyBlocks(data) {
    const positions = [];
    for (let i = 0; i <= data.length - 12; i += 4) {
        if (data.readUInt32LE(i) === 4 &&
            data.readUInt32LE(i + 4) === 8 &&
            data.readUInt32LE(i + 8) === 2) {
            positions.push(i);
        }
    }
    return positions;
}

// ============================================================
// Helper: find valid float32 sequences (triplets)
// ============================================================
function findFloatTriplets(data, startByte, endByte) {
    const results = [];
    for (let i = startByte; i <= endByte - 12; i += 4) {
        const x = data.readFloatLE(i);
        const y = data.readFloatLE(i + 4);
        const z = data.readFloatLE(i + 8);
        if (isFinite(x) && isFinite(y) && isFinite(z) &&
            Math.abs(x) >= 0.001 && Math.abs(x) < 1000 &&
            Math.abs(y) >= 0.001 && Math.abs(y) < 1000 &&
            Math.abs(z) >= 0.001 && Math.abs(z) < 1000) {
            results.push({ offset: i, x, y, z });
        }
    }
    return results;
}

// ============================================================
// Helper: extract data between consecutive markers
// ============================================================
function extractBetweenMarkers(data, markerPositions) {
    const segments = [];
    for (let i = 0; i < markerPositions.length - 1; i++) {
        const start = markerPositions[i] + 12; // after the marker [12,100,2]
        const end = markerPositions[i + 1];
        segments.push({ start, end, size: end - start });
    }
    // Last segment to end of data
    if (markerPositions.length > 0) {
        const lastStart = markerPositions[markerPositions.length - 1] + 12;
        segments.push({ start: lastStart, end: data.length, size: data.length - lastStart });
    }
    return segments;
}

// ============================================================
// Helper: full stream analysis
// ============================================================
function fullAnalysis(name, data) {
    console.log('');
    console.log('='.repeat(100));
    console.log(`STREAM: ${name} (${data.length} bytes)`);
    console.log('='.repeat(100));

    // 1. First 200 bytes as hex (8 per line)
    console.log('');
    console.log('--- First 200 bytes as hex (8 per line) ---');
    console.log(hexDump(data, 0, Math.min(200, data.length), 8));

    // 2. First 100 u32 values
    console.log('');
    console.log('--- First 100 u32 values ---');
    const u32Count = Math.min(100, Math.floor(data.length / 4));
    console.log(printU32Array(data, 0, u32Count, 8));

    // 3. Search for [4,8,2,...] topology blocks
    console.log('');
    console.log('--- [4,8,2] topology blocks ---');
    const topoBlocks = findTopologyBlocks(data);
    console.log(`Found ${topoBlocks.length} topology blocks`);
    for (let i = 0; i < Math.min(5, topoBlocks.length); i++) {
        const off = topoBlocks[i];
        console.log(`\n  Block #${i} at offset 0x${off.toString(16)} (${off}):`);
        const contextStart = Math.max(0, off - 16);
        const contextEnd = Math.min(data.length, off + 80);
        console.log(hexDump(data, contextStart, contextEnd - contextStart, 8));
        // Also show as u32
        const u32Count2 = Math.min(20, Math.floor((contextEnd - off) / 4));
        console.log('  u32 values:');
        console.log(printU32Array(data, off, u32Count2, 8));
    }

    // 4. Search for [12,100,2] face markers
    console.log('');
    console.log('--- [12,100,2] face markers ---');
    const faceMarkers = findFaceMarkers(data);
    console.log(`Found ${faceMarkers.length} face markers`);
    for (let i = 0; i < Math.min(5, faceMarkers.length); i++) {
        const off = faceMarkers[i];
        console.log(`\n  Face marker #${i} at offset 0x${off.toString(16)} (${off}):`);
        const contextStart = Math.max(0, off - 40);
        const contextEnd = Math.min(data.length, off + 40);
        console.log(hexDump(data, contextStart, contextEnd - contextStart, 8));
        // Also show the u32 values around it
        const preOff = Math.max(0, off - 16);
        const postEnd = Math.min(data.length, off + 32);
        const u32Count3 = Math.floor((postEnd - preOff) / 4);
        console.log('  u32 context:');
        console.log(printU32Array(data, preOff, u32Count3, 8));
    }

    // 5. Search for float32 sequences
    console.log('');
    console.log('--- Float32 triplet search (valid range 0.001-1000) ---');
    const floatTriplets = findFloatTriplets(data, 0, data.length);
    console.log(`Found ${floatTriplets.length} valid float32 triplets`);
    if (floatTriplets.length > 0) {
        console.log('First 20:');
        for (let i = 0; i < Math.min(20, floatTriplets.length); i++) {
            const ft = floatTriplets[i];
            console.log(`  [0x${ft.offset.toString(16)}] (${ft.x.toFixed(4)}, ${ft.y.toFixed(4)}, ${ft.z.toFixed(4)})`);
        }
    }

    // 6. Count total u32(2) markers
    console.log('');
    console.log('--- u32(2) marker count ---');
    const u32_2Markers = findU32_2Markers(data);
    console.log(`Found ${u32_2Markers.length} u32(2) values at 4-byte aligned positions`);
    // Also at every byte position
    let u32_2Unaligned = 0;
    for (let i = 0; i <= data.length - 4; i++) {
        if (data.readUInt32LE(i) === 2) u32_2Unaligned++;
    }
    console.log(`Found ${u32_2Unaligned} u32(2) values at all byte positions`);

    // 7. Repeating structural patterns
    console.log('');
    console.log('--- Repeating structural patterns ---');
    // Look for repeated u32 sequences
    const patternMap = new Map();
    for (let i = 0; i <= data.length - 16; i += 4) {
        const key = `${data.readUInt32LE(i)},${data.readUInt32LE(i + 4)},${data.readUInt32LE(i + 8)},${data.readUInt32LE(i + 12)}`;
        if (!patternMap.has(key)) patternMap.set(key, []);
        patternMap.get(key).push(i);
    }
    const repeated = [];
    for (const [key, positions] of patternMap) {
        if (positions.length >= 3) {
            repeated.push({ key, count: positions.length, positions: positions.slice(0, 5) });
        }
    }
    repeated.sort((a, b) => b.count - a.count);
    console.log(`Found ${repeated.length} patterns repeated 3+ times:`);
    for (let i = 0; i < Math.min(20, repeated.length); i++) {
        const p = repeated[i];
        console.log(`  [${p.key}] x${p.count} at offsets: ${p.positions.map(o => '0x' + o.toString(16)).join(', ')}`);
    }

    // 8. Check header
    console.log('');
    console.log('--- Header analysis ---');
    if (data.length >= 8) {
        const a = data.readUInt32LE(0);
        const b = data.readUInt32LE(4);
        console.log(`First two u32s: [${a}, ${b}]`);
        if (a === 1 && b === 1) {
            console.log('  -> Matches DisplayLists [1,1] signature');
        } else {
            console.log('  -> Does NOT match [1,1] signature');
        }
    }

    // 9. Byte distribution analysis
    console.log('');
    console.log('--- Byte value distribution ---');
    const byteHist = new Uint32Array(256);
    for (let i = 0; i < data.length; i++) byteHist[data[i]]++;
    const sorted = [];
    for (let i = 0; i < 256; i++) {
        if (byteHist[i] > 0) sorted.push({ val: i, count: byteHist[i] });
    }
    sorted.sort((a, b) => b.count - a.count);
    console.log('Top 20 byte values:');
    for (let i = 0; i < Math.min(20, sorted.length); i++) {
        const pct = (sorted[i].count / data.length * 100).toFixed(1);
        console.log(`  0x${sorted[i].val.toString(16).padStart(2, '0')} (${sorted[i].val.toString().padStart(3)}): ${sorted[i].count} (${pct}%)`);
    }

    return { faceMarkers, topoBlocks, floatTriplets, u32_2Markers };
}

// ============================================================
// ANALYSIS TARGETS
// ============================================================

const targetStreams = [
    'Contents/Config-0-ResolvedFeatures',
    'Contents/Config-0',
    'Contents/Config-0-Partition',
    'Contents/Config-0-ModelHeader'
];

const streamData = {};

for (const target of targetStreams) {
    // Find the LARGEST decompressed version (there may be duplicate names)
    const candidates = streams.filter(s => s.name === target && s.decompressed && s.decompressed.length > 0);
    if (candidates.length > 0) {
        candidates.sort((a, b) => b.decompressed.length - a.decompressed.length);
        streamData[target] = candidates[0].decompressed;
        console.log(`Found "${target}": ${candidates[0].decompressed.length} bytes (${candidates.length} candidates)`);
    } else {
        console.log(`WARNING: Stream "${target}" not found or failed to decompress`);
    }
}

// Also find DisplayLists - largest decompressed version
const displayListsCandidates = streams.filter(s => s.name.toLowerCase().includes('displaylist') && s.decompressed && s.decompressed.length > 100);
displayListsCandidates.sort((a, b) => b.decompressed.length - a.decompressed.length);
const displayListsStream = displayListsCandidates.length > 0 ? displayListsCandidates[0] : null;
if (displayListsStream) {
    streamData['DisplayLists'] = displayListsStream.decompressed;
    console.log(`Found DisplayLists: ${displayListsStream.decompressed.length} bytes`);
} else {
    console.log('WARNING: DisplayLists not found');
}

// ============================================================
// ANALYZE EACH TARGET STREAM
// ============================================================

const analysisResults = {};

for (const target of targetStreams) {
    if (streamData[target]) {
        analysisResults[target] = fullAnalysis(target, streamData[target]);
    }
}

// ============================================================
// SPECIAL: ModelHeader as UTF-16LE text
// ============================================================
if (streamData['Contents/Config-0-ModelHeader']) {
    console.log('');
    console.log('='.repeat(100));
    console.log('CONTENTS/CONFIG-0-MODELHEADER AS UTF-16LE TEXT');
    console.log('='.repeat(100));
    const data = streamData['Contents/Config-0-ModelHeader'];
    let text = '';
    for (let i = 0; i < data.length - 1; i += 2) {
        const code = data.readUInt16LE(i);
        if (code === 0) break;
        text += String.fromCharCode(code);
    }
    console.log(`Length: ${text.length} characters`);
    console.log('--- Full text ---');
    console.log(text);

    // Also show as hex for reference
    console.log('');
    console.log('--- Full hex dump ---');
    console.log(hexDump(data, 0, data.length, 16));
}

// ============================================================
// SPECIAL: DisplayLists face marker analysis
// ============================================================
if (streamData['DisplayLists']) {
    console.log('');
    console.log('='.repeat(100));
    console.log('DISPLAYLISTS FACE MARKER ANALYSIS');
    console.log('='.repeat(100));

    const dlData = streamData['DisplayLists'];
    const dlFaceMarkers = findFaceMarkers(dlData);
    console.log(`Total [12,100,2] markers in DisplayLists: ${dlFaceMarkers.length}`);

    // Now run the extractor to see how many faces it finds
    const mesh = extractMesh(buf);
    console.log(`Faces found by extractor: ${mesh.faces.length}`);
    console.log(`Vertices found by extractor: ${mesh.vertices.length}`);

    // Face vertex counts
    const faceVertCounts = mesh.faces.map(f => f.length);
    console.log(`Face vertex counts: ${faceVertCounts.join(', ')}`);
    console.log(`  min=${Math.min(...faceVertCounts)}, max=${Math.max(...faceVertCounts)}, total=${faceVertCounts.reduce((a, b) => a + b, 0)}`);

    if (dlFaceMarkers.length > mesh.faces.length) {
        console.log(`\n*** There are ${dlFaceMarkers.length - mesh.faces.length} MORE face markers than faces! ***`);
        console.log('Analyzing what happens to the extras...');

        // Try to parse each marker like the extractor does
        const MAX_C = 100000.0;
        let validCount = 0;
        let invalidCount = 0;
        const invalidReasons = {};

        for (const mp of dlFaceMarkers) {
            if (mp < 4) { invalidReasons['mp < 4'] = (invalidReasons['mp < 4'] || 0) + 1; invalidCount++; continue; }
            const edgeCount = dlData.readUInt32LE(mp - 4);
            if (edgeCount < 1 || edgeCount > 500) { invalidReasons['edgeCount invalid'] = (invalidReasons['edgeCount invalid'] || 0) + 1; invalidCount++; continue; }
            const faceType = dlData.readUInt32LE(mp + 8);
            if (faceType !== 2) { invalidReasons['faceType != 2'] = (invalidReasons['faceType != 2'] || 0) + 1; invalidCount++; continue; }
            const vertexCount = dlData.readUInt32LE(mp + 12);
            if (vertexCount < 3 || vertexCount > 5000) { invalidReasons['vertexCount invalid'] = (invalidReasons['vertexCount invalid'] || 0) + 1; invalidCount++; continue; }

            const vertStart = mp + 16;
            if (vertStart + vertexCount * 12 > dlData.length) { invalidReasons['vertices overflow'] = (invalidReasons['vertices overflow'] || 0) + 1; invalidCount++; continue; }

            // Validate vertices
            let valid = true;
            for (let i = 0; i < vertexCount; i++) {
                const off = vertStart + i * 12;
                const x = dlData.readFloatLE(off);
                const y = dlData.readFloatLE(off + 4);
                const z = dlData.readFloatLE(off + 8);
                if (!isFinite(x) || !isFinite(y) || !isFinite(z)) { valid = false; break; }
                if (Math.abs(x) > MAX_C || Math.abs(y) > MAX_C || Math.abs(z) > MAX_C) { valid = false; break; }
            }
            if (!valid) { invalidReasons['invalid vertices'] = (invalidReasons['invalid vertices'] || 0) + 1; invalidCount++; continue; }

            validCount++;
        }

        console.log(`  Valid face records: ${validCount}`);
        console.log(`  Invalid face records: ${invalidCount}`);
        console.log(`  Invalid reasons:`, JSON.stringify(invalidReasons, null, 2));
    } else if (dlFaceMarkers.length === mesh.faces.length) {
        console.log('\n*** Face markers match face count exactly ***');
    } else {
        console.log(`\n*** Fewer face markers (${dlFaceMarkers.length}) than faces (${mesh.faces.length}) ***`);
        console.log('The extra faces likely come from normal-based splitting of mixed faces.');
    }

    // Dump all marker positions with their data
    console.log('');
    console.log('--- All face marker details ---');
    const MAX_C = 100000.0;
    for (let i = 0; i < dlFaceMarkers.length; i++) {
        const mp = dlFaceMarkers[i];
        const edgeCount = mp >= 4 ? dlData.readUInt32LE(mp - 4) : 0;
        const faceType = dlData.readUInt32LE(mp + 8);
        const vertexCount = dlData.readUInt32LE(mp + 12);
        const vertStart = mp + 16;

        let valid = true;
        if (mp < 4 || edgeCount < 1 || edgeCount > 500 || faceType !== 2 ||
            vertexCount < 3 || vertexCount > 5000 || vertStart + vertexCount * 12 > dlData.length) {
            valid = false;
        } else {
            for (let j = 0; j < vertexCount; j++) {
                const off = vertStart + j * 12;
                const x = dlData.readFloatLE(off);
                const y = dlData.readFloatLE(off + 4);
                const z = dlData.readFloatLE(off + 8);
                if (!isFinite(x) || !isFinite(y) || !isFinite(z)) { valid = false; break; }
                if (Math.abs(x) > MAX_C || Math.abs(y) > MAX_C || Math.abs(z) > MAX_C) { valid = false; break; }
            }
        }

        console.log(`  [${i}] offset=0x${mp.toString(16)} ec=${edgeCount} type=${faceType} vc=${vertexCount} valid=${valid}`);
    }
}

// ============================================================
// SPECIAL: ResolvedFeatures - extract data between [12,100,2] markers
// ============================================================
if (streamData['Contents/Config-0-ResolvedFeatures']) {
    console.log('');
    console.log('='.repeat(100));
    console.log('RESOLVEDFEATURES: DATA BETWEEN [12,100,2] MARKERS');
    console.log('='.repeat(100));

    const rfData = streamData['Contents/Config-0-ResolvedFeatures'];
    const rfFaceMarkers = findFaceMarkers(rfData);
    console.log(`Found ${rfFaceMarkers.length} face markers in ResolvedFeatures`);

    if (rfFaceMarkers.length > 0) {
        const segments = extractBetweenMarkers(rfData, rfFaceMarkers);
        console.log(`\n${segments.length} segments between markers:`);
        console.log('');
        console.log('Segment sizes:');
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            console.log(`  Segment ${i}: ${seg.size} bytes (0x${seg.size.toString(16)}) [0x${seg.start.toString(16)}-0x${seg.end.toString(16)}]`);
        }

        const totalSegBytes = segments.reduce((a, s) => a + s.size, 0);
        console.log(`\nTotal bytes between markers: ${totalSegBytes}`);
        console.log(`Average segment size: ${(totalSegBytes / segments.length).toFixed(1)}`);

        // For each segment, check if it could be face data
        console.log('');
        console.log('--- Segment content analysis ---');
        for (let i = 0; i < Math.min(10, segments.length); i++) {
            const seg = segments[i];
            console.log(`\n  Segment ${i} (${seg.size} bytes):`);
            if (seg.size >= 16) {
                console.log(hexDump(rfData, seg.start, Math.min(64, seg.size), 8));

                // Try to interpret as vertex data
                const possibleVertexCount = Math.floor(seg.size / 12);
                if (possibleVertexCount >= 1) {
                    let validVerts = 0;
                    for (let v = 0; v < Math.min(possibleVertexCount, 10); v++) {
                        const off = seg.start + v * 12;
                        const x = rfData.readFloatLE(off);
                        const y = rfData.readFloatLE(off + 4);
                        const z = rfData.readFloatLE(off + 8);
                        if (isFinite(x) && isFinite(y) && isFinite(z) &&
                            Math.abs(x) < 100000 && Math.abs(y) < 100000 && Math.abs(z) < 100000) {
                            validVerts++;
                        }
                    }
                    console.log(`  Possible vertex count: ${possibleVertexCount}, first 10 valid: ${validVerts}`);
                }

                // Also check as u32 sequence
                const u32Count = Math.floor(seg.size / 4);
                const firstU32s = [];
                for (let u = 0; u < Math.min(16, u32Count); u++) {
                    firstU32s.push(rfData.readUInt32LE(seg.start + u * 4));
                }
                console.log(`  First u32s: [${firstU32s.join(', ')}]`);
            } else {
                console.log(hexDump(rfData, seg.start, seg.size, 8));
            }
        }

        // Compare with face vertex counts from the extractor
        if (mesh && mesh.faces.length > 0) {
            console.log('');
            console.log('--- Comparison with extracted face vertex counts ---');
            console.log(`ResolvedFeatures face markers: ${rfFaceMarkers.length}`);
            console.log(`Extracted faces: ${mesh.faces.length}`);
            const extFaceVertCounts = mesh.faces.map(f => f.length);
            console.log(`Extracted face vertex counts: ${extFaceVertCounts.join(', ')}`);

            // Try to match segments to faces
            if (rfFaceMarkers.length === mesh.faces.length) {
                console.log('\n*** 1:1 MATCH! Segment count equals face count ***');
                for (let i = 0; i < segments.length; i++) {
                    const seg = segments[i];
                    const faceVC = i < extFaceVertCounts.length ? extFaceVertCounts[i] : 0;
                    const expectedBytes = faceVC * 12;
                    console.log(`  Face ${i}: segment=${seg.size} bytes, faceVertCount=${faceVC}, expectedVertexBytes=${expectedBytes}, match=${seg.size === expectedBytes}`);
                }
            } else {
                console.log('\n*** MISMATCH: Segment count does not equal face count ***');
                console.log('Attempting to match by size...');
                // For each face, check if any segment size matches vertex count * 12
                for (let fi = 0; fi < Math.min(20, extFaceVertCounts.length); fi++) {
                    const vc = extFaceVertCounts[fi];
                    const expected = vc * 12;
                    const matchingSegIdx = segments.findIndex(s => s.size === expected);
                    console.log(`  Face ${fi} (vc=${vc}, expected=${expected} bytes): ${matchingSegIdx >= 0 ? 'MATCH at segment ' + matchingSegIdx : 'NO MATCH'}`);
                }
            }
        }
    }
}

// ============================================================
// SPECIAL: Partition stream vertex array analysis
// ============================================================
if (streamData['Contents/Config-0-Partition']) {
    console.log('');
    console.log('='.repeat(100));
    console.log('PARTITION STREAM: VERTEX ARRAY ANALYSIS');
    console.log('='.repeat(100));

    const partData = streamData['Contents/Config-0-Partition'];

    // Count valid float32 triples in different ranges
    console.log('Scanning for float32 vertex data...');

    // Check entire stream for runs of valid floats
    let currentRun = 0;
    let maxRun = 0;
    let runStart = 0;
    let bestRunStart = 0;
    let bestRunLength = 0;

    for (let i = 0; i <= partData.length - 12; i += 12) {
        const x = partData.readFloatLE(i);
        const y = partData.readFloatLE(i + 4);
        const z = partData.readFloatLE(i + 8);
        if (isFinite(x) && isFinite(y) && isFinite(z) &&
            Math.abs(x) < 100000 && Math.abs(y) < 100000 && Math.abs(z) < 100000 &&
            (Math.abs(x) > 0.0001 || Math.abs(y) > 0.0001 || Math.abs(z) > 0.0001)) {
            if (currentRun === 0) runStart = i;
            currentRun++;
            if (currentRun > maxRun) {
                maxRun = currentRun;
                bestRunStart = runStart;
                bestRunLength = currentRun;
            }
        } else {
            currentRun = 0;
        }
    }

    console.log(`Longest run of valid float32 triples: ${maxRun} vertices (${maxRun * 12} bytes)`);
    console.log(`  Starting at offset: 0x${bestRunStart.toString(16)} (${bestRunStart})`);

    if (maxRun > 0) {
        console.log(`\nFirst 20 vertices of best run:`);
        for (let i = 0; i < Math.min(20, bestRunLength); i++) {
            const off = bestRunStart + i * 12;
            const x = partData.readFloatLE(off);
            const y = partData.readFloatLE(off + 4);
            const z = partData.readFloatLE(off + 8);
            console.log(`  [${i}] (${x.toFixed(4)}, ${y.toFixed(4)}, ${z.toFixed(4)})`);
        }

        console.log(`\nLast 10 vertices of best run:`);
        for (let i = Math.max(0, bestRunLength - 10); i < bestRunLength; i++) {
            const off = bestRunStart + i * 12;
            const x = partData.readFloatLE(off);
            const y = partData.readFloatLE(off + 4);
            const z = partData.readFloatLE(off + 8);
            console.log(`  [${i}] (${x.toFixed(4)}, ${y.toFixed(4)}, ${z.toFixed(4)})`);
        }
    }

    // Also check total valid floats
    let totalValidFloats = 0;
    for (let i = 0; i <= partData.length - 4; i += 4) {
        const f = partData.readFloatLE(i);
        if (isFinite(f) && Math.abs(f) < 100000 && Math.abs(f) > 0.0001) totalValidFloats++;
    }
    console.log(`\nTotal valid float32 values in stream: ${totalValidFloats}`);
    console.log(`  As triples: ${Math.floor(totalValidFloats / 3)}`);
}

console.log('');
console.log('='.repeat(100));
console.log('ANALYSIS COMPLETE');
console.log('='.repeat(100));
