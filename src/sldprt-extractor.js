/**
 * SLDPRT Mesh Extractor
 * Extracts 3D mesh geometry from SolidWorks .sldprt files
 * 
 * Supports both old (OLE2) and new (openswx) formats.
 * Old format: OLE2 container → DisplayLists stream → float32 vertex data
 * New format: ROL-encoded archive → openswx decompression → MFC CArchive → multi-surface tessellation
 * 
 * Usage:
 *   Node.js: const { extractMesh, toOBJ, toSTL, toBinarySTL } = require('./sldprt-extractor.js');
 *   Browser: <script src="sldprt-extractor.js"></script> then window.sldprtExtractor.extractMesh(buf)
 */

// Verbose logging
// ============================================================

let _verbose = false;

function _log(...args) {
    if (_verbose && typeof console !== 'undefined') {
        console.warn('[sldprt]', ...args);
    }
}

function setVerbose(v) {
    _verbose = !!v;
}

// ============================================================
// Shared utility: findAll (matches pattern in buffer)
// ============================================================

let _findAll;
if (typeof require !== 'undefined') {
    try { _findAll = require('./utils').findAll; } catch (e) {}
}
if (!_findAll) {
    _findAll = function(buf, pattern) {
        const pos = [];
        for (let i = 0; i <= buf.length - pattern.length; i++) {
            let ok = true;
            for (let j = 0; j < pattern.length; j++) {
                if (buf[i + j] !== pattern[j]) { ok = false; break; }
            }
            if (ok) pos.push(i);
        }
        return pos;
    };
}

const _inflate = (function() {
    if (typeof require !== 'undefined') {
        try {
            const zlib = require('zlib');
            return {
                inflateRaw: (buf) => zlib.inflateRawSync(Buffer.from(buf)),
                inflate: (buf) => zlib.inflateSync(Buffer.from(buf)),
                brotli: (buf) => zlib.brotliDecompressSync(Buffer.from(buf))
            };
        } catch (e) {
            if (typeof console !== 'undefined') console.warn('zlib load failed:', e.message);
        }
    }
    if (typeof pako !== 'undefined') {
        return {
            inflateRaw: (buf) => pako.inflateRaw(new Uint8Array(buf)),
            inflate: (buf) => pako.inflate(new Uint8Array(buf)),
            brotli: null
        };
    }
    if (typeof console !== 'undefined') console.warn('No inflate library available (zlib or pako)');
    return { inflateRaw: null, inflate: null, brotli: null };
})();

function _rolByte(b, shift) {
    shift &= 7;
    if (shift === 0) return b;
    return ((b << shift) | (b >>> (8 - shift))) & 0xFF;
}

// ============================================================
// OLE2 parser (import from module or inline)
// ============================================================

let _ole2;
if (typeof require !== 'undefined') {
    try { _ole2 = require('./ole2-parser'); } catch (e) {}
}
if (!_ole2) {
    _ole2 = { parseOLE2: null, readStream: null, ensureBuffer: null, _concatChunks: null };
}
const parseOLE2 = _ole2.parseOLE2 || function() { throw new Error('OLE2 parser not loaded'); };
const readStream = _ole2.readStream || function() { throw new Error('OLE2 reader not loaded'); };
const _ensureBuffer = _ole2.ensureBuffer || function(data) { return data; };
const _concatChunks = _ole2._concatChunks || function(chunks) {
    const total = chunks.reduce((acc, c) => acc + c.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk), offset);
        offset += chunk.length;
    }
    return result;
};

function _decompressOpenSX(buf) {
    buf = _ensureBuffer(buf);
    const key = buf[7];
    const marker = new Uint8Array([0x14, 0x00, 0x06, 0x00, 0x08, 0x00]);
    const streams = {};

    for (const mp of _findAll(buf, marker)) {
        const si = mp - 4;
        if (si < 0 || si + 0x1E > buf.length) continue;

        const f1 = buf.readUInt32LE(si + 0x0E);
        const csz = buf.readUInt32LE(si + 0x12);
        const nsz = buf.readUInt32LE(si + 0x1A);

        if (nsz > 1024 || csz > 50 * 1024 * 1024) continue;

        const nameStart = si + 0x1E;
        const nameEnd = nameStart + nsz;
        if (nameEnd > buf.length) continue;

        const rawName = buf.subarray(nameStart, nameEnd);
        let name = '';
        for (let i = 0; i < nsz; i++) {
            name += String.fromCharCode(_rolByte(rawName[i], key));
        }
        if (name.length === 0) continue;

        const dataStart = nameEnd;
        const dataEnd = dataStart + csz;
        if (dataEnd > buf.length) continue;

        if (f1 >= 65536 && csz > 0) {
            const compressed = buf.subarray(dataStart, dataEnd);
            let decompressed = null;

            if (_inflate.inflateRaw) {
                try { decompressed = _inflate.inflateRaw(compressed); } catch (e) {
                    _log('inflateRaw failed for', name, '- trying inflate:', e.message);
                }
            }
            if (!decompressed || decompressed.length === 0) {
                if (_inflate.inflate) {
                    try { decompressed = _inflate.inflate(compressed); } catch (e) {
                        _log('inflate failed for', name, '- skipping:', e.message);
                    }
                }
            }

            if (decompressed && decompressed.length > 0 && !streams[name]) {
                streams[name] = decompressed;
            }
        }
    }

    return streams;
}

function findDisplayLists(buf) {
    // Try old format (OLE2) first
    try {
        const ole = parseOLE2(buf);
        let dlEntry = ole.entries.find(e => e.name === 'DisplayLists' && e.type === 2);
        if (dlEntry) {
            const dlData = readStream(buf, ole.fat, dlEntry, ole.ss);
            if (dlData && dlData.length > 100) return dlData;
        }

        dlEntry = ole.entries.find(e => e.name === 'DisplayLists__Zip' && e.type === 2);
        if (dlEntry) {
            const dlData = readStream(buf, ole.fat, dlEntry, ole.ss);
            if (dlData && dlData.length > 100 && _inflate.brotli) {
                try {
                    const decompressed = _inflate.brotli(dlData.subarray(14));
                    if (decompressed && decompressed.length > 100) return decompressed;
                } catch (e) {
                    _log('brotli decompression failed:', e.message);
                }
            }
        }
    } catch (e) {
        _log('OLE2 parse failed:', e.message);
    }

    // Try new format (openswx)
    try {
        const streams = _decompressOpenSX(buf);
        for (const [name, data] of Object.entries(streams)) {
            if (name.toLowerCase().includes('displaylist') && data.length > 100) {
                const d = _ensureBuffer(data);
                if (d.readUInt32LE(0) === 1 && d.readUInt32LE(4) === 1) {
                    return data;
                }
            }
        }
    } catch (e) {
        _log('openswx extraction failed:', e.message);
    }

    return null;
}

// ============================================================
// DisplayLists Parser
// ============================================================

function parseDisplayLists(data) {
    data = _ensureBuffer(data);
    const result = {
        vertices: [],
        faces: [],
        faceVertexCounts: [],
        hasVertexData: false
    };

    if (!data || data.length < 100) return result;

    const isModern = data.length > 20000 &&
                     data.readUInt32LE(0) === 1 && data.readUInt32LE(4) === 1;

    if (isModern) {
        const modernResult = _extractModernSurfaces(data);
        if (modernResult.vertices.length > 0) return modernResult;
    }

    return _extractOldFormat(data);
}

function _extractModernSurfaces(data) {
    data = _ensureBuffer(data);
    const result = {
        vertices: [],
        faces: [],
        faceVertexCounts: [],
        hasVertexData: false
    };

    // BUGFIX: Expanded bounds to support large parts (buildings, aerospace parts)
    // Old: MIN_C = 0.0005, MAX_C = 1.0 rejected parts > 1 meter
    // New: supports from 0.1mm to 100 kilometers (effectively unbounded)
    const MIN_C = 0.0001;
    const MAX_C = 100000.0;

    function looksLikeVertex(x, y, z) {
        if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return false;
        const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
        if (ax > MAX_C || ay > MAX_C || az > MAX_C) return false;
        return (ax >= MIN_C ? 1 : 0) + (ay >= MIN_C ? 1 : 0) + (az >= MIN_C ? 1 : 0) >= 2;
    }

    function tryReadSurface(pos) {
        if (pos + 8 > data.length) return null;

        const faceCount = data.readUInt32LE(pos);
        if (faceCount < 1 || faceCount > 100) return null;

        for (let tryOff = 4; tryOff < 200; tryOff += 4) {
            const countStart = pos + tryOff;
            if (countStart + faceCount * 4 > data.length) break;

            const counts = [];
            let ok = true;
            for (let i = 0; i < faceCount; i++) {
                const v = data.readUInt32LE(countStart + i * 4);
                if (v < 2 || v > 500) { ok = false; break; }
                counts.push(v);
            }
            if (!ok) continue;

            const totalVerts = counts.reduce((a, b) => a + b, 0);
            if (totalVerts < 3 || totalVerts > 5000) continue;

            const afterCounts = countStart + faceCount * 4;
            let vertStart = -1;

            for (let vp = afterCounts; vp < afterCounts + 500 && vp + 12 <= data.length; vp += 4) {
                const x = data.readFloatLE(vp);
                const y = data.readFloatLE(vp + 4);
                const z = data.readFloatLE(vp + 8);
                if (looksLikeVertex(x, y, z)) {
                    if (vp + 24 <= data.length) {
                        const x2 = data.readFloatLE(vp + 12);
                        const y2 = data.readFloatLE(vp + 16);
                        const z2 = data.readFloatLE(vp + 20);
                        if (looksLikeVertex(x2, y2, z2)) {
                            vertStart = vp;
                            break;
                        }
                    }
                }
            }

            if (vertStart < 0) continue;

            const verts = [];
            let p = vertStart;
            while (p + 12 <= data.length && verts.length < totalVerts) {
                const x = data.readFloatLE(p);
                const y = data.readFloatLE(p + 4);
                const z = data.readFloatLE(p + 8);
                if (!isFinite(x) || !isFinite(y) || !isFinite(z)) break;
                if (Math.abs(x) > MAX_C || Math.abs(y) > MAX_C || Math.abs(z) > MAX_C) break;
                if (Math.abs(x) < MIN_C && Math.abs(y) < MIN_C && Math.abs(z) < MIN_C) break;
                verts.push([x, y, z]);
                p += 12;
            }

            if (verts.length < Math.floor(totalVerts * 0.7)) continue;

            return {
                offset: pos,
                vertOffset: vertStart,
                counts,
                totalVerts,
                verts,
            };
        }
        return null;
    }

    const surfaces = [];
    let scanPos = 96;

    while (scanPos + 20 <= data.length) {
        const surf = tryReadSurface(scanPos);
        if (surf) {
            surfaces.push(surf);
            scanPos = surf.vertOffset + surf.verts.length * 12;
        } else {
            scanPos += 4;
        }
    }

    if (surfaces.length === 0) return result;

    let vertexOffset = 0;
    for (const surf of surfaces) {
        for (const v of surf.verts) {
            result.vertices.push(v);
        }
        let fi = 0;
        for (const count of surf.counts) {
            const faceIndices = [];
            for (let j = 0; j < count; j++) {
                faceIndices.push(vertexOffset + fi + j);
            }
            result.faces.push(faceIndices);
            fi += count;
        }
        vertexOffset += surf.verts.length;
    }

    result.hasVertexData = true;
    return result;
}

function _extractOldFormat(data) {
    data = _ensureBuffer(data);
    const result = {
        vertices: [],
        faces: [],
        faceVertexCounts: [],
        hasVertexData: false
    };

    let lastClassRecordEnd = 0;
    for (let i = 0; i < data.length - 6; i++) {
        if (data[i] === 0xFF && data[i + 1] === 0xFF) {
            lastClassRecordEnd = i;
        }
    }

    const candidates = [];
    const SEARCH_RADIUS = 1000;

    for (let align = 0; align < 4; align++) {
        for (let i = Math.max(0, lastClassRecordEnd - 100) + align; i < Math.min(data.length - 200, lastClassRecordEnd + SEARCH_RADIUS); i += 4) {
            const fc = data.readUInt32LE(i);
            if (fc < 2 || fc > 100) continue;

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

            const totalVerts = counts.reduce((a, b) => a + b, 0);
            const expectedBytes = totalVerts * 12;

            if (i + 4 + fc * 4 + expectedBytes > data.length) continue;

            candidates.push({ offset: i, fc, counts, totalVerts });
        }
    }

    if (candidates.length === 0) return result;

    const seen = new Set();
    const uniqueCandidates = [];
    for (const c of candidates) {
        if (!seen.has(c.offset)) {
            seen.add(c.offset);
            uniqueCandidates.push(c);
        }
    }

    function scoreCandidate(off, nv) {
        const xs = [], ys = [], zs = [];
        let garbageCount = 0;
        let allSame = true;
        let firstX = null, firstY = null, firstZ = null;

        for (let v = 0; v < nv; v++) {
            const p = off + v * 12;
            if (p + 12 > data.length) return -1;
            const x = data.readFloatLE(p);
            const y = data.readFloatLE(p + 4);
            const z = data.readFloatLE(p + 8);
            if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return -1;
            if (Math.abs(x) > 100000 || Math.abs(y) > 100000 || Math.abs(z) > 100000) { garbageCount++; continue; }
            xs.push(x); ys.push(y); zs.push(z);
            if (firstX === null) { firstX = x; firstY = y; firstZ = z; }
            else if (Math.abs(x - firstX) > 0.0001 || Math.abs(y - firstY) > 0.0001 || Math.abs(z - firstZ) > 0.0001) allSame = false;
        }

        if (garbageCount > 2) return -1;
        if (allSame) return -1;

        const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
        const stddev = arr => { const m = mean(arr); return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, arr.length - 1)); };
        const sx = stddev(xs), sy = stddev(ys), sz = stddev(zs);
        const maxStd = Math.max(sx, sy, sz, 0.0001);
        const balance = (sx + sy + sz) / maxStd;

        return balance * Math.sqrt(nv);
    }

    uniqueCandidates.sort((a, b) => b.totalVerts - a.totalVerts);

    let bestCandidate = null;
    let bestVertexOffset = -1;

    for (const cand of uniqueCandidates) {
        const headerEnd = cand.offset + 4 + cand.fc * 4;
        const nv = cand.totalVerts;
        const expectedBytes = nv * 12;
        if (headerEnd + expectedBytes > data.length) continue;

        let bestAlignScore = -1;
        let bestAlignOffset = -1;

        for (let align = 0; align < 4; align++) {
            for (let off = headerEnd + align; off <= Math.min(data.length - expectedBytes, headerEnd + 5000); off += 4) {
                const s = scoreCandidate(off, nv);
                if (s > bestAlignScore) {
                    bestAlignScore = s;
                    bestAlignOffset = off;
                }
            }
        }

        if (bestAlignOffset !== -1 && bestAlignScore > 0) {
            bestCandidate = cand;
            bestVertexOffset = bestAlignOffset;
            break;
        }
    }

    if (bestCandidate === null || bestVertexOffset === -1) return result;

    const faceVertexCounts = bestCandidate.counts;
    const totalVertices = bestCandidate.totalVerts;
    const vertexDataOffset = bestVertexOffset;

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

function extractMesh(buf) {
    if (buf instanceof ArrayBuffer) {
        buf = new Uint8Array(buf);
    }
    buf = _ensureBuffer(buf);

    const result = {
        vertices: [],
        faces: [],
        faceVertexCounts: [],
        partDimensions: null,
        warnings: [],
        errors: []
    };

    const isOLE2 = buf[0] === 0xD0 && buf[1] === 0xCF && buf[2] === 0x11 && buf[3] === 0xE0;
    const isModern = !isOLE2 && buf.length > 2000 && buf[7] === 4;

    if (isModern) {
        result.warnings.push('Detected modern SW 2015+ format (openswx)');
        _log('Modern openswx format detected');
    } else if (isOLE2) {
        result.warnings.push('Detected old OLE2 format');
        _log('Legacy OLE2 format detected');
    } else {
        result.warnings.push('Unknown format, attempting extraction...');
        _log('Unknown format - attempting both parsers');
    }

    const dlData = findDisplayLists(buf);
    if (!dlData) {
        result.errors.push('Failed to extract DisplayLists from SLDPRT file');
        return result;
    }

    result.warnings.push(`DisplayLists: ${dlData.length} bytes`);

    const mesh = parseDisplayLists(dlData);

    if (!mesh.hasVertexData || mesh.vertices.length === 0) {
        result.warnings.push('No vertex data found in DisplayLists stream');
        return result;
    }

    result.vertices = mesh.vertices;
    result.faces = mesh.faces;
    result.faceVertexCounts = mesh.faceVertexCounts;

    // Filter degenerate faces
    result.faces = result.faces.filter(face => {
        if (face.length < 3) return false;
        for (const idx of face) {
            if (idx >= result.vertices.length) return false;
            const v = result.vertices[idx];
            if (!v || !isFinite(v[0]) || !isFinite(v[1]) || !isFinite(v[2])) return false;
        }
        const v0 = result.vertices[face[0]], v1 = result.vertices[face[1]], v2 = result.vertices[face[2]];
        const ax = v1[0] - v0[0], ay = v1[1] - v0[1], az = v1[2] - v0[2];
        const bx = v2[0] - v0[0], by = v2[1] - v0[1], bz = v2[2] - v0[2];
        const crossLen = Math.sqrt((ay * bz - az * by) ** 2 + (az * bx - ax * bz) ** 2 + (ax * by - ay * bx) ** 2);
        return crossLen > 1e-12;
    });

    result.warnings.push(`Extracted: ${result.vertices.length} vertices, ${result.faces.length} faces`);

    // Calculate part dimensions
    if (result.vertices.length > 0) {
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;

        for (const [x, y, z] of result.vertices) {
            if (!isFinite(x) || !isFinite(y) || !isFinite(z)) continue;
            if (Math.abs(x) > 100000 || Math.abs(y) > 100000 || Math.abs(z) > 100000) continue;
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
            minZ = Math.min(minZ, z);
            maxZ = Math.max(maxZ, z);
        }

        if (isFinite(minX)) {
            result.partDimensions = {
                x: { min: minX, max: maxX, size: maxX - minX },
                y: { min: minY, max: maxY, size: maxY - minY },
                z: { min: minZ, max: maxZ, size: maxZ - minZ }
            };
        }
    }

    return result;
}

// ============================================================
// Output Generators
// ============================================================

function toOBJ(mesh) {
    let obj = '# SLDPRT mesh extracted by sldprt-extractor\n';
    obj += `# ${mesh.vertices.length} vertices, ${mesh.faces.length} faces\n\n`;

    for (const [x, y, z] of mesh.vertices) {
        obj += `v ${(x || 0).toFixed(6)} ${(y || 0).toFixed(6)} ${(z || 0).toFixed(6)}\n`;
    }

    obj += '\n';

    for (const face of mesh.faces) {
        if (face.length === 3) {
            obj += `f ${face[0] + 1} ${face[1] + 1} ${face[2] + 1}\n`;
        } else if (face.length > 3) {
            for (let i = 1; i < face.length - 1; i++) {
                obj += `f ${face[0] + 1} ${face[i] + 1} ${face[i + 1] + 1}\n`;
            }
        }
    }

    return obj;
}

function toSTL(mesh) {
    let stl = 'solid sldprt_extracted\n';

    for (const face of mesh.faces) {
        if (face.length < 3) continue;

        for (let i = 1; i < face.length - 1; i++) {
            const v0 = mesh.vertices[face[0]];
            const v1 = mesh.vertices[face[i]];
            const v2 = mesh.vertices[face[i + 1]];

            if (!v0 || !v1 || !v2) continue;

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

    stl += 'endsolid sldprt_extracted\n';
    return stl;
}

function toBinarySTL(mesh) {
    let triCount = 0;
    for (const face of mesh.faces) {
        if (face.length >= 3) triCount += face.length - 2;
    }

    const totalBytes = 84 + triCount * 50;
    let buf;
    if (typeof Buffer !== 'undefined') {
        buf = Buffer.alloc(totalBytes);
    } else {
        buf = new Uint8Array(totalBytes);
    }
    const header = 'SLDPRT extracted by sldprt-extractor';
    for (let i = 0; i < Math.min(header.length, 80); i++) buf[i] = header.charCodeAt(i);
    if (typeof DataView !== 'undefined') {
        const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        dv.setUint32(80, triCount, true);
    } else {
        buf[80] = triCount & 0xFF; buf[81] = (triCount >> 8) & 0xFF;
        buf[82] = (triCount >> 16) & 0xFF; buf[83] = (triCount >> 24) & 0xFF;
    }

    let offset = 84;
    const writeFloat = (v, off) => {
        const f32 = new Float32Array([v]);
        const bytes = new Uint8Array(f32.buffer);
        buf[off] = bytes[0]; buf[off+1] = bytes[1]; buf[off+2] = bytes[2]; buf[off+3] = bytes[3];
    };
    const writeU16 = (v, off) => { buf[off] = v & 0xFF; buf[off+1] = (v >> 8) & 0xFF; };

    for (const face of mesh.faces) {
        if (face.length < 3) continue;

        for (let i = 1; i < face.length - 1; i++) {
            const v0 = mesh.vertices[face[0]];
            const v1 = mesh.vertices[face[i]];
            const v2 = mesh.vertices[face[i + 1]];

            if (!v0 || !v1 || !v2) continue;

            const ax = v1[0] - v0[0], ay = v1[1] - v0[1], az = v1[2] - v0[2];
            const bx = v2[0] - v0[0], by = v2[1] - v0[1], bz = v2[2] - v0[2];
            const nx = ay * bz - az * by;
            const ny = az * bx - ax * bz;
            const nz = ax * by - ay * bx;
            const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;

            writeFloat(nx / len, offset); offset += 4;
            writeFloat(ny / len, offset); offset += 4;
            writeFloat(nz / len, offset); offset += 4;

            writeFloat(v0[0], offset); offset += 4;
            writeFloat(v0[1], offset); offset += 4;
            writeFloat(v0[2], offset); offset += 4;

            writeFloat(v1[0], offset); offset += 4;
            writeFloat(v1[1], offset); offset += 4;
            writeFloat(v1[2], offset); offset += 4;

            writeFloat(v2[0], offset); offset += 4;
            writeFloat(v2[1], offset); offset += 4;
            writeFloat(v2[2], offset); offset += 4;

            writeU16(0, offset); offset += 2;
        }
    }

    return buf;
}

// ============================================================
// Exports
// ============================================================

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { extractMesh, toOBJ, toSTL, toBinarySTL, parseOLE2, setVerbose };
}

if (typeof window !== 'undefined') {
    window.sldprtExtractor = { extractMesh, toOBJ, toSTL, toBinarySTL, parseOLE2, setVerbose };
}
