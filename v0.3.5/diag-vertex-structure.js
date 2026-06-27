const fs = require('fs');
const { extractMesh, setVerbose } = require('./src/sldprt-extractor.js');
const path = require('path');

const f = 'C:\\Users\\basha\\Desktop\\soldiworks research\\test files original\\helical bevel gear.SLDPRT';
const buf = fs.readFileSync(f);
const mesh = extractMesh(buf);

// Analyze the two largest coplanar faces in detail
for (const fi of [28, 27]) {
    const face = mesh.faces[fi];
    const pts = face.map(i => mesh.vertices[i]);
    
    console.log(`\n=== Face #${fi}: ${face.length} verts ===`);
    
    // Project to 2D (face is coplanar)
    // Compute normal
    const v1 = [pts[1][0]-pts[0][0], pts[1][1]-pts[0][1], pts[1][2]-pts[0][2]];
    const v2 = [pts[2][0]-pts[0][0], pts[2][1]-pts[0][1], pts[2][2]-pts[0][2]];
    const normal = [
        v1[1]*v2[2]-v1[2]*v2[1],
        v1[2]*v2[0]-v1[0]*v2[2],
        v1[0]*v2[1]-v1[1]*v2[0]
    ];
    const nlen = Math.sqrt(normal[0]**2+normal[1]**2+normal[2]**2);
    normal[0] /= nlen; normal[1] /= nlen; normal[2] /= nlen;
    
    // Build projection basis
    const ux = Math.abs(normal[0]) < Math.abs(normal[1]) 
        ? [0, -normal[2], normal[1]] 
        : [-normal[2], 0, normal[0]];
    const ulen = Math.sqrt(ux[0]**2+ux[1]**2+ux[2]**2);
    ux[0] /= ulen; ux[1] /= ulen; ux[2] /= ulen;
    const uy = [normal[1]*ux[2]-normal[2]*ux[1], normal[2]*ux[0]-normal[0]*ux[2], normal[0]*ux[1]-normal[1]*ux[0]];
    
    const proj = pts.map(p => [
        p[0]*ux[0]+p[1]*ux[1]+p[2]*ux[2],
        p[0]*uy[0]+p[1]*uy[1]+p[2]*uy[2]
    ]);
    
    // Print first 20 and last 20 projected vertices to see boundary structure
    console.log(`First 20 vertices (projected 2D):`);
    for (let i = 0; i < Math.min(20, proj.length); i++) {
        console.log(`  [${i}] (${proj[i][0].toFixed(4)}, ${proj[i][1].toFixed(4)})`);
    }
    
    console.log(`\nLast 20 vertices (projected 2D):`);
    for (let i = Math.max(0, proj.length-20); i < proj.length; i++) {
        console.log(`  [${i}] (${proj[i][0].toFixed(4)}, ${proj[i][1].toFixed(4)})`);
    }
    
    // Check if vertices form a continuous boundary or have discontinuities
    // Look for large jumps between consecutive vertices
    console.log(`\nLargest gaps between consecutive vertices:`);
    const gaps = [];
    for (let i = 0; i < proj.length; i++) {
        const j = (i + 1) % proj.length;
        const dx = proj[j][0] - proj[i][0];
        const dy = proj[j][1] - proj[i][1];
        const dist = Math.sqrt(dx*dx + dy*dy);
        gaps.push({ i, j, dist });
    }
    gaps.sort((a, b) => b.dist - a.dist);
    for (const g of gaps.slice(0, 10)) {
        console.log(`  [${g.i}]->[${g.j}]: dist=${g.dist.toFixed(4)}`);
    }
    
    // Also check if vertices are arranged in a specific winding order
    // Compute signed area
    let signedArea = 0;
    for (let i = 0; i < proj.length; i++) {
        const j = (i + 1) % proj.length;
        signedArea += proj[i][0] * proj[j][1] - proj[j][0] * proj[i][1];
    }
    signedArea /= 2;
    console.log(`\nSigned area: ${signedArea.toFixed(6)} (CCW if positive)`);
}

// Also analyze dekor
const f2 = 'C:\\Users\\basha\\Desktop\\soldiworks research\\test files original\\dekor.SLDPRT';
const buf2 = fs.readFileSync(f2);
const mesh2 = extractMesh(buf2);

// Analyze face #25 (95 verts, largest coplanar)
const face25 = mesh2.faces[25];
const pts25 = face25.map(i => mesh2.vertices[i]);
console.log(`\n=== Dekor Face #25: ${face25.length} verts ===`);

// Compute normal
const v1_25 = [pts25[1][0]-pts25[0][0], pts25[1][1]-pts25[0][1], pts25[1][2]-pts25[0][2]];
const v2_25 = [pts25[2][0]-pts25[0][0], pts25[2][1]-pts25[0][1], pts25[2][2]-pts25[0][2]];
const normal25 = [
    v1_25[1]*v2_25[2]-v1_25[2]*v2_25[1],
    v1_25[2]*v2_25[0]-v1_25[0]*v2_25[2],
    v1_25[0]*v2_25[1]-v1_25[1]*v2_25[0]
];
const nlen25 = Math.sqrt(normal25[0]**2+normal25[1]**2+normal25[2]**2);
normal25[0] /= nlen25; normal25[1] /= nlen25; normal25[2] /= nlen25;

// Project
const ux25 = Math.abs(normal25[0]) < Math.abs(normal25[1]) 
    ? [0, -normal25[2], normal25[1]] 
    : [-normal25[2], 0, normal25[0]];
const ulen25 = Math.sqrt(ux25[0]**2+ux25[1]**2+ux25[2]**2);
ux25[0] /= ulen25; ux25[1] /= ulen25; ux25[2] /= ulen25;
const uy25 = [normal25[1]*ux25[2]-normal25[2]*ux25[1], normal25[2]*ux25[0]-normal25[0]*ux25[2], normal25[0]*ux25[1]-normal25[1]*ux25[0]];

const proj25 = pts25.map(p => [
    p[0]*ux25[0]+p[1]*ux25[1]+p[2]*ux25[2],
    p[0]*uy25[0]+p[1]*uy25[1]+p[2]*uy25[2]
]);

console.log(`First 20 vertices (projected 2D):`);
for (let i = 0; i < Math.min(20, proj25.length); i++) {
    console.log(`  [${i}] (${proj25[i][0].toFixed(4)}, ${proj25[i][1].toFixed(4)})`);
}

console.log(`\nLast 10 vertices (projected 2D):`);
for (let i = Math.max(0, proj25.length-10); i < proj25.length; i++) {
    console.log(`  [${i}] (${proj25[i][0].toFixed(4)}, ${proj25[i][1].toFixed(4)})`);
}

// Check largest gaps
const gaps25 = [];
for (let i = 0; i < proj25.length; i++) {
    const j = (i + 1) % proj25.length;
    const dx = proj25[j][0] - proj25[i][0];
    const dy = proj25[j][1] - proj25[i][1];
    const dist = Math.sqrt(dx*dx + dy*dy);
    gaps25.push({ i, j, dist });
}
gaps25.sort((a, b) => b.dist - a.dist);
console.log(`\nLargest gaps between consecutive vertices:`);
for (const g of gaps25.slice(0, 10)) {
    console.log(`  [${g.i}]->[${g.j}]: dist=${g.dist.toFixed(4)}`);
}
