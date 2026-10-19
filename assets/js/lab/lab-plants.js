// LabPlants — one entry per existing sim on /controls/, with the same constants as
// controls.js. A plant is only its dynamics and its picture; everything else (controllers,
// analysis, filters, identification) comes from lab-core.js and lab.js.
//
//   n, m              number of states and inputs
//   params            physical constants (a page may override them, e.g. a "real" plant)
//   x0(p), u0(p)      the equilibrium the controllers hold (trim, for the aircraft)
//   deriv(x, u, p)    the nonlinear equations of motion
//   ulim(p)           actuator limits per input
//   noise             measurement-noise scale per state (times the page's noise slider)
//   controllers       the controller structures this plant supports (see LabCore.loopModel)
//   refs              the reference each controller channel tracks (shape, size, period)
//   draw(ctx, W, H, sim, lab, col)   the picture, in the style of the sim on /controls/
//
// If a constant changes in controls.js it must change here too; script/test-lab checks the
// cart-pole's linear model against the A and B printed on /controls/.
(function (root) {
  'use strict';
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function deg(r) { return r * 180 / Math.PI; }
  function rad(d) { return d * Math.PI / 180; }
  function withAlpha(c, a) {
    var m = /^#([0-9a-f]{6})$/i.exec(c); if (!m) return c;
    var n = parseInt(m[1], 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function refMarker(ctx, x0, y0, x1, y1, col) {
    ctx.save(); ctx.strokeStyle = col.accent; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.restore();
  }

  // The state box in the lower right of every sim (statebox.js, shared with /controls/swingup/).
  function stateBox(ctx, W, H, rows) { if (typeof drawStateBox === 'function') drawStateBox(ctx, W, H, rows); }
  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function isDark() {
    var t = document.documentElement.getAttribute('data-theme');
    return t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function statusLine(ctx, label, color, sub, col) {
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = '600 13px ' + col.font; ctx.fillStyle = color; ctx.fillText(label, 14, 24);
    if (sub) { ctx.font = '11px ' + col.mono; ctx.fillStyle = col.muted; ctx.fillText(sub, 14, 42); }
  }
  function drawSpring(ctx, x1, y1, x2, y2, coils) {
    var dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy), px = -dy / len, py = dx / len, n = coils * 2;
    ctx.beginPath(); ctx.moveTo(x1, y1);
    for (var i = 0; i <= n; i++) { var off = (i === 0 || i === n) ? 0 : (i % 2 === 0 ? 10 : -10); ctx.lineTo(x1 + dx * i / n + px * off, y1 + dy * i / n + py * off); }
    ctx.stroke();
  }
  // Who is driving, for the status line every sim shows top left.
  function who(lab, label) {
    if (lab.manual) return null;
    if (!lab.controller.channels.length) return label;          // no controller by design (a shaker)
    var allZero = lab.controller.channels.every(function (ch, ci) { return Object.keys(lab.gains[ci]).every(function (k) { return !lab.gains[ci][k]; }); });
    return allZero && !lab.useNet ? 'none' : label;
  }

  /* ---------------- Mass-spring-damper (Demo 1) ---------------- */
  // Positive x is down, and positive F pushes down, as on /controls/.
  var msd = {
    id: 'msd', name: 'Mass-spring-damper', n: 2, m: 1, dt: 0.01, substeps: 2,
    stateNames: ['x', 'ẋ'], inputNames: ['F'], units: ['m', 'm/s'], inputUnits: ['N'],
    params: { M: 1, k: 4, c: 0.4, Fmax: 20, Fcap: 20 },        // underdamped, ζ ≈ 0.1 (controls.js); force always clamped to ±20 N
    x0: function () { return [0, 0]; },
    u0: function () { return [0]; },
    start: function () { return [0, 0]; },
    deriv: function (x, u, p) { return [x[1], (u[0] - p.c * x[1] - p.k * x[0]) / p.M]; },
    ulim: function (p) { return [[-p.Fmax, p.Fmax]]; },
    noise: [1, 0],
    controllers: {
      pid: { label: 'PID', channels: [{ type: 'pid', input: 0, out: 0, sign: 1, gains: { kp: 40, ki: 5, kd: 6 },
             ranges: { kp: [-50, 50], ki: [-20, 20], kd: [-10, 10] } }] },
      // State feedback on position and velocity (LQR with Q = diag(10, 1), R = 0.1; u = K x, so K is negative).
      lqr: { label: 'LQR', channels: [{ type: 'sf', input: 0, rows: [0, 1], names: ['kx', 'kv'], gains: { kx: -6.8, kv: -4.5 },
             ranges: { kx: [-20, 20], kv: [-20, 20] } }] },
      // The same LQR on an estimate: only the position is measured; the velocity is differenced or Kalman-filtered.
      lqg: { label: 'LQR', channels: [{ type: 'obs', input: 0, rows: [0, 1], names: ['kx', 'kv'], meas: [0], rates: [[0, 1]], gains: { kx: -6.8, kv: -4.5 },
             ranges: { kx: [-20, 20], kv: [-20, 20] } }] },
      open: { label: 'none', channels: [], open: { input: 0, out: 0 } }
    },
    // What the estimator view plots: measured or estimated vs true, and which lane is "the rate" for the error readout.
    est: { rate: 1, unit: 'm/s', lanes: [{ label: 'Position x (m): measured vs true', idx: 0, scale: 1, measured: true }, { label: 'Velocity ẋ (m/s): estimate vs true', idx: 1, scale: 1 }] },
    refs: [{ type: 'wave', amp: 1, omega: 0.5, label: 'x', unit: 'm', idx: 0 }],
    states: [{ label: 'x (m)', f: function (x) { return x[0]; } }, { label: 'ẋ (m/s)', f: function (x) { return x[1]; } }],
    contribUnit: 'F (N)', contribScale: 1,
    // Drag the plant's own poles (the Poles view): the pair −σ ± jω_d sets c and k.
    setPoles: function (p, re, im) { p.c = -2 * re * p.M; p.k = p.M * (re * re + im * im); },
    // Manual: drag the mass; a damped virtual spring pulls it toward the pointer, ±10 N.
    manual: function (drag, sim, lab) {
      if (!drag || !lab.view) return [0];
      var xt = (drag.y - lab.view.mid) / lab.view.scale;
      return [clamp(40 * (xt - sim.x[0]) - 8 * sim.x[1], -10, 10)];
    },
    draw: function (ctx, W, H, sim, lab, col) {
      var accent = col.accent, muted = col.muted, strong = col.borderStrong, bgSoft = col.bgSoft, massColor = cssVar('--viz-7'), forceColor = cssVar('--viz-total');
      ctx.fillStyle = bgSoft; ctx.fillRect(0, 0, W, H);
      var cx = clamp(W * 0.35, 110, 300), anchorY = 26, massH = 42, massW = 54, scale = Math.min(80, (H - 90) / 3);
      var t = sim.t, refType = lab.refs[0], rv = function (tt) { return LabCore.refValue(refType, tt); };
      var massY = H / 2 + sim.x[0] * scale, massTop = massY - massH / 2, refNow = rv(t), refY = H / 2 + refNow * scale;
      var springX = cx - 13, damperX = cx + 14;
      lab.view = { mid: H / 2, scale: scale };
      // Reference path: faint dashed future ahead, fading tail behind, a soft dot now.
      var LOOK = 8, pxPerSec = Math.max(20, (W - 16 - cx) / LOOK);
      var refPy = function (tt) { return H / 2 + rv(tt) * scale; };
      ctx.fillStyle = muted; ctx.fillRect(cx - 36, anchorY - 8, 72, 8);
      ctx.strokeStyle = muted; ctx.lineWidth = 1.5; drawSpring(ctx, springX, anchorY, springX, massTop, 7);
      var cylH = 46, cylW = 14;
      ctx.fillStyle = bgSoft; ctx.strokeStyle = strong; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(damperX, anchorY); ctx.lineTo(damperX, anchorY + 6); ctx.stroke();
      ctx.fillRect(damperX - cylW / 2, anchorY + 6, cylW, cylH);
      ctx.beginPath(); ctx.moveTo(damperX - cylW / 2, anchorY + 6); ctx.lineTo(damperX - cylW / 2, anchorY + 6 + cylH);
      ctx.moveTo(damperX + cylW / 2, anchorY + 6); ctx.lineTo(damperX + cylW / 2, anchorY + 6 + cylH);
      ctx.moveTo(damperX - cylW / 2, anchorY + 6); ctx.lineTo(damperX + cylW / 2, anchorY + 6); ctx.stroke();
      var pistonY = clamp(massTop - 36, anchorY + 10, anchorY + 2 + cylH);
      ctx.strokeStyle = muted; ctx.beginPath(); ctx.moveTo(damperX, pistonY); ctx.lineTo(damperX, massTop);
      ctx.moveTo(damperX - cylW / 2 + 2, pistonY); ctx.lineTo(damperX + cylW / 2 - 2, pistonY); ctx.stroke();
      ctx.fillStyle = lab.hitFlash ? col.bad : massColor;
      ctx.beginPath(); (ctx.roundRect ? ctx.roundRect(cx - massW / 2, massTop, massW, massH, 6) : ctx.rect(cx - massW / 2, massTop, massW, massH)); ctx.fill();
      // Reference path on top of the mass, so the dot and the tail stay visible when they overlap it.
      if (!lab.shake) {
        ctx.save(); ctx.globalAlpha = 0.32; ctx.strokeStyle = accent; ctx.lineWidth = 1.2; ctx.setLineDash([8, 5]); ctx.beginPath();
        for (var fx = cx; fx <= W; fx += 3) { var fy = refPy(t + (fx - cx) / pxPerSec); if (fx === cx) ctx.moveTo(fx, fy); else ctx.lineTo(fx, fy); }
        ctx.stroke(); ctx.restore();
        ctx.save(); ctx.strokeStyle = accent; ctx.lineCap = 'round';
        for (var tx = cx; tx > 6; tx -= 3) {
          var ta = (cx - tx) / pxPerSec, tb = (cx - tx + 3) / pxPerSec; if (tb > t) break;
          var age = (cx - tx) / cx; if (age >= 1) break;
          ctx.globalAlpha = Math.max(0, 1 - age); ctx.lineWidth = 0.5 + 2.2 * (1 - age);
          ctx.beginPath(); ctx.moveTo(tx, refPy(t - ta)); ctx.lineTo(tx - 3, refPy(t - tb)); ctx.stroke();
        }
        ctx.restore();
        ctx.save(); ctx.globalAlpha = 0.35; ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(cx, refY, 9, 0, 7); ctx.fill(); ctx.restore();
      }
      // Centre of mass: the quartered black-and-white target.
      var cr = 8;
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, massY, cr, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = '#000'; ctx.beginPath(); ctx.moveTo(cx, massY); ctx.arc(cx, massY, cr, -Math.PI / 2, 0); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx, massY); ctx.arc(cx, massY, cr, Math.PI / 2, Math.PI); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(cx, massY, cr, 0, 2 * Math.PI); ctx.stroke();
      var F = sim.u[0] || 0;
      if (Math.abs(F) > 0.05) {
        var len = 46 * Math.tanh(Math.abs(F) / 4), dir = F > 0 ? 1 : -1, ax = cx + massW / 2 + 12, ay1 = massY + dir * len;
        ctx.strokeStyle = forceColor; ctx.fillStyle = forceColor; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(ax, massY); ctx.lineTo(ax, ay1 - dir * 5); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ax, ay1); ctx.lineTo(ax - 5, ay1 - dir * 7); ctx.lineTo(ax + 5, ay1 - dir * 7); ctx.closePath(); ctx.fill();
      }
      var w = who(lab, lab.shake ? 'Shaken by a sine-wave force' : lab.controller.label + ' tracking');
      statusLine(ctx, w === null ? 'Manual - drag the mass' : w === 'none' ? 'No control - raise Kp' : w, w === 'none' ? muted : accent, 't = ' + t.toFixed(1) + ' s', col);
      stateBox(ctx, W, H, [{ label: 'x', value: sim.x[0], decimals: 2, unit: 'm' }, { label: 'ẋ', value: sim.x[1], decimals: 2, unit: 'm/s' }]
        .concat(lab.replay ? [] : [{ label: lab.shake ? 'ω' : 'ref', value: lab.shake ? lab.w : refNow, decimals: 2, unit: lab.shake ? 'rad/s' : 'm' }])
        .concat([{ label: 'F', value: lab.replay ? F / 4 : F, decimals: 1, unit: 'N' }]));
    }
  };

  /* ---------------- Tilt table (Demo 1.5): ball on a beam ---------------- */
  // The PID commands a tilt; a servo slews the beam toward it at 60°/s (uRate), so the
  // beam can't jump. The ball rolls with full g·sin(tilt) and a little damping.
  var tilt = {
    id: 'tilt', name: 'Tilt table', n: 2, m: 1, dt: 0.01, substeps: 2,
    stateNames: ['x', 'ẋ'], inputNames: ['tilt'], units: ['m', 'm/s'], inputUnits: ['rad'],
    params: { g: 9.81, damp: 0.28, half: 1.0, lim: rad(20) },
    x0: function () { return [0, 0]; },
    u0: function () { return [0]; },
    start: function (p, rng) { return [(rng() - 0.5) * p.half, (rng() - 0.5) * 0.2]; },
    deriv: function (x, u, p) { return [x[1], p.g * Math.sin(u[0]) - p.damp * x[1]]; },
    ulim: function (p) { return [[-p.lim, p.lim]]; },
    uRate: [rad(60)],
    status: function (x, p) { return Math.abs(x[0]) >= p.half ? 'fell' : 'ok'; },
    noise: [1, 0],
    controllers: {
      pid: { label: 'PID', channels: [{ type: 'pid', input: 0, out: 0, sign: 1, intClamp: 2, gains: { kp: 3, ki: 0, kd: 2 },
             ranges: { kp: [-10, 10], ki: [-5, 5], kd: [-5, 5] } }] }
    },
    refs: [{ type: 'wave', amp: 0.5, omega: 2 * Math.PI / 12, label: 'x', unit: 'm', idx: 0 }],
    states: [{ label: 'x (m)', f: function (x) { return x[0]; } }, { label: 'ẋ (m/s)', f: function (x) { return x[1]; } },
             { label: 'θ (°)', f: function (x, u) { return deg(u[0]); } }],
    contribUnit: 'tilt cmd (°)', contribScale: 180 / Math.PI,
    // Manual: the beam swings toward the line from its centre to the pointer, and holds.
    manual: function (drag, sim, lab) {
      if (!drag || !lab.view) return [sim.u[0]];
      var dx = drag.x - lab.view.cx, dy = drag.y - lab.view.cy;
      if (Math.abs(dx) < lab.view.W * 0.05) return [sim.u[0]];
      return [clamp(Math.atan(dy / dx), -lab.p.lim, lab.p.lim)];
    },
    draw: function (ctx, W, H, sim, lab, col) {
      var dark = isDark(), p = lab.p, T = p.half, bx = sim.x[0], tiltX = sim.u[0];
      ctx.fillStyle = dark ? '#0a1020' : '#f2f4f8'; ctx.fillRect(0, 0, W, H);
      var cx = W / 2, cy = H * 0.52, scale = W * 0.72 / (2 * T), beamHalfPx = T * scale, beamThick = 12, ballR = Math.max(8, Math.min(13, W * 0.017));
      lab.view = { cx: cx, cy: cy, W: W };
      ctx.save(); ctx.translate(cx, cy + beamThick / 2 + 1); ctx.fillStyle = dark ? '#4a7a9a' : '#3a6a9a'; var fh = 18;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-fh * 0.65, fh); ctx.lineTo(fh * 0.65, fh); ctx.closePath(); ctx.fill();
      ctx.fillStyle = dark ? '#2a3a4a' : '#b8c8d8'; ctx.fillRect(-fh * 0.9, fh, fh * 1.8, 4); ctx.restore();
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(tiltX);
      ctx.fillStyle = dark ? '#162030' : '#c8d8e8'; ctx.strokeStyle = dark ? '#4a8aaa' : '#3a6a9a'; ctx.lineWidth = 1.5;
      ctx.beginPath(); (ctx.roundRect ? ctx.roundRect(-beamHalfPx, -beamThick / 2, beamHalfPx * 2, beamThick, 3) : ctx.rect(-beamHalfPx, -beamThick / 2, beamHalfPx * 2, beamThick)); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 2.5;
      [-beamHalfPx, beamHalfPx].forEach(function (ex) { ctx.strokeStyle = dark ? 'rgba(255,90,90,0.55)' : 'rgba(200,50,50,0.60)'; ctx.beginPath(); ctx.moveTo(ex, -beamThick / 2 - 7); ctx.lineTo(ex, beamThick / 2 + 7); ctx.stroke(); });
      var refNow = LabCore.refValue(lab.refs[0], sim.t), refPx = refNow * scale, refCy = -beamThick / 2 - ballR;
      ctx.save(); ctx.strokeStyle = col.accent; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]); ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.arc(refPx, refCy, ballR + 3, 0, 2 * Math.PI); ctx.stroke(); ctx.restore();
      var bxPx = bx * scale, ballCy = -beamThick / 2 - ballR;
      ctx.beginPath(); ctx.ellipse(bxPx, -beamThick / 2, ballR * 0.85, 3.5, 0, 0, 2 * Math.PI); ctx.fillStyle = 'rgba(0,0,0,0.20)'; ctx.fill();
      var grd = ctx.createRadialGradient(bxPx - ballR * 0.3, ballCy - ballR * 0.3, ballR * 0.06, bxPx, ballCy, ballR);
      grd.addColorStop(0, dark ? '#b8dcff' : '#94c8ff'); grd.addColorStop(1, dark ? '#1838a8' : '#0e2e8a');
      ctx.fillStyle = grd; ctx.strokeStyle = dark ? 'rgba(120,180,255,0.45)' : 'rgba(20,60,160,0.40)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(bxPx, ballCy, ballR, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
      ctx.restore();
      var w = who(lab, 'PID tracking');
      statusLine(ctx, sim.failed ? 'The ball rolled off - new trial…' : w === null ? 'Manual - drag a beam end' : w === 'none' ? 'No control - raise Kp' : w,
        sim.failed ? col.viz2 : w === 'none' ? col.muted : col.accent, 't = ' + sim.t.toFixed(1) + ' s   falls = ' + (lab.trials || 0), col);
      stateBox(ctx, W, H, [{ label: 'x', value: bx, decimals: 2, unit: 'm' }, { label: 'ẋ', value: sim.x[1], decimals: 2, unit: 'm/s' },
        { label: 'ref', value: refNow, decimals: 2, unit: 'm' }, { label: 'θ', value: deg(tiltX), decimals: 1, unit: '°' }]);
    }
  };

  /* ---------------- Cart-pole (Demo 3) ---------------- */
  var cartpole = {
    id: 'cartpole', name: 'Cart-pole', n: 4, m: 1, dt: 0.025, substeps: 5,
    stateNames: ['x', 'ẋ', 'θ', 'θ̇'], inputNames: ['F'], units: ['m', 'm/s', 'rad', 'rad/s'], inputUnits: ['N'],
    params: { Mc: 0.3, m: 0.3, l: 1.5, b: 0.8, g: 9.81, Fmax: 10, xlim: 4, fall: rad(45) },
    x0: function () { return [0, 0, 0, 0]; },
    u0: function () { return [0]; },
    start: function (p, rng) { return [0, 0, rad(3) * (rng() < 0.5 ? -1 : 1) * (0.5 + rng()), 0]; },
    deriv: function (x, u, p) {
      var th = x[2], w = x[3], s = Math.sin(th), c = Math.cos(th), tot = p.Mc + p.m, pml = p.m * p.l;
      var temp = (u[0] - p.b * x[1] + pml * w * w * s) / tot;
      var thdd = (p.g * s - c * temp) / (p.l * (4 / 3 - p.m * c * c / tot));
      return [x[1], temp - pml * thdd * c / tot, w, thdd];
    },
    ulim: function (p) { return [[-p.Fmax, p.Fmax]]; },
    status: function (x, p) { return Math.abs(x[2]) > p.fall ? 'fell' : Math.abs(x[0]) > p.xlim ? 'crashed' : 'ok'; },
    // Sensor noise σ is in degrees on the angle; the others scale with it (rates as if
    // differenced over 0.2 s), as on /controls/.
    noise: [0.01, 0.05, Math.PI / 180, Math.PI / 180 / 0.2],
    controllers: {
      lqr: { label: 'LQR', channels: [{ type: 'sf', input: 0, rows: [0, 1, 2, 3], names: ['kx', 'kv', 'kth', 'kw'],
             gains: { kx: 3.1, kv: 5.9, kth: 43.5, kw: 18.1 },
             ranges: { kx: [-20, 20], kv: [-20, 20], kth: [-100, 100], kw: [-40, 40] } }] },
      // LQR on an estimate: only the cart position and pole angle are measured; the rates come
      // from differencing them or from a Kalman filter (State Estimation page).
      lqg: { label: 'LQR', channels: [{ type: 'obs', input: 0, rows: [0, 1, 2, 3], names: ['kx', 'kv', 'kth', 'kw'], meas: [0, 2], rates: [[0, 1], [2, 3]],
             gains: { kx: 3.1, kv: 5.9, kth: 43.5, kw: 18.1 },
             ranges: { kx: [-20, 20], kv: [-20, 20], kth: [-100, 100], kw: [-40, 40] } }] }
    },
    est: { rate: 1, unit: '°/s', lanes: [{ label: 'Pole angle θ (°): measured vs true', idx: 2, scale: 180 / Math.PI, measured: true },
      { label: 'Pole rate θ̇ (°/s): estimate vs true', idx: 3, scale: 180 / Math.PI }, { label: 'Cart velocity ẋ (m/s): estimate vs true', idx: 1, scale: 1 }] },
    refs: [{ type: 'wave', amp: 1, omega: 2 * Math.PI / 12, label: 'x', unit: 'm', idx: 0 }],
    states: [{ label: 'x (m)', f: function (x) { return x[0]; } }, { label: 'ẋ (m/s)', f: function (x) { return x[1]; } },
             { label: 'θ (°)', f: function (x) { return deg(x[2]); } }, { label: 'θ̇ (°/s)', f: function (x) { return deg(x[3]); } }],
    contribUnit: 'F (N)', contribScale: 1,
    manual: function (drag, sim, lab) {
      if (!drag || !lab.view) return [0];
      var xt = clamp((drag.x - lab.view.cx) / lab.view.scale, -lab.p.xlim, lab.p.xlim);
      return [clamp(30 * (xt - sim.x[0]) - 8 * sim.x[1], -lab.p.Fmax, lab.p.Fmax)];
    },
    draw: function (ctx, W, H, sim, lab, col) {
      var p = lab.p, X_LIM = p.xlim, L_POLE = p.l, state = sim.x, uForce = sim.u[0];
      var bg = col.bgSoft, border = col.border, strong = col.borderStrong, text = col.text, muted = col.muted, accent = col.accent;
      var col1 = col.viz1, colF = col.viz4;
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      var trackY = Math.round(H * 0.72), cartW = 52, cartH = 24;
      var scale = Math.min((W - 40 - cartW) / (2 * X_LIM), (trackY - 56) / (2 * L_POLE + 0.2)), cx = W / 2;
      lab.view = { cx: cx, scale: scale };
      function sx(xm) { return cx + xm * scale; }
      var railL = sx(-X_LIM) - cartW / 2, railR = sx(X_LIM) + cartW / 2;
      ctx.strokeStyle = strong; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(railL, trackY); ctx.lineTo(railR, trackY); ctx.stroke(); ctx.lineCap = 'butt';
      ctx.fillStyle = muted; [railL, railR].forEach(function (xp) { ctx.fillRect(xp - 3, trackY - 14, 6, 28); });
      ctx.font = '10px ' + col.mono; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.lineWidth = 1;
      var labelEvery = scale < 45 ? 2 : 1;
      for (var m = -X_LIM; m <= X_LIM + 1e-9; m += 0.5) {
        var tx = sx(m), whole = Math.abs(m - Math.round(m)) < 1e-6;
        ctx.strokeStyle = whole ? muted : border; ctx.beginPath(); ctx.moveTo(tx, trackY + 8); ctx.lineTo(tx, trackY + (whole ? 16 : 13)); ctx.stroke();
        if (whole && Math.round(m) % labelEvery === 0) { ctx.fillStyle = muted; ctx.fillText(Math.round(m) + ' m', tx, trackY + 30); }
      }
      var cartX = sx(state[0]), poleLenPx = L_POLE * 2 * scale, bobR = Math.max(6, 0.028 * scale * Math.sqrt(p.m / 0.15));
      if (lab.manual && lab.drag) {
        ctx.strokeStyle = accent; ctx.globalAlpha = 0.5; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
        var dragPx = sx(clamp((lab.drag.x - cx) / scale, -X_LIM, X_LIM));
        ctx.beginPath(); ctx.moveTo(dragPx, trackY - 30); ctx.lineTo(dragPx, trackY + 30); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cartX, trackY); ctx.lineTo(dragPx, trackY); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      }
      var refNowC = LabCore.refValue(lab.refs[0], sim.t);
      ctx.save(); ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]); ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.moveTo(sx(refNowC), trackY - 38); ctx.lineTo(sx(refNowC), trackY + 22); ctx.stroke(); ctx.restore();
      ctx.globalAlpha = 0.45; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = accent;
      ctx.beginPath(); ctx.moveTo(cartX, trackY); ctx.lineTo(cartX, trackY - poleLenPx); ctx.stroke();
      ctx.setLineDash([]); ctx.strokeStyle = col1; ctx.beginPath(); ctx.arc(cartX, trackY - poleLenPx, bobR + 2, 0, 2 * Math.PI); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillStyle = accent; ctx.beginPath(); (ctx.roundRect ? ctx.roundRect(cartX - cartW / 2, trackY - cartH / 2, cartW, cartH, 5) : ctx.rect(cartX - cartW / 2, trackY - cartH / 2, cartW, cartH)); ctx.fill();
      var tipX = cartX + poleLenPx * Math.sin(state[2]), tipY = trackY - poleLenPx * Math.cos(state[2]);
      ctx.strokeStyle = text; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(cartX, trackY); ctx.lineTo(tipX, tipY); ctx.stroke(); ctx.lineCap = 'butt';
      ctx.fillStyle = col1; ctx.beginPath(); ctx.arc(tipX, tipY, bobR, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(cartX, trackY, 3, 0, 2 * Math.PI); ctx.fill();
      if (Math.abs(uForce) > 0.2) {
        var fl = clamp(uForce / p.Fmax, -1.5, 1.5) * 60, ay = trackY + 48, fs = fl >= 0 ? 1 : -1;
        ctx.strokeStyle = colF; ctx.fillStyle = colF; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cartX, ay); ctx.lineTo(cartX + fl, ay); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cartX + fl + 3 * fs, ay); ctx.lineTo(cartX + fl - 6 * fs, ay - 5); ctx.lineTo(cartX + fl - 6 * fs, ay + 5); ctx.closePath(); ctx.fill();
      }
      var w = who(lab, lab.useNet ? 'Neural network balancing' : 'LQR balancing'), label, colr = muted;
      if (sim.status === 'fell') { label = 'Pole fell - new trial…'; colr = col.viz2; }
      else if (sim.status === 'crashed') { label = 'Hit the end of the rail - new trial…'; colr = col.viz2; }
      else if (w === null) { label = 'Manual - drag the cart'; colr = accent; }
      else if (w === 'none') label = 'No control - set the gains or load LQR';
      else { label = w; colr = accent; }
      statusLine(ctx, label, colr, 't = ' + sim.t.toFixed(1) + ' s   F = ' + uForce.toFixed(1) + ' N', col);
      stateBox(ctx, W, H, [{ label: 'x', value: state[0], decimals: 2, unit: 'm' }, { label: 'ẋ', value: state[1], decimals: 2, unit: 'm/s' },
        { label: 'ref', value: refNowC, decimals: 2, unit: 'm' }, { label: 'θ', value: deg(state[2]), decimals: 1, unit: '°' }]);
    }
  };

  /* ---------------- Flight (Demo 2): longitudinal aircraft, two inputs ---------------- */
  var AC = { m: 1000, Iyy: 1800, S: 16, cbar: 1.5, rho: 1.225, g: 9.81, CL0: 0.40, CLa: 4.80, CLde: 0.36,
             CD0: 0.027, k: 0.045, Cm0: 0.04, Cma: -0.70, Cmq: -3.0, Cmde: -1.2 };
  function aero(V, alpha, q, de) {
    var qbar = 0.5 * AC.rho * V * V, aS = rad(16);
    var sig = 1 / (1 + Math.exp(30 * (Math.abs(alpha) - aS) / Math.PI));
    var CLlin = AC.CL0 + AC.CLa * alpha + AC.CLde * de, CLpk = AC.CL0 + AC.CLa * aS;
    var CL = sig * CLlin + (1 - sig) * (0.55 * CLpk * (alpha < 0 ? -1 : 1) + AC.CLde * de);
    var CD = AC.CD0 + AC.k * CL * CL + 0.15 * (1 - sig);
    var Cm = AC.Cm0 + AC.Cma * alpha + AC.Cmq * q * AC.cbar / (2 * Math.max(V, 1)) + AC.Cmde * de;
    return { L: qbar * AC.S * CL, D: qbar * AC.S * CD, My: qbar * AC.S * AC.cbar * Cm };
  }
  // Trim at 65 m/s level flight. controls.js uses a closed form that treats the stall blend
  // as exactly 1 (it is ≈ 0.92 at trim) and ignores T·sin α, so its "trim" slowly sinks and
  // slows. Here Newton's method starts from that closed form and solves V̇ = γ̇ = q̇ = 0 for
  // (α, δe, T), so analyses linearise about a true equilibrium.
  var TRIM = (function () {
    var V = 65, qbar = 0.5 * AC.rho * V * V, CLreq = AC.m * AC.g / (qbar * AC.S);
    var a = (CLreq - AC.CL0 + AC.CLde * AC.Cm0 / AC.Cmde) / (AC.CLa - AC.CLde * AC.Cma / AC.Cmde);
    var de = -(AC.Cm0 + AC.Cma * a) / AC.Cmde, CL = AC.CL0 + AC.CLa * a + AC.CLde * de;
    var z = [a, de, qbar * AC.S * (AC.CD0 + AC.k * CL * CL) / Math.cos(a)];
    function res(v) {
      var f = aero(V, v[0], 0, v[1]);
      return [(v[2] * Math.cos(v[0]) - f.D) / AC.m, (v[2] * Math.sin(v[0]) + f.L - AC.m * AC.g) / (AC.m * V), f.My / AC.Iyy];
    }
    for (var it = 0; it < 30; it++) {
      var r = res(z), J = [[], [], []], h = [1e-7, 1e-7, 1e-3];
      for (var j = 0; j < 3; j++) { var zp = z.slice(); zp[j] += h[j]; var rp = res(zp); for (var i = 0; i < 3; i++) J[i][j] = (rp[i] - r[i]) / h[j]; }
      var M = J.map(function (row, i) { return row.concat([-r[i]]); });
      for (var c = 0; c < 3; c++) {
        var p = c; for (var q = c + 1; q < 3; q++) if (Math.abs(M[q][c]) > Math.abs(M[p][c])) p = q;
        var t = M[p]; M[p] = M[c]; M[c] = t;
        for (q = c + 1; q < 3; q++) { var fct = M[q][c] / M[c][c]; for (var k = c; k < 4; k++) M[q][k] -= fct * M[c][k]; }
      }
      var dz = [0, 0, 0];
      for (c = 2; c >= 0; c--) { var sm = M[c][3]; for (k = c + 1; k < 3; k++) sm -= M[c][k] * dz[k]; dz[c] = sm / M[c][c]; }
      z = z.map(function (v, i) { return v + dz[i]; });
      if (Math.max(Math.abs(r[0]), Math.abs(r[1]), Math.abs(r[2])) < 1e-12) break;
    }
    return { V: V, alpha: z[0], de: z[1], T: z[2] };
  })();
  // Altitudes as on /controls/: a 600 m world anchored at the ground, reference around 23 m.
  var flight = {
    id: 'flight', name: 'Aircraft', n: 6, m: 2, dt: 0.025, substeps: 4,
    stateNames: ['V', 'γ', 'α', 'q', 'h', 'x'], inputNames: ['δe', 'T'], units: ['m/s', 'rad', 'rad', 'rad/s', 'm', 'm'], inputUnits: ['rad', 'N'],
    params: { H0: 23 },
    x0: function (p) { return [TRIM.V, 0, TRIM.alpha, 0, p.H0, 0]; },
    u0: function () { return [TRIM.de, TRIM.T]; },
    start: function (p) { return [TRIM.V, 0, TRIM.alpha, 0, p.H0, 0]; },
    deriv: function (x, u, p) {
      var V = Math.max(x[0], 10), g = x[1], a = x[2], q = x[3], f = aero(V, a, q, u[0]), T = u[1];
      var Vd = (T * Math.cos(a) - f.D) / AC.m - AC.g * Math.sin(g);
      var gd = (T * Math.sin(a) + f.L - AC.m * AC.g * Math.cos(g)) / (AC.m * V);
      return [Vd, gd, q - gd, f.My / AC.Iyy, V * Math.sin(g), V * Math.cos(g)];
    },
    ulim: function () { return [[TRIM.de - rad(15), TRIM.de + rad(15)], [0, 2.5 * TRIM.T]]; },
    uRate: [rad(40), 0],                      // elevator slews at 40°/s, as on /controls/
    status: function (x) {
      return x[4] < 0 ? 'crashed' : Math.abs(x[2]) > rad(16) ? 'stalled' : x[4] > 590 ? 'too_high' : Math.abs(x[1] + x[2]) > Math.PI / 2 ? 'over_top' : 'ok';
    },
    noise: [0, 0, 0, 0, 1, 0],
    trim: TRIM,
    controllers: {
      // Altitude PID → elevator (gains in degrees of elevator per metre; nose-up elevator
      // is negative δe, hence the sign). Thrust held at trim, as on /controls/.
      alt: { label: 'PID', channels: [
        { type: 'pid', input: 0, out: 4, sign: -Math.PI / 180, gains: { kp: 0.5, ki: 0.1, kd: 0.35 }, label: 'Altitude → elevator',
          ranges: { kp: [-0.5, 0.5], ki: [-0.5, 0.5], kd: [-0.5, 0.5] } }] },
      // …plus an autothrottle PI on airspeed → thrust (Stability and Modern pages).
      both: { label: 'Altitude + autothrottle', channels: [
        { type: 'pid', input: 0, out: 4, sign: -Math.PI / 180, gains: { kp: 0.5, ki: 0.1, kd: 0.35 }, label: 'Altitude → elevator',
          ranges: { kp: [-2, 2], ki: [-0.5, 0.5], kd: [-2, 2] } },
        { type: 'pid', input: 1, out: 0, sign: 1, gains: { kp: 300, ki: 60 }, label: 'Airspeed → throttle',
          ranges: { kp: [0, 1500], ki: [0, 400] } }] }
    },
    refs: [{ type: 'wave', amp: 6, omega: 2 * Math.PI / 16, label: 'h', unit: 'm', idx: 4 },
           { type: 'hold', hold: 0, amp: 0, omega: 0, label: 'V', unit: 'm/s', idx: 0 }],
    states: [{ label: 'h (m)', f: function (x, u, p) { return x[4] - p.H0; } }, { label: 'V (m/s)', f: function (x) { return x[0] - TRIM.V; } },
             { label: 'θ (°)', f: function (x) { return deg(x[1] + x[2]); } }, { label: 'α (°)', f: function (x) { return deg(x[2]); } }],
    contribUnit: 'δe cmd (°)', contribScale: -180 / Math.PI,
    // Manual: drag up for nose-up elevator, down for nose-down; release = trim.
    manual: function (drag) {
      if (!drag) return [TRIM.de, null];
      return [TRIM.de - clamp((drag.y0 - drag.y) / 90, -1, 1) * rad(15), null];
    },
    draw: function (ctx, W, H, sim, lab) {
      if (root.LabFlightRender) root.LabFlightRender.render(ctx.canvas, sim.x, sim.t, sim.u[0], sim.status, lab.refs[0].type);
    }
  };

  var LabPlants = { msd: msd, tilt: tilt, cartpole: cartpole, flight: flight, AC: AC, aero: aero };
  if (typeof module !== 'undefined' && module.exports) module.exports = LabPlants;
  root.LabPlants = LabPlants;
  var LabCore = root.LabCore || (typeof require !== 'undefined' ? require('./lab-core.js') : null);
})(typeof window !== 'undefined' ? window : this);
