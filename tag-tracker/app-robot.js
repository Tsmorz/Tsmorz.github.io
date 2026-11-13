// Tag tracker page, part of index.html's script: the robot and the table.
// The app-*.js files are classic scripts loaded in order and share one global scope; nothing in them runs
// another file's code at load (the boot script at the end of index.html starts everything).
'use strict';

// ---------------- the robot ----------------
// The 3D view's robot (RobotCore): its chest follows the Body track and each arm's wrist the track on that side, the
// joint angles found by inverse kinematics. Until Calibrate robot is pressed it stands in its start pose (arms at the
// sides, forearms forward, palms in) wherever the tags are; pressing it fixes how each tag sits on the robot, as a
// tare does. It reads the plotted poses (in the chosen frame) with any tare taken off, so taring never moves it.
const RCORE = window.RobotCore;
const RB = { cal: null, last: new Map(), seen: new Set(), prev: new Map(), jhist: new Map(), slew: new Map(), slewT: 0, scene: null, pts: [], msg: '', msgWarn: false, msgT: 0, hintT: 0, jointsT: 0, autoDone: false, fitSig: '', fhist: new Map(), view: null, viewW: 0 };
// the table (below): its physics world, the hands moved with the mouse
const PHYS = window.PhysicsCore;
const TABLE = { size: [0.5, 0.9], thick: 0.03, legs: 0.72 };
const TB = { world: null, sig: '', t: 0, n: 0, drive: new Map(), grab: null, lastSide: null, ptr: null, hover: null };
// The table's contacts as sound (sound.js), off until turned on (the speaker button, M, or "sound on"). It goes quiet
// while the microphone listens for a voice command or note, and while the page is hidden.
const SND = window.ContactSound ? ContactSound.create() : null;
function duckSound() { if (SND) SND.set({ duck: document.hidden || !!V.rec || V.opening }); }
function setSound(on) {
  S.settings.robot.sound = !!on; saveSettings();
  if (SND) SND.set({ on: !!on });
  paintRobotBtns();
  return !SND ? 'No sound in this browser' : on ? 'Sound on' : 'Sound off';
}
if (SND && S.settings.robot.sound) SND.set({ on: true }); // (the browser lets it play once the page is clicked)
for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, () => { if (SND) SND.resume(); }, { capture: true });
document.addEventListener('visibilitychange', () => duckSound());
function robotReset() { RB.cal = null; RB.last.clear(); RB.seen.clear(); RB.prev.clear(); RB.jhist.clear(); RB.slew.clear(); RB.autoDone = false; RB.fitSig = ''; paintRobotBtns(); }
const refKeyNow = () => (S.settings.frame === 'camera' ? null : parseKey(S.settings.frame));
// the newest plotted pose of every track, untared; a track out of view keeps its last one
function robotTake() {
  for (const k of S.hist.ids()) {
    const s = S.hist.latest(k), old = RB.last.get(k);
    if (!s || (old && old.time === s.time)) continue;
    const R0 = S.tare.get(k);
    RB.last.set(k, { time: s.time, R: R0 ? C.mul3(R0, s.R) : s.R, t: s.t });
    RB.seen.add(k);
  }
}
// Which track is the body and which the arms: Settings, or Auto. Auto's body is the one named Body, Chest or Torso
// (else, with three tracks, the highest); its arms are the others, each taking the side of the body it is on when
// calibrated (side null). Only tracks seen since the page opened (or the frame changed) count. A role set to a tag that
// is part of an object is that object. The demo's scene is fixed, so it always has its own roles (tag 2 is the chest and
// the hand cubes are the arms), whatever the setup guide or Settings chose for real tags.
const robotSet = () => (S.demo ? { ...S.settings.robot, body: '2', left: 'auto', right: 'auto' } : S.settings.robot);
function roleTrack(v, keys) {
  if (v === 'auto' || v === 'none') return null;
  const k = keys.find((x) => String(x) === v);
  if (k !== undefined) return k;
  const obj = /^\d+$/.test(v) ? S.bodies.find((b) => b.members.some((m) => m.id === +v)) : null;
  return obj && keys.includes('b:' + obj.id) ? 'b:' + obj.id : null;
}
function robotRoles() {
  const r = robotSet(), ref = refKeyNow(), keys = trackKeys().filter((k) => k !== ref && RB.seen.has(k));
  const pick = (v) => roleTrack(v, keys);
  let body = r.body === 'none' ? null : r.body === 'auto' ? keys.find((k) => /\b(body|chest|torso)\b/i.test(nameOf(k))) ?? null : pick(r.body);
  const sides = [[r.left, 1], [r.right, -1]], used = new Set();
  if (body !== null) used.add(body);
  const arms = [];
  for (const [v, side] of sides) { const k = pick(v); if (k !== null && !used.has(k)) { arms.push({ key: k, side }); used.add(k); } }
  const auto = sides.filter(([v]) => v === 'auto').map(([, side]) => side);
  let rest = keys.filter((k) => !used.has(k));
  if (r.body === 'auto' && body === null && rest.length >= 3 && auto.length === 2) {
    body = rest.reduce((a, b) => (RB.last.get(b).t[2] > RB.last.get(a).t[2] ? b : a));
    rest = rest.filter((k) => k !== body);
  }
  rest.slice(0, auto.length).forEach((k) => arms.push({ key: k, side: auto.length === 2 ? null : auto[0] }));
  return { body, arms };
}
const robotSig = () => [...RB.seen].sort(keySort).join(',') + '|' + ['body', 'left', 'right'].map((k) => robotSet()[k]).join(',') + '|' + S.settings.frame;
// where camera 1 is in the plotted frame, if known (the robot faces it when there is no body tag)
function cameraInPlot() {
  if (S.settings.frame === 'camera') return [0, 0, 0];
  const ref = steadyRef(), c1 = S.cams[0];
  return ref ? shown(c1 && c1.T ? c1.T : { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] }, ref).t : null;
}
function robotCalibrate(roles, m) {
  const body = roles.body !== null ? RB.last.get(roles.body) : null;
  const arms = roles.arms.map((a) => ({ key: a.key, pose: RB.last.get(a.key), side: a.side }));
  // one arm and no body: the side its name says ("left" or "right"; else the right)
  if (!body && arms.length === 1 && arms[0].side === null) arms[0].side = /\bleft\b/i.test(nameOf(arms[0].key)) ? 1 : -1;
  return RCORE.calibrate(m, { body, arms }, { toward: cameraInPlot() });
}
function robotSay(text, warn) { RB.msg = text; RB.msgWarn = !!warn; RB.msgT = performance.now() + 5000; RB.hintT = 0; }
function calibrateRobot(quiet) {
  robotTake();
  const now = performance.now() / 1000, roles = robotRoles();
  if (!roles.arms.length && roles.body === null) { robotSay('Show your tags to the camera first.', true); return 'No tags in view'; }
  const missing = [roles.body, ...roles.arms.map((a) => a.key)].filter((k) => k !== null && !(now - RB.last.get(k).time < 0.5));
  if (missing.length) {
    robotSay(`${missing.map(nameOf).join(' and ')} ${missing.length > 1 ? 'aren’t' : 'isn’t'} in view. Hold still with every tag in view, then calibrate.`, true);
    return 'Not every tag is in view';
  }
  RB.cal = { cal: robotCalibrate(roles, RCORE.model(S.settings.robot)), roles, sig: robotSig() };
  RB.prev.clear(); TB.drive.clear(); TB.n++; paintRobotBtns();
  if (!quiet) robotSay('Calibrated. The robot follows you now; calibrate again whenever it drifts.');
  return 'Robot calibrated';
}
function clearRobotCal() { RB.cal = null; RB.prev.clear(); paintRobotBtns(); }
function paintRobotBtns() {
  const on = S.settings.show3d === 'robot';
  $('robotCalBtn').hidden = !on; $('robotClearBtn').hidden = !on || !RB.cal; $('scaleField').hidden = !on;
  const table = on && S.settings.robot.props !== 'off';
  $('propsField').hidden = !on; $('tableResetBtn').hidden = !table; $('tagsDriveBtn').hidden = !on || !TB.drive.size;
  $('forcesField').hidden = !table; $('soundBtn').hidden = !table || !SND;
  const snd = S.settings.robot.sound;
  $('soundBtn').setAttribute('aria-pressed', String(snd)); $('soundBtn').classList.toggle('primary', snd); $('soundBtn').classList.toggle('outline', !snd);
  $('soundBtn').innerHTML = `<svg class="i"><use href="#i-${snd ? 'sound' : 'mute'}"/></svg>`;
  $('soundBtn').title = snd ? 'Sound is on: the table\'s knocks, rolls and scrapes. Turn it off (or press M)' : 'Sound is off. Turn it on to hear the table\'s knocks, rolls and scrapes (or press M)';
  document.querySelectorAll('.help .rob-only').forEach((x) => { x.hidden = !on; });
  $('robotCalBtn').classList.toggle('primary', !RB.cal); $('robotCalBtn').classList.toggle('outline', !!RB.cal);
  $('robotCalBtn').textContent = RB.cal ? 'Calibrate again' : 'Calibrate robot';
}
$('robotCalBtn').onclick = () => calibrateRobot();
// the motion scale: any saved value is offered, even one not in the list
function paintScale() {
  const v = S.settings.robot.scale, sel = $('robotScale');
  if (![...sel.options].some((x) => +x.value === v)) sel.add(new Option(String(v), String(v)));
  sel.value = [...sel.options].find((x) => +x.value === v).value;
}
paintScale();
$('robotScale').onchange = () => { S.settings.robot.scale = +$('robotScale').value; saveSettings(); RB.prev.clear(); };
$('robotClearBtn').onclick = clearRobotCal;
plot.addEventListener('keydown', (e) => { if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey && !e.altKey && S.settings.show3d === 'robot') { e.preventDefault(); calibrateRobot(); } });

// The robot this frame: the chest's pose and each arm's joint angles. With no tracks yet it is a preview, standing
// in its start pose a little way in front of the camera.
function robotUpdate(now) {
  robotTake();
  const sig = robotSig();
  if (RB.cal && RB.cal.sig !== sig) clearRobotCal(); // a new track, or new roles: calibrate again
  const roles = RB.cal ? RB.cal.roles : robotRoles(), m = RCORE.model(S.settings.robot);
  const fresh = (k) => k !== null && RB.last.has(k) && now - RB.last.get(k).time < 0.5;
  const preview = roles.body === null && !roles.arms.length;
  // the demo lines the robot up by itself, once, when it sees the body and both hands while they rest in the start pose
  if (S.demo && S.demo.atHome() && !RB.cal && !RB.autoDone && roles.body !== null && roles.arms.length === 2 && [roles.body, ...roles.arms.map((a) => a.key)].every(fresh)) {
    RB.autoDone = true; calibrateRobot(true);
    return robotUpdate(now);
  }
  let cal = RB.cal && RB.cal.cal;
  if (!cal && preview) {
    const at = S.settings.frame === 'camera' ? [0, 1.6, 0] : [0, -0.6, 0];
    cal = { chest: { R: RCORE.upright(S.settings.frame === 'camera' ? [0, -1, 0] : [0, 1, 0]), t: at }, bodyOffset: null, arms: [] };
  } else if (!cal) cal = robotCalibrate(roles, m);
  const poses = { body: roles.body !== null ? RB.last.get(roles.body) : null, arms: {} };
  for (const a of roles.arms) poses.arms[a.key] = RB.last.get(a.key);
  const tg = RCORE.targets(cal, poses, { scale: S.settings.robot.scale }), prefer = S.settings.robot.elbows ? undefined : false;
  const arms = tg.arms.map((a) => {
    const prev = RB.prev.get(a.key), s = RCORE.ik(m, a.side, a.target, prev && prev.side === a.side ? prev : null, { prefer });
    RB.prev.set(a.key, { q: s.q, elbow: s.elbow, psi: s.psi, side: a.side });
    // each new pose's joint angles, for the Joint angles plot (the arm's side kept, so a recalibration that swaps sides shows)
    const ts = RB.last.get(a.key).time, h = RB.jhist.get(a.key) || [];
    if (!h.length || h[h.length - 1].time !== ts) { h.push({ time: ts, q: s.q.slice(), side: a.side }); while (h.length && h[0].time < ts - S.settings.span - 1) h.shift(); RB.jhist.set(a.key, h); }
    return { key: a.key, side: a.side, q: s.q, reach: s.reach, gap: s.gap, live: fresh(a.key) };
  });
  // a preview, or a body with one arm, shows the missing arms hanging in the start pose
  const withBody = preview || roles.body !== null;
  if (withBody) for (const side of [1, -1]) if (!arms.some((a) => a.side === side)) arms.push({ key: null, side, q: RCORE.HOME, reach: true, gap: 0, live: false, idle: true });
  // a hand moved with the mouse goes where it was dragged, not where its tag is (the tag still rides on it). It was put
  // there in the world (by the table), so it stays there when the body moves: the arm reaches to keep it
  const Rc = C.tr3(tg.chest.R);
  for (const [side, d] of TB.drive) {
    if (d.frame !== S.settings.frame) { TB.drive.delete(side); continue; } // (another frame: its world is a different one)
    const pk = 'drive' + side, prev = RB.prev.get(pk), s = RCORE.ik(m, side, { R: C.mul3(Rc, d.R), t: C.mulv(Rc, C.sub(d.t, tg.chest.t)) }, prev || null, { prefer });
    RB.prev.set(pk, { q: s.q, elbow: s.elbow, psi: s.psi, side });
    const a = arms.find((x) => x.side === side), set = { q: s.q, reach: s.reach, gap: s.gap, live: true, idle: false, driven: true };
    if (a) Object.assign(a, set); else arms.push(Object.assign({ key: null, side }, set));
  }
  // the arm's motors: each joint follows its target only as fast as it can turn and speed up (RobotCore.slew)
  const dts = RB.slewT ? Math.min(0.1, Math.max(0, now - RB.slewT)) : 0;
  RB.slewT = now;
  for (const a of arms) {
    const st = RB.slew.get(a.side), next = st && dts ? RCORE.slew(st, a.q, dts) : { q: a.q.slice(), v: [0, 0, 0, 0, 0, 0, 0] };
    RB.slew.set(a.side, next); a.q = next.q;
  }
  for (const a of arms) a.open = gripOf(a);
  RB.scene = { m, chest: tg.chest, body: withBody, bodyKey: roles.body, bodyLive: preview || fresh(roles.body), arms, preview, roles };
  const fitSig = (preview ? 'p' : '') + [roles.body, ...roles.arms.map((a) => a.key)].join(',');
  if (fitSig !== RB.fitSig) { RB.fitSig = fitSig; S.view.fitted = false; }
}

// The robot is drawn shaded with WebGL (robot-gl.js) on a canvas over the grid; where there is no WebGL (or it is lost),
// flat on the plot's own canvas instead.
let RGL; // made on first use; null: no WebGL
function robotGL() {
  if (RGL === undefined) { try { RGL = window.RobotGL ? RobotGL.create($('plotGL')) : null; } catch (e) { RGL = null; } }
  if (RGL && RGL.lost) RGL = null;
  return RGL;
}
function drawRobot(c, o, w, h, now) {
  robotUpdate(now);
  RB.view = o; RB.viewW = w;
  tableStep(RB.scene);
  const gl = robotGL();
  $('plotGL').hidden = !gl;
  hoverNow();
  if (gl) drawRobotGL(gl, o, w, h, now); else drawRobotFlat(c, o, h, now);
  if (TB.world) RB.pts.push(...tableCorners());
  if (!S.view.fitted) autoFit();
  paintRobotText(now);
}
// Each tag riding on the robot, turned as it is: the chest tag on the chest (where the chest is put), each wrist tag on
// the back of its wrist, a little out from it. Returns [{key, R, t, fresh, parts}], parts each {R, t, size} in the tag's frame.
function robotTags(now) {
  const sc = RB.scene, m = sc.m, out = [];
  const rides = [];
  if (sc.bodyKey !== null && sc.bodyKey !== undefined) rides.push([sc.bodyKey, null]);
  for (const a of sc.arms) if (a.key !== null && a.key !== undefined) rides.push([a.key, RCORE.place(sc.chest, RCORE.fk(m, a.side, a.q).wrist)]);
  for (const [key, at] of rides) {
    const g = RB.last.get(key);
    if (!g) continue;
    const parts = isBody(key) ? bodyOf(key).members.map((mm) => ({ R: mm.R, t: mm.t, size: sizeOf(mm.id) })) : [{ R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0], size: sizeOf(key) }];
    out.push({ key, R: g.R, t: C.add(at || g.t, C.mulv(g.R, [0, 0, at ? 0.045 : 0.012])), fresh: now - g.time < 0.5, parts });
  }
  return out;
}
// Which gripper the pointer can take now (its side), or null; while one is dragged, that one. Worked out every frame from
// where the pointer last was, so a gripper that moves under a still pointer lights up too.
function hoverNow() {
  TB.hover = TB.grab ? TB.grab.side : TB.ptr && !TB.ptr.buttons ? ((handAt(TB.ptr) || {}).a || {}).side ?? null : null; // (not while orbiting)
  if (!TB.grab && TB.ptr && !TB.ptr.buttons) plot.style.cursor = TB.hover !== null ? 'grab' : '';
}
const hotOf = (a) => (TB.hover === a.side ? (TB.grab ? 2 : 1) : 0);
function drawRobotGL(gl, o, w, h, now) {
  const sc = RB.scene;
  RB.pts = gl.draw({
    w, h, dpr: devicePixelRatio || 1, cam: o, fov: 45, chest: sc.chest, m: sc.m, arms: sc.arms.map((a) => Object.assign({}, a, { hot: hotOf(a) })), body: sc.body, fadeBody: sc.bodyLive ? 0 : 0.45,
    mount: sc.body ? null : sc.arms.length === 2 ? 'bar' : sc.arms.length === 1 ? sc.arms[0].side : null,
    tags: robotTags(now).map((tg) => ({ R: tg.R, t: tg.t, parts: tg.parts, color: colorOf(tg.key), fade: tg.fresh ? 0 : 0.45 })),
    theme: { accent: K.accent, warn: K.warn, bg: K.surface, dark: isDark() },
    props: tableDraw(),
    forces: forceArrows(),
  });
}
// Drawn flat: outlined solids, painted far to near: capsules for the links, balls for the joints, a box for the torso.
function drawRobotFlat(c, o, h, now) {
  const sc = RB.scene, m = sc.m, ch = sc.chest, P = (p) => RCORE.place(ch, p), f = h / 2 / Math.tan((45 * Math.PI) / 360);
  const items = [], pts = [];
  const ink = K.text, fill = K.surface, well = K.well;
  const seg = (a, b, r, fc, sc2, al) => {
    const p = o.project(a), q = o.project(b);
    pts.push(a, b);
    if (!p || !q) return;
    const z = (p[2] + q[2]) / 2, wpx = Math.max(2, (2 * r * f) / z);
    items.push({ z, draw() { c.globalAlpha = al; c.lineCap = 'round'; c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(q[0], q[1]); c.strokeStyle = sc2; c.lineWidth = wpx + 3; c.stroke(); c.strokeStyle = fc; c.lineWidth = wpx; c.stroke(); } });
  };
  const ball = (a, r, fc, sc2, al) => {
    const p = o.project(a);
    pts.push(a);
    if (!p) return;
    items.push({ z: p[2] - r, draw() { c.globalAlpha = al; c.beginPath(); c.arc(p[0], p[1], Math.max(2.5, (r * f) / p[2]), 0, 7); c.fillStyle = fc; c.fill(); c.strokeStyle = sc2; c.lineWidth = 1.5; c.stroke(); } });
  };
  const face = (quad, fc, al) => {
    const q = quad.map((a) => o.project(a));
    pts.push(...quad);
    if (q.some((x) => !x)) return;
    // only the faces turned towards the eye (screen-space winding)
    const area = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[1][1] - q[0][1]) * (q[2][0] - q[0][0]);
    if (area >= 0) return;
    items.push({ z: q.reduce((s, x) => s + x[2], 0) / 4 + 0.05, draw() { c.globalAlpha = al; c.beginPath(); q.forEach((x, i) => (i ? c.lineTo(x[0], x[1]) : c.moveTo(x[0], x[1]))); c.closePath(); c.fillStyle = fc; c.fill(); c.strokeStyle = ink; c.lineWidth = 1.5; c.lineJoin = 'round'; c.stroke(); } });
  };
  const bodyAl = sc.bodyLive ? 1 : 0.45;
  if (sc.body) {
    // torso: a box behind the chest tag, from the hips to the shoulders; then the neck, the head and its visor
    const x0 = -0.01, x1 = -(2 * m.back + 0.06), y = Math.max(0.06, m.half - 0.035), z1 = m.up + 0.03, z0 = m.up - 0.52;
    const V = (x, yy, z) => P([x, yy, z]);
    const box = [
      [V(x0, -y, z0), V(x0, y, z0), V(x0, y, z1), V(x0, -y, z1)], [V(x1, y, z0), V(x1, -y, z0), V(x1, -y, z1), V(x1, y, z1)],
      [V(x1, -y, z0), V(x0, -y, z0), V(x0, -y, z1), V(x1, -y, z1)], [V(x0, y, z0), V(x1, y, z0), V(x1, y, z1), V(x0, y, z1)],
      [V(x0, -y, z1), V(x0, y, z1), V(x1, y, z1), V(x1, -y, z1)], [V(x1, -y, z0), V(x1, y, z0), V(x0, y, z0), V(x0, -y, z0)],
    ];
    box.forEach((q, i) => face(q, i === 0 ? fill : well, bodyAl));
    const hx = -m.back, head = P([hx, 0, m.up + 0.17]);
    seg(P([hx, 0, z1 - 0.01]), head, 0.035, fill, ink, bodyAl);
    ball(head, 0.085, fill, ink, bodyAl);
    seg(P([hx + 0.075, -0.035, m.up + 0.18]), P([hx + 0.075, 0.035, m.up + 0.18]), 0.014, ink, ink, bodyAl);
    seg(P([-m.back, -m.half, m.up]), P([-m.back, m.half, m.up]), 0.035, well, ink, bodyAl);
  } else if (sc.arms.length === 2) {
    // two arms and no body: a bar between the shoulders on a small mount
    seg(P([-m.back, -m.half, m.up]), P([-m.back, m.half, m.up]), 0.035, well, ink, 1);
    ball(P([-m.back, 0, m.up]), 0.055, well, ink, 1);
  } else if (sc.arms.length === 1) {
    const sd = sc.arms[0].side;
    seg(P([-m.back, sd * m.half, m.up]), P([-m.back, sd * (m.half - 0.12), m.up]), 0.04, well, ink, 1);
    ball(P([-m.back, sd * (m.half - 0.12), m.up]), 0.06, well, ink, 1);
  }
  for (const a of sc.arms) {
    const k = RCORE.fk(m, a.side, a.q), al = sc.preview ? 1 : a.idle ? 0.3 : a.live ? 1 : 0.45, H = k.R;
    const far = !a.reach, armInk = far ? K.warn : ink;
    ball(P(k.shoulder), 0.05, well, ink, al);
    seg(P(k.shoulder), P(k.elbow), 0.04, fill, armInk, al);
    ball(P(k.elbow), 0.042, well, ink, al);
    seg(P(k.elbow), P(k.wrist), 0.035, fill, armInk, al);
    ball(P(k.wrist), 0.036, a.live && !a.idle ? K.accent : well, ink, al);
    // the gripper: a bar across the hand along the jaws' travel (y), a finger each side at the gap, a dot on the back
    const fd = [-H[2], -H[5], -H[8]], jy = [H[1], H[4], H[7]], bk = [H[0], H[3], H[6]];
    const at = (u, v, w) => P(C.add(k.wrist, C.add(fd.map((x) => x * u), C.add(jy.map((x) => x * v), bk.map((x) => x * (w || 0))))));
    const G = RCORE.gripper(m), g2 = (a.jaw === undefined ? G.gapMax : a.jaw) / 2 + G.finger.c[1], tip = 0.07 + G.fl;
    const gInk = hotOf(a) ? K.accent : ink;
    seg(at(0.045, -G.body.h[1]), at(0.045, G.body.h[1]), 0.022, well, gInk, al);
    seg(at(0.07, g2), at(tip, g2), 0.009, fill, gInk, al);
    seg(at(0.07, -g2), at(tip, -g2), 0.009, fill, gInk, al);
    ball(at(0.045, 0, 0.032), 0.01, K.accent, K.accent, al);
  }
  tableFlat(face, seg, ball);
  items.sort((p, q) => q.z - p.z);
  for (const it of items) it.draw();
  c.globalAlpha = 1;
  // the force arrows, over everything
  for (const ar of forceArrows()) {
    const p = o.project(ar.a), q = o.project(ar.b);
    if (!p || !q) continue;
    const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy), hd = Math.min(9, l * 0.45), ux = dx / (l || 1), uy = dy / (l || 1);
    c.strokeStyle = c.fillStyle = ar.warn ? K.warn : K.accent; c.lineWidth = 2.5; c.lineCap = 'round';
    c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(q[0] - ux * hd * 0.8, q[1] - uy * hd * 0.8); c.stroke();
    c.beginPath(); c.moveTo(q[0], q[1]); c.lineTo(q[0] - ux * hd - uy * hd * 0.5, q[1] - uy * hd + ux * hd * 0.5); c.lineTo(q[0] - ux * hd + uy * hd * 0.5, q[1] - uy * hd - ux * hd * 0.5); c.closePath(); c.fill();
  }
  // each tag riding on the robot, in its colour
  const line = (a, b, col, lw) => { const p = o.project(a), q = o.project(b); if (!p || !q) return; c.strokeStyle = col; c.lineWidth = lw; c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(q[0], q[1]); c.stroke(); };
  for (const tg of robotTags(now)) {
    c.globalAlpha = tg.fresh ? 1 : 0.45;
    for (const pt of tg.parts) {
      const sq = C.tagCorners(pt.size).map((q) => C.add(tg.t, C.mulv(tg.R, C.add(C.mulv(pt.R, q), pt.t))));
      for (let k = 0; k < 4; k++) line(sq[k], sq[(k + 1) % 4], colorOf(tg.key), 2);
    }
  }
  c.globalAlpha = 1;
  RB.pts = pts;
}
// ---------------- the table ----------------
// A table in front of the robot with a ball (and a cup that can tip over) to push about and pick up, in PhysicsCore
// (physics-core.js). It is placed from the chest's pose, in front of the hands' start pose, when the robot is first shown
// and on each calibration, and stays put in the world while the body moves. Each frame the arms' links and grippers
// (their pose, and how open the operator wants them: a hand moved with the mouse, else the servo on the board fixed to
// that hand's track, else open) go to the physics, which steps by the time since the last frame.
const tableSig = (sc) => [S.settings.robot.props, S.settings.frame, TB.n, sc.preview ? 'p' : '', JSON.stringify(sc.m)].join('|');
function placeTable(sc) {
  const m = sc.m, G = RCORE.gripper(m), w = RCORE.fk(m, 1, RCORE.HOME).wrist, tip = w[0] + 0.07 + G.fl;
  const R = RCORE.upright([sc.chest.R[0], sc.chest.R[3], sc.chest.R[6]]), ch = { R, t: sc.chest.t };
  // the top just under the fingers in the start pose, its near edge under the wrists
  const cx = w[0] - 0.03 + TABLE.size[0] / 2, table = { R, t: RCORE.place(ch, [cx, 0, w[2] - 0.045]), size: TABLE.size, thick: TABLE.thick };
  const kind = S.settings.robot.props;
  // the ball just past the left hand's fingertips (between the hands on its own), the mug past the right's
  const spots = kind === 'cup' ? { ball: [tip + 0.045 - cx, w[1]], cup: [tip + 0.105 - cx, -w[1]] } : { ball: [tip + 0.05 - cx, 0] };
  TB.world = PHYS.scene(kind, table, G, spots, Math.PI); // the mug's handle towards the robot
  TB.t = performance.now();
}
function resetTable() {
  if (S.settings.robot.props === 'off') return 'The table is off';
  if (TB.world) TB.world.reset();
  return 'Table reset';
}
// how open an arm's gripper should be, 0 to 1
function gripOf(a) {
  const d = TB.drive.get(a.side);
  if (d) return d.open;
  const b = a.key !== null && a.key !== undefined ? S.boards.find((x) => x.track === a.key && x.grip && x.act && performance.now() - x.actT < 500) : null;
  const g = b ? C.gripOpening(b.act, b.grip) : null;
  return g === null ? 1 : g;
}
function tableStep(sc) {
  if (!sc || S.settings.robot.props === 'off' || !PHYS) { TB.world = null; TB.sig = ''; RB.fhist.clear(); if (SND) SND.stop(); return; }
  const sig = tableSig(sc);
  if (!TB.world || sig !== TB.sig) { TB.sig = sig; placeTable(sc); }
  const W = TB.world, m = sc.m, links = [], hands = [], P = (p) => RCORE.place(sc.chest, p);
  for (const a of sc.arms) {
    const k = RCORE.fk(m, a.side, a.q);
    links.push({ id: a.side + 'u', a: P(k.shoulder), b: P(k.elbow), r: 0.04 }, { id: a.side + 'f', a: P(k.elbow), b: P(k.wrist), r: 0.032 });
    hands.push({ side: a.side, pose: { R: C.mul3(sc.chest.R, k.R), t: P(k.wrist) }, opening: a.open });
  }
  W.setRobot({ links, hands });
  const t = performance.now();
  W.step((t - TB.t) / 1000); TB.t = t;
  forceHistory(W.record, t / 1000);
  if (SND && W.record && W.record.time !== TB.heard) { TB.heard = W.record.time; SND.play(W.record, panOf); }
  // the arm drawn to where its hand is: the table or a prop may have stopped it short of where the arm was sent
  const Rt = C.tr3(sc.chest.R);
  for (const a of sc.arms) {
    const h = W.hands[a.side], P = W.handPose(a.side);
    if (!h || !P) continue;
    a.jaw = h.gap;
    const k = RCORE.fk(m, a.side, a.q), s = RCORE.ik(m, a.side, { R: C.mul3(Rt, P.R), t: C.mulv(Rt, C.sub(P.t, sc.chest.t)) }, { q: a.q, elbow: k.elbow }, { prefer: S.settings.robot.elbows ? undefined : false });
    a.q = s.q;
  }
}
// A point's place across the 3D view, -1 (left) to 1, for the sound's stereo
function panOf(p) {
  const q = RB.view && RB.view.project(p);
  return q && RB.viewW ? Math.max(-1, Math.min(1, (q[0] / RB.viewW) * 2 - 1)) * 0.8 : 0;
}
// The Forces tab's numbers for a hand from a step's record (N): the squeeze, what its friction can hold, the grip's
// load (what the prop it holds puts on the fingers), and everything else it touches together; and how much of what the
// pads can hold the grip uses.
function forceRow(h) {
  let cf = [0, 0, 0];
  for (const x of h.contacts) cf = C.add(cf, x.f);
  return { v: [h.squeeze, h.hold, h.grip ? h.grip.load : 0, C.norm(cf)], use: h.grip ? h.grip.use : 0, slipping: !!(h.grip && h.grip.slipping), holds: h.grip ? h.grip.kind : null };
}
function forceHistory(rec, time) {
  if (!rec) return;
  for (const k of Object.keys(rec.hands)) {
    const side = +k, a = RB.fhist.get(side) || [];
    a.push(Object.assign({ time }, forceRow(rec.hands[k])));
    while (a.length && a[0].time < time - S.settings.span - 1) a.shift();
    RB.fhist.set(side, a);
  }
  for (const side of [...RB.fhist.keys()]) if (!rec.hands[side]) RB.fhist.delete(side);
}
// The force arrows: each thing pushing on a hand, ending where it pushes, and each grip's load from where it pinches,
// amber while it slips. Lengths grow with the log of the force, so 0.3 N and 40 N both read: 3.5 cm per doubling past 0.2 N.
const arrowLen = (F) => 0.035 * Math.log2(1 + F / 0.2);
function forceArrows() {
  const rec = TB.world && TB.world.record, out = [];
  if (!rec || !S.settings.robot.forces) return out;
  for (const h of Object.values(rec.hands)) {
    for (const x of h.contacts) {
      const F = C.norm(x.f);
      if (F < 0.05) continue;
      out.push({ a: C.sub(x.p, x.f.map((v) => (v / F) * arrowLen(F))), b: x.p, warn: false });
    }
    const g = h.grip;
    if (g && g.load >= 0.05) out.push({ a: g.p, b: C.add(g.p, g.force.map((v) => (v / g.load) * arrowLen(g.load))), warn: g.slipping });
  }
  return out;
}
const tableUp = () => [TB.world.table.R[2], TB.world.table.R[5], TB.world.table.R[8]];
function tableCorners() {
  const T = TB.world.table, lx = T.size[0] / 2, ly = T.size[1] / 2;
  return [[-lx, -ly], [-lx, ly], [lx, -ly], [lx, ly]].map(([x, y]) => C.add(T.t, C.mulv(T.R, [x, y, 0])));
}
// what robot-gl.js draws: the table, the bodies and their shadows on it
function tableDraw() {
  const W = TB.world;
  if (!W) return null;
  const T = W.table, up = tableUp(), Rt = C.tr3(T.R), shadows = [];
  const bodies = W.bodies.map((b) => Object.assign({ kind: b.kind }, W.poseOf(b)));
  for (const b of W.bodies) {
    const d = C.sub(b.t, T.t), hgt = d[0] * up[0] + d[1] * up[1] + d[2] * up[2], l = C.mulv(Rt, d);
    if (hgt < 0 || Math.abs(l[0]) > T.size[0] / 2 || Math.abs(l[1]) > T.size[1] / 2) continue;
    const r = b.kind === 'ball' ? PHYS.BALL.r : PHYS.CUP.R * 1.05;
    shadows.push({ R: T.R, t: C.sub(b.t, up.map((x) => x * hgt)), r, a: Math.max(0, 1 - hgt / 0.35) });
  }
  return {
    dims: { table: { size: T.size, thick: TABLE.thick, legs: TABLE.legs }, ball: { r: PHYS.BALL.r }, cup: { R: PHYS.CUP.R, Ri: PHYS.CUP.Ri, H: PHYS.CUP.H, floor: PHYS.CUP.floor, handle: PHYS.CUP.handle } },
    table: { R: T.R, t: T.t }, bodies, shadows,
  };
}
// drawn flat (no WebGL): the table's top, the ball, the cup as a fat stroke from its base to its rim
function tableFlat(face, seg, ball) {
  const W = TB.world;
  if (!W) return;
  const q = tableCorners();
  face([q[0], q[1], q[3], q[2]], K.well, 0.8); face([q[2], q[3], q[1], q[0]], K.well, 0.8);
  for (const b of W.bodies) {
    const p = W.poseOf(b);
    if (b.kind === 'ball') ball(p.t, PHYS.BALL.r, '#2a78d6', K.text, 1);
    else seg(p.t, C.add(p.t, C.mulv(p.R, [0, 0, PHYS.CUP.H])), PHYS.CUP.R, K.surface, K.text, 1);
  }
}
$('robotProps').value = S.settings.robot.props;
$('robotProps').onchange = () => { S.settings.robot.props = $('robotProps').value; saveSettings(); paintRobotBtns(); };
$('robotForces').value = S.settings.robot.forces ? 'on' : 'off';
$('robotForces').onchange = () => { S.settings.robot.forces = $('robotForces').value === 'on'; saveSettings(); };
$('soundBtn').onclick = () => setSound(!S.settings.robot.sound);
$('tableResetBtn').onclick = resetTable;
$('tagsDriveBtn').onclick = () => { TB.drive.clear(); for (const k of [...RB.prev.keys()]) if (String(k).startsWith('drive')) RB.prev.delete(k); paintRobotBtns(); };

// Moving a hand with the mouse (or a finger): press on a gripper and drag it across the view, in the robot's plane the
// view looks most squarely at (grabPlane); with Alt held, in the next one. Scrolling on a hand opens and closes it
// (with Shift: tips the fingers down and up), and Space opens or closes the last one moved. A moved hand stays where it
// was put until Tags drive, Calibrate robot, or a reload.
function plotOrbit() {
  const V = S.view, r = plot.getBoundingClientRect();
  return { o: C.orbit({ yaw: V.yaw, pitch: V.pitch, dist: V.dist, target: V.target, fov: 45, w: r.width, h: r.height }), r };
}
// the point between the fingers of each arm, in the plotted frame, and the nearest one on screen within 30 px of (x, y)
function gripPoint(sc, a) {
  const k = RCORE.fk(sc.m, a.side, a.q), G = RCORE.gripper(sc.m);
  return RCORE.place(sc.chest, C.add(k.wrist, C.mulv(k.R, [0, 0, G.finger.c[2]])));
}
const GRAB_PX = 30; // how near (px) the pointer must be to a gripper to take it
function handAt(e) {
  const sc = RB.scene;
  if (S.settings.show3d !== 'robot' || !sc) return null;
  const { o, r } = plotOrbit(), x = e.clientX - r.left, y = e.clientY - r.top;
  let best = null;
  for (const a of sc.arms) {
    const p = gripPoint(sc, a), s = o.project(p);
    if (!s) continue;
    const d = Math.hypot(s[0] - x, s[1] - y);
    if (d < GRAB_PX && (!best || d < best.d)) best = { a, p, d };
  }
  return best;
}
// a hand driven from now on, from wherever it is: its wrist's pose in the world (the plot's frame), d.R and d.t
function driveOf(a) {
  let d = TB.drive.get(a.side);
  if (!d) {
    const sc = RB.scene, k = RCORE.fk(sc.m, a.side, a.q);
    d = { R: C.mul3(sc.chest.R, k.R), t: RCORE.place(sc.chest, k.wrist), open: a.open === undefined ? 1 : a.open, frame: S.settings.frame };
    TB.drive.set(a.side, d); paintRobotBtns();
  }
  TB.lastSide = a.side;
  return d;
}
// where the ray through (x, y) meets the plane through p with normal n, or null
function rayHit(o, r, e, p, n) {
  const f = r.height / 2 / Math.tan((45 * Math.PI) / 360), x = e.clientX - r.left - r.width / 2, y = r.height / 2 - (e.clientY - r.top);
  const d = C.add(o.fwd, C.add(o.right.map((v) => (v * x) / f), o.up.map((v) => (v * y) / f))), dn = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
  if (Math.abs(dn) < 1e-6) return null;
  const s = ((p[0] - o.eye[0]) * n[0] + (p[1] - o.eye[1]) * n[1] + (p[2] - o.eye[2]) * n[2]) / dn;
  return s > 0 ? C.add(o.eye, d.map((v) => v * s)) : null;
}
// The plane a hand is dragged in: its normal is whichever of the robot's forward, side and up (the table's axes, else the
// chest's, upright) the view looks most nearly along. From above the hand moves side to side and forward and back, from
// the side forward and back and up and down, from the front side to side and up and down. Alt takes the next nearest,
// so from above it lifts the hand.
function grabPlane(o, alt) {
  const ch = RB.scene.chest, R = TB.world ? TB.world.table.R : RCORE.upright([ch.R[0], ch.R[3], ch.R[6]]);
  const by = [0, 1, 2].map((i) => [R[i], R[3 + i], R[6 + i]]).map((a) => ({ a, d: Math.abs(a[0] * o.fwd[0] + a[1] * o.fwd[1] + a[2] * o.fwd[2]) }));
  by.sort((x, y) => y.d - x.d);
  return by[alt ? 1 : 0].a;
}
function handGrab(e) {
  if (e.shiftKey || (e.pointerType === 'mouse' && e.button !== 0)) return false;
  const hit = handAt(e);
  if (!hit) return false;
  // a target left out of reach (the body moved away from it, say) starts again from where the hand is, so the first move
  // of the pointer moves the hand; from the old target, nothing would move until the pointer had brought it back in reach
  const kept = TB.drive.get(hit.a.side);
  if (kept && !hit.a.reach) { TB.drive.delete(hit.a.side); driveOf(hit.a).open = kept.open; }
  const d = driveOf(hit.a), sc = RB.scene, G = RCORE.gripper(sc.m), p = C.add(d.t, C.mulv(d.R, [0, 0, G.finger.c[2]]));
  const { o, r } = plotOrbit(), n = grabPlane(o, e.altKey), at = rayHit(o, r, e, p, n);
  if (!at) return false;
  TB.grab = { id: e.pointerId, side: hit.a.side, alt: e.altKey, n, off: C.sub(p, at) };
  plot.setPointerCapture(e.pointerId); plot.style.cursor = 'grabbing';
  return true;
}
function handMove(e) {
  const g = TB.grab;
  if (!g || g.id !== e.pointerId) {
    if (!g) { TB.ptr = { clientX: e.clientX, clientY: e.clientY, buttons: e.buttons }; if (!e.buttons) hoverNow(); }
    return !!g;
  }
  const sc = RB.scene, a = sc && sc.arms.find((x) => x.side === g.side), d = TB.drive.get(g.side);
  if (!a || !d) { TB.grab = null; return true; }
  // the plane goes through where the hand is sent, not where it is: the table or a load can hold the hand back, and a
  // plane that followed it would move the target with it
  const G = RCORE.gripper(sc.m), p = C.add(d.t, C.mulv(d.R, [0, 0, G.finger.c[2]]));
  const { o, r } = plotOrbit();
  // Alt pressed or let go mid-drag: carry on from here on the other plane
  if (e.altKey !== g.alt) { const n = grabPlane(o, e.altKey), at = rayHit(o, r, e, p, n); if (at) { g.n = n; g.off = C.sub(p, at); g.alt = e.altKey; } return true; }
  const at = rayHit(o, r, e, p, g.n);
  if (!at) return true;
  // the new grip point; on the table (or the floor, the other arm or the other gripper) it goes at most PHYS.PRESS past
  // where the hand rests, and the pointer slips over the rest (the offset takes it up), so the hand comes up as soon as
  // the pointer does. The shift stays in the drag plane, so a tilted push never carries the hand up or down.
  let want = C.add(at, g.off);
  const ph = TB.world && TB.world.handPose(g.side);
  if (ph && TB.world.record) {
    const shift = PHYS.holdBack(TB.world.record.hands[g.side], C.add(ph.t, C.mulv(ph.R, [0, 0, G.finger.c[2]])), want, undefined, g.n);
    if (C.norm(shift) > 0) { want = C.add(want, shift); g.off = C.add(g.off, shift); }
  }
  // and the wrist behind it, kept within the arm's reach in the drag plane (out of reach the arm would stretch along the
  // line from its shoulder, which lifts the hand); the pointer slips over the rest here too
  const ch = sc.chest, Rct = C.tr3(ch.R), wr = C.sub(want, C.mulv(d.R, [0, 0, G.finger.c[2]]));
  const loc = C.mulv(Rct, C.sub(wr, ch.t)), inr = RCORE.inReach(sc.m, g.side, loc, C.mulv(Rct, g.n));
  if (inr !== loc) { const shift = C.mulv(ch.R, C.sub(inr, loc)); want = C.add(want, shift); g.off = C.add(g.off, shift); }
  d.t = C.sub(want, C.mulv(d.R, [0, 0, G.finger.c[2]]));
  return true;
}
function handDrop(e) { if (TB.grab && TB.grab.id === e.pointerId) { TB.grab = null; plot.style.cursor = ''; TB.ptr = { clientX: e.clientX, clientY: e.clientY, buttons: 0 }; } }
plot.addEventListener('pointerleave', () => { if (!TB.grab) { TB.ptr = null; TB.hover = null; plot.style.cursor = ''; } });
function handWheel(e) {
  const hit = TB.grab ? { a: RB.scene.arms.find((x) => x.side === TB.grab.side) } : handAt(e);
  if (!hit || !hit.a) return false;
  const d = driveOf(hit.a), dy = e.deltaY || e.deltaX;
  if (e.shiftKey) d.R = C.mul3(d.R, RCORE.Ry(Math.sign(dy) * 0.06));
  else d.open = Math.min(1, Math.max(0, d.open - dy * 0.002)); // scrolling down (towards you) closes it, like a trigger
  return true;
}
plot.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || S.settings.show3d !== 'robot') return;
  if (e.key === 't' || e.key === 'T') { e.preventDefault(); resetTable(); }
  else if ((e.key === 'm' || e.key === 'M') && S.settings.robot.props !== 'off') { e.preventDefault(); setSound(!S.settings.robot.sound); }
  else if (e.key === ' ' && TB.drive.has(TB.lastSide)) { e.preventDefault(); const d = TB.drive.get(TB.lastSide); d.open = d.open > 0.5 ? 0 : 1; }
});

// the legend (which track drives what), the joint angles and the prompt under the robot
function paintRobotText(now) {
  const sc = RB.scene, lg = $('legend3d'), sideName = (sd) => (sd === 1 ? 'Left arm' : 'Right arm');
  const rows = [];
  if (sc.bodyKey !== null && sc.bodyKey !== undefined) rows.push(['Body', sc.bodyKey]);
  for (const a of sc.arms) if (a.key !== null && a.key !== undefined) rows.push([sideName(a.side), a.key]);
  const key = 'robot|' + rows.map((r) => r.join(':') + nameOf(r[1])).join('|');
  if (lg.dataset.key !== key) {
    lg.dataset.key = key;
    lg.innerHTML = rows.length ? rows.map(([role, k]) => `<span class="li"><span class="sw" style="background:${cssColorOf(k)}"></span>${role}: ${escapeHtml(nameOf(k))}</span>`).join('') : '<span class="li muted">No tags yet</span>';
  }
  const pnow = performance.now();
  if (pnow - RB.jointsT > 200) {
    RB.jointsT = pnow;
    paintTplotMode(); // the Joint angles tab comes and goes with the arms
    const arms = robotArms(), jt = $('jointsNow');
    if (tpMode() === 'joints') {
      const D = 180 / Math.PI, lim = (j) => `${(j.lo * D).toFixed(0)} to ${(j.hi * D).toFixed(0)}`;
      jt.innerHTML = `<table><thead><tr><th>Joint</th>${arms.map((a) => `<th class="num g">${a.side === 1 ? 'Left' : 'Right'}, °</th>`).join('')}<th class="num g">Range, °</th></tr></thead><tbody>` +
        RCORE.JOINTS.map((j, i) => `<tr><td><span style="display:inline-flex;align-items:center;gap:7px"><span class="sw" style="background:var(--s${i + 1})"></span>${j.name}</span></td>${arms.map((a) => `<td class="num mono g">${(a.q[i] * D).toFixed(0)}</td>`).join('')}<td class="num mono g muted">${lim(j)}</td></tr>`).join('') + '</tbody></table>' +
        arms.filter((a) => !a.reach).map((a) => `<div class="far">${a.side === 1 ? 'Left' : 'Right'} hand ${(a.gap * 100).toFixed(0)} cm out of reach</div>`).join('');
    }
    if (tpMode() === 'forces') {
      // each hand's numbers now: the squeeze and what it can hold, the grip's load and its share of that, the rest
      const fs = forceSides(), now1 = fs.map((sd) => { const a = RB.fhist.get(sd); return a[a.length - 1]; });
      const row = (name, i, title) => `<tr><td><span style="display:inline-flex;align-items:center;gap:7px" title="${title}"><span class="sw" style="background:var(--s${i + 1})"></span>${name}</span></td>${now1.map((x) => `<td class="num mono g">${x.v[i].toFixed(2)}</td>`).join('')}</tr>`;
      $('forcesNow').innerHTML = `<table><thead><tr><th>Force</th>${fs.map((sd) => `<th class="num g">${sd === 1 ? 'Left' : 'Right'}, N</th>`).join('')}</tr></thead><tbody>` +
        row('Squeeze', 0, 'How hard the jaws squeeze what they hold') + row('Can hold', 1, 'The most the pads’ friction holds: 2 × μ × squeeze') +
        row('Load', 2, 'What the prop it holds puts on the fingers') + row('Contact', 3, 'Everything else the hand touches, together') +
        `<tr><td>Grip used</td>${now1.map((x) => `<td class="num mono g${x.slipping ? ' warn' : ''}">${x.holds ? (x.use * 100).toFixed(0) + '%' : '–'}</td>`).join('')}</tr>` +
        `<tr><td>Holding</td>${now1.map((x) => `<td class="num g${x.slipping ? ' warn' : ''}">${x.holds ? (x.slipping ? 'slipping' : { ball: 'the ball', cup: 'the mug' }[x.holds] || x.holds) : 'nothing'}</td>`).join('')}</tr></tbody></table>`;
    }
  }
  if (pnow - RB.hintT > 250) {
    RB.hintT = pnow;
    const el = $('robotHint'), msg = pnow < RB.msgT ? RB.msg : '';
    let text = msg;
    if (!text && S.running) text = sc.preview ? 'Show a tag to the camera: one drives an arm, two drive both arms, and a third on your chest adds the body.' : !RB.cal ? 'Face the camera with your arms at your sides, forearms forward and palms in. Then press Calibrate robot (or C).' : '';
    el.hidden = !text; el.textContent = text; el.classList.toggle('warn', !!msg && RB.msgWarn);
  }
}
radios('show3d', () => S.settings.show3d, (v) => { S.settings.show3d = v; store.set('settings', S.settings); $('legend3d').dataset.key = ''; S.view.fitted = false; paintRobotBtns(); });
paintRobotBtns();
paintTplotMode(); // (here, once the robot's state exists)
