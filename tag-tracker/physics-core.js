// PhysicsCore: the table the tag tracker's robot plays on (a ball, a cup that can tip over), with no DOM, so
// script/test-tag-tracker can run it in Node. A small rigid-body engine made for this one scene.
//
// Every body that moves is a set of spheres fixed in its own frame (the ball is one, the cup ~360 in rings and a floor),
// so every contact is sphere against something: the table (a box), the floor (a plane), the robot (capsules for its arm
// links, boxes for the gripper's body and jaws: kinematic, moved by the page each frame) or another body's sphere.
// Contacts are solved by sequential impulses (Coulomb friction, restitution, warm starting) at 240 Hz, and overlap is
// pushed out by split impulses, which correct position without adding speed. Gravity is -z: the 3D plot's frame is z up.
//
// The grippers: the page sets each hand's pose and how far it is open (0 to 1, from a servo on the operator's hand or the
// mouse). The jaws close along the hand's y at JAW_SPEED; when both pads touch the same body while closing it is held,
// welded to the hand (it moves with it, still pushing the other bodies about), and opening past the gap it was taken at
// lets it go with the hand's velocity. A weld instead of friction between two jaws the operator drives by position, which
// would squeeze and jitter.
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
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => Math.hypot(a[0], a[1], a[2]);
  const mulv = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
  const tmulv = (R, v) => [R[0] * v[0] + R[3] * v[1] + R[6] * v[2], R[1] * v[0] + R[4] * v[1] + R[7] * v[2], R[2] * v[0] + R[5] * v[1] + R[8] * v[2]];
  const mul3 = (A, B) => { const C = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[3 * i + j] = A[3 * i] * B[j] + A[3 * i + 1] * B[3 + j] + A[3 * i + 2] * B[6 + j]; return C; };
  const tr3 = (R) => [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]];
  const lerp = (a, b, s) => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s];
  const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

  // ---- quaternions ----
  function qOf(R) {
    const tr = R[0] + R[4] + R[8];
    let q;
    if (tr > 0) { const s = 2 * Math.sqrt(tr + 1); q = [s / 4, (R[7] - R[5]) / s, (R[2] - R[6]) / s, (R[3] - R[1]) / s]; }
    else if (R[0] > R[4] && R[0] > R[8]) { const s = 2 * Math.sqrt(1 + R[0] - R[4] - R[8]); q = [(R[7] - R[5]) / s, s / 4, (R[1] + R[3]) / s, (R[2] + R[6]) / s]; }
    else if (R[4] > R[8]) { const s = 2 * Math.sqrt(1 + R[4] - R[0] - R[8]); q = [(R[2] - R[6]) / s, (R[1] + R[3]) / s, s / 4, (R[5] + R[7]) / s]; }
    else { const s = 2 * Math.sqrt(1 + R[8] - R[0] - R[4]); q = [(R[3] - R[1]) / s, (R[2] + R[6]) / s, (R[5] + R[7]) / s, s / 4]; }
    return qn(q);
  }
  function qn(q) { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; }
  function rOf(q) {
    const [w, x, y, z] = q;
    return [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y), 2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x), 2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)];
  }
  function qmul(a, b) {
    return [a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3], a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2], a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1], a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]];
  }
  // a rotation by w·h (a turn rate for a time) applied to q
  function qstep(q, w, h) {
    const a = norm(w) * h;
    if (a < 1e-12) return q;
    const s = Math.sin(a / 2) / (a / h), d = [Math.cos(a / 2), w[0] * s, w[1] * s, w[2] * s];
    return qn(qmul(d, q));
  }
  function nlerp(a, b, s) { const k = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1; return qn(a.map((x, i) => x + (k * b[i] - x) * s)); }
  // the turn rate taking R0 to R1 in time h
  function turnRate(R0, R1, h) {
    let q = qOf(mul3(R1, tr3(R0)));
    if (q[0] < 0) q = q.map((x) => -x);
    const s = Math.hypot(q[1], q[2], q[3]);
    if (s < 1e-12) return [0, 0, 0];
    const a = 2 * Math.atan2(s, q[0]);
    return scale([q[1], q[2], q[3]], a / s / h);
  }
  const compose = (A, B) => ({ R: mul3(A.R, B.R), t: add(mulv(A.R, B.t), A.t) });
  const inverse = (A) => { const Rt = tr3(A.R); return { R: Rt, t: scale(mulv(Rt, A.t), -1) }; };
  // a 3x3 (row-major) times a vector, and R·diag(d)·Rᵀ
  const rdr = (R, d) => { const M = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[3 * i + j] = R[3 * i] * d[0] * R[3 * j] + R[3 * i + 1] * d[1] * R[3 * j + 1] + R[3 * i + 2] * d[2] * R[3 * j + 2]; return M; };

  // ---- the props ----
  // Sizes in metres, masses in kilograms. The ball is a 4 cm ball; the cup is 8.4 cm across, 8 cm tall, with room inside
  // for the ball. Shapes are given in the shape's own frame (the ball's centre; the cup's base, z up its axis).
  const BALL = { r: 0.02, mass: 0.03, mu: 0.6, e: 0.45, roll: 0.25 };
  const CUP = { R: 0.042, H: 0.08, wall: 0.006, mass: 0.08, mu: 0.5, e: 0.2, roll: 0 };
  function cupSpheres() {
    const c = CUP, rr = c.R - c.wall, out = [];
    const rings = Math.round((c.H - 2 * c.wall) / 0.006) + 1, n = 28;
    for (let k = 0; k < rings; k++) {
      const z = c.wall + ((c.H - 2 * c.wall) * k) / (rings - 1);
      // the wall's spheres (all but the rim) are its sides: see `smooth`
      for (let i = 0; i < n; i++) { const a = (2 * Math.PI * (i + (k % 2) / 2)) / n; out.push({ p: [rr * Math.cos(a), rr * Math.sin(a), z], r: c.wall, side: k > 0 && k < rings - 1 }); }
    }
    out.push({ p: [0, 0, c.wall], r: c.wall });
    for (const [rad, cnt] of [[0.011, 6], [0.021, 12]]) for (let i = 0; i < cnt; i++) { const a = (2 * Math.PI * i) / cnt; out.push({ p: [rad * Math.cos(a), rad * Math.sin(a), c.wall], r: c.wall }); }
    return out;
  }
  // A body from spheres (shape frame) and a mass spread over them by volume: its centre of mass is its origin, `off`
  // is where the shape's frame sits in the body's.
  function makeBody(kind, spheres, P) {
    const vol = spheres.map((s) => s.r * s.r * s.r), V = vol.reduce((a, b) => a + b, 0);
    let com = [0, 0, 0];
    spheres.forEach((s, i) => { com = add(com, scale(s.p, vol[i] / V)); });
    const sp = spheres.map((s) => ({ p: sub(s.p, com), r: s.r, side: !!s.side }));
    const Id = [0, 0, 0];
    sp.forEach((s, i) => {
      const m = (P.mass * vol[i]) / V, own = 0.4 * m * s.r * s.r;
      Id[0] += m * (s.p[1] * s.p[1] + s.p[2] * s.p[2]) + own;
      Id[1] += m * (s.p[0] * s.p[0] + s.p[2] * s.p[2]) + own;
      Id[2] += m * (s.p[0] * s.p[0] + s.p[1] * s.p[1]) + own;
    });
    const bound = Math.max(...sp.map((s) => norm(s.p) + s.r));
    return { kind, sp, off: scale(com, -1), invM: 1 / P.mass, invI: Id.map((x) => 1 / x), mu: P.mu, e: P.e, roll: P.roll, bound, q: [1, 0, 0, 0], R: I3, t: [0, 0, 0], v: [0, 0, 0], w: [0, 0, 0], held: 0, lost: 0 };
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
  // A wall of spheres is bumpy: something pushing it sits between two rings, and the normal towards a sphere's centre
  // tips up or down, pressing the cup into the table instead of over. Against the side of a wall, take the cylinder's
  // own normal instead: the contact normal with its part along the body's axis taken off.
  function smooth(k, body, s) {
    if (!s.side) return k;
    const ax = [body.R[2], body.R[5], body.R[8]], n = sub(k.n, scale(ax, dot(k.n, ax))), l = norm(n);
    return l > 0.5 ? { dist: k.dist, n: scale(n, 1 / l), u: k.u } : k;
  }
  const tangents = (n) => { const a = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], t1 = cross(n, a), l = norm(t1); const u = scale(t1, 1 / l); return [u, cross(n, u)]; };

  const H = 1 / 240, ITER = 10, SLOP = 0.0005, BETA = 0.25, MARGIN = 0.004, BOUNCE = 0.25, JAW_SPEED = 0.25, LET_GO = 0.005;
  const G0 = [0, 0, -9.81];
  // The table's grip: high enough that a cup pushed near its rim tips over rather than slides (it tips once the push is
  // higher than its radius over this), as on a rubber mat.
  const TABLE_MU = 0.7;
  // The robot's smooth metal (so a push low on the cup slides it and one near its rim tips it over), and its rubber pads.
  const ROBOT_MU = 0.15, PAD_MU = 0.8;

  // The world. opts: { table: {R, t (the middle of its top), size: [x, y] (m), thick}, floor: z of the floor (m),
  // gripper: RobotCore.gripper(m) }.
  function world(opts) {
    const o = opts || {}, G = o.gripper;
    const table = o.table || null;
    const tableBox = table ? { R: table.R, t: add(table.t, mulv(table.R, [0, 0, -(table.thick || 0.03) / 2])), h: [table.size[0] / 2, table.size[1] / 2, (table.thick || 0.03) / 2] } : null;
    const floorZ = o.floor === undefined ? (table ? table.t[2] - 0.75 : -1) : o.floor;
    const W = { bodies: [], grippers: {}, links: [], time: 0, warm: new Map(), table, tableBox, floorZ, starts: [] };
    let prevLinks = new Map(), prevHands = new Map();

    W.add = function (kind, pos, Rq) {
      const b = kind === 'ball' ? makeBody('ball', [{ p: [0, 0, 0], r: BALL.r }], BALL) : makeBody('cup', cupSpheres(), CUP);
      b.id = W.bodies.length;
      place(b, pos, Rq || I3);
      W.bodies.push(b); W.starts.push({ pos: pos.slice(), R: (Rq || I3).slice() });
      return b;
    };
    // a body's shape frame (the ball's centre, the cup's base) at pos, turned R
    function place(b, pos, R) { b.R = R.slice(); b.q = qOf(R); b.t = add(pos, mulv(R, scale(b.off, -1))); b.v = [0, 0, 0]; b.w = [0, 0, 0]; b.held = 0; b.lost = 0; }
    W.reset = function () {
      W.bodies.forEach((b, i) => place(b, W.starts[i].pos, W.starts[i].R));
      for (const k of Object.keys(W.grippers)) { const g = W.grippers[k]; if (g.held) g.held = null; }
      W.warm.clear();
    };
    // the pose the page draws a body's shape at
    W.poseOf = (b) => ({ R: b.R, t: add(b.t, mulv(b.R, b.off)) });

    // The robot now: links [{id, a, b, r}] (capsules, in the world) and hands [{side, pose: wrist {R, t}, opening 0..1}].
    // Each is moved there smoothly over the next step. A hand not given keeps no gripper.
    let nextLinks = [], nextHands = [];
    W.setRobot = function (robot) { nextLinks = (robot && robot.links) || []; nextHands = (robot && robot.hands) || []; };

    // the gripper's boxes at hand pose P and gap g: its body and jaw j (+1, -1)
    const handBox = (P) => ({ R: P.R, t: add(P.t, mulv(P.R, G.body.c)) });
    const jawBox = (P, g, j) => ({ R: P.R, t: add(P.t, mulv(P.R, [G.finger.c[0], j * (G.finger.c[1] + g / 2), G.finger.c[2]])) });

    W.step = function (dt) {
      const d = Math.min(Math.max(dt || 0, 0), 1 / 15), n = Math.max(1, Math.round(d / H));
      if (d <= 0) return;
      // where each link and hand starts and ends this step (a big jump, such as a recalibration, isn't a sweep)
      const jump = (a, b) => norm(sub(a, b)) > 0.3;
      const links = nextLinks.map((L) => {
        const p = prevLinks.get(L.id);
        return { id: L.id, r: L.r, a0: p && !jump(p.a, L.a) ? p.a : L.a, b0: p && !jump(p.b, L.b) ? p.b : L.b, a1: L.a, b1: L.b };
      });
      const hands = nextHands.map((hd) => {
        const p = prevHands.get(hd.side), P1 = hd.pose, P0 = p && !jump(p.t, P1.t) ? p : P1;
        let g = W.grippers[hd.side];
        if (!g) g = W.grippers[hd.side] = { side: hd.side, gap: G.gapMax, held: null, touch: [null, null] };
        g.target = Math.max(0, Math.min(1, hd.opening === undefined ? 1 : hd.opening)) * G.gapMax;
        return { side: hd.side, g, q0: qOf(P0.R), q1: qOf(P1.R), t0: P0.t, t1: P1.t };
      });
      // hands that went away let go
      for (const k of Object.keys(W.grippers)) if (!hands.some((h) => String(h.side) === k)) { const g = W.grippers[k]; if (g.held) release(g, null); delete W.grippers[k]; }
      for (let s = 0; s < n; s++) substep((s) / n, (s + 1) / n, links, hands);
      prevLinks = new Map(nextLinks.map((L) => [L.id, { a: L.a, b: L.b }]));
      prevHands = new Map(nextHands.map((hd) => [hd.side, hd.pose]));
      W.time += n * H;
    };

    function release(g, hand) {
      const b = g.held.body;
      b.held = 0;
      if (hand) { b.v = hand.v; b.w = hand.w; }
      g.held = null;
    }

    function substep(a0, a1, links, hands) {
      // the kinematic shapes now (a1) and a moment ago (a0), for their velocities
      const kin = [];
      for (const L of links) kin.push({ type: 'cap', id: 'l' + L.id, r: L.r, a: lerp(L.a0, L.a1, a1), b: lerp(L.b0, L.b1, a1), pa: lerp(L.a0, L.a1, a0), pb: lerp(L.b0, L.b1, a0) });
      for (const hd of hands) {
        const g = hd.g, P0 = { R: rOf(nlerp(hd.q0, hd.q1, a0)), t: lerp(hd.t0, hd.t1, a0) }, P1 = { R: rOf(nlerp(hd.q0, hd.q1, a1)), t: lerp(hd.t0, hd.t1, a1) };
        hd.P0 = P0; hd.P1 = P1;
        // the jaws: open freely; close until both pads touch one body (then it's held), pushing what one pad meets
        const g0 = g.gap;
        if (g.held) { if (g.target > g.held.gap + LET_GO) { release(g, heldVel(g, P0, P1)); } }
        if (!g.held) {
          if (g.target > g.gap) g.gap = Math.min(g.target, g.gap + JAW_SPEED * H);
          else if (g.target < g.gap) {
            const [t1, t2] = g.touch;
            if (t1 && t1 === t2) { g.held = { body: t1, gap: g.gap, rel: compose(inverse(P0), { R: t1.R, t: t1.t }) }; t1.held = g.side; t1.v = [0, 0, 0]; t1.w = [0, 0, 0]; }
            else g.gap = Math.max(g.target, g.gap - JAW_SPEED * H);
          }
        }
        kin.push({ type: 'box', id: 'h' + hd.side, side: hd.side, h: G.body.h, B: handBox(P1), pB: handBox(P0) });
        for (const j of [1, -1]) kin.push({ type: 'box', id: 'j' + hd.side + j, side: hd.side, jaw: j, h: G.finger.h, B: jawBox(P1, g.gap, j), pB: jawBox(P0, g0, j), P: P1 });
        g.touch = [null, null];
      }
      // held bodies ride on their hands
      for (const hd of hands) if (hd.g.held) {
        const b = hd.g.held.body, A = compose(hd.P0, hd.g.held.rel), B = compose(hd.P1, hd.g.held.rel);
        b.v = scale(sub(B.t, A.t), 1 / H); b.w = turnRate(A.R, B.R, H);
        b.R = B.R; b.q = qOf(B.R); b.t = B.t;
      }
      const dyn = W.bodies.filter((b) => !b.held);
      for (const b of dyn) b.v = add(b.v, scale(G0, H));
      // contacts
      const cs = [];
      const world = (b) => b.sp.map((s) => ({ c: add(b.t, mulv(b.R, s.p)), r: s.r }));
      const W_ = W.bodies.map(world);
      for (const b of dyn) {
        const S = W_[b.id];
        for (let i = 0; i < S.length; i++) {
          const { c, r } = S[i];
          if (tableBox) { const k = sphereBox(c, r, tableBox, tableBox.h); if (k.dist < MARGIN) cs.push(contact(b, null, i, 'T', c, r, k, [0, 0, 0], TABLE_MU)); }
          if (c[2] - r - floorZ < MARGIN) cs.push(contact(b, null, i, 'F', c, r, { dist: c[2] - r - floorZ, n: [0, 0, 1] }, [0, 0, 0], 0.6));
        }
        for (const K of kin) {
          // broad phase: the body's bounding sphere against the shape's
          if (K.type === 'cap') {
            const k0 = sphereCapsule(b.t, b.bound, K.a, K.b, K.r);
            if (k0.dist > MARGIN) continue;
            for (let i = 0; i < S.length; i++) {
              const k = smooth(sphereCapsule(S[i].c, S[i].r, K.a, K.b, K.r), b, b.sp[i]);
              if (k.dist >= MARGIN) continue;
              const p = add(K.a, scale(sub(K.b, K.a), k.u)), pp = add(K.pa, scale(sub(K.pb, K.pa), k.u));
              cs.push(contact(b, null, i, K.id, S[i].c, S[i].r, k, scale(sub(p, pp), 1 / H), ROBOT_MU));
            }
          } else {
            const k0 = sphereBox(b.t, b.bound, K.B, K.h);
            if (k0.dist > MARGIN) continue;
            for (let i = 0; i < S.length; i++) {
              const k = smooth(sphereBox(S[i].c, S[i].r, K.B, K.h), b, b.sp[i]);
              if (k.dist >= MARGIN) continue;
              const pt = sub(S[i].c, scale(k.n, S[i].r)), loc = tmulv(K.B.R, sub(pt, K.B.t)), was = add(K.pB.t, mulv(K.pB.R, loc));
              cs.push(contact(b, null, i, K.id, S[i].c, S[i].r, k, scale(sub(pt, was), 1 / H), K.jaw ? PAD_MU : ROBOT_MU));
              // a pad touching this body from inside the jaws
              if (K.jaw && k.dist < 0.0015) {
                const y = [K.P.R[1], K.P.R[4], K.P.R[7]];
                if (-K.jaw * dot(k.n, y) > 0.3) { const g = W.grippers[K.side]; g.touch[K.jaw > 0 ? 0 : 1] = b; }
              }
            }
          }
        }
      }
      // body against body (a held one counts as kinematic)
      for (let i = 0; i < W.bodies.length; i++) for (let j = i + 1; j < W.bodies.length; j++) {
        let A = W.bodies[i], B = W.bodies[j];
        if (A.held && B.held) continue;
        if (A.held) { const x = A; A = B; B = x; }
        if (norm(sub(A.t, B.t)) > A.bound + B.bound + MARGIN) continue;
        const SA = W_[A.id], SB = W_[B.id];
        for (let p = 0; p < SA.length; p++) for (let q = 0; q < SB.length; q++) {
          const d = sub(SA[p].c, SB[q].c), dl = norm(d), dist = dl - SA[p].r - SB[q].r;
          if (dist >= MARGIN || dl < 1e-9) continue;
          let k = { dist, n: scale(d, 1 / dl) };
          if (B.sp[q].side) k = smooth(k, B, B.sp[q]);
          else if (A.sp[p].side) { const f = smooth({ dist, n: scale(k.n, -1) }, A, A.sp[p]); k = { dist, n: scale(f.n, -1) }; }
          cs.push(contact(A, B, p, 'b' + B.id + ':' + q, SA[p].c, SA[p].r, k, null, Math.sqrt(A.mu * B.mu)));
        }
      }
      solve(cs);
      // integrate
      for (const b of dyn) {
        const touching = b._touch;
        b.v = scale(b.v, 1 / (1 + 0.05 * H));
        b.w = scale(b.w, 1 / (1 + (touching ? 0.3 + b.roll * 6 : 0.05) * H));
        b.t = add(b.t, scale(add(b.v, b.vp || [0, 0, 0]), H));
        b.q = qstep(b.q, add(b.w, b.wp || [0, 0, 0]), H); b.R = rOf(b.q);
        b.vp = null; b.wp = null; b._touch = false;
        // fallen off: back where it started after 2 s on the floor
        if (W.table && b.t[2] < W.table.t[2] - 0.15) { b.lost += H; if (b.lost > 2) place(b, W.starts[b.id].pos, W.starts[b.id].R); }
        else b.lost = 0;
      }
    }

    // A contact between body A's sphere i (centre c, radius r) and B (a body, or null for the table, the floor or the
    // robot moving at vB), with k = {dist, n} (n from B towards A).
    function contact(A, B, i, key, c, r, k, vB, mu) {
      const p = sub(c, scale(k.n, r)), rA = sub(p, A.t), rB = B ? sub(p, B.t) : null, [t1, t2] = tangents(k.n);
      const ct = { A, B, n: k.n, dist: k.dist, rA, rB, vB, mu, t1, t2, key: A.id + ':' + i + ':' + key, ln: 0, l1: 0, l2: 0, lp: 0 };
      ct.iA = rdr(A.R, A.invI);
      ct.iB = B && !B.held ? rdr(B.R, B.invI) : null;
      const eff = (d) => {
        const ca = cross(rA, d); let k2 = A.invM + dot(ca, mulv(ct.iA, ca));
        if (ct.iB) { const cb = cross(rB, d); k2 += B.invM + dot(cb, mulv(ct.iB, cb)); }
        return 1 / k2;
      };
      ct.mn = eff(k.n); ct.m1 = eff(t1); ct.m2 = eff(t2);
      const vn = dot(relVel(ct), k.n), e = B ? Math.max(A.e, B.e) * 0.5 : A.e * (key === 'T' || key === 'F' ? 1 : 0.4);
      ct.target = k.dist > 0 ? -k.dist / H : vn < -BOUNCE ? -e * vn : 0;
      return ct;
    }
    function velAt(b, r) { return add(b.v, cross(b.w, r)); }
    function relVel(ct) {
      const va = velAt(ct.A, ct.rA);
      if (ct.B) return sub(va, velAt(ct.B, ct.rB));
      return sub(va, ct.vB);
    }
    function apply(ct, P) {
      const A = ct.A, B = ct.B;
      A.v = add(A.v, scale(P, A.invM)); A.w = add(A.w, mulv(ct.iA, cross(ct.rA, P)));
      if (ct.iB) { B.v = sub(B.v, scale(P, B.invM)); B.w = sub(B.w, mulv(ct.iB, cross(ct.rB, P))); }
    }
    function applyP(ct, P) {
      const A = ct.A, B = ct.B;
      A.vp = add(A.vp || [0, 0, 0], scale(P, A.invM)); A.wp = add(A.wp || [0, 0, 0], mulv(ct.iA, cross(ct.rA, P)));
      if (ct.iB) { B.vp = sub(B.vp || [0, 0, 0], scale(P, B.invM)); B.wp = sub(B.wp || [0, 0, 0], mulv(ct.iB, cross(ct.rB, P))); }
    }
    function solve(cs) {
      const warm = new Map();
      // warm start from the last step's impulses
      for (const ct of cs) {
        const w = W.warm.get(ct.key);
        if (w && ct.dist <= 0.001) { ct.ln = w[0] * 0.9; ct.l1 = w[1] * 0.9; ct.l2 = w[2] * 0.9; apply(ct, add(scale(ct.n, ct.ln), add(scale(ct.t1, ct.l1), scale(ct.t2, ct.l2)))); }
        if (ct.dist <= 0.001) ct.A._touch = true;
      }
      for (let it = 0; it < ITER; it++) {
        for (const ct of cs) {
          // friction, within the cone of the normal impulse
          if (ct.ln > 0) {
            const v = relVel(ct), lim = ct.mu * ct.ln;
            let n1 = ct.l1 - ct.m1 * dot(v, ct.t1), n2 = ct.l2 - ct.m2 * dot(v, ct.t2);
            const l = Math.hypot(n1, n2);
            if (l > lim) { n1 *= lim / l; n2 *= lim / l; }
            apply(ct, add(scale(ct.t1, n1 - ct.l1), scale(ct.t2, n2 - ct.l2)));
            ct.l1 = n1; ct.l2 = n2;
          }
          // the normal: never pulling
          const vn = dot(relVel(ct), ct.n), ln = Math.max(0, ct.ln + ct.mn * (ct.target - vn));
          apply(ct, scale(ct.n, ln - ct.ln)); ct.ln = ln;
          // and the overlap, pushed out by pseudo-velocities that are dropped after this step
          if (ct.dist < -SLOP) {
            const A = ct.A, B = ct.B, vpa = add(A.vp || [0, 0, 0], cross(A.wp || [0, 0, 0], ct.rA));
            const vpb = ct.iB ? add(B.vp || [0, 0, 0], cross(B.wp || [0, 0, 0], ct.rB)) : [0, 0, 0];
            const want = (BETA * (-ct.dist - SLOP)) / H, lp = Math.max(0, ct.lp + ct.mn * (want - dot(sub(vpa, vpb), ct.n)));
            applyP(ct, scale(ct.n, lp - ct.lp)); ct.lp = lp;
          }
        }
      }
      for (const ct of cs) if (ct.ln > 0) warm.set(ct.key, [ct.ln, ct.l1, ct.l2]);
      W.warm = warm;
    }
    // a held body's velocity as its hand moves from P0 to P1
    function heldVel(g, P0, P1) {
      const A = compose(P0, g.held.rel), B = compose(P1, g.held.rel);
      return { v: scale(sub(B.t, A.t), 1 / H), w: turnRate(A.R, B.R, H) };
    }
    return W;
  }

  // The scene on a table: 'ball' (one ball) or 'cup' (a ball and a cup). table: {R (z up), t (the middle of its top),
  // size, thick}; spots: {ball: [x, y], cup: [x, y]} in the table's frame (m from its middle).
  function scene(kind, table, gripper, spots) {
    const W = world({ table, gripper });
    const at = (xy) => add(table.t, mulv(table.R, [xy[0], xy[1], 0]));
    const sp = spots || { ball: [0, 0.15], cup: [0, -0.15] };
    W.add('ball', add(at(sp.ball), mulv(table.R, [0, 0, BALL.r])), table.R);
    if (kind === 'cup') W.add('cup', at(sp.cup), table.R);
    return W;
  }

  // How far a body is tipped from upright (rad), for the tests and the page's readout.
  const tilt = (b) => Math.acos(Math.max(-1, Math.min(1, b.R[8])));

  return { BALL, CUP, H, JAW_SPEED, world, scene, sphereBox, sphereCapsule, cupSpheres, tilt, qOf, rOf };
});
