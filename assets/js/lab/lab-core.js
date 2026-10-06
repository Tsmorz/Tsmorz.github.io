// LabCore — the maths shared by every template page (/controls/stability/, /modern/,
// /sysid/, /design/). No DOM, so script/test-lab runs it in Node. Everything is
// generic over a plant from lab-plants.js and a controller spec:
//   • linearise the plant, build the closed loop as one state-space model
//   • loop transfer functions, margins, Nyquist count, closed-loop poles, root locus,
//     pole placement (drag a pole → gains)
//   • a control-barrier-function filter on any position-like state
//   • interval bounds on a small policy network
//   • least-squares (ARX) system identification
//   • a nonlinear simulator with delay, noise and actuator limits
(function (root) {
  'use strict';

  /* ---------------- complex numbers [re, im] ---------------- */
  function cadd(a, b) { return [a[0] + b[0], a[1] + b[1]]; }
  function csub(a, b) { return [a[0] - b[0], a[1] - b[1]]; }
  function cmul(a, b) { return [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]]; }
  function cdiv(a, b) { var d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; }
  function cabs(a) { return Math.hypot(a[0], a[1]); }
  function carg(a) { return Math.atan2(a[1], a[0]); }
  function cexp(a) { var m = Math.exp(a[0]); return [m * Math.cos(a[1]), m * Math.sin(a[1])]; }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function wrap180(d) { d = ((d + 180) % 360 + 360) % 360 - 180; return d === -180 ? 180 : d; }
  function logspace(a, b, n) {
    var out = [], la = Math.log10(a), lb = Math.log10(b);
    for (var i = 0; i < n; i++) out.push(Math.pow(10, la + (lb - la) * i / (n - 1)));
    return out;
  }

  /* ---------------- small real matrices ---------------- */
  function zeros(r, c) { var m = []; for (var i = 0; i < r; i++) { m.push([]); for (var j = 0; j < c; j++) m[i].push(0); } return m; }
  function copyM(A) { return A.map(function (r) { return r.slice(); }); }
  function matVec(A, x) { return A.map(function (r) { var s = 0; for (var j = 0; j < r.length; j++) s += r[j] * x[j]; return s; }); }
  function rowTimes(row, A) {           // row · A
    var out = []; for (var j = 0; j < A[0].length; j++) { var s = 0; for (var i = 0; i < row.length; i++) s += row[i] * A[i][j]; out.push(s); } return out;
  }

  // Characteristic polynomial det(sI − A), monic, highest power first (Faddeev–LeVerrier).
  function charPoly(A) {
    var n = A.length, c = [1], M = zeros(n, n), i, j, k, q;
    for (k = 1; k <= n; k++) {
      var AM = zeros(n, n);
      for (i = 0; i < n; i++) for (j = 0; j < n; j++) { var s = 0; for (q = 0; q < n; q++) s += A[i][q] * M[q][j]; AM[i][j] = s; }
      for (i = 0; i < n; i++) for (j = 0; j < n; j++) M[i][j] = AM[i][j] + (i === j ? c[k - 1] : 0);
      var tr = 0;
      for (i = 0; i < n; i++) { var t = 0; for (q = 0; q < n; q++) t += A[i][q] * M[q][i]; tr += t; }
      c.push(-tr / k);
    }
    return c;
  }

  // Roots of a polynomial (any leading coefficient) by Durand–Kerner.
  function roots(p) {
    var i = 0; while (i < p.length - 1 && Math.abs(p[i]) < 1e-14 * (Math.abs(p[p.length - 1]) + 1)) i++;
    p = p.slice(i);
    var n = p.length - 1; if (n < 1) return [];
    var c = p.map(function (v) { return v / p[0]; }), z = [], R = 0, it;
    for (i = 1; i <= n; i++) R = Math.max(R, Math.pow(Math.abs(c[i]), 1 / i));
    R = 2 * R || 1;
    for (i = 0; i < n; i++) { var a = 2 * Math.PI * i / n + 0.4; z.push([R * Math.cos(a), R * Math.sin(a)]); }
    function ev(x) { var r = [1, 0]; for (var k = 1; k <= n; k++) r = cadd(cmul(r, x), [c[k], 0]); return r; }
    for (it = 0; it < 600; it++) {
      var moved = 0;
      for (i = 0; i < n; i++) {
        var den = [1, 0];
        for (var j = 0; j < n; j++) if (j !== i) den = cmul(den, csub(z[i], z[j]));
        var dz = cdiv(ev(z[i]), den);
        if (!isFinite(dz[0]) || !isFinite(dz[1])) continue;
        z[i] = csub(z[i], dz); moved = Math.max(moved, cabs(dz));
      }
      if (moved < 1e-12 * R) break;
    }
    return z;
  }
  function eig(A) { return roots(charPoly(A)); }
  function polyFromRoots(rs) {
    var p = [[1, 0]];
    rs.forEach(function (r) {
      var q = [p[0]];
      for (var i = 1; i < p.length; i++) q.push(csub(p[i], cmul(r, p[i - 1])));
      q.push(cmul([-r[0], -r[1]], p[p.length - 1]));
      p = q;
    });
    return p.map(function (v) { return v[0]; });
  }
  function polyStr(c) {
    var SUP = ['', '', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'], n = c.length - 1, out = '', big = 0;
    c.forEach(function (v) { big = Math.max(big, Math.abs(v)); });
    c.forEach(function (v, i) {
      var pw = n - i; if (Math.abs(v) <= 1e-9 * big) return;
      var a = Math.abs(v), mag = a >= 100 ? a.toFixed(0) : a >= 10 ? String(+a.toFixed(1)) : String(+a.toPrecision(3));
      if (Math.abs(+mag - 1) < 1e-9 && pw > 0) mag = '';
      var term = mag + (pw === 0 ? '' : pw === 1 ? 's' : 's' + SUP[pw]);
      out += out === '' ? (v < 0 ? '−' : '') + term : (v < 0 ? ' − ' : ' + ') + term;
    });
    return out || '0';
  }

  // Complex Gaussian elimination: solve M x = v.
  function csolve(M, v) {
    var n = v.length, a = M.map(function (r, i) { return r.concat([v[i]]); }), i, j, k;
    for (k = 0; k < n; k++) {
      var p = k; for (i = k + 1; i < n; i++) if (cabs(a[i][k]) > cabs(a[p][k])) p = i;
      var t = a[p]; a[p] = a[k]; a[k] = t;
      for (i = k + 1; i < n; i++) { var f = cdiv(a[i][k], a[k][k]); for (j = k; j <= n; j++) a[i][j] = csub(a[i][j], cmul(f, a[k][j])); }
    }
    var x = [];
    for (i = n - 1; i >= 0; i--) { var s = a[i][n]; for (j = i + 1; j < n; j++) s = csub(s, cmul(a[i][j], x[j])); x[i] = cdiv(s, a[i][i]); }
    return x;
  }

  /* ---------------- linearisation ---------------- */
  // Plant interface (lab-plants.js): n states, m inputs, deriv(x, u, p), x0, u0.
  function linearize(plant, p) {
    var n = plant.n, m = plant.m, x0 = plant.x0(p), u0 = plant.u0(p), f0 = plant.deriv(x0, u0, p), A = zeros(n, n), B = zeros(n, m), i, j;
    for (j = 0; j < n; j++) {
      var e = 1e-6 * Math.max(1, Math.abs(x0[j])), xp = x0.slice(); xp[j] += e;
      var fp = plant.deriv(xp, u0, p);
      for (i = 0; i < n; i++) A[i][j] = (fp[i] - f0[i]) / e;
    }
    for (j = 0; j < m; j++) {
      var eu = 1e-6 * Math.max(1, Math.abs(u0[j])), up = u0.slice(); up[j] += eu;
      var fu = plant.deriv(x0, up, p);
      for (i = 0; i < n; i++) B[i][j] = (fu[i] - f0[i]) / eu;
    }
    return { A: A, B: B };
  }

  /* ---------------- the closed loop as one linear model ----------------
     Controller channels (lab.controller.channels), each driving one plant input:
       { type: 'pid', input, out (state index), sign, gains: {kp, ki, kd} }
            u = sign·(kp·e + ki·∫e − kd·ẏ),  e = r − y   (D on the measurement)
       { type: 'sf', input, gains: {names…}, rows: [state index per gain] }
            u = Σ k_i·x_i   (the /controls/ cart-pole convention, F = k·state)
     In deviation variables every channel is u_j = Σ_g g·F_g·xa, linear in each gain:
     that's what makes the loop gain, the root locus and pole placement one-liners. */
  function loopModel(plant, p, ctrl) {
    var lin = linearize(plant, p), n = plant.n, nz = 0;
    ctrl.channels.forEach(function (ch) { if (ch.type === 'pid' && ch.gains.ki !== undefined) nz++; });
    var na = n + nz, Aa = zeros(na, na), Ba = zeros(na, plant.m), feats = [], zi = n, i, j;
    for (i = 0; i < n; i++) { for (j = 0; j < n; j++) Aa[i][j] = lin.A[i][j]; for (j = 0; j < plant.m; j++) Ba[i][j] = lin.B[i][j]; }
    var chans = ctrl.channels.map(function (ch, ci) {
      var gainsF = {};
      if (ch.type === 'pid') {
        var Cy = zeros(1, na)[0]; Cy[ch.out] = 1;
        var CyA = rowTimes(Cy.slice(0, n), lin.A).concat(zeros(1, na - n)[0]);
        var row = function (r) { return r.map(function (v) { return ch.sign * v; }); };
        gainsF.kp = row(Cy.map(function (v) { return -v; }));
        gainsF.kd = row(CyA.map(function (v) { return -v; }));
        if (ch.gains.ki !== undefined) {
          Aa[zi][ch.out] = -1;                    // ż = e = −y (deviation)
          var Iz = zeros(1, na)[0]; Iz[zi] = 1; gainsF.ki = row(Iz); zi++;
        }
      } else {
        ch.rows.forEach(function (si, gi) { var r = zeros(1, na)[0]; r[si] = 1; gainsF[ch.names[gi]] = r; });
      }
      Object.keys(gainsF).forEach(function (g) { if (ch.gains[g] !== undefined) feats.push({ ch: ci, input: ch.input, name: g, F: gainsF[g] }); });
      return { input: ch.input, gainsF: gainsF };
    });
    function K(gainsList, scale) {          // feedback row per channel
      return ctrl.channels.map(function (ch, ci) {
        var r = zeros(1, na)[0], s = scale === undefined ? 1 : scale[ci];
        Object.keys(chans[ci].gainsF).forEach(function (g) {
          var v = gainsList[ci][g]; if (v === undefined) return;
          chans[ci].gainsF[g].forEach(function (f, k) { r[k] += s * v * f; });
        });
        return r;
      });
    }
    return { na: na, n: n, A: Aa, B: Ba, lin: lin, chans: chans, feats: feats, K: K };
  }

  function closedA(model, Krows, skip) {      // Aa + Σ_j B_j K_j (channel `skip` left open)
    var A = copyM(model.A);
    Krows.forEach(function (row, ci) {
      if (ci === skip) return;
      var col = model.chans[ci].input;
      for (var i = 0; i < model.na; i++) for (var j = 0; j < model.na; j++) A[i][j] += model.B[i][col] * row[j];
    });
    return A;
  }

  // Delay as a 2nd-order Padé approximation on every input, so the closed loop has
  // finitely many poles to draw (stability itself comes from the Nyquist count).
  // e^(−sT) ≈ 1 − (12/T)s / (s² + (6/T)s + 12/T²): two extra states per channel.
  function closedAWithDelay(model, Krows, T) {
    if (!(T > 0)) return closedA(model, Krows);
    var na = model.na, nc = Krows.length, N = na + 2 * nc, A = zeros(N, N), i, j;
    for (i = 0; i < na; i++) for (j = 0; j < na; j++) A[i][j] = model.A[i][j];
    Krows.forEach(function (row, ci) {
      var col = model.chans[ci].input, w1 = na + 2 * ci, w2 = w1 + 1;
      for (i = 0; i < na; i++) {                // ẋ += B·(K x − (12/T) w2)
        for (j = 0; j < na; j++) A[i][j] += model.B[i][col] * row[j];
        A[i][w2] += -model.B[i][col] * 12 / T;
      }
      A[w1][w2] = 1;
      A[w2][w1] = -12 / (T * T); A[w2][w2] = -6 / T;
      for (j = 0; j < na; j++) A[w2][j] += row[j];
    });
    return A;
  }

  // Loop transfer of channel ci, cut at its input, with every other channel closed.
  function loopAt(model, Krows, ci, T, s) {
    var A = closedA(model, Krows, ci), na = model.na, col = model.chans[ci].input, M = [];
    for (var i = 0; i < na; i++) { M.push([]); for (var j = 0; j < na; j++) M[i].push([(i === j ? s[0] : 0) - A[i][j], i === j ? s[1] : 0]); }
    var x = csolve(M, model.B.map(function (r) { return [r[col], 0]; })), acc = [0, 0];
    for (var k = 0; k < na; k++) acc = cadd(acc, cmul([Krows[ci][k], 0], x[k]));
    var L = [-acc[0], -acc[1]];
    return T > 0 ? cmul(L, cexp([-s[0] * T, -s[1] * T])) : L;
  }

  function freqResponse(Lfn, w) {
    var mag = [], ph = [], prev = null;
    w.forEach(function (om) {
      var v = Lfn([0, om]); mag.push(20 * Math.log10(Math.max(cabs(v), 1e-12)));
      var a = carg(v) * 180 / Math.PI; if (prev !== null) a = prev + wrap180(a - prev);
      ph.push(a); prev = a;
    });
    var shift = 0; while (ph[0] + shift > 90) shift -= 360; while (ph[0] + shift <= -270) shift += 360;
    return { w: w, mag: mag, ph: ph.map(function (v) { return v + shift; }) };
  }

  // Worst phase margin, nearest gain margins up and down, delay margin.
  function margins(fr) {
    var w = fr.w, m = fr.mag, ph = fr.ph, out = { pm: null, wc: null, gmUp: null, wUp: null, gmDown: null, wDown: null, delayMargin: null, crossings: [] };
    function at(i, t, a) { return a[i] + (a[i + 1] - a[i]) * t; }
    function wAt(i, t) { return Math.pow(10, Math.log10(w[i]) + (Math.log10(w[i + 1]) - Math.log10(w[i])) * t); }
    for (var i = 0; i < w.length - 1; i++) {
      if ((m[i] > 0) !== (m[i + 1] > 0)) {
        var t = m[i] / (m[i] - m[i + 1]), pmv = wrap180(at(i, t, ph) + 180), wc = wAt(i, t);
        out.crossings.push({ w: wc, pm: pmv, ph: at(i, t, ph) });
        if (out.pm === null || pmv < out.pm) { out.pm = pmv; out.wc = wc; }
        if (pmv > 0) { var dm = pmv * Math.PI / 180 / wc; if (out.delayMargin === null || dm < out.delayMargin) out.delayMargin = dm; }
      }
      var lo = Math.min(ph[i], ph[i + 1]), hi = Math.max(ph[i], ph[i + 1]);
      for (var n = Math.ceil((lo + 180) / 360); -180 + 360 * n < hi; n++) {
        var tt = (-180 + 360 * n - ph[i]) / (ph[i + 1] - ph[i]), g = -at(i, tt, m), wg = wAt(i, tt);
        if (g >= 0 && (out.gmUp === null || g < out.gmUp)) { out.gmUp = g; out.wUp = wg; }
        if (g < 0 && (out.gmDown === null || g > out.gmDown)) { out.gmDown = g; out.wDown = wg; }
      }
    }
    return out;
  }

  // Nyquist: closed-loop RHP poles Z = P + N, counted on a contour a hair right of the
  // imaginary axis (poles on the axis don't count). Handles delay and unstable plants.
  var SIGMA = 1e-3, NYQ_W = [0].concat(logspace(1e-5, 1e4, 7000));
  function nyquistCount(model, Krows, ci, T) {
    var P = eig(closedA(model, Krows, ci)).filter(function (z) { return z[0] > SIGMA; }).length;
    var total = 0, prev = null;
    NYQ_W.forEach(function (om) {
      var a = carg(cadd([1, 0], loopAt(model, Krows, ci, T, [SIGMA, om])));
      if (prev !== null) { var d = a - prev; while (d > Math.PI) d -= 2 * Math.PI; while (d <= -Math.PI) d += 2 * Math.PI; total += d; }
      prev = a;
    });
    var N = Math.round(-total / Math.PI);
    return { P: P, N: N, Z: P + N };
  }

  // Pole placement: with one input and as many gains as states, the closed-loop
  // characteristic polynomial is affine in the gains, so placing poles is a linear solve.
  function placeable(model) {
    var ins = {}; model.feats.forEach(function (f) { ins[f.input] = 1; });
    return Object.keys(ins).length === 1 && model.feats.length === model.na;
  }
  function placePoles(model, desired) {
    var na = model.na, col = model.feats[0].input, c0 = charPoly(model.A), M = [];
    var cols = model.feats.map(function (f) {
      var A = copyM(model.A);
      for (var i = 0; i < na; i++) for (var j = 0; j < na; j++) A[i][j] += model.B[i][col] * f.F[j];
      var c = charPoly(A); return c.map(function (v, k) { return v - c0[k]; });
    });
    var target = polyFromRoots(desired);
    for (var k = 1; k <= na; k++) M.push(cols.map(function (c) { return c[k]; }).concat([target[k] - c0[k]]));
    // real Gaussian elimination
    for (var a = 0; a < na; a++) {
      var p = a; for (var r = a + 1; r < na; r++) if (Math.abs(M[r][a]) > Math.abs(M[p][a])) p = r;
      var t = M[p]; M[p] = M[a]; M[a] = t;
      if (Math.abs(M[a][a]) < 1e-12) return null;
      for (r = a + 1; r < na; r++) { var f = M[r][a] / M[a][a]; for (var q = a; q <= na; q++) M[r][q] -= f * M[a][q]; }
    }
    var g = [];
    for (a = na - 1; a >= 0; a--) { var s = M[a][na]; for (q = a + 1; q < na; q++) s -= M[a][q] * g[q]; g[a] = s / M[a][a]; }
    var out = {}; model.feats.forEach(function (f, i) { out[f.name] = g[i]; });
    return out;
  }

  /* ---------------- control barrier function on one position-like state ----------------
     h = lim ∓ pos ≥ 0. pos has relative degree 2 (acc = a + b·u), so the filter keeps
     ḧ + 2λḣ + λ²h ≥ 0, a pair of bounds on u; it sends the allowed u closest to the
     requested one. Safe set drawn on the phase plane: |pos| ≤ lim and λ(lim − |pos|) ≥ ±vel. */
  function cbfBounds(plant, p, x, uRest, cbf) {
    var ci = cbf.input, u = uRest.slice(); u[ci] = 0;
    var a = plant.deriv(x, u, p)[cbf.vel]; u[ci] = 1;
    var b = plant.deriv(x, u, p)[cbf.vel] - a, L = cbf.lambda, pos = x[cbf.pos], vel = x[cbf.vel];
    var hiAcc = L * L * (cbf.lim - pos) - 2 * L * vel, loAcc = -L * L * (cbf.lim + pos) - 2 * L * vel;
    var lo = (loAcc - a) / b, hi = (hiAcc - a) / b;
    if (b < 0) { var t = lo; lo = hi; hi = t; }
    if (lo > hi) { var m = (lo + hi) / 2; lo = hi = m; }
    return [lo, hi];
  }

  /* ---------------- interval bounds on a small ReLU policy network ---------------- */
  function netForward(net, s) {
    var x = s;
    net.layers.forEach(function (L, li) {
      var y = [];
      for (var o = 0; o < L.out; o++) { var a = L.b[o]; for (var i = 0; i < L.in; i++) a += L.W[o * L.in + i] * x[i]; y.push(li < net.layers.length - 1 ? Math.max(0, a) : a); }
      x = y;
    });
    return net.force_max * Math.tanh(x[0]);
  }
  function netBounds(net, lo, hi, widths) {
    var l = lo.slice(), u = hi.slice();
    function mw() { var m = 0; for (var i = 0; i < l.length; i++) m = Math.max(m, u[i] - l[i]); return m; }
    if (widths) widths.push(mw());
    net.layers.forEach(function (L, li) {
      var nl = [], nu = [];
      for (var o = 0; o < L.out; o++) {
        var c = L.b[o], r = 0;
        for (var i = 0; i < L.in; i++) { var w = L.W[o * L.in + i]; c += w * (l[i] + u[i]) / 2; r += Math.abs(w) * (u[i] - l[i]) / 2; }
        nl.push(c - r); nu.push(c + r);
      }
      if (li < net.layers.length - 1) { nl = nl.map(function (v) { return Math.max(0, v); }); nu = nu.map(function (v) { return Math.max(0, v); }); }
      l = nl; u = nu; if (widths) widths.push(mw());
    });
    var F = [net.force_max * Math.tanh(l[0]), net.force_max * Math.tanh(u[0])];
    if (widths) widths.push(F[1] - F[0]);
    return F;
  }
  var RATE_PER_ANGLE = 5;     // the query: angle error ±ε, rate error ±5ε (the /controls/ noise ratio)
  function queryBox(e, eps) { return { lo: [e[0], e[1], e[2] - eps, e[3] - RATE_PER_ANGLE * eps], hi: [e[0], e[1], e[2] + eps, e[3] + RATE_PER_ANGLE * eps] }; }
  function certify(net, e, eps, depth) {
    var Fc = netForward(net, e), box = queryBox(e, eps), n = 1 << depth, pieces = [], dev = 0, lo = Infinity, hi = -Infinity;
    for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) {
      var sl = box.lo.slice(), sh = box.hi.slice();
      sl[2] = box.lo[2] + (box.hi[2] - box.lo[2]) * i / n; sh[2] = box.lo[2] + (box.hi[2] - box.lo[2]) * (i + 1) / n;
      sl[3] = box.lo[3] + (box.hi[3] - box.lo[3]) * j / n; sh[3] = box.lo[3] + (box.hi[3] - box.lo[3]) * (j + 1) / n;
      var F = netBounds(net, sl, sh); pieces.push({ i: i, j: j, F: F });
      dev = Math.max(dev, F[1] - Fc, Fc - F[0]); lo = Math.min(lo, F[0]); hi = Math.max(hi, F[1]);
    }
    return { Fc: Fc, dev: dev, lo: lo, hi: hi, pieces: pieces, n: n };
  }
  function attack(net, e, eps) {
    var Fc = netForward(net, e), box = queryBox(e, eps), dev = 0, lo = Fc, hi = Fc, seed = 99991, g = 6;
    function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
    function at(a, b) {
      var F = netForward(net, [e[0], e[1], box.lo[2] + a * (box.hi[2] - box.lo[2]), box.lo[3] + b * (box.hi[3] - box.lo[3])]);
      dev = Math.max(dev, Math.abs(F - Fc)); lo = Math.min(lo, F); hi = Math.max(hi, F);
    }
    for (var i = 0; i <= g; i++) for (var j = 0; j <= g; j++) at(i / g, j / g);
    for (var k = 0; k < 40; k++) at(rnd(), rnd());
    return { Fc: Fc, dev: dev, lo: lo, hi: hi };
  }
  function certifiedRadius(net, e, delta, depth, epsMax) {
    if (certify(net, e, epsMax, depth).dev <= delta) return epsMax;
    var lo = 0, hi = epsMax;
    for (var it = 0; it < 13; it++) { var m = (lo + hi) / 2; if (certify(net, e, m, depth).dev <= delta) lo = m; else hi = m; }
    return lo;
  }
  // Local linearisation of the net = an effective state-feedback row (for the loop views).
  function netGains(net) {
    var g = [], h = 1e-4;
    for (var i = 0; i < 4; i++) { var a = [0, 0, 0, 0], b = [0, 0, 0, 0]; a[i] = h; b[i] = -h; g.push((netForward(net, a) - netForward(net, b)) / (2 * h)); }
    return g;
  }

  /* ---------------- system identification: least-squares ARX ----------------
     y[k] = −a1 y[k−1] − … − a_na y[k−na] + b1 u[k−1] + … + b_nb u[k−nb] + noise */
  function arxFit(u, y, na, nb) {
    var start = Math.max(na, nb), rows = [], rhs = [], n = na + nb, k, i, j;
    for (k = start; k < y.length; k++) {
      var r = [];
      for (i = 1; i <= na; i++) r.push(-y[k - i]);
      for (i = 1; i <= nb; i++) r.push(u[k - i]);
      rows.push(r); rhs.push(y[k]);
    }
    var M = zeros(n, n + 1);                    // normal equations
    rows.forEach(function (r, ri) { for (i = 0; i < n; i++) { for (j = 0; j < n; j++) M[i][j] += r[i] * r[j]; M[i][n] += r[i] * rhs[ri]; } });
    for (i = 0; i < n; i++) M[i][i] += 1e-9;
    for (var a = 0; a < n; a++) {
      var p = a; for (var r2 = a + 1; r2 < n; r2++) if (Math.abs(M[r2][a]) > Math.abs(M[p][a])) p = r2;
      var t = M[p]; M[p] = M[a]; M[a] = t;
      for (r2 = a + 1; r2 < n; r2++) { var f = M[r2][a] / M[a][a]; for (var q = a; q <= n; q++) M[r2][q] -= f * M[a][q]; }
    }
    var th = [];
    for (a = n - 1; a >= 0; a--) { var sm = M[a][n]; for (q = a + 1; q < n; q++) sm -= M[a][q] * th[q]; th[a] = sm / M[a][a]; }
    return { a: [1].concat(th.slice(0, na)), b: [0].concat(th.slice(na)), na: na, nb: nb };
  }
  // Plain least squares is biased when the output is noisy (the noise sits inside the
  // regressors). Instrumental variables fix that: refit using the model's own noise-free
  // simulated output as instruments, a couple of times. Solves (Zᵀ Φ) θ = Zᵀ y.
  function arxFitIV(u, y, na, nb, iters) {
    var m = arxFit(u, y, na, nb), n = na + nb, start = Math.max(na, nb), i, j, k;
    for (var it = 0; it < (iters || 3); it++) {
      var yh = arxSim(m, u), M = zeros(n, n + 1);
      for (k = start; k < y.length; k++) {
        var phi = [], z = [];
        for (i = 1; i <= na; i++) { phi.push(-y[k - i]); z.push(-yh[k - i]); }
        for (i = 1; i <= nb; i++) { phi.push(u[k - i]); z.push(u[k - i]); }
        for (i = 0; i < n; i++) { for (j = 0; j < n; j++) M[i][j] += z[i] * phi[j]; M[i][n] += z[i] * y[k]; }
      }
      for (var a = 0; a < n; a++) {
        var p = a; for (var r = a + 1; r < n; r++) if (Math.abs(M[r][a]) > Math.abs(M[p][a])) p = r;
        var t = M[p]; M[p] = M[a]; M[a] = t;
        if (Math.abs(M[a][a]) < 1e-14) return m;
        for (r = a + 1; r < n; r++) { var f = M[r][a] / M[a][a]; for (var q = a; q <= n; q++) M[r][q] -= f * M[a][q]; }
      }
      var th = [];
      for (a = n - 1; a >= 0; a--) { var sm = M[a][n]; for (q = a + 1; q < n; q++) sm -= M[a][q] * th[q]; th[a] = sm / M[a][a]; }
      if (!th.every(isFinite)) return m;
      var cand = { a: [1].concat(th.slice(0, na)), b: [0].concat(th.slice(na)), na: na, nb: nb };
      if (!arxSim(cand, u).every(function (v) { return isFinite(v) && Math.abs(v) < 1e6; })) return m;
      m = cand;
    }
    return m;
  }
  // Simulate the fitted model on the same input (free run, not one-step-ahead).
  function arxSim(model, u) {
    var y = [];
    for (var k = 0; k < u.length; k++) {
      var v = 0, i;
      for (i = 1; i < model.a.length; i++) v -= model.a[i] * (k - i >= 0 ? y[k - i] : 0);
      for (i = 1; i < model.b.length; i++) v += model.b[i] * (k - i >= 0 ? u[k - i] : 0);
      y.push(v);
    }
    return y;
  }
  function arxFreq(model, w, dt) {
    var zi = [Math.cos(w * dt), -Math.sin(w * dt)], num = [0, 0], den = [0, 0], zk = [1, 0];
    for (var k = 0; k < Math.max(model.a.length, model.b.length); k++) {
      if (k < model.b.length) num = cadd(num, cmul([model.b[k], 0], zk));
      if (k < model.a.length) den = cadd(den, cmul([model.a[k], 0], zk));
      zk = cmul(zk, zi);
    }
    return cdiv(num, den);
  }
  // A 2nd-order ARX fit read back as a mass-spring-damper: poles z → s = ln z / dt.
  function arxToMsd(model, dt) {
    if (model.a.length !== 3) return null;
    var zs = roots(model.a);
    var ss = zs.map(function (z) { return [Math.log(cabs(z)) / dt, carg(z) / dt]; });
    var w2 = cabs(ss[0]) * cabs(ss[1]), twoZw = -(ss[0][0] + ss[1][0]);
    var dc = model.b.reduce(function (a, v) { return a + v; }, 0) / model.a.reduce(function (a, v) { return a + v; }, 0);
    if (!(dc > 0) || !(w2 > 0)) return null;
    var k = 1 / dc, M = k / w2;
    return { M: M, c: twoZw * M, k: k, poles: ss };
  }

  /* ---------------- more identification methods (2nd-order plants: M, c, k) ----------------
     These read a mass-spring-damper's three constants back from experiments, each in the way
     its method is usually taught. All take sampled data at spacing dt. */

  // Run an open-loop experiment on a plant: input u(t), measured output with noise.
  function experiment(plant, p, uFn, T, dt, noise, rng) {
    var x = plant.x0(p).slice(), sub = Math.max(1, Math.round(dt / plant.dt)), h = dt / sub, n = Math.round(T / dt);
    var out = { t: [], u: [], y: [], yTrue: [], dt: dt }, idx = 0;
    for (var k = 0; k < n; k++) {
      var t = k * dt, uk = uFn(t);
      out.t.push(t); out.u.push(uk); out.yTrue.push(x[idx]); out.y.push(x[idx] + noise * gaussian(rng));
      // The input acts continuously between samples (a shaker doesn't hold its value), so a
      // sine isn't delayed half a sample; uFn must be a plain function of time.
      for (var j = 0; j < sub; j++) x = rk4(plant, x, [uFn(t + (j + 0.5) * h)], p, h);
    }
    return out;
  }

  // Step response, read the classic way: gain from the final value, damping ratio from the
  // overshoot, damped frequency from the time to the first peak.
  function stepEstimate(d, A, t0) {
    var y = d.y.map(function (v, i) {                  // light smoothing so noise doesn't fake a peak
      var a = 0, n = 0; for (var j = Math.max(0, i - 2); j <= Math.min(d.y.length - 1, i + 2); j++) { a += d.y[j]; n++; } return a / n;
    });
    var tail = y.slice(Math.floor(y.length * 0.85)), yss = tail.reduce(function (a, v) { return a + v; }, 0) / tail.length;
    var k0 = Math.ceil(t0 / d.dt), ipk = k0;
    for (var i = k0; i < y.length; i++) { if (y[i] > y[ipk]) ipk = i; if (y[i] < y[ipk] - 0.3 * Math.abs(y[ipk] - yss) && i > ipk) break; }
    // Refine the peak with a least-squares parabola through the raw samples around it: finds
    // the true top between samples and averages the noise, where smoothing would flatten it.
    var h = 3, S = [0, 0, 0, 0, 0], T = [0, 0, 0];
    for (var q = -h; q <= h; q++) {
      var ii = ipk + q; if (ii < 0 || ii >= d.y.length) continue;
      var tt = q * d.dt, yy = d.y[ii];
      S[0] += 1; S[1] += tt; S[2] += tt * tt; S[3] += tt * tt * tt; S[4] += tt * tt * tt * tt;
      T[0] += yy; T[1] += yy * tt; T[2] += yy * tt * tt;
    }
    var Mq = [[S[4], S[3], S[2], T[2]], [S[3], S[2], S[1], T[1]], [S[2], S[1], S[0], T[0]]];
    for (var a = 0; a < 3; a++) for (var b = a + 1; b < 3; b++) { var f = Mq[b][a] / Mq[a][a]; for (var cc = a; cc < 4; cc++) Mq[b][cc] -= f * Mq[a][cc]; }
    var qc = Mq[2][3] / Mq[2][2], qb = (Mq[1][3] - Mq[1][2] * qc) / Mq[1][1], qa = (Mq[0][3] - Mq[0][2] * qc - Mq[0][1] * qb) / Mq[0][0];
    var dtPk = qa < 0 ? clamp(-qb / (2 * qa), -h * d.dt, h * d.dt) : 0, ypk = qa < 0 ? qa * dtPk * dtPk + qb * dtPk + qc : y[ipk];
    var os = (ypk - yss) / yss, tp = d.t[ipk] + dtPk - t0;
    var K = yss / A, out = { yss: yss, overshoot: os, tp: tp, tpk: d.t[ipk] + dtPk, ypk: ypk, K: K };
    if (!(os > 0.001) || !(tp > 0)) { out.ok = false; return out; }
    var L = Math.log(os), zeta = -L / Math.sqrt(Math.PI * Math.PI + L * L), wd = Math.PI / tp, wn = wd / Math.sqrt(1 - zeta * zeta);
    var k = 1 / K, M = k / (wn * wn);
    out.ok = true; out.zeta = zeta; out.wn = wn; out.M = M; out.c = 2 * zeta * wn * M; out.k = k;
    return out;
  }

  // One frequency-response point: correlate the settled output with sin and cos over whole periods.
  function freqPoint(d, w, A, tSettle) {
    var s = 0, c = 0, n = 0, T = 2 * Math.PI / w, tEnd = d.t[d.t.length - 1], periods = Math.floor((tEnd - tSettle) / T);
    var t1 = tSettle + periods * T;
    for (var i = 0; i < d.t.length; i++) { var t = d.t[i]; if (t < tSettle || t >= t1) continue; s += d.y[i] * Math.sin(w * t); c += d.y[i] * Math.cos(w * t); n++; }
    var re = 2 * s / n / A, im = 2 * c / n / A;       // y ≈ A(re·sin + im·cos) ⇒ G = re + j·im
    return [re, im];
  }

  // Fit 1/G(jω) = k − Mω² + j·cω (exactly linear in M, c, k for this plant) by least squares
  // over the measured points: the real parts give k and M, the imaginary parts give c.
  // Each equation is weighted by |G|², so the fit balances the error in G itself rather than in
  // 1/G (where the small, noisy high-frequency points would dominate): one Sanathanan–Koerner step.
  function levyFit(ws, Gs) {
    var a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0, cn = 0, cd = 0;
    ws.forEach(function (w, i) {
      var inv = cdiv([1, 0], Gs[i]), r = [1, -w * w], q = Math.pow(cabs(Gs[i]), 2);
      a11 += q * r[0] * r[0]; a12 += q * r[0] * r[1]; a22 += q * r[1] * r[1]; b1 += q * r[0] * inv[0]; b2 += q * r[1] * inv[0];
      cn += q * w * inv[1]; cd += q * w * w;
    });
    var det = a11 * a22 - a12 * a12, k = (b1 * a22 - b2 * a12) / det, M = (a11 * b2 - a12 * b1) / det;
    return { M: M, c: cn / cd, k: k };
  }

  // Grey-box (output-error) fit: simulate the physical model with candidate constants, compare
  // with the measured output, and adjust the constants to shrink the squared error
  // (Levenberg–Marquardt on log-parameters, so they stay positive). Returns every iterate.
  function greyBoxFit(plant, pBase, d, names, guess, iters) {
    function sim(th) {
      var p = Object.assign({}, pBase); names.forEach(function (nm, i) { p[nm] = Math.exp(th[i]); });
      var x = plant.x0(p).slice(), sub = Math.max(1, Math.round(d.dt / plant.dt)), h = d.dt / sub, y = [];
      for (var k = 0; k < d.u.length; k++) { y.push(x[0]); for (var j = 0; j < sub; j++) x = rk4(plant, x, [d.u[k]], p, h); if (!isFinite(x[0]) || Math.abs(x[0]) > 1e3) { while (y.length < d.u.length) y.push(1e3); break; } }
      return y;
    }
    function cost(y) { var e = 0; for (var i = 0; i < y.length; i++) e += Math.pow(d.y[i] - y[i], 2); return e / y.length; }
    var th = names.map(function (nm) { return Math.log(guess[nm]); }), y = sim(th), J0 = cost(y), lam = 1e-2, path = [];
    function rec() { var o = {}; names.forEach(function (nm, i) { o[nm] = Math.exp(th[i]); }); path.push({ p: o, cost: J0, y: y }); }
    rec();
    for (var it = 0; it < (iters || 25); it++) {
      var r = d.y.map(function (v, i) { return v - y[i]; }), J = [];
      names.forEach(function (_, j) { var tp = th.slice(); tp[j] += 1e-4; var yp = sim(tp); J.push(yp.map(function (v, i) { return (v - y[i]) / 1e-4; })); });
      var n = names.length, H = zeros(n, n), g = new Array(n).fill(0);
      for (var a = 0; a < n; a++) { for (var b = 0; b < n; b++) { var sm = 0; for (var i = 0; i < r.length; i++) sm += J[a][i] * J[b][i]; H[a][b] = sm; } for (i = 0; i < r.length; i++) g[a] += J[a][i] * r[i]; }
      var improved = false;
      for (var tries = 0; tries < 8 && !improved; tries++) {
        var M = H.map(function (row, ai) { return row.map(function (v, bi) { return v + (ai === bi ? lam * (v + 1e-9) : 0); }).concat([g[ai]]); });
        for (var c2 = 0; c2 < n; c2++) { var pv = c2; for (var q = c2 + 1; q < n; q++) if (Math.abs(M[q][c2]) > Math.abs(M[pv][c2])) pv = q; var tt = M[pv]; M[pv] = M[c2]; M[c2] = tt; for (q = c2 + 1; q < n; q++) { var f = M[q][c2] / M[c2][c2]; for (var z = c2; z <= n; z++) M[q][z] -= f * M[c2][z]; } }
        var dth = new Array(n); for (c2 = n - 1; c2 >= 0; c2--) { var sm2 = M[c2][n]; for (q = c2 + 1; q < n; q++) sm2 -= M[c2][q] * dth[q]; dth[c2] = sm2 / M[c2][c2]; }
        dth = dth.map(function (v) { return clamp(v, -1, 1); });
        var thN = th.map(function (v, i2) { return v + dth[i2]; }), yN = sim(thN), JN = cost(yN);
        if (JN < J0) { th = thN; y = yN; J0 = JN; lam = Math.max(lam / 3, 1e-6); improved = true; } else lam *= 4;
      }
      rec();
      if (!improved || path.length > 2 && Math.abs(path[path.length - 2].cost - J0) < 1e-12 * (1 + J0)) break;
    }
    return path;
  }

  /* ---- Ho–Kalman / ERA: a state-space model from the impulse response ----
     Markov parameters h₁, h₂, … (the sampled impulse response) are stacked into a Hankel
     matrix H[i][j] = h(i+j+1). Its rank is the number of states, so its singular values show
     the model order. Keeping the n largest, A = S^-½ Uᵀ H↑ V S^-½, B = first column of S^½ Vᵀ,
     C = first row of U S^½ (H↑ is H shifted one step). With noise, small singular values
     become a noise floor and the truncation is what ERA adds to Ho–Kalman. */

  // Singular value decomposition by one-sided Jacobi (fine for the small matrices here).
  function svd(Ain) {
    var m = Ain.length, n = Ain[0].length, U = Ain.map(function (r) { return r.slice(); }), V = zeros(n, n), i, j, k;
    for (i = 0; i < n; i++) V[i][i] = 1;
    for (var sweep = 0; sweep < 60; sweep++) {
      var off = 0;
      for (j = 0; j < n - 1; j++) for (k = j + 1; k < n; k++) {
        var a = 0, b = 0, g = 0;
        for (i = 0; i < m; i++) { a += U[i][j] * U[i][j]; b += U[i][k] * U[i][k]; g += U[i][j] * U[i][k]; }
        if (Math.abs(g) <= 1e-15 * Math.sqrt(a * b)) continue;
        off = Math.max(off, Math.abs(g) / Math.sqrt(a * b));
        var zeta = (b - a) / (2 * g), t = (zeta >= 0 ? 1 : -1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta)), cs = 1 / Math.sqrt(1 + t * t), sn = cs * t;
        for (i = 0; i < m; i++) { var x = U[i][j], y = U[i][k]; U[i][j] = cs * x - sn * y; U[i][k] = sn * x + cs * y; }
        for (i = 0; i < n; i++) { var vx = V[i][j], vy = V[i][k]; V[i][j] = cs * vx - sn * vy; V[i][k] = sn * vx + cs * vy; }
      }
      if (off < 1e-12) break;
    }
    var S = [];
    for (j = 0; j < n; j++) { var nn = 0; for (i = 0; i < m; i++) nn += U[i][j] * U[i][j]; nn = Math.sqrt(nn); S.push(nn); for (i = 0; i < m; i++) U[i][j] = nn > 1e-300 ? U[i][j] / nn : 0; }
    var order = S.map(function (_, q) { return q; }).sort(function (p1, p2) { return S[p2] - S[p1]; });
    return { U: U.map(function (r) { return order.map(function (q) { return r[q]; }); }), S: order.map(function (q) { return S[q]; }),
             V: V.map(function (r) { return order.map(function (q) { return r[q]; }); }) };
  }

  // Impulse response (Markov parameters) from arbitrary input/output data by least squares:
  // y[k] = Σ h_i u[k−i], i = 1…L. This is how ERA is used on data that isn't an impulse test.
  function firFit(u, y, L) {
    var M = zeros(L, L + 1);
    for (var k = L; k < y.length; k++) {
      for (var i = 0; i < L; i++) { var ui = u[k - 1 - i]; for (var j = 0; j < L; j++) M[i][j] += ui * u[k - 1 - j]; M[i][L] += ui * y[k]; }
    }
    var tr = 0; for (i = 0; i < L; i++) tr += M[i][i];
    for (i = 0; i < L; i++) M[i][i] += 1e-6 * tr / L;   // a whisper of ridge for short records
    for (var a = 0; a < L; a++) {
      var pv = a; for (var r = a + 1; r < L; r++) if (Math.abs(M[r][a]) > Math.abs(M[pv][a])) pv = r;
      var t = M[pv]; M[pv] = M[a]; M[a] = t;
      for (r = a + 1; r < L; r++) { var f = M[r][a] / M[a][a]; for (var q = a; q <= L; q++) M[r][q] -= f * M[a][q]; }
    }
    var h = new Array(L);
    for (a = L - 1; a >= 0; a--) { var sm = M[a][L]; for (q = a + 1; q < L; q++) sm -= M[a][q] * h[q]; h[a] = sm / M[a][a]; }
    return h;                                            // h[0] = h₁ (one sample after the input)
  }

  function era(h, rows, order) {
    var nr = rows, nc = rows, H = zeros(nr, nc), H2 = zeros(nr, nc), i, j;
    for (i = 0; i < nr; i++) for (j = 0; j < nc; j++) { H[i][j] = h[i + j] || 0; H2[i][j] = h[i + j + 1] || 0; }
    var sv = svd(H), n = order, Ur = sv.U.map(function (r) { return r.slice(0, n); }), Vr = sv.V.map(function (r) { return r.slice(0, n); });
    var sq = sv.S.slice(0, n).map(Math.sqrt);
    var A = zeros(n, n), a, b;
    for (a = 0; a < n; a++) for (b = 0; b < n; b++) {
      var sm = 0; for (i = 0; i < nr; i++) for (j = 0; j < nc; j++) sm += Ur[i][a] * H2[i][j] * Vr[j][b];
      A[a][b] = sm / (sq[a] * sq[b]);
    }
    var B = [], Cr = [];
    for (a = 0; a < n; a++) { B.push(sq[a] * Vr[0][a]); Cr.push(sq[a] * Ur[0][a]); }
    return { A: A, B: B, C: Cr, S: sv.S, H: H, n: n };
  }
  function ssSim(m, u) {                               // discrete state-space free run, x₀ = 0
    var x = m.B.map(function () { return 0; }), y = [];
    for (var k = 0; k < u.length; k++) {
      var yk = 0; for (var i = 0; i < x.length; i++) yk += m.C[i] * x[i]; y.push(yk);
      x = m.A.map(function (row, r) { var s2 = m.B[r] * u[k]; for (var q = 0; q < row.length; q++) s2 += row[q] * x[q]; return s2; });
    }
    return y;
  }
  // A 2-state realization read back as a mass-spring-damper (poles z → s = ln z / dt).
  function ssToMsd(m, dt) {
    if (m.n !== 2) return null;
    var zs = eig(m.A), ss = zs.map(function (z) { return [Math.log(cabs(z)) / dt, carg(z) / dt]; });
    var IA = [[1 - m.A[0][0], -m.A[0][1]], [-m.A[1][0], 1 - m.A[1][1]]], det = IA[0][0] * IA[1][1] - IA[0][1] * IA[1][0];
    var x0 = (IA[1][1] * m.B[0] - IA[0][1] * m.B[1]) / det, x1 = (-IA[1][0] * m.B[0] + IA[0][0] * m.B[1]) / det, dc = m.C[0] * x0 + m.C[1] * x1;
    var w2 = cabs(ss[0]) * cabs(ss[1]), twoZw = -(ss[0][0] + ss[1][0]);
    if (!(dc > 0) || !(w2 > 0)) return null;
    var k = 1 / dc, M = k / w2;
    return { M: M, c: twoZw * M, k: k, poles: ss };
  }

  // Free-run a mass-spring-damper with given constants on an input sequence (validation).
  function simMsd(plant, pBase, consts, u, dt) {
    var p = Object.assign({}, pBase, consts), x = plant.x0(p).slice(), sub = Math.max(1, Math.round(dt / plant.dt)), h = dt / sub, y = [];
    for (var k = 0; k < u.length; k++) { y.push(x[0]); for (var j = 0; j < sub; j++) x = rk4(plant, x, [u[k]], p, h); }
    return y;
  }
  function fitPercent(yTrue, yhat) {
    var m = yTrue.reduce(function (a, v) { return a + v; }, 0) / yTrue.length, e = 0, v2 = 0;
    yTrue.forEach(function (v, i) { e += Math.pow(v - yhat[i], 2); v2 += Math.pow(v - m, 2); });
    return 100 * (1 - Math.sqrt(e / v2));
  }

  /* ---------------- nonlinear simulator ----------------
     sim = createSim(plant, lab): the same plant equations as the sims on /controls/, with
     the controller run at the plant's control rate, measurement noise, a transport delay
     on every input and actuator limits. */
  function gaussian(rng) { var u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function refValue(ref, t) {
    if (ref.type === 'hold') return ref.hold || 0;
    var s = Math.sin(ref.omega * t);
    return ref.type === 'step' ? ref.amp * (s >= 0 ? 1 : -1) : ref.amp * s;
  }
  function refRate(ref, t) { return ref.type === 'wave' ? ref.amp * ref.omega * Math.cos(ref.omega * t) : 0; }

  function rk4(plant, x, u, p, h) {
    var k1 = plant.deriv(x, u, p);
    var k2 = plant.deriv(x.map(function (v, i) { return v + k1[i] * h / 2; }), u, p);
    var k3 = plant.deriv(x.map(function (v, i) { return v + k2[i] * h / 2; }), u, p);
    var k4 = plant.deriv(x.map(function (v, i) { return v + k3[i] * h; }), u, p);
    return x.map(function (v, i) { return v + (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]) * h / 6; });
  }

  function createSim(plant, lab, rng) {
    rng = rng || Math.random;
    var sim = { t: 0, x: null, z: [], prevY: [], prevE: [], buf: [], u: plant.u0(lab.p), uReq: null, cbfActive: false, failed: false, contrib: [] };
    sim.reset = function (x) {
      sim.t = 0; sim.x = x || plant.start(lab.p, rng); sim.z = lab.controller.channels.map(function () { return 0; });
      sim.prevY = null; sim.prevE = []; sim.buf = []; sim.u = plant.u0(lab.p); sim.failed = false; sim.status = 'ok'; sim.contrib = [];
    };
    sim.reset();
    // One control period: measure, compute, filter, then integrate the plant.
    sim.step = function () {
      var p = lab.p, dt = plant.dt, x0 = plant.x0(p), u0 = plant.u0(p), ctrl = lab.controller;
      var meas = sim.x.map(function (v, i) { return v + (plant.noise[i] || 0) * lab.noise * gaussian(rng); });
      var r = lab.refs.map(function (ref) { return refValue(ref, sim.t); }), rr = lab.refs.map(function (ref) { return refRate(ref, sim.t); });
      var u = u0.slice();
      // Manual mode: the page supplies the input (a drag), and the controller rests.
      var manualU = lab.manual ? lab.manualInput && lab.manualInput(sim) : null;
      ctrl.channels.forEach(function (ch, ci) {
        if (manualU || (lab.chanOff && lab.chanOff[ci])) { sim.contrib[ci] = null; return; }
        var g = lab.gains[ci], du, terms;
        if (ch.type === 'pid') {
          var y = meas[ch.out] - x0[ch.out], e = r[ci] - y;
          sim.z[ci] += e * dt;
          if (ch.intClamp) sim.z[ci] = clamp(sim.z[ci], -ch.intClamp, ch.intClamp);
          // D on the error for a smooth reference; on the measurement alone for a step,
          // so the derivative doesn't spike at each jump (as on /controls/).
          var dterm = !sim.prevY ? 0 : lab.refs[ci].type === 'wave' ? (e - sim.prevE[ci]) / dt : -(meas[ch.out] - sim.prevY[ci]) / dt;
          sim.prevE[ci] = e;
          terms = { p: ch.sign * (g.kp || 0) * e, i: ch.sign * (g.ki || 0) * sim.z[ci], d: ch.sign * (g.kd || 0) * dterm };
          du = terms.p + terms.i + terms.d;
        } else if (ch.type === 'sf') {
          var dev = ch.rows.map(function (si, k) { return meas[si] - x0[si] - (k === 0 ? r[ci] : k === 1 ? rr[ci] : 0); });
          terms = {};
          if (lab.useNet && lab.net) { du = netForward(lab.net, dev); terms.net = du; }
          else { du = 0; ch.names.forEach(function (nm, k) { terms[nm] = (g[nm] || 0) * dev[k]; du += terms[nm]; }); }
        }
        sim.contrib[ci] = terms;
        u[ch.input] = u0[ch.input] + du * (lab.scale ? lab.scale[ci] : 1);
      });
      if (manualU) manualU.forEach(function (v, i) { if (v !== null && v !== undefined) u[i] = v; });
      // Extra excitation on input 0 (a tap or a random shaker, for identification experiments).
      if (lab.excite) u[0] += lab.excite(sim.t);
      // Shaker (frequency-response experiments): a sine added to one input.
      if (lab.shake) { sim.phase = (sim.phase || 0) + lab.w * dt; u[lab.shake.input] += lab.shake.amp * Math.sin(sim.phase); }
      sim.prevY = ctrl.channels.map(function (ch) { return ch.type === 'pid' ? meas[ch.out] : 0; });
      if (!sim.prevE.length) sim.prevE = ctrl.channels.map(function () { return 0; });
      sim.uReq = u.slice();
      if (lab.cbf && lab.cbf.on) {
        var bd = cbfBounds(plant, p, sim.x, u, lab.cbf);
        var before = u[lab.cbf.input];
        u[lab.cbf.input] = clamp(u[lab.cbf.input], bd[0], bd[1]);
        sim.cbfActive = Math.abs(u[lab.cbf.input] - before) > 1e-9; sim.cbfBounds = bd;
      } else sim.cbfActive = false;
      u = u.map(function (v, i) { return clamp(v, plant.ulim(p)[i][0], plant.ulim(p)[i][1]); });
      // Delay applies to the controller's command only (a person dragging isn't delayed).
      var lag = manualU ? 0 : Math.round((lab.delay || 0) / dt);
      sim.buf.push(u);
      var ua = sim.buf.length > lag ? sim.buf.shift() : u0;
      if (manualU) sim.buf = [];
      // Actuators that can't jump: a servo or an elevator moves at a limited rate.
      if (plant.uRate) ua = ua.map(function (v, i) { var mr = plant.uRate[i]; return mr ? clamp(v, sim.u[i] - mr * dt, sim.u[i] + mr * dt) : v; });
      sim.u = ua;
      var sub = plant.substeps || 4, h = dt / sub, x = sim.x;
      for (var k = 0; k < sub; k++) x = rk4(plant, x, ua, p, h);
      sim.x = x; sim.t += dt;
      sim.status = plant.status ? plant.status(sim.x, p) : (plant.failed && plant.failed(sim.x, p) ? 'failed' : 'ok');
      sim.failed = sim.status !== 'ok';
      return sim;
    };
    return sim;
  }

  var LabCore = {
    cadd: cadd, csub: csub, cmul: cmul, cdiv: cdiv, cabs: cabs, carg: carg, clamp: clamp, wrap180: wrap180, logspace: logspace,
    charPoly: charPoly, roots: roots, eig: eig, polyFromRoots: polyFromRoots, polyStr: polyStr,
    linearize: linearize, loopModel: loopModel, closedA: closedA, closedAWithDelay: closedAWithDelay, loopAt: loopAt,
    freqResponse: freqResponse, margins: margins, nyquistCount: nyquistCount, placeable: placeable, placePoles: placePoles,
    cbfBounds: cbfBounds, netForward: netForward, netBounds: netBounds, queryBox: queryBox, certify: certify, attack: attack,
    certifiedRadius: certifiedRadius, netGains: netGains, RATE_PER_ANGLE: RATE_PER_ANGLE,
    arxFit: arxFit, arxFitIV: arxFitIV, arxSim: arxSim, arxFreq: arxFreq, arxToMsd: arxToMsd,
    experiment: experiment, stepEstimate: stepEstimate, freqPoint: freqPoint, levyFit: levyFit, greyBoxFit: greyBoxFit,
    simMsd: simMsd, fitPercent: fitPercent, svd: svd, firFit: firFit, era: era, ssSim: ssSim, ssToMsd: ssToMsd,
    createSim: createSim, refValue: refValue, gaussian: gaussian
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = LabCore;
  root.LabCore = LabCore;
})(typeof window !== 'undefined' ? window : this);
