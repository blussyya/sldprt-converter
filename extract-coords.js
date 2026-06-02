/**
 * Extract geometry from Config-0-Body by finding coordinate patterns
 * and from DisplayLists
 */
const fs = require('fs');
const zlib = require('zlib');
const { Ole2Parser } = require('./ole2-parser.js');

const file = process.argv[2];
const buf = fs.readFileSync(file);
const parser = new Ole2Parser(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
parser.parse();

console.log(`File: ${file}`);

// Look at Config-0-Body for float64 coordinate patterns
const body = parser.directory.find(e => e.name === 'Config-0-Body');
if (body) {
  const data = new Uint8Array(parser.readStream(body));
  console.log(`\nConfig-0-Body: ${data.length} bytes`);
  
  // Look for sequences of 3 consecutive float64 values that could be XYZ coordinates
  // Real coordinates are typically in range -1000 to 1000
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  
  // Find all float64 values
  const floats = [];
  for (let i = 0; i <= data.length - 8; i += 8) {
    try {
      const val = dv.getFloat64(i, true); // little-endian
      if (isFinite(val) && Math.abs(val) < 10000 && val !== 0) {
        floats.push({ offset: i, value: val });
      }
    } catch (e) {}
  }
  
  console.log(`Found ${floats.length} plausible float64 values`);
  
  // Look for consecutive float64 triplets (XYZ)
  const triplets = [];
  for (let i = 0; i <= floats.length - 3; i++) {
    const a = floats[i].value;
    const b = floats[i+1].value;
    const c = floats[i+2].value;
    
    // Check if they're reasonable coordinates (not too small, not too large)
    if (Math.abs(a) < 1000 && Math.abs(b) < 1000 && Math.abs(c) < 1000 &&
        Math.abs(a) > 0.001 && Math.abs(b) > 0.001 && Math.abs(c) > 0.001) {
      // Check if next triplet is also reasonable (suggests a pattern)
      if (i + 5 < floats.length) {
        const d = floats[i+3].value;
        const e = floats[i+4].value;
        const f = floats[i+5].value;
        if (Math.abs(d) < 1000 && Math.abs(e) < 1000 && Math.abs(f) < 1000) {
          triplets.push({
            offset: floats[i].offset,
            coords: [a, b, c],
            next: [d, e, f]
          });
        }
      }
    }
  }
  
  console.log(`Found ${triplets.length} potential coordinate triplets`);
  if (triplets.length > 0) {
    console.log('\nFirst 20 triplets:');
    for (let i = 0; i < Math.min(20, triplets.length); i++) {
      const t = triplets[i];
      console.log(`  Offset ${t.offset.toString(16)}: [${t.coords[0].toFixed(4)}, ${t.coords[1].toFixed(4)}, ${t.coords[2].toFixed(4)}] → [${t.next[0].toFixed(4)}, ${t.next[1].toFixed(4)}, ${t.next[2].toFixed(4)}]`);
    }
  }
  
  // Also try big-endian
  console.log('\n--- Big-endian float64 analysis ---');
  const beTriplets = [];
  for (let i = 0; i <= data.length - 24; i += 8) {
    try {
      const a = dv.getFloat64(i, false);
      const b = dv.getFloat64(i + 8, false);
      const c = dv.getFloat64(i + 16, false);
      if (isFinite(a) && isFinite(b) && isFinite(c) &&
          Math.abs(a) < 1000 && Math.abs(b) < 1000 && Math.abs(c) < 1000 &&
          Math.abs(a) > 0.001 && Math.abs(b) > 0.001 && Math.abs(c) > 0.001) {
        beTriplets.push({ offset: i, coords: [a, b, c] });
      }
    } catch (e) {}
  }
  console.log(`Found ${beTriplets.length} big-endian triplets`);
  if (beTriplets.length > 0) {
    console.log('First 20:');
    for (let i = 0; i < Math.min(20, beTriplets.length); i++) {
      const t = beTriplets[i];
      console.log(`  Offset ${t.offset.toString(16)}: [${t.coords[0].toFixed(4)}, ${t.coords[1].toFixed(4)}, ${t.coords[2].toFixed(4)}]`);
    }
  }
}

// Also look at DisplayLists for plate4 (uncompressed)
const dl = parser.directory.find(e => e.name === 'DisplayLists');
if (dl) {
  const data = new Uint8Array(parser.readStream(dl));
  console.log(`\nDisplayLists: ${data.length} bytes`);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  
  // Same analysis
  const floats = [];
  for (let i = 0; i <= data.length - 8; i += 8) {
    try {
      const val = dv.getFloat64(i, true);
      if (isFinite(val) && Math.abs(val) < 10000 && val !== 0) {
        floats.push({ offset: i, value: val });
      }
    } catch (e) {}
  }
  console.log(`Found ${floats.length} float64 values`);
  
  const triplets = [];
  for (let i = 0; i <= floats.length - 3; i++) {
    const a = floats[i].value;
    const b = floats[i+1].value;
    const c = floats[i+2].value;
    if (Math.abs(a) < 1000 && Math.abs(b) < 1000 && Math.abs(c) < 1000 &&
        Math.abs(a) > 0.001 && Math.abs(b) > 0.001 && Math.abs(c) > 0.001) {
      if (i + 5 < floats.length) {
        const d = floats[i+3].value;
        const e = floats[i+4].value;
        const f = floats[i+5].value;
        if (Math.abs(d) < 1000 && Math.abs(e) < 1000 && Math.abs(f) < 1000) {
          triplets.push({
            offset: floats[i].offset,
            coords: [a, b, c],
            next: [d, e, f]
          });
        }
      }
    }
  }
  console.log(`Found ${triplets.length} potential coordinate triplets`);
  if (triplets.length > 0) {
    console.log('\nFirst 30 triplets:');
    for (let i = 0; i < Math.min(30, triplets.length); i++) {
      const t = triplets[i];
      console.log(`  Offset ${t.offset.toString(16)}: [${t.coords[0].toFixed(6)}, ${t.coords[1].toFixed(6)}, ${t.coords[2].toFixed(6)}] → [${t.next[0].toFixed(6)}, ${t.next[1].toFixed(6)}, ${t.next[2].toFixed(6)}]`);
    }
  }
}
