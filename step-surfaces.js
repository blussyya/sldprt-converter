const fs = require('fs');
const STEP_PATH = process.argv[2] || 'C:\\Users\\basha\\Downloads\\isolated-usb-hub-case-1.snapshot.4\\USB hub case BOTTOM.STEP';
const step = fs.readFileSync(STEP_PATH,'utf8');

// Parse entities
const ents={};let cId=null,cTx='';
for(const line of step.split('\n')){const t=line.trim();if(!t||t.startsWith('/*')||t.startsWith('*'))continue;const sm=t.match(/^#(\d+)\s*=\s*(.*)/);if(sm){if(cId!==null)ents[cId]=cTx;cId=+sm[1];cTx=sm[2];}else if(cId!==null){cTx+=' '+t;}if(cTx.endsWith(';')){if(cId!==null)ents[cId]=cTx.slice(0,-1).trim();cId=null;cTx='';}}
if(cId!==null)ents[cId]=cTx;
function gR(t){return[...t.matchAll(/#(\d+)/g)].map(m=>+m[1]);}
function gT(t){const m=t.match(/^(\w[\w_]*)\s*\(/);return m?m[1]:t.split(' ')[0];}

// Extract all surface definitions
console.log('=== Surface definitions ===\n');
for(const[id,t]of Object.entries(ents)){
  const tp=gT(t);
  if(tp==='PLANE'){
    const refs=gR(t);
    // PLANE('NONE', #position, #normal)
    const posId=refs[0], normId=refs[1];
    // Get position point
    const posEnt=ents[posId]?gT(ents[posId]):'?';
    const normEnt=ents[normId]?gT(ents[normId]):'?';
    console.log(`#${id} PLANE pos=#${posId}(${posEnt}) norm=#${normId}(${normEnt})`);
  }
  if(tp==='CYLINDRICAL_SURFACE'){
    const refs=gR(t);
    console.log(`#${id} CYLINDRICAL_SURFACE axis=#${refs[0]} location=#${refs[1]}`);
  }
  if(tp==='CONICAL_SURFACE'){
    const refs=gR(t);
    console.log(`#${id} CONICAL_SURFACE axis=#${refs[0]} location=#${refs[1]} angle_ref=#${refs[2]}`);
  }
}

// Extract AXIS2_PLACEMENT_3D (defines coordinate systems for surfaces)
console.log('\n=== AXIS2_PLACEMENT_3D ===\n');
for(const[id,t]of Object.entries(ents)){
  if(gT(t)!=='AXIS2_PLACEMENT_3D')continue;
  const refs=gR(t);
  // location=#pt, z_direction=#dir, x_direction=#dir
  console.log(`#${id} A2P3D loc=#${refs[0]} zdir=#${refs[1]} xdir=#${refs[2]}`);
}

// Extract DIRECTION vectors
console.log('\n=== Key DIRECTION vectors ===\n');
const dirIds=new Set();
for(const[id,t]of Object.entries(ents)){
  if(gT(t)!=='DIRECTION')continue;
  const c=t.match(/\(\s*([-\d.E+]+)\s*,\s*([-\d.E+]+)\s*,\s*([-\d.E+]+)\s*\)/);
  if(c)console.log(`#${id} DIR [${(+c[1]).toFixed(4)}, ${(+c[2]).toFixed(4)}, ${(+c[3]).toFixed(4)}]`);
}

// Extract CARTESIAN_POINT positions used by surfaces
console.log('\n=== Key CARTESIAN_POINT positions ===\n');
// Only show points referenced by surface-related entities
const surfPtIds=new Set();
for(const[id,t]of Object.entries(ents)){
  const tp=gT(t);
  if(['PLANE','CYLINDRICAL_SURFACE','CONICAL_SURFACE','AXIS2_PLACEMENT_3D'].includes(tp)){
    for(const r of gR(t)){
      if(ents[r]&&gT(ents[r])==='CARTESIAN_POINT') surfPtIds.add(r);
      // Also check if it's an A2P3D whose location is a CARTESIAN_POINT
      if(ents[r]&&gT(ents[r])==='AXIS2_PLACEMENT_3D'){
        const a2refs=gR(ents[r]);
        for(const ar of a2refs){
          if(ents[ar]&&gT(ents[ar])==='CARTESIAN_POINT') surfPtIds.add(ar);
        }
      }
    }
  }
}
for(const pid of [...surfPtIds].sort((a,b)=>a-b)){
  const t=ents[pid];
  const c=t.match(/\(\s*([-\d.E+]+)\s*,\s*([-\d.E+]+)\s*,\s*([-\d.E+]+)\s*\)/);
  if(c)console.log(`#${pid} PT [${(+c[1]).toFixed(3)}, ${(+c[2]).toFixed(3)}, ${(+c[3]).toFixed(3)}]`);
}

// Extract FACE_OUTER_BOUND chains to show boundary curves
console.log('\n=== ADVANCED_FACE → boundary chain ===\n');
for(const[id,t]of Object.entries(ents)){
  if(gT(t)!=='ADVANCED_FACE')continue;
  const refs=gR(t);
  const surfId=refs[refs.length-1];
  const surfType=ents[surfId]?gT(ents[surfId]):'?';
  const boundIds=refs.slice(0,-1);
  const boundInfo=boundIds.map(bid=>{
    const fb=ents[bid];if(!fb)return bid+'?';
    const fbRefs=gR(fb);
    return `#${bid}(${gT(fb)})→EL#${fbRefs[0]}`;
  });
  console.log(`AF#${id} (${surfType}) bounds: ${boundInfo.join(', ')}`);
}

// Now trace EDGE_LOOP → ORIENTED_EDGE → EDGE_CURVE → curve type
console.log('\n=== Sample boundary curve chain (AF#781 bottom face) ===\n');
const af781=ents[781];
if(af781){
  const refs=gR(af781);
  const boundIds=refs.slice(0,-1);
  for(const bid of boundIds){
    const fb=ents[bid];if(!fb)continue;
    const fbRefs=gR(fb);
    const loopId=fbRefs[0];
    const loop=ents[loopId];if(!loop)continue;
    const oeIds=gR(loop);
    console.log(`FOB#${bid} → EL#${loopId} (${oeIds.length} edges):`);
    for(const oeId of oeIds){
      const oe=ents[oeId];if(!oe)continue;
      const oeRefs=gR(oe);
      const ecId=oeRefs[2]; // edge_curve is 3rd ref (after * *)
      const ec=ents[ecId];if(!ec)continue;
      const ecRefs=gR(ec);
      const curveId=ecRefs[2]; // geometry is 3rd ref
      const curve=ents[curveId];
      const curveType=curve?gT(curve):'?';
      const orient=oe.includes('.T.')?'T':'F';
      console.log(`  OE#${oeId}(${orient}) → EC#${ecId} → curve#${curveId}(${curveType})`);
    }
    console.log('');
  }
}
