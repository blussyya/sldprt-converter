const fs = require('fs');
const zlib = require('zlib');

const GEAR = 'C:\\Users\\Basha\\Desktop\\soldiworks research\\test files original\\Helical Bevel Gear.SLDPRT';

function rolByte(b, s) { s &= 7; return s === 0 ? b : ((b << s) | (b >>> (8 - s))) & 0xFF; }
function findAll(buf, pat) {
    const r = [];
    for (let i = 0; i <= buf.length - pat.length; i++) {
        let ok = true;
        for (let j = 0; j < pat.length; j++) if (buf[i+j] !== pat[j]) { ok = false; break; }
        if (ok) r.push(i);
    }
    return r;
}

const buf = fs.readFileSync(GEAR);
const key = buf[7];
const marker = Buffer.from([0x14, 0x00, 0x06, 0x00, 0x08, 0x00]);
let dlData = null;
for (const mp of findAll(buf, marker)) {
    const si = mp - 4;
    if (si < 0 || si + 0x1E > buf.length) continue;
    const csz = buf.readUInt32LE(si + 0x12);
    const nsz = buf.readUInt32LE(si + 0x1A);
    if (nsz > 1024 || csz > 50e6) continue;
    const nameStart = si + 0x1E;
    const nameEnd = nameStart + nsz;
    if (nameEnd > buf.length) continue;
    let name = '';
    for (let i = 0; i < nsz; i++) name += String.fromCharCode(rolByte(buf[nameStart + i], key));
    if (!name.toLowerCase().includes('displaylist')) continue;
    const dataStart = nameEnd;
    const dataEnd = dataStart + csz;
    if (dataEnd > buf.length) continue;
    const f1 = buf.readUInt32LE(si + 0x0E);
    if (f1 >= 65536 && csz > 0) {
        try {
            const d = Buffer.from(zlib.inflateRawSync(buf.subarray(dataStart, dataEnd)));
            if (d.length > 100 && d.readUInt32LE(0) === 1) { dlData = d; break; }
        } catch(e) {}
    }
}
if (!dlData) { console.error('No DisplayLists'); process.exit(1); }

const d = dlData;

// Find 0x4D32 marker
let mPos = -1;
for (let i = d.length - 200; i < d.length - 2; i++) {
    if (i >= 0 && d.readUInt16LE(i) === 0x4D32) { mPos = i; break; }
}
const headerEnd = mPos + 18;

// Find ALL face blocks
const faces = [];
for (let i = headerEnd; i < d.length - 20; i++) {
    if (d.readUInt32LE(i) === 12 && d.readUInt32LE(i + 4) === 100) {
        const ft = d.readUInt32LE(i + 8);
        const vc = d.readUInt32LE(i + 12);
        if (ft === 2 && vc >= 3 && vc < 5000 && i + 16 + vc * 12 + 16 + vc * 12 + 20 < d.length) {
            let valid = true;
            for (let v = 0; v < Math.min(3, vc); v++) {
                const x = d.readFloatLE(i + 16 + v * 12);
                if (!isFinite(x) || Math.abs(x) > 10000) { valid = false; break; }
            }
            if (valid) {
                const ec = d.readUInt32LE(i - 4);
                faces.push({ pos: i, ec, vc });
            }
        }
    }
}
console.error('Found', faces.length, 'faces');

// Compute Block 2 loop counts for each face to find multi-loop ones
const faceInfo = [];
for (let fi = 0; fi < faces.length; fi++) {
    const f = faces[fi];
    const vertStart = f.pos + 16;
    const vertEnd = vertStart + f.vc * 12;
    const normStart = vertEnd + 16;
    const normEnd = normStart + f.vc * 12;
    const topoStart = normEnd;

    let block1N = 0, block2N = 0, block2Vals = [], totalLoops = 0;
    if (topoStart + 16 <= d.length && d.readUInt32LE(topoStart) === 4 && d.readUInt32LE(topoStart+4) === 8 && d.readUInt32LE(topoStart+8) === 2) {
        block1N = d.readUInt32LE(topoStart + 12);
        const b2Start = topoStart + (block1N + 4) * 4;
        if (b2Start + 16 <= d.length && d.readUInt32LE(b2Start) === 4 && d.readUInt32LE(b2Start+4) === 8 && d.readUInt32LE(b2Start+8) === 2) {
            block2N = d.readUInt32LE(b2Start + 12);
            for (let t = 0; t < block2N; t++) {
                const raw = d.readUInt32LE(b2Start + 16 + t * 4);
                const vc = (raw + 2) >> 1;
                block2Vals.push({ raw, vc });
                totalLoops += vc >= 3 ? 1 : 0;
            }
        }
    }
    faceInfo.push({ ...f, fi, block1N, block2N, block2Vals, totalLoops });
}

// Find best complex face (most loops, vc >= 10)
const complexFaces = faceInfo.filter(f => f.totalLoops >= 3 && f.vc >= 10).sort((a, b) => b.totalLoops - a.totalLoops);
// Find best simple face (1 loop, vc >= 4, vc <= 20)
const simpleFaces = faceInfo.filter(f => f.totalLoops <= 1 && f.vc >= 4 && f.vc <= 20).sort((a, b) => a.vc - b.vc);

const COMPLEX = complexFaces[0];
const SIMPLE = simpleFaces[0];

console.error('Complex face: #' + COMPLEX.fi + ' vc=' + COMPLEX.vc + ' loops=' + COMPLEX.totalLoops + ' ec=' + COMPLEX.ec);
console.error('Simple face: #' + SIMPLE.fi + ' vc=' + SIMPLE.vc + ' loops=' + SIMPLE.totalLoops + ' ec=' + SIMPLE.ec);

function analyzeRegion(name, startByte, endByte) {
    const size = endByte - startByte;
    if (size <= 0) return null;
    const vals = [];
    const bytes = [];
    for (let i = startByte; i < endByte; i++) bytes.push(d[i]);
    for (let i = startByte; i + 4 <= endByte; i += 4) vals.push(d.readUInt32LE(i));

    const zeroCount = bytes.filter(b => b === 0).length;
    const oneCount = vals.filter(v => v === 1).length;
    const smallCount = vals.filter(v => v > 1 && v < 256).length;
    const mediumCount = vals.filter(v => v >= 256 && v < 65536).length;
    const largeCount = vals.filter(v => v >= 65536).length;

    let floatPlausible = 0;
    for (let i = startByte; i + 4 <= endByte; i += 4) {
        const f = d.readFloatLE(i);
        if (isFinite(f) && Math.abs(f) < 10000 && Math.abs(f) > 0.001) floatPlausible++;
    }

    // Entropy
    const freq = new Uint32Array(256);
    for (const b of bytes) freq[b]++;
    let entropy = 0;
    for (let i = 0; i < 256; i++) {
        if (freq[i] > 0) {
            const p = freq[i] / bytes.length;
            entropy -= p * Math.log2(p);
        }
    }

    // Repeated sequences (4-byte windows)
    const windows = new Map();
    for (let i = startByte; i + 16 <= endByte; i += 4) {
        const w = d.readUInt32LE(i) + '|' + d.readUInt32LE(i+4) + '|' + d.readUInt32LE(i+8) + '|' + d.readUInt32LE(i+12);
        windows.set(w, (windows.get(w) || 0) + 1);
    }
    const repeated = [...windows.entries()].filter(([k, v]) => v > 1).sort((a, b) => b[1] - a[1]).slice(0, 5);

    // Check alignment
    const u32Count = Math.floor(size / 4);

    return {
        name, startByte, endByte, size,
        u32Count,
        zeroPercent: (zeroCount / bytes.length * 100).toFixed(1),
        onePercent: (oneCount / vals.length * 100).toFixed(1),
        smallPercent: (smallCount / vals.length * 100).toFixed(1),
        mediumPercent: (mediumCount / vals.length * 100).toFixed(1),
        largePercent: (largeCount / vals.length * 100).toFixed(1),
        floatPlausiblePercent: (floatPlausible / vals.length * 100).toFixed(1),
        entropy: entropy.toFixed(2),
        repeated
    };
}

function dumpFace(label, face) {
    const f = face;
    const vertStart = f.pos + 16;
    const vertEnd = vertStart + f.vc * 12;
    const gapStart = vertEnd;
    const gapEnd = vertEnd + 16;
    const normStart = gapEnd;
    const normEnd = normStart + f.vc * 12;
    const topoStart = normEnd;

    // Find end of Block 2
    let block2End = topoStart;
    if (topoStart + 16 <= d.length && d.readUInt32LE(topoStart) === 4 && d.readUInt32LE(topoStart+4) === 8 && d.readUInt32LE(topoStart+8) === 2) {
        const b1N = d.readUInt32LE(topoStart + 12);
        const b2Start = topoStart + (b1N + 4) * 4;
        if (b2Start + 16 <= d.length && d.readUInt32LE(b2Start) === 4 && d.readUInt32LE(b2Start+4) === 8 && d.readUInt32LE(b2Start+8) === 2) {
            const b2N = d.readUInt32LE(b2Start + 12);
            block2End = b2Start + (b2N + 4) * 4;
        }
    }

    console.log('\n' + '='.repeat(80));
    console.log(label + ': Face #' + f.fi + ' (ec=' + f.ec + ', vc=' + f.vc + ', loops=' + f.totalLoops + ')');
    console.log('='.repeat(80));

    // 1. Layout map
    console.log('\n--- 1. LAYOUT MAP ---');
    console.log('+' + hex4(f.pos - f.pos) + '  [edgeCount u32]           = ' + f.ec);
    console.log('+' + hex4(f.pos + 4 - f.pos) + '  face marker [12,100,2,vc] = [' + d.readUInt32LE(f.pos+4) + ', ' + d.readUInt32LE(f.pos+8) + ', ' + d.readUInt32LE(f.pos+12) + ', ' + d.readUInt32LE(f.pos+16) + ']');
    console.log('+' + hex4(vertStart - f.pos) + '  vertex array              = ' + f.vc + ' × float32[3] = ' + (f.vc * 12) + ' bytes');
    console.log('+' + hex4(gapStart - f.pos) + '  gap marker                = 16 bytes');
    console.log('+' + hex4(normStart - f.pos) + '  normals                   = ' + f.vc + ' × float32[3] = ' + (f.vc * 12) + ' bytes');
    console.log('+' + hex4(topoStart - f.pos) + '  topology start            = Block 1');
    console.log('+' + hex4(block2End - f.pos) + '  end of Block 2');
    console.log('  TOTAL region size: ' + (block2End - f.pos) + ' bytes');

    // 2. Unknown region characterization
    console.log('\n--- 2. UNKNOWN-REGION CHARACTERIZATION ---');

    // Gap marker
    const gap = analyzeRegion('gap marker', gapStart, gapEnd);
    printAnalysis(gap);

    // Region between gap end and topo (this IS the normals region, but let's confirm)
    const norm = analyzeRegion('normals', normStart, normEnd);
    printAnalysis(norm);

    // Block 1 header (first 16 bytes)
    if (topoStart + 16 <= d.length) {
        const b1Header = analyzeRegion('Block1 header', topoStart, topoStart + 16);
        printAnalysis(b1Header);
    }

    // Block 1 body (after header, before Block 2)
    const b1BodyStart = topoStart + 16;
    const b1BodyEnd = topoStart + (f.block1N + 4) * 4;
    if (b1BodyEnd > b1BodyStart && b1BodyEnd <= d.length) {
        const b1Body = analyzeRegion('Block1 body', b1BodyStart, b1BodyEnd);
        printAnalysis(b1Body);

        // Dump first 40 u32s of Block 1 body with annotations
        console.log('  Block1 first 40 u32s:');
        for (let i = 0; i < Math.min(40, f.block1N); i++) {
            const v = d.readUInt32LE(b1BodyStart + i * 4);
            const note = v === 0 ? 'ZERO' : v === 1 ? 'ONE' : v < 256 ? 'small' : v < 65536 ? 'medium' : 'LARGE';
            console.log('    [' + i + '] +' + hex4((b1BodyStart - f.pos) + i * 4) + ' = ' + pad8(v) + ' (' + note + ')');
        }
    }

    // Block 2
    const b2Start = b1BodyEnd;
    if (b2Start + 16 <= d.length && d.readUInt32LE(b2Start) === 4) {
        const b2N = d.readUInt32LE(b2Start + 12);
        const b2ValsStart = b2Start + 16;
        const b2ValsEnd = b2ValsStart + b2N * 4;
        const b2 = analyzeRegion('Block2 payload', b2ValsStart, b2ValsEnd);
        printAnalysis(b2);

        // Dump all Block 2 values
        console.log('  Block2 all ' + b2N + ' values:');
        const rawVals = [];
        const vcVals = [];
        for (let i = 0; i < b2N; i++) {
            const raw = d.readUInt32LE(b2ValsStart + i * 4);
            const vc = (raw + 2) >> 1;
            rawVals.push(raw);
            vcVals.push(vc);
            console.log('    [' + i + '] raw=' + raw + ' vc=' + vc);
        }
        console.log('  Block2 vc sum=' + vcVals.reduce((a, b) => a + b, 0) + ' (should=' + f.vc + ')');
    }

    // 3. Cross-reference analysis
    console.log('\n--- 3. CROSS-REFERENCE ANALYSIS ---');

    // Check unknown region between normals end and Block 1 header
    // (We already know this IS the Block 1 header, but let's check if there's padding)
    const gapSize = topoStart - normEnd;
    console.log('  Normals end to Block1 start gap: ' + gapSize + ' bytes (' + (gapSize / 4) + ' u32s)');

    // For Block 1 body values, check cross-references
    if (b1BodyEnd > b1BodyStart) {
        const vals = [];
        for (let i = b1BodyStart; i < b1BodyEnd; i += 4) vals.push(d.readUInt32LE(i));

        // Are any values equal to vertex indices (0..vc-1)?
        let localVertCount = 0;
        for (const v of vals) if (v >= 0 && v < f.vc) localVertCount++;
        console.log('  Block1 values that are local vertex indices (0..' + (f.vc-1) + '): ' + localVertCount + ' / ' + vals.length);

        // Are any values equal to global vertex range?
        let globalRange = 0;
        for (const v of vals) if (v >= f.vc && v < 10000) globalRange++;
        console.log('  Block1 values in global range (' + f.vc + '-9999): ' + globalRange + ' / ' + vals.length);

        // Are any values found in Block 2?
        const b2Set = new Set();
        if (b2Start + 16 <= d.length) {
            const b2N = d.readUInt32LE(b2Start + 12);
            const b2VS = b2Start + 16;
            for (let i = 0; i < b2N; i++) b2Set.add(d.readUInt32LE(b2VS + i * 4));
        }
        let inB2 = 0;
        for (const v of vals) if (b2Set.has(v)) inB2++;
        console.log('  Block1 values found in Block 2: ' + inB2 + ' / ' + vals.length);

        // Frequency of each unique value in Block 1
        const freq = new Map();
        for (const v of vals) freq.set(v, (freq.get(v) || 0) + 1);
        const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
        console.log('  Block1 top 15 values by frequency:');
        for (const [val, count] of sorted) {
            console.log('    ' + pad8(val) + ' × ' + count);
        }
    }

    // 4. Block boundary analysis
    console.log('\n--- 4. BLOCK BOUNDARY ANALYSIS ---');

    // Why does Block 1 start at topoStart?
    console.log('  Normals end at: ' + normEnd + ' (= vertEnd + 16 + vc*12 = ' + vertEnd + ' + 16 + ' + (f.vc * 12) + ')');
    console.log('  Block 1 starts at: ' + topoStart);
    console.log('  Gap between normals end and Block 1 start: ' + (topoStart - normEnd) + ' bytes');

    // Verify the 16-byte gap marker
    console.log('\n  Gap marker (16 bytes at vertEnd):');
    for (let i = 0; i < 16; i += 4) {
        const v = d.readUInt32LE(vertEnd + i);
        console.log('    +' + hex4(i) + ' = ' + v);
    }

    // Verify Block 1 header
    console.log('\n  Block 1 header (16 bytes at topoStart):');
    for (let i = 0; i < 16; i += 4) {
        const v = d.readUInt32LE(topoStart + i);
        console.log('    +' + hex4(i) + ' = ' + v);
    }

    // Why does Block 2 start where it does?
    const b1N = d.readUInt32LE(topoStart + 12);
    const computedB2Start = topoStart + (b1N + 4) * 4;
    console.log('\n  Block 1 N = ' + b1N);
    console.log('  Block 1 total size = (N + 4) × 4 = ' + ((b1N + 4) * 4) + ' bytes');
    console.log('  Computed Block 2 start = topoStart + ' + ((b1N + 4) * 4) + ' = ' + computedB2Start);
    console.log('  Actual Block 2 start = ' + b2Start);
    console.log('  Match: ' + (computedB2Start === b2Start ? 'YES' : 'NO'));

    // Block 2 header
    if (b2Start + 16 <= d.length) {
        console.log('\n  Block 2 header (16 bytes at b2Start):');
        for (let i = 0; i < 16; i += 4) {
            const v = d.readUInt32LE(b2Start + i);
            console.log('    +' + hex4(i) + ' = ' + v);
        }
        const b2N = d.readUInt32LE(b2Start + 12);
        const computedEnd = b2Start + (b2N + 4) * 4;
        console.log('  Block 2 N = ' + b2N);
        console.log('  Block 2 total size = (N + 4) × 4 = ' + ((b2N + 4) * 4) + ' bytes');
        console.log('  Computed end = ' + computedEnd);
        if (computedEnd + 4 <= d.length) {
            const afterB2 = d.readUInt32LE(computedEnd);
            console.log('  First u32 after Block 2 = ' + afterB2 + ' (hex: 0x' + afterB2.toString(16) + ')');
            // Check if it's another [4,8,2,...] block
            if (computedEnd + 16 <= d.length) {
                const v0 = d.readUInt32LE(computedEnd);
                const v1 = d.readUInt32LE(computedEnd + 4);
                const v2 = d.readUInt32LE(computedEnd + 8);
                console.log('  Next 3 u32s: [' + v0 + ', ' + v1 + ', ' + v2 + '] → ' + (v0 === 4 && v1 === 8 && v2 === 2 ? 'ANOTHER TOPOLOGY BLOCK' : 'NOT a topology block header'));
            }
        }
    }
}

function printAnalysis(r) {
    if (!r) return;
    console.log('  [' + r.name + ']');
    console.log('    offset: +' + hex4(r.startByte - COMPLEX.pos) + ' to +' + hex4(r.endByte - COMPLEX.pos) + ' (' + r.size + ' bytes, ' + r.u32Count + ' u32s)');
    console.log('    entropy: ' + r.entropy + ' bits/byte (max 8.0)');
    console.log('    zero: ' + r.zeroPercent + '%');
    console.log('    one: ' + r.onePercent + '%');
    console.log('    small (1-255): ' + r.smallPercent + '%');
    console.log('    medium (256-65535): ' + r.mediumPercent + '%');
    console.log('    large (>=65536): ' + r.largePercent + '%');
    console.log('    plausible float32: ' + r.floatPlausiblePercent + '%');
    if (r.repeated.length > 0) {
        console.log('    repeated 16-byte windows:');
        for (const [w, c] of r.repeated) console.log('      "' + w + '" × ' + c);
    }
}

function hex4(n) { return n.toString(16).padStart(4, '0'); }
function pad8(n) { return String(n).padStart(8); }

// Dump complex face
dumpFace('COMPLEX FACE', COMPLEX);

// Dump simple face
dumpFace('SIMPLE FACE', SIMPLE);

// 5. Cross-face comparison
console.log('\n' + '='.repeat(80));
console.log('5. STRUCTURAL COMPARISON');
console.log('='.repeat(80));

function getLayout(face) {
    const vertStart = face.pos + 16;
    const vertEnd = vertStart + face.vc * 12;
    const normStart = vertEnd + 16;
    const normEnd = normStart + face.vc * 12;
    const topoStart = normEnd;
    let b2End = topoStart;
    if (topoStart + 16 <= d.length && d.readUInt32LE(topoStart) === 4 && d.readUInt32LE(topoStart+4) === 8 && d.readUInt32LE(topoStart+8) === 2) {
        const b1N = d.readUInt32LE(topoStart + 12);
        const b2S = topoStart + (b1N + 4) * 4;
        if (b2S + 16 <= d.length && d.readUInt32LE(b2S) === 4 && d.readUInt32LE(b2S+4) === 8 && d.readUInt32LE(b2S+8) === 2) {
            const b2N = d.readUInt32LE(b2S + 12);
            b2End = b2S + (b2N + 4) * 4;
        }
    }
    return {
        faceBlockSize: face.pos + 16 + face.vc * 12 - face.pos,
        headerSize: 16,
        vertexArraySize: face.vc * 12,
        gapSize: 16,
        normalsSize: face.vc * 12,
        topoSize: b2End - topoStart,
        totalSize: b2End - face.pos,
        b1N: topoStart + 16 <= d.length && d.readUInt32LE(topoStart) === 4 ? d.readUInt32LE(topoStart + 12) : 0,
    };
}

const cl = getLayout(COMPLEX);
const sl = getLayout(SIMPLE);

console.log('\n  Property                        Complex(#' + COMPLEX.fi + ')   Simple(#' + SIMPLE.fi + ')    Ratio');
console.log('  ' + '-'.repeat(80));
console.log('  vc                              ' + pad8(COMPLEX.vc) + '   ' + pad8(SIMPLE.vc) + '   ' + (COMPLEX.vc / SIMPLE.vc).toFixed(1) + 'x');
console.log('  ec                              ' + pad8(COMPLEX.ec) + '   ' + pad8(SIMPLE.ec) + '   ' + (COMPLEX.ec / SIMPLE.ec).toFixed(1) + 'x');
console.log('  loops                           ' + pad8(COMPLEX.totalLoops) + '   ' + pad8(SIMPLE.totalLoops));
console.log('  Block1 N                        ' + pad8(cl.b1N) + '   ' + pad8(sl.b1N) + '   ' + (cl.b1N / sl.b1N).toFixed(1) + 'x');
console.log('  header (always 16)              ' + pad8(cl.headerSize) + '   ' + pad8(sl.headerSize) + '   =');
console.log('  vertex array (vc×12)            ' + pad8(cl.vertexArraySize) + '   ' + pad8(sl.vertexArraySize) + '   ' + (cl.vertexArraySize / sl.vertexArraySize).toFixed(1) + 'x');
console.log('  gap marker (always 16)          ' + pad8(cl.gapSize) + '   ' + pad8(sl.gapSize) + '   =');
console.log('  normals (vc×12)                 ' + pad8(cl.normalsSize) + '   ' + pad8(sl.normalsSize) + '   ' + (cl.normalsSize / sl.normalsSize).toFixed(1) + 'x');
console.log('  topology (Block1+Block2)        ' + pad8(cl.topoSize) + '   ' + pad8(sl.topoSize) + '   ' + (cl.topoSize / sl.topoSize).toFixed(1) + 'x');
console.log('  TOTAL                           ' + pad8(cl.totalSize) + '   ' + pad8(sl.totalSize) + '   ' + (cl.totalSize / sl.totalSize).toFixed(1) + 'x');
console.log('  B1_N / vc                       ' + pad8((cl.b1N / COMPLEX.vc).toFixed(3)) + '   ' + pad8((sl.b1N / SIMPLE.vc).toFixed(3)));
console.log('  B1_N / ec                       ' + pad8((cl.b1N / COMPLEX.ec).toFixed(3)) + '   ' + pad8((sl.b1N / SIMPLE.ec).toFixed(3)));
console.log('  topo / vertexArray              ' + pad8((cl.topoSize / cl.vertexArraySize).toFixed(3)) + '   ' + pad8((sl.topoSize / sl.vertexArraySize).toFixed(3)));
