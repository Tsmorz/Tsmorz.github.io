// Numerical contact correspondence; this test never carries constitutive history or applies forces.
module.exports=function({check}){
  const Warm=require('../../tag-tracker/contact-warm-core'),body={},shape={},record=(u,v=0,extra={})=>({kind:'rubber',body,jaw:1,shape,parts:[{panel:0,sign:1,point:[u,v]}],normal:[0,1,0],...extra}),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const previous=[record(0),record(.01)],current=[record(.009),record(.002),record(.001)];
  check(same(Warm.match(previous,current,{maxDistance:.02}),[1,-1,0]),
    'globally nearest contact matches are deterministic and one-to-one instead of copying one old pressure to several new contacts');
  check(same(Warm.match([record(0),record(.01)],[record(.005),record(.005)],{maxDistance:.02}),[0,1])&&same(Warm.match([],current,{maxDistance:.02}),[-1,-1,-1])&&same(Warm.match(previous,[],{maxDistance:.02}),[]),
    'ambiguous equal-distance matches use stable indices and empty manifolds carry no numerical guesses');
  const wrong=[record(0,0,{body:{}}),record(0,0,{shape:{}}),record(0,0,{jaw:-1}),record(0,0,{kind:'carrier'}),record(0,0,{parts:[{panel:1,sign:1,point:[0,0]}]}),record(0,0,{parts:[{panel:0,sign:-1,point:[0,0]}]})];
  check(Warm.match([record(0)],wrong,{maxDistance:.02}).every(index=>index===-1),
    'body, shape, jaw, material panel, signed layer and contact kind never share a warm-force guess');
  const layer=(u,v,other)=>record(u,0,{kind:'layer',body:null,shape:null,jaw:undefined,parts:[{panel:0,sign:1,point:[u,0]},{panel:1,sign:-1,point:[v,other]}]}),a=layer(0,0,0),inside=layer(.001,.002,0),outside=layer(.001,.002,.011);
  check(same(Warm.match([a],[outside,inside],{maxDistance:.01}),[-1,0]),
    'every material part of a layer pair must remain nearby, rather than matching only its first sheet');
  const normals=[record(0,0,{normal:[0,-1,0]}),record(0,0,{normal:[1,0,0]}),record(0,0,{normal:[.7,.7,0]}),record(0,0,{normal:[0,2,0]})];
  check(same(Warm.match([record(0)],normals,{maxDistance:0,normalCos:.9}),[-1,-1,-1,0]),
    'opposite and different contact faces are rejected using normalized positive normal alignment');
  const angle=.73,c=Math.cos(angle),s=Math.sin(angle),rotate=n=>[c*n[0]-s*n[1],s*n[0]+c*n[1],n[2]],rotatedPrevious=previous.map(value=>({...value,normal:rotate(value.normal)})),rotatedCurrent=current.map(value=>({...value,normal:rotate(value.normal)})),before=JSON.stringify({previous,current});
  check(same(Warm.match(previous,current,{maxDistance:.02}),Warm.match(rotatedPrevious,rotatedCurrent,{maxDistance:.02}))&&JSON.stringify({previous,current})===before,
    'a common rigid-frame rotation leaves material correspondence unchanged and matching never mutates its inputs');
  check(same(Warm.match([record(0)],[record(.010001),record(.01)],{maxDistance:.01}),[-1,0]),
    'the material-distance bound is inclusive and a separated contact receives no warm guess');
  check([()=>Warm.match(previous,current,{maxDistance:-1}),()=>Warm.match(previous,current,{maxDistance:NaN}),()=>Warm.match(previous,current,{maxDistance:1,normalCos:2}),()=>Warm.match([record(0,0,{normal:[0,0,0]})],current,{maxDistance:1}),()=>Warm.match([record(0,0,{parts:[{panel:0,sign:1,point:[NaN,0]}]})],current,{maxDistance:1})].every(fn=>{try{fn();return false;}catch{return true;}}),
    'invalid correspondence bounds and nonfinite or degenerate material descriptors are rejected');
  // Exhaustive reference has no spatial/index assumptions. Exact ordering is
  // significant: changing a tie changes the transported numerical force field.
  function exhaustive(old,next,radius){
    const pairs=[];
    next.forEach((b,j)=>old.forEach((a,i)=>{
      if(a.kind!==b.kind||a.body!==b.body||a.jaw!==b.jaw||a.shape!==b.shape||a.parts.length!==b.parts.length)return;
      const cosine=a.normal.reduce((s,v,k)=>s+v/Math.hypot(...a.normal)*(b.normal[k]/Math.hypot(...b.normal)),0);if(!(cosine>0&&cosine>=.9))return;
      let distance=0;for(let k=0;k<a.parts.length;k++){const p=a.parts[k],q=b.parts[k],d=Math.hypot(p.point[0]-q.point[0],p.point[1]-q.point[1]);if(p.panel!==q.panel||p.sign!==q.sign||d>radius)return;distance=Math.hypot(distance,d);}pairs.push({i,j,distance});
    }));
    pairs.sort((a,b)=>a.distance-b.distance||a.i-b.i||a.j-b.j);const used=new Set(),out=next.map(()=>-1);for(const p of pairs)if(out[p.j]<0&&!used.has(p.i)){out[p.j]=p.i;used.add(p.i);}return out;
  }
  let seed=1309;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;},bodies=[body,{}],shapes=[shape,{}];let equivalent=true;
  for(const radius of [0,Number.MIN_VALUE,1e-6,.01,1,1e200,Number.MAX_VALUE])for(let trial=0;trial<12;trial++){
    const cloud=Array.from({length:70},(_,i)=>{
      const scale=radius===0?.01:radius,offset=trial===1?Number.MAX_VALUE:trial===2?scale*2**51:0,x=offset+scale*(Math.floor(random()*11)-5+(i%3===0?Number.EPSILON:0)),y=scale*(Math.floor(random()*7)-3);
      return record(Number.isFinite(x)?x:0,Number.isFinite(y)?y:0,{body:bodies[i%2],shape:shapes[Math.floor(i/2)%2],jaw:i%3?1:-1,parts:[{panel:i%2,sign:i%3?1:-1,point:[Number.isFinite(x)?x:0,Number.isFinite(y)?y:0]}],normal:i%5?[0,1,0]:[1,0,0]});
    }),a=cloud.slice(0,50),b=cloud.slice(20).reverse();
    equivalent&&=same(Warm.match(a,b,{maxDistance:radius}),exhaustive(a,b,radius));
  }
  check(equivalent,'identity/spatial buckets exactly preserve exhaustive correspondence across ties, zero/subnormal radii, cell boundaries and extreme finite SI coordinates');
  const multiA=Array.from({length:40},(_,i)=>layer(i*.002,(i%6)*.003,0)),multiB=multiA.map((value,i)=>({...value,parts:value.parts.map((part,k)=>({...part,point:[part.point[0]+(i%3-1)*.0002,part.point[1]+k*.0001]}))})).reverse();
  check(same(Warm.match(multiA,multiB,{maxDistance:.004}),exhaustive(multiA,multiB,.004)),
    'first-part spatial indexing still verifies and orders every signed material part of multilayer contacts');
};
if(require.main===module){const assert=require('node:assert/strict');module.exports({check:(ok,message)=>{assert.ok(ok,message);process.stdout.write('ok '+message+'\n');}});}
