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

// Full hex dump of first 256 bytes
console.log('\n--- First 256 bytes ---');
for (let i = 0; i < 256; i += 16) {
  let hex = '', ascii = '';
  for (let j = 0; j < 16 && i + j < data.length; j++) {
    const b = data[i + j];
    hex += b.toString(16).padStart(2, '0') + ' ';
    ascii += (b >= 32 && b < 127) ? String.fromCharCode(b) : '.';
  }
  console.log(`  ${i.toString(16).padStart(4)}: ${hex.padEnd(48)} ${ascii}`);
}

// Search for Parasolid-related strings
console.log('\n--- Searching for Parasolid strings ---');
const text = data.toString('binary');
const parasolidStrings = ['PARASOLID', 'TRANSMIT FILE', 'modeller version', 'SCH_', 'PS ', 'PK_', 'BODY', 'FACE', 'EDGE', 'VERTEX'];
for (const s of parasolidStrings) {
  const idx = text.indexOf(s);
  if (idx >= 0) {
    console.log(`  Found "${s}" at offset ${idx}`);
    console.log(`    Context: ${text.substring(idx, idx + 80)}`);
  }
}

// Look for the PS header in different encodings
console.log('\n--- Searching for PS header ---');
// Big-endian PS\0\0 (neutral binary)
for (let i = 0; i < data.length - 4; i++) {
  if (data[i] === 0x50 && data[i+1] === 0x53 && data[i+2] === 0x00 && data[i+3] === 0x00) {
    console.log(`  PS NUL NUL at offset ${i}`);
  }
  // PS\0\1 (typed binary)
  if (data[i] === 0x50 && data[i+1] === 0x53 && data[i+2] === 0x00 && data[i+3] === 0x01) {
    console.log(`  PS NUL SOH at offset ${i}`);
  }
  // Bare binary 'B'
  if (data[i] === 0x42 && i > 0 && data[i-1] === 0x00) {
    console.log(`  Bare 'B' at offset ${i}`);
  }
}

// Try to find zlib-compressed Parasolid blocks
console.log('\n--- Searching for zlib blocks ---');
const foundBlocks = [];
for (let i = 0; i < data.length - 2; i++) {
  if (data[i] === 0x78 && (data[i+1] === 0x01 || data[i+1] === 0x9C || data[i+1] === 0xDA)) {
    try {
      const result = zlib.inflateRawSync(data.slice(i + 2), { maxOutputLength: 5 * 1024 * 1024 });
      if (result.length > 50) {
        const isPS = result.length > 4 && result[0] === 0x50 && result[1] === 0x53;
        const hasPSHeader = text.includes('PARASOLID') || result.toString('binary').includes('TRANSMIT');
        console.log(`  zlib at ${i}: ${result.length} bytes | PS=${isPS} TRANSMIT=${hasPSHeader}`);
        if (isPS) {
          fs.writeFileSync(filePath.replace(/\.[^.]+$/, '') + '-parasolid.x_b', result);
          console.log('  SAVED!');
        }
        foundBlocks.push({ offset: i, size: result.length, isPS });
      }
    } catch (e) {}
  }
}

// Analyze the Config-0 (metadata) stream for Parasolid info
console.log('\n--- Config-0 analysis ---');
const config0 = parser.directory.find(e => e.name === 'Config-0');
const c0data = new Uint8Array(parser.readStream(config0));

// Find all class names
const classNames = new Set();
for (let i = 0; i < c0data.length - 10; i++) {
  // Look for patterns: [2 bytes FF FF] [2 bytes length] [class name]
  if (c0data[i] === 0xFF && c0data[i+1] === 0xFF) {
    const nameLen = c0data[i+2] | (c0data[i+3] << 8);
    if (nameLen > 3 && nameLen < 100 && i + 4 + nameLen <= c0data.length) {
      let name = '';
      let valid = true;
      for (let j = 0; j < nameLen; j++) {
        const ch = c0data[i + 4 + j];
        if (ch >= 0x20 && ch < 0x7f) name += String.fromCharCode(ch);
        else { valid = false; break; }
      }
      if (valid && name.length > 3 && /_c$/.test(name)) {
        classNames.add(name);
      }
    }
  }
}
console.log(`  Class names: ${[...classNames].join(', ')}`);

// Find all UTF-16 strings
console.log('\n  UTF-16 strings:');
for (let i = 0; i < c0data.length - 4; i++) {
  if (c0data[i] >= 0x20 && c0data[i] < 0x7f && c0data[i+1] === 0x00 && 
      c0data[i+2] >= 0x20 && c0data[i+2] < 0x7f && c0data[i+3] === 0x00) {
    let str = '';
    let j = i;
    while (j < c0data.length - 1 && c0data[j] >= 0x20 && c0data[j] < 0x7f && c0data[j+1] === 0x00) {
      str += String.fromCharCode(c0data[j]);
      j += 2;
    }
    if (str.length > 2 && !str.includes('\x00')) {
      console.log(`    ${i.toString(16)}: "${str}"`);
    }
  }
}

// Try to extract float64 coordinates from Config-0-Body
console.log('\n--- Config-0-Body coordinate analysis ---');
const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);

// Find ALL float64 values
const allFloats = [];
for (let i = 0; i <= data.length - 8; i += 8) {
  const val = dv.getFloat64(i, true);
  if (isFinite(val) && Math.abs(val) < 100000) {
    allFloats.push({ offset: i, value: val });
  }
}
console.log(`  Total float64 values: ${allFloats.length}`);

// Look for coordinate triplets (XYZ patterns)
console.log('\n  Potential coordinate triplets:');
let triCount = 0;
for (let i = 0; i <= allFloats.length - 3 && triCount < 30; i++) {
  const a = allFloats[i].value;
  const b = allFloats[i+1].value;
  const c = allFloats[i+2].value;
  // Reasonable coordinates for a mechanical part (in mm)
  if (Math.abs(a) < 5000 && Math.abs(b) < 5000 && Math.abs(c) < 5000 &&
      (Math.abs(a) > 0.01 || Math.abs(b) > 0.01 || Math.abs(c) > 0.01)) {
    // Check next 3 values too
    if (i + 5 < allFloats.length) {
      const d = allFloats[i+3].value;
      const e = allFloats[i+4].value;
      const f = allFloats[i+5].value;
      if (Math.abs(d) < 5000 && Math.abs(e) < 5000 && Math.abs(f) < 5000) {
        console.log(`    ${allFloats[i].offset.toString(16)}: [${a.toFixed(4)}, ${b.toFixed(4)}, ${c.toFixed(4)}] → [${d.toFixed(4)}, ${e.toFixed(4)}, ${f.toFixed(4)}]`);
        triCount++;
      }
    }
  }
}

// Also check Definition stream
console.log('\n--- Definition stream ---');
const def = parser.directory.find(e => e.name === 'Definition');
const defData = new Uint8Array(parser.readStream(def));
console.log(`  Size: ${defData.length} bytes`);
console.log(`  First 64 bytes: ${Array.from(defData.slice(0, 64)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);

// Check if Definition contains STEP-like content
const defText = defData.toString('binary');
if (defText.includes('ISO-10303') || defText.includes('HEADER')) {
  console.log('  >>> STEP content found in Definition!');
}
if (defData[0] === 0x50 && defData[1] === 0x53) {
  console.log('  >>> PARASOLID in Definition!');
}
