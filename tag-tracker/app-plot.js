// Tag tracker page, part of index.html's script: the 3D plot.
// The app-*.js files are classic scripts loaded in order and share one global scope; nothing in them runs
// another file's code at load (the boot script at the end of index.html starts everything).
'use strict';

// ---------------- 3D plot ----------------
function sizeCanvas(cv) {
  const r = cv.getBoundingClientRect(), dpr = devicePixelRatio || 1, W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { c, w: r.width, h: r.height };
}
function alpha(col, a) {
  if (col.startsWith('#') && col.length === 7) return col + Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0');
  return col;
}
function fitView() {
  if (S.settings.show3d === 'robot' && RB.pts.length) {
    // the robot: fitted to its own points, without the camera, so it fills the view
    const lo = [0, 1, 2].map((i) => Math.min(...RB.pts.map((p) => p[i]))), hi = [0, 1, 2].map((i) => Math.max(...RB.pts.map((p) => p[i])));
    S.view.target = lo.map((v, i) => (v + hi[i]) / 2);
    S.view.dist = Math.max(0.6, 1.6 * Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]));
    S.view.fitted = true;
    return;
  }
  const pts = [];
  for (const id of S.hist.ids()) for (const s of S.hist.get(id)) pts.push(s.t);
  if (!pts.length) { S.view = Object.assign(S.view, { target: S.settings.frame === 'camera' ? [0, 1, 0] : [0, -0.5, 0], dist: 2.6 }); return; }
  pts.push([0, 0, 0]);
  const lo = [0, 1, 2].map((i) => Math.min(...pts.map((p) => p[i]))), hi = [0, 1, 2].map((i) => Math.max(...pts.map((p) => p[i])));
  S.view.target = lo.map((v, i) => (v + hi[i]) / 2);
  S.view.dist = Math.max(0.4, 1.25 * Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]));
  S.view.fitted = true;
}
$('fitBtn').onclick = fitView;
// Reset view: from camera 1's position, looking at what is plotted (or, where camera 1 isn't known, the start angle)
function resetView() {
  setRobotView('orbit');
  Object.assign(S.view, view0()); fitView();
  const cam = cameraInPlot(), d = cam && C.sub(cam, S.view.target), r = d ? C.norm(d) : 0;
  if (r > 0.05) Object.assign(S.view, { yaw: Math.atan2(d[0], -d[1]), pitch: Math.asin(Math.max(-1, Math.min(1, d[2] / r))), dist: r });
}
$('resetViewBtn').onclick = resetView;
function autoFit() { if (S.view.fromCam && RB.pts.length + S.hist.ids().length) { S.view.fromCam = false; resetView(); } else fitView(); }
// The cameras stand still, but a reference tag's pose wobbles with its noise (a degree at 1.5 m moves a camera by
// 3 cm), so the cameras are drawn from the reference's mean pose over the last half second.
function steadyRef() {
  const key = parseKey(S.settings.frame), tr = S.tracks.get(key);
  if (!tr || !tr.pose) return null;
  const b = S.refBuf && S.refBuf.key === key ? S.refBuf : (S.refBuf = { key, a: [] });
  if (!b.a.length || b.a[b.a.length - 1].time !== tr.time) b.a.push({ time: tr.time, R: tr.pose.R, t: tr.pose.t });
  while (tr.time - b.a[0].time > 0.5) b.a.shift();
  return b.a.length > 2 ? C.meanPose(b.a, 10, 0.1) : tr.pose;
}
function draw3d() {
  const { c, w, h } = sizeCanvas(plot);
  c.clearRect(0, 0, w, h);
  const V = S.view, o = C.orbit({ yaw: V.yaw, pitch: V.pitch, dist: V.dist, target: V.target, fov: 45, w, h });
  const line = (a, b, col, lw) => { const p = o.project(a), q = o.project(b); if (!p || !q) return; c.strokeStyle = col; c.lineWidth = lw; c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(q[0], q[1]); c.stroke(); };
  const label = (P, txt, col, dx, dy, weight) => { const p = o.project(P); if (!p) return; c.fillStyle = col; c.font = `${weight || 500} 12px Archivo, system-ui, sans-serif`; c.textBaseline = 'middle'; c.fillText(txt, p[0] + (dx || 0), p[1] + (dy || 0)); };
  // ground grid in the z = 0 plane, around the target
  const step = C.niceStep(V.dist * 1.2, 8), n = 6;
  const gx = Math.round(V.target[0] / step) * step, gy = Math.round(V.target[1] / step) * step;
  c.lineCap = 'round';
  for (let i = -n; i <= n; i++) {
    line([gx + i * step, gy - n * step, 0], [gx + i * step, gy + n * step, 0], K.grid, 1);
    line([gx - n * step, gy + i * step, 0], [gx + n * step, gy + i * step, 0], K.grid, 1);
  }
  c.fillStyle = K.muted; c.font = '11px Archivo, sans-serif'; c.textBaseline = 'alphabetic';
  c.fillText(`grid ${step >= 1 ? step + ' m' : +(step * 100).toFixed(1) + ' cm'}`, 10, h - 10);
  // origin: the camera, or the reference tag
  const L0 = Math.max(0.05, step * 0.6);
  // the cameras: each placed one as a small pyramid where the rig puts it (camera 1 alone before any start)
  const camRef = S.settings.frame === 'camera' ? null : steadyRef();
  if (S.settings.frame === 'camera' || camRef) {
    const list = S.cams.length ? S.cams.filter((c) => c.T) : [{ n: 1, T: { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] }, cam: null }];
    for (const cm of list) {
      const a = cm.cam ? Math.tan((C.hfov(cm.cam) * Math.PI) / 360) : 0.7, b = cm.cam ? (a * cm.cam.h) / cm.cam.w : 0.4, d = L0;
      const P = shown(cm.T, camRef), at = (q) => C.add(C.mulv(P.R, q), P.t);
      if (C.norm(C.sub(P.t, o.eye)) < Math.max(0.15, 3 * d)) continue; // looking from this camera (Reset view): it would only be in the way
      const corners = [[-a, -b, 1], [a, -b, 1], [a, b, 1], [-a, b, 1]].map((q) => at(q.map((x) => x * d)));
      for (let k = 0; k < 4; k++) { line(P.t, corners[k], K.axis, 1.5); line(corners[k], corners[(k + 1) % 4], K.axis, 1.5); }
      line(corners[0], corners[1], K.text2, 2.5); // the top edge, so which way is up reads at a glance
      const given = cm.key && S.camNames[cm.key];
      label(at([0, b * d * 1.6, 0]), given ? (list.length > 1 ? `${cm.n} ${given}` : given) : list.length > 1 ? `Camera ${cm.n}` : 'Camera', K.text2, 6, 10);
    }
  }
  if (S.settings.frame !== 'camera') {
    // the reference: its tag, or each of its object's tags, turned upright as the plot shows it
    const rk = parseKey(S.settings.frame), b = isBody(rk) ? bodyOf(rk) : null;
    const parts = b ? b.members.map((m) => ({ R: m.R, t: m.t, size: sizeOf(m.id) })) : [{ R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0], size: sizeOf(rk) }];
    for (const pt of parts) {
      const sq = C.tagCorners(pt.size).map((q) => C.mulv(C.TAG_TO_VIEW, C.add(C.mulv(pt.R, q), pt.t)));
      for (let k = 0; k < 4; k++) line(sq[k], sq[(k + 1) % 4], colorOf(rk), 2);
    }
  }
  if (C.norm(o.eye) > Math.max(0.15, 3 * L0)) { // (not when looking from the origin, camera 1's place)
    line([0, 0, 0], [L0, 0, 0], alpha(K.x, 0.55), 1.5); line([0, 0, 0], [0, L0, 0], alpha(K.y, 0.55), 1.5); line([0, 0, 0], [0, 0, L0], alpha(K.z, 0.55), 1.5);
    label([L0, 0, 0], 'x', K.muted, 4); label([0, L0, 0], 'y', K.muted, 4); label([0, 0, L0], 'z', K.muted, 4);
  }

  const now = performance.now() / 1000, span = S.settings.span, every = S.settings.every;
  S.hist.trim(now, span); S.rawHist.trim(now, span);
  if (S.settings.show3d === 'robot') { drawRobot(c, o, w, h, now); return; }
  $('robotHint').hidden = true; $('plotGL').hidden = true;
  const legend = [], placed = [];
  // raw tracks, faint and dashed, to compare
  if (S.settings.compare && S.settings.pose !== 'raw') {
    c.setLineDash([4, 4]);
    for (const id of S.rawHist.ids()) {
      const a = S.rawHist.get(id);
      for (let k = 1; k < a.length; k++) if (a[k].time - a[k - 1].time <= 0.25) line(a[k - 1].t, a[k].t, alpha(K.muted, 0.75), 1.5);
    }
    c.setLineDash([]);
  }
  for (const id of S.hist.ids().sort(keySort)) {
    const a = S.hist.get(id), col = colorOf(id);
    // trail, fading with age
    for (let k = 1; k < a.length; k++) {
      const age = (now - a[k].time) / span;
      if (a[k].time - a[k - 1].time > 0.25) continue; // don't join across a gap
      line(a[k - 1].t, a[k].t, alpha(col, 0.2 + 0.8 * (1 - age)), 2);
    }
    // axes every `every` seconds, on a fixed time grid so they ride along the trail
    const grid = Math.floor(now / every) * every;
    const axs = C.axisSamples(a, grid, span, every), Lx = S.settings.axisLen;
    for (const s of axs) {
      const fade = 0.25 + 0.75 * (1 - (now - s.time) / span);
      const ex = C.add(s.t, C.mulv(s.R, [Lx, 0, 0])), ey = C.add(s.t, C.mulv(s.R, [0, Lx, 0])), ez = C.add(s.t, C.mulv(s.R, [0, 0, Lx]));
      line(s.t, ex, alpha(K.x, fade), 2); line(s.t, ey, alpha(K.y, fade), 2); line(s.t, ez, alpha(K.z, fade), 2);
    }
    // newest: the tag's outline, axis letters and its name
    const s = a[a.length - 1];
    if (now - s.time < 0.3) {
      // the tag's square, or each of an object's tags where they sit on it
      const parts = isBody(id) ? bodyOf(id).members.map((m) => ({ R: m.R, t: m.t, size: sizeOf(m.id) })) : [{ R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0], size: sizeOf(id) }];
      for (const pt of parts) {
        const sq = C.tagCorners(pt.size).map((q) => C.add(s.t, C.mulv(s.R, C.add(C.mulv(pt.R, q), pt.t))));
        for (let k = 0; k < 4; k++) line(sq[k], sq[(k + 1) % 4], col, 2);
      }
      label(C.add(s.t, C.mulv(s.R, [Lx, 0, 0])), 'x', K.x, 3, 0, 600);
      label(C.add(s.t, C.mulv(s.R, [0, Lx, 0])), 'y', K.y, 3, 0, 600);
      label(C.add(s.t, C.mulv(s.R, [0, 0, Lx])), 'z', K.z, 3, 0, 600);
      const p = o.project(s.t);
      if (p) {
        c.font = '600 12px Archivo, system-ui, sans-serif';
        const txt = nameOf(id), tw = c.measureText(txt).width, bw = tw + 22, bh = 20;
        let x = p[0] + 10, y = p[1] - 22;
        // nudge down past labels already drawn, so names never sit on top of each other
        for (let k = 0; k < 6 && placed.some((r) => x < r[0] + r[2] && r[0] < x + bw && y < r[1] + r[3] && r[1] < y + bh); k++) y += bh + 2;
        placed.push([x, y, bw, bh]);
        if (y !== p[1] - 22) { c.strokeStyle = alpha(K.muted, 0.6); c.lineWidth = 1; c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(x, y + bh / 2); c.stroke(); }
        c.fillStyle = alpha(K.surface, 0.88); roundRect(c, x, y, bw, bh, 5); c.fill();
        c.fillStyle = col; roundRect(c, x + 6, y + 6, 8, 8, 2); c.fill();
        c.fillStyle = K.text; c.textBaseline = 'middle'; c.fillText(txt, x + 18, y + bh / 2 + 0.5);
      }
    }
    legend.push(id);
  }
  // legend (identity never by colour alone)
  const lg = $('legend3d'), key = legend.map((id) => id + nameOf(id)).join('|') + '|' + S.settings.frame;
  if (lg.dataset.key !== key) {
    lg.dataset.key = key;
    lg.innerHTML = (legend.length ? legend.map((id) => `<span class="li"><span class="sw" style="background:${cssColorOf(id)}"></span>${escapeHtml(nameOf(id))}</span>`).join('') : '<span class="li muted">No tags in view</span>')
      + '<span class="axes"><span class="ax"><i style="background:var(--x)"></i>x</span><span class="ax"><i style="background:var(--y)"></i>y</span><span class="ax"><i style="background:var(--z)"></i>z</span></span>';
  }
  if (!S.view.fitted && legend.length) autoFit();
}
// orbit, pan, zoom
(() => {
  const pts = new Map();
  let pinch = 0;
  const safely = (f, e) => { try { return f(e); } catch (err) { console.error(err); return false; } };
  plot.addEventListener('pointerdown', (e) => { if (safely(handGrab, e)) return; plot.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); } });
  plot.addEventListener('pointermove', (e) => {
    if (safely(handMove, e)) return;
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId), dx = e.clientX - prev[0], dy = e.clientY - prev[1];
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    const V = S.view;
    if (S.settings.show3d === 'robot' && S.settings.robot.view === 'eyes') { setHeadTilt(S.settings.robot.headTilt - dy * 0.18); return; }
    if (pts.size === 2) {
      const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch) V.dist = Math.min(50, Math.max(0.1, V.dist * pinch / d));
      pinch = d; return;
    }
    if (e.shiftKey || e.buttons === 4 || e.buttons === 2) pan(dx, dy);
    else { V.yaw -= dx * 0.008; V.pitch = Math.max(-1.5, Math.min(1.5, V.pitch + dy * 0.008)); }
  });
  const up = (e) => { safely(handDrop, e); pts.delete(e.pointerId); pinch = 0; };
  plot.addEventListener('pointerup', up); plot.addEventListener('pointercancel', up);
  plot.addEventListener('contextmenu', (e) => e.preventDefault());
  plot.addEventListener('wheel', (e) => { e.preventDefault(); if (safely(handWheel, e)) return; if (S.settings.show3d === 'robot' && S.settings.robot.view === 'eyes') { setHeadTilt(S.settings.robot.headTilt - Math.sign(e.deltaY) * 2); return; } S.view.dist = Math.min(50, Math.max(0.1, S.view.dist * Math.exp(e.deltaY * 0.0012))); }, { passive: false });
  plot.addEventListener('dblclick', fitView);
  plot.addEventListener('keydown', (e) => {
    const V = S.view, k = e.key;
    if (S.settings.show3d === 'robot' && S.settings.robot.view === 'eyes' && k.startsWith('Arrow')) {
      if (k === 'ArrowUp' || k === 'ArrowDown') { setHeadTilt(S.settings.robot.headTilt + (k === 'ArrowUp' ? 3 : -3)); saveSettings(); }
      e.preventDefault(); return;
    }
    if (k === 'ArrowLeft') V.yaw += 0.1; else if (k === 'ArrowRight') V.yaw -= 0.1;
    else if (k === 'ArrowUp') V.pitch = Math.min(1.5, V.pitch + 0.1); else if (k === 'ArrowDown') V.pitch = Math.max(-1.5, V.pitch - 0.1);
    else if (k === '+' || k === '=') V.dist *= 0.9; else if (k === '-') V.dist /= 0.9;
    else if (k === 'f' || k === 'F') fitView(); else if (k === 'r' || k === 'R') resetView(); else return;
    e.preventDefault();
  });
  function pan(dx, dy) {
    const V = S.view, r = plot.getBoundingClientRect(), k = (2 * V.dist * Math.tan((45 * Math.PI) / 360)) / r.height;
    const o = C.orbit({ yaw: V.yaw, pitch: V.pitch, dist: V.dist, target: V.target, fov: 45, w: r.width, h: r.height });
    V.target = C.add(V.target, C.add(o.right.map((x) => -x * dx * k), o.up.map((x) => x * dy * k)));
  }
})();
