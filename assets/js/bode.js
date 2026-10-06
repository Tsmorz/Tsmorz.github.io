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

  function polyRoots(c) {
    var n = c.length - 1, z = [], i, it;
    for (i = 0; i < n; i++) z.push(cmul([0.4, 0.9], i === 0 ? [1, 0] : z[i - 1]));
    function ev(x) { var r = [1, 0]; for (var k = 1; k <= n; k++) r = cadd(cmul(r, x), [c[k], 0]); return r; }
    for (it = 0; it < 500; it++) {
      for (i = 0; i < n; i++) {
        var den = [1, 0];
        for (var j = 0; j < n; j++) if (j !== i) den = cmul(den, csub(z[i], z[j]));
        z[i] = csub(z[i], cdiv(ev(z[i]), den));
      }
    }
    return z;
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
    charPoly: charPoly, polyRoots: polyRoots,
    unstableOpenLoopPoles: unstableOpenLoopPoles, closedLoopRhpPoles: closedLoopRhpPoles,
    pidStep: pidStep, lqrTilt: lqrTilt
  };

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
        d.stable = closedLoopRhpPoles(cfg.kind, d.p) === 0;
        d.step = cfg.step(d.p);
      }
      if (cfg.onRecompute) cfg.onRecompute(d);
    };

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
      params: function () { return {}; },
      draw: drawIntroTop,
      onRecompute: function () {}
    }),
    makeDemo({
      id: 'pid', kind: 'pid', wmin: 0.05, wmax: 100, w0: 1,
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
    last = ts;
    readColors();
    demos.forEach(function (d) {
      if (!d.sec.classList.contains('active')) return;
      d.tickSweep(dt);
      d.phase += dt * CYCLES_PER_SEC;
      d.stepAge = (d.stepAge || 0) + dt;
      d.cfg.draw(d);
      drawBode(d);
    });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})(typeof window !== 'undefined' ? window : this);
