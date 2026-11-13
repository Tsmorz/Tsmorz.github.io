// Tag tracker page, part of index.html's script: lens calibration and placing the cameras (Calibrate steps 1 to 4).
// The app-*.js files are classic scripts loaded in order and share one global scope; nothing in them runs
// another file's code at load (the boot script at the end of index.html starts everything).
'use strict';

// ---------------- calibration ----------------
// Steps 2 and 3 calibrate one camera's lens (S.calibCam, picked in step 2); step 4 places the cameras.
const calibCam = () => S.cams[S.calibCam] || null;
const calibKey = () => (calibCam() ? calibCam().label : '');
$('square').value = S.square;
$('square').onchange = () => { const v = +$('square').value; if (v >= 3 && v <= 200) { S.square = v; store.set('square', v); } else $('square').value = S.square; };
$('autoSw').onclick = () => { S.auto = !S.auto; $('autoSw').setAttribute('aria-checked', String(S.auto)); };
$('captureBtn').onclick = () => { const c = calibCam(); if (c && c.lastBoard && c.lastBoard.ids.length >= 6) capture(c, c.lastBoard); };
$('clearViews').onclick = () => { S.views = []; renderCalib(); };
$('solveBtn').onclick = () => {
  if (S.views.length < MIN_VIEWS) return;
  $('solveBtn').disabled = true; $('solveBtn').textContent = 'Solving…';
  const v0 = S.views[0];
  S.calibFor = calibKey();
  S.worker.postMessage({ type: 'calibrate', views: S.views.map((v) => ({ ids: v.ids, pts: v.pts })), w: v0.w, h: v0.h, square: S.square / 1000 });
};
function renderCalibCams() {
  const sel = $('calibCamSel');
  sel.innerHTML = S.cams.map((c, i) => `<option value="${i}">Camera ${c.n}: ${escapeHtml(camName(c))}</option>`).join('');
  sel.value = String(S.calibCam);
  $('calibCamWrap').hidden = S.cams.length < 2;
  const c = calibCam();
  $('calibFor').textContent = c ? `${camName(c)}, ${c.video.videoWidth || c.cam.w}×${c.video.videoHeight || c.cam.h}` : '';
}
$('calibCamSel').onchange = () => { S.calibCam = +$('calibCamSel').value; S.views = []; S.calibResult = null; for (const c of S.cams) clearOverlay(c); renderCalibCams(); renderCalib(); };
function onBoard(c, m) {
  tickStats(c, m.ms);
  if (S.mode !== 'calib') return;
  const prev = c.lastBoard;
  m.wall = performance.now() / 1000;
  c.lastBoard = m;
  c.still = m.ids.length >= 6 && C.cornerMotion(prev, m) < 0.8 ? c.still + 1 : 0;
  if (c === calibCam()) lensStep(c, m);
  rigStep();
  drawBoard(c, m);
}
// Step 2 for the camera being calibrated: auto-capture still, new views of the board.
function lensStep(c, m) {
  $('captureBtn').disabled = m.ids.length < 6 || c.demo !== null;
  let tip;
  if (c.demo !== null) tip = 'The demo cameras’ lenses are known exactly, so there is nothing to calibrate here. Place them in step 4.';
  else if (m.ids.length < 6) tip = 'Hold the whole board in view, flat and well lit.';
  else {
    const sig = C.viewSignature(m.pts, m.w, m.h), dmin = Math.min(Infinity, ...S.views.map((v) => C.signatureDistance(v.sig, sig)));
    const novel = dmin > 0.12, nowMs = performance.now();
    if (S.auto && novel && c.still >= 3 && nowMs - S.lastCapture > 700) capture(c, m, sig);
    tip = !novel ? 'Already have this view: tilt the board or move it towards an uncovered part of the frame.' : c.still < 3 ? 'Hold still…' : 'Good view.';
    if (S.views.length >= 4 && novel) {
      const cov = C.coverage(S.views.map((v) => v.pts), m.w, m.h, 6, 4);
      if (cov.fraction < 0.6) tip += ' Reach the edges and corners of the frame too.';
    }
  }
  $('calibTip').textContent = tip;
}
function flash(c) { const f = c.el.querySelector('.flash'); f.classList.add('on'); setTimeout(() => f.classList.remove('on'), 60); }
function capture(c, m, sig) {
  if (c.demo !== null) return;
  if (S.views.length && (S.views[0].w !== m.w || S.views[0].h !== m.h)) S.views = [];
  S.views.push({ ids: m.ids.slice(), pts: m.pts.map((p) => p.slice()), w: m.w, h: m.h, sig: sig || C.viewSignature(m.pts, m.w, m.h) });
  S.lastCapture = performance.now(); c.still = 0;
  flash(c);
  renderCalib();
}
function drawBoard(c, m) {
  const ctx = c.overlay.getContext('2d'), M = overlayMap(c), P = (p) => M.P(p[0], p[1]), u = M.dpr * M.k;
  ctx.clearRect(0, 0, M.W, M.H);
  // the lens views captured so far, faint: what the frame coverage looks like
  if (c === calibCam()) {
    ctx.fillStyle = 'rgba(76,194,122,.55)';
    for (const v of S.views) for (const p of v.pts) { const q = P(p); ctx.fillRect(q[0] - 1.5 * u, q[1] - 1.5 * u, 3 * u, 3 * u); }
  }
  ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 1 * u;
  for (const mk of m.markers) { ctx.beginPath(); for (let k = 0; k < 4; k++) { const q = P([mk[2 * k], mk[2 * k + 1]]); k ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); } ctx.closePath(); ctx.stroke(); }
  const ok = m.ids.length >= 6;
  for (const p of m.pts) { const q = P(p); ctx.fillStyle = ok ? K.accent : '#f59e0b'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 * u; ctx.beginPath(); ctx.arc(q[0], q[1], 3.5 * u, 0, 7); ctx.fill(); ctx.stroke(); }
}
function renderCalib() {
  const n = S.views.length;
  $('viewCount').textContent = `${n} / ${TARGET_VIEWS} views`;
  $('viewBar').style.width = Math.min(100, (100 * n) / TARGET_VIEWS) + '%';
  $('solveBtn').disabled = n < MIN_VIEWS; $('solveBtn').textContent = 'Calibrate';
  $('solveBtn').title = n < MIN_VIEWS ? `Capture at least ${MIN_VIEWS} views (${TARGET_VIEWS} is better)` : '';
  $('clearViews').disabled = !n;
  const cov = n ? C.coverage(S.views.map((v) => v.pts), S.views[0].w, S.views[0].h, 6, 4) : { cells: new Uint8Array(24) };
  $('cov').innerHTML = [...cov.cells].map((x) => `<i class="${x ? 'on' : ''}"></i>`).join('');
  const list = $('viewList');
  list.innerHTML = S.views.map((v, i) => `<span class="chip"><span class="mono">${i + 1}</span><span class="muted">${v.ids.length} corners</span><button aria-label="Remove view ${i + 1}" data-i="${i}" style="background:none;color:var(--muted)">×</button></span>`).join('');
  list.querySelectorAll('button').forEach((b) => { b.onclick = () => { S.views.splice(+b.dataset.i, 1); renderCalib(); }; });
  if (!S.cams.length) $('calibTip').textContent = 'Start the camera and hold the board in view.';
  renderCalibStatus();
}
function renderCalibStatus() {
  const saved = S.calibs[calibKey()], out = $('calibResult');
  $('exportBtn').disabled = !saved; $('forgetBtn').disabled = !saved;
  if (!out) return;
  const c = (S.calibResult && S.calibResult.camera === calibKey() && S.calibResult) || saved;
  if (!c) { out.innerHTML = '<p class="hint">Until this camera is calibrated, distances use a field-of-view guess and can be off by 10% or more.</p>'; return; }
  const q = c.rms < 0.5 ? ['good', 'i-check', 'Good'] : c.rms < 1 ? ['warn', 'i-alert', 'Usable'] : ['bad', 'i-alert', 'Poor'];
  const fresh = S.calibResult && S.calibResult === c && c.date && Date.now() - Date.parse(c.date) < 6e5;
  out.innerHTML = `<div class="row" style="margin-bottom:8px"><span class="badge ${q[0]}"><svg class="i"><use href="#${q[1]}"/></svg>${q[2]}</span><span class="mono">RMS ${c.rms.toFixed(3)} px</span><span class="muted small">${fresh ? 'New and saved' : 'Saved'}: ${c.w}×${c.h}${c.views ? ', from ' + c.views + ' views' : ''}</span></div>
    <dl class="kv mono">
      <dt>focal</dt><dd>fx ${c.fx.toFixed(1)}, fy ${c.fy.toFixed(1)} px${c.sd ? ` (± ${c.sd.fx.toFixed(1)})` : ''}</dd>
      <dt>centre</dt><dd>${c.cx.toFixed(1)}, ${c.cy.toFixed(1)} px</dd>
      <dt>field of view</dt><dd>${C.hfov(c).toFixed(1)}° wide</dd>
      <dt>distortion</dt><dd>k1 ${c.dist[0].toFixed(4)}, k2 ${c.dist[1].toFixed(4)}, p1 ${c.dist[2].toFixed(4)}, p2 ${c.dist[3].toFixed(4)}</dd>
    </dl>
    ${c.rms >= 0.5 ? '<p class="hint" style="margin-top:8px">Under 0.5 px is good. To improve: lock focus, light the board evenly, keep it flat and still, and add views tilted 30–45° and near the frame corners.</p>' : ''}`;
}
function onCalibrated(c) {
  const key = S.calibFor || calibKey();
  c.date = new Date().toISOString();
  c.camera = key;
  S.calibs[key] = c; store.set('calibs', S.calibs);
  S.calibResult = c;
  resetTracks();
  S.cams.forEach(updateCam); renderCalib();
}
$('forgetBtn').onclick = () => { const k = calibKey(); if (!confirm(`Forget the calibration for “${calibCam() ? camName(calibCam()) : k}”?`)) return; delete S.calibs[k]; store.set('calibs', S.calibs); S.calibResult = null; S.cams.forEach(updateCam); renderCalib(); };
$('exportBtn').onclick = () => {
  const c = S.calibs[calibKey()]; if (!c) return;
  const blob = new Blob([JSON.stringify(Object.assign({ format: 'tag-tracker-calibration/1' }, c), null, 2)], { type: 'application/json' });
  download(blob, `calibration-${slug(calibKey())}-${c.w}x${c.h}.json`);
};
$('importBtn').onclick = () => $('importFile').click();
$('importFile').onchange = async () => {
  const f = $('importFile').files[0]; $('importFile').value = '';
  if (!f || !calibCam()) return;
  try {
    const c = JSON.parse(await f.text()), err = C.checkCalibration(c);
    if (err) throw new Error(err);
    c.rms = typeof c.rms === 'number' ? c.rms : 0;
    S.calibs[calibKey()] = c; store.set('calibs', S.calibs); S.calibResult = null; resetTracks(); S.cams.forEach(updateCam); renderCalib();
  } catch (e) { $('calibResult').innerHTML = `<div class="note warn"><svg class="i"><use href="#i-alert"/></svg><span>That file isn’t a calibration (${escapeHtml(e.message)}).</span></div>`; }
};
function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'camera'; }
function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }

// ---------------- placing the cameras (step 4) ----------------
// A rig view is one still pose of the board seen whole by two or more cameras at once: each camera's corners and
// its own estimate of the board's pose. calibrateRig solves every camera's pose relative to camera 1 from all of
// them together. Views are kept by camera key, so a camera can be removed and added back.
const RIG_MIN = 4, RIG_TARGET = 12;
$('rigAutoSw').onclick = () => { S.rigAuto = !S.rigAuto; $('rigAutoSw').setAttribute('aria-checked', String(S.rigAuto)); };
$('rigClear').onclick = () => { S.rigViews = []; renderRig(); };
$('rigForget').onclick = () => { if (!confirm('Forget where the cameras are?')) return; S.rig = null; S.rigFresh = null; store.set('rig', null); placeCams(); resetTracks(); renderRig(); layoutTiles(); };
// the cameras that see the whole board now, held still
function rigReady() {
  const now = performance.now() / 1000;
  return S.cams.filter((x) => x.lastBoard && x.lastBoard.pose && x.lastBoard.ids.length >= 6 && now - x.lastBoard.wall < 0.3 && x.still >= 3);
}
function rigStep() {
  if (S.cams.length < 2) return;
  const ready = rigReady(), now = performance.now() / 1000;
  $('rigCapture').disabled = ready.length < 2;
  if (!S.rigAuto || ready.length < 2 || now - S.lastRig < 1) return;
  // new: the board somewhere else (10 cm or 10°) for at least one of these cameras than in every earlier view
  const novel = ready.some((x) => S.rigViews.every((v) => {
    const o = v.obs.find((q) => q.key === x.key), p = x.lastBoard.pose;
    return !o || C.norm(C.sub(o.pose.t, p.t)) > 0.1 || C.angleOf(C.mul3(C.tr3(o.pose.R), p.R)) > 0.17;
  }));
  if (novel) captureRig(ready);
}
function captureRig(ready) {
  S.rigViews.push({ obs: ready.map((x) => ({ key: x.key, obj: x.lastBoard.pose.obj, pts: x.lastBoard.pts.map((p) => p.slice()), pose: { R: x.lastBoard.pose.R, t: x.lastBoard.pose.t } })) });
  S.lastRig = performance.now() / 1000;
  for (const x of ready) { x.still = 0; flash(x); }
  renderRig();
}
$('rigCapture').onclick = () => { const r = rigReady(); if (r.length >= 2) captureRig(r); };
$('rigSolve').onclick = () => {
  const keys = S.cams.map((c) => c.key);
  const views = S.rigViews.map((v) => ({ obs: v.obs.filter((o) => keys.includes(o.key)).map((o) => ({ cam: keys.indexOf(o.key), obj: o.obj, pts: o.pts, pose: o.pose })) })).filter((v) => v.obs.length >= 2);
  const r = C.calibrateRig(S.cams.map((c) => c.cam), views);
  S.rig = { keys, labels: S.cams.map(camName), poses: r.poses, rms: r.rms, perCam: r.perCam, views: r.views, date: new Date().toISOString() };
  S.rigFresh = S.rig;
  store.set('rig', S.rig);
  placeCams(); resetTracks(); renderRig(); layoutTiles();
};
// The demo knows where its cameras really are: how far the solved rig is from that.
function demoTruth(c) {
  const c0 = S.cams[0];
  if (!S.demo || c.demo === null || c0.demo === null) return null;
  return C.compose(C.inverse(DEMO.cams[c0.demo]), DEMO.cams[c.demo]);
}
function renderRig() {
  const many = S.cams.length > 1, n = S.rigViews.length;
  $('rigCount').textContent = `${n} / ${RIG_TARGET} views`;
  $('rigBar').style.width = Math.min(100, (100 * n) / RIG_TARGET) + '%';
  $('rigSolve').disabled = !many || n < RIG_MIN;
  $('rigSolve').title = n < RIG_MIN ? `Capture at least ${RIG_MIN} views (${RIG_TARGET} is better)` : '';
  $('rigClear').disabled = !n; $('rigForget').disabled = !S.rig;
  $('rigCapture').disabled = true;
  $('rigTip').textContent = !many ? 'Run two or more cameras (Add camera, above the views) to place them relative to each other.'
    : `Hold the board still where at least two cameras see all of it, until their views flash; then move it somewhere new and hold again. ${S.demo ? 'In the demo the board moves and holds by itself.' : 'Calibrate each lens first (steps 2 and 3) for the best result.'}`;
  // per camera: the views it is in, and where the rig puts it
  const fmt = (v) => (v >= 0 ? '+' : '−') + Math.abs(v * 100).toFixed(1);
  const rows = S.cams.map((c) => {
    const inViews = S.rigViews.filter((v) => v.obs.some((o) => o.key === c.key)).length;
    const i = S.rig ? S.rig.keys.indexOf(c.key) : -1, pc = i >= 0 && S.rig.perCam ? S.rig.perCam[i] : null;
    let where = c.n === 1 ? '<span class="muted">the origin</span>' : '<span class="muted">not placed</span>';
    if (c.n > 1 && c.T) {
      const v = C.toView(c.T).t, truth = demoTruth(c);
      where = `<span class="mono">${fmt(v[0])}, ${fmt(v[1])}, ${fmt(v[2])}</span> <span class="muted">cm, turned</span> <span class="mono">${(C.angleOf(c.T.R) * 180 / Math.PI).toFixed(1)}°</span>` +
        (truth ? `<div class="small truth">Demo truth: off by ${(C.norm(C.sub(c.T.t, truth.t)) * 1000).toFixed(1)} mm and ${(C.angleOf(C.mul3(C.tr3(truth.R), c.T.R)) * 180 / Math.PI).toFixed(2)}°</div>` : '');
    }
    return `<tr><td><b>${c.n}</b> ${escapeHtml(camName(c))}</td><td class="num mono">${inViews}</td><td>${where}</td><td class="num mono">${pc && isFinite(pc.rms) ? pc.rms.toFixed(2) + ' px' : '—'}</td></tr>`;
  }).join('');
  $('rigRows').innerHTML = rows || '<tr><td colspan="4" class="muted">No cameras running.</td></tr>';
  const r = S.rig;
  $('rigResult').innerHTML = r ? `<div class="row"><span class="badge ${r.rms < 0.5 ? 'good' : r.rms < 1 ? 'warn' : 'bad'}"><svg class="i"><use href="#${r.rms < 1 ? 'i-check' : 'i-alert'}"/></svg>${r.rms < 0.5 ? 'Good' : r.rms < 1 ? 'Usable' : 'Poor'}</span><span class="mono">RMS ${r.rms.toFixed(3)} px</span><span class="muted small">${S.rigFresh === r ? 'New and saved' : 'Saved'}: ${r.keys.length} cameras from ${r.views} views</span></div>` : '';
}
