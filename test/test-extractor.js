#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { extractMesh, toOBJ, toSTL } = require('./slprd-extractor.js');

const FILES = [
    'PTC GE8080-8.SLDPRT',
    'distributor main boss rev a.SLDPRT',
    'Helical Bevel Gear.SLDPRT',
    'Pocket Wheel.SLDPRT',
    'Dekor..SLDPRT',
];

const researchDir = process.env.SLDPRT_TEST_DIR || path.join(__dirname, '..', 'test-files');

for (const file of FILES) {
    const fp = path.join(researchDir, file);
    if (!fs.existsSync(fp)) { console.log(`Not found: ${file}`); continue; }
    
    console.log(`\n${'#'.repeat(60)}\n# ${file}\n${'#'.repeat(60)}`);
    
    const buf = fs.readFileSync(fp);
    const result = extractMesh(buf);
    
    console.log('Warnings:', result.warnings);
    if (result.errors.length > 0) console.log('Errors:', result.errors);
    
    if (result.vertices.length > 0) {
        // Calculate bounds
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;
        for (const [x, y, z] of result.vertices) {
            minX = Math.min(minX, x); maxX = Math.max(maxX, x);
            minY = Math.min(minY, y); maxY = Math.max(maxY, y);
            minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
        }
        console.log(`Bounds: [${minX.toFixed(4)}-${maxX.toFixed(4)}] x [${minY.toFixed(4)}-${maxY.toFixed(4)}] x [${minZ.toFixed(4)}-${maxZ.toFixed(4)}]`);
        console.log(`Size: ${(maxX-minX).toFixed(4)} x ${(maxY-minY).toFixed(4)} x ${(maxZ-minZ).toFixed(4)}`);
        
        // Save OBJ
        const obj = toOBJ(result);
        const outName = file.replace(/\.SLDPRT$/i, '') + '.obj';
        fs.writeFileSync(path.join(researchDir, outName), obj);
        console.log(`Saved: ${outName}`);
    } else {
        console.log('No vertices extracted');
    }
}
