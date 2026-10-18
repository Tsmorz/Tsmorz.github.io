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
  function cellValue(s) {
    if (s === '') return NaN;
    var n = Number(s); if (isFinite(n)) return n;
    var t = Date.parse(s); return isFinite(t) ? t / 1000 : NaN;     // a timestamp becomes seconds
  }
  function parseCsv(text) {
    var lines = text.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(function (l) { return l && l[0] !== '#'; });
    if (lines.length < 2) return null;
    var d = [',', ';', '\t'].map(function (c) { return [c, lines[0].split(c).length]; }).sort(function (a, b) { return b[1] - a[1]; })[0][0];
    var first = splitLine(lines[0], d), hasHeader = first.some(function (s) { return !isFinite(Number(s)) && !isFinite(Date.parse(s)); }) || first.every(function (s) { return s === '' || !isFinite(Number(s)); });
    var header = hasHeader ? first.map(function (s, i) { return s || 'col' + (i + 1); }) : first.map(function (_, i) { return 'col' + (i + 1); });
    var cols = header.map(function () { return []; });
    lines.slice(hasHeader ? 1 : 0).forEach(function (l) { var c = splitLine(l, d); header.forEach(function (_, j) { cols[j].push(cellValue(c[j] === undefined ? '' : c[j])); }); });
    return { header: header, cols: cols };
  }
  var TIME_RE = /^(t|time|timestamp|stamp|ts|secs?|seconds?)(\b|_)/i, INPUT_RE = /^(u\d*|u_|in(put)?|cmd|command|force|torque|voltage|thrust|ctrl|action)(\b|_|\d)/i, SKIP_RE = /^(id|index|idx|n|#)$/i;
  function guessRoles(header, cols) {
    var haveTime = false;
    return header.map(function (h, j) {
      if (SKIP_RE.test(h)) return 'ignore';
      if (!haveTime && (TIME_RE.test(h + ' ') || (j === 0 && cols[j].every(function (v, i) { return isFinite(v) && (i === 0 || v > cols[j][i - 1]); })))) { haveTime = true; return 'time'; }
      return INPUT_RE.test(h) ? 'input' : 'state';
    });
  }

  // Linear interpolation of each series (sampled at times t) onto a uniform grid of spacing dt.
  function resample(t, series, dt) {
    var N = Math.floor((t[t.length - 1] - t[0]) / dt + 1e-9) + 1, tt = [], p = 0, n;
    for (n = 0; n < N; n++) tt.push(t[0] + n * dt);
    return { t: tt, series: series.map(function (y) { p = 0; return tt.map(function (x) { while (p + 1 < t.length - 1 && t[p + 1] < x) p++; var f = (x - t[p]) / (t[p + 1] - t[p]); return y[p] + Math.min(1, Math.max(0, f)) * (y[p + 1] - y[p]); }); }) };
  }

  // Roles → uniform samples. Rows with a missing value are dropped; an uneven time base is resampled
  // onto the median spacing. `mult` (≥ 1) then slows the sample rate the model is fitted at: the
  // recording is resampled to mult × its own spacing, so the model, its poles and the LQR all live at that rate.
  function prepare(data, roles, tScale, mult) {
    var ti = roles.indexOf('time'); if (ti < 0) return { error: 'Pick one column as Time.' };
    var si = [], ui = [];
    roles.forEach(function (r, j) { if (r === 'state') si.push(j); else if (r === 'input') ui.push(j); });
    if (!si.length) return { error: 'Pick at least one State column.' };
    if (!ui.length) return { error: 'Pick at least one Input column.' };
    var use = [ti].concat(si, ui), rows = [];
    data.cols[ti].forEach(function (_, k) { if (use.every(function (j) { return isFinite(data.cols[j][k]); })) rows.push(k); });
    rows.sort(function (a, b) { return data.cols[ti][a] - data.cols[ti][b]; });
    if (rows.length < 20) return { error: 'Need at least 20 rows with every column filled in.' };
    var t = rows.map(function (k) { return data.cols[ti][k] * tScale; }), diffs = [];
    for (var i = 1; i < t.length; i++) diffs.push(t[i] - t[i - 1]);
    if (diffs.some(function (d) { return d <= 0; })) return { error: 'Time must increase from row to row.' };
    var sorted = diffs.slice().sort(function (a, b) { return a - b; }), dt0 = sorted[Math.floor(sorted.length / 2)];
    var uneven = sorted[sorted.length - 1] > 1.05 * dt0 || sorted[0] < 0.95 * dt0;
    var series = use.slice(1).map(function (j) { return rows.map(function (k) { return data.cols[j][k]; }); });
    var dt = dt0 * Math.max(1, mult || 1), grid = (uneven || dt > dt0 * 1.0001) ? resample(t, series, dt) : { t: t, series: series };
    if (grid.t.length < 20) return { error: 'Too few samples at that sample time: choose a faster one.' };
    var X = grid.t.map(function (_, k) { return grid.series.slice(0, si.length).map(function (s) { return s[k]; }); });
    var U = grid.t.map(function (_, k) { return grid.series.slice(si.length).map(function (s) { return s[k]; }); });
    return { dt: dt, dt0: dt0, t: grid.t.map(function (v) { return v - grid.t[0]; }), X: X, U: U, uneven: uneven,
             sNames: si.map(function (j) { return data.header[j]; }), uNames: ui.map(function (j) { return data.header[j]; }) };
  }

  /* ---------------- the model ---------------- */
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
    var pred = Z.map(function (z) { return A.map(function (r, a) { var s = 0; for (var q = 0; q < n; q++) s += r[q] * z[q]; for (var q2 = 0; q2 < m; q2++) s += B[a][q2] * z[n + q2]; return s; }); });
    var fit = [], j2;
    for (j2 = 0; j2 < n; j2++) {                       // 100·(1 − ‖error‖ / ‖y − mean y‖), per state
      var my = 0, e2 = 0, v2 = 0; Y.forEach(function (r) { my += r[j2]; }); my /= Y.length;
      Y.forEach(function (r, k2) { e2 += Math.pow(r[j2] - pred[k2][j2], 2); v2 += Math.pow(r[j2] - my, 2); });
      fit.push(v2 > 0 ? 100 * (1 - Math.sqrt(e2 / v2)) : NaN);
    }
    return { A: A, B: B, xm: xm, um: um, pred: pred, Xc: Xc, Uc: Uc, fit: fit, eig: C.eig(A) };
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
  // Free run of x[k+1] = M x[k] from x0.
  function run(M, x0, N) { var xs = [x0], x = x0; for (var k = 1; k < N; k++) { x = mul(M, colVec(x)).map(function (r) { return r[0]; }); xs.push(x); } return xs; }

  /* ---------------- an example recording: the cart-pole, balanced by LQR with a little dither ---------------- */
  function exampleCsv() {
    var LP = root.LabPlants || (typeof require !== 'undefined' ? require('./lab/lab-plants.js') : null), plant = LP && LP.cartpole; if (!plant || !C) return null;
    var p = Object.assign({}, plant.params), dt = 0.05, lin = C.linearize(plant, p), d = C.zohDiscretize(lin.A, lin.B, dt);
    var lq = dlqr(d.Phi, d.Gam, [1, 0.1, 10, 0.1], [0.1]), x = [0, 0, 0.08, 0], seed = 7, level = 0, hold = 0, out = ['t,x,x_dot,theta,theta_dot,force'];
    function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
    for (var k = 0; k < 600; k++) {
      if (hold <= 0) { level = (rnd() < 0.5 ? -2 : 2); hold = 0.3 + 0.7 * rnd(); } hold -= dt;
      var u = Math.max(-10, Math.min(10, -lq.K[0].reduce(function (s, kk, i) { return s + kk * x[i]; }, 0) + level));
      out.push([(k * dt).toFixed(2)].concat(x.map(function (v) { return (v + 0.002 * C.gaussian(rnd)).toFixed(5); }), u.toFixed(4)).join(','));
      for (var s = 0; s < 4; s++) {                    // RK4, four substeps per sample
        var h = dt / 4, f = function (xx) { return plant.deriv(xx, [u], p); };
        var k1 = f(x), k2 = f(x.map(function (v, i) { return v + k1[i] * h / 2; })), k3 = f(x.map(function (v, i) { return v + k2[i] * h / 2; })), k4 = f(x.map(function (v, i) { return v + k3[i] * h; }));
        x = x.map(function (v, i) { return v + (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]) * h / 6; });
      }
    }
    return out.join('\n');
  }

  var FitCore = { parseCsv: parseCsv, guessRoles: guessRoles, prepare: prepare, fitLinear: fitLinear, dlqr: dlqr, run: run, exampleCsv: exampleCsv, mul: mul, T: T };
  if (typeof module !== 'undefined' && module.exports) module.exports = FitCore;
  root.FitCore = FitCore;

  /* ================= the page ================= */
  if (typeof document === 'undefined' || !document.getElementById('fit-root')) return;
  var $ = function (id) { return document.getElementById(id); };
  var S = { data: null, roles: [], tScale: 1, mult: 1, subtractMean: true, qw: [], rw: 0.1, prep: null, model: null, lq: null };
  var col = {};
  function cssVar(n, fb) { var v = getComputedStyle(document.documentElement).getPropertyValue(n).trim(); return v || fb; }
  function readColors() {
    col = { text: cssVar('--text', '#222'), muted: cssVar('--text-muted', '#666'), border: cssVar('--border', '#ddd'), strong: cssVar('--border-strong', '#bbb'),
            v1: cssVar('--viz-1', '#5a4fd6'), v2: cssVar('--viz-2', '#4a9410'), v3: cssVar('--viz-3', '#c0679a'), v4: cssVar('--viz-4', '#3b9ad6') };
  }
  function fitCanvas(cv) {
    var dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    var bw = Math.max(1, Math.round(W * dpr)), bh = Math.max(1, Math.round(H * dpr));
    if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
    var ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    return { ctx: ctx, W: W, H: H };
  }
  function label(ctx, s, x, y, color, align, size) { ctx.fillStyle = color; ctx.font = (size || 11) + 'px system-ui, sans-serif'; ctx.textAlign = align || 'left'; ctx.textBaseline = 'top'; ctx.fillText(s, x, y); }
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
      label(ctx, num(hi), x0 - 4, y0 - 1, col.muted, 'right', 9); label(ctx, num(lo), x0 - 4, y1 - 9, col.muted, 'right', 9);
    });
    label(ctx, '0', x0, c.H - 13, col.muted, 'center', 9); label(ctx, num(tmax) + ' s', x1, c.H - 13, col.muted, 'right', 9);
  }
  function zplane(c, open, closed) {
    var ctx = c.ctx, R = Math.max(1.3, 1.1 * Math.max.apply(null, open.concat(closed || []).map(function (z) { return Math.hypot(z[0], z[1]); })));
    var side = Math.max(40, Math.min(c.W - 20, c.H - 30)), cx = c.W / 2, cy = 18 + (c.H - 18) / 2, k = side / 2 / R;
    label(ctx, 'Poles: model (×), with LQR (○), unit circle', 10, 2, col.text, 'left', 11);
    ctx.strokeStyle = col.border; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx - R * k, cy); ctx.lineTo(cx + R * k, cy); ctx.moveTo(cx, cy - R * k); ctx.lineTo(cx, cy + R * k); ctx.stroke();
    ctx.strokeStyle = col.strong; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.arc(cx, cy, k, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
    open.forEach(function (z) { var x = cx + z[0] * k, y = cy - z[1] * k, bad = Math.hypot(z[0], z[1]) >= 1; ctx.strokeStyle = bad ? col.v3 : col.v1; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 5, y - 5); ctx.lineTo(x + 5, y + 5); ctx.moveTo(x - 5, y + 5); ctx.lineTo(x + 5, y - 5); ctx.stroke(); });
    (closed || []).forEach(function (z) { ctx.strokeStyle = col.v2; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx + z[0] * k, cy - z[1] * k, 5, 0, 2 * Math.PI); ctx.stroke(); });
  }

  function say(msg, bad) { var e = $('fit-msg'); e.textContent = msg || ''; e.className = 'fit-msg' + (bad ? ' bad' : ''); }
  function mat(M, d) { return M.map(function (r) { return r.map(function (v) { return (v >= 0 ? ' ' : '') + v.toFixed(d || 3); }).join('  '); }).join('\n'); }

  function load(text) {
    var data = parseCsv(text);
    if (!data || data.header.length < 3) { say('That does not look like a CSV with a time column, states and inputs.', true); return; }
    S.data = data; S.roles = guessRoles(data.header, data.cols);
    buildRoles(); analyze(true);
  }
  function buildRoles() {
    var box = $('fit-roles'); box.innerHTML = '';
    S.data.header.forEach(function (h, j) {
      var row = document.createElement('label'), sel = document.createElement('select');
      row.className = 'fit-role'; row.appendChild(document.createTextNode(h + ' '));
      [['time', 'Time'], ['state', 'State'], ['input', 'Input'], ['ignore', 'Ignore']].forEach(function (o) { var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; sel.appendChild(op); });
      sel.value = S.roles[j];
      sel.addEventListener('change', function () { if (sel.value === 'time') S.roles = S.roles.map(function (r) { return r === 'time' ? 'ignore' : r; }); S.roles[j] = sel.value; buildRoles(); analyze(true); });
      row.appendChild(sel); box.appendChild(row);
    });
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
    S.prep.sNames.forEach(function (nm, i) { slider('Q: ' + nm, Math.log10(S.qw[i]), function (v) { S.qw[i] = v; design(); }); });
    S.prep.uNames.forEach(function (nm, i) { slider('R: ' + nm, Math.log10(S.rw[i]), function (v) { S.rw[i] = v; design(); }); });
  }

  // The sample time the model is fitted at: the recording's own, up to 20 times slower.
  function buildRate(prep) {
    var box = $('fit-rate'), inp = box.querySelector('input'), val = box.querySelector('.fit-rate-val');
    inp.value = Math.log10(S.mult) * 100; box.hidden = false;
    val.textContent = num(prep.dt) + ' s  (' + num(1 / prep.dt) + ' Hz, every ' + (S.mult < 1.005 ? '1st' : num(S.mult) + '×') + ' sample)';
  }
  function analyze(reset) {
    if (reset) S.mult = 1;
    var prep = prepare(S.data, S.roles, S.tScale, S.mult); S.prep = null; S.model = null; S.lq = null;
    if (prep.error) { say(prep.error, true); draw(); return; }
    buildRate(prep);
    var model = fitLinear(prep.X, prep.U, S.subtractMean);
    if (model.error) { say(model.error, true); draw(); return; }
    S.prep = prep; S.model = model;
    if (reset || S.qw.length !== prep.sNames.length || S.rw.length !== prep.uNames.length) {
      var sd = prep.X[0].map(function (_, j) { var m = colMean(prep.X)[j], s = 0; prep.X.forEach(function (r) { s += Math.pow(r[j] - m, 2); }); return Math.sqrt(s / prep.X.length) || 1; });
      S.qw = sd.map(function (s) { return 1 / (s * s); }); S.rw = prep.uNames.map(function () { return 1; });   // weight by 1 / spread, so units do not matter
      S.qw = S.qw.map(function (q) { return Math.pow(10, Math.max(-3, Math.min(3, Math.log10(q)))); });
      buildWeights();
    }
    say(prep.uneven || S.mult > 1 ? 'Resampled to ' + num(prep.dt) + ' s (recorded at ' + num(prep.dt0) + ' s, ' + num(1 / prep.dt) + ' Hz fit).' : '');
    design();
  }
  function design() {
    if (!S.model) return;
    S.lq = dlqr(S.model.A, S.model.B, S.qw, S.rw); draw();
  }

  function draw() {
    readColors();
    var info = $('fit-info'), P = S.prep, M = S.model, c1 = fitCanvas($('fit-c1')), c2 = fitCanvas($('fit-c2')), c3 = fitCanvas($('fit-c3'));
    if (!P || !M) {
      label(c1.ctx, 'Load a CSV or press "Load an example".', 14, 14, col.muted, 'left', 13); info.textContent = ''; return;
    }
    var n = P.sNames.length, m = P.uNames.length, K = P.t.length - 1, t1 = P.t.slice(1), pal = [col.v1, col.v2, col.v3, col.v4];
    // 1. data and the model's one-step predictions
    var L = P.sNames.map(function (nm, j) {
      return { name: nm + '  (fit ' + num(M.fit[j]) + '%)', series: [{ x: P.t, y: P.X.map(function (r) { return r[j]; }), color: col.muted }, { x: t1, y: M.pred.map(function (r) { return r[j] + M.xm[j]; }), color: pal[j % 4], dash: [5, 3] }] };
    }).concat(P.uNames.map(function (nm, j) { return { name: nm + ' (input)', series: [{ x: P.t, y: P.U.map(function (r) { return r[j]; }), color: col.v2 }] }; }));
    lanes(c1, L, 'Data (grey) and the model\'s one-step prediction (dashed)');
    // 2. poles
    zplane(c2, M.eig, S.lq ? S.lq.eig : null);
    // 3. closed loop on the model
    if (S.lq && S.lq.stable) {
      var sd = P.X[0].map(function (_, j) { var s = 0; M.Xc.forEach(function (r) { s += r[j] * r[j]; }); return Math.sqrt(s / M.Xc.length); });
      var x0 = M.Xc[0].map(function (v, j) { return Math.abs(v) < 0.1 * sd[j] ? sd[j] : v; }), N = Math.min(P.t.length, 200), tt = P.t.slice(0, N);
      var cl = run(S.lq.Acl, x0, N), ol = run(M.A, x0, N), uu = cl.map(function (x) { return -S.lq.K[0].reduce(function (s, kk, i) { return s + kk * x[i]; }, 0); });
      var L3 = P.sNames.map(function (nm, j) { return { name: nm + ' (change from rest)', series: [{ x: tt, y: ol.map(function (r) { return r[j]; }), color: col.v3, dash: [5, 3], clip: true }, { x: tt, y: cl.map(function (r) { return r[j]; }), color: col.v2 }] }; });
      L3.push({ name: P.uNames[0] + ' (LQR effort)', series: [{ x: tt, y: uu, color: col.v1 }] });
      lanes(c3, L3, 'LQR on the model: with control (green), without (pink dashed)');
    } else {
      label(c3.ctx, S.lq ? 'This LQR does not stabilise the model: raise a Q or lower R, or check the model.' : 'No LQR: the model is not stabilisable (or the data is too flat).', 12, 14, col.v3, 'left', 12);
    }
    var lines = ['Model  x[k+1] = A x[k] + B u[k]   (sample time ' + num(P.dt) + ' s, ' + P.t.length + ' samples)', '', 'A =\n' + mat(M.A), '', 'B =\n' + mat(M.B)];
    var rho = Math.max.apply(null, M.eig.map(function (z) { return Math.hypot(z[0], z[1]); }));
    lines.push('', 'Model poles: largest |z| = ' + rho.toFixed(3) + (rho >= 1 ? '  (open loop unstable)' : '  (open loop stable)'));
    if (S.lq) lines.push('', 'LQR gain  u = −K x\nK =\n' + mat(S.lq.K), 'Closed-loop largest |z| = ' + Math.max.apply(null, S.lq.eig.map(function (z) { return Math.hypot(z[0], z[1]); })).toFixed(3));
    info.textContent = lines.join('\n');
  }

  function init() {
    $('fit-file').addEventListener('change', function (e) { var f = e.target.files[0]; if (!f) return; var r = new FileReader(); r.onload = function () { load(String(r.result)); }; r.readAsText(f); });
    var dz = $('fit-drop');
    ['dragover', 'dragenter'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { dz.addEventListener(ev, function () { dz.classList.remove('over'); }); });
    dz.addEventListener('drop', function (e) { e.preventDefault(); var f = e.dataTransfer.files[0]; if (!f) return; var r = new FileReader(); r.onload = function () { load(String(r.result)); }; r.readAsText(f); });
    $('fit-example').addEventListener('click', function () { var t = exampleCsv(); if (t) load(t); });
    $('fit-rate').querySelector('input').addEventListener('input', function (e) { S.mult = Math.pow(10, e.target.value / 100); if (S.data) analyze(false); });
    $('fit-tunit').addEventListener('change', function (e) { S.tScale = +e.target.value; if (S.data) analyze(true); });
    $('fit-mean').addEventListener('change', function (e) { S.subtractMean = e.target.checked; if (S.data) analyze(true); });
    $('fit-csv').addEventListener('click', function () { var t = exampleCsv(); if (!t) return; var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([t], { type: 'text/csv' })); a.download = 'cartpole-example.csv'; document.body.appendChild(a); a.click(); a.remove(); });
    window.addEventListener('resize', draw);
    new MutationObserver(draw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    draw();
  }
  init();
})(typeof window !== 'undefined' ? window : this);
