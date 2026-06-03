const fs = require('fs');
const zlib = require('zlib');
const { Ole2Parser } = require('./ole2-parser.js');

const filePath = 'D:\\karaza\\websites\\Karazas-website\\sldprt-research\\new-samples\\SLIDING TABLE.SLDPRT';
const buf = fs.readFileSync(filePath);
const parser = new Ole2Parser(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
parser.parse();

const body = parser.directory.find(e => e.name === 'Config-0-Body');
const bodyData = new Uint8Array(parser.readStream(body));

// Try brotli at offset 317
const result = zlib.brotliDecompressSync(bodyData.slice(317), { maxOutputLength: 50*1024*1024 });
console.log(`Brotli @ 317: ${result.length} bytes`);

// Full hex dump of first 512 bytes
console.log('\n=== First 512 bytes ===');
for (let i = 0; i < Math.min(512, result.length); i += 16) {
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
const searches = ['PARASOLID', 'TRANSMIT', 'VERTEX', 'EDGE', 'FACE', 'BODY', 'moPart', 'moBody', 'DisplayList', 'PK_', 'SCH_', 'modeller', 'kernel', 'Geometry', 'Tessellation', 'Mesh', 'Triangle', 'Normal'];
console.log('\n=== String search ===');
for (const s of searches) {
  let idx = -1;
  let count = 0;
  while ((idx = text.indexOf(s, idx + 1)) !== -1 && count < 3) {
    console.log(`  "${s}" at offset ${idx.toString(16)}`);
    count++;
  }
}

// Check for PS header
if (result.length > 4 && result[0] === 0x50 && result[1] === 0x53) {
  console.log('\n>>> PARASOLID FILE! <<<');
}

// Check for float64 values
const dv = new DataView(result.buffer, result.byteOffset, result.byteLength);
console.log('\n=== Float64 values (non-zero, |val| > 0.001 and < 100000) ===');
let floatCount = 0;
for (let i = 0; i <= result.length - 8; i += 8) {
  try {
    const val = dv.getFloat64(i, true);
    if (isFinite(val) && Math.abs(val) > 0.001 && Math.abs(val) < 100000) {
      if (floatCount < 50) {
        console.log(`  ${i.toString(16).padStart(4)}: ${val.toFixed(6)}`);
      }
      floatCount++;
    }
  } catch(e) {}
}
console.log(`Total non-trivial float64: ${floatCount}`);

// Save the result
fs.writeFileSync('C:\\Users\\basha\\AppData\\Local\\Temp\\body-brotli-317.bin', result);
console.log('\nSaved as body-brotli-317.bin');

// Also try brotli on other SLDPRT files
console.log('\n=== Trying brotli on other SLDPRT files ===');
const otherFiles = [
  'D:\\karaza\\websites\\Karazas-website\\sldprt-research\\new-samples\\CAM.SLDPRT',
  'D:\\karaza\\websites\\Karazas-website\\sldprt-research\\new-samples\\doneConsole.sldprt',
];

for (const f of otherFiles) {
  const fBuf = fs.readFileSync(f);
  const fParser = new Ole2Parser(fBuf.buffer.slice(fBuf.byteOffset, fBuf.byteOffset + fBuf.byteLength));
  try {
    fParser.parse();
  } catch(e) {
    console.log(`  ${f.split('\\').pop()}: parse error: ${e.message}`);
    continue;
  }
  
  const fBody = fParser.directory.find(e => e.name === 'Config-0-Body');
  if (!fBody) {
    console.log(`  ${f.split('\\').pop()}: no Config-0-Body`);
    continue;
  }
  
  const fBodyData = new Uint8Array(fParser.readStream(fBody));
  let found = false;
  for (let skip = 0; skip <= 1000 && !found; skip++) {
    try {
      const r = zlib.brotliDecompressSync(fBodyData.slice(skip), { maxOutputLength: 50*1024*1024 });
      if (r.length > 200) {
        const isPS = r.length > 4 && r[0] === 0x50 && r[1] === 0x53;
        const hasPS = r.toString('binary').includes('PARASOLID') || r.toString('binary').includes('TRANSMIT');
        const hasVertex = r.toString('binary').includes('VERTEX') || r.toString('binary').includes('EDGE');
        if (isPS || hasPS || hasVertex) {
          console.log(`  ${f.split('\\').pop()} @ ${skip}: ${r.length} bytes >>> PS! <<<`);
          found = true;
        }
      }
    } catch(e) {}
  }
  if (!found) console.log(`  ${f.split('\\').pop()}: no Parasolid found in brotli`);
}
