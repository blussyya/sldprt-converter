#!/usr/bin/env node
/**
 * Diagnostic: Compare extracted BOTTOM SLDPRT mesh vs reference STL
 * Checks if fan triangulation produces correct triangle count and area
 */

const fs = require('fs');
const path = require('path');
const { extractMesh, toBinarySTL, setVerbose } = require('./sldprt-extractor.js');

const SLDPRT = 'C:\\Users\\basha\\Desktop\\soldiworks research\\test files original\\usb hub case (ultimate test)\\USB hub case BOTTOM.SLDPRT';
const REF_STL = 'C:\\Users\\basha\\Desktop\\soldiworks research\\test files original\\usb hub case (ultimate test)\\USB hub case BOTTOM ORIGINAL.STL';

// ============================================================
// Helpers
// ============================================================

function triArea(a, b, c) {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    return Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]) / 2;
}

function cross(a, b) {
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
    ];
}

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function vlen(v) { return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]); }
function vnorm(v) { const l = vlen(v); return l > 1e-12 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, 0]; }

// ============================================================
// Binary STL parser
// ============================================================

function parseSTL(buf) {
    if (buf instanceof Buffer) buf = new Uint8Array(buf);
    if (buf.length < 84) return null;

    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

    // First try binary: check if size matches binary format
    const triCount = dv.getUint32(80, true);
    const expectedBinSize = 84 + triCount * 50;
    if (triCount > 0 && Math.abs(buf.length - expectedBinSize) <= 2) {
        return parseBinarySTL(buf);
    }

    // Otherwise try ASCII
    const ascii = parseAsciiSTL(buf);
    if (ascii && ascii.triangles.length > 0) return ascii;

    // Last resort: try binary anyway
    return parseBinarySTL(buf);
}

function parseBinarySTL(buf) {
    if (buf instanceof Buffer) buf = new Uint8Array(buf);
    if (buf.length < 84) return null;

    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const triCount = dv.getUint32(80, true);

    const triangles = [];
    let offset = 84;
    for (let i = 0; i < triCount; i++) {
        if (offset + 50 > buf.length) break;
        const nx = dv.getFloat32(offset, true); offset += 4;
        const ny = dv.getFloat32(offset, true); offset += 4;
        const nz = dv.getFloat32(offset, true); offset += 4;
        const v0 = [dv.getFloat32(offset, true), dv.getFloat32(offset + 4, true), dv.getFloat32(offset + 8, true)]; offset += 12;
        const v1 = [dv.getFloat32(offset, true), dv.getFloat32(offset + 4, true), dv.getFloat32(offset + 8, true)]; offset += 12;
        const v2 = [dv.getFloat32(offset, true), dv.getFloat32(offset + 4, true), dv.getFloat32(offset + 8, true)]; offset += 12;
        const attr = dv.getUint16(offset, true); offset += 2;
        triangles.push({ normal: [nx, ny, nz], vertices: [v0, v1, v2], attribute: attr });
    }
    return { triangles };
}

function parseAsciiSTL(buf) {
    const text = buf instanceof Buffer ? buf.toString('utf8') : new TextDecoder().decode(buf);
    const triangles = [];
    const facetRegex = /facet\s+normal\s+([-\d.e+]+)\s+([-\d.e+]+)\s+([-\d.e+]+)\s+outer\s+loop\s+vertex\s+([-\d.e+]+)\s+([-\d.e+]+)\s+([-\d.e+]+)\s+vertex\s+([-\d.e+]+)\s+([-\d.e+]+)\s+([-\d.e+]+)\s+vertex\s+([-\d.e+]+)\s+([-\d.e+]+)\s+([-\d.e+]+)/gi;
    let m;
    while ((m = facetRegex.exec(text)) !== null) {
        triangles.push({
            normal: [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])],
            vertices: [
                [parseFloat(m[4]), parseFloat(m[5]), parseFloat(m[6])],
                [parseFloat(m[7]), parseFloat(m[8]), parseFloat(m[9])],
                [parseFloat(m[10]), parseFloat(m[11]), parseFloat(m[12])]
            ],
            attribute: 0
        });
    }
    return triangles.length > 0 ? { triangles } : null;
}

// ============================================================
// Compute STL metrics
// ============================================================

function stlMetrics(stl) {
    const tris = stl.triangles;
    const triCount = tris.length;

    let totalArea = 0;
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    for (const tri of tris) {
        totalArea += triArea(tri.vertices[0], tri.vertices[1], tri.vertices[2]);
        for (const v of tri.vertices) {
            if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
            if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
            if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
        }
    }

    return {
        triCount,
        totalArea,
        bbox: {
            x: { min: minX, max: maxX, size: maxX - minX },
            y: { min: minY, max: maxY, size: maxY - minY },
            z: { min: minZ, max: maxZ, size: maxZ - minZ }
        }
    };
}

// ============================================================
// Compute extracted mesh metrics
// ============================================================

function extractedMetrics(mesh) {
    // Count triangles from fan triangulation
    let triCount = 0;
    for (const face of mesh.faces) {
        if (face.length >= 3) triCount += face.length - 2;
    }

    let totalArea = 0;
    for (const face of mesh.faces) {
        if (face.length < 3) continue;
        for (let i = 1; i < face.length - 1; i++) {
            totalArea += triArea(mesh.vertices[face[0]], mesh.vertices[face[i]], mesh.vertices[face[i + 1]]);
        }
    }

    // Bounding box
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (const v of mesh.vertices) {
        if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
        if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
        if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
    }

    return {
        triCount,
        totalArea,
        bbox: {
            x: { min: minX, max: maxX, size: maxX - minX },
            y: { min: minY, max: maxY, size: maxY - minY },
            z: { min: minZ, max: maxZ, size: maxZ - minZ }
        }
    };
}

// ============================================================
// Fan triangulation checks
// ============================================================

function checkFanTriangulation(mesh) {
    const issues = {
        degenerateTris: 0,
        flippedTris: 0,
        facesWithMoreThan3Verts: 0,
        totalFanTris: 0,
        zeroAreaTris: 0,
        faceDetails: []
    };

    for (let fi = 0; fi < mesh.faces.length; fi++) {
        const face = mesh.faces[fi];
        if (face.length < 3) continue;

        if (face.length > 3) issues.facesWithMoreThan3Verts++;

        const faceTris = face.length - 2;
        issues.totalFanTris += faceTris;

        // Compute expected normal from first 3 vertices (fan center at face[0])
        const v0 = mesh.vertices[face[0]];
        if (!v0) continue;

        const faceNormal = [0, 0, 0];
        for (let i = 1; i < face.length - 1; i++) {
            const v1 = mesh.vertices[face[i]];
            const v2 = mesh.vertices[face[i + 1]];
            if (!v1 || !v2) continue;

            const area = triArea(v0, v1, v2);
            if (area < 1e-15) {
                issues.degenerateTris++;
                issues.zeroAreaTris++;
                continue;
            }

            // Compute cross product for this sub-triangle
            const e1 = sub(v1, v0);
            const e2 = sub(v2, v0);
            const n = cross(e1, e2);
            const nlen = vlen(n);
            if (nlen < 1e-15) {
                issues.degenerateTris++;
                continue;
            }

            faceNormal[0] += n[0] / nlen * area;
            faceNormal[1] += n[1] / nlen * area;
            faceNormal[2] += n[2] / nlen * area;
        }

        // Check each sub-triangle has consistent winding
        const faceNormalLen = vlen(faceNormal);
        if (faceNormalLen < 1e-12) continue;
        const fn = vnorm(faceNormal);

        let flipped = 0;
        for (let i = 1; i < face.length - 1; i++) {
            const v1 = mesh.vertices[face[i]];
            const v2 = mesh.vertices[face[i + 1]];
            if (!v1 || !v2) continue;

            const e1 = sub(v1, v0);
            const e2 = sub(v2, v0);
            const n = cross(e1, e2);
            const nlen = vlen(n);
            if (nlen < 1e-15) continue;

            const nn = [n[0] / nlen, n[1] / nlen, n[2] / nlen];
            if (dot(nn, fn) < 0) flipped++;
        }

        if (flipped > 0) {
            issues.flippedTris += flipped;
            issues.faceDetails.push({ fi, vertCount: face.length, flipped });
        }
    }

    return issues;
}

// ============================================================
// Shared boundary vertex check
// ============================================================

function checkSharedBoundaryVertices(mesh) {
    // For each face, collect its vertex positions
    // Check if any two faces share vertices (boundary edges)
    const vertexUsage = new Map(); // "x,y,z" -> [{ faceIndex, localIndex }]

    for (let fi = 0; fi < mesh.faces.length; fi++) {
        const face = mesh.faces[fi];
        for (let vi = 0; vi < face.length; vi++) {
            const v = mesh.vertices[face[vi]];
            if (!v) continue;
            const key = `${v[0].toFixed(6)},${v[1].toFixed(6)},${v[2].toFixed(6)}`;
            if (!vertexUsage.has(key)) vertexUsage.set(key, []);
            vertexUsage.get(key).push({ fi, vi });
        }
    }

    let sharedVerts = 0;
    let maxSharing = 0;
    for (const [, uses] of vertexUsage) {
        if (uses.length > 1) sharedVerts++;
        if (uses.length > maxSharing) maxSharing = uses.length;
    }

    return { uniquePositions: vertexUsage.size, sharedVerts, maxSharing };
}

// ============================================================
// Face winding consistency check
// ============================================================

function checkWindingConsistency(mesh) {
    let ccw = 0;
    let cw = 0;
    let degenerate = 0;

    for (const face of mesh.faces) {
        if (face.length < 3) continue;

        // Compute signed area in the face's plane to determine winding
        // Use cross product of edges from face[0]
        const v0 = mesh.vertices[face[0]];
        if (!v0) { degenerate++; continue; }

        let totalCross = [0, 0, 0];
        for (let i = 1; i < face.length - 1; i++) {
            const v1 = mesh.vertices[face[i]];
            const v2 = mesh.vertices[face[i + 1]];
            if (!v1 || !v2) continue;
            const e1 = sub(v1, v0);
            const e2 = sub(v2, v0);
            const n = cross(e1, e2);
            totalCross[0] += n[0];
            totalCross[1] += n[1];
            totalCross[2] += n[2];
        }

        // Project onto a dominant axis to determine 2D winding
        const ax = Math.abs(totalCross[0]);
        const ay = Math.abs(totalCross[1]);
        const az = Math.abs(totalCross[2]);
        const dom = Math.max(ax, ay, az);
        if (dom < 1e-15) { degenerate++; continue; }

        // For CCW, the dominant component should be positive (right-hand rule)
        // Actually, this depends on the view direction. Let's just check consistency.
        // We check if all faces have the same "handedness" by looking at the sign
        // of the largest component.
        if (ax >= ay && ax >= az) {
            if (totalCross[0] > 0) ccw++; else cw++;
        } else if (ay >= ax && ay >= az) {
            if (totalCross[1] > 0) ccw++; else cw++;
        } else {
            if (totalCross[2] > 0) ccw++; else cw++;
        }
    }

    return { ccw, cw, degenerate, consistent: ccw === 0 || cw === 0 };
}

// ============================================================
// Binary STL output validation
// ============================================================

function validateBinarySTL(stlBuf) {
    const result = {
        valid: true,
        errors: [],
        header: '',
        declaredTriCount: 0,
        actualTriCount: 0,
        fileSize: stlBuf.length,
        expectedFileSize: 0,
        recordsValid: 0,
        recordsInvalid: 0
    };

    if (stlBuf.length < 84) {
        result.valid = false;
        result.errors.push('File too small for binary STL (need >= 84 bytes)');
        return result;
    }

    // Header: 80 bytes
    let header = '';
    for (let i = 0; i < 80; i++) {
        if (stlBuf[i] !== 0) header += String.fromCharCode(stlBuf[i]);
    }
    result.header = header.trim();

    // Triangle count at offset 80
    const dv = new DataView(stlBuf.buffer, stlBuf.byteOffset, stlBuf.byteLength);
    result.declaredTriCount = dv.getUint32(80, true);
    result.expectedFileSize = 84 + result.declaredTriCount * 50;

    if (Math.abs(stlBuf.length - result.expectedFileSize) > 2) {
        result.valid = false;
        result.errors.push(`File size mismatch: ${stlBuf.length} bytes, expected ${result.expectedFileSize} (header says ${result.declaredTriCount} tris)`);
    }

    // Verify each 50-byte facet record
    let offset = 84;
    let valid = 0, invalid = 0;
    for (let i = 0; i < result.declaredTriCount; i++) {
        if (offset + 50 > stlBuf.length) { invalid++; break; }

        // Normal (12 bytes, 3 floats)
        const nx = dv.getFloat32(offset, true);
        const ny = dv.getFloat32(offset + 4, true);
        const nz = dv.getFloat32(offset + 8, true);
        offset += 12;

        // 3 vertices (36 bytes, 9 floats)
        const verts = [];
        for (let j = 0; j < 3; j++) {
            const x = dv.getFloat32(offset, true);
            const y = dv.getFloat32(offset + 4, true);
            const z = dv.getFloat32(offset + 8, true);
            verts.push([x, y, z]);
            offset += 12;
        }

        // Attribute byte count (2 bytes, should be 0)
        const attr = dv.getUint16(offset, true);
        offset += 2;

        // Validate
        const vals = [nx, ny, nz, ...verts[0], ...verts[1], ...verts[2]];
        const allFinite = vals.every(v => isFinite(v));
        const area = triArea(verts[0], verts[1], verts[2]);

        if (allFinite && area > 1e-15) {
            valid++;
        } else {
            invalid++;
        }
    }

    result.actualTriCount = valid + invalid;
    result.recordsValid = valid;
    result.recordsInvalid = invalid;

    return result;
}

// ============================================================
// Main
// ============================================================

console.log('=== BOTTOM SLDPRT vs Reference STL Diagnostic ===\n');

// --- Step 1: Extract SLDPRT ---
console.log('--- Step 1: Extract SLDPRT ---');
console.log(`File: ${SLDPRT}`);

const buf = fs.readFileSync(SLDPRT);
const mesh = extractMesh(buf);

if (mesh.errors.length > 0) {
    console.error('Extraction errors:', mesh.errors);
    process.exit(1);
}

for (const w of mesh.warnings) console.log(`  ${w}`);

// Scale to mm (SolidWorks stores in meters)
for (const v of mesh.vertices) {
    v[0] *= 1000;
    v[1] *= 1000;
    v[2] *= 1000;
}

const exMetrics = extractedMetrics(mesh);
console.log(`\nExtracted mesh:`);
console.log(`  Vertices:    ${mesh.vertices.length}`);
console.log(`  Faces:       ${mesh.faces.length}`);
console.log(`  Triangles:   ${exMetrics.triCount} (from fan triangulation)`);
console.log(`  Total area:  ${exMetrics.totalArea.toFixed(2)} mm²`);
console.log(`  BBox:        (${exMetrics.bbox.x.min.toFixed(2)}, ${exMetrics.bbox.y.min.toFixed(2)}, ${exMetrics.bbox.z.min.toFixed(2)}) → (${exMetrics.bbox.x.max.toFixed(2)}, ${exMetrics.bbox.y.max.toFixed(2)}, ${exMetrics.bbox.z.max.toFixed(2)})`);
console.log(`  Size:        ${exMetrics.bbox.x.size.toFixed(2)} × ${exMetrics.bbox.y.size.toFixed(2)} × ${exMetrics.bbox.z.size.toFixed(2)} mm`);

// --- Step 2: Load reference STL ---
console.log('\n--- Step 2: Load Reference STL ---');
console.log(`File: ${REF_STL}`);

const stlBuf = fs.readFileSync(REF_STL);
const refSTL = parseSTL(stlBuf);

if (!refSTL || refSTL.triangles.length === 0) {
    console.error('Failed to parse reference STL');
    process.exit(1);
}

const refMetrics = stlMetrics(refSTL);
console.log(`\nReference STL:`);
console.log(`  Triangles:   ${refMetrics.triCount}`);
console.log(`  Total area:  ${refMetrics.totalArea.toFixed(2)} mm²`);
console.log(`  BBox:        (${refMetrics.bbox.x.min.toFixed(2)}, ${refMetrics.bbox.y.min.toFixed(2)}, ${refMetrics.bbox.z.min.toFixed(2)}) → (${refMetrics.bbox.x.max.toFixed(2)}, ${refMetrics.bbox.y.max.toFixed(2)}, ${refMetrics.bbox.z.max.toFixed(2)})`);
console.log(`  Size:        ${refMetrics.bbox.x.size.toFixed(2)} × ${refMetrics.bbox.y.size.toFixed(2)} × ${refMetrics.bbox.z.size.toFixed(2)} mm`);

// --- Step 3: Comparison ---
console.log('\n--- Step 3: Comparison ---');

const triDiff = exMetrics.triCount - refMetrics.triCount;
const triRatio = exMetrics.triCount / refMetrics.triCount;
const areaDiff = exMetrics.totalArea - refMetrics.totalArea;
const areaRatio = exMetrics.totalArea / refMetrics.totalArea;

console.log(`\n                    Extracted    Reference    Diff         Ratio`);
console.log(`Triangles:          ${String(exMetrics.triCount).padStart(10)}   ${String(refMetrics.triCount).padStart(10)}   ${String(triDiff >= 0 ? '+' + triDiff : triDiff).padStart(10)}   ${triRatio.toFixed(4)}`);
console.log(`Total area (mm²):   ${exMetrics.totalArea.toFixed(2).padStart(10)}   ${refMetrics.totalArea.toFixed(2).padStart(10)}   ${(areaDiff >= 0 ? '+' : '') + areaDiff.toFixed(2).padStart(8)}   ${areaRatio.toFixed(4)}`);

console.log(`\nBBox comparison:`);
for (const axis of ['x', 'y', 'z']) {
    const e = exMetrics.bbox[axis];
    const r = refMetrics.bbox[axis];
    const d = e.size - r.size;
    console.log(`  ${axis.toUpperCase()}: ext=${e.size.toFixed(2)}  ref=${r.size.toFixed(2)}  diff=${(d >= 0 ? '+' : '') + d.toFixed(2)} mm`);
}

const triMismatch = Math.abs(triDiff) > 0;
const areaMismatch = Math.abs(areaRatio - 1.0) > 0.05;

console.log(`\n*** VERDICT: Triangle count ${triMismatch ? 'MISMATCH' : 'MATCH'} ***`);
console.log(`*** VERDICT: Total area ${areaMismatch ? 'MISMATCH (>5% diff)' : 'MATCH (<5% diff)'} ***`);

if (triMismatch) {
    console.log(`\n>>> CAUSE: The extracted mesh produces ${exMetrics.triCount} triangles vs ${refMetrics.triCount} in reference.`);
    console.log(`>>> This means the fan triangulation or face splitting is creating the wrong number of triangles.`);
    console.log(`>>> Possible causes:`);
    console.log(`>>>   1. Faces with >3 vertices are fan-triangulated differently than the reference`);
    console.log(`>>>   2. Face splitting (by normals) creates extra faces that shouldn't exist`);
    console.log(`>>>   3. Some faces are being filtered as degenerate when they shouldn't be`);
}

// --- Step 4: Fan triangulation checks ---
console.log('\n--- Step 4: Fan Triangulation Checks ---');

const fanIssues = checkFanTriangulation(mesh);
console.log(`Faces with >3 vertices:  ${fanIssues.facesWithMoreThan3Verts} / ${mesh.faces.length}`);
console.log(`Total fan triangles:     ${fanIssues.totalFanTris}`);
console.log(`Degenerate triangles:    ${fanIssues.degenerateTris}`);
console.log(`Flipped triangles:       ${fanIssues.flippedTris}`);
console.log(`Zero-area triangles:     ${fanIssues.zeroAreaTris}`);

if (fanIssues.faceDetails.length > 0) {
    console.log(`\nFlipped face details:`);
    for (const d of fanIssues.faceDetails) {
        console.log(`  Face #${d.fi}: ${d.vertCount} verts, ${d.flipped} flipped sub-tris`);
    }
}

// --- Step 5: Polygon face analysis ---
console.log('\n--- Step 5: Polygon Face Analysis ---');

const faceSizes = {};
for (const face of mesh.faces) {
    const n = face.length;
    faceSizes[n] = (faceSizes[n] || 0) + 1;
}

console.log('Face size distribution:');
for (const [size, count] of Object.entries(faceSizes).sort((a, b) => parseInt(a[0]) - parseInt(b[0]))) {
    const triCount = Math.max(0, parseInt(size) - 2);
    console.log(`  ${size}-gon: ${count} faces → ${triCount * count} triangles`);
}

// For reference STL, all faces are triangles (3-gons)
console.log(`\nReference STL: all ${refMetrics.triCount} triangles (3-gon faces)`);

// --- Step 6: Shared boundary vertex check ---
console.log('\n--- Step 6: Shared Boundary Vertices ---');

const shared = checkSharedBoundaryVertices(mesh);
console.log(`Unique vertex positions: ${shared.uniquePositions}`);
console.log(`Shared positions:        ${shared.sharedVerts}`);
console.log(`Max sharing count:       ${shared.maxSharing}`);

const totalVertsInFaces = mesh.faces.reduce((s, f) => s + f.length, 0);
console.log(`Total verts in faces:    ${totalVertsInFaces} (vs ${mesh.vertices.length} unique)`);
console.log(`Duplication ratio:       ${(totalVertsInFaces / mesh.vertices.length).toFixed(2)}x`);

if (shared.sharedVerts > 0) {
    console.log(`\nNOTE: ${shared.sharedVerts} vertex positions are shared across faces.`);
    console.log(`This is expected for watertight meshes but affects triangle count`);
    console.log(`if faces don't share vertex indices.`);
} else {
    console.log(`\nNOTE: No vertex positions are shared between faces.`);
    console.log(`This means each face has its own copy of boundary vertices.`);
}

// --- Step 7: Winding consistency ---
console.log('\n--- Step 7: Face Winding Consistency ---');

const winding = checkWindingConsistency(mesh);
console.log(`CCW faces:   ${winding.ccw}`);
console.log(`CW faces:    ${winding.cw}`);
console.log(`Degenerate:  ${winding.degenerate}`);
console.log(`Consistent:  ${winding.consistent ? 'YES (all same direction)' : 'NO (mixed CCW/CW)'}`);

if (!winding.consistent) {
    console.log(`\n>>> WARNING: Mixed winding orders! This will cause faces to appear`);
    console.log(`>>> inside-out in Blender. The mesh may look faceted or have holes.`);
}

// --- Step 8: Validate binary STL output ---
console.log('\n--- Step 8: Validate Extracted Binary STL Output ---');

const outputSTL = toBinarySTL(mesh);
const stlValidation = validateBinarySTL(outputSTL);

console.log(`Header:          "${stlValidation.header}"`);
console.log(`File size:       ${stlValidation.fileSize} bytes`);
console.log(`Declared tris:   ${stlValidation.declaredTriCount}`);
console.log(`Expected size:   ${stlValidation.expectedFileSize} bytes`);
console.log(`Size match:      ${Math.abs(stlValidation.fileSize - stlValidation.expectedFileSize) <= 2 ? 'YES' : 'NO'}`);
console.log(`Valid records:   ${stlValidation.recordsValid} / ${stlValidation.declaredTriCount}`);
console.log(`Invalid records: ${stlValidation.recordsInvalid}`);
console.log(`Overall valid:   ${stlValidation.valid ? 'YES' : 'NO'}`);

if (stlValidation.errors.length > 0) {
    console.log(`Errors:`);
    for (const e of stlValidation.errors) console.log(`  - ${e}`);
}

// Check that each facet record is exactly 50 bytes
console.log(`\nRecord size check:`);
console.log(`  Normal vector:  12 bytes (3 × float32)`);
console.log(`  Vertex 1:       12 bytes (3 × float32)`);
console.log(`  Vertex 2:       12 bytes (3 × float32)`);
console.log(`  Vertex 3:       12 bytes (3 × float32)`);
console.log(`  Attribute:       2 bytes (uint16)`);
console.log(`  Total:          50 bytes per record`);
console.log(`  Formula:        84 + (${stlValidation.declaredTriCount} × 50) = ${stlValidation.expectedFileSize} bytes`);

// --- Step 9: Detailed face-by-face comparison ---
console.log('\n--- Step 9: Face-by-Face Fan Triangulation Details ---');

// Check each face with >3 vertices
const polyFaces = [];
for (let fi = 0; fi < mesh.faces.length; fi++) {
    if (mesh.faces[fi].length > 3) {
        const face = mesh.faces[fi];
        let faceArea = 0;
        const v0 = mesh.vertices[face[0]];
        for (let i = 1; i < face.length - 1; i++) {
            faceArea += triArea(v0, mesh.vertices[face[i]], mesh.vertices[face[i + 1]]);
        }
        polyFaces.push({ fi, vertCount: face.length, fanTris: face.length - 2, area: faceArea });
    }
}

if (polyFaces.length > 0) {
    console.log(`\nFaces requiring fan triangulation (${polyFaces.length} polygon faces):`);
    console.log(`Face# | Verts | Fan Tris | Area (mm²)`);
    console.log(`------|-------|----------|-----------`);
    let totalFanArea = 0;
    for (const pf of polyFaces) {
        console.log(`${String(pf.fi).padStart(5)} | ${String(pf.vertCount).padStart(5)} | ${String(pf.fanTris).padStart(8)} | ${pf.area.toFixed(2).padStart(10)}`);
        totalFanArea += pf.area;
    }
    console.log(`\nTotal polygon face area: ${totalFanArea.toFixed(2)} mm²`);
    console.log(`Total polygon face triangles: ${polyFaces.reduce((s, p) => s + p.fanTris, 0)}`);
} else {
    console.log('No polygon faces (all faces are triangles).');
}

// --- Summary ---
console.log('\n' + '='.repeat(60));
console.log('SUMMARY');
console.log('='.repeat(60));
console.log(`Extracted:  ${mesh.faces.length} faces → ${exMetrics.triCount} tris, area=${exMetrics.totalArea.toFixed(1)} mm²`);
console.log(`Reference:  ${refMetrics.triCount} tris, area=${refMetrics.totalArea.toFixed(1)} mm²`);
console.log(`Triangle diff: ${triDiff >= 0 ? '+' : ''}${triDiff} (${(triRatio * 100).toFixed(1)}%)`);
console.log(`Area diff:     ${(areaDiff >= 0 ? '+' : '')}${areaDiff.toFixed(1)} mm² (${(areaRatio * 100).toFixed(1)}%)`);
console.log(`Winding:       ${winding.consistent ? 'consistent' : 'INCONSISTENT'}`);
console.log(`Shared verts:  ${shared.sharedVerts} shared positions, ${shared.maxSharing} max sharing`);
console.log(`Poly faces:    ${polyFaces.length} faces with >3 vertices`);
console.log(`Fan issues:    ${fanIssues.degenerateTris} degenerate, ${fanIssues.flippedTris} flipped`);
console.log(`Binary STL:    ${stlValidation.valid ? 'VALID' : 'INVALID'}`);
console.log('='.repeat(60));

if (triMismatch) {
    console.log(`\nDIAGNOSIS: Triangle count mismatch is the root cause of faceted appearance.`);
    console.log(`The reference STL has ${refMetrics.triCount} triangles but the extracted mesh produces ${exMetrics.triCount}.`);
    console.log(`This ${triDiff > 0 ? 'EXCESS' : 'DEFICIT'} of ${Math.abs(triDiff)} triangles means the fan triangulation`);
    console.log(`is splitting polygon faces differently than the original SolidWorks tessellation.`);
    console.log(`The extractor's fan triangulation (fan from vertex 0) does NOT preserve`);
    console.log(`the original triangle topology, even though vertex positions match.`);
} else if (areaMismatch) {
    console.log(`\nDIAGNOSIS: Area mismatch suggests face splitting or filtering issues.`);
} else {
    console.log(`\nDIAGNOSIS: Metrics match. The faceted appearance may be due to`);
    console.log(`normal interpolation differences (flat vs smooth shading in Blender).`);
}
