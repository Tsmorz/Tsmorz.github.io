// VisionCore — the maths behind /vision/. No DOM, so script/test-vision runs it in Node.
//   • images: { w, h, c, d } with c = 1 (grey) or 3 (RGB), values 0..1, row-major, channels interleaved
//   • the running scene: a ball rolling on a table, seen by a tilted camera (rendered here, pixel by pixel)
//   • filters: convolution (correlation, as CNN libraries do it), box and Gaussian kernels, Sobel
//   • segmentation: redness, histogram, connected blobs with area and roundness
//   • features: Harris corners, patch descriptors, ratio-test matching, RANSAC homography
//   • geometry: the 4-point homography, affine matrices, warping with bilinear sampling
//   • two cameras: a rectified stereo pair rendered by ray casting, block matching, triangulation
//   • learning: one 3×3 filter fitted by gradient descent, and a two-layer CNN that marks the ball
//   • tracking: a constant-velocity Kalman filter with a gate
(function (root) {
  'use strict';
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  /* ---------------- images ---------------- */
  function image(w, h, c) { return { w: w, h: h, c: c || 1, d: new Float32Array(w * h * (c || 1)) }; }
  function gray(im) {
    if (im.c === 1) return im;
    var o = image(im.w, im.h, 1), d = im.d;
    for (var i = 0, n = im.w * im.h; i < n; i++) o.d[i] = 0.299 * d[3 * i] + 0.587 * d[3 * i + 1] + 0.114 * d[3 * i + 2];
    return o;
  }
  // How red a pixel is: red minus the mean of green and blue. The ball and the pencil are the only red things.
  function redness(im) {
    var o = image(im.w, im.h, 1), d = im.d;
    for (var i = 0, n = im.w * im.h; i < n; i++) o.d[i] = d[3 * i] - 0.5 * (d[3 * i + 1] + d[3 * i + 2]);
    return o;
  }
  // Fewer pixels: average each f×f block, then repeat it so the image keeps its size.
  function pixelate(im, f) {
    if (f <= 1) return im;
    var o = image(im.w, im.h, im.c), c = im.c;
    for (var by = 0; by < im.h; by += f) for (var bx = 0; bx < im.w; bx += f) {
      var y1 = Math.min(im.h, by + f), x1 = Math.min(im.w, bx + f), n = (y1 - by) * (x1 - bx);
      for (var k = 0; k < c; k++) {
        var s = 0, x, y;
        for (y = by; y < y1; y++) for (x = bx; x < x1; x++) s += im.d[(y * im.w + x) * c + k];
        for (y = by; y < y1; y++) for (x = bx; x < x1; x++) o.d[(y * im.w + x) * c + k] = s / n;
      }
    }
    return o;
  }
  // Fewer levels: round every value to one of 2^bits.
  function quantize(im, bits) {
    var L = Math.pow(2, bits) - 1, o = image(im.w, im.h, im.c);
    for (var i = 0; i < im.d.length; i++) o.d[i] = Math.round(clamp(im.d[i], 0, 1) * L) / L;
    return o;
  }
  function gaussian(rand) { var u = 0, v = 0; while (u === 0) u = rand(); while (v === 0) v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function addNoise(im, sigma, rand) {
    var o = image(im.w, im.h, im.c);
    for (var i = 0; i < im.d.length; i++) o.d[i] = sigma > 0 ? im.d[i] + sigma * gaussian(rand) : im.d[i];
    return o;
  }
  function std(im) {
    var m = 0, s = 0, n = im.d.length, i;
    for (i = 0; i < n; i++) m += im.d[i];
    m /= n; for (i = 0; i < n; i++) s += (im.d[i] - m) * (im.d[i] - m);
    return Math.sqrt(s / n);
  }
  function sub(a, b) { var o = image(a.w, a.h, a.c); for (var i = 0; i < a.d.length; i++) o.d[i] = a.d[i] - b.d[i]; return o; }

  /* ---------------- filters ---------------- */
  // out(x, y) = Σ k(i, j) · im(x + i − r, y + j − r): the kernel slides over the image (borders repeat the edge pixel).
  function convolve(im, k, n) {
    var o = image(im.w, im.h, im.c), r = (n - 1) >> 1, w = im.w, h = im.h, c = im.c;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) for (var ch = 0; ch < c; ch++) {
      var s = 0;
      for (var j = 0; j < n; j++) {
        var yy = clamp(y + j - r, 0, h - 1);
        for (var i = 0; i < n; i++) s += k[j * n + i] * im.d[(yy * w + clamp(x + i - r, 0, w - 1)) * c + ch];
      }
      o.d[(y * w + x) * c + ch] = s;
    }
    return o;
  }
  // The same, for a kernel that is a row times a column (box, Gaussian): two passes of n instead of one of n².
  function convolveSep(im, k1) {
    var n = k1.length, r = (n - 1) >> 1, w = im.w, h = im.h, c = im.c, tmp = image(w, h, c), o = image(w, h, c), x, y, ch, i, s;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) for (ch = 0; ch < c; ch++) {
      for (s = 0, i = 0; i < n; i++) s += k1[i] * im.d[(y * w + clamp(x + i - r, 0, w - 1)) * c + ch];
      tmp.d[(y * w + x) * c + ch] = s;
    }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) for (ch = 0; ch < c; ch++) {
      for (s = 0, i = 0; i < n; i++) s += k1[i] * tmp.d[(clamp(y + i - r, 0, h - 1) * w + x) * c + ch];
      o.d[(y * w + x) * c + ch] = s;
    }
    return o;
  }
  // Kernels carry their 2-D weights k (n×n, for drawing) and the 1-D row k1 they are made of (for convolveSep).
  function boxKernel(n) { var k1 = new Array(n).fill(1 / n), k = []; for (var i = 0; i < n * n; i++) k.push(1 / (n * n)); return { k: k, k1: k1, n: n }; }
  function gaussianKernel(sigma) {
    var r = Math.max(1, Math.ceil(2.5 * sigma)), n = 2 * r + 1, k1 = [], s = 0, i;
    for (i = 0; i < n; i++) { k1.push(Math.exp(-(i - r) * (i - r) / (2 * sigma * sigma))); s += k1[i]; }
    k1 = k1.map(function (v) { return v / s; });
    var k = []; for (var j = 0; j < n; j++) for (i = 0; i < n; i++) k.push(k1[i] * k1[j]);
    return { k: k, k1: k1, n: n };
  }
  var SOBEL_X = [-1, 0, 1, -2, 0, 2, -1, 0, 1], SOBEL_Y = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
  var KERNELS = {                                   // what "Learn a filter" can be asked to learn
    sobelx: SOBEL_X, sobely: SOBEL_Y,
    blur: [1, 2, 1, 2, 4, 2, 1, 2, 1].map(function (v) { return v / 16; }),
    sharpen: [0, -1, 0, -1, 5, -1, 0, -1, 0]
  };
  // Sobel: the slope across (gx) and down (gy), its size and its direction.
  function sobel(g) {
    var gx = convolve(g, SOBEL_X, 3), gy = convolve(g, SOBEL_Y, 3), mag = image(g.w, g.h, 1), dir = image(g.w, g.h, 1);
    for (var i = 0; i < mag.d.length; i++) { mag.d[i] = Math.hypot(gx.d[i], gy.d[i]); dir.d[i] = Math.atan2(gy.d[i], gx.d[i]); }
    return { gx: gx, gy: gy, mag: mag, dir: dir };
  }

  /* ---------------- segmentation ---------------- */
  function histogram(g, bins, lo, hi) {
    var h = new Array(bins).fill(0);
    for (var i = 0; i < g.d.length; i++) h[clamp(Math.floor((g.d[i] - lo) / (hi - lo) * bins), 0, bins - 1)]++;
    return h;
  }
  function threshold(g, t) { var m = new Uint8Array(g.w * g.h); for (var i = 0; i < m.length; i++) m[i] = g.d[i] > t ? 1 : 0; return m; }
  // Connected blobs (8-neighbours). Roundness is √(λmin/λmax) of the blob's spread: 1 for a disc, near 0 for a line.
  function blobs(mask, w, h, minArea) {
    var lab = new Int32Array(w * h), out = [], stack = [];
    for (var s = 0; s < w * h; s++) {
      if (!mask[s] || lab[s]) continue;
      var id = out.length + 1, n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
      lab[s] = id; stack.push(s);
      while (stack.length) {
        var p = stack.pop(), px = p % w, py = (p - px) / w;
        n++; sx += px; sy += py; sxx += px * px; syy += py * py; sxy += px * py;
        if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
          var qx = px + dx, qy = py + dy; if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
          var q = qy * w + qx; if (mask[q] && !lab[q]) { lab[q] = id; stack.push(q); }
        }
      }
      var cx = sx / n, cy = sy / n, a = sxx / n - cx * cx + 1 / 12, b = syy / n - cy * cy + 1 / 12, cxy = sxy / n - cx * cy;
      var tr = (a + b) / 2, det = Math.sqrt(Math.max(0, (a - b) * (a - b) / 4 + cxy * cxy)), l1 = tr + det, l2 = Math.max(0, tr - det);
      out.push({ id: id, area: n, cx: cx + 0.5, cy: cy + 0.5, x0: x0, y0: y0, x1: x1 + 1, y1: y1 + 1, round: Math.sqrt(l2 / l1) });
    }
    return { blobs: out.filter(function (b) { return b.area >= (minArea || 1); }), labels: lab };
  }
  // Which blob is the ball: the largest one, or the largest one round enough.
  function pickBall(list, minRound) {
    var best = null;
    list.forEach(function (b) { if (b.round >= (minRound || 0) && (!best || b.area > best.area)) best = b; });
    return best;
  }

  // The ball detector the later lessons share: red pixels above t, blobs of 4+ pixels, the largest one at least minRound
  // round. Returns its centroid in pixels and on the table (cm), or null.
  function detectBall(im, t, minRound) {
    var red = redness(im), b = blobs(threshold(red, t), im.w, im.h, 4).blobs, best = pickBall(b, minRound);
    if (!best) return null;
    var p = toTable(best.cx, best.cy);
    return { u: best.cx, v: best.cy, x: p[0], y: p[1] - BALL_R * 0.35, blob: best, all: b };
  }

  /* ---------------- geometry ---------------- */
  function solve(A, b) {                             // Gaussian elimination with partial pivoting
    var n = b.length, M = A.map(function (r, i) { return r.concat([b[i]]); });
    for (var c = 0; c < n; c++) {
      var p = c; for (var r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      var t = M[c]; M[c] = M[p]; M[p] = t;
      if (Math.abs(M[c][c]) < 1e-12) return null;
      for (r = c + 1; r < n; r++) { var f = M[r][c] / M[c][c]; for (var k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
    }
    var x = new Array(n);
    for (var i = n - 1; i >= 0; i--) { var s = M[i][n]; for (var j = i + 1; j < n; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i]; }
    return x;
  }
  // The homography that sends four points src[i] = [x, y] to dst[i] (h33 = 1): eight equations, eight unknowns.
  function homography(src, dst) {
    var A = [], b = [];
    for (var i = 0; i < 4; i++) {
      var x = src[i][0], y = src[i][1], u = dst[i][0], v = dst[i][1];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    var h = solve(A, b); if (!h) return null;
    return [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]];
  }
  function applyH(H, x, y) {
    var w = H[2][0] * x + H[2][1] * y + H[2][2];
    return [(H[0][0] * x + H[0][1] * y + H[0][2]) / w, (H[1][0] * x + H[1][1] * y + H[1][2]) / w, w];
  }
  function inv3(M) {
    var a = M[0][0], b = M[0][1], c = M[0][2], d = M[1][0], e = M[1][1], f = M[1][2], g = M[2][0], h = M[2][1], i = M[2][2];
    var A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
    if (Math.abs(det) < 1e-15) return null;
    var R = [[A, -(b * i - c * h), b * f - c * e], [B, a * i - c * g, -(a * f - c * d)], [C, -(a * h - b * g), a * e - b * d]];
    return R.map(function (r) { return r.map(function (v) { return v / det; }); });
  }
  function mul3(A, B) { return A.map(function (r) { return [0, 1, 2].map(function (j) { return r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]; }); }); }
  // Rotate by `deg` and scale by s about (cx, cy), shear by k, then shift by (tx, ty): a 2×3 affine as a 3×3.
  function affine(o) {
    var t = (o.rot || 0) * Math.PI / 180, s = o.scale || 1, k = o.shear || 0, c = Math.cos(t) * s, sn = Math.sin(t) * s;
    var M = [[c, c * k - sn, 0], [sn, sn * k + c, 0], [0, 0, 1]];
    var toO = [[1, 0, -(o.cx || 0)], [0, 1, -(o.cy || 0)], [0, 0, 1]], back = [[1, 0, (o.cx || 0) + (o.tx || 0)], [0, 1, (o.cy || 0) + (o.ty || 0)], [0, 0, 1]];
    return mul3(back, mul3(M, toO));
  }
  // out(u, v) = im(Hinv · (u, v)), sampled bilinearly; outside the source is NaN (drawn as empty).
  function warp(im, Hinv, w, h) {
    var o = image(w, h, im.c), c = im.c;
    for (var v = 0; v < h; v++) for (var u = 0; u < w; u++) {
      var p = applyH(Hinv, u + 0.5, v + 0.5), x = p[0] - 0.5, y = p[1] - 0.5, at = (v * w + u) * c;
      if (!(p[2] > 0) || x < 0 || y < 0 || x > im.w - 1 || y > im.h - 1) { for (var k = 0; k < c; k++) o.d[at + k] = NaN; continue; }
      var x0 = Math.min(im.w - 2, Math.floor(x)), y0 = Math.min(im.h - 2, Math.floor(y)), fx = x - x0, fy = y - y0;
      for (k = 0; k < c; k++) {
        var i00 = im.d[(y0 * im.w + x0) * c + k], i10 = im.d[(y0 * im.w + x0 + 1) * c + k], i01 = im.d[((y0 + 1) * im.w + x0) * c + k], i11 = im.d[((y0 + 1) * im.w + x0 + 1) * c + k];
        o.d[at + k] = (i00 * (1 - fx) + i10 * fx) * (1 - fy) + (i01 * (1 - fx) + i11 * fx) * fy;
      }
    }
    return o;
  }

  /* ---------------- the scene: a ball on a table ---------------- */
  // The table is 100 × 50 cm; the camera sees it from the near long side, tilted, so the far side looks shorter.
  // CAM maps table centimetres to camera pixels. Everything below is drawn from it.
  var W = 192, H = 144, TABLE = { w: 100, h: 50 }, BALL_R = 4;
  var TABLE_CORNERS = [[0, 0], [100, 0], [100, 50], [0, 50]];
  var CAM_CORNERS = [[14, 132], [178, 129], [142, 38], [47, 41]];   // near-left, near-right, far-right, far-left
  var CAM = homography(TABLE_CORNERS, CAM_CORNERS), CAM_INV = inv3(CAM);
  var PIX_WORLD = null;
  function pixWorld() {                              // table coordinates of every pixel, worked out once
    if (PIX_WORLD) return PIX_WORLD;
    var wx = new Float32Array(W * H), wy = new Float32Array(W * H), ok = new Uint8Array(W * H);
    for (var v = 0; v < H; v++) for (var u = 0; u < W; u++) {
      var p = applyH(CAM_INV, u + 0.5, v + 0.5), i = v * W + u;
      wx[i] = p[0]; wy[i] = p[1]; ok[i] = p[2] > 0 ? 1 : 0;
    }
    return (PIX_WORLD = { wx: wx, wy: wy, ok: ok });
  }
  function toPixel(x, y) { var p = applyH(CAM, x, y); return [p[0], p[1]]; }
  function toTable(u, v) { var p = applyH(CAM_INV, u, v); return [p[0], p[1]]; }
  function ballPixel(x, y) {                         // where the ball's centre lands, and how big it looks
    var c = toPixel(x, y + BALL_R * 0.35), e = toPixel(x + BALL_R, y + BALL_R * 0.35);
    return { u: c[0], v: c[1], r: Math.hypot(e[0] - c[0], e[1] - c[1]) };
  }
  // The ball rolls at a steady speed and bounces off the cushions.
  function createScene(o) {
    o = o || {};
    var s = { t: 0, x: o.x !== undefined ? o.x : 30, y: o.y !== undefined ? o.y : 18, vx: o.vx !== undefined ? o.vx : 23, vy: o.vy !== undefined ? o.vy : 14 };
    s.step = function (dt) {
      s.t += dt; s.x += s.vx * dt; s.y += s.vy * dt;
      if (s.x < BALL_R) { s.x = 2 * BALL_R - s.x; s.vx = Math.abs(s.vx); }
      if (s.x > TABLE.w - BALL_R) { s.x = 2 * (TABLE.w - BALL_R) - s.x; s.vx = -Math.abs(s.vx); }
      if (s.y < BALL_R) { s.y = 2 * BALL_R - s.y; s.vy = Math.abs(s.vy); }
      if (s.y > TABLE.h - BALL_R) { s.y = 2 * (TABLE.h - BALL_R) - s.y; s.vy = -Math.abs(s.vy); }
    };
    return s;
  }
  var FELT = [0.10, 0.42, 0.25], RAIL = [0.30, 0.23, 0.18], WALL = [0.30, 0.31, 0.35], RED = [0.88, 0.13, 0.10], CARD = [0.85, 0.84, 0.80];
  function lamp(x, y, light) { return light * (0.5 + 0.5 * Math.exp(-((x - 50) * (x - 50) + (y - 25) * (y - 25)) / 2400)); }
  function inCard(card, x, y) { return card && x >= card.x && x <= card.x + card.w && y >= card.y && y <= card.y + card.h; }
  // One camera frame. o: light (lamp brightness), noise (sensor σ), pencil (a red pencil on the table, [x0, y0, x1, y1] in cm),
  // card (a card held over the table, {x, y, w, h} in cm, hiding what is under it).
  function renderScene(sc, o, rand) {
    o = o || {};
    var light = o.light !== undefined ? o.light : 1, P = pixWorld(), im = image(W, H, 3), d = im.d;
    var b = ballPixel(sc.x, sc.y), pen = o.pencil ? [toPixel(o.pencil[0], o.pencil[1]), toPixel(o.pencil[2], o.pencil[3])] : null;
    for (var v = 0; v < H; v++) for (var u = 0; u < W; u++) {
      var i = v * W + u, x = P.wx[i], y = P.wy[i], col, L;
      if (!P.ok[i] || y > TABLE.h + 6 || y < -40) { L = light * (0.55 + 0.25 * v / H); col = WALL; }
      else if (x < -5 || x > TABLE.w + 5 || y < -5 || y > TABLE.h + 5) { L = light * 0.55; col = WALL; }
      else if (x < 0 || x > TABLE.w || y < 0 || y > TABLE.h) { L = lamp(x, y, light); col = RAIL; }
      else {
        L = lamp(x, y, light);
        var gx = Math.abs(x / 10 - Math.round(x / 10)) * 10, gy = Math.abs(y / 10 - Math.round(y / 10)) * 10;
        var g = Math.max(0, 1 - Math.min(gx, gy) / 0.45) * 0.12;
        var sdx = (x - sc.x - 2.2) / (BALL_R * 1.05), sdy = (y - sc.y + 1.2) / (BALL_R * 0.75), sh = sdx * sdx + sdy * sdy;
        var shade = sh < 1 ? 0.55 + 0.45 * sh : 1;
        col = [(FELT[0] + g) * shade, (FELT[1] + g) * shade, (FELT[2] + g) * shade];
      }
      var r = col[0] * L, gg = col[1] * L, bb = col[2] * L;
      if (pen) {                                     // the pencil: a red stroke about 2 px wide
        var ax = pen[0][0], ay = pen[0][1], bx = pen[1][0], by = pen[1][1], tx = bx - ax, ty = by - ay;
        var t = clamp(((u + 0.5 - ax) * tx + (v + 0.5 - ay) * ty) / (tx * tx + ty * ty), 0, 1);
        var dd = Math.hypot(u + 0.5 - ax - t * tx, v + 0.5 - ay - t * ty), cov = clamp(1.6 - dd, 0, 1);
        if (cov > 0) { var Lp = lamp(x, y, light) * 0.9; r += (RED[0] * Lp - r) * cov; gg += (RED[1] * Lp - gg) * cov; bb += (RED[2] * Lp - bb) * cov; }
      }
      var du = u + 0.5 - b.u, dv = v + 0.5 - b.v, dist = Math.hypot(du, dv), c2 = clamp(b.r + 0.5 - dist, 0, 1);
      if (c2 > 0) {                                  // the ball: a shaded sphere with a highlight
        var nx = du / b.r, ny = dv / b.r, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
        var lam = Math.max(0, -0.45 * nx - 0.55 * ny + 0.70 * nz), Lb = lamp(sc.x, sc.y, light), spec = Math.pow(lam, 24) * 0.55 * light;
        var sb = (0.3 + 0.7 * lam) * Lb;
        r += (RED[0] * sb + spec - r) * c2; gg += (RED[1] * sb + spec - gg) * c2; bb += (RED[2] * sb + spec - bb) * c2;
      }
      if (P.ok[i] && inCard(o.card, x, y)) { var Lc = lamp(x, y, light); r = CARD[0] * Lc; gg = CARD[1] * Lc; bb = CARD[2] * Lc; }
      d[3 * i] = r; d[3 * i + 1] = gg; d[3 * i + 2] = bb;
    }
    if (o.noise > 0 && rand) for (var k = 0; k < d.length; k++) d[k] += o.noise * gaussian(rand);
    for (k = 0; k < d.length; k++) d[k] = Math.round(clamp(d[k], 0, 1) * 255) / 255;   // an 8-bit camera
    return im;
  }

  /* ---------------- corners and features ---------------- */
  // Harris: smooth the products of the slopes over a window (σ) into a 2×2 matrix per pixel. A corner is where it is
  // big in both directions: R = det − k·trace². Corners are the local maxima of R above rel × its largest value.
  function harris(g, o) {
    o = o || {};
    var k = o.k !== undefined ? o.k : 0.05, rel = o.rel !== undefined ? o.rel : 0.01, rad = o.nms || 3, cap = o.max || 400;
    var gx = convolve(g, SOBEL_X, 3), gy = convolve(g, SOBEL_Y, 3), n = g.w * g.h;
    var xx = image(g.w, g.h, 1), yy = image(g.w, g.h, 1), xy = image(g.w, g.h, 1);
    for (var i = 0; i < n; i++) { var a = gx.d[i] / 8, b = gy.d[i] / 8; xx.d[i] = a * a; yy.d[i] = b * b; xy.d[i] = a * b; }
    var G = gaussianKernel(o.sigma || 1.2);
    xx = convolve(xx, G.k, G.n); yy = convolve(yy, G.k, G.n); xy = convolve(xy, G.k, G.n);
    var R = image(g.w, g.h, 1), max = 0;
    for (i = 0; i < n; i++) { var tr = xx.d[i] + yy.d[i]; R.d[i] = xx.d[i] * yy.d[i] - xy.d[i] * xy.d[i] - k * tr * tr; if (R.d[i] > max) max = R.d[i]; }
    var out = [], t = rel * max, w = g.w;
    for (var y = rad; y < g.h - rad; y++) for (var x = rad; x < w - rad; x++) {
      var v = R.d[y * w + x]; if (v <= t || v <= 0) continue;
      var top = true;
      for (var dy = -rad; dy <= rad && top; dy++) for (var dx = -rad; dx <= rad; dx++) {
        var q = R.d[(y + dy) * w + x + dx]; if (q > v || (q === v && (dy < 0 || (dy === 0 && dx < 0)))) { top = false; break; }
      }
      if (top) out.push({ x: x + 0.5, y: y + 0.5, r: v });
    }
    out.sort(function (p, q) { return q.r - p.r; });
    return { R: R, max: max, corners: out.slice(0, cap) };
  }
  function sample(g, x, y) {                         // bilinear, edge pixels repeated
    x = clamp(x - 0.5, 0, g.w - 1.001); y = clamp(y - 0.5, 0, g.h - 1.001);
    var x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, w = g.w;
    return (g.d[y0 * w + x0] * (1 - fx) + g.d[y0 * w + x0 + 1] * fx) * (1 - fy) + (g.d[(y0 + 1) * w + x0] * (1 - fx) + g.d[(y0 + 1) * w + x0 + 1] * fx) * fy;
  }
  // A descriptor: an 8×8 grid sampled every 2 px round the corner from a blurred copy, minus its mean, scaled to length 1.
  // It is a picture of the neighbourhood, so it survives a shift and a little turn, but not a big one. With `oriented`,
  // the grid is first turned to point from the corner to the centre of brightness round it (as ORB does), so it turns with the image.
  function orientation(gb, x, y) {
    var mx = 0, my = 0;
    for (var j = -7; j <= 7; j++) for (var i = -7; i <= 7; i++) { if (i * i + j * j > 49) continue; var v = sample(gb, x + i, y + j); mx += i * v; my += j * v; }
    return Math.atan2(my, mx);
  }
  function describe(gb, pts, oriented) {
    var out = [];
    pts.forEach(function (p, idx) {
      if (p.x < 12 || p.y < 12 || p.x > gb.w - 12 || p.y > gb.h - 12) return;
      var v = new Float32Array(64), m = 0, s = 0, i, j, th = oriented ? orientation(gb, p.x, p.y) : 0, c = Math.cos(th), sn = Math.sin(th);
      for (j = 0; j < 8; j++) for (i = 0; i < 8; i++) {
        var a = (i - 3.5) * 2, b = (j - 3.5) * 2;
        v[j * 8 + i] = sample(gb, p.x + c * a - sn * b, p.y + sn * a + c * b); m += v[j * 8 + i];
      }
      m /= 64; for (i = 0; i < 64; i++) { v[i] -= m; s += v[i] * v[i]; }
      s = Math.sqrt(s) || 1; for (i = 0; i < 64; i++) v[i] /= s;
      out.push({ x: p.x, y: p.y, i: idx, v: v, th: th });
    });
    return out;
  }
  // Each feature in A to its nearest in B, kept only if clearly nearer than the second nearest (Lowe's ratio test).
  function matchFeatures(A, B, ratio) {
    var out = [];
    A.forEach(function (a, ia) {
      var b1 = Infinity, b2 = Infinity, j1 = -1;
      B.forEach(function (b, ib) {
        var d = 0; for (var k = 0; k < 64; k++) { var e = a.v[k] - b.v[k]; d += e * e; }
        if (d < b1) { b2 = b1; b1 = d; j1 = ib; } else if (d < b2) b2 = d;
      });
      if (j1 >= 0 && b1 < ratio * ratio * b2) out.push({ a: ia, b: j1, d: b1 });
    });
    return out;
  }
  // The homography that fits many point pairs best (least squares on the same eight unknowns).
  function homographyLsq(src, dst) {
    if (src.length === 4) return homography(src, dst);
    var AtA = [], Atb = new Array(8).fill(0), i, j;
    for (i = 0; i < 8; i++) AtA.push(new Array(8).fill(0));
    src.forEach(function (s, n) {
      var x = s[0], y = s[1], u = dst[n][0], v = dst[n][1];
      [[[x, y, 1, 0, 0, 0, -u * x, -u * y], u], [[0, 0, 0, x, y, 1, -v * x, -v * y], v]].forEach(function (rb) {
        for (i = 0; i < 8; i++) { Atb[i] += rb[0][i] * rb[1]; for (j = 0; j < 8; j++) AtA[i][j] += rb[0][i] * rb[0][j]; }
      });
    });
    var h = solve(AtA, Atb); if (!h) return null;
    return [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]];
  }
  // RANSAC: guess H from 4 random matches, count the matches it explains within tol px, keep the best guess, refit on its inliers.
  function ransac(pa, pb, iters, tol, rand) {
    var n = pa.length, best = null, bestN = -1;
    if (n < 4) return { H: null, inliers: new Array(n).fill(false), count: 0 };
    function count(H) {
      var inl = [], c = 0;
      for (var i = 0; i < n; i++) { var p = applyH(H, pa[i][0], pa[i][1]), ok = p[2] > 0 && Math.hypot(p[0] - pb[i][0], p[1] - pb[i][1]) < tol; inl.push(ok); if (ok) c++; }
      return { inl: inl, c: c };
    }
    for (var it = 0; it < iters; it++) {
      var idx = []; while (idx.length < 4) { var r = Math.floor(rand() * n); if (idx.indexOf(r) < 0) idx.push(r); }
      var H = homography(idx.map(function (i) { return pa[i]; }), idx.map(function (i) { return pb[i]; }));
      if (!H) continue;
      var c = count(H); if (c.c > bestN) { bestN = c.c; best = { H: H, inl: c.inl }; }
    }
    if (!best) return { H: null, inliers: new Array(n).fill(false), count: 0 };
    var S = [], D = []; best.inl.forEach(function (ok, i) { if (ok) { S.push(pa[i]); D.push(pb[i]); } });
    var Hf = S.length >= 4 ? homographyLsq(S, D) || best.H : best.H, fin = count(Hf);
    return fin.c >= bestN ? { H: Hf, inliers: fin.inl, count: fin.c } : { H: best.H, inliers: best.inl, count: bestN };
  }

  /* ---------------- two cameras ---------------- */
  // Two identical cameras side by side, B cm apart, both 30 cm above the table and tilted 20° down. Because they only
  // differ by a sideways shift, a point appears on the same row in both, shifted by the disparity d = f·B / depth.
  var ST = { w: 192, h: 144, f: 150, cy: 30, tilt: 20 * Math.PI / 180, R: 4 };
  ST.fwd = [0, -Math.sin(ST.tilt), Math.cos(ST.tilt)]; ST.down = [0, -Math.cos(ST.tilt), -Math.sin(ST.tilt)];
  function hash2(i, j) { var s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); }
  function stereoProject(B, side, X, Y, Z) {         // side −1 = left camera, +1 = right
    var p = [X - side * B / 2, Y - ST.cy, Z], zc = p[1] * ST.fwd[1] + p[2] * ST.fwd[2];
    return [ST.w / 2 + ST.f * p[0] / zc, ST.h / 2 + ST.f * (p[1] * ST.down[1] + p[2] * ST.down[2]) / zc, zc];
  }
  // Back from a pixel in the left image and its disparity to a point in the room (cm), and its depth along the camera.
  function triangulate(B, u, v, d) {
    var zc = ST.f * B / d, a = (u - ST.w / 2) / ST.f, b = (v - ST.h / 2) / ST.f;
    return { x: -B / 2 + zc * a, y: ST.cy + zc * (ST.fwd[1] + b * ST.down[1]), z: zc * (ST.fwd[2] + b * ST.down[2]), depth: zc };
  }
  function renderStereo(o, side) {
    var im = image(ST.w, ST.h, 3), B = o.B, bx = o.ballX, bz = o.ballZ, R = ST.R, light = o.light || 1;
    var cx = side * B / 2, LD = [-0.4, 0.8, -0.45], ln = Math.hypot(LD[0], LD[1], LD[2]);
    for (var v = 0; v < ST.h; v++) for (var u = 0; u < ST.w; u++) {
      var a = (u + 0.5 - ST.w / 2) / ST.f, b = (v + 0.5 - ST.h / 2) / ST.f;
      var dx = a, dy = ST.fwd[1] + b * ST.down[1], dz = ST.fwd[2] + b * ST.down[2], col = null, tHit = Infinity;
      var ox = cx - bx, oy = ST.cy - R, oz = -bz, bq = ox * dx + oy * dy + oz * dz, cq = ox * ox + oy * oy + oz * oz - R * R, aq = dx * dx + dy * dy + dz * dz, disc = bq * bq - aq * cq;
      if (disc > 0) {                                // the ball
        var t = (-bq - Math.sqrt(disc)) / aq;
        if (t > 0) {
          tHit = t; var nx = (ox + t * dx) / R, ny = (oy + t * dy) / R, nz = (oz + t * dz) / R;
          var lam = Math.max(0, (nx * LD[0] + ny * LD[1] + nz * LD[2]) / ln), sh = (0.3 + 0.7 * lam) * light, sp = Math.pow(lam, 24) * 0.5 * light;
          col = [RED[0] * sh + sp, RED[1] * sh + sp, RED[2] * sh + sp];
        }
      }
      if (!col) {
        var tw = (240 - 0) / dz, tf = dy < 0 ? -ST.cy / dy : Infinity;
        if (tf < tw) {                               // the table top (y = 0)
          var X = cx + tf * dx, Z = tf * dz, onT = Math.abs(X) < 60 && Z > 10 && Z < 225;
          var nse = hash2(Math.floor(X / 1.5), Math.floor(Z / 1.5)), gl = (Math.abs(X / 10 - Math.round(X / 10)) * 10 < 0.4 || Math.abs(Z / 10 - Math.round(Z / 10)) * 10 < 0.4) ? 0.08 : 0;
          var sd = Math.hypot(X - bx - 2, (Z - bz - 1.5) * 1.3), shd = sd < R * 1.1 ? 0.55 + 0.45 * sd / (R * 1.1) : 1;
          var base = onT ? FELT : RAIL, L = light * (0.75 + 0.3 * nse) * shd;
          col = [(base[0] + gl) * L, (base[1] + gl) * L, (base[2] + gl) * L];
        } else {                                     // the far wall, with a pattern of tiles
          var WX = cx + tw * dx, WY = ST.cy + tw * dy, tile = hash2(Math.floor(WX / 12), Math.floor(WY / 12)), fine = hash2(Math.floor(WX / 2), Math.floor(WY / 2));
          var Lw = light * (0.45 + 0.35 * tile + 0.1 * fine);
          col = [WALL[0] * Lw * 1.6, WALL[1] * Lw * 1.6, WALL[2] * Lw * 1.7];
        }
      }
      var i3 = (v * ST.w + u) * 3;
      for (var k = 0; k < 3; k++) im.d[i3 + k] = Math.round(clamp(col[k], 0, 1) * 255) / 255;
    }
    return im;
  }
  // The cost of each disparity for the pixel (u, v): the summed absolute difference between an n×n window
  // in the left image and the same window d px to the left in the right image.
  function stereoCost(L, Rg, u, v, n, dmax) {
    var r = (n - 1) >> 1, out = [], w = L.w;
    for (var d = 0; d <= dmax; d++) {
      var s = 0, cnt = 0;
      for (var j = -r; j <= r; j++) {
        var y = clamp(v + j, 0, L.h - 1);
        for (var i = -r; i <= r; i++) { var x = u + i, xr = x - d; if (x < 0 || x >= w || xr < 0) continue; s += Math.abs(L.d[y * w + x] - Rg.d[y * w + xr]); cnt++; }
      }
      out.push(cnt ? s / cnt : Infinity);
    }
    return out;
  }
  function argmin(a) { var bi = 0; for (var i = 1; i < a.length; i++) if (a[i] < a[bi]) bi = i; return bi; }
  // Disparity for every step-th pixel. The minimum is refined to a fraction of a pixel with a parabola through its neighbours.
  function disparityMap(L, Rg, n, dmax, step) {
    var w = Math.floor(L.w / step), h = Math.floor(L.h / step), out = image(w, h, 1);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) out.d[y * w + x] = subpixel(stereoCost(L, Rg, x * step + (step >> 1), y * step + (step >> 1), n, dmax));
    return out;
  }
  function subpixel(c) {
    var d = argmin(c); if (d === 0 || d === c.length - 1 || !isFinite(c[d - 1]) || !isFinite(c[d + 1])) return d;
    var den = c[d - 1] - 2 * c[d] + c[d + 1]; return den > 0 ? d + 0.5 * (c[d - 1] - c[d + 1]) / den : d;
  }

  /* ---------------- colour ---------------- */
  // Pixels whose colour (brightness divided out) is within tol of rgb, and bright enough to have a colour.
  function colorMask(im, rgb, tol) {
    var m = new Uint8Array(im.w * im.h), s0 = rgb[0] + rgb[1] + rgb[2] + 1e-6, r0 = rgb[0] / s0, g0 = rgb[1] / s0;
    for (var i = 0; i < m.length; i++) {
      var r = im.d[3 * i], g = im.d[3 * i + 1], b = im.d[3 * i + 2], s = r + g + b + 1e-6;
      m[i] = s > 0.15 && Math.hypot(r / s - r0, g / s - g0) < tol ? 1 : 0;
    }
    return m;
  }

  /* ---------------- learning one filter ---------------- */
  // A 3×3 kernel w and a bias, fitted so convolve(input, w) + b matches target, by Adam on the mean squared error.
  function filterLearner(rand) {
    var L = { w: [], b: 0, m: new Array(10).fill(0), v: new Array(10).fill(0), t: 0, loss: [] };
    L.reset = function () { L.w = []; for (var i = 0; i < 9; i++) L.w.push(0.3 * gaussian(rand)); L.b = 0; L.m.fill(0); L.v.fill(0); L.t = 0; L.loss = []; };
    L.reset();
    L.output = function (g) { var o = convolve(g, L.w, 3); for (var i = 0; i < o.d.length; i++) o.d[i] += L.b; return o; };
    L.step = function (g, target, lr) {
      var w = g.w, h = g.h, grad = new Array(10).fill(0), loss = 0, n = 0;
      for (var y = 1; y < h - 1; y++) for (var x = 1; x < w - 1; x++) {
        var s = L.b, k = 0, j, i;
        for (j = -1; j <= 1; j++) for (i = -1; i <= 1; i++) s += L.w[k++] * g.d[(y + j) * w + x + i];
        var e = s - target.d[y * w + x]; loss += e * e; n++; k = 0;
        for (j = -1; j <= 1; j++) for (i = -1; i <= 1; i++) grad[k++] += e * g.d[(y + j) * w + x + i];
        grad[9] += e;
      }
      L.t++;
      for (var p = 0; p < 10; p++) {
        var gp = 2 * grad[p] / n;
        L.m[p] = 0.9 * L.m[p] + 0.1 * gp; L.v[p] = 0.999 * L.v[p] + 0.001 * gp * gp;
        var step = lr * (L.m[p] / (1 - Math.pow(0.9, L.t))) / (Math.sqrt(L.v[p] / (1 - Math.pow(0.999, L.t))) + 1e-8);
        if (p < 9) L.w[p] -= step; else L.b -= step;
      }
      L.loss.push(loss / n);
      return loss / n;
    };
    return L;
  }

  /* ---------------- a small CNN ---------------- */
  // Two convolution layers on a half-size RGB frame: 3 → M feature maps (K×K, ReLU), then M → 1 (K×K, sigmoid).
  // Its output is a map of "ball here" that should peak on the ball and nowhere else. Arrays are channel-first.
  function convFwd(x, C, h, w, wt, b, O, K) {
    var out = new Float32Array(O * h * w), r = (K - 1) >> 1;
    for (var o = 0; o < O; o++) {
      var base = o * h * w; for (var p = 0; p < h * w; p++) out[base + p] = b[o];
      for (var c = 0; c < C; c++) for (var ky = 0; ky < K; ky++) for (var kx = 0; kx < K; kx++) {
        var wv = wt[((o * C + c) * K + ky) * K + kx]; if (wv === 0) continue;
        var dy = ky - r, dx = kx - r, y0 = Math.max(0, -dy), y1 = Math.min(h, h - dy), x0 = Math.max(0, -dx), x1 = Math.min(w, w - dx);
        for (var y = y0; y < y1; y++) {
          var oi = base + y * w, xi = c * h * w + (y + dy) * w + dx;
          for (var xx = x0; xx < x1; xx++) out[oi + xx] += wv * x[xi + xx];
        }
      }
    }
    return out;
  }
  function convBwd(x, C, h, w, wt, O, K, dout, needDx) {
    var dw = new Float32Array(wt.length), db = new Float32Array(O), dx = needDx ? new Float32Array(C * h * w) : null, r = (K - 1) >> 1;
    for (var o = 0; o < O; o++) {
      var base = o * h * w; for (var p = 0; p < h * w; p++) db[o] += dout[base + p];
      for (var c = 0; c < C; c++) for (var ky = 0; ky < K; ky++) for (var kx = 0; kx < K; kx++) {
        var wi = ((o * C + c) * K + ky) * K + kx, wv = wt[wi], s = 0;
        var dy = ky - r, dx2 = kx - r, y0 = Math.max(0, -dy), y1 = Math.min(h, h - dy), x0 = Math.max(0, -dx2), x1 = Math.min(w, w - dx2);
        for (var y = y0; y < y1; y++) {
          var oi = base + y * w, xi = c * h * w + (y + dy) * w + dx2;
          for (var xx = x0; xx < x1; xx++) { s += dout[oi + xx] * x[xi + xx]; if (dx) dx[xi + xx] += wv * dout[oi + xx]; }
        }
        dw[wi] = s;
      }
    }
    return { dw: dw, db: db, dx: dx };
  }
  function netCreate(rand, M, K) {
    M = M || 6; K = K || 5;
    var n1 = M * 3 * K * K, n2 = M * K * K, net = { C: 3, M: M, K: K, w1: new Float32Array(n1), b1: new Float32Array(M), w2: new Float32Array(n2), b2: new Float32Array([-3]) };
    for (var i = 0; i < n1; i++) net.w1[i] = gaussian(rand) * Math.sqrt(2 / (3 * K * K));
    for (i = 0; i < n2; i++) net.w2[i] = gaussian(rand) * Math.sqrt(1 / (M * K * K));
    return net;
  }
  function netToJSON(net) { return { C: net.C, M: net.M, K: net.K, w1: Array.from(net.w1, r4), b1: Array.from(net.b1, r4), w2: Array.from(net.w2, r4), b2: Array.from(net.b2, r4) }; }
  function r4(v) { return Math.round(v * 1e4) / 1e4; }
  function netFromJSON(j) { return { C: j.C, M: j.M, K: j.K, w1: new Float32Array(j.w1), b1: new Float32Array(j.b1), w2: new Float32Array(j.w2), b2: new Float32Array(j.b2) }; }
  function sigmoid(z) { return 1 / (1 + Math.exp(-z)); }
  function netForward(net, x, h, w) {
    var z1 = convFwd(x, net.C, h, w, net.w1, net.b1, net.M, net.K), a1 = new Float32Array(z1.length);
    for (var i = 0; i < z1.length; i++) a1[i] = z1[i] > 0 ? z1[i] : 0;
    var z2 = convFwd(a1, net.M, h, w, net.w2, net.b2, 1, net.K), p = new Float32Array(z2.length);
    for (i = 0; i < z2.length; i++) p[i] = sigmoid(z2[i]);
    return { a1: a1, p: p };
  }
  // The network's input: the frame halved (2×2 averages), channel-first, centred on 0.
  function netInput(im) {
    var w = im.w >> 1, h = im.h >> 1, x = new Float32Array(3 * w * h);
    for (var y = 0; y < h; y++) for (var u = 0; u < w; u++) for (var c = 0; c < 3; c++) {
      var s = 0; for (var j = 0; j < 2; j++) for (var i = 0; i < 2; i++) s += im.d[((2 * y + j) * im.w + 2 * u + i) * 3 + c];
      x[c * w * h + y * w + u] = s / 4 - 0.4;
    }
    return { x: x, w: w, h: h };
  }
  // What it should say: a small bump on the ball's centre (at half size), zero elsewhere.
  function netTarget(w, h, cu, cv) {
    var t = new Float32Array(w * h);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) t[y * w + x] = Math.exp(-((x + 0.5 - cu) * (x + 0.5 - cu) + (y + 0.5 - cv) * (y + 0.5 - cv)) / 2);
    return t;
  }
  function adamState(net) { return { t: 0, m: [net.w1, net.b1, net.w2, net.b2].map(function (a) { return new Float32Array(a.length); }), v: [net.w1, net.b1, net.w2, net.b2].map(function (a) { return new Float32Array(a.length); }) }; }
  // One step of training on one frame: cross-entropy per pixel, with the pixels near the ball weighted up (there are few of them).
  function netTrainStep(net, opt, inp, target, lr) {
    var h = inp.h, w = inp.w, fw = netForward(net, inp.x, h, w), n = h * w, dz2 = new Float32Array(n), loss = 0;
    for (var i = 0; i < n; i++) {
      var y = target[i], p = fw.p[i], wt = 1 + 30 * y;
      loss -= wt * (y * Math.log(p + 1e-7) + (1 - y) * Math.log(1 - p + 1e-7));
      dz2[i] = wt * (p - y) / n;
    }
    var g2 = convBwd(fw.a1, net.M, h, w, net.w2, 1, net.K, dz2, true), da1 = g2.dx;
    for (i = 0; i < da1.length; i++) if (fw.a1[i] <= 0) da1[i] = 0;
    var g1 = convBwd(inp.x, net.C, h, w, net.w1, net.M, net.K, da1, false);
    var P = [net.w1, net.b1, net.w2, net.b2], G = [g1.dw, g1.db, g2.dw, g2.db];
    opt.t++;
    var c1 = 1 - Math.pow(0.9, opt.t), c2 = 1 - Math.pow(0.999, opt.t);
    for (var k = 0; k < 4; k++) for (var j = 0; j < P[k].length; j++) {
      var g = G[k][j]; opt.m[k][j] = 0.9 * opt.m[k][j] + 0.1 * g; opt.v[k][j] = 0.999 * opt.v[k][j] + 0.001 * g * g;
      P[k][j] -= lr * (opt.m[k][j] / c1) / (Math.sqrt(opt.v[k][j] / c2) + 1e-8);
    }
    return loss / n;
  }
  function netPeak(p, w, h) { var bi = 0; for (var i = 1; i < p.length; i++) if (p[i] > p[bi]) bi = i; return { u: (bi % w + 0.5) * 2, v: (Math.floor(bi / w) + 0.5) * 2, p: p[bi] }; }
  // A random training frame: anywhere on the table, any lamp, with or without the pencil.
  function randomFrame(rand, o) {
    o = o || {};
    var sc = createScene({ x: BALL_R + rand() * (TABLE.w - 2 * BALL_R), y: BALL_R + rand() * (TABLE.h - 2 * BALL_R) });
    var light = o.light !== undefined ? o.light : 0.3 + rand(), pencil = null;
    if (o.pencil !== false && (o.pencil || rand() < 0.7)) {
      for (var tries = 0; tries < 20; tries++) {
        var px = 8 + rand() * 84, py = 6 + rand() * 38, a = rand() * Math.PI, L = 16;
        pencil = [px - L / 2 * Math.cos(a), py - L / 2 * Math.sin(a), px + L / 2 * Math.cos(a), py + L / 2 * Math.sin(a)];
        if (Math.hypot(px - sc.x, py - sc.y) > 14) break;
      }
    }
    var im = renderScene(sc, { light: light, noise: o.noise !== undefined ? o.noise : 0.02 * rand(), pencil: pencil }, rand), b = ballPixel(sc.x, sc.y);
    return { im: im, scene: sc, light: light, pencil: pencil, ball: b };
  }

  /* ---------------- tracking ---------------- */
  // Constant velocity in 2-D: state [x, y, vx, vy]. q is how hard the motion may change (cm/s² as white noise),
  // r the measurement noise (cm). A measurement too far from the prediction (NIS above the gate) is ignored.
  function kalman(o) {
    var K = { q: o.q, r: o.r, gate: o.gate || 0, x: null, P: null, nis: 0 };
    function mm(A, B) { return A.map(function (row) { return B[0].map(function (_, j) { var s = 0; for (var k = 0; k < row.length; k++) s += row[k] * B[k][j]; return s; }); }); }
    function tr(A) { return A[0].map(function (_, j) { return A.map(function (r) { return r[j]; }); }); }
    K.reset = function (z) { K.x = [z[0], z[1], 0, 0]; var r2 = K.r * K.r; K.P = [[r2, 0, 0, 0], [0, r2, 0, 0], [0, 0, 900, 0], [0, 0, 0, 900]]; };
    K.predict = function (dt) {
      if (!K.x) return;
      var F = [[1, 0, dt, 0], [0, 1, 0, dt], [0, 0, 1, 0], [0, 0, 0, 1]], q = K.q * K.q, a = q * dt * dt * dt / 3, b = q * dt * dt / 2, c = q * dt;
      var Q = [[a, 0, b, 0], [0, a, 0, b], [b, 0, c, 0], [0, b, 0, c]];
      K.x = [K.x[0] + dt * K.x[2], K.x[1] + dt * K.x[3], K.x[2], K.x[3]];
      K.P = mm(mm(F, K.P), tr(F)).map(function (r, i) { return r.map(function (v, j) { return v + Q[i][j]; }); });
    };
    K.update = function (z) {
      if (!K.x) { K.reset(z); return { used: true, nis: 0 }; }
      var r2 = K.r * K.r, S = [[K.P[0][0] + r2, K.P[0][1]], [K.P[1][0], K.P[1][1] + r2]], det = S[0][0] * S[1][1] - S[0][1] * S[1][0];
      var Si = [[S[1][1] / det, -S[0][1] / det], [-S[1][0] / det, S[0][0] / det]], e = [z[0] - K.x[0], z[1] - K.x[1]];
      var nis = e[0] * (Si[0][0] * e[0] + Si[0][1] * e[1]) + e[1] * (Si[1][0] * e[0] + Si[1][1] * e[1]);
      K.nis = nis;
      if (K.gate > 0 && nis > K.gate) return { used: false, nis: nis };
      var G = K.P.map(function (r) { return [r[0] * Si[0][0] + r[1] * Si[1][0], r[0] * Si[0][1] + r[1] * Si[1][1]]; });
      K.x = K.x.map(function (v, i) { return v + G[i][0] * e[0] + G[i][1] * e[1]; });
      var P0 = K.P; K.P = P0.map(function (r, i) { return r.map(function (v, j) { return v - G[i][0] * P0[0][j] - G[i][1] * P0[1][j]; }); });
      return { used: true, nis: nis, gain: G[0][0] };
    };
    return K;
  }
  // The covariance ellipse of the position: half-axes (k-sigma) and angle.
  function ellipse(P, k) {
    var a = P[0][0], b = P[0][1], c = P[1][1], tr2 = (a + c) / 2, det = Math.sqrt(Math.max(0, (a - c) * (a - c) / 4 + b * b));
    return { rx: k * Math.sqrt(tr2 + det), ry: k * Math.sqrt(Math.max(0, tr2 - det)), ang: 0.5 * Math.atan2(2 * b, a - c) };
  }

  var VisionCore = {
    clamp: clamp, image: image, gray: gray, redness: redness, pixelate: pixelate, quantize: quantize, gaussian: gaussian, addNoise: addNoise, std: std, sub: sub,
    convolve: convolve, convolveSep: convolveSep, boxKernel: boxKernel, gaussianKernel: gaussianKernel, sobel: sobel, SOBEL_X: SOBEL_X, SOBEL_Y: SOBEL_Y, KERNELS: KERNELS,
    histogram: histogram, threshold: threshold, blobs: blobs, pickBall: pickBall, detectBall: detectBall,
    solve: solve, homography: homography, applyH: applyH, inv3: inv3, mul3: mul3, affine: affine, warp: warp,
    W: W, H: H, TABLE: TABLE, BALL_R: BALL_R, TABLE_CORNERS: TABLE_CORNERS, CAM_CORNERS: CAM_CORNERS, CAM: CAM, CAM_INV: CAM_INV,
    toPixel: toPixel, toTable: toTable, ballPixel: ballPixel, createScene: createScene, renderScene: renderScene,
    harris: harris, sample: sample, describe: describe, matchFeatures: matchFeatures, homographyLsq: homographyLsq, ransac: ransac,
    ST: ST, stereoProject: stereoProject, triangulate: triangulate, renderStereo: renderStereo, stereoCost: stereoCost, argmin: argmin,
    disparityMap: disparityMap, subpixel: subpixel, colorMask: colorMask,
    filterLearner: filterLearner,
    convFwd: convFwd, convBwd: convBwd, netCreate: netCreate, netToJSON: netToJSON, netFromJSON: netFromJSON, netForward: netForward,
    netInput: netInput, netTarget: netTarget, adamState: adamState, netTrainStep: netTrainStep, netPeak: netPeak, randomFrame: randomFrame,
    kalman: kalman, ellipse: ellipse
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = VisionCore;
  root.VisionCore = VisionCore;
})(typeof window !== 'undefined' ? window : this);
