// Robot task UI. Every instruction and hint comes from _data/tag_tasks.yml.
'use strict';
const TASK_DATA=JSON.parse($('teleopData').textContent);
const taskCatalog=()=>TASK_DATA.levels;
const SCORE={rows:TaskScores.clean(store.get('task-scores',[])),player:TaskScores.player(store.get('task-player','Player 1'))};
const TASK={saved:{},painted:'',hand:'1',trackingView:S.settings.show3d,stored:false,moved:false,guide:null};
try{TASK.saved=TaskCore.progress(JSON.parse(localStorage.getItem('tag-tracker-tasks')||'{}'),taskCatalog());}catch(_){/* storage unavailable */}
if(!taskCatalog().some(l=>l.id===S.settings.robot.level))S.settings.robot.level='bowl';
const gameView=()=>S.settings.show3d==='robot'&&S.settings.robot.props==='arcade'&&S.tab==='tasks';
const currentTask=()=>TaskCore.mission(taskCatalog().find(l=>l.id===S.settings.robot.level)||taskCatalog()[0],S.settings.robot.playMode);
const taskTime=t=>`${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}`;
function taskLevel(id){
  if(!taskCatalog().some(l=>l.id===id))return;
  S.settings.robot.level=id;S.settings.robot.props='arcade';
  resetTaskRobot();
  TASK.guide=null;TASK.notice=null;TASK.hudSig='';TASK.moved=false;TB.n++;selectPlayHand('1');
  saveSettings();paintRobotBtns();paintTasks(true);
}
function paintTaskVisibility(){
  const robot=S.settings.show3d==='robot';
  $('taskPanel').hidden=!gameView();$('robotPlayControls').hidden=!robot;
  document.body.classList.toggle('teleop-active',gameView());document.body.classList.toggle('game-screen',gameView());
  $('gameHUD').hidden=!gameView();
  if(!robot)$('taskLabels').replaceChildren();
  paintGameHUD();paintGameCamera();
}
function paintTasks(force){
  const l=currentTask(),g=TB.game,active=g&&g.level.id===l.id?g:null;
  const sig=JSON.stringify([l.id,S.settings.robot.playMode,TASK.saved,active&&active.steps,active&&active.complete,active&&Math.floor(active.elapsed),active&&active.world.respawns]);
  if(!force&&sig===TASK.painted)return;TASK.painted=sig;
  const catalogKey=JSON.stringify([l.id,S.settings.robot.playMode,TASK.saved]);
  if(catalogKey!==TASK.catalogKey){
    TASK.catalogKey=catalogKey;const catalog=taskCatalog().map(l=>TaskCore.mission(l,S.settings.robot.playMode));
    $('taskLevels').innerHTML=catalog.map((x,i)=>`<button class="task-level" type="button" data-level="${x.id}"${x.id===l.id?' aria-current="step"':''}><span class="task-num">${i+1}</span><span>${escapeHtml(x.name)}</span><small>${x.hands===1?TASK_DATA.ui.one_gripper:TASK_DATA.ui.two_grippers}</small></button>`).join('');
    const options=catalog.map((x,i)=>`<option value="${x.id}"${x.id===l.id?' selected':''}>${i+1}. ${escapeHtml(x.name)}</option>`).join('');
    $('taskSelect').innerHTML=options;$('workbenchTask').innerHTML=options;
  }
  $('taskTitle').textContent=TASK_DATA.title;$('taskSubtitle').textContent=TASK_DATA.subtitle;$('taskOverall').textContent=`${Object.keys(TASK.saved).length} / ${taskCatalog().length} completed`;
  $('taskName').textContent=l.name;$('taskBrief').textContent=l.brief;$('taskHint').textContent=l.hint;
  $('taskGoals').innerHTML=l.goals.map((r,i)=>`<span data-done="${!!(active&&active.steps[i])}">${escapeHtml(r.label)}</span>`).join('');
  $('taskClock').textContent=taskTime(active?active.elapsed:0);
  $('taskStatus').textContent=active&&active.complete?TASK_DATA.ui.finish:active&&active.dwell?'Hold steady…':'';
  const best=TASK.saved[l.id];$('taskBest').textContent=best?`Best: ${best.stars} / 3 stars, ${taskTime(best.time)}`:'';
  $('taskNext').hidden=!(active&&active.complete)||l.id===taskCatalog().at(-1).id;
}
function taskPlaced(){
  TASK.stored=false;TASK.moved=false;TASK.guide=null;TASK.hudSig='';
  if(TB.game&&S.settings.robot.view!=='eyes'){
    const T=TB.world.table,d=C.mulv(T.R,TB.game.level.camera?.offset||[1.05,-.95,.78]),dist=C.norm(d);
    Object.assign(S.view,{target:C.add(T.t,C.mulv(T.R,TB.game.level.camera?.at||[0,0,.09])),dist:dist*Math.max(1,plot.clientHeight/Math.max(1,plot.clientWidth)),yaw:Math.atan2(d[0],-d[1]),pitch:Math.asin(d[2]/dist),fitted:true,fromCam:false});
  }
  paintTasks(true);paintGameHUD();paintLeaderboard();
}
function stepTask(dt){
  const g=TB.game,tagMovement=RB.scene&&RB.scene.arms.some(a=>a.live&&!a.idle&&!RB.scene.preview&&RB.cal);
  // Something off the table ends the attempt: restart at once and say why.
  const dropped=!g.complete&&TaskCore.fallen(g);
  if(dropped){resetTable();TASK.notice={text:TASK_DATA.ui.fell.replace('{prop}',dropped),until:performance.now()+6000};TASK.hudSig='';paintGameHUD();paintNotice();return;}
  TaskCore.update(g,dt,TASK.moved||!!tagMovement||Object.values(g.world.hands).some(h=>!!h.grip),performance.now()/1000);
  $('gameClock').textContent=TaskScores.format(g.elapsed);
  TASK.guide=TaskCore.guidance(g);
  if(g.complete&&!TASK.stored){
    TASK.stored=true;SCORE.rows=TaskScores.record(SCORE.rows,g.level,S.settings.robot.playMode,SCORE.player,g.elapsed);store.set('task-scores',SCORE.rows);paintLeaderboard();TASK.saved[g.level.id]=TaskCore.best(TASK.saved[g.level.id],g);
    try{localStorage.setItem('tag-tracker-tasks',JSON.stringify(TASK.saved));}catch(_){robotSay('Task complete. This browser could not save the result.',true);}
  }
  paintTasks();paintGameHUD();paintNotice();
}
function paintNotice(){const el=$('guideNotice'),on=!!TASK.notice&&performance.now()<TASK.notice.until;if(el.hidden===!on&&(!on||el.textContent===TASK.notice.text))return;el.hidden=!on;el.textContent=on?TASK.notice.text:'';}
$('taskSelect').onchange=()=>taskLevel($('taskSelect').value);$('workbenchTask').onchange=()=>taskLevel($('workbenchTask').value);
$('taskLevels').onclick=e=>{const b=e.target.closest('[data-level]');if(b)taskLevel(b.dataset.level);};
$('taskNext').onclick=()=>{const next=taskCatalog()[taskCatalog().findIndex(l=>l.id===currentTask().id)+1];if(next)taskLevel(next.id);};
function markerList(){
  if(!TB.game)return [];
  const l=TB.game.level;if(l.markers)return l.markers;
  const seen=new Set();return l.goals.filter(r=>{
    const at=r.at||(r.target?TB.game.local(TB.world.poseOf(TB.game.byKey.get(r.target)).t):null);if(!at)return false;
    const key=at.slice(0,2).join(',');if(seen.has(key))return false;seen.add(key);return true;
  }).map(r=>({object:r.object,at:r.at?[r.at[0],r.at[1],.001]:TB.game.local(TB.world.poseOf(TB.game.byKey.get(r.target)).t),size:r.target?[.20,.20]:l.id==='tray'?[.19,.41]:l.id==='dishwasher'?[.14,.035]:l.id==='tower'?[.15,.11]:l.id==='laundry'?[.16,.16]:[.06,.06],label:r.destination||r.target||r.object.toUpperCase()+' target'}));
}
function taskMarkers(bodies,compounds){
  if(!TB.game)return;const T=TB.world.table;
  markerList().forEach((r,i)=>{
    const [x,y]=r.size.map(v=>v/2),z=.0007,key='__target'+i,active=TASK.guide&&TASK.guide.at&&Math.hypot(r.at[0]-TASK.guide.at[0],r.at[1]-TASK.guide.at[1])<.025,th=active?.002:.001;
    compounds[key]=[{type:'box',p:[-x,0,0],h:[th,y,z]},{type:'box',p:[x,0,0],h:[th,y,z]},{type:'box',p:[0,-y,0],h:[x,th,z]},{type:'box',p:[0,y,0],h:[x,th,z]}];
    bodies.push({key,R:T.R,t:C.add(T.t,C.mulv(T.R,r.at)),color:active?K.accent:K.muted});
  });
}
function benchDecoration(bodies,compounds){
  if(!gameView()||!TB.world||!RB.scene)return;
  const ch=TB.world.table,z=TB.world.floorZ-ch.t[2];compounds.__benchfloor=[{type:'box',p:[.2,0,z-.025],h:[1.25,1.25,.025]}];
  bodies.unshift({key:'__benchfloor',R:ch.R,t:ch.t,color:K.well,material:'plaster'});
}
function paintTaskLabels(o,w,h){
  const el=$('taskLabels');if(!TB.game||!tableShown()){if(el.childElementCount)el.replaceChildren();return;}
  const W=TB.world,labels=[],pour=TB.game.pour,state=TASK.guide?.state;
  // The pour's markers: the full stein's handle to grab, then the empty stein's rim to pour into.
  if(pour){const S=TaskCore.STEIN,B=TaskCore.BOTTLE,names=TB.game.level.guide.labels,at=(b,p)=>{const q=W.poseOf(b);return C.add(q.t,C.mulv(q.R,p));},from=pour.from.body,to=pour.to.body;
    // where to grab: a bottle's neck, a stein's handle; and the opening to pour into
    if(['pour_grab','pour_handle'].includes(state))labels.push({p:at(from,from.kind==='bottle'?[0,0,B.grip]:[S.handle.x,0,S.handle.z1]),text:names.grab,active:true,pin:'grab',key:from.key});
    if(['pour_move','pour_tilt'].includes(state))labels.push({p:at(to,[0,0,to.kind==='bottle'?B.H:S.H]),text:names.target,active:true,pin:'target',key:to.key});}
  const marked=new Set(labels.map(l=>l.key));
  for(const b of W.bodies)if(b.label&&!marked.has(b.key)&&(TB.game.level.goals.some(r=>r.object===b.key)||(TB.game.level.objects||[]).some(s=>s.key===b.key&&s.show_label)))labels.push({p:C.add(W.poseOf(b).t,[0,0,b.kind==='cup'?.11:b.kind==='rack'?.15:b.kind==='bowl'?.08:b.kind==='stein'?.12:b.kind==='bottle'?.25:.045]),text:b.label,active:TASK.guide&&TASK.guide.object===b.key});
  for(const cloth of W.cloths)if(cloth.kind==='shirt'){
    const state=TASK.guide?.state,names=TB.game.level.guide.labels;
    const target=state==='shirt_fold';
    const points=state==='shirt_left'?[[cloth.landmarks.cuffs[0],names.left_cuff]]:state==='shirt_right'?[[cloth.landmarks.cuffs[1],names.right_cuff]]:state==='shirt_hem'?cloth.landmarks.hem.map(i=>[i,names.hem]):target?cloth.landmarks.shoulders.map(i=>[i,names.target]):[];
    for(const [i,text] of points)labels.push({p:C.add(cloth.nodes[i].p,C.mulv(W.table.R,[0,0,.018])),text,active:true,pin:target?'target':'grab'});
  }
  for(const cloth of W.cloths)if(cloth.kind==='towel'&&TB.game.level.goals.some(r=>r.type==='fold'&&r.folds===2)){
    const second=cloth.foldStage===1,state=TASK.guide?.state,names=TB.game.level.guide.labels;
    // One marker per corner still to take, on its exact grab point; destinations only once both are held.
    const up=C.mulv(W.table.R,[0,0,cloth.halfThickness+cloth.pile]);
    if(['towel_first_grab','towel_second_grab','towel_layers','towel_tidy'].includes(state))for(const handle of ClothCore.handles(cloth))if(!cloth.pins.has(String(handle.side)))labels.push({p:C.add(handle.point,up),text:second?names.second:names.first,active:true,pin:'grab'});
    if(['towel_first_move','towel_second_move'].includes(state))for(const handle of ClothCore.handles(cloth))labels.push({p:C.add(handle.target,up),text:names.target,active:true,pin:'target'});
  }
  // While the towel's corner markers show, they are the only thing to aim at: the pad's own label would cover one.
  if(!labels.some(l=>l.pin))for(const r of markerList())labels.push({p:C.add(W.table.t,C.mulv(W.table.R,[r.at[0],r.at[1]-r.size[1]/2-.02,.004])),text:r.label,active:TASK.guide&&TASK.guide.at&&Math.hypot(r.at[0]-TASK.guide.at[0],r.at[1]-TASK.guide.at[1])<.025});
  el.innerHTML=labels.map(l=>{const p=o.project(l.p);return p&&p[0]>0&&p[0]<w&&p[1]>0&&p[1]<h?`<span class="task-label" data-active="${!!l.active}"${l.pin?` data-pin="${l.pin}"`:''} style="left:${p[0].toFixed(1)}px;top:${p[1].toFixed(1)}px">${escapeHtml(l.text)}</span>`:'';}).join('');
}
function chosenHands() {
  const sc = RB.scene;
  if (!sc || S.settings.show3d !== 'robot') return [];
  const sides = TASK.hand === 'both' ? [1, -1] : [+TASK.hand];
  for (const side of sides) if (!sc.arms.some((a) => a.side === side)) sc.arms.push({ side, key: null, q: RCORE.HOME.slice(), reach: true, live: false, idle: true });
  return sc.arms.filter((a) => sides.includes(a.side));
}
function playNudge(name,fine=false) {
  const moves = { forward: [1, 0, 0], back: [-1, 0, 0], left: [0, 1, 0], right: [0, -1, 0], up: [0, 0, 1], down: [0, 0, -1] };
  const sc = RB.scene, hs = chosenHands(); if (!sc || !hs.length) return;
  const local = moves[name], R = TB.world ? TB.world.table.R : sc.chest.R, delta = C.mulv(R, local.map((v) => v * (fine?.0002:.012) * S.settings.robot.scale));
  // Both share the same displacement. Stop both at the first reach limit, preserving their separation.
  let fraction = 1;
  for (const a of hs) {
    const d = driveOf(a), desired = C.add(d.t, delta), loc = C.mulv(C.tr3(sc.chest.R), C.sub(desired, sc.chest.t)), limited = RCORE.inReach(sc.m, a.side, loc);
    if (C.norm(C.sub(loc, limited)) > 0.001) fraction = 0;
  }
  let shiftAll = [0, 0, 0];
  for (const a of hs) {
    const d = driveOf(a), p = C.add(d.t, C.mulv(d.R, [0, 0, RCORE.gripper(sc.m).finger.c[2]]));
    const want = C.add(p, C.add(delta.map((v) => v * fraction), shiftAll));
    const rec = TB.world && TB.world.record, ph = TB.world && TB.world.handPose(a.side);
    if (rec && ph) shiftAll = C.add(shiftAll, PHYS.holdBack(rec.hands[a.side], C.add(ph.t, C.mulv(ph.R, [0, 0, RCORE.gripper(sc.m).finger.c[2]])), want));
  }
  const move = C.add(delta.map((v) => v * fraction), shiftAll);
  for (const a of hs) { const d = driveOf(a); d.t = C.add(d.t, move); }
  TASK.moved = true; plot.focus({preventScroll:true});
}
function playGrasp(open) { for (const a of chosenHands()) driveOf(a).open = open; TASK.moved = true; plot.focus({preventScroll:true}); }
function playTurn(sign,fine=false,sideways=false) { for (const a of chosenHands()) { const d = driveOf(a); d.R = C.mul3(d.R, RCORE[sideways?'Rx':'Ry'](sign * (fine?.002:Math.PI/36))); } TASK.moved = true; plot.focus({preventScroll:true}); }
function playRoll(sign,fine=false) { for (const a of chosenHands()) { const d = driveOf(a); d.R = C.mul3(d.R, C.rodrigues([0, 0, sign * (fine?.002:Math.PI/36)])); } TASK.moved = true; plot.focus({preventScroll:true}); }
function selectPlayHand(hand) {
  TASK.hand = hand;
  document.querySelectorAll('[data-hand]').forEach((x) => x.setAttribute('aria-checked', String(x.dataset.hand === hand)));
}
function setHeadTilt(degrees) {
  S.settings.robot.headTilt = Math.min(25, Math.max(-80, degrees));
  $('gameTilt').value = S.settings.robot.headTilt; $('headTilt').value = S.settings.robot.headTilt; $('headTiltValue').textContent = `${Math.round(S.settings.robot.headTilt)}°`;
}
setHeadTilt(S.settings.robot.headTilt);
$('headTilt').oninput = () => setHeadTilt(+$('headTilt').value); $('headTilt').onchange = () => saveSettings();
function setRobotView(view) {
  S.settings.robot.view = view;
  if (typeof saveSettings === 'function') saveSettings();
  paintGameCamera();
  document.querySelectorAll('[data-robot-view]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.robotView === view)));
}
$('robotViewControl').onclick = (e) => { const b = e.target.closest('[data-robot-view]'); if (b) setRobotView(b.dataset.robotView); };
setRobotView(S.settings.robot.view);
plot.addEventListener('keydown', (e) => {
  if (S.settings.show3d !== 'robot' || e.ctrlKey || e.metaKey || e.altKey) return;
  const arrows = S.settings.robot.view === 'eyes' ? { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' } : {};
  const name = arrows[e.key] || { w: 'forward', s: 'back', a: 'left', d: 'right', q: 'up', e: 'down' }[e.key.toLowerCase()];
  if (['1', '2', '3'].includes(e.key)) { e.preventDefault(); selectPlayHand({ 1: '1', 2: '-1', 3: 'both' }[e.key]); }
  if (name) { e.preventDefault(); playNudge(name,e.shiftKey); }
  else if (e.key.toLowerCase() === 'u' || e.key.toLowerCase() === 'o') { e.preventDefault(); playRoll(e.key.toLowerCase() === 'u' ? -1 : 1,e.shiftKey); }
  else if (e.key.toLowerCase() === 'i' || e.key.toLowerCase() === 'p') { e.preventDefault(); playTurn(e.key.toLowerCase() === 'i' ? -1 : 1,e.shiftKey,true); }
  else if (e.key.toLowerCase() === 'j' || e.key.toLowerCase() === 'k') { e.preventDefault(); playTurn(e.key.toLowerCase() === 'j' ? -1 : 1,e.shiftKey); }
});
function paintGameHUD(){
  if(!gameView())return;
  const l=currentTask(),g=TB.game,guide=TASK.guide||{state:'approach',index:0,object:l.goals[0].object},done=g&&g.level.id===l.id&&g.complete;
  const sig=JSON.stringify([l.id,S.settings.robot.playMode,guide,g&&g.steps,done,TB.drive.size,!!RB.cal]);if(sig===TASK.hudSig)return;TASK.hudSig=sig;
  const names={object:g&&g.byKey.get(guide.object)?.label||guide.object,target:l.goals[guide.index]?.destination||g&&g.byKey.get(guide.target)?.label||'target',held:g&&g.byKey.get(guide.held)?.label||guide.held,next:g&&g.byKey.get(guide.next)?.label||guide.next};
  const format=s=>s.replace(/\{(\w+)\}/g,(_,key)=>names[key]||key),text=l.guide.stages?.[guide.state]||TASK_DATA.guidance.stages[guide.state];
  $('gameChapter').textContent=`${TASK_DATA.ui.task} ${taskCatalog().findIndex(x=>x.id===l.id)+1} / ${taskCatalog().length}`;
  $('gameTitle').textContent=l.name;$('gameObjective').textContent=l.brief;
  $('guideTitle').textContent=format(text.title);$('guideText').textContent=format(text.text);
  $('guideGoals').innerHTML=l.goals.map((r,i)=>`<li data-done="${!!(g&&g.steps[i])}" data-active="${i===guide.index}">${escapeHtml(r.label)}</li>`).join('');
  const planKey=l.id+S.settings.robot.playMode;if(TASK.planKey!==planKey){TASK.planKey=planKey;$('guidePlanList').innerHTML=l.guide.plan.map(p=>`<li>${escapeHtml(p)}</li>`).join('');$('guideTipsList').innerHTML=l.guide.tips.map(p=>`<li>${escapeHtml(p)}</li>`).join('');$('guidePlan').open=l.id==='sort'||l.id==='laundry';}
  $('gameNext').hidden=$('taskNext').hidden;$('gameTags').hidden=!TB.drive.size||!RB.cal;
}
$('gameNext').onclick=()=>$('taskNext').click();$('guideRestart').onclick=()=>resetTable();$('gameTags').onclick=()=>$('tagsDriveBtn').click();
$('gameEyes').onclick=()=>setRobotView(S.settings.robot.view==='eyes'?'orbit':'eyes');
$('gameTilt').onchange=()=>saveSettings();$('gameTilt').oninput=()=>setHeadTilt(+$('gameTilt').value);
function paintGameCamera(){$('gameEyes').textContent=S.settings.robot.view==='eyes'?TASK_DATA.ui.outside:TASK_DATA.ui.eyes;$('gameEyes').setAttribute('aria-pressed',String(S.settings.robot.view==='eyes'));$('gameTilt').value=S.settings.robot.headTilt;$('gameTiltField').hidden=S.settings.robot.view!=='eyes';$('headTilt').closest('label').hidden=S.settings.robot.view!=='eyes';}
paintTasks(true);paintTaskVisibility();

// Haptics follow the task's physical contact record, never a canned level animation.
const TASK_HAPTIC=TaskHaptics.dispatcher();
let taskHapticSettings=TaskHaptics.settings(store.get('task-haptics',{})),taskHapticPaint=0;
store.set('task-haptics',taskHapticSettings);
$('taskHapticStrength').value=taskHapticSettings.level;
function setTaskHaptics(on){taskHapticSettings.enabled=!!on;store.set('task-haptics',taskHapticSettings);TASK_HAPTIC.reset();paintHapticsBtn();}
function paintHapticsBtn(){const on=taskHapticSettings.enabled!==false,b=$('gameHaptics'),value=taskHapticSettings.level+'%';b.textContent=TASK_DATA.ui.haptics+' '+value;$('taskHapticLevel').textContent=value;b.setAttribute('aria-pressed',String(on));b.classList.toggle('primary',on);b.classList.toggle('outline',!on);}
$('gameHaptics').onclick=()=>setTaskHaptics(taskHapticSettings.enabled===false);paintHapticsBtn();
// The Controller panel: connect boards from the task screen and choose which hand's cues each one plays.
$('gameController').onclick=()=>{const p=$('controllerPanel');p.hidden=!p.hidden;$('gameController').setAttribute('aria-expanded',String(!p.hidden));paintControllerPanel(true);};
$('ctlClose').onclick=()=>{$('controllerPanel').hidden=true;$('gameController').setAttribute('aria-expanded','false');$('gameController').focus();};
$('ctlBle').onclick=()=>addBoard();$('ctlSerial').onclick=()=>addSerialBoard();
let controllerSig='';
function paintControllerPanel(force){
  const boards=S.boards.filter(b=>!b.sim),live=boards.filter(b=>b.state==='live').length;
  $('gameControllerCount').textContent=live?`(${live})`:'';$('gameController').classList.toggle('primary',live>0);$('gameController').classList.toggle('outline',!live);
  const sig=JSON.stringify(boards.map(b=>[b.id,b.name,b.state,b.hapticSide,b.transport==='capture'&&captureControlState(b)]));if(!force&&sig===controllerSig)return;controllerSig=sig;
  $('ctlBoards').innerHTML=boards.map(b=>`<div class="ctl-board" data-id="${escapeHtml(b.id)}"><strong title="${escapeHtml(b.name)}">${escapeHtml(b.name)}</strong><span class="small muted">${escapeHtml(b.state)}</span><label class="field">${escapeHtml(TASK_DATA.ui.controller_hand)} <select class="select sm">${['auto','1','-1','off'].map((v,i)=>`<option value="${v}"${b.hapticSide===v?' selected':''}>${escapeHtml(TASK_DATA.haptics.sides[i])}</option>`).join('')}</select></label><button class="btn sm outline" data-test-haptic>${escapeHtml(TASK_DATA.haptics.test)}</button></div>`).join('');
  $('ctlBoards').querySelectorAll('[data-test-haptic]').forEach(button=>{button.onclick=()=>testBoardHaptics(S.boards.find(b=>b.id===button.closest('.ctl-board').dataset.id));});
  $('ctlBoards').querySelectorAll('.ctl-board').forEach(row=>{
    const b=S.boards.find(b=>b.id===row.dataset.id);if(b.transport!=='capture')return;
    row.querySelector('label').firstChild.textContent=TASK_DATA.link.capture_hand+' ';
    const controls=document.createElement('div');controls.className='row';
    controls.innerHTML=`<button class="btn sm outline" data-capture-zero>${escapeHtml(TASK_DATA.link.capture_zero)}</button><button class="btn sm outline" data-capture-stop${b.captureControl?.neutral?'':' hidden'}>${escapeHtml(TASK_DATA.link.capture_stop)}</button><span class="small muted">${escapeHtml(captureControlState(b))}</span>`;
    controls.querySelector('[data-capture-zero]').onclick=()=>zeroCaptureOrientation(b);
    controls.querySelector('[data-capture-stop]').onclick=()=>stopCaptureOrientation(b);row.append(controls);
  });
  $('ctlBoards').querySelectorAll('.ctl-board select').forEach(sel=>{sel.onchange=()=>{const b=S.boards.find(x=>x.id===sel.closest('.ctl-board').dataset.id);if(!b)return;b.captureControl?.clear();b.hapticSide=sel.value;boardStore.save(b);renderBoards();controllerSig='';};});
}
$('taskHapticStrength').oninput=()=>{taskHapticSettings.level=TaskHaptics.level(+$('taskHapticStrength').value);$('taskHapticStrength').value=taskHapticSettings.level;store.set('task-haptics',taskHapticSettings);paintHapticsBtn();};
function sendTaskHaptics(W,sc,now){
  TASK_HAPTIC.tick({boards:S.boards,world:W,arms:sc.arms,now,enabled:taskHapticSettings.enabled!==false,level:taskHapticSettings.level,active:!document.hidden&&!V.rec&&!V.boardTake&&!V.opening&&!S.boards.some(b=>b.audioClosing)&&document.hasFocus()&&S.settings.robot.props==='arcade'&&!$('setupDlg').open&&!$('settingsDlg').open});
  if(now-taskHapticPaint<250)return;taskHapticPaint=now;
  const live=S.boards.filter(b=>!b.sim&&b.state==='live'),ready=live.filter(b=>b.act?.tachammerReady&&now-b.actT<500&&(b.transport!=='capture'||b.motion?.ready)),last=ready.map(b=>b.hapticLast).filter(x=>x&&now-x.at<750),text=!taskHapticSettings.enabled?TASK_DATA.haptics.off:!live.length?TASK_DATA.haptics.disconnected:!ready.length?(live.some(b=>b.transport==='capture'&&!b.motion?.ready)?TASK_DATA.haptics.calibrating:TASK_DATA.haptics.unavailable):last.length?TASK_DATA.haptics.sent:TASK_DATA.haptics.ready;
  $('ctlStatus').textContent=live.some(b=>b.hapticError)?TASK_DATA.haptics.error:text;paintControllerPanel();
}
window.addEventListener('blur',()=>TASK_HAPTIC.reset());

$('taskPlayer').value=SCORE.player;
$('taskPlayer').onchange=()=>{SCORE.player=TaskScores.player($('taskPlayer').value);$('taskPlayer').value=SCORE.player;store.set('task-player',SCORE.player);paintLeaderboard();};
function paintLeaderboard(){
  const rows=TaskScores.ranking(SCORE.rows,currentTask(),S.settings.robot.playMode);
  $('leaderboardRows').innerHTML=rows.length?rows.map((r,i)=>`<tr${r.player===SCORE.player?' aria-current="true"':''}><td>${i+1}</td><th scope="row">${escapeHtml(r.player)}</th><td>${TaskScores.format(r.seconds)}</td></tr>`).join(''):`<tr><td colspan="3">${escapeHtml(TASK_DATA.scores.empty)}</td></tr>`;
  const previous=TASK.saved[currentTask().id];$('taskFastest').textContent=rows.length?`${TASK_DATA.scores.best} ${TaskScores.format(rows[0].seconds)}`:previous?`${TASK_DATA.scores.previous} ${TaskScores.format(previous.time)}`:TASK_DATA.scores.empty;
}


async function testBoardHaptics(b){
  const note=$('ctlConnectionStatus'),now=performance.now(),ch=b?.hapticCharacteristic;
  if(b?.transport==='capture'&&!b.motion?.ready){note.textContent=TASK_DATA.link.capture_still;return;}
  if(!taskHapticSettings.enabled||S.tab!=='tasks'||document.hidden||!document.hasFocus()||!b||b.sim||b.state!=='live'||!['1','-1'].includes(b.hapticSide)||!b.act?.tachammerReady||now-b.actT>=500||!ch){note.textContent=TASK_DATA.haptics.test_unavailable;return;}
  if(b.hapticBusy||ch.busy)return;
  b.hapticBusy=true;
  try{const bytes=TaskHaptics.packet(taskHapticSettings.level,1);await(ch.writeValueWithResponse?ch.writeValueWithResponse(bytes):ch.writeValue(bytes));if(b.hapticCharacteristic===ch){b.hapticError=null;note.textContent=TASK_DATA.haptics.test_sent.replace('{level}',String(bytes[3]));}}
  catch(e){note.textContent=e.message;}
  finally{if(b.hapticCharacteristic===ch)b.hapticBusy=false;}
}
