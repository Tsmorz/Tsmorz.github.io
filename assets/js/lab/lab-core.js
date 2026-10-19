// LabCore — the math shared by every template page (/controls/, /modern/,
// /sysid/, /design/). No DOM, so script/test-lab runs it in Node. Everything is
// generic over a plant from lab-plants.js and a controller spec:
//   • linearize the plant, build the closed loop as one state-space model
//   • loop transfer functions, margins, Nyquist count, closed-loop poles, root locus,
//     pole placement (drag a pole → gains)
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

  /* ---------------- linearization ---------------- */
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

  /* ---------------- state estimation: steady-state Kalman gain ----------------
     Continuous-time filter for ẋ = Ax + Bu + w, y = Cx + v, with intensities Qw (process) and
     R (sensor). P solves AP + PAᵀ − PCᵀR⁻¹CP + Qw = 0, found by running the Riccati
     equation forward until it stops changing; the gain is Lo = PCᵀR⁻¹. */
  function kalmanGain(A, C, Qw, R, hStep, B) {
    // Robust route: discretize at a short step h and iterate the discrete Riccati recursion
    //   P ← Ad P Adᵀ + Qw h − Ad P Cᵀ (C P Cᵀ + R/h)⁻¹ C P Adᵀ,
    // which converges where integrating the continuous equation goes stiff (precise sensors).
    var n = A.length, p = C.length, h = hStep || 0.002, i, j;
    function mul(X, Y) { return X.map(function (r) { return Y[0].map(function (_, b) { var sm = 0; for (var q = 0; q < Y.length; q++) sm += r[q] * Y[q][b]; return sm; }); }); }
    function tr(X) { return X[0].map(function (_, a) { return X.map(function (r) { return r[a]; }); }); }
    function add(X, Y, k) { return X.map(function (r, a) { return r.map(function (v, b) { return v + (k === undefined ? 1 : k) * Y[a][b]; }); }); }
    function inv(M) {                                   // small Gauss–Jordan inverse
      var m = M.length, a = M.map(function (r, x) { return r.concat(r.map(function (_, y) { return x === y ? 1 : 0; })); });
      for (var c = 0; c < m; c++) {
        var pv = c; for (var r2 = c + 1; r2 < m; r2++) if (Math.abs(a[r2][c]) > Math.abs(a[pv][c])) pv = r2;
        var t = a[pv]; a[pv] = a[c]; a[c] = t; var d = a[c][c];
        for (var y = 0; y < 2 * m; y++) a[c][y] /= d;
        for (r2 = 0; r2 < m; r2++) if (r2 !== c) { var f = a[r2][c]; for (y = 0; y < 2 * m; y++) a[r2][y] -= f * a[c][y]; }
      }
      return a.map(function (r) { return r.slice(m); });
    }
    var Ad = zeros(n, n), term = zeros(n, n);          // Ad = e^{Ah} by series
    for (i = 0; i < n; i++) { Ad[i][i] = 1; term[i][i] = 1; }
    for (var k = 1; k < 12; k++) { term = mul(term, A).map(function (r) { return r.map(function (v) { return v * h / k; }); }); Ad = add(Ad, term); }
    var Qd = Qw.map(function (r) { return r.map(function (v) { return v * h; }); }), Rd = R.map(function (r) { return r.map(function (v) { return v / h; }); });
    var P = zeros(n, n), Ct = tr(C);
    for (i = 0; i < n; i++) P[i][i] = 1;
    for (var it = 0; it < 200000; it++) {
      var APA = mul(mul(Ad, P), tr(Ad)), APC = mul(mul(Ad, P), Ct), S = add(mul(mul(C, P), Ct), Rd);
      var Pn = add(add(APA, Qd), mul(mul(APC, inv(S)), tr(APC)), -1), dmax = 0, mag = 0;
      for (i = 0; i < n; i++) for (j = 0; j < n; j++) { dmax = Math.max(dmax, Math.abs(Pn[i][j] - P[i][j])); mag = Math.max(mag, Math.abs(Pn[i][j])); }
      P = Pn.map(function (r, a) { return r.map(function (v, b) { return (v + Pn[b][a]) / 2; }); });
      if (dmax < 1e-13 * (1 + mag)) break;
    }
    var Rinv = inv(R), out = { L: mul(mul(P, Ct), Rinv), P: P };
    if (hStep) {
      // Discrete filter at the controller's own rate: predict x̂⁻ = Ad x̂ + Bd u, then correct
      // x̂ = x̂⁻ + Kd (y − C x̂⁻), with Kd = P⁻Cᵀ(CP⁻Cᵀ + R/h)⁻¹ from the same recursion.
      out.Ad = Ad; out.Kd = mul(mul(P, Ct), inv(add(mul(mul(C, P), Ct), Rd)));
      var Bd = zeros(n, 1), tk = zeros(n, n); for (i = 0; i < n; i++) tk[i][i] = h;      // ∫₀ʰ e^{As} ds by series
      var Sint = tk.map(function (r) { return r.slice(); });
      for (k = 1; k < 12; k++) { tk = mul(tk, A).map(function (r) { return r.map(function (v) { return v * h / (k + 1); }); }); Sint = add(Sint, tk); }
      out.Bd = mul(Sint, B.map(function (r) { return [r[0]]; })).map(function (r) { return r[0]; });
    }
    return out;
  }

  // Build a lab's estimator: sensors measure cart position and pole angle with noise σ (as
  // the plant scales it); the process noise is a random force of intensity 10^logQ.
  function buildEstimator(plant, p, ch, noise, logQ, dt) {
    var lin = linearize(plant, p), n = plant.n, sig = Math.max(noise, 0.05);
    var Cm = ch.meas.map(function (si) { var r = zeros(1, n)[0]; r[si] = 1; return r; });
    var R = ch.meas.map(function (si, a) { return ch.meas.map(function (_, b) { return a === b ? Math.pow(plant.noise[si] * sig, 2) : 0; }); });
    var B = lin.B.map(function (r) { return r[ch.input]; }), q = Math.pow(10, logQ);
    var Qw = B.map(function (a) { return B.map(function (b) { return q * a * b + 1e-9; }); });
    var cont = kalmanGain(lin.A, Cm, Qw, R), disc = kalmanGain(lin.A, Cm, Qw, R, dt, lin.B.map(function (r) { return [r[ch.input]]; }));
    return { L: cont.L, P: cont.P, Ad: disc.Ad, Bd: disc.Bd, Kd: disc.Kd };
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
    // State feedback on an observer's estimate (LQG): the controller is a dynamic system from
    // the measured outputs to u. Augmented state [x, x̂]:
    //   ẋ = Ax + Bu,   x̂̇ = A x̂ + Bu + Lo(Cx − Cx̂),   u = K x̂   (deviation variables)
    var ob = ctrl.channels.filter(function (ch) { return ch.type === 'obs'; })[0];
    if (ob) {
      var N2 = 2 * n, Ao = zeros(N2, N2), Bo = zeros(N2, plant.m), Lo = ob.Lo, Cm = ob.meas, ii, jj;
      for (ii = 0; ii < n; ii++) for (jj = 0; jj < n; jj++) { Ao[ii][jj] = lin.A[ii][jj]; Ao[n + ii][n + jj] = lin.A[ii][jj]; }
      for (ii = 0; ii < n; ii++) {
        for (var q = 0; q < Cm.length; q++) { Ao[n + ii][Cm[q]] += Lo[ii][q]; Ao[n + ii][n + Cm[q]] -= Lo[ii][q]; }
        for (jj = 0; jj < plant.m; jj++) Bo[ii][jj] = lin.B[ii][jj];
      }
      // the observer's own copy of u = K x̂ (K enters through the feedback rows below)
      var featsO = [], gF = {};
      ob.rows.forEach(function (si, gi) { var r = zeros(1, N2)[0]; r[n + si] = 1; gF[ob.names[gi]] = r; featsO.push({ ch: 0, input: ob.input, name: ob.names[gi], F: r }); });
      var model = { na: N2, n: n, A: Ao, B: Bo, lin: lin, chans: [{ input: ob.input, gainsF: gF }], feats: featsO, obs: true,
        K: function (gl, scale) { var r = zeros(1, N2)[0], sc = scale ? scale[0] : 1; Object.keys(gF).forEach(function (g) { gF[g].forEach(function (f, k) { r[k] += sc * (gl[0][g] || 0) * f; }); }); return [r]; } };
      // The observer copies u internally: add B·K to its block (so the loop cut is at the plant).
      var Kr = model.K([ob.gains])[0];
      for (ii = 0; ii < n; ii++) for (jj = 0; jj < N2; jj++) Ao[n + ii][jj] += lin.B[ii][ob.input] * Kr[jj];
      model.obsPoles = eig(lin.A.map(function (r, a) { return r.map(function (v, b) { var s2 = v; for (var q2 = 0; q2 < Cm.length; q2++) if (Cm[q2] === b) s2 -= Lo[a][q2]; return s2; }); }));
      return model;
    }
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
  // Local linearization of the net = an effective state-feedback row (for the loop views).
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
  // Discrete poles z → continuous s = ln z / dt, then the pair that carries the 2nd-order reading:
  // the slowest complex pair, else the two slowest real poles. Null if nothing usable.
  function dominantPair(zs, dt) {
    if (zs.length < 2 || zs.some(function (z) { return !(cabs(z) > 0); })) return null;
    var ss = zs.map(function (z) { return [Math.log(cabs(z)) / dt, carg(z) / dt]; });
    if (ss.length === 2) return { pair: ss, reduced: false };
    var slow = function (p, q) { return cabs(p) - cabs(q); };
    var cx = ss.filter(function (q) { return q[1] > 1e-9; }).sort(slow);
    if (cx.length) return { pair: [cx[0], [cx[0][0], -cx[0][1]]], reduced: true };
    var re = ss.slice().sort(slow); return { pair: [re[0], re[1]], reduced: true };
  }
  function msdFrom(dp, dc) {
    if (!dp || !(dc > 0)) return null;
    var w2 = cabs(dp.pair[0]) * cabs(dp.pair[1]), twoZw = -(dp.pair[0][0] + dp.pair[1][0]);
    if (!(w2 > 0)) return null;
    var k = 1 / dc, M = k / w2;
    return { M: M, c: twoZw * M, k: k, poles: dp.pair, reduced: dp.reduced };
  }
  // Read a fitted ARX model back as a mass, damper and spring. A 2nd-order fit maps directly; a
  // 3rd or 4th keeps its dominant pair and the DC gain, the best 2nd-order reading of it. A
  // 1st-order fit has no oscillation to read, so it returns null.
  function arxToMsd(model, dt) {
    if (model.a.length < 3) return null;
    var dc = model.b.reduce(function (a, v) { return a + v; }, 0) / model.a.reduce(function (a, v) { return a + v; }, 0);
    return msdFrom(dominantPair(roots(model.a), dt), dc);
  }

  /* ---------------- more identification (2nd-order plants: M, c, k) ----------------
     Experiments on a mass-spring-damper, read back as its three constants. All take sampled data
     at spacing dt. */

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
  // Ho–Kalman for several measured outputs: h[k] is the vector of outputs k+1 samples after a unit tap, so
  // h[k] = C A^k B. The Hankel matrix stacks the outputs, so it is (rows·p) × rows; its SVD gives the order and the realization.
  function eraMimo(h, p, rows, order) {
    var nr = rows * p, nc = rows, H = zeros(nr, nc), H2 = zeros(nr, nc), i, j, a, b, o;
    for (i = 0; i < rows; i++) for (j = 0; j < nc; j++) for (o = 0; o < p; o++) { H[i * p + o][j] = (h[i + j] || [])[o] || 0; H2[i * p + o][j] = (h[i + j + 1] || [])[o] || 0; }
    var sv = svd(H), n = order, Ur = sv.U.map(function (r) { return r.slice(0, n); }), Vr = sv.V.map(function (r) { return r.slice(0, n); }), sq = sv.S.slice(0, n).map(Math.sqrt);
    var A = zeros(n, n), B = [], Cm = zeros(p, n);
    for (a = 0; a < n; a++) for (b = 0; b < n; b++) {
      var sm = 0; for (i = 0; i < nr; i++) for (j = 0; j < nc; j++) sm += Ur[i][a] * H2[i][j] * Vr[j][b];
      A[a][b] = sm / (sq[a] * sq[b]);
    }
    for (a = 0; a < n; a++) { B.push(sq[a] * Vr[0][a]); for (o = 0; o < p; o++) Cm[o][a] = sq[a] * Ur[o][a]; }
    return { A: A, B: B, C: Cm, S: sv.S, n: n };
  }
  // x[k+1] = A x[k] + B u[k], x[0] = 0; returns the states x[0..N-1].
  function simLin(A, B, u) {
    var n = A.length, x = new Array(n).fill(0), out = [];
    u.forEach(function (uk) { out.push(x); x = A.map(function (row, i) { var s2 = B[i] * uk; for (var q = 0; q < n; q++) s2 += row[q] * x[q]; return s2; }); });
    return out;
  }
  // Weights w minimizing |X w − Y|² (normal equations, Gaussian elimination, a whisper of ridge).
  function lsqSolve(X, Y) {
    var m = X[0].length, M = zeros(m, m), b = new Array(m).fill(0), a, c2, r;
    X.forEach(function (row, t2) { for (a = 0; a < m; a++) { b[a] += row[a] * Y[t2]; for (c2 = 0; c2 < m; c2++) M[a][c2] += row[a] * row[c2]; } });
    var tr = 0; for (a = 0; a < m; a++) tr += M[a][a]; for (a = 0; a < m; a++) M[a][a] += 1e-10 * tr / m;
    var aug = M.map(function (rw, i2) { return rw.concat([b[i2]]); });
    for (a = 0; a < m; a++) { var pv = a; for (r = a + 1; r < m; r++) if (Math.abs(aug[r][a]) > Math.abs(aug[pv][a])) pv = r; var t3 = aug[a]; aug[a] = aug[pv]; aug[pv] = t3;
      for (r = a + 1; r < m; r++) { var f = aug[r][a] / aug[a][a]; for (c2 = a; c2 <= m; c2++) aug[r][c2] -= f * aug[a][c2]; } }
    var w = new Array(m); for (a = m - 1; a >= 0; a--) { var sm2 = aug[a][m]; for (c2 = a + 1; c2 < m; c2++) sm2 -= aug[a][c2] * w[c2]; w[a] = sm2 / aug[a][a]; }
    return w;
  }

  // Three ways to fit the same noisy random-input recording of a mass-spring-damper, as mean relative error in m, c, k over
  // `draws` recordings: ARX by instrumental variables (position only), Ho–Kalman from a least-squares impulse response (position
  // only), and plain state-space least squares on measured position and velocity (full state, each noisy; velocity 3× as much).
  function compareFits(plant, p, noise, seed, draws) {
    var dt = 0.05, N = 1200, sums = { arx: [0, 0, 0], era: [0, 0, 0], ss: [0, 0, 0] }, cnt = { arx: 0, era: 0, ss: 0 };
    function relErr(e) { return e ? [Math.abs(e.M / p.M - 1), Math.abs(e.c / p.c - 1), Math.abs(e.k / p.k - 1)] : null; }
    function add(key, e) { var r = relErr(e); if (!r) return; r.forEach(function (v, i) { sums[key][i] += v; }); cnt[key]++; }
    for (var d = 0; d < (draws || 4); d++) {
      var sd = (seed || 1) * 7919 + d * 104729, g = function () { sd = (sd * 1103515245 + 12345) % 2147483648; return sd / 2147483648; };
      var x = plant.x0(p).slice(), u = [], xm = [], vm = [], level = 2, hold = 0, k, j;
      for (k = 0; k < N; k++) {
        if (hold <= 0) { level = g() < 0.5 ? 2 : -2; hold = 0.2 + 0.8 * g(); } hold -= dt;
        u.push(level); xm.push(x[0] + noise * gaussian(g)); vm.push(x[1] + 3 * noise * gaussian(g));
        for (j = 0; j < 5; j++) x = rk4(plant, x, [level], p, dt / 5);
      }
      add('arx', arxToMsd(arxFitIV(u, xm, 2, 2), dt));
      var E = era(firFit(u, xm, 240), 30, 2); add('era', ssToMsd(E, dt));
      var Z = [], X1 = [], V1 = []; for (k = 0; k < N - 1; k++) { Z.push([xm[k], vm[k], u[k]]); X1.push(xm[k + 1]); V1.push(vm[k + 1]); }
      var w1 = lsqSolve(Z, X1), w2 = lsqSolve(Z, V1);
      add('ss', ssToMsd({ n: 2, A: [[w1[0], w1[1]], [w2[0], w2[1]]], B: [w1[2], w2[2]], C: [1, 0] }, dt));
    }
    var out = {}; Object.keys(sums).forEach(function (key) { out[key] = cnt[key] ? sums[key].map(function (v) { return 100 * v / cnt[key]; }) : null; });
    return out;
  }
  // The unseen-state example. Measure only the states in `outs`; build a model from one tap of the linearized plant by
  // Ho–Kalman; the realized states are a fixed mix of the physical ones, so a one-off calibration against the hard-to-measure
  // state `target` (noisy) gives weights w with target ≈ w·x̃, checked on a fresh input.
  function unseen(plant, p, cfg) {
    var dt = cfg.dt || 0.05, lin = linearize(plant, p), d = zohDiscretize(lin.A, lin.B, dt), n = plant.n, G = d.Gam.map(function (r) { return r[0]; });
    var rows = cfg.rows || 30, K = 2 * rows + 2, q = G.slice(), h = [], k, i;
    for (k = 0; k < K; k++) { h.push(cfg.outs.map(function (o) { return q[o]; })); q = d.Phi.map(function (r) { var sm = 0; for (var z = 0; z < n; z++) sm += r[z] * q[z]; return sm; }); }
    var era = eraMimo(h, cfg.outs.length, rows, cfg.order);
    var seed = cfg.seed || 1; function rng() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
    function prbs(N, hold) { var u = [], lv = 1; for (k = 0; k < N; k++) { if (k % hold === 0) lv = rng() < 0.5 ? -1 : 1; u.push(lv); } return u; }
    var N = cfg.N || 80, amp = cfg.amp || 1, cal = prbs(N, 4).map(function (v) { return v * amp; }), val = prbs(N, 6).map(function (v, j) { return v * amp * (j % 20 < 10 ? 1 : 0.5); });
    function run(u) { return { xp: simLin(d.Phi, G, u), xr: simLin(era.A, era.B, u) }; }
    var C1 = run(cal), V1 = run(val), tgt = cfg.target;
    var tc = C1.xp.map(function (x) { return x[tgt]; }), mean = tc.reduce(function (a, v) { return a + v; }, 0) / tc.length, sd = Math.sqrt(tc.reduce(function (a, v) { return a + (v - mean) * (v - mean); }, 0) / tc.length) || 1;
    var yc = tc.map(function (v) { return v + (cfg.noise || 0) * sd * gaussian(rng); });
    var w = lsqSolve(C1.xr, yc), est = V1.xr.map(function (x) { var sm = 0; for (i = 0; i < w.length; i++) sm += w[i] * x[i]; return sm; });
    var tv = V1.xp.map(function (x) { return x[tgt]; }), mv = tv.reduce(function (a, v) { return a + v; }, 0) / tv.length, e2 = 0, v2 = 0;
    tv.forEach(function (v, j) { e2 += Math.pow(v - est[j], 2); v2 += Math.pow(v - mv, 2); });
    // every observable physical state as a mix of the realized ones (noise-free), for the picture
    var W = []; for (var s3 = 0; s3 < n; s3++) { var wr = lsqSolve(C1.xr, C1.xp.map(function (x) { return x[s3]; })), res = 0, vr = 0; C1.xr.forEach(function (x, j) { var e = 0; for (i = 0; i < wr.length; i++) e += wr[i] * x[i]; res += Math.pow(C1.xp[j][s3] - e, 2); vr += Math.pow(C1.xp[j][s3], 2); }); W.push({ w: wr, miss: vr > 0 ? Math.sqrt(res / vr) : 0 }); }
    return { dt: dt, S: era.S, order: cfg.order, w: w, W: W, t: val.map(function (_, j) { return j * dt; }), truth: tv, est: est, fit: v2 > 0 ? 100 * (1 - Math.sqrt(e2 / v2)) : NaN };
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
    if (m.n < 2) return null;
    var n = m.n, IA = m.A.map(function (r, i) { return r.map(function (v, j) { return [(i === j ? 1 : 0) - v, 0]; }); });
    var x = csolve(IA, m.B.map(function (v) { return [v, 0]; })), dc = 0;       // DC gain C (I − A)⁻¹ B
    for (var i = 0; i < n; i++) dc += m.C[i] * x[i][0];
    return msdFrom(dominantPair(eig(m.A), dt), dc);
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

  /* ---------------- discretization ----------------
     Continuous → discrete, four ways. For a pole p and sample period T:
       zero-order hold (exact for a staircase input)  z = e^{pT}
       forward Euler   s ≈ (z − 1)/T                  z = 1 + pT
       backward Euler  s ≈ (z − 1)/(zT)               z = 1/(1 − pT)
       Tustin          s ≈ (2/T)(z − 1)/(z + 1)       z = (1 + pT/2)/(1 − pT/2)            */
  function mapPole(method, p, T) {
    var pt = [p[0] * T, p[1] * T];
    if (method === 'zoh') return cexp(pt);
    if (method === 'fe') return [1 + pt[0], pt[1]];
    if (method === 'be') return cdiv([1, 0], [1 - pt[0], -pt[1]]);
    return cdiv([1 + pt[0] / 2, pt[1] / 2], [1 - pt[0] / 2, -pt[1] / 2]);
  }
  // e^{AT} and ∫₀ᵀ e^{As}ds B, by scaling and squaring a series.
  function zohDiscretize(A, B, T) {
    var n = A.length, sc = 0, nrm = 0, i, j, k;
    A.forEach(function (r) { r.forEach(function (v) { nrm = Math.max(nrm, Math.abs(v)); }); });
    while (nrm * T / Math.pow(2, sc) > 0.25) sc++;
    var h = T / Math.pow(2, sc), Ph = zeros(n, n), Sg = zeros(n, n), term = zeros(n, n);
    for (i = 0; i < n; i++) { Ph[i][i] = 1; term[i][i] = 1; Sg[i][i] = h; }
    var tS = zeros(n, n); for (i = 0; i < n; i++) tS[i][i] = h;
    function mul(X, Y) { return X.map(function (r) { return Y[0].map(function (_, b) { var sm = 0; for (var q = 0; q < Y.length; q++) sm += r[q] * Y[q][b]; return sm; }); }); }
    for (k = 1; k < 16; k++) {
      term = mul(term, A).map(function (r) { return r.map(function (v) { return v * h / k; }); });
      tS = mul(tS, A).map(function (r) { return r.map(function (v) { return v * h / (k + 1); }); });
      for (i = 0; i < n; i++) for (j = 0; j < n; j++) { Ph[i][j] += term[i][j]; Sg[i][j] += tS[i][j]; }
    }
    for (k = 0; k < sc; k++) {                         // e^{2hA} = (e^{hA})², ∫₀^{2h} = ∫₀^h (I + e^{hA})
      var I2 = Ph.map(function (r, a) { return r.map(function (v, b) { return v + (a === b ? 1 : 0); }); });
      Sg = mul(I2, Sg); Ph = mul(Ph, Ph);
    }
    return { Phi: Ph, Gam: mul(Sg, B.map(function (r) { return r.slice(); })) };
  }
  // The other three are substitutions s → (az + b)/(cz + d) into G(s) = num(s)/den(s).
  function tfDiscretize(num, den, method, T) {
    var sub = method === 'fe' ? [1, -1, 0, T] : method === 'be' ? [1, -1, T, 0] : [2, -2, T, T]; // (az+b)/(cz+d)
    var n = den.length - 1;
    function poly(c) {                                  // Σ c_k s^k (highest first) → polynomial in z
      var out = new Array(n + 1).fill(0), deg = c.length - 1;
      c.forEach(function (ck, idx) {
        var k = deg - idx, t = [1];
        for (var q = 0; q < k; q++) t = convolve(t, [sub[0], sub[1]]);
        for (q = 0; q < n - k; q++) t = convolve(t, [sub[2], sub[3]]);
        var off = out.length - t.length; t.forEach(function (v, i) { out[off + i] += ck * v; });
      });
      return out;
    }
    var a = poly(den), b = poly(num), lead = a[0];
    return { num: b.map(function (v) { return v / lead; }), den: a.map(function (v) { return v / lead; }) };
  }
  function convolve(x, y) { var o = new Array(x.length + y.length - 1).fill(0); x.forEach(function (a, i) { y.forEach(function (b, j) { o[i + j] += a * b; }); }); return o; }
  function dtfSim(m, u) {                               // num/den in z (highest first, monic den)
    var n = m.den.length - 1, y = [];
    for (var k = 0; k < u.length; k++) {
      var v = 0;
      for (var i = 1; i <= n; i++) v -= m.den[i] * (k - i >= 0 ? y[k - i] : 0);
      for (i = 0; i < m.num.length; i++) { var d = n - (m.num.length - 1) + i; v += m.num[i] * (k - d >= 0 ? u[k - d] : 0); }
      y.push(v);
    }
    return y;
  }
  function dtfFreq(m, w, T) {
    var z = [Math.cos(w * T), Math.sin(w * T)];
    function ev(c) { var r = [0, 0]; c.forEach(function (v) { r = cadd(cmul(r, z), [v, 0]); }); return r; }
    return cdiv(ev(m.num), ev(m.den));
  }
  // A sampled PID (rate 1/T, zero-order hold on its output) around a plant: one exact discrete
  // map for the state [x, ∫e, y(previous sample)]. Stable iff every eigenvalue is inside |z| = 1.
  function sampledPidLoop(plant, p, ch, g, T) {
    var lin = linearize(plant, p), n = plant.n, d = zohDiscretize(lin.A, lin.B, T), N = n + 2, M = zeros(N, N), out = ch.out, sg = ch.sign;
    // u_k = σ(kp·e + ki·I − kd·(y_k − y_{k−1})/T), e = −y_k ; I_{k+1} = I_k + T·e ; yprev_{k+1} = y_k
    var urow = zeros(1, N)[0];
    urow[out] += sg * (-(g.kp || 0) - (g.kd || 0) / T); urow[n] += sg * (g.ki || 0); urow[n + 1] += sg * (g.kd || 0) / T;
    for (var i = 0; i < n; i++) { for (var j = 0; j < n; j++) M[i][j] = d.Phi[i][j]; for (j = 0; j < N; j++) M[i][j] += d.Gam[i][ch.input] * urow[j]; }
    M[n][n] = 1; M[n][out] -= T; M[n + 1][out] = 1;
    return eig(M);
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
    var sim = { t: 0, x: null, z: [], prevY: [], prevE: [], buf: [], u: plant.u0(lab.p), uReq: null, failed: false, contrib: [] };
    sim.reset = function (x) {
      sim.t = 0; sim.x = x || plant.start(lab.p, rng); sim.z = lab.controller.channels.map(function () { return 0; });
      sim.prevY = null; sim.prevE = []; sim.xhat = null; sim.prevMeas = null; sim.meas = null; sim.uHeld = null; sim.holdLeft = 0; sim.buf = []; sim.u = plant.u0(lab.p); sim.failed = false; sim.status = 'ok'; sim.contrib = [];
    };
    sim.reset();
    // One control period: measure, compute, filter, then integrate the plant.
    sim.step = function () {
      var p = lab.p, dt = plant.dt, x0 = plant.x0(p), u0 = plant.u0(p), ctrl = lab.controller;
      // A controller running slower than the plant (lab.ctrlPeriod): it computes once per period
      // and a zero-order hold keeps its output constant in between.
      var Ts = lab.ctrlPeriod && lab.ctrlPeriod > dt + 1e-12 && !lab.manual ? lab.ctrlPeriod : dt;
      if (Ts > dt && sim.uHeld && sim.holdLeft > 1e-9) { sim.holdLeft -= dt; return finish(sim.uHeld.slice(), null); }
      var meas = sim.x.map(function (v, i) { return v + (plant.noise[i] || 0) * lab.noise * gaussian(rng); });
      sim.meas = meas;           // what the sensors reported this period; the plots draw it behind the true state
      var r = lab.refs.map(function (ref) { return refValue(ref, sim.t); }), rr = lab.refs.map(function (ref) { return refRate(ref, sim.t); });
      var u = u0.slice();
      // Manual mode: the page supplies the input (a drag), and the controller rests.
      var manualU = lab.manual ? lab.manualInput && lab.manualInput(sim) : null;
      ctrl.channels.forEach(function (ch, ci) {
        if (manualU || (lab.chanOff && lab.chanOff[ci])) { sim.contrib[ci] = null; return; }
        var g = lab.gains[ci], du, terms;
        if (ch.type === 'pid') {
          var y = meas[ch.out] - x0[ch.out], e = r[ci] - y;
          sim.z[ci] += e * Ts;
          if (ch.intClamp) sim.z[ci] = clamp(sim.z[ci], -ch.intClamp, ch.intClamp);
          // D on the error for a smooth reference; on the measurement alone for a step,
          // so the derivative doesn't spike at each jump (as on /controls/).
          var dterm = !sim.prevY ? 0 : lab.refs[ci].type === 'wave' ? (e - sim.prevE[ci]) / Ts : -(meas[ch.out] - sim.prevY[ci]) / Ts;
          sim.prevE[ci] = e;
          terms = { p: ch.sign * (g.kp || 0) * e, i: ch.sign * (g.ki || 0) * sim.z[ci], d: ch.sign * (g.kd || 0) * dterm };
          du = terms.p + terms.i + terms.d;
        } else if (ch.type === 'obs') {
          // Only the listed outputs are measured. Rates come from differencing them, or from
          // the Kalman filter (lab.estimator), whose estimate the state feedback then uses.
          var est = lab.est, xh = sim.xhat || (sim.xhat = x0.map(function () { return 0; }));
          if (lab.estimator === 'kalman' && est) {
            var uPrev = sim.u[ch.input] - u0[ch.input];
            var xp = est.Ad.map(function (row, a) { var s3 = est.Bd[a] * uPrev; for (var b = 0; b < row.length; b++) s3 += row[b] * xh[b]; return s3; });
            var innov = ch.meas.map(function (si) { return (meas[si] - x0[si]) - xp[si]; });
            xh = xp.map(function (v, a) { var s4 = v; for (var q3 = 0; q3 < innov.length; q3++) s4 += est.Kd[a][q3] * innov[q3]; return s4; });
          } else {
            var pm = sim.prevMeas || meas;
            xh = x0.map(function () { return 0; });
            ch.meas.forEach(function (si) { xh[si] = meas[si] - x0[si]; });
            (ch.rates || []).forEach(function (pr) { xh[pr[1]] = (meas[pr[0]] - pm[pr[0]]) / dt; });
          }
          sim.xhat = xh; sim.prevMeas = meas.slice();
          var dv = ch.rows.map(function (si, k) { return xh[si] - (k === 0 ? r[ci] : k === 1 ? rr[ci] : 0); });
          terms = {}; du = 0; ch.names.forEach(function (nm, k) { terms[nm] = (g[nm] || 0) * dv[k]; du += terms[nm]; });
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
      if (Ts > dt) { sim.uHeld = u.slice(); sim.holdLeft = Ts - dt; } else sim.uHeld = null;
      return finish(u, manualU);
    };
    function finish(u, manualU) {
      var p = lab.p, dt = plant.dt, u0 = plant.u0(p);
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
      if (p.xstop) {                       // hard stops on the first state: it sticks at the stop and loses its outward speed
        x = x.slice();
        if (x[0] > p.xstop) { x[0] = p.xstop; if (x[1] > 0) x[1] = 0; } else if (x[0] < -p.xstop) { x[0] = -p.xstop; if (x[1] < 0) x[1] = 0; }
      }
      sim.x = x; sim.t += dt;
      sim.status = plant.status ? plant.status(sim.x, p) : (plant.failed && plant.failed(sim.x, p) ? 'failed' : 'ok');
      sim.failed = sim.status !== 'ok';
      return sim;
    }
    return sim;
  }

  var LabCore = {
    cadd: cadd, csub: csub, cmul: cmul, cdiv: cdiv, cabs: cabs, carg: carg, clamp: clamp, wrap180: wrap180, logspace: logspace,
    charPoly: charPoly, roots: roots, eig: eig, polyFromRoots: polyFromRoots, polyStr: polyStr,
    linearize: linearize, loopModel: loopModel, closedA: closedA, closedAWithDelay: closedAWithDelay, loopAt: loopAt,
    freqResponse: freqResponse, margins: margins, nyquistCount: nyquistCount, placeable: placeable, placePoles: placePoles,
    netForward: netForward, netBounds: netBounds, queryBox: queryBox, certify: certify, attack: attack,
    certifiedRadius: certifiedRadius, netGains: netGains, RATE_PER_ANGLE: RATE_PER_ANGLE,
    arxFit: arxFit, arxFitIV: arxFitIV, arxSim: arxSim, arxFreq: arxFreq, arxToMsd: arxToMsd,
    experiment: experiment,
    simMsd: simMsd, fitPercent: fitPercent, svd: svd, firFit: firFit, era: era, eraMimo: eraMimo, simLin: simLin, unseen: unseen, lsqSolve: lsqSolve, compareFits: compareFits, ssSim: ssSim, ssToMsd: ssToMsd,
    mapPole: mapPole, zohDiscretize: zohDiscretize, tfDiscretize: tfDiscretize, dtfSim: dtfSim, dtfFreq: dtfFreq, sampledPidLoop: sampledPidLoop,
    kalmanGain: kalmanGain, buildEstimator: buildEstimator, createSim: createSim, refValue: refValue, gaussian: gaussian
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = LabCore;
  root.LabCore = LabCore;
})(typeof window !== 'undefined' ? window : this);
