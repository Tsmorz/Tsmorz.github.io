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

  /* ---------------- Mass-spring-damper (the Intro demo) ---------------- */
  var msd = {
    id: 'msd', name: 'Mass-spring-damper', n: 2, m: 1, dt: 0.01, substeps: 2,
    stateNames: ['x', 'ẋ'], inputNames: ['F'], units: ['m', 'm/s'], inputUnits: ['N'],
    params: { M: 1, k: 4, c: 0.4, Fmax: 1e9 },        // underdamped, ζ ≈ 0.1 (controls.js)
    x0: function () { return [0, 0]; },
    u0: function () { return [0]; },
    start: function () { return [0, 0]; },
    deriv: function (x, u, p) { return [x[1], (u[0] - p.c * x[1] - p.k * x[0]) / p.M]; },
    ulim: function (p) { return [[-p.Fmax, p.Fmax]]; },
    noise: [1, 0],
    controllers: {
      pid: { label: 'PID', channels: [{ type: 'pid', input: 0, out: 0, sign: 1, gains: { kp: 40, ki: 5, kd: 6 },
             ranges: { kp: [-50, 50], ki: [-20, 20], kd: [-10, 10] } }] },
      open: { label: 'none', channels: [], open: { input: 0, out: 0 } }
    },
    refs: [{ type: 'wave', amp: 1, omega: 0.5, label: 'x', unit: 'm', idx: 0 }],
    // Drag the plant's own poles (Intro): the pair −σ ± jω_d sets c and k.
    setPoles: function (p, re, im) { p.c = -2 * re * p.M; p.k = p.M * (re * re + im * im); },
    draw: function (ctx, W, H, sim, lab, col) {
      var cx = W * 0.5, top = 18, k = Math.min((H - 70) / 4.6, 70), rest = H / 2 + 10;
      var y = rest - sim.x[0] * k, refY = rest - LabCore.refValue(lab.refs[0], sim.t) * k;
      ctx.strokeStyle = col.muted; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(cx - 60, top); ctx.lineTo(cx + 60, top); ctx.stroke();
      // hard stops (only where a safety filter is in play)
      if (lab.stops) {
        [1, -1].forEach(function (s) {
          var sy = rest - s * lab.stops * k + (s > 0 ? -26 : 26);
          ctx.fillStyle = withAlpha(col.bad, 0.25); ctx.fillRect(cx - 70, s > 0 ? sy - 8 : sy, 140, 8);
          ctx.fillStyle = col.bad; ctx.fillRect(cx - 70, s > 0 ? sy : sy, 140, 2.5);
        });
      }
      ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, top);
      var coils = 10, bot = y - 26;
      for (var i = 1; i <= coils * 2; i++) ctx.lineTo(cx + (i % 2 ? 14 : -14), top + (bot - top) * i / (coils * 2 + 1));
      ctx.lineTo(cx, bot); ctx.stroke();
      ctx.fillStyle = withAlpha(lab.hitFlash ? col.bad : col.viz2, 0.2); ctx.strokeStyle = lab.hitFlash ? col.bad : col.viz2; ctx.lineWidth = 2;
      ctx.beginPath(); (ctx.roundRect ? ctx.roundRect(cx - 34, y - 26, 68, 52, 7) : ctx.rect(cx - 34, y - 26, 68, 52)); ctx.fill(); ctx.stroke();
      refMarker(ctx, cx - 90, refY, cx + 90, refY, col);
      ctx.save(); ctx.strokeStyle = withAlpha(col.muted, 0.5); ctx.setLineDash([2, 4]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx - 110, rest); ctx.lineTo(cx + 110, rest); ctx.stroke(); ctx.restore();
      // force arrow
      var F = sim.u[0], len = clamp(F / 20, -1, 1) * 60;
      if (Math.abs(len) > 3) {
        ctx.strokeStyle = col.viz1; ctx.fillStyle = col.viz1; ctx.lineWidth = 3;
        var ax = cx + 70; ctx.beginPath(); ctx.moveTo(ax, y); ctx.lineTo(ax, y - len); ctx.stroke();
        var d = len > 0 ? -1 : 1; ctx.beginPath(); ctx.moveTo(ax, y - len + d * 2); ctx.lineTo(ax - 6, y - len - d * 8); ctx.lineTo(ax + 6, y - len - d * 8); ctx.fill();
      }
    }
  };

  /* ---------------- Cart-pole (Demo 4) ---------------- */
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
    failed: function (x, p) { return Math.abs(x[2]) > p.fall || Math.abs(x[0]) > p.xlim; },
    noise: [1, 5, 1, 5],
    controllers: {
      lqr: { label: 'LQR', channels: [{ type: 'sf', input: 0, rows: [0, 1, 2, 3], names: ['kx', 'kv', 'kth', 'kw'],
             gains: { kx: 3.1, kv: 5.9, kth: 43.5, kw: 18.1 },
             ranges: { kx: [-20, 20], kv: [-20, 20], kth: [-100, 100], kw: [-40, 40] } }] }
    },
    refs: [{ type: 'wave', amp: 1, omega: 2 * Math.PI / 12, label: 'x', unit: 'm', idx: 0 }],
    draw: function (ctx, W, H, sim, lab, col) {
      var p = lab.p, track = H - 46, scale = Math.min((W - 60) / (2 * p.xlim + 0.6), (track - 30) / (2 * p.l + 0.3));
      var sx = function (x) { return W / 2 + x * scale; };
      ctx.strokeStyle = col.muted; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(sx(-p.xlim) - 20, track); ctx.lineTo(sx(p.xlim) + 20, track); ctx.stroke();
      ctx.fillStyle = col.bad; ctx.fillRect(sx(-p.xlim) - 24, track - 18, 5, 22); ctx.fillRect(sx(p.xlim) + 19, track - 18, 5, 22);
      ctx.fillStyle = col.muted; ctx.font = '10px ' + col.mono; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (var m = -p.xlim; m <= p.xlim; m++) { ctx.fillRect(sx(m) - 0.5, track + 3, 1, 5); ctx.fillText(String(m), sx(m), track + 10); }
      var r = LabCore.refValue(lab.refs[0], sim.t);
      refMarker(ctx, sx(r), track - 24, sx(r), track + 4, col);
      var cx = sx(sim.x[0]), cw = 46, ch = 22, th = sim.x[2], L = 2 * p.l * scale;
      ctx.fillStyle = withAlpha(col.viz2, 0.25); ctx.strokeStyle = col.viz2; ctx.lineWidth = 2;
      ctx.fillRect(cx - cw / 2, track - ch - 4, cw, ch); ctx.strokeRect(cx - cw / 2, track - ch - 4, cw, ch);
      var px = cx, py = track - ch - 4, tx = px + L * Math.sin(th), ty = py - L * Math.cos(th);
      ctx.strokeStyle = sim.failed ? col.bad : col.text; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(tx, ty); ctx.stroke(); ctx.lineCap = 'butt';
      ctx.fillStyle = col.text; ctx.beginPath(); ctx.arc(px, py, 4, 0, 7); ctx.fill();
      var F = sim.u[0], fl = clamp(F / p.Fmax, -1, 1) * 50;
      if (Math.abs(fl) > 2) {
        var ay = track - ch / 2 - 4, ax = fl > 0 ? cx - cw / 2 - 4 : cx + cw / 2 + 4;
        ctx.strokeStyle = col.viz1; ctx.fillStyle = col.viz1; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(ax - fl, ay); ctx.lineTo(ax, ay); ctx.stroke();
        var d = fl > 0 ? 1 : -1; ctx.beginPath(); ctx.moveTo(ax + d * 2, ay); ctx.lineTo(ax - d * 8, ay - 5); ctx.lineTo(ax - d * 8, ay + 5); ctx.fill();
      }
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
  var flight = {
    id: 'flight', name: 'Aircraft (altitude + airspeed)', n: 5, m: 2, dt: 0.025, substeps: 4,
    stateNames: ['V', 'γ', 'α', 'q', 'h'], inputNames: ['δe', 'T'], units: ['m/s', 'rad', 'rad', 'rad/s', 'm'], inputUnits: ['rad', 'N'],
    params: { H0: 200 },
    x0: function (p) { return [TRIM.V, 0, TRIM.alpha, 0, p.H0]; },
    u0: function () { return [TRIM.de, TRIM.T]; },
    start: function (p) { return [TRIM.V, 0, TRIM.alpha, 0, p.H0]; },
    deriv: function (x, u, p) {
      var V = Math.max(x[0], 10), g = x[1], a = x[2], q = x[3], f = aero(V, a, q, u[0]), T = u[1];
      var Vd = (T * Math.cos(a) - f.D) / AC.m - AC.g * Math.sin(g);
      var gd = (T * Math.sin(a) + f.L - AC.m * AC.g * Math.cos(g)) / (AC.m * V);
      return [Vd, gd, q - gd, f.My / AC.Iyy, V * Math.sin(g)];
    },
    ulim: function () { return [[TRIM.de - rad(15), TRIM.de + rad(15)], [0, 2.5 * TRIM.T]]; },
    failed: function (x) { return Math.abs(x[2]) > rad(16); },
    noise: [0, 0, 0, 0, 1],
    trim: TRIM,
    controllers: {
      // Altitude PID → elevator, as on /controls/ (gains in degrees of elevator per metre;
      // nose-up elevator is negative δe, hence the sign); autothrottle PI → thrust.
      both: { label: 'Altitude + autothrottle', channels: [
        { type: 'pid', input: 0, out: 4, sign: -Math.PI / 180, gains: { kp: 0.5, ki: 0.1, kd: 0.35 }, label: 'Altitude → elevator',
          ranges: { kp: [-2, 2], ki: [-0.5, 0.5], kd: [-2, 2] } },
        { type: 'pid', input: 1, out: 0, sign: 1, gains: { kp: 300, ki: 60 }, label: 'Airspeed → throttle',
          ranges: { kp: [0, 1500], ki: [0, 400] } }] }
    },
    refs: [{ type: 'wave', amp: 6, omega: 2 * Math.PI / 16, label: 'h', unit: 'm', idx: 4 },
           { type: 'hold', hold: 0, amp: 0, omega: 0, label: 'V', unit: 'm/s', idx: 0 }],
    draw: function (ctx, W, H, sim, lab, col) {
      var x = sim.x, h = x[4] - lab.p.H0, r = LabCore.refValue(lab.refs[0], sim.t), k = (H - 40) / 30;
      var midY = H / 2, ground = midY + (h + 15) * k;
      // horizon band and scrolling ground ticks
      ctx.fillStyle = withAlpha(col.viz1, 0.06); ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = col.border; ctx.lineWidth = 1;
      var off = (sim.t * x[0] * 4) % 60;
      for (var gx = -off; gx < W; gx += 60) { ctx.beginPath(); ctx.moveTo(gx, H - 8); ctx.lineTo(gx + 20, H - 8); ctx.stroke(); }
      // altitude ladder (relative to the centre altitude)
      for (var a = -15; a <= 15; a += 5) {
        var yy = midY - (a - h) * k;
        if (yy < 6 || yy > H - 14) continue;
        ctx.fillStyle = col.muted; ctx.font = '10px ' + col.mono; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillText((a > 0 ? '+' : '') + a + ' m', W - 8, yy);
        ctx.strokeStyle = col.border; ctx.beginPath(); ctx.moveTo(W - 60, yy); ctx.lineTo(W - 46, yy); ctx.stroke();
      }
      var ry = midY - (r - h) * k;
      refMarker(ctx, 40, ry, W - 70, ry, col);
      // aircraft at the centre, pitched by θ = γ + α
      var th = x[1] + x[2];
      ctx.save(); ctx.translate(W * 0.42, midY); ctx.rotate(-th);
      ctx.fillStyle = sim.failed ? col.bad : col.text;
      ctx.beginPath(); ctx.moveTo(42, 0); ctx.quadraticCurveTo(30, -7, 0, -6); ctx.lineTo(-34, -5); ctx.lineTo(-42, -18); ctx.lineTo(-48, -18);
      ctx.lineTo(-44, 2); ctx.lineTo(0, 6); ctx.quadraticCurveTo(30, 6, 42, 0); ctx.fill();
      ctx.fillStyle = col.viz2; ctx.fillRect(-6, -2, 26, 4);
      // elevator deflection
      ctx.save(); ctx.translate(-44, 0); ctx.rotate(-(sim.u[0] - TRIM.de) * 3);
      ctx.fillStyle = col.viz1; ctx.fillRect(-12, -1.5, 12, 3); ctx.restore();
      ctx.restore();
      ctx.fillStyle = col.muted; ctx.font = '11px ' + col.mono; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText('V ' + x[0].toFixed(1) + ' m/s   thrust ' + Math.round(100 * sim.u[1] / TRIM.T) + '% of trim', 10, 8);
      if (sim.failed) { ctx.fillStyle = col.bad; ctx.fillText('Stalled', 10, 24); }
    }
  };

  var LabPlants = { msd: msd, cartpole: cartpole, flight: flight, AC: AC, aero: aero };
  if (typeof module !== 'undefined' && module.exports) module.exports = LabPlants;
  root.LabPlants = LabPlants;
  var LabCore = root.LabCore || (typeof require !== 'undefined' ? require('./lab-core.js') : null);
})(typeof window !== 'undefined' ? window : this);
