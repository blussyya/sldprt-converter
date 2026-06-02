/**
 * Deep analysis of DisplayLists binary structure
 */
const fs = require('fs');
const { Ole2Parser } = require('./ole2-parser');

const fileData = fs.readFileSync('plate4.sldprt');
const ab = new ArrayBuffer(fileData.length);
const view = new Uint8Array(ab);
for (let i = 0; i < fileData.length; i++) view[i] = fileData[i];

const parser = new Ole2Parser(ab);
parser.parse();

const stream = parser.findStreams(/DisplayList/i)[0];
const data = new Uint8Array(parser.readStream(stream));

console.log(`DisplayLists: ${data.length} bytes\n`);

const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);

// Print all possible interpretations of the first 256 bytes
console.log('=== Raw bytes (first 256) ===');
for (let i = 0; i < Math.min(256, data.length); i += 16) {
  let hex = '', ascii = '';
  for (let j = 0; j < 16 && i + j < data.length; j++) {
    const b = data[i + j];
    hex += b.toString(16).padStart(2, '0') + ' ';
    ascii += (b >= 32 && b < 127) ? String.fromCharCode(b) : '.';
  }
  console.log(`${i.toString(16).padStart(4, '0')}: ${hex.padEnd(48)} ${ascii}`);
}

// Interpret as int32 LE
console.log('\n=== As int32 LE ===');
for (let i = 0; i < Math.min(128, data.length); i += 4) {
  const val = dv.getInt32(i, true);
  console.log(`  offset ${i.toString().padStart(4)}: ${val} (0x${(val >>> 0).toString(16).padStart(8, '0')})`);
}

// Interpret as float64 LE
console.log('\n=== As float64 LE ===');
for (let i = 0; i < Math.min(256, data.length); i += 8) {
  const val = dv.getFloat64(i, true);
  const interesting = isFinite(val) && Math.abs(val) > 0.001 && Math.abs(val) < 100000;
  console.log(`  offset ${i.toString().padStart(4)}: ${val.toFixed(6)}${interesting ? ' *' : ''}`);
}

// Look for patterns - find clusters of valid float64 values
console.log('\n=== Float64 clusters ===');
let clusterStart = -1;
let clusterCount = 0;
for (let i = 0; i < data.length - 8; i += 8) {
  const val = dv.getFloat64(i, true);
  const valid = isFinite(val) && Math.abs(val) < 100000;
  
  if (valid && Math.abs(val) > 0.0001) {
    if (clusterStart === -1) clusterStart = i;
    clusterCount++;
  } else {
    if (clusterCount >= 3) {
      console.log(`  Cluster at offset ${clusterStart}-${i-8}: ${clusterCount} float64 values`);
      // Show first few values
      for (let j = clusterStart; j < Math.min(clusterStart + 48, i); j += 8) {
        process.stdout.write(`    ${dv.getFloat64(j, true).toFixed(4)} `);
      }
      console.log();
    }
    clusterStart = -1;
    clusterCount = 0;
  }
}
if (clusterCount >= 3) {
  console.log(`  Cluster at offset ${clusterStart}: ${clusterCount} float64 values`);
}
