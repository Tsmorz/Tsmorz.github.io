// task shot -- /tag-tracker/ --eval "$(cat script/tag-tracker/story-browser.js)"
(async()=>{
  const wait=ms=>new Promise(r=>setTimeout(r,ms)),assert=(ok,msg)=>{if(!ok)throw new Error(msg);};
  const until=async(fn,msg,ms=5000)=>{const t=performance.now();while(!fn()&&performance.now()-t<ms)await wait(30);assert(fn(),msg);};
  const key=(k,on)=>plot.dispatchEvent(new KeyboardEvent(on?'keydown':'keyup',{key:k,bubbles:true,cancelable:true}));
  document.querySelectorAll('dialog[open]').forEach(d=>d.close());
  TASK.records.story={};setCampaignMode('story');taskLevel('bowl');await wait(400);
  assert(TB.game.level.travel&&!TB.game.arrived&&!TASK.saved.bowl,'story starts away from the work spot');
  assert(document.querySelector('[data-level="precision"]').disabled,'later rooms start locked');
  const fixed=TB.world.table.t.slice(),anchor=TASK.nav.anchor,first=RB.scene.chest.t.slice();
  const start=performance.now();
  while(!TB.game.arrived&&performance.now()-start<8000){
    const n=TASK.nav.state,dock=TB.game.level.travel.dock,desired=Math.atan2(dock[1]-n.y,dock[0]-n.x),err=Math.atan2(Math.sin(desired-n.yaw),Math.cos(desired-n.yaw));
    key('j',err>.06);key('l',err<-.06);key('i',Math.abs(err)<.25);await wait(30);
  }
  for(const k of ['i','j','l'])key(k,false);stopTravel();
  assert(TB.game.arrived&&TASK.nav.state.distance>.45,'the physical base drives to the work spot');
  assert(C.norm(C.sub(first,RB.scene.chest.t))>.4&&C.norm(C.sub(fixed,TB.world.table.t))<1e-10,'the character moves while the room and table stay fixed');
  // Finish parking near the centre and face the bench before doing fine manipulation.
  const park=performance.now();
  while(performance.now()-park<14000){
    const n=TASK.nav.state,dock=TB.game.level.travel.dock,dist=Math.hypot(dock[0]-n.x,dock[1]-n.y);
    const desired=dist>.055?Math.atan2(dock[1]-n.y,dock[0]-n.x):0,err=Math.atan2(Math.sin(desired-n.yaw),Math.cos(desired-n.yaw));
    if(dist<.055&&Math.abs(err)<.06)break;
    const action=Math.abs(err)>.06?(err>0?'j':'l'):'i';
    key(action,true);await wait(Math.abs(err)<.15&&action!=='i'?100:200);key(action,false);stopTravel();await wait(40);
  }
  for(const k of ['i','j','l'])key(k,false);stopTravel();await wait(100);
  assert(Math.abs(TASK.nav.state.yaw)<.09,'the player can park facing the bench');
  setInputMode('hands');
  const W=TB.world,ball=TB.game.byKey.get('ball'),sc=RB.scene,arm=sc.arms.find(a=>a.side===1),d=driveOf(arm),G=RCORE.gripper(sc.m),offset=C.mulv(d.R,[0,0,G.finger.c[2]]),p=W.poseOf(ball).t.slice();
  d.open=1;d.t=C.sub(C.add(p,[0,0,.07]),offset);await wait(1600);d.t=C.sub(p,offset);await wait(1300);d.open=0;
  await until(()=>W.hands[1].grip&&W.hands[1].grip.body===ball,'the mobile robot can grasp after driving: '+JSON.stringify({base:TASK.nav.state,ball:ball.t,wrist:W.handPose(1),reach:RB.scene.arms.find(a=>a.side===1).reach}));
  // Switching character preserves the level, base pose and a live physical grasp.
  const oldWorld=TB.world,position=RB.scene.chest.t.slice();$('playActor').value='teen';$('playActor').dispatchEvent(new Event('change'));await wait(200);
  assert(TB.world===oldWorld&&C.norm(C.sub(position,RB.scene.chest.t))<.005&&W.hands[1].grip,'switching to Eli preserves the scene and held object');
  d.t=C.add(d.t,[0,0,.15]);await wait(1400);const bowl=W.poseOf(TB.game.byKey.get('bowl')).t;d.t=C.sub(C.add(bowl,[0,0,.16]),offset);await wait(1900);d.open=1;
  await until(()=>TB.game.complete,'Eli finishes the first story job through physical grips',5000);
  assert(TASK.saved.bowl&&JSON.parse(localStorage.getItem('tag-tracker-story')).bowl&&!TASK.records.practice.bowl,'story results save independently of practice');
  $('taskNext').click();await wait(300);
  assert(TB.game.level.id==='precision'&&!TB.game.arrived&&TASK.nav.state.distance===0,'next room resets travel and starts a new small job');
  const walkStart=RB.scene.chest.t.slice();setInputMode('move');key('i',true);await wait(600);key('i',false);window.dispatchEvent(new Event('blur'));await wait(100);
  assert(C.norm(C.sub(walkStart,RB.scene.chest.t))>.1&&TASK.nav.state.v===0&&TASK.travelKeys.size===0,'Eli walks; losing focus stops walking');
  document.querySelector('[data-robot-view="eyes"]').click();await wait(100);
  const eye=plotOrbit().o.eye,expected=TaskCore.headCamera(RB.scene.chest,RB.scene.m,S.settings.robot.headTilt,plot.clientWidth,plot.clientHeight).eye;
  assert(C.norm(C.sub(eye,expected))<1e-10,'first-person camera follows the walking character');
  setCampaignMode('practice');await wait(200);taskLevel('laundry');await wait(350);
  assert(TB.world.cloths.length===3&&!TASK.nav,'practice retains the full laundry pile and unrestricted level selection');
  setCampaignMode('story');await wait(200);
  assert(TB.game.level.id==='precision'&&TB.game.level.cloths.length===0,'returning to story resumes at the next unlocked room');
  setRobotView('orbit');$('plot').scrollIntoView({block:'center'});
  assert(document.documentElement.scrollWidth<=innerWidth+1,'story layout fits the viewport');
  const actorCentre=plotOrbit().o.project(RB.scene.chest.t);
  assert(actorCentre && actorCentre[0]>0 && actorCentre[0]<plot.clientWidth,'the room overview keeps the character visible on narrow screens');
  return {passed:true,storyRoom:TB.game.level.story.room,avatar:S.settings.robot.actor,walked:true,physicalFirstJob:true,unlocks:true,viewport:[innerWidth,innerHeight]};
})()
