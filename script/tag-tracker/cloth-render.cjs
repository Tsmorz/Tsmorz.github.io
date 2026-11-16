// Static cut-pattern/render checks only. No fabric-fold simulation or scripted folding playthrough.
module.exports=function({check}){
  const root=require('path').resolve(__dirname,'../..'),Cloth=require(root+'/tag-tracker/cloth-core'),Render=require(root+'/tag-tracker/cloth-render-core'),C=require(root+'/tag-tracker/tracker-core');
  const I=[1,0,0,0,1,0,0,0,1],create=resolution=>Cloth.shirt({key:'shirt',at:[-.02,0,0],width:.28,height:.4,body_span:.22,resolution,mass:.035,thickness:.002,pile:0},{R:I.slice(),t:[0,0,0],size:[.5,.9]});
  const close=(a,b,t=1e-6)=>a.length===b.length&&a.every((v,i)=>Math.abs(v-b[i])<t);
  for(const resolution of [13,17,21]){
    const c=create(resolution),before=JSON.stringify({nodes:c.nodes,material:c.material,triangles:c.triangles,edges:c.edges}),m=Render.mesh(c),count=m.pos.length/3;
    check(count>c.nodes.length*10&&count<65536&&m.idx.length>c.triangles.length*20&&m.idx.every(i=>i<count)&&[...m.pos,...m.nrm,...m.uv,...m.hem].every(Number.isFinite),`shirt display at resolution ${resolution}: refined finite mesh fits 16-bit buffers`);
    check(m.uv.length===count*2&&m.hem.length===count*2&&m.hem.every((v,i)=>i%2||v>=0)&&Array.from({length:count},(_,i)=>Math.hypot(...m.nrm.subarray(i*3,i*3+3))).every(v=>Math.abs(v-1)<1e-5),`shirt display at resolution ${resolution}: cotton material coordinates, seam distances and unit normals`);
    check(JSON.stringify({nodes:c.nodes,material:c.material,triangles:c.triangles,edges:c.edges})===before,`shirt display at resolution ${resolution}: physical particles, constraints and cut pattern stay unchanged`);
    const edges=[];for(let i=0;i<count;i++)if(m.hem[i*2]<1e-7)edges.push([m.uv[i*2],m.uv[i*2+1]]);
    const step=c.width/(c.N-1),rounded=edges.filter(p=>{const t=(p[0]+c.width/2)/step;return Math.abs(t-Math.round(t))>.03;}).length;
    check(edges.length>100&&rounded>edges.length*.25&&Math.min(...m.pos.filter((_,i)=>i%3===2))>=.00014&&Math.max(...m.pos.filter((_,i)=>i%3===2))<.0025,`shirt display at resolution ${resolution}: rounded cut edges and a thin hem stay above the table`);
    const landmarks=[...c.landmarks.cuffs,...c.landmarks.hem,...c.landmarks.shoulders],error=landmarks.map(i=>Math.min(...edges.map(p=>Math.hypot(p[0]-c.material[i][0],p[1]-c.material[i][1]))));
    let minimumArea=Infinity;
    for(let t=0;t<c.triangles.length*16*2;t+=6){const [a,b,d]=[m.idx[t],m.idx[t+1],m.idx[t+2]].map(i=>[m.uv[i*2],m.uv[i*2+1]]);minimumArea=Math.min(minimumArea,(b[0]-a[0])*(d[1]-a[1])-(b[1]-a[1])*(d[0]-a[0]));}
    check(Math.max(...error)<(resolution===17?.001:.006)&&minimumArea>0,`shirt display at resolution ${resolution}: boundary fairing keeps grab landmarks aligned and cannot invert the rest-pattern faces`);
    const positions=m.pos,normals=m.nrm,uv=m.uv,hem=m.hem,indices=m.idx;
    check(Render.mesh(c)===m&&m.pos===positions&&m.nrm===normals&&m.uv===uv&&m.hem===hem&&m.idx===indices,`shirt display at resolution ${resolution}: cached topology and buffers are reused`);
  }
  const c=create(17),initial=Render.mesh(c),positions=[...initial.pos],normals=[...initial.nrm],uv=[...initial.uv],hem=[...initial.hem],R=C.rodrigues([.35,-.2,.5]),T=[.2,-.4,.7];
  // A rigidly placed static specimen exercises coordinate attachment without simulating a fold.
  c.nodes.forEach(n=>{n.p=C.add(C.mulv(R,n.p),T);});c.table={...c.table,R,t:T};
  const moved=Render.mesh(c),expectedPositions=[],expectedNormals=[];
  for(let i=0;i<positions.length;i+=3){expectedPositions.push(...C.add(C.mulv(R,positions.slice(i,i+3)),T));expectedNormals.push(...C.mulv(R,normals.slice(i,i+3)));}
  check(close([...moved.pos],expectedPositions)&&close([...moved.nrm],expectedNormals)&&close([...moved.uv],uv,1e-12)&&close([...moved.hem],hem,1e-12),'a moved static shirt carries its refined surface, cotton weave and sewn edge with its physical nodes');
  const saved=moved.pos.slice();c.nodes[c.landmarks.cuffs[0]].p[2]+=.001;
  const adjusted=Render.mesh(c);
  check(adjusted.pos.some((v,i)=>Math.abs(v-saved[i])>1e-6)&&[...adjusted.pos,...adjusted.nrm].every(Number.isFinite),'a small static cuff adjustment propagates through the render stencils without changing topology');
  check(Render.mesh({kind:'towel'})===null,'the garment renderer leaves the existing towel renderer available');
};
if(require.main===module){const assert=require('node:assert/strict');module.exports({check:(ok,msg)=>{assert.ok(ok,msg);process.stdout.write('ok '+msg+'\n');}});}
