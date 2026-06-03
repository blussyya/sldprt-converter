/**
 * Stream analyzer - examines specific streams in SLDPRT files
 */
const fs = require('fs');
const zlib = require('zlib');
const { Ole2Parser } = require('./ole2-parser');

async function decompressZlib(buffer) {
  return new Promise((resolve, reject) => {
    zlib.inflate(buffer, (err, result) => {
      if (!err) return resolve(result);
      zlib.inflateRaw(buffer, (err2, result2) => {
        if (!err2) return resolve(result2);
        zlib.gunzip(buffer, (err3, result3) => {
          if (!err3) return resolve(result3);
          reject(new Error('All decompression failed'));
        });
      });
    });
  });
}

async function analyzeFile(filePath) {
  const fileData = fs.readFileSync(filePath);
  const ab = new ArrayBuffer(fileData.length);
  const view = new Uint8Array(ab);
  for (let i = 0; i < fileData.length; i++) view[i] = fileData[i];
  
  console.log(`\n=== Analyzing: ${filePath} (${fileData.length} bytes) ===\n`);
  
  const parser = new Ole2Parser(ab);
  parser.parse();
  
  const streams = parser.listStreams();
  console.log(`Found ${streams.length} streams:\n`);
  
  for (const s of streams) {
    console.log(`  ${s.path} (${s.size} bytes)`);
  }
  
  // Examine DisplayLists
  const dlStreams = parser.findStreams(/DisplayList/i);
  for (const stream of dlStreams) {
    console.log(`\n--- ${stream.fullPath} ---`);
    const data = new Uint8Array(parser.readStream(stream));
    console.log(`Size: ${data.length} bytes`);
    console.log(`First 128 bytes hex:`);
    printHex(data.slice(0, 128));
    
    // Check compression type
    const first4 = Array.from(data.slice(0, 4)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    console.log(`First 4 bytes: ${first4}`);
    
    // Check for common signatures
    if (data[0] === 0x78 && (data[1] === 0x01 || data[1] === 0x5E || data[1] === 0x9C || data[1] === 0xDA)) {
      console.log('Looks like zlib-compressed data!');
      try {
        const dec = await decompressZlib(data.buffer);
        console.log(`Decompressed: ${dec.length} bytes`);
        printHex(new Uint8Array(dec).slice(0, 128));
        printAscii(new Uint8Array(dec).slice(0, 256));
      } catch (e) {
        console.log(`Decompression failed: ${e.message}`);
      }
    } else if (data[0] === 0x50 && data[1] === 0x4B) {
      console.log('Looks like ZIP format!');
    } else {
      console.log('Unknown format, trying zlib anyway...');
      try {
        const dec = await decompressZlib(data.buffer);
        console.log(`Decompressed: ${dec.length} bytes`);
        printHex(new Uint8Array(dec).slice(0, 128));
        printAscii(new Uint8Array(dec).slice(0, 256));
      } catch (e) {
        console.log(`Decompression failed: ${e.message}`);
        // Try skipping first few bytes (some formats have a header)
        for (let skip = 1; skip <= 16; skip++) {
          try {
            const dec = await decompressZlib(data.slice(skip).buffer);
            console.log(`Decompressed (skip ${skip}): ${dec.length} bytes`);
            printHex(new Uint8Array(dec).slice(0, 128));
            printAscii(new Uint8Array(dec).slice(0, 256));
            break;
          } catch (e2) {}
        }
      }
    }
  }
  
  // Examine Config streams
  const cfgStreams = parser.findStreams(/Config/i);
  for (const stream of cfgStreams) {
    console.log(`\n--- ${stream.fullPath} ---`);
    const data = new Uint8Array(parser.readStream(stream));
    console.log(`Size: ${data.length} bytes`);
    console.log(`First 256 bytes hex:`);
    printHex(data.slice(0, 256));
    printAscii(data.slice(0, 256));
  }
  
  // Examine Definition stream
  const defStreams = parser.findStreams(/Definition/i);
  for (const stream of defStreams) {
    console.log(`\n--- ${stream.fullPath} ---`);
    const data = new Uint8Array(parser.readStream(stream));
    console.log(`Size: ${data.length} bytes`);
    console.log(`First 256 bytes hex:`);
    printHex(data.slice(0, 256));
    printAscii(data.slice(0, 256));
  }
  
  // Examine all other interesting streams
  for (const stream of parser.directory.filter(e => e.objType === 2)) {
    if (/DisplayList|Config|Definition|CMgr/.test(stream.name)) continue;
    const data = new Uint8Array(parser.readStream(stream));
    console.log(`\n--- ${stream.fullPath} (${data.length} bytes) ---`);
    printHex(data.slice(0, Math.min(64, data.length)));
    printAscii(data.slice(0, Math.min(128, data.length)));
  }
}

function printHex(bytes) {
  for (let i = 0; i < bytes.length; i += 16) {
    let hex = '', ascii = '';
    for (let j = 0; j < 16 && i + j < bytes.length; j++) {
      const b = bytes[i + j];
      hex += b.toString(16).padStart(2, '0') + ' ';
      ascii += (b >= 32 && b < 127) ? String.fromCharCode(b) : '.';
    }
    console.log(`  ${i.toString(16).padStart(4, '0')}: ${hex.padEnd(48)} ${ascii}`);
  }
}

function printAscii(bytes) {
  let ascii = '';
  for (let i = 0; i < bytes.length; i++) {
    ascii += (bytes[i] >= 32 && bytes[i] < 127) ? String.fromCharCode(bytes[i]) : '.';
  }
  // Find printable substrings
  const matches = ascii.match(/[\x20-\x7E]{4,}/g);
  if (matches) {
    console.log(`  Strings: ${matches.slice(0, 20).join(' | ')}`);
  }
}

const file = process.argv[2] || 'SW2000-s01.SLDPRT';
analyzeFile(file).catch(console.error);
