// Footer cat — an orange tabby that lives on the footer's top line.
// 30 s after the page loads it walks in from the right, sits, washes (licks a paw, wipes its face), yawns, turns a
// circle and curls up above the copyright with its tail wrapped round its front, and there it stays, asleep. Hover it
// and it looks content, click it and it slow-blinks at you and purrs for a few seconds, stroke it (the pointer back
// and forth) and it kneads. On its way in, a click stops it to look round at you, purring, and a stroke sits it down
// to knead; then it carries on.
//
// It is pixel art, but not a sprite sheet: under the pixels is a rig (a body, a head, four jointed legs with two-bone
// IK and a tail chain) posed in rig units (x forward, y up). Acts (walk, sit, lick ...) give a pose over time and the
// cat eases from the end of one act into the next; walking feet are placed by phase-from-distance in a
// lateral-sequence gait, so they stay planted. Each frame the rig is drawn onto a tiny canvas, one canvas pixel per art
// pixel, every pixel is snapped to the coat's palette (or cleared), and CSS scales it up with hard edges. Frames are
// drawn at 15 fps, like hand-drawn sprites. The clock only runs while the footer is on screen. Colors: main.css.
(function () {
  'use strict';
  if (!window.Path2D) return;
  var PX = 2, K = 0.6, S = PX * K, ROWS = 24, FPS = 15; // px per art pixel; art pixels per rig unit; px per unit; lane rows
  var SPEED = 34, STRIDE = 22, DUTY = 0.62;             // walking: units/s, units per gait cycle, fraction of it a foot is down
  var EXC = DUTY * STRIDE;                              // how far a planted foot travels under the body
  var DELAY = 30000;                                    // ms on the page before it walks in
  var ARM = 6.5, FORE = 6.6, THIGH = 6, SHIN = 6;       // leg bones
  var TAIL_N = 14, TAIL_LEN = 19;
  var LEGS = ['nh', 'fh', 'nf', 'ff'];                  // near/far, hind/front
  var GAIT = [0, 0.5, 0.25, 0.75];                      // lateral sequence: hind, then the front on the same side
  var LIFT = [2.4, 2.4, 3.2, 3.2], STAGGER = [0, 0.12, 0.22, 0.32];

  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function lerp(a, b, e) { return a + (b - a) * e; }
  function smooth(e) { e = clamp(e, 0, 1); return e * e * (3 - 2 * e); }
  function frac(x) { return x - Math.floor(x); }
  function bump(u, up, hold, down) { return u < up ? smooth(u / up) : u < up + hold ? 1 : 1 - smooth((u - up - hold) / down); }
  function rnd(i) { var x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  function add(a, b, k) { if (k === undefined) k = 1; return [a[0] + b[0] * k, a[1] + b[1] * k]; }
  function mid(a, b) { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }
  function rot(p, deg) { var r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return [p[0] * c - p[1] * s, p[0] * s + p[1] * c]; }
  function n2(x) { return Math.round(x * 100) / 100; }
  function pt(p) { return n2(p[0]) + ' ' + n2(p[1]); }

  // ---- poses ------------------------------------------------------------------------------------------------------
  // s, h: shoulder and hip; ts/bs, th/bh: body thickness above/below the spine at each; hd: head centre from the
  // shoulder, ha its tilt (deg, + is chin up); feet nf ff nh fh; hk: hock above a hind paw; tail: base angle ta, curl
  // near the base tc, curl at the tip tt, sway tw (deg), tb its root's height on the rump; pf 1 draws the near front paw
  // over the face. eye 1 open, 0 shut; mouth 0..1 (yawn); tongue 0..1 (licking); ear + is flattened back.
  function pose(base, over) {
    var o = {}, k;
    for (k in base) o[k] = Array.isArray(base[k]) ? base[k].slice() : base[k];
    for (k in over) o[k] = Array.isArray(over[k]) ? over[k].slice() : over[k];
    return o;
  }
  var STAND = {
    s: [7.2, 12.8], h: [-8.8, 13.0], ts: 5.0, bs: 4.9, th: 4.7, bh: 3.7, hd: [6.4, 5.4], ha: 0,
    nf: [8.8, 1.05], ff: [6.2, 1.05], nh: [-7.0, 1.05], fh: [-9.6, 1.05], hk: [-1.2, 5.2],
    ta: 112, tc: 6, tt: -130, tw: 7, tb: 2.2, pf: 0, eye: 1, mouth: 0, tongue: 0, ear: 0, happy: 0
  };
  var SNIFF = pose(STAND, { hd: [7.4, 0.4], ha: -32, ta: 95, tt: -40 });
  var SIT = pose(STAND, {
    s: [0.8, 15.2], h: [-6.4, 5.6], ts: 4.4, bs: 4.3, th: 5.8, bh: 4.8, hd: [3.4, 7.0], ha: 4,
    nf: [5.4, 1.05], ff: [3.8, 1.05], nh: [0.6, 1.05], fh: [-1, 1.05], hk: [-6.4, 0.5],
    ta: 205, tc: -28, tt: -70, tw: 3
  });
  var LICK = pose(SIT, { hd: [4.0, 6.4], ha: -22, ear: 4, pf: 1 });
  var LOAF = pose(STAND, {
    s: [4.6, 5.9], h: [-6.6, 5.9], ts: 5.8, bs: 4.8, th: 6.2, bh: 4.8, hd: [6.4, 5.2], ha: 0,
    nf: [13.4, 1.05], ff: [15, 1.05], nh: [-2.4, 1.05], fh: [-3.8, 1.05], hk: [-6.4, 0.5],
    ta: 212, tc: -24, tt: -55, tw: 3
  });
  // Curled up asleep is drawn by hand, as the old sprites were: letters are pixels (o fur, s stripe, d shaded fur,
  // w cream, k shaded cream, e eye, p nose, E the eye the engine opens or shuts). Facing left; column 11 sits on the cat's
  // origin and the last row on the ground. The rig hands over to these when it lies down.
  var SPR_O = 11;
  var CURL1 = [
    '..o..o..................', '.oooooo....ooooooo......', '.ooosso.oosoososoooo....', '.egoooodosoososooooooo..',
    'pegoooodooooooooooooooo.', 'wwooooodooooooooooooooo.', '.wwooooodooooooooooooooo', '..wwoooooooooooooooooooo',
    '..wwoooooooooooooooooooso.', '..wwwoooooooooooooooossoss', '..kww.ooooooooooooossossoo'
  ];
  var CURL2 = [
    '..........ooooooo.......', '.......oosoososoooo.....', '..o..ooosoososooooooo...', '.oooooodooooooooooooooo.',
    '.ooossodooooooooooooooo.', 'oEEooodoooooooooooooooso', 'pwooooodoooooooooooooooo', 'wwwoooooooooooooooooooso',
    'wwwoooooooooooodddddooss', 'wwwooooooooooooossoossos', '.kwwooooooooooooossooss.'
  ];
  var SLEEP_IN = [                                     // breathing in: the middle of the back rises a pixel
    '..........ooooooo.......', '.......oosoososoooo.....', '..o..ooosoososooooooo...', '.oooooodooooooooooooooo.',
    '.ooossodooooooooooooooo.', 'oEEooodoooooooooooooooso', 'pwooooodoooooooooooooooo', 'wwwoooodddddddddddddooso',
    'wwwooooooooooooooooooos.', 'kwsssoossoossoossooosss.', '.ksssoossoossoossooss...'
  ];
  var SLEEP_OUT = [
    '........................', '.......oosoososoooo.....', '..o..ooosoososooooooo...', '.oooooodooooooooooooooo.',
    '.ooossodooooooooooooooo.', 'oEEooodoooooooooooooooso', 'pwooooodoooooooooooooooo', 'wwwoooodddddddddddddooso',
    'wwwooooooooooooooooooos.', 'kwsssoossoossoossooosss.', '.ksssoossoossoossooss...'
  ];
  var SPR_EYE = [1, 5], SPR_HEAD = [3, 4];
  // stroked in its sleep it kneads: two frames of front paws pushing out under the chin ([col, row, letter], cols
  // left of 0 are in front of the face), near paw down and far paw up, then the other way round
  var KNEAD = [
    [[-2, 10, 'w'], [-1, 10, 'w'], [-2, 9, 'w'], [-1, 8, 'k'], [-1, 7, 'k']],
    [[-2, 8, 'w'], [-1, 8, 'w'], [-2, 9, 'w'], [-1, 10, 'k'], [0, 10, 'k']]
  ];
  // blend two poses; feet travel in a little arc when they move along the ground, hind feet first
  function mix(a, b, e) {
    var o = {}, k, q = smooth(e);
    for (k in b) {
      var A = a[k], B = b[k];
      if (A === undefined) o[k] = Array.isArray(B) ? B.slice() : B;
      else o[k] = Array.isArray(B) ? [lerp(A[0], B[0], q), lerp(A[1], B[1], q)] : lerp(A, B, q);
    }
    LEGS.forEach(function (k, i) {
      var A = a[k], B = b[k], r = smooth((e - STAGGER[i]) / (1 - 0.32));
      var y = lerp(A[1], B[1], r);
      if (A[1] < 2.5 && B[1] < 2.5) y += Math.min(3, Math.abs(B[0] - A[0]) * 0.45) * Math.sin(Math.PI * r);
      o[k] = [lerp(A[0], B[0], r), y];
    });
    return o;
  }

  // the walk: d is distance travelled (units); feet are planted for DUTY of each cycle and swing forward for the rest
  function gait(base, d, exc) {
    var p = pose(base), phi = d / STRIDE, w = 2 * Math.PI * phi;
    LEGS.forEach(function (k, i) {
      var ph = frac(phi + GAIT[i]), f = base[k], x, y = f[1];
      if (ph < DUTY) x = f[0] + exc * (0.5 - ph / DUTY);
      else {
        var q = (ph - DUTY) / (1 - DUTY);
        x = f[0] + exc * (smooth(q) - 0.5);
        y += LIFT[i] * Math.sin(Math.PI * q) * exc / EXC;
      }
      p[k] = [x, y];
    });
    p.s[1] -= 0.3 * Math.cos(2 * w);                 // the shoulders dip as each front foot takes the weight,
    p.h[1] -= 0.25 * Math.cos(2 * w + 1.6);           // the hips a beat later,
    p.hd[1] += 0.22 * Math.cos(2 * w);                // and the head holds still against both
    p.ts += 0.4 * Math.max(0, Math.sin(w + 1.6));     // shoulder blade rolling up over the near front leg
    return p;
  }

  function headPt(p, q) { return add(add(p.s, p.hd), rot(q, p.ha)); }

  // ---- acts -------------------------------------------------------------------------------------------------------
  function act(dur, blend, fn, extra) {
    var a = { dur: dur, blend: blend, pose: fn };
    for (var k in extra) a[k] = extra[k];
    return a;
  }
  function still(P, dur, blend, over, extra) {
    return act(dur, blend, function (u, T) { var p = pose(P); if (over) over(p, u, T); return p; }, extra);
  }
  function walkAct(x0, x1) {
    var dir = x1 > x0 ? 1 : -1, D = Math.abs(x1 - x0) / S, v = SPEED, ta = 0.5, td = 1.1;
    if (D < 1) return null;
    if (D < v * (ta + td) / 2) v = D / ((ta + td) / 2);
    var tc = (D - v * (ta + td) / 2) / v, dur = ta + tc + td;
    function dist(u) {
      if (u < ta) return v * u * u / (2 * ta);
      if (u < ta + tc) return v * ta / 2 + v * (u - ta);
      var r = Math.max(0, dur - u);
      return D - v * r * r / (2 * td);
    }
    return act(dur, 0.35, function (u) { return gait(STAND, dist(u), EXC); },
      { f: dir, to: x1, x: function (u) { return x0 + dir * dist(u) * S; } });
  }
  // turning round in place is a flip of the drawing through edge-on, stepping all the while
  function turnAct(f0, halves, dur) {
    return act(dur, 0.25, function (u) { return gait(STAND, u * 22, 6); },
      { f: function (u) { var k = Math.cos(Math.PI * halves * smooth(u / dur)); return f0 * (k < 0 ? -1 : 1) * Math.max(Math.abs(k), 0.4); },
        fEnd: halves % 2 ? -f0 : f0, busy: true });
  }
  function pawAtMouth(p) { p.nf = headPt(p, [7.6, -3.3]); }
  function licking(p, u) {
    pawAtMouth(p);                                    // the paw holds still and the head works against it
    var k = Math.max(0, Math.sin(u * 2 * Math.PI / 0.42));
    p.ha -= 7 * k; p.hd[1] -= 0.5 * k; p.tongue = k; p.eye = 0.5;
  }
  function wiping(p, u) {
    var c = frac(u / 1.15), q, a;
    p.ha = -30; p.hd = [4.2, 6.0];
    if (c < 0.62) {                                    // stroke: from behind the ear, over the eye, down to the nose
      q = smooth(c / 0.62);
      a = [lerp(lerp(-2.4, 2.2, q), lerp(2.2, 8.2, q), q), lerp(lerp(6.4, 7.4, q), lerp(7.4, -1.2, q), q)];
      p.ear = 34 * Math.sin(Math.PI * clamp(q * 1.6, 0, 1));
      p.eye = q > 0.25 && q < 0.85 ? 0 : 0.5;
      p.ha += 6 * q;
    } else {                                           // and back up over the top, clear of the face
      q = smooth((c - 0.62) / 0.38);
      a = [lerp(8.2, -2.4, q), lerp(-1.2, 6.4, q) + 3.2 * Math.sin(Math.PI * q)];
      p.ear = 4; p.eye = 0.5; p.ha += 6 * (1 - q);
    }
    p.nf = headPt(p, a);
  }

  // ---- drawing ----------------------------------------------------------------------------------------------------
  // a blunt, round muzzle with the nose at its front, and a chin under it
  var HEAD = new Path2D('M-5.6 0.6C-5.6 3.8-3 5.2 0 5.2C2.6 5.2 4.4 4.4 5.4 3C6.2 2.6 6.6 1.8 6.6 0.8C6.6-0.2 6.4-0.9 6-1.1' +
    'L0.6-1.2C0.6-2.4 0.2-3.4-0.6-3.8C-2.8-4-4.6-2.8-5.2-1.4C-5.5-0.8-5.6-0.2-5.6 0.6Z');
  var JAW = new Path2D('M0.6-1.2L6-1.1C6.4-2.2 6-3.4 4.8-3.9C3.4-4.2 1.6-4 0.2-3Z');
  var NEAR_EAR = new Path2D('M-1.6 4.2L0.6 9.6L3.4 3.6Z'), FAR_EAR = new Path2D('M-5.6 1.6L-4.6 8.4L-1.2 4.4Z');
  var BROW = new Path2D('M-3.6 4.4L-3 2.6M-1.8 5.1L-1.4 3.6');   // forehead stripes, kept back from the eye
  var HEART = ['.#.#.', '#####', '#####', '.###.', '..#..'];   // floats up after a slow blink
  var LETTER = { o: 'fur', d: 'far', s: 'stripe', w: 'cream', k: 'creamFar', e: 'ink', E: 'ink', g: 'eye', p: 'pink' };

  function line(c, pts) { c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (var i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]); }
  function len(pts) { var l = 0; for (var i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return l; }
  function stroke(c, color, w, cap) { c.strokeStyle = color; c.lineWidth = w; c.lineCap = cap || 'round'; c.lineJoin = 'round'; c.stroke(); }
  function oval(c, color, ctr, rx, ry, deg) {
    c.beginPath(); c.ellipse(ctr[0], ctr[1], rx, ry, (deg || 0) * Math.PI / 180, 0, 2 * Math.PI); c.fillStyle = color; c.fill();
  }
  // tabby bands along a stroked polyline: dashes given as fractions of its length
  function bands(c, pts, color, w, dash) {
    var l = len(pts);
    c.setLineDash(dash.map(function (d) { return d * l; }));
    line(c, pts); stroke(c, color, w, 'butt');
    c.setLineDash([]);
  }
  function ik(a, b, l1, l2, bend) {
    var dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1e-6;
    var dc = clamp(d, Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
    var ux = dx / d, uy = dy / d, along = (l1 * l1 - l2 * l2 + dc * dc) / (2 * dc);
    var hh = Math.sqrt(Math.max(0, l1 * l1 - along * along));
    return [[a[0] + ux * along - uy * hh * bend, a[1] + uy * along + ux * hh * bend], [a[0] + ux * dc, a[1] + uy * dc]];
  }
  function deg(v) { return Math.atan2(v[1], v[0]) * 180 / Math.PI; }

  // draw the rig in rig units (the caller has set the transform); returns the head centre
  function drawRig(c, C, p, T) {
    var sh = p.s, hp = p.h, L = Math.hypot(sh[0] - hp[0], sh[1] - hp[1]);
    var u = [(sh[0] - hp[0]) / L, (sh[1] - hp[1]) / L], n = [-u[1], u[0]];
    var sj = add(add(sh, n, -1), u, 0.4), hj = add(hp, n, -0.6), i;

    // legs taper: a thick upper bone, a slimmer lower one, a round paw
    function front(foot, fur, cream, striped) {
      var j = ik(sj, foot, ARM, FORE, -1), pts = [sj, j[0], j[1]];
      line(c, [sj, j[0]]); stroke(c, fur, 4.8);
      line(c, [j[0], j[1]]); stroke(c, fur, 3.4);
      if (striped) bands(c, [j[0], j[1]], C.stripe, 3.0, [0, 0.25, 0.18, 0.2, 0.18, 2]);
      oval(c, cream, add(j[1], [0.5, 0.1]), 2.2, 1.3, clamp((j[1][1] - 1.05) * -9, -50, 0));
    }
    function hind(foot, fur, cream, near) {
      var j = ik(hj, add(foot, p.hk), THIGH, SHIN, 1), hock = j[1], toe = add(hock, p.hk, -1);
      var tv = [j[0][0] - hj[0], j[0][1] - hj[1]], pts = [j[0], hock, toe];
      oval(c, fur, add(hj, tv, 0.36), THIGH / 2 + 3.2, 5.3, deg(tv));    // the haunch
      line(c, [j[0], hock]); stroke(c, fur, 3.6);
      line(c, [hock, toe]); stroke(c, fur, 3.0);
      if (near) {
        bands(c, pts, C.stripe, 3.0, [0, 0.3, 0.14, 0.14, 0.14, 2]);
        var a = add(hj, tv, 0.15), b = add(hj, tv, 0.75), nn = [-tv[1] / THIGH, tv[0] / THIGH];
        line(c, [add(a, nn, 3.2), add(mid(a, b), nn, 1.2), add(b, nn, 1.8)]); stroke(c, C.stripe, 1.6);
      }
      oval(c, cream, add(toe, [0.5, 0.1]), 2.2, 1.3, 0);
    }
    // the tail: a chain bent near the base (tc) and at the tip (tt), swaying in an S that grows toward the tip;
    // it tapers from root to tip, with tabby rings and a dark tip
    var RINGS = [0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 1];
    function tail() {
      var base = add(add(hp, u, -4.4), n, p.tb), pts = [base], a2 = p.ta, seg = TAIL_LEN / TAIL_N;
      for (var i = 0; i < TAIL_N; i++) {
        var r = i / TAIL_N;
        a2 += (r < 0.4 ? p.tc / (0.4 * TAIL_N) : 0) + (r >= 0.62 ? p.tt / (0.38 * TAIL_N) : 0) +
          p.tw / TAIL_N * (0.2 + 2.6 * r * r) * Math.sin(T * 2 * Math.PI / 3.4 - i * 0.32);
        var q = add(pts[i], [Math.cos(a2 * Math.PI / 180), Math.sin(a2 * Math.PI / 180)], seg);
        if (q[1] < 1.7) q[1] = 1.7;                    // it rests on the ground where it reaches it
        pts.push(q);
      }
      for (i = 0; i < TAIL_N; i++) {
        line(c, [pts[i], pts[i + 1]]); stroke(c, RINGS[i] ? C.stripe : C.fur, lerp(4.2, 2.4, i / (TAIL_N - 1)));
      }
    }

    front(p.ff, C.far, C.creamFar);
    hind(p.fh, C.far, C.creamFar);
    tail();

    // body: chest, back, rump and belly as one closed curve around the spine. It is a well-fed cat with a straight
    // back and a slim chest; its weight is in the pouch, a belly that swings low just in front of the hind legs
    var ts = p.ts + 0.3, th = p.th + 0.3, bs = p.bs + 0.2, bh = p.bh + 1.4, pouch = 4.8;
    var F = add(add(sh, u, 5.2), n, 0.2), Ts = add(sh, n, ts), Th = add(hp, n, th);
    var Rr = add(add(hp, u, -5.8), n, 0.6), Bh = add(hp, n, -bh), Bs = add(sh, n, -bs);
    var body = new Path2D('M' + pt(F) + 'C' + pt(add(F, n, 3.2)) + ' ' + pt(add(Ts, u, 2.8)) + ' ' + pt(Ts) +
      'C' + pt(add(Ts, u, -6)) + ' ' + pt(add(Th, u, 6)) + ' ' + pt(Th) +
      'C' + pt(add(Th, u, -3.4)) + ' ' + pt(add(Rr, n, 3.2)) + ' ' + pt(Rr) +
      'C' + pt(add(Rr, n, -3.4)) + ' ' + pt(add(Bh, u, -2.6)) + ' ' + pt(Bh) +
      'C' + pt(add(add(Bh, u, 1.5), n, -pouch)) + ' ' + pt(add(add(Bs, u, -5), n, -0.2)) + ' ' + pt(Bs) +
      'C' + pt(add(Bs, u, 2.8)) + ' ' + pt(add(F, n, -3)) + ' ' + pt(F) + 'Z');
    c.fillStyle = C.fur; c.fill(body);
    c.save(); c.clip(body);
    var ang = deg(u);
    oval(c, C.cream, add(add(hp, u, L * 0.28), n, -bh - pouch * 0.5), L / 3 + 1, 2.4, ang);
    oval(c, C.cream, add(add(sh, u, 4), n, -1.6), 3.2, 3.6, ang);
    var ns = Math.max(2, Math.round(L / 4.4));
    for (i = 0; i < ns; i++) {                        // tabby stripes down from the spine, raked back, a pixel or two apart
      var k = (i + 0.4) / ns, top = add(add(sh, u, -k * L), n, lerp(ts, th, k) + 1);
      var bot = add(add(top, n, i === ns - 1 ? -5 : -4.2), u, -1.4);
      line(c, [top, add(mid(top, bot), u, 0.6), bot]); stroke(c, C.stripe, 2);
    }
    c.restore();

    // neck and bib, then the near legs and the head
    line(c, [add(add(sh, u, 1.4), n, 1.6), headPt(p, [-2, -1.2])]); stroke(c, C.fur, 8);
    line(c, [add(add(sh, u, 4.4), n, -1.2), headPt(p, [2.4, -2.6])]); stroke(c, C.cream, 3);
    hind(p.nh, C.fur, C.cream, true);
    if (p.pf <= 0.5) front(p.nf, C.fur, C.cream, true);

    var hc = add(sh, p.hd);
    c.save();
    c.translate(hc[0], hc[1]); c.rotate(p.ha * Math.PI / 180);
    c.save(); c.translate(-3.6, 3.6); c.rotate(p.ear * 0.8 * Math.PI / 180); c.translate(3.6, -3.6);
    c.fillStyle = C.fur; c.fill(FAR_EAR); c.restore();
    c.fillStyle = C.fur; c.fill(HEAD);
    c.save(); c.clip(HEAD);
    oval(c, C.cream, [5.2, -0.6], 2.1, 1.8);
    c.strokeStyle = C.stripe; c.lineWidth = 1.5; c.lineCap = 'round'; c.stroke(BROW);
    c.restore();
    if (p.mouth > 0.05) {                              // the yawn: the jaw swings down on its hinge
      var jawA = -30 * p.mouth, lip = add([0.6, -1.2], rot([5.5, 0.3], jawA));
      line(c, [[0.6, -1.2], [6.4, -0.8], lip]); c.fillStyle = C.ink; c.fill();
    }
    c.save(); c.translate(0.6, -1.2); c.rotate(-30 * p.mouth * Math.PI / 180); c.translate(-0.6, 1.2);
    if (p.mouth > 0.3) oval(c, C.pink, [3.8, -1.1], 2, 0.9);
    c.fillStyle = C.cream; c.fill(JAW);
    c.restore();
    if (p.tongue > 0.05) oval(c, C.pink, [6.6 + p.tongue, -1.3], 0.7 + p.tongue * 0.9, 0.95);
    c.save(); c.translate(-0.6, 4.4); c.rotate(p.ear * Math.PI / 180); c.translate(0.6, -4.4);
    c.fillStyle = C.fur; c.fill(NEAR_EAR); c.restore();
    c.restore();

    if (p.pf > 0.5) front(p.nf, C.fur, C.cream, true);
    return hc;
  }

  function hex(c) { c = c.trim(); if (c.length === 4) c = '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3]; return [1, 3, 5].map(function (i) { return parseInt(c.substr(i, 2), 16); }); }
  // The rig is drawn SS times finer than the art; each art pixel then takes the color most of its SS x SS block has
  // (snapped to the coat's palette), or stays clear. No soft edges, no in-between colors, and small dark details (an
  // eye, the nose, a stripe) count for more so they survive.
  var SS = 4, WEIGHT = [1, 1, 1.5, 1.1, 1, 3, 2.6];   // fur, far fur, stripe, cream, far cream, ink, pink
  // returns the first and last columns and the top row it filled, in dst's pixels, or null if it drew nothing
  function pixelate(src, dst, x0, w, h, pal) {
    var d = src.getImageData(0, 0, w * SS, h * SS).data, out = dst.createImageData(w, h), o = out.data;
    var votes = new Float32Array(pal.length), j, bl = 1e9, br = -1, bt = 1e9;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var clear = 0;
      for (j = 0; j < pal.length; j++) votes[j] = 0;
      for (var sy = 0; sy < SS; sy++) for (var sx = 0; sx < SS; sx++) {
        var i = ((y * SS + sy) * w * SS + x * SS + sx) * 4;
        if (d[i + 3] < 128) { clear++; continue; }
        var best = 0, bd = 1e9;
        for (j = 0; j < pal.length; j++) {
          var q = pal[j], e = (d[i] - q[0]) * (d[i] - q[0]) + (d[i + 1] - q[1]) * (d[i + 1] - q[1]) + (d[i + 2] - q[2]) * (d[i + 2] - q[2]);
          if (e < bd) { bd = e; best = j; }
        }
        votes[best] += WEIGHT[best];
      }
      var win = -1, wv = clear;
      for (j = 0; j < pal.length; j++) if (votes[j] > wv) { wv = votes[j]; win = j; }
      if (win < 0) continue;
      bl = Math.min(bl, x); br = Math.max(br, x); bt = Math.min(bt, y);
      var k = (y * w + x) * 4;
      o[k] = pal[win][0]; o[k + 1] = pal[win][1]; o[k + 2] = pal[win][2]; o[k + 3] = 255;
    }
    dst.putImageData(out, x0, 0);
    return br < 0 ? null : [x0 + bl, x0 + br, bt];
  }
  function glyph(c, g, x, y, color) {
    c.fillStyle = color;
    g.forEach(function (row, r) { for (var k = 0; k < row.length; k++) if (row[k] === '#') c.fillRect(Math.round(x) + k, Math.round(y) + r, 1, 1); });
  }

  // ---- the cat ----------------------------------------------------------------------------------------------------
  // canvas: one pixel per art pixel, ROWS tall; world: { width(), rest() } in px along the lane
  function Cat(canvas, world) {
    var c = canvas.getContext('2d'), C = {}, pal = [], inkAt = -99, SPAN = 32;
    var fine = document.createElement('canvas'), fc = fine.getContext('2d', { willReadFrequently: true });
    fine.width = 2 * SPAN * SS; fine.height = ROWS * SS;
    var W = world.width(), X = W + 34 * S, F = -1;
    var cur = null, prev = STAND, queue = [], petted = false, blinkAt = -99, T = 0, box = null;
    var petting = 0, petAt = -1, soften = 0;          // how hard it is being stroked (0..1); since when, asleep
    var purrUntil = -1, PURR = 4;                     // a click sets it purring for PURR s

    function colors() {                               // the coat from main.css
      var cs = getComputedStyle(canvas);
      ['fur', 'fur-far', 'stripe', 'cream', 'cream-far', 'ink', 'pink', 'eye'].forEach(function (k) {
        C[k.replace(/-(\w)/, function (m, a) { return a.toUpperCase(); })] = cs.getPropertyValue('--' + k).trim();
      });
      pal = [C.fur, C.furFar, C.stripe, C.cream, C.creamFar, C.ink, C.pink].map(hex);
      C.far = C.furFar;
    }
    colors();

    // hand-drawn frames, each held for its time; posed as the loaf, so the rig carries on from there
    function spriteAct(frames, extra) {
      var dur = frames.reduce(function (t, f) { return t + f[1]; }, 0);
      return act(dur, 0, function () { return pose(LOAF, { eye: 0 }); }, Object.assign({ busy: true, sprite: function (u) {
        for (var i = 0; i < frames.length - 1 && u >= frames[i][1]; i++) u -= frames[i][1];
        return frames[i][0];
      } }, extra));
    }
    function sleepAct(dur) {
      return spriteAct([[SLEEP_IN, dur]], { sleep: true, sprite: function (u, T) { return frac(T / 3.8) < 0.5 ? SLEEP_IN : SLEEP_OUT; } });
    }
    // clicked while awake: it stops, turns its face to you, blinks, and goes back to what it was doing
    function lookAct() {
      return still(STAND, 1.9, 0.5, function (p, u) {
        var m = bump(u, 0.3, 1.1, 0.4);
        p.look = m; p.ha = 10 * m; p.hd[1] += 0.5 * m; p.ear -= 6 * m;
        if (u > 0.85 && u < 1.05) p.eye = 0;
      }, { busy: true });
    }
    // stroked while awake: it sits, chin up and eyes shut happy, and kneads, for as long as the stroking lasts
    function petAct() {
      return still(SIT, 1e9, 0.6, function (p, u) {
        var k = Math.sin(u * 2 * Math.PI * 1.25);
        p.ha = 14; p.happy = 1; p.ear = -4; p.tw = 2;
        p.nf[1] += 1.6 * Math.max(0, k); p.ff[1] += 1.6 * Math.max(0, -k);
      }, { busy: true, pet: true });
    }
    function arrive() {
      return [
        function () { return still(STAND, 0.6, 0.5); },
        function () { return still(SNIFF, 1.6, 0.6, function (p, u) { p.hd[1] += 0.35 * Math.sin(u * 22) * bump(u, 0.5, 0.6, 0.3); }); },
        function () { return still(STAND, 0.7, 0.5, function (p) { p.ha = 6; }); },
        function () { return still(SIT, 0.9, 0.9); },
        function () { return still(LICK, 0.55, 0.55, pawAtMouth); },
        function () { return still(LICK, 1.7, 0, licking); },
        function () { return still(LICK, 2.3, 0.35, wiping); },
        function () { return still(LICK, 1.3, 0.35, licking); },
        function () { return still(SIT, 0.6, 0.6); },
        function () { return still(SIT, 1.9, 0.4, function (p, u) {
          var m = bump(u, 0.55, 0.5, 0.6);
          p.ha = 4 + 18 * m; p.mouth = m; p.eye = 1 - 1.2 * m; p.ear = 20 * m; p.hd[1] += 0.6 * m; p.tw = 3 + 8 * m;
        }); },
        function () { return still(STAND, 0.7, 0.7); },
        function () { return turnAct(F, 2, 1.5); },
        function () { return still(LOAF, 1.1, 1.1, null, { busy: true }); },
        function () { return spriteAct([[CURL1, 0.6], [CURL2, 0.7]]); },   // the tail sweeps round, the head goes down
        function () { return sleepAct(Infinity); }          // and that is where it stays
      ];
    }
    queue = [function () { return walkAct(X, world.rest()); }].concat(arrive());

    function next(t0) {
      if (cur) {
        prev = cur.pose(cur.dur, t0);
        if (cur.x) X = cur.x(cur.dur);
        F = cur.fEnd !== undefined ? cur.fEnd : typeof cur.f === 'number' ? cur.f : F;
      }
      var a = null;
      while (!a) { if (!queue.length) queue = [function () { return sleepAct(Infinity); }]; a = queue.shift()(); }
      if (soften > 0) { soften--; a.blend = Math.max(a.blend, 0.5); }   // no snapping back after an interruption
      a.t0 = t0; cur = a;
    }
    // stop what it is doing and do this first; a walk then carries on to where it was going
    function interrupt(make) {
      if (!cur || cur.busy || cur.sleep) return;
      var to = cur.to;
      queue.unshift(make);
      if (to !== undefined) queue.splice(1, 0, function () { return walkAct(X, to); });
      soften = 2; cur.dur = T - cur.t0; next(T);
    }

    function frame(t) {
      T = t;
      if (!cur) next(0);
      if (cur.pet && petting < 0.05 && T - cur.t0 > 1.2) cur.dur = T - cur.t0;
      while (T - cur.t0 >= cur.dur) next(cur.t0 + cur.dur);
      var u = T - cur.t0, raw = cur.pose(u, T);
      var p = cur.blend && u < cur.blend ? mix(prev, raw, u / cur.blend) : raw;
      var x = cur.x ? cur.x(u) : X, f = typeof cur.f === 'function' ? cur.f(u) : typeof cur.f === 'number' ? cur.f : F;
      var dir = f < 0 ? -1 : 1;

      // a blink every few seconds, and an ear that flicks now and then
      var k = Math.floor(T / 4.3), bt = T - k * 4.3 - rnd(k) * 3;
      if (p.eye > 0.3 && bt > 0 && bt < 0.2) p.eye = 0;
      k = Math.floor(T / 2.9); bt = T - k * 2.9 - rnd(k + 40) * 2;
      if (rnd(k + 70) < 0.4 && bt > 0 && bt < 0.28) p.ear += 30 * Math.sin(Math.PI * bt / 0.28);
      var sleeping = !!cur.sleep && u > 0.4, sb = T - blinkAt;
      if (sleeping && (petted || petting > 0.05)) { p.happy = 1; p.ear = 0; }
      if (sleeping && petting > 0.3) { if (petAt < 0) petAt = T; } else petAt = -1;
      if (sleeping && sb < 2.2) { p.happy = 0; p.eye = bump(sb, 0.45, 0.5, 1.2) > 0.4 ? 0.6 : 0; }   // a slow blink, when clicked

      if (T - inkAt > 1) { colors(); inkAt = T; }
      var w = canvas.width, h = canvas.height, ax = Math.round(x / PX);
      // after a click it purrs: the whole canvas buzzes by one screen pixel, finer than an art pixel
      canvas.style.transform = T < purrUntil && Math.round(T * FPS) % 2 ? 'translateX(1px)' : '';
      c.clearRect(0, 0, w, h);
      var hx, hy, eye = clamp(p.eye, 0, 1);
      if (cur.sprite) {
        var g = cur.sprite(u, T), y0 = h - g.length;
        var px = function (gx, gy, color) { c.fillStyle = color; c.fillRect(ax + dir * (SPR_O - gx), y0 + gy, 1, 1); };
        g.forEach(function (row, gy) {
          for (var gx = 0; gx < row.length; gx++) if (row[gx] !== '.') px(gx, gy, C[LETTER[row[gx]]]);
        });
        var ex = SPR_EYE[0], ey = SPR_EYE[1];           // the eye: shut, or a ^ when content, or half open under its lid
        if (p.happy) { px(ex + 1, ey, C.fur); px(ex, ey, C.ink); px(ex + 1, ey - 1, C.ink); px(ex + 2, ey, C.ink); }
        else if (eye > 0.3) { px(ex, ey - 1, C.ink); px(ex + 1, ey - 1, C.ink); px(ex, ey, C.ink); px(ex + 1, ey, C.eye); }
        if (petAt >= 0 && T - petAt > 1) KNEAD[Math.floor(T * 5) % 2].forEach(function (q) { px(q[0], q[1], C[LETTER[q[2]]]); });
        hx = ax + dir * (SPR_O - SPR_HEAD[0]); hy = y0 + SPR_HEAD[1];
        box = [(ax - 14) * PX, (ax + 14) * PX, (g.length + 1) * PX];
      } else {
        fc.setTransform(1, 0, 0, 1, 0, 0);
        fc.clearRect(0, 0, fine.width, fine.height);
        fc.setTransform(f * K * SS, 0, 0, -K * SS, SPAN * SS, h * SS);
        var hc = drawRig(fc, C, p, T);
        var bb = pixelate(fc, c, ax - SPAN, 2 * SPAN, h, pal);
        box = bb && [bb[0] * PX, (bb[1] + 1) * PX, (h - bb[2]) * PX];
        // the face is placed by hand, pixel by pixel, where the rig's head says it is: an eye (a dark pupil with the
        // greenish-yellow iris behind it, a line shut, or a ^ when happy) and a pink nose; looking at you, both eyes
        // and the nose come round to the front
        var at = function (q) { var l = headPt(p, q); return [Math.floor(ax + f * K * l[0]), Math.floor(h - K * l[1])]; };
        var ep = at([1.5, 1.6]), no = at([6.2, 0.9]), eyes = [ep];
        if (p.look > 0.5) { eyes = [at([1.2, 1.6]), at([5.0, 1.6])]; no = at([6.4, -0.2]); }
        c.fillStyle = C.ink;
        eyes.forEach(function (ep) {
          c.fillStyle = C.ink;
          if (p.happy) { c.fillRect(ep[0] - 1, ep[1], 1, 1); c.fillRect(ep[0], ep[1] - 1, 1, 1); c.fillRect(ep[0] + 1, ep[1], 1, 1); }
          else if (eye > 0.6) { c.fillRect(ep[0], ep[1] - 1, 1, 2); c.fillStyle = C.eye; c.fillRect(ep[0] - dir, ep[1] - 1, 1, 2); }
          else if (eye > 0.3) { c.fillRect(ep[0], ep[1], 1, 1); c.fillStyle = C.eye; c.fillRect(ep[0] - dir, ep[1], 1, 1); }
          else c.fillRect(ep[0] - (dir < 0 ? 0 : 1), ep[1], 2, 1);
        });
        if (Math.abs(f) > 0.5) { c.fillStyle = C.pink; c.fillRect(no[0], no[1], 1, 1); }
        hx = ax + f * K * hc[0]; hy = h - K * hc[1];
      }
      var hu = (sb - 0.4) / 1.8;
      if (sleeping && hu > 0 && hu < 1) glyph(c, HEART, hx + dir * 3 - 2, hy - 5 - 9 * hu, C.pink);
    }

    return {
      frame: frame,
      resize: function () {
        W = world.width();
        canvas.width = Math.ceil(W / PX); canvas.height = ROWS;
        if (cur && cur.sleep) X = world.rest();
        frame(T);
      },
      hover: function (on) { petted = on; },
      poke: function () {                              // asleep: a slow blink; awake: it stops and looks at you
        if (!cur || cur.busy && !cur.sleep) return;
        purrUntil = T + PURR;
        if (cur.sleep) { if (T - blinkAt > 2.2) blinkAt = T; } else interrupt(lookAct);
      },
      pet: function (level) { petting = level; if (level > 0.3) interrupt(petAct); },
      box: function () { return box; },
      settleAsleep: function () { X = world.rest(); cur = sleepAct(Infinity); cur.t0 = 0; frame(1); },
      act: function () { return cur; }
    };
  }
  window.FooterCat = Cat;

  // ---- on the page ------------------------------------------------------------------------------------------------
  var footer = document.querySelector('.site-footer');
  if (!footer || !window.IntersectionObserver || !window.requestAnimationFrame) return;

  setTimeout(function () {
    var lane = document.createElement('div');
    lane.className = 'cat-lane';
    lane.setAttribute('aria-hidden', 'true');
    lane.innerHTML = '<canvas class="cat"></canvas><div class="cat-hit"></div>';
    footer.appendChild(lane);
    var canvas = lane.firstChild, hit = lane.lastChild;
    var cat = Cat(canvas, {
      width: function () { return lane.clientWidth; },
      rest: function () {                             // nose where the copyright starts
        var e = footer.querySelector('.footer-inner p');
        return (e ? e.getBoundingClientRect().left - footer.getBoundingClientRect().left : 24) + 21 * S;
      }
    });
    // the canvas's height is CSS's; its width is a whole number of art pixels, so every pixel is the same size
    function fit() { cat.resize(); canvas.style.width = canvas.width * PX + 'px'; place(); }
    function place() {
      var b = cat.box();
      hit.style.display = b ? 'block' : 'none';
      if (b) { hit.style.left = b[0] + 'px'; hit.style.width = (b[1] - b[0]) + 'px'; hit.style.height = b[2] + 'px'; }
    }
    // stroking: the pointer going back and forth over the cat, turning at least twice in a second and a half
    var strokeX = null, strokeDir = 0, flips = [], stroked = 0;
    hit.addEventListener('pointermove', function (e) {
      if (strokeX !== null) {
        var dx = e.clientX - strokeX, d = dx > 1 ? 1 : dx < -1 ? -1 : 0;
        if (!d) return;
        if (strokeDir && d !== strokeDir) flips.push(e.timeStamp);
        strokeDir = d; stroked = Math.min(1.5, stroked + Math.abs(dx) / 60);
      }
      strokeX = e.clientX;
    });
    fit();
    hit.addEventListener('pointerenter', function () { cat.hover(true); });
    hit.addEventListener('pointerleave', function () { cat.hover(false); strokeX = null; strokeDir = 0; });
    hit.addEventListener('click', function () { cat.poke(); });
    window.addEventListener('resize', fit);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { cat.settleAsleep(); place(); return; }

    // the clock runs only while the lane is on screen; the walk in waits until all of it is
    var T = 0, last = null, shown = -1, seen = false, visible = false, raf = 0;
    function tick(now) {
      raf = 0;
      if (!visible) { last = null; return; }
      var dt = last === null ? 0 : Math.min(0.1, (now - last) / 1000);
      T += dt; last = now;
      stroked *= Math.exp(-dt / 0.5);
      flips = flips.filter(function (t) { return now - t < 1500; });
      cat.pet(flips.length >= 2 ? Math.min(1, stroked) : 0);
      var fr = Math.floor(T * FPS);
      if (fr !== shown) { shown = fr; cat.frame(fr / FPS); place(); }
      raf = requestAnimationFrame(tick);
    }
    new IntersectionObserver(function (entries) {
      var r = entries[0].intersectionRatio;
      if (r > 0.99) seen = true;
      visible = seen && r > 0;
      if (visible && !raf) raf = requestAnimationFrame(tick);
    }, { threshold: [0, 1] }).observe(lane);
  }, DELAY);
})();
