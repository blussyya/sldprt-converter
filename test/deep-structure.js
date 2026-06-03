#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const pako = require('pako');

const DL_PATH = path.join(__dirname, 'ptc-displaylists.bin');

let dl;
if (fs.existsSync(DL_PATH)) {
    dl = new Uint8Array(fs.readFileSync(DL_PATH));
} else {
    console.error('Run reverse-engineer.js first to decompress the data');
    process.exit(1);
}

const dv = new DataView(dl.buffer, dl.byteOffset, dl.length);

function readU32(off) { return dv.getUint32(off, true); }
function readU16(off) { return dv.getUint16(off, true); }
function readF32(off) { return dv.getFloat32(off, true); }
function readF64(off) { return dv.getFloat64(off, true); }
function readI32(off) { return dv.getInt32(off, true); }

function hexDump(startOff, len) {
    let result = '';
    for (let off = startOff; off < startOff + len && off < dl.length; off += 16) {
        let hex = '', ascii = '';
        for (let i = 0; i < 16 && off + i < dl.length; i++) {
            const b = dl[off + i];
            hex += b.toString(16).padStart(2, '0') + ' ';
            ascii += (b >= 0x20 && b < 0x7F) ? String.fromCharCode(b) : '.';
        }
        result += '  0x' + off.toString(16).padStart(6, '0') + ': ' + hex + ' ' + ascii + '\n';
    }
    return result;
}

// ============================================================================
// STEP 1: Find all moSimpleSurfIdRep_c strings
// ============================================================================
console.log('='.repeat(70));
console.log('STEP 1: FIND ALL moSimpleSurfIdRep_c STRINGS');
console.log('='.repeat(70));

const searchStr = 'moSimpleSurfIdRep_c';
const searchBytes = Buffer.from(searchStr, 'ascii');
const ssPositions = [];
for (let i = 0; i <= dl.length - searchBytes.length; i++) {
    let match = true;
    for (let j = 0; j < searchBytes.length; j++) {
        if (dl[i + j] !== searchBytes[j]) { match = false; break; }
    }
    if (match) ssPositions.push(i);
}

// Also search for it as UTF-16LE
const searchUtf16 = Buffer.alloc(searchStr.length * 2);
for (let i = 0; i < searchStr.length; i++) {
    searchUtf16[i * 2] = searchStr.charCodeAt(i);
    searchUtf16[i * 2 + 1] = 0;
}
for (let i = 0; i <= dl.length - searchUtf16.length; i++) {
    let match = true;
    for (let j = 0; j < searchUtf16.length; j++) {
        if (dl[i + j] !== searchUtf16[j]) { match = false; break; }
    }
    if (match && !ssPositions.includes(i)) ssPositions.push(i);
}

console.log('moSimpleSurfIdRep_c found at: ' + ssPositions.map(o => '0x' + o.toString(16)).join(', '));
console.log('Total occurrences: ' + ssPositions.length);

// For each occurrence, dump context around it
for (const pos of ssPositions) {
    console.log('\n--- Context around moSimpleSurfIdRep_c at 0x' + pos.toString(16) + ' ---');
    // Show 64 bytes before and 128 bytes after
    const start = Math.max(0, pos - 64);
    console.log(hexDump(start, 192));

    // Try to parse what's before the string (should be an MFC CString header)
    // and what's after (should be the serialized data)
    console.log('  Bytes before string:');
    for (let i = Math.max(0, pos - 20); i < pos; i++) {
        process.stdout.write('  ' + dl[i].toString(16).padStart(2, '0'));
    }
    console.log('');
}

// ============================================================================
// STEP 2: Find all class names in the MFC archive
// ============================================================================
console.log('\n' + '='.repeat(70));
console.log('STEP 2: FIND ALL MFC CLASS NAMES');
console.log('='.repeat(70));

const classNames = ['uoTempBodyTessData_c', 'uoTempFaceTessData_c', 'moSimpleSurfIdRep_c',
    'moCompEdge_cR', 'moCompVertex_c', 'moTempBody_c'];

for (const cn of classNames) {
    const cnBytes = Buffer.from(cn, 'ascii');
    const positions = [];
    for (let i = 0; i <= dl.length - cnBytes.length; i++) {
        let match = true;
        for (let j = 0; j < cnBytes.length; j++) {
            if (dl[i + j] !== cnBytes[j]) { match = false; break; }
        }
        if (match) positions.push(i);
    }
    if (positions.length > 0) {
        console.log(cn + ': ' + positions.map(o => '0x' + o.toString(16)).join(', '));
    }
}

// ============================================================================
// STEP 3: Properly walk the MFC CArchive
// ============================================================================
console.log('\n' + '='.repeat(70));
console.log('STEP 3: WALK MFC ARCHIVE');
console.log('='.repeat(70));

let pos = 0x60;
const classMap = new Map();
let classIdx = 0;
const objectLog = [];

while (pos < dl.length - 4) {
    const tag = readU16(pos);

    if (tag === 0xFFFF) {
        // New class definition
        const schema = readU16(pos + 2);
        const nameLen = readU16(pos + 4);
        if (nameLen > 0 && nameLen < 200 && pos + 6 + nameLen <= dl.length) {
            let name = '';
            for (let k = 0; k < nameLen; k++) {
                const ch = dl[pos + 6 + k];
                name += (ch >= 0x20 && ch < 0x7F) ? String.fromCharCode(ch) : '?';
            }
            classIdx++;
            classMap.set(classIdx, { name, schema, classIdx });
            console.log('  0x' + pos.toString(16).padStart(6, '0') + ': NEW_CLASS #' + classIdx +
                ' schema=' + schema + ' name="' + name + '"');
            pos += 6 + nameLen;
            objectLog.push({ type: 'newClass', name, schema, offset: pos });
        } else {
            break;
        }
    } else if (tag >= 0x8001 && tag <= 0xFFFE) {
        // Class backref - this starts a Serialize payload
        const idx = tag & 0x7FFF;
        const cls = classMap.get(idx);
        const className = cls ? cls.name : '<unknown#' + idx + '>';

        console.log('  0x' + pos.toString(16).padStart(6, '0') + ': CLASS_BACKREF #' + idx +
            ' name="' + className + '"');
        pos += 2;
        objectLog.push({ type: 'backref', name: className, classIdx: idx, offset: pos - 2 });
    } else if (tag === 0x0000) {
        // null
        pos += 2;
    } else if (tag >= 0x0001 && tag <= 0x7FFF) {
        // Object backref
        pos += 2;
    } else {
        // Unknown - dump and try to continue
        console.log('  0x' + pos.toString(16).padStart(6, '0') + ': UNKNOWN_TAG 0x' + tag.toString(16));
        pos += 2;
    }

    if (objectLog.length > 200) break;
}

console.log('\nTotal objects found: ' + objectLog.length);

// ============================================================================
// STEP 4: Find the uoTempBodyTessData_c and uoTempFaceTessData_c Serialize payloads
// ============================================================================
console.log('\n' + '='.repeat(70));
console.log('STEP 4: EXAMINE BODY/FACE TESS DATA');
console.log('='.repeat(70));

// Find uoTempBodyTessData_c in the class map
let bodyTessClass = null;
let faceTessClass = null;
for (const [idx, cls] of classMap) {
    if (cls.name === 'uoTempBodyTessData_c') bodyTessClass = cls;
    if (cls.name === 'uoTempFaceTessData_c') faceTessClass = cls;
}

console.log('BodyTess class:', bodyTessClass ? '#' + bodyTessClass.classIdx : 'NOT FOUND');
console.log('FaceTess class:', faceTessClass ? '#' + faceTessClass.classIdx : 'NOT FOUND');

// Find all backrefs to these classes
const bodyTessRefs = objectLog.filter(o => o.name === 'uoTempBodyTessData_c');
const faceTessRefs = objectLog.filter(o => o.name === 'uoTempFaceTessData_c');
console.log('BodyTess backrefs: ' + bodyTessRefs.length);
console.log('FaceTess backrefs: ' + faceTessRefs.length);

// Dump the data starting at each FaceTess backref
for (let i = 0; i < Math.min(faceTessRefs.length, 5); i++) {
    const ref = faceTessRefs[i];
    console.log('\n--- FaceTessData #' + i + ' Serialize at 0x' + ref.offset.toString(16) + ' ---');
    console.log(hexDump(ref.offset, 256));
}

// ============================================================================
// STEP 5: Actually, the MFC parser above can't determine object boundaries.
// We need a different approach. Let me trace the MFC archive with a reader that
// tracks nesting and reads CStrings properly.
// ============================================================================
console.log('\n' + '='.repeat(70));
console.log('STEP 5: DETAILED MFC CARCHIVE WALK (with CString reading)');
console.log('='.repeat(70));

function readCStringAt(offset) {
    if (offset >= dl.length) return null;
    const b0 = dl[offset];
    if (b0 === 0x00) return { str: '', size: 1 };
    if (b0 === 0xFF) {
        if (offset + 1 >= dl.length) return null;
        const b1 = dl[offset + 1];
        if (b1 === 0xFE) {
            // Unicode: FF FE <len> <UTF-16LE>
            if (offset + 2 >= dl.length) return null;
            const b2 = dl[offset + 2];
            let len;
            let dataStart;
            if (b2 === 0xFF) {
                if (offset + 3 >= dl.length) return null;
                const b3 = dl[offset + 3];
                if (b3 === 0xFF || b3 === 0xFE) {
                    if (offset + 5 > dl.length) return null;
                    len = readU16(offset + 4);
                    dataStart = offset + 6;
                } else {
                    len = b3;
                    dataStart = offset + 4;
                }
            } else if (b2 === 0xFE) {
                if (offset + 4 > dl.length) return null;
                len = readU16(offset + 2);
                dataStart = offset + 4;
            } else {
                len = b2;
                dataStart = offset + 3;
            }
            // Read UTF-16LE
            let str = '';
            for (let k = 0; k < len && dataStart + k * 2 + 1 < dl.length; k++) {
                const cp = readU16(dataStart + k * 2);
                if (cp > 0 && cp < 0x7F) str += String.fromCharCode(cp);
            }
            return { str, size: dataStart + len * 2 - offset };
        }
        if (b1 === 0xFF) {
            if (offset + 2 >= dl.length) return null;
            const b2 = dl[offset + 2];
            if (b2 === 0x00) return { str: '', size: 3 };
            // Short unicode: FF FF <byteLen> <UTF-16LE>
            const charLen = b2;
            const dataStart = offset + 3;
            let str = '';
            for (let k = 0; k < charLen && dataStart + k * 2 + 1 < dl.length; k++) {
                const cp = readU16(dataStart + k * 2);
                if (cp > 0 && cp < 0x7F) str += String.fromCharCode(cp);
            }
            return { str, size: dataStart + charLen * 2 - offset };
        }
        // Short ASCII: FF <len> <ASCII>
        const asciiLen = b1;
        let str = '';
        for (let k = 0; k < asciiLen && offset + 2 + k < dl.length; k++) {
            const ch = dl[offset + 2 + k];
            str += (ch >= 0x20 && ch < 0x7F) ? String.fromCharCode(ch) : '?';
        }
        return { str, size: 2 + asciiLen };
    }
    // Short ASCII: <len> <ASCII>
    const asciiLen = b0;
    let str = '';
    for (let k = 0; k < asciiLen && offset + 1 + k < dl.length; k++) {
        const ch = dl[offset + 1 + k];
        str += (ch >= 0x20 && ch < 0x7F) ? String.fromCharCode(ch) : '?';
    }
    return { str, size: 1 + asciiLen };
}

// Walk through the archive from the start, reading CStrings and tags
pos = 0x60;
let depth = 0;

while (pos < dl.length - 4 && depth < 10) {
    const tag = readU16(pos);

    if (tag === 0xFFFF) {
        const schema = readU16(pos + 2);
        const nameLen = readU16(pos + 4);
        if (nameLen > 0 && nameLen < 200 && pos + 6 + nameLen <= dl.length) {
            let name = '';
            for (let k = 0; k < nameLen; k++) {
                const ch = dl[pos + 6 + k];
                name += (ch >= 0x20 && ch < 0x7F) ? String.fromCharCode(ch) : '?';
            }
            console.log('  '.repeat(depth) + '0x' + pos.toString(16) + ': CLASS "' + name + '" schema=' + schema);
            pos += 6 + nameLen;
        } else {
            break;
        }
    } else if (tag >= 0x8001 && tag <= 0xFFFE) {
        const idx = tag & 0x7FFF;
        const cls = classMap.get(idx);
        const className = cls ? cls.name : '<' + idx + '>';

        // Check if a CString follows (this would indicate a specific serialization pattern)
        const nextByte = dl[pos + 2];
        const cstr = readCStringAt(pos + 2);

        if (cstr && cstr.str.length > 3 && cstr.str.length < 200) {
            console.log('  '.repeat(depth) + '0x' + pos.toString(16) + ': BACKREF #' + idx +
                ' "' + className + '" CString="' + cstr.str + '"');
            pos += 2 + cstr.size;
        } else {
            console.log('  '.repeat(depth) + '0x' + pos.toString(16) + ': BACKREF #' + idx +
                ' "' + className + '" next=0x' + nextByte.toString(16));
            pos += 2;
        }
    } else if (tag === 0x0000) {
        pos += 2;
    } else {
        // Could be data, not a tag
        // Look for patterns: is there a valid CString here?
        const cstr = readCStringAt(pos);
        if (cstr && cstr.str.length > 5 && cstr.str.length < 200 && /^[\x20-\x7E]+$/.test(cstr.str)) {
            console.log('  '.repeat(depth) + '0x' + pos.toString(16) + ': CString="' + cstr.str + '"');
            pos += cstr.size;
        } else {
            // Try next interpretation
            console.log('  '.repeat(depth) + '0x' + pos.toString(16) + ': DATA u16=' + tag + ' u32=' + readU32(pos));
            pos += 4;
        }
    }

    if (pos > 0x2000) break; // Don't go too far
}

// ============================================================================
// STEP 6: THE KEY INSIGHT - Parse the actual FaceTessData Serialize format
// ============================================================================
console.log('\n' + '='.repeat(70));
console.log('STEP 6: FACE TESS DATA SERIALIZATION FORMAT');
console.log('='.repeat(70));

// From the MFC walk, find where uoTempFaceTessData_c data starts
// Let's scan for the pattern: faceCount u32, then face vertex counts,
// then vertex positions, etc. But this time we'll be more careful about
// what comes AFTER the normals.

// Let me try parsing from each faceTess backref
for (const ref of faceTessRefs.slice(0, 3)) {
    const start = ref.offset;
    console.log('\n--- FaceTess Serialize at 0x' + start.toString(16) + ' ---');

    // The Serialize() method typically writes:
    // 1. CString or some header data
    // 2. Face count, vertex counts, vertex data
    // 3. Normal data
    // 4. moSimpleSurfIdRep_c records

    // Let's try reading u32 values and see what makes sense
    let p = start;
    console.log('Raw u32/u16/u8 values:');
    for (let i = 0; i < 50 && p + 4 <= dl.length; i++) {
        const u32 = readU32(p);
        const u16a = readU16(p);
        const u16b = (p + 2 < dl.length) ? readU16(p + 2) : 0;
        const f32 = readF32(p);
        const isFloat = isFinite(f32) && Math.abs(f32) > 0.00001 && Math.abs(f32) < 100;

        let line = '  0x' + p.toString(16) + ': u32=' + u32.toString().padStart(10) +
            ' u16=[' + u16a.toString().padStart(5) + ',' + u16b.toString().padStart(5) + ']';
        if (isFloat) line += ' f32=' + f32.toFixed(6);
        console.log(line);

        p += 4;
    }
}

// ============================================================================
// STEP 7: SCAN FOR VERTEX POOL + INDEX PAIR PATTERNS
// ============================================================================
console.log('\n' + '='.repeat(70));
console.log('STEP 7: SCAN FOR u16 INDEX ARRAYS (valid triangle indices)');
console.log('='.repeat(70));

// For each potential vertex count (1-500), scan for u16 arrays where
// all values are in range [0, vertexCount)
// This is brute force but definitive

// First, collect all vertex blocks
const vertexBlocks = [];
let curStart = 0;
let curCount = 0;

for (let off = 0x60; off + 12 <= dl.length; off += 4) {
    const x = readF32(off);
    const y = readF32(off + 4);
    const z = readF32(off + 8);

    if (isFinite(x) && isFinite(y) && isFinite(z) &&
        Math.abs(x) < 10 && Math.abs(y) < 10 && Math.abs(z) < 10 &&
        (Math.abs(x) > 0.0001 || Math.abs(y) > 0.0001 || Math.abs(z) > 0.0001)) {
        if (curCount === 0) curStart = off;
        curCount++;
    } else {
        if (curCount >= 3) vertexBlocks.push({ start: curStart, count: curCount });
        curCount = 0;
    }
}
if (curCount >= 3) vertexBlocks.push({ start: curStart, count: curCount });

console.log('Vertex blocks: ' + vertexBlocks.length);

// For each vertex block, look for u16 index arrays right after it
for (const vb of vertexBlocks) {
    const afterVerts = vb.start + vb.count * 12;
    if (afterVerts + 6 >= dl.length) continue;

    // Try reading as triangle indices: check if the next bytes are u16 values in range [0, vb.count)
    let validCount = 0;
    let invalidCount = 0;
    const sampleSize = Math.min(20, Math.floor((dl.length - afterVerts) / 2));

    for (let i = 0; i < sampleSize; i++) {
        const idx = readU16(afterVerts + i * 2);
        if (idx < vb.count) validCount++;
        else invalidCount++;
    }

    if (validCount >= 6 && validCount > invalidCount * 2) {
        console.log('\n  Block @0x' + vb.start.toString(16) + ' (' + vb.count + ' verts) -> u16 after:');
        // Read all valid indices
        const indices = [];
        for (let i = 0; i < 100 && afterVerts + i * 2 + 2 <= dl.length; i++) {
            const idx = readU16(afterVerts + i * 2);
            indices.push(idx);
            if (idx >= vb.count && i > 3) break; // stop at first invalid after valid run
        }
        console.log('    u16 values: [' + indices.slice(0, 40).join(',') + (indices.length > 40 ? '...' : '') + ']');

        // Check if these form triangles (divisible by 3)
        if (indices.length >= 6) {
            // Find where the valid run ends
            let endIdx = indices.length;
            for (let i = 3; i < indices.length; i++) {
                if (indices[i] >= vb.count) { endIdx = i; break; }
            }
            const validIndices = indices.slice(0, endIdx);
            if (validIndices.length % 3 === 0) {
                console.log('    ** TRIANGLE LIST: ' + (validIndices.length / 3) + ' triangles **');
                console.log('    Indices: [' + validIndices.join(',') + ']');
            }
        }
    }
}

// ============================================================================
// STEP 8: LOOK FOR moSimpleSurfIdRep_c RECORDS AND PARSE THEM
// ============================================================================
console.log('\n' + '='.repeat(70));
console.log('STEP 8: PARSE moSimpleSurfIdRep_c DATA');
console.log('='.repeat(70));

// The moSimpleSurfIdRep_c records should contain face-to-vertex mappings
// Let's look at the data structure around each occurrence

for (const pos of ssPositions) {
    console.log('\n--- moSimpleSurfIdRep_c at 0x' + pos.toString(16) + ' ---');

    // Look backwards for the class definition or backref
    // The CString "moSimpleSurfIdRep_c,38,4, " suggests this is a class with schema info
    // Let's look at 256 bytes BEFORE the string
    const startBefore = Math.max(0, pos - 128);
    console.log('Data before string:');

    // Try to find the structure:
    // The data might be: [u32 numFaces] [per-face: u16 numEdgeVerts, u16[] edgeVerts]
    // Or: [u32 numFaces] [per-face: u32 numVerts, u32[] vertIndices]

    // Let me look at what follows the string
    const afterString = pos + searchStr.length;
    console.log('After string (0x' + afterString.toString(16) + '):');
    console.log(hexDump(afterString, 128));

    // Read as u32/u16
    console.log('As u32:');
    for (let i = 0; i < 20 && afterString + i * 4 + 4 <= dl.length; i++) {
        console.log('  [' + i + '] ' + readU32(afterString + i * 4));
    }
}

console.log('\n' + '='.repeat(70));
console.log('ANALYSIS COMPLETE');
console.log('='.repeat(70));
