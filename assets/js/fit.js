// FitCore + the /controls/fit/ page: load a recording (time, states, inputs), fit a linear model
// x[k+1] = A x[k] + B u[k] by least squares, and design a discrete LQR on it. FitCore has no DOM, so
// script/test-fit runs it in Node; the page part at the bottom only runs where #fit-root exists.
(function (root) {
  'use strict';
  var C = root.LabCore || (typeof require !== 'undefined' ? require('./lab/lab-core.js') : null);

  /* ---------------- small matrices ---------------- */
  function zeros(r, c) { var m = []; for (var i = 0; i < r; i++) m.push(new Array(c).fill(0)); return m; }
  function eye(n) { var m = zeros(n, n); for (var i = 0; i < n; i++) m[i][i] = 1; return m; }
  function T(A) { return A[0].map(function (_, j) { return A.map(function (r) { return r[j]; }); }); }
  function mul(A, B) { return A.map(function (r) { return B[0].map(function (_, j) { var s = 0; for (var k = 0; k < r.length; k++) s += r[k] * B[k][j]; return s; }); }); }
  function add(A, B, s) { return A.map(function (r, i) { return r.map(function (v, j) { return v + (s === undefined ? 1 : s) * B[i][j]; }); }); }
  function inv(A) {                                   // Gauss–Jordan with partial pivoting
    var n = A.length, M = A.map(function (r, i) { return r.concat(eye(n)[i]); }), i, j, k;
    for (i = 0; i < n; i++) {
      var p = i; for (k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k;
      if (Math.abs(M[p][i]) < 1e-14) return null;
      var t = M[i]; M[i] = M[p]; M[p] = t;
      var d = M[i][i]; for (j = 0; j < 2 * n; j++) M[i][j] /= d;
      for (k = 0; k < n; k++) if (k !== i) { var f = M[k][i]; if (f) for (j = 0; j < 2 * n; j++) M[k][j] -= f * M[i][j]; }
    }
    return M.map(function (r) { return r.slice(n); });
  }
  function colVec(v) { return v.map(function (x) { return [x]; }); }

  /* ---------------- reading a CSV ---------------- */
  function splitLine(line, d) { return line.split(d).map(function (s) { return s.trim().replace(/^"|"$/g, ''); }); }
  function cellValue(s) { return s === '' ? NaN : (isFinite(Number(s)) ? Number(s) : NaN); }
  // A header row is required. Columns: t (seconds), x or x1, x2, ... (states), u or u1, u2, ... (inputs);
  // any other column is ignored.
  function parseCsv(text) {
    var lines = text.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(function (l) { return l && l[0] !== '#'; });
    if (lines.length < 2) return null;
    var d = [',', ';', '\t'].map(function (c) { return [c, lines[0].split(c).length]; }).sort(function (a, b) { return b[1] - a[1]; })[0][0];
    var header = splitLine(lines[0], d), cols = header.map(function () { return []; });
    lines.slice(1).forEach(function (l) { var c = splitLine(l, d); header.forEach(function (_, j) { cols[j].push(cellValue(c[j] === undefined ? '' : c[j])); }); });
    return { header: header, cols: cols };
  }
  function guessRoles(header) {
    return header.map(function (h) { return /^t$/i.test(h) ? 'time' : /^x\d*$/i.test(h) ? 'state' : /^u\d*$/i.test(h) ? 'input' : 'ignore'; });
  }

  // Put the recording on a uniform grid of spacing dt. States are measured at an instant, so they are linearly
  // interpolated. An input is held between samples (the input in row k acts until row k+1), so on the grid it is the
  // average of that held signal over each interval: the average is what the plant actually received. Reading the input
  // at the grid instant instead would drop everything it did in between, and bias B at slow sample rates.
  function resample(t, states, inputs, dt) {
    var N = Math.floor((t[t.length - 1] - t[0]) / dt + 1e-9) + 1, tt = [], n;
    for (n = 0; n < N; n++) tt.push(t[0] + n * dt);
    function lerp(y) {
      var p = 0;
      return tt.map(function (x) { while (p + 1 < t.length - 1 && t[p + 1] < x) p++; var f = (x - t[p]) / (t[p + 1] - t[p]); return y[p] + Math.min(1, Math.max(0, f)) * (y[p + 1] - y[p]); });
    }
    function holdAverage(y) {
      var p = 0;
      return tt.map(function (x0) {
        var x1 = x0 + dt, acc = 0, a = x0;
        while (p + 1 < t.length && t[p + 1] <= x0) p++;
        for (var q = p; a < x1 - 1e-12; q++) {
          var end = q + 1 < t.length ? Math.min(t[q + 1], x1) : x1;       // the last input is held past the last sample
          if (end > a) { acc += y[q] * (end - a); a = end; }
          if (q + 1 >= t.length) break;
        }
        return acc / dt;
      });
    }
    return { t: tt, series: states.map(lerp).concat(inputs.map(holdAverage)) };
  }

  // Roles → uniform samples. Rows with a missing value are dropped; an uneven time base is resampled
  // onto the median spacing. `mult` (≥ 1) then slows the sample rate the model is fitted at: the
  // recording is resampled to mult × its own spacing, so the model, its poles and the LQR all live at that rate.
  function prepare(data, roles, mult) {
    var ti = roles.indexOf('time'); if (ti < 0) return { error: 'The header needs a column named t (time in seconds).' };
    var si = [], ui = [];
    roles.forEach(function (r, j) { if (r === 'state') si.push(j); else if (r === 'input') ui.push(j); });
    if (!si.length) return { error: 'The header needs a state column named x (or x1, x2, ...).' };
    if (!ui.length) return { error: 'The header needs an input column named u (or u1, u2, ...).' };
    var use = [ti].concat(si, ui), rows = [];
    data.cols[ti].forEach(function (_, k) { if (use.every(function (j) { return isFinite(data.cols[j][k]); })) rows.push(k); });
    rows.sort(function (a, b) { return data.cols[ti][a] - data.cols[ti][b]; });
    if (rows.length < 20) return { error: 'Need at least 20 rows with every column filled in.' };
    var t = rows.map(function (k) { return data.cols[ti][k]; }), diffs = [];
    for (var i = 1; i < t.length; i++) diffs.push(t[i] - t[i - 1]);
    if (diffs.some(function (d) { return d <= 0; })) return { error: 'Time must increase from row to row.' };
    var sorted = diffs.slice().sort(function (a, b) { return a - b; }), dt0 = sorted[Math.floor(sorted.length / 2)];
    var uneven = sorted[sorted.length - 1] > 1.05 * dt0 || sorted[0] < 0.95 * dt0;
    var series = use.slice(1).map(function (j) { return rows.map(function (k) { return data.cols[j][k]; }); });
    var dt = dt0 * Math.max(1, mult || 1), grid = (uneven || dt > dt0 * 1.0001) ? resample(t, series.slice(0, si.length), series.slice(si.length), dt) : { t: t, series: series };
    if (grid.t.length < 20) return { error: 'Too few samples at that sample time: choose a faster one.' };
    var X = grid.t.map(function (_, k) { return grid.series.slice(0, si.length).map(function (s) { return s[k]; }); });
    var U = grid.t.map(function (_, k) { return grid.series.slice(si.length).map(function (s) { return s[k]; }); });
    return { dt: dt, dt0: dt0, mult: dt / dt0, N0: rows.length, t: grid.t.map(function (v) { return v - grid.t[0]; }), X: X, U: U, uneven: uneven,
             sNames: si.map(function (j) { return data.header[j]; }), uNames: ui.map(function (j) { return data.header[j]; }) };
  }

  /* ---------------- the model ---------------- */
  function colRms(M) { return M[0].map(function (_, j) { var s = 0; M.forEach(function (r) { s += r[j] * r[j]; }); return Math.sqrt(s / M.length) || 1; }); }
  function colMean(M) { return M[0].map(function (_, j) { var s = 0; M.forEach(function (r) { s += r[j]; }); return s / M.length; }); }
  function centred(M, mu) { return M.map(function (r) { return r.map(function (v, j) { return v - mu[j]; }); }); }

  // x[k+1] = A x[k] + B u[k], least squares (with a whisper of ridge so a flat column cannot break it).
  function fitLinear(X, U, subtractMean) {
    var n = X[0].length, m = U[0].length, xm = subtractMean ? colMean(X) : new Array(n).fill(0), um = subtractMean ? colMean(U) : new Array(m).fill(0);
    var Xc = centred(X, xm), Uc = centred(U, um), K = Xc.length - 1;
    var Z = []; for (var k = 0; k < K; k++) Z.push(Xc[k].concat(Uc[k]));
    var Y = Xc.slice(1), ZtZ = mul(T(Z), Z), tr = 0; ZtZ.forEach(function (r, i) { tr += r[i]; });
    for (var i = 0; i < n + m; i++) ZtZ[i][i] += 1e-9 * (tr / (n + m) + 1e-12);
    var inver = inv(ZtZ); if (!inver) return { error: 'The columns are linearly dependent; drop or change one.' };
    var Th = T(mul(inver, mul(T(Z), Y)));              // n × (n+m)
    var A = Th.map(function (r) { return r.slice(0, n); }), B = Th.map(function (r) { return r.slice(n); });
    return modelStats(A, B, Xc, Uc, xm, um, 'ls');
  }
  // One-step predictions of x[k+1] from x[k], u[k], and 100·(1 − ‖error‖ / ‖y − mean y‖) per state.
  function modelStats(A, B, Xc, Uc, xm, um, method) {
    var n = A.length, m = B[0].length, K = Xc.length - 1, Y = Xc.slice(1), pred = [], k, j2;
    for (k = 0; k < K; k++) pred.push(A.map(function (r, a) { var s = 0; for (var q = 0; q < n; q++) s += r[q] * Xc[k][q]; for (var q2 = 0; q2 < m; q2++) s += B[a][q2] * Uc[k][q2]; return s; }));
    var fit = [];
    for (j2 = 0; j2 < n; j2++) {
      var my = 0, e2 = 0, v2 = 0; Y.forEach(function (r) { my += r[j2]; }); my /= Y.length;
      Y.forEach(function (r, k2) { e2 += Math.pow(r[j2] - pred[k2][j2], 2); v2 += Math.pow(r[j2] - my, 2); });
      fit.push(v2 > 0 ? 100 * (1 - Math.sqrt(e2 / v2)) : NaN);
    }
    return { A: A, B: B, xm: xm, um: um, pred: pred, Xc: Xc, Uc: Uc, fit: fit, eig: C.eig(A), method: method };
  }

  /* ---------------- Ho–Kalman from a recording ---------------- */
  // Ho–Kalman needs the impulse response (Markov parameters h_i = A^(i-1) B, since every state is measured). A
  // recording is not an impulse test, and it may come from a feedback loop, so they are found in two steps (OKID):
  //   1. regress each state on the p previous inputs AND states, y[k] = Σ P_i u[k-i] + Σ Q_i y[k-i]. This is a
  //      plain least-squares fit, and stays consistent when the input depended on the states (feedback);
  //   2. unfold it into the impulse response: h_1 = P_1, h_l = P_l + Σ_{i<l} Q_i h_{l-i} (P_l = 0 beyond p).
  // Then the Hankel matrix of h is split by SVD (its singular values show how many states the data supports) and the
  // realization (A_r, B_r, C_r) is read from the leading `order` of them. Every state is an output, so C_r maps the
  // realized state z back to x, and A = C_r A_r C_r⁺, B = C_r B_r is the model in the recording's own coordinates.
  function svdAny(M) {
    if (M.length >= M[0].length) return C.svd(M);
    var t = C.svd(T(M)); return { U: t.V, S: t.S, V: t.U };
  }
  function markov(X, U, p) {
    var n = X[0].length, m = U[0].length, K = X.length, rows = [], tg = [], k, i;
    for (k = p; k < K; k++) {
      var z = []; for (i = 1; i <= p; i++) z = z.concat(U[k - i], X[k - i]);
      rows.push(z); tg.push(X[k]);
    }
    var ZtZ = mul(T(rows), rows), q = ZtZ.length, tr = 0; ZtZ.forEach(function (r, a) { tr += r[a]; });
    for (i = 0; i < q; i++) ZtZ[i][i] += 1e-9 * (tr / q + 1e-12);
    var iv = inv(ZtZ); if (!iv) return null;
    var Th = T(mul(iv, mul(T(rows), tg)));              // n × (p (m+n)), column blocks [P_i (n×m), Q_i (n×n)]
    var P = [], Q = [];
    for (i = 0; i < p; i++) { P.push(Th.map(function (r) { return r.slice(i * (m + n), i * (m + n) + m); })); Q.push(Th.map(function (r) { return r.slice(i * (m + n) + m, (i + 1) * (m + n)); })); }
    return { P: P, Q: Q };
  }
  function fitHoKalman(X, U, order, subtractMean) {
    var n = X[0].length, m = U[0].length, xm = subtractMean ? colMean(X) : new Array(n).fill(0), um = subtractMean ? colMean(U) : new Array(m).fill(0);
    var Xc = centred(X, xm), Uc = centred(U, um), K = Xc.length;
    // Work in units of each signal's own spread, so a small but real state (an angle in radians next to a speed in m/s)
    // is not buried under the noise floor of the SVD; the model is scaled back at the end.
    var sx = colRms(Xc), su = colRms(Uc), Xs = Xc.map(function (r) { return r.map(function (v, j) { return v / sx[j]; }); }), Us = Uc.map(function (r) { return r.map(function (v, j) { return v / su[j]; }); });
    var p = Math.min(20, Math.floor(K / (3 * (n + m))));
    if (p < n + 2) return { error: 'Ho–Kalman needs more samples than this: about ' + 3 * (n + m) * (n + 2) + ' for ' + n + ' states and ' + m + ' inputs. Use a longer recording or a faster sample rate.' };
    // A big Hankel matrix (up to 40 block rows) averages the noise in the estimated impulse response; the observer
    // Markov parameters stop at p lags, and the rest of the response is unfolded from them.
    var al = Math.max(n + 2, Math.min(40, Math.floor(200 / Math.max(n, m)))), L = 2 * al, h = [], i, j, a, b, o;
    var okid = markov(Xs, Us, p); if (!okid) return { error: 'The columns are linearly dependent; drop or change one.' };
    for (var l = 1; l <= L + 1; l++) {                  // h[l-1] = h_l, an n × m matrix
      var hl = l <= p ? okid.P[l - 1].map(function (r) { return r.slice(); }) : zeros(n, m);
      for (i = 1; i <= Math.min(l - 1, p); i++) hl = add(hl, mul(okid.Q[i - 1], h[l - i - 1]));
      h.push(hl);
    }
    var nr = al * n, nc = al * m, H0 = zeros(nr, nc), H1 = zeros(nr, nc);
    for (i = 0; i < al; i++) for (j = 0; j < al; j++) for (o = 0; o < n; o++) for (a = 0; a < m; a++) { H0[i * n + o][j * m + a] = h[i + j][o][a]; H1[i * n + o][j * m + a] = h[i + j + 1][o][a]; }
    var sv = svdAny(H0), r = Math.max(1, Math.min(order || n, n, sv.S.length));
    var Ur = sv.U.map(function (row) { return row.slice(0, r); }), Vr = sv.V.map(function (row) { return row.slice(0, r); }), sq = sv.S.slice(0, r).map(function (v) { return Math.sqrt(Math.max(v, 1e-300)); });
    var Ar = mul(T(Ur), mul(H1, Vr)).map(function (row, ra) { return row.map(function (v, cb) { return v / (sq[ra] * sq[cb]); }); });
    var Br = zeros(r, m), Cr = zeros(n, r);
    for (a = 0; a < r; a++) { for (b = 0; b < m; b++) Br[a][b] = sq[a] * Vr[b][a]; for (o = 0; o < n; o++) Cr[o][a] = sq[a] * Ur[o][a]; }
    // C_r⁺ with a touch of ridge: a direction the noise has buried is shrunk, not blown up.
    var CtC = mul(T(Cr), Cr), mu = 1e-3 * Math.max.apply(null, CtC.map(function (row, q) { return row[q]; }));
    for (i = 0; i < r; i++) CtC[i][i] += mu;
    var Cp = mul(inv(CtC) || zeros(r, r), T(Cr));
    var As = mul(Cr, mul(Ar, Cp)), Bs = mul(Cr, Br);
    var Ax = As.map(function (row, i) { return row.map(function (v, j) { return v * sx[i] / sx[j]; }); }), Bx = Bs.map(function (row, i) { return row.map(function (v, j) { return v * sx[i] / su[j]; }); });
    var res = modelStats(Ax, Bx, Xc, Uc, xm, um, 'hk');
    res.sv = sv.S; res.order = r; res.maxOrder = n; res.p = p; res.markovLen = L;
    return res;
  }

  /* ---------------- LQR ---------------- */
  // Discrete LQR by running the Riccati recursion to its fixed point. K = (R + BᵀPB)⁻¹ BᵀPA, u = −Kx.
  function dlqr(A, B, Qd, Rd) {
    var n = A.length, Q = zeros(n, n), R = zeros(B[0].length, B[0].length), i;
    Qd.forEach(function (q, k) { Q[k][k] = q; }); Rd.forEach(function (r, k) { R[k][k] = r; });
    var P = Q.map(function (r) { return r.slice(); }), At = T(A), Bt = T(B), K = null;
    for (i = 0; i < 20000; i++) {
      var S = inv(add(R, mul(Bt, mul(P, B)))); if (!S) return null;
      K = mul(S, mul(Bt, mul(P, A)));
      var Pn = add(Q, add(mul(At, mul(P, A)), mul(At, mul(P, mul(B, K))), -1));
      var diff = 0, mx = 1e-12; Pn.forEach(function (r, a) { r.forEach(function (v, b) { diff = Math.max(diff, Math.abs(v - P[a][b])); mx = Math.max(mx, Math.abs(v)); }); });
      P = Pn; if (!isFinite(mx) || mx > 1e12) return null;
      if (diff < 1e-10 * mx) break;
    }
    var Acl = add(A, mul(B, K), -1), eig = C.eig(Acl);
    var stable = eig.every(function (z) { return Math.hypot(z[0], z[1]) < 1 - 1e-9; });
    return { K: K, P: P, Acl: Acl, eig: eig, stable: stable };
  }
  // Holding state j at r takes a steady state: (A − I) x_ss + B u_ss = 0 with x_ss[j] = r. This is linear in r, so solve it
  // once for r = 1: [A − I, B; e_jᵀ, 0] [x_ss; u_ss] = [0; 1]. With more than one input there are many answers; take the
  // one with the least input. Returns null when no steady state holds that state (the residual does not vanish).
  function steadyState(A, B, j) {
    var n = A.length, m = B[0].length, M = zeros(n + 1, n + m), i, k;
    for (i = 0; i < n; i++) { for (k = 0; k < n; k++) M[i][k] = A[i][k] - (i === k ? 1 : 0); for (k = 0; k < m; k++) M[i][n + k] = B[i][k]; }
    M[n][j] = 1;
    var MMt = mul(M, T(M)), tr = 0; MMt.forEach(function (r, a) { tr += r[a]; });
    for (i = 0; i <= n; i++) MMt[i][i] += 1e-12 * (tr / (n + 1) + 1e-12);
    var iv = inv(MMt); if (!iv) return null;
    var b = zeros(n + 1, 1); b[n][0] = 1;
    var z = mul(T(M), mul(iv, b)), back = mul(M, z), res = 0;
    for (i = 0; i <= n; i++) res = Math.max(res, Math.abs(back[i][0] - b[i][0]));
    if (res > 1e-6) return null;
    return { xss: z.slice(0, n).map(function (r) { return r[0]; }), uss: z.slice(n).map(function (r) { return r[0]; }) };
  }
  // LQR tracking of a reference r[k] on state j: u = u_ss r − K (x − x_ss r). Runs the model from x0; returns states and inputs.
  function track(A, B, K, ss, r, x0) {
    var x = x0.slice(), xs = [], us = [];
    r.forEach(function (rk) {
      var u = ss.uss.map(function (uu, a) { var e = 0; K[a].forEach(function (kk, i) { e += kk * (x[i] - ss.xss[i] * rk); }); return uu * rk - e; });
      xs.push(x); us.push(u);
      x = A.map(function (row, i) { var v = 0; row.forEach(function (aa, q) { v += aa * x[q]; }); B[i].forEach(function (bb, q) { v += bb * u[q]; }); return v; });
    });
    return { x: xs, u: us };
  }
  // Segment length for the tracking run: seven slowest closed-loop time constants, so each step settles in view.
  function segmentLength(lq, maxLen) {
    var rho = Math.max.apply(null, lq.eig.map(function (z) { return Math.hypot(z[0], z[1]); }));
    var tc = rho > 0 && rho < 1 ? -1 / Math.log(rho) : 20;
    return Math.max(10, Math.min(Math.floor(maxLen / 3), Math.ceil(7 * tc)));
  }
  // Free run of x[k+1] = M x[k] from x0.
  function run(M, x0, N) { var xs = [x0], x = x0; for (var k = 1; k < N; k++) { x = mul(M, colVec(x)).map(function (r) { return r[0]; }); xs.push(x); } return xs; }

  /* ---------------- an example recording: the cart-pole, balanced by LQR with a little dither ---------------- */
  function exampleCsv() {
    var LP = root.LabPlants || (typeof require !== 'undefined' ? require('./lab/lab-plants.js') : null), plant = LP && LP.cartpole; if (!plant || !C) return null;
    var p = Object.assign({}, plant.params), dt = 0.05, lin = C.linearize(plant, p), d = C.zohDiscretize(lin.A, lin.B, dt);
    var NOISE = [0.02, 0.05, 0.008, 0.04];                   // sensor noise σ per state (m, m/s, rad, rad/s): a few percent of each signal's swing
    var lq = dlqr(d.Phi, d.Gam, [1, 0.1, 10, 0.1], [0.1]), x = [0, 0, 0.08, 0], seed = 7, level = 0, hold = 0, out = ['t,x1,x2,x3,x4,u1'];
    function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
    for (var k = 0; k < 600; k++) {
      if (hold <= 0) { level = (rnd() < 0.5 ? -3 : 3); hold = 0.3 + 0.7 * rnd(); } hold -= dt;
      var u = Math.max(-15, Math.min(15, -lq.K[0].reduce(function (s, kk, i) { return s + kk * x[i]; }, 0) + level));
      out.push([(k * dt).toFixed(2)].concat(x.map(function (v, i) { return (v + NOISE[i] * C.gaussian(rnd)).toFixed(5); }), u.toFixed(4)).join(','));
      for (var s = 0; s < 4; s++) {                    // RK4, four substeps per sample
        var h = dt / 4, f = function (xx) { return plant.deriv(xx, [u], p); };
        var k1 = f(x), k2 = f(x.map(function (v, i) { return v + k1[i] * h / 2; })), k3 = f(x.map(function (v, i) { return v + k2[i] * h / 2; })), k4 = f(x.map(function (v, i) { return v + k3[i] * h; }));
        x = x.map(function (v, i) { return v + (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]) * h / 6; });
      }
    }
    return out.join('\n');
  }

  // How many directions of state space the input can move: the rank of [B AB ... A^(n-1)B], found by
  // Gram-Schmidt on unit columns after scaling each state by its spread (so units do not matter).
  function reachability(A, B, sd) {
    var n = A.length, s = sd || new Array(n).fill(1), i, k;
    var As = A.map(function (r, a) { return r.map(function (v, b) { return v * s[b] / s[a]; }); }), Bs = B.map(function (r, a) { return r.map(function (v) { return v / s[a]; }); });
    var basis = [], Pm = Bs, big = 0;
    for (k = 0; k < n; k++) {
      for (var c = 0; c < Pm[0].length; c++) {
        var v = Pm.map(function (r) { return r[c]; }), nrm = Math.sqrt(v.reduce(function (a, x) { return a + x * x; }, 0));
        big = Math.max(big, nrm); if (nrm < 1e-9 * Math.max(big, 1e-300) || nrm === 0) continue;
        v = v.map(function (x) { return x / nrm; });
        basis.forEach(function (b) { var d = b.reduce(function (a, x, q) { return a + x * v[q]; }, 0); v = v.map(function (x, q) { return x - d * b[q]; }); });
        var r2 = Math.sqrt(v.reduce(function (a, x) { return a + x * x; }, 0));
        if (r2 > 1e-6) basis.push(v.map(function (x) { return x / r2; }));
      }
      Pm = mul(As, Pm);
    }
    return { rank: Math.min(basis.length, n), n: n };
  }
  var FitCore = { reachability: reachability, parseCsv: parseCsv, guessRoles: guessRoles, prepare: prepare, fitLinear: fitLinear, fitHoKalman: fitHoKalman, dlqr: dlqr, steadyState: steadyState, track: track, segmentLength: segmentLength, run: run, exampleCsv: exampleCsv, mul: mul, T: T };
  if (typeof module !== 'undefined' && module.exports) module.exports = FitCore;
  root.FitCore = FitCore;

  /* ================= the page ================= */
  if (typeof document === 'undefined' || !document.getElementById('fit-root')) return;
  var $ = function (id) { return document.getElementById(id); };
  var S = { data: null, roles: [], mult: 1, subtractMean: true, qw: [], rw: [], prep: null, model: null, lq: null, trackIdx: 0, sd: [], ss: null, reach: null };
  var col = {};
  function cssVar(n, fb) { var v = getComputedStyle(document.documentElement).getPropertyValue(n).trim(); return v || fb; }
  function readColors() {
    col = { text: cssVar('--text', '#222'), muted: cssVar('--text-muted', '#666'), border: cssVar('--border', '#ddd'), strong: cssVar('--border-strong', '#bbb'),
            v1: cssVar('--viz-1', '#5a4fd6'), v2: cssVar('--viz-2', '#a58d12'), v3: cssVar('--viz-3', '#8a0f0f'), v4: cssVar('--viz-4', '#12a599') };
  }
  function fitCanvas(cv) {
    var dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    var bw = Math.max(1, Math.round(W * dpr)), bh = Math.max(1, Math.round(H * dpr));
    if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
    var ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    return { ctx: ctx, W: W, H: H };
  }
  function label(ctx, s, x, y, color, align, size) { ctx.fillStyle = color; ctx.font = (size || 11) + 'px system-ui, sans-serif'; ctx.textAlign = align || 'left'; ctx.textBaseline = 'top'; ctx.fillText(s, x, y); }
  function axisNum(v) { return Math.abs(v) >= 100 ? v.toFixed(0) : (+v.toFixed(1) === 0 ? 0 : v).toFixed(1); }   // plot axis ends: one decimal
  function num(v) { var a = Math.abs(v); return a === 0 ? '0' : a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : a >= 0.01 ? v.toFixed(2) : v.toExponential(1); }

  // Stacked lanes sharing a time axis. lane = { name, series: [{ x, y, color, dash, clip }] }; series with clip
  // do not set the lane's range (so an unstable open-loop run cannot flatten everything else).
  function lanes(c, list, title) {
    var ctx = c.ctx, x0 = 48, x1 = c.W - 10, top = 18, h = (c.H - top - 16) / list.length, tmax = 0;
    label(ctx, title, x0, 2, col.text, 'left', 11);
    list.forEach(function (l) { l.series.forEach(function (s) { tmax = Math.max(tmax, s.x[s.x.length - 1]); }); });
    list.forEach(function (l, i) {
      var y0 = top + i * h + 2, y1 = top + (i + 1) * h - 4, lo = Infinity, hi = -Infinity;
      l.series.forEach(function (s) { if (!s.clip) s.y.forEach(function (v) { if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }); });
      if (!isFinite(lo)) { lo = -1; hi = 1; } if (hi - lo < 1e-12) { lo -= 1; hi += 1; }
      var pad = 0.08 * (hi - lo); lo -= pad; hi += pad;
      var X = function (t) { return x0 + t / (tmax || 1) * (x1 - x0); }, Y = function (v) { return y1 - (Math.max(lo - 1e3 * (hi - lo), Math.min(hi + 1e3 * (hi - lo), v)) - lo) / (hi - lo) * (y1 - y0); };
      ctx.strokeStyle = col.border; ctx.lineWidth = 1; ctx.strokeRect(x0 + .5, y0 + .5, x1 - x0 - 1, y1 - y0 - 1);
      if (lo < 0 && hi > 0) { ctx.save(); ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x0, Y(0)); ctx.lineTo(x1, Y(0)); ctx.stroke(); ctx.restore(); }
      ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();
      l.series.forEach(function (s) {
        ctx.strokeStyle = s.color; ctx.lineWidth = s.dash ? 1.6 : 1.2; ctx.setLineDash(s.dash || []); ctx.beginPath();
        var started = false; s.x.forEach(function (t, k) { if (!isFinite(s.y[k])) return; if (started) ctx.lineTo(X(t), Y(s.y[k])); else { ctx.moveTo(X(t), Y(s.y[k])); started = true; } }); ctx.stroke();
      });
      ctx.restore();
      label(ctx, l.name, x0 + 4, y0 + 2, col.text, 'left', 11);
      label(ctx, axisNum(hi), x0 - 4, y0 - 1, col.muted, 'right', 9); label(ctx, axisNum(lo), x0 - 4, y1 - 9, col.muted, 'right', 9);
    });
    label(ctx, '0', x0, c.H - 13, col.muted, 'center', 9); label(ctx, num(tmax) + ' s', x1, c.H - 13, col.muted, 'right', 9);
  }
  function zplane(c, open, closed) {
    var ctx = c.ctx, all = open.concat(closed || []), big = Math.max.apply(null, all.map(function (z) { return Math.hypot(z[0], z[1]); })), cx0 = 0, cy0 = 0, h = Math.max(1.3, 1.1 * big), zoom = false;
    if (all.every(function (z) { return Math.hypot(z[0], z[1]) > 0.6; }) && big < 1.6) {     // poles crowd the unit circle: zoom in on them
      var pts = all.concat([[1, 0]]), lo = [Math.min.apply(null, pts.map(function (z) { return z[0]; })), Math.min.apply(null, pts.map(function (z) { return z[1]; }))], hi = [Math.max.apply(null, pts.map(function (z) { return z[0]; })), Math.max.apply(null, pts.map(function (z) { return z[1]; }))];
      cx0 = (lo[0] + hi[0]) / 2; cy0 = (lo[1] + hi[1]) / 2; h = Math.max(0.12, 0.65 * Math.max(hi[0] - lo[0], hi[1] - lo[1])); zoom = true;
    }
    var side = Math.max(40, Math.min(c.W - 20, c.H - 30)), cx = c.W / 2, cy = 18 + (c.H - 18) / 2, k = side / 2 / h;
    var X = function (re) { return cx + (re - cx0) * k; }, Y = function (im) { return cy - (im - cy0) * k; };
    label(ctx, 'Poles: model (×), with LQR (○)' + (zoom ? ', zoomed' : ''), 10, 2, col.text, 'left', 11);
    ctx.save(); ctx.beginPath(); ctx.rect(cx - side / 2, cy - side / 2, side, side); ctx.clip();
    ctx.strokeStyle = col.border; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx - side / 2, Y(0)); ctx.lineTo(cx + side / 2, Y(0)); ctx.moveTo(X(0), cy - side / 2); ctx.lineTo(X(0), cy + side / 2); ctx.stroke();
    ctx.strokeStyle = col.strong; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.arc(X(0), Y(0), k, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
    ctx.restore(); ctx.strokeStyle = col.border; ctx.strokeRect(cx - side / 2 + .5, cy - side / 2 + .5, side - 1, side - 1);
    label(ctx, 'unit circle (dashed)', cx - side / 2 + 4, cy + side / 2 - 14, col.muted, 'left', 9);
    label(ctx, num(cx0 - h) + ' … ' + num(cx0 + h), cx + side / 2 - 4, cy + side / 2 - 14, col.muted, 'right', 9);
    open.forEach(function (z) { var x = X(z[0]), y = Y(z[1]), bad = Math.hypot(z[0], z[1]) >= 1; ctx.strokeStyle = bad ? col.v3 : col.v1; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 5, y - 5); ctx.lineTo(x + 5, y + 5); ctx.moveTo(x - 5, y + 5); ctx.lineTo(x + 5, y - 5); ctx.stroke(); });
    (closed || []).forEach(function (z) { ctx.strokeStyle = col.v2; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X(z[0]), Y(z[1]), 5, 0, 2 * Math.PI); ctx.stroke(); });
  }

  function say(msg, bad) { var e = $('fit-msg'); e.textContent = msg || ''; e.className = 'fit-msg' + (bad ? ' bad' : ''); }
  function mat(M, d) { return M.map(function (r) { return r.map(function (v) { return (v >= 0 ? ' ' : '') + v.toFixed(d || 3); }).join('  '); }).join('\n'); }

  function load(text) {
    var data = parseCsv(text);
    if (!data || data.header.length < 3) { say('That does not look like a CSV with a header row t, x1, ..., u1, ...', true); return; }
    S.data = data; S.roles = guessRoles(data.header);
    analyze(true);
  }
  function buildWeights() {
    var box = $('fit-weights'); box.innerHTML = '';
    function slider(name, lg, onInput) {
      var g = document.createElement('div'), lb = document.createElement('label'), val = document.createElement('span'), inp = document.createElement('input');
      g.className = 'pid-group'; inp.type = 'range'; inp.min = -3; inp.max = 3; inp.step = 0.1; inp.value = lg; lb.textContent = name + ' '; lb.appendChild(val);
      var show = function () { val.textContent = num(Math.pow(10, inp.value)); }; show();
      inp.addEventListener('input', function () { show(); onInput(Math.pow(10, +inp.value)); });
      g.appendChild(lb); g.appendChild(inp); box.appendChild(g);
    }
    S.prep.sNames.forEach(function (nm, i) { slider('Q: ' + nm, Math.log10(S.qw[i]), function (v) { S.qw[i] = v; design(true); }); });
    S.prep.uNames.forEach(function (nm, i) { slider('R: ' + nm, Math.log10(S.rw[i]), function (v) { S.rw[i] = v; design(true); }); });
    var sel = $('fit-track'); sel.innerHTML = '';
    S.prep.sNames.forEach(function (nm, i) { var o = document.createElement('option'); o.value = i; o.textContent = nm; sel.appendChild(o); });
    sel.value = S.trackIdx;
  }

  function analyze(reset) {
    var prep = prepare(S.data, S.roles, 1); S.prep = null; S.model = null; S.lq = null; S.reach = null; S.ss = null;
    if (prep.error) { say(prep.error, true); stopSim(); draw(); return; }
    var n = prep.sNames.length, model = fitLinear(prep.X, prep.U, S.subtractMean);
    if (model.error) { say(model.error, true); stopSim(); draw(); return; }
    S.prep = prep; S.model = model; S.sd = colRms(model.Xc);
    if (reset || S.qw.length !== n || S.rw.length !== prep.uNames.length) {
      var sd = prep.X[0].map(function (_, j) { var m = colMean(prep.X)[j], s = 0; prep.X.forEach(function (r) { s += Math.pow(r[j] - m, 2); }); return Math.sqrt(s / prep.X.length) || 1; });
      S.qw = sd.map(function (s) { return 1 / (s * s); }); S.rw = prep.uNames.map(function () { return 1; });   // weight by 1 / spread, so units do not matter
      S.qw = S.qw.map(function (q) { return Math.pow(10, Math.max(-3, Math.min(3, Math.log10(q)))); });
      if (reset) S.trackIdx = 0;
      buildWeights();
    }
    S.reach = reachability(model.A, model.B, S.sd);
    $('fit-found').textContent = 'Found: t, ' + prep.sNames.join(', ') + ', ' + prep.uNames.join(', ');
    var r = S.reach, re = $('fit-reach');
    re.textContent = r.rank >= r.n ? 'Reachable: the input can move all ' + r.n + ' states.' : 'Some states may not be reachable: the input can move only ' + r.rank + ' of ' + r.n + ' directions in this model, so no controller can steer the rest.';
    re.className = 'fit-msg' + (r.rank < r.n ? ' bad' : '');
    var notes = [];
    if (prep.uneven) notes.push('The times are uneven, so the recording was resampled to its median spacing.');
    say(notes.join(' '));
    design();
  }
  function design(keepSim) {
    if (!S.model) return;
    S.lq = dlqr(S.model.A, S.model.B, S.qw, S.rw);
    S.ss = steadyState(S.model.A, S.model.B, Math.min(S.trackIdx, S.prep.sNames.length - 1));
    $('fit-ref').disabled = !S.ss; if (!keepSim || !sim) resetSim(); draw(); startSim();
  }

  /* ---------------- the live simulation: the fitted model, stepped in real time ---------------- */
  var sim = null, raf = 0, lastT = 0, owed = 0;
  function stopSim() { sim = null; if (raf) { cancelAnimationFrame(raf); raf = 0; } }
  function resetSim() {
    var P = S.prep; if (!P || !S.model) { sim = null; return; }
    var seg = S.lq && S.lq.stable ? segmentLength(S.lq, P.t.length) : 30;
    sim = { x: new Array(P.sNames.length).fill(0), win: Math.max(60, Math.min(600, 4 * seg)), hx: [], hu: [], hr: [], blown: 0 };
  }
  function stepSim() {
    var M = S.model, K = S.lq && S.lq.stable ? S.lq.K : null, x = sim.x, j = Math.min(S.trackIdx, x.length - 1), r = S.ss ? +$('fit-ref').value * S.sd[j] : 0, u;
    if (K && $('fit-ctrl').checked) {
      u = K.map(function (row, a) { var e = 0; row.forEach(function (kk, i) { e += kk * (x[i] - (S.ss ? S.ss.xss[i] * r : 0)); }); return (S.ss ? S.ss.uss[a] * r : 0) - e; });
    } else u = new Array(M.B[0].length).fill(0);
    sim.hx.push(x.slice()); sim.hu.push(u.slice()); sim.hr.push(r);
    if (sim.hx.length > sim.win) { sim.hx.shift(); sim.hu.shift(); sim.hr.shift(); }
    sim.x = M.A.map(function (row, i) { var v = 0; row.forEach(function (aa, q) { v += aa * x[q]; }); M.B[i].forEach(function (bb, q) { v += bb * u[q]; }); return v; });
    if (!sim.x.every(isFinite) || sim.x.some(function (v, i) { return Math.abs(v) > 1e6 * S.sd[i]; })) { sim.x = sim.x.map(function () { return 0; }); sim.blown = 120; }
    if (sim.blown) sim.blown--;
  }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!sim) return;
    owed += Math.min(0.1, (now - lastT) / 1000) * sim.win / 10;   // the window always spans about 10 s of real time
    lastT = now;
    for (var n = 0; owed >= 1 && n < 60; n++) { stepSim(); owed--; }
    if (owed > 60) owed = 0;
    drawSim();
  }
  function startSim() { if (!raf) { lastT = performance.now(); owed = 0; raf = requestAnimationFrame(frame); } }
  function push() {
    if (!sim) return;
    sim.x = sim.x.map(function (v, i) { return v + S.sd[i] * (Math.random() - 0.5) * 4; });
  }

  function drawSim() {
    var P = S.prep, M = S.model, c3 = fitCanvas($('fit-c3'));
    if (!P || !M || !sim) return;
    var n = P.sNames.length, j = Math.min(S.trackIdx, n - 1), pal = [col.v1, col.v2, col.v3, col.v4], ctrl = $('fit-ctrl').checked, ok = S.lq && S.lq.stable;
    if (!sim.hx.length) return;
    var tt = sim.hx.map(function (_, k) { return k * P.dt; });
    var L = P.sNames.map(function (nm, q) {
      var y = sim.hx.map(function (r) { return r[q]; }), wild = y.some(function (v) { return Math.abs(v) > 30 * S.sd[q]; });
      var ser = [{ x: tt, y: y, color: pal[q % 4], clip: wild }];
      if (q === j && S.ss && ctrl && ok) ser.unshift({ x: tt, y: sim.hr, color: col.muted, dash: [5, 3] });
      return { name: nm + (q === j && S.ss && ctrl && ok ? ' (tracked, reference dashed)' : ' (change from operating point)'), series: ser };
    });
    L.push({ name: P.uNames[0] + (ok && ctrl ? ' (LQR effort)' : ' (input)'), series: [{ x: tt, y: sim.hu.map(function (r) { return r[0]; }), color: col.v1 }] });
    lanes(c3, L, 'Live simulation of the fitted model' + (ok && ctrl ? ' under LQR' : ' with no control') + ' (time in model seconds)');
    var msg = !ok ? 'This LQR does not stabilize the model: raise a Q or lower R, or check the model.' : !S.ss ? 'No steady state holds ' + P.sNames[j] + ' constant, so it cannot be tracked: the controller only regulates. Pick another state.' : sim.blown ? 'The states ran away and were reset to the operating point.' : '';
    if (msg) label(c3.ctx, msg, c3.W - 12, c3.H - 30, col.v3, 'right', 11);
  }

  function draw() {
    readColors();
    var info = $('fit-info'), P = S.prep, M = S.model;
    // Height follows the number of lanes (set as a CSS variable, never from the pixel buffer).
    $('fit-c1').style.setProperty('--lanes', P ? P.sNames.length + P.uNames.length : 4);
    $('fit-c2').parentNode.style.setProperty('--lanes', P ? P.sNames.length + 1 : 4);
    var c1 = fitCanvas($('fit-c1')), c2 = fitCanvas($('fit-c2'));
    if (!P || !M) {
      label(c1.ctx, 'Load a CSV or press "Load the example".', 14, 14, col.muted, 'left', 13); info.textContent = ''; fitCanvas($('fit-c3')); return;
    }
    var pal = [col.v1, col.v2, col.v3, col.v4], t1 = P.t.slice(1);
    // 1. data and the model's one-step predictions
    var L = P.sNames.map(function (nm, j) {
      return { name: nm + '  (fit ' + num(M.fit[j]) + '%)', series: [{ x: P.t, y: P.X.map(function (r) { return r[j]; }), color: col.muted }, { x: t1, y: M.pred.map(function (r) { return r[j] + M.xm[j]; }), color: pal[j % 4], dash: [4, 3] }] };
    }).concat(P.uNames.map(function (nm, j) { return { name: nm + ' (input)', series: [{ x: P.t, y: P.U.map(function (r) { return r[j]; }), color: col.v2 }] }; }));
    lanes(c1, L, 'Data (gray) and the model\'s one-step prediction (dashed)');
    // 2. poles
    zplane(c2, M.eig, S.lq ? S.lq.eig : null);
    // 3. the live simulation (drawn every frame by drawSim)
    drawSim();
    var lines = ['Model  x[k+1] = A x[k] + B u[k]   (least squares; sample time ' + num(P.dt) + ' s, ' + P.t.length + ' samples)', '', 'A =\n' + mat(M.A), '', 'B =\n' + mat(M.B)];
    var rho = Math.max.apply(null, M.eig.map(function (z) { return Math.hypot(z[0], z[1]); }));
    lines.push('', 'Model poles: largest |z| = ' + rho.toFixed(3) + (rho >= 1 ? '  (open loop unstable)' : '  (open loop stable)'));
    if (S.reach) lines.push('Reachable directions: ' + S.reach.rank + ' of ' + S.reach.n);
    if (S.lq) lines.push('', 'LQR gain  u = −K x\nK =\n' + mat(S.lq.K), 'Closed-loop largest |z| = ' + Math.max.apply(null, S.lq.eig.map(function (z) { return Math.hypot(z[0], z[1]); })).toFixed(3));
    info.textContent = lines.join('\n');
  }

  function init() {
    function read(f) { var r = new FileReader(); r.onload = function () { load(String(r.result)); }; r.readAsText(f); }
    $('fit-file').addEventListener('change', function (e) { var f = e.target.files[0]; if (f) read(f); });
    var dz = $('fit-drop');
    ['dragover', 'dragenter'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { dz.addEventListener(ev, function () { dz.classList.remove('over'); }); });
    dz.addEventListener('drop', function (e) { e.preventDefault(); var f = e.dataTransfer.files[0]; if (f) read(f); });
    $('fit-example').addEventListener('click', function () { var t = exampleCsv(); if (t) load(t); });
    $('fit-mean').addEventListener('change', function (e) { S.subtractMean = e.target.checked; if (S.data) analyze(true); });
    $('fit-track').addEventListener('change', function (e) { S.trackIdx = +e.target.value; $('fit-ref').value = 0; if (S.model) design(); });
    $('fit-ctrl').addEventListener('change', function () { drawSim(); });
    $('fit-push').addEventListener('click', push);
    $('fit-reset').addEventListener('click', function () { $('fit-ref').value = 0; resetSim(); });
    $('fit-csv').addEventListener('click', function () { var t = exampleCsv(); if (!t) return; var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([t], { type: 'text/csv' })); a.download = 'cartpole-example.csv'; document.body.appendChild(a); a.click(); a.remove(); });
    window.addEventListener('resize', draw);
    new MutationObserver(draw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    // Open on the example, so the plots and the live simulation show what the page does before anything is uploaded.
    var ex = exampleCsv();
    if (ex) load(ex); else draw();
  }
  init();
})(typeof window !== 'undefined' ? window : this);
