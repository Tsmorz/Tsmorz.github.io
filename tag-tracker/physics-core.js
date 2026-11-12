// PhysicsCore: the table the tag tracker's robot plays on (a ball, a mug that can tip over), with no DOM, so
// script/test-tag-tracker can run it in Node. A small rigid-body engine made for this one scene.
//
// Bodies: the props (a ball; a mug with a handle) and the robot's two hands. Each has spheres it touches things with
// (the ball is one; the mug's are on its rims and handle, all a plane can ever touch on it; a hand's fill its gripper and
// line its two jaws), and the mug also has its exact shape as a distance function (walls, floor, rounded lip, handle),
// which the ball and the hands' spheres meet. So every contact is a sphere against: the table (a box), the floor (a
// plane), the mug's shape, another sphere, or an arm link (a capsule moved by the page, kinematic).
// Contacts are solved by sequential impulses at 240 Hz: Coulomb friction, restitution, rolling resistance and spin
// friction in proportion to the contact force, warm starting; overlap is pushed out by split impulses, which correct
// position without adding speed. Props at rest sleep until something comes near. Gravity is -z: the plot's frame is z up.
//
// The hands are bodies too, pulled towards where the arm puts them by a spring and damper with a force and torque limit
// (HAND), so the table and the props stop them and a push has a most it can do. The page draws the arm to where the
// hand is. Each gripper's jaws close along the hand's y at JAW_SPEED towards the opening the page asks for (a servo on
// the operator's hand, or the mouse). When both pads touch the same prop while closing, the grip takes it. The jaws then
// squeeze like a servo: with a force in proportion to how far past the prop they are told to close (GRIP.k, up to
// GRIP.force), so a slight close holds lightly. The grip is a joint solved with the contacts that holds the pinched
// point and the prop's turn with what the pads allow: friction (2·mu·force) along any direction, and against a turn,
// what the patch of pad that touches can resist (its spread along and across the fingers), so a fingertip pinch lets the
// load swing about the pads and a whole pad holds it. What it can't hold slips (and is held where it slipped to); the
// pads stay solid, and a prop that slides out of them, or jaws opened to its width, lets go.
//
// Poses are {R, t} as in TagCore (R a row-major 3x3 rotation, t in metres); quaternions [w, x, y, z] inside.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PhysicsCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const madd = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => Math.hypot(a[0], a[1], a[2]);
  const unit = (a) => { const l = norm(a); return l > 1e-12 ? scale(a, 1 / l) : [0, 0, 1]; };
  const mulv = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
  const tmulv = (R, v) => [R[0] * v[0] + R[3] * v[1] + R[6] * v[2], R[1] * v[0] + R[4] * v[1] + R[7] * v[2], R[2] * v[0] + R[5] * v[1] + R[8] * v[2]];
  const mul3 = (A, B) => { const C = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[3 * i + j] = A[3 * i] * B[j] + A[3 * i + 1] * B[3 + j] + A[3 * i + 2] * B[6 + j]; return C; };
  const tr3 = (R) => [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]];
  const lerp = (a, b, s) => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s];
  const rMr = (R, M) => mul3(mul3(R, M), tr3(R));
  const diag = (d) => [d[0], 0, 0, 0, d[1], 0, 0, 0, d[2]];
  const I3 = diag([1, 1, 1]);
  function inv3(M) {
    const [a, b, c, d, e, f, g, h, i] = M, A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
    return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
  }
  const clampLen = (v, cap) => { const l = norm(v); return l > cap ? [scale(v, cap / l), true] : [v, false]; };

  // ---- rotations ----
  function qn(q) { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; }
  function qOf(R) {
    const tr = R[0] + R[4] + R[8];
    let q;
    if (tr > 0) { const s = 2 * Math.sqrt(tr + 1); q = [s / 4, (R[7] - R[5]) / s, (R[2] - R[6]) / s, (R[3] - R[1]) / s]; }
    else if (R[0] > R[4] && R[0] > R[8]) { const s = 2 * Math.sqrt(1 + R[0] - R[4] - R[8]); q = [(R[7] - R[5]) / s, s / 4, (R[1] + R[3]) / s, (R[2] + R[6]) / s]; }
    else if (R[4] > R[8]) { const s = 2 * Math.sqrt(1 + R[4] - R[0] - R[8]); q = [(R[2] - R[6]) / s, (R[1] + R[3]) / s, s / 4, (R[5] + R[7]) / s]; }
    else { const s = 2 * Math.sqrt(1 + R[8] - R[0] - R[4]); q = [(R[3] - R[1]) / s, (R[2] + R[6]) / s, (R[5] + R[7]) / s, s / 4]; }
    return qn(q);
  }
  function rOf(q) {
    const [w, x, y, z] = q;
    return [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y), 2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x), 2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)];
  }
  function qmul(a, b) {
    return [a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3], a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2], a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1], a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]];
  }
  // q turned by the turn rate w for a time h
  function qstep(q, w, h) {
    const a = norm(w) * h;
    if (a < 1e-12) return q;
    const s = Math.sin(a / 2) / norm(w), d = [Math.cos(a / 2), w[0] * s, w[1] * s, w[2] * s];
    return qn(qmul(d, q));
  }
  function nlerp(a, b, s) { const k = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1; return qn(a.map((x, i) => x + (k * b[i] - x) * s)); }
  // the rotation vector (axis times angle) of R
  function rotvec(R) {
    let q = qOf(R);
    if (q[0] < 0) q = q.map((x) => -x);
    const s = Math.hypot(q[1], q[2], q[3]);
    return s < 1e-12 ? [0, 0, 0] : scale([q[1], q[2], q[3]], (2 * Math.atan2(s, q[0])) / s);
  }
  const turnRate = (R0, R1, h) => scale(rotvec(mul3(R1, tr3(R0))), 1 / h);

  // ---- constants ----
  const H = 1 / 240, ITER = 10, SLOP = 0.0005, BETA = 0.25, MARGIN = 0.004, BOUNCE = 0.3;
  const G0 = [0, 0, -9.81];
  // Friction. The table's (a rubber mat) is above the mug's radius over its height, so a push near its rim tips it over and
  // one at its foot slides it; the robot's metal is slippery; its pads are rubber.
  const TABLE_MU = 0.7, ROBOT_MU = 0.15, PAD_MU = 0.9, SPIN_R = 0.002; // SPIN_R: the contact patch's radius, for spin friction
  // The props (m, kg). Rolling resistance crr: the torque against rolling is crr × the contact force × rollR.
  const BALL = { r: 0.02, mass: 0.03, mu: 0.6, e: 0.5, crr: 0.03 };
  // A mug: walls from Ri to R, a floor `floor` thick, a lip rounded over the wall's thickness, the outer bottom edge
  // rounded by `edge`, and a handle: half a torus (radius a, thickness b) round (x, 0, z) on its +x side.
  const CUP = { R: 0.042, Ri: 0.031, H: 0.085, floor: 0.008, edge: 0.004, mass: 0.14, mu: 0.5, e: 0.2, crr: 0.006, handle: { x: 0.038, z: 0.044, a: 0.024, b: 0.0055 } };
  const LIP = (CUP.R - CUP.Ri) / 2;
  // The hands: mass and inertia (kg, kg m²; the arm's weight is held up by its motors), the centre of mass in the hand's
  // frame, how stiffly they follow the arm (rad/s: about 1/30 s behind) and the most force and torque they push with.
  const HAND = { mass: 1.2, I: [0.004, 0.004, 0.002], com: [0, 0, -0.05], w: 45, force: 40, torque: 3, bound: 0.14 };
  // The grip: the jaws squeeze with `force` (N); the pads' friction mu holds up to 2·mu·force along any direction, a twist
  // about the jaws' axis up to 2·mu·force·twist (a pad's small contact patch), and a tip about the other axes up to
  // 2·force·tilt (the pads' half width). `w`: how stiffly the grip holds (rad/s).
  // The grip: the jaws squeeze with k (N/m) times how far past the prop they are told to close, up to `force` (N), and
  // take a prop only with at least minF. The pads' friction mu holds up to 2·mu·F along any direction; against a turn
  // about the jaws' axis mu·F·a (a: the touching patch's half size), about the other two 2·F·(its half spread along the
  // other axis); a sphere touching makes a patch `patch` across. It lets go when neither pad has held the prop for `free`
  // s, or when the pinch is `drop` from the pads. `beta`: how much of a drift it puts right each step.
  // The jaws take it once both pads are within `touch` of it (m, the two together).
  const GRIP = { force: 15, k: 1000, minF: 0.3, mu: 0.8, patch: 0.003, touch: 0.0005, free: 0.05, drop: 0.01, beta: 0.2 };
  const JAW_SPEED = 0.25;
  // a prop never turns faster than this (rad/s): a guard against a solver blow-up, never reached in the tests
  const W_MAX = 60;
  // Sleep: below these speeds (m/s, at the body's edge) for SLEEP_T s while touching something.
  const SLEEP_V = 0.008, SLEEP_T = 0.5;

  // ---- the mug's shape ----
  // Distance from p (in the mug's frame: base at the origin, z up its axis) to the mug, negative inside it.
  function box2(x, z, cx, cz, hx, hz) { const dx = Math.abs(x - cx) - hx, dz = Math.abs(z - cz) - hz; return Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dz), 0); }
  function cupSdf(p) {
    const c = CUP, rho = Math.hypot(p[0], p[1]), z = p[2];
    let d = box2(rho, z, c.Ri + LIP, (c.H - LIP) / 2, LIP, (c.H - LIP) / 2); // the wall
    d = Math.min(d, box2(rho, z, 0, c.floor / 2, c.R, c.floor / 2)); // the floor (a disc: |rho| about 0)
    d = Math.min(d, Math.hypot(rho - (c.Ri + LIP), z - (c.H - LIP)) - LIP); // the lip
    const h = c.handle, qx = p[0] - h.x, qz = p[2] - h.z;
    const hd = qx >= 0 ? Math.hypot(Math.hypot(qx, qz) - h.a, p[1]) - h.b : Math.min(Math.hypot(qx, qz - h.a, p[1]), Math.hypot(qx, qz + h.a, p[1])) - h.b;
    return Math.min(d, hd);
  }
  function cupNormal(p) {
    const e = 1e-5, g = [0, 1, 2].map((i) => { const a = p.slice(), b = p.slice(); a[i] += e; b[i] -= e; return cupSdf(a) - cupSdf(b); });
    return unit(g);
  }
  // Its mass, centre and inertia, from its solid sampled every 2 mm (once).
  let cupMass = null;
  function cupMassProps() {
    if (cupMass) return cupMass;
    const c = CUP, s = 0.002, pts = [];
    for (let x = -c.R; x <= c.handle.x + c.handle.a + c.handle.b; x += s) for (let y = -c.R; y <= c.R; y += s) for (let z = 0; z <= c.H; z += s) if (cupSdf([x, y, z]) < 0) pts.push([x, y, z]);
    const m = c.mass / pts.length;
    let com = [0, 0, 0];
    for (const p of pts) com = add(com, p);
    com = scale(com, 1 / pts.length);
    const I = new Array(9).fill(0);
    for (const p0 of pts) {
      const p = sub(p0, com), pp = dot(p, p);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) I[3 * i + j] += m * ((i === j ? pp : 0) - p[i] * p[j]);
    }
    for (let i = 0; i < 3; i++) I[4 * i] += (m * s * s) / 6; // each sample is a little cube, not a point
    return (cupMass = { com, I });
  }
  // the spheres on its rims and handle (shape frame): all a flat surface can touch
  function cupSpheres() {
    const c = CUP, out = [], n = 28;
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n, ca = Math.cos(a), sa = Math.sin(a);
      out.push({ p: [(c.R - c.edge) * ca, (c.R - c.edge) * sa, c.edge], r: c.edge });
      out.push({ p: [(c.Ri + LIP) * ca, (c.Ri + LIP) * sa, c.H - LIP], r: LIP });
    }
    const h = c.handle;
    for (let i = 0; i <= 8; i++) { const a = -Math.PI / 2 + (Math.PI * i) / 8; out.push({ p: [h.x + h.a * Math.cos(a), 0, h.z + h.a * Math.sin(a)], r: h.b }); }
    return out;
  }

  // ---- bodies ----
  let nextId = 0;
  function makeBody(kind, o) {
    const b = Object.assign({ id: nextId++, kind, asleep: false, still: 0, lost: 0, q: [1, 0, 0, 0], R: I3, t: [0, 0, 0], v: [0, 0, 0], w: [0, 0, 0], vp: null, wp: null, sdf: null, crr: 0, rollR: 0 }, o);
    b.invM = 1 / b.m; b.invIb = inv3(b.Ib);
    return b;
  }
  function ballBody() {
    const r = BALL.r, I = 0.4 * BALL.mass * r * r;
    return makeBody('ball', { m: BALL.mass, Ib: diag([I, I, I]), off: [0, 0, 0], sp: [{ p: [0, 0, 0], r }], bound: r, mu: BALL.mu, e: BALL.e, crr: BALL.crr, rollR: r });
  }
  function cupBody() {
    const M = cupMassProps(), sp = cupSpheres().map((s) => ({ p: sub(s.p, M.com), r: s.r }));
    const bound = Math.max(...sp.map((s) => norm(s.p) + s.r));
    return makeBody('cup', { m: CUP.mass, Ib: M.I, off: scale(M.com, -1), sp, sdf: true, bound, mu: CUP.mu, e: CUP.e, crr: CUP.crr, rollR: CUP.R });
  }
  // A hand: its spheres in its own frame (the wrist's, moved to its centre of mass) at a jaw gap g. G: RobotCore.gripper.
  function handSpheres(G, g) {
    const c = HAND.com, out = [];
    const at = (p, r, extra) => out.push(Object.assign({ p: sub(p, c), r, mu: ROBOT_MU }, extra || {}));
    at([0, 0, -0.012], 0.03);
    for (const y of [-0.04, -0.02, 0, 0.02, 0.04]) at([0, y, G.body.c[2]], Math.min(G.body.h[0], G.body.h[2]));
    const fr = G.finger.h[1], top = G.finger.c[2] + G.finger.h[2] - fr, bot = G.finger.c[2] - G.finger.h[2] + fr;
    for (const j of [1, -1]) for (const x of [-0.011, 0, 0.011]) for (let k = 0; k < 4; k++) {
      // a pad's spheres touch with the pad's own flat face (`flat`, pointing into the gap)
      at([x, j * (g / 2 + fr), top + ((bot - top) * k) / 3], fr, { jaw: j, flat: [0, -j, 0], mu: PAD_MU });
    }
    return out;
  }
  function handBody(G) {
    return makeBody('hand', { m: HAND.mass, Ib: diag(HAND.I), off: scale(HAND.com, -1), sp: handSpheres(G, G.gapMax), bound: HAND.bound, mu: ROBOT_MU, e: 0.1 });
  }

  // ---- contacts ----
  // Sphere (centre c, radius r) against a box (pose {R, t} at its centre, half sizes h): the distance between them
  // (negative when they overlap) and the normal from the box towards the sphere.
  function sphereBox(c, r, B, h) {
    const l = tmulv(B.R, sub(c, B.t)), q = [0, 1, 2].map((i) => Math.max(-h[i], Math.min(h[i], l[i]))), d = sub(l, q), dl = norm(d);
    if (dl > 1e-9) return { dist: dl - r, n: mulv(B.R, scale(d, 1 / dl)) };
    let k = 0, best = Infinity;
    for (let i = 0; i < 3; i++) { const m = h[i] - Math.abs(l[i]); if (m < best) { best = m; k = i; } }
    const nl = [0, 0, 0]; nl[k] = l[k] >= 0 ? 1 : -1;
    return { dist: -best - r, n: mulv(B.R, nl) };
  }
  function sphereCapsule(c, r, a, b, rc) {
    const ab = sub(b, a), L = dot(ab, ab), u = L > 1e-12 ? Math.max(0, Math.min(1, dot(sub(c, a), ab) / L)) : 0;
    const q = add(a, scale(ab, u)), d = sub(c, q), dl = norm(d);
    return { dist: dl - r - rc, n: dl > 1e-9 ? scale(d, 1 / dl) : [0, 0, 1], u };
  }
  const tangents = (n) => { const a = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], t1 = unit(cross(n, a)); return [t1, cross(n, t1)]; };

  // The world. opts: { table: {R, t (the middle of its top), size: [x, y] (m), thick}, floor: z of the floor (m),
  // gripper: RobotCore.gripper(m) }.
  function world(opts) {
    const o = opts || {}, G = o.gripper, table = o.table || null;
    const tableBox = table ? { R: table.R, t: add(table.t, mulv(table.R, [0, 0, -(table.thick || 0.03) / 2])), h: [table.size[0] / 2, table.size[1] / 2, (table.thick || 0.03) / 2] } : null;
    const floorZ = o.floor === undefined ? (table ? table.t[2] - 0.75 : -1) : o.floor;
    const W = { bodies: [], hands: {}, time: 0, warm: new Map(), table, tableBox, floorZ, starts: [], capped: 0 };
    let prevLinks = new Map(), nextLinks = [], nextHands = [];
    const touching = []; // props touching each other this substep

    W.add = function (kind, pos, Rq) {
      const b = kind === 'ball' ? ballBody() : cupBody();
      place(b, pos, Rq || I3);
      W.bodies.push(b); W.starts.push({ pos: pos.slice(), R: (Rq || I3).slice() });
      return b;
    };
    // a body's shape frame (the ball's centre, the mug's base) at pos, turned R
    function place(b, pos, R) { b.R = R.slice(); b.q = qOf(R); b.t = add(pos, mulv(R, scale(b.off, -1))); b.v = [0, 0, 0]; b.w = [0, 0, 0]; b.asleep = false; b.still = 0; b.lost = 0; }
    W.reset = function () {
      for (const k of Object.keys(W.hands)) W.hands[k].grip = null;
      W.bodies.forEach((b, i) => place(b, W.starts[i].pos, W.starts[i].R));
      W.warm.clear();
    };
    // where the page draws a body's shape (or a hand's wrist)
    W.poseOf = (b) => ({ R: b.R, t: add(b.t, mulv(b.R, b.off)) });
    W.handPose = (side) => (W.hands[side] ? W.poseOf(W.hands[side].body) : null);

    // The robot now: links [{id, a, b, r}] (capsules, in the world) and hands [{side, pose: where the arm puts the
    // wrist {R, t}, opening 0..1}]. Each is moved there smoothly over the next step.
    W.setRobot = function (robot) { nextLinks = (robot && robot.links) || []; nextHands = (robot && robot.hands) || []; };

    W.step = function (dt) {
      const d = Math.min(Math.max(dt || 0, 0), 1 / 15), n = Math.max(1, Math.round(d / H));
      if (d <= 0) return;
      const jump = (a, b) => norm(sub(a, b)) > 0.3; // a recalibration, not a sweep
      const links = nextLinks.map((L) => {
        const p = prevLinks.get(L.id);
        return { id: L.id, r: L.r, a0: p && !jump(p.a, L.a) ? p.a : L.a, b0: p && !jump(p.b, L.b) ? p.b : L.b, a1: L.a, b1: L.b };
      });
      const hands = nextHands.map((hd) => {
        let h = W.hands[hd.side];
        const P1 = hd.pose;
        if (!h || jump(W.handPose(hd.side).t, P1.t)) {
          // a new hand (or one that jumped): put it where the arm is
          if (h && h.grip) h.grip = null;
          const body = (h && h.body) || handBody(G);
          place(body, P1.t, P1.R);
          h = W.hands[hd.side] = { side: hd.side, body, gap: h ? h.gap : G.gapMax, grip: null, F: 0, touch: [null, null], pads: [[], []], aim: P1 };
        }
        h.target = Math.max(0, Math.min(1, hd.opening === undefined ? 1 : hd.opening)) * G.gapMax;
        const P0 = h.aim;
        h.aim = P1;
        return { h, q0: qOf(P0.R), q1: qOf(P1.R), t0: P0.t, t1: P1.t };
      });
      for (const k of Object.keys(W.hands)) if (!hands.some((x) => String(x.h.side) === k)) delete W.hands[k];
      for (let s = 0; s < n; s++) substep(s / n, (s + 1) / n, links, hands);
      prevLinks = new Map(nextLinks.map((L) => [L.id, { a: L.a, b: L.b }]));
      W.time += n * H;
    };

    function substep(a0, a1, links, hands) {
      const props = W.bodies, hb = hands.map((x) => x.h.body);
      // a sleeping prop is still there, but nothing moves it: it meets the others as if it were fixed
      const Z = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (const b of [...props, ...hb]) { b.iW = rMr(b.R, b.invIb); b.Iw = rMr(b.R, b.Ib); b.im = b.asleep ? 0 : b.invM; b.iWe = b.asleep ? Z : b.iW; }
      // the arm links now (a1) and a moment ago (a0), for their velocities
      const kin = links.map((L) => ({ id: L.id, r: L.r, a: lerp(L.a0, L.a1, a1), b: lerp(L.b0, L.b1, a1), pa: lerp(L.a0, L.a1, a0), pb: lerp(L.b0, L.b1, a0) }));
      // the hands: their jaws, then pulled towards the arm
      for (const x of hands) {
        const h = x.h, b = h.body, T0 = { R: rOf(nlerp(x.q0, x.q1, a0)), t: lerp(x.t0, x.t1, a0) }, T1 = { R: rOf(nlerp(x.q0, x.q1, a1)), t: lerp(x.t0, x.t1, a1) };
        const g0 = h.gap, squeeze = Math.min(GRIP.force, GRIP.k * (h.gap - h.target));
        if (h.grip) {
          const g = h.grip;
          g.free = h.touch[0] === g.body && h.touch[1] === g.body ? 0 : g.free + H;
          if (squeeze <= 0 || g.body.lost > 0 || g.free > GRIP.free) h.grip = null;
        }
        h.F = 0;
        if (h.grip) h.F = squeeze;
        else {
          const [t1, t2] = h.touch, near = (k) => Math.max(0, Math.min(...h.pads[k].filter((x) => x.other === t1).map((x) => x.dist)));
          const air = t1 && t1 === t2 ? near(0) + near(1) : 0;
          if (t1 && t1 === t2 && squeeze >= GRIP.minF && air < GRIP.touch) {
            h.grip = takeGrip(h, t1); h.F = squeeze;
            t1.asleep = false; t1.still = 0;
          } else if (air && h.target < h.gap) h.gap = Math.max(h.target, h.gap - Math.min(JAW_SPEED * H, air)); // the last of the way to the prop
          else if (h.target > h.gap) h.gap = Math.min(h.target, h.gap + JAW_SPEED * H);
          else if (h.target < h.gap) h.gap = Math.max(h.target, h.gap - JAW_SPEED * H);
        }
        h.jawRate = (h.gap - g0) / H;
        b.sp = handSpheres(G, h.gap);
        h.touch = [null, null]; h.pads = [[], []];
        const c0 = add(T0.t, mulv(T0.R, HAND.com)), c1 = add(T1.t, mulv(T1.R, HAND.com)), K = HAND.w;
        const [F] = clampLen(scale(add(scale(sub(c1, b.t), K * K), scale(sub(scale(sub(c1, c0), 1 / H), b.v), 2 * K)), HAND.mass), HAND.force);
        const [T] = clampLen(mulv(b.Iw, add(scale(rotvec(mul3(T1.R, tr3(b.R))), K * K), scale(sub(turnRate(T0.R, T1.R, H), b.w), 2 * K))), HAND.torque);
        b.v = madd(b.v, F, b.invM * H); b.w = madd(b.w, mulv(b.iW, T), H);
      }
      const awake = props.filter((b) => !b.asleep);
      for (const b of awake) b.v = madd(b.v, G0, H);
      // waking a prop wakes what it fell asleep touching
      const wake = (b) => {
        if (!b.asleep) return;
        b.asleep = false; b.still = 0; b.im = b.invM; b.iWe = b.iW; b.v = madd(b.v, G0, H); awake.push(b);
        for (const x of b.group || []) wake(x);
      };
      touching.length = 0;
      // wake what something moving comes near (two props at rest together don't keep waking each other)
      const moving = (x) => norm(x.v) + norm(x.w) * x.bound > SLEEP_V;
      for (const b of props) if (b.asleep) {
        const near = hands.some((x) => (moving(x.h.body) || x.h.jawRate) && norm(sub(x.h.body.t, b.t)) < b.bound + x.h.body.bound + MARGIN)
          || props.some((x) => !x.asleep && x !== b && moving(x) && norm(sub(x.t, b.t)) < b.bound + x.bound + MARGIN)
          || kin.some((L) => sphereCapsule(b.t, b.bound, L.a, L.b, L.r).dist < MARGIN && norm(sub(L.a, L.pa)) + norm(sub(L.b, L.pb)) > SLEEP_V * H);
        if (near) wake(b);
      }
      // contacts
      const cs = [], world = (b) => b.sp.map((s) => ({ c: add(b.t, mulv(b.R, s.p)), r: s.r, s }));
      const S = new Map([...props, ...hb].map((b) => [b, world(b)]));
      const jawExt = (b, s) => { const h = hands.find((x) => x.h.body === b); return s.jaw ? mulv(b.R, [0, (s.jaw * h.h.jawRate) / 2, 0]) : null; };
      // a hand's sphere s meeting something along nOut (out of the hand): a pad turns that to its face, and notes it
      const padN = (b, s, nOut, other, dist) => {
        if (!s.flat) return nOut;
        const f = mulv(b.R, s.flat);
        if (dot(nOut, f) > 0.5) {
          if (other && other.kind !== 'hand' && dist < 0.0015) { const h = hands.find((x) => x.h.body === b).h, k = s.jaw > 0 ? 0 : 1; h.touch[k] = other; h.pads[k].push({ p: s.p, other, dist }); }
          return f;
        }
        return nOut;
      };
      for (const b of [...awake, ...hb]) {
        const SS = S.get(b), isHand = b.kind === 'hand';
        SS.forEach(({ c, r, s }, i) => {
          if (tableBox) { const k = sphereBox(c, r, tableBox, tableBox.h); if (k.dist < MARGIN) cs.push(contact(b, i, null, -1, sub(c, scale(k.n, r)), k.n, k.dist, [0, 0, 0], isHand ? s.mu : TABLE_MU, 'T')); }
          if (c[2] - r - floorZ < MARGIN) cs.push(contact(b, i, null, -1, [c[0], c[1], c[2] - r], [0, 0, 1], c[2] - r - floorZ, [0, 0, 0], isHand ? s.mu : TABLE_MU, 'F'));
        });
        if (isHand) continue;
        for (const L of kin) {
          if (sphereCapsule(b.t, b.bound, L.a, L.b, L.r).dist > MARGIN) continue;
          if (b.sdf) {
            // the mug against a link: points along the link against its shape
            for (let k = 0; k <= 8; k++) {
              const u = k / 8, p = lerp(L.a, L.b, u), pp = lerp(L.pa, L.pb, u), loc = sub(tmulv(b.R, sub(p, b.t)), b.off), d = cupSdf(loc) - L.r;
              if (d >= MARGIN) continue;
              const n = scale(mulv(b.R, cupNormal(loc)), -1);
              cs.push(contact(b, -1, null, -1, add(p, scale(n, L.r)), n, d, scale(sub(p, pp), 1 / H), ROBOT_MU, 'L' + L.id + ':' + k));
            }
          } else SS.forEach(({ c, r }, i) => {
            const k = sphereCapsule(c, r, L.a, L.b, L.r);
            if (k.dist >= MARGIN) return;
            const p = add(L.a, scale(sub(L.b, L.a), k.u)), pp = add(L.pa, scale(sub(L.pb, L.pa), k.u));
            cs.push(contact(b, i, null, -1, sub(c, scale(k.n, r)), k.n, k.dist, scale(sub(p, pp), 1 / H), ROBOT_MU, 'L' + L.id));
          });
        }
      }
      // body against body: spheres against the mug's shape, or against each other
      const movers = [...props, ...hb];
      for (let i = 0; i < movers.length; i++) for (let j = i + 1; j < movers.length; j++) {
        let A = movers[i], B = movers[j];
        if ((A.kind === 'hand' && B.kind === 'hand') || ((A.asleep || A.kind === 'hand') && (B.asleep || B.kind === 'hand'))) continue;
        if (norm(sub(A.t, B.t)) > A.bound + B.bound + MARGIN) continue;
        if (A.sdf) { const x = A; A = B; B = x; }
        if (B.sdf) {
          // A's spheres against the mug B
          S.get(A).forEach(({ c, r, s }, k) => {
            const loc = sub(tmulv(B.R, sub(c, B.t)), B.off), d = cupSdf(loc) - r;
            if (d >= MARGIN) return;
            let n = mulv(B.R, cupNormal(loc));
            if (A.kind === 'hand') n = scale(padN(A, s, scale(n, -1), B, d), -1);
            cs.push(contact(A, k, B, -1, sub(c, scale(n, r)), n, d, null, A.kind === 'hand' ? s.mu : Math.sqrt(A.mu * B.mu), 'm' + B.id));
          });
        } else {
          // sphere against sphere (the ball and a hand): A is the prop
          if (A.kind === 'hand') { const x = A; A = B; B = x; }
          const SA = S.get(A), SB = S.get(B);
          for (let p = 0; p < SA.length; p++) for (let q = 0; q < SB.length; q++) {
            const d = sub(SA[p].c, SB[q].c), dl = norm(d), dist = dl - SA[p].r - SB[q].r;
            if (dist >= MARGIN || dl < 1e-9) continue;
            let n = scale(d, 1 / dl);
            if (B.kind === 'hand') n = padN(B, SB[q].s, n, A, dist);
            cs.push(contact(A, p, B, q, sub(SA[p].c, scale(n, SA[p].r)), n, dist, null, B.kind === 'hand' ? SB[q].s.mu : Math.sqrt(A.mu * B.mu), 'b' + B.id + ':' + q));
          }
        }
      }
      for (const ct of cs) {
        if (ct.A.kind === 'hand' && ct.sA && ct.sA.jaw) ct.eA = jawExt(ct.A, ct.sA);
        if (ct.B && ct.B.kind === 'hand' && ct.sB && ct.sB.jaw) ct.eB = jawExt(ct.B, ct.sB);
        prep(ct);
      }
      const js = [];
      for (const x of hands) if (x.h.grip) { const j = joint(x.h); if (j) js.push(j); else x.h.grip = null; }
      solve(cs, js);
      // move
      for (const b of [...awake, ...hb]) {
        if (b.kind !== 'hand') {
          b.v = scale(b.v, 1 / (1 + 0.02 * H)); b.w = scale(b.w, 1 / (1 + 0.02 * H));
          const wl = norm(b.w);
          if (wl > W_MAX) { b.w = scale(b.w, W_MAX / wl); W.capped++; }
        }
        b.t = add(b.t, scale(add(b.v, b.vp || [0, 0, 0]), H));
        b.q = qstep(b.q, add(b.w, b.wp || [0, 0, 0]), H); b.R = rOf(b.q);
        b.vp = null; b.wp = null;
      }
      // what slipped in a grip is held from where it slipped to
      for (const j of js) {
        const g = j.g;
        g.l = j.l; g.a = j.a;
        if (j.slipL) g.pB = tmulv(j.A.R, sub(add(j.B.t, mulv(j.B.R, g.pH)), j.A.t));
        if (j.slipA) g.Rrel = mul3(tr3(j.B.R), j.A.R);
      }
      for (const b of awake) {
        const held = hands.some((x) => x.h.grip && x.h.grip.body === b);
        if (!held && b._touch && norm(b.v) < SLEEP_V && norm(b.w) * b.bound < SLEEP_V) b.still += H; else b.still = 0;
      }
      // props that touch sleep together, once they have all been still long enough
      const group = new Map(awake.map((b) => [b, [b]]));
      for (const [a, b] of touching) {
        const ga = group.get(a), gb = group.get(b);
        if (!ga || !gb || ga === gb) continue;
        for (const x of gb) { ga.push(x); group.set(x, ga); }
      }
      for (const g of new Set(group.values())) if (g.every((b) => b.still > SLEEP_T)) for (const b of g) { b.asleep = true; b.v = [0, 0, 0]; b.w = [0, 0, 0]; b.group = g.filter((x) => x !== b); }
      for (const b of awake) {
        b._touch = false;
        // fallen off: back where it started after 2 s on the floor
        if (W.table && b.t[2] < W.table.t[2] - 0.15) { b.lost += H; if (b.lost > 2) { for (const x of hands) if (x.h.grip && x.h.grip.body === b) x.h.grip = null; place(b, W.starts[props.indexOf(b)].pos, W.starts[props.indexOf(b)].R); } }
        else b.lost = 0;
      }
    }

    // A grip on prop P, from the pad spheres touching it (in the hand's body frame): the pinch is their middle, halfway
    // between the pads, held where it is on the prop and with the prop's turn as it is; the patch is their spread.
    function takeGrip(h, P) {
      const Hb = h.body, pts = [...h.pads[0], ...h.pads[1]].filter((x) => x.other === P).map((x) => x.p);
      const span = (i) => (Math.max(...pts.map((p) => p[i])) - Math.min(...pts.map((p) => p[i]))) / 2 + GRIP.patch;
      const pH = [pts.reduce((a, p) => a + p[0], 0) / pts.length, 0, pts.reduce((a, p) => a + p[2], 0) / pts.length];
      const at = add(Hb.t, mulv(Hb.R, pH));
      return { body: P, gap: h.gap, pH, pB: tmulv(P.R, sub(at, P.t)), Rrel: mul3(tr3(Hb.R), P.R), sx: span(0), sz: span(2), free: 0, l: [0, 0, 0], a: [0, 0, 0] };
    }
    // The grip's joint this substep: the prop A's pinched point to the hand B's, and A's turn to B's, each impulse capped
    // by what the pads can hold (the turn's in the hand's axes: x, the jaws' y, z along the fingers).
    function joint(h) {
      const g = h.grip, A = g.body, B = h.body, F = h.F;
      const pa = add(A.t, mulv(A.R, g.pB)), pb = add(B.t, mulv(B.R, g.pH));
      if (norm(sub(pa, pb)) > GRIP.drop) return null; // pulled out of the jaws
      const rA = sub(pa, A.t), rB = sub(pb, B.t), K = new Array(9).fill(0), Kw = new Array(9);
      for (let c = 0; c < 3; c++) {
        const e = [0, 0, 0]; e[c] = 1;
        const col = add(add(scale(e, A.im + B.im), cross(mulv(A.iWe, cross(rA, e)), rA)), cross(mulv(B.iWe, cross(rB, e)), rB));
        for (let r = 0; r < 3; r++) K[3 * r + c] = col[r];
      }
      for (let i = 0; i < 9; i++) Kw[i] = A.iWe[i] + B.iWe[i];
      const k = GRIP.beta / H, errR = rotvec(mul3(A.R, tr3(mul3(B.R, g.Rrel))));
      return {
        g, A, B, rA, rB, Kinv: inv3(K), KwInv: inv3(Kw), biasL: scale(sub(pa, pb), k), biasA: scale(errR, k),
        capL: 2 * GRIP.mu * F * H, capA: [2 * F * g.sz * H, GRIP.mu * F * Math.max(g.sx, g.sz) * H, 2 * F * g.sx * H],
        l: g.l, a: g.a, slipL: false, slipA: false,
      };
    }
    function applyJoint(j, dl, da) {
      const A = j.A, B = j.B;
      A.v = madd(A.v, dl, A.im); A.w = add(A.w, mulv(A.iWe, add(cross(j.rA, dl), da)));
      B.v = madd(B.v, dl, -B.im); B.w = sub(B.w, mulv(B.iWe, add(cross(j.rB, dl), da)));
    }
    // the turn impulse in the hand's axes, each within its cap
    function capTurn(j, a) {
      const l = tmulv(j.B.R, a);
      let slip = false;
      for (let i = 0; i < 3; i++) if (Math.abs(l[i]) > j.capA[i]) { l[i] = Math.sign(l[i]) * j.capA[i]; slip = true; }
      return [mulv(j.B.R, l), slip];
    }
    function solveJoint(j) {
      const A = j.A, B = j.B;
      const vr = sub(add(A.v, cross(A.w, j.rA)), add(B.v, cross(B.w, j.rB)));
      const [nl, sl] = clampLen(add(j.l, mulv(j.Kinv, scale(add(vr, j.biasL), -1))), j.capL);
      applyJoint(j, sub(nl, j.l), [0, 0, 0]); j.l = nl; j.slipL = sl;
      const wr = sub(A.w, B.w), [na, sa] = capTurn(j, add(j.a, mulv(j.KwInv, scale(add(wr, j.biasA), -1))));
      applyJoint(j, [0, 0, 0], sub(na, j.a)); j.a = na; j.slipA = sa;
    }

    // A contact on A's sphere i (or -1) with B (a body, its sphere j or -1; or null: the table, the floor or an arm
    // link moving at vB), at p with the normal n from B towards A and the distance dist (negative: overlapping).
    function contact(A, i, B, j, p, n, dist, vB, mu, key) {
      return { A, B, sA: i >= 0 ? A.sp[i] : null, sB: B && j >= 0 ? B.sp[j] : null, p, n, dist, vB, mu, key: A.id + ':' + i + ':' + (B ? B.id : '') + key, eA: null, eB: null };
    }
    function prep(ct) {
      const A = ct.A, B = ct.B;
      ct.rA = sub(ct.p, A.t); ct.rB = B ? sub(ct.p, B.t) : null;
      [ct.t1, ct.t2] = tangents(ct.n);
      const eff = (d) => { const ca = cross(ct.rA, d); let k = A.im + dot(ca, mulv(A.iWe, ca)); if (B) { const cb = cross(ct.rB, d); k += B.im + dot(cb, mulv(B.iWe, cb)); } return 1 / k; };
      const effA = (d) => 1 / (dot(d, mulv(A.iWe, d)) + (B ? dot(d, mulv(B.iWe, d)) : 0)); // turning only
      ct.mn = eff(ct.n); ct.m1 = eff(ct.t1); ct.m2 = eff(ct.t2); ct.ms = effA(ct.n);
      ct.ln = 0; ct.l1 = 0; ct.l2 = 0; ct.lp = 0; ct.ls = 0; ct.lr = [0, 0, 0];
      // rolling resistance (torque per unit of contact force, m) and spin friction
      ct.roll = Math.max(A.crr * A.rollR, B ? B.crr * B.rollR : 0); ct.spin = ct.mu * SPIN_R;
      const vn = dot(relVel(ct), ct.n), e = B ? Math.max(A.e, B.e) * 0.5 : A.e;
      ct.target = ct.dist > 0 ? -ct.dist / H : vn < -BOUNCE ? -e * vn : 0;
      if (ct.dist <= 0.001) { A._touch = true; if (B) { B._touch = true; if (A.kind !== 'hand' && B.kind !== 'hand') touching.push([A, B]); } }
    }
    function relVel(ct) {
      let va = add(ct.A.v, cross(ct.A.w, ct.rA));
      if (ct.eA) va = add(va, ct.eA);
      if (!ct.B) return sub(va, ct.vB);
      let vb = add(ct.B.v, cross(ct.B.w, ct.rB));
      if (ct.eB) vb = add(vb, ct.eB);
      return sub(va, vb);
    }
    const relW = (ct) => (ct.B ? sub(ct.A.w, ct.B.w) : ct.A.w);
    function apply(ct, P) {
      const A = ct.A, B = ct.B;
      A.v = madd(A.v, P, A.im); A.w = add(A.w, mulv(A.iWe, cross(ct.rA, P)));
      if (B) { B.v = madd(B.v, P, -B.im); B.w = sub(B.w, mulv(B.iWe, cross(ct.rB, P))); }
    }
    function applyAng(ct, L) { ct.A.w = add(ct.A.w, mulv(ct.A.iWe, L)); if (ct.B) ct.B.w = sub(ct.B.w, mulv(ct.B.iWe, L)); }
    function applyP(ct, P) {
      const A = ct.A, B = ct.B;
      A.vp = madd(A.vp || [0, 0, 0], P, A.im); A.wp = add(A.wp || [0, 0, 0], mulv(A.iWe, cross(ct.rA, P)));
      if (B) { B.vp = madd(B.vp || [0, 0, 0], P, -B.im); B.wp = sub(B.wp || [0, 0, 0], mulv(B.iWe, cross(ct.rB, P))); }
    }
    function solve(cs, js) {
      const warm = new Map();
      for (const ct of cs) {
        const w = W.warm.get(ct.key);
        if (w && ct.dist <= 0.001) { ct.ln = w[0] * 0.9; ct.l1 = w[1] * 0.9; ct.l2 = w[2] * 0.9; apply(ct, add(scale(ct.n, ct.ln), add(scale(ct.t1, ct.l1), scale(ct.t2, ct.l2)))); }
      }
      for (const j of js) {
        const [l] = clampLen(scale(j.l, 0.9), j.capL), [a] = capTurn(j, scale(j.a, 0.9));
        j.l = l; j.a = a; applyJoint(j, l, a);
      }
      for (let it = 0; it < ITER; it++) {
        for (const j of js) solveJoint(j);
        for (const ct of cs) {
          if (ct.ln > 0) {
            // friction, within the cone of the normal impulse
            const v = relVel(ct), lim = ct.mu * ct.ln;
            let n1 = ct.l1 - ct.m1 * dot(v, ct.t1), n2 = ct.l2 - ct.m2 * dot(v, ct.t2);
            const l = Math.hypot(n1, n2);
            if (l > lim) { n1 *= lim / l; n2 *= lim / l; }
            apply(ct, add(scale(ct.t1, n1 - ct.l1), scale(ct.t2, n2 - ct.l2)));
            ct.l1 = n1; ct.l2 = n2;
            // spin about the normal, and rolling (turning about any axis in the contact plane), each up to its limit
            const ws = dot(relW(ct), ct.n), ns = Math.max(-ct.spin * ct.ln, Math.min(ct.spin * ct.ln, ct.ls - ct.ms * ws));
            applyAng(ct, scale(ct.n, ns - ct.ls)); ct.ls = ns;
            if (ct.roll > 0) {
              const w = relW(ct), wt = sub(w, scale(ct.n, dot(w, ct.n))), wl = norm(wt);
              if (wl > 1e-9) {
                const d = scale(wt, 1 / wl), k = 1 / (dot(d, mulv(ct.A.iWe, d)) + (ct.B ? dot(d, mulv(ct.B.iWe, d)) : 0));
                const [nr] = clampLen(sub(ct.lr, scale(d, k * wl)), ct.roll * ct.ln);
                applyAng(ct, sub(nr, ct.lr)); ct.lr = nr;
              }
            }
          }
          // the normal: never pulling
          const vn = dot(relVel(ct), ct.n), ln = Math.max(0, ct.ln + ct.mn * (ct.target - vn));
          apply(ct, scale(ct.n, ln - ct.ln)); ct.ln = ln;
          // and the overlap, pushed out by pseudo-velocities that are dropped after this step
          if (ct.dist < -SLOP) {
            const A = ct.A, B = ct.B, vpa = add(A.vp || [0, 0, 0], cross(A.wp || [0, 0, 0], ct.rA));
            const vpb = B ? add(B.vp || [0, 0, 0], cross(B.wp || [0, 0, 0], ct.rB)) : [0, 0, 0];
            const want = (BETA * (-ct.dist - SLOP)) / H, lp = Math.max(0, ct.lp + ct.mn * (want - dot(sub(vpa, vpb), ct.n)));
            applyP(ct, scale(ct.n, lp - ct.lp)); ct.lp = lp;
          }
        }
      }
      for (const ct of cs) if (ct.ln > 0) warm.set(ct.key, [ct.ln, ct.l1, ct.l2]);
      W.warm = warm;
    }
    return W;
  }

  // The scene on a table: 'ball' (one ball) or 'cup' (a ball and a mug). table: {R (z up), t (the middle of its top),
  // size, thick}; spots: {ball: [x, y], cup: [x, y]} in the table's frame (m from its middle); cupTurn: the mug's turn
  // about the table's z (rad; 0 puts its handle along the table's +x).
  function scene(kind, table, gripper, spots, cupTurn) {
    const W = world({ table, gripper });
    const at = (xy) => add(table.t, mulv(table.R, [xy[0], xy[1], 0]));
    const sp = spots || { ball: [0, 0.15], cup: [0, -0.15] };
    W.add('ball', add(at(sp.ball), mulv(table.R, [0, 0, BALL.r])), table.R);
    if (kind === 'cup') { const a = cupTurn || 0, Rz = [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1]; W.add('cup', at(sp.cup), mul3(table.R, Rz)); }
    return W;
  }

  // How far a body is tipped from upright (rad), for the tests.
  const tilt = (b) => Math.acos(Math.max(-1, Math.min(1, b.R[8])));

  return { BALL, CUP, LIP, HAND, GRIP, H, JAW_SPEED, W_MAX, world, scene, sphereBox, sphereCapsule, cupSdf, cupMassProps, tilt, qOf, rOf, rotvec };
});
