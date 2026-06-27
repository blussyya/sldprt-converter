#!/usr/bin/env node
/**
 * diff_framework.js — Block 1 Differential Analysis Framework
 * 
 * Compares faces across SLDPRT files.
 * Produces report only. No semantic inference.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function rolByte(b, s) { s &= 7; if (!s) return b; return ((b << s) | (b >>> (8 - s))) & 0xFF; }
function findAll(buf, pat) {
  const r = [];
  for (let i = 0; i <= buf.length - pat.length; i++) {
    let ok = true;
    for (let j = 0; j < pat.length; j++) if (buf[i+j] !== pat[j]) { ok = false; break; }
    if (ok) r.push(i);
  }
  return r;
}
function decompressOpenSX(buffer) {
  const key = buffer[7];
  const magic = [20,0,6,0,8,0];
  const s = {};
  for (const mp of findAll(buffer, magic)) {
    const si = mp - 4;
    if (si < 0 || si + 30 > buffer.length) continue;
    const csz = buffer.readUInt32LE(si+18);
    const nsz = buffer.readUInt32LE(si+26);
    if (nsz > 1024 || csz > 50e6) continue;
    const ns = si+30, ds = ns+nsz, de = ds+csz;
    if (de > buffer.length) continue;
    if (buffer.readUInt32LE(si+14) >= 65536 && csz > 0) {
      let n = '';
      for (let i = 0; i < nsz; i++) n += String.fromCharCode(rolByte(buffer[ns+i], key));
      if (!n) continue;
      let d;
      try { d = zlib.inflateRawSync(Buffer.from(buffer.subarray(ds, de))); }
      catch { try { d = zlib.inflateSync(Buffer.from(buffer.subarray(ds, de))); } catch {} }
      if (d && d.length > 0 && !s[n]) s[n] = d;
    }
  }
  return s;
}
function findDisplayLists(buffer) {
  const dc = decompressOpenSX(buffer);
  for (const [name, data] of Object.entries(dc)) {
    if (name.toLowerCase().includes('displaylist') && data.length > 100) {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (buf.readUInt32LE(0) === 1 && buf.readUInt32LE(4) === 1) return data;
    }
  }
  return null;
}

const FACE_MARKER = Buffer.from([12,0,0,0,100,0,0,0]);
function extractFaces(dl) {
  const faces = [];
  for (const mp of findAll(dl, FACE_MARKER)) {
    if (mp < 4) continue;
    const ec = dl.readUInt32LE(mp-4);
    if (ec < 1 || ec > 500) continue;
    if (dl.readUInt32LE(mp+8) !== 2) continue;
    const vc = dl.readUInt32LE(mp+12);
    if (vc < 3 || vc > 5000) continue;
    const vs = mp + 16;
    if (vs + vc*12 > dl.length) continue;
    let ok = true;
    for (let i = 0; i < vc; i++) {
      const x = dl.readFloatLE(vs + i*12);
      if (!isFinite(x) || Math.abs(x) > 1e5) { ok = false; break; }
    }
    if (!ok) continue;
    const ns = vs + vc*12 + 16;
    const ts = ns + vc*12;
    if (ts + 16 > dl.length) continue;
    if (dl.readUInt32LE(ts) !== 4 || dl.readUInt32LE(ts+4) !== 8 || dl.readUInt32LE(ts+8) !== 2) continue;
    const b1len = dl.readUInt32LE(ts+12);
    if (b1len > 100000 || ts + 16 + b1len*4 > dl.length) continue;
    const block1 = [];
    for (let i = 0; i < b1len; i++) block1.push(dl.readUInt32LE(ts+16+i*4));
    const b2s = ts + (b1len+4)*4;
    let block2 = [];
    if (b2s+12 <= dl.length && dl.readUInt32LE(b2s)===4 && dl.readUInt32LE(b2s+4)===8 && dl.readUInt32LE(b2s+8)===2) {
      const m = dl.readUInt32LE(b2s+12);
      for (let i = 0; i < m; i++) block2.push(dl.readUInt32LE(b2s+16+i*4));
    }
    const verts = [];
    for (let i = 0; i < vc; i++) {
      verts.push([dl.readFloatLE(vs+i*12), dl.readFloatLE(vs+i*12+4), dl.readFloatLE(vs+i*12+8)]);
    }
    faces.push({ ec, vc, block1, block2, verts });
  }
  return faces;
}

function splitSections(block1) {
  const secs = [];
  let cur = [];
  for (const t of block1) {
    if (t === 1) { if (cur.length) secs.push(cur); cur = []; }
    else cur.push(t);
  }
  if (cur.length) secs.push(cur);
  return secs;
}

function faceKey(f) { return `${f.vc}_${f.ec}_${f.block1.length}_${f.block2.length}`; }

function geoDist(a, b) {
  if (a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    const dx=a[i][0]-b[i][0], dy=a[i][1]-b[i][1], dz=a[i][2]-b[i][2];
    d += Math.sqrt(dx*dx+dy*dy+dz*dz);
  }
  return d / a.length;
}

function findBestMatch(target, candidates) {
  let best = -1, bestDist = Infinity;
  for (let i = 0; i < candidates.length; i++) {
    const d = geoDist(target.verts, candidates[i].verts);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return { index: best, distance: bestDist };
}

// --- Diff two sections ---
function diffSections(sA, sB) {
  const len = Math.min(sA.length, sB.length);
  const stable = [], changed = [];
  for (let i = 0; i < len; i++) {
    if (sA[i] === sB[i]) stable.push(sA[i]);
    else changed.push({ pos: i, from: sA[i], to: sB[i] });
  }
  const ins = sB.slice(len).map((v,i) => ({ pos: len+i, value: v }));
  const del = sA.slice(len).map((v,i) => ({ pos: len+i, value: v }));
  return { stable, changed, inserted: ins, deleted: del, lenA: sA.length, lenB: sB.length };
}

// --- Diff two faces ---
function diffFaces(fA, fB) {
  const secsA = splitSections(fA.block1);
  const secsB = splitSections(fB.block1);
  const minSecs = Math.min(secsA.length, secsB.length);

  const sectionDiffs = [];
  for (let s = 0; s < minSecs; s++) sectionDiffs.push(diffSections(secsA[s], secsB[s]));

  const secInserted = secsB.slice(minSecs).length;
  const secDeleted = secsA.slice(minSecs).length;

  // Block 2 diff
  const minB2 = Math.min(fA.block2.length, fB.block2.length);
  const b2Stable = [], b2Changed = [];
  for (let i = 0; i < minB2; i++) {
    if (fA.block2[i] === fB.block2[i]) b2Stable.push(fA.block2[i]);
    else b2Changed.push({ pos: i, from: fA.block2[i], to: fB.block2[i] });
  }
  const b2Ins = fB.block2.slice(minB2);
  const b2Del = fA.block2.slice(minB2);

  // Aggregate VALUE stats
  let totalStable = 0, totalChanged = 0, totalIns = 0, totalDel = 0;
  for (const d of sectionDiffs) {
    totalStable += d.stable.length;
    totalChanged += d.changed.length;
    totalIns += d.inserted.length;
    totalDel += d.deleted.length;
  }

  // Geometry distance
  const geoDist_ = geoDist(fA.verts, fB.verts);

  return {
    sectionsA: secsA.length, sectionsB: secsB.length,
    secInserted, secDeleted,
    sectionDiffs,
    b2Stable, b2Changed, b2Inserted: b2Ins, b2Deleted: b2Del,
    totalStable, totalChanged, totalInserted: totalIns, totalDeleted: totalDel,
    geoDistance: geoDist_,
  };
}

// --- Main ---
const RESEARCH_DIR = 'C:\\Users\\basha\\Desktop\\soldiworks research';
const FILES = {
  BOTTOM: path.join(RESEARCH_DIR, 'test files original', 'usb hub case (ultimate test)', 'USB hub case BOTTOM.SLDPRT'),
  TOP: path.join(RESEARCH_DIR, 'test files original', 'usb hub case (ultimate test)', 'USB hub case TOP.SLDPRT'),
  GEAR: path.join(RESEARCH_DIR, 'test files original', 'Helical Bevel Gear.SLDPRT'),
  DEKOR: path.join(RESEARCH_DIR, 'test files original', 'Dekor.SLDPRT'),
};

console.log('Loading files...');
const allFaces = {};
for (const [name, fp] of Object.entries(FILES)) {
  const raw = fs.readFileSync(fp);
  const dl = findDisplayLists(raw);
  if (!dl) { console.log(`  ${name}: no DL`); continue; }
  const faces = extractFaces(dl);
  console.log(`  ${name}: ${faces.length} faces`);
  for (const f of faces) f.file = name;
  allFaces[name] = faces;
}

// ============================================================
// PHASE 1: Intra-file — faces with same structural key
// ============================================================
console.log('\n' + '='.repeat(70));
console.log('PHASE 1: INTRA-FILE STRUCTURAL CLONES');
console.log('='.repeat(70));

let intraPairs = 0, intraZeroDiff = 0, intraNonZeroDiff = 0;
const intraStats = { stable: 0, changed: 0, inserted: 0, deleted: 0 };

for (const [name, faces] of Object.entries(allFaces)) {
  const groups = {};
  for (let i = 0; i < faces.length; i++) {
    const k = faceKey(faces[i]);
    if (!groups[k]) groups[k] = [];
    groups[k].push(i);
  }
  for (const [key, idxs] of Object.entries(groups)) {
    if (idxs.length < 2) continue;
    for (let a = 0; a < idxs.length; a++) {
      for (let b = a+1; b < idxs.length; b++) {
        const diff = diffFaces(faces[idxs[a]], faces[idxs[b]]);
        intraPairs++;
        if (diff.totalChanged === 0 && diff.totalInserted === 0 && diff.totalDeleted === 0) intraZeroDiff++;
        else intraNonZeroDiff++;
        intraStats.stable += diff.totalStable;
        intraStats.changed += diff.totalChanged;
        intraStats.inserted += diff.totalInserted;
        intraStats.deleted += diff.totalDeleted;

        if (intraPairs <= 10 || diff.totalChanged > 0) {
          console.log(`\n  ${name} pair [${idxs[a]} vs ${idxs[b]}]: key=${key}`);
          console.log(`    secs: ${diff.sectionsA} vs ${diff.sectionsB}`);
          console.log(`    VALUEs: stable=${diff.totalStable} changed=${diff.totalChanged} ins=${diff.totalInserted} del=${diff.totalDeleted}`);
          console.log(`    b2: stable=${diff.b2Stable.length} changed=${diff.b2Changed.length} ins=${diff.b2Inserted.length} del=${diff.b2Deleted.length}`);
          console.log(`    geoDist=${diff.geoDistance.toFixed(6)}`);
          if (diff.b2Changed.length > 0) console.log(`    b2 changes:`, JSON.stringify(diff.b2Changed.slice(0, 5)));
        }
      }
    }
  }
}
console.log(`\n  Intra-file pairs: ${intraPairs}`);
console.log(`  Zero-diff (identical Block 1): ${intraZeroDiff}`);
console.log(`  Non-zero-diff: ${intraNonZeroDiff}`);
console.log(`  Total VALUEs: stable=${intraStats.stable} changed=${intraStats.changed} ins=${intraStats.inserted} del=${intraStats.deleted}`);

// ============================================================
// PHASE 2: Inter-file — match faces by geometry
// ============================================================
console.log('\n' + '='.repeat(70));
console.log('PHASE 2: INTER-FILE GEOMETRY MATCHING');
console.log('='.repeat(70));

const fileNames = Object.keys(allFaces);
let interPairs = 0;
const interResults = [];

for (let fi = 0; fi < fileNames.length; fi++) {
  for (let fj = fi+1; fj < fileNames.length; fj++) {
    const nameA = fileNames[fi], nameB = fileNames[fj];
    const facesA = allFaces[nameA], facesB = allFaces[nameB];

    // Match by structural key first
    const groupsA = {}, groupsB = {};
    for (let i = 0; i < facesA.length; i++) { const k = faceKey(facesA[i]); if (!groupsA[k]) groupsA[k] = []; groupsA[k].push(i); }
    for (let i = 0; i < facesB.length; i++) { const k = faceKey(facesB[i]); if (!groupsB[k]) groupsB[k] = []; groupsB[k].push(i); }

    for (const key of Object.keys(groupsA)) {
      if (!groupsB[key]) continue;
      for (const idxA of groupsA[key]) {
        const best = findBestMatch(facesA[idxA], groupsB[key].map(i => facesB[i]));
        if (best.index < 0) continue;
        const idxB = groupsB[key][best.index];
        const diff = diffFaces(facesA[idxA], facesB[idxB]);
        interPairs++;

        const entry = {
          fileA: nameA, faceA: idxA, fileB: nameB, faceB: idxB,
          key, geoDist: best.distance,
          secsA: diff.sectionsA, secsB: diff.sectionsB,
          stable: diff.totalStable, changed: diff.totalChanged,
          ins: diff.totalInserted, del: diff.totalDeleted,
          b2Stable: diff.b2Stable.length, b2Changed: diff.b2Changed.length,
        };
        interResults.push(entry);

        if (interPairs <= 15 || diff.totalChanged > 0) {
          console.log(`\n  ${nameA}[${idxA}] vs ${nameB}[${idxB}]: key=${key}`);
          console.log(`    secs: ${diff.sectionsA} vs ${diff.sectionsB} | b2: ${diff.b2Stable.length} stable ${diff.b2Changed.length} changed`);
          console.log(`    VALUEs: stable=${diff.totalStable} changed=${diff.totalChanged} ins=${diff.totalInserted} del=${diff.totalDeleted}`);
          console.log(`    geoDist=${best.distance.toFixed(6)}`);
          if (diff.totalChanged > 0) {
            for (const sd of diff.sectionDiffs) {
              if (sd.changed.length > 0) console.log(`      sec changed: ${JSON.stringify(sd.changed.slice(0,5))}`);
            }
          }
        }
      }
    }
  }
}
console.log(`\n  Inter-file matches: ${interPairs}`);
console.log(`  Zero-diff: ${interResults.filter(r => r.changed === 0 && r.ins === 0 && r.del === 0).length}`);
console.log(`  Non-zero-diff: ${interResults.filter(r => r.changed > 0 || r.ins > 0 || r.del > 0).length}`);

// ============================================================
// PHASE 3: Value stability analysis
// ============================================================
console.log('\n' + '='.repeat(70));
console.log('PHASE 3: VALUE STABILITY ACROSS ALL PAIRS');
console.log('='.repeat(70));

// For all intra-file pairs, track which VALUE positions are stable
const valuePosStability = {};
let totalPairsAnalyzed = 0;

for (const [name, faces] of Object.entries(allFaces)) {
  const groups = {};
  for (let i = 0; i < faces.length; i++) {
    const k = faceKey(faces[i]);
    if (!groups[k]) groups[k] = [];
    groups[k].push(i);
  }
  for (const idxs of Object.values(groups)) {
    if (idxs.length < 2) continue;
    for (let a = 0; a < idxs.length; a++) {
      for (let b = a+1; b < idxs.length; b++) {
        totalPairsAnalyzed++;
        const secsA = splitSections(faces[idxs[a]].block1);
        const secsB = splitSections(faces[idxs[b]].block1);
        const minSecs = Math.min(secsA.length, secsB.length);
        for (let s = 0; s < minSecs; s++) {
          const minLen = Math.min(secsA[s].length, secsB[s].length);
          for (let p = 0; p < minLen; p++) {
            const k2 = `${name}_sec${s}_pos${p}`;
            if (!valuePosStability[k2]) valuePosStability[k2] = { stable: 0, changed: 0, values: new Set() };
            valuePosStability[k2].values.add(secsA[s][p]);
            valuePosStability[k2].values.add(secsB[s][p]);
            if (secsA[s][p] === secsB[s][p]) valuePosStability[k2].stable++;
            else valuePosStability[k2].changed++;
          }
        }
      }
    }
  }
}

// Summarize: positions that are always stable vs sometimes changed
let alwaysStable = 0, sometimesChanged = 0, alwaysChanged = 0;
const changeRates = [];
for (const [k, v] of Object.entries(valuePosStability)) {
  const total = v.stable + v.changed;
  const rate = v.changed / total;
  changeRates.push(rate);
  if (v.changed === 0) alwaysStable++;
  else if (v.stable === 0) alwaysChanged++;
  else sometimesChanged++;
}
changeRates.sort((a,b) => a-b);
console.log(`  Total position-tracks: ${changeRates.length}`);
console.log(`  Always stable (0% change): ${alwaysStable}`);
console.log(`  Sometimes changed: ${sometimesChanged}`);
console.log(`  Always changed (100%): ${alwaysChanged}`);
if (changeRates.length > 0) {
  console.log(`  Change rate: min=${(changeRates[0]*100).toFixed(1)}% median=${(changeRates[Math.floor(changeRates.length/2)]*100).toFixed(1)}% max=${(changeRates[changeRates.length-1]*100).toFixed(1)}%`);
}

// ============================================================
// PHASE 4: Section diff patterns
// ============================================================
console.log('\n' + '='.repeat(70));
console.log('PHASE 4: SECTION DIFF PATTERNS (changed sections only)');
console.log('='.repeat(70));

const diffPatterns = {};
let totalChangedSecs = 0;

for (const [name, faces] of Object.entries(allFaces)) {
  const groups = {};
  for (let i = 0; i < faces.length; i++) {
    const k = faceKey(faces[i]);
    if (!groups[k]) groups[k] = [];
    groups[k].push(i);
  }
  for (const idxs of Object.values(groups)) {
    if (idxs.length < 2) continue;
    for (let a = 0; a < idxs.length; a++) {
      for (let b = a+1; b < idxs.length; b++) {
        const secsA = splitSections(faces[idxs[a]].block1);
        const secsB = splitSections(faces[idxs[b]].block1);
        const minSecs = Math.min(secsA.length, secsB.length);
        for (let s = 0; s < minSecs; s++) {
          const diff = diffSections(secsA[s], secsB[s]);
          if (diff.changed.length === 0) continue;
          totalChangedSecs++;
          // Classify change type
          const patA = secsA[s].map(v => v === 0 ? 'Z' : 'V').join('');
          const patB = secsB[s].map(v => v === 0 ? 'Z' : 'V').join('');
          const patternKey = `${patA}→${patB}`;
          diffPatterns[patternKey] = (diffPatterns[patternKey] || 0) + 1;
        }
      }
    }
  }
}

console.log(`  Total changed sections: ${totalChangedSecs}`);
console.log(`  Distinct diff patterns: ${Object.keys(diffPatterns).length}`);
const sorted = Object.entries(diffPatterns).sort((a,b) => b[1] - a[1]);
for (const [pat, count] of sorted.slice(0, 20)) {
  console.log(`    ${count}x ${pat}`);
}

// Write report
const report = {
  phase1_intraFile: { pairs: intraPairs, zeroDiff: intraZeroDiff, nonZeroDiff: intraNonZeroDiff, stats: intraStats },
  phase2_interFile: { matches: interPairs, zeroDiff: interResults.filter(r => r.changed === 0 && r.ins === 0 && r.del === 0).length, results: interResults },
  phase3_valueStability: { positionTracks: changeRates.length, alwaysStable, sometimesChanged, alwaysChanged, medianChangeRate: changeRates.length > 0 ? changeRates[Math.floor(changeRates.length/2)] : 0 },
  phase4_diffPatterns: { changedSections: totalChangedSecs, patterns: sorted },
};

const outPath = path.join(__dirname, 'docs', 'research', 'DIFF_REPORT.json');
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`\nReport written to: ${outPath}`);
