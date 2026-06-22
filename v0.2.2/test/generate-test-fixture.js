/**
 * Generate synthetic SLDPRT test fixtures for unit testing.
 *
 * Creates minimal valid OLE2 files containing DisplayLists streams
 * with known geometry so extraction can be validated.
 *
 * Usage: node test/generate-test-fixture.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Build a minimal OLE2 header
function buildOLE2Header() {
    const buf = new Uint8Array(512);
    const dv = new DataView(buf.buffer);

    // Magic
    const magic = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
    for (let i = 0; i < 8; i++) buf[i] = magic[i];

    // Minor version (offset 24)
    dv.setUint16(24, 0x003E, true);
    // Major version (offset 26)
    dv.setUint16(26, 3, true);
    // Byte order (offset 28): 0xFFFE = LE
    dv.setUint16(28, 0xFFFE, true);
    // Sector size power (offset 30): 9 = 512
    dv.setUint16(30, 9, true);
    // Mini sector size power (offset 32): 6 = 64
    dv.setUint16(32, 6, true);
    // Reserved (offset 34): 0
    // Total sectors in directory (offset 40): 0
    // Total sectors in FAT (offset 44): 0
    // First directory sector (offset 48): END_OF_CHAIN
    dv.setUint32(48, 0xFFFFFFFE, true);
    // Mini stream cutoff (offset 56): 4096
    dv.setUint32(56, 4096, true);
    // First FAT sector (offset 60): END_OF_CHAIN
    dv.setUint32(60, 0xFFFFFFFE, true);
    // Total sectors in mini FAT (offset 64): 0
    // First DIFAT sector (offset 68): -1 (none)
    dv.setInt32(68, -1, true);
    // DIFAT entries (offset 76): all -1
    for (let i = 0; i < 109; i++) dv.setInt32(76 + i * 4, -1, true);

    return buf;
}

// Build a valid DisplayLists stream with a simple triangle
function buildDisplayLists() {
    // Old format: faceCount (u32), vertexCounts (faceCount × u32), vertices (float32 × 3)
    // Simple: 1 face with 3 vertices forming a right triangle

    const faceCount = 1;
    const vertCounts = [3];
    const verts = [
        [0, 0, 0],
        [10, 0, 0],
        [0, 10, 0]
    ];

    const bufSize = 4 + faceCount * 4 + 3 * 3 * 4;
    const buf = new Uint8Array(bufSize);
    const dv = new DataView(buf.buffer);

    dv.setUint32(0, faceCount, true);
    dv.setUint32(4, vertCounts[0], true);

    let off = 8;
    for (const v of verts) {
        dv.setFloat32(off, v[0], true);
        dv.setFloat32(off + 4, v[1], true);
        dv.setFloat32(off + 8, v[2], true);
        off += 12;
    }

    return buf;
}

function main() {
    const fixtureDir = path.join(__dirname, 'fixtures');
    if (!fs.existsSync(fixtureDir)) fs.mkdirSync(fixtureDir, { recursive: true });

    // Generate synthetic fixture
    const ole2 = buildOLE2Header();
    const dl = buildDisplayLists();

    // In a real OLE2 file, the DisplayLists stream would be embedded
    // as a stream in the compound document. For testing, we write
    // just the raw DisplayLists data so the parser can be tested
    // against individual stream data.

    const synthPath = path.join(fixtureDir, 'synthetic-triangle.dl');
    fs.writeFileSync(synthPath, dl);
    console.log(`Wrote ${synthPath} (${dl.length} bytes)`);

    // Write a readme about test fixtures
    const readmePath = path.join(fixtureDir, 'README.md');
    const content = `# Test Fixtures

## Real SLDPRT files

These are real SolidWorks part files downloaded from public repositories.
They are used to test the full extraction pipeline (OLE2 parsing, stream
decompression, mesh extraction).

Sources:
- box.SLDPRT, door.SLDPRT, drawer.SLDPRT - UK-CoVid19/cad-bsl2-lab (BSL-2 lab CAD)
- locker.SLDPRT, sink.SLDPRT - UK-CoVid19/cad-bsl2-lab

## Synthetic fixtures

- \`synthetic-triangle.dl\` - Raw DisplayLists stream data for a single triangle.
  Used to test the DisplayLists parser in isolation.
`;

    fs.writeFileSync(readmePath, content);
    console.log(`Wrote ${readmePath}`);
}

if (require.main === module) main();
module.exports = { buildOLE2Header, buildDisplayLists };
