// Two towel folds through actual IK, motor slew, finite cloth patches and released layer contact.
(async()=>{
  const wait=ms=>new Promise(r=>setTimeout(r,ms)),assert=(ok,msg)=>{if(!ok)throw new Error(msg);};
  const until=async(fn,msg,ms=6000)=>{const start=performance.now();while(!fn()&&performance.now()-start<ms)await wait(50);assert(fn(),typeof msg==='function'?msg():msg);};
  document.querySelectorAll('dialog[open]').forEach(d=>d.close());setMode('tasks');setCampaignMode('guided');taskLevel('laundry');await wait(600);
  const W=TB.world,g=TB.game,c=W.cloths[0],T=W.table,vec=p=>C.mulv(T.R,p),at=p=>C.add(T.t,vec(p));
  assert(TB.drive.size===0&&[1,-1].every(side=>C.norm(C.so3Log(C.mul3(C.tr3(T.R),W.handPose(side).R)))<.05),'the towel starts with downward idle grippers without overriding AprilTags');
  const drives=Object.fromEntries([1,-1].map(side=>[side,driveOf(RB.scene.arms.find(a=>a.side===side))]));
  for(const d of Object.values(drives)){d.open=1;d.t=C.add(d.t,vec([0,0,.18]));}await wait(1000);
  const physicsWait=async seconds=>{const start=W.time;while(W.time-start<seconds)await wait(16);};
  async function pinch(side,i,second=false){
    const d=drives[side],point=second?ClothCore.handles(c).find(h=>h.side===side).point:c.nodes[i].p.slice();d.open=1;d.t=C.add(d.t,vec([0,0,.16]));await wait(700);d.R=T.R.slice();d.t=C.add(point,vec([0,0,.24]));await wait(1000);d.t=C.add(point,vec([0,0,.105]));await wait(1200);d.open=0;
    await until(()=>c.pins.has(String(side)),'robot gripper must capture its thick towel edge: '+JSON.stringify({side,i,hand:W.handPose(side),guide:TASK.guide,reach:RB.scene.arms.find(a=>a.side===side).reach}));return c.pins.get(String(side));
  }
  const motion=async(seconds,fn)=>{const start=W.time;while(W.time-start<seconds){const u=Math.min(1,(W.time-start)/seconds);fn(u*u*(3-2*u));await wait(16);}fn(1);await physicsWait(.5);};
  const fold=async(distance,rise,second=false)=>{
    const starts=[1,-1].map(side=>{const pin=c.pins.get(String(side)),row=side===1?c.N-1:0,from=g.local(C.add(W.handPose(side).t,C.mulv(W.handPose(side).R,pin.local))),edge=g.local(C.add(c.nodes[row*c.N].p,c.nodes[row*c.N+c.N-1].p).map(v=>v/2)),crease=g.local(c.nodes[row*c.N+Math.floor(c.N/2)].p);return {side,pin,from,shift:second?crease[0]-from[0]:-distance};});
    await motion(6,t=>{for(const {side,pin,from,shift}of starts){const d=drives[side];d.R=C.mul3(T.R,[1,0,0,0,1,0,0,0,1]);const p=C.add(from,[shift*.5*(1-Math.cos(Math.PI*t)),0,rise*Math.sin(Math.PI*t)+(second?.04:.025)*t]);d.t=C.sub(at(p),C.mulv(d.R,pin.local));if(c.pins.get(String(side))!==pin)throw Error('fabric grip slipped: '+JSON.stringify({second,t,side,target:d,hand:W.handPose(side),pin,pins:[...c.pins].map(([s,p])=>[s,p.i,p.layers]),load:c.reactions[side]}));}});
  };
  assert(c.kind==='towel'&&c.halfThickness===.003&&$('taskLabels').textContent.includes('First fold corner'),'the task displays a thick towel and first-fold corner labels');
  for(const [side,i]of [[1,c.N*c.N-1],[-1,c.N-1]])await pinch(side,i);
  await fold(c.width,c.width/2);assert(!g.complete,'one held fold cannot finish');
  for(const d of Object.values(drives))d.open=1;await physicsWait(4);for(const d of Object.values(drives))d.t=C.add(d.t,vec([0,0,.16]));await wait(900);
  console.log('first released',JSON.stringify({fold:ClothCore.folded(c),corners:[0,6,12].map(i=>[i,g.local(c.nodes[i].p)])}));
  assert(c.foldStage===1&&ClothCore.folded(c).x&&!g.complete,'the released first fold advances to the second-fold checkpoint: '+JSON.stringify(ClothCore.folded(c)));
  for(const [side,i]of [[1,(c.N-1)*c.N],[-1,0]])await pinch(side,i,true);
  assert([...c.pins.values()].every(p=>p.layers>=2&&p.throughFold),'each robot gripper clamps both actual layers of the aligned open edge');
  await fold(c.width/3,c.width/4,true);console.log('second held',JSON.stringify({fold:ClothCore.folded(c),corners:[0,6,12].map(i=>[i,g.local(c.nodes[i].p)])}));assert(!g.complete,'the second held fold still needs release');
  for(const d of Object.values(drives))d.open=1;await physicsWait(2);for(const d of Object.values(drives))d.t=C.add(d.t,vec([0,0,.16]));
  console.log('second released',JSON.stringify({fold:ClothCore.folded(c),corners:[0,6,12].map(i=>[i,g.local(c.nodes[i].p)])}));
  await until(()=>g.complete,()=>JSON.stringify({error:'fold completion',fold:ClothCore.folded(c),steps:g.steps,dwell:g.dwell,complete:g.complete,started:g.started,pins:c.pins.size,stage:c.foldStage,first:[...c.firstHands],second:[...c.foldHands],touched:[...c.touched],maxSpeed:Math.max(...c.nodes.map(n=>C.norm(n.v))),rms:Math.sqrt(c.nodes.reduce((s,n)=>s+C.norm(n.v)**2,0)/c.nodes.length),mid:c.nodes.reduce((p,n)=>C.add(p,g.local(n.p).map(v=>v/c.nodes.length)),[0,0,0]),rest:c.restTime,goal:g.level.goals[0],same:TB.game===g,bodies:W.bodies.length}),12000);
  assert(c.pins.size===0&&c.touched.size===2&&W.capped===0,'both folds finish through physical grips and settling without rigid solver clipping');
  assert(TASK_DATA.levels.length===5&&$('workbenchTask').options.length===5,'the task menu has exactly five choices');
  assert(document.documentElement.scrollWidth<=innerWidth+1,'the task and guidance fit the viewport');
  return {passed:true,fluffyTowel:true,twoFolds:true,realRobotIK:true,releasedAndSettled:true,viewport:[innerWidth,innerHeight]};
})()
