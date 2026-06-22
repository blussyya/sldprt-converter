'use strict';
const fs = require('fs');
const path = require('path');

// Test files that succeeded vs failed
const files = [
    'C:\\Users\\basha\\Desktop\\soldiworks research\\test files original\\usb hub case (ultimate test)\\USB hub case BOTTOM.SLDPRT',
    'C:\\Users\\basha\\Desktop\\soldiworks research\\test files original\\usb hub case (ultimate test)\\USB hub case TOP.SLDPRT',
    'C:\\Users\\basha\\Desktop\\soldiworks research\\test files original\\Dekor..SLDPRT',
    'C:\\Users\\basha\\Desktop\\soldiworks research\\test files original\\PTC GE8080-8.SLDPRT',
    'C:\\Users\\basha\\Desktop\\soldiworks research\\test files original\\chainwheel.sldprt',
];

const { extractMesh, parseOLE2, setVerbose } = require('./src/sldprt-extractor');

for (const f of files) {
    console.log(`\n========== ${path.basename(f)} ==========`);
    const buf = fs.readFileSync(f);
    console.log(`File size: ${buf.length} bytes`);
    
    const isOLE2 = buf[0] === 0xD0 && buf[1] === 0xCF && buf[2] === 0x11 && buf[3] === 0xE0;
    const isModern = !isOLE2 && buf.length > 2000 && buf[7] === 4;
    console.log(`Format: ${isOLE2 ? 'OLE2' : isModern ? 'Modern (openswx)' : 'Unknown'}`);
    
    const result = extractMesh(buf);
    console.log(`Errors: ${result.errors.length}`);
    result.errors.forEach(e => console.log(`  ERROR: ${e}`));
    console.log(`Warnings: ${result.warnings.length}`);
    result.warnings.forEach(w => console.log(`  WARN: ${w}`));
    console.log(`Vertices: ${result.vertices.length}`);
    console.log(`Faces: ${result.faces.length}`);
    
    if (result.vertices.length > 0) {
        // Show min/max of raw (unscaled) coordinates
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;
        for (const v of result.vertices) {
            if (v[0] < minX) minX = v[0];
            if (v[0] > maxX) maxX = v[0];
            if (v[1] < minY) minY = v[1];
            if (v[1] > maxY) maxY = v[1];
            if (v[2] < minZ) minZ = v[2];
            if (v[2] > maxZ) maxZ = v[2];
        }
        console.log(`Raw X: ${minX} to ${maxX} (size: ${(maxX-minX).toFixed(4)})`);
        console.log(`Raw Y: ${minY} to ${maxY} (size: ${(maxY-minY).toFixed(4)})`);
        console.log(`Raw Z: ${minZ} to ${maxZ} (size: ${(maxZ-minZ).toFixed(4)})`);
        
        // Show first 5 vertices
        console.log(`\nFirst 5 vertices (raw):`);
        for (let i = 0; i < Math.min(5, result.vertices.length); i++) {
            console.log(`  [${result.vertices[i].map(v => v.toFixed(6)).join(', ')}]`);
        }
        
        // Show first 5 faces
        console.log(`\nFirst 5 faces (vertex count):`);
        for (let i = 0; i < Math.min(5, result.faces.length); i++) {
            console.log(`  Face ${i}: ${result.faces[i].length} vertices: [${result.faces[i].join(', ')}]`);
        }
        
        // Count unique / duplicate vertices
        const seen = new Set();
        let dupCount = 0;
        for (const v of result.vertices) {
            const key = v.map(x => x.toFixed(4)).join(',');
            if (seen.has(key)) dupCount++;
            seen.add(key);
        }
        console.log(`\nUnique vertices: ${seen.size}, Duplicates: ${dupCount}`);
        
        // Show part dimensions (already scaled to mm in result)
        if (result.partDimensions) {
            const d = result.partDimensions;
            console.log(`\nScaled dimensions (mm): ${d.x.size.toFixed(2)} x ${d.y.size.toFixed(2)} x ${d.z.size.toFixed(2)}`);
        }
    }
}
