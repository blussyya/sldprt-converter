/**
 * OLE2 Compound Document Parser
 * Parses the OLE2 (Compound Binary) format used by older SolidWorks SLDPRT files.
 *
 * Browser-safe (no Node.js dependencies).
 */

function _concatChunks(chunks) {
    const total = chunks.reduce((acc, c) => acc + c.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk), offset);
        offset += chunk.length;
    }
    return result;
}

function ensureBuffer(data) {
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) return data;

    const arr = data instanceof ArrayBuffer ? new Uint8Array(data) :
                data instanceof Uint8Array ? data : new Uint8Array(data);

    let _dv = null;
    const wrapper = new Proxy({
        _data: arr,
        length: arr.length,
        readUInt16LE: function(off) { return arr[off] | (arr[off + 1] << 8); },
        readInt32LE: function(off) { return (arr[off] | (arr[off + 1] << 8) | (arr[off + 2] << 16) | (arr[off + 3] << 24)); },
        readUInt32LE: function(off) { return (arr[off] | (arr[off + 1] << 8) | (arr[off + 2] << 16) | (arr[off + 3] << 24)) >>> 0; },
        readFloatLE: function(off) {
            if (!_dv) _dv = new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
            return _dv.getFloat32(off, true);
        },
        subarray: function(start, end) { return arr.subarray(start, end); },
        slice: function(start, end) { return arr.slice(start, end); },
        toString: function(encoding, start, end) {
            if (encoding === 'utf16le') {
                const s = start || 0;
                const e = end !== undefined ? end : arr.length;
                let str = '';
                for (let i = s; i < e; i += 2) str += String.fromCharCode(arr[i] | (arr[i + 1] << 8));
                return str;
            }
            const s = start || 0;
            const e = end !== undefined ? end : arr.length;
            let str = '';
            for (let i = s; i < e; i++) str += String.fromCharCode(arr[i]);
            return str;
        }
    }, {
        get: function(target, prop) {
            if (typeof prop === 'string' && /^\d+$/.test(prop)) {
                return arr[parseInt(prop)];
            }
            return target[prop];
        }
    });
    return wrapper;
}

function parseOLE2(buf) {
    buf = ensureBuffer(buf);
    const ss = 1 << buf.readUInt16LE(30);

    const difat = [];
    for (let i = 0; i < 109; i++) {
        const s = buf.readInt32LE(76 + i * 4);
        if (s >= 0) difat.push(s);
    }

    const visitedFat = new Set();
    let sec = buf.readInt32LE(68);
    while (sec >= 0 && sec < 0xfffe_fffe && !visitedFat.has(sec)) {
        visitedFat.add(sec);
        const off = (sec + 1) * ss;
        if (off + ss > buf.length) break;
        for (let i = 0; i < ss / 4 - 1; i++) {
            const s = buf.readInt32LE(off + i * 4);
            if (s >= 0) difat.push(s);
        }
        sec = buf.readInt32LE(off + ss - 4);
    }

    const fat = [];
    for (const s of difat) {
        const off = (s + 1) * ss;
        if (off + ss > buf.length) continue;
        for (let i = 0; i < ss / 4; i++) {
            fat.push(buf.readInt32LE(off + i * 4));
        }
    }

    const dirSec = buf.readUInt32LE(48);
    const chunks = [];
    let cur = dirSec;
    const visitedDir = new Set();
    while (cur >= 0 && cur < 0xfffe_fffe && !visitedDir.has(cur)) {
        visitedDir.add(cur);
        const off = (cur + 1) * ss;
        if (off + ss > buf.length) break;
        chunks.push(buf.subarray(off, off + ss));
        cur = fat[cur] ?? -1;
    }

    const dirData = ensureBuffer(_concatChunks(chunks));
    const entries = [];
    for (let i = 0; i + 128 <= dirData.length; i += 128) {
        const nameLen = dirData.readUInt16LE(i + 64);
        if (nameLen === 0) continue;
        const rawBytes = dirData.subarray(i, i + Math.max(0, nameLen - 2));
        let name = '';
        for (let k = 0; k < rawBytes.length; k += 2) {
            name += String.fromCharCode(rawBytes[k] | (rawBytes[k + 1] << 8));
        }
        entries.push({
            name,
            type: dirData[i + 66],
            startSector: dirData.readInt32LE(i + 116),
            size: dirData.readUInt32LE(i + 120)
        });
    }

    // Parse mini FAT info from header
    const miniCutoff = buf.readUInt32LE(0x38);
    const miniFatStartSec = buf.readInt32LE(0x3C);
    const totalMiniFatSec = buf.readUInt32LE(0x40);

    // Find Root Entry for mini stream source
    const rootEntry = entries.find(e => e.name === 'Root Entry');

    return { ss, fat, entries, miniCutoff, miniFatStartSec, totalMiniFatSec, rootEntry };
}

function _buildMiniFAT(buf, ole) {
    buf = ensureBuffer(buf);
    if (ole.totalMiniFatSec <= 0 || ole.miniFatStartSec < 0) return [];
    const miniFAT = [];
    let sec = ole.miniFatStartSec;
    const visited = new Set();
    for (let s = 0; s < ole.totalMiniFatSec; s++) {
        if (visited.has(sec) || sec < 0 || sec >= 0xfffe_fffe) break;
        visited.add(sec);
        const off = (sec + 1) * ole.ss;
        if (off + ole.ss > buf.length) break;
        for (let i = 0; i < ole.ss / 4; i++) {
            miniFAT.push(buf.readInt32LE(off + i * 4));
        }
        sec = ole.fat[sec] ?? -1;
    }
    return miniFAT;
}

function _readMiniStreamData(buf, ole) {
    buf = ensureBuffer(buf);
    if (!ole.rootEntry || ole.rootEntry.startSector < 0) return null;
    const chunks = [];
    let cur = ole.rootEntry.startSector;
    const visited = new Set();
    while (cur >= 0 && cur < 0xfffe_fffe && !visited.has(cur)) {
        visited.add(cur);
        const off = (cur + 1) * ole.ss;
        if (off + ole.ss > buf.length) break;
        chunks.push(buf.subarray(off, off + ole.ss));
        cur = ole.fat[cur] ?? -1;
    }
    return ensureBuffer(_concatChunks(chunks));
}

function readStream(buf, fat, entry, ss, ole) {
    buf = ensureBuffer(buf);
    if (entry.type !== 2 || entry.startSector < 0) return null;

    // Check if this stream is in the mini stream
    if (ole && ole.miniCutoff && entry.size < ole.miniCutoff && ole.rootEntry) {
        const miniStreamData = _readMiniStreamData(buf, ole);
        if (!miniStreamData) return null;
        const miniFAT = _buildMiniFAT(buf, ole);
        if (miniFAT.length === 0) return null;

        const chunks = [];
        let cur = entry.startSector;
        const visited = new Set();
        while (cur >= 0 && cur < 0xfffe_fffe && !visited.has(cur)) {
            visited.add(cur);
            if (cur >= miniFAT.length) break;
            const start = cur * 64;
            const end = Math.min((cur + 1) * 64, miniStreamData.length);
            chunks.push(miniStreamData.subarray(start, end));
            cur = miniFAT[cur] ?? -1;
        }
        return ensureBuffer(_concatChunks(chunks).subarray(0, entry.size));
    }

    const chunks = [];
    let cur = entry.startSector;
    const visited = new Set();
    while (cur >= 0 && cur < 0xfffe_fffe && !visited.has(cur)) {
        visited.add(cur);
        const off = (cur + 1) * ss;
        if (off + ss > buf.length) break;
        chunks.push(buf.subarray(off, off + ss));
        cur = fat[cur] ?? -1;
    }
    return ensureBuffer(_concatChunks(chunks).subarray(0, entry.size));
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseOLE2, readStream, ensureBuffer, _concatChunks };
}
