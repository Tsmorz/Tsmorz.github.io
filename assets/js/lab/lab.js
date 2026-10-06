// lab.js — the one engine behind every template page. A page is a data file
// (_data/labs/<page>.yml) rendered by _includes/lab.html: a list of labs (plant +
// controller + settings) and a list of tabs, each naming a lab, which view goes in each of
// the three canvas slots (top, row1, row2), and which controls the side panel gets.
// Labs can be shared between tabs (the design page walks one lab through six steps).
//
// Views:    sim, time, states, contrib, analysis (toggle of bode | nyquist | poles), step, cbf,
//           verify-map, verify-proof, mimo, sysid-replay, sysid-data, sysid-bode, checklist,
//           id-replay, id-step, id-freq, id-grey, id-result, id-compare, id-validate
// Controls: mode, hint, freq, view, channel, reference, gains, controller, delay, noise, limit,
//           margins, cbf, verify, mimo, sysid, idrun, requirements, score, reset, restart
// All maths is in LabCore (lab-core.js); plants and their pictures in LabPlants.
(function () {
  'use strict';
  if (typeof document === 'undefined') return;
  var C = window.LabCore, PL = window.LabPlants;
  // ctx.roundRect for older Safari / Firefox (the flight renderer uses it).
  if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
      var rad = Math.min(r, Math.min(w, h) / 2);
      this.moveTo(x + rad, y); this.arcTo(x + w, y, x + w, y + h, rad); this.arcTo(x + w, y + h, x, y + h, rad);
      this.arcTo(x, y + h, x, y, rad); this.arcTo(x, y, x + w, y, rad); this.closePath();
    };
  }
  var cfgEl = document.getElementById('lab-config');
  if (!cfgEl) return;
  var CFG = JSON.parse(cfgEl.textContent);

  /* ================= helpers ================= */
  var clamp = C.clamp;
  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function withAlpha(c, a) { var m = /^#([0-9a-f]{6})$/i.exec(c); if (!m) return c; var n = parseInt(m[1], 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; }
  function hexRgb(c) { var m = /^#([0-9a-f]{6})$/i.exec(c); if (!m) return [128, 128, 128]; var n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  function mix(a, b, t) { return [0, 1, 2].map(function (i) { return Math.round(a[i] + (b[i] - a[i]) * t); }); }
  function fmt(v, d) { var s = v.toFixed(d); return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s; }
  function fmtW(w) { return w < 1 ? fmt(w, 2) : w < 10 ? fmt(w, 1) : fmt(w, 0); }
  function fmtG(v) { var a = Math.abs(v); return a >= 100 ? fmt(v, 0) : a >= 10 ? fmt(v, 1) : fmt(v, 2); }
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var col = {};
  function readColors() {
    var m = { text: '--text', muted: '--text-muted', border: '--border', borderStrong: '--border-strong', accent: '--accent',
      bgSoft: '--bg-soft', bg: '--bg', viz1: '--viz-1', viz2: '--viz-2', viz3: '--viz-3', viz4: '--viz-4',
      bad: '--nn-act-neg', zero: '--nn-act-zero', pos: '--nn-act-pos', mono: '--mono', font: '--font' };
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
  function wrapText(ctx, s, x, y, maxW, color, o) {
    o = o || {}; ctx.font = (o.w || '400') + ' ' + (o.size || 12) + 'px ' + col.font;
    ctx.fillStyle = color || col.text; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    var words = s.split(' '), line = '', lh = (o.size || 12) + 4;
    words.forEach(function (w) { var t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { ctx.fillText(line, x, y); y += lh; line = w; } else line = t; });
    if (line) { ctx.fillText(line, x, y); y += lh; }
    return y;
  }
  function cross(ctx, x, y, r, c, lw) { ctx.strokeStyle = c; ctx.lineWidth = lw || 2; ctx.beginPath(); ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.stroke(); }
  function dot(ctx, x, y, c) { ctx.fillStyle = c || col.viz2; ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fill(); ctx.strokeStyle = col.bg; ctx.lineWidth = 2; ctx.stroke(); }
  function tag(ctx, s, x, y, c, align) {
    ctx.font = '600 11px ' + col.mono; var tw = ctx.measureText(s).width, bx = align === 'right' ? x - tw - 10 : x;
    ctx.fillStyle = withAlpha(c, 0.16); ctx.strokeStyle = c; ctx.lineWidth = 1;
    ctx.beginPath(); (ctx.roundRect ? ctx.roundRect(bx, y - 8.5, tw + 10, 17, 4) : ctx.rect(bx, y - 8.5, tw + 10, 17)); ctx.fill(); ctx.stroke();
    ctx.fillStyle = c; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(s, bx + 5, y + 0.5);
  }
  function push(a, v, cap) { a.push(v); if (a.length > cap) a.shift(); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }

  /* ================= labs ================= */
  var CAP = 600;
  var labs = {};
  Object.keys(CFG.labs).forEach(function (id) {
    var lc = CFG.labs[id], plant = PL[lc.plant];
    var ctrl = JSON.parse(JSON.stringify(plant.controllers[lc.controller]));
    (lc.gains || []).forEach(function (g, ci) { if (g) Object.assign(ctrl.channels[ci].gains, g); });
    var lab = {
      id: id, plant: plant, controller: ctrl,
      p: Object.assign({}, plant.params, lc.params || {}),            // the plant the sim runs
      pm: Object.assign({}, plant.params, lc.model || {}),            // the model the analysis uses
      gains: ctrl.channels.map(function (ch) { return Object.assign({}, ch.gains); }),
      suggested: ctrl.channels.map(function (ch) { return Object.assign({}, ch.gains); }),
      refs: plant.refs.map(function (r, i) { return Object.assign({}, r, (lc.refs || [])[i] || {}); }),
      noise: lc.noise || 0, delay: lc.delay || 0, w: lc.w || 1, scale: ctrl.channels.map(function () { return 1; }),
      shake: lc.shake || null, stops: lc.cbf ? lc.cbf.stops : null,
      cbf: lc.cbf ? { on: lc.cbf.on !== false, input: 0, pos: lc.cbf.pos || 0, vel: lc.cbf.vel || 1, lim: lc.cbf.lim, lambda: lc.cbf.lambda || 2 } : null,
      req: lc.requirements ? Object.assign({}, lc.requirements) : null,
      useNet: false, net: null, wantsNet: !!lc.net, dirty: true, acc: 0, failT: null, hits: 0, cbfFrames: 0, frames: 0,
      sysid: lc.sysid ? Object.assign({ exc: 'chirp', noise: 0.01, T: 20, order: 2 }, lc.sysid) : null,
      ui: [], uiSync: [], manual: false, drag: null, trials: 0, ring: [], best: null, adjusts: 0
    };
    lab.manualInput = function (sim) { return lab.plant.manual ? lab.plant.manual(lab.drag, sim, lab) : null; };
    if (lc.limit) lab.p.Fmax = lc.limit;
    lab.sim = C.createSim(plant, lab);
    lab.hist = { r: [], y: [], u: [], x: [], s: [], c: {} };
    labs[id] = lab;
  });
  // The cart-pole's network controller (the same file /controls/ loads).
  var netLabs = Object.keys(labs).map(function (k) { return labs[k]; }).filter(function (l) { return l.wantsNet; });
  if (netLabs.length && CFG.assets && CFG.assets.net) {
    fetch(CFG.assets.net).then(function (r) { return r.json(); }).then(function (n) { netLabs.forEach(function (l) { l.net = n; l.dirty = true; }); }).catch(function () {});
  }
  function changed(lab) { lab.dirty = true; lab.locus = null; lab.stepCache = null; lab.uiSync.forEach(function (f) { f(); }); }

  /* ---- analysis: the loop as one linear model (LabCore does the work) ---- */
  var GRID = C.logspace(0.01, 100, 500), NYQ = C.logspace(0.003, 300, 700);
  function effGains(lab) {
    if (lab.useNet && lab.net) { var g = C.netGains(lab.net); return [{ kx: g[0], kv: g[1], kth: g[2], kw: g[3] }]; }
    return lab.gains;
  }
  function analyze(lab) {
    if (!lab.dirty && lab.an) return lab.an;
    var plant = lab.plant, an = { ch: [] };
    if (!lab.controller.channels.length) {                         // open loop: G(s) itself
      var lin = C.linearize(plant, lab.pm), o = lab.controller.open, row = lin.A.map(function (_, i) { return i === o.out ? -1 : 0; });
      var model = { A: lin.A, B: lin.B, na: plant.n, chans: [{ input: o.input }] };
      an.open = true; an.model = model; an.K = [row];
      an.ol = C.eig(lin.A); an.cl = an.ol; an.zeros = [];
      var Lf = function (s) { return C.loopAt(model, [row], 0, 0, s); };
      an.ch.push({ L: Lf, fr: C.freqResponse(Lf, GRID), nyq: NYQ.map(function (w) { return Lf([0, w]); }) });
    } else {
      var m = C.loopModel(plant, lab.pm, lab.useNet && lab.net ? { channels: [lab.controller.channels[0]] } : lab.controller);
      var K = m.K(effGains(lab), lab.scale);
      an.model = m; an.K = K;
      lab.controller.channels.forEach(function (ch, ci) {
        var L = function (s) { return C.loopAt(m, K, ci, lab.delay, s); };
        var fr = C.freqResponse(L, GRID);
        an.ch.push({ L: L, fr: fr, mg: C.margins(fr), nyqc: C.nyquistCount(m, K, ci, lab.delay), nyq: NYQ.map(function (w) { return L([0, w]); }) });
      });
      an.stable = an.ch.every(function (c) { return c.nyqc.Z === 0; });
      an.cl = C.eig(C.closedAWithDelay(m, K, lab.delay));
      an.ol = C.eig(m.A);
      var num = C.charPoly(C.closedA(m, K)).map(function (v, i) { return v - C.charPoly(m.A)[i]; });
      an.num = num; an.zeros = lab.controller.channels.length === 1 && num.some(function (v) { return Math.abs(v) > 1e-9; }) ? C.roots(num) : [];
      an.placeable = C.placeable(m) && !(lab.delay > 0) && !lab.useNet;
    }
    lab.an = an; lab.dirty = false;
    return an;
  }

  /* ---- offline step response (on the real plant, with the current settings) ---- */
  function stepResponse(lab, T) {
    if (lab.stepCache) return lab.stepCache;
    var fake = Object.assign({}, lab, { refs: lab.refs.map(function (r, i) { return Object.assign({}, r, { type: 'hold', hold: i === 0 ? 1 : 0 }); }), noise: 0, shake: null });
    var sim = C.createSim(lab.plant, fake, function () { return 0.5; });
    sim.reset(lab.plant.x0(lab.p));
    var n = Math.round(T / lab.plant.dt), y = [], u = [], every = Math.max(1, Math.floor(n / 400)), x0 = lab.plant.x0(lab.p), u0 = lab.plant.u0(lab.p);
    var idx = lab.refs[0].idx, umax = 0, last = 0, os = 0, failed = false;
    for (var k = 0; k <= n; k++) {
      var v = sim.x[idx] - x0[idx];
      if (k % every === 0) { y.push(v); u.push(sim.u[0] - u0[0]); }
      if (Math.abs(v - 1) > 0.02) last = k * lab.plant.dt;
      os = Math.max(os, v - 1); umax = Math.max(umax, Math.abs(sim.u[0] - u0[0]));
      if (!isFinite(v) || Math.abs(v) > 50) { failed = true; break; }
      sim.step();
    }
    lab.stepCache = { y: y, u: u, T: T, overshoot: Math.max(0, os) * 100, settle: failed ? Infinity : last, umax: umax, failed: failed || last > T - 0.5 };
    return lab.stepCache;
  }

  /* ================= views ================= */
  var V = {};

  V.sim = function (c, lab) {
    lab.plant.draw(c.ctx, c.W, c.H, lab.sim, lab, col);
    if (lab.cbf) text(c.ctx, (lab.cbf.on ? 'Safety filter on' : 'Safety filter off') + (lab.sim.cbfActive ? ' · acting' : ''), 14, 50, lab.cbf.on ? col.accent : col.muted, { size: 12 });
  };

  // State history: one lane per state the plant lists, each on its own scale.
  V.states = function (c, lab, tab) {
    var ctx = c.ctx, spec = lab.plant.states, n = spec.length, x0 = 70, x1 = c.W - 10, lh = (c.H - 8) / n;
    var tokens = [col.viz1, col.viz2, col.viz3, col.viz4];
    spec.forEach(function (sp, k) {
      var d = lab.hist.s[k] || [], y0 = 4 + k * lh, y1 = y0 + lh - 4, m = 1e-6;
      d.forEach(function (v) { m = Math.max(m, Math.abs(v)); }); m *= 1.15;
      var Y = function (v) { return (y0 + y1) / 2 - v / m * (y1 - y0) / 2; };
      ctx.strokeStyle = col.border; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, Y(0)); ctx.lineTo(x1, Y(0)); ctx.stroke();
      ctx.strokeStyle = tokens[k % 4]; ctx.lineWidth = 1.8; ctx.beginPath();
      d.forEach(function (v, i) { var x = x0 + (i + CAP - d.length) / (CAP - 1) * (x1 - x0); if (i) ctx.lineTo(x, Y(v)); else ctx.moveTo(x, Y(v)); }); ctx.stroke();
      text(ctx, sp.label, 6, y0 + 2, tokens[k % 4], { size: 11 });
      if (d.length) text(ctx, fmtG(d[d.length - 1]), 6, y0 + 16, col.muted, { size: 10, mono: true, w: '400' });
    });
  };

  // What each term of the controller is contributing (P, I, D, or one per state gain).
  V.contrib = function (c, lab) {
    var ctx = c.ctx, hc = lab.hist.c, keys = Object.keys(hc), x0 = 44, x1 = c.W - 10, y0 = 24, y1 = c.H - 6, m = 1e-6;
    keys.forEach(function (k) { hc[k].forEach(function (v) { m = Math.max(m, Math.abs(v)); }); }); m *= 1.1;
    var Y = function (v) { return (y0 + y1) / 2 - clamp(v / m, -1, 1) * (y1 - y0) / 2; };
    ctx.strokeStyle = col.border; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, Y(0)); ctx.lineTo(x1, Y(0)); ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.stroke();
    text(ctx, '+' + fmtG(m), x0 - 4, y0 - 2, col.muted, { align: 'right', size: 10, mono: true, w: '400' });
    text(ctx, '−' + fmtG(m), x0 - 4, y1 - 10, col.muted, { align: 'right', size: 10, mono: true, w: '400' });
    var names = { p: 'P', i: 'I', d: 'D', total: 'Total', kx: 'k·x', kv: 'k·ẋ', kth: 'k·θ', kw: 'k·θ̇', net: 'Network' };
    var colors = [col.viz1, col.viz2, col.viz3, col.viz4], lx = x0 + 8;
    keys.forEach(function (k, i) {
      var d = hc[k], isT = k === 'total', cc = isT ? cssVar('--viz-total') || col.text : colors[i % 4];
      ctx.strokeStyle = cc; ctx.lineWidth = isT ? 2.4 : 1.6; ctx.beginPath();
      d.forEach(function (v, j) { var x = x0 + (j + CAP - d.length) / (CAP - 1) * (x1 - x0); if (j) ctx.lineTo(x, Y(v)); else ctx.moveTo(x, Y(v)); }); ctx.stroke();
      ctx.font = '600 11px ' + col.font; ctx.fillStyle = cc; ctx.fillRect(lx, 9, 12, 3); ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(names[k] || k, lx + 16, 4);
      lx += 30 + ctx.measureText(names[k] || k).width;
    });
    text(ctx, lab.manual ? 'Manual: no controller output' : lab.plant.contribUnit, x1, 4, col.muted, { align: 'right', size: 11 });
  };

  function timePlot(ctx, x0, y0, x1, y1, series, yr, title) {
    function Y(v) { return y1 - (clamp(v, yr[0], yr[1]) - yr[0]) / (yr[1] - yr[0]) * (y1 - y0); }
    ctx.strokeStyle = col.border; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.lineTo(x1, y1); ctx.stroke();
    if (yr[0] < 0 && yr[1] > 0) { ctx.save(); ctx.strokeStyle = col.border; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(x0, Y(0)); ctx.lineTo(x1, Y(0)); ctx.stroke(); ctx.restore(); }
    text(ctx, fmtG(yr[1]), x0 - 4, y0, col.muted, { align: 'right', size: 10, mono: true, w: '400' });
    text(ctx, fmtG(yr[0]), x0 - 4, y1 - 10, col.muted, { align: 'right', size: 10, mono: true, w: '400' });
    series.forEach(function (s) {
      if (!s.data.length) return;
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 2; ctx.setLineDash(s.dash || []); ctx.beginPath();
      s.data.forEach(function (v, i) { var x = x0 + (i + (s.cap || CAP) - s.data.length) / ((s.cap || CAP) - 1) * (x1 - x0); if (i) ctx.lineTo(x, Y(v)); else ctx.moveTo(x, Y(v)); });
      ctx.stroke(); ctx.setLineDash([]);
    });
    text(ctx, title, x0 + 8, y0, col.text, { size: 11 });
    var lx = x0 + 8;
    series.forEach(function (s) {
      if (!s.name) return; ctx.font = '600 11px ' + col.font; ctx.fillStyle = s.color; ctx.fillRect(lx, y0 + 21, 12, 3);
      ctx.textBaseline = 'top'; ctx.textAlign = 'left'; ctx.fillText(s.name, lx + 16, y0 + 16); lx += 28 + ctx.measureText(s.name).width;
    });
  }
  function range(arrs, minSpan) {
    var lo = Infinity, hi = -Infinity;
    arrs.forEach(function (a) { a.forEach(function (v) { if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }); });
    if (!isFinite(lo)) { lo = -1; hi = 1; }
    var mid = (lo + hi) / 2, span = Math.max(hi - lo, minSpan) * 1.15;
    return [mid - span / 2, mid + span / 2];
  }

  V.time = function (c, lab, tab) {
    var h = lab.hist, chans = tab.channels || [0], top = c.H * 0.6;
    var ys = [], series = [];
    chans.forEach(function (ci, k) {
      var r = lab.refs[ci], name = r.label + ' (' + r.unit + ')';
      if (h.y[ci]) { series.push({ data: h.y[ci], color: [col.viz1, col.viz3][k % 2], name: name }); ys.push(h.y[ci]); }
      if (h.r[ci] && !lab.shake) { series.push({ data: h.r[ci], color: col.accent, dash: [5, 4], width: 1.5, name: k ? null : 'reference' }); ys.push(h.r[ci]); }
    });
    timePlot(c.ctx, 44, 6, c.W - 10, top - 8, series, range(ys, lab.shake ? 0.02 : 0.5), lab.shake ? 'Output while shaking' : 'Output and reference, last ' + (tab.window || 10) + ' s');
    var us = [], ser2 = [];
    (lab.controller.channels.length ? lab.controller.channels : [lab.controller.open]).forEach(function (ch, k) {
      if (!h.u[ch.input]) return;
      ser2.push({ data: h.u[ch.input], color: [col.viz2, col.viz4][k % 2], name: lab.plant.inputNames[ch.input] + ' (' + lab.plant.inputUnits[ch.input] + ')' }); us.push(h.u[ch.input]);
    });
    timePlot(c.ctx, 44, top + 4, c.W - 10, c.H - 8, ser2, range(us, 0.5), 'Actuator (about trim)');
  };

  /* ---- analysis: Bode, Nyquist, poles ---- */
  function logX(x0, x1) { var a = Math.log10(GRID[0]), b = Math.log10(GRID[GRID.length - 1]); return function (w) { return x0 + (Math.log10(w) - a) / (b - a) * (x1 - x0); }; }
  function interp(fr, arr, w) {
    var lw = Math.log10(w);
    for (var i = 0; i < fr.w.length - 1; i++) if (fr.w[i + 1] >= w) { var t = (lw - Math.log10(fr.w[i])) / (Math.log10(fr.w[i + 1]) - Math.log10(fr.w[i])); return arr[i] + (arr[i + 1] - arr[i]) * clamp(t, 0, 1); }
    return arr[arr.length - 1];
  }
  V.bode = function (c, lab, tab) {
    var an = analyze(lab), ch = an.ch[tab.channel || 0], fr = ch.fr, ctx = c.ctx, x0 = 46, x1 = c.W - 10, mid = c.H * 0.5;
    var X = logX(x0, x1), loop = !an.open;
    function panel(y0, y1, vals, step, minSpan, title, refLines) {
      var lo = Infinity, hi = -Infinity; vals.forEach(function (v) { lo = Math.min(lo, v); hi = Math.max(hi, v); });
      lo = Math.max(lo, title === 'Phase (°)' ? -720 : -80); hi = Math.min(hi, title === 'Phase (°)' ? 360 : 80);
      refLines.forEach(function (v) { lo = Math.min(lo, v); hi = Math.max(hi, v); });
      lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step; if (hi - lo < minSpan) hi = lo + minSpan;
      var Y = function (v) { return y1 - (clamp(v, lo - 1e3, hi + 1e3) - lo) / (hi - lo) * (y1 - y0); };
      ctx.strokeStyle = col.border; ctx.lineWidth = 1;
      for (var e = -2; e <= 2; e++) { var x = X(Math.pow(10, e)); ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke(); }
      for (var t = lo; t <= hi + 1e-9; t += (hi - lo > 4 * step ? 2 * step : step)) {
        ctx.beginPath(); ctx.moveTo(x0, Y(t)); ctx.lineTo(x1, Y(t)); ctx.stroke();
        text(ctx, String(t), x0 - 4, Y(t) - 5, col.muted, { align: 'right', size: 10, mono: true, w: '400' });
      }
      ctx.save(); ctx.strokeStyle = col.borderStrong; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.2;
      refLines.forEach(function (v) { ctx.beginPath(); ctx.moveTo(x0, Y(v)); ctx.lineTo(x1, Y(v)); ctx.stroke(); }); ctx.restore();
      ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();
      ctx.strokeStyle = col.viz1; ctx.lineWidth = 2; ctx.beginPath();
      fr.w.forEach(function (w, i) { if (i) ctx.lineTo(X(w), Y(vals[i])); else ctx.moveTo(X(w), Y(vals[i])); }); ctx.stroke(); ctx.restore();
      ctx.fillStyle = withAlpha(col.bg, 0.85); ctx.fillRect(x0 + 3, y0 + 1, ctx.measureText(title).width + 14, 16);
      text(ctx, title, x0 + 8, y0 + 2, col.text, { size: 11 });
      return Y;
    }
    var Ym = panel(4, mid - 4, fr.mag, 20, 40, 'Gain (dB)', loop ? [0] : []);
    var phLines = []; if (loop) for (var n = -1; n >= -2; n--) phLines.push(-180 + 360 * (n + 1));
    var Yp = panel(mid + 4, c.H - 18, fr.ph, 90, 180, 'Phase (°)', loop ? [-180] : []);
    [0.01, 0.1, 1, 10, 100].forEach(function (w) { text(ctx, String(w), X(w), c.H - 14, col.muted, { align: 'center', size: 10, mono: true, w: '400' }); });
    text(ctx, 'ω (rad/s)', x1, c.H - 14, col.muted, { align: 'right', size: 10, mono: true });
    if (loop && an.stable && ch.mg) {
      var mg = ch.mg;
      if (mg.wc) {
        var phc = interp(fr, fr.ph, mg.wc), line = phc - mg.pm;
        ctx.strokeStyle = col.viz3; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(X(mg.wc), Yp(phc)); ctx.lineTo(X(mg.wc), Yp(line)); ctx.stroke();
        tag(ctx, 'PM ' + fmt(mg.pm, 0) + '°', X(mg.wc) + 6, Math.max(Yp(phc), Yp(line)) + 12, col.viz3);
      }
      [[mg.wUp, mg.gmUp], [mg.wDown, mg.gmDown]].forEach(function (g) {
        if (g[0] === null) return;
        ctx.strokeStyle = col.viz4; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(X(g[0]), Ym(-g[1])); ctx.lineTo(X(g[0]), Ym(0)); ctx.stroke();
        tag(ctx, 'GM ' + (g[1] > 0 ? '+' : '') + fmt(g[1], 1) + ' dB', X(g[0]) + 6, Math.min(Ym(-g[1]), Ym(0)) - 4, col.viz4);
      });
    }
    var xw = X(lab.w);
    ctx.save(); ctx.strokeStyle = withAlpha(col.viz2, 0.6); ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(xw, 4); ctx.lineTo(xw, c.H - 18); ctx.stroke(); ctx.restore();
    dot(ctx, xw, Ym(interp(fr, fr.mag, lab.w))); dot(ctx, xw, Yp(interp(fr, fr.ph, lab.w)));
  };

  // A complex plane with equal scales, drawn in box; returns the mapping.
  function plane(ctx, box, reMin, reMax, imMax, grid) {
    var k = Math.min((box.x1 - box.x0) / (reMax - reMin), (box.y1 - box.y0) / (2 * imMax));
    var mx = (box.x0 + box.x1) / 2, my = (box.y0 + box.y1) / 2, cre = (reMin + reMax) / 2;
    var f = { k: k, box: box, X: function (re) { return mx + (re - cre) * k; }, Y: function (im) { return my - im * k; },
      re: function (x) { return cre + (x - mx) / k; }, im: function (y) { return (my - y) / k; } };
    f.inside = function (z) { var x = f.X(z[0]), y = f.Y(z[1]); return x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1; };
    ctx.strokeStyle = col.border; ctx.lineWidth = 1; ctx.strokeRect(box.x0 + 0.5, box.y0 + 0.5, box.x1 - box.x0 - 1, box.y1 - box.y0 - 1);
    var ax = clamp(f.X(0), box.x0, box.x1), ay = clamp(f.Y(0), box.y0, box.y1);
    if (grid) {
      var raw = Math.max(f.re(box.x1) - f.re(box.x0), f.im(box.y0) - f.im(box.y1)) / 6, e = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / e;
      var step = (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * e;
      for (var v = Math.ceil(f.re(box.x0) / step) * step; v <= f.re(box.x1); v += step) {
        if (Math.abs(v) < 1e-9) continue; var x = f.X(v);
        ctx.beginPath(); ctx.moveTo(x, box.y0); ctx.lineTo(x, box.y1); ctx.stroke();
        text(ctx, String(+v.toFixed(6)), x, ay + 3, col.muted, { align: 'center', size: 10, mono: true, w: '400' });
      }
      for (var u = Math.ceil(f.im(box.y1) / step) * step; u <= f.im(box.y0); u += step) {
        if (Math.abs(u) < 1e-9) continue; var y = f.Y(u);
        ctx.beginPath(); ctx.moveTo(box.x0, y); ctx.lineTo(box.x1, y); ctx.stroke();
        text(ctx, +u.toFixed(6) + 'j', ax + 4, y - 5, col.muted, { size: 10, mono: true, w: '400' });
      }
    }
    ctx.strokeStyle = col.muted; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(box.x0, ay); ctx.lineTo(box.x1, ay); ctx.moveTo(ax, box.y0); ctx.lineTo(ax, box.y1); ctx.stroke();
    return f;
  }
  function sideBox(c, top, aspect) {
    var y0 = top + 4, y1 = c.H - 6;
    if (c.W >= 560) { var pw = clamp((y1 - y0) * aspect, c.W * 0.45, c.W * 0.62); return { plot: { x0: 8, x1: 8 + pw, y0: y0, y1: y1 }, notes: { x0: 26 + pw, x1: c.W - 10, y: y0 + 2 } }; }
    return { plot: { x0: 8, x1: c.W - 8, y0: y0, y1: y1 - 64 }, notes: { x0: 10, x1: c.W - 10, y: y1 - 58 } };
  }
  function notes(ctx, nb, items) {
    var y = nb.y;
    items.forEach(function (it) { if (!it) return; y = wrapText(ctx, it[0], nb.x0, y, nb.x1 - nb.x0, it[1] || col.text, { w: it[2] || '600', size: 12 }) + 4; });
  }
  function rho(r) { return r <= 1 ? r : 1 + 0.5 * Math.log10(r); }

  V.nyquist = function (c, lab, tab) {
    var an = analyze(lab), ci = tab.channel || 0, ch = an.ch[ci], ctx = c.ctx;
    var pts = ch.nyq.map(function (L) { var q = rho(C.cabs(L)), a = C.carg(L); return [q * Math.cos(a), q * Math.sin(a)]; }), R = 2;
    pts.forEach(function (q) { R = Math.max(R, Math.hypot(q[0], q[1])); }); R = Math.min(R, 2.6) + 0.15;
    var lay = sideBox(c, 0, 1), f = plane(ctx, lay.plot, -R, R, R, false);
    [[1, '|L| = 1'], [1.5, '10'], [2, '100'], [2.5, '1000']].forEach(function (g) {
      if (g[0] > R) return; ctx.strokeStyle = g[0] === 1 ? col.borderStrong : col.border; ctx.setLineDash(g[0] === 1 ? [5, 4] : [2, 4]);
      ctx.beginPath(); ctx.arc(f.X(0), f.Y(0), g[0] * f.k, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      text(ctx, g[1], f.X(0) + g[0] * f.k * 0.71 + 3, f.Y(0) - g[0] * f.k * 0.71 - 14, col.muted, { size: 10, mono: true, w: '400' });
    });
    ctx.save(); ctx.beginPath(); ctx.rect(lay.plot.x0, lay.plot.y0, lay.plot.x1 - lay.plot.x0, lay.plot.y1 - lay.plot.y0); ctx.clip();
    [[-1, withAlpha(col.viz1, 0.35), [4, 4], 1.5], [1, col.viz1, [], 2.2]].forEach(function (s) {
      ctx.strokeStyle = s[1]; ctx.setLineDash(s[2]); ctx.lineWidth = s[3]; ctx.beginPath();
      pts.forEach(function (q, i) { if (i) ctx.lineTo(f.X(q[0]), f.Y(s[0] * q[1])); else ctx.moveTo(f.X(q[0]), f.Y(s[0] * q[1])); }); ctx.stroke(); ctx.setLineDash([]);
    });
    for (var a = 1; a <= 5; a++) {
      var i = Math.floor(pts.length * a / 6), q0 = pts[i - 2], q1 = pts[i + 2];
      if (!q0 || !q1 || Math.hypot(q1[0] - q0[0], q1[1] - q0[1]) * f.k < 2) continue;
      ctx.save(); ctx.translate(f.X(pts[i][0]), f.Y(pts[i][1])); ctx.rotate(Math.atan2(-(q1[1] - q0[1]), q1[0] - q0[0]));
      ctx.fillStyle = col.viz1; ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-5, -4.5); ctx.lineTo(-5, 4.5); ctx.fill(); ctx.restore();
    }
    if (an.stable && ch.mg && ch.mg.wc) {
      var Lc = ch.L([0, ch.mg.wc]), ac = C.carg(Lc), da = C.wrap180((ac - Math.PI) * 180 / Math.PI) * Math.PI / 180;
      ctx.strokeStyle = col.viz3; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(f.X(0), f.Y(0), f.k, -Math.PI, -(Math.PI + da), da > 0); ctx.stroke();
      var md = Math.PI + da / 2; tag(ctx, 'PM ' + fmt(ch.mg.pm, 0) + '°', f.X(1.3 * Math.cos(md)), f.Y(1.3 * Math.sin(md)), col.viz3, Math.cos(md) < 0 ? 'right' : 'left');
    }
    if (an.stable && ch.mg) [[ch.mg.wUp, ch.mg.gmUp], [ch.mg.wDown, ch.mg.gmDown]].forEach(function (g, gi) {
      if (g[0] === null) return; var r = rho(Math.pow(10, -g[1] / 20));
      ctx.strokeStyle = col.viz4; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(f.X(-r), f.Y(0)); ctx.lineTo(f.X(-1), f.Y(0)); ctx.stroke();
      tag(ctx, 'GM ' + (g[1] > 0 ? '+' : '') + fmt(g[1], 1) + ' dB', f.X(-Math.max(r, 1)) - 6, f.Y(0) + (gi ? -14 : 14), col.viz4, 'right');
    });
    ctx.restore();
    cross(ctx, f.X(-1), f.Y(0), 6, col.bad, 2.5); text(ctx, '−1', f.X(-1), f.Y(0) - 22, col.bad, { align: 'center', size: 11, mono: true });
    var qw = ch.L([0, lab.w]), qq = rho(C.cabs(qw)), qa = C.carg(qw);
    if (f.inside([qq * Math.cos(qa), qq * Math.sin(qa)])) dot(ctx, f.X(qq * Math.cos(qa)), f.Y(qq * Math.sin(qa)));
    var nq = ch.nyqc, N = nq.N;
    var circ = N === 0 ? 'The curve never circles −1.' : 'The curve circles −1 ' + (Math.abs(N) === 1 ? 'once ' : Math.abs(N) + ' times ') + (N > 0 ? 'clockwise.' : 'counterclockwise.');
    notes(ctx, lay.notes, [
      c.W >= 560 ? ['Each point is L(jω): distance from the centre is the gain, angle is the phase. Arrows show ω rising; dashed is negative ω. Gains above 1 are on a log scale.', col.muted, '400'] : null,
      [circ + (nq.P ? ' The open loop has ' + nq.P + ' unstable pole' + (nq.P > 1 ? 's' : '') + ', cancelled only by circling −1 counterclockwise that many times.' : '')],
      ['Unstable closed-loop poles = ' + nq.P + ' + ' + N + ' = ' + nq.Z + (nq.Z === 0 ? ': stable.' : ': unstable.'), nq.Z === 0 ? col.accent : col.bad]
    ]);
  };

  // Poles: open-loop ×, zeros ○, closed-loop ● (drag them: the gains follow), root locus,
  // and, with requirements set, the region of the s-plane that meets them.
  V.poles = function (c, lab, tab, canvas) {
    var an = analyze(lab), ctx = c.ctx, open = an.open;
    if (!open && !lab.locus) {
      lab.locus = [];
      for (var gi = 1; gi <= 60; gi++) { var s = gi / 20; lab.locus.push(C.eig(C.closedAWithDelay(an.model, an.K.map(function (r) { return r.map(function (v) { return v * s; }); }), lab.delay))); }
    }
    var pts = an.ol.concat(an.zeros, an.cl).filter(function (z) { return C.cabs(z) < 25; });
    var reMin = -2, reMax = 1, imMax = open ? 3 : 2;
    pts.forEach(function (z) { reMin = Math.min(reMin, z[0]); reMax = Math.max(reMax, z[0]); imMax = Math.max(imMax, Math.abs(z[1])); });
    var sp = reMax - reMin; reMin -= sp * 0.1; reMax += sp * 0.08; imMax *= 1.18;
    var lay = sideBox(c, 0, (reMax - reMin) / (2 * imMax)), f = plane(ctx, lay.plot, reMin, reMax, imMax, true), b = lay.plot;
    lab.poleView = f;
    var xr = clamp(f.X(0), b.x0, b.x1);
    ctx.fillStyle = withAlpha(col.bad, 0.07); ctx.fillRect(xr, b.y0, b.x1 - xr, b.y1 - b.y0);
    if (b.x1 - xr > 50) text(ctx, 'grows', b.x1 - 6, b.y0 + 4, col.bad, { align: 'right', size: 11 });
    if (xr - b.x0 > 70) text(ctx, 'dies away', b.x0 + 6, b.y0 + 4, col.muted, { size: 11 });
    // requirements region: damping ζ ≥ ζmin (a cone) and σ ≤ −4/Ts (a line)
    var req = lab.req;
    if (req) {
      var os = Math.max(req.overshoot, 0.1) / 100, zeta = -Math.log(os) / Math.sqrt(Math.PI * Math.PI + Math.log(os) * Math.log(os));
      var sig = -4 / req.settle, slope = Math.sqrt(1 - zeta * zeta) / zeta;
      ctx.save(); ctx.beginPath(); ctx.rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); ctx.clip();
      ctx.fillStyle = withAlpha(col.accent, 0.12); ctx.beginPath();
      var far = f.re(b.x0) - 1;
      ctx.moveTo(f.X(sig), f.Y(-sig * slope)); ctx.lineTo(f.X(far), f.Y(-far * slope)); ctx.lineTo(f.X(far), f.Y(far * slope)); ctx.lineTo(f.X(sig), f.Y(sig * slope)); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = col.accent; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore();
      text(ctx, 'meets the specs', f.X(sig) - 6, Math.max(b.y0 + 4, f.Y(0) + 6), col.accent, { align: 'right', size: 10 });
    }
    ctx.save(); ctx.beginPath(); ctx.rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); ctx.clip();
    if (lab.locus) { ctx.fillStyle = withAlpha(col.accent, 0.3); lab.locus.forEach(function (rs) { rs.forEach(function (z) { ctx.beginPath(); ctx.arc(f.X(z[0]), f.Y(z[1]), 1.6, 0, 7); ctx.fill(); }); }); }
    an.ol.forEach(function (z) { cross(ctx, f.X(z[0]), f.Y(z[1]), 6, open ? col.viz2 : col.muted, 2.2); });
    an.zeros.forEach(function (z) { ctx.strokeStyle = col.muted; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(f.X(z[0]), f.Y(z[1]), 6, 0, 7); ctx.stroke(); });
    if (open) {          // the jω point and the distances that make the gain
      var py = f.Y(lab.w), px = f.X(0), dists = [];
      an.ol.forEach(function (z, i) {
        dists.push(Math.hypot(z[0], lab.w - z[1]));
        ctx.strokeStyle = col.viz2; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(f.X(z[0]), f.Y(z[1])); ctx.lineTo(px, py); ctx.stroke(); ctx.setLineDash([]);
      });
      dot(ctx, px, Math.max(py, b.y0 + 5));
      text(ctx, 'jω', px + 8, Math.max(py, b.y0 + 5) - 6, col.viz2, { size: 11, mono: true });
    } else {
      an.cl.forEach(function (z) { if (!f.inside(z)) return; ctx.fillStyle = z[0] < -1e-6 ? col.accent : col.bad; ctx.beginPath(); ctx.arc(f.X(z[0]), f.Y(z[1]), 6.5, 0, 7); ctx.fill(); ctx.strokeStyle = col.bg; ctx.lineWidth = 1.5; ctx.stroke(); });
    }
    ctx.restore();
    var items = [];
    if (open) {
      var g = 1 / dists.reduce(function (a, d) { return a * d; }, 1) / lab.pm.M;
      items.push(['G(s) = 1 / (' + C.polyStr([lab.pm.M, lab.pm.c, lab.pm.k]) + ')', col.text]);
      items.push(['The × are the plant\'s own motions. Drag one to change the spring and damper.', col.muted, '400']);
      items.push(['Gain at jω = 1 / (m·d₁·d₂) = ' + fmt(g, g < 0.01 ? 4 : 3) + '. As jω slides past a pole the distance shrinks and the gain peaks: resonance.', col.viz2]);
    } else {
      var slow = null; an.cl.forEach(function (z) { if (!slow || z[0] > slow[0]) slow = z; });
      items.push(['1 + L(s) = 0  ⇒  ' + C.polyStr(C.charPoly(C.closedAWithDelay(an.model, an.K, lab.delay))) + ' = 0', col.text, '400']);
      items.push(an.placeable ? ['Drag a closed-loop pole ●: the gains are solved so the poles land where you put them.', col.viz2]
        : [lab.delay > 0 ? 'Delay on: poles use a Padé approximation and can\'t be dragged.' : 'More gains than one input can place: drag the gain sliders.', col.muted, '400']);
      if (slow) items.push(slow[0] >= -1e-6 ? ['A pole in the right half-plane: the response grows like e^(' + fmt(slow[0], 2) + 't).', col.bad]
        : ['Slowest pole σ = ' + fmt(slow[0], 2) + ': settles in about ' + fmt(4 / -slow[0], 4 / -slow[0] < 10 ? 1 : 0) + ' s' + (Math.abs(slow[1]) > 0.05 ? ', ringing at ' + fmt(Math.abs(slow[1]), 1) + ' rad/s.' : '.'), col.accent]);
      if (c.W >= 560) items.push(['Faint trail: the root locus, every gain scaled 0–3×.', col.muted, '400']);
    }
    notes(ctx, lay.notes, items);
  };

  // Dragging poles on the Poles view.
  function bindPoleDrag(canvas, lab) {
    var drag = null;
    function pos(e) { var r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    canvas.addEventListener('pointerdown', function (e) {
      var an = analyze(lab), f = lab.poleView; if (!f) return;
      var p = pos(e), list = an.open ? an.ol : an.cl, best = -1, bd = 14;
      if (!an.open && !an.placeable) return;
      list.forEach(function (z, i) { var d = Math.hypot(f.X(z[0]) - p[0], f.Y(z[1]) - p[1]); if (d < bd) { bd = d; best = i; } });
      if (best < 0) return;
      drag = { i: best, real: Math.abs(list[best][1]) < 1e-6, start: list.map(function (z) { return z.slice(); }) };
      canvas.setPointerCapture(e.pointerId); e.preventDefault();
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var f = lab.poleView, p = pos(e), re = Math.min(f.re(p[0]), 3), im = drag.real ? 0 : Math.max(Math.abs(f.im(p[1])), 0.05);
      var src = drag.start[drag.i], poles = drag.start.map(function (z) { return z.slice(); });
      poles.forEach(function (z) {
        if (Math.abs(z[0] - src[0]) < 1e-9 && Math.abs(Math.abs(z[1]) - Math.abs(src[1])) < 1e-9) { z[0] = re; z[1] = drag.real ? 0 : (z[1] >= 0 ? im : -im); }
      });
      if (analyze(lab).open) { if (lab.plant.setPoles) { lab.plant.setPoles(lab.pm, re, im || 0.05); Object.assign(lab.p, lab.pm); } }
      else {
        var g = C.placePoles(analyze(lab).model, poles);
        if (!g || !Object.keys(g).every(function (k) { return isFinite(g[k]); })) return;
        Object.assign(lab.gains[0], g);
      }
      changed(lab);
    });
    function up() { drag = null; }
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  }

  V.analysis = function (c, lab, tab, canvas) { (V[tab.view] || V.bode)(c, lab, tab, canvas); };

  /* ---- step response with requirement envelope ---- */
  V.step = function (c, lab, tab) {
    var T = tab.stepT || 12, s = stepResponse(lab, T), ctx = c.ctx, x0 = 44, x1 = c.W - 10, y0 = 22, y1 = c.H - 20;
    var lo = Math.min(-0.2, Math.min.apply(null, s.y)), hi = Math.max(1.6, Math.max.apply(null, s.y.filter(isFinite)));
    hi = Math.min(hi, 3); lo = Math.max(lo, -1.5);
    function X(i) { return x0 + i / (s.y.length - 1) * (x1 - x0) * (s.failed && s.y.length < 400 ? s.y.length / 401 : 1); }
    function Y(v) { return y1 - (clamp(v, lo, hi) - lo) / (hi - lo) * (y1 - y0); }
    ctx.strokeStyle = col.border; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.lineTo(x1, y1); ctx.stroke();
    if (lab.req) {
      var r = lab.req, xs = x0 + Math.min(r.settle / T, 1) * (x1 - x0);
      ctx.fillStyle = withAlpha(col.bad, 0.08);
      ctx.fillRect(x0, y0, x1 - x0, Y(1 + r.overshoot / 100) - y0);
      ctx.fillRect(xs, Y(1.02 + 0.0001) - (Y(1.02) - Y(1.02)), x1 - xs, 0);
      ctx.fillRect(xs, y0, x1 - xs, Y(1.02) - y0); ctx.fillRect(xs, Y(0.98), x1 - xs, y1 - Y(0.98));
      ctx.save(); ctx.strokeStyle = col.accent; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(x0, Y(1 + r.overshoot / 100)); ctx.lineTo(x1, Y(1 + r.overshoot / 100)); ctx.moveTo(xs, y0); ctx.lineTo(xs, y1); ctx.stroke(); ctx.restore();
      text(ctx, 'overshoot limit', x1 - 4, Y(1 + r.overshoot / 100) - 14, col.accent, { align: 'right', size: 10 });
      text(ctx, 'settled by ' + fmt(r.settle, 1) + ' s', xs + 4, y1 - 14, col.accent, { size: 10 });
    }
    ctx.save(); ctx.strokeStyle = col.muted; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(x0, Y(1)); ctx.lineTo(x1, Y(1)); ctx.stroke(); ctx.restore();
    ctx.strokeStyle = s.failed ? col.bad : col.viz1; ctx.lineWidth = 2.2; ctx.beginPath();
    s.y.forEach(function (v, i) { if (i) ctx.lineTo(X(i), Y(v)); else ctx.moveTo(X(i), Y(v)); }); ctx.stroke();
    text(ctx, (tab.stepTitle || 'Step response on the real plant') + ': overshoot ' + fmt(s.overshoot, 0) + '%, settles ' + (isFinite(s.settle) ? fmt(s.settle, 1) + ' s' : 'never'), x0 + 6, 4, s.failed ? col.bad : col.text, { size: 11 });
    text(ctx, '0', x0 - 4, Y(0) - 5, col.muted, { align: 'right', size: 10, mono: true, w: '400' }); text(ctx, '1', x0 - 4, Y(1) - 5, col.muted, { align: 'right', size: 10, mono: true, w: '400' });
    text(ctx, T + ' s', x1, y1 + 3, col.muted, { align: 'right', size: 10, mono: true, w: '400' });
  };

  /* ---- safety filter: the phase plane and the allowed input ---- */
  V.cbf = function (c, lab) {
    var ctx = c.ctx, cb = lab.cbf, h = lab.hist, narrow = c.W < 560, w = narrow ? c.W - 16 : c.W * 0.6;
    var box = { x0: 40, x1: 8 + w, y0: 20, y1: c.H - 22 }, P = cb.lim * 1.6, Vm = Math.max(3, cb.lambda * cb.lim * 1.4);
    function X(v) { return box.x0 + (v + P) / (2 * P) * (box.x1 - box.x0); }
    function Y(v) { return box.y1 - (v + Vm) / (2 * Vm) * (box.y1 - box.y0); }
    text(ctx, 'Phase plane: position vs velocity', box.x0, 2, col.text, { size: 11 });
    ctx.fillStyle = withAlpha(col.bad, 0.1); ctx.fillRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
    ctx.fillStyle = withAlpha(col.accent, 0.16); ctx.beginPath();     // safe set: |x| ≤ lim, λ(lim − x) ≥ v ≥ −λ(lim + x)
    ctx.moveTo(X(-cb.lim), Y(0)); ctx.lineTo(X(-cb.lim), Y(Math.min(Vm, 2 * cb.lambda * cb.lim)));
    ctx.lineTo(X(cb.lim), Y(0)); ctx.lineTo(X(cb.lim), Y(-Math.min(Vm, 2 * cb.lambda * cb.lim))); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = col.accent; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.strokeStyle = col.bad; ctx.lineWidth = 2.5; [-1, 1].forEach(function (s) { ctx.beginPath(); ctx.moveTo(X(s * lab.stops), box.y0); ctx.lineTo(X(s * lab.stops), box.y1); ctx.stroke(); });
    ctx.strokeStyle = col.border; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(box.x0, Y(0)); ctx.lineTo(box.x1, Y(0)); ctx.moveTo(X(0), box.y0); ctx.lineTo(X(0), box.y1); ctx.stroke();
    var px = h.x[cb.pos] || [], pv = h.x[cb.vel] || [];
    ctx.save(); ctx.beginPath(); ctx.rect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0); ctx.clip();
    for (var i = 1; i < px.length; i++) { ctx.strokeStyle = withAlpha(col.viz2, 0.15 + 0.85 * i / px.length); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(X(px[i - 1]), Y(pv[i - 1])); ctx.lineTo(X(px[i]), Y(pv[i])); ctx.stroke(); }
    ctx.restore();
    if (px.length) dot(ctx, X(px[px.length - 1]), Y(clamp(pv[pv.length - 1], -Vm, Vm)), col.text);
    text(ctx, 'hard stop', X(lab.stops) - 4, box.y0 + 2, col.bad, { align: 'right', size: 10 });
    text(ctx, 'position (m)', box.x1, box.y1 + 4, col.muted, { align: 'right', size: 10, mono: true });
    text(ctx, 'safe set', X(0) + 4, Y(0) + 4, col.accent, { size: 10 });
    if (narrow) return;
    // the input: requested vs the interval the filter allows
    var bx0 = box.x1 + 30, bx1 = c.W - 12, Fm = 40, by = c.H * 0.42;
    function FX(F) { return bx0 + (clamp(F, -Fm, Fm) + Fm) / (2 * Fm) * (bx1 - bx0); }
    text(ctx, 'Force: requested vs allowed', bx0, 2, col.text, { size: 11 });
    var bd = lab.sim.cbfBounds;
    ctx.fillStyle = withAlpha(col.bad, 0.12); ctx.fillRect(bx0, by - 12, bx1 - bx0, 24);
    if (bd && cb.on) { ctx.fillStyle = withAlpha(col.accent, 0.3); ctx.fillRect(FX(bd[0]), by - 12, FX(bd[1]) - FX(bd[0]), 24); }
    else { ctx.fillStyle = withAlpha(col.accent, 0.3); ctx.fillRect(bx0, by - 12, bx1 - bx0, 24); }
    ctx.strokeStyle = col.border; ctx.strokeRect(bx0, by - 12, bx1 - bx0, 24);
    var req = lab.sim.uReq ? lab.sim.uReq[cb.input] : 0, sent = lab.sim.u[cb.input];
    ctx.strokeStyle = col.viz1; ctx.lineWidth = 3; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(FX(req), by - 22); ctx.lineTo(FX(req), by + 22); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = col.viz2; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(FX(sent), by - 22); ctx.lineTo(FX(sent), by + 22); ctx.stroke();
    text(ctx, 'requested', FX(req), by - 38, col.viz1, { align: 'center', size: 10 }); text(ctx, 'sent', FX(sent), by + 26, col.viz2, { align: 'center', size: 10 });
    text(ctx, '−' + Fm + ' N', bx0, by + 44, col.muted, { size: 10, mono: true, w: '400' }); text(ctx, '+' + Fm + ' N', bx1, by + 44, col.muted, { align: 'right', size: 10, mono: true, w: '400' });
    wrapText(ctx, 'Teal: forces that keep ḣ ≥ −αh (here written ḧ + 2λḣ + λ²h ≥ 0, since force sets acceleration). The filter sends the allowed force nearest the request.', bx0, by + 62, bx1 - bx0, col.muted, { size: 11 });
  };

  /* ---- verifying the cart-pole's network ---- */
  var TH = 0.5, TD = 1.5;
  function verifyState(lab) {
    var v = lab.verify;
    if (v.follow) { var x = lab.sim.x, r = C.refValue(lab.refs[0], lab.sim.t); v.e = [x[0] - r, x[1], clamp(x[2], -TH, TH), clamp(x[3], -TD, TD)]; }
    return v.e;
  }
  function verifyQuery(lab) {
    var v = lab.verify, e = verifyState(lab), key = e.map(function (a) { return a.toFixed(3); }).join() + v.eps + v.delta + v.depth;
    if (v.q && v.qKey === key) return v.q;
    var cert = C.certify(lab.net, e, v.eps, v.depth), cert0 = v.depth ? C.certify(lab.net, e, v.eps, 0) : cert, att = C.attack(lab.net, e, v.eps), widths = [], b = C.queryBox(e, v.eps);
    C.netBounds(lab.net, b.lo, b.hi, widths);
    v.q = { e: e, cert: cert, cert0: cert0, att: att, widths: widths, verdict: cert.dev <= v.delta ? 'proved' : att.dev > v.delta ? 'disproved' : 'unknown' };
    v.qKey = key; return v.q;
  }
  V['verify-map'] = function (c, lab, tab, canvas) {
    var ctx = c.ctx, v = lab.verify;
    if (!lab.net) { text(ctx, 'Loading the network…', 12, 12, col.muted); return; }
    var narrow = c.W < 560, gap = 46, w = narrow ? c.W - 50 : (c.W - 50 - gap) / 2;
    var boxes = [{ x0: 40, y0: 20, x1: 40 + w, y1: c.H - 22 }];
    if (!narrow) boxes.push({ x0: 40 + w + gap, y0: 20, x1: c.W - 10, y1: c.H - 22 });
    v.boxes = boxes;
    if (!v.heat || v.heatTheme !== col.pos) {
      var HW = 90, HH = 54, img = new ImageData(HW, HH), neg = hexRgb(col.bad), zer = hexRgb(col.zero), pos = hexRgb(col.pos);
      for (var j = 0; j < HH; j++) for (var i = 0; i < HW; i++) {
        var F = C.netForward(lab.net, [0, 0, -TH + 2 * TH * (i + 0.5) / HW, TD - 2 * TD * (j + 0.5) / HH]) / lab.net.force_max;
        var cc = F < 0 ? mix(zer, neg, Math.min(1, -F)) : mix(zer, pos, Math.min(1, F)), o = 4 * (j * HW + i);
        img.data[o] = cc[0]; img.data[o + 1] = cc[1]; img.data[o + 2] = cc[2]; img.data[o + 3] = 255;
      }
      var cv = document.createElement('canvas'); cv.width = HW; cv.height = HH; cv.getContext('2d').putImageData(img, 0, 0); v.heat = cv; v.heatTheme = col.pos;
    }
    // certified-radius map, a slice per frame
    var RW = 30, RH = 18;
    if (!v.rad || v.radKey !== v.delta + ':' + v.depth) { v.rad = new Float32Array(RW * RH).fill(NaN); v.radI = 0; v.radKey = v.delta + ':' + v.depth; }
    var t0 = performance.now();
    while (v.radI < RW * RH && performance.now() - t0 < 6) {
      var ri = v.radI % RW, rj = Math.floor(v.radI / RW);
      v.rad[v.radI] = C.certifiedRadius(lab.net, [0, 0, -TH + 2 * TH * (ri + 0.5) / RW, TD - 2 * TD * (rj + 0.5) / RH], v.delta, v.depth, 0.1); v.radI++;
    }
    var q = verifyQuery(lab), vc = q.verdict === 'proved' ? col.accent : q.verdict === 'disproved' ? col.bad : col.text;
    boxes.forEach(function (b, bi) {
      ctx.save(); ctx.beginPath(); ctx.rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); ctx.clip();
      if (bi === 0) { ctx.imageSmoothingEnabled = true; ctx.drawImage(v.heat, b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); }
      else {
        var cw = (b.x1 - b.x0) / RW, ch = (b.y1 - b.y0) / RH, bad = hexRgb(col.bad), good = hexRgb(col.accent);
        for (var k = 0; k < RW * RH; k++) {
          var r = v.rad[k], t = isNaN(r) ? null : r >= 0.1 ? 1 : r <= 0.0005 ? 0 : Math.log10(r / 0.0005) / Math.log10(200);
          ctx.fillStyle = t === null ? col.bgSoft : 'rgb(' + mix(bad, good, t).join(',') + ')';
          ctx.fillRect(b.x0 + (k % RW) * cw, b.y0 + Math.floor(k / RW) * ch, cw + 0.6, ch + 0.6);
        }
      }
      ctx.restore(); ctx.strokeStyle = col.border; ctx.strokeRect(b.x0 + 0.5, b.y0 + 0.5, b.x1 - b.x0 - 1, b.y1 - b.y0 - 1);
      text(ctx, bi === 0 ? 'The network\'s force over pole angle and rate' : 'Provably steady: certified ε for ±' + fmt(v.delta, 2) + ' N' + (v.radI < RW * RH ? ' (computing…)' : ''), b.x0, 2, col.text, { size: 11 });
      text(ctx, 'θ', (b.x0 + b.x1) / 2, b.y1 + 4, col.muted, { align: 'center', size: 10, mono: true });
      text(ctx, 'rate', b.x0 - 4, (b.y0 + b.y1) / 2 - 6, col.muted, { align: 'right', size: 10, mono: true });
      var X = function (a) { return b.x0 + (a + TH) / (2 * TH) * (b.x1 - b.x0); }, Y = function (a) { return b.y0 + (TD - a) / (2 * TD) * (b.y1 - b.y0); };
      var cx = X(q.e[2]), cy = Y(q.e[3]), hw = Math.max(4, X(q.e[2] + v.eps) - cx), hh = Math.max(4, cy - Y(q.e[3] + C.RATE_PER_ANGLE * v.eps));
      ctx.strokeStyle = col.bg; ctx.lineWidth = 4; ctx.strokeRect(cx - hw, cy - hh, 2 * hw, 2 * hh);
      ctx.strokeStyle = vc; ctx.lineWidth = 2; ctx.strokeRect(cx - hw, cy - hh, 2 * hw, 2 * hh);
    });
  };
  function bindVerifyClick(canvas, lab) {
    canvas.addEventListener('pointerdown', function (e) {
      var v = lab.verify; if (!v || !v.boxes) return;
      var r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      v.boxes.forEach(function (b) {
        if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) return;
        v.follow = false; v.e = [0, 0, -TH + 2 * TH * (x - b.x0) / (b.x1 - b.x0), TD - 2 * TD * (y - b.y0) / (b.y1 - b.y0)];
        lab.uiSync.forEach(function (f) { f(); });
      });
    });
  }
  V['verify-proof'] = function (c, lab) {
    var ctx = c.ctx, v = lab.verify; if (!lab.net) return;
    var q = verifyQuery(lab), narrow = c.W < 560, x0 = 14, x1 = narrow ? c.W - 14 : c.W * 0.62, Fc = q.cert.Fc;
    var span = Math.min(Math.max(q.cert0.dev, q.att.dev, v.delta) * 1.25, 25);
    function X(F) { return (x0 + x1) / 2 + clamp((F - Fc) / span, -1.05, 1.05) * (x1 - x0) / 2; }
    var head = q.verdict === 'proved' ? 'Proved: no error this size moves the force more than ±' + fmt(v.delta, 2) + ' N'
      : q.verdict === 'disproved' ? 'Disproved: an input in the box moves it ' + fmt(q.att.dev, 2) + ' N' : 'Unknown: the proof is too loose. Split the box.';
    text(ctx, head, x0, 2, q.verdict === 'proved' ? col.accent : q.verdict === 'disproved' ? col.bad : col.text, { size: 12 });
    ctx.fillStyle = withAlpha(col.accent, 0.12); ctx.fillRect(X(Fc - v.delta), 24, X(Fc + v.delta) - X(Fc - v.delta), c.H - 46);
    ctx.save(); ctx.strokeStyle = col.accent; ctx.setLineDash([4, 3]); [Fc - v.delta, Fc + v.delta].forEach(function (f) { ctx.beginPath(); ctx.moveTo(X(f), 24); ctx.lineTo(X(f), c.H - 22); ctx.stroke(); }); ctx.restore();
    [[q.cert0, 'Proved, one box', col.viz1, 34, true], [q.cert, 'Proved, ' + q.cert.n * q.cert.n + ' boxes', col.viz1, 62, true, !v.depth], [q.att, 'Found by trying inputs', col.viz2, 90]].forEach(function (r) {
      if (r[5]) return; var a = X(r[0].lo), b = X(r[0].hi);
      ctx.fillStyle = withAlpha(r[2], 0.22); ctx.fillRect(a, r[3], Math.max(2, b - a), 14); ctx.strokeStyle = r[2]; ctx.lineWidth = 1.5; ctx.strokeRect(a, r[3], Math.max(2, b - a), 14);
      ctx.font = '600 11px ' + col.font; var tw = ctx.measureText(r[1]).width;
      if (b + 6 + tw < x1) text(ctx, r[1], b + 6, r[3] + 1, r[2], { size: 11 }); else if (a - 6 - tw > x0) text(ctx, r[1], a - 6, r[3] + 1, r[2], { size: 11, align: 'right' }); else text(ctx, r[1], x0, r[3] - 13, r[2], { size: 11 });
    });
    ctx.strokeStyle = col.text; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(X(Fc), 22); ctx.lineTo(X(Fc), c.H - 18); ctx.stroke();
    text(ctx, 'force at the state ' + fmt(Fc, 2) + ' N', X(Fc), c.H - 15, col.text, { align: 'center', size: 10, mono: true });
    if (narrow) return;
    // the box, split, and the bound's width layer by layer
    var side = Math.min(c.H - 40, 110), bx = x1 + 24, by = 22, n = q.cert.n, cell = side / n;
    text(ctx, 'The box, split', bx, 2, col.text, { size: 11 });
    q.cert.pieces.forEach(function (p) {
      var dev = Math.max(p.F[1] - Fc, Fc - p.F[0]);
      ctx.fillStyle = dev <= v.delta ? withAlpha(col.accent, 0.55) : withAlpha(col.muted, 0.25);
      ctx.fillRect(bx + p.i * cell, by + (n - 1 - p.j) * cell, cell, cell); ctx.strokeStyle = col.bg; ctx.strokeRect(bx + p.i * cell + 0.5, by + (n - 1 - p.j) * cell + 0.5, cell - 1, cell - 1);
    });
    ctx.strokeStyle = col.text; ctx.strokeRect(bx, by, side, side);
    var gx = bx + side + 16, gw = c.W - 10 - gx;
    if (gw > 80) {
      text(ctx, 'Proof width by layer', gx, 2, col.text, { size: 11 });
      var base = q.widths[0] || 1e-9, names = ['in', 'L1', 'L2', 'out', 'F'], bw = gw / q.widths.length, gy1 = by + side;
      q.widths.forEach(function (wd, i) {
        var hgt = clamp(Math.log10(Math.max(wd / base, 1e-3)) + 1, 0, 6) / 6 * side;
        ctx.fillStyle = withAlpha(col.viz1, i === q.widths.length - 1 ? 0.9 : 0.55); ctx.fillRect(gx + i * bw + 3, gy1 - hgt, bw - 6, hgt);
        text(ctx, names[i] || '', gx + i * bw + bw / 2, gy1 + 3, col.muted, { align: 'center', size: 9, w: '400' });
      });
    }
  };

  /* ---- two loops at once: gain errors in each channel ---- */
  V.mimo = function (c, lab, tab, canvas) {
    var ctx = c.ctx, mm = lab.mimo, D = mm.range, N = 48, narrow = c.W < 560;
    if (!mm.map) { mm.map = new Int8Array(N * N).fill(-1); mm.i = 0; }
    var an = analyze(lab), model = an.model, G = effGains(lab), t0 = performance.now();
    while (mm.i < N * N && performance.now() - t0 < 6) {
      var i = mm.i % N, j = Math.floor(mm.i / N), d1 = D[0] + (D[1] - D[0]) * (i + 0.5) / N, d2 = D[1] - (D[1] - D[0]) * (j + 0.5) / N;
      mm.map[mm.i] = C.eig(C.closedA(model, model.K(G, [1 + d1, 1 + d2]))).every(function (z) { return z[0] < 1e-6; }) ? 1 : 0; mm.i++;
    }
    var side = Math.min(c.H - 40, narrow ? c.W - 60 : c.W * 0.45), bx = 44, by = 20, cell = side / N, good = hexRgb(col.accent), bad = hexRgb(col.bad), bg = hexRgb(col.bg);
    mm.box = { x0: bx, y0: by, x1: bx + side, y1: by + side };
    for (var k = 0; k < N * N; k++) {
      var v = mm.map[k]; ctx.fillStyle = v < 0 ? col.bgSoft : 'rgb(' + (v ? mix(bg, good, 0.25) : mix(bg, bad, 0.4)).join(',') + ')';
      ctx.fillRect(bx + (k % N) * cell, by + Math.floor(k / N) * cell, cell + 0.6, cell + 0.6);
    }
    function MX(d) { return bx + (d - D[0]) / (D[1] - D[0]) * side; } function MY(d) { return by + (D[1] - d) / (D[1] - D[0]) * side; }
    ctx.strokeStyle = col.border; ctx.strokeRect(bx + 0.5, by + 0.5, side - 1, side - 1);
    // single-loop predictions: each loop's own gain margins, as a rectangle
    var m1 = an.ch[0].mg, m2 = an.ch[1].mg;
    var r = [m1.gmDown !== null ? Math.pow(10, m1.gmDown / 20) - 1 : -1, m1.gmUp !== null ? Math.pow(10, m1.gmUp / 20) - 1 : D[1],
             m2.gmDown !== null ? Math.pow(10, m2.gmDown / 20) - 1 : -1, m2.gmUp !== null ? Math.pow(10, m2.gmUp / 20) - 1 : D[1]];
    ctx.save(); ctx.strokeStyle = col.text; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5;
    ctx.strokeRect(MX(Math.max(r[0], D[0])), MY(Math.min(r[3], D[1])), MX(Math.min(r[1], D[1])) - MX(Math.max(r[0], D[0])), MY(Math.max(r[2], D[0])) - MY(Math.min(r[3], D[1]))); ctx.restore();
    ctx.strokeStyle = col.muted; ctx.beginPath(); ctx.moveTo(MX(0), by); ctx.lineTo(MX(0), by + side); ctx.moveTo(bx, MY(0)); ctx.lineTo(bx + side, MY(0)); ctx.stroke();
    dot(ctx, MX(lab.scale[0] - 1), MY(lab.scale[1] - 1), an.stable ? col.accent : col.bad);
    text(ctx, 'Stable gain errors (drag the dot)', bx, 2, col.text, { size: 11 });
    text(ctx, mm.labels[0] + ' gain error →', bx + side, by + side + 4, col.muted, { align: 'right', size: 10 });
    text(ctx, fmt(D[0] * 100, 0) + '%', bx, by + side + 4, col.muted, { size: 10, mono: true, w: '400' });
    ctx.save(); ctx.translate(bx - 30, by + side); ctx.rotate(-Math.PI / 2); text(ctx, mm.labels[1] + ' gain error →', 0, 0, col.muted, { size: 10 }); ctx.restore();
    if (narrow) return;
    notes(ctx, { x0: bx + side + 22, x1: c.W - 10, y: by }, [
      ['Dashed box: what the two loops\' own gain margins predict, each checked alone (break one loop, keep the other closed).', col.muted, '400'],
      ['Coloured map: the truth, every pair of gain errors checked together.', col.muted, '400'],
      [mm.note || 'Where they agree, one-loop-at-a-time analysis is enough. Where the map is smaller than the box, the loops interact and single-loop margins overstate the safety.', col.text]
    ]);
  };
  function bindMimoDrag(canvas, lab) {
    var down = false;
    function set(e) {
      var b = lab.mimo.box; if (!b) return; var r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, D = lab.mimo.range;
      if (x < b.x0 - 10 || x > b.x1 + 10 || y < b.y0 - 10 || y > b.y1 + 10) return;
      lab.scale[0] = 1 + clamp(D[0] + (x - b.x0) / (b.x1 - b.x0) * (D[1] - D[0]), D[0], D[1]);
      lab.scale[1] = 1 + clamp(D[1] - (y - b.y0) / (b.y1 - b.y0) * (D[1] - D[0]), D[0], D[1]);
      lab.dirty = true; lab.uiSync.forEach(function (f) { f(); });
    }
    canvas.addEventListener('pointerdown', function (e) { down = true; canvas.setPointerCapture(e.pointerId); set(e); });
    canvas.addEventListener('pointermove', function (e) { if (down) set(e); });
    canvas.addEventListener('pointerup', function () { down = false; });
  }

  /* ---- system identification ---- */
  function runSysid(lab) {
    var s = lab.sysid, plant = lab.plant, p = lab.p, dtId = 0.05, n = Math.round(s.T / dtId), sub = Math.round(dtId / plant.dt);
    var seed = 12345; function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
    var x = plant.x0(p), u = [], y = [], yTrue = [], A = s.amp || 2, hold = 0, level = A;
    for (var k = 0; k < n; k++) {
      var t = k * dtId, uk;
      if (s.exc === 'step') uk = t >= 1 ? A : 0;
      else if (s.exc === 'chirp') { var w0 = 0.2, w1 = 10; uk = A * Math.sin(w0 * t + (w1 - w0) * t * t / (2 * s.T)); }
      else { if (hold <= 0) { level = rnd() < 0.5 ? A : -A; hold = 0.2 + rnd() * 0.8; } hold -= dtId; uk = level; }
      u.push(uk); yTrue.push(x[lab.refs[0].idx]); y.push(x[lab.refs[0].idx] + s.noise * C.gaussian(rnd));
      for (var j = 0; j < sub; j++) x = (function (xx) { var k1 = plant.deriv(xx, [uk], p), h = plant.dt, k2 = plant.deriv(xx.map(function (v, i) { return v + k1[i] * h / 2; }), [uk], p), k3 = plant.deriv(xx.map(function (v, i) { return v + k2[i] * h / 2; }), [uk], p), k4 = plant.deriv(xx.map(function (v, i) { return v + k3[i] * h; }), [uk], p); return xx.map(function (v, i) { return v + (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]) * h / 6; }); })(x);
    }
    var model = C.arxFitIV(u, y, s.order, s.order), yhat = C.arxSim(model, u), my = y.reduce(function (a, v) { return a + v; }, 0) / y.length;
    var e2 = 0, v2 = 0; y.forEach(function (v, i) { e2 += Math.pow(yTrue[i] - yhat[i], 2); v2 += Math.pow(yTrue[i] - my, 2); });
    s.data = { u: u, y: y, yTrue: yTrue, yhat: yhat, dt: dtId }; s.model = model; s.fit = 100 * (1 - Math.sqrt(e2 / v2)); s.msd = C.arxToMsd(model, dtId); s.replayT = 0;
  }
  V['sysid-replay'] = function (c, lab) {
    var s = lab.sysid; if (!s.data) { text(c.ctx, 'Press Run experiment', 12, 12, col.muted); return; }
    var k = Math.min(s.data.u.length - 1, Math.floor(s.replayT / s.data.dt)), x = lab.plant.x0(lab.p).slice(); x[lab.refs[0].idx] = s.data.yTrue[k];
    var fake = { x: x, u: [s.data.u[k] * 5], t: -1e9, failed: false };
    var holdRef = Object.assign({}, lab, { refs: [{ type: 'hold', hold: NaN }] });
    lab.plant.draw(c.ctx, c.W, c.H, fake, holdRef, col);
    text(c.ctx, 'Replaying the experiment: t = ' + fmt(k * s.data.dt, 1) + ' s', 10, 8, col.text, { size: 11 });
  };
  V['sysid-data'] = function (c, lab) {
    var s = lab.sysid, ctx = c.ctx; if (!s.data) return;
    var d = s.data, mid = c.H * 0.36, n = d.u.length;
    timePlot(ctx, 44, 4, c.W - 10, mid - 4, [{ data: d.u, cap: n, color: col.viz2, name: 'input F (N)' }], range([d.u], 1), 'What we did');
    var k = Math.floor(s.replayT / d.dt), shown = function (a) { return a.slice(0, Math.max(2, k)); };
    timePlot(ctx, 44, mid + 4, c.W - 10, c.H - 6, [
      { data: shown(d.y), cap: n, color: withAlpha(col.muted, 0.7), width: 1, name: 'measured (noisy)' },
      { data: shown(d.yhat), cap: n, color: col.viz1, name: 'model, fitted' }
    ], range([d.y], 0.1), 'What we measured, and what the fitted model predicts: fit ' + fmt(s.fit, 1) + '%');
  };
  V['sysid-bode'] = function (c, lab) {
    var s = lab.sysid, ctx = c.ctx; if (!s.model) return;
    var x0 = 46, x1 = c.W - 10, mid = c.H * 0.5, X = logX(x0, x1);
    var lin = C.linearize(lab.plant, lab.p), row = lin.A.map(function (_, i) { return i === lab.refs[0].idx ? -1 : 0; }), model = { A: lin.A, B: lin.B, na: lab.plant.n, chans: [{ input: 0 }] };
    var w = GRID.filter(function (om) { return om < Math.PI / s.data.dt; });
    var tru = w.map(function (om) { return C.loopAt(model, [row], 0, 0, [0, om]); }), fitv = w.map(function (om) { return C.arxFreq(s.model, om, s.data.dt); });
    function draw(y0, y1, f, lo, hi, title, step) {
      var Y = function (v) { return y1 - (clamp(v, lo, hi) - lo) / (hi - lo) * (y1 - y0); };
      ctx.strokeStyle = col.border; for (var t = lo; t <= hi; t += step) { ctx.beginPath(); ctx.moveTo(x0, Y(t)); ctx.lineTo(x1, Y(t)); ctx.stroke(); text(ctx, String(t), x0 - 4, Y(t) - 5, col.muted, { align: 'right', size: 10, mono: true, w: '400' }); }
      [[tru, col.muted, 4, []], [fitv, col.viz1, 2, [6, 4]]].forEach(function (sr) {
        ctx.strokeStyle = sr[1]; ctx.lineWidth = sr[2]; ctx.setLineDash(sr[3]); ctx.beginPath(); var prev = null;
        sr[0].forEach(function (v, i) { var yv = f(v, prev); prev = yv; if (i) ctx.lineTo(X(w[i]), Y(yv)); else ctx.moveTo(X(w[i]), Y(yv)); }); ctx.stroke(); ctx.setLineDash([]);
      });
      text(ctx, title, x0 + 8, y0 + 1, col.text, { size: 11 });
    }
    draw(4, mid - 4, function (v) { return 20 * Math.log10(C.cabs(v)); }, -80, 20, 'Gain (dB): true plant (thick grey) vs fitted model (dashed)', 20);
    draw(mid + 4, c.H - 18, function (v, prev) { var a = C.carg(v) * 180 / Math.PI; if (prev !== null) a = prev + C.wrap180(a - prev); return a; }, -360, 0, 'Phase (°)', 90);
    [0.01, 0.1, 1, 10].forEach(function (om) { text(ctx, String(om), X(om), c.H - 14, col.muted, { align: 'center', size: 10, mono: true, w: '400' }); });
  };

  /* ---- identification methods: step, frequency sweep, grey-box, compare ---- */
  var ID_DT = 0.05, ID_NAMES = ['M', 'c', 'k'], ID_LABEL = { step: 'Step response', freq: 'Frequency sweep', arx: 'Least squares (ARX)', grey: 'Grey-box fit' };
  function idState(lab) { return lab.idm || (lab.idm = { noise: 0.01, points: 12, guess: { M: 2.5, c: 1.5, k: 1.5 } }); }
  function seeded(seed) { return function () { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }; }
  // A random ±A square wave, switching every 0.2–1 s, as a plain function of time.
  function randomInput(A, T, seed) {
    var r = seeded(seed), times = [0], levels = [r() < 0.5 ? A : -A], t = 0;
    while (t < T) { t += 0.2 + 0.8 * r(); times.push(t); levels.push(-levels[levels.length - 1] * (r() < 0.85 ? 1 : -1)); }
    return function (tt) { var i = 0; while (i + 1 < times.length && times[i + 1] <= tt) i++; return levels[i]; };
  }
  function idEstimate(lab, method) {
    var I = idState(lab);
    if (method === 'arx') return lab.sysid && lab.sysid.msd ? { M: lab.sysid.msd.M, c: lab.sysid.msd.c, k: lab.sysid.msd.k } : null;
    if (method === 'grey') return I.grey ? I.grey.path[I.grey.path.length - 1].p : null;
    return I[method] && I[method].est && I[method].est.M ? I[method].est : null;
  }
  function runId(lab, method) {
    var I = idState(lab), plant = lab.plant, p = lab.p, rng = seeded(4242 + Math.floor(Math.random() * 1000));
    if (method === 'step') {
      var d = C.experiment(plant, p, function (t) { return t >= 1 ? 2 : 0; }, 25, ID_DT, I.noise, rng);
      I.step = { data: d, est: C.stepEstimate(d, 2, 1), t0: performance.now() };
    } else if (method === 'freq') {
      var ws = C.logspace(0.3, 8, I.points), pts = ws.map(function (w) {
        var T = 2 * Math.PI / w, ts = Math.max(25, 6 * T), dd = C.experiment(plant, p, function (t) { return 2 * Math.sin(w * t); }, ts + Math.max(4 * T, 10), 0.02, I.noise, rng);
        var keep = Math.round(Math.min(3 * T, 8) / 0.02), tail = { t: dd.t.slice(-keep), u: dd.u.slice(-keep), yTrue: dd.yTrue.slice(-keep), dt: 0.02 };
        return { w: w, G: C.freqPoint(dd, w, 2, ts), tail: tail };
      });
      I.freq = { pts: pts, est: C.levyFit(ws, pts.map(function (q) { return q.G; })), t0: performance.now() };
    } else if (method === 'grey') {
      var dg = C.experiment(plant, p, randomInput(2, 30, 77), 30, ID_DT, I.noise, rng);
      I.grey = { data: dg, path: C.greyBoxFit(plant, p, dg, ID_NAMES, I.guess, 25), t0: performance.now() };
    } else if (method === 'compare') {
      var dv = C.experiment(plant, p, randomInput(2, 30, 991 + Math.floor(Math.random() * 1e4)), 30, ID_DT, I.noise, rng), rows = [];
      ['step', 'freq', 'arx', 'grey'].forEach(function (m) {
        var e = idEstimate(lab, m); if (!e) { rows.push({ m: m, est: null }); return; }
        var yh = C.simMsd(plant, p, e, dv.u, ID_DT);
        rows.push({ m: m, est: e, yh: yh, fit: C.fitPercent(dv.y, yh) });
      });
      I.compare = { data: dv, rows: rows, t0: performance.now() };
    }
  }
  function age(o) { return o ? (performance.now() - o.t0) / 1000 : 0; }
  var M_COLORS = function () { return { step: col.viz1, freq: col.viz3, arx: col.viz4, grey: col.viz2 }; };

  V['id-replay'] = function (c, lab, tab) {
    var I = idState(lab), m = tab.method, d = null, label = '', k = 0;
    if (m === 'freq' && I.freq) {
      var per = 1.6, n = I.freq.pts.length, a = age(I.freq), i = Math.min(n - 1, Math.floor(a / per)), q = I.freq.pts[i];
      d = q.tail; k = Math.floor(((a % per) / per) * (d.t.length - 1)); label = 'Shaking at ω = ' + fmtW(q.w) + ' rad/s (' + (i + 1) + ' of ' + n + ')';
    } else {
      var src = m === 'step' ? I.step : m === 'grey' ? I.grey : I.compare; if (!src) { text(c.ctx, 'Press Run experiment', 14, 14, col.muted); return; }
      d = src.data; k = Math.min(d.t.length - 1, Math.floor(age(src) * 3 / d.dt));
      label = (m === 'compare' ? 'Fresh validation data' : 'Replaying the experiment') + ': t = ' + fmt(d.t[k], 1) + ' s (3× speed)';
    }
    var x = lab.plant.x0(lab.p).slice(); x[0] = d.yTrue[k];
    var fake = { x: x, u: [d.u[k] * 4], t: -1e9, failed: false, status: 'ok' };
    lab.plant.draw(c.ctx, c.W, c.H, fake, Object.assign({}, lab, { refs: [{ type: 'hold', hold: NaN }], shake: true, replay: true, manual: false }), col);
    c.ctx.fillStyle = withAlpha(col.bgSoft, 0.9); c.ctx.fillRect(8, 6, c.W * 0.6, 40);
    text(c.ctx, ID_LABEL[m] || 'Validation', 14, 10, col.accent, { size: 13 }); text(c.ctx, label, 14, 28, col.muted, { size: 11, mono: true, w: '400' });
  };

  V['id-step'] = function (c, lab) {
    var I = idState(lab), ctx = c.ctx, S = I.step; if (!S) return;
    var d = S.data, e = S.est, n = Math.min(d.t.length, Math.floor(age(S) * 3 / d.dt) + 2), x0 = 44, x1 = c.W * (c.W < 560 ? 0.97 : 0.62), y0 = 20, y1 = c.H - 18;
    var hi = Math.max.apply(null, d.y) * 1.1, lo = Math.min(-0.05, Math.min.apply(null, d.y));
    var X = function (t) { return x0 + t / d.t[d.t.length - 1] * (x1 - x0); }, Y = function (v) { return y1 - (v - lo) / (hi - lo) * (y1 - y0); };
    ctx.strokeStyle = col.border; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.strokeStyle = withAlpha(col.muted, 0.8); ctx.lineWidth = 1; ctx.beginPath();
    for (var i = 0; i < n; i++) { if (i) ctx.lineTo(X(d.t[i]), Y(d.y[i])); else ctx.moveTo(X(d.t[i]), Y(d.y[i])); } ctx.stroke();
    text(ctx, 'Measured step response (2 N at t = 1 s)', x0 + 6, 2, col.text, { size: 11 });
    if (n < d.t.length || !e.ok) { if (!e.ok && n >= d.t.length) text(ctx, 'No overshoot to read: the method needs an underdamped response.', x0 + 6, 20, col.bad, { size: 11 }); return; }
    ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = col.viz1; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x0, Y(e.yss)); ctx.lineTo(x1, Y(e.yss)); ctx.stroke(); ctx.restore();
    ctx.strokeStyle = col.viz3; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(X(e.tpk), Y(e.yss)); ctx.lineTo(X(e.tpk), Y(e.ypk)); ctx.stroke();
    dot(ctx, X(e.tpk), Y(e.ypk), col.viz3);
    ctx.strokeStyle = col.viz4; ctx.beginPath(); ctx.moveTo(X(1), y1 - 6); ctx.lineTo(X(e.tpk), y1 - 6); ctx.stroke();
    text(ctx, 'final value', x1 - 4, Y(e.yss) + 3, col.viz1, { align: 'right', size: 10 });
    text(ctx, 'overshoot ' + fmt(e.overshoot * 100, 0) + '%', X(e.tpk) + 8, Y(e.ypk) - 4, col.viz3, { size: 10 });
    text(ctx, 't_p = ' + fmt(e.tp, 2) + ' s', (X(1) + X(e.tpk)) / 2, y1 - 20, col.viz4, { align: 'center', size: 10 });
    var model = C.simMsd(lab.plant, lab.p, e, d.u, d.dt);
    ctx.save(); ctx.setLineDash([6, 4]); ctx.strokeStyle = col.accent; ctx.lineWidth = 2; ctx.beginPath();
    model.forEach(function (v, j) { if (j) ctx.lineTo(X(d.t[j]), Y(v)); else ctx.moveTo(X(d.t[j]), Y(v)); }); ctx.stroke(); ctx.restore();
    if (c.W >= 560) notes(ctx, { x0: x1 + 18, x1: c.W - 10, y: 6 }, [
      ['Gain: final value ÷ step = ' + fmt(e.K, 3) + ' m/N, so k = 1/K = ' + fmt(e.k, 2) + ' N/m', col.viz1],
      ['Overshoot ' + fmt(e.overshoot * 100, 0) + '% gives the damping ratio ζ = ' + fmt(e.zeta, 3), col.viz3],
      ['First peak at t_p = ' + fmt(e.tp, 2) + ' s: it rings at ω_d = π/t_p = ' + fmt(Math.PI / e.tp, 2) + ' rad/s', col.viz4],
      ['Dashed: the model these three numbers make.', col.accent, '400']
    ]);
  };

  V['id-freq'] = function (c, lab) {
    var I = idState(lab), ctx = c.ctx, F = I.freq; if (!F) return;
    var shown = Math.min(F.pts.length, Math.floor(age(F) / 1.6) + 1), done = shown >= F.pts.length;
    var x0 = 46, x1 = c.W * (c.W < 560 ? 0.97 : 0.62), mid = c.H * 0.5, X = logX(x0, x1);
    var lin = C.linearize(lab.plant, lab.p), model = { A: lin.A, B: lin.B, na: lab.plant.n, chans: [{ input: 0 }] }, row = [-1, 0];
    var w = GRID.filter(function (om) { return om > 0.1 && om < 30; }), tru = w.map(function (om) { return C.loopAt(model, [row], 0, 0, [0, om]); });
    var e = F.est, fitG = w.map(function (om) { return C.cdiv([1, 0], [e.k - e.M * om * om, e.c * om]); });
    function draw(y0, y1, f, lo, hi, title, step) {
      var Y = function (v) { return y1 - (clamp(v, lo, hi) - lo) / (hi - lo) * (y1 - y0); };
      ctx.strokeStyle = col.border; ctx.lineWidth = 1;
      for (var t = lo; t <= hi; t += step) { ctx.beginPath(); ctx.moveTo(x0, Y(t)); ctx.lineTo(x1, Y(t)); ctx.stroke(); text(ctx, String(t), x0 - 4, Y(t) - 5, col.muted, { align: 'right', size: 10, mono: true, w: '400' }); }
      ctx.strokeStyle = withAlpha(col.muted, 0.5); ctx.lineWidth = 4; ctx.beginPath(); var pv = null;
      tru.forEach(function (v, i) { var yv = f(v, pv); pv = yv; if (i) ctx.lineTo(X(w[i]), Y(yv)); else ctx.moveTo(X(w[i]), Y(yv)); }); ctx.stroke();
      if (done) { ctx.save(); ctx.setLineDash([6, 4]); ctx.strokeStyle = col.accent; ctx.lineWidth = 2; ctx.beginPath(); pv = null; fitG.forEach(function (v, i) { var yv = f(v, pv); pv = yv; if (i) ctx.lineTo(X(w[i]), Y(yv)); else ctx.moveTo(X(w[i]), Y(yv)); }); ctx.stroke(); ctx.restore(); }
      F.pts.slice(0, shown).forEach(function (q) { var yv = f(q.G, null); if (yv < -170 && title === 'Phase (°)') yv = yv; dot(ctx, X(q.w), Y(f(q.G, title === 'Phase (°)' ? -90 : null)), col.viz3); });
      text(ctx, title, x0 + 8, y0 + 1, col.text, { size: 11 });
    }
    draw(4, mid - 4, function (v) { return 20 * Math.log10(C.cabs(v)); }, -40, 10, 'Gain (dB): measured points, true plant (grey), fit (dashed)', 10);
    draw(mid + 4, c.H - 18, function (v, prev) { var a = C.carg(v) * 180 / Math.PI; if (prev !== null) a = prev + C.wrap180(a - prev); else if (a > 0) a -= 360; return a; }, -180, 0, 'Phase (°)', 45);
    [0.1, 1, 10].forEach(function (om) { text(ctx, String(om), X(om), c.H - 14, col.muted, { align: 'center', size: 10, mono: true, w: '400' }); });
    if (c.W >= 560) notes(ctx, { x0: x1 + 18, x1: c.W - 10, y: 6 }, [
      ['Each dot is one experiment: shake at one frequency, wait for it to settle, then compare the output with the input to get a gain and a phase.', col.muted, '400'],
      ['For this plant 1/G(jω) = k − Mω² + j·cω, a straight line in the unknowns, so the fit is ordinary least squares.', col.text, '400'],
      done ? ['Fit: m = ' + fmt(e.M, 3) + ', c = ' + fmt(e.c, 3) + ', k = ' + fmt(e.k, 3), col.accent] : ['Measuring point ' + shown + ' of ' + F.pts.length + '…', col.viz3]
    ]);
  };

  V['id-grey'] = function (c, lab) {
    var I = idState(lab), ctx = c.ctx, G = I.grey; if (!G) return;
    var nIt = G.path.length, it = Math.min(nIt - 1, Math.floor(age(G) / 0.6)), P = G.path[it], d = G.data, mid = c.H * 0.58, x1 = c.W * (c.W < 560 ? 0.97 : 0.62);
    timePlot(ctx, 44, 4, x1, mid - 4, [
      { data: d.y, cap: d.y.length, color: withAlpha(col.muted, 0.8), width: 1, name: 'measured' },
      { data: P.y, cap: d.y.length, color: col.viz2, name: 'model, iteration ' + it }
    ], range([d.y], 0.2), 'Simulate the model, compare, adjust the constants, repeat');
    var cx0 = 44, cy0 = mid + 16, cy1 = c.H - 14, costs = G.path.map(function (q) { return Math.log10(q.cost + 1e-12); });
    var lo = Math.min.apply(null, costs) - 0.3, hi = Math.max.apply(null, costs) + 0.3;
    var X = function (i) { return cx0 + i / Math.max(1, nIt - 1) * (x1 - cx0); }, Y = function (v) { return cy1 - (v - lo) / (hi - lo) * (cy1 - cy0); };
    ctx.strokeStyle = col.border; ctx.beginPath(); ctx.moveTo(cx0, cy0); ctx.lineTo(cx0, cy1); ctx.lineTo(x1, cy1); ctx.stroke();
    ctx.strokeStyle = col.viz2; ctx.lineWidth = 2; ctx.beginPath();
    for (var i = 0; i <= it; i++) { if (i) ctx.lineTo(X(i), Y(costs[i])); else ctx.moveTo(X(i), Y(costs[i])); } ctx.stroke();
    dot(ctx, X(it), Y(costs[it]), col.viz2);
    text(ctx, 'Squared error (log scale) by iteration', cx0 + 6, mid + 2, col.text, { size: 11 });
    if (c.W >= 560) notes(ctx, { x0: x1 + 18, x1: c.W - 10, y: 6 }, [
      ['Iteration ' + it + ' of ' + (nIt - 1), col.text],
      ['m = ' + fmt(P.p.M, 3) + '   c = ' + fmt(P.p.c, 3) + '   k = ' + fmt(P.p.k, 3), col.viz2],
      ['Starting guess: m = ' + fmt(G.path[0].p.M, 2) + ', c = ' + fmt(G.path[0].p.c, 2) + ', k = ' + fmt(G.path[0].p.k, 2), col.muted, '400'],
      ['Each step works out which way to nudge m, c and k to shrink the error (Levenberg–Marquardt) and simulates again.', col.muted, '400']
    ]);
  };

  // Estimated constants against the true ones, as bars.
  V['id-result'] = function (c, lab, tab) {
    var ctx = c.ctx, e = idEstimate(lab, tab.method), trueP = lab.p;
    var done = tab.method === 'freq' ? idState(lab).freq && age(idState(lab).freq) > 1.6 * idState(lab).freq.pts.length
             : tab.method === 'grey' ? idState(lab).grey && age(idState(lab).grey) > 0.6 * idState(lab).grey.path.length
             : tab.method === 'step' ? idState(lab).step && age(idState(lab).step) * 3 > 25 : true;
    text(ctx, 'What it found vs the truth (the sim knows the real m = 1, c = 0.4, k = 4)', 12, 4, col.text, { size: 11 });
    if (!e || !done) { text(ctx, e ? 'Working…' : 'Run the experiment', 12, 26, col.muted, { size: 12 }); return; }
    var rows = ID_NAMES, bw = (c.W - 40) / rows.length, y1 = c.H - 30, y0 = 34;
    rows.forEach(function (nm, i) {
      var est = e[nm], tru = trueP[nm], err = (est / tru - 1) * 100, x = 20 + i * bw, mx = Math.max(est, tru) * 1.3, Hh = function (v) { return (y1 - y0) * v / mx; };
      ctx.fillStyle = withAlpha(col.muted, 0.35); ctx.fillRect(x + bw * 0.2, y1 - Hh(tru), bw * 0.25, Hh(tru));
      ctx.fillStyle = Math.abs(err) < 5 ? col.accent : Math.abs(err) < 20 ? col.viz3 : col.bad; ctx.fillRect(x + bw * 0.5, y1 - Hh(est), bw * 0.25, Hh(est));
      text(ctx, { M: 'mass m', c: 'damping c', k: 'spring k' }[nm], x + bw * 0.47, y1 + 4, col.text, { align: 'center', size: 11 });
      text(ctx, fmt(est, 3) + ' (' + (err >= 0 ? '+' : '') + fmt(err, 1) + '%)', x + bw * 0.62, y1 - Hh(est) - 16, Math.abs(err) < 5 ? col.accent : col.text, { align: 'center', size: 11, mono: true });
    });
    text(ctx, 'grey: true   colour: estimate', c.W - 12, 4, col.muted, { align: 'right', size: 10, w: '400' });
  };

  V['id-compare'] = function (c, lab) {
    var ctx = c.ctx, I = idState(lab), C2 = I.compare, cols = M_COLORS();
    text(ctx, c.W < 560 ? 'Each model on fresh data' : 'Every method\'s model, tested on fresh data none of them was fitted to', 12, 6, col.text, { size: 12 });
    var rowsDef = ['step', 'freq', 'arx', 'grey'], x = [12, c.W * 0.32, c.W * 0.45, c.W * 0.58, c.W * 0.71, c.W - 14], y = 26, rh = clamp((c.H - 50) / 5, 16, 30);
    var narrow = c.W < 560;
    if (narrow) x = [10, c.W * 0.38, c.W * 0.54, c.W * 0.7, -1, c.W - 12];
    ['Method', 'm', 'c', 'k', 'worst error', narrow ? 'fit' : 'fit on new data'].forEach(function (h, i) { if (x[i] >= 0) text(ctx, h, x[i], y, col.muted, { size: 11, align: i === 5 ? 'right' : 'left' }); });
    y += rh - 4;
    var best = null; if (C2) C2.rows.forEach(function (r) { if (r.est && (best === null || r.fit > best)) best = r.fit; });
    rowsDef.forEach(function (m) {
      var e = idEstimate(lab, m), r = C2 ? C2.rows.filter(function (q) { return q.m === m; })[0] : null;
      ctx.fillStyle = withAlpha(cols[m], 0.12); ctx.fillRect(8, y - 3, c.W - 16, rh - 4);
      text(ctx, narrow ? ID_LABEL[m].split(' (')[0].replace('Frequency', 'Freq.').replace('response', '') : ID_LABEL[m], x[0], y, cols[m], { size: 12 });
      if (!e) { text(ctx, 'not run yet (see its tab)', x[1], y, col.muted, { size: 11, w: '400' }); y += rh; return; }
      var worst = 0; ID_NAMES.forEach(function (nm, i) { text(ctx, fmt(e[nm], 3), x[i + 1], y, col.text, { size: 12, mono: true }); worst = Math.max(worst, Math.abs(e[nm] / lab.p[nm] - 1)); });
      if (x[4] >= 0) text(ctx, fmt(worst * 100, 1) + '%', x[4], y, worst < 0.05 ? col.accent : worst < 0.2 ? col.viz3 : col.bad, { size: 12, mono: true });
      if (r && r.est) text(ctx, fmt(r.fit, 1) + '%' + (r.fit === best ? '  ★' : ''), x[5], y, r.fit === best ? col.accent : col.text, { size: 12, mono: true, align: 'right' });
      y += rh;
    });
    text(ctx, 'true', x[0], y, col.muted, { size: 12 }); ID_NAMES.forEach(function (nm, i) { text(ctx, fmt(lab.p[nm], 3), x[i + 1], y, col.muted, { size: 12, mono: true }); });
  };
  V['id-validate'] = function (c, lab) {
    var I = idState(lab), C2 = I.compare, ctx = c.ctx; if (!C2) { text(ctx, 'Press Validate on fresh data', 12, 12, col.muted); return; }
    var cols = M_COLORS(), d = C2.data, n = d.y.length;
    var ser = [{ data: d.y, cap: n, color: withAlpha(col.muted, 0.8), width: 1, name: 'measured' }];
    C2.rows.forEach(function (r) { if (r.est) ser.push({ data: r.yh, cap: n, color: cols[r.m], width: 1.6, name: ID_LABEL[r.m].split(' (')[0] }); });
    timePlot(ctx, 44, 4, c.W - 10, c.H - 6, ser, range([d.y], 0.2), 'Fresh input, and what each model predicts');
  };

  /* ---- the design checklist ---- */
  V.checklist = function (c, lab, tab) {
    var ctx = c.ctx, r = lab.req, an = analyze(lab), s = stepResponse(lab, tab.stepT || 12), mg = an.ch[0] && an.ch[0].mg;
    var rows = [
      ['Overshoot', fmt(s.overshoot, 0) + '%', '≤ ' + fmt(r.overshoot, 0) + '%', s.overshoot <= r.overshoot],
      ['Settling time (2%)', isFinite(s.settle) ? fmt(s.settle, 1) + ' s' : 'never', '≤ ' + fmt(r.settle, 1) + ' s', s.settle <= r.settle],
      ['Phase margin (model)', mg && mg.pm !== null ? fmt(mg.pm, 0) + '°' : '-', '≥ ' + fmt(r.pm, 0) + '°', an.stable && mg && mg.pm !== null && mg.pm >= r.pm],
      ['Delay margin (model)', mg && mg.delayMargin ? fmt(mg.delayMargin * 1000, 0) + ' ms' : '-', '≥ ' + fmt(r.delay, 0) + ' ms', an.stable && mg && mg.delayMargin * 1000 >= r.delay],
      ['Peak force', fmt(s.umax, 1) + ' N', '≤ ' + fmt(r.force, 0) + ' N', s.umax <= r.force + 1e-6],
      ['Model identified', lab.sysid && lab.sysid.used ? 'yes' : 'no', 'from data', !!(lab.sysid && lab.sysid.used)]
    ];
    var y = 6, rh = Math.min(26, (c.H - 30) / rows.length), x0 = 12, w = c.W - 24;
    text(ctx, 'Requirements checklist (step on the real plant, margins on your model)', x0, y, col.text, { size: 11 }); y += 20;
    rows.forEach(function (row) {
      ctx.fillStyle = withAlpha(row[3] ? col.accent : col.bad, 0.1); ctx.fillRect(x0, y, w, rh - 4);
      text(ctx, row[3] ? '✓' : '✗', x0 + 8, y + 3, row[3] ? col.accent : col.bad, { size: 13 });
      text(ctx, row[0], x0 + 28, y + 4, col.text, { size: 12 });
      text(ctx, row[1], x0 + w * 0.62, y + 4, row[3] ? col.accent : col.bad, { size: 12, mono: true, align: 'right' });
      text(ctx, row[2], x0 + w - 8, y + 4, col.muted, { size: 11, mono: true, align: 'right', w: '400' });
      y += rh;
    });
    lab.allPass = rows.every(function (row) { return row[3]; });
  };

  /* ================= controls (built into each tab's panel) ================= */
  function h3(panel, t) { panel.appendChild(el('h3', '', t)); }
  function hint(panel, t) { panel.appendChild(el('p', 'panel-hint', t)); }
  function slider(panel, id, label, min, max, step, value, fmtV, onInput) {
    var g = el('div', 'pid-group'), lb = el('label'), val = el('span'); lb.setAttribute('for', id); lb.innerHTML = label + ' '; lb.appendChild(val);
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
    return function (val) { btns.forEach(function (x, i) { var on = opts[i][0] === val; x.classList.toggle('active', on); x.setAttribute('aria-pressed', on ? 'true' : 'false'); }); };
  }
  function button(panel, label, onClick) { var b = el('button', 'sim-btn', label); b.type = 'button'; b.addEventListener('click', function () { onClick(b); }); panel.appendChild(b); return b; }
  function telemetry(panel, rows) {
    var t = el('div', 'telemetry'), vals = {};
    rows.forEach(function (r) { t.appendChild(el('span', 't-key', r[1])); vals[r[0]] = el('span', 't-val', '-'); t.appendChild(vals[r[0]]); });
    panel.appendChild(t); return vals;
  }
  function setV(span, v, bad) { if (!span) return; if (span.textContent !== v) span.textContent = v; span.classList.toggle('lab-bad', !!bad); }

  var CTRL = {};
  CTRL.freq = function (panel, lab, tab) {
    h3(panel, tab.shake ? 'Shake it' : 'Frequency');
    var a = Math.log10(GRID[0]), b = Math.log10(GRID[GRID.length - 1]);
    var s = slider(panel, tab.id + '-w', 'ω', 0, 1000, 1, 1000 * (Math.log10(lab.w) - a) / (b - a), function (v) { return fmtW(Math.pow(10, a + v / 1000 * (b - a))) + ' rad/s'; },
      function (v) { lab.w = Math.pow(10, a + v / 1000 * (b - a)); tab.sweeping = false; });
    var btn = button(panel, 'Sweep frequency', function () { tab.sweeping = !tab.sweeping; if (tab.sweeping) lab.w = GRID[0]; });
    tab.syncFreq = function () { s.set(1000 * (Math.log10(lab.w) - a) / (b - a)); btn.textContent = tab.sweeping ? 'Stop sweep' : 'Sweep frequency'; };
  };
  CTRL.view = function (panel, lab, tab) {
    h3(panel, 'View');
    var names = { bode: 'Bode', nyquist: 'Nyquist', poles: 'Poles' };
    toggle(panel, 'Plot shown', tab.analysis.map(function (v) { return [v, names[v]]; }), tab.view, function (v) { tab.view = v; });
  };
  CTRL.channel = function (panel, lab, tab) {
    h3(panel, 'Which loop to cut');
    toggle(panel, 'Loop', lab.controller.channels.map(function (ch, i) { return [i, ch.label || ('Loop ' + (i + 1))]; }), 0, function (v) { tab.channel = v; });
  };
  CTRL.reference = function (panel, lab, tab) {
    h3(panel, 'Reference');
    toggle(panel, 'Reference', [['wave', 'Wave'], ['step', 'Step']], lab.refs[0].type, function (v) { lab.refs[0].type = v; });
    if (tab.refAmp) slider(panel, tab.id + '-amp', 'Size', tab.refAmp[0], tab.refAmp[1], 0.05, lab.refs[0].amp, function (v) { return fmt(v, 2) + ' ' + lab.refs[0].unit; }, function (v) { lab.refs[0].amp = v; });
  };
  CTRL.gains = function (panel, lab, tab) {
    var sliders = [];
    if (tab.zeroGains && !lab.zeroed) { lab.zeroed = true; lab.gains.forEach(function (g) { Object.keys(g).forEach(function (k) { g[k] = 0; }); }); changed(lab); }
    lab.controller.channels.forEach(function (ch, ci) {
      h3(panel, lab.controller.channels.length > 1 ? (ch.label || 'Loop ' + (ci + 1)) : (lab.controller.label + ' gains'));
      Object.keys(ch.gains).forEach(function (g) {
        var rg = ch.ranges[g], step = (rg[1] - rg[0]) / 400;
        var labelTxt = { kp: 'K<sub>p</sub>', ki: 'K<sub>i</sub>', kd: 'K<sub>d</sub>', kx: 'k<sub>x</sub>', kv: 'k<sub>ẋ</sub>', kth: 'k<sub>θ</sub>', kw: 'k<sub>θ̇</sub>' }[g] || g;
        var s = slider(panel, tab.id + '-' + ci + '-' + g, labelTxt, rg[0], rg[1], step, lab.gains[ci][g], fmtG, function (v) { lab.gains[ci][g] = v; changed(lab); });
        s.input.addEventListener('change', function () { lab.adjusts++; if (lab.onAdjust) lab.onAdjust(); });
        if (tab.rangeBoxes && rg[0] < 0) {                // ± box: widen or narrow the slider's range
          var rr = el('div', 'range-row'), lb = el('label', 'range-lbl', '<span class="visually-hidden">Range </span>±'), ri = el('input', 'range-input');
          ri.type = 'number'; ri.min = 0.01; ri.step = 'any'; ri.value = rg[1]; ri.id = s.input.id + '-range'; lb.setAttribute('for', ri.id);
          rr.appendChild(lb); rr.appendChild(ri); s.input.parentNode.appendChild(rr);
          ri.addEventListener('input', function () { var r = Math.max(0.01, parseFloat(ri.value) || 0); s.input.min = -r; s.input.max = r; s.input.step = r / 200; lab.gains[ci][g] = clamp(lab.gains[ci][g], -r, r); s.set(lab.gains[ci][g]); changed(lab); });
          var widen = function () { var a = Math.abs(lab.gains[ci][g]); if (a > parseFloat(s.input.max)) { ri.value = Math.ceil(a * 1.5 * 100) / 100; s.input.min = -ri.value; s.input.max = ri.value; } };
          sliders.push(widen);
        }
        sliders.push(function () { s.set(lab.gains[ci][g]); });
      });
    });
    button(panel, tab.loadLabel || 'Load suggested gains', function () { lab.suggested.forEach(function (g, ci) { Object.assign(lab.gains[ci], g); }); changed(lab); });
    lab.uiSync.push(function () { sliders.forEach(function (f) { f(); }); });
  };
  CTRL.controller = function (panel, lab) {
    h3(panel, 'Controller');
    toggle(panel, 'Controller', [[false, lab.controller.label], [true, 'Neural net']], lab.useNet, function (v) { lab.useNet = v; changed(lab); });
    hint(panel, 'The network was trained to copy the LQR. It\'s the same file the cart-pole on /controls/ can run.');
  };
  CTRL.delay = function (panel, lab, tab) {
    if (tab.disturbances) h3(panel, 'Disturbances');
    slider(panel, tab.id + '-delay', 'Delay', 0, tab.delayMax || 300, 5, (lab.delay || 0) * 1000, function (v) { return fmt(v, 0) + ' ms'; }, function (v) { lab.delay = v / 1000; changed(lab); });
  };
  CTRL.noise = function (panel, lab, tab) {
    var mx = tab.noiseMax || 0.05;
    slider(panel, tab.id + '-noise', 'Sensor noise σ', 0, mx, mx / 100, lab.noise, function (v) { return fmt(v, mx >= 1 ? 2 : 3) + (tab.noiseUnit ? ' ' + tab.noiseUnit : ''); }, function (v) { lab.noise = v; changed(lab); });
  };
  CTRL.limit = function (panel, lab, tab) {
    slider(panel, tab.id + '-limit', 'Force limit', 2, 60, 1, Math.min(lab.p.Fmax, 60), function (v) { return v >= 60 ? 'none' : fmt(v, 0) + ' N'; }, function (v) { lab.p.Fmax = v >= 60 ? 1e9 : v; changed(lab); });
  };
  CTRL.margins = function (panel, lab, tab) {
    var t = telemetry(panel, [['st', 'Stability'], ['pm', 'Phase margin'], ['wc', 'Crossover'], ['up', 'Gain up'], ['dn', 'Gain down'], ['dm', 'Delay margin']]);
    tab.syncMargins = function () {
      var an = analyze(lab), ch = an.ch[tab.channel || 0], mg = ch && ch.mg; if (!mg) return;
      setV(t.st, an.stable ? 'Stable' : 'Unstable', !an.stable);
      var ok = an.stable;
      setV(t.pm, ok && mg.pm !== null ? fmt(mg.pm, 0) + '°' : '-'); setV(t.wc, ok && mg.wc ? fmtW(mg.wc) + ' rad/s' : '-');
      setV(t.up, ok ? (mg.gmUp === null ? '∞' : '+' + fmt(mg.gmUp, 1) + ' dB') : '-'); setV(t.dn, ok ? (mg.gmDown === null ? '∞' : fmt(mg.gmDown, 1) + ' dB') : '-');
      setV(t.dm, ok && mg.delayMargin ? fmt(mg.delayMargin * 1000, 0) + ' ms' : '-');
    };
  };
  CTRL.cbf = function (panel, lab, tab) {
    h3(panel, 'Safety filter');
    toggle(panel, 'Safety filter', [[false, 'Off'], [true, 'On']], lab.cbf.on, function (v) { lab.cbf.on = v; lab.hits = 0; lab.cbfFrames = 0; lab.frames = 0; });
    slider(panel, tab.id + '-lambda', 'Caution λ', 0.5, 8, 0.1, lab.cbf.lambda, function (v) { return fmt(v, 1) + ' /s'; }, function (v) { lab.cbf.lambda = v; });
    hint(panel, 'Small λ brakes early and gently; large λ waits until the last moment.');
    var t = telemetry(panel, [['hits', 'Hits on a stop'], ['act', 'Filter acting']]);
    tab.syncCbf = function () { setV(t.hits, String(lab.hits), lab.hits > 0); setV(t.act, lab.frames ? fmt(100 * lab.cbfFrames / lab.frames, 0) + '%' : '-'); };
  };
  CTRL.verify = function (panel, lab, tab) {
    lab.verify = lab.verify || { eps: Math.pow(10, -2.8), delta: 0.5, depth: 0, follow: true, e: [0, 0, 0.1, 0] };
    var v = lab.verify;
    h3(panel, 'The question');
    hint(panel, 'Can a sensor error up to ε (angle) and 5ε (rate) move the force by more than δ? The box follows the live cart-pole; click a map to pin a state.');
    slider(panel, tab.id + '-eps', 'ε', -3.3, -1.3, 0.02, Math.log10(v.eps), function (x) { return '±' + fmt(Math.pow(10, x) * 180 / Math.PI, 2) + '°'; }, function (x) { v.eps = Math.pow(10, x); });
    slider(panel, tab.id + '-delta', 'δ', 0.1, 2, 0.05, v.delta, function (x) { return '±' + fmt(x, 2) + ' N'; }, function (x) { v.delta = x; });
    h3(panel, 'Split the box');
    toggle(panel, 'Split', [[0, '1'], [1, '4'], [2, '16'], [3, '64']], 0, function (d) { v.depth = d; });
    var follow = button(panel, 'Following the sim', function () { v.follow = true; lab.uiSync.forEach(function (f) { f(); }); });
    var t = telemetry(panel, [['F', 'Force'], ['p', 'Proved'], ['f', 'Found'], ['ans', 'Answer']]);
    lab.uiSync.push(function () { follow.textContent = v.follow ? 'Following the sim' : 'Pinned: follow the sim again'; });
    tab.syncVerify = function () {
      if (!lab.net) return; var q = verifyQuery(lab);
      setV(t.F, fmt(q.cert.Fc, 2) + ' N'); setV(t.p, '±' + fmt(q.cert.dev, 2) + ' N'); setV(t.f, '±' + fmt(q.att.dev, 2) + ' N');
      setV(t.ans, q.verdict === 'proved' ? 'Proved' : q.verdict === 'disproved' ? 'Disproved' : 'Unknown', q.verdict === 'disproved');
    };
  };
  CTRL.mimo = function (panel, lab, tab) {
    lab.mimo = { range: tab.mimoRange || [-0.9, 1.5], labels: lab.controller.channels.map(function (ch) { return (ch.label || '').split(' ')[0]; }), note: tab.mimoNote };
    h3(panel, 'Gain errors');
    var ss = [0, 1].map(function (ci) {
      return slider(panel, tab.id + '-d' + ci, lab.controller.channels[ci].label, lab.mimo.range[0], lab.mimo.range[1], 0.01, 0, function (v) { return (v >= 0 ? '+' : '') + fmt(v * 100, 0) + '%'; },
        function (v) { lab.scale[ci] = 1 + v; lab.dirty = true; });
    });
    button(panel, 'No errors', function () { lab.scale = [1, 1]; lab.dirty = true; lab.uiSync.forEach(function (f) { f(); }); });
    lab.uiSync.push(function () { ss[0].set(lab.scale[0] - 1); ss[1].set(lab.scale[1] - 1); });
    var t = telemetry(panel, [['st', 'Now'], ['l1', 'Loop 1 alone'], ['l2', 'Loop 2 alone']]);
    tab.syncMimo = function () {
      var an = analyze(lab); setV(t.st, an.stable ? 'Stable' : 'Unstable', !an.stable);
      [0, 1].forEach(function (ci) { var m = an.ch[ci].mg; setV(t['l' + (ci + 1)], m.pm !== null ? fmt(m.pm, 0) + '°, ' + (m.gmUp === null ? '∞' : '+' + fmt(m.gmUp, 1)) + ' dB' : '-'); });
    };
  };
  CTRL.sysid = function (panel, lab, tab) {
    var s = lab.sysid;
    h3(panel, 'Experiment');
    toggle(panel, 'Input signal', [['step', 'Step'], ['chirp', 'Chirp'], ['prbs', 'Random']], s.exc, function (v) { s.exc = v; });
    slider(panel, tab.id + '-idn', 'Sensor noise', 0, 0.1, 0.002, s.noise, function (v) { return fmt(v * 1000, 0) + ' mm'; }, function (v) { s.noise = v; });
    slider(panel, tab.id + '-idT', 'Length', 5, 60, 1, s.T, function (v) { return fmt(v, 0) + ' s'; }, function (v) { s.T = v; });
    h3(panel, 'Model');
    toggle(panel, 'Model order', [[1, '1st'], [2, '2nd'], [3, '3rd'], [4, '4th']], s.order, function (v) { s.order = v; if (s.data) runSysid(lab); });
    button(panel, 'Run experiment', function () { runSysid(lab); });
    var t = telemetry(panel, [['fit', 'Fit'], ['m', 'Mass m'], ['c', 'Damping c'], ['k', 'Spring k']]);
    if (tab.useModel) button(panel, 'Design with this model', function (b) {
      if (!s.msd) return; lab.pm = Object.assign({}, lab.pm, { M: s.msd.M, c: s.msd.c, k: s.msd.k }); s.used = true; changed(lab); b.textContent = 'Model in use ✓';
    });
    tab.syncSysid = function () {
      setV(t.fit, s.data ? fmt(s.fit, 1) + '%' : '-');
      var m = s.msd; setV(t.m, m ? fmt(m.M, 2) + ' kg' : '-'); setV(t.c, m ? fmt(m.c, 2) : '-'); setV(t.k, m ? fmt(m.k, 2) : '-');
    };
  };
  CTRL.idrun = function (panel, lab, tab) {
    var I = idState(lab), m = tab.method;
    h3(panel, m === 'compare' ? 'Validation' : 'Experiment');
    slider(panel, tab.id + '-idnoise', 'Sensor noise', 0, 0.1, 0.002, I.noise, function (v) { return fmt(v * 1000, 0) + ' mm'; }, function (v) { I.noise = v; });
    if (m === 'freq') toggle(panel, 'Frequencies measured', [[4, '4'], [8, '8'], [12, '12'], [20, '20']], I.points, function (v) { I.points = v; });
    if (m === 'grey') {
      h3(panel, 'Starting guess');
      [['M', 'm', 0.2, 5], ['c', 'c', 0.05, 3], ['k', 'k', 0.5, 12]].forEach(function (g) {
        slider(panel, tab.id + '-g' + g[0], g[1], g[2], g[3], (g[3] - g[2]) / 200, I.guess[g[0]], function (v) { return fmt(v, 2); }, function (v) { I.guess[g[0]] = v; });
      });
      hint(panel, 'Start far from the truth and it still gets there; start in a silly place and it can stop in the wrong valley.');
    }
    button(panel, m === 'compare' ? 'Validate on fresh data' : 'Run experiment', function () { runId(lab, m); });
    if (m !== 'compare') {
      var t = telemetry(panel, [['M', 'Mass m'], ['c', 'Damping c'], ['k', 'Spring k']]);
      tab.syncId = function () { var e = idEstimate(lab, m); ID_NAMES.forEach(function (nm) { setV(t[nm], e ? fmt(e[nm], 3) : '-'); }); };
    }
    if (!I[m] && m !== 'compare') runId(lab, m);
  };
  CTRL.requirements = function (panel, lab, tab) {
    var r = lab.req; h3(panel, 'Requirements');
    [['overshoot', 'Max overshoot', 2, 60, 1, function (v) { return fmt(v, 0) + '%'; }], ['settle', 'Settle within', 0.5, 10, 0.1, function (v) { return fmt(v, 1) + ' s'; }],
     ['pm', 'Phase margin ≥', 20, 80, 1, function (v) { return fmt(v, 0) + '°'; }], ['delay', 'Delay margin ≥', 0, 200, 5, function (v) { return fmt(v, 0) + ' ms'; }],
     ['force', 'Force budget', 5, 60, 1, function (v) { return fmt(v, 0) + ' N'; }]].forEach(function (q) {
      slider(panel, tab.id + '-' + q[0], q[1], q[2], q[3], q[4], r[q[0]], q[5], function (v) { r[q[0]] = v; lab.stepCache = null; });
    });
  };
  function restart(lab) { lab.sim.reset(); lab.hist = { r: [], y: [], u: [], x: [], s: [], c: {} }; lab.ring = []; lab.hits = 0; lab.failT = null; lab.drag = null; }
  CTRL.mode = function (panel, lab, tab) {
    h3(panel, 'Controller');
    lab.manual = tab.startManual !== false && !!lab.plant.manual;
    tab.setMode = toggle(panel, 'Who is in control', [[true, 'Manual'], [false, lab.controller.label]], lab.manual, function (v) {
      lab.manual = v; lab.drag = null; lab.sim.z = lab.sim.z.map(function () { return 0; }); lab.ring = []; lab.best = null;
    });
    if (tab.manualHint) panel.appendChild(el('p', 'panel-hint', tab.manualHint));
  };
  CTRL.hint = function (panel, lab, tab) {
    var box = el('div', 'hint-box'); box.hidden = true;
    box.appendChild(el('p', 'hint-text', tab.hint));
    var row = el('div', 'hint-row'), b = el('button', 'sim-btn hint-apply', 'Try it'); b.type = 'button'; row.appendChild(b); box.appendChild(row);
    panel.appendChild(box);
    // Shown once the visitor has adjusted a gain 10 times (as on /controls/).
    lab.onAdjust = function () { if (lab.adjusts >= 10) box.hidden = false; };
    b.addEventListener('click', function () {
      lab.suggested.forEach(function (g, ci) { Object.assign(lab.gains[ci], g); });
      lab.manual = false; if (tab.setMode) tab.setMode(false); restart(lab); changed(lab);
    });
  };
  CTRL.score = function (panel, lab, tab) {
    var b = el('div', 'score-block'), v = el('span', 'score-value', '-'), best = el('div', 'score-best');
    b.appendChild(v); b.appendChild(el('span', 'score-label', tab.score.label)); b.appendChild(best); panel.appendChild(b);
    tab.syncScore = function () {
      var r = lab.ring.length ? Math.sqrt(lab.ring.reduce(function (a, c) { return a + c; }, 0) / lab.ring.length) : null;
      var t = r === null ? '-' : Math.min(r, 100).toFixed(tab.score.digits || 2); if (v.textContent !== t) v.textContent = t;
      var bt = lab.best === null ? '' : 'Best: ' + lab.best.toFixed(tab.score.digits || 2) + ' ' + (tab.score.unit || ''); if (best.textContent !== bt) best.textContent = bt;
    };
  };
  CTRL.reset = function (panel, lab) { button(panel, 'Reset', function () { restart(lab); lab.trials = 0; lab.best = null; }); };
  CTRL.restart = function (panel, lab) { button(panel, 'Restart', function () { lab.sim.reset(); lab.hist = { r: [], y: [], u: [], x: [] }; lab.hits = 0; }); };

  // Manual mode: drag on the sim (the plant decides what a drag means).
  function bindManualDrag(canvas, lab) {
    function at(e) { var r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    canvas.addEventListener('pointerdown', function (e) {
      if (!lab.manual) return; var p = at(e); lab.drag = { x: p.x, y: p.y, x0: p.x, y0: p.y };
      canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing'; e.preventDefault();
    });
    canvas.addEventListener('pointermove', function (e) { if (!lab.drag) return; var p = at(e); lab.drag.x = p.x; lab.drag.y = p.y; });
    function up() { lab.drag = null; canvas.style.cursor = lab.manual ? 'grab' : ''; }
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  }

  /* ================= tabs ================= */
  var tabEls = Array.prototype.slice.call(document.querySelectorAll('.sim-tab')), secEls = Array.prototype.slice.call(document.querySelectorAll('.sim-section'));
  function activate(i) { tabEls.forEach(function (t, k) { t.classList.toggle('active', k === i); t.setAttribute('aria-selected', k === i ? 'true' : 'false'); }); secEls.forEach(function (s, k) { s.classList.toggle('active', k === i); }); }
  function fromHash() { var h = location.hash.slice(1), idx = 0; CFG.tabs.forEach(function (t, i) { if (t.id === h) idx = i; }); activate(idx); }
  tabEls.forEach(function (t, i) { t.addEventListener('click', function () { activate(i); history.replaceState(null, '', i === 0 ? location.pathname + location.search : '#' + CFG.tabs[i].id); }); });
  window.addEventListener('hashchange', fromHash); fromHash();

  var tabs = CFG.tabs.map(function (tc) {
    var tab = Object.assign({}, tc), lab = labs[tc.lab];
    tab.lab = lab; tab.view = tab.analysis ? tab.analysis[0] : 'bode'; tab.channel = 0;
    if (tab.shake) lab.shake = lab.shake || { input: 0, amp: tab.shakeAmp || 1 };
    tab.canvases = ['top', 'row1', 'row2'].map(function (slot) { return document.getElementById(tc.id + '-' + slot); });
    var panel = document.getElementById(tc.id + '-panel');
    (tc.controls || []).forEach(function (k) { if (CTRL[k]) CTRL[k](panel, lab, tab); });
    if (lab.sysid && !lab.sysid.data && (tc.controls || []).indexOf('sysid') >= 0) runSysid(lab);
    tab.canvases.forEach(function (cv, i) {
      var vname = [tc.top, tc.row1, tc.row2][i];
      if (vname === 'analysis' || vname === 'poles') bindPoleDrag(cv, lab);
      if (vname === 'verify-map') bindVerifyClick(cv, lab);
      if (vname === 'mimo') bindMimoDrag(cv, lab);
      if (vname === 'sim' && lab.plant.manual) bindManualDrag(cv, lab);
    });
    return tab;
  });

  /* ================= the loop ================= */
  function stepLab(lab, dt, tab) {
    var plant = lab.plant, every = Math.max(1, Math.round((tab.window || 10) / CAP / plant.dt));
    lab.acc += dt;
    var guard = 0;
    while (lab.acc >= plant.dt && guard++ < 200) {
      lab.acc -= plant.dt;
      if (lab.failT !== null) { if (lab.sim.t - lab.failT > 1) { lab.sim.reset(); lab.failT = null; } else { lab.sim.t += plant.dt; continue; } }
      lab.sim.step(); lab.frames++; if (lab.sim.cbfActive) lab.cbfFrames++;
      if (lab.stops) {                                    // hard stops: an impact, not a crash
        var x = lab.sim.x, pi = lab.cbf.pos;
        if (Math.abs(x[pi]) > lab.stops) { x[pi] = Math.sign(x[pi]) * lab.stops; if (x[lab.cbf.vel] * Math.sign(x[pi]) > 0) { x[lab.cbf.vel] = 0; lab.hits++; lab.hitFlash = 20; } }
      }
      if (lab.sim.failed && lab.failT === null) { lab.failT = lab.sim.t; lab.trials++; lab.ring = []; }
      lab.tick = (lab.tick || 0) + 1;
      if (lab.tick % every === 0) {
        var x0 = plant.x0(lab.p), u0 = plant.u0(lab.p), xs = lab.sim.x;
        lab.refs.forEach(function (r, ci) { (lab.hist.y[ci] = lab.hist.y[ci] || []); push(lab.hist.y[ci], xs[r.idx] - x0[r.idx], CAP); (lab.hist.r[ci] = lab.hist.r[ci] || []); push(lab.hist.r[ci], C.refValue(r, lab.sim.t), CAP); });
        for (var i = 0; i < plant.m; i++) { (lab.hist.u[i] = lab.hist.u[i] || []); push(lab.hist.u[i], lab.sim.u[i] - u0[i], CAP); }
        for (var j = 0; j < plant.n; j++) { (lab.hist.x[j] = lab.hist.x[j] || []); push(lab.hist.x[j], xs[j], 300); }
        (plant.states || []).forEach(function (sp, k) { (lab.hist.s[k] = lab.hist.s[k] || []); push(lab.hist.s[k], sp.f(xs, lab.sim.u, lab.p), CAP); });
        var cb = lab.sim.contrib[0], sc = plant.contribScale || 1, tot = 0;
        if (cb) Object.keys(cb).forEach(function (k) { tot += cb[k]; (lab.hist.c[k] = lab.hist.c[k] || []); push(lab.hist.c[k], cb[k] * sc, CAP); });
        if (cb && Object.keys(cb).length > 1) { (lab.hist.c.total = lab.hist.c.total || []); push(lab.hist.c.total, tot * sc, CAP); }
        if (!cb) Object.keys(lab.hist.c).forEach(function (k) { push(lab.hist.c[k], 0, CAP); });
      }
      if (tab.score) {                                    // RMS tracking error over a window
        var sv = tab.score.of === 'theta' ? xs2deg(lab.sim.x[2]) : clamp(C.refValue(lab.refs[0], lab.sim.t) - (lab.sim.x[lab.refs[0].idx] - plant.x0(lab.p)[lab.refs[0].idx]), -100, 100);
        push(lab.ring, sv * sv, Math.round(tab.score.window / plant.dt));
        if (lab.ring.length >= Math.round(tab.score.window / plant.dt) && !lab.manual && !lab.sim.failed) {
          var rms = Math.sqrt(lab.ring.reduce(function (a, b) { return a + b; }, 0) / lab.ring.length);
          if (lab.best === null || rms < lab.best) lab.best = rms;
        }
      }
    }
    if (lab.hitFlash) lab.hitFlash--;
  }
  function xs2deg(r) { return r * 180 / Math.PI; }
  var last = null;
  function frame(ts) {
    var dt = last === null ? 1 / 60 : Math.min(0.05, (ts - last) / 1000); last = ts;
    readColors();
    tabs.forEach(function (tab, i) {
      if (!secEls[i] || !secEls[i].classList.contains('active')) return;
      var lab = tab.lab;
      if (tab.sweeping) { lab.w *= Math.pow(GRID[GRID.length - 1] / GRID[0], dt / 12); if (lab.w >= GRID[GRID.length - 1]) { lab.w = GRID[GRID.length - 1]; tab.sweeping = false; } }
      if (tab.syncFreq) tab.syncFreq();
      if (lab.sysid && lab.sysid.data) lab.sysid.replayT = Math.min(lab.sysid.replayT + dt * 4, lab.sysid.T);
      var simShown = [tab.top, tab.row1, tab.row2].some(function (v) { return v === 'sim' || v === 'time' || v === 'cbf' || v === 'verify-map' || v === 'states' || v === 'contrib'; });
      if (simShown) stepLab(lab, dt, tab);
      [tab.top, tab.row1, tab.row2].forEach(function (vname, k) {
        var cv = tab.canvases[k]; if (!cv || !V[vname]) return;
        V[vname](fit(cv), lab, tab, cv);
      });
      if (tab.method === 'compare' && !idState(lab).compare && lab.sysid && lab.sysid.msd) {
        ['step', 'freq', 'grey'].forEach(function (mm) { if (!idState(lab)[mm]) runId(lab, mm); }); runId(lab, 'compare');
      }
      ['syncMargins', 'syncCbf', 'syncVerify', 'syncMimo', 'syncSysid', 'syncScore', 'syncId'].forEach(function (f) { if (tab[f]) tab[f](); });
    });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
