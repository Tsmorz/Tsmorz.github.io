// Render-only beer surfaces, streams and droplets. All dimensions are metres; no liquid accounting lives here.
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();else root.LiquidRenderCore=factory();
})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  const TAU=2*Math.PI,add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]),mul=(a,k)=>a.map(v=>v*k);
  const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),norm=a=>Math.hypot(...a),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const unit=(a,fallback=[0,0,1])=>norm(a)>1e-10?mul(a,1/norm(a)):fallback.slice(),clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const empty=()=>({pos:new Float32Array(),nrm:new Float32Array(),idx:new Uint16Array(),uv:new Float32Array()});
  const frame=n=>{const u=unit(cross(Math.abs(n[2])<.9?[0,0,1]:[0,1,0],n));return [u,cross(n,u)];};
  function builder(){
    const pos=[],uv=[],idx=[];
    const vertex=(p,t=[0,0])=>{const i=pos.length/3;pos.push(...p);uv.push(...t);return i;};
    const triangle=(a,b,c)=>idx.push(a,b,c);
    return {vertex,triangle,finish(){
      const nrm=new Float32Array(pos.length);
      for(let k=0;k<idx.length;k+=3){const [a,b,c]=idx.slice(k,k+3),n=cross(sub(pos.slice(b*3,b*3+3),pos.slice(a*3,a*3+3)),sub(pos.slice(c*3,c*3+3),pos.slice(a*3,a*3+3)));for(const i of [a,b,c])for(let j=0;j<3;j++)nrm[i*3+j]+=n[j];}
      for(let i=0;i<nrm.length;i+=3)nrm.set(unit([...nrm.slice(i,i+3)]),i);
      return {pos:new Float32Array(pos),nrm,idx:new Uint16Array(idx),uv:new Float32Array(uv)};
    }};
  }
  // A dome is a few millimetres across, unlike a separate cloud of foam particles.
  function dome(b,c,u,v,n,r,height,seed){
    const K=8,J=3,rows=[];
    for(let j=0;j<=J;j++){
      const ph=j/J*Math.PI/2,row=[];
      for(let i=0;i<=K;i++){
        const a=i/K*TAU,rr=r*Math.cos(ph),p=add(c,add(mul(u,rr*Math.cos(a)),add(mul(v,rr*Math.sin(a)),mul(n,height*Math.sin(ph)))));
        row.push(b.vertex(p,[seed+rr*Math.cos(a),rr*Math.sin(a)]));
      }
      rows.push(row);
    }
    for(let j=0;j<J;j++)for(let i=0;i<K;i++){const a=rows[j][i],c=rows[j+1][i],d=rows[j+1][i+1],e=rows[j][i+1];b.triangle(a,e,d);b.triangle(a,d,c);}
  }
  function surfaceMesh(l){
    const pts=l.points||[];if(pts.length<3)return empty();
    const n=unit(l.up||[0,0,1]),[u,v]=frame(n),centre=mul(pts.reduce(add,[0,0,0]),1/pts.length),b=builder();
    const foam=l.layer==='foam',phase=l.phase||0,strength=clamp(l.agitation||0,0,1),amount=clamp(l.foam||0,0,1);
    const headroom=Math.max(0,l.headroom??.04),equivalent=clamp(l.foamHeight??(.0015+.003*amount),0,headroom);
    if(foam&&(equivalent<1e-7||amount===0))return empty();
    // Initial foam spreads from the actual impact; its covered area and height
    // retain the gas-volume/area relationship before it covers the whole surface.
    const coverage=foam?Math.sqrt(clamp(equivalent/.002,.0064,1)):1,impact=l.impact?.point||centre;
    const patch=foam?add(centre,mul(sub(impact,centre),(1-coverage)*.6)):centre;
    const impactStrength=clamp(l.impact?.strength??strength,0,1),base=foam?Math.min(headroom,equivalent/(coverage*coverage)):0;
    const wave=Math.min(.00085,Math.max(.00002,(l.depth??.08)*.2));
    const height=(p,r)=>{
      const d=norm(sub(p,impact)),ripple=impactStrength*wave*Math.sin(d*420-phase*19)*Math.exp(-d*22)*(1-r*r);
      const meniscus=foam?Math.min(.0003,base*.12)*r**8:0;
      return foam?clamp(base+ripple*.35+meniscus,0,headroom):ripple;
    };
    const c=b.vertex(add(patch,mul(n,height(patch,0))),[0,0]),rings=9,rows=[],locations=[];
    for(let j=1;j<=rings;j++){
      const r=j/rings,row=[],points=[];
      for(let i=0;i<pts.length;i++){
        const delta=mul(sub(pts[i],centre),r*coverage),p=add(patch,delta);points.push(p);
        row.push(b.vertex(add(p,mul(n,height(p,r))),[dot(delta,u),dot(delta,v)]));
      }
      rows.push(row);locations.push(points);
      for(let i=0;i<pts.length;i++){
        const next=(i+1)%pts.length,a=row[i],d=row[next];
        if(j===1)b.triangle(c,a,d);else{const p=rows[j-2][i],q=rows[j-2][next];b.triangle(p,a,d);b.triangle(p,d,q);}
      }
    }
    const winding=dot(cross(sub(pts[0],centre),sub(pts[1],centre)),n),surfaceIndices=pts.length*3+(rings-1)*pts.length*6;
    if(foam){
      // The head has visible thickness down to the beer; no floating opaque lid.
      const top=rows.at(-1),bottom=locations.at(-1).map(p=>b.vertex(p,[dot(sub(p,centre),u),dot(sub(p,centre),v)]));
      for(let i=0;i<pts.length;i++){const j=(i+1)%pts.length;b.triangle(top[i],bottom[i],bottom[j]);b.triangle(top[i],bottom[j],top[j]);}
      const count=Math.ceil(36*clamp(amount,.15,1));
      for(let k=0;k<count;k++){
        const angle=k*2.399963229728653,r=Math.sqrt((k+.5)/count)*.88,index=angle/TAU*pts.length,wrapped=((index%pts.length)+pts.length)%pts.length,i=Math.floor(wrapped),f=wrapped-i;
        const edge=add(mul(pts[i],1-f),mul(pts[(i+1)%pts.length],f)),p=add(patch,mul(sub(edge,centre),r*coverage));
        const radius=(.00065+.0008*(.5+.5*Math.sin(k*13.7)))*Math.min(1,coverage*2),at=add(p,mul(n,height(p,r)));
        const bubbleHeight=Math.min(radius*(.28+.18*Math.sin(k*3.1)**2),Math.max(0,headroom-height(p,r)));
        if(bubbleHeight>1e-6)dome(b,at,u,v,n,radius,bubbleHeight,k*.013);
      }
    }
    const mesh=b.finish();
    if(winding<0){
      // Flip the surface and skirt, never the already outward-facing bubble domes.
      const count=surfaceIndices+(foam?pts.length*6:0);
      for(let k=0;k<count;k+=3){const tmp=mesh.idx[k+1];mesh.idx[k+1]=mesh.idx[k+2];mesh.idx[k+2]=tmp;}
      for(let k=0;k<(1+rings*pts.length+(foam?pts.length:0))*3;k++)mesh.nrm[k]*=-1;
    }
    return mesh;
  }
  const spline=(a,b,c,d,t)=>[0,1,2].map(j=>.5*(2*b[j]+(-a[j]+c[j])*t+(2*a[j]-5*b[j]+4*c[j]-d[j])*t*t+(-a[j]+3*b[j]-3*c[j]+d[j])*t*t*t));
  function streamMesh(s){
    const nodes=[],nodeRadii=[];
    (s.points||[]).forEach((p,i)=>{if(!nodes.length||norm(sub(p,nodes.at(-1)))>1e-7){nodes.push(p);nodeRadii.push(s.radii?.[i]||.0026);}});
    if(nodes.length<2)return empty();
    const b=builder(),points=[],radii=[],phase=s.phase||0,K=10,steps=3;
    for(let i=0;i<nodes.length-1;i++)for(let j=0;j<steps;j++){
      const t=j/steps;points.push(spline(nodes[Math.max(0,i-1)],nodes[i],nodes[i+1],nodes[Math.min(nodes.length-1,i+2)],t));
      radii.push(nodeRadii[i]*(1-t)+nodeRadii[i+1]*t);
    }
    points.push(nodes.at(-1));radii.push(nodeRadii.at(-1));
    const rows=[];let previous=null,u=null,distance=0;
    for(let i=0;i<points.length;i++){
      const p=points[i],t=unit(sub(points[Math.min(i+1,points.length-1)],points[Math.max(0,i-1)]),previous||[0,0,-1]);
      if(i)distance+=norm(sub(p,points[i-1]));
      if(!u)u=frame(t)[0];else u=unit(sub(u,mul(t,dot(u,t))),frame(t)[0]);
      const v=cross(t,u),row=[],r=clamp(radii[i],.0005,.008),travel=distance-phase*.12;
      const sway=.00008*Math.sin(Math.PI*i/(points.length-1));
      const centre=add(p,add(mul(u,sway*Math.sin(distance*190-phase*18)),mul(v,sway*Math.cos(distance*170-phase*15))));
      for(let j=0;j<=K;j++){
        const a=j/K*TAU,rough=1+.018*Math.sin(distance*360-phase*26+a*3)+.009*Math.sin(distance*590-phase*38-a*2),n=add(mul(u,Math.cos(a)),mul(v,Math.sin(a)));
        row.push(b.vertex(add(centre,mul(n,r*rough)),[j/K*TAU*r,travel]));
      }
      rows.push(row);previous=t;
      if(i)for(let j=0;j<K;j++){const a=rows[i-1][j],c=row[j],d=row[j+1],e=rows[i-1][j+1];b.triangle(a,e,d);b.triangle(a,d,c);}
    }
    const mesh=b.finish();
    // Keep the wrapped UV seam while sharing its lighting normal around the tube.
    for(const row of rows){
      const a=row[0]*3,z=row[K]*3,n=unit(add([...mesh.nrm.slice(a,a+3)],[...mesh.nrm.slice(z,z+3)]));
      mesh.nrm.set(n,a);mesh.nrm.set(n,z);
    }
    return mesh;
  }
  function particleMesh(particles){
    const b=builder();
    for(const d of (particles||[]).slice(0,64)){
      const n=unit(d.axis||d.velocity||[0,0,1]),[u,v]=frame(n),r=clamp(d.r||.001,.0003,.003),stretch=clamp(d.stretch||1,1,2.5),K=8,J=5,rows=[];
      for(let j=0;j<=J;j++){
        const ph=j/J*Math.PI,row=[];
        for(let i=0;i<=K;i++){
          const a=i/K*TAU,p=add(d.p,add(mul(n,Math.cos(ph)*r*stretch),add(mul(u,Math.sin(ph)*Math.cos(a)*r),mul(v,Math.sin(ph)*Math.sin(a)*r))));
          row.push(b.vertex(p,[a*r,ph*r]));
        }rows.push(row);
      }
      for(let j=0;j<J;j++)for(let i=0;i<K;i++){const a=rows[j][i],c=rows[j+1][i],d=rows[j+1][i+1],e=rows[j][i+1];b.triangle(a,c,d);b.triangle(a,d,e);}
    }
    return b.finish();
  }
  return {surfaceMesh,streamMesh,particleMesh};
});
