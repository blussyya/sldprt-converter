/**
 * DisplayLists parser - extracts triangle geometry from SolidWorks display lists
 * Works on both compressed (_ZLB/__Zip) and uncompressed display data
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
        reject(new Error('Decompression failed'));
      });
    });
  });
}

function parseDisplayLists(bytes) {
  console.log(`\nParsing ${bytes.length} bytes of display data...`);
  
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const vertices = [];
  const triangles = [];
  
  // Display list format (based on observed data):
  // Header: 8 bytes (two int32s - version and count?)
  // Then: sequences of float64 coordinates
  
  // Strategy: scan for runs of valid float64 triplets
  // that could be vertex coordinates
  
  // First, let's identify the structure
  const header1 = dv.getInt32(0, true);  // LE
  const header2 = dv.getInt32(4, true);
  console.log(`Header int32s: ${header1}, ${header2}`);
  
  // Try reading from offset 8 as float64 triplets
  const candidateVertices = [];
  
  for (let offset = 8; offset <= bytes.length - 24; offset += 8) {
    try {
      const x = dv.getFloat64(offset, true);     // little-endian
      const y = dv.getFloat64(offset + 8, true);
      const z = dv.getFloat64(offset + 16, true);
      
      // Check if these look like valid 3D coordinates
      if (isFinite(x) && isFinite(y) && isFinite(z) &&
          Math.abs(x) < 100000 && Math.abs(y) < 100000 && Math.abs(z) < 100000 &&
          (Math.abs(x) + Math.abs(y) + Math.abs(z)) > 0.0001) {
        candidateVertices.push({ x, y, z, offset });
      }
    } catch (e) {}
  }
  
  console.log(`Found ${candidateVertices.length} potential vertices (float64 LE)`);
  
  if (candidateVertices.length > 0) {
    // Check if they could be triangles (every 3 vertices)
    const triCount = Math.floor(candidateVertices.length / 3);
    console.log(`Could form ${triCount} triangles`);
    
    // Output as OBJ
    let obj = '# Extracted from SLDPRT DisplayLists\n';
    obj += `# ${candidateVertices.length} vertices, ${triCount} triangles\n\n`;
    
    for (const v of candidateVertices) {
      obj += `v ${v.x.toFixed(6)} ${v.y.toFixed(6)} ${v.z.toFixed(6)}\n`;
    }
    
    for (let i = 0; i < triCount; i++) {
      const a = i * 3 + 1, b = i * 3 + 2, c = i * 3 + 3;
      obj += `f ${a} ${b} ${c}\n`;
    }
    
    return { obj, vertexCount: candidateVertices.length, triCount };
  }
  
  // Try big-endian
  const candidateVerticesBE = [];
  for (let offset = 8; offset <= bytes.length - 24; offset += 8) {
    try {
      const x = dv.getFloat64(offset, false);     // big-endian
      const y = dv.getFloat64(offset + 8, false);
      const z = dv.getFloat64(offset + 16, false);
      
      if (isFinite(x) && isFinite(y) && isFinite(z) &&
          Math.abs(x) < 100000 && Math.abs(y) < 100000 && Math.abs(z) < 100000 &&
          (Math.abs(x) + Math.abs(y) + Math.abs(z)) > 0.0001) {
        candidateVerticesBE.push({ x, y, z, offset });
      }
    } catch (e) {}
  }
  
  console.log(`Found ${candidateVerticesBE.length} potential vertices (float64 BE)`);
  
  if (candidateVerticesBE.length > candidateVertices.length) {
    const triCount = Math.floor(candidateVerticesBE.length / 3);
    let obj = '# Extracted from SLDPRT DisplayLists (BE)\n';
    obj += `# ${candidateVerticesBE.length} vertices, ${triCount} triangles\n\n`;
    
    for (const v of candidateVerticesBE) {
      obj += `v ${v.x.toFixed(6)} ${v.y.toFixed(6)} ${v.z.toFixed(6)}\n`;
    }
    
    for (let i = 0; i < triCount; i++) {
      const a = i * 3 + 1, b = i * 3 + 2, c = i * 3 + 3;
      obj += `f ${a} ${b} ${c}\n`;
    }
    
    return { obj, vertexCount: candidateVerticesBE.length, triCount };
  }
  
  // Also try float32
  const float32Verts = [];
  for (let offset = 0; offset <= bytes.length - 12; offset += 4) {
    try {
      const x = dv.getFloat32(offset, true);
      const y = dv.getFloat32(offset + 4, true);
      const z = dv.getFloat32(offset + 8, true);
      
      if (isFinite(x) && isFinite(y) && isFinite(z) &&
          Math.abs(x) < 100000 && Math.abs(y) < 100000 && Math.abs(z) < 100000 &&
          (Math.abs(x) + Math.abs(y) + Math.abs(z)) > 0.001) {
        float32Verts.push({ x, y, z, offset });
      }
    } catch (e) {}
  }
  
  console.log(`Found ${float32Verts.length} potential vertices (float32 LE)`);
  
  return null;
}

async function processFile(filePath) {
  const fileData = fs.readFileSync(filePath);
  const ab = new ArrayBuffer(fileData.length);
  const view = new Uint8Array(ab);
  for (let i = 0; i < fileData.length; i++) view[i] = fileData[i];
  
  console.log(`\n=== Processing: ${filePath} ===`);
  
  const parser = new Ole2Parser(ab);
  parser.parse();
  
  // Find DisplayLists streams
  const dlStreams = parser.findStreams(/DisplayList/i);
  
  for (const stream of dlStreams) {
    console.log(`\nStream: ${stream.fullPath} (${stream.streamSize} bytes)`);
    
    let data = new Uint8Array(parser.readStream(stream));
    
    if (data.length === 0) {
      console.log('  (stream is empty or beyond file bounds)');
      continue;
    }
    
    console.log(`  First 64 bytes: ${Array.from(data.slice(0, 64)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
    
    // Check if compressed
    if (data[0] === 0x78 && (data[1] === 0x01 || data[1] === 0x5E || data[1] === 0x9C || data[1] === 0xDA)) {
      console.log('  Compressed (zlib), decompressing...');
      try {
        data = new Uint8Array(await decompressZlib(data.buffer));
        console.log(`  Decompressed to ${data.length} bytes`);
      } catch (e) {
        console.log(`  Decompression failed: ${e.message}`);
        continue;
      }
    } else {
      console.log('  Not compressed (raw data)');
    }
    
    const result = parseDisplayLists(data);
    if (result) {
      console.log(`\n  ✓ Extracted ${result.vertexCount} vertices, ${result.triCount} triangles`);
      const outPath = filePath.replace(/\.[^.]+$/, '.obj');
      fs.writeFileSync(outPath, result.obj);
      console.log(`  Saved to: ${outPath}`);
    } else {
      console.log('\n  ✗ Could not extract triangles from display data');
    }
  }
}

const file = process.argv[2] || 'plate4.sldprt';
processFile(file).catch(console.error);
