// Tag tracker page, part of index.html's script: the three-camera demo and the setup guide.
// The app-*.js files are classic scripts loaded in order and share one global scope; nothing in them runs
// another file's code at load (the boot script at the end of index.html starts everything).
'use strict';

// ---------------- demo: three simulated cameras round one scene ----------------
// The scene (three tags moving, or while calibrating the board, moving and holding still) is rendered with WebGL in
// true perspective from each camera's pose and lens, so each camera sees it from its own side and the detector,
// the fusion and the camera placement all run on real pictures. World frame = camera 1's. Lenses: the 70° guess.
const DEMO = (() => {
  const W = 1280, H = 720, center = [0, 0.05, 1.35];
  return {
    W, H, center, square: 0.06, // the board's squares, m (bigger than a printed one, as on a large screen)
    audience: [0, -0.1, 0.35], // what the tags and board turn towards, so all three cameras see them
    intr: C.guessIntrinsics(W, H, 70),
    cams: [{ R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] }, C.lookAt([-0.8, -0.25, 0.45], center), C.lookAt([0.75, -0.4, 0.55], center)],
  };
})();
// A frame at p whose z points at `at` (a tag's face looks along +z; the board's −z), upright, then rolled and tilted.
function facing(p, at, roll, tilt, away) {
  const z0 = C.sub(at, p), z = C.mulv([1, 0, 0, 0, 1, 0, 0, 0, 1], z0.map((x) => (x / C.norm(z0)) * (away ? -1 : 1)));
  const up = away ? [0, 1, 0] : [0, -1, 0], d = up[0] * z[0] + up[1] * z[1] + up[2] * z[2];
  const y0 = C.sub(up, z.map((x) => x * d)), y = y0.map((x) => x / C.norm(y0));
  const x = [y[1] * z[2] - y[2] * z[1], y[2] * z[0] - y[0] * z[2], y[0] * z[1] - y[1] * z[0]];
  const F = [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
  return C.mul3(F, C.mul3(C.rodrigues([0, 0, roll || 0]), C.rodrigues([0, tilt || 0, 0])));
}
// The scene: a body tag, and two hands, each a 10 cm cube with a tag on its front (0, 1), sides and top. The poses
// are of each tag (and of each hand's front tag, which is its object's origin).
// The hands move along a path the robot can follow smoothly (RobotCore.demoPose): each cube's front tag rides on a
// wrist of the robot, on the chest the robot finds from the body tag, turned toward the cameras in the start pose, and
// moves within a comfortable box with gentle turns, so the arm stays clear of every singularity and joint limit and
// each hand keeps facing camera 1 (within about 36°; the other cameras aren't placed at first, so camera 1 alone
// measures the hands). Each DEMO_CYCLE seconds it rests in the start pose (arms at the sides, forearms forward,
// palms in) for 3.5 s, and the robot calibrates itself only then (demoAtHome). Test section 5h runs the IK along it.
const DEMO_CYCLE = 18;
const demoPhase = (t) => ((t % DEMO_CYCLE) + DEMO_CYCLE) % DEMO_CYCLE;
// (late in the rest, once every hand's pose has settled)
const demoAtHome = (t) => { const u = demoPhase(t); return (u > 1.2 && u < 2.3) || u > DEMO_CYCLE - 0.6; };
function demoTags(t) {
  const A = DEMO.audience, pose = (p, roll, tilt, pitch) => ({ R: C.mul3(facing(p, A, roll, tilt), C.rodrigues([pitch || 0, 0, 0])), t: p });
  // square to camera 1, so the hands never pass in front of it there, and tipped back (as a tag on a chest would be),
  // so camera 1 can tell its two mirror-image poses apart
  const body = { id: 2, ...pose([0, 0.08, 1.6], 0.02 * Math.sin(t), 0.12, 0.45) };
  const m = RCORE.model(S.settings.robot), chest = C.compose(body, RCORE.calibrate(m, { body: C.toView(body), arms: [] }).bodyOffset);
  const hand = (id, side) => {
    const home = C.compose(chest, RCORE.fk(m, side, RCORE.HOME)), w = C.compose(chest, RCORE.demoPose(m, side, t, DEMO_CYCLE));
    // the cube turned a little (as the old demo's were), so camera 1 sees its top and a side as well as its front:
    // a single tag seen face-on has two orientations that fit almost equally well
    return { id, R: C.mul3(w.R, C.mul3(C.tr3(home.R), pose(home.t, 0, side * 0.5, 0.35).R)), t: w.t };
  };
  return [body, hand(0, -1), hand(1, 1)]; // the right hand (on the cameras' left) and the left
}
// Each hand's cube: the front tag is the origin (x right, y up, z out of its face); the others sit on the left, right
// and top faces, upright as seen from the front (the top one from the front, looking down).
const CUBE = 0.1, DEMO_HANDS = [
  // named for the side of the body each is on: the body faces the cameras, so its right hand is on their left
  { id: 'demo-left', name: 'Right hand', ids: [0, 3, 4, 5] },
  { id: 'demo-right', name: 'Left hand', ids: [1, 6, 7, 8] },
];
function cubeMembers(ids) {
  const e = CUBE / 2;
  return [
    { id: ids[0], R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] },
    { id: ids[1], R: [0, 0, -1, 0, 1, 0, 1, 0, 0], t: [-e, 0, -e] }, // left side, facing −x
    { id: ids[2], R: [0, 0, 1, 0, 1, 0, -1, 0, 0], t: [e, 0, -e] }, // right side, facing +x
    { id: ids[3], R: [1, 0, 0, 0, 0, 1, 0, -1, 0], t: [0, e, -e] }, // top, facing +y
  ];
}
function demoScene(t) {
  const out = [];
  for (const g of demoTags(t)) {
    const hand = DEMO_HANDS.find((h) => h.ids[0] === g.id);
    if (!hand) { out.push(g); continue; }
    for (const m of cubeMembers(hand.ids)) out.push({ id: m.id, ...C.compose(g, m) });
  }
  return out;
}
// The board while calibrating: it holds each of 12 poses for 1.5 s and moves between them in 0.7 s.
const BOARD_KEYS = Array.from({ length: 12 }, (_, k) => ({
  p: C.add(DEMO.center, [0.22 * Math.sin(k * 2.4), 0.13 * Math.cos(k * 1.7), -0.1 + 0.18 * Math.sin(k * 1.3)]),
  roll: 0.3 * Math.sin(k * 0.9), tilt: 0.35 * Math.cos(k * 1.9), pitch: 0.3 * Math.sin(k * 2.9),
}));
function demoBoard(t) {
  const hold = 1.5, move = 0.7, per = hold + move, k = Math.floor(t / per) % BOARD_KEYS.length, f = t % per;
  const a = BOARD_KEYS[k], b = BOARD_KEYS[(k + 1) % BOARD_KEYS.length];
  const s = f < hold ? 0 : ((x) => x * x * (3 - 2 * x))((f - hold) / move), mix = (u, v) => u + (v - u) * s;
  const p = a.p.map((x, i) => mix(x, b.p[i]));
  const R = C.mul3(facing(p, DEMO.audience, mix(a.roll, b.roll), mix(a.tilt, b.tilt), true), C.rodrigues([mix(a.pitch, b.pitch), 0, 0]));
  const sq = DEMO.square;
  return { R, t: C.sub(p, C.mulv(R, [4.5 * sq, 3 * sq, 0])) };
}
// One WebGL canvas renders each camera's view in turn; each is copied to that camera's own canvas, whose stream is
// the camera.
function demoRenderer(W, H) {
  const glc = document.createElement('canvas'); glc.width = W; glc.height = H;
  const gl = glc.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true });
  if (!gl) throw new Error('The demo needs WebGL 2.');
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, `#version 300 es
    in vec4 a_pos; in vec2 a_uv; uniform mat4 u_m; out vec2 v_uv;
    void main() { gl_Position = u_m * a_pos; v_uv = a_uv; }`));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, `#version 300 es
    precision mediump float; in vec2 v_uv; uniform sampler2D u_tex; uniform int u_bg; out vec4 o;
    void main() {
      if (u_bg == 1) o = vec4(mix(vec3(0.604, 0.639, 0.678), vec3(0.435, 0.467, 0.502), v_uv.y), 1.0);
      else o = gl_FrontFacing ? texture(u_tex, v_uv) : vec4(0.85, 0.85, 0.83, 1.0); // the back of the paper
    }`));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  gl.frontFace(gl.CW); // corners go top-left, top-right, bottom-right: clockwise on screen when seen from the front
  const buf = gl.createBuffer(), aPos = gl.getAttribLocation(prog, 'a_pos'), aUv = gl.getAttribLocation(prog, 'a_uv');
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 4, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(aUv); gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 24, 16);
  const uM = gl.getUniformLocation(prog, 'u_m'), uBg = gl.getUniformLocation(prog, 'u_bg');
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  const texture = (canvas) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    return t;
  };
  // world → clip for a camera (pose: camera → world) with OpenCV intrinsics; pixel centres at whole numbers
  const matrix = (pose, c) => {
    const n = 0.05, f = 20, Rt = C.tr3(pose.R), tt = C.mulv(Rt, pose.t).map((x) => -x);
    const P = [[(2 * c.fx) / W, 0, (2 * (c.cx + 0.5)) / W - 1, 0], [0, (-2 * c.fy) / H, 1 - (2 * (c.cy + 0.5)) / H, 0], [0, 0, (f + n) / (f - n), (-2 * f * n) / (f - n)], [0, 0, 1, 0]];
    const V = [[Rt[0], Rt[1], Rt[2], tt[0]], [Rt[3], Rt[4], Rt[5], tt[1]], [Rt[6], Rt[7], Rt[8], tt[2]], [0, 0, 0, 1]];
    const out = new Float32Array(16);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += P[i][k] * V[k][j]; out[j * 4 + i] = s; }
    return out;
  };
  const draw = (verts, mode) => { gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STREAM_DRAW); gl.drawArrays(mode, 0, verts.length / 6); };
  // quads: {tex, corners: 4 world points (top-left, top-right, bottom-right, bottom-left of the texture)}
  const render = (pose, c, quads) => {
    gl.viewport(0, 0, W, H);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    gl.uniform1i(uBg, 1); gl.uniformMatrix4fv(uM, false, new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
    draw([-1, 1, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1, -1, 0, 1, 1, 1, -1, 1, 0, 1, 0, 0, 1, -1, 0, 1, 1, 1, -1, -1, 0, 1, 0, 1], gl.TRIANGLES);
    gl.enable(gl.DEPTH_TEST);
    gl.uniform1i(uBg, 0); gl.uniformMatrix4fv(uM, false, matrix(pose, c));
    for (const q of quads) {
      gl.bindTexture(gl.TEXTURE_2D, q.tex);
      const v = (i, u, w) => [...q.corners[i], 1, u, w];
      draw([...v(0, 0, 0), ...v(1, 1, 0), ...v(2, 1, 1), ...v(0, 0, 0), ...v(2, 1, 1), ...v(3, 0, 1)], gl.TRIANGLES);
    }
  };
  return { canvas: glc, texture, render };
}
async function startDemo() {
  const ids = [0, 1, 2, 3, 4, 5, 6, 7, 8], names = ['Right hand, front', 'Left hand, front', 'Body', 'Right hand, left side', 'Right hand, right side', 'Right hand, top', 'Left hand, left side', 'Left hand, right side', 'Left hand, top'];
  // the demo's names before its hands were named for the body's sides: renamed if still as the demo left them
  const swap = (n) => n.replace(/^(Left|Right) hand/, (x, sd) => (sd === 'Left' ? 'Right' : 'Left') + ' hand');
  // the side and top tags are only ever seen as part of their hand, so they don't take a colour of their own
  ids.forEach((id, i) => { const t = tagOf(id); if (!t) S.tags.push({ id, name: names[i], size: 0.08, slot: i < 3 ? freeSlot() : -1 }); else if (t.name === swap(names[i]) && i !== 2) t.name = names[i]; });
  for (const h of DEMO_HANDS) {
    const b = S.bodies.find((x) => x.id === h.id);
    if (b && b.name === swap(h.name)) b.name = h.name;
    if (!S.bodies.some((x) => x.members.some((m) => h.ids.includes(m.id)))) S.bodies.push({ id: h.id, name: h.name, members: cubeMembers(h.ids) });
  }
  saveTags(); saveBodies(); resetTracks(); robotReset(); renderTags(); renderBodies(); refreshFrameSel(); refreshTplotSel();
  const quiet = 30, cells = FAMILY_CELLS[S.settings.family];
  const imgs = await Promise.all(ids.map((id) => requestImage('tagImage', { family: S.settings.family, id, px: cells * 30 })));
  const boardImg = await requestImage('boardImage', { px: 80 });
  const gl = demoRenderer(DEMO.W, DEMO.H);
  const tagTex = new Map(ids.map((id, i) => [id, gl.texture(grayToCanvas(imgs[i], quiet))]));
  const boardTex = gl.texture(grayToCanvas(boardImg, 40)); // half a square of white round it
  const outs = DEMO.cams.map(() => { const cv = document.createElement('canvas'); cv.width = DEMO.W; cv.height = DEMO.H; return cv; });
  let run = true;
  const t0 = performance.now();
  const sceneQuads = (t) => {
    if (S.mode === 'calib') {
      const B = demoBoard(t), sq = DEMO.square, m = sq / 2;
      const P = (x, y) => C.add(C.mulv(B.R, [x, y, 0]), B.t);
      return [{ tex: boardTex, corners: [P(-m, -m), P(9 * sq + m, -m), P(9 * sq + m, 6 * sq + m), P(-m, 6 * sq + m)] }];
    }
    return demoScene(t).map((g) => {
      const im = imgs[ids.indexOf(g.id)], h = (sizeOf(g.id) / 2) * (im.w + 2 * quiet) / im.w;
      return { tex: tagTex.get(g.id), corners: [[-h, h], [h, h], [h, -h], [-h, -h]].map(([x, y]) => C.add(C.mulv(g.R, [x, y, 0]), g.t)) };
    });
  };
  let lastDraw = 0;
  const frameAll = (now) => {
    if (!run) return;
    requestAnimationFrame(frameAll);
    if (now - lastDraw < 30) return; // 30 frames a second is all the streams carry
    lastDraw = now;
    const quads = sceneQuads((performance.now() - t0) / 1000);
    DEMO.cams.forEach((pose, k) => { // every camera, even one taken out, so adding it back finds frames waiting
      gl.render(pose, DEMO.intr, quads);
      outs[k].getContext('2d').drawImage(gl.canvas, 0, 0);
    });
  };
  frameAll(performance.now() + 100);
  const stopSims = startSimBoards(t0);
  S.demo = { streams: outs.map((cv) => cv.captureStream(30)), stop() { run = false; stopSims(); }, atHome: () => demoAtHome((performance.now() - t0) / 1000 - DEMO_LAG) };
}

// ---------------- the setup guide ----------------
// Four short steps on first visit (and from Settings): a camera, your tags (how many, their IDs and sizes, printed or on
// a phone), the lens, and the start pose. "Show this when the page opens" is settings.setup.
const SETUP = { step: 0, n: 3, vals: null };
// the default IDs are the demo's: its chest is tag 2, its left hand's front tag 1 and its right hand's 0
const SETUP_ROLES = [{ k: 'body', name: 'Body', id: 2 }, { k: 'left', name: 'Left wrist', id: 1 }, { k: 'right', name: 'Right wrist', id: 0 }];
const setupRoles = () => SETUP_ROLES.slice(3 - SETUP.n);
function setupDefaults() {
  // what is set already: the robot's roles if they are tags, else tags named for the role, else 0, 1, 2
  const r = S.settings.robot, vals = {};
  for (const role of SETUP_ROLES) {
    const set = /^\d+$/.test(r[role.k]) ? tagOf(+r[role.k]) : null, named = S.tags.find((t) => t.name.toLowerCase() === role.name.toLowerCase()), t = set || named;
    vals[role.k] = { id: t ? t.id : role.id, size: +((t ? t.size : S.settings.tagSize) * 1000).toFixed(1) };
  }
  SETUP.n = r.body === 'none' ? (r.left === 'none' ? 1 : 2) : 3;
  return vals;
}
function renderSetupRoles() {
  const box = $('setupRoles');
  box.innerHTML = setupRoles().map((role) => `<span>${role.name}</span><label class="field">ID <input class="input sm num mono" type="number" min="0" step="1" data-sr="${role.k}" data-f="id"></label>` +
    `<label class="field">Size <input class="input sm num mono" type="number" min="5" max="2000" step="0.5" data-sr="${role.k}" data-f="size"><span class="unit">mm</span></label>`).join('');
  box.querySelectorAll('input').forEach((inp) => {
    inp.value = SETUP.vals[inp.dataset.sr][inp.dataset.f];
    inp.onchange = () => { const v = +inp.value; if (inp.value !== '' && isFinite(v)) SETUP.vals[inp.dataset.sr][inp.dataset.f] = v; $('setupShare').hidden = true; };
  });
  document.querySelectorAll('[data-setn]').forEach((b) => b.setAttribute('aria-checked', String(+b.dataset.setn === SETUP.n)));
}
document.querySelectorAll('[data-setn]').forEach((b) => { b.onclick = () => { SETUP.n = +b.dataset.setn; renderSetupRoles(); $('setupShare').hidden = true; }; });
// the chosen tags into the tag list (named for their roles) and the robot's roles
function applySetupTags() {
  const list = [], r = S.settings.robot;
  for (const role of setupRoles()) {
    const v = SETUP.vals[role.k];
    if (!(Number.isInteger(v.id) && v.id >= 0 && v.id < S.familyCount)) continue;
    if (!tagOf(v.id)) addTag(v.id, role.name);
    const t = tagOf(v.id);
    t.name = role.name;
    if (v.size >= 5 && v.size <= 2000) t.size = v.size / 1000;
    list.push({ id: v.id, name: role.name });
  }
  r.body = SETUP.n === 3 && list.length ? String(SETUP.vals.body.id) : 'none';
  r.left = SETUP.n >= 2 ? String(SETUP.vals.left.id) : 'none';
  r.right = String(SETUP.vals.right.id);
  saveSettings(); saveTags(); renderTags(); refreshFrameSel(); refreshTplotSel(); clearRobotCal(); resetTracks();
  return list;
}
$('setupPhone').onclick = () => {
  const box = $('setupShare');
  if (!box.hidden) { box.hidden = true; $('setupPhone').setAttribute('aria-expanded', 'false'); return; }
  const list = applySetupTags();
  if (list.length && onPhone()) { location.hash = tagsHash(list); return; } // already on the phone: show them here
  shareTagsTo(box, list); $('setupPhone').setAttribute('aria-expanded', 'true');
};
$('setupPrint').onclick = () => { const ids = applySetupTags().map((t) => t.id); openPrintDlg({ tags: ids, board: false }); };
$('setupStart').onclick = () => { $('emptyStart').click(); goSetup(1); };
$('setupDemo').onclick = () => { $('emptyDemo').click(); $('setupDlg').close(); };
$('setupCalib').onclick = () => { $('setupDlg').close(); setMode('calib'); };
function goSetup(step) {
  if (SETUP.step === 1 && step > 1) applySetupTags();
  SETUP.step = Math.max(0, Math.min(3, step));
  document.querySelectorAll('#setupDlg [data-step]').forEach((el) => { el.hidden = +el.dataset.step !== SETUP.step; });
  $('setupDots').querySelectorAll('i').forEach((d, i) => d.classList.toggle('on', i <= SETUP.step));
  $('setupBack').hidden = SETUP.step === 0;
  $('setupNext').textContent = SETUP.step === 3 ? 'Done' : 'Next';
  if (SETUP.step === 1) renderSetupRoles();
}
function openSetup(step) {
  SETUP.vals = setupDefaults(); SETUP.step = -1; $('setupShare').hidden = true;
  goSetup(step || 0); paintSetupSw();
  if (!$('setupDlg').open) $('setupDlg').showModal();
}
function paintSetupSw() { $('setupShowSw').setAttribute('aria-checked', String(S.settings.setup)); $('setupSw').setAttribute('aria-checked', String(S.settings.setup)); }
$('setupShowSw').onclick = () => { S.settings.setup = !S.settings.setup; saveSettings(); paintSetupSw(); };
$('setupBack').onclick = () => goSetup(SETUP.step - 1);
$('setupNext').onclick = () => { if (SETUP.step === 3) { goSetup(3); $('setupDlg').close(); setMode('track'); } else goSetup(SETUP.step + 1); };
$('setupDlg').querySelectorAll('[data-close]').forEach((b) => { b.onclick = () => $('setupDlg').close(); });
$('setupDlg').addEventListener('close', () => { SETUP.step = 0; }); // closing keeps what is set: only Next, Print and the phone link apply the tags
