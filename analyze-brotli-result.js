const fs = require('fs');
const zlib = require('zlib');
const { Ole2Parser } = require('./ole2-parser.js');

const filePath = 'D:\\karaza\\websites\\Karazas-website\\sldprt-research\\new-samples\\SLIDING TABLE.SLDPRT';
const buf = fs.readFileSync(filePath);
const parser = new Ole2Parser(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
parser.parse();

// 1. Brotli decompress DisplayLists__Zip at offset 14
console.log('=== Brotli decompress of DisplayLists__Zip @ 14 ===');
const dlEntry = parser.directory.find(e => e.name === 'DisplayLists__Zip');
const dlData = new Uint8Array(parser.readStream(dlEntry));
const brotliResult = zlib.brotliDecompressSync(dlData.slice(14));
console.log(`Size: ${brotliResult.length} bytes`);
console.log(`First 128 bytes:`);
for (let i = 0; i < Math.min(128, brotliResult.length); i += 16) {
  let hex = '', ascii = '';
  for (let j = 0; j < 16 && i + j < brotliResult.length; j++) {
    const b = brotliResult[i + j];
    hex += b.toString(16).padStart(2, '0') + ' ';
    ascii += (b >= 32 && b < 127) ? String.fromCharCode(b) : '.';
  }
  console.log(`  ${i.toString(16).padStart(4)}: ${hex.padEnd(48)} ${ascii}`);
}

// Check for Parasolid markers
const text = brotliResult.toString('binary');
const psIdx = text.indexOf('PARASOLID');
const transmitIdx = text.indexOf('TRANSMIT');
console.log(`\nPARASOLID found: ${psIdx >= 0 ? 'YES at ' + psIdx : 'NO'}`);
console.log(`TRANSMIT found: ${transmitIdx >= 0 ? 'YES at ' + transmitIdx : 'NO'}`);

// Check if it's a PS file
if (brotliResult.length > 4 && brotliResult[0] === 0x50 && brotliResult[1] === 0x53) {
  console.log('>>> THIS IS A PARASOLID FILE!');
  fs.writeFileSync('D:\\karaza\\websites\\Karazas-website\\sldprt-research\\new-samples\\SLIDING-TABLE-parasolid.x_b', brotliResult);
  console.log('Saved as SLIDING-TABLE-parasolid.x_b');
}

// 2. Analyze Definition stream
console.log('\n=== Definition stream ===');
const defEntry = parser.directory.find(e => e.name === 'Definition');
const defData = new Uint8Array(parser.readStream(defEntry));
console.log(`Size: ${defData.length} bytes`);

// Full hex dump
for (let i = 0; i < defData.length; i += 16) {
  let hex = '', ascii = '';
  for (let j = 0; j < 16 && i + j < defData.length; j++) {
    const b = defData[i + j];
    hex += b.toString(16).padStart(2, '0') + ' ';
    ascii += (b >= 32 && b < 127) ? String.fromCharCode(b) : '.';
  }
  console.log(`  ${i.toString(16).padStart(4)}: ${hex.padEnd(48)} ${ascii}`);
}

// The first byte 0x1A (26) — check if this is a Parasolid transmit file header
// Parasolid transmit files start with a magic number followed by version info
if (defData[0] === 0x1A) {
  const magic = defData[0];
  const version = defData[1] | (defData[2] << 8);
  const type = defData[3];
  console.log(`\nParasolid transmit header: magic=0x${magic.toString(16)} version=${version} type=${type}`);
}

// 3. Analyze Config-0 for vertex data
console.log('\n=== Config-0 vertex analysis ===');
const config0Entry = parser.directory.find(e => e.name === 'Config-0');
const c0Data = new Uint8Array(parser.readStream(config0Entry));
console.log(`Config-0 size: ${c0Data.length} bytes`);

const c0dv = new DataView(c0Data.buffer, c0Data.byteOffset, c0Data.byteLength);

// Extract ALL valid float64 values
const allFloats = [];
for (let i = 0; i <= c0Data.length - 8; i += 8) {
  try {
    const val = c0dv.getFloat64(i, true);
    if (isFinite(val) && Math.abs(val) < 100000 && !isNaN(val)) {
      allFloats.push({ offset: i, value: val });
    }
  } catch(e) {}
}
console.log(`Total valid float64 values: ${allFloats.length}`);

// Find consecutive groups of 3+ valid floats (potential coordinates)
const groups = [];
let current = null;
for (const f of allFloats) {
  if (current && f.offset === current.end + 8) {
    current.end = f.offset;
    current.values.push(f.value);
  } else {
    if (current && current.values.length >= 3) {
      groups.push(current);
    }
    current = { start: f.offset, end: f.offset, values: [f.value] };
  }
}
if (current && current.values.length >= 3) groups.push(current);

console.log(`Groups of 3+ consecutive valid floats: ${groups.length}`);

// Check for coordinate triplets with reasonable ranges
let coordCount = 0;
const vertices = [];
for (const g of groups) {
  for (let i = 0; i <= g.values.length - 3; i += 3) {
    const x = g.values[i];
    const y = g.values[i+1];
    const z = g.values[i+2];
    if (Math.abs(x) < 10000 && Math.abs(y) < 10000 && Math.abs(z) < 10000 &&
        (Math.abs(x) > 0.001 || Math.abs(y) > 0.001 || Math.abs(z) > 0.001)) {
      vertices.push({ x, y, z });
      coordCount++;
    }
  }
}
console.log(`Coordinate triplets: ${coordCount}`);

// Show first 30 vertices
if (vertices.length > 0) {
  console.log('\nFirst 30 vertices:');
  vertices.slice(0, 30).forEach((v, i) => {
    console.log(`  ${i}: [${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)}]`);
  });
  
  // Bounding box
  const xs = vertices.map(v => v.x);
  const ys = vertices.map(v => v.y);
  const zs = vertices.map(v => v.z);
  console.log(`\nBounding box:`);
  console.log(`  X: ${Math.min(...xs).toFixed(4)} to ${Math.max(...xs).toFixed(4)}`);
  console.log(`  Y: ${Math.min(...ys).toFixed(4)} to ${Math.max(...ys).toFixed(4)}`);
  console.log(`  Z: ${Math.min(...zs).toFixed(4)} to ${Math.max(...zs).toFixed(4)}`);
}

// Also try brotli on Config-0
console.log('\n--- Trying brotli on Config-0 ---');
for (let skip = 0; skip <= 100; skip += 2) {
  try {
    const result = zlib.brotliDecompressSync(c0Data.slice(skip));
    if (result.length > 100) {
      console.log(`  brotli @ ${skip}: ${result.length} bytes`);
    }
  } catch(e) {}
}
