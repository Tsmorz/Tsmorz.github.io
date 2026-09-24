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

    // PID gains (from sliders)
    var pid = { kp: 0, ki: 0, kd: 0 };

    // History ring buffer for RMSE (last 5 s @ 200 Hz = 1000 samples)
    var RING = 1000;
    var errRing = [];
    var bestScore = null;

    // Scrolling time-series buffer (last ~8 s of display)
    var HIST = 600;
    var hist = { xArr: [], refArr: [], time: [] };

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

    function syncSliders() {
      pid.kp = parseFloat(kpSlider.value);
      pid.ki = parseFloat(kiSlider.value);
      pid.kd = parseFloat(kdSlider.value);
      kpVal.textContent = pid.kp.toFixed(1);
      kiVal.textContent = pid.ki.toFixed(1);
      kdVal.textContent = pid.kd.toFixed(2);
    }
    [kpSlider, kiSlider, kdSlider].forEach(function (s) {
      s.addEventListener('input', syncSliders);
    });
    syncSliders();

    function resetSim() {
      sim.x = 0; sim.v = 0; sim.t = 0;
      sim.intE = 0; sim.prevE = 0;
      errRing = [];
      hist.xArr = []; hist.refArr = []; hist.time = [];
      bestScore = null;
      if (bestEl) bestEl.textContent = '';
    }
    if (resetBtn) resetBtn.addEventListener('click', resetSim);

    var DT = 0.005;  // 200 Hz

    function step() {
      // 5 physics steps per timer tick (step called at 40 Hz → 200 Hz effective)
      for (var i = 0; i < 5; i++) {
        var ref = AMP_REF * Math.sin(OMEGA_REF * sim.t);
        var e   = ref - sim.x;
        sim.intE  = clamp(sim.intE + e * DT, -20, 20);
        var de  = (e - sim.prevE) / DT;
        var F   = pid.kp * e + pid.ki * sim.intE + pid.kd * de;
        sim.prevE = e;
        // F is constant over this step (zero-order hold on control)
        var s = rk4([sim.x, sim.v], sim.t, DT, function (t2, s2) {
          return [s2[1], (F - C_damp * s2[1] - K_spring * s2[0]) / M];
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

    function resizeCanvas() {
      var w = canvas.parentElement.clientWidth;
      canvas.width  = Math.round(w * dpr);
      canvas.height = Math.round(360 * dpr);
      canvas.style.width  = w + 'px';
      canvas.style.height = '360px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    new ResizeObserver(resizeCanvas).observe(canvas.parentElement);
    resizeCanvas();

    function render() {
      var W = canvas.clientWidth, H = 360;
      ctx.clearRect(0, 0, W, H);

      var textColor  = cssVar('--text');
      var mutedColor = cssVar('--text-muted');
      var accentColor = cssVar('--accent');
      var borderColor = cssVar('--border');
      var bgSoft = cssVar('--bg-soft');

      // === Left half: spring-mass animation ===
      var lw = W * 0.38;
      var cx = lw / 2;
      var anchorY = 30;
      var restLen = 80;
      var massH = 40, massW = 50;

      // Scale: 1 unit = 50px, centred around y=180
      var massY = H / 2 + sim.x * 80;
      var refY  = H / 2 + AMP_REF * Math.sin(OMEGA_REF * sim.t) * 80;

      // Reference dashed line
      ctx.save();
      ctx.strokeStyle = accentColor;
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx - 35, refY);
      ctx.lineTo(cx + 35, refY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // Anchor bar
      ctx.fillStyle = mutedColor;
      ctx.fillRect(cx - 30, anchorY - 8, 60, 8);

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

      // Divider
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(lw, 20);
      ctx.lineTo(lw, H - 20);
      ctx.stroke();

      // === Right half: time-series plot ===
      var pw = W - lw - 20, ph = H - 60;
      var px0 = lw + 10, py0 = 30;

      ctx.fillStyle = bgSoft;
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(px0, py0, pw, ph, 6);
      ctx.fill();
      ctx.stroke();

      // Axes labels
      ctx.fillStyle = mutedColor;
      ctx.font = '11px ' + cssVar('--mono');
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('x (m)', px0 + 4, py0 + 4);

      var yMap = function (v) { return py0 + ph / 2 - v * (ph / 2 - 12) / AMP_REF; };

      // Grid line at 0
      ctx.strokeStyle = borderColor;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(px0 + 2, yMap(0));
      ctx.lineTo(px0 + pw - 2, yMap(0));
      ctx.stroke();
      ctx.setLineDash([]);

      if (hist.xArr.length > 1) {
        var xStep = pw / HIST;

        // Reference line (dashed accent)
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        for (var i = 0; i < hist.refArr.length; i++) {
          var xx = px0 + (i - hist.refArr.length + HIST) * xStep;
          var yy = yMap(hist.refArr[i]);
          if (i === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        // Actual position (solid)
        ctx.strokeStyle = textColor;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        for (var i = 0; i < hist.xArr.length; i++) {
          var xx = px0 + (i - hist.xArr.length + HIST) * xStep;
          var yy = yMap(hist.xArr[i]);
          if (i === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
        }
        ctx.stroke();
      }

      // Legend
      ctx.font = '11px ' + cssVar('--mono');
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = accentColor;
      ctx.fillText('— reference', px0 + pw - 6, py0 + ph - 4);
      ctx.fillStyle = textColor;
      ctx.fillText('— actual', px0 + pw - 6 - 90, py0 + ph - 4);
    }

    var stepTimer = setInterval(function () {
      if (document.getElementById('sec-msd').classList.contains('active')) step();
    }, 25);

    var rafId = null;
    function loop() {
      render();
      rafId = requestAnimationFrame(loop);
    }
    loop();
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
    var qbar = 0.5 * AC.rho * V * V;
    var CL   = AC.CL0 + AC.CLa * alpha + AC.CLde * de;
    var CD   = AC.CD0 + AC.k * CL * CL;
    var Cm   = AC.Cm0 + AC.Cma * alpha + AC.Cmq * q * AC.cbar / (2 * Math.max(V, 1)) + AC.Cmde * de;
    return {
      L:  qbar * AC.S * CL,
      D:  qbar * AC.S * CD,
      My: qbar * AC.S * AC.cbar * Cm
    };
  }

  // Trim: find (alpha0, de0) such that L=W and Cm=0; also compute T_trim=D_trim
  function computeTrim() {
    var W  = AC.m * AC.g;
    var V0 = 85;
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

  function makeFlightRenderer(canvas) {
    var ctx = canvas.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);

    function resize() {
      var w = canvas.parentElement.clientWidth;
      canvas.width  = Math.round(w * dpr);
      canvas.height = Math.round(380 * dpr);
      canvas.style.width  = w + 'px';
      canvas.style.height = '380px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    new ResizeObserver(resize).observe(canvas.parentElement);
    resize();

    // Fixed reference path — 300 m center, ±100 m amplitude
    var H_CENTER = 300, REF_AMP = 100, REF_OMEGA = 0.15;

    // Bottom 36 px are always the ground strip; the rest maps h=0→horizon, h=WORLD_HI→top
    var GROUND_PX = 36;

    function hToY(h, H) {
      return (H - GROUND_PX) * (1 - h / WORLD_HI);
    }

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
        var dispW = 110;
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
    function render(state, simT, de_rad, status, extraFn) {
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

      // Horizon at h=0 — always (H - GROUND_PX) pixels from canvas top
      var horizonY = H - GROUND_PX;  // hToY(0, H)

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

      // Reference altitude path (dashed accent line)
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([8, 5]);
      ctx.beginPath();
      var planeScreenX = W * 0.35;
      for (var px = 0; px <= W; px += 4) {
        var tOffset = (px - planeScreenX) / Math.max(V, 1) / 60;
        var refH = H_CENTER + REF_AMP * Math.sin(REF_OMEGA * (simT + tOffset));
        var ry = hToY(refH, H);
        if (px === 0) ctx.moveTo(px, ry); else ctx.lineTo(px, ry);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // Cessna sprite
      drawPlane(planeScreenX, hToY(h, H), theta, isDark);

      // Altitude scale (right side) — ticks every 100 m within 0–600 m
      ctx.fillStyle = mutedColor;
      ctx.font = '11px ' + cssVar('--mono');
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (var ah = 0; ah <= WORLD_HI; ah += 100) {
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
     Demo 2 — Flight Simulator
  ================================================================ */
  (function flightDemo() {
    var canvas = document.getElementById('flight-canvas');
    if (!canvas) return;
    var renderer = makeFlightRenderer(canvas);

    // State: [V, gamma, alpha, q, h, x]
    var state, simT, de_rad, pidState, simStatus;
    var mode = 'manual';
    var errRing = [];
    var RING = 1200;  // 10 s @ 120 Hz effective

    function resetSim() {
      if (resetTimer) { clearTimeout(resetTimer); resetTimer = null; }
      state = [TRIM.V, TRIM.gamma, TRIM.alpha, TRIM.q, TRIM.h, TRIM.x];
      simT = 0;
      de_rad = TRIM.de;
      pidState = { intE: 0, prevE: 0 };
      errRing = [];
      simStatus = 'ok';
      renderer.resetViewport();
    }
    resetSim();

    // DOM
    var manualBtn  = document.getElementById('fl-manual-btn');
    var pidBtn     = document.getElementById('fl-pid-btn');
    var manualCtrl = document.getElementById('fl-manual-controls');
    var pidCtrl    = document.getElementById('fl-pid-controls');
    var elevSlider = document.getElementById('fl-elev');
    var elevVal    = document.getElementById('fl-elev-val');
    var kpSlider   = document.getElementById('fl-kp');
    var kiSlider   = document.getElementById('fl-ki');
    var kdSlider   = document.getElementById('fl-kd');
    var kpValEl    = document.getElementById('fl-kp-val');
    var kiValEl    = document.getElementById('fl-ki-val');
    var kdValEl    = document.getElementById('fl-kd-val');
    var scoreEl    = document.getElementById('fl-score');
    var resetBtn   = document.getElementById('fl-reset');

    if (elevSlider) elevSlider.addEventListener('input', function () {
      de_rad = deg2rad(parseFloat(elevSlider.value));
      elevVal.textContent = parseFloat(elevSlider.value).toFixed(1) + '°';
    });

    function syncPidVals() {
      if (kpValEl) kpValEl.textContent = parseFloat(kpSlider.value).toFixed(2);
      if (kiValEl) kiValEl.textContent = parseFloat(kiSlider.value).toFixed(3);
      if (kdValEl) kdValEl.textContent = parseFloat(kdSlider.value).toFixed(1);
    }
    if (kpSlider) { kpSlider.addEventListener('input', syncPidVals); syncPidVals(); }
    if (kiSlider) { kiSlider.addEventListener('input', syncPidVals); }
    if (kdSlider) { kdSlider.addEventListener('input', syncPidVals); }

    function setMode(m) {
      mode = m;
      if (manualBtn) manualBtn.classList.toggle('active', m === 'manual');
      if (pidBtn)    pidBtn.classList.toggle('active', m === 'pid');
      if (manualCtrl) manualCtrl.style.display = m === 'manual' ? '' : 'none';
      if (pidCtrl)    pidCtrl.style.display    = m === 'pid'    ? 'flex' : 'none';
      pidState = { intE: 0, prevE: 0 };
    }
    if (manualBtn) manualBtn.addEventListener('click', function () { setMode('manual'); });
    if (pidBtn)    pidBtn.addEventListener('click', function () { setMode('pid'); });
    if (resetBtn)  resetBtn.addEventListener('click', resetSim);

    var REF_OMEGA = 0.15, REF_AMP = 100, H_CENTER = 300;
    var PID_DT = FLIGHT_DT;

    var resetTimer = null;

    var ELEV_MAX_RATE = deg2rad(40) * FLIGHT_DT; // 40°/sec rate limit per physics step

    function step() {
      if (!document.getElementById('sec-flight').classList.contains('active')) return;
      if (simStatus !== 'ok') return;
      for (var i = 0; i < 5; i++) {
        var de_target = de_rad;
        if (mode === 'pid') {
          var hRef = H_CENTER + REF_AMP * Math.sin(REF_OMEGA * simT);
          var e = hRef - state[4];
          pidState.intE = clamp(pidState.intE + e * PID_DT, -200, 200);
          var de_cmd = parseFloat(kpSlider.value) * e
            + parseFloat(kiSlider.value) * pidState.intE
            + parseFloat(kdSlider.value) * (e - pidState.prevE) / PID_DT;
          pidState.prevE = e;
          de_target = clamp(deg2rad(de_cmd), deg2rad(-15), deg2rad(15));
        }
        de_rad += clamp(de_target - de_rad, -ELEV_MAX_RATE, ELEV_MAX_RATE);
        state = rk4(state, simT, FLIGHT_DT, function (t, s) {
          return flightDerivatives(t, s, de_rad);
        });
        simT += FLIGHT_DT;
        var stop = checkStopConditions(state);
        if (stop) {
          simStatus = stop;
          if (!resetTimer) resetTimer = setTimeout(function () { resetTimer = null; resetSim(); }, 2500);
          return;
        }
        var refH = H_CENTER + REF_AMP * Math.sin(REF_OMEGA * simT);
        var err = refH - state[4];
        errRing.push(err * err);
        if (errRing.length > RING) errRing.shift();
      }
      // Update UI telemetry
      var tH = document.getElementById('fl-t-h');
      var tV = document.getElementById('fl-t-v');
      var tA = document.getElementById('fl-t-a');
      var tQ = document.getElementById('fl-t-q');
      if (tH) tH.textContent = state[4].toFixed(0) + ' m';
      if (tV) tV.textContent = state[0].toFixed(1) + ' m/s';
      if (tA) tA.textContent = rad2deg(state[2]).toFixed(1) + '°';
      if (tQ) tQ.textContent = rad2deg(state[3]).toFixed(2) + '°/s';
      if (scoreEl && errRing.length > 0) {
        var rmse = Math.sqrt(errRing.reduce(function (a, b) { return a + b; }, 0) / errRing.length);
        scoreEl.textContent = rmse.toFixed(1);
      }
    }

    setInterval(step, 25);

    function loop() {
      renderer.render(state, simT, de_rad, simStatus);
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
    var renderer = makeFlightRenderer(canvas);

    var state, simT, de_rad;
    var recording = false;
    var dataBuf = [];   // [{x:[ΔV,Δγ,Δα,Δq], u:Δde, xprev}]
    var lqrActive = false;
    var lqrK = null;   // [kV, kgamma, kalpha, kq]
    var errRingBefore = null;
    var errRing = [];
    var RING = 1200;
    var pidState = { intE: 0, prevE: 0 };
    var scoreBeforeVal = null;

    var REF_OMEGA = 0.15, REF_AMP = 100, H_CENTER = 300;

    var simStatus3 = 'ok';
    var resetTimer3 = null;

    function resetSim() {
      if (resetTimer3) { clearTimeout(resetTimer3); resetTimer3 = null; }
      state = [TRIM.V, TRIM.gamma, TRIM.alpha, TRIM.q, TRIM.h, TRIM.x];
      simT = 0;
      de_rad = TRIM.de;
      recording = false;
      dataBuf = [];
      lqrActive = false;
      lqrK = null;
      errRing = [];
      errRingBefore = null;
      scoreBeforeVal = null;
      pidState = { intE: 0, prevE: 0 };
      simStatus3 = 'ok';
      renderer.resetViewport();
      updateUI();
    }
    resetSim();

    var recordBtn  = document.getElementById('sid-record-btn');
    var identBtn   = document.getElementById('sid-identify-btn');
    var lqrBtn     = document.getElementById('sid-lqr-btn');
    var resetBtn   = document.getElementById('sid-reset');
    var elevSlider = document.getElementById('sid-elev');
    var elevVal    = document.getElementById('sid-elev-val');
    var barEl      = document.getElementById('sid-bar');
    var countEl    = document.getElementById('sid-count');
    var matricesEl = document.getElementById('sid-matrices');
    var aDisplay   = document.getElementById('sid-A-display');
    var bDisplay   = document.getElementById('sid-B-display');
    var lqrSection = document.getElementById('sid-lqr-section');
    var kDisplay   = document.getElementById('sid-K-display');
    var scoreCompEl = document.getElementById('sid-score-compare');
    var scoreEl    = document.getElementById('sid-score');
    var NEEDED = 300;

    if (elevSlider) elevSlider.addEventListener('input', function () {
      if (!lqrActive) de_rad = deg2rad(parseFloat(elevSlider.value));
      elevVal.textContent = parseFloat(elevSlider.value).toFixed(1) + '°';
    });

    function updateUI() {
      if (recordBtn) {
        recordBtn.textContent = recording ? 'Stop Recording' : 'Start Recording';
        recordBtn.classList.toggle('recording', recording);
      }
      var n = dataBuf.length;
      var frac = Math.min(n / NEEDED, 1);
      if (barEl)   barEl.style.width = (frac * 100).toFixed(1) + '%';
      if (countEl) countEl.textContent = n + ' / ' + NEEDED + ' samples';
      if (identBtn) identBtn.disabled = n < NEEDED;
    }

    if (recordBtn) recordBtn.addEventListener('click', function () {
      recording = !recording;
      updateUI();
    });

    if (resetBtn) resetBtn.addEventListener('click', resetSim);

    // ---- System identification ----
    if (identBtn) identBtn.addEventListener('click', function () {
      var result = runSystemID();
      if (!result) { alert('Not enough data — please collect more samples.'); return; }
      if (aDisplay) aDisplay.textContent = formatMatrix(result.A, 4, 4);
      if (bDisplay) bDisplay.textContent = formatMatrix([result.B[0], result.B[1], result.B[2], result.B[3]], 4, 1);
      if (matricesEl) matricesEl.style.display = '';
      if (lqrBtn) lqrBtn.disabled = false;
      window._sidResult = result;  // store for LQR step
      // save current RMSE as "before"
      if (errRing.length > 0) {
        scoreBeforeVal = Math.sqrt(errRing.reduce(function (a, b) { return a + b; }, 0) / errRing.length);
      }
    });

    // ---- LQR ----
    if (lqrBtn) lqrBtn.addEventListener('click', function () {
      if (!window._sidResult) return;
      var K = runLQR(window._sidResult.A, window._sidResult.B);
      if (!K) { alert('DARE did not converge — try collecting more diverse flight data.'); return; }
      lqrK = K;
      lqrActive = true;
      recording = false;
      updateUI();
      if (kDisplay) kDisplay.textContent = 'K = [' + K.map(function (v) { return v.toFixed(4); }).join(', ') + ']';
      if (lqrSection) lqrSection.style.display = '';
      errRing = [];  // reset score window
    });

    var ELEV_MAX_RATE3 = deg2rad(40) * FLIGHT_DT;

    // ---- Simulation step ----
    function step() {
      if (!document.getElementById('sec-sysid').classList.contains('active')) return;
      if (simStatus3 !== 'ok') return;

      var prevState = state.slice();

      for (var i = 0; i < 5; i++) {
        if (lqrActive && lqrK) {
          var dx = [state[0] - TRIM.V, state[1] - TRIM.gamma, state[2] - TRIM.alpha, state[3] - TRIM.q];
          var du = -(lqrK[0]*dx[0] + lqrK[1]*dx[1] + lqrK[2]*dx[2] + lqrK[3]*dx[3]);
          var de_target3 = clamp(TRIM.de + du, deg2rad(-15), deg2rad(15));
          de_rad += clamp(de_target3 - de_rad, -ELEV_MAX_RATE3, ELEV_MAX_RATE3);
        }
        state = rk4(state, simT, FLIGHT_DT, function (t, s) {
          return flightDerivatives(t, s, de_rad);
        });
        simT += FLIGHT_DT;
        var stop3 = checkStopConditions(state);
        if (stop3) {
          simStatus3 = stop3;
          recording = false;
          if (!resetTimer3) resetTimer3 = setTimeout(function () { resetTimer3 = null; resetSim(); }, 2500);
          return;
        }
      }

      // Record data (every 10 physics steps = 0.05 s)
      if (recording) {
        var dx_trim = [
          state[0] - TRIM.V,
          state[1] - TRIM.gamma,
          state[2] - TRIM.alpha,
          state[3] - TRIM.q
        ];
        var du_trim = de_rad - TRIM.de;
        var dxprev = [
          prevState[0] - TRIM.V,
          prevState[1] - TRIM.gamma,
          prevState[2] - TRIM.alpha,
          prevState[3] - TRIM.q
        ];
        dataBuf.push({ x: dx_trim, u: du_trim, xprev: dxprev });
        updateUI();
      }

      // Score
      var refH = H_CENTER + REF_AMP * Math.sin(REF_OMEGA * simT);
      var err = refH - state[4];
      errRing.push(err * err);
      if (errRing.length > RING) errRing.shift();
      if (scoreEl && errRing.length > 0) {
        var rmse = Math.sqrt(errRing.reduce(function (a, b) { return a + b; }, 0) / errRing.length);
        scoreEl.textContent = rmse.toFixed(1);
        if (scoreBeforeVal !== null && lqrActive && scoreCompEl) {
          scoreCompEl.textContent =
            'Before: ' + scoreBeforeVal.toFixed(1) + ' m\nAfter:  ' + rmse.toFixed(1) + ' m';
        }
      }
    }

    setInterval(step, 25);

    function loop() {
      renderer.render(state, simT, de_rad, simStatus3);
      requestAnimationFrame(loop);
    }
    loop();

    /* ---- System ID: least squares ---- */
    function runSystemID() {
      var n = dataBuf.length;
      if (n < NEEDED) return null;

      // Build Φ (N×5) and Y (N×4)
      // Δẋ ≈ (x_k+1 - x_k) / dt  (already stored as consecutive diffs)
      var dt = FLIGHT_DT * 5;  // step stores every 5 physics steps

      // Φ row: [ΔV, Δγ, Δα, Δq, Δδe]
      // Y row: [(x_{k} - x_{k-1}) / dt]  using forward difference from consecutive samples
      var Phi = [], Y = [];
      for (var i = 1; i < n; i++) {
        var row = dataBuf[i].xprev.concat([dataBuf[i-1].u]);
        var ydot = [
          (dataBuf[i].x[0] - dataBuf[i-1].x[0]) / dt,
          (dataBuf[i].x[1] - dataBuf[i-1].x[1]) / dt,
          (dataBuf[i].x[2] - dataBuf[i-1].x[2]) / dt,
          (dataBuf[i].x[3] - dataBuf[i-1].x[3]) / dt
        ];
        Phi.push(row);
        Y.push(ydot);
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

    /* ---- LQR via DARE ---- */
    function runLQR(A, B) {
      // Discretise: Ad = I + dt*A,  Bd = dt*B
      var dt = 0.05;
      var Ad = mat4add(mat4eye(), mat4scale(A, dt));
      var Bd = B.map(function (v) { return v * dt; });

      // Q, R weights
      var Q = [[0.01,0,0,0],[0,100,0,0],[0,0,1,0],[0,0,0,0.1]];
      var R = 1.0;

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
     Demo 4 — Neural Network Controller
     Behavioral cloning: a feedforward net imitates the LQR computed
     from the true linearization, trained in-browser via Adam.
  ================================================================ */
  (function nnDemo() {
    var canvas = document.getElementById('nn-canvas');
    if (!canvas) return;
    var renderer = makeFlightRenderer(canvas);

    var REF_OMEGA = 0.15, REF_AMP = 100, H_CENTER = 300;
    var state, simT, de_rad, simStatus, resetTimer;
    var errRing = [], RING = 1200;
    var nnIntErr = 0;

    function resetSim() {
      if (resetTimer) { clearTimeout(resetTimer); resetTimer = null; }
      state = [TRIM.V, TRIM.gamma, TRIM.alpha, TRIM.q, TRIM.h, TRIM.x];
      simT = 0; de_rad = TRIM.de; simStatus = 'ok'; nnIntErr = 0;
      errRing = [];
      renderer.resetViewport();
    }
    resetSim();

    /* ── Compact 4×4 matrix helpers ──────────────────────────── */
    function m4eye() { return [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]; }
    function m4copy(m) { return m.map(function(r) { return r.slice(); }); }
    function m4add(A, B) { return A.map(function(r,i) { return r.map(function(v,j) { return v+B[i][j]; }); }); }
    function m4scale(A, s) { return A.map(function(r) { return r.map(function(v) { return v*s; }); }); }
    function m4mul(A, B) {
      var C = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
      for (var i=0;i<4;i++) for (var j=0;j<4;j++) for (var k=0;k<4;k++) C[i][j] += A[i][k]*B[k][j];
      return C;
    }
    function m4T(A) {
      return [[A[0][0],A[1][0],A[2][0],A[3][0]],[A[0][1],A[1][1],A[2][1],A[3][1]],
              [A[0][2],A[1][2],A[2][2],A[3][2]],[A[0][3],A[1][3],A[2][3],A[3][3]]];
    }
    function m4mulv(A, v) { return A.map(function(r) { return r[0]*v[0]+r[1]*v[1]+r[2]*v[2]+r[3]*v[3]; }); }
    function m4vlt(v, A) { return [0,1,2,3].map(function(j) { return v[0]*A[0][j]+v[1]*A[1][j]+v[2]*A[2][j]+v[3]*A[3][j]; }); }
    function vdot4(a, b) { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3]; }
    function m4os(col, row, s) { return col.map(function(c,ci) { return row.map(function(r) { return c*r*s; }); }); }

    /* ── True LQR via numerical Jacobian + DARE ──────────────── */
    var K_true = null;

    function computeTrueLQR() {
      var eps = 1e-5;
      var x0 = [TRIM.V, TRIM.gamma, TRIM.alpha, TRIM.q, TRIM.h, 0];
      var u0 = TRIM.de;

      function f4(x6, u) { return flightDerivatives(0, x6, u).slice(0, 4); }

      var cols = [];
      for (var j = 0; j < 4; j++) {
        var xp = x0.slice(); xp[j] += eps;
        var xm = x0.slice(); xm[j] -= eps;
        var fp = f4(xp, u0), fm = f4(xm, u0);
        cols.push(fp.map(function(v, i) { return (v - fm[i]) / (2*eps); }));
      }
      var A = [[],[],[],[]];
      for (var j = 0; j < 4; j++) for (var i = 0; i < 4; i++) A[i].push(cols[j][i]);

      var fp2 = f4(x0, u0+eps), fm2 = f4(x0, u0-eps);
      var Bv = fp2.map(function(v, i) { return (v - fm2[i]) / (2*eps); });

      var dt = 0.05;
      var Ad = m4add(m4eye(), m4scale(A, dt));
      var Bd = Bv.map(function(v) { return v*dt; });
      var Q = [[0.01,0,0,0],[0,100,0,0],[0,0,1,0],[0,0,0,0.1]], R = 1.0;
      var P = m4copy(Q);
      for (var iter = 0; iter < 2000; iter++) {
        var PB = m4mulv(P, Bd), BtPB = vdot4(Bd, PB) + R;
        var BtPA = m4vlt(Bd, m4mul(P, Ad));
        var Pnew = m4add(m4add(Q, m4mul(m4T(Ad), m4mul(P, Ad))),
                         m4scale(m4os(m4mulv(m4T(Ad), PB), BtPA, 1/BtPB), -1));
        var diff = 0;
        for (var r=0;r<4;r++) for (var c=0;c<4;c++) diff += Math.pow(Pnew[r][c]-P[r][c], 2);
        P = Pnew;
        if (diff < 1e-12) break;
      }
      var PB3 = m4mulv(P, Bd), BtPB3 = vdot4(Bd, PB3) + R;
      return m4vlt(Bd, m4mul(P, Ad)).map(function(v) { return v/BtPB3; });
    }

    /* ── Training data generation ────────────────────────────── */
    var INPUT_SCALES = [20, 0.3, 0.2, 0.5, 150, 300];

    function genData() {
      if (!K_true) K_true = computeTrueLQR();
      var data = [], s = [TRIM.V, TRIM.gamma, TRIM.alpha, TRIM.q, TRIM.h, 0];
      var t = 0, intErr = 0, dt = 0.025;
      for (var i = 0; i < 2000; i++) {
        var hRef = H_CENTER + REF_AMP * Math.sin(REF_OMEGA * t);
        var dx = [s[0]-TRIM.V, s[1]-TRIM.gamma, s[2]-TRIM.alpha, s[3]-TRIM.q];
        var du = -(K_true[0]*dx[0]+K_true[1]*dx[1]+K_true[2]*dx[2]+K_true[3]*dx[3]);
        var de = clamp(TRIM.de + du, deg2rad(-15), deg2rad(15));
        var errH = s[4] - hRef;
        intErr = clamp(intErr + errH * dt, -1000, 1000);
        data.push({ x: [dx[0], dx[1], dx[2], dx[3], errH, intErr], y: de / deg2rad(15) });
        s = rk4(s, t, dt, function(tt, ss) { return flightDerivatives(tt, ss, de); });
        s[4] = Math.max(s[4], 0);
        t += dt;
        if (i % 80 === 0) { s[1] += (Math.random()-0.5)*0.04; s[2] += (Math.random()-0.5)*0.02; }
      }
      return data;
    }

    /* ── Neural network (arbitrary depth feedforward, tanh) ───── */
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

    /* ── Loss canvas ─────────────────────────────────────────── */
    var lossCanvas = document.getElementById('nn-loss-canvas');
    var lossCtx    = lossCanvas && lossCanvas.getContext('2d');

    function drawLoss() {
      if (!lossCtx || !lossHistory.length) return;
      var W = lossCanvas.offsetWidth || 200, H = 72;
      lossCanvas.width  = Math.round(W * (window.devicePixelRatio || 1));
      lossCanvas.height = Math.round(H * (window.devicePixelRatio || 1));
      lossCtx.setTransform(window.devicePixelRatio||1, 0, 0, window.devicePixelRatio||1, 0, 0);
      lossCtx.fillStyle = cssVar('--bg-soft');
      lossCtx.fillRect(0, 0, W, H);
      var maxL = Math.max.apply(null, lossHistory), n = lossHistory.length;
      lossCtx.strokeStyle = cssVar('--accent');
      lossCtx.lineWidth = 1.5;
      lossCtx.beginPath();
      for (var i = 0; i < n; i++) {
        var x = (i / Math.max(n-1, 1)) * W;
        var y = H - 4 - (lossHistory[i] / Math.max(maxL, 1e-9)) * (H-8);
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

    function archChanged() {
      nLayers  = parseInt(layersSlider.value);
      nNeurons = parseInt(neuronsSlider.value);
      if (layersVal)  layersVal.textContent  = nLayers;
      if (neuronsVal) neuronsVal.textContent = nNeurons;
      net = null; nnActive = false; lossHistory = [];
      if (activateBtnEl) { activateBtnEl.disabled = true; activateBtnEl.textContent = 'Activate NN'; activateBtnEl.classList.remove('active'); }
      if (trainStatusEl) trainStatusEl.textContent = 'Architecture changed — retrain';
      if (lossCtx) lossCtx.clearRect(0, 0, lossCanvas.width, lossCanvas.height);
    }
    if (layersSlider)  layersSlider.addEventListener('input', archChanged);
    if (neuronsSlider) neuronsSlider.addEventListener('input', archChanged);

    if (genBtn) genBtn.addEventListener('click', function() {
      genBtn.disabled = true;
      if (genStatus) genStatus.textContent = 'Generating…';
      setTimeout(function() {
        if (!K_true) K_true = computeTrueLQR();
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
      nnIntErr = 0;
      activateBtnEl.textContent = nnActive ? 'Deactivate NN' : 'Activate NN';
      activateBtnEl.classList.toggle('active', nnActive);
    });

    if (resetBtn) resetBtn.addEventListener('click', resetSim);

    /* ── Simulation step ─────────────────────────────────────── */
    setInterval(function() {
      var sec = document.getElementById('sec-nn');
      if (!sec || !sec.classList.contains('active')) return;
      if (simStatus !== 'ok') return;

      var ELEV_MAX_RATE_NN = deg2rad(40) * FLIGHT_DT;
      for (var i = 0; i < 5; i++) {
        var hRef = H_CENTER + REF_AMP * Math.sin(REF_OMEGA * simT);

        if (nnActive && net) {
          var dx = [state[0]-TRIM.V, state[1]-TRIM.gamma, state[2]-TRIM.alpha, state[3]-TRIM.q];
          nnIntErr = clamp(nnIntErr + (state[4]-hRef) * FLIGHT_DT, -1000, 1000);
          var cache = fwdNet(net, [dx[0], dx[1], dx[2], dx[3], state[4]-hRef, nnIntErr]);
          var de_nn_target = clamp(cache.out * deg2rad(15), deg2rad(-15), deg2rad(15));
          de_rad += clamp(de_nn_target - de_rad, -ELEV_MAX_RATE_NN, ELEV_MAX_RATE_NN);
        }

        state = rk4(state, simT, FLIGHT_DT, function(t, s) {
          return flightDerivatives(t, s, de_rad);
        });
        simT += FLIGHT_DT;

        var stopNN = checkStopConditions(state);
        if (stopNN) {
          simStatus = stopNN;
          if (!resetTimer) resetTimer = setTimeout(function() { resetTimer = null; resetSim(); }, 2500);
          return;
        }

        errRing.push(Math.pow(hRef - state[4], 2));
        if (errRing.length > RING) errRing.shift();
      }

      if (scoreEl && errRing.length > 0) {
        var rmse = Math.sqrt(errRing.reduce(function(a,b){return a+b;},0) / errRing.length);
        scoreEl.textContent = rmse.toFixed(1);
      }
    }, 25);

    /* ── Render loop ─────────────────────────────────────────── */
    (function loop() {
      var hRef = H_CENTER + REF_AMP * Math.sin(REF_OMEGA * simT);
      renderer.render(state, simT, de_rad, simStatus, function(ctx, W) {
        if (nnActive) {
          ctx.save();
          ctx.font = 'bold 11px monospace';
          ctx.textAlign = 'left'; ctx.textBaseline = 'top';
          ctx.fillStyle = 'rgba(80,200,120,0.9)';
          ctx.fillText('● NN active', 215, 8);
          ctx.restore();
        }
      });
      requestAnimationFrame(loop);
    })();
  })();

})();
