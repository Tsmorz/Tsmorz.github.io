// Small-step XPBD towels. Stretch/shear and compliant bending constraints follow Macklin et al. (2016):
// https://mmacklin.com/xpbd.pdf . No DOM; the same state drives the mesh and the objective checks.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./physics-core.js'));
  else root.ClothCore = factory(root.PhysicsCore);
})(typeof self !== 'undefined' ? self : this, function (P) {
  'use strict';
  const add = (a, b) => a.map((v, i) => v + b[i]), sub = (a, b) => a.map((v, i) => v - b[i]);
  const mul = (a, s) => a.map((v) => v * s), len = (a) => Math.hypot(...a);
  const mv = (R, p) => [0, 1, 2].map((i) => R[3 * i] * p[0] + R[3 * i + 1] * p[1] + R[3 * i + 2] * p[2]);
  const mt = (R, p) => [0, 1, 2].map((i) => R[i] * p[0] + R[3 + i] * p[1] + R[6 + i] * p[2]);
  const radius = 0.0025, N = 9, ITER = 5;
  function towel(spec, table) {
    const width = spec.width || 0.20, height = spec.height || 0.24, start = [], edges = [], triangles = [], pins = new Map();
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const p = [(i / (N - 1) - 0.5) * width, (j / (N - 1) - 0.5) * height, radius];
      start.push(add(table.t, mv(table.R, add(p, spec.at))));
      if (i < N - 1 && j < N - 1) { const k = j * N + i; triangles.push(k, k + 1, k + N + 1, k, k + N + 1, k + N); }
    }
    const link = (a, b, compliance) => edges.push({ a, b, rest: len(sub(start[a], start[b])), compliance, lambda: 0 });
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i;
      if (i + 1 < N) link(k, k + 1, 2e-8);
      if (j + 1 < N) link(k, k + N, 2e-8);
      if (i + 1 < N && j + 1 < N) { link(k, k + N + 1, 8e-8); link(k + 1, k + N, 8e-8); }
      if (i + 2 < N) link(k, k + 2, 0.5);
      if (j + 2 < N) link(k, k + 2 * N, 0.5);
    }
    const c = { key: spec.key, color: spec.color, label: spec.label, N, width, height, triangles, edges, pins, nodes: [], folds: new Set(), touched: new Set() };
    c.reset = () => { c.nodes = start.map((p) => ({ p: p.slice(), v: [0, 0, 0] })); pins.clear(); c.folds.clear(); c.touched.clear(); };
    c.reset();
    c.step = (dt, W) => {
      const ns = c.nodes, invM = ns.length / 0.08;
      // Both jaws must surround a patch. Closing captures it, opening releases it; no cursor-to-cloth teleport.
      for (const [side, h] of Object.entries(W.hands)) {
        const pose = W.handPose(side), pin = pins.get(side), gap = h.gap;
        if (pin && (h.target > gap + 0.002 || h.target > 0.025)) { pins.delete(side); continue; }
        if (!pin && !h.grip && h.target < 0.012 && !W.cloths.some((q) => q !== c && q.pins.has(side))) {
          let best = null;
          for (const cloth of W.cloths) cloth.nodes.forEach((n, i) => {
            if ([...cloth.pins.values()].some((p) => p.i === i)) return;
            const p = mt(pose.R, sub(n.p, pose.t));
            if (Math.abs(p[0]) < 0.022 && Math.abs(p[1]) < Math.max(0.012, gap / 2) && p[2] < -0.055 && p[2] > -0.13) {
              const d = Math.hypot(p[0], p[1], p[2] + 0.0925); if (!best || d < best.d) best = { i, local: p, d, cloth };
            }
          });
          if (best && best.cloth === c) { pins.set(side, { i: best.i, local: best.local }); c.touched.add(+side); }
        }
      }
      for (const side of [...pins.keys()]) if (!W.hands[side]) pins.delete(side);
      const pinned = new Map([...pins].map(([s, p]) => [p.i, add(W.handPose(s).t, mv(W.handPose(s).R, p.local))]));
      const old = ns.map((n) => n.p.slice()), hits = new Set(), tablePush = new Map();
      ns.forEach((n) => { n.v[2] -= 9.81 * dt; n.p = add(n.p, mul(n.v, dt)); });
      for (const e of edges) e.lambda = 0;
      const collide = (n, i) => {
        if (W.tableBox) {
          const k = P.sphereBox(n.p, radius, W.tableBox, W.tableBox.h);
          if (k.dist < 0) {
            n.p = add(n.p, mul(k.n, -k.dist)); hits.add(i);
            if (mt(table.R, k.n)[2] > 0.9) tablePush.set(i, (tablePush.get(i) || 0) - k.dist);
          }
        }
        if (n.p[2] < W.floorZ + radius) { n.p[2] = W.floorZ + radius; hits.add(i); }
        for (const b of W.bodies) {
          if (len(sub(n.p, b.t)) > b.bound + radius) continue;
          const p = sub(mt(b.R, sub(n.p, b.t)), b.off);
          const d = b.sdf ? P.bodyDistance(b, p) - radius : len(p) - P.BALL.r - radius;
          if (d < 0) {
            const normal = mv(b.R, b.sdf ? P.bodyNormal(b, p) : mul(p, 1 / (len(p) || 1)));
            n.p = add(n.p, mul(normal, -d)); hits.add(i);
          }
        }
      };
      for (let it = 0; it < ITER; it++) {
        for (const e of edges) {
          const a = ns[e.a], b = ns[e.b], d = sub(a.p, b.p), L = len(d);
          if (L < 1e-9) continue;
          const wa = pinned.has(e.a) ? 0 : invM, wb = pinned.has(e.b) ? 0 : invM, alpha = e.compliance / (dt * dt);
          const dl = (-(L - e.rest) - alpha * e.lambda) / (wa + wb + alpha); e.lambda += dl;
          a.p = add(a.p, mul(d, wa * dl / L)); b.p = add(b.p, mul(d, -wb * dl / L));
        }
        for (const [i, p] of pinned) ns[i].p = p.slice();
        ns.forEach(collide);
      }
      // Coulomb friction is a position constraint too: damping velocity alone lets stretch constraints drag the
      // resting half of a towel sideways through a fold. Limit the correction by the normal contact impulse.
      for (const [i, normal] of tablePush) if (!pinned.has(i)) {
        const delta = mt(table.R, sub(ns[i].p, old[i])), L = Math.hypot(delta[0], delta[1]);
        if (L > 1e-10) { const s = Math.min(1, 0.75 * normal / L); ns[i].p = sub(ns[i].p, mv(table.R, [delta[0] * s, delta[1] * s, 0])); }
      }
      // Spatial hash for self-contact and contact with the other towels (neighbouring mesh vertices excluded).
      const cell = radius * 2, hash = new Map(), hashKey = (x, y, z) => (x & 1023) | ((y & 1023) << 10) | ((z & 1023) << 20);
      for (const q of W.cloths) for (let j = 0; j < q.nodes.length; j++) {
        if (q === c) continue;
        const p = q.nodes[j].p, key = hashKey(Math.floor(p[0] / cell), Math.floor(p[1] / cell), Math.floor(p[2] / cell));
        if (!hash.has(key)) hash.set(key, []); hash.get(key).push({ p, j, other: true });
      }
      ns.forEach((n, i) => {
        const xyz = n.p.map((v) => Math.floor(v / cell));
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let d = -1; d <= 1; d++) {
          const key = hashKey(xyz[0] + a, xyz[1] + b, xyz[2] + d);
          for (const q of hash.get(key) || []) {
            if (!q.other && Math.abs(i % N - q.j % N) <= 1 && Math.abs(Math.floor(i / N) - Math.floor(q.j / N)) <= 1) continue;
            const delta = sub(n.p, q.p), L = len(delta);
            if (L > 1e-8 && L < cell && !pinned.has(i)) { n.p = add(n.p, mul(delta, (cell - L) / L)); hits.add(i); }
          }
        }
        const key = hashKey(...xyz); if (!hash.has(key)) hash.set(key, []); hash.get(key).push({ p: n.p, j: i, other: false });
        collide(n, i);
        n.v = mul(sub(n.p, old[i]), 0.997 / dt);
        // Contact friction removes tangential drift, without damping a towel falling freely.
        if (hits.has(i)) { const v = mt(table.R, n.v); v[0] *= 0.82; v[1] *= 0.82; n.v = mv(table.R, v); }
        const speed = len(n.v); if (speed > 2) n.v = mul(n.v, 2 / speed);
      });
      if (ns.every((n) => n.p[2] < table.t[2] - 0.15) && pins.size === 0) { c.reset(); W.respawns++; }
    };
    return c;
  }
  // Opposite edges must overlap along their whole length. A crumpled bundle cannot pass as a folded towel.
  function folded(c) {
    const ns = c.nodes, N = c.N, mean = (pairs) => pairs.reduce((s, [a, b]) => s + len(sub(ns[a].p, ns[b].p)), 0) / pairs.length;
    const x = mean(Array.from({ length: N }, (_, j) => [j * N, j * N + N - 1]));
    const y = mean(Array.from({ length: N }, (_, i) => [i, (N - 1) * N + i]));
    const flat = [0, 1, 2].map((i) => Math.max(...ns.map((n) => n.p[i])) - Math.min(...ns.map((n) => n.p[i])));
    return { x: x < 0.035, y: y < 0.035, compact: flat[2] < 0.045, edges: [x, y] };
  }
  return { towel, folded, radius, N };
});
