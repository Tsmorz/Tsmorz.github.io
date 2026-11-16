// Independent analytic and integrated transport checks. No visual fit or hardware data assumed.
module.exports = function ({check}) {
  const path=require('path'),root=path.resolve(__dirname,'../..'),C=require(root+'/tag-tracker/tracker-core'),R=require(root+'/tag-tracker/robot-core'),P=require(root+'/tag-tracker/physics-core'),T=require(root+'/tag-tracker/task-core'),L=require(root+'/tag-tracker/pour-core');
  const I=[1,0,0,0,1,0,0,0,1],close=(a,b,rel=1e-7)=>Math.abs(a-b)<rel*Math.max(Math.abs(a),Math.abs(b),1e-12),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],s=L.cylinder(.04,.14),full=Math.PI*.04**2*.14;
  const volumeTests=[];for(const a of [0,.1,Math.PI/2-1e-8,Math.PI/2,Math.PI/2+1e-8,2,Math.PI]){const n=[Math.sin(a),0,Math.cos(a)],d=.035;volumeTests.push(close(L.volumeBelow(n,d,s)+L.volumeBelow(n.map(x=>-x),-d,s),full,1e-8));}
  check(volumeTests.every(Boolean)&&close(L.volumeBelow([1,0,0],0,s),full/2),'analytic clipped-cylinder volume is complementary and continuous through a horizontal vessel');
  const half={shape:s,V:full/2,density:1000,floor:.01,n:[0,0,1]},m=L.massProperties(half),mass=1000*full/2,h=.07;
  check(close(m.mass,mass)&&close(m.center[2],.045)&&close(m.inertia[0],mass*(3*.04**2+h*h)/12)&&close(m.inertia[8],mass*.04**2/2),'upright liquid COM and tensor match a half-height solid cylinder analytically');
  const side=L.massProperties({...half,n:[1,0,0]}),cx=-4*.04/(3*Math.PI);
  check(close(side.center[0],cx,2e-5)&&close(side.center[2],.08)&&side.inertia.every(Number.isFinite)&&side.inertia[0]>0&&side.inertia[4]>0&&side.inertia[8]>0,'horizontal liquid COM matches a semicircle centroid with positive finite inertia');
  const shell=L.shellMassProperties([{z0:0,z1:.2,r:.04}],[{z0:0,z1:.2,r:.03}],0,.3),expected=.3*(3*(.04**2+.03**2)+.2**2)/12;
  check(close(shell.center[2],.1)&&close(shell.inertia[0],expected)&&close(shell.inertia[8],.3*(.04**2+.03**2)/2),'glass-shell dry tensor matches an annular cylinder instead of a filled solid bottle');
  const b=L.vessel({},{shape:{sections:T.BOTTLE.inside},volume:.0005,floor:T.BOTTLE.floor,flow:Infinity,glug:false});b.n=[0,0,-1];const top=T.BOTTLE.inside.at(-1).z1;
  b.d=-top+.03;const q1=L.outflow(b,0);b.d=-top+.12;const q2=L.outflow(b,0);
  check(close(q2.rate/q1.rate,2)&&close(q2.speed/q1.speed,2)&&q1.rate>0,'vented neck discharge and velocity follow the square root of hydrostatic head');
  b.glug=true;const pulses=Array.from({length:240},()=>L.outflow(b,1/240).rate),vented=q2.rate;
  check(Math.min(...pulses)<vented*.1&&Math.max(...pulses)>vented*.9&&pulses.every(q=>q<=vented),'a flooded neck alternates discharge and air admission without inventing extra flow');
  const drain=dt=>{const body={R:R.Rx(110*Math.PI/180),t:[0,0,3],v:[0,0,0],w:[0,0,0],fixed:true},v=L.vessel(body,{shape:{sections:T.BOTTLE.inside},volume:.0005,floor:T.BOTTLE.floor,flow:.00016}),st=L.pour({poseOf:b=>b,floorZ:0},[v],null);let worst=0,maxPacket=0;
    for(let i=0;i<Math.round(8/dt);i++){st.step(dt);worst=Math.max(worst,Math.abs(v.V+st.spilled+st.drops.reduce((s,d)=>s+d.vol,0)-.0005));maxPacket=Math.max(maxPacket,...st.drops.map(d=>d.vol));}return {v,st,worst,maxPacket};};
  const coarse=drain(1/240),fine=drain(1/480);
  check(coarse.worst<1e-12&&fine.worst<1e-12&&coarse.maxPacket<=1e-6&&fine.maxPacket<=1e-6&&coarse.v.V<1e-8&&fine.v.V<1e-8,'finite glugging parcels never merge/teleport mass and conserve a full bottle at both fixed-step refinements');
  const fake=(volume=full*.1)=>{const body={R:I.slice(),t:[0,0,.5],v:[0,0,0],w:[0,0,0],fixed:true,key:'receiver'},W={poseOf:b=>({R:b.R,t:b.t}),floorZ:0},v=L.vessel(body,{shape:s,volume,floor:0}),state=L.pour(W,[v],null);return {W,v,state,body};};
  const f=fake();f.body.v=[1,0,0];f.state.step(1/240);f.body.v=[0,0,0];for(let i=0;i<2400;i++)f.state.step(1/240);
  check(f.v.n.every(Number.isFinite)&&C.norm(C.sub(f.v.n,[0,0,1]))<.002&&f.state.spilled===0,'an acceleration impulse excites bounded slosh which damps back to a horizontal free surface');
  // A parcel has to cross the open mouth and then physically fall to the surface.
  const a=fake(0),dv=1e-6;a.state.drops.push({p:[0,0,.69],v:[0,0,-.1],vol:dv,age:0,from:a.v,t:0});
  for(let i=0;i<24;i++)a.state.step(1/240);
  const airborne=a.v.V===0&&a.state.drops[0]?.inside===a.v;
  for(let i=0;i<100;i++)a.state.step(1/240);
  check(airborne&&close(a.v.V,dv)&&a.state.drops.length===0,'mouth entry is airborne until the real floor/surface impact, without automatic collection');
  const filled=fake(full-dv/2);filled.state.drops.push({p:[0,0,.69],v:[0,0,-.5],vol:dv,age:1,from:filled.v,t:0});for(let i=0;i<120;i++)filled.state.step(1/240);
  check(close(filled.v.V,full)&&close(filled.state.spilled,dv/2)&&filled.state.drops.length===0,'a receiver accepts only its remaining capacity and accounts for every overflowing parcel');
  const cp=require('child_process'),data=JSON.parse(cp.execFileSync('ruby',['-ryaml','-rjson','-e','puts JSON.generate(YAML.load_file(ARGV[0]))',root+'/_data/tag_tasks.yml'])),G=R.gripper(R.model()),level=data.levels.find(l=>l.id==='pour'),table={R:I,t:[0,0,0],size:[.5,.9],thick:.03},game=T.create(level,table,G),W=game.world,B=game.byKey.get('bottle');
  {
    const scene=JSON.parse(JSON.stringify(level));scene.objects[0].R=R.Rx(110*Math.PI/180);scene.objects[0].at=[0,0,2];scene.objects[1].at=[2,0,2];
    const air=T.create(scene,table,G),world=air.world,pour=air.pour,source=pour.from.body,dt=1/240;source.v=[.2,.3,.4];source.w=[.5,.3,.7];
    const totals=()=>{let momentum=[0,0,0],angular=[0,0,0],mass=0;for(const b of world.bodies){const p=b.v.map(x=>x*b.m);momentum=C.add(momentum,p);angular=C.add(angular,C.add(cross(b.t,p),C.mulv(C.mul3(C.mul3(b.R,b.Ib),C.tr3(b.R)),b.w)));mass+=b.m;}for(const d of pour.drops){const m=d.vol*d.from.density,p=d.v.map(x=>x*m);momentum=C.add(momentum,p);angular=C.add(angular,cross(d.p,p));mass+=m;}return {momentum,angular,mass};};
    const initial=totals();pour.prepare(dt);const emitted=totals();
    check(pour.drops.length>0&&C.norm(C.sub(initial.momentum,emitted.momentum))<1e-12&&C.norm(C.sub(initial.angular,emitted.angular))<1e-12,'sampled-point emission conserves exact world linear and angular momentum, including off-axis rigid motion');
    let drag=[0,0,0],worst=0;world.preStep.push(()=>{const p=world.bodies.reduce((p,b)=>C.add(p,b.v.map(x=>x*b.m)),[0,0,0]),m=world.bodies.reduce((s,b)=>s+b.m,0);drag=C.add(p,[0,0,-m*9.81*dt]).map(x=>x*(1-1/(1+.02*dt)));});
    for(let i=0;i<12;i++){const before=totals();world.step(dt);const after=totals(),gain=C.add(C.sub(after.momentum,before.momentum),drag);worst=Math.max(worst,C.norm(C.sub(gain,[0,0,-before.mass*9.81*dt])));}
    check(worst<1e-11&&pour.spilled===0&&pour.drops.length>0,'rigid plus airborne liquid momentum receives gravity exactly once per integrated prepare/step, accounting only for known rigid drag');
  }
  {
    const edge=JSON.parse(JSON.stringify(level)),mug=edge.objects.find(s=>s.kind==='stein'),bottle=edge.objects.find(s=>s.kind==='bottle');bottle.at=[mug.at[0]+.04,mug.at[1],.4];bottle.R=R.Rx(Math.PI);
    const scene=T.create(edge,table,G),p=scene.pour;for(const b of scene.world.bodies)b.fixed=true;p.from.glug=false;
    for(let i=0;i<96;i++)scene.world.step(1/240);
    const total=p.from.V+p.to.V+p.spilled+p.drops.reduce((s,d)=>s+d.vol,0),ratio=p.spilled/p.poured;
    check(p.to.V>1e-5&&ratio>.08&&ratio<.6&&Math.abs(total-p.V0)<1e-12,'a jet centroid just inside the mouth still has its outer cross-section intercepted by the real rim while the inner flow enters');
  }
  check(close(B.m,.8)&&close(B.dryMass.mass,.3)&&B.off[2]<0,'a fresh half-litre bottle carries its dry glass plus real half-kilogram liquid load');
  W.initialize();const base=W.poseOf(B).t.slice(),neutral=R.Ry(-Math.PI/2),offset=C.mulv(neutral,[0,0,G.pad.c[2]]),hand={R:neutral,t:C.sub(C.add(base,[0,0,T.BOTTLE.grip]),offset),opening:1};
  const step=(n,fn)=>{for(let i=0;i<n;i++){fn?.((i+1)/n);W.setRobot({hands:[{side:1,pose:{R:hand.R,t:hand.t},opening:hand.opening}]});W.step(1/60);}};
  step(60);hand.opening=0;step(90);const start=hand.t.slice();step(120,u=>hand.t=C.add(start,[0,0,.15*u]));step(120,u=>hand.R=C.mul3(R.Rx(u*Math.PI/3),neutral));step(30);
  const record=W.record.hands[1].grip;
  check(!!W.hands[1].grip&&record?.load>6&&record?.use<.85&&!record?.slipping,'a physical side-neck grasp carries and tilts the full weighted bottle with bounded force/torque use');
  const q=game.pour,receiver=q.to.body,pose=W.poseOf(receiver),at=p=>C.add(pose.t,C.mulv(pose.R,p));
  // Cross more than the entire thin stoneware wall in one 240 Hz step.
  const before=q.to.V;q.from.V-=dv;q.drops.push({p:at([-.09,0,.075]),v:C.mulv(pose.R,[40,0,0]),vol:dv,age:1,from:q.from,t:0});step(2);
  check(q.to.V===before&&q.spilled>=dv,'swept liquid collision stops a fast parcel at the real thin outer wall instead of tunnelling into the stein');
  game.reset();
  check(close(B.m,.8)&&q.from.V===q.V0&&q.to.V===0&&q.spilled===0&&q.drops.length===0,'restart restores exact dry geometry plus a fresh full liquid mass and clears transport');
  W.initialize();q.from.V-=dv;q.drops.push({p:at([-.015,0,.17]),v:C.mulv(pose.R,[.7,0,-1]),vol:dv,age:1,from:q.from,t:0});let wallHits=0;
  for(let i=0;i<160;i++){W.step(1/240);wallHits=Math.max(wallHits,...q.drops.map(d=>d.wallHits||0));}
  check(wallHits>0&&close(q.to.V,dv)&&q.spilled===0&&close(q.from.V+q.to.V+q.drops.reduce((s,d)=>s+d.vol,0),q.V0),'a parcel entering through the mouth runs down the real inner wall and then joins the beer without disappearing as a spill');
  game.reset();W.initialize();q.from.V-=dv;q.drops.push({p:at([0,0,.22]),v:[0,0,-1],vol:dv,age:1,from:q.from,t:0});
  W.setRobot({links:[{id:'1:forearm',a:at([-.07,0,.17]),b:at([.07,0,.17]),r:.012}],hands:[]});for(let i=0;i<60;i++)W.step(1/240);
  check(q.to.V===0&&close(q.spilled,dv)&&q.drops.length===0,'a real arm capsule above the opening blocks a jet instead of allowing invisible forearm penetration');
  for(const expanding of [false,true]){
    const scene=T.create(level,table,G),world=scene.world,pour=scene.pour,wrist={R:I,t:[.8,0,.4]};for(const b of world.bodies)b.fixed=true;
    world.resetRobot({hands:[{side:1,pose:wrist,opening:.017/G.gapMax}]});const hand=world.hands[1],body=hand.body;
    const boxes=compression=>[1,-1].map(jaw=>{const shape=G.padShape(jaw,hand.carrierGap,jaw===1?compression:[0,0,0]);return {p:C.add(shape.c,body.off),h:shape.h,jaw};});
    body.padBoxes=boxes(expanding?[.003,0,0]:[0,0,0]);
    const local=[G.pad.h[0]-.001,hand.carrierGap/2+G.pad.c[1],G.pad.c[2]+(expanding?0:.025)],point=C.add(wrist.t,local);let hits=0;
    const impulse=world.applyImpulse;world.applyImpulse=(target,...args)=>{if(target===body)hits++;return impulse(target,...args);};
    pour.from.V-=dv;pour.drops.push({p:point,v:[0,0,expanding?0:-4],radius:.0003,vol:dv,age:1,from:pour.from,t:0});
    pour.prepare(1/240);if(expanding)body.padBoxes=boxes([0,0,0]);world.time+=1/240;pour.step(1/240);
    check(hits>0&&close(pour.spilled,dv)&&pour.to.V===0&&pour.drops.length===0,expanding?'a pad expanding into a nearly stationary parcel is included in the swept liquid motion bound':'a fast jet at the rubber edge hits the exact pad beyond the narrower metal carrier without relying on rubber spheres');
  }
  for(const kind of ['expanding','sliding','static','expanding rigid','fixed']){
    const scene=T.create(level,table,G),world=scene.world,pour=scene.pour,dt=1/240,wrist={R:I,t:[.8,0,.4]};for(const b of world.bodies)b.fixed=true;
    world.resetRobot({hands:[{side:1,pose:wrist,opening:.017/G.gapMax}]});const hand=world.hands[1],body=hand.body,expanding=kind.startsWith('expanding'),sliding=kind==='sliding',moving=kind==='expanding rigid',fixed=kind==='fixed',carrier=hand.carrierGap,volume=2e-7,mass=volume*1000;
    const boxes=(q,comp)=>[1,-1].map(jaw=>{const shape=G.padShape(jaw,q,jaw===1?comp:[0,0,0]);return {p:C.add(shape.c,body.off),h:shape.h,jaw};});
    body.padBoxes=boxes(carrier,expanding?[.003,0,0]:[0,0,0]);body.fixed=fixed;body.v=moving?[.08,-.04,.03]:[0,0,0];body.w=moving?[0,0,.6]:[0,0,0];
    const local=[expanding?.010:sliding?.010:.012,sliding?carrier/2-.0005:carrier/2+G.pad.c[1],G.pad.c[2]],start=C.add(wrist.t,local),velocity=expanding?[0,.11,.05]:sliding?[.13,0,.05]:[-.5,.11,.05],direction=expanding?0:sliding?1:0,sign=sliding?-1:1,measure=velocity[0]?0:1;let report;
    const linear=b=>b.v.map(v=>v*b.m),angular=b=>C.add(cross(b.t,linear(b)),C.mulv(C.mul3(C.mul3(b.R,b.Ib),C.tr3(b.R)),b.w)),apply=world.applyImpulse;
    world.applyImpulse=(target,J,centroid)=>{
      const elapsed=(centroid[measure]-start[measure])/velocity[measure],rotation=moving?R.Rz(.6*elapsed):I,normal=C.mulv(rotation,[0,1,2].map(k=>k===direction?sign:0)),skin=C.sub(centroid,normal.map(v=>v*.0003)),material=C.mulv(rotation,expanding?[.003/dt,0,0]:sliding?[0,-.001/dt,0]:[0,0,0]),wall=C.add(C.add(target.v,cross(target.w,C.sub(skin,target.t))),material),incoming=C.add(velocity,[0,0,-9.81*elapsed]),expected=C.sub(incoming,wall).map(v=>v*mass),beforeP=linear(target),beforeL=angular(target),result=apply(target,J,centroid),afterP=linear(target),afterL=angular(target);
      report={elapsed,J,expected,beforeP,beforeL,afterP,afterL,centroid,wall,result};return result;
    };
    pour.from.V-=volume;pour.drops.push({p:start,v:velocity,radius:.0003,vol:volume,age:1,from:pour.from,t:0});pour.prepare(dt);
    if(expanding)body.padBoxes=boxes(carrier,[0,0,0]);if(sliding)body.padBoxes=boxes(carrier-.002,[0,0,0]);if(moving){body.t=C.add(body.t,body.v.map(v=>v*dt));body.R=R.Rz(.6*dt);}
    world.time+=dt;pour.step(dt);
    const momentum=report&&!fixed&&C.norm(C.sub(C.sub(report.afterP,report.beforeP),report.J))<1e-12&&C.norm(C.sub(C.sub(report.afterL,report.beforeL),cross(report.centroid,report.J)))<1e-12;
    check(report&&report.elapsed>0&&report.elapsed<dt&&C.norm(C.sub(report.J,report.expected))<1e-10&&close(pour.spilled,volume)&&pour.drops.length===0&&(fixed?report.result===false&&C.norm(body.v)===0&&C.norm(body.w)===0:momentum),kind+': an oblique parcel uses actual rigid plus pad material velocity and transfers equal/opposite centroid linear/angular momentum without fabricated wall motion');
  }
  {
    let bounded=true,limited=false;
    for(const speed of [4,8,40,400]){
      const scene=T.create(level,table,G),world=scene.world,pour=scene.pour;for(const b of world.bodies)b.fixed=true;
      const pose=world.poseOf(pour.to.body),at=q=>C.add(pose.t,C.mulv(pose.R,q));pour.from.V-=dv;
      pour.drops.push({p:at([.04,0,.08]),v:C.mulv(pose.R,[0,speed,-1]),radius:.001,vol:dv,age:1,inside:pour.to,from:pour.from,t:0});world.step(1/240);
      const d=pour.drops[0],local=d&&C.mulv(C.tr3(pose.R),C.sub(d.p,pose.t));
      bounded&&=!!d&&d.wallHits>=2&&d.wallHits<=12&&Math.hypot(local[0],local[1])+d.radius<=T.STEIN.Ri+1e-8&&[...d.p,...d.v].every(Number.isFinite)&&pour.spilled===0&&close(pour.from.V+pour.to.V+pour.drops.reduce((s,d)=>s+d.vol,0),pour.V0);
      if(speed===400)limited=d?.wallLimited===true;
    }
    check(bounded&&limited,'glancing 4/8/40 m/s runoff re-sweeps the curved wall; extreme 400 m/s exhaustion retains bounded, finite, conserved wall runoff');
  }
  {
    const scene=JSON.parse(JSON.stringify(level));scene.objects[0].at=[2,0,2];scene.objects[1].at=[0,0,2];
    const game=T.create(scene,table,G),world=game.world,pour=game.pour,body=pour.to.body,pose=world.poseOf(body),dt=1/240;pour.from.body.fixed=true;pour.from.V-=dv;
    pour.drops.push({p:C.add(pose.t,C.mulv(pose.R,[.04,0,.08])),v:C.mulv(pose.R,[0,40,-1]),radius:.001,vol:dv,age:1,inside:pour.to,from:pour.from,t:0});
    const totals=()=>{const p=body.v.map(x=>x*body.m),d=pour.drops[0],dp=d.v.map(x=>x*dv*1000);return {p:C.add(p,dp),L:C.add(C.add(cross(body.t,p),C.mulv(C.mul3(C.mul3(body.R,body.Ib),C.tr3(body.R)),body.w)),cross(d.p,dp))};};
    const before=totals();world.step(dt);const after=totals(),drag=[0,0,-body.m*9.81*dt*(1-1/(1+.02*dt))],gain=C.add(C.sub(after.p,before.p),drag);
    check(pour.drops[0]?.wallHits>=2&&C.norm(C.sub(gain,[0,0,-(body.m+dv*1000)*9.81*dt]))<1e-11&&Math.abs(after.L[2]-before.L[2])<1e-11,'moving-vessel wall re-sweeps transfer equal/opposite linear and orbital angular momentum while integrating gravity only once');
  }
  {
    const full=T.create(level,table,G),world=full.world,pour=full.pour,stein=pour.to.body;pour.from.V-=.0005;pour.to.V=.0005;for(let i=0;i<120;i++)world.step(1/60);
    // A full narrow-pad handle pinch about the jaws' weak axis slips. Approach
    // radially with vertical jaws around the whole 80 mm handle: the real 85 mm
    // opening clears it and the long pad's strong axis supports its weight.
    const pose=world.poseOf(stein),at=q=>C.add(pose.t,C.mulv(pose.R,q)),rotation=[0,0,1,1,0,0,0,1,0],wrist=C.sub([T.STEIN.handle.x,0,.077],C.mulv(rotation,[0,0,G.pad.c[2]])),hand={R:C.mul3(pose.R,rotation),t:at(C.add(wrist,[.12,0,0])),opening:1};let metal=0,carrying=false,slipping=false,maxUse=0;
    const run=(n,target)=>{for(let i=0;i<n;i++){if(target)hand.t=at(target((i+1)/n));world.setRobot({hands:[{side:1,pose:hand,opening:hand.opening}]});world.step(1/60);const record=world.record.hands[1];metal+=(record?.contacts||[]).filter(c=>!c.pad&&c.other.id===stein.id).length;if(carrying){slipping||=!!record?.grip?.slipping;maxUse=Math.max(maxUse,record?.grip?.use||0);}}};
    run(30);run(120,u=>C.add(wrist,[.12*(1-u),0,0]));hand.opening=0;run(90);
    const base=world.poseOf(stein).t[2],initial=world.hands[1].grip,initialR=initial?.Rrel.slice(),initialAnchor=initial&&C.sub(initial.pB,stein.off);carrying=true;
    run(120,u=>C.add(wrist,[0,0,.12*u]));run(120);
    const grip=world.record.hands[1]?.grip,held=world.hands[1].grip,unchanged=initialR&&held&&C.norm(C.so3Log(C.mul3(C.tr3(initialR),held.Rrel)))<1e-6&&C.norm(C.sub(initialAnchor,C.sub(held.pB,stein.off)))<1e-6;
    const patch=held&&held.sx>P.GRIP.patch&&held.sz>P.GRIP.patch&&held.sx<=G.pad.h[0]+P.GRIP.patch&&held.sz<=G.pad.h[2]+P.GRIP.patch;
    check(close(stein.m,.75)&&held?.body===stein&&world.poseOf(stein).t[2]-base>.10&&metal===0&&world.capped===0&&patch&&unchanged&&grip&&C.norm(C.add(grip.force,[0,0,stein.m*9.81]))<.03&&maxUse<.95&&!slipping&&pour.spilled===0,'the full 0.75 kg stein uses a real clear pad patch, balances its weight, and keeps its grip anchors/rotation without slipping or capped reactions');
  }
};
