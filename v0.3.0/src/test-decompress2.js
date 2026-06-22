const fs = require('fs');
const zlib = require('zlib');
const { parseOLE2, readStream, _concatChunks, ensureBuffer } = require('./ole2-parser.js');

// ===== Test SW2000-s01 mini stream =====
const buf2k = fs.readFileSync('C:\\Users\\basha\\Desktop\\soldiworks research\\test files original\\SW2000-s01.SLDPRT');
const ole2k = parseOLE2(buf2k);
const dl2k = ole2k.entries.find(e => e.name === 'DisplayLists__Zip' && e.type === 2);
console.log('SW2000 DL__Zip: size=' + dl2k.size + ' startSector=' + dl2k.startSector);

// Mini stream cutoff from header offset 0x38
const miniCutoff = buf2k.readUInt32LE(0x38);
console.log('Mini stream cutoff:', miniCutoff);

// Root Entry
const rootEntry = ole2k.entries.find(e => e.name === 'Root Entry');
console.log('Root Entry: size=' + rootEntry.size + ' startSector=' + rootEntry.startSector);

// Read mini stream (Root Entry data contains the mini stream)
function readRawStreamBytes(buf, fat, entry, ss) {
  buf = ensureBuffer(buf);
  const chunks = [];
  let cur = entry.startSector;
  const visited = new Set();
  while (cur >= 0 && cur < 0xfffe_fffe && !visited.has(cur)) {
    visited.add(cur);
    const off = (cur + 1) * ss;
    if (off + ss > buf.length) break;
    chunks.push(buf.subarray(off, off + ss));
    cur = fat[cur] ?? -1;
  }
  return ensureBuffer(_concatChunks(chunks));
}

// Build mini FAT
const miniFatStartSec = buf2k.readInt32LE(0x3C);
const totalMiniFatSec = buf2k.readUInt32LE(0x40);
console.log('Mini FAT start sector:', miniFatStartSec, 'total:', totalMiniFatSec);

const miniFAT = [];
for (let s = 0; s < totalMiniFatSec; s++) {
  let cur = miniFatStartSec;
  for (let j = 0; j < s; j++) cur = ole2k.fat[cur] ?? -1;
  const off = (cur + 1) * ole2k.ss;
  for (let i = 0; i < ole2k.ss / 4; i++) {
    miniFAT.push(buf2k.readInt32LE(off + i * 4));
  }
}
console.log('Mini FAT entries:', miniFAT.length);

// Follow chain for DL__Zip
let cur = dl2k.startSector;
const chain = [];
let safety = 100;
while (cur >= 0 && cur < 0xfffe_fffe && safety-- > 0) {
  chain.push(cur);
  cur = miniFAT[cur] ?? -1;
}
console.log('Mini chain length:', chain.length, 'sectors:', chain.slice(0, 10).join(','), chain.length > 10 ? '...' : '');

// Read Root Entry data (this IS the mini stream)
const rootData = readRawStreamBytes(buf2k, ole2k.fat, rootEntry, ole2k.ss);
console.log('Root Entry data (mini stream):', rootData.length, 'bytes');

// Extract DL__Zip from mini stream
const chunks = [];
for (const ms of chain) {
  const start = ms * 64;
  const end = Math.min((ms + 1) * 64, rootData.length);
  chunks.push(rootData.subarray(start, end));
}
const dlData = ensureBuffer(_concatChunks(chunks).subarray(0, dl2k.size));
console.log('DL__Zip from mini stream:', dlData.length, 'bytes');
console.log('First 32:', Array.from(dlData.subarray(0, 32)).map(b => b.toString(16).padStart(2, '0')).join(' '));

// ===== Chainwheel analysis =====
console.log('\n===== Chainwheel =====');
const buf = fs.readFileSync('C:\\Users\\basha\\Desktop\\soldiworks research\\test files original\\chainwheel.sldprt');
const ole = parseOLE2(buf);
const dlEntry = ole.entries.find(e => e.name === 'DisplayLists__Zip' && e.type === 2);
const dlData2 = Buffer.from(readStream(buf, ole.fat, dlEntry, ole.ss));
console.log('DL__Zip: ' + dlData2.length + ' bytes');
console.log('First 64:', Array.from(dlData2.subarray(0, 64)).map(b => b.toString(16).padStart(2, '0')).join(' '));

// The header is: 01 06 c0 1f 24 41 12 24
// What if bytes 2-7 are a float or size?
console.log('Bytes 0-3 as uint32LE:', dlData2.readUInt32LE(0));
console.log('Bytes 2-5 as uint32LE:', dlData2.readUInt32LE(2));
console.log('Bytes 4-7 as uint32LE:', dlData2.readUInt32LE(4));
console.log('Bytes 0-3 as int32LE:', dlData2.readInt32LE(0));
console.log('Bytes 2-5 as int32LE:', dlData2.readInt32LE(2));

// Try all possible skip values with inflateRaw
console.log('\nTrying inflateRaw with various skip offsets...');
for (let skip = 0; skip <= 32; skip++) {
  try {
    const d = zlib.inflateRawSync(dlData2.subarray(skip));
    if (d.length > 100) {
      console.log('inflateRaw@' + skip + ': ' + d.length + ' bytes! First 32:', Array.from(d.subarray(0, 32)).map(b => b.toString(16).padStart(2, '0')).join(' '));
    }
  } catch(e) {}
  try {
    const d = zlib.inflateSync(dlData2.subarray(skip));
    if (d.length > 100) {
      console.log('inflate@' + skip + ': ' + d.length + ' bytes! First 32:', Array.from(d.subarray(0, 32)).map(b => b.toString(16).padStart(2, '0')).join(' '));
    }
  } catch(e) {}
  try {
    const d = zlib.brotliDecompressSync(dlData2.subarray(skip));
    if (d.length > 100) {
      console.log('brotli@' + skip + ': ' + d.length + ' bytes! First 32:', Array.from(d.subarray(0, 32)).map(b => b.toString(16).padStart(2, '0')).join(' '));
    }
  } catch(e) {}
}

// Check for LZMA signature
console.log('\nChecking for LZMA signatures...');
for (let i = 0; i <= Math.min(dlData2.length - 13, 50); i++) {
  // LZMA properties byte is typically 0x5D with dictionary sizes
  const props = dlData2[i];
  if (props === 0x5D && i + 13 <= dlData2.length) {
    const dictSize = dlData2.readUInt32LE(i + 1);
    const uncompressedSize = dlData2.readBigUInt64LE(i + 5);
    console.log('Possible LZMA at ' + i + ': props=0x' + props.toString(16) + ' dict=' + dictSize + ' uncompSize=' + uncompressedSize.toString());
  }
}

// Try LZMA via child_process
const { execSync } = require('child_process');
try {
  // Write raw data to temp file and try xz -d
  const tmpIn = 'C:\\Users\\basha\\Desktop\\soldiworks research\\v0.3.0\\tmp_in.bin';
  const tmpOut = 'C:\\Users\\basha\\Desktop\\soldiworks research\\v0.3.0\\tmp_out.bin';
  fs.writeFileSync(tmpIn, dlData2);
  
  // Try various xz/lzma decompression approaches
  try {
    execSync('xz -d -f "' + tmpIn + '" 2>nul', { timeout: 5000 });
    console.log('xz decompression succeeded!');
    const result = fs.readFileSync(tmpIn);
    console.log('xz result: ' + result.length + ' bytes');
  } catch(e) { /* xz failed */ }
  
  try {
    fs.copyFileSync(tmpIn, tmpOut);
    execSync('xz -d -f "' + tmpOut + '" 2>nul', { timeout: 5000 });
    console.log('xz decompression 2 succeeded!');
  } catch(e) { /* xz failed 2 */ }
} catch(e) {
  console.log('child_process approach failed:', e.message);
}

// Try: what if the stream has a custom block structure?
// Many proprietary formats use block-based compression
// Block header might contain: block_size (compressed), then compressed data
console.log('\nChecking for block structure...');
// Look for repeating patterns that might indicate block boundaries
const blockSizes = new Map();
for (let i = 8; i < dlData2.length - 4; i++) {
  const sz = dlData2.readUInt32LE(i);
  if (sz > 10 && sz < dlData2.length && i + 4 + sz <= dlData2.length) {
    // Check if at the next block boundary there's another similar size
    const nextI = i + 4 + sz;
    if (nextI < dlData2.length - 4) {
      const sz2 = dlData2.readUInt32LE(nextI);
      if (sz2 > 10 && sz2 < dlData2.length) {
        const key = sz.toString();
        blockSizes.set(key, (blockSizes.get(key) || 0) + 1);
      }
    }
  }
}
// Show most common block sizes
const sorted = [...blockSizes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
if (sorted.length > 0) {
  console.log('Potential block sizes:', sorted.map(([sz, cnt]) => sz + '(' + cnt + ')').join(', '));
}
