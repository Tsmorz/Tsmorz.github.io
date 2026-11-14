// The campaign UI. Content is rendered from _data/tag_tasks.yml by Jekyll.
'use strict';
const TASK_DATA = JSON.parse($('teleopData').textContent);
const TASK = { saved: {}, records: { practice: {}, story: {} }, painted: '', hand: '1', stored: false, moved: false, inputMode: 'move', nav: null, travelKeys: new Set(), travelButtons: new Set() };
for (const mode of ['practice','story']) try { TASK.records[mode] = TaskCore.progress(JSON.parse(localStorage.getItem(mode === 'story' ? 'tag-tracker-story' : 'tag-tracker-teleop') || '{}'), TASK_DATA.levels); } catch (_) { /* storage unavailable */ }
const storyMode = () => S.settings.robot.props === 'arcade' && S.settings.robot.playMode === 'story';
const currentTask = () => TaskCore.mission(TASK_DATA.levels.find((l) => l.id === S.settings.robot.level) || TASK_DATA.levels[0], S.settings.robot.playMode);
TASK.saved = TASK.records[S.settings.robot.playMode];
if (storyMode() && TASK_DATA.levels.findIndex(l => l.id === S.settings.robot.level) > TaskCore.unlocked(TASK_DATA.levels,TASK.saved)) S.settings.robot.level = TASK_DATA.levels[TaskCore.unlocked(TASK_DATA.levels,TASK.saved)].id;
const taskTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
function taskLevel(id) {
  if (!TASK_DATA.levels.some((l) => l.id === id)) return;
  if (S.settings.robot.playMode === 'story' && TASK_DATA.levels.findIndex(l=>l.id===id) > TaskCore.unlocked(TASK_DATA.levels,TASK.saved)) return;
  stopTravel(); TASK.nav = null;
  S.settings.robot.level = id; S.settings.robot.props = 'arcade'; $('robotProps').value = 'arcade';
  setInputMode(storyMode() ? 'move' : 'hands'); saveSettings(); TB.n++; TB.drive.clear(); TB.grab = null; RB.prev.clear(); RB.slew.clear();
  paintRobotBtns(); paintTasks(true);
}
function paintTaskVisibility() {
  const robot = S.settings.show3d === 'robot';
  $('taskPanel').hidden = !robot || S.settings.robot.props !== 'arcade';
  document.body.classList.toggle('teleop-active', robot && S.settings.robot.props === 'arcade');
  $('robotPlayControls').hidden = !robot;
  $('travelControls').hidden = !robot || !storyMode();
  if (!robot) stopTravel();
  if (!robot) $('taskLabels').replaceChildren();
}
function paintTasks(force) {
  const l = currentTask(), g = TB.game, active = g && g.level.id === l.id ? g : null;
  const sig = JSON.stringify([l.id, S.settings.robot.playMode, S.settings.robot.actor, TASK.saved, active && active.arrived, active && active.steps, active && active.complete, active && Math.floor(active.elapsed), active && active.world.respawns]);
  if (!force && sig === TASK.painted) return;
  TASK.painted = sig;
  const catalogKey = JSON.stringify([l.id, S.settings.robot.playMode, TASK.saved]);
  if (catalogKey !== TASK.catalogKey) {
    TASK.catalogKey = catalogKey;
    $('taskLevels').innerHTML = TASK_DATA.levels.map((x, i) => {
      const p = TASK.saved[x.id], stars = p ? '★'.repeat(p.stars) + '☆'.repeat(3 - p.stars) : x.hands === 1 ? 'One hand' : 'Two hands';
      const locked = storyMode() && i > TaskCore.unlocked(TASK_DATA.levels, TASK.saved);
      return `<button ${locked ? 'disabled ' : ''}class="task-level" type="button" data-level="${x.id}"${x.id === l.id ? ' aria-current="step"' : ''} aria-label="Level ${i + 1}: ${escapeHtml(x.name)}, ${x.hands} hand${x.hands > 1 ? 's' : ''}${p ? ', ' + p.stars + ' stars' : ''}"><span class="task-num">${String(i + 1).padStart(2, '0')}</span><span>${escapeHtml(x.name)}</span><small>${stars}</small></button>`;
    }).join('');
    $('taskSelect').innerHTML = TASK_DATA.levels.map((x,i) => `<option value="${x.id}"${storyMode() && i > TaskCore.unlocked(TASK_DATA.levels,TASK.saved) ? ' disabled' : ''}${x.id === l.id ? ' selected' : ''}>${i+1}. ${escapeHtml(x.name)} (${x.hands} hand${x.hands > 1 ? 's' : ''})</option>`).join('');
  }
  $('taskOverall').textContent = `${Object.keys(TASK.saved).length} / ${TASK_DATA.levels.length} completed`;
  $('taskTitle').textContent = storyMode() ? TASK_DATA.story.title : TASK_DATA.title;
  $('taskSubtitle').textContent = storyMode() ? TASK_DATA.story.subtitle : TASK_DATA.subtitle;
  $('campaignIntro').hidden = !storyMode(); $('campaignIntro').textContent = TASK_DATA.story.intro;
  $('storyBeat').hidden = !storyMode();
  $('storyBeat').textContent = storyMode() ? (active && active.complete ? (l.id === TASK_DATA.levels.at(-1).id ? TASK_DATA.story.ending : l.story.outro) : l.story.room) : '';
  $('taskName').textContent = `${l.name} — ${l.skill}`; $('taskBrief').textContent = l.brief; $('taskHint').textContent = l.hint;
  $('taskGoals').innerHTML = (storyMode() ? `<span data-done="${!!(active && active.arrived)}">Reach the work spot</span>` : '') + l.goals.map((r, i) => `<span data-done="${!!(active && active.steps[i])}">${escapeHtml(r.label)}</span>`).join('');
  $('taskClock').textContent = `${taskTime(active ? active.elapsed : 0)} / target ${taskTime(l.par)}`;
  const text = active && active.complete ? `${'★'.repeat(active.stars)}${'☆'.repeat(3 - active.stars)} Level complete!` : active && active.dwell > 0 ? 'Hold steady…' : active && active.world.respawns ? `${active.world.respawns} dropped prop${active.world.respawns > 1 ? 's' : ''} returned. Keep going.` : 'Ready when you are.';
  if ($('taskStatus').textContent !== text) $('taskStatus').textContent = text;
  const p = TASK.saved[l.id]; $('taskBest').textContent = p ? `Best: ${p.stars} / 3 stars, ${taskTime(p.time)}` : '';
  $('taskNext').hidden = !(active && active.complete) || l.id === TASK_DATA.levels.at(-1).id;
}
function taskPlaced() {
  TASK.stored = false; TASK.moved = false;
  if (TB.game && S.settings.robot.view !== 'eyes') {
    const T = TB.world.table, d = C.mulv(T.R, storyMode() ? [1.7, -1.7, 1.25] : [0.95, -0.7, 0.65]), dist = C.norm(d);
    Object.assign(S.view, { target: storyMode() && TASK.nav ? C.add(TASK.nav.anchor.t, [0,0,-.3]) : C.add(T.t, [0, 0, 0.10]), dist: dist * (storyMode() ? Math.max(1, plot.clientHeight / Math.max(1, plot.clientWidth)) : 1), yaw: Math.atan2(d[0], -d[1]), pitch: Math.asin(d[2] / dist), fitted: true, fromCam: false });
  }
  paintTasks(true);
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
  paintTasks();
}
$('taskSelect').onchange = () => taskLevel($('taskSelect').value);
$('taskLevels').addEventListener('click', (e) => { const b = e.target.closest('[data-level]'); if (b) taskLevel(b.dataset.level); });
$('taskNext').onclick = () => { const n = TASK_DATA.levels.findIndex(l=>l.id===currentTask().id) + 1; if (TASK_DATA.levels[n]) taskLevel(TASK_DATA.levels[n].id); };
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
  if (!TB.game) { if (el.childElementCount) el.replaceChildren(); return; }
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
  $('headTilt').value = S.settings.robot.headTilt; $('headTiltValue').textContent = `${Math.round(S.settings.robot.headTilt)}°`;
}
setHeadTilt(S.settings.robot.headTilt);
$('headTilt').oninput = () => setHeadTilt(+$('headTilt').value); $('headTilt').onchange = () => saveSettings();
function setRobotView(view) {
  S.settings.robot.view = view;
  if (typeof saveSettings === 'function') saveSettings();
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
  if (!TASK.nav) TASK.nav = {state: TravelCore.create(level.travel), anchor: {R:chest.R.slice(),t:chest.t.slice()}, time:now, pose:null, delta:0};
  const nav=TASK.nav, keys=TASK.travelKeys, buttons=TASK.travelButtons;
  const forward=(keys.has('i')||buttons.has('forward')?1:0)-(keys.has('k')||buttons.has('back')?1:0);
  const turn=(keys.has('j')||buttons.has('left')?1:0)-(keys.has('l')||buttons.has('right')?1:0);
  const dt=Math.max(0,Math.min(.05,now-nav.time));nav.time=now;
  const delta=TravelCore.step(nav.state,{forward,turn},dt,S.settings.robot.actor);nav.delta+=delta;
  const pose=C.compose(TravelCore.transform(nav.state,nav.anchor),chest);
  if(nav.pose){const change=C.compose(pose,C.inverse(nav.pose));for(const d of TB.drive.values()){d.t=C.add(change.t,C.mulv(change.R,d.t));d.R=C.mul3(change.R,d.R);}}
  nav.pose=pose;
  const dock=level.travel.dock, near=TravelCore.docked(nav.state,dock), verb=S.settings.robot.actor==='teen'?'Walk':'Drive';
  const msg=nav.state.blocked?'Path blocked. Turn or reverse.':near?'At the workbench. Choose Hands to do the job.':`${verb} to the work spot: ${Math.hypot(nav.state.x-dock[0],nav.state.y-dock[1]).toFixed(1)} m`;
  if($('travelStatus').textContent!==msg)$('travelStatus').textContent=msg;
  return pose;
}
function stopTravel(){TASK.travelKeys.clear();TASK.travelButtons.clear();if(TASK.nav){TASK.nav.state.v=0;TASK.nav.state.w=0;}}
function setInputMode(mode){TASK.inputMode=mode;stopTravel();document.querySelectorAll('[data-input-mode]').forEach(b=>b.setAttribute('aria-checked',String(b.dataset.inputMode===mode)));}
function paintCampaignMode(){document.querySelectorAll('[data-campaign-mode]').forEach(b=>b.setAttribute('aria-checked',String(b.dataset.campaignMode===S.settings.robot.playMode)));}
function setCampaignMode(mode){
  if(!['story','practice'].includes(mode))return;
  S.settings.robot.playMode=mode;TASK.saved=TASK.records[mode];TASK.catalogKey='';TASK.nav=null;stopTravel();
  const current=TASK_DATA.levels.findIndex(l=>l.id===S.settings.robot.level),open=TaskCore.unlocked(TASK_DATA.levels,TASK.saved);
  if(mode==='story'&&current>open)S.settings.robot.level=TASK_DATA.levels[open].id;
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
window.addEventListener('blur',stopTravel);document.addEventListener('visibilitychange',()=>{if(document.hidden)stopTravel();});
function storyDecoration(bodies,compounds){
  if(!storyMode()||!TASK.nav||!TB.world)return;
  const nav=TASK.nav,anchor=nav.anchor,floor=TB.world.floorZ-anchor.t[2];
  compounds.__room=TravelCore.roomGeometry(nav.state.room,floor);
  bodies.unshift({key:'__room',R:anchor.R,t:anchor.t,color:K.well});
  const dock=currentTask().travel.dock,x=dock[0],y=dock[1];
  compounds.__dock=[{type:'box',p:[x-.14,y, floor+.002],h:[.003,.17,.001]},{type:'box',p:[x+.14,y,floor+.002],h:[.003,.17,.001]},{type:'box',p:[x,y-.17,floor+.002],h:[.14,.003,.001]},{type:'box',p:[x,y+.17,floor+.002],h:[.14,.003,.001]}];
  bodies.push({key:'__dock',R:anchor.R,t:anchor.t,color:K.accent});
}
