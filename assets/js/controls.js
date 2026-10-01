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

  function isDarkTheme() {
    var t = document.documentElement.getAttribute('data-theme');
    return t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  // Reference signal shared by every demo: a wave (sine), or a square wave of the same
  // period that jumps to the opposite value every half period.
  function refValue(type, t, amp, omega) {
    var s = Math.sin(omega * t);
    return type === 'step' ? amp * (s >= 0 ? 1 : -1) : amp * s;
  }

  // d/dt of refValue: the reference's own velocity (zero between the jumps of a Step).
  function refRate(type, t, amp, omega) {
    return type === 'step' ? 0 : amp * omega * Math.cos(omega * t);
  }

  // Binds the "Reference: Wave | Step" toggle (#<prefix>-ref). Returns a live { type }
  // (the optional `target` object is updated in place, for state shared with a renderer).
  function bindRefToggle(prefix, onChange, target) {
    var ref = target || { type: 'wave' };
    var box = document.getElementById(prefix + '-ref');
    var btns = box ? Array.prototype.slice.call(box.querySelectorAll('.mode-btn')) : [];
    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        ref.type = b.dataset.ref === 'step' ? 'step' : 'wave';
        btns.forEach(function (o) {
          var on = o === b;
          o.classList.toggle('active', on);
          o.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        if (onChange) onChange(ref.type);
      });
    });
    return ref;
  }

  // '#rrggbb' + alpha -> 'rgba(...)' (falls back to the colour unchanged).
  function withAlpha(color, a) {
    var m = /^#([0-9a-f]{6})$/i.exec(color);
    if (!m) return color;
    var n = parseInt(m[1], 16);
    return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  // Cap a score readout: unstable runs would otherwise show absurd RMSE values.
  var SCORE_CAP = 100;
  function capScore(v) { return Math.min(v, SCORE_CAP); }
  // Tracking errors are clipped to +-ERR_CLIP so P, I and D (and the integrator) can't blow up.
  var ERR_CLIP = 100;
  function clipErr(e) { return clamp(e, -ERR_CLIP, ERR_CLIP); }

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
    var sim = { x: 0, v: 0, t: 0, intE: 0, prevE: 0, prevM: 0 };

    // PID gains + disturbances (from sliders)
    var pid = { kp: 0, ki: 0, kd: 0, delay: 0, noise: 0 };

    // Reference: a wave (sine), or a square wave of the same period (Step).
    var refSel = bindRefToggle('msd', function () {
      sim.prevE = 0; sim.prevM = sim.x; sim.intE = 0;
      errRing = []; bestScore = null;
      if (bestEl) bestEl.textContent = '';
    });

    // Transport-delay buffer: commanded forces awaiting application
    var forceBuf = [];

    // Manual mode: drag the mass; a damped virtual spring to the pointer, ±FMAN.
    var FMAN = 10, DRAG_K = 40, DRAG_C = 8, ANIM_SCALE = 80;
    var man = bindManual('msd', canvas, function () {
      forceBuf.length = 0; sim.intE = 0; sim.prevE = 0; sim.prevM = 0;
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

    // State plot history (same length as the PID plot's).
    var stateHist = { x: [], xd: [], e: [], F: [] };

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
      sim.intE = 0; sim.prevE = 0; sim.prevM = 0;
      errRing = [];
      forceBuf.length = 0;
      stateHist = { x: [], xd: [], e: [], F: [] };
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
        var ref = refValue(refSel.type, sim.t, AMP_REF, OMEGA_REF);
        // Controller sees a noisy measurement of position, not the true state.
        var xMeas = sim.x + (pid.noise > 0 ? gaussian() * pid.noise : 0);
        var e   = clipErr(ref - xMeas);
        sim.intE  = clamp(sim.intE + e * DT, -20, 20);
        // Sine: derivative of the error. Step: the reference jumps, so differentiate the
        // measurement alone (otherwise D spikes on every jump).
        var de  = refSel.type === 'step' ? -(xMeas - sim.prevM) / DT : (e - sim.prevE) / DT;
        sim.prevM = xMeas;
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
        // `while`, not `if`: when the delay is lowered the buffer must shrink too.
        var Fapplied = 0;
        while (forceBuf.length > delaySamples) Fapplied = forceBuf.shift();
        if (man.manual) { forceBuf.length = 0; Fapplied = F; }
        // Fapplied is constant over this step (zero-order hold on control)
        var s = rk4([sim.x, sim.v], sim.t, DT, function (t2, s2) {
          return [s2[1], (Fapplied - C_damp * s2[1] - K_spring * s2[0]) / M];
        });
        sim.x = s[0]; sim.v = s[1];
        sim.F = Fapplied;
        sim.t += DT;
        var err = clipErr(ref - sim.x);
        errRing.push(err * err);
        if (errRing.length > RING) errRing.shift();
      }
      // History for plot
      var refNow = refValue(refSel.type, sim.t, AMP_REF, OMEGA_REF);
      // PID contribution + state history
      pidContrib.p.push(P_t); pidContrib.i.push(I_t); pidContrib.d.push(D_t); pidContrib.total.push(F);
      stateHist.x.push(sim.x); stateHist.xd.push(sim.v);
      stateHist.e.push(refNow - sim.x); stateHist.F.push(sim.F || 0);
      if (pidContrib.p.length > CHIST) {
        pidContrib.p.shift(); pidContrib.i.shift(); pidContrib.d.shift(); pidContrib.total.shift();
      }
      if (stateHist.x.length > CHIST) {
        stateHist.x.shift(); stateHist.xd.shift(); stateHist.e.shift(); stateHist.F.shift();
      }
      // Score
      if (errRing.length > 0) {
        var rmse = capScore(Math.sqrt(errRing.reduce(function (a, b) { return a + b; }, 0) / errRing.length));
        scoreEl.textContent = rmse.toFixed(3);
        // Only a full window counts: right after a reset the error is ~0 and would stick.
        if (!man.manual && errRing.length === RING && (bestScore === null || rmse < bestScore)) {
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
    var ANIM_H = 320;   // refreshed from the CSS layout on resize

    // Size the pixel buffer to the CSS box (the layout sets both dimensions).
    function sizeOne(cv, cx2) {
      var w = cv.clientWidth || 200, h = cv.clientHeight || 320;
      cv.width  = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      cx2.setTransform(dpr, 0, 0, dpr, 0, 0);
      return h;
    }
    function resizeCanvas() {
      ANIM_H = sizeOne(canvas, ctx);
    }
    var wrapEl = canvas.closest('.sim-canvas-wrap') || canvas.parentElement;
    new ResizeObserver(resizeCanvas).observe(wrapEl);
    resizeCanvas();

    // === Compact spring-mass animation (left) ===
    // Colors follow the entity across both canvases: the mass and its trace are
    // --viz-7, the reference is the accent (dashed), and the control force arrow
    // is --viz-total like the "Total" line in the PID contribution plot below.
    function renderAnim() {
      var W = canvas.clientWidth, H = ANIM_H;
      if (!W) return;
      ctx.clearRect(0, 0, W, H);

      var mutedColor  = cssVar('--text-muted');
      var accentColor = cssVar('--accent');
      var strongColor = cssVar('--border-strong');
      var bgSoft      = cssVar('--bg-soft');
      var massColor   = cssVar('--viz-7');
      var forceColor  = cssVar('--viz-total');

      // The rig sits left of centre, like the plane: the reference path runs through it,
      // with the future ahead (right) and a fading tail behind (left).
      var cx = clamp(W * 0.35, 110, 300);
      var anchorY = 26;
      var massH = 42, massW = 54;
      var scale = ANIM_SCALE;  // 1 m = 80px
      var massY = H / 2 + sim.x * scale;
      var massTop = massY - massH / 2;
      var refNow = refValue(refSel.type, sim.t, AMP_REF, OMEGA_REF);
      var refY  = H / 2 + refNow * scale;
      var springX = cx - 13, damperX = cx + 14;

      // Reference path, drawn like the plane's: a faint dashed guide ahead, a fading tail
      // behind, and a soft dot where the reference is right now.
      var LOOK = 8;                                        // s of future shown
      var pxPerSec = Math.max(20, (W - 16 - cx) / LOOK);
      function refPy(tt) { return H / 2 + refValue(refSel.type, tt, AMP_REF, OMEGA_REF) * scale; }
      ctx.save();
      ctx.globalAlpha = 0.32; ctx.strokeStyle = accentColor; ctx.lineWidth = 1.2; ctx.setLineDash([8, 5]);
      ctx.beginPath();
      for (var fx = cx; fx <= W; fx += 3) {
        var fy = refPy(sim.t + (fx - cx) / pxPerSec);
        if (fx === cx) ctx.moveTo(fx, fy); else ctx.lineTo(fx, fy);
      }
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = accentColor; ctx.lineCap = 'round';
      for (var tx = cx; tx > 6; tx -= 3) {
        var tauA = (cx - tx) / pxPerSec, tauB = (cx - tx + 3) / pxPerSec;
        if (tauB > sim.t) break;                           // nothing happened before t = 0
        var age = (cx - tx) / cx;
        if (age >= 1) break;
        ctx.globalAlpha = Math.max(0, 1 - age);
        ctx.lineWidth = 0.5 + 2.2 * (1 - age);
        ctx.beginPath(); ctx.moveTo(tx, refPy(sim.t - tauA)); ctx.lineTo(tx - 3, refPy(sim.t - tauB)); ctx.stroke();
      }
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = 0.35; ctx.fillStyle = accentColor;
      ctx.beginPath(); ctx.arc(cx, refY, 9, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      // Anchor bar
      ctx.fillStyle = mutedColor;
      ctx.fillRect(cx - 36, anchorY - 8, 72, 8);

      // Spring
      ctx.strokeStyle = mutedColor;
      ctx.lineWidth = 1.5;
      drawSpring(ctx, springX, anchorY, springX, massTop, 7);

      // Damper: a cylinder hung from the anchor, a piston rod up from the mass.
      var cylH = 46, cylW = 14;
      ctx.fillStyle = bgSoft;
      ctx.strokeStyle = strongColor;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(damperX, anchorY); ctx.lineTo(damperX, anchorY + 6);
      ctx.stroke();
      ctx.fillRect(damperX - cylW / 2, anchorY + 6, cylW, cylH);
      ctx.beginPath();
      ctx.moveTo(damperX - cylW / 2, anchorY + 6); ctx.lineTo(damperX - cylW / 2, anchorY + 6 + cylH);
      ctx.moveTo(damperX + cylW / 2, anchorY + 6); ctx.lineTo(damperX + cylW / 2, anchorY + 6 + cylH);
      ctx.moveTo(damperX - cylW / 2, anchorY + 6); ctx.lineTo(damperX + cylW / 2, anchorY + 6);
      ctx.stroke();
      var pistonY = clamp(massTop - 36, anchorY + 10, anchorY + 2 + cylH);
      ctx.strokeStyle = mutedColor;
      ctx.beginPath();
      ctx.moveTo(damperX, pistonY); ctx.lineTo(damperX, massTop);
      ctx.moveTo(damperX - cylW / 2 + 2, pistonY); ctx.lineTo(damperX + cylW / 2 - 2, pistonY);
      ctx.stroke();

      // Mass block
      ctx.fillStyle = massColor;
      ctx.beginPath();
      ctx.roundRect(cx - massW / 2, massTop, massW, massH, 6);
      ctx.fill();

      // "m" label on mass: the page background reads on the violet in both themes.
      ctx.fillStyle = cssVar('--bg');
      ctx.font = '600 13px ' + cssVar('--font');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('m', cx, massY);

      // Control force on the mass (positive F pushes down, like positive x).
      var F = sim.F || 0;
      if (Math.abs(F) > 0.05) {
        var len = 46 * Math.tanh(Math.abs(F) / 4), dir = F > 0 ? 1 : -1;
        var ax = cx + massW / 2 + 12, ay0 = massY, ay1 = massY + dir * len;
        ctx.strokeStyle = forceColor; ctx.fillStyle = forceColor; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(ax, ay0); ctx.lineTo(ax, ay1 - dir * 5); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(ax, ay1); ctx.lineTo(ax - 5, ay1 - dir * 7); ctx.lineTo(ax + 5, ay1 - dir * 7);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = mutedColor;
        ctx.font = '10px ' + cssVar('--mono');
        ctx.textAlign = 'left';
        ctx.fillText('F', ax + 7, massY);
      }

      // State box, lower right (same panel as the flight sim)
      drawStateBox(ctx, W, H, [
        { label: 'x',   value: sim.x, decimals: 2, unit: 'm' },
        { label: 'ẋ',   value: sim.v, decimals: 2, unit: 'm/s' },
        { label: 'ref', value: refNow, decimals: 2, unit: 'm' },
        { label: 'F',   value: F, decimals: 1, unit: 'N' }
      ]);
    }

    var stepTimer = setInterval(function () {
      if (document.getElementById('sec-msd').classList.contains('active')) step();
    }, 25);

    var msdPidCanvas = document.getElementById('msd-pid-plot');
    var msdStatePlot = document.getElementById('msd-state-plot');
    var MSD_STATE_SPEC = [
      { key: 'x',  label: 'x (m)',   token: '--viz-7' },
      { key: 'xd', label: 'ẋ (m/s)', token: '--viz-1' },
      { key: 'e',  label: 'e (m)',   token: '--viz-2' },
      { key: 'F',  label: 'F (N)',   token: '--viz-total' }
    ];

    function loop() {
      if (isActive('sec-msd')) {
        renderAnim();
        drawStatePlot(msdStatePlot, stateHist, MSD_STATE_SPEC);
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
     Demo 1.5 — Tilt Table 2-D: PID beam balancing
     Ball starts in the inner half of the beam with a small random velocity;
     table starts flat. Each trial runs until stable or failed, then the next
     starts. The PID output is a *commanded* tilt; a servo slews the beam toward
     it at a limited rate, so the table can't jump to a new angle in one step.
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
    // Servo slew limit (rad/s) for PID and manual alike: a hobby servo through a
    // linkage manages roughly this under load, so a full ±20° swing takes ~0.7 s.
    var SERVO_SLEW = 60 * Math.PI / 180;

    // The ball tracks a reference position along the beam: a sine wave, or a square
    // wave of the same period (Step) that jumps to the opposite side of the beam.
    var REF_AMP_T = 0.5;                    // m
    var REF_OMEGA_T = 2 * Math.PI / 12;     // rad/s: 12 s period

    var falls = 0;            // times the ball rolled off the end

    var bx = 0, vx = 0, tiltX = 0, tiltRate = 0;
    var simT = 0;
    var pidState = { intE: 0, prevE: 0, prevM: 0 };
    var pidGains = { kp: 0, ki: 0, kd: 0 };
    var delayBuf = [];
    var errRing = [], bestRMSE = null;
    var RING = 400;

    // History for the state and PID-contribution plots (one sample per frame).
    var CHIST = 300;
    var stateHist = { x: [], xd: [], th: [], thd: [] };
    var pidContrib = { p: [], i: [], d: [], total: [] };
    var pidLast = { p: 0, i: 0, d: 0, total: 0 };
    var stateSpec = [
      { key: 'x',   label: 'x (m)',    token: '--viz-1' },
      { key: 'xd',  label: 'ẋ (m/s)',  token: '--viz-2' },
      { key: 'th',  label: 'θ (°)',    token: '--viz-3' },
      { key: 'thd', label: 'θ̇ (°/s)',  token: '--viz-4' }
    ];
    var statePlot = document.getElementById('tilt-state-plot');
    var pidPlot   = document.getElementById('tilt-pid-plot');

    // Manual mode: drag a beam end and the beam swings to follow the pointer.
    var man = bindManual('tilt', canvas, function () {
      pidState.intE = 0; pidState.prevE = 0; pidState.prevM = bx; delayBuf = [];
      errRing = []; bestRMSE = null;
    });
    var refSel = bindRefToggle('tilt', function () {
      pidState.intE = 0; pidState.prevE = 0; pidState.prevM = bx;
      errRing = []; bestRMSE = null;
      var bestEl0 = document.getElementById('tilt-best');
      if (bestEl0) bestEl0.textContent = '';
    });

    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var W = 700, H = 300;

    function resizeCanvas() {
      W = canvas.clientWidth || 700;       // the layout sets the canvas box
      H = canvas.clientHeight || 300;
      canvas.width  = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
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

    // Start (or restart) a run: ball at rest in the middle, reference clock at zero.
    function restart() {
      bx = 0; vx = 0; tiltX = 0; tiltRate = 0;
      pidState.intE = 0; pidState.prevE = 0; pidState.prevM = 0;
      delayBuf = [];
      simT = 0;
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

      var tilt0 = tiltX;
      for (var i = 0; i < SUBS; i++) {
        if (man.manual) {
          // Angle of the beam-centre → pointer line; the tilt holds where it was left.
          if (man.drag) {
            var ddx = man.drag.x - W / 2, ddy = man.drag.y - H * 0.52;
            if (Math.abs(ddx) > W * 0.05) {
              var tgt = clamp(Math.atan(ddy / ddx), -TILT_LIM, TILT_LIM);
              tiltX += clamp(tgt - tiltX, -SERVO_SLEW * sdt, SERVO_SLEW * sdt);
            }
          }
          var axm = ROLL * g * Math.sin(tiltX) - DAMP * vx;
          vx += axm * sdt;
          bx += vx * sdt;
          continue;
        }
        var bxM = bx + (noise > 0 ? noise * gaussian() : 0);
        var refT = refValue(refSel.type, simT + i * sdt, REF_AMP_T, REF_OMEGA_T);
        var err = clipErr(refT - bxM);
        pidState.intE = clamp(pidState.intE + err * sdt, -2, 2);
        // Sine: derivative of the error. Step: differentiate the measurement alone, so D
        // doesn't spike on each jump of the reference.
        var de = sdt > 0
          ? (refSel.type === 'step' ? -(bxM - pidState.prevM) / sdt : (err - pidState.prevE) / sdt)
          : 0;
        pidState.prevM = bxM;
        pidState.prevE = err;
        var pT = pidGains.kp * err, iT = pidGains.ki * pidState.intE, dT = pidGains.kd * de;
        var cmd = pT + iT + dT;
        pidLast.p = pT; pidLast.i = iT; pidLast.d = dT; pidLast.total = cmd;

        var tNow = simT + i * sdt;
        delayBuf.push({ t: tNow, v: cmd });
        while (delayBuf.length > 1 && delayBuf[0].t < tNow - delay) delayBuf.shift();
        // The servo chases the (delayed, clamped) command at a limited rate.
        var tiltCmd = clamp(delayBuf[0].v, -TILT_LIM, TILT_LIM);
        tiltX += clamp(tiltCmd - tiltX, -SERVO_SLEW * sdt, SERVO_SLEW * sdt);

        // Rolling ball on tilted beam: positive tiltX → right side down → ax > 0
        var ax = ROLL * g * Math.sin(tiltX) - DAMP * vx;
        vx += ax * sdt;
        bx += vx * sdt;
      }

      simT += dt;
      tiltRate = dt > 0 ? (tiltX - tilt0) / dt : 0;
      var trackErr = clipErr(refValue(refSel.type, simT, REF_AMP_T, REF_OMEGA_T) - bx);
      errRing.push(trackErr * trackErr);
      if (errRing.length > RING) errRing.shift();

      stateHist.x.push(bx); stateHist.xd.push(vx);
      stateHist.th.push(tiltX * 180 / Math.PI); stateHist.thd.push(tiltRate * 180 / Math.PI);
      var manNow = man.manual;
      pidContrib.p.push(manNow ? 0 : pidLast.p * 180 / Math.PI);
      pidContrib.i.push(manNow ? 0 : pidLast.i * 180 / Math.PI);
      pidContrib.d.push(manNow ? 0 : pidLast.d * 180 / Math.PI);
      pidContrib.total.push(manNow ? 0 : pidLast.total * 180 / Math.PI);
      if (stateHist.x.length > CHIST) {
        stateHist.x.shift(); stateHist.xd.shift(); stateHist.th.shift(); stateHist.thd.shift();
        pidContrib.p.shift(); pidContrib.i.shift(); pidContrib.d.shift(); pidContrib.total.shift();
      }

      // Rolling off the end restarts the run.
      if (Math.abs(bx) >= T) { falls++; restart(); }
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

      // Reference: a dashed ring on the beam where the ball should be right now
      var refNow = refValue(refSel.type, simT, REF_AMP_T, REF_OMEGA_T);
      var refPx = refNow * scale, refCy = -beamThick / 2 - ballR;
      ctx.save();
      ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]); ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.arc(refPx, refCy, ballR + 3, 0, 2 * Math.PI); ctx.stroke();
      ctx.restore();

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

      // Status (top-left) and the shared state box (lower right)
      var stLabel, stCol = muted;
      if (man.manual)                                    { stLabel = 'Manual - drag a beam end'; stCol = accent; }
      else if (!pidGains.kp && !pidGains.ki && !pidGains.kd) { stLabel = 'No control - raise Kp'; }
      else                                               { stLabel = 'PID tracking'; stCol = accent; }
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.font = '600 13px ' + cssVar('--font'); ctx.fillStyle = stCol;
      ctx.fillText(stLabel, 14, 24);
      ctx.font = '11px ' + cssVar('--mono'); ctx.fillStyle = muted;
      ctx.fillText('t = ' + simT.toFixed(1) + ' s   falls = ' + falls, 14, 42);
      drawStateBox(ctx, W, H, [
        { label: 'x',   value: bx, decimals: 2, unit: 'm' },
        { label: 'ẋ',   value: vx, decimals: 2, unit: 'm/s' },
        { label: 'ref', value: refNow, decimals: 2, unit: 'm' },
        { label: 'θ',   value: tiltX * 180 / Math.PI, decimals: 1, unit: '°' }
      ]);
    }

    var resetBtn = document.getElementById('tilt-reset');
    if (resetBtn) resetBtn.addEventListener('click', function () {
      falls = 0;
      stateHist = { x: [], xd: [], th: [], thd: [] };
      pidContrib = { p: [], i: [], d: [], total: [] };
      errRing = []; bestRMSE = null;
      var bestEl = document.getElementById('tilt-best');
      if (bestEl) bestEl.textContent = '';
      restart();
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
        var rmse = capScore(Math.sqrt(errRing.reduce(function (a, b) { return a + b; }, 0) / errRing.length));
        var scoreEl = document.getElementById('tilt-score');
        if (scoreEl) scoreEl.textContent = rmse.toFixed(3);
        if (!man.manual && errRing.length === RING && (bestRMSE === null || rmse < bestRMSE)) {
          bestRMSE = rmse;
          var bestEl2 = document.getElementById('tilt-best');
          if (bestEl2) bestEl2.textContent = 'Best: ' + rmse.toFixed(3);
        }
      }

      render();
      drawStatePlot(statePlot, stateHist, stateSpec);
      drawContribPlot(pidPlot, [
        { label: 'P',     color: cssVar('--viz-1'),     data: pidContrib.p },
        { label: 'I',     color: cssVar('--viz-2'),     data: pidContrib.i },
        { label: 'D',     color: cssVar('--viz-3'),     data: pidContrib.d },
        { label: 'Total', color: cssVar('--viz-total'), data: pidContrib.total }
      ], TILT_LIM * 180 / Math.PI, 'θ cmd (°)');
      requestAnimationFrame(loop);
    }

    restart();
    requestAnimationFrame(loop);
  })();

  /* ================================================================
     Shared flight physics engine (used by Demo 2 and Demo 3)
  ================================================================ */

  // Cessna sprite — loaded once, white background stripped via pixel manipulation.
  // The plane itself is white, so only near-white pixels connected to the image edge
  // (flood fill) are cleared; the outlined body keeps its paint.
  var cessna = (function () {
    var raw = new Image();
    var processed = null;
    raw.onload = function () {
      var oc = document.createElement('canvas');
      var w = oc.width = raw.naturalWidth;
      var h = oc.height = raw.naturalHeight;
      var oc2d = oc.getContext('2d');
      oc2d.drawImage(raw, 0, 0);
      var id = oc2d.getImageData(0, 0, w, h);
      var d = id.data;
      var seen = new Uint8Array(w * h);
      var stack = [];
      function visit(p) {
        if (seen[p]) return;
        seen[p] = 1;
        var i = p * 4;
        if (d[i] > 235 && d[i+1] > 235 && d[i+2] > 235) { d[i+3] = 0; stack.push(p); }
      }
      for (var x = 0; x < w; x++) { visit(x); visit((h - 1) * w + x); }
      for (var y = 0; y < h; y++) { visit(y * w); visit(y * w + w - 1); }
      while (stack.length) {
        var p = stack.pop(), px = p % w;
        if (px > 0)     visit(p - 1);
        if (px < w - 1) visit(p + 1);
        if (p >= w)     visit(p - w);
        if (p < w * (h - 1)) visit(p + w);
      }
      oc2d.putImageData(id, 0, 0);
      processed = oc;
    };
    // The page passes the URL through relative_url so a non-empty baseurl still resolves.
    var fc = document.getElementById('flight-canvas');
    var src = fc && fc.getAttribute('data-sprite');
    if (src) raw.src = src;
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
    return { V: V0, gamma: 0, alpha: alpha0, q: 0, de: de0, x: 0, T: T0 };
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
  // The band (17–29 m) sits just above the 5–12 m trees and inside the ground-anchored
  // view, so the trees stay on screen while the autopilot tracks.
  var H_CENTER  = 23;   // m — reference altitude centre
  var REF_AMP   = 6;    // m — sine amplitude → 12 m peak-to-peak
  var REF_OMEGA = 2 * Math.PI / 16;  // rad/s — period = 16 s
  var flightRef = { type: 'wave' };  // 'wave' | 'step' (set by the Reference toggle)
  // World scale, px per metre, on BOTH axes: the altitude view, the plane and trees,
  // and the scroll speed of the ground marks, trees and reference path all derive
  // from it, so sizes agree with the altitude labels.
  var PX_PER_M = 8;
  var PLANE_LEN_M = 8.3;   // Cessna 172 overall length

  function makeFlightRenderer(canvas) {
    var ctx = canvas.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);

    function resize() {
      var w = canvas.clientWidth || 720, h = canvas.clientHeight || 380;   // set by the layout
      canvas.width  = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    new ResizeObserver(resize).observe(canvas.parentElement);
    resize();

    // The viewport follows the plane's altitude at PX_PER_M; the bottom GROUND_PX px
    // show the ground strip when the view reaches h = 0.
    var GROUND_PX = 36;
    var PLANE_PX  = PLANE_LEN_M * PX_PER_M;   // sprite width = the plane's true length
    var VIEW_HEADROOM = 3;   // m kept above the plane before the view starts to rise
    var trail = [];        // past {t, x}: where the plane was at each sim time, for the ref tail

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

    // One row of trees. Two rows are drawn: row 0 behind the plane, row 1 in front of
    // it (based a little lower on the ground strip). Both scroll at PX_PER_M, ~10 m
    // apart per row, so ~5 m apart overall.
    function drawTrees(W, horizonY, downrange, isDarkMode, row) {
      var spacing = 10 * PX_PER_M;
      var scroll  = downrange * PX_PER_M;
      var count   = Math.ceil(W / spacing) + 3;
      var base    = Math.floor(scroll / spacing) - 1;
      var k       = row * 101;   // decorrelates the two rows' seeds
      for (var ti = base; ti < base + count; ti++) {
        var sx  = (ti - scroll / spacing) * spacing + seedRand(ti * 7 + 1 + k) * spacing * 0.6;
        // 3–16 m, mid sizes most common (mean of two uniforms), a few very small/large.
        var r   = (seedRand(ti * 13 + 3 + k) + seedRand(ti * 17 + 9 + k)) / 2;
        var ht  = (3 + r * 13) * PX_PER_M;
        var yOff= row ? 8 + seedRand(ti * 11 + 5 + k) * 8 : seedRand(ti * 11 + 5 + k) * 4;
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
      var W = canvas.clientWidth, H = canvas.clientHeight || 380;
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

      // Viewport: as many metres as fit at PX_PER_M, anchored at the ground so the trees
      // stay in view; it only rises if the plane climbs within VIEW_HEADROOM of the top.
      // hToY is rebound each frame so everything else (ref line, ticks, plane) just calls it.
      var VIEW_RANGE = (H - GROUND_PX) / PX_PER_M;
      var viewLo = Math.max(WORLD_LO, Math.min(h + VIEW_HEADROOM - VIEW_RANGE, WORLD_HI - VIEW_RANGE));
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
      var offset = (downrange * PX_PER_M) % markSpacing;
      for (var mx = -offset; mx < W + markSpacing; mx += markSpacing) {
        ctx.beginPath();
        ctx.moveTo(mx, horizonY);
        ctx.lineTo(mx - 20, H);
        ctx.stroke();
      }

      // Trees always visible at horizon
      drawTrees(W, horizonY, downrange, isDark, 0);   // back row; front row after the plane

      // Reference altitude path, drawn in world space at PX_PER_M so it moves with the
      // trees. The reference is a function of time, so each screen x needs a time:
      // LEFT of the plane (past) uses the downrange the plane actually had at each
      // past time (`trail`), so that part is pinned to the ground exactly; RIGHT
      // (future) extrapolates at the current ground speed.
      var planeScreenX = W * 0.35;
      var isFlat = (typeof hRefTarget !== 'undefined');
      var groundSpeed = Math.max(state[0] * Math.cos(gamma), 1);
      function refH(t) { return H_CENTER + refValue(flightRef.type, t, REF_AMP, REF_OMEGA); }
      function xToScreen(xw) { return planeScreenX + (xw - downrange) * PX_PER_M; }
      function refYAt(px) {
        if (isFlat) return hToY(hRefTarget, H);
        return hToY(refH(simT + (px - planeScreenX) / (PX_PER_M * groundSpeed)), H);
      }
      if (!isFlat) {
        var last = trail[trail.length - 1];
        if (last && simT < last.t) trail.length = 0;   // sim was reset
        if (!last || simT > last.t) trail.push({ t: simT, x: downrange });
        // Keep only what's on screen (plus one point past the left edge).
        var xMin = downrange - planeScreenX / PX_PER_M;
        while (trail.length > 2 && trail[1].x < xMin) trail.shift();
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
        for (var ti = trail.length - 1; ti > 0; ti--) {
          var pxA = xToScreen(trail[ti].x), pxB = xToScreen(trail[ti - 1].x);
          var age = (planeScreenX - pxA) / planeScreenX;
          if (age >= 1) break;
          ctx.globalAlpha = Math.max(0, 1 - age);
          ctx.lineWidth = 0.5 + 2.2 * (1 - age);
          ctx.beginPath();
          ctx.moveTo(pxA, hToY(refH(trail[ti].t), H));
          ctx.lineTo(pxB, hToY(refH(trail[ti - 1].t), H));
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
      drawTrees(W, horizonY, downrange, isDark, 1);   // front row passes in front of the plane

      // Altitude scale (left side, clear of the δe bar) — ticks every 10 m
      ctx.fillStyle = mutedColor;
      ctx.font = '11px ' + cssVar('--mono');
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      var tickStep = 10;
      var tickStart = Math.ceil(viewLo / tickStep) * tickStep;
      for (var ah = tickStart; ah <= viewHi; ah += tickStep) {
        var ay = hToY(ah, H);
        if (ay < 12 || ay > H - 12) continue;
        // Pill behind the label so it stays legible over the trees.
        ctx.fillStyle = isDark ? 'rgba(11,15,20,0.72)' : 'rgba(245,246,248,0.82)';
        ctx.beginPath(); ctx.roundRect(4, ay - 8, 38, 16, 4); ctx.fill();
        ctx.fillStyle = mutedColor;
        ctx.fillText(ah + 'm', 8, ay);
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(45, ay);
        ctx.lineTo(55, ay);
        ctx.stroke();
      }

      // Elevator indicator bar (right edge).
      // Shows the nose-up command about trim: Cmde < 0, so de below trim pitches the
      // nose up and the thumb moves UP; centred at trim.
      var eiFrac = clamp(((TRIM.de - de_rad) / deg2rad(15) + 1) / 2, 0, 1);  // 0 = full nose-down, 1 = full nose-up
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

      // Telemetry overlay (bottom-right; the altitude scale owns the left edge)
      drawStateBox(ctx, W, H, [
        { label: 'ref', value: refH(simT), decimals: 1, unit: 'm' },
        { label: 'h',   value: h, decimals: 1, unit: 'm' },
        { label: 'V',   value: V, decimals: 1, unit: 'm/s' },
        { label: 'α',   value: rad2deg(alpha), decimals: 1, unit: '°' },
        { label: 'q',   value: rad2deg(q), decimals: 2, unit: '°/s' }
      ]);

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

    return { render: render, resetViewport: function () { trail.length = 0; } };
  }

  /* ================================================================
     Shared sub-canvas plot utilities
  ================================================================ */

  // Draw a scrolling multi-line time-series on a canvas element.
  // series: [{label, color, data}]  data: rolling array of numbers
  // limitVal: optional ± dotted boundary (in the same units as data)
  // yLabel: optional y-axis title string
  // Hover layer for the time-series canvases. Draw functions read canvas._hoverX
  // (CSS px, or null) every frame and snap it to the nearest sample; the plot's
  // own value labels then show that sample instead of the live one, so the
  // readout never covers the traces and values stay visible without hovering.
  function trackHover(canvas) {
    if (!canvas || canvas._hoverBound) return;
    canvas._hoverBound = true;
    canvas._hoverX = null;
    canvas.style.cursor = 'crosshair';
    canvas.addEventListener('pointermove', function (e) {
      canvas._hoverX = e.clientX - canvas.getBoundingClientRect().left;
    });
    canvas.addEventListener('pointerleave', function () { canvas._hoverX = null; });
  }

  // Nearest sample index (0..n-1, in the plot's shared x frame) under the
  // pointer, or -1 when not hovering the plot area.
  function hoverIndex(canvas, x0, pw, n) {
    var hx = canvas._hoverX;
    if (hx == null || n < 2 || hx < x0 || hx > x0 + pw) return -1;
    return Math.max(0, Math.min(n - 1, Math.round((hx - x0) / (pw / (n - 1)))));
  }

  // Crosshair hairline + a dot with a surface ring on each series at sample k.
  function drawCrosshair(ctx, x, yTop, yBot, dots, surface, muted) {
    ctx.strokeStyle = muted; ctx.globalAlpha = 0.6; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, yTop); ctx.lineTo(x, yBot); ctx.stroke();
    ctx.globalAlpha = 1;
    dots.forEach(function (d) {
      ctx.fillStyle = surface; ctx.beginPath(); ctx.arc(x, d.y, 5, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = d.color; ctx.beginPath(); ctx.arc(x, d.y, 3.5, 0, 2 * Math.PI); ctx.fill();
    });
  }

  function drawContribPlot(canvas, series, limitVal, yLabel) {
    if (!canvas) return;
    trackHover(canvas);
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    // The CSS box sets both dimensions; only the pixel buffer is sized here.
    var W = canvas.clientWidth || 400, H = canvas.clientHeight || 120;
    canvas.width  = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
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

    // Zero axis (solid hairline; dashes are kept for the limit thresholds)
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD_L, yPx(0)); ctx.lineTo(PAD_L + pw, yPx(0)); ctx.stroke();

    // Limit lines
    ctx.setLineDash([3, 3]);
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

    // Crosshair at the hovered sample.
    var hk = hoverIndex(canvas, PAD_L, pw, n);
    function valAt(s2) {
      var j = (hk < 0 ? n - 1 : hk) - (n - s2.data.length);
      return j >= 0 && j < s2.data.length ? s2.data[j] : null;
    }
    if (hk >= 0) {
      drawCrosshair(ctx, PAD_L + hk * pw / Math.max(n - 1, 1), PAD_T, PAD_T + ph,
        series.filter(function (s2) { return valAt(s2) !== null; })
              .map(function (s2) { return { y: yPx(valAt(s2)), color: s2.color }; }),
        bg, muted);
    }

    // Legend (bottom row) doubles as the readout: swatch, muted name, then the
    // value (live, or at the crosshair) in text color.
    var text = cssVar('--text');
    var lx = PAD_L, ly = H - PAD_B / 2 + 1;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '9px ' + mono;
    series.forEach(function(s) {
      var v = valAt(s), vs = v === null ? '-' : v.toFixed(Math.abs(v) < 10 ? 2 : 1);
      ctx.fillStyle = s.color;
      ctx.fillRect(lx, ly - 1.5, 12, 3);
      ctx.fillStyle = muted;
      ctx.fillText(s.label, lx + 16, ly);
      var nw = ctx.measureText(s.label + ' ').width;
      ctx.fillStyle = text;
      ctx.fillText(vs, lx + 16 + nw, ly);
      lx += 16 + nw + ctx.measureText('-00.00').width + 12;
    });
    if (limitVal) {
      ctx.strokeStyle = isDark ? 'rgba(255,180,80,0.7)' : 'rgba(200,140,40,0.8)';
      ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + 12, ly); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = muted;
      ctx.fillText('±' + limitVal.toFixed(0) + ' limit', lx + 16, ly);
    }
  }

  // Draw a stacked state-history plot: one sub-row per state, each on its own
  // auto-scaled y-axis with a direct label + current value.
  // stateHist: an object of arrays keyed by `spec[i].key`.
  // spec (optional): [{key, label, token}] — defaults to the flight states.
  // `token` is a CSS color var, resolved per draw so the theme toggle takes effect.
  function drawStatePlot(canvas, stateHist, spec) {
    if (!canvas) return;
    trackHover(canvas);
    var SERIES = spec || [
      { key: 'h',         label: 'h (m)',   token: '--viz-1' },
      { key: 'V',         label: 'V (m/s)', token: '--viz-2' },
      { key: 'alpha_deg', label: 'α (°)',   token: '--viz-3' },
      { key: 'gamma_deg', label: 'γ (°)',   token: '--viz-4' }
    ];
    var series = SERIES.map(function(s) { return { label: s.label, color: cssVar(s.token), data: stateHist[s.key] || [] }; });
    // Use independent y-scales: normalise each to [-1,1] in a shared space isn't ideal;
    // instead overlay each on its own sub-row within the canvas.
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    // The CSS box sets both dimensions; only the pixel buffer is sized here.
    var W = canvas.clientWidth || 400, H = canvas.clientHeight || 150;
    canvas.width  = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
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

    var PAD_L = 70, PAD_R = 8, PAD_T = 4, PAD_B = 4;
    var rowH = (H - PAD_T - PAD_B) / series.length;
    var pw = W - PAD_L - PAD_R;
    var text = cssVar('--text');
    var hk = hoverIndex(canvas, PAD_L, pw, n), dots = [];

    series.forEach(function(s, si) {
      var yTop = PAD_T + si * rowH;
      var vals = s.data;
      if (!vals.length) return;
      var vMin = Math.min.apply(null, vals), vMax = Math.max.apply(null, vals);
      var vRange = vMax - vMin;
      if (vRange < 0.01) vRange = 1;
      var vMid = (vMin + vMax) / 2;

      // Each row autoscales into the middle 80% of its own band.
      function yPx(v) { return yTop + rowH * (0.5 - 0.4 * (v - vMid) / (vRange * 0.5)); }

      // Row background separator
      if (si > 0) {
        ctx.strokeStyle = border; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(PAD_L, yTop); ctx.lineTo(PAD_L + pw, yTop); ctx.stroke();
      }
      // Mid line (solid hairline)
      ctx.strokeStyle = border; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(PAD_L, yPx(vMid)); ctx.lineTo(PAD_L + pw, yPx(vMid)); ctx.stroke();

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

      // Label (swatch + text-colored name) and value, live or at the crosshair.
      var hj = hk - (n - vals.length);
      var cur = hk >= 0 && hj >= 0 ? vals[hj] : vals[vals.length - 1], mid = yTop + rowH / 2;
      if (hk >= 0 && hj >= 0) dots.push({ y: yPx(cur), color: s.color });
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.font = '9px ' + mono;
      var lw = ctx.measureText(s.label).width;
      ctx.fillStyle = s.color;
      ctx.fillRect(PAD_L - 6 - lw - 12, mid - 6 - 1.5, 8, 3);
      ctx.fillStyle = muted;
      ctx.fillText(s.label, PAD_L - 6, mid - 6);
      ctx.fillStyle = text;
      ctx.fillText(cur.toFixed(Math.abs(cur) < 10 ? 2 : 1), PAD_L - 6, mid + 6);
    });
    if (hk >= 0) drawCrosshair(ctx, PAD_L + hk * pw / Math.max(n - 1, 1), PAD_T, H - PAD_B, dots, bg, muted);
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
    var GAINS = opts.gains || ['kp', 'ki', 'kd'];
    var p = { delay: 0, noise: 0 };
    GAINS.forEach(function (k) { p[k] = 0; });
    function el(id) { return document.getElementById(prefix + '-' + id); }
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
     Hint boxes — a recommended set of gains, revealed once the visitor has
     released a gain slider HINT_ADJUSTMENTS times. "Try it" fills the sliders
     in, switches to the controller, and restarts, without counting as an
     adjustment. Markup: .hint-box[data-prefix][data-gains="kp:40,ki:5,..."].
  ================================================================ */
  var HINT_ADJUSTMENTS = 10;
  function bindHint(box) {
    var prefix = box.dataset.prefix, gains = {};
    (box.dataset.gains || '').split(',').forEach(function (kv) {
      var p = kv.split(':'); if (p.length === 2) gains[p[0]] = parseFloat(p[1]);
    });
    var applyBtn = box.querySelector('.hint-apply');
    var count = 0;
    // The hint stays hidden until the visitor has tried it themselves; once shown it stays.
    function show() { if (count >= HINT_ADJUSTMENTS) box.hidden = false; }
    Object.keys(gains).forEach(function (k) {
      var sl = document.getElementById(prefix + '-' + k);
      // `change` fires once per released drag or key press, not on every pixel of a drag.
      if (sl) sl.addEventListener('change', function () { count++; show(); });
    });
    if (applyBtn) applyBtn.addEventListener('click', function () {
      Object.keys(gains).forEach(function (k) {
        var sl = document.getElementById(prefix + '-' + k), ri = document.getElementById(prefix + '-' + k + '-range');
        if (!sl) return;
        // Only widen the range box when the gain doesn't fit (a wider range coarsens the step).
        if (ri && Math.abs(gains[k]) > parseFloat(ri.value)) { ri.value = Math.ceil(Math.abs(gains[k])); ri.dispatchEvent(new Event('input')); }
        sl.value = gains[k];
        sl.dispatchEvent(new Event('input'));
      });
      var ctl = document.querySelector('#' + prefix + '-mode [data-mode="pid"]');
      if (ctl) ctl.click();
      var rst = document.getElementById(prefix + '-reset');
      if (rst) rst.click();
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll('.hint-box[data-prefix]'), bindHint);

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
    // Start in whichever mode the markup marks active (the demos ship in Manual).
    btns.forEach(function (b) {
      if (b.classList.contains('active') && b.dataset.mode === 'manual') {
        m.manual = true;
        canvas.style.touchAction = 'none';
        canvas.style.cursor = 'grab';
      }
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

    function hRefAt(t) { return H_CENTER + refValue(flightRef.type, t, REF_AMP, REF_OMEGA); }
    var refSel = bindRefToggle('fl', function () {
      if (pidState) { pidState.intE = 0; pidState.prevE = 0; pidState.prevM = state ? state[4] : 0; }
      errRing = []; bestRMSE = null;
      if (bestEl) bestEl.textContent = '';
    }, flightRef);

    function resetSim() {
      if (resetTimer) { clearTimeout(resetTimer); resetTimer = null; }
      state = [TRIM.V, TRIM.gamma, TRIM.alpha, TRIM.q, H_CENTER, TRIM.x];
      simT = 0; de_rad = TRIM.de;
      pidState = { intE: 0, prevE: 0, prevM: H_CENTER };
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
        var e = clipErr(hRefAt(simT) - measBuf[0].v);
        pidState.intE = clamp(pidState.intE + e * FLIGHT_DT, -200, 200);
        P_t = pid.kp * e;
        I_t = pid.ki * pidState.intE;
        // Sine: derivative of the error. Step: differentiate the measurement alone, so D
        // doesn't spike on each jump of the reference.
        D_t = pid.kd * (refSel.type === 'step'
          ? -(measBuf[0].v - pidState.prevM) / FLIGHT_DT
          : (e - pidState.prevE) / FLIGHT_DT);
        pidState.prevM = measBuf[0].v;
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
        errRing.push(Math.pow(clipErr(hRefAt(simT) - state[4]), 2));
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
        var rmse = capScore(Math.sqrt(errRing.reduce(function (a, b) { return a + b; }, 0) / errRing.length));
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
    var pid = bindPidPanel('cp', { gains: ['kx', 'kv', 'kth', 'kw'], gainDigits: 1,
                                   noiseFmt: function (v) { return v.toFixed(2) + '°'; } });

    /* ---- Cart-pole plant ----
       state = [x, ẋ, θ, θ̇]  (m, m/s, rad, rad/s); θ measured from straight up,
       positive = leaning right. Control u = horizontal force F (N) on the cart.
       Upright θ = 0 is an UNSTABLE equilibrium — the whole point of the demo.
       The rail is finite (±X_LIM) and the view is fixed, like the double cart-pole.
       Control law (full-state feedback, the form an LQR design produces):
         F = kx·x + kẋ·ẋ + kθ·θ + kθ̇·θ̇     (= −K·state with the sign flipped, so all gains > 0)
       LQR_GAINS below is the optimal K for Q = diag(1, 0.1, 10, 0.1), R = 0.1 on the
       linearised plant (friction included), found offline with a Riccati solve. */
    var M_CART = 0.3, M_POLE = 0.3, L_POLE = 1.5;   // light cart, long pole: slow enough to balance by hand
    var G = 9.81, TOTAL_M = M_CART + M_POLE, PML = M_POLE * L_POLE;
    var CART_FRICTION = 0.8;       // N·s/m viscous cart damping
    var FMAX = 10;                 // N — actuator saturation
    var CP_DT = 0.005, SUBSTEPS = 5;
    var FALL_ANGLE = deg2rad(45);
    var X_LIM = 4;                 // m — rail ends; running into one ends the trial
    // The cart tracks a position reference: a sine wave, or a square wave of the same
    // period (Step) that jumps to the opposite side of the rail.
    var REF_AMP_C = 1.0;                   // m
    var REF_OMEGA_C = 2 * Math.PI / 12;    // rad/s: 12 s period
    var TILT0_MIN = deg2rad(1), TILT0_MAX = deg2rad(4);
    var LQR_GAINS = { kx: 3.1, kv: 5.9, kth: 43.5, kw: 18.1 };

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

    var state, simT, uForce, simStatus, forceBuf;
    var resetTimer = null;
    // RMS θ over the last 10 s; "best" only counts once a full window stayed up.
    var errRing = [], RING = 400, CHIST = 300, bestRMS = null;
    var stateHist, pidContrib;

    // Manual mode: drag the cart; a damped virtual spring to the pointer, ±FMAX.
    // `view` is refreshed by the renderer so pointer px map to track metres.
    var DRAG_K = 30, DRAG_C = 8;
    var view = { cx: 360, scale: 60, camX: 0 };
    var man = bindManual('cp', canvas, function () {
      forceBuf = [];
      errRing = []; bestRMS = null;
      if (bestEl) bestEl.textContent = '';
    });

    var refSel = bindRefToggle('cp', function () {
      errRing = []; bestRMS = null;
      if (bestEl) bestEl.textContent = '';
    });

    var scoreEl    = document.getElementById('cp-score');
    var bestEl     = document.getElementById('cp-best');
    var resetBtn   = document.getElementById('cp-reset');
    var lqrBtn     = document.getElementById('cp-lqr');
    var cpStatePlot = document.getElementById('cp-state-plot');
    var cpPidPlot   = document.getElementById('cp-pid-plot');

    var CP_STATE_SPEC = [
      { key: 'x',   label: 'x (m)',    token: '--viz-1' },
      { key: 'xd',  label: 'ẋ (m/s)',  token: '--viz-2' },
      { key: 'th',  label: 'θ (°)',    token: '--viz-3' },
      { key: 'thd', label: 'θ̇ (°/s)',  token: '--viz-4' }
    ];

    // New trial: pole upright with a small random tilt, cart at rest.
    function newTrial() {
      if (resetTimer) { clearTimeout(resetTimer); resetTimer = null; }
      var tilt = (Math.random() < 0.5 ? -1 : 1) * (TILT0_MIN + Math.random() * (TILT0_MAX - TILT0_MIN));
      state = [0, 0, tilt, 0];
      simT = 0; uForce = 0;
      forceBuf = [];
      errRing = [];
      stateHist  = { x: [], xd: [], th: [], thd: [] };
      pidContrib = { x: [], v: [], th: [], w: [], total: [] };
      simStatus = 'ok';
    }
    newTrial();

    if (resetBtn) resetBtn.addEventListener('click', function () {
      bestRMS = null;
      if (bestEl) bestEl.textContent = '';
      if (scoreEl) scoreEl.textContent = '-';
      newTrial();
    });

    // Drop the four sliders onto the LQR solution (widening a range box if it is too small).
    if (lqrBtn) lqrBtn.addEventListener('click', function () {
      Object.keys(LQR_GAINS).forEach(function (k) {
        var sl = document.getElementById('cp-' + k), ri = document.getElementById('cp-' + k + '-range');
        if (!sl) return;
        var need = Math.ceil(LQR_GAINS[k] * 1.5);
        if (ri && parseFloat(ri.value) < need) { ri.value = need; ri.dispatchEvent(new Event('input')); }
        sl.value = LQR_GAINS[k];
        sl.dispatchEvent(new Event('input'));
      });
    });

    function step() {
      if (!document.getElementById('sec-cartpole').classList.contains('active')) return;
      if (simStatus !== 'ok') return;
      var cx = 0, cv = 0, cth = 0, cw = 0, cmd = 0, xRef = 0;
      var delaySamples = Math.round(pid.delay / CP_DT);
      for (var i = 0; i < SUBSTEPS; i++) {
        // Full-state feedback. The controller works from noisy *measurements* of all four
        // states (the force and the plant are never noised): the slider sigma is degrees on
        // the angle and centimetres on the cart position, and the two rates carry the same
        // noise per 0.2 s, as if they were differenced from the positions.
        var nz = pid.noise;
        var xMeas  = state[0] + (nz > 0 ? 0.01 * nz * gaussian() : 0);
        var vMeas  = state[1] + (nz > 0 ? 0.05 * nz * gaussian() : 0);
        var thMeas = state[2] + (nz > 0 ? deg2rad(nz) * gaussian() : 0);
        var wMeas  = state[3] + (nz > 0 ? deg2rad(nz) / 0.2 * gaussian() : 0);
        // The cart's error is measured from the reference position and velocity; the pole
        // states aim for zero. (Feeding the reference velocity in halves the lag on a Wave.)
        xRef = refValue(refSel.type, simT, REF_AMP_C, REF_OMEGA_C);
        cx = pid.kx * (xMeas - xRef);
        cv = pid.kv * (vMeas - refRate(refSel.type, simT, REF_AMP_C, REF_OMEGA_C));
        cth = pid.kth * thMeas; cw = pid.kw * wMeas;
        cmd = clamp(cx + cv + cth + cw, -FMAX, FMAX);
        if (man.manual) {
          cx = cv = cth = cw = 0;
          cmd = 0;
          if (man.drag) {
            var xt = clamp(view.camX + (man.drag.x - view.cx) / view.scale, -X_LIM, X_LIM);
            cmd = clamp(DRAG_K * (xt - state[0]) - DRAG_C * state[1], -FMAX, FMAX);
          }
        }
        // Transport delay: the cart feels the command from `delay` seconds ago.
        forceBuf.push(cmd);
        var Fapplied = 0;
        while (forceBuf.length > delaySamples) Fapplied = forceBuf.shift();
        if (man.manual) { forceBuf.length = 0; Fapplied = cmd; }
        uForce = Fapplied;
        state = rk4(state, simT, CP_DT, function (t, s) { return cpDeriv(t, s, uForce); });
        simT += CP_DT;
      }

      if (Math.abs(state[2]) > FALL_ANGLE || Math.abs(state[0]) > X_LIM) {
        simStatus = Math.abs(state[2]) > FALL_ANGLE ? 'fell' : 'crashed';
        if (!resetTimer) resetTimer = setTimeout(function () { resetTimer = null; newTrial(); }, 1500);
        return;
      }

      stateHist.x.push(state[0]); stateHist.xd.push(state[1]);
      stateHist.th.push(rad2deg(state[2])); stateHist.thd.push(rad2deg(state[3]));
      if (stateHist.x.length > CHIST) {
        stateHist.x.shift(); stateHist.xd.shift(); stateHist.th.shift(); stateHist.thd.shift();
      }
      pidContrib.x.push(cx); pidContrib.v.push(cv); pidContrib.th.push(cth); pidContrib.w.push(cw);
      pidContrib.total.push(cmd);
      if (pidContrib.x.length > CHIST) {
        pidContrib.x.shift(); pidContrib.v.shift(); pidContrib.th.shift(); pidContrib.w.shift(); pidContrib.total.shift();
      }

      var trackErr = clipErr(refValue(refSel.type, simT, REF_AMP_C, REF_OMEGA_C) - state[0]);
      errRing.push(trackErr * trackErr);
      if (errRing.length > RING) errRing.shift();
      var rms = capScore(Math.sqrt(errRing.reduce(function (a, b) { return a + b; }, 0) / errRing.length));
      if (scoreEl) scoreEl.textContent = rms.toFixed(2);
      if (!man.manual && errRing.length === RING && (bestRMS === null || rms < bestRMS)) {
        bestRMS = rms;
        if (bestEl) bestEl.textContent = 'Best: ' + rms.toFixed(2) + ' m';
      }
    }

    setInterval(step, 25);

    // ---- Renderer: camera follows the cart along an unbounded track ----
    function drawCartPole() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var W = canvas.clientWidth || 720, H = canvas.clientHeight || 380;   // set by the layout
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      var ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Same look as the double cart-pole on /controls/swingup/: flat panel, thick rail,
      // accent cart, dark rod, coloured bob, yellow force arrow.
      var bg = cssVar('--bg-soft'), border = cssVar('--border'), strong = cssVar('--border-strong');
      var text = cssVar('--text'), muted = cssVar('--text-muted'), accent = cssVar('--accent');
      var mono = cssVar('--mono'), font = cssVar('--font');
      var col1 = cssVar('--viz-1'), col2 = cssVar('--viz-2'), colF = cssVar('--viz-4');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

      // Fixed view, like the double cart-pole: the rail and its end stops stay put and the
      // cart moves along them. The scale fits both the rail's width and the pole's height.
      var trackY = Math.round(H * 0.72);
      var cartW = 52, cartH = 24;
      var scale = Math.min((W - 40 - cartW) / (2 * X_LIM), (trackY - 56) / (2 * L_POLE + 0.2));
      var cx = W / 2;
      view.cx = cx; view.scale = scale; view.camX = 0;
      function sx(xm) { return cx + xm * scale; }

      // Rail with hard stops where the cart centre reaches ±X_LIM, and metre ticks
      var railL = sx(-X_LIM) - cartW / 2, railR = sx(X_LIM) + cartW / 2;
      ctx.strokeStyle = strong; ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(railL, trackY); ctx.lineTo(railR, trackY); ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.fillStyle = muted;
      [railL, railR].forEach(function (xp) { ctx.fillRect(xp - 3, trackY - 14, 6, 28); });
      ctx.font = '10px ' + mono; ctx.textAlign = 'center';
      ctx.lineWidth = 1;
      var labelEvery = scale < 45 ? 2 : 1;
      for (var m = -X_LIM; m <= X_LIM + 1e-9; m += 0.5) {
        var tx = sx(m), whole = Math.abs(m - Math.round(m)) < 1e-6;
        ctx.strokeStyle = whole ? muted : border;
        ctx.beginPath(); ctx.moveTo(tx, trackY + 8); ctx.lineTo(tx, trackY + (whole ? 16 : 13)); ctx.stroke();
        if (whole && Math.round(m) % labelEvery === 0) ctx.fillText(Math.round(m) + ' m', tx, trackY + 30);
      }

      var cartX = sx(state[0]);
      var poleLenPx = L_POLE * 2 * scale;
      var bobR = Math.max(6, 0.028 * scale * Math.sqrt(M_POLE / 0.15));

      // Manual drag: dashed target line and a spring from the cart to the pointer
      if (man.manual && man.drag) {
        ctx.strokeStyle = accent; ctx.globalAlpha = 0.5; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
        var dragPx = sx(clamp((man.drag.x - cx) / scale, -X_LIM, X_LIM));
        ctx.beginPath(); ctx.moveTo(dragPx, trackY - 30); ctx.lineTo(dragPx, trackY + 30); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cartX, trackY); ctx.lineTo(dragPx, trackY); ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1;
      }

      // Reference position on the rail: a dashed marker where the cart should be right now
      var refNowC = refValue(refSel.type, simT, REF_AMP_C, REF_OMEGA_C);
      ctx.save();
      ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]); ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.moveTo(sx(refNowC), trackY - 38); ctx.lineTo(sx(refNowC), trackY + 22); ctx.stroke();
      ctx.restore();

      // Upright target ghost: dashed rod and a hollow bob
      ctx.globalAlpha = 0.45; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = accent;
      ctx.beginPath(); ctx.moveTo(cartX, trackY); ctx.lineTo(cartX, trackY - poleLenPx); ctx.stroke();
      ctx.setLineDash([]); ctx.strokeStyle = col1;
      ctx.beginPath(); ctx.arc(cartX, trackY - poleLenPx, bobR + 2, 0, 2 * Math.PI); ctx.stroke();
      ctx.globalAlpha = 1;

      // Cart
      ctx.fillStyle = accent;
      ctx.beginPath(); ctx.roundRect(cartX - cartW / 2, trackY - cartH / 2, cartW, cartH, 5); ctx.fill();

      // Pole (hinged at the cart centre, bob x = x + l sin θ, height = l cos θ)
      var tipX = cartX + poleLenPx * Math.sin(state[2]);
      var tipY = trackY - poleLenPx * Math.cos(state[2]);
      ctx.strokeStyle = text; ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(cartX, trackY); ctx.lineTo(tipX, tipY); ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.fillStyle = col1;
      ctx.beginPath(); ctx.arc(tipX, tipY, bobR, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.arc(cartX, trackY, 3, 0, 2 * Math.PI); ctx.fill();

      // Force arrow under the rail
      if (Math.abs(uForce) > 0.2) {
        var fl = clamp(uForce / FMAX, -1.5, 1.5) * 60, ay = trackY + 48, fs = fl >= 0 ? 1 : -1;
        ctx.strokeStyle = colF; ctx.fillStyle = colF; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(cartX, ay); ctx.lineTo(cartX + fl, ay); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cartX + fl + 3 * fs, ay);
        ctx.lineTo(cartX + fl - 6 * fs, ay - 5); ctx.lineTo(cartX + fl - 6 * fs, ay + 5);
        ctx.closePath(); ctx.fill();
      }

      // Status
      var label, colr = muted;
      if (simStatus === 'fell')                   { label = 'Pole fell - new trial…'; colr = col2; }
      else if (simStatus === 'crashed')           { label = 'Hit the end of the rail - new trial…'; colr = col2; }
      else if (man.manual)                        { label = 'Manual - drag the cart'; colr = accent; }
      else if (!pid.kx && !pid.kv && !pid.kth && !pid.kw) { label = 'No control - set the gains or load LQR'; }
      else                                        { label = 'LQR balancing'; colr = accent; }
      ctx.textAlign = 'left'; ctx.font = '600 13px ' + font; ctx.fillStyle = colr;
      ctx.fillText(label, 14, 24);
      ctx.font = '11px ' + mono; ctx.fillStyle = muted;
      ctx.fillText('t = ' + simT.toFixed(1) + ' s   F = ' + uForce.toFixed(1) + ' N', 14, 42);
      drawStateBox(ctx, W, H, [
        { label: 'x',   value: state[0], decimals: 2, unit: 'm' },
        { label: 'ẋ',   value: state[1], decimals: 2, unit: 'm/s' },
        { label: 'ref', value: refNowC, decimals: 2, unit: 'm' },
        { label: 'θ',   value: rad2deg(state[2]), decimals: 1, unit: '°' }
      ]);
    }

    // Live numbers in the panel's gain matrix.
    var mxEls = ['kx', 'kv', 'kth', 'kw'].map(function (k) { return [k, document.getElementById('cp-mx-' + k)]; });
    function syncMatrix() {
      mxEls.forEach(function (p) { if (p[1]) p[1].textContent = pid[p[0]].toFixed(1); });
    }

    function loop() {
      if (isActive('sec-cartpole')) {
        syncMatrix();
        drawCartPole();
        drawStatePlot(cpStatePlot, stateHist, CP_STATE_SPEC);
        drawContribPlot(cpPidPlot, [
          { label: 'x',     color: cssVar('--viz-1'),     data: pidContrib.x },
          { label: 'ẋ',     color: cssVar('--viz-2'),     data: pidContrib.v },
          { label: 'θ',     color: cssVar('--viz-3'),     data: pidContrib.th },
          { label: 'θ̇',     color: cssVar('--viz-4'),     data: pidContrib.w },
          { label: 'Total', color: cssVar('--viz-total'), data: pidContrib.total }
        ], FMAX, 'F (N)');
      }
      requestAnimationFrame(loop);
    }
    loop();
  })();

})();
