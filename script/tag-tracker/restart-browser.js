// task shot -- /tag-tracker/ --eval-file script/tag-tracker/restart-browser.js
(async()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms)),assert=(ok,msg)=>{if(!ok)throw Error(msg);};
  document.querySelectorAll('dialog[open]').forEach(d=>d.close());setMode('tasks');setRobotView('orbit');await sleep(150);
  const writes=[],audio=[],dispatch=[],originalSend=sendTaskHaptics,originalPlay=SND?.play,originalCapture=plot.hasPointerCapture,originalRelease=plot.releasePointerCapture;
  const board=newBoard('restart-test','restart test',{sim:false,state:'live',use:false,track:null,hapticSide:'1',act:{tachammerReady:true},actT:performance.now(),hapticRateHz:25,hapticCharacteristic:{writeValueWithResponse:async bytes=>{writes.push([...bytes]);}}});
  S.boards.push(board);let releases=0,contactFrames=0;
  sendTaskHaptics=(world,...args)=>{dispatch.push(world);return originalSend(world,...args);};
  if(SND)SND.play=(rec,...args)=>{audio.push(rec);return originalPlay(rec,...args);};
  const frame=async()=>{await sleep(18);board.actT=performance.now();draw3d();};
  const involved=e=>[e.a.kind,e.b.kind].some(k=>k==='hand'||k==='arm');
  const ready=()=>robotReady(),near=(a,b,e=1e-7)=>a.every((v,i)=>Math.abs(v-b[i])<e);
  const fresh=(stepped=false)=>{
    const q=ready();assert(RB.scene.arms.every(a=>near(a.q,q)&&a.open===1&&a.wristStop===0),'restart installs ready, open arm commands atomically');
    assert(Object.values(TB.world.hands).every(h=>h.gap===RCORE.gripper(RB.scene.m).gapMax&&!h.grip&&C.norm(h.body.v)===0&&C.norm(h.body.w)===0),'physical hands start open, unheld and still');
    if(!stepped)assert(TB.world.record===null&&TB.world.carry===0,'restart has no old contact record or solver carry');
    assert(!TB.drive.size&&!TB.grab&&!TB.ptr&&!TB.hover&&plot.style.cursor===''&&$('dragPlaneGuide').hidden,'restart cancels pointer and mouse-target state');
  };
  const quiet=async(count=45)=>{
    const W=TB.world,starts=W.bodies.map(b=>W.poseOf(b).t.slice()),before=writes.length,first=audio.length;
    for(let i=0;i<count;i++){
      await frame();assert(TB.world===W,'a fresh task stays in one world');
      assert(!W.record?.touches.some(involved)&&!W.record?.events.length,'fresh hands never touch spawn props and resting supports generate no new impacts');
    }
    assert(W.bodies.every((b,i)=>Math.hypot(W.poseOf(b).t[0]-starts[i][0],W.poseOf(b).t[1]-starts[i][1])<.002),'restart never shoves spawned props sideways');
    assert(writes.length===before&&!audio.slice(first).some(rec=>rec.events.length),'restart creates no tactile cue or impact sound');
  };
  try{
    for(const id of ['bowl','sort','tray','pour']){
      taskLevel(id);draw3d();await quiet(5);
      const W=TB.world,G=RCORE.gripper(RB.scene.m),prop=W.bodies.find(b=>!b.fixed),pose=W.poseOf(prop),local=prop.kind==='bottle'?[0,0,TaskCore.BOTTLE.grip]:[0,0,prop.kind==='ball'?0:.02];
      const pinch=C.add(pose.t,C.mulv(pose.R,local));
      for(const a of RB.scene.arms){const d=driveOf(a);d.R=C.mul3(RB.scene.chest.R,RCORE.fk(RB.scene.m,a.side,ready()).R);d.t=C.sub(C.add(pinch,C.mulv(RB.scene.chest.R,[0,a.side===1?0:-.18,0])),C.mulv(d.R,[0,0,G.pad.c[2]]));d.open=0;}
      for(let i=0;i<65;i++){await frame();if(W.record?.touches.some(involved))contactFrames++;}
      // Native pointer capture is the only browser primitive stubbed. Robot input,
      // IK, motor slew, grips and contacts above all use the real application path.
      plot.hasPointerCapture=id=>id===91;plot.releasePointerCapture=id=>{assert(id===91,'the held pointer is released');releases++;};
      TB.grab={id:91,side:1,n:[0,0,1],at:[0,0,0],basis:[1,0,0,0,1,0,0,0,1]};TB.ptr={clientX:10,clientY:10};TB.hover={side:1};plot.style.cursor='grabbing';$('dragPlaneGuide').hidden=false;
      $('guideRestart').click();
      assert(TB.world!==W,'restart replaces the displaced world before any new simulation');fresh();
      plot.hasPointerCapture=originalCapture;plot.releasePointerCapture=originalRelease;
      await quiet();
    }
    assert(releases===4&&contactFrames>0,'regression exercises real contact and four held-pointer restarts');
    // Laundry is initial-load/restart only: never run a folding sequence.
    taskLevel('laundry');draw3d();const oldCloth=TB.world.cloths[0];resetTable();fresh();
    assert(TB.world.cloths[0]!==oldCloth&&!TB.world.cloths[0].pins.size,'shirt restart replaces its initial state without a fold simulation');

    // An automatic fallen-prop restart happens inside tableStep. No old-world
    // record or wrist-stop bit may reach feedback or reconstruction afterward.
    taskLevel('sort');draw3d();const fallenWorld=TB.world,arm=RB.scene.arms.find(a=>a.side===1),d=driveOf(arm);
    d.R=C.mul3(d.R,RCORE.Rx(Math.PI));fallenWorld.bodies.find(b=>!b.fixed).t[2]=fallenWorld.table.t[2]-.2;
    const sent=dispatch.length,heard=audio.length;await frame();
    assert(TB.world!==fallenWorld&&!dispatch.slice(sent).includes(fallenWorld)&&!audio.slice(heard).some(rec=>rec===fallenWorld.record),'auto restart aborts old-world haptic/audio dispatch in the same frame');fresh(true);await quiet(10);

    // Static, displaced live tags become a task-local neutral. Tracking calibration
    // remains untouched, and new tag movement continues through actual IK normally.
    const saved={cal:RB.cal,last:new Map(RB.last),seen:new Set(RB.seen)},m=RB.scene.m,I=[1,0,0,0,1,0,0,0,1],body={R:I,t:[.2,-.3,.8]},arms=[1,-1].map(side=>({key:'restart-wrist'+side,side,pose:{R:RCORE.fk(m,side,ready()).R,t:C.add(body.t,RCORE.fk(m,side,ready()).wrist)}}));
    try{
      const roles={body:'restart-body',arms:arms.map(({key,side})=>({key,side}))},cal=RCORE.calibrate(m,{body,arms});
      RB.seen=new Set([roles.body,...roles.arms.map(a=>a.key)]);
      const displacedBody={R:C.mul3(RCORE.Rz(.6),C.mul3(RCORE.Rx(.3),RCORE.Ry(-.2))),t:[.45,-.1,1.0]};
      const refresh=()=>{const time=performance.now()/1000;for(const p of RB.last.values())if(p.testRestart)p.time=time;};
      RB.last=new Map([[roles.body,{...displacedBody,time:performance.now()/1000,testRestart:true}],...arms.map(a=>[a.key,{R:C.mul3(a.pose.R,RCORE.Rx(.8)),t:C.add(a.pose.t,[-.12,.13,.04]),time:performance.now()/1000,testRestart:true}])]);
      RB.cal={cal,roles,sig:robotSig()};const calibration=JSON.stringify(cal);
      taskLevel('sort');refresh();draw3d();resetTable();fresh();
      for(let i=0;i<35;i++){refresh();await frame();assert(!TB.world.record?.touches.some(involved)&&RB.slew.get(1).q.every((v,j)=>Math.abs(v-ready()[j])<1e-6),'static displaced live tags cannot sweep ready hands through respawn');}
      setMotionScale(2);refresh();await frame();assert(RB.slew.get(1).q.every((v,j)=>Math.abs(v-ready()[j])<1e-6),'changing gain cannot revive pre-restart tag displacement');setMotionScale(1);
      assert(JSON.stringify(cal)===calibration,'task restart never mutates Tracking calibration');
      const input=RB.last.get(arms[0].key),before=RCORE.fk(m,1,RB.slew.get(1).q).wrist;input.t=C.add(input.t,C.mulv(displacedBody.R,[.015,0,0]));
      for(let i=0;i<25;i++){refresh();await frame();}
      assert(C.norm(C.sub(RCORE.fk(m,1,RB.slew.get(1).q).wrist,before))>.005,'fresh tag movement resumes from the safe ready reference');
      for(const p of RB.last.values())p.time=performance.now()/1000-2;
      resetTable();fresh();const waitingChest=RB.scene.chest.t.slice();
      for(const p of RB.last.values()){p.t=C.add(p.t,[0,.12,0]);p.time=performance.now()/1000;}
      draw3d();
      assert(near(RB.scene.chest.t,waitingChest)&&RB.slew.get(1).q.every((v,j)=>Math.abs(v-ready()[j])<1e-6),'a displaced stale body/wrist reacquisition seeds compatible ready origins without a sweep');
      assert(JSON.stringify(cal)===calibration,'stale reacquisition also preserves Tracking calibration');
    }finally{RB.cal=saved.cal;RB.last=saved.last;RB.seen=saved.seen;taskLevel('bowl');draw3d();}
    return {passed:true,rigidTasks:4,heldPointerRestarts:releases,contactFrames,initialShirtRestart:true,autoRestartBarrier:true,liveTagRebase:true,staleBodyReacquisition:true,quietRestart:true};
  }finally{
    sendTaskHaptics=originalSend;if(SND)SND.play=originalPlay;plot.hasPointerCapture=originalCapture;plot.releasePointerCapture=originalRelease;S.boards=S.boards.filter(b=>b!==board);TB.grab=null;
  }
})()
