// task shot -- /tag-tracker/ --eval-file script/tag-tracker/guided-browser.js
(async()=>{
  const wait=ms=>new Promise(r=>setTimeout(r,ms)),assert=(ok,msg)=>{if(!ok)throw new Error(msg);},until=async(fn,msg,ms=4500)=>{const start=performance.now();while(!fn()&&performance.now()-start<ms)await wait(40);assert(fn(),msg);};
  assert(S.settings.robot.actor==='robot'&&S.settings.robot.playMode==='guided'&&!window.CharacterCore,'the workbench starts robot-only without the human runtime');
  document.querySelectorAll('dialog[open]').forEach(d=>d.close());
  setCampaignMode('guided');taskLevel('sort');await wait(350);
  assert(TB.game.level.objects.length===2&&$('guidePlan').open&&$('guidePlanList').textContent.includes('same gripper'),'the two-block task immediately explains sequential one-gripper placement');
  assert(!document.querySelector('[data-level="laundry"]').disabled,'every task can be selected without story unlocks');
  assert($('taskLabels').textContent.includes('outline A')&&$('taskLabels').textContent.includes('outline B'),'both destinations have visible identities');
  assert(!/grandma|peppermint|teenage|candy/i.test(document.body.textContent),'the page contains no home story or rewards');
  const W=TB.world,g=TB.game,arm=RB.scene.arms.find(a=>a.side===1),d=driveOf(arm),G=RCORE.gripper(RB.scene.m),offset=C.mulv(d.R,[0,0,G.finger.c[2]]);
  for(const key of ['a','b']){
    const block=g.byKey.get(key),start=W.poseOf(block).t.slice(),r=g.level.goals.find(r=>r.object===key),at=C.add(W.table.t,C.mulv(W.table.R,r.at));
    d.open=1;d.t=C.sub(C.add(start,[0,0,.09]),offset);await wait(1200);d.t=C.sub(C.add(start,[0,0,.01]),offset);await wait(1100);d.open=0;
    await until(()=>W.hands[1].grip?.body===block,'the one selected gripper physically grasps '+key+': '+JSON.stringify({pose:W.handPose(1),block:block.t,guide:TASK.guide,reach:RB.scene.arms.find(a=>a.side===1).reach}));
    await until(()=>TASK.guide.object===key&&TASK.guide.state==='lift','the lift hint follows the actual grasp of '+key);
    d.t=C.add(d.t,[0,0,.13]);await wait(1300);
    assert(W.poseOf(block).t[2]>start[2]+.07&&TASK.guide.state==='move','the held block lifts before the hint asks for horizontal travel');
    d.t=C.sub(C.add(at,[0,0,.13]),offset);await wait(1600);
    assert(TASK.guide.state==='lower','being over the correct outline prompts lowering '+key);
    d.t=C.sub(C.add(at,[0,0,.013]),offset);await wait(1400);
    assert(TASK.guide.state==='release','the held block on its outline still needs to be released');d.open=1;
    await until(()=>g.steps[g.level.goals.findIndex(r=>r.object===key)],'a released '+key+' settles on its own target');
    if(key==='a'){await until(()=>TASK.guide.state==='clear','the release hint prevents knocking A while reaching for B');d.t=C.add(d.t,[0,0,.12]);await wait(1200);await until(()=>TASK.guide.object==='b'&&$('guideText').textContent.includes('B'),'after clearing A, the hint explicitly advances to B');}
  }
  await until(()=>g.complete,'one gripper completes the two-block placement');
  assert(g.heldBy.get('a').size===1&&g.heldBy.get('b').size===1&&g.heldBy.get('a').has(1)&&g.heldBy.get('b').has(1)&&TASK.guide.state==='done','both blocks used the same physical gripper and receive a clear completion cue');
  assert(JSON.parse(localStorage.getItem('tag-tracker-guided')).sort,'the guided result saves');
  $('gameEyes').click();$('gameTilt').value=-45;$('gameTilt').dispatchEvent(new Event('input'));await wait(100);
  const eye=plotOrbit().o.eye,expected=TaskCore.headCamera(RB.scene.chest,RB.scene.m,-45,plot.clientWidth,plot.clientHeight).eye;
  assert(C.norm(C.sub(eye,expected))<1e-8,'the tilting robot head camera is retained');setRobotView('orbit');
  setCampaignMode('practice');await wait(250);assert(TB.game.level.objects.length===3&&$('guidePlanList').textContent.includes('C'),'the full three-block challenge and matching instructions remain');
  for(const l of TASK_DATA.levels){taskLevel(l.id);await wait(l.id==='laundry'?450:100);assert(TB.game.level.id===l.id&&TASK.guide&&$('guideTitle').textContent,'each full task loads with guidance');}
  assert(TB.world.cloths.length===1,'the full challenge contains the long-sleeve shirt');
  setCampaignMode('guided');taskLevel('sort');await wait(300);assert(TB.game.level.objects.length===2&&!TB.game.complete,'switching back restores the small two-block exercise');
  $('gameSettingsBtn').click();assert(!$('handControls')&&!document.querySelector('[data-nudge]'),'the obsolete hand command bar is removed');$('gameSettingsClose').click();
  assert(document.documentElement.scrollWidth<=innerWidth+1,'the layout fits the viewport');
  return {passed:true,robotOnly:true,twoBlocksOneGripper:true,liveHints:true,headCamera:true,fullChallenges:true,viewport:[innerWidth,innerHeight]};
})()
