const fs = require('fs');
const { Ole2Parser } = require('./ole2-parser.js');

const filePath = 'D:\\karaza\\websites\\Karazas-website\\sldprt-research\\new-samples\\SLIDING TABLE.SLDPRT';
const buf = fs.readFileSync(filePath);
const parser = new Ole2Parser(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
parser.parse();

const body = parser.directory.find(e => e.name === 'Config-0-Body');
const data = new Uint8Array(parser.readStream(body));
console.log(`Config-0-Body: ${data.length} bytes`);

// The Config-0-Body appears to be a Parasolid serialization
// Let me try to parse it as a sequence of records

// First, let's look at the data after the header (24 bytes)
// and find ALL string-like sequences
console.log('\n=== Looking for class names in Config-0-Body ===');
const classNames = [];
for (let i = 0; i < data.length - 10; i++) {
  // Check for patterns like: [2 bytes] [2 bytes length] [class name ending in _c]
  if (data[i] === 0xFF && data[i+1] === 0xFF && i + 4 < data.length) {
    const nameLen = data[i+2] | (data[i+3] << 8);
    if (nameLen > 3 && nameLen < 200 && i + 4 + nameLen <= data.length) {
      let name = '';
      let valid = true;
      for (let j = 0; j < nameLen; j++) {
        const ch = data[i + 4 + j];
        if (ch >= 0x20 && ch < 0x7f) name += String.fromCharCode(ch);
        else { valid = false; break; }
      }
      if (valid && name.length > 3 && /_c$/.test(name)) {
        classNames.push({ offset: i, name });
        console.log(`  ${i.toString(16).padStart(6)}: ${name}`);
      }
    }
  }
}

// Now let's try to find the vertex data
// In Parasolid serialization, vertices might be stored as:
// - Float64 triplets (X, Y, Z)
// - Or as a special record type

// Let me look for the pattern of coordinates that would make sense
// for a mechanical part (mm units, typically 0-500 range)
console.log('\n=== Looking for vertex data regions ===');

// Strategy: Find consecutive valid float64 values that form a pattern
// A vertex typically has X, Y, Z followed by more vertex data
const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);

// Find all valid float64 values
const validFloats = [];
for (let i = 0; i <= data.length - 8; i += 8) {
  try {
    const val = dv.getFloat64(i, true);
    if (isFinite(val) && Math.abs(val) < 10000 && !isNaN(val)) {
      validFloats.push({ offset: i, value: val });
    }
  } catch(e) {}
}

// Group consecutive valid floats
const groups = [];
let currentGroup = null;
for (const f of validFloats) {
  if (currentGroup && f.offset === currentGroup.end + 8) {
    currentGroup.end = f.offset;
    currentGroup.values.push(f.value);
  } else {
    if (currentGroup && currentGroup.values.length >= 6) {
      groups.push(currentGroup);
    }
    currentGroup = { start: f.offset, end: f.offset, values: [f.value] };
  }
}
if (currentGroup && currentGroup.values.length >= 6) {
  groups.push(currentGroup);
}

console.log(`Found ${groups.length} groups of 6+ consecutive valid float64 values:`);
for (const g of groups) {
  console.log(`  ${g.start.toString(16).padStart(6)}-${g.end.toString(16).padStart(6)}: ${g.values.length} values`);
  // Show first 12 values
  console.log(`    First 12: [${g.values.slice(0, 12).map(v => v.toFixed(4)).join(', ')}]`);
}

// Try to find the actual vertex data by looking for coordinate triplets
// that form a reasonable bounding box
console.log('\n=== Looking for bounding box ===');

// For each group, check if the values could form a bounding box
for (const g of groups) {
  if (g.values.length < 6) continue;
  
  // Try to interpret as XYZ coordinates
  const xs = [], ys = [], zs = [];
  for (let i = 0; i < g.values.length - 2; i += 3) {
    xs.push(g.values[i]);
    ys.push(g.values[i + 1]);
    zs.push(g.values[i + 2]);
  }
  
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  
  const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
  
  // Check if this looks like a mechanical part bounding box
  if (dx > 1 && dx < 5000 && dy > 1 && dy < 5000 && dz > 1 && dz < 5000) {
    console.log(`  ${g.start.toString(16)}: Bbox [${minX.toFixed(1)}-${maxX.toFixed(1)}, ${minY.toFixed(1)}-${maxY.toFixed(1)}, ${minZ.toFixed(1)}-${maxZ.toFixed(1)}]`);
    console.log(`    ${g.values.length} values → ~${Math.floor(g.values.length / 3)} vertices`);
  }
}

// Now let's try a completely different approach
// Let me look at the raw bytes and try to find a pattern
console.log('\n=== Raw byte patterns ===');

// The Config-0-Body header is: 8b 91 01 00 01 06 48 6c 90 04 49 90 c4 86 e6 59
// Let me try to interpret this as a 24-byte header with specific fields
console.log('Header analysis:');
for (let i = 0; i < 24; i += 2) {
  const val16 = data[i] | (data[i+1] << 8);
  const val32 = data[i] | (data[i+1] << 8) | (data[i+2] << 16) | (data[i+3] << 24);
  console.log(`  ${i.toString(16).padStart(2)}: ${data[i].toString(16).padStart(2)} ${data[i+1].toString(16).padStart(2)} = uint16=${val16} | uint32=${val32}`);
}

// Let me try to find where the class names are
// and what surrounds them
console.log('\n=== Context around class names ===');
for (const cn of classNames.slice(0, 5)) {
  console.log(`\n${cn.name} at ${cn.offset.toString(16)}:`);
  // Show 32 bytes before and 32 bytes after
  const start = Math.max(0, cn.offset - 32);
  const end = Math.min(data.length, cn.offset + 32 + cn.name.length);
  let hex = '', ascii = '';
  for (let i = start; i < end; i++) {
    hex += data[i].toString(16).padStart(2, '0') + ' ';
    ascii += (data[i] >= 32 && data[i] < 127) ? String.fromCharCode(data[i]) : '.';
    if ((i - start + 1) % 16 === 0) {
      console.log(`    ${start.toString(16).padStart(4)}: ${hex.padEnd(48)} ${ascii}`);
      hex = '';
      ascii = '';
    }
  }
}

// Let me try yet another approach
// Check if Config-0-Body might contain a zlib-compressed block
// after some initial uncompressed header
console.log('\n=== Looking for zlib blocks at various offsets ===');
const zlib = require('zlib');
for (let offset = 24; offset < Math.min(data.length - 2, 2000); offset++) {
  if (data[offset] === 0x78 && (data[offset+1] === 0x01 || data[offset+1] === 0x9C || data[offset+1] === 0xDA)) {
    try {
      const result = zlib.inflateRawSync(data.slice(offset + 2), { maxOutputLength: 50*1024*1024 });
      if (result.length > 100) {
        const text = result.toString('binary');
        const isPS = result[0] === 0x50 && result[1] === 0x53;
        console.log(`  zlib at ${offset.toString(16)}: ${result.length} bytes ${isPS ? '>>> PS! >>>' : ''}`);
        if (isPS || text.includes('PARASOLID') || text.includes('TRANSMIT')) {
          fs.writeFileSync(
            'D:\\karaza\\websites\\Karazas-website\\sldprt-research\\new-samples\\parasolid-from-body.bin',
            result
          );
          console.log('  SAVED!');
        }
      }
    } catch(e) {}
  }
}

// Also try finding zlib blocks within ALL streams
console.log('\n=== Searching ALL streams for zlib blocks ===');
for (const entry of parser.directory) {
  const data = new Uint8Array(parser.readStream(entry));
  for (let offset = 0; offset < Math.min(data.length - 2, 5000); offset++) {
    if (data[offset] === 0x78 && (data[offset+1] === 0x01 || data[offset+1] === 0x9C || data[offset+1] === 0xDA)) {
      try {
        const result = zlib.inflateRawSync(data.slice(offset + 2), { maxOutputLength: 50*1024*1024 });
        if (result.length > 100) {
          const text = result.toString('binary');
          const isPS = result[0] === 0x50 && result[1] === 0x53;
          const hasPS = text.includes('PARASOLID') || text.includes('TRANSMIT');
          console.log(`  ${entry.name} @ ${offset.toString(16)}: ${result.length} bytes ${isPS ? '>>> PS! >>>' : ''} ${hasPS ? '>>> HAS PS STRINGS! >>>' : ''}`);
        }
      } catch(e) {}
    }
  }
}
