// Static rendering and conserved pour data. No browser, audio device or capture board.
module.exports=function({check}){
  const root=require('path').resolve(__dirname,'../..'),L=require(root+'/tag-tracker/liquid-render-core'),P=require(root+'/tag-tracker/pour-core');
  const I=[1,0,0,0,1,0,0,0,1],valid=m=>m.pos.length%3===0&&m.uv.length===m.pos.length/3*2&&[...m.pos,...m.nrm,...m.uv].every(Number.isFinite)&&m.idx.every(i=>i<m.pos.length/3);
  const points=Array.from({length:40},(_,i)=>[.043*Math.cos(i/40*2*Math.PI),.043*Math.sin(i/40*2*Math.PI),.08]);
  const liquid={points,up:[0,0,1],phase:.17,agitation:.8,foam:.9,impact:{point:[.008,0,.08],strength:.8}},snapshot=JSON.stringify(liquid);
  const beer=L.surfaceMesh(liquid),foam=L.surfaceMesh({...liquid,layer:'foam'});
  check(valid(beer)&&valid(foam)&&foam.pos.length>beer.pos.length*2&&Math.max(...foam.pos.filter((_,i)=>i%3===2))<.09,'beer has finite localized ripples and a thin head with individual bubble domes');
  check(JSON.stringify(liquid)===snapshot,'surface rendering never changes physical outline, impact or liquid state');
  const edgeStart=1+8*40;
  check(Array.from({length:40},(_,i)=>Math.abs(beer.pos[(edgeStart+i)*3+2]-.08)<1e-7).every(Boolean),'ripples die at the actual vessel boundary instead of lifting through its wall');
  const thick=L.surfaceMesh({...liquid,layer:'foam',foamHeight:.018,headroom:.022,depth:.08}),shallow=L.surfaceMesh({...liquid,layer:'foam',foamHeight:.001,headroom:.022,depth:.08});
  check(valid(thick)&&valid(shallow)&&Math.max(...thick.pos.filter((_,i)=>i%3===2))>.097&&Math.max(...shallow.pos.filter((_,i)=>i%3===2))<.084&&Math.min(...thick.pos.filter((_,i)=>i%3===2))<=.080001,'foam geometry uses physical head height with a skirt down to the beer instead of a fixed floating lid');
  const capped=L.surfaceMesh({...liquid,layer:'foam',foamHeight:.04,headroom:.004}),none=L.surfaceMesh({...liquid,layer:'foam',foamHeight:0});
  check(Math.max(...capped.pos.filter((_,i)=>i%3===2))<=.084001&&none.pos.length===0,'foam bubbles and meniscus remain below the lowest rim and zero foam volume draws no head');
  const s={points:[[0,0,.2],[.006,0,.15],[.01,0,.08]],radii:[.0045,.003,.002],phase:.2},before=JSON.stringify(s),stream=L.streamMesh(s),moved=L.streamMesh({...s,phase:.3});
  check(valid(stream)&&stream.pos.length>0&&stream.pos.some((x,i)=>Math.abs(x-moved.pos[i])>1e-6)&&JSON.stringify(s)===before,'a falling stream tapers and varies smoothly over time without moving its physical centreline');
  check(Array.from({length:stream.pos.length/3/11},(_,i)=>[0,1,2].every(k=>stream.nrm[i*33+k]===stream.nrm[i*33+30+k])).every(Boolean),'stream highlights remain continuous across the wrapped UV seam');
  check(valid(L.streamMesh({points:[[0,0,0],[0,0,0],[0,0,-.01]],radii:[.002,.002,.001]}))&&valid(L.streamMesh({points:[]})),'paused or coincident flow samples never produce invalid render buffers');
  const droplets=L.particleMesh(Array.from({length:100},(_,i)=>({p:[i*.001,0,.1],r:.001,velocity:[0,0,-1],stretch:1.7})));
  check(valid(droplets)&&droplets.pos.length/3<=64*54,'breakup droplets and spray use one bounded mesh batch');
  const a={key:'a',R:I,t:[1,0,0],v:[0,0,0],w:[0,0,0]},b={key:'b',R:I,t:[0,0,0],v:[0,0,0],w:[0,0,0]},W={poseOf:b=>({R:b.R,t:b.t}),time:0};
  const from=P.vessel(a,{shape:P.cylinder(.03,.2),floor:0,volume:.0005,flow:.00016}),to=P.vessel(b,{shape:P.cylinder(.043,.12),floor:0,volume:0}),pour=P.pour(W,[from,to],{R:I,t:[0,0,0],size:[.5,.9]});
  const packet=5e-6;from.V-=packet;pour.drops.push({p:[0,0,.13],v:[0,0,-1],flow:.00016,vol:packet,age:0,from});
  const total=()=>from.V+to.V+pour.spilled+pour.drops.reduce((s,d)=>s+d.vol,0);
  for(let i=0;i<6;i++){W.time+=1/240;pour.step(1/240);}
  check(to.V===0&&pour.drops.some(d=>d.inside===to),'crossing the open mouth retains a real airborne parcel until it reaches the liquid surface or floor');
  for(let i=0;i<100&&to.V===0;i++){W.time+=1/240;pour.step(1/240);}for(let i=0;i<2;i++){W.time+=1/240;pour.step(1/240);}
  const view=pour.view(),mug=view.surfaces.find(v=>v.key==='b'),sum=total();
  check(to.V===packet&&mug?.impact?.strength>0&&view.streams.length===0&&view.particles.length>0,'actual surface impact creates localized ripples and small spray without a fabricated post-collection stream');
  for(let i=0;i<30;i++){pour.view();W.time+=1/240;pour.step(1/240);}
  check(Math.abs(total()-.0005)<1e-12&&Math.abs(sum-.0005)<1e-12&&pour.view().particles.length<=48,'stream, bubbles and spray cannot create or consume accounted beer');
  pour.reset();check(!pour.visualImpacts.length&&!to.receiving&&!pour.view().particles.length&&from.V===from.V0&&to.V===0,'restart clears all visual tails and refills only the physical initial volumes');
  pour.drops=[{p:[.006,0,.2],visualOffset:[.006,0,0],visualVelocityOffset:[0,0,0],v:[0,0,-1],vol:1e-6,flow:.0001,exitSpeed:1,age:.1,from},{p:[-.006,0,.18],visualOffset:[-.006,0,0],visualVelocityOffset:[0,0,0],v:[0,0,-1],vol:1e-6,flow:.0001,exitSpeed:1,age:.12,from}];
  const sampled=pour.view(),expected=Math.sqrt(1e-6/(.02*Math.PI)),shift=[.4,-.3,.2],boost=[2,-3,1];
  for(const d of pour.drops){d.p=d.p.map((x,i)=>x+shift[i]);d.v=d.v.map((x,i)=>x+boost[i]);}a.t=a.t.map((x,i)=>x+shift[i]);
  const translated=pour.view();
  check(sampled.radii[0].every(r=>Math.abs(r-expected)<1e-10)&&sampled.streams[0].every(p=>Math.abs(p[0])<1e-12)&&sampled.radii[0].every((r,i)=>Math.abs(r-translated.radii[0][i])<1e-12),'cross-section quadrature renders a smooth axial centroid and continuity radius invariant under uniform frame translation/velocity');
};
