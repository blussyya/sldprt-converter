const fs = require('fs');
const zlib = require('zlib');
const { Ole2Parser } = require('./ole2-parser.js');

const filePath = 'D:\\karaza\\websites\\Karazas-website\\sldprt-research\\new-samples\\SLIDING TABLE.SLDPRT';
const buf = fs.readFileSync(filePath);
const parser = new Ole2Parser(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
parser.parse();

console.log('=== Trying ALL decompression methods on ALL streams ===\n');

const methods = [
  { name: 'zlib (inflate)', fn: d => zlib.inflateSync(d) },
  { name: 'zlib (inflate raw)', fn: d => zlib.inflateRawSync(d) },
  { name: 'zlib (inflate, no limit)', fn: d => zlib.inflateSync(d, { maxOutputLength: 50*1024*1024 }) },
  { name: 'zlib (inflate raw, no limit)', fn: d => zlib.inflateRawSync(d, { maxOutputLength: 50*1024*1024 }) },
  { name: 'brotli decompress', fn: d => zlib.brotliDecompressSync(d) },
  { name: 'zlib windowBits=9', fn: d => zlib.inflateRawSync(d, { windowBits: 9 }) },
  { name: 'zlib windowBits=10', fn: d => zlib.inflateRawSync(d, { windowBits: 10 }) },
  { name: 'zlib windowBits=11', fn: d => zlib.inflateRawSync(d, { windowBits: 11 }) },
  { name: 'zlib windowBits=12', fn: d => zlib.inflateRawSync(d, { windowBits: 12 }) },
  { name: 'zlib windowBits=13', fn: d => zlib.inflateRawSync(d, { windowBits: 13 }) },
  { name: 'zlib windowBits=14', fn: d => zlib.inflateRawSync(d, { windowBits: 14 }) },
  { name: 'zlib windowBits=15', fn: d => zlib.inflateRawSync(d, { windowBits: 15 }) },
  { name: 'zlib windowBits=-9', fn: d => zlib.inflateRawSync(d, { windowBits: -9 }) },
  { name: 'zlib windowBits=-10', fn: d => zlib.inflateRawSync(d, { windowBits: -10 }) },
  { name: 'zlib windowBits=-11', fn: d => zlib.inflateRawSync(d, { windowBits: -11 }) },
  { name: 'zlib windowBits=-12', fn: d => zlib.inflateRawSync(d, { windowBits: -12 }) },
  { name: 'zlib windowBits=-13', fn: d => zlib.inflateRawSync(d, { windowBits: -13 }) },
  { name: 'zlib windowBits=-14', fn: d => zlib.inflateRawSync(d, { windowBits: -14 }) },
  { name: 'zlib windowBits=-15', fn: d => zlib.inflateRawSync(d, { windowBits: -15 }) },
  { name: 'zlib flush finish', fn: d => zlib.inflateRawSync(d, { finishFlush: zlib.constants.Z_FINISH }) },
  { name: 'zlib flush sync', fn: d => zlib.inflateRawSync(d, { flush: zlib.constants.Z_SYNC_FLUSH }) },
];

for (const entry of parser.directory) {
  if (!entry.name.includes('Config') && !entry.name.includes('Display') && !entry.name.includes('Biography') && !entry.name.includes('Definition')) continue;
  
  const data = new Uint8Array(parser.readStream(entry));
  if (data.length < 10) continue;
  
  console.log(`\n${entry.name} (${data.length} bytes):`);
  
  // Try each method on the full stream
  for (const method of methods) {
    try {
      const result = method.fn(data);
      const isPS = result.length > 4 && result[0] === 0x50 && result[1] === 0x53;
      const hasStrings = result.toString('binary').includes('PARASOLID') || 
                         result.toString('binary').includes('TRANSMIT');
      const hasXML = result[0] === 0x3C; // '<'
      console.log(`  ${method.name}: ${result.length} bytes ${isPS ? '>>> PARASOLID! >>>' : ''} ${hasStrings ? '>>> HAS PS STRINGS! >>>' : ''} ${hasXML ? '>>> XML! >>>' : ''}`);
    } catch (e) {}
  }
  
  // Try each method on every possible starting offset
  if (data.length > 100) {
    for (const method of methods.slice(0, 3)) { // Just zlib variants
      for (let offset = 0; offset < Math.min(data.length, 1000); offset++) {
        try {
          const result = method.fn(data.slice(offset));
          if (result.length > 100) {
            const isPS = result.length > 4 && result[0] === 0x50 && result[1] === 0x53;
            const hasStrings = result.toString('binary').includes('PARASOLID') || 
                               result.toString('binary').includes('TRANSMIT');
            if (isPS || hasStrings) {
              console.log(`  ${method.name} @ offset ${offset}: ${result.length} bytes >>> PARASOLID! >>>`);
              fs.writeFileSync(
                'D:\\karaza\\websites\\Karazas-website\\sldprt-research\\new-samples\\' + 
                entry.name.replace(/[^a-zA-Z0-9]/g, '_') + '-decompressed.bin', 
                result
              );
            }
          }
        } catch (e) {}
      }
    }
  }
}
