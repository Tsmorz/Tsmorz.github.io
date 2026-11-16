// Reachable-pose contact discovery only; no forces or garment trajectory.
module.exports=function({check}){
  const Q=require('../../tag-tracker/cloth-contact-core'),R=require('../../tag-tracker/robot-core'),C=require('../../tag-tracker/tracker-core'),I=[1,0,0,0,1,0,0,0,1],G=R.gripper(),radius=.0003,epsilon=.000001,carrier=.020,ids=[3,5,8],near=(a,b,t=1e-10)=>Math.abs(a-b)<t,box=s=>({R:I,t:s.c,h:s.h});
  const valid=(rows,triangle)=>rows.every(c=>c.w.every(v=>v>=-1e-10&&v<=1+1e-10)&&near(c.w.reduce((s,w)=>s+w,0),1)&&C.norm(C.sub(c.point,[0,1,2].map(k=>c.w.reduce((s,w,i)=>s+w*triangle[i][k],0))))<1e-10&&near(C.norm(c.normal),1)&&Number.isFinite(c.depth)&&near(c.gap,-c.depth));
  let inner;
  for(const [name,compression,axis]of [['inner face',[0,-.001,0],1],['toe',[0,0,-.001],2]]){
    const current=G.padShape(1,carrier,compression),free=G.padShape(1,carrier,[0,0,0]),other=[0,1,2].filter(k=>k!==axis),plane=current.c[axis]-current.h[axis]-radius-epsilon,triangle=[[-.003,-.004],[.003,-.004],[0,.004]].map(uv=>{const p=current.c.slice();p[axis]=plane;p[other[0]]+=uv[0];p[other[1]]+=uv[1];return p;}),rows=Q.triangleBoxCandidates(triangle,box(current),[box(free)],radius,{ids});
    check(Q.triangleBox(triangle,box(current),radius).length===0&&Q.triangleBox(triangle,box(free),radius).some(c=>near(c.depth,.000999))&&rows.length>0&&valid(rows,triangle)&&rows.every(c=>near(c.gap,epsilon)&&c.depth<0&&near(c.normal[axis],-1)),name+':1µm separation remains a positive current gap while1mm unloading discovers the actual reachable material');
    if(name==='inner face')inner={current:box(current),free:box(free),triangle,rows};
  }
  const drive=box(G.padShape(1,carrier-.001,[0,0,0])),current=box(G.padShape(1,carrier,[0,0,0])),plane=current.t[1]-current.h[1]-radius-epsilon,triangle=[[-.003,-.004],[.003,-.004],[0,.004]].map(([x,z])=>[x,plane,current.t[2]+z]),driveRows=Q.triangleBoxCandidates(triangle,current,[drive],radius,{ids});
  check(driveRows.length>0&&driveRows.every(c=>near(c.gap,epsilon)&&c.depth<0)&&Q.triangleBoxCandidates(triangle,current,[],radius,{ids}).length===0,'real free-drive carrier motion discovers separated rows without inventing contact when no reachable pose is supplied');
  const cube={R:I,t:[0,0,0],h:[.01,.01,.01]},far=[[.01025,.01025,.01025],[.01026,.01025,.01025],[.01025,.01026,.01025]],larger={...cube,h:[.0102,.0102,.0102]},corners=Q.triangleBoxCandidates(far,cube,[larger],radius,{ids});
  check(corners.length>0&&corners.every(c=>{const d=c.point.map(v=>v-.01),distance=C.norm(d);return c.depth<0&&near(c.gap,distance-radius)&&C.norm(C.sub(c.normal,d.map(x=>x/distance)))<1e-9;}),'a reachable corner uses the current Euclidean corner gap and radial normal rather than an inflated-box face penetration');
  const away={...cube,t:[-.001,0,0]};
  check(Q.triangleBoxCandidates(far,cube,[away],radius,{ids}).length===0,'a coarse union or expanded AABB cannot create a candidate when neither actual box reaches the rounded cloth corner');
  const before=JSON.stringify(inner),seen=new Set(),dedup=Q.triangleBoxCandidates(inner.triangle,inner.current,[inner.free,inner.free,inner.current],radius,{ids,seen}),again=Q.triangleBoxCandidates(inner.triangle,inner.current,[inner.free],radius,{ids,seen}),layer=Q.triangleBoxCandidates(inner.triangle,inner.current,[inner.free],radius,{ids:ids.map(i=>i+100),seen});
  check(dedup.length===inner.rows.length&&new Set(dedup.map(c=>c.key)).size===dedup.length&&again.length===0&&layer.length===dedup.length&&JSON.stringify(inner)===before,'identical poses/material features deduplicate exactly while separate material layers survive and input geometry stays unchanged');
  const rotation=C.rodrigues([.4,-.7,.6]),origin=[1.2,-.8,2.3],world=p=>C.add(origin,C.mulv(rotation,p)),transform=b=>({R:C.mul3(rotation,b.R),t:world(b.t),h:b.h.slice()}),turned=Q.triangleBoxCandidates(inner.triangle.map(world),transform(inner.current),[transform(inner.free)],radius,{ids});
  check(turned.length===inner.rows.length&&turned.every(c=>{const q=inner.rows.find(v=>v.key===c.key);return q&&C.norm(C.sub(c.point,world(q.point)))<1e-9&&C.norm(C.sub(c.normal,C.mulv(rotation,q.normal)))<1e-9&&near(c.gap,q.gap,1e-9)&&near(c.depth,q.depth,1e-9);}), 'reachable candidates preserve their material keys, current gaps and normals under rigid world transforms');
  const actual=[[-.0115,-.0115,.0001],[.0115,-.0115,.0001],[0,.0115,.0001]],pad={R:I,t:[0,0,.019],h:[.011,.0039,.019]},old=Q.triangleBox(actual,pad,radius,{ids}),same=Q.triangleBoxCandidates(actual,pad,[],radius,{ids});
  check(same.length===old.length&&same.every(c=>old.some(q=>q.key===c.key&&C.norm(C.sub(c.normal,q.normal))<1e-12&&near(c.depth,q.depth)&&C.norm(C.sub(c.w,q.w))<1e-12)),'existing current solid manifolds keep their exact normals, finite barycentric samples and penetration');
  const many=Q.triangleBoxCandidates(inner.triangle,inner.current,[inner.free,drive,current,inner.free],radius,{ids,maxContacts:2});
  check(many.length<=2*3&&valid(many,inner.triangle),'candidate work and output stay bounded by the requested manifold size per unique physical pose');
  let faces=true;
  for(let axis=0;axis<3;axis++)for(const sign of [-1,1]){
    const compression=[0,0,0];compression[axis]=sign*.001;const s=G.padShape(1,carrier,compression),other=[0,1,2].filter(k=>k!==axis),p=[[-.003,-.002],[.003,-.002],[0,.002]].map(uv=>{const q=s.c.slice();q[axis]+=sign*(s.h[axis]+radius+epsilon);q[other[0]]+=uv[0];q[other[1]]+=uv[1];return q;}),unloaded=box(G.padShape(1,carrier,[0,0,0])),rows=Q.triangleBoxCandidates(p.map(world),transform(box(s)),[transform(unloaded)],radius,{ids});
    const expected=C.mulv(rotation,[0,1,2].map(k=>k===axis?sign:0));faces&&=rows.length>0&&valid(rows,p.map(world))&&rows.every(c=>near(c.gap,epsilon,1e-9)&&C.norm(C.sub(c.normal,expected))<1e-9);
  }
  check(faces,'all six pressed pad faces retain positive current gaps and correct normals during reachable decompression in a tilted world frame');
};
if(require.main===module){const assert=require('node:assert/strict');module.exports({check:(ok,msg)=>{assert.ok(ok,msg);process.stdout.write('ok '+msg+'\n');}});}
