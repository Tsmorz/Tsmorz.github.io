// Fold both sleeves and the shirt body through actual robot IK, motor slew and finite cloth patches.
(async()=>{
  const wait=ms=>new Promise(r=>setTimeout(r,ms)),assert=(ok,msg)=>{if(!ok)throw new Error(msg);};
  const until=async(fn,msg,ms=5000)=>{const start=performance.now();while(!fn()&&performance.now()-start<ms)await wait(60);assert(fn(),msg);};
  document.querySelectorAll('dialog[open]').forEach(d=>d.close());setCampaignMode('guided');taskLevel('laundry');await wait(600);
  const W=TB.world,g=TB.game,c=W.cloths[0],T=W.table,vec=p=>C.mulv(T.R,p),at=p=>C.add(T.t,vec(p));
  const drives=Object.fromEntries([1,-1].map(side=>[side,driveOf(RB.scene.arms.find(a=>a.side===side))]));
  for(const d of Object.values(drives)){d.open=1;d.t=C.add(d.t,vec([0,0,.18]));}await wait(1200);
  async function pinch(side,i){
    const d=drives[side],point=c.nodes[i].p.slice();d.open=1;d.t=C.add(d.t,vec([0,0,.18]));await wait(700);d.R=T.R.slice();d.t=C.add(point,vec([0,0,.24]));await wait(1100);d.t=C.add(point,vec([0,0,.12]));await wait(1200);d.open=0;
    await until(()=>c.pins.has(String(side)),'robot gripper must capture its cuff or hem: '+JSON.stringify({side,i,hand:W.handPose(side),guide:TASK.guide}));return c.pins.get(String(side));
  }
  const physicsWait=async seconds=>{const start=W.time;while(W.time-start<seconds)await wait(16);};
  const motion=async(seconds,fn)=>{const start=W.time;while(W.time-start<seconds){const u=Math.min(1,(W.time-start)/seconds);fn(u*u*(3-2*u));await wait(16);}fn(1);await physicsWait(.75);};
  const note=label=>console.log(label,JSON.stringify({fold:ClothCore.folded(c),guide:TASK.guide,pins:[...c.pins].map(([s,p])=>[s,p.i]),hands:[1,-1].map(s=>W.handPose(s))}));
  assert(c.kind==='shirt'&&$('gameTitle').textContent.includes('shirt')&&$('taskLabels').textContent.includes('Left cuff'),'the shirt task has a real cut pattern and visible cuff guidance');
  for(const [idx,side]of [[0,1],[1,-1]]){
    const pin=await pinch(side,c.landmarks.cuffs[idx]),from=g.local(c.nodes[pin.i].p),target=[from[0],idx===0?-.04:.04,.012],d=drives[side];
    await motion(3,t=>{d.R=C.mul3(T.R,RCORE.Rx((idx===0?-1:1)*Math.PI/2*t));const point=from.map((v,k)=>v+(target[k]-v)*t);point[2]+=.09*Math.sin(Math.PI*t);d.t=C.sub(at(point),C.mulv(d.R,pin.local));});
    d.open=1;await physicsWait(1.5);d.t=C.add(d.t,vec([0,0,.16]));await wait(800);note('sleeve '+idx);
    assert(ClothCore.folded(c).sleeves[idx]&&!g.complete,'the sleeve folds physically and remains tucked after release');
  }
  const starts=[];
  for(const [idx,side]of [[0,1],[1,-1]]){const pin=await pinch(side,c.landmarks.hem[idx]);starts.push({side,pin,from:g.local(c.nodes[pin.i].p)});}
  await motion(4,t=>{for(const {side,pin,from}of starts){const d=drives[side];d.R=C.mul3(T.R,RCORE.Ry(-Math.PI/2*t));d.t=C.sub(at(C.add(from,[.28*t,0,.095*Math.sin(Math.PI*t)])),C.mulv(d.R,pin.local));}});
  note('body held');assert(!g.complete,'a held shirt cannot complete');
  for(const d of Object.values(drives))d.open=1;await physicsWait(1.5);for(const d of Object.values(drives))d.t=C.add(d.t,vec([0,0,.16]));
  await until(()=>g.complete,'the released shirt must keep both sleeves and the body folded on the pad: '+JSON.stringify(ClothCore.folded(c)),9000);
  assert(c.pins.size===0&&c.touched.size===2&&W.capped===0,'the shirt finishes through both physical robot grippers without solver caps');
  return {passed:true,longSleeveShirt:true,finiteGripperPatches:true,sleevesAndBodyFolded:true,releasedAndSettled:true,viewport:[innerWidth,innerHeight]};
})()
