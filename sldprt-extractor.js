/**
 * SLDPRT File Extractor
 * Extracts geometry from SolidWorks .sldprt files by:
 * 1. Parsing OLE2 container
 * 2. Finding _ZLB (zlib-compressed) streams
 * 3. Decompressing and parsing triangle data
 * 
 * Research references:
 * - SLDPRT = OLE2 structured storage
 * - Contents/DisplayLists__ZLB = zlib-compressed display tessellation
 * - Config-0-Partition = zlib-compressed Parasolid B-Rep (.x_b format)
 * - _ZLB suffix means the data is zlib-compressed
 */

class SldprtExtractor {
  constructor(buffer) {
    this.buffer = buffer;
    this.ole2 = null;
    this.streams = [];
    this.zlbStreams = [];
    this.decompressedData = {};
    this.triangles = null;
    this.stats = {
      fileSize: buffer.byteLength,
      streamCount: 0,
      zlbCount: 0,
      decompressedBytes: 0,
      triangleCount: 0
    };
  }

  async extract() {
    // Step 1: Parse OLE2 container
    this.ole2 = new Ole2Parser(this.buffer);
    this.ole2.parse();

    // Step 2: List all streams
    this.streams = this.ole2.listStreams();
    this.stats.streamCount = this.streams.length;

    // Step 3: Find all _ZLB streams
    this.zlbStreams = this.ole2.findStreams(/_ZLB|ZLB/i);
    this.stats.zlbCount = this.zlbStreams.length;

    // Step 4: Decompress all _ZLB streams
    for (const stream of this.zlbStreams) {
      try {
        const compressed = this.ole2.readStream(stream);
        const decompressed = await this._decompressZlib(compressed);
        this.decompressedData[stream.fullPath || stream.name] = decompressed;
        this.stats.decompressedBytes += decompressed.byteLength;
      } catch (e) {
        console.warn(`Failed to decompress ${stream.name}:`, e.message);
      }
    }

    // Step 5: Also try to read Config partitions (non-_ZLB)
    const configStreams = this.ole2.findStreams(/Config|Partition/i);
    for (const stream of configStreams) {
      const name = stream.fullPath || stream.name;
      if (!this.decompressedData[name]) {
        try {
          const data = this.ole2.readStream(stream);
          // Check if it's zlib-compressed
          const bytes = new Uint8Array(data);
          if (bytes.length > 2 && bytes[0] === 0x78 && (bytes[1] === 0x01 || bytes[1] === 0x5E || bytes[1] === 0x9C || bytes[1] === 0xDA)) {
            const decompressed = await this._decompressZlib(data);
            this.decompressedData[name] = decompressed;
            this.stats.decompressedBytes += decompressed.byteLength;
          } else {
            // Store raw data
            this.decompressedData[name] = data;
          }
        } catch (e) {
          console.warn(`Failed to read config stream ${stream.name}:`, e.message);
        }
      }
    }

    // Step 6: Try to extract triangles
    this.triangles = this._extractTriangles();

    return this;
  }

  async _decompressZlib(buffer) {
    // Try browser's DecompressionStream first
    if (typeof DecompressionStream !== 'undefined') {
      try {
        return await this._decompressWithStream(buffer, 'deflate');
      } catch (e) {
        // Try with raw deflate (no zlib header)
        try {
          return await this._decompressWithStream(buffer, 'deflate-raw');
        } catch (e2) {
          // Try gzip
          try {
            return await this._decompressWithStream(buffer, 'gzip');
          } catch (e3) {
            throw new Error('All decompression methods failed');
          }
        }
      }
    }
    throw new Error('DecompressionStream not available');
  }

  async _decompressWithStream(buffer, format) {
    const ds = new DecompressionStream(format);
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();
    
    const writePromise = writer.write(new Uint8Array(buffer)).then(() => writer.close());
    
    const chunks = [];
    let totalLength = 0;
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalLength += value.length;
    }
    
    await writePromise;
    
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    
    return result.buffer;
  }

  /**
   * Try to extract triangles from all decompressed data
   */
  _extractTriangles() {
    const allTriangles = [];
    
    for (const [name, data] of Object.entries(this.decompressedData)) {
      const bytes = new Uint8Array(data);
      
      // Try different extraction strategies
      let triangles = null;
      
      // Strategy 1: Check if it's Parasolid .x_b format
      if (this._isParasolidXB(bytes)) {
        triangles = this._extractFromParasolid(bytes);
        if (triangles && triangles.length > 0) {
          allTriangles.push({ source: name + ' (Parasolid)', triangles });
        }
      }
      
      // Strategy 2: Check if it's display tessellation data
      if (!triangles || triangles.length === 0) {
        triangles = this._extractFromDisplayList(bytes);
        if (triangles && triangles.length > 0) {
          allTriangles.push({ source: name + ' (DisplayList)', triangles });
        }
      }
      
      // Strategy 3: Try to find triangle-like patterns
      if (!triangles || triangles.length === 0) {
        triangles = this._extractByPatternMatching(bytes);
        if (triangles && triangles.length > 0) {
          allTriangles.push({ source: name + ' (PatternMatch)', triangles });
        }
      }
    }
    
    // Merge all triangles
    const merged = { positions: [], normals: [] };
    for (const set of allTriangles) {
      merged.positions.push(...set.triangles.positions);
      merged.normals.push(...set.triangles.normals);
    }
    
    this.stats.triangleCount = merged.positions.length / 9;
    return merged;
  }

  /**
   * Check if data looks like Parasolid .x_b format
   * .x_b starts with: body count, version info, etc.
   * Typical header: some int32 values, then 'BODY' markers
   */
  _isParasolidXB(bytes) {
    if (bytes.length < 16) return false;
    
    // .x_b is big-endian Parasolid
    // Check for known Parasolid patterns
    const dv = new DataView(bytes.buffer);
    
    // First few bytes should be reasonable numbers
    const firstInt = dv.getInt32(0, false); // big-endian
    if (firstInt < 0 || firstInt > 10000) return false;
    
    // Look for 'BODY' or 'BODY ' markers somewhere in first 1KB
    const searchLen = Math.min(bytes.length, 1024);
    for (let i = 0; i < searchLen - 4; i++) {
      if (bytes[i] === 0x42 && bytes[i+1] === 0x4F && bytes[i+2] === 0x44 && bytes[i+3] === 0x59) {
        return true; // Found 'BODY'
      }
    }
    
    // Look for common Parasolid markers
    // Version markers, face markers, edge markers
    for (let i = 0; i < searchLen - 8; i++) {
      const val32 = dv.getUint32(i, false);
      // Parasolid version numbers are typically in range 200-400
      if (val32 >= 200 && val32 <= 400 && i < 20) return true;
    }
    
    return false;
  }

  /**
   * Try to extract triangles from Parasolid .x_b data
   * This is a best-effort extraction - the format is complex and proprietary
   */
  _extractFromParasolid(bytes) {
    const dv = new DataView(bytes.buffer);
    const positions = [];
    const normals = [];
    
    // Parasolid .x_b is big-endian
    // The format contains bodies with faces, each face has tessellation
    // Triangle data is typically stored as:
    // - Vertex coordinates (3 float64 or float32 values per vertex)
    // - Triangle indices (3 int32 values per triangle)
    
    // Strategy: scan for sequences of 3 float32 values that look like
    // reasonable 3D coordinates (within ±10000 range)
    
    const vertices = [];
    const coords = [];
    
    // Scan for floating point coordinates
    for (let i = 0; i < bytes.length - 12; i += 4) {
      try {
        const f = dv.getFloat32(i, false); // big-endian
        if (isFinite(f) && Math.abs(f) > 0.001 && Math.abs(f) < 100000) {
          coords.push({ offset: i, value: f });
        }
      } catch (e) {
        // skip
      }
    }
    
    // Also try little-endian
    for (let i = 0; i < bytes.length - 12; i += 4) {
      try {
        const f = dv.getFloat32(i, true); // little-endian
        if (isFinite(f) && Math.abs(f) > 0.001 && Math.abs(f) < 100000) {
          coords.push({ offset: i, value: f, le: true });
        }
      } catch (e) {
        // skip
      }
    }
    
    // Group consecutive coordinates into vertices
    // Vertices should be 3 consecutive floats
    const potentialVertices = [];
    for (let i = 0; i < coords.length - 2; i++) {
      const c1 = coords[i];
      const c2 = coords[i+1];
      const c3 = coords[i+2];
      
      // Same endianness and close offsets
      if (c1.le === c2.le && c2.le === c3.le && 
          c2.offset - c1.offset <= 12 && c3.offset - c2.offset <= 12) {
        potentialVertices.push({
          x: c1.value,
          y: c2.value,
          z: c3.value,
          offset: c1.offset,
          le: c1.le
        });
      }
    }
    
    // Look for patterns that suggest triangle lists
    // (groups of 3 vertices with similar magnitudes)
    for (let i = 0; i < potentialVertices.length - 2; i += 3) {
      const v1 = potentialVertices[i];
      const v2 = potentialVertices[i+1];
      const v3 = potentialVertices[i+2];
      
      // Check if these could be triangle vertices
      const maxMag = Math.max(
        Math.abs(v1.x), Math.abs(v1.y), Math.abs(v1.z),
        Math.abs(v2.x), Math.abs(v2.y), Math.abs(v2.z),
        Math.abs(v3.x), Math.abs(v3.y), Math.abs(v3.z)
      );
      const minMag = Math.min(
        Math.abs(v1.x) + Math.abs(v1.y) + Math.abs(v1.z),
        Math.abs(v2.x) + Math.abs(v2.y) + Math.abs(v2.z),
        Math.abs(v3.x) + Math.abs(v3.y) + Math.abs(v3.z)
      );
      
      // Reasonable coordinate range and not degenerate
      if (maxMag < 50000 && minMag > 0.01) {
        positions.push(v1.x, v1.y, v1.z, v2.x, v2.y, v2.z, v3.x, v3.y, v3.z);
        // Compute face normal
        const ux = v2.x - v1.x, uy = v2.y - v1.y, uz = v2.z - v1.z;
        const vx = v3.x - v1.x, vy = v3.y - v1.y, vz = v3.z - v1.z;
        const nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
        const nl = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
        normals.push(nx/nl, ny/nl, nz/nl, nx/nl, ny/nl, nz/nl, nx/nl, ny/nl, nz/nl);
      }
    }
    
    if (positions.length > 0) {
      return { positions, normals };
    }
    return null;
  }

  /**
   * Try to extract from SolidWorks display list format
   * Display lists contain tessellated geometry for viewport rendering
   */
  _extractFromDisplayList(bytes) {
    const dv = new DataView(bytes.buffer);
    const positions = [];
    const normals = [];
    
    // Display list format (based on research):
    // - Contains triangle strips
    // - Vertices stored as float32 triplets
    // - May have headers/metadata between strips
    
    // Scan for triangle-like data blocks
    // Look for runs of 3D coordinates
    
    const candidates = [];
    
    for (let i = 0; i < bytes.length - 12; i += 4) {
      // Try both endiannesses
      for (const le of [true, false]) {
        try {
          const x = dv.getFloat32(i, le);
          const y = dv.getFloat32(i + 4, le);
          const z = dv.getFloat32(i + 8, le);
          
          if (isFinite(x) && isFinite(y) && isFinite(z) &&
              Math.abs(x) < 50000 && Math.abs(y) < 50000 && Math.abs(z) < 50000 &&
              (Math.abs(x) + Math.abs(y) + Math.abs(z)) > 0.01) {
            candidates.push({ x, y, z, offset: i, le });
          }
        } catch (e) {}
      }
    }
    
    // Find clusters of vertices that could be triangles
    // Vertices in a triangle strip should be close in the file
    let bestRun = [];
    let currentRun = [];
    
    for (let i = 0; i < candidates.length; i++) {
      if (currentRun.length === 0 || 
          candidates[i].offset - (currentRun[currentRun.length-1]?.offset || 0) <= 16) {
        currentRun.push(candidates[i]);
      } else {
        if (currentRun.length > bestRun.length && currentRun.length >= 3) {
          bestRun = currentRun;
        }
        currentRun = [candidates[i]];
      }
    }
    if (currentRun.length > bestRun.length) bestRun = currentRun;
    
    // Convert best run to triangles
    if (bestRun.length >= 3) {
      for (let i = 0; i < bestRun.length - 2; i += 3) {
        const v1 = bestRun[i];
        const v2 = bestRun[Math.min(i+1, bestRun.length-1)];
        const v3 = bestRun[Math.min(i+2, bestRun.length-1)];
        
        positions.push(v1.x, v1.y, v1.z, v2.x, v2.y, v2.z, v3.x, v3.y, v3.z);
        
        const ux = v2.x-v1.x, uy = v2.y-v1.y, uz = v2.z-v1.z;
        const vx = v3.x-v1.x, vy = v3.y-v1.y, vz = v3.z-v1.z;
        const nx = uy*vz-uz*vy, ny = uz*vx-ux*vz, nz = ux*vy-uy*vx;
        const nl = Math.sqrt(nx*nx+ny*ny+nz*nz)||1;
        normals.push(nx/nl, ny/nl, nz/nl, nx/nl, ny/nl, nz/nl, nx/nl, ny/nl, nz/nl);
      }
    }
    
    if (positions.length > 0) {
      return { positions, normals };
    }
    return null;
  }

  /**
   * Generic pattern matching for triangle data
   * Looks for sequences of 3D coordinates that form triangles
   */
  _extractByPatternMatching(bytes) {
    const dv = new DataView(bytes.buffer);
    const positions = [];
    const normals = [];
    
    // Try to find indexed triangle data:
    // - First: vertex list (N * 3 floats)
    // - Then: index list (M * 3 ints)
    
    // This is a heuristic approach
    for (let startOffset = 0; startOffset < Math.min(bytes.length - 100, 10000); startOffset += 4) {
      const verts = [];
      
      // Try to read up to 1000 vertices
      for (let v = 0; v < 1000; v++) {
        const off = startOffset + v * 12;
        if (off + 12 > bytes.length) break;
        
        try {
          // Try big-endian first (Parasolid style)
          let x = dv.getFloat32(off, false);
          let y = dv.getFloat32(off + 4, false);
          let z = dv.getFloat32(off + 8, false);
          
          // If values look unreasonable, try little-endian
          if (!isFinite(x) || Math.abs(x) > 100000) {
            x = dv.getFloat32(off, true);
            y = dv.getFloat32(off + 4, true);
            z = dv.getFloat32(off + 8, true);
          }
          
          if (!isFinite(x) || !isFinite(y) || !isFinite(z)) break;
          if (Math.abs(x) > 100000 || Math.abs(y) > 100000 || Math.abs(z) > 100000) break;
          if (Math.abs(x) + Math.abs(y) + Math.abs(z) < 0.001) break;
          
          verts.push({ x, y, z });
        } catch (e) {
          break;
        }
      }
      
      if (verts.length >= 3) {
        // Try to interpret as triangle list (every 3 vertices = 1 triangle)
        for (let i = 0; i < verts.length - 2; i += 3) {
          const v1 = verts[i], v2 = verts[i+1], v3 = verts[i+2];
          positions.push(v1.x, v1.y, v1.z, v2.x, v2.y, v2.z, v3.x, v3.y, v3.z);
          
          const ux = v2.x-v1.x, uy = v2.y-v1.y, uz = v2.z-v1.z;
          const vx = v3.x-v1.x, vy = v3.y-v1.y, vz = v3.z-v1.z;
          const nx = uy*vz-uz*vy, ny = uz*vx-ux*vz, nz = ux*vy-uy*vx;
          const nl = Math.sqrt(nx*nx+ny*ny+nz*nz)||1;
          normals.push(nx/nl, ny/nl, nz/nl, nx/nl, ny/nl, nz/nl, nx/nl, ny/nl, nz/nl);
        }
        
        if (positions.length > 0) {
          return { positions, normals };
        }
      }
    }
    
    return null;
  }

  /**
   * Export extracted geometry as OBJ
   */
  toOBJ() {
    if (!this.triangles || this.triangles.positions.length === 0) return null;
    
    let obj = '# Extracted from SLDPRT by KARAZA SLDPRT Research\n';
    obj += `# Source: ${this.stats.fileSize} bytes\n`;
    obj += `# Triangles: ${this.stats.triangleCount}\n\n`;
    
    const pos = this.triangles.positions;
    const nrm = this.triangles.normals;
    
    // Write vertices
    for (let i = 0; i < pos.length; i += 3) {
      obj += `v ${pos[i].toFixed(6)} ${pos[i+1].toFixed(6)} ${pos[i+2].toFixed(6)}\n`;
    }
    
    // Write normals
    for (let i = 0; i < nrm.length; i += 3) {
      obj += `vn ${nrm[i].toFixed(6)} ${nrm[i+1].toFixed(6)} ${nrm[i+2].toFixed(6)}\n`;
    }
    
    // Write faces
    const vertCount = pos.length / 3;
    for (let i = 0; i < vertCount; i += 3) {
      const a = i + 1, b = i + 2, c = i + 3;
      obj += `f ${a}//${a} ${b}//${b} ${c}//${c}\n`;
    }
    
    return obj;
  }

  /**
   * Get detailed report of what was found
   */
  getReport() {
    const report = {
      stats: this.stats,
      streams: this.streams.map(s => ({
        name: s.name,
        path: s.path,
        size: s.size
      })),
      zlbStreams: this.zlbStreams.map(s => ({
        name: s.name,
        path: s.fullPath || s.name,
        size: s.streamSize
      })),
      decompressedKeys: Object.keys(this.decompressedData),
      decompressedSizes: {},
      hasTriangles: this.triangles && this.triangles.positions.length > 0
    };
    
    for (const [key, val] of Object.entries(this.decompressedData)) {
      report.decompressedSizes[key] = val.byteLength;
    }
    
    return report;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  const { Ole2Parser } = require('./ole2-parser');
  // Make Ole2Parser available globally for the class
  global.Ole2Parser = Ole2Parser;
  module.exports = { SldprtExtractor };
} else {
  window.SldprtExtractor = SldprtExtractor;
}
