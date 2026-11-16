// A thin cut-pattern garment, refined for display only. Every rendered point follows a cached
// affine stencil of the physical nodes; refinement never changes contacts, mass or fold checks.
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();else root.ClothRenderCore=factory();
})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  const caches=new WeakMap();
  const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
  const edgeKey=(a,b)=>a<b?a+':'+b:b+':'+a;
  function edgesOf(count,triangles){
    const edges=new Map(),neighbours=Array.from({length:count},()=>new Set());
    for(let t=0;t<triangles.length;t+=3){
      const ids=triangles.slice(t,t+3);
      for(let i=0;i<3;i++){
        const a=ids[i],b=ids[(i+1)%3],opposite=ids[(i+2)%3],key=edgeKey(a,b);
        let edge=edges.get(key);if(!edge)edges.set(key,(edge={a,b,opposite:[]}));
        edge.opposite.push(opposite);neighbours[a].add(b);neighbours[b].add(a);
      }
    }
    return {edges,neighbours};
  }
  function refine(count,triangles,anchors){
    const {edges,neighbours}=edgesOf(count,triangles),boundary=Array.from({length:count},()=>[]),stencils=[],next=[];
    for(const e of edges.values())if(e.opposite.length===1){boundary[e.a].push(e.b);boundary[e.b].push(e.a);}
    for(let i=0;i<count;i++){
      if(anchors.has(i))stencils.push({ids:[i],weights:[1]});
      else if(boundary[i].length===2)stencils.push({ids:[i,...boundary[i]],weights:[.75,.125,.125]});
      else{
        const ids=[...neighbours[i]],n=ids.length,beta=n===3?3/16:n?3/(8*n):0;
        stencils.push({ids:[i,...ids],weights:[1-n*beta,...ids.map(()=>beta)]});
      }
    }
    for(const e of edges.values()){
      e.index=stencils.length;
      stencils.push(e.opposite.length===2?{ids:[e.a,e.b,...e.opposite],weights:[.375,.375,.125,.125]}:{ids:[e.a,e.b],weights:[.5,.5]});
    }
    for(let t=0;t<triangles.length;t+=3){
      const [a,b,c]=triangles.slice(t,t+3),ab=edges.get(edgeKey(a,b)).index,bc=edges.get(edgeKey(b,c)).index,ca=edges.get(edgeKey(c,a)).index;
      next.push(a,ab,ca,ab,b,bc,ca,bc,c,ab,bc,ca);
    }
    return {stencils,triangles:next,points:new Float64Array(stencils.length*3)};
  }
  function evaluate(source,stride,stencils,out){
    for(let i=0;i<stencils.length;i++){
      const s=stencils[i];
      for(let k=0;k<stride;k++){let v=0;for(let j=0;j<s.ids.length;j++)v+=source[s.ids[j]*stride+k]*s.weights[j];out[i*stride+k]=v;}
    }
    return out;
  }
  function fairBoundary(c){
    const count=c.nodes.length,{edges}=edgesOf(count,c.triangles),neighbours=Array.from({length:count},()=>[]),anchors=new Set(Object.values(c.landmarks||{}).flat().filter(Number.isInteger));
    for(const e of edges.values())if(e.opposite.length===1){neighbours[e.a].push(e.b);neighbours[e.b].push(e.a);}
    let stencils=Array.from({length:count},(_,i)=>({ids:[i],weights:[1]}));
    if(c.patternSmooth)return {stencils,points:new Float64Array(count*3)};
    // Fair the little grid zigzags before refinement, without changing the physical cut pattern.
    // Convex stencils keep the visible edge attached to the original sheet under deformation.
    for(let pass=0;pass<4;pass++)stencils=stencils.map((s,i)=>{
      if(neighbours[i].length!==2||anchors.has(i))return s;
      const sum=new Map();
      for(const [index,w]of [[i,.5],[neighbours[i][0],.25],[neighbours[i][1],.25]]){
        const source=stencils[index];source.ids.forEach((id,k)=>sum.set(id,(sum.get(id)||0)+source.weights[k]*w));
      }
      const entries=[...sum],p=[0,0];
      for(const [id,w]of entries){p[0]+=c.material[id][0]*w;p[1]+=c.material[id][1]*w;}
      const distance=Math.hypot(p[0]-c.material[i][0],p[1]-c.material[i][1]),blend=distance>.006?.006/distance:1;
      for(const [id,w]of sum)sum.set(id,w*blend);sum.set(i,(sum.get(i)||0)+1-blend);
      return {ids:[...sum.keys()],weights:[...sum.values()]};
    });
    return {stencils,points:new Float64Array(count*3)};
  }
  function topology(c){
    let cache=caches.get(c);
    if(cache&&cache.material===c.material&&cache.inputTriangles===c.triangles&&cache.inputCount===c.nodes.length)return cache;
    const inputCount=c.nodes.length,levels=[fairBoundary(c)],anchors=new Set(Object.values(c.landmarks||{}).flat().filter(Number.isInteger));
    if(c.panels===2)for(const i of [...anchors])anchors.add(i<c.panelSize?i+c.panelSize:i-c.panelSize);
    let count=inputCount,triangles=c.triangles.slice(),uv=new Float64Array(c.material.flatMap(p=>p.slice(0,2)));
    uv=evaluate(uv,2,levels[0].stencils,new Float64Array(count*2));
    for(let i=0;i<2;i++){
      const level=refine(count,triangles,anchors);levels.push(level);count=level.stencils.length;triangles=level.triangles;
      uv=evaluate(uv,2,level.stencils,new Float64Array(count*2));
    }
    const boundary=[...edgesOf(count,triangles).edges.values()].filter(e=>e.opposite.length===1),outgoing=new Map(boundary.map(e=>[e.a,e])),ordered=[],seen=new Set();
    // Each closed boundary has its own seam coordinate, including a separate neck hole if a pattern gains one.
    for(const first of boundary)if(!seen.has(first)){
      let e=first,travel=0;
      while(e&&!seen.has(e)){
        seen.add(e);const dx=uv[e.b*2]-uv[e.a*2],dy=uv[e.b*2+1]-uv[e.a*2+1],length=Math.hypot(dx,dy);
        const mx=(uv[e.a*2]+uv[e.b*2])/2,my=(uv[e.a*2+1]+uv[e.b*2+1])/2,neck=Math.abs(my)<(c.neckRadius||.034)+.001&&mx>c.width/2-(c.neckRadius||.034)-.002;
        ordered.push({...e,travel,length,neck});travel+=length;e=outgoing.get(e.b);
      }
    }
    const distances=new Float32Array(count*2);
    for(let i=0;i<count;i++){
      const x=uv[i*2],y=uv[i*2+1];let nearest=Infinity,travel=0,neck=false;
      for(const e of ordered){
        const ax=uv[e.a*2],ay=uv[e.a*2+1],dx=uv[e.b*2]-ax,dy=uv[e.b*2+1]-ay,L=dx*dx+dy*dy;
        const t=L?clamp(((x-ax)*dx+(y-ay)*dy)/L,0,1):0,d=Math.hypot(x-ax-t*dx,y-ay-t*dy);
        if(d<nearest){nearest=d;travel=e.travel+t*e.length;neck=e.neck;}
      }
      // Signed seam travel marks the neck binding without another GPU attribute.
      distances[i*2]=nearest;distances[i*2+1]=neck?-(travel+.001):travel;
    }
    const vertices=count*2+ordered.length*4,idx=[];
    if(vertices>65535)throw new Error('Garment render mesh exceeds 16-bit indices');
    for(let t=0;t<triangles.length;t+=3){const [a,b,d]=triangles.slice(t,t+3);idx.push(a,b,d,d+count,b+count,a+count);}
    for(let i=0;i<ordered.length;i++){const at=count*2+i*4;idx.push(at,at+2,at+1,at,at+3,at+2);}
    const mesh={pos:new Float32Array(vertices*3),nrm:new Float32Array(vertices*3),idx:new Uint16Array(idx),uv:new Float32Array(vertices*2),hem:new Float32Array(vertices*2)};
    for(let side=0;side<2;side++){mesh.uv.set(uv,side*count*2);mesh.hem.set(distances,side*count*2);}
    ordered.forEach((e,i)=>{[e.a,e.b,e.b,e.a].forEach((id,j)=>{const at=count*2+i*4+j;mesh.uv.set(uv.subarray(id*2,id*2+2),at*2);mesh.hem.set(distances.subarray(id*2,id*2+2),at*2);});});
    cache={inputCount,material:c.material,inputTriangles:c.triangles,source:new Float64Array(inputCount*3),levels,count,triangles,boundary:ordered,distances,normals:new Float64Array(count*3),mesh};
    caches.set(c,cache);return cache;
  }
  function mesh(c){
    if(c.kind!=='shirt')return null;
    const cache=topology(c),{count,triangles,boundary,normals}=cache,out=cache.mesh;
    for(let i=0;i<c.nodes.length;i++)cache.source.set(c.nodes[i].p,i*3);
    let points=cache.source;
    for(const level of cache.levels)points=evaluate(points,3,level.stencils,level.points);
    normals.fill(0);
    for(let t=0;t<triangles.length;t+=3){
      const a=triangles[t]*3,b=triangles[t+1]*3,d=triangles[t+2]*3,ux=points[b]-points[a],uy=points[b+1]-points[a+1],uz=points[b+2]-points[a+2],vx=points[d]-points[a],vy=points[d+1]-points[a+1],vz=points[d+2]-points[a+2];
      const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
      for(const i of [a,b,d]){normals[i]+=nx;normals[i+1]+=ny;normals[i+2]+=nz;}
    }
    const R=c.table.R,T=c.table.t,half=c.halfThickness||.001;
    for(let i=0;i<count;i++){
      const at=i*3,L=Math.hypot(normals[at],normals[at+1],normals[at+2]);
      const nx=L>1e-12?normals[at]/L:R[2],ny=L>1e-12?normals[at+1]/L:R[5],nz=L>1e-12?normals[at+2]/L:R[8];
      normals.set([nx,ny,nz],at);
      // A turned-under hem is fractions of a millimetre proud of the thin cotton, not plush pile.
      const distance=cache.distances[i*2],hem=.00035*Math.exp(-distance*distance/(.0022*.0022))+(cache.distances[i*2+1]<0?.00015*Math.exp(-(((distance-.0025)/.0025)**2)):0);
      for(const side of [1,-1]){
        const index=(side===1?i:i+count)*3,offset=side*(half+hem);
        let x=points[at]+nx*offset,y=points[at+1]+ny*offset,z=points[at+2]+nz*offset;
        const dx=x-T[0],dy=y-T[1],dz=z-T[2],lx=R[0]*dx+R[3]*dy+R[6]*dz,ly=R[1]*dx+R[4]*dy+R[7]*dz,lz=R[2]*dx+R[5]*dy+R[8]*dz;
        if(Math.abs(lx)<c.table.size[0]/2&&Math.abs(ly)<c.table.size[1]/2&&lz<.00015){const lift=.00015-lz;x+=R[2]*lift;y+=R[5]*lift;z+=R[8]*lift;}
        out.pos.set([x,y,z],index);out.nrm.set([nx*side,ny*side,nz*side],index);
      }
    }
    boundary.forEach((e,i)=>{
      const at=count*2+i*4,ids=[e.a,e.b,e.b+count,e.a+count];
      for(let j=0;j<4;j++)out.pos.set(out.pos.subarray(ids[j]*3,ids[j]*3+3),(at+j)*3);
      const a=e.a*3,b=e.b*3,ex=points[b]-points[a],ey=points[b+1]-points[a+1],ez=points[b+2]-points[a+2],nx=normals[a]+normals[b],ny=normals[a+1]+normals[b+1],nz=normals[a+2]+normals[b+2];
      let sx=ey*nz-ez*ny,sy=ez*nx-ex*nz,sz=ex*ny-ey*nx,L=Math.hypot(sx,sy,sz);
      if(L<1e-12){sx=R[0];sy=R[3];sz=R[6];L=1;}
      for(let j=0;j<4;j++)out.nrm.set([sx/L,sy/L,sz/L],(at+j)*3);
    });
    return out;
  }
  return {mesh};
});
