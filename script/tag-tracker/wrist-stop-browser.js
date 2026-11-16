// Commands beyond a wrist stop must reach the task feedback path without rotating the shoulder.
(async()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms)),assert=(ok,msg)=>{if(!ok)throw Error(msg);};
  document.querySelectorAll('dialog[open]').forEach(d=>d.close());setMode('tasks');taskLevel('bowl');await sleep(600);
  const a=RB.scene.arms.find(a=>a.side===1),d=driveOf(a),m=RB.scene.m,chest=RB.scene.chest,q=a.q.slice(),t=d.t.slice(),R=d.R.slice();
  const writes=[],board={state:'live',hapticSide:'1',act:{tachammerReady:true},actT:0,hapticRateHz:25,hapticCharacteristic:{writeValueWithResponse:b=>{writes.push([...b]);return Promise.resolve();}}},D=TaskHaptics.dispatcher();
  const tick=async now=>{board.actT=now;D.tick({boards:[board],world:TB.world,arms:RB.scene.arms,now,enabled:true});await sleep(1);};
  const wanted=q.slice();wanted[4]=RCORE.JOINTS[4].hi+.2;d.R=C.mul3(chest.R,RCORE.fk(m,1,wanted).R);
  await sleep(800);assert(RB.scene.arms.find(a=>a.side===1).wristStop!==0,'the commanded stop survives robotUpdate and motor slew');
  await tick(0);assert(writes.length===1&&writes[0][2]===1&&board.hapticLast.reason==='wrist rotation limit','one stop edge produces the sharp tactile impact');
  for(const now of [150,300,500])await tick(now);
  assert(writes.length===1,'holding against the stop cannot retrigger impacts');
  assert(C.norm(C.sub(d.t,t))<1e-9,'the wrist stop does not change the position target');
  const command=RB.slew.get(1).q;
  assert(C.norm(C.sub(command.slice(0,4),q.slice(0,4)))<.01,'rotation limits cannot recruit shoulder or elbow');
  d.R=R;await sleep(600);await tick(650);d.R=C.mul3(chest.R,RCORE.fk(m,1,wanted).R);await sleep(600);await tick(850);
  assert(writes.length===2,'backing away rearms the stop for a new approach');
  return {passed:true,wristStop:true,noArmRecruitment:true,noRepeatedClicks:true};
})()
