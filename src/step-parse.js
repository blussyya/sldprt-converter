'use strict';

function parseSTEP(text) {
    const ents = {};
    let cId = null, cTx = '';
    for (const line of text.split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('/*') || t.startsWith('*')) continue;
        const sm = t.match(/^#(\d+)\s*=\s*(.*)/);
        if (sm) { if (cId !== null) ents[cId] = cTx; cId = +sm[1]; cTx = sm[2]; }
        else if (cId !== null) cTx += ' ' + t;
        if (cTx.endsWith(';')) { if (cId !== null) ents[cId] = cTx.slice(0, -1).trim(); cId = null; cTx = ''; }
    }
    if (cId !== null) ents[cId] = cTx;
    return ents;
}

function getRefs(text) { return [...text.matchAll(/#(\d+)/g)].map(m => +m[1]); }

function getType(text) { const m = text.match(/^(\w[\w_]*)\s*\(/); return m ? m[1] : text.split(' ')[0]; }

function getNumsAfterRefs(text) {
    const refs = new Set(getRefs(text));
    return [...text.matchAll(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)].map(m => +m[0]).filter(n => !refs.has(n));
}

function buildLookup(ents) {
    const pts = {}, dirs = {}, a2p3d = {}, circles = {};
    const vpToPt = {}, ecMap = {}, oeMap = {}, elMap = {}, fbMap = {};
    const surfData = {}, faces = [];

    for (const [id, text] of Object.entries(ents)) {
        const tp = getType(text);
        const iid = +id;
        if (tp === 'CARTESIAN_POINT') {
            const c = text.match(/\(\s*([-\d.E+]+)\s*,\s*([-\d.E+]+)\s*,\s*([-\d.E+]+)\s*\)/);
            if (c) pts[iid] = [+c[1], +c[2], +c[3]];
        } else if (tp === 'DIRECTION') {
            const c = text.match(/\(\s*([-\d.E+]+)\s*,\s*([-\d.E+]+)\s*,\s*([-\d.E+]+)\s*\)/);
            if (c) dirs[iid] = [+c[1], +c[2], +c[3]];
        } else if (tp === 'AXIS2_PLACEMENT_3D') {
            const r = getRefs(text);
            if (r.length >= 3) a2p3d[iid] = r;
        } else if (tp === 'CIRCLE') {
            const r = getRefs(text); const n = getNumsAfterRefs(text);
            if (r.length >= 1 && n.length >= 1) circles[iid] = [r[0], n[0]];
        } else if (tp === 'VERTEX_POINT') {
            const r = getRefs(text); if (r.length >= 1) vpToPt[iid] = r[0];
        } else if (tp === 'EDGE_CURVE') {
            const r = getRefs(text); if (r.length >= 3) ecMap[iid] = r;
        } else if (tp === 'ORIENTED_EDGE') {
            const r = getRefs(text); const o = text.includes('.T.');
            if (r.length >= 1) oeMap[iid] = [r[0], o];
        } else if (tp === 'EDGE_LOOP') {
            elMap[iid] = getRefs(text);
        } else if (tp === 'FACE_OUTER_BOUND' || tp === 'FACE_BOUND') {
            const r = getRefs(text); if (r.length >= 1) fbMap[iid] = [r[0], tp];
        } else if (tp === 'PLANE') {
            surfData[iid] = { type: 'PLANE', a2p3d: getRefs(text)[0] };
        } else if (tp === 'CYLINDRICAL_SURFACE') {
            const r = getRefs(text); const n = getNumsAfterRefs(text);
            surfData[iid] = { type: 'CYL', a2p3d: r[0], radius: n[0] };
        } else if (tp === 'CONICAL_SURFACE') {
            const r = getRefs(text); const n = getNumsAfterRefs(text);
            surfData[iid] = { type: 'CON', a2p3d: r[0], radius: n[0], halfAngle: n[1] };
        } else if (tp === 'SPHERICAL_SURFACE') {
            const r = getRefs(text); const n = getNumsAfterRefs(text);
            surfData[iid] = { type: 'SPHERE', a2p3d: r[0], radius: n[0] };
        } else if (tp === 'TOROIDAL_SURFACE') {
            const r = getRefs(text); const n = getNumsAfterRefs(text);
            surfData[iid] = { type: 'TORUS', a2p3d: r[0], majorRadius: n[0], minorRadius: n[1] };
        } else if (tp === 'B_SPLINE_SURFACE_WITH_KNOTS') {
            surfData[iid] = { type: 'BSURF', refs: getRefs(text) };
        } else if (tp === 'ADVANCED_FACE') {
            const r = getRefs(text); const o = text.includes('.T.');
            faces.push({ id: iid, bounds: r.slice(0, -1), surfId: r[r.length - 1], orient: o });
        }
    }
    return { pts, dirs, a2p3d, circles, vpToPt, ecMap, oeMap, elMap, fbMap, surfData, faces };
}

function evalA2P3D(a2p3dId, lookup) {
    const a = lookup.a2p3d[a2p3dId];
    if (!a) return null;
    const loc = lookup.pts[a[0]];
    const zdir = lookup.dirs[a[1]];
    const xdir = lookup.dirs[a[2]];
    if (!loc || !zdir || !xdir) return null;
    const vnorm = v => { const l = Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]); return l > 1e-12 ? [v[0]/l,v[1]/l,v[2]/l] : [0,0,0]; };
    const crs = (a,b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
    const n = vnorm(zdir), r = vnorm(xdir), s = vnorm(crs(n, r));
    return { center: loc, normal: n, refDir: r, sideDir: s };
}

function distToSurface(p, surf, lookup) {
    if (!surf || !surf.a2p3d) return null;
    const ap = evalA2P3D(surf.a2p3d, lookup);
    if (!ap) return null;
    const sub3 = (a,b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
    const dot3 = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
    const scl3 = (v,s) => [v[0]*s, v[1]*s, v[2]*s];
    const vlen3 = v => Math.sqrt(v[0]**2+v[1]**2+v[2]**2);

    switch (surf.type) {
        case 'PLANE': return Math.abs(dot3(sub3(p, ap.center), ap.normal));
        case 'CYL': {
            const v = sub3(p, ap.center);
            const radial = sub3(v, scl3(ap.normal, dot3(v, ap.normal)));
            return Math.abs(vlen3(radial) - surf.radius);
        }
        case 'CON': {
            const v = sub3(p, ap.center);
            const t = dot3(v, ap.normal);
            const expectedR = surf.radius + t * Math.tan(surf.halfAngle);
            const radial = sub3(v, scl3(ap.normal, t));
            return Math.abs(vlen3(radial) - expectedR);
        }
        default: return null;
    }
}

function extractFaceBoundaries(lookup) {
    const result = new Map();

    for (const face of lookup.faces) {
        const sd = lookup.surfData[face.surfId];
        if (!sd || sd.type !== 'PLANE') continue;

        const outer = [];
        const holes = [];

        for (const boundId of face.bounds) {
            const fb = lookup.fbMap[boundId];
            if (!fb) continue;
            const elId = fb[0];
            const isOuter = fb[1] === 'FACE_OUTER_BOUND';

            const oeIds = lookup.elMap[elId];
            if (!oeIds) continue;

            const boundVerts = [];
            for (const oeId of oeIds) {
                const oe = lookup.oeMap[oeId];
                if (!oe) continue;
                const ecId = oe[0];
                const ec = lookup.ecMap[ecId];
                if (!ec) continue;

                const vpId = ec[1];
                const ptId = lookup.vpToPt[vpId];
                if (ptId === undefined) continue;
                const pt = lookup.pts[ptId];
                if (pt) boundVerts.push(pt);
            }

            if (boundVerts.length >= 3) {
                if (isOuter) outer.push(boundVerts);
                else holes.push(boundVerts);
            }
        }

        if (outer.length > 0) {
            result.set(face.id, { outer: outer[0], holes });
        }
    }

    return result;
}

module.exports = { parseSTEP, getRefs, getType, getNumsAfterRefs, buildLookup, evalA2P3D, distToSurface, extractFaceBoundaries };
