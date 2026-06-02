/**
 * Analyze DisplayLists binary structure in detail
 */
const fs = require('fs');
const zlib = require('zlib');
const { Ole2Parser } = require('./ole2-parser.js');

const file = process.argv[2];
const buf = fs.readFileSync(file);
const parser = new Ole2Parser(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
parser.parse();

// Try all DisplayLists variants
const dlNames = ['DisplayLists', 'DisplayLists__Zip', 'DisplayLists__ZLB'];
for (const name of dlNames) {
  const entry = parser.directory.find(e => e.name === name);
  if (!entry) continue;
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${name}: ${entry.streamSize} bytes`);
  console.log(`${'='.repeat(60)}`);
  
  let data = new Uint8Array(parser.readStream(entry));
  
  // If compressed, try to decompress
  if (name.includes('Zip') || name.includes('ZLB')) {
    // Try zlib inflate
    try {
      const decompressed = zlib.inflateRawSync(data.slice(2)); // skip 2-byte zlib header
      console.log(`Decompressed: ${decompressed.length} bytes`);
      data = new Uint8Array(decompressed);
    } catch (e) {
      try {
        const decompressed = zlib.inflateSync(data);
        console.log(`Decompressed (with header): ${decompressed.length} bytes`);
        data = new Uint8Array(decompressed);
      } catch (e2) {
        console.log(`Decompression failed: ${e.message} / ${e2.message}`);
        // Try with pako-style raw inflate
        try {
          const decompressed = zlib.inflateRawSync(data);
          console.log(`Raw inflate: ${decompressed.length} bytes`);
          data = new Uint8Array(decompressed);
        } catch (e3) {}
      }
    }
  }
  
  // Full hex dump of first 512 bytes
  console.log(`\nFirst 512 bytes:`);
  for (let i = 0; i < Math.min(512, data.length); i += 16) {
    let hex = '', ascii = '';
    for (let j = 0; j < 16 && i + j < data.length; j++) {
      const byte = data[i + j];
      hex += byte.toString(16).padStart(2, '0') + ' ';
      ascii += (byte >= 32 && byte < 127) ? String.fromCharCode(byte) : '.';
    }
    console.log(`  ${i.toString(16).padStart(4, '0')}: ${hex.padEnd(48)} ${ascii}`);
  }
  
  // Identify sections
  console.log('\n--- Section markers ---');
  // Look for sections that might have length-prefixed data
  // Common patterns: [4-byte length] [data], or [type byte] [length] [data]
  
  // Find all uint32 values and see if any look like section lengths
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < Math.min(data.length - 4, 1024); i += 4) {
    const val = dv.getUint32(i, true);
    if (val > 10 && val < data.length && val !== 0xFFFFFFFF) {
      // Check if the bytes at this offset could be a header
      const b = data[i];
      const b1 = data[i+1];
      if (b === 0x01 || b === 0x02 || b === 0x03 || b === 0x04 || b === 0x05 ||
          (b1 === 0x00 && val < 10000)) {
        // console.log(`  Potential section at ${i.toString(16)}: length=${val} (0x${val.toString(16)})`);
      }
    }
  }
  
  // Find class name markers (like moXxx_c pattern)
  console.log('\n--- Class names ---');
  for (let i = 0; i < data.length - 4; i++) {
    // Look for ASCII strings that match class patterns
    if (data[i] === 0x6d && data[i+1] === 0x6f) { // "mo"
      let str = '';
      let j = i;
      while (j < data.length && data[j] >= 0x20 && data[j] < 0x7f) {
        str += String.fromCharCode(data[j]);
        j++;
      }
      if (str.length > 4 && str.endsWith('_c')) {
        console.log(`  ${i.toString(16)}: ${str}`);
      }
    }
    // Also check for "ui" prefix
    if (data[i] === 0x75 && data[i+1] === 0x69) { // "ui"
      let str = '';
      let j = i;
      while (j < data.length && data[j] >= 0x20 && data[j] < 0x7f) {
        str += String.fromCharCode(data[j]);
        j++;
      }
      if (str.length > 4 && str.endsWith('_c')) {
        console.log(`  ${i.toString(16)}: ${str}`);
      }
    }
  }
  
  // Find all float64 values and group them
  console.log('\n--- Float64 values (little-endian) ---');
  const allFloats = [];
  for (let i = 0; i <= data.length - 8; i += 8) {
    const val = dv.getFloat64(i, true);
    if (isFinite(val) && Math.abs(val) < 1e10) {
      allFloats.push({ offset: i, value: val });
    }
  }
  console.log(`Total float64 values: ${allFloats.length}`);
  
  // Show first 50 float64 values with context
  console.log('\nFirst 50 float64 values:');
  for (let i = 0; i < Math.min(50, allFloats.length); i++) {
    const f = allFloats[i];
    const nearby = data.slice(Math.max(0, f.offset - 2), f.offset + 10);
    const ctx = Array.from(nearby).map(b => b.toString(16).padStart(2, '0')).join(' ');
    console.log(`  ${f.offset.toString(16).padStart(4, '0')}: ${f.value.toFixed(6).padStart(14)} | ${ctx}`);
  }
}
