const fs = require('fs');
const zlib = require('zlib');
const { Ole2Parser } = require('./ole2-parser.js');

const filePath = 'D:\\karaza\\websites\\Karazas-website\\sldprt-research\\new-samples\\SLIDING TABLE.SLDPRT';
const buf = fs.readFileSync(filePath);
const parser = new Ole2Parser(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
parser.parse();

// Check DisplayLists__Zip — the custom __Zip compression
const displayLists = parser.directory.find(e => e.name === 'DisplayLists__Zip');
const dlData = new Uint8Array(parser.readStream(displayLists));
console.log(`DisplayLists__Zip: ${dlData.length} bytes`);
console.log(`First 64 bytes: ${Array.from(dlData.slice(0, 64)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);

// Try decompression at every offset
console.log('\n--- Trying decompression at every offset ---');
for (let offset = 0; offset < dlData.length - 2; offset++) {
  // Standard zlib header
  if (dlData[offset] === 0x78 && (dlData[offset+1] === 0x01 || dlData[offset+1] === 0x9C || dlData[offset+1] === 0xDA)) {
    try {
      const result = zlib.inflateRawSync(dlData.slice(offset + 2), { maxOutputLength: 5*1024*1024 });
      if (result.length > 50) {
        const isPS = result.length > 4 && result[0] === 0x50 && result[1] === 0x53;
        console.log(`  zlib at ${offset}: ${result.length} bytes ${isPS ? '>>> PS! >>>' : ''}`);
      }
    } catch(e) {}
  }
}

// The DisplayLists__Zip header is: 01 06 c0 1f 24 41 12 24
// Let me check if this is a variant of the compression
// Maybe the first few bytes are a header, and the rest is zlib
console.log('\n--- Trying different skip amounts for DisplayLists__Zip ---');
for (let skip = 0; skip <= 128; skip += 2) {
  for (let method of [
    { name: 'inflate', fn: d => zlib.inflateSync(d) },
    { name: 'inflateRaw', fn: d => zlib.inflateRawSync(d) },
    { name: 'inflateRaw-w9', fn: d => zlib.inflateRawSync(d, { windowBits: 9 }) },
    { name: 'inflateRaw-w15', fn: d => zlib.inflateRawSync(d, { windowBits: 15 }) },
    { name: 'inflateRaw-w-15', fn: d => zlib.inflateRawSync(d, { windowBits: -15 }) },
    { name: 'brotli', fn: d => zlib.brotliDecompressSync(d) },
  ]) {
    try {
      const result = method.fn(dlData.slice(skip));
      if (result.length > 50) {
        const isPS = result.length > 4 && result[0] === 0x50 && result[1] === 0x53;
        const hasPS = result.toString('binary').includes('PARASOLID');
        console.log(`  ${method.name} @ skip ${skip}: ${result.length} bytes ${isPS ? '>>> PS! >>>' : ''} ${hasPS ? '>>> HAS PARASOLID! >>>' : ''}`);
      }
    } catch(e) {}
  }
}

// Also try the __Zip format as a custom bitstream
// The header 01 06 c0 1f 24 41 might encode the uncompressed size
console.log('\n--- Analyzing __Zip header ---');
const headerBytes = Array.from(dlData.slice(0, 16));
console.log(`Header: ${headerBytes.map(b => b.toString(16).padStart(2, '0')).join(' ')}`);

// Try interpreting header as little-endian uint32 values
for (let i = 0; i < 16; i += 4) {
  const val = dlData[i] | (dlData[i+1] << 8) | (dlData[i+2] << 16) | (dlData[i+3] << 24);
  console.log(`  uint32 @ ${i}: ${val} (0x${val.toString(16)})`);
}

// Try interpreting as float32 values
for (let i = 0; i < 16; i += 4) {
  const dv = new DataView(dlData.buffer, dlData.byteOffset + i, 4);
  try {
    const val = dv.getFloat32(0, true);
    console.log(`  float32 @ ${i}: ${val}`);
  } catch(e) {}
}

// Maybe the __Zip format uses a custom Huffman/dictionary-based compression
// Let me try to extract potential vertices by looking at byte patterns
console.log('\n--- Looking for vertex patterns in DisplayLists__Zip ---');

// In DisplayLists, vertices might be stored as:
// - 2-byte int16 values (scaled coordinates)
// - 4-byte int32 values
// - Mixed with control bytes

// Let me scan for clusters of similar-range values
const int16Values = [];
for (let i = 8; i < dlData.length - 2; i += 2) {
  const val = dlData[i] | (dlData[i+1] << 8);
  const signed = val > 32767 ? val - 65536 : val;
  if (Math.abs(signed) < 10000) {
    int16Values.push({ offset: i, value: signed });
  }
}
console.log(`Found ${int16Values.length} valid int16 values in DisplayLists`);

// Check if they form coordinate triplets
let coordTriplets = 0;
for (let i = 0; i < int16Values.length - 2; i++) {
  const x = int16Values[i].value;
  const y = int16Values[i+1].value;
  const z = int16Values[i+2].value;
  if (Math.abs(x) < 5000 && Math.abs(y) < 5000 && Math.abs(z) < 5000 &&
      (Math.abs(x) > 0 || Math.abs(y) > 0 || Math.abs(z) > 0)) {
    coordTriplets++;
  }
}
console.log(`Potential coordinate triplets (int16): ${coordTriplets}`);

// Also check the Config streams for non-matrix float64 data
// Config-0 is 112KB — this might contain the actual vertex data
console.log('\n--- Analyzing Config-0 (metadata stream) ---');
const config0 = parser.directory.find(e => e.name === 'Config-0');
const c0Data = new Uint8Array(parser.readStream(config0));
console.log(`Config-0: ${c0Data.length} bytes`);
console.log(`First 64 bytes: ${Array.from(c0Data.slice(0, 64)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);

// Config-0 might also contain float64 data mixed with metadata
const c0dv = new DataView(c0Data.buffer, c0Data.byteOffset, c0Data.byteLength);
const c0Floats = [];
for (let i = 0; i <= c0Data.length - 8; i += 8) {
  try {
    const val = c0dv.getFloat64(i, true);
    if (isFinite(val) && Math.abs(val) < 10000 && !isNaN(val)) {
      c0Floats.push({ offset: i, value: val });
    }
  } catch(e) {}
}
console.log(`Valid float64 values in Config-0: ${c0Floats.length}`);

// Check if Config-0 has the same class name structure
console.log('\n--- Config-0 class names ---');
for (let i = 0; i < c0Data.length - 10; i++) {
  if (c0Data[i] === 0xFF && c0Data[i+1] === 0xFF && i + 4 < c0Data.length) {
    const nameLen = c0Data[i+2] | (c0Data[i+3] << 8);
    if (nameLen > 3 && nameLen < 200 && i + 4 + nameLen <= c0Data.length) {
      let name = '';
      let valid = true;
      for (let j = 0; j < nameLen; j++) {
        const ch = c0Data[i + 4 + j];
        if (ch >= 0x20 && ch < 0x7f) name += String.fromCharCode(ch);
        else { valid = false; break; }
      }
      if (valid && name.length > 3 && /_c$/.test(name)) {
        console.log(`  ${i.toString(16).padStart(6)}: ${name}`);
      }
    }
  }
}

// Check the Definition stream more carefully
console.log('\n--- Definition stream deep analysis ---');
const def = parser.directory.find(e => e.name === 'Definition');
const defData = new Uint8Array(parser.readStream(def));
console.log(`Definition: ${defData.length} bytes`);

// The first 4 bytes are 1a 00 00 00 = 26 (might be a count)
const int32 = defData[0] | (defData[1] << 8) | (defData[2] << 16) | (defData[3] << 24);
console.log(`First uint32: ${int32}`);

// Check for Parasolid transmit file header
// The first 4 bytes should be a magic number
if (defData[0] === 0x50 && defData[1] === 0x53) {
  console.log('  >>> PARASOLID TRANSMIT FILE!');
}
if (defData[0] === 0x1A && defData[1] === 0x00) {
  console.log('  Looks like a Parasolid transmit header (0x1A = 26)');
}

// The Definition stream might contain the Parasolid B-Rep data
// in a different format
// Let me try to decompress it with various methods
console.log('\n--- Trying decompression on Definition ---');
for (let skip = 0; skip <= 16; skip++) {
  for (let method of [
    { name: 'inflate', fn: d => zlib.inflateSync(d) },
    { name: 'inflateRaw', fn: d => zlib.inflateRawSync(d) },
    { name: 'brotli', fn: d => zlib.brotliDecompressSync(d) },
  ]) {
    try {
      const result = method.fn(defData.slice(skip));
      if (result.length > 50) {
        const isPS = result.length > 4 && result[0] === 0x50 && result[1] === 0x53;
        console.log(`  ${method.name} @ skip ${skip}: ${result.length} bytes ${isPS ? '>>> PS! >>>' : ''}`);
      }
    } catch(e) {}
  }
}
