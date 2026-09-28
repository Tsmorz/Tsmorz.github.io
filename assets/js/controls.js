// Controls page — three interactive demos.
// Tab switcher, mass-spring-damper PID, 6-DOF 3-D flight sim, system ID + LQR.
(function () {
  'use strict';

  /* Polyfill ctx.roundRect for older Safari / Firefox */
  if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
      var rad = Math.min(r, Math.min(w, h) / 2);
      this.moveTo(x + rad, y);
      this.arcTo(x + w, y,     x + w, y + h, rad);
      this.arcTo(x + w, y + h, x,     y + h, rad);
      this.arcTo(x,     y + h, x,     y,     rad);
      this.arcTo(x,     y,     x + w, y,     rad);
      this.closePath();
    };
  }

  /* ================================================================
     Shared utilities
  ================================================================ */

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function deg2rad(d) { return d * Math.PI / 180; }
  function rad2deg(r) { return r * 180 / Math.PI; }

  // Read a CSS token as a string
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  // RK4 integrator: state[], fn(t, state) -> deriv[], dt -> new state[]
  function rk4(state, t, dt, fn) {
    var k1 = fn(t, state);
    var k2 = fn(t + dt / 2, state.map(function (s, i) { return s + k1[i] * dt / 2; }));
    var k3 = fn(t + dt / 2, state.map(function (s, i) { return s + k2[i] * dt / 2; }));
    var k4 = fn(t + dt,     state.map(function (s, i) { return s + k3[i] * dt; }));
    return state.map(function (s, i) {
      return s + (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]) * dt / 6;
    });
  }

  /* ================================================================
     Tab switcher
  ================================================================ */
  var tabs    = document.querySelectorAll('.sim-tab');
  var sections = document.querySelectorAll('.sim-section');

  function activateTab(idx) {
    tabs.forEach(function (t, i) {
      t.classList.toggle('active', i === idx);
      t.setAttribute('aria-selected', i === idx ? 'true' : 'false');
    });
    sections.forEach(function (s, i) {
      s.classList.toggle('active', i === idx);
    });
  }

  tabs.forEach(function (tab, i) {
    tab.addEventListener('click', function () { activateTab(i); });
  });

  /* ================================================================
     Demo 1 — Mass-Spring-Damper PID
  ================================================================ */
  (function msdDemo() {
    var canvas = document.getElementById('msd-canvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');

    // Physics params
    var M = 1, K_spring = 4, C_damp = 0.4;  // underdamped (ζ ≈ 0.1)
    var OMEGA_REF = 0.5, AMP_REF = 1.0;

    // Simulation state
    var sim = { x: 0, v: 0, t: 0, intE: 0, prevE: 0 };

    // PID gains + disturbances (from sliders)
    var pid = { kp: 0, ki: 0, kd: 0, delay: 0, noise: 0 };

    // Transport-delay buffer: commanded forces awaiting application
    var forceBuf = [];

    // Standard-normal sample (Box–Muller) for sensor noise
    function gaussian() {
      var u = 0, v = 0;
      while (u === 0) u = Math.random();
      while (v === 0) v = Math.random();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }

    // History ring buffer for RMSE (last 5 s @ 200 Hz = 1000 samples)
    var RING = 1000;
    var errRing = [];
    var bestScore = null;

    // Scrolling time-series buffer (last ~8 s of display)
    var HIST = 600;
    var hist = { xArr: [], refArr: [], time: [] };

    // PID contribution history for contribution plot
    var CHIST = 300;
    var pidContrib = { p: [], i: [], d: [], total: [] };

    // Sliders
    var kpSlider  = document.getElementById('msd-kp');
    var kiSlider  = document.getElementById('msd-ki');
    var kdSlider  = document.getElementById('msd-kd');
    var kpVal     = document.getElementById('msd-kp-val');
    var kiVal     = document.getElementById('msd-ki-val');
    var kdVal     = document.getElementById('msd-kd-val');
    var scoreEl   = document.getElementById('msd-score');
    var bestEl    = document.getElementById('msd-best');
    var resetBtn  = document.getElementById('msd-reset');
    var delaySlider = document.getElementById('msd-delay');
    var delayAmt    = document.getElementById('msd-delay-amt');
    var delayVal    = document.getElementById('msd-delay-val');
    var noiseSlider = document.getElementById('msd-noise');
    var noiseVal    = document.getElementById('msd-noise-val');

    function syncSliders() {
      pid.kp = parseFloat(kpSlider.value);
      pid.ki = parseFloat(kiSlider.value);
      pid.kd = parseFloat(kdSlider.value);
      pid.delay = delaySlider ? parseFloat(delaySlider.value) : 0;
      pid.noise = noiseSlider ? parseFloat(noiseSlider.value) : 0;
      kpVal.textContent = pid.kp.toFixed(1);
      kiVal.textContent = pid.ki.toFixed(1);
      kdVal.textContent = pid.kd.toFixed(2);
      if (delayVal) delayVal.textContent = Math.round(pid.delay) + ' ms';
      if (noiseVal) noiseVal.textContent = pid.noise.toFixed(2);
    }
    function applyRange(slider, rangeInput) {
      var r = Math.max(1, parseFloat(rangeInput.value) || 1);
      var prev = parseFloat(slider.value);
      slider.min  = -r;
      slider.max  =  r;
      slider.step =  r / 100;
      slider.value = clamp(prev, -r, r);
    }
    var kpRange = document.getElementById('msd-kp-range');
    var kiRange = document.getElementById('msd-ki-range');
    var kdRange = document.getElementById('msd-kd-range');
    [[kpSlider, kpRange], [kiSlider, kiRange], [kdSlider, kdRange]].forEach(function (pair) {
      var sl = pair[0], ri = pair[1];
      if (ri) ri.addEventListener('input', function () { applyRange(sl, ri); syncSliders(); });
    });
    [kpSlider, kiSlider, kdSlider, noiseSlider].forEach(function (s) {
      if (s) s.addEventListener('input', syncSliders);
    });
    // Delay slider and its numeric "amount" input stay in sync both ways.
    if (delaySlider && delayAmt) {
      var delayMax = parseFloat(delaySlider.max) || 1000;
      delaySlider.addEventListener('input', function () {
        delayAmt.value = delaySlider.value;
        syncSliders();
      });
      delayAmt.addEventListener('input', function () {
        var v = clamp(parseFloat(delayAmt.value) || 0, 0, delayMax);
        delaySlider.value = v;
        syncSliders();
      });
    }
    syncSliders();

    function resetSim() {
      sim.x = 0; sim.v = 0; sim.t = 0;
      sim.intE = 0; sim.prevE = 0;
      errRing = [];
      forceBuf.length = 0;
      hist.xArr = []; hist.refArr = []; hist.time = [];
      pidContrib.p = []; pidContrib.i = []; pidContrib.d = []; pidContrib.total = [];
      bestScore = null;
      if (bestEl) bestEl.textContent = '';
    }
    if (resetBtn) resetBtn.addEventListener('click', resetSim);

    var DT = 0.005;  // 200 Hz

    function step() {
      // 5 physics steps per timer tick (step called at 40 Hz → 200 Hz effective)
      var P_t = 0, I_t = 0, D_t = 0, F = 0;
      for (var i = 0; i < 5; i++) {
        var ref = AMP_REF * Math.sin(OMEGA_REF * sim.t);
        // Controller sees a noisy measurement of position, not the true state.
        var xMeas = sim.x + (pid.noise > 0 ? gaussian() * pid.noise : 0);
        var e   = ref - xMeas;
        sim.intE  = clamp(sim.intE + e * DT, -20, 20);
        var de  = (e - sim.prevE) / DT;
        P_t = pid.kp * e; I_t = pid.ki * sim.intE; D_t = pid.kd * de;
        F   = P_t + I_t + D_t;
        sim.prevE = e;
        // Transport delay: the plant feels the command from `delay` ms ago.
        forceBuf.push(F);
        var delaySamples = Math.round((pid.delay / 1000) / DT);
        var Fapplied = (forceBuf.length > delaySamples) ? forceBuf.shift() : 0;
        // Fapplied is constant over this step (zero-order hold on control)
        var s = rk4([sim.x, sim.v], sim.t, DT, function (t2, s2) {
          return [s2[1], (Fapplied - C_damp * s2[1] - K_spring * s2[0]) / M];
        });
        sim.x = s[0]; sim.v = s[1];
        sim.t += DT;
        var err = ref - sim.x;
        errRing.push(err * err);
        if (errRing.length > RING) errRing.shift();
      }
      // History for plot
      var refNow = AMP_REF * Math.sin(OMEGA_REF * sim.t);
      hist.xArr.push(sim.x);
      hist.refArr.push(refNow);
      hist.time.push(sim.t);
      if (hist.xArr.length > HIST) {
        hist.xArr.shift(); hist.refArr.shift(); hist.time.shift();
      }
      // PID contribution history
      pidContrib.p.push(P_t); pidContrib.i.push(I_t); pidContrib.d.push(D_t); pidContrib.total.push(F);
      if (pidContrib.p.length > CHIST) {
        pidContrib.p.shift(); pidContrib.i.shift(); pidContrib.d.shift(); pidContrib.total.shift();
      }
      // Score
      if (errRing.length > 0) {
        var rmse = Math.sqrt(errRing.reduce(function (a, b) { return a + b; }, 0) / errRing.length);
        scoreEl.textContent = rmse.toFixed(3);
        if (bestScore === null || rmse < bestScore) {
          bestScore = rmse;
          if (bestEl) bestEl.textContent = 'Best: ' + rmse.toFixed(3) + ' m';
        }
      }
    }

    // Canvas rendering
    function drawSpring(ctx, x1, y1, x2, y2, coils) {
      var dx = x2 - x1, dy = y2 - y1;
      var len = Math.hypot(dx, dy);
      var nx = dx / len, ny = dy / len;
      var px = -ny, py = nx;
      var A = 10;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      var n = coils * 2;
      for (var i = 0; i <= n; i++) {
        var t = i / n;
        var cx = x1 + dx * t;
        var cy = y1 + dy * t;
        var off = (i % 2 === 0 ? 1 : -1) * A;
        if (i === 0 || i === n) off = 0;
        ctx.lineTo(cx + px * off, cy + py * off);
      }
      ctx.stroke();
    }

    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var ANIM_H = 320, TS_H = 320;
    var tsCanvas = document.getElementById('msd-ts-plot');
    var tsCtx = tsCanvas ? tsCanvas.getContext('2d') : null;

    function sizeOne(cv, cx2, h) {
      var w = cv.clientWidth || parseInt(cv.getAttribute('width'), 10) || 200;
      cv.width  = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      cv.style.height = h + 'px';
      cx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function resizeCanvas() {
      sizeOne(canvas, ctx, ANIM_H);
      if (tsCtx) sizeOne(tsCanvas, tsCtx, TS_H);
    }
    var wrapEl = canvas.closest('.sim-canvas-wrap') || canvas.parentElement;
    new ResizeObserver(resizeCanvas).observe(wrapEl);
    resizeCanvas();

    // === Compact spring-mass animation (left) ===
    function renderAnim() {
      var W = canvas.clientWidth, H = ANIM_H;
      if (!W) return;
      ctx.clearRect(0, 0, W, H);

      var textColor  = cssVar('--text');
      var mutedColor = cssVar('--text-muted');
      var accentColor = cssVar('--accent');
      var borderColor = cssVar('--border');
      var bgSoft = cssVar('--bg-soft');

      var cx = W / 2;
      var anchorY = 26;
      var massH = 42, massW = 54;
      var scale = 80;  // 1 m = 80px
      var massY = H / 2 + sim.x * scale;
      var refY  = H / 2 + AMP_REF * Math.sin(OMEGA_REF * sim.t) * scale;

      // Reference dashed line
      ctx.save();
      ctx.strokeStyle = accentColor;
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx - 38, refY);
      ctx.lineTo(cx + 38, refY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // Anchor bar
      ctx.fillStyle = mutedColor;
      ctx.fillRect(cx - 32, anchorY - 8, 64, 8);

      // Spring
      ctx.strokeStyle = mutedColor;
      ctx.lineWidth = 1.5;
      drawSpring(ctx, cx, anchorY, cx, massY - massH / 2, 7);

      // Mass block
      ctx.fillStyle = bgSoft;
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(cx - massW / 2, massY - massH / 2, massW, massH, 6);
      ctx.fill();
      ctx.stroke();

      // "m" label on mass
      ctx.fillStyle = textColor;
      ctx.font = '600 13px ' + cssVar('--font');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('m', cx, massY);
    }

    // === Wide reference-tracking time-series plot (right) ===
    function renderPlot() {
      if (!tsCtx) return;
      var W = tsCanvas.clientWidth, H = TS_H;
      if (!W) return;
      tsCtx.clearRect(0, 0, W, H);

      var textColor  = cssVar('--text');
      var mutedColor = cssVar('--text-muted');
      var accentColor = cssVar('--accent');
      var borderColor = cssVar('--border');

      var px0 = 38, py0 = 16, pw = W - px0 - 14, ph = H - 38;
      var yMap = function (v) { return py0 + ph / 2 - v * (ph / 2 - 12) / AMP_REF; };

      // Axis label
      tsCtx.fillStyle = mutedColor;
      tsCtx.font = '11px ' + cssVar('--mono');
      tsCtx.textAlign = 'left';
      tsCtx.textBaseline = 'top';
      tsCtx.fillText('x (m)', px0 + 2, py0);

      // Grid line at 0
      tsCtx.strokeStyle = borderColor;
      tsCtx.setLineDash([3, 3]);
      tsCtx.beginPath();
      tsCtx.moveTo(px0, yMap(0));
      tsCtx.lineTo(px0 + pw, yMap(0));
      tsCtx.stroke();
      tsCtx.setLineDash([]);

      if (hist.xArr.length > 1) {
        var xStep = pw / HIST;

        // Reference (dashed accent)
        tsCtx.strokeStyle = accentColor;
        tsCtx.lineWidth = 1.5;
        tsCtx.setLineDash([5, 4]);
        tsCtx.beginPath();
        for (var i = 0; i < hist.refArr.length; i++) {
          var xx = px0 + (i - hist.refArr.length + HIST) * xStep;
          var yy = yMap(hist.refArr[i]);
          if (i === 0) tsCtx.moveTo(xx, yy); else tsCtx.lineTo(xx, yy);
        }
        tsCtx.stroke();
        tsCtx.setLineDash([]);

        // Actual position (solid)
        tsCtx.strokeStyle = textColor;
        tsCtx.lineWidth = 1.8;
        tsCtx.beginPath();
        for (var j = 0; j < hist.xArr.length; j++) {
          var xx2 = px0 + (j - hist.xArr.length + HIST) * xStep;
          var yy2 = yMap(hist.xArr[j]);
          if (j === 0) tsCtx.moveTo(xx2, yy2); else tsCtx.lineTo(xx2, yy2);
        }
        tsCtx.stroke();
      }

      // Y-axis ticks
      tsCtx.fillStyle = mutedColor;
      tsCtx.font = '10px ' + cssVar('--mono');
      tsCtx.textAlign = 'right';
      tsCtx.textBaseline = 'middle';
      tsCtx.fillText(AMP_REF.toFixed(1), px0 - 4, yMap(AMP_REF));
      tsCtx.fillText('0', px0 - 4, yMap(0));
      tsCtx.fillText((-AMP_REF).toFixed(1), px0 - 4, yMap(-AMP_REF));

      // Legend
      tsCtx.font = '11px ' + cssVar('--mono');
      tsCtx.textAlign = 'right';
      tsCtx.textBaseline = 'bottom';
      tsCtx.fillStyle = accentColor;
      tsCtx.fillText('— reference', px0 + pw, H - 4);
      tsCtx.fillStyle = textColor;
      tsCtx.fillText('— actual', px0 + pw - 92, H - 4);
    }

    var stepTimer = setInterval(function () {
      if (document.getElementById('sec-msd').classList.contains('active')) step();
    }, 25);

    var msdPidCanvas = document.getElementById('msd-pid-plot');

    var rafId = null;
    function loop() {
      renderAnim();
      renderPlot();
      drawContribPlot(msdPidCanvas, [
        { label: 'P', color: cssVar('--viz-1'),    data: pidContrib.p },
        { label: 'I', color: cssVar('--viz-2'),    data: pidContrib.i },
        { label: 'D', color: cssVar('--viz-3'),    data: pidContrib.d },
        { label: 'Total', color: cssVar('--viz-total'), data: pidContrib.total }
      ], null, 'F (N)');
      rafId = requestAnimationFrame(loop);
    }
    loop();
  })();

  /* ================================================================
     Demo 1.5 — B-spline Race Track (PID path tracking)
  ================================================================ */
  (function raceDemo() {
    var canvas = document.getElementById('race-canvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');

    // Virtual track space (700 × 420)
    var VW = 700, VH = 420;
    var TW = 36;       // track half-width in virtual px
    var WB = 28;       // wheelbase in virtual px
    var MAX_STEER = 0.48;  // max steer angle (rad)
    var LA = 70;       // AI pure-pursuit lookahead (virtual px)
    var NS = 500;      // path samples

    // B-spline control polygon — a closed loop in virtual px, sampled from a
    // trefoil curve (x = sin t + 2 sin 2t, y = cos t − 2 cos 2t). The trefoil
    // crosses itself three times, so the circuit is no longer a single oval: it
    // weaves through three connected loops joined by three crossovers. The cubic
    // B-spline stays C² everywhere, so the racing line is smooth despite the
    // self-intersections. The two crossing branches meet ~1/3 of a lap apart in
    // path-index space — far outside the nearest-point search window in
    // nearestIdx — so a car always follows its own branch through a crossover.
    var RAW = (function buildControlPolygon() {
      var pts = [], N = 30, cx = 350, cy = 238, ax = 95, ay = 62;
      for (var k = 0; k < N; k++) {
        var t = k / N * 2 * Math.PI;
        pts.push([
          cx + ax * (Math.sin(t) + 2 * Math.sin(2 * t)),
          cy + ay * (Math.cos(t) - 2 * Math.cos(2 * t))
        ]);
      }
      return pts;
    })();

    // Uniform cubic B-spline segment (C² everywhere; does not interpolate through control points)
    function bspline4(p0, p1, p2, p3, t) {
      var t2 = t * t, t3 = t2 * t;
      var b0 = (-t3 + 3*t2 - 3*t + 1) / 6;
      var b1 = ( 3*t3 - 6*t2       + 4) / 6;
      var b2 = (-3*t3 + 3*t2 + 3*t + 1) / 6;
      var b3 = t3 / 6;
      return [
        b0*p0[0] + b1*p1[0] + b2*p2[0] + b3*p3[0],
        b0*p0[1] + b1*p1[1] + b2*p2[1] + b3*p3[1]
      ];
    }

    // Build sampled path: [{x, y, nx, ny, tx, ty}]
    var path = [];
    (function buildPath() {
      var n = RAW.length;
      for (var ii = 0; ii < NS; ii++) {
        var u   = ii / NS * n;
        var si  = Math.floor(u) % n;
        var t   = u - Math.floor(u);
        var p0 = RAW[(si-1+n)%n], p1 = RAW[si], p2 = RAW[(si+1)%n], p3 = RAW[(si+2)%n];
        var pt  = bspline4(p0, p1, p2, p3, t);
        var u2  = (ii / NS + 0.001) * n;
        var si2 = Math.floor(u2) % n;
        var t2  = u2 - Math.floor(u2);
        var pt2 = bspline4(RAW[(si2-1+n)%n], RAW[si2], RAW[(si2+1)%n], RAW[(si2+2)%n], t2);
        var tx  = pt2[0] - pt[0], ty = pt2[1] - pt[1];
        var tl  = Math.hypot(tx, ty) || 1;
        path.push({ x: pt[0], y: pt[1], nx: -ty/tl, ny: tx/tl, tx: tx/tl, ty: ty/tl });
      }
    })();

    // Canvas sizing and virtual→screen transform
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var W = 700, H = 400;
    var vScale = 1, vOx = 0, vOy = 0;

    function resizeCanvas() {
      W = canvas.parentElement.clientWidth;
      H = Math.max(300, Math.min(400, Math.round(W * 0.58)));
      canvas.width  = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width  = W + 'px';
      canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      vScale = Math.min(W / VW, H / VH) * 0.92;
      vOx    = (W - VW * vScale) / 2;
      vOy    = (H - VH * vScale) / 2;
    }
    new ResizeObserver(resizeCanvas).observe(canvas.parentElement);
    resizeCanvas();

    function sx(x) { return x * vScale + vOx; }
    function sy(y) { return y * vScale + vOy; }

    // ── Car struct ───────────────────────────────────────────────
    function makeCar() {
      var p0 = path[0], p1 = path[1];
      return {
        x: p0.x, y: p0.y,
        heading: Math.atan2(p1.y - p0.y, p1.x - p0.x),
        steer: 0,
        speed: 55,
        pathIdx: 0,
        _prevIdx: 0,
        _lapCount: 0, _lapStart: null,
        lapTime: null, bestLap: null
      };
    }

    var pidCar, aiCar;

    // ── PID state ────────────────────────────────────────────────
    var pidGains = { kp: 0, ki: 0, kd: 0 };
    var pidCtrl  = { intE: 0, prevE: 0 };

    // State history for plot
    var SHIST = 400;
    var stateHist = { ey: [], eth: [] };
    var RING = 600;
    var eyRing = [];
    var bestRMSE = null;

    function resetRace() {
      pidCar          = makeCar();
      pidCar.x       += path[0].nx * 11;
      pidCar.y       += path[0].ny * 11;
      aiCar           = makeCar();
      aiCar.x        -= path[0].nx * 11;
      aiCar.y        -= path[0].ny * 11;
      aiCar.speed     = 50;
      pidCtrl.intE    = 0;
      pidCtrl.prevE   = 0;
      stateHist.ey    = [];
      stateHist.eth   = [];
      eyRing          = [];
      bestRMSE        = null;
      var bestEl = document.getElementById('race-best');
      if (bestEl) bestEl.textContent = '';
    }
    resetRace();

    // ── PID sliders ──────────────────────────────────────────────
    var kpSlider = document.getElementById('race-kp');
    var kiSlider = document.getElementById('race-ki');
    var kdSlider = document.getElementById('race-kd');
    var kpValEl  = document.getElementById('race-kp-val');
    var kiValEl  = document.getElementById('race-ki-val');
    var kdValEl  = document.getElementById('race-kd-val');

    function syncPID() {
      pidGains.kp = kpSlider ? parseFloat(kpSlider.value) : 0;
      pidGains.ki = kiSlider ? parseFloat(kiSlider.value) : 0;
      pidGains.kd = kdSlider ? parseFloat(kdSlider.value) : 0;
      if (kpValEl) kpValEl.textContent = pidGains.kp.toFixed(2);
      if (kiValEl) kiValEl.textContent = pidGains.ki.toFixed(2);
      if (kdValEl) kdValEl.textContent = pidGains.kd.toFixed(2);
    }
    function applyRange(slider, rangeInput) {
      var r = Math.max(0.1, parseFloat(rangeInput.value) || 1);
      var prev = parseFloat(slider.value);
      slider.min   = -r;
      slider.max   =  r;
      slider.step  =  r / 100;
      slider.value = clamp(prev, -r, r);
    }
    var kpRange = document.getElementById('race-kp-range');
    var kiRange = document.getElementById('race-ki-range');
    var kdRange = document.getElementById('race-kd-range');
    [[kpSlider, kpRange], [kiSlider, kiRange], [kdSlider, kdRange]].forEach(function (pair) {
      var sl = pair[0], ri = pair[1];
      if (ri && sl) ri.addEventListener('input', function () { applyRange(sl, ri); syncPID(); });
    });
    [kpSlider, kiSlider, kdSlider].forEach(function (s) {
      if (s) s.addEventListener('input', syncPID);
    });
    syncPID();

    var speedSlider = document.getElementById('race-speed');
    var speedValEl  = document.getElementById('race-speed-val');
    if (speedSlider) speedSlider.addEventListener('input', function () {
      if (speedValEl) speedValEl.textContent = Math.round(parseFloat(speedSlider.value) * 100) + '%';
    });

    // ── Physics ──────────────────────────────────────────────────
    function stepCar(car, dt) {
      var delta = car.steer * MAX_STEER;
      car.x      += car.speed * Math.cos(car.heading) * dt;
      car.y      += car.speed * Math.sin(car.heading) * dt;
      car.heading += (car.speed / WB) * Math.tan(delta) * dt;
      while (car.heading >  Math.PI) car.heading -= 2 * Math.PI;
      while (car.heading < -Math.PI) car.heading += 2 * Math.PI;
    }

    // Nearest path index within a search window
    function nearestIdx(car) {
      var n = NS, best = car.pathIdx, bestD = Infinity;
      for (var i = -20; i <= 80; i++) {
        var idx = (car.pathIdx + i + n) % n;
        var d   = Math.hypot(path[idx].x - car.x, path[idx].y - car.y);
        if (d < bestD) { bestD = d; best = idx; }
      }
      car.pathIdx = best;
      return best;
    }

    // Signed cross-track error and heading error
    function getErrors(car) {
      var idx = nearestIdx(car);
      var p   = path[idx];
      var dx  = car.x - p.x, dy = car.y - p.y;
      // Signed lateral offset (positive = left of travel direction)
      var ey  = dx * p.nx + dy * p.ny;
      // Heading error: track tangent angle minus car heading
      var trackAngle = Math.atan2(p.ty, p.tx);
      var eth = trackAngle - car.heading;
      while (eth >  Math.PI) eth -= 2 * Math.PI;
      while (eth < -Math.PI) eth += 2 * Math.PI;
      return { ey: ey, eth: eth };
    }

    // PID steering: error = ey; D term naturally captures heading error (ėy ≈ v·sin(eθ))
    function updatePID(car, dt) {
      var errs = getErrors(car);
      var e    = errs.ey;
      pidCtrl.intE = clamp(pidCtrl.intE + e * dt, -100, 100);
      var de       = dt > 0 ? (e - pidCtrl.prevE) / dt : 0;
      pidCtrl.prevE = e;
      car.steer    = clamp(pidGains.kp * e + pidGains.ki * pidCtrl.intE + pidGains.kd * de, -1, 1);
      return errs;
    }

    // ── Pure-pursuit AI ──────────────────────────────────────────
    function updateAI(car) {
      nearestIdx(car);
      var walked = 0, idx = car.pathIdx;
      while (walked < LA) {
        var next = (idx + 1) % NS;
        walked  += Math.hypot(path[next].x - path[idx].x, path[next].y - path[idx].y);
        idx      = next;
        if (idx === car.pathIdx) break;
      }
      var tgt = path[idx];
      var err = Math.atan2(tgt.y - car.y, tgt.x - car.x) - car.heading;
      while (err >  Math.PI) err -= 2 * Math.PI;
      while (err < -Math.PI) err += 2 * Math.PI;
      car.steer = clamp(err * 2.2, -1, 1);
    }

    // ── Lap detection ────────────────────────────────────────────
    function checkLap(car, now) {
      var cur = nearestIdx(car);
      if (car._prevIdx > NS * 0.88 && cur < NS * 0.12) {
        if (car._lapStart !== null) {
          car.lapTime = now - car._lapStart;
          if (!car.bestLap || car.lapTime < car.bestLap) car.bestLap = car.lapTime;
        }
        car._lapStart = now;
        car._lapCount++;
      }
      car._prevIdx = cur;
    }

    // ── Simulation step ──────────────────────────────────────────
    var lastRaceNow = null;

    function raceStep(now) {
      if (lastRaceNow === null) { lastRaceNow = now; return; }
      var sec = document.getElementById('sec-race');
      if (!sec || !sec.classList.contains('active')) { lastRaceNow = now; return; }
      var dt = Math.min((now - lastRaceNow) / 1000, 0.05);
      lastRaceNow = now;

      var spd       = speedSlider ? parseFloat(speedSlider.value) : 0.5;
      pidCar.speed  = 35 + spd * 40;
      aiCar.speed   = 35 + spd * 37;

      var SUBS = 8, sdt = dt / SUBS;
      var lastErrs = null;
      for (var i = 0; i < SUBS; i++) {
        lastErrs = updatePID(pidCar, sdt);
        updateAI(aiCar);
        stepCar(pidCar, sdt);
        stepCar(aiCar,  sdt);
      }

      checkLap(pidCar, now);
      checkLap(aiCar,  now);

      // State history
      if (lastErrs) {
        stateHist.ey.push(lastErrs.ey);
        stateHist.eth.push(lastErrs.eth);
        if (stateHist.ey.length > SHIST) { stateHist.ey.shift(); stateHist.eth.shift(); }
        eyRing.push(lastErrs.ey * lastErrs.ey);
        if (eyRing.length > RING) eyRing.shift();
      }

      // Score
      function setEl(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; }
      function fmt(ms) {
        if (!ms && ms !== 0) return '—';
        var m = Math.floor(ms/60000), s = Math.floor((ms%60000)/1000), cs = Math.floor((ms%1000)/10);
        return m+':'+(s<10?'0':'')+s+'.'+(cs<10?'0':'')+cs;
      }
      if (eyRing.length > 0) {
        var rmse = Math.sqrt(eyRing.reduce(function (a, b) { return a + b; }, 0) / eyRing.length);
        setEl('race-score', rmse.toFixed(1));
        if (bestRMSE === null || rmse < bestRMSE) {
          bestRMSE = rmse;
          var bestEl = document.getElementById('race-best');
          if (bestEl) bestEl.textContent = 'Best: ' + rmse.toFixed(1) + ' px';
        }
      }

      // Telemetry
      setEl('race-ey',       lastErrs ? lastErrs.ey.toFixed(1) + ' px' : '—');
      setEl('race-eth',      lastErrs ? rad2deg(lastErrs.eth).toFixed(1) + '°' : '—');
      setEl('race-lap-pid',  pidCar._lapCount);
      setEl('race-best-pid', fmt(pidCar.bestLap));
      setEl('race-lap-ai',   aiCar._lapCount);
      setEl('race-best-ai',  fmt(aiCar.bestLap));
    }

    // ── Rendering ────────────────────────────────────────────────
    function darkMode() {
      return document.documentElement.getAttribute('data-theme') === 'dark' ||
        (!document.documentElement.getAttribute('data-theme') &&
         window.matchMedia('(prefers-color-scheme: dark)').matches);
    }

    function drawTrack() {
      var n = NS, dark = darkMode();
      var tw = TW * vScale;

      ctx.beginPath();
      for (var i = 0; i < n; i++) {
        var p = path[i];
        if (i === 0) ctx.moveTo(sx(p.x), sy(p.y)); else ctx.lineTo(sx(p.x), sy(p.y));
      }
      ctx.closePath();
      ctx.lineWidth   = tw * 2;
      ctx.strokeStyle = dark ? '#1c1c2e' : '#2c2c2c';
      ctx.lineJoin    = 'round';
      ctx.lineCap     = 'round';
      ctx.stroke();

      [1, -1].forEach(function (side) {
        ctx.beginPath();
        for (var i = 0; i < n; i++) {
          var p  = path[i];
          var ex = sx(p.x + p.nx * TW * 0.90 * side);
          var ey = sy(p.y + p.ny * TW * 0.90 * side);
          if (i === 0) ctx.moveTo(ex, ey); else ctx.lineTo(ex, ey);
        }
        ctx.closePath();
        ctx.lineWidth   = 1.5;
        ctx.strokeStyle = 'rgba(255,255,255,0.60)';
        ctx.lineJoin    = 'round';
        ctx.stroke();
      });

      ctx.beginPath();
      for (var i = 0; i < n; i++) {
        var p = path[i];
        if (i === 0) ctx.moveTo(sx(p.x), sy(p.y)); else ctx.lineTo(sx(p.x), sy(p.y));
      }
      ctx.closePath();
      ctx.lineWidth   = 1.5;
      ctx.strokeStyle = cssVar('--accent');
      ctx.setLineDash([6 * vScale, 8 * vScale]);
      ctx.stroke();
      ctx.setLineDash([]);

      var sp = path[0];
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth   = 3;
      ctx.beginPath();
      ctx.moveTo(sx(sp.x + sp.nx * TW * 0.92), sy(sp.y + sp.ny * TW * 0.92));
      ctx.lineTo(sx(sp.x - sp.nx * TW * 0.92), sy(sp.y - sp.ny * TW * 0.92));
      ctx.stroke();

      var corners = [
        { idx: Math.round(NS * 0.14), label: 'T1' },
        { idx: Math.round(NS * 0.33), label: 'T2' },
        { idx: Math.round(NS * 0.52), label: 'T3' },
        { idx: Math.round(NS * 0.74), label: 'T4' }
      ];
      ctx.font         = 'bold 10px ' + cssVar('--mono');
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle    = 'rgba(255,255,255,0.30)';
      corners.forEach(function (c) {
        var p  = path[c.idx % NS];
        var lx = sx(p.x + p.nx * (TW + 16));
        var ly = sy(p.y + p.ny * (TW + 16));
        ctx.fillText(c.label, lx, ly);
      });
    }

    function drawCar(car, bodyColor, label) {
      var csx = sx(car.x), csy = sy(car.y);
      var cl = 20 * vScale, cw = 8 * vScale;
      ctx.save();
      ctx.translate(csx, csy);
      ctx.rotate(car.heading);
      ctx.fillStyle = bodyColor;
      ctx.beginPath();
      ctx.roundRect(-cl * 0.5, -cw * 0.5, cl, cw, 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.moveTo( cl * 0.5,            0);
      ctx.lineTo( cl * 0.5 - cw * 0.8, -cw * 0.45);
      ctx.lineTo( cl * 0.5 - cw * 0.8,  cw * 0.45);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = bodyColor;
      ctx.fillRect( cl * 0.26,  -cw * 0.75, cw * 0.6, cw * 1.5);
      ctx.fillRect(-cl * 0.50,  -cw * 0.75, cw * 0.5, cw * 1.5);
      ctx.restore();
      ctx.fillStyle    = bodyColor;
      ctx.font         = 'bold ' + Math.max(9, Math.round(10 * vScale)) + 'px ' + cssVar('--mono');
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(label, csx, csy - cw * 0.6);
    }

    function raceRender() {
      var dark = darkMode();
      ctx.fillStyle = dark ? '#0c1a0c' : '#4a8040';
      ctx.fillRect(0, 0, W, H);
      drawTrack();
      drawCar(aiCar,  '#e74c3c', 'AI');
      drawCar(pidCar, cssVar('--accent'), 'PID');
    }

    // State plot: ey and eth over time
    function drawRaceStatePlot() {
      var pc = document.getElementById('race-state-plot');
      if (!pc) return;
      drawContribPlot(pc, [
        { label: 'eᵧ CTE (px)',   color: cssVar('--viz-1'), data: stateHist.ey  },
        { label: 'e_θ hdg (rad)', color: cssVar('--viz-2'), data: stateHist.eth }
      ], null, 'state');
    }

    var raceResetBtn = document.getElementById('race-reset');
    if (raceResetBtn) raceResetBtn.addEventListener('click', function () {
      resetRace();
      lastRaceNow = null;
    });

    function raceLoop(now) {
      raceStep(now);
      raceRender();
      drawRaceStatePlot();
      requestAnimationFrame(raceLoop);
    }
    requestAnimationFrame(raceLoop);
  })();

  /* ================================================================
     Shared 6-DOF flight physics engine (used by the Flight Sim demo)

     State vector s (12):
       [ u, v, w,        body-frame velocity     (m/s)
         p, q, r,        body angular rates       (rad/s)
         phi, theta, psi, Euler roll/pitch/yaw    (rad)
         N, E, h ]       position north / east / altitude (m)

     Body axes: x forward, y right, z down (standard aerospace).
     Control commands c = { de, da, dr, thr } use a *command* convention
     chosen so positive always means the intuitive thing:
       +de → nose up, +da → roll right, +dr → yaw right, thr ∈ [0,1].
     (The usual negative surface-sign bookkeeping is folded into the
     coefficient signs below so the keyboard mapping reads naturally.)
  ================================================================ */

  // Cessna-172-class light aircraft. Inertias/derivatives are textbook
  // magnitudes; a few control signs are chosen so positive command =
  // intuitive response (see the note above).
  var AC = {
    m: 1043.3, g: 9.81, rho: 1.225,
    S: 16.17, b: 10.9, cbar: 1.49,
    Ix: 1285, Iy: 1825, Iz: 2667,
    // Longitudinal
    CL0: 0.31, CLa: 5.14, CLq: 3.9,
    CD0: 0.031, k: 0.054,
    Cm0: 0.06, Cma: -0.60, Cmq: -13.0, Cmde: 1.10,
    // Lateral–directional
    CYb: -0.31, CYdr: 0.187,
    Clb: -0.089, Clp: -0.47, Clr: 0.096, Clda: 0.18, Cldr: 0.015,
    Cnb: 0.065, Cnp: -0.03, Cnr: -0.15, Cnda: -0.02, Cndr: 0.10,
    Tmax: 2600
  };

  var STALL_A = deg2rad(15);   // stall angle of attack

  // Airspeed / aero angles from a state vector.
  function airdata(s) {
    var u = s[0], v = s[1], w = s[2];
    var V = Math.sqrt(u * u + v * v + w * w);
    if (V < 1) V = 1;
    return { V: V, alpha: Math.atan2(w, u), beta: Math.asin(clamp(v / V, -1, 1)) };
  }

  // 6-DOF derivatives. c = {de, da, dr, thr}.
  function sixDof(t, s, c) {
    var u = s[0], v = s[1], w = s[2];
    var p = s[3], q = s[4], r = s[5];
    var phi = s[6], th = s[7], psi = s[8];

    var V = Math.sqrt(u * u + v * v + w * w); if (V < 1) V = 1;
    var alpha = Math.atan2(w, u);
    var beta  = Math.asin(clamp(v / V, -1, 1));
    var qbar  = 0.5 * AC.rho * V * V;
    var qS    = qbar * AC.S;

    // Non-dimensional body rates
    var phat = p * AC.b / (2 * V);
    var qhat = q * AC.cbar / (2 * V);
    var rhat = r * AC.b / (2 * V);

    // Lift with a smooth sigmoid stall: CL rolls off past STALL_A.
    var sig    = 1 / (1 + Math.exp(25 * (Math.abs(alpha) - STALL_A)));
    var CLlin  = AC.CL0 + AC.CLa * alpha + AC.CLq * qhat;
    var CLpeak = AC.CL0 + AC.CLa * STALL_A;
    var CLpost = 0.6 * CLpeak * (alpha < 0 ? -1 : 1);
    var CL     = sig * CLlin + (1 - sig) * CLpost;
    var CD     = AC.CD0 + AC.k * CL * CL + 0.9 * (1 - sig);   // stall drag rise
    var CY     = AC.CYb * beta + AC.CYdr * c.dr;

    var Cl = AC.Clb * beta + AC.Clp * phat + AC.Clr * rhat + AC.Clda * c.da + AC.Cldr * c.dr;
    var Cm = AC.Cm0 + AC.Cma * alpha + AC.Cmq * qhat + AC.Cmde * c.de;
    var Cn = AC.Cnb * beta + AC.Cnp * phat + AC.Cnr * rhat + AC.Cnda * c.da + AC.Cndr * c.dr;

    // Aerodynamic force: rotate wind-axis [-D, Y, -L] into body axes.
    var D = qS * CD, Yf = qS * CY, L = qS * CL;
    var ca = Math.cos(alpha), sa = Math.sin(alpha);
    var cb = Math.cos(beta),  sb = Math.sin(beta);
    var Xa = -D * ca * cb - Yf * ca * sb + L * sa;
    var Ya = -D * sb + Yf * cb;
    var Za = -D * sa * cb - Yf * sa * sb - L * ca;

    var T = c.thr * AC.Tmax;   // thrust along +x body

    // Gravity resolved into body axes
    var sphi = Math.sin(phi), cphi = Math.cos(phi);
    var sth  = Math.sin(th),  cth  = Math.cos(th);
    var gx = -AC.g * sth;
    var gy =  AC.g * cth * sphi;
    var gz =  AC.g * cth * cphi;

    var m = AC.m;
    var ax = (Xa + T) / m + gx;
    var ay =  Ya / m + gy;
    var az =  Za / m + gz;

    var udot = ax + r * v - q * w;
    var vdot = ay + p * w - r * u;
    var wdot = az + q * u - p * v;

    // Moments → angular accelerations (principal-axis inertia)
    var Lm = qS * AC.b * Cl, Mm = qS * AC.cbar * Cm, Nm = qS * AC.b * Cn;
    var pdot = (Lm + (AC.Iy - AC.Iz) * q * r) / AC.Ix;
    var qdot = (Mm + (AC.Iz - AC.Ix) * p * r) / AC.Iy;
    var rdot = (Nm + (AC.Ix - AC.Iy) * p * q) / AC.Iz;

    // Euler-angle kinematics (guard cos θ near ±90°)
    var tth = Math.tan(th);
    var cthS = Math.abs(cth) < 1e-3 ? (cth < 0 ? -1e-3 : 1e-3) : cth;
    var phidot = p + (sphi * q + cphi * r) * tth;
    var thdot  = cphi * q - sphi * r;
    var psidot = (sphi * q + cphi * r) / cthS;

    // Navigation: body velocity → earth (NED), then ḣ = -Vd
    var spsi = Math.sin(psi), cpsi = Math.cos(psi);
    var Vn = cth * cpsi * u + (sphi * sth * cpsi - cphi * spsi) * v + (cphi * sth * cpsi + sphi * spsi) * w;
    var Ve = cth * spsi * u + (sphi * sth * spsi + cphi * cpsi) * v + (cphi * sth * spsi - sphi * cpsi) * w;
    var Vd = -sth * u + sphi * cth * v + cphi * cth * w;

    return [udot, vdot, wdot, pdot, qdot, rdot, phidot, thdot, psidot, Vn, Ve, -Vd];
  }

  // Level-flight trim at V0: solve for alpha, elevator command, throttle.
  function computeTrim() {
    var V0 = 52;                       // ~100 kt cruise
    var W  = AC.m * AC.g;
    var qbar = 0.5 * AC.rho * V0 * V0;
    var qS = qbar * AC.S;
    var CLreq = W / qS;
    var alpha = (CLreq - AC.CL0) / AC.CLa;
    var de    = -(AC.Cm0 + AC.Cma * alpha) / AC.Cmde;
    var CD    = AC.CD0 + AC.k * CLreq * CLreq;
    var thr   = clamp(qS * CD / AC.Tmax, 0, 1);
    return {
      V: V0, alpha: alpha, de: de, thr: thr,
      N0: -1800, E0: 0, h0: 250,        // 1.8 km south of the runway, heading N
      u: V0 * Math.cos(alpha), w: V0 * Math.sin(alpha), theta: alpha
    };
  }

  var TRIM = computeTrim();

  // Sutherland–Hodgman clip of a polygon against the half-plane fval(pt) >= 0.
  function clipHalf(poly, fval) {
    var out = [];
    for (var i = 0; i < poly.length; i++) {
      var a = poly[i], b = poly[(i + 1) % poly.length];
      var fa = fval(a), fb = fval(b);
      if (fa >= 0) out.push(a);
      if ((fa >= 0) !== (fb >= 0)) {
        var t = fa / (fa - fb);
        out.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
      }
    }
    return out;
  }

  /* ================================================================
     3-D out-the-window cockpit view with a HUD.
     Pinhole camera fixed to the airframe (body axes): x = depth into
     the screen, y = screen-right, z = screen-down. World points are
     rotated earth→body by the aircraft attitude, then projected.
  ================================================================ */
  function makeFlightView(canvas) {
    var ctx = canvas.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var W = 720, H = 380, cx = 360, cy = 190, f = 480;
    var NEAR = 2;                         // near-plane depth (m) for world points
    var FOV = deg2rad(65);

    function resize() {
      var w = canvas.parentElement.clientWidth;
      W = w; H = 380; cx = W / 2; cy = H / 2;
      f = (W / 2) / Math.tan(FOV / 2);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    new ResizeObserver(resize).observe(canvas.parentElement);

    // Rotate an earth (NED, relative to aircraft) vector into body axes,
    // using body→earth DCM elements r[] (row-major 3×3), transposed.
    function toBody(dN, dE, dD, r) {
      return {
        x: r[0] * dN + r[3] * dE + r[6] * dD,
        y: r[1] * dN + r[4] * dE + r[7] * dD,
        z: r[2] * dN + r[5] * dE + r[8] * dD
      };
    }
    function dcm(phi, th, psi) {
      var sp = Math.sin(phi), cp = Math.cos(phi);
      var st = Math.sin(th),  ct = Math.cos(th);
      var ss = Math.sin(psi), cs = Math.cos(psi);
      return [                                   // body→earth, row-major
        ct * cs, sp * st * cs - cp * ss, cp * st * cs + sp * ss,
        ct * ss, sp * st * ss + cp * cs, cp * st * ss - sp * cs,
        -st,     sp * ct,               cp * ct
      ];
    }
    // Project a body-frame world point (needs depth > NEAR metres).
    function proj(b) {
      if (b.x <= NEAR) return null;
      return { x: cx + f * b.y / b.x, y: cy + f * b.z / b.x, d: b.x };
    }
    // Project a body-frame *direction* (point at infinity): only needs to
    // be in front of the camera, so no metric near-plane test.
    function projDir(b) {
      if (b.x <= 1e-3) return null;
      return { x: cx + f * b.y / b.x, y: cy + f * b.z / b.x };
    }
    // Clip a body-space segment to x > NEAR, then project both ends.
    function projSeg(a, b) {
      var ain = a.x > NEAR, bin = b.x > NEAR;
      if (!ain && !bin) return null;
      if (ain && bin) return [proj(a), proj(b)];
      var t = (NEAR - a.x) / (b.x - a.x);
      var m = { x: NEAR + 1e-3, y: a.y + t * (b.y - a.y), z: a.z + t * (b.z - a.z) };
      return ain ? [proj(a), proj(m)] : [proj(m), proj(b)];
    }

    function render(state, ctrl, extra) {
      var phi = state[6], th = state[7], psi = state[8];
      var h = state[11], N0 = state[9], E0 = state[10];
      var ad = airdata(state);
      var r = dcm(phi, th, psi);

      var isDark = document.documentElement.getAttribute('data-theme') === 'dark' ||
        (!document.documentElement.getAttribute('data-theme') &&
         window.matchMedia('(prefers-color-scheme: dark)').matches);
      var accent = cssVar('--accent');
      var muted  = cssVar('--text-muted');

      ctx.clearRect(0, 0, W, H);

      // ---- Sky / ground split via the analytic horizon half-plane ----
      // Earth-up in body axes; a screen pixel is "sky" where up·dir > 0.
      var upx = -r[6], upy = -r[7], upz = -r[8];    // earth-up in body = toBody(0,0,-1)
      var A = upy, B = upz, C = f * upx;            // centred-screen line A·X+B·Y+C=0
      var rect = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
      function fval(pt) { return A * (pt.x - cx) + B * (pt.y - cy) + C; }
      var sky = clipHalf(rect, fval);

      ctx.fillStyle = isDark ? '#0c1712' : '#8bab6e';   // ground
      ctx.fillRect(0, 0, W, H);
      if (sky.length > 2) {
        var grad = ctx.createLinearGradient(0, 0, 0, H);
        if (isDark) { grad.addColorStop(0, '#050912'); grad.addColorStop(1, '#132842'); }
        else        { grad.addColorStop(0, '#7fb3e6'); grad.addColorStop(1, '#cfe6f5'); }
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(sky[0].x, sky[0].y);
        for (var i = 1; i < sky.length; i++) ctx.lineTo(sky[i].x, sky[i].y);
        ctx.closePath();
        ctx.fill();
      }

      // ---- Ground grid (perspective) ----
      var gridCol = isDark ? 'rgba(90,150,120,0.55)' : 'rgba(55,80,45,0.5)';
      var STEP = 250, SPAN = 5000;
      ctx.lineWidth = 1;
      function gridLine(aN, aE, bN, bE) {
        var seg = projSeg(toBody(aN - N0, aE - E0, h, r), toBody(bN - N0, bE - E0, h, r));
        if (!seg || !seg[0] || !seg[1]) return;
        ctx.globalAlpha = clamp(1 - Math.min(seg[0].d, seg[1].d) / SPAN, 0.06, 1);
        ctx.strokeStyle = gridCol;
        ctx.beginPath();
        ctx.moveTo(seg[0].x, seg[0].y);
        ctx.lineTo(seg[1].x, seg[1].y);
        ctx.stroke();
      }
      var n0 = Math.floor((N0 - SPAN) / STEP) * STEP;
      var e0 = Math.floor((E0 - SPAN) / STEP) * STEP;
      for (var gn = n0; gn <= N0 + SPAN; gn += STEP) gridLine(gn, E0 - SPAN, gn, E0 + SPAN);
      for (var ge = e0; ge <= E0 + SPAN; ge += STEP) gridLine(N0 - SPAN, ge, N0 + SPAN, ge);
      ctx.globalAlpha = 1;

      // ---- Runway near the origin, aligned along +N ----
      drawRunway(N0, E0, h, r, isDark);

      // ---- HUD ----
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = 2;
      var hud = accent;

      drawLadder(r, psi, hud);

      // Boresight (where the nose points)
      ctx.strokeStyle = hud; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - 26, cy); ctx.lineTo(cx - 8, cy);
      ctx.moveTo(cx + 8, cy);  ctx.lineTo(cx + 26, cy);
      ctx.moveTo(cx, cy - 6);  ctx.lineTo(cx, cy);
      ctx.stroke();

      // Flight-path (velocity) marker
      var u = state[0], v = state[1], w = state[2];
      if (u > 1) {
        var fx = clamp(cx + f * v / u, 12, W - 12);
        var fy = clamp(cy + f * w / u, 12, H - 12);
        ctx.strokeStyle = hud; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(fx, fy, 6, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(fx - 6, fy); ctx.lineTo(fx - 14, fy);
        ctx.moveTo(fx + 6, fy); ctx.lineTo(fx + 14, fy);
        ctx.moveTo(fx, fy - 6);  ctx.lineTo(fx, fy - 11);
        ctx.stroke();
      }

      drawBank(phi, hud, muted);
      drawHeadingTape(psi, hud, muted, isDark);
      drawVTape(ad.V, hud, muted, isDark);
      drawAltTape(h, extra && extra.altBug, hud, muted, isDark);
      drawThrottle(ctrl.thr, hud, muted, isDark);

      var warn = ad.alpha > STALL_A ? 'STALL' : (ad.V < 28 ? 'AIRSPEED' : null);
      if (warn) {
        ctx.shadowBlur = 0;
        ctx.fillStyle = (Math.floor(Date.now() / 300) % 2) ? '#ff5252' : 'rgba(255,82,82,0.35)';
        ctx.font = 'bold 18px ' + cssVar('--font');
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(warn, cx, cy + 62);
      }
      ctx.restore();

      // Crash overlay
      if (extra && extra.status && extra.status !== 'ok') {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, 0, W, H);
        ctx.font = 'bold 22px ' + cssVar('--font');
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff';
        ctx.fillText(extra.status === 'crashed' ? '💥  CRASHED' : extra.status, cx, cy - 12);
        ctx.font = '14px ' + cssVar('--font');
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.fillText('Resetting…', cx, cy + 16);
      }
    }

    // --- HUD sub-drawers (closures over ctx / W / H / cx / cy / f) ---

    function drawRunway(N0, E0, h, r, isDark) {
      var L0 = 0, L1 = 900, HW = 14;                 // 900 m long, 28 m wide
      function grd(n, e) { return toBody(n - N0, e - E0, h, r); }
      var c = [
        projSeg(grd(L0, -HW), grd(L1, -HW)),
        projSeg(grd(L0,  HW), grd(L1,  HW))
      ];
      // Fill the strip only when both long edges are fully in front.
      var full = c[0] && c[1] && c[0][0] && c[0][1] && c[1][0] && c[1][1];
      ctx.save();
      if (full) {
        ctx.fillStyle = isDark ? 'rgba(40,46,54,0.9)' : 'rgba(70,74,80,0.85)';
        ctx.beginPath();
        ctx.moveTo(c[0][0].x, c[0][0].y);
        ctx.lineTo(c[0][1].x, c[0][1].y);
        ctx.lineTo(c[1][1].x, c[1][1].y);
        ctx.lineTo(c[1][0].x, c[1][0].y);
        ctx.closePath(); ctx.fill();
        // Dashed centreline
        ctx.strokeStyle = 'rgba(240,240,240,0.85)';
        ctx.setLineDash([10, 12]); ctx.lineWidth = 2;
        var cl = projSeg(grd(L0, 0), grd(L1, 0));
        if (cl && cl[0] && cl[1]) {
          ctx.beginPath(); ctx.moveTo(cl[0].x, cl[0].y); ctx.lineTo(cl[1].x, cl[1].y); ctx.stroke();
        }
        ctx.setLineDash([]);
      }
      ctx.restore();
    }

    function drawLadder(r, psi, hud) {
      ctx.lineWidth = 1.5;
      ctx.font = '10px ' + cssVar('--mono');
      ctx.textBaseline = 'middle';
      var levels = [-30, -20, -10, 0, 10, 20, 30, 45];
      for (var li = 0; li < levels.length; li++) {
        var el = deg2rad(levels[li]);
        var wide = deg2rad(levels[li] === 0 ? 22 : 11);
        var pts = [];
        for (var side = -1; side <= 1; side += 2) {
          var az = psi + side * wide;
          pts.push(projDir(toBody(Math.cos(el) * Math.cos(az),
                                  Math.cos(el) * Math.sin(az),
                                  -Math.sin(el), r)));
        }
        if (!pts[0] || !pts[1]) continue;
        ctx.strokeStyle = hud;
        ctx.globalAlpha = levels[li] === 0 ? 1 : 0.8;
        ctx.setLineDash(levels[li] < 0 ? [6, 5] : []);
        // Two half-rungs with a gap around the boresight
        line(pts[0], lerp(pts[0], pts[1], 0.4));
        line(lerp(pts[0], pts[1], 0.6), pts[1]);
        ctx.setLineDash([]);
        if (levels[li] !== 0) {
          ctx.fillStyle = hud; ctx.textAlign = 'right';
          ctx.fillText('' + Math.abs(levels[li]), pts[0].x - 4, pts[0].y);
          ctx.textAlign = 'left';
          ctx.fillText('' + Math.abs(levels[li]), pts[1].x + 4, pts[1].y);
        }
        ctx.globalAlpha = 1;
      }
    }
    function line(a, b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    function lerp(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }

    function drawBank(phi, hud, muted) {
      var ticks = [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60];
      ctx.strokeStyle = muted; ctx.globalAlpha = 0.8; ctx.lineWidth = 1;
      for (var j = 0; j < ticks.length; j++) {
        var ang = -Math.PI / 2 + deg2rad(ticks[j]);
        var big = (ticks[j] % 30 === 0) || Math.abs(ticks[j]) === 45;
        var rr = 116, rr2 = 116 - (big ? 10 : 6);
        ctx.beginPath();
        ctx.moveTo(cx + rr * Math.cos(ang), cy + rr * Math.sin(ang));
        ctx.lineTo(cx + rr2 * Math.cos(ang), cy + rr2 * Math.sin(ang));
        ctx.stroke();
      }
      var pa = -Math.PI / 2 + phi, pr = 104;
      var px = cx + pr * Math.cos(pa), py = cy + pr * Math.sin(pa);
      ctx.fillStyle = hud; ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + 7 * Math.cos(pa + 2.5), py + 7 * Math.sin(pa + 2.5));
      ctx.lineTo(px + 7 * Math.cos(pa - 2.5), py + 7 * Math.sin(pa - 2.5));
      ctx.closePath(); ctx.fill();
    }

    function drawHeadingTape(psi, hud, muted, isDark) {
      var y = 14, hw = 130;
      var hdg = ((rad2deg(psi) % 360) + 360) % 360;
      ctx.fillStyle = isDark ? 'rgba(8,14,22,0.5)' : 'rgba(250,252,255,0.5)';
      ctx.fillRect(cx - hw, 2, hw * 2, 22);
      ctx.save();
      ctx.beginPath(); ctx.rect(cx - hw, 2, hw * 2, 22); ctx.clip();
      ctx.font = '10px ' + cssVar('--mono'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (var d = -50; d <= 50; d += 10) {
        var hdv = Math.round(hdg / 10) * 10 + d;
        var sx = cx + (hdv - hdg) * 4;
        var lbl = ((hdv % 360) + 360) % 360;
        ctx.strokeStyle = muted; ctx.globalAlpha = 0.8; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(sx, y - 6); ctx.lineTo(sx, y - 1); ctx.stroke();
        ctx.fillStyle = muted; ctx.globalAlpha = 1;
        ctx.fillText(lbl === 0 ? 'N' : lbl === 90 ? 'E' : lbl === 180 ? 'S' : lbl === 270 ? 'W' : '' + (lbl / 10 | 0), sx, y + 3);
      }
      ctx.restore();
      ctx.fillStyle = hud;
      ctx.beginPath(); ctx.moveTo(cx, y + 9); ctx.lineTo(cx - 5, y + 3); ctx.lineTo(cx + 5, y + 3); ctx.closePath(); ctx.fill();
      ctx.font = 'bold 11px ' + cssVar('--mono'); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(('00' + Math.round(hdg)).slice(-3) + '°', cx, y + 12);
    }

    function drawVTape(V, hud, muted, isDark) {
      var x = 18, th2 = 120;
      ctx.fillStyle = isDark ? 'rgba(8,14,22,0.5)' : 'rgba(250,252,255,0.5)';
      ctx.fillRect(x, cy - th2 / 2, 40, th2);
      ctx.save();
      ctx.beginPath(); ctx.rect(x, cy - th2 / 2, 40, th2); ctx.clip();
      ctx.font = '9px ' + cssVar('--mono'); ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      for (var s = Math.round((V - 30) / 10) * 10; s <= V + 30; s += 10) {
        if (s < 0) continue;
        var sy = cy + (V - s) * 2.2;
        ctx.strokeStyle = muted; ctx.globalAlpha = 0.7; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x + 34, sy); ctx.lineTo(x + 40, sy); ctx.stroke();
        ctx.fillStyle = muted; ctx.globalAlpha = 1;
        ctx.fillText('' + s, x + 32, sy);
      }
      ctx.restore();
      ctx.fillStyle = hud; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.font = 'bold 12px ' + cssVar('--mono');
      ctx.fillText(V.toFixed(0), x + 2, cy);
      ctx.fillStyle = muted; ctx.font = '8px ' + cssVar('--mono'); ctx.textBaseline = 'bottom';
      ctx.fillText('m/s', x + 2, cy - th2 / 2 - 2);
    }

    function drawAltTape(h, bug, hud, muted, isDark) {
      var x = W - 58, th2 = 120;
      ctx.fillStyle = isDark ? 'rgba(8,14,22,0.5)' : 'rgba(250,252,255,0.5)';
      ctx.fillRect(x, cy - th2 / 2, 44, th2);
      ctx.save();
      ctx.beginPath(); ctx.rect(x, cy - th2 / 2, 44, th2); ctx.clip();
      ctx.font = '9px ' + cssVar('--mono'); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      for (var s = Math.round((h - 180) / 50) * 50; s <= h + 180; s += 50) {
        var sy = cy + (h - s) * 0.35;
        ctx.strokeStyle = muted; ctx.globalAlpha = 0.7; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, sy); ctx.lineTo(x + 6, sy); ctx.stroke();
        ctx.fillStyle = muted; ctx.globalAlpha = 1;
        ctx.fillText('' + s, x + 8, sy);
      }
      if (typeof bug === 'number') {
        var by = clamp(cy + (h - bug) * 0.35, cy - th2 / 2, cy + th2 / 2);
        ctx.fillStyle = hud;
        ctx.beginPath(); ctx.moveTo(x, by); ctx.lineTo(x + 6, by - 4); ctx.lineTo(x + 6, by + 4); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      ctx.fillStyle = hud; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.font = 'bold 12px ' + cssVar('--mono');
      ctx.fillText(h.toFixed(0), x + 42, cy);
      ctx.fillStyle = muted; ctx.font = '8px ' + cssVar('--mono'); ctx.textBaseline = 'bottom'; ctx.textAlign = 'right';
      ctx.fillText('m', x + 42, cy - th2 / 2 - 2);
    }

    function drawThrottle(thr, hud, muted, isDark) {
      var x = 18, y = H - 58, bw = 10, bh = 44;
      ctx.fillStyle = isDark ? 'rgba(8,14,22,0.55)' : 'rgba(250,252,255,0.6)';
      ctx.strokeStyle = muted; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.rect(x, y, bw, bh); ctx.fill(); ctx.stroke();
      ctx.fillStyle = hud;
      ctx.fillRect(x, y + bh * (1 - thr), bw, bh * thr);
      ctx.fillStyle = muted; ctx.font = '9px ' + cssVar('--mono');
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText('THR ' + Math.round(thr * 100) + '%', x + bw + 5, y + 2);
    }

    resize();
    return { render: render, resize: resize };
  }

  /* ================================================================
     Shared sub-canvas plot utilities
  ================================================================ */

  // Draw a scrolling multi-line time-series on a canvas element.
  // series: [{label, color, data}]  data: rolling array of numbers
  // limitVal: optional ± dotted boundary (in the same units as data)
  // yLabel: optional y-axis title string
  function drawContribPlot(canvas, series, limitVal, yLabel) {
    if (!canvas) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var W = canvas.parentElement ? canvas.parentElement.clientWidth : canvas.offsetWidth;
    if (!W) W = 400;
    canvas.width  = Math.round(W * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr || 120 * dpr);
    var H = canvas.clientHeight || 120;
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var isDark = document.documentElement.getAttribute('data-theme') === 'dark' ||
      (!document.documentElement.getAttribute('data-theme') &&
       window.matchMedia('(prefers-color-scheme: dark)').matches);

    var bg      = cssVar('--bg');
    var border  = cssVar('--border');
    var muted   = cssVar('--text-muted');
    var mono    = cssVar('--mono');

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Find y-range across all series
    var allVals = [];
    series.forEach(function(s) { allVals = allVals.concat(s.data); });
    if (allVals.length === 0) { ctx.fillStyle = muted; ctx.font = '11px ' + mono; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('no data yet', W/2, H/2); return; }
    var yMax = Math.max(Math.abs(limitVal || 0), Math.max.apply(null, allVals.map(Math.abs)) || 1) * 1.1;

    var PAD_L = 38, PAD_R = 8, PAD_T = 8, PAD_B = 18;
    var pw = W - PAD_L - PAD_R, ph = H - PAD_T - PAD_B;

    function yPx(v) { return PAD_T + ph * (1 - (v + yMax) / (2 * yMax)); }
    var n = Math.max.apply(null, series.map(function(s) { return s.data.length; }));

    // Zero axis
    ctx.strokeStyle = border;
    ctx.lineWidth = 0.8;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(PAD_L, yPx(0)); ctx.lineTo(PAD_L + pw, yPx(0)); ctx.stroke();

    // Limit lines
    if (limitVal) {
      ctx.strokeStyle = isDark ? 'rgba(255,180,80,0.35)' : 'rgba(200,140,40,0.45)';
      ctx.lineWidth = 1;
      [limitVal, -limitVal].forEach(function(lv) {
        ctx.beginPath(); ctx.moveTo(PAD_L, yPx(lv)); ctx.lineTo(PAD_L + pw, yPx(lv)); ctx.stroke();
      });
    }
    ctx.setLineDash([]);

    // Series lines
    series.forEach(function(s) {
      if (!s.data.length) return;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      var xStep = pw / Math.max(n - 1, 1);
      for (var i = 0; i < s.data.length; i++) {
        var xp = PAD_L + (i - s.data.length + n) * xStep;
        var yp = yPx(s.data[i]);
        if (i === 0) ctx.moveTo(xp, yp); else ctx.lineTo(xp, yp);
      }
      ctx.stroke();
    });

    // Y axis labels
    ctx.fillStyle = muted;
    ctx.font = '9px ' + mono;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(yMax.toFixed(1), PAD_L - 3, PAD_T);
    ctx.fillText((-yMax).toFixed(1), PAD_L - 3, PAD_T + ph);
    ctx.fillText('0', PAD_L - 3, yPx(0));
    if (yLabel) {
      ctx.save(); ctx.translate(10, H / 2); ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center'; ctx.font = '9px ' + mono;
      ctx.fillText(yLabel, 0, 0);
      ctx.restore();
    }

    // Legend (bottom row)
    var lx = PAD_L;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.font = '9px ' + mono;
    series.forEach(function(s) {
      ctx.fillStyle = s.color;
      ctx.fillRect(lx, H - PAD_B + 4, 12, 3);
      ctx.fillStyle = muted;
      ctx.fillText(s.label, lx + 14, H - 2);
      lx += ctx.measureText(s.label).width + 22;
    });
    if (limitVal) {
      ctx.fillStyle = isDark ? 'rgba(255,180,80,0.7)' : 'rgba(200,140,40,0.8)';
      ctx.fillText('±' + limitVal.toFixed(0) + ' limit', lx, H - 2);
    }
  }

  // Draw a stacked state-history plot: one sub-row per state, each on its own
  // auto-scaled y-axis with a direct label + current value.
  // stateHist: an object of arrays keyed by `spec[i].key`.
  // spec (optional): [{key, label, color}] — defaults to the flight states.
  function drawStatePlot(canvas, stateHist, spec) {
    if (!canvas) return;
    var SERIES = spec || [
      { key: 'h',         label: 'h (m)',   color: cssVar('--viz-1') },
      { key: 'V',         label: 'V (m/s)', color: cssVar('--viz-2') },
      { key: 'alpha_deg', label: 'α (°)',   color: cssVar('--viz-3') },
      { key: 'gamma_deg', label: 'γ (°)',   color: cssVar('--viz-4') }
    ];
    var series = SERIES.map(function(s) { return { label: s.label, color: s.color, data: stateHist[s.key] || [] }; });
    // Use independent y-scales: normalise each to [-1,1] in a shared space isn't ideal;
    // instead overlay each on its own sub-row within the canvas.
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var W = canvas.parentElement ? canvas.parentElement.clientWidth : canvas.offsetWidth;
    if (!W) W = 400;
    canvas.width  = Math.round(W * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr || 150 * dpr);
    var H = canvas.clientHeight || 150;
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var isDark = document.documentElement.getAttribute('data-theme') === 'dark' ||
      (!document.documentElement.getAttribute('data-theme') &&
       window.matchMedia('(prefers-color-scheme: dark)').matches);

    var bg     = cssVar('--bg');
    var border = cssVar('--border');
    var muted  = cssVar('--text-muted');
    var mono   = cssVar('--mono');

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    var n = 0;
    series.forEach(function(s) { n = Math.max(n, s.data.length); });
    if (!n) {
      ctx.fillStyle = muted; ctx.font = '11px ' + mono; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText('no data yet', W/2, H/2); return;
    }

    var PAD_L = 38, PAD_R = 8, PAD_T = 6, PAD_B = 18;
    var rowH = (H - PAD_T - PAD_B) / series.length;
    var pw = W - PAD_L - PAD_R;

    series.forEach(function(s, si) {
      var yTop = PAD_T + si * rowH;
      var vals = s.data;
      if (!vals.length) return;
      var vMin = Math.min.apply(null, vals), vMax = Math.max.apply(null, vals);
      var vRange = vMax - vMin;
      if (vRange < 0.01) vRange = 1;
      var vMid = (vMin + vMax) / 2;

      function yPx(v) { return yTop + rowH * (0.9 - 0.8 * (v - vMid) / (vRange * 0.5)); }

      // Row background separator
      if (si > 0) {
        ctx.strokeStyle = border; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(PAD_L, yTop); ctx.lineTo(PAD_L + pw, yTop); ctx.stroke();
      }
      // Zero / mid line
      ctx.strokeStyle = border; ctx.lineWidth = 0.5; ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(PAD_L, yPx(vMid)); ctx.lineTo(PAD_L + pw, yPx(vMid)); ctx.stroke();
      ctx.setLineDash([]);

      // Data line
      ctx.strokeStyle = s.color; ctx.lineWidth = 1.4;
      ctx.beginPath();
      var xStep = pw / Math.max(n - 1, 1);
      for (var i = 0; i < vals.length; i++) {
        var xp = PAD_L + (i - vals.length + n) * xStep;
        var yp = yPx(vals[i]);
        if (i === 0) ctx.moveTo(xp, yp); else ctx.lineTo(xp, yp);
      }
      ctx.stroke();

      // Label + current value
      ctx.fillStyle = s.color; ctx.font = 'bold 9px ' + mono;
      ctx.textAlign = 'right'; ctx.textBaseline = 'top';
      var cur = vals[vals.length - 1];
      ctx.fillText(s.label + ' ' + cur.toFixed(1), PAD_L - 2, yTop + 2);
    });
  }

  /* ================================================================
     Flight Sim — 6-DOF aircraft, out-the-window 3-D cockpit view.
     Fly it yourself with the keyboard, or hand it to a cascaded
     autopilot that holds a target altitude + heading.
  ================================================================ */
  (function flightDemo() {
    var canvas = document.getElementById('flight-canvas');
    if (!canvas) return;
    var view = makeFlightView(canvas);

    // Control limits and self-centring rate (rad; command convention)
    var DE_MAX = deg2rad(18), DA_MAX = deg2rad(18), DR_MAX = deg2rad(22);
    var DT = 0.005, SUBSTEPS = 5;               // 25 ms/tick → real time
    var TICK = DT * SUBSTEPS;                    // 0.025 s
    var RISE = 0.35;                             // s to slew a surface full-scale

    var state, ctrl, simStatus, resetTimer = null;
    var CHIST = 300;
    var stateHist = { phi_deg: [], theta_deg: [], h: [], V: [] };
    var surfHist  = { de: [], da: [], dr: [] };
    var errRing = [], RING = 1200;
    var mode = 'manual';
    var keys = {};

    // DOM
    var manualBtn = document.getElementById('fl-manual-btn');
    var autoBtn   = document.getElementById('fl-auto-btn');
    var manualCtl = document.getElementById('fl-manual-controls');
    var autoCtl   = document.getElementById('fl-auto-controls');
    var sasChk    = document.getElementById('fl-sas');
    var thrSlider = document.getElementById('fl-throttle');
    var thrVal    = document.getElementById('fl-throttle-val');
    var tgtAlt    = document.getElementById('fl-tgt-alt');
    var tgtAltVal = document.getElementById('fl-tgt-alt-val');
    var tgtHdg    = document.getElementById('fl-tgt-hdg');
    var tgtHdgVal = document.getElementById('fl-tgt-hdg-val');
    var scoreEl   = document.getElementById('fl-score');
    var resetBtn  = document.getElementById('fl-reset');
    var flStatePlot = document.getElementById('fl-state-plot');
    var flSurfPlot  = document.getElementById('fl-pid-plot');

    var FL_STATE_SPEC = [
      { key: 'phi_deg',   label: 'φ (°)',   color: cssVar('--viz-1') },
      { key: 'theta_deg', label: 'θ (°)',   color: cssVar('--viz-2') },
      { key: 'h',         label: 'h (m)',   color: cssVar('--viz-3') },
      { key: 'V',         label: 'V (m/s)', color: cssVar('--viz-4') }
    ];

    function targetAlt() { return tgtAlt ? parseFloat(tgtAlt.value) : TRIM.h0; }
    function targetHdg() { return tgtHdg ? deg2rad(parseFloat(tgtHdg.value)) : 0; }

    function resetSim() {
      if (resetTimer) { clearTimeout(resetTimer); resetTimer = null; }
      state = [TRIM.u, 0, TRIM.w, 0, 0, 0, 0, TRIM.theta, 0, TRIM.N0, TRIM.E0, TRIM.h0];
      ctrl = { de: TRIM.de, da: 0, dr: 0, thr: TRIM.thr };
      simStatus = 'ok';
      errRing = [];
      stateHist = { phi_deg: [], theta_deg: [], h: [], V: [] };
      surfHist  = { de: [], da: [], dr: [] };
      if (thrSlider) { thrSlider.value = Math.round(TRIM.thr * 100); syncThr(); }
    }

    function syncThr() {
      ctrl.thr = clamp(parseFloat(thrSlider.value) / 100, 0, 1);
      if (thrVal) thrVal.textContent = Math.round(ctrl.thr * 100) + '%';
    }
    if (thrSlider) thrSlider.addEventListener('input', syncThr);
    if (tgtAlt) tgtAlt.addEventListener('input', function () { if (tgtAltVal) tgtAltVal.textContent = Math.round(parseFloat(tgtAlt.value)) + ' m'; });
    if (tgtHdg) tgtHdg.addEventListener('input', function () { if (tgtHdgVal) tgtHdgVal.textContent = Math.round(parseFloat(tgtHdg.value)) + '°'; });

    function setMode(m) {
      mode = m;
      if (manualBtn) manualBtn.classList.toggle('active', m === 'manual');
      if (autoBtn)   autoBtn.classList.toggle('active', m === 'auto');
      if (manualCtl) manualCtl.style.display = m === 'manual' ? '' : 'none';
      if (autoCtl)   autoCtl.style.display   = m === 'auto' ? 'flex' : 'none';
    }
    if (manualBtn) manualBtn.addEventListener('click', function () { setMode('manual'); });
    if (autoBtn)   autoBtn.addEventListener('click', function () { setMode('auto'); });
    if (resetBtn)  resetBtn.addEventListener('click', resetSim);

    // Keyboard: only when the flight tab is active and in manual mode.
    var KEYMAP = {
      ArrowUp: 'up', w: 'up', ArrowDown: 'down', s: 'down',
      ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right',
      q: 'yawL', e: 'yawR', z: 'thrDn', x: 'thrUp'
    };
    function flightActive() {
      var sec = document.getElementById('sec-flight');
      return sec && sec.classList.contains('active');
    }
    document.addEventListener('keydown', function (e) {
      if (!flightActive()) return;
      var k = KEYMAP[e.key] || KEYMAP[e.key.toLowerCase()];
      if (!k) return;
      e.preventDefault();
      keys[k] = true;
    });
    document.addEventListener('keyup', function (e) {
      var k = KEYMAP[e.key] || KEYMAP[e.key.toLowerCase()];
      if (k) keys[k] = false;
    });

    // Slew a surface toward its target at the fixed full-scale rate.
    function slew(cur, target, max) {
      var step = max * TICK / RISE;
      return cur + clamp(target - cur, -step, step);
    }
    function wrapPi(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }

    function manualControls() {
      var pitch = (keys.up ? 1 : 0) - (keys.down ? 1 : 0);
      var roll  = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      var yaw   = (keys.yawR ? 1 : 0) - (keys.yawL ? 1 : 0);
      // Elevator self-centres to TRIM.de (so hands-off holds trimmed level
      // flight); aileron/rudder centre to zero (symmetric trim).
      ctrl.de = slew(ctrl.de, clamp(TRIM.de + pitch * DE_MAX, -DE_MAX, DE_MAX), DE_MAX);
      ctrl.da = slew(ctrl.da, roll * DA_MAX, DA_MAX);
      ctrl.dr = slew(ctrl.dr, yaw  * DR_MAX, DR_MAX);
      if (keys.thrUp) ctrl.thr = clamp(ctrl.thr + 0.5 * TICK, 0, 1);
      if (keys.thrDn) ctrl.thr = clamp(ctrl.thr - 0.5 * TICK, 0, 1);
      if ((keys.thrUp || keys.thrDn) && thrSlider) { thrSlider.value = Math.round(ctrl.thr * 100); if (thrVal) thrVal.textContent = Math.round(ctrl.thr * 100) + '%'; }
      // Stability augmentation: extra rate damping so it's flyable.
      if (sasChk && sasChk.checked) {
        var q = state[4], p = state[3], r = state[5];
        ctrl.de = clamp(ctrl.de - 0.45 * q, -DE_MAX, DE_MAX);
        ctrl.da = clamp(ctrl.da - 0.30 * p, -DA_MAX, DA_MAX);
        ctrl.dr = clamp(ctrl.dr - 0.60 * r, -DR_MAX, DR_MAX);   // yaw-rate damper
      }
    }

    // Climb rate ḣ = -V_d from the body velocity + attitude.
    function climbRate(s) {
      var u = s[0], v = s[1], w = s[2], phi = s[6], th = s[7];
      var cth = Math.cos(th), sth = Math.sin(th), sphi = Math.sin(phi), cphi = Math.cos(phi);
      return -(-sth * u + sphi * cth * v + cphi * cth * w);
    }

    // Cascaded autopilot: altitude→vertical-speed→pitch→elevator,
    // heading→bank→aileron, yaw-rate damper, airspeed→throttle.
    // Commanded pitch is capped to a thrust-sustainable climb angle so it
    // never bleeds to a stall; roll only when fast enough to stay coordinated.
    function autoControls() {
      var ad = airdata(state), V = ad.V;
      var phi = state[6], th = state[7], psi = state[8];
      var p = state[3], q = state[4], r = state[5];
      var cr = climbRate(state);
      // Heading → bank (only when fast enough to hold a coordinated turn)
      var spd = clamp((V - 42) / 8, 0, 1);
      var phiCmd = clamp(0.5 * wrapPi(targetHdg() - psi), -deg2rad(18), deg2rad(18)) * spd;
      ctrl.da = clamp(1.2 * (phiCmd - phi) - 0.9 * p, -DA_MAX, DA_MAX);
      // Altitude → vertical speed → pitch (bank-compensated, thrust-limited)
      var vsCmd = clamp(0.04 * (targetAlt() - state[11]), -2.5, 2.5);
      var bankComp = deg2rad((1 / Math.cos(clamp(phi, -0.5, 0.5)) - 1) * 3.0);
      var thetaCmd = clamp(TRIM.theta + 0.045 * (vsCmd - cr) + bankComp,
                           TRIM.theta - deg2rad(6), TRIM.theta + deg2rad(6));
      ctrl.de = clamp(TRIM.de + 1.7 * (thetaCmd - th) - 0.9 * q, -DE_MAX, DE_MAX);
      ctrl.dr = clamp(-0.6 * r, -DR_MAX, DR_MAX);
      ctrl.thr = clamp(TRIM.thr + 0.07 * (TRIM.V - V) + 0.05 * Math.max(vsCmd, 0)
                       + 0.6 * (1 - Math.cos(clamp(phi, -0.5, 0.5))), 0, 1);
      if (thrSlider) { thrSlider.value = Math.round(ctrl.thr * 100); if (thrVal) thrVal.textContent = Math.round(ctrl.thr * 100) + '%'; }
    }

    function step() {
      if (!flightActive() || simStatus !== 'ok') return;
      for (var i = 0; i < SUBSTEPS; i++) {
        if (mode === 'auto') autoControls(); else manualControls();
        state = rk4(state, 0, DT, function (t, s) { return sixDof(t, s, ctrl); });
        if (state[11] <= 0) { state[11] = 0; simStatus = 'crashed'; break; }
        var eAlt = targetAlt() - state[11];
        errRing.push(eAlt * eAlt);
        if (errRing.length > RING) errRing.shift();
      }
      if (simStatus === 'crashed') {
        if (!resetTimer) resetTimer = setTimeout(function () { resetTimer = null; resetSim(); }, 2500);
        return;
      }

      var ad = airdata(state);
      stateHist.phi_deg.push(rad2deg(state[6]));
      stateHist.theta_deg.push(rad2deg(state[7]));
      stateHist.h.push(state[11]);
      stateHist.V.push(ad.V);
      surfHist.de.push(rad2deg(ctrl.de));
      surfHist.da.push(rad2deg(ctrl.da));
      surfHist.dr.push(rad2deg(ctrl.dr));
      ['phi_deg', 'theta_deg', 'h', 'V'].forEach(function (k) { if (stateHist[k].length > CHIST) stateHist[k].shift(); });
      ['de', 'da', 'dr'].forEach(function (k) { if (surfHist[k].length > CHIST) surfHist[k].shift(); });

      set('fl-t-h', state[11].toFixed(0) + ' m');
      set('fl-t-v', ad.V.toFixed(1) + ' m/s');
      set('fl-t-a', rad2deg(ad.alpha).toFixed(1) + '°');
      set('fl-t-b', rad2deg(ad.beta).toFixed(1) + '°');
      set('fl-t-phi', rad2deg(state[6]).toFixed(0) + '°');
      set('fl-t-theta', rad2deg(state[7]).toFixed(0) + '°');
      set('fl-t-psi', (((rad2deg(state[8]) % 360) + 360) % 360).toFixed(0) + '°');
      if (scoreEl && errRing.length) {
        var rmse = Math.sqrt(errRing.reduce(function (a, b) { return a + b; }, 0) / errRing.length);
        scoreEl.textContent = rmse.toFixed(1);
      }
    }
    function set(id, txt) { var el = document.getElementById(id); if (el) el.textContent = txt; }

    resetSim();
    setMode('manual');
    setInterval(step, 25);

    function loop() {
      view.render(state, ctrl, { status: simStatus, altBug: targetAlt() });
      drawStatePlot(flStatePlot, stateHist, FL_STATE_SPEC);
      drawContribPlot(flSurfPlot, [
        { label: 'δe', color: cssVar('--viz-1'), data: surfHist.de },
        { label: 'δa', color: cssVar('--viz-2'), data: surfHist.da },
        { label: 'δr', color: cssVar('--viz-3'), data: surfHist.dr }
      ], rad2deg(DR_MAX), 'surface (°)');
      requestAnimationFrame(loop);
    }
    loop();
  })();

  /* ================================================================
     Demo 3 — System ID + LQR
  ================================================================ */
  (function sysidDemo() {
    var canvas = document.getElementById('sysid-canvas');
    if (!canvas) return;

    /* ---- Cart-pole plant ----
       state = [x, ẋ, θ, θ̇]  (m, m/s, rad, rad/s); θ measured from straight up.
       Control u = horizontal force F (N) on the cart. The upright θ=0 is an
       UNSTABLE equilibrium — the whole point of the demo. */
    // Light cart + a long, heavy pole (a bob on top): the cart is easy to shove
    // side to side, and the tall pole's high rotational inertia makes it fall
    // slowly, so it's far more forgiving to balance than a short, light stick.
    var M_CART = 0.4, M_POLE = 0.4, L_POLE = 0.9;   // half-length of the rod
    var G = 9.8, TOTAL_M = M_CART + M_POLE, PML = M_POLE * L_POLE;
    var FMAX = 15;                 // N — actuator saturation
    var CP_DT = 0.005, SUBSTEPS = 5;  // 25 ms/step → real time at setInterval(25)
    var FALL_ANGLE = deg2rad(55), X_LIMIT = 3.2;
    var X_TARGET = 0;              // cart set-point (m)

    function cpDeriv(t, s, F) {
      var th = s[2], w = s[3];
      var sinth = Math.sin(th), costh = Math.cos(th);
      var temp = (F + PML * w * w * sinth) / TOTAL_M;
      var thddot = (G * sinth - costh * temp) / (L_POLE * (4.0 / 3.0 - M_POLE * costh * costh / TOTAL_M));
      var xddot  = temp - PML * thddot * costh / TOTAL_M;
      return [s[1], xddot, w, thddot];
    }

    function gaussian() {
      var u = 0, v = 0;
      while (u === 0) u = Math.random();
      while (v === 0) v = Math.random();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }

    var state, simT, uForce;
    var recording = false;
    var dataBuf = [];
    var lqrActive = false;
    var lqrK = null;
    var keepaliveK = null;   // stabiliser used while collecting closed-loop data
    var exc = 0;             // smoothed excitation force
    var pushF = 0;           // manual disturbance from the slider
    var errRing = [];
    var RING = 1200;
    var CHIST = 300;
    var scoreBeforeVal = null;
    var lqrContrib = { kx: [], kv: [], kt: [], kw: [], total: [] };
    var stateHist  = { x: [], xd: [], th: [], thd: [] };

    var simStatus3 = 'ok';
    var resetTimer3 = null;

    function resetSim() {
      if (resetTimer3) { clearTimeout(resetTimer3); resetTimer3 = null; }
      state = [0, 0, deg2rad(7), 0];   // start with a small tilt so it visibly falls uncontrolled
      simT = 0;
      uForce = 0;
      exc = 0;
      recording = false;
      dataBuf = [];
      lqrActive = false;
      lqrK = null;
      errRing = [];
      scoreBeforeVal = null;
      lqrContrib = { kx: [], kv: [], kt: [], kw: [], total: [] };
      stateHist  = { x: [], xd: [], th: [], thd: [] };
      simStatus3 = 'ok';
      updateUI();
    }

    var recordBtn    = document.getElementById('sid-record-btn');
    var identBtn     = document.getElementById('sid-identify-btn');
    var lqrBtn       = document.getElementById('sid-lqr-btn');
    var analyticBtn  = document.getElementById('sid-analytic-lqr-btn');
    var resetBtn     = document.getElementById('sid-reset');
    var forceSlider  = document.getElementById('sid-force');
    var forceVal     = document.getElementById('sid-force-val');
    var barEl        = document.getElementById('sid-bar');
    var countEl      = document.getElementById('sid-count');
    var matricesEl   = document.getElementById('sid-matrices');
    var aDisplay     = document.getElementById('sid-A-display');
    var bDisplay     = document.getElementById('sid-B-display');
    var lqrSection   = document.getElementById('sid-lqr-section');
    var kDisplay     = document.getElementById('sid-K-display');
    var scoreCompEl  = document.getElementById('sid-score-compare');
    var scoreEl      = document.getElementById('sid-score');
    var sidStatePlot = document.getElementById('sid-state-plot');
    var sidPidPlot   = document.getElementById('sid-pid-plot');
    var NEEDED = 300;

    var CP_STATE_SPEC = [
      { key: 'x',   label: 'x (m)',    color: cssVar('--viz-1') },
      { key: 'xd',  label: 'ẋ (m/s)',  color: cssVar('--viz-2') },
      { key: 'th',  label: 'θ (°)',    color: cssVar('--viz-3') },
      { key: 'thd', label: 'θ̇ (°/s)',  color: cssVar('--viz-4') }
    ];

    // Pre-compute a stabilising gain for closed-loop data collection.
    try {
      var j0 = jacobianAtUpright();
      keepaliveK = runLQRexplicit(j0.A, j0.B, [[1,0,0,0],[0,1,0,0],[0,0,25,0],[0,0,0,3]], 0.5);
    } catch (e) { keepaliveK = null; }

    resetSim();

    if (forceSlider) forceSlider.addEventListener('input', function () {
      pushF = parseFloat(forceSlider.value) || 0;
      if (forceVal) forceVal.textContent = pushF.toFixed(1) + ' N';
    });

    // Q/R weight slider display
    (function() {
      var pairs = [
        ['sid-qx', 'sid-qx-val', 1], ['sid-qth', 'sid-qth-val', 0],
        ['sid-qthd', 'sid-qthd-val', 1], ['sid-r',  'sid-r-val',  2]
      ];
      pairs.forEach(function(p) {
        var sl = document.getElementById(p[0]), vl = document.getElementById(p[1]);
        if (!sl || !vl) return;
        sl.addEventListener('input', function() { vl.textContent = parseFloat(sl.value).toFixed(p[2]); });
      });
    })();

    function updateUI() {
      if (recordBtn) {
        recordBtn.textContent = recording ? 'Stop Recording' : 'Start Recording';
        recordBtn.classList.toggle('recording', recording);
      }
      var n = dataBuf.length;
      var frac = Math.min(n / NEEDED, 1);
      if (barEl)    barEl.style.width = (frac * 100).toFixed(1) + '%';
      if (countEl)  countEl.textContent = n + ' / ' + NEEDED + ' samples';
      if (identBtn) identBtn.disabled = n < NEEDED;
    }

    if (recordBtn) recordBtn.addEventListener('click', function () {
      if (!recording && !keepaliveK) { alert('Stabiliser unavailable — try Analytic LQR instead.'); return; }
      recording = !recording;
      if (recording) { lqrActive = false; lqrK = null; state = [0, 0, deg2rad(2), 0]; simStatus3 = 'ok'; }
      updateUI();
    });
    if (resetBtn)  resetBtn.addEventListener('click', resetSim);

    function activateLQR(K) {
      lqrK = K;
      lqrActive = true;
      recording = false;
      if (state[2] === undefined || Math.abs(state[2]) > FALL_ANGLE) { state = [0, 0, deg2rad(6), 0]; simStatus3 = 'ok'; }
      updateUI();
      if (kDisplay) kDisplay.textContent = 'K = [' + K.map(function (v) { return v.toFixed(3); }).join(', ') + ']';
      if (lqrSection) lqrSection.style.display = '';
      if (errRing.length > 0) scoreBeforeVal = Math.sqrt(errRing.reduce(function(a,b){return a+b;},0)/errRing.length);
      errRing = [];
      lqrContrib = { kx: [], kv: [], kt: [], kw: [], total: [] };
    }

    // ---- System identification ----
    if (identBtn) identBtn.addEventListener('click', function () {
      var result = runSystemID();
      if (!result) { alert('Not enough data.'); return; }
      if (aDisplay) aDisplay.textContent = formatMatrix(result.A, 4, 4);
      if (bDisplay) bDisplay.textContent = formatMatrix([result.B[0], result.B[1], result.B[2], result.B[3]], 4, 1);
      if (matricesEl) matricesEl.style.display = '';
      if (lqrBtn) lqrBtn.disabled = false;
      window._sidResult = result;
    });

    // ---- LQR from system-ID data ----
    if (lqrBtn) lqrBtn.addEventListener('click', function () {
      if (!window._sidResult) return;
      var K = runLQR(window._sidResult.A, window._sidResult.B);
      if (!K) { alert('DARE did not converge — collect more diverse data.'); return; }
      activateLQR(K);
    });

    // ---- Analytic LQR (exact Jacobian, no data needed) ----
    if (analyticBtn) analyticBtn.addEventListener('click', function () {
      var K = computeAnalyticLQR();
      if (!K) { alert('Analytic LQR failed.'); return; }
      if (matricesEl) matricesEl.style.display = '';
      if (aDisplay)   aDisplay.textContent = '(computed from numerical Jacobian at θ = 0)';
      if (bDisplay)   bDisplay.textContent = '';
      activateLQR(K);
    });

    // ---- Simulation step ----
    function step() {
      if (!document.getElementById('sec-sysid').classList.contains('active')) return;
      if (simStatus3 !== 'ok') return;

      var prevState = state.slice();
      var kx_t = 0, kv_t = 0, kt_t = 0, kw_t = 0, uCtrl = 0;

      // Decide the control force for this step (held across substeps).
      if (lqrActive && lqrK) {
        var dx = [state[0] - X_TARGET, state[1], state[2], state[3]];
        kx_t = -lqrK[0]*dx[0]; kv_t = -lqrK[1]*dx[1]; kt_t = -lqrK[2]*dx[2]; kw_t = -lqrK[3]*dx[3];
        uCtrl = kx_t + kv_t + kt_t + kw_t;
      } else if (recording && keepaliveK) {
        // Closed-loop excitation: a light stabiliser keeps the pole near upright
        // while smoothed random forces persistently excite the dynamics.
        exc = 0.9 * exc + 0.1 * gaussian() * 6;
        uCtrl = -(keepaliveK[0]*state[0] + keepaliveK[1]*state[1] + keepaliveK[2]*state[2] + keepaliveK[3]*state[3]) + exc;
      }
      uForce = clamp(uCtrl + pushF, -FMAX, FMAX);

      for (var i = 0; i < SUBSTEPS; i++) {
        state = rk4(state, simT, CP_DT, function (t, s) { return cpDeriv(t, s, uForce); });
        simT += CP_DT;
      }

      if (Math.abs(state[2]) > FALL_ANGLE || Math.abs(state[0]) > X_LIMIT) {
        simStatus3 = Math.abs(state[0]) > X_LIMIT ? 'offtrack' : 'fell';
        recording = false;
        updateUI();
        if (!resetTimer3) resetTimer3 = setTimeout(function () { resetTimer3 = null; resetSim(); }, 2000);
        return;
      }

      // Record system-ID data: deviations from the upright equilibrium (which is 0).
      if (recording) {
        dataBuf.push({
          x:     [state[0], state[1], state[2], state[3]],
          u:     uForce,
          xprev: [prevState[0], prevState[1], prevState[2], prevState[3]]
        });
        updateUI();
      }

      // LQR contribution history (Newtons)
      if (lqrActive) {
        lqrContrib.kx.push(kx_t); lqrContrib.kv.push(kv_t);
        lqrContrib.kt.push(kt_t); lqrContrib.kw.push(kw_t);
        lqrContrib.total.push(kx_t + kv_t + kt_t + kw_t);
        if (lqrContrib.kx.length > CHIST) {
          lqrContrib.kx.shift(); lqrContrib.kv.shift(); lqrContrib.kt.shift(); lqrContrib.kw.shift(); lqrContrib.total.shift();
        }
      }

      // State history
      stateHist.x.push(state[0]); stateHist.xd.push(state[1]);
      stateHist.th.push(rad2deg(state[2])); stateHist.thd.push(rad2deg(state[3]));
      if (stateHist.x.length > CHIST) { stateHist.x.shift(); stateHist.xd.shift(); stateHist.th.shift(); stateHist.thd.shift(); }

      // Score: RMS pole angle over the recent window (deg) — lower is better balance.
      errRing.push(Math.pow(rad2deg(state[2]), 2));
      if (errRing.length > RING) errRing.shift();
      if (scoreEl && errRing.length > 0) {
        var rmse = Math.sqrt(errRing.reduce(function(a,b){return a+b;},0)/errRing.length);
        scoreEl.textContent = rmse.toFixed(2);
        if (scoreBeforeVal !== null && lqrActive && scoreCompEl) {
          scoreCompEl.textContent = 'Before: ' + scoreBeforeVal.toFixed(2) + ' °\nAfter:  ' + rmse.toFixed(2) + ' °';
        }
      }
    }

    setInterval(step, 25);

    // ---- Cart-pole renderer ----
    function drawCartPole() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var W = canvas.parentElement ? canvas.parentElement.clientWidth : canvas.width;
      if (!W) W = 720;
      var H = 380;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = '100%';
      canvas.style.height = H + 'px';
      var ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      var bg = cssVar('--bg'), border = cssVar('--border'), muted = cssVar('--text-muted');
      var text = cssVar('--text'), accent = cssVar('--accent'), mono = cssVar('--mono');
      var poleColor = cssVar('--viz-2');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

      var trackY = H * 0.72;
      var scale = (W * 0.5) / (X_LIMIT + 0.6);   // px per metre
      var cx = W / 2;
      function sx(xm) { return cx + xm * scale; }

      // Track + rail limits
      ctx.strokeStyle = border; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(20, trackY); ctx.lineTo(W - 20, trackY); ctx.stroke();
      ctx.strokeStyle = muted; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
      [-X_LIMIT, X_LIMIT].forEach(function (xm) {
        ctx.beginPath(); ctx.moveTo(sx(xm), trackY - 12); ctx.lineTo(sx(xm), trackY + 12); ctx.stroke();
      });
      // Target set-point marker
      ctx.strokeStyle = accent; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(sx(X_TARGET), trackY - 60); ctx.lineTo(sx(X_TARGET), trackY + 14); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = muted; ctx.font = '10px ' + mono; ctx.textAlign = 'center';
      ctx.fillText('target', sx(X_TARGET), trackY + 28);

      var cartX = sx(state[0]);
      var cartW = 60, cartH = 26;

      // Force arrow (under the cart)
      if (Math.abs(uForce) > 0.2) {
        var fl = clamp(uForce / FMAX, -1, 1) * 46;
        ctx.strokeStyle = poleColor; ctx.fillStyle = poleColor; ctx.lineWidth = 3;
        var ay = trackY + 40;
        ctx.beginPath(); ctx.moveTo(cartX, ay); ctx.lineTo(cartX + fl, ay); ctx.stroke();
        var s = fl >= 0 ? 1 : -1;
        ctx.beginPath();
        ctx.moveTo(cartX + fl, ay); ctx.lineTo(cartX + fl - 7 * s, ay - 4);
        ctx.lineTo(cartX + fl - 7 * s, ay + 4); ctx.closePath(); ctx.fill();
        ctx.fillStyle = muted; ctx.font = '10px ' + mono; ctx.textAlign = 'center';
        ctx.fillText('F = ' + uForce.toFixed(1) + ' N', cartX, ay + 18);
      }

      // Cart
      ctx.fillStyle = accent;
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(cartX - cartW/2, trackY - cartH, cartW, cartH, 5); ctx.fill(); }
      else ctx.fillRect(cartX - cartW/2, trackY - cartH, cartW, cartH);
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.arc(cartX - cartW/4, trackY, 5, 0, 2*Math.PI); ctx.fill();
      ctx.beginPath(); ctx.arc(cartX + cartW/4, trackY, 5, 0, 2*Math.PI); ctx.fill();

      // Pole
      var pivotX = cartX, pivotY = trackY - cartH;
      var poleLenPx = L_POLE * 2 * scale * 0.9;
      var tipX = pivotX + poleLenPx * Math.sin(state[2]);
      var tipY = pivotY - poleLenPx * Math.cos(state[2]);
      ctx.strokeStyle = poleColor; ctx.lineWidth = 6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(pivotX, pivotY); ctx.lineTo(tipX, tipY); ctx.stroke();
      ctx.fillStyle = poleColor;
      ctx.beginPath(); ctx.arc(tipX, tipY, 13, 0, 2*Math.PI); ctx.fill();
      ctx.fillStyle = border;
      ctx.beginPath(); ctx.arc(pivotX, pivotY, 4, 0, 2*Math.PI); ctx.fill();
      ctx.lineCap = 'butt';

      // Mode / status banner
      ctx.textAlign = 'left'; ctx.font = '600 13px ' + cssVar('--font');
      var label, col;
      if (simStatus3 === 'fell')      { label = 'Pole fell over — resetting…'; col = poleColor; }
      else if (simStatus3 === 'offtrack') { label = 'Cart hit the rail — resetting…'; col = poleColor; }
      else if (lqrActive)             { label = 'LQR balancing'; col = accent; }
      else if (recording)             { label = 'Recording (stabiliser + excitation)…'; col = accent; }
      else                            { label = 'Uncontrolled — enable a controller'; col = muted; }
      ctx.fillStyle = col; ctx.fillText(label, 18, 26);
      ctx.fillStyle = muted; ctx.font = '11px ' + mono;
      ctx.fillText('θ = ' + rad2deg(state[2]).toFixed(1) + '°   x = ' + state[0].toFixed(2) + ' m', 18, 44);
    }

    function loop() {
      drawCartPole();
      drawStatePlot(sidStatePlot, stateHist, CP_STATE_SPEC);
      drawContribPlot(sidPidPlot, [
        { label: 'Kₓ·Δx',  color: cssVar('--viz-1'),     data: lqrContrib.kx },
        { label: 'Kᵥ·Δẋ',  color: cssVar('--viz-2'),     data: lqrContrib.kv },
        { label: 'K_θ·Δθ', color: cssVar('--viz-3'),     data: lqrContrib.kt },
        { label: 'K_ω·Δθ̇', color: cssVar('--viz-4'),     data: lqrContrib.kw },
        { label: 'Total F', color: cssVar('--viz-total'), data: lqrContrib.total }
      ], FMAX, 'force (N)');
      requestAnimationFrame(loop);
    }
    loop();

    /* ---- System ID: least squares ---- */
    function runSystemID() {
      var n = dataBuf.length;
      if (n < NEEDED) return null;

      // Build Φ (N×5) and Y (N×4). Fit ẋ ≈ A·x + B·u by least squares.
      var dt = CP_DT * SUBSTEPS;  // one recorded sample per control step

      // Each record holds one control step: xprev → x under force u. Pair the
      // transition with the force that actually caused it (self-consistent).
      // Φ row: [x, ẋ, θ, θ̇, F]   Y row: [(x − xprev) / dt]
      var Phi = [], Y = [];
      for (var i = 0; i < n; i++) {
        var d = dataBuf[i];
        Phi.push(d.xprev.concat([d.u]));
        Y.push([
          (d.x[0] - d.xprev[0]) / dt,
          (d.x[1] - d.xprev[1]) / dt,
          (d.x[2] - d.xprev[2]) / dt,
          (d.x[3] - d.xprev[3]) / dt
        ]);
      }

      // Normal equations: (Φ'Φ) θ = Φ'Y  for each column of Y
      var PhiTPhiInv = matInv5(matMul5T(Phi, Phi));
      if (!PhiTPhiInv) return null;

      var A = [], B = [];
      for (var col = 0; col < 4; col++) {
        var Yc = Y.map(function (r) { return r[col]; });
        var PhiTYc = matMulTv5(Phi, Yc);
        var theta = matMulVec5(PhiTPhiInv, PhiTYc);  // 5-vector
        A.push(theta.slice(0, 4));
        B.push(theta[4]);
      }

      // A is currently 4×4 where A[i] is row i of A^T → transpose
      var At = [];
      for (var i = 0; i < 4; i++) {
        At.push([A[0][i], A[1][i], A[2][i], A[3][i]]);
      }

      return { A: At, B: B };
    }

    /* ---- Continuous Jacobian of the cart-pole at the upright equilibrium ---- */
    function jacobianAtUpright() {
      var eps = 1e-5;
      var x0 = [0, 0, 0, 0], u0 = 0;
      function f4(x, u) { return cpDeriv(0, x, u); }
      var cols = [];
      for (var jj = 0; jj < 4; jj++) {
        var xp = x0.slice(); xp[jj] += eps;
        var xm = x0.slice(); xm[jj] -= eps;
        var fp = f4(xp, u0), fm = f4(xm, u0);
        cols.push(fp.map(function(v, i) { return (v - fm[i]) / (2 * eps); }));
      }
      var Aj = [[],[],[],[]];
      for (var jj = 0; jj < 4; jj++) for (var ii = 0; ii < 4; ii++) Aj[ii].push(cols[jj][ii]);
      var fp2 = f4(x0, u0 + eps), fm2 = f4(x0, u0 - eps);
      var Bj = fp2.map(function(v, i) { return (v - fm2[i]) / (2 * eps); });
      return { A: Aj, B: Bj };
    }

    /* ---- Analytic LQR: exact Jacobian → DARE (no data needed) ---- */
    function computeAnalyticLQR() {
      var j = jacobianAtUpright();
      return runLQR(j.A, j.B);
    }

    /* ---- LQR via DARE ---- */
    function getLQRWeights() {
      var qx   = parseFloat((document.getElementById('sid-qx')   || {value:'5'}).value);
      var qth  = parseFloat((document.getElementById('sid-qth')  || {value:'100'}).value);
      var qthd = parseFloat((document.getElementById('sid-qthd') || {value:'1'}).value);
      var R    = parseFloat((document.getElementById('sid-r')    || {value:'0.1'}).value);
      // Q = diag(x, ẋ, θ, θ̇); cart-velocity weight is a small fixed value.
      return { Q: [[qx,0,0,0],[0,0.5,0,0],[0,0,qth,0],[0,0,0,qthd]], R: R };
    }

    function runLQR(A, B) {
      var w = getLQRWeights();
      return runLQRexplicit(A, B, w.Q, w.R);
    }

    // Discrete-time LQR by iterating the Riccati recursion to convergence.
    function runLQRexplicit(A, B, Q, R) {
      var dt = CP_DT * SUBSTEPS;   // control period → Euler discretisation
      var Ad = mat4add(mat4eye(), mat4scale(A, dt));
      var Bd = B.map(function (v) { return v * dt; });

      var P = mat4copy(Q);
      for (var iter = 0; iter < 2000; iter++) {
        // BPBA = Ad' P B (R + B' P B)^-1 B' P Ad
        var PB    = mat4mulVec(P, Bd);         // 4-vec
        var BtPB  = vecDot4(Bd, PB) + R;       // scalar
        var BtPAd = mat4vecMulLeft(Bd, mat4mul(P, Ad));  // Bd' * P * Ad → 4-vec
        // P_{k+1} = Q + Ad'PAd - (Ad'PB)(BtPB)^-1 (B'PAd)
        var AdtPAd = mat4mul(mat4T(Ad), mat4mul(P, Ad));
        var outer  = mat4outerScale(mat4mulVec(mat4T(Ad), PB), BtPAd, 1 / BtPB);
        var Pnew = mat4add(mat4add(Q, AdtPAd), mat4scale(outer, -1));
        // Check convergence
        var diff = 0;
        for (var r = 0; r < 4; r++)
          for (var c = 0; c < 4; c++)
            diff += Math.pow(Pnew[r][c] - P[r][c], 2);
        P = Pnew;
        if (diff < 1e-12) break;
      }
      // K = (R + Bd'PBd)^-1 Bd'PAd
      var PBd    = mat4mulVec(P, Bd);
      var BtPBd  = vecDot4(Bd, PBd) + R;
      var BtPAd2 = mat4vecMulLeft(Bd, mat4mul(P, Ad));
      return BtPAd2.map(function (v) { return v / BtPBd; });
    }

    /* ---- Matrix utilities (4×4 and 5×5) ---- */

    function mat4eye() {
      return [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]];
    }
    function mat4copy(m) { return m.map(function (r) { return r.slice(); }); }
    function mat4add(A, B) {
      return A.map(function (r, i) { return r.map(function (v, j) { return v + B[i][j]; }); });
    }
    function mat4scale(A, s) {
      return A.map(function (r) { return r.map(function (v) { return v * s; }); });
    }
    function mat4mul(A, B) {
      var C = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
      for (var i = 0; i < 4; i++)
        for (var j = 0; j < 4; j++)
          for (var k = 0; k < 4; k++) C[i][j] += A[i][k] * B[k][j];
      return C;
    }
    function mat4T(A) {
      return [[A[0][0],A[1][0],A[2][0],A[3][0]],
              [A[0][1],A[1][1],A[2][1],A[3][1]],
              [A[0][2],A[1][2],A[2][2],A[3][2]],
              [A[0][3],A[1][3],A[2][3],A[3][3]]];
    }
    function mat4mulVec(A, v) {
      return A.map(function (r) { return r[0]*v[0]+r[1]*v[1]+r[2]*v[2]+r[3]*v[3]; });
    }
    function mat4vecMulLeft(v, A) {  // v' * A  (treats v as row)
      return [0,1,2,3].map(function (j) {
        return v[0]*A[0][j]+v[1]*A[1][j]+v[2]*A[2][j]+v[3]*A[3][j];
      });
    }
    function vecDot4(a, b) { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3]; }
    function mat4outerScale(col, row, s) {  // col ⊗ row * s
      return col.map(function (c) { return row.map(function (r) { return c * r * s; }); });
    }

    // 5×5 matrix ops for system ID normal equations
    function matMul5T(Phi, B) {
      // Phi' * Phi  (5×5) where Phi is N×5
      var N = Phi.length;
      var C = [];
      for (var i = 0; i < 5; i++) { C.push([]); for (var j = 0; j < 5; j++) C[i].push(0); }
      for (var n = 0; n < N; n++)
        for (var i = 0; i < 5; i++)
          for (var j = 0; j < 5; j++) C[i][j] += Phi[n][i] * Phi[n][j];
      return C;
    }
    function matMulTv5(Phi, y) {
      // Phi' * y  (5-vec) where Phi N×5, y N-vec
      var v = [0,0,0,0,0];
      for (var n = 0; n < Phi.length; n++)
        for (var i = 0; i < 5; i++) v[i] += Phi[n][i] * y[n];
      return v;
    }
    function matMulVec5(A, v) {
      return A.map(function (r) {
        var s = 0; for (var i = 0; i < 5; i++) s += r[i] * v[i]; return s;
      });
    }
    function matInv5(M) {
      // Gaussian elimination with partial pivoting (5×5)
      var n = 5;
      var a = M.map(function (r) { return r.slice(); });
      var inv = [];
      for (var i = 0; i < n; i++) { inv.push([]); for (var j = 0; j < n; j++) inv[i].push(i === j ? 1 : 0); }
      for (var col = 0; col < n; col++) {
        // Pivot
        var maxRow = col;
        for (var row = col + 1; row < n; row++) if (Math.abs(a[row][col]) > Math.abs(a[maxRow][col])) maxRow = row;
        var tmp = a[col]; a[col] = a[maxRow]; a[maxRow] = tmp;
        var ti  = inv[col]; inv[col] = inv[maxRow]; inv[maxRow] = ti;
        var piv = a[col][col];
        if (Math.abs(piv) < 1e-14) return null;
        for (var j = 0; j < n; j++) { a[col][j] /= piv; inv[col][j] /= piv; }
        for (var row = 0; row < n; row++) {
          if (row === col) continue;
          var f = a[row][col];
          for (var j = 0; j < n; j++) { a[row][j] -= f * a[col][j]; inv[row][j] -= f * inv[col][j]; }
        }
      }
      return inv;
    }

    function formatMatrix(m, rows, cols) {
      // m can be flat (rows*cols) or rows-of-cols
      var lines = [];
      for (var i = 0; i < rows; i++) {
        var parts = [];
        for (var j = 0; j < cols; j++) {
          var v = Array.isArray(m[i]) ? m[i][j] : m[i * cols + j];
          parts.push((v >= 0 ? ' ' : '') + v.toFixed(4));
        }
        lines.push('  [ ' + parts.join('  ') + ' ]');
      }
      return lines.join('\n');
    }
  })();

  /* ================================================================
     Demo 4 — Neural Network Controller (race car)
     Behavioral cloning: a feedforward net learns to drive the car
     around the B-spline track by imitating a pure-pursuit expert,
     trained in-browser via Adam.
  ================================================================ */
  (function nnDemo() {
    var canvas = document.getElementById('nn-canvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');

    /* ── Track geometry (its own single-loop B-spline oval — kept simple, with
       no crossovers, so the cloned network has a clean racing line to imitate;
       the Race Track demo uses a harder multi-loop trefoil circuit) ── */
    var VW = 700, VH = 420;
    var TW = 36;            // track half-width (virtual px)
    var WB = 28;            // wheelbase (virtual px)
    var MAX_STEER = 0.48;   // max steer angle (rad)
    var LA = 70;            // pure-pursuit lookahead (virtual px)
    var NS = 500;           // path samples

    var RAW = [
      [130, 355], [310, 355], [490, 355],
      [565, 305], [600, 245], [590, 188],
      [555, 150], [500, 133], [455, 152],
      [425, 110], [330, 78],  [210, 74],
      [148, 106], [110, 165], [86,  237],
      [105, 305]
    ];

    function bspline4(p0, p1, p2, p3, t) {
      var t2 = t * t, t3 = t2 * t;
      var b0 = (-t3 + 3*t2 - 3*t + 1) / 6;
      var b1 = ( 3*t3 - 6*t2       + 4) / 6;
      var b2 = (-3*t3 + 3*t2 + 3*t + 1) / 6;
      var b3 = t3 / 6;
      return [
        b0*p0[0] + b1*p1[0] + b2*p2[0] + b3*p3[0],
        b0*p0[1] + b1*p1[1] + b2*p2[1] + b3*p3[1]
      ];
    }

    var path = [];
    (function buildPath() {
      var n = RAW.length;
      for (var ii = 0; ii < NS; ii++) {
        var u   = ii / NS * n;
        var si  = Math.floor(u) % n;
        var t   = u - Math.floor(u);
        var p0 = RAW[(si-1+n)%n], p1 = RAW[si], p2 = RAW[(si+1)%n], p3 = RAW[(si+2)%n];
        var pt  = bspline4(p0, p1, p2, p3, t);
        var u2  = (ii / NS + 0.001) * n;
        var si2 = Math.floor(u2) % n;
        var t2  = u2 - Math.floor(u2);
        var pt2 = bspline4(RAW[(si2-1+n)%n], RAW[si2], RAW[(si2+1)%n], RAW[(si2+2)%n], t2);
        var tx  = pt2[0] - pt[0], ty = pt2[1] - pt[1];
        var tl  = Math.hypot(tx, ty) || 1;
        path.push({ x: pt[0], y: pt[1], nx: -ty/tl, ny: tx/tl, tx: tx/tl, ty: ty/tl });
      }
    })();

    /* ── Canvas sizing + virtual→screen transform ─────────────── */
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var W = 700, H = 380, vScale = 1, vOx = 0, vOy = 0;

    function resizeCanvas() {
      W = canvas.parentElement.clientWidth || 700;
      H = Math.max(300, Math.min(400, Math.round(W * 0.55)));
      canvas.width  = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width  = W + 'px';
      canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      vScale = Math.min(W / VW, H / VH) * 0.92;
      vOx    = (W - VW * vScale) / 2;
      vOy    = (H - VH * vScale) / 2;
    }
    new ResizeObserver(resizeCanvas).observe(canvas.parentElement);
    resizeCanvas();
    function sx(x) { return x * vScale + vOx; }
    function sy(y) { return y * vScale + vOy; }

    /* ── Car kinematics (bicycle model) ───────────────────────── */
    function makeCar() {
      var p0 = path[0], p1 = path[1];
      return {
        x: p0.x, y: p0.y,
        heading: Math.atan2(p1.y - p0.y, p1.x - p0.x),
        steer: 0, speed: 52, pathIdx: 0
      };
    }
    function stepCar(car, dt) {
      var delta = car.steer * MAX_STEER;
      car.x       += car.speed * Math.cos(car.heading) * dt;
      car.y       += car.speed * Math.sin(car.heading) * dt;
      car.heading += (car.speed / WB) * Math.tan(delta) * dt;
      while (car.heading >  Math.PI) car.heading -= 2 * Math.PI;
      while (car.heading < -Math.PI) car.heading += 2 * Math.PI;
    }
    function nearestIdx(car) {
      var n = NS, best = car.pathIdx, bestD = Infinity;
      for (var i = -20; i <= 80; i++) {
        var idx = (car.pathIdx + i + n) % n;
        var d   = Math.hypot(path[idx].x - car.x, path[idx].y - car.y);
        if (d < bestD) { bestD = d; best = idx; }
      }
      car.pathIdx = best;
      return best;
    }
    function getErrors(car) {
      var idx = nearestIdx(car), p = path[idx];
      var dx = car.x - p.x, dy = car.y - p.y;
      var ey = dx * p.nx + dy * p.ny;
      var eth = Math.atan2(p.ty, p.tx) - car.heading;
      while (eth >  Math.PI) eth -= 2 * Math.PI;
      while (eth < -Math.PI) eth += 2 * Math.PI;
      return { ey: ey, eth: eth };
    }
    // Signed angle from the car to the centreline point `dist` px ahead.
    function previewAngle(car, dist) {
      var walked = 0, idx = car.pathIdx;
      while (walked < dist) {
        var next = (idx + 1) % NS;
        walked += Math.hypot(path[next].x - path[idx].x, path[next].y - path[idx].y);
        idx = next;
        if (idx === car.pathIdx) break;
      }
      var tgt = path[idx];
      var a = Math.atan2(tgt.y - car.y, tgt.x - car.x) - car.heading;
      while (a >  Math.PI) a -= 2 * Math.PI;
      while (a < -Math.PI) a += 2 * Math.PI;
      return a;
    }
    var PREVIEW = [35, 70, 105, 140];
    // Observation vector fed to the network (6 inputs).
    function observe(car) {
      var e = getErrors(car);   // also refreshes car.pathIdx
      var x = [e.ey, e.eth];
      for (var i = 0; i < PREVIEW.length; i++) x.push(previewAngle(car, PREVIEW[i]));
      return { x: x, errs: e };
    }
    // Pure-pursuit expert we clone: steer toward the lookahead point.
    function expertSteer(car) {
      nearestIdx(car);
      return clamp(previewAngle(car, LA) * 2.2, -1, 1);
    }

    /* ── Episode state ────────────────────────────────────────── */
    var car, expertCar, steerCmd, manual, simStatus, resetTimer;
    var lastErrs = { ey: 0, eth: 0 };
    var CHIST = 300, RING = 900;
    var cteRing = [];
    var lastNNCache = null;
    var stateHist = { ey: [], eth: [] };
    var outHist   = { nn: [], exp: [] };

    function resetSim() {
      if (resetTimer) { clearTimeout(resetTimer); resetTimer = null; }
      car = makeCar();
      car.x += path[0].nx * 11; car.y += path[0].ny * 11;
      expertCar = makeCar();
      expertCar.x -= path[0].nx * 11; expertCar.y -= path[0].ny * 11;
      expertCar.speed = 50;
      steerCmd = 0; manual = false; simStatus = 'ok';
      lastErrs = { ey: 0, eth: 0 };
      cteRing = [];
      stateHist = { ey: [], eth: [] };
      outHist   = { nn: [], exp: [] };
      lastNNCache = null;
      if (steerSlider) { steerSlider.value = '0'; if (steerVal) steerVal.textContent = '0.00'; }
    }

    /* ── Neural network (arbitrary depth feedforward, tanh) ───── */
    // Input normalisation: eᵧ (px), e_θ (rad), four preview angles (rad).
    var INPUT_SCALES = [22, 0.5, 0.8, 0.8, 0.8, 0.8];
    var nLayers = 1, nNeurons = 16;
    var net = null, adam = null, nnActive = false;
    var lossHistory = [], trainingData = null;

    function getLayerSizes() {
      var s = [6];
      for (var i = 0; i < nLayers; i++) s.push(nNeurons);
      s.push(1);
      return s;
    }
    function initNet(sizes) {
      var W = [], b = [];
      for (var l = 0; l < sizes.length-1; l++) {
        var ni = sizes[l], no = sizes[l+1];
        var w = new Float64Array(ni*no);
        var sc = Math.sqrt(2/ni);
        for (var k = 0; k < w.length; k++) {
          var u1 = Math.random()+1e-10, u2 = Math.random();
          w[k] = sc * Math.sqrt(-2*Math.log(u1)) * Math.cos(2*Math.PI*u2);
        }
        W.push(w); b.push(new Float64Array(no));
      }
      return { sizes: sizes, W: W, b: b };
    }
    function fwdNet(nn, xRaw) {
      var inp = xRaw.map(function(v,i) { return clamp(v/INPUT_SCALES[i],-3,3); });
      var a = [new Float64Array(inp)];
      for (var l = 0; l < nn.W.length; l++) {
        var ni = nn.sizes[l], no = nn.sizes[l+1];
        var z = new Float64Array(no);
        for (var i = 0; i < no; i++) {
          var sum = nn.b[l][i];
          for (var j = 0; j < ni; j++) sum += nn.W[l][i*ni+j] * a[l][j];
          z[i] = (l < nn.W.length-1) ? Math.tanh(sum) : sum;
        }
        a.push(z);
      }
      return { out: a[a.length-1][0], a: a };
    }
    function bwdNet(nn, cache, target) {
      var nL = nn.W.length;
      var dW = nn.W.map(function(w) { return new Float64Array(w.length); });
      var db = nn.b.map(function(bi) { return new Float64Array(bi.length); });
      var delta = [cache.out - target];
      for (var l = nL-1; l >= 0; l--) {
        var ni = nn.sizes[l], no = nn.sizes[l+1];
        for (var i = 0; i < no; i++) {
          var d = delta[i];
          if (l < nL-1) d *= (1 - cache.a[l+1][i]*cache.a[l+1][i]);
          db[l][i] += d;
          for (var j = 0; j < ni; j++) dW[l][i*ni+j] += d * cache.a[l][j];
        }
        if (l > 0) {
          var dp = new Float64Array(ni);
          for (var j = 0; j < ni; j++) {
            var s = 0;
            for (var i = 0; i < no; i++) {
              var d2 = delta[i];
              if (l < nL-1) d2 *= (1 - cache.a[l+1][i]*cache.a[l+1][i]);
              s += nn.W[l][i*ni+j] * d2;
            }
            dp[j] = s;
          }
          delta = Array.prototype.slice.call(dp);
        }
      }
      return { dW: dW, db: db };
    }
    function initAdam(nn) {
      return {
        mW: nn.W.map(function(w) { return new Float64Array(w.length); }),
        vW: nn.W.map(function(w) { return new Float64Array(w.length); }),
        mb: nn.b.map(function(bi) { return new Float64Array(bi.length); }),
        vb: nn.b.map(function(bi) { return new Float64Array(bi.length); }),
        t: 0
      };
    }
    function adamStep(nn, grads, am, lr) {
      var b1=0.9, b2=0.999, eps=1e-8;
      am.t++;
      var bc1 = 1-Math.pow(b1,am.t), bc2 = 1-Math.pow(b2,am.t);
      for (var l = 0; l < nn.W.length; l++) {
        for (var k = 0; k < nn.W[l].length; k++) {
          am.mW[l][k] = b1*am.mW[l][k] + (1-b1)*grads.dW[l][k];
          am.vW[l][k] = b2*am.vW[l][k] + (1-b2)*grads.dW[l][k]*grads.dW[l][k];
          nn.W[l][k] -= lr*(am.mW[l][k]/bc1) / (Math.sqrt(am.vW[l][k]/bc2)+eps);
        }
        for (var k = 0; k < nn.b[l].length; k++) {
          am.mb[l][k] = b1*am.mb[l][k] + (1-b1)*grads.db[l][k];
          am.vb[l][k] = b2*am.vb[l][k] + (1-b2)*grads.db[l][k]*grads.db[l][k];
          nn.b[l][k] -= lr*(am.mb[l][k]/bc1) / (Math.sqrt(am.vb[l][k]/bc2)+eps);
        }
      }
    }

    /* ── Training data: expert rollouts with perturbations ────── */
    function genData() {
      var data = [];
      var c = makeCar();
      for (var i = 0; i < 2400; i++) {
        // Periodically knock the car off the racing line so the net sees
        // recovery states, not just the perfect trajectory.
        if (i % 45 === 0) {
          var p = path[c.pathIdx];
          var off = (Math.random()-0.5) * 2 * TW * 0.85;
          c.x = p.x + p.nx * off; c.y = p.y + p.ny * off;
          c.heading = Math.atan2(p.ty, p.tx) + (Math.random()-0.5) * 0.8;
        }
        var o = observe(c);
        var steer = expertSteer(c);
        data.push({ x: o.x, y: steer });
        c.steer = steer;
        stepCar(c, 0.03);
      }
      return data;
    }

    /* ── Loss canvas ─────────────────────────────────────────── */
    var lossCanvas = document.getElementById('nn-loss-canvas');
    var lossCtx    = lossCanvas && lossCanvas.getContext('2d');
    function drawLoss() {
      if (!lossCtx || !lossHistory.length) return;
      var LW = lossCanvas.offsetWidth || 200, LH = 72;
      lossCanvas.width  = Math.round(LW * (window.devicePixelRatio || 1));
      lossCanvas.height = Math.round(LH * (window.devicePixelRatio || 1));
      lossCtx.setTransform(window.devicePixelRatio||1, 0, 0, window.devicePixelRatio||1, 0, 0);
      lossCtx.fillStyle = cssVar('--bg-soft');
      lossCtx.fillRect(0, 0, LW, LH);
      var maxL = Math.max.apply(null, lossHistory), n = lossHistory.length;
      lossCtx.strokeStyle = cssVar('--accent');
      lossCtx.lineWidth = 1.5;
      lossCtx.beginPath();
      for (var i = 0; i < n; i++) {
        var x = (i / Math.max(n-1, 1)) * LW;
        var y = LH - 4 - (lossHistory[i] / Math.max(maxL, 1e-9)) * (LH-8);
        if (i === 0) lossCtx.moveTo(x, y); else lossCtx.lineTo(x, y);
      }
      lossCtx.stroke();
      lossCtx.fillStyle = cssVar('--text-muted');
      lossCtx.font = '10px monospace';
      lossCtx.textAlign = 'left'; lossCtx.textBaseline = 'top';
      lossCtx.fillText('MSE loss', 4, 3);
    }

    /* ── Training loop (async via setTimeout) ────────────────── */
    function runEpoch(data, batchSize) {
      for (var i = data.length-1; i > 0; i--) {
        var j = Math.floor(Math.random()*(i+1));
        var tmp = data[i]; data[i] = data[j]; data[j] = tmp;
      }
      var totalLoss = 0;
      for (var b = 0; b < data.length; b += batchSize) {
        var batch = data.slice(b, b+batchSize);
        var accDW = net.W.map(function(w) { return new Float64Array(w.length); });
        var accDb = net.b.map(function(bi) { return new Float64Array(bi.length); });
        for (var s = 0; s < batch.length; s++) {
          var cache = fwdNet(net, batch[s].x);
          var err = cache.out - batch[s].y;
          totalLoss += err*err;
          var g = bwdNet(net, cache, batch[s].y);
          for (var l = 0; l < net.W.length; l++) {
            for (var k = 0; k < net.W[l].length; k++) accDW[l][k] += g.dW[l][k] / batch.length;
            for (var k = 0; k < net.b[l].length; k++) accDb[l][k] += g.db[l][k] / batch.length;
          }
        }
        adamStep(net, { dW: accDW, db: accDb }, adam, 0.001);
      }
      return totalLoss / data.length;
    }

    var trainStatusEl = document.getElementById('nn-train-status');
    var activateBtnEl = document.getElementById('nn-activate-btn');
    function trainLoop(epoch, maxEpochs) {
      if (epoch >= maxEpochs) {
        if (trainStatusEl) trainStatusEl.textContent = 'Done — ' + maxEpochs + ' epochs';
        if (activateBtnEl) activateBtnEl.disabled = false;
        return;
      }
      var loss = runEpoch(trainingData, 32);
      lossHistory.push(loss);
      if (trainStatusEl) trainStatusEl.textContent = 'Epoch ' + (epoch+1) + '/' + maxEpochs
        + '  loss ' + loss.toFixed(5);
      drawLoss();
      setTimeout(function() { trainLoop(epoch+1, maxEpochs); }, 0);
    }

    /* ── DOM wiring ──────────────────────────────────────────── */
    var layersSlider  = document.getElementById('nn-layers');
    var neuronsSlider = document.getElementById('nn-neurons');
    var layersVal     = document.getElementById('nn-layers-val');
    var neuronsVal    = document.getElementById('nn-neurons-val');
    var genBtn        = document.getElementById('nn-gen-btn');
    var genStatus     = document.getElementById('nn-gen-status');
    var trainBtn      = document.getElementById('nn-train-btn');
    var scoreEl       = document.getElementById('nn-score');
    var resetBtn      = document.getElementById('nn-reset');
    var steerSlider   = document.getElementById('nn-steer');
    var steerVal      = document.getElementById('nn-steer-val');
    var nnStatePlot   = document.getElementById('nn-state-plot');
    var nnPidPlot     = document.getElementById('nn-pid-plot');
    var nnNetCanvas   = document.getElementById('nn-net-canvas');

    resetSim();

    if (steerSlider) steerSlider.addEventListener('input', function() {
      manual = true;
      if (!nnActive) steerCmd = parseFloat(steerSlider.value);
      if (steerVal) steerVal.textContent = parseFloat(steerSlider.value).toFixed(2);
    });

    // Keyboard steering (manual mode only): ←/→
    document.addEventListener('keydown', function(e) {
      var sec = document.getElementById('sec-nn');
      if (!sec || !sec.classList.contains('active')) return;
      if (nnActive) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        manual = true;
        var step = (e.key === 'ArrowLeft') ? -0.06 : 0.06;
        steerCmd = clamp(steerCmd + step, -1, 1);
        if (steerSlider) { steerSlider.value = steerCmd.toFixed(2); if (steerVal) steerVal.textContent = steerCmd.toFixed(2); }
      }
    });

    function archChanged() {
      nLayers  = parseInt(layersSlider.value);
      nNeurons = parseInt(neuronsSlider.value);
      if (layersVal)  layersVal.textContent  = nLayers;
      if (neuronsVal) neuronsVal.textContent = nNeurons;
      // Keep an (untrained) net so the diagram always shows the current
      // architecture; training reinitialises it. Activation stays gated on
      // the button's disabled state, so an untrained net can't take control.
      net = initNet(getLayerSizes()); nnActive = false; lossHistory = [];
      if (activateBtnEl) { activateBtnEl.disabled = true; activateBtnEl.textContent = 'Activate NN'; activateBtnEl.classList.remove('active'); }
      if (trainStatusEl) trainStatusEl.textContent = 'Architecture changed — retrain';
      if (lossCtx) lossCtx.clearRect(0, 0, lossCanvas.width, lossCanvas.height);
    }
    if (layersSlider)  layersSlider.addEventListener('input', archChanged);
    if (neuronsSlider) neuronsSlider.addEventListener('input', archChanged);
    net = initNet(getLayerSizes());  // show the architecture before training

    if (genBtn) genBtn.addEventListener('click', function() {
      genBtn.disabled = true;
      if (genStatus) genStatus.textContent = 'Generating…';
      setTimeout(function() {
        trainingData = genData();
        genBtn.disabled = false;
        if (genStatus) genStatus.textContent = trainingData.length + ' samples ready';
        if (trainBtn) trainBtn.disabled = false;
      }, 20);
    });

    if (trainBtn) trainBtn.addEventListener('click', function() {
      if (!trainingData) return;
      net = initNet(getLayerSizes());
      adam = initAdam(net);
      lossHistory = [];
      nnActive = false;
      if (activateBtnEl) { activateBtnEl.disabled = true; activateBtnEl.textContent = 'Activate NN'; activateBtnEl.classList.remove('active'); }
      trainLoop(0, 150);
    });

    if (activateBtnEl) activateBtnEl.addEventListener('click', function() {
      if (!net) return;
      nnActive = !nnActive;
      activateBtnEl.textContent = nnActive ? 'Deactivate NN' : 'Activate NN';
      activateBtnEl.classList.toggle('active', nnActive);
    });

    if (resetBtn) resetBtn.addEventListener('click', resetSim);

    /* ── Simulation step ─────────────────────────────────────── */
    var STEER_RATE = 0.14;  // max steer-command change per substep
    setInterval(function() {
      var sec = document.getElementById('sec-nn');
      if (!sec || !sec.classList.contains('active')) return;
      if (simStatus !== 'ok') return;

      var dt = 0.03, SUBS = 3;
      for (var i = 0; i < SUBS; i++) {
        // Expert reference car (always pure-pursuit)
        expertCar.steer = expertSteer(expertCar);
        stepCar(expertCar, dt);

        // Learner car
        var o = observe(car);
        lastErrs = o.errs;
        if (net) lastNNCache = fwdNet(net, o.x);   // always light the diagram
        if (nnActive && net) {
          var target = clamp(lastNNCache.out, -1, 1);
          steerCmd += clamp(target - steerCmd, -STEER_RATE, STEER_RATE);
        } else if (!manual) {
          // Before the net drives (and until you take over), shadow the
          // expert so the car laps cleanly instead of driving off.
          steerCmd = expertSteer(car);
        }
        car.steer = steerCmd;
        stepCar(car, dt);

        if (Math.abs(o.errs.ey) > TW * 2.2) {
          simStatus = 'off';
          if (!resetTimer) resetTimer = setTimeout(function() { resetTimer = null; resetSim(); }, 1600);
          break;
        }
        cteRing.push(o.errs.ey * o.errs.ey);
        if (cteRing.length > RING) cteRing.shift();
      }

      if (nnActive && steerSlider) { steerSlider.value = car.steer.toFixed(2); if (steerVal) steerVal.textContent = car.steer.toFixed(2); }

      // History
      stateHist.ey.push(lastErrs.ey); stateHist.eth.push(lastErrs.eth);
      outHist.nn.push(car.steer);     outHist.exp.push(expertSteer(car));
      if (stateHist.ey.length > CHIST) { stateHist.ey.shift(); stateHist.eth.shift(); }
      if (outHist.nn.length   > CHIST) { outHist.nn.shift();   outHist.exp.shift(); }

      if (scoreEl && cteRing.length > 0) {
        var rmse = Math.sqrt(cteRing.reduce(function(a,b){return a+b;},0) / cteRing.length);
        scoreEl.textContent = rmse.toFixed(1);
      }
    }, 25);

    /* ── Rendering ───────────────────────────────────────────── */
    function darkMode() {
      return document.documentElement.getAttribute('data-theme') === 'dark' ||
        (!document.documentElement.getAttribute('data-theme') &&
         window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
    function drawTrack() {
      var n = NS, dark = darkMode(), tw = TW * vScale;
      ctx.beginPath();
      for (var i = 0; i < n; i++) { var p = path[i]; if (i===0) ctx.moveTo(sx(p.x), sy(p.y)); else ctx.lineTo(sx(p.x), sy(p.y)); }
      ctx.closePath();
      ctx.lineWidth = tw * 2; ctx.strokeStyle = dark ? '#1c1c2e' : '#2c2c2c';
      ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
      [1, -1].forEach(function(side) {
        ctx.beginPath();
        for (var i = 0; i < n; i++) {
          var p = path[i];
          var ex = sx(p.x + p.nx * TW * 0.90 * side), ey = sy(p.y + p.ny * TW * 0.90 * side);
          if (i===0) ctx.moveTo(ex, ey); else ctx.lineTo(ex, ey);
        }
        ctx.closePath(); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.60)'; ctx.lineJoin = 'round'; ctx.stroke();
      });
      ctx.beginPath();
      for (var i = 0; i < n; i++) { var p = path[i]; if (i===0) ctx.moveTo(sx(p.x), sy(p.y)); else ctx.lineTo(sx(p.x), sy(p.y)); }
      ctx.closePath();
      ctx.lineWidth = 1.5; ctx.strokeStyle = cssVar('--accent');
      ctx.setLineDash([6 * vScale, 8 * vScale]); ctx.stroke(); ctx.setLineDash([]);
      var sp = path[0];
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(sx(sp.x + sp.nx * TW * 0.92), sy(sp.y + sp.ny * TW * 0.92));
      ctx.lineTo(sx(sp.x - sp.nx * TW * 0.92), sy(sp.y - sp.ny * TW * 0.92));
      ctx.stroke();
    }
    function drawCar(car, bodyColor, label) {
      var csx = sx(car.x), csy = sy(car.y);
      var cl = 20 * vScale, cw = 8 * vScale;
      ctx.save();
      ctx.translate(csx, csy); ctx.rotate(car.heading);
      ctx.fillStyle = bodyColor;
      ctx.beginPath(); ctx.roundRect(-cl*0.5, -cw*0.5, cl, cw, 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.moveTo(cl*0.5, 0); ctx.lineTo(cl*0.5 - cw*0.8, -cw*0.45); ctx.lineTo(cl*0.5 - cw*0.8, cw*0.45);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = bodyColor;
      ctx.fillRect(cl*0.26, -cw*0.75, cw*0.6, cw*1.5);
      ctx.fillRect(-cl*0.50, -cw*0.75, cw*0.5, cw*1.5);
      ctx.restore();
      ctx.fillStyle = bodyColor;
      ctx.font = 'bold ' + Math.max(9, Math.round(10 * vScale)) + 'px ' + cssVar('--mono');
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(label, csx, csy - cw * 0.6);
    }
    function raceRender() {
      var dark = darkMode();
      ctx.fillStyle = dark ? '#0c1a0c' : '#4a8040';
      ctx.fillRect(0, 0, W, H);
      drawTrack();
      drawCar(expertCar, '#e74c3c', 'Expert');
      drawCar(car, cssVar('--accent'), nnActive ? 'NN' : (manual ? 'Manual' : 'Shadow'));
      ctx.save();
      ctx.font = 'bold 11px ' + cssVar('--mono');
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      if (nnActive) { ctx.fillStyle = 'rgba(80,200,120,0.95)'; ctx.fillText('● NN driving', 12, 10); }
      if (simStatus === 'off') { ctx.fillStyle = 'rgba(231,76,60,0.95)'; ctx.fillText('Off track — resetting…', 12, 26); }
      ctx.restore();
    }

    /* ── NN architecture visualisation ──────────────────────── */
    function parseRGB(str) {
      if (!str) return [128, 128, 128];
      str = str.trim();
      if (str.charAt(0) === '#') {
        var h = str.slice(1);
        if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
        return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
      }
      var m = str.match(/(\d+(?:\.\d+)?)/g);
      if (m && m.length >= 3) return [+m[0], +m[1], +m[2]];
      return [128, 128, 128];
    }
    function mixRGB(a, b, t) {
      return [ Math.round(a[0]+(b[0]-a[0])*t), Math.round(a[1]+(b[1]-a[1])*t), Math.round(a[2]+(b[2]-a[2])*t) ];
    }
    function drawNetViz(canvas, nn, cache, isDark) {
      if (!canvas || !nn) return;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var W = canvas.parentElement ? canvas.parentElement.clientWidth : canvas.offsetWidth;
      if (!W) W = 640;

      var sizes  = nn.sizes;
      var nL     = sizes.length;
      var MAX_N  = 16;
      var PAD_X  = Math.max(48, W * 0.07);
      var PAD_TOP = 26, PAD_BOT = 34;

      // Derive the height from the tallest layer so every node fits. The old code
      // read canvas.clientHeight, which fought the CSS box (width:100%, no height)
      // and left the lower rows and labels clipped. Set an explicit style height,
      // matching how the other demo canvases size themselves.
      var maxShown = 1;
      for (var l = 0; l < nL; l++) maxShown = Math.max(maxShown, Math.min(sizes[l], MAX_N));
      var gap = 30;                                   // vertical spacing between nodes
      var R = Math.max(6, Math.min(gap * 0.36, 16));
      var H = Math.max(200, Math.round(PAD_TOP + PAD_BOT + (maxShown - 1) * gap));

      canvas.width  = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = '100%';
      canvas.style.height = H + 'px';
      var ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      var bgSoft = cssVar('--bg-soft');
      var muted  = cssVar('--text-muted');
      var mono   = cssVar('--mono');
      var actNeg  = parseRGB(cssVar('--nn-act-neg'));
      var actZero = parseRGB(cssVar('--nn-act-zero'));
      var actPos  = parseRGB(cssVar('--nn-act-pos'));
      var accRGB  = parseRGB(cssVar('--accent'));
      ctx.fillStyle = bgSoft; ctx.fillRect(0, 0, W, H);

      var innerW = W - PAD_X * 2;
      var colX   = [];
      for (var l = 0; l < nL; l++) {
        colX.push(nL > 1 ? Math.round(PAD_X + innerW * l / (nL - 1)) : Math.round(W / 2));
      }
      var INPUT_LABELS  = ['eᵧ', 'e_θ', 'ψ₁', 'ψ₂', 'ψ₃', 'ψ₄'];
      var OUTPUT_LABELS = ['δ'];

      function nodeY(l, i, n) {
        var shown = Math.min(n, MAX_N);
        var totalH = (shown - 1) * gap;
        return ((H - PAD_BOT + PAD_TOP) / 2 - totalH / 2) + i * gap;
      }
      function actAt(l, i) { return (cache && cache.a && cache.a[l]) ? cache.a[l][i] : 0; }
      function actColor(t) { return (t >= 0) ? mixRGB(actZero, actPos, t) : mixRGB(actZero, actNeg, -t); }

      for (var l = 0; l < nL - 1; l++) {
        var ni = sizes[l], no = sizes[l+1];
        var shownI = Math.min(ni, MAX_N), shownO = Math.min(no, MAX_N);
        for (var ii = 0; ii < shownI; ii++) {
          for (var oi = 0; oi < shownO; oi++) {
            var w = nn.W[l][oi * ni + ii];
            var mag = Math.min(Math.abs(w), 1.5) / 1.5;
            var alpha = 0.06 + mag * 0.5;
            var c = (w >= 0) ? accRGB : actNeg;
            ctx.strokeStyle = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + alpha.toFixed(3) + ')';
            ctx.lineWidth = 0.5 + mag * 2;
            ctx.beginPath();
            ctx.moveTo(colX[l] + R, nodeY(l, ii, ni));
            ctx.lineTo(colX[l+1] - R, nodeY(l+1, oi, no));
            ctx.stroke();
          }
        }
      }

      for (var l = 0; l < nL; l++) {
        var n = sizes[l];
        var shown = Math.min(n, MAX_N);
        for (var ii = 0; ii < shown; ii++) {
          var cy = nodeY(l, ii, n);
          var t = Math.tanh(actAt(l, ii));
          var rgb = actColor(t);
          var glow = Math.abs(t);
          ctx.save();
          if (glow > 0.05) {
            ctx.shadowColor = 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + (0.55 * glow).toFixed(3) + ')';
            ctx.shadowBlur = R * 1.4 * glow;
          }
          ctx.beginPath();
          ctx.arc(colX[l], cy, R, 0, Math.PI * 2);
          ctx.fillStyle = 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
          ctx.fill();
          ctx.restore();
          ctx.beginPath();
          ctx.arc(colX[l], cy, R, 0, Math.PI * 2);
          ctx.strokeStyle = muted; ctx.lineWidth = 1; ctx.stroke();
        }
        if (n > MAX_N) {
          ctx.fillStyle = muted; ctx.font = (R + 4) + 'px ' + mono; ctx.textAlign = 'center';
          ctx.fillText('⋯', colX[l], nodeY(l, shown - 1, n) + gap * 0.7);
        }
        var lbl = l === 0 ? 'input' : l === nL - 1 ? 'output' : 'hidden ' + l;
        ctx.fillStyle = muted; ctx.font = '600 12px ' + mono; ctx.textAlign = 'center';
        ctx.fillText(lbl + ' (' + n + ')', colX[l], H - 12);
        if (l === 0) {
          var shownL = Math.min(n, INPUT_LABELS.length);
          ctx.font = '11px ' + mono; ctx.textAlign = 'right'; ctx.fillStyle = muted;
          for (var k = 0; k < shownL; k++) {
            ctx.fillText(INPUT_LABELS[k], colX[l] - R - 6, nodeY(l, k, n) + 4);
          }
        } else if (l === nL - 1) {
          ctx.font = '11px ' + mono; ctx.textAlign = 'left'; ctx.fillStyle = muted;
          ctx.fillText(OUTPUT_LABELS[0], colX[l] + R + 6, nodeY(l, 0, n) + 4);
        }
      }
    }

    /* ── Render loop ─────────────────────────────────────────── */
    (function loop() {
      var isDark = darkMode();
      raceRender();
      drawContribPlot(nnStatePlot, [
        { label: 'eᵧ CTE (px)',  color: cssVar('--viz-1'), data: stateHist.ey  },
        { label: 'e_θ hdg (rad)', color: cssVar('--viz-2'), data: stateHist.eth }
      ], null, 'state');
      drawContribPlot(nnPidPlot, [
        { label: 'δ NN',     color: cssVar('--viz-1'), data: outHist.nn  },
        { label: 'δ expert', color: cssVar('--viz-2'), data: outHist.exp }
      ], 1.0, 'steer δ');
      drawNetViz(nnNetCanvas, net, lastNNCache, isDark);
      requestAnimationFrame(loop);
    })();
  })();

  /* ================================================================
     Demo 6 — Be the Controller (human step-response → PID fit)
     A target jumps between the corners of a box. The user chases it
     with the mouse / finger. We measure the reaction delay (dead time)
     and least-squares fit ẋ = Kp·e + Ki·∫e + Kd·ė to the recorded
     motion — i.e. identify the PID controller behind the user's hand.
  ================================================================ */
  (function reactDemo() {
    var canvas = document.getElementById('react-canvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var W = 720, H = 380;

    function resize() {
      W = canvas.parentElement.clientWidth;
      canvas.width  = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width  = W + 'px';
      canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    new ResizeObserver(resize).observe(canvas.parentElement);
    resize();

    var R_TARGET = 26, R_DWELL = 34;
    function corners() {
      var m = Math.max(48, Math.min(90, W * 0.16));
      return [
        { x: m,     y: 60      },
        { x: W - m, y: 60      },
        { x: W - m, y: H - 60  },
        { x: m,     y: H - 60  }
      ];
    }

    // ── Pointer tracking (mouse + touch via Pointer Events) ──────
    var ptr = { x: W / 2, y: H / 2, active: false };
    function setPtr(clientX, clientY) {
      var r = canvas.getBoundingClientRect();
      ptr.x = clientX - r.left;
      ptr.y = clientY - r.top;
      ptr.active = true;
    }
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointermove', function (e) { setPtr(e.clientX, e.clientY); });
    canvas.addEventListener('pointerdown', function (e) { setPtr(e.clientX, e.clientY); });

    // ── State machine ────────────────────────────────────────────
    var phase = 'idle';          // idle · wait_dwell · wait_jump · active · done
    var startIdx = 0, tgtIdx = 2;
    var dwellStart = null;
    var jumpAt = 0, t0 = 0;
    var samples = [];            // {t, x, y} recorded during the active phase
    var bestReaction = null;
    var lastFit = { user: [], pid: [], setp: [] };

    function el(id) { return document.getElementById(id); }
    var statusEl  = el('react-status');
    var startBtn  = el('react-start');
    var resetBtn  = el('react-reset');
    var resultsBox = el('react-results');
    var reactPlot = el('react-plot');

    function setStatus(t) { if (statusEl) statusEl.textContent = t; }
    function setTxt(id, t) { var e = el(id); if (e) e.textContent = t; }

    function randCornerExcept(i) {
      var c; do { c = Math.floor(Math.random() * 4); } while (c === i);
      return c;
    }

    function beginTrial() {
      startIdx = Math.floor(Math.random() * 4);
      tgtIdx   = startIdx;
      phase    = 'wait_dwell';
      dwellStart = null;
      samples  = [];
      if (resultsBox) resultsBox.style.display = 'none';
      setStatus('Move onto the glowing dot and hold still…');
    }
    if (startBtn) startBtn.addEventListener('click', beginTrial);
    if (resetBtn) resetBtn.addEventListener('click', function () {
      phase = 'idle'; samples = []; bestReaction = null;
      lastFit = { user: [], pid: [], setp: [] };
      if (resultsBox) resultsBox.style.display = 'none';
      setTxt('react-reaction', '—');
      setTxt('react-best', '');
      setStatus('Press “Start trial”, then chase the dot the instant it jumps.');
    });

    function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }

    function update(now) {
      var cs = corners();
      if (phase === 'wait_dwell') {
        var c = cs[startIdx];
        if (ptr.active && dist(ptr.x, ptr.y, c.x, c.y) < R_DWELL) {
          if (dwellStart === null) dwellStart = now;
          if (now - dwellStart > 400) {
            jumpAt = now + 700 + Math.random() * 1900;   // unpredictable delay
            phase  = 'wait_jump';
            setStatus('Hold steady… stay ready.');
          }
        } else {
          dwellStart = null;
        }
      } else if (phase === 'wait_jump') {
        if (now >= jumpAt) {
          tgtIdx  = randCornerExcept(startIdx);
          t0      = now;
          samples = [];
          dwellStart = null;
          phase   = 'active';
          setStatus('GO! Chase the dot.');
        }
      } else if (phase === 'active') {
        var B = cs[tgtIdx];
        samples.push({ t: (now - t0) / 1000, x: ptr.x, y: ptr.y });
        var onTgt = ptr.active && dist(ptr.x, ptr.y, B.x, B.y) < R_TARGET;
        if (onTgt) { if (dwellStart === null) dwellStart = now; }
        else dwellStart = null;
        var elapsed = (now - t0) / 1000;
        if ((dwellStart && now - dwellStart > 350) || elapsed > 4.5) {
          phase = 'done';
          analyze(cs[startIdx], cs[tgtIdx]);
        }
      }
    }

    // ── Linear solve for the 3×3 normal equations ────────────────
    function solve3(M, b) {
      var a = [M[0].slice(), M[1].slice(), M[2].slice()], y = b.slice();
      for (var i = 0; i < 3; i++) {
        var p = i;
        for (var r = i + 1; r < 3; r++) if (Math.abs(a[r][i]) > Math.abs(a[p][i])) p = r;
        if (p !== i) { var tt = a[p]; a[p] = a[i]; a[i] = tt; var ty = y[p]; y[p] = y[i]; y[i] = ty; }
        if (Math.abs(a[i][i]) < 1e-12) return null;
        for (var r2 = i + 1; r2 < 3; r2++) {
          var f = a[r2][i] / a[i][i];
          for (var cc = i; cc < 3; cc++) a[r2][cc] -= f * a[i][cc];
          y[r2] -= f * y[i];
        }
      }
      var x = [0, 0, 0];
      for (var k = 2; k >= 0; k--) {
        var s = y[k];
        for (var c2 = k + 1; c2 < 3; c2++) s -= a[k][c2] * x[c2];
        x[k] = s / a[k][k];
      }
      return x;
    }

    function interp(xs, ys, x) {
      if (x <= xs[0]) return ys[0];
      if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
      for (var i = 1; i < xs.length; i++) {
        if (x <= xs[i]) {
          var f = (x - xs[i - 1]) / ((xs[i] - xs[i - 1]) || 1);
          return ys[i - 1] + f * (ys[i] - ys[i - 1]);
        }
      }
      return ys[ys.length - 1];
    }

    // Simulate a PID velocity-controller with pure dead time L, sampled on `grid`.
    function simulatePID(Kp, Ki, Kd, L, grid) {
      var h = 0.008, d = 0, integ = 0, prevE = 1, t = 0, out = [], gi = 0;
      var Tend = grid[grid.length - 1];
      while (gi < grid.length) {
        while (gi < grid.length && grid[gi] <= t) { out.push(d); gi++; }
        if (t > Tend) break;
        var e = 1 - d;
        var v = 0;
        if (t >= L) {
          integ += e * h;
          var de = (e - prevE) / h;
          v = Kp * e + Ki * integ + Kd * de;
          prevE = e;
        }
        d += v * h;
        if (d > 3) d = 3; if (d < -2) d = -2;
        t += h;
      }
      while (out.length < grid.length) out.push(d);
      return out;
    }

    function characterRead(overshoot, finalE, L) {
      var parts = ['Your hand added ' + Math.round(L * 1000) + ' ms of dead time before reacting.'];
      if (overshoot > 12)      parts.push('You overshot by ' + overshoot.toFixed(0) + '% — proportional-heavy and underdamped; more Kd would settle it faster.');
      else if (overshoot > 3)  parts.push('Slight overshoot (' + overshoot.toFixed(0) + '%) — close to critically damped.');
      else                     parts.push('Almost no overshoot — nicely damped.');
      if (Math.abs(finalE) > 0.06) parts.push('You settled short of the mark, like a controller with too little integral action.');
      return parts.join(' ');
    }

    function showFail() {
      phase = 'idle';
      setStatus('Not enough motion to fit — press “Start trial” and chase the dot a bit more.');
    }

    function analyze(A, B) {
      var ux = B.x - A.x, uy = B.y - A.y;
      var D = Math.hypot(ux, uy) || 1;
      ux /= D; uy /= D;
      var S = samples;
      if (S.length < 6) { showFail(); return; }

      var d = [], tt = [];
      for (var i = 0; i < S.length; i++) {
        d.push(((S[i].x - A.x) * ux + (S[i].y - A.y) * uy) / D);   // normalized progress 0→1
        tt.push(S[i].t);
      }

      // Reaction delay: first sample that has moved appreciably from the start.
      var d0 = d[0], Lidx = -1;
      for (var j = 1; j < d.length; j++) {
        if (Math.abs(d[j] - d0) > 0.06) { Lidx = j; break; }
      }
      if (Lidx < 0) Lidx = 1;
      var L = tt[Lidx];

      // Build regression rows (post-reaction) for ẋ = Kp·e + Ki·∫e + Kd·ė.
      var integ = 0, rows = [];
      for (var m = 1; m < d.length; m++) {
        var dtt = tt[m] - tt[m - 1];
        if (dtt <= 0) continue;
        var e = 1 - d[m];
        integ += e * dtt;
        var de = (e - (1 - d[m - 1])) / dtt;
        var v  = (d[m] - d[m - 1]) / dtt;
        if (tt[m] >= L) rows.push([e, integ, de, v]);
      }
      if (rows.length < 4) { showFail(); return; }

      var XtX = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], Xty = [0, 0, 0];
      rows.forEach(function (r) {
        var phi = [r[0], r[1], r[2]];
        for (var a1 = 0; a1 < 3; a1++) {
          for (var b1 = 0; b1 < 3; b1++) XtX[a1][b1] += phi[a1] * phi[b1];
          Xty[a1] += phi[a1] * r[3];
        }
      });
      var tr = XtX[0][0] + XtX[1][1] + XtX[2][2];
      var lam = 1e-4 * (tr / 3 || 1);            // ridge term for numerical stability
      XtX[0][0] += lam; XtX[1][1] += lam; XtX[2][2] += lam;
      var k = solve3(XtX, Xty) || [0, 0, 0];
      var Kp = k[0], Ki = k[1], Kd = k[2];

      // R² of the velocity fit.
      var meanV = 0; rows.forEach(function (r) { meanV += r[3]; }); meanV /= rows.length;
      var ssr = 0, sst = 0;
      rows.forEach(function (r) {
        var pred = Kp * r[0] + Ki * r[1] + Kd * r[2];
        ssr += (r[3] - pred) * (r[3] - pred);
        sst += (r[3] - meanV) * (r[3] - meanV);
      });
      var r2 = sst > 1e-9 ? Math.max(0, 1 - ssr / sst) : 0;

      var maxD = Math.max.apply(null, d);
      var overshoot = Math.max(0, maxD - 1) * 100;
      var finalE = 1 - d[d.length - 1];

      // Overlay data: user path, fitted-PID replay, and the unit setpoint.
      var Tend = tt[tt.length - 1], N = 140, grid = [];
      for (var g = 0; g < N; g++) grid.push(Tend * g / (N - 1));
      lastFit = {
        user: grid.map(function (gt) { return interp(tt, d, gt); }),
        pid:  simulatePID(Kp, Ki, Kd, L, grid),
        setp: grid.map(function () { return 1; })
      };

      // Fill the panel.
      setTxt('react-reaction', Math.round(L * 1000));
      if (bestReaction === null || L < bestReaction) {
        bestReaction = L;
        setTxt('react-best', 'Best: ' + Math.round(L * 1000) + ' ms');
      }
      setTxt('react-kp', Kp.toFixed(2));
      setTxt('react-ki', Ki.toFixed(2));
      setTxt('react-kd', Kd.toFixed(2));
      setTxt('react-L',  Math.round(L * 1000) + ' ms');
      setTxt('react-os', overshoot.toFixed(0) + ' %');
      setTxt('react-r2', r2.toFixed(2));
      setTxt('react-read', characterRead(overshoot, finalE, L));
      if (resultsBox) resultsBox.style.display = 'flex';
      setStatus('Nice — press “Start trial” to go again.');
    }

    // ── Rendering ────────────────────────────────────────────────
    function draw() {
      var cs = corners();
      ctx.clearRect(0, 0, W, H);

      var muted  = cssVar('--text-muted');
      var accent = cssVar('--accent');
      var border = cssVar('--border');
      var text   = cssVar('--text');

      // Box outline + corner markers
      ctx.strokeStyle = border;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(cs[0].x, cs[0].y, cs[1].x - cs[0].x, cs[3].y - cs[0].y);
      cs.forEach(function (c) {
        ctx.beginPath(); ctx.arc(c.x, c.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = muted; ctx.fill();
      });

      // User's recorded trail
      if (samples.length > 1) {
        ctx.strokeStyle = accent;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (var i = 0; i < samples.length; i++) {
          if (i === 0) ctx.moveTo(samples[i].x, samples[i].y);
          else ctx.lineTo(samples[i].x, samples[i].y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Active target dot (pulsing)
      var tgt = (phase === 'wait_dwell' || phase === 'wait_jump') ? cs[startIdx]
              : (phase === 'active' || phase === 'done') ? cs[tgtIdx] : null;
      if (tgt) {
        var pulse = 0.5 + 0.5 * Math.sin(Date.now() / 180);
        ctx.fillStyle = accent;
        ctx.globalAlpha = 0.25;
        ctx.beginPath(); ctx.arc(tgt.x, tgt.y, R_TARGET, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(tgt.x, tgt.y, 8 + 3 * pulse, 0, Math.PI * 2); ctx.fill();
      }

      // User pointer marker
      if (ptr.active) {
        ctx.strokeStyle = text; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(ptr.x, ptr.y, 8, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = text;
        ctx.beginPath(); ctx.arc(ptr.x, ptr.y, 2.5, 0, Math.PI * 2); ctx.fill();
      }

      // Centre prompt for idle state
      if (phase === 'idle') {
        ctx.fillStyle = muted;
        ctx.font = '14px ' + cssVar('--font');
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('Press “Start trial”, then chase the dot when it jumps.', W / 2, H / 2);
      }
    }

    function loop(now) {
      var sec = document.getElementById('sec-react');
      if (sec && sec.classList.contains('active')) {
        update(now);
        draw();
        drawContribPlot(reactPlot, [
          { label: 'setpoint',   color: cssVar('--viz-total'), data: lastFit.setp },
          { label: 'you',        color: cssVar('--viz-1'),     data: lastFit.user },
          { label: 'fitted PID', color: cssVar('--viz-2'),     data: lastFit.pid  }
        ], null, 'position');
      }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  })();

})();
