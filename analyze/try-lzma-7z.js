const fs = require('fs');
const zlib = require('zlib');
const { Ole2Parser } = require('./ole2-parser.js');
const { execSync } = require('child_process');

const filePath = 'D:\\karaza\\websites\\Karazas-website\\sldprt-research\\new-samples\\SLIDING TABLE.SLDPRT';
const buf = fs.readFileSync(filePath);
const parser = new Ole2Parser(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
parser.parse();

// Try 7z/lzma via command line
console.log('=== Trying 7z/lzma decompression ===');

// Save raw streams to temp files for 7z analysis
const body = parser.directory.find(e => e.name === 'Config-0-Body');
const bodyData = new Uint8Array(parser.readStream(body));
fs.writeFileSync('C:\\Users\\basha\\AppData\\Local\\Temp\\body-raw.bin', bodyData);

const dl = parser.directory.find(e => e.name === 'DisplayLists__Zip');
const dlData = new Uint8Array(parser.readStream(dl));
fs.writeFileSync('C:\\Users\\basha\\AppData\\Local\\Temp\\dl-raw.bin', dlData);

// Try 7z on the raw files
try {
  console.log('\n--- 7z on Config-0-Body ---');
  const result7z = execSync('7z x -o"C:\\Users\\basha\\AppData\\Local\\Temp\\body-7z" -y "C:\\Users\\basha\\AppData\\Local\\Temp\\body-raw.bin" 2>&1', { encoding: 'utf8', timeout: 30000 });
  console.log(result7z.substring(0, 500));
} catch(e) {
  console.log(`7z error: ${e.message.substring(0, 200)}`);
}

// Try xz/lzma on the data
try {
  console.log('\n--- xz on Config-0-Body ---');
  const resultXz = execSync('7z x -tXZ -o"C:\\Users\\basha\\AppData\\Local\\Temp\\body-xz" -y "C:\\Users\\basha\\AppData\\Local\\Temp\\body-raw.bin" 2>&1', { encoding: 'utf8', timeout: 30000 });
  console.log(resultXz.substring(0, 500));
} catch(e) {
  console.log(`xz error: ${e.message.substring(0, 200)}`);
}

// Try brotli at EVERY offset (not just 0-256)
console.log('\n=== Trying brotli at EVERY offset (0-500) on Config-0-Body ===');
for (let skip = 256; skip <= 500; skip++) {
  try {
    const result = zlib.brotliDecompressSync(bodyData.slice(skip), { maxOutputLength: 50*1024*1024 });
    if (result.length > 200) {
      const isPS = result.length > 4 && result[0] === 0x50 && result[1] === 0x53;
      const hasPS = result.toString('binary').includes('PARASOLID') || result.toString('binary').includes('TRANSMIT');
      const hasVertex = result.toString('binary').includes('VERTEX') || result.toString('binary').includes('EDGE') || result.toString('binary').includes('FACE');
      console.log(`  brotli @ ${skip}: ${result.length} bytes ${isPS ? '>>> PS! >>>' : ''} ${hasPS ? '>>> HAS PS STRINGS! >>>' : ''} ${hasVertex ? '>>> HAS VERTEX/EDGE! >>>' : ''}`);
    }
  } catch(e) {}
}

// Try brotli on DisplayLists__Zip at EVERY offset
console.log('\n=== Trying brotli at EVERY offset on DisplayLists__Zip ===');
for (let skip = 0; skip <= 256; skip++) {
  try {
    const result = zlib.brotliDecompressSync(dlData.slice(skip), { maxOutputLength: 50*1024*1024 });
    if (result.length > 200) {
      const isPS = result.length > 4 && result[0] === 0x50 && result[1] === 0x53;
      const hasPS = result.toString('binary').includes('PARASOLID') || result.toString('binary').includes('TRANSMIT');
      const hasVertex = result.toString('binary').includes('VERTEX') || result.toString('binary').includes('EDGE') || result.toString('binary').includes('FACE');
      console.log(`  brotli @ ${skip}: ${result.length} bytes ${isPS ? '>>> PS! >>>' : ''} ${hasPS ? '>>> HAS PS STRINGS! >>>' : ''} ${hasVertex ? '>>> HAS VERTEX/EDGE! >>>' : ''}`);
    }
  } catch(e) {}
}

// Try brotli on the ENTIRE file (not just streams)
console.log('\n=== Trying brotli at key offsets on entire SLDPRT file ===');
const fullBuf = fs.readFileSync(filePath);
for (const skip of [0, 512, 1024, 2048, 4096, 8192, 16384, 32768]) {
  if (skip >= fullBuf.length) continue;
  try {
    const result = zlib.brotliDecompressSync(fullBuf.slice(skip), { maxOutputLength: 50*1024*1024 });
    if (result.length > 200) {
      const isPS = result.length > 4 && result[0] === 0x50 && result[1] === 0x53;
      const hasPS = result.toString('binary').includes('PARASOLID') || result.toString('binary').includes('TRANSMIT');
      console.log(`  brotli @ ${skip}: ${result.length} bytes ${isPS ? '>>> PS! >>>' : ''} ${hasPS ? '>>> HAS PS STRINGS! >>>' : ''}`);
    }
  } catch(e) {}
}
