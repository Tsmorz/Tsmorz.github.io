// Tag tracker page, part of index.html's script: the detection workers, cameras, arranging their views, search windows, the frame loop, tracking results, video overlays, rigid objects.
// The app-*.js files are classic scripts loaded in order and share one global scope; nothing in them runs
// another file's code at load (the boot script at the end of index.html starts everything).
'use strict';

// ---------------- worker ----------------
// Detection runs in a pool of workers, each with its own OpenCV: every camera's frames go to whichever worker is
// idle, so frames are detected in parallel (one camera keeps several in flight). The first worker also calibrates
// and draws tags and boards; the others start once it is ready, when OpenCV.js is already in the browser's cache.
const POOL = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
function spawnWorker() {
  const base = /\/$|\.html?$/.test(location.pathname) ? '' : location.pathname + '/';
  const w = new Worker(base + 'worker.js?v=f6d02eae'), slot = { w, ready: false, busy: false, first: !S.pool.length };
  S.pool.push(slot);
  w.onmessage = (ev) => onWorker(ev.data, slot);
  w.onerror = (e) => { if (slot.first) status('Detector failed to start', 'bad'); else S.pool = S.pool.filter((x) => x !== slot); console.error(e); };
  w.postMessage({ type: 'init', family: S.settings.family, quality: S.quality });
  return slot;
}
function startWorker() { S.pool = []; S.worker = spawnWorker().w; }
function toWorkers(msg) { for (const x of S.pool) if (x.ready) x.w.postMessage(msg); }
// A worker for camera c's next frame: an idle one, as long as c has no more than its share of the pool in flight.
function idleWorker(c) {
  const ready = S.pool.filter((x) => x.ready);
  if (c.inflight >= Math.max(1, Math.ceil(ready.length / Math.max(1, S.cams.length)))) return null;
  return ready.find((x) => !x.busy) || null;
}
const pending = new Map(); // printing windows waiting for an image
let workerReadyResolve = null;
const workerReady = new Promise((res) => { workerReadyResolve = res; }); // requests sent before this are dropped by the worker
function onWorker(m, slot) {
  if (!slot.first && m.type !== 'tags' && m.type !== 'board' && m.type !== 'ready' && !(m.type === 'error' && m.of === 'frame')) return;
  if (m.type === 'status') status(m.text, 'busy');
  else if (m.type === 'ready' && !slot.first) {
    slot.ready = true;
    slot.w.postMessage({ type: 'family', family: S.settings.family, quality: S.quality }); // in case it changed while loading
  } else if (m.type === 'ready') {
    slot.ready = true;
    for (let k = 1; k < POOL; k++) spawnWorker();
    S.ready = true; S.familyCount = m.count; workerReadyResolve();
    status(S.running ? 'Detecting…' : '', S.running ? 'live' : '');
    $('emptyDemo').disabled = false;
  } else if (m.type === 'family') { S.familyCount = m.count; }
  else if (m.type === 'tags' || m.type === 'board') {
    slot.busy = false;
    const c = camOf(m.src);
    if (!c) return;
    c.inflight = Math.max(0, c.inflight - 1);
    if (m.seq <= c.doneSeq) return; // overtaken by a later frame from another worker
    c.doneSeq = m.seq;
    if (m.type === 'tags') onTags(c, m); else onBoard(c, m);
  }
  else if (m.type === 'calibrated') onCalibrated(m.calib);
  else if (m.type === 'boardImage' || m.type === 'tagImage') {
    const cb = pending.get(m.purpose);
    if (cb) { pending.delete(m.purpose); cb(m.img); }
  } else if (m.type === 'error') {
    if (m.of === 'frame') { slot.busy = false; const c = camOf(m.src); if (c) c.inflight = Math.max(0, c.inflight - 1); return; }
    if (m.of === 'init') { status('Could not load the detector', 'bad'); showEmpty('The detector didn’t load', 'OpenCV.js (about 10 MB) is fetched from a CDN the first time. Check your connection and reload the page.'); }
    if (m.of === 'calibrate') { $('solveBtn').disabled = S.views.length < MIN_VIEWS; $('solveBtn').textContent = 'Calibrate'; $('calibResult').innerHTML = `<div class="note warn"><svg class="i"><use href="#i-alert"/></svg><span>Calibration failed: ${escapeHtml(m.text)}</span></div>`; }
    console.warn('worker:', m.of, m.text);
  }
}
function requestImage(type, args) {
  const purpose = type + ':' + Math.random();
  return new Promise((res) => { pending.set(purpose, res); S.worker.postMessage(Object.assign({ type, purpose }, args)); });
}

// ---------------- cameras ----------------
// S.cams holds every running camera; the first is camera 1, whose frame is the rig's (and the plot's). Each:
// { n, key (device id, or demo:k), label, demo (index or null), stream, track, video, overlay, el (its tile), cam (its
//   intrinsics), lens, T (its pose in camera 1's frame from the saved rig, null if not placed), busy, seq, stats,
//   last (its latest tags), local (its own poses), lastBoard, still }
let devices = [];
const camOf = (key) => S.cams.find((c) => c.key === key) || null;
async function listCameras() {
  const sel = $('camSel');
  try { devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput'); } catch (e) { devices = []; }
  const first = S.cams[0], cur = first ? (first.demo !== null ? 'demo' : first.key) : S.camId || (devices[0] && devices[0].deviceId) || '';
  sel.innerHTML = devices.map((c, i) => `<option value="${escapeHtml(c.deviceId)}">${escapeHtml(nameFor(c.deviceId, c.label || 'Camera ' + (i + 1)))}</option>`).join('') + '<option value="demo">Demo (3 cameras)</option>';
  sel.value = [...sel.options].some((o) => o.value === cur) ? cur : sel.options[0].value;
  paintAddCam();
}
function deviceLabel(id) { const i = devices.findIndex((d) => d.deviceId === id); return i < 0 ? 'Camera' : devices[i].label || 'Camera ' + (i + 1); }
// A camera's name: the one the visitor gave it, else the device's own label (or Demo k).
const nameFor = (key, fallback) => S.camNames[key] || fallback;
const camName = (c) => nameFor(c.key, c.label);
// what can still be added: real cameras not running or, in the demo, demo cameras not running
function paintAddCam() {
  const opts = S.demo ? DEMO.cams.map((_, k) => k).filter((k) => !camOf('demo:' + k)).map((k) => ['demo:' + k, nameFor('demo:' + k, `Demo ${k + 1}`)])
    : devices.filter((d) => d.deviceId && !camOf(d.deviceId)).map((d) => [d.deviceId, nameFor(d.deviceId, deviceLabel(d.deviceId))]);
  $('addCamWrap').hidden = !S.cams.length || !opts.length;
  $('camsFullBtn').hidden = !S.cams.length;
  $('addCamSel').innerHTML = opts.map(([v, l]) => `<option value="${escapeHtml(v)}">${escapeHtml(l)}</option>`).join('');
}
if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener('devicechange', listCameras);
$('camSel').onchange = () => {
  const v = $('camSel').value;
  if (v !== 'demo') { S.camId = v; store.set('camId', v); }
  if (S.running) start();
};
$('resSel').value = S.res;
$('resSel').onchange = () => { S.res = $('resSel').value; store.set('res', S.res); if (S.running && !S.demo) start(); };
$('startBtn').onclick = () => (S.running ? stop() : start());
$('emptyStart').onclick = () => { if ($('camSel').value === 'demo') $('camSel').value = S.camId || $('camSel').options[0].value; start(); };
$('emptyDemo').onclick = () => { $('camSel').value = 'demo'; start(); };
$('emptyDemo').disabled = true;
$('addCamBtn').onclick = () => { const k = $('addCamSel').value; if (k) addCamera(k).catch(camError); };

function showEmpty(title, text) {
  $('stage').hidden = false;
  $('empty').hidden = false;
  $('empty').querySelector('h3').textContent = title;
  $('empty').querySelector('p').textContent = text;
}
// Start camera 1 from the top bar. Other real cameras that were running come back too (a new resolution, or a
// different first camera, restarts them all); the demo starts its three cameras.
async function start() {
  const first = $('camSel').value, useDemo = first === 'demo';
  if (useDemo && !S.ready) { status('Demo starts once the detector loads', 'busy'); return; }
  const others = useDemo || S.demo ? [] : S.cams.map((c) => c.key).filter((k) => k && k !== first);
  stop(true);
  try {
    if (useDemo) { await startDemo(); for (let k = 0; k < DEMO.cams.length; k++) await addCamera('demo:' + k); }
    else {
      await addCamera(first);
      for (const k of others) await addCamera(k).catch((e) => console.warn(e));
    }
    status(S.ready ? 'Detecting…' : 'Loading detector…', S.ready ? 'live' : 'busy');
  } catch (e) { stop(true); camError(e); }
}
function camError(e) {
  console.warn(e);
  const msg = e.name === 'NotAllowedError' ? ['Camera access was blocked', 'Allow the camera for this site in the address bar, then press Start again.']
    : e.name === 'NotFoundError' || e.name === 'OverconstrainedError' ? ['No camera found', 'Plug in a camera, or pick another one from the list. You can also try the demo.']
    : e.name === 'NotReadableError' ? ['The camera is busy', 'Another app or tab is using it. Close that, then try again.']
    : ['Couldn’t start the camera', e.message || String(e)];
  if (S.cams.length) status(msg[0], 'bad');
  else { showEmpty(msg[0], msg[1]); status('Camera off', 'bad'); }
}
function makeTile(c) {
  const el = document.createElement('div');
  el.className = 'stage live'; el.tabIndex = 0;
  el.innerHTML = `<video playsinline muted></video><canvas aria-hidden="true"></canvas><div class="reticle" aria-hidden="true"></div><div class="flash"></div>
    <span class="tl"></span><button class="tbtn rm" title="Remove this camera"><svg class="i"><use href="#i-x"/></svg></button>
    <span class="vstats mono" hidden></span><span class="rs" aria-hidden="true" title="Drag to resize"></span>`;
  el.querySelector('.rm').onclick = () => removeCamera(c);
  el.querySelector('.tl').addEventListener('click', (e) => { if (e.target.closest('.nm')) renameCamera(c); });
  arrangeHandlers(c, el);
  return el;
}
async function addCamera(key) {
  if (camOf(key)) return;
  const demo = key.startsWith('demo:') ? +key.slice(5) : null;
  let stream;
  if (demo !== null) stream = S.demo.streams[demo];
  else {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw Object.assign(new Error('This browser has no camera access here. Use Chrome or Edge over https.'), { name: 'NoAPI' });
    const [w, h] = S.res.split('x').map(Number);
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { deviceId: key ? { exact: key } : undefined, width: { ideal: w }, height: { ideal: h }, frameRate: { ideal: 60 } } });
  }
  const c = { key, demo, stream, track: stream.getVideoTracks()[0], inflight: 0, seq: 0, doneSeq: 0, sinceFull: 0, forceFull: false, expect: new Map(), prevCtr: null, last: null, local: new Map(), lastBoard: null, still: 0, T: null, stats: { frames: 0, dets: 0, ms: 0, t0: performance.now(), fps: 0, dfps: 0 } };
  if (demo === null) {
    const st = c.track.getSettings();
    if (st.deviceId) c.key = st.deviceId;
    if (camOf(c.key)) { stream.getTracks().forEach((t) => t.stop()); return; } // the default camera, already running
  }
  c.el = makeTile(c); c.video = c.el.querySelector('video'); c.overlay = c.el.querySelector('canvas');
  $('stages').appendChild(c.el);
  c.video.srcObject = stream;
  c.video.addEventListener('loadedmetadata', () => { updateCam(c); layoutTiles(); });
  await c.video.play();
  S.cams.push(c);
  if (demo === null) {
    if (S.cams.length === 1) { S.camId = c.key; store.set('camId', c.key); }
    await listCameras(); // labels appear once the camera is allowed
    c.label = deviceLabel(c.key);
  } else c.label = `Demo ${demo + 1}`;
  onCamsChanged();
  loopFrames(c);
}
function removeCamera(c) {
  if (S.cams.length === 1) { stop(); return; }
  if (c.demo === null) c.stream.getTracks().forEach((t) => t.stop());
  c.gone = true; c.video.srcObject = null; c.el.remove();
  S.cams = S.cams.filter((x) => x !== c);
  onCamsChanged();
}
// Rename a camera in place: its name turns into a text box; Enter or leaving it keeps the name, Escape doesn't. An
// empty name goes back to the device's own.
function renameCamera(c) {
  const tl = c.el.querySelector('.tl'), btn = tl.querySelector('.nm');
  if (!btn) return;
  const inp = document.createElement('input');
  inp.className = 'nm-in'; inp.maxLength = 40; inp.value = camName(c); inp.placeholder = c.label;
  inp.setAttribute('aria-label', `Name of camera ${c.n}`);
  btn.replaceWith(inp); inp.focus(); inp.select();
  let done = false;
  const finish = (keep) => {
    if (done) return;
    done = true;
    const v = inp.value.trim();
    if (keep) { if (!v || v === c.label) delete S.camNames[c.key]; else S.camNames[c.key] = v; store.set('camNames', S.camNames); }
    inp.remove();
    paintNames();
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true); c.el.focus(); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); c.el.focus(); } e.stopPropagation(); });
  inp.addEventListener('blur', () => finish(true));
}
// Everything that shows a camera's name.
function paintNames() { S.cams.forEach(paintTile); renderCalibCams(); renderRig(); paintAddCam(); listCameras(); }

// After cameras come or go: number them, place them from the saved rig, and lay out their tiles.
function onCamsChanged() {
  const first = S.cams.length ? S.cams[0].key : null;
  S.cams.forEach((c, i) => { c.n = i + 1; });
  S.running = S.cams.length > 0;
  if (first !== S.firstKey) { S.firstKey = first; resetTracks(); S.tare.clear(); paintTare(); robotReset(); } // the rig's frame moved
  placeCams();
  $('stage').hidden = S.running;
  $('stages').classList.toggle('multi', S.cams.length > 1);
  $('arrangeWrap').hidden = S.cams.length < 2;
  $('startBtn').innerHTML = S.running ? '<svg class="i"><use href="#i-stop"/></svg><span>Stop</span>' : '<svg class="i"><use href="#i-cam"/></svg><span>Start</span>';
  $('startBtn').classList.toggle('primary', !S.running); $('startBtn').classList.toggle('outline', S.running);
  if (S.running && $('camSel').value !== (S.demo ? 'demo' : first) && [...$('camSel').options].some((o) => o.value === first)) $('camSel').value = first;
  for (const c of S.cams) updateCam(c);
  if (S.calibCam >= S.cams.length) S.calibCam = 0;
  paintAddCam(); setupFocus(); renderCalibCams(); renderCalib(); renderRig(); layoutTiles();
}
// Each camera's pose in camera 1's frame, from the saved rig. Changing it moves the fused tracks, so they restart.
// Each camera's corners are trusted to their own scatter plus a model error: how well the rig fitted that camera (its
// reprojection RMS in the multi-camera calibration), at least MODEL_PX. Without it, the small disagreements a rig
// calibration always leaves look like motion, and the filter chases them.
const MODEL_PX = 0.25;
function placeCams() {
  const T = C.placeCameras(S.rig, S.cams.map((c) => c.key));
  S.cams.forEach((c, i) => {
    c.T = T[i];
    const k = S.rig ? S.rig.keys.indexOf(c.key) : -1, pc = k >= 0 && S.rig.perCam ? S.rig.perCam[k] : null;
    c.modelPx = Math.max(MODEL_PX, pc && isFinite(pc.rms) ? pc.rms : 0);
  });
  S.cams.forEach(paintTile);
}
function stop(quiet) {
  for (const c of S.cams) { if (c.demo === null) c.stream.getTracks().forEach((t) => t.stop()); c.gone = true; c.video.srcObject = null; c.el.remove(); }
  S.cams = [];
  if (S.demo) { S.demo.stop(); S.demo = null; }
  const cb = $('camsBox'); cb.classList.remove('full'); document.documentElement.classList.remove('cams-full'); $('camsExit').hidden = true;
  if (document.fullscreenElement === cb) document.exitFullscreen();
  onCamsChanged();
  $('focusWrap').hidden = true;
  if (!quiet) { showEmpty('Camera stopped', 'Press Start to carry on. Your tags, settings and calibrations are kept in this browser.'); status(S.ready ? '' : 'Loading detector…', S.ready ? '' : 'busy'); }
}
// Focus: a camera that refocuses changes its focal length, so locking it keeps a calibration valid. The switch
// locks every running camera that can.
function focusCams() {
  return S.cams.filter((c) => { const caps = c.track && c.track.getCapabilities ? c.track.getCapabilities() : {}; return caps.focusMode && caps.focusMode.includes('manual') && caps.focusMode.includes('continuous'); });
}
function setupFocus() { const n = focusCams().length; $('focusWrap').hidden = !n; if (!n) $('focusSw').setAttribute('aria-checked', 'false'); }
$('focusSw').onclick = async () => {
  const on = $('focusSw').getAttribute('aria-checked') !== 'true';
  for (const c of focusCams()) {
    try { const cur = c.track.getSettings(); await c.track.applyConstraints({ advanced: [on ? { focusMode: 'manual', focusDistance: cur.focusDistance } : { focusMode: 'continuous' }] }); } catch (e) { console.warn(e); }
  }
  $('focusSw').setAttribute('aria-checked', String(on));
};

// A camera's model: its calibration (rescaled if the resolution changed), else a guess. Demo lenses are exact.
function updateCam(c) {
  const w = c.video.videoWidth || 1280, h = c.video.videoHeight || 720;
  const saved = c.demo !== null ? null : S.calibs[c.label];
  const scaled = saved ? C.scaleIntrinsics(saved, w, h) : null;
  c.cam = c.demo !== null ? DEMO.intr : scaled || C.guessIntrinsics(w, h, S.settings.hfov);
  if (c.demo !== null) { c.lens = ['good', 'simulated']; c.lensTitle = 'A simulated 70° camera; its lens is known exactly.'; }
  else if (scaled) {
    c.lens = ['good', scaled.scaledFrom ? 'calibrated, scaled' : 'calibrated'];
    c.lensTitle = `${saved.w}×${saved.h}, RMS ${saved.rms.toFixed(2)} px, ${C.hfov(scaled).toFixed(1)}° wide` + (scaled.scaledFrom ? '. Calibrated at another resolution with the same shape; recalibrate at this one for the best accuracy.' : '');
  } else {
    c.lens = ['warn', saved ? 'calibration doesn’t fit' : 'not calibrated'];
    c.lensTitle = saved ? `The saved calibration is for ${saved.w}×${saved.h}, a different shape. Using a ${S.settings.hfov}° guess; recalibrate at ${w}×${h}.` : `Using a ${S.settings.hfov}° field-of-view guess. Distances can be off by 10% or more until you calibrate.`;
  }
  paintTile(c);
  $('fovField').hidden = !S.cams.some((x) => x.lens[0] === 'warn');
  if (c === S.cams[S.calibCam]) { $('calibFor').textContent = `${camName(c)}, ${w}×${h}`; renderCalibStatus(); }
}
function paintTile(c) {
  if (!c.el || !c.lens) return;
  const place = c.n === 1 ? null : c.T ? ['good', 'placed', 'Its position relative to camera 1 is known, so its tags are combined with the other cameras’.'] : ['warn', 'not placed', 'Place the cameras (Calibrate, step 4) to combine its tags with camera 1’s.'];
  if (c.el.querySelector('.tl .nm-in')) return; // being renamed: leave the text box alone
  c.el.querySelector('.tl').innerHTML = `<b>${c.n}</b><button class="nm" title="Rename this camera">${escapeHtml(camName(c))}</button><span class="st ${c.lens[0]}" title="${escapeHtml(c.lensTitle)}">${c.lens[1]}</span>` +
    (place ? `<span class="st ${place[0]}" title="${place[2]}">${place[1]}</span>` : '');
  c.el.title = `Camera ${c.n}: ${camName(c)}${S.camNames[c.key] ? ` (${c.label})` : ''}. Lens ${c.lens[1]}${place ? ', ' + place[1] : ''}.` + (S.cams.length > 1 ? ' Drag to move this view, its corner to resize it.' : '');
  c.el.setAttribute('aria-label', `Camera ${c.n}, ${camName(c)}, lens ${c.lens[1]}${place ? ', ' + place[1] : ''}. Arrow keys move this view, plus and minus resize it.`);
  c.el.querySelector('.rm').setAttribute('aria-label', `Remove camera ${c.n}`);
}

// ---------------- arranging the camera views ----------------
// The views sit in #stages like monitors in a display-settings panel, in "picture pixels" (each tile as big as its
// camera's picture). Auto places each camera where the rig says it is, as seen from behind camera 1; until the
// cameras are placed they go in rows. Drag a view to move it, or its corner to resize it, and the arrangement
// turns Custom and is kept per camera. The whole arrangement is scaled to the card's width.
const ARR_GAP = 40;
function arrangement() {
  const size = (c) => { const w = c.video.videoWidth || (c.cam && c.cam.w) || 1280, h = c.video.videoHeight || (c.cam && c.cam.h) || 720; return [w, h]; };
  if (S.arrange.mode === 'auto' && $('stages').clientWidth < 500) {
    // a phone: one view under another, full width
    let y = 0;
    return S.cams.map((c) => { const [w, h] = size(c), r = { key: c.key, x: 0, y, w: 1280, h: (1280 * h) / w }; y += r.h + ARR_GAP; return r; });
  }
  if (S.arrange.mode === 'auto') {
    return C.arrangeTiles(S.cams.map((c) => {
      const [w, h] = size(c), v = c.T ? C.toView(c.T).t : null;
      return { key: c.key, w, h, pos: v ? [v[0], v[2]] : null };
    }), ARR_GAP);
  }
  const out = [];
  for (const c of S.cams) {
    const [w, h] = size(c), r = S.arrange.tiles[c.key];
    if (r) out.push({ key: c.key, x: r.x, y: r.y, w: r.w, h: (r.w * h) / w });
  }
  for (const c of S.cams) {
    if (out.some((r) => r.key === c.key)) continue;
    const [w, h] = size(c), right = out.length ? Math.max(...out.map((r) => r.x + r.w)) + ARR_GAP : 0, top = out.length ? Math.min(...out.map((r) => r.y)) : 0;
    out.push({ key: c.key, x: right, y: top, w, h });
  }
  return out;
}
function layoutTiles() {
  const box = $('stages');
  if (!S.cams.length) { box.style.height = ''; return; }
  const rects = arrangement(), x0 = Math.min(...rects.map((r) => r.x)), y0 = Math.min(...rects.map((r) => r.y));
  const bw = Math.max(...rects.map((r) => r.x + r.w)) - x0, bh = Math.max(...rects.map((r) => r.y + r.h)) - y0;
  const full = camsFull(), W = box.clientWidth || 600, maxH = full ? box.clientHeight || innerHeight : W < 500 ? Infinity : Math.max(220, innerHeight * (S.cams.length > 1 ? 0.62 : 0.7));
  const s = Math.min(W / bw, maxH / bh), ox = (W - bw * s) / 2, oy = full ? (maxH - bh * s) / 2 : 0;
  box.style.height = Math.round(bh * s) + 'px'; // full screen overrides it in CSS
  for (const r of rects) {
    const c = camOf(r.key);
    if (!c) continue;
    Object.assign(c.el.style, { left: ox + (r.x - x0) * s + 'px', top: oy + (r.y - y0) * s + 'px', width: r.w * s + 'px', height: r.h * s + 'px' });
  }
  S.layout = { s, rects };
  for (const c of S.cams) if (c.last && S.mode === 'track') drawOverlay(c); else if (c.lastBoard && S.mode === 'calib') drawBoard(c, c.lastBoard);
}
function paintArrange() { document.querySelectorAll('[data-arr]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.arr === S.arrange.mode))); }
// Switch to Custom keeping the views where they are now.
function toCustom() {
  if (S.arrange.mode === 'custom') return;
  for (const r of (S.layout && S.layout.rects) || []) S.arrange.tiles[r.key] = { x: r.x, y: r.y, w: r.w };
  S.arrange.mode = 'custom'; store.set('arrange', S.arrange); paintArrange();
}
document.querySelectorAll('[data-arr]').forEach((b) => {
  b.onclick = () => { if (b.dataset.arr === 'custom') toCustom(); else { S.arrange.mode = 'auto'; store.set('arrange', S.arrange); paintArrange(); } layoutTiles(); };
});
function arrangeHandlers(c, el) {
  let drag = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button, input') || S.cams.length < 2) return;
    toCustom();
    const r = S.arrange.tiles[c.key];
    if (!r) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, r: Object.assign({}, r), resize: !!e.target.closest('.rs'), left: el.offsetLeft, top: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
    el.setPointerCapture(e.pointerId); el.classList.add('dragging');
    e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    // while dragging, only this view moves, at the scale it started with; the arrangement refits on release
    if (drag.resize) { const w = Math.max(120, drag.w + dx); el.style.width = w + 'px'; el.style.height = (w * drag.h) / drag.w + 'px'; }
    else { el.style.left = drag.left + dx + 'px'; el.style.top = drag.top + dy + 'px'; }
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const s = (S.layout && S.layout.s) || 1, dx = (e.clientX - drag.x) / s, dy = (e.clientY - drag.y) / s;
    const r = drag.resize ? { x: drag.r.x, y: drag.r.y, w: Math.max(120 / s, drag.r.w + dx) } : { x: drag.r.x + dx, y: drag.r.y + dy, w: drag.r.w };
    S.arrange.tiles[c.key] = r; store.set('arrange', S.arrange);
    drag = null; el.classList.remove('dragging');
    layoutTiles();
  };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  el.addEventListener('keydown', (e) => {
    if (S.cams.length < 2 || e.target !== el) return;
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key], grow = { '+': 1.1, '=': 1.1, '-': 1 / 1.1 }[e.key];
    if (!d && !grow) return;
    toCustom();
    const r = S.arrange.tiles[c.key];
    if (!r) return;
    if (d) { r.x += d[0] * 80; r.y += d[1] * 80; } else r.w *= grow;
    store.set('arrange', S.arrange); layoutTiles(); e.preventDefault();
  });
}
paintArrange();
if ('ResizeObserver' in window) new ResizeObserver(() => layoutTiles()).observe($('stages'));

// ---------------- where to look ----------------
// Once a full search has found the tags, a camera's next frames search only where they should be (TagCore.planSearch):
// each tag it saw last, moved on by its own speed across the picture to this frame's time, with a margin of 40% of its
// size plus half the distance it moves; and, for a placed camera, every track the other cameras see that should be in
// its picture (so a tag coming into view is found without a full search). The whole picture is searched every
// FULL_EVERY frames, to find new tags, and on the next frame whenever a tag wasn't where it was predicted.
const FULL_EVERY = 10, HAS_VF = typeof VideoFrame === 'function';
const centroid = (cs) => [(cs[0] + cs[2] + cs[4] + cs[6]) / 4, (cs[1] + cs[3] + cs[5] + cs[7]) / 4];
function searchPlan(c, time) {
  if (S.mode !== 'track' || S.settings.search !== 'predicted' || c.forceFull || c.sinceFull >= FULL_EVERY - 1 || !c.last) return null;
  const preds = [], own = new Set(), age = Math.max(0, time - c.last.time);
  for (const t of c.last.tags) {
    const ctr = centroid(t.corners), prev = c.prevCtr && c.prevCtr.get(t.id), dt = prev ? c.last.time - prev.time : 0;
    const v = dt > 0.005 && dt < 0.2 ? [(ctr[0] - prev.ctr[0]) / dt, (ctr[1] - prev.ctr[1]) / dt] : [0, 0];
    const d = [v[0] * age, v[1] * age], cs = t.corners;
    const size = Math.sqrt(Math.abs((cs[0] - cs[4]) * (cs[3] - cs[7]) - (cs[2] - cs[6]) * (cs[1] - cs[5])) / 2);
    preds.push({ pts: [0, 1, 2, 3].map((k) => [cs[2 * k] + d[0], cs[2 * k + 1] + d[1]]), pad: 0.4 * size + 0.5 * Math.hypot(d[0], d[1]) + 12 });
    own.add(t.id);
  }
  if (c.T && S.cams.length > 1) for (const [key, f] of S.fused) {
    if (time - f.time > 0.25) continue;
    const parts = isBody(key) ? (bodyOf(key) ? bodyOf(key).members.map((mb) => ({ id: mb.id, pose: C.compose(f.pose, mb) })) : []) : [{ id: key, pose: f.pose }];
    const inv = C.inverse(c.T);
    for (const q of parts) {
      if (own.has(q.id)) continue;
      const P = C.compose(inv, q.pose), pts = C.tagCorners(sizeOf(q.id)).map((X) => C.project(c.cam, C.add(C.mulv(P.R, X), P.t)));
      if (pts.some((x) => !x) || pts.every((x) => x[0] < 0 || x[1] < 0 || x[0] > c.cam.w || x[1] > c.cam.h)) continue;
      const size = Math.hypot(pts[0][0] - pts[2][0], pts[0][1] - pts[2][1]) / Math.SQRT2;
      preds.push({ pts, pad: 0.5 * size + 20 });
    }
  }
  const plan = C.planSearch(preds, c.cam.w, c.cam.h);
  if (plan) plan.expect = [...own];
  return plan;
}

// ---------------- frame loop ----------------
// Each camera sends its newest frame to an idle worker of the pool, keeping up to its share of the pool busy.
function loopFrames(c) {
  const v = c.video, hasRVFC = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
  let lastT = -1;
  const step = (now, meta) => {
    if (c.gone) return;
    if (hasRVFC) v.requestVideoFrameCallback(step); else requestAnimationFrame(step);
    if (!hasRVFC) { if (v.currentTime === lastT) return; lastT = v.currentTime; }
    c.stats.frames++;
    if (v.videoWidth && (c.cam.w !== v.videoWidth || c.cam.h !== v.videoHeight)) { updateCam(c); layoutTiles(); }
    const slot = S.ready && v.videoWidth ? idleWorker(c) : null;
    if (!slot) return;
    let time = meta && meta.captureTime ? meta.captureTime : performance.now();
    if (Math.abs(time - performance.now()) > 1000) time = performance.now();
    slot.busy = true; c.inflight++;
    const release = () => { slot.busy = false; c.inflight = Math.max(0, c.inflight - 1); };
    const send = (pic) => {
      if (c.gone) { pic.close(); release(); return; }
      const sizes = sizesMap();
      const bodies = S.bodies.map((b) => ({ id: b.id, members: b.members.map((x) => ({ id: x.id, R: x.R, t: x.t, size: sizes[x.id] || S.settings.tagSize })) }));
      const square = S.mode === 'calib' ? (S.demo ? DEMO.square : S.square / 1000) : 0;
      const plan = searchPlan(c, time / 1000);
      if (plan) { c.sinceFull++; c.expect.set(c.seq + 1, plan.expect); } else c.sinceFull = 0;
      const msg = { type: 'frame', rois: plan ? plan.rois : null, src: c.key, seq: ++c.seq, time: time / 1000, mode: S.mode, cam: c.cam, square, sizes, defaultSize: S.settings.tagSize, bodies, raw: S.settings.pose === 'raw' && !S.learn, learn: !!S.learn };
      msg[pic instanceof ImageBitmap ? 'bitmap' : 'frame'] = pic;
      slot.w.postMessage(msg, [pic]);
    };
    // The frame goes to the worker as a WebCodecs VideoFrame where the browser has them: the worker then reads just the
    // pixels it searches, straight from the camera's own format. Otherwise as an ImageBitmap.
    let vf = null;
    if (HAS_VF) try { vf = new VideoFrame(v, { timestamp: Math.round(time * 1000) }); } catch (e) { vf = null; }
    if (vf) send(vf); else createImageBitmap(v).then(send).catch(release);
  };
  if (hasRVFC) v.requestVideoFrameCallback(step); else requestAnimationFrame(step);
}
function tickStats(c, ms) {
  const st = c.stats, now = performance.now();
  st.dets++; st.ms = st.ms ? st.ms * 0.9 + ms * 0.1 : ms;
  if (now - st.t0 < 1000) return;
  st.fps = (st.frames * 1000) / (now - st.t0); st.dfps = (st.dets * 1000) / (now - st.t0);
  st.frames = 0; st.dets = 0; st.t0 = now;
  const vs = c.el.querySelector('.vstats'), many = S.cams.length > 1;
  vs.hidden = false;
  const part = c.searched != null && c.searched < 0.98 ? Math.max(1, Math.round(c.searched * 100)) + '%' : '';
  vs.innerHTML = many ? `<span>${st.dfps.toFixed(0)} fps</span><span>${st.ms.toFixed(0)} ms</span>${part ? `<span title="Share of the picture searched, on average">${part}</span>` : ''}`
    : `<span>${c.video.videoWidth}×${c.video.videoHeight}</span><span>camera ${st.fps.toFixed(0)} fps</span><span>detection ${st.dfps.toFixed(0)} fps in ${st.ms.toFixed(0)} ms</span>${part ? `<span>searching ${part} of the picture</span>` : ''}`;
  if (c === S.cams[0]) status(many ? `${S.cams.length} cameras, ${S.cams.reduce((s, x) => s + x.stats.dfps, 0).toFixed(0)} frames a second` : `${st.dfps.toFixed(0)} fps, ${st.ms.toFixed(0)} ms per frame`, 'live');
}

// ---------------- tracking results ----------------
// For each track this frame: the raw pose (OpenCV's IPPE for a tag; for an object, its first visible tag's raw
// pose moved to the object's origin) and the refined candidates from the worker. The pose that is plotted is the
// raw one, the best refined one, or the Kalman filter's, which also settles the mirror-image doubt by prediction.
function rawBody(b, tags) {
  for (const m of b.members) {
    const t = tags.find((x) => x.id === m.id && x.R);
    if (t) return C.compose(t, C.inverse(m));
  }
  return null;
}
function onTags(c, m) {
  tickStats(c, m.ms);
  if (S.mode !== 'track') return;
  const wall = performance.now() / 1000, mem = memberIds();
  // where this camera's tags were last time, for their speed across the picture
  if (c.last) c.prevCtr = new Map(c.last.tags.map((t) => [t.id, { time: c.last.time, ctr: centroid(t.corners) }]));
  // a predicted tag that wasn't in its window: search the whole picture next
  if (m.rois) { const ex = c.expect.get(m.seq) || []; c.forceFull = ex.some((id) => !m.tags.some((t) => t.id === id)); }
  else c.forceFull = false;
  for (const k of c.expect.keys()) if (k <= m.seq) c.expect.delete(k);
  c.searched = c.searched == null ? m.searched : 0.9 * c.searched + 0.1 * (m.searched == null ? 1 : m.searched);
  c.last = m;
  for (const t of m.tags) S.seen.set(t.id, { time: m.time, wall, err: t.err });
  // this camera's measurements, in its own frame, each with its corners (sight: the track's points in its own frame,
  // and where this camera saw them) for the joint fit and the filter
  const meas = new Map(), px = (t) => [0, 1, 2, 3].map((k) => [t.corners[2 * k], t.corners[2 * k + 1]]);
  for (const t of m.tags) {
    if (!t.R || mem.has(t.id)) continue;
    if (!S.settings.showUnknown && !tagOf(t.id)) continue;
    meas.set(t.id, { raw: { R: t.R, t: t.t }, cands: t.cands || [], err: t.err, size: t.size, sight: { obj: C.tagCorners(t.size), img: px(t) } });
  }
  for (const b of S.bodies) {
    const raw = rawBody(b, m.tags);
    if (!raw) continue;
    const got = (m.bodies || []).find((x) => x.id === b.id), obj = [], img = [];
    for (const mb of b.members) {
      const t = m.tags.find((x) => x.id === mb.id);
      if (!t) continue;
      C.tagCorners(t.size).forEach((q, k) => { obj.push(C.add(C.mulv(mb.R, q), mb.t)); img.push(px(t)[k]); });
    }
    meas.set('b:' + b.id, { raw, cands: got ? got.cands : [], seen: got ? got.seen : 1, sight: { obj, img } });
  }
  c.local = new Map([...meas].map(([k, z]) => [k, z.cands[0] || z.raw]));
  if (S.learn) learnStep(m);
  if (c.T) fuse(c, m, meas, wall); // a camera that isn't placed only draws its own view
  drawOverlay(c);
}
// A placed camera's measurements, moved into the rig's frame (camera 1's) and combined with the other cameras'.
// Raw takes this camera's pose. Refined fits one pose to the corners of every camera that saw the track within 50 ms
// (TagCore.refineJoint: robust, each camera weighted by its corner noise, each frame moved to this one's time by the
// track's velocity, since the cameras aren't synchronised). Filtered feeds each camera's corners, as its frames arrive,
// straight into the track's one Kalman filter (PoseFilter.updateCorners).
// Refined has no motion model of its own, so a track's velocity for moving frames to one time is taken from its last
// poses: each step's change over its time, smoothed (each new step counts for 30%).
// A pose as the plots, the table and the stream show it: in the plotted frame (the camera's, or relative to the
// reference). Mirror is the picture's only, so it never changes a pose.
function shown(p, ref) { return C.inFrame(p, ref); }
function trackVelocity(key, time, p) {
  const last = S.fused.get(key), dt = last ? time - last.time : 0;
  if (!last || dt < 0.005 || dt > 0.2) { if (!last || dt > 0.2) S.vel.delete(key); return; }
  const v = C.sub(p.t, last.pose.t).map((x) => x / dt), w = C.so3Log(C.mul3(p.R, C.tr3(last.pose.R))).map((x) => x / dt);
  const o = S.vel.get(key), mix = (a, b) => a.map((x, i) => 0.7 * x + 0.3 * b[i]);
  S.vel.set(key, o ? { v: mix(o.v, v), w: mix(o.w, w) } : { v, w });
}
function fuse(c, m, meas, wall) {
  const mode = S.settings.pose, out = new Map(), rig = new Map();
  for (const [key, z0] of meas) {
    const z = { raw: C.toRig(c.T, z0.raw), cands: z0.cands.map((q) => C.toRig(c.T, q)), err: z0.err, size: z0.size, seen: z0.seen };
    rig.set(key, z);
    let zs = S.zs.get(key);
    if (!zs) S.zs.set(key, (zs = new Map()));
    // A face-on tag fits two mirror-image poses about equally well. Take the one the other cameras agree with
    // (what they see of this track within 50 ms), or with one camera the one nearest the track's last pose, so it
    // doesn't flip from frame to frame.
    const others = [...zs].filter(([k, x]) => k !== c.key && Math.abs(x.time - m.time) < 0.05 && x.z.cands.length).map(([, x]) => C.plausible(x.z.cands).map((q) => q.R));
    const last = S.fused.get(key), prevR = last && m.time - last.time < 0.25 ? last.pose.R : null;
    const pick = z.cands.length ? C.chooseCand(z.cands, others, prevR) : null;
    const sight = z0.sight && z0.sight.img.length ? z0.sight : null;
    const sigma = pick ? Math.hypot(pick.sigma || 0.5, c.modelPx || MODEL_PX) : 0;
    noteCamPose(key, m.time, (pick || z.raw).R); // the camera's own view of it, for lining motion sensors up
    zs.set(c.key, { time: m.time, z, pick, sight, sigma, cam: c.cam, T: c.T });
    let p = null;
    if (mode === 'raw' || !pick) p = z.raw;
    else if (mode === 'refined') {
      const now = [...zs.values()].filter((x) => Math.abs(x.time - m.time) < 0.05 && x.pick && x.sight);
      if (now.length > 1) {
        const views = now.map((x) => C.sighting(x.cam, x.T, x.sight.obj, x.sight.img, x.sigma, x.time - m.time));
        const start = C.fusePoses(now.map((x) => x.pick));
        p = C.refineJoint(views, start, { vel: S.vel.get(key) }) || start;
      } else p = pick;
      trackVelocity(key, m.time, p);
    } else {
      let f = S.filters.get(key);
      if (!f) { f = new C.PoseFilter(C.MOTION[S.settings.motion]); S.filters.set(key, f); }
      // the chosen candidate only starts (or restarts) the track; after that the corners steer it
      const r = sight ? f.updateCorners(m.time, [C.sighting(c.cam, c.T, sight.obj, sight.img, sigma, 0)], pick) : f.update(m.time, [pick]);
      p = r && r.pose;
    }
    const best = z.cands[0], cams = S.cams.filter((x) => { const q = zs.get(x.key); return q && m.time - q.time < 0.25; }).map((x) => x.n);
    S.tracks.set(key, { time: m.time, wall, pose: p, raw: z.raw, rms: p && p.views > 1 ? p.rms : best ? best.rms : z.err, cov: (p && p.cov) || (best && best.cov) || null, v: p && p.v, size: z.size, seen: z.seen, cams });
    if (p) { out.set(key, p); S.fused.set(key, { pose: p, time: m.time }); }
  }
  // the reference frame: this frame's pose of the chosen track, or its last one within 0.25 s
  const refKey = S.settings.frame === 'camera' ? null : parseKey(S.settings.frame);
  let ref = null, refRaw = null;
  if (refKey !== null) {
    const tr = S.tracks.get(refKey);
    if (tr && m.time - tr.time < 0.25) { ref = tr.pose; refRaw = tr.raw; }
  }
  if (refKey === null || ref) {
    // the reference itself always sits at the origin, where the plot already draws it
    for (const [key, p] of out) if (key !== refKey) S.hist.push(key, m.time, C.tared(shown(p, ref), S.tare.get(key)));
    if (S.settings.compare) for (const [key, z] of rig) if (key !== refKey) S.rawHist.push(key, m.time, C.tared(shown(z.raw, refRaw), S.tare.get(key)));
  }
  streamTick(m.time);
  recTick(m.time);
}

// ---------------- video overlays ----------------
function clearOverlay(c) { const x = c.overlay.getContext('2d'); x.clearRect(0, 0, c.overlay.width, c.overlay.height); }
function clearOverlays() { for (const c of S.cams) { clearOverlay(c); c.last = null; c.lastBoard = null; } }
// Map a camera's image pixels to its overlay canvas (the video is letterboxed with object-fit: contain).
// Mirror and Flip turn the video with CSS and these points with it; the text stays readable. Flip is half a turn,
// so it reverses left and right as well as top and bottom.
function overlayMap(c) {
  const r = c.overlay.getBoundingClientRect(), dpr = devicePixelRatio || 1;
  const W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr));
  if (c.overlay.width !== W || c.overlay.height !== H) { c.overlay.width = W; c.overlay.height = H; }
  const vw = c.video.videoWidth || 1, vh = c.video.videoHeight || 1;
  return { s: Math.min(W / vw, H / vh), P: C.displayMap(W, H, vw, vh, S.settings.mirror !== S.settings.flip, S.settings.flip), dpr, W, H, k: Math.min(1, Math.max(0.8, r.width / 560)) };
}
function paintPicture() {
  // Flip turns the picture half a turn: left-right and top-bottom both (with Mirror, top-bottom only)
  $('stages').style.setProperty('--sx', S.settings.mirror !== S.settings.flip ? -1 : 1);
  $('stages').style.setProperty('--sy', S.settings.flip ? -1 : 1);
  $('mirrorBtn').setAttribute('aria-pressed', String(S.settings.mirror));
  $('stages').classList.toggle('blur', S.settings.blur);
  $('blurSw').setAttribute('aria-checked', String(S.settings.blur));
  $('flipBtn').setAttribute('aria-pressed', String(S.settings.flip));
}
const redrawOverlays = () => { for (const c of S.cams) if (S.mode === 'track' && c.last) drawOverlay(c); else clearOverlay(c); };
// Mirror and Flip are the picture's only: detection, poses, the plots, the robot and the data never change.
$('mirrorBtn').onclick = () => { S.settings.mirror = !S.settings.mirror; store.set('settings', S.settings); paintPicture(); redrawOverlays(); };
$('blurSw').onclick = () => { S.settings.blur = !S.settings.blur; store.set('settings', S.settings); paintPicture(); };
$('flipBtn').onclick = () => { S.settings.flip = !S.settings.flip; store.set('settings', S.settings); paintPicture(); redrawOverlays(); };
paintPicture();
// One camera's view: an outline and the pose's axes on each tag it sees, a name plate, and each rigid object's axes.
// A placed camera also draws, dashed, the tags it doesn't see itself but the other cameras do, where they would be.
function drawOverlay(c) {
  const m = c.last;
  if (!m) return;
  const ctx = c.overlay.getContext('2d'), M = overlayMap(c), P = M.P, cam = c.cam, u = M.dpr * M.k;
  ctx.clearRect(0, 0, M.W, M.H);
  ctx.lineJoin = 'round';
  const placed = [], mem = memberIds();
  // a track's pose in this camera's frame: the fused pose moved back from the rig, or (not placed) its own
  const inCam = (key) => {
    if (c.T) { const f = S.fused.get(key); return f && Math.abs(f.time - m.time) < 0.25 ? C.compose(C.inverse(c.T), f.pose) : null; }
    return c.local.get(key) || null;
  };
  const axes = (pose, L) => {
    const o = C.project(cam, pose.t);
    if (!o) return;
    for (const a of [[L, 0, 0, K.x], [0, L, 0, K.y], [0, 0, L, K.z]]) {
      const e = C.project(cam, C.add(pose.t, C.mulv(pose.R, a)));
      if (!e) continue;
      const A = P(o[0], o[1]), B = P(e[0], e[1]);
      ctx.strokeStyle = a[3]; ctx.lineWidth = 2.5 * u; ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();
    }
  };
  // a name plate: above the anchor point; below `below` if that's taken; then further up
  const roomy = M.W / M.dpr >= 300;
  const plate = (txt, col, top, below) => {
    if (!roomy) return; // a small view: outlines and axes only; the names are in the table
    ctx.font = `600 ${12 * u}px Archivo, system-ui, sans-serif`;
    const tw = ctx.measureText(txt).width, pad = 6 * u, h = 20 * u, bw = tw + 2 * pad + 10 * u;
    const x = Math.max(2, Math.min(M.W - bw - 2, top[0] - tw / 2 - pad));
    const hits = (y) => placed.some((r) => x < r[0] + r[2] && r[0] < x + bw && y < r[1] + r[3] && r[1] < y + h);
    let y = Math.max(2, top[1] - h - 8 * u);
    if (hits(y)) { const yb = Math.min(M.H - h - 2, below + 8 * u); if (!hits(yb)) y = yb; else for (let k = 0; k < 5 && hits(y); k++) y = Math.max(2, y - h - 3 * u); }
    placed.push([x, y, bw, h]);
    ctx.fillStyle = 'rgba(12,14,17,.78)'; roundRect(ctx, x, y, bw, h, 5 * u); ctx.fill();
    ctx.fillStyle = col; roundRect(ctx, x + pad, y + h / 2 - 4 * u, 8 * u, 8 * u, 2 * u); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(txt, x + pad + 12 * u, y + h / 2 + 0.5);
  };
  const quad = (pts, col, dashed) => {
    ctx.lineWidth = 2 * u; ctx.strokeStyle = col; ctx.setLineDash(dashed ? [5 * u, 4 * u] : []);
    ctx.beginPath(); pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.stroke();
    ctx.setLineDash([]);
  };
  const seenHere = new Set();
  for (const t of m.tags) {
    const inBody = mem.has(t.id), key = inBody ? 'b:' + S.bodies.find((b) => b.members.some((x) => x.id === t.id)).id : t.id;
    seenHere.add(t.id);
    const col = colorOf(key), q = t.corners, sp = [0, 1, 2, 3].map((k) => P(q[2 * k], q[2 * k + 1]));
    quad(sp, col, false);
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(sp[0][0], sp[0][1], 3 * u, 0, 7); ctx.fill(); // first corner: the tag's orientation
    const pose = inBody ? null : inCam(t.id) || (t.R ? t : null);
    if (pose) axes(pose, Math.min(S.settings.axisLen, t.size));
    if (inBody) continue; // a tag of an object: its outline only, the object's own plate names it
    const xs = sp.map((p) => p[0]), ys = sp.map((p) => p[1]);
    plate(nameOf(t.id) + (pose ? `  ${(C.norm(pose.t) * 100).toFixed(1)} cm` : ''), col, [(Math.min(...xs) + Math.max(...xs)) / 2, Math.min(...ys)], Math.max(...ys));
  }
  // tracks the other cameras see and this one doesn't: dashed, where they would be in this picture
  if (c.T && S.cams.length > 1) for (const [key] of S.fused) {
    if (isBody(key) || seenHere.has(key) || mem.has(key)) continue;
    const pose = inCam(key);
    if (!pose) continue;
    const img = C.tagCorners(sizeOf(key)).map((X) => C.project(cam, C.add(C.mulv(pose.R, X), pose.t)));
    if (img.some((p) => !p || p[0] < 0 || p[1] < 0 || p[0] > cam.w || p[1] > cam.h)) continue;
    const sp = img.map((p) => P(p[0], p[1])), xs = sp.map((p) => p[0]), ys = sp.map((p) => p[1]);
    quad(sp, colorOf(key), true);
    axes(pose, Math.min(S.settings.axisLen, sizeOf(key)));
    plate(`${nameOf(key)}  other cameras`, colorOf(key), [(Math.min(...xs) + Math.max(...xs)) / 2, Math.min(...ys)], Math.max(...ys));
  }
  // each rigid object: its axes at its origin, and its name
  for (const key of c.T ? S.fused.keys() : c.local.keys()) {
    if (!isBody(key)) continue;
    const pose = inCam(key);
    if (!pose) continue;
    axes(pose, S.settings.axisLen);
    const o = C.project(cam, pose.t);
    if (o) { const so = P(o[0], o[1]), d = 14 * M.s; plate(`${nameOf(key)}  ${(C.norm(pose.t) * 100).toFixed(1)} cm`, colorOf(key), [so[0], so[1] - d], so[1] + d); }
  }
}
function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

// ---------------- rigid objects ----------------
function saveBodies() { store.set('bodies', S.bodies); }
const LEARN_N = 20;
function renderBodies() {
  const list = $('bodyList');
  list.textContent = '';
  for (const b of S.bodies) {
    const key = 'b:' + b.id, row = document.createElement('div');
    row.className = 'brow';
    row.innerHTML = `<span class="sw" style="background:${cssColorOf(key)}"></span>
      <label class="sr" for="bn${b.id}">Name of object</label><input id="bn${b.id}" class="input sm" maxlength="40">
      <span class="seen" id="bseen${b.id}"><span class="dot"></span><span>Not seen</span></span>
      <span style="white-space:nowrap"><button class="btn sm" data-a="relearn" title="Learn the shape again">Relearn</button><button class="btn sm sq danger" data-a="rm" aria-label="Remove object ${escapeHtml(b.name || '')}" title="Remove"><svg class="i"><use href="#i-x"/></svg></button></span>
      <div class="meta">${b.members.map((x, i) => `<span class="mtag">#${x.id}${i ? '' : ' origin'}</span>`).join('')}${b.spread ? `<span title="How much the learned tag positions scattered">spread ${(b.spread.m * 1000).toFixed(1)} mm, ${b.spread.deg.toFixed(1)}°</span>` : ''}</div>`;
    const nm = row.querySelector('input');
    nm.value = b.name || '';
    nm.oninput = () => { b.name = nm.value.trim(); saveBodies(); refreshFrameSel(); refreshTplotSel(); };
    row.querySelector('[data-a=rm]').onclick = () => {
      S.bodies = S.bodies.filter((x) => x !== b); saveBodies();
      if (S.settings.frame === key) setFrame('camera');
      resetTracks(); renderBodies(); renderTags(); refreshFrameSel(); refreshTplotSel();
    };
    row.querySelector('[data-a=relearn]').onclick = () => startLearn(b.id, b.name, b.members.map((x) => x.id));
    list.appendChild(row);
  }
  if (S.learn) {
    const L = S.learn, row = document.createElement('div');
    row.className = 'brow';
    row.innerHTML = `<span class="sw" style="background:${cssColorOf(L.ids[0])}"></span><strong>${escapeHtml(L.name || 'New object')}</strong><span class="seen on"><span class="dot"></span><span>Learning</span></span><button class="btn sm" data-a="cancel">Cancel</button>
      <div class="learn" aria-live="polite">${L.ids.slice(1).map((id) => `<div class="lrow"><span class="mono">#${id}</span><div class="progress"><i style="width:${Math.min(100, (100 * L.samples[id].length) / LEARN_N)}%"></i></div><span class="mono muted">${L.samples[id].length}/${LEARN_N}</span></div>`).join('')}
      <span class="muted">${S.settings.pose === 'raw' ? 'Learning needs Refined or Filtered poses.' : `Keep #${L.ids[0]} in view with each of the others, and turn the object slowly. Frames where a tag could be read two ways are skipped.`}</span></div>`;
    row.querySelector('[data-a=cancel]').onclick = () => { S.learn = null; renderBodies(); };
    list.appendChild(row);
  }
  $('bodiesHint').hidden = S.bodies.length > 0 || !!S.learn;
}
function startLearn(id, name, ids) {
  S.learn = { id, name, ids, samples: Object.fromEntries(ids.slice(1).map((x) => [x, []])) };
  $('bodyForm').hidden = true;
  renderBodies();
}
// A frame counts for a tag only when its pose is unambiguous: one candidate, or the other fits clearly worse.
const unambiguous = (t) => t && t.cands && t.cands.length && (t.cands.length === 1 || t.cands[1].rms > 2 * t.cands[0].rms + 0.3) && t.cands[0].rms < 1.5;
function learnStep(m) {
  const L = S.learn, a = m.tags.find((t) => t.id === L.ids[0]);
  if (!unambiguous(a)) return;
  let changed = false;
  for (const id of L.ids.slice(1)) {
    const t = m.tags.find((x) => x.id === id);
    if (!unambiguous(t) || L.samples[id].length >= LEARN_N) continue;
    L.samples[id].push(C.relative(a.cands[0], t.cands[0]));
    changed = true;
  }
  if (!changed) return;
  if (L.ids.slice(1).every((id) => L.samples[id].length >= LEARN_N)) {
    const members = [{ id: L.ids[0], R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] }];
    let sm = 0, sd = 0;
    for (const id of L.ids.slice(1)) {
      const mp = C.meanPose(L.samples[id], 5, 0.01);
      members.push({ id, R: mp.R, t: mp.t });
      sm = Math.max(sm, mp.spread.m); sd = Math.max(sd, mp.spread.deg);
    }
    const b = { id: L.id || String(Date.now().toString(36)), name: L.name || 'Object', members, spread: { m: sm, deg: sd } };
    const i = S.bodies.findIndex((x) => x.id === b.id);
    if (i >= 0) S.bodies[i] = b; else S.bodies.push(b);
    S.learn = null;
    saveBodies(); resetTracks(); renderTags(); refreshFrameSel(); refreshTplotSel();
  }
  renderBodies();
}
$('newBody').onclick = () => {
  const f = $('bodyForm');
  f.hidden = !f.hidden;
  if (f.hidden) return;
  $('bodyName').value = `Object ${S.bodies.length + 1}`;
  const pick = $('bodyPick'), chosen = [];
  pick.textContent = '';
  const mem = memberIds();
  for (const t of S.tags.filter((x) => !mem.has(x.id))) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'pick'; b.setAttribute('aria-pressed', 'false');
    b.innerHTML = `<span class="sw" style="background:${cssColorOf(t.id)}"></span>#${t.id}${t.name ? ' ' + escapeHtml(t.name) : ''}<span class="ord"></span>`;
    b.onclick = () => {
      const i = chosen.indexOf(t.id);
      if (i >= 0) chosen.splice(i, 1); else chosen.push(t.id);
      pick.querySelectorAll('.pick').forEach((x) => { const id = +x.dataset.id, k = chosen.indexOf(id); x.setAttribute('aria-pressed', String(k >= 0)); x.querySelector('.ord').textContent = k === 0 ? 'origin' : k > 0 ? String(k + 1) : ''; });
      $('bodyCreate').disabled = chosen.length < 2;
    };
    b.dataset.id = t.id;
    pick.appendChild(b);
  }
  if (!pick.children.length) pick.innerHTML = '<span class="small muted">Add at least two tags first.</span>';
  $('bodyCreate').disabled = true;
  f.onsubmit = (e) => { e.preventDefault(); if (chosen.length >= 2) startLearn(null, $('bodyName').value.trim(), chosen.slice()); };
  $('bodyName').focus();
};
$('bodyCancel').onclick = () => { $('bodyForm').hidden = true; };
