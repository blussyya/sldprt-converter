const fs = require('fs');

const filePath = process.argv[2];
if (!filePath) {
  console.log('Usage: node diagnose.js <file.sldprt>');
  process.exit(1);
}

const fileData = fs.readFileSync(filePath);
const ab = new ArrayBuffer(fileData.length);
const view = new Uint8Array(ab);
for (let i = 0; i < fileData.length; i++) view[i] = fileData[i];
const bytes = view;

console.log(`File: ${filePath}`);
console.log(`Size: ${fileData.length} bytes`);

// Check magic
const magic = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
const isOLE2 = magic.every((m, i) => bytes[i] === m);
console.log(`OLE2 magic: ${isOLE2 ? 'YES' : 'NO'}`);

if (!isOLE2) {
  const zipMagic = [0x50, 0x4B, 0x03, 0x04];
  const isZIP = zipMagic.every((m, i) => bytes[i] === m);
  console.log(`ZIP magic: ${isZIP ? 'YES (newer SLDPRT format)' : 'NO'}`);
  process.exit(0);
}

const dv = new DataView(ab);

// Header fields per MS-CFB spec
console.log('\n=== HEADER ===');
console.log(`Minor version: ${dv.getUint16(24, true)}`);
console.log(`Major version: ${dv.getUint16(26, true)}`);
console.log(`Byte order: 0x${dv.getUint16(28, true).toString(16)}`);
console.log(`Sector size power: ${dv.getUint16(30, true)} => ${1 << dv.getUint16(30, true)} bytes`);
console.log(`Mini sector size power: ${dv.getUint16(32, true)} => ${1 << dv.getUint16(32, true)} bytes`);
console.log(`Total dir sectors: ${dv.getUint32(40, true)}`);
console.log(`Total FAT sectors: ${dv.getUint32(44, true)}`);
console.log(`First dir sector: ${dv.getUint32(48, true)}`);
console.log(`Mini stream cutoff: ${dv.getUint32(56, true)}`);
console.log(`First mini FAT sector: ${dv.getUint32(60, true)}`);
console.log(`Total mini FAT sectors: ${dv.getUint32(64, true)}`);
console.log(`First DIFAT sector: ${dv.getUint32(68, true)}`);
console.log(`Total DIFAT sectors: ${dv.getUint32(72, true)}`);

// DIFAT entries
const sectorSize = 1 << dv.getUint16(30, true);
console.log(`\nSector size: ${sectorSize}`);

const difat = [];
for (let i = 0; i < 109; i++) {
  const val = dv.getUint32(76 + i * 4, true);
  if (val !== 0xFFFFFFFF) {
    difat.push({ index: i, sector: val });
  }
}
console.log(`\nDIFAT entries: ${difat.length}`);
for (const d of difat) {
  console.log(`  DIFAT[${d.index}] = sector ${d.sector}`);
}

// Read FAT sector (from DIFAT[0])
const fatSectorNum = difat[0]?.sector;
if (fatSectorNum !== undefined && sectorSize === 512) {
  console.log(`\n=== FAT (sector ${fatSectorNum}) ===`);
  const fatOffset = 512 + fatSectorNum * sectorSize;
  const fatEntries = [];
  for (let i = 0; i < sectorSize / 4; i++) {
    const val = dv.getUint32(fatOffset + i * 4, true);
    fatEntries.push({ index: i, value: val, hex: '0x' + val.toString(16).padStart(8, '0') });
  }
  console.log(`FAT entries: ${fatEntries.length}`);
  for (const f of fatEntries) {
    const special = f.value === 0xFFFFFFFD ? ' (DIFSECT)' : 
                    f.value === 0xFFFFFFFE ? ' (ENDOFCHAIN)' :
                    f.value === 0xFFFFFFFC ? ' (FATSECT)' :
                    f.value === 0xFFFFFFFF ? ' (FREE)' : '';
    console.log(`  FAT[${f.index}] = ${f.hex}${special}`);
  }

  // Read directory sector
  const firstDir = dv.getUint32(48, true);
  const dirOffset = 512 + firstDir * sectorSize;
  console.log(`\n=== DIRECTORY (sector ${firstDir}) ===`);
  
  const nameBytes = new Uint8Array(ab);
  for (let i = 0; i < 16; i++) { // up to 16 entries
    const entryOff = dirOffset + i * 128;
    if (entryOff + 128 > fileData.length) break;
    
    let name = '';
    for (let j = 0; j < 64; j += 2) {
      const code = dv.getUint16(entryOff + j, true);
      if (code === 0) break;
      name += String.fromCharCode(code);
    }
    
    const nameSize = dv.getUint16(entryOff + 64, true);
    const objType = dv.getUint8(entryOff + 66);
    const types = { 0: 'UNKNOWN', 1: 'STORAGE', 2: 'STREAM', 5: 'ROOT' };
    const startingSector = dv.getUint32(entryOff + 116, true);
    const streamSize = dv.getUint32(entryOff + 120, true);
    
    if (name.length > 0 || objType > 0) {
      console.log(`  [${i}] "${name}" type=${types[objType] || objType} sector=${startingSector} size=${streamSize}`);
    }
  }
}
