const fs = require('fs');

const STEP_PATH = 'C:\\Users\\basha\\Downloads\\isolated-usb-hub-case-1.snapshot.4\\USB hub case BOTTOM.STEP';
const STL_PATH = 'C:\\Users\\basha\\Downloads\\isolated-usb-hub-case-1.snapshot.4\\step-tess-test.stl';

const sub = (a,b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const add = (a,b) => [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
const scl = (v,s) => [v[0]*s, v[1]*s, v[2]*s];
const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const crs = (a,b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const vlen = v => Math.sqrt(v[0]**2+v[1]**2+v[2]**2);
const vnorm = v => { const l=vlen(v); return l>1e-12?[v[0]/l,v[1]/l,v[2]/l]:[0,0,0]; };
const dist = (a,b) => vlen(sub(a,b));

const step = fs.readFileSync(STEP_PATH, 'utf8');
const ents = {};
let cId = null, cTx = '';
for (const line of step.split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('/*') || t.startsWith('*')) continue;
  const sm = t.match(/^#(\d+)\s*=\s*(.*)/);
  if (sm) { if (cId !== null) ents[cId] = cTx; cId = +sm[1]; cTx = sm[2]; }
  else if (cId !== null) cTx += ' ' + t;
  if (cTx.endsWith(';')) { if (cId !== null) ents[cId] = cTx.slice(0, -1).trim(); cId = null; cTx = ''; }
}
if (cId !== null) ents[cId] = cTx;

const gR = t => [...t.matchAll(/#(\d+)/g)].map(m => +m[1]);
const gT = t => { const m = t.match(/^(\w[\w_]*)\s*\(/); return m ? m[1] : t.split(' ')[0]; };

function getNumsAfterRefs(text) {
  const refs = gR(text);
  const refSet = new Set(refs);
  return [...text.matchAll(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)].map(m => +m[0]).filter(n => !refSet.has(n));
}

const pts = {}, dirs = {}, a2p3d = {}, circles = {}, bsplines = {}, bsplineKnots = {};
const vpToPt = {}, ecMap = {}, oeMap = {}, elMap = {}, fbMap = {};
const surfData = {}, faces = [];

for (const [id, text] of Object.entries(ents)) {
  const tp = gT(text);
  const iid = +id;
  if (tp === 'CARTESIAN_POINT') {
    const c = text.match(/\(\s*([-\d.E+]+)\s*,\s*([-\d.E+]+)\s*,\s*([-\d.E+]+)\s*\)/);
    if (c) pts[iid] = [+c[1], +c[2], +c[3]];
  } else if (tp === 'DIRECTION') {
    const c = text.match(/\(\s*([-\d.E+]+)\s*,\s*([-\d.E+]+)\s*,\s*([-\d.E+]+)\s*\)/);
    if (c) dirs[iid] = [+c[1], +c[2], +c[3]];
  } else if (tp === 'AXIS2_PLACEMENT_3D') {
    const r = gR(text);
    if (r.length >= 3) a2p3d[iid] = r;
  } else if (tp === 'CIRCLE') {
    const r = gR(text); const n = getNumsAfterRefs(text);
    if (r.length >= 1 && n.length >= 1) circles[iid] = [r[0], n[0]];
  } else if (tp === 'B_SPLINE_CURVE_WITH_KNOTS') {
    bsplines[iid] = gR(text);
    const arrays = [...text.matchAll(/\(\s*([\d\s,.\-E+]+)\s*\)/g)];
    if (arrays.length >= 2) {
      const kMults = arrays[arrays.length-2][1].split(',').map(s => parseInt(s.trim()));
      const kVals = arrays[arrays.length-1][1].split(',').map(s => parseFloat(s.trim()));
      let knots = [];
      for (let i = 0; i < kMults.length && i < kVals.length; i++) {
        for (let j = 0; j < kMults[i]; j++) knots.push(kVals[i]);
      }
      bsplineKnots[iid] = knots;
    }
  } else if (tp === 'VERTEX_POINT') {
    const r = gR(text);
    if (r.length >= 1) vpToPt[iid] = r[0];
  } else if (tp === 'EDGE_CURVE') {
    const r = gR(text);
    if (r.length >= 3) ecMap[iid] = r;
  } else if (tp === 'ORIENTED_EDGE') {
    const r = gR(text);
    const o = text.includes('.T.');
    if (r.length >= 1) oeMap[iid] = [r[0], o];
  } else if (tp === 'EDGE_LOOP') {
    elMap[iid] = gR(text);
  } else if (tp === 'FACE_OUTER_BOUND' || tp === 'FACE_BOUND') {
    const r = gR(text);
    if (r.length >= 1) fbMap[iid] = [r[0], tp];
  } else if (tp === 'PLANE') {
    surfData[iid] = ['PLANE', gR(text)[0]];
  } else if (tp === 'CYLINDRICAL_SURFACE') {
    const r = gR(text); const n = getNumsAfterRefs(text);
    surfData[iid] = ['CYL', r[0], n[0]];
  } else if (tp === 'CONICAL_SURFACE') {
    const r = gR(text); const n = getNumsAfterRefs(text);
    surfData[iid] = ['CON', r[0], n[0], n[1]];
  } else if (tp === 'ADVANCED_FACE') {
    const r = gR(text);
    const o = text.includes('.T.');
    faces.push({ id: iid, bounds: r.slice(0, -1), surfId: r[r.length - 1], orient: o });
  }
}

for (const id in bsplines) {
  bsplines[id] = bsplines[id].filter(rr => pts[rr] !== undefined);
}

function evalA2P3D(id) {
  const a = a2p3d[id];
  if (!a) return null;
  const loc = pts[a[0]], zdir = dirs[a[1]], xdir = dirs[a[2]];
  if (!loc || !zdir || !xdir) return null;
  const n = vnorm(zdir), r = vnorm(xdir), s = vnorm(crs(n, r));
  return { center: loc, normal: n, refDir: r, sideDir: s };
}

function sampleArc(circleId, startPt, endPt, n) {
  const c = circles[circleId];
  if (!c) return [startPt];
  const ap = evalA2P3D(c[0]);
  if (!ap) return [startPt];
  const C = ap.center, N = ap.normal, R = ap.refDir, S = ap.sideDir;
  const r = c[1];
  function angle(p) {
    const v = sub(p, C);
    const vp = sub(v, scl(N, dot(v, N)));
    const l = vlen(vp);
    if (l < 1e-10) return 0;
    const vn = scl(vp, 1/l);
    return Math.atan2(dot(vn, S), dot(vn, R));
  }
  let a0 = angle(startPt), a1 = angle(endPt);
  let da = a1 - a0;
  if (da > Math.PI) da -= 2*Math.PI;
  if (da < -Math.PI) da += 2*Math.PI;
  if (Math.abs(da) < 1e-10) da = 2*Math.PI;
  const result = [];
  for (let i = 0; i <= n; i++) {
    const ang = a0 + da * (i / n);
    result.push(add(C, add(scl(R, r*Math.cos(ang)), scl(S, r*Math.sin(ang)))));
  }
  return result;
}

function evalBSpline(id, n) {
  const cp = bsplines[id];
  if (!cp || cp.length < 2) return [];
  const cpts = cp.map(i => pts[i]).filter(Boolean);
  if (cpts.length < 2) return cpts;
  const num = cpts.length, deg = Math.min(3, num - 1);
  let knots;
  if (bsplineKnots[id] && bsplineKnots[id].length === num + deg + 1) {
    knots = bsplineKnots[id];
  } else {
    knots = [];
    for (let i = 0; i <= num + deg; i++) knots.push(i);
  }
  function findSpan(u) {
    if (u >= knots[num]) return num - 1;
    if (u <= knots[deg]) return deg;
    let lo = deg, hi = num, mid = Math.floor((lo+hi)/2);
    while (u < knots[mid] || u >= knots[mid+1]) {
      if (u < knots[mid]) hi = mid; else lo = mid + 1;
      mid = Math.floor((lo+hi)/2);
    }
    return mid;
  }
  function basis(i, u) {
    const N = new Array(deg+1).fill(0), left = new Array(deg+1).fill(0), right = new Array(deg+1).fill(0);
    N[0] = 1;
    for (let j = 1; j <= deg; j++) {
      left[j] = u - knots[i+1-j]; right[j] = knots[i+j] - u;
      let saved = 0;
      for (let r = 0; r < j; r++) {
        const tmp = N[r] / (right[r+1] + left[j-r]);
        N[r] = saved + right[r+1] * tmp; saved = left[j-r] * tmp;
      }
      N[j] = saved;
    }
    return N;
  }
  const result = [], uMin = knots[deg], uMax = knots[num];
  for (let i = 0; i <= n; i++) {
    const u = uMin + (uMax - uMin) * (i / n);
    const k = findSpan(u), N = basis(k, u);
    const p = [0, 0, 0];
    for (let j = 0; j <= deg; j++) {
      const idx = k - deg + j;
      if (idx >= 0 && idx < num) { p[0] += N[j]*cpts[idx][0]; p[1] += N[j]*cpts[idx][1]; p[2] += N[j]*cpts[idx][2]; }
    }
    result.push(p);
  }
  return result;
}

function traceLoop(loopId) {
  const oeIds = elMap[loopId];
  if (!oeIds) return [];
  const result = [];
  for (const oeId of oeIds) {
    const oe = oeMap[oeId];
    if (!oe) continue;
    const ec = ecMap[oe[0]];
    if (!ec) continue;
    const fwd = oe[1];
    const startPt = pts[vpToPt[fwd ? ec[0] : ec[1]]];
    const endPt = pts[vpToPt[fwd ? ec[1] : ec[0]]];
    if (!startPt || !endPt) continue;
    const curveEnt = ents[ec[2]];
    const ct = curveEnt ? gT(curveEnt) : '?';
    if (ct === 'LINE') {
      result.push([...startPt]);
    } else if (ct === 'CIRCLE') {
      const arc = sampleArc(ec[2], startPt, endPt, 16);
      for (let i = 0; i < arc.length - 1; i++) result.push(arc[i]);
    } else if (ct === 'B_SPLINE_CURVE_WITH_KNOTS') {
      const bs = evalBSpline(ec[2], 24);
      for (let i = 0; i < bs.length - 1; i++) result.push(bs[i]);
    } else {
      result.push([...startPt]);
    }
  }
  return result;
}

function dedup(boundary, tol) {
  if (boundary.length < 3) return boundary;
  const is2D = boundary[0].length === 2;
  const distFn = is2D ? (a,b) => Math.sqrt((a[0]-b[0])**2+(a[1]-b[1])**2) : dist;
  const r = [boundary[0]];
  for (let i = 1; i < boundary.length; i++) {
    if (distFn(boundary[i], r[r.length-1]) > tol) r.push(boundary[i]);
  }
  while (r.length > 1 && distFn(r[0], r[r.length-1]) < tol) r.pop();
  return r;
}

function proj2d(p3d, n) {
  const nn = vnorm(n);
  const u = Math.abs(nn[0]) < Math.abs(nn[1]) ? vnorm(crs(nn, [1,0,0])) : vnorm(crs(nn, [0,1,0]));
  const v = crs(nn, u);
  return p3d.map(p => [dot(p,u), dot(p,v)]);
}

function signedArea2d(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const j = (i+1)%p.length; a += p[i][0]*p[j][1] - p[j][0]*p[i][1]; }
  return a/2;
}

function ptInPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length-1; i < poly.length; j = i++) {
    const xi=poly[i][0], yi=poly[i][1], xj=poly[j][0], yj=poly[j][1];
    if ((yi>py) !== (yj>py) && px < (xj-xi)*(py-yi)/(yj-yi)+xi) inside = !inside;
  }
  return inside;
}

function earClip(p2d) {
  const n = p2d.length;
  if (n < 3) return [];
  if (n === 3) return [[0,1,2]];
  let idx = [];
  for (let i = 0; i < n; i++) idx.push(i);
  if (signedArea2d(p2d) < 0) idx.reverse();
  const tris = [];
  let safety = idx.length * 5;
  while (idx.length > 3 && safety-- > 0) {
    let found = false;
    for (let i = 0; i < idx.length; i++) {
      const prev = (i-1+idx.length)%idx.length, next = (i+1)%idx.length;
      const a = p2d[idx[prev]], b = p2d[idx[i]], c = p2d[idx[next]];
      if ((b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]) < 0) continue;
      let hasInner = false;
      for (let j = 0; j < idx.length; j++) {
        if (j===prev||j===i||j===next) continue;
        if (ptInPoly(p2d[idx[j]][0], p2d[idx[j]][1], [a,b,c])) { hasInner = true; break; }
      }
      if (hasInner) continue;
      tris.push([idx[prev], idx[i], idx[next]]);
      idx.splice(i, 1); found = true; break;
    }
    if (!found) break;
  }
  if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
  return tris;
}

function segmentsIntersect2d(a1, a2, b1, b2) {
  const d1x = a2[0]-a1[0], d1y = a2[1]-a1[1];
  const d2x = b2[0]-b1[0], d2y = b2[1]-b1[1];
  const cross = d1x*d2y - d1y*d2x;
  if (Math.abs(cross) < 1e-12) return false;
  const t = ((b1[0]-a1[0])*d2y - (b1[1]-a1[1])*d2x) / cross;
  const u = ((b1[0]-a1[0])*d1y - (b1[1]-a1[1])*d1x) / cross;
  return t > 1e-9 && t < 1-1e-9 && u > 1e-9 && u < 1-1e-9;
}

function earClipWithHoles(outer2d, holes2d, outer3d, holes3d) {
  if (holes2d.length === 0) {
    const tris = earClip(outer2d);
    return tris.map(t => [outer3d[t[0]], outer3d[t[1]], outer3d[t[2]]]);
  }

  const tris = earClip(outer2d);
  const result = [];
  for (const t of tris) {
    if (t[0] >= outer3d.length || t[1] >= outer3d.length || t[2] >= outer3d.length) continue;
    const a = outer3d[t[0]], b = outer3d[t[1]], c = outer3d[t[2]];
    if (!a || !b || !c) continue;
    const tc = [(a[0]+b[0]+c[0])/3, (a[1]+b[1]+c[1])/3, (a[2]+b[2]+c[2])/3];
    const n = vnorm(crs(sub(outer3d[1],outer3d[0]),sub(outer3d[2],outer3d[0])));
    const u = Math.abs(n[0]) < Math.abs(n[1]) ? vnorm(crs(n, [1,0,0])) : vnorm(crs(n, [0,1,0]));
    const v = crs(n, u);
    const tcP2 = [dot(tc, u), dot(tc, v)];
    let insideHole = false;
    for (const hp2d of holes2d) {
      if (ptInPoly(tcP2[0], tcP2[1], hp2d)) { insideHole = true; break; }
    }
    if (!insideHole) result.push([a, b, c]);
  }
  return result;
}

function triContainsAnyPoint(tri, pts) {
  for (const p of pts) {
    if (ptInPoly(p[0], p[1], tri)) return true;
  }
  return false;
}

function polyContainsAnyPoint(poly, pts) {
  for (const p of pts) {
    if (ptInPoly(p[0], p[1], poly)) return true;
  }
  return false;
}

function edgesIntersect(polyA, polyB) {
  for (let i = 0; i < polyA.length; i++) {
    const a1 = polyA[i], a2 = polyA[(i+1)%polyA.length];
    for (let j = 0; j < polyB.length; j++) {
      const b1 = polyB[j], b2 = polyB[(j+1)%polyB.length];
      if (segmentsIntersect2d(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

function triArea(a, b, c) { return vlen(crs(sub(b,a), sub(c,a))) / 2; }

function toCylParam(p, ap) {
  const v = sub(p, ap.center);
  return [Math.atan2(dot(v, ap.sideDir), dot(v, ap.refDir)), dot(v, ap.normal)];
}

function fromCylParam(theta, t, radius, ap) {
  const dir = add(scl(ap.refDir, Math.cos(theta)), scl(ap.sideDir, Math.sin(theta)));
  return add(ap.center, add(scl(ap.normal, t), scl(dir, radius)));
}

function toConParam(p, sd, ap) {
  const v = sub(p, ap.center);
  const theta = Math.atan2(dot(v, ap.sideDir), dot(v, ap.refDir));
  const t = dot(v, ap.normal);
  return [theta, t];
}

function fromConParam(theta, t, sd, ap) {
  const baseR = sd[2], halfAngle = sd[3];
  const r = baseR + t * Math.tan(halfAngle);
  const dir = add(scl(ap.refDir, Math.cos(theta)), scl(ap.sideDir, Math.sin(theta)));
  return add(ap.center, add(scl(ap.normal, t), scl(dir, r)));
}

function traceLoopParam(loopId, stype, sd, surfAp) {
  const oeIds = elMap[loopId];
  if (!oeIds) return [];
  const isCyl = stype === 'CYL' || stype === 'CON';
  const result = [];
  let lastTheta = null;
  for (const oeId of oeIds) {
    const oe = oeMap[oeId];
    if (!oe) continue;
    const ec = ecMap[oe[0]];
    if (!ec) continue;
    const fwd = oe[1];
    const startPt = pts[vpToPt[fwd ? ec[0] : ec[1]]];
    const endPt = pts[vpToPt[fwd ? ec[1] : ec[0]]];
    if (!startPt || !endPt) continue;
    const curveEnt = ents[ec[2]];
    const ct = curveEnt ? gT(curveEnt) : '?';

    if (!isCyl) {
      if (ct === 'LINE') { result.push([...startPt]); }
      else if (ct === 'CIRCLE') {
        const arc = sampleArc(ec[2], startPt, endPt, 16);
        for (let i = 0; i < arc.length - 1; i++) result.push(arc[i]);
      } else if (ct === 'B_SPLINE_CURVE_WITH_KNOTS') {
      const bs = evalBSpline(ec[2], 12);
      for (let i = 0; i < bs.length - 1; i++) result.push(bs[i]);
      } else { result.push([...startPt]); }
      continue;
    }

    const toParam = stype === 'CYL' ? (p) => toCylParam(p, surfAp) : (p) => toConParam(p, sd, surfAp);

    if (ct === 'LINE') {
      const sp = toParam(startPt), ep = toParam(endPt);
      let t1 = sp[0], h1 = sp[1];
      let t2 = ep[0], h2 = ep[1];
      if (lastTheta !== null) {
        while (t1 - lastTheta > Math.PI) t1 -= 2*Math.PI;
        while (t1 - lastTheta < -Math.PI) t1 += 2*Math.PI;
      }
      let dt = t2 - sp[0];
      while (dt > Math.PI) dt -= 2*Math.PI;
      while (dt < -Math.PI) dt += 2*Math.PI;
      t2 = t1 + dt;
      // Lines on curved surfaces are short — just emit start and end
      result.push([t1, h1]);
      if (Math.abs(dt) > 1e-6 || Math.abs(h2-h1) > 1e-6) result.push([t2, h2]);
      lastTheta = t2;
    } else if (ct === 'CIRCLE') {
      const c = circles[ec[2]];
      if (!c) { result.push(toParam(startPt)); lastTheta = toParam(startPt)[0]; continue; }
      const cap = evalA2P3D(c[0]);
      if (!cap) { result.push(toParam(startPt)); lastTheta = toParam(startPt)[0]; continue; }
      const arc3d = sampleArc(ec[2], startPt, endPt, 16);
      for (let i = 0; i < arc3d.length - 1; i++) {
        const pp = stype === 'CYL' ? toCylParam(arc3d[i], surfAp) : toConParam(arc3d[i], sd, surfAp);
        let [t, h] = pp;
        if (lastTheta !== null) {
          while (t - lastTheta > Math.PI) t -= 2*Math.PI;
          while (t - lastTheta < -Math.PI) t += 2*Math.PI;
        }
        result.push([t, h]);
        lastTheta = t;
      }
    } else if (ct === 'B_SPLINE_CURVE_WITH_KNOTS') {
      const bs = evalBSpline(ec[2], 12);
      for (let i = 0; i < bs.length - 1; i++) {
        const pp = stype === 'CYL' ? toCylParam(bs[i], surfAp) : toConParam(bs[i], sd, surfAp);
        let [t, h] = pp;
        if (lastTheta !== null) {
          while (t - lastTheta > Math.PI) t -= 2*Math.PI;
          while (t - lastTheta < -Math.PI) t += 2*Math.PI;
        }
        result.push([t, h]);
        lastTheta = t;
      }
    } else {
      const pp = toParam(startPt);
      let [t, h] = pp;
      if (lastTheta !== null) {
        while (t - lastTheta > Math.PI) t -= 2*Math.PI;
        while (t - lastTheta < -Math.PI) t += 2*Math.PI;
      }
      result.push([t, h]);
      lastTheta = t;
    }
  }
  return result;
}

// ==================== MAIN ====================
const allTris = [];
const faceStats = { PLANE: 0, CYL: 0, CON: 0 };
const faceTriCounts = {};

for (const af of faces) {
  const sd = surfData[af.surfId];
  if (!sd) continue;
  const stype = sd[0];
  faceStats[stype] = (faceStats[stype] || 0) + 1;

  const ap = evalA2P3D(sd[1]);
  if (!ap) continue;
  const N = ap.normal;
  const isCurved = stype === 'CYL' || stype === 'CON';

  const outerLoops = [], innerLoops = [];
  for (const bId of af.bounds) {
    const fb = fbMap[bId];
    if (!fb) continue;
    let bv;
    if (isCurved) {
      bv = traceLoopParam(fb[0], stype, sd, ap);
    } else {
      bv = traceLoop(fb[0]);
    }
    if (bv.length < 3) continue;
    const dv = dedup(bv, 0.0001);
    if (dv.length < 3) continue;
    if (fb[1] === 'FACE_OUTER_BOUND') outerLoops.push(dv);
    else innerLoops.push(dv);
  }
  if (outerLoops.length === 0) continue;

  const faceTris = [];

  for (const outer of outerLoops) {
    let tris;
    if (isCurved) {
      tris = earClip(outer);
      if (tris.length === 0) {
        const s = outer.map((p,i)=>({i,a:Math.atan2(p[1],p[0])}));
        s.sort((a,b)=>a.a-b.a);
        const ord = s.map(x=>x.i);
        for (let i = 1; i < ord.length-1; i++) tris.push([ord[0],ord[i],ord[i+1]]);
      }
      for (const t of tris) {
        const p0 = stype === 'CYL' ? fromCylParam(outer[t[0]][0], outer[t[0]][1], sd[2], ap) : fromConParam(outer[t[0]][0], outer[t[0]][1], sd, ap);
        const p1 = stype === 'CYL' ? fromCylParam(outer[t[1]][0], outer[t[1]][1], sd[2], ap) : fromConParam(outer[t[1]][0], outer[t[1]][1], sd, ap);
        const p2 = stype === 'CYL' ? fromCylParam(outer[t[2]][0], outer[t[2]][1], sd[2], ap) : fromConParam(outer[t[2]][0], outer[t[2]][1], sd, ap);
        faceTris.push([p0, p1, p2]);
      }
    } else {
      const p2d = proj2d(outer, N);
      const holeP2ds = innerLoops.map(h => proj2d(h, N));
      const holeTris = earClipWithHoles(p2d, holeP2ds, outer, innerLoops);
      if (holeTris.length > 0) {
        for (const tri of holeTris) faceTris.push(tri);
      } else {
        tris = earClip(p2d);
        if (tris.length === 0) {
          const s = p2d.map((p,i)=>({i,a:Math.atan2(p[1],p[0])}));
          s.sort((a,b)=>a.a-b.a);
          const ord = s.map(x=>x.i);
          for (let i = 1; i < ord.length-1; i++) tris.push([ord[0],ord[i],ord[i+1]]);
        }
        for (const t of tris) faceTris.push([outer[t[0]], outer[t[1]], outer[t[2]]]);
      }
    }
  }

  faceTriCounts[af.id] = { type: stype, tris: faceTris.length, outerVerts: outerLoops.map(l=>l.length), innerVerts: innerLoops.map(l=>l.length), area: faceTris.reduce((s,t) => s + triArea(t[0],t[1],t[2]), 0) };
  if (faceTriCounts[af.id].area < 0.1) continue;
  for (const t of faceTris) { if (t.length===3 && t[0] && t[1] && t[2]) allTris.push(t); }
}

console.log('Face stats:', faceStats);

let totalArea = 0, validCount = 0;
const valid = allTris.filter(tri => {
  for (const v of tri) if (!v || v[0] === undefined) return false;
  const a = triArea(tri[0], tri[1], tri[2]);
  if (a > 0.001) {
    // Check for degenerate triangles (very thin = high aspect ratio)
    const ab = dist(tri[0], tri[1]), bc = dist(tri[1], tri[2]), ca = dist(tri[2], tri[0]);
    const maxSide = Math.max(ab, bc, ca);
    const semiperim = (ab + bc + ca) / 2;
    const height = 2 * a / maxSide;
    // Filter extremely thin triangles (height < 0.01mm)  
    if (height < 0.01) return false;
    totalArea += a; validCount++; return true;
  }
  return false;
});

const triKey = t => {
  const vs = [t[0],t[1],t[2]].map(v => v.map(x => Math.round(x*1000)/1000).join(','));
  vs.sort();
  return vs.join('|');
};
const seen = new Set();
const deduped = [];
for (const t of valid) {
  const k = triKey(t);
  if (!seen.has(k)) { seen.add(k); deduped.push(t); }
}
const finalTris = deduped;

console.log('Total raw:', allTris.length, 'Valid:', validCount, 'Deduped:', finalTris.length);
console.log('Area:', totalArea.toFixed(1), 'mm²');
console.log('Ref: 2486 tris, 7992.7 mm²');
console.log(`Match: ${(finalTris.length/2486*100).toFixed(1)}% tris, ${(totalArea/7992.7*100).toFixed(1)}% area`);

const largeTris = finalTris.filter(t => triArea(t[0],t[1],t[2]) > 100);
console.log('Large tris (>100mm²):', largeTris.length);
if (largeTris.length > 0) {
  for (const t of largeTris.slice(0,5)) {
    console.log('  area:', triArea(t[0],t[1],t[2]).toFixed(1), 'v0:', t[0].map(x=>x.toFixed(1)).join(','), 'v1:', t[1].map(x=>x.toFixed(1)).join(','), 'v2:', t[2].map(x=>x.toFixed(1)).join(','));
  }
}

console.log('\n=== Per-face ===');
for (const af of faces) {
  const info = faceTriCounts[af.id];
  const sd = surfData[af.surfId];
  if (!info) console.log(`AF#${af.id} (${sd?sd[0]:'?'}): NO OUTPUT`);
  else if (info.tris === 0) console.log(`AF#${af.id} (${info.type}): 0 tris, outer=${JSON.stringify(info.outerVerts)}, inner=${JSON.stringify(info.innerVerts)}`);
}
for (const [id, info] of Object.entries(faceTriCounts)) {
  if (info.tris > 0) console.log(`AF#${id} (${info.type}): ${info.tris} tris, ${info.area.toFixed(1)}mm², outer=${JSON.stringify(info.outerVerts)}, inner=${JSON.stringify(info.innerVerts)}`);
}

const buf = Buffer.alloc(84 + finalTris.length * 50);
buf.writeUInt32LE(finalTris.length, 80);
let o = 84;
for (const tri of finalTris) {
  const n = vnorm(crs(sub(tri[1],tri[0]), sub(tri[2],tri[0])));
  buf.writeFloatLE(n[0],o); buf.writeFloatLE(n[1],o+4); buf.writeFloatLE(n[2],o+8); o+=12;
  buf.writeFloatLE(tri[0][0],o); buf.writeFloatLE(tri[0][1],o+4); buf.writeFloatLE(tri[0][2],o+8); o+=12;
  buf.writeFloatLE(tri[1][0],o); buf.writeFloatLE(tri[1][1],o+4); buf.writeFloatLE(tri[1][2],o+8); o+=12;
  buf.writeFloatLE(tri[2][0],o); buf.writeFloatLE(tri[2][1],o+4); buf.writeFloatLE(tri[2][2],o+8); o+=12;
  buf.writeUInt16LE(0,o); o+=2;
}
fs.writeFileSync(STL_PATH, buf);
console.log('Wrote', STL_PATH);
