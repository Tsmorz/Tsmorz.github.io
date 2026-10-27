// embedded.js — the engine behind /embedded/. Same template as /controls/ and /vision/ (_includes/lab.html renders
// _data/labs/embedded.yml, lab-shell.js runs the cards and the lesson map, lab-ui.js draws); this file builds each
// lesson's panel and draws its three canvases (top, row1, row2) every frame. All the models are in EmbeddedCore.
//
// Views:    button, pin-scope, pin-logic, adc-scope, adc-steps, adc-error, ntc-circuit, ntc-curve, ntc-error,
//           led, pwm-wave, pwm-curve, mem-map, mem-stack, mem-table, flash-pages, flash-wear, flash-bits,
//           bus-wave, bus-zoom, bus-compare, power-profile, power-life, power-budget, bike, fsm, fsm-time,
//           bike-run, bike-adc, bike-modes
// Controls: hint, button, adc, ntc, led, memory, flash, bus, power, modes, runtime
(function () {
  'use strict';
  if (typeof document === 'undefined') return;
  var E = window.EmbeddedCore, Shell = window.LabShell, U = window.LabUI;
  var cfgEl = document.getElementById('lab-config');
  if (!cfgEl || !E || !Shell || !U) return;
  var CFG = JSON.parse(cfgEl.textContent);
  var clamp = E.clamp, rand = E.rng(4242), VCC = E.VCC;
  var withAlpha = U.withAlpha, fmt = U.fmt, col = U.col, text = U.text, line = U.line, cross = U.cross, series = U.series, axes = U.axes, legend = U.legend;
  var h3 = U.h3, hint = U.hint, slider = U.slider, toggle = U.toggle, button = U.button, telemetry = U.telemetry, setV = U.setV;

  /* ================= helpers ================= */
  function fmtSI(v, unit, d) {                       // 0.0042 A → "4.2 mA"
    var a = Math.abs(v), p = a >= 1 ? ['', 1] : a >= 1e-3 ? ['m', 1e3] : a >= 1e-6 ? ['µ', 1e6] : ['n', 1e9];
    return fmt(v * p[1], d === undefined ? (a * p[1] >= 100 ? 0 : 1) : d) + ' ' + p[0] + unit;
  }
  function fmtOhm(r) { return r >= 1e3 ? fmt(r / 1e3, r >= 1e4 ? 0 : 1) + ' kΩ' : fmt(r, 0) + ' Ω'; }
  function fmtBytes(b) { return b >= 1024 ? fmt(b / 1024, b >= 10240 ? 0 : 1) + ' KB' : b + ' B'; }
  function fmtTime(s) {
    if (s < 1) return fmt(s * 1000, 0) + ' ms';
    if (s < 120) return fmt(s, 0) + ' s';
    if (s < 7200) return fmt(s / 60, 0) + ' min';
    if (s < 86400 * 2) return fmt(s / 3600, 1) + ' h';
    if (s < 86400 * 365 * 2) return fmt(s / 86400, 0) + ' days';
    return fmt(s / 86400 / 365, 0) + ' years';
  }
  function hex(b, n) { var s = b.toString(16).toUpperCase(); while (s.length < (n || 2)) s = '0' + s; return s; }
  function box(ctx, x, y, w, h, fill, stroke, r) {
    ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r || 4); else ctx.rect(x, y, w, h);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
  }
  // Schematic parts, drawn between two points.
  function resistor(ctx, x0, y0, x1, y1, c) {
    var dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, nx = -uy, ny = ux, a = L * 0.25, b = L * 0.75, pts = [[x0, y0], [x0 + ux * a, y0 + uy * a]];
    for (var k = 0; k <= 6; k++) { var t = a + (b - a) * (k + 0.5) / 7, s = k % 2 ? -6 : 6; pts.push([x0 + ux * t + nx * s, y0 + uy * t + ny * s]); }
    pts.push([x0 + ux * b, y0 + uy * b]); pts.push([x1, y1]); line(ctx, pts, c, 1.6);
  }
  function capacitor(ctx, x, y0, y1, c) {
    var m = (y0 + y1) / 2; line(ctx, [[x, y0], [x, m - 3]], c, 1.6); line(ctx, [[x, m + 3], [x, y1]], c, 1.6);
    line(ctx, [[x - 9, m - 3], [x + 9, m - 3]], c, 2); line(ctx, [[x - 9, m + 3], [x + 9, m + 3]], c, 2);
  }
  function ground(ctx, x, y, c) { line(ctx, [[x - 9, y], [x + 9, y]], c, 1.6); line(ctx, [[x - 5, y + 4], [x + 5, y + 4]], c, 1.6); line(ctx, [[x - 2, y + 8], [x + 2, y + 8]], c, 1.6); }
  function dot(ctx, x, y, c, r) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, r || 3, 0, 7); ctx.fill(); }
  // A plot with its own x axis: xs and ys arrays, x range xr, y range yr.
  function xyPlot(c, lanes, xr, yr, title, xlab, pad) {
    pad = pad || {};
    var x0 = pad.l || 46, y0 = pad.t || 30, x1 = c.W - (pad.r || 14), y1 = c.H - (pad.b || 22);
    axes(c, x0, y0, x1, y1, yr, title, xlab);
    var X = function (x) { return x0 + (x - xr[0]) / (xr[1] - xr[0]) * (x1 - x0); }, Y = function (y) { return y1 - (y - yr[0]) / (yr[1] - yr[0]) * (y1 - y0); };
    if (!pad.noX) text(c.ctx, fmt(xr[0], Math.abs(xr[0]) < 10 && xr[0] % 1 ? 1 : 0), x0, y1 + 4, col.muted, { w: '400', size: 10, mono: true });
    lanes.forEach(function (ln) { line(c.ctx, ln.x.map(function (x, i) { var y = ln.y[i]; return isFinite(y) ? [X(x), Y(clamp(y, yr[0], yr[1]))] : null; }), ln.c, ln.lw || 1.6, ln.dash); });
    legend(c.ctx, lanes.filter(function (l) { return l.name; }).map(function (l) { return [l.name, l.c]; }), x0 + 30, y1 + 5);
    return { X: X, Y: Y, x0: x0, y0: y0, x1: x1, y1: y1 };
  }
  function bars(c, rows, title, unitFmt, x0) {
    var ctx = c.ctx, mx = Math.max.apply(null, rows.map(function (r) { return r[1]; }).concat([1e-12])), lw = x0 || 150, x1 = c.W - 90, h = Math.min(20, (c.H - 34) / rows.length - 4);
    if (title) text(ctx, title, 12, 6, col.text, { size: 12 });
    rows.forEach(function (r, i) {
      var y = 28 + i * (h + 4);
      text(ctx, r[0], 12, y + h / 2 - 7, col.muted, { w: '500', size: 11 });
      ctx.fillStyle = withAlpha(r[2] || col.accent, 0.8); ctx.fillRect(lw, y, Math.max(1, r[1] / mx * (x1 - lw)), h);
      text(ctx, unitFmt(r[1]), lw + r[1] / mx * (x1 - lw) + 6, y + h / 2 - 7, col.text, { size: 11, mono: true });
    });
  }

  /* ================= lesson state ================= */
  function makeState(tc) {
    var lc = CFG.labs[tc.lab] || {}, S = { t: 0, kind: lc.kind || 'button' };
    if (S.kind === 'button') S.b = { pull: true, cap: false, schmitt: false, debounce: 0, presses: 0, counted: 0, trace: null, ev: null };
    if (S.kind === 'adc') S.a = { bits: 8, vref: 3.0, avg: 1, noise: 0.002, v0: 1.5, ht: [], hv: [], hr: [], acc: 0 };
    if (S.kind === 'ntc') S.n = { rf: 10000, method: 'linear', bits: 10, T: 25 };
    if (S.kind === 'led') S.l = { level: 64, gamma: false, freq: 50, r: 220 };
    if (S.kind === 'memory') S.m = { samples: 1500, type: 'float', constTable: false, printf: true, window: 32, heap: 0 };
    if (S.kind === 'flash') S.f = { strategy: 'inplace', interval: 60, record: 8, pages: 16, simT: 0, speed: 3600, bytes: [0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF], erases: 0, msg: '' };
    if (S.kind === 'bus') S.u = { proto: 'uart', baud: 9600, mismatch: 0, i2cRate: 100e3, r: 4700, cap: 200, spiRate: 1e6, bytes: [0x09, 0x2A] };
    if (S.kind === 'power') S.p = { interval: 10, sleep: 5e-6, dividerOn: true, led: 50, ledI: 0.005, radioEvery: 1, cap: 0, recordsPerPage: 128 };
    if (S.kind === 'modes') S.k = { onPress: true, long: 1.0, events: [], fsm: null, down: false };
    if (S.kind === 'runtime') S.r = { mode: 'HIGH', ratio: 1, stepdown: true };
    return S;
  }
  function lifeOpts(S) { return S.p; }

  /* ================= views ================= */
  var V = {};

  /* ---- 1. the button ---- */
  function pinOpts(b) { return { pull: b.pull, rPull: 40, cap: b.cap ? 100 : 0.01, schmitt: b.schmitt, debounce: b.debounce, noise: 0.03, T: 60, dt: 0.01 }; }
  function press(S) {
    var b = S.b; b.ev = E.contactTrace(rand, {}); b.trace = E.pinTrace(b.ev, pinOpts(b), rand);
    b.presses++; b.counted += b.trace.debPress;
  }
  function retrace(S) { var b = S.b; if (b.ev) b.trace = E.pinTrace(b.ev, pinOpts(b), rand); }
  V.button = function (c, S, tab, slot) {
    var ctx = c.ctx, b = S.b, fg = col.text, x = 70, top = 34, node = c.H * 0.48, bot = c.H - 34, mcu = Math.min(c.W * 0.42, 300);
    text(ctx, 'VCC 3.0 V', x - 30, top - 22, col.muted, { w: '500', size: 11 });
    line(ctx, [[x - 30, top], [x + 30, top]], fg, 2);
    if (b.pull) { resistor(ctx, x, top, x, node, fg); text(ctx, '40 kΩ pull-up', x + 14, (top + node) / 2 - 7, col.muted, { w: '400', size: 11 }); }
    else text(ctx, '(no pull-up)', x + 10, (top + node) / 2 - 7, col.bad, { w: '500', size: 11 });
    dot(ctx, x, node, fg);
    line(ctx, [[x, node], [mcu, node]], fg, 1.6);
    box(ctx, mcu, node - 34, 110, 68, col.bgSoft, fg, 6);
    text(ctx, 'MCU', mcu + 55, node - 26, fg, { size: 12, align: 'center' });
    text(ctx, b.schmitt ? 'Schmitt input' : 'plain input', mcu + 55, node - 8, col.muted, { w: '400', size: 11, align: 'center' });
    text(ctx, b.debounce ? 'debounce ' + b.debounce + ' ms' : 'no debounce', mcu + 55, node + 8, col.muted, { w: '400', size: 11, align: 'center' });
    var sx = x, sy = node + (bot - node) * 0.35, closed = b.trace && b.trace.closed[b.trace.closed.length - 1];
    line(ctx, [[x, node], [x, sy]], fg, 1.6);
    line(ctx, [[sx, sy], [sx + 22, sy + 18]], col.accent, 2.5);
    line(ctx, [[x, sy + 22], [x, bot - 8]], fg, 1.6); dot(ctx, x, sy + 22, fg, 2.5); ground(ctx, x, bot - 8, fg);
    text(ctx, 'button', x + 28, sy, col.muted, { w: '400', size: 11 });
    if (b.cap) { line(ctx, [[x, node], [x - 40, node]], fg, 1.6); capacitor(ctx, x - 40, node, bot - 8, fg); ground(ctx, x - 40, bot - 8, fg); text(ctx, '100 nF', x - 66, node + 14, col.muted, { w: '400', size: 11 }); }
    // the button to press, and the counts
    var bx = Math.min(c.W - 90, mcu + 230), by = c.H / 2 - 16, R = Math.min(42, c.H * 0.16);
    ctx.fillStyle = withAlpha(col.accent, S.flash > 0 ? 0.55 : 0.25); ctx.beginPath(); ctx.arc(bx, by, R, 0, 7); ctx.fill();
    ctx.strokeStyle = col.accent; ctx.lineWidth = 2; ctx.stroke();
    text(ctx, 'Press', bx, by - 8, col.text, { size: 13, align: 'center' });
    var bad = b.counted !== b.presses;
    text(ctx, 'You pressed ' + b.presses + '×', bx, by + R + 12, col.text, { size: 12, align: 'center' });
    text(ctx, 'The MCU counted ' + b.counted, bx, by + R + 30, bad ? col.bad : col.viz1, { size: 12, align: 'center' });
    tab.hit[slot] = { down: function (q, p) { if (Math.hypot(p.x - bx, p.y - by) > R + 6) return null; press(S); S.flash = 0.15; return null; },
      cursor: function (q, p) { return Math.hypot(p.x - bx, p.y - by) < R + 6 ? 'pointer' : ''; } };
  };
  V['pin-scope'] = function (c, S) {
    var tr = S.b.trace, ctx = c.ctx;
    if (!tr) { text(ctx, 'Press the button to see one press and release, 60 ms of it.', c.W / 2, c.H / 2 - 7, col.muted, { w: '500', size: 13, align: 'center' }); return; }
    var n = tr.v.length, step = 4, v = [], cl = [];
    for (var i = 0; i < n; i += step) { v.push(tr.v[i]); cl.push(tr.closed[i]); }
    var P = series(c, [{ v: v, c: col.accent, name: 'pin voltage', lw: 1.4 }], [-0.2, 3.3], 'The pin\'s voltage through one press and release (60 ms)', 'time (ms)');
    ctx.fillStyle = withAlpha(col.viz2, 0.12);
    cl.forEach(function (k, i) { if (k) { var a = P.map(i, cl.length, 0)[0], b2 = P.map(i + 1, cl.length, 0)[0]; ctx.fillRect(a, P.y0, b2 - a + 0.5, P.y1 - P.y0); } });
    var ths = S.b.schmitt ? [[0.7 * VCC, 'rises above'], [0.3 * VCC, 'falls below']] : [[VCC / 2, 'threshold']];
    ths.forEach(function (t) { var y = P.map(0, 2, t[0])[1]; line(ctx, [[P.x0, y], [P.x1, y]], col.viz2, 1, [5, 4]); text(ctx, t[1] + ' ' + fmt(t[0], 1) + ' V', P.x1 - 4, y - 15, col.viz2, { w: '500', size: 10, align: 'right' }); });
    text(ctx, 'shaded: contact closed', P.x1 - 4, P.y1 - 16, col.muted, { w: '400', size: 10, align: 'right' });
  };
  V['pin-logic'] = function (c, S) {
    var tr = S.b.trace, ctx = c.ctx; if (!tr) return;
    var lanes = [['what the pin reads', tr.raw, tr.rawPress, col.accent], ['after debounce', tr.deb, tr.debPress, col.viz1]], x0 = 140, x1 = c.W - 14, lh = (c.H - 40) / 2;
    text(ctx, 'As logic: 1 = released, 0 = pressed', 12, 6, col.text, { size: 12 });
    lanes.forEach(function (ln, k) {
      var yTop = 30 + k * lh, yHi = yTop + 6, yLo = yTop + lh - 14, pts = [], a = ln[1];
      for (var i = 0; i < a.length; i += 2) pts.push([x0 + i / a.length * (x1 - x0), a[i] ? yHi : yLo]);
      line(ctx, pts, ln[3], 2);
      text(ctx, ln[0], 12, yTop + 4, col.muted, { w: '500', size: 11 });
      text(ctx, ln[2] + (ln[2] === 1 ? ' press' : ' presses'), 12, yTop + 20, ln[2] === 1 ? col.viz1 : col.bad, { size: 12, mono: true });
    });
  };

  /* ---- 2. the ADC ---- */
  function adcTick(S, dt) {
    var a = S.a; a.acc += dt;
    while (a.acc >= 0.05) {
      a.acc -= 0.05; S.t += 0.05;
      var v = a.v0 + 0.012 * Math.sin(2 * Math.PI * S.t / 6), code = E.adcRead(v, a, rand);
      a.ht.push(S.t); a.hv.push(v); a.hr.push(E.codeToVolts(code, a.bits, a.vref) - (a.avg > 1 ? 0 : 0));
      if (a.ht.length > 200) { a.ht.shift(); a.hv.shift(); a.hr.shift(); }
    }
  }
  V['adc-scope'] = function (c, S) {
    var a = S.a, yr = [a.v0 - 0.04, a.v0 + 0.04];
    if (a.v0 > a.vref - 0.03) yr = [Math.min(a.vref, a.v0) - 0.08, Math.max(a.vref, a.v0) + 0.04];
    var P = series(c, [{ v: a.hv, c: col.muted, name: 'the voltage at the pin', lw: 1.4 }, { v: a.hr, c: col.accent, name: 'what the ADC reports', lw: 2 }], yr, 'Last 10 s: the sensor\'s voltage (V) and the ADC\'s reading', 'time');
    var L = E.lsb(a.bits, a.vref);
    if (L > (yr[1] - yr[0]) / 60) for (var k = Math.ceil(yr[0] / L); k * L < yr[1]; k++) { var y = P.map(0, 2, k * L)[1]; line(c.ctx, [[P.x0, y], [P.x0 + 6, y]], col.muted, 1); }
    if (a.v0 >= a.vref) U.label(c.ctx, 'Above the reference: every reading is the top code', P.x0 + 8, P.y0 + 8);
  };
  V['adc-steps'] = function (c, S) {
    var a = S.a, L = E.lsb(a.bits, a.vref), span = Math.max(8 * L, 0.02), lo = Math.max(0, a.v0 - span / 2), hi = lo + span, xs = [], ys = [];
    for (var i = 0; i <= 400; i++) { var v = lo + span * i / 400; xs.push(v); ys.push(E.adcCode(v, a.bits, a.vref)); }
    var yr = [Math.min.apply(null, ys) - 1, Math.max.apply(null, ys) + 1];
    var P = xyPlot(c, [{ x: xs, y: ys, c: col.accent, lw: 2, name: 'code' }, { x: [lo, hi], y: [lo / a.vref * Math.pow(2, a.bits), hi / a.vref * Math.pow(2, a.bits)], c: col.muted, dash: [4, 3], name: 'ideal' }], [lo, hi], yr, 'Each step is one LSB = ' + fmt(L * 1000, L < 0.001 ? 2 : 1) + ' mV (' + a.bits + ' bits of ' + fmt(a.vref, 1) + ' V)', 'input (V)', { l: 56 });
    var v0 = a.hv.length ? a.hv[a.hv.length - 1] : a.v0; dot(c.ctx, P.X(v0), P.Y(E.adcCode(v0, a.bits, a.vref)), col.viz2, 5);
  };
  V['adc-error'] = function (c, S) {
    var a = S.a, err = a.hr.map(function (r, i) { return (r - a.hv[i]) * 1000; }), L = E.lsb(a.bits, a.vref) * 1000, rms = Math.sqrt(err.reduce(function (s, e) { return s + e * e; }, 0) / Math.max(1, err.length));
    var m = Math.max(L, 3 * a.noise * 1000, 2), P = series(c, [{ v: err, c: col.accent, name: 'reading − input (mV), RMS ' + fmt(rms, 2) + ' mV', lw: 1.4 }], [-m, m], 'The error of each reading', 'time');
    [L / 2, -L / 2].forEach(function (v) { if (Math.abs(v) < m) { var y = P.map(0, 2, v)[1]; line(c.ctx, [[P.x0, y], [P.x1, y]], col.viz2, 1, [4, 3]); } });
    text(c.ctx, '±½ LSB', P.x1 - 4, P.map(0, 2, Math.min(L / 2, m))[1] + 2, col.viz2, { w: '500', size: 10, align: 'right' });
  };

  /* ---- 3. the thermistor ---- */
  V['ntc-circuit'] = function (c, S, tab, slot) {
    var n = S.n, ctx = c.ctx, fg = col.text, x = 80, top = 34, mid = c.H * 0.52, bot = c.H - 30, R = E.ntcR(n.T), v = E.ntcVolts(n.T, n.rf), code = E.ntcCode(n.T, n.rf, n.bits), read = E.codeToTemp(code, n.method, n.rf, n.bits);
    text(ctx, 'VCC 3.0 V', x - 30, top - 22, col.muted, { w: '500', size: 11 }); line(ctx, [[x - 30, top], [x + 30, top]], fg, 2);
    resistor(ctx, x, top, x, mid, fg); text(ctx, 'fixed ' + fmtOhm(n.rf), x + 14, (top + mid) / 2 - 7, col.muted, { w: '500', size: 11 });
    dot(ctx, x, mid, fg); resistor(ctx, x, mid, x, bot - 8, col.accent); ground(ctx, x, bot - 8, fg);
    text(ctx, 'NTC ' + fmtOhm(R), x + 14, (mid + bot) / 2 - 7, col.accent, { size: 11 });
    line(ctx, [[x, mid], [x + 110, mid]], fg, 1.6); box(ctx, x + 110, mid - 24, 76, 48, col.bgSoft, fg, 6); text(ctx, 'ADC', x + 148, mid - 16, fg, { size: 12, align: 'center' }); text(ctx, n.bits + ' bit', x + 148, mid + 2, col.muted, { w: '400', size: 11, align: 'center' });
    var tx = x + 210, rows = [['voltage', fmt(v, 3) + ' V'], ['code', String(code) + ' of ' + Math.pow(2, n.bits)], ['read as', fmt(read, 1) + ' °C'], ['error', fmt(read - n.T, 1) + ' °C']];
    rows.forEach(function (r, i) { text(ctx, r[0], tx, top + i * 22, col.muted, { w: '400', size: 12 }); text(ctx, r[1], tx + 70, top + i * 22, i === 3 && Math.abs(read - n.T) > 1 ? col.bad : col.text, { size: 12, mono: true }); });
    text(ctx, 'divider current ' + fmtSI(E.ntcCurrent(n.T, n.rf), 'A'), tx, top + 96, col.muted, { w: '400', size: 11 });
    // the thermometer: drag it
    var gx = c.W - 60, g0 = 30, g1 = c.H - 40, gy = g0 + (80 - n.T) / 100 * (g1 - g0);
    box(ctx, gx - 8, g0, 16, g1 - g0, col.bgSoft, col.border, 8); ctx.fillStyle = '#d8332a'; ctx.fillRect(gx - 4, gy, 8, g1 - gy);
    ctx.beginPath(); ctx.arc(gx, g1 + 6, 11, 0, 7); ctx.fill();
    text(ctx, fmt(n.T, 0) + ' °C', gx - 14, gy - 7, col.text, { size: 12, mono: true, align: 'right' });
    text(ctx, 'drag', gx, g0 - 16, col.muted, { w: '400', size: 10, align: 'center' });
    tab.hit[slot] = { down: function (q, p) { if (Math.abs(p.x - gx) > 30) return null; return function (q2, p2) { n.T = Math.round(clamp(80 - (p2.y - g0) / (g1 - g0) * 100, -20, 80)); if (tab.syncT) tab.syncT(); }; },
      cursor: function (q, p) { return Math.abs(p.x - gx) < 30 ? 'ns-resize' : ''; } };
  };
  V['ntc-curve'] = function (c, S) {
    var n = S.n, xs = [], ys = [], yl = [], T;
    for (T = -20; T <= 80; T += 1) { xs.push(T); ys.push(E.ntcVolts(T, n.rf)); }
    var lanes = [{ x: xs, y: ys, c: col.accent, lw: 2, name: 'voltage with ' + fmtOhm(n.rf) }];
    if (n.method === 'linear') { var v0 = E.ntcVolts(0, n.rf), v50 = E.ntcVolts(50, n.rf); xs.forEach(function (t) { yl.push(v0 + (v50 - v0) * t / 50); }); lanes.push({ x: xs, y: yl, c: col.viz2, dash: [5, 4], name: 'the straight line used' }); }
    var P = xyPlot(c, lanes, [-20, 80], [0, 3], 'Voltage (V) against temperature: steepest where the NTC equals the fixed resistor', 'temperature (°C)');
    dot(c.ctx, P.X(n.T), P.Y(E.ntcVolts(n.T, n.rf)), col.viz2, 5);
    text(c.ctx, fmt(E.ntcSensitivity(n.T, n.rf), 1) + ' mV/°C here', P.X(n.T) + 8, P.Y(E.ntcVolts(n.T, n.rf)) - 18, col.text, { size: 11, mono: true });
  };
  V['ntc-error'] = function (c, S) {
    var n = S.n, xs = [], ys = [], q = [], mx = 0;
    for (var T = -20; T <= 80; T += 0.5) { var e = E.codeToTemp(E.ntcCode(T, n.rf, n.bits), n.method, n.rf, n.bits) - T; xs.push(T); ys.push(e); mx = Math.max(mx, Math.abs(e)); q.push(Math.pow(2, -n.bits) * 3000 / Math.max(0.01, E.ntcSensitivity(T, n.rf))); }
    var m = Math.max(1, Math.min(20, mx * 1.2));
    var P = xyPlot(c, [{ x: xs, y: ys, c: col.accent, lw: 2, name: n.method + ': worst ' + fmt(mx, 1) + ' °C' }, { x: xs, y: q, c: col.muted, dash: [3, 3], name: 'one LSB in °C' }], [-20, 80], [-m, m], 'Error of the reading (°C)', 'temperature (°C)');
    line(c.ctx, [[P.X(n.T), P.y0], [P.X(n.T), P.y1]], withAlpha(col.viz2, 0.6), 1, [2, 3]);
  };

  /* ---- 4. the LED ---- */
  function ledState(S) { var l = S.l, I = E.ledCurrent(l.r), d = E.duty(l.level, l.gamma); return { I: I, d: d, Y: I * d / E.LED.imax, eye: E.eyeRipple(Math.max(d, 1e-4), l.freq) }; }
  function glow(ctx, x, y, r, Lstar) {
    var a = clamp(Lstar / 100, 0, 1), g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.4);
    g.addColorStop(0, 'rgba(255,60,40,' + a + ')'); g.addColorStop(0.4, 'rgba(255,40,30,' + a * 0.5 + ')'); g.addColorStop(1, 'rgba(255,40,30,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 2.4, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgb(' + Math.round(90 + 165 * a) + ',' + Math.round(20 + 40 * a) + ',' + Math.round(20 + 30 * a) + ')'; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  }
  V.led = function (c, S) {
    var ctx = c.ctx, l = S.l, st = ledState(S), fg = col.text, x = 60, top = 34, bot = c.H - 30;
    text(ctx, 'VCC 3.0 V', x - 30, top - 22, col.muted, { w: '500', size: 11 }); line(ctx, [[x - 30, top], [x + 30, top]], fg, 2);
    resistor(ctx, x, top, x, top + 60, fg); text(ctx, fmtOhm(l.r), x + 14, top + 22, col.muted, { w: '500', size: 11 });
    line(ctx, [[x, top + 60], [x, top + 80]], fg, 1.6);
    ctx.fillStyle = fg; ctx.beginPath(); ctx.moveTo(x - 10, top + 80); ctx.lineTo(x + 10, top + 80); ctx.lineTo(x, top + 96); ctx.closePath(); ctx.fill(); line(ctx, [[x - 10, top + 97], [x + 10, top + 97]], fg, 2);
    line(ctx, [[x, top + 97], [x, top + 120]], fg, 1.6); box(ctx, x - 30, top + 120, 60, 34, col.bgSoft, fg, 5); text(ctx, 'PWM pin', x, top + 130, col.muted, { w: '500', size: 10, align: 'center' });
    var gx = 220, gy = c.H * 0.4;
    glow(ctx, gx, gy, 16, E.lightness(st.Y));
    text(ctx, 'as you see it', gx, gy + 44, col.muted, { w: '400', size: 11, align: 'center' });
    var slow = ((S.t * l.freq / 100) % 1) < st.d; glow(ctx, gx + 110, gy, 10, slow ? E.lightness(st.I / E.LED.imax) : 0);
    text(ctx, '100× slower', gx + 110, gy + 44, col.muted, { w: '400', size: 11, align: 'center' });
    var tx = gx + 190;
    [['current when on', fmtSI(st.I, 'A')], ['duty', fmt(st.d * 100, st.d < 0.1 ? 1 : 0) + '%'], ['average current', fmtSI(st.I * st.d, 'A')], ['flicker', st.eye.ripple > 0.1 ? 'visible (' + fmt(st.eye.ripple * 100, 0) + '%)' : 'none you can see']].forEach(function (r, i) {
      text(ctx, r[0], tx, 30 + i * 22, col.muted, { w: '400', size: 12 }); text(ctx, r[1], tx + 120, 30 + i * 22, i === 3 && st.eye.ripple > 0.1 ? col.bad : col.text, { size: 12, mono: true });
    });
    // nine steps of the level, as this mapping makes them
    var y2 = c.H - 30, w = (c.W - 260) / 9;
    text(ctx, 'Levels 0, 32, 64 … 255 ' + (l.gamma ? 'with gamma' : 'straight to duty'), 160, y2 - 36, col.muted, { w: '500', size: 11 });
    for (var k = 0; k < 9; k++) { var lv = Math.min(255, k * 32), d = E.duty(lv, l.gamma); glow(ctx, 170 + k * w, y2, 6, E.lightness(st.I * d / E.LED.imax)); }
  };
  V['pwm-wave'] = function (c, S) {
    var st = ledState(S), I = st.I * 1000, P = series(c, [{ v: st.eye.wave.map(function (u) { return u * I; }), c: col.muted, name: 'current (mA)', lw: 1.2 }, { v: st.eye.eye.map(function (u) { return u * I; }), c: col.accent, name: 'what the eye blends it into', lw: 2.2 }], [0, Math.max(1, I * 1.1)], 'Three PWM periods at ' + S.l.freq + ' Hz (' + fmt(3000 / S.l.freq, 1) + ' ms)', 'time');
  };
  V['pwm-curve'] = function (c, S) {
    var l = S.l, I = E.ledCurrent(l.r) / E.LED.imax, xs = [], a = [], b = [];
    for (var lv = 0; lv <= 255; lv += 3) { xs.push(lv); a.push(E.lightness(I * E.duty(lv, false))); b.push(E.lightness(I * E.duty(lv, true))); }
    var P = xyPlot(c, [{ x: xs, y: a, c: l.gamma ? col.muted : col.accent, lw: l.gamma ? 1.2 : 2.2, name: 'duty = level' }, { x: xs, y: b, c: l.gamma ? col.accent : col.muted, lw: l.gamma ? 2.2 : 1.2, name: 'duty = level^2.2 (gamma)' }], [0, 255], [0, 100], 'How bright it looks (CIE L*, 0–100) against the level you set', 'level');
    dot(c.ctx, P.X(l.level), P.Y(E.lightness(I * E.duty(l.level, l.gamma))), col.viz2, 5);
  };

  /* ---- 5. memory ---- */
  V['mem-map'] = function (c, S) {
    var ctx = c.ctx, M = E.memoryMap(S.m), x0 = 16, x1 = c.W - 16, w = x1 - x0, step = Math.floor(S.t / 0.25) % M.path.length, depth = M.path[step].depth;
    var colors = { code: '#7a8599', 'startup + vectors': '#9aa3b5', 'calibration table': col.viz2, 'float maths': col.viz4 || '#b07ad8', printf: col.bad, '.data initial values': col.viz3 || '#d8a03a' };
    text(ctx, 'Flash: ' + fmtBytes(M.flashUsed) + ' of 64 KB (the program, and anything const)', x0, 8, col.text, { size: 12 });
    var y = 28, h = Math.min(48, c.H * 0.16), x = x0;
    box(ctx, x0, y, w, h, col.bgSoft, col.border, 4);
    M.flash.forEach(function (f) { if (!f[1]) return; var fw = f[1] / E.MEM.flash * w; ctx.fillStyle = withAlpha(colors[f[0]] || col.accent, 0.8); ctx.fillRect(x, y, fw, h); if (fw > 60) text(ctx, f[0], x + 4, y + h / 2 - 7, '#fff', { size: 10 }); x += fw; });
    var y2 = y + h + 48;
    text(ctx, 'RAM: 8 KB. Globals and the heap from the bottom, the stack down from the top', x0, y2 - 22, col.text, { size: 12 });
    box(ctx, x0, y2, w, h + 10, col.bgSoft, col.border, 4); x = x0;
    [['.data', M.data, col.viz3 || '#d8a03a'], ['.bss (buffers)', M.bss, col.accent], ['heap', M.heap, col.viz2]].forEach(function (r) {
      if (!r[1]) return; var rw = r[1] / E.MEM.ram * w; ctx.fillStyle = withAlpha(r[2], 0.75); ctx.fillRect(x, y2, rw, h + 10);
      if (rw > 50) text(ctx, r[0] + ' ' + fmtBytes(r[1]), x + 4, y2 + (h + 10) / 2 - 7, '#fff', { size: 10 }); x += rw;
    });
    var sw = depth / E.MEM.ram * w, pw = M.peak / E.MEM.ram * w;
    ctx.fillStyle = withAlpha(M.overflow && depth > M.free ? col.bad : '#5aa469', 0.85); ctx.fillRect(x1 - sw, y2, sw, h + 10);
    line(ctx, [[x1 - pw, y2 - 6], [x1 - pw, y2 + h + 16]], M.overflow ? col.bad : col.text, 1.5, [3, 3]);
    text(ctx, 'stack ' + depth + ' B (peak ' + M.peak + ')', x1 - 4, y2 + h + 20, M.overflow ? col.bad : col.text, { size: 11, align: 'right', mono: true });
    text(ctx, M.overflow ? 'Stack overflow: the stack runs into the buffers and corrupts them (then a HardFault)' : 'Free between them: ' + fmtBytes(M.free - M.peak) + ' at the peak', x0, y2 + h + 40, M.overflow ? col.bad : col.viz1, { size: 12 });
  };
  V['mem-stack'] = function (c, S) {
    var M = E.memoryMap(S.m), step = Math.floor(S.t / 0.25) % M.path.length, xs = [], ys = [];
    M.path.forEach(function (p, i) { xs.push(i); ys.push(p.depth); xs.push(i + 1); ys.push(p.depth); });
    var top = Math.max(M.peak, M.free) * 1.15;
    var P = xyPlot(c, [{ x: xs, y: ys, c: col.accent, lw: 2, name: 'stack depth (bytes)' }, { x: [0, M.path.length], y: [M.free, M.free], c: col.bad, dash: [5, 4], name: 'room before the buffers' }], [0, M.path.length], [0, top], 'The stack through one measurement', 'one cycle →', { r: 220 });
    var px = P.X(step + 0.5); line(c.ctx, [[px, P.y0], [px, P.y1]], col.viz2, 1.5);
    var tx = P.x1 + 14;
    text(c.ctx, 'Calls now:', tx, P.y0, col.text, { size: 12 });
    M.path[step].names.forEach(function (nm, i) { text(c.ctx, (i ? '└ ' : '') + nm, tx + i * 8, P.y0 + 18 + i * 16, nm === 'ADC interrupt' ? col.viz2 : col.muted, { w: '500', size: 11, mono: true }); });
  };
  V['mem-table'] = function (c, S) {
    var M = E.memoryMap(S.m), m = S.m, sz = E.TYPES[m.type], ctx = c.ctx, rows = [
      ['log buffer: ' + m.samples + ' × ' + m.type, '.bss (RAM)', m.samples * sz],
      ['calibration table, 256 × int16', m.constTable ? 'flash only (const)' : 'flash + a copy in .data', 512],
      ['filter()\'s window: ' + m.window + ' × ' + m.type, 'stack, while filter() runs', m.window * sz],
      [m.printf ? 'printf' : 'format_temp (hand-written)', m.printf ? '6 KB flash, 640 B stack' : '≈200 B flash, 40 B stack', m.printf ? 640 : 40],
      ['heap (malloc)', 'RAM, above the globals', m.heap]];
    text(ctx, 'Where things live', 12, 6, col.text, { size: 12 });
    [['', 12], ['where', 280], ['bytes', 470]].forEach(function (h) { text(ctx, h[0], h[1], 26, col.muted, { w: '500', size: 11 }); });
    rows.forEach(function (r, i) { var y = 44 + i * 19; text(ctx, r[0], 12, y, col.text, { w: '500', size: 11 }); text(ctx, r[1], 280, y, col.muted, { w: '400', size: 11 }); text(ctx, String(r[2]), 470, y, col.text, { size: 11, mono: true }); });
  };

  /* ---- 6. flash ---- */
  V['flash-pages'] = function (c, S) {
    var f = S.f, ctx = c.ctx, counts = E.wear(f, f.simT), cols = 8, rows = Math.ceil(f.pages / cols), cw = Math.min((c.W - 32) / cols, 90), ch = Math.min((c.H - 70) / rows, 64);
    text(ctx, 'Flash pages, coloured by wear, after ' + fmtTime(f.simT) + ' of logging every ' + fmtTime(f.interval), 14, 8, col.text, { size: 12 });
    var dead = false, ptr = f.strategy === 'inplace' ? 0 : Math.floor(Math.floor(f.simT / f.interval) / Math.floor(E.FLASH.page / f.record)) % f.pages;
    counts.forEach(function (n, p) {
      var x = 16 + (p % cols) * cw, y = 32 + Math.floor(p / cols) * ch, w = n / E.FLASH.endurance, worn = w >= 1;
      if (worn) dead = true;
      ctx.fillStyle = worn ? col.bad : withAlpha(col.accent, 0.08 + 0.85 * Math.min(1, w));
      ctx.fillRect(x + 2, y + 2, cw - 4, ch - 4);
      if (p === ptr) { ctx.strokeStyle = col.viz2; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, cw - 2, ch - 2); }
      if (cw > 50) text(ctx, n >= 1e4 ? 'worn' : String(n), x + cw / 2, y + ch / 2 - 6, worn || w > 0.5 ? '#fff' : col.muted, { size: 10, mono: true, align: 'center' });
    });
    var life = E.wearLife(f);
    text(ctx, (dead ? 'A page is worn out: writes to it start failing.' : 'Wears out after ' + fmtTime(life) + '.') + ' Each page takes about ' + E.FLASH.endurance.toLocaleString() + ' erases.', 16, c.H - 22, dead ? col.bad : col.text, { size: 12 });
  };
  V['flash-wear'] = function (c, S) {
    var f = S.f, xs = [], a = [], b = [], la = Math.log10(3600), lb = Math.log10(86400 * 365 * 100);
    for (var i = 0; i <= 200; i++) {
      var t = Math.pow(10, la + (lb - la) * i / 200); xs.push(Math.log10(t / 86400));
      a.push(Math.max.apply(null, E.wear(Object.assign({}, f, { strategy: 'inplace' }), t)) / E.FLASH.endurance);
      b.push(Math.max.apply(null, E.wear(Object.assign({}, f, { strategy: 'log' }), t)) / E.FLASH.endurance);
    }
    var P = xyPlot(c, [{ x: xs, y: a, c: f.strategy === 'inplace' ? col.accent : col.muted, lw: f.strategy === 'inplace' ? 2.2 : 1.2, name: 'rewrite in place' }, { x: xs, y: b, c: f.strategy === 'log' ? col.accent : col.muted, lw: f.strategy === 'log' ? 2.2 : 1.2, name: 'ring log over ' + f.pages + ' pages' }, { x: [xs[0], xs[xs.length - 1]], y: [1, 1], c: col.bad, dash: [5, 4] }],
      [xs[0], xs[xs.length - 1]], [0, 1.2], 'Most-worn page, as a share of its endurance', 'time (log): 1 hour … 100 years', { noX: true });
    [[1, '1 day'], [30, '1 month'], [365, '1 year'], [3650, '10 years']].forEach(function (d) { var x = P.X(Math.log10(d[0])); line(c.ctx, [[x, P.y1], [x, P.y1 - 4]], col.muted, 1); text(c.ctx, d[1], x, P.y0 + 2, col.muted, { w: '400', size: 10, align: 'center' }); });
    if (f.simT > 3600) { var x = P.X(Math.log10(f.simT / 86400)); line(c.ctx, [[x, P.y0], [x, P.y1]], col.viz2, 1.5); }
  };
  V['flash-bits'] = function (c, S, tab, slot) {
    var f = S.f, ctx = c.ctx, cell = Math.min(18, (c.W - 120) / 64), x0 = 14, y0 = 46;
    text(ctx, 'Eight bytes of a page. Click a bit to write it. Erased pages read all 1s.', x0, 6, col.text, { size: 12 });
    f.bytes.forEach(function (b, k) {
      for (var i = 0; i < 8; i++) {
        var bit = (b >> (7 - i)) & 1, x = x0 + (k * 8 + i) * cell + k * 6;
        ctx.fillStyle = bit ? withAlpha(col.accent, 0.18) : withAlpha(col.accent, 0.85); ctx.fillRect(x, y0, cell - 2, cell * 1.4);
        text(ctx, String(bit), x + (cell - 2) / 2, y0 + cell * 0.7 - 6, bit ? col.text : '#fff', { size: 10, mono: true, align: 'center' });
      }
      text(ctx, '0x' + hex(b), x0 + k * (8 * cell + 6) + 4 * cell, y0 + cell * 1.4 + 6, col.muted, { size: 11, mono: true, align: 'center' });
    });
    text(ctx, f.msg, x0, y0 + cell * 1.4 + 30, f.msg.indexOf('Can') === 0 ? col.bad : col.viz1, { size: 12 });
    text(ctx, 'Erases so far: ' + f.erases, x0, c.H - 22, col.muted, { w: '400', size: 11 });
    tab.hit[slot] = { down: function (q, p) {
      if (p.y < y0 || p.y > y0 + cell * 1.4) return null;
      for (var k = 0; k < 8; k++) for (var i = 0; i < 8; i++) {
        var x = x0 + (k * 8 + i) * cell + k * 6;
        if (p.x >= x && p.x < x + cell - 2) {
          var mask = 1 << (7 - i), nb = f.bytes[k] ^ mask;
          if (E.canWrite(f.bytes[k], nb)) { f.bytes[k] = nb; f.msg = 'Written: 1 → 0 needs no erase.'; }
          else f.msg = 'Can\'t write 0 → 1. Erase the whole 1 KB page first (button in the panel).';
        }
      }
      return null;
    }, cursor: function (q, p) { return p.y >= y0 && p.y <= y0 + cell * 1.4 ? 'pointer' : ''; } };
  };

  /* ---- 7. buses ---- */
  V['bus-wave'] = function (c, S) {
    var u = S.u, ctx = c.ctx, x0 = 70, x1 = c.W - 14;
    if (u.proto === 'uart') {
      var bits = E.uartBits(u.bytes), rx = E.uartReceive(u.bytes, u.mismatch), bw = (x1 - x0) / bits.length, yH = c.H * 0.22, yL = c.H * 0.5;
      text(ctx, 'UART at ' + u.baud + ' baud: start bit, 8 data bits (lowest first), stop bit. Bytes 0x' + hex(u.bytes[0]) + ' 0x' + hex(u.bytes[1]), 12, 6, col.text, { size: 12 });
      text(ctx, 'TX', 12, (yH + yL) / 2 - 7, col.muted, { w: '500', size: 11 });
      var pts = [[x0 - 20, yH]]; bits.forEach(function (b, i) { var y = b ? yH : yL; pts.push([x0 + i * bw, pts[pts.length - 1][1]]); pts.push([x0 + i * bw, y]); pts.push([x0 + (i + 1) * bw, y]); });
      line(ctx, pts, col.text, 2);
      bits.forEach(function (b, i) { var k = i % 10, lab = k === 0 ? 'S' : k === 9 ? 'P' : 'd' + (k - 1); text(ctx, lab, x0 + (i + 0.5) * bw, yL + 8, col.muted, { w: '400', size: 10, align: 'center', mono: true }); if (k === 0) line(ctx, [[x0 + i * bw, yH - 14], [x0 + i * bw, yL + 24]], col.border, 1, [2, 3]); });
      rx.samples.forEach(function (s) { var x = x0 + (s.frame * 10 + s.pos) * bw; dot(ctx, x, s.bit ? yH : yL, s.ok ? col.viz1 : col.bad, 4); });
      var ok = rx.bytes.every(function (b, i) { return b === u.bytes[i]; }) && !rx.framing;
      text(ctx, 'Receiver (clock ' + (u.mismatch >= 0 ? '+' : '') + fmt(u.mismatch * 100, 1) + '%) reads 0x' + rx.bytes.map(function (b) { return hex(b); }).join(' 0x') + (rx.framing ? ', framing error' : '') + (ok ? '  ✓' : '  ✗'), 12, c.H - 24, ok ? col.viz1 : col.bad, { size: 12 });
      text(ctx, 'dots: where the receiver samples', x1, c.H - 24, col.muted, { w: '400', size: 11, align: 'right' });
    } else if (u.proto === 'i2c') {
      var b2 = E.i2cBits(0x48, u.bytes), T = 1 / u.i2cRate, tau = u.r * u.cap * 1e-12, bw2 = (x1 - x0) / (b2.length + 1), lanes = [['SCL', c.H * 0.24], ['SDA', c.H * 0.55]], A = c.H * 0.16;
      text(ctx, 'I²C at ' + (u.i2cRate / 1e3) + ' kHz to address 0x48: address + write, ACK, then each byte + ACK', 12, 6, col.text, { size: 12 });
      function rc(v0, v1, s) { return v1 > v0 ? v1 - (v1 - v0) * Math.exp(-s * T / Math.max(tau, 1e-12)) : v1; }
      var sda = [], scl = [], bad = 0, prev = 1, N = 24;
      b2.forEach(function (b, i) {
        for (var k = 0; k <= N; k++) {
          var s = k / N, x = x0 + (i + 0.5 + s) * bw2;
          var vs = b[1] ? rc(prev ? 1 : 0, 1, s) : 0; sda.push([x, lanes[1][1] + A / 2 - vs * A]);
          var high = s >= 0.25 && s < 0.75, vc = high ? rc(0, 1, s - 0.25) : 0; scl.push([x, lanes[0][1] + A / 2 - vc * A]);
        }
        var vAt = b[1] ? rc(prev ? 1 : 0, 1, 0.5) : 0, readHigh = vAt > 0.7, wrong = readHigh !== !!b[1] || (b[1] && rc(0, 1, 0.5) < 0.7 && !prev);
        if (wrong) bad++;
        dot(ctx, x0 + (i + 1) * bw2, lanes[1][1] + A / 2 - vAt * A, wrong ? col.bad : col.viz1, 3);
        text(ctx, b[0], x0 + (i + 1) * bw2, lanes[1][1] + A / 2 + 6, col.muted, { w: '400', size: 9, align: 'center', mono: true });
        prev = b[1];
      });
      lanes.forEach(function (l) { text(ctx, l[0], 12, l[1] - 7, col.muted, { w: '500', size: 11 }); });
      line(ctx, scl, col.text, 1.6); line(ctx, sda, col.accent, 1.8);
      var rise = E.i2cRise(u.r, u.cap), over = rise > E.i2cRiseLimit(u.i2cRate);
      text(ctx, bad ? bad + ' bits read wrong ✗' : over ? 'Every bit reads right here, but out of spec: no margin for a longer wire ⚠' : 'Every bit reads right ✓', 12, c.H - 42, bad ? col.bad : over ? col.viz2 : col.viz1, { size: 12 });
      text(ctx, 'Rise time ' + fmt(rise * 1e9, 0) + ' ns; the standard allows ' + fmt(E.i2cRiseLimit(u.i2cRate) * 1e9, 0) + ' ns at this speed', 12, c.H - 22, col.muted, { w: '500', size: 11 });
    } else {
      var bits3 = []; u.bytes.forEach(function (x) { for (var i = 7; i >= 0; i--) bits3.push((x >> i) & 1); });
      var bw3 = (x1 - x0) / (bits3.length + 2), L3 = [['CS', c.H * 0.2], ['SCLK', c.H * 0.42], ['MOSI', c.H * 0.64]], A3 = c.H * 0.12;
      text(ctx, 'SPI at ' + fmt(u.spiRate / 1e6, 1) + ' MHz: chip select low, then a clock and a data line, highest bit first', 12, 6, col.text, { size: 12 });
      L3.forEach(function (l) { text(ctx, l[0], 12, l[1] - 7, col.muted, { w: '500', size: 11 }); });
      var cs = [[x0, L3[0][1] - A3 / 2], [x0 + bw3 * 0.6, L3[0][1] - A3 / 2], [x0 + bw3 * 0.6, L3[0][1] + A3 / 2], [x0 + bw3 * (bits3.length + 1.4), L3[0][1] + A3 / 2], [x0 + bw3 * (bits3.length + 1.4), L3[0][1] - A3 / 2], [x1, L3[0][1] - A3 / 2]];
      line(ctx, cs, col.text, 1.6);
      var ck = [[x0, L3[1][1] + A3 / 2]], mo = [[x0, L3[2][1]]];
      bits3.forEach(function (b, i) {
        var xa = x0 + (i + 1) * bw3, y = L3[2][1] + (b ? -A3 / 2 : A3 / 2);
        ck.push([xa, L3[1][1] + A3 / 2]); ck.push([xa + bw3 / 2, L3[1][1] + A3 / 2]); ck.push([xa + bw3 / 2, L3[1][1] - A3 / 2]); ck.push([xa + bw3, L3[1][1] - A3 / 2]); ck.push([xa + bw3, L3[1][1] + A3 / 2]);
        mo.push([xa, mo[mo.length - 1][1]]); mo.push([xa, y]); mo.push([xa + bw3, y]);
        text(ctx, String(b), xa + bw3 / 2, L3[2][1] + A3 / 2 + 4, col.muted, { w: '400', size: 9, align: 'center', mono: true });
      });
      line(ctx, ck, col.text, 1.6); line(ctx, mo, col.accent, 1.8);
      text(ctx, 'The clock travels with the data, so both ends agree on every bit at any speed the wires allow.', 12, c.H - 24, col.muted, { w: '500', size: 12 });
    }
  };
  V['bus-zoom'] = function (c, S) {
    var u = S.u, ctx = c.ctx;
    if (u.proto === 'uart') {
      var x0 = 60, x1 = c.W - 20, bw = (x1 - x0) / 10, y = 50, rx = E.uartReceive([u.bytes[0]], u.mismatch);
      text(ctx, 'One frame: where each sample lands inside its bit (the middle is safest)', 12, 6, col.text, { size: 12 });
      for (var k = 0; k < 10; k++) { box(ctx, x0 + k * bw + 1, y, bw - 2, 36, withAlpha(col.accent, 0.06), col.border, 3); text(ctx, k === 0 ? 'S' : k === 9 ? 'P' : 'd' + (k - 1), x0 + (k + 0.5) * bw, y + 40, col.muted, { w: '400', size: 10, mono: true, align: 'center' }); line(ctx, [[x0 + (k + 0.5) * bw, y], [x0 + (k + 0.5) * bw, y + 36]], col.border, 1, [2, 2]); }
      rx.samples.forEach(function (s) { cross(ctx, x0 + s.pos * bw, y + 18, 6, s.ok ? col.viz1 : col.bad, 2); });
      text(ctx, 'By the stop bit the sample has drifted ' + fmt(9.5 * u.mismatch * 100, 0) + '% of a bit. Past 50% it reads the wrong bit: about ±5% between the two clocks.', 12, c.H - 26, col.muted, { w: '500', size: 11 });
    } else if (u.proto === 'i2c') {
      var T = 1 / u.i2cRate, tau = u.r * u.cap * 1e-12, xs = [], ys = [], span = T;
      for (var i = 0; i <= 200; i++) { var t = span * i / 200; xs.push(t * 1e6); ys.push(VCC * (1 - Math.exp(-t / Math.max(tau, 1e-12)))); }
      var P = xyPlot(c, [{ x: xs, y: ys, c: col.accent, lw: 2, name: 'SDA after the chip lets go (V)' }, { x: [0, span * 1e6], y: [0.7 * VCC, 0.7 * VCC], c: col.viz2, dash: [5, 4], name: 'reads as 1 above 0.7 VCC' }], [0, span * 1e6], [0, 3.3], 'One rising edge: the pull-up (' + fmtOhm(u.r) + ') charging ' + u.cap + ' pF', 'µs');
      var ts = 0.5 * T * 1e6; line(ctx, [[P.X(ts), P.y0], [P.X(ts), P.y1]], col.muted, 1, [3, 3]); text(ctx, 'sampled here', P.X(ts) + 4, P.y0 + 4, col.muted, { w: '400', size: 10 });
    } else {
      text(ctx, 'SPI needs no agreed speed and no pull-ups: the master drives every line, push-pull, both ways.', 12, 10, col.text, { size: 12 });
      text(ctx, 'It costs wires: clock, data out, data in, and a chip-select line for every chip.', 12, 32, col.muted, { w: '500', size: 12 });
    }
  };
  V['bus-compare'] = function (c, S) {
    var u = S.u, n = 2;
    bars(c, [['UART, 2 wires', E.busTime('uart', n, u.baud), col.accent], ['I²C, 2 wires + pull-ups', E.busTime('i2c', n, u.i2cRate), col.viz2], ['SPI, 4 wires', E.busTime('spi', n, u.spiRate), col.viz1]], 'Time to send these 2 bytes at the current settings', function (v) { return fmtSI(v, 's'); }, 170);
  };

  /* ---- 8. power ---- */
  V['power-profile'] = function (c, S) {
    var p = S.p, ctx = c.ctx, ph = E.wakePhases(Object.assign({}, p, { radioEvery: p.radioEvery ? 1 : 0, recordsPerPage: 1e9 })), x0 = 56, x1 = c.W - 200, y0 = 30, y1 = c.H - 26;
    var tot = ph.reduce(function (a, b) { return a + (b[0] === 'thermistor divider' ? 0 : b[2]); }, 0) + 0.006, lo = Math.log10(5e-7), hi = Math.log10(2e-2);
    function Y(I) { return y1 - (Math.log10(Math.max(I, 5e-7)) - lo) / (hi - lo) * (y1 - y0); }
    text(ctx, 'One wake, current on a log scale (each area is charge)', x0, 8, col.text, { size: 12 });
    ctx.strokeStyle = col.border; ctx.lineWidth = 1; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    [[1e-6, '1 µA'], [1e-5, '10 µA'], [1e-4, '100 µA'], [1e-3, '1 mA'], [1e-2, '10 mA']].forEach(function (g) { var y = Y(g[0]); line(ctx, [[x0, y], [x1, y]], col.border, 1, [2, 4]); text(ctx, g[1], x0 - 4, y - 6, col.muted, { w: '400', size: 10, align: 'right', mono: true }); });
    var base = p.sleep + (p.dividerOn ? VCC / 20000 : 0), palette = [col.accent, col.viz3 || '#d8a03a', col.viz4 || '#b07ad8', '#d8332a', col.viz1], seq = [], t = 0;
    function X(s) { return x0 + s / tot * (x1 - x0); }
    // The phases one after another; a switched divider only draws current during the ADC phase.
    ph.forEach(function (q) {
      if (q[0] === 'thermistor divider' || q[2] < 1e-6) return;
      var extra = q[0] === 'wake + ADC' && !p.dividerOn ? VCC / 20000 : 0;
      seq.push([q[0] + (extra ? ' (+ divider)' : ''), t, q[2], base + q[1] + extra, palette[seq.length % palette.length], (q[1] + extra) * q[2]]); t += q[2];
    });
    seq.forEach(function (s) { ctx.fillStyle = withAlpha(s[4], 0.7); ctx.fillRect(X(s[1]), Y(s[3]), Math.max(1.5, X(s[1] + s[2]) - X(s[1])), y1 - Y(s[3])); });
    ctx.fillStyle = withAlpha(col.muted, 0.35); ctx.fillRect(X(t), Y(base), x1 - X(t), y1 - Y(base));
    var tx = x1 + 14;
    seq.forEach(function (s, i) { ctx.fillStyle = s[4]; ctx.fillRect(tx, 30 + i * 18 + 3, 10, 10); text(ctx, s[0] + ': ' + fmtSI(s[5], 'C'), tx + 16, 30 + i * 18, col.muted, { w: '500', size: 11 }); });
    text(ctx, 'then sleeps ' + fmtTime(p.interval - tot) + ' at ' + fmtSI(base, 'A'), tx, 36 + seq.length * 18, col.text, { size: 11 });
  };
  V['power-life'] = function (c, S) {
    var L = E.lifetime(S.p), months = Math.max(14, Math.min(120, L.days / 30.4 * 1.25)), xs = [], ocv = [], pulse = [];
    for (var i = 0; i <= 200; i++) {
      var m = months * i / 200, used = m * 30.4 * 24 * L.avg / (E.CELL.mAh * 1e-3); if (used > 1) break;
      xs.push(m); ocv.push(E.cellOcv(used)); pulse.push(E.cellOcv(used) - E.sag(L.peakI, L.tp, E.cellR(used), S.p.cap));
    }
    var P = xyPlot(c, [{ x: xs, y: ocv, c: col.muted, lw: 1.4, name: 'resting voltage' }, { x: xs, y: pulse, c: col.accent, lw: 2, name: 'during the biggest pulse (' + fmtSI(L.peakI, 'A') + ')' }, { x: [0, months], y: [2, 2], c: col.bad, dash: [5, 4], name: 'brown-out 2.0 V' }], [0, months], [1.6, 3.1], 'The coin cell over its life', 'months');
    var dx = P.X(L.days / 30.4), gx = P.X(12);
    line(c.ctx, [[gx, P.y0], [gx, P.y1]], col.viz1, 1, [3, 3]); text(c.ctx, '1 year', gx + 4, P.y0 + 2, col.viz1, { w: '500', size: 10 });
    if (L.days / 30.4 < months) { line(c.ctx, [[dx, P.y0], [dx, P.y1]], col.bad, 2); text(c.ctx, L.browns ? 'resets under load' : 'empty', dx + 4, P.y1 - 16, col.bad, { size: 11 }); }
  };
  V['power-budget'] = function (c, S) {
    var L = E.lifetime(S.p), B = E.budget(S.p), rows = B.items.slice().sort(function (a, b) { return b[1] - a[1]; }).map(function (r) { return [r[0], r[1], r[0].indexOf('divider') >= 0 || r[0] === 'LED' ? col.bad : col.accent]; });
    bars(c, rows, 'Average current, by where it goes: ' + fmtSI(B.avg, 'A') + ' in all', function (v) { return fmtSI(v, 'A'); }, 160);
    var ok = L.days >= 365;
    text(c.ctx, fmt(L.days, 0) + ' days', c.W - 16, c.H - 44, ok ? col.viz1 : col.bad, { size: 20, mono: true, align: 'right' });
    text(c.ctx, ok ? 'a year or more ✓' : 'goal: 365', c.W - 16, c.H - 20, col.muted, { w: '500', size: 11, align: 'right' });
  };

  /* ---- 9. the bike light's modes ---- */
  function fsmNow(S) { var k = S.k, f = E.lightFsm(k.events, k); return f.tick(S.t); }
  V.bike = function (c, S, tab, slot) {
    var ctx = c.ctx, k = S.k, mode = fsmNow(S), lx = 60, ly = c.H / 2 - 40, lw = 140, lh = 80;
    var I = { OFF: 0, LOW: 0.25, MID: 0.55, HIGH: 1, FLASH: (S.t * 4) % 1 < 0.4 ? 1 : 0 }[mode];
    if (I > 0) { var g = ctx.createLinearGradient(lx + lw, 0, c.W - 40, 0); g.addColorStop(0, 'rgba(255,248,210,' + 0.85 * I + ')'); g.addColorStop(1, 'rgba(255,248,210,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(lx + lw, ly + 15); ctx.lineTo(c.W - 40, ly - 60); ctx.lineTo(c.W - 40, ly + lh + 60); ctx.lineTo(lx + lw, ly + lh - 15); ctx.closePath(); ctx.fill(); }
    box(ctx, lx, ly, lw, lh, col.bgSoft, col.text, 14);
    ctx.fillStyle = I > 0 ? 'rgba(255,250,220,' + (0.4 + 0.6 * I) + ')' : withAlpha(col.muted, 0.3); ctx.beginPath(); ctx.arc(lx + lw - 22, ly + lh / 2, 16, 0, 7); ctx.fill();
    var bx = lx + 40, by = ly + lh / 2, R = 18;
    ctx.fillStyle = k.down ? col.accent : withAlpha(col.accent, 0.35); ctx.beginPath(); ctx.arc(bx, by, R, 0, 7); ctx.fill(); ctx.strokeStyle = col.accent; ctx.lineWidth = 2; ctx.stroke();
    text(ctx, 'hold to press', bx, ly + lh + 10, col.muted, { w: '500', size: 11, align: 'center' });
    text(ctx, mode, lx + lw / 2, ly - 30, col.text, { size: 18, mono: true, align: 'center' });
    if (k.down) { var held = S.t - k.downAt; text(ctx, 'held ' + fmt(held, 1) + ' s' + (held >= k.long ? ' (long)' : ''), lx + lw / 2, ly + lh + 28, held >= k.long ? col.viz2 : col.muted, { size: 12, mono: true, align: 'center' }); }
    tab.hit[slot] = { down: function (q, p) { if (Math.hypot(p.x - bx, p.y - by) > R + 10) return null; k.down = true; k.downAt = S.t; k.events.push({ t: S.t, down: true }); return function () {}; },
      up: function () { if (k.down) { k.down = false; k.events.push({ t: S.t, down: false }); } },
      cursor: function (q, p) { return Math.hypot(p.x - bx, p.y - by) < R + 10 ? 'pointer' : ''; } };
  };
  V.fsm = function (c, S) {
    var ctx = c.ctx, mode = fsmNow(S), cx = c.W * 0.32, cy = c.H / 2 + 6, R = Math.min(c.H / 2 - 30, 90), names = E.MODES, pos = {};
    names.forEach(function (m, i) { var a = -Math.PI / 2 + i / names.length * 2 * Math.PI; pos[m] = [cx + R * Math.cos(a) * 1.5, cy + R * Math.sin(a)]; });
    text(ctx, 'The state machine', 12, 6, col.text, { size: 12 });
    function arrow(a, b, colr, lbl) {
      var dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, s = [a[0] + ux * 24, a[1] + uy * 16], e = [b[0] - ux * 24, b[1] - uy * 16];
      line(ctx, [s, e], colr, 1.4); ctx.fillStyle = colr; ctx.beginPath(); ctx.moveTo(e[0], e[1]); ctx.lineTo(e[0] - ux * 8 - uy * 4, e[1] - uy * 8 + ux * 4); ctx.lineTo(e[0] - ux * 8 + uy * 4, e[1] - uy * 8 - ux * 4); ctx.fill();
      if (lbl) text(ctx, lbl, (s[0] + e[0]) / 2 + 4, (s[1] + e[1]) / 2 - 14, colr, { w: '500', size: 10 });
    }
    names.forEach(function (m) { if (m !== 'OFF') arrow(pos[m], pos.OFF, withAlpha(col.viz2, 0.45)); });
    [['OFF', 'LOW'], ['LOW', 'MID'], ['MID', 'HIGH'], ['HIGH', 'FLASH'], ['FLASH', 'LOW']].forEach(function (e, i) { arrow(pos[e[0]], pos[e[1]], col.muted, i === 0 ? 'short' : null); });
    names.forEach(function (m) { var p = pos[m], on = m === mode; box(ctx, p[0] - 26, p[1] - 14, 52, 28, on ? col.accent : col.bgSoft, on ? col.accent : col.border, 14); text(ctx, m, p[0], p[1] - 7, on ? '#fff' : col.text, { size: 11, mono: true, align: 'center' }); });
    var tx = cx + R * 1.5 + 50;
    text(ctx, 'short press: next mode', tx, 30, col.muted, { w: '500', size: 12 });
    text(ctx, 'long press: OFF', tx, 50, col.viz2, { w: '500', size: 12 });
    text(ctx, S.k.onPress ? 'acting on press: a long press steps a mode first' : 'acting on release: the length is known first', tx, 76, col.text, { size: 12 });
  };
  V['fsm-time'] = function (c, S) {
    var k = S.k, ctx = c.ctx, x0 = 70, x1 = c.W - 14, W = 10, t1 = S.t, t0 = t1 - W;
    function X(t) { return x0 + (t - t0) / W * (x1 - x0); }
    text(ctx, 'The last 10 s', 12, 6, col.text, { size: 12 });
    text(ctx, 'button', 12, 34, col.muted, { w: '500', size: 11 }); text(ctx, 'mode', 12, 84, col.muted, { w: '500', size: 11 });
    var down = null;
    k.events.concat(k.down ? [{ t: t1, down: false, live: true }] : []).forEach(function (e) {
      if (e.down) down = e.t; else if (down !== null) { var a = X(Math.max(down, t0)), b = X(e.t); if (b > x0) { ctx.fillStyle = withAlpha(col.accent, 0.6); ctx.fillRect(a, 28, b - a, 22); var lx = X(down + k.long); if (lx > x0 && lx < x1) line(ctx, [[lx, 24], [lx, 54]], col.viz2, 1.5, [3, 2]); } down = null; }
    });
    var f = E.lightFsm(k.events, k); f.tick(t1);
    var segs = [{ t: -1e9, state: 'OFF' }].concat(f.log);
    segs.forEach(function (s, i) {
      var a = Math.max(X(s.t), x0), b = X(i + 1 < segs.length ? segs[i + 1].t : t1); if (b <= x0) return;
      box(ctx, a, 74, Math.max(2, b - a - 2), 26, s.state === 'OFF' ? col.bgSoft : withAlpha(col.accent, 0.25), col.border, 3);
      if (b - a > 34) text(ctx, s.state, a + 6, 80, col.text, { size: 10, mono: true });
    });
    text(ctx, 'dashed: where a press becomes long (' + fmt(k.long, 1) + ' s)', x1, c.H - 18, col.viz2, { w: '400', size: 10, align: 'right' });
  };

  /* ---- 10. the bike light's battery ---- */
  // Runs the light in one mode from full until cut-off. The MCU reads the battery through a divider of `ratio` with a
  // 3.3 V reference: above 3.3 × ratio volts it only sees the top code. Step-down drops to LOW once it reads < 3.4 V.
  function runLight(r, mode) {
    var used = 0, h = 0, I = E.MODE_I[mode], out = { h: [], v: [], read: [], stepAt: null, cut: null }, dt = 0.01;
    while (h < 200) {
      var v = E.liionV(used) - I * 0.05, read = Math.min(v / r.ratio, 3.3) * r.ratio;
      out.h.push(h); out.v.push(v); out.read.push(read);
      if (r.stepdown && out.stepAt === null && read < 3.4 && I > E.MODE_I.LOW) { out.stepAt = h; I = E.MODE_I.LOW; }
      if (read < 3.0 || used >= 1) { out.cut = h; break; }
      used += I * dt / (E.LIION.mAh / 1000); h += dt;
    }
    if (out.cut === null) out.cut = h;
    return out;
  }
  V['bike-run'] = function (c, S) {
    var r = S.r, R = runLight(r, r.mode), step = Math.max(1, Math.floor(R.h.length / 300)), xs = [], v = [], rd = [];
    for (var i = 0; i < R.h.length; i += step) { xs.push(R.h[i]); v.push(R.v[i]); rd.push(R.read[i]); }
    var P = xyPlot(c, [{ x: xs, y: v, c: col.muted, lw: 1.6, name: 'battery voltage' }, { x: xs, y: rd, c: col.accent, lw: 2, name: 'what the MCU reads' }, { x: [0, R.cut * 1.05], y: [3.4, 3.4], c: col.viz2, dash: [5, 4], name: 'step-down 3.4 V' }],
      [0, R.cut * 1.05], [2.8, 4.3], 'An 18650 cell running the light on ' + r.mode + ' (' + fmt(E.MODE_I[r.mode], 2) + ' A)', 'hours');
    if (R.stepAt !== null) { var x = P.X(R.stepAt); line(c.ctx, [[x, P.y0], [x, P.y1]], col.viz2, 1.5); text(c.ctx, 'steps down to LOW', x + 4, P.y0 + 4, col.viz2, { size: 11 }); }
    text(c.ctx, 'runs ' + fmt(R.cut, 1) + ' h', P.x1 - 4, P.y0 + 4, col.text, { size: 12, mono: true, align: 'right' });
  };
  V['bike-adc'] = function (c, S) {
    var r = S.r, xs = [], ys = [];
    for (var v = 2.8; v <= 4.3; v += 0.01) { xs.push(v); ys.push(Math.min(v / r.ratio, 3.3)); }
    var P = xyPlot(c, [{ x: xs, y: ys, c: col.accent, lw: 2, name: 'voltage at the ADC pin' }, { x: [2.8, 4.3], y: [3.3, 3.3], c: col.bad, dash: [5, 4], name: 'reference 3.3 V: the top code' }], [2.8, 4.3], [0, 3.6], r.ratio > 1 ? 'Through a ' + fmt(r.ratio, 1) + ' : 1 divider' : 'Straight to the pin, no divider', 'battery (V)');
    if (r.ratio * 3.3 < 4.3) { var x = P.X(Math.max(2.8, r.ratio * 3.3)); c.ctx.fillStyle = withAlpha(col.bad, 0.1); c.ctx.fillRect(x, P.y0, P.x1 - x, P.y1 - P.y0); text(c.ctx, 'can\'t tell these apart', x + 4, P.y1 - 16, col.bad, { size: 11 }); }
  };
  V['bike-modes'] = function (c, S) {
    var r = S.r;
    bars(c, ['LOW', 'MID', 'HIGH', 'FLASH'].map(function (m) { return [m, runLight(r, m).cut, m === r.mode ? col.accent : col.muted]; }), 'Hours on a full charge, by mode', function (v) { return fmt(v, 1) + ' h'; }, 80);
  };

  /* ================= controls ================= */
  function syncer(tab, f) { tab.sync.push(f); }
  var CTRL = {};
  CTRL.hint = function (p, S, tab) { if (tab.hint) hint(p, tab.hint); };
  CTRL.button = function (p, S) {
    var b = S.b;
    h3(p, 'Input');
    toggle(p, 'Pull-up', [[true, 'Pull-up'], [false, 'Floating']], b.pull, function (v) { b.pull = v; retrace(S); });
    toggle(p, 'Filter', [[false, 'No capacitor'], [true, 'RC filter']], b.cap, function (v) { b.cap = v; retrace(S); });
    toggle(p, 'Input type', [[false, 'Plain'], [true, 'Schmitt']], b.schmitt, function (v) { b.schmitt = v; retrace(S); });
    h3(p, 'Software');
    slider(p, 'Debounce', 0, 20, 1, b.debounce, function (v) { return v ? v + ' ms' : 'off'; }, function (v) { b.debounce = v; retrace(S); });
    button(p, 'Reset the counts', function () { b.presses = 0; b.counted = 0; });
  };
  CTRL.adc = function (p, S) {
    var a = S.a, clear = function () { a.ht = []; a.hv = []; a.hr = []; };
    h3(p, 'Converter');
    slider(p, 'Bits', 6, 14, 1, a.bits, function (v) { return v + ' (' + Math.pow(2, v) + ' codes)'; }, function (v) { a.bits = v; clear(); });
    slider(p, 'Reference', 1.0, 3.3, 0.1, a.vref, function (v) { return fmt(v, 1) + ' V'; }, function (v) { a.vref = v; clear(); });
    slider(p, 'Average', 0, 6, 1, 0, function (v) { return Math.pow(2, v) + (v ? ' readings' : ' reading'); }, function (v) { a.avg = Math.pow(2, v); clear(); });
    h3(p, 'Signal');
    slider(p, 'Input', 0, 3.3, 0.01, a.v0, function (v) { return fmt(v, 2) + ' V'; }, function (v) { a.v0 = v; clear(); });
    slider(p, 'Noise σ', 0, 0.02, 0.0005, a.noise, function (v) { return fmt(v * 1000, 1) + ' mV'; }, function (v) { a.noise = v; clear(); });
  };
  CTRL.ntc = function (p, S, tab) {
    var n = S.n;
    h3(p, 'Divider');
    slider(p, 'Fixed resistor', 3, 5, 0.05, Math.log10(n.rf), function (v) { return fmtOhm(Math.round(Math.pow(10, v) / 100) * 100); }, function (v) { n.rf = Math.round(Math.pow(10, v) / 100) * 100; });
    slider(p, 'ADC bits', 8, 12, 1, n.bits, function (v) { return v + ' bits'; }, function (v) { n.bits = v; });
    h3(p, 'Code to °C');
    toggle(p, 'Method', [['linear', 'Straight line'], ['beta', 'Beta formula'], ['table', 'Table']], n.method, function (v) { n.method = v; });
    var ts = slider(p, 'Temperature', -20, 80, 1, n.T, function (v) { return v + ' °C'; }, function (v) { n.T = v; });
    tab.syncT = function () { ts.set(n.T); };
  };
  CTRL.led = function (p, S) {
    var l = S.l;
    h3(p, 'Brightness');
    slider(p, 'Level', 0, 255, 1, l.level, function (v) { return v + ' / 255'; }, function (v) { l.level = v; });
    toggle(p, 'Mapping', [[false, 'duty = level'], [true, 'Gamma']], l.gamma, function (v) { l.gamma = v; });
    h3(p, 'PWM and circuit');
    slider(p, 'Frequency', 1, 3.5, 0.01, Math.log10(l.freq), function (v) { return fmt(Math.pow(10, v), 0) + ' Hz'; }, function (v) { l.freq = Math.round(Math.pow(10, v)); });
    slider(p, 'Resistor', 1.7, 3, 0.01, Math.log10(l.r), function (v) { return fmtOhm(Math.round(Math.pow(10, v))); }, function (v) { l.r = Math.round(Math.pow(10, v)); });
  };
  CTRL.memory = function (p, S, tab) {
    var m = S.m;
    h3(p, 'Data');
    slider(p, 'Log buffer', 0, 2000, 50, m.samples, function (v) { return v + ' samples'; }, function (v) { m.samples = v; });
    toggle(p, 'Sample type', [['float', 'float'], ['int16', 'int16'], ['int8', 'int8']], m.type, function (v) { m.type = v; });
    toggle(p, 'Table', [[false, 'Plain'], [true, 'const']], m.constTable, function (v) { m.constTable = v; });
    h3(p, 'Code');
    toggle(p, 'Format', [[true, 'printf'], [false, 'Hand-written']], m.printf, function (v) { m.printf = v; });
    slider(p, 'filter() window', 0, 512, 8, m.window, function (v) { return v + ' samples'; }, function (v) { m.window = v; });
    slider(p, 'malloc', 0, 2048, 64, m.heap, function (v) { return fmtBytes(v); }, function (v) { m.heap = v; });
    var t = telemetry(p, [['flash', 'Flash used'], ['ram', 'RAM at peak']]);
    syncer(tab, function () { var M = E.memoryMap(m); setV(t.flash, fmtBytes(M.flashUsed)); setV(t.ram, fmtBytes(M.data + M.bss + M.heap + M.peak) + ' / 8 KB', M.overflow); });
  };
  CTRL.flash = function (p, S, tab) {
    var f = S.f;
    h3(p, 'Logging');
    toggle(p, 'Strategy', [['inplace', 'Rewrite in place'], ['log', 'Ring log']], f.strategy, function (v) { f.strategy = v; });
    slider(p, 'Every', 0, 3.56, 0.02, Math.log10(f.interval), function (v) { return fmtTime(Math.round(Math.pow(10, v))); }, function (v) { f.interval = Math.round(Math.pow(10, v)); });
    slider(p, 'Record', 4, 64, 4, f.record, function (v) { return v + ' bytes'; }, function (v) { f.record = v; });
    slider(p, 'Pages', 2, 32, 1, f.pages, function (v) { return v + ' × 1 KB'; }, function (v) { f.pages = v; });
    h3(p, 'Clock');
    var pb = button(p, 'Pause', function () { f.paused = !f.paused; pb.textContent = f.paused ? 'Run' : 'Pause'; });
    slider(p, 'Speed', 2, 7, 0.1, Math.log10(f.speed), function (v) { return '1 s = ' + fmtTime(Math.pow(10, v)); }, function (v) { f.speed = Math.pow(10, v); });
    button(p, 'Start again', function () { f.simT = 0; });
    button(p, 'Erase the page', function () { f.bytes = f.bytes.map(function () { return 0xFF; }); f.erases++; f.msg = 'Erased: every bit is 1 again (0xFF).'; });
  };
  CTRL.bus = function (p, S, tab) {
    var u = S.u, groups = {};
    h3(p, 'Bus');
    toggle(p, 'Protocol', [['uart', 'UART'], ['i2c', 'I²C'], ['spi', 'SPI']], u.proto, function (v) { u.proto = v; show(); });
    function group(k) { var g = U.el('div', 'lab-ctrl-group'); p.appendChild(g); groups[k] = g; return g; }
    var g1 = group('uart');
    toggle(g1, 'Baud', [[9600, '9600'], [115200, '115200']], u.baud, function (v) { u.baud = v; });
    slider(g1, 'Receiver clock off by', -0.08, 0.08, 0.005, u.mismatch, function (v) { return (v >= 0 ? '+' : '') + fmt(v * 100, 1) + '%'; }, function (v) { u.mismatch = v; });
    var g2 = group('i2c');
    toggle(g2, 'Speed', [[100e3, '100 kHz'], [400e3, '400 kHz']], u.i2cRate, function (v) { u.i2cRate = v; });
    slider(g2, 'Pull-up', 3, 4.7, 0.05, Math.log10(u.r), function (v) { return fmtOhm(Math.round(Math.pow(10, v) / 100) * 100); }, function (v) { u.r = Math.round(Math.pow(10, v) / 100) * 100; });
    slider(g2, 'Bus capacitance', 20, 400, 10, u.cap, function (v) { return v + ' pF'; }, function (v) { u.cap = v; });
    var g3 = group('spi');
    slider(g3, 'Clock', 5, 7.3, 0.05, Math.log10(u.spiRate), function (v) { return fmt(Math.pow(10, v) / 1e6, 1) + ' MHz'; }, function (v) { u.spiRate = Math.pow(10, v); });
    function show() { Object.keys(groups).forEach(function (k) { groups[k].style.display = k === u.proto ? '' : 'none'; }); }
    show();
  };
  CTRL.power = function (p, S, tab) {
    var o = S.p;
    h3(p, 'Schedule');
    slider(p, 'Wake every', 0, 2.78, 0.02, Math.log10(o.interval), function (v) { return fmtTime(Math.round(Math.pow(10, v))); }, function (v) { o.interval = Math.round(Math.pow(10, v)); });
    slider(p, 'Send every', 0, 60, 1, o.radioEvery, function (v) { return v ? (v === 1 ? 'wake' : v + ' wakes') : 'never'; }, function (v) { o.radioEvery = v; });
    h3(p, 'Hardware');
    slider(p, 'Sleep current', -0.3, 1.3, 0.05, Math.log10(o.sleep * 1e6), function (v) { return fmt(Math.pow(10, v), 1) + ' µA'; }, function (v) { o.sleep = Math.pow(10, v) * 1e-6; });
    toggle(p, 'Divider', [[true, 'Always on'], [false, 'Switched by a pin']], o.dividerOn, function (v) { o.dividerOn = v; });
    slider(p, 'LED blink', 0, 100, 5, o.led, function (v) { return v ? v + ' ms' : 'off'; }, function (v) { o.led = v; });
    slider(p, 'Capacitor', 0, 470, 10, o.cap, function (v) { return v ? v + ' µF' : 'none'; }, function (v) { o.cap = v; });
  };
  CTRL.modes = function (p, S) {
    var k = S.k, reset = function () { k.events = []; k.down = false; };
    h3(p, 'Firmware');
    toggle(p, 'Act', [[true, 'On press'], [false, 'On release']], k.onPress, function (v) { k.onPress = v; reset(); });
    slider(p, 'Long press', 0.3, 2, 0.1, k.long, function (v) { return fmt(v, 1) + ' s'; }, function (v) { k.long = v; reset(); });
    button(p, 'Start again (off)', reset);
  };
  CTRL.runtime = function (p, S) {
    var r = S.r;
    h3(p, 'Light');
    toggle(p, 'Mode', [['LOW', 'Low'], ['MID', 'Mid'], ['HIGH', 'High'], ['FLASH', 'Flash']], r.mode, function (v) { r.mode = v; });
    h3(p, 'Battery sensing');
    slider(p, 'Divider', 1, 3, 0.1, r.ratio, function (v) { return v > 1 ? fmt(v, 1) + ' : 1' : 'none'; }, function (v) { r.ratio = v; });
    toggle(p, 'Step-down', [[true, 'Step down at 3.4 V'], [false, 'Run until cut-off']], r.stepdown, function (v) { r.stepdown = v; });
  };

  /* ================= lessons ================= */
  var tabs = CFG.tabs.map(function (tc) {
    var tab = Object.assign({}, tc), S = makeState(tc);
    tab.S = S; tab.hit = {}; tab.sync = [];
    var panel = document.getElementById(tc.id + '-panel');
    (tc.controls || []).forEach(function (k) { if (CTRL[k]) CTRL[k](panel, S, tab); });
    ['top', 'row1', 'row2'].forEach(function (slot) { var cv = document.getElementById(tc.id + '-' + slot); if (cv) U.bindPointer(cv, tab, slot); });
    return tab;
  });
  var secEls = Shell.start(CFG).secEls;

  /* ================= the loop ================= */
  var last = null;
  function frame(ts) {
    var dt = last === null ? 1 / 60 : Math.min(0.1, (ts - last) / 1000); last = ts;
    U.readColors();
    tabs.forEach(function (tab, i) {
      if (!secEls[i] || !secEls[i].classList.contains('active')) return;
      var S = tab.S;
      if (S.kind === 'adc') adcTick(S, dt); else S.t += dt;
      if (S.flash > 0) S.flash -= dt;
      if (S.kind === 'flash' && !S.f.paused) S.f.simT += dt * S.f.speed;
      ['top', 'row1', 'row2'].forEach(function (slot) {
        var vname = tab[slot], cv = document.getElementById(tab.id + '-' + slot); if (!cv || !V[vname]) return;
        V[vname](U.fit(cv), S, tab, slot);
      });
      tab.sync.forEach(function (f) { f(); });
    });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
