const fs = require('fs');
const zlib = require('zlib');
const { Ole2Parser } = require('./ole2-parser.js');

const filePath = 'D:\\karaza\\websites\\Karazas-website\\sldprt-research\\new-samples\\SLIDING TABLE.SLDPRT';
const buf = fs.readFileSync(filePath);
const parser = new Ole2Parser(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
parser.parse();

// Extract brotli-decompressed DisplayLists
const dl = parser.directory.find(e => e.name === 'DisplayLists__Zip');
const dlData = new Uint8Array(parser.readStream(dl));
const decompressed = zlib.brotliDecompressSync(dlData.slice(14), { maxOutputLength: 50*1024*1024 });
console.log(`DisplayLists decompressed: ${decompressed.length} bytes`);

// The decompressed data might be a custom binary format
// Let me analyze it byte by byte
const dv = new DataView(decompressed.buffer, decompressed.byteOffset, decompressed.byteLength);

// Try to interpret as sequences of float32 values
// (SolidWorks API returns triangles as float arrays)
console.log('\n=== Looking for float32 vertex data ===');
const vertices = [];
for (let i = 0; i <= decompressed.length - 12; i += 4) {
  try {
    const x = dv.getFloat32(i, true);
    const y = dv.getFloat32(i + 4, true);
    const z = dv.getFloat32(i + 8, true);
    if (isFinite(x) && isFinite(y) && isFinite(z) &&
        Math.abs(x) < 10000 && Math.abs(y) < 10000 && Math.abs(z) < 10000 &&
        (Math.abs(x) > 0.0001 || Math.abs(y) > 0.0001 || Math.abs(z) > 0.0001)) {
      vertices.push({ offset: i, x, y, z });
    }
  } catch(e) {}
}
console.log(`Potential float32 vertices: ${vertices.length}`);
if (vertices.length > 0) {
  console.log('First 20:');
  vertices.slice(0, 20).forEach(v => {
    console.log(`  ${v.offset.toString(16).padStart(4)}: [${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)}]`);
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

// Try to interpret as int32 indices
console.log('\n=== Looking for int32 index patterns ===');
const indices = [];
for (let i = 0; i <= decompressed.length - 12; i += 4) {
  try {
    const a = dv.getUint32(i, true);
    const b = dv.getUint32(i + 4, true);
    const c = dv.getUint32(i + 8, true);
    if (a < 100000 && b < 100000 && c < 100000 &&
        a !== b && a !== c && b !== c) {
      indices.push({ offset: i, a, b, c });
    }
  } catch(e) {}
}
console.log(`Potential int32 index triplets: ${indices.length}`);
if (indices.length > 0) {
  console.log('First 20:');
  indices.slice(0, 20).forEach(f => {
    console.log(`  ${f.offset.toString(16).padStart(4)}: [${f.a}, ${f.b}, ${f.c}]`);
  });
}

// Try to interpret as int16 values
console.log('\n=== Looking for int16 vertex data ===');
const int16vertices = [];
for (let i = 0; i <= decompressed.length - 6; i += 2) {
  try {
    const x = dv.getInt16(i, true);
    const y = dv.getInt16(i + 2, true);
    const z = dv.getInt16(i + 4, true);
    if (Math.abs(x) < 10000 && Math.abs(y) < 10000 && Math.abs(z) < 10000 &&
        (Math.abs(x) > 0 || Math.abs(y) > 0 || Math.abs(z) > 0)) {
      int16vertices.push({ offset: i, x, y, z });
    }
  } catch(e) {}
}
console.log(`Potential int16 vertices: ${int16vertices.length}`);
if (int16vertices.length > 0) {
  console.log('First 20:');
  int16vertices.slice(0, 20).forEach(v => {
    console.log(`  ${v.offset.toString(16).padStart(4)}: [${v.x}, ${v.y}, ${v.z}]`);
  });
}

// Analyze the byte structure
console.log('\n=== Byte structure analysis ===');
// Count frequency of each byte value
const byteFreq = new Array(256).fill(0);
for (let i = 0; i < decompressed.length; i++) {
  byteFreq[decompressed[i]]++;
}
console.log('Top 20 byte values:');
byteFreq
  .map((count, value) => ({ value, count }))
  .sort((a, b) => b.count - a.count)
  .slice(0, 20)
  .forEach(({ value, count }) => {
    console.log(`  0x${value.toString(16).padStart(2, '0')}: ${count} (${(count/decompressed.length*100).toFixed(1)}%)`);
  });

// Try to find repeated patterns (potential structure markers)
console.log('\n=== Repeated 4-byte patterns ===');
const patterns = {};
for (let i = 0; i <= decompressed.length - 4; i++) {
  const p = decompressed[i] | (decompressed[i+1] << 8) | (decompressed[i+2] << 16) | (decompressed[i+3] << 24);
  if (!patterns[p]) patterns[p] = [];
  patterns[p].push(i);
}
const repeated = Object.entries(patterns)
  .filter(([_, offsets]) => offsets.length > 3)
  .sort((a, b) => b[1].length - a[1].length)
  .slice(0, 10);
console.log('Most repeated 4-byte patterns:');
for (const [pattern, offsets] of repeated) {
  const p = parseInt(pattern);
  const hex = [(p & 0xFF), ((p >> 8) & 0xFF), ((p >> 16) & 0xFF), ((p >> 24) & 0xFF)]
    .map(b => b.toString(16).padStart(2, '0')).join(' ');
  console.log(`  ${hex}: ${offsets.length} times (first at ${offsets[0].toString(16)})`);
}
