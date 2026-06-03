#!/usr/bin/env node
'use strict';
const fs = require('fs');
const pako = require('pako');

// Decompress DisplayLists from a modern SLDPRT file
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
            const dl = pako.inflateRaw(compressed);
            if (dl.length > 100 && dl[0] === 1 && dl[4] === 1) return dl;
        } catch(e) {}
    }
    return null;
}

// Analyze PTC file in detail
const dl = getDisplayLists('C:\\\\.git\\\\sldprt-research\\\\PTC GE8080-8.SLDPRT');
if (!dl) { console.log('No DisplayLists found'); process.exit(1); }

console.log('DisplayLists size:', dl.length, 'bytes');
const dv = new DataView(dl.buffer, dl.byteOffset, dl.byteLength);

// Read header
const faceCount = dv.getUint32(96, true);
console.log('\n=== HEADER at 0x60 (96) ===');
console.log('faceCount:', faceCount);

// Read face vertex counts
const faceCounts = [];
for (let i = 0; i < faceCount; i++) {
    faceCounts.push(dv.getUint32(100 + i * 4, true));
}
console.log('faceCounts:', faceCounts.slice(0, 20).join(', '), faceCounts.length > 20 ? '...' : '');

// Calculate where vertices start
let totalIndices = 0;
for (const c of faceCounts) totalIndices += c;
console.log('totalIndices:', totalIndices);

const verticesStart = 100 + faceCount * 4;
console.log('verticesStart:', verticesStart, '(0x' + verticesStart.toString(16) + ')');

// The key insight: face vertex counts are INDEX counts, not unique vertices
// After the vertex positions, there should be INDEX DATA that maps faces to vertices
// Let's look at what comes after the vertex data

const vertexDataEnd = verticesStart + totalIndices * 12; // float32 x,y,z
console.log('vertexDataEnd:', vertexDataEnd, '(0x' + vertexDataEnd.toString(16) + ')');

// Look at bytes after vertex data - this should contain face connectivity
console.log('\n=== BYTES AFTER VERTEX DATA (0x' + vertexDataEnd.toString(16) + ') ===');
console.log('Hex dump of next 200 bytes:');
let hex = '';
for (let i = 0; i < 200 && vertexDataEnd + i < dl.length; i++) {
    hex += dl[vertexDataEnd + i].toString(16).padStart(2, '0') + ' ';
    if ((i + 1) % 16 === 0) hex += '\n';
}
console.log(hex);

// Look for u16 patterns that could be face indices
console.log('\n=== SCANNING FOR U16 INDEX PATTERNS ===');
const postVertex = vertexDataEnd;

// Try reading as u16 pairs
console.log('As u16 pairs:');
for (let i = 0; i < 40; i++) {
    const idx = dv.getUint16(postVertex + i * 2, true);
    process.stdout.write(idx.toString().padStart(5) + ' ');
    if ((i + 1) % 10 === 0) console.log('');
}
console.log('');

// The face vertex counts tell us how many vertices per face
// But we need to understand HOW those vertices map to the vertex array
// Let's check: are the vertex positions stored per-face (duplicated) or shared?

// Check if vertices repeat across faces
console.log('\n=== CHECKING VERTEX SHARING ===');
let curOffset = verticesStart;
const faceVertices = [];
for (let f = 0; f < Math.min(faceCount, 5); f++) {
    const count = faceCounts[f];
    const verts = [];
    for (let i = 0; i < count; i++) {
        const x = dv.getFloat32(curOffset + i * 12, true);
        const y = dv.getFloat32(curOffset + i * 12 + 4, true);
        const z = dv.getFloat32(curOffset + i * 12 + 8, true);
        verts.push([x.toFixed(4), y.toFixed(4), z.toFixed(4)]);
    }
    faceVertices.push(verts);
    console.log(`Face ${f}: ${count} vertices`);
    console.log('  First 3:', verts.slice(0, 3).map(v => '(' + v.join(',') + ')').join(' '));
    curOffset += count * 12;
}

// Check if any vertices from face 0 appear in face 1 (shared vertices)
if (faceVertices.length >= 2) {
    let shared = 0;
    for (const v0 of faceVertices[0]) {
        for (const v1 of faceVertices[1]) {
            if (v0[0] === v1[0] && v0[1] === v1[1] && v0[2] === v1[2]) shared++;
        }
    }
    console.log(`Shared vertices between face 0 and 1: ${shared}`);
}

// Now let's look for the INDEX DATA
// The moSimpleSurfIdRep_c pattern: after each surface's vertices,
// there should be u16 index pairs defining edges/connections

console.log('\n=== DETAILED SCAN: LOOKING FOR INDEX PATTERNS ===');
curOffset = verticesStart;
for (let f = 0; f < Math.min(faceCount, 5); f++) {
    const count = faceCounts[f];
    const faceStart = curOffset;
    const faceEnd = curOffset + count * 12;
    
    // After this face's vertices, what's there?
    if (faceEnd + 20 < dl.length) {
        console.log(`\nAfter face ${f} vertices (offset 0x${faceEnd.toString(16)}):`);
        let h = '';
        for (let i = 0; i < 60 && faceEnd + i < dl.length; i++) {
            h += dl[faceEnd + i].toString(16).padStart(2, '0') + ' ';
            if ((i + 1) % 16 === 0) h += '\n';
        }
        console.log(h);
        
        // Try interpreting as u16 indices
        console.log('As u16:');
        const u16s = [];
        for (let i = 0; i < 20; i++) {
            u16s.push(dv.getUint16(faceEnd + i * 2, true));
        }
        console.log(u16s.join(', '));
    }
    
    curOffset = faceEnd;
}

// Let's also look at the MFC object structure more carefully
// Maybe the face indices are embedded in the MFC records, not after vertices
console.log('\n=== MFC CLASS STRUCTURE AT START ===');
// Read MFC classes from the beginning
let pos = 8;
const classes = [];
for (let c = 0; c < 20 && pos < dl.length; c++) {
    const tag = dv.getUint16(pos, true);
    if (tag === 0xFFFF) {
        // New class
        if (pos + 4 > dl.length) break;
        const classId = dv.getUint16(pos + 2, true);
        classes.push({ id: classId, pos: pos });
        console.log(`Class ${classId} at 0x${pos.toString(16)}`);
        pos += 4;
    } else if (tag >= 0x8001 && tag <= 0x8FFE) {
        // Back reference
        console.log(`Backref to class ${tag - 0x8000} at 0x${pos.toString(16)}`);
        pos += 2;
    } else {
        console.log(`Unknown tag 0x${tag.toString(16)} at 0x${pos.toString(16)}`);
        pos += 2;
    }
}

// The key question: where does MFC serialization end and vertex data begin?
// Let's trace through the MFC objects to find the boundary

console.log('\n=== TRACING MFC OBJECTS ===');
pos = 8;
let objectCount = 0;
for (let c = 0; c < 50 && pos < dl.length && pos < 200; c++) {
    const tag = dv.getUint16(pos, true);
    if (tag === 0xFFFF) {
        const classId = dv.getUint16(pos + 2, true);
        console.log(`@0x${pos.toString(16)}: NEW class ${classId}`);
        pos += 4;
        objectCount++;
    } else if (tag >= 0x8001 && tag <= 0x8FFE) {
        console.log(`@0x${pos.toString(16)}: BACKREF class ${tag - 0x8000}`);
        pos += 2;
        objectCount++;
    } else {
        // This might be data, not MFC
        console.log(`@0x${pos.toString(16)}: DATA? tag=0x${tag.toString(16)}`);
        break;
    }
}
console.log(`Total MFC objects: ${objectCount}, next offset: 0x${pos.toString(16)}`);
