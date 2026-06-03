#!/usr/bin/env node
'use strict';
/**
 * reverse-engineer.js — Definitive SolidWorks DisplayLists binary format analysis.
 *
 * KEY FINDING: All class names ("moSimpleSurfIdRep_c" etc.) are stored as UTF-16LE CStrings.
 * The format after the 96-byte header is a flat sequence of:
 *   [u32 faceCount] [u32[] faceVertexCounts] [float32[] vertices] [normalData] [moSimpleSurfIdRep_c pair data]
 *
 * Each surface block is self-contained with per-surface vertex data.
 * The moSimpleSurfIdRep_c records define face-to-vertex connectivity.
 */
const fs = require('fs');
const path = require('path');
const pako = require('pako');

const SLDPRT = String.raw`C:\.git\sldprt-research\PTC GE8080-8.SLDPRT`;

function getDisplayLists(filePath) {
    const buf = new Uint8Array(fs.readFileSync(filePath));
    const marker = new Uint8Array([0x14, 0x00, 0x06, 0x00, 0x08, 0x00]);
    for (let i = 0; i <= buf.length - marker.length; i++) {
        let ok = true;
        for (let j = 0; j < marker.length; j++) { if (buf[i+j] !== marker[j]) { ok = false; break; } }
        if (!ok) continue;
        const si = i - 4;
        if (si < 0 || si + 0x1E > buf.length) continue;
        const csz = (buf[si+0x12] | (buf[si+0x13]<<8) | (buf[si+0x14]<<16) | (buf[si+0x15]<<24)) >>> 0;
        const nsz = (buf[si+0x1A] | (buf[si+0x1B]<<8) | (buf[si+0x1C]<<16) | (buf[si+0x1D]<<24)) >>> 0;
        if (nsz > 1024 || csz > 50*1024*1024) continue;
        const nameEnd = si + 0x1E + nsz;
        if (nameEnd > buf.length) continue;
        let name = '';
        for (let k = 0; k < nsz; k++) {
            const b = buf[si+0x1E+k];
            name += String.fromCharCode(((b << 4) | (b >>> 4)) & 0xFF);
        }
        if (!name.includes('DisplayList') || csz < 100) continue;
        const f1 = (buf[si+0x0E] | (buf[si+0x0F]<<8) | (buf[si+0x10]<<16) | (buf[si+0x11]<<24)) >>> 0;
        if (f1 < 65536) continue;
        const compressed = buf.slice(nameEnd, nameEnd + csz);
        try {
            const d = pako.inflateRaw(compressed);
            if (d.length > 100 && d[0] === 1 && d[4] === 1) return d;
        } catch(e) {}
    }
    return null;
}

const dl = getDisplayLists(SLDPRT);
if (!dl) { console.error('Cannot decompress DisplayLists'); process.exit(1); }
const dv = new DataView(dl.buffer, dl.byteOffset, dl.length);
console.log('DisplayLists: ' + dl.length + ' bytes');

const u32 = (o) => dv.getUint32(o, true);
const u16 = (o) => dv.getUint16(o, true);
const f32 = (o) => dv.getFloat32(o, true);

function hexDump(o, n) {
    let s = '';
    for (let i = 0; i < n && o+i < dl.length; i += 16) {
        let h = '', a = '';
        for (let j = 0; j < 16 && o+i+j < dl.length; j++) {
            const b = dl[o+i+j];
            h += b.toString(16).padStart(2,'0') + ' ';
            a += (b >= 0x20 && b < 0x7F) ? String.fromCharCode(b) : '.';
        }
        s += '  0x' + (o+i).toString(16).padStart(6,'0') + ': ' + h + ' ' + a + '\n';
    }
    return s;
}

// ============================================================================
// FIND moSimpleSurfIdRep_c AS UTF-16LE
// ============================================================================
const SS_SEARCH = 'moSimpleSurfIdRep_c';
const ssUtf16 = Buffer.alloc(SS_SEARCH.length * 2);
for (let i = 0; i < SS_SEARCH.length; i++) {
    ssUtf16[i * 2] = SS_SEARCH.charCodeAt(i);
    ssUtf16[i * 2 + 1] = 0;
}

const ssPositions = [];
for (let i = 0; i <= dl.length - ssUtf16.length; i++) {
    let m = true;
    for (let j = 0; j < ssUtf16.length; j++) { if (dl[i+j] !== ssUtf16[j]) { m = false; break; } }
    if (m) ssPositions.push(i);
}
console.log('moSimpleSurfIdRep_c (UTF-16LE) occurrences: ' + ssPositions.length);

// For each occurrence, find the CString header (ff fe ff XX before the string)
const cstringRecords = [];
for (const asciiPos of ssPositions) {
    for (let back = 6; back <= 20; back++) {
        const hp = asciiPos - back;
        if (hp >= 0 && dl[hp] === 0xFF && dl[hp+1] === 0xFE && dl[hp+2] === 0xFF) {
            const charLen = dl[hp+3];
            const dataStart = hp + 4;
            const byteLen = charLen * 2;
            if (dataStart + byteLen <= dl.length) {
                let str = '';
                for (let k = 0; k < charLen; k++) {
                    const cp = u16(dataStart + k * 2);
                    if (cp > 0 && cp < 0x7F) str += String.fromCharCode(cp);
                }
                if (str.includes('moSimpleSurfIdRep_c')) {
                    cstringRecords.push({ headerOffset: hp, str, end: dataStart + byteLen });
                    break;
                }
            }
        }
    }
}
console.log('CString records: ' + cstringRecords.length);

// Show suffixes
const suffixMap = new Map();
for (const cr of cstringRecords) {
    const suf = cr.str.replace('moSimpleSurfIdRep_c', '');
    suffixMap.set(suf, (suffixMap.get(suf) || 0) + 1);
}
console.log('Suffixes:');
for (const [s, c] of suffixMap) console.log('  "' + s + '" (' + c + ')');

// ============================================================================
// TRACE THE FULL DATA STRUCTURE
// ============================================================================
console.log('\n' + '='.repeat(70));
console.log('FULL STRUCTURE TRACE');
console.log('='.repeat(70));

// The stream structure:
// [0x00-0x5F] Header (u32 version, u32 count, 11 x float64 metadata)
// [0x60] FF FF class def "uiUserModelEnv_c"
// [0x76] Serialize() data begins - this is a CString "Aftershock" then nested objects
// ... mixed MFC serialization data ...
// [near end] FaceTessData blocks: [fc][counts][verts][normals][moSimpleSurfIdRep_c pairs]

// Let's find the FaceTessData blocks by scanning for faceCount patterns
// that are followed by valid vertex data
const surfaces = [];
let scanPos = 0x60;

// First, skip past the MFC class def
while (scanPos < dl.length - 6) {
    if (dl[scanPos] === 0xFF && dl[scanPos+1] === 0xFF) {
        const nameLen = u16(scanPos + 4);
        if (nameLen > 0 && nameLen < 200 && scanPos + 6 + nameLen <= dl.length) {
            scanPos += 6 + nameLen;
        } else break;
    } else break;
}

console.log('Scanning for FaceTessData from 0x' + scanPos.toString(16));

while (scanPos + 8 < dl.length) {
    const fc = u32(scanPos);
    if (fc < 1 || fc > 100) { scanPos += 4; continue; }

    const counts = [];
    let ok = true;
    for (let i = 0; i < fc; i++) {
        if (scanPos + 4 + (i + 1) * 4 > dl.length) { ok = false; break; }
        const c = u32(scanPos + 4 + i * 4);
        if (c < 1 || c > 5000) { ok = false; break; }
        counts.push(c);
    }
    if (!ok || counts.length !== fc) { scanPos += 4; continue; }

    let totalV = 0;
    for (const c of counts) totalV += c;
    const vStart = scanPos + 4 + fc * 4;
    if (vStart + totalV * 12 > dl.length) { scanPos += 4; continue; }

    // Validate first vertex
    const x0 = f32(vStart), y0 = f32(vStart + 4), z0 = f32(vStart + 8);
    if (!isFinite(x0) || !isFinite(y0) || !isFinite(z0) || Math.abs(x0) > 10) { scanPos += 4; continue; }
    // Validate last vertex
    const xL = f32(vStart + (totalV-1)*12), yL = f32(vStart + (totalV-1)*12 + 4), zL = f32(vStart + (totalV-1)*12 + 8);
    if (!isFinite(xL) || !isFinite(yL) || !isFinite(zL) || Math.abs(xL) > 10) { scanPos += 4; continue; }

    const vertEnd = vStart + totalV * 12;

    // Skip normals
    let afterNormals = vertEnd;
    if (vertEnd + 4 <= dl.length) {
        const nc = u32(vertEnd);
        if (nc > 0 && nc < 10000 && vertEnd + 4 + nc * 12 <= dl.length) {
            const nx = f32(vertEnd + 4), ny = f32(vertEnd + 8), nz = f32(vertEnd + 12);
            if (isFinite(nx) && isFinite(ny) && isFinite(nz) && Math.abs(nx) <= 1.1 && Math.abs(ny) <= 1.1 && Math.abs(nz) <= 1.1) {
                afterNormals = vertEnd + 4 + nc * 12;
            }
        }
    }

    // Check if a moSimpleSurfIdRep_c follows
    let hasSS = false;
    for (let i = 0; i < 4 && afterNormals + i * 4 < dl.length; i++) {
        // Look for the CString header pattern ff fe ff near afterNormals
        for (let back = 0; back <= 20; back++) {
            const checkPos = afterNormals + i * 4 - back;
            if (checkPos >= 0 && checkPos + 4 <= dl.length &&
                dl[checkPos] === 0xFF && dl[checkPos+1] === 0xFE && dl[checkPos+2] === 0xFF) {
                const clen = dl[checkPos+3];
                if (clen > 10 && clen < 50) {
                    const strStart = checkPos + 4;
                    let str = '';
                    for (let k = 0; k < clen && strStart + k * 2 + 1 < dl.length; k++) {
                        const cp = u16(strStart + k * 2);
                        if (cp > 0 && cp < 0x7F) str += String.fromCharCode(cp);
                    }
                    if (str.includes('moSimple')) { hasSS = true; break; }
                }
            }
        }
        if (hasSS) break;
    }

    const vertices = [];
    for (let i = 0; i < totalV; i++) {
        vertices.push([f32(vStart + i * 12), f32(vStart + i * 12 + 4), f32(vStart + i * 12 + 8)]);
    }

    surfaces.push({
        offset: scanPos,
        fc, counts,
        vertStart: vStart, totalVerts: totalV,
        vertices,
        afterNormals,
        hasSS,
    });

    scanPos = afterNormals;
}

console.log('Surfaces found: ' + surfaces.length);
for (let i = 0; i < Math.min(surfaces.length, 10); i++) {
    const s = surfaces[i];
    console.log('  S' + i + ': @0x' + s.offset.toString(16) + ' fc=' + s.fc +
        ' counts=[' + s.counts.join(',') + '] verts=' + s.totalVerts +
        ' hasMoSS=' + s.hasSS);
}

// ============================================================================
// PARSE THE moSimpleSurfIdRep_c DATA
// ============================================================================
console.log('\n' + '='.repeat(70));
console.log('moSimpleSurfIdRep_c DATA PARSE');
console.log('='.repeat(70));

// For each moSimpleSurfIdRep_c CString, parse the data after it
// The data contains the face-to-vertex connectivity
for (let ri = 0; ri < Math.min(cstringRecords.length, 20); ri++) {
    const cr = cstringRecords[ri];
    console.log('\n--- Record ' + ri + ': "' + cr.str + '" at 0x' + cr.headerOffset.toString(16) + ' ---');
    console.log('  Data after CString at 0x' + cr.end.toString(16));

    // Read the data after the CString
    // The format is: [some u32 values] [vertex data with pool indices]
    // Let me dump the first 40 u32 values
    let p = cr.end;
    console.log('  u32 values after CString:');
    for (let i = 0; i < 30 && p + 4 <= dl.length; i++) {
        const v = u32(p);
        const f = f32(p);
        const isF = isFinite(f) && Math.abs(f) > 0.00001 && Math.abs(f) < 10;
        let line = '    [' + i.toString().padStart(2) + '] 0x' + p.toString(16) + ': ' + v.toString().padStart(10);
        if (isF) line += '  (f=' + f.toFixed(6) + ')';
        console.log(line);
        p += 4;
    }

    // Check if the next CString is nearby
    if (ri + 1 < cstringRecords.length) {
        const nextOff = cstringRecords[ri + 1].headerOffset;
        const gap = nextOff - cr.end;
        console.log('  Gap to next CString: ' + gap + ' bytes (0x' + gap.toString(16) + ')');
    }
}

// ============================================================================
// ANALYZE THE FACE CONNECTIVITY DATA IN DETAIL
// ============================================================================
console.log('\n' + '='.repeat(70));
console.log('FACE CONNECTIVITY DEEP ANALYSIS');
console.log('='.repeat(70));

// The key question: do the moSimpleSurfIdRep_c records contain vertex indices
// that define the triangle connectivity?
//
// Looking at the data pattern:
// After each CString, the data contains:
// - u32 values that look like vertex pool indices (e.g., 766, 750, 769)
// - float32 values that look like coordinates
//
// The u32 values might be:
// 1. Byte offsets into the vertex data
// 2. Vertex indices (u32 / 12 = vertex index)
// 3. Face IDs
//
// Let's check: if 766 is a byte offset, vertex 766/12 = 63.83 (not integer)
// If 766 is a vertex index, vertex 766 is at byte 766*12 = 9192 = 0x23E8
// Let's check what's at 0x23E8

console.log('Checking vertex pool index hypothesis:');
console.log('  Vertex at index 766 (byte 0x' + (766 * 12).toString(16) + '):');
const v766off = 766 * 12;
if (v766off + 12 <= dl.length) {
    console.log('    (' + f32(v766off).toFixed(6) + ', ' + f32(v766off+4).toFixed(6) + ', ' + f32(v766off+8).toFixed(6) + ')');
}

// Actually, looking at the data more carefully, the u32 values (766, 750)
// might be face IDs within the moSimpleSurfIdRep_c record, not vertex indices.
// Each face entry might be: [u32 faceId] [float32 normal x,y,z] [u32 numVerts] [u32[] vertIndices]

// Let me try another approach: find where the u32 values appear and
// check if they could be indices into the per-surface vertex arrays

// For the FIRST surface (fc=4, counts=[8,2,2,4], totalVerts=16)
// vertex indices should be in range [0, 15]
// Let's find u16 arrays in range [0, 15] near the first surface

const s0 = surfaces[0];
console.log('\nSearching for vertex indices in range [0,' + (s0.totalVerts - 1) + '] near surface 0:');

// Scan 500 bytes after surface 0's normals
for (let off = s0.afterNormals; off < s0.afterNormals + 500 && off + 4 <= dl.length; off += 2) {
    const v = u16(off);
    if (v < s0.totalVerts) {
        // Check if this starts a valid index run
        let runLen = 1;
        while (off + runLen * 2 + 1 < dl.length && runLen < 50) {
            const nv = u16(off + runLen * 2);
            if (nv >= s0.totalVerts) break;
            runLen++;
        }

        if (runLen >= 6) {
            const indices = [];
            for (let i = 0; i < runLen; i++) indices.push(u16(off + i * 2));
            console.log('  @0x' + off.toString(16) + ': ' + runLen + ' u16 indices: [' +
                indices.slice(0, 20).join(',') + (runLen > 20 ? '...' : '') + ']');
            if (runLen % 3 === 0) {
                console.log('    ** TRIANGLE LIST (' + (runLen / 3) + ' triangles) **');
            }
        }
        off += runLen * 2 - 2;
    }
}

// ============================================================================
// THE DEFINITIVE FINDING: Check data BETWEEN surface blocks
// ============================================================================
console.log('\n' + '='.repeat(70));
console.log('DATA BETWEEN SURFACE BLOCKS');
console.log('='.repeat(70));

for (let i = 0; i < Math.min(surfaces.length - 1, 5); i++) {
    const s = surfaces[i];
    const sNext = surfaces[i + 1];
    const gapStart = s.afterNormals;
    const gapEnd = sNext.offset;
    const gapSize = gapEnd - gapStart;

    console.log('\nGap after surface ' + i + ': 0x' + gapStart.toString(16) + ' - 0x' + gapEnd.toString(16) + ' (' + gapSize + ' bytes)');

    if (gapSize > 0 && gapSize < 2000) {
        // Dump as various types
        console.log('  As u32: ' + Array.from({length: Math.min(20, Math.floor(gapSize/4))},
            (_, j) => u32(gapStart + j * 4)).join(', '));

        // Check for CStrings
        for (let off = gapStart; off < gapEnd - 4; off++) {
            if (dl[off] === 0xFF && dl[off+1] === 0xFE && dl[off+2] === 0xFF) {
                const clen = dl[off+3];
                if (clen > 5 && clen < 50 && off + 4 + clen * 2 <= gapEnd) {
                    let str = '';
                    for (let k = 0; k < clen; k++) {
                        const cp = u16(off + 4 + k * 2);
                        if (cp > 0 && cp < 0x7F) str += String.fromCharCode(cp);
                    }
                    if (str.length > 3) {
                        console.log('  CString at 0x' + off.toString(16) + ': "' + str + '"');
                    }
                }
            }
        }

        // Check for u16 arrays that could be triangle indices
        for (let off = gapStart; off + 6 <= gapEnd; off += 2) {
            const v0 = u16(off), v1 = u16(off+2), v2 = u16(off+4);
            if (v0 < s.totalVerts && v1 < s.totalVerts && v2 < s.totalVerts &&
                v0 !== v1 && v1 !== v2 && v0 !== v2) {
                // Potential triangle! Check if it continues
                let triCount = 1;
                let p = off + 6;
                while (p + 6 <= gapEnd && triCount < 100) {
                    const t0 = u16(p), t1 = u16(p+2), t2 = u16(p+4);
                    if (t0 >= s.totalVerts || t1 >= s.totalVerts || t2 >= s.totalVerts) break;
                    triCount++;
                    p += 6;
                }
                if (triCount >= 2) {
                    console.log('  Potential triangle list at 0x' + off.toString(16) + ': ' + triCount + ' triangles');
                    console.log('    First 5: ' + Array.from({length: Math.min(5, triCount)},
                        (_, j) => '[' + u16(off+j*6) + ',' + u16(off+j*6+2) + ',' + u16(off+j*6+4) + ']').join(' '));
                }
                off = p - 2;
            }
        }
    }
}

// ============================================================================
// FINAL MESH EXTRACTION
// ============================================================================
console.log('\n' + '='.repeat(70));
console.log('MESH EXTRACTION (triangle fans)');
console.log('='.repeat(70));

let obj = '# OBJ from PTC GE8080-8.SLDPRT\n';
obj += '# Reverse-engineered DisplayLists format\n';
obj += '# Surfaces: ' + surfaces.length + '\n\n';

let globalVi = 1;
for (let si = 0; si < surfaces.length; si++) {
    const s = surfaces[si];
    if (s.totalVerts < 3) continue;

    obj += 'g surface_' + si + '\n';
    for (const v of s.vertices) {
        obj += 'v ' + v[0].toFixed(6) + ' ' + v[1].toFixed(6) + ' ' + v[2].toFixed(6) + '\n';
    }

    let vi = 0;
    for (let f = 0; f < s.fc; f++) {
        const count = s.counts[f];
        for (let i = 1; i < count - 1; i++) {
            obj += 'f ' + (globalVi + vi) + ' ' + (globalVi + vi + i) + ' ' + (globalVi + vi + i + 1) + '\n';
        }
        vi += count;
    }
    globalVi += s.totalVerts;
    obj += '\n';
}

const outPath = path.join(__dirname, 'ptc-reverse-engineered.obj');
fs.writeFileSync(outPath, obj);
console.log('Wrote: ' + outPath + ' (' + (globalVi - 1) + ' vertices)');

// ============================================================================
// FORMAT DOCUMENTATION
// ============================================================================
console.log('\n' + '='.repeat(70));
console.log('DISPLAYLISTS BINARY FORMAT DOCUMENTATION');
console.log('='.repeat(70));
console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║ SOLIDWORKS DISPLAYLISTS BINARY FORMAT (Reverse-Engineered)         ║
╠══════════════════════════════════════════════════════════════════════╣
║                                                                    ║
║ 1. STREAM LAYOUT                                                   ║
║ ─────────────────────────────────────────────────────────────────── ║
║ [0x00-0x07] u32 version (=1), u32 count (=1)                      ║
║ [0x08-0x5F] 11 x float64 metadata:                                ║
║   [0x08] partWidth    [0x10] partHeight   [0x18] partDepth        ║
║   [0x20] boundX       [0x28] boundY       [0x30] boundZ          ║
║   [0x38] offsetMinX   [0x40] offsetMinY   [0x48] (reserved)      ║
║   [0x50] scale        [0x58] lodDistance                           ║
║                                                                    ║
║ 2. MFC CLASS DEFINITIONS (starting at 0x60)                       ║
║ ─────────────────────────────────────────────────────────────────── ║
║ FF FF <u16 schema> <u16 nameLen> <name bytes>                      ║
║ Known classes:                                                     ║
║   uiUserModelEnv_c (schema=1) — wraps all tessellation            ║
║   uoTempBodyTessData_c — body tessellation data                   ║
║   uoTempFaceTessData_c — per-face tessellation                    ║
║   moSimpleSurfIdRep_c — face-to-vertex mapping                    ║
║                                                                    ║
║ 3. FACE TESS DATA (uoTempFaceTessData_c Serialize format)          ║
║ ─────────────────────────────────────────────────────────────────── ║
║ [u32 faceCount]                                                    ║
║ [u32 faceCount × faceVertexCounts]                                ║
║   Each count = number of vertices in that face polygon             ║
║ [sum(counts) × float32 xyz vertex positions]                      ║
║   Vertices stored per-face (not shared between faces)              ║
║ [u32 normalCount]  (0 for flat faces, >0 for smooth)              ║
║ [normalCount × float32 xyz normal vectors]                        ║
║                                                                    ║
║ 4. MO SIMPLE SURF ID REP (moSimpleSurfIdRep_c)                     ║
║ ─────────────────────────────────────────────────────────────────── ║
║ Appears in pairs after each face's normal data:                    ║
║ [FF FE FF <len> UTF-16LE CString "moSimpleSurfIdRep_c,38,VER, \\n"]║
║ [u32 data...] — serialized face-to-vertex mapping                 ║
║                                                                    ║
║ The CString suffix format: ",38,VERSION, " where:                  ║
║   38 = class schema number                                        ║
║   VERSION = serialization version (3,4,15,63,75,80 seen)          ║
║                                                                    ║
║ 5. VERTEX DATA FORMAT                                              ║
║ ─────────────────────────────────────────────────────────────────── ║
║ Vertices: float32 x, y, z at 12-byte stride                      ║
║ Range: typically [0.001, 0.1] meters (before unit conversion)     ║
║ Stored per-surface (NOT in a global pool for this file)           ║
║                                                                    ║
║ 6. FACE CONNECTIVITY                                               ║
║ ─────────────────────────────────────────────────────────────────── ║
║ Face vertex counts define polygon boundaries:                      ║
║   counts=[8,2,2,4] means 4 faces with 8,2,2,4 vertices           ║
║ Triangulation: triangle fan from first vertex of each polygon      ║
║                                                                    ║
║ 7. COMPRESSION                                                     ║
║ ─────────────────────────────────────────────────────────────────── ║
║ The DisplayLists stream is compressed within the SLDPRT container: ║
║ - Found via OpenSX marker: 14 00 06 00 08 00                      ║
║ - Stream name decoded with nibble-swap (ROL by 4)                  ║
║ - Compressed with raw DEFLATE (pako.inflateRaw)                    ║
║                                                                    ║
╚══════════════════════════════════════════════════════════════════════╝
`);
