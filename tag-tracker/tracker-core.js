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

  // A rotation matrix as a unit quaternion [w, x, y, z] with w ≥ 0 (q and −q are the same turn). Shepperd's
  // method: start from the largest of w, x, y, z so nothing divides by a small number.
  function quatOf(R) {
    const tr = R[0] + R[4] + R[8], c = [tr, R[0], R[4], R[8]], k = c.indexOf(Math.max(...c));
    let q;
    if (k === 0) { const s = 2 * Math.sqrt(1 + tr); q = [s / 4, (R[7] - R[5]) / s, (R[2] - R[6]) / s, (R[3] - R[1]) / s]; }
    else if (k === 1) { const s = 2 * Math.sqrt(1 + R[0] - R[4] - R[8]); q = [(R[7] - R[5]) / s, s / 4, (R[1] + R[3]) / s, (R[2] + R[6]) / s]; }
    else if (k === 2) { const s = 2 * Math.sqrt(1 - R[0] + R[4] - R[8]); q = [(R[2] - R[6]) / s, (R[1] + R[3]) / s, s / 4, (R[5] + R[7]) / s]; }
    else { const s = 2 * Math.sqrt(1 - R[0] - R[4] + R[8]); q = [(R[3] - R[1]) / s, (R[2] + R[6]) / s, (R[5] + R[7]) / s, s / 4]; }
    const n = Math.hypot(...q) * (q[0] < 0 ? -1 : 1);
    return q.map((x) => x / n);
  }
  // The sign of q that is nearest `prev`, so a plotted quaternion doesn't jump between q and −q.
  function quatNear(q, prev) { return prev && q[0] * prev[0] + q[1] * prev[1] + q[2] * prev[2] + q[3] * prev[3] < 0 ? q.map((x) => -x) : q; }
  // Tare: the orientation measured from R0, in R0's own axes (R0ᵀR), so a pose that is still at R0 reads as the
  // identity. Position is left alone. R0 null means no tare.
  function tared(p, R0) { return R0 ? { R: mul3(tr3(R0), p.R), t: p.t } : p; }

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

  // Mirror view: everything as seen in a mirror, left and right swapped (x → −x in the plotted frame, whose x is the
  // camera's x, or the reference tag's). A reflection isn't a rotation, so each orientation is conjugated:
  // R → M·R·M with M = diag(−1, 1, 1), still a rotation (the mirror image's orientation; a quaternion (w, x, y, z)
  // becomes (w, x, −y, −z)). Doing it twice undoes it. Other fields are kept.
  function mirrorR(R) { return [R[0], -R[1], -R[2], -R[3], R[4], R[5], -R[6], R[7], R[8]]; }
  function mirrorPose(p) { return Object.assign({}, p, { R: mirrorR(p.R), t: [-p.t[0], p.t[1], p.t[2]] }); }

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

  // ---- SE(3): refinement, ambiguity, rigid objects, filtering ----
  // Perturbations are on the left, in the camera frame: T ← exp(ξ^)·T with ξ = (ρ, φ). Covariances handed to
  // the rest of the page are in "filter coordinates" (δp, δθ): t ← t + δp, R ← exp(δθ)·R.
  const skew = (v) => [0, -v[2], v[1], v[2], 0, -v[0], -v[1], v[0], 0];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const col = (R, j) => [R[j], R[3 + j], R[6 + j]];
  // log of a rotation: the rotation vector (axis × angle), also near π
  function so3Log(R) {
    const c = Math.max(-1, Math.min(1, (R[0] + R[4] + R[8] - 1) / 2)), th = Math.acos(c);
    if (th < 1e-7) return [(R[7] - R[5]) / 2, (R[2] - R[6]) / 2, (R[3] - R[1]) / 2];
    if (Math.PI - th < 1e-4) {
      // R ≈ 2aaᵀ − I: take the largest diagonal entry for the axis
      const d = [R[0], R[4], R[8]], i = d.indexOf(Math.max(...d)), a = [0, 0, 0];
      a[i] = Math.sqrt(Math.max(0, (d[i] + 1) / 2));
      for (let j = 0; j < 3; j++) if (j !== i) a[j] = (R[3 * i + j] + R[3 * j + i]) / (4 * a[i]);
      const n = norm(a), s = (R[7] - R[5]) * a[0] + (R[2] - R[6]) * a[1] + (R[3] - R[1]) * a[2] < 0 ? -1 : 1;
      return scale(a, (s * th) / n);
    }
    const k = th / (2 * Math.sin(th));
    return [(R[7] - R[5]) * k, (R[2] - R[6]) * k, (R[3] - R[1]) * k];
  }
  // exp of a twist ξ = (ρ, φ): the rigid motion {R, t}
  function se3Exp(xi) {
    const rho = xi.slice(0, 3), phi = xi.slice(3, 6), th = norm(phi), K = skew(phi), K2 = mul3(K, K);
    let a, b;
    if (th < 1e-6) { a = 0.5 - th * th / 24; b = 1 / 6 - th * th / 120; } else { a = (1 - Math.cos(th)) / (th * th); b = (th - Math.sin(th)) / (th * th * th); }
    const V = I3.map((x, i) => x + a * K[i] + b * K2[i]);
    return { R: rodrigues(phi), t: mulv(V, rho) };
  }
  // small dense helpers (arrays of rows)
  const zeros = (n, m) => Array.from({ length: n }, () => new Array(m).fill(0));
  const eye = (n) => { const A = zeros(n, n); for (let i = 0; i < n; i++) A[i][i] = 1; return A; };
  const mm = (A, B) => A.map((r) => B[0].map((_, j) => r.reduce((s, x, k) => s + x * B[k][j], 0)));
  const mT = (A) => A[0].map((_, j) => A.map((r) => r[j]));
  const madd = (A, B) => A.map((r, i) => r.map((x, j) => x + B[i][j]));
  const mv = (A, v) => A.map((r) => r.reduce((s, x, k) => s + x * v[k], 0));
  // inverse by Gauss–Jordan with partial pivoting; null if singular
  function minv(A) {
    const n = A.length, M = A.map((r, i) => r.concat(eye(n)[i]));
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-15) return null;
      [M[c], M[p]] = [M[p], M[c]];
      const d = M[c][c];
      for (let j = 0; j < 2 * n; j++) M[c][j] /= d;
      for (let r = 0; r < n; r++) if (r !== c && M[r][c] !== 0) { const f = M[r][c]; for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j]; }
    }
    return M.map((r) => r.slice(n));
  }
  const sym = (A) => A.map((r, i) => r.map((x, j) => (x + A[j][i]) / 2));

  // Undo lens distortion: pixel → normalised image coordinates (x/z, y/z), by fixed-point iteration as OpenCV does.
  function undistort(c, u, v) {
    const x0 = (u - c.cx) / c.fx, y0 = (v - c.cy) / c.fy, d = c.dist || [];
    const k1 = d[0] || 0, k2 = d[1] || 0, p1 = d[2] || 0, p2 = d[3] || 0, k3 = d[4] || 0;
    if (!(k1 || k2 || p1 || p2 || k3)) return [x0, y0];
    let x = x0, y = y0;
    for (let i = 0; i < 20; i++) {
      const r2 = x * x + y * y, rad = 1 + k1 * r2 + k2 * r2 * r2 + k3 * r2 * r2 * r2;
      const dx = 2 * p1 * x * y + p2 * (r2 + 2 * x * x), dy = p1 * (r2 + 2 * y * y) + 2 * p2 * x * y;
      x = (x0 - dx) / rad; y = (y0 - dy) / rad;
    }
    return [x, y];
  }
  // A square tag's corners in its own frame, in the order the detector reports them.
  function tagCorners(s) { const h = s / 2; return [[-h, h, 0], [h, h, 0], [h, -h, 0], [-h, -h, 0]]; }

  // Levenberg–Marquardt on SE(3): move the pose to minimise the pixel error between the image points and the
  // projected object points. Residuals are taken on undistorted coordinates scaled by the focal length, so they
  // are pixels and the projection Jacobian is the plain pinhole one. Returns the pose, the summed squared error,
  // the RMS error, and the covariance for corner noise of `sigma` px, in (δp, δθ).
  function refinePose(c, obj, img, pose, opts) {
    const o = Object.assign({ iters: 20, sigma: 0.2 }, opts || {});
    const obs = img.map((p) => undistort(c, p[0], p[1]));
    let R = pose.R.slice(), t = pose.t.slice();
    const cost = (R, t) => {
      let s = 0;
      for (let i = 0; i < obj.length; i++) {
        const p = add(mulv(R, obj[i]), t);
        if (p[2] <= 1e-6) return Infinity;
        const ex = c.fx * (p[0] / p[2] - obs[i][0]), ey = c.fy * (p[1] / p[2] - obs[i][1]);
        s += ex * ex + ey * ey;
      }
      return s;
    };
    const linearise = (R, t) => {
      const H = zeros(6, 6), g = new Array(6).fill(0);
      for (let i = 0; i < obj.length; i++) {
        const p = add(mulv(R, obj[i]), t), z = p[2], iz = 1 / z;
        const r = [c.fx * (p[0] * iz - obs[i][0]), c.fy * (p[1] * iz - obs[i][1])];
        const Jp = [[c.fx * iz, 0, -c.fx * p[0] * iz * iz], [0, c.fy * iz, -c.fy * p[1] * iz * iz]];
        const P = skew(p); // dp/dξ = [I, −[p]×]
        for (let k = 0; k < 2; k++) {
          const J = [Jp[k][0], Jp[k][1], Jp[k][2],
            -(Jp[k][0] * P[0] + Jp[k][1] * P[3] + Jp[k][2] * P[6]),
            -(Jp[k][0] * P[1] + Jp[k][1] * P[4] + Jp[k][2] * P[7]),
            -(Jp[k][0] * P[2] + Jp[k][1] * P[5] + Jp[k][2] * P[8])];
          for (let a = 0; a < 6; a++) { g[a] += J[a] * r[k]; for (let b = 0; b < 6; b++) H[a][b] += J[a] * J[b]; }
        }
      }
      return { H, g };
    };
    let e = cost(R, t), lambda = 1e-3, it = 0;
    for (; it < o.iters && isFinite(e); it++) {
      const { H, g } = linearise(R, t);
      let improved = false;
      for (let tries = 0; tries < 8; tries++) {
        const A = H.map((r, i) => r.map((x, j) => (i === j ? x * (1 + lambda) + 1e-12 : x)));
        const Ai = minv(A);
        if (!Ai) { lambda *= 10; continue; }
        const xi = mv(Ai, g).map((x) => -x), d = se3Exp(xi);
        const R2 = mul3(d.R, R), t2 = add(mulv(d.R, t), d.t), e2 = cost(R2, t2);
        if (e2 < e) {
          R = R2; t = t2; lambda = Math.max(1e-9, lambda / 3); improved = (e - e2) > 1e-12 * (1 + e); e = e2;
          if (norm(xi) < 1e-10) improved = false;
          break;
        }
        lambda *= 4;
      }
      if (!improved) break;
    }
    // re-orthonormalise (Gram–Schmidt on the columns) against drift
    const x = col(R, 0), xn = scale(x, 1 / norm(x)), y0 = col(R, 1), y1 = add(y0, scale(xn, -dot(xn, y0))), yn = scale(y1, 1 / norm(y1)), zn = cross(xn, yn);
    R = [xn[0], yn[0], zn[0], xn[1], yn[1], zn[1], xn[2], yn[2], zn[2]];
    const { H } = linearise(R, t), Hi = minv(H);
    // 'auto' takes the corner noise from the fit itself, never below 0.15 px (a single tag's 8 numbers leave only
    // 2 degrees of freedom, so its own scatter says little) or above 3 px
    if (o.sigma === 'auto') o.sigma = Math.min(3, Math.max(0.15, Math.sqrt(e / Math.max(1, 2 * obj.length - 6))));
    let cov = null;
    if (Hi) {
      // ξ → (δp, δθ): δθ = φ and δp = ρ + φ × t = ρ − [t]× φ
      const A = zeros(6, 6), Tx = skew(t);
      for (let i = 0; i < 6; i++) A[i][i] = 1;
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) A[i][3 + j] = -Tx[3 * i + j];
      cov = sym(mm(mm(A, Hi.map((r) => r.map((v) => v * o.sigma * o.sigma))), mT(A)));
    }
    return { R, t, cost: e, rms: Math.sqrt(e / obj.length), cov, sigma: o.sigma, iters: it };
  }

  // A flat square seen face-on has two poses that fit almost equally: its normal mirrored about the line of sight.
  // This makes the second starting guess.
  function flipPose(p) {
    const v = scale(p.t, 1 / norm(p.t)), n = col(p.R, 2), n2 = add(scale(v, 2 * dot(n, v)), scale(n, -1));
    const ax = cross(n, n2), s = norm(ax), c = Math.max(-1, Math.min(1, dot(n, n2)));
    if (s < 1e-9) return { R: p.R.slice(), t: p.t.slice() };
    return { R: mul3(rodrigues(scale(ax, Math.atan2(s, c) / s)), p.R), t: p.t.slice() };
  }
  // Refined candidates from one or more starting poses, best (lowest error) first, near-duplicates merged.
  function candidates(c, obj, img, starts, opts) {
    const out = [];
    for (const s of starts) {
      const r = refinePose(c, obj, img, s, opts);
      if (!isFinite(r.cost) || r.t[2] <= 0) continue;
      if (out.some((q) => angleOf(mul3(tr3(q.R), r.R)) < 0.02 && norm(sub(q.t, r.t)) < 1e-3)) continue;
      out.push(r);
    }
    return out.sort((a, b) => a.cost - b.cost);
  }
  // One tag: refine OpenCV's pose and its mirror image.
  function solveTag(c, corners, size, raw, opts) {
    const obj = tagCorners(size), img = [0, 1, 2, 3].map((k) => [corners[2 * k], corners[2 * k + 1]]);
    return candidates(c, obj, img, [raw, flipPose(raw)], opts);
  }
  // A rigid object: several tags at known poses in the object's frame (members: {id, R, t, size}), solved as one
  // pose from every visible corner. Each visible tag (and its mirror) gives a starting guess.
  // Starting guesses come from the two tags that look biggest in the picture (the best-measured), and their mirrors.
  function solveBody(c, body, dets, opts) {
    const obj = [], img = [], seeds = [];
    for (const m of body.members) {
      const d = dets.find((x) => x.id === m.id);
      if (!d) continue;
      const pts = tagCorners(m.size), q = d.corners;
      for (let k = 0; k < 4; k++) { obj.push(add(mulv(m.R, pts[k]), m.t)); img.push([q[2 * k], q[2 * k + 1]]); }
      if (d.R) seeds.push({ d, m, area: Math.abs((q[0] - q[4]) * (q[3] - q[7]) - (q[2] - q[6]) * (q[1] - q[5])) });
    }
    const starts = [];
    for (const { d, m } of seeds.sort((a, b) => b.area - a.area).slice(0, 2)) {
      const inv = inverse({ R: m.R, t: m.t });
      starts.push(compose(d, inv), compose(flipPose(d), inv));
    }
    if (!starts.length) return [];
    const seen = new Set(dets.map((d) => d.id));
    return candidates(c, obj, img, starts, opts).map((r) => Object.assign(r, { seen: body.members.filter((m) => seen.has(m.id)).length }));
  }

  // Mean of rotations on SO(3) (Karcher mean): average the logs about the current guess and move there.
  function meanRotation(Rs) {
    let M = Rs[0].slice();
    for (let it = 0; it < 30; it++) {
      let s = [0, 0, 0];
      for (const R of Rs) s = add(s, so3Log(mul3(R, tr3(M))));
      s = scale(s, 1 / Rs.length);
      M = mul3(rodrigues(s), M);
      if (norm(s) < 1e-12) break;
    }
    return M;
  }
  // Mean pose of samples, dropping those more than `deg` degrees or `m` metres from a first mean.
  function meanPose(ps, deg, m) {
    const once = (a) => ({ R: meanRotation(a.map((p) => p.R)), t: scale(a.reduce((s, p) => add(s, p.t), [0, 0, 0]), 1 / a.length) });
    let mu = once(ps);
    const keep = ps.filter((p) => angleOf(mul3(tr3(mu.R), p.R)) <= (deg * Math.PI) / 180 && norm(sub(p.t, mu.t)) <= m);
    if (keep.length >= Math.max(3, ps.length / 2)) mu = once(keep);
    const spread = keep.length ? {
      deg: Math.sqrt(keep.reduce((s, p) => s + angleOf(mul3(tr3(mu.R), p.R)) ** 2, 0) / keep.length) * 180 / Math.PI,
      m: Math.sqrt(keep.reduce((s, p) => s + norm(sub(p.t, mu.t)) ** 2, 0) / keep.length),
    } : { deg: NaN, m: NaN };
    return Object.assign(mu, { used: keep.length, spread });
  }

  // The candidates that fit the image about as well as the best (best first): a flat tag seen nearly face-on fits two
  // poses, mirror images of each other, and noise decides which fits better. The filter uses the same rule.
  function plausible(cands) {
    const b = cands[0];
    return cands.filter((c, i) => !i || c.rms <= Math.max(2 * b.rms, b.rms + 0.5));
  }
  // Pick one of a frame's candidates. `others`: what the other cameras see of the same track now, each a list of
  // rotations (its plausible candidates); the candidate nearest all of them wins. With no other camera, `prev` (the
  // track's last rotation) keeps the choice where it was, so the pose doesn't flip back and forth. Otherwise, the best fit.
  function chooseCand(cands, others, prev) {
    if (!cands.length) return null;
    const ok = plausible(cands);
    if (ok.length < 2) return ok[0];
    const near = (R, Rs) => Math.min(...Rs.map((Q) => angleOf(mul3(tr3(Q), R))));
    let score = null;
    if (others && others.length) score = (c) => others.reduce((s, Rs) => s + near(c.R, Rs), 0);
    else if (prev) score = (c) => near(c.R, [prev]);
    if (!score) return ok[0];
    return ok.reduce((a, c) => (score(c) < score(a) ? c : a));
  }

  // ---- one pose from every camera's corners ----
  // The corners themselves, not each camera's own pose, are what the joint fit and the filter use ("tightly coupled",
  // as in Neunert et al. 2016 and TagSLAM): a camera that sees a tag small or nearly face-on adds exactly as much as
  // its corners say, and two views settle the mirror-image doubt that one view can't.
  //
  // One camera's sighting of a track: its lens (cam) and pose in the rig (T: camera → rig), the track's points in the
  // track's own frame (obj) and where the camera saw them (img, pixels, as detected, so still distorted), the corner
  // noise (sigma, px), and dt: this frame's time minus the time being solved for (cameras aren't synchronised).
  function sighting(cam, T, obj, img, sigma, dt) {
    const P = T || { R: I3, t: [0, 0, 0] };
    return { cam, T: P, Rt: tr3(P.R), obj, obs: img.map((q) => undistort(cam, q[0], q[1])), sigma: Math.max(0.1, sigma || 0.5), dt: dt || 0 };
  }
  // The normal equations of every corner of every sighting, for the track at (R, t) in the rig frame, each sighting moved
  // to its own time by `vel` ({v, w}: m/s and rad/s in the rig frame, t + v·dt and exp(w·dt)·R, the filter's motion model).
  // Residuals are pixels on undistorted coordinates divided by each sighting's sigma (so whitened); the Jacobian is in
  // (δp, δθ), t ← t + δp and R ← exp(δθ)·R. A Huber weight (k, in sigmas) keeps one bad corner from dragging the rest.
  function jointSystem(views, R, t, vel, k) {
    const H = zeros(6, 6), g = new Array(6).fill(0), per = [];
    let cost = 0, n = 0, chi = 0;
    for (const s of views) {
      const moved = vel && s.dt, E = moved ? rodrigues(scale(vel.w || [0, 0, 0], s.dt)) : I3, tt = moved ? add(t, scale(vel.v || [0, 0, 0], s.dt)) : t;
      const fx = s.cam.fx / s.sigma, fy = s.cam.fy / s.sigma;
      let ss = 0;
      for (let i = 0; i < s.obj.length; i++) {
        const Ro = mulv(R, s.obj[i]), X = add(mulv(E, Ro), tt), Xc = mulv(s.Rt, sub(X, s.T.t));
        if (Xc[2] <= 1e-6) return { cost: Infinity };
        const iz = 1 / Xc[2], r = [fx * (Xc[0] * iz - s.obs[i][0]), fy * (Xc[1] * iz - s.obs[i][1])];
        const e2 = r[0] * r[0] + r[1] * r[1], e = Math.sqrt(e2), w = e <= k ? 1 : k / e;
        cost += e <= k ? e2 : 2 * k * e - k * k; ss += e2; chi += e2; n++;
        // dr/dX = Jp·Rtᵀ; dX/dδp = I; dX/dδθ = −E·[R o]×
        const Jp = [[fx * iz, 0, -fx * Xc[0] * iz * iz], [0, fy * iz, -fy * Xc[1] * iz * iz]];
        const ERo = mul3(E, skew(Ro));
        for (let a = 0; a < 2; a++) {
          const JX = [0, 1, 2].map((j) => Jp[a][0] * s.Rt[j] + Jp[a][1] * s.Rt[3 + j] + Jp[a][2] * s.Rt[6 + j]);
          const J = [JX[0], JX[1], JX[2], ...[0, 1, 2].map((j) => -(JX[0] * ERo[j] + JX[1] * ERo[3 + j] + JX[2] * ERo[6 + j]))];
          for (let u = 0; u < 6; u++) { g[u] += w * J[u] * r[a]; for (let v = 0; v < 6; v++) H[u][v] += w * J[u] * J[v]; }
        }
      }
      per.push(Math.sqrt(ss / Math.max(1, s.obj.length)) * s.sigma);
    }
    return { H, g, cost, chi, n, per };
  }
  // Levenberg–Marquardt for one pose against every sighting at once (a bundle adjustment with the cameras held where
  // the rig put them). Returns the pose, its covariance in (δp, δθ) (inflated when the corners scatter more than their
  // sigmas say), the RMS error in pixels overall and per sighting, and the number of iterations.
  function refineJoint(views, pose, opts) {
    const o = Object.assign({ iters: 15, k: 2.5, vel: null }, opts || {});
    let R = pose.R.slice(), t = pose.t.slice(), sys = jointSystem(views, R, t, o.vel, o.k), lambda = 1e-3, it = 0;
    for (; it < o.iters && isFinite(sys.cost); it++) {
      let improved = false;
      for (let tries = 0; tries < 8; tries++) {
        const Ai = minv(sys.H.map((r, i) => r.map((x, j) => (i === j ? x * (1 + lambda) + 1e-9 : x))));
        if (!Ai) { lambda *= 10; continue; }
        const d = mv(Ai, sys.g).map((x) => -x), R2 = mul3(rodrigues(d.slice(3, 6)), R), t2 = add(t, d.slice(0, 3));
        const s2 = jointSystem(views, R2, t2, o.vel, o.k);
        if (s2.cost < sys.cost) {
          improved = sys.cost - s2.cost > 1e-10 * (1 + sys.cost) && norm(d) > 1e-12;
          R = R2; t = t2; sys = s2; lambda = Math.max(1e-9, lambda / 3);
          break;
        }
        lambda *= 4;
      }
      if (!improved) break;
    }
    if (!isFinite(sys.cost)) return null;
    const Hi = minv(sys.H), dof = Math.max(1, 2 * sys.n - 6), s2 = Math.max(1, sys.chi / dof);
    return { R, t, cov: Hi ? sym(Hi.map((r) => r.map((x) => x * s2))) : null, rms: Math.sqrt((sys.chi / Math.max(1, sys.n)) * (views.reduce((a, v) => a + v.sigma * v.sigma, 0) / views.length)), perView: sys.per, iters: it, views: views.length };
  }

  // ---- where to look next ----
  // Search windows for the detector from predicted corners: preds = [{pts: [[u, v], ...], pad}] in pixels. Each becomes
  // its corners' bounding box grown by `pad`, kept inside the picture and at least `min` wide; windows that touch or
  // nearly touch (within `join` px) are merged. Returns {rois: [{x, y, w, h}], frac} (frac: the share of the picture
  // searched), or null when a full search is as cheap (the windows cover more than `most` of the picture) or there
  // is nothing to look for.
  function planSearch(preds, W, H, opts) {
    const o = Object.assign({ min: 64, join: 24, most: 0.5 }, opts || {});
    let boxes = [];
    for (const p of preds) {
      if (!p.pts.length) continue;
      const xs = p.pts.map((q) => q[0]), ys = p.pts.map((q) => q[1]);
      let x0 = Math.min(...xs) - p.pad, x1 = Math.max(...xs) + p.pad, y0 = Math.min(...ys) - p.pad, y1 = Math.max(...ys) + p.pad;
      if (x1 - x0 < o.min) { const c = (x0 + x1) / 2; x0 = c - o.min / 2; x1 = c + o.min / 2; }
      if (y1 - y0 < o.min) { const c = (y0 + y1) / 2; y0 = c - o.min / 2; y1 = c + o.min / 2; }
      x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(W, Math.ceil(x1)); y1 = Math.min(H, Math.ceil(y1));
      if (x1 - x0 >= 8 && y1 - y0 >= 8) boxes.push([x0, y0, x1, y1]);
    }
    if (!boxes.length) return null;
    for (let merged = true; merged;) {
      merged = false;
      outer: for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        if (a[0] - o.join <= b[2] && b[0] - o.join <= a[2] && a[1] - o.join <= b[3] && b[1] - o.join <= a[3]) {
          boxes[i] = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
          boxes.splice(j, 1); merged = true; break outer;
        }
      }
    }
    const area = boxes.reduce((s, b) => s + (b[2] - b[0]) * (b[3] - b[1]), 0), frac = area / (W * H);
    if (frac > o.most) return null;
    return { rois: boxes.map((b) => ({ x: b[0], y: b[1], w: b[2] - b[0], h: b[3] - b[1] })), frac };
  }

  // ---- motion sensors: nrf-controller boards over Bluetooth ----
  // The boards' data service (nrf-controller's src/sysid_wire.h; its dashboard's wire.js decodes the same bytes). Every
  // value is little-endian. The IMU characteristic notifies batches: a 12-byte header (u8 version, u8 count, u32 first
  // seq, i16[3] VQF's gyro bias in centi-degrees/s), then `count` 25-byte samples (u32 board time in µs, low 32 bits;
  // i16[3] gyro counts, bias not removed; i16[3] accelerometer counts; i16[4] VQF's quaternion w, x, y, z with
  // 1.0 = 16384, turning the IMU's frame into a world frame with z up and a free heading; u8 flags, bit 0 at rest).
  // Board info is read once: the gyro's and accelerometer's scales per count.
  const IMU = {
    service: '6f524c03-0001-4a3c-9d21-1122334455aa', data: '6f524c03-0002-4a3c-9d21-1122334455aa', info: '6f524c03-0005-4a3c-9d21-1122334455aa',
    version: 1, header: 12, sample: 25, infoBytes: 20, namePrefix: 'nrf-controller',
  };
  function decodeBoardInfo(v) {
    if (v.byteLength !== IMU.infoBytes || v.getUint8(0) !== IMU.version) return null;
    return { boardId: v.getUint16(1, true).toString(16).toUpperCase().padStart(4, '0'), imuRateHz: v.getUint16(3, true), gyroDpsPerLsb: v.getFloat32(5, true), accelGPerLsb: v.getFloat32(9, true), imuDropped: v.getUint32(16, true) };
  }
  function decodeImuBatch(v) {
    if (v.byteLength < IMU.header || v.getUint8(0) !== IMU.version) return null;
    const n = v.getUint8(1);
    if (v.byteLength !== IMU.header + n * IMU.sample) return null;
    const i16 = (o) => v.getInt16(o, true), first = v.getUint32(2, true), samples = [];
    for (let i = 0; i < n; i++) {
      const o = IMU.header + i * IMU.sample;
      samples.push({ seq: (first + i) >>> 0, tUs: v.getUint32(o, true), gyro: [i16(o + 4), i16(o + 6), i16(o + 8)], accel: [i16(o + 10), i16(o + 12), i16(o + 14)], q: [i16(o + 16), i16(o + 18), i16(o + 20), i16(o + 22)].map((x) => x / 16384), rest: !!(v.getUint8(o + 24) & 1) });
    }
    return { firstSeq: first, biasDps: [i16(6) / 100, i16(8) / 100, i16(10) / 100], samples };
  }
  // The same bytes, for the demo's simulated boards and the tests.
  function encodeImuBatch(firstSeq, biasDps, samples) {
    const b = new DataView(new ArrayBuffer(IMU.header + samples.length * IMU.sample)), i16 = (o, x) => b.setInt16(o, Math.max(-32768, Math.min(32767, Math.round(x))), true);
    b.setUint8(0, IMU.version); b.setUint8(1, samples.length); b.setUint32(2, firstSeq >>> 0, true);
    biasDps.forEach((x, k) => i16(6 + 2 * k, x * 100));
    samples.forEach((s, i) => {
      const o = IMU.header + i * IMU.sample;
      b.setUint32(o, s.tUs >>> 0, true);
      s.gyro.forEach((x, k) => i16(o + 4 + 2 * k, x)); s.accel.forEach((x, k) => i16(o + 10 + 2 * k, x)); s.q.forEach((x, k) => i16(o + 16 + 2 * k, x * 16384));
      b.setUint8(o + 24, s.rest ? 1 : 0);
    });
    return b;
  }
  function encodeBoardInfo(boardId, imuRateHz, gyroDpsPerLsb, accelGPerLsb) {
    const b = new DataView(new ArrayBuffer(IMU.infoBytes));
    b.setUint8(0, IMU.version); b.setUint16(1, boardId, true); b.setUint16(3, imuRateHz, true); b.setFloat32(5, gyroDpsPerLsb, true); b.setFloat32(9, accelGPerLsb, true);
    return b;
  }
  // The gripper on the operator's hand: a feedback servo on the board, read through its telemetry service's Actuators
  // characteristic (nrf-controller's struct dashboard_actuator_status in src/dashboard_wire.h, decoded as its dashboard's
  // wire.js does; keep the three in step). It notifies 20 times a second while subscribed: u8 version, u8 flags (bit 4:
  // the ADC that reads the feedback is up), u8 tachammer waveform, u8 servo pattern, u8 keys, then u16 servo pulse (µs),
  // u16 feedback (mV), u16 servo rail (mV), u16 joystick x, y (mV).
  const ACT = { service: '6f524c01-0001-4a3c-9d21-1122334455aa', status: '6f524c01-000d-4a3c-9d21-1122334455aa', version: 2, bytes: 15 };
  function decodeActuatorStatus(v) {
    if (v.byteLength !== ACT.bytes || v.getUint8(0) !== ACT.version) return null;
    const f = v.getUint8(1);
    return { railOn: !!(f & 1), servoReady: !!(f & 8), analogReady: !!(f & 16), keys: v.getUint8(4), servoPulseUs: v.getUint16(5, true) || null, feedbackMv: v.getUint16(7, true), railMv: v.getUint16(9, true), joyMv: [v.getUint16(11, true), v.getUint16(13, true)] };
  }
  function encodeActuatorStatus(s) {
    const b = new DataView(new ArrayBuffer(ACT.bytes));
    b.setUint8(0, ACT.version); b.setUint8(1, (s.railOn ? 1 : 0) | (s.servoReady ? 8 : 0) | (s.analogReady ? 16 : 0)); b.setUint8(4, s.keys || 0);
    b.setUint16(5, s.servoPulseUs || 0, true); b.setUint16(7, s.feedbackMv || 0, true); b.setUint16(9, s.railMv || 0, true);
    b.setUint16(11, (s.joyMv || [0, 0])[0], true); b.setUint16(13, (s.joyMv || [0, 0])[1], true);
    return b;
  }
  // Where the servo is, in thousandths of its supply (the feedback divides the rail, so this doesn't drift with the
  // battery; the firmware's servo_feedback_permille), or null when it can't be read.
  const gripPermille = (st) => (st && st.analogReady && st.railMv > 0 ? (1000 * st.feedbackMv) / st.railMv : null);
  // How open the gripper is, 0 (closed) to 1 (open), from the servo's reading and the two the operator set (cal: {open,
  // closed} in permille, either way round). null without a reading or a calibration.
  function gripOpening(st, cal) {
    const p = gripPermille(st);
    if (p === null || !cal || !isFinite(cal.open) || !isFinite(cal.closed) || Math.abs(cal.open - cal.closed) < 5) return null;
    return Math.min(1, Math.max(0, (p - cal.closed) / (cal.open - cal.closed)));
  }

  // A unit quaternion [w, x, y, z] as a rotation matrix.
  function rotOfQuat(q) {
    const n = Math.hypot(...q), [w, x, y, z] = q.map((v) => v / n);
    return [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y), 2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x), 2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)];
  }
  // A board's clock on the page's: board time (µs, 32 bits, wrapping every ~71.6 min) is unwrapped, and each batch's
  // last sample is paired with when the batch reached the page. Bluetooth only ever adds delay, so the fit follows the
  // lower envelope of (arrival − board time): its drift from the earliest arrivals in each half of the last `span`
  // seconds (once there are `minSpan` seconds), its offset from the earliest of all. What it can't see is the
  // smallest delay itself (a few ms), so board times come out that much late.
  function BoardClock(opts) { this.o = Object.assign({ span: 30, minSpan: 8, maxPpm: 500 }, opts || {}); this.pts = []; this.ext = null; this.b0 = null; this.k = 0; this.off = null; }
  BoardClock.prototype.unwrap = function (tUs) {
    if (this.ext === null) this.ext = tUs;
    else { let d = (tUs - (this.ext % 4294967296)) % 4294967296; if (d > 2147483648) d -= 4294967296; else if (d < -2147483648) d += 4294967296; this.ext += d; }
    if (this.b0 === null) this.b0 = this.ext;
    return this.ext;
  };
  // Board µs (unwrapped) of a batch's last sample, and its arrival (s, page clock).
  BoardClock.prototype.add = function (bUs, hostS) {
    const b = (bUs - this.b0) / 1e6;
    this.pts.push([b, hostS]);
    while (this.pts.length && b - this.pts[0][0] > this.o.span) this.pts.shift();
    const a = this.pts, low = (lo, hi) => { let m = null; for (const p of a) if (p[0] >= lo && p[0] < hi && (!m || p[1] - p[0] < m[1] - m[0])) m = p; return m; };
    const span = a[a.length - 1][0] - a[0][0];
    if (span >= this.o.minSpan) {
      const mid = (a[0][0] + a[a.length - 1][0]) / 2, p = low(-Infinity, mid), q = low(mid, Infinity);
      if (p && q && q[0] - p[0] > span / 4) this.k = Math.max(-this.o.maxPpm * 1e-6, Math.min(this.o.maxPpm * 1e-6, (q[1] - q[0] - (p[1] - p[0])) / (q[0] - p[0])));
    }
    let off = Infinity;
    for (const p of a) off = Math.min(off, p[1] - p[0] * (1 + this.k));
    this.off = off;
  };
  // A board time (µs, unwrapped) on the page's clock (s).
  BoardClock.prototype.toHost = function (bUs) { return this.off === null ? null : this.off + ((bUs - this.b0) / 1e6) * (1 + this.k); };

  // How a board sits: the camera sees the object's orientation Rc (object → rig), the board reports Q (its IMU → VQF's
  // world). With M the object in the IMU's frame (object → IMU) and W VQF's world in the rig (world → rig),
  //   Rc = W · Q · M.
  // M comes from turns: between two moments the object turns by B = Rcᵢᵀ·Rcⱼ in its own frame and the IMU by
  // A = Qᵢᵀ·Qⱼ in its own, and B = Mᵀ·A·M, so A's axis is M times B's (the hand-eye problem). The axes give M (the
  // rotation nearest Σ w·a·bᵀ, weighted by how far each turn went), the mean of Rc·Mᵀ·Qᵀ gives W, and Gauss–Newton
  // on SO(3) × SO(3) refines both from every pair, dropping those more than 3× the median error. Needs turns about at
  // least two axes 30° apart. Returns {W, M, rms (rad), used} or {error}.
  function nearestRotation(B) {
    let X = B.slice();
    for (let i = 0; i < 40; i++) {
      const Y = minv([[X[0], X[1], X[2]], [X[3], X[4], X[5]], [X[6], X[7], X[8]]]);
      if (!Y) return null;
      const Xn = X.map((v, k) => (v + Y[k % 3][Math.floor(k / 3)]) / 2); // (X + X⁻ᵀ)/2
      const d = Xn.reduce((s, v, k) => s + Math.abs(v - X[k]), 0);
      X = Xn;
      if (d < 1e-13) break;
    }
    const det = X[0] * (X[4] * X[8] - X[5] * X[7]) - X[1] * (X[3] * X[8] - X[5] * X[6]) + X[2] * (X[3] * X[7] - X[4] * X[6]);
    return det > 0 ? X : null;
  }
  function lineUp(pairs, opts) {
    const o = Object.assign({ minTurn: 0.25, iters: 15 }, opts || {});
    if (pairs.length < 6) return { error: 'few' };
    const axes = [];
    let Bm = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < pairs.length; i++) for (let j = i + 1; j < pairs.length; j += Math.max(1, Math.floor(pairs.length / 25))) {
      const A = mul3(tr3(pairs[i].Q), pairs[j].Q), B = mul3(tr3(pairs[i].Rc), pairs[j].Rc), a = so3Log(A), b = so3Log(B), ta = norm(a), tb = norm(b);
      if (ta < o.minTurn || tb < o.minTurn || Math.abs(ta - tb) > 0.2) continue;
      const ua = scale(a, 1 / ta), ub = scale(b, 1 / tb), w = Math.sin(Math.min(ta, Math.PI / 2));
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) Bm[3 * r + c] += w * ua[r] * ub[c];
      axes.push(ub);
    }
    let spread = 0;
    for (let i = 0; i < axes.length; i++) for (let j = i + 1; j < axes.length; j++) spread = Math.max(spread, Math.acos(Math.min(1, Math.abs(dot(axes[i], axes[j])))));
    if (axes.length < 3 || spread < (30 * Math.PI) / 180) return { error: 'turn', spread };
    let M = nearestRotation(Bm);
    if (!M) return { error: 'turn', spread };
    let W = meanRotation(pairs.map((p) => mul3(p.Rc, mul3(tr3(M), tr3(p.Q)))));
    let use = pairs, rms = 0;
    for (let round = 0; round < 2; round++) {
      for (let it = 0; it < o.iters; it++) {
        const H = zeros(6, 6), g = new Array(6).fill(0);
        for (const p of use) {
          const P = mul3(W, mul3(p.Q, M)), r = so3Log(mul3(p.Rc, tr3(P)));
          // r(W ← exp(δw)W, M ← M·exp(δm)) ≈ r − δw − (W·Q·M)·δm
          const J = [0, 1, 2].map((i) => [-(i === 0), -(i === 1), -(i === 2), -P[3 * i], -P[3 * i + 1], -P[3 * i + 2]].map(Number));
          for (let i = 0; i < 3; i++) for (let a = 0; a < 6; a++) { g[a] += J[i][a] * r[i]; for (let b = 0; b < 6; b++) H[a][b] += J[i][a] * J[i][b]; }
        }
        const Hi = minv(H.map((row, i) => row.map((v, j) => v + (i === j ? 1e-9 : 0))));
        if (!Hi) break;
        const d = mv(Hi, g).map((v) => -v);
        W = mul3(rodrigues(d.slice(0, 3)), W); M = mul3(M, rodrigues(d.slice(3, 6)));
        if (norm(d) < 1e-10) break;
      }
      const errs = use.map((p) => angleOf(mul3(p.Rc, tr3(mul3(W, mul3(p.Q, M))))));
      const med = errs.slice().sort((a, b) => a - b)[errs.length >> 1];
      rms = Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length);
      const keep = use.filter((_, i) => errs[i] <= Math.max(3 * med, 0.02));
      if (keep.length === use.length || keep.length < 6) break;
      use = keep;
    }
    // enough turning about other axes than the main one, among the poses kept (a mirror-image outlier makes up turns)
    if (turnSpread(use, o.minTurn) < 0.2) return { error: 'turn', spread };
    return { W, M, rms, used: use.length, spread };
  }
  // The share of turns (between poses, in the object's frame) more than 30° from the main turn axis.
  function turnSpread(pairs, minTurn) {
    const axes = [];
    for (let i = 0; i < pairs.length; i++) for (let j = i + 1; j < pairs.length; j += Math.max(1, Math.floor(pairs.length / 25))) {
      const b = so3Log(mul3(tr3(pairs[i].Rc), pairs[j].Rc)), tb = norm(b);
      if (tb >= minTurn) axes.push(scale(b, 1 / tb));
    }
    if (axes.length < 3) return 0;
    let d = [1, 0.5, 0.25];
    for (let it = 0; it < 50; it++) { // the main axis: the top eigenvector of Σ b·bᵀ, by power iteration
      const n = [0, 0, 0];
      for (const a of axes) { const k = dot(a, d); n[0] += a[0] * k; n[1] += a[1] * k; n[2] += a[2] * k; }
      d = scale(n, 1 / norm(n));
    }
    return axes.filter((a) => Math.abs(dot(a, d)) < Math.cos(Math.PI / 6)).length / axes.length;
  }

  // ---- streaming ----
  // One message for the Stream tab: every track in view at time t (seconds since 1970), each with its key (a tag's id,
  // or "b:<id>" for a rigid object), name, position in metres and orientation as a unit quaternion (w, x, y, z).
  // JSON: one object per line, with the frame's name. CSV: one line per track, under STREAM_CSV_HEADER (nothing when
  // no track is in view); a field with a comma, quote or line break is quoted.
  const STREAM_CSV_HEADER = 't,track,name,x,y,z,qw,qx,qy,qz';
  function csvField(v) { const s = String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  // `view` ('in person' or 'mirror') is the JSON message's too, so a receiver knows which way left is.
  function streamMessage(fmt, t, rows, frame, view) {
    const fix = (x, d) => Number(x.toFixed(d)) || 0; // || 0 drops a "-0"
    if (fmt === 'csv') return rows.map((r) => [t.toFixed(3), r.track, r.name, ...r.p.map((x) => fix(x, 4)), ...r.q.map((x) => fix(x, 5))].map(csvField).join(',') + '\n').join('');
    return JSON.stringify({ t: fix(t, 3), frame, view: view || 'in person', tracks: rows.map((r) => ({ track: r.track, name: r.name, p: r.p.map((x) => fix(x, 4)), q: r.q.map((x) => fix(x, 5)) })) }) + '\n';
  }

  // ---- recordings, notes and voice ----
  // A recording is every new plotted pose, sample by sample, as the Stream tab would send it, plus the visitor's
  // notes. In the notes box one line is one note; a line that starts with a time (m:ss.s, or h:mm:ss.s, since the
  // recording began) is a note at that time, and any other line is a note about the whole recording.
  function fmtStamp(s) {
    const d = Math.max(0, Math.floor(s * 10 + 1e-6)), h = Math.floor(d / 36000), m = Math.floor(d / 600) % 60, sec = (d % 600) / 10;
    const ss = (sec < 10 ? '0' : '') + sec.toFixed(1);
    return h ? `${h}:${m < 10 ? '0' : ''}${m}:${ss}` : `${m}:${ss}`;
  }
  const STAMP = /^\s*(?:(\d+):)?(\d+):([0-5]\d(?:\.\d+)?)(?=\s|$)\s*(.*)$/;
  function parseNotes(text) {
    const out = [];
    for (const line of String(text || '').split(/\r?\n/)) {
      const m = STAMP.exec(line);
      if (m) { if (m[4].trim()) out.push({ t: (+m[1] || 0) * 3600 + +m[2] * 60 + +m[3], text: m[4].trim() }); }
      else if (line.trim()) out.push({ t: null, text: line.trim() });
    }
    return out;
  }
  // rec: { start (Unix s), samples: [{ t (Unix s), frame, view, rows: [{ track, name, p, q }] }] }; notes from
  // parseNotes, their times still since the start. JSON: one object, every time in Unix seconds, each sample shaped
  // like a Stream JSON message. CSV: the Stream CSV columns plus `note`, the notes on rows of their own at their times
  // (a note about the whole recording at its start).
  const RECORDING_CSV_HEADER = STREAM_CSV_HEADER + ',note';
  function recordingJson(rec, notes) {
    const fix = (x, d) => Number(x.toFixed(d)) || 0;
    const last = rec.samples.length ? rec.samples[rec.samples.length - 1].t : rec.start;
    return JSON.stringify({
      format: 'tag-tracker-recording/1', start: fix(rec.start, 3), end: fix(Math.max(rec.end || 0, last), 3),
      notes: notes.map((n) => ({ t: n.t === null ? null : fix(rec.start + n.t, 3), text: n.text })),
      samples: rec.samples.map((s) => ({ t: fix(s.t, 3), frame: s.frame, view: s.view, tracks: s.rows.map((r) => ({ track: r.track, name: r.name, p: r.p.map((x) => fix(x, 4)), q: r.q.map((x) => fix(x, 5)) })) })),
    }, null, 1) + '\n';
  }
  function recordingCsv(rec, notes) {
    const lines = [RECORDING_CSV_HEADER];
    const ns = notes.map((n) => ({ t: rec.start + (n.t === null ? 0 : n.t), text: n.text })).sort((a, b) => a.t - b.t);
    let k = 0;
    const noteLine = (n) => [n.t.toFixed(3), '', '', '', '', '', '', '', '', '', n.text].map(csvField).join(',');
    for (const s of rec.samples) {
      while (k < ns.length && ns[k].t <= s.t) lines.push(noteLine(ns[k++]));
      const msg = streamMessage('csv', s.t, s.rows);
      if (msg) lines.push(msg.replace(/\n$/, '').split('\n').map((l) => l + ',').join('\n'));
    }
    while (k < ns.length) lines.push(noteLine(ns[k++]));
    return lines.join('\n') + '\n';
  }

  // Whisper marks what isn't speech as [BLANK_AUDIO], (music), *coughs*: drop those, squeeze the spaces, start with
  // a capital and end the sentence. Nothing left that is a letter or a digit gives ''.
  function tidySpeech(raw) {
    let t = String(raw || '').replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, ' ').replace(/\s+/g, ' ').replace(/\s+([,.!?;:])/g, '$1').trim();
    if (!/[\p{L}\p{N}]/u.test(t)) return '';
    t = t[0].toUpperCase() + t.slice(1);
    if (!/[.!?…]["')\]]?$/.test(t)) t += '.';
    return t;
  }
  // Dictated text into a text box at the caret (start..end, replacing a selection): a space either side where it
  // needs one, and a lower-case start when it carries on a sentence ("I" stays). Returns the new value and caret.
  function insertSpeech(value, start, end, text) {
    const before = value.slice(0, start), after = value.slice(end);
    if (/[\p{L}\p{N},;:]\s*$/u.test(before) && !/^I\b/.test(text)) text = text[0].toLowerCase() + text.slice(1);
    const ins = (before === '' || /\s$/.test(before) ? '' : ' ') + text + (after === '' || /^\s/.test(after) ? '' : ' ');
    return { value: before + ins + after, caret: start + ins.length };
  }
  // Spoken commands. The whole utterance has to be one of these (after "go to", "switch to", "the", "tab", "please"
  // and the like are taken off), so a note that merely mentions a tab is still a note. "Note ..." is always a note.
  const VOICE_COMMANDS = {
    track: ['track', 'tracking', 'tracks', 'tracker'],
    calib: ['calibrate', 'calibration', 'calibrating', 'calibrate camera', 'calibrate the camera', 'calibrate cameras'],
    stream: ['stream', 'streaming', 'streams'],
    record: ['record', 'start recording', 'start a recording', 'start the recording', 'start record', 'new recording', 'begin recording'],
    stop: ['stop', 'stop recording', 'stop the recording', 'end recording', 'end the recording', 'finish recording'],
    tare: ['tare', 'tear', 'tare orientation', 'tare the orientation', 'zero orientation'],
    untare: ['clear tare', 'clear tear', 'clear the tare', 'untare', 'clear orientation'],
    fit: ['fit', 'fit view', 'fit the view', 'zoom to fit'],
    reset: ['reset view', 'reset the view'],
    robot: ['calibrate robot', 'calibrate the robot', 'zero robot', 'zero the robot'],
    table: ['reset table', 'reset the table', 'reset ball', 'reset the ball', 'new ball', 'reset cup', 'reset the cup'],
    sound: ['sound on', 'sounds on', 'turn the sound on', 'turn sound on', 'unmute', 'unmute sound'],
    mute: ['mute', 'mute sound', 'sound off', 'sounds off', 'turn the sound off', 'turn sound off', 'quiet'],
    settings: ['settings', 'setting', 'preferences'],
  };
  const VOICE_LOOKUP = new Map();
  for (const [cmd, phrases] of Object.entries(VOICE_COMMANDS)) for (const p of phrases) VOICE_LOOKUP.set(p, cmd);
  function voiceCommand(text) {
    const note = /^\s*(?:(?:take|add|make) (?:a )?)?note\b[\s,.:;!-]*/i.exec(text || '');
    if (note) { const rest = tidySpeech(text.slice(note[0].length)); return rest ? { cmd: 'note', text: rest } : null; }
    let s = String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
    for (let k = 0; k < 4; k++) {
      s = s.replace(/^(?:ok(?:ay)?|please|now|go to|go back to|switch to|change to|open|show me|show|the)\s+/, '')
        .replace(/\s+(?:tab|page|mode|please|now)$/, '').trim();
    }
    const cmd = VOICE_LOOKUP.get(s);
    return cmd ? { cmd } : null;
  }

  // When an utterance starts and ends, from the microphone's level (the RMS of each block of samples, at `now` ms):
  // speech has started once the level stays above `on` for `minMs`, and ended once it then stays below `off` for
  // `quietMs`. With no speech within `waitMs` of the reset it gives up. step() returns 'start', 'end', 'none' or null.
  function VoiceGate(opts) { this.o = Object.assign({ on: 0.02, off: 0.012, minMs: 60, quietMs: 1400, waitMs: 8000 }, opts || {}); this.reset(0); }
  VoiceGate.prototype.reset = function (now) { this.t0 = now; this.loud = null; this.start = null; this.quiet = null; this.done = false; };
  VoiceGate.prototype.step = function (level, now) {
    const o = this.o;
    if (this.done) return null;
    if (this.start === null) {
      if (level > o.on) {
        if (this.loud === null) this.loud = now;
        if (now - this.loud >= o.minMs) { this.start = this.loud; return 'start'; }
      } else this.loud = null;
      if (now - this.t0 >= o.waitMs && this.loud === null) { this.done = true; return 'none'; }
      return null;
    }
    if (level < o.off) {
      if (this.quiet === null) this.quiet = now;
      if (now - this.quiet >= o.quietMs) { this.done = true; return 'end'; }
    } else this.quiet = null;
    return null;
  };

  // Error-state Kalman filter for a pose moving at nearly constant velocity. State: position p, velocity v,
  // rotation R and angular velocity w (both velocities in the camera frame); error δx = (δp, δv, δθ, δw) with
  // R ← exp(δθ)·R. qa and qw are the spectral densities of the random acceleration (m²/s³) and angular
  // acceleration (rad²/s³): bigger follows faster motion, smaller smooths more.
  function PoseFilter(opts) {
    this.o = Object.assign({ qa: 4, qw: 40, gate: 40, maxGap: 0.5, lateBy: 0.1, floorP: 1e-6, floorR: 1e-5, maxMiss: 3, imuFor: 0.5 }, opts || {});
    this.x = null;
  }
  PoseFilter.prototype.reset = function () { this.x = null; this.miss = 0; };
  PoseFilter.prototype.measCov = function (z) {
    const Rm = z.cov ? z.cov.map((r) => r.slice()) : eye(6).map((r, i) => r.map((v) => v * (i < 3 ? 1e-4 : 1e-3)));
    for (let i = 0; i < 6; i++) Rm[i][i] += i < 3 ? this.o.floorP : this.o.floorR;
    return Rm;
  };
  PoseFilter.prototype.init = function (time, z) {
    const P = zeros(12, 12), Rm = this.measCov(z);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { P[i][j] = Rm[i][j]; P[6 + i][6 + j] = Rm[3 + i][3 + j]; P[i][6 + j] = Rm[i][3 + j]; P[6 + i][j] = Rm[3 + i][j]; }
    for (let i = 0; i < 3; i++) { P[3 + i][3 + i] = 1; P[9 + i][9 + i] = 10; } // up to ~1 m/s and ~3 rad/s, unknown
    this.x = { time, p: z.t.slice(), v: [0, 0, 0], R: z.R.slice(), w: [0, 0, 0], P };
    this.miss = 0;
    this.lastCam = time;
  };
  // Predicted state at `time` (does not change the filter).
  PoseFilter.prototype.predict = function (time) {
    const x = this.x, dt = time - x.time, o = this.o;
    const F = eye(12);
    for (let i = 0; i < 3; i++) { F[i][3 + i] = dt; F[6 + i][9 + i] = dt; }
    const Q = zeros(12, 12), q3 = dt * dt * dt / 3, q2 = dt * dt / 2;
    for (let i = 0; i < 3; i++) {
      Q[i][i] = o.qa * q3; Q[i][3 + i] = Q[3 + i][i] = o.qa * q2; Q[3 + i][3 + i] = o.qa * dt;
      Q[6 + i][6 + i] = o.qw * q3; Q[6 + i][9 + i] = Q[9 + i][6 + i] = o.qw * q2; Q[9 + i][9 + i] = o.qw * dt;
    }
    return { time, p: add(x.p, scale(x.v, dt)), v: x.v.slice(), R: mul3(rodrigues(scale(x.w, dt)), x.R), w: x.w.slice(), P: madd(mm(mm(F, x.P), mT(F)), Q) };
  };
  // Innovation of measurement z against a prediction: residual y, its covariance S, and Mahalanobis distance².
  PoseFilter.prototype.innovation = function (pr, z) {
    const y = sub(z.t, pr.p).concat(so3Log(mul3(z.R, tr3(pr.R))));
    const idx = [0, 1, 2, 6, 7, 8], S = madd(idx.map((i) => idx.map((j) => pr.P[i][j])), this.measCov(z)), Si = minv(S);
    return { y, S, Si, d2: Si ? dot6(y, mv(Si, y)) : Infinity };
  };
  function dot6(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
  PoseFilter.prototype.correct = function (pr, inn) {
    const idx = [0, 1, 2, 6, 7, 8], PHt = pr.P.map((r) => idx.map((j) => r[j])), K = mm(PHt, inn.Si), dx = mv(K, inn.y);
    const KH = zeros(12, 12);
    for (let i = 0; i < 12; i++) for (let a = 0; a < 6; a++) KH[i][idx[a]] = K[i][a];
    const IKH = eye(12).map((r, i) => r.map((v, j) => v - KH[i][j]));
    this.x = {
      time: pr.time, p: add(pr.p, dx.slice(0, 3)), v: add(pr.v, dx.slice(3, 6)),
      R: mul3(rodrigues(dx.slice(6, 9)), pr.R), w: add(pr.w, dx.slice(9, 12)), P: sym(mm(IKH, pr.P)),
    };
  };
  // Take one frame's candidate poses (best fit first). With no track, start one on the best. Otherwise pick,
  // among candidates that fit the image nearly as well as the best, the one closest to the prediction, so the
  // mirror-image flip of a flat tag is resolved by where the tag was going. A candidate outside the gate is
  // skipped; after `maxMiss` skipped frames in a row the track restarts on the best fit.
  PoseFilter.prototype.update = function (time, cands) {
    if (!cands.length) return null;
    const best = cands[0];
    // Several cameras deliver frames slightly out of order: one up to `lateBy` seconds older than the state is taken
    // as if at the state's time; anything older restarts the track.
    if (!this.x || time - this.x.time > this.o.maxGap || this.x.time - time > this.o.lateBy) { this.init(time, best); return { pose: this.pose(), chosen: 0, d2: 0, restarted: true }; }
    if (time < this.x.time) time = this.x.time;
    const pr = this.predict(time);
    let pick = -1, inn = null;
    cands.forEach((cnd, i) => {
      if (i > 0 && !(cnd.rms <= Math.max(2 * best.rms, best.rms + 0.5))) return;
      const n = this.innovation(pr, cnd);
      if (!inn || n.d2 < inn.d2) { inn = n; pick = i; }
    });
    if (inn.d2 > this.o.gate) {
      this.miss = (this.miss || 0) + 1;
      if (this.miss >= this.o.maxMiss) { this.init(time, best); return { pose: this.pose(), chosen: 0, d2: inn.d2, restarted: true }; }
      return { pose: null, chosen: -1, d2: inn.d2, rejected: true };
    }
    this.miss = 0;
    this.correct(pr, inn);
    this.lastCam = time;
    return { pose: this.pose(), chosen: pick, d2: inn.d2 };
  };
  // The same, but from one camera frame's corners (sightings with dt 0, at `time`) instead of a pose: an iterated
  // error-state update, which is Gauss–Newton on the posterior (Bell and Cathey 1993), relinearising the projection
  // about each new estimate. In information form, so its size is the state's (12), not the corners' (8 per tag):
  //   e ← (P⁻¹ + JᵀWJ)⁻¹ (JᵀWJ·e − JᵀW·r),  e = x ⊟ prediction,  P⁺ = (P⁻¹ + JᵀWJ)⁻¹.
  // A frame older than the state (another camera's, up to `lateBy`) is not pushed forward to the state's time as if
  // it were current: its sightings carry the negative dt, and the state's velocity carries the pose back to it.
  // `start` (a pose with a covariance) starts or restarts the track. Gating is on the size of the correction
  // against the prediction's spread (eᵀP⁻¹e) and on the corners' fit afterwards.
  PoseFilter.prototype.updateCorners = function (time, views, start, opts) {
    const o = Object.assign({ iters: 5, k: 2.5, maxFit: 4 }, opts || {});
    if (!views.length) return null;
    const restart = () => { if (!start) return null; this.init(time, start); return { pose: this.pose(), d2: 0, restarted: true }; };
    if (!this.x || time - this.x.time > this.o.maxGap || this.x.time - time > this.o.lateBy) return restart();
    let pr, vs = views;
    if (time < this.x.time) { // late: solve at the state's time, the sighting moved back by the state's own motion
      pr = this.predict(this.x.time);
      vs = views.map((v) => Object.assign({}, v, { dt: time - this.x.time }));
    } else pr = this.predict(time);
    const Pi = minv(pr.P);
    if (!Pi) return restart();
    const vel = { v: pr.v, w: pr.w }, idx = [0, 1, 2, 6, 7, 8];
    let e = new Array(12).fill(0), x = pr, A = null, sys = null;
    for (let it = 0; it < o.iters; it++) {
      sys = jointSystem(vs, x.R, x.p, vel, o.k);
      if (!isFinite(sys.cost)) return this.miss1(time, start);
      A = Pi.map((r) => r.slice());
      const He = new Array(12).fill(0);
      for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) { A[idx[a]][idx[b]] += sys.H[a][b]; He[idx[a]] += sys.H[a][b] * e[idx[b]]; }
      const Ai = minv(A);
      if (!Ai) return this.miss1(time, start);
      const rhs = He.slice();
      for (let a = 0; a < 6; a++) rhs[idx[a]] -= sys.g[a];
      const e2 = mv(Ai, rhs), step = Math.hypot(...e2.map((v, i) => v - e[i]));
      e = e2;
      x = { time: pr.time, p: add(pr.p, e.slice(0, 3)), v: add(pr.v, e.slice(3, 6)), R: mul3(rodrigues(e.slice(6, 9)), pr.R), w: add(pr.w, e.slice(9, 12)) };
      A = Ai;
      if (step < 1e-9) break;
    }
    const d2 = dot6(e, mv(Pi, e)), fit = Math.sqrt(jointSystem(vs, x.R, x.p, vel, o.k).chi / Math.max(1, 2 * sys.n));
    if (d2 > this.o.gate || fit > o.maxFit) return this.miss1(time, start, d2);
    this.miss = 0;
    this.x = Object.assign(x, { P: sym(A) });
    this.lastCam = Math.max(this.lastCam || 0, time);
    return { pose: this.pose(), d2, fit };
  };
  // A motion sensor on the tracked thing (a board lined up with lineUp). Neither starts a track or keeps one alive:
  // they act only within `imuFor` seconds of the last camera update. A reading older than the state (Bluetooth
  // delivers them tens of ms late) is taken against the state moved back by its own turning.
  // `updateRate`: the gyro, as the angular velocity in the rig frame (rad/s), a direct reading of the state's w.
  // `updateTilt`: VQF's orientation (object → rig, through W and M), whose turn about world up (`up`, in the rig) drifts
  // with VQF's heading, so its covariance is sigma² everywhere plus sigmaUp² about `up`. Gated at `gate` (3 dof).
  PoseFilter.prototype.imuOk = function (time) {
    return this.x && this.lastCam != null && time - this.lastCam < this.o.imuFor && this.x.time - time < this.o.lateBy;
  };
  PoseFilter.prototype.linear = function (time, idx, resid, Rm, gate) {
    const pr = this.predict(Math.max(time, this.x.time)), y = resid(pr);
    const S = madd(idx.map((i) => idx.map((j) => pr.P[i][j])), Rm), Si = minv(S);
    if (!Si) return null;
    const d2 = dot6(y, mv(Si, y));
    if (gate && d2 > gate) return { rejected: true, d2 };
    const PHt = pr.P.map((r) => idx.map((j) => r[j])), K = mm(PHt, Si), dx = mv(K, y), KH = zeros(12, 12);
    for (let i = 0; i < 12; i++) for (let a = 0; a < idx.length; a++) KH[i][idx[a]] = K[i][a];
    const IKH = eye(12).map((r, i) => r.map((v, j) => v - KH[i][j]));
    this.x = { time: pr.time, p: add(pr.p, dx.slice(0, 3)), v: add(pr.v, dx.slice(3, 6)), R: mul3(rodrigues(dx.slice(6, 9)), pr.R), w: add(pr.w, dx.slice(9, 12)), P: sym(mm(IKH, pr.P)) };
    return { d2 };
  };
  PoseFilter.prototype.updateRate = function (time, w, sigma) {
    if (!this.imuOk(time)) return null;
    return this.linear(time, [9, 10, 11], (pr) => sub(w, pr.w), eye(3).map((r) => r.map((v) => v * sigma * sigma)), 0);
  };
  PoseFilter.prototype.updateTilt = function (time, R, up, sigma, sigmaUp, gate) {
    if (!this.imuOk(time)) return null;
    const Rm = [0, 1, 2].map((i) => [0, 1, 2].map((j) => (i === j ? sigma * sigma : 0) + sigmaUp * sigmaUp * up[i] * up[j]));
    return this.linear(time, [6, 7, 8], (pr) => so3Log(mul3(R, tr3(time < pr.time ? mul3(rodrigues(scale(pr.w, time - pr.time)), pr.R) : pr.R))), Rm, gate || 25);
  };
  // A rejected frame: count it, and restart on `start` after maxMiss in a row.
  PoseFilter.prototype.miss1 = function (time, start, d2) {
    this.miss = (this.miss || 0) + 1;
    if (this.miss >= this.o.maxMiss && start) { this.init(time, start); return { pose: this.pose(), d2: d2 || 0, restarted: true }; }
    return { pose: null, d2: d2 || Infinity, rejected: true };
  };
  PoseFilter.prototype.pose = function () {
    const x = this.x;
    return { R: x.R, t: x.p, v: x.v, w: x.w, cov: [0, 1, 2, 6, 7, 8].map((i) => [0, 1, 2, 6, 7, 8].map((j) => x.P[i][j])) };
  };
  // Motion presets for the page. Each frame the velocity may change by about √(q·dt): at 30 fps, 0.04, 0.1 or
  // 0.3 m/s and 0.13, 0.3 or 1 rad/s. Smooth suits slow, careful moves (more lag on sudden ones); responsive
  // suits quick hand motions (less smoothing).
  const MOTION = { smooth: { qa: 0.05, qw: 0.5 }, balanced: { qa: 0.3, qw: 3 }, responsive: { qa: 3, qw: 30 } };
  // Standard deviation of a position along a unit direction, from a 3×3 (or the top-left of a 6×6) covariance.
  function sigmaAlong(cov, d) { let s = 0; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) s += d[i] * cov[i][j] * d[j]; return Math.sqrt(Math.max(0, s)); }

  // ---- several cameras: a rig ----
  // A pose (with its covariance in (δp, δθ), R ← exp(δθ)·R) seen by a camera whose pose in the rig is T, moved into
  // the rig's frame. Both halves of the error turn with T.R; other fields are kept.
  function toRig(T, p) {
    if (!T) return p;
    const out = Object.assign({}, p, { R: mul3(T.R, p.R), t: add(mulv(T.R, p.t), T.t) });
    if (p.cov) {
      const A = zeros(6, 6);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { A[i][j] = T.R[3 * i + j]; A[3 + i][3 + j] = T.R[3 * i + j]; }
      out.cov = sym(mm(mm(A, p.cov), mT(A)));
    }
    return out;
  }
  // The same pose seen by several cameras at once ({R, t, cov}), combined by weighting each with its information
  // (inverse covariance) on R³ × SO(3), iterated about the current mean. Returns the pose and its covariance.
  function fusePoses(ps) {
    if (ps.length === 1) return Object.assign({}, ps[0]);
    const W = ps.map((p) => minv((p.cov || eye(6).map((r, i) => r.map((v) => v * (i < 3 ? 1e-4 : 1e-3)))).map((r, i) => r.map((v, j) => v + (i === j ? 1e-12 : 0)))));
    let R = ps[0].R.slice(), t = ps[0].t.slice(), H = null;
    for (let it = 0; it < 10; it++) {
      H = zeros(6, 6); const b = new Array(6).fill(0);
      ps.forEach((p, k) => {
        if (!W[k]) return;
        const y = sub(p.t, t).concat(so3Log(mul3(p.R, tr3(R)))), Wy = mv(W[k], y);
        for (let i = 0; i < 6; i++) { b[i] += Wy[i]; for (let j = 0; j < 6; j++) H[i][j] += W[k][i][j]; }
      });
      const Hi = minv(H);
      if (!Hi) break;
      const d = mv(Hi, b);
      t = add(t, d.slice(0, 3)); R = mul3(rodrigues(d.slice(3, 6)), R);
      if (Math.hypot(...d) < 1e-12) break;
    }
    const cov = H && minv(H);
    return { R, t, cov: cov ? sym(cov) : null, n: ps.length };
  }

  // Multi-camera calibration. Each view is one still pose of the calibration board seen by two or more cameras:
  // { obs: [{ cam, obj: board points (m, board frame), pts: their pixels, pose: the board's pose in that camera }] }.
  // cams[j] are the cameras' intrinsics. Camera 0 is the rig's frame. First each camera's pose is chained out from
  // camera 0 through views they share (averaged over views), then every camera pose and every board pose is refined
  // together by Levenberg–Marquardt on SE(3) to minimise the pixel error of every corner in every camera (a bundle
  // adjustment with the board's shape known). A camera that shares no views, directly or through others, is
  // left unplaced (null). Returns the poses (camera → rig), the RMS error overall and per camera, and view counts.
  function calibrateRig(cams, views, opts) {
    const o = Object.assign({ iters: 50 }, opts || {}), n = cams.length;
    const T = new Array(n).fill(null);
    T[0] = { R: I3.slice(), t: [0, 0, 0] };
    for (let grew = true; grew;) {
      grew = false;
      for (let j = 1; j < n; j++) {
        if (T[j]) continue;
        const s = [];
        for (const v of views) {
          const oj = v.obs.find((x) => x.cam === j);
          if (!oj) continue;
          for (const oi of v.obs) if (oi.cam !== j && T[oi.cam]) s.push(compose(T[oi.cam], compose(oi.pose, inverse(oj.pose))));
        }
        if (s.length) { const mp = meanPose(s, 10, 0.1); T[j] = { R: mp.R, t: mp.t }; grew = true; }
      }
    }
    // the views that reach the rig, each with its corners undistorted once, and a first board pose in the rig frame
    const V = views.map((v) => ({ obs: v.obs.filter((x) => T[x.cam]) })).filter((v) => v.obs.length).map((v) => {
      const s = v.obs.map((x) => compose(T[x.cam], x.pose)), B = s.length === 1 ? s[0] : meanPose(s, 180, 1e9);
      return { B: { R: B.R, t: B.t }, obs: v.obs.map((x) => ({ cam: x.cam, obj: x.obj, uv: x.pts.map((p) => undistort(cams[x.cam], p[0], p[1])) })) };
    });
    const free = []; // camera index → parameter block (camera 0 is fixed)
    let nb = 0;
    for (let j = 1; j < n; j++) if (T[j]) free[j] = nb++;
    const nc = nb, N = 6 * (nc + V.length);
    // residuals in pixels (undistorted coordinates times the focal length), and the cost
    const cost = (T, V) => {
      let s = 0;
      for (const v of V) for (const ob of v.obs) {
        const c = cams[ob.cam], Tc = T[ob.cam], Rt = tr3(Tc.R);
        for (let i = 0; i < ob.obj.length; i++) {
          const w = add(mulv(v.B.R, ob.obj[i]), v.B.t), p = mulv(Rt, sub(w, Tc.t));
          if (p[2] <= 1e-6) return Infinity;
          const ex = c.fx * (p[0] / p[2] - ob.uv[i][0]), ey = c.fy * (p[1] / p[2] - ob.uv[i][1]);
          s += ex * ex + ey * ey;
        }
      }
      return s;
    };
    const linearise = (T, V) => {
      const H = zeros(N, N), g = new Array(N).fill(0);
      V.forEach((v, k) => {
        const bk = 6 * (nc + k);
        for (const ob of v.obs) {
          const c = cams[ob.cam], Tc = T[ob.cam], Rt = tr3(Tc.R), cb = ob.cam ? 6 * free[ob.cam] : -1;
          for (let i = 0; i < ob.obj.length; i++) {
            const w = add(mulv(v.B.R, ob.obj[i]), v.B.t), p = mulv(Rt, sub(w, Tc.t)), iz = 1 / p[2];
            const r = [c.fx * (p[0] * iz - ob.uv[i][0]), c.fy * (p[1] * iz - ob.uv[i][1])];
            const Jp = [[c.fx * iz, 0, -c.fx * p[0] * iz * iz], [0, c.fy * iz, -c.fy * p[1] * iz * iz]];
            // the board moved by exp(ξ): dw/dξ = [I, −[w]×]; the camera moved by exp(ξ): dp/dξ = Rᵀ[−I, [w]×]
            const JR = mm(Jp, [Rt.slice(0, 3), Rt.slice(3, 6), Rt.slice(6, 9)]), Wx = skew(w);
            const JW = JR.map((row) => [0, 1, 2].map((j) => -(row[0] * Wx[j] + row[1] * Wx[3 + j] + row[2] * Wx[6 + j])));
            for (let a = 0; a < 2; a++) {
              const Jb = JR[a].concat(JW[a]), cols = [], vals = [];
              for (let q = 0; q < 6; q++) { cols.push(bk + q); vals.push(Jb[q]); }
              if (cb >= 0) for (let q = 0; q < 6; q++) { cols.push(cb + q); vals.push(-Jb[q]); }
              for (let x = 0; x < cols.length; x++) {
                g[cols[x]] += vals[x] * r[a];
                for (let y = 0; y < cols.length; y++) H[cols[x]][cols[y]] += vals[x] * vals[y];
              }
            }
          }
        }
      });
      return { H, g };
    };
    const step = (T, V, d) => {
      const T2 = T.map((x, j) => {
        if (!x || !j) return x;
        const e = se3Exp(d.slice(6 * free[j], 6 * free[j] + 6));
        return { R: mul3(e.R, x.R), t: add(mulv(e.R, x.t), e.t) };
      });
      const V2 = V.map((v, k) => {
        const e = se3Exp(d.slice(6 * (nc + k), 6 * (nc + k) + 6));
        return { obs: v.obs, B: { R: mul3(e.R, v.B.R), t: add(mulv(e.R, v.B.t), e.t) } };
      });
      return [T2, V2];
    };
    let cur = [T, V], e = cost(T, V), lambda = 1e-3, it = 0;
    for (; it < o.iters && isFinite(e) && N; it++) {
      const { H, g } = linearise(cur[0], cur[1]);
      let improved = false;
      for (let tries = 0; tries < 10; tries++) {
        const A = H.map((r, i) => r.map((x, j) => (i === j ? x * (1 + lambda) + 1e-9 : x))), d = solveSym(A, g.map((x) => -x));
        if (!d) { lambda *= 10; continue; }
        const nxt = step(cur[0], cur[1], d), e2 = cost(nxt[0], nxt[1]);
        if (e2 < e) { improved = (e - e2) > 1e-10 * (1 + e); cur = nxt; e = e2; lambda = Math.max(1e-9, lambda / 3); break; }
        lambda *= 4;
      }
      if (!improved) break;
    }
    // errors per camera
    const per = cams.map(() => ({ sq: 0, pts: 0, views: 0 }));
    for (const v of cur[1]) for (const ob of v.obs) {
      const c = cams[ob.cam], Tc = cur[0][ob.cam], Rt = tr3(Tc.R), q = per[ob.cam];
      q.views++;
      for (let i = 0; i < ob.obj.length; i++) {
        const p = mulv(Rt, sub(add(mulv(v.B.R, ob.obj[i]), v.B.t), Tc.t));
        q.sq += (c.fx * (p[0] / p[2] - ob.uv[i][0])) ** 2 + (c.fy * (p[1] / p[2] - ob.uv[i][1])) ** 2; q.pts++;
      }
    }
    const pts = per.reduce((s, q) => s + q.pts, 0);
    return {
      poses: cur[0].map((x) => (x ? { R: x.R, t: x.t } : null)),
      rms: pts ? Math.sqrt(e / pts) : NaN,
      perCam: per.map((q) => ({ rms: q.pts ? Math.sqrt(q.sq / q.pts) : NaN, views: q.views, points: q.pts })),
      views: cur[1].length, iters: it,
    };
  }
  // Solve A x = b for a symmetric positive-definite A (Cholesky); null if it isn't.
  function solveSym(A, b) {
    const n = A.length, L = zeros(n, n);
    for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) { if (!(s > 0)) return null; L[i][i] = Math.sqrt(s); } else L[i][j] = s / L[j][j];
    }
    const y = new Array(n), x = new Array(n);
    for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i][k] * y[k]; y[i] = s / L[i][i]; }
    for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k]; x[i] = s / L[i][i]; }
    return x;
  }
  // Each running camera's pose in the frame of the first one, from a saved rig ({keys, poses}: poses in the frame of
  // whichever camera was first when it was solved). null for a camera the rig doesn't have, or for all but the
  // first when the first isn't in it.
  function placeCameras(rig, keys) {
    const out = keys.map((k, i) => (i ? null : { R: I3.slice(), t: [0, 0, 0] }));
    if (!rig || !keys.length) return out;
    const at = (k) => { const i = rig.keys.indexOf(k); return i >= 0 && rig.poses[i] ? rig.poses[i] : null; };
    const P0 = at(keys[0]);
    if (!P0) return out;
    const inv0 = inverse(P0);
    return keys.map((k, i) => { if (!i) return out[0]; const P = at(k); return P ? compose(inv0, P) : null; });
  }
  // A camera looking from `pos` at `target`, upright (OpenCV axes: x right, y down, z forward; `down` is the world's
  // down). Returns its pose, camera → world.
  function lookAt(pos, target, down) {
    const z = sub(target, pos), zn = scale(z, 1 / norm(z)), x = cross(down || [0, 1, 0], zn), xn = scale(x, 1 / norm(x)), y = cross(zn, xn);
    return { R: [xn[0], y[0], zn[0], xn[1], y[1], zn[1], xn[2], y[2], zn[2]], t: pos.slice() };
  }

  // Camera tiles arranged like monitors in a display-settings panel: each tile as big as its picture in pixels, placed
  // where its camera sits as seen from behind camera 1 (`pos`: [right, up] in metres, or null if not known), spread
  // just enough that no two overlap. With fewer than two known positions, or two cameras in nearly the same place,
  // tiles go in rows of two; cameras with no position follow the placed ones the same way. Returns
  // {key, x, y, w, h} in picture pixels, the top-left of the whole arrangement at (0, 0).
  function arrangeTiles(tiles, gap) {
    const g = gap == null ? 40 : gap, placed = tiles.filter((t) => t.pos);
    let k = 0;
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i], b = placed[j], dx = Math.abs(a.pos[0] - b.pos[0]), dy = Math.abs(a.pos[1] - b.pos[1]);
      const kx = dx > 0.01 ? ((a.w + b.w) / 2 + g) / dx : Infinity, ky = dy > 0.01 ? ((a.h + b.h) / 2 + g) / dy : Infinity;
      k = Math.max(k, Math.min(kx, ky));
    }
    const spread = placed.length >= 2 && isFinite(k);
    const out = spread ? placed.map((t) => ({ key: t.key, x: t.pos[0] * k - t.w / 2, y: -t.pos[1] * k - t.h / 2, w: t.w, h: t.h })) : [];
    const rest = spread ? tiles.filter((t) => !t.pos) : tiles.slice();
    let x0 = 0, y = 0;
    if (out.length) { x0 = Math.min(...out.map((r) => r.x)); y = Math.max(...out.map((r) => r.y + r.h)) + g; }
    for (let i = 0; i < rest.length; i += 2) {
      const row = rest.slice(i, i + 2);
      let x = x0;
      for (const t of row) { out.push({ key: t.key, x, y, w: t.w, h: t.h }); x += t.w + g; }
      y += Math.max(...row.map((t) => t.h)) + g;
    }
    const mx = Math.min(...out.map((r) => r.x)), my = Math.min(...out.map((r) => r.y));
    return out.map((r) => Object.assign(r, { x: r.x - mx, y: r.y - my }));
  }

  // Tag IDs typed as a list: "3, 10-12 7" (commas or spaces; a range with -, – or ..). Returns the IDs in the order
  // given without repeats, and the pieces that aren't IDs below `count` (the family's size). At most `limit` IDs.
  function parseIdList(text, count, limit) {
    const ids = [], bad = [], lim = limit || 200;
    for (const part of String(text || '').split(/[\s,;]+/).filter(Boolean)) {
      const m = part.match(/^(\d+)(?:(?:-|–|\.\.)(\d+))?$/);
      if (!m) { bad.push(part); continue; }
      const a = +m[1], b = m[2] === undefined ? a : +m[2];
      if (b < a || b >= count) { bad.push(part); continue; }
      for (let i = a; i <= b && ids.length < lim; i++) if (!ids.includes(i)) ids.push(i);
    }
    return { ids, bad };
  }

  // ---- paper ----
  // The two sheets printers use: A4 (Europe and most of the world) and US Letter (the US, Canada, Mexico and a few
  // others). Pages print with 12 mm margins; a page of tags keeps 30 mm for captions and the check bars below them.
  const PAPER = { a4: { name: 'A4', w: 210, h: 297, css: 'A4' }, letter: { name: 'US Letter', w: 215.9, h: 279.4, css: 'letter' } };
  const LETTER_REGIONS = ['US', 'CA', 'MX', 'PH', 'CL', 'CO', 'VE', 'GT', 'CR', 'PA', 'DO', 'PR', 'SV', 'NI', 'HN', 'BZ'];
  const PRINT_MARGIN = 12, PRINT_FOOT = 30;
  // The paper to start with for a browser language such as "en-US" or "de-DE".
  function paperFor(lang) {
    const m = String(lang || '').match(/[-_]([A-Za-z]{2})\b/);
    return m && LETTER_REGIONS.includes(m[1].toUpperCase()) ? 'letter' : 'a4';
  }
  // What fits inside the margins, in mm, upright or turned (landscape).
  function printArea(paper, landscape) {
    const P = PAPER[paper] || PAPER.a4, w = P.w - 2 * PRINT_MARGIN, h = P.h - 2 * PRINT_MARGIN;
    return landscape ? { w: h, h: w } : { w, h };
  }
  // The largest tag (its black square, mm) that prints at full size on this paper: with its white border of one cell
  // (`cells` across the black square) it must fit an upright page above the captions.
  function maxTagSize(paper, cells) { const a = printArea(paper, false); return Math.floor((Math.min(a.w, a.h - PRINT_FOOT) / (1 + 2 / cells)) * 10) / 10; }
  // The largest square (mm) of the 9 × 6 board on its own landscape page, with its caption and check bars below.
  function maxBoardSquare(paper) { const a = printArea(paper, true); return Math.floor(Math.min(a.w / 9, (a.h - PRINT_FOOT) / 6) * 10) / 10; }

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
    pose: 'filtered', // what is plotted: raw (OpenCV's IPPE), refined (LM on SE(3)) or filtered (Kalman on SE(3))
    compare: false, // also draw the raw track, faint, to compare
    motion: 'balanced', // filter tuning: smooth, balanced or responsive
    mirror: false, // show the picture as a mirror would (the picture only: poses and data stay the camera's own)
    flip: false, // show the picture upside down, for a camera mounted that way (the picture only)
    blur: false, // blur the picture on screen (the picture only), to work in public without showing faces
    search: 'predicted', // predicted: search only where the tags should be (the whole picture every 10th frame); whole: every frame
    show3d: 'robot', // the 3D view: robot (driven by the tags) or tags (their trails and axes)
    // The robot: which track is the body and which the arms ('auto', 'none' or a track key), its lengths (m; see
    // RobotCore.MODEL), whether the elbows prefer to sit out and below the hands, and whether the joint angles show.
    robot: { body: 'auto', left: 'auto', right: 'auto', elbows: true, scale: 1, props: 'arcade', actor: 'teen', playMode: 'story', level: 'door', view: 'orbit', headTilt: -40, forces: true, sound: false },
    setup: true, // show the Setup guide when the page opens
  };
  // Image pixels to screen pixels for a vw × vh picture shown in a W × H box with object-fit: contain, mirrored
  // and/or flipped about the box's centre, as the CSS transform on the video does. Returns (x, y) -> [x, y].
  function displayMap(W, H, vw, vh, mirror, flip) {
    const s = Math.min(W / vw, H / vh), ox = (W - vw * s) / 2, oy = (H - vh * s) / 2;
    return (x, y) => [mirror ? W - ox - x * s : ox + x * s, flip ? H - oy - y * s : oy + y * s];
  }
  // The calibration board on a screen: the largest whole number of device pixels per square that fits a w × h screen
  // with `margin` squares of white round the board, turned a quarter if that makes the squares bigger (a tablet held
  // upright). Whole pixels keep every square edge sharp. Returns the pixels per square and the board's size on screen.
  function boardFit(w, h, cols, rows, margin) {
    const m = margin == null ? 0.5 : margin;
    const fit = (W, H) => Math.max(0, Math.floor(Math.min(W / (cols + 2 * m), H / (rows + 2 * m))));
    const flat = fit(w, h), turned = fit(h, w), rotate = turned > flat, px = rotate ? turned : flat;
    return { px, rotate, w: (rotate ? rows : cols) * px, h: (rotate ? cols : rows) * px };
  }

  // One tag on a screen: the largest whole number of device pixels per cell (a tag is `cells` cells across, its black
  // border included) with `margin` cells of white round it. Returns the pixels per cell and the tag's size on screen.
  function tagFit(w, h, cells, margin) {
    const m = margin == null ? 1 : margin, px = Math.max(0, Math.floor(Math.min(w, h) / (cells + 2 * m)));
    return { px, size: cells * px };
  }

  function clampSettings(s) {
    const o = Object.assign({}, DEFAULTS, s || {});
    const num = (k, lo, hi) => { const x = Number(o[k]); o[k] = isFinite(x) ? Math.min(hi, Math.max(lo, x)) : DEFAULTS[k]; };
    num('span', 0.1, 30); num('every', 0.01, 10); num('axisLen', 0.001, 2); num('tagSize', 0.005, 2); num('hfov', 20, 170);
    if (o.every > o.span) o.every = o.span;
    if (!['raw', 'refined', 'filtered'].includes(o.pose)) o.pose = DEFAULTS.pose;
    if (!MOTION[o.motion]) o.motion = DEFAULTS.motion;
    o.compare = !!o.compare; o.mirror = !!o.mirror; o.flip = !!o.flip; o.blur = !!o.blur;
    if (!['predicted', 'whole'].includes(o.search)) o.search = DEFAULTS.search;
    if (!['robot', 'tags'].includes(o.show3d)) o.show3d = DEFAULTS.show3d;
    const r = Object.assign({}, DEFAULTS.robot, o.robot && typeof o.robot === 'object' ? o.robot : {});
    for (const k of ['body', 'left', 'right']) r[k] = typeof r[k] === 'string' && r[k] ? r[k] : 'auto';
    r.elbows = !!r.elbows; delete r.joints; // (joint angles are a tab of the Now panel now, not a switch)
    delete r.style; delete r.look; // the robot had four looks once; it is the Machine now, the only one
    if (!['off', 'ball', 'cup', 'arcade'].includes(r.props)) r.props = DEFAULTS.robot.props;
    if (!['robot', 'teen'].includes(r.actor)) r.actor = 'robot';
    if (!['story', 'practice'].includes(r.playMode)) r.playMode = 'story';
    if (typeof r.level !== 'string') r.level = DEFAULTS.robot.level;
    if (!['orbit', 'eyes'].includes(r.view)) r.view = 'orbit';
    r.headTilt = r.headTilt !== null && Number.isFinite(Number(r.headTilt)) ? Math.min(25, Math.max(-80, Number(r.headTilt))) : -40;
    r.forces = r.forces !== false; r.sound = r.sound === true;
    r.scale = isFinite(Number(r.scale)) && r.scale !== null && r.scale !== '' ? Math.min(5, Math.max(0.1, Number(r.scale))) : 1;
    for (const k of ['back', 'half', 'up', 'upper', 'fore']) {
      const x = Number(r[k]);
      if (r[k] == null || !isFinite(x)) delete r[k]; else r[k] = Math.min(1, Math.max(k === 'back' || k === 'up' ? 0 : 0.05, x));
    }
    o.robot = r; o.setup = o.setup !== false;
    return o;
  }

  return {
    mul3, tr3, mulv, add, sub, norm, rodrigues, angleOf, compose, inverse, relative, toView, inFrame, CAM_TO_VIEW, TAG_TO_VIEW, mirrorR, mirrorPose,
    guessIntrinsics, scaleIntrinsics, checkCalibration, hfov, project, depthNoise,
    History, axisSamples, orbit, niceStep, viewSignature, signatureDistance, cornerMotion, coverage,
    quatOf, quatNear, tared,
    skew, so3Log, se3Exp, minv, undistort, tagCorners, refinePose, flipPose, solveTag, solveBody, meanRotation, meanPose,
    PoseFilter, MOTION, sigmaAlong,
    toRig, fusePoses, plausible, chooseCand, sighting, jointSystem, refineJoint, planSearch,
    IMU, decodeBoardInfo, decodeImuBatch, encodeImuBatch, encodeBoardInfo, ACT, decodeActuatorStatus, encodeActuatorStatus, gripPermille, gripOpening, rotOfQuat, BoardClock, nearestRotation, lineUp, calibrateRig, solveSym, placeCameras, lookAt, arrangeTiles, parseIdList,
    PAPER, paperFor, printArea, maxTagSize, maxBoardSquare, STREAM_CSV_HEADER, streamMessage,
    fmtStamp, parseNotes, RECORDING_CSV_HEADER, recordingJson, recordingCsv, tidySpeech, insertSpeech, VOICE_COMMANDS, voiceCommand, VoiceGate,
    DEFAULTS, clampSettings, boardFit, tagFit, displayMap,
  };
});
