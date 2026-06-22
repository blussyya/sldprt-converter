const fs = require('fs');
const path = require('path');

function parseBinarySTL(filePath) {
  const buf = fs.readFileSync(filePath);
  
  // Header: 80 bytes, then triangle count: uint32 LE at offset 80
  const triangleCount = buf.readUInt32LE(80);
  
  const triangles = [];
  let offset = 84;
  
  for (let i = 0; i < triangleCount; i++) {
    const nx = buf.readFloatLE(offset); offset += 4;
    const ny = buf.readFloatLE(offset); offset += 4;
    const nz = buf.readFloatLE(offset); offset += 4;
    
    const v1x = buf.readFloatLE(offset); offset += 4;
    const v1y = buf.readFloatLE(offset); offset += 4;
    const v1z = buf.readFloatLE(offset); offset += 4;
    
    const v2x = buf.readFloatLE(offset); offset += 4;
    const v2y = buf.readFloatLE(offset); offset += 4;
    const v2z = buf.readFloatLE(offset); offset += 4;
    
    const v3x = buf.readFloatLE(offset); offset += 4;
    const v3y = buf.readFloatLE(offset); offset += 4;
    const v3z = buf.readFloatLE(offset); offset += 4;
    
    const attrByteCount = buf.readUInt16LE(offset); offset += 2;
    
    triangles.push({
      normal: [nx, ny, nz],
      vertices: [
        [v1x, v1y, v1z],
        [v2x, v2y, v2z],
        [v3x, v3y, v3z]
      ],
      attrByteCount
    });
  }
  
  return triangles;
}

function computeTriangleArea(v1, v2, v3) {
  // Cross product magnitude / 2
  const ux = v2[0] - v1[0], uy = v2[1] - v1[1], uz = v2[2] - v1[2];
  const vx = v3[0] - v1[0], vy = v3[1] - v1[1], vz = v3[2] - v1[2];
  const cx = uy * vz - uz * vy;
  const cy = uz * vx - ux * vz;
  const cz = ux * vy - uy * vx;
  return Math.sqrt(cx*cx + cy*cy + cz*cz) / 2;
}

function computeBoundingBox(triangles) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  
  for (const tri of triangles) {
    for (const v of tri.vertices) {
      if (v[0] < minX) minX = v[0];
      if (v[1] < minY) minY = v[1];
      if (v[2] < minZ) minZ = v[2];
      if (v[0] > maxX) maxX = v[0];
      if (v[1] > maxY) maxY = v[1];
      if (v[2] > maxZ) maxZ = v[2];
    }
  }
  
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

function roundKey(v, tol) {
  return Math.round(v / tol);
}

function vertexKey(v, tol) {
  return `${roundKey(v[0], tol)},${roundKey(v[1], tol)},${roundKey(v[2], tol)}`;
}

function edgeKey(a, b, tol) {
  const ka = vertexKey(a, tol);
  const kb = vertexKey(b, tol);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

function analyzeSTL(filePath) {
  const triangles = parseBinarySTL(filePath);
  
  // 1. Triangle count
  const totalTriangles = triangles.length;
  
  // 2. Surface area
  let totalArea = 0;
  for (const tri of triangles) {
    totalArea += computeTriangleArea(tri.vertices[0], tri.vertices[1], tri.vertices[2]);
  }
  
  // 3. Bounding box
  const bbox = computeBoundingBox(triangles);
  
  // 4. Unique vertices (tolerance 0.001mm)
  const vertexSet = new Set();
  for (const tri of triangles) {
    for (const v of tri.vertices) {
      vertexSet.add(vertexKey(v, 0.001));
    }
  }
  const uniqueVertices = vertexSet.size;
  
  // 5. Edge analysis
  const edgeCountMap = new Map();
  for (const tri of triangles) {
    for (let i = 0; i < 3; i++) {
      const a = tri.vertices[i];
      const b = tri.vertices[(i + 1) % 3];
      const key = edgeKey(a, b, 0.001);
      edgeCountMap.set(key, (edgeCountMap.get(key) || 0) + 1);
    }
  }
  
  let sharedEdges = 0;
  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  for (const count of edgeCountMap.values()) {
    if (count === 1) boundaryEdges++;
    else if (count === 2) sharedEdges++;
    else nonManifoldEdges++;
  }
  
  // 6. Normal vector analysis
  const normalCounts = { zero: 0, valid: 0, invalid: 0 };
  let outwardConsistent = 0;
  let inconsistent = 0;
  
  for (const tri of triangles) {
    const n = tri.normal;
    const mag = Math.sqrt(n[0]*n[0] + n[1]*n[1] + n[2]*n[2]);
    if (mag < 0.0001) {
      normalCounts.zero++;
    } else if (Math.abs(mag - 1.0) < 0.01) {
      normalCounts.valid++;
    } else {
      normalCounts.invalid++;
    }
  }
  
  // Check outward consistency: dot(normal, centroid - center) should be > 0 for outward normals
  let cx = 0, cy = 0, cz = 0;
  let totalV = 0;
  for (const tri of triangles) {
    for (const v of tri.vertices) {
      cx += v[0]; cy += v[1]; cz += v[2];
      totalV++;
    }
  }
  cx /= totalV; cy /= totalV; cz /= totalV;
  
  let posDotCount = 0;
  let negDotCount = 0;
  let zeroDotCount = 0;
  
  for (const tri of triangles) {
    // Triangle centroid
    const tcx = (tri.vertices[0][0] + tri.vertices[1][0] + tri.vertices[2][0]) / 3;
    const tcy = (tri.vertices[0][1] + tri.vertices[1][1] + tri.vertices[2][1]) / 3;
    const tcz = (tri.vertices[0][2] + tri.vertices[1][2] + tri.vertices[2][2]) / 3;
    
    // Vector from mesh center to triangle centroid
    const rx = tcx - cx, ry = tcy - cy, rz = tcz - cz;
    
    // Dot with normal
    const dot = tri.normal[0] * rx + tri.normal[1] * ry + tri.normal[2] * rz;
    if (dot > 0.001) posDotCount++;
    else if (dot < -0.001) negDotCount++;
    else zeroDotCount++;
  }
  
  // Determine if normals are outward or inward
  const totalChecked = posDotCount + negDotCount;
  const outwardPct = totalChecked > 0 ? (posDotCount / totalChecked * 100) : 0;
  const inwardPct = totalChecked > 0 ? (negDotCount / totalChecked * 100) : 0;
  
  return {
    filePath: path.basename(filePath),
    totalTriangles,
    totalArea,
    boundingBox: bbox,
    dimensions: {
      x: bbox.maxX - bbox.minX,
      y: bbox.maxY - bbox.minY,
      z: bbox.maxZ - bbox.minZ
    },
    uniqueVertices,
    totalEdges: edgeCountMap.size,
    sharedEdges,
    boundaryEdges,
    nonManifoldEdges,
    normals: {
      ...normalCounts,
      outwardPct: outwardPct.toFixed(2),
      inwardPct: inwardPct.toFixed(2),
      posDotCount,
      negDotCount,
      zeroDotCount
    }
  };
}

function printAnalysis(result) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`FILE: ${result.filePath}`);
  console.log('='.repeat(60));
  console.log(`Total triangles:         ${result.totalTriangles}`);
  console.log(`Total surface area:      ${result.totalArea.toFixed(4)} mm²`);
  console.log(`Bounding box:`);
  console.log(`  X: [${result.boundingBox.minX.toFixed(3)}, ${result.boundingBox.maxX.toFixed(3)}] → ${result.dimensions.x.toFixed(3)} mm`);
  console.log(`  Y: [${result.boundingBox.minY.toFixed(3)}, ${result.boundingBox.maxY.toFixed(3)}] → ${result.dimensions.y.toFixed(3)} mm`);
  console.log(`  Z: [${result.boundingBox.minZ.toFixed(3)}, ${result.boundingBox.maxZ.toFixed(3)}] → ${result.dimensions.z.toFixed(3)} mm`);
  console.log(`Unique vertices (0.001mm): ${result.uniqueVertices}`);
  console.log(`Total unique edges:      ${result.totalEdges}`);
  console.log(`  Shared (2 triangles):  ${result.sharedEdges}`);
  console.log(`  Boundary (1 triangle): ${result.boundaryEdges}`);
  console.log(`  Non-manifold (>2):     ${result.nonManifoldEdges}`);
  console.log(`Normals:`);
  console.log(`  Zero-length:           ${result.normals.zero}`);
  console.log(`  Unit-length (valid):   ${result.normals.valid}`);
  console.log(`  Non-unit:              ${result.normals.invalid}`);
  console.log(`  Outward-facing:        ${result.normals.posDotCount} (${result.normals.outwardPct}%)`);
  console.log(`  Inward-facing:         ${result.normals.negDotCount} (${result.normals.inwardPct}%)`);
  console.log(`  Parallel to centroid:  ${result.normals.zeroDotCount}`);
}

// Run analysis
const bottomPath = String.raw`C:\Users\basha\Desktop\soldiworks research\test files original\usb hub case (ultimate test)\USB hub case BOTTOM ORIGINAL.STL`;
const topPath = String.raw`C:\Users\basha\Desktop\soldiworks research\test files original\usb hub case (ultimate test)\USB hub case TOP ORIGINAL.STL`;

console.log('Analyzing reference STL files...\n');

const bottom = analyzeSTL(bottomPath);
const top = analyzeSTL(topPath);

printAnalysis(bottom);
printAnalysis(top);

// Comparison
console.log(`\n${'='.repeat(60)}`);
console.log('COMPARISON');
console.log('='.repeat(60));
console.log(`                      BOTTOM        TOP           DIFF`);
console.log(`Triangles:            ${bottom.totalTriangles.toString().padStart(10)}    ${top.totalTriangles.toString().padStart(10)}    ${(top.totalTriangles - bottom.totalTriangles).toString().padStart(6)}`);
console.log(`Area (mm²):           ${bottom.totalArea.toFixed(2).padStart(10)}    ${top.totalArea.toFixed(2).padStart(10)}    ${(top.totalArea - bottom.totalArea).toFixed(2).padStart(6)}`);
console.log(`Unique vertices:      ${bottom.uniqueVertices.toString().padStart(10)}    ${top.uniqueVertices.toString().padStart(10)}    ${(top.uniqueVertices - bottom.uniqueVertices).toString().padStart(6)}`);
console.log(`Boundary edges:       ${bottom.boundaryEdges.toString().padStart(10)}    ${top.boundaryEdges.toString().padStart(10)}    ${(top.boundaryEdges - bottom.boundaryEdges).toString().padStart(6)}`);
console.log(`Shared edges:         ${bottom.sharedEdges.toString().padStart(10)}    ${top.sharedEdges.toString().padStart(10)}    ${(top.sharedEdges - bottom.sharedEdges).toString().padStart(6)}`);
console.log(`\nX size:               ${bottom.dimensions.x.toFixed(3).padStart(10)}    ${top.dimensions.x.toFixed(3).padStart(10)}    ${(top.dimensions.x - bottom.dimensions.x).toFixed(3).padStart(6)}`);
console.log(`Y size:               ${bottom.dimensions.y.toFixed(3).padStart(10)}    ${top.dimensions.y.toFixed(3).padStart(10)}    ${(top.dimensions.y - bottom.dimensions.y).toFixed(3).padStart(6)}`);
console.log(`Z size:               ${bottom.dimensions.z.toFixed(3).padStart(10)}    ${top.dimensions.z.toFixed(3).padStart(10)}    ${(top.dimensions.z - bottom.dimensions.z).toFixed(3).padStart(6)}`);
