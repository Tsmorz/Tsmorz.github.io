// The flight sim's picture: the Cessna sprite over a ground-anchored 600 m world with trees
// and clouds. Moved here unchanged from controls.js (the sprite loader and
// makeFlightRenderer) so the template's aircraft looks exactly like the /controls/ demo.
// A few names it used from controls.js are supplied below; LabPlants.flight calls
// LabFlightRender.render(canvas, ...) from its draw().
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function deg2rad(d) { return d * Math.PI / 180; }
  function rad2deg(r) { return r * 180 / Math.PI; }
  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function refValue(type, t, amp, omega) { var s = Math.sin(omega * t); return type === 'step' ? amp * (s >= 0 ? 1 : -1) : amp * s; }
  var TRIM = root.LabPlants.flight.trim;
  var flightRef = { type: 'wave' };

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
    var fc = document.querySelector('canvas[data-sprite]');
    var src = fc && fc.getAttribute('data-sprite');
    if (src) raw.src = src;
    return { get: function () { return processed; } };
  }());

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
    var dpr = Math.min(window.devicePixelRatio || 1, 3);

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

  // One renderer per canvas (each keeps its own viewport and reference trail).
  var made = new Map();
  root.LabFlightRender = {
    H_CENTER: H_CENTER, REF_AMP: REF_AMP, REF_OMEGA: REF_OMEGA, ref: flightRef,
    render: function (canvas, state, t, de, status, refType) {
      flightRef.type = refType;
      if (!made.has(canvas)) made.set(canvas, makeFlightRenderer(canvas));
      made.get(canvas).render(state, t, de, status);
    },
    reset: function (canvas) { if (made.has(canvas)) made.get(canvas).resetViewport(); }
  };
})(window);
