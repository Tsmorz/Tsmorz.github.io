// Tag tracker page, part of index.html's script: full screen, robot settings, the time plot, the readout table, the render loop, modes.
// The app-*.js files are classic scripts loaded in order and share one global scope; nothing in them runs
// another file's code at load (the boot script at the end of index.html starts everything).
'use strict';

// ---------------- full screen ----------------
// The 3D view alone, full screen: the browser's own where an element can go full screen, else filling the window.
const P3 = document.querySelector('.plot3d');
const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement || null;
function isFull() { return fsEl() === P3 || P3.classList.contains('full'); }
function paintFull() {
  const on = isFull();
  document.documentElement.classList.toggle('p3-full', on);
  $('fullBtn').innerHTML = `<svg class="i"><use href="#i-${on ? 'unfull' : 'full'}"/></svg>`;
  $('fullBtn').setAttribute('aria-label', on ? 'Leave full screen' : 'Full screen');
  $('fullBtn').title = on ? 'Leave full screen (Esc)' : 'Full screen (Esc to leave)';
}
function setFull(on) {
  if (on === isFull()) return;
  if (!on) {
    if (fsEl()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    P3.classList.remove('full'); paintFull(); return;
  }
  const go = P3.requestFullscreen || P3.webkitRequestFullscreen, fallback = () => { P3.classList.add('full'); paintFull(); };
  if (go) { try { Promise.resolve(go.call(P3)).catch(fallback); } catch (e) { fallback(); } } else fallback();
  plot.focus();
}
$('fullBtn').onclick = () => setFull(!isFull());
document.addEventListener('fullscreenchange', paintFull);
document.addEventListener('webkitfullscreenchange', paintFull);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && P3.classList.contains('full')) setFull(false); });
// The camera views full screen, the same way: every view, arranged as on the page, as big as the screen allows.
const CB = $('camsBox');
function camsFull() { return fsEl() === CB || CB.classList.contains('full'); }
function paintCamsFull() {
  const on = camsFull();
  document.documentElement.classList.toggle('cams-full', on);
  $('camsExit').hidden = !on;
  $('camsFullBtn').hidden = !S.cams.length;
  layoutTiles();
}
function setCamsFull(on) {
  if (on === camsFull()) return;
  if (!on) {
    if (fsEl() === CB) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    CB.classList.remove('full'); paintCamsFull(); return;
  }
  const go = CB.requestFullscreen || CB.webkitRequestFullscreen, fallback = () => { CB.classList.add('full'); paintCamsFull(); };
  if (go) { try { Promise.resolve(go.call(CB)).catch(fallback); } catch (e) { fallback(); } } else fallback();
}
$('camsFullBtn').onclick = () => setCamsFull(true);
$('camsExit').onclick = () => setCamsFull(false);
document.addEventListener('fullscreenchange', paintCamsFull);
document.addEventListener('webkitfullscreenchange', paintCamsFull);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && CB.classList.contains('full')) setCamsFull(false); });

// ---------------- settings: the robot ----------------
function saveSettings() { S.settings = C.clampSettings(S.settings); store.set('settings', S.settings); }
// the role pickers list Auto, None and every track
function renderSettings() {
  const r = S.settings.robot, ref = refKeyNow(), keys = trackKeys().filter((k) => k !== ref);
  for (const [id, k] of [['roleBody', 'body'], ['roleLeft', 'left'], ['roleRight', 'right']]) {
    const sel = $(id), opts = [['auto', 'Auto'], ['none', 'None'], ...keys.map((x) => [String(x), nameOf(x) + (isBody(x) ? ' (object)' : ` (#${x})`)])];
    if (r[k] !== 'auto' && r[k] !== 'none' && !opts.some((o) => o[0] === r[k])) opts.push([r[k], `${r[k]} (not listed)`]);
    sel.innerHTML = opts.map(([v, t]) => `<option value="${escapeHtml(v)}">${escapeHtml(t)}</option>`).join('');
    sel.value = r[k];
  }
  const m = RCORE.model(r);
  for (const [id, k] of [['lenUpper', 'upper'], ['lenFore', 'fore'], ['lenHalf', 'half'], ['lenUp', 'up']]) $(id).value = +(m[k] * 100).toFixed(1);
  $('elbowSw').setAttribute('aria-checked', String(r.elbows));
  $('setupSw').setAttribute('aria-checked', String(S.settings.setup));
  paintPaper();
}
for (const [id, k] of [['roleBody', 'body'], ['roleLeft', 'left'], ['roleRight', 'right']]) $(id).onchange = () => { S.settings.robot[k] = $(id).value; saveSettings(); clearRobotCal(); };
for (const [id, k] of [['lenUpper', 'upper'], ['lenFore', 'fore'], ['lenHalf', 'half'], ['lenUp', 'up']]) {
  $(id).onchange = () => { const v = +$(id).value; if (isFinite(v) && $(id).value !== '') S.settings.robot[k] = v / 100; saveSettings(); clearRobotCal(); renderSettings(); };
}
$('lenReset').onclick = () => { for (const k of ['back', 'half', 'up', 'upper', 'fore']) delete S.settings.robot[k]; saveSettings(); clearRobotCal(); renderSettings(); };
$('elbowSw').onclick = () => { S.settings.robot.elbows = !S.settings.robot.elbows; saveSettings(); RB.prev.clear(); renderSettings(); };
$('setupSw').onclick = () => { S.settings.setup = !S.settings.setup; saveSettings(); renderSettings(); paintSetupSw(); };
$('setupOpen').onclick = () => { $('settingsDlg').close(); openSetup(0); };
function openSettings() { if ($('settingsDlg').open) return; renderSettings(); $('settingsDlg').showModal(); }
$('settingsBtn').onclick = openSettings;
$('helpBtn').onclick = () => openSetup(0);
$('settingsClose').onclick = () => $('settingsDlg').close();
// a click on the scrim (the dialog itself, outside its contents) closes it
$('settingsDlg').addEventListener('click', (e) => { if (e.target === $('settingsDlg')) $('settingsDlg').close(); });

// ---------------- time plot ----------------
let hoverX = null;
tplot.addEventListener('pointermove', (e) => { const r = tplot.getBoundingClientRect(); hoverX = e.clientX - r.left; });
tplot.addEventListener('pointerleave', () => { hoverX = null; $('tip').hidden = true; });
// The series the time plot draws, for the mode shown: {times, rows (each a value per line, or null for a gap), names,
// cols, css (colours as CSS), unit, fmt (a value as text), tipName, empty}.
const JOINT_SHORT = ['Sh. fwd', 'Sh. out', 'Arm turn', 'Elbow', 'Forearm', 'W. bend', 'W. tilt'];
const FORCE_NAMES = ['Squeeze', 'Can hold', 'Load', 'Contact'];
function tplotSeries(mode, now) {
  if (mode === 'forces') {
    const h = RB.fhist.get(S.jointSide) || [];
    return {
      times: h.map((x) => x.time), rows: h.map((x) => x.v), names: FORCE_NAMES, cols: FORCE_NAMES.map((_, i) => K.slots[i]), css: FORCE_NAMES.map((_, i) => `var(--s${i + 1})`),
      unit: 'N', fmt: (v) => v.toFixed(1), tipFmt: (v) => v.toFixed(2) + ' N', tipName: S.jointSide === 1 ? 'Left hand' : 'Right hand',
      tipNames: ['Squeeze', 'Can hold (2·μ·squeeze)', 'Grip’s load', 'Everything else it touches'], empty: 'No hand on the table',
    };
  }
  if (mode === 'joints') {
    const arm = robotArms().find((x) => x.side === S.jointSide), h = arm ? (RB.jhist.get(arm.key) || []).filter((x) => x.side === arm.side) : [], D = 180 / Math.PI;
    return {
      times: h.map((x) => x.time), rows: h.map((x) => x.q.map((v) => v * D)), names: JOINT_SHORT, cols: JOINT_SHORT.map((_, i) => K.slots[i]), css: JOINT_SHORT.map((_, i) => `var(--s${i + 1})`),
      unit: '°', fmt: (v) => v.toFixed(0), tipFmt: (v) => v.toFixed(1) + '°', tipName: arm ? (arm.side === 1 ? 'Left arm' : 'Right arm') : '', tipNames: RCORE.JOINTS.map((j) => j.name), empty: 'No arm yet',
    };
  }
  const id = S.tplotTag, a = id === null ? [] : S.hist.get(id), xyz = { names: ['x', 'y', 'z'], cols: [K.x, K.y, K.z], css: ['var(--x)', 'var(--y)', 'var(--z)'] };
  const ref = S.settings.frame === 'camera' ? null : parseKey(S.settings.frame);
  const empty = id === null ? 'Pick a tag' : id === ref ? `${nameOf(id)} is the reference, so it stays at the origin` : `${nameOf(id)} isn’t in view`, base = { times: a.map((x) => x.time), tipName: id === null ? '' : nameOf(id), empty };
  if (mode === 'quat') {
    // each sample's sign kept nearest the one before, so the lines don't jump
    let qp = null;
    return { ...base, rows: a.map((x) => (qp = C.quatNear(C.quatOf(x.R), qp))), names: ['w', 'x', 'y', 'z'], cols: [K.text2, K.x, K.y, K.z], css: ['var(--ink2)', 'var(--x)', 'var(--y)', 'var(--z)'], unit: 'q', fmt: (v) => v.toFixed(3), tipFmt: (v) => v.toFixed(3), fixed: [-1, 1] };
  }
  if (mode === 'velocity') {
    // the change over the last 0.1 s (at least two samples apart), in cm/s: steadier than frame to frame
    let j = 0;
    const rows = a.map((x, k) => {
      while (j < k - 1 && x.time - a[j + 1].time >= 0.1) j++;
      const dt = x.time - a[j].time;
      return k > j && dt > 0.02 && dt < 0.4 ? [0, 1, 2].map((i) => ((x.t[i] - a[j].t[i]) / dt) * 100) : null;
    });
    return { ...base, ...xyz, rows, unit: 'cm/s', fmt: (v) => (v >= 0 ? '+' : '') + v.toFixed(0), tipFmt: (v) => v.toFixed(1) + ' cm/s' };
  }
  return { ...base, ...xyz, rows: a.map((x) => x.t.map((v) => v * 100)), unit: 'cm', fmt: (v) => v.toFixed(1), tipFmt: (v) => v.toFixed(2) + ' cm' };
}
function drawTplot() {
  const { c, w, h } = sizeCanvas(tplot);
  c.clearRect(0, 0, w, h);
  const mode = tpMode(), now = performance.now() / 1000, span = S.settings.span, sr = tplotSeries(mode, now);
  const n = sr.names.length, L = 50, R = mode === 'joints' || mode === 'forces' ? 92 : 74, T = 28, B = 24, pw = w - L - R, ph = h - T - B;
  if (pw < 40 || ph < 30) return;
  const times = sr.times, rows = sr.rows, has = rows.some((r) => r);
  let lo = Infinity, hi = -Infinity, stp;
  if (sr.fixed) { [lo, hi] = sr.fixed; stp = ph < 80 ? 1 : 0.5; } else {
    for (let k = 0; k < rows.length; k++) if (rows[k] && now - times[k] <= span) for (const v of rows[k]) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (!isFinite(lo)) { lo = -10; hi = 10; }
    if (hi - lo < 2) { const m = (hi + lo) / 2; lo = m - 1; hi = m + 1; }
    stp = C.niceStep(hi - lo, Math.max(2, Math.min(4, Math.floor(ph / 30)))); lo = Math.floor(lo / stp) * stp; hi = Math.ceil(hi / stp) * stp;
  }
  const X = (t) => L + pw * (1 - (now - t) / span), Y = (v) => T + ph * (1 - (v - lo) / (hi - lo));
  c.font = '11px Archivo, sans-serif'; c.textBaseline = 'middle'; c.fillStyle = K.muted;
  for (let v = lo; v <= hi + 1e-9; v += stp) {
    c.strokeStyle = Math.abs(v) < 1e-9 ? K.axis : K.grid; c.lineWidth = 1;
    c.beginPath(); c.moveTo(L, Math.round(Y(v)) + 0.5); c.lineTo(L + pw, Math.round(Y(v)) + 0.5); c.stroke();
    const t = (+v.toFixed(6)).toString(); c.textAlign = 'right'; c.fillText(t, L - 6, Y(v));
  }
  c.textAlign = 'center'; c.textBaseline = 'top';
  const ts = C.niceStep(span, 5);
  for (let s2 = 0; s2 <= span + 1e-9; s2 += ts) c.fillText(s2 === 0 ? 'now' : `−${+s2.toFixed(3)} s`, L + pw * (1 - s2 / span), T + ph + 6);
  c.textAlign = 'right'; c.textBaseline = 'alphabetic'; c.fillText(sr.unit, L - 6, T - 14);
  c.save(); c.beginPath(); c.rect(L, T - 4, pw, ph + 8); c.clip();
  c.lineWidth = 2; c.lineJoin = 'round'; c.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    c.strokeStyle = sr.cols[i]; c.beginPath();
    let pen = false;
    for (let k = 0; k < rows.length; k++) {
      if (!rows[k] || (k && times[k] - times[k - 1] > 0.25)) { pen = false; if (!rows[k]) continue; }
      const x = X(times[k]), y = Y(rows[k][i]);
      pen ? c.lineTo(x, y) : c.moveTo(x, y); pen = true;
    }
    c.stroke();
  }
  c.restore();
  // direct labels at the newest point, pushed apart so they don't overlap
  let kl = rows.length - 1;
  while (kl >= 0 && !rows[kl]) kl--;
  if (has && kl >= 0) {
    const ys = [...Array(n).keys()].map((i) => ({ i, y: Y(rows[kl][i]) })).sort((p, q) => p.y - q.y);
    const gap = n > 4 ? 11 : 13;
    for (let k = 1; k < n; k++) if (ys[k].y - ys[k - 1].y < gap) ys[k].y = ys[k - 1].y + gap;
    const off = Math.max(0, ys[n - 1].y - (T + ph)); // keep the stack above the time axis
    c.textAlign = 'left'; c.textBaseline = 'middle';
    const lw = mode === 'joints' || mode === 'forces' ? 52 : 10;
    for (const p of ys) {
      c.font = '600 11px Archivo, system-ui, sans-serif'; c.fillStyle = sr.cols[p.i]; c.fillText(sr.names[p.i], L + pw + 6, p.y - off);
      c.font = '11px Archivo, sans-serif'; c.fillStyle = K.text2; c.fillText(sr.fmt(rows[kl][p.i]), L + pw + 6 + lw, p.y - off);
    }
  } else {
    c.fillStyle = K.muted; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = '12px Archivo, system-ui, sans-serif';
    c.fillText(sr.empty, L + pw / 2, T + ph / 2);
  }
  // hover: crosshair and a tooltip at the nearest sample
  const tip = $('tip');
  if (hoverX !== null && has && hoverX >= L && hoverX <= L + pw) {
    const tt = now - span * (1 - (hoverX - L) / pw);
    let bk = -1;
    for (let k = 0; k < rows.length; k++) if (rows[k] && (bk < 0 || Math.abs(times[k] - tt) < Math.abs(times[bk] - tt))) bk = k;
    const x = X(times[bk]);
    c.strokeStyle = K.axis; c.lineWidth = 1; c.beginPath(); c.moveTo(Math.round(x) + 0.5, T); c.lineTo(Math.round(x) + 0.5, T + ph); c.stroke();
    for (let i = 0; i < n; i++) { c.fillStyle = sr.cols[i]; c.strokeStyle = K.surface; c.lineWidth = 2; c.beginPath(); c.arc(x, Y(rows[bk][i]), 4, 0, 7); c.fill(); c.stroke(); }
    tip.hidden = false;
    const tn = sr.tipNames || sr.names;
    tip.innerHTML = `<div class="small muted" style="margin-bottom:3px">${escapeHtml(sr.tipName)}, ${(now - times[bk]).toFixed(2)} s ago</div>` +
      tn.map((nm, i) => `<div class="r"><span><i class="sw" style="background:${sr.css[i]};width:8px;height:8px"></i>${escapeHtml(nm)}</span><span class="mono">${sr.tipFmt(rows[bk][i])}</span></div>`).join('');
    const tw = tip.offsetWidth;
    tip.style.left = (x + 12 + tw > w ? x - tw - 12 : x + 12) + 'px'; tip.style.top = T + 'px';
  } else tip.hidden = true;
}

// ---------------- readout table ----------------
let lastTable = 0;
function drawTable() {
  const now = performance.now();
  if (now - lastTable < 150) return;
  lastTable = now;
  const t = now / 1000, rows = [];
  for (const tg of S.tags) {
    const seen = S.seen.get(tg.id), fresh = seen && t - seen.wall < 0.3, el = $('seen' + tg.id);
    if (!el) continue;
    el.classList.toggle('on', !!fresh);
    el.lastElementChild.textContent = fresh ? 'Tracking' : seen ? `Seen ${fmtAgo(t - seen.wall)} ago` : 'Not seen';
  }
  for (const b of S.bodies) {
    const tr = S.tracks.get('b:' + b.id), fresh = tr && t - tr.wall < 0.3, el = $('bseen' + b.id);
    if (!el) continue;
    el.classList.toggle('on', !!fresh);
    el.lastElementChild.textContent = fresh ? `Tracking with ${tr.seen} of ${b.members.length} tags` : tr ? `Seen ${fmtAgo(t - tr.wall)} ago` : 'Not seen';
  }
  for (const key of trackKeys()) {
    const s = S.hist.latest(key), tr = S.tracks.get(key);
    if (!s || !tr || t - s.time > 0.5) continue;
    const p = tr.pose || tr.raw, dir = C.mulv([1, 0, 0, 0, 1, 0, 0, 0, 1], p.t.map((x) => x / C.norm(p.t)));
    // ± along the line of sight, from the pose covariance (raw poses have none: a quick estimate instead)
    const sd = tr.cov ? C.sigmaAlong(tr.cov, dir) : !isBody(key) && S.cams[0] ? C.depthNoise(S.cams[0].cam, tr.size || S.settings.tagSize, C.norm(p.t), 0.2) : NaN;
    const speed = tr.v ? C.norm(tr.v) * 100 : NaN;
    const q = C.quatOf(s.R), cell = (v, d, g) => `<td class="num mono${g ? ' g' : ''}">${v.toFixed(d).replace(/^-(0\.0*)$/, '$1')}</td>`;
    rows.push(`<tr data-key="${key}" aria-selected="${key === S.tplotTag}"><td><span style="display:inline-flex;align-items:center;gap:7px;white-space:nowrap"><span class="sw" style="background:${cssColorOf(key)}"></span>${escapeHtml(nameOf(key))}${S.tare.has(key) ? ' <span class="tared">tared</span>' : ''}${S.cams.length > 1 && tr.cams && tr.cams.length ? ` <span class="tared" title="Seen by ${escapeHtml(tr.cams.map((n) => (S.cams[n - 1] ? camName(S.cams[n - 1]) : 'camera ' + n)).join(', '))}">cam ${tr.cams.join(', ')}</span>` : ''}</span></td>` +
      s.t.map((v, i) => cell(v * 100, 1, !i)).join('') + q.map((v, i) => cell(v, 3, !i)).join('') +
      `<td class="num mono g">${(C.norm(s.t) * 100).toFixed(1)}</td><td class="num mono">${isFinite(speed) ? speed.toFixed(0) : '—'}</td><td class="num mono">${isFinite(tr.rms) ? tr.rms.toFixed(2) + ' px' : '—'}</td><td class="num mono">${isFinite(sd) ? (sd * 1000).toFixed(1) + ' mm' : '—'}</td></tr>`);
  }
  $('tareBtn').disabled = !rows.length;
  $('nowRows').innerHTML = rows.length ? rows.join('') : `<tr><td colspan="12" class="muted">${S.running ? 'No tags in view.' : 'Nothing tracked yet.'}</td></tr>`;
  renderUnknown();
  refreshTplotSel();
}
function fmtAgo(s) { return s < 60 ? `${s.toFixed(0)} s` : s < 3600 ? `${(s / 60).toFixed(0)} min` : `${(s / 3600).toFixed(0)} h`; }

// ---------------- render loop ----------------
// The next frame is asked for first, so an error drawing one frame never stops the page drawing (it is reported once).
let frameErr = false;
function frame() {
  requestAnimationFrame(frame);
  try {
    if (S.tab !== 'calib') draw3d();
    if (S.tab === 'track') drawTplot();
    if (S.mode === 'track') drawTable();
    if (S.tab === 'track') paintStream();
    if (REC.on) paintRec();
    if (S.mode === 'track') for (const c of S.cams) if (c.last && performance.now() / 1000 - c.last.time > 0.5) { clearOverlay(c); c.last = null; }
  } catch (e) {
    if (!frameErr) { frameErr = true; console.error(e); status('Something went wrong drawing the page: reload it (Shift-reload if it happens again)', 'bad'); }
  }
}

// ---------------- modes ----------------
// S.tab chooses Calibrate, Tracking or Tasks; S.mode chooses board or tag detection.
function setMode(m) {
  if (!TABS.includes(m)) return;
  stopTaskInput();
  if (m === 'tasks') {
    if (S.tab !== 'tasks') TASK.trackingView = S.settings.show3d;
    S.settings.show3d = 'robot'; S.settings.robot.props = 'arcade';
  } else if (S.tab === 'tasks' && TASK.trackingView) S.settings.show3d = TASK.trackingView;
  $('robotProps').value = S.settings.robot.props;
  document.querySelectorAll('[data-show3d]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.show3d === S.settings.show3d)));
  S.tab = m; S.mode = m === 'calib' ? 'calib' : 'track';
  for (const t of TABS) { const b = $('tab-' + t); b.setAttribute('aria-selected', String(m === t)); b.tabIndex = m === t ? 0 : -1; }
  if (m !== 'track') setFull(false);
  $('view-track').hidden = m === 'calib';
  $('view-track').setAttribute('aria-labelledby', 'tab-' + (m === 'tasks' ? 'tasks' : 'track'));
  $('tagsCard').hidden = m === 'calib';
  $('nowCard').hidden = m !== 'track';
  $('calibCard').hidden = m !== 'calib';
  $('streamCard').hidden = m !== 'track';
  $('recCard').hidden = m === 'calib';
  document.querySelector('main').classList.toggle('calib', m === 'calib');
  if (m === 'calib') {
    // the steps sit in the right-hand column
    document.querySelector('main').appendChild($('calibCard'));
    renderCalib();
  } else document.querySelector('.col').appendChild($('calibCard'));
  paintRobotBtns(); clearOverlays(); renderRig();
}
function stopTaskInput() { TB.grab = null; TB.ptr = null; TASK_HAPTIC.reset(); }
const TABS = ['calib', 'track', 'tasks'];
TABS.forEach((t, i) => {
  const b = $('tab-' + t);
  b.onclick = () => setMode(t);
  b.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); const b = $('tab-' + TABS[e.key === 'Home' ? 0 : TABS.length - 1]); b.click(); b.focus(); return; }
    if (!d) return;
    e.preventDefault();
    const other = $('tab-' + TABS[(i + d + TABS.length) % TABS.length]); other.click(); other.focus();
  });
});
const mq = matchMedia('(max-width:1000px)');
mq.addEventListener('change', () => setMode(S.tab));
