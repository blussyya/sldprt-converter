const fs = require('fs');
const zlib = require('zlib');
const { Ole2Parser } = require('./ole2-parser.js');

const filePath = 'D:\\karaza\\websites\\Karazas-website\\sldprt-research\\new-samples\\SLIDING TABLE.SLDPRT';
const buf = fs.readFileSync(filePath);
const parser = new Ole2Parser(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
parser.parse();

const body = parser.directory.find(e => e.name === 'Config-0-Body');
const data = new Uint8Array(parser.readStream(body));
console.log(`Config-0-Body: ${data.length} bytes`);

const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);

// The first 24 bytes are a header: 8b 91 01 00 01 06 48 6c 90 04 49 90 c4 86 e6 59
// After that, look for float64 values

// Strategy: Scan for clusters of consecutive valid float64 values
// that form coordinate triplets (XYZ patterns)
// In a B-Rep, we expect vertices as consecutive XYZ triplets

console.log('\n=== Strategy 1: Find consecutive XYZ triplets ===');
const vertices = [];
for (let i = 24; i <= data.length - 24; i += 8) {
  const x = dv.getFloat64(i, true);
  const y = dv.getFloat64(i + 8, true);
  const z = dv.getFloat64(i + 16, true);
  
  // Check if these look like coordinates (in mm, reasonable range)
  if (Math.abs(x) < 10000 && Math.abs(y) < 10000 && Math.abs(z) < 10000 &&
      !isNaN(x) && !isNaN(y) && !isNaN(z) &&
      (Math.abs(x) > 0.001 || Math.abs(y) > 0.001 || Math.abs(z) > 0.001)) {
    
    // Check if next triplet also looks like coordinates
    if (i + 32 <= data.length) {
      const x2 = dv.getFloat64(i + 24, true);
      const y2 = dv.getFloat64(i + 32, true);
      const z2 = dv.getFloat64(i + 40, true);
      
      if (Math.abs(x2) < 10000 && Math.abs(y2) < 10000 && Math.abs(z2) < 10000 &&
          !isNaN(x2) && !isNaN(y2) && !isNaN(z2)) {
        vertices.push({ offset: i, coords: [x, y, z, x2, y2, z2] });
      }
    }
  }
}

console.log(`Found ${vertices.length} potential vertex regions`);
if (vertices.length > 0) {
  console.log('First 20:');
  vertices.slice(0, 20).forEach(v => {
    console.log(`  ${v.offset.toString(16).padStart(6)}: [${v.coords.map(c => c.toFixed(4)).join(', ')}]`);
  });
}

// Strategy 2: Look for float64 values that match known dimensions
// SLIDING TABLE has dimensions ~112mm x 40mm x 6mm
console.log('\n=== Strategy 2: Search for values matching known dimensions ===');
const targetValues = [112.1426, 40.0674, 5.9861];
const dv2 = new DataView(data.buffer, data.byteOffset, data.byteLength);
for (const target of targetValues) {
  for (let i = 24; i <= data.length - 8; i += 8) {
    const val = dv2.getFloat64(i, true);
    if (Math.abs(val - target) < 0.01) {
      // Show context
      const context = [];
      for (let j = -32; j <= 32; j += 8) {
        if (i + j >= 0 && i + j + 8 <= data.length) {
          const v = dv2.getFloat64(i + j, true);
          const prefix = j === 0 ? '>>>' : '   ';
          context.push(`${prefix} ${(i+j).toString(16)}: ${v.toFixed(4)}`);
        }
      }
      console.log(`  Found ${target} at offset ${i.toString(16)}:`);
      context.forEach(c => console.log(`    ${c}`));
    }
  }
}

// Strategy 3: Try to find the mesh data section
// Look for a pattern of vertex data: many consecutive valid float64 values
console.log('\n=== Strategy 3: Find dense float64 regions ===');
const windowSize = 16; // Check 16 consecutive floats (6 vertices)
const denseRegions = [];
for (let i = 24; i <= data.length - windowSize * 8; i += 8) {
  let count = 0;
  for (let j = 0; j < windowSize; j++) {
    const val = dv2.getFloat64(i + j * 8, true);
    if (isFinite(val) && Math.abs(val) < 10000) count++;
  }
  if (count === windowSize) {
    // Check if this is start of a new dense region
    if (denseRegions.length === 0 || denseRegions[denseRegions.length-1].end < i - 16) {
      denseRegions.push({ start: i, end: i + windowSize * 8 });
    } else {
      denseRegions[denseRegions.length-1].end = i + windowSize * 8;
    }
  }
}

console.log(`Found ${denseRegions.length} dense regions:`);
for (const r of denseRegions) {
  const len = r.end - r.start;
  const vertexCount = Math.floor(len / 24); // 3 float64 per vertex
  console.log(`  ${r.start.toString(16).padStart(6)}-${r.end.toString(16).padStart(6)}: ${len} bytes (~${vertexCount} vertices)`);
  // Show first 6 values
  const vals = [];
  for (let i = r.start; i < Math.min(r.start + 48, data.length); i += 8) {
    vals.push(dv2.getFloat64(i, true).toFixed(4));
  }
  console.log(`    First values: [${vals.join(', ')}]`);
}

// Strategy 4: Extract ALL float64 values and try to identify coordinate patterns
console.log('\n=== Strategy 4: Extract all float64 values and cluster ===');
const allFloats = [];
for (let i = 24; i <= data.length - 8; i += 8) {
  const val = dv2.getFloat64(i, true);
  if (isFinite(val) && Math.abs(val) < 10000) {
    allFloats.push({ offset: i, value: val });
  }
}
console.log(`Total valid float64 values: ${allFloats.length}`);

// Group by value ranges
const ranges = {};
for (const f of allFloats) {
  const range = Math.round(f.value);
  if (!ranges[range]) ranges[range] = 0;
  ranges[range]++;
}
console.log('Value distribution (rounded):');
Object.entries(ranges)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20)
  .forEach(([range, count]) => {
    console.log(`  ${range}: ${count} values`);
  });

// Strategy 5: Try to extract vertices by looking for clusters of small values (near origin)
// Most vertices should be near the origin or at known positions
console.log('\n=== Strategy 5: Clusters near origin ===');
const nearOrigin = allFloats.filter(f => Math.abs(f.value) < 200);
console.log(`Values within [-200, 200]: ${nearOrigin.length}`);

// Try to find if there's a vertex count header
// The header might tell us how many vertices to expect
console.log('\n=== Checking for vertex count header ===');
for (let i = 24; i < Math.min(256, data.length); i += 4) {
  const int32 = dv2.getInt32(i, true);
  if (int32 > 100 && int32 < 1000000) {
    console.log(`  ${i.toString(16)}: ${int32} (potential vertex count)`);
  }
}

// Strategy 6: Try to extract faces/triangles
// Look for patterns of uint32/int32 indices
console.log('\n=== Strategy 6: Look for face index patterns ===');
const facePatterns = [];
for (let i = 24; i <= data.length - 12; i += 4) {
  const a = dv2.getUint32(i, true);
  const b = dv2.getUint32(i + 4, true);
  const c = dv2.getUint32(i + 8, true);
  // Face indices should be small positive integers
  if (a < 100000 && b < 100000 && c < 100000 &&
      a !== b && a !== c && b !== c) {
    facePatterns.push({ offset: i, indices: [a, b, c] });
  }
}
console.log(`Found ${facePatterns.length} potential face index patterns`);
if (facePatterns.length > 0) {
  console.log('First 20:');
  facePatterns.slice(0, 20).forEach(f => {
    console.log(`  ${f.offset.toString(16).padStart(6)}: [${f.indices.join(', ')}]`);
  });
}
