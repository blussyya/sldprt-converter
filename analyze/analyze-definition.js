/**
 * Analyze Definition stream - should contain Parasolid geometry
 */
const fs = require('fs');
const { Ole2Parser } = require('./ole2-parser');

const fileData = fs.readFileSync('plate4.sldprt');
const ab = new ArrayBuffer(fileData.length);
const view = new Uint8Array(ab);
for (let i = 0; i < fileData.length; i++) view[i] = fileData[i];

const parser = new Ole2Parser(ab);
parser.parse();

// Look at Definition stream
const defStream = parser.findStreams(/Definition/i)[0];
const data = new Uint8Array(parser.readStream(defStream));

console.log(`Definition stream: ${data.length} bytes\n`);

const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);

// Show first 1024 bytes as hex
console.log('=== First 1024 bytes ===');
for (let i = 0; i < Math.min(1024, data.length); i += 16) {
  let hex = '', ascii = '';
  for (let j = 0; j < 16 && i + j < data.length; j++) {
    const b = data[i + j];
    hex += b.toString(16).padStart(2, '0') + ' ';
    ascii += (b >= 32 && b < 127) ? String.fromCharCode(b) : '.';
  }
  console.log(`${i.toString(16).padStart(4, '0')}: ${hex.padEnd(48)} ${ascii}`);
}

// Look for string patterns
console.log('\n=== ASCII strings (min 8 chars) ===');
let str = '';
let strStart = 0;
for (let i = 0; i < data.length; i++) {
  const b = data[i];
  if (b >= 32 && b < 127) {
    if (str.length === 0) strStart = i;
    str += String.fromCharCode(b);
  } else {
    if (str.length >= 8) {
      console.log(`  offset ${strStart}: "${str}"`);
    }
    str = '';
  }
}

// Look for Parasolid markers
console.log('\n=== Parasolid markers ===');
// Common Parasolid tokens
const markers = [
  [0x42, 0x4F, 0x44, 0x59],  // BODY
  [0x46, 0x41, 0x43, 0x45],  // FACE
  [0x45, 0x44, 0x47, 0x45],  // EDGE
  [0x56, 0x45, 0x52, 0x54],  // VERT
  [0x4C, 0x4F, 0x4F, 0x50],  // LOOP
  [0x53, 0x48, 0x45, 0x4C],  // SHEL
  [0x4C, 0x4F, 0x4F, 0x50],  // LOOP
];

for (const marker of markers) {
  for (let i = 0; i < data.length - 4; i++) {
    if (data[i] === marker[0] && data[i+1] === marker[1] && 
        data[i+2] === marker[2] && data[i+3] === marker[3]) {
      const context = Buffer.from(data.slice(Math.max(0, i-4), i+20)).toString('ascii').replace(/[^\x20-\x7E]/g, '.');
      console.log(`  Found "${String.fromCharCode(...marker)}" at offset ${i}: ...${context}...`);
    }
  }
}

// Look for CommonStreamHeader (SolidWorks 2015+)
console.log('\n=== Stream header check ===');
const header = Buffer.from(data.slice(0, 64)).toString('ascii').replace(/[^\x20-\x7E]/g, '.');
console.log(`First 64 bytes ASCII: ${header}`);

// Check if it starts with a known SolidWorks stream header
const firstBytes = Array.from(data.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' ');
console.log(`First 16 bytes: ${firstBytes}`);
