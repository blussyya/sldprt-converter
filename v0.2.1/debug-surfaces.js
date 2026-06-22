'use strict';
const fs = require('fs');
const path = require('path');

const { extractMesh, setVerbose } = require('./src/sldprt-extractor');
setVerbose(false);

const files = [
    'usb hub case (ultimate test)\\USB hub case BOTTOM.SLDPRT',
    'usb hub case (ultimate test)\\USB hub case TOP.SLDPRT',
    'PTC GE8080-8.SLDPRT',
    'Dekor..SLDPRT',
];

for (const relFile of files) {
    const filePath = path.join('C:\\Users\\basha\\Desktop\\soldiworks research\\test files original', relFile);
    const fname = path.basename(filePath);
    console.log(`\n========== ${fname} ==========`);
    
    const buf = fs.readFileSync(filePath);
    const result = extractMesh(buf);
    
    console.log(`Vertices: ${result.vertices.length}, Faces: ${result.faces.length}`);
    if (result.vertices.length === 0) continue;
    
    // Analyze per-vertex stats
    let badVerts = 0;
    const goodVerts = [];
    const badIndices = [];
    
    for (let i = 0; i < result.vertices.length; i++) {
        const v = result.vertices[i];
        const maxAbs = Math.max(Math.abs(v[0]), Math.abs(v[1]), Math.abs(v[2]));
        if (maxAbs > 100) {  // If any coordinate is > 100 (meters), it's probably bad
            badVerts++;
            badIndices.push(i);
        } else {
            goodVerts.push(v);
        }
    }
    
    console.log(`Bad vertices (coord > 100): ${badVerts}`);
    if (badIndices.length > 0) {
        console.log(`First 10 bad indices: ${badIndices.slice(0, 10).join(', ')}`);
    }
    
    // Check face usage
    let facesWithBad = 0;
    let facesAllGood = 0;
    for (const face of result.faces) {
        const hasBad = face.some(idx => badIndices.includes(idx));
        if (hasBad) facesWithBad++;
        else facesAllGood++;
    }
    console.log(`Faces with bad vertices: ${facesWithBad}, All good: ${facesAllGood}`);
    
    // Compute bounds from only good vertices
    if (goodVerts.length > 0) {
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;
        for (const v of goodVerts) {
            if (v[0] < minX) minX = v[0];
            if (v[0] > maxX) maxX = v[0];
            if (v[1] < minY) minY = v[1];
            if (v[1] > maxY) maxY = v[1];
            if (v[2] < minZ) minZ = v[2];
            if (v[2] > maxZ) maxZ = v[2];
        }
        console.log(`Good verts bounds (meters): X:[${minX.toFixed(4)}, ${maxX.toFixed(4)}] Y:[${minY.toFixed(4)}, ${maxY.toFixed(4)}] Z:[${minZ.toFixed(4)}, ${maxZ.toFixed(4)}]`);
        console.log(`Good verts size (mm): ${((maxX-minX)*1000).toFixed(1)} x ${((maxY-minY)*1000).toFixed(1)} x ${((maxZ-minZ)*1000).toFixed(1)}`);
    }
    
    // Analyze the first surface's vertex range
    console.log(`\nFirst 8 vertices:`);
    for (let i = 0; i < Math.min(8, result.vertices.length); i++) {
        const v = result.vertices[i];
        const marker = badIndices.includes(i) ? ' <-- BAD' : '';
        console.log(`  [${v.map(x => x.toFixed(6)).join(', ')}]${marker}`);
    }
    
    // Analyze last 5 vertices
    if (result.vertices.length > 8) {
        console.log(`\nLast 5 vertices:`);
        for (let i = Math.max(0, result.vertices.length - 5); i < result.vertices.length; i++) {
            const v = result.vertices[i];
            const marker = badIndices.includes(i) ? ' <-- BAD' : '';
            console.log(`  [${v.map(x => x.toFixed(6)).join(', ')}]${marker}`);
        }
    }
    
    // Face sizes
    const faceSizes = result.faces.map(f => f.length);
    const sizeCounts = {};
    for (const s of faceSizes) {
        sizeCounts[s] = (sizeCounts[s] || 0) + 1;
    }
    console.log(`\nFace vertex counts: ${Object.entries(sizeCounts).sort((a,b)=>a[0]-b[0]).map(([k,v]) => `${k} verts: ${v} faces`).join(', ')}`);
}
