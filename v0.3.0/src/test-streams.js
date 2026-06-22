const fs = require('fs');
const zlib = require('zlib');
const { parseOLE2, readStream, _concatChunks, ensureBuffer } = require('./ole2-parser.js');

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

function readMiniStreamBytes(buf, ole, entry) {
  const rootEntry = ole.entries.find(e => e.name === 'Root Entry');
  const rootData = readRawStreamBytes(buf, ole.fat, rootEntry, ole.ss);
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
    chunks.push(rootData.subarray(ms * 64, Math.min((ms + 1) * 64, rootData.length)));
  }
  return ensureBuffer(_concatChunks(chunks).subarray(0, entry.size));
}

function safeRead(buf, ole, entry) {
  if (entry.size < 4096) return readMiniStreamBytes(buf, ole, entry);
  return ensureBuffer(readStream(buf, ole.fat, entry, ole.ss));
}

const files = [
  ['chainwheel', 'C:\\Users\\basha\\Desktop\\soldiworks research\\test files original\\chainwheel.sldprt'],
  ['SW2000', 'C:\\Users\\basha\\Desktop\\soldiworks research\\test files original\\SW2000-s01.SLDPRT'],
];

for (const [label, path] of files) {
  console.log('\n===== ' + label + ' =====');
  const buf = fs.readFileSync(path);
  const ole = parseOLE2(buf);
  
  // List ALL streams with sizes
  console.log('All entries:');
  for (const e of ole.entries) {
    const typeStr = e.type === 0 ? 'stor' : e.type === 1 ? 'stor' : e.type === 2 ? 'stm ' : '?';
    console.log('  [' + typeStr + '] ' + e.name + ' (' + e.size + ' bytes, sector=' + e.startSector + ')');
  }

  // Check for Config-0-Partition
  const configPart = ole.entries.find(e => e.name.includes('Config-0-Partition'));
  if (configPart) {
    console.log('\nFound Config-0-Partition! Size:', configPart.size);
    const data = safeRead(buf, ole, configPart);
    console.log('First 32:', Array.from(data.subarray(0, 32)).map(b => b.toString(16).padStart(2, '0')).join(' '));
    
    // Try decompression with/without zlib header prepended
    for (let skip = 0; skip <= 20; skip++) {
      for (const [name, fn] of [
        ['zlib', d => zlib.inflateSync(d)],
        ['raw', d => zlib.inflateRawSync(d)],
      ]) {
        try {
          const d = fn(data.subarray(skip));
          if (d.length > 50) {
            console.log(name + '@' + skip + ': ' + d.length + ' bytes, first 32:', Array.from(d.subarray(0, 32)).map(b => b.toString(16).padStart(2, '0')).join(' '));
          }
        } catch(e) {}
      }
    }
    
    // Try prepending zlib header bytes
    for (const header of [Buffer.from([0x78, 0x01]), Buffer.from([0x78, 0x5E]), Buffer.from([0x78, 0x9C]), Buffer.from([0x78, 0xDA])]) {
      for (let skip = 0; skip <= 10; skip++) {
        try {
          const combined = Buffer.concat([header, data.subarray(skip)]);
          const d = zlib.inflateSync(combined);
          if (d.length > 50) {
            console.log('prepend ' + Array.from(header).map(b => b.toString(16)).join('') + ' + skip@' + skip + ': ' + d.length + ' bytes, first 32:', Array.from(d.subarray(0, 32)).map(b => b.toString(16).padStart(2, '0')).join(' '));
          }
        } catch(e) {}
      }
    }
  } else {
    console.log('\nNo Config-0-Partition found');
    
    // Check Config-0-Body
    const configBody = ole.entries.find(e => e.name === 'Config-0-Body');
    if (configBody) {
      console.log('\nConfig-0-Body: ' + configBody.size + ' bytes');
      const data = safeRead(buf, ole, configBody);
      console.log('First 64:', Array.from(data.subarray(0, 64)).map(b => b.toString(16).padStart(2, '0')).join(' '));
      
      // Search for zlib headers (78 xx) in the body
      console.log('Searching for zlib headers in Config-0-Body...');
      for (let i = 0; i < data.length - 2; i++) {
        if (data[i] === 0x78 && (data[i+1] === 0x01 || data[i+1] === 0x5E || data[i+1] === 0x9C || data[i+1] === 0xDA)) {
          try {
            const d = zlib.inflateSync(data.subarray(i));
            if (d.length > 100) {
              console.log('zlib header at ' + i + ': decompressed ' + d.length + ' bytes');
              console.log('  first 64:', Array.from(d.subarray(0, 64)).map(b => b.toString(16).padStart(2, '0')).join(' '));
            }
          } catch(e) {}
          try {
            const d = zlib.inflateRawSync(data.subarray(i + 2));
            if (d.length > 100) {
              console.log('zlib-raw (skip header) at ' + i + ': decompressed ' + d.length + ' bytes');
              console.log('  first 64:', Array.from(d.subarray(0, 64)).map(b => b.toString(16).padStart(2, '0')).join(' '));
            }
          } catch(e) {}
        }
      }
      
      // Also try to find 78 01 hidden headers (the forum says they drop the lead-in)
      console.log('\nTrying to find hidden zlib blocks...');
      for (let i = 0; i < data.length - 6; i++) {
        // Check if the data starting at i could be a zlib stream without its header
        // by prepending 78 01
        if (i + 2 <= data.length) {
          try {
            const combined = Buffer.concat([Buffer.from([0x78, 0x01]), data.subarray(i)]);
            const d = zlib.inflateSync(combined);
            if (d.length > 200) {
              console.log('Hidden zlib@' + i + ': ' + d.length + ' bytes');
              console.log('  first 64:', Array.from(d.subarray(0, 64)).map(b => b.toString(16).padStart(2, '0')).join(' '));
            }
          } catch(e) {}
        }
      }
    }
  }
  
  // Also check CMgr and CMgrHdr streams
  for (const name of ['CMgr', 'CMgrHdr']) {
    const e = ole.entries.find(x => x.name === name);
    if (e) {
      console.log('\n' + name + ': ' + e.size + ' bytes');
      try {
        const data = safeRead(buf, ole, e);
        console.log('  first 32:', Array.from(data.subarray(0, 32)).map(b => b.toString(16).padStart(2, '0')).join(' '));
      } catch(err) {
        console.log('  error:', err.message);
      }
    }
  }
}
