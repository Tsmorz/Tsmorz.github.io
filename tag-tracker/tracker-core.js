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
  function solveBody(c, body, dets, opts) {
    const obj = [], img = [], starts = [];
    for (const m of body.members) {
      const d = dets.find((x) => x.id === m.id);
      if (!d) continue;
      const pts = tagCorners(m.size);
      for (let k = 0; k < 4; k++) { obj.push(add(mulv(m.R, pts[k]), m.t)); img.push([d.corners[2 * k], d.corners[2 * k + 1]]); }
      if (d.R) {
        const inv = inverse({ R: m.R, t: m.t });
        starts.push(compose(d, inv), compose(flipPose(d), inv));
      }
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

  // Error-state Kalman filter for a pose moving at nearly constant velocity. State: position p, velocity v,
  // rotation R and angular velocity w (both velocities in the camera frame); error δx = (δp, δv, δθ, δw) with
  // R ← exp(δθ)·R. qa and qw are the spectral densities of the random acceleration (m²/s³) and angular
  // acceleration (rad²/s³): bigger follows faster motion, smaller smooths more.
  function PoseFilter(opts) {
    this.o = Object.assign({ qa: 4, qw: 40, gate: 40, maxGap: 0.5, floorP: 1e-6, floorR: 1e-5, maxMiss: 3 }, opts || {});
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
    if (!this.x || time - this.x.time > this.o.maxGap || time <= this.x.time) { this.init(time, best); return { pose: this.pose(), chosen: 0, d2: 0, restarted: true }; }
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
    return { pose: this.pose(), chosen: pick, d2: inn.d2 };
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
    mirror: false, // show the camera picture mirrored left to right (display only: poses are never mirrored)
    flip: false, // show it upside down
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

  function clampSettings(s) {
    const o = Object.assign({}, DEFAULTS, s || {});
    const num = (k, lo, hi) => { const x = Number(o[k]); o[k] = isFinite(x) ? Math.min(hi, Math.max(lo, x)) : DEFAULTS[k]; };
    num('span', 0.1, 30); num('every', 0.01, 10); num('axisLen', 0.001, 2); num('tagSize', 0.005, 2); num('hfov', 20, 170);
    if (o.every > o.span) o.every = o.span;
    if (!['raw', 'refined', 'filtered'].includes(o.pose)) o.pose = DEFAULTS.pose;
    if (!MOTION[o.motion]) o.motion = DEFAULTS.motion;
    o.compare = !!o.compare; o.mirror = !!o.mirror; o.flip = !!o.flip;
    return o;
  }

  return {
    mul3, tr3, mulv, add, sub, norm, rodrigues, angleOf, compose, inverse, relative, toView, inFrame, CAM_TO_VIEW, TAG_TO_VIEW,
    guessIntrinsics, scaleIntrinsics, checkCalibration, hfov, project, depthNoise,
    History, axisSamples, orbit, niceStep, viewSignature, signatureDistance, cornerMotion, coverage,
    quatOf, quatNear, tared,
    skew, so3Log, se3Exp, minv, undistort, tagCorners, refinePose, flipPose, solveTag, solveBody, meanRotation, meanPose,
    PoseFilter, MOTION, sigmaAlong,
    DEFAULTS, clampSettings, boardFit, displayMap,
  };
});
