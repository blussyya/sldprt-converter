#!/usr/bin/env node
/**
 * SLDPRT Mesh Converter CLI
 * Converts SolidWorks .sldprt files to OBJ, STL, or binary STL
 *
 * Usage:
 *   node sldprt-cli.js input.sldprt                    → input.obj
 *   node sldprt-cli.js input.sldprt -o output.obj      → output.obj
 *   node sldprt-cli.js input.sldprt -f stl             → input.stl
 *   node sldprt-cli.js input.sldprt -f binary-stl      → input.stl (binary)
 *   node sldprt-cli.js input.sldprt --scale 1          → OBJ in meters (default: mm)
 *   node sldprt-cli.js input.sldprt --info             → info only, no output
 *   node sldprt-cli.js file1.sldprt file2.sldprt       → batch convert
 */

const fs = require('fs');
const path = require('path');
const { extractMesh, toOBJ, toSTL, toBinarySTL, setVerbose } = require('./sldprt-extractor.js');

function usage() {
    console.log(`SLDPRT Mesh Converter — extracts 3D mesh from SolidWorks .sldprt files

Usage:
  node sldprt-cli.js <input.sldprt> [options]

Options:
  -o, --output <path>   Output file path (default: same name as input)
  -f, --format <fmt>    Output format: obj (default), stl, binary-stl
  --scale <factor>      Scale factor (default: 1000, SolidWorks stores meters, output in mm)
  --info                Show mesh info without writing output
  -h, --help            Show this help
  --verbose             Show detailed parsing logs

Examples:
  node sldprt-cli.js doneConsole.sldprt              # outputs doneConsole.obj (mm)
  node sldprt-cli.js doneConsole.sldprt -f stl       # outputs doneConsole.stl
  node sldprt-cli.js doneConsole.sldprt --scale 1    # output in meters
  node sldprt-cli.js *.sldprt --info                  # batch info
  node sldprt-cli.js part.sldprt --verbose`);
}

function parseArgs(args) {
    const opts = {
        files: [],
        output: null,
        format: 'obj',
        scale: 1000,
        info: false,
        verbose: false
    };

    let i = 0;
    while (i < args.length) {
        const a = args[i];
        if (a === '-h' || a === '--help') { opts.help = true; }
        else if (a === '-o' || a === '--output') { opts.output = args[++i]; }
        else if (a === '-f' || a === '--format') { opts.format = args[++i]; }
        else if (a === '--scale') {
            opts.scale = parseFloat(args[++i]);
            if (!isFinite(opts.scale) || opts.scale === 0) {
                console.error('Invalid scale value');
                process.exit(1);
            }
        }
        else if (a === '--info') { opts.info = true; }
        else if (a === '--verbose') { opts.verbose = true; }
        else if (!a.startsWith('-')) { opts.files.push(a); }
        else { console.error(`Unknown option: ${a}`); process.exit(1); }
        i++;
    }
    return opts;
}

function processFile(filePath, opts) {
    const absPath = path.resolve(filePath);
    if (!fs.existsSync(absPath)) {
        console.error(`File not found: ${absPath}`);
        return false;
    }

    console.log(`Processing: ${filePath}`);

    setVerbose(opts.verbose);
    const buf = fs.readFileSync(absPath);
    const mesh = extractMesh(buf);

    if (mesh.errors.length > 0) {
        console.error(`  Errors:`);
        mesh.errors.forEach(e => console.error(`    - ${e}`));
        return false;
    }

    if (mesh.warnings.length > 0 && !opts.info) {
        mesh.warnings.forEach(w => console.log(`  Warning: ${w}`));
    }

    if (mesh.vertices.length === 0) {
        console.log(`  No mesh data extracted.`);
        if (!opts.info) {
            console.log(`  Hint: This file may use compressed DisplayLists__Zip format.`);
            console.log(`  Only uncompressed DisplayLists streams are currently supported.`);
        }
        return false;
    }

    // Apply scale
    if (opts.scale !== 1) {
        for (const v of mesh.vertices) {
            v[0] *= opts.scale;
            v[1] *= opts.scale;
            v[2] *= opts.scale;
        }
        if (mesh.partDimensions) {
            mesh.partDimensions.x.size *= opts.scale;
            mesh.partDimensions.y.size *= opts.scale;
            mesh.partDimensions.z.size *= opts.scale;
        }
    }

    const dims = mesh.partDimensions;
    console.log(`  Vertices: ${mesh.vertices.length}`);
    console.log(`  Faces: ${mesh.faces.length} (${mesh.faces.reduce((s, f) => s + Math.max(0, f.length - 2), 0)} triangles)`);
    if (dims) {
        console.log(`  Dimensions: ${dims.x.size.toFixed(2)} × ${dims.y.size.toFixed(2)} × ${dims.z.size.toFixed(2)}${opts.scale !== 1 ? ' (scaled)' : ''}`);
    }

    if (opts.info) return true;

    const baseName = path.basename(filePath, path.extname(filePath));
    const ext = opts.format === 'binary-stl' ? '.stl' : '.' + opts.format.replace('binary-', '');

    let outPath;
    if (opts.output) {
        const outStat = fs.existsSync(opts.output) ? fs.statSync(opts.output) : null;
        if (outStat && outStat.isDirectory()) {
            outPath = path.join(opts.output, baseName + ext);
        } else if (opts.files.length === 1) {
            outPath = opts.output;
        } else {
            outPath = path.join(opts.output, baseName + ext);
        }
    } else {
        outPath = path.join(path.dirname(absPath), baseName + ext);
    }

    let output;
    if (opts.format === 'obj') {
        output = toOBJ(mesh);
    } else if (opts.format === 'stl') {
        output = toSTL(mesh);
    } else if (opts.format === 'binary-stl') {
        output = toBinarySTL(mesh);
    } else {
        console.error(`Unknown format: ${opts.format}`);
        return false;
    }

    fs.writeFileSync(outPath, output);
    console.log(`  Written: ${outPath}`);
    return true;
}

const args = process.argv.slice(2);
const opts = parseArgs(args);

if (opts.help || opts.files.length === 0) {
    usage();
    process.exit(opts.help ? 0 : 1);
}

let success = 0;
let failed = 0;

for (const file of opts.files) {
    if (processFile(file, opts)) {
        success++;
    } else {
        failed++;
    }
}

if (opts.files.length > 1) {
    console.log(`\nDone: ${success} converted, ${failed} failed.`);
}

process.exit(failed > 0 ? 1 : 0);
