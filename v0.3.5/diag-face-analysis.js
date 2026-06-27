const fs = require('fs');
const { extractMesh, setVerbose } = require('./src/sldprt-extractor.js');
const path = require('path');

const files = [
    'C:\\Users\\basha\\Desktop\\soldiworks research\\test files original\\dekor.SLDPRT',
    'C:\\Users\\basha\\Desktop\\soldiworks research\\test files original\\helical bevel gear.SLDPRT'
];

for (const f of files) {
    console.log(`\n=== ${path.basename(f)} ===`);
    const buf = fs.readFileSync(f);
    const mesh = extractMesh(buf);
    
    console.log(`Vertices: ${mesh.vertices.length}, Faces: ${mesh.faces.length}`);
    console.log(`Warnings: ${mesh.warnings.join(', ')}`);
    
    // Analyze face coplanarity and vertex counts
    const faceSizes = mesh.faces.map(f => f.length);
    console.log(`Face sizes: min=${Math.min(...faceSizes)}, max=${Math.max(...faceSizes)}`);
    
    // Check coplanarity for each face
    let coplanarCount = 0;
    let nonPlanarCount = 0;
    const coplanarFaces = [];
    
    for (let fi = 0; fi < mesh.faces.length; fi++) {
        const face = mesh.faces[fi];
        if (face.length < 4) { coplanarCount++; continue; }
        
        const pts = face.map(i => mesh.vertices[i]);
        
        // Compute normal from first 3 vertices
        const v1 = [pts[1][0]-pts[0][0], pts[1][1]-pts[0][1], pts[1][2]-pts[0][2]];
        const v2 = [pts[2][0]-pts[0][0], pts[2][1]-pts[0][1], pts[2][2]-pts[0][2]];
        const normal = [
            v1[1]*v2[2]-v1[2]*v2[1],
            v1[2]*v2[0]-v1[0]*v2[2],
            v1[0]*v2[1]-v1[1]*v2[0]
        ];
        const nlen = Math.sqrt(normal[0]**2+normal[1]**2+normal[2]**2);
        if (nlen < 1e-12) { nonPlanarCount++; continue; }
        normal[0] /= nlen; normal[1] /= nlen; normal[2] /= nlen;
        
        // Check if all vertices lie on the same plane
        let maxDist = 0;
        for (const p of pts) {
            const d = Math.abs((p[0]-pts[0][0])*normal[0] + (p[1]-pts[0][1])*normal[1] + (p[2]-pts[0][2])*normal[2]);
            if (d > maxDist) maxDist = d;
        }
        
        if (maxDist < 0.01) {
            coplanarCount++;
            coplanarFaces.push({ fi, n: face.length, maxDist: maxDist.toFixed(6) });
        } else {
            nonPlanarCount++;
        }
    }
    
    console.log(`Coplanar faces: ${coplanarCount}, Non-planar: ${nonPlanarCount}`);
    
    // Show largest coplanar faces (potential holes)
    coplanarFaces.sort((a, b) => b.n - a.n);
    console.log(`\nLargest coplanar faces (top 10):`);
    for (const f of coplanarFaces.slice(0, 10)) {
        console.log(`  Face #${f.fi}: ${f.n} verts, maxDist=${f.maxDist}`);
    }
    
    // Analyze vertex positions for the largest faces to detect potential holes
    console.log(`\nBBox analysis for largest coplanar faces:`);
    for (const cf of coplanarFaces.slice(0, 5)) {
        const face = mesh.faces[cf.fi];
        const pts = face.map(i => mesh.vertices[i]);
        
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const p of pts) {
            if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
            if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
        }
        
        // Check for vertex clustering (potential holes)
        // Simple approach: check if there are vertices far from the centroid
        let cx = 0, cy = 0;
        for (const p of pts) { cx += p[0]; cy += p[1]; }
        cx /= pts.length; cy /= pts.length;
        
        let maxDistFromCenter = 0;
        for (const p of pts) {
            const d = Math.sqrt((p[0]-cx)**2 + (p[1]-cy)**2);
            if (d > maxDistFromCenter) maxDistFromCenter = d;
        }
        
        console.log(`  Face #${cf.fi}: ${cf.n} verts, X=[${minX.toFixed(2)},${maxX.toFixed(2)}], Y=[${minY.toFixed(2)},${maxY.toFixed(2)}], centerDist=${maxDistFromCenter.toFixed(2)}`);
    }
}
