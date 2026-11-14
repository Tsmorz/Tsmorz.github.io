// Manipulation through the actual robot IK, motor slew, grips and deformable physics. No prop poses are set.
(async()=>{
  const wait=ms=>new Promise(r=>setTimeout(r,ms)),assert=(ok,msg)=>{if(!ok)throw new Error(msg);},until=async(fn,msg,ms=5000)=>{const t=performance.now();while(!fn()&&performance.now()-t<ms)await wait(35);assert(fn(),msg);};
  document.querySelectorAll('dialog[open]').forEach(d=>d.close());setCampaignMode('guided');taskLevel('cable');await wait(500);
  const W=TB.world,g=TB.game,plug=g.byKey.get('plug'),port=W.poseOf(g.byKey.get('port')).t,arm=RB.scene.arms.find(a=>a.side===-1),d=driveOf(arm),I=[1,0,0,0,1,0,0,0,1];
  const vec=p=>C.mulv(W.table.R,p);const start=W.poseOf(plug).t.slice();d.open=1;d.t=C.add(d.t,vec([0,0,.24]));await wait(1500);d.R=W.table.R.slice();await wait(1000);d.t=C.add(start,vec([-.012,0,.19]));await wait(1700);d.t=C.add(start,vec([-.012,0,.0925]));await wait(1700);d.open=0;
  await until(()=>W.hands[-1].grip?.body===plug,'the right robot gripper can reach and physically pinch the USB housing: '+JSON.stringify({hand:W.handPose(-1),plug:W.poseOf(plug),reach:RB.scene.arms.find(a=>a.side===-1).reach}));
  d.t=C.add(d.t,vec([0,0,.10]));await wait(1400);assert(W.poseOf(plug).t[2]>start[2]+.06,'the real robot lifts the attached cable');
  // Move to the mouth, then make small visual-servo corrections to the hand target, as fine mouse/tag moves would.
  const offset=C.sub(d.t,W.poseOf(plug).t);d.t=C.add(C.add(port,vec([-.039,0,0])),offset);await wait(1800);
  const track=async(to,ms)=>{const t=performance.now();while(performance.now()-t<ms){
    const pp=W.poseOf(plug),err=C.sub(to,pp.t),delta=C.rodrigues(PHYS.rotvec(C.mul3(W.table.R,C.tr3(pp.R))).map(v=>v*.04));
    d.t=C.add(C.add(pp.t,C.mulv(delta,C.sub(d.t,pp.t))),err.map(v=>Math.max(-.00022,Math.min(.00022,v*.08))));d.R=C.mul3(delta,d.R);await wait(30);
  }};
  await track(C.add(port,vec([-.031,0,0])),2700);assert(plug.insertion.aligned,'fine physical wrist movement aligns the USB nose: '+JSON.stringify({insert:plug.insertion,pose:W.poseOf(plug),drive:d,hand:W.handPose(-1),arm:RB.scene.arms.find(a=>a.side===-1)}));
  await track(C.add(port,vec([-.020,0,0])),4400);
  await until(()=>plug.insertion.seated,'the real robot can seat the plug: '+JSON.stringify({insertion:plug.insertion,pose:W.poseOf(plug),hand:W.handPose(-1),reach:RB.scene.arms.find(a=>a.side===-1).reach}));
  assert(!g.complete&&TASK.guide.state==='usb_release','seating still asks for an actual release');d.open=1;
  await until(()=>g.complete,'the connector remains seated and settles after release',6500);
  assert(W.cables[0].nodes.every(n=>n.p.every(Number.isFinite))&&W.capped===0,'cable dynamics stay finite without angular safety clipping');
  // The board adapter uses the real command-writing path with a mock GATT characteristic.
  const writes=[],b={id:'test-haptic',state:'live',hapticSide:'-1',track:null,act:{railOn:true,tachammerReady:true},actT:performance.now(),hapticCharacteristic:{writeValueWithResponse:bytes=>{writes.push([...bytes]);return Promise.resolve();}}};
  const dispatch=TaskHaptics.dispatcher();dispatch.tick({boards:[b],world:W,arms:RB.scene.arms,now:performance.now(),enabled:true,active:true});
  // Add a real contact using the robot gripper, not an invented force record.
  const p=W.poseOf(plug).t;d.open=0;d.t=C.add(p,vec([-.012,0,.0925]));await wait(1300);b.actT=performance.now();dispatch.tick({boards:[b],world:W,arms:RB.scene.arms,now:performance.now(),enabled:true,active:true});await wait(20);
  assert(writes.length&&writes.every(x=>x[0]===2&&x[1]===2&&x[3]<=45),'real simulated contact reaches the finite TacHammer GATT write path');
  d.open=1;await wait(400);
  return {passed:true,usbPhysicallyGraspedAndInserted:true,robotIK:true,cableDynamics:true,tacHammerOnly:true,viewport:[innerWidth,innerHeight]};
})()
