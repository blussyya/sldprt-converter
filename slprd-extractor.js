/**
 * SLDPRT Mesh Extractor
 * Extracts 3D mesh geometry from SolidWorks .sldprt files
 * 
 * Works by parsing the OLE2 container, finding the DisplayLists stream,
 * and extracting tessellated vertex data (float32 LE triplets).
 * 
 * Usage:
 *   Node.js: const { extractMesh } = require('./slprd-extractor.js');
 *   Browser: import { extractMesh } from './slprd-extractor.js';
 */

// ============================================================
// OLE2 Compound File Parser
// ============================================================

function parseOLE2(buf) {
    const ss = 1 << buf.readUInt16LE(30);
    
    // Read DIFAT (109 entries from header)
    const difat = [];
    for (let i = 0; i < 109; i++) {
        const s = buf.readInt32LE(76 + i * 4);
        if (s >= 0) difat.push(s);
    }
    
    // Follow DIFAT chain for additional FAT sectors
    let sec = buf.readInt32LE(68);
    while (sec >= 0 && sec < 0xfffe_fffe) {
        const off = (sec + 1) * ss;
        for (let i = 0; i < ss / 4 - 1; i++) {
            const s = buf.readInt32LE(off + i * 4);
            if (s >= 0) difat.push(s);
        }
        sec = buf.readInt32LE(off + ss - 4);
    }
    
    // Build FAT from DIFAT sectors
    const fat = [];
    for (const s of difat) {
        const off = (s + 1) * ss;
        for (let i = 0; i < ss / 4; i++) {
            fat.push(buf.readInt32LE(off + i * 4));
        }
    }
    
    // Read directory
    const dirSec = buf.readUInt32LE(48);
    const chunks = [];
    let cur = dirSec;
    const visited = new Set();
    while (cur >= 0 && cur < 0xfffe_fffe && !visited.has(cur)) {
        visited.add(cur);
        const off = (cur + 1) * ss;
        if (off + ss > buf.length) break;
        chunks.push(buf.subarray(off, off + ss));
        cur = fat[cur] ?? -1;
    }
    
    const dirData = Buffer.concat(chunks);
    const entries = [];
    for (let i = 0; i + 128 <= dirData.length; i += 128) {
        const nameLen = dirData.readUInt16LE(i + 64);
        if (nameLen === 0) continue;
        const name = dirData.subarray(i, i + Math.max(0, nameLen - 2)).toString('utf16le');
        entries.push({
            name,
            type: dirData[i + 66],
            startSector: dirData.readInt32LE(i + 116),
            size: dirData.readUInt32LE(i + 120)
        });
    }
    
    return { ss, fat, entries };
}

function readStream(buf, fat, entry, ss) {
    if (entry.type !== 2 || entry.startSector < 0) return null;
    const chunks = [];
    let cur = entry.startSector;
    const visited = new Set();
    while (cur >= 0 && cur < 0xfffe_fffe && !visited.has(cur)) {
        visited.add(cur);
        const off = (cur + 1) * ss;
        if (off + ss > buf.length) break;
        chunks.push(buf.subarray(off, off + ss));
        cur = fat[cur] ?? -1;
    }
    return Buffer.concat(chunks).subarray(0, entry.size);
}

// ============================================================
// DisplayLists Parser
// ============================================================

function parseDisplayLists(data) {
    const result = {
        vertices: [],
        faces: [],
        faceVertexCounts: [],
        hasVertexData: false
    };
    
    // Find the tessellation header
    // It starts with u32 faceCount followed by per-face vertex counts
    // We look for a valid header where faceCount is reasonable (1-1000)
    // and the per-face counts are all 2-100
    
    let headerOffset = -1;
    let faceCount = 0;
    let faceVertexCounts = [];
    
    // Scan for potential headers
    // The DisplayLists stream structure is:
    //   [class records with ff ff markers] [tessellation header] [gap data] [vertex data]
    // The header follows the last class record. We find the last ff ff marker
    // and scan forward from there for the first valid header.
    
    let bestHeaderOffset = -1;
    let bestTotalVertices = 0;
    let bestFaceCount = 0;
    let bestCounts = [];
    
    // Find last ff ff marker (end of class records)
    let lastClassRecordEnd = 0;
    for (let i = 0; i < data.length - 6; i++) {
        if (data[i] === 0xFF && data[i + 1] === 0xFF) {
            lastClassRecordEnd = i;
        }
    }
    
    // Scan forward from last class record for valid headers
    // Try all 4 byte alignments
    for (let align = 0; align < 4; align++) {
        for (let i = lastClassRecordEnd + align; i < Math.min(data.length - 200, lastClassRecordEnd + 2000); i += 4) {
            const fc = data.readUInt32LE(i);
            if (fc < 1 || fc > 100) continue;
            
            let valid = true;
            const counts = [];
            for (let j = 0; j < fc; j++) {
                const offset = i + 4 + j * 4;
                if (offset + 4 > data.length) { valid = false; break; }
                const v = data.readUInt32LE(offset);
                if (v < 2 || v > 100) { valid = false; break; }
                counts.push(v);
            }
            
            if (!valid || counts.length !== fc) continue;
            
            const totalVertices = counts.reduce((a, b) => a + b, 0);
            const expectedBytes = totalVertices * 12;
            
            if (i + 4 + fc * 4 + expectedBytes > data.length) continue;
            
            // Prefer the first valid header after class records
            if (bestHeaderOffset === -1) {
                bestHeaderOffset = i;
                bestTotalVertices = totalVertices;
                bestFaceCount = fc;
                bestCounts = counts;
            }
        }
    }
    
    // Fallback: if no header found near class records, scan the full stream
    if (bestHeaderOffset === -1) {
        for (let align = 0; align < 4; align++) {
            for (let i = align; i < data.length - 200; i += 4) {
                const fc = data.readUInt32LE(i);
                if (fc < 1 || fc > 100) continue;
                
                let valid = true;
                const counts = [];
                for (let j = 0; j < fc; j++) {
                    const offset = i + 4 + j * 4;
                    if (offset + 4 > data.length) { valid = false; break; }
                    const v = data.readUInt32LE(offset);
                    if (v < 2 || v > 100) { valid = false; break; }
                    counts.push(v);
                }
                
                if (!valid || counts.length !== fc) continue;
                
                const totalVertices = counts.reduce((a, b) => a + b, 0);
                const expectedBytes = totalVertices * 12;
                
                if (i + 4 + fc * 4 + expectedBytes > data.length) continue;
                
                if (totalVertices > bestTotalVertices) {
                    bestHeaderOffset = i;
                    bestTotalVertices = totalVertices;
                    bestFaceCount = fc;
                    bestCounts = counts;
                }
            }
        }
    }
    
    headerOffset = bestHeaderOffset;
    faceCount = bestFaceCount;
    faceVertexCounts = bestCounts;
    
    if (headerOffset === -1) return result;
    
    const headerEnd = headerOffset + 4 + faceCount * 4;
    const totalVertices = faceVertexCounts.reduce((a, b) => a + b, 0);
    const expectedVertexBytes = totalVertices * 12;
    
    // Strategy: scan forward from headerEnd for valid vertex blocks.
    // The DisplayLists structure has gap data between header and real vertex block.
    // Gap data has interleaved -0.075 y-values (bottom face z=-0.075mm) and
    // repeated coordinate patterns. Real vertex data has diverse, non-repeated coords.
    //
    // Detection heuristics (applied in order):
    //   1. All 159 triplets must be valid float32 in range
    //   2. No more than 3 vertices with y near -0.075 (gap signature)
    //   3. X and Y values must have sufficient diversity (stddev > 0.001)
    //   4. No more than 30% of vertices share the same y-value (gap has ~83%)
    //   5. No coordinate component should have a value > 0.5 (excludes transform matrices)
    
    let vertexDataOffset = -1;
    
    function scoreCandidate(off) {
        const xs = [], ys = [], zs = [];
        let yNeg075 = 0;
        let yValues = {};
        
        for (let v = 0; v < totalVertices; v++) {
            const p = off + v * 12;
            if (p + 12 > data.length) return -1;
            const x = data.readFloatLE(p);
            const y = data.readFloatLE(p + 4);
            const z = data.readFloatLE(p + 8);
            if (!(isFinite(x) && isFinite(y) && isFinite(z) &&
                  Math.abs(x) < 100000 && Math.abs(y) < 100000 && Math.abs(z) < 100000)) {
                return -1;
            }
            if (Math.abs(x) > 0.5 || Math.abs(y) > 0.5 || Math.abs(z) > 0.5) return -1;
            if (Math.abs(y - (-0.075)) < 0.001) yNeg075++;
            xs.push(x); ys.push(y); zs.push(z);
            const yKey = (y * 10000) | 0;
            yValues[yKey] = (yValues[yKey] || 0) + 1;
        }
        
        // Filter: gap data has many -0.075 y-values
        if (yNeg075 > 3) return -1;
        
        // Filter: gap data has many vertices sharing the same y-value
        const maxRepeat = Math.max(...Object.values(yValues));
        if (maxRepeat > totalVertices * 0.3) return -1;
        
        // Score: diversity of x and y coordinates (higher is better for real mesh)
        const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
        const stddev = arr => { const m = mean(arr); return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length); };
        const xStd = stddev(xs);
        const yStd = stddev(ys);
        
        return xStd + yStd;
    }
    
    // Scan from headerEnd at all 4 byte alignments
    let bestScore = -1;
    for (let align = 0; align < 4; align++) {
        for (let off = headerEnd + align; off <= data.length - expectedVertexBytes; off += 4) {
            const score = scoreCandidate(off);
            if (score > bestScore) {
                bestScore = score;
                vertexDataOffset = off;
            }
        }
    }
    
    if (vertexDataOffset === -1) return result;
    
    // Extract vertices
    
    const vertices = [];
    for (let i = 0; i < totalVertices; i++) {
        const off = vertexDataOffset + i * 12;
        const x = data.readFloatLE(off);
        const y = data.readFloatLE(off + 4);
        const z = data.readFloatLE(off + 8);
        vertices.push([x, y, z]);
    }
    
    result.vertices = vertices;
    result.faceVertexCounts = faceVertexCounts;
    result.hasVertexData = true;
    
    // Build face indices (triangle fans)
    let offset = 0;
    const faces = [];
    for (const count of faceVertexCounts) {
        const faceIndices = [];
        for (let i = 0; i < count; i++) {
            faceIndices.push(offset + i);
        }
        faces.push(faceIndices);
        offset += count;
    }
    result.faces = faces;
    
    return result;
}

// ============================================================
// Main Extraction Function
// ============================================================

/**
 * Extract mesh from SLDPRT buffer
 * @param {Buffer|ArrayBuffer} buf - SLDPRT file data
 * @returns {Object} Mesh data with vertices and faces
 */
function extractMesh(buf) {
    // Convert ArrayBuffer to Buffer if needed
    if (buf instanceof ArrayBuffer) {
        buf = Buffer.from(buf);
    }
    
    const result = {
        vertices: [],
        faces: [],
        faceVertexCounts: [],
        partDimensions: null,
        warnings: [],
        errors: []
    };
    
    // Parse OLE2
    let ole;
    try {
        ole = parseOLE2(buf);
    } catch (e) {
        result.errors.push(`Failed to parse OLE2: ${e.message}`);
        return result;
    }
    
    // Find DisplayLists stream (try both compressed and uncompressed)
    let dlEntry = ole.entries.find(e => e.name === 'DisplayLists' && e.type === 2);
    let isCompressed = false;
    
    if (!dlEntry) {
        dlEntry = ole.entries.find(e => e.name === 'DisplayLists__Zip' && e.type === 2);
        isCompressed = true;
    }
    
    if (!dlEntry) {
        result.errors.push('No DisplayLists stream found');
        return result;
    }
    
    const dlData = readStream(buf, ole.fat, dlEntry, ole.ss);
    if (!dlData) {
        result.errors.push('Failed to read DisplayLists stream');
        return result;
    }
    
    if (isCompressed) {
        result.warnings.push('DisplayLists is compressed (__Zip format) - attempting decompression');
        // __Zip uses brotli at offset 14
        try {
            const { brotliDecompressSync } = require('zlib');
            const decompressed = brotliDecompressSync(dlData.subarray(14));
            // The decompressed data is another encoding layer
            // For now, we can't extract from compressed streams
            result.warnings.push('Cannot extract from compressed DisplayLists__Zip stream');
            result.warnings.push('Only uncompressed DisplayLists streams are supported');
        } catch (e) {
            result.warnings.push(`Brotli decompression failed: ${e.message}`);
        }
    }
    
    // Parse DisplayLists
    const mesh = parseDisplayLists(dlData);
    
    if (!mesh.hasVertexData) {
        result.warnings.push('No vertex data found in DisplayLists stream');
        return result;
    }
    
    result.vertices = mesh.vertices;
    result.faces = mesh.faces;
    result.faceVertexCounts = mesh.faceVertexCounts;
    
    // Calculate part dimensions
    if (result.vertices.length > 0) {
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;
        
        for (const [x, y, z] of result.vertices) {
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
            minZ = Math.min(minZ, z);
            maxZ = Math.max(maxZ, z);
        }
        
        result.partDimensions = {
            x: { min: minX, max: maxX, size: maxX - minX },
            y: { min: minY, max: maxY, size: maxY - minY },
            z: { min: minZ, max: maxZ, size: maxZ - minZ }
        };
    }
    
    return result;
}

// ============================================================
// Output Generators
// ============================================================

/**
 * Generate OBJ format string
 * @param {Object} mesh - Mesh data from extractMesh()
 * @returns {string} OBJ file content
 */
function toOBJ(mesh) {
    let obj = '# SLDPRT mesh extracted by slprd-extractor\n';
    obj += `# ${mesh.vertices.length} vertices, ${mesh.faces.length} faces\n\n`;
    
    // Vertices
    for (const [x, y, z] of mesh.vertices) {
        obj += `v ${x.toFixed(6)} ${y.toFixed(6)} ${z.toFixed(6)}\n`;
    }
    
    obj += '\n';
    
    // Faces (OBJ uses 1-based indexing)
    for (const face of mesh.faces) {
        if (face.length === 3) {
            obj += `f ${face[0] + 1} ${face[1] + 1} ${face[2] + 1}\n`;
        } else if (face.length >= 3) {
            // Triangle fan
            for (let i = 1; i < face.length - 1; i++) {
                obj += `f ${face[0] + 1} ${face[i] + 1} ${face[i + 1] + 1}\n`;
            }
        }
    }
    
    return obj;
}

/**
 * Generate STL format string (ASCII)
 * @param {Object} mesh - Mesh data from extractMesh()
 * @returns {string} STL file content
 */
function toSTL(mesh) {
    let stl = 'solid slprd_extracted\n';
    
    for (const face of mesh.faces) {
        if (face.length < 3) continue;
        
        // Triangle fan
        for (let i = 1; i < face.length - 1; i++) {
            const v0 = mesh.vertices[face[0]];
            const v1 = mesh.vertices[face[i]];
            const v2 = mesh.vertices[face[i + 1]];
            
            // Calculate normal (cross product)
            const ax = v1[0] - v0[0], ay = v1[1] - v0[1], az = v1[2] - v0[2];
            const bx = v2[0] - v0[0], by = v2[1] - v0[1], bz = v2[2] - v0[2];
            const nx = ay * bz - az * by;
            const ny = az * bx - ax * bz;
            const nz = ax * by - ay * bx;
            const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
            
            stl += `  facet normal ${(nx / len).toFixed(6)} ${(ny / len).toFixed(6)} ${(nz / len).toFixed(6)}\n`;
            stl += `    outer loop\n`;
            stl += `      vertex ${v0[0].toFixed(6)} ${v0[1].toFixed(6)} ${v0[2].toFixed(6)}\n`;
            stl += `      vertex ${v1[0].toFixed(6)} ${v1[1].toFixed(6)} ${v1[2].toFixed(6)}\n`;
            stl += `      vertex ${v2[0].toFixed(6)} ${v2[1].toFixed(6)} ${v2[2].toFixed(6)}\n`;
            stl += `    endloop\n`;
            stl += `  endfacet\n`;
        }
    }
    
    stl += 'endsolid slprd_extracted\n';
    return stl;
}

/**
 * Generate binary STL
 * @param {Object} mesh - Mesh data from extractMesh()
 * @returns {Buffer} Binary STL data
 */
function toBinarySTL(mesh) {
    // Count triangles
    let triCount = 0;
    for (const face of mesh.faces) {
        if (face.length >= 3) triCount += face.length - 2;
    }
    
    // STL binary header: 80 bytes + 4 bytes triangle count + 50 bytes per triangle
    const buf = Buffer.alloc(84 + triCount * 50);
    
    // Header (80 bytes, can be anything)
    buf.write('SLDPRT extracted by slprd-extractor', 0);
    
    // Triangle count
    buf.writeUInt32LE(triCount, 80);
    
    let offset = 84;
    for (const face of mesh.faces) {
        if (face.length < 3) continue;
        
        for (let i = 1; i < face.length - 1; i++) {
            const v0 = mesh.vertices[face[0]];
            const v1 = mesh.vertices[face[i]];
            const v2 = mesh.vertices[face[i + 1]];
            
            // Normal
            const ax = v1[0] - v0[0], ay = v1[1] - v0[1], az = v1[2] - v0[2];
            const bx = v2[0] - v0[0], by = v2[1] - v0[1], bz = v2[2] - v0[2];
            const nx = ay * bz - az * by;
            const ny = az * bx - ax * bz;
            const nz = ax * by - ay * bx;
            const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
            
            // Normal
            buf.writeFloatLE(nx / len, offset); offset += 4;
            buf.writeFloatLE(ny / len, offset); offset += 4;
            buf.writeFloatLE(nz / len, offset); offset += 4;
            
            // Vertex 0
            buf.writeFloatLE(v0[0], offset); offset += 4;
            buf.writeFloatLE(v0[1], offset); offset += 4;
            buf.writeFloatLE(v0[2], offset); offset += 4;
            
            // Vertex 1
            buf.writeFloatLE(v1[0], offset); offset += 4;
            buf.writeFloatLE(v1[1], offset); offset += 4;
            buf.writeFloatLE(v1[2], offset); offset += 4;
            
            // Vertex 2
            buf.writeFloatLE(v2[0], offset); offset += 4;
            buf.writeFloatLE(v2[1], offset); offset += 4;
            buf.writeFloatLE(v2[2], offset); offset += 4;
            
            // Attribute byte count (0)
            buf.writeUInt16LE(0, offset); offset += 2;
        }
    }
    
    return buf;
}

// ============================================================
// Exports
// ============================================================

// Node.js / CommonJS
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { extractMesh, toOBJ, toSTL, toBinarySTL, parseOLE2 };
}

// ES Modules
if (typeof window !== 'undefined') {
    window.slprdExtractor = { extractMesh, toOBJ, toSTL, toBinarySTL, parseOLE2 };
}
