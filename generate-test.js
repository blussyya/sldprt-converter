/**
 * Generate a minimal OLE2 compound file for testing the parser
 * Creates a file with a few streams including a fake _ZLB stream
 */

const fs = require('fs');
const zlib = require('zlib');

class Ole2Writer {
  constructor() {
    this.sectors = [];
    this.directory = [];
    this.fat = [];
    this.miniFat = [];
    this.miniStream = Buffer.alloc(0);
    this.sectorSize = 512;
    
    // Reserve sector 0 for FAT (will be filled later)
    this.fat.push(0); // placeholder
  }

  /**
   * Add a stream to the root storage
   */
  addStream(name, data) {
    const entry = {
      name: name,
      data: Buffer.from(data),
      type: 2, // STREAM_OBJECT
      startingSector: -1,
      streamSize: data.byteLength
    };
    this.directory.push(entry);
    return entry;
  }

  /**
   * Build the OLE2 file
   */
  build() {
    // For simplicity, use regular sectors (not mini-stream)
    // Assign sectors to each stream
    for (const entry of this.directory) {
      if (entry.data.length === 0) {
        entry.startingSector = 0xFFFFFFFE; // ENDOFCHAIN
        continue;
      }
      
      const sectorCount = Math.ceil(entry.data.length / this.sectorSize);
      const firstSector = this.sectors.length;
      
      for (let i = 0; i < sectorCount; i++) {
        const start = i * this.sectorSize;
        const end = Math.min(start + this.sectorSize, entry.data.length);
        const sectorData = Buffer.alloc(this.sectorSize);
        entry.data.copy(sectorData, 0, start, end);
        this.sectors.push(sectorData);
        this.fat.push(0xFFFFFFFE); // ENDOFCHAIN (last sector)
      }
      
      // Fix FAT chain
      if (sectorCount > 1) {
        for (let i = 0; i < sectorCount - 1; i++) {
          this.fat[firstSector + i] = firstSector + i + 1;
        }
      }
      
      entry.startingSector = firstSector;
    }
    
    // FAT sector (sector 0)
    this.fat[0] = 0xFFFFFFFD; // DIFSECT marker for FAT sector itself
    
    // Build directory entries
    const dirEntries = [];
    
    // Root entry (always first)
    dirEntries.push(this._makeDirEntry('/', 5, 0xFFFFFFFE, 0));
    
    // Stream entries
    for (const entry of this.directory) {
      dirEntries.push(this._makeDirEntry(entry.name, entry.type, entry.startingSector, entry.streamSize));
    }
    
    // Pad directory to fill complete sectors
    while (dirEntries.length % (this.sectorSize / 128) !== 0) {
      dirEntries.push(Buffer.alloc(128));
    }
    
    // Calculate total sectors needed
    const headerSectors = 1; // Header sector (not counted in FAT)
    const fatSectorCount = Math.ceil(this.fat.length * 4 / this.sectorSize);
    const dirSectorCount = dirEntries.length / (this.sectorSize / 128);
    
    // Rebuild FAT with proper indices
    // Sector 0: FAT sector marker
    // Sectors 1..N: FAT continuation
    // Then directory sectors
    // Then data sectors
    
    const totalSectors = 1 + fatSectorCount + dirSectorCount + this.sectors.length;
    
    // Build the file
    const header = Buffer.alloc(512);
    
    // Magic
    Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]).copy(header, 0);
    
    // Minor version (offset 24)
    header.writeUInt16LE(0x003E, 24);
    
    // Major version (offset 26) - 3 = v3
    header.writeUInt16LE(0x0003, 26);
    
    // Byte order (offset 28) - little-endian
    header.writeUInt16LE(0xFFFE, 28);
    
    // Sector size power (offset 22) - 9 = 512 bytes
    header.writeUInt16LE(0x0009, 22);
    
    // Mini sector size power (offset 20) - 6 = 64 bytes
    header.writeUInt16LE(0x0006, 20);
    
    // Number of FAT sectors (offset 44)
    header.writeUInt32LE(fatSectorCount, 44);
    
    // First directory sector (offset 48)
    header.writeUInt32LE(1 + fatSectorCount, 48);
    
    // Mini stream cutoff (offset 56)
    header.writeUInt32LE(4096, 56);
    
    // First mini FAT sector (offset 60) - ENDOFCHAIN
    header.writeUInt32LE(0xFFFFFFFE, 60);
    
    // Total mini FAT sectors (offset 64)
    header.writeUInt32LE(0, 64);
    
    // First DIFAT sector (offset 68) - ENDOFCHAIN
    header.writeUInt32LE(0xFFFFFFFE, 68);
    
    // Total DIFAT sectors (offset 72)
    header.writeUInt32LE(0, 72);
    
    // DIFAT array (offset 76) - point to sector 0 (FAT)
    header.writeUInt32LE(0, 76);
    for (let i = 1; i < 109; i++) {
      header.writeUInt32LE(0xFFFFFFFF, 76 + i * 4);
    }
    
    // Build FAT sector(s)
    const fatData = Buffer.alloc(fatSectorCount * this.sectorSize);
    for (let i = 0; i < this.fat.length && i < fatData.length / 4; i++) {
      fatData.writeUInt32LE(this.fat[i], i * 4);
    }
    
    // Build directory sectors
    const dirData = Buffer.alloc(dirSectorCount * this.sectorSize);
    for (let i = 0; i < dirEntries.length; i++) {
      dirEntries[i].copy(dirData, i * 128);
    }
    
    // Assemble the file
    const parts = [header, fatData, dirData];
    for (const sector of this.sectors) {
      parts.push(sector);
    }
    
    return Buffer.concat(parts);
  }

  _makeDirEntry(name, type, startSector, size) {
    const entry = Buffer.alloc(128);
    
    // Name (UTF-16LE, max 32 chars = 64 bytes)
    const nameBuf = Buffer.from(name, 'utf16le');
    nameBuf.copy(entry, 0);
    entry.writeUInt16LE(nameBuf.length, 64);
    
    // Type
    entry.writeUInt8(type, 66);
    
    // Color (black = 1)
    entry.writeUInt8(1, 67);
    
    // Left/Right/Child (ENDOFCHAIN)
    entry.writeInt32LE(-1, 68);  // leftChild
    entry.writeInt32LE(-1, 72);  // rightChild
    entry.writeInt32LE(-1, 76);  // child
    
    // Starting sector
    entry.writeUInt32LE(startSector, 116);
    
    // Stream size
    entry.writeUInt32LE(size, 120);
    
    return entry;
  }
}

// Create test file
function createTestFile() {
  const writer = new Ole2Writer();
  
  // Add a normal stream
  writer.addStream('TestStream', Buffer.from('Hello OLE2 World!'));
  
  // Add a fake _ZLB stream with some float data
  // Simulate compressed data that contains triangle vertices
  const fakeTriangles = Buffer.alloc(100);
  const dv = new DataView(fakeTriangles.buffer);
  // Write some test vertices
  dv.setFloat32(0, 1.0, false);   // x
  dv.setFloat32(4, 0.0, false);   // y
  dv.setFloat32(8, 0.0, false);   // z
  dv.setFloat32(12, 0.0, false);
  dv.setFloat32(16, 1.0, false);
  dv.setFloat32(20, 0.0, false);
  dv.setFloat32(24, 0.0, false);
  dv.setFloat32(28, 0.0, false);
  dv.setFloat32(32, 1.0, false);
  
  // Compress with zlib
  const compressed = zlib.deflateSync(fakeTriangles);
  writer.addStream('DisplayLists__ZLB', compressed);
  
  // Add another _ZLB stream
  const moreData = Buffer.alloc(200);
  for (let i = 0; i < 50; i++) {
    moreData.writeFloatBE(Math.sin(i * 0.1) * 10, i * 4);
  }
  const compressed2 = zlib.deflateSync(moreData);
  writer.addStream('Config-0-Partition__ZLB', compressed2);
  
  return writer.build();
}

// Generate and save test file
const testFile = createTestFile();
fs.writeFileSync('test.ole2', testFile);
console.log(`Created test.ole2 (${testFile.length} bytes)`);
console.log('Run: node test-node.js test.ole2');
