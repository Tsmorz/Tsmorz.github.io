// Static cut-pattern/render checks only. No fabric-fold simulation or scripted folding playthrough.
module.exports=function({check}){
  const root=require('path').resolve(__dirname,'../..'),Cloth=require(root+'/tag-tracker/cloth-core'),Render=require(root+'/tag-tracker/cloth-render-core'),C=require(root+'/tag-tracker/tracker-core');
  const I=[1,0,0,0,1,0,0,0,1],create=resolution=>Cloth.shirt({key:'shirt',at:[-.02,0,0],width:.28,height:.4,body_span:.22,resolution,panels:2,areal_density:.18,thickness:.0006,pile:0},{R:I.slice(),t:[0,0,0],size:[.5,.9]});
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
    const counts=new Map();for(let t=0;t<c.triangles.length;t+=3)for(let k=0;k<3;k++){const a=c.triangles[t+k],b=c.triangles[t+(k+1)%3],key=a<b?a+':'+b:b+':'+a;counts.set(key,(counts.get(key)||0)+1);}
    const cuffIds=new Set(c.openings.cuff),boundary=[...counts].filter(([key,count])=>count===1&&key.split(':').every(id=>cuffIds.has(+id))).map(([key])=>key.split(':').map(Number));
    const boundaryDistance=point=>{let best=Infinity;for(let t=0;t<m.idx.length;t+=3)for(let k=0;k<3;k++){const a=m.idx[t+k],b=m.idx[t+(k+1)%3];if(m.hem[a*2]>1e-7||m.hem[b*2]>1e-7)continue;const x=m.uv[a*2],y=m.uv[a*2+1],dx=m.uv[b*2]-x,dy=m.uv[b*2+1]-y,f=Math.max(0,Math.min(1,((point[0]-x)*dx+(point[1]-y)*dy)/(dx*dx+dy*dy||1)));best=Math.min(best,Math.hypot(point[0]-x-f*dx,point[1]-y-f*dy));}return best;};
    const centered=c.openingAnchors.cuffs.every((anchor,index)=>{const side=index===0?1:-1,segments=boundary.filter(([a,b])=>side*(c.material[a][1]+c.material[b][1])>0),graph=new Map();for(const [a,b]of segments){const length=Math.hypot(c.material[a][0]-c.material[b][0],c.material[a][1]-c.material[b][1]);for(const [i,j]of [[a,b],[b,a]]){if(!graph.has(i))graph.set(i,[]);graph.get(i).push([j,length]);}}
      const ends=[...graph].filter(([,neighbours])=>neighbours.length===1).map(([id])=>id),distance=(from,to)=>{const pending=[[0,from]],best=new Map();while(pending.length){pending.sort((a,b)=>b[0]-a[0]);const [length,id]=pending.pop();if(best.has(id))continue;best.set(id,length);if(id===to)return length;for(const [next,step]of graph.get(id)||[])pending.push([length+step,next]);}return Infinity;},[a,b]=anchor.ids,span=distance(a,b),halves=ends.map(end=>Math.min(distance(end,a)+anchor.w[1]*span,distance(end,b)+anchor.w[0]*span));
      return ends.length===2&&counts.get(a<b?a+':'+b:b+':'+a)===1&&Math.abs(halves[0]-halves[1])<1e-12&&Math.abs(halves[0]+halves[1]-anchor.length)<1e-12&&close(anchor.materialPoint,anchor.ids.reduce((p,id,k)=>C.add(p,c.material[id].map(v=>v*anchor.w[k])),[0,0,0]),1e-12)&&boundaryDistance(anchor.materialPoint)<c.halfThickness;
    });
    check(centered&&c.landmarks.cuffs.every(Number.isInteger),`cuff markers at resolution ${resolution}: material anchors bisect the actual open boundary without replacing objective vertices`);
    let minimumArea=Infinity;
    for(let t=0;t<c.triangles.length*16*2;t+=6){const [a,b,d]=[m.idx[t],m.idx[t+1],m.idx[t+2]].map(i=>[m.uv[i*2],m.uv[i*2+1]]);minimumArea=Math.min(minimumArea,((b[0]-a[0])*(d[1]-a[1])-(b[1]-a[1])*(d[0]-a[0]))*(t<c.triangles.length*16?1:-1));}
    check(Math.max(...error)<(resolution===17?.001:.006)&&minimumArea>0,`shirt display at resolution ${resolution}: boundary fairing keeps grab landmarks aligned and cannot invert the rest-pattern faces`);
    check(m.hem.some((v,i)=>i%2&&v<0),'the attached collar has a neck-specific material seam coordinate at resolution '+resolution);
    const positions=m.pos,normals=m.nrm,uv=m.uv,hem=m.hem,indices=m.idx;
    check(Render.mesh(c)===m&&m.pos===positions&&m.nrm===normals&&m.uv===uv&&m.hem===hem&&m.idx===indices,`shirt display at resolution ${resolution}: cached topology and buffers are reused`);
  }
  const c=create(17),initial=Render.mesh(c),positions=[...initial.pos],normals=[...initial.nrm],uv=[...initial.uv],hem=[...initial.hem],cuff=Cloth.cuffCenter(c,0),R=C.rodrigues([.35,-.2,.5]),T=[.2,-.4,.7];
  // A rigidly placed static specimen exercises coordinate attachment without simulating a fold.
  c.nodes.forEach(n=>{n.p=C.add(C.mulv(R,n.p),T);});c.table={...c.table,R,t:T};
  const moved=Render.mesh(c),expectedPositions=[],expectedNormals=[];
  for(let i=0;i<positions.length;i+=3){expectedPositions.push(...C.add(C.mulv(R,positions.slice(i,i+3)),T));expectedNormals.push(...C.mulv(R,normals.slice(i,i+3)));}
  check(close([...moved.pos],expectedPositions)&&close([...moved.nrm],expectedNormals)&&close([...moved.uv],uv,1e-12)&&close([...moved.hem],hem,1e-12),'a moved static shirt carries its refined surface, cotton weave and sewn edge with its physical nodes');
  check(close(Cloth.cuffCenter(c,0),C.add(C.mulv(R,cuff),T),1e-12),'the material cuff center follows a rigidly moved garment in the same world frame');
  const anchor=c.openingAnchors.cuffs[0],center=Cloth.cuffCenter(c,0),offset=[.001,-.002,.003],rest=JSON.stringify({material:c.material,weights:c.weights,anchor});c.nodes[anchor.ids[0]].p=C.add(c.nodes[anchor.ids[0]].p,offset);const expected=center.map((v,k)=>v+offset[k]*anchor.w[0]),point=Cloth.cuffCenter(c,0);point[0]+=1;
  check(close(Cloth.cuffCenter(c,0),expected,1e-12)&&JSON.stringify({material:c.material,weights:c.weights,anchor})===rest,'a cuff marker interpolates local deformation without moving fabric, changing its material anchor or exposing a node alias');
  const saved=moved.pos.slice();c.nodes[c.landmarks.cuffs[0]].p[2]+=.001;
  const adjusted=Render.mesh(c);
  check(adjusted.pos.some((v,i)=>Math.abs(v-saved[i])>1e-6)&&[...adjusted.pos,...adjusted.nrm].every(Number.isFinite),'a small static cuff adjustment propagates through the render stencils without changing topology');
  check(Render.mesh({kind:'towel'})===null,'the garment renderer leaves the existing towel renderer available');
};
if(require.main===module){const assert=require('node:assert/strict');module.exports({check:(ok,msg)=>{assert.ok(ok,msg);process.stdout.write('ok '+msg+'\n');}});}
