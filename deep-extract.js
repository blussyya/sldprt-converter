/**
 * Deep analysis of Config-0, Config-0-Body, and Definition streams
 */
const fs = require('fs');
const zlib = require('zlib');
const { Ole2Parser } = require('./ole2-parser.js');

const file = process.argv[2];
if (!file) {
  console.log('Usage: node deep-extract.js <file.sldprt>');
  process.exit(1);
}

const buf = fs.readFileSync(file);
const parser = new Ole2Parser(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
parser.parse();

const streams = ['Config-0', 'Config-0-Body', 'Definition', 'DisplayLists', 'DisplayLists__Zip'];

for (const name of streams) {
  const entry = parser.directory.find(e => e.name === name);
  if (!entry) continue;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`STREAM: ${name} (${entry.streamSize} bytes)`);
  console.log(`${'='.repeat(60)}`);

  const data = new Uint8Array(parser.readStream(entry));

  // Hex dump first 256 bytes
  console.log('\nFirst 256 bytes:');
  for (let i = 0; i < Math.min(256, data.length); i += 16) {
    let hex = '', ascii = '';
    for (let j = 0; j < 16 && i + j < data.length; j++) {
      const byte = data[i + j];
      hex += byte.toString(16).padStart(2, '0') + ' ';
      ascii += (byte >= 32 && byte < 127) ? String.fromCharCode(byte) : '.';
    }
    console.log(`  ${i.toString(16).padStart(4, '0')}: ${hex.padEnd(48)} ${ascii}`);
  }

  // Check for ASCII strings
  const text = data.toString('ascii');
  const strings = text.match(/[A-Za-z_]{4,}/g);
  if (strings) {
    const unique = [...new Set(strings)].slice(0, 30);
    console.log(`\nASCII strings found: ${unique.join(', ')}`);
  }

  // Search for zlib headers
  const zlibHeaders = [];
  for (let i = 0; i < data.length - 1; i++) {
    if (data[i] === 0x78 && (data[i + 1] === 0x01 || data[i + 1] === 0x9C || data[i + 1] === 0xDA)) {
      zlibHeaders.push(i);
    }
  }
  if (zlibHeaders.length > 0) {
    console.log(`\nZlib headers at: ${zlibHeaders.join(', ')}`);
    for (const pos of zlibHeaders) {
      try {
        const decompressed = zlib.inflateRawSync(data.slice(pos + 2));
        console.log(`  Decompressed from ${pos}: ${decompressed.length} bytes`);
        console.log(`  First 128 bytes: ${decompressed.slice(0, 128).toString('hex')}`);
        if (decompressed[0] === 0x50 && decompressed[1] === 0x53) {
          console.log('  >>> PARASOLID DATA!');
          const outFile = file.replace(/\.[^.]+$/, '') + `-${name}-parasolid.x_b`;
          fs.writeFileSync(outFile, decompressed);
          console.log(`  Saved to: ${outFile}`);
        }
      } catch (e) {
        console.log(`  Decompress failed from ${pos}: ${e.message}`);
      }
    }
  }

  // Search for "PS " (Parasolid header)
  for (let i = 0; i <= data.length - 4; i++) {
    if (data[i] === 0x50 && data[i + 1] === 0x53 && data[i + 2] === 0x20 && data[i + 3] === 0x20) {
      console.log(`\n"PS " Parasolid header found at offset ${i}`);
      // Save from this offset
      const outFile = file.replace(/\.[^.]+$/, '') + `-${name}-parasolid.x_b`;
      fs.writeFileSync(outFile, data.slice(i));
      console.log(`Saved to: ${outFile}`);
    }
  }

  // Search for "PS" at neutral binary (0x50 0x53 0x00 0x00)
  for (let i = 0; i <= data.length - 4; i++) {
    if (data[i] === 0x50 && data[i + 1] === 0x53 && data[i + 2] === 0x00 && data[i + 3] === 0x00) {
      console.log(`\n"PS\0\0" Parasolid neutral binary header found at offset ${i}`);
    }
  }

  // Try raw inflate from start
  try {
    const decompressed = zlib.inflateRawSync(data);
    console.log(`\nRaw inflate succeeded: ${decompressed.length} bytes`);
    console.log(`First 64: ${decompressed.slice(0, 64).toString('hex')}`);
  } catch (e) {
    // expected
  }
}
