// Controls page — four interactive demos, all driven by the same PID panel.
// Tab switcher, mass-spring-damper, tilt table, nonlinear flight sim, cart-pole.
// Each tab is deep-linkable (/controls/#flight); hidden demos neither step nor draw.
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
  // True when the demo's tab is showing. Hidden demos skip both physics and
  // drawing, so only the visible one costs anything per frame.
  function isActive(sectionId) {
    var sec = document.getElementById(sectionId);
    return !!sec && sec.classList.contains('active');
  }

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

  // Deep links: each tab's hash is its section id minus "sec-" (#tilt, #flight,
  // #cartpole). The first tab is the default, so it clears the hash instead.
  function tabName(tab) { return tab.getAttribute('aria-controls').replace(/^sec-/, ''); }

  function activateFromHash() {
    var want = location.hash.slice(1), idx = 0;
    tabs.forEach(function (t, i) { if (tabName(t) === want) idx = i; });
    activateTab(idx);
  }

  tabs.forEach(function (tab, i) {
    tab.addEventListener('click', function () {
      activateTab(i);
      // replaceState: switching tabs shouldn't pile up Back-button entries.
      history.replaceState(null, '', i === 0
        ? location.pathname + location.search
        : '#' + tabName(tab));
    });
  });
  window.addEventListener('hashchange', activateFromHash);
  activateFromHash();

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

    // Manual mode: drag the mass; a damped virtual spring to the pointer, ±FMAN.
    var FMAN = 10, DRAG_K = 40, DRAG_C = 8, ANIM_SCALE = 80;
    var man = bindManual('msd', canvas, function () {
      forceBuf.length = 0; sim.intE = 0; sim.prevE = 0;
      errRing = []; bestScore = null;
      if (bestEl) bestEl.textContent = '';
    });

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
        if (man.manual) {
          P_t = I_t = D_t = 0;
          F = 0;
          if (man.drag) {
            var xt = clamp((man.drag.y - ANIM_H / 2) / ANIM_SCALE, -1.6, 1.6);
            F = clamp(DRAG_K * (xt - sim.x) - DRAG_C * sim.v, -FMAN, FMAN);
          }
        }
        // Transport delay: the plant feels the command from `delay` ms ago.
        forceBuf.push(F);
        var delaySamples = Math.round((pid.delay / 1000) / DT);
        var Fapplied = (forceBuf.length > delaySamples) ? forceBuf.shift() : 0;
        if (man.manual) { forceBuf.length = 0; Fapplied = F; }
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
        if (!man.manual && (bestScore === null || rmse < bestScore)) {
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
      var scale = ANIM_SCALE;  // 1 m = 80px
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

    function loop() {
      if (isActive('sec-msd')) {
        renderAnim();
        renderPlot();
        drawContribPlot(msdPidCanvas, [
          { label: 'P', color: cssVar('--viz-1'),    data: pidContrib.p },
          { label: 'I', color: cssVar('--viz-2'),    data: pidContrib.i },
          { label: 'D', color: cssVar('--viz-3'),    data: pidContrib.d },
          { label: 'Total', color: cssVar('--viz-total'), data: pidContrib.total }
        ], null, 'F (N)');
      }
      requestAnimationFrame(loop);
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

    // Manual mode: drag a beam end and the beam swings to follow the pointer.
    var MAN_SLEW = 90 * Math.PI / 180;   // rad/s
    var man = bindManual('tilt', canvas, function () {
      pidState.intE = 0; pidState.prevE = 0; delayBuf = [];
      errRing = []; bestRMSE = null;
    });

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
      // Manual runs would muddy a map of how well the PID gains do.
      if (man.manual) { newTrial(); return; }
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
        if (man.manual) {
          // Angle of the beam-centre → pointer line; the tilt holds where it was left.
          if (man.drag) {
            var ddx = man.drag.x - W / 2, ddy = man.drag.y - H * 0.52;
            if (Math.abs(ddx) > W * 0.05) {
              var tgt = clamp(Math.atan(ddy / ddx), -TILT_LIM, TILT_LIM);
              tiltX += clamp(tgt - tiltX, -MAN_SLEW * sdt, MAN_SLEW * sdt);
            }
          }
          var axm = ROLL * g * Math.sin(tiltX) - DAMP * vx;
          vx += axm * sdt;
          bx += vx * sdt;
          continue;
        }
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
    return { V: V0, gamma: 0, alpha: alpha0, q: 0, de: de0, h: 50, x: 0, T: T0 };
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
  var H_CENTER  = 60;   // m — reference altitude centre
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
    var VIEW_RANGE = 100;  // metres of altitude shown — smaller = altitude changes look bigger
    var PLANE_PX   = 78;   // sprite width in px, fixed so zooming doesn't also shrink/grow the plane

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
      var TREE_SPEED = 3;   // 1 = original, 2 = twice as fast
      var scroll  = (downrange * TREE_SPEED) % (spacing * 40);
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
        var dispW = PLANE_PX;
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

      // Horizon sits at h=0 on the altitude scale, so it moves with the plane's altitude
      // (off-canvas once the viewport is above the ground).
      var horizonY = hToY(0, H);

      // Full-canvas sky gradient
      var grad = ctx.createLinearGradient(0, 0, 0, H - GROUND_PX);
      if (isDark) {
        grad.addColorStop(0, '#05090f');
        grad.addColorStop(1, '#0e1e2e');
      } else {
        grad.addColorStop(0, '#b8d4f0');
        grad.addColorStop(1, '#dceef8');
      }
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, Math.min(horizonY, H));

      // Clouds always in upper portion of canvas (sky only)
      drawClouds(W, H - GROUND_PX, downrange, isDark);

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
      var tickStep = 10;
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
     Shared PID panel wiring (flight + cart-pole)
     Binds the standard panel — K_p/K_i/K_d sliders with ± range inputs,
     transport delay and sensor noise — for element ids `<prefix>-kp` etc.
     Returns a live { kp, ki, kd, delay (s), noise } object kept in sync.
  ================================================================ */
  function bindPidPanel(prefix, opts) {
    opts = opts || {};
    var gainDigits = opts.gainDigits != null ? opts.gainDigits : 2;
    var noiseFmt   = opts.noiseFmt || function (v) { return v.toFixed(2); };
    var p = { kp: 0, ki: 0, kd: 0, delay: 0, noise: 0 };
    function el(id) { return document.getElementById(prefix + '-' + id); }
    var GAINS = ['kp', 'ki', 'kd'];
    var delaySl = el('delay'), delayAmt = el('delay-amt'), delayVal = el('delay-val');
    var noiseSl = el('noise'), noiseVal = el('noise-val');

    function sync() {
      GAINS.forEach(function (k) {
        var s = el(k);
        if (!s) return;
        p[k] = parseFloat(s.value) || 0;
        var v = el(k + '-val');
        if (v) v.textContent = p[k].toFixed(gainDigits);
      });
      p.delay = delaySl ? (parseFloat(delaySl.value) || 0) / 1000 : 0;
      p.noise = noiseSl ? (parseFloat(noiseSl.value) || 0) : 0;
      if (delayVal) delayVal.textContent = Math.round(p.delay * 1000) + ' ms';
      if (noiseVal) noiseVal.textContent = noiseFmt(p.noise);
    }

    GAINS.forEach(function (k) {
      var s = el(k), ri = el(k + '-range');
      if (!s) return;
      s.addEventListener('input', sync);
      if (ri) ri.addEventListener('input', function () {
        var r = Math.max(parseFloat(ri.min) || 0.01, parseFloat(ri.value) || 0);
        var prev = parseFloat(s.value);
        s.min = -r; s.max = r; s.step = r / 100;
        s.value = clamp(prev, -r, r);
        sync();
      });
    });
    // Delay slider and its numeric "amount" input stay in sync both ways.
    if (delaySl) delaySl.addEventListener('input', function () {
      if (delayAmt) delayAmt.value = delaySl.value;
      sync();
    });
    if (delaySl && delayAmt) delayAmt.addEventListener('input', function () {
      delaySl.value = clamp(parseFloat(delayAmt.value) || 0, 0, parseFloat(delaySl.max) || 1000);
      sync();
    });
    if (noiseSl) noiseSl.addEventListener('input', sync);
    sync();
    return p;
  }

  /* ================================================================
     Manual mode — shared PID/Manual toggle + pointer drag for a demo canvas.
     Returns a live { manual, drag } object; `drag` is null when idle, else
     { x, y, x0, y0 } in CSS px relative to the canvas (x0/y0 = where it began).
     onChange fires whenever the mode flips, so a demo can flush PID state.
  ================================================================ */
  function bindManual(prefix, canvas, onChange) {
    var m = { manual: false, drag: null };
    var box = document.getElementById(prefix + '-mode');
    var btns = box ? Array.prototype.slice.call(box.querySelectorAll('.mode-btn')) : [];
    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        m.manual = b.dataset.mode === 'manual';
        m.drag = null;
        btns.forEach(function (o) {
          var on = o === b;
          o.classList.toggle('active', on);
          o.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        canvas.style.touchAction = m.manual ? 'none' : '';
        canvas.style.cursor = m.manual ? 'grab' : '';
        if (onChange) onChange(m.manual);
      });
    });
    function at(e) {
      var r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    canvas.addEventListener('pointerdown', function (e) {
      if (!m.manual) return;
      var p = at(e);
      m.drag = { x: p.x, y: p.y, x0: p.x, y0: p.y };
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!m.drag) return;
      var p = at(e);
      m.drag.x = p.x; m.drag.y = p.y;
    });
    function end() { m.drag = null; }
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    window.addEventListener('blur', end);
    return m;
  }

  /* ================================================================
     Demo 2 — Flight Simulator  (PID altitude autopilot)
     PID on altitude error commands elevator to track a sinusoidal
     altitude reference, starting from trim.
  ================================================================ */
  (function flightDemo() {
    var canvas = document.getElementById('flight-canvas');
    if (!canvas) return;
    var renderer = makeFlightRenderer(canvas);
    var pid = bindPidPanel('fl', { gainDigits: 3 });

    var ELEV_MAX_RAD  = deg2rad(15);
    var ELEV_MAX_RATE = deg2rad(40) * FLIGHT_DT;   // actuator slew limit per step

    var state, simT, de_rad, simStatus, pidState, measBuf;
    var errRing = [], RING = 1200, CHIST = 300;
    var pidContrib, stateHist;
    var resetTimer = null, bestRMSE = null;

    // Manual mode: drag up for nose-up elevator, down for nose-down; release = trim.
    var STICK_PX = 90;   // drag distance for full elevator
    var man = bindManual('fl', canvas, function () {
      pidState.intE = 0; pidState.prevE = 0; measBuf = [];
      errRing = []; bestRMSE = null;
      if (bestEl) bestEl.textContent = '';
    });

    var scoreEl     = document.getElementById('fl-score');
    var bestEl      = document.getElementById('fl-best');
    var resetBtn    = document.getElementById('fl-reset');
    var flStatePlot = document.getElementById('fl-state-plot');
    var flPidPlot   = document.getElementById('fl-pid-plot');

    function gaussian() {
      var u = 0, v = 0;
      while (u === 0) u = Math.random();
      while (v === 0) v = Math.random();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }

    function hRefAt(t) { return H_CENTER + REF_AMP * Math.sin(REF_OMEGA * t); }

    function resetSim() {
      if (resetTimer) { clearTimeout(resetTimer); resetTimer = null; }
      state = [TRIM.V, TRIM.gamma, TRIM.alpha, TRIM.q, TRIM.h, TRIM.x];
      simT = 0; de_rad = TRIM.de;
      pidState = { intE: 0, prevE: hRefAt(0) - TRIM.h };
      measBuf = [];
      errRing = [];
      pidContrib = { p: [], i: [], d: [], total: [] };
      stateHist  = { h: [], V: [], alpha_deg: [], gamma_deg: [] };
      simStatus = 'ok'; bestRMSE = null;
      if (bestEl) bestEl.textContent = '';
      renderer.resetViewport();
    }
    resetSim();
    if (resetBtn) resetBtn.addEventListener('click', resetSim);

    function step() {
      if (!document.getElementById('sec-flight').classList.contains('active')) return;
      if (simStatus !== 'ok') return;
      var P_t = 0, I_t = 0, D_t = 0, u_deg = 0;
      for (var i = 0; i < 5; i++) {
        // Controller sees a noisy altitude reading, `delay` seconds old.
        var hMeas = state[4] + (pid.noise > 0 ? pid.noise * gaussian() : 0);
        measBuf.push({ t: simT, v: hMeas });
        while (measBuf.length > 1 && measBuf[0].t < simT - pid.delay) measBuf.shift();
        var e = hRefAt(simT) - measBuf[0].v;
        pidState.intE = clamp(pidState.intE + e * FLIGHT_DT, -200, 200);
        P_t = pid.kp * e;
        I_t = pid.ki * pidState.intE;
        D_t = pid.kd * (e - pidState.prevE) / FLIGHT_DT;
        pidState.prevE = e;
        u_deg = P_t + I_t + D_t;   // nose-up elevator command (°) about trim
        if (man.manual) {
          P_t = I_t = D_t = 0;
          u_deg = man.drag
            ? clamp((man.drag.y0 - man.drag.y) / STICK_PX, -1, 1) * rad2deg(ELEV_MAX_RAD)
            : 0;
        }
        // Cm_δe < 0, so trailing-edge-up (negative) elevator pitches the nose up.
        // Subtracting the command from trim means positive gains climb when low.
        var de_target = clamp(TRIM.de - deg2rad(u_deg), -ELEV_MAX_RAD, ELEV_MAX_RAD);
        de_rad += clamp(de_target - de_rad, -ELEV_MAX_RATE, ELEV_MAX_RATE);
        state = rk4(state, simT, FLIGHT_DT, function (t, s) { return flightDerivatives(t, s, de_rad); });
        simT += FLIGHT_DT;
        var stop = checkStopConditions(state);
        if (stop) {
          simStatus = stop;
          if (!resetTimer) resetTimer = setTimeout(function () { resetTimer = null; resetSim(); }, 2500);
          return;
        }
        errRing.push(Math.pow(hRefAt(simT) - state[4], 2));
        if (errRing.length > RING) errRing.shift();
      }
      pidContrib.p.push(P_t); pidContrib.i.push(I_t); pidContrib.d.push(D_t); pidContrib.total.push(u_deg);
      if (pidContrib.p.length > CHIST) {
        pidContrib.p.shift(); pidContrib.i.shift(); pidContrib.d.shift(); pidContrib.total.shift();
      }
      stateHist.h.push(state[4]); stateHist.V.push(state[0]);
      stateHist.alpha_deg.push(rad2deg(state[2])); stateHist.gamma_deg.push(rad2deg(state[1]));
      if (stateHist.h.length > CHIST) {
        stateHist.h.shift(); stateHist.V.shift(); stateHist.alpha_deg.shift(); stateHist.gamma_deg.shift();
      }
      if (scoreEl && errRing.length > 0) {
        var rmse = Math.sqrt(errRing.reduce(function (a, b) { return a + b; }, 0) / errRing.length);
        scoreEl.textContent = rmse.toFixed(1);
        if (!man.manual && (bestRMSE === null || rmse < bestRMSE)) {
          bestRMSE = rmse;
          if (bestEl) bestEl.textContent = 'Best: ' + rmse.toFixed(1) + ' m';
        }
      }
    }

    setInterval(step, 25);

    function loop() {
      if (isActive('sec-flight')) {
        renderer.render(state, simT, de_rad, simStatus);
        drawStatePlot(flStatePlot, stateHist);
        drawContribPlot(flPidPlot, [
          { label: 'P',     color: cssVar('--viz-1'),     data: pidContrib.p },
          { label: 'I',     color: cssVar('--viz-2'),     data: pidContrib.i },
          { label: 'D',     color: cssVar('--viz-3'),     data: pidContrib.d },
          { label: 'Total', color: cssVar('--viz-total'), data: pidContrib.total }
        ], rad2deg(ELEV_MAX_RAD), 'δe cmd (°)');
      }
      requestAnimationFrame(loop);
    }
    loop();
  })();

  /* ================================================================
     Demo 3 — Cart-Pole PID
     One PID loop on the pole angle θ commands the cart force F. Each
     trial starts with the pole upright plus a small random tilt. Angle
     feedback alone can't also hold the cart's position, so the track is
     unbounded and the camera follows the cart; a trial ends only when
     the pole falls.
  ================================================================ */
  (function cartPoleDemo() {
    var canvas = document.getElementById('cp-canvas');
    if (!canvas) return;
    var pid = bindPidPanel('cp', { noiseFmt: function (v) { return v.toFixed(2) + '°'; } });

    /* ---- Cart-pole plant ----
       state = [x, ẋ, θ, θ̇]  (m, m/s, rad, rad/s); θ measured from straight up,
       positive = leaning right. Control u = horizontal force F (N) on the cart.
       Upright θ = 0 is an UNSTABLE equilibrium — the whole point of the demo. */
    var M_CART = 0.4, M_POLE = 0.4, L_POLE = 0.9;
    var G = 9.81, TOTAL_M = M_CART + M_POLE, PML = M_POLE * L_POLE;
    var CART_FRICTION = 1.2;       // N·s/m viscous cart damping
    var FMAX = 10;                 // N — actuator saturation
    var PUSH_F = 4;                // N — arrow-key nudge (added after saturation)
    var CP_DT = 0.005, SUBSTEPS = 5;
    var FALL_ANGLE = deg2rad(45);
    var TILT0_MIN = deg2rad(1), TILT0_MAX = deg2rad(4);

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

    var state, simT, uForce, simStatus, pidState, forceBuf;
    var keyForce = 0, resetTimer = null;
    // RMS θ over the last 10 s; "best" only counts once a full window stayed up.
    var errRing = [], RING = 400, CHIST = 300, bestRMS = null;
    var stateHist, pidContrib;

    // Manual mode: drag the cart; a damped virtual spring to the pointer, ±FMAX.
    // `view` is refreshed by the renderer so pointer px map to track metres.
    var DRAG_K = 30, DRAG_C = 8;
    var view = { cx: 360, scale: 60, camX: 0 };
    var man = bindManual('cp', canvas, function () {
      pidState = { intE: 0, prevE: state[2] }; forceBuf = [];
      errRing = []; bestRMS = null;
      if (bestEl) bestEl.textContent = '';
    });

    var scoreEl    = document.getElementById('cp-score');
    var bestEl     = document.getElementById('cp-best');
    var resetBtn   = document.getElementById('cp-reset');
    var cpStatePlot = document.getElementById('cp-state-plot');
    var cpPidPlot   = document.getElementById('cp-pid-plot');

    var CP_STATE_SPEC = [
      { key: 'x',   label: 'x (m)',    color: cssVar('--viz-1') },
      { key: 'xd',  label: 'ẋ (m/s)',  color: cssVar('--viz-2') },
      { key: 'th',  label: 'θ (°)',    color: cssVar('--viz-3') },
      { key: 'thd', label: 'θ̇ (°/s)',  color: cssVar('--viz-4') }
    ];

    // New trial: pole upright with a small random tilt, cart at rest.
    function newTrial() {
      if (resetTimer) { clearTimeout(resetTimer); resetTimer = null; }
      var tilt = (Math.random() < 0.5 ? -1 : 1) * (TILT0_MIN + Math.random() * (TILT0_MAX - TILT0_MIN));
      state = [0, 0, tilt, 0];
      simT = 0; uForce = 0;
      pidState = { intE: 0, prevE: tilt };
      forceBuf = [];
      errRing = [];
      stateHist  = { x: [], xd: [], th: [], thd: [] };
      pidContrib = { p: [], i: [], d: [], total: [] };
      simStatus = 'ok';
    }
    newTrial();

    if (resetBtn) resetBtn.addEventListener('click', function () {
      bestRMS = null;
      if (bestEl) bestEl.textContent = '';
      if (scoreEl) scoreEl.textContent = '—';
      newTrial();
    });

    document.addEventListener('keydown', function (e) {
      var sec = document.getElementById('sec-cartpole');
      if (!sec || !sec.classList.contains('active')) return;
      if (e.key === 'ArrowLeft')  { keyForce = -PUSH_F; e.preventDefault(); }
      if (e.key === 'ArrowRight') { keyForce =  PUSH_F; e.preventDefault(); }
    });
    document.addEventListener('keyup', function (e) {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') keyForce = 0;
    });

    function step() {
      if (!document.getElementById('sec-cartpole').classList.contains('active')) return;
      if (simStatus !== 'ok') return;
      var P_t = 0, I_t = 0, D_t = 0, cmd = 0;
      var delaySamples = Math.round(pid.delay / CP_DT);
      for (var i = 0; i < SUBSTEPS; i++) {
        // Controller sees a noisy angle; the reference is upright (θ = 0), so the
        // error is just the measured tilt. Positive gains push the cart under the pole.
        var e = state[2] + (pid.noise > 0 ? deg2rad(pid.noise) * gaussian() : 0);
        pidState.intE = clamp(pidState.intE + e * CP_DT, -2, 2);
        P_t = pid.kp * e;
        I_t = pid.ki * pidState.intE;
        D_t = pid.kd * (e - pidState.prevE) / CP_DT;
        pidState.prevE = e;
        cmd = clamp(P_t + I_t + D_t, -FMAX, FMAX);
        if (man.manual) {
          P_t = I_t = D_t = 0;
          cmd = 0;
          if (man.drag) {
            var xt = view.camX + (man.drag.x - view.cx) / view.scale;
            cmd = clamp(DRAG_K * (xt - state[0]) - DRAG_C * state[1], -FMAX, FMAX);
          }
        }
        // Transport delay: the cart feels the command from `delay` seconds ago.
        forceBuf.push(cmd);
        var Fapplied = (forceBuf.length > delaySamples) ? forceBuf.shift() : 0;
        if (man.manual) { forceBuf.length = 0; Fapplied = cmd; }
        uForce = Fapplied + keyForce;
        state = rk4(state, simT, CP_DT, function (t, s) { return cpDeriv(t, s, uForce); });
        simT += CP_DT;
      }

      if (Math.abs(state[2]) > FALL_ANGLE) {
        simStatus = 'fell';
        if (!resetTimer) resetTimer = setTimeout(function () { resetTimer = null; newTrial(); }, 1500);
        return;
      }

      stateHist.x.push(state[0]); stateHist.xd.push(state[1]);
      stateHist.th.push(rad2deg(state[2])); stateHist.thd.push(rad2deg(state[3]));
      if (stateHist.x.length > CHIST) {
        stateHist.x.shift(); stateHist.xd.shift(); stateHist.th.shift(); stateHist.thd.shift();
      }
      pidContrib.p.push(P_t); pidContrib.i.push(I_t); pidContrib.d.push(D_t); pidContrib.total.push(cmd);
      if (pidContrib.p.length > CHIST) {
        pidContrib.p.shift(); pidContrib.i.shift(); pidContrib.d.shift(); pidContrib.total.shift();
      }

      errRing.push(Math.pow(rad2deg(state[2]), 2));
      if (errRing.length > RING) errRing.shift();
      var rms = Math.sqrt(errRing.reduce(function (a, b) { return a + b; }, 0) / errRing.length);
      if (scoreEl) scoreEl.textContent = rms.toFixed(2);
      if (!man.manual && errRing.length === RING && (bestRMS === null || rms < bestRMS)) {
        bestRMS = rms;
        if (bestEl) bestEl.textContent = 'Best: ' + rms.toFixed(2) + '°';
      }
    }

    setInterval(step, 25);

    // ---- Renderer: camera follows the cart along an unbounded track ----
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
      var scale = clamp(W * 0.09, 40, 70);   // px per metre
      var cx = W / 2;
      var camX = state[0];
      view.cx = cx; view.scale = scale; view.camX = camX;
      function sx(xm) { return cx + (xm - camX) * scale; }

      // Track + scrolling metre ticks
      ctx.strokeStyle = border; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, trackY); ctx.lineTo(W, trackY); ctx.stroke();
      ctx.fillStyle = muted; ctx.font = '10px ' + mono; ctx.textAlign = 'center';
      ctx.lineWidth = 1;
      var halfSpan = cx / scale + 1;
      for (var m = Math.ceil((camX - halfSpan) * 2) / 2; m <= camX + halfSpan; m += 0.5) {
        var tx = sx(m), whole = Math.abs(m - Math.round(m)) < 1e-6;
        ctx.strokeStyle = whole ? muted : border;
        ctx.beginPath(); ctx.moveTo(tx, trackY); ctx.lineTo(tx, trackY + (whole ? 10 : 5)); ctx.stroke();
        if (whole) ctx.fillText(Math.round(m) + ' m', tx, trackY + 24);
      }

      var cartX = sx(state[0]);
      var cartW = 60, cartH = 26;

      if (Math.abs(uForce) > 0.2) {
        var fl = clamp(uForce / FMAX, -1.5, 1.5) * 46;
        ctx.strokeStyle = poleColor; ctx.fillStyle = poleColor; ctx.lineWidth = 3;
        var ay = trackY + 44;
        ctx.beginPath(); ctx.moveTo(cartX, ay); ctx.lineTo(cartX + fl, ay); ctx.stroke();
        var fsign = fl >= 0 ? 1 : -1;
        ctx.beginPath();
        ctx.moveTo(cartX + fl, ay); ctx.lineTo(cartX + fl - 7*fsign, ay - 4);
        ctx.lineTo(cartX + fl - 7*fsign, ay + 4); ctx.closePath(); ctx.fill();
        ctx.fillStyle = muted; ctx.font = '10px ' + mono; ctx.textAlign = 'center';
        ctx.fillText('F = ' + uForce.toFixed(1) + ' N', cartX, ay + 18);
      }

      ctx.fillStyle = accent;
      ctx.beginPath(); ctx.roundRect(cartX - cartW/2, trackY - cartH, cartW, cartH, 5); ctx.fill();
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.arc(cartX - cartW/4, trackY, 5, 0, 2*Math.PI); ctx.fill();
      ctx.beginPath(); ctx.arc(cartX + cartW/4, trackY, 5, 0, 2*Math.PI); ctx.fill();

      // Upright reference (dashed)
      var pivotX = cartX, pivotY = trackY - cartH;
      var poleLenPx = L_POLE * 2 * scale * 0.9;
      ctx.strokeStyle = accent; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.moveTo(pivotX, pivotY); ctx.lineTo(pivotX, pivotY - poleLenPx - 16); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;

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
      if (simStatus === 'fell')                   { label = 'Pole fell — new trial…'; col = poleColor; }
      else if (man.manual)                        { label = 'Manual · up ' + simT.toFixed(1) + ' s'; col = accent; }
      else if (!pid.kp && !pid.ki && !pid.kd)     { label = 'No control — raise Kp to catch the pole'; col = muted; }
      else                                        { label = 'PID balancing · up ' + simT.toFixed(1) + ' s'; col = accent; }
      ctx.fillStyle = col; ctx.fillText(label, 18, 26);
      ctx.fillStyle = muted; ctx.font = '11px ' + mono;
      ctx.fillText('θ = ' + rad2deg(state[2]).toFixed(1) + '°   x = ' + state[0].toFixed(2) + ' m   ←→ to push', 18, 44);
    }

    function loop() {
      if (isActive('sec-cartpole')) {
        drawCartPole();
        drawStatePlot(cpStatePlot, stateHist, CP_STATE_SPEC);
        drawContribPlot(cpPidPlot, [
          { label: 'P',     color: cssVar('--viz-1'),     data: pidContrib.p },
          { label: 'I',     color: cssVar('--viz-2'),     data: pidContrib.i },
          { label: 'D',     color: cssVar('--viz-3'),     data: pidContrib.d },
          { label: 'Total', color: cssVar('--viz-total'), data: pidContrib.total }
        ], FMAX, 'F (N)');
      }
      requestAnimationFrame(loop);
    }
    loop();
  })();

})();
