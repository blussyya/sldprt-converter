/**
 * Node.js test script for SLDPRT extraction
 * Run: node test-node.js <file.sldprt>
 */

const fs = require('fs');
const { Ole2Parser } = require('./ole2-parser');
const { SldprtExtractor } = require('./sldprt-extractor');

// Polyfill DecompressionStream for Node.js
class NodeDecompressionStream {
  constructor(format) {
    this.format = format;
    const zlib = require('zlib');
    
    this.readable = {
      getReader: () => {
        let data = null;
        return {
          read: async () => {
            if (data) return { done: true };
            return { done: false, value: data };
          }
        };
      }
    };
  }
}

// Simple Node.js zlib decompression
async function decompressZlib(buffer) {
  const zlib = require('zlib');
  return new Promise((resolve, reject) => {
    // Try zlib (with header)
    zlib.inflate(buffer, (err, result) => {
      if (!err) return resolve(result);
      
      // Try raw deflate
      zlib.inflateRaw(buffer, (err2, result2) => {
        if (!err2) return resolve(result2);
        
        // Try gzip
        zlib.gunzip(buffer, (err3, result3) => {
          if (!err3) return resolve(result3);
          
          reject(new Error('All decompression methods failed'));
        });
      });
    });
  });
}

// Patch the SldprtExtractor for Node.js
const origDecompress = SldprtExtractor.prototype._decompressZlib;
SldprtExtractor.prototype._decompressZlib = async function(buffer) {
  return decompressZlib(buffer);
};

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.log('Usage: node test-node.js <file.sldprt>');
    process.exit(1);
  }

  console.log(`\n=== SLDPRT Research — Node.js Test ===\n`);
  console.log(`File: ${filePath}`);

  const fileData = fs.readFileSync(filePath);
  // Create a proper ArrayBuffer copy (Node Buffer may be a pool slice)
  const ab = new ArrayBuffer(fileData.length);
  const view = new Uint8Array(ab);
  for (let i = 0; i < fileData.length; i++) view[i] = fileData[i];
  const buffer = ab;
  console.log(`Size: ${(buffer.byteLength / 1024).toFixed(1)} KB`);
  console.log(`Buffer type: ${buffer.constructor.name}, is ArrayBuffer: ${buffer instanceof ArrayBuffer}`);

  // Quick OLE2 check
  const bytes = new Uint8Array(buffer);
  const magic = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
  const isOLE2 = magic.every((m, i) => bytes[i] === m);
  console.log(`OLE2 magic: ${isOLE2 ? 'YES ✓' : 'NO ✗'}`);

  if (!isOLE2) {
    // Maybe it's a ZIP-based SLDPRT (newer format)
    const zipMagic = [0x50, 0x4B, 0x03, 0x04];
    const isZIP = zipMagic.every((m, i) => bytes[i] === m);
    console.log(`ZIP magic: ${isZIP ? 'YES (newer SLDPRT format)' : 'NO'}`);
    
    if (isZIP) {
      console.log('\nThis is a ZIP-based SLDPRT. Parsing as ZIP...');
      try {
        const JSZip = require('jszip');
        const zip = await JSZip.loadAsync(buffer);
        console.log('\nZIP contents:');
        zip.forEach((path, entry) => {
          console.log(`  ${path} (${entry._data ? 'file' : 'dir'})`);
        });
      } catch (e) {
        console.log('JSZip not installed. Run: npm install jszip');
      }
    }
    
    process.exit(1);
  }

  // Parse OLE2
  console.log('\n--- OLE2 Parsing ---');
  try {
    const parser = new Ole2Parser(buffer);
    parser.parse();
    
    const streams = parser.listStreams();
    console.log(`\nFound ${streams.length} streams:`);
    
    for (const s of streams) {
      const sizeKB = (s.size / 1024).toFixed(1);
      const isZLB = s.name.includes('_ZLB') || s.name.includes('ZLB');
      const marker = isZLB ? ' ← ZLIB COMPRESSED' : '';
      console.log(`  ${s.path} (${sizeKB} KB)${marker}`);
    }
    
    // Find ZLB streams
    const zlbStreams = parser.findStreams(/_ZLB|ZLB/i);
    console.log(`\n--- ZLB Streams (${zlbStreams.length}) ---`);
    
    for (const stream of zlbStreams) {
      console.log(`\n${stream.fullPath || stream.name}:`);
      const data = parser.readStream(stream);
      const dataBytes = new Uint8Array(data);
      console.log(`  Compressed size: ${dataBytes.length} bytes`);
      console.log(`  First 32 bytes: ${Array.from(dataBytes.slice(0, 32)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
      
      // Try decompression
      try {
        const decompressed = await decompressZlib(data);
        console.log(`  Decompressed size: ${decompressed.length} bytes`);
        const decompBytes = new Uint8Array(decompressed);
        console.log(`  First 64 bytes: ${Array.from(decompBytes.slice(0, 64)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
        
        // ASCII preview
        const ascii = Buffer.from(decompressed).toString('ascii').replace(/[^\x20-\x7E]/g, '.');
        console.log(`  ASCII preview: ${ascii.substring(0, 128)}`);
        
        // Check for Parasolid markers
        const hasBODY = ascii.includes('BODY');
        const hasPARA = ascii.includes('PARASOLID') || ascii.includes('Parasolid');
        console.log(`  Contains 'BODY': ${hasBODY}`);
        console.log(`  Contains 'PARASOLID': ${hasPARA}`);
        
      } catch (e) {
        console.log(`  Decompression failed: ${e.message}`);
      }
    }

    // Also check Config partitions
    const configStreams = parser.findStreams(/Config|Partition/i);
    console.log(`\n--- Config/Partition Streams (${configStreams.length}) ---`);
    
    for (const stream of configStreams) {
      const data = parser.readStream(stream);
      const dataBytes = new Uint8Array(data);
      console.log(`\n${stream.fullPath || stream.name}:`);
      console.log(`  Size: ${dataBytes.length} bytes`);
      console.log(`  First 32 bytes: ${Array.from(dataBytes.slice(0, 32)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
      
      // Check if zlib
      if (dataBytes[0] === 0x78) {
        console.log('  Likely zlib-compressed (starts with 0x78)');
        try {
          const decompressed = await decompressZlib(data);
          console.log(`  Decompressed: ${decompressed.length} bytes`);
          const ascii = Buffer.from(decompressed).toString('ascii').replace(/[^\x20-\x7E]/g, '.');
          console.log(`  ASCII: ${ascii.substring(0, 256)}`);
        } catch (e) {
          console.log(`  Decompression failed: ${e.message}`);
        }
      }
    }

  } catch (e) {
    console.error('Parse error:', e.message);
    console.error(e.stack);
  }

  // Full extraction
  console.log('\n--- Full Extraction ---');
  try {
    const extractor = new SldprtExtractor(buffer);
    await extractor.extract();
    
    const report = extractor.getReport();
    console.log('Report:', JSON.stringify(report, null, 2));
    
    if (report.hasTriangles) {
      console.log(`\n✓ Successfully extracted ${report.stats.triangleCount.toLocaleString()} triangles!`);
      
      // Save OBJ
      const obj = extractor.toOBJ();
      const outPath = filePath.replace(/\.[^.]+$/, '.obj');
      fs.writeFileSync(outPath, obj);
      console.log(`Saved to: ${outPath}`);
    } else {
      console.log('\n✗ No triangles extracted');
      console.log('This means the decompressed data format is not yet understood.');
      console.log('Check the hex dumps above for clues about the data structure.');
    }
  } catch (e) {
    console.error('Extraction error:', e.message);
    console.error(e.stack);
  }
}

main().catch(console.error);
