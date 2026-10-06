// /controls/modern/ — three newer ideas, each as something to drag:
//   #cbf     a control-barrier-function safety filter wrapped around a controller
//   #verify  proving things about a policy network with interval bounds
//   #mimo    two loops that pass every one-at-a-time test and still fail together
// The maths lives in modern-core.js (ModernCore, Node-tested by script/test-modern);
// this file only draws and handles input. Load modern-core.js first.
(function () {
  'use strict';
  if (typeof document === 'undefined') return;
  var MC = window.ModernCore;

  /* ---- Shared helpers (same conventions as bode.js) ---- */
  var clamp = MC.clamp;
  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function withAlpha(color, a) {
    var m = /^#([0-9a-f]{6})$/i.exec(color);
    if (!m) return color;
    var n = parseInt(m[1], 16);
    return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function hexRgb(color) {
    var m = /^#([0-9a-f]{6})$/i.exec(color); if (!m) return [128, 128, 128];
    var n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255];
  }
  function mix(c1, c2, t) { return [0, 1, 2].map(function (i) { return Math.round(c1[i] + (c2[i] - c1[i]) * t); }); }
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function fit(canvas) {
    var dpr = window.devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight;
    var bw = Math.max(1, Math.round(W * dpr)), bh = Math.max(1, Math.round(H * dpr));
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    return { ctx: ctx, W: W, H: H };
  }
  var col = {};
  function readColors() {
    ['text', 'text-muted', 'border', 'border-strong', 'accent', 'bg-soft', 'bg', 'viz-1', 'viz-2', 'viz-3', 'viz-4',
     'nn-act-neg', 'nn-act-zero', 'nn-act-pos', 'mono', 'font'].forEach(function (k) { col[k] = cssVar('--' + k); });
    col.muted = col['text-muted']; col.bad = col['nn-act-neg'];
  }
  function fmt(v, d) { var s = v.toFixed(d); return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s; }
  function setText(id, t) { var el = document.getElementById(id); if (el && el.textContent !== t) el.textContent = t; }
  function label(ctx, text, x, y, color, opts) {
    opts = opts || {};
    ctx.font = (opts.weight || '600') + ' ' + (opts.size || 12) + 'px ' + (opts.mono ? col.mono : col.font);
    ctx.fillStyle = color || col.text; ctx.textAlign = opts.align || 'left'; ctx.textBaseline = opts.base || 'top';
    ctx.fillText(text, x, y);
  }
  function arrow(ctx, x0, y0, x1, y1, color, width, dash) {
    var len = Math.hypot(x1 - x0, y1 - y0); if (len < 2) return;
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width || 2;
    ctx.setLineDash(dash || []);
    var ux = (x1 - x0) / len, uy = (y1 - y0) / len, hx = x1 - ux * 8, hy = y1 - uy * 8;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(hx, hy); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(hx - uy * 4.5, hy + ux * 4.5); ctx.lineTo(hx + uy * 4.5, hy - ux * 4.5); ctx.fill();
  }
  // A time plot of several series over a fixed window, with a zero line.
  function timePlot(c, x0, y0, x1, y1, series, yr, title, zeroLabel) {
    var ctx = c.ctx;
    function Y(v) { return y1 - (clamp(v, yr[0], yr[1]) - yr[0]) / (yr[1] - yr[0]) * (y1 - y0); }
    ctx.strokeStyle = col.border; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.lineTo(x1, y1); ctx.stroke();
    if (yr[0] < 0 && yr[1] > 0) {
      ctx.save(); ctx.strokeStyle = col['border-strong']; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(x0, Y(0)); ctx.lineTo(x1, Y(0)); ctx.stroke(); ctx.restore();
      if (zeroLabel) label(ctx, zeroLabel, x1 - 4, Y(0) + 3, col.muted, { align: 'right', weight: '400', size: 10, mono: true });
    }
    series.forEach(function (s) {
      if (!s.data.length) return;
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 2; ctx.setLineDash(s.dash || []);
      ctx.beginPath();
      s.data.forEach(function (v, i) {
        var x = x0 + (i + s.cap - s.data.length) / (s.cap - 1) * (x1 - x0);
        if (i) ctx.lineTo(x, Y(v)); else ctx.moveTo(x, Y(v));
      });
      ctx.stroke(); ctx.setLineDash([]);
    });
    label(ctx, title, x0 + 8, y0 + 2, col.text);
    var lx = x0 + 8;
    series.forEach(function (s) {
      if (!s.name) return;
      ctx.font = '600 11px ' + col.font;
      ctx.fillStyle = s.color; ctx.fillRect(lx, y0 + 25, 12, 3);
      ctx.fillText(s.name, lx + 16, y0 + 20);
      lx += 26 + ctx.measureText(s.name).width;
    });
  }
  function push(arr, v, cap) { arr.push(v); if (arr.length > cap) arr.shift(); }

  /* ---- Tabs and deep links (#cbf, #verify, #mimo), as on /controls/ ---- */
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.sim-tab'));
  var sections = Array.prototype.slice.call(document.querySelectorAll('.sim-section'));
  function tabName(t) { return t.getAttribute('aria-controls').replace(/^sec-/, ''); }
  function activateTab(idx) {
    tabs.forEach(function (t, i) { t.classList.toggle('active', i === idx); t.setAttribute('aria-selected', i === idx ? 'true' : 'false'); });
    sections.forEach(function (s, i) { s.classList.toggle('active', i === idx); });
  }
  function fromHash() { var w = location.hash.slice(1), idx = 0; tabs.forEach(function (t, i) { if (tabName(t) === w) idx = i; }); activateTab(idx); }
  tabs.forEach(function (t, i) {
    t.addEventListener('click', function () {
      activateTab(i);
      history.replaceState(null, '', i === 0 ? location.pathname + location.search : '#' + tabName(t));
    });
  });
  window.addEventListener('hashchange', fromHash);
  fromHash();
  function isActive(id) { var s = document.getElementById(id); return s && s.classList.contains('active'); }

  // Two-way toggle groups (.mode-btn with data-<key>).
  function bindToggle(id, key, onChange) {
    var box = document.getElementById(id); if (!box) return;
    var btns = Array.prototype.slice.call(box.querySelectorAll('.mode-btn'));
    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        btns.forEach(function (o) { var on = o === b; o.classList.toggle('active', on); o.setAttribute('aria-pressed', on ? 'true' : 'false'); });
        onChange(b.dataset[key]);
      });
    });
  }
  function bindSlider(id, onInput) {
    var el = document.getElementById(id); if (!el) return null;
    el.addEventListener('input', function () { onInput(parseFloat(el.value)); });
    onInput(parseFloat(el.value));
    return el;
  }
  // Pointer helper: calls fn(x, y, phase) in CSS pixels of the canvas.
  function bindPointer(canvas, fn) {
    var down = false;
    function pos(e) { var r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    canvas.addEventListener('pointerdown', function (e) { down = true; canvas.setPointerCapture(e.pointerId); var p = pos(e); fn(p[0], p[1], 'down'); });
    canvas.addEventListener('pointermove', function (e) { if (!down) return; var p = pos(e); fn(p[0], p[1], 'move'); });
    canvas.addEventListener('pointerup', function () { down = false; fn(0, 0, 'up'); });
    canvas.addEventListener('pointercancel', function () { down = false; fn(0, 0, 'up'); });
  }

  /* ================================================================
     Tab 1 — CBF safety filter
  ================================================================ */
  var cbf = (function () {
    var world = document.getElementById('cbf-world');
    if (!world) return null;
    var hC = document.getElementById('cbf-h'), uC = document.getElementById('cbf-u');
    var AW = 10, AH = 6, VMAX = 1.5, CAP = 600;        // arena (m), speed (m/s), 10 s of history
    var st = {
      mode: 'cbf', nominal: 'goal', alpha: 3,
      start: [0.7, 3], p: [0.7, 3], goal: [9.2, 3.2], heading: 0,
      obstacles: [{ x: 3.4, y: 3.1, r: 0.9 }, { x: 6.2, y: 1.9, r: 0.7 }, { x: 6.6, y: 4.4, r: 0.75 }],
      trail: [], hHist: [[], [], []], dHist: [], nHist: [], hits: 0, wasIn: false,
      reachedAt: null, un: [0, 0], u: [0, 0], cons: [], active: [], minH: Infinity, activeFrames: 0, frames: 0
    };
    var view = null, drag = null;

    bindToggle('cbf-mode', 'mode', function (m) { st.mode = m; resetStats(); });
    bindToggle('cbf-nominal', 'nominal', function (m) { st.nominal = m; restart(); });
    bindSlider('cbf-alpha', function (v) { st.alpha = v; setText('cbf-alpha-val', fmt(v, 1) + ' /s'); });
    document.getElementById('cbf-reset').addEventListener('click', restart);

    function resetStats() { st.hits = 0; st.minH = Infinity; st.activeFrames = 0; st.frames = 0; }
    function restart() {
      st.p = st.start.slice(); st.trail = []; st.reachedAt = null; st.heading = (Math.random() - 0.5) * 0.8;
      st.hHist = st.obstacles.map(function () { return []; }); st.dHist = []; st.nHist = [];
      resetStats();
    }

    function toWorld(x, y) { return [(x - view.ox) / view.k, (view.oy - y) / view.k]; }
    bindPointer(world, function (x, y, phase) {
      if (!view) return;
      if (phase === 'up') { drag = null; return; }
      var w = toWorld(x, y);
      if (phase === 'down') {
        drag = { type: 'goal' };
        st.obstacles.forEach(function (o, i) { if (Math.hypot(w[0] - o.x, w[1] - o.y) < o.r) drag = { type: 'obs', i: i, dx: o.x - w[0], dy: o.y - w[1] }; });
      }
      if (drag.type === 'goal') { st.goal = [clamp(w[0], 0.2, AW - 0.2), clamp(w[1], 0.2, AH - 0.2)]; st.reachedAt = null; }
      else { var o = st.obstacles[drag.i]; o.x = clamp(w[0] + drag.dx, o.r, AW - o.r); o.y = clamp(w[1] + drag.dy, o.r, AH - o.r); }
    });

    function nominal(dt) {
      if (st.nominal === 'goal') {
        var ex = st.goal[0] - st.p[0], ey = st.goal[1] - st.p[1], m = Math.hypot(ex, ey), g = 1.6;
        var sp = Math.min(VMAX, g * m);
        return m < 1e-6 ? [0, 0] : [ex / m * sp, ey / m * sp];
      }
      // Wander: a stand-in for a learned policy that knows nothing about the obstacles.
      st.heading += (Math.random() - 0.5) * 5 * dt + 0.6 * Math.sin(st.frames * 0.013) * dt;
      var cx = AW / 2 - st.p[0], cy = AH / 2 - st.p[1];
      if (Math.abs(cx) > AW * 0.38 || Math.abs(cy) > AH * 0.36) {
        var want = Math.atan2(cy, cx), d = Math.atan2(Math.sin(want - st.heading), Math.cos(want - st.heading));
        st.heading += clamp(d, -3 * dt, 3 * dt);
      }
      return [VMAX * Math.cos(st.heading), VMAX * Math.sin(st.heading)];
    }

    function step(dt) {
      st.frames++;
      var sub = 4, h = dt / sub;
      for (var k = 0; k < sub; k++) {
        st.un = nominal(h);
        if (st.mode === 'cbf') {
          var r = MC.cbfFilter(st.p, st.un, st.obstacles, st.alpha);
          st.u = r.u; st.cons = r.cons; st.active = r.active;
        } else {
          st.u = st.un.slice(); st.cons = MC.cbfConstraints(st.p, st.obstacles, st.alpha); st.active = st.cons.map(function () { return false; });
        }
        // Never let the solver's output exceed twice the speed limit (it can't in practice).
        var sp = Math.hypot(st.u[0], st.u[1]);
        if (sp > 2 * VMAX) st.u = st.u.map(function (v) { return v * 2 * VMAX / sp; });
        st.p = [clamp(st.p[0] + st.u[0] * h, 0.05, AW - 0.05), clamp(st.p[1] + st.u[1] * h, 0.05, AH - 0.05)];
      }
      if (st.active.some(Boolean)) st.activeFrames++;
      var inside = false;
      st.obstacles.forEach(function (o, i) {
        var hv = Math.pow(st.p[0] - o.x, 2) + Math.pow(st.p[1] - o.y, 2) - o.r * o.r;
        push(st.hHist[i] || (st.hHist[i] = []), hv, CAP);
        st.minH = Math.min(st.minH, hv);
        if (hv < 0) inside = true;
      });
      if (inside && !st.wasIn) st.hits++;
      st.wasIn = inside;
      push(st.dHist, Math.hypot(st.u[0] - st.un[0], st.u[1] - st.un[1]), CAP);
      push(st.nHist, Math.hypot(st.un[0], st.un[1]), CAP);
      push(st.trail, { x: st.p[0], y: st.p[1], bad: inside, filt: st.active.some(Boolean) }, 900);
      // Goal mode loops: reach the goal, pause, start again from the left.
      if (st.nominal === 'goal') {
        var dg = Math.hypot(st.goal[0] - st.p[0], st.goal[1] - st.p[1]);
        if (dg < 0.12 && st.reachedAt === null) st.reachedAt = st.frames;
        if (st.reachedAt !== null && st.frames - st.reachedAt > 70) { st.p = st.start.slice(); st.trail = []; st.reachedAt = null; }
      }
      setText('cbf-minh', st.minH === Infinity ? '-' : st.minH < 0 ? 'inside' : fmt(st.minH, 2));
      setText('cbf-hits', String(st.hits));
      setText('cbf-active', st.frames ? fmt(100 * st.activeFrames / st.frames, 0) + '%' : '-');
      var hitsEl = document.getElementById('cbf-hits'); if (hitsEl) hitsEl.classList.toggle('bode-bad', st.hits > 0);
    }

    function drawWorld() {
      var c = fit(world), ctx = c.ctx;
      var k = Math.min((c.W - 20) / AW, (c.H - 20) / AH);
      view = { k: k, ox: (c.W - AW * k) / 2, oy: (c.H + AH * k) / 2 };
      function X(x) { return view.ox + x * k; } function Y(y) { return view.oy - y * k; }
      ctx.fillStyle = col.bg; ctx.strokeStyle = col.border; ctx.lineWidth = 1;
      ctx.fillRect(X(0), Y(AH), AW * k, AH * k); ctx.strokeRect(X(0) + 0.5, Y(AH) + 0.5, AW * k - 1, AH * k - 1);
      // grid (1 m)
      ctx.strokeStyle = withAlpha(col.border, 0.6) || col.border;
      for (var gx = 1; gx < AW; gx++) { ctx.beginPath(); ctx.moveTo(X(gx), Y(0)); ctx.lineTo(X(gx), Y(AH)); ctx.stroke(); }
      for (var gy = 1; gy < AH; gy++) { ctx.beginPath(); ctx.moveTo(X(0), Y(gy)); ctx.lineTo(X(AW), Y(gy)); ctx.stroke(); }

      // Obstacles and, with the filter on, the ring inside which it can step in.
      st.obstacles.forEach(function (o, i) {
        var vc = col['viz-' + [1, 3, 4][i % 3]];
        if (st.mode === 'cbf') {
          var R = MC.cbfReach(o.r, st.alpha, VMAX);
          ctx.fillStyle = withAlpha(vc, 0.07); ctx.beginPath(); ctx.arc(X(o.x), Y(o.y), R * k, 0, 7); ctx.fill();
          ctx.save(); ctx.strokeStyle = withAlpha(vc, 0.5); ctx.setLineDash([4, 4]);
          ctx.beginPath(); ctx.arc(X(o.x), Y(o.y), R * k, 0, 7); ctx.stroke(); ctx.restore();
        }
        ctx.fillStyle = withAlpha(vc, 0.22); ctx.strokeStyle = vc; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(X(o.x), Y(o.y), o.r * k, 0, 7); ctx.fill(); ctx.stroke();
        label(ctx, 'h' + '₁₂₃'[i], X(o.x), Y(o.y) - 7, vc, { align: 'center', size: 13 });
      });

      // Goal
      if (st.nominal === 'goal') {
        ctx.strokeStyle = col.accent; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(X(st.goal[0]), Y(st.goal[1]), 9, 0, 7); ctx.stroke();
        ctx.beginPath(); ctx.arc(X(st.goal[0]), Y(st.goal[1]), 3, 0, 7); ctx.fillStyle = col.accent; ctx.fill();
        label(ctx, 'goal', X(st.goal[0]), Y(st.goal[1]) + 12, col.accent, { align: 'center', size: 11 });
      }

      // Trail: grey normally, accent where the filter acted, red inside an obstacle.
      for (var i = 1; i < st.trail.length; i++) {
        var a = st.trail[i - 1], b = st.trail[i];
        if (Math.hypot(a.x - b.x, a.y - b.y) > 1) continue;
        ctx.strokeStyle = b.bad ? col.bad : b.filt ? col['viz-2'] : withAlpha(col.muted, 0.55);
        ctx.lineWidth = b.filt || b.bad ? 2.5 : 1.5;
        ctx.beginPath(); ctx.moveTo(X(a.x), Y(a.y)); ctx.lineTo(X(b.x), Y(b.y)); ctx.stroke();
      }

      // Robot with its requested and filtered velocity.
      var px = X(st.p[0]), py = Y(st.p[1]), S = 0.75 * k;
      arrow(ctx, px, py, px + st.un[0] * S, py - st.un[1] * S, col['viz-1'], 2, [5, 4]);
      if (st.mode === 'cbf') arrow(ctx, px, py, px + st.u[0] * S, py - st.u[1] * S, col['viz-2'], 2.6);
      ctx.fillStyle = st.wasIn ? col.bad : col.text;
      ctx.beginPath(); ctx.arc(px, py, 7, 0, 7); ctx.fill();
      ctx.strokeStyle = col.bg; ctx.lineWidth = 2; ctx.stroke();

      // Badge
      var badge = st.mode === 'cbf' ? 'Safety filter on' : 'Safety filter off';
      label(ctx, badge, X(0) + 8, Y(AH) + 7, st.mode === 'cbf' ? col.accent : col.muted, { size: 12 });
      if (st.wasIn) label(ctx, 'Collision', X(AW) - 8, Y(AH) + 7, col.bad, { align: 'right', size: 12 });
      label(ctx, 'Drag the goal or the obstacles', X(AW) - 8, Y(0) - 18, col.muted, { align: 'right', size: 11, weight: '400' });
    }

    function drawH() {
      var c = fit(hC), hi = 1;
      st.hHist.forEach(function (a) { a.forEach(function (v) { hi = Math.max(hi, v); }); });
      hi = Math.min(hi, 30);
      timePlot(c, 40, 8, c.W - 12, c.H - 18, st.hHist.map(function (a, i) {
        return { data: a, cap: CAP, color: col['viz-' + [1, 3, 4][i % 3]], name: 'h' + '₁₂₃'[i] };
      }), [-0.25 * hi, hi], c.W < 520 ? 'Barrier h (safe while ≥ 0)' : 'Barrier value h = distance² − radius² (safe while ≥ 0), last 10 s', 'h = 0: the edge');
    }

    // Velocity space: what the filter is allowed to send, and what it sent.
    function drawU() {
      var c = fit(uC), ctx = c.ctx, narrow = c.W < 520;
      var sz = Math.min(c.H - 16, narrow ? c.W * 0.5 : c.W * 0.4), cx = 10 + sz / 2, cy = c.H / 2, R = 2.2 * VMAX, k = sz / (2 * R);
      ctx.fillStyle = col.bg; ctx.strokeStyle = col.border; ctx.lineWidth = 1;
      ctx.fillRect(cx - sz / 2, cy - sz / 2, sz, sz); ctx.strokeRect(cx - sz / 2 + 0.5, cy - sz / 2 + 0.5, sz - 1, sz - 1);
      ctx.save(); ctx.beginPath(); ctx.rect(cx - sz / 2, cy - sz / 2, sz, sz); ctx.clip();
      // Forbidden half-planes: a·u < b for each obstacle near enough to matter.
      st.cons.forEach(function (cn, i) {
        var a = cn.a, an = Math.hypot(a[0], a[1]); if (an < 1e-9) return;
        var n = [a[0] / an, a[1] / an], off = cn.b / an;          // boundary: n·u = off
        if (off < -R * 1.5) return;                                // far away: whole view allowed
        var vc = col['viz-' + [1, 3, 4][i % 3]];
        var px = n[0] * off, py = n[1] * off, tx = -n[1], ty = n[0], L = 4 * R;
        ctx.fillStyle = withAlpha(cn.h < 0 ? col.bad : vc, 0.16);
        ctx.beginPath();
        ctx.moveTo(cx + (px + tx * L) * k, cy - (py + ty * L) * k);
        ctx.lineTo(cx + (px - tx * L) * k, cy - (py - ty * L) * k);
        ctx.lineTo(cx + (px - tx * L - n[0] * L) * k, cy - (py - ty * L - n[1] * L) * k);
        ctx.lineTo(cx + (px + tx * L - n[0] * L) * k, cy - (py + ty * L - n[1] * L) * k);
        ctx.fill();
        ctx.strokeStyle = vc; ctx.lineWidth = st.active[i] ? 2.2 : 1;
        ctx.beginPath(); ctx.moveTo(cx + (px + tx * L) * k, cy - (py + ty * L) * k); ctx.lineTo(cx + (px - tx * L) * k, cy - (py - ty * L) * k); ctx.stroke();
      });
      ctx.strokeStyle = col.border; ctx.beginPath(); ctx.moveTo(cx - sz / 2, cy); ctx.lineTo(cx + sz / 2, cy); ctx.moveTo(cx, cy - sz / 2); ctx.lineTo(cx, cy + sz / 2); ctx.stroke();
      ctx.save(); ctx.strokeStyle = withAlpha(col.muted, 0.5); ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.arc(cx, cy, VMAX * k, 0, 7); ctx.stroke(); ctx.restore();
      arrow(ctx, cx, cy, cx + st.un[0] * k, cy - st.un[1] * k, col['viz-1'], 2, [5, 4]);
      if (st.mode === 'cbf') {
        arrow(ctx, cx, cy, cx + st.u[0] * k, cy - st.u[1] * k, col['viz-2'], 2.6);
        ctx.save(); ctx.strokeStyle = col.muted; ctx.setLineDash([2, 3]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cx + st.un[0] * k, cy - st.un[1] * k); ctx.lineTo(cx + st.u[0] * k, cy - st.u[1] * k); ctx.stroke(); ctx.restore();
      }
      ctx.restore();
      label(ctx, 'Velocity space', cx - sz / 2 + 6, cy - sz / 2 + 4, col.text, { size: 11 });
      // Legend / explanation to the right, intervention plot underneath it.
      var x0 = cx + sz / 2 + 16, x1 = c.W - 12;
      if (x1 - x0 > 120) {
        var lines = [
          ['Requested velocity', col['viz-1']], ['Sent after the filter', col['viz-2']],
          ['Shaded: velocities that would close in on an obstacle too fast (ḣ < −αh)', col.muted]
        ];
        var y = 8;
        lines.forEach(function (l) {
          ctx.font = '600 11px ' + col.font; ctx.fillStyle = l[1];
          var words = l[0].split(' '), line = '';
          words.forEach(function (w) {
            var t = line ? line + ' ' + w : w;
            if (ctx.measureText(t).width > x1 - x0 && line) { ctx.fillText(line, x0, y); y += 14; line = w; } else line = t;
          });
          ctx.textBaseline = 'top'; ctx.fillText(line, x0, y); y += 18;
        });
        var top = Math.min(y + 4, c.H - 60);
        timePlot({ ctx: ctx, W: c.W }, x0, top, x1, c.H - 8, [
          { data: st.nHist, cap: CAP, color: withAlpha(col['viz-1'], 0.5), width: 1.4 },
          { data: st.dHist, cap: CAP, color: col['viz-2'] }
        ], [0, 2 * VMAX], narrow ? 'Change made' : 'How much the filter changed it', null);
      }
    }

    return {
      sec: 'sec-cbf',
      frame: function (dt) { step(dt); drawWorld(); drawH(); drawU(); },
      restart: restart
    };
  })();

  /* ================================================================
     Tab 2 — Verifying a policy network
  ================================================================ */
  var ver = (function () {
    var mapC = document.getElementById('ver-map');
    if (!mapC) return null;
    var lineC = document.getElementById('ver-line'), boxC = document.getElementById('ver-box');
    var TH = 0.5, TD = 1.5;           // map ranges: θ ∈ ±0.5 rad, θ̇ ∈ ±1.5 rad/s
    var st = { net: null, sc: [0, 0, 0.1, 0], eps: 0.0016, delta: 0.5, depth: 0,
               heat: null, radius: null, radiusJob: null, q: null, big: null, bigW: null, bigState: 'idle' };

    fetch(mapC.dataset.net).then(function (r) { return r.json(); }).then(function (n) {
      st.net = n; buildHeat(); recompute();
    }).catch(function () { setText('ver-verdict', 'Could not load the network'); });

    bindSlider('ver-eps', function (v) {
      st.eps = Math.pow(10, v);
      setText('ver-eps-val', '±' + fmt(st.eps * 180 / Math.PI, st.eps < 0.0175 ? 2 : 1) + '°');
      recompute();
    });
    bindSlider('ver-delta', function (v) { st.delta = v; setText('ver-delta-val', '±' + fmt(v, 2) + ' N'); recompute(true); });
    bindToggle('ver-depth', 'depth', function (d) { st.depth = parseInt(d, 10); recompute(true); });
    var bigBtn = document.getElementById('ver-big');
    bigBtn.addEventListener('click', function () {
      if (st.bigState !== 'idle') return;
      st.bigState = 'loading'; bigBtn.textContent = 'Loading 2 MB…'; bigBtn.disabled = true;
      fetch(bigBtn.dataset.meta).then(function (r) { return r.json(); }).then(function (meta) {
        return fetch(bigBtn.dataset.weights).then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
          st.big = MC.loadBigNet(meta, buf); st.bigState = 'ready'; bigBtn.textContent = 'Swing-up network loaded'; recomputeBig();
        });
      }).catch(function () { st.bigState = 'idle'; bigBtn.disabled = false; bigBtn.textContent = 'Could not load; try again'; });
    });

    function recomputeBig() {
      if (!st.big) return;
      var w = [], b = MC.bigQueryBox(st.sc[2], 0, st.eps);
      var F = MC.bigBounds(st.big, b.lo, b.hi, w);
      st.bigW = w; st.bigF = F;
    }

    // Map geometry inside the top canvas: two square-ish panels side by side (stacked when narrow).
    var panels = null;
    function layout(c) {
      var gap = 14, narrow = c.W < 560;
      if (narrow) {
        var h = (c.H - 3 * gap - 30) / 2;
        return [{ x0: 40, y0: 22, x1: c.W - 12, y1: 22 + h }, { x0: 40, y0: 22 + h + gap + 22, x1: c.W - 12, y1: 22 + 2 * h + gap + 22 }];
      }
      var w = (c.W - 40 - 40 - gap - 12) / 2;
      return [{ x0: 40, y0: 22, x1: 40 + w, y1: c.H - 30 }, { x0: 40 + w + gap + 40, y0: 22, x1: c.W - 12, y1: c.H - 30 }];
    }
    function toState(p, x, y) {
      return [(x - p.x0) / (p.x1 - p.x0) * 2 * TH - TH, -((y - p.y0) / (p.y1 - p.y0) * 2 * TD - TD)];
    }
    bindPointer(mapC, function (x, y, phase) {
      if (phase === 'up' || !panels) return;
      panels.forEach(function (p) {
        if (x >= p.x0 - 10 && x <= p.x1 + 10 && y >= p.y0 - 10 && y <= p.y1 + 10) {
          var s = toState(p, x, y);
          st.sc = [0, 0, clamp(s[0], -TH, TH), clamp(s[1], -TD, TD)];
          recompute();
        }
      });
    });

    var HW = 100, HH = 60;
    function buildHeat() {
      var neg = hexRgb(col['nn-act-neg']), zero = hexRgb(col['nn-act-zero']), pos = hexRgb(col['nn-act-pos']);
      var img = new ImageData(HW, HH);
      for (var j = 0; j < HH; j++) for (var i = 0; i < HW; i++) {
        var th = -TH + 2 * TH * (i + 0.5) / HW, td = TD - 2 * TD * (j + 0.5) / HH;
        var F = MC.smallForward(st.net, [0, 0, th, td]) / st.net.force_max;
        var c = F < 0 ? mix(zero, neg, Math.min(1, -F)) : mix(zero, pos, Math.min(1, F));
        var o = 4 * (j * HW + i); img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
      }
      var cv = document.createElement('canvas'); cv.width = HW; cv.height = HH; cv.getContext('2d').putImageData(img, 0, 0);
      st.heat = cv; st.heatTheme = col['nn-act-pos'];
    }

    // Certified-radius map, computed a slice per frame so dragging stays smooth.
    var RW = 34, RH = 20;
    function startRadius() {
      st.radius = new Float32Array(RW * RH).fill(NaN);
      st.radiusJob = { i: 0, delta: st.delta, depth: st.depth };
    }
    function workRadius() {
      var job = st.radiusJob; if (!job || !st.net) return;
      var t0 = performance.now();
      while (job.i < RW * RH && performance.now() - t0 < 7) {
        var i = job.i % RW, j = Math.floor(job.i / RW);
        var th = -TH + 2 * TH * (i + 0.5) / RW, td = TD - 2 * TD * (j + 0.5) / RH;
        st.radius[job.i] = MC.certifiedRadius(st.net, [0, 0, th, td], job.delta, job.depth, 0.1);
        job.i++;
      }
      if (job.i >= RW * RH) st.radiusJob = null;
    }

    function recompute(radiusToo) {
      if (!st.net) return;
      var cert = MC.certifiedDeviation(st.net, st.sc, st.eps, st.depth);
      var cert0 = st.depth ? MC.certifiedDeviation(st.net, st.sc, st.eps, 0) : cert;
      var att = MC.attackDeviation(st.net, st.sc, st.eps, 60);
      var verdict = cert.dev <= st.delta ? 'verified' : att.dev > st.delta ? 'falsified' : 'unknown';
      var widths = []; var b = MC.queryBox(st.sc, st.eps); MC.smallBounds(st.net, b.lo, b.hi, widths);
      st.q = { cert: cert, cert0: cert0, att: att, verdict: verdict, widths: widths };
      setText('ver-force', fmt(cert.Fc, 2) + ' N');
      setText('ver-bound', '±' + fmt(cert.dev, cert.dev < 10 ? 2 : 1) + ' N');
      setText('ver-attack', '±' + fmt(att.dev, 2) + ' N');
      setText('ver-verdict', verdict === 'verified' ? 'Proved' : verdict === 'falsified' ? 'Disproved' : 'Unknown');
      var vEl = document.getElementById('ver-verdict');
      if (vEl) { vEl.classList.toggle('bode-bad', verdict === 'falsified'); vEl.classList.toggle('ver-unknown', verdict === 'unknown'); }
      if (radiusToo || !st.radius) startRadius();
      recomputeBig();
    }

    function radiusColor(r) {
      var t = r >= 0.1 ? 1 : r <= 0.0005 ? 0 : Math.log10(r / 0.0005) / Math.log10(0.1 / 0.0005);
      return mix(hexRgb(col.bad), hexRgb(col.accent), t);
    }

    function drawMaps() {
      var c = fit(mapC), ctx = c.ctx; panels = layout(c);
      if (!st.net) { label(ctx, 'Loading the network…', 20, 20, col.muted); return; }
      if (st.heatTheme !== col['nn-act-pos']) buildHeat();
      var titles = ['What the network does: force over angle and rate', 'Where it is provably steady: certified ε for ±' + fmt(st.delta, 2) + ' N'];
      panels.forEach(function (p, pi) {
        ctx.save(); ctx.beginPath(); ctx.rect(p.x0, p.y0, p.x1 - p.x0, p.y1 - p.y0); ctx.clip();
        if (pi === 0) {
          ctx.imageSmoothingEnabled = true; ctx.drawImage(st.heat, p.x0, p.y0, p.x1 - p.x0, p.y1 - p.y0);
        } else {
          var cw = (p.x1 - p.x0) / RW, ch = (p.y1 - p.y0) / RH;
          for (var k = 0; k < RW * RH; k++) {
            var r = st.radius[k], i = k % RW, j = Math.floor(k / RW);
            if (isNaN(r)) { ctx.fillStyle = col['bg-soft']; } else { var cc = radiusColor(r); ctx.fillStyle = 'rgb(' + cc.join(',') + ')'; }
            ctx.fillRect(p.x0 + i * cw, p.y0 + j * ch, cw + 0.6, ch + 0.6);
          }
        }
        ctx.restore();
        ctx.strokeStyle = col.border; ctx.lineWidth = 1; ctx.strokeRect(p.x0 + 0.5, p.y0 + 0.5, p.x1 - p.x0 - 1, p.y1 - p.y0 - 1);
        // axes labels
        label(ctx, titles[pi], p.x0, p.y0 - 18, col.text, { size: 11 });
        label(ctx, '+' + fmt(TD, 1), p.x0 - 4, p.y0, col.muted, { align: 'right', size: 10, mono: true, weight: '400' });
        label(ctx, 'rate', p.x0 - 4, (p.y0 + p.y1) / 2 - 6, col.muted, { align: 'right', size: 10, mono: true });
        label(ctx, '−' + fmt(TD, 1), p.x0 - 4, p.y1 - 12, col.muted, { align: 'right', size: 10, mono: true, weight: '400' });
        label(ctx, '−0.5', p.x0, p.y1 + 3, col.muted, { size: 10, mono: true, weight: '400' });
        label(ctx, 'θ (rad)', (p.x0 + p.x1) / 2, p.y1 + 3, col.muted, { align: 'center', size: 10, mono: true });
        label(ctx, '+0.5', p.x1, p.y1 + 3, col.muted, { align: 'right', size: 10, mono: true, weight: '400' });
        // the query point and its ε-box
        var X = function (th) { return p.x0 + (th + TH) / (2 * TH) * (p.x1 - p.x0); };
        var Y = function (td) { return p.y0 + (TD - td) / (2 * TD) * (p.y1 - p.y0); };
        var bx0 = X(st.sc[2] - st.eps), bx1 = X(st.sc[2] + st.eps), by0 = Y(st.sc[3] + MC.RATE_PER_ANGLE * st.eps), by1 = Y(st.sc[3] - MC.RATE_PER_ANGLE * st.eps);
        var mx = (bx0 + bx1) / 2, my = (by0 + by1) / 2, hw = Math.max(4, (bx1 - bx0) / 2), hh = Math.max(4, (by1 - by0) / 2);
        var vcol = st.q.verdict === 'verified' ? col.accent : st.q.verdict === 'falsified' ? col.bad : col.text;
        ctx.strokeStyle = col.bg; ctx.lineWidth = 4; ctx.strokeRect(mx - hw, my - hh, 2 * hw, 2 * hh);
        ctx.strokeStyle = vcol; ctx.lineWidth = 2; ctx.strokeRect(mx - hw, my - hh, 2 * hw, 2 * hh);
        ctx.fillStyle = vcol; ctx.beginPath(); ctx.arc(mx, my, 2.5, 0, 7); ctx.fill();
      });
      // colour keys
      var p0 = panels[0], p1 = panels[1];
      label(ctx, 'push left', p0.x0 + 4, p0.y1 - 16, col.bad, { size: 10 });
      label(ctx, 'push right', p0.x1 - 4, p0.y0 + 3, col['nn-act-pos'], { align: 'right', size: 10 });
      label(ctx, st.radiusJob ? 'computing… ' + Math.round(100 * st.radiusJob.i / (RW * RH)) + '%' : 'red ≈ 0.03°, teal ≥ 6°', p1.x1 - 4, p1.y1 - 15, col.text, { align: 'right', size: 10 });
    }

    // The query on a force axis: what we can prove vs what we can find.
    function drawLine() {
      var c = fit(lineC), ctx = c.ctx;
      if (!st.q) return;
      var q = st.q, Fc = q.cert.Fc, span = Math.max(q.cert0.dev, q.att.dev, st.delta) * 1.25;
      span = Math.min(span, 25);
      var x0 = 16, x1 = c.W - 16, mid = (x0 + x1) / 2, narrow = c.W < 520;
      function X(F) { return mid + clamp((F - Fc) / span, -1.05, 1.05) * (x1 - x0) / 2; }
      var rows = [
        { y: 42, name: 'Proved, one box', lo: q.cert0.lo, hi: q.cert0.hi, color: col['viz-1'], hatch: true },
        { y: 70, name: 'Proved, split into ' + (1 << st.depth) * (1 << st.depth) + ' boxes', lo: q.cert.lo, hi: q.cert.hi, color: col['viz-1'], hatch: true, skip: st.depth === 0 },
        { y: 98, name: 'Found by trying inputs', lo: q.att.lo, hi: q.att.hi, color: col['viz-2'] }
      ];
      // allowed band
      ctx.fillStyle = withAlpha(col.accent, 0.12); ctx.fillRect(X(Fc - st.delta), 26, X(Fc + st.delta) - X(Fc - st.delta), c.H - 46);
      ctx.strokeStyle = col.accent; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
      [Fc - st.delta, Fc + st.delta].forEach(function (v) { ctx.beginPath(); ctx.moveTo(X(v), 26); ctx.lineTo(X(v), c.H - 20); ctx.stroke(); });
      ctx.setLineDash([]);
      label(ctx, 'allowed: ±' + fmt(st.delta, 2) + ' N', X(Fc + st.delta) + 4, 28, col.accent, { size: 10 });
      rows.forEach(function (r) {
        if (r.skip) return;
        var a = X(r.lo), b = X(r.hi);
        ctx.fillStyle = withAlpha(r.color, 0.22); ctx.fillRect(a, r.y, Math.max(2, b - a), 14);
        ctx.strokeStyle = r.color; ctx.lineWidth = 1.5; ctx.strokeRect(a, r.y, Math.max(2, b - a), 14);
        if (r.hatch) {
          ctx.save(); ctx.beginPath(); ctx.rect(a, r.y, b - a, 14); ctx.clip(); ctx.strokeStyle = withAlpha(r.color, 0.5); ctx.lineWidth = 1;
          for (var hx = a - 14; hx < b; hx += 6) { ctx.beginPath(); ctx.moveTo(hx, r.y + 14); ctx.lineTo(hx + 14, r.y); ctx.stroke(); }
          ctx.restore();
        }
        if (r.lo < Fc - span || r.hi > Fc + span) label(ctx, '(off the scale)', x1, r.y + 1, col.muted, { align: 'right', size: 10, weight: '400' });
        ctx.font = '600 11px ' + col.font;
        var tw = ctx.measureText(r.name).width;
        if (b + 6 + tw < x1) label(ctx, r.name, b + 6, r.y + 1, r.color, { size: 11 });
        else if (a - 6 - tw > x0) label(ctx, r.name, a - 6, r.y + 1, r.color, { size: 11, align: 'right' });
        else label(ctx, r.name, x0, r.y - 13, r.color, { size: 11 });
      });
      ctx.strokeStyle = col.text; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(X(Fc), 24); ctx.lineTo(X(Fc), c.H - 18); ctx.stroke();
      label(ctx, 'F at the state = ' + fmt(Fc, 2) + ' N', X(Fc) - 4, c.H - 16, col.text, { align: 'right', size: 10, mono: true });
      var v = q.verdict;
      var head = narrow
        ? (v === 'verified' ? 'Proved' : v === 'falsified' ? 'Disproved: found ±' + fmt(q.att.dev, 2) + ' N' : 'Unknown: split the box')
        : v === 'verified' ? 'Proved: no sensor error this small can move the force more than ±' + fmt(st.delta, 2) + ' N.'
        : v === 'falsified' ? 'Disproved: an input in the box moves the force by ' + fmt(q.att.dev, 2) + ' N.'
        : 'Unknown: the proof is too loose and no counterexample was found. Split the box.';
      label(ctx, head, x0, 4, v === 'verified' ? col.accent : v === 'falsified' ? col.bad : col.text, { size: 12 });
      // force axis ticks
      ctx.strokeStyle = col.border; ctx.beginPath(); ctx.moveTo(x0, c.H - 20); ctx.lineTo(x1, c.H - 20); ctx.stroke();
      if (!narrow) {
        label(ctx, fmt(Fc - span, 1) + ' N', x0, c.H - 16, col.muted, { size: 10, mono: true, weight: '400' });
        label(ctx, fmt(Fc + span, 1) + ' N', x1, c.H - 16, col.muted, { align: 'right', size: 10, mono: true, weight: '400' });
      }
    }

    // Left: the ε-box up close, split; right: how wide the bound gets layer by layer.
    function drawBox() {
      var c = fit(boxC), ctx = c.ctx; if (!st.q) return;
      var narrow = c.W < 520, side = Math.min(c.H - 34, narrow ? c.W * 0.26 : 170), x0 = 12, y0 = 22;
      label(ctx, 'The box, split', x0, 4, col.text, { size: 11 });
      var pieces = st.q.cert.pieces, n = 1 << st.depth, cell = side / n;
      pieces.forEach(function (p, idx) {
        var i = Math.floor(idx / n), j = idx % n;   // i along θ, j along θ̇
        var dev = Math.max(p.F[1] - st.q.cert.Fc, st.q.cert.Fc - p.F[0]);
        ctx.fillStyle = dev <= st.delta ? withAlpha(col.accent, 0.55) : withAlpha(col.muted, 0.25);
        ctx.fillRect(x0 + i * cell, y0 + (n - 1 - j) * cell, cell, cell);
        ctx.strokeStyle = col.bg; ctx.lineWidth = 1; ctx.strokeRect(x0 + i * cell + 0.5, y0 + (n - 1 - j) * cell + 0.5, cell - 1, cell - 1);
      });
      ctx.strokeStyle = col.text; ctx.lineWidth = 1.5; ctx.strokeRect(x0, y0, side, side);
      label(ctx, 'θ', x0 + side / 2, y0 + side + 2, col.muted, { align: 'center', size: 11, mono: true });
      if (!narrow) {
        label(ctx, 'teal: proved', x0 + side + 8, y0 + side - 28, col.accent, { size: 10 });
        label(ctx, 'grey: not yet', x0 + side + 8, y0 + side - 14, col.muted, { size: 10 });
      }

      // Layer-by-layer bound width, log scale, as a multiple of the input box's width.
      var gx0 = x0 + side + (narrow ? 112 : 96), gx1 = c.W - 12, gy0 = 22, gy1 = c.H - 30;
      if (narrow) { gx0 = x0 + side + 40; label(ctx, 'teal: proved', x0, y0 + side + 16, col.accent, { size: 10 }); }
      if (gx1 - gx0 < 100) return;
      label(ctx, narrow ? 'Proof width by layer' : 'How wide the proof gets, layer by layer (× the input box)', gx0, 4, col.text, { size: 11 });
      var groups = [{ name: 'small net (4·16·16·1)', w: st.q.widths, stages: MC.SMALL_STAGES, color: col['viz-1'] }];
      if (st.bigW) groups.push({ name: 'swing-up net (1M weights)', w: st.bigW, stages: MC.BIG_STAGES, color: col['viz-2'] });
      var LMIN = -1, LMAX = 8;
      function Y(v) { var l = Math.log10(Math.max(v, 1e-9)); return gy1 - (clamp(l, LMIN, LMAX) - LMIN) / (LMAX - LMIN) * (gy1 - gy0); }
      [0, 2, 4, 6, 8].forEach(function (e) {
        ctx.strokeStyle = col.border; ctx.beginPath(); ctx.moveTo(gx0, Y(Math.pow(10, e))); ctx.lineTo(gx1, Y(Math.pow(10, e))); ctx.stroke();
        label(ctx, e === 0 ? '1×' : '10' + ['⁰', '', '²', '', '⁴', '', '⁶', '', '⁸'][e] + '×', gx0 - 4, Y(Math.pow(10, e)) - 6, col.muted, { align: 'right', size: 10, mono: true, weight: '400' });
      });
      var total = groups.reduce(function (a, g) { return a + g.stages.length; }, 0) + (groups.length - 1) * 1.5;
      var bw = (gx1 - gx0) / total, x = gx0;
      groups.forEach(function (g) {
        var base = g.w[0] || 1e-12, gStart = x;
        g.w.forEach(function (w, i) {
          var ratio = w / base, top = Y(ratio);
          ctx.fillStyle = withAlpha(g.color, i === g.w.length - 1 ? 0.9 : 0.55);
          ctx.fillRect(x + bw * 0.15, top, bw * 0.7, gy1 - top);
          if (bw > 22) label(ctx, g.stages[i], x + bw / 2, gy1 + 3, col.muted, { align: 'center', size: 9, weight: '400' });
          x += bw;
        });
        label(ctx, g.name, gStart, gy0 + 2, g.color, { size: 10 });
        var last = g.w[g.w.length - 1];
        label(ctx, 'force ±' + fmt(last / 2, last < 2 ? 2 : 1) + ' N', x - 2, Y(last / base) - 14, g.color, { align: 'right', size: 10, mono: true });
        x += bw * 1.5;
      });
    }

    return {
      sec: 'sec-verify',
      frame: function () { workRadius(); drawMaps(); drawLine(); drawBox(); }
    };
  })();

  /* ================================================================
     Tab 3 — MIMO: the spinning satellite
  ================================================================ */
  var mimo = (function () {
    var satC = document.getElementById('mimo-sat');
    if (!satC) return null;
    var timeC = document.getElementById('mimo-time'), loopC = document.getElementById('mimo-loops');
    var CAP = 600, MAPR = 0.5;
    var st = { d1: 0, d2: 0, x: [0.02, -0.012], spin: 0, y1: [], y2: [], trail: [], lostAt: null, t: 0, lastNudge: 0 };
    var simMargin = MC.satSimultaneousMargin();
    var single = [0, 1].map(function (i) { return MC.loopMargins(function (w) { return MC.satLoop(i, w); }, 0.01, 100, 1500); });
    setText('mimo-l1', fmt(single[0].pm, 0) + '°, gain ∞');
    setText('mimo-l2', fmt(single[1].pm, 0) + '°, gain ∞');
    setText('mimo-both', '±' + fmt(simMargin * 100, 2) + '%');

    var s1 = document.getElementById('mimo-d1'), s2 = document.getElementById('mimo-d2');
    function setD(d1, d2, fromSlider) {
      st.d1 = clamp(d1, -MAPR, MAPR); st.d2 = clamp(d2, -MAPR, MAPR);
      if (!fromSlider) { s1.value = st.d1; s2.value = st.d2; }
      setText('mimo-d1-val', (st.d1 >= 0 ? '+' : '') + fmt(st.d1 * 100, 0) + '%');
      setText('mimo-d2-val', (st.d2 >= 0 ? '+' : '') + fmt(st.d2 * 100, 0) + '%');
      var ok = MC.satStable(st.d1, st.d2);
      setText('mimo-stable', ok ? 'Stable' : 'Unstable');
      var el = document.getElementById('mimo-stable'); if (el) el.classList.toggle('bode-bad', !ok);
    }
    s1.addEventListener('input', function () { setD(parseFloat(s1.value), st.d2, true); });
    s2.addEventListener('input', function () { setD(st.d1, parseFloat(s2.value), true); });
    document.getElementById('mimo-zero').addEventListener('click', function () { setD(0, 0); nudge(); });
    document.getElementById('mimo-preset').addEventListener('click', function () { setD(0.15, -0.15); nudge(); });
    document.getElementById('mimo-nudge').addEventListener('click', nudge);
    function nudge() {
      var a = Math.random() * 6.28;
      st.x = [st.x[0] + 0.03 * Math.cos(a), st.x[1] + 0.03 * Math.sin(a)]; st.lastNudge = st.t;
    }
    setD(0, 0);

    var mapBox = null;
    bindPointer(satC, function (x, y, phase) {
      if (phase === 'up' || !mapBox) return;
      if (x < mapBox.x0 - 10 || x > mapBox.x1 + 10 || y < mapBox.y0 - 10 || y > mapBox.y1 + 10) return;
      var d1 = (x - mapBox.x0) / (mapBox.x1 - mapBox.x0) * 2 * MAPR - MAPR;
      var d2 = MAPR - (y - mapBox.y0) / (mapBox.y1 - mapBox.y0) * 2 * MAPR;
      setD(Math.round(d1 * 100) / 100, Math.round(d2 * 100) / 100);
    });

    function step(dt) {
      st.t += dt; st.spin += dt * 2.2;
      var sub = 8;
      for (var k = 0; k < sub; k++) st.x = MC.satStep(st.x, st.d1, st.d2, dt / sub);
      var y = MC.satOutput(st.x), mag = Math.hypot(y[0], y[1]);
      if (mag > 2.5 && st.lostAt === null) st.lostAt = st.t;
      if (st.lostAt !== null && st.t - st.lostAt > 1.5) { st.x = [0.02, -0.012]; st.lostAt = null; st.trail = []; }
      // Keep it interesting: a fresh nudge every few seconds once it has settled.
      if (mag < 0.02 && st.t - st.lastNudge > 4) nudge();
      push(st.y1, clamp(y[0], -3, 3), CAP); push(st.y2, clamp(y[1], -3, 3), CAP);
      push(st.trail, [clamp(y[0], -3, 3), clamp(y[1], -3, 3)], 300);
    }

    var mapImg = null, mapTheme = null;
    function buildMap() {
      var N = 160, img = new ImageData(N, N), good = hexRgb(col.accent), bad = hexRgb(col.bad), bg = hexRgb(col.bg);
      for (var j = 0; j < N; j++) for (var i = 0; i < N; i++) {
        var d1 = -MAPR + 2 * MAPR * (i + 0.5) / N, d2 = MAPR - 2 * MAPR * (j + 0.5) / N;
        var c = MC.satStable(d1, d2) ? mix(bg, good, 0.22) : mix(bg, bad, 0.35), o = 4 * (j * N + i);
        img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
      }
      var cv = document.createElement('canvas'); cv.width = N; cv.height = N; cv.getContext('2d').putImageData(img, 0, 0);
      mapImg = cv; mapTheme = col.accent;
    }

    function drawSat() {
      var c = fit(satC), ctx = c.ctx, narrow = c.W < 560;
      var side = narrow ? Math.min(c.W - 60, (c.H - 40) / 2) : Math.min(c.H - 44, c.W * 0.42);
      // Left: where the spin axis points.
      var lx0 = 12, ly0 = 22, lw = narrow ? c.W - 24 : c.W - side - 80, lh = narrow ? c.H - side - 64 : c.H - 34;
      // Zoom to the motion so a small wobble is as visible as a large one.
      var ext = 0.08; st.trail.forEach(function (q) { ext = Math.max(ext, Math.abs(q[0]), Math.abs(q[1])); });
      st.zoom = st.zoom ? st.zoom + (Math.min(ext, 1.3) * 1.15 - st.zoom) * 0.08 : Math.min(ext, 1.3) * 1.15;
      var cx = lx0 + lw / 2, cy = ly0 + lh / 2, R = Math.min(lw, lh) / 2 - 8, k = R / st.zoom;
      label(ctx, 'Where the spin axis points (y₁, y₂)', lx0, 4, col.text, { size: 11 });
      ctx.strokeStyle = col.border; ctx.lineWidth = 1;
      [1 / 3, 2 / 3, 1].forEach(function (r) { ctx.beginPath(); ctx.arc(cx, cy, r * R, 0, 7); ctx.stroke(); });
      ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
      label(ctx, 'target', cx + 4, cy + 3, col.muted, { size: 10, weight: '400' });
      // trail
      for (var i = 1; i < st.trail.length; i++) {
        var a = st.trail[i - 1], b = st.trail[i];
        ctx.strokeStyle = withAlpha(MC.satStable(st.d1, st.d2) ? col.accent : col.bad, 0.15 + 0.85 * i / st.trail.length);
        ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx + clamp(a[0] * k, -R, R), cy - clamp(a[1] * k, -R, R)); ctx.lineTo(cx + clamp(b[0] * k, -R, R), cy - clamp(b[1] * k, -R, R)); ctx.stroke();
      }
      // the satellite: a spinning body at the axis tip
      var y = MC.satOutput(st.x), tx = cx + clamp(y[0] * k, -R, R), ty = cy - clamp(y[1] * k, -R, R);
      ctx.save(); ctx.translate(tx, ty); ctx.rotate(st.spin);
      ctx.fillStyle = col['viz-1']; ctx.fillRect(-20, -4, 14, 8); ctx.fillRect(6, -4, 14, 8);
      ctx.fillStyle = col.text; ctx.fillRect(-6, -6, 12, 12);
      ctx.restore();
      if (st.lostAt !== null) label(ctx, 'Tumbling: the loops have lost it', cx, ly0 + lh - 14, col.bad, { align: 'center', size: 12 });

      // Right: the stability map over both gain errors.
      var mx0 = narrow ? (c.W - side) / 2 : c.W - side - 14, my0 = narrow ? ly0 + lh + 34 : 22;
      mapBox = { x0: mx0, y0: my0, x1: mx0 + side, y1: my0 + side };
      if (mapTheme !== col.accent) buildMap();
      ctx.imageSmoothingEnabled = true; ctx.drawImage(mapImg, mx0, my0, side, side);
      ctx.strokeStyle = col.border; ctx.strokeRect(mx0 + 0.5, my0 + 0.5, side - 1, side - 1);
      label(ctx, 'Stable gain errors (drag)', mx0, my0 - 18, col.text, { size: 11 });
      function MX(d) { return mx0 + (d + MAPR) / (2 * MAPR) * side; }
      function MY(d) { return my0 + (MAPR - d) / (2 * MAPR) * side; }
      // one-at-a-time tests: the two axes
      ctx.strokeStyle = col.accent; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(MX(-MAPR), MY(0)); ctx.lineTo(MX(MAPR), MY(0)); ctx.moveTo(MX(0), MY(-MAPR)); ctx.lineTo(MX(0), MY(MAPR)); ctx.stroke();
      // both-at-once margin square
      ctx.save(); ctx.strokeStyle = col.text; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.5;
      ctx.strokeRect(MX(-simMargin), MY(simMargin), MX(simMargin) - MX(-simMargin), MY(-simMargin) - MY(simMargin)); ctx.restore();
      label(ctx, 'δ₁ →', mx0 + side, my0 + side + 3, col.muted, { align: 'right', size: 10, mono: true });
      label(ctx, '−50%', mx0, my0 + side + 3, col.muted, { size: 10, mono: true, weight: '400' });
      label(ctx, 'δ₂', mx0 - 4, my0, col.muted, { align: 'right', size: 10, mono: true });
      label(ctx, 'one at a time', MX(MAPR) - 4, MY(0) - 15, col.accent, { align: 'right', size: 10 });
      // current point
      var ok = MC.satStable(st.d1, st.d2);
      ctx.fillStyle = ok ? col.accent : col.bad; ctx.beginPath(); ctx.arc(MX(st.d1), MY(st.d2), 6, 0, 7); ctx.fill();
      ctx.strokeStyle = col.bg; ctx.lineWidth = 2; ctx.stroke();
    }

    function drawTime() {
      var c = fit(timeC), m = 0.05;
      st.y1.concat(st.y2).forEach(function (v) { m = Math.max(m, Math.abs(v)); });
      m = Math.min(m * 1.2, 3);
      timePlot(c, 40, 8, c.W - 12, c.H - 18, [
        { data: st.y1, cap: CAP, color: col['viz-1'], name: 'y₁' },
        { data: st.y2, cap: CAP, color: col['viz-3'], name: 'y₂' }
      ], [-m, m], 'Pointing error on each axis, last 10 s', null);
    }

    // Three small figures: what each loop sees alone (Nyquist), and both together (poles).
    function drawLoops() {
      var c = fit(loopC), ctx = c.ctx, n = 3, gap = 12, w = (c.W - 24 - gap * (n - 1)) / n, h = c.H - 30;
      function rho(r) { return r <= 1 ? r : 1 + 0.5 * Math.log10(r); }
      [0, 1].forEach(function (li) {
        var x0 = 12 + li * (w + gap), y0 = 22, cx = x0 + w / 2, cy = y0 + h / 2, k = Math.min(w, h) / 2 / 2.3;
        label(ctx, 'Loop ' + (li + 1) + (c.W < 560 ? ' alone' : ' alone (Nyquist)'), x0, 4, col.text, { size: 11 });
        ctx.strokeStyle = col.border; ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
        ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, w, h); ctx.clip();
        ctx.beginPath(); ctx.moveTo(x0, cy); ctx.lineTo(x0 + w, cy); ctx.moveTo(cx, y0); ctx.lineTo(cx, y0 + h); ctx.stroke();
        ctx.setLineDash([4, 4]); ctx.strokeStyle = col['border-strong']; ctx.beginPath(); ctx.arc(cx, cy, k, 0, 7); ctx.stroke(); ctx.setLineDash([]);
        ctx.strokeStyle = col['viz-1']; ctx.lineWidth = 2; ctx.beginPath();
        for (var i = 0; i <= 200; i++) {
          var om = Math.pow(10, -1.5 + 3.5 * i / 200), L = MC.satLoop(li, om), r = rho(Math.hypot(L[0], L[1])), a = Math.atan2(L[1], L[0]);
          var px = cx + r * Math.cos(a) * k, py = cy - r * Math.sin(a) * k;
          if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        }
        ctx.stroke(); ctx.restore();
        ctx.strokeStyle = col.bad; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(cx - k - 5, cy - 5); ctx.lineTo(cx - k + 5, cy + 5); ctx.moveTo(cx - k + 5, cy - 5); ctx.lineTo(cx - k - 5, cy + 5); ctx.stroke();
        label(ctx, '−1', cx - k, cy - 18, col.bad, { align: 'center', size: 10, mono: true });
        label(ctx, c.W < 560 ? 'PM 90°' : 'PM 90°, never near −1', x0 + 6, y0 + h - 16, col.accent, { size: 10 });
      });
      // Both loops together: the closed-loop poles.
      var x0 = 12 + 2 * (w + gap), y0 = 22, cx = x0 + w * 0.62, cy = y0 + h / 2, ev = MC.satEig(st.d1, st.d2);
      var R = 4, k = Math.min(w, h) / 2 / R;
      label(ctx, c.W < 560 ? 'Both: poles' : 'Both loops: closed-loop poles', x0, 4, col.text, { size: 11 });
      ctx.strokeStyle = col.border; ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
      ctx.fillStyle = withAlpha(col.bad, 0.08); ctx.fillRect(cx, y0, x0 + w - cx, h);
      ctx.beginPath(); ctx.moveTo(x0, cy); ctx.lineTo(x0 + w, cy); ctx.moveTo(cx, y0); ctx.lineTo(cx, y0 + h); ctx.stroke();
      ev.forEach(function (z) {
        var px = clamp(cx + z[0] * k, x0 + 6, x0 + w - 6), py = clamp(cy - z[1] * k, y0 + 6, y0 + h - 6);
        ctx.fillStyle = z[0] < 0 ? col.accent : col.bad; ctx.beginPath(); ctx.arc(px, py, 6, 0, 7); ctx.fill();
      });
      label(ctx, 'grows', x0 + w - 4, y0 + 4, col.bad, { align: 'right', size: 10 });
      var right = c.W < 560 ? (ev[0][0] >= 0 ? 'Unstable' : 'Stable') : ev[0][0] >= 0 ? 'A pole crossed over: unstable' : 'Both poles left: stable';
      label(ctx, right, x0 + 6, y0 + h - 16, ev[0][0] >= 0 ? col.bad : col.accent, { size: 10 });
    }

    return { sec: 'sec-mimo', frame: function (dt) { step(dt); drawSat(); drawTime(); drawLoops(); } };
  })();

  /* ---- One animation loop; only the visible tab works ---- */
  var demos = [cbf, ver, mimo].filter(Boolean), last = null;
  function frame(ts) {
    var dt = last === null ? 1 / 60 : Math.min(0.05, (ts - last) / 1000);
    last = ts;
    readColors();
    demos.forEach(function (d) { if (isActive(d.sec)) d.frame(dt); });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
