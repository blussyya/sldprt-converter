const fs = require('fs');
const zlib = require('zlib');
const { parseOLE2, readStream, _concatChunks, ensureBuffer } = require('./ole2-parser.js');

function readRawStream(buf, fat, entry, ss) {
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
  return ensureBuffer(_concatChunks(chunks).subarray(0, entry.size));
}

function readMiniStream(buf, ole, entry) {
  const rootEntry = ole.entries.find(e => e.name === 'Root Entry');
  const miniStream = readRawStream(buf, ole.fat, rootEntry, ole.ss);
  const miniFatStartSec = buf.readInt32LE(0x3C);
  const totalMiniFatSec = buf.readUInt32LE(0x40);
  const miniFAT = [];
  for (let s = 0; s < totalMiniFatSec; s++) {
    let cur = miniFatStartSec;
    for (let j = 0; j < s; j++) cur = ole.fat[cur] ?? -1;
    const off = (cur + 1) * ole.ss;
    for (let i = 0; i < ole.ss / 4; i++) miniFAT.push(buf.readInt32LE(off + i * 4));
  }
  let cur = entry.startSector;
  const chain = [];
  let safety = 100;
  while (cur >= 0 && cur < 0xfffe_fffe && safety-- > 0) { chain.push(cur); cur = miniFAT[cur] ?? -1; }
  const chunks = [];
  for (const ms of chain) {
    chunks.push(miniStream.subarray(ms * 64, Math.min((ms + 1) * 64, miniStream.length)));
  }
  return Buffer.from(ensureBuffer(_concatChunks(chunks)).subarray(0, entry.size));
}

function safeReadStream(buf, ole, entry) {
  if (entry.size < 4096) return readMiniStream(buf, ole, entry);
  return Buffer.from(readStream(buf, ole.fat, entry, ole.ss));
}

// === Test: chainwheel Config-0-Body ===
const buf = fs.readFileSync('C:\\\\Users\\\\basha\\\\Desktop\\\\soldiworks research\\\\test files original\\\\chainwheel.sldprt');
const ole = parseOLE2(buf);
const cbEntry = ole.entries.find(e => e.name === 'Config-0-Body');
const cbData = safeReadStream(buf, ole, cbEntry);
console.log('Config-0-Body: ' + cbData.length + ' bytes');
console.log('First 32:', Array.from(cbData.subarray(0, 32)).map(b => b.toString(16).padStart(2, '0')).join(' '));

// First 4 bytes = size (LE), then 01 06 header
for (let skip = 0; skip <= 16; skip++) {
  for (const [name, fn] of [
    ['zlib', d => zlib.inflateSync(d)],
    ['raw', d => zlib.inflateRawSync(d)],
    ['brotli', d => zlib.brotliDecompressSync(d)],
  ]) {
    try {
      const d = fn(cbData.subarray(skip));
      if (d.length > 50) {
        console.log(name + '@' + skip + ': OK, ' + d.length + ' bytes');
        console.log('  hex:', Array.from(d.subarray(0, 48)).map(b => b.toString(16).padStart(2, '0')).join(' '));
      }
    } catch(e) {}
  }
}

// === Search for openswx marker in all streams ===
const marker = Buffer.from([0x14, 0x00, 0x06, 0x00, 0x08, 0x00]);
console.log('\nSearching for openswx marker in all streams...');
for (const e of ole.entries) {
  if (e.type !== 2 || e.size < 20) continue;
  let data;
  try { data = safeReadStream(buf, ole, e); } catch(err) { continue; }
  if (!data) continue;
  for (let i = 0; i <= data.length - marker.length; i++) {
    let match = true;
    for (let j = 0; j < marker.length; j++) {
      if (data[i+j] !== marker[j]) { match = false; break; }
    }
    if (match) {
      console.log('Found openswx marker in "' + e.name + '" at offset ' + i);
      console.log('  context:', Array.from(data.subarray(Math.max(0, i-8), Math.min(data.length, i+32))).map(b => b.toString(16).padStart(2, '0')).join(' '));
    }
  }
}

// === Search for 16-byte magic from FreeCAD forum ===
const magic16 = Buffer.from([0x23, 0x1d, 0xd5, 0x71, 0xda, 0x81, 0x48, 0xa2, 0xa8, 0x58, 0x98, 0xb2, 0x1b, 0x89, 0xef, 0x99]);
console.log('\nSearching for 16-byte magic in all streams...');
for (const e of ole.entries) {
  if (e.type !== 2 || e.size < 20) continue;
  let data;
  try { data = safeReadStream(buf, ole, e); } catch(err) { continue; }
  if (!data) continue;
  for (let i = 0; i <= data.length - magic16.length; i++) {
    let match = true;
    for (let j = 0; j < magic16.length; j++) {
      if (data[i+j] !== magic16[j]) { match = false; break; }
    }
    if (match) {
      console.log('Found 16-byte magic in "' + e.name + '" at offset ' + i);
    }
  }
}

// === Now try the openswx approach on the raw DisplayLists__Zip ===
// The openswx format uses a key byte at buf[7] for ROL decoding of stream names
// Maybe these OLE2 DisplayLists__Zip streams use the same approach
console.log('\nTrying openswx-style decompression on DisplayLists__Zip...');

function rolByte(b, shift) {
  shift &= 7;
  if (shift === 0) return b;
  return ((b << shift) | (b >>> (8 - shift))) & 0xFF;
}

const dlEntry = ole.entries.find(e => e.name === 'DisplayLists__Zip' && e.type === 2);
const dlData = safeReadStream(buf, ole, dlEntry);
console.log('DL__Zip: ' + dlData.length + ' bytes');
console.log('First 32:', Array.from(dlData.subarray(0, 32)).map(b => b.toString(16).padStart(2, '0')).join(' '));

// Try the exact openswx decompression on this data
// Key from the OLE2 header byte 7 = 0xE1 = 225 (but for openswx, key is typically 0-7)
// Actually, let's try keys 1-7 on the data starting after the 8-byte header
for (const key of [1, 2, 3, 4, 5, 6, 7, 0xE1]) {
  // ROL the entire stream
  const decoded = Buffer.from(dlData);
  for (let i = 0; i < decoded.length; i++) {
    decoded[i] = rolByte(decoded[i], key);
  }
  console.log('ROL ALL key=' + key + ': ' + Array.from(decoded.subarray(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' '));
  try { const d = zlib.inflateSync(decoded.subarray(8)); console.log('  +zlib@8: ' + d.length + ' bytes'); } catch(e) {}
  try { const d = zlib.inflateRawSync(decoded.subarray(8)); console.log('  +raw@8: ' + d.length + ' bytes'); } catch(e) {}
  try { const d = zlib.inflateSync(decoded.subarray(6)); console.log('  +zlib@6: ' + d.length + ' bytes'); } catch(e) {}
  try { const d = zlib.inflateRawSync(decoded.subarray(6)); console.log('  +raw@6: ' + d.length + ' bytes'); } catch(e) {}
}

// === The key insight: maybe this is just uncompressed vertex data in a different format ===
// Maybe it uses a different vertex layout (e.g., 16-bit or compressed coordinates)
// Let me check if the data could be:
// - A sequence of (int16, int16, int16) vertices
// - Or a sequence of delta-encoded vertices
console.log('\nTrying to interpret as various vertex formats...');

// Try int16 vertices
let int16Count = 0;
for (let i = 0; i <= dlData.length - 6; i += 6) {
  const x = dlData.readInt16LE(i) / 100;
  const y = dlData.readInt16LE(i + 2) / 100;
  const z = dlData.readInt16LE(i + 4) / 100;
  if (Math.abs(x) < 1000 && Math.abs(y) < 1000 && Math.abs(z) < 1000 &&
      (x !== 0 || y !== 0 || z !== 0)) int16Count++;
}
console.log('int16/100 vertices in valid range:', int16Count);

// Try uint16 vertices
let uint16Count = 0;
for (let i = 0; i <= dlData.length - 6; i += 6) {
  const x = dlData.readUInt16LE(i) / 100;
  const y = dlData.readUInt16LE(i + 2) / 100;
  const z = dlData.readUInt16LE(i + 4) / 100;
  if (x > 0 && x < 10000 && y > 0 && y < 10000 && z > 0 && z < 10000) uint16Count++;
}
console.log('uint16/100 vertices in valid range:', uint16Count);
