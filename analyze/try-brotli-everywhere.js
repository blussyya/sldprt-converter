const fs = require('fs');
const zlib = require('zlib');
const { Ole2Parser } = require('./ole2-parser.js');

const filePath = 'D:\\karaza\\websites\\Karazas-website\\sldprt-research\\new-samples\\SLIDING TABLE.SLDPRT';
const buf = fs.readFileSync(filePath);
const parser = new Ole2Parser(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
parser.parse();

// Try brotli on Config-0-Body at every offset
console.log('=== Trying brotli on Config-0-Body ===');
const body = parser.directory.find(e => e.name === 'Config-0-Body');
const bodyData = new Uint8Array(parser.readStream(body));

for (let skip = 0; skip <= 256; skip++) {
  try {
    const result = zlib.brotliDecompressSync(bodyData.slice(skip), { maxOutputLength: 50*1024*1024 });
    if (result.length > 100) {
      const isPS = result.length > 4 && result[0] === 0x50 && result[1] === 0x53;
      const hasPS = result.toString('binary').includes('PARASOLID') || result.toString('binary').includes('TRANSMIT');
      console.log(`  brotli @ ${skip}: ${result.length} bytes ${isPS ? '>>> PS! >>>' : ''} ${hasPS ? '>>> HAS PS STRINGS! >>>' : ''}`);
      if (isPS || hasPS) {
        fs.writeFileSync(
          'D:\\karaza\\websites\\Karazas-website\\sldprt-research\\new-samples\\body-parasolid.x_b',
          result
        );
        console.log('  SAVED!');
      }
    }
  } catch(e) {}
}

// Also try brotli on Config-0-Body starting after the 24-byte header
console.log('\n=== Trying brotli on Config-0-Body (header=24) ===');
try {
  const result = zlib.brotliDecompressSync(bodyData.slice(24), { maxOutputLength: 50*1024*1024 });
  console.log(`  brotli @ 24: ${result.length} bytes`);
} catch(e) {}

// Try brotli on Config-2-Body too
console.log('\n=== Trying brotli on Config-2-Body ===');
const body2 = parser.directory.find(e => e.name === 'Config-2-Body');
if (body2) {
  const body2Data = new Uint8Array(parser.readStream(body2));
  for (let skip = 0; skip <= 256; skip++) {
    try {
      const result = zlib.brotliDecompressSync(body2Data.slice(skip), { maxOutputLength: 50*1024*1024 });
      if (result.length > 100) {
        const isPS = result.length > 4 && result[0] === 0x50 && result[1] === 0x53;
        const hasPS = result.toString('binary').includes('PARASOLID') || result.toString('binary').includes('TRANSMIT');
        console.log(`  brotli @ ${skip}: ${result.length} bytes ${isPS ? '>>> PS! >>>' : ''} ${hasPS ? '>>> HAS PS STRINGS! >>>' : ''}`);
      }
    } catch(e) {}
  }
}

// Try brotli on Config-0 (the 112KB metadata stream)
console.log('\n=== Trying brotli on Config-0 ===');
const config0 = parser.directory.find(e => e.name === 'Config-0');
const c0Data = new Uint8Array(parser.readStream(config0));
for (let skip = 0; skip <= 256; skip++) {
  try {
    const result = zlib.brotliDecompressSync(c0Data.slice(skip), { maxOutputLength: 50*1024*1024 });
    if (result.length > 100) {
      const isPS = result.length > 4 && result[0] === 0x50 && result[1] === 0x53;
      const hasPS = result.toString('binary').includes('PARASOLID') || result.toString('binary').includes('TRANSMIT');
      console.log(`  brotli @ ${skip}: ${result.length} bytes ${isPS ? '>>> PS! >>>' : ''} ${hasPS ? '>>> HAS PS STRINGS! >>>' : ''}`);
    }
  } catch(e) {}
}

// Try brotli on ALL streams
console.log('\n=== Trying brotli on ALL streams ===');
for (const entry of parser.directory) {
  const data = new Uint8Array(parser.readStream(entry));
  let found = false;
  for (let skip = 0; skip <= 64 && !found; skip++) {
    try {
      const result = zlib.brotliDecompressSync(data.slice(skip), { maxOutputLength: 50*1024*1024 });
      if (result.length > 200) {
        const isPS = result.length > 4 && result[0] === 0x50 && result[1] === 0x53;
        const hasPS = result.toString('binary').includes('PARASOLID') || result.toString('binary').includes('TRANSMIT');
        if (isPS || hasPS) {
          console.log(`  ${entry.name} @ ${skip}: ${result.length} bytes >>> PS! >>>`);
          fs.writeFileSync(
            'D:\\karaza\\websites\\Karazas-website\\sldprt-research\\new-samples\\' + entry.name.replace(/[^a-zA-Z0-9]/g, '_') + '-parasolid.x_b',
            result
          );
          console.log('  SAVED!');
          found = true;
        }
      }
    } catch(e) {}
  }
}
