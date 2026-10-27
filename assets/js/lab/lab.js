// lab.js — the one engine behind every template page. A page is a data file
// (_data/labs/<page>.yml) rendered by _includes/lab.html: a list of labs (plant +
// controller + settings) and a list of tabs, each naming a lab, which view goes in each of
// the three canvas slots (top, row1, row2), and which controls the side panel gets.
// Labs can be shared between tabs (the design page walks one lab through six steps).
//
// Views:    sim, time, states, contrib, analysis (toggle of bode | nyquist | poles), step,
//           verify-map, verify-proof, mimo, sysid-replay, sysid-data, sysid-bode, checklist,
//           id-replay, id-era, id-result,
//           rec-data, rec-fit, est-states, samp-time, samp-fold, disc-z, disc-step, disc-bode, disc-loop
// Controls: mode, hint, freq, view, channel, reference, gains, controller, delay, noise, limit,
//           margins, verify, mimo, sysid, idrun, record, estimator, sampling, discretize, ctrlrate,
//           requirements, score, reset, restart
// All math is in LabCore (lab-core.js); plants and their pictures in LabPlants.
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
  function fmtAx(v) { return Math.abs(v) >= 100 ? fmt(v, 0) : fmt(v, 1); }   // plot readouts: one decimal
  var col = {};
  function readColors() {
    var m = { text: '--text', muted: '--text-muted', border: '--border', borderStrong: '--border-strong', accent: '--accent',
      bgSoft: '--bg-soft', bg: '--bg', viz1: '--viz-1', viz2: '--viz-2', viz3: '--viz-3', viz4: '--viz-4',
      bad: '--bad', zero: '--nn-act-zero', pos: '--nn-act-pos', mono: '--mono', font: '--font' };
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
      shake: lc.shake || null,
      req: lc.requirements ? Object.assign({}, lc.requirements) : null,
      useNet: false, net: null, wantsNet: !!lc.net, dirty: true, acc: 0, failT: null, frames: 0,
      sysid: lc.sysid ? Object.assign({ exc: 'chirp', noise: 0.01, T: 20, order: 2 }, lc.sysid) : null,
      ui: [], uiSync: [], manual: false, drag: null, trials: 0, ring: [], best: null, adjusts: 0,
      estimator: lc.estimator || null, logQ: lc.logQ !== undefined ? lc.logQ : 0, estDirty: true, estAt: 0
    };
    lab.manualInput = function (sim) { return lab.plant.manual ? lab.plant.manual(lab.drag, sim, lab) : null; };
    if (lc.limit) lab.p.Fmax = lab.p.Fcap ? Math.min(lc.limit, lab.p.Fcap) : lc.limit;
    lab.sim = C.createSim(plant, lab);
    if (lab.estimator) lab.est = C.buildEstimator(plant, lab.pm, ctrl.channels[0], lab.noise, lab.logQ, plant.dt);
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
      var ctl = lab.useNet && lab.net ? { channels: [lab.controller.channels[0]] } : lab.controller;
      if (ctl.channels[0].type === 'obs') {          // LQG: the model needs the current gains and filter
        ctl = { channels: [Object.assign({}, ctl.channels[0], { gains: Object.assign({}, lab.gains[0]), Lo: lab.est ? lab.est.L : ctl.channels[0].Lo })] };
      }
      var m = C.loopModel(plant, lab.pm, ctl);
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
      an.obsPoles = m.obsPoles || null;
    }
    lab.an = an; lab.dirty = false;
    return an;
  }

  /* ---- offline step response (on the real plant, with the current settings) ---- */
  function stepResponse(lab, T) {
    if (lab.stepCache) return lab.stepCache;
    var fake = Object.assign({}, lab, { refs: lab.refs.map(function (r, i) { return Object.assign({}, r, { type: 'hold', hold: i === 0 ? 1 : 0 }); }), noise: 0, shake: null, manual: false, drag: null, excite: null });
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
    lab.stepCache = { y: y, u: u, T: T, overshoot: Math.max(0, os) * 100, settle: failed ? Infinity : last, umax: umax, failed: failed || last > T - 0.5, diverged: failed, final: y[y.length - 1] };
    return lab.stepCache;
  }

  /* ================= views ================= */
  var V = {};

  V.sim = function (c, lab) {
    lab.plant.draw(c.ctx, c.W, c.H, lab.sim, lab, col);
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
      var dm = lab.noise > 0 && lab.hist.sm && lab.hist.sm[k];       // the noisy sensor reading, faint behind the true state
      if (dm) {
        ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();
        ctx.strokeStyle = tokens[k % 4]; ctx.globalAlpha = 0.45; ctx.lineWidth = 1; ctx.beginPath();
        dm.forEach(function (v, i) { var x = x0 + (i + CAP - dm.length) / (CAP - 1) * (x1 - x0); if (i) ctx.lineTo(x, Y(v)); else ctx.moveTo(x, Y(v)); }); ctx.stroke(); ctx.restore();
      }
      ctx.strokeStyle = tokens[k % 4]; ctx.lineWidth = 1.8; ctx.beginPath();
      d.forEach(function (v, i) { var x = x0 + (i + CAP - d.length) / (CAP - 1) * (x1 - x0); if (i) ctx.lineTo(x, Y(v)); else ctx.moveTo(x, Y(v)); }); ctx.stroke();
      text(ctx, sp.label, 6, y0 + 2, tokens[k % 4], { size: 11 });
      if (d.length) text(ctx, fmtAx(d[d.length - 1]), 6, y0 + 16, col.muted, { size: 10, mono: true, w: '400' });
    });
  };

  // What each term of the controller is contributing (P, I, D, or one per state gain).
  V.contrib = function (c, lab) {
    var ctx = c.ctx, hc = lab.hist.c, keys = Object.keys(hc), x0 = 44, x1 = c.W - 10, y0 = 24, y1 = c.H - 6, m = 1e-6;
    keys.forEach(function (k) { hc[k].forEach(function (v) { m = Math.max(m, Math.abs(v)); }); }); m *= 1.1;
    var Y = function (v) { return (y0 + y1) / 2 - clamp(v / m, -1, 1) * (y1 - y0) / 2; };
    ctx.strokeStyle = col.border; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, Y(0)); ctx.lineTo(x1, Y(0)); ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.stroke();
    text(ctx, '+' + fmtAx(m), x0 - 4, y0 - 2, col.muted, { align: 'right', size: 10, mono: true, w: '400' });
    text(ctx, '−' + fmtAx(m), x0 - 4, y1 - 10, col.muted, { align: 'right', size: 10, mono: true, w: '400' });
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

  // `head` (optional) reserves a band above the plot for the title and legend on one line, so curves never cross the text.
  function timePlot(ctx, x0, y0, x1, y1, series, yr, title, head) {
    var top = y0 + (head || 0);
    function Y(v) { return y1 - (clamp(v, yr[0], yr[1]) - yr[0]) / (yr[1] - yr[0]) * (y1 - top); }
    ctx.strokeStyle = col.border; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, top); ctx.lineTo(x0, y1); ctx.lineTo(x1, y1); ctx.stroke();
    if (yr[0] < 0 && yr[1] > 0) { ctx.save(); ctx.strokeStyle = col.border; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(x0, Y(0)); ctx.lineTo(x1, Y(0)); ctx.stroke(); ctx.restore(); }
    text(ctx, fmtAx(yr[1]), x0 - 4, top, col.muted, { align: 'right', size: 10, mono: true, w: '400' });
    text(ctx, fmtAx(yr[0]), x0 - 4, y1 - 10, col.muted, { align: 'right', size: 10, mono: true, w: '400' });
    series.forEach(function (s) {
      if (!s.data.length) return;
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 2; ctx.setLineDash(s.dash || []); ctx.beginPath();
      s.data.forEach(function (v, i) { var x = x0 + (i + (s.cap || CAP) - s.data.length) / ((s.cap || CAP) - 1) * (x1 - x0); if (i) ctx.lineTo(x, Y(v)); else ctx.moveTo(x, Y(v)); });
      ctx.stroke(); ctx.setLineDash([]);
    });
    text(ctx, title, x0 + 8, y0, col.text, { size: 11 });
    ctx.font = '400 11px ' + col.font; var lx = x0 + 8 + (head ? ctx.measureText(title).width + 16 : 0), ly = head ? y0 : y0 + 16;
    series.forEach(function (s) {
      if (!s.name) return; ctx.font = '600 11px ' + col.font; ctx.fillStyle = s.color; ctx.fillRect(lx, ly + 5, 12, 3);
      ctx.textBaseline = 'top'; ctx.textAlign = 'left'; ctx.fillText(s.name, lx + 16, ly); lx += 28 + ctx.measureText(s.name).width;
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
      c.W >= 560 ? ['Each point is L(jω): distance from the center is the gain, angle is the phase. Arrows show ω rising; dashed is negative ω. Gains above 1 are on a log scale.', col.muted, '400'] : null,
      [circ + (nq.P ? ' The open loop has ' + nq.P + ' unstable pole' + (nq.P > 1 ? 's' : '') + ', canceled only by circling −1 counterclockwise that many times.' : '')],
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
      if (an.obsPoles) an.obsPoles.forEach(function (z) { if (!f.inside(z)) return; ctx.strokeStyle = col.viz2; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(f.X(z[0]), f.Y(z[1]), 10, 0, 7); ctx.stroke(); });
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
      if (an.obsPoles) items.push(['Separation principle: the closed loop\'s poles are the 4 LQR poles plus the 4 estimator poles (ringed, orange). Trusting the sensors more moves the rings left.', col.viz2]);
      else items.push(an.placeable ? ['Drag a closed-loop pole ●: the gains are solved so the poles land where you put them.', col.viz2]
        : [lab.delay > 0 ? 'Delay on: poles use a Padé approximation and can\'t be dragged.' : 'More gains than one input can place: drag the gain sliders.', col.muted, '400']);
      if (an.obsPoles) items.length = Math.min(items.length, 2);
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

  /* ---- verifying the cart-pole's network ---- */
  var TH = 0.5, TD = 1.5;
  function verifyState(lab) {
    var v = lab.verify;
    // Following the run, the query is the state the network is fed: the noisy measurement, not the true state.
    if (v.follow) { var x = lab.sim.meas || lab.sim.x, r = C.refValue(lab.refs[0], lab.sim.t); v.e = [x[0] - r, x[1], clamp(x[2], -TH, TH), clamp(x[3], -TD, TD)]; }
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
      if (v.follow && lab.noise > 0 && lab.sim.x) {      // the true state, a dot, so the box's offset from it is the noise
        var tx = X(clamp(lab.sim.x[2], -TH, TH)), ty = Y(clamp(lab.sim.x[3], -TD, TD));
        ctx.fillStyle = col.bg; ctx.beginPath(); ctx.arc(tx, ty, 4.5, 0, 2 * Math.PI); ctx.fill();
        ctx.fillStyle = col.text; ctx.beginPath(); ctx.arc(tx, ty, 3, 0, 2 * Math.PI); ctx.fill();
      }
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
      ['Colored map: the truth, every pair of gain errors checked together.', col.muted, '400'],
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
    draw(4, mid - 4, function (v) { return 20 * Math.log10(C.cabs(v)); }, -80, 20, 'Gain (dB): true plant (thick gray) vs fitted model (dashed)', 20);
    draw(mid + 4, c.H - 18, function (v, prev) { var a = C.carg(v) * 180 / Math.PI; if (prev !== null) a = prev + C.wrap180(a - prev); return a; }, -360, 0, 'Phase (°)', 90);
    [0.01, 0.1, 1, 10].forEach(function (om) { text(ctx, String(om), X(om), c.H - 14, col.muted, { align: 'center', size: 10, mono: true, w: '400' }); });
  };

  /* ---- identification methods: Ho–Kalman (ERA), compared with least squares ---- */
  var ID_DT = 0.05, ID_NAMES = ['M', 'c', 'k'], ID_LABEL = { arx: 'Least squares (ARX)', era: 'Ho–Kalman (ERA)' };
  function idState(lab) { return lab.idm || (lab.idm = { noise: 0.01, eraOrder: 2, seed: 1 }); }
  function seeded(seed) { return function () { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }; }
  function idEstimate(lab, method) {
    var I = idState(lab);
    if (method === 'arx') return lab.sysid && lab.sysid.msd ? { M: lab.sysid.msd.M, c: lab.sysid.msd.c, k: lab.sysid.msd.k } : null;
    return I.era && I.era.est ? I.era.est : null;
  }
  function runId(lab, method) {
    var I = idState(lab), plant = lab.plant, p = lab.p, rng = seeded(4242 + Math.floor(Math.random() * 1000));
    if (method === 'era') {
      I.seed++;
      // A hammer tap: 20 N for one sample. The sampled response divided by the tap is the impulse response.
      var A = 20, de = C.experiment(plant, p, function (t) { return t < ID_DT ? A : 0; }, 20, ID_DT, I.noise, rng);
      I.era = { data: de, t0: performance.now() }; eraFit(I.era, de.y.slice(1).map(function (v) { return v / A; }), I.eraOrder);
    }
  }
  // ERA on a set of Markov parameters, at a chosen order; keeps everything the views draw.
  function eraFit(E, h, order) {
    E.h = h; E.order = order; E.rows = Math.min(30, Math.floor(h.length / 2));
    E.model = C.era(h, E.rows, order); E.est = C.ssToMsd(E.model, ID_DT);
    E.hhat = C.ssSim(E.model, [1].concat(new Array(h.length - 1).fill(0)));      // the realization's own impulse response
  }
  function age(o) { return o ? (performance.now() - o.t0) / 1000 : 0; }
  var M_COLORS = function () { return { arx: col.viz4, era: cssVar('--viz-7') || col.accent }; };

  V['id-replay'] = function (c, lab, tab) {
    var I = idState(lab), m = tab.method, d, label, k;
    var src = I.era; if (!src) { text(c.ctx, 'Press Run experiment', 14, 14, col.muted); return; }
    d = src.data; k = Math.min(d.t.length - 1, Math.floor(age(src) * 3 / d.dt));
    label = 'Replaying the experiment: t = ' + fmt(d.t[k], 1) + ' s (3× speed)';
    var x = lab.plant.x0(lab.p).slice(); x[0] = d.yTrue[k];
    var fake = { x: x, u: [d.u[k] * 4], t: -1e9, failed: false, status: 'ok' };
    lab.plant.draw(c.ctx, c.W, c.H, fake, Object.assign({}, lab, { refs: [{ type: 'hold', hold: NaN }], shake: true, replay: true, manual: false }), col);
    c.ctx.fillStyle = withAlpha(col.bgSoft, 0.9); c.ctx.fillRect(8, 6, c.W * 0.6, 40);
    text(c.ctx, ID_LABEL[m], 14, 10, col.accent, { size: 13 }); text(c.ctx, label, 14, 28, col.muted, { size: 11, mono: true, w: '400' });
  };

  // ERA: the Hankel matrix, its singular values (the order), and the realized response.
  function drawEra(c, lab, E, title) {
    var ctx = c.ctx, narrow = c.W < 560, gap = 18, x = 8;
    var w1 = narrow ? 0 : Math.min(c.H - 30, c.W * 0.22), w2 = narrow ? c.W * 0.42 : c.W * 0.3, w3 = c.W - 8 - (x + w1 + (w1 ? gap : 0) + w2 + gap);
    if (w1) {                                           // Hankel heatmap
      var H = E.model.H, n = H.length, cell = w1 / n, mx = 1e-12;
      H.forEach(function (r) { r.forEach(function (v) { mx = Math.max(mx, Math.abs(v)); }); });
      var neg = hexRgb(col.bad), zer = hexRgb(col.zero), pos = hexRgb(col.pos);
      for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) {
        var v = H[i][j] / mx, cc = v < 0 ? mix(zer, neg, Math.min(1, -v)) : mix(zer, pos, Math.min(1, v));
        ctx.fillStyle = 'rgb(' + cc.join(',') + ')'; ctx.fillRect(x + j * cell, 22 + i * cell, cell + 0.5, cell + 0.5);
      }
      text(ctx, 'Hankel matrix', x, 4, col.text, { size: 11 });
      x += w1 + gap;
    }
    // singular values, log scale
    var S = E.model.S.slice(0, 10), lo = -6, hi = 1, y0 = 22, y1 = c.H - 22;
    var Y = function (v) { var l = Math.log10(Math.max(v / S[0], 1e-12)); return y1 - (clamp(l, lo, 0) - lo) / (hi - lo) * (y1 - y0); };
    text(ctx, 'Singular values of H (log)', x, 4, col.text, { size: 11 });
    var bw = w2 / S.length;
    S.forEach(function (v, i) {
      var keep = i < E.order; ctx.fillStyle = keep ? col.accent : withAlpha(col.muted, 0.45);
      ctx.fillRect(x + i * bw + 2, Y(v), bw - 4, y1 - Y(v));
      text(ctx, String(i + 1), x + i * bw + bw / 2, y1 + 3, col.muted, { align: 'center', size: 10, mono: true, w: '400' });
    });
    ctx.save(); ctx.strokeStyle = col.accent; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(x + E.order * bw, y0); ctx.lineTo(x + E.order * bw, y1); ctx.stroke(); ctx.restore();
    text(ctx, 'keep ' + E.order, x + E.order * bw + 4, y0 + 2, col.accent, { size: 10 });
    x += w2 + gap;
    if (w3 < 90) return;
    // measured vs realized impulse response
    var h = E.h.slice(0, Math.min(E.h.length, 240)), hh = E.hhat.slice(1, h.length + 1), m2 = 1e-9;
    h.forEach(function (v) { m2 = Math.max(m2, Math.abs(v)); });
    var X = function (i) { return x + i / (h.length - 1) * w3; }, Yh = function (v) { return (y0 + y1) / 2 - clamp(v / m2, -1.1, 1.1) * (y1 - y0) / 2; };
    text(ctx, title, x, 4, col.text, { size: 11 });
    ctx.strokeStyle = withAlpha(col.muted, 0.8); ctx.lineWidth = 1; ctx.beginPath(); h.forEach(function (v, i) { if (i) ctx.lineTo(X(i), Yh(v)); else ctx.moveTo(X(i), Yh(v)); }); ctx.stroke();
    ctx.save(); ctx.setLineDash([6, 4]); ctx.strokeStyle = col.accent; ctx.lineWidth = 2; ctx.beginPath(); hh.forEach(function (v, i) { if (i) ctx.lineTo(X(i), Yh(v)); else ctx.moveTo(X(i), Yh(v)); }); ctx.stroke(); ctx.restore();
    text(ctx, 'gray: measured   dashed: order-' + E.order + ' model', x, y1 + 3, col.muted, { size: 10, w: '400' });
  }
  V['id-era'] = function (c, lab) { var E = idState(lab).era; if (E) drawEra(c, lab, E, 'Impulse response: the tap, measured'); };

  // Estimated constants against the true ones, as bars.
  V['id-result'] = function (c, lab, tab) {
    var ctx = c.ctx, e = idEstimate(lab, tab.method), trueP = lab.p;
    if (tab.method === 'era' && idState(lab).era && !e) { text(ctx, 'Order ' + idState(lab).era.order + ' has no oscillating pair to read as a mass, damper and spring: keep 2 or more bars.', 12, 26, col.muted, { size: 12 }); return; }
    text(ctx, 'What it found vs the truth (the sim knows the real m = 1, c = 0.4, k = 4)', 12, 4, col.text, { size: 11 });
    if (!e) { text(ctx, 'Run the experiment', 12, 26, col.muted, { size: 12 }); return; }
    var rows = ID_NAMES, bw = (c.W - 40) / rows.length, y1 = c.H - 30, y0 = 34;
    rows.forEach(function (nm, i) {
      var est = e[nm], tru = trueP[nm], err = (est / tru - 1) * 100, x = 20 + i * bw, mx = Math.max(est, tru) * 1.3, Hh = function (v) { return (y1 - y0) * v / mx; };
      ctx.fillStyle = withAlpha(col.muted, 0.35); ctx.fillRect(x + bw * 0.2, y1 - Hh(tru), bw * 0.25, Hh(tru));
      ctx.fillStyle = Math.abs(err) < 5 ? col.accent : Math.abs(err) < 20 ? col.viz3 : col.bad; ctx.fillRect(x + bw * 0.5, y1 - Hh(est), bw * 0.25, Hh(est));
      text(ctx, { M: 'mass m', c: 'damping c', k: 'spring k' }[nm], x + bw * 0.47, y1 + 4, col.text, { align: 'center', size: 11 });
      text(ctx, fmt(est, 3) + ' (' + (err >= 0 ? '+' : '') + fmt(err, 1) + '%)', x + bw * 0.62, y1 - Hh(est) - 16, Math.abs(err) < 5 ? col.accent : col.text, { align: 'center', size: 11, mono: true });
    });
    text(ctx, 'gray: true   color: estimate', c.W - 12, 4, col.muted, { align: 'right', size: 10, w: '400' });
  };

  // The states Ho–Kalman builds are not position and velocity: any invertible T gives the same input-output
  // behavior. For a 2nd-order fit, compare the realized states after the tap with T × the true (position, velocity).
  function hiddenStates(lab, E) {
    if (E.hid && E.hid.order === E.order && E.hid.model === E.model) return E.hid;
    if (E.order !== 2) return (E.hid = { order: E.order, model: E.model, none: true });
    var lin = C.linearize(lab.plant, lab.p), d = C.zohDiscretize(lin.A, lin.B, ID_DT), A = E.model.A, B = E.model.B, K = Math.min(E.h.length, 160);
    var r = [B[0], B[1]], q = [d.Gam[0][0], d.Gam[1][0]], xr = [], xp = [], k, a, b;
    for (k = 0; k < K; k++) {                                   // after a unit tap: realized state A^k B, true state Φ^k Γ
      xr.push(r); xp.push(q);
      r = [A[0][0] * r[0] + A[0][1] * r[1], A[1][0] * r[0] + A[1][1] * r[1]];
      q = [d.Phi[0][0] * q[0] + d.Phi[0][1] * q[1], d.Phi[1][0] * q[0] + d.Phi[1][1] * q[1]];
    }
    var S = [[0, 0], [0, 0]], Z = [[0, 0], [0, 0]];             // T = X̃ Xᵀ (X Xᵀ)⁻¹, the best fixed mix
    xp.forEach(function (v, i) { for (a = 0; a < 2; a++) for (b = 0; b < 2; b++) { S[a][b] += v[a] * v[b]; Z[a][b] += xr[i][a] * v[b]; } });
    var det = S[0][0] * S[1][1] - S[0][1] * S[1][0], Si = [[S[1][1] / det, -S[0][1] / det], [-S[1][0] / det, S[0][0] / det]];
    var Tm = [0, 1].map(function (i) { return [0, 1].map(function (j) { return Z[i][0] * Si[0][j] + Z[i][1] * Si[1][j]; }); });
    var fitted = xp.map(function (v) { return [Tm[0][0] * v[0] + Tm[0][1] * v[1], Tm[1][0] * v[0] + Tm[1][1] * v[1]]; }), e2 = 0, v2 = 0;
    xr.forEach(function (v, i) { for (var c2 = 0; c2 < 2; c2++) { e2 += Math.pow(v[c2] - fitted[i][c2], 2); v2 += v[c2] * v[c2]; } });
    return (E.hid = { order: 2, model: E.model, xr: xr, fitted: fitted, T: Tm, err: Math.sqrt(e2 / v2) });
  }
  V['id-hidden'] = function (c, lab) {
    var ctx = c.ctx, E = idState(lab).era; if (!E) return;
    var H = hiddenStates(lab, E);
    if (H.none) { text(ctx, 'Order ' + E.order + ': keep exactly 2 bars to compare the realized states with position and velocity.', 12, 12, col.muted, { size: 12 }); return; }
    var wide = c.W >= 560, x1 = wide ? c.W * 0.62 : c.W - 10, mid = c.H * 0.5, n = H.xr.length;
    [0, 1].forEach(function (j) {
      var rr = H.xr.map(function (v) { return v[j]; }), ff = H.fitted.map(function (v) { return v[j]; }), y0 = j ? mid + 8 : 4, y1 = j ? c.H - 6 : mid - 2;
      timePlot(ctx, 44, y0, x1, y1, [{ data: rr, cap: n, color: j ? col.viz2 : col.viz1, name: 'realized' }, { data: ff, cap: n, color: col.text, width: 1.4, name: 'mix of true x, ẋ' }],
        range([rr, ff], 1e-9), 'Realized state ' + (j + 1) + ' (solid) vs a mix of x, ẋ (dashed)', 18);
    });
    if (wide) notes(ctx, { x0: x1 + 18, x1: c.W - 10, y: 6 }, [
      ['Only the position is measured, but the model has 2 states. The ones Ho–Kalman builds are not position and velocity.', col.muted, '400'],
      ['Each is a fixed mix of them: x̃ = T·(x, ẋ), with T = [' + fmt(H.T[0][0], 2) + ', ' + fmt(H.T[0][1], 2) + '; ' + fmt(H.T[1][0], 2) + ', ' + fmt(H.T[1][1], 2) + '].', col.viz1],
      ['Mismatch after the best T: ' + fmt(100 * H.err, 2) + '%', H.err < 0.05 ? col.accent : col.bad],
      ['Any invertible T gives the same input and output, so the data cannot say which coordinates are "real".', col.muted, '400']
    ]);
  };

  // Three ways to fit the same noisy recording, side by side: mean error in m, c, k over a few recordings (LabCore.compareFits).
  V['id-vs'] = function (c, lab) {
    var ctx = c.ctx, I = idState(lab), V2 = I.vs, now = performance.now();
    if ((!V2 || V2.noise !== I.noise || V2.seed !== I.seed) && (!V2 || now - V2.at > 350)) V2 = I.vs = { noise: I.noise, seed: I.seed, at: now, res: C.compareFits(lab.plant, lab.p, I.noise, I.seed, 4) };
    var R = V2.res, stale = V2.noise !== I.noise || V2.seed !== I.seed, narrow = c.W < 560, x0 = 46, x1 = narrow ? c.W - 10 : c.W * 0.64, y0 = 30, y1 = c.H - 24;
    var meth = [['arx', 'Least squares (ARX), position only', col.viz1], ['era', 'Ho–Kalman, position only', col.viz2], ['ss', 'State least squares, position and velocity', col.viz4]];
    var cap = 100, Y = function (v) { return y1 - Math.min(v, cap) / cap * (y1 - y0); };
    text(ctx, 'Mean error of each constant over 4 noisy recordings' + (stale ? ' (updating…)' : ''), x0, 2, col.text, { size: 11 });
    ctx.strokeStyle = col.border; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.lineTo(x1, y1); ctx.stroke();
    [0, 50, 100].forEach(function (v) { text(ctx, v + (v === 100 ? '%+' : '%'), x0 - 4, Y(v) - 5, col.muted, { align: 'right', size: 10, mono: true, w: '400' }); });
    var gw = (x1 - x0) / 3;
    ['mass m', 'damping c', 'spring k'].forEach(function (nm, g) {
      text(ctx, nm, x0 + g * gw + gw / 2, y1 + 4, col.text, { align: 'center', size: 11 });
      meth.forEach(function (m, i) {
        var v = R[m[0]] ? R[m[0]][g] : null, bw = (gw - 16) / 3, bx = x0 + g * gw + 8 + i * bw;
        if (v === null) { text(ctx, 'none', bx + bw / 2, y1 - 14, col.muted, { align: 'center', size: 10 }); return; }
        ctx.fillStyle = m[2]; ctx.fillRect(bx + 1, Y(v), bw - 2, y1 - Y(v));
        text(ctx, fmt(v, v < 10 ? 1 : 0) + '%', bx + bw / 2, Y(v) - 13, v > 50 ? col.bad : col.text, { align: 'center', size: 10, mono: true, w: '400' });
      });
    });
    if (!narrow) {
      var ny = 6; meth.forEach(function (m) { ctx.fillStyle = m[2]; ctx.fillRect(x1 + 18, ny + 4, 10, 10); text(ctx, m[1], x1 + 34, ny + 3, col.text, { size: 11 }); ny += 18; });
      notes(ctx, { x0: x1 + 18, x1: c.W - 10, y: ny + 6 }, [
        ['No noise: all agree. Noise biases state least squares and drifts ARX.', col.muted, '400'],
        ['Ho–Kalman drops the small singular values, so it stays put.', col.muted, '400']
      ]);
    }
  };

  /* ---- change of basis: the same motion in different coordinates ---- */
  var BASIS_A = [[0, 1], [-4, -0.4]], BASIS_B = [0, 1], BASIS_C = [1, 0];
  function basisState(tab) { return tab.basis || (tab.basis = { phi: 35, s1: 1.4, s2: 0.7 }); }
  function basisModel(tab) {                                   // T = R(φ) · diag(s1, s2); x̃ = T x
    var b = basisState(tab), cs = Math.cos(b.phi * Math.PI / 180), sn = Math.sin(b.phi * Math.PI / 180);
    var T = [[cs * b.s1, -sn * b.s2], [sn * b.s1, cs * b.s2]], det = T[0][0] * T[1][1] - T[0][1] * T[1][0];
    var Ti = [[T[1][1] / det, -T[0][1] / det], [-T[1][0] / det, T[0][0] / det]];
    function mm(X, Y) { return X.map(function (r) { return Y[0].map(function (_, j) { return r[0] * Y[0][j] + r[1] * Y[1][j]; }); }); }
    var Ap = mm(mm(T, BASIS_A), Ti), Bp = [T[0][1] * BASIS_B[1], T[1][1] * BASIS_B[1]], Cp = [BASIS_C[0] * Ti[0][0], BASIS_C[0] * Ti[0][1]];
    var d = C.zohDiscretize(BASIS_A, [[0], [1]], 0.02), x = [1, 0], xs = [], xt = [];
    for (var k = 0; k < 300; k++) { xs.push(x); xt.push([T[0][0] * x[0] + T[0][1] * x[1], T[1][0] * x[0] + T[1][1] * x[1]]); x = [d.Phi[0][0] * x[0] + d.Phi[0][1] * x[1], d.Phi[1][0] * x[0] + d.Phi[1][1] * x[1]]; }
    return { T: T, Ti: Ti, Ap: Ap, Bp: Bp, Cp: Cp, xs: xs, xt: xt, t: xs.map(function (_, k) { return k * 0.02; }) };
  }
  function phasePlot(ctx, box, traj, title, arrows) {
    var x0 = box.x0, y0 = box.y0, w = box.x1 - box.x0, h = box.y1 - box.y0, side = Math.min(w, h - 16), cx = x0 + w / 2, cy = y0 + 16 + (h - 16) / 2, m = 1e-6;
    traj.forEach(function (v) { m = Math.max(m, Math.abs(v[0]), Math.abs(v[1])); }); (arrows || []).forEach(function (a) { m = Math.max(m, Math.abs(a.v[0]), Math.abs(a.v[1])); }); m *= 1.15;
    var X = function (v) { return cx + v / m * side / 2; }, Y = function (v) { return cy - v / m * side / 2; };
    text(ctx, title, x0, y0, col.text, { size: 11 });
    ctx.strokeStyle = col.border; ctx.lineWidth = 1; ctx.strokeRect(cx - side / 2 + .5, cy - side / 2 + .5, side - 1, side - 1);
    ctx.beginPath(); ctx.moveTo(cx - side / 2, cy); ctx.lineTo(cx + side / 2, cy); ctx.moveTo(cx, cy - side / 2); ctx.lineTo(cx, cy + side / 2); ctx.stroke();
    ctx.strokeStyle = col.viz1; ctx.lineWidth = 1.8; ctx.beginPath(); traj.forEach(function (v, i) { if (i) ctx.lineTo(X(v[0]), Y(v[1])); else ctx.moveTo(X(v[0]), Y(v[1])); }); ctx.stroke();
    dot(ctx, X(traj[0][0]), Y(traj[0][1]), col.viz1);
    (arrows || []).forEach(function (a) {
      var ex = X(a.v[0]), ey = Y(a.v[1]), ang = Math.atan2(ey - cy, ex - cx);
      ctx.strokeStyle = a.color; ctx.fillStyle = a.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex - 8 * Math.cos(ang - 0.4), ey - 8 * Math.sin(ang - 0.4)); ctx.lineTo(ex - 8 * Math.cos(ang + 0.4), ey - 8 * Math.sin(ang + 0.4)); ctx.fill();
      text(ctx, a.label, ex + (ex > cx ? 4 : -4), ey - 6, a.color, { size: 10, align: ex > cx ? 'left' : 'right' });
    });
  }
  V['basis-phase'] = function (c, lab, tab) {
    var M = basisModel(tab), ctx = c.ctx, half = c.W / 2 - 6;
    phasePlot(ctx, { x0: 8, y0: 4, x1: half, y1: c.H - 4 }, M.xs, 'Physical states: position x, velocity ẋ', [{ v: [0.5, 0], color: col.viz2, label: 'x axis' }, { v: [0, 0.5], color: col.viz3, label: 'ẋ axis' }]);
    var e1 = [M.T[0][0] * 0.5, M.T[1][0] * 0.5], e2 = [M.T[0][1] * 0.5, M.T[1][1] * 0.5];
    phasePlot(ctx, { x0: half + 12, y0: 4, x1: c.W - 8, y1: c.H - 4 }, M.xt, 'The same motion in realized states x̃ = T x', [{ v: e1, color: col.viz2, label: 'x axis' }, { v: e2, color: col.viz3, label: 'ẋ axis' }]);
  };
  V['basis-time'] = function (c, lab, tab) {
    var M = basisModel(tab), ctx = c.ctx, n = M.t.length, mid = c.H * 0.4, y = M.Cp[0], out = M.xt.map(function (v) { return M.Cp[0] * v[0] + M.Cp[1] * v[1]; });
    var xp = M.xs.map(function (v) { return v[0]; });
    timePlot(ctx, 44, 4, c.W - 10, mid - 4, [{ data: out, cap: n, color: col.text, width: 2, name: 'y = C′ x̃' }, { data: xp, cap: n, color: col.accent, width: 1, name: 'position x' }], range([xp], 0.1),
      'The output y = C′x̃ is the position, whatever T is', 18);
    var a = M.xt.map(function (v) { return v[0]; }), b = M.xt.map(function (v) { return v[1]; });
    timePlot(ctx, 44, mid + 4, c.W - 10, c.H - 6, [{ data: a, cap: n, color: col.viz1, name: 'x̃₁' }, { data: b, cap: n, color: col.viz2, name: 'x̃₂' }], range([a, b], 0.1),
      'The realized states change with T: mixes of x and ẋ', 18);
  };
  V['basis-matrices'] = function (c, lab, tab) {
    var M = basisModel(tab), ctx = c.ctx, f = function (v) { return (v >= 0 ? ' ' : '') + v.toFixed(2); }, row = function (m, i) { return m[i].map(f).join('  '); };
    var lam = function (A) { return C.eig(A).map(function (z) { return fmt(z[0], 2) + (z[1] ? (z[1] >= 0 ? ' + ' : ' − ') + fmt(Math.abs(z[1]), 2) + 'j' : ''); }).join(',  '); };
    var lines = [
      ['Physical model   A = [' + row(BASIS_A, 0) + ' ; ' + row(BASIS_A, 1) + ']', col.text],
      ['Change of basis  T = [' + row(M.T, 0) + ' ; ' + row(M.T, 1) + ']', col.viz1],
      ['Realized model   A′ = T A T⁻¹ = [' + row(M.Ap, 0) + ' ; ' + row(M.Ap, 1) + ']', col.viz1],
      ['                 B′ = T B = [' + f(M.Bp[0]) + ' ; ' + f(M.Bp[1]) + ']      C′ = C T⁻¹ = [' + f(M.Cp[0]) + '  ' + f(M.Cp[1]) + ']', col.viz1],
      ['Poles of A:   ' + lam(BASIS_A), col.accent], ['Poles of A′:  ' + lam(M.Ap) + '   (the same)', col.accent],
      ['Changes: every number in A, B, C and what each state means.  Stays: poles, stability, the output, the impulse response.', col.muted]
    ];
    var y = 8; lines.forEach(function (l, i) { text(ctx, l[0], 12, y, l[1], { size: i === 6 ? 11 : 12, mono: i < 6, w: i === 6 ? '400' : '500' }); y += i === 6 ? 20 : 19; });
  };
  var ctrlBasis = function (panel, lab, tab) {
    var b = basisState(tab);
    h3(panel, 'Change the coordinates');
    slider(panel, tab.id + '-phi', 'Rotation', -90, 90, 1, b.phi, function (v) { return fmt(v, 0) + '°'; }, function (v) { b.phi = v; });
    slider(panel, tab.id + '-s1', 'Stretch state 1', -1, 1, 0.02, Math.log10(b.s1), function (v) { return '×' + fmt(Math.pow(10, v), 2); }, function (v) { b.s1 = Math.pow(10, v); });
    slider(panel, tab.id + '-s2', 'Stretch state 2', -1, 1, 0.02, Math.log10(b.s2), function (v) { return '×' + fmt(Math.pow(10, v), 2); }, function (v) { b.s2 = Math.pow(10, v); });
    hint(panel, 'T = rotation × stretch. Identity is rotation 0°, stretch ×1.');
  };

  /* ---- unseen states: read a hard-to-measure state from a model built out of the cheap sensors ---- */
  function dispUnit(plant, i) { var u = plant.units[i]; return u === 'rad' ? { k: 180 / Math.PI, u: '°' } : u === 'rad/s' ? { k: 180 / Math.PI, u: '°/s' } : { k: 1, u: u }; }
  function unseenState(tab) { return tab.un || (tab.un = { target: tab.unseen.targets[0], order: tab.unseen.order, noise: 0.1, seed: 1, res: null }); }
  function unseenRun(lab, tab) {
    var U = unseenState(tab);
    U.res = C.unseen(lab.plant, Object.assign({}, lab.plant.params), { outs: tab.unseen.outs, target: U.target, order: U.order, noise: U.noise, seed: U.seed, dt: 0.05, amp: tab.unseen.amp, N: tab.unseen.N });
  }
  V['unseen-map'] = function (c, lab, tab) {
    var U = unseenState(tab), R = U.res; if (!R) return;
    var ctx = c.ctx, plant = lab.plant, n = plant.n, narrow = c.W < 560, x = 10, w1 = narrow ? c.W * 0.34 : c.W * 0.3, y0 = 24, y1 = c.H - 22;
    text(ctx, 'Singular values (log): the states the tap reveals', x, 4, col.text, { size: 11 });
    var S = R.S.slice(0, 8), lo = -14, bw = w1 / S.length, Yv = function (v) { var l = Math.log10(Math.max(v / S[0], 1e-14)); return y1 - (l - lo) / (0 - lo) * (y1 - y0); };
    S.forEach(function (v, i) { var keep = i < R.order; ctx.fillStyle = keep ? col.accent : withAlpha(col.muted, 0.45); ctx.fillRect(x + i * bw + 2, Yv(v), bw - 4, y1 - Yv(v)); text(ctx, String(i + 1), x + i * bw + bw / 2, y1 + 3, col.muted, { align: 'center', size: 10, mono: true, w: '400' }); });
    var hx = x + w1 + 24, cw = Math.min(46, (c.W - hx - 90) / R.order), rh = Math.min(22, (y1 - y0) / n);
    text(ctx, 'Each physical state as a mix of the realized ones (● measured, boxed: to read)', hx, 4, col.text, { size: 11 });
    var neg = hexRgb(col.bad), zer = hexRgb(col.zero), pos = hexRgb(col.pos);
    plant.stateNames.forEach(function (nm, i) {
      var wv = R.W[i].w, mx = 1e-12, measured = tab.unseen.outs.indexOf(i) >= 0, yy = y0 + i * rh; wv.forEach(function (v) { mx = Math.max(mx, Math.abs(v)); });
      wv.forEach(function (v, j) { var q = v / mx, cc = q < 0 ? mix(zer, neg, Math.min(1, -q)) : mix(zer, pos, Math.min(1, q)); ctx.fillStyle = 'rgb(' + cc.join(',') + ')'; ctx.fillRect(hx + 60 + j * cw, yy, cw - 1, rh - 2); });
      text(ctx, nm + (measured ? ' ●' : ''), hx + 54, yy + 3, i === U.target ? col.accent : col.text, { align: 'right', size: 11, w: i === U.target ? '700' : '400' });
      if (i === U.target) { ctx.strokeStyle = col.accent; ctx.lineWidth = 1.5; ctx.strokeRect(hx + 60 - 1, yy - 1, R.order * cw + 1, rh); }
    });
    for (var j = 0; j < R.order; j++) text(ctx, 'x̃' + (j + 1), hx + 60 + j * cw + cw / 2, y0 + n * rh + 2, col.muted, { align: 'center', size: 10, mono: true, w: '400' });
  };
  V['unseen-fit'] = function (c, lab, tab) {
    var U = unseenState(tab), R = U.res; if (!R) return;
    var plant = lab.plant, dsp = dispUnit(plant, U.target), n = R.t.length, tr = R.truth.map(function (v) { return v * dsp.k; }), es = R.est.map(function (v) { return v * dsp.k; });
    timePlot(c.ctx, 44, 4, c.W - 10, c.H - 18, [{ data: tr, cap: n, color: col.muted, width: 2, name: 'true' }, { data: es, cap: n, color: col.accent, width: 1.6, name: 'read from the realized states' }], range([tr, es], 1e-9),
      plant.stateNames[U.target] + ' (' + dsp.u + '), fresh input: true vs read from the model (fit ' + fmt(R.fit, 1) + '%)', 18);
    text(c.ctx, 'Calibrated once against the hard sensor (noise ' + fmt(100 * U.noise, 0) + '% of the signal), then read from ' + tab.unseen.outs.map(function (o) { return plant.stateNames[o]; }).join(' and ') + ' alone.', 48, c.H - 14, col.muted, { size: 10, w: '400' });
  };
  var ctrlUnseen = function (panel, lab, tab) {
    var U = unseenState(tab), plant = lab.plant;
    h3(panel, 'Hidden state to read');
    toggle(panel, 'Hidden state', tab.unseen.targets.map(function (i) { return [i, plant.stateNames[i]]; }), U.target, function (v) { U.target = v; unseenRun(lab, tab); });
    h3(panel, 'Model order (bars kept)');
    toggle(panel, 'Model order', tab.unseen.orders.map(function (o) { return [o, String(o)]; }), U.order, function (v) { U.order = v; unseenRun(lab, tab); });
    slider(panel, tab.id + '-un-noise', 'Calibration noise', 0, 0.5, 0.01, U.noise, function (v) { return fmt(100 * v, 0) + '%'; }, function (v) { U.noise = v; unseenRun(lab, tab); });
    button(panel, 'Recalibrate', function () { U.seed++; unseenRun(lab, tab); });
    hint(panel, 'Calibrating means measuring the hard state once (a vane, a tachometer, a test rig) while exciting the plant.');
    var t = telemetry(panel, [['fit', 'Fit on fresh input']]);
    tab.syncUnseen = function () { var r = U.res; setV(t.fit, r ? fmt(r.fit, 1) + '%' : '-', r && r.fit < 90); };
    unseenRun(lab, tab);
  };

  /* ---- your own data: record from the live sim, then identify ---- */
  function recState(lab) { return lab.rec || (lab.rec = { on: false, u: [], y: [], acc: 0, noise: 0.01, shaker: false, res: null }); }
  function recordTick(lab) {                         // called every plant step while recording
    var R = recState(lab); if (!R.on) return;
    R.acc += lab.plant.dt; if (R.acc + 1e-9 < ID_DT) return; R.acc = 0;
    R.u.push(lab.sim.u[0]); R.y.push(lab.sim.x[0] + R.noise * C.gaussian(Math.random));
    if (R.u.length * ID_DT >= 120) R.on = false;
  }
  function identifyRecording(lab) {
    recState(lab).on = false;                          // identifying ends the recording
    var R = recState(lab), N = R.u.length, cut = Math.floor(N * 0.7), res = { rows: [], cut: cut, n: N };
    if (N * ID_DT < 10) { R.res = { error: 'Record at least 10 s (longer is better).' }; return; }
    var uf = R.u.slice(0, cut), yf = R.y.slice(0, cut);
    function add(m, est, yh) { res.rows.push({ m: m, est: est, yh: yh, fit: yh ? C.fitPercent(R.y.slice(cut), yh.slice(cut)) : null }); }
    var ord = lab.sysid ? lab.sysid.order : 2, ax = C.arxFitIV(uf, yf, ord, ord), am = C.arxToMsd(ax, ID_DT);
    add('arx', am, C.arxSim(ax, R.u));
    var L = Math.min(160, Math.floor(cut / 4)), h = C.firFit(uf, yf, L), E = {}; eraFit(E, h, idState(lab).eraOrder);
    add('era', E.est, C.ssSim(E.model, R.u)); res.era = E; res.L = L;
    var energy = uf.reduce(function (a, v) { return a + v * v; }, 0) / uf.length;
    res.weak = energy < 0.05;
    R.res = res;
  }
  // Excitation the visitor can switch on while recording.
  function exciteFn(lab) {
    var R = recState(lab), tapUntil = -1, lvl = 0, next = 0;
    return function (t) {
      var v = 0;
      if (R.tapAt !== undefined && R.tapAt !== null) { tapUntil = t + ID_DT; R.tapAt = null; }
      if (t < tapUntil) v += 20;
      if (R.shaker) { if (t >= next) { lvl = Math.random() < 0.5 ? 2 : -2; next = t + 0.2 + 0.8 * Math.random(); } v += lvl; }
      return v;
    };
  }
  V['rec-data'] = function (c, lab) {
    var R = recState(lab), ctx = c.ctx, n = R.u.length;
    if (!n) { wrapText(ctx, 'Press Record, then excite the mass: drag it (Manual), tap it, or switch on the random shaker. You can also let the PID run while you record.', 12, 12, c.W - 24, col.muted, { size: 12 }); return; }
    var mid = c.H * 0.4, cap = Math.max(n, 200);
    timePlot(ctx, 44, 4, c.W - 10, mid - 4, [{ data: R.u, cap: cap, color: col.viz2, name: 'force F (N)' }], range([R.u], 1), (R.on ? '● Recording ' : 'Recorded ') + fmt(n * ID_DT, 1) + ' s');
    timePlot(ctx, 44, mid + 4, c.W - 10, c.H - 6, [{ data: R.y, cap: cap, color: col.viz1, name: 'measured x (m)' }], range([R.y], 0.1), 'Position, as the sensor sees it');
    if (R.res && R.res.cut) { var xc = 44 + R.res.cut / (cap - 1) * (c.W - 54); ctx.save(); ctx.setLineDash([4, 3]); ctx.strokeStyle = col.text; ctx.beginPath(); ctx.moveTo(xc, 4); ctx.lineTo(xc, c.H - 6); ctx.stroke(); ctx.restore();
      text(ctx, 'fit ← | → check', xc, c.H - 18, col.text, { align: 'center', size: 10 }); }
  };
  V['rec-fit'] = function (c, lab) {
    var R = recState(lab), ctx = c.ctx, res = R.res, cols = M_COLORS();
    if (!res) { wrapText(ctx, 'When you have a recording, press Identify. The first 70% is used to fit each model, the last 30% to check it.', 12, 12, c.W - 24, col.muted, { size: 12 }); return; }
    if (res.error) { text(ctx, res.error, 12, 12, col.bad, { size: 12 }); return; }
    var narrow = c.W < 560, tw = narrow ? c.W - 16 : c.W * 0.5, x = [10, tw * 0.42, tw * 0.58, tw * 0.74, tw - 4], y = 6;
    text(ctx, 'Identified from your data', 10, y, col.text, { size: 12 }); y += 20;
    ['Method', 'm', 'c', 'k', 'check fit'].forEach(function (hh, i) { text(ctx, hh, x[i], y, col.muted, { size: 11, align: i === 4 ? 'right' : 'left' }); }); y += 18;
    res.rows.forEach(function (r) {
      text(ctx, ID_LABEL[r.m].split(' (')[0], x[0], y, cols[r.m], { size: 12 });
      if (r.est) ID_NAMES.forEach(function (nm, i) { text(ctx, fmt(r.est[nm], 2), x[i + 1], y, col.text, { size: 12, mono: true }); });
      else text(ctx, 'no 2nd-order reading', x[1], y, col.muted, { size: 11, w: '400' });
      text(ctx, r.fit === null ? '-' : fmt(r.fit, 0) + '%', x[4], y, r.fit > 90 ? col.accent : col.text, { size: 12, mono: true, align: 'right' });
      y += 20;
    });
    text(ctx, 'true', x[0], y, col.muted, { size: 12 }); ID_NAMES.forEach(function (nm, i) { text(ctx, fmt(lab.p[nm], 2), x[i + 1], y, col.muted, { size: 12, mono: true }); }); y += 22;
    if (res.weak) wrapText(ctx, 'Your input was gentle: push harder or longer, or switch on the shaker, so the data has something to say.', 10, y, tw - 10, col.viz3, { size: 11 });
    if (narrow) return;
    // the held-out part, measured vs each model
    var x0 = tw + 30, n = res.n, k0 = res.cut, ys = R.y.slice(k0), ser = [{ data: ys, cap: ys.length, color: withAlpha(col.muted, 0.8), width: 1, name: 'measured' }];
    res.rows.forEach(function (r) { if (r.yh) ser.push({ data: r.yh.slice(k0), cap: ys.length, color: cols[r.m], width: 1.6 }); });
    timePlot(ctx, x0, 4, c.W - 10, c.H - 6, ser, range([ys], 0.1), 'The last 30%: never used for fitting');
  };
  var ctrlRecord = function (panel, lab, tab) {
    var R = recState(lab);
    lab.excite = exciteFn(lab);
    h3(panel, 'Record');
    var recBtn = button(panel, 'Record', function () {
      if (R.on) { R.on = false; } else { R.on = true; R.u = []; R.y = []; R.acc = 0; R.res = null; }
      recBtn.textContent = R.on ? '■ Stop recording' : 'Record';
    });
    tab.syncRec = function () { var t = R.on ? '■ Stop recording (' + fmt(R.u.length * ID_DT, 0) + ' s)' : 'Record'; if (recBtn.textContent !== t) recBtn.textContent = t; };
    h3(panel, 'Excite it');
    button(panel, 'Tap the mass', function () { R.tapAt = lab.sim.t; });
    toggle(panel, 'Random shaker', [[false, 'Shaker off'], [true, 'Shaker on']], false, function (v) { R.shaker = v; });
    slider(panel, tab.id + '-rnoise', 'Sensor noise', 0, 0.05, 0.001, R.noise, function (v) { return fmt(v * 1000, 0) + ' mm'; }, function (v) { R.noise = v; });
    button(panel, 'Identify', function () { identifyRecording(lab); });
    button(panel, 'Download CSV', function () {
      if (!R.u.length) return;
      var rows = ['t_s,force_N,position_measured_m'];
      R.u.forEach(function (u, k) { rows.push((k * ID_DT).toFixed(3) + ',' + u.toFixed(5) + ',' + R.y[k].toFixed(6)); });
      download('mass-spring-recording.csv', rows.join('\n') + '\n', 'text/csv');
    });
    hint(panel, 'The CSV has time, the force on the mass, and the position the sensor read, sampled at ' + fmt(1 / ID_DT, 0) + ' Hz. Fit it with your own tools and compare.');
  };
  function download(name, body, type) {
    var url = URL.createObjectURL(new Blob([body], { type: type })), a = el('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ---- state estimation ---- */
  function updateEstimator(lab) {
    var ch = lab.controller.channels[0];
    lab.est = C.buildEstimator(lab.plant, lab.pm, ch, lab.noise, lab.logQ, lab.plant.dt);
    lab.estDirty = false; lab.estAt = performance.now(); changed(lab);
  }
  // True vs estimated rates, and the noisy angle the estimator is given.
  V['est-states'] = function (c, lab) {
    var ctx = c.ctx, E = lab.hist.est || [], spec = lab.plant.est, lanes = spec.lanes.map(function (ln, k) {
      return [ln.label, E[k] && E[k].m, E[k] && E[k].t, ln.measured ? col.muted : col.viz2, col.text, ln.measured];
    }), n = lanes.length, lh = (c.H - 6) / n, x0 = 10, x1 = c.W - 10;
    lanes.forEach(function (ln, k) {
      var a = ln[1] || [], b = ln[2] || [], y0 = 4 + k * lh, y1 = y0 + lh - 6, m = 1e-6;
      b.forEach(function (v) { m = Math.max(m, Math.abs(v)); }); a.forEach(function (v) { m = Math.max(m, Math.min(Math.abs(v), 4 * m + 1e-6)); }); m *= 1.15;
      var Y = function (v) { return (y0 + y1) / 2 + 8 - clamp(v / m, -1, 1) * (y1 - y0 - 16) / 2; };
      [[a, ln[3], ln[5] ? 1 : 1.6], [b, ln[4], 1.4]].forEach(function (sr, si) {
        ctx.strokeStyle = sr[1]; ctx.lineWidth = sr[2]; ctx.setLineDash(si === 1 ? [5, 3] : []); ctx.beginPath();
        sr[0].forEach(function (v, i) { var x = x0 + (i + CAP - sr[0].length) / (CAP - 1) * (x1 - x0); if (i) ctx.lineTo(x, Y(v)); else ctx.moveTo(x, Y(v)); }); ctx.stroke(); ctx.setLineDash([]);
      });
      var err = 0; a.forEach(function (v, i) { err += Math.pow(v - (b[i] || 0), 2); }); err = a.length ? Math.sqrt(err / a.length) : 0;
      text(ctx, ln[0], x0 + 4, y0, col.text, { size: 11 });
      if (a.length) text(ctx, 'error ' + fmtG(err), x1 - 4, y0, ln[5] ? col.muted : err > 0.25 * m ? col.bad : col.accent, { size: 11, mono: true, align: 'right' });
    });
  };
  function estStats(lab) {
    var E = lab.hist.est || [], L = E[lab.plant.est.rate] || { m: [], t: [] }, u = lab.hist.u[0] || [], e = 0, uu = 0;
    L.t.forEach(function (v, i) { e += Math.pow(L.m[i] - v, 2); }); u.forEach(function (v) { uu += v * v; });
    return { rate: L.t.length ? Math.sqrt(e / L.t.length) : null, force: u.length ? Math.sqrt(uu / u.length) : null };
  }
  var ctrlEstimator = function (panel, lab, tab) {
    h3(panel, 'Where the rates come from');
    if (!tab.fixedEstimator) toggle(panel, 'Estimator', [['diff', 'Differencing'], ['kalman', 'Kalman filter']], lab.estimator, function (v) { lab.estimator = v; lab.sim.xhat = null; });
    else hint(panel, tab.fixedEstimator);
    if (tab.trust !== false) {
      slider(panel, tab.id + '-q', 'Trust: model ↔ sensors', -2, 4, 0.1, lab.logQ, function (v) { return v < 0.5 ? 'model' : v > 2.5 ? 'sensors' : 'balanced'; }, function (v) { lab.logQ = v; lab.estDirty = true; });
      hint(panel, 'Left: the filter trusts its model and smooths hard. Right: it believes each new reading and reacts fast.');
    }
    var t = telemetry(panel, [['r', 'Rate error'], ['f', 'Force (RMS)'], ['falls', 'Falls']].concat(tab.compareLqr ? [['lqr', 'LQR, all measured'], ['now', 'With this estimator']] : []));
    var lqrM = null;
    if (tab.compareLqr) {
      var lp = lab.plant, mm = C.loopModel(lp, lab.pm, lp.controllers.lqr), K = mm.K([lab.gains[0]]);
      lqrM = C.margins(C.freqResponse(function (s2) { return C.loopAt(mm, K, 0, 0, s2); }, GRID));
    }
    tab.syncEst = function () {
      var st = estStats(lab);
      setV(t.r, st.rate === null ? '-' : fmt(st.rate, st.rate < 10 ? 1 : 0) + ' ' + lab.plant.est.unit, st.rate > (lab.plant.est.unit === 'm/s' ? 0.5 : 20));
      setV(t.f, st.force === null ? '-' : fmt(st.force, 1) + ' N', st.force > 5);
      setV(t.falls, String(lab.trials), lab.trials > 0);
      if (lqrM) {
        setV(t.lqr, fmt(lqrM.pm, 0) + '°, ' + fmt(lqrM.gmDown, 1) + ' dB');
        var an = analyze(lab), mg = an.ch[0].mg;
        setV(t.now, an.stable && mg.pm !== null ? fmt(mg.pm, 0) + '°, ' + (mg.gmDown === null ? '∞' : fmt(mg.gmDown, 1)) + ' dB' : 'unstable', !an.stable || mg.gmDown > -6);
      }
    };
  };

  /* ---- discretization ---- */
  var DM = { zoh: 'Zero-order hold', fe: 'Forward Euler', be: 'Backward Euler', tu: 'Tustin' };
  function dmColors() { return { zoh: col.accent, fe: col.bad, be: col.viz1, tu: col.viz3 }; }
  function sampState(lab) { return lab.samp || (lab.samp = { fs: 4, hold: 'zoh', bits: 0 }); }
  // Least-squares sine at a known frequency through the recent trace: amplitude and phase.
  function fitSine(t, y, w) {
    var ss = 0, sc = 0, cc = 0, ys = 0, yc = 0;
    t.forEach(function (tt, i) { var a = Math.sin(w * tt), b = Math.cos(w * tt); ss += a * a; sc += a * b; cc += b * b; ys += y[i] * a; yc += y[i] * b; });
    var det = ss * cc - sc * sc; return det > 1e-12 ? [(ys * cc - yc * sc) / det, (yc * ss - ys * sc) / det] : [0, 0];
  }
  V['samp-time'] = function (c, lab) {
    var S = sampState(lab), H = lab.hiRes || { t: [], y: [] }, ctx = c.ctx; if (H.t.length < 10) return;
    var Ts = 1 / S.fs, w = lab.w, f = w / (2 * Math.PI), win = clamp(Math.max(4 / f, 10 * Ts), 2, 10);
    var tEnd = H.t[H.t.length - 1], t0 = tEnd - win, idx = H.t.findIndex(function (tt) { return tt >= t0; });
    var tt = H.t.slice(idx), yy = H.y.slice(idx), amp = 1e-6; yy.forEach(function (v) { amp = Math.max(amp, Math.abs(v)); });
    var x0 = 44, x1 = c.W - 10, y0 = 22, y1 = c.H - 20, ymax = amp * 1.3;
    var X = function (t) { return x0 + (t - t0) / win * (x1 - x0); }, Y = function (v) { return (y0 + y1) / 2 - v / ymax * (y1 - y0) / 2; };
    ctx.strokeStyle = col.border; ctx.beginPath(); ctx.moveTo(x0, Y(0)); ctx.lineTo(x1, Y(0)); ctx.stroke();
    ctx.strokeStyle = withAlpha(col.muted, 0.7); ctx.lineWidth = 1.5; ctx.beginPath();
    tt.forEach(function (t, i) { if (i) ctx.lineTo(X(t), Y(yy[i])); else ctx.moveTo(X(t), Y(yy[i])); }); ctx.stroke();
    // samples on an absolute time grid, quantized like an ADC with a ±(1.2·amplitude) range
    var levels = S.bits ? Math.pow(2, S.bits) : 0, full = amp * 1.2, samples = [];
    for (var k = Math.ceil(t0 / Ts); k * Ts <= tEnd; k++) {
      var ts = k * Ts, j = Math.min(tt.length - 1, Math.max(0, Math.round((ts - tt[0]) / (H.dt || 0.01)))), v = yy[j];
      if (levels) { var q = 2 * full / (levels - 1); v = clamp(Math.round((v + full) / q) * q - full, -full, full); }
      samples.push([ts, v]);
    }
    if (S.hold !== 'none' && samples.length > 1) {
      ctx.strokeStyle = col.viz1; ctx.lineWidth = 2; ctx.beginPath();
      samples.forEach(function (sp, i) {
        if (!i) { ctx.moveTo(X(sp[0]), Y(sp[1])); return; }
        if (S.hold === 'zoh') ctx.lineTo(X(sp[0]), Y(samples[i - 1][1]));
        ctx.lineTo(X(sp[0]), Y(sp[1]));
      });
      if (S.hold === 'zoh') ctx.lineTo(X(Math.min(tEnd, samples[samples.length - 1][0] + Ts)), Y(samples[samples.length - 1][1]));
      ctx.stroke();
    }
    samples.forEach(function (sp) { dot(ctx, X(sp[0]), Y(sp[1]), col.viz2); });
    // the frequency the samples seem to show
    var m = Math.round(f / S.fs), fa = f - m * S.fs, aliased = Math.abs(fa) < f - 1e-6 && f > S.fs / 2;
    if (aliased) {
      var ab = fitSine(tt, yy, w);
      ctx.save(); ctx.setLineDash([6, 4]); ctx.strokeStyle = col.bad; ctx.lineWidth = 2; ctx.beginPath();
      for (var i = 0; i <= 300; i++) { var t = t0 + win * i / 300, wa = 2 * Math.PI * fa, yv = ab[0] * Math.sin(wa * t + (w - wa) * 0) + 0;
        yv = ab[0] * Math.sin(w * t - 2 * Math.PI * m * S.fs * t) + ab[1] * Math.cos(w * t - 2 * Math.PI * m * S.fs * t);
        if (i) ctx.lineTo(X(t), Y(yv)); else ctx.moveTo(X(t), Y(yv)); }
      ctx.stroke(); ctx.restore();
    }
    text(ctx, 'Position: continuous (gray), samples every ' + (Ts < 1 ? fmt(Ts * 1000, 0) + ' ms' : fmt(Ts, 2) + ' s') + (S.hold === 'zoh' ? ', held (zero-order hold)' : S.hold === 'foh' ? ', joined by straight lines' : '') + (S.bits ? ', ' + S.bits + '-bit' : ''), x0 + 6, 2, col.text, { size: 11 });
    if (aliased) text(ctx, 'Aliased: the samples trace a ' + fmt(Math.abs(fa), 2) + ' Hz wave (dashed) that isn\'t there', x0 + 6, c.H - 16, col.bad, { size: 11 });
    else text(ctx, 'last ' + fmt(win, 1) + ' s', x1, c.H - 16, col.muted, { size: 10, align: 'right', w: '400' });
  };
  V['samp-fold'] = function (c, lab) {
    var S = sampState(lab), ctx = c.ctx, f = lab.w / (2 * Math.PI), fs = S.fs, fmax = Math.max(1.5 * fs, f * 1.15), x0 = 20, x1 = c.W - 20, ya = c.H * 0.62;
    var X = function (v) { return x0 + v / fmax * (x1 - x0); };
    for (var b = 0; b * fs / 2 < fmax; b++) {                           // alternating bands of width fs/2
      ctx.fillStyle = withAlpha(b === 0 ? col.accent : col.bad, b === 0 ? 0.12 : 0.05 + 0.04 * (b % 2));
      ctx.fillRect(X(b * fs / 2), 26, X(Math.min(fmax, (b + 1) * fs / 2)) - X(b * fs / 2), ya - 26);
      ctx.strokeStyle = col.border; ctx.beginPath(); ctx.moveTo(X(b * fs / 2), 26); ctx.lineTo(X(b * fs / 2), ya); ctx.stroke();
    }
    ctx.strokeStyle = col.text; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x0, ya); ctx.lineTo(x1, ya); ctx.stroke();
    // the fold: where each true frequency lands in 0 … fs/2
    ctx.strokeStyle = withAlpha(col.muted, 0.6); ctx.lineWidth = 1; ctx.beginPath();
    for (var i = 0; i <= 400; i++) { var fq = fmax * i / 400, r = fq % fs, fa = r > fs / 2 ? fs - r : r; var yy = ya - 6 - fa / (fs / 2) * (ya - 40); if (i) ctx.lineTo(X(fq), yy); else ctx.moveTo(X(fq), yy); }
    ctx.stroke();
    var r2 = f % fs, fal = r2 > fs / 2 ? fs - r2 : r2, yf = ya - 6 - fal / (fs / 2) * (ya - 40);
    dot(ctx, X(f), ya, col.viz2); dot(ctx, X(f), yf, col.bad);
    ctx.save(); ctx.strokeStyle = col.bad; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(X(f), yf); ctx.lineTo(X(fal), yf); ctx.lineTo(X(fal), ya); ctx.stroke(); ctx.restore();
    dot(ctx, X(fal), ya, col.bad);
    text(ctx, 'true ' + fmt(f, 2) + ' Hz', X(f), ya + 6, col.viz2, { align: 'center', size: 11 });
    if (f > fs / 2) text(ctx, 'seen as ' + fmt(fal, 2) + ' Hz', X(fal), ya + 22, col.bad, { align: 'center', size: 11 });
    text(ctx, 'fs/2 = ' + fmt(fs / 2, 2) + ' Hz', X(fs / 2) + 4, 28, col.accent, { size: 10 });
    text(ctx, 'fs', X(fs) + 4, 28, col.muted, { size: 10, mono: true });
    text(ctx, 'Frequency folding: everything above fs/2 lands somewhere in 0 … fs/2', x0, 4, col.text, { size: 11 });
  };

  V['disc-z'] = function (c, lab, tab) {
    var D = lab.disc, ctx = c.ctx, cols = dmColors(), lin = C.linearize(lab.plant, lab.pm), poles = C.eig(lin.A), T = D.T;
    var narrow = c.W < 560, R = 1.25, side = Math.min(c.H - 30, narrow ? c.W - 20 : c.W * 0.5), cx = 10 + side / 2, cy = c.H / 2 + 8, k = side / (2 * R) * 0.95;
    var Xz = function (re) { return cx + re * k; }, Yz = function (im) { return cy - im * k; };
    ctx.strokeStyle = col.border; ctx.beginPath(); ctx.moveTo(cx - R * k, cy); ctx.lineTo(cx + R * k, cy); ctx.moveTo(cx, cy - R * k); ctx.lineTo(cx, cy + R * k); ctx.stroke();
    ctx.fillStyle = withAlpha(col.accent, 0.07); ctx.beginPath(); ctx.arc(cx, cy, k, 0, 7); ctx.fill();
    ctx.strokeStyle = col.text; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, k, 0, 7); ctx.stroke();
    text(ctx, 'z-plane: inside the unit circle is stable', 10, 4, col.text, { size: 11 });
    var show = D.method === 'all' ? ['zoh', 'fe', 'be', 'tu'] : [D.method];
    // where each method sends the whole stable half-plane
    ctx.save(); ctx.setLineDash([4, 4]); ctx.lineWidth = 1.2;
    show.forEach(function (m) {
      ctx.strokeStyle = withAlpha(cols[m], 0.7); ctx.beginPath();
      if (m === 'fe') { ctx.moveTo(Xz(1), Yz(R)); ctx.lineTo(Xz(1), Yz(-R)); }
      else if (m === 'be') ctx.arc(Xz(0.5), cy, 0.5 * k, 0, 7);
      ctx.stroke();
    });
    ctx.restore();
    poles.forEach(function (p0) {
      show.forEach(function (m) { var z = C.mapPole(m, p0, T), x = Xz(clamp(z[0], -R, R)), y = Yz(clamp(z[1], -R, R)); ctx.fillStyle = cols[m]; ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fill(); ctx.strokeStyle = col.bg; ctx.lineWidth = 1.5; ctx.stroke(); });
    });
    if (narrow) return;
    var items = [['Continuous poles −0.2 ± 2.0j, sampled every ' + fmt(T, 2) + ' s:', col.text]];
    show.forEach(function (m) {
      var z = C.mapPole(m, poles[0], T), mag = C.cabs(z);
      items.push([DM[m] + ': |z| = ' + fmt(mag, 3) + (mag >= 1 ? '  unstable!' : ''), cols[m], mag >= 1 ? '600' : '400']);
    });
    items.push(['Dashed: where each method maps the whole stable left half-plane. Forward Euler maps it to everything left of z = 1, so lightly damped poles can land outside the circle. Backward Euler maps it into a small circle, adding damping that isn\'t there. Tustin and the hold map it exactly onto the unit disk.', col.muted, '400']);
    notes(ctx, { x0: 30 + side, x1: c.W - 10, y: 18 }, items);
  };
  function discModels(lab) {
    var D = lab.disc, T = D.T, p = lab.pm, num = [1], den = [p.M, p.c, p.k], lin = C.linearize(lab.plant, p), out = {};
    var z = C.zohDiscretize(lin.A, lin.B, T);
    out.zoh = { ss: z };
    ['fe', 'be', 'tu'].forEach(function (m) { out[m] = { tf: C.tfDiscretize(num, den, m, T) }; });
    return out;
  }
  V['disc-step'] = function (c, lab) {
    var D = lab.disc, ctx = c.ctx, T = D.T, Tend = 12, cols = dmColors(), mods = discModels(lab), n = Math.floor(Tend / T) + 1, u = new Array(n).fill(1);
    var lin = C.linearize(lab.plant, lab.pm), cont = C.zohDiscretize(lin.A, lin.B, 0.01), xs = [0, 0], yc = [];
    for (var k = 0; k <= Tend / 0.01; k++) { yc.push(xs[0]); xs = [cont.Phi[0][0] * xs[0] + cont.Phi[0][1] * xs[1] + cont.Gam[0][0], cont.Phi[1][0] * xs[0] + cont.Phi[1][1] * xs[1] + cont.Gam[1][0]]; }
    var resp = {};
    resp.zoh = (function () { var x = [0, 0], y = []; for (var k = 0; k < n; k++) { y.push(x[0]); var P = mods.zoh.ss.Phi, G = mods.zoh.ss.Gam; x = [P[0][0] * x[0] + P[0][1] * x[1] + G[0][0], P[1][0] * x[0] + P[1][1] * x[1] + G[1][0]]; } return y; })();
    ['fe', 'be', 'tu'].forEach(function (m) { resp[m] = C.dtfSim(mods[m].tf, u); });
    var x0 = 44, x1 = c.W - 10, y0 = 20, y1 = c.H - 18, lo = -0.05, hi = 0.55;
    var X = function (t) { return x0 + t / Tend * (x1 - x0); }, Y = function (v) { return y1 - (clamp(v, lo - 0.2, hi + 0.2) - lo) / (hi - lo) * (y1 - y0); };
    ctx.strokeStyle = col.border; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.save(); ctx.beginPath(); ctx.rect(x0, y0 - 4, x1 - x0, y1 - y0 + 8); ctx.clip();
    ctx.strokeStyle = withAlpha(col.muted, 0.8); ctx.lineWidth = 3; ctx.beginPath(); yc.forEach(function (v, i) { if (i) ctx.lineTo(X(i * 0.01), Y(v)); else ctx.moveTo(X(0), Y(v)); }); ctx.stroke();
    (D.method === 'all' ? ['zoh', 'fe', 'be', 'tu'] : [D.method]).forEach(function (m) {
      ctx.strokeStyle = cols[m]; ctx.lineWidth = 1.6; ctx.beginPath();
      resp[m].forEach(function (v, k) { if (k) { ctx.lineTo(X(k * T), Y(resp[m][k - 1])); ctx.lineTo(X(k * T), Y(v)); } else ctx.moveTo(X(0), Y(v)); }); ctx.stroke();
      if (T > 0.08) resp[m].forEach(function (v, k) { ctx.fillStyle = cols[m]; ctx.beginPath(); ctx.arc(X(k * T), Y(v), 2.5, 0, 7); ctx.fill(); });
    });
    ctx.restore();
    text(ctx, 'Step response: continuous (thick gray) vs each discrete model at T = ' + fmt(T, 2) + ' s', x0 + 6, 2, col.text, { size: 11 });
    var lx = x0 + 6;
    ['zoh', 'fe', 'be', 'tu'].forEach(function (m) { if (D.method !== 'all' && D.method !== m) return; ctx.font = '600 11px ' + col.font; ctx.fillStyle = cols[m]; ctx.fillText(DM[m], lx, y1 - 14); lx += ctx.measureText(DM[m]).width + 14; });
  };
  V['disc-bode'] = function (c, lab) {
    var D = lab.disc, ctx = c.ctx, T = D.T, cols = dmColors(), mods = discModels(lab), wN = Math.PI / T, x0 = 46, x1 = c.W - 10, y0 = 20, y1 = c.H - 18;
    var X = logX(x0, x1), Y = function (v) { return y1 - (clamp(v, -60, 20) + 60) / 80 * (y1 - y0); };
    var p = lab.pm, w = GRID.filter(function (om) { return om > 0.05 && om < 50; });
    ctx.strokeStyle = col.border; [-60, -40, -20, 0, 20].forEach(function (v) { ctx.beginPath(); ctx.moveTo(x0, Y(v)); ctx.lineTo(x1, Y(v)); ctx.stroke(); text(ctx, String(v), x0 - 4, Y(v) - 5, col.muted, { align: 'right', size: 10, mono: true, w: '400' }); });
    ctx.strokeStyle = withAlpha(col.muted, 0.8); ctx.lineWidth = 3; ctx.beginPath();
    w.forEach(function (om, i) { var g = 20 * Math.log10(C.cabs(C.cdiv([1, 0], [p.k - p.M * om * om, p.c * om]))); if (i) ctx.lineTo(X(om), Y(g)); else ctx.moveTo(X(om), Y(g)); }); ctx.stroke();
    (D.method === 'all' ? ['zoh', 'fe', 'be', 'tu'] : [D.method]).forEach(function (m) {
      ctx.strokeStyle = cols[m]; ctx.lineWidth = 1.6; ctx.beginPath(); var started = false;
      w.forEach(function (om) {
        if (om > wN) return;
        var G = m === 'zoh' ? (function () { var P = mods.zoh.ss.Phi, Gm = mods.zoh.ss.Gam, z = [Math.cos(om * T), Math.sin(om * T)];
            var a = [z[0] - P[0][0], z[1]], b = [-P[0][1], 0], cc = [-P[1][0], 0], d = [z[0] - P[1][1], z[1]], det = C.csub(C.cmul(a, d), C.cmul(b, cc));
            var x0v = C.cdiv(C.csub(C.cmul(d, [Gm[0][0], 0]), C.cmul(b, [Gm[1][0], 0])), det); return x0v; })() : C.dtfFreq(mods[m].tf, om, T);
        var g = 20 * Math.log10(C.cabs(G)); if (started) ctx.lineTo(X(om), Y(g)); else { ctx.moveTo(X(om), Y(g)); started = true; }
      }); ctx.stroke();
    });
    ctx.save(); ctx.strokeStyle = col.bad; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(X(wN), y0); ctx.lineTo(X(wN), y1); ctx.stroke(); ctx.restore();
    text(ctx, 'Nyquist ω = π/T', X(wN) - 4, y0 + 2, col.bad, { align: 'right', size: 10 });
    text(ctx, 'Gain (dB): continuous (thick gray) vs discrete, up to the Nyquist frequency', x0 + 6, 2, col.text, { size: 11 });
    [0.1, 1, 10].forEach(function (om) { text(ctx, String(om), X(om), c.H - 14, col.muted, { align: 'center', size: 10, mono: true, w: '400' }); });
  };

  // A sampled PID loop, exactly: closed-loop eigenvalues of the discrete map.
  function loopInfo(lab) {
    var key = JSON.stringify(lab.gains) + lab.ctrlPeriod; if (lab.loopKey === key) return lab.loopI;
    var ch = lab.controller.channels[0], T = lab.ctrlPeriod, ev = C.sampledPidLoop(lab.plant, lab.pm, ch, lab.gains[0], T), mx = 0;
    ev.forEach(function (z) { mx = Math.max(mx, C.cabs(z)); });
    var lo = 0.002, hi = 1.0;                                    // exact critical period by bisection
    function unstable(t) { return C.sampledPidLoop(lab.plant, lab.pm, ch, lab.gains[0], t).some(function (z) { return C.cabs(z) >= 1; }); }
    if (unstable(lo)) hi = lo; else if (!unstable(hi)) lo = hi; else for (var it = 0; it < 30; it++) { var m = (lo + hi) / 2; if (unstable(m)) hi = m; else lo = m; }
    var lab0 = Object.assign({}, lab, { delay: 0, ctrlPeriod: 0, dirty: true }); lab0.an = null;
    var mg = analyze(lab0).ch[0].mg;
    lab.loopI = { ev: ev, max: mx, Tcrit: hi, pm: mg.pm, wc: mg.wc, Trule: mg.pm !== null ? 2 * mg.pm * Math.PI / 180 / mg.wc : null };
    lab.loopKey = key; return lab.loopI;
  }
  V['disc-loop'] = function (c, lab) {
    var L = loopInfo(lab), ctx = c.ctx, narrow = c.W < 560, side = Math.min(c.H - 26, narrow ? c.W * 0.5 : c.W * 0.42), R = 1.2;
    var cx = 10 + side / 2, cy = c.H / 2 + 8, k = side / (2 * R);
    ctx.strokeStyle = col.border; ctx.beginPath(); ctx.moveTo(cx - R * k, cy); ctx.lineTo(cx + R * k, cy); ctx.moveTo(cx, cy - R * k); ctx.lineTo(cx, cy + R * k); ctx.stroke();
    ctx.fillStyle = withAlpha(col.accent, 0.07); ctx.beginPath(); ctx.arc(cx, cy, k, 0, 7); ctx.fill();
    ctx.strokeStyle = col.text; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, k, 0, 7); ctx.stroke();
    L.ev.forEach(function (z) { var x = cx + clamp(z[0], -R, R) * k, y = cy - clamp(z[1], -R, R) * k; ctx.fillStyle = C.cabs(z) < 1 ? col.accent : col.bad; ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fill(); ctx.strokeStyle = col.bg; ctx.lineWidth = 1.5; ctx.stroke(); });
    text(ctx, 'Closed-loop poles of the sampled loop (exact)', 10, 4, col.text, { size: 11 });
    var T = lab.ctrlPeriod;
    notes(ctx, { x0: narrow ? 14 + side : 30 + side, x1: c.W - 10, y: 18 }, [
      [L.max < 1 ? 'Stable: every pole inside the circle (largest |z| = ' + fmt(L.max, 3) + ')' : 'Unstable: a pole outside the circle (|z| = ' + fmt(L.max, 3) + ')', L.max < 1 ? col.accent : col.bad],
      ['Exact limit for these gains: T = ' + fmt(L.Tcrit * 1000, 0) + ' ms', col.text],
      narrow ? null : ['Rule of thumb, a hold ≈ half a sample of delay: ' + (L.Trule ? 'T = 2·PM/ω_c = ' + fmt(L.Trule * 1000, 0) + ' ms' : '-') + '. Optimistic, because the derivative computed from two samples lags too.', col.muted, '400'],
      narrow ? null : ['Sampling ' + fmt(2 * Math.PI / L.wc / T, 0) + '× per crossover period now; aim for 10–30×.', col.viz2]
    ]);
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
  function hint(panel, t) { var p = el('p', 'panel-hint', t); panel.appendChild(p); return p; }
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

  var CTRL = { record: ctrlRecord, estimator: ctrlEstimator, basis: ctrlBasis, unseen: ctrlUnseen };
  CTRL.sampling = function (panel, lab, tab) {
    var S = sampState(lab); lab.hiRes = lab.hiRes || { t: [], y: [], dt: lab.plant.dt };
    h3(panel, 'Sampling');
    slider(panel, tab.id + '-fs', 'Sample rate', Math.log10(0.3), Math.log10(30), 0.01, Math.log10(S.fs), function (v) { var fs = Math.pow(10, v); return fmt(fs, fs < 10 ? 2 : 1) + ' Hz'; }, function (v) { S.fs = Math.pow(10, v); });
    h3(panel, 'Rebuild with');
    toggle(panel, 'Reconstruction', [['zoh', 'Hold'], ['foh', 'Lines'], ['none', 'Dots']], S.hold, function (v) { S.hold = v; });
    h3(panel, 'ADC resolution');
    toggle(panel, 'Bits', [[0, '∞'], [8, '8'], [4, '4'], [2, '2']], S.bits, function (v) { S.bits = v; });
    var t = telemetry(panel, [['f', 'Signal'], ['n', 'Nyquist fs/2'], ['a', 'Looks like']]);
    tab.syncSamp = function () { var f = lab.w / (2 * Math.PI), r = f % S.fs, fa = r > S.fs / 2 ? S.fs - r : r; setV(t.f, fmt(f, 2) + ' Hz'); setV(t.n, fmt(S.fs / 2, 2) + ' Hz'); setV(t.a, fmt(fa, 2) + ' Hz', f > S.fs / 2); };
  };
  CTRL.discretize = function (panel, lab, tab) {
    lab.disc = lab.disc || { T: 0.2, method: 'all' }; var D = lab.disc;
    h3(panel, 'Sample period');
    slider(panel, tab.id + '-T', 'T', Math.log10(0.02), Math.log10(1.5), 0.01, Math.log10(D.T), function (v) { return fmt(Math.pow(10, v), 2) + ' s'; }, function (v) { D.T = Math.pow(10, v); });
    h3(panel, 'Method');
    toggle(panel, 'Method', [['all', 'All'], ['zoh', 'Hold'], ['fe', 'Fwd'], ['be', 'Bwd'], ['tu', 'Tustin']], D.method, function (v) { D.method = v; });
  };
  CTRL.ctrlrate = function (panel, lab, tab) {
    lab.ctrlPeriod = lab.ctrlPeriod || 0.02;
    h3(panel, 'Controller rate');
    slider(panel, tab.id + '-Tc', 'Runs every', Math.log10(0.005), Math.log10(0.3), 0.005, Math.log10(lab.ctrlPeriod), function (v) { var T = Math.pow(10, v); return fmt(T * 1000, 0) + ' ms (' + fmt(1 / T, 1 / T < 10 ? 1 : 0) + ' Hz)'; },
      function (v) { lab.ctrlPeriod = Math.pow(10, v); lab.stepCache = null; });
    var t = telemetry(panel, [['v', 'Exact'], ['c', 'Limit'], ['r', 'Rule of thumb']]);
    tab.syncRate = function () { var L = loopInfo(lab); setV(t.v, L.max < 1 + 1e-9 ? 'stable' : 'unstable', L.max >= 1 + 1e-9); setV(t.c, fmt(L.Tcrit * 1000, 0) + ' ms'); setV(t.r, L.Trule ? fmt(L.Trule * 1000, 0) + ' ms' : '-'); };
  };
  CTRL.freq = function (panel, lab, tab) {
    h3(panel, tab.shake ? 'Shake it' : 'Frequency');
    var a = Math.log10(GRID[0]), b = Math.log10(GRID[GRID.length - 1]);
    var s = slider(panel, tab.id + '-w', 'ω', 0, 1000, 1, 1000 * (Math.log10(lab.w) - a) / (b - a), function (v) { return fmtW(Math.pow(10, a + v / 1000 * (b - a))) + ' rad/s'; },
      function (v) { lab.w = Math.pow(10, a + v / 1000 * (b - a)); tab.sweeping = false; });
    if (!tab.shake) toggle(panel, 'Drive the sim at ω', [[false, 'Marker only'], [true, 'Shake the sim']], !!lab.shake, function (v) {
      var lim = lab.plant.ulim(lab.p)[0]; lab.shake = v ? { input: 0, amp: tab.shakeAmp || 0.1 * (lim[1] - lim[0]) / 2 } : null;
    });
    var btn = button(panel, 'Sweep frequency', function () { tab.sweeping = !tab.sweeping; if (tab.sweeping) lab.w = GRID[0]; });
    tab.syncFreq = function () { s.set(1000 * (Math.log10(lab.w) - a) / (b - a)); btn.textContent = tab.sweeping ? 'Stop sweep' : 'Sweep frequency'; };
  };
  CTRL.view = function (panel, lab, tab) {
    h3(panel, 'View');
    var names = { contrib: 'Terms', bode: 'Bode', nyquist: 'Nyquist', poles: 'Poles', 'id-result': 'Estimates', 'id-hidden': 'Hidden states', 'id-vs': 'Compare methods' };
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
    button(panel, tab.loadLabel || 'Load suggested gains', function () {
      lab.suggested.forEach(function (g, ci) { Object.assign(lab.gains[ci], g); });
      if (lab.manual && tab.setMode) { lab.manual = false; tab.setMode(false); restart(lab); }   // the gains only matter once the controller is driving
      changed(lab);
    });
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
    slider(panel, tab.id + '-noise', 'Sensor noise <span class="sigma">σ</span>', 0, mx, mx / 100, lab.noise, function (v) { return fmt(v, mx >= 1 ? 2 : 3) + (tab.noiseUnit ? ' ' + tab.noiseUnit : ''); }, function (v) { lab.noise = v; lab.estDirty = true; changed(lab); });
  };
  CTRL.limit = function (panel, lab, tab) {
    var cap = lab.p.Fcap || 60;   // a plant with Fcap has no "none" end: its force is always clamped
    slider(panel, tab.id + '-limit', 'Force limit', 2, cap, 1, Math.min(lab.p.Fmax, cap), function (v) { return v >= cap && !lab.p.Fcap ? 'none' : fmt(v, 0) + ' N'; }, function (v) { lab.p.Fmax = v >= cap && !lab.p.Fcap ? 1e9 : v; changed(lab); });
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
    var note = hint(panel, '');
    if (tab.useModel) button(panel, 'Design with this model', function (b) {
      if (!s.msd) return; lab.pm = Object.assign({}, lab.pm, { M: s.msd.M, c: s.msd.c, k: s.msd.k }); s.used = true; changed(lab); b.textContent = 'Model in use ✓';
    });
    tab.syncSysid = function () {
      setV(t.fit, s.data ? fmt(s.fit, 1) + '%' : '-');
      if (note) note.textContent = !s.data ? '' : s.order === 1 ? 'A 1st-order model can\'t ring, so there is no mass, damper and spring to read. Pick 2nd or higher.' : s.msd && s.msd.reduced ? '* Read from the dominant pole pair of the order-' + s.order + ' fit (a 2nd-order summary of it).' : !s.msd ? 'This fit has no usable oscillating pair; try a richer input or another order.' : '';
      var m = s.msd; setV(t.m, m ? fmt(m.M, 2) + ' kg' + (m.reduced ? ' *' : '') : '-'); setV(t.c, m ? fmt(m.c, 2) : '-'); setV(t.k, m ? fmt(m.k, 2) : '-');
    };
  };
  CTRL.idrun = function (panel, lab, tab) {
    var I = idState(lab), m = tab.method;
    h3(panel, 'Experiment');
    slider(panel, tab.id + '-idnoise', 'Sensor noise', 0, 0.1, 0.002, I.noise, function (v) { return fmt(v * 1000, 0) + ' mm'; }, function (v) { I.noise = v; });
    if (m === 'era') {
      h3(panel, 'Model order (bars kept)');
      toggle(panel, 'Model order', [[1, '1'], [2, '2'], [3, '3'], [4, '4']], I.eraOrder, function (v) { I.eraOrder = v; if (I.era) eraFit(I.era, I.era.h, v); });
    }
    button(panel, 'Tap it', function () { runId(lab, m); });
    var t = telemetry(panel, [['M', 'Mass m'], ['c', 'Damping c'], ['k', 'Spring k']]);
    tab.syncId = function () { var e = idEstimate(lab, m); ID_NAMES.forEach(function (nm) { setV(t[nm], e ? fmt(e[nm], 3) : '-'); }); };
    if (!I[m]) runId(lab, m);
  };
  CTRL.requirements = function (panel, lab, tab) {
    var r = lab.req; h3(panel, 'Requirements');
    [['overshoot', 'Max overshoot', 2, 60, 1, function (v) { return fmt(v, 0) + '%'; }], ['settle', 'Settle within', 0.5, 10, 0.1, function (v) { return fmt(v, 1) + ' s'; }],
     ['pm', 'Phase margin ≥', 20, 80, 1, function (v) { return fmt(v, 0) + '°'; }], ['delay', 'Delay margin ≥', 0, 200, 5, function (v) { return fmt(v, 0) + ' ms'; }],
     ['force', 'Force budget', 5, 60, 1, function (v) { return fmt(v, 0) + ' N'; }]].forEach(function (q) {
      slider(panel, tab.id + '-' + q[0], q[1], q[2], q[3], q[4], r[q[0]], q[5], function (v) { r[q[0]] = v; lab.stepCache = null; });
    });
  };
  function restart(lab) { lab.aliveMan = 0; lab.aliveAuto = 0; lab.sim.reset(); lab.hist = { r: [], y: [], u: [], x: [], s: [], c: {} }; lab.ring = []; lab.hits = 0; lab.failT = null; lab.drag = null; }
  CTRL.mode = function (panel, lab, tab) {
    h3(panel, 'Controller');
    lab.manual = tab.startManual !== false && !!lab.plant.manual;
    tab.setMode = toggle(panel, 'Who is in control', [[true, 'Manual'], [false, lab.controller.label]], lab.manual, function (v) {
      lab.manual = v; lab.aliveMan = 0; lab.aliveAuto = 0; lab.drag = null; lab.sim.z = lab.sim.z.map(function () { return 0; }); lab.ring = []; lab.best = null;
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

  /* ================= lessons: cards, map, hash (lab-shell.js) ================= */
  var secEls = window.LabShell.start(CFG).secEls;

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
      lab.sim.step(); lab.frames++;
      if (lab.manual) lab.aliveMan = (lab.aliveMan || 0) + plant.dt; else lab.aliveAuto = (lab.aliveAuto || 0) + plant.dt;
      if (lab.sim.failed && lab.failT === null) { lab.failT = lab.sim.t; lab.trials++; lab.ring = []; lab.aliveMan = 0; lab.aliveAuto = 0; }
      lab.tick = (lab.tick || 0) + 1;
      if (lab.rec) recordTick(lab);
      if (lab.hiRes) { push(lab.hiRes.t, lab.sim.t, 1200); push(lab.hiRes.y, lab.sim.x[0], 1200); }
      if (lab.sim.xhat && lab.tick % every === 0) {
        var spec3 = lab.plant.est, E = lab.hist.est || (lab.hist.est = spec3.lanes.map(function () { return { m: [], t: [] }; })), xs3 = lab.sim.x, xh3 = lab.sim.xhat, pm3 = lab.sim.prevMeas || xs3;
        spec3.lanes.forEach(function (ln, k) { push(E[k].t, xs3[ln.idx] * ln.scale, CAP); push(E[k].m, (ln.measured ? pm3[ln.idx] : xh3[ln.idx]) * ln.scale, CAP); });
      }
      if (lab.tick % every === 0) {
        var x0 = plant.x0(lab.p), u0 = plant.u0(lab.p), xs = lab.sim.x;
        lab.refs.forEach(function (r, ci) { (lab.hist.y[ci] = lab.hist.y[ci] || []); push(lab.hist.y[ci], xs[r.idx] - x0[r.idx], CAP); (lab.hist.r[ci] = lab.hist.r[ci] || []); push(lab.hist.r[ci], C.refValue(r, lab.sim.t), CAP); });
        for (var i = 0; i < plant.m; i++) { (lab.hist.u[i] = lab.hist.u[i] || []); push(lab.hist.u[i], lab.sim.u[i] - u0[i], CAP); }
        for (var j = 0; j < plant.n; j++) { (lab.hist.x[j] = lab.hist.x[j] || []); push(lab.hist.x[j], xs[j], 300); }
        var sm = lab.hist.sm || (lab.hist.sm = []), xm = lab.sim.meas || xs;
        (plant.states || []).forEach(function (sp, k) { (lab.hist.s[k] = lab.hist.s[k] || []); push(lab.hist.s[k], sp.f(xs, lab.sim.u, lab.p), CAP); (sm[k] = sm[k] || []); push(sm[k], sp.f(xm, lab.sim.u, lab.p), CAP); });
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
      if (lab.estimator && lab.estDirty && performance.now() - lab.estAt > 150) updateEstimator(lab);
      if (lab.sysid && lab.sysid.data) lab.sysid.replayT = Math.min(lab.sysid.replayT + dt * 4, lab.sysid.T);
      var simShown = [tab.top, tab.row1, tab.row2].some(function (v) { return v === 'sim' || v === 'time' || v === 'verify-map' || v === 'states' || v === 'contrib' || v === 'est-states' || v === 'samp-time' || v === 'samp-fold'; });
      if (simShown) stepLab(lab, dt, tab);
      [tab.top, tab.row1, tab.row2].forEach(function (vname, k) {
        var cv = tab.canvases[k]; if (!cv || !V[vname]) return;
        V[vname](fit(cv), lab, tab, cv);
      });
      ['syncMargins', 'syncUnseen', 'syncVerify', 'syncMimo', 'syncSysid', 'syncScore', 'syncId', 'syncRec', 'syncEst', 'syncSamp', 'syncRate'].forEach(function (f) { if (tab[f]) tab[f](); });
    });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
