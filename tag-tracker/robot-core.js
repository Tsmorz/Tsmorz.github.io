// RobotCore: the robot behind /tag-tracker/'s 3D view, with no DOM, so script/test-tag-tracker can run it in Node.
// A humanoid with two 7-joint arms. A tag on the chest carries the body; a tag at each wrist is where that arm's
// gripper should be, and inverse kinematics finds the joint angles.
//
// Frames: the chest's x points forward, y to its left and z up, with its origin at the chest tag. Poses are {R, t}
// as in TagCore (R a row-major 3x3 rotation, t in metres). `side` is +1 for the left arm and -1 for the right; the
// right arm is the left one's mirror image through the chest's x-z plane, so the same angles give mirrored poses.
//
// Each arm is a sphere-revolute-sphere chain:
//   shoulder  R_upper = Ry(-q1) Rx(side q2) Rz(side q3)   flex forward, out to the side, turn the upper arm
//   elbow     R_fore  = R_upper Ry(-q4)                    bend, 0 = straight
//   wrist     R_hand  = R_fore Rz(side q5) Rx(side q6) Ry(q7)  turn the forearm, bend the wrist, tilt it
// With every angle zero the arm hangs straight down. The upper arm runs along its frame's -z, and so does the forearm.
// The hand's -z points along the fingers, the gripper's jaws close along its y (side to side in HOME) and its +x is
// the back of the hand (up in HOME). In HOME the elbows are bent 90°, so the forearms point forward.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./tracker-core.js'));
  else root.RobotCore = factory(root.TagCore);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';
  const { mul3, tr3, mulv, add, sub, norm, compose, inverse, rodrigues } = C;
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const unit = (a) => scale(a, 1 / norm(a));
  const Rx = (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
  const Ry = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
  const Rz = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
  const cols = (x, y, z) => [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const DEG = Math.PI / 180, TAU = 2 * Math.PI;

  // Lengths in metres. A shoulder sits `back` behind, `half` to the side of and `up` above the chest tag. `hand`
  // (wrist to fingertips) is only drawn.
  const MODEL = { back: 0.06, half: 0.18, up: 0.12, upper: 0.3, fore: 0.27, hand: 0.09 };
  // Joint limits, roughly a person's.
  const JOINTS = [
    { name: 'Shoulder forward', lo: -60 * DEG, hi: 190 * DEG },
    { name: 'Shoulder out', lo: -50 * DEG, hi: 95 * DEG },
    { name: 'Upper arm turn', lo: -100 * DEG, hi: 100 * DEG },
    { name: 'Elbow', lo: 0, hi: 150 * DEG },
    { name: 'Forearm turn', lo: -120 * DEG, hi: 120 * DEG },
    { name: 'Wrist bend', lo: -80 * DEG, hi: 80 * DEG },
    { name: 'Wrist tilt', lo: -50 * DEG, hi: 50 * DEG },
  ];
  // Arms at the sides, forearms forward, palms in.
  const HOME = [0, 0, 0, 90 * DEG, 0, 0, 0];

  // How fast each joint can turn (rad/s) and speed up or slow down (rad/s²): a light arm's motors, faster at the wrist.
  const SLEW = { speed: [3, 3, 4, 4, 6, 6, 6], accel: [20, 20, 25, 25, 40, 40, 40] };
  // One step of dt (s) of the joints towards cmd within those limits: each heads for cmd as fast as it may while still
  // able to stop there, and lands on it rather than going past. state {q, v} (rad, rad/s); returns the new one.
  function slew(state, cmd, dt, lim) {
    const L = lim || SLEW, q = state.q.slice(), v = state.v.slice();
    for (let i = 0; i < q.length; i++) {
      // the fastest it may go and still stop on cmd, slowing by a·dt a step: v²/2a + v·dt/2 = |e|
      const e = cmd[i] - q[i], a = L.accel[i], ad = a * dt, stop = dt > 0 ? ad * (Math.sqrt(0.25 + (2 * Math.abs(e)) / (ad * dt)) - 0.5) : 0;
      const want = Math.sign(e) * Math.min(L.speed[i], stop);
      v[i] += Math.max(-a * dt, Math.min(a * dt, want - v[i]));
      const step = v[i] * dt;
      if (e !== 0 && Math.sign(step) === Math.sign(e) && Math.abs(step) >= Math.abs(e)) { q[i] = cmd[i]; v[i] = dt > 0 ? e / dt : 0; }
      else q[i] += step;
    }
    return { q, v };
  }

  // The parallel gripper in the hand's frame (metres), shared by the drawing (robot-gl.js) and the physics
  // (physics-core.js). Boxes are {c: centre, h: half sizes}. The jaws close along y: jaw j (+1 or -1) has its pad's face at
  // y = j·gap/2, and its finger box is given for j = +1 at gap 0 (mirror y and add j·gap/2 for the other). gapMax is the
  // widest the pads open.
  function gripper(m) {
    const fl = Math.max(0.045, (m && m.hand ? m.hand : MODEL.hand) - 0.045), z = -(0.07 + fl / 2);
    return {
      gapMax: 0.09, fl,
      body: { c: [0, 0, -0.045], h: [0.03, 0.064, 0.024] },
      finger: { c: [0, 0.009, z], h: [0.02, 0.009, fl / 2 + 0.006] },
      pad: { c: [0, 0.0015, -(0.075 + fl * 0.6)], h: [0.016, 0.002, fl * 0.36] },
    };
  }

  function model(o) {
    const m = Object.assign({}, MODEL);
    for (const k of Object.keys(MODEL)) {
      const x = Number(o && o[k]);
      if (o && o[k] != null && isFinite(x)) m[k] = clamp(x, k === 'upper' || k === 'fore' ? 0.05 : 0, 2);
    }
    return m;
  }
  const shoulderOf = (m, side) => [-m.back, side * m.half, m.up];

  // Forward kinematics: the joints' positions and the link frames, in the chest frame.
  function fk(m, side, q) {
    const sh = shoulderOf(m, side);
    const Ru = mul3(mul3(Ry(-q[0]), Rx(side * q[1])), Rz(side * q[2]));
    const elbow = add(sh, mulv(Ru, [0, 0, -m.upper]));
    const Rf = mul3(Ru, Ry(-q[3]));
    const wrist = add(elbow, mulv(Rf, [0, 0, -m.fore]));
    const R = mul3(mul3(mul3(Rf, Rz(side * q[4])), Rx(side * q[5])), Ry(q[6]));
    return { shoulder: sh, elbow, wrist, Ru, Rf, R, t: wrist };
  }

  // x + 2πk inside [lo, hi] if there is one (the one nearest ref), else the one nearest ref.
  function wrapInto(x, lo, hi, ref) {
    let best = null, bestIn = false;
    for (let k = -2; k <= 2; k++) {
      const y = x + k * TAU, inside = y >= lo - 1e-12 && y <= hi + 1e-12;
      if (best === null || (inside && !bestIn) || (inside === bestIn && Math.abs(y - ref) < Math.abs(best - ref))) { best = y; bestIn = inside; }
    }
    return best;
  }
  const excess = (q) => { let e = 0; for (let i = 0; i < 7; i++) { const j = JOINTS[i], x = Math.max(0, q[i] - j.hi, j.lo - q[i]); e += x * x; } return e; };
  // Both Euler solutions of B = Ry(a) Rx(b) Rz(c) and of A = Rz(a) Rx(b) Ry(c).
  function eulerYXZ(B) {
    const b = Math.asin(clamp(-B[5], -1, 1)), a = Math.atan2(B[2], B[8]), c = Math.atan2(B[3], B[4]);
    return [[a, b, c], [a + Math.PI, Math.PI - b, c + Math.PI]];
  }
  function eulerZXY(A) {
    const b = Math.asin(clamp(A[7], -1, 1)), a = Math.atan2(-A[1], A[4]), c = Math.atan2(-A[6], A[8]);
    return [[a, b, c], [a + Math.PI, Math.PI - b, c + Math.PI]];
  }

  // The shoulder and wrist angles once the upper arm's frame is known: of the two solutions of each, the one inside
  // the limits, then the one nearest `prev`.
  function anglesFrom(side, Ru, q4, Rhand, prev) {
    const ref = prev || HOME, pick = (sols, map, idx) => {
      let best = null, bestCost = Infinity;
      for (const s of sols) {
        const v = map(s).map((x, k) => { const J = JOINTS[idx[k]]; return wrapInto(x, J.lo, J.hi, ref[idx[k]]); });
        let cost = 0;
        for (let k = 0; k < 3; k++) {
          const J = JOINTS[idx[k]], ex = Math.max(0, v[k] - J.hi, J.lo - v[k]), d = v[k] - ref[idx[k]];
          cost += 1e3 * ex * ex + 1e-3 * d * d;
        }
        if (cost < bestCost) { bestCost = cost; best = v; }
      }
      return best;
    };
    const sh = pick(eulerYXZ(Ru), (s) => [-s[0], side * s[1], side * s[2]], [0, 1, 2]);
    const Rf = mul3(Ru, Ry(-q4));
    const wr = pick(eulerZXY(mul3(tr3(Rf), Rhand)), (s) => [side * s[0], side * s[1], s[2]], [4, 5, 6]);
    return [sh[0], sh[1], sh[2], q4, wr[0], wr[1], wr[2]];
  }

  // What the spare degree of freedom prefers, by default: elbows below the hands and out to the side, then as low as
  // they go. Weights per m² (elbow position) and rad² (limits).
  const PREFER = { low: 100, out: 100, sink: 0.01, limits: 1000, steady: 2, turn: 0.01, better: 0.2, swing: 6 * DEG };

  // Inverse kinematics for one arm. target = the wrist pose in the chest frame. The elbow lies on a circle about the
  // shoulder-wrist line, and ψ is the angle round it (0 = its lowest point). 120 angles are scored, then the best is
  // refined. `prev` is the last solution ({q, elbow}), which keeps the elbow and the joints from jumping between
  // equally good places and picks the wrist solution nearest the last one. A target out of reach puts the wrist as near as it
  // goes, on the line to it (reach false, gap = how far short, m).
  // opts: { prefer: false } keeps only the limits and steadiness (no elbow preference), or weights to override;
  // { swing: Infinity } lets the elbow go straight to the best place even with a previous solution.
  function ik(m, side, target, prev, opts) {
    const o = opts || {}, W = Object.assign({}, PREFER, o.prefer === false ? { low: 0, out: 0, sink: 0 } : o.prefer || {});
    const sh = shoulderOf(m, side), L1 = m.upper, L2 = m.fore;
    const D = sub(target.t, sh), dist = norm(D);
    const n = dist > 1e-9 ? scale(D, 1 / dist) : [0, 0, -1];
    const dmax = L1 + L2, dmin = Math.sqrt(L1 * L1 + L2 * L2 + 2 * L1 * L2 * Math.cos(JOINTS[3].hi));
    const d = clamp(dist, dmin, dmax), gap = dist - d, wrist = add(sh, scale(n, d));
    const cb = clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1), sb = Math.sqrt(1 - cb * cb);
    const q4 = Math.acos(clamp((d * d - L1 * L1 - L2 * L2) / (2 * L1 * L2), -1, 1));
    // u: down, square to the line (out to the side if the line is near vertical); v completes the circle's plane
    let u = sub([0, 0, -1], scale(n, -n[2]));
    if (norm(u) < 0.05) u = sub([0, side, 0], scale(n, n[1] * side));
    u = unit(u);
    const v = cross(n, u), prevQ = prev && prev.q, prevE = prev && prev.elbow;
    const at = (psi) => {
      const w = add(scale(u, Math.cos(psi)), scale(v, Math.sin(psi)));
      const elbow = add(sh, add(scale(n, L1 * cb), scale(w, L1 * sb)));
      const dU = add(scale(n, cb), scale(w, sb)), xU = sub(scale(n, sb), scale(w, cb)), zU = scale(dU, -1);
      const Ru = cols(xU, cross(zU, xU), zU);
      const q = anglesFrom(side, Ru, q4, target.R, prevQ);
      const low = Math.max(0, elbow[2] - wrist[2]), out = Math.max(0, -side * (elbow[1] - sh[1]));
      let cost = W.low * low * low + W.out * out * out + W.sink * (elbow[2] - sh[2]) + W.limits * excess(q);
      if (prevE) { const e = sub(elbow, prevE); cost += W.steady * dot(e, e); }
      // and the joints steady: with the arm straight (or nearly) the elbow barely moves round the circle, and the upper
      // arm's turn trades freely against the forearm's, so only this keeps them from jumping
      if (prevQ) for (let j = 0; j < 7; j++) { const e = Math.atan2(Math.sin(q[j] - prevQ[j]), Math.cos(q[j] - prevQ[j])); cost += W.turn * e * e; }
      return { q, psi, elbow, cost };
    };
    const K = 120, wrap = (x) => Math.atan2(Math.sin(x), Math.cos(x));
    let best = null;
    for (let k = 0; k < K; k++) { const s = at((k * TAU) / K - Math.PI); if (!best || s.cost < best.cost) best = s; }
    let step = TAU / K;
    // Following a previous solution, the elbow only swings a little each time (`swing`, rad): it searches near where
    // it was, and heads for a much better place elsewhere (`better`) by that much at a time instead of jumping there.
    // ψ is measured from the elbow it had (or, with the arm straight, the ψ it had).
    if (prev && prev.psi !== undefined && o.swing !== Infinity) {
      const swing = o.swing || PREFER.swing, r = L1 * sb, c = add(sh, scale(n, L1 * cb));
      let p0 = prev.psi;
      if (prevE && r > 0.01) { const e = sub(prevE, c); if (Math.abs(dot(e, u)) + Math.abs(dot(e, v)) > 0.2 * r) p0 = Math.atan2(dot(e, v), dot(e, u)); }
      let near = null;
      for (let k = -12; k <= 12; k++) { const s = at(p0 + (k * swing) / 12); if (!near || s.cost < near.cost) near = s; }
      if (best.cost < near.cost - W.better) {
        const toward = at(p0 + Math.sign(wrap(best.psi - p0)) * swing);
        best = toward.cost < near.cost ? toward : near;
        if (best === toward) return finish(best);
      } else best = near;
      step = swing / 12;
    }
    // golden-section search on the bracket round the best sample
    let a = best.psi - step, b = best.psi + step;
    const g = (Math.sqrt(5) - 1) / 2;
    let x1 = b - g * (b - a), x2 = a + g * (b - a), f1 = at(x1), f2 = at(x2);
    for (let it = 0; it < 40; it++) {
      if (f1.cost < f2.cost) { b = x2; x2 = x1; f2 = f1; x1 = b - g * (b - a); f1 = at(x1); }
      else { a = x1; x1 = x2; f1 = f2; x2 = a + g * (b - a); f2 = at(x2); }
    }
    for (const s of [f1, f2]) if (s.cost <= best.cost) best = s;
    return finish(best);
    function finish(r) { return { q: r.q, psi: wrap(r.psi), elbow: r.elbow, wrist, reach: Math.abs(gap) < 1e-9, gap, limits: Math.sqrt(excess(r.q)) }; }
  }

  // ---- putting the robot on the tags ----
  // The chest frame from its forward direction, kept upright (z up).
  function upright(f) {
    let h = [f[0], f[1], 0];
    if (norm(h) < 1e-6) h = [0, -1, 0];
    h = unit(h);
    return cols(h, cross([0, 0, 1], h), [0, 0, 1]);
  }
  const horiz = (a) => { const h = [a[0], a[1], 0], l = norm(h); return l > 1e-6 ? scale(h, 1 / l) : null; };

  // The calibration, from one moment in the start pose (arms at the sides, forearms forward, palms in).
  // input: { body: {R, t} | null, arms: [{key, pose: {R, t}, side: +1 | -1 | null}] }, poses in the plotted frame
  // (z up). opts.toward: where the camera is in that frame, if known (the robot faces it when there's no body tag).
  // With a body tag the chest follows that tag; a tag on the chest has its z out of the chest, y up and x to the
  // wearer's left, and the chest is made upright at this moment. Without one the chest stays where it is put now:
  // facing the camera (or square to the line between the two wrists), with the home wrists on the tags.
  // An arm with no side given takes the side of the chest it is on. Each arm keeps the turn from its tag to the home
  // hand, and the shift from the tag to the home wrist in the chest's frame, so a turned wrist turns the hand in place.
  function calibrate(m, input, opts) {
    const o = opts || {}, arms = (input.arms || []).filter((a) => a && a.pose);
    let chest, bodyOffset = null;
    if (input.body) {
      const Rb = input.body.R;
      let f = horiz([Rb[2], Rb[5], Rb[8]]);
      if (!f) f = horiz(scale([Rb[1], Rb[4], Rb[7]], -1)) || [0, -1, 0];
      chest = { R: upright(f), t: input.body.t.slice() };
      bodyOffset = compose(inverse(input.body), chest);
    } else {
      const mid = arms.length ? scale(arms.reduce((s, a) => add(s, a.pose.t), [0, 0, 0]), 1 / arms.length) : [0, 0, 0];
      let f = (o.toward && horiz(sub(o.toward, mid))) || [0, -1, 0];
      if (arms.length === 2) {
        const across = horiz(sub(arms[0].pose.t, arms[1].pose.t));
        if (across) { const f2 = unit(cross([0, 0, 1], across)); f = dot(f2, f) >= 0 ? f2 : scale(f2, -1); }
      }
      chest = { R: upright(f), t: [0, 0, 0] };
    }
    // sides: given, else by which side of the chest the wrist is on (two unsided arms take one side each)
    const yOf = (a) => dot(sub(a.pose.t, chest.t), [chest.R[1], chest.R[4], chest.R[7]]);
    const sides = arms.map((a) => (a.side === 1 || a.side === -1 ? a.side : null));
    const free = arms.map((a, i) => i).filter((i) => sides[i] === null);
    if (free.length === 2 && sides.every((s) => s === null)) {
      const [i, j] = free, left = yOf(arms[i]) >= yOf(arms[j]) ? i : j;
      sides[left] = 1; sides[left === i ? j : i] = -1;
    } else for (const i of free) {
      const taken = sides.find((s, k) => k !== i && s !== null);
      sides[i] = taken ? -taken : input.body ? (yOf(arms[i]) >= 0 ? 1 : -1) : -1;
    }
    if (!input.body) {
      // put the chest where the home wrists land on the tags
      let t = [0, 0, 0];
      arms.forEach((a, i) => { t = add(t, sub(a.pose.t, mulv(chest.R, fk(m, sides[i], HOME).t))); });
      chest.t = arms.length ? scale(t, 1 / arms.length) : [0, 0, 0];
    }
    return {
      chest, bodyOffset,
      arms: arms.map((a, i) => {
        const home = fk(m, sides[i], HOME), Rc = mul3(chest.R, home.R);
        const tagC = mulv(tr3(chest.R), sub(a.pose.t, chest.t));
        return { key: a.key, side: sides[i], Roff: mul3(tr3(a.pose.R), Rc), shift: sub(home.t, tagC), home: home.t };
      }),
    };
  }

  // The chest's pose now (plotted frame) and each arm's wrist target in the chest frame, from the current poses:
  // { body: pose | null, arms: { [key]: pose } }. A missing arm pose gives a null target.
  // opts.scale (teleoperation): each wrist's move from its start position, in the chest's frame, times this (1: as you
  // move; 2: twice as far; 0.5: half). The hand's orientation and the chest are never scaled.
  function targets(cal, poses, opts) {
    const chest = cal.bodyOffset && poses.body ? compose(poses.body, cal.bodyOffset) : cal.chest;
    const Rt = tr3(chest.R), k = opts && isFinite(opts.scale) ? opts.scale : 1;
    return {
      chest,
      arms: cal.arms.map((a) => {
        const p = poses.arms && poses.arms[a.key];
        if (!p) return { key: a.key, side: a.side, target: null };
        let t = add(mulv(Rt, sub(p.t, chest.t)), a.shift);
        if (k !== 1 && a.home) t = add(a.home, scale(sub(t, a.home), k));
        return { key: a.key, side: a.side, target: { R: mul3(Rt, mul3(p.R, a.Roff)), t } };
      }),
    };
  }

  // A chest-frame point in the plotted frame.
  const place = (chest, p) => add(mulv(chest.R, p), chest.t);

  // The demo's hands (index.html, demoTags): the wrist pose {R, t} in the chest frame at time t (s) for the arm on
  // `side`. It rests in the start pose (HOME) for the first 2.5 s and the last 1 s of each `cycle` seconds; between, the
  // hand eases into slow sines: 8 cm forward and back, 1 to 11 cm out, 2 to 12 cm up (tipping up 120° a metre as it
  // rises, as a wrist would) and turns of up to 12°, facing the cameras throughout. That keeps the arm clear of every
  // singularity and limit (test section 5h runs the IK along it): elbow 75° or more, wrist bend under 35°, each joint
  // 20° or more from its limits, each hand above its elbow and the elbow out from the shoulder.
  function demoPose(m, side, t, cycle) {
    const P = cycle || 18, u = ((t % P) + P) % P, ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
    const e = ease((u - 2.5) / 2) * (1 - ease((u - (P - 3)) / 2)), k = side > 0 ? 0 : 1.7, s = (w, p) => Math.sin(w * t + p + k);
    const home = fk(m, side, HOME);
    const d = [e * 0.08 * s(0.6, 0.2), side * e * (0.06 + 0.05 * s(0.75, 1.3)), e * (0.07 + 0.05 * s(0.9, 2.1))];
    const r = [e * 12 * DEG * s(0.7, 0.5), e * 12 * DEG * s(0.85, 2.4) - 120 * DEG * d[2], e * 12 * DEG * s(0.65, 1.0)];
    return { R: mul3(rodrigues(r), home.R), t: add(home.t, d) };
  }

  return { MODEL, JOINTS, HOME, PREFER, SLEW, model, gripper, slew, fk, ik, calibrate, targets, place, upright, Rx, Ry, Rz, demoPose };
});
