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
    return { V: V0, gamma: 0, alpha: alpha0, q: 0, de: de0, h: 1200, x: 0, T: T0 };
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

  /* ================================================================
     Shared canvas renderer for flight demos
  ================================================================ */

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

    // Dynamic altitude window — expands immediately when the aircraft leaves,
    // contracts slowly back to the reference range when it returns.
    var REF_AMP = 100, REF_OMEGA = 0.15;
    var H_CENTER = 1200;
    var REF_LO = H_CENTER - REF_AMP - 80;   // 1020
    var REF_HI = H_CENTER + REF_AMP + 80;   // 1380
    var viewLo = REF_LO, viewHi = REF_HI;

    function updateViewport(h) {
      var needLo = Math.min(REF_LO, h - 80);
      var needHi = Math.max(REF_HI, h + 80);
      // Snap outward instantly, drift inward slowly
      viewLo = viewLo < needLo ? viewLo + (needLo - viewLo) * 0.04 : needLo;
      viewHi = viewHi > needHi ? viewHi - (viewHi - needHi) * 0.04 : needHi;
      // Enforce minimum window height
      var mid = (viewLo + viewHi) / 2;
      if (viewHi - viewLo < 300) { viewLo = mid - 150; viewHi = mid + 150; }
    }

    function hToY(h, H) {
      return H - (h - viewLo) / (viewHi - viewLo) * (H - 60) - 30;
    }

    function drawPlane(cx, cy, theta_rad) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-theta_rad);  // positive pitch = nose up

      // Fuselage
      ctx.beginPath();
      ctx.ellipse(0, 0, 22, 7, 0, 0, 2 * Math.PI);
      ctx.fill();

      // Wings
      ctx.beginPath();
      ctx.moveTo(-4, 0);
      ctx.lineTo(-4, -30);
      ctx.lineTo(6, -2);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-4, 0);
      ctx.lineTo(-4, 30);
      ctx.lineTo(6, 2);
      ctx.closePath();
      ctx.fill();

      // Horizontal tail
      ctx.beginPath();
      ctx.moveTo(-18, 0);
      ctx.lineTo(-18, -12);
      ctx.lineTo(-12, -1);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-18, 0);
      ctx.lineTo(-18, 12);
      ctx.lineTo(-12, 1);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    }

    // status: 'ok' | 'crashed' | 'stalled'
    function render(state, simT, de_rad, status, extraFn) {
      var W = canvas.clientWidth, H = 380;
      ctx.clearRect(0, 0, W, H);

      var h = state[4];
      var V = state[0];
      var alpha = state[2];
      var q = state[3];
      var gamma = state[1];
      var theta = gamma + alpha;
      var downrange = state[5];

      updateViewport(h);

      var accentColor = cssVar('--accent');
      var textColor   = cssVar('--text');
      var mutedColor  = cssVar('--text-muted');
      var borderColor = cssVar('--border');
      var bgColor     = cssVar('--bg');
      var bgSoft      = cssVar('--bg-soft');

      // Sky gradient
      var horizonY = hToY(viewLo + 60, H);
      var grad = ctx.createLinearGradient(0, 0, 0, horizonY);
      var isDark = document.documentElement.getAttribute('data-theme') === 'dark' ||
        (!document.documentElement.getAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
      if (isDark) {
        grad.addColorStop(0, '#05090f');
        grad.addColorStop(1, '#0e1e2e');
      } else {
        grad.addColorStop(0, '#b8d4f0');
        grad.addColorStop(1, '#dceef8');
      }
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, horizonY);

      // Ground
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

      // Reference altitude path (dashed)
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

      // Plane
      ctx.fillStyle = isDark ? '#e7ecf3' : '#1a1a2e';
      drawPlane(planeScreenX, hToY(h, H), theta);

      // Altitude scale (right side) — ticks at every 100 m within the live window
      ctx.fillStyle = mutedColor;
      ctx.font = '11px ' + cssVar('--mono');
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      var tickStep = viewHi - viewLo > 800 ? 200 : 100;
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

      // Elevator indicator (thin bar, right edge)
      var eiFrac = (de_rad / deg2rad(20) + 1) / 2;  // 0=down, 1=up
      var eiX = W - 22, eiTop = 50, eiH = 80;
      ctx.fillStyle = bgSoft;
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(eiX - 4, eiTop, 8, eiH, 4);
      ctx.fill();
      ctx.stroke();
      var thumbY = eiTop + (1 - eiFrac) * eiH;
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

      // Crash / stall overlay
      if (status && status !== 'ok') {
        var msg = status === 'crashed' ? '💥  CRASHED' : status === 'stalled' ? '⚠️  STALLED' : status;
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

      if (typeof extraFn === 'function') extraFn(ctx, W, H);
    }

    return { render: render, resetViewport: function () { viewLo = REF_LO; viewHi = REF_HI; } };
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

    var REF_OMEGA = 0.15, REF_AMP = 100, H_CENTER = 1200;
    var PID_DT = FLIGHT_DT;

    var resetTimer = null;

    function step() {
      if (!document.getElementById('sec-flight').classList.contains('active')) return;
      if (simStatus !== 'ok') return;
      for (var i = 0; i < 5; i++) {
        if (mode === 'pid') {
          var hRef = H_CENTER + REF_AMP * Math.sin(REF_OMEGA * simT);
          var e = hRef - state[4];
          pidState.intE = clamp(pidState.intE + e * PID_DT, -200, 200);
          var de_cmd = parseFloat(kpSlider.value) * e
            + parseFloat(kiSlider.value) * pidState.intE
            + parseFloat(kdSlider.value) * (e - pidState.prevE) / PID_DT;
          pidState.prevE = e;
          de_rad = clamp(deg2rad(de_cmd), deg2rad(-20), deg2rad(20));
        }
        state = rk4(state, simT, FLIGHT_DT, function (t, s) {
          return flightDerivatives(t, s, de_rad);
        });
        simT += FLIGHT_DT;
        // Detect ground impact
        if (state[4] <= 0) {
          state[4] = 0;
          simStatus = 'crashed';
          if (!resetTimer) resetTimer = setTimeout(function () { resetTimer = null; resetSim(); }, 2500);
          return;
        }
        // Detect stall
        if (state[0] < 15) {
          simStatus = 'stalled';
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

    var REF_OMEGA = 0.15, REF_AMP = 100, H_CENTER = 1200;

    var simStatus3 = 'ok';
    var resetTimer3 = null;

    function resetSim() {
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

    // ---- Simulation step ----
    function step() {
      if (!document.getElementById('sec-sysid').classList.contains('active')) return;
      if (simStatus3 !== 'ok') return;

      var prevState = state.slice();

      for (var i = 0; i < 5; i++) {
        if (lqrActive && lqrK) {
          var dx = [state[0] - TRIM.V, state[1] - TRIM.gamma, state[2] - TRIM.alpha, state[3] - TRIM.q];
          var du = -(lqrK[0]*dx[0] + lqrK[1]*dx[1] + lqrK[2]*dx[2] + lqrK[3]*dx[3]);
          de_rad = clamp(TRIM.de + du, deg2rad(-20), deg2rad(20));
        }
        state = rk4(state, simT, FLIGHT_DT, function (t, s) {
          return flightDerivatives(t, s, de_rad);
        });
        simT += FLIGHT_DT;
        if (state[4] <= 0) {
          state[4] = 0;
          simStatus3 = 'crashed';
          recording = false;
          if (!resetTimer3) resetTimer3 = setTimeout(function () { resetTimer3 = null; resetSim(); }, 2500);
          return;
        }
        if (state[0] < 15) {
          simStatus3 = 'stalled';
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

})();
