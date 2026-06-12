const fs = require('fs');
const STEP_PATH = process.argv[2] || 'C:\\Users\\basha\\Downloads\\isolated-usb-hub-case-1.snapshot.4\\USB hub case BOTTOM.STEP';
const step = fs.readFileSync(STEP_PATH, 'utf8');

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

function getRefs(text) { return [...text.matchAll(/#(\d+)/g)].map(m => +m[1]); }
function getType(text) { const m = text.match(/^(\w[\w_]*)\s*\(/); return m ? m[1] : text.split(' ')[0]; }

// CARTESIAN_POINT
const pts = {};
for (const [id, text] of Object.entries(entities)) {
  if (getType(text) !== 'CARTESIAN_POINT') continue;
  const c = text.match(/\(\s*([-\d.E+]+)\s*,\s*([-\d.E+]+)\s*,\s*([-\d.E+]+)\s*\)/);
  if (c) pts[+id] = [+c[1], +c[2], +c[3]];
}

// VERTEX_POINT → cartesian_point_id
const vpToPt = {};
for (const [id, text] of Object.entries(entities)) {
  if (getType(text) !== 'VERTEX_POINT') continue;
  const refs = getRefs(text);
  if (refs.length >= 1) vpToPt[+id] = refs[0];
}

// EDGE_CURVE → {sv, ev}
const ecMap = {};
for (const [id, text] of Object.entries(entities)) {
  if (getType(text) !== 'EDGE_CURVE') continue;
  const refs = getRefs(text);
  if (refs.length >= 2) ecMap[+id] = { sv: refs[0], ev: refs[1] };
}

// ORIENTED_EDGE → { ecId, orient }
// Format: ORIENTED_EDGE ( 'NONE', *, *, #ecId, .T./.F. )
const oeMap = {};
for (const [id, text] of Object.entries(entities)) {
  if (getType(text) !== 'ORIENTED_EDGE') continue;
  const refs = getRefs(text);
  const orient = text.includes('.T.');
  if (refs.length >= 1) oeMap[+id] = { ecId: refs[0], orient };
}

// EDGE_LOOP → [oe_ids]
const elMap = {};
for (const [id, text] of Object.entries(entities)) {
  if (getType(text) !== 'EDGE_LOOP') continue;
  elMap[+id] = getRefs(text);
}

// FACE_OUTER_BOUND / FACE_BOUND → { loopId, type }
const fbMap = {};
for (const [id, text] of Object.entries(entities)) {
  const tp = getType(text);
  if (tp !== 'FACE_OUTER_BOUND' && tp !== 'FACE_BOUND') continue;
  const refs = getRefs(text);
  if (refs.length >= 1) fbMap[+id] = { loopId: refs[0], type: tp };
}

// Surface types
const surfTypes = {};
for (const [id, text] of Object.entries(entities)) {
  const tp = getType(text);
  if (['PLANE','CYLINDRICAL_SURFACE','CONICAL_SURFACE'].includes(tp)) {
    surfTypes[+id] = tp;
  }
}

// ADVANCED_FACE
const faces = [];
for (const [id, text] of Object.entries(entities)) {
  if (getType(text) !== 'ADVANCED_FACE') continue;
  const refs = getRefs(text);
  const orient = text.includes('.T.');
  faces.push({ id: +id, bounds: refs.slice(0, -1), surfId: refs[refs.length - 1], orient });
}

// ── Trace boundary: returns ordered list of VERTEX POINT positions ──
function traceLoop(loopId) {
  const oeIds = elMap[loopId];
  if (!oeIds) return [];
  const verts = [];
  for (const oeId of oeIds) {
    const oe = oeMap[oeId];
    if (!oe) continue;
    const ec = ecMap[oe.ecId];
    if (!ec) continue;
    // orient=T: directed from sv→ev, orient=F: directed from ev→sv
    const ptId = vpToPt[oe.orient ? ec.sv : ec.ev];
    const pt = ptId ? pts[ptId] : null;
    if (pt) verts.push(pt);
  }
  return verts;
}

// ── Print full boundary analysis ──
console.log('=== All faces with boundary topology ===\n');
for (const af of faces) {
  const stype = surfTypes[af.surfId] || '?';
  const loops = [];
  for (const bId of af.bounds) {
    const fb = fbMap[bId];
    if (!fb) continue;
    const verts = traceLoop(fb.loopId);
    loops.push({ type: fb.type, verts });
  }
  const outer = loops.filter(l => l.type === 'FACE_OUTER_BOUND');
  const inner = loops.filter(l => l.type === 'FACE_BOUND');
  const tv = loops.reduce((s, l) => s + l.verts.length, 0);
  const flag = inner.length > 0 ? ` HOLES=${inner.length}` : '';
  console.log(`AF#${af.id} (${stype}) ${af.orient ? 'T' : 'F'} loops=${loops.length}(${outer.length}O/${inner.length}I) verts=${tv}${flag}`);

  // Print coords for faces with holes
  if (inner.length > 0) {
    for (let i = 0; i < loops.length; i++) {
      const l = loops[i];
      const label = l.type === 'FACE_OUTER_BOUND' ? 'OUTER' : 'HOLE';
      console.log(`  ${label} (${l.verts.length} verts):`);
      for (const v of l.verts) console.log(`    [${v[0].toFixed(3)}, ${v[1].toFixed(3)}, ${v[2].toFixed(3)}]`);
    }
  }
  // Also print faces with high vert count
  if (tv > 8) {
    for (let i = 0; i < loops.length; i++) {
      const l = loops[i];
      const label = l.type === 'FACE_OUTER_BOUND' ? 'OUTER' : 'HOLE';
      console.log(`  ${label} (${l.verts.length} verts):`);
      for (const v of l.verts) console.log(`    [${v[0].toFixed(3)}, ${v[1].toFixed(3)}, ${v[2].toFixed(3)}]`);
    }
  }
}
