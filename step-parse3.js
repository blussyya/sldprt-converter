const fs = require('fs');
const step = fs.readFileSync('C:\\Users\\basha\\Downloads\\isolated-usb-hub-case-1.snapshot.4\\USB hub case BOTTOM.STEP', 'utf8');

// ── STEP Entity Parser ──
const entities = {};
let curId = null, curText = '';
for (const line of step.split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('/*') || t.startsWith('*')) continue;
  const sm = t.match(/^#(\d+)\s*=\s*(.*)/);
  if (sm) {
    if (curId !== null) entities[curId] = curText;
    curId = +sm[1]; curText = sm[2];
  } else if (curId !== null) {
    curText += ' ' + t;
  }
  if (curText.endsWith(';')) {
    if (curId !== null) entities[curId] = curText.slice(0, -1).trim();
    curId = null; curText = '';
  }
}
if (curId !== null) entities[curId] = curText;

// ── Helpers ──
function getRefs(text) { return [...text.matchAll(/#(\d+)/g)].map(m => +m[1]); }
function getType(text) { const m = text.match(/^(\w[\w_]*)\s*\(/); return m ? m[1] : text.split(' ')[0]; }

// ── CARTESIAN_POINT → {id: [x,y,z]} ──
const pts = {};
for (const [id, text] of Object.entries(entities)) {
  if (getType(text) !== 'CARTESIAN_POINT') continue;
  const c = text.match(/\(\s*([-\d.E+]+)\s*,\s*([-\d.E+]+)\s*,\s*([-\d.E+]+)\s*\)/);
  if (c) pts[+id] = [+c[1], +c[2], +c[3]];
}

// ── VERTEX_POINT → cartesian_point_id ──
// Format: VERTEX_POINT ( 'NONE', #cartesian_point_id )  → 1 ref
const vpToPt = {};
for (const [id, text] of Object.entries(entities)) {
  if (getType(text) !== 'VERTEX_POINT') continue;
  const refs = getRefs(text);
  if (refs.length >= 1) vpToPt[+id] = refs[0];
}

// ── EDGE_CURVE → {sv: startVP, ev: endVP} ──
// Format: EDGE_CURVE ( 'NONE', #startVP, #endVP, #edgeGeom, .T./.F. )
// Refs: [startVP, endVP, edgeGeom]  (no self-ref since no #id in text body)
const ecMap = {};
for (const [id, text] of Object.entries(entities)) {
  if (getType(text) !== 'EDGE_CURVE') continue;
  const refs = getRefs(text);
  if (refs.length >= 2) ecMap[+id] = { sv: refs[0], ev: refs[1] };
}

// ── ORIENTED_EDGE → edge_curve_id ──
// Format: ORIENTED_EDGE ( 'NONE', *, *, #edge_curve_id, .T./.F. )
// Refs: [edge_curve_id]  (the * are wildcards, not #refs)
const oeMap = {};
for (const [id, text] of Object.entries(entities)) {
  if (getType(text) !== 'ORIENTED_EDGE') continue;
  const refs = getRefs(text);
  if (refs.length >= 1) oeMap[+id] = refs[0];
}

// ── EDGE_LOOP → [oriented_edge_ids] ──
// Format: EDGE_LOOP ( 'NONE', ( #oe1, #oe2, ... ) )
const elMap = {};
for (const [id, text] of Object.entries(entities)) {
  if (getType(text) !== 'EDGE_LOOP') continue;
  elMap[+id] = getRefs(text);
}

// ── FACE_OUTER_BOUND / FACE_BOUND → edge_loop_id ──
// Format: FACE_OUTER_BOUND ( 'NONE', #edge_loop_id, .T./.F. )
// Refs: [edge_loop_id]  (1 ref)
const fbMap = {};
for (const [id, text] of Object.entries(entities)) {
  const tp = getType(text);
  if (tp !== 'FACE_OUTER_BOUND' && tp !== 'FACE_BOUND') continue;
  const refs = getRefs(text);
  if (refs.length >= 1) fbMap[+id] = { loopId: refs[0], type: tp };
}

// ── Surface types ──
const surfTypes = {};
for (const [id, text] of Object.entries(entities)) {
  const tp = getType(text);
  if (['PLANE','CYLINDRICAL_SURFACE','CONICAL_SURFACE'].includes(tp)) {
    surfTypes[+id] = tp;
  }
}

// ── ADVANCED_FACE ──
const faces = [];
for (const [id, text] of Object.entries(entities)) {
  if (getType(text) !== 'ADVANCED_FACE') continue;
  const refs = getRefs(text);
  const orient = text.includes('.T.');
  faces.push({ id: +id, bounds: refs.slice(0, -1), surfId: refs[refs.length - 1], orient });
}

console.log('CARTESIAN_POINT:', Object.keys(pts).length);
console.log('VERTEX_POINT:', Object.keys(vpToPt).length);
console.log('EDGE_CURVE:', Object.keys(ecMap).length);
console.log('ORIENTED_EDGE:', Object.keys(oeMap).length);
console.log('EDGE_LOOP:', Object.keys(elMap).length);
console.log('FACE_OUTER_BOUND:', Object.values(fbMap).filter(v => v.type === 'FACE_OUTER_BOUND').length);
console.log('FACE_BOUND:', Object.values(fbMap).filter(v => v.type === 'FACE_BOUND').length);
console.log('ADVANCED_FACE:', faces.length);

// ── Trace boundary ──
function traceBoundary(af) {
  const loops = [];
  for (const bId of af.bounds) {
    const fb = fbMap[bId];
    if (!fb) continue;
    const oeIds = elMap[fb.loopId];
    if (!oeIds || oeIds.length === 0) continue;
    const verts = [];
    for (const oeId of oeIds) {
      const ecId = oeMap[oeId];
      if (!ecId) continue;
      const ec = ecMap[ecId];
      if (!ec) continue;
      const ptId = vpToPt[ec.sv];
      const pt = ptId ? pts[ptId] : null;
      if (pt) verts.push(pt);
    }
    if (verts.length > 0) loops.push({ type: fb.type, verts });
  }
  return loops;
}

console.log('\n=== All ADVANCED_FACE boundaries ===');
for (const af of faces) {
  const stype = surfTypes[af.surfId] || '?';
  const loops = traceBoundary(af);
  const outer = loops.filter(l => l.type === 'FACE_OUTER_BOUND');
  const inner = loops.filter(l => l.type === 'FACE_BOUND');
  const tv = loops.reduce((s, l) => s + l.verts.length, 0);
  const flag = inner.length > 0 ? ` HOLES=${inner.length}` : '';
  console.log(`AF#${af.id} (${stype}) ${af.orient ? 'T' : 'F'} loops=${loops.length}(${outer.length}O/${inner.length}I) verts=${tv}${flag}`);
}

// ── Print coords for faces with holes ──
console.log('\n=== Faces with holes (coords) ===');
for (const af of faces) {
  const stype = surfTypes[af.surfId] || '?';
  const loops = traceBoundary(af);
  const inner = loops.filter(l => l.type === 'FACE_BOUND');
  if (inner.length === 0) continue;
  console.log(`\nAF#${af.id} (${stype}):`);
  for (let i = 0; i < loops.length; i++) {
    const l = loops[i];
    const label = l.type === 'FACE_OUTER_BOUND' ? 'OUTER' : 'HOLE';
    console.log(`  ${label} (${l.verts.length} verts):`);
    for (const v of l.verts) console.log(`    [${v[0].toFixed(3)}, ${v[1].toFixed(3)}, ${v[2].toFixed(3)}]`);
  }
}
