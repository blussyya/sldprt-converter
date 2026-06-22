'use strict';

function parseSTEP(text) {
    const ents = {};
    let cId = null, cTx = '';

    for (const line of text.split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('/*') || t.startsWith('*')) continue;
        const sm = t.match(/^#(\d+)\s*=\s*(.*)/);
        if (sm) {
            if (cId !== null) ents[cId] = cTx;
            cId = +sm[1];
            cTx = sm[2];
        } else if (cId !== null) {
            cTx += ' ' + t;
        }
        if (cTx.endsWith(';')) {
            if (cId !== null) ents[cId] = cTx.slice(0, -1).trim();
            cId = null;
            cTx = '';
        }
    }
    if (cId !== null) ents[cId] = cTx;

    return ents;
}

function getRefs(text) {
    return [...text.matchAll(/#(\d+)/g)].map(m => +m[1]);
}

function getType(text) {
    const m = text.match(/^(\w[\w_]*)\s*\(/);
    return m ? m[1] : text.split(' ')[0];
}

function getNumsAfterRefs(text) {
    const refs = new Set(getRefs(text));
    return [...text.matchAll(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)]
        .map(m => +m[0])
        .filter(n => !refs.has(n));
}

function buildLookup(ents) {
    const pts = {}, dirs = {}, a2p3d = {}, circles = {};
    const bsplines = {}, bsplineKnots = {};
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
            const r = getRefs(text);
            const n = getNumsAfterRefs(text);
            if (r.length >= 1 && n.length >= 1) circles[iid] = [r[0], n[0]];
        } else if (tp === 'B_SPLINE_CURVE_WITH_KNOTS') {
            bsplines[iid] = getRefs(text);
            const arrays = [...text.matchAll(/\(\s*([\d\s,.\-E+]+)\s*\)/g)];
            if (arrays.length >= 2) {
                const kMults = arrays[arrays.length - 2][1].split(',').map(s => parseInt(s.trim()));
                const kVals = arrays[arrays.length - 1][1].split(',').map(s => parseFloat(s.trim()));
                let knots = [];
                for (let i = 0; i < kMults.length && i < kVals.length; i++)
                    for (let j = 0; j < kMults[i]; j++) knots.push(kVals[i]);
                bsplineKnots[iid] = knots;
            }
        } else if (tp === 'VERTEX_POINT') {
            const r = getRefs(text);
            if (r.length >= 1) vpToPt[iid] = r[0];
        } else if (tp === 'EDGE_CURVE') {
            const r = getRefs(text);
            if (r.length >= 3) ecMap[iid] = r;
        } else if (tp === 'ORIENTED_EDGE') {
            const r = getRefs(text);
            const o = text.includes('.T.');
            if (r.length >= 1) oeMap[iid] = [r[0], o];
        } else if (tp === 'EDGE_LOOP') {
            elMap[iid] = getRefs(text);
        } else if (tp === 'FACE_OUTER_BOUND' || tp === 'FACE_BOUND') {
            const r = getRefs(text);
            if (r.length >= 1) fbMap[iid] = [r[0], tp];
        } else if (tp === 'PLANE') {
            surfData[iid] = { type: 'PLANE', a2p3d: getRefs(text)[0] };
        } else if (tp === 'CYLINDRICAL_SURFACE') {
            const r = getRefs(text);
            const n = getNumsAfterRefs(text);
            surfData[iid] = { type: 'CYL', a2p3d: r[0], radius: n[0] };
        } else if (tp === 'CONICAL_SURFACE') {
            const r = getRefs(text);
            const n = getNumsAfterRefs(text);
            surfData[iid] = { type: 'CON', a2p3d: r[0], radius: n[0], halfAngle: n[1] };
        } else if (tp === 'B_SPLINE_SURFACE_WITH_KNOTS') {
            surfData[iid] = { type: 'BSURF', refs: getRefs(text) };
        } else if (tp === 'SPHERICAL_SURFACE') {
            const r = getRefs(text);
            const n = getNumsAfterRefs(text);
            surfData[iid] = { type: 'SPHERE', a2p3d: r[0], radius: n[0] };
        } else if (tp === 'TOROIDAL_SURFACE') {
            const r = getRefs(text);
            const n = getNumsAfterRefs(text);
            surfData[iid] = { type: 'TORUS', a2p3d: r[0], majorRadius: n[0], minorRadius: n[1] };
        } else if (tp === 'ADVANCED_FACE') {
            const r = getRefs(text);
            const o = text.includes('.T.');
            faces.push({ id: iid, bounds: r.slice(0, -1), surfId: r[r.length - 1], orient: o });
        }
    }

    for (const id in bsplines) {
        bsplines[id] = bsplines[id].filter(rr => pts[rr] !== undefined);
    }

    return { pts, dirs, a2p3d, circles, bsplines, bsplineKnots, vpToPt, ecMap, oeMap, elMap, fbMap, surfData, faces };
}

function evalA2P3D(a2p3dId, lookup) {
    const a = lookup.a2p3d[a2p3dId];
    if (!a) return null;
    const loc = lookup.pts[a[0]];
    const zdir = lookup.dirs[a[1]];
    const xdir = lookup.dirs[a[2]];
    if (!loc || !zdir || !xdir) return null;

    const vnorm = v => {
        const l = Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]);
        return l > 1e-12 ? [v[0]/l, v[1]/l, v[2]/l] : [0, 0, 0];
    };
    const crs = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];

    const n = vnorm(zdir);
    const r = vnorm(xdir);
    const s = vnorm(crs(n, r));

    return { center: loc, normal: n, refDir: r, sideDir: s };
}

module.exports = { parseSTEP, getRefs, getType, getNumsAfterRefs, buildLookup, evalA2P3D };
