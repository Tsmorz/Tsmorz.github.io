// One cuff pickup through the task's actual IK, motors, arm/table collisions and finite gripper patches. No fold sequence.
// task shot -- /tag-tracker/ --eval-file script/tag-tracker/cloth-pickup-browser.js (also --phone)
// Add --eval 'finishClothPickupProbe()' to check explicit release and capture the settled garment.
(async()=>{
  const wait=ms=>new Promise(r=>setTimeout(r,ms)),assert=(ok,msg)=>{if(!ok)throw Error(msg);};
  document.querySelectorAll('dialog[open]').forEach(d=>d.close());setMode('tasks');taskLevel('laundry');setRobotView('orbit');await wait(300);
  const W=TB.world,game=TB.game,c=W.cloths[0],T=W.table,G=RCORE.gripper(RB.scene.m),arm=RB.scene.arms.find(a=>a.side===1),d=driveOf(arm),up=C.mulv(T.R,[0,0,1]),point=c.nodes[c.landmarks.cuffs[0]].p.slice(),R=C.mul3(T.R,RCORE.Rz(Math.PI/2)),tip=[0,0,G.pad.c[2]-G.pad.h[2]+.0005],toe=[0,0,G.pad.c[2]-G.pad.h[2]];
  const worldStep=W.step,timings=[];
  W.step=dt=>{const begin=performance.now(),before=W.time;worldStep(dt);timings.push({at:begin,ms:performance.now()-begin,steps:Math.round((W.time-before)/PHYS.H)});};
  const percentile=(values,q)=>{const sorted=values.slice().sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.floor(q*sorted.length))]||0;};
  const local=p=>C.mulv(C.tr3(T.R),C.sub(p,T.t)),toolPoint=q=>{const p=W.handPose(1);return C.add(p.t,C.mulv(p.R,q));},cuff=()=>c.nodes[c.landmarks.cuffs[0]].p;
  let clearForce=0,maxRigidForce=0,maxReaction=0,maxDeflection=0,maxOverlap=0,loaded=false,fallen=false;
  W.mechanisms.push(()=>{
    fallen||=!!TaskCore.fallen(game)||W.respawns>0;
    if(!loaded){clearForce=Math.max(clearForce,C.norm(W.contactState?.hands[1]?.force||[0,0,0]));return;}
    maxRigidForce=Math.max(maxRigidForce,C.norm(W.contactState?.hands[1]?.force||[0,0,0]));maxReaction=Math.max(maxReaction,c.reactions[1]?.load||0);
    const motor=RB.slew.get(1),fk=motor&&RCORE.fk(RB.scene.m,1,motor.q);if(fk)maxDeflection=Math.max(maxDeflection,C.norm(C.sub(W.handPose(1).t,RCORE.place(RB.scene.chest,fk.wrist))));
    const body=W.hands[1].body;for(const s of body.sp)maxOverlap=Math.max(maxOverlap,-PHYS.sphereBox(C.add(body.t,C.mulv(body.R,s.p)),s.r,W.tableBox,W.tableBox.h).dist);
    for(const box of PHYS.padBoxes(G,W.hands[1]))maxOverlap=Math.max(maxOverlap,-PHYS.boxBox(box,W.tableBox).dist);
  });
  const sameWorld=stage=>{assert(TB.world===W,'pickup world changed during '+stage+': '+JSON.stringify({notice:TASK.notice,level:currentTask().id}));assert(!fallen&&!TaskCore.fallen(game)&&W.respawns===0,'garment fell/respawned during '+stage);};
  const sample=stage=>{sameWorld(stage);if(loaded)assert(maxRigidForce<PHYS.HAND.force&&maxReaction<PHYS.HAND.force&&maxDeflection<2*PHYS.PRESS&&maxOverlap<.001,'contact reaction/wrist kick during '+stage+': '+JSON.stringify({maxRigidForce,maxReaction,maxDeflection,maxOverlap}));};
  const dwell=async(stage,count)=>{for(let i=0;i<count;i++){await wait(16);sample(stage);}};
  // Keep every intermediate orientation clear, then expose the whole bottom toe.
  d.open=1;d.R=C.mul3(T.R,RCORE.fk(RB.scene.m,1,robotReady()).R);d.t=C.sub(C.add(point,up.map(v=>v*.025)),C.mulv(R,tip));await wait(1800);sample('neutral hover');
  d.R=R;await wait(1400);sample('upright orientation');
  assert(C.norm(C.so3Log(C.mul3(C.tr3(R),W.handPose(1).R)))<.001,'upright cuff orientation is reachable before lowering');
  const wheelTo=opening=>{
    draw3d();const {o,r}=plotOrbit(),current=RB.scene.arms.find(a=>a.side===1),p=o.project(gripPoint(RB.scene,current));assert(p,'gripper is visible for the actual wheel trigger');
    plot.dispatchEvent(new WheelEvent('wheel',{clientX:r.left+p[0],clientY:r.top+p[1],deltaY:(d.open-opening)/.002,bubbles:true,cancelable:true}));
    assert(Math.abs(d.open-opening)<1e-8,'the visible gripper wheel sets its physical opening');
  };
  wheelTo(.017/G.gapMax);await wait(600);sample('17 mm preshape');
  for(let i=0;i<60;i++){
    const pose=W.handPose(1),aim=C.sub(C.add(cuff(),up.map(v=>v*.025)),C.mulv(pose.R,tip));d.t=C.add(d.t,C.sub(aim,d.t).map(v=>v*.2));await wait(16);sample('hover alignment');
    if(C.norm(C.sub(toolPoint(tip),C.add(cuff(),up.map(v=>v*.025))))<.0001)break;
  }
  const clearance=.00035;
  assert(clearForce<.1&&C.norm(C.so3Log(C.mul3(C.tr3(R),W.handPose(1).R)))<.001,'clear hover has no rigid contact and reaches the upright cuff orientation');
  loaded=true;
  for(let i=0;i<180&&local(toolPoint(toe))[2]>clearance+.00003;i++){
    d.t=C.sub(d.t,up.map(v=>v*Math.min(.0003,(local(toolPoint(toe))[2]-clearance)*.25)));await wait(16);sample('vertical toe approach');
  }
  assert(maxOverlap<.001,'loaded toe contact stays within rigid table collision slop: '+maxOverlap);
  await dwell('stationary toe',120);
  wheelTo(0);await dwell('closure',60);assert(c.pins.size===1&&W.hands[1].fabricForce>0,'the actual gripper closes on the marked cuff: '+JSON.stringify({sameWorld:W===TB.world,pins:[...c.pins.keys()],hand:W.handPose(1),cuff:c.nodes[c.landmarks.cuffs[0]].p,local:C.mulv(C.tr3(W.handPose(1).R),C.sub(c.nodes[c.landmarks.cuffs[0]].p,W.handPose(1).t)),gap:W.hands[1].gap,target:W.hands[1].target,slip:W.hands[1].clothSlip,force:W.hands[1].fabricForce,command:d.t,tip}));
  for(let i=0;i<100;i++){d.t=C.add(d.t,up.map(v=>v*.0008));await wait(16);sample('cuff lift');}
  const heldStart=performance.now(),heldSimStart=W.time;await dwell('held garment',120);const heldEnd=performance.now();
  const heldSamples=timings.filter(q=>q.at>=heldStart&&q.at<heldEnd&&q.steps>0),per4=heldSamples.map(q=>q.ms*4/q.steps),cadence=heldSamples.slice(1).map((q,i)=>q.at-heldSamples[i].at);
  const performanceResult={wallSeconds:(heldEnd-heldStart)/1000,simulatedSeconds:W.time-heldSimStart,frames:heldSamples.length,physics4Ms:{p50:percentile(per4,.5),p95:percentile(per4,.95)},frameMs:{p50:percentile(cadence,.5),p95:percentile(cadence,.95)}};
  assert(c.pins.size===1&&c.reactions[1]?.load>.05&&c.nodes.every(n=>[...n.p,...n.v].every(Number.isFinite)),'the real robot lifts a finite garment load');
  const localZ=n=>C.mulv(C.tr3(T.R),C.sub(n.p,T.t))[2],height=Math.max(...c.nodes.map(localZ));assert(height>.06,'the cuff leaves the tabletop');
  Object.assign(S.view,{yaw:-.65,pitch:.55,dist:.85,target:C.add(T.t,C.mulv(T.R,[-.04,0,.04]))});draw3d();
  window.finishClothPickupProbe=async()=>{wheelTo(1);await dwell('release',60);assert(!c.pins.size&&W.hands[1].fabricForce===0&&!Object.keys(c.reactions).length,'opening releases the fabric and feedback');W.step=worldStep;return {released:true,maxReaction,maxDeflection,maxOverlap};};
  return {passed:true,releasePending:true,realRobotIK:true,nodes:c.nodes.length,layers:c.pins.get('1')?.layers,loadN:c.reactions[1].load,height,clearForce,maxRigidForce,maxReaction,maxDeflection,maxOverlap,performance:performanceResult,viewport:[innerWidth,innerHeight]};
})()
