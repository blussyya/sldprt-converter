const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function rolByte(b, shift) { shift &= 7; if (shift === 0) return b; return ((b << shift) | (b >>> (8 - shift))) & 0xFF; }
function findAll(buf, pattern) { const pos = []; for (let i = 0; i <= buf.length - pattern.length; i++) { let ok = true; for (let j = 0; j < pattern.length; j++) { if (buf[i + j] !== pattern[j]) { ok = false; break; } } if (ok) pos.push(i); } return pos; }

function decompressOpenSX(buf) {
  const key = buf[7];
  const marker = [0x14, 0x00, 0x06, 0x00, 0x08, 0x00];
  const streams = {};
  for (const mp of findAll(buf, marker)) {
    const si = mp - 4;
    if (si < 0 || si + 0x1E > buf.length) continue;
    const csz = buf.readUInt32LE(si + 0x12);
    const nsz = buf.readUInt32LE(si + 0x1A);
    if (nsz > 1024 || csz > 50 * 1024 * 1024) continue;
    const nameStart = si + 0x1E;
    const dataStart = nameStart + nsz;
    const dataEnd = dataStart + csz;
    if (dataEnd > buf.length) continue;
    const f1 = buf.readUInt32LE(si + 0x0E);
    if (f1 >= 65536 && csz > 0) {
      let name = '';
      for (let i = 0; i < nsz; i++) name += String.fromCharCode(rolByte(buf[nameStart + i], key));
      if (name.length === 0) continue;
      const compressed = buf.subarray(dataStart, dataEnd);
      let decompressed = null;
      try { decompressed = zlib.inflateRawSync(Buffer.from(compressed)); } catch {
        try { decompressed = zlib.inflateSync(Buffer.from(compressed)); } catch {}
      }
      if (decompressed && decompressed.length > 0 && !streams[name]) streams[name] = decompressed;
    }
  }
  return streams;
}

function findDisplayLists(buf) {
  const streams = decompressOpenSX(buf);
  for (const [name, data] of Object.entries(streams)) {
    if (name.toLowerCase().includes('displaylist') && data.length > 100) {
      const d = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (d.readUInt32LE(0) === 1 && d.readUInt32LE(4) === 1) return data;
    }
  }
  return null;
}

function extractFaces(dlData) {
  const data = dlData;
  const results = [];
  const MARKER = Buffer.from([0x0c, 0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00]);
  for (const mp of findAll(data, MARKER)) {
    if (mp < 4) continue;
    const ec = data.readUInt32LE(mp - 4);
    if (ec < 1 || ec > 500) continue;
    if (data.readUInt32LE(mp + 8) !== 2) continue;
    const vc = data.readUInt32LE(mp + 12);
    if (vc < 3 || vc > 5000) continue;
    const vertStart = mp + 16;
    if (vertStart + vc * 12 > data.length) continue;
    let valid = true;
    for (let i = 0; i < vc; i++) {
      const x = data.readFloatLE(vertStart + i * 12);
      if (!isFinite(x) || Math.abs(x) > 100000) { valid = false; break; }
    }
    if (!valid) continue;
    const vertEnd = vertStart + vc * 12;
    const normStart = vertEnd + 16;
    const normEnd = normStart + vc * 12;
    const topoStart = normEnd;
    if (topoStart + 16 > data.length) continue;
    if (data.readUInt32LE(topoStart) !== 4 || data.readUInt32LE(topoStart + 4) !== 8 || data.readUInt32LE(topoStart + 8) !== 2) continue;
    const N = data.readUInt32LE(topoStart + 12);
    if (topoStart + 16 + N * 4 > data.length) continue;
    const block1 = [];
    for (let i = 0; i < N; i++) block1.push(data.readUInt32LE(topoStart + 16 + i * 4));
    const b2Start = topoStart + (N + 4) * 4;
    let block2 = [];
    if (b2Start + 12 <= data.length && data.readUInt32LE(b2Start) === 4 && data.readUInt32LE(b2Start + 4) === 8 && data.readUInt32LE(b2Start + 8) === 2) {
      const M = data.readUInt32LE(b2Start + 12);
      for (let i = 0; i < M; i++) block2.push(data.readUInt32LE(b2Start + 16 + i * 4));
    }
    results.push({ ec, vc, mp, block1, block2, topoStart, vertStart, vertEnd, normEnd });
  }
  return results;
}

const RESEARCH_DIR = 'C:\\Users\\basha\\Desktop\\soldiworks research';
const FILES = {
  BOTTOM: path.join(RESEARCH_DIR, 'test files original', 'usb hub case (ultimate test)', 'USB hub case BOTTOM.SLDPRT'),
  TOP: path.join(RESEARCH_DIR, 'test files original', 'usb hub case (ultimate test)', 'USB hub case TOP.SLDPRT'),
  GEAR: path.join(RESEARCH_DIR, 'test files original', 'Helical Bevel Gear.SLDPRT'),
  DEKOR: path.join(RESEARCH_DIR, 'test files original', 'Dekor.SLDPRT'),
};

console.log('FACE GEOMETRY vs BLOCK 1 STRUCTURE');
console.log('='.repeat(80));

for (const [name, fpath] of Object.entries(FILES)) {
  const raw = fs.readFileSync(fpath);
  const dl = findDisplayLists(raw);
  if (!dl) { console.log(`${name}: DisplayLists NOT FOUND`); continue; }

  const faces = extractFaces(dl);
  console.log(`\n${name}: ${faces.length} faces`);

  // For each face: split Block 1 by ONE, count LARGE values, compare to vc/ec
  let corr_vL = 0, corr_eL = 0, corr_vS = 0, corr_eS = 0;
  let sumV = 0, sumE = 0, sumL = 0, sumS = 0;
  const n = faces.length;
  for (const f of faces) {
    const secs = [];
    let cur = [];
    for (const v of f.block1) {
      if (v === 1) { if (cur.length > 0) secs.push(cur); cur = []; }
      else cur.push(v);
    }
    if (cur.length > 0) secs.push(cur);

    const totalLarge = secs.reduce((a, s) => a + s.filter(v => v > 100).length, 0);
    f._secCount = secs.length;
    f._totalLarge = totalLarge;

    sumV += f.vc;
    sumE += f.ec;
    sumL += totalLarge;
    sumS += secs.length;
  }
  const avgV = sumV / n, avgE = sumE / n, avgL = sumL / n, avgS = sumS / n;
  let dV2 = 0, dE2 = 0, dL2 = 0, dS2 = 0;
  for (const f of faces) {
    dV2 += (f.vc - avgV) ** 2;
    dE2 += (f.ec - avgE) ** 2;
    dL2 += (f._totalLarge - avgL) ** 2;
    dS2 += (f._secCount - avgS) ** 2;
  }
  for (const f of faces) {
    corr_vL += (f.vc - avgV) * (f._totalLarge - avgL);
    corr_eL += (f.ec - avgE) * (f._totalLarge - avgL);
    corr_vS += (f.vc - avgV) * (f._secCount - avgS);
    corr_eS += (f.ec - avgE) * (f._secCount - avgS);
  }
  const safe = (x, y) => Math.sqrt(x * y) > 0 ? x / Math.sqrt(x * y) : 0;
  console.log(`  Corr(vc, totalLarge) = ${safe(corr_vL, dV2 * dL2).toFixed(3)}`);
  console.log(`  Corr(ec, totalLarge) = ${safe(corr_eL, dE2 * dL2).toFixed(3)}`);
  console.log(`  Corr(vc, sectionCount) = ${safe(corr_vS, dV2 * dS2).toFixed(3)}`);
  console.log(`  Corr(ec, sectionCount) = ${safe(corr_eS, dE2 * dS2).toFixed(3)}`);

  // Exact matches
  let m1 = 0, m2 = 0, m3 = 0, m4 = 0;
  for (const f of faces) {
    if (f._secCount === f.vc) m1++;
    if (f._totalLarge === f.vc) m2++;
    if (f._secCount === f.ec) m3++;
    if (f._totalLarge === f.ec) m4++;
  }
  console.log(`  sectionCount == vc: ${m1}/${n} (${(100*m1/n).toFixed(1)}%)`);
  console.log(`  totalLarge   == vc: ${m2}/${n} (${(100*m2/n).toFixed(1)}%)`);
  console.log(`  sectionCount == ec: ${m3}/${n} (${(100*m3/n).toFixed(1)}%)`);
  console.log(`  totalLarge   == ec: ${m4}/${n} (${(100*m4/n).toFixed(1)}%)`);

  // Show samples
  console.log(`  Samples (vc, ec, b1len, secCount, totalLarge):`);
  for (let i = 0; i < Math.min(8, faces.length); i++) {
    const f = faces[i];
    console.log(`    face${i}: vc=${f.vc} ec=${f.ec} b1=${f.block1.length} secs=${f._secCount} large=${f._totalLarge}`);
  }
}
