// task shot -- /tag-tracker/ --eval-file script/tag-tracker/gripper-stability-browser.js
(async()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms)),assert=(ok,msg)=>{if(!ok)throw Error(msg);};
  const legal=q=>q.every((v,j)=>Number.isFinite(v)&&v>=(j===3?RCORE.MIN_BEND:RCORE.JOINTS[j].lo)-1e-8&&v<=RCORE.JOINTS[j].hi+1e-8);
  document.querySelectorAll('dialog[open]').forEach(d=>d.close());setMode('tasks');setRobotView('orbit');setMotionScale(1);await sleep(200);
  // Pointer capture requires a trusted event. Keep the real picking, world ray, plane,
  // reach constraint, IK, motor and contact path; stub only native pointer capture.
  const capture=plot.setPointerCapture;plot.setPointerCapture=()=>{};let frames=0,constrained=0,maxPlaneError=0,maxAngularDeflection=0,maxPositionDeflection=0,maxDrawAngleError=0;
  try{
    for(const side of [1,-1]){
      taskLevel('bowl');draw3d();
      const arm=RB.scene.arms.find(a=>a.side===side),{o,r}=plotOrbit(),screen=o.project(gripPoint(RB.scene,arm));
      const e={pointerId:77,pointerType:'mouse',button:0,buttons:1,altKey:false,shiftKey:false,clientX:r.left+screen[0],clientY:r.top+screen[1]};
      assert(handGrab(e),`side ${side}: real gripper picking begins the drag`);
      const d=TB.drive.get(side);
      for(let i=0;i<100;i++){
        // Repeated large reversals, including ignored modifier keys, force arm
        // stops and collisions without replacing any solver or physical state.
        const altKey=i>=50;
        const start=d.t.slice(),normal=TB.grab.n.slice(),angle=i*.91;
        handMove({...e,altKey,clientX:e.clientX+Math.sin(angle)*r.width*1.7,clientY:e.clientY+Math.cos(angle*.73)*r.height*1.7});
        await sleep(18);draw3d();frames++;
        const cmd=RB.prev.get('drive'+side),render=RB.scene.arms.find(a=>a.side===side),motor=RB.slew.get(side),pose=TB.world.handPose(side);
        assert(legal(cmd.q)&&legal(motor.q)&&legal(render.q),`side ${side}, frame ${i}: command, motor and contact reconstruction stay within hard stops`);
        assert([...pose.R,...pose.t,...TB.world.hands[side].body.v,...TB.world.hands[side].body.w].every(Number.isFinite),`side ${side}, frame ${i}: contact state stays finite`);
        const fk=RCORE.fk(RB.scene.m,side,motor.q),commandR=C.mul3(RB.scene.chest.R,fk.R),drawR=C.mul3(RB.scene.chest.R,RCORE.fk(RB.scene.m,side,render.q).R);
        maxAngularDeflection=Math.max(maxAngularDeflection,C.angleOf(C.mul3(pose.R,C.tr3(commandR)))*180/Math.PI);
        maxPositionDeflection=Math.max(maxPositionDeflection,C.norm(C.sub(pose.t,RCORE.place(RB.scene.chest,fk.wrist))));
        maxDrawAngleError=Math.max(maxDrawAngleError,C.angleOf(C.mul3(pose.R,C.tr3(drawR)))*180/Math.PI);
        const planeError=Math.abs(C.sub(d.t,start).reduce((v,x,j)=>v+x*normal[j],0));maxPlaneError=Math.max(maxPlaneError,planeError);
        assert(planeError<1e-6,`side ${side}, frame ${i}: arm stop keeps the locked world drag plane`);
        if(!render.reach)constrained++;
      }
      const far=d.t.slice(),ready=RCORE.fk(RB.scene.m,side,robotReady()),home=RCORE.place(RB.scene.chest,ready.wrist);
      // Real incremental pointer travel must also return from the stops. Move the
      // pointer's last ray hit rather than teleporting it to the accepted target.
      const start=d.t.slice();let reverseTravel=0;
      for(const altKey of [true,false,true]){
        for(let i=0;i<40;i++){
          const n=TB.grab.n,delta=C.sub(home,d.t),along=C.sub(delta,n.map(v=>v*delta.reduce((s,x,j)=>s+x*n[j],0))),distance=C.norm(along);
          if(distance<.001)break;
          const next=C.add(TB.grab.at,along.map(v=>v*Math.min(.02,distance)/distance)),{o,r}=plotOrbit(),s=o.project(next);
          assert(s,'the returning pointer remains in front of the camera');
          const before=d.t.slice();handMove({...e,altKey,clientX:r.left+s[0],clientY:r.top+s[1]});await sleep(18);draw3d();
          reverseTravel+=C.norm(C.sub(d.t,before));
          assert(legal(RB.prev.get('drive'+side).q)&&legal(RB.slew.get(side).q),`side ${side}: gradual return keeps command and motor joints legal`);
        }
      }
      assert(reverseTravel>.005&&C.norm(C.sub(d.t,home))<.01,`side ${side}: gradual real pointer travel returns to ready without a branch trap ${JSON.stringify({start,target:d.t,home,reverseTravel})}`);
      handDrop(e);
      // Returning to the ready wrist through the same command path recovers without
      // resetting neutral, changing tabs or replacing the physics world.
      d.t=far;for(let i=0;i<70;i++){await sleep(18);draw3d();}
      d.t=home;d.R=C.mul3(RB.scene.chest.R,ready.R);
      for(let i=0;i<90;i++){await sleep(18);draw3d();}
      const motor=RB.slew.get(side),render=RB.scene.arms.find(a=>a.side===side);
      assert(legal(motor.q)&&legal(render.q)&&C.norm(C.sub(RCORE.fk(RB.scene.m,side,motor.q).wrist,ready.wrist))<.002,`side ${side}: the arm recovers after aggressive movement ${JSON.stringify({q:motor.q,ready:ready.wrist,actual:RCORE.fk(RB.scene.m,side,motor.q).wrist,target:d.t,command:RB.prev.get('drive'+side)})}`);
    }
  }finally{plot.setPointerCapture=capture;TB.grab=null;}
  assert(constrained>10,'the sweep exercises real arm-stop constraints');
  taskLevel('bowl');draw3d();
  return {passed:true,aggressiveFrames:frames,constrainedFrames:constrained,maxPlaneError,maxAngularDeflection,maxPositionDeflection,maxDrawAngleError,bothHands:true,gradualReturn:true,recovered:true};
})()
