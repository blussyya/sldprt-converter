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
    const zlib = require('zlib');
    return {
        inflateRaw: (buf) => zlib.inflateRawSync(Buffer.from(buf)),
        inflate: (buf) => zlib.inflateSync(Buffer.from(buf)),
        brotli: (buf) => zlib.brotliDecompressSync(Buffer.from(buf))
    };
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

let _earcut = null;
try { const m = require('earcut'); _earcut = m.default || m; } catch (e) {}

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
            const dlData = readStream(buf, ole.fat, dlEntry, ole.ss, ole);
            if (dlData && dlData.length > 100) return dlData;
        }

        dlEntry = ole.entries.find(e => e.name === 'DisplayLists__Zip' && e.type === 2);
        if (dlEntry) {
            const dlData = readStream(buf, ole.fat, dlEntry, ole.ss, ole);
            if (dlData && dlData.length > 10) {
                // Try multiple decompression methods
                const methods = [];
                if (_inflate.brotli) methods.push({ name: 'brotli', fn: _inflate.brotli });
                if (_inflate.inflateRaw) methods.push({ name: 'inflateRaw', fn: _inflate.inflateRaw });
                if (_inflate.inflate) methods.push({ name: 'inflate', fn: _inflate.inflate });

                // Try with header skip variations
                for (const skip of [14, 4, 0]) {
                    for (const m of methods) {
                        try {
                            const input = skip > 0 ? dlData.subarray(skip) : dlData;
                            const decompressed = m.fn(input);
                            if (decompressed && decompressed.length > 100) {
                                _log(`DisplayLists__Zip decompressed via ${m.name} (skip=${skip}): ${decompressed.length} bytes`);
                                return decompressed;
                            }
                        } catch (e) {
                            // try next
                        }
                    }
                }
                _log('All decompression methods failed for DisplayLists__Zip');
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

function _splitMixedFaceByNormals(verts, gapNormals) {
    if (!verts || !gapNormals || verts.length !== gapNormals.length || verts.length < 6) return null;

    const dot = (a, b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
    const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
    const vlen = v => Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]);
    const vnorm = v => { const l=vlen(v); return l>1e-12?[v[0]/l,v[1]/l,v[2]/l]:[0,0,0]; };

    const n = verts.length;

    // Use threshold 0.5 — tight enough for planes, loose enough for cylinders
    const NORMAL_THRESHOLD = 0.5;
    const visited = new Uint8Array(n);
    const groups = [];

    for (let i = 0; i < n; i++) {
        if (visited[i]) continue;
        const group = [i];
        visited[i] = 1;
        const ni = gapNormals[i];

        for (let j = i + 1; j < n; j++) {
            if (visited[j]) continue;
            const nj = gapNormals[j];
            const d = Math.abs(dot(ni, nj));
            if (d > (1.0 - NORMAL_THRESHOLD)) {
                group.push(j);
                visited[j] = 1;
            }
        }

        if (group.length >= 3) {
            groups.push(group);
        }
    }

    // Need at least 2 meaningful groups to justify splitting
    if (groups.length < 2) return null;

    // Don't split if the largest group is > 90% of vertices (not enough splitting)
    const maxSize = Math.max(...groups.map(g => g.length));
    if (maxSize > n * 0.9) return null;

    // Don't split if any group is too small (< 3% of total vertices)
    const minGroupSize = Math.max(3, Math.floor(n * 0.03));
    const bigGroups = groups.filter(g => g.length >= minGroupSize);
    if (bigGroups.length < 2) return null;

    return bigGroups;
}

function _extractModernSurfaces(data) {
    data = _ensureBuffer(data);
    const result = {
        vertices: [],
        faces: [],
        faceVertexCounts: [],
        hasVertexData: false
    };

    const MAX_C = 100000.0;
    const MARKER = new Uint8Array([0x0c, 0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00]);
    const markerPositions = _findAll(data, MARKER);

    const allVerts = [];
    const allFaces = [];

    for (const mp of markerPositions) {
        if (mp < 4) continue;
        const edgeCount = data.readUInt32LE(mp - 4);
        if (edgeCount < 1 || edgeCount > 500) continue;
        const faceType = data.readUInt32LE(mp + 8);
        if (faceType !== 2) continue;
        const vertexCount = data.readUInt32LE(mp + 12);
        if (vertexCount < 3 || vertexCount > 5000) continue;

        const vertStart = mp + 16;
        if (vertStart + vertexCount * 12 > data.length) continue;

        let valid = true;
        const verts = [];
        for (let i = 0; i < vertexCount; i++) {
            const off = vertStart + i * 12;
            const x = data.readFloatLE(off);
            const y = data.readFloatLE(off + 4);
            const z = data.readFloatLE(off + 8);
            if (!isFinite(x) || !isFinite(y) || !isFinite(z)) { valid = false; break; }
            if (Math.abs(x) > MAX_C || Math.abs(y) > MAX_C || Math.abs(z) > MAX_C) { valid = false; break; }
            verts.push([x, y, z]);
        }
        if (!valid) continue;

        const baseIdx = allVerts.length;
        allVerts.push(...verts);

        if (vertexCount >= 20) {
            const vertEnd = vertStart + vertexCount * 12;
            let gapNormals = null;

            if (vertEnd + 16 + vertexCount * 12 <= data.length) {
                const normalStart = vertEnd + 16;
                gapNormals = [];
                let normalsValid = true;
                for (let i = 0; i < vertexCount; i++) {
                    const off = normalStart + i * 12;
                    const nx = data.readFloatLE(off);
                    const ny = data.readFloatLE(off + 4);
                    const nz = data.readFloatLE(off + 8);
                    if (!isFinite(nx) || !isFinite(ny) || !isFinite(nz)) { normalsValid = false; break; }
                    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
                    if (len < 0.8 || len > 1.2) { normalsValid = false; break; }
                    gapNormals.push([nx / len, ny / len, nz / len]);
                }
                if (!normalsValid || gapNormals.length !== vertexCount) {
                    gapNormals = null;
                }
            }

            if (gapNormals) {
                // Pre-check: only split if normals actually vary significantly
                // Compute average normal and max deviation
                const avgN = [0, 0, 0];
                for (const gn of gapNormals) { avgN[0] += gn[0]; avgN[1] += gn[1]; avgN[2] += gn[2]; }
                avgN[0] /= vertexCount; avgN[1] /= vertexCount; avgN[2] /= vertexCount;
                const avgLen = Math.sqrt(avgN[0]*avgN[0]+avgN[1]*avgN[1]+avgN[2]*avgN[2]);
                if (avgLen > 1e-12) { avgN[0] /= avgLen; avgN[1] /= avgLen; avgN[2] /= avgLen; }

                let maxDev = 0;
                for (const gn of gapNormals) {
                    const d = Math.abs(avgN[0]*gn[0]+avgN[1]*gn[1]+avgN[2]*gn[2]);
                    const dev = 1.0 - d;
                    if (dev > maxDev) maxDev = dev;
                }

                // Only split if max deviation > 0.5 (normals vary by > ~30 degrees)
                if (maxDev > 0.5) {
                    const subFaces = _splitMixedFaceByNormals(verts, gapNormals);
                    if (subFaces) {
                        for (const sub of subFaces) {
                            allFaces.push(sub.map(i => baseIdx + i));
                        }
                        continue;
                    }
                }
            }
        }

        const faceVerts = [];
        for (let i = 0; i < vertexCount; i++) {
            faceVerts.push(baseIdx + i);
        }
        allFaces.push(faceVerts);
    }

    if (allVerts.length === 0) return result;

    result.vertices = allVerts;
    result.faces = allFaces;
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

    // Remove clearly garbage vertices (extreme outliers from false-positive face records)
    if (result.vertices.length > 3) {
        const goodIndices = [];
        const oldToNew = new Map();
        for (let i = 0; i < result.vertices.length; i++) {
            const v = result.vertices[i];
            const ax = Math.abs(v[0]), ay = Math.abs(v[1]), az = Math.abs(v[2]);
            if (ax > 10000 || ay > 10000 || az > 10000) continue;
            oldToNew.set(i, goodIndices.length);
            goodIndices.push(v);
        }
        if (goodIndices.length >= 3 && goodIndices.length < result.vertices.length) {
            result.warnings.push(`Removed ${result.vertices.length - goodIndices.length} garbage vertices`);
            result.vertices = goodIndices;
            const newFaces = [];
            for (const face of result.faces) {
                const nf = [];
                for (const idx of face) {
                    if (oldToNew.has(idx)) nf.push(oldToNew.get(idx));
                }
                if (nf.length >= 3) newFaces.push(nf);
            }
            result.faces = newFaces;
        }
    }

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
// Hybrid triangulation: strip for CYL/CON, boundary reconstruction for PLANE
// ============================================================

const _sub3 = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const _dot3 = (a, b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const _crs3 = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const _vlen3 = v => Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]);
const _vnorm3 = v => { const l=_vlen3(v); return l>1e-12?[v[0]/l,v[1]/l,v[2]/l]:[0,0,0]; };
const _edgeKey = (a, b) => a < b ? a + '|' + b : b + '|' + a;
const _DEDUP_TOL = 0.001;

let _planeCount = 0, _stripCount = 0;
function _triangulateFace(face, vertices, surfaceInfo) {
    if (face.length < 3) return [];
    if (face.length === 3) return [face];
    if (surfaceInfo && surfaceInfo.type === 'PLANE') { _planeCount++; return _processPlaneFace(face, vertices, surfaceInfo); }
    _stripCount++;
    return _processStripFace(face, vertices);
}

function _processStripFace(face, vertices) {
    const n = face.length;
    const tris = [];
    for (let i = 0; i < n - 2; i++) {
        const i0 = face[i], i1 = face[i+1], i2 = face[i+2];
        if (i0 === i1 || i1 === i2 || i0 === i2) continue;
        const v0 = vertices[i0], v1 = vertices[i1], v2 = vertices[i2];
        if (!v0 || !v1 || !v2) continue;
        const d01 = (v0[0]-v1[0])**2+(v0[1]-v1[1])**2+(v0[2]-v1[2])**2;
        const d12 = (v1[0]-v2[0])**2+(v1[1]-v2[1])**2+(v1[2]-v2[2])**2;
        const d02 = (v0[0]-v2[0])**2+(v0[1]-v2[1])**2+(v0[2]-v2[2])**2;
        if (d01 < 1e-24 || d12 < 1e-24 || d02 < 1e-24) continue;
        if (i & 1) tris.push([i1, i0, i2]);
        else tris.push([i0, i1, i2]);
    }
    return tris;
}

function _processPlaneFace(face, vertices, surfaceInfo) {
    const n = face.length;
    const pts3d = face.map(i => vertices[i]);

    const normal = surfaceInfo.params && surfaceInfo.params.normal
        ? surfaceInfo.params.normal
        : _vnorm3(_crs3(_sub3(pts3d[1], pts3d[0]), _sub3(pts3d[Math.min(2, n-1)], pts3d[0])));

    const u = Math.abs(normal[0]) < Math.abs(normal[1])
        ? _vnorm3(_crs3(normal, [1,0,0]))
        : _vnorm3(_crs3(normal, [0,1,0]));
    const w = _crs3(normal, u);

    const unique = [];
    const origToUnique = new Array(n);
    for (let i = 0; i < n; i++) {
        let found = -1;
        for (let k = 0; k < unique.length; k++) {
            const dx = pts3d[i][0]-pts3d[unique[k]][0];
            const dy = pts3d[i][1]-pts3d[unique[k]][1];
            const dz = pts3d[i][2]-pts3d[unique[k]][2];
            if (dx*dx+dy*dy+dz*dz < _DEDUP_TOL*_DEDUP_TOL) { found = k; break; }
        }
        if (found >= 0) {
            origToUnique[i] = found;
        } else {
            origToUnique[i] = unique.length;
            unique.push(i);
        }
    }

    if (unique.length < 3) return _processStripFace(face, vertices);

    const proj = [];
    for (const idx of unique) {
        proj.push(_dot3(pts3d[idx], u), _dot3(pts3d[idx], w));
    }

    function _convexHull2D(pts, n) {
        if (n < 3) return [];
        let pivot = 0;
        for (let i = 1; i < n; i++) {
            if (pts[i*2+1] < pts[pivot*2+1] || (pts[i*2+1] === pts[pivot*2+1] && pts[i*2] < pts[pivot*2])) pivot = i;
        }
        const hull = [];
        let cur = pivot;
        do {
            hull.push(cur);
            let nxt = (cur + 1) % n;
            for (let i = 0; i < n; i++) {
                const cross = (pts[nxt*2]-pts[cur*2])*(pts[i*2+1]-pts[cur*2+1]) - (pts[nxt*2+1]-pts[cur*2+1])*(pts[i*2]-pts[cur*2]);
                if (cross < 0 || (cross === 0 && ((pts[i*2]-pts[cur*2])**2+(pts[i*2+1]-pts[cur*2+1])**2) > ((pts[nxt*2]-pts[cur*2])**2+(pts[nxt*2+1]-pts[cur*2+1])**2))) nxt = i;
            }
            cur = nxt;
        } while (cur !== pivot);
        return hull;
    }

    const hullIdx = _convexHull2D(proj, unique.length);
    if (hullIdx.length < 3) return _processStripFace(face, vertices);

    const hullSet = new Set(hullIdx);
    const interior = [];
    for (let k = 0; k < unique.length; k++) {
        if (!hullSet.has(k)) interior.push(k);
    }

    const used = new Set();
    const holeClusters = [];
    for (const k of interior) {
        if (used.has(k)) continue;
        const cluster = [k];
        used.add(k);
        const p = pts3d[unique[k]];
        for (const k2 of interior) {
            if (used.has(k2)) continue;
            const q = pts3d[unique[k2]];
            const d = Math.sqrt((p[0]-q[0])**2+(p[1]-q[1])**2+(p[2]-q[2])**2);
            if (d < 0.015) { cluster.push(k2); used.add(k2); }
        }
        if (cluster.length >= 3) holeClusters.push(cluster);
    }

    const mergedVerts = [];
    const indexMap = [];
    for (const k of hullIdx) {
        mergedVerts.push(proj[k*2], proj[k*2+1]);
        indexMap.push(k);
    }
    const earcutHoles = [];
    for (const cluster of holeClusters) {
        let cx = 0, cy = 0;
        for (const k of cluster) { cx += proj[k*2]; cy += proj[k*2+1]; }
        cx /= cluster.length; cy /= cluster.length;
        cluster.sort((a, b) => Math.atan2(proj[a*2+1]-cy, proj[a*2]-cx) - Math.atan2(proj[b*2+1]-cy, proj[b*2]-cx));
        earcutHoles.push(mergedVerts.length / 2);
        for (const k of cluster) {
            mergedVerts.push(proj[k*2], proj[k*2+1]);
            indexMap.push(k);
        }
    }

    const triIndices = _earcut(mergedVerts, earcutHoles.length > 0 ? earcutHoles : undefined, 2);
    if (!triIndices || triIndices.length < 3) return _processStripFace(face, vertices);

    const tris = [];
    for (let i = 0; i < triIndices.length; i += 3) {
        const a = face[indexMap[triIndices[i]]];
        const b = face[indexMap[triIndices[i+1]]];
        const c = face[indexMap[triIndices[i+2]]];
        if (a !== undefined && b !== undefined && c !== undefined) tris.push([a, b, c]);
    }
    return tris;
}

function _computeFaceNormal(face, vertices, surfaceInfo) {
    if (surfaceInfo && surfaceInfo.params && surfaceInfo.params.normal) return surfaceInfo.params.normal;
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < face.length; i++) {
        const j = (i + 1) % face.length;
        const a = vertices[face[i]], b = vertices[face[j]];
        nx += a[1]*b[2]-a[2]*b[1]; ny += a[2]*b[0]-a[0]*b[2]; nz += a[0]*b[1]-a[1]*b[0];
    }
    const l = Math.sqrt(nx*nx+ny*ny+nz*nz) || 1;
    return [nx/l, ny/l, nz/l];
}

// ============================================================
// Output Generators
// ============================================================

function toOBJ(mesh) {
    let obj = '# SLDPRT mesh extracted by sldprt-extractor\n';
    obj += `# ${mesh.vertices.length} vertices, ${mesh.faces.length} faces\n\n`;
    for (const [x, y, z] of mesh.vertices) {
        obj += `v ${(x||0).toFixed(6)} ${(y||0).toFixed(6)} ${(z||0).toFixed(6)}\n`;
    }
    obj += '\n';
    for (let fi = 0; fi < mesh.faces.length; fi++) {
        const face = mesh.faces[fi];
        if (face.length < 3) continue;
        const si = mesh._surfaceInfo ? mesh._surfaceInfo.get(fi) : undefined;
        for (const tri of _triangulateFace(face, mesh.vertices, si)) {
            obj += `f ${tri[0]+1} ${tri[1]+1} ${tri[2]+1}\n`;
        }
    }
    return obj;
}

function toSTL(mesh) {
    let stl = 'solid sldprt_extracted\n';
    for (let fi = 0; fi < mesh.faces.length; fi++) {
        const face = mesh.faces[fi];
        if (face.length < 3) continue;
        const si = mesh._surfaceInfo ? mesh._surfaceInfo.get(fi) : undefined;
        for (const tri of _triangulateFace(face, mesh.vertices, si)) {
            const v0 = mesh.vertices[tri[0]], v1 = mesh.vertices[tri[1]], v2 = mesh.vertices[tri[2]];
            if (!v0||!v1||!v2) continue;
            const nx=(v1[1]-v0[1])*(v2[2]-v0[2])-(v1[2]-v0[2])*(v2[1]-v0[1]);
            const ny=(v1[2]-v0[2])*(v2[0]-v0[0])-(v1[0]-v0[0])*(v2[2]-v0[2]);
            const nz=(v1[0]-v0[0])*(v2[1]-v0[1])-(v1[1]-v0[1])*(v2[0]-v0[0]);
            const l=Math.sqrt(nx*nx+ny*ny+nz*nz)||1;
            stl+=`  facet normal ${(nx/l).toFixed(6)} ${(ny/l).toFixed(6)} ${(nz/l).toFixed(6)}\n    outer loop\n`;
            stl+=`      vertex ${v0[0].toFixed(6)} ${v0[1].toFixed(6)} ${v0[2].toFixed(6)}\n`;
            stl+=`      vertex ${v1[0].toFixed(6)} ${v1[1].toFixed(6)} ${v1[2].toFixed(6)}\n`;
            stl+=`      vertex ${v2[0].toFixed(6)} ${v2[1].toFixed(6)} ${v2[2].toFixed(6)}\n`;
            stl+='    endloop\n  endfacet\n';
        }
    }
    stl += 'endsolid sldprt_extracted\n';
    return stl;
}

function _ensureCCW(v0, v1, v2, faceNormal) {
    const ax=v1[0]-v0[0],ay=v1[1]-v0[1],az=v1[2]-v0[2];
    const bx=v2[0]-v0[0],by=v2[1]-v0[1],bz=v2[2]-v0[2];
    const nx=ay*bz-az*by,ny=az*bx-ax*bz,nz=ax*by-ay*bx;
    if (faceNormal && nx*faceNormal[0]+ny*faceNormal[1]+nz*faceNormal[2] < 0) return [v0,v2,v1];
    return [v0,v1,v2];
}

function toBinarySTL(mesh) {
    _planeCount = 0; _stripCount = 0;
    let triCount = 0;
    for (let fi = 0; fi < mesh.faces.length; fi++) {
        const face = mesh.faces[fi];
        if (face.length < 3) continue;
        const si = mesh._surfaceInfo ? mesh._surfaceInfo.get(fi) : undefined;
        triCount += _triangulateFace(face, mesh.vertices, si).length;
    }

    if (typeof process !== 'undefined') process.stderr.write(`  Triangulation: ${_planeCount} PLANE (hull+holes), ${_stripCount} CYL/CON/other (strip)\n`);

    const totalBytes = 84 + triCount * 50;
    const buf = typeof Buffer !== 'undefined' ? Buffer.alloc(totalBytes) : new Uint8Array(totalBytes);
    const header = 'SLDPRT extracted by sldprt-extractor';
    for (let i = 0; i < Math.min(header.length, 80); i++) buf[i] = header.charCodeAt(i);
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    dv.setUint32(80, triCount, true);

    let offset = 84;
    const wf = (v, off) => { const b=new Uint8Array(new Float32Array([v]).buffer); buf[off]=b[0];buf[off+1]=b[1];buf[off+2]=b[2];buf[off+3]=b[3]; };
    const wu16 = (v, off) => { buf[off]=v&0xff;buf[off+1]=(v>>8)&0xff; };

    for (let fi = 0; fi < mesh.faces.length; fi++) {
        const face = mesh.faces[fi];
        if (face.length < 3) continue;
        const si = mesh._surfaceInfo ? mesh._surfaceInfo.get(fi) : undefined;
        const tris = _triangulateFace(face, mesh.vertices, si);
        const fn = _computeFaceNormal(face, mesh.vertices, si);

        for (const tri of tris) {
            let v0=mesh.vertices[tri[0]], v1=mesh.vertices[tri[1]], v2=mesh.vertices[tri[2]];
            if (!v0||!v1||!v2) continue;
            [v0,v1,v2] = _ensureCCW(v0,v1,v2,fn);
            const ax=v1[0]-v0[0],ay=v1[1]-v0[1],az=v1[2]-v0[2];
            const bx=v2[0]-v0[0],by=v2[1]-v0[1],bz=v2[2]-v0[2];
            const nx=ay*bz-az*by,ny=az*bx-ax*bz,nz=ax*by-ay*bx;
            const l=Math.sqrt(nx*nx+ny*ny+nz*nz)||1;
            wf(nx/l,offset);offset+=4;wf(ny/l,offset);offset+=4;wf(nz/l,offset);offset+=4;
            wf(v0[0],offset);offset+=4;wf(v0[1],offset);offset+=4;wf(v0[2],offset);offset+=4;
            wf(v1[0],offset);offset+=4;wf(v1[1],offset);offset+=4;wf(v1[2],offset);offset+=4;
            wf(v2[0],offset);offset+=4;wf(v2[1],offset);offset+=4;wf(v2[2],offset);offset+=4;
            wu16(0,offset);offset+=2;
        }
    }
    return buf;
}

function _getTriCounts() { return { plane: _planeCount, strip: _stripCount }; }

function setFaceSurface(mesh, faceIndex, surfaceType, surfaceParams) {
    if (!mesh._surfaceInfo) mesh._surfaceInfo = new Map();
    mesh._surfaceInfo.set(faceIndex, { type: surfaceType, params: surfaceParams });
}

// ============================================================
// STEP AP214 Faceted Export (POLY_LOOP)
// ============================================================

function toSTEP(mesh) {
    const S = 1000;
    const lines = [];
    let eid = 1;

    const ptKey = (x, y, z) => `${(x*S).toFixed(6)}|${(y*S).toFixed(6)}|${(z*S).toFixed(6)}`;
    const ptCache = new Map();
    const pt = (x, y, z) => {
        const k = ptKey(x, y, z);
        if (ptCache.has(k)) return ptCache.get(k);
        const id = eid++;
        lines.push(`#${id} = CARTESIAN_POINT('',(${(x*S).toFixed(6)},${(y*S).toFixed(6)},${(z*S).toFixed(6)}));`);
        ptCache.set(k, id);
        return id;
    };

    const advFaceIds = [];

    for (let fi = 0; fi < mesh.faces.length; fi++) {
        const face = mesh.faces[fi];
        if (face.length < 3) continue;
        const si = mesh._surfaceInfo ? mesh._surfaceInfo.get(fi) : undefined;
        const tris = _triangulateFace(face, mesh.vertices, si);

        const triVertIds = [];
        for (const tri of tris) {
            const v0 = mesh.vertices[tri[0]], v1 = mesh.vertices[tri[1]], v2 = mesh.vertices[tri[2]];
            if (!v0||!v1||!v2) continue;
            triVertIds.push([pt(v0[0],v0[1],v0[2]), pt(v1[0],v1[1],v1[2]), pt(v2[0],v2[1],v2[2])]);
        }
        if (triVertIds.length === 0) continue;

        const fobIds = [];
        for (const vids of triVertIds) {
            const pl = eid++;
            lines.push(`#${pl} = POLY_LOOP('',(#${vids[0]},#${vids[1]},#${vids[2]}));`);
            const fob = eid++;
            lines.push(`#${fob} = FACE_OUTER_BOUND('',#${pl},.T.);`);
            fobIds.push(fob);
        }

        const n = mesh.vertices[face[0]];
        const n2 = mesh.vertices[face[1]];
        const n3 = mesh.vertices[face[Math.min(2, face.length-1)]];
        const nx = (n2[1]-n[1])*(n3[2]-n[2])-(n2[2]-n[2])*(n3[1]-n[1]);
        const ny = (n2[2]-n[2])*(n3[0]-n[0])-(n2[0]-n[0])*(n3[2]-n[2]);
        const nz = (n2[0]-n[0])*(n3[1]-n[1])-(n2[1]-n[1])*(n3[0]-n[0]);
        const nl = Math.sqrt(nx*nx+ny*ny+nz*nz)||1;
        const nnx=nx/nl, nny=ny/nl, nnz=nz/nl;

        const cx = n[0], cy = n[1], cz = n[2];
        const cpid = pt(cx, cy, cz);
        const nid = eid++; lines.push(`#${nid} = DIRECTION('',(${nnx.toFixed(8)},${nny.toFixed(8)},${nnz.toFixed(8)}));`);
        const ux = Math.abs(nnx)<Math.abs(nny) ? [0,-nnz,nny] : [-nnz,0,nnx];
        const ul = Math.sqrt(ux[0]*ux[0]+ux[1]*ux[1]+ux[2]*ux[2])||1;
        const uid = eid++; lines.push(`#${uid} = DIRECTION('',(${(ux[0]/ul).toFixed(8)},${(ux[1]/ul).toFixed(8)},${(ux[2]/ul).toFixed(8)}));`);
        const ax2 = eid++; lines.push(`#${ax2} = AXIS2_PLACEMENT_3D('',#${cpid},#${nid},#${uid});`);

        const fb = fobIds.map(id=>`#${id}`).join(',');
        const af = eid++; lines.push(`#${af} = ADVANCED_FACE('',(${fb}),#${ax2},.T.);`);
        advFaceIds.push(af);
    }

    const sh = eid++; lines.push(`#${sh} = CLOSED_SHELL('',(${advFaceIds.map(id=>`#${id}`).join(',')}));`);
    const br = eid++; lines.push(`#${br} = MANIFOLD_SOLID_BREP('',#${sh});`);

    const hdr = [
        'ISO-10303-21;','HEADER;',
        `FILE_DESCRIPTION(('STEP AP214'),'2;1');`,
        `FILE_NAME('sldprt_export.stp','2026-01-01T00:00:00',('sldprt-converter'),(''),'sldprt-converter','');`,
        `FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));`,
        'ENDSEC;','DATA;'
    ];

    return hdr.join('\n')+'\n'+lines.join('\n')+'\nENDSEC;\nEND-ISO-10303-21;\n';
}

// ============================================================
// Exports
// ============================================================

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { extractMesh, toOBJ, toSTL, toBinarySTL, toSTEP, parseOLE2, setVerbose, setFaceSurface };
}

if (typeof window !== 'undefined') {
    window.sldprtExtractor = { extractMesh, toOBJ, toSTL, toBinarySTL, toSTEP, parseOLE2, setVerbose, setFaceSurface };
}
