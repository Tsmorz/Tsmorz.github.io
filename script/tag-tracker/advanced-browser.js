// A real grip load reaches the finite TacHammer write path; pour-browser.js covers the complete pour.
// (Cable physics and insertion run headless against connector-fixture.json in advanced.cjs.)
(async()=>{
  const wait=ms=>new Promise(r=>setTimeout(r,ms)),assert=(ok,msg)=>{if(!ok)throw Error(msg);};
  document.querySelectorAll('dialog[open]').forEach(d=>d.close());setMode('tasks');setCampaignMode('guided');taskLevel('pour');await wait(500);
  const W=TB.world,g=TB.game,bottle=g.pour.from.body,BO=TaskCore.BOTTLE,vec=p=>C.mulv(W.table.R,p),fin=RCORE.gripper(RB.scene.m).finger.c[2];
  const d=driveOf(RB.scene.arms.find(a=>a.side===1)),pose=W.poseOf(bottle),neck=C.add(pose.t,C.mulv(pose.R,[0,0,BO.H-.028])),offset=C.mulv(d.R,[0,0,fin]);
  // Approach the neck with the forward-facing hand; a 90-degree wrist tilt exceeds its stop.
  d.open=1;d.t=C.add(d.t,vec([0,0,.25]));await wait(1000);d.t=C.sub(C.add(neck,vec([0,0,.1])),offset);await wait(1500);d.t=C.sub(neck,offset);await wait(1500);d.open=0;await wait(1200);
  assert(W.hands[1].grip?.body===bottle,'the real robot grips the bottle by its neck');
  d.t=C.add(d.t,vec([0,0,.06]));await wait(1400);
  assert(g.local(W.poseOf(bottle).t)[2]>.04&&W.record.hands[1].grip?.load>0,'lifting the bottle puts a finite load on the grip');
  const writes=[],b={id:'test-haptic',state:'live',hapticSide:'1',track:null,act:{tachammerReady:true},actT:performance.now(),hapticCharacteristic:{writeValueWithResponse:bytes=>{writes.push([...bytes]);return Promise.resolve();}}};
  const feedback=TaskHaptics.dispatcher(),now=performance.now();
  feedback.tick({boards:[b],world:W,arms:RB.scene.arms,now,enabled:true,active:true});await wait(20);
  feedback.tick({boards:[b],world:W,arms:RB.scene.arms,now:now+160,enabled:true,active:true});await wait(20);
  assert(writes.map(x=>x[2]).join(',')==='1,6'&&writes[0][3]===75&&writes[1][3]>0&&writes[1][3]<=75&&writes.every(x=>x[0]===2&&x[1]===2),'the real grip load clicks on contact, then rumbles in proportion to force under the selected 75 percent peak');
  return {passed:true,realRobotGrip:true,tacHammerOnly:true,contactClick:true,sustainedRumble:true};
})()
