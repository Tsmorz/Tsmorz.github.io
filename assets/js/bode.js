// /controls/bode/ — frequency-response demos. Three tabs share one idea: shake a system
// with a sine wave, watch what comes back, and plot it against frequency.
//   Intro: the mass-spring-damper from /controls/ on its own (open loop, G(s)).
//   PID:   the same plant inside the PID loop, cut open at the plant input (L = C·G·delay).
//   LQR:   the cart-pole's state-feedback loop, cut open at the force input (L = K(sI−A)⁻¹B).
// BodeCore (no DOM, Node-testable via script/test-bode) holds the maths: complex
// arithmetic, the plants, frequency response, margins, a Nyquist stability count and
// the step responses. The page part below draws it. Plant constants must match
// controls.js — script/test-bode checks the cart-pole matrices against the ones printed
// on /controls/.
(function (root) {
  'use strict';

  /* ================================================================
     BodeCore — maths only
  ================================================================ */

  // Complex numbers as [re, im].
  function cadd(a, b) { return [a[0] + b[0], a[1] + b[1]]; }
  function csub(a, b) { return [a[0] - b[0], a[1] - b[1]]; }
  function cmul(a, b) { return [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]]; }
  function cdiv(a, b) {
    var d = b[0] * b[0] + b[1] * b[1];
    return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
  }
  function cscale(a, k) { return [a[0] * k, a[1] * k]; }
  function cabs(a) { return Math.hypot(a[0], a[1]); }
  function carg(a) { return Math.atan2(a[1], a[0]); }
  function cexp(a) { var m = Math.exp(a[0]); return [m * Math.cos(a[1]), m * Math.sin(a[1])]; }

  // Wrap an angle in degrees into (−180, 180].
  function wrap180(d) { d = ((d + 180) % 360 + 360) % 360 - 180; return d === -180 ? 180 : d; }

  function logspace(a, b, n) {
    var la = Math.log10(a), lb = Math.log10(b), out = new Array(n);
    for (var i = 0; i < n; i++) out[i] = Math.pow(10, la + (lb - la) * i / (n - 1));
    return out;
  }

  /* ---- Plants (same numbers as controls.js) ---- */

  // Mass-spring-damper: M ẍ + c ẋ + k x = F.  ζ ≈ 0.1, natural frequency 2 rad/s.
  var MSD = { M: 1, k: 4, c: 0.4 };

  function msdG(s) {
    var den = cadd(cadd(cscale(cmul(s, s), MSD.M), cscale(s, MSD.c)), [MSD.k, 0]);
    return cdiv([1, 0], den);
  }

  // Cart-pole linearised about upright. state = [x, ẋ, θ, θ̇], input F (N).
  var CP = { Mc: 0.3, m: 0.3, l: 1.5, b: 0.8, g: 9.81 };
  var CP_LQR = [3.1, 5.9, 43.5, 18.1];   // controls.js LQR_GAINS (kx, kẋ, kθ, kθ̇); F = k·state

  function cartPoleAB() {
    var tot = CP.Mc + CP.m;
    var den = CP.l * (4 / 3 - CP.m / tot);       // θ̈ denominator at θ = 0
    var mlt = CP.m * CP.l / tot;
    // θ̈ = [g θ − (F − b ẋ)/tot] / den
    var a_th = CP.g / den, a_v = CP.b / tot / den, b_th = -1 / tot / den;
    // ẍ = (F − b ẋ)/tot − mlt θ̈
    var x_v = -CP.b / tot - mlt * a_v, x_th = -mlt * a_th, b_x = 1 / tot - mlt * b_th;
    return {
      A: [[0, 1, 0, 0], [0, x_v, x_th, 0], [0, 0, 0, 1], [0, a_v, a_th, 0]],
      B: [0, b_x, 0, b_th]
    };
  }
  var CP_AB = cartPoleAB();

  // Solve (complex) M x = v by Gaussian elimination with partial pivoting.
  function csolve(M, v) {
    var n = v.length, i, j, k;
    var a = M.map(function (row, r) { return row.slice().concat([v[r]]); });
    for (k = 0; k < n; k++) {
      var p = k, best = cabs(a[k][k]);
      for (i = k + 1; i < n; i++) { var m = cabs(a[i][k]); if (m > best) { best = m; p = i; } }
      if (p !== k) { var t = a[p]; a[p] = a[k]; a[k] = t; }
      for (i = k + 1; i < n; i++) {
        var f = cdiv(a[i][k], a[k][k]);
        for (j = k; j <= n; j++) a[i][j] = csub(a[i][j], cmul(f, a[k][j]));
      }
    }
    var x = new Array(n);
    for (i = n - 1; i >= 0; i--) {
      var acc = a[i][n];
      for (j = i + 1; j < n; j++) acc = csub(acc, cmul(a[i][j], x[j]));
      x[i] = cdiv(acc, a[i][i]);
    }
    return x;
  }

  // (sI − A)⁻¹ B for the cart-pole: each state's response to the force.
  function cartP(s) {
    var A = CP_AB.A, n = 4, M = [], i, j;
    for (i = 0; i < n; i++) {
      M.push([]);
      for (j = 0; j < n; j++) M[i].push(i === j ? [s[0] - A[i][j], s[1]] : [-A[i][j], 0]);
    }
    return csolve(M, CP_AB.B.map(function (b) { return [b, 0]; }));
  }

  function delayTerm(s, T) { return T > 0 ? cexp([-s[0] * T, -s[1] * T]) : [1, 0]; }

  // Loop transfer functions, in the negative-feedback convention: the closed loop
  // goes unstable when L reaches −1. p.delay is in seconds.
  var LOOPS = {
    // Intro: no loop at all, just the plant (force in, position out).
    plant: function (s) { return msdG(s); },
    // PID on the mass-spring-damper: C(s) = Kp + Ki/s + Kd s.
    pid: function (s, p) {
      var c = cadd(cadd([p.kp, 0], cdiv([p.ki, 0], s)), cscale(s, p.kd));
      return cmul(cmul(c, msdG(s)), delayTerm(s, p.delay));
    },
    // Cart-pole: F = k·state is positive feedback in the textbook form u = −Kx with
    // K = −k, so L = K(sI − A)⁻¹B = −k·P(s).
    lqr: function (s, p) {
      var x = cartP(s), acc = [0, 0];
      for (var i = 0; i < 4; i++) acc = cadd(acc, cscale(x[i], p.k[i]));
      return cmul(cscale(acc, -1), delayTerm(s, p.delay));
    }
  };

  // Gain (dB) and unwrapped phase (deg) at each frequency.
  function freqResponse(L, p, w) {
    var mag = new Array(w.length), ph = new Array(w.length), prev = null;
    for (var i = 0; i < w.length; i++) {
      var v = L([0, w[i]], p);
      mag[i] = 20 * Math.log10(Math.max(cabs(v), 1e-12));
      var a = carg(v) * 180 / Math.PI;
      if (prev !== null) a = prev + wrap180(a - prev);
      ph[i] = a; prev = a;
    }
    // Pick the branch so the curve starts in (−270°, 90°]: the same curve, but loop
    // phases then sit around −180° the way textbooks draw them, not around +180°.
    var shift = 0;
    while (ph[0] + shift > 90) shift -= 360;
    while (ph[0] + shift <= -270) shift += 360;
    if (shift) for (var j = 0; j < ph.length; j++) ph[j] += shift;
    return { w: w, mag: mag, ph: ph };
  }

  // Classic margins read off a sampled response. Crossings are interpolated in log ω.
  //   pm: at every gain crossover (|L| = 1), how far the phase is from −180°.
  //   gm: at every phase crossover (phase = −180° + n·360°), how far |L| is from 1 (dB):
  //       positive = the gain can rise that much, negative = it can drop that much.
  function margins(fr) {
    var w = fr.w, mag = fr.mag, ph = fr.ph, pm = [], gm = [];
    function lerpAt(i, t, arr) { return arr[i] + (arr[i + 1] - arr[i]) * t; }
    function wAt(i, t) { return Math.pow(10, Math.log10(w[i]) + (Math.log10(w[i + 1]) - Math.log10(w[i])) * t); }
    for (var i = 0; i < w.length - 1; i++) {
      var m0 = mag[i], m1 = mag[i + 1];
      if ((m0 > 0) !== (m1 > 0)) {
        var t = m0 / (m0 - m1);
        pm.push({ w: wAt(i, t), pm: wrap180(lerpAt(i, t, ph) + 180), ph: lerpAt(i, t, ph) });
      }
      var p0 = ph[i], p1 = ph[i + 1], lo = Math.min(p0, p1), hi = Math.max(p0, p1);
      // every −180 + 360n inside [lo, hi)
      for (var n = Math.ceil((lo + 180) / 360); -180 + 360 * n < hi; n++) {
        var line = -180 + 360 * n;
        if (p1 === p0) continue;
        var tt = (line - p0) / (p1 - p0);
        if (tt < 0 || tt > 1) continue;
        gm.push({ w: wAt(i, tt), gm: -lerpAt(i, tt, mag), ph: line });
      }
    }
    return { pm: pm, gm: gm };
  }

  // The headline numbers: the worst phase margin, the nearest upward and downward gain
  // margins, and the delay margin (extra delay that would use up the worst phase margin).
  function summary(mg) {
    var out = { pm: null, wc: null, gmUp: null, wUp: null, gmDown: null, wDown: null, delayMargin: null };
    mg.pm.forEach(function (c) {
      if (out.pm === null || c.pm < out.pm) { out.pm = c.pm; out.wc = c.w; }
    });
    // Delay margin: smallest extra delay that rotates any crossover onto −180°.
    mg.pm.forEach(function (c) {
      if (c.pm <= 0) return;
      var dm = (c.pm * Math.PI / 180) / c.w;
      if (out.delayMargin === null || dm < out.delayMargin) out.delayMargin = dm;
    });
    mg.gm.forEach(function (c) {
      if (c.gm >= 0 && (out.gmUp === null || c.gm < out.gmUp)) { out.gmUp = c.gm; out.wUp = c.w; }
      if (c.gm < 0 && (out.gmDown === null || c.gm > out.gmDown)) { out.gmDown = c.gm; out.wDown = c.w; }
    });
    return out;
  }

  /* ---- Closed-loop stability by the Nyquist criterion ----
     Z = P + N: closed-loop right-half-plane poles = open-loop ones (P) plus clockwise
     encirclements of −1 by L (N). The contour runs a hair right of the imaginary axis
     (s = σ + jω) so poles sitting on it (the PID integrator, the cart's free position)
     don't count. Works with transport delay, where an eigenvalue check would not. */
  var SIGMA = 1e-3;

  // Real roots don't matter here, only how many have Re > SIGMA. Characteristic
  // polynomial by Faddeev–LeVerrier, roots by Durand–Kerner.
  function charPoly(A) {
    var n = A.length, c = new Array(n + 1), i, j, k;
    var Mk = A.map(function (r) { return r.map(function () { return 0; }); });
    c[0] = 1;
    for (k = 1; k <= n; k++) {
      // M_k = A M_{k−1} + c_{k−1} I
      var AM = A.map(function (r, ii) {
        return r.map(function (_, jj) {
          var s = 0; for (var q = 0; q < n; q++) s += A[ii][q] * Mk[q][jj]; return s;
        });
      });
      for (i = 0; i < n; i++) for (j = 0; j < n; j++) Mk[i][j] = AM[i][j] + (i === j ? c[k - 1] : 0);
      var tr = 0;
      for (i = 0; i < n; i++) { var s2 = 0; for (var q = 0; q < n; q++) s2 += A[i][q] * Mk[q][i]; tr += s2; }
      c[k] = -tr / k;
    }
    return c;   // s^n + c1 s^(n−1) + … + cn
  }

  // Roots of the monic s^n + c1 s^(n−1) + … + cn (c[0] is taken as 1).
  function polyRoots(c) {
    var n = c.length - 1, z = [], i, it;
    if (n < 1) return [];
    // Start on a circle that encloses every root (Fujiwara bound), off-axis so
    // conjugate pairs can separate.
    var R = 0;
    for (i = 1; i <= n; i++) R = Math.max(R, Math.pow(Math.abs(c[i]), 1 / i));
    R = 2 * R || 1;
    for (i = 0; i < n; i++) { var a = 2 * Math.PI * i / n + 0.4; z.push([R * Math.cos(a), R * Math.sin(a)]); }
    function ev(x) { var r = [1, 0]; for (var k = 1; k <= n; k++) r = cadd(cmul(r, x), [c[k], 0]); return r; }
    for (it = 0; it < 800; it++) {
      var moved = 0;
      for (i = 0; i < n; i++) {
        var den = [1, 0];
        for (var j = 0; j < n; j++) if (j !== i) den = cmul(den, csub(z[i], z[j]));
        var dz = cdiv(ev(z[i]), den);
        if (!isFinite(dz[0]) || !isFinite(dz[1])) continue;
        z[i] = csub(z[i], dz);
        moved = Math.max(moved, cabs(dz));
      }
      if (moved < 1e-13 * R) break;
    }
    return z;
  }

  /* ---- Transfer functions as polynomials (coefficients, highest power first) ---- */
  function padd(a, b) {
    var n = Math.max(a.length, b.length), out = [];
    for (var i = 0; i < n; i++) out.push((a[i - n + a.length] || 0) + (b[i - n + b.length] || 0));
    return out;
  }
  function pmul(a, b) {
    var out = []; for (var k = 0; k < a.length + b.length - 1; k++) out.push(0);
    for (var i = 0; i < a.length; i++) for (var j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
    return out;
  }
  function pscale(a, k) { return a.map(function (v) { return v * k; }); }
  function ptrim(a) {
    var big = 0; a.forEach(function (v) { big = Math.max(big, Math.abs(v)); });
    var i = 0; while (i < a.length - 1 && Math.abs(a[i]) <= 1e-10 * big) i++;
    return a.slice(i);
  }
  function rootsOf(p) {
    p = ptrim(p);
    if (p.length < 2 || p[0] === 0) return [];
    var lead = p[0];
    return polyRoots(p.map(function (v) { return v / lead; }));
  }

  // L(s) without its delay, as num/den. For the cart-pole the matrix determinant lemma
  // gives num = det(sI − A − Bk) − det(sI − A), which is linear in the gains.
  function loopParts(kind, p) {
    if (kind === 'plant') return { num: [1], den: [MSD.M, MSD.c, MSD.k] };
    if (kind === 'pid') return { num: ptrim([p.kd, p.kp, p.ki]), den: [MSD.M, MSD.c, MSD.k, 0] };
    var A = CP_AB.A, B = CP_AB.B;
    var Acl = A.map(function (r, i) { return r.map(function (v, j) { return v + B[i] * p.k[j]; }); });
    var den = charPoly(A);
    return { num: ptrim(padd(charPoly(Acl), pscale(den, -1))), den: den };
  }

  // Delay as a 2nd-order Padé approximation, e^(−sT) ≈ Nd(s)/Dd(s), so the closed loop
  // has finitely many poles to draw. (Stability itself still comes from Nyquist.)
  function pade(T) {
    if (!(T > 0)) return { n: [1], d: [1] };
    return { n: [T * T / 12, -T / 2, 1], d: [T * T / 12, T / 2, 1] };
  }

  // Closed-loop characteristic polynomial den·Dd + g·num·Nd, where g scales every gain
  // at once (g = 1 is the controller as set; sweeping g gives the root locus).
  function closedLoopPoly(kind, p, g) {
    var parts = loopParts(kind, p), dl = pade(p.delay);
    return padd(pmul(parts.den, dl.d), pscale(pmul(parts.num, dl.n), g === undefined ? 1 : g));
  }
  function closedLoopPoles(kind, p) { return rootsOf(closedLoopPoly(kind, p, 1)); }
  function openLoopPolesZeros(kind, p) {
    var parts = loopParts(kind, p);
    var zeros = parts.num.every(function (v) { return v === 0; }) ? [] : rootsOf(parts.num);
    return { poles: rootsOf(parts.den), zeros: zeros };
  }
  function rootLocus(kind, p, gMax, n) {
    var out = [];
    for (var i = 1; i <= n; i++) out.push(rootsOf(closedLoopPoly(kind, p, gMax * i / n)));
    return out;
  }

  // "6s² + 40s + 5" from [6, 40, 5]. Coefficients to three significant figures.
  var SUP = { 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶' };
  function numStr(v) {
    var a = Math.abs(v);
    if (a >= 100) return a.toFixed(0);
    if (a >= 10) return String(+a.toFixed(1));
    return String(+a.toPrecision(3));
  }
  function polyStr(c) {
    c = ptrim(c);
    var n = c.length - 1, out = '';
    c.forEach(function (v, i) {
      var pw = n - i;
      if (Math.abs(v) < 1e-9) return;
      var mag = numStr(v), sign = v < 0 ? '−' : '+';
      if (Math.abs(+mag - 1) < 1e-9 && pw > 0) mag = '';
      var term = mag + (pw === 0 ? '' : pw === 1 ? 's' : 's' + SUP[pw]);
      if (term === '') term = '1';
      out += out === '' ? (v < 0 ? '−' : '') + term : ' ' + sign + ' ' + term;
    });
    return out || '0';
  }

  function unstableOpenLoopPoles(kind) {
    if (kind !== 'lqr') return 0;          // the mass-spring-damper is stable (integrator sits on the axis)
    return polyRoots(charPoly(CP_AB.A)).filter(function (r) { return r[0] > SIGMA; }).length;
  }

  var NYQ_W = [0].concat(logspace(1e-5, 1e4, 9000));
  function closedLoopRhpPoles(kind, p) {
    var L = LOOPS[kind], total = 0, prev = null;
    for (var i = 0; i < NYQ_W.length; i++) {
      var f = cadd([1, 0], L([SIGMA, NYQ_W[i]], p));
      var a = carg(f);
      if (prev !== null) {
        var d = a - prev;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d <= -Math.PI) d += 2 * Math.PI;
        total += d;
      }
      prev = a;
    }
    // Over ω ∈ (−∞, ∞) the swept angle is twice the upper half's. Clockwise
    // encirclements N = −angle / 2π.
    var N = -2 * total / (2 * Math.PI);
    return Math.round(unstableOpenLoopPoles(kind) + N);
  }

  /* ---- Step responses (linear models, so they agree with the plots) ---- */

  // PID: reference steps from 0 to 1 m; D acts on the measurement, as on /controls/.
  function pidStep(p, T, dt) {
    var x = 0, v = 0, I = 0, buf = [], n = Math.round(T / dt), out = new Array(n + 1);
    var dly = Math.round(p.delay / dt);
    out[0] = 0;
    for (var i = 1; i <= n; i++) {
      var e = 1 - x;
      I += e * dt;
      var u = p.kp * e + p.ki * I - p.kd * v;
      buf.push(u);
      var ua = buf.length > dly ? buf.shift() : 0;
      // semi-implicit Euler is plenty at this step size for a plot
      var acc = (ua - MSD.c * v - MSD.k * x) / MSD.M;
      v += acc * dt; x += v * dt;
      if (!isFinite(x) || Math.abs(x) > 1e6) { x = x > 0 ? 1e6 : -1e6; v = 0; }
      out[i] = x;
    }
    return out;
  }

  // Cart-pole: the pole starts 3° from upright, cart at rest; returns θ in degrees.
  function lqrTilt(p, T, dt) {
    var A = CP_AB.A, B = CP_AB.B, s = [0, 0, 3 * Math.PI / 180, 0];
    var buf = [], n = Math.round(T / dt), out = new Array(n + 1), dly = Math.round(p.delay / dt);
    out[0] = 3;
    for (var i = 1; i <= n; i++) {
      var F = p.k[0] * s[0] + p.k[1] * s[1] + p.k[2] * s[2] + p.k[3] * s[3];
      buf.push(F);
      var Fa = buf.length > dly ? buf.shift() : 0;
      var ds = [0, 0, 0, 0];
      for (var r = 0; r < 4; r++) {
        var acc = B[r] * Fa;
        for (var c = 0; c < 4; c++) acc += A[r][c] * s[c];
        ds[r] = acc;
      }
      // velocities first, then positions (semi-implicit)
      s[1] += ds[1] * dt; s[3] += ds[3] * dt;
      s[0] += s[1] * dt;  s[2] += s[3] * dt;
      var th = s[2] * 180 / Math.PI;
      if (!isFinite(th) || Math.abs(th) > 1e6) { th = th > 0 ? 1e6 : -1e6; s = [0, 0, th * Math.PI / 180, 0]; }
      out[i] = th;
    }
    return out;
  }

  var BodeCore = {
    cabs: cabs, carg: carg, cmul: cmul, wrap180: wrap180, logspace: logspace,
    MSD: MSD, CP: CP, CP_AB: CP_AB, CP_LQR: CP_LQR, LOOPS: LOOPS,
    freqResponse: freqResponse, margins: margins, summary: summary,
    charPoly: charPoly, polyRoots: polyRoots, rootsOf: rootsOf, polyStr: polyStr,
    loopParts: loopParts, closedLoopPoly: closedLoopPoly, closedLoopPoles: closedLoopPoles,
    openLoopPolesZeros: openLoopPolesZeros, rootLocus: rootLocus,
    unstableOpenLoopPoles: unstableOpenLoopPoles, closedLoopRhpPoles: closedLoopRhpPoles,
    pidStep: pidStep, lqrTilt: lqrTilt
  };

  BodeCore.pade = pade;
  if (typeof module !== 'undefined' && module.exports) module.exports = BodeCore;
  if (typeof document === 'undefined') return;
  root.BodeCore = BodeCore;

  /* ================================================================
     Page
  ================================================================ */

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function withAlpha(color, a) {
    var m = /^#([0-9a-f]{6})$/i.exec(color);
    if (!m) return color;
    var n = parseInt(m[1], 16);
    return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Size a canvas's pixel buffer from its CSS box (never the other way round).
  function fit(canvas) {
    var dpr = window.devicePixelRatio || 1;
    var W = canvas.clientWidth, H = canvas.clientHeight;
    var bw = Math.max(1, Math.round(W * dpr)), bh = Math.max(1, Math.round(H * dpr));
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    return { ctx: ctx, W: W, H: H };
  }

  var col = {};
  function readColors() {
    col.text = cssVar('--text'); col.muted = cssVar('--text-muted');
    col.border = cssVar('--border'); col.borderStrong = cssVar('--border-strong');
    col.accent = cssVar('--accent'); col.bgSoft = cssVar('--bg-soft'); col.surface = cssVar('--bg');
    col.in = cssVar('--viz-1'); col.out = cssVar('--viz-2');
    col.pm = cssVar('--viz-3'); col.gm = cssVar('--viz-4');
    col.bad = cssVar('--nn-act-neg'); col.mono = cssVar('--mono'); col.font = cssVar('--font');
  }

  // Only touch the DOM when a readout actually changes (it's called every frame).
  function setText(id, txt) {
    var el = document.getElementById(id);
    if (el && el.textContent !== txt) el.textContent = txt;
  }

  function fmt(v, d) { var s = v.toFixed(d); return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s; }
  function fmtW(w) { return w < 1 ? fmt(w, 2) : w < 10 ? fmt(w, 1) : fmt(w, 0); }

  /* ---- Tabs (same markup and deep-link scheme as /controls/) ---- */
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.sim-tab'));
  var sections = Array.prototype.slice.call(document.querySelectorAll('.sim-section'));
  function tabName(tab) { return tab.getAttribute('aria-controls').replace(/^sec-/, ''); }
  function activateTab(idx) {
    tabs.forEach(function (t, i) {
      t.classList.toggle('active', i === idx);
      t.setAttribute('aria-selected', i === idx ? 'true' : 'false');
    });
    sections.forEach(function (s, i) { s.classList.toggle('active', i === idx); });
  }
  function activateFromHash() {
    var want = location.hash.slice(1), idx = 0;
    tabs.forEach(function (t, i) { if (tabName(t) === want) idx = i; });
    activateTab(idx);
  }
  tabs.forEach(function (tab, i) {
    tab.addEventListener('click', function () {
      activateTab(i);
      history.replaceState(null, '', i === 0 ? location.pathname + location.search : '#' + tabName(tab));
    });
  });
  window.addEventListener('hashchange', activateFromHash);
  activateFromHash();

  /* ---- One demo per tab ---- */

  var NYQ_PLOT_W = logspace(0.003, 300, 700);
  var CYCLES_SHOWN = 3;        // the time traces always show three periods…
  var CYCLES_PER_SEC = 0.5;    // …played at one cycle every two seconds, whatever ω is
  var SWEEP_SECONDS = 10;

  function makeDemo(cfg) {
    var sec = document.getElementById('sec-' + cfg.id);
    if (!sec) return null;
    var $ = function (s) { return document.getElementById(cfg.id + '-' + s); };
    var d = {
      cfg: cfg, sec: sec,
      top: $('time'), magC: $('mag'), phC: $('phase'),
      wSlider: $('w'), wVal: $('w-val'), sweepBtn: $('sweep'),
      p: cfg.params(), w: cfg.w0, phase: 0, sweeping: false,
      reveal: cfg.reveal ? cfg.w0 : Infinity,
      grid: logspace(cfg.wmin, cfg.wmax, 500),
      fr: null, sum: null, mg: null, stable: true, step: null
    };

    function wFromSlider() {
      var t = parseFloat(d.wSlider.value) / 1000;
      return Math.pow(10, Math.log10(cfg.wmin) + t * (Math.log10(cfg.wmax) - Math.log10(cfg.wmin)));
    }
    function sliderFromW(w) {
      return 1000 * (Math.log10(w) - Math.log10(cfg.wmin)) / (Math.log10(cfg.wmax) - Math.log10(cfg.wmin));
    }
    d.setW = function (w) {
      d.w = clamp(w, cfg.wmin, cfg.wmax);
      d.wSlider.value = sliderFromW(d.w);
      d.reveal = Math.max(d.reveal, d.w);
      d.wVal.textContent = fmtW(d.w) + ' rad/s';
    };
    d.wSlider.addEventListener('input', function () { stopSweep(); d.setW(wFromSlider()); });

    function stopSweep() {
      d.sweeping = false;
      d.sweepBtn.textContent = 'Sweep frequency';
      d.sweepBtn.setAttribute('aria-pressed', 'false');
    }
    d.sweepBtn.addEventListener('click', function () {
      if (d.sweeping) { stopSweep(); return; }
      d.sweeping = true;
      d.sweepBtn.textContent = 'Stop sweep';
      d.sweepBtn.setAttribute('aria-pressed', 'true');
      if (cfg.reveal) d.reveal = cfg.wmin;
      d.setW(cfg.wmin);
    });
    d.tickSweep = function (dtSec) {
      if (!d.sweeping) return;
      var span = Math.log10(cfg.wmax) - Math.log10(cfg.wmin);
      var lw = Math.log10(d.w) + span * dtSec / SWEEP_SECONDS;
      if (lw >= Math.log10(cfg.wmax)) { d.setW(cfg.wmax); stopSweep(); return; }
      d.setW(Math.pow(10, lw));
    };

    d.recompute = function () {
      d.fr = freqResponse(LOOPS[cfg.kind], d.p, d.grid);
      if (cfg.kind !== 'plant') {
        d.mg = margins(d.fr);
        d.sum = summary(d.mg);
        d.Z = closedLoopRhpPoles(cfg.kind, d.p);
        d.P = unstableOpenLoopPoles(cfg.kind);
        d.stable = d.Z === 0;
        d.step = cfg.step(d.p);
        d.clPoles = closedLoopPoles(cfg.kind, d.p);
        d.nyqL = NYQ_PLOT_W.map(function (w) { return LOOPS[cfg.kind]([0, w], d.p); });
      }
      var pz = openLoopPolesZeros(cfg.kind, d.p);
      d.olPoles = pz.poles;
      d.olZeros = cfg.kind === 'plant' ? [] : pz.zeros;
      d.locus = null;             // the root locus is computed lazily, only when it is shown
      d.tfDirty = true;
      if (cfg.onRecompute) cfg.onRecompute(d);
    };

    // View toggle (Bode | Nyquist | Poles) for the plot area under the experiment.
    d.view = 'bode';
    d.pair = $('pair'); d.altCell = $('alt-cell'); d.altC = $('alt'); d.tfBox = $('tf');
    var viewBox = $('view');
    if (viewBox) {
      var vbtns = Array.prototype.slice.call(viewBox.querySelectorAll('.mode-btn'));
      vbtns.forEach(function (b) {
        b.addEventListener('click', function () {
          d.view = b.dataset.view;
          vbtns.forEach(function (o) {
            var on = o === b;
            o.classList.toggle('active', on);
            o.setAttribute('aria-pressed', on ? 'true' : 'false');
          });
          d.pair.hidden = d.view !== 'bode';
          d.altCell.hidden = d.view === 'bode';
          d.altC.setAttribute('aria-label', d.view === 'nyquist' ? cfg.nyqLabel : cfg.polesLabel);
          d.shownPoles = null;
          d.tfDirty = true;
        });
      });
    }

    // Gain sliders: <id>-<name>, value readout <id>-<name>-val, optional ± range box.
    (cfg.sliders || []).forEach(function (sl) {
      var el = $(sl.name), val = $(sl.name + '-val'), rng = $(sl.name + '-range');
      if (!el) return;
      function sync() {
        var v = parseFloat(el.value);
        sl.set(d.p, v);
        val.textContent = sl.fmt(v);
        d.recompute();
      }
      el.addEventListener('input', sync);
      if (rng) rng.addEventListener('input', function () {
        var r = Math.max(parseFloat(rng.min) || 1, parseFloat(rng.value) || 0);
        el.min = sl.signed ? -r : 0; el.max = r;
        el.value = clamp(parseFloat(el.value), parseFloat(el.min), r);
        sync();
      });
      sl.el = el; sl.sync = sync; sl.rng = rng;
    });
    // "Load …" button: drop the sliders onto a preset, widening a range box if needed.
    var presetBtn = $('preset');
    if (presetBtn) presetBtn.addEventListener('click', function () {
      cfg.sliders.forEach(function (sl) {
        if (!sl.el || sl.preset === undefined) return;
        if (sl.rng && Math.abs(sl.preset) > parseFloat(sl.el.max)) {
          sl.rng.value = Math.ceil(Math.abs(sl.preset) * 1.5);
          sl.el.min = sl.signed ? -sl.rng.value : 0; sl.el.max = sl.rng.value;
        }
        sl.el.value = sl.preset;
        sl.set(d.p, sl.preset);
        $(sl.name + '-val').textContent = sl.fmt(sl.preset);
      });
      d.recompute();
    });

    d.setW(cfg.w0);
    d.recompute();
    return d;
  }

  /* ---- Drawing: the Bode pair ---- */

  function niceRange(lo, hi, step, minSpan) {
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    if (hi - lo < minSpan) { var mid = (lo + hi) / 2; lo = Math.floor((mid - minSpan / 2) / step) * step; hi = lo + minSpan; }
    return [lo, hi];
  }

  function bodeFrame(c, d, which) {
    var ctx = c.ctx, W = c.W, H = c.H, cfg = d.cfg;
    var padL = 46, padR = 12, padT = 10, padB = which === 'ph' ? 24 : 10;
    var x0 = padL, x1 = W - padR, y0 = padT, y1 = H - padB;
    var lmin = Math.log10(cfg.wmin), lmax = Math.log10(cfg.wmax);
    function X(w) { return x0 + (Math.log10(w) - lmin) / (lmax - lmin) * (x1 - x0); }
    return { ctx: ctx, W: W, H: H, x0: x0, x1: x1, y0: y0, y1: y1, X: X };
  }

  function drawAxes(f, d, yr, ticks, unitLabel, showW) {
    var ctx = f.ctx, cfg = d.cfg;
    function Y(v) { return f.y1 - (v - yr[0]) / (yr[1] - yr[0]) * (f.y1 - f.y0); }
    ctx.font = '11px ' + col.mono;
    ctx.lineWidth = 1;
    // Decade (and 2×, 5×) gridlines.
    for (var e = Math.floor(Math.log10(cfg.wmin)); e <= Math.ceil(Math.log10(cfg.wmax)); e++) {
      [1, 2, 5].forEach(function (m) {
        var w = m * Math.pow(10, e);
        if (w < cfg.wmin * 0.999 || w > cfg.wmax * 1.001) return;
        var x = f.X(w);
        ctx.strokeStyle = m === 1 ? col.border : withAlpha(col.border, 0.5) || col.border;
        ctx.beginPath(); ctx.moveTo(x, f.y0); ctx.lineTo(x, f.y1); ctx.stroke();
        if (showW && m === 1 && x < f.x1 - 70) {
          ctx.fillStyle = col.muted; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
          ctx.fillText(w >= 1 ? String(w) : w.toPrecision(1), x, f.y1 + 5);
        }
      });
    }
    ticks.forEach(function (v) {
      var y = Y(v);
      ctx.strokeStyle = col.border;
      ctx.beginPath(); ctx.moveTo(f.x0, y); ctx.lineTo(f.x1, y); ctx.stroke();
      ctx.fillStyle = col.muted; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(String(v), f.x0 - 6, y);
    });
    // Axis title on a small backdrop so the curve can pass under it.
    ctx.font = '600 12px ' + col.font; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    var tw = ctx.measureText(unitLabel).width;
    ctx.fillStyle = withAlpha(col.surface, 0.85) || col.surface;
    ctx.fillRect(f.x0 + 3, f.y0 + 1, tw + 10, 18);
    ctx.fillStyle = col.text;
    ctx.fillText(unitLabel, f.x0 + 8, f.y0 + 4);
    if (showW) {
      ctx.fillStyle = col.muted; ctx.font = '11px ' + col.mono; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
      ctx.fillText('ω (rad/s)', f.x1, f.y1 + 5);
    }
    return Y;
  }

  function strokeCurve(f, Y, w, vals, upto, color, yr) {
    var ctx = f.ctx;
    ctx.save();
    ctx.beginPath(); ctx.rect(f.x0, f.y0, f.x1 - f.x0, f.y1 - f.y0); ctx.clip();
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.beginPath();
    var started = false;
    for (var i = 0; i < w.length && w[i] <= upto; i++) {
      var y = Y(clamp(vals[i], yr[0] - 1000, yr[1] + 1000));
      if (!started) { ctx.moveTo(f.X(w[i]), y); started = true; } else ctx.lineTo(f.X(w[i]), y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function interpAt(fr, arr, w) {
    var lw = Math.log10(w), g = fr.w;
    for (var i = 0; i < g.length - 1; i++) {
      if (g[i + 1] >= w) {
        var t = (lw - Math.log10(g[i])) / (Math.log10(g[i + 1]) - Math.log10(g[i]));
        return arr[i] + (arr[i + 1] - arr[i]) * clamp(t, 0, 1);
      }
    }
    return arr[arr.length - 1];
  }

  function cursor(f, x) {
    var ctx = f.ctx;
    ctx.save();
    ctx.strokeStyle = withAlpha(col.out, 0.55); ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, f.y0); ctx.lineTo(x, f.y1); ctx.stroke();
    ctx.restore();
  }
  function dot(ctx, x, y) {
    ctx.fillStyle = col.out;
    ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = col.bgSoft || '#fff'; ctx.lineWidth = 2; ctx.stroke();
  }
  function tag(ctx, text, x, y, color, align) {
    ctx.font = '600 11px ' + col.mono;
    var tw = ctx.measureText(text).width, padX = 5, h = 17;
    var bx = align === 'right' ? x - tw - padX * 2 : x;
    ctx.fillStyle = withAlpha(color, 0.16); ctx.strokeStyle = color; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, y - h / 2, tw + padX * 2, h, 4) : ctx.rect(bx, y - h / 2, tw + padX * 2, h);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + padX, y + 0.5);
  }

  function drawBode(d) {
    var fr = d.fr, cfg = d.cfg, loop = cfg.kind !== 'plant';
    var upto = d.reveal;

    // Magnitude
    var cm = fit(d.magC), fm = bodeFrame(cm, d, 'mag');
    var mlo = Infinity, mhi = -Infinity;
    fr.mag.forEach(function (v) { mlo = Math.min(mlo, v); mhi = Math.max(mhi, v); });
    var myr = niceRange(Math.max(mlo, -80), Math.min(mhi, 80), 20, 40);
    if (loop) { myr[0] = Math.min(myr[0], -20); myr[1] = Math.max(myr[1], 20); }
    var mticks = []; for (var t = myr[0]; t <= myr[1] + 1e-9; t += 20) mticks.push(t);
    var Ym = drawAxes(fm, d, myr, mticks, 'Gain (dB)', false);
    if (loop) {
      fm.ctx.save(); fm.ctx.strokeStyle = col.borderStrong; fm.ctx.setLineDash([5, 4]); fm.ctx.lineWidth = 1.2;
      fm.ctx.beginPath(); fm.ctx.moveTo(fm.x0, Ym(0)); fm.ctx.lineTo(fm.x1, Ym(0)); fm.ctx.stroke(); fm.ctx.restore();
    }
    strokeCurve(fm, Ym, fr.w, fr.mag, upto, col.in, myr);

    // Phase
    var cp = fit(d.phC), fp = bodeFrame(cp, d, 'ph');
    var plo = Infinity, phi = -Infinity;
    fr.ph.forEach(function (v) { plo = Math.min(plo, v); phi = Math.max(phi, v); });
    var pyr = niceRange(Math.max(plo, -720), Math.min(phi, 360), 90, 180);
    if (loop) { pyr[0] = Math.min(pyr[0], -270); pyr[1] = Math.max(pyr[1], 0); }
    var pticks = [], pstep = (pyr[1] - pyr[0]) > 450 ? 180 : 90;
    for (var q = Math.ceil(pyr[0] / pstep) * pstep; q <= pyr[1] + 1e-9; q += pstep) pticks.push(q);
    var Yp = drawAxes(fp, d, pyr, pticks, 'Phase (°)', true);
    if (loop) {
      fp.ctx.save(); fp.ctx.strokeStyle = col.borderStrong; fp.ctx.setLineDash([5, 4]); fp.ctx.lineWidth = 1.2;
      for (var n = Math.ceil((pyr[0] + 180) / 360); -180 + 360 * n <= pyr[1]; n++) {
        var yl = Yp(-180 + 360 * n);
        fp.ctx.beginPath(); fp.ctx.moveTo(fp.x0, yl); fp.ctx.lineTo(fp.x1, yl); fp.ctx.stroke();
      }
      fp.ctx.restore();
    }
    strokeCurve(fp, Yp, fr.w, fr.ph, upto, col.in, pyr);

    // Margin markers: the worst phase margin and the nearest gain margins.
    if (loop && d.stable) {
      var s = d.sum;
      if (s.wc !== null) {
        var xc = fm.X(s.wc);
        var phc = interpAt(fr, fr.ph, s.wc);
        var line = phc - s.pm;       // the −180 + 360n line it is measured from
        var c = fp.ctx;
        c.save(); c.strokeStyle = col.pm; c.lineWidth = 3;
        c.beginPath(); c.moveTo(xc, Yp(phc)); c.lineTo(xc, Yp(line)); c.stroke(); c.restore();
        fm.ctx.save(); fm.ctx.fillStyle = col.pm;
        fm.ctx.beginPath(); fm.ctx.arc(xc, Ym(0), 3.5, 0, Math.PI * 2); fm.ctx.fill(); fm.ctx.restore();
        var right = xc > (fp.x0 + fp.x1) / 2;
        tag(c, 'PM ' + fmt(s.pm, 0) + '°', xc + (right ? -8 : 8), Math.max(Yp(phc), Yp(line)) + 12, col.pm, right ? 'right' : 'left');
      }
      [[s.wUp, s.gmUp], [s.wDown, s.gmDown]].forEach(function (g) {
        if (g[0] === null || g[0] < cfg.wmin || g[0] > cfg.wmax) return;
        var xg = fm.X(g[0]), mg = -g[1];
        var cc = fm.ctx;
        cc.save(); cc.strokeStyle = col.gm; cc.lineWidth = 3;
        cc.beginPath(); cc.moveTo(xg, Ym(clamp(mg, myr[0], myr[1]))); cc.lineTo(xg, Ym(0)); cc.stroke(); cc.restore();
        fp.ctx.save(); fp.ctx.fillStyle = col.gm;
        var phl = interpAt(fr, fr.ph, g[0]);
        fp.ctx.beginPath(); fp.ctx.arc(xg, Yp(phl), 3.5, 0, Math.PI * 2); fp.ctx.fill(); fp.ctx.restore();
        var rightg = xg > (fm.x0 + fm.x1) / 2;
        var yTop = Math.min(Ym(clamp(mg, myr[0], myr[1])), Ym(0));
        tag(cc, 'GM ' + (g[1] > 0 ? '+' : '') + fmt(g[1], 1) + ' dB', xg + (rightg ? -8 : 8),
            Math.max(fm.y0 + 10, yTop - 4), col.gm, rightg ? 'right' : 'left');
      });
    }

    // The frequency we are shaking at.
    var xw = fm.X(d.w);
    cursor(fm, xw); cursor(fp, xw);
    dot(fm.ctx, xw, Ym(clamp(interpAt(fr, fr.mag, d.w), myr[0], myr[1])));
    dot(fp.ctx, xw, Yp(clamp(interpAt(fr, fr.ph, d.w), pyr[0], pyr[1])));

    if (cfg.reveal && d.reveal < cfg.wmin * 1.5 && !d.sweeping) {
      fm.ctx.fillStyle = col.muted; fm.ctx.font = '12px ' + col.font;
      fm.ctx.textAlign = 'center'; fm.ctx.textBaseline = 'middle';
      fm.ctx.fillText('Press Sweep, or drag the frequency, to trace the curve', (fm.x0 + fm.x1) / 2, (fm.y0 + fm.y1) / 2 + 8);
    }
  }

  /* ---- Drawing: the time-domain experiment on top ---- */

  // Two sine traces over the last CYCLES_SHOWN periods; τ is time in cycles.
  function drawTraces(ctx, x0, y0, x1, y1, tau, inAmp, outAmp, outPhase, labels, yMax) {
    var mid = (y0 + y1) / 2, half = (y1 - y0) / 2 - 6;
    function Y(v) { return mid - clamp(v / yMax, -1.08, 1.08) * half; }
    function X(c) { return x0 + (c - (tau - CYCLES_SHOWN)) / CYCLES_SHOWN * (x1 - x0); }
    ctx.strokeStyle = col.border; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, mid); ctx.lineTo(x1, mid); ctx.stroke();
    for (var k = Math.ceil(tau - CYCLES_SHOWN); k <= tau; k++) {
      ctx.strokeStyle = withAlpha(col.border, 0.6) || col.border;
      ctx.beginPath(); ctx.moveTo(X(k), y0); ctx.lineTo(X(k), y1); ctx.stroke();
    }
    [[inAmp, 0, col.in], [outAmp, outPhase, col.out]].forEach(function (tr) {
      ctx.save();
      ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();
      ctx.strokeStyle = tr[2]; ctx.lineWidth = 2.2; ctx.beginPath();
      var N = 240;
      for (var i = 0; i <= N; i++) {
        var c = tau - CYCLES_SHOWN + CYCLES_SHOWN * i / N;
        var y = Y(tr[0] * Math.sin(2 * Math.PI * c + tr[1]));
        if (i === 0) ctx.moveTo(X(c), y); else ctx.lineTo(X(c), y);
      }
      ctx.stroke(); ctx.restore();
    });
    // Live end-points so the eye follows the newest sample.
    ctx.fillStyle = col.in; ctx.beginPath(); ctx.arc(x1, Y(inAmp * Math.sin(2 * Math.PI * tau)), 3.5, 0, 7); ctx.fill();
    ctx.fillStyle = col.out; ctx.beginPath(); ctx.arc(x1, Y(outAmp * Math.sin(2 * Math.PI * tau + outPhase)), 3.5, 0, 7); ctx.fill();
    // Legend
    ctx.font = '600 12px ' + col.font; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    var lx = x0 + 6;
    [[labels[0], col.in], [labels[1], col.out]].forEach(function (l) {
      ctx.fillStyle = l[1]; ctx.fillRect(lx, y0 + 7, 12, 3);
      ctx.fillText(l[0], lx + 16, y0 + 2);
      lx += 16 + ctx.measureText(l[0]).width + 14;
    });
    return { X: X, Y: Y };
  }

  function playbackNote(ctx, x, y, w) {
    var period = 2 * Math.PI / w, shown = 1 / CYCLES_PER_SEC;
    var r = period / shown;
    var txt = r > 1.05 ? 'shown ' + fmt(r, r < 10 ? 1 : 0) + '× faster than real time'
            : r < 0.95 ? 'shown ' + fmt(1 / r, 1 / r < 10 ? 1 : 0) + '× slower than real time'
            : 'shown in real time';
    ctx.fillStyle = col.muted; ctx.font = '11px ' + col.mono; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillText('period ' + (period < 1 ? fmt(period * 1000, 0) + ' ms' : fmt(period, 1) + ' s') + ', ' + txt, x, y);
  }

  function drawIntroTop(d) {
    var c = fit(d.top), ctx = c.ctx, W = c.W, H = c.H;
    var G = LOOPS.plant([0, d.w]), amp = cabs(G), ph = carg(G);
    var narrow = W < 520;
    var massW = narrow ? 0 : Math.min(150, W * 0.22);
    var tx0 = massW + 18, tx1 = W - 16, ty0 = 14, ty1 = H - 30;

    // The mass on its spring, moving with the output.
    if (!narrow) {
      var cx = massW / 2 + 10, anchorY = 24, restY = H / 2, scale = (H / 2 - 60) / 1.3;
      var y = amp * Math.sin(2 * Math.PI * d.phase + ph);
      var my = restY - y * scale;
      ctx.strokeStyle = col.muted; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx - 34, anchorY); ctx.lineTo(cx + 34, anchorY); ctx.stroke();
      // spring
      var coils = 9, top = anchorY, bot = my - 22;
      ctx.beginPath(); ctx.moveTo(cx, top);
      for (var i = 1; i <= coils * 2; i++) ctx.lineTo(cx + (i % 2 ? 11 : -11), top + (bot - top) * i / (coils * 2 + 1));
      ctx.lineTo(cx, bot); ctx.stroke();
      // mass
      ctx.fillStyle = withAlpha(col.out, 0.18); ctx.strokeStyle = col.out; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(cx - 24, my - 22, 48, 44, 6) : ctx.rect(cx - 24, my - 22, 48, 44);
      ctx.fill(); ctx.stroke();
      // force arrow, from the input
      var Fv = Math.sin(2 * Math.PI * d.phase), len = Fv * 46;
      if (Math.abs(len) > 3) {
        var ax = cx, ay0 = my + (len > 0 ? -26 : 26), ay1 = ay0 - len;
        ctx.strokeStyle = col.in; ctx.fillStyle = col.in; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(ax, ay0); ctx.lineTo(ax, ay1); ctx.stroke();
        var dir = len > 0 ? -1 : 1;
        ctx.beginPath(); ctx.moveTo(ax, ay1 + dir * 2); ctx.lineTo(ax - 6, ay1 - dir * 8); ctx.lineTo(ax + 6, ay1 - dir * 8); ctx.fill();
      }
      ctx.strokeStyle = withAlpha(col.muted, 0.5); ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx - 40, restY); ctx.lineTo(cx + 40, restY); ctx.stroke(); ctx.setLineDash([]);
    }

    var tr = drawTraces(ctx, tx0, ty0, tx1, ty1, d.phase, 1, amp, ph, ['Force in (N)', 'Position out (m)'], 1.35);

    // Lag bracket: the newest input peak and the output peak that follows it.
    var lagCycles = -ph / (2 * Math.PI);        // 0 … 0.5 for this plant
    var kPeak = Math.floor(d.phase - 0.25 - lagCycles) + 0.25;
    var xin = tr.X(kPeak), xout = tr.X(kPeak + lagCycles);
    if (xin > tx0 + 4 && lagCycles > 0.01) {
      var by = ty0 + 30;
      ctx.strokeStyle = col.text; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(xin, by); ctx.lineTo(xin, tr.Y(1)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(xout, by); ctx.lineTo(xout, tr.Y(amp)); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(xin, by); ctx.lineTo(xout, by); ctx.stroke();
      ctx.fillStyle = col.text; ctx.font = '600 11px ' + col.mono; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText('lag ' + fmt(lagCycles * 360, 0) + '°', (xin + xout) / 2, by - 2);
    }

    setText('intro-gain', fmt(20 * Math.log10(amp), 1) + ' dB');
    setText('intro-ph', fmt(ph * 180 / Math.PI, 0) + '°');

    ctx.fillStyle = col.text; ctx.font = '600 13px ' + col.font; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    var gtxt = amp >= 1 ? 'Output is ' + fmt(amp, 2) + '× the input' : 'Output is ' + fmt(amp, amp < 0.01 ? 4 : 3) + '× the input';
    ctx.fillText(gtxt + ' (' + fmt(20 * Math.log10(amp), 1) + ' dB)', tx0, H - 8);
    playbackNote(ctx, tx1, H - 8, d.w);
  }

  // PID / LQR top: the loop "echo" on the left, the step (or tilt) response on the right.
  function drawLoopTop(d) {
    var c = fit(d.top), ctx = c.ctx, W = c.W, H = c.H, cfg = d.cfg;
    var narrow = W < 560;
    var ex1 = narrow ? W - 14 : W * 0.58, ey1 = narrow ? H * 0.56 : H - 22;

    // What comes back after one trip round the loop: −L·d. When that matches d (same
    // size, same phase) the loop can sustain the oscillation on its own.
    var Lw = LOOPS[cfg.kind]([0, d.w], d.p);
    var back = [-Lw[0], -Lw[1]], amp = cabs(back), ph = carg(back);
    // Scale to fit what comes back (up to 12×); past that it is clipped, and says so.
    var yMax = clamp(amp * 1.15, 1.3, 12);
    drawTraces(ctx, 14, 14, ex1, ey1 - (narrow ? 26 : 22), d.phase, 1, amp, ph, ['Injected', 'Comes back'], yMax);
    var off = Math.abs(BodeCore.wrap180(ph * 180 / Math.PI));
    ctx.fillStyle = col.text; ctx.font = '600 13px ' + col.font; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    var ratio = amp >= 100 ? fmt(amp, 0) : amp >= 10 ? fmt(amp, 1) : fmt(amp, 2);
    var near = Math.abs(20 * Math.log10(amp)) < 1.5 && off < 15;
    ctx.fillStyle = near ? col.bad : col.text;
    var cap = (near ? 'Nearly feeds itself: ' : 'Comes back ') + ratio + '× as big, ' + fmt(off, 0) + '° out of step';
    ctx.fillText(cap, 14, ey1 - 4);
    if (amp > yMax * 1.08) {
      ctx.fillStyle = col.muted; ctx.font = '11px ' + col.mono; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
      ctx.fillText('clipped: too big to show', ex1, 18);
    }
    // Playback speed on its own line under the caption, where there is room.
    if (!narrow) playbackNote(ctx, ex1, H - 6, d.w);

    // Step / tilt response.
    var sx0 = narrow ? 46 : W * 0.58 + 52, sx1 = W - 14;
    var sy0 = narrow ? ey1 + 14 : 14, sy1 = H - 24;
    ctx.strokeStyle = col.border; ctx.lineWidth = 1;
    if (!narrow) { ctx.beginPath(); ctx.moveTo(W * 0.58 + 16, 12); ctx.lineTo(W * 0.58 + 16, H - 12); ctx.stroke(); }
    var spec = cfg.stepSpec, data = d.step, n = data.length;
    var yr = spec.range;
    function SX(i) { return sx0 + i / (n - 1) * (sx1 - sx0); }
    function SY(v) { return sy1 - (v - yr[0]) / (yr[1] - yr[0]) * (sy1 - sy0); }
    ctx.font = '11px ' + col.mono; ctx.fillStyle = col.muted; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    spec.ticks.forEach(function (v) {
      ctx.strokeStyle = col.border; ctx.beginPath(); ctx.moveTo(sx0, SY(v)); ctx.lineTo(sx1, SY(v)); ctx.stroke();
      ctx.fillText(String(v), sx0 - 5, SY(v));
    });
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (var s = 0; s <= spec.T; s += spec.tStep) {
      ctx.textAlign = s === 0 ? 'left' : s + spec.tStep > spec.T ? 'right' : 'center';
      ctx.fillText(s + ' s', SX(s / spec.T * (n - 1)), sy1 + 4);
    }
    // reference
    ctx.save(); ctx.strokeStyle = col.muted; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(sx0, SY(spec.ref)); ctx.lineTo(sx1, SY(spec.ref)); ctx.stroke(); ctx.restore();
    // response, drawn progressively so it reads as a replay
    var shown = reduceMotion ? n : Math.min(n, Math.floor((d.stepAge || 0) / spec.replay * n));
    ctx.save(); ctx.beginPath(); ctx.rect(sx0, sy0, sx1 - sx0, sy1 - sy0); ctx.clip();
    ctx.strokeStyle = d.stable ? col.accent : col.bad; ctx.lineWidth = 2.2; ctx.beginPath();
    for (var i = 0; i < shown; i++) {
      var y = SY(clamp(data[i], yr[0] - 10, yr[1] + 10));
      if (i === 0) ctx.moveTo(SX(i), y); else ctx.lineTo(SX(i), y);
    }
    ctx.stroke(); ctx.restore();
    ctx.fillStyle = col.text; ctx.font = '600 12px ' + col.font; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(spec.title, sx0 + 6, sy0 + 2);
    if (!d.stable) {
      ctx.fillStyle = col.bad; ctx.font = '600 12px ' + col.font;
      ctx.fillText('Unstable', sx0 + 6, sy0 + 18);
    }
  }

  /* ---- Transfer-function line above the Nyquist / Poles plots ---- */

  function denStr(kind, den) {
    // The PID loop's denominator reads better factored: s(s² + 0.4s + 4).
    if (kind === 'pid') return 's(' + BodeCore.polyStr(den.slice(0, 3)) + ')';
    return BodeCore.polyStr(den);
  }
  function updateTf(d) {
    if (!d.tfDirty || !d.tfBox) return;
    d.tfDirty = false;
    var cfg = d.cfg, parts = BodeCore.loopParts(cfg.kind, d.p), lines = [];
    if (cfg.kind === 'plant') {
      lines.push('G(s) = 1 / (' + BodeCore.polyStr(parts.den) + ')');
      var pl = d.olPoles.filter(function (z) { return z[1] >= 0; })[0];
      if (pl) lines.push('poles at s = ' + fmt(pl[0], 2) + ' ± ' + fmt(Math.abs(pl[1]), 2) + 'j');
    } else {
      var num = parts.num.every(function (v) { return Math.abs(v) < 1e-12; }) ? '0' : BodeCore.polyStr(parts.num);
      var dl = d.p.delay > 0 ? ' · e^(−' + fmt(d.p.delay, 3).replace(/0+$/, '') + 's)' : '';
      lines.push('L(s) = (' + num + ') / (' + denStr(cfg.kind, parts.den) + ')' + dl);
      if (d.view === 'poles') {
        lines.push('1 + L(s) = 0  ⇒  ' + BodeCore.polyStr(BodeCore.closedLoopPoly(cfg.kind, d.p, 1)) + ' = 0' +
                   (d.p.delay > 0 ? '   (delay ≈ Padé)' : ''));
      }
    }
    d.tfBox.innerHTML = '';
    lines.forEach(function (t) { var el = document.createElement('div'); el.textContent = t; d.tfBox.appendChild(el); });
  }

  /* ---- A complex plane with equal scales on both axes ---- */

  function niceStep(span) {
    var raw = span / 6, e = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / e;
    return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * e;
  }

  // Lay out a plot box plus a notes box: notes to the right on wide screens, underneath
  // on narrow ones. `aspect` is the plot's preferred width / height.
  // On narrow screens only the key notes (not the muted, explanatory ones, which the
  // page text also covers) go under the plot, and the plot shrinks to fit them.
  function planeLayout(c, top, aspect, items) {
    var y0 = top + 6, y1 = c.H - 10;
    items = items.filter(Boolean);
    if (c.W >= 560) {
      var pw = clamp((y1 - y0) * aspect, c.W * 0.42, c.W * 0.62);
      return { plot: { x0: 12, x1: 12 + pw, y0: y0, y1: y1 },
               notes: { x0: 12 + pw + 18, x1: c.W - 14, y0: y0 + 4, y1: y1 }, items: items };
    }
    var key = items.filter(function (it) { return it[2] !== '400'; });
    var nb = { x0: 14, x1: c.W - 12, y0: 0, y1: 0 };
    var nh = notes(c.ctx, nb, key, true) + 4;
    return { plot: { x0: 12, x1: c.W - 12, y0: y0, y1: y1 - nh },
             notes: { x0: 14, x1: c.W - 12, y0: y1 - nh + 8, y1: y1 }, items: key };
  }

  // A complex plane with equal scales on both axes, centred on the data, in `box`.
  // opts.grid draws a labelled grid.
  function plane(c, box, reMin, reMax, imMax, opts) {
    var x0 = box.x0, x1 = box.x1, y0 = box.y0, y1 = box.y1;
    var k = Math.min((x1 - x0) / (reMax - reMin), (y1 - y0) / (2 * imMax));
    var mx = (x0 + x1) / 2, my = (y0 + y1) / 2, cre = (reMin + reMax) / 2;
    var f = {
      ctx: c.ctx, k: k, x0: x0, x1: x1, y0: y0, y1: y1,
      X: function (re) { return mx + (re - cre) * k; },
      Y: function (im) { return my - im * k; },
      reAt: function (x) { return cre + (x - mx) / k; },
      imAt: function (y) { return (my - y) / k; },
      inside: function (z) { var x = f.X(z[0]), y = f.Y(z[1]); return x >= x0 && x <= x1 && y >= y0 && y <= y1; }
    };
    var ctx = c.ctx, ax = clamp(f.X(0), x0, x1), ay = clamp(f.Y(0), y0, y1);
    ctx.lineWidth = 1; ctx.font = '10px ' + col.mono;
    if (opts.grid) {
      var step = niceStep(Math.max(f.reAt(x1) - f.reAt(x0), f.imAt(y0) - f.imAt(y1)));
      for (var v = Math.ceil(f.reAt(x0) / step) * step; v <= f.reAt(x1); v += step) {
        if (Math.abs(v) < 1e-9) continue;
        var x = f.X(v);
        ctx.strokeStyle = col.border; ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
        ctx.fillStyle = col.muted; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(String(+v.toFixed(6)), x, ay + 3);
      }
      for (var u = Math.ceil(f.imAt(y1) / step) * step; u <= f.imAt(y0); u += step) {
        if (Math.abs(u) < 1e-9) continue;
        var y = f.Y(u);
        ctx.strokeStyle = col.border; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
        ctx.fillStyle = col.muted; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(+u.toFixed(6) + 'j', ax + 4, y);
      }
    }
    // Real and imaginary axes.
    ctx.strokeStyle = col.muted; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(x0, ay); ctx.lineTo(x1, ay); ctx.moveTo(ax, y0); ctx.lineTo(ax, y1); ctx.stroke();
    ctx.strokeStyle = col.border; ctx.lineWidth = 1; ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);
    ctx.fillStyle = col.muted; ctx.font = '10px ' + col.mono;
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText('Re', x1 - 2, ay - 2);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText('Im', ax + 4, y0 + 2);
    return f;
  }

  function cross(ctx, x, y, r, color, lw) {
    ctx.strokeStyle = color; ctx.lineWidth = lw || 2;
    ctx.beginPath(); ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.stroke();
  }
  // Wrapped explanatory notes beside (or under) a plot. items: [text, color, weight].
  // With dry set, only measures: returns the height the notes need.
  function notes(ctx, box, items, dry) {
    var y = box.y0, maxW = box.x1 - box.x0;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    items.forEach(function (it) {
      if (!it) return;
      ctx.font = (it[2] || '600') + ' 12px ' + col.font;
      ctx.fillStyle = it[1] || col.text;
      var words = it[0].split(' '), line = '';
      words.forEach(function (w) {
        var t = line ? line + ' ' + w : w;
        if (ctx.measureText(t).width > maxW && line) { if (!dry) ctx.fillText(line, box.x0, y); y += 16; line = w; }
        else line = t;
      });
      if (line) { if (!dry) ctx.fillText(line, box.x0, y); y += 16; }
      y += 6;
    });
    return y - box.y0;
  }

  /* ---- Poles: where the system's natural motions live ---- */

  var frameDt = 0;

  function easePoles(d, targets) {
    // Glide the drawn closed-loop poles toward the new ones so a slider drag reads as motion.
    if (!d.shownPoles || d.shownPoles.length !== targets.length || reduceMotion) {
      d.shownPoles = targets.map(function (z) { return z.slice(); });
      return d.shownPoles;
    }
    var used = targets.map(function () { return false; }), a = Math.min(1, frameDt * 12);
    d.shownPoles.forEach(function (sp) {
      var best = -1, bd = Infinity;
      targets.forEach(function (t, j) {
        if (used[j]) return;
        var dd = Math.hypot(t[0] - sp[0], t[1] - sp[1]);
        if (dd < bd) { bd = dd; best = j; }
      });
      used[best] = true;
      sp[0] += (targets[best][0] - sp[0]) * a;
      sp[1] += (targets[best][1] - sp[1]) * a;
    });
    return d.shownPoles;
  }

  function drawPoles(d) {
    var c = fit(d.altC), ctx = c.ctx, cfg = d.cfg, loop = cfg.kind !== 'plant';
    var top = (d.tfBox ? d.tfBox.offsetHeight : 0) + 10;
    if (loop && !d.locus) d.locus = BodeCore.rootLocus(cfg.kind, d.p, 3, 90);

    // Fit the poles and zeros that matter (far-off delay-approximation poles excepted).
    var pts = d.olPoles.concat(d.olZeros, loop ? d.clPoles : []).filter(function (z) { return cabs(z) < 25; });
    var reMin = loop ? -2 : -3, reMax = 1, imMax = loop ? 2 : 4.2;
    pts.forEach(function (z) { reMin = Math.min(reMin, z[0]); reMax = Math.max(reMax, z[0]); imMax = Math.max(imMax, Math.abs(z[1])); });
    var span = reMax - reMin; reMin -= span * 0.1; reMax += span * 0.1; imMax *= 1.18;
    var items = loop ? loopPoleNotes(d) : introPoleNotes(d);
    var lay = planeLayout(c, top, (reMax - reMin) / (2 * imMax), items);
    var f = plane(c, lay.plot, reMin, reMax, imMax, { grid: true });

    // Right half-plane: anything there grows.
    var xr = clamp(f.X(0), f.x0, f.x1);
    ctx.fillStyle = withAlpha(col.bad, 0.07); ctx.fillRect(xr, f.y0, f.x1 - xr, f.y1 - f.y0);
    ctx.font = '600 11px ' + col.font; ctx.textBaseline = 'top';
    if (f.x1 - xr > 60) { ctx.fillStyle = col.bad; ctx.textAlign = 'right'; ctx.fillText('grows', f.x1 - 6, f.y0 + 4); }
    if (xr - f.x0 > 60) { ctx.fillStyle = col.muted; ctx.textAlign = 'left'; ctx.fillText('dies away', f.x0 + 6, f.y0 + 4); }

    ctx.save(); ctx.beginPath(); ctx.rect(f.x0, f.y0, f.x1 - f.x0, f.y1 - f.y0); ctx.clip();
    // Root locus: every gain scaled together from 0 to 3×.
    if (loop) {
      ctx.fillStyle = withAlpha(col.accent, 0.28);
      d.locus.forEach(function (rs) {
        rs.forEach(function (z) { ctx.beginPath(); ctx.arc(f.X(z[0]), f.Y(z[1]), 1.6, 0, 7); ctx.fill(); });
      });
    }
    // Open-loop poles × and zeros ○.
    d.olPoles.forEach(function (z) { cross(ctx, f.X(z[0]), f.Y(z[1]), 6, loop ? col.muted : col.out, 2.2); });
    d.olZeros.forEach(function (z) {
      ctx.strokeStyle = col.muted; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(f.X(z[0]), f.Y(z[1]), 6, 0, 7); ctx.stroke();
    });

    if (!loop) {
      // Intro: gain and phase at ω from the vectors joining each pole to the point jω.
      var jy = f.Y(d.w), off = jy < f.y0;
      var px = f.X(0), py = Math.max(jy, f.y0 + 6);
      d.olPoles.forEach(function (z, i) {
        ctx.strokeStyle = col.out; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(f.X(z[0]), f.Y(z[1])); ctx.lineTo(px, jy); ctx.stroke();
        ctx.setLineDash([]);
        var mx = (f.X(z[0]) + px) / 2, my = (f.Y(z[1]) + py) / 2;
        ctx.fillStyle = col.out; ctx.font = '600 11px ' + col.mono; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillText('d' + (i ? '₂' : '₁'), mx - 6, my);
      });
      dot(ctx, px, py);
      ctx.fillStyle = col.out; ctx.font = '600 11px ' + col.mono; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText('jω = ' + fmtW(d.w) + 'j' + (off ? ' ↑ above view' : ''), px + 9, py);
      ctx.restore();
      notes(ctx, lay.notes, lay.items);
      return;
    }

    // Closed-loop poles, where the controller has moved them.
    var shown = easePoles(d, d.clPoles), offscreen = 0;
    shown.forEach(function (z) {
      if (!f.inside(z)) { offscreen++; return; }
      ctx.fillStyle = z[0] < -1e-6 ? col.accent : col.bad;
      ctx.beginPath(); ctx.arc(f.X(z[0]), f.Y(z[1]), 6, 0, 7); ctx.fill();
      ctx.strokeStyle = col.surface; ctx.lineWidth = 1.5; ctx.stroke();
    });
    ctx.restore();
    d.offscreen = offscreen;      // reported in next frame's notes
    notes(ctx, lay.notes, lay.items);
  }

  function introPoleNotes(d) {
    var dists = [], angs = [];
    d.olPoles.forEach(function (z) {
      dists.push(Math.hypot(z[0], d.w - z[1])); angs.push(Math.atan2(d.w - z[1], -z[0]));
    });
    var g = 1 / (dists[0] * dists[1]);
    return [
      ['Each × is a pole: a natural motion of the mass. Its height (±1.99) is how fast it rings, its distance left of the axis how fast that dies away.', col.muted, '400'],
      ['Shaking at ω means evaluating G at the point jω on the imaginary axis.', col.muted, '400'],
      ['Gain = 1 / (d₁ · d₂) = 1 / (' + fmt(dists[0], 2) + ' × ' + fmt(dists[1], 2) + ') = ' + fmt(g, g < 0.01 ? 4 : 3)],
      ['Phase = −(angle₁ + angle₂) = ' + fmt(-(angs[0] + angs[1]) * 180 / Math.PI, 0) + '°'],
      ['Sweep the frequency: as jω slides past the upper pole, d₁ gets tiny and the gain peaks. That is the resonance on the Bode plot.', col.out]
    ];
  }

  function loopPoleNotes(d) {
    // The slowest pole sets how the step response settles.
    var slow = null;
    d.clPoles.forEach(function (z) { if (slow === null || z[0] > slow[0]) slow = z; });
    var verdict = null;
    if (slow) {
      if (slow[0] >= -1e-6) verdict = ['A closed-loop pole is in the right half-plane, so the response grows like e^(' + fmt(slow[0], 2) + 't): unstable.', col.bad];
      else verdict = ['Slowest closed-loop pole at σ = ' + fmt(slow[0], 2) + ', so the response settles in about ' + fmt(4 / -slow[0], 4 / -slow[0] < 10 ? 1 : 0) + ' s' +
                      (Math.abs(slow[1]) > 0.05 ? ', ringing at ' + fmt(Math.abs(slow[1]), 1) + ' rad/s.' : '.'), col.accent];
    }
    return [
      ['× open-loop poles (plant and controller), ○ zeros, ● closed-loop poles: the roots of 1 + L(s) = 0.', col.muted, '400'],
      ['The faint trail is the root locus: where the closed-loop poles go as every gain is scaled from 0 to 3×. Drag a gain to watch them move.', col.muted, '400'],
      verdict,
      d.p.delay > 0 ? ['Delay has infinitely many poles; these use a Padé approximation, so near the edge trust Stability in the panel.', col.muted, '400'] : null,
      d.offscreen ? [d.offscreen + ' pole' + (d.offscreen > 1 ? 's' : '') + ' off-screen, far to the left (fast, harmless).', col.muted, '400'] : null
    ];
  }

  /* ---- Nyquist: the same L(jω) as one curve in the complex plane ---- */

  // Magnitudes above 1 are log-compressed so the far part of the curve fits while the
  // unit circle and the −1 point (where the action is) keep their true places.
  function rho(r) { return r <= 1 ? r : 1 + 0.5 * Math.log10(r); }
  function nyqPt(L) { var a = carg(L), q = rho(cabs(L)); return [q * Math.cos(a), q * Math.sin(a)]; }

  function drawNyquist(d) {
    var c = fit(d.altC), ctx = c.ctx, cfg = d.cfg;
    var top = (d.tfBox ? d.tfBox.offsetHeight : 0) + 10;
    var pts = d.nyqL.map(nyqPt), R = 2;
    pts.forEach(function (q) { R = Math.max(R, Math.hypot(q[0], q[1])); });
    R = Math.min(R, 2.6) + 0.15;
    var lay = planeLayout(c, top, 1, nyquistNotes(d));
    var f = plane(c, lay.plot, -R, R, R, {});

    // Rings: |L| = 1 (the one that matters), 10 and 100.
    [[1, '|L| = 1'], [1.5, '10'], [2, '100'], [2.5, '1000']].forEach(function (rg) {
      if (rg[0] > R) return;
      ctx.strokeStyle = rg[0] === 1 ? col.borderStrong : col.border; ctx.lineWidth = rg[0] === 1 ? 1.4 : 1;
      ctx.setLineDash(rg[0] === 1 ? [5, 4] : [2, 4]);
      ctx.beginPath(); ctx.arc(f.X(0), f.Y(0), rg[0] * f.k, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = col.muted; ctx.font = '10px ' + col.mono; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText(rg[1], f.X(0) + rg[0] * f.k * 0.71 + 3, f.Y(0) - rg[0] * f.k * 0.71 - 2);
    });

    ctx.save(); ctx.beginPath(); ctx.rect(f.x0, f.y0, f.x1 - f.x0, f.y1 - f.y0); ctx.clip();
    function path(sign) {
      ctx.beginPath();
      pts.forEach(function (q, i) { var x = f.X(q[0]), y = f.Y(sign * q[1]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.stroke();
    }
    // Negative frequencies: the mirror image, faint.
    ctx.strokeStyle = withAlpha(col.in, 0.35); ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]); path(-1); ctx.setLineDash([]);
    ctx.strokeStyle = col.in; ctx.lineWidth = 2.2; path(1);
    // Arrows show which way ω increases.
    for (var a = 1; a <= 5; a++) {
      var i = Math.floor(pts.length * a / 6), q0 = pts[i - 2], q1 = pts[i + 2];
      if (!q0 || !q1) continue;
      var ang = Math.atan2(-(q1[1] - q0[1]), q1[0] - q0[0]), ax = f.X(pts[i][0]), ay = f.Y(pts[i][1]);
      if (Math.hypot(q1[0] - q0[0], q1[1] - q0[1]) * f.k < 2) continue;
      ctx.fillStyle = col.in; ctx.save(); ctx.translate(ax, ay); ctx.rotate(ang);
      ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-5, -4.5); ctx.lineTo(-5, 4.5); ctx.closePath(); ctx.fill(); ctx.restore();
    }

    // Margins as geometry: PM is an arc on the unit circle, GM a stretch of the negative real axis.
    var s = d.sum;
    if (d.stable && s.wc !== null) {
      var Lc = LOOPS[cfg.kind]([0, s.wc], d.p), ac = carg(Lc);
      var a0 = Math.PI, da = BodeCore.wrap180((ac - a0) * 180 / Math.PI) * Math.PI / 180;
      ctx.strokeStyle = col.pm; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(f.X(0), f.Y(0), f.k, -a0, -(a0 + da), da > 0); ctx.stroke();
      var mid = a0 + da / 2;
      var tx = f.X(Math.cos(mid) * 1.25), ty = f.Y(Math.sin(mid) * 1.25);
      tag(ctx, 'PM ' + fmt(s.pm, 0) + '°', tx + (Math.cos(mid) < 0 ? -4 : 4), ty, col.pm, Math.cos(mid) < 0 ? 'right' : 'left');
    }
    if (d.stable) [[s.wUp, s.gmUp], [s.wDown, s.gmDown]].forEach(function (g, gi) {
      if (g[0] === null) return;
      var r = rho(Math.pow(10, -g[1] / 20));
      ctx.strokeStyle = col.gm; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(f.X(-r), f.Y(0)); ctx.lineTo(f.X(-1), f.Y(0)); ctx.stroke();
      tag(ctx, 'GM ' + (g[1] > 0 ? '+' : '') + fmt(g[1], 1) + ' dB', f.X(-Math.max(r, 1)) - 6, f.Y(0) + (gi ? -14 : 14), col.gm, 'right');
    });
    ctx.restore();

    // The critical point.
    cross(ctx, f.X(-1), f.Y(0), 6, col.bad, 2.5);
    ctx.fillStyle = col.bad; ctx.font = '600 11px ' + col.mono; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText('−1', f.X(-1), f.Y(0) - 9);

    // Where the frequency slider is.
    var q = nyqPt(LOOPS[cfg.kind]([0, d.w], d.p));
    if (f.inside([q[0], q[1]])) dot(ctx, f.X(q[0]), f.Y(q[1]));

    notes(ctx, lay.notes, lay.items);
  }

  // Encirclement count: Z = P + N.
  function nyquistNotes(d) {
    var N = d.Z - d.P;
    var circ = N === 0 ? 'The curve never circles −1.' : 'The curve circles −1 ' + (Math.abs(N) === 1 ? 'once ' : Math.abs(N) + ' times ') + (N > 0 ? 'clockwise.' : 'counterclockwise.');
    return [
      ['Each point is L(jω): the gain is its distance from the centre, the phase its angle. The arrows show ω rising; the dashed mirror is negative ω.', col.muted, '400'],
      ['The loop oscillates on its own if the curve passes through −1 (gain 1, phase −180°). The margins measure how far it stays from that point.', col.muted, '400'],
      [circ + (d.P ? ' The plant has ' + d.P + ' unstable pole of its own, and the loop only cancels it by circling −1 counterclockwise exactly that many times.' : '')],
      ['Unstable closed-loop poles = ' + d.P + ' (plant) ' + (N >= 0 ? '+ ' : '− ') + Math.abs(N) + ' (circles) = ' + d.Z + (d.Z === 0 ? ': stable.' : ': unstable.'), d.Z === 0 ? col.accent : col.bad],
      ['Gains above 1 are drawn on a log scale so the whole curve fits.', col.muted, '400']
    ];
  }

  /* ---- Readouts in the side panel ---- */
  function updateReadouts(d) {
    var $ = function (s) { return document.getElementById(d.cfg.id + '-' + s); };
    var s = d.sum, st = $('stable');
    if (st) {
      st.textContent = d.stable ? 'Stable' : 'Unstable';
      st.classList.toggle('bode-bad', !d.stable);
    }
    function set(id, txt) { var el = $(id); if (el) el.textContent = txt; }
    if (!d.stable) { ['pm', 'wc', 'gmup', 'gmdown', 'dm'].forEach(function (k) { set(k, '-'); }); return; }
    set('pm', s.pm === null ? 'none' : fmt(s.pm, 0) + '°');
    set('wc', s.wc === null ? '-' : fmtW(s.wc) + ' rad/s');
    set('gmup', s.gmUp === null ? '∞' : '+' + fmt(s.gmUp, 1) + ' dB');
    set('gmdown', s.gmDown === null ? '∞' : fmt(s.gmDown, 1) + ' dB');
    set('dm', s.delayMargin === null ? '-' : fmt(s.delayMargin * 1000, 0) + ' ms');
  }

  /* ---- The three demos ---- */
  var gainFmt1 = function (v) { return fmt(v, 1); };
  var gainFmt2 = function (v) { return fmt(v, 2); };
  var msFmt = function (v) { return fmt(v, 0) + ' ms'; };

  var demos = [
    makeDemo({
      id: 'intro', kind: 'plant', wmin: 0.1, wmax: 30, w0: 0.3, reveal: true,
      polesLabel: 'Poles of the mass-spring-damper in the complex plane, with lines from each pole to the point jω',
      params: function () { return {}; },
      draw: drawIntroTop,
      onRecompute: function () {}
    }),
    makeDemo({
      id: 'pid', kind: 'pid', wmin: 0.05, wmax: 100, w0: 1,
      nyqLabel: 'Nyquist plot of the PID loop around the critical point −1',
      polesLabel: 'Open- and closed-loop poles of the PID loop with its root locus',
      params: function () { return { kp: 40, ki: 5, kd: 6, delay: 0 }; },
      sliders: [
        { name: 'kp', signed: true, preset: 40, fmt: gainFmt1, set: function (p, v) { p.kp = v; } },
        { name: 'ki', signed: true, preset: 5, fmt: gainFmt1, set: function (p, v) { p.ki = v; } },
        { name: 'kd', signed: true, preset: 6, fmt: gainFmt2, set: function (p, v) { p.kd = v; } },
        { name: 'delay', preset: 0, fmt: msFmt, set: function (p, v) { p.delay = v / 1000; } }
      ],
      step: function (p) { return pidStep(p, 10, 0.002); },
      stepSpec: { title: 'Step response, x (m)', T: 10, tStep: 2, range: [-0.5, 2], ticks: [0, 1, 2], ref: 1, replay: 2.5 },
      draw: drawLoopTop,
      onRecompute: function (d) { d.stepAge = 0; updateReadouts(d); }
    }),
    makeDemo({
      id: 'lqr', kind: 'lqr', wmin: 0.05, wmax: 100, w0: 1,
      nyqLabel: 'Nyquist plot of the cart-pole state-feedback loop around the critical point −1',
      polesLabel: 'Open- and closed-loop poles of the cart-pole loop with its root locus',
      params: function () { return { k: CP_LQR.slice(), delay: 0 }; },
      sliders: [
        { name: 'kx', signed: true, preset: CP_LQR[0], fmt: gainFmt1, set: function (p, v) { p.k[0] = v; } },
        { name: 'kv', signed: true, preset: CP_LQR[1], fmt: gainFmt1, set: function (p, v) { p.k[1] = v; } },
        { name: 'kth', signed: true, preset: CP_LQR[2], fmt: gainFmt1, set: function (p, v) { p.k[2] = v; } },
        { name: 'kw', signed: true, preset: CP_LQR[3], fmt: gainFmt1, set: function (p, v) { p.k[3] = v; } },
        { name: 'delay', preset: 0, fmt: msFmt, set: function (p, v) { p.delay = v / 1000; } }
      ],
      step: function (p) { return lqrTilt(p, 10, 0.002); },
      stepSpec: { title: 'Pole angle after a 3° tilt, θ (°)', T: 10, tStep: 2, range: [-6, 6], ticks: [-5, 0, 5], ref: 0, replay: 2.5 },
      draw: drawLoopTop,
      onRecompute: function (d) { d.stepAge = 0; updateReadouts(d); }
    })
  ].filter(Boolean);

  // Re-run the step replay whenever a demo's tab is opened.
  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      demos.forEach(function (d) { if (d.sec.classList.contains('active')) d.stepAge = 0; });
    });
  });

  var last = null;
  function frame(ts) {
    var dt = last === null ? 0 : Math.min(0.1, (ts - last) / 1000);
    frameDt = dt;
    last = ts;
    readColors();
    demos.forEach(function (d) {
      if (!d.sec.classList.contains('active')) return;
      d.tickSweep(dt);
      d.phase += dt * CYCLES_PER_SEC;
      d.stepAge = (d.stepAge || 0) + dt;
      d.cfg.draw(d);
      if (d.view === 'bode') drawBode(d);
      else { updateTf(d); if (d.view === 'nyquist') drawNyquist(d); else drawPoles(d); }
    });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})(typeof window !== 'undefined' ? window : this);
