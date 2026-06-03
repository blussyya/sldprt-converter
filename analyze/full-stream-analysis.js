const fs = require('fs');
const zlib = require('zlib');
const { Ole2Parser } = require('./ole2-parser.js');

const files = [
  'D:\\karaza\\websites\\Karazas-website\\sldprt-research\\new-samples\\CAM.SLDPRT',
  'D:\\karaza\\websites\\Karazas-website\\sldprt-research\\new-samples\\SLIDING TABLE.SLDPRT',
];

for (const filePath of files) {
  const fname = filePath.split('\\').pop();
  console.log('\n' + '='.repeat(70));
  console.log(fname);
  console.log('='.repeat(70));

  const buf = fs.readFileSync(filePath);
  const parser = new Ole2Parser(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  parser.parse();

  // List ALL streams with full paths and hex dump of first 32 bytes
  const allStreams = parser.directory.filter(e => e.objType === 2);
  console.log(`\nTotal streams: ${allStreams.length}`);
  
  for (const entry of allStreams) {
    if (entry.streamSize < 4) continue;
    
    let data;
    try {
      data = new Uint8Array(parser.readStream(entry));
    } catch (e) {
      console.log(`\n${entry.fullPath} (${entry.streamSize} bytes) - READ ERROR: ${e.message}`);
      continue;
    }
    
    if (data.length < 4) continue;
    
    const hex = Array.from(data.slice(0, 48)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(data.slice(0, 48)).map(b => (b >= 32 && b < 127) ? String.fromCharCode(b) : '.').join('');
    
    // Check for Parasolid markers
    let marker = '';
    if (data[0] === 0x50 && data[1] === 0x53) marker = ' <<< PARASOLID PS header!';
    if (data[0] === 0x42) marker = ' <<< Possible bare binary?';
    
    // Check for class names
    const text = data.toString('binary');
    if (text.includes('moPart_c')) marker += ' [moPart_c]';
    if (text.includes('moHeader_c')) marker += ' [moHeader_c]';
    
    console.log(`\n${entry.fullPath} (${entry.streamSize} bytes)`);
    console.log(`  ${hex} ${ascii}${marker}`);
    
    // For Config streams, show more detail
    if (entry.name.startsWith('Config')) {
      // Look for float64 values
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const floats = [];
      for (let i = 0; i <= Math.min(data.length - 8, 512); i += 8) {
        try {
          const val = dv.getFloat64(i, true);
          if (isFinite(val) && Math.abs(val) > 0.001 && Math.abs(val) < 10000) {
            floats.push({ offset: i, value: val });
          }
        } catch (e) {}
      }
      if (floats.length > 0) {
        console.log(`  Float64 values (first 10): ${floats.slice(0, 10).map(f => f.value.toFixed(4)).join(', ')}`);
      }
      
      // Try decompression
      for (let i = 0; i < data.length - 2; i++) {
        if (data[i] === 0x78 && (data[i+1] === 0x01 || data[i+1] === 0x9C || data[i+1] === 0xDA)) {
          try {
            const result = zlib.inflateRawSync(data.slice(i + 2));
            if (result.length > 50) {
              const isPS = result[0] === 0x50 && result[1] === 0x53;
              console.log(`  zlib at ${i}: ${result.length} bytes | PS=${isPS} | ${Array.from(result.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
              if (isPS) {
                const outFile = filePath.replace(/\.[^.]+$/, '') + '-' + entry.name + '-parasolid.x_b';
                fs.writeFileSync(outFile, result);
                console.log(`  SAVED: ${outFile}`);
              }
            }
          } catch (e) {}
        }
      }
    }
  }
}
