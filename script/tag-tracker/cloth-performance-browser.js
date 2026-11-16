// Sustained single-cuff specimen, actual world fixed steps and production RAF/rendering. No folding sequence.
(async()=>{
  const wait=ms=>new Promise(r=>setTimeout(r,ms)),assert=(ok,msg)=>{if(!ok)throw new Error(msg);},percentile=(values,q)=>{const v=values.slice().sort((a,b)=>a-b);return v[Math.min(v.length-1,Math.floor(q*v.length))]||0;};
  taskLevel('laundry');await wait(300);setRobotView('orbit');
  const W=TB.world,c=W.cloths[0],clothStep=c.step,worldStep=W.step;W.step=()=>{};c.reset();
  const T=W.table,G=RCORE.gripper(RB.scene.m),R=C.mul3(T.R,C.rodrigues([Math.PI/2,0,0])),up=C.mulv(T.R,[0,0,1]),point=C.sub(c.nodes[c.landmarks.cuffs[0]].p,up.map(v=>v*c.halfThickness)),pose={R,t:C.sub(point,C.mulv(R,[G.pad.c[0],0,G.pad.c[2]]))},body={t:pose.t.slice(),R,sp:[],bound:.2,v:[0,0,0],w:[0,0,0]},hand={body,gap:4*c.halfThickness,target:0},probe={cloths:[c],gripper:G,hands:{1:hand},handPose:()=>pose,bodies:[],robotLinks:[],gravity:[0,0,-9.81],floorZ:W.floorZ,tableBox:W.tableBox};
  clothStep(1/240,probe);hand.fabricForce=2;assert(c.pins.get('1')?.layers===2,'the sustained specimen captures both physical layers');
  for(let i=0;i<160;i++){pose.t=C.add(pose.t,up.map(v=>v*.0005));body.t=pose.t.slice();body.v=up.map(v=>v*.12);clothStep(1/240,probe);}
  const base=pose.t.slice(),samples=[],cadence=[];let time=0,clothMs=0,steps=0;
  c.step=h=>{time+=h;const phase=time*Math.PI*2/.8;pose.t=C.add(base,up.map(v=>v*.003*Math.sin(phase)));body.t=pose.t.slice();body.v=up.map(v=>v*.003*Math.PI*2/.8*Math.cos(phase));const begin=performance.now();clothStep(h,probe);clothMs+=performance.now()-begin;steps++;};
  const started=performance.now();W.step=h=>{const begin=performance.now(),before=steps;worldStep(h);samples.push({t:performance.now()-started,world:performance.now()-begin,cloth:clothMs,n:steps-before,dt:h});clothMs=0;};TB.t=performance.now();
  await new Promise(resolve=>{let previous=0;const frame=t=>{if(previous)cadence.push({t:t-started,ms:t-previous});previous=t;if(t-started>=7000)resolve();else requestAnimationFrame(frame);};requestAnimationFrame(frame);});
  const warm=samples.filter(s=>s.t>2000&&s.n>0),raf=cadence.filter(s=>s.t>2000),per4=warm.map(s=>s.world*4/s.n),cloth4=warm.map(s=>s.cloth*4/s.n),finite=c.nodes.every(n=>[...n.p,...n.v].every(Number.isFinite));
  const result={passed:finite&&c.pins.size===1,nodes:c.nodes.length,panels:c.panels,frames:raf.length,physics4Ms:{p50:percentile(per4,.5),p95:percentile(per4,.95)},cloth4Ms:{p50:percentile(cloth4,.5),p95:percentile(cloth4,.95)},rafMs:{p50:percentile(raf.map(s=>s.ms),.5),p95:percentile(raf.map(s=>s.ms),.95)},substeps:{p50:percentile(warm.map(s=>s.n),.5),p95:percentile(warm.map(s=>s.n),.95)},loadN:c.reactions[1]?.load,secondsSimulated:time};
  hand.target=.085;hand.gap=.085;hand.fabricForce=0;body.v=[0,0,0];clothStep(1/240,probe);assert(!c.pins.size&&hand.fabricGap===undefined&&!hand.fabricForce,'sustained specimen physically releases its finite patch and squeeze force');c.step=clothStep;W.step=worldStep;resetTable();
  assert(result.passed,'the sustained physical specimen remains finite and held');return result;
})()
