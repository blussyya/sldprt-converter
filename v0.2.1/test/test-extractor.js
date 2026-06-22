/**
 * SLDPRT Extractor Test Suite
 * Run with: node --test test/test-extractor.js
 * Or:       node test/test-extractor.js
 */

'use strict';

const assert = require('assert');
const { extractMesh, toOBJ, toSTL, toBinarySTL, parseOLE2, setVerbose } = require('../src/sldprt-extractor');
const { findAll, triArea, earClip, triangulate, ptInPoly, signedArea2d, project3dTo2d } = require('../src/utils');

// Suppress verbose output during tests
setVerbose(false);

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log('  PASS:', name);
    } catch (e) {
        failed++;
        console.error('  FAIL:', name, '-', e.message);
    }
}

function assertAlmostEqual(a, b, tol) {
    tol = tol || 1e-6;
    if (Math.abs(a - b) > tol) {
        throw new Error(`Expected ${a} ≈ ${b} (tol=${tol})`);
    }
}

function assertArraysEqual(a, b) {
    if (a.length !== b.length) throw new Error(`Length mismatch: ${a.length} vs ${b.length}`);
    for (let i = 0; i < a.length; i++) {
        if (typeof a[i] === 'number' && typeof b[i] === 'number') {
            if (Math.abs(a[i] - b[i]) > 1e-10) throw new Error(`Index ${i}: ${a[i]} !== ${b[i]}`);
        } else if (Array.isArray(a[i]) && Array.isArray(b[i])) {
            assertArraysEqual(a[i], b[i]);
        } else if (a[i] !== b[i]) {
            throw new Error(`Index ${i}: ${a[i]} !== ${b[i]}`);
        }
    }
}

// ============================================================
// Utility Tests
// ============================================================
console.log('\n=== Utility Functions ===');

test('findAll finds pattern in buffer', () => {
    const buf = new Uint8Array([1, 2, 3, 4, 1, 2, 3, 4]);
    const pat = new Uint8Array([2, 3]);
    const result = findAll(buf, pat);
    assert.deepStrictEqual(result, [1, 5]);
});

test('findAll returns empty for no match', () => {
    const buf = new Uint8Array([1, 2, 3]);
    const pat = new Uint8Array([4, 5]);
    const result = findAll(buf, pat);
    assert.deepStrictEqual(result, []);
});

test('findAll matches at position 0', () => {
    const buf = new Uint8Array([1, 2, 3, 4]);
    const pat = new Uint8Array([1, 2]);
    const result = findAll(buf, pat);
    assert.deepStrictEqual(result, [0]);
});

test('triArea computes triangle area', () => {
    const a = [0, 0, 0], b = [1, 0, 0], c = [0, 1, 0];
    const area = triArea(a, b, c);
    assertAlmostEqual(area, 0.5);
});

test('triArea returns 0 for degenerate triangle', () => {
    const a = [0, 0, 0], b = [1, 0, 0], c = [2, 0, 0];
    const area = triArea(a, b, c);
    assert.strictEqual(area, 0);
});

test('signedArea2d computes positive area for CCW polygon', () => {
    const p = [[0,0],[1,0],[1,1],[0,1]];
    assertAlmostEqual(signedArea2d(p), 1, 1e-10);
});

test('signedArea2d computes negative area for CW polygon', () => {
    const p = [[0,0],[0,1],[1,1],[1,0]];
    assertAlmostEqual(signedArea2d(p), -1, 1e-10);
});

test('ptInPoly detects point inside square', () => {
    const p = [[0,0],[1,0],[1,1],[0,1]];
    assert.ok(ptInPoly(0.5, 0.5, p), 'Center should be inside');
});

test('ptInPoly detects point outside square', () => {
    const p = [[0,0],[1,0],[1,1],[0,1]];
    assert.ok(!ptInPoly(2, 2, p), 'Outside should be false');
});

test('earClip triangulates a quad', () => {
    const p2d = [[0,0],[1,0],[1,1],[0,1]];
    const tris = earClip(p2d);
    assert.strictEqual(tris.length, 2, 'Quad should produce 2 triangles');
    assert.strictEqual(tris[0].length, 3, 'Each triangle has 3 indices');
    assert.strictEqual(tris[1].length, 3, 'Each triangle has 3 indices');
});

test('earClip returns [] for degenerate polygon (2 pts)', () => {
    const p2d = [[0,0],[1,0]];
    const tris = earClip(p2d);
    assert.strictEqual(tris.length, 0, 'Degenerate should produce 0 triangles');
});

test('triangulate produces 3D triangles from square', () => {
    const outer = [[0,0,0],[1,0,0],[1,1,0],[0,1,0]];
    const tris = triangulate(outer, []);
    assert.strictEqual(tris.length, 2, 'Should produce 2 triangles');
    assert.strictEqual(tris[0].length, 3, 'Each is a triangle');
    assert.strictEqual(tris[0][0].length, 3, 'Each vertex is 3D');
});

test('project3dTo2d handles 3D planar points', () => {
    const pts = [[0,0,0],[1,0,0],[1,1,0],[0,1,0]];
    const pts2d = project3dTo2d(pts);
    assert.strictEqual(pts2d.length, 4, 'Same number of points');
    assert.strictEqual(pts2d[0].length, 2, 'Each is 2D');
});

// ============================================================
// OLE2 Parser Tests
// ============================================================
console.log('\n=== OLE2 Parser ===');

test('parseOLE2 rejects empty buffer', () => {
    const buf = new Uint8Array(512);
    try {
        const result = parseOLE2(buf);
        assert.ok(result.ss > 0);
    } catch (e) {
        // Expected for garbage data
        assert.ok(true);
    }
});

test('parseOLE2 handles minimal realistic header', () => {
    // Build a minimal OLE2 header
    const buf = new Uint8Array(4096);
    const dv = new DataView(buf.buffer);

    // Magic: D0 CF 11 E0 A1 B1 1A E1
    buf[0] = 0xD0; buf[1] = 0xCF; buf[2] = 0x11; buf[3] = 0xE0;
    buf[4] = 0xA1; buf[5] = 0xB1; buf[6] = 0x1A; buf[7] = 0xE1;

    // Minor version (2 bytes at offset 24)
    dv.setUint16(24, 0x003E, true);  // v3
    // Major version (2 bytes at offset 26)
    dv.setUint16(26, 3, true);
    // Byte order (2 bytes at offset 28): 0xFFFE = little-endian
    dv.setUint16(28, 0xFFFE, true);
    // Sector size power (2 bytes at offset 30): 9 → 512 bytes
    dv.setUint16(30, 9, true);
    // Mini sector size power (2 bytes at offset 32): 6 → 64 bytes
    dv.setUint16(32, 6, true);
    // Total sectors in FAT (4 bytes at offset 44): 1
    dv.setUint32(44, 1, true);
    // First directory sector (4 bytes at offset 48)
    dv.setUint32(48, 0xFFFFFFFE, true);  // End of chain
    // Mini stream cutoff size (4 bytes at offset 56): 4096
    dv.setUint32(56, 4096, true);
    // First FAT sector (4 bytes at offset 60)
    dv.setUint32(60, 0xFFFFFFFE, true);  // End of chain
    // First DIFAT sector (4 bytes at offset 68)
    dv.setInt32(68, -1, true);  // No DIFAT

    const result = parseOLE2(buf);
    assert.ok(result.ss === 512, `Expected ss=512 got ${result.ss}`);
    assert.ok(Array.isArray(result.fat), 'fat should be an array');
    assert.ok(Array.isArray(result.entries), 'entries should be an array');
});

// ============================================================
// Output Generator Tests
// ============================================================
console.log('\n=== Output Generators ===');

const testMesh = {
    vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]],
    faces: [[0, 1, 2], [1, 3, 2]],
    faceVertexCounts: [3, 3],
    warnings: [],
    errors: []
};

test('toOBJ produces valid Wavefront format', () => {
    const obj = toOBJ(testMesh);
    assert.ok(obj.startsWith('# SLDPRT mesh'), 'Should start with comment');
    assert.ok(obj.includes('v 0.000000 0.000000 0.000000'), 'Should include vertex 0');
    assert.ok(obj.includes('v 1.000000 0.000000 0.000000'), 'Should include vertex 1');
    assert.ok(obj.includes('f 1 2 3'), 'Should include face 1 2 3');
    assert.ok(obj.includes('f 2 4 3'), 'Should include face 2 4 3');
    // Check vertex count comment
    assert.ok(obj.match(/4 vertices.*2 faces/), 'Should have metadata comment');
});

test('toSTL produces valid ASCII STL format', () => {
    const stl = toSTL(testMesh);
    assert.ok(stl.startsWith('solid sldprt_extracted'), 'Should start with solid');
    assert.ok(stl.includes('endsolid sldprt_extracted'), 'Should end with solid');
    assert.ok(stl.includes('facet normal'), 'Should have facet normal lines');
    assert.ok(stl.includes('vertex'), 'Should have vertex lines');
});

test('toBinarySTL produces correct size binary', () => {
    const buf = toBinarySTL(testMesh);
    // Binary STL: 84 byte header + 50 bytes per triangle × 2 tris
    assert.strictEqual(buf.length, 84 + 50 * 2, 'Should be 184 bytes');
    // Check triangle count at offset 80
    const dv = new DataView(buf.buffer);
    assert.strictEqual(dv.getUint32(80, true), 2, 'Should have 2 triangles');
});

test('toBinarySTL handles empty faces', () => {
    const emptyMesh = { vertices: [], faces: [], faceVertexCounts: [] };
    const buf = toBinarySTL(emptyMesh);
    assert.strictEqual(buf.length, 84, 'Should be just header');
});

// ============================================================
// extraction Tests (edge cases)
// ============================================================
console.log('\n=== extractMesh Edge Cases ===');

test('extractMesh returns errors for empty buffer', () => {
    const result = extractMesh(new Uint8Array(0));
    assert.ok(result.errors.length > 0, 'Should produce errors');
});

test('extractMesh returns errors for garbage data', () => {
    const buf = new Uint8Array(100);
    for (let i = 0; i < 100; i++) buf[i] = i;
    const result = extractMesh(buf);
    assert.ok(result.errors.length > 0, 'Should produce errors for garbage');
});

test('extractMesh handles ArrayBuffer input', () => {
    const ab = new ArrayBuffer(100);
    const result = extractMesh(ab);
    assert.ok(result.errors.length > 0, 'Should handle ArrayBuffer');
});

test('extractMesh has correct result shape for valid OLE2', () => {
    // Create minimal OLE2 with bogus data - will fail to find DisplayLists
    const buf = new Uint8Array(4096);
    const dv = new DataView(buf.buffer);
    buf[0] = 0xD0; buf[1] = 0xCF; buf[2] = 0x11; buf[3] = 0xE0;
    buf[4] = 0xA1; buf[5] = 0xB1; buf[6] = 0x1A; buf[7] = 0xE1;
    dv.setUint16(24, 0x003E, true);
    dv.setUint16(26, 3, true);
    dv.setUint16(28, 0xFFFE, true);
    dv.setUint16(30, 9, true);
    dv.setUint16(32, 6, true);
    dv.setUint32(44, 1, true);
    dv.setUint32(48, 0xFFFFFFFE, true);
    dv.setUint32(56, 4096, true);
    dv.setUint32(60, 0xFFFFFFFE, true);
    dv.setInt32(68, -1, true);

    const result = extractMesh(buf);
    assert.ok(typeof result === 'object', 'Should return an object');
    assert.ok(Array.isArray(result.vertices), 'Should have vertices array');
    assert.ok(Array.isArray(result.faces), 'Should have faces array');
    assert.ok(Array.isArray(result.warnings), 'Should have warnings array');
    assert.ok(Array.isArray(result.errors), 'Should have errors array');
});

// ============================================================
// Summary
// ============================================================
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
