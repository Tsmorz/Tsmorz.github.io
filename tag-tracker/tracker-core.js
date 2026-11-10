// TagCore: the maths behind /tag-tracker/, with no DOM, so script/test-tag-tracker can run it in Node.
// Poses are {R, t}: R a row-major 3x3 rotation (9 numbers) and t a translation in metres, both in the
// camera frame OpenCV uses (x right, y down, z out of the lens). A tag's own frame has its origin at the
// tag's centre, x to the right of the printed tag, y up it and z out of its face.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TagCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- small 3-vector and 3x3 matrix helpers (row-major arrays) ----
  const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  function mul3(A, B) {
    const C = new Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
      C[3 * i + j] = A[3 * i] * B[j] + A[3 * i + 1] * B[3 + j] + A[3 * i + 2] * B[6 + j];
    return C;
  }
  function tr3(A) { return [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]]; }
  function mulv(A, v) {
    return [A[0] * v[0] + A[1] * v[1] + A[2] * v[2], A[3] * v[0] + A[4] * v[1] + A[5] * v[2], A[6] * v[0] + A[7] * v[1] + A[8] * v[2]];
  }
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const norm = (a) => Math.hypot(a[0], a[1], a[2]);

  // Rodrigues: a rotation vector (axis times angle, as OpenCV's solvePnP returns) to a rotation matrix.
  function rodrigues(r) {
    const th = norm(r);
    if (th < 1e-12) return I3.slice();
    const k = [r[0] / th, r[1] / th, r[2] / th], c = Math.cos(th), s = Math.sin(th), v = 1 - c;
    return [
      c + k[0] * k[0] * v, k[0] * k[1] * v - k[2] * s, k[0] * k[2] * v + k[1] * s,
      k[1] * k[0] * v + k[2] * s, c + k[1] * k[1] * v, k[1] * k[2] * v - k[0] * s,
      k[2] * k[0] * v - k[1] * s, k[2] * k[1] * v + k[0] * s, c + k[2] * k[2] * v,
    ];
  }
  // The angle of a rotation matrix, in radians.
  function angleOf(R) { return Math.acos(Math.max(-1, Math.min(1, (R[0] + R[4] + R[8] - 1) / 2))); }

  function compose(a, b) { return { R: mul3(a.R, b.R), t: add(mulv(a.R, b.t), a.t) }; }
  function inverse(p) { const Rt = tr3(p.R); return { R: Rt, t: mulv(Rt, p.t).map((x) => -x) }; }
  // Pose of `p` seen from `ref` (both given in the camera frame).
  function relative(ref, p) { return compose(inverse(ref), p); }

  // The plot shows the camera frame turned so that z is up: X right, Y away from the camera, Z up.
  const CAM_TO_VIEW = [1, 0, 0, 0, 0, 1, 0, -1, 0];
  // Relative to a reference tag, the plot stands the tag upright: X along the tag's x, Z up its y, and its
  // face looking back along -Y, towards the default view.
  const TAG_TO_VIEW = [1, 0, 0, 0, 0, -1, 0, 1, 0];
  function toView(p) { return { R: mul3(CAM_TO_VIEW, p.R), t: mulv(CAM_TO_VIEW, p.t) }; }
  // The pose to plot: in the turned camera frame, or relative to a reference tag's pose when one is given.
  function inFrame(p, ref) {
    if (!ref) return toView(p);
    const r = relative(ref, p);
    return { R: mul3(TAG_TO_VIEW, r.R), t: mulv(TAG_TO_VIEW, r.t) };
  }

  // ---- camera intrinsics ----
  // A guess from the horizontal field of view, for an uncalibrated camera.
  function guessIntrinsics(w, h, hfovDeg) {
    const f = w / 2 / Math.tan((hfovDeg * Math.PI) / 360);
    return { w, h, fx: f, fy: f, cx: (w - 1) / 2, cy: (h - 1) / 2, dist: [0, 0, 0, 0, 0], rms: null, guess: true };
  }
  // A calibration made at one resolution, used at another with the same aspect ratio (the sensor is
  // scaled, not cropped). Returns null when the aspect ratio differs, since the crop is then unknown.
  function scaleIntrinsics(c, w, h) {
    if (!c) return null;
    if (c.w === w && c.h === h) return c;
    if (Math.abs(c.w / c.h - w / h) > 0.01) return null;
    const s = w / c.w;
    return Object.assign({}, c, {
      w, h, fx: c.fx * s, fy: c.fy * s, cx: (c.cx + 0.5) * s - 0.5, cy: (c.cy + 0.5) * s - 0.5, scaledFrom: [c.w, c.h],
    });
  }
  function checkCalibration(c) {
    if (!c || typeof c !== 'object') return 'not a calibration';
    for (const k of ['w', 'h', 'fx', 'fy', 'cx', 'cy']) if (!(typeof c[k] === 'number' && isFinite(c[k]) && c[k] > 0)) return 'missing or bad ' + k;
    if (!Array.isArray(c.dist) || c.dist.length < 4 || !c.dist.every((x) => typeof x === 'number' && isFinite(x))) return 'missing or bad dist';
    if (c.cx > c.w || c.cy > c.h) return 'principal point outside the image';
    return null;
  }
  // Horizontal field of view, in degrees.
  function hfov(c) { return (2 * Math.atan(c.w / 2 / c.fx) * 180) / Math.PI; }

  // Project a point in the camera frame to pixels (pinhole plus OpenCV's k1, k2, p1, p2, k3 distortion).
  function project(c, P) {
    if (P[2] <= 1e-6) return null;
    const x = P[0] / P[2], y = P[1] / P[2], d = c.dist || [];
    const k1 = d[0] || 0, k2 = d[1] || 0, p1 = d[2] || 0, p2 = d[3] || 0, k3 = d[4] || 0;
    const r2 = x * x + y * y, rad = 1 + k1 * r2 + k2 * r2 * r2 + k3 * r2 * r2 * r2;
    const xd = x * rad + 2 * p1 * x * y + p2 * (r2 + 2 * x * x), yd = y * rad + p1 * (r2 + 2 * y * y) + 2 * p2 * x * y;
    return [c.fx * xd + c.cx, c.fy * yd + c.cy];
  }

  // Depth noise of one square tag of side s (m) at distance z (m), for corner noise px (pixels):
  // depth ≈ f·s / (size in px), so δz ≈ z² · δpx / (f·s), shrunk by √4 for four corners.
  function depthNoise(c, s, z, px) { return (z * z * px) / (c.fx * s) / 2; }

  // ---- history: the last few seconds of poses per tag ----
  function History() { this.tracks = new Map(); }
  History.prototype.push = function (id, time, pose) {
    let a = this.tracks.get(id);
    if (!a) { a = []; this.tracks.set(id, a); }
    if (a.length && time <= a[a.length - 1].time) return; // out of order or repeated frame
    a.push({ time, R: pose.R, t: pose.t });
  };
  // Drop samples older than `span` seconds before `now`, and tracks left empty.
  History.prototype.trim = function (now, span) {
    for (const [id, a] of this.tracks) {
      let k = 0;
      while (k < a.length && a[k].time < now - span) k++;
      if (k) a.splice(0, k);
      if (!a.length) this.tracks.delete(id);
    }
  };
  History.prototype.get = function (id) { return this.tracks.get(id) || []; };
  History.prototype.ids = function () { return Array.from(this.tracks.keys()); };
  History.prototype.clear = function () { this.tracks.clear(); };
  History.prototype.latest = function (id) { const a = this.get(id); return a.length ? a[a.length - 1] : null; };

  // The samples to draw axes at: one per `every` seconds back from the newest sample, the nearest within
  // half a step, oldest first. A gap in tracking leaves a gap in the axes rather than a misplaced one.
  function axisSamples(a, now, span, every) {
    if (!a.length || !(every > 0)) return [];
    const out = [], n = Math.floor(span / every + 1e-9);
    let j = a.length - 1;
    for (let k = 0; k <= n; k++) {
      const want = now - k * every;
      while (j > 0 && a[j].time > want && Math.abs(a[j - 1].time - want) <= Math.abs(a[j].time - want)) j--;
      if (Math.abs(a[j].time - want) <= every / 2 && now - a[j].time <= span + 1e-9 && out.indexOf(a[j]) < 0) out.push(a[j]);
    }
    return out.reverse();
  }

  // ---- the 3D plot: an orbit camera around a target ----
  // yaw turns about Z (up), pitch tilts up from the horizon; dist in metres; fov vertical, in degrees.
  function orbit(o) {
    const cy = Math.cos(o.yaw), sy = Math.sin(o.yaw), cp = Math.cos(o.pitch), sp = Math.sin(o.pitch);
    // where the eye sits, relative to the target
    const back = [sy * cp, -cy * cp, sp]; // looking along -back
    const eye = add(o.target, back.map((x) => x * o.dist));
    const fwd = back.map((x) => -x), right = [cy, sy, 0], up = [-sy * sp, cy * sp, cp];
    const f = o.h / 2 / Math.tan((o.fov * Math.PI) / 360);
    return {
      eye, right, up, fwd,
      project(P) {
        const d = sub(P, eye), z = d[0] * fwd[0] + d[1] * fwd[1] + d[2] * fwd[2];
        if (z < 1e-3) return null;
        const x = d[0] * right[0] + d[1] * right[1] + d[2] * right[2], y = d[0] * up[0] + d[1] * up[1] + d[2] * up[2];
        return [o.w / 2 + (f * x) / z, o.h / 2 - (f * y) / z, z];
      },
    };
  }
  // A round grid step (1, 2 or 5 × 10ⁿ) that gives about `n` lines across `range`.
  function niceStep(range, n) {
    const raw = range / Math.max(1, n), p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
    return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
  }

  // ---- calibration captures ----
  // A view of the board, summarised as where it sits in the frame, how big it is and how it leans
  // (from its corner spread), so the auto-capture can skip near-duplicates.
  function viewSignature(pts, w, h) {
    let sx = 0, sy = 0;
    for (const p of pts) { sx += p[0]; sy += p[1]; }
    const mx = sx / pts.length, my = sy / pts.length;
    let xx = 0, yy = 0, xy = 0;
    for (const p of pts) { const dx = p[0] - mx, dy = p[1] - my; xx += dx * dx; yy += dy * dy; xy += dx * dy; }
    xx /= pts.length; yy /= pts.length; xy /= pts.length;
    const size = Math.sqrt(Math.sqrt(Math.max(1e-9, xx * yy - xy * xy))) / Math.min(w, h);
    return [mx / w, my / h, size, (xx - yy) / (xx + yy), (2 * xy) / (xx + yy)];
  }
  function signatureDistance(a, b) {
    return Math.hypot(a[0] - b[0], a[1] - b[1], 2 * (a[2] - b[2]), 0.5 * (a[3] - b[3]), 0.5 * (a[4] - b[4]));
  }
  // Mean pixel movement of the corners two frames share (by id), or Infinity if they share fewer than 4.
  function cornerMotion(a, b) {
    if (!a || !b) return Infinity;
    const m = new Map();
    for (let i = 0; i < a.ids.length; i++) m.set(a.ids[i], a.pts[i]);
    let s = 0, n = 0;
    for (let i = 0; i < b.ids.length; i++) { const p = m.get(b.ids[i]); if (p) { s += Math.hypot(p[0] - b.pts[i][0], p[1] - b.pts[i][1]); n++; } }
    return n >= 4 ? s / n : Infinity;
  }
  // How much of the frame the captures cover, on a gx × gy grid (0 to 1). Lens distortion is strongest at
  // the edges, so a calibration needs corners there too.
  function coverage(views, w, h, gx, gy) {
    const cells = new Uint8Array(gx * gy);
    for (const v of views) for (const p of v) {
      const i = Math.min(gx - 1, Math.max(0, Math.floor((p[0] / w) * gx))), j = Math.min(gy - 1, Math.max(0, Math.floor((p[1] / h) * gy)));
      cells[j * gx + i] = 1;
    }
    let n = 0;
    for (const c of cells) n += c;
    return { cells, fraction: n / cells.length };
  }

  // ---- settings ----
  const DEFAULTS = {
    family: 'APRILTAG_36h11',
    span: 1.0, // seconds of history plotted
    every: 0.1, // seconds between drawn axes
    axisLen: 0.05, // metres
    tagSize: 0.08, // metres, for tags not in the list
    hfov: 70, // degrees, used until the camera is calibrated
    frame: 'camera', // or a tag id: plot relative to that tag
    showUnknown: true,
  };
  function clampSettings(s) {
    const o = Object.assign({}, DEFAULTS, s || {});
    const num = (k, lo, hi) => { const x = Number(o[k]); o[k] = isFinite(x) ? Math.min(hi, Math.max(lo, x)) : DEFAULTS[k]; };
    num('span', 0.1, 30); num('every', 0.01, 10); num('axisLen', 0.001, 2); num('tagSize', 0.005, 2); num('hfov', 20, 170);
    if (o.every > o.span) o.every = o.span;
    return o;
  }

  return {
    mul3, tr3, mulv, add, sub, norm, rodrigues, angleOf, compose, inverse, relative, toView, inFrame, CAM_TO_VIEW, TAG_TO_VIEW,
    guessIntrinsics, scaleIntrinsics, checkCalibration, hfov, project, depthNoise,
    History, axisSamples, orbit, niceStep, viewSignature, signatureDistance, cornerMotion, coverage,
    DEFAULTS, clampSettings,
  };
});
