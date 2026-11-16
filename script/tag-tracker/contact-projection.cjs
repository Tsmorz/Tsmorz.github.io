// Feasible force projection and chain-rule tests; no garment trajectory/model tuning.
module.exports=function({check}){
  const Q=require('../../tag-tracker/contact-projection-core'),norm=v=>Math.hypot(...v),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),close=(a,b,t=1e-10)=>norm(a.map((v,i)=>v-b[i]))<=t,I=n=>Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>i===j?1:0));
  function model(k,n,A=I(k+n)){
    const state={actualOffset:0,certificates:0,last:null},f=x=>({residualVector:A.map(row=>dot(row,x)),feasibility:0,valid:true,payload:{canonical:0}});
    return {dimensions:{tangents:k,normals:n,unknowns:k+n},state,evaluate:f,jacobian:()=>A.map(row=>row.slice()),certificate:x=>{state.certificates++;state.last=x.slice();const q=f(x);q.residualVector[0]+=state.actualOffset;return q;}};
  }
  const block=mu=>({start:0,size:2,capNormals:[[0,mu]]}),base=model(2,2),q=Q.create({model:base,blocks:[block(.6)],normalActive:[0,1],tangentCount:2}),inside=[.2,-.1,2,.3],polar=[.1,-.1,-2,-.3],boundary=[.9,-.4,-.2,-.3],r=norm(boundary.slice(0,2)),normal=(-.2+.6*r)/(1+.36),expected=[.6*normal*.9/r,.6*normal*-.4/r,normal,0];
  check(close(q.project(inside).y,inside)&&close(q.project(polar).y,[0,0,0,0])&&close(q.project(boundary).y,expected,1e-14),
    'ordinary force cones project exact interior, polar and boundary states while other pressures use the nonnegative orthant');
  let seed=42,valid=true;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  for(const mu of [0,.2,.6,1.3]){const p=Q.create({model:model(2,1),blocks:[block(mu)],normalActive:[0],tangentCount:2});for(let i=0;i<80;i++){const z=Array.from({length:3},()=>4*(random()-.5)),y=p.project(z).y;valid&&=y[2]>=0&&norm(y.slice(0,2))<=mu*y[2]+1e-12&&close(p.project(y).y,y,1e-12);}}
  const tiny=Q.create({model:model(2,1),blocks:[block(1e-300)],normalActive:[0],tangentCount:2});
  check(valid&&tiny.project([0,0,-Number.MIN_VALUE]).y[2]===0,'seeded force-cone projections are feasible and idempotent across zero and positive friction, including underflow at the cone tip');
  const zero=Q.create({model:model(2,1),blocks:[block(0)],normalActive:[0],tangentCount:2}),zJ=zero.jacobian([0,0,2]),pending=Q.create({model:model(5,2),blocks:[{start:0,size:3,capFixed:0},{start:3,size:2,capNormals:[[1,.6]]}],normalActive:[0,1],tangentCount:5}),pendingY=pending.project([1,2,3,.2,-.3,-.4,1]).y,pendingJ=pending.jacobian([1,2,3,.2,-.3,-.4,1]);
  check(close(zero.project([.4,-.2,2]).y,[0,0,2])&&close(zJ.flat(),[0,0,0,0,0,0,0,0,1])&&pendingY.slice(0,3).every(v=>v===0)&&pendingY[5]===0&&pendingJ.every(row=>row.slice(0,3).every(v=>v===0)),
    'zero friction stays a normal ray and pending fixed-zero captured blocks have zero force and zero Jacobian columns');
  function difference(wrapper,z){const A=wrapper.jacobian(z,wrapper.evaluate(z)),h=1e-6;let error=0;for(let j=0;j<z.length;j++){const a=z.slice(),b=z.slice();a[j]+=h;b[j]-=h;const u=wrapper.evaluate(a).residualVector,v=wrapper.evaluate(b).residualVector;for(let i=0;i<A.length;i++)error=Math.max(error,Math.abs(A[i][j]-(u[i]-v[i])/(2*h)));}return error;}
  check([inside,polar,boundary].every(z=>difference(q,z)<2e-9)&&difference(zero,[.2,-.4,1])<2e-9&&q.project([0,0,0,0]).groups.every(g=>g.D.flat().every(Number.isFinite)),
    'cone and orthant Jacobians match finite differences away from kinks and remain finite at zero contact');
  const A=[[2,.1,.2,-.1],[.3,3,-.2,.4],[.2,.5,1,.3],[-.1,.2,.4,2],[.1,-.2,.1,.2]],chain=Q.create({model:model(2,2,A),blocks:[block(.6)],normalActive:[0,1],tangentCount:2});
  check(difference(chain,boundary)<3e-9&&chain.evaluate(boundary).residualVector.length===5&&chain.jacobian(inside,chain.evaluate(boundary)).every((row,i)=>close(row,chain.jacobian(inside)[i])),
    'the exact sparse chain rule retains every physical residual row and refuses a cached evaluation from different raw coordinates');
  const angle=.71,c=Math.cos(angle),s=Math.sin(angle),rotate=v=>[c*v[0]-s*v[1],s*v[0]+c*v[1],...v.slice(2)],B=[[c,-s,0,0],[s,c,0,0],[0,0,1,0],[0,0,0,1]],J=q.jacobian(boundary),transformed=B.map(row=>B.map(col=>row.reduce((sum,v,i)=>sum+v*dot(J[i],col),0))),rotated=q.jacobian(rotate(boundary));
  check(close(q.project(rotate(boundary)).y,rotate(q.project(boundary).y),1e-13)&&transformed.every((row,i)=>close(row,rotated[i],1e-12)),
    'force projection and its Jacobian covary under an orthonormal change of tangent frame');
  const raw=boundary.slice(),rawBefore=JSON.stringify(raw),blocks=[block(.6)],blocksBefore=JSON.stringify(blocks),immutable=Q.create({model:base,blocks,normalActive:[0,1],tangentCount:2});immutable.project(raw);immutable.evaluate(raw);immutable.jacobian(raw);immutable.certificate(raw);
  check(JSON.stringify(raw)===rawBefore&&JSON.stringify(blocks)===blocksBefore&&close(base.state.last,q.project(raw).y)&&!close(base.state.last,raw),
    'projection, evaluation and actual certification preserve inputs and pass only physical projected forces to the model');
  const actual=model(2,1),fresh=Q.create({model:actual,blocks:[block(.6)],normalActive:[0],tangentCount:2});actual.state.actualOffset=1;const search=fresh.evaluate([0,0,0]),certificate=fresh.certificate([0,0,0]);
  check(norm(search.residualVector)===0&&certificate.residualVector[0]===1&&actual.state.certificates===1,
    'fresh certification calls the original actual operator and rejects a zero search residual after the physical operator changes');
  const unsupported=[[{start:0,size:2,capFixed:1}],[{start:0,size:2,capSides:[[[0,1]],[[1,1]]]}],[{start:0,size:2,capNormals:[[0,.6]],capMax:1}],[{start:0,size:2,capNormals:[[0,.3],[1,.3]]}]],duplicate=Q.create({model:model(4,1),blocks:[block(.6),{start:2,size:2,capNormals:[[0,.6]]}],normalActive:[0],tangentCount:4}),missing=Q.create({model:{...model(2,1),dimensions:{tangents:2,normals:2,unknowns:3}},blocks:[block(.6)],normalActive:[1],tangentCount:2});
  check(unsupported.every(blocks=>Q.create({model:base,blocks,normalActive:[0,1],tangentCount:2})===null)&&duplicate===null&&close(missing.project([1,2,-1]).y,[0,0,0]),
    'unsupported positive captured/shared/truncated pressure sets return null and an omitted normal cannot fabricate an unrepresented pressure');
  let rejected=0;for(const z of [[0,0,NaN,0],[0,0,Infinity,0],[0]])try{q.project(z);}catch{rejected++;}
  check(rejected===3,'nonfinite or mismatched raw force coordinates are rejected before any physical evaluation');
};
if(require.main===module){const assert=require('node:assert/strict');module.exports({check:(ok,msg)=>{assert.ok(ok,msg);process.stdout.write('ok '+msg+'\n');}});}
