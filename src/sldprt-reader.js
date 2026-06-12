'use strict';
const fs = require('fs');
const pako = require('pako');
const { findAll } = require('./utils');

// SLDPRT file reader
// SolidWorks SLDPRT files are OLE2 compound documents containing
// multiple named streams, some compressed with openswx (zlib raw deflate).
//
// Stream name encoding: XOR each byte with the key (file[7])
// Compression marker: stream header has u32 compressed_size at offset 0x12
// Decompression: pako.inflateRaw on the bytes after the stream header

function rolByte(b, s) {
    s &= 7;
    return s === 0 ? b : ((b << s) | (b >>> (8 - s))) & 0xFF;
}

function readSLDPRT(filePath) {
    const raw = new Uint8Array(fs.readFileSync(filePath));
    const key = raw[7];
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);

    // Stream header marker: 14 00 06 00 08 00
    const marker = new Uint8Array([0x14, 0x00, 0x06, 0x00, 0x08, 0x00]);
    const markerPos = findAll(raw, marker);

    const streams = [];

    for (const mp of markerPos) {
        const si = mp - 4;
        if (si < 0 || si + 0x1E > raw.length) continue;

        const csz = dv.getUint32(si + 0x12, true);
        const nsz = dv.getUint32(si + 0x1A, true);
        if (nsz > 500 || csz > 50 * 1024 * 1024) continue;

        const nameEnd = si + 0x1E + nsz;
        if (nameEnd > raw.length) continue;

        // Decode stream name
        let name = '';
        for (let i = 0; i < nsz; i++) {
            name += String.fromCharCode(rolByte(raw[si + 0x1E + i], key));
        }

        if (csz < 50) continue;

        // Decompress
        try {
            const compressed = raw.slice(nameEnd, nameEnd + csz);
            const data = pako.inflateRaw(compressed);
            if (data.length > 0) {
                streams.push({
                    name,
                    data: new Uint8Array(data),
                    offset: si,
                    compSize: csz,
                    decompSize: data.length
                });
            }
        } catch (e) {
            // Some streams may not be zlib-compressed
        }
    }

    return { raw, streams, key };
}

function findStream(streams, name) {
    return streams.find(s => s.name === name) || null;
}

function listStreams(streams) {
    return streams
        .sort((a, b) => b.decompSize - a.decompSize)
        .map(s => ({
            name: s.name,
            decompSize: s.decompSize,
            compSize: s.compSize,
            ratio: (s.compSize / s.decompSize * 100).toFixed(1) + '%'
        }));
}

module.exports = { readSLDPRT, findStream, listStreams };
