'use strict';

const fs = require('fs');
const path = require('path');
const { readSLDPRT, findStream } = require('../v0.2.2/src/sldprt-reader');
const { findAll, triArea } = require('../v0.2.2/src/utils');

function extractFacesFromSLDPRT(filePath) {
    const { raw, streams } = readSLDPRT(filePath);
    const dlStream = findStream(streams, 'Contents/DisplayLists');
    if (!dlStream) return { faces: [], error: 'DisplayLists stream not found' };

    const dl = dlStream.data;
    const dv = new DataView(dl.buffer, dl.byteOffset, dl.byteLength);
    const SCALE = 1000;

    const marker = new Uint8Array([0x0c, 0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00]);
    const markerPositions = findAll(dl, marker);

    const faces = [];
    for (const mp of markerPositions) {
        if (mp < 4) continue;
        const edgeCount = dv.getUint32(mp - 4, true);
        if (edgeCount < 1 || edgeCount > 500) continue;
        const faceType = dv.getUint32(mp + 8, true);
        if (faceType !== 2) continue;
        const vertexCount = dv.getUint32(mp + 12, true);
        if (vertexCount < 3 || vertexCount > 5000) continue;
        const vertStart = mp + 16;
        if (vertStart + vertexCount * 12 > dl.length) continue;

        const verts = [];
        for (let i = 0; i < vertexCount; i++) {
            const off = vertStart + i * 12;
            verts.push([
                dv.getFloat32(off, true) * SCALE,
                dv.getFloat32(off + 4, true) * SCALE,
                dv.getFloat32(off + 8, true) * SCALE
            ]);
        }

        let area = 0;
        for (let i = 1; i < verts.length - 1; i++) {
            area += triArea(verts[0], verts[i], verts[i + 1]);
        }

        faces.push({ index: faces.length, edgeCount, vertexCount, verts, area });
    }

    return { faces };
}

module.exports = { extractFacesFromSLDPRT };
