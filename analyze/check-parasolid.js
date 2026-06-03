const fs = require('fs');
const zlib = require('zlib');
const { Ole2Parser } = require('./ole2-parser.js');

const files = [
  { path: 'D:\\karaza\\websites\\Karazas-website\\sldprt-research\\new-samples\\CAM.SLDPRT', name: 'CAM (SW2022)' },
  { path: 'D:\\karaza\\websites\\Karazas-website\\sldprt-research\\new-samples\\SLIDING TABLE.SLDPRT', name: 'SLIDING TABLE (SW2017)' },
  { path: 'D:\\karaza\\websites\\Karazas-website\\sldprt-research\\new-samples\\doneConsole.sldprt', name: 'doneConsole (old)' },
];

for (const file of files) {
  console.log('\n' + '='.repeat(60));
  console.log(file.name);
  console.log('='.repeat(60));

  const buf = fs.readFileSync(file.path);
  const parser = new Ole2Parser(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  parser.parse();

  // Check Config-0-Body
  const body = parser.directory.find(e => e.name === 'Config-0-Body');
  if (body) {
    let data;
    try {
      data = new Uint8Array(parser.readStream(body));
    } catch (e) {
      console.log(`\nConfig-0-Body: read error: ${e.message}`);
      continue;
    }
    console.log(`\nConfig-0-Body: ${data.length} bytes`);
    
    // Check first 32 bytes
    console.log('First 32 bytes:', Array.from(data.slice(0, 32)).map(b => b.toString(16).padStart(2, '0')).join(' '));
    
    // Check for "PS " header (Parasolid)
    if (data[0] === 0x50 && data[1] === 0x53) {
      console.log('>>> PARASOLID HEADER FOUND!');
    }
    
    // Check for class names
    const text = data.toString('binary');
    const classes = text.match(/mo[A-Z][a-zA-Z_]+_c/g);
    if (classes) {
      console.log('Class names:', [...new Set(classes)].slice(0, 10).join(', '));
    }
    
    // Try raw inflate
    try {
      const result = zlib.inflateRawSync(data);
      console.log(`Raw inflate: ${result.length} bytes`);
      console.log('First 32:', Array.from(result.slice(0, 32)).map(b => b.toString(16).padStart(2, '0')).join(' '));
      if (result[0] === 0x50 && result[1] === 0x53) {
        console.log('>>> DECOMPRESSED PARASOLID!');
        fs.writeFileSync(file.path.replace(/\.[^.]+$/, '') + '.x_b', result);
        console.log('Saved!');
      }
    } catch (e) {}
    
    // Try inflate with header
    try {
      const result = zlib.inflateSync(data);
      console.log(`Inflate (with header): ${result.length} bytes`);
      console.log('First 32:', Array.from(result.slice(0, 32)).map(b => b.toString(16).padStart(2, '0')).join(' '));
    } catch (e) {}
    
    // Try searching for zlib streams
    let foundValid = false;
    for (let i = 0; i < data.length - 2 && !foundValid; i++) {
      if (data[i] === 0x78 && (data[i+1] === 0x01 || data[i+1] === 0x9C || data[i+1] === 0xDA)) {
        try {
          const result = zlib.inflateRawSync(data.slice(i + 2));
          if (result.length > 100) {
            console.log(`\nValid zlib at offset ${i}: ${result.length} bytes`);
            console.log('First 32:', Array.from(result.slice(0, 32)).map(b => b.toString(16).padStart(2, '0')).join(' '));
            if (result[0] === 0x50 && result[1] === 0x53) {
              console.log('>>> DECOMPRESSED PARASOLID!');
              fs.writeFileSync(file.path.replace(/\.[^.]+$/, '') + '.x_b', result);
              console.log('Saved!');
            }
            foundValid = true;
          }
        } catch (e) {}
      }
    }
  }

  // Check Config-0 for Parasolid data
  const config0 = parser.directory.find(e => e.name === 'Config-0');
  if (config0) {
    let data;
    try {
      data = new Uint8Array(parser.readStream(config0));
    } catch (e) {
      console.log(`\nConfig-0: read error: ${e.message}`);
      continue;
    }
    console.log(`\nConfig-0: ${data.length} bytes`);
    console.log('First 32 bytes:', Array.from(data.slice(0, 32)).map(b => b.toString(16).padStart(2, '0')).join(' '));
    
    if (data[0] === 0x50 && data[1] === 0x53) {
      console.log('>>> PARASOLID HEADER IN CONFIG-0!');
    }
    
    const text = data.toString('binary');
    const classes = text.match(/mo[A-Z][a-zA-Z_]+_c/g);
    if (classes) {
      console.log('Class names:', [...new Set(classes)].slice(0, 5).join(', '));
    }
  }

  // Check DisplayLists__Zip
  const dl = parser.directory.find(e => e.name === 'DisplayLists__Zip');
  if (dl) {
    let data;
    try {
      data = new Uint8Array(parser.readStream(dl));
    } catch (e) {
      console.log(`\nDisplayLists__Zip: read error: ${e.message}`);
      continue;
    }
    console.log(`\nDisplayLists__Zip: ${data.length} bytes`);
    console.log('First 32 bytes:', Array.from(data.slice(0, 32)).map(b => b.toString(16).padStart(2, '0')).join(' '));
    
    // Try decompress
    try {
      const result = zlib.inflateRawSync(data.slice(2));
      console.log(`Decompressed: ${result.length} bytes`);
      console.log('First 32:', Array.from(result.slice(0, 32)).map(b => b.toString(16).padStart(2, '0')).join(' '));
    } catch (e) {
      try {
        const result = zlib.inflateSync(data);
        console.log(`Inflate (with header): ${result.length} bytes`);
      } catch (e2) {}
    }
  }

  // Check DisplayLists (uncompressed)
  const dlRaw = parser.directory.find(e => e.name === 'DisplayLists');
  if (dlRaw) {
    let data;
    try {
      data = new Uint8Array(parser.readStream(dlRaw));
    } catch (e) {
      console.log(`\nDisplayLists: read error: ${e.message}`);
      continue;
    }
    console.log(`\nDisplayLists: ${data.length} bytes`);
    console.log('First 32 bytes:', Array.from(data.slice(0, 32)).map(b => b.toString(16).padStart(2, '0')).join(' '));
  }

  // Check all streams for "PS " header
  console.log('\n--- All streams check ---');
  for (const entry of parser.directory) {
    if (entry.objType !== 2 || entry.streamSize < 10) continue;
    try {
      const data = new Uint8Array(parser.readStream(entry));
      if (data.length >= 2 && data[0] === 0x50 && data[1] === 0x53) {
        console.log(`>>> PARASOLID in ${entry.name}! (${data.length} bytes)`);
        fs.writeFileSync(file.path.replace(/\.[^.]+$/, '') + '-' + entry.name + '.x_b', data);
      }
    } catch (e) {
      // skip broken streams
    }
  }
}
