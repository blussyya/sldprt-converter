'use strict';

// MFC CArchive binary format parser
// SolidWorks SLDPRT files use MFC serialization inside OLE2 compound files.
// The DisplayLists stream contains MFC-serialized display pipeline objects.
//
// MFC CArchive format reference:
// - https://learn.microsoft.com/en-us/cpp/mfc/reference/carchive-class
// - https://learn.microsoft.com/en-us/cpp/mfc/serializing-an-object
//
// Object header encoding (nClassIndex):
//   0x0000        = NULL object
//   0x0001-0x7FFF = back-reference to existing class in class table
//   0x8000-0xBFFF = new class with schema version following
//   0xC000-0xFFFF = new class (old format, no schema)
//
// New class definition (after 0x8000 marker):
//   u16 schemaNumber
//   u16 nameLength
//   char[nameLength] className (null-terminated, padded)
//   u32 oldSchema (usually 0)
//
// Data types in MFC archives:
//   BYTE:   u8
//   WORD:   u16 LE
//   DWORD:  u32 LE
//   LONG:   i32 LE
//   float:  f32 LE
//   double: f64 LE
//   String: u16 length + char[length] data (may include null terminator)

class MFCArchiveReader {
    constructor(buffer) {
        this.buf = new Uint8Array(buffer);
        this.dv = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
        this.pos = 0;
        this.classTable = [];
        this.objects = [];
    }

    // Primitives
    u8()  { const v = this.buf[this.pos]; this.pos += 1; return v; }
    u16() { const v = this.dv.getUint16(this.pos, true); this.pos += 2; return v; }
    i16() { const v = this.dv.getInt16(this.pos, true); this.pos += 2; return v; }
    u32() { const v = this.dv.getUint32(this.pos, true); this.pos += 4; return v; }
    i32() { const v = this.dv.getInt32(this.pos, true); this.pos += 4; return v; }
    f32() { const v = this.dv.getFloat32(this.pos, true); this.pos += 4; return v; }
    f64() { const v = this.dv.getFloat64(this.pos, true); this.pos += 8; return v; }

    bytes(n) {
        const b = this.buf.slice(this.pos, this.pos + n);
        this.pos += n;
        return b;
    }

    // MFC string: u16 length, then chars
    // SolidWorks sometimes uses UTF-16LE strings
    mfcString() {
        const len = this.u16();
        if (len === 0 || this.pos + len > this.buf.length) return '';
        // Check if it looks like UTF-16 (every other byte is 0)
        const isUtf16 = len > 2 && this.buf[this.pos + 1] === 0 && this.buf[this.pos] > 0;
        if (isUtf16) {
            let s = '';
            for (let i = 0; i < len; i += 2) {
                const ch = this.dv.getUint16(this.pos + i, true);
                s += String.fromCharCode(ch);
            }
            this.pos += len;
            return s;
        } else {
            let s = '';
            for (let i = 0; i < len; i++) {
                s += String.fromCharCode(this.buf[this.pos++]);
            }
            return s;
        }
    }

    // Read class index (nClassIndex)
    // Returns: { isNew: bool, index: number, className: string|null }
    readClassIndex() {
        const raw = this.u16();

        if (raw === 0x0000) {
            return { isNew: false, index: -1, className: null, isNull: true };
        }

        if (raw <= 0x7FFF) {
            // Back-reference to existing class
            const idx = raw - 1;
            const cls = this.classTable[idx] || null;
            return { isNew: false, index: idx, className: cls ? cls.name : null, isNull: false };
        }

        if (raw >= 0x8000 && raw <= 0xBFFF) {
            // New class with schema
            const schema = this.u16();
            const name = this.mfcString();
            const oldSchema = this.u32();
            const idx = this.classTable.length;
            this.classTable.push({ name, schema, oldSchema, index: idx });
            return { isNew: true, index: idx, className: name, schema, isNull: false };
        }

        if (raw >= 0xC000) {
            // Old format new class
            const name = this.mfcString();
            const idx = this.classTable.length;
            this.classTable.push({ name, schema: 0, oldSchema: 0, index: idx });
            return { isNew: true, index: idx, className: name, schema: 0, isNull: false };
        }

        return { isNew: false, index: -1, className: null, isNull: true };
    }

    // Scan for all class definitions without parsing objects
    scanClassDefs() {
        const savedPos = this.pos;
        this.pos = 0;

        while (this.pos < this.buf.length - 4) {
            // Look for FF FF markers (class definitions)
            if (this.buf[this.pos] === 0xFF && this.buf[this.pos + 1] === 0xFF) {
                this.pos += 2;
                const word = this.u16();

                if (word === 0x0001) {
                    // New class
                    const name = this.mfcString();
                    const oldSchema = this.u32();
                    if (name.length > 2) {
                        this.classTable.push({
                            name,
                            schema: 0,
                            oldSchema,
                            index: this.classTable.length,
                            offset: this.pos - name.length - 8
                        });
                    }
                }
            } else {
                this.pos++;
            }
        }

        this.pos = savedPos;
        return this.classTable;
    }

    // Hex dump of current position
    hexDump(n = 64) {
        let result = '';
        for (let i = 0; i < n && this.pos + i < this.buf.length; i += 16) {
            let hex = '', ascii = '';
            for (let j = 0; j < 16 && this.pos + i + j < this.buf.length; j++) {
                const b = this.buf[this.pos + i + j];
                hex += b.toString(16).padStart(2, '0') + ' ';
                ascii += (b >= 32 && b < 127) ? String.fromCharCode(b) : '.';
            }
            result += (this.pos + i).toString(16).padStart(6, '0') + ': ' + hex + ' | ' + ascii + '\n';
        }
        return result;
    }
}

module.exports = { MFCArchiveReader };
