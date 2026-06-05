const fs = require('fs');
const step = fs.readFileSync('C:\\Users\\basha\\Downloads\\isolated-usb-hub-case-1.snapshot.4\\USB hub case BOTTOM.STEP', 'utf8');
let m;

// CARTESIAN_POINT
const points = {};
const pointRe = /#(\d+)\s*=\s*CARTESIAN_POINT\s*\(\s*'[^']*'\s*,\s*\(([^)]+)\)\s*\)/g;
while ((m = pointRe.exec(step)) !== null) points[parseInt(m[1])] = m[2].split(',').map(s => parseFloat(s.trim()));
console.log('Points: ' + Object.keys(points).length);

// VERTEX_POINT: #N = VERTEX_POINT ( 'NONE', #CARTESIAN_POINT )
const vertexPoints = {};
const vpRe = /#(\d+)\s*=\s*VERTEX_POINT\s*\(\s*'[^']*'\s*,\s*#(\d+)\s*\)/g;
while ((m = vpRe.exec(step)) !== null) vertexPoints[parseInt(m[1])] = parseInt(m[2]);
console.log('Vertex points: ' + Object.keys(vertexPoints).length);

// Helper: resolve vertex ID to coordinates
function resolveVert(vid) {
  // vid might be a VERTEX_POINT -> CARTESIAN_POINT, or directly a CARTESIAN_POINT
  if (points[vid]) return points[vid];
  const cpId = vertexPoints[vid];
  if (cpId && points[cpId]) return points[cpId];
  return null;
}

// FACE_OUTER_BOUND
const fobs = {};
const fobRe = /#(\d+)\s*=\s*FACE_OUTER_BOUND\s*\(\s*'[^']*'\s*,\s*#(\d+)\s*,\s*\.\w+\.\s*\)/g;
while ((m = fobRe.exec(step)) !== null) fobs[parseInt(m[1])] = parseInt(m[2]);
console.log('FACE_OUTER_BOUND: ' + Object.keys(fobs).length);

// Also parse FACE_BOUND (some faces use this instead of FACE_OUTER_BOUND)
const fbs = {};
const fbRe = /#(\d+)\s*=\s*FACE_BOUND\s*\(\s*'[^']*'\s*,\s*#(\d+)\s*,\s*\.\w+\.\s*\)/g;
while ((m = fbRe.exec(step)) !== null) fbs[parseInt(m[1])] = parseInt(m[2]);
console.log('FACE_BOUND: ' + Object.keys(fbs).length);

// EDGE_LOOP
const edgeLoops = {};
const elRe = /#(\d+)\s*=\s*EDGE_LOOP\s*\(\s*'[^']*'\s*,\s*\(([^)]+)\)\s*\)/g;
while ((m = elRe.exec(step)) !== null) edgeLoops[parseInt(m[1])] = m[2].split(/,\s*/).map(s => parseInt(s.trim().substring(1)));
console.log('Edge loops: ' + Object.keys(edgeLoops).length);

// ORIENTED_EDGE
const orientedEdges = {};
const oeRe = /#(\d+)\s*=\s*ORIENTED_EDGE\s*\(\s*'[^']*'\s*,\s*\*\s*,\s*\*\s*,\s*#(\d+)\s*,\s*\.\w+\.\s*\)/g;
while ((m = oeRe.exec(step)) !== null) orientedEdges[parseInt(m[1])] = { edge: parseInt(m[2]) };
console.log('Oriented edges: ' + Object.keys(orientedEdges).length);

// EDGE_CURVE
const edgeCurves = {};
const ecRe = /#(\d+)\s*=\s*EDGE_CURVE\s*\(\s*'[^']*'\s*,\s*#(\d+)\s*,\s*#(\d+)\s*,\s*#(\d+)\s*,\s*\.\w+\.\s*\)/g;
while ((m = ecRe.exec(step)) !== null) edgeCurves[parseInt(m[1])] = { v1: parseInt(m[2]), v2: parseInt(m[3]), curve: parseInt(m[4]) };
console.log('Edge curves: ' + Object.keys(edgeCurves).length);

// ADVANCED_FACE
const advFaces = [];
const afRe = /#(\d+)\s*=\s*ADVANCED_FACE\s*\(\s*'[^']*'\s*,\s*\(([^)]*)\)\s*,\s*#(\d+)\s*,\s*\.(\w+)\.\s*\)/g;
while ((m = afRe.exec(step)) !== null) {
  const bounds = m[2].split(/,\s*/).filter(s => s.trim().startsWith('#')).map(s => parseInt(s.trim().substring(1)));
  advFaces.push({ id: parseInt(m[1]), bounds, surface: parseInt(m[3]), sense: m[4] });
}
console.log('Advanced faces: ' + advFaces.length);

// Build STEP face data
const allBounds = { ...fobs, ...fbs };
const stepFaces = [];
for (const af of advFaces) {
  const faceVerts = [];
  const uniqueVertIds = new Set();
  const edgeVertPairs = [];
  const edgeCount = { count: 0 };

  for (const bRef of af.bounds) {
    const elId = allBounds[bRef];
    if (!elId) continue;
    const el = edgeLoops[elId];
    if (!el) continue;
    for (const oeRef of el) {
      const oe = orientedEdges[oeRef];
      if (!oe) continue;
      const ec = edgeCurves[oe.edge];
      if (!ec) continue;
      uniqueVertIds.add(ec.v1);
      uniqueVertIds.add(ec.v2);
      const p1 = resolveVert(ec.v1);
      const p2 = resolveVert(ec.v2);
      if (p1) faceVerts.push(p1);
      if (p2) faceVerts.push(p2);
      if (p1 && p2) {
        edgeVertPairs.push({ v1: p1, v2: p2, v1id: ec.v1, v2id: ec.v2, curve: ec.curve });
        edgeCount.count++;
      }
    }
  }
  if (faceVerts.length === 0) continue;
  let cx = 0, cy = 0, cz = 0;
  for (const v of faceVerts) { cx += v[0]; cy += v[1]; cz += v[2]; }
  cx /= faceVerts.length; cy /= faceVerts.length; cz /= faceVerts.length;

  const uv = [...uniqueVertIds].map(id => resolveVert(id)).filter(Boolean);
  let nx = 0, ny = 0, nz = 0;
  if (uv.length >= 3) {
    const e1 = [uv[1][0] - uv[0][0], uv[1][1] - uv[0][1], uv[1][2] - uv[0][2]];
    const e2 = [uv[2][0] - uv[0][0], uv[2][1] - uv[0][1], uv[2][2] - uv[0][2]];
    nx = e1[1] * e2[2] - e1[2] * e2[1];
    ny = e1[2] * e2[0] - e1[0] * e2[2];
    nz = e1[0] * e2[1] - e1[1] * e2[0];
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (nl > 0) { nx /= nl; ny /= nl; nz /= nl; }
  }

  stepFaces.push({
    id: af.id, uniqueVerts: uniqueVertIds.size, totalVerts: faceVerts.length,
    edges: edgeVertPairs.length, cx, cy, cz, nx, ny, nz,
    sense: af.sense, surface: af.surface, edgeVerts: edgeVertPairs
  });
}
console.log('STEP faces with data: ' + stepFaces.length);

// Print all STEP faces
for (const tf of stepFaces) {
  console.log('  STEP #' + tf.id + ': ' + tf.uniqueVerts + 'uV ' + tf.edges + 'e surf=#' + tf.surface + ' sense=' + tf.sense + ' centroid=(' + tf.cx.toFixed(1) + ',' + tf.cy.toFixed(1) + ',' + tf.cz.toFixed(1) + ')');
}

// Parse SLDPRT
const { readSLDPRT, findStream } = require('./src/sldprt-reader');
const fp = 'C:\\Users\\basha\\Downloads\\isolated-usb-hub-case-1.snapshot.4\\USB hub case BOTTOM.SLDPRT';
const { raw, streams } = readSLDPRT(fp);
const dl = findStream(streams, 'Contents/DisplayLists').data;
const dv = new DataView(dl.buffer, dl.byteOffset, dl.byteLength);
function findAll(buf, pat) {
  const p = [];
  for (let i = 0; i <= buf.length - pat.length; i++) {
    let ok = true;
    for (let j = 0; j < pat.length; j++) { if (buf[i + j] !== pat[j]) { ok = false; break; } }
    if (ok) p.push(i);
  }
  return p;
}
const marker = new Uint8Array([0x0c, 0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00]);
const mps = findAll(dl, marker);
const F = [];
for (const mp of mps) {
  const ec = dv.getUint32(mp - 4, true);
  if (ec < 1 || ec > 500) continue;
  const ft = dv.getUint32(mp + 8, true);
  if (ft !== 2) continue;
  const vc = dv.getUint32(mp + 12, true);
  if (vc < 3 || vc > 5000) continue;
  const vs = mp + 16;
  if (vs + vc * 12 > dl.length) continue;
  F.push({ ec, vc, vs, mp, ve: vs + vc * 12 });
}

const sldprtFaces = [];
for (let fi = 0; fi < F.length; fi++) {
  const f = F[fi];
  let cx = 0, cy = 0, cz = 0;
  for (let vi = 0; vi < f.vc; vi++) {
    cx += dv.getFloat32(f.vs + vi * 12, true) * 1000;
    cy += dv.getFloat32(f.vs + vi * 12 + 4, true) * 1000;
    cz += dv.getFloat32(f.vs + vi * 12 + 8, true) * 1000;
  }
  cx /= f.vc; cy /= f.vc; cz /= f.vc;
  const v0 = [dv.getFloat32(f.vs, true) * 1000, dv.getFloat32(f.vs + 4, true) * 1000, dv.getFloat32(f.vs + 8, true) * 1000];
  const v1 = [dv.getFloat32(f.vs + 12, true) * 1000, dv.getFloat32(f.vs + 16, true) * 1000, dv.getFloat32(f.vs + 20, true) * 1000];
  const v2 = [dv.getFloat32(f.vs + 24, true) * 1000, dv.getFloat32(f.vs + 28, true) * 1000, dv.getFloat32(f.vs + 32, true) * 1000];
  const e1 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
  const e2 = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]];
  let nx = e1[1] * e2[2] - e1[2] * e2[1];
  let ny = e1[2] * e2[0] - e1[0] * e2[2];
  let nz = e1[0] * e2[1] - e1[1] * e2[0];
  const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (nl > 0) { nx /= nl; ny /= nl; nz /= nl; }
  sldprtFaces.push({ fi, vc: f.vc, ec: f.ec, cx, cy, cz, nx, ny, nz });
}

// Match SLDPRT to STEP by centroid distance
console.log('\n=== SLDPRT <-> STEP MATCHING ===');
console.log('SLDPRT: ' + sldprtFaces.length + ' faces, STEP: ' + stepFaces.length + ' faces\n');

const usedStep = new Set();
for (const sf of sldprtFaces) {
  let bestDist = Infinity, bestStep = null;
  for (const tf of stepFaces) {
    if (usedStep.has(tf.id)) continue;
    const d = Math.sqrt((sf.cx - tf.cx) ** 2 + (sf.cy - tf.cy) ** 2 + (sf.cz - tf.cz) ** 2);
    if (d < bestDist) { bestDist = d; bestStep = tf; }
  }
  if (bestStep && bestDist < 10) {
    usedStep.add(bestStep.id);
    const dot = Math.abs(sf.nx * bestStep.nx + sf.ny * bestStep.ny + sf.nz * bestStep.nz);
    console.log('F' + sf.fi.toString().padStart(2) + ' (' + sf.vc + 'V ' + sf.ec + 'E) <--> #' + bestStep.id.toString().padStart(4) + ' (' + bestStep.uniqueVerts + 'uV ' + bestStep.edges + 'e) dist=' + bestDist.toFixed(1) + 'mm normDot=' + dot.toFixed(3) + ' surf=#' + bestStep.surface);
  } else {
    console.log('F' + sf.fi.toString().padStart(2) + ' (' + sf.vc + 'V ' + sf.ec + 'E) <--> NO MATCH (closest=' + (bestDist < Infinity ? bestDist.toFixed(1) : 'N/A') + 'mm)');
  }
}

console.log('\nUnmatched STEP faces:');
for (const tf of stepFaces) {
  if (!usedStep.has(tf.id)) {
    console.log('  #' + tf.id + ' (' + tf.uniqueVerts + 'uV ' + tf.edges + 'e) surf=#' + tf.surface);
  }
}
