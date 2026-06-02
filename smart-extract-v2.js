/**
 * Smart extraction: find zlib blocks within DisplayLists__Zip and Config-0-Body
 * using the magic numbers from the FreeCAD forum:
 * - 0x78 0x01 (zlib deflate, no dict)
 * - 0x14 0x00 0x06 0x00 0x08 0x00 (possible section header)
 * - 0x23 0x1d 0xd5 0x71 0xda 0x81 0x48 0xa2 0xa8 0x58 0x98 0xb2 0x1b 0x89 0xef 0x99 (Parasolid GUID)
 */
const fs = require('fs');
const zlib = require('zlib');
const { Ole2Parser } = require('./ole2-parser.js');

const file = process.argv[2];
const buf = fs.readFileSync(file);
const parser = new Ole2Parser(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
parser.parse();

function tryDecompress(data, label) {
  console.log(`\n--- ${label}: ${data.length} bytes ---`);
  
  // Find all 0x78 positions (potential zlib stream starts)
  const positions = [];
  for (let i = 0; i < data.length - 2; i++) {
    if (data[i] === 0x78 && (data[i + 1] === 0x01 || data[i + 1] === 0x9C || data[i + 1] === 0xDA || data[i + 1] === 0x00)) {
      positions.push(i);
    }
  }
  
  console.log(`Found ${positions.length} potential zlib stream starts`);
  
  // Try decompressing from each position
  let bestResult = null;
  let bestOffset = -1;
  
  for (const pos of positions) {
    try {
      // Skip the 2-byte zlib header and try raw inflate
      const result = zlib.inflateRawSync(data.slice(pos + 2), { maxOutputLength: 5 * 1024 * 1024 });
      if (result.length > 100) {
        const preview = result.slice(0, 64);
        const isASCII = preview.slice(0, 16).every(b => b >= 32 && b < 127);
        const isPS = result.length > 4 && result[0] === 0x50 && result[1] === 0x53;
        
        console.log(`  Offset ${pos}: ${result.length} bytes | PS=${isPS} ASCII=${isASCII}`);
        if (isPS) {
          console.log(`    First 64: ${preview.toString('hex')}`);
        }
        
        if (!bestResult || result.length > bestResult.length) {
          bestResult = result;
          bestOffset = pos;
        }
      }
    } catch (e) {}
  }
  
  if (bestResult) {
    console.log(`\nBest result: offset ${bestOffset}, ${bestResult.length} bytes`);
    console.log(`First 128 bytes: ${bestResult.slice(0, 128).toString('hex')}`);
    
    // Check for Parasolid header
    if (bestResult[0] === 0x50 && bestResult[1] === 0x53) {
      console.log('>>> PARASOLID DATA FOUND!');
      const outFile = file.replace(/\.[^.]+$/, '') + '-parasolid.x_b';
      fs.writeFileSync(outFile, bestResult);
      console.log(`Saved to: ${outFile}`);
    }
    
    // Check for class names
    const text = bestResult.toString('binary');
    const classes = text.match(/mo[A-Z][a-zA-Z_]+_c/g);
    if (classes) {
      console.log(`Class names: ${[...new Set(classes)].join(', ')}`);
    }
    
    // Check for STEP header
    if (bestResult.slice(0, 20).toString('ascii').includes('ISO-10303')) {
      console.log('>>> STEP DATA FOUND!');
      const outFile = file.replace(/\.[^.]+$/, '') + '-extracted.step';
      fs.writeFileSync(outFile, bestResult);
      console.log(`Saved to: ${outFile}`);
    }
  }
  
  // Also try the "magic 6" positions
  const magic6 = [0x14, 0x00, 0x06, 0x00, 0x08, 0x00];
  for (let i = 0; i <= data.length - 6; i++) {
    let match = true;
    for (let j = 0; j < 6; j++) {
      if (data[i + j] !== magic6[j]) { match = false; break; }
    }
    if (match) {
      console.log(`\n6-byte magic found at offset ${i}`);
      // Try decompressing from nearby positions
      for (let skip = 0; skip <= 20; skip++) {
        try {
          const result = zlib.inflateRawSync(data.slice(i + skip), { maxOutputLength: 5 * 1024 * 1024 });
          if (result.length > 100) {
            console.log(`  Decompressed from ${i + skip}: ${result.length} bytes | ${result.slice(0, 32).toString('hex')}`);
            if (result[0] === 0x50 && result[1] === 0x53) {
              console.log('  >>> PARASOLID!');
            }
          }
        } catch (e) {}
      }
    }
  }
  
  // Try to find the Parasolid GUID
  const guid = [0x23, 0x1d, 0xd5, 0x71, 0xda, 0x81, 0x48, 0xa2, 0xa8, 0x58, 0x98, 0xb2, 0x1b, 0x89, 0xef, 0x99];
  for (let i = 0; i <= data.length - 16; i++) {
    let match = true;
    for (let j = 0; j < 16; j++) {
      if (data[i + j] !== guid[j]) { match = false; break; }
    }
    if (match) {
      console.log(`\nParasolid GUID at offset ${i}`);
    }
  }
}

// Analyze all relevant streams
for (const name of ['DisplayLists__Zip', 'DisplayLists__ZLB', 'DisplayLists', 'Config-0-Body', 'Config-0', 'Definition']) {
  const entry = parser.directory.find(e => e.name === name);
  if (!entry) continue;
  
  let data;
  try {
    data = new Uint8Array(parser.readStream(entry));
  } catch (e) {
    console.log(`\nFailed to read ${name}: ${e.message}`);
    continue;
  }
  
  // For compressed streams, first try to decompress the whole thing
  if (name.includes('Zip') || name.includes('ZLB')) {
    try {
      const decompressed = zlib.inflateRawSync(data.slice(2));
      console.log(`\nWhole-stream decompression succeeded for ${name}: ${decompressed.length} bytes`);
      data = new Uint8Array(decompressed);
    } catch (e) {
      try {
        const decompressed = zlib.inflateSync(data);
        console.log(`\nWhole-stream decompression succeeded for ${name}: ${decompressed.length} bytes`);
        data = new Uint8Array(decompressed);
      } catch (e2) {
        // Will try block-by-block below
      }
    }
  }
  
  tryDecompress(data, name);
}
