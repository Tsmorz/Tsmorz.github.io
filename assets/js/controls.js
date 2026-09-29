// Controls page — three interactive demos.
// Tab switcher, mass-spring-damper PID, nonlinear flight sim, system ID + LQR.
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
     Demo 1.5 — Tilt Table 2-D: PID beam balancing + stabilisation heatmap
     Ball starts in the inner half of the beam with a small random velocity;
     table starts flat. Each trial runs until stable or failed. Results
     accumulate in a (initial distance, initial speed) heatmap.
  ================================================================ */
  (function tiltTableDemo() {
    var canvas = document.getElementById('tilt-canvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');

    var g    = 9.81;
    var ROLL = 1.0;           // full gravitational acceleration (no rolling inertia reduction)
    var DAMP = 0.28;
    var T    = 1.0;           // beam half-length (m)
    var TILT_LIM = 20 * Math.PI / 180;

    // Heatmap grid
    var HM_COLS = 8;
    var HM_ROWS = 8;
    var HM_MAX_D = T / 2;     // 0.25 m — inner half
    var HM_MAX_V = 0.50;      // m/s
    var TRIAL_TIMEOUT = 8;    // sim seconds

    var STABLE_X = 0.008;     // m — 8 mm; must be smaller than any heatmap cell start
    var STABLE_V = 0.04;      // m/s
    var STABLE_T = 0.5;       // s sustained

    // hmData[row][col] = array of settle times; Infinity = failed
    var hmData = (function makeGrid() {
      var g2 = [];
      for (var r = 0; r < HM_ROWS; r++) {
        var row = [];
        for (var c = 0; c < HM_COLS; c++) row.push([]);
        g2.push(row);
      }
      return g2;
    }());
    var trialCount = 0;

    var bx = 0, vx = 0, tiltX = 0;
    var trialTime = 0, stableCountdown = 0;
    var trialInitDist = 0, trialInitSpeed = 0;
    var pidState = { intE: 0, prevE: 0 };
    var pidGains = { kp: 0, ki: 0, kd: 0 };
    var delayBuf = [];
    var errRing = [], bestRMSE = null;
    var RING = 400;

    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var W = 700, H = 300;

    function resizeCanvas() {
      W = canvas.parentElement.clientWidth || 700;
      H = Math.max(180, Math.min(300, Math.round(W * 0.42)));
      canvas.width  = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width  = W + 'px';
      canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    new ResizeObserver(resizeCanvas).observe(canvas.parentElement);
    resizeCanvas();

    function gaussian() {
      var u = 0, v = 0;
      while (u === 0) u = Math.random();
      while (v === 0) v = Math.random();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }

    // Pick the grid cell with the fewest completed trials so the heatmap fills evenly.
    function newTrial() {
      var minN = Infinity;
      for (var r = 0; r < HM_ROWS; r++)
        for (var c = 0; c < HM_COLS; c++)
          if (hmData[r][c].length < minN) minN = hmData[r][c].length;
      var pool = [];
      for (var r = 0; r < HM_ROWS; r++)
        for (var c = 0; c < HM_COLS; c++)
          if (hmData[r][c].length <= minN + 1) pool.push([r, c]);
      var cell = pool[Math.floor(Math.random() * pool.length)];
      var cr = cell[0], cc = cell[1];

      // Guarantee start outside stable zone; each cell spans [0, HM_MAX_D/HM_COLS] per step
      trialInitDist  = Math.max(STABLE_X * 2.5, (cc + Math.random()) / HM_COLS * HM_MAX_D);
      trialInitSpeed = Math.max(STABLE_V * 0.5,  (cr + Math.random()) / HM_ROWS * HM_MAX_V);
      var sx = Math.random() < 0.5 ? 1 : -1;
      bx = sx * trialInitDist;
      // Velocity always outward (toward edge) — inward would passively cross
      // the stable zone under damping alone, registering false successes.
      vx = sx * trialInitSpeed;
      tiltX = 0;
      pidState.intE = 0; pidState.prevE = 0;
      delayBuf = [];
      trialTime = 0; stableCountdown = 0;
    }

    function recordResult(settleTime) {
      var dc = clamp(Math.floor(trialInitDist / HM_MAX_D * HM_COLS), 0, HM_COLS - 1);
      var rc = clamp(Math.floor(trialInitSpeed / HM_MAX_V * HM_ROWS), 0, HM_ROWS - 1);
      hmData[rc][dc].push(settleTime);
      trialCount++;
      newTrial();
    }

    var kpSlider = document.getElementById('tilt-kp');
    var kiSlider = document.getElementById('tilt-ki');
    var kdSlider = document.getElementById('tilt-kd');
    var kpValEl  = document.getElementById('tilt-kp-val');
    var kiValEl  = document.getElementById('tilt-ki-val');
    var kdValEl  = document.getElementById('tilt-kd-val');
    var delaySlider = document.getElementById('tilt-delay');
    var delayValEl  = document.getElementById('tilt-delay-val');
    var delayAmt    = document.getElementById('tilt-delay-amt');
    var noiseSlider = document.getElementById('tilt-noise');
    var noiseValEl  = document.getElementById('tilt-noise-val');

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
      slider.min = -r; slider.max = r; slider.step = r / 100;
      slider.value = clamp(prev, -r, r);
    }
    var kpRange = document.getElementById('tilt-kp-range');
    var kiRange = document.getElementById('tilt-ki-range');
    var kdRange = document.getElementById('tilt-kd-range');
    [[kpSlider, kpRange], [kiSlider, kiRange], [kdSlider, kdRange]].forEach(function (pair) {
      var sl = pair[0], ri = pair[1];
      if (ri && sl) ri.addEventListener('input', function () { applyRange(sl, ri); syncPID(); });
    });
    [kpSlider, kiSlider, kdSlider].forEach(function (s) { if (s) s.addEventListener('input', syncPID); });
    syncPID();

    if (delaySlider) delaySlider.addEventListener('input', function () {
      var v = parseFloat(delaySlider.value);
      if (delayValEl) delayValEl.textContent = v + ' ms';
      if (delayAmt)   delayAmt.value = v;
    });
    if (delayAmt) delayAmt.addEventListener('change', function () {
      var v = clamp(parseFloat(delayAmt.value) || 0, 0, 1000);
      if (delaySlider) delaySlider.value = v;
      if (delayValEl)  delayValEl.textContent = v + ' ms';
    });
    if (noiseSlider) noiseSlider.addEventListener('input', function () {
      if (noiseValEl) noiseValEl.textContent = parseFloat(noiseSlider.value).toFixed(2);
    });

    function getDelay() { return delaySlider ? parseFloat(delaySlider.value) / 1000 : 0; }
    function getNoise() { return noiseSlider ? parseFloat(noiseSlider.value) : 0; }

    var DT_INNER = 0.004;

    function simStep(dt) {
      var noise = getNoise(), delay = getDelay();
      var SUBS = Math.max(1, Math.round(dt / DT_INNER));
      var sdt  = dt / SUBS;

      for (var i = 0; i < SUBS; i++) {
        var bxM = bx + (noise > 0 ? noise * gaussian() : 0);
        var err = -bxM;    // reference = 0
        pidState.intE = clamp(pidState.intE + err * sdt, -2, 2);
        var de = sdt > 0 ? (err - pidState.prevE) / sdt : 0;
        pidState.prevE = err;
        var cmd = pidGains.kp * err + pidGains.ki * pidState.intE + pidGains.kd * de;

        var tNow = trialTime + i * sdt;
        delayBuf.push({ t: tNow, v: cmd });
        while (delayBuf.length > 1 && delayBuf[0].t < tNow - delay) delayBuf.shift();
        tiltX = clamp(delayBuf[0].v, -TILT_LIM, TILT_LIM);

        // Rolling ball on tilted beam: positive tiltX → right side down → ax > 0
        var ax = ROLL * g * Math.sin(tiltX) - DAMP * vx;
        vx += ax * sdt;
        bx += vx * sdt;
      }

      trialTime += dt;
      errRing.push(bx * bx);
      if (errRing.length > RING) errRing.shift();

      if (Math.abs(bx) < STABLE_X && Math.abs(vx) < STABLE_V) {
        stableCountdown += dt;
        if (stableCountdown >= STABLE_T) { recordResult(trialTime - STABLE_T); return; }
      } else {
        stableCountdown = 0;
      }

      if (Math.abs(bx) >= T || trialTime >= TRIAL_TIMEOUT) {
        recordResult(Infinity);
      }
    }

    function render() {
      if (!W) return;
      var dark = document.documentElement.getAttribute('data-theme') === 'dark' ||
        (!document.documentElement.getAttribute('data-theme') &&
         window.matchMedia('(prefers-color-scheme: dark)').matches);

      ctx.fillStyle = dark ? '#0a1020' : '#f2f4f8';
      ctx.fillRect(0, 0, W, H);

      var accent  = cssVar('--accent');
      var muted   = cssVar('--text-muted');
      var border  = cssVar('--border');

      var cx = W / 2, cy = H * 0.52;
      var scale       = W * 0.72 / (2 * T);
      var beamHalfPx  = T * scale;
      var beamThick   = 12;
      var ballR = Math.max(8, Math.min(13, W * 0.017));

      // Vertical centre reference (dashed)
      ctx.save();
      ctx.strokeStyle = accent;
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.moveTo(cx, cy - beamHalfPx * 0.65);
      ctx.lineTo(cx, cy + beamHalfPx * 0.65);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.restore();

      // Pivot fulcrum
      ctx.save();
      ctx.translate(cx, cy + beamThick / 2 + 1);
      ctx.fillStyle = dark ? '#4a7a9a' : '#3a6a9a';
      var fh = 18;
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(-fh * 0.65, fh); ctx.lineTo(fh * 0.65, fh);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = dark ? '#2a3a4a' : '#b8c8d8';
      ctx.fillRect(-fh * 0.9, fh, fh * 1.8, 4);
      ctx.restore();

      // Rotated beam + ball
      ctx.save();
      ctx.translate(cx, cy);
      // positive tiltX → right side down (CW in canvas y-down coords)
      ctx.rotate(tiltX);

      // Beam body
      ctx.fillStyle   = dark ? '#162030' : '#c8d8e8';
      ctx.strokeStyle = dark ? '#4a8aaa' : '#3a6a9a';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(-beamHalfPx, -beamThick / 2, beamHalfPx * 2, beamThick, 3);
      ctx.fill(); ctx.stroke();

      // Edge stop markers
      ctx.lineWidth = 2.5;
      [-beamHalfPx, beamHalfPx].forEach(function (ex) {
        ctx.strokeStyle = dark ? 'rgba(255,90,90,0.55)' : 'rgba(200,50,50,0.60)';
        ctx.beginPath();
        ctx.moveTo(ex, -beamThick / 2 - 7); ctx.lineTo(ex, beamThick / 2 + 7);
        ctx.stroke();
      });

      // Ball
      var bxPx  = bx * scale;
      var ballCy = -beamThick / 2 - ballR;
      ctx.beginPath();
      ctx.ellipse(bxPx, -beamThick / 2, ballR * 0.85, 3.5, 0, 0, 2 * Math.PI);
      ctx.fillStyle = 'rgba(0,0,0,0.20)'; ctx.fill();
      var grd = ctx.createRadialGradient(
        bxPx - ballR * 0.3, ballCy - ballR * 0.3, ballR * 0.06,
        bxPx, ballCy, ballR);
      grd.addColorStop(0, dark ? '#b8dcff' : '#94c8ff');
      grd.addColorStop(1, dark ? '#1838a8' : '#0e2e8a');
      ctx.fillStyle = grd;
      ctx.strokeStyle = dark ? 'rgba(120,180,255,0.45)' : 'rgba(20,60,160,0.40)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(bxPx, ballCy, ballR, 0, 2 * Math.PI);
      ctx.fill(); ctx.stroke();

      ctx.restore();

      // HUD overlay (top-left)
      ctx.fillStyle   = dark ? 'rgba(10,18,32,0.74)' : 'rgba(242,244,248,0.86)';
      ctx.strokeStyle = border;
      ctx.lineWidth   = 1;
      ctx.beginPath(); ctx.roundRect(10, 10, 168, 62, 6); ctx.fill(); ctx.stroke();
      ctx.fillStyle    = muted;
      ctx.font         = '11px ' + cssVar('--mono');
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('θ  = ' + (tiltX * 180 / Math.PI).toFixed(1) + '°', 18, 16);
      ctx.fillText('x  = ' + (bx * 100).toFixed(1) + ' cm', 18, 30);
      ctx.fillText('t  = ' + trialTime.toFixed(1) + ' s  [#' + (trialCount + 1) + ']', 18, 44);

      // Stable progress bar
      if (stableCountdown > 0) {
        var frac2 = Math.min(1, stableCountdown / STABLE_T);
        ctx.fillStyle   = 'rgba(0,200,100,0.18)';
        ctx.beginPath(); ctx.roundRect(10, 76, 168 * frac2, 8, 3); ctx.fill();
        ctx.strokeStyle = dark ? '#00cc64' : '#008040';
        ctx.lineWidth   = 1;
        ctx.beginPath(); ctx.roundRect(10, 76, 168, 8, 3); ctx.stroke();
      }
    }

    function drawHeatmap() {
      var hc = document.getElementById('tilt-heatmap');
      if (!hc) return;
      var dpr2 = Math.min(window.devicePixelRatio || 1, 2);
      var HW = (hc.parentElement ? hc.parentElement.clientWidth : 0) || 600;
      var HH = hc.clientHeight || 200;
      if (!HW) return;
      hc.width  = Math.round(HW * dpr2);
      hc.height = Math.round(HH * dpr2);
      var hx = hc.getContext('2d');
      hx.setTransform(dpr2, 0, 0, dpr2, 0, 0);

      var isDark = document.documentElement.getAttribute('data-theme') === 'dark' ||
        (!document.documentElement.getAttribute('data-theme') &&
         window.matchMedia('(prefers-color-scheme: dark)').matches);

      hx.fillStyle = cssVar('--bg');
      hx.fillRect(0, 0, HW, HH);

      var mono  = cssVar('--mono');
      var muted = cssVar('--text-muted');
      var bdr   = cssVar('--border');

      var PAD_L = 50, PAD_B = 34, PAD_T = 26, PAD_R = 88;
      var gw = HW - PAD_L - PAD_R;
      var gh = HH - PAD_T - PAD_B;
      var cellW = gw / HM_COLS;
      var cellH = gh / HM_ROWS;

      // Colour: empty=grey, 0–timeout=green→red, failed=dark red
      function cellColor(t) {
        if (t === undefined) return isDark ? 'hsl(220,18%,16%)' : 'hsl(220,18%,88%)';
        if (!isFinite(t))    return isDark ? 'hsl(0,80%,22%)'   : 'hsl(0,72%,60%)';
        var frac = Math.min(1, t / TRIAL_TIMEOUT);
        var hue  = Math.round(120 * (1 - frac));
        return 'hsl(' + hue + ',72%,' + (isDark ? 40 : 46) + '%)';
      }

      for (var row = 0; row < HM_ROWS; row++) {
        for (var col = 0; col < HM_COLS; col++) {
          var times = hmData[row][col];
          var cx2   = PAD_L + col * cellW;
          var cy2   = PAD_T + (HM_ROWS - 1 - row) * cellH;

          var med;
          if (times.length === 0) {
            med = undefined;
          } else {
            var sorted = times.slice().sort(function (a, b) {
              return (isFinite(a) ? a : 999) - (isFinite(b) ? b : 999);
            });
            med = sorted[Math.floor(sorted.length / 2)];
          }

          hx.fillStyle = cellColor(med);
          hx.fillRect(cx2 + 1, cy2 + 1, cellW - 2, cellH - 2);

          if (times.length > 0) {
            hx.fillStyle    = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)';
            hx.font         = '8px ' + mono;
            hx.textAlign    = 'center';
            hx.textBaseline = 'middle';
            hx.fillText(times.length, cx2 + cellW / 2, cy2 + cellH / 2);
          }
        }
      }

      // Grid
      hx.strokeStyle = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
      hx.lineWidth = 0.5;
      for (var c = 0; c <= HM_COLS; c++) {
        var gx3 = PAD_L + c * cellW;
        hx.beginPath(); hx.moveTo(gx3, PAD_T); hx.lineTo(gx3, PAD_T + gh); hx.stroke();
      }
      for (var r = 0; r <= HM_ROWS; r++) {
        var gy3 = PAD_T + r * cellH;
        hx.beginPath(); hx.moveTo(PAD_L, gy3); hx.lineTo(PAD_L + gw, gy3); hx.stroke();
      }

      // X-axis (initial distance)
      hx.fillStyle    = muted;
      hx.font         = '10px ' + mono;
      hx.textAlign    = 'center';
      hx.textBaseline = 'top';
      for (var c = 0; c <= HM_COLS; c++)
        hx.fillText((c / HM_COLS * HM_MAX_D * 100).toFixed(0), PAD_L + c * cellW, PAD_T + gh + 4);
      hx.fillText('initial |x₀| (cm)', PAD_L + gw / 2, PAD_T + gh + 18);

      // Y-axis (initial speed)
      hx.textAlign    = 'right';
      hx.textBaseline = 'middle';
      for (var r = 0; r <= HM_ROWS; r++)
        hx.fillText((r / HM_ROWS * HM_MAX_V * 100).toFixed(0), PAD_L - 5, PAD_T + (HM_ROWS - r) * cellH);
      hx.save();
      hx.translate(13, PAD_T + gh / 2);
      hx.rotate(-Math.PI / 2);
      hx.textAlign = 'center'; hx.textBaseline = 'middle';
      hx.font = '10px ' + mono; hx.fillStyle = muted;
      hx.fillText('initial |ẋ₀| (cm/s)', 0, 0);
      hx.restore();

      // Colour legend
      var legX = PAD_L + gw + 10, legY = PAD_T, legH2 = gh, legW = 13;
      for (var ly = 0; ly < legH2; ly++) {
        hx.fillStyle = cellColor((1 - ly / legH2) * TRIAL_TIMEOUT);
        hx.fillRect(legX, legY + ly, legW, 1.5);
      }
      hx.strokeStyle = bdr; hx.lineWidth = 1;
      hx.strokeRect(legX, legY, legW, legH2);

      hx.fillStyle = muted; hx.font = '9px ' + mono; hx.textAlign = 'left';
      [0, 2, 4, 6, 8].forEach(function (tv) {
        var ly2 = legY + (1 - tv / TRIAL_TIMEOUT) * legH2;
        hx.beginPath(); hx.moveTo(legX + legW, ly2); hx.lineTo(legX + legW + 3, ly2);
        hx.strokeStyle = muted; hx.lineWidth = 0.8; hx.stroke();
        hx.textBaseline = 'middle';
        hx.fillText(tv + 's', legX + legW + 5, ly2);
      });

      // Failed swatch above legend
      var failY = legY - 16;
      hx.fillStyle = cellColor(Infinity);
      hx.fillRect(legX, failY, legW, 12);
      hx.strokeStyle = bdr; hx.lineWidth = 0.8;
      hx.strokeRect(legX, failY, legW, 12);
      hx.fillStyle = muted; hx.textBaseline = 'middle';
      hx.fillText('fail', legX + legW + 5, failY + 6);

      // Title
      hx.fillStyle    = cssVar('--text');
      hx.font         = '11px ' + mono;
      hx.textAlign    = 'center';
      hx.textBaseline = 'bottom';
      hx.fillText('Stabilisation heatmap  (' + trialCount + ' trials)', PAD_L + gw / 2, PAD_T - 4);
    }

    var resetBtn = document.getElementById('tilt-reset');
    if (resetBtn) resetBtn.addEventListener('click', function () {
      hmData = (function makeGrid() {
        var g2 = [];
        for (var r = 0; r < HM_ROWS; r++) {
          var row = [];
          for (var c = 0; c < HM_COLS; c++) row.push([]);
          g2.push(row);
        }
        return g2;
      }());
      trialCount = 0;
      errRing = []; bestRMSE = null;
      var bestEl = document.getElementById('tilt-best');
      if (bestEl) bestEl.textContent = '';
      newTrial();
    });

    var lastNow = null;

    function loop(now) {
      var sec = document.getElementById('sec-tilt');
      if (!sec || !sec.classList.contains('active')) { lastNow = now; requestAnimationFrame(loop); return; }
      if (lastNow === null) { lastNow = now; requestAnimationFrame(loop); return; }

      var dt = Math.min((now - lastNow) / 1000, 0.05);
      lastNow = now;

      simStep(dt);

      if (errRing.length > 0) {
        var rmse = Math.sqrt(errRing.reduce(function (a, b) { return a + b; }, 0) / errRing.length);
        var scoreEl = document.getElementById('tilt-score');
        if (scoreEl) scoreEl.textContent = rmse.toFixed(3);
        if (bestRMSE === null || rmse < bestRMSE) {
          bestRMSE = rmse;
          var bestEl2 = document.getElementById('tilt-best');
          if (bestEl2) bestEl2.textContent = 'Best: ' + rmse.toFixed(3);
        }
      }

      render();
      drawHeatmap();
      requestAnimationFrame(loop);
    }

    newTrial();
    requestAnimationFrame(loop);
  })();

  /* ================================================================
     Shared flight physics engine (used by Demo 2 and Demo 3)
  ================================================================ */

  // Cessna sprite — loaded once, white background stripped via pixel manipulation
  var cessna = (function () {
    var raw = new Image();
    var processed = null;
    raw.onload = function () {
      var oc = document.createElement('canvas');
      oc.width = raw.naturalWidth;
      oc.height = raw.naturalHeight;
      var oc2d = oc.getContext('2d');
      oc2d.drawImage(raw, 0, 0);
      var id = oc2d.getImageData(0, 0, oc.width, oc.height);
      var d = id.data;
      for (var i = 0; i < d.length; i += 4) {
        // Make near-white pixels fully transparent
        if (d[i] > 220 && d[i+1] > 220 && d[i+2] > 220) d[i+3] = 0;
      }
      oc2d.putImageData(id, 0, 0);
      processed = oc;
    };
    raw.src = '/assets/img/cessna.png';
    return { get: function () { return processed; } };
  }());

  // Aircraft constants
  var AC = {
    m: 1000, Iyy: 1800, S: 16, cbar: 1.5, rho: 1.225, g: 9.81,
    CL0: 0.40, CLa: 4.80, CLde: 0.36,
    CD0: 0.027, k: 0.045,
    Cm0: 0.04, Cma: -0.70, Cmq: -3.0, Cmde: -1.2
  };

  function aero(V, alpha, q, de) {
    var qbar    = 0.5 * AC.rho * V * V;
    var a_stall = deg2rad(16);
    // Sigmoid stall factor: ~1 pre-stall → ~0 post-stall (smooth nonlinear rolloff)
    var sigma   = 1 / (1 + Math.exp(30 * (Math.abs(alpha) - a_stall) / Math.PI));
    var CL_lin  = AC.CL0 + AC.CLa * alpha + AC.CLde * de;
    // Post-stall lift asymptotes to 55% of peak CL, same sign as alpha
    var CL_peak = AC.CL0 + AC.CLa * a_stall;
    var CL_post = 0.55 * CL_peak * (alpha < 0 ? -1 : 1) + AC.CLde * de;
    var CL      = sigma * CL_lin + (1 - sigma) * CL_post;
    // Extra induced drag post-stall
    var CD      = AC.CD0 + AC.k * CL * CL + 0.15 * (1 - sigma);
    var Cm      = AC.Cm0 + AC.Cma * alpha
                + AC.Cmq * q * AC.cbar / (2 * Math.max(V, 1))
                + AC.Cmde * de;
    return {
      L:  qbar * AC.S * CL,
      D:  qbar * AC.S * CD,
      My: qbar * AC.S * AC.cbar * Cm
    };
  }

  // Trim: find (alpha0, de0) such that L=W and Cm=0; also compute T_trim=D_trim
  function computeTrim() {
    var W  = AC.m * AC.g;
    var V0 = 65;
    // At trim: gamma=0, q=0
    // From Cm=0: de = -(Cm0+Cma*alpha)/Cmde
    // Substitute into L=W and solve for alpha
    var qbar = 0.5 * AC.rho * V0 * V0;
    var CLreq  = W / (qbar * AC.S);
    var aCoef  = AC.CLa - AC.CLde * AC.Cma / AC.Cmde;
    var rhs    = CLreq - AC.CL0 + AC.CLde * AC.Cm0 / AC.Cmde;
    var alpha0 = rhs / aCoef;
    var de0    = -(AC.Cm0 + AC.Cma * alpha0) / AC.Cmde;
    // Thrust at trim: T*cos(alpha0) = D → T = D/cos(alpha0)
    var CL0t = AC.CL0 + AC.CLa * alpha0 + AC.CLde * de0;
    var CD0t = AC.CD0 + AC.k * CL0t * CL0t;
    var D0   = qbar * AC.S * CD0t;
    var T0   = D0 / Math.cos(alpha0);
    return { V: V0, gamma: 0, alpha: alpha0, q: 0, de: de0, h: 300, x: 0, T: T0 };
  }

  var TRIM = computeTrim();
  AC.T = TRIM.T;  // constant thrust throughout

  // State vector indices: [V, gamma, alpha, q, h, x]
  function flightDerivatives(t, s, de_rad) {
    var V     = Math.max(s[0], 10);
    var gamma = s[1];
    var alpha = s[2];
    var q     = s[3];
    // h, x not needed in derivatives except for ḣ and ẋ
    var f = aero(V, alpha, q, de_rad);
    var T = AC.T;   // constant thrust (set to D_trim at startup)

    var Vdot     = (T * Math.cos(alpha) - f.D) / AC.m - AC.g * Math.sin(gamma);
    var gammaDot = (T * Math.sin(alpha) + f.L - AC.m * AC.g * Math.cos(gamma)) / (AC.m * V);
    var alphaDot = q - gammaDot;
    var qdot     = f.My / AC.Iyy;
    var hdot     = V * Math.sin(gamma);
    var xdot     = V * Math.cos(gamma);

    return [Vdot, gammaDot, alphaDot, qdot, hdot, xdot];
  }

  var FLIGHT_DT = 0.005;  // 200 Hz
  var FLIGHT_MAX_ALT = 590;   // world ceiling — triggers too_high stop

  // Shared stop-condition checker used by all flight demos
  function checkStopConditions(s) {
    if (s[4] <= 0)                    { s[4] = 0; return 'crashed'; }
    if (s[4] >= FLIGHT_MAX_ALT)       { return 'too_high'; }
    if (s[0] < 25)                    { return 'stalled'; }   // below stall speed
    if (s[2] > deg2rad(18))           { return 'stalled'; }   // high-alpha stall
    if (Math.abs(s[1]) > deg2rad(80)) { return 'over_top'; }  // inverted / over the top
    return null;
  }

  /* ================================================================
     Shared canvas renderer for flight demos
     Fixed 600 m world: ground at h=0 (bottom), ceiling at h=600 (top).
     Viewport never scrolls — trees and clouds are always visible.
  ================================================================ */

  var WORLD_HI = 600;   // m — top of visible world (sky ceiling)
  var WORLD_LO = 0;     // m — ground

  // Shared reference trajectory constants (used by all flight demos + renderer)
  var H_CENTER  = 300;   // m — reference altitude centre
  var REF_AMP   = 25;    // m — sine amplitude → 50 m peak-to-peak height delta
  var REF_OMEGA = 2 * Math.PI / 16;  // rad/s — period = 16 s
  // Seconds of reference shown across the full canvas width (determines how many cycles appear)
  var REF_DISPLAY_SPAN = 24;   // ≈ 3 cycles of the 8 s wave stay legible

  function makeFlightRenderer(canvas) {
    var ctx = canvas.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);

    function resize() {
      var w = canvas.parentElement.clientWidth || parseInt(canvas.getAttribute('width'), 10) || 720;
      canvas.width  = Math.round(w * dpr);
      canvas.height = Math.round(380 * dpr);
      canvas.style.width  = w + 'px';
      canvas.style.height = '380px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    new ResizeObserver(resize).observe(canvas.parentElement);
    resize();

    // Bottom 36 px are always the ground strip; the viewport shows VIEW_RANGE metres
    // centred on the plane's current altitude — the world zooms in rather than scrolling.
    var GROUND_PX = 36;
    var VIEW_RANGE = 200;  // metres of altitude shown (was full 600 m)

    // hToY maps world altitude to canvas y for the current viewport [viewLo, viewHi].
    // Defined as a var so render() can rebind it each frame without parameter-passing.
    var hToY = function (altH, H) { return (H - GROUND_PX) * (1 - altH / WORLD_HI); };

    // Deterministic pseudo-random in [0,1) from integer seed
    function seedRand(seed) {
      var x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
      return x - Math.floor(x);
    }

    // Redwood-style tree: tall, narrow spire, reddish-brown trunk
    function drawTree(x, baseY, h, isDarkMode) {
      var trunkW = Math.max(3, h * 0.07);
      var trunkH = h * 0.45;
      var cw     = h * 0.17;   // half-width of crown base

      // Trunk — reddish-brown bark
      ctx.fillStyle = isDarkMode ? '#4a1e08' : '#7a3010';
      ctx.fillRect(x - trunkW / 2, baseY - trunkH, trunkW, trunkH);

      // Lower crown tier (widest)
      ctx.fillStyle = isDarkMode ? '#1a3a18' : '#285a22';
      ctx.beginPath();
      ctx.moveTo(x,          baseY - h * 0.38);
      ctx.lineTo(x + cw * 2.2, baseY - trunkH * 0.55);
      ctx.lineTo(x - cw * 2.2, baseY - trunkH * 0.55);
      ctx.closePath();
      ctx.fill();

      // Mid crown tier
      ctx.fillStyle = isDarkMode ? '#1f4820' : '#306828';
      ctx.beginPath();
      ctx.moveTo(x,          baseY - h * 0.58);
      ctx.lineTo(x + cw * 1.7, baseY - h * 0.38);
      ctx.lineTo(x - cw * 1.7, baseY - h * 0.38);
      ctx.closePath();
      ctx.fill();

      // Upper crown tier
      ctx.fillStyle = isDarkMode ? '#245624' : '#377830';
      ctx.beginPath();
      ctx.moveTo(x,          baseY - h * 0.76);
      ctx.lineTo(x + cw * 1.2, baseY - h * 0.58);
      ctx.lineTo(x - cw * 1.2, baseY - h * 0.58);
      ctx.closePath();
      ctx.fill();

      // Narrow spire
      ctx.fillStyle = isDarkMode ? '#296029' : '#3d8534';
      ctx.beginPath();
      ctx.moveTo(x,          baseY - h);
      ctx.lineTo(x + cw * 0.6, baseY - h * 0.76);
      ctx.lineTo(x - cw * 0.6, baseY - h * 0.76);
      ctx.closePath();
      ctx.fill();
    }

    function drawTrees(W, horizonY, downrange, isDarkMode) {
      var spacing = 55;
      var scroll  = downrange % (spacing * 40);
      var count   = Math.ceil(W / spacing) + 3;
      var base    = Math.floor(scroll / spacing) - 1;
      for (var ti = base; ti < base + count; ti++) {
        var sx  = (ti - scroll / spacing) * spacing + seedRand(ti * 7 + 1) * spacing * 0.35;
        var sz  = 0.65 + seedRand(ti * 19 + 2) * 0.65;   // 0.65–1.3 scale
        var ht  = (42 + seedRand(ti * 13 + 3) * 32) * sz; // 27–96 px tall
        var yOff= seedRand(ti * 11 + 5) * 4;
        drawTree(sx, horizonY + yOff + 2, ht, isDarkMode);
      }
    }

    function drawCloud(x, y, r, isDarkMode) {
      ctx.save();
      ctx.fillStyle = isDarkMode ? 'rgba(110,150,210,0.22)' : 'rgba(255,255,255,0.92)';
      ctx.beginPath();
      ctx.arc(x,          y,         r,       0, Math.PI * 2);
      ctx.arc(x + r,      y - r*0.3, r*0.78,  0, Math.PI * 2);
      ctx.arc(x + r*2.0,  y,         r*0.65,  0, Math.PI * 2);
      ctx.arc(x + r*0.3,  y - r*0.2, r*0.62,  0, Math.PI * 2);
      ctx.arc(x + r*0.9,  y + r*0.3, r*0.55,  0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Clouds are always in the top ~30% of the canvas (high altitude zone)
    function drawClouds(W, H, downrange, isDarkMode) {
      var layers = [
        { yFrac: 0.04, parallax: 0.10, spacing: 340, sMin: 22, sMax: 42 },
        { yFrac: 0.12, parallax: 0.18, spacing: 250, sMin: 16, sMax: 30 },
        { yFrac: 0.22, parallax: 0.28, spacing: 190, sMin: 11, sMax: 21 },
      ];
      for (var li = 0; li < layers.length; li++) {
        var l = layers[li];
        var baseY = H * l.yFrac;
        var scroll = downrange * l.parallax;
        var count  = Math.ceil(W / l.spacing) + 3;
        var base   = Math.floor(scroll / l.spacing) - 1;
        for (var ci = base; ci < base + count; ci++) {
          var cx2 = (ci - scroll / l.spacing) * l.spacing
                  + seedRand(ci * 29 + li * 7 + 3) * l.spacing * 0.55;
          var size = l.sMin + seedRand(ci * 17 + li * 5 + 1) * (l.sMax - l.sMin);
          var cy2  = baseY + seedRand(ci * 23 + li * 9 + 5) * H * 0.04;
          drawCloud(cx2, cy2, size, isDarkMode);
        }
      }
    }

    // Draw the Cessna sprite rotated by pitch angle theta.
    // theta > 0 → nose up (CCW in canvas coords because Y-axis is flipped).
    // Elevator deflection de_rad is shown via the side indicator bar, not on the sprite.
    function drawPlane(cx, cy, theta_rad, isDarkMode) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-theta_rad);  // negative: CCW = nose up
      var ci = cessna.get();
      if (ci) {
        var dispW = Math.round(26 * WORLD_HI / VIEW_RANGE);  // scales with viewport zoom
        var dispH = dispW * ci.height / ci.width;
        ctx.drawImage(ci, -dispW * 0.5, -dispH * 0.5, dispW, dispH);
      } else {
        // Fallback triangle while image processes
        ctx.fillStyle = isDarkMode ? '#c0d0e0' : '#4060a0';
        ctx.beginPath();
        ctx.moveTo(20, 0);
        ctx.lineTo(-20, -8);
        ctx.lineTo(-20, 8);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    // status: 'ok' | 'crashed' | 'stalled' | 'too_high' | 'over_top'
    function render(state, simT, de_rad, status, extraFn, hRefTarget) {
      var W = canvas.clientWidth, H = 380;
      ctx.clearRect(0, 0, W, H);

      var h      = state[4];
      var V      = state[0];
      var alpha  = state[2];
      var q      = state[3];
      var gamma  = state[1];
      var theta  = gamma + alpha;        // pitch = flight-path + AoA
      var downrange = state[5];

      var accentColor = cssVar('--accent');
      var mutedColor  = cssVar('--text-muted');
      var borderColor = cssVar('--border');
      var bgSoft      = cssVar('--bg-soft');

      var isDark = document.documentElement.getAttribute('data-theme') === 'dark' ||
        (!document.documentElement.getAttribute('data-theme') &&
         window.matchMedia('(prefers-color-scheme: dark)').matches);

      // Zoomed viewport: VIEW_RANGE metres centred on the plane, clamped to world bounds.
      // hToY is rebound each frame so everything else (ref line, ticks, plane) just calls it.
      var viewLo = Math.max(WORLD_LO, Math.min(h - VIEW_RANGE / 2, WORLD_HI - VIEW_RANGE));
      var viewHi = viewLo + VIEW_RANGE;
      hToY = function (altH, H) {
        return (H - GROUND_PX) * (1 - (altH - viewLo) / VIEW_RANGE);
      };

      // Horizon at h=0 — always (H - GROUND_PX) pixels from canvas top
      var horizonY = H - GROUND_PX;  // ground strip is always fixed at the bottom

      // Full-canvas sky gradient
      var grad = ctx.createLinearGradient(0, 0, 0, horizonY);
      if (isDark) {
        grad.addColorStop(0, '#05090f');
        grad.addColorStop(1, '#0e1e2e');
      } else {
        grad.addColorStop(0, '#b8d4f0');
        grad.addColorStop(1, '#dceef8');
      }
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, horizonY);

      // Clouds always in upper portion of canvas (sky only)
      drawClouds(W, horizonY, downrange, isDark);

      // Ground strip — always visible at bottom
      ctx.fillStyle = isDark ? '#0d1a0d' : '#b8d4a0';
      ctx.fillRect(0, horizonY, W, H - horizonY);

      // Scrolling ground marks
      ctx.strokeStyle = isDark ? '#1a2e1a' : '#a0c080';
      ctx.lineWidth = 1;
      var markSpacing = 120;
      var offset = (downrange % markSpacing) / markSpacing * markSpacing;
      for (var mx = -offset; mx < W + markSpacing; mx += markSpacing) {
        ctx.beginPath();
        ctx.moveTo(mx, horizonY);
        ctx.lineTo(mx - 20, H);
        ctx.stroke();
      }

      // Trees always visible at horizon
      drawTrees(W, horizonY, downrange, isDark);

      // Reference altitude path.
      // tOffset maps a canvas x-pixel to a time offset so REF_DISPLAY_SPAN seconds of
      // the sine wave span the canvas. The plane sits at planeScreenX, so pixels to its
      // LEFT are the past reference (older in time) and pixels to its RIGHT are the future.
      var planeScreenX = W * 0.35;
      var isFlat = (typeof hRefTarget !== 'undefined');
      function refYAt(px) {
        if (isFlat) return hToY(hRefTarget, H);
        var tOffset = (px - planeScreenX) / W * REF_DISPLAY_SPAN;
        return hToY(H_CENTER + REF_AMP * Math.sin(REF_OMEGA * (simT + tOffset)), H);
      }

      if (isFlat) {
        // Flat reference: single horizontal dashed line across the full canvas.
        var flatRefY = refYAt(planeScreenX);
        ctx.save();
        ctx.strokeStyle = accentColor;
        ctx.setLineDash([10, 6]);
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.moveTo(0, flatRefY);
        ctx.lineTo(W, flatRefY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      } else {
        // Sine reference: future dashed guide + past comet tail.
        ctx.save();
        ctx.globalAlpha = 0.32;
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 1.2;
        ctx.setLineDash([8, 5]);
        ctx.beginPath();
        for (var px = planeScreenX; px <= W; px += 4) {
          var ry = refYAt(px);
          if (px === planeScreenX) ctx.moveTo(px, ry); else ctx.lineTo(px, ry);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        ctx.save();
        ctx.strokeStyle = accentColor;
        ctx.lineCap = 'round';
        for (var px = planeScreenX; px > 0; px -= 4) {
          var age = (planeScreenX - px) / planeScreenX;
          ctx.globalAlpha = Math.max(0, 1 - age);
          ctx.lineWidth = 0.5 + 2.2 * (1 - age);
          ctx.beginPath();
          ctx.moveTo(px, refYAt(px));
          ctx.lineTo(px - 4, refYAt(px - 4));
          ctx.stroke();
        }
        ctx.restore();
      }

      // Reference dot — target the aircraft is chasing right now.
      var dotY = refYAt(planeScreenX);
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = accentColor;
      ctx.beginPath();
      ctx.arc(planeScreenX, dotY, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(planeScreenX, dotY, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Cessna sprite
      drawPlane(planeScreenX, hToY(h, H), theta, isDark);

      // Altitude scale (right side) — ticks every 25 m across the zoomed viewport
      ctx.fillStyle = mutedColor;
      ctx.font = '11px ' + cssVar('--mono');
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      var tickStep = 25;
      var tickStart = Math.ceil(viewLo / tickStep) * tickStep;
      for (var ah = tickStart; ah <= viewHi; ah += tickStep) {
        var ay = hToY(ah, H);
        if (ay < 12 || ay > H - 12) continue;
        ctx.fillText(ah + 'm', W - 8, ay);
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(W - 45, ay);
        ctx.lineTo(W - 55, ay);
        ctx.stroke();
      }

      // Elevator indicator bar (right edge).
      // Positive de_rad → plane pitches up → thumb moves UP.
      var eiFrac = (de_rad / deg2rad(15) + 1) / 2;  // 0 = full down, 1 = full up
      var eiX = W - 22, eiTop = 50, eiH = 80;
      ctx.fillStyle = bgSoft;
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(eiX - 4, eiTop, 8, eiH, 4);
      ctx.fill();
      ctx.stroke();
      var thumbY = eiTop + (1 - eiFrac) * eiH;   // eiFrac=1 → top of bar
      ctx.fillStyle = accentColor;
      ctx.beginPath();
      ctx.roundRect(eiX - 7, thumbY - 3, 14, 6, 3);
      ctx.fill();
      ctx.fillStyle = mutedColor;
      ctx.font = '9px ' + cssVar('--mono');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('δe', eiX, eiTop - 2);

      // Telemetry overlay (bottom-left)
      ctx.fillStyle = isDark ? 'rgba(11,15,20,0.72)' : 'rgba(245,246,248,0.82)';
      ctx.beginPath();
      ctx.roundRect(10, H - 76, 196, 66, 8);
      ctx.fill();
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.font = '12px ' + cssVar('--mono');
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = mutedColor;
      ctx.fillText('h   ' + h.toFixed(0) + ' m', 18, H - 70);
      ctx.fillText('V   ' + V.toFixed(1) + ' m/s', 18, H - 56);
      ctx.fillText('α   ' + rad2deg(alpha).toFixed(1) + '°', 18, H - 42);
      ctx.fillText('q   ' + rad2deg(q).toFixed(2) + '°/s', 18, H - 28);

      // Stop-condition overlay
      if (status && status !== 'ok') {
        var msg = status === 'crashed'  ? '💥  CRASHED'
                : status === 'stalled'  ? '⚠️  STALLED'
                : status === 'too_high' ? '🌤️  TOO HIGH'
                : status === 'over_top' ? '🔄  OVER THE TOP'
                : status;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, 0, W, H);
        ctx.font = 'bold 22px ' + cssVar('--font');
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff';
        ctx.fillText(msg, W / 2, H / 2 - 12);
        ctx.font = '14px ' + cssVar('--font');
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.fillText('Resetting in a moment…', W / 2, H / 2 + 16);
      }

      if (typeof extraFn === 'function') extraFn(ctx, W, H, WORLD_LO, WORLD_HI);
    }

    return { render: render, resetViewport: function () { /* fixed viewport — no-op */ } };
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
     Demo 2 — Flight Simulator  (System ID + LQR)
     Workflow: Record PRBS excitation → Fit linear model (LS) →
               Design LQR (DARE) → Activate from random IC
  ================================================================ */
  (function flightDemo() {
    var canvas = document.getElementById('flight-canvas');
    if (!canvas) return;
    var renderer = makeFlightRenderer(canvas);

    // ---- Constants -----------------------------------------------
    var ELEV_MAX_RAD = deg2rad(15);
    var EXCITE_DUR   = 15;           // seconds of excitation recording
    var EXCITE_AMP   = deg2rad(5);   // PRBS amplitude (±5°)

    // ---- Sim state -----------------------------------------------
    var state, simT, de_rad, simStatus;
    var errRing = [], RING = 1200, CHIST = 300;
    var stateHist = { h: [], V: [], alpha_deg: [], gamma_deg: [] };
    var ctrlHist  = [];
    var resetTimer = null, bestRMSE = null;
    var flHRef = TRIM.h;

    // ---- System-ID / LQR workflow state --------------------------
    // wfMode: 'idle' | 'excite' | 'ready' | 'lqr'
    var wfMode      = 'idle';
    var exciteData  = [];   // [{dx:[4], du:scalar, dxn:[4]}]
    var exciteT     = 0;
    var exciteSign  = 1;
    var exciteTick  = 0;    // countdown to next PRBS switch (seconds)
    var sysModel    = null; // {Fd:4×4, Gd:4×1} discrete-time linearisation
    var lqrK        = null; // [[k0,k1,k2,k3]]  1×4 feedback gain

    // ---- DOM handles ---------------------------------------------
    var scoreEl     = document.getElementById('fl-score');
    var resetBtn    = document.getElementById('fl-reset');
    var recordBtn   = document.getElementById('fl-record-btn');
    var fitBtn      = document.getElementById('fl-fit-btn');
    var lqrBtn      = document.getElementById('fl-lqr-btn');
    var activateBtn = document.getElementById('fl-activate-btn');
    var statusEl    = document.getElementById('fl-sysid-status');
    var qSlider     = document.getElementById('fl-q');
    var rSlider     = document.getElementById('fl-r');
    var qValEl      = document.getElementById('fl-q-val');
    var rValEl      = document.getElementById('fl-r-val');
    var flStatePlot = document.getElementById('fl-state-plot');
    var flPidPlot   = document.getElementById('fl-pid-plot');

    function setStatus(msg) { if (statusEl) statusEl.textContent = msg; }

    // ---- Tiny matrix library (2-D row arrays) --------------------
    // All functions operate on plain arrays-of-arrays (row-major).
    function mm(A, B) {
      var m = A.length, p = A[0].length, n = B[0].length;
      var C = [], i, j, k, s;
      for (i = 0; i < m; i++) {
        C[i] = [];
        for (j = 0; j < n; j++) {
          s = 0;
          for (k = 0; k < p; k++) s += A[i][k] * B[k][j];
          C[i][j] = s;
        }
      }
      return C;
    }
    function mt(A) {
      var m = A.length, n = A[0].length, C = [], i, j;
      for (i = 0; i < n; i++) { C[i] = []; for (j = 0; j < m; j++) C[i][j] = A[j][i]; }
      return C;
    }
    function ma(A, B) { return A.map(function (r, i) { return r.map(function (v, j) { return v + B[i][j]; }); }); }
    function ms(A, B) { return A.map(function (r, i) { return r.map(function (v, j) { return v - B[i][j]; }); }); }
    function msc(A, s) { return A.map(function (r) { return r.map(function (v) { return v * s; }); }); }
    function mcopy(A) { return A.map(function (r) { return r.slice(); }); }
    function minv(A) {
      var n = A.length, i, j, k, f, p, tmp;
      var aug = A.map(function (row, ri) {
        var r = row.slice();
        for (var c = 0; c < n; c++) r.push(ri === c ? 1 : 0);
        return r;
      });
      for (i = 0; i < n; i++) {
        p = i;
        for (k = i + 1; k < n; k++) if (Math.abs(aug[k][i]) > Math.abs(aug[p][i])) p = k;
        tmp = aug[i]; aug[i] = aug[p]; aug[p] = tmp;
        f = aug[i][i];
        if (Math.abs(f) < 1e-14) return null;
        for (j = 0; j < 2 * n; j++) aug[i][j] /= f;
        for (k = 0; k < n; k++) {
          if (k === i) continue;
          f = aug[k][i];
          for (j = 0; j < 2 * n; j++) aug[k][j] -= f * aug[i][j];
        }
      }
      return aug.map(function (r) { return r.slice(n); });
    }

    // ---- Perturbation state: [Δh, Δγ, Δα, Δq]  (1×4 matrix) -----
    function dxOf(st) {
      return [[st[4] - flHRef, st[1] - TRIM.gamma, st[2] - TRIM.alpha, st[3] - TRIM.q]];
    }

    // ---- System identification (discrete-time LS) ----------------
    // Fits x_{k+1} = Fd x_k + Gd u_k from exciteData.
    function fitModel() {
      var N = exciteData.length;
      if (N < 30) { setStatus('Need more data — re-record'); return; }
      // Z: N×5  each row = [Δx_k | Δu_k]
      // Y: N×4  each row = Δx_{k+1}
      var Z = [], Y = [], k;
      for (k = 0; k < N; k++) {
        Z.push(exciteData[k].dx.concat([exciteData[k].du]));
        Y.push(exciteData[k].dxn);
      }
      var Zt    = mt(Z);          // 5×N
      var ZtZ   = mm(Zt, Z);      // 5×5
      var ZtZi  = minv(ZtZ);      // 5×5
      if (!ZtZi) { setStatus('Rank-deficient — re-record data'); return; }
      var theta = mm(ZtZi, mm(Zt, Y));   // 5×4
      var FdGd  = mt(theta);             // 4×5
      sysModel = {
        Fd: FdGd.map(function (r) { return r.slice(0, 4); }),  // 4×4
        Gd: FdGd.map(function (r) { return [r[4]]; })          // 4×1
      };
      setStatus(N + ' pts · model fit ✓  →  Compute LQR');
      if (lqrBtn) lqrBtn.disabled = false;
    }

    // ---- LQR via discrete-time Riccati iteration (DARE) ----------
    function computeLQR() {
      if (!sysModel) { setStatus('Fit a model first'); return; }
      var q_h = qSlider ? parseFloat(qSlider.value) : 1;
      var r   = rSlider  ? parseFloat(rSlider.value)  : 1;
      // Q: all states scaled by q slider — [Δh, Δγ, Δα, Δq]
      var Q = [[q_h,       0, 0,           0          ],
               [0,   q_h * 2, 0,           0          ],
               [0,         0, q_h * 5,     0          ],
               [0,         0, 0,       q_h * 0.5      ]];
      var Fd = sysModel.Fd, Gd = sysModel.Gd;
      var P = mcopy(Q), K = null, iter, diff, i, j;
      for (iter = 0; iter < 1000; iter++) {
        var GtP   = mm(mt(Gd), P);           // 1×4
        var GtPG  = mm(GtP, Gd)[0][0];       // scalar
        var denom = r + GtPG;
        if (!isFinite(denom) || Math.abs(denom) < 1e-14) break;
        K = msc(mm(GtP, Fd), 1 / denom);    // 1×4
        var FtP   = mm(mt(Fd), P);            // 4×4
        var FtPFd = mm(FtP, Fd);              // 4×4
        var FtPGK = mm(mm(FtP, Gd), K);      // 4×4
        var P2    = ma(Q, ms(FtPFd, FtPGK));
        diff = 0;
        for (i = 0; i < 4; i++) for (j = 0; j < 4; j++) diff += Math.pow(P2[i][j] - P[i][j], 2);
        P = P2;
        if (diff < 1e-12) break;
      }
      // Sanity check
      var ok = K && K[0].every(function (v) { return isFinite(v); });
      if (!ok) { setStatus('DARE did not converge — re-record data'); lqrK = null; return; }
      lqrK = K;
      var ks = K[0].map(function (v) { return v.toFixed(3); }).join(', ');
      setStatus('K = [' + ks + ']');
      if (activateBtn) activateBtn.disabled = false;
    }

    // ---- Excitation reset: fly at exact trim for data collection --
    function resetToTrim() {
      flHRef = TRIM.h;
      state  = [TRIM.V, TRIM.gamma, TRIM.alpha, TRIM.q, TRIM.h, TRIM.x];
      simT = 0; de_rad = TRIM.de;
      errRing = [];
      stateHist = { h: [], V: [], alpha_deg: [], gamma_deg: [] };
      ctrlHist  = [];
      simStatus = 'ok';
    }

    // ---- Normal (trial) reset: random IC, random target ----------
    function resetSim() {
      if (resetTimer) { clearTimeout(resetTimer); resetTimer = null; }
      if (wfMode === 'lqr') {
        flHRef = 200 + Math.random() * 200;
        var hOff = (Math.random() - 0.5) * 80;
        var gPerturb = (Math.random() - 0.5) * deg2rad(16);
        state = [TRIM.V, TRIM.gamma + gPerturb, TRIM.alpha, TRIM.q, flHRef + hOff, TRIM.x];
      } else {
        flHRef = TRIM.h;
        state  = [TRIM.V, TRIM.gamma, TRIM.alpha, TRIM.q, TRIM.h, TRIM.x];
      }
      simT = 0; de_rad = TRIM.de;
      errRing = [];
      stateHist = { h: [], V: [], alpha_deg: [], gamma_deg: [] };
      ctrlHist  = [];
      simStatus = 'ok'; bestRMSE = null;
      var bestEl = document.getElementById('fl-best');
      if (bestEl) bestEl.textContent = '';
      renderer.resetViewport();
    }
    resetSim();

    // ---- Event handlers ------------------------------------------
    if (resetBtn) resetBtn.addEventListener('click', function () {
      if (wfMode === 'excite') { wfMode = 'idle'; setStatus('Recording cancelled'); }
      resetSim();
      if (activateBtn) activateBtn.textContent = 'Activate LQR';
    });

    if (recordBtn) recordBtn.addEventListener('click', function () {
      wfMode      = 'excite';
      exciteData  = [];
      exciteT     = 0;
      exciteSign  = 1;
      exciteTick  = 0;
      resetToTrim();
      setStatus('Recording… 0 / ' + EXCITE_DUR + ' s');
      if (fitBtn)     fitBtn.disabled     = true;
      if (lqrBtn)     lqrBtn.disabled     = true;
      if (activateBtn) { activateBtn.disabled = true; activateBtn.textContent = 'Activate LQR'; }
    });

    if (fitBtn) { fitBtn.disabled = true; fitBtn.addEventListener('click', fitModel); }
    if (lqrBtn) { lqrBtn.disabled = true; lqrBtn.addEventListener('click', computeLQR); }

    if (qSlider) qSlider.addEventListener('input', function () {
      if (qValEl) qValEl.textContent = parseFloat(qSlider.value).toFixed(2);
    });
    if (rSlider) rSlider.addEventListener('input', function () {
      if (rValEl) rValEl.textContent = parseFloat(rSlider.value).toFixed(2);
    });

    if (activateBtn) {
      activateBtn.disabled = true;
      activateBtn.addEventListener('click', function () {
        if (wfMode === 'lqr') {
          wfMode = 'idle';
          activateBtn.textContent = 'Activate LQR';
          resetSim();
        } else {
          if (!lqrK) { computeLQR(); if (!lqrK) return; }
          wfMode = 'lqr';
          activateBtn.textContent = 'Deactivate';
          resetSim();
        }
      });
    }

    // ---- Physics + control step ----------------------------------
    function step() {
      if (!document.getElementById('sec-flight').classList.contains('active')) return;
      if (simStatus !== 'ok') return;

      var dxk, duk;  // excitation sample captured before RK4
      for (var i = 0; i < 5; i++) {
        if (wfMode === 'excite') {
          exciteTick -= FLIGHT_DT;
          if (exciteTick <= 0) {
            exciteSign = Math.random() < 0.5 ? 1 : -1;
            exciteTick = 0.15 + Math.random() * 0.40;
          }
          dxk = dxOf(state)[0];
          duk = exciteSign * EXCITE_AMP;
          de_rad = clamp(TRIM.de + duk, -ELEV_MAX_RAD, ELEV_MAX_RAD);
        } else if (wfMode === 'lqr' && lqrK) {
          var dx4 = dxOf(state)[0];
          de_rad = clamp(TRIM.de - (lqrK[0][0]*dx4[0] + lqrK[0][1]*dx4[1] +
                                    lqrK[0][2]*dx4[2] + lqrK[0][3]*dx4[3]),
                         -ELEV_MAX_RAD, ELEV_MAX_RAD);
        } else {
          de_rad = TRIM.de;
        }

        state = rk4(state, simT, FLIGHT_DT, function (t, s) { return flightDerivatives(t, s, de_rad); });

        if (wfMode === 'excite') {
          exciteData.push({ dx: dxk, du: duk, dxn: dxOf(state)[0] });
          exciteT += FLIGHT_DT;
        }
        simT += FLIGHT_DT;

        var stop = checkStopConditions(state);
        if (stop) {
          simStatus = stop;
          if (wfMode === 'excite') {
            // Crash mid-excitation: restart trim and continue collecting
            resetToTrim(); simStatus = 'ok'; break;
          }
          if (!resetTimer) resetTimer = setTimeout(function () { resetTimer = null; resetSim(); }, 2500);
          return;
        }
        errRing.push(Math.pow(flHRef - state[4], 2));
        if (errRing.length > RING) errRing.shift();
      }

      // Check excitation completion
      if (wfMode === 'excite') {
        if (exciteT >= EXCITE_DUR) {
          wfMode = 'ready';
          if (fitBtn) fitBtn.disabled = false;
          setStatus(exciteData.length + ' samples recorded — click Fit Model');
        } else {
          setStatus('Recording… ' + exciteT.toFixed(1) + ' / ' + EXCITE_DUR + ' s');
        }
      }

      stateHist.h.push(state[4]); stateHist.V.push(state[0]);
      stateHist.alpha_deg.push(rad2deg(state[2])); stateHist.gamma_deg.push(rad2deg(state[1]));
      ctrlHist.push(rad2deg(de_rad));
      if (stateHist.h.length > CHIST) {
        stateHist.h.shift(); stateHist.V.shift();
        stateHist.alpha_deg.shift(); stateHist.gamma_deg.shift();
      }
      if (ctrlHist.length > CHIST) ctrlHist.shift();

      if (scoreEl && errRing.length > 0) {
        var rmse = Math.sqrt(errRing.reduce(function (a, b) { return a + b; }, 0) / errRing.length);
        scoreEl.textContent = rmse.toFixed(1);
        if (bestRMSE === null || rmse < bestRMSE) {
          bestRMSE = rmse;
          var bestEl = document.getElementById('fl-best');
          if (bestEl) bestEl.textContent = 'Best: ' + rmse.toFixed(1);
        }
      }
    }

    setInterval(step, 25);

    function loop() {
      renderer.render(state, simT, de_rad, simStatus, null, flHRef);
      drawStatePlot(flStatePlot, stateHist);
      drawContribPlot(flPidPlot, [
        { label: 'δe (°)', color: cssVar('--viz-1'), data: ctrlHist }
      ], rad2deg(ELEV_MAX_RAD), 'δe (°)');
      requestAnimationFrame(loop);
    }
    loop();
  })();

  /* ================================================================
     Demo 3 — Cart-Pole PPO
  ================================================================ */
  (function sysidDemo() {
    var canvas = document.getElementById('sysid-canvas');
    if (!canvas) return;

    /* ---- Cart-pole plant ----
       state = [x, ẋ, θ, θ̇]  (m, m/s, rad, rad/s); θ measured from straight up.
       Control u = horizontal force F (N) on the cart. The upright θ=0 is an
       UNSTABLE equilibrium — the whole point of the demo. */
    var M_CART = 0.4, M_POLE = 0.4, L_POLE = 0.9;
    var G = 9.81, TOTAL_M = M_CART + M_POLE, PML = M_POLE * L_POLE;
    var FMAX = 8;
    var CP_DT = 0.005, SUBSTEPS = 5;
    var FALL_ANGLE = deg2rad(55), X_LIMIT = 5.0;
    var X_TARGET = 0;
    var CART_FRICTION = 1.2;   // N·s/m viscous cart damping

    function cpDeriv(t, s, F) {
      var th = s[2], w = s[3];
      var sinth = Math.sin(th), costh = Math.cos(th);
      var Fnet = F - CART_FRICTION * s[1];
      var temp = (Fnet + PML * w * w * sinth) / TOTAL_M;
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

    // ---- PPO hyperparameters ----
    var PPO_LOG_STD = -0.5;   // fixed log σ; σ ≈ 0.6 × FMAX ≈ 15 N spread
    var PPO_ROLLOUT = 512, PPO_GAMMA = 0.99, PPO_LAMBDA = 0.95;
    var PPO_CLIP = 0.2, PPO_EPOCHS = 4, PPO_BATCH = 64, PPO_LR = 2e-4;
    var PPO_MAX_UPDATES = 500; // kept for reference; active limit is PPO_FINETUNE

    // ---- Simulation state ----
    var state, simT, uForce;
    var pushF = 0, keyForce = 0;
    var simStatus3 = 'ok';
    var resetTimer3 = null;
    var nnActive3 = false, nnNet3 = null;   // deployed actor
    var ppoCriticNet = null;
    var ppoActorAdam = null, ppoCriticAdam = null;
    var ppoTraining = false, ppoTrainTimer = null;
    var ppoRewardHist = [];
    var ppoUpdateCount = 0;
    var ppoEverBalanced = false;   // true once pole reaches near-upright after activation
    var ppoActivatedSimT = 0;     // simT when policy was last activated
    var errRing = [], RING = 1200, CHIST = 300;
    var stateHist = { x: [], xd: [], th: [], thd: [] };

    // ---- NN architecture ----
    var nnLayers3 = 2, nnNeurons3 = 32;

    // ---- DOM handles ----
    var sidStatePlot   = document.getElementById('sid-state-plot');
    var forceSlider    = document.getElementById('sid-force');
    var forceVal       = document.getElementById('sid-force-val');
    var scoreEl        = document.getElementById('sid-score');
    var ppoBtnEl       = document.getElementById('sid-ppo-train-btn');
    var ppoStatusEl    = document.getElementById('sid-ppo-status');
    var nnActivateBtn3 = document.getElementById('sid-nn-activate-btn');
    var nnNetviz3      = document.getElementById('sid-netviz');
    var resetBtn       = document.getElementById('sid-reset');

    var CP_STATE_SPEC = [
      { key: 'x',   label: 'x (m)',    color: cssVar('--viz-1') },
      { key: 'xd',  label: 'ẋ (m/s)',  color: cssVar('--viz-2') },
      { key: 'th',  label: 'θ (°)',    color: cssVar('--viz-3') },
      { key: 'thd', label: 'θ̇ (°/s)',  color: cssVar('--viz-4') }
    ];

    // ---- NN utility functions ----
    function getLayerSizes3() {
      var s = [5];   // [x, xdot, cos θ, sin θ, thetadot]
      for (var i = 0; i < nnLayers3; i++) s.push(nnNeurons3);
      s.push(1); return s;
    }
    function initNet3(sizes) {
      var W = [], b = [];
      for (var l = 0; l < sizes.length - 1; l++) {
        var ni = sizes[l], no = sizes[l+1];
        var w = new Float64Array(ni * no);
        var sc = Math.sqrt(2 / ni);
        for (var k = 0; k < w.length; k++) {
          var u1 = Math.random() + 1e-10, u2 = Math.random();
          w[k] = sc * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        }
        W.push(w); b.push(new Float64Array(no));
      }
      return { sizes: sizes, W: W, b: b };
    }
    function fwdNetCP(nn, xRaw) {
      var inp = xRaw.map(function (v) { return clamp(v / 1.0, -3, 3); });
      var a = [new Float64Array(inp)];
      for (var l = 0; l < nn.W.length; l++) {
        var ni = nn.sizes[l], no = nn.sizes[l+1];
        var z = new Float64Array(no);
        for (var i = 0; i < no; i++) {
          var sum = nn.b[l][i];
          for (var j = 0; j < ni; j++) sum += nn.W[l][i*ni+j] * a[l][j];
          z[i] = (l < nn.W.length - 1) ? Math.tanh(sum) : sum;
        }
        a.push(z);
      }
      return { out: a[a.length-1][0], a: a };
    }
    function bwdNetCP(nn, cache, target) {
      var nL = nn.W.length;
      var dW = nn.W.map(function (w) { return new Float64Array(w.length); });
      var db = nn.b.map(function (bi) { return new Float64Array(bi.length); });
      var delta = [cache.out - target];
      for (var l = nL - 1; l >= 0; l--) {
        var ni = nn.sizes[l], no = nn.sizes[l+1];
        for (var i = 0; i < no; i++) {
          var d = delta[i];
          if (l < nL - 1) d *= (1 - cache.a[l+1][i] * cache.a[l+1][i]);
          db[l][i] += d;
          for (var j = 0; j < ni; j++) dW[l][i*ni+j] += d * cache.a[l][j];
        }
        if (l > 0) {
          var dp = new Float64Array(ni);
          for (var j = 0; j < ni; j++) {
            var s = 0;
            for (var i = 0; i < no; i++) {
              var d2 = delta[i];
              if (l < nL - 1) d2 *= (1 - cache.a[l+1][i] * cache.a[l+1][i]);
              s += nn.W[l][i*ni+j] * d2;
            }
            dp[j] = s;
          }
          delta = Array.prototype.slice.call(dp);
        }
      }
      return { dW: dW, db: db };
    }
    function initAdam3(nn) {
      return {
        mW: nn.W.map(function (w) { return new Float64Array(w.length); }),
        vW: nn.W.map(function (w) { return new Float64Array(w.length); }),
        mb: nn.b.map(function (bi) { return new Float64Array(bi.length); }),
        vb: nn.b.map(function (bi) { return new Float64Array(bi.length); }),
        t: 0
      };
    }
    function adamStep3(nn, grads, am, lr) {
      var b1 = 0.9, b2 = 0.999, eps = 1e-8;
      am.t++;
      var bc1 = 1 - Math.pow(b1, am.t), bc2 = 1 - Math.pow(b2, am.t);
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

    // ---- Expert controller (energy-shaping swing-up + LQR balance) ----
    function expertController(s) {
      var th = s[2], thdot = s[3], costh = Math.cos(th);
      if (Math.abs(th) < deg2rad(22)) {
        // LQR near upright: F = k_th·θ + k_thd·θ̇ - k_x·x - k_xd·ẋ
        return clamp(18.0*th + 4.0*thdot - 0.4*s[0] - 0.9*s[1], -FMAX, FMAX);
      }
      // Energy-shaping swing-up
      var KE = 0.5*(M_CART+M_POLE)*s[1]*s[1]
             + 0.5*M_POLE*L_POLE*s[1]*thdot*costh
             + (1/6)*M_POLE*L_POLE*L_POLE*thdot*thdot;
      var PE   = M_POLE*G*(L_POLE/2)*costh;
      var Eref = M_POLE*G*(L_POLE/2);
      return clamp(3.0*(KE+PE-Eref)*thdot*costh, -FMAX, FMAX);
    }

    function collectExpertDemos(nEps, maxSteps) {
      var demos = [];
      for (var ep = 0; ep < nEps; ep++) {
        // small kick so energy shaping has non-zero θ̇ to work with
        var ts = [(Math.random()-0.5)*0.2, 0, Math.PI, 0.4+(Math.random()-0.5)*0.3];
        for (var step = 0; step < maxSteps; step++) {
          var obs = ppoObs(ts);
          var F = expertController(ts);
          demos.push({ obs: obs, action: F });
          var Fc = F;
          for (var sub = 0; sub < SUBSTEPS; sub++) {
            ts = rk4(ts, 0, CP_DT, function(t,s_){ return cpDeriv(t,s_,Fc); });
          }
          if (Math.abs(ts[0]) > X_LIMIT) break;
        }
      }
      return demos;
    }

    // ---- PPO functions ----
    function ppoObs(s) {
      // cos/sin encoding avoids the ±π discontinuity — hanging is (-1, ~0) regardless of direction
      return [s[0]/X_LIMIT, s[1]/3.5, Math.cos(s[2]), Math.sin(s[2]), s[3]/6.0];
    }

    function ppoRewardFn(s, F, done) {
      if (done) return -1;
      var xdot = s[1], costh = Math.cos(s[2]), thdot = s[3];
      // Total mechanical energy of the uniform-rod cart-pole
      var KE = 0.5*(M_CART+M_POLE)*xdot*xdot
             + 0.5*M_POLE*L_POLE*xdot*thdot*costh
             + (1/6)*M_POLE*L_POLE*L_POLE*thdot*thdot;
      var PE   = M_POLE*G*(L_POLE/2)*costh;
      var E    = KE + PE;
      // Reference: upright + stopped (cart position is free)
      var Eref  = M_POLE*G*(L_POLE/2);
      var Escale = 2*Eref;   // bottom-stopped error normalises to ±1
      var dE = (E - Eref) / Escale;
      var xPen = (s[0]/X_LIMIT) * (s[0]/X_LIMIT);
      return 1 - dE*dE - 0.1*xPen;
    }

    function ppoActSample(obs, deterministic) {
      var result = fwdNetCP(nnNet3, obs);
      var tanhOut = Math.tanh(result.out);
      var mu = tanhOut * FMAX;
      var std = Math.exp(PPO_LOG_STD) * FMAX;
      var noise = deterministic ? 0 : gaussian();
      var action = clamp(mu + std * noise, -FMAX, FMAX);
      var logProb = -0.5 * Math.pow((action - mu)/std, 2) - Math.log(std) - 0.9189;
      return { action: action, logProb: logProb, result: result, tanhOut: tanhOut };
    }

    function collectRollout() {
      var obs_buf = [], act_buf = [], rew_buf = [], done_buf = [], logp_buf = [], val_buf = [];
      var episodeRews = [], epRew = 0;
      // 50/50 mix: hanging start for swing-up, upright start for balance robustness.
      // Only terminate on X_LIMIT — never for pole angle — so upright starts don't
      // immediately look like a "done" state.
      function randomStart() {
        if (Math.random() < 0.5) {
          return [(Math.random()-0.5)*0.3, 0, Math.PI, 0];           // hanging
        } else {
          return [(Math.random()-0.5)*0.2, 0, (Math.random()-0.5)*deg2rad(10), 0]; // near-upright
        }
      }
      var ts = randomStart();
      for (var step = 0; step < PPO_ROLLOUT; step++) {
        var obs = ppoObs(ts);
        var act = ppoActSample(obs, false);
        var val = fwdNetCP(ppoCriticNet, obs).out;
        var F = act.action;
        for (var sub = 0; sub < SUBSTEPS; sub++) {
          ts = rk4(ts, 0, CP_DT, function(t, s) { return cpDeriv(t, s, F); });
        }
        var done = Math.abs(ts[0]) > X_LIMIT;
        var rew = ppoRewardFn(ts, F, done);
        epRew += rew;
        obs_buf.push(obs); act_buf.push(F); rew_buf.push(rew);
        done_buf.push(done ? 1 : 0); logp_buf.push(act.logProb); val_buf.push(val);
        if (done) {
          episodeRews.push(epRew); epRew = 0;
          ts = randomStart();
        }
      }
      var lastVal = done_buf[PPO_ROLLOUT-1] ? 0 : fwdNetCP(ppoCriticNet, ppoObs(ts)).out;
      var advantages = new Array(PPO_ROLLOUT);
      var returns = new Array(PPO_ROLLOUT);
      var gae = 0;
      for (var t = PPO_ROLLOUT - 1; t >= 0; t--) {
        var nextV = (t === PPO_ROLLOUT-1) ? lastVal : val_buf[t+1];
        var delta = rew_buf[t] + PPO_GAMMA * nextV * (1 - done_buf[t]) - val_buf[t];
        gae = delta + PPO_GAMMA * PPO_LAMBDA * (1 - done_buf[t]) * gae;
        advantages[t] = gae;
        returns[t] = gae + val_buf[t];
      }
      var advMean = 0;
      for (var i = 0; i < PPO_ROLLOUT; i++) advMean += advantages[i];
      advMean /= PPO_ROLLOUT;
      var advVar = 0;
      for (var i = 0; i < PPO_ROLLOUT; i++) advVar += (advantages[i]-advMean)*(advantages[i]-advMean);
      var advStd = Math.sqrt(advVar/PPO_ROLLOUT + 1e-8);
      for (var i = 0; i < PPO_ROLLOUT; i++) advantages[i] = (advantages[i]-advMean)/advStd;
      var meanRew = episodeRews.length > 0
        ? episodeRews.reduce(function(a,b){return a+b;},0)/episodeRews.length : epRew;
      return { obs: obs_buf, acts: act_buf, logProbs: logp_buf,
               advantages: advantages, returns: returns, meanRew: meanRew };
    }

    function ppoUpdate(rollout) {
      var N = PPO_ROLLOUT;
      var indices = [];
      for (var i = 0; i < N; i++) indices.push(i);
      for (var epoch = 0; epoch < PPO_EPOCHS; epoch++) {
        for (var i = N-1; i > 0; i--) {
          var j = Math.floor(Math.random()*(i+1));
          var tmp = indices[i]; indices[i] = indices[j]; indices[j] = tmp;
        }
        for (var b = 0; b < N; b += PPO_BATCH) {
          var bEnd = Math.min(b+PPO_BATCH, N);
          var bSize = bEnd - b;
          var aGrads = {
            dW: nnNet3.W.map(function(w){return new Float64Array(w.length);}),
            db: nnNet3.b.map(function(bi){return new Float64Array(bi.length);})
          };
          var cGrads = {
            dW: ppoCriticNet.W.map(function(w){return new Float64Array(w.length);}),
            db: ppoCriticNet.b.map(function(bi){return new Float64Array(bi.length);})
          };
          for (var k = b; k < bEnd; k++) {
            var idx = indices[k];
            var obs = rollout.obs[idx];
            var act = rollout.acts[idx];
            var oldLogP = rollout.logProbs[idx];
            var adv = rollout.advantages[idx];
            var ret = rollout.returns[idx];
            // Actor: PPO clipped policy gradient
            var aResult = fwdNetCP(nnNet3, obs);
            var tanhOut = Math.tanh(aResult.out);
            var mu = tanhOut * FMAX;
            var std = Math.exp(PPO_LOG_STD) * FMAX;
            var newLogP = -0.5*Math.pow((act-mu)/std,2) - Math.log(std) - 0.9189;
            var ratio = Math.exp(Math.min(newLogP - oldLogP, 5));
            var clipped = (adv > 0 && ratio > 1+PPO_CLIP) || (adv < 0 && ratio < 1-PPO_CLIP);
            var dLoss_dLogP = clipped ? 0 : -ratio * adv;
            var sech2 = 1 - tanhOut*tanhOut;
            var dLogP_dMu = (act - mu) / (std * std);
            var dLoss_dOut = dLoss_dLogP * dLogP_dMu * sech2 * FMAX / bSize;
            var aG = bwdNetCP(nnNet3, aResult, aResult.out - dLoss_dOut);
            for (var l = 0; l < nnNet3.W.length; l++) {
              for (var ki = 0; ki < nnNet3.W[l].length; ki++) aGrads.dW[l][ki] += aG.dW[l][ki];
              for (var ki = 0; ki < nnNet3.b[l].length; ki++) aGrads.db[l][ki] += aG.db[l][ki];
            }
            // Critic: MSE on return
            var cResult = fwdNetCP(ppoCriticNet, obs);
            var cG = bwdNetCP(ppoCriticNet, cResult, ret);
            for (var l = 0; l < ppoCriticNet.W.length; l++) {
              for (var ki = 0; ki < ppoCriticNet.W[l].length; ki++) cGrads.dW[l][ki] += cG.dW[l][ki]/bSize;
              for (var ki = 0; ki < ppoCriticNet.b[l].length; ki++) cGrads.db[l][ki] += cG.db[l][ki]/bSize;
            }
          }
          adamStep3(nnNet3, aGrads, ppoActorAdam, PPO_LR);
          adamStep3(ppoCriticNet, cGrads, ppoCriticAdam, PPO_LR * 3);
        }
      }
    }

    // ---- Reward history chart ----
    function drawRewardChart() {
      var lc = document.getElementById('sid-nn-loss-canvas');
      if (!lc || !ppoRewardHist.length) return;
      var dpr2 = Math.min(window.devicePixelRatio||1,2);
      var LW = lc.offsetWidth||200, LH = 60;
      lc.width = Math.round(LW*dpr2); lc.height = Math.round(LH*dpr2);
      var lctx = lc.getContext('2d');
      lctx.setTransform(dpr2,0,0,dpr2,0,0);
      lctx.fillStyle = cssVar('--bg-soft'); lctx.fillRect(0,0,LW,LH);
      var n = ppoRewardHist.length;
      var maxR = Math.max.apply(null, ppoRewardHist);
      var minR = Math.min.apply(null, ppoRewardHist);
      var rng = Math.max(maxR - minR, 1);
      lctx.strokeStyle = cssVar('--accent'); lctx.lineWidth = 1.5; lctx.beginPath();
      for (var i = 0; i < n; i++) {
        var x = (i/Math.max(n-1,1))*LW;
        var y = LH-4 - ((ppoRewardHist[i]-minR)/rng)*(LH-8);
        if (i===0) lctx.moveTo(x,y); else lctx.lineTo(x,y);
      }
      lctx.stroke();
      lctx.fillStyle = cssVar('--text-muted'); lctx.font = '10px monospace';
      lctx.textAlign = 'left'; lctx.textBaseline = 'top';
      lctx.fillText('mean episode reward', 4, 3);
      lctx.textAlign = 'right'; lctx.textBaseline = 'bottom';
      lctx.fillText(ppoRewardHist[n-1].toFixed(1), LW-4, LH-2);
    }

    // ---- Sim management ----
    function resetSim() {
      if (resetTimer3) { clearTimeout(resetTimer3); resetTimer3 = null; }
      state = [0, 0, Math.PI, 0];
      simT = 0; uForce = 0;
      nnActive3 = false;
      ppoEverBalanced = false;
      ppoActivatedSimT = 0;
      stateHist = { x: [], xd: [], th: [], thd: [] };
      errRing = [];
      simStatus3 = 'ok';
      if (nnActivateBtn3) { nnActivateBtn3.textContent = 'Activate Policy'; nnActivateBtn3.classList.remove('active'); }
    }

    resetSim();

    if (forceSlider) forceSlider.addEventListener('input', function () {
      pushF = parseFloat(forceSlider.value) || 0;
      if (forceVal) forceVal.textContent = pushF.toFixed(1) + ' N';
    });
    (function () {
      var ri = document.getElementById('sid-force-range');
      if (!ri || !forceSlider) return;
      ri.addEventListener('input', function () {
        var r = Math.max(1, parseFloat(ri.value) || 1);
        var prev = parseFloat(forceSlider.value);
        forceSlider.min = -r; forceSlider.max = r; forceSlider.step = r / 40;
        forceSlider.value = clamp(prev, -r, r);
        pushF = parseFloat(forceSlider.value) || 0;
        if (forceVal) forceVal.textContent = pushF.toFixed(1) + ' N';
      });
    })();

    if (resetBtn) resetBtn.addEventListener('click', resetSim);

    document.addEventListener('keydown', function (e) {
      var sec = document.getElementById('sec-sysid');
      if (!sec || !sec.classList.contains('active')) return;
      if (nnActive3) return;
      if (e.key === 'ArrowLeft')  { keyForce = -8; e.preventDefault(); }
      if (e.key === 'ArrowRight') { keyForce =  8; e.preventDefault(); }
    });
    document.addEventListener('keyup', function (e) {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') keyForce = 0;
    });

    // ---- Simulation step (25 ms) ----
    function step() {
      if (!document.getElementById('sec-sysid').classList.contains('active')) return;
      if (simStatus3 !== 'ok') return;

      var uCtrl;
      if (nnActive3 && nnNet3) {
        uCtrl = ppoActSample(ppoObs(state), true).action;
      } else {
        uCtrl = keyForce;
      }
      uForce = clamp(uCtrl + pushF, -FMAX, FMAX);

      for (var i = 0; i < SUBSTEPS; i++) {
        state = rk4(state, simT, CP_DT, function (t, s) { return cpDeriv(t, s, uForce); });
        simT += CP_DT;
      }

      if (Math.abs(state[0]) > X_LIMIT) {
        simStatus3 = 'offtrack';
        if (!resetTimer3) resetTimer3 = setTimeout(function () { resetTimer3 = null; resetSim(); }, 2000);
        return;
      }
      if (nnActive3) {
        if (Math.abs(state[2]) < deg2rad(25)) ppoEverBalanced = true;
        var swingTimeout = !ppoEverBalanced && (simT - ppoActivatedSimT) > 5.0;
        if (swingTimeout || (ppoEverBalanced && Math.abs(state[2]) > FALL_ANGLE)) {
          simStatus3 = 'fell';
          if (!resetTimer3) resetTimer3 = setTimeout(function () { resetTimer3 = null; resetSim(); }, 2000);
          return;
        }
      }

      stateHist.x.push(state[0]); stateHist.xd.push(state[1]);
      stateHist.th.push(rad2deg(state[2])); stateHist.thd.push(rad2deg(state[3]));
      if (stateHist.x.length > CHIST) { stateHist.x.shift(); stateHist.xd.shift(); stateHist.th.shift(); stateHist.thd.shift(); }

      errRing.push(Math.pow(rad2deg(state[2]), 2));
      if (errRing.length > RING) errRing.shift();
      if (scoreEl && errRing.length > 0) {
        scoreEl.textContent = Math.sqrt(errRing.reduce(function(a,b){return a+b;},0)/errRing.length).toFixed(2);
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
      var accent = cssVar('--accent'), mono = cssVar('--mono');
      var poleColor = cssVar('--viz-2');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

      var trackY = H * 0.72;
      var scale = (W * 0.5) / (X_LIMIT + 0.6);
      var cx = W / 2;
      function sx(xm) { return cx + xm * scale; }

      ctx.strokeStyle = border; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(20, trackY); ctx.lineTo(W - 20, trackY); ctx.stroke();
      ctx.strokeStyle = muted; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
      [-X_LIMIT, X_LIMIT].forEach(function (xm) {
        ctx.beginPath(); ctx.moveTo(sx(xm), trackY - 12); ctx.lineTo(sx(xm), trackY + 12); ctx.stroke();
      });
      ctx.strokeStyle = accent; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(sx(X_TARGET), trackY - 60); ctx.lineTo(sx(X_TARGET), trackY + 14); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = muted; ctx.font = '10px ' + mono; ctx.textAlign = 'center';
      ctx.fillText('target', sx(X_TARGET), trackY + 28);

      var cartX = sx(state[0]);
      var cartW = 60, cartH = 26;

      if (Math.abs(uForce) > 0.2) {
        var fl = clamp(uForce / FMAX, -1, 1) * 46;
        ctx.strokeStyle = poleColor; ctx.fillStyle = poleColor; ctx.lineWidth = 3;
        var ay = trackY + 40;
        ctx.beginPath(); ctx.moveTo(cartX, ay); ctx.lineTo(cartX + fl, ay); ctx.stroke();
        var fsign = fl >= 0 ? 1 : -1;
        ctx.beginPath();
        ctx.moveTo(cartX + fl, ay); ctx.lineTo(cartX + fl - 7*fsign, ay - 4);
        ctx.lineTo(cartX + fl - 7*fsign, ay + 4); ctx.closePath(); ctx.fill();
        ctx.fillStyle = muted; ctx.font = '10px ' + mono; ctx.textAlign = 'center';
        ctx.fillText('F = ' + uForce.toFixed(1) + ' N', cartX, ay + 18);
      }

      ctx.fillStyle = accent;
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(cartX - cartW/2, trackY - cartH, cartW, cartH, 5); ctx.fill(); }
      else ctx.fillRect(cartX - cartW/2, trackY - cartH, cartW, cartH);
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.arc(cartX - cartW/4, trackY, 5, 0, 2*Math.PI); ctx.fill();
      ctx.beginPath(); ctx.arc(cartX + cartW/4, trackY, 5, 0, 2*Math.PI); ctx.fill();

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

      ctx.textAlign = 'left'; ctx.font = '600 13px ' + cssVar('--font');
      var label, col;
      if (simStatus3 === 'fell')          { label = 'Pole fell — resetting…'; col = poleColor; }
      else if (simStatus3 === 'offtrack') { label = 'Cart hit the rail — resetting…'; col = poleColor; }
      else if (nnActive3)                 { label = 'PPO policy in control'; col = accent; }
      else if (ppoTraining)               { label = 'Training PPO in background…'; col = accent; }
      else                                { label = 'Pole hanging — use ←→ keys or slider'; col = muted; }
      ctx.fillStyle = col; ctx.fillText(label, 18, 26);
      ctx.fillStyle = muted; ctx.font = '11px ' + mono;
      ctx.fillText('θ = ' + rad2deg(state[2]).toFixed(1) + '°   x = ' + state[0].toFixed(2) + ' m', 18, 44);
    }

    function loop() {
      drawCartPole();
      drawStatePlot(sidStatePlot, stateHist, CP_STATE_SPEC);
      requestAnimationFrame(loop);
    }
    loop();

    function parseRGB3(str) {
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
    function mixRGB3(a, b, t) {
      return [Math.round(a[0]+(b[0]-a[0])*t), Math.round(a[1]+(b[1]-a[1])*t), Math.round(a[2]+(b[2]-a[2])*t)];
    }

    function drawNetViz3(nn, cache) {
      var nc = document.getElementById('sid-net-canvas');
      if (!nc || !nn) return;
      var dpr2 = Math.min(window.devicePixelRatio || 1, 2);
      var W3 = nc.parentElement ? nc.parentElement.clientWidth : 640;
      if (!W3) W3 = 640;
      var sizes = nn.sizes, nL = sizes.length, MAX_N = 16;
      var PAD_X = Math.max(48, W3 * 0.07), PAD_TOP = 26, PAD_BOT = 34;
      var maxShown = 1;
      for (var l = 0; l < nL; l++) maxShown = Math.max(maxShown, Math.min(sizes[l], MAX_N));
      var gap = 30, R = Math.max(6, Math.min(gap * 0.36, 16));
      var H3 = Math.max(200, Math.round(PAD_TOP + PAD_BOT + (maxShown-1)*gap));
      nc.width = Math.round(W3 * dpr2); nc.height = Math.round(H3 * dpr2);
      nc.style.width = '100%'; nc.style.height = H3 + 'px';
      var nctx = nc.getContext('2d');
      nctx.setTransform(dpr2, 0, 0, dpr2, 0, 0);
      var bgSoft = cssVar('--bg-soft'), muted = cssVar('--text-muted'), mono = cssVar('--mono');
      var actNeg = parseRGB3(cssVar('--nn-act-neg')), actZero = parseRGB3(cssVar('--nn-act-zero'));
      var actPos = parseRGB3(cssVar('--nn-act-pos')), accRGB = parseRGB3(cssVar('--accent'));
      nctx.fillStyle = bgSoft; nctx.fillRect(0, 0, W3, H3);
      var innerW = W3 - PAD_X * 2, colX = [];
      for (var l = 0; l < nL; l++) colX.push(nL > 1 ? Math.round(PAD_X + innerW * l / (nL-1)) : Math.round(W3/2));
      var INPUT_LABELS3 = ['x', 'ẋ', 'θ', 'θ̇'], OUTPUT_LABELS3 = ['F'];
      function nodeY3(l, i, n) {
        var shown = Math.min(n, MAX_N), totalH = (shown-1)*gap;
        return ((H3 - PAD_BOT + PAD_TOP) / 2 - totalH/2) + i * gap;
      }
      function actAt3(l, i) { return (cache && cache.a && cache.a[l]) ? cache.a[l][i] : 0; }
      function actColor3(t) { return t >= 0 ? mixRGB3(actZero, actPos, t) : mixRGB3(actZero, actNeg, -t); }
      for (var l = 0; l < nL - 1; l++) {
        var ni = sizes[l], no = sizes[l+1], shownI = Math.min(ni, MAX_N), shownO = Math.min(no, MAX_N);
        for (var ii = 0; ii < shownI; ii++) {
          for (var oi = 0; oi < shownO; oi++) {
            var w = nn.W[l][oi*ni+ii], mag = Math.min(Math.abs(w), 1.5)/1.5;
            var alpha = 0.06 + mag * 0.5, c = w >= 0 ? accRGB : actNeg;
            nctx.strokeStyle = 'rgba('+c[0]+','+c[1]+','+c[2]+','+alpha.toFixed(3)+')';
            nctx.lineWidth = 0.5 + mag * 2; nctx.beginPath();
            nctx.moveTo(colX[l]+R, nodeY3(l, ii, ni)); nctx.lineTo(colX[l+1]-R, nodeY3(l+1, oi, no)); nctx.stroke();
          }
        }
      }
      for (var l = 0; l < nL; l++) {
        var n = sizes[l], shown = Math.min(n, MAX_N);
        for (var ii = 0; ii < shown; ii++) {
          var cy = nodeY3(l, ii, n), t = Math.tanh(actAt3(l, ii)), rgb = actColor3(t), glow = Math.abs(t);
          nctx.save();
          if (glow > 0.05) { nctx.shadowColor = 'rgba('+rgb[0]+','+rgb[1]+','+rgb[2]+','+(0.55*glow).toFixed(3)+')'; nctx.shadowBlur = R*1.4*glow; }
          nctx.beginPath(); nctx.arc(colX[l], cy, R, 0, Math.PI*2);
          nctx.fillStyle = 'rgb('+rgb[0]+','+rgb[1]+','+rgb[2]+')'; nctx.fill(); nctx.restore();
          nctx.beginPath(); nctx.arc(colX[l], cy, R, 0, Math.PI*2);
          nctx.strokeStyle = muted; nctx.lineWidth = 1; nctx.stroke();
        }
        var lbl = l === 0 ? 'input' : l === nL-1 ? 'output' : 'hidden '+l;
        nctx.fillStyle = muted; nctx.font = '600 12px '+mono; nctx.textAlign = 'center';
        nctx.fillText(lbl+' ('+n+')', colX[l], H3-12);
        if (l === 0) {
          nctx.font = '11px '+mono; nctx.textAlign = 'right'; nctx.fillStyle = muted;
          for (var k = 0; k < Math.min(n, INPUT_LABELS3.length); k++)
            nctx.fillText(INPUT_LABELS3[k], colX[l]-R-6, nodeY3(l, k, n)+4);
        } else if (l === nL-1) {
          nctx.font = '11px '+mono; nctx.textAlign = 'left'; nctx.fillStyle = muted;
          nctx.fillText(OUTPUT_LABELS3[0], colX[l]+R+6, nodeY3(l, 0, n)+4);
        }
      }
    }

    // ---- Architecture sliders ----
    var nnLayersSlider3  = document.getElementById('sid-nn-layers');
    var nnNeuronsSlider3 = document.getElementById('sid-nn-neurons');
    var nnLayersVal3     = document.getElementById('sid-nn-layers-val');
    var nnNeuronsVal3    = document.getElementById('sid-nn-neurons-val');
    var nnLastCache3     = null;

    if (nnLayersSlider3) nnLayersSlider3.addEventListener('input', function () {
      nnLayers3 = parseInt(nnLayersSlider3.value);
      if (nnLayersVal3) nnLayersVal3.textContent = nnLayers3;
      nnNet3 = initNet3(getLayerSizes3());
      ppoCriticNet = initNet3(getLayerSizes3());
      ppoRewardHist = [];
      if (nnActivateBtn3) { nnActivateBtn3.disabled = true; nnActivateBtn3.textContent = 'Activate Policy'; nnActivateBtn3.classList.remove('active'); }
      if (ppoStatusEl) ppoStatusEl.textContent = 'Architecture changed — retrain';
    });
    if (nnNeuronsSlider3) nnNeuronsSlider3.addEventListener('input', function () {
      nnNeurons3 = parseInt(nnNeuronsSlider3.value);
      if (nnNeuronsVal3) nnNeuronsVal3.textContent = nnNeurons3;
      nnNet3 = initNet3(getLayerSizes3());
      ppoCriticNet = initNet3(getLayerSizes3());
      ppoRewardHist = [];
      if (nnActivateBtn3) { nnActivateBtn3.disabled = true; nnActivateBtn3.textContent = 'Activate Policy'; nnActivateBtn3.classList.remove('active'); }
      if (ppoStatusEl) ppoStatusEl.textContent = 'Architecture changed — retrain';
    });
    nnNet3 = initNet3(getLayerSizes3());
    ppoCriticNet = initNet3(getLayerSizes3());

    // ---- PPO train button ----
    if (ppoBtnEl) ppoBtnEl.addEventListener('click', function () {
      if (ppoTraining) {
        ppoTraining = false;
        if (ppoTrainTimer) { clearTimeout(ppoTrainTimer); ppoTrainTimer = null; }
        ppoBtnEl.textContent = 'Train PPO';
        if (ppoStatusEl) ppoStatusEl.textContent = 'Stopped at update ' + ppoUpdateCount;
        return;
      }
      ppoTraining = true;
      ppoUpdateCount = 0;
      ppoRewardHist = [];
      nnNet3 = initNet3(getLayerSizes3());
      ppoCriticNet = initNet3(getLayerSizes3());
      ppoActorAdam = initAdam3(nnNet3);
      ppoCriticAdam = initAdam3(ppoCriticNet);
      nnActive3 = false;
      if (nnActivateBtn3) { nnActivateBtn3.disabled = true; nnActivateBtn3.textContent = 'Activate Policy'; nnActivateBtn3.classList.remove('active'); }
      ppoBtnEl.textContent = 'Stop Training';
      if (ppoStatusEl) ppoStatusEl.textContent = 'Training…';
      (function trainStep() {
        if (!ppoTraining) return;
        var rollout = collectRollout();
        ppoUpdate(rollout);
        ppoUpdateCount++;
        ppoRewardHist.push(rollout.meanRew);
        drawRewardChart();
        if (ppoStatusEl) ppoStatusEl.textContent =
          'Update ' + ppoUpdateCount + ' / ' + PPO_MAX_UPDATES + ' — avg reward ' + rollout.meanRew.toFixed(1);
        if (ppoUpdateCount >= PPO_MAX_UPDATES) {
          ppoTraining = false;
          ppoBtnEl.textContent = 'Retrain PPO';
          if (ppoStatusEl) ppoStatusEl.textContent = 'Done (' + PPO_MAX_UPDATES + ' updates) — activate to deploy';
          if (nnActivateBtn3) nnActivateBtn3.disabled = false;
          if (nnNetviz3) nnNetviz3.style.display = '';
          return;
        }
        ppoTrainTimer = setTimeout(trainStep, 0);
      })();
    });

    // ---- Activate trained policy ----
    if (nnActivateBtn3) nnActivateBtn3.addEventListener('click', function () {
      if (!nnNet3) return;
      nnActive3 = !nnActive3;
      if (nnActive3) {
        state = [0, 0, Math.PI, 0];
        simStatus3 = 'ok'; simT = 0; uForce = 0;
        ppoEverBalanced = false;
        ppoActivatedSimT = 0;
      }
      nnActivateBtn3.textContent = nnActive3 ? 'Deactivate Policy' : 'Activate Policy';
      nnActivateBtn3.classList.toggle('active', nnActive3);
      if (nnNetviz3) nnNetviz3.style.display = '';
    });

    // Separate RAF loop for NN visualisation
    (function vizLoop() {
      if (nnNet3 && nnNetviz3 && nnNetviz3.style.display !== 'none') {
        nnLastCache3 = fwdNetCP(nnNet3, ppoObs(state));
        drawNetViz3(nnNet3, nnLastCache3);
      }
      requestAnimationFrame(vizLoop);
    })();
  })();

  /* ================================================================
     [Removed: nnDemo race car — NN now lives in sysidDemo above]
  ================================================================ */
  if (false) (function nnDemo() {
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
     [Removed: reactDemo — tab removed from site]
  ================================================================ */
  if (false) (function reactDemo() {
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
