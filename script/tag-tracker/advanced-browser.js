// Real cable load and finite TacHammer output; charging-browser.js covers the complete two-handed insertion.
(async()=>{
  const wait=ms=>new Promise(r=>setTimeout(r,ms)),assert=(ok,msg)=>{if(!ok)throw Error(msg);};
  document.querySelectorAll('dialog[open]').forEach(d=>d.close());setMode('tasks');setCampaignMode('guided');taskLevel('cable');await wait(500);
  const W=TB.world,plug=TB.game.byKey.get('plug'),d=driveOf(RB.scene.arms.find(a=>a.side===-1)),vec=p=>C.mulv(W.table.R,p),start=W.poseOf(plug).t.slice();
  d.open=1;d.t=C.add(d.t,vec([0,0,.2]));await wait(1000);d.R=W.table.R.slice();d.t=C.add(start,vec([-.012,0,.19]));await wait(1500);d.t=C.add(start,vec([-.012,0,.0925]));await wait(1500);d.open=0;await wait(1200);
  assert(W.hands[-1].grip?.body===plug,'the real robot grasps the USB housing');d.t=C.add(d.t,vec([0,0,.10]));await wait(1400);
  assert(W.poseOf(plug).t[2]>start[2]+.05&&W.cables[0].nodes.every(n=>n.p.every(Number.isFinite)),'lifting the real plug loads a finite elastic cable');
  const writes=[],b={id:'test-haptic',state:'live',hapticSide:'-1',track:null,act:{tachammerReady:true},actT:performance.now(),hapticCharacteristic:{writeValueWithResponse:bytes=>{writes.push([...bytes]);return Promise.resolve();}}};
  TaskHaptics.dispatcher().tick({boards:[b],world:W,arms:RB.scene.arms,now:performance.now(),enabled:true,active:true});await wait(20);
  assert(writes.length&&writes.every(x=>x[0]===2&&x[1]===2&&x[3]<=45),'real cable/grip load reaches the finite TacHammer write path');
  return {passed:true,realRobotGrip:true,cableDynamics:true,tacHammerOnly:true};
})()
