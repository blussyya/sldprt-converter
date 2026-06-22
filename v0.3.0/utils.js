'use strict';

function findAll(buf, pattern) {
    const pos = [];
    for (let i = 0; i <= buf.length - pattern.length; i++) {
        let ok = true;
        for (let j = 0; j < pattern.length; j++) {
            if (buf[i + j] !== pattern[j]) { ok = false; break; }
        }
        if (ok) pos.push(i);
    }
    return pos;
}

function triArea(a, b, c) {
    const e1 = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
    const e2 = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
    const n = [e1[1]*e2[2]-e1[2]*e2[1], e1[2]*e2[0]-e1[0]*e2[2], e1[0]*e2[1]-e1[1]*e2[0]];
    return Math.sqrt(n[0]*n[0]+n[1]*n[1]+n[2]*n[2]) / 2;
}

const sub = (a,b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const crs = (a,b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const vlen = a => Math.sqrt(a[0]*a[0]+a[1]*a[1]+a[2]*a[2]);
const vnorm = v => { const l=vlen(v); return l>1e-12?[v[0]/l,v[1]/l,v[2]/l]:[0,0,0]; };

function signedArea2d(p) {
    let a = 0;
    for (let i = 0; i < p.length; i++) {
        const j = (i + 1) % p.length;
        a += p[i][0] * p[j][1] - p[j][0] * p[i][1];
    }
    return a / 2;
}

function ptInPoly(px, py, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        if (((poly[i][1] > py) !== (poly[j][1] > py)) &&
            px < ((poly[j][0] - poly[i][0]) * (py - poly[i][1]) / (poly[j][1] - poly[i][1]) + poly[i][0])) {
            inside = !inside;
        }
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

function project3dTo2d(pts3d) {
    if (pts3d.length < 3) return pts3d.map(() => [0,0]);
    const n = vnorm(crs(sub(pts3d[1],pts3d[0]),sub(pts3d[2],pts3d[0])));
    const u = Math.abs(n[0]) < Math.abs(n[1]) ? vnorm(crs(n, [1,0,0])) : vnorm(crs(n, [0,1,0]));
    const v = crs(n, u);
    return pts3d.map(p => [dot(p, u), dot(p, v)]);
}

function triangulate(outer3d, holes3d) {
    if (holes3d && holes3d.length > 0) {
        // Create projection basis from the first 3 outer points
        const n = vnorm(crs(sub(outer3d[1],outer3d[0]), sub(outer3d[2],outer3d[0])));
        const u = Math.abs(n[0]) < Math.abs(n[1]) ? vnorm(crs(n, [1,0,0])) : vnorm(crs(n, [0,1,0]));
        const v = crs(n, u);
        const project = p => [dot(p, u), dot(p, v)];

        const outer2d = outer3d.map(project);
        const tris = earClip(outer2d);
        const result = [];
        for (const t of tris) {
            if (t[0] >= outer3d.length || t[1] >= outer3d.length || t[2] >= outer3d.length) continue;
            const a = outer3d[t[0]], b = outer3d[t[1]], c = outer3d[t[2]];
            if (!a || !b || !c) continue;
            const centroid = [(a[0]+b[0]+c[0])/3, (a[1]+b[1]+c[1])/3, (a[2]+b[2]+c[2])/3];
            const tcP2 = project(centroid);
            let insideHole = false;
            for (const hole3d of holes3d) {
                const hole2d = hole3d.map(project);
                if (ptInPoly(tcP2[0], tcP2[1], hole2d)) { insideHole = true; break; }
            }
            if (!insideHole) result.push([a, b, c]);
        }
        return result;
    }
    const outer2d = project3dTo2d(outer3d);
    const tris = earClip(outer2d);
    return tris.map(t => [outer3d[t[0]], outer3d[t[1]], outer3d[t[2]]]);
}

module.exports = { findAll, triArea, earClip, triangulate, ptInPoly, signedArea2d, project3dTo2d };
