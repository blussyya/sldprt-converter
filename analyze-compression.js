/**
 * Analyze Config-0-Body compression structure
 * The data contains multiple zlib blocks - need to find boundaries
 */
const fs = require('fs');
const zlib = require('zlib');
const { Ole2Parser } = require('./ole2-parser.js');

const file = process.argv[2];
const buf = fs.readFileSync(file);
const parser = new Ole2Parser(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
parser.parse();

const entry = parser.directory.find(e => e.name === 'Config-0-Body');
if (!entry) { console.log('No Config-0-Body'); process.exit(1); }

const data = new Uint8Array(parser.readStream(entry));
console.log(`Config-0-Body: ${data.length} bytes`);

// Strategy 1: Try to find valid deflate streams by scanning for valid block starts
// Deflate blocks start with: BFINAL (1 bit) + BTYPE (2 bits)
// BTYPE=00: stored (no compression), BTYPE=01: fixed Huffman, BTYPE=10: dynamic Huffman, BTYPE=11: reserved
// For stored blocks: skip to next byte boundary, then read LEN (2 bytes) + NLEN (2 bytes)

console.log('\n--- Strategy 1: Try inflate from every byte position ---');
const successes = [];
for (let i = 0; i < Math.min(data.length, 500); i++) {
  try {
    const result = zlib.inflateRawSync(data.slice(i), { maxOutputLength: 10 * 1024 * 1024 });
    if (result.length > 10) {
      const preview = result.slice(0, 32).toString('hex');
      const isASCII = result.slice(0, 16).every(b => b >= 32 && b < 127);
      const isPS = result[0] === 0x50 && result[1] === 0x53;
      if (isPS || isASCII || result.length > 100) {
        console.log(`  Offset ${i}: ${result.length} bytes | PS=${isPS} ASCII=${isASCII} | ${preview}`);
        successes.push({ offset: i, size: result.length, data: result, isPS });
      }
    }
  } catch (e) {
    // skip
  }
}

console.log(`\nFound ${successes.length} successful decompressions in first 500 bytes`);

// Strategy 2: Look at the raw bytes more carefully
console.log('\n--- Byte analysis of first 64 bytes ---');
for (let i = 0; i < Math.min(64, data.length); i += 16) {
  let hex = '';
  for (let j = 0; j < 16 && i + j < data.length; j++) {
    hex += data[i + j].toString(16).padStart(2, '0') + ' ';
  }
  console.log(`  ${i.toString(16).padStart(4, '0')}: ${hex}`);
}

// Strategy 3: Check if the whole thing might be a custom SW compression format
// First 2 bytes might be a header length or type
console.log('\n--- Strategy 3: Try different offsets after header ---');
for (const skip of [2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 32]) {
  try {
    const result = zlib.inflateRawSync(data.slice(skip), { maxOutputLength: 10 * 1024 * 1024 });
    console.log(`  Skip ${skip}: ${result.length} bytes | first 32: ${result.slice(0, 32).toString('hex')}`);
    if (result[0] === 0x50 && result[1] === 0x53) {
      console.log('  >>> PARASOLID!');
      fs.writeFileSync(file.replace(/\.[^.]+$/, '') + '.x_b', result);
    }
  } catch (e) {
    // skip
  }
}

// Strategy 4: Try inflate with wbits=-15 (raw) from every position that has 0x78
console.log('\n--- Strategy 4: Try all 0x78 positions with various wbits ---');
for (let i = 0; i < data.length - 2; i++) {
  if (data[i] === 0x78) {
    for (const wbits of [-15, -8, 15, 31, 47]) {
      try {
        const result = zlib.inflateRawSync(data.slice(i), { 
          maxOutputLength: 10 * 1024 * 1024,
          // @ts-ignore
        });
        if (result.length > 50) {
          const isPS = result[0] === 0x50 && result[1] === 0x53;
          console.log(`  Offset ${i} (wbits default): ${result.length} bytes | PS=${isPS} | ${result.slice(0, 32).toString('hex')}`);
          if (isPS) {
            fs.writeFileSync(file.replace(/\.[^.]+$/, '') + '.x_b', result);
            console.log('  >>> SAVED!');
          }
          break;
        }
      } catch (e) {}
    }
  }
}

// Strategy 5: Look at the Config-0 (non-body) - it has moPart_c etc
// Maybe Config-0 IS the Parasolid data in SW serialization format
console.log('\n--- Analyzing Config-0 structure ---');
const config0 = parser.directory.find(e => e.name === 'Config-0');
if (config0) {
  const c0data = new Uint8Array(parser.readStream(config0));
  // Find all class names
  const text = c0data.toString('binary');
  const classNames = text.match(/mo[A-Z][a-zA-Z_]+_c/g);
  if (classNames) {
    console.log(`  Class names found: ${[...new Set(classNames)].join(', ')}`);
  }
  
  // Find all string content (UTF-16LE)
  for (let i = 0; i < c0data.length - 1; i++) {
    if (c0data[i] >= 0x20 && c0data[i] < 0x7f && c0data[i+1] === 0x00) {
      let str = '';
      let j = i;
      while (j < c0data.length - 1 && c0data[j] >= 0x20 && c0data[j] < 0x7f && c0data[j+1] === 0x00) {
        str += String.fromCharCode(c0data[j]);
        j += 2;
      }
      if (str.length > 3) {
        console.log(`  UTF-16 at ${i}: "${str}"`);
      }
      i = j;
    }
  }
}
