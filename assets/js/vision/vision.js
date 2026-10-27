// vision.js — the engine behind /vision/. Same template as /controls/ (_includes/lab.html renders
// _data/labs/vision.yml, lab-shell.js runs the cards and the lesson map); this file builds each lesson's
// panel and draws its three canvases (top, row1, row2) every frame. All the maths is in VisionCore.
//
// Sources:  photo (assets/img/vision/<name>.jpg: pencils, bicycle or facade, switchable to the table), table (the rendered ball scene),
//           stereo (two cameras on the table), camera (the visitor's webcam, never sent anywhere)
// Views:    image, zoom, profile, split, kernel, edges, corners, tensor, lambda, mask, hist, blob-list,
//           warp-src, warp-dst, warp-mat, match-pair, match-desc, match-stats, stereo-pair, stereo-cost, stereo-top,
//           learn-out, loss, net-heat, net-maps, track, track-x, track-err, cam-filter, cam-track, cam-mask
// Controls: hint, source, play, pixels, noise, light, pencil, blur, edges, corners, find, warp, match, stereo,
//           learn, net, kalman, camera, camfilter, picker
(function () {
  'use strict';
  if (typeof document === 'undefined') return;
  var C = window.VisionCore, Shell = window.LabShell;
  var cfgEl = document.getElementById('lab-config');
  if (!cfgEl || !C || !Shell) return;
  var CFG = JSON.parse(cfgEl.textContent);
  var clamp = C.clamp, el = Shell.el;
  var seed = 1234;
  function rand() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }

  /* ================= helpers ================= */
  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function withAlpha(c, a) { var m = /^#([0-9a-f]{6})$/i.exec(c); if (!m) return c; var n = parseInt(m[1], 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; }
  function fmt(v, d) { var s = v.toFixed(d); return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s; }
  var col = {};
  function readColors() {
    var m = { text: '--text', muted: '--text-muted', border: '--border', accent: '--accent', bgSoft: '--bg-soft', bg: '--bg',
      viz1: '--viz-1', viz2: '--viz-2', viz3: '--viz-3', viz4: '--viz-4', bad: '--bad', mono: '--mono', font: '--font' };
    Object.keys(m).forEach(function (k) { col[k] = cssVar(m[k]); });
  }
  function fit(canvas) {
    var dpr = window.devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight;
    var bw = Math.max(1, Math.round(W * dpr)), bh = Math.max(1, Math.round(H * dpr));
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
    var ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    return { ctx: ctx, W: W, H: H };
  }
  function text(ctx, s, x, y, color, o) {
    o = o || {};
    ctx.font = (o.w || '600') + ' ' + (o.size || 12) + 'px ' + (o.mono ? col.mono : col.font);
    ctx.fillStyle = color || col.text; ctx.textAlign = o.align || 'left'; ctx.textBaseline = o.base || 'top';
    ctx.fillText(s, x, y);
  }
  function line(ctx, pts, c, lw, dash) {
    ctx.strokeStyle = c; ctx.lineWidth = lw || 1.5; ctx.setLineDash(dash || []); ctx.beginPath();
    var on = false; pts.forEach(function (p) { if (!p || !isFinite(p[0]) || !isFinite(p[1])) { on = false; return; } if (on) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); on = true; });
    ctx.stroke(); ctx.setLineDash([]);
  }
  function ring(ctx, x, y, r, c, lw) { ctx.strokeStyle = c; ctx.lineWidth = lw || 2; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke(); }
  function cross(ctx, x, y, r, c, lw) { ctx.strokeStyle = c; ctx.lineWidth = lw || 2; ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.moveTo(x, y - r); ctx.lineTo(x, y + r); ctx.stroke(); }
  // White text on a dark tab, readable over any picture.
  function label(ctx, s, x, y, align) {
    ctx.font = '600 11px ' + col.font; var w = ctx.measureText(s).width, bx = align === 'right' ? x - w - 4 : x - 4;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(bx, y - 3, w + 8, 17);
    text(ctx, s, x, y, '#fff', { size: 11, align: align || 'left' });
  }
  function caption(c, s, sub) {
    text(c.ctx, s, 10, 8, col.text, { size: 12 });
    if (sub) text(c.ctx, sub, 10, 24, col.muted, { w: '400', size: 11 });
  }

  /* ---- images on a canvas ---- */
  // Each image is drawn into an offscreen canvas of its own size, then scaled up without smoothing, so pixels stay square.
  var off = {};
  function offCanvas(w, h) { var k = w + 'x' + h; if (!off[k]) { off[k] = document.createElement('canvas'); off[k].width = w; off[k].height = h; } return off[k]; }
  var HEAT = [[0, 0, 4], [60, 15, 110], [150, 40, 110], [230, 90, 50], [252, 200, 40], [252, 255, 164]];
  function heat(t) { t = clamp(t, 0, 1) * (HEAT.length - 1); var i = Math.min(HEAT.length - 2, Math.floor(t)), f = t - i, a = HEAT[i], b = HEAT[i + 1]; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; }
  function hueRgb(h, v) { var k = function (n) { var kk = (n + h * 6) % 6; return v * (1 - Math.max(0, Math.min(kk, 4 - kk, 1))); }; return [255 * k(5), 255 * k(3), 255 * k(1)]; }
  // mode: rgb | gray | signed (blue < 0 < orange, scaled by o.scale) | heat (0..o.scale) | hue (angle im, size o.mag)
  function toCanvas(im, mode, o) {
    o = o || {};
    var cv = offCanvas(im.w, im.h), cx = cv.getContext('2d'), id = cx.createImageData(im.w, im.h), d = id.data, n = im.w * im.h, sc = o.scale || 1;
    for (var i = 0; i < n; i++) {
      var r, g, b, a = 255;
      if (mode === 'rgb') { r = im.d[3 * i] * 255; g = im.d[3 * i + 1] * 255; b = im.d[3 * i + 2] * 255; if (isNaN(r)) a = 0; }
      else {
        var v = im.d[i];
        if (isNaN(v)) { a = 0; r = g = b = 0; }
        else if (mode === 'gray') { r = g = b = v * 255; }
        else if (mode === 'signed') { var t = clamp(v / sc, -1, 1); if (t >= 0) { r = 128 + 112 * t; g = 128 + 10 * t; b = 128 - 100 * t; } else { r = 128 + 90 * t; g = 128 + 10 * t; b = 128 - 112 * t; } }
        else if (mode === 'heat') { var hc = heat(v / sc); r = hc[0]; g = hc[1]; b = hc[2]; }
        else if (mode === 'hue') { var hh = hueRgb((v + Math.PI) / (2 * Math.PI), clamp(o.mag.d[i] / sc, 0, 1)); r = hh[0]; g = hh[1]; b = hh[2]; }
      }
      d[4 * i] = r; d[4 * i + 1] = g; d[4 * i + 2] = b; d[4 * i + 3] = a;
    }
    cx.putImageData(id, 0, 0);
    return cv;
  }
  // The largest box of the image's shape inside (x, y, w, h); returns where it went and how to map pixels to it.
  function place(iw, ih, x, y, w, h) {
    var s = Math.min(w / iw, h / ih), bw = iw * s, bh = ih * s, bx = x + (w - bw) / 2, by = y + (h - bh) / 2;
    return { x: bx, y: by, w: bw, h: bh, s: s, iw: iw, ih: ih, px: function (u) { return bx + u * s; }, py: function (v) { return by + v * s; } };
  }
  function blit(ctx, im, box, mode, o) {
    ctx.imageSmoothingEnabled = false; ctx.drawImage(toCanvas(im, mode, o), box.x, box.y, box.w, box.h); ctx.imageSmoothingEnabled = true;
    ctx.strokeStyle = col.border; ctx.lineWidth = 1; ctx.strokeRect(box.x - 0.5, box.y - 0.5, box.w + 1, box.h + 1);
  }
  function imgArea(c, top) { return { x: 8, y: top || 8, w: c.W - 16, h: c.H - (top || 8) - 8 }; }
  function dim(ctx, box, a) { ctx.fillStyle = 'rgba(0,0,0,' + a + ')'; ctx.fillRect(box.x, box.y, box.w, box.h); }

  /* ---- plots ---- */
  function axes(c, x0, y0, x1, y1, yr, title, xlab) {
    var ctx = c.ctx;
    ctx.strokeStyle = col.border; ctx.lineWidth = 1; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    if (yr[0] < 0 && yr[1] > 0) { var z = y1 - (0 - yr[0]) / (yr[1] - yr[0]) * (y1 - y0); line(ctx, [[x0, z], [x1, z]], col.border, 1, [3, 3]); }
    text(ctx, fmt(yr[1], Math.abs(yr[1]) < 10 ? 1 : 0), x0 - 4, y0, col.muted, { w: '400', size: 10, mono: true, align: 'right' });
    text(ctx, fmt(yr[0], Math.abs(yr[0]) < 10 ? 1 : 0), x0 - 4, y1 - 10, col.muted, { w: '400', size: 10, mono: true, align: 'right' });
    if (title) text(ctx, title, x0, y0 - 18, col.text, { size: 12 });
    if (xlab) text(ctx, xlab, x1, y1 + 4, col.muted, { w: '400', size: 10, align: 'right' });
    return function (i, n, v) { return [x0 + i / Math.max(1, n - 1) * (x1 - x0), y1 - (v - yr[0]) / (yr[1] - yr[0]) * (y1 - y0)]; };
  }
  function legend(ctx, items, x, y) {
    ctx.font = '500 11px ' + col.font;
    items.forEach(function (it) {
      ctx.fillStyle = it[1]; ctx.fillRect(x, y + 4, 12, 3); text(ctx, it[0], x + 16, y, col.muted, { w: '500', size: 11 });
      x += 24 + ctx.measureText(it[0]).width;
    });
  }
  function series(c, lanes, yr, title, xlab) {
    var x0 = 44, y0 = 30, x1 = c.W - 12, y1 = c.H - 22, map = axes(c, x0, y0, x1, y1, yr, title, xlab);
    lanes.forEach(function (ln) { line(c.ctx, ln.v.map(function (v, i) { return isFinite(v) ? map(i, ln.v.length, clamp(v, yr[0], yr[1])) : null; }), ln.c, ln.lw || 1.6, ln.dash); });
    legend(c.ctx, lanes.filter(function (l) { return l.name; }).map(function (l) { return [l.name, l.c]; }), x0 + 4, y1 + 5);
    return { map: map, x0: x0, y0: y0, x1: x1, y1: y1 };
  }
  function range(arrs, minSpan) {
    var lo = Infinity, hi = -Infinity;
    arrs.forEach(function (a) { a.forEach(function (v) { if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }); });
    if (!isFinite(lo)) return [-1, 1];
    var mid = (lo + hi) / 2, span = Math.max(minSpan || 0.1, (hi - lo) * 1.15);
    return [mid - span / 2, mid + span / 2];
  }

  /* ================= sources ================= */
  // Photos ship at 640 × 480 and are worked on at half that.
  var photos = {}, PW = 320, PH = 240;
  function loadPhoto(name, done) {
    if (photos[name]) { if (photos[name].im) done(); else photos[name].wait.push(done); return; }
    var P = photos[name] = { im: null, wait: [done] }, img = new Image();
    img.onload = function () {
      var cv = document.createElement('canvas'); cv.width = PW; cv.height = PH;
      var cx = cv.getContext('2d'); cx.drawImage(img, 0, 0, PW, PH);
      var px = cx.getImageData(0, 0, PW, PH).data, im = C.image(PW, PH, 3);
      for (var i = 0; i < PW * PH; i++) { im.d[3 * i] = px[4 * i] / 255; im.d[3 * i + 1] = px[4 * i + 1] / 255; im.d[3 * i + 2] = px[4 * i + 2] / 255; }
      P.im = im; P.wait.forEach(function (f) { f(); }); P.wait = [];
    };
    img.src = CFG.assets.img + name + '.jpg';
  }
  var cam = { stream: null, video: null, status: 'off', users: [] };
  function startCamera() {
    if (cam.stream || cam.status === 'asking') return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { cam.status = 'none'; return; }
    cam.status = 'asking';
    navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 320 }, height: { ideal: 240 }, facingMode: 'user' }, audio: false }).then(function (s) {
      cam.stream = s; cam.video = document.createElement('video'); cam.video.playsInline = true; cam.video.muted = true; cam.video.srcObject = s; cam.video.play(); cam.status = 'on';
    }).catch(function () { cam.status = 'denied'; });
  }
  function stopCamera() {
    if (cam.stream) cam.stream.getTracks().forEach(function (t) { t.stop(); });
    cam.stream = null; cam.video = null; if (cam.status === 'on') cam.status = 'off';
  }
  function cameraFrame() {                          // mirrored, like a mirror, 192 × 144
    var v = cam.video; if (!v || v.readyState < 2) return null;
    var cv = offCanvas(192, 144), cx = cv.getContext('2d');
    cx.save(); cx.translate(192, 0); cx.scale(-1, 1);
    var vw = v.videoWidth, vh = v.videoHeight, s = Math.max(192 / vw, 144 / vh);
    cx.drawImage(v, (192 - vw * s) / 2, (144 - vh * s) / 2, vw * s, vh * s); cx.restore();
    var px = cx.getImageData(0, 0, 192, 144).data, im = C.image(192, 144, 3);
    for (var i = 0; i < 192 * 144; i++) { im.d[3 * i] = px[4 * i] / 255; im.d[3 * i + 1] = px[4 * i + 1] / 255; im.d[3 * i + 2] = px[4 * i + 2] / 255; }
    return im;
  }

  /* ================= lesson state ================= */
  // Each lesson keeps its own state S: where its frame comes from, its settings, and a cache of what was worked
  // out from the current frame (cleared whenever the frame or a setting changes).
  var PENCIL = [62, 9, 78, 21];
  function makeState(tc) {
    var lc = CFG.labs[tc.lab] || {};
    var S = {
      source: lc.source || 'table', photo: lc.photo || 'pencils', light: lc.light !== undefined ? lc.light : 1, noise: lc.noise || 0,
      pencil: !!lc.pencil, card: lc.card ? { x: 52, y: 4, w: 16, h: 42 } : null, playing: true,
      block: 1, bits: 8, blur: { type: 'gauss', sigma: 1.5, size: 5 }, edge: { show: 'mag', sigma: 0, thr: 0.7 },
      hz: { k: 0.05, rel: 0.03, sigma: 1.2, showR: false }, find: { t: 0.3, round: 0 },
      frame: null, ver: 0, memo: {}, acc: 0, probe: null, split: 0.5, base: 'photo'
    };
    S.scene = C.createScene();
    S.bump = function () { S.ver++; S.memo = {}; };
    S.get = function (k, f) { return k in S.memo ? S.memo[k] : (S.memo[k] = f()); };
    return S;
  }
  // The frame this lesson shows now. Photos are fixed (noise is drawn once per setting); the table renders at 30 fps.
  function acquire(S, dt) {
    if (S.source === 'camera') {
      var f = cameraFrame(); if (f) { S.frame = f; S.memo = {}; }
      return;
    }
    if (S.source === 'photo') {
      var P = photos[S.photo];
      if (!P || !P.im) { loadPhoto(S.photo, function () { S.frame = null; S.bump(); }); return; }
      if (!S.frame || S.frameVer !== S.ver) { S.frame = S.noise > 0 ? C.addNoise(P.im, S.noise, rand) : P.im; S.frameVer = S.ver; }
      return;
    }
    if (S.source === 'table') {
      S.acc += dt;
      if (!S.frame || S.acc >= 1 / 30 || S.frameVer !== S.ver) {
        if (S.playing && S.frame) S.scene.step(Math.min(S.acc, 0.1));
        S.acc = 0; S.frameVer = S.ver;
        S.frame = C.renderScene(S.scene, { light: S.light, noise: S.noise, pencil: S.pencil ? PENCIL : null, card: S.card }, rand);
        S.memo = {}; S.fresh = true;
      }
    }
  }
  /* ---- what the lessons work out from the frame (each once per frame) ---- */
  function shown(S) {                               // after the Pixels lesson's resolution and bit depth
    return S.get('shown', function () { var im = S.frame; if (S.block > 1) im = C.pixelate(im, S.block); if (S.bits < 8) im = C.quantize(im, S.bits); return im; });
  }
  function grayOf(S) { return S.get('gray', function () { return C.gray(shown(S)); }); }
  function kernelOf(S) { return S.blur.type === 'box' ? C.boxKernel(S.blur.size) : C.gaussianKernel(S.blur.sigma); }
  function blurred(S) { return S.get('blur', function () { return C.convolveSep(shown(S), kernelOf(S).k1); }); }
  function edgesOf(S) {
    return S.get('edges', function () {
      var g = grayOf(S); if (S.edge.sigma > 0) g = C.convolveSep(g, C.gaussianKernel(S.edge.sigma).k1);
      var e = C.sobel(g); e.src = g; return e;
    });
  }
  function harrisOf(S) { return S.get('harris', function () { return C.harris(grayOf(S), { k: S.hz.k, rel: S.hz.rel, sigma: S.hz.sigma, max: 300 }); }); }
  function rednessOf(S) { return S.get('red', function () { return C.redness(shown(S)); }); }
  function blobsOf(S) {
    return S.get('blobs', function () {
      var r = C.blobs(C.threshold(rednessOf(S), S.find.t), S.frame.w, S.frame.h, 4);
      r.ball = C.pickBall(r.blobs, S.find.round); return r;
    });
  }
  function probeOf(S) {
    if (!S.probe) S.probe = S.source === 'table' || !S.frame ? { x: 96, y: 80 } : { x: Math.round(S.frame.w * 0.55), y: Math.round(S.frame.h * 0.6) };
    if (S.frame) { S.probe.x = clamp(S.probe.x, 0, S.frame.w - 1); S.probe.y = clamp(S.probe.y, 0, S.frame.h - 1); }
    return S.probe;
  }
  function truthPx(S) { return C.ballPixel(S.scene.x, S.scene.y); }

  /* ================= pointer ================= */
  // Views record where they drew the image (S.hit[slot] = box); a drag on that canvas then moves whatever the view says.
  function bindPointer(canvas, tab, slot) {
    function at(e) { var r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    function imgPt(h, p) { return { x: (p.x - h.box.x) / h.box.s, y: (p.y - h.box.y) / h.box.s }; }
    var drag = null;
    canvas.addEventListener('pointerdown', function (e) {
      var h = tab.hit[slot]; if (!h) return;
      var p = at(e), q = h.box ? imgPt(h, p) : p;
      drag = h.down ? h.down(q, p) : null;
      if (drag) { canvas.setPointerCapture(e.pointerId); e.preventDefault(); drag(q, p); }
    });
    canvas.addEventListener('pointermove', function (e) {
      var h = tab.hit[slot]; if (!h) return;
      var p = at(e), q = h.box ? imgPt(h, p) : p;
      tab.hover[slot] = h.box && (e.pointerType === 'mouse' || drag) ? q : null;     // where the magnifier looks
      if (drag) drag(q, p); else canvas.style.cursor = h.cursor ? h.cursor(q, p) || '' : '';
    });
    function up(e) { drag = null; if (e.pointerType !== 'mouse') tab.hover[slot] = null; }
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', function () { tab.hover[slot] = null; });
  }
  function probeHit(S, box) {
    return { box: box, down: function () { return function (q) { if (q.x < 0 || q.y < 0 || q.x > box.iw || q.y > box.ih) return; S.probe = { x: Math.floor(q.x), y: Math.floor(q.y) }; S.probeMoved = true; }; }, cursor: function () { return 'crosshair'; } };
  }
  // The magnifier: a round window by the pointer showing the patch under it, blown up, as the lesson's filter sees it.
  // layer = [image, mode, options] (as for blit); the small ring on the picture marks the patch it shows.
  function loupe(c, box, hv, layer, title) {
    if (!hv || hv.x < 0 || hv.y < 0 || hv.x > box.iw || hv.y > box.ih) return;
    var ctx = c.ctx, R = Math.max(40, Math.min(80, c.H * 0.3)), rs = 10, px = box.px(hv.x), py = box.py(hv.y);
    var cx = px + R + 22, cy = py - R * 0.6;
    if (cx + R > c.W - 4) cx = px - R - 22;
    cy = clamp(cy, R + 4, c.H - R - 22);
    ring(ctx, px, py, rs * box.s, '#fff', 2.5); ring(ctx, px, py, rs * box.s, col.accent, 1.2);
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.clip();
    ctx.fillStyle = col.bgSoft; ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(toCanvas(layer[0], layer[1], layer[2]), hv.x - rs, hv.y - rs, 2 * rs, 2 * rs, cx - R, cy - R, 2 * R, 2 * R);
    ctx.imageSmoothingEnabled = true; ctx.restore();
    ring(ctx, cx, cy, R, '#fff', 4); ring(ctx, cx, cy, R, col.accent, 2);
    label(ctx, title + ' · ×' + fmt(R / rs / box.s, 0), cx - R + 10, cy + R + 4);
  }
  function drawProbe(ctx, box, p, rowLine) {
    var x = box.px(p.x + 0.5), y = box.py(p.y + 0.5);
    if (rowLine) line(ctx, [[box.x, y], [box.x + box.w, y]], withAlpha(col.accent, 0.7), 1, [4, 3]);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.strokeRect(x - box.s * 3.5 - 1, y - box.s * 3.5 - 1, box.s * 7 + 2, box.s * 7 + 2);
    ctx.strokeStyle = col.accent; ctx.lineWidth = 1.5; ctx.strokeRect(x - box.s * 3.5 - 1, y - box.s * 3.5 - 1, box.s * 7 + 2, box.s * 7 + 2);
  }
  function waiting(c, S) {
    var msg = S.source === 'camera' ? cameraMessage() : 'Loading the photo…';
    text(c.ctx, msg, c.W / 2, c.H / 2 - 7, col.muted, { w: '500', size: 13, align: 'center' });
  }
  function cameraMessage() {
    return { off: 'Press "Start camera" in the panel. Frames stay in this browser.', asking: 'Waiting for permission to use the camera…',
      denied: 'The camera was blocked. Allow it in the address bar, or use the lessons above.', none: 'This browser has no camera access here.', on: 'Starting…' }[cam.status];
  }

  /* ================= views ================= */
  var V = {};
  // Pixels: the frame, with the probe square.
  V.image = function (c, S, tab, slot) {
    if (!S.frame) return waiting(c, S);
    var im = shown(S), box = place(im.w, im.h, 8, 8, c.W - 16, c.H - 16);
    blit(c.ctx, im, box, 'rgb'); drawProbe(c.ctx, box, probeOf(S), tab.profile !== false);
    loupe(c, box, tab.hover[slot], [im, 'rgb'], 'magnified');
    var colsN = Math.ceil(im.w / S.block), rowsN = Math.ceil(im.h / S.block);
    label(c.ctx, colsN + ' × ' + rowsN + ' pixels · ' + Math.pow(2, S.bits) + ' levels each', box.x + 6, box.y + 6);
    tab.hit[slot] = probeHit(S, box);
  };
  // The 7 × 7 pixels round the probe, each with its numbers.
  V.zoom = function (c, S) {
    if (!S.frame) return;
    var im = shown(S), p = probeOf(S), ctx = c.ctx, n = 7, cell = Math.min((c.W - 160) / n, (c.H - 40) / n), x0 = 12, y0 = 30, grey = S.zoomGray;
    caption(c, 'The pixels in the square', null);
    for (var j = 0; j < n; j++) for (var i = 0; i < n; i++) {
      var x = clamp(p.x + i - 3, 0, im.w - 1), y = clamp(p.y + j - 3, 0, im.h - 1), k = (y * im.w + x) * 3;
      var r = Math.round(im.d[k] * 255), g = Math.round(im.d[k + 1] * 255), b = Math.round(im.d[k + 2] * 255), L = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      ctx.fillStyle = grey ? 'rgb(' + L + ',' + L + ',' + L + ')' : 'rgb(' + r + ',' + g + ',' + b + ')'; ctx.fillRect(x0 + i * cell, y0 + j * cell, cell - 1, cell - 1);
      var tc = L > 140 ? '#000' : '#fff', fs = Math.max(8, Math.min(11, cell / 4.2));
      if (grey) text(ctx, String(L), x0 + (i + 0.5) * cell, y0 + (j + 0.5) * cell - fs / 2, tc, { size: fs, mono: true, align: 'center', w: '500' });
      else if (cell > 34) [r, g, b].forEach(function (v, q) { text(ctx, String(v), x0 + (i + 0.5) * cell, y0 + (j + 0.5) * cell + (q - 1.5) * fs, tc, { size: fs, mono: true, align: 'center', w: '500' }); });
    }
    var k0 = (p.y * im.w + p.x) * 3, tx = x0 + n * cell + 14;
    text(ctx, 'Centre pixel (' + p.x + ', ' + p.y + ')', tx, y0, col.text, { size: 12 });
    [['R', im.d[k0], '#e05545'], ['G', im.d[k0 + 1], '#3fa45a'], ['B', im.d[k0 + 2], '#4a7fe0']].forEach(function (q, i) {
      var y = y0 + 24 + i * 22, v = Math.round(q[1] * 255);
      text(ctx, q[0], tx, y, q[2], { size: 12, mono: true });
      ctx.fillStyle = withAlpha(col.border, 1); ctx.fillRect(tx + 18, y + 2, 100, 9); ctx.fillStyle = q[2]; ctx.fillRect(tx + 18, y + 2, v / 255 * 100, 9);
      text(ctx, String(v), tx + 124, y, col.muted, { w: '400', size: 11, mono: true });
    });
    text(ctx, 'Each is one byte: 0 to 255.', tx, y0 + 96, col.muted, { w: '400', size: 11 });
  };
  // A line through the probe's row: brightness, and what the lesson's filter makes of it.
  V.profile = function (c, S, tab) {
    if (!S.frame) return;
    var p = probeOf(S), im = shown(S), w = im.w, row = function (img, ch, nc) { var a = []; for (var x = 0; x < w; x++) a.push(img.d[(p.y * w + x) * (nc || 1) + (ch || 0)]); return a; };
    var kind = tab.profile || 'rgb', r;
    if (kind === 'rgb') {
      series(c, [{ v: row(im, 0, 3).map(f255), c: '#e05545', name: 'red' }, { v: row(im, 1, 3).map(f255), c: '#3fa45a', name: 'green' }, { v: row(im, 2, 3).map(f255), c: '#4a7fe0', name: 'blue' }], [0, 255], 'Along the dashed row, 0 to 255', 'x (pixels)');
    } else if (kind === 'blur') {
      var g0 = row(grayOf(S)), g1 = row(C.gray(blurred(S)));
      r = range([g0, g1], 0.2);
      series(c, [{ v: g0, c: col.muted, name: 'before', lw: 1 }, { v: g1, c: col.accent, name: 'after the blur', lw: 2 }], r, 'Brightness along the row: the noise is averaged away, and so is some of the edge', 'x (pixels)');
    } else if (kind === 'edge') {
      var e = edgesOf(S), b = row(e.src), sl = row(e.gx).map(function (v) { return v / 8; });
      r = range([b, sl], 0.2);
      series(c, [{ v: b, c: col.muted, name: 'brightness' }, { v: sl, c: col.accent, name: 'slope across (Gx ÷ 8)', lw: 2 }], r, 'The slope is big where the brightness steps', 'x (pixels)');
    }
    var fx = 44 + p.x / (w - 1) * (c.W - 56); line(c.ctx, [[fx, 30], [fx, c.H - 22]], withAlpha(col.accent, 0.5), 1, [2, 3]);
  };
  function f255(v) { return v * 255; }
  // Blur: before on the left of the divider, after on the right.
  V.split = function (c, S, tab, slot) {
    if (!S.frame) return waiting(c, S);
    var im = shown(S), bl = blurred(S), box = place(im.w, im.h, 8, 8, c.W - 16, c.H - 16), ctx = c.ctx, sx = box.x + box.w * S.split;
    blit(ctx, im, box, 'rgb');
    ctx.save(); ctx.beginPath(); ctx.rect(sx, box.y, box.x + box.w - sx, box.h); ctx.clip(); blit(ctx, bl, box, 'rgb'); ctx.restore();
    line(ctx, [[sx, box.y], [sx, box.y + box.h]], '#fff', 3); line(ctx, [[sx, box.y], [sx, box.y + box.h]], col.accent, 1.5);
    ctx.fillStyle = col.accent; ctx.beginPath(); ctx.arc(sx, box.y + box.h / 2, 7, 0, 7); ctx.fill();
    label(ctx, 'before', box.x + 6, box.y + 6); label(ctx, 'after', box.x + box.w - 6, box.y + 6, 'right');
    var p = probeOf(S); line(ctx, [[box.x, box.py(p.y + 0.5)], [box.x + box.w, box.py(p.y + 0.5)]], withAlpha(col.accent, 0.7), 1, [4, 3]);
    loupe(c, box, tab.hover[slot], [bl, 'rgb'], 'blurred');
    tab.hit[slot] = { box: box, down: function (q) {
      if (Math.abs(box.px(q.x) - sx) < 14) return function (q2) { S.split = clamp(q2.x / box.iw, 0, 1); };
      return function (q2) { if (q2.y >= 0 && q2.y < box.ih) S.probe = { x: probeOf(S).x, y: Math.floor(q2.y) }; };
    }, cursor: function (q) { return Math.abs(box.px(q.x) - sx) < 14 ? 'ew-resize' : 'row-resize'; } };
  };
  // A kernel as a grid of weights (shaded by size and sign), with the probe's own sum where it helps.
  function kernelGrid(ctx, k, n, x0, y0, size, title, digits) {
    var cell = size / n, mx = 0; k.forEach(function (v) { mx = Math.max(mx, Math.abs(v)); });
    text(ctx, title, x0, y0 - 18, col.text, { size: 12 });
    for (var j = 0; j < n; j++) for (var i = 0; i < n; i++) {
      var v = k[j * n + i], t = mx ? v / mx : 0;
      ctx.fillStyle = t >= 0 ? withAlpha(col.accent, 0.08 + 0.75 * t) : withAlpha('#4a7fe0', 0.08 - 0.75 * t);
      ctx.fillRect(x0 + i * cell, y0 + j * cell, cell - 1, cell - 1);
      if (cell >= 22) text(ctx, fmt(v, digits === undefined ? 2 : digits), x0 + (i + 0.5) * cell, y0 + (j + 0.5) * cell - 5, col.text, { size: Math.min(11, cell / 3.4), mono: true, align: 'center', w: '500' });
    }
  }
  V.kernel = function (c, S, tab) {
    var ctx = c.ctx, size = Math.min(c.H - 44, 150), y0 = 30;
    if (tab.kernel === 'sobel') {
      var gs = Math.min(size * 0.75, 110), gap = Math.max(gs, 116) + 16;
      kernelGrid(ctx, C.SOBEL_X, 3, 12, y0, gs, 'Gx: slope across', 0);
      kernelGrid(ctx, C.SOBEL_Y, 3, 12 + gap, y0, gs, 'Gy: slope down', 0);
      if (!S.frame) return;
      var e = edgesOf(S), p = probeOf(S), i = p.y * S.frame.w + p.x, tx = 12 + 2 * gap;
      text(ctx, 'At the probe', tx, y0 - 18, col.text, { size: 12 });
      [['Gx', fmt(e.gx.d[i], 2)], ['Gy', fmt(e.gy.d[i], 2)], ['size √(Gx² + Gy²)', fmt(e.mag.d[i], 2)], ['direction', fmt(e.dir.d[i] * 180 / Math.PI, 0) + '°']].forEach(function (r, k) {
        text(ctx, r[0], tx, y0 + k * 20, col.muted, { w: '400', size: 12 }); text(ctx, r[1], tx + 130, y0 + k * 20, col.text, { size: 12, mono: true });
      });
      text(ctx, 'Each weight multiplies the pixel under it; the sum is the slope.', tx, y0 + 88, col.muted, { w: '400', size: 11 });
      return;
    }
    if (tab.kernel === 'learn') {
      var Lr = tab.learner, tk = C.KERNELS[S.target];
      var ls = Math.min(size * 0.8, 120), lgap = Math.max(ls, 130) + 16;
      kernelGrid(ctx, Lr.w, 3, 12, y0, ls, 'What it has learned', 2);
      kernelGrid(ctx, tk, 3, 12 + lgap, y0, ls, 'The answer', 2);
      var err = Math.max.apply(null, Lr.w.map(function (v, k) { return Math.abs(v - tk[k]); }));
      var tx2 = 12 + 2 * lgap;
      text(ctx, 'Largest weight error', tx2, y0, col.muted, { w: '400', size: 12 }); text(ctx, fmt(err, 3), tx2, y0 + 18, err < 0.05 ? col.viz1 : col.text, { size: 16, mono: true });
      text(ctx, 'Training step ' + Lr.t, tx2, y0 + 48, col.muted, { w: '400', size: 12 });
      return;
    }
    var K = kernelOf(S), n = K.n, show = Math.min(n, 9), r = (n - show) >> 1, sub = [];
    for (var j = 0; j < show; j++) for (var ii = 0; ii < show; ii++) sub.push(K.k[(j + r) * n + ii + r]);
    kernelGrid(ctx, sub, show, 12, y0, size, (S.blur.type === 'box' ? 'Box' : 'Gaussian') + ' kernel, ' + n + ' × ' + n + (show < n ? ' (middle 9 × 9)' : ''), show > 7 ? 3 : 3);
    var tx3 = 30 + size, w3 = c.W - tx3 - 14, k1 = K.k1, mx = Math.max.apply(null, k1);
    text(ctx, 'One row of it', tx3, y0 - 18, col.text, { size: 12 });
    k1.forEach(function (v, k) { var bw = w3 / k1.length, bh = v / mx * (size - 20); ctx.fillStyle = withAlpha(col.accent, 0.75); ctx.fillRect(tx3 + k * bw + 1, y0 + size - 20 - bh, bw - 2, bh); });
    var sum = K.k.reduce(function (a, b) { return a + b; }, 0);
    text(ctx, 'weights add to ' + fmt(sum, 2) + ', so brightness is kept', tx3, y0 + size - 12, col.muted, { w: '400', size: 11 });
  };
  // Edges: Gx, Gy, size or direction of the slope; the threshold paints strong edges. The photo shows underneath
  // and the magnifier shows the edges, unless the panel asks for the whole edge map.
  function edgeLayer(S) {
    var e = edgesOf(S), sh = S.edge.show;
    if (sh === 'gx') return [e.gx, 'signed', { scale: 1.2 }];
    if (sh === 'gy') return [e.gy, 'signed', { scale: 1.2 }];
    if (sh === 'dir') return [e.dir, 'hue', { mag: e.mag, scale: 0.8 }];
    return [S.get('edgeMap', function () { var m = C.image(e.mag.w, e.mag.h, 1); for (var i = 0; i < m.d.length; i++) m.d[i] = e.mag.d[i] > S.edge.thr ? 1 : e.mag.d[i] / S.edge.thr * 0.45; return m; }), 'gray'];
  }
  var EDGE_NAMES = { gx: 'Gx', gy: 'Gy', mag: 'slope size', dir: 'slope angle' };
  V.edges = function (c, S, tab, slot) {
    if (!S.frame) return waiting(c, S);
    var L = edgeLayer(S), box = place(L[0].w, L[0].h, 8, 8, c.W - 16, c.H - 16), ctx = c.ctx, sh = S.edge.show, whole = S.base === 'map';
    if (whole) blit(ctx, L[0], box, L[1], L[2]); else blit(ctx, shown(S), box, 'rgb');
    var lbl = { gx: 'Gx: orange where it gets brighter to the right, blue darker', gy: 'Gy: orange where it gets brighter downwards, blue darker', mag: 'Slope size: white above the threshold', dir: 'Direction as colour, size as brightness' }[sh];
    label(ctx, whole ? lbl : 'Point at the photo to see its ' + EDGE_NAMES[sh], box.x + 6, box.y + 6);
    drawProbe(ctx, box, probeOf(S), true);
    loupe(c, box, tab.hover[slot], whole ? [shown(S), 'rgb'] : L, whole ? 'the photo' : EDGE_NAMES[sh]);
    tab.hit[slot] = probeHit(S, box);
  };
  // Corners: Harris's picks on the photo, or its response R as heat.
  V.corners = function (c, S, tab, slot) {
    if (!S.frame) return waiting(c, S);
    var hz = harrisOf(S), im = shown(S), box = place(im.w, im.h, 8, 8, c.W - 16, c.H - 16), ctx = c.ctx;
    if (S.hz.showR) { var R = C.image(im.w, im.h, 1); for (var i = 0; i < R.d.length; i++) R.d[i] = Math.max(0, hz.R.d[i]); blit(ctx, R, box, 'heat', { scale: hz.max * 0.05 }); }
    else { blit(ctx, grayOf(S), box, 'gray'); dim(ctx, box, 0.25); }
    hz.corners.forEach(function (p) { ring(ctx, box.px(p.x), box.py(p.y), 3 + 3 * Math.min(1, Math.sqrt(p.r / hz.max) * 2), col.viz2, 1.5); });
    label(ctx, hz.corners.length + ' corners', box.x + 6, box.y + 6);
    drawProbe(ctx, box, probeOf(S), false);
    var Rpos = S.get('Rpos', function () { var R = C.image(im.w, im.h, 1); for (var i = 0; i < R.d.length; i++) R.d[i] = Math.max(0, hz.R.d[i]); return R; });
    loupe(c, box, tab.hover[slot], S.hz.showR ? [im, 'rgb'] : [Rpos, 'heat', { scale: hz.max * 0.05 }], S.hz.showR ? 'the photo' : 'response R');
    tab.hit[slot] = probeHit(S, box);
  };
  // The slopes in the probe's window as points (Ix, Iy): a blob is flat, a line is an edge, a spread is a corner.
  function tensorAt(S) {
    var g = grayOf(S), p = probeOf(S), w = g.w, pts = [], a = 0, b = 0, cc = 0, sg = S.hz.sigma, r = Math.ceil(2 * sg);
    for (var j = -r; j <= r; j++) for (var i = -r; i <= r; i++) {
      var x = clamp(p.x + i, 1, w - 2), y = clamp(p.y + j, 1, g.h - 2), wt = Math.exp(-(i * i + j * j) / (2 * sg * sg));
      var ix = (g.d[(y - 1) * w + x + 1] + 2 * g.d[y * w + x + 1] + g.d[(y + 1) * w + x + 1] - g.d[(y - 1) * w + x - 1] - 2 * g.d[y * w + x - 1] - g.d[(y + 1) * w + x - 1]) / 8;
      var iy = (g.d[(y + 1) * w + x - 1] + 2 * g.d[(y + 1) * w + x] + g.d[(y + 1) * w + x + 1] - g.d[(y - 1) * w + x - 1] - 2 * g.d[(y - 1) * w + x] - g.d[(y - 1) * w + x + 1]) / 8;
      pts.push([ix, iy, wt]); a += wt * ix * ix; b += wt * iy * iy; cc += wt * ix * iy;
    }
    var sw = pts.reduce(function (s, q) { return s + q[2]; }, 0); a /= sw; b /= sw; cc /= sw;
    var tr = (a + b) / 2, det = Math.sqrt(Math.max(0, (a - b) * (a - b) / 4 + cc * cc));
    return { pts: pts, l1: tr + det, l2: Math.max(0, tr - det), ang: 0.5 * Math.atan2(2 * cc, a - b), R: (a * b - cc * cc) - S.hz.k * (a + b) * (a + b) };
  }
  V.tensor = function (c, S) {
    if (!S.frame) return;
    var T = tensorAt(S), ctx = c.ctx, size = Math.min(c.H - 44, c.W * 0.45), cx = 14 + size / 2, cy = 32 + size / 2, sc = size / 2 / 0.35;
    text(ctx, 'Slopes in the probe window', 14, 10, col.text, { size: 12 });
    ctx.strokeStyle = col.border; ctx.lineWidth = 1; ctx.strokeRect(cx - size / 2, cy - size / 2, size, size);
    line(ctx, [[cx - size / 2, cy], [cx + size / 2, cy]], col.border, 1, [3, 3]); line(ctx, [[cx, cy - size / 2], [cx, cy + size / 2]], col.border, 1, [3, 3]);
    text(ctx, 'Ix', cx + size / 2 - 14, cy + 3, col.muted, { w: '400', size: 10 }); text(ctx, 'Iy', cx + 3, cy - size / 2 + 2, col.muted, { w: '400', size: 10 });
    T.pts.forEach(function (q) { ctx.fillStyle = withAlpha(col.accent, 0.25 + 0.6 * q[2]); ctx.beginPath(); ctx.arc(cx + clamp(q[0] * sc, -size / 2, size / 2), cy + clamp(q[1] * sc, -size / 2, size / 2), 2.4, 0, 7); ctx.fill(); });
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(T.ang); ctx.strokeStyle = col.viz2; ctx.lineWidth = 2; ctx.beginPath();
    ctx.ellipse(0, 0, Math.min(size / 2, 2 * Math.sqrt(T.l1) * sc), Math.min(size / 2, 2 * Math.sqrt(T.l2) * sc), 0, 0, 7); ctx.stroke(); ctx.restore();
    var kind = T.R > S.hz.rel * harrisOf(S).max && T.R > 0 ? 'a corner' : T.l1 > 4 * T.l2 && T.l1 > 1e-4 ? 'an edge' : 'flat';
    var tx = cx + size / 2 + 18;
    text(ctx, 'This window is ' + kind, tx, 32, col.text, { size: 13 });
    [['λ₁ (the long way)', fmt(T.l1 * 1000, 2)], ['λ₂ (the short way)', fmt(T.l2 * 1000, 2)], ['R = λ₁λ₂ − k(λ₁+λ₂)²', fmt(T.R * 1e6, 2)]].forEach(function (r, i) {
      text(ctx, r[0], tx, 58 + i * 20, col.muted, { w: '400', size: 12 }); text(ctx, r[1], tx + 170, 58 + i * 20, col.text, { size: 12, mono: true });
    });
    text(ctx, 'λ ×1000, R ×10⁶. One long axis: an edge. Two: a corner.', tx, 124, col.muted, { w: '400', size: 11 });
  };
  // Where the probe sits on the λ₁–λ₂ plane, against the line where R crosses the threshold.
  V.lambda = function (c, S) {
    if (!S.frame) return;
    var T = tensorAt(S), hz = harrisOf(S), ctx = c.ctx, x0 = 50, y0 = 28, x1 = c.W - 16, y1 = c.H - 26, M = 0.03, k = S.hz.k, t = S.hz.rel * hz.max;
    function X(l) { return x0 + Math.sqrt(clamp(l / M, 0, 1)) * (x1 - x0); } function Y(l) { return y1 - Math.sqrt(clamp(l / M, 0, 1)) * (y1 - y0); }
    ctx.fillStyle = withAlpha(col.viz2, 0.12);
    ctx.beginPath(); ctx.moveTo(X(M), Y(M)); var pts = [];
    for (var s = 0; s <= 60; s++) { var l1 = M * Math.pow(s / 60, 2); var lo = 0, hi = M; for (var it = 0; it < 40; it++) { var mid = (lo + hi) / 2; if (l1 * mid - k * (l1 + mid) * (l1 + mid) > t) hi = mid; else lo = mid; } pts.push([X(l1), Y(hi)]); }
    pts.forEach(function (p) { ctx.lineTo(p[0], p[1]); }); ctx.lineTo(X(M), Y(M)); ctx.closePath(); ctx.fill();
    line(ctx, pts, col.viz2, 1.5);
    ctx.strokeStyle = col.border; ctx.lineWidth = 1; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    text(ctx, 'λ₁ →', x1, y1 + 6, col.muted, { w: '400', size: 11, align: 'right' }); text(ctx, 'λ₂ ↑', x0 - 6, y0, col.muted, { w: '400', size: 11, align: 'right' });
    text(ctx, 'corner', X(M * 0.7), Y(M * 0.75), col.viz2, { size: 12 }); text(ctx, 'edge', X(M * 0.6), Y(M * 0.002), col.muted, { w: '500', size: 12 }); text(ctx, 'flat', x0 + 6, y1 - 18, col.muted, { w: '500', size: 12 });
    text(ctx, 'The probe on the plane of λ₁ and λ₂ (shaded: R above the threshold)', x0, 8, col.text, { size: 12 });
    ctx.fillStyle = col.accent; ctx.beginPath(); ctx.arc(X(Math.max(T.l1, T.l2)), Y(Math.min(T.l1, T.l2)), 6, 0, 7); ctx.fill(); ctx.strokeStyle = col.bg; ctx.lineWidth = 2; ctx.stroke();
  };
  // Find the ball: the red pixels, the blobs they form, and which blob is called the ball.
  V.mask = function (c, S, tab, slot) {
    if (!S.frame) return waiting(c, S);
    var im = shown(S), box = place(im.w, im.h, 8, 8, c.W - 16, c.H - 16), ctx = c.ctx, B = blobsOf(S), red = rednessOf(S);
    blit(ctx, C.gray(im), box, 'gray'); dim(ctx, box, 0.35);
    var m = C.image(im.w, im.h, 3); for (var i = 0; i < red.d.length; i++) { var on = red.d[i] > S.find.t; m.d[3 * i] = on ? 1 : NaN; m.d[3 * i + 1] = on ? 0.85 : NaN; m.d[3 * i + 2] = on ? 0.2 : NaN; }
    blit(ctx, m, box, 'rgb');
    B.blobs.forEach(function (b) {
      var isBall = b === B.ball;
      ctx.strokeStyle = isBall ? col.viz1 : '#fff'; ctx.lineWidth = isBall ? 2 : 1; ctx.strokeRect(box.px(b.x0) - 2, box.py(b.y0) - 2, (b.x1 - b.x0) * box.s + 4, (b.y1 - b.y0) * box.s + 4);
      label(ctx, b.area + ' px · round ' + fmt(b.round, 2) + (isBall ? ' · ball' : ''), box.px(b.x0) + 2, box.py(b.y1) + 6);
      if (isBall) cross(ctx, box.px(b.cx), box.py(b.cy), 6, col.viz1, 2);
    });
    if (S.source === 'table') { var t = truthPx(S); ring(ctx, box.px(t.u), box.py(t.v), t.r * box.s + 4, withAlpha('#ffffff', 0.6), 1); }
    label(ctx, B.ball ? 'Ball at (' + fmt(B.ball.cx, 1) + ', ' + fmt(B.ball.cy, 1) + ') px' : 'No ball found', box.x + 6, box.y + 6);
    tab.hit[slot] = null;
  };
  V.hist = function (c, S, tab, slot) {
    if (!S.frame) return;
    var red = rednessOf(S), lo = -0.5, hi = 1, bins = 90, h = C.histogram(red, bins, lo, hi), ctx = c.ctx, x0 = 44, y0 = 28, x1 = c.W - 14, y1 = c.H - 24;
    var mx = Math.log10(1 + Math.max.apply(null, h));
    text(ctx, 'How many pixels have each redness (log scale). Drag the line.', x0, 8, col.text, { size: 12 });
    h.forEach(function (n, i) {
      var bx = x0 + i / bins * (x1 - x0), bw = (x1 - x0) / bins, bh = Math.log10(1 + n) / mx * (y1 - y0), v = lo + (i + 0.5) / bins * (hi - lo);
      ctx.fillStyle = v > S.find.t ? withAlpha(col.viz2, 0.85) : withAlpha(col.muted, 0.5); ctx.fillRect(bx, y1 - bh, Math.max(1, bw - 1), bh);
    });
    ctx.strokeStyle = col.border; ctx.lineWidth = 1; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    [-0.5, 0, 0.5, 1].forEach(function (v) { text(ctx, fmt(v, 1), x0 + (v - lo) / (hi - lo) * (x1 - x0), y1 + 5, col.muted, { w: '400', size: 10, mono: true, align: 'center' }); });
    var tx = x0 + (S.find.t - lo) / (hi - lo) * (x1 - x0);
    line(ctx, [[tx, y0 - 2], [tx, y1]], col.accent, 2.5); text(ctx, 'threshold ' + fmt(S.find.t, 2), tx + 5, y0 + 2, col.accent, { size: 11, mono: true });
    text(ctx, 'felt', x0 + (-0.22 - lo) / (hi - lo) * (x1 - x0), y0 + 4, col.muted, { w: '500', size: 11, align: 'center' });
    text(ctx, 'red things', x0 + (0.62 - lo) / (hi - lo) * (x1 - x0), y0 + 4, col.muted, { w: '500', size: 11, align: 'center' });
    tab.hit[slot] = { down: function (q, p) { return function (q2, p2) { S.find.t = clamp(lo + (p2.x - x0) / (x1 - x0) * (hi - lo), -0.3, 0.9); S.memo = {}; if (tab.syncFind) tab.syncFind(); }; }, cursor: function () { return 'ew-resize'; } };
  };
  V['blob-list'] = function (c, S) {
    if (!S.frame) return;
    var B = blobsOf(S), ctx = c.ctx, x = 14, y = 10;
    text(ctx, 'Blobs: joined-up red pixels', x, y, col.text, { size: 12 });
    var cols = [['', 0], ['area (px)', 30], ['roundness', 120], ['centre (px)', 220], ['', 340]];
    cols.forEach(function (q) { text(ctx, q[0], x + q[1], y + 22, col.muted, { w: '500', size: 11 }); });
    B.blobs.slice().sort(function (a, b) { return b.area - a.area; }).slice(0, 5).forEach(function (b, i) {
      var yy = y + 42 + i * 19, isB = b === B.ball, cc = isB ? col.viz1 : col.text;
      text(ctx, String(i + 1), x, yy, col.muted, { size: 12, mono: true });
      text(ctx, String(b.area), x + 30, yy, cc, { size: 12, mono: true });
      text(ctx, fmt(b.round, 2) + (b.round < S.find.round ? ' (too thin)' : ''), x + 120, yy, b.round < S.find.round ? col.muted : cc, { size: 12, mono: true, w: '500' });
      text(ctx, fmt(b.cx, 1) + ', ' + fmt(b.cy, 1), x + 220, yy, cc, { size: 12, mono: true });
      if (isB) text(ctx, '← the ball', x + 340, yy, col.viz1, { size: 12 });
    });
    if (!B.blobs.length) text(ctx, 'None: lower the threshold.', x, y + 42, col.muted, { w: '400', size: 12 });
    if (S.source === 'table' && B.ball) { var t = truthPx(S), e = Math.hypot(B.ball.cx - t.u, B.ball.cy - t.v); text(ctx, 'Off the true centre by ' + fmt(e, 1) + ' px', x, c.H - 20, e < 2 ? col.viz1 : col.bad, { size: 12 }); }
  };
  // Homography: drag the table's corners on the camera image; the table comes out flat and to scale.
  function warpH(S) {
    var cs = S.corners;
    if (S.warpMode === 'affine') { cs = cs.slice(); cs[3] = [cs[0][0] + cs[2][0] - cs[1][0], cs[0][1] + cs[2][1] - cs[1][1]]; }
    return { H: C.homography(C.TABLE_CORNERS, cs), cs: cs };
  }
  V['warp-src'] = function (c, S, tab, slot) {
    if (!S.frame) return waiting(c, S);
    var im = shown(S), box = place(im.w, im.h, 8, 8, c.W - 16, c.H - 16), ctx = c.ctx, wh = warpH(S);
    blit(ctx, im, box, 'rgb');
    var poly = wh.cs.concat([wh.cs[0]]).map(function (p) { return [box.px(p[0]), box.py(p[1])]; });
    line(ctx, poly, '#fff', 3); line(ctx, poly, col.accent, 1.5);
    ['near left', 'near right', 'far right', 'far left'].forEach(function (nm, i) {
      var p = wh.cs[i], fixed = S.warpMode === 'affine' && i === 3;
      ctx.fillStyle = fixed ? col.muted : col.accent; ctx.beginPath(); ctx.arc(box.px(p[0]), box.py(p[1]), 7, 0, 7); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
      label(ctx, nm + (fixed ? ' (follows)' : ''), box.px(p[0]) + 12, box.py(p[1]) - 18);
    });
    label(ctx, 'Drag the dots onto the table\'s corners', box.x + 6, box.y + 6);
    tab.hit[slot] = { box: box, down: function (q) {
      var best = -1, bd = 14 / box.s;
      S.corners.forEach(function (p, i) { if (S.warpMode === 'affine' && i === 3) return; var d = Math.hypot(p[0] - q.x, p[1] - q.y); if (d < bd) { bd = d; best = i; } });
      if (best < 0) return null;
      return function (q2) { S.corners[best] = [clamp(q2.x, 0, im.w), clamp(q2.y, 0, im.h)]; S.memo = {}; };
    }, cursor: function (q) { return S.corners.some(function (p) { return Math.hypot(p[0] - q.x, p[1] - q.y) < 14 / box.s; }) ? 'grab' : ''; } };
  };
  V['warp-dst'] = function (c, S) {
    if (!S.frame) return;
    var wh = warpH(S), ctx = c.ctx;
    if (!wh.H) { text(ctx, 'Those four corners do not make a shape.', 14, 14, col.bad); return; }
    var top = S.get('top', function () { var Sc = [[2, 0, 0], [0, -2, 100], [0, 0, 1]]; return C.warp(shown(S), C.mul3(wh.H, C.inv3(Sc)), 200, 100); });
    var box = place(200, 100, 8, 26, c.W - 16, c.H - 34);
    text(ctx, 'The table from above, 100 × 50 cm, with the true 10 cm grid', 10, 6, col.text, { size: 12 });
    blit(ctx, top, box, 'rgb');
    for (var g = 0; g <= 100; g += 10) line(ctx, [[box.x + g / 100 * box.w, box.y], [box.x + g / 100 * box.w, box.y + box.h]], withAlpha('#ffffff', 0.35), 1);
    for (g = 0; g <= 50; g += 10) line(ctx, [[box.x, box.y + box.h - g / 50 * box.h], [box.x + box.w, box.y + box.h - g / 50 * box.h]], withAlpha('#ffffff', 0.35), 1);
    var d = C.detectBall(shown(S), 0.3, 0.5);
    if (d) {
      var Hi = C.inv3(wh.H), p = C.applyH(Hi, d.u, d.v), bx = box.x + p[0] / 100 * box.w, by = box.y + box.h - (p[1] - C.BALL_R * 0.35) / 50 * box.h;
      cross(ctx, bx, by, 7, col.viz1, 2);
      text(ctx, '(' + fmt(p[0], 1) + ', ' + fmt(p[1] - C.BALL_R * 0.35, 1) + ') cm', bx + 9, by - 18, col.viz1, { size: 11, mono: true });
      S.warpBall = [p[0], p[1] - C.BALL_R * 0.35];
    }
    ring(ctx, box.x + S.scene.x / 100 * box.w, box.y + box.h - S.scene.y / 50 * box.h, 6, withAlpha('#ffffff', 0.8), 1);
  };
  V['warp-mat'] = function (c, S) {
    var wh = warpH(S), ctx = c.ctx; if (!wh.H) return;
    var Hi = C.inv3(wh.H), n = Hi[2][2], M = Hi.map(function (r) { return r.map(function (v) { return v / n; }); });
    text(ctx, 'H⁻¹: camera pixels → table cm', 14, 10, col.text, { size: 12 });
    var x0 = 24, y0 = 36, cw = 82;
    ctx.strokeStyle = col.muted; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x0 - 4, y0 - 4); ctx.lineTo(x0 - 10, y0 - 4); ctx.lineTo(x0 - 10, y0 + 66); ctx.lineTo(x0 - 4, y0 + 66); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x0 + 3 * cw - 6, y0 - 4); ctx.lineTo(x0 + 3 * cw, y0 - 4); ctx.lineTo(x0 + 3 * cw, y0 + 66); ctx.lineTo(x0 + 3 * cw - 6, y0 + 66); ctx.stroke();
    M.forEach(function (r, i) { r.forEach(function (v, j) { text(ctx, Math.abs(v) < 0.01 && v !== 0 ? v.toExponential(1) : fmt(v, 3), x0 + j * cw + cw - 14, y0 + i * 22, i === 2 && S.warpMode === 'affine' && j < 2 ? col.muted : col.text, { size: 12, mono: true, align: 'right', w: '500' }); }); });
    var tx = x0 + 3 * cw + 24;
    text(ctx, S.warpMode === 'affine' ? 'Affine: the bottom row is 0 0 1, so parallel lines stay parallel and the far side can\'t shrink.' : 'The bottom row divides by distance: far things get pulled in, which undoes the perspective.', tx, y0, col.muted, { w: '400', size: 11 });
    if (S.warpBall) {
      var e = Math.hypot(S.warpBall[0] - S.scene.x, S.warpBall[1] - S.scene.y);
      text(ctx, 'Ball read off the flat view is ' + fmt(e, 1) + ' cm from where it really is', tx, y0 + 40, e < 2 ? col.viz1 : col.bad, { size: 12 });
    }
  };
  // Match features between a photo and a second view of it (the same photo turned, scaled and tilted, so the true map is known).
  function matchRun(S) {
    return S.get('match', function () {
      var g = grayOf(S), M = S.m, Ht = C.affine({ rot: M.rot, scale: M.scale, cx: g.w / 2, cy: g.h / 2, tx: 4, ty: -3 }); Ht[2][0] = M.tilt * 0.0012; Ht[2][1] = M.tilt * 0.0004;
      var g2 = C.warp(g, C.inv3(Ht), g.w, g.h); for (var i = 0; i < g2.d.length; i++) if (isNaN(g2.d[i])) g2.d[i] = 0.5;
      var G = C.gaussianKernel(1), A = C.describe(C.convolveSep(g, G.k1), C.harris(g, { rel: 0.01, max: 150 }).corners, M.orient), B = C.describe(C.convolveSep(g2, G.k1), C.harris(g2, { rel: 0.01, max: 150 }).corners, M.orient);
      var ms = C.matchFeatures(A, B, M.ratio), pa = ms.map(function (m) { return [A[m.a].x, A[m.a].y]; }), pb = ms.map(function (m) { return [B[m.b].x, B[m.b].y]; });
      var truth = ms.map(function (m, k) { var q = C.applyH(Ht, pa[k][0], pa[k][1]); return Math.hypot(q[0] - pb[k][0], q[1] - pb[k][1]) < 3; });
      var rs = M.ransac ? C.ransac(pa, pb, 300, 2.5, rand) : null, err = Infinity;
      if (rs && rs.H) { err = 0; [[20, 20], [g.w - 20, 20], [g.w / 2, g.h / 2], [20, g.h - 20], [g.w - 20, g.h - 20]].forEach(function (p) { var a = C.applyH(rs.H, p[0], p[1]), b = C.applyH(Ht, p[0], p[1]); err = Math.max(err, Math.hypot(a[0] - b[0], a[1] - b[1])); }); }
      return { g: g, g2: g2, A: A, B: B, ms: ms, truth: truth, rs: rs, err: err, Ht: Ht };
    });
  }
  V['match-pair'] = function (c, S, tab, slot) {
    if (!S.frame) return waiting(c, S);
    var R = matchRun(S), ctx = c.ctx, w = (c.W - 24) / 2, b1 = place(R.g.w, R.g.h, 8, 22, w, c.H - 30), b2 = place(R.g.w, R.g.h, 16 + w, 22, w, c.H - 30);
    blit(ctx, R.g, b1, 'gray'); blit(ctx, R.g2, b2, 'gray');
    text(ctx, 'The photo', b1.x, 4, col.text, { size: 12 }); text(ctx, 'A second view: turned ' + S.m.rot + '°, tilted', b2.x, 4, col.text, { size: 12 });
    R.A.forEach(function (f) { ring(ctx, b1.px(f.x), b1.py(f.y), 3, withAlpha(col.viz2, 0.8), 1); });
    R.B.forEach(function (f) { ring(ctx, b2.px(f.x), b2.py(f.y), 3, withAlpha(col.viz2, 0.8), 1); });
    R.ms.forEach(function (m, k) {
      var a = R.A[m.a], b = R.B[m.b], ok = R.rs ? R.rs.inliers[k] : null;
      var cc = ok === null ? withAlpha(col.accent, 0.8) : ok ? withAlpha(col.viz1, 0.9) : withAlpha(col.bad, 0.7);
      line(ctx, [[b1.px(a.x), b1.py(a.y)], [b2.px(b.x), b2.py(b.y)]], cc, k === S.m.sel ? 3 : 1.2);
    });
    tab.hit[slot] = { box: b1, down: function (q) {
      var best = -1, bd = 12 / b1.s; R.ms.forEach(function (m, k) { var a = R.A[m.a], d = Math.hypot(a.x - q.x, a.y - q.y); if (d < bd) { bd = d; best = k; } });
      S.m.sel = best; return null;
    }, cursor: function () { return 'pointer'; } };
  };
  function patchCanvas(ctx, f, x, y, s, title, sub, colr) {
    var mx = 0; for (var i = 0; i < 64; i++) mx = Math.max(mx, Math.abs(f.v[i]));
    for (var j = 0; j < 8; j++) for (var k = 0; k < 8; k++) { var t = 0.5 + 0.5 * f.v[j * 8 + k] / (mx || 1), g = Math.round(t * 255); ctx.fillStyle = 'rgb(' + g + ',' + g + ',' + g + ')'; ctx.fillRect(x + k * s, y + j * s, s, s); }
    ctx.strokeStyle = colr || col.border; ctx.lineWidth = 2; ctx.strokeRect(x - 1, y - 1, 8 * s + 2, 8 * s + 2);
    text(ctx, title, x, y + 8 * s + 6, col.text, { size: 11 }); if (sub) text(ctx, sub, x, y + 8 * s + 21, col.muted, { w: '400', size: 11, mono: true });
  }
  V['match-desc'] = function (c, S) {
    if (!S.frame) return;
    var R = matchRun(S), ctx = c.ctx;
    if (!R.ms.length) { text(ctx, 'No matches pass the ratio test.', 14, 14, col.muted); return; }
    if (S.m.sel < 0 || S.m.sel >= R.ms.length) S.m.sel = 0;
    var m = R.ms[S.m.sel], a = R.A[m.a], b = R.B[m.b], s = Math.max(5, Math.min(12, (c.H - 70) / 8)), d2 = Infinity;
    R.B.forEach(function (f, i) { if (i === m.b) return; var d = 0; for (var k = 0; k < 64; k++) { var e = a.v[k] - f.v[k]; d += e * e; } d2 = Math.min(d2, d); });
    text(ctx, 'Match ' + (S.m.sel + 1) + ' of ' + R.ms.length + ' (click a line\'s left end to pick another)', 14, 6, col.text, { size: 12 });
    patchCanvas(ctx, a, 14, 28, s, 'Its descriptor', null);
    patchCanvas(ctx, b, 34 + 8 * s, 28, s, 'Nearest in view 2', 'distance ' + fmt(Math.sqrt(m.d), 2), R.truth[S.m.sel] ? col.viz1 : col.bad);
    var tx = 60 + 16 * s;
    text(ctx, 'Second nearest: ' + fmt(Math.sqrt(d2), 2), tx, 30, col.muted, { w: '400', size: 12 });
    text(ctx, 'Ratio ' + fmt(Math.sqrt(m.d / d2), 2) + ' (kept below ' + fmt(S.m.ratio, 2) + ')', tx, 50, col.text, { size: 12 });
    text(ctx, R.truth[S.m.sel] ? 'Right: the same spot in both views.' : 'Wrong: it looks alike, but it is somewhere else.', tx, 76, R.truth[S.m.sel] ? col.viz1 : col.bad, { size: 12 });
    if (S.m.orient) text(ctx, 'Turned by ' + fmt(a.th * 180 / Math.PI, 0) + '° and ' + fmt(b.th * 180 / Math.PI, 0) + '° before sampling', tx, 98, col.muted, { w: '400', size: 11 });
  };
  V['match-stats'] = function (c, S) {
    if (!S.frame) return;
    var R = matchRun(S), ctx = c.ctx, good = R.truth.filter(Boolean).length, rows = [
      ['corners described', Math.min(R.A.length, R.B.length), col.muted], ['matches kept', R.ms.length, col.accent], ['really right', good, col.viz1],
      ['RANSAC inliers', R.rs ? R.rs.count : 0, col.viz2]];
    var mx = Math.max(10, R.A.length, R.B.length), x0 = 140, x1 = c.W - 200, y = 12;
    rows.forEach(function (r, i) {
      text(ctx, r[0], 14, y + i * 24, col.muted, { w: '500', size: 12 });
      ctx.fillStyle = withAlpha(r[2], 0.8); ctx.fillRect(x0, y + i * 24 + 1, r[1] / mx * (x1 - x0), 13);
      text(ctx, String(r[1]), x0 + r[1] / mx * (x1 - x0) + 6, y + i * 24, col.text, { size: 12, mono: true });
    });
    var tx = x1 + 30;
    text(ctx, 'Map found by RANSAC', tx, 12, col.text, { size: 12 });
    text(ctx, !S.m.ransac ? 'off' : !R.rs || !R.rs.H ? 'none' : 'off by ' + fmt(R.err, 1) + ' px', tx, 32, !S.m.ransac ? col.muted : R.err < 3 ? col.viz1 : col.bad, { size: 16, mono: true });
    text(ctx, 'worst of five test points', tx, 56, col.muted, { w: '400', size: 11 });
  };
  // Two cameras. The left image, the right image (or the depth map), the matching cost along the row, and the room from above.
  function stereoRun(S) {
    var st = S.st;
    if (!st.L || st.dirty) {
      st.Lc = C.renderStereo({ B: st.B, ballX: st.x, ballZ: st.z }, -1); st.Rc = C.renderStereo({ B: st.B, ballX: st.x, ballZ: st.z }, 1);
      st.L = C.gray(st.Lc); st.R = C.gray(st.Rc); st.dirty = false; st.map = null;
    }
    if (st.follow) { var p = C.stereoProject(st.B, -1, st.x, C.ST.R, st.z); st.u = Math.round(p[0]); st.v = Math.round(p[1]); }
    var cost = S.get('cost' + st.u + ',' + st.v + ',' + st.n, function () { return C.stereoCost(st.L, st.R, clamp(st.u, 0, 191), clamp(st.v, 0, 143), st.n, 64); });
    return { cost: cost, d: C.subpixel(cost) };
  }
  V['stereo-pair'] = function (c, S, tab, slot) {
    var st = S.st, R = stereoRun(S), ctx = c.ctx, w = (c.W - 24) / 2, b1 = place(192, 144, 8, 22, w, c.H - 30), b2 = place(192, 144, 16 + w, 22, w, c.H - 30);
    blit(ctx, st.Lc, b1, 'rgb');
    if (st.show === 'depth') {
      if (!st.map) st.map = C.disparityMap(st.L, st.R, st.n, 64, 3);
      blit(ctx, st.map, b2, 'heat', { scale: 64 });
      text(ctx, 'Disparity for every pixel (bright = near)', b2.x, 4, col.text, { size: 12 });
    } else {
      blit(ctx, st.Rc, b2, 'rgb'); text(ctx, 'Right camera', b2.x, 4, col.text, { size: 12 });
    }
    text(ctx, 'Left camera (click to pick a pixel)', b1.x, 4, col.text, { size: 12 });
    var yy = st.v + 0.5;
    [b1, b2].forEach(function (b) { line(ctx, [[b.x, b.py(yy)], [b.x + b.w, b.py(yy)]], withAlpha(col.accent, 0.8), 1, [4, 3]); });
    var hw = (st.n / 2) * b1.s;
    ctx.strokeStyle = col.accent; ctx.lineWidth = 2; ctx.strokeRect(b1.px(st.u + 0.5) - hw, b1.py(yy) - hw, 2 * hw, 2 * hw);
    if (st.show !== 'depth') {
      ctx.strokeStyle = col.viz1; ctx.strokeRect(b2.px(st.u + 0.5 - R.d) - hw, b2.py(yy) - hw, 2 * hw, 2 * hw);
      ctx.strokeStyle = withAlpha(col.accent, 0.5); ctx.setLineDash([3, 3]); ctx.strokeRect(b2.px(st.u + 0.5) - hw, b2.py(yy) - hw, 2 * hw, 2 * hw); ctx.setLineDash([]);
    }
    tab.hit[slot] = { box: b1, down: function (q) {
      if (q.x < 0 || q.x > 192 || q.y < 0 || q.y > 144) return null;
      return function (q2) { st.follow = false; st.u = clamp(Math.floor(q2.x), 0, 191); st.v = clamp(Math.floor(q2.y), 0, 143); };
    }, cursor: function (q) { return q.x >= 0 && q.x <= 192 ? 'crosshair' : ''; } };
  };
  V['stereo-cost'] = function (c, S) {
    var st = S.st, R = stereoRun(S), cost = R.cost.map(function (v) { return isFinite(v) ? v * 255 : NaN; });
    var p = C.stereoProject(st.B, -1, st.x, C.ST.R, st.z), q = C.stereoProject(st.B, 1, st.x, C.ST.R, st.z), dTrue = p[0] - q[0];
    var P = series(c, [{ v: cost, c: col.accent, name: 'difference between the windows', lw: 2 }], [0, Math.max(10, Math.max.apply(null, cost.filter(isFinite)) * 1.1)], 'Slide the window along the row in the right image: d = 0 … 64 px', 'disparity d (px)');
    var X = function (d) { return P.x0 + d / 64 * (P.x1 - P.x0); };
    line(c.ctx, [[X(R.d), P.y0], [X(R.d), P.y1]], col.viz1, 2);
    text(c.ctx, 'best d = ' + fmt(R.d, 1) + ' px', X(R.d) + 5, P.y0 + 4, col.viz1, { size: 11, mono: true });
    if (st.follow) { line(c.ctx, [[X(dTrue), P.y0], [X(dTrue), P.y1]], col.muted, 1, [4, 3]); text(c.ctx, 'true ' + fmt(dTrue, 1), X(dTrue) + 5, P.y1 - 16, col.muted, { w: '400', size: 11, mono: true }); }
  };
  V['stereo-top'] = function (c, S, tab, slot) {
    var st = S.st, R = stereoRun(S), ctx = c.ctx, x0 = 30, x1 = c.W - 150, y0 = 14, y1 = c.H - 22, Zmax = 230, Xr = 60;
    var sx = (x1 - x0) / Zmax, sy = (y1 - y0) / (2 * Xr), s = Math.min(sx, sy * 1.6);
    function P(X, Z) { return [x0 + Z * s, (y0 + y1) / 2 + X * Math.min(sy, s)]; }
    ctx.fillStyle = withAlpha(col.viz1, 0.07); var a = P(-60, 10), b = P(60, 225); ctx.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
    text(ctx, 'From above: the table, the two cameras and the ball (drag it)', x0, 0, col.text, { size: 12 });
    for (var z = 50; z <= 200; z += 50) { var pz = P(-60, z); text(ctx, z + ' cm', pz[0], y1 + 5, col.muted, { w: '400', size: 10, mono: true, align: 'center' }); line(ctx, [P(-60, z), P(60, z)], col.border, 1, [2, 4]); }
    var camL = P(-st.B / 2, 0), camR = P(st.B / 2, 0);
    var tri = R.d > 0.2 ? C.triangulate(st.B, st.u + 0.5, st.v + 0.5, R.d) : null;
    if (tri) {
      var near = C.triangulate(st.B, st.u + 0.5, st.v + 0.5, R.d + 0.5), far = R.d > 0.6 ? C.triangulate(st.B, st.u + 0.5, st.v + 0.5, R.d - 0.5) : { x: tri.x * 5, z: Zmax * 1.5 };
      ctx.fillStyle = withAlpha(col.accent, 0.18); ctx.beginPath(); [camL, P(near.x, near.z), P(far.x, far.z)].forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }); ctx.fill();
      ctx.beginPath(); [camR, P(near.x, near.z), P(far.x, far.z)].forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }); ctx.fill();
      line(ctx, [camL, P(tri.x, tri.z)], col.accent, 1.5); line(ctx, [camR, P(tri.x, tri.z)], col.accent, 1.5);
      cross(ctx, P(tri.x, tri.z)[0], P(tri.x, tri.z)[1], 6, col.accent, 2);
    }
    var bp = P(st.x, st.z); ctx.fillStyle = '#d8332a'; ctx.beginPath(); ctx.arc(bp[0], bp[1], Math.max(3, C.ST.R * s), 0, 7); ctx.fill();
    [camL, camR].forEach(function (p) { ctx.fillStyle = col.text; ctx.fillRect(p[0] - 5, p[1] - 4, 10, 8); });
    var tx = x1 + 16;
    text(ctx, 'disparity', tx, 16, col.muted, { w: '400', size: 11 }); text(ctx, fmt(R.d, 1) + ' px', tx, 30, col.text, { size: 13, mono: true });
    text(ctx, 'depth f·B/d', tx, 52, col.muted, { w: '400', size: 11 }); text(ctx, tri ? fmt(tri.depth, 0) + ' cm' : '∞', tx, 66, col.accent, { size: 13, mono: true });
    if (tri) { var nr = C.triangulate(st.B, st.u + 0.5, st.v + 0.5, R.d + 0.5).depth, fr = R.d > 0.6 ? C.triangulate(st.B, st.u + 0.5, st.v + 0.5, R.d - 0.5).depth : Infinity; text(ctx, '±½ px: ' + fmt(nr, 0) + ' to ' + (isFinite(fr) ? fmt(fr, 0) : '∞') + ' cm', tx, 88, col.muted, { w: '400', size: 11, mono: true }); }
    if (st.follow) { var pc = C.stereoProject(st.B, -1, st.x, C.ST.R, st.z); text(ctx, 'true depth ' + fmt(pc[2], 0) + ' cm', tx, 108, col.muted, { w: '400', size: 11, mono: true }); }
    tab.hit[slot] = { down: function (q, p) {
      if (Math.hypot(p.x - bp[0], p.y - bp[1]) > 22) return null;
      return function (q2, p2) { st.x = clamp((p2.y - (y0 + y1) / 2) / Math.min(sy, s), -45, 45); st.z = clamp((p2.x - x0) / s, 35, 215); st.follow = true; st.dirty = true; S.memo = {}; };
    }, cursor: function (q, p) { return Math.hypot(p.x - bp[0], p.y - bp[1]) < 22 ? 'grab' : ''; } };
  };
  // Learn a filter: the input, what the filter should make of it, and what it makes now.
  V['learn-out'] = function (c, S, tab) {
    if (!S.frame) return waiting(c, S);
    var Lr = tab.learner, g = tab.learnIn, tgt = tab.learnTgt; if (!g) return;
    var out = Lr.output(g), w = (c.W - 32) / 3, sc = S.target === 'blur' || S.target === 'sharpen' ? 'gray' : 'signed', ctx = c.ctx;
    [[g, 'Input', 'gray'], [tgt, 'Target: the ' + { sobelx: 'Sobel x', sobely: 'Sobel y', blur: 'blur', sharpen: 'sharpen' }[S.target] + ' output', sc], [out, 'What the learned filter makes', sc]].forEach(function (q, i) {
      var b = place(g.w, g.h, 8 + i * (w + 8), 22, w, c.H - 30); blit(ctx, q[0], b, q[2], { scale: 1.2 }); text(ctx, q[1], b.x, 4, col.text, { size: 12 });
    });
  };
  V.loss = function (c, S, tab) {
    var L = tab.kind === 'net' ? tab.net.loss : tab.learner.loss;
    if (!L.length) { text(c.ctx, 'Press Train.', c.W / 2, c.H / 2 - 7, col.muted, { w: '500', size: 13, align: 'center' }); return; }
    var lg = L.map(function (v) { return Math.log10(Math.max(1e-6, v)); });
    var P = series(c, [{ v: lg, c: col.accent, lw: 1.6 }], [Math.min.apply(null, lg) - 0.2, Math.max.apply(null, lg) + 0.2], tab.kind === 'net' ? 'Loss per training frame (log₁₀), ' + L.length + ' frames' : 'Mean squared error (log₁₀) over ' + L.length + ' steps', 'training step');
  };
  // The small network: its "ball here" map on the live frame, beside the threshold's pick.
  V['net-heat'] = function (c, S, tab, slot) {
    if (!S.frame) return waiting(c, S);
    var N = tab.net, im = S.frame, box = place(im.w, im.h, 8, 8, c.W - 16, c.H - 16), ctx = c.ctx;
    var res = S.get('net', function () { var inp = C.netInput(im), fw = C.netForward(N.net, inp.x, inp.h, inp.w); return { inp: inp, fw: fw, pk: C.netPeak(fw.p, inp.w, inp.h), thr: C.detectBall(im, 0.3, 0) }; });
    blit(ctx, im, box, 'rgb');
    var hm = C.image(res.inp.w, res.inp.h, 1); for (var i = 0; i < hm.d.length; i++) hm.d[i] = res.fw.p[i] > 0.08 ? res.fw.p[i] : NaN;
    ctx.globalAlpha = 0.75; blit(ctx, hm, box, 'heat', { scale: 1 }); ctx.globalAlpha = 1;
    var t = truthPx(S); ring(ctx, box.px(t.u), box.py(t.v), t.r * box.s + 5, withAlpha('#ffffff', 0.7), 1);
    if (res.thr) { ctx.strokeStyle = '#7fb2ff'; ctx.lineWidth = 2; ctx.strokeRect(box.px(res.thr.u) - 9, box.py(res.thr.v) - 9, 18, 18); }
    if (res.pk.p > 0.3) cross(ctx, box.px(res.pk.u), box.py(res.pk.v), 9, col.viz1, 2.5);
    label(ctx, 'network ' + (res.pk.p > 0.3 ? '+' : 'unsure (peak ' + fmt(res.pk.p, 2) + ')') + '   threshold □' + (res.thr ? '' : ' found nothing'), box.x + 6, box.y + 6);
    S.netHit = res.pk.p > 0.3 && Math.hypot(res.pk.u - t.u, res.pk.v - t.v) < 5; S.thrHit = !!res.thr && Math.hypot(res.thr.u - t.u, res.thr.v - t.v) < 5;
  };
  V['net-maps'] = function (c, S, tab) {
    if (!S.frame) return;
    var N = tab.net.net, res = S.memo.net, ctx = c.ctx, M = N.M, K = N.K, w = (c.W - 20) / M, ts = Math.min(w - 10, (c.H - 50) / 2);
    text(ctx, 'Layer 1: its ' + M + ' learned 5 × 5 filters (top) and what each makes of this frame (bottom)', 10, 4, col.text, { size: 12 });
    for (var o = 0; o < M; o++) {
      var x = 10 + o * w, mx = 0, k;
      for (k = 0; k < 3 * K * K; k++) mx = Math.max(mx, Math.abs(N.w1[o * 3 * K * K + k]));
      var cell = ts / K;
      for (var j = 0; j < K; j++) for (var i = 0; i < K; i++) {
        var rgb = [0, 1, 2].map(function (ch) { return Math.round(clamp(0.5 + 0.5 * N.w1[((o * 3 + ch) * K + j) * K + i] / (mx || 1), 0, 1) * 255); });
        ctx.fillStyle = 'rgb(' + rgb.join(',') + ')'; ctx.fillRect(x + i * cell, 24 + j * cell, cell, cell);
      }
      if (res) {
        var fm = C.image(res.inp.w, res.inp.h, 1), base = o * fm.d.length, fmx = 0;
        for (k = 0; k < fm.d.length; k++) { fm.d[k] = res.fw.a1[base + k]; fmx = Math.max(fmx, fm.d[k]); }
        var b = place(fm.w, fm.h, x, 30 + ts, w - 10, c.H - 36 - ts); blit(ctx, fm, b, 'heat', { scale: fmx || 1 });
      }
    }
  };
  // Tracking: the detector's noisy fixes, the Kalman filter's estimate and its uncertainty, through a card that hides the ball.
  V.track = function (c, S, tab, slot) {
    if (!S.frame) return waiting(c, S);
    var T = tab.trk, im = S.frame, box = place(im.w, im.h, 8, 8, c.W - 16, c.H - 16), ctx = c.ctx;
    blit(ctx, im, box, 'rgb');
    function px(x, y) { var p = C.toPixel(x, y); return [box.px(p[0]), box.py(p[1])]; }
    line(ctx, T.est.slice(-60).map(function (e) { return e ? px(e[0], e[1]) : null; }), withAlpha(col.accent, 0.8), 2);
    T.meas.slice(-30).forEach(function (m) { if (m) { var p = px(m[0], m[1]); ctx.fillStyle = withAlpha('#ffffff', 0.85); ctx.beginPath(); ctx.arc(p[0], p[1], 2.2, 0, 7); ctx.fill(); } });
    if (T.kf.x && T.on) {
      var e = C.ellipse(T.kf.P, 2), ce = px(T.kf.x[0], T.kf.x[1]), pts = [];
      for (var a = 0; a <= 40; a++) { var th = a / 40 * 2 * Math.PI, ex = e.rx * Math.cos(th), ey = e.ry * Math.sin(th); pts.push(px(T.kf.x[0] + ex * Math.cos(e.ang) - ey * Math.sin(e.ang), T.kf.x[1] + ex * Math.sin(e.ang) + ey * Math.cos(e.ang))); }
      line(ctx, pts, col.accent, 2); cross(ctx, ce[0], ce[1], 6, col.accent, 2);
    }
    if (S.card) {
      var cc = [px(S.card.x, S.card.y), px(S.card.x + S.card.w, S.card.y), px(S.card.x + S.card.w, S.card.y + S.card.h), px(S.card.x, S.card.y + S.card.h)];
      line(ctx, cc.concat([cc[0]]), col.muted, 1.5, [4, 3]);
      label(ctx, 'drag the card', cc[0][0], cc[0][1] + 6);
    }
    label(ctx, T.lastZ ? 'dots: the detector  ·  ring: the filter (2σ)' : 'Ball hidden: the filter predicts', box.x + 6, box.y + 6);
    tab.hit[slot] = { box: box, down: function (q) {
      if (!S.card) return null; var w = C.toTable(q.x, q.y);
      if (w[0] < S.card.x - 3 || w[0] > S.card.x + S.card.w + 3 || w[1] < S.card.y - 3 || w[1] > S.card.y + S.card.h + 3) return null;
      var dx = w[0] - S.card.x;
      return function (q2) { var w2 = C.toTable(q2.x, q2.y); S.card.x = clamp(w2[0] - dx, -5, 100 - S.card.w + 5); };
    }, cursor: function (q) { if (!S.card) return ''; var w = C.toTable(q.x, q.y); return w[0] > S.card.x && w[0] < S.card.x + S.card.w && w[1] > S.card.y && w[1] < S.card.y + S.card.h ? 'ew-resize' : ''; } };
  };
  V['track-x'] = function (c, S, tab) {
    var T = tab.trk, lanes = [];
    if (T.truth.length) lanes.push({ v: T.truth.map(function (p) { return p[0]; }), c: col.muted, name: 'true', lw: 1.2, dash: [4, 3] });
    lanes.push({ v: T.meas.map(function (p) { return p ? p[0] : NaN; }), c: col.viz3 || col.viz2, name: S.source === 'camera' ? 'the colour blob' : 'the detector', lw: 1 });
    lanes.push({ v: T.est.map(function (p) { return p ? p[0] : NaN; }), c: col.accent, name: T.on ? 'the filter' : 'last fix held', lw: 2 });
    series(c, lanes, S.source === 'camera' ? [0, 192] : [0, 100], S.source === 'camera' ? 'Across the picture (px), last 8 s' : 'Across the table (cm), last 8 s', 'time');
  };
  V['track-err'] = function (c, S, tab) {
    var T = tab.trk, em = [], ee = [];
    T.truth.forEach(function (t, i) { var m = T.meas[i], e = T.est[i]; em.push(m ? Math.hypot(m[0] - t[0], m[1] - t[1]) : NaN); ee.push(e ? Math.hypot(e[0] - t[0], e[1] - t[1]) : NaN); });
    var rm = rms(em), re = rms(ee);
    series(c, [{ v: em, c: col.viz3 || col.viz2, name: 'detector, RMS ' + fmt(rm, 1) + ' cm', lw: 1 }, { v: ee, c: col.accent, name: (T.on ? 'filter' : 'held') + ', RMS ' + fmt(re, 1) + ' cm', lw: 2 }], [0, 12], 'How far off each one is (cm)', 'time');
    T.rms = [rm, re];
  };
  function rms(a) { var s = 0, n = 0; a.forEach(function (v) { if (isFinite(v)) { s += v * v; n++; } }); return n ? Math.sqrt(s / n) : NaN; }
  // Your camera: the filters live, and a colour tracker.
  function camLayer(S) {
    var f = S.camf;
    if (f === 'blur') return [blurred(S), 'rgb'];
    if (f === 'edges') return S.edge.show === 'dir' ? edgeLayer(S) : [edgesOf(S).mag, 'gray'];
    if (f === 'corners') { var hz = harrisOf(S); return [S.get('Rpos', function () { var R = C.image(S.frame.w, S.frame.h, 1); for (var i = 0; i < R.d.length; i++) R.d[i] = Math.max(0, hz.R.d[i]); return R; }), 'heat', { scale: hz.max * 0.05 }]; }
    return [S.frame, 'rgb'];
  }
  V['cam-filter'] = function (c, S, tab, slot) {
    if (!S.frame) return waiting(c, S);
    var box = place(S.frame.w, S.frame.h, 8, 8, c.W - 16, c.H - 16), ctx = c.ctx, f = S.camf, L = camLayer(S), whole = S.base === 'map';
    if (whole && f !== 'corners') blit(ctx, L[0], box, L[1], L[2]); else blit(ctx, S.frame, box, 'rgb');
    if (f === 'corners') harrisOf(S).corners.forEach(function (p) { ring(ctx, box.px(p.x), box.py(p.y), 4, col.viz2, 1.5); });
    drawProbe(ctx, box, probeOf(S), f !== 'corners');
    loupe(c, box, tab.hover[slot], whole && f !== 'corners' ? [S.frame, 'rgb'] : L, whole && f !== 'corners' ? 'the camera' : { raw: 'magnified', blur: 'blurred', edges: 'edges', corners: 'response R' }[f]);
    tab.hit[slot] = probeHit(S, box);
  };
  V['cam-track'] = function (c, S, tab, slot) {
    if (!S.frame) return waiting(c, S);
    var T = tab.trk, box = place(S.frame.w, S.frame.h, 8, 8, c.W - 16, c.H - 16), ctx = c.ctx;
    blit(ctx, S.frame, box, 'rgb');
    line(ctx, T.est.slice(-60).map(function (e) { return e ? [box.px(e[0]), box.py(e[1])] : null; }), col.accent, 2.5);
    if (T.lastBlob) { var b = T.lastBlob; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(box.px(b.x0), box.py(b.y0), (b.x1 - b.x0) * box.s, (b.y1 - b.y0) * box.s); }
    if (T.kf.x && T.on) { var p = [box.px(T.kf.x[0]), box.py(T.kf.x[1])], e = C.ellipse(T.kf.P, 2); ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(e.ang); ctx.strokeStyle = col.accent; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(0, 0, e.rx * box.s, e.ry * box.s, 0, 0, 7); ctx.stroke(); ctx.restore(); cross(ctx, p[0], p[1], 7, col.accent, 2); }
    var sw = S.pick; ctx.fillStyle = 'rgb(' + sw.map(function (v) { return Math.round(v * 255); }).join(',') + ')'; ctx.fillRect(box.x + 6, box.y + 6, 14, 14); ctx.strokeStyle = '#fff'; ctx.strokeRect(box.x + 6, box.y + 6, 14, 14);
    label(ctx, 'Click something coloured to track it', box.x + 26, box.y + 7);
    tab.hit[slot] = { box: box, down: function (q) {
      if (q.x < 0 || q.y < 0 || q.x >= S.frame.w || q.y >= S.frame.h) return null;
      var s = [0, 0, 0], n = 0;
      for (var j = -2; j <= 2; j++) for (var i = -2; i <= 2; i++) { var x = clamp(Math.floor(q.x) + i, 0, S.frame.w - 1), y = clamp(Math.floor(q.y) + j, 0, S.frame.h - 1), k = (y * S.frame.w + x) * 3; s[0] += S.frame.d[k]; s[1] += S.frame.d[k + 1]; s[2] += S.frame.d[k + 2]; n++; }
      S.pick = s.map(function (v) { return v / n; }); T.kf.x = null; return null;
    }, cursor: function () { return 'copy'; } };
  };
  V['cam-mask'] = function (c, S, tab) {
    if (!S.frame) return;
    var m = tab.trk.mask; if (!m) return;
    var im = C.image(S.frame.w, S.frame.h, 1); for (var i = 0; i < m.length; i++) im.d[i] = m[i];
    var box = place(im.w, im.h, 8, 26, c.W - 16, c.H - 34); text(c.ctx, 'Pixels close to the picked colour', 10, 6, col.text, { size: 12 }); blit(c.ctx, im, box, 'gray');
  };

  /* ================= controls ================= */
  function h3(panel, t) { panel.appendChild(el('h3', '', t)); }
  function hint(panel, t) { var p = el('p', 'panel-hint', t); panel.appendChild(p); return p; }
  var uid = 0;
  function slider(panel, label, min, max, step, value, fmtV, onInput) {
    var id = 'vs' + (uid++), g = el('div', 'pid-group'), lb = el('label'), val = el('span'); lb.setAttribute('for', id); lb.innerHTML = label + ' '; lb.appendChild(val);
    var inp = el('input'); inp.type = 'range'; inp.id = id; inp.min = min; inp.max = max; inp.step = step; inp.value = value;
    g.appendChild(lb); g.appendChild(inp); panel.appendChild(g);
    function show() { val.textContent = fmtV(parseFloat(inp.value)); }
    inp.addEventListener('input', function () { onInput(parseFloat(inp.value)); show(); }); show();
    return { input: inp, set: function (v) { inp.value = v; show(); } };
  }
  function toggle(panel, label, opts, current, onPick) {
    var box = el('div', 'mode-toggle'); box.setAttribute('role', 'group'); box.setAttribute('aria-label', label);
    var btns = opts.map(function (o) {
      var b = el('button', 'mode-btn' + (o[0] === current ? ' active' : ''), o[1]); b.type = 'button'; b.setAttribute('aria-pressed', o[0] === current ? 'true' : 'false');
      b.addEventListener('click', function () { btns.forEach(function (x) { var on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-pressed', on ? 'true' : 'false'); }); onPick(o[0]); });
      box.appendChild(b); return b;
    });
    panel.appendChild(box);
  }
  function button(panel, label, onClick) { var b = el('button', 'sim-btn', label); b.type = 'button'; b.addEventListener('click', function () { onClick(b); }); panel.appendChild(b); return b; }
  function telemetry(panel, rows) {
    var t = el('div', 'telemetry'), vals = {};
    rows.forEach(function (r) { t.appendChild(el('span', 't-key', r[1])); vals[r[0]] = el('span', 't-val', '-'); t.appendChild(vals[r[0]]); });
    panel.appendChild(t); return vals;
  }
  function setV(span, v, bad) { if (!span) return; if (span.textContent !== v) span.textContent = v; span.classList.toggle('lab-bad', !!bad); }
  function syncer(tab, f) { tab.sync.push(f); }

  var CTRL = {};
  CTRL.hint = function (p, S, tab) { if (tab.hint) hint(p, tab.hint); };
  CTRL.source = function (p, S) {
    h3(p, 'Picture');
    toggle(p, 'Picture', [['pencils', 'Pencils'], ['bicycle', 'Bike'], ['facade', 'Facade'], ['table', 'Table']], S.source === 'table' ? 'table' : S.photo, function (v) {
      if (v === 'table') S.source = 'table'; else { S.source = 'photo'; S.photo = v; }
      S.frame = null; S.probe = null; S.bump();
    });
  };
  CTRL.play = function (p, S) { var b = button(p, 'Pause the ball', function () { S.playing = !S.playing; b.textContent = S.playing ? 'Pause the ball' : 'Roll the ball'; }); };
  CTRL.pixels = function (p, S) {
    h3(p, 'Sampling');
    slider(p, 'Pixel size', 1, 16, 1, S.block, function (v) { return v + ' × ' + v; }, function (v) { S.block = v; S.bump(); });
    slider(p, 'Bits per colour', 1, 8, 1, S.bits, function (v) { return v + ' (' + Math.pow(2, v) + ' levels)'; }, function (v) { S.bits = v; S.bump(); });
    toggle(p, 'Numbers', [['rgb', 'Colour'], ['gray', 'Grey']], 'rgb', function (v) { S.zoomGray = v === 'gray'; });
  };
  CTRL.noise = function (p, S) { slider(p, 'Sensor noise σ', 0, 0.15, 0.005, S.noise, function (v) { return fmt(v * 255, 0) + ' / 255'; }, function (v) { S.noise = v; S.bump(); }); };
  CTRL.light = function (p, S) { slider(p, 'Lamp', 0.3, 1.3, 0.01, S.light, function (v) { return fmt(v * 100, 0) + '%'; }, function (v) { S.light = v; S.bump(); }); };
  CTRL.pencil = function (p, S) { toggle(p, 'Pencil', [[false, 'No pencil'], [true, 'Red pencil']], S.pencil, function (v) { S.pencil = v; S.bump(); }); };
  CTRL.blur = function (p, S) {
    h3(p, 'Kernel');
    toggle(p, 'Kernel', [['gauss', 'Gaussian'], ['box', 'Box']], S.blur.type, function (v) { S.blur.type = v; S.bump(); sync(); });
    var sg = slider(p, 'Width σ', 0.5, 4, 0.1, S.blur.sigma, function (v) { return fmt(v, 1) + ' px'; }, function (v) { S.blur.sigma = v; S.bump(); });
    var sz = slider(p, 'Size', 1, 15, 2, S.blur.size, function (v) { return v + ' × ' + v; }, function (v) { S.blur.size = v; S.bump(); });
    function sync() { sg.input.parentNode.style.display = S.blur.type === 'gauss' ? '' : 'none'; sz.input.parentNode.style.display = S.blur.type === 'box' ? '' : 'none'; }
    sync();
  };
  CTRL.edges = function (p, S) {
    h3(p, 'Edges');
    toggle(p, 'Show', [['gx', 'Gx'], ['gy', 'Gy'], ['mag', 'Size'], ['dir', 'Angle']], S.edge.show, function (v) { S.edge.show = v; });
    slider(p, 'Blur first σ', 0, 3, 0.1, S.edge.sigma, function (v) { return v ? fmt(v, 1) + ' px' : 'none'; }, function (v) { S.edge.sigma = v; S.memo = {}; });
    slider(p, 'Threshold', 0.02, 1.5, 0.01, S.edge.thr, function (v) { return fmt(v, 2); }, function (v) { S.edge.thr = v; S.memo = {}; });
    toggle(p, 'Picture', [['photo', 'Photo + magnifier'], ['map', 'Whole edge map']], S.base, function (v) { S.base = v; });
  };
  CTRL.corners = function (p, S) {
    h3(p, 'Harris');
    slider(p, 'Window σ', 0.6, 3, 0.1, S.hz.sigma, function (v) { return fmt(v, 1) + ' px'; }, function (v) { S.hz.sigma = v; S.memo = {}; });
    slider(p, 'k', 0.02, 0.2, 0.005, S.hz.k, function (v) { return fmt(v, 3); }, function (v) { S.hz.k = v; S.memo = {}; });
    slider(p, 'Threshold', -3.5, -0.5, 0.05, Math.log10(S.hz.rel), function (v) { return fmt(Math.pow(10, v) * 100, Math.pow(10, v) < 0.01 ? 2 : 1) + '% of max'; }, function (v) { S.hz.rel = Math.pow(10, v); S.memo = {}; });
    toggle(p, 'Show', [[false, 'Corners'], [true, 'Response R']], S.hz.showR, function (v) { S.hz.showR = v; });
  };
  CTRL.find = function (p, S, tab) {
    h3(p, 'Find the ball');
    var th = slider(p, 'Redness threshold', -0.3, 0.9, 0.01, S.find.t, function (v) { return fmt(v, 2); }, function (v) { S.find.t = v; S.memo = {}; });
    slider(p, 'Least roundness', 0, 0.9, 0.05, S.find.round, function (v) { return v ? fmt(v, 2) : 'any'; }, function (v) { S.find.round = v; S.memo = {}; });
    tab.syncFind = function () { th.set(S.find.t); };
  };
  CTRL.warp = function (p, S) {
    h3(p, 'Map');
    toggle(p, 'Map', [['persp', 'Homography'], ['affine', 'Affine']], S.warpMode, function (v) { S.warpMode = v; S.memo = {}; });
    button(p, 'Back to a rough guess', function () { S.corners = START_CORNERS.map(function (q) { return q.slice(); }); S.memo = {}; });
    button(p, 'Show me the true corners', function () { S.corners = C.CAM_CORNERS.map(function (q) { return q.slice(); }); S.memo = {}; });
  };
  CTRL.match = function (p, S, tab) {
    h3(p, 'Second view');
    slider(p, 'Turn', 0, 180, 1, S.m.rot, function (v) { return v + '°'; }, function (v) { S.m.rot = v; S.memo = {}; });
    slider(p, 'Tilt', 0, 1, 0.05, S.m.tilt, function (v) { return fmt(v, 2); }, function (v) { S.m.tilt = v; S.memo = {}; });
    h3(p, 'Matching');
    toggle(p, 'Descriptor', [[false, 'Upright'], [true, 'Oriented']], S.m.orient, function (v) { S.m.orient = v; S.memo = {}; });
    slider(p, 'Ratio test', 0.5, 1, 0.01, S.m.ratio, function (v) { return v >= 1 ? 'off' : fmt(v, 2); }, function (v) { S.m.ratio = v; S.memo = {}; });
    toggle(p, 'RANSAC', [[false, 'All matches'], [true, 'RANSAC']], S.m.ransac, function (v) { S.m.ransac = v; S.memo = {}; });
  };
  CTRL.stereo = function (p, S) {
    var st = S.st;
    h3(p, 'Two cameras');
    slider(p, 'Baseline B', 2, 30, 0.5, st.B, function (v) { return fmt(v, 1) + ' cm'; }, function (v) { st.B = v; st.dirty = true; S.memo = {}; });
    slider(p, 'Window', 3, 15, 2, st.n, function (v) { return v + ' × ' + v + ' px'; }, function (v) { st.n = v; st.map = null; S.memo = {}; });
    toggle(p, 'Right panel', [['right', 'Right image'], ['depth', 'Depth map']], st.show, function (v) { st.show = v; });
    button(p, 'Follow the ball again', function () { st.follow = true; });
  };
  CTRL.learn = function (p, S, tab) {
    h3(p, 'Target');
    toggle(p, 'Target', [['sobelx', 'Sobel x'], ['sobely', 'Sobel y'], ['blur', 'Blur'], ['sharpen', 'Sharpen']], S.target, function (v) { S.target = v; tab.learnTgt = null; tab.learner.loss = []; });
    h3(p, 'Training');
    var tb = button(p, 'Train', function () { tab.training = !tab.training; tb.textContent = tab.training ? 'Pause' : 'Train'; });
    button(p, 'Scramble the weights', function () { tab.learner.reset(); });
    slider(p, 'Step size', -3, -0.5, 0.1, Math.log10(tab.lr), function (v) { return fmt(Math.pow(10, v), 3); }, function (v) { tab.lr = Math.pow(10, v); });
    var t = telemetry(p, [['step', 'Step'], ['loss', 'Error']]);
    syncer(tab, function () { setV(t.step, String(tab.learner.t)); setV(t.loss, tab.learner.loss.length ? tab.learner.loss[tab.learner.loss.length - 1].toExponential(1) : '-'); });
  };
  CTRL.net = function (p, S, tab) {
    h3(p, 'Training');
    var tb = button(p, 'Train', function () { tab.training = !tab.training; tb.textContent = tab.training ? 'Pause' : 'Train'; });
    button(p, 'Start again from random', function () { tab.net.reset(); });
    var t = telemetry(p, [['n', 'Frames seen'], ['hit', 'Found (last 50)'], ['live', 'This frame']]);
    syncer(tab, function () {
      var N = tab.net, h = N.hits.length ? N.hits.filter(Boolean).length / N.hits.length : 0;
      setV(t.n, String(N.seen)); setV(t.hit, N.hits.length ? fmt(h * 100, 0) + '%' : '-');
      setV(t.live, (S.netHit ? 'net ✓' : 'net ✗') + ' · ' + (S.thrHit ? 'thr ✓' : 'thr ✗'), !S.netHit);
    });
  };
  CTRL.kalman = function (p, S, tab) {
    var T = tab.trk;
    h3(p, 'Filter');
    toggle(p, 'Filter', [[false, 'Off'], [true, 'Kalman']], T.on, function (v) { T.on = v; T.kf.x = null; });
    slider(p, 'Process noise q', -1, 3, 0.05, Math.log10(T.kf.q), function (v) { return fmt(Math.pow(10, v), Math.pow(10, v) < 10 ? 1 : 0) + (S.source === 'camera' ? ' px/s²' : ' cm/s²'); }, function (v) { T.kf.q = Math.pow(10, v); });
    if (S.source !== 'camera') {
      slider(p, 'Detector noise r', 0.2, 6, 0.1, T.kf.r, function (v) { return fmt(v, 1) + ' cm'; }, function (v) { T.kf.r = v; T.noise = v; });
      toggle(p, 'Gate', [[0, 'Use every fix'], [9.2, 'Gate (99%)']], T.kf.gate, function (v) { T.kf.gate = v; });
      toggle(p, 'Card', [[false, 'No card'], [true, 'Card']], !!S.card, function (v) { S.card = v ? { x: 52, y: 4, w: 16, h: 42 } : null; S.bump(); });
    }
    var t = telemetry(p, [['gain', 'Kalman gain'], ['nis', 'Surprise (NIS)']]);
    syncer(tab, function () { setV(t.gain, T.on && T.gain !== undefined ? fmt(T.gain, 2) : '-'); setV(t.nis, T.on && T.kf.x ? fmt(T.kf.nis, 1) : '-', T.kf.gate > 0 && T.kf.nis > T.kf.gate); });
  };
  CTRL.camera = function (p, S, tab) {
    h3(p, 'Your camera');
    var b = button(p, 'Start camera', function () { if (cam.stream) { stopCamera(); } else startCamera(); });
    hint(p, 'Frames are processed in this page and never leave your device.');
    syncer(tab, function () { var t = cam.stream ? 'Stop camera' : cam.status === 'asking' ? 'Asking…' : 'Start camera'; if (b.textContent !== t) b.textContent = t; });
  };
  CTRL.camfilter = function (p, S) {
    h3(p, 'Filter');
    toggle(p, 'Filter', [['raw', 'None'], ['blur', 'Blur'], ['edges', 'Edges'], ['corners', 'Corners']], S.camf, function (v) { S.camf = v; });
    slider(p, 'Blur σ', 0.5, 4, 0.1, S.blur.sigma, function (v) { return fmt(v, 1) + ' px'; }, function (v) { S.blur.sigma = v; S.edge.sigma = v > 0.6 ? v - 0.5 : 0; S.memo = {}; });
    toggle(p, 'Edges show', [['mag', 'Size'], ['dir', 'Angle']], 'mag', function (v) { S.edge.show = v; });
    toggle(p, 'Picture', [['photo', 'Camera + magnifier'], ['map', 'Whole picture']], S.base, function (v) { S.base = v; });
  };
  CTRL.picker = function (p, S, tab) {
    h3(p, 'Colour');
    slider(p, 'Tolerance', 0.02, 0.2, 0.005, tab.trk.tol, function (v) { return fmt(v, 3); }, function (v) { tab.trk.tol = v; });
  };
  var START_CORNERS = [[30, 120], [160, 120], [150, 50], [40, 50]];

  /* ================= per-lesson work ================= */
  function trackState(S, camMode) {
    var T = { on: true, kf: C.kalman({ q: camMode ? 300 : 30, r: camMode ? 3 : 1.5, gate: 0 }), noise: 1.5, truth: [], meas: [], est: [], tol: 0.05, lastZ: null };
    return T;
  }
  // One tracking tick (30 Hz): detect, add the detector's error, predict, update.
  function trackTick(S, T, dt) {
    var CAP = 240;
    function push(a, v) { a.push(v); if (a.length > CAP) a.shift(); }
    var z = null;
    if (S.source === 'camera') {
      var m = C.colorMask(S.frame, S.pick, T.tol), b = C.blobs(m, S.frame.w, S.frame.h, 12).blobs, best = C.pickBall(b, 0);
      T.mask = m; T.lastBlob = best; if (best) z = [best.cx, best.cy];
    } else {
      var d = C.detectBall(S.frame, 0.3, 0.5);
      if (d) z = [d.x + T.noise * C.gaussian(rand), d.y + T.noise * C.gaussian(rand)];
      push(T.truth, [S.scene.x, S.scene.y]);
    }
    T.lastZ = z;
    if (T.on) {
      if (T.kf.x) T.kf.predict(dt);
      if (z) { var u = T.kf.update(z); T.gain = u.gain; }
      push(T.est, T.kf.x ? [T.kf.x[0], T.kf.x[1]] : null);
    } else {
      if (z) T.hold = z;
      push(T.est, T.hold || null);
    }
    push(T.meas, z);
  }
  function learnTick(S, tab) {
    if (!S.frame) return;
    // A little noise gives the input texture in every direction, so only one set of weights fits the target.
    if (!tab.learnIn || tab.learnVer !== S.ver) { tab.learnIn = C.addNoise(grayOf(S), 0.08, rand); tab.learnTgt = null; tab.learnVer = S.ver; }
    if (!tab.learnTgt) tab.learnTgt = C.convolve(tab.learnIn, C.KERNELS[S.target], 3);
    if (tab.training) { tab.learner.step(tab.learnIn, tab.learnTgt, tab.lr); if (tab.learner.loss.length > 2000) tab.learner.loss.splice(0, tab.learner.loss.length - 2000); }
  }
  function netTick(tab) {
    var N = tab.net; if (!tab.training) return;
    var t0 = performance.now(), avg = 0, n = 0;
    while (performance.now() - t0 < 12) {
      var f = C.randomFrame(rand), inp = C.netInput(f.im), tg = C.netTarget(inp.w, inp.h, f.ball.u / 2, f.ball.v / 2);
      avg += C.netTrainStep(N.net, N.opt, inp, tg, 0.01); n++; N.seen++;
      if (N.seen % 4 === 0) { var fw = C.netForward(N.net, inp.x, inp.h, inp.w), pk = C.netPeak(fw.p, inp.w, inp.h); N.hits.push(pk.p > 0.3 && Math.hypot(pk.u - f.ball.u, pk.v - f.ball.v) < 5); if (N.hits.length > 50) N.hits.shift(); }
    }
    if (n) { N.loss.push(avg / n); if (N.loss.length > 600) N.loss.shift(); }
  }

  /* ================= lessons ================= */
  var tabs = CFG.tabs.map(function (tc) {
    var tab = Object.assign({}, tc), S = makeState(tc);
    tab.S = S; tab.hit = {}; tab.hover = {}; tab.sync = [];
    var views = [tc.top, tc.row1, tc.row2];
    if (views.indexOf('warp-src') >= 0) { S.corners = START_CORNERS.map(function (q) { return q.slice(); }); S.warpMode = 'persp'; }
    if (views.indexOf('match-pair') >= 0) S.m = { rot: 10, tilt: 0.3, scale: 0.92, orient: false, ratio: 0.8, ransac: false, sel: 0 };
    if (S.source === 'stereo') S.st = { B: 10, x: 8, z: 90, n: 7, show: 'right', follow: true, dirty: true };
    if (views.indexOf('learn-out') >= 0) { tab.kind = 'learn'; S.target = 'sobelx'; tab.learner = C.filterLearner(rand); tab.lr = 0.03; }
    if (views.indexOf('net-heat') >= 0) {
      tab.kind = 'net';
      tab.net = { reset: function () { tab.net.net = C.netCreate(rand, 6, 5); tab.net.opt = C.adamState(tab.net.net); tab.net.seen = 0; tab.net.hits = []; tab.net.loss = []; S.memo = {}; } };
      tab.net.reset();
    }
    if (views.indexOf('track') >= 0 || views.indexOf('cam-track') >= 0) { tab.trk = trackState(S, S.source === 'camera'); tab.trkAcc = 0; }
    if (S.source === 'camera') { S.camf = 'edges'; S.pick = [0.85, 0.15, 0.12]; S.blur.sigma = 1.5; S.edge.sigma = 1; }
    var panel = document.getElementById(tc.id + '-panel');
    (tc.controls || []).forEach(function (k) { if (CTRL[k]) CTRL[k](panel, S, tab); });
    ['top', 'row1', 'row2'].forEach(function (slot) { var cv = document.getElementById(tc.id + '-' + slot); if (cv) bindPointer(cv, tab, slot); });
    return tab;
  });
  // The camera only runs while a camera lesson is open.
  var shell = Shell.start(CFG, function (i) { if (tabs && tabs[i] && tabs[i].S.source !== 'camera') stopCamera(); });
  var secEls = shell.secEls;

  /* ================= the loop ================= */
  var last = null;
  function frame(ts) {
    var dt = last === null ? 1 / 60 : Math.min(0.1, (ts - last) / 1000); last = ts;
    readColors();
    tabs.forEach(function (tab, i) {
      if (!secEls[i] || !secEls[i].classList.contains('active')) return;
      var S = tab.S;
      if (S.source !== 'stereo') acquire(S, dt);
      if (tab.kind === 'learn') learnTick(S, tab);
      if (tab.kind === 'net') { netTick(tab); if (tab.training) delete S.memo.net; }
      if (tab.trk && S.frame) {
        tab.trkAcc += dt;
        if (S.source === 'camera' ? S.memo.tracked === undefined : S.fresh) { trackTick(S, tab.trk, S.source === 'camera' ? tab.trkAcc : 1 / 30); tab.trkAcc = 0; S.memo.tracked = true; S.fresh = false; }
      }
      ['top', 'row1', 'row2'].forEach(function (slot) {
        var vname = tab[slot], cv = document.getElementById(tab.id + '-' + slot); if (!cv || !V[vname]) return;
        V[vname](fit(cv), S, tab, slot);
      });
      tab.sync.forEach(function (f) { f(); });
    });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
