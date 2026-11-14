// RobotGL: draws the tag tracker's robot with WebGL: smooth curved shells, lit by a key light, a fill light and the sky,
// with specular highlights and a rim, two-tone panels and violet lights: an engineering robot of brushed aluminium box
// sections and motor drums, a generic design modelled on no one's robot.
//
// The meshes are built here from the robot's lengths (RobotCore.model), each in the frame it rides in: the chest's, or an
// arm's upper-arm, forearm or hand frame (RobotCore.fk), so a frame only needs its pose to be drawn. The camera is the 3D
// plot's own (TagCore.orbit), so the robot lines up exactly with the grid and the cameras drawn on the 2D canvas under it.
// meshes() has no DOM, so script/test-tag-tracker checks it in Node; create() needs a canvas.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./tracker-core.js'), require('./robot-core.js'), require('./character-core.js'));
  else root.RobotGL = factory(root.TagCore, root.RobotCore, root.CharacterCore);
})(typeof self !== 'undefined' ? self : this, function (C, RC, Character) {
  'use strict';
  const TAU = 2 * Math.PI;
  // signed power, for superellipses. sin(π) is ~1e-16, not 0, and a small power of that is not small (to the 0.06 the
  // table's top uses it is 0.11), which split the shape open at its seam: values that should be 0 are 0.
  const sp = (w, e) => (Math.abs(w) < 1e-9 ? 0 : Math.sign(w) * Math.pow(Math.abs(w), e));
  const cap = (x, k) => { const d = 1 - Math.min(1, Math.max(0, x) / k); return Math.sqrt(Math.max(0, 1 - d * d)); }; // a quarter circle
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : null; };

  // ---- meshes ----
  // A parametric surface: fn(u, v) for u, v in [0, 1] gives a point; nu × nv quads. Normals come from the surface's
  // derivatives, turned to face out(p) (roughly outward), which also stands in where the derivatives vanish (a pole).
  function surface(fn, nu, nv, out) {
    const n = (nu + 1) * (nv + 1), pos = new Float32Array(3 * n), nrm = new Float32Array(3 * n), idx = new Uint16Array(6 * nu * nv);
    const e = 1e-4;
    let k = 0;
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++, k++) {
      const u = i / nu, v = j / nv, p = fn(u, v);
      const du = sub(fn(Math.min(1, u + e), v), fn(Math.max(0, u - e), v)), dv = sub(fn(u, Math.min(1, v + e)), fn(u, Math.max(0, v - e)));
      const o = out(p);
      let nn = unit(cross(du, dv)) || unit(o) || [0, 0, 1];
      if (dot(nn, o) < 0) nn = [-nn[0], -nn[1], -nn[2]];
      pos.set(p, 3 * k); nrm.set(nn, 3 * k);
    }
    k = 0;
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      idx.set([a, b, d, a, d, c], k); k += 6;
    }
    return { pos, nrm, idx };
  }
  // A rounded box or blob: half sizes a, exponents e1 (top to bottom) and e2 (round it); below 1 is squarer. u and v may
  // be limited to part of it (for a visor or a dome): angles from θ0 to θ1 round z (0 = +x), φ0 to φ1 up from the middle.
  function blob(c, a, e1, e2, o) {
    const r = Object.assign({ t0: -Math.PI, t1: Math.PI, p0: -Math.PI / 2, p1: Math.PI / 2, nu: 40, nv: 24, s: 1 }, o || {});
    return surface((u, v) => {
      const th = r.t0 + (r.t1 - r.t0) * u, ph = r.p0 + (r.p1 - r.p0) * v, cp = sp(Math.cos(ph), e1);
      return [c[0] + r.s * a[0] * cp * sp(Math.cos(th), e2), c[1] + r.s * a[1] * cp * sp(Math.sin(th), e2), c[2] + r.s * a[2] * sp(Math.sin(ph), e1)];
    }, r.nu, r.nv, (p) => sub(p, c));
  }
  // A surface of revolution about the z axis (or the y axis), through `at`, from z0 to z1, with radius r(s), s in [0, 1]
  // along it. The ends round off over `k` of its length, so it closes.
  function lathe(at, z0, z1, r, o) {
    const q = Object.assign({ k0: 0.15, k1: 0.15, nu: 32, nv: 28, axis: 'z' }, o || {});
    const map = q.axis === 'y' ? (x, y, z) => [at[0] + x, at[1] + z, at[2] - y] : (x, y, z) => [at[0] + x, at[1] + y, at[2] + z];
    const zl = Math.min(z0, z1), zh = Math.max(z0, z1);
    return surface((u, v) => {
      const th = TAU * u, rr = r(v) * cap(v, q.k0) * cap(1 - v, q.k1), z = z0 + (z1 - z0) * v;
      return map(rr * Math.cos(th), rr * Math.sin(th), z);
    }, q.nu, q.nv, (p) => {
      const l = sub(p, at), ax = q.axis === 'y' ? l[1] : l[2], m = Math.min(zh, Math.max(zl, ax)) * 0.85;
      return q.axis === 'y' ? [l[0], ax - m, l[2]] : [l[0], l[1], ax - m];
    });
  }
  function torus(c, R, r, o) {
    const q = Object.assign({ nu: 40, nv: 12 }, o || {});
    return surface((u, v) => { const a = TAU * u, b = TAU * v, w = R + r * Math.cos(b); return [c[0] + w * Math.cos(a), c[1] + w * Math.sin(a), c[2] + r * Math.sin(b)]; },
      q.nu, q.nv, (p) => { const d = sub(p, c), l = Math.hypot(d[0], d[1]) || 1; return [d[0] - (R * d[0]) / l, d[1] - (R * d[1]) / l, d[2]]; });
  }
  const part = (mesh, mat, extra) => Object.assign({ mesh, mat }, extra || {});

  // ---- the robot ----
  // Its groups of meshes, each in the frame it rides in: body (the chest's frame), bar and mount
  // (the chest's, for two arms or one without a body), upper (the upper arm's: origin at the shoulder, the arm along -z),
  // fore and foreLight (the forearm's: origin at the elbow), hand (the hand's: origin at the wrist, fingers along -z, the
  // back of the hand +x), finger[j] (jaw j = ±1, in the hand's frame shifted j·jaw/2 along y, the way the jaws close: see
  // RobotCore.gripper), and extent: chest-frame points the view fits round. The chest tag sits
  // at the chest's origin, so the body's front passes just behind it.
  function bars(m, out) {
    out.bar = [
      part(lathe([-m.back, 0, m.up], -m.half, m.half, () => 0.03, { axis: 'y', k0: 0.05, k1: 0.05 }), 'dark'),
      part(blob([-m.back, 0, m.up], [0.065, 0.065, 0.065], 0.9, 0.9), 'shell'),
      part(torus([-m.back, 0, m.up - 0.01], 0.064, 0.006), 'light'),
    ];
    out.mount = {};
    for (const sd of [1, -1]) out.mount[sd] = [
      part(lathe([-m.back, 0, m.up], sd * m.half, sd * (m.half - 0.14), () => 0.03, { axis: 'y', k0: 0.05, k1: 0.05 }), 'dark'),
      part(blob([-m.back, sd * (m.half - 0.15), m.up], [0.07, 0.025, 0.07], 0.9, 0.6), 'shell'),
      part(blob([-m.back, sd * (m.half - 0.15), m.up], [0.05, 0.03, 0.05], 0.9, 0.9, { nu: 24, nv: 12 }), 'light'),
    ];
  }

  // Machine: an engineering robot. Brushed aluminium box sections, motor drums on the joint axes, a battery on its
  // back, a sensor bar for a head with two lenses, a parallel gripper, on a column and a foot.
  function machine(m) {
    const out = {}, cx = -0.075, wy = Math.max(0.09, m.half - 0.055), zc = m.up - 0.1, z0 = m.up - 0.3, hz = m.up + 0.17, hx = -m.back + 0.01;
    out.body = [
      part(blob([cx, 0, zc], [0.072, wy, 0.15], 0.2, 0.22, { nu: 48, nv: 32 }), 'metal'),
      part(blob([cx + 0.062, 0, zc + 0.01], [0.014, wy * 0.8, 0.115], 0.18, 0.18, { nu: 40, nv: 24 }), 'dark'),
      part(blob([cx + 0.077, 0, -0.088], [0.004, 0.05, 0.005], 0.5, 0.3, { nu: 20, nv: 8 }), 'light'),
      part(blob([cx + 0.077, 0, zc - 0.11], [0.004, 0.008, 0.008], 1, 1, { nu: 12, nv: 8 }), 'light'),
      part(blob([cx - 0.088, 0, zc + 0.01], [0.028, wy * 0.62, 0.11], 0.25, 0.25), 'dark'),
      part(blob([cx - 0.118, 0, zc + 0.01], [0.004, wy * 0.4, 0.004], 0.5, 0.3, { nu: 16, nv: 6 }), 'light'),
      part(lathe([cx, 0, 0], z0 + 0.02, zc - 0.13, () => 0.04, { k0: 0.08, k1: 0.08 }), 'dark'),
      part(torus([cx, 0, (z0 + zc - 0.11) / 2], 0.043, 0.004), 'light'),
      part(blob([cx, 0, z0 - 0.03], [0.07, 0.12, 0.045], 0.22, 0.25), 'metal'),
      part(lathe([cx, 0, z0 - 0.03], 0.095, 0.15, () => 0.034, { axis: 'y', k0: 0.12, k1: 0.12 }), 'dark'),
      part(lathe([cx, 0, z0 - 0.03], -0.095, -0.15, () => 0.034, { axis: 'y', k0: 0.12, k1: 0.12 }), 'dark'),
      part(lathe([cx, 0, 0], z0 - 0.07, z0 - 0.26, (s) => 0.028 + 0.004 * s, { k0: 0.05, k1: 0.05 }), 'dark'),
      part(blob([cx, 0, z0 - 0.27], [0.11, 0.11, 0.016], 1, 0.6, { nu: 40, nv: 12 }), 'metal'),
      part(torus([cx, 0, z0 - 0.268], 0.104, 0.004), 'light'),
      part(lathe([hx, 0, 0], m.up + 0.04, m.up + 0.11, () => 0.03, { k0: 0.1, k1: 0.1 }), 'dark'),
      part(blob([hx, 0, m.up + 0.11], [0.045, 0.045, 0.012], 1, 0.7, { nu: 28, nv: 10 }), 'metal'),
      part(blob([hx + 0.01, 0, hz], [0.058, 0.105, 0.045], 0.22, 0.22, { nu: 40, nv: 24 }), 'metal'),
      part(blob([hx + 0.065, 0, hz], [0.006, 0.09, 0.025], 0.25, 0.2, { nu: 32, nv: 12 }), 'glass'),
      part(blob([hx + 0.071, 0.048, hz], [0.008, 0.018, 0.018], 1, 1, { nu: 20, nv: 12 }), 'glass'),
      part(blob([hx + 0.071, -0.048, hz], [0.008, 0.018, 0.018], 1, 1, { nu: 20, nv: 12 }), 'glass'),
      part(blob([hx + 0.078, 0.048, hz], [0.002, 0.006, 0.006], 1, 1, { nu: 12, nv: 8 }), 'light'),
      part(blob([hx + 0.078, -0.048, hz], [0.002, 0.006, 0.006], 1, 1, { nu: 12, nv: 8 }), 'light'),
      part(blob([hx - 0.03, 0.085, hz + 0.05], [0.004, 0.004, 0.035], 1, 1, { nu: 10, nv: 10 }), 'dark'),
    ];
    out.head = out.body.splice(16); // sensor bar pivots at its centre; neck and torso stay in the chest frame
    bars(m, out);
    const L1 = m.upper, L2 = m.fore, G = RC.gripper(m);
    out.upper = [
      part(lathe([0, 0, 0], -0.055, 0.055, () => 0.052, { axis: 'y', k0: 0.06, k1: 0.06, nu: 36 }), 'dark'),
      part(blob([0, 0, -L1 / 2], [0.036, 0.03, L1 / 2 - 0.035], 0.15, 0.3, { nu: 32, nv: 24 }), 'metal'),
      part(blob([0.038, 0, -L1 / 2], [0.004, 0.012, L1 / 2 - 0.06], 0.5, 0.5, { nu: 12, nv: 12 }), 'dark'),
      part(lathe([0, 0, -L1], -0.05, 0.05, () => 0.045, { axis: 'y', k0: 0.06, k1: 0.06, nu: 36 }), 'dark'),
    ];
    out.fore = [
      part(blob([0, 0, -L2 / 2], [0.03, 0.027, L2 / 2 - 0.035], 0.15, 0.3, { nu: 32, nv: 24 }), 'metal'),
      part(lathe([0, 0, 0], -(L2 - 0.065), -(L2 - 0.004), (s) => 0.034 - 0.004 * s, { k0: 0.12, k1: 0.15 }), 'dark'),
    ];
    out.foreLight = [part(torus([0, 0, -(L2 - 0.06)], 0.035, 0.004, { nu: 36, nv: 8 }), 'light')];
    // the gripper: a body across the jaws' travel with a rail under it, a light on the back of the hand
    const gb = G.body, rail = gb.c[2] - gb.h[2];
    out.hand = {};
    for (const sd of [1, -1]) out.hand[sd] = [
      part(lathe([0, 0, 0], 0.004, -0.022, () => 0.034, { k0: 0.1, k1: 0.1 }), 'dark'),
      part(blob(gb.c, gb.h, 0.2, 0.2), 'metal'),
      part(blob([0, 0, rail], [0.012, gb.h[1] - 0.006, 0.003], 0.4, 0.3, { nu: 24, nv: 8 }), 'dark'),
      part(blob([gb.h[0] + 0.001, 0, gb.c[2]], [0.003, 0.016, 0.012], 1, 1, { nu: 20, nv: 6 }), 'light'),
    ];
    const mir = (c, j) => [c[0], j * c[1], c[2]];
    out.finger = {};
    for (const j of [1, -1]) out.finger[j] = [
      part(blob(mir(G.finger.c, j), G.finger.h, 0.2, 0.2, { nu: 20, nv: 16 }), 'dark'),
      part(blob(mir(G.pad.c, j), G.pad.h, 0.3, 0.3, { nu: 12, nv: 8 }), 'shell'),
    ];
    out.extent = [[cx, wy, zc + 0.15], [cx, -wy, zc + 0.15], [hx, 0, hz + 0.09], [cx, 0.11, z0 - 0.29], [cx, -0.11, z0 - 0.29], [0, 0, 0]];
    return out;
  }

  // ---- the table and what's on it (physics-core.js) ----
  // d: { table: {size: [x, y], thick, legs: how far down they go}, ball: {r}, cup: {R, Ri (inside), H, floor (inside, up
  // from its base), handle: {x, z, a, b} (physics-core.js CUP.handle)} }. Each in its own frame: the table's at the middle of its top (z up), the ball's at its centre, the
  // cup's at the middle of its base. The ball is two-tone so it shows rolling; the cup has a band in the ball's blue.
  function propMeshes(d) {
    const T = d.table, lx = T.size[0] / 2, ly = T.size[1] / 2, th = T.thick, out = {};
    out.table = [part(blob([0, 0, -th / 2], [lx, ly, th / 2], 0.1, 0.06, { nu: 64, nv: 16 }), 'top')];
    for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) out.table.push(part(lathe([sx * (lx - 0.05), sy * (ly - 0.05), 0], -th, -T.legs, () => 0.014, { k0: 0.01, k1: 0.01, nu: 16, nv: 60 }), 'dark'));
    const r = d.ball.r;
    out.ball = [
      part(blob([0, 0, 0], [r, r, r], 1, 1, { p0: 0, nu: 32, nv: 12 }), 'ball'),
      part(blob([0, 0, 0], [r, r, r], 1, 1, { p1: 0, nu: 32, nv: 12 }), 'ballB'),
    ];
    const c = d.cup, lip = (c.R - c.Ri) / 2;
    const ring = (rad, z0, z1, inward) => surface((u, v) => [rad * Math.cos(TAU * u), rad * Math.sin(TAU * u), z0 + (z1 - z0) * v], 48, 6, (p) => (inward ? [-p[0], -p[1], 0] : [p[0], p[1], 0]));
    const disc = (rad, z, up) => surface((u, v) => [rad * v * Math.cos(TAU * u), rad * v * Math.sin(TAU * u), z], 48, 4, () => [0, 0, up ? 1 : -1]);
    out.cup = [
      part(ring(c.R, 0, c.H - lip, false), 'ceramic'),
      part(ring(c.Ri, c.floor, c.H - lip, true), 'ceramic'),
      part(torus([0, 0, c.H - lip], c.Ri + lip, lip, { nu: 48, nv: 10 }), 'ceramic'),
      part(disc(c.R, 0, false), 'ceramic'),
      part(disc(c.Ri, c.floor, true), 'ceramic'),
      part(ring(c.R + 0.0004, c.H * 0.55, c.H * 0.68, false), 'ball'),
    ];
    // the handle: half a torus round (x, 0, z) in the x-z plane, on the +x side
    if (c.handle) {
      const h = c.handle;
      out.cup.push(part(surface((u, v) => {
        const th = -Math.PI / 2 + Math.PI * u, ph = TAU * v, w = h.a + h.b * Math.cos(ph);
        return [h.x + w * Math.cos(th), h.b * Math.sin(ph), h.z + w * Math.sin(th)];
      }, 24, 12, (p) => { const dx = p[0] - h.x, dz = p[2] - h.z, l = Math.hypot(dx, dz) || 1; return [dx - (h.a * dx) / l, p[1], dz - (h.a * dz) / l]; }), 'ceramic'));
    }
    // a soft shadow: a disc of radius 1, drawn a few times, wider and fainter
    out.shadow = surface((u, v) => [v * Math.cos(TAU * u), v * Math.sin(TAU * u), 0], 32, 1, () => [0, 0, 1]);
    return out;
  }

  // A six-patch rounded cuboid stays within its collision box, with clustered samples on the bevel.
  function beveledBox(h,r){
    const axis=(u,h)=>u<.25?-h+r*(1-Math.cos(u*2*Math.PI)):u>.75?-axis(1-u,h):(u-.25)*4*(h-r)-(h-r),out=[];
    for(let a=0;a<3;a++)for(const sign of [-1,1]){
      const b=(a+1)%3,c=(a+2)%3;
      out.push(surface((u,v)=>{const p=[0,0,0];p[a]=sign*h[a];p[b]=axis(u,h[b]);p[c]=axis(v,h[c]);const core=p.map((x,i)=>Math.max(-h[i]+r,Math.min(h[i]-r,x))),d=sub(p,core),len=Math.hypot(...d);return core.map((x,i)=>x+d[i]*r/len);},16,16,p=>p));
    }
    return out;
  }
  function compoundMeshes(pieces) {
    const result = [];
    for (const s of pieces) {
      const R = s.R || [1, 0, 0, 0, 1, 0, 0, 0, 1], p = s.p || [0, 0, 0];
      const meshes = [];
      if(s.type==='ellipsoid'){meshes.push(blob([0,0,0],s.r,1,1,{nu:24,nv:16}));}
      else if (s.type === 'cylinder') {
        meshes.push(surface((u, v) => [s.r * Math.cos(TAU * u), s.r * Math.sin(TAU * u), (v * 2 - 1) * s.h], 32, 2, (p) => [p[0], p[1], 0]));
        for (const sign of [-1, 1]) meshes.push(surface((u, v) => [s.r * v * Math.cos(TAU * u), s.r * v * Math.sin(TAU * u), sign * s.h], 32, 2, () => [0, 0, sign]));
      } else meshes.push(...beveledBox(s.h,s.bevel===0?.00001:Math.min(s.bevel||.009,...s.h.map(h=>h*(s.bevel?.95:.28)))));
      for (const m of meshes) {
        for (let i = 0; i < m.pos.length; i += 3) { m.pos.set(C.add(C.mulv(R, [...m.pos.slice(i, i + 3)]), p), i); m.nrm.set(C.mulv(R, [...m.nrm.slice(i, i + 3)]), i); }
        result.push(part(m, 'ceramic'));
      }
    }
    return result;
  }
  function clothMesh(c) {
    const pos = new Float32Array(c.nodes.flatMap((n) => n.p)), nrm = new Float32Array(pos.length), idx = new Uint16Array(c.triangles);
    for (let i = 0; i < idx.length; i += 3) {
      const [a, b, d] = [...idx.slice(i, i + 3)], n = cross(sub(c.nodes[b].p, c.nodes[a].p), sub(c.nodes[d].p, c.nodes[a].p));
      for (const k of [a, b, d]) for (let j = 0; j < 3; j++) nrm[k * 3 + j] += n[j];
    }
    for (let i = 0; i < nrm.length; i += 3) nrm.set(unit([...nrm.slice(i, i + 3)]) || [0, 0, 1], i);
    return { pos, nrm, idx };
  }

  // Every mesh of the robot for the lengths m.
  function meshes(m) {
    const out = machine(m);
    // a tag, 1 unit across, facing +z: white margin, a border in the tag's colour, black inside, a few white cells
    const sq = (h, z) => surface((u, v) => [(u - 0.5) * 2 * h, (v - 0.5) * 2 * h, z], 1, 1, () => [0, 0, 1]);
    const cells = [[-0.18, 0.18], [0.06, 0.18], [0.18, -0.06], [-0.06, -0.18], [0.18, 0.18], [-0.18, -0.06]];
    out.tag = { paper: sq(0.5, 0), border: sq(0.46, 0.02), ink: sq(0.36, 0.04), cells: cells.map(([x, y]) => surface((u, v) => [x + (u - 0.5) * 0.12, y + (v - 0.5) * 0.12, 0.06], 1, 1, () => [0, 0, 1])) };
    return out;
  }

  // A clothed, stylised teenage helper uses the same FK and contact poses as the robot. Geometry stays local.
  function actorMeshes(m) {
    const b=(p,r,mat)=>part(blob(p,r,0.7,0.8,{nu:24,nv:16}),mat), hz=m.up+.17, hx=-m.back+.02;
    const amr=[b([-.065,0,.115],[.18,.19,.055],'metal'),b([-.065,0,.17],[.145,.16,.018],'dark'),b([-.075,0,.35],[.027,.027,.21],'metal'),b([.112,0,.12],[.004,.105,.009],'light')];
    const wheel=[b([0,0,0],[.07,.025,.07],'dark'),b([0,.026,0],[.045,.004,.045],'metal'),b([0,.031,0],[.04,.005,.006],'dark')];
    return {amr,wheel};
  }

  // ---- drawing ----
  const VS = `attribute vec3 aPos; attribute vec3 aNrm; attribute vec2 aUV;
uniform mat4 uPV,uModel,uLightPV; uniform mat3 uRot; varying vec3 vN,vW; varying vec4 vShadow; varying vec2 vUV;
void main(){vec4 w=uModel*vec4(aPos,1.0);vW=w.xyz;vN=uRot*aNrm;vUV=aUV;vShadow=uLightPV*w;gl_Position=uPV*w;}`;
  const FS = `#extension GL_OES_standard_derivatives : enable
precision highp float;
varying vec3 vN,vW;varying vec4 vShadow;varying vec2 vUV;
uniform vec3 uEye,uKey,uFill,uBase,uRimCol,uFadeTo,uSky,uGround;
uniform float uSpec,uShine,uRim,uEmit,uFade,uAlpha,uShadowOn,uSurface;uniform sampler2D uShadow,uColorTex,uNormalTex,uRoughTex;uniform float uTextured;
float noise(vec3 p){return fract(sin(dot(floor(p),vec3(12.9898,78.233,37.719)))*43758.5453);}
float depth(vec2 p){return dot(texture2D(uShadow,p),vec4(1.0/16777216.0,1.0/65536.0,1.0/256.0,1.0))*(255.0/256.0);}
float shade(vec3 N){if(uShadowOn<0.5)return 1.0;vec3 q=vShadow.xyz/vShadow.w*.5+.5;if(q.x<0.0||q.x>1.0||q.y<0.0||q.y>1.0||q.z>1.0)return 1.0;
 float a=0.0,bias=max(.0008,.0018*(1.0-dot(N,uKey)));for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++)a+=step(q.z-bias,depth(q.xy+vec2(float(x),float(y))*2.0/2048.0));return .22+.78*a/9.0;}
vec3 aces(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.0,1.0);}
void main(){vec3 N=normalize(vN),V=normalize(uEye-vW);if(dot(N,V)<0.0)N=-N;vec3 base=uBase;
 if(uTextured>.5){base*=pow(texture2D(uColorTex,vUV).rgb,vec3(2.2));vec3 dp1=dFdx(vW),dp2=dFdy(vW),dp2p=cross(dp2,N),dp1p=cross(N,dp1);vec2 dt1=dFdx(vUV),dt2=dFdy(vUV);vec3 T=dp2p*dt1.x+dp1p*dt2.x,B=dp2p*dt1.y+dp1p*dt2.y;float scale=inversesqrt(max(max(dot(T,T),dot(B,B)),.00001));vec3 mapped=normalize(mix(vec3(0,0,1),texture2D(uNormalTex,vUV).xyz*2.0-1.0,.55));N=normalize(mat3(T*scale,B*scale,N)*mapped);}

 if((uSurface>.5&&uSurface<1.5)||uSurface>3.5){float grain=sin(vW.x*210.0+sin(vW.y*19.0)*2.0)+.35*sin(vW.x*487.0+sin(vW.y*29.0));base*=.95+.025*grain;
 if(uSurface>3.5&&abs(N.z)>.8){float row=floor(vW.y*6.0),fy=fract(vW.y*6.0),fx=fract(vW.x*1.35+row*.37),seam=min(min(fy,1.0-fy),min(fx,1.0-fx));base*=.96+.07*noise(vec3(row,0,0));base*=mix(.72,1.0,smoothstep(.0,max(.005,fwidth(seam)*1.2),seam));}}


 float nl=max(dot(N,uKey),0.0),nv=max(dot(N,V),.001),sh=shade(N);vec3 H=normalize(uKey+V);float nh=max(dot(N,H),0.0),vh=max(dot(V,H),0.0);
 float rough=uTextured>.5?clamp(texture2D(uRoughTex,vUV).g,.3,.95):clamp(sqrt(2.0/(uShine+2.0)),.12,.95),a=rough*rough,a2=a*a,den=nh*nh*(a2-1.0)+1.0,D=a2/(3.14159265*den*den+.0001),k=(rough+1.0)*(rough+1.0)/8.0,G=nv/(nv*(1.0-k)+k)*nl/(nl*(1.0-k)+k);
 vec3 F=mix(vec3(.035),vec3(.25),clamp(uSpec*.25,0.0,.6));F=F+(1.0-F)*pow(1.0-vh,5.0);vec3 spec=D*G*F/(4.0*nv*max(nl,.001));
 float hemi=.5+.5*N.z;vec3 ambient=mix(uGround,uSky,hemi);float fill=max(dot(N,uFill),0.0);
 vec3 col=base*(ambient+vec3(1.0,.88,.72)*nl*sh*1.35+vec3(.52,.63,.78)*fill*.22)+spec*nl*sh*min(1.0,uSpec)*.75;
 col=mix(col,base*1.8,uEmit);col=mix(col,uFadeTo,uFade);col=aces(col*1.15);gl_FragColor=vec4(pow(col,vec3(1.0/2.2))*uAlpha,uAlpha);}`;
  const DEPTH_VS=`attribute vec3 aPos;uniform mat4 uPV,uModel;void main(){gl_Position=uPV*uModel*vec4(aPos,1.0);}`;
  const DEPTH_FS=`precision highp float;void main(){vec4 d=fract(gl_FragCoord.z*vec4(16777216.0,65536.0,256.0,1.0));d-=d.xxyz*vec4(0.0,1.0/256.0,1.0/256.0,1.0/256.0);gl_FragColor=d*(256.0/255.0);}`;
  // sRGB hex (#rgb or #rrggbb) to linear RGB
  function lin(hex, dflt) {
    let h = String(hex || '').trim().replace('#', '');
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    if (!/^[0-9a-f]{6}$/i.test(h)) return dflt || [0.5, 0.5, 0.5];
    return [0, 2, 4].map((i) => Math.pow(parseInt(h.slice(i, i + 2), 16) / 255, 2.2));
  }
  // the materials ('light' is the violet glow)
  const MATS = {
    metal: { base: lin('#a9b1ba'), spec: 0.9, shine: 110, rim: 0.9 },
    dark: { base: lin('#24282e'), spec: 0.55, shine: 60, rim: 1 },
    glass: { base: lin('#07080c'), spec: 1.3, shine: 220, rim: 1.4 },
    shell: { base: lin('#c9ced4'), spec: 0.3, shine: 30, rim: 0.8 },
    top: { base: lin('#6b737c'), spec: 0.25, shine: 24, rim: 0.5 },
    ball: { base: lin('#2a78d6'), spec: 0.7, shine: 80, rim: 0.6 },
    ballB: { base: lin('#e9eef5'), spec: 0.7, shine: 80, rim: 0.6 },
    skin: {base:lin('#c89978'),spec:.1,shine:12,rim:.35}, shirt:{base:lin('#547d91'),spec:.12,shine:12,rim:.3}, denim:{base:lin('#33455c'),spec:.1,shine:10,rim:.3}, hair:{base:lin('#382e2b'),spec:.16,shine:14,rim:.3}, shoe:{base:lin('#353b44'),spec:.15,shine:18,rim:.3},
    floor:{base:lin('#966d49'),spec:.28,shine:45,rim:0},
    wood:{base:lin('#805638'),spec:.18,shine:24,rim:0},plaster:{base:lin('#e2d4b9'),spec:.08,shine:8,rim:0},fabric:{base:[1,1,1],spec:.08,shine:6,rim:0},rug:{base:lin('#706452'),spec:.03,shine:4,rim:0},
    ceramic: { base: lin('#ece8e1'), spec: 0.6, shine: 90, rim: 0.6 },
  };
  // the model matrix of a pose {R row-major, t}, scaled by s; and its rotation for the normals (column-major)
  function model4(p, s) {
    const R = p.R, k = s || 1;
    return new Float32Array([R[0] * k, R[3] * k, R[6] * k, 0, R[1] * k, R[4] * k, R[7] * k, 0, R[2] * k, R[5] * k, R[8] * k, 0, p.t[0], p.t[1], p.t[2], 1]);
  }
  const rot3 = (R) => new Float32Array([R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]]);

  function create(canvas) {
    const gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: true, depth: true });
    if (!gl) return null;
    gl.getExtension('OES_standard_derivatives');
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    const U = {};
    for (const n of ['uPV', 'uModel', 'uRot', 'uEye', 'uKey', 'uFill', 'uBase', 'uRimCol', 'uFadeTo', 'uSky', 'uGround', 'uSpec', 'uShine', 'uRim', 'uEmit', 'uFade', 'uAlpha','uLightPV','uShadow','uShadowOn','uSurface','uColorTex','uNormalTex','uRoughTex','uTextured']) U[n] = gl.getUniformLocation(prog, n);
    const aPos = gl.getAttribLocation(prog, 'aPos'), aNrm = gl.getAttribLocation(prog, 'aNrm'), aUV=gl.getAttribLocation(prog,'aUV');
    const depthProg=gl.createProgram();gl.attachShader(depthProg,sh(gl.VERTEX_SHADER,DEPTH_VS));gl.attachShader(depthProg,sh(gl.FRAGMENT_SHADER,DEPTH_FS));gl.linkProgram(depthProg);
    if(!gl.getProgramParameter(depthProg,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(depthProg));
    const depthPos=gl.getAttribLocation(depthProg,'aPos'),depthPV=gl.getUniformLocation(depthProg,'uPV'),depthModel=gl.getUniformLocation(depthProg,'uModel');
    const shadow=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,shadow);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,2048,2048,0,gl.RGBA,gl.UNSIGNED_BYTE,null);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    const shadowDepth=gl.createRenderbuffer();gl.bindRenderbuffer(gl.RENDERBUFFER,shadowDepth);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,2048,2048);
    const shadowFB=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,shadowFB);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,shadow,0);gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,shadowDepth);
    const shadowsSupported=gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE;gl.bindFramebuffer(gl.FRAMEBUFFER,null);

    const self = { lost: false };
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); self.lost = true; });
    let built = null, builtKey = '';
    const upload = (m) => {
      const b = gl.createBuffer(), n = gl.createBuffer(), i = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, m.pos, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, n); gl.bufferData(gl.ARRAY_BUFFER, m.nrm, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, i); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.idx, gl.STATIC_DRAW);
      let uv=null;if(m.uv){uv=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,uv);gl.bufferData(gl.ARRAY_BUFFER,m.uv,gl.STATIC_DRAW);}
      return { b, n, i, uv, count: m.idx.length, src: m };
    };
    const free = (g) => { for (const x of [g.b, g.n, g.i,g.uv].filter(Boolean)) gl.deleteBuffer(x); };
    const pixel=(rgb)=>{const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,1,1,0,gl.RGB,gl.UNSIGNED_BYTE,new Uint8Array(rgb));gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);return t;};
    let character=null,characterGPU=[],characterTextures=[pixel([255,255,255]),pixel([128,128,255]),pixel([0,180,0])];
    self.characterReady=false;self.characterError=null;
    const assetVersion=new URL(document.querySelector('script[src*="character-core.js"]').src).search;
    Promise.all([fetch('assets/eli/eli.json'+assetVersion).then(r=>{if(!r.ok)throw new Error('Character metadata '+r.status);return r.json();}),fetch('assets/eli/eli.bin'+assetVersion).then(r=>{if(!r.ok)throw new Error('Character mesh '+r.status);return r.arrayBuffer();})]).then(async([meta,buffer])=>{
      const maps=await Promise.all(['base','normal','roughness'].map(key=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,img);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.generateMipmap(gl.TEXTURE_2D);resolve(texture);};img.onerror=()=>reject(new Error('Character texture '+key));img.src='assets/eli/'+meta.textures[key]+assetVersion;})));for(const t of characterTextures)gl.deleteTexture(t);characterTextures=maps;
      if(self.lost)return;character=Character.load(meta,buffer);characterGPU=character.parts.map(p=>upload(p.mesh));self.characterReady=true;
    }).catch(e=>{self.characterError=e.message;});
    function build(m) {
      const key = JSON.stringify(m);
      if (key === builtKey) return built;
      if (built) for (const g of built.gpu) free(g);
      const M = meshes(m), A = actorMeshes(m), gpu = [];
      const up = (list) => list.map((p) => { const g = upload(p.mesh); gpu.push(g); return Object.assign({}, p, { g }); });
      built = {
        M, gpu, amr:up(A.amr), wheel:up(A.wheel), body: up(M.body), head: up(M.head), bar: up(M.bar), mount: { 1: up(M.mount[1]), '-1': up(M.mount[-1]) }, upper: up(M.upper), fore: up(M.fore), foreLight: up(M.foreLight),
        hand: { 1: up(M.hand[1]), '-1': up(M.hand[-1]) }, finger: { 1: up(M.finger[1]), '-1': up(M.finger[-1]) },
        tag: { paper: upload(M.tag.paper), border: upload(M.tag.border), ink: upload(M.tag.ink), cells: M.tag.cells.map(upload) },
      };
      built.gpu.push(built.tag.paper, built.tag.border, built.tag.ink, ...built.tag.cells);
      builtKey = key;
      return built;
    }
    // a force arrow: a shaft and a head, each 1 long and 1 wide along +z, stretched to fit when drawn
    const arrow = {
      shaft: upload(surface((u, v) => [Math.cos(TAU * u), Math.sin(TAU * u), v], 12, 1, (p) => [p[0], p[1], 0])),
      head: upload(surface((u, v) => [(1 - v) * Math.cos(TAU * u), (1 - v) * Math.sin(TAU * u), v], 16, 2, (p) => [p[0], p[1], 0.5])),
    };
    let props = null, propsKey = '';
    function buildProps(d) {
      const key = JSON.stringify(d);
      if (key === propsKey) return props;
      if (props) for (const g of props.gpu) free(g);
      const M = propMeshes(d), gpu = [];
      const up = (list) => list.map((p) => { const g = upload(p.mesh); gpu.push(g); return Object.assign({}, p, { g }); });
      props = { gpu, table: up(M.table), ball: up(M.ball), cup: up(M.cup), shadow: upload(M.shadow), extra: {} };
      for (const [key, pieces] of Object.entries(d.compounds || {})) props.extra[key] = up(compoundMeshes(pieces));
      gpu.push(props.shadow);
      propsKey = key;
      return props;
    }
    const clothGPU = new Map();
    function clear() { gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); }
    // o: { w, h, dpr, cam: TagCore.orbit result, fov, chest, m, arms: [{side, q, live, idle, reach, jaw: the gripper's gap (m),
    // hot: 1 the pointer can take its gripper, 2 it is being dragged}], body,
    // mount ('bar', 1, -1 or null), tags: [{R, t, size, color, parts: [{R, t, size}]}], fadeBody, theme: {accent, warn, bg, dark},
    // props: null or {dims (as propMeshes), table: {R, t} | null, bodies: [{kind: 'ball' | 'cup', R, t}],
    // shadows: [{t: where on the table, R: the table's, r: radius, a: darkness 0..1}]} }
    self.draw = function (o) {
      const dpr = o.dpr || 1, W = Math.max(1, Math.round(o.w * dpr)), H = Math.max(1, Math.round(o.h * dpr));
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      clear();
      const B = build(o.m), mats = MATS, cam = o.cam, f = o.h / 2 / Math.tan((o.fov * Math.PI) / 360), n = 0.03, F = 200, A = (F + n) / (F - n), Bz = (-2 * F * n) / (F - n);
      const e = cam.eye, r = cam.right, u = cam.up, w = cam.fwd, row = (v, s) => [v[0] * s, v[1] * s, v[2] * s, -dot(v, e) * s];
      const r0 = row(r, (2 * f) / o.w), r1 = row(u, (2 * f) / o.h), r3 = row(w, 1), r2 = r3.map((x, i) => A * x + (i === 3 ? Bz : 0));
      const PV = new Float32Array(16);
      for (let c = 0; c < 4; c++) { PV[c * 4] = r0[c]; PV[c * 4 + 1] = r1[c]; PV[c * 4 + 2] = r2[c]; PV[c * 4 + 3] = r3[c]; }
      gl.useProgram(prog); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(true); // colours are premultiplied
      gl.uniformMatrix4fv(U.uPV, false, PV); gl.uniform1f(U.uAlpha, 1);
      gl.uniform3fv(U.uEye, e);gl.uniform1f(U.uShadowOn,0);gl.uniformMatrix4fv(U.uLightPV,false,PV);gl.uniform1i(U.uShadow,0);gl.uniform1i(U.uColorTex,1);gl.uniform1i(U.uNormalTex,2);gl.uniform1i(U.uRoughTex,3);gl.uniform1f(U.uTextured,0);for(let i=0;i<characterTextures.length;i++){gl.activeTexture(gl.TEXTURE1+i);gl.bindTexture(gl.TEXTURE_2D,characterTextures[i]);}gl.activeTexture(gl.TEXTURE0);
      const toward = (a, b, c) => unit([r[0] * a + u[0] * b - w[0] * c, r[1] * a + u[1] * b - w[1] * c, r[2] * a + u[2] * b - w[2] * c]);
      gl.uniform3fv(U.uKey, toward(-0.5, 0.75, 0.45)); gl.uniform3fv(U.uFill, toward(0.85, 0.05, 0.3));
      // the lights: the site's violet, saturated and bright in either theme (its dark-theme accent is too pale to glow)
      const T = o.theme, dark = !!T.dark, accent = lin(T.accent, [0.3, 0.25, 0.8]), glow = dark ? lin('#9d8cff') : accent.map((x) => Math.min(1, x * 1.35)), warn = lin(T.warn, [0.9, 0.6, 0.1]), bg = lin(T.bg, dark ? [0.02, 0.025, 0.03] : [0.9, 0.92, 0.92]);
      gl.uniform3fv(U.uSky,o.game?[.30,.35,.42]:dark?[.34,.36,.42]:[.42,.44,.48]);gl.uniform3fv(U.uGround,o.game?[.10,.08,.06]:dark?[.1,.1,.12]:[.2,.19,.2]);
      gl.uniform3fv(U.uFadeTo, bg);
      const rimLight = dark ? lin('#d9d4ff') : lin('#55606a');
      let current={base:[1,1,1],emit:0,spec:.2,shine:20,rim:0,fade:0,surface:0};const commands=[];
      const setMat = (mat, fade, tint, exact) => {
        const M=mats[mat]||mats.shell;current={base:exact||(tint?(o.game?tint:M.base.map((x,i)=>x*.25+tint[i]*.75)):M.base),emit:mat==='light'?1:0,spec:M.spec,shine:M.shine,rim:0,fade:fade||0,surface:mat==='floor'?4:mat==='wood'?1:mat==='plaster'?2:mat==='fabric'||mat==='rug'?3:0};if(mat==='light')current.base=tint||glow;gl.uniform1f(U.uSurface,current.surface);gl.uniform1f(U.uTextured,0);
        if (mat === 'light') { gl.uniform3fv(U.uBase, tint || glow); gl.uniform1f(U.uEmit, 1); gl.uniform1f(U.uSpec, 0); gl.uniform1f(U.uShine, 1); gl.uniform1f(U.uRim, 0); }
        else {
          const M = mats[mat] || mats.shell;
          gl.uniform3fv(U.uBase, exact || (tint ? o.game?tint:M.base.map((x, i) => x * 0.25 + tint[i] * 0.75) : M.base));
          gl.uniform1f(U.uEmit, 0); gl.uniform1f(U.uSpec, M.spec); gl.uniform1f(U.uShine, M.shine); gl.uniform1f(U.uRim, (dark ? 0.42 : 0.32) * M.rim);
        }
        gl.uniform3fv(U.uRimCol, rimLight); gl.uniform1f(U.uFade, fade || 0);
      };
      const flat = (col, fade) => { current={base:col,emit:1,spec:0,shine:1,rim:0,fade:fade||0,surface:0};gl.uniform1f(U.uSurface,0); gl.uniform3fv(U.uBase, col); gl.uniform1f(U.uEmit, 1); gl.uniform1f(U.uSpec, 0); gl.uniform1f(U.uRim, 0); gl.uniform1f(U.uFade, fade || 0); };
      const uvOf=g=>{if(g.uv){gl.bindBuffer(gl.ARRAY_BUFFER,g.uv);gl.enableVertexAttribArray(aUV);gl.vertexAttribPointer(aUV,2,gl.FLOAT,false,0,0);}else{gl.disableVertexAttribArray(aUV);gl.vertexAttrib2f(aUV,0,0);}};
      const drawG = (g, pose, s) => {
        if(o.game){commands.push({g,pose,s,mat:current});return;}
        uvOf(g);
        gl.uniformMatrix4fv(U.uModel, false, model4(pose, s)); gl.uniformMatrix3fv(U.uRot, false, rot3(pose.R));
        gl.bindBuffer(gl.ARRAY_BUFFER, g.b); gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, g.n); gl.enableVertexAttribArray(aNrm); gl.vertexAttribPointer(aNrm, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.i); gl.drawElements(gl.TRIANGLES, g.count, gl.UNSIGNED_SHORT, 0);
      };
      const drawList = (list, pose, fade, tint, override) => { for (const p of list) { setMat(override||p.mat, fade, tint); drawG(p.g, pose); } };
      const ch = o.chest, at = (R, t) => ({ R: C.mul3(ch.R, R), t: RC.place(ch, t) });
      const pts = [];
      const keep = (p) => pts.push(RC.place(ch, p));
      // the tags, flat in their colours
      const drawTags = () => {
        for (const tg of o.tags || []) {
          const col = lin(tg.color, [0.5, 0.5, 0.5]), fade = tg.fade || 0;
          for (const p of tg.parts) {
            const pose = { R: C.mul3(tg.R, p.R), t: C.add(tg.t, C.mulv(tg.R, p.t)) }, s = p.size * 1.25; // the white margin round the black square
            flat([1, 1, 1], fade); drawG(B.tag.paper, pose, s);
            flat(col, fade); drawG(B.tag.border, pose, s);
            flat([0.01, 0.01, 0.012], fade); drawG(B.tag.ink, pose, s);
            flat([0.95, 0.95, 0.95], fade); for (const g of B.tag.cells) drawG(g, pose, s);
          }
        }
      };
      drawTags();
      if (o.props) {
        const PR = buildProps(o.props.dims);
        if (o.props.table) drawList(PR.table, o.props.table, 0,o.game?lin('#805638'):null,o.game?'wood':null);
        // the shadows: faint discs just above the table, without writing depth, so they never hide what's on it
        gl.depthMask(false);
        for (const sh of o.game?[]:o.props.shadows||[]) for (const k of [1, 1.3, 1.65]) {
          gl.uniform1f(U.uAlpha, 0.16 * sh.a); flat([0, 0, 0], 0);
          drawG(PR.shadow, { R: sh.R, t: C.add(sh.t, C.mulv(sh.R, [0, 0, 0.0008])) }, sh.r * k);
        }
        gl.uniform1f(U.uAlpha, 1); gl.depthMask(true);
        for (const b of o.props.bodies) drawList(PR.extra[b.key] || PR[b.kind] || [], b, 0, b.color ? lin(b.color) : null,b.material||null);
        const liveCloths = new Set();
        for (const c of o.props.cloths || []) {
          liveCloths.add(c.key);
          const mesh = clothMesh(c);
          let g = clothGPU.get(c.key);
          if (!g) { g = upload(mesh); clothGPU.set(c.key, g); }
          else { gl.bindBuffer(gl.ARRAY_BUFFER, g.b); gl.bufferData(gl.ARRAY_BUFFER, mesh.pos, gl.DYNAMIC_DRAW); gl.bindBuffer(gl.ARRAY_BUFFER, g.n); gl.bufferData(gl.ARRAY_BUFFER, mesh.nrm, gl.DYNAMIC_DRAW); }
          setMat('top', 0, lin(c.color)); drawG(g, { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] });
        }
        for (const [k, g] of clothGPU) if (!liveCloths.has(k)) { free(g); clothGPU.delete(k); }
      }
      const teen=o.actor==='teen', L=o.locomotion;
      if(o.body && teen){
        if(character){
          const parts=Character.pose(character,o.m,o.arms,L,o.headTilt);
          for(let i=0;i<parts.length;i++){
            const p=parts[i],g=characterGPU[i];
            gl.bindBuffer(gl.ARRAY_BUFFER,g.b);gl.bufferData(gl.ARRAY_BUFFER,p.mesh.pos,gl.DYNAMIC_DRAW);
            gl.bindBuffer(gl.ARRAY_BUFFER,g.n);gl.bufferData(gl.ARRAY_BUFFER,p.mesh.nrm,gl.DYNAMIC_DRAW);
            if(o.eyes&&p.name.includes('Head'))continue;
            setMat('fabric',0,null,p.color);current.textured=1;current.surface=0;current.spec=.45;current.shine=35;gl.uniform1f(U.uTextured,1);gl.uniform1f(U.uSurface,0);
            drawG(g,ch);
          }
          keep([-o.m.back,0,L?L.floor:-.975]);keep([0,0,.40]);
        }
      } else if (o.body) {
        if(L){drawList(B.amr,at([1,0,0,0,1,0,0,0,1],[0,0,L.floor]),0);for(const side of [-1,1])drawList(B.wheel,at(RC.Ry((L.distance||0)/.07),[-.065,side*.19,L.floor+.075]),0);}
        drawList(B.body, ch, o.fadeBody || 0);
        if (!o.eyes) {
          const pivot = [-o.m.back + 0.02, 0, o.m.up + 0.17], R = RC.Ry(-(o.headTilt || 0) * Math.PI / 180);
          drawList(B.head, at(R, C.sub(pivot, C.mulv(R, pivot))), o.fadeBody || 0);
        }
        for (const p of B.M.extent) keep(p);
      } else if (o.mount === 'bar') drawList(B.bar, ch, 0);
      else if (o.mount === 1 || o.mount === -1) drawList(B.mount[o.mount], ch, 0);
      for (const a of o.arms) {
        const k = RC.fk(o.m, a.side, a.q), fade = o.game ? 0 : a.idle ? 0.62 : a.live ? 0 : 0.45;
        if(teen){keep(k.shoulder);keep(k.elbow);keep(k.wrist);continue;}
        drawList(B.upper, at(k.Ru, k.shoulder), fade);
        drawList(B.fore, at(k.Rf, k.elbow), fade);
        // the wrist light: violet while its tag is tracked, amber while the hand is out of reach
        if (!teen && (!a.reach || (a.live && !a.idle))) for (const p of B.foreLight) { setMat('light', 0, a.reach ? null : warn); drawG(p.g, at(k.Rf, k.elbow)); }
        // a gripper the pointer can take (a.hot 1) is tinted violet, more so while it is dragged (2)
        const hot = a.hot ? glow.map((x) => x * (a.hot > 1 ? 1.25 : 1)) : null;
        drawList(B.hand[a.side], at(k.R, k.wrist), teen?0:fade, hot);
        const jaw = a.jaw === undefined ? RC.gripper(o.m).gapMax : a.jaw;
        for (const j of [1, -1]) drawList(B.finger[j], at(k.R, C.add(k.wrist, C.mulv(k.R, [0, (j * jaw) / 2, 0]))), teen?0:fade, hot);
        keep(k.shoulder); keep(k.elbow); keep(C.add(k.wrist, C.mulv(k.R, [0, 0, -o.m.hand]))); keep(C.add(k.shoulder, [0, a.side * 0.08, 0.08]));
      }
      // the force arrows (o.forces: [{a: tail, b: tip, warn}]), over everything: they are often inside a gripper
      if (o.forces && o.forces.length) {
        gl.disable(gl.DEPTH_TEST);
        for (const f of o.forces) {
          const d = sub(f.b, f.a), L = Math.hypot(d[0], d[1], d[2]), z = unit(d);
          if (!z || L < 0.004) continue;
          const x = unit(cross(Math.abs(z[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], z)), y = cross(z, x), R = [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
          const hl = Math.min(0.022, L * 0.45), stretch = (t, w, len) => {
            gl.uniformMatrix4fv(U.uModel, false, new Float32Array([x[0] * w, x[1] * w, x[2] * w, 0, y[0] * w, y[1] * w, y[2] * w, 0, z[0] * len, z[1] * len, z[2] * len, 0, t[0], t[1], t[2], 1]));
            gl.uniformMatrix3fv(U.uRot, false, rot3(R));
          };
          const draw = (g) => {
            gl.bindBuffer(gl.ARRAY_BUFFER, g.b); gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
            gl.bindBuffer(gl.ARRAY_BUFFER, g.n); gl.enableVertexAttribArray(aNrm); gl.vertexAttribPointer(aNrm, 3, gl.FLOAT, false, 0, 0);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.i); gl.drawElements(gl.TRIANGLES, g.count, gl.UNSIGNED_SHORT, 0);
          };
          setMat('light', 0, f.warn ? warn : null);
          stretch(f.a, 0.0035, L - hl); draw(arrow.shaft);
          stretch(C.add(f.a, z.map((v) => v * (L - hl))), 0.009, hl); draw(arrow.head);
        }
        gl.enable(gl.DEPTH_TEST);
      }
      if(o.game){
        const focus=o.props&&o.props.table?o.props.table.t:ch.t,light=unit([-.4,-.55,.9]),eye=C.add(focus,light.map(v=>v*4)),fw=light.map(v=>-v),rt=unit(cross(fw,[0,0,1])),up=cross(rt,fw),row=(v,k,b)=>[v[0]*k,v[1]*k,v[2]*k,-dot(v,eye)*k+(b||0)];
        const rows=[row(rt,1/2.2),row(up,1/2.2),row(fw,1/4,-1),[0,0,0,1]],lightPV=new Float32Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++)lightPV[c*4+r]=rows[r][c];
        const bind=(g,pos,nrm)=>{gl.bindBuffer(gl.ARRAY_BUFFER,g.b);gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,3,gl.FLOAT,false,0,0);if(nrm!==null){gl.bindBuffer(gl.ARRAY_BUFFER,g.n);gl.enableVertexAttribArray(nrm);gl.vertexAttribPointer(nrm,3,gl.FLOAT,false,0,0);}gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,g.i);};
        if(shadowsSupported){gl.disable(gl.DITHER);gl.bindFramebuffer(gl.FRAMEBUFFER,shadowFB);gl.viewport(0,0,2048,2048);gl.clearColor(1,1,1,1);gl.depthMask(true);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.disable(gl.BLEND);gl.useProgram(depthProg);gl.uniformMatrix4fv(depthPV,false,lightPV);
          for(const q of commands){gl.uniformMatrix4fv(depthModel,false,model4(q.pose,q.s));bind(q.g,depthPos,null);gl.drawElements(gl.TRIANGLES,q.g.count,gl.UNSIGNED_SHORT,0);}
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.enable(gl.DITHER);clear();gl.useProgram(prog);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.enable(gl.DEPTH_TEST);gl.depthMask(true);gl.uniformMatrix4fv(U.uPV,false,PV);gl.uniformMatrix4fv(U.uLightPV,false,lightPV);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,shadow);gl.uniform1i(U.uShadow,0);gl.uniform1f(U.uShadowOn,shadowsSupported?1:0);gl.uniform3fv(U.uKey,light);gl.uniform1f(U.uAlpha,1);
        for(const q of commands){const m=q.mat;gl.uniform3fv(U.uBase,m.base);gl.uniform1f(U.uEmit,m.emit);gl.uniform1f(U.uSpec,m.spec);gl.uniform1f(U.uShine,m.shine);gl.uniform1f(U.uRim,0);gl.uniform1f(U.uFade,m.fade);gl.uniform1f(U.uSurface,m.surface);gl.uniform1f(U.uTextured,m.textured||0);uvOf(q.g);gl.uniformMatrix4fv(U.uModel,false,model4(q.pose,q.s));gl.uniformMatrix3fv(U.uRot,false,rot3(q.pose.R));bind(q.g,aPos,aNrm);gl.drawElements(gl.TRIANGLES,q.g.count,gl.UNSIGNED_SHORT,0);}
      }
      return pts;
    };
    self.clear = clear;
    return self;
  }

  return { meshes, actorMeshes, propMeshes, compoundMeshes, clothMesh, beveledBox, create, lin };
});
