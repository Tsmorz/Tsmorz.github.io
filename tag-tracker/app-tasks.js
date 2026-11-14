// The campaign UI. Content is rendered from _data/tag_tasks.yml by Jekyll.
'use strict';
const TASK_DATA = JSON.parse($('teleopData').textContent);
const TASK = { saved: {}, painted: '', hand: '1', stored: false, moved: false };
try { TASK.saved = TaskCore.progress(JSON.parse(localStorage.getItem('tag-tracker-teleop') || '{}'), TASK_DATA.levels); } catch (_) { /* private browsing or an old record */ }
const currentTask = () => TASK_DATA.levels.find((l) => l.id === S.settings.robot.level) || TASK_DATA.levels[0];
const taskTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
function taskLevel(id) {
  if (!TASK_DATA.levels.some((l) => l.id === id)) return;
  S.settings.robot.level = id; S.settings.robot.props = 'arcade'; $('robotProps').value = 'arcade';
  saveSettings(); TB.n++; TB.drive.clear(); TB.grab = null; RB.prev.clear(); RB.slew.clear();
  paintRobotBtns(); paintTasks(true);
}
function paintTaskVisibility() {
  const robot = S.settings.show3d === 'robot';
  $('taskPanel').hidden = !robot || S.settings.robot.props !== 'arcade';
  document.body.classList.toggle('teleop-active', robot && S.settings.robot.props === 'arcade');
  $('robotPlayControls').hidden = !robot;
  if (!robot) $('taskLabels').replaceChildren();
}
function paintTasks(force) {
  const l = currentTask(), g = TB.game, active = g && g.level.id === l.id ? g : null;
  const sig = JSON.stringify([l.id, TASK.saved, active && active.steps, active && active.complete, active && Math.floor(active.elapsed), active && active.world.respawns]);
  if (!force && sig === TASK.painted) return;
  TASK.painted = sig;
  const catalogKey = JSON.stringify([l.id, TASK.saved]);
  if (catalogKey !== TASK.catalogKey) {
    TASK.catalogKey = catalogKey;
    $('taskLevels').innerHTML = TASK_DATA.levels.map((x, i) => {
      const p = TASK.saved[x.id], stars = p ? '★'.repeat(p.stars) + '☆'.repeat(3 - p.stars) : x.hands === 1 ? 'One hand' : 'Two hands';
      return `<button class="task-level" type="button" data-level="${x.id}"${x.id === l.id ? ' aria-current="step"' : ''} aria-label="Level ${i + 1}: ${escapeHtml(x.name)}, ${x.hands} hand${x.hands > 1 ? 's' : ''}${p ? ', ' + p.stars + ' stars' : ''}"><span class="task-num">${String(i + 1).padStart(2, '0')}</span><span>${escapeHtml(x.name)}</span><small>${stars}</small></button>`;
    }).join('');
    $('taskSelect').innerHTML = TASK_DATA.levels.map((x,i) => `<option value="${x.id}"${x.id === l.id ? ' selected' : ''}>${i+1}. ${escapeHtml(x.name)} (${x.hands} hand${x.hands > 1 ? 's' : ''})</option>`).join('');
  }
  $('taskOverall').textContent = `${Object.keys(TASK.saved).length} / ${TASK_DATA.levels.length} completed`;
  $('taskName').textContent = `${l.name} — ${l.skill}`; $('taskBrief').textContent = l.brief; $('taskHint').textContent = l.hint;
  $('taskGoals').innerHTML = l.goals.map((r, i) => `<span data-done="${!!(active && active.steps[i])}">${escapeHtml(r.label)}</span>`).join('');
  $('taskClock').textContent = `${taskTime(active ? active.elapsed : 0)} / target ${taskTime(l.par)}`;
  const text = active && active.complete ? `${'★'.repeat(active.stars)}${'☆'.repeat(3 - active.stars)} Level complete!` : active && active.dwell > 0 ? 'Hold steady…' : active && active.world.respawns ? `${active.world.respawns} dropped prop${active.world.respawns > 1 ? 's' : ''} returned. Keep going.` : 'Ready when you are.';
  if ($('taskStatus').textContent !== text) $('taskStatus').textContent = text;
  const p = TASK.saved[l.id]; $('taskBest').textContent = p ? `Best: ${p.stars} / 3 stars, ${taskTime(p.time)}` : '';
  $('taskNext').hidden = !(active && active.complete) || l === TASK_DATA.levels.at(-1);
}
function taskPlaced() {
  TASK.stored = false; TASK.moved = false;
  if (TB.game && S.settings.robot.view !== 'eyes') {
    const T = TB.world.table, d = C.mulv(T.R, [0.95, -0.7, 0.65]), dist = C.norm(d);
    Object.assign(S.view, { target: C.add(T.t, [0, 0, 0.10]), dist, yaw: Math.atan2(d[0], -d[1]), pitch: Math.asin(d[2] / dist), fitted: true, fromCam: false });
  }
  paintTasks(true);
}
function stepTask(dt) {
  const g = TB.game;
  const tagMovement = RB.scene && RB.scene.arms.some((a) => a.live && !a.idle && !RB.scene.preview && RB.cal);
  TaskCore.update(g, dt, TASK.moved || !!tagMovement || Object.values(g.world.hands).some((h) => !!h.grip));
  if (g.complete && !TASK.stored) {
    TASK.stored = true; TASK.saved[g.level.id] = TaskCore.best(TASK.saved[g.level.id], g);
    try { localStorage.setItem('tag-tracker-teleop', JSON.stringify(TASK.saved)); } catch (_) { robotSay('Level complete. This browser could not save the result.', true); }
  }
  paintTasks();
}
$('taskSelect').onchange = () => taskLevel($('taskSelect').value);
$('taskLevels').addEventListener('click', (e) => { const b = e.target.closest('[data-level]'); if (b) taskLevel(b.dataset.level); });
$('taskNext').onclick = () => { const n = TASK_DATA.levels.indexOf(currentTask()) + 1; if (TASK_DATA.levels[n]) taskLevel(TASK_DATA.levels[n].id); };
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
  TASK.moved = true;
}
function playGrasp(open) { for (const a of chosenHands()) driveOf(a).open = open; TASK.moved = true; }
function playTurn(sign) { for (const a of chosenHands()) { const d = driveOf(a); d.R = C.mul3(d.R, RCORE.Ry(sign * Math.PI / 36)); } TASK.moved = true; }
function playRoll(sign) { for (const a of chosenHands()) { const d = driveOf(a); d.R = C.mul3(d.R, C.rodrigues([0, 0, sign * Math.PI / 36])); } TASK.moved = true; }
function selectPlayHand(hand) {
  TASK.hand = hand;
  document.querySelectorAll('[data-hand]').forEach((x) => x.setAttribute('aria-checked', String(x.dataset.hand === hand)));
}
$('playHands').onclick = (e) => { const b = e.target.closest('[data-hand]'); if (b) selectPlayHand(b.dataset.hand); };
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
  const name = { w: 'forward', s: 'back', a: 'left', d: 'right', q: 'up', e: 'down' }[e.key.toLowerCase()];
  if (name) { e.preventDefault(); playNudge(name); }
  else if (e.key.toLowerCase() === 'u' || e.key.toLowerCase() === 'o') { e.preventDefault(); playRoll(e.key.toLowerCase() === 'u' ? -1 : 1); }
  else if (e.key.toLowerCase() === 'j' || e.key.toLowerCase() === 'k') { e.preventDefault(); playTurn(e.key.toLowerCase() === 'j' ? -1 : 1); }
});
paintTasks(true);

paintTaskVisibility();
