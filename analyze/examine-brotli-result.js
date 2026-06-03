const fs = require('fs');
const zlib = require('zlib');
const { Ole2Parser } = require('./ole2-parser.js');

const filePath = 'D:\\karaza\\websites\\Karazas-website\\sldprt-research\\new-samples\\SLIDING TABLE.SLDPRT';
const buf = fs.readFileSync(filePath);
const parser = new Ole2Parser(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
parser.parse();

const body = parser.directory.find(e => e.name === 'Config-0-Body');
const bodyData = new Uint8Array(parser.readStream(body));
const result = zlib.brotliDecompressSync(bodyData.slice(235), { maxOutputLength: 50*1024*1024 });
console.log(`Brotli result: ${result.length} bytes`);

// Full hex dump
for (let i = 0; i < result.length; i += 16) {
  let hex = '', ascii = '';
  for (let j = 0; j < 16 && i + j < result.length; j++) {
    const b = result[i + j];
    hex += b.toString(16).padStart(2, '0') + ' ';
    ascii += (b >= 32 && b < 127) ? String.fromCharCode(b) : '.';
  }
  console.log(`  ${i.toString(16).padStart(4)}: ${hex.padEnd(48)} ${ascii}`);
}

// Search for strings
const text = result.toString('binary');
const strings = ['PARASOLID', 'TRANSMIT', 'VERTEX', 'EDGE', 'FACE', 'BODY', 'PK_', 'SCH_', 'moPart', 'moBody', 'DisplayList', 'ZLB', 'Zip'];
for (const s of strings) {
  const idx = text.indexOf(s);
  if (idx >= 0) {
    console.log(`\nFound "${s}" at offset ${idx}`);
    console.log(`  Context: ${text.substring(Math.max(0, idx-10), idx + 50)}`);
  }
}

// Check for float64 values
const dv = new DataView(result.buffer, result.byteOffset, result.byteLength);
console.log('\nFloat64 values:');
for (let i = 0; i <= result.length - 8; i += 8) {
  try {
    const val = dv.getFloat64(i, true);
    if (isFinite(val) && Math.abs(val) > 0.001 && Math.abs(val) < 100000) {
      console.log(`  ${i.toString(16).padStart(4)}: ${val.toFixed(6)}`);
    }
  } catch(e) {}
}

// Check for class names
console.log('\nClass names:');
for (let i = 0; i < result.length - 10; i++) {
  if (result[i] === 0xFF && result[i+1] === 0xFF && i + 4 < result.length) {
    const nameLen = result[i+2] | (result[i+3] << 8);
    if (nameLen > 3 && nameLen < 200 && i + 4 + nameLen <= result.length) {
      let name = '';
      let valid = true;
      for (let j = 0; j < nameLen; j++) {
        const ch = result[i + 4 + j];
        if (ch >= 0x20 && ch < 0x7f) name += String.fromCharCode(ch);
        else { valid = false; break; }
      }
      if (valid && name.length > 3) {
        console.log(`  ${i.toString(16).padStart(4)}: ${name}`);
      }
    }
  }
}

// Save the result
fs.writeFileSync('D:\\karaza\\websites\\Karazas-website\\sldprt-research\\new-samples\\body-brotli-235.bin', result);
console.log('\nSaved as body-brotli-235.bin');
