/**
 * Extract Parasolid .x_b data from SLDPRT files
 * Based on FreeCAD forum findings: Config-0-Partition contains zlib-compressed Parasolid data
 */
const fs = require('fs');
const zlib = require('zlib');
const { Ole2Parser } = require('./ole2-parser.js');

const files = process.argv.slice(2);
if (files.length === 0) {
  console.log('Usage: node extract-parasolid.js <file1.sldprt> [file2.sldprt] ...');
  process.exit(1);
}

for (const file of files) {
  console.log('\n' + '='.repeat(60));
  console.log(`FILE: ${file}`);
  console.log('='.repeat(60));

  const buf = fs.readFileSync(file);
  const parser = new Ole2Parser(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  parser.parse();

  // List all streams
  const streams = parser.listStreams();
  console.log(`\nAll streams (${streams.length}):`);
  for (const s of streams) {
    console.log(`  ${s.path} (${s.size} bytes, sector ${s.sector})`);
  }

  // Find Config-0-Partition specifically
  const configPartition = parser.directory.find(e => e.name === 'Config-0-Partition');
  if (!configPartition) {
    console.log('\nNo Config-0-Partition found!');
    continue;
  }

  console.log(`\nConfig-0-Partition found: ${configPartition.streamSize} bytes, starting sector ${configPartition.startingSector}`);

  const rawData = new Uint8Array(parser.readStream(configPartition));
  console.log(`Raw data read: ${rawData.length} bytes`);

  // Hex dump first 128 bytes
  console.log('\nFirst 128 bytes of Config-0-Partition:');
  for (let i = 0; i < Math.min(128, rawData.length); i += 16) {
    let hex = '', ascii = '';
    for (let j = 0; j < 16 && i + j < rawData.length; j++) {
      const byte = rawData[i + j];
      hex += byte.toString(16).padStart(2, '0') + ' ';
      ascii += (byte >= 32 && byte < 127) ? String.fromCharCode(byte) : '.';
    }
    console.log(`  ${i.toString(16).padStart(4, '0')}: ${hex.padEnd(48)} ${ascii}`);
  }

  // Search for zlib magic numbers (0x78 0x01, 0x78 0x9C, 0x78 0xDA)
  const zlibHeaders = [];
  for (let i = 0; i < rawData.length - 1; i++) {
    if (rawData[i] === 0x78 && (rawData[i + 1] === 0x01 || rawData[i + 1] === 0x9C || rawData[i + 1] === 0xDA)) {
      zlibHeaders.push(i);
    }
  }
  console.log(`\nZlib headers found at offsets: ${zlibHeaders.join(', ') || 'none'}`);

  // Search for the 16-byte Parasolid GUID: 23 1d d5 71 da 81 48 a2 a8 58 98 b2 1b 89 ef 99
  const guid = Buffer.from([0x23, 0x1d, 0xd5, 0x71, 0xda, 0x81, 0x48, 0xa2, 0xa8, 0x58, 0x98, 0xb2, 0x1b, 0x89, 0xef, 0x99]);
  const guidPositions = [];
  for (let i = 0; i <= rawData.length - 16; i++) {
    let match = true;
    for (let j = 0; j < 16; j++) {
      if (rawData[i + j] !== guid[j]) { match = false; break; }
    }
    if (match) guidPositions.push(i);
  }
  console.log(`Parasolid GUID found at offsets: ${guidPositions.join(', ') || 'none'}`);

  // Search for the 6-byte magic: 14 00 06 00 08 00
  const magic6 = Buffer.from([0x14, 0x00, 0x06, 0x00, 0x08, 0x00]);
  const magic6Positions = [];
  for (let i = 0; i <= rawData.length - 6; i++) {
    let match = true;
    for (let j = 0; j < 6; j++) {
      if (rawData[i + j] !== magic6[j]) { match = false; break; }
    }
    if (match) magic6Positions.push(i);
  }
  console.log(`6-byte magic found at offsets: ${magic6Positions.join(', ') || 'none'}`);

  // Search for "PS " header (Parasolid binary signature)
  const psPositions = [];
  for (let i = 0; i <= rawData.length - 4; i++) {
    if (rawData[i] === 0x50 && rawData[i + 1] === 0x53 && rawData[i + 2] === 0x20 && rawData[i + 3] === 0x20) {
      psPositions.push(i);
    }
  }
  console.log(`"PS " header found at offsets: ${psPositions.join(', ') || 'none'}`);

  // Try to decompress from each zlib header position
  console.log('\n--- Attempting zlib decompression ---');
  for (const pos of zlibHeaders) {
    try {
      // Try raw deflate (no zlib header) - skip the 2-byte zlib header
      const compressed = rawData.slice(pos + 2);
      const decompressed = zlib.inflateRawSync(compressed);
      console.log(`\nDecompressed from offset ${pos}: ${decompressed.length} bytes`);
      console.log(`First 64 bytes: ${decompressed.slice(0, 64).toString('hex')}`);
      
      // Check if it starts with "PS " (Parasolid)
      if (decompressed[0] === 0x50 && decompressed[1] === 0x53) {
        console.log('>>> PARASOLID DATA FOUND! Starts with "PS " header');
        // Save to file
        const outFile = file.replace(/\.[^.]+$/, '') + '.x_b';
        fs.writeFileSync(outFile, decompressed);
        console.log(`Saved to: ${outFile}`);
      }
      
      // Check for Parasolid text header
      const text = decompressed.slice(0, 200).toString('ascii');
      if (text.includes('PARASOLID') || text.includes('PS ')) {
        console.log('>>> Likely Parasolid data');
      }
    } catch (e) {
      // Try with zlib header
      try {
        const decompressed = zlib.inflateSync(rawData.slice(pos));
        console.log(`Decompressed (with header) from offset ${pos}: ${decompressed.length} bytes`);
        console.log(`First 64 bytes: ${decompressed.slice(0, 64).toString('hex')}`);
      } catch (e2) {
        console.log(`Failed to decompress from offset ${pos}: ${e.message} / ${e2.message}`);
      }
    }
  }

  // Also try decompressing from the start (raw deflate might skip header)
  if (zlibHeaders.length === 0) {
    console.log('\nNo zlib headers found. Trying raw inflate from offset 0...');
    try {
      const decompressed = zlib.inflateRawSync(rawData);
      console.log(`Raw inflate succeeded: ${decompressed.length} bytes`);
      console.log(`First 64 bytes: ${decompressed.slice(0, 64).toString('hex')}`);
    } catch (e) {
      console.log(`Raw inflate failed: ${e.message}`);
    }

    // Try gzip
    try {
      const decompressed = zlib.gunzipSync(rawData);
      console.log(`Gzip decompress succeeded: ${decompressed.length} bytes`);
      console.log(`First 64 bytes: ${decompressed.slice(0, 64).toString('hex')}`);
    } catch (e) {
      console.log(`Gzip decompress failed: ${e.message}`);
    }
  }

  // Also check Config-0-Partition-Body
  const configBody = parser.directory.find(e => e.name === 'Config-0-Partition-Body');
  if (configBody) {
    console.log(`\nConfig-0-Partition-Body found: ${configBody.streamSize} bytes`);
    const bodyData = new Uint8Array(parser.readStream(configBody));
    
    // Search for zlib headers in body
    const bodyZlib = [];
    for (let i = 0; i < bodyData.length - 1; i++) {
      if (bodyData[i] === 0x78 && (bodyData[i + 1] === 0x01 || bodyData[i + 1] === 0x9C || bodyData[i + 1] === 0xDA)) {
        bodyZlib.push(i);
      }
    }
    console.log(`Body zlib headers: ${bodyZlib.join(', ') || 'none'}`);

    for (const pos of bodyZlib) {
      try {
        const compressed = bodyData.slice(pos + 2);
        const decompressed = zlib.inflateRawSync(compressed);
        console.log(`Body decompressed from offset ${pos}: ${decompressed.length} bytes`);
        console.log(`First 64 bytes: ${decompressed.slice(0, 64).toString('hex')}`);
        if (decompressed[0] === 0x50 && decompressed[1] === 0x53) {
          console.log('>>> PARASOLID DATA IN BODY!');
          const outFile = file.replace(/\.[^.]+$/, '') + '-body.x_b';
          fs.writeFileSync(outFile, decompressed);
          console.log(`Saved to: ${outFile}`);
        }
      } catch (e) {
        console.log(`Body decompress failed from offset ${pos}: ${e.message}`);
      }
    }
  }
}
