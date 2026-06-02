const fs = require('fs');
const { Ole2Parser } = require('./ole2-parser.js');

const files = [
  'D:\\karaza\\websites\\Karazas-website\\sldprt-research\\new-samples\\CAM.SLDPRT',
  'D:\\karaza\\websites\\Karazas-website\\sldprt-research\\new-samples\\doneConsole.sldprt',
  'D:\\karaza\\websites\\Karazas-website\\sldprt-research\\new-samples\\SLIDING TABLE.SLDPRT'
];

for (const f of files) {
  console.log('\n' + '='.repeat(50));
  console.log('FILE: ' + f.split('\\').pop());
  try {
    const buf = fs.readFileSync(f);
    const parser = new Ole2Parser(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    parser.parse();
    const streams = parser.listStreams();
    console.log('Streams (' + streams.length + '):');
    for (const s of streams) {
      console.log('  ' + s.path + ' (' + s.size + ' bytes)');
    }
    const cp = parser.directory.find(e => e.name === 'Config-0-Partition');
    if (cp) console.log('\n>>> Config-0-Partition FOUND: ' + cp.streamSize + ' bytes!');
    else console.log('\nNo Config-0-Partition');
    
    const zlb = parser.directory.filter(e => e.name.includes('ZLB'));
    if (zlb.length > 0) {
      console.log('>>> _ZLB streams: ' + zlb.map(e => e.name + ' (' + e.streamSize + ' bytes)').join(', '));
    }
  } catch (e) {
    console.log('ERROR: ' + e.message);
  }
}
