const fs = require('fs');
const { Ole2Parser } = require('./ole2-parser.js');

const filePath = 'D:\\karaza\\websites\\Karazas-website\\sldprt-research\\new-samples\\SLIDING TABLE.SLDPRT';
const buf = fs.readFileSync(filePath);
const parser = new Ole2Parser(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
parser.parse();

// Config-0 contains moPart_c → moHeader_c → su_CStringArray...
// This is SolidWorks' own serialization format
// Let me parse it to extract geometry data

const config0 = parser.directory.find(e => e.name === 'Config-0');
const c0Data = new Uint8Array(parser.readStream(config0));
console.log(`Config-0: ${c0Data.length} bytes`);

// Parse the serialization format
// Structure: [2 bytes FF FF] [2 bytes nameLen] [name] [data...]
// Data can be: integers, floats, strings, nested objects

function parseSerialization(data, offset = 0, depth = 0) {
  const results = [];
  let pos = offset;
  
  while (pos < data.length - 4) {
    // Check for FF FF marker (class name or object start)
    if (data[pos] === 0xFF && data[pos+1] === 0xFF) {
      const nameLen = data[pos+2] | (data[pos+3] << 8);
      if (nameLen > 0 && nameLen < 500 && pos + 4 + nameLen <= data.length) {
        let name = '';
        let valid = true;
        for (let j = 0; j < nameLen; j++) {
          const ch = data[pos + 4 + j];
          if (ch >= 0x20 && ch < 0x7f) name += String.fromCharCode(ch);
          else { valid = false; break; }
        }
        if (valid && name.length > 2) {
          results.push({ type: 'class', name, offset: pos });
          pos += 4 + nameLen;
          continue;
        }
      }
    }
    
    // Check for FF FE marker (end of object)
    if (data[pos] === 0xFF && data[pos+1] === 0xFE) {
      results.push({ type: 'end', offset: pos });
      pos += 2;
      continue;
    }
    
    // Try to read as int32
    const int32 = data[pos] | (data[pos+1] << 8) | (data[pos+2] << 16) | (data[pos+3] << 24);
    if (int32 >= 0 && int32 < 1000000) {
      results.push({ type: 'int32', value: int32, offset: pos });
      pos += 4;
      continue;
    }
    
    // Try to read as float64
    if (pos + 8 <= data.length) {
      const dv = new DataView(data.buffer, data.byteOffset + pos, 8);
      try {
        const val = dv.getFloat64(0, true);
        if (isFinite(val) && Math.abs(val) < 1000000 && !isNaN(val)) {
          results.push({ type: 'float64', value: val, offset: pos });
          pos += 8;
          continue;
        }
      } catch(e) {}
    }
    
    // Try to read as UTF-16 string
    if (data[pos] >= 0x20 && data[pos] < 0x7f && data[pos+1] === 0x00) {
      let str = '';
      let j = pos;
      while (j < data.length - 1 && data[j] >= 0x20 && data[j] < 0x7f && data[j+1] === 0x00) {
        str += String.fromCharCode(data[j]);
        j += 2;
      }
      if (str.length > 1) {
        results.push({ type: 'utf16', value: str, offset: pos });
        pos = j;
        continue;
      }
    }
    
    // Try to read as ASCII string
    if (data[pos] >= 0x20 && data[pos] < 0x7f && data[pos+1] >= 0x20 && data[pos+1] < 0x7f) {
      let str = '';
      let j = pos;
      while (j < data.length && data[j] >= 0x20 && data[j] < 0x7f) {
        str += String.fromCharCode(data[j]);
        j++;
      }
      if (str.length > 3) {
        results.push({ type: 'ascii', value: str, offset: pos });
        pos = j;
        continue;
      }
    }
    
    pos++;
  }
  
  return results;
}

console.log('\n=== Parsing Config-0 serialization ===');
const parsed = parseSerialization(c0Data);
console.log(`Total records: ${parsed.length}`);

// Show class names
const classes = parsed.filter(r => r.type === 'class');
console.log(`\nClass names (${classes.length}):`);
for (const c of classes) {
  console.log(`  ${c.offset.toString(16).padStart(6)}: ${c.name}`);
}

// Show strings
const strings = parsed.filter(r => r.type === 'utf16' || r.type === 'ascii');
console.log(`\nStrings (${strings.length}):`);
for (const s of strings.slice(0, 50)) {
  console.log(`  ${s.offset.toString(16).padStart(6)}: ${s.value}`);
}

// Show float64 values
const floats = parsed.filter(r => r.type === 'float64');
console.log(`\nFloat64 values (${floats.length}):`);
for (const f of floats.slice(0, 50)) {
  console.log(`  ${f.offset.toString(16).padStart(6)}: ${f.value.toFixed(6)}`);
}

// Now let me look at Config-0-Body more carefully
// The first 24 bytes might be a header, followed by serialized data
console.log('\n=== Config-0-Body analysis ===');
const body = parser.directory.find(e => e.name === 'Config-0-Body');
const bodyData = new Uint8Array(parser.readStream(body));

// Check if body data has the same serialization structure
console.log('\nBody serialization:');
const bodyParsed = parseSerialization(bodyData);
console.log(`Total records: ${bodyParsed.length}`);

const bodyClasses = bodyParsed.filter(r => r.type === 'class');
console.log(`\nClass names (${bodyClasses.length}):`);
for (const c of bodyClasses) {
  console.log(`  ${c.offset.toString(16).padStart(6)}: ${c.name}`);
}

const bodyStrings = bodyParsed.filter(r => r.type === 'utf16' || r.type === 'ascii');
console.log(`\nStrings (${bodyStrings.length}):`);
for (const s of bodyStrings.slice(0, 30)) {
  console.log(`  ${s.offset.toString(16).padStart(6)}: ${s.value}`);
}

const bodyFloats = bodyParsed.filter(r => r.type === 'float64');
console.log(`\nFloat64 values (${bodyFloats.length}):`);
for (const f of bodyFloats.slice(0, 30)) {
  console.log(`  ${f.offset.toString(16).padStart(6)}: ${f.value.toFixed(6)}`);
}
