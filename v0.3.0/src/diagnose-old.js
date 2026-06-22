#!/usr/bin/env node
/**
 * Diagnostic script for older SolidWorks SLDPRT files.
 * Examines raw bytes, OLE2 structure, and searches for mesh data.
 */

const fs = require('fs');
const path = require('path');
const { parseOLE2, readStream, ensureBuffer } = require('./ole2-parser.js');

function hex(buf, offset, len) {
    const bytes = [];
    for (let i = offset; i < offset + len && i < buf.length; i++) {
        bytes.push(buf[i].toString(16).padStart(2, '0').toUpperCase());
    }
    return bytes.join(' ');
}

function isPrintable(b) {
    return b >= 32 && b < 127;
}

function asciiPreview(buf, offset, len) {
    let s = '';
    for (let i = offset; i < offset + len && i < buf.length; i++) {
        s += isPrintable(buf[i]) ? String.fromCharCode(buf[i]) : '.';
    }
    return s;
}

function searchForPatterns(data, label) {
    const results = [];

    // Search for common patterns related to mesh data
    const patterns = [
        { name: 'DisplayLists', pattern: Buffer.from('DisplayLists', 'utf8') },
        { name: 'DisplayLists__Zip', pattern: Buffer.from('DisplayLists__Zip', 'utf8') },
        { name: 'Display', pattern: Buffer.from('Display', 'utf8') },
        { name: 'TriStrips', pattern: Buffer.from('TriStrips', 'utf8') },
        { name: 'FaceData', pattern: Buffer.from('FaceData', 'utf8') },
        { name: 'VertexData', pattern: Buffer.from('VertexData', 'utf8') },
        { name: 'Mesh', pattern: Buffer.from('Mesh', 'utf8') },
        { name: 'Body', pattern: Buffer.from('Body', 'utf8') },
        { name: 'Geometry', pattern: Buffer.from('Geometry', 'utf8') },
        { name: 'Tessellation', pattern: Buffer.from('Tessellation', 'utf8') },
        { name: 'Surface', pattern: Buffer.from('Surface', 'utf8') },
        { name: 'Solid', pattern: Buffer.from('Solid', 'utf8') },
        { name: 'BodyFaces', pattern: Buffer.from('BodyFaces', 'utf8') },
        { name: 'BodyVertices', pattern: Buffer.from('BodyVertices', 'utf8') },
    ];

    for (const { name, pattern } of patterns) {
        const positions = [];
        for (let i = 0; i <= data.length - pattern.length; i++) {
            let ok = true;
            for (let j = 0; j < pattern.length; j++) {
                if (data[i + j] !== pattern[j]) { ok = false; break; }
            }
            if (ok) positions.push(i);
        }
        if (positions.length > 0) {
            results.push({ name, positions });
        }
    }

    // Check for float32 sequences that look like vertex data
    const floatClusters = [];
    for (let i = 0; i <= data.length - 12; i += 4) {
        const x = data.readFloatLE ? data.readFloatLE(i) : new DataView(data.buffer, data.byteOffset, data.byteLength).getFloat32(i, true);
        const y = data.readFloatLE ? data.readFloatLE(i + 4) : new DataView(data.buffer, data.byteOffset, data.byteLength).getFloat32(i + 4, true);
        const z = data.readFloatLE ? data.readFloatLE(i + 8) : new DataView(data.buffer, data.byteOffset, data.byteLength).getFloat32(i + 8, true);

        if (isFinite(x) && isFinite(y) && isFinite(z) &&
            Math.abs(x) > 0.001 && Math.abs(x) < 10000 &&
            Math.abs(y) > 0.001 && Math.abs(y) < 10000 &&
            Math.abs(z) > 0.001 && Math.abs(z) < 10000) {
            floatClusters.push({ offset: i, x, y, z });
        }
    }

    return { stringPatterns: results, floatClusters: floatClusters.slice(0, 50) };
}

function diagnoseFile(filePath) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`FILE: ${path.basename(filePath)}`);
    console.log(`${'='.repeat(80)}`);

    const buf = fs.readFileSync(filePath);
    const size = buf.length;
    console.log(`Size: ${size} bytes (${(size / 1024).toFixed(1)} KB)`);

    // Show first 64 bytes in hex
    console.log(`\nFirst 64 bytes (hex):`);
    for (let row = 0; row < 64; row += 16) {
        const hexStr = hex(buf, row, 16);
        const ascii = asciiPreview(buf, row, 16);
        console.log(`  ${row.toString(16).padStart(4, '0')}: ${hexStr}  |${ascii}|`);
    }

    // Check OLE2 signature
    const isOLE2 = buf[0] === 0xD0 && buf[1] === 0xCF && buf[2] === 0x11 && buf[3] === 0xE0;
    console.log(`\nOLE2 signature: ${isOLE2 ? 'YES (D0 CF 11 E0)' : 'NO'}`);

    if (isOLE2) {
        console.log(`\n--- OLE2 Structure ---`);
        try {
            const ole = parseOLE2(buf);
            console.log(`Sector size: ${ole.ss} bytes`);
            console.log(`FAT entries: ${ole.fat.length}`);
            console.log(`Directory entries: ${ole.entries.length}`);

            console.log(`\nStreams found:`);
            for (const entry of ole.entries) {
                const typeStr = entry.type === 2 ? 'Stream' : entry.type === 1 ? 'Storage' : `Type${entry.type}`;
                console.log(`  "${entry.name}" (${typeStr}) - ${entry.size} bytes, startSector=${entry.startSector}`);

                // If it's a stream, search for patterns in it
                if (entry.type === 2 && entry.size > 0) {
                    try {
                        const streamData = readStream(buf, ole.fat, entry, ole.ss);
                        if (streamData && streamData.length > 0) {
                            console.log(`    Stream data: ${streamData.length} bytes read`);

                            // Search for patterns
                            const findings = searchForPatterns(streamData, entry.name);
                            if (findings.stringPatterns.length > 0) {
                                console.log(`    String patterns found:`);
                                for (const sp of findings.stringPatterns) {
                                    console.log(`      "${sp.name}" at positions: ${sp.positions.slice(0, 5).join(', ')}${sp.positions.length > 5 ? '...' : ''}`);
                                }
                            }
                            if (findings.floatClusters.length > 0) {
                                console.log(`    Float clusters (vertex-like data): ${findings.floatClusters.length} candidates`);
                                for (const fc of findings.floatClusters.slice(0, 5)) {
                                    console.log(`      offset=0x${fc.offset.toString(16)}: (${fc.x.toFixed(4)}, ${fc.y.toFixed(4)}, ${fc.z.toFixed(4)})`);
                                }
                            }

                            // Show first 128 bytes as hex preview
                            console.log(`    First 128 bytes (hex):`);
                            for (let row = 0; row < Math.min(128, streamData.length); row += 16) {
                                const hexStr = hex(streamData, row, 16);
                                const ascii = asciiPreview(streamData, row, 16);
                                console.log(`      ${row.toString(16).padStart(4, '0')}: ${hexStr}  |${ascii}|`);
                            }

                            // Check if the first 8 bytes look like modern format
                            if (streamData.length >= 8) {
                                const u32_0 = streamData.readUInt32LE(0);
                                const u32_1 = streamData.readUInt32LE(4);
                                console.log(`    First 8 bytes as uint32LE: ${u32_0}, ${u32_1}`);
                                if (u32_0 === 1 && u32_1 === 1) {
                                    console.log(`    ** Looks like modern format header (1, 1) **`);
                                }
                            }
                        }
                    } catch (e) {
                        console.log(`    Error reading stream: ${e.message}`);
                    }
                }
            }
        } catch (e) {
            console.log(`OLE2 parse error: ${e.message}`);
        }
    }

    // Search entire file for patterns (non-OLE2 or in addition to OLE2)
    console.log(`\n--- Whole-file pattern search ---`);
    const wholeFindings = searchForPatterns(buf, 'whole-file');
    if (wholeFindings.stringPatterns.length > 0) {
        console.log(`String patterns found:`);
        for (const sp of wholeFindings.stringPatterns) {
            console.log(`  "${sp.name}" at positions: ${sp.positions.slice(0, 10).join(', ')}${sp.positions.length > 10 ? '...' : ''}`);
        }
    }
    if (wholeFindings.floatClusters.length > 0) {
        console.log(`Float clusters (vertex-like data): ${wholeFindings.floatClusters.length} candidates`);
        for (const fc of wholeFindings.floatClusters.slice(0, 10)) {
            console.log(`  offset=0x${fc.offset.toString(16)}: (${fc.x.toFixed(4)}, ${fc.y.toFixed(4)}, ${fc.z.toFixed(4)})`);
        }
    }

    // Look for 0xFF 0xFF sequences (class record markers used in old format parser)
    const ffPositions = [];
    for (let i = 0; i < buf.length - 1; i++) {
        if (buf[i] === 0xFF && buf[i + 1] === 0xFF) {
            ffPositions.push(i);
        }
    }
    console.log(`\n0xFF 0xFF sequences: ${ffPositions.length} found`);
    if (ffPositions.length > 0 && ffPositions.length < 100) {
        console.log(`  Positions: ${ffPositions.map(p => '0x' + p.toString(16)).join(', ')}`);
    } else if (ffPositions.length >= 100) {
        console.log(`  First 10: ${ffPositions.slice(0, 10).map(p => '0x' + p.toString(16)).join(', ')}`);
        console.log(`  Last 5: ${ffPositions.slice(-5).map(p => '0x' + p.toString(16)).join(', ')}`);
    }

    // If not OLE2, look for other format signatures
    if (!isOLE2) {
        console.log(`\n--- Non-OLE2 format analysis ---`);
        // Look for common signatures
        const signatures = [
            { name: 'ZIP', bytes: [0x50, 0x4B, 0x03, 0x04] },
            { name: 'RAR', bytes: [0x52, 0x61, 0x72, 0x21] },
            { name: '7Z', bytes: [0x37, 0x7A, 0xBC, 0xAF] },
            { name: 'CAB', bytes: [0x4D, 0x53, 0x43, 0x46] },
            { name: 'SWF', bytes: [0x46, 0x57, 0x53] },
        ];

        for (const sig of signatures) {
            let found = false;
            for (let i = 0; i <= buf.length - sig.bytes.length; i++) {
                let match = true;
                for (let j = 0; j < sig.bytes.length; j++) {
                    if (buf[i + j] !== sig.bytes[j]) { match = false; break; }
                }
                if (match) { found = true; console.log(`  Found ${sig.name} signature at offset 0x${i.toString(16)}`); break; }
            }
        }

        // Show more of the header to help identify format
        console.log(`\nFirst 256 bytes (hex):`);
        for (let row = 0; row < Math.min(256, buf.length); row += 16) {
            const hexStr = hex(buf, row, 16);
            const ascii = asciiPreview(buf, row, 16);
            console.log(`  ${row.toString(16).padStart(4, '0')}: ${hexStr}  |${ascii}|`);
        }
    }
}

// Main
const files = [
    'C:\\Users\\basha\\Desktop\\soldiworks research\\test files original\\plate4.sldprt',
    'C:\\Users\\basha\\Desktop\\soldiworks research\\test files original\\chainwheel.sldprt',
    'C:\\Users\\basha\\Desktop\\soldiworks research\\test files original\\SW2000-s01.SLDPRT',
];

for (const f of files) {
    if (fs.existsSync(f)) {
        diagnoseFile(f);
    } else {
        console.log(`File not found: ${f}`);
    }
}
