/**
 * OLE2 Compound File Binary Format Parser (v2)
 * Parses Microsoft Structured Storage files (.sldprt, .doc, etc.)
 * 
 * Format spec: https://docs.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb/53988ce0-f71d-4654-9767-83d5b65660d6
 */

const OLE2_MAGIC = new Uint8Array([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);
const ENDOFCHAIN = 0xFFFFFFFE;
const FREESECT = 0xFFFFFFFF;
const DIFSECT = 0xFFFFFFFD;
const FATSECT = 0xFFFFFFFC;

class Ole2Parser {
  constructor(buffer) {
    if (!(buffer instanceof ArrayBuffer)) {
      throw new Error('Ole2Parser requires an ArrayBuffer');
    }
    this.buffer = buffer;
    this.view = new DataView(buffer);
    this.bytes = new Uint8Array(buffer);
    
    this.sectorSize = 512;
    this.miniSectorSize = 64;
    this.miniStreamCutoff = 4096;
    this.fatSectors = [];    // sector numbers that contain FAT data
    this.dirSector = 0;
    this.miniFatSector = 0;
    this.miniFatSectorCount = 0;
    
    this.fat = [];           // FAT entries (sector allocation table)
    this.directory = [];     // parsed directory entries
    this.miniFat = [];
    this.miniStream = null;
  }

  parse() {
    this._parseHeader();
    this._readFAT();
    this._parseDirectory();
    if (this.miniFatSectorCount > 0) {
      this._readMiniFAT();
    }
    this._readMiniStream();
    return this;
  }

  _parseHeader() {
    for (let i = 0; i < 8; i++) {
      if (this.bytes[i] !== OLE2_MAGIC[i]) {
        throw new Error('Not an OLE2 file - invalid magic bytes');
      }
    }

    // Per MS-CFB spec:
    // 0x0018 (24): Minor version
    // 0x001A (26): Major version  
    // 0x001C (28): Byte order (0xFFFE = LE)
    // 0x001E (30): Sector size power (9 for 512, 12 for 4096)
    // 0x0020 (32): Mini sector size power (6 for 64)
    const sectorSizePow = this.view.getUint16(30, true);
    this.sectorSize = 1 << sectorSizePow;
    
    const miniSectorSizePow = this.view.getUint16(32, true);
    this.miniSectorSize = 1 << miniSectorSizePow;

    // 0x002C (44): Total FAT sectors
    // 0x0030 (48): First directory sector
    this.dirSector = this.view.getUint32(48, true);
    
    // 0x0038 (56): Mini stream cutoff (default 4096)
    this.miniStreamCutoff = this.view.getUint32(56, true);
    
    // 0x003C (60): First mini FAT sector
    this.miniFatSector = this.view.getUint32(60, true);
    // 0x0040 (64): Total mini FAT sectors
    this.miniFatSectorCount = this.view.getUint32(64, true);

    // DIFAT array (offset 76, 109 entries of 4 bytes each)
    // Each entry is a sector number that contains part of the FAT
    // FREESECT (0xFFFFFFFF) = unused slot
    this.fatSectors = [];
    for (let i = 0; i < 109; i++) {
      const sector = this.view.getUint32(76 + i * 4, true);
      if (sector !== FREESECT) {
        this.fatSectors.push(sector);
      }
    }
  }

  /**
   * Read a sector from the file. Sector N starts at byte (N+1)*sectorSize
   * because the 512-byte header is not counted as a sector.
   */
  _readSector(sectorNum) {
    if (sectorNum < 0 || sectorNum === FREESECT || sectorNum === DIFSECT || sectorNum === FATSECT) return null;
    const offset = (sectorNum + 1) * this.sectorSize;
    if (offset + this.sectorSize > this.buffer.byteLength) return null;
    return this.buffer.slice(offset, offset + this.sectorSize);
  }

  _readMiniSector(sectorNum) {
    if (!this.miniStream || sectorNum < 0) return null;
    const offset = sectorNum * this.miniSectorSize;
    if (offset + this.miniSectorSize > this.miniStream.byteLength) return null;
    return this.miniStream.slice(offset, offset + this.miniSectorSize);
  }

  /**
   * Follow a FAT chain starting from a sector, returning all sector numbers.
   */
  _getSectorChain(startSector) {
    const chain = [];
    let current = startSector;
    const visited = new Set();
    let iterations = 0;

    while (current !== ENDOFCHAIN && current !== FREESECT && current !== DIFSECT && 
           current !== FATSECT && iterations < 100000 && !visited.has(current)) {
      visited.add(current);
      chain.push(current);
      if (current >= this.fat.length) break;
      current = this.fat[current];
      iterations++;
    }
    return chain;
  }

  /**
   * Read stream data given a starting sector and size.
   * Uses either regular sectors or mini sectors depending on size.
   */
  _readStreamData(startSector, size) {
    if (startSector === ENDOFCHAIN || startSector === FREESECT || startSector < 0) {
      return new ArrayBuffer(0);
    }

    // Validate startSector is within file bounds
    const maxSector = Math.floor((this.buffer.byteLength - this.sectorSize) / this.sectorSize) - 1;
    if (startSector > maxSector) {
      console.warn(`Stream starts at sector ${startSector} but file only has ${maxSector + 1} sectors`);
      return new ArrayBuffer(0);
    }

    let data;
    if (size < this.miniStreamCutoff && this.miniStream) {
      // Small stream — read from mini stream via mini FAT
      const chain = [];
      let current = startSector;
      const visited = new Set();
      while (current !== ENDOFCHAIN && current !== FREESECT && !visited.has(current) && chain.length < 10000) {
        visited.add(current);
        chain.push(current);
        if (current < this.miniFat.length) {
          current = this.miniFat[current];
        } else break;
      }
      
      data = new Uint8Array(size);
      let offset = 0;
      for (const sector of chain) {
        const sectorData = this._readMiniSector(sector);
        if (!sectorData) continue;
        const bytesToCopy = Math.min(this.miniSectorSize, size - offset);
        data.set(new Uint8Array(sectorData, 0, bytesToCopy), offset);
        offset += bytesToCopy;
        if (offset >= size) break;
      }
    } else {
      // Large stream — read directly from sectors via FAT
      const chain = this._getSectorChain(startSector);
      data = new Uint8Array(chain.length * this.sectorSize);
      let offset = 0;
      for (const sector of chain) {
        const sectorData = this._readSector(sector);
        if (!sectorData) continue;
        data.set(new Uint8Array(sectorData), offset);
        offset += this.sectorSize;
      }
      if (offset > size) data = data.slice(0, size);
    }

    return data.buffer;
  }

  /**
   * Read the FAT. The FAT sector(s) are identified by the DIFAT array.
   */
  _readFAT() {
    const allFatEntries = [];
    for (const fatSectorNum of this.fatSectors) {
      const data = this._readSector(fatSectorNum);
      if (!data) continue;
      const dv = new DataView(data);
      for (let i = 0; i < this.sectorSize / 4; i++) {
        allFatEntries.push(dv.getUint32(i * 4, true));
      }
    }
    this.fat = allFatEntries;
  }

  /**
   * Parse the directory. The directory is a red-black tree stored in sectors.
   * We read all directory sectors and then traverse the tree from the root.
   */
  _parseDirectory() {
    // Read directory sectors — follow the chain from dirSector
    const dirChain = this._getSectorChain(this.dirSector);
    const totalDirBytes = dirChain.length * this.sectorSize;
    const dirBuffer = new Uint8Array(totalDirBytes);
    
    let offset = 0;
    for (const sector of dirChain) {
      const data = this._readSector(sector);
      if (!data) continue;
      dirBuffer.set(new Uint8Array(data), offset);
      offset += this.sectorSize;
    }
    
    const dv = new DataView(dirBuffer.buffer);
    
    // Parse all directory entries (each 128 bytes)
    const allEntries = [];
    for (let i = 0; i < dirBuffer.length / 128; i++) {
      const entryOff = i * 128;
      
      // Name (UTF-16LE, 64 bytes max)
      let name = '';
      for (let j = 0; j < 64; j += 2) {
        const code = dv.getUint16(entryOff + j, true);
        if (code === 0) break;
        name += String.fromCharCode(code);
      }
      
      const nameSize = dv.getUint16(entryOff + 64, true);
      const objType = dv.getUint8(entryOff + 66);
      const leftChild = dv.getInt32(entryOff + 68, true);
      const rightChild = dv.getInt32(entryOff + 72, true);
      const child = dv.getInt32(entryOff + 76, true);
      
      // Size: low 4 bytes at offset 120, high 4 bytes at offset 124
      const sizeLow = dv.getUint32(entryOff + 120, true);
      const sizeHigh = dv.getUint32(entryOff + 124, true);
      const streamSize = sizeHigh * 0x100000000 + sizeLow;
      
      const startingSector = dv.getUint32(entryOff + 116, true);

      allEntries.push({
        index: i,
        name,
        objType,  // 0=unknown, 1=storage, 2=stream, 5=root
        leftChild,
        rightChild,
        child,
        startingSector,
        streamSize,
        fullPath: ''
      });
    }
    
    // Build paths by traversing the tree starting from root entry (index 0)
    this.directory = allEntries;
    this._buildPaths(0, '/');
  }

  /**
   * Recursively build full paths from the directory tree.
   */
  _buildPaths(entryIdx, parentPath) {
    if (entryIdx < 0 || entryIdx >= this.directory.length) return;
    const entry = this.directory[entryIdx];
    if (!entry) return;
    
    // Set path based on type
    if (entry.objType === 5) {
      entry.fullPath = '/';
    } else if (entry.objType === 1) {
      entry.fullPath = parentPath + entry.name + '/';
    } else {
      entry.fullPath = parentPath + entry.name;
    }
    
    // Recurse into children (subtree structure)
    if (entry.child >= 0 && entry.child < this.directory.length) {
      this._buildPaths(entry.child, entry.fullPath);
    }
    // Siblings in the red-black tree
    if (entry.leftChild >= 0 && entry.leftChild < this.directory.length) {
      this._buildPaths(entry.leftChild, parentPath);
    }
    if (entry.rightChild >= 0 && entry.rightChild < this.directory.length) {
      this._buildPaths(entry.rightChild, parentPath);
    }
  }

  _readMiniFAT() {
    const chain = this._getSectorChain(this.miniFatSector);
    const totalBytes = chain.length * this.sectorSize;
    const data = new Uint8Array(totalBytes);
    let offset = 0;
    for (const sector of chain) {
      const sectorData = this._readSector(sector);
      if (sectorData) {
        data.set(new Uint8Array(sectorData), offset);
        offset += this.sectorSize;
      }
    }
    const dv = new DataView(data.buffer);
    this.miniFat = [];
    for (let i = 0; i < data.length / 4; i++) {
      this.miniFat.push(dv.getUint32(i * 4, true));
    }
  }

  _readMiniStream() {
    const rootEntry = this.directory.find(e => e.objType === 5);
    if (!rootEntry || rootEntry.startingSector === ENDOFCHAIN || rootEntry.streamSize === 0) return;
    
    // The root entry contains the mini stream container
    // Only read if stream is larger than mini cutoff
    if (rootEntry.streamSize >= this.miniStreamCutoff) {
      const data = this._readStreamData(rootEntry.startingSector, rootEntry.streamSize);
      this.miniStream = new Uint8Array(data);
    }
  }

  /**
   * Find all streams matching a regex pattern
   */
  findStreams(pattern) {
    return this.directory.filter(e => 
      e.objType === 2 && (pattern.test(e.name) || pattern.test(e.fullPath))
    );
  }

  /**
   * Read stream data by directory entry
   */
  readStream(entry) {
    if (entry.streamSize === 0) return new ArrayBuffer(0);
    return this._readStreamData(entry.startingSector, entry.streamSize);
  }

  /**
   * List all streams with their paths and sizes
   */
  listStreams() {
    return this.directory
      .filter(e => e.objType === 2)
      .map(e => ({
        name: e.name,
        path: e.fullPath || e.name,
        size: e.streamSize,
        sector: e.startingSector
      }));
  }

  /**
   * Get hex dump of first N bytes of a stream
   */
  hexDump(entry, maxBytes = 256) {
    const data = new Uint8Array(this.readStream(entry));
    const len = Math.min(data.length, maxBytes);
    let result = '';
    for (let i = 0; i < len; i += 16) {
      let hex = '', ascii = '';
      for (let j = 0; j < 16 && i + j < len; j++) {
        const byte = data[i + j];
        hex += byte.toString(16).padStart(2, '0') + ' ';
        ascii += (byte >= 32 && byte < 127) ? String.fromCharCode(byte) : '.';
      }
      result += hex.padEnd(48) + ' ' + ascii + '\n';
    }
    return result;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Ole2Parser };
} else {
  window.Ole2Parser = Ole2Parser;
}
