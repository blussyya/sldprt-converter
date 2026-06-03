/**
 * Smart DisplayLists parser - filters coordinates from metadata
 */
const fs = require('fs');
const { Ole2Parser } = require('./ole2-parser');

function extractTriangles(data) {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  
  // Collect all valid coordinate-like float64 values
  // Filter: must be finite, reasonable magnitude, not exactly 0 or 180
  const coords = [];
  for (let i = 0; i < data.length - 7; i += 8) {
    const val = dv.getFloat64(i, true);
    if (isFinite(val) && Math.abs(val) < 100 && Math.abs(val) > 0.0001 && Math.abs(val) !== 180) {
      coords.push({ val, offset: i });
    }
  }
  
  console.log(`  Found ${coords.length} coordinate-like float64 values`);
  
  // Group into triplets (x, y, z) and form triangles
  const positions = [];
  const normals = [];
  
  for (let i = 0; i < coords.length - 2; i += 3) {
    const x = coords[i].val;
    const y = coords[i+1].val;
    const z = coords[i+2].val;
    
    positions.push(x, y, z);
    
    // For next vertex
    if (i + 3 < coords.length) {
      const x2 = coords[i+3].val;
      const y2 = coords[i+4].val;
      const z2 = coords[i+5].val;
      positions.push(x2, y2, z2);
      
      if (i + 6 < coords.length) {
        const x3 = coords[i+6].val;
        const y3 = coords[i+7].val;
        const z3 = coords[i+8].val;
        positions.push(x3, y3, z3);
        
        // Compute face normal
        const ux = x2-x, uy = y2-y, uz = z2-z;
        const vx = x3-x, vy = y3-y, vz = z3-z;
        const nx = uy*vz-uz*vy, ny = uz*vx-ux*vz, nz = ux*vy-uy*vx;
        const nl = Math.sqrt(nx*nx+ny*ny+nz*nz)||1;
        normals.push(nx/nl, ny/nl, nz/nl, nx/nl, ny/nl, nz/nl, nx/nl, ny/nl, nz/nl);
      }
    }
  }
  
  return { positions, normals };
}

function processFile(filePath) {
  const fileData = fs.readFileSync(filePath);
  const ab = new ArrayBuffer(fileData.length);
  const view = new Uint8Array(ab);
  for (let i = 0; i < fileData.length; i++) view[i] = fileData[i];
  
  console.log(`\n=== Processing: ${filePath} ===`);
  
  const parser = new Ole2Parser(ab);
  parser.parse();
  
  // Find DisplayLists streams (any name variation)
  const dlStreams = parser.findStreams(/DisplayList/i);
  
  for (const stream of dlStreams) {
    console.log(`\nStream: ${stream.fullPath} (${stream.streamSize} bytes)`);
    
    let data = new Uint8Array(parser.readStream(stream));
    if (data.length === 0) {
      console.log('  (empty or beyond file bounds)');
      continue;
    }
    
    console.log(`  First 32 bytes: ${Array.from(data.slice(0, 32)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
    
    // Try decompression if needed
    if (data[0] === 0x78 && (data[1] === 0x01 || data[1] === 0x5E || data[1] === 0x9C || data[1] === 0xDA)) {
      console.log('  Compressed, decompressing...');
      const zlib = require('zlib');
      try {
        data = new Uint8Array(zlib.inflateSync(data.buffer));
        console.log(`  Decompressed to ${data.length} bytes`);
      } catch (e) {
        try {
          data = new Uint8Array(zlib.inflateRawSync(data.buffer));
          console.log(`  Decompressed (raw) to ${data.length} bytes`);
        } catch (e2) {
          console.log(`  Decompression failed`);
          continue;
        }
      }
    }
    
    const result = extractTriangles(data);
    const triCount = Math.floor(result.positions.length / 9);
    console.log(`  Extracted ${result.positions.length / 3} vertices, ${triCount} triangles`);
    
    if (triCount > 0) {
      // Generate OBJ
      let obj = `# Extracted from ${stream.fullPath}\n`;
      obj += `# ${result.positions.length / 3} vertices, ${triCount} triangles\n\n`;
      
      for (let i = 0; i < result.positions.length; i += 3) {
        obj += `v ${result.positions[i].toFixed(6)} ${result.positions[i+1].toFixed(6)} ${result.positions[i+2].toFixed(6)}\n`;
      }
      
      for (let i = 0; i < result.normals.length; i += 9) {
        obj += `vn ${result.normals[i].toFixed(6)} ${result.normals[i+1].toFixed(6)} ${result.normals[i+2].toFixed(6)}\n`;
        obj += `vn ${result.normals[i+3].toFixed(6)} ${result.normals[i+4].toFixed(6)} ${result.normals[i+5].toFixed(6)}\n`;
        obj += `vn ${result.normals[i+6].toFixed(6)} ${result.normals[i+7].toFixed(6)} ${result.normals[i+8].toFixed(6)}\n`;
      }
      
      for (let i = 0; i < triCount; i++) {
        const a = i * 3 + 1, b = i * 3 + 2, c = i * 3 + 3;
        obj += `f ${a}//${a} ${b}//${b} ${c}//${c}\n`;
      }
      
      const outPath = filePath.replace(/\.[^.]+$/, '.obj');
      fs.writeFileSync(outPath, obj);
      console.log(`  Saved: ${outPath}`);
    }
  }
  
  // Also try the Definition stream
  const defStreams = parser.findStreams(/Definition/i);
  for (const stream of defStreams) {
    const data = new Uint8Array(parser.readStream(stream));
    console.log(`\nDefinition: ${stream.fullPath} (${data.length} bytes)`);
    console.log(`  Contains SolidWorks Parasolid data (moPart_c, moCompEdge_cR, etc.)`);
    console.log(`  This is the B-Rep geometry but in SW's internal serialization format.`);
  }
}

// Process all test files
const files = process.argv.slice(2) || ['plate4.sldprt'];
for (const f of files) {
  processFile(f);
}
