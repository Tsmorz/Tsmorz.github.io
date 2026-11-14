// The campaign UI. Content is rendered from _data/tag_tasks.yml by Jekyll.
'use strict';
const TASK_DATA = JSON.parse($('teleopData').textContent);
const taskCatalog = (mode = S.settings.robot.playMode) => mode === 'story' ? TASK_DATA.story.order.map(id => id === 'door' ? TASK_DATA.story.prologue : TASK_DATA.levels.find(l => l.id === id)) : TASK_DATA.levels;
const TASK = { saved: {}, records: { practice: {}, story: {} }, painted: '', hand: '1', stored: false, moved: false, inputMode: 'move', nav: null, travelKeys: new Set(), travelButtons: new Set() };
for (const mode of ['practice','story']) try { TASK.records[mode] = TaskCore.progress(JSON.parse(localStorage.getItem(mode === 'story' ? 'tag-tracker-story' : 'tag-tracker-teleop') || '{}'), taskCatalog(mode)); } catch (_) { /* storage unavailable */ }
const storyMode = () => S.settings.robot.props === 'arcade' && S.settings.robot.playMode === 'story';
const gameView = () => S.settings.show3d === 'robot' && S.settings.robot.props === 'arcade' && !TASK.tools;
const currentTask = () => TaskCore.mission(taskCatalog().find((l) => l.id === S.settings.robot.level) || taskCatalog()[0], S.settings.robot.playMode);
TASK.saved = TASK.records[S.settings.robot.playMode];
if (storyMode() && (taskCatalog().findIndex(l => l.id === S.settings.robot.level) < 0 || taskCatalog().findIndex(l => l.id === S.settings.robot.level) > TaskCore.unlocked(taskCatalog(),TASK.saved))) S.settings.robot.level = taskCatalog()[TaskCore.unlocked(taskCatalog(),TASK.saved)].id;
const taskTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
function taskLevel(id) {
  if (!taskCatalog().some((l) => l.id === id)) return;
  if (S.settings.robot.playMode === 'story' && taskCatalog().findIndex(l=>l.id===id) > TaskCore.unlocked(taskCatalog(),TASK.saved)) return;
  stopTravel(); TASK.destination = null; TASK.nav = null;
  S.settings.robot.level = id; S.settings.robot.props = 'arcade'; $('robotProps').value = 'arcade';
  setInputMode(storyMode() ? 'move' : 'hands'); saveSettings(); TB.n++; TB.drive.clear(); TB.grab = null; RB.prev.clear(); RB.slew.clear();
  paintRobotBtns(); paintTasks(true);
}
function paintTaskVisibility() {
  const robot = S.settings.show3d === 'robot';
  $('taskPanel').hidden = !robot || S.settings.robot.props !== 'arcade';
  document.body.classList.toggle('game-screen', gameView());
  $('gameHUD').hidden = !gameView(); $('backToGame').hidden = gameView() || !TASK.tools;
  document.body.classList.toggle('teleop-active', robot && S.settings.robot.props === 'arcade');
  $('robotPlayControls').hidden = !robot;
  $('travelControls').hidden = !robot || !storyMode();
  if (!robot) stopTravel();
  if (!robot) $('taskLabels').replaceChildren();
  if(TASK.controlHomes){mountGameControls();paintGameHUD();paintGameCamera();}
}
function paintTasks(force) {
  const l = currentTask(), g = TB.game, active = g && g.level.id === l.id ? g : null;
  const sig = JSON.stringify([l.id, S.settings.robot.playMode, S.settings.robot.actor, TASK.saved, active && active.arrived, active && active.steps, active && active.complete, active && Math.floor(active.elapsed), active && active.world.respawns]);
  if (!force && sig === TASK.painted) return;
  TASK.painted = sig;
  const catalogKey = JSON.stringify([l.id, S.settings.robot.playMode, TASK.saved]);
  if (catalogKey !== TASK.catalogKey) {
    TASK.catalogKey = catalogKey;
    const catalog=taskCatalog().map(l=>TaskCore.mission(l,S.settings.robot.playMode));
    $('taskLevels').innerHTML = catalog.map((x, i) => {
      const p = TASK.saved[x.id], stars = p ? '★'.repeat(p.stars) + '☆'.repeat(3 - p.stars) : x.hands === 1 ? 'One hand' : 'Two hands';
      const locked = storyMode() && i > TaskCore.unlocked(taskCatalog(), TASK.saved);
      return `<button ${locked ? 'disabled ' : ''}class="task-level" type="button" data-level="${x.id}"${x.id === l.id ? ' aria-current="step"' : ''} aria-label="Level ${i + 1}: ${escapeHtml(x.name)}, ${x.hands} hand${x.hands > 1 ? 's' : ''}${p ? ', ' + p.stars + ' stars' : ''}"><span class="task-num">${String(i + 1).padStart(2, '0')}</span><span>${escapeHtml(x.name)}</span><small>${stars}</small></button>`;
    }).join('');
    $('taskSelect').innerHTML = catalog.map((x,i) => `<option value="${x.id}"${storyMode() && i > TaskCore.unlocked(taskCatalog(),TASK.saved) ? ' disabled' : ''}${x.id === l.id ? ' selected' : ''}>${i+1}. ${escapeHtml(x.name)} (${x.hands} hand${x.hands > 1 ? 's' : ''})</option>`).join('');
  }
  $('taskOverall').textContent = `${Object.keys(TASK.saved).length} / ${taskCatalog().length} completed`;
  $('taskTitle').textContent = storyMode() ? TASK_DATA.story.title : TASK_DATA.title;
  $('taskSubtitle').textContent = storyMode() ? TASK_DATA.story.subtitle : TASK_DATA.subtitle;
  $('campaignIntro').hidden = !storyMode(); $('campaignIntro').textContent = TASK_DATA.story.intro;
  $('storyBeat').hidden = !storyMode();
  $('storyBeat').textContent = storyMode() ? (active && active.complete ? (l.id === taskCatalog().at(-1).id ? TASK_DATA.story.ending : l.story.outro) : l.story.room) : '';
  $('taskName').textContent = `${l.name} — ${l.skill}`; $('taskBrief').textContent = l.brief; $('taskHint').textContent = l.hint;
  $('taskGoals').innerHTML = (storyMode() ? `<span data-done="${!!(active && active.arrived)}">Reach the work spot</span>` : '') + l.goals.map((r, i) => `<span data-done="${!!(active && active.steps[i])}">${escapeHtml(r.label)}</span>`).join('');
  $('taskClock').textContent = `${taskTime(active ? active.elapsed : 0)} / target ${taskTime(l.par)}`;
  const text = active && active.complete ? `${'★'.repeat(active.stars)}${'☆'.repeat(3 - active.stars)} Level complete!` : active && active.dwell > 0 ? 'Hold steady…' : active && active.world.respawns ? `${active.world.respawns} dropped prop${active.world.respawns > 1 ? 's' : ''} returned. Keep going.` : 'Ready when you are.';
  if ($('taskStatus').textContent !== text) $('taskStatus').textContent = text;
  const p = TASK.saved[l.id]; $('taskBest').textContent = p ? `Best: ${p.stars} / 3 stars, ${taskTime(p.time)}` : '';
  $('taskNext').hidden = !(active && active.complete) || l.id === taskCatalog().at(-1).id;
}
function taskPlaced() {
  TASK.stored = false; TASK.moved = false;
  if (TB.game && S.settings.robot.view !== 'eyes') {
    const T = TB.world.table, d = C.mulv(T.R, storyMode() ? [-1.8, -1.8, 1.4] : [0.95, -0.7, 0.65]), dist = C.norm(d);
    Object.assign(S.view, { target: storyMode() && TASK.nav ? C.add(TASK.nav.anchor.t, [0,0,-.3]) : C.add(T.t, [0, 0, 0.10]), dist: dist * (storyMode() ? 1.3 * Math.max(1, plot.clientHeight / Math.max(1, plot.clientWidth)) : 1), yaw: Math.atan2(d[0], -d[1]), pitch: Math.asin(d[2] / dist), fitted: true, fromCam: false });
  }
  paintTasks(true); paintGameHUD();
}
function stepTask(dt) {
  const g = TB.game;
  if (storyMode() && TASK.nav) {
    const nav = TASK.nav;
    if (TravelCore.docked(nav.state,g.level.travel.dock) && nav.state.distance >= g.level.travel.minimum) g.arrived = true;
    const held = Object.values(g.world.hands).filter(h=>h.grip && h.grip.body.key === 'tray');
    if (held.length === 2) g.carryMeters += nav.delta;
    nav.delta = 0;
  }
  const tagMovement = RB.scene && RB.scene.arms.some((a) => a.live && !a.idle && !RB.scene.preview && RB.cal);
  TaskCore.update(g, dt, TASK.moved || !!(TASK.nav && TASK.nav.state.distance > .01) || !!tagMovement || Object.values(g.world.hands).some((h) => !!h.grip));
  if (g.complete && !TASK.stored) {
    TASK.stored = true; TASK.saved[g.level.id] = TaskCore.best(TASK.saved[g.level.id], g);
    try { localStorage.setItem(storyMode() ? 'tag-tracker-story' : 'tag-tracker-teleop', JSON.stringify(TASK.saved)); } catch (_) { robotSay('Level complete. This browser could not save the result.', true); }
  }
  paintTasks(); paintGameHUD();
}
$('taskSelect').onchange = () => taskLevel($('taskSelect').value);
$('taskLevels').addEventListener('click', (e) => { const b = e.target.closest('[data-level]'); if (b) taskLevel(b.dataset.level); });
$('taskNext').onclick = () => { const n = taskCatalog().findIndex(l=>l.id===currentTask().id) + 1; if (taskCatalog()[n]) taskLevel(taskCatalog()[n].id); };
// Goal outlines are geometry above the table, so WebGL depth testing treats them like everything else.
function markerList() {
  if (!TB.game) return [];
  const l = TB.game.level;
  if (l.markers) return l.markers;
  const keys = new Set();
  return l.goals.filter((r) => r.type === 'place' && !keys.has(r.at.slice(0, 2).join(',')) && keys.add(r.at.slice(0, 2).join(','))).map((r) => ({ at: [r.at[0], r.at[1], 0.001], size: l.id === 'tray' ? [0.19, 0.41] : l.id === 'dishwasher' ? [0.14, 0.035] : [0.06, 0.06], label: l.id === 'tower' ? 'A → B → C' : (TB.game.byKey.get(r.object).label || r.object) }));
}
function taskMarkers(bodies, compounds) {
  if (!TB.game) return;
  const T = TB.world.table;
  markerList().forEach((r, i) => {
    const [x, y] = r.size.map((v) => v / 2), z = 0.0007, key = '__target' + i;
    compounds[key] = [
      { type: 'box', p: [-x, 0, 0], h: [0.001, y, z] }, { type: 'box', p: [x, 0, 0], h: [0.001, y, z] },
      { type: 'box', p: [0, -y, 0], h: [x, 0.001, z] }, { type: 'box', p: [0, y, 0], h: [x, 0.001, z] },
    ];
    bodies.push({ key, R: T.R, t: C.add(T.t, C.mulv(T.R, r.at)), color: K.accent });
  });
}
function paintTaskLabels(o, w, h) {
  const el = $('taskLabels');
  if (!TB.game || gameView()) { if (el.childElementCount) el.replaceChildren(); return; }
  const W = TB.world, labels = [];
  for (const b of W.bodies) if (b.label) labels.push({ p: C.add(W.poseOf(b).t, [0, 0, b.kind === 'cup' ? 0.11 : b.kind === 'rack' ? 0.15 : b.kind === 'bowl' ? 0.08 : 0.045]), text: b.label });
  for (const c of W.cloths) { const p = c.nodes[Math.floor(c.nodes.length / 2)].p; labels.push({ p: C.add(p, [0, 0, 0.035]), text: c.label }); }
  for (const r of markerList()) labels.push({ p: C.add(W.table.t, C.mulv(W.table.R, [r.at[0], r.at[1] - r.size[1] / 2 - 0.015, 0.004])), text: r.label });
  el.innerHTML = labels.map((l) => { const p = o.project(l.p); return p && p[0] > 0 && p[0] < w && p[1] > 0 && p[1] < h ? `<span class="task-label" style="left:${p[0].toFixed(1)}px;top:${p[1].toFixed(1)}px">${escapeHtml(l.text)}</span>` : ''; }).join('');
}
function chosenHands() {
  const sc = RB.scene;
  if (!sc || S.settings.show3d !== 'robot') return [];
  const sides = TASK.hand === 'both' ? [1, -1] : [+TASK.hand];
  for (const side of sides) if (!sc.arms.some((a) => a.side === side)) sc.arms.push({ side, key: null, q: RCORE.HOME.slice(), reach: true, live: false, idle: true });
  return sc.arms.filter((a) => sides.includes(a.side));
}
function playNudge(name) {
  const moves = { forward: [1, 0, 0], back: [-1, 0, 0], left: [0, 1, 0], right: [0, -1, 0], up: [0, 0, 1], down: [0, 0, -1] };
  const sc = RB.scene, hs = chosenHands(); if (!sc || !hs.length) return;
  const local = moves[name], R = TB.world ? TB.world.table.R : sc.chest.R, delta = C.mulv(R, local.map((v) => v * 0.012));
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
function playTurn(sign) { for (const a of chosenHands()) { const d = driveOf(a); d.R = C.mul3(d.R, RCORE.Ry(sign * Math.PI / 36)); } TASK.moved = true; plot.focus({preventScroll:true}); }
function playRoll(sign) { for (const a of chosenHands()) { const d = driveOf(a); d.R = C.mul3(d.R, C.rodrigues([0, 0, sign * Math.PI / 36])); } TASK.moved = true; plot.focus({preventScroll:true}); }
function selectPlayHand(hand) {
  TASK.hand = hand;
  document.querySelectorAll('[data-hand]').forEach((x) => x.setAttribute('aria-checked', String(x.dataset.hand === hand)));
}
$('playHands').onclick = (e) => { const b = e.target.closest('[data-hand]'); if (b) { selectPlayHand(b.dataset.hand); plot.focus({preventScroll:true}); } };
$('playGrip').onclick = () => playGrasp(0); $('playRelease').onclick = () => playGrasp(1);
// A held key repeats at a controlled rate. All ways to lose a pointer or focus stop it.
let playRepeat = null;
function stopPlayRepeat() { clearInterval(playRepeat); playRepeat = null; }
for (const b of document.querySelectorAll('[data-nudge],[data-turn],[data-roll]')) {
  const act = () => b.dataset.nudge ? playNudge(b.dataset.nudge) : b.dataset.roll ? playRoll(+b.dataset.roll) : playTurn(+b.dataset.turn);
  b.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; e.preventDefault(); stopPlayRepeat(); act(); b.setPointerCapture(e.pointerId); playRepeat = setInterval(act, 100); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, stopPlayRepeat);
  b.addEventListener('click', (e) => { if (e.detail === 0) act(); });
}
window.addEventListener('blur', stopPlayRepeat); document.addEventListener('visibilitychange', () => { if (document.hidden) stopPlayRepeat(); });
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
  if (storyMode() && TASK.inputMode === 'move') return;
  const name = { w: 'forward', s: 'back', a: 'left', d: 'right', q: 'up', e: 'down' }[e.key.toLowerCase()];
  if (name) { e.preventDefault(); playNudge(name); }
  else if (e.key.toLowerCase() === 'u' || e.key.toLowerCase() === 'o') { e.preventDefault(); playRoll(e.key.toLowerCase() === 'u' ? -1 : 1); }
  else if (e.key.toLowerCase() === 'j' || e.key.toLowerCase() === 'k') { e.preventDefault(); playTurn(e.key.toLowerCase() === 'j' ? -1 : 1); }
});
paintActor(); paintCampaignMode(); paintTasks(true);

paintTaskVisibility();

// The body and all manual wrist targets travel together; held props follow through physical grip constraints.
function travelPose(chest,m,now) {
  if (!storyMode()) { TASK.nav = null; return chest; }
  const level = currentTask();
  if (!TASK.nav) TASK.nav = {state: TravelCore.create(level.travel), anchor: {R:(TASK.tagNeutral||chest).R.slice(),t:(TASK.tagNeutral||chest).t.slice()}, time:now, pose:null, delta:0};
  const nav=TASK.nav, keys=TASK.travelKeys, buttons=TASK.travelButtons;
  let forward=(keys.has('i')||buttons.has('forward')?1:0)-(keys.has('k')||buttons.has('back')?1:0);
  let turn=(keys.has('j')||buttons.has('left')?1:0)-(keys.has('l')||buttons.has('right')?1:0);
  let base=chest;
  if (RB.cal && !S.demo && RB.cal.roles.body !== null) {
    const tr=RB.last.get(RB.cal.roles.body),fresh=tr && now-tr.time<.3;
    if (!TASK.tagNeutral) TASK.tagNeutral={R:chest.R.slice(),t:chest.t.slice()};
    if (!forward && !turn && fresh && !document.hidden && !$('gameSettings').open) { const input=TravelCore.tagInput(TASK.tagNeutral,chest);forward=input.forward;turn=input.turn; }
    base=TASK.tagNeutral;
  }
  if (forward || turn) TASK.destination=null;
  if (TASK.destination && !forward && !turn) { const i=TravelCore.destination(nav.state,TASK.destination);forward=i.forward;turn=i.turn;if(!forward&&!turn)TASK.destination=null; }
  if (TASK.suspended || document.hidden || $('gameSettings').open) forward=turn=0;
  const dt=Math.max(0,Math.min(.05,now-nav.time));nav.time=now;
  const delta=TravelCore.step(nav.state,{forward,turn},dt,S.settings.robot.actor);nav.delta+=delta;
  const pose=C.compose(TravelCore.transform(nav.state,nav.anchor),base);
  if(nav.pose){const change=C.compose(pose,C.inverse(nav.pose));for(const d of TB.drive.values()){d.t=C.add(change.t,C.mulv(change.R,d.t));d.R=C.mul3(change.R,d.R);}}
  nav.pose=pose;
  const dock=level.travel.dock, near=TravelCore.docked(nav.state,dock), verb=S.settings.robot.actor==='teen'?'Walk':'Drive';
  const msg=nav.state.blocked?'Path blocked. Turn or reverse.':near?'At the workbench. Choose Hands to do the job.':`${verb} to the work spot: ${Math.hypot(nav.state.x-dock[0],nav.state.y-dock[1]).toFixed(1)} m`;
  if($('travelStatus').textContent!==msg)$('travelStatus').textContent=msg;
  return pose;
}
function stopTravel(){TASK.destination=null;TASK.travelKeys.clear();TASK.travelButtons.clear();if(TASK.nav){TASK.nav.state.v=0;TASK.nav.state.w=0;}}
function setInputMode(mode){TASK.inputMode=mode;stopTravel();document.querySelectorAll('[data-input-mode]').forEach(b=>b.setAttribute('aria-checked',String(b.dataset.inputMode===mode)));}
function paintCampaignMode(){document.querySelectorAll('[data-campaign-mode]').forEach(b=>b.setAttribute('aria-checked',String(b.dataset.campaignMode===S.settings.robot.playMode)));}
function setCampaignMode(mode){
  if(!['story','practice'].includes(mode))return;
  S.settings.robot.playMode=mode;TASK.saved=TASK.records[mode];TASK.catalogKey='';TASK.nav=null;stopTravel();
  const current=taskCatalog().findIndex(l=>l.id===S.settings.robot.level),open=TaskCore.unlocked(taskCatalog(),TASK.saved);
  if(current<0 || mode==='story'&&current>open)S.settings.robot.level=taskCatalog()[open].id;
  setInputMode(mode==='story'?'move':'hands');paintCampaignMode();taskLevel(S.settings.robot.level);
}
function paintActor(){const actor=TASK_DATA.story.actors.find(a=>a.id===S.settings.robot.actor)||TASK_DATA.story.actors[0];$('playActor').value=actor.id;$('actorDescription').textContent=actor.description;document.querySelector('[data-show3d="robot"]').textContent=actor.id==='teen'?'Character':'Robot';}
$('playActor').onchange=()=>{S.settings.robot.actor=$('playActor').value;stopTravel();paintActor();paintRobotBtns();saveSettings();};
$('campaignMode').onclick=e=>{const b=e.target.closest('[data-campaign-mode]');if(b)setCampaignMode(b.dataset.campaignMode);};
$('inputMode').onclick=e=>{const b=e.target.closest('[data-input-mode]');if(b){setInputMode(b.dataset.inputMode);plot.focus({preventScroll:true});}};
$('travelStop').onclick=stopTravel;
for(const b of document.querySelectorAll('[data-travel]')){
  b.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();TASK.travelButtons.add(b.dataset.travel);b.setPointerCapture(e.pointerId);plot.focus({preventScroll:true});});
  for(const ev of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(ev,()=>TASK.travelButtons.delete(b.dataset.travel));
  b.addEventListener('click',e=>{if(e.detail===0&&TASK.nav){TravelCore.step(TASK.nav.state,{forward:b.dataset.travel==='forward'?1:b.dataset.travel==='back'?-1:0,turn:b.dataset.travel==='left'?1:b.dataset.travel==='right'?-1:0},.1,S.settings.robot.actor);}});
}
plot.addEventListener('keydown',e=>{if(!storyMode()||TASK.inputMode!=='move'||e.ctrlKey||e.metaKey||e.altKey)return;const k={w:'i',s:'k',a:'j',d:'l',i:'i',j:'j',k:'k',l:'l'}[e.key.toLowerCase()];if(k){e.preventDefault();TASK.travelKeys.add(k);}});
plot.addEventListener('keyup',e=>TASK.travelKeys.delete({w:'i',s:'k',a:'j',d:'l',i:'i',j:'j',k:'k',l:'l'}[e.key.toLowerCase()]));
plot.addEventListener('blur',stopTravel);
window.addEventListener('blur',()=>{TASK.suspended=true;stopTravel();});window.addEventListener('focus',()=>{TASK.suspended=false;});document.addEventListener('visibilitychange',()=>{if(document.hidden)stopTravel();});
// Cutaway dollhouse: all furnishings sit outside the little path to the chore.
function storyDecoration(bodies,compounds){
  if(!storyMode()||!TASK.nav||!TB.world)return;
  const anchor=TASK.nav.anchor,f=TB.world.floorZ-anchor.t[2],d=currentTask().story.decor;
  const box=(p,h)=>({type:'box',p,h}),cyl=(p,r,h)=>({type:'cylinder',p,r,h});
  const put=(key,pieces,color,material)=>{key='__home_'+key;compounds[key]=pieces;bodies.unshift({key,R:anchor.R,t:anchor.t,color,material});};
  put('floor',[box([0,0,f-.025],[1.15,1.15,.025])],d.floor,'wood');
  put('walls',[box([1.17,0,f+.85],[.025,1.2,.85]),box([0,1.17,f+.85],[1.15,.025,.85])],d.wall,'plaster');
  put('trim',[box([1.138,0,f+.055],[.01,1.15,.055]),box([0,1.138,f+.055],[1.15,.01,.055]),box([1.138,0,f+1.68],[.012,1.15,.02]),box([0,1.138,f+1.68],[1.15,.012,.02])],'#efe5ce','wood');
  put('rug',[box([-.38,-.22,f+.004],[.52,.46,.004])],d.rug,'rug');
  put('rugborder',[box([-.38,-.645,f+.009],[.48,.014,.001]),box([-.38,.205,f+.009],[.48,.014,.001]),box([-.865,-.22,f+.009],[.014,.41,.001]),box([.105,-.22,f+.009],[.014,.41,.001])],'#d8bd91','fabric');
  // A framed landscape and a little family photograph on the back wall.
  put('frames',[box([-.52,1.126,f+1.15],[.24,.022,.19]),box([.1,1.126,f+1.21],[.13,.022,.16])],'#6b4932','wood');
  put('canvas',[box([-.52,1.1,f+1.15],[.218,.004,.168]),box([.1,1.1,f+1.21],[.108,.004,.138])],'#dccb94','plaster');
  put('land',[box([-.52,1.09,f+1.08],[.215,.003,.09]),cyl([.1,1.08,f+1.24],.035,.01)],'#718b69','fabric');
  // Window, deep wooden sill, linen curtains and a low sideboard.
  put('window',[box([1.13,.64,f+1.12],[.012,.25,.32])],'#b9d9df','plaster');
  put('windowframe',[box([1.107,.64,f+1.12],[.012,.012,.32]),box([1.107,.64,f+1.12],[.012,.25,.012]),box([1.08,.64,f+.79],[.07,.29,.025])],'#f0e4cb','wood');
  put('curtain',[-1,1].flatMap(k=>Array.from({length:6},(_,i)=>box([1.07+Math.sin(i*1.8)*.016,.64+k*(.205+i*.014),f+1.12],[.018,.014,.37]))),d.curtain,'fabric');
  put('sideboard',[box([.72,1,f+.26],[.34,.13,.22]),box([.72,.99,f+.5],[.36,.15,.025]),...[-1,1].flatMap(a=>[-1,1].map(b=>box([.72+a*.28,1+b*.09,f+.045],[.025,.025,.045])))],'#765138','wood');
  put('drawers',[box([.55,.861,f+.28],[.145,.006,.13]),box([.89,.861,f+.28],[.145,.006,.13])],'#986d49','wood');
  put('knobs',[box([.55,.845,f+.29],[.025,.014,.008]),box([.89,.845,f+.29],[.025,.014,.008])],'#ad9865','metal');
  put('plantpot',[cyl([.97,.96,f+.59],.055,.065)],'#aa6b50','plaster');
  put('plant',Array.from({length:7},(_,i)=>{const a=i*2.4;return box([.97+Math.cos(a)*.045,.96+Math.sin(a)*.045,f+.7+i*.009],[.035,.022,.028]);}),'#536d45','fabric');
  if(currentTask().id==='dishwasher'){
    const T=TB.world.table,p=C.add(T.t,C.mulv(T.R,[.015,-.16,-.34]));
    compounds.__appliance=[box([0,0,0],[.115,.15,.30]),box([-.121,0,.24],[.009,.15,.035])];bodies.push({key:'__appliance',R:T.R,t:p,color:'#b0b7b3',material:'metal'});
  }
  if(currentTask().id==='laundry'){
    put('basket',[box([.89,-.64,f+.12],[.16,.16,.12])],'#c1a87c','fabric');
    put('linens',[box([.89,-.64,f+.25],[.13,.13,.025]),box([.88,-.63,f+.3],[.12,.12,.025])],'#e2d4b5','fabric');
  }
  if(currentTask().id==='door'){
    const T=TB.world.table,door=TB.game.byKey.get('door'),p=TB.game.doorClosed||TB.world.poseOf(door);
    compounds.__doortrim=[box([0,-.414,.75],[.045,.026,.75]),box([0,.414,.75],[.045,.026,.75]),box([0,0,1.49],[.045,.44,.026])];bodies.push({key:'__doortrim',R:p.R,t:p.t,color:'#d8c5a0',material:'wood'});
    compounds.__doormat=[box([-.25,0,-.742],[.20,.30,.008])];bodies.push({key:'__doormat',R:T.R,t:T.t,color:'#735a43',material:'rug'});
  }
}
function paintGameHUD(){
  if(!gameView())return;
  const hudSig=JSON.stringify([S.settings.robot.level,S.settings.robot.playMode,S.settings.robot.actor,TB.game&&TB.game.complete,TB.game&&TB.game.knocks,TASK.saved,TB.drive.size,!!RB.cal,RGL&&RGL.characterReady,RGL&&RGL.characterError]);
  if(TASK.hudSig===hudSig)return;TASK.hudSig=hudSig;
  const l=currentTask(),g=TB.game,done=g&&g.level.id===l.id&&g.complete,ui=TASK_DATA.story.ui;
  $('gameChapter').textContent=storyMode()?`${ui.chapter} ${taskCatalog().findIndex(x=>x.id===l.id)+1} / ${taskCatalog().length} · ${l.story.room}`:TASK_DATA.title;
  $('gameTitle').textContent=l.name;
  const knock=g&&l.id==='door'?` (${Math.min(3,g.knocks)} / 3)`:'';
  $('gameObjective').textContent=(done?ui.finish:l.goals.map(r=>r.label).join(' · '))+knock;
  $('grandmaLine').textContent=storyMode()?(done?l.story.outro:l.brief):l.brief;
  $('grandmaName').textContent=storyMode()?ui.grandma:TASK_DATA.title;
  $('rewardToken').hidden=!done||!storyMode();$('rewardToken').dataset.kind=storyMode()?l.story.reward.kind:'';
  $('gameReward').hidden=!done||!storyMode();$('gameReward').textContent=done&&storyMode()?`${ui.reward} ${l.story.reward.label.toLocaleLowerCase()}`:'';
  $('gameNext').hidden=$('taskNext').hidden;
  $('gamePocket').textContent=storyMode()?taskCatalog().filter(l=>TASK.saved[l.id]).map(l=>l.story.reward.label).join(', ')||ui.empty:'';
  $('characterStatus').hidden=S.settings.robot.actor!=='teen'||!!(RGL&&RGL.characterReady);$('characterStatus').textContent=RGL&&RGL.characterError?RGL.characterError:TASK_DATA.story.ui.loading;
  $('gameTags').hidden=!TB.drive.size||!RB.cal;
}
$('gameNext').onclick=()=>$('taskNext').click();
$('gameTags').onclick=()=>$('tagsDriveBtn').click();
$('gameSettingsBtn').onclick=()=>{stopTravel();$('gameSettings').showModal();};
$('gameSettingsClose').onclick=()=>$('gameSettings').close();
$('gameSetupBtn').onclick=()=>{stopTravel();$('gameSettings').close();TASK.tools=true;paintTaskVisibility();openSetup(0);};
$('backToGame').onclick=()=>{TASK.tools=false;paintTaskVisibility();taskPlaced();};
$('gameEyes').onclick=()=>{const view=S.settings.robot.view==='eyes'?'orbit':'eyes';document.querySelector(`[data-robot-view="${view}"]`).click();paintGameCamera();};
$('gameTilt').onchange=()=>saveSettings();
$('gameTilt').oninput=()=>{$('headTilt').value=$('gameTilt').value;$('headTilt').dispatchEvent(new Event('input'));};
function paintGameCamera(){$('gameEyes').textContent=S.settings.robot.view==='eyes'?TASK_DATA.story.ui.outside:TASK_DATA.story.ui.eyes;$('gameEyes').setAttribute('aria-pressed',String(S.settings.robot.view==='eyes'));$('gameTilt').value=S.settings.robot.headTilt;}
// Keep every existing setup tool available behind one settings button, with the same handlers and IDs.
for(const node of [$('taskPanel'),$('robotPlayControls'),document.querySelector('.card3d>.card-h'),document.querySelector('.plot3d>.vbtns')]){
  const mark=document.createComment('game setup home');node.before(mark);TASK.controlHomes=TASK.controlHomes||[];TASK.controlHomes.push({node,mark});
}
function mountGameControls(){for(const {node,mark} of TASK.controlHomes){if(gameView())$('gameSettingsTools').append(node);else mark.after(node);}}
paintTaskVisibility();
function travelClick(e){
  if(!TASK.nav||!RB.view||!TB.world)return;
  const rect=plot.getBoundingClientRect(),o=RB.view,w=rect.width,h=rect.height,f=h/(2*Math.tan((o.fov||45)*Math.PI/360));
  const dx=(e.clientX-rect.left-w/2)/f,dy=-(e.clientY-rect.top-h/2)/f,ray=C.add(o.fwd,C.add(o.right.map(v=>v*dx),o.up.map(v=>v*dy))),den=ray[2];
  if(Math.abs(den)<1e-5)return;const t=(TB.world.floorZ-o.eye[2])/den;if(t<0)return;
  const world=C.add(o.eye,ray.map(v=>v*t)),local=C.mulv(C.tr3(TASK.nav.anchor.R),C.sub(world,TASK.nav.anchor.t));
  if(TravelCore.clear(local[0],local[1],TASK.nav.state.room,S.settings.robot.actor==='teen'?.18:.22)){TASK.destination=local.slice(0,2);TASK.moved=true;}
}
