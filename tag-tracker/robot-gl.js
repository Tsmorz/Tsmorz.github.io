// RobotGL: draws the tag tracker's robot with WebGL: smooth curved shells, lit by a key light, a fill light and the sky,
// with specular highlights and a rim, two-tone panels and violet lights: an engineering robot of brushed aluminium box
// sections and motor drums, a generic design modelled on no one's robot.
//
// The meshes are built here from the robot's lengths (RobotCore.model), each in the frame it rides in: the chest's, or an
// arm's upper-arm, forearm or hand frame (RobotCore.fk), so a frame only needs its pose to be drawn. The camera is the 3D
// plot's own (TagCore.orbit), so the robot lines up exactly with the grid and the cameras drawn on the 2D canvas under it.
// meshes() has no DOM, so script/test-tag-tracker checks it in Node; create() needs a canvas.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./tracker-core.js'), require('./robot-core.js'), require('./cloth-render-core.js'), require('./liquid-render-core.js'));
  else root.RobotGL = factory(root.TagCore, root.RobotCore, root.ClothRenderCore, root.LiquidRenderCore);
})(typeof self !== 'undefined' ? self : this, function (C, RC, ClothRender, LiquidRender) {
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
      const o = out(p,u,v);
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
      part(lathe([-m.back, 0, m.up], -m.half, m.half, () => 0.03, { axis: 'y', k0: 0.05, k1: 0.05 }), 'robotDark'),
      part(blob([-m.back, 0, m.up], [0.065, 0.065, 0.065], 0.9, 0.9), 'robotShell'),
      part(torus([-m.back, 0, m.up - 0.01], 0.064, 0.006), 'light'),
    ];
    out.mount = {};
    for (const sd of [1, -1]) out.mount[sd] = [
      part(lathe([-m.back, 0, m.up], sd * m.half, sd * (m.half - 0.14), () => 0.03, { axis: 'y', k0: 0.05, k1: 0.05 }), 'robotDark'),
      part(blob([-m.back, sd * (m.half - 0.15), m.up], [0.07, 0.025, 0.07], 0.9, 0.6), 'robotShell'),
      part(blob([-m.back, sd * (m.half - 0.15), m.up], [0.05, 0.03, 0.05], 0.9, 0.9, { nu: 24, nv: 12 }), 'light'),
    ];
  }

  // Machine: an engineering robot. Brushed aluminium box sections, motor drums on the joint axes, a battery on its
  // back, a sensor bar for a head with two lenses, a parallel gripper, on a column and a foot.
  function machine(m) {
    const out = {}, cx = -0.075, wy = Math.max(0.09, m.half - 0.055), zc = m.up - 0.1, hz = m.up + 0.17, hx = -m.back + 0.01;
    out.body = [
      part(blob([cx, 0, zc], [0.072, wy, 0.15], 0.2, 0.22, { nu: 48, nv: 32 }), 'robotShell'),
      part(blob([cx + 0.062, 0, zc + 0.01], [0.014, wy * 0.8, 0.115], 0.18, 0.18, { nu: 40, nv: 24 }), 'robotMetal'),
      part(blob([cx + 0.077, 0, -0.088], [0.004, 0.05, 0.005], 0.5, 0.3, { nu: 20, nv: 8 }), 'light'),
      part(blob([cx + 0.077, 0, zc - 0.11], [0.004, 0.008, 0.008], 1, 1, { nu: 12, nv: 8 }), 'light'),
      part(blob([cx - 0.088, 0, zc + 0.01], [0.028, wy * 0.62, 0.11], 0.25, 0.25), 'robotDark'),
      part(blob([cx - 0.118, 0, zc + 0.01], [0.004, wy * 0.4, 0.004], 0.5, 0.3, { nu: 16, nv: 6 }), 'light'),
      part(lathe([hx, 0, 0], m.up + 0.04, m.up + 0.11, () => 0.03, { k0: 0.1, k1: 0.1 }), 'robotDark'),
      part(blob([hx, 0, m.up + 0.11], [0.045, 0.045, 0.012], 1, 0.7, { nu: 28, nv: 10 }), 'robotMetal'),
    ];
    out.head = [
      part(blob([hx + 0.01, 0, hz], [0.058, 0.105, 0.045], 0.22, 0.22, { nu: 40, nv: 24 }), 'robotShell'),
      part(blob([hx + 0.065, 0, hz], [0.006, 0.09, 0.025], 0.25, 0.2, { nu: 32, nv: 12 }), 'glass'),
      part(blob([hx + 0.071, 0.048, hz], [0.008, 0.018, 0.018], 1, 1, { nu: 20, nv: 12 }), 'glass'),
      part(blob([hx + 0.071, -0.048, hz], [0.008, 0.018, 0.018], 1, 1, { nu: 20, nv: 12 }), 'glass'),
      part(blob([hx + 0.078, 0.048, hz], [0.002, 0.006, 0.006], 1, 1, { nu: 12, nv: 8 }), 'light'),
      part(blob([hx + 0.078, -0.048, hz], [0.002, 0.006, 0.006], 1, 1, { nu: 12, nv: 8 }), 'light'),
      part(blob([hx - 0.03, 0.085, hz + 0.05], [0.004, 0.004, 0.035], 1, 1, { nu: 10, nv: 10 }), 'robotDark'),
    ];
    bars(m, out);
    const L1 = m.upper, L2 = m.fore, G = RC.gripper(m);
    out.upper = [
      part(lathe([0, 0, 0], -0.055, 0.055, () => 0.052, { axis: 'y', k0: 0.06, k1: 0.06, nu: 36 }), 'robotDark'),
      part(blob([0, 0, -L1 / 2], [0.036, 0.03, L1 / 2 - 0.035], 0.15, 0.3, { nu: 32, nv: 24 }), 'robotMetal'),
      part(blob([0.038, 0, -L1 / 2], [0.004, 0.012, L1 / 2 - 0.06], 0.5, 0.5, { nu: 12, nv: 12 }), 'robotDark'),
      part(lathe([0, 0, -L1], -0.05, 0.05, () => 0.045, { axis: 'y', k0: 0.06, k1: 0.06, nu: 36 }), 'robotDark'),
    ];
    out.fore = [
      part(blob([0, 0, -L2 / 2], [0.03, 0.027, L2 / 2 - 0.035], 0.15, 0.3, { nu: 32, nv: 24 }), 'robotMetal'),
      part(lathe([0, 0, 0], -(L2 - 0.065), -(L2 - 0.004), (s) => 0.034 - 0.004 * s, { k0: 0.12, k1: 0.15 }), 'robotDark'),
    ];
    out.foreLight = [part(torus([0, 0, -(L2 - 0.06)], 0.035, 0.004, { nu: 36, nv: 8 }), 'light')];
    // the gripper: a body across the jaws' travel with a rail under it, a light on the back of the hand
    const gb = G.body, rail = gb.c[2] - gb.h[2];
    out.hand = {};
    for (const sd of [1, -1]) out.hand[sd] = [
      part(lathe([0, 0, 0], 0.004, -0.022, () => 0.034, { k0: 0.1, k1: 0.1 }), 'robotDark'),
      part(blob(gb.c, gb.h, 0.2, 0.2), 'robotMetal', {grip:true}),
      part(blob([0, 0, rail], [0.012, gb.h[1] - 0.006, 0.003], 0.4, 0.3, { nu: 24, nv: 8 }), 'robotDark', {grip:true}),
      part(blob([gb.h[0] + 0.001, 0, gb.c[2]], [0.003, 0.016, 0.012], 1, 1, { nu: 20, nv: 6 }), 'light'),
    ];
    const mir = (c, j) => [c[0], j * c[1], c[2]];
    out.finger = {};
    for (const j of [1, -1]) out.finger[j] = [
      part(blob(mir(G.finger.c, j), G.finger.h, 0.2, 0.2, { nu: 20, nv: 16 }), 'robotMetal', {grip:true}),
      part(blob(mir(G.pad.c, j), G.pad.h, 0.3, 0.3, { nu: 12, nv: 8 }), 'robotRubber', {tip:true,grip:true}),
    ];
    const base=supportLayout(m).base;
    out.extent = [[cx, wy, zc + 0.15], [cx, -wy, zc + 0.15], [hx, 0, hz + 0.09], ...[-1,1].flatMap(x=>[-1,1].map(y=>[base.c[0]+x*base.h[0],y*base.h[1],base.c[2]-base.h[2]])), [0, 0, 0]];
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
  // Arc-length, shape-preserving Hermite interpolation avoids the radial ringing of an
  // unconstrained cubic around a tall wall, rounded lip or narrow bottle shoulder.
  function profileSampler(points){
    const at=[0];for(let i=1;i<points.length;i++)at.push(at[i-1]+Math.hypot(...points[i].map((v,k)=>v-points[i-1][k])));
    const slopes=[0,1].map(k=>points.slice(1).map((p,i)=>(p[k]-points[i][k])/(at[i+1]-at[i])));
    const tangents=[0,1].map(k=>points.map((_,i)=>{
      if(!i)return slopes[k][0];if(i===points.length-1)return slopes[k].at(-1);
      const a=slopes[k][i-1],b=slopes[k][i];if(a*b<=0)return 0;
      const h=at[i]-at[i-1],j=at[i+1]-at[i],w1=2*j+h,w2=j+2*h;return (w1+w2)/(w1/a+w2/b);
    }));
    return v=>{const d=Math.max(0,Math.min(1,v))*at.at(-1);let i=0;while(i<points.length-2&&at[i+1]<d)i++;
      const h=at[i+1]-at[i],t=(d-at[i])/h,a=2*t*t*t-3*t*t+1,b=t*t*t-2*t*t+t,c=-2*t*t*t+3*t*t,e=t*t*t-t*t;
      return [0,1].map(k=>a*points[i][k]+b*h*tangents[k][i]+c*points[i+1][k]+e*h*tangents[k][i+1]);};
  }
  function steinHandleMesh(s){
    const h=s.handle,r=.01,x=h.x-r,top=h.z1-.005,bottom=h.z0+.005,straight=x-s.wall,vertical=top-bottom-2*r,arc=r*Math.PI/2,total=2*straight+2*arc+vertical;
    const path=v=>{
      let d=v*total;
      if(d<straight)return {p:[s.wall+d,0,top],t:[1,0,0]};d-=straight;
      if(d<arc){const a=Math.PI/2-d/r;return {p:[x+r*Math.cos(a),0,top-r+r*Math.sin(a)],t:[Math.sin(a),0,-Math.cos(a)]};}d-=arc;
      if(d<vertical)return {p:[h.x,0,top-r-d],t:[0,0,-1]};d-=vertical;
      if(d<arc){const a=-d/r;return {p:[x+r*Math.cos(a),0,bottom+r+r*Math.sin(a)],t:[Math.sin(a),0,-Math.cos(a)]};}d-=arc;
      return {p:[x-d,0,bottom],t:[-1,0,0]};
    };
    return surface((u,v)=>{const {p,t}=path(v),a=u*TAU;return [p[0]+t[2]*h.r*Math.sin(a),h.w*Math.cos(a),p[2]-t[0]*h.r*Math.sin(a)];},24,112,(p,u,v)=>sub(p,path(v).p));
  }
  function compoundMeshes(pieces) {
    // A revolved body (bowl, stein): one smooth surface from its profile, plus any pieces marked `show` (a handle).
    const profile = pieces.find(s => s.bowlProfile || s.profile), revolved = [];
    if (profile) {
      const prof = profile.bowlProfile || profile.profile;
      // One continuous, smoothly shaded surface through the foot, outside, rounded lip and hollow inside.
      const point = profile.smoothProfile?profileSampler(prof):(v) => {
        const t = v * (prof.length - 1), i = Math.min(prof.length - 2, Math.floor(t)), f = t - i;
        const at = (n) => prof[Math.max(0, Math.min(prof.length - 1, n))];
        const [a,b,c,d] = [at(i-1),at(i),at(i+1),at(i+2)];
        return [0,1].map(k => Math.max(0, .5*((2*b[k])+(-a[k]+c[k])*f+(2*a[k]-5*b[k]+4*c[k]-d[k])*f*f+(-a[k]+3*b[k]-3*c[k]+d[k])*f*f*f)));
      };
      revolved.push(part(surface((u,v) => { const [r,z] = point(v); return [r*Math.cos(TAU*u),r*Math.sin(TAU*u),z]; }, 96, 96, () => [0,0,0]), 'ceramic'));
      if (!pieces.some(s => s.show)) return revolved;
    }
    const result = revolved;
    for (const s of pieces) {
      if (profile && !s.show) continue;
      const R = s.R || [1, 0, 0, 0, 1, 0, 0, 0, 1], p = s.p || [0, 0, 0];
      const meshes = [];
      if(s.type==='stein-handle')meshes.push(steinHandleMesh(s));
      else if(s.type==='trim')meshes.push(torus([0,0,0],s.r,s.h));
      else if(s.type==='lozenges'){
        for(let row=0;row<3;row++)for(let j=0;j<18;j++)meshes.push(surface((u,v)=>{
          const a=(j+(row%2)*.5)*TAU/18+(u+v-1)*TAU/38;
          return [s.r*Math.cos(a),s.r*Math.sin(a),(row-1)*s.h/1.5+(v-u)*s.h/3];
        },2,2,p=>[p[0],p[1],0]));
      }
      else if(s.type==='ellipsoid'){meshes.push(blob([0,0,0],s.r,1,1,{nu:24,nv:16}));}
      else if (s.type === 'cylinder') {
        const segments=s.artwork?96:32,offset=s.artwork?-3*Math.PI/4:0;
        const side=surface((u, v) => [s.r * Math.cos(TAU*u+offset), s.r * Math.sin(TAU*u+offset), (v * 2 - 1) * s.h],segments,2,p=>[p[0],p[1],0]);
        if(s.artwork){side.uv=new Float32Array((segments+1)*3*2);for(let j=0;j<=2;j++)for(let i=0;i<=segments;i++)side.uv.set([i/segments,j/2],(j*(segments+1)+i)*2);}
        meshes.push(side);
        if(!s.visual)for (const sign of [-1, 1]) meshes.push(surface((u, v) => [s.r * v * Math.cos(TAU * u), s.r * v * Math.sin(TAU * u), sign * s.h], 32, 2, () => [0, 0, sign]));
      } else meshes.push(...beveledBox(s.h,s.bevel===0?.00001:Math.min(s.bevel||.009,...s.h.map(h=>h*(s.bevel?.95:.28)))));
      for (const m of meshes) {
        for (let i = 0; i < m.pos.length; i += 3) { m.pos.set(C.add(C.mulv(R, [...m.pos.slice(i, i + 3)]), p), i); m.nrm.set(C.mulv(R, [...m.nrm.slice(i, i + 3)]), i); }
        result.push(part(m,s.material||'ceramic',{keepMaterial:!!s.material,...(s.artwork?{artwork:s.artwork}:{})}));
      }
    }
    return result;
  }
  // Catmull-Rom through four points (the cable centreline uses the same spline).
  const spline=(p0,p1,p2,p3,t)=>[0,1,2].map(j=>.5*(2*p1[j]+(-p0[j]+p2[j])*t+(2*p0[j]-5*p1[j]+4*p2[j]-p3[j])*t*t+(-p0[j]+3*p1[j]-3*p2[j]+p3[j])*t*t*t));
  // A whole-grid towel is drawn through a 3x finer spline surface, so folds read as rounded fabric rather than
  // the physics grid's flat facets. Only the picture is smoothed: contacts and checks use the actual nodes.
  function clothSurface(c) {
    if(c.kind!=='towel'||c.nodes.length!==c.N*c.rows)return {p:c.nodes.map(n=>n.p),N:c.N,rows:c.rows,triangles:c.triangles};
    const S=3,N=(c.N-1)*S+1,rows=(c.rows-1)*S+1,at=(i,j)=>{
      // past an edge, continue straight on so the hem doesn't curl
      const ci=Math.max(0,Math.min(c.N-1,i)),cj=Math.max(0,Math.min(c.rows-1,j)),p=c.nodes[cj*c.N+ci].p;
      if(ci===i&&cj===j)return p;
      const q=c.nodes[Math.max(0,Math.min(c.rows-1,cj+(cj-j)))*c.N+Math.max(0,Math.min(c.N-1,ci+(ci-i)))].p;
      return [2*p[0]-q[0],2*p[1]-q[1],2*p[2]-q[2]];
    };
    const across=[];
    for(let j=-1;j<=c.rows;j++){const row=[];for(let i=0;i<c.N-1;i++)for(let k=0;k<S;k++)row.push(spline(at(i-1,j),at(i,j),at(i+1,j),at(i+2,j),k/S));row.push(at(c.N-1,j));across.push(row);}
    const p=[];
    for(let j=0;j<c.rows-1;j++)for(let k=0;k<S;k++)for(let i=0;i<N;i++)p.push(spline(across[j][i],across[j+1][i],across[j+2][i],across[j+3][i],k/S));
    for(let i=0;i<N;i++)p.push(across[c.rows][i]);
    const triangles=[];
    for(let j=0;j<rows-1;j++)for(let i=0;i<N-1;i++){const a=j*N+i,b=a+1,d=a+N,e=d+1;triangles.push(...((i+j)%2?[a,b,d,b,e,d]:[a,b,e,a,e,d]));}
    return {p,N,rows,triangles,S};
  }
  function clothMesh(c) {
    if(c.kind==='shirt')return ClothRender.mesh(c);
    const surf=clothSurface(c),count=surf.p.length,normals=surf.p.map(()=>[0,0,0]);
    for(let t=0;t<surf.triangles.length;t+=3){const ids=surf.triangles.slice(t,t+3),n=cross(sub(surf.p[ids[1]],surf.p[ids[0]]),sub(surf.p[ids[2]],surf.p[ids[0]]));for(const i of ids)normals[i]=C.add(normals[i],n);}
    for(let i=0;i<count;i++)normals[i]=unit(normals[i])||[0,0,1];
    if(!c.pile)return {pos:new Float32Array(surf.p.flat()),nrm:new Float32Array(normals.flat()),idx:new Uint16Array(surf.triangles)};
    // Closed, rounded-depth terry shell follows the same deforming midsurface and contact thickness.
    const pos=[],nrm=[],idx=[],edges=new Map(),half=c.halfThickness,S=surf.S||1;
    for(const side of [1,-1])for(let i=0;i<count;i++){
      const x=i%surf.N,y=Math.floor(i/surf.N),hem=Math.min(x,y,surf.N-1-x,surf.rows-1-y),round=hem===0?.55:1;
      const loft=half*round+c.pile*(.75+.25*Math.sin(x/S*7.13)*Math.sin(y/S*3.7)),point=C.add(surf.p[i],normals[i].map(v=>v*side*loft));
      const local=C.mulv(C.tr3(c.table.R),C.sub(point,c.table.t));if(Math.abs(local[0])<c.table.size[0]/2&&Math.abs(local[1])<c.table.size[1]/2&&local[2]<.0002){local[2]=.0002;point.splice(0,3,...C.add(c.table.t,C.mulv(c.table.R,local)));}
      pos.push(...point);nrm.push(...normals[i].map(v=>v*side));
    }
    for(let t=0;t<surf.triangles.length;t+=3){
      const [a,b,d]=surf.triangles.slice(t,t+3);idx.push(a,b,d,d+count,b+count,a+count);
      for(const [i,j]of [[a,b],[b,d],[d,a]]){const key=Math.min(i,j)+':'+Math.max(i,j);if(edges.has(key))edges.delete(key);else edges.set(key,[i,j]);}
    }
    for(const [a,b]of edges.values()){
      const first=pos.length/3,normal=unit(cross(sub(surf.p[b],surf.p[a]),C.add(normals[a],normals[b])))||[1,0,0];
      for(const i of [a,b,b+count,a+count]){pos.push(...pos.slice(i*3,i*3+3));nrm.push(...normal);}
      idx.push(first,first+2,first+1,first,first+3,first+2);
    }
    return {pos:new Float32Array(pos),nrm:new Float32Array(nrm),idx:new Uint16Array(idx)};
  }

  // Flow geometry and small foam domes are display-only; the pour core owns every unit of beer.
  const liquidMesh=l=>LiquidRender.surfaceMesh(l);
  function cableMesh(c) {
    // Catmull-Rom interpolation only smooths the rendered centreline. Physics always uses the actual rod nodes.
    const points=[],nodes=c.nodes.map(n=>n.p),steps=c.bend?3:2,sides=12;
    for(let i=0;i<nodes.length-1;i++)for(let k=0;k<steps;k++){
      const t=k/steps,p0=nodes[Math.max(0,i-1)],p1=nodes[i],p2=nodes[i+1],p3=nodes[Math.min(nodes.length-1,i+2)];
      points.push([0,1,2].map(j=>.5*(2*p1[j]+(-p0[j]+p2[j])*t+(2*p0[j]-5*p1[j]+4*p2[j]-p3[j])*t*t+(-p0[j]+3*p1[j]-3*p2[j]+p3[j])*t*t*t)));
    }points.push(nodes.at(-1));
    const pos=[],nrm=[],idx=[];let previous=null,u=null;
    for(let i=0;i<points.length;i++){
      const p=points[i],t=unit(sub(points[Math.min(i+1,points.length-1)],points[Math.max(0,i-1)]))||previous||[1,0,0];
      if(!u)u=unit(cross(t,Math.abs(t[2])<.9?[0,0,1]:[0,1,0]));
      else {const axis=cross(previous,t),sine=Math.hypot(...axis);if(sine>1e-9)u=C.mulv(C.rodrigues(axis.map(x=>x*Math.atan2(sine,dot(previous,t))/sine)),u);u=unit(sub(u,t.map(x=>x*dot(u,t))))||[0,1,0];}
      previous=t;const v=cross(t,u);
      for(let j=0;j<sides;j++){
        const a=j*TAU/sides,n=C.add(u.map(x=>x*Math.cos(a)),v.map(x=>x*Math.sin(a)));
        const distance=Math.min(i,points.length-1-i)*(c.nodes.length>1?C.norm(sub(nodes[1],nodes[0]))/steps:0),boot=c.boot===false?1:1+Math.max(0,1-distance/.012)*.8;
        const f=i/(points.length-1)*(nodes.length-1),j0=Math.min(nodes.length-1,Math.floor(f)),j1=Math.min(nodes.length-1,j0+1),radius=c.radii?c.radii[j0]+(c.radii[j1]-c.radii[j0])*(f-j0):c.radius;
        pos.push(...C.add(p,n.map(x=>x*radius*boot)));nrm.push(...n);
        if(i<points.length-1){const k=i*sides+j,l=i*sides+(j+1)%sides;idx.push(k,l,k+sides,l,l+sides,k+sides);}
      }
    }return {pos:new Float32Array(pos),nrm:new Float32Array(nrm),idx:new Uint16Array(idx)};
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

  // Shared with the flat fallback. The post is one uninterrupted section from the grounded
  // base into the torso; collars and full-height ribs reinforce it without introducing joints.
  function supportLayout(m,floor=m.up-.59) {
    const cx=-.075,bottom=floor+.045,top=Math.max(bottom+.08,m.up-.22),height=top-bottom;
    const post={c:[cx,0,(bottom+top)/2],h:[.06,.065,height/2]};
    return {floor,base:{c:[cx,0,floor+.025],h:[.19,.21,.025]},post,
      collar:{c:[cx,0,bottom+.018],h:[.084,.092,.025]},cap:{c:[cx,0,top-.006],h:[.075,.09,.012]},
      ribs:[-1,1].map(s=>({c:[cx,s*.066,post.c[2]],h:[.052,.009,post.h[2]]})),
      bolts:[-1,1].flatMap(x=>[-1,1].map(y=>[cx+x*.145,y*.165,floor+.051]))};
  }
  // The support lives in the chest frame. Keeping it separate lets tasks extend the same
  // single post to the actual floor without scaling the robot or its kinematic dimensions.
  function actorMeshes(m,floor) {
    const layout=supportLayout(m,floor),box=(s,mat,role)=>part(blob(s.c,s.h,.18,.2,{nu:32,nv:20}),mat,{support:role});
    const amr=[box(layout.base,'robotMetal','base'),box(layout.post,'robotShell','post'),box(layout.collar,'robotMetal','collar'),box(layout.cap,'robotMetal','cap'),...layout.ribs.map(s=>box(s,'robotMetal','rib'))];
    for(const p of layout.bolts)amr.push(part(lathe(p,-.002,.004,()=>.006,{nu:12,nv:4,k0:.04,k1:.04}),'robotDark',{support:'bolt'}));
    return {amr,wheel:[]};
  }

  // ---- drawing ----
  const VS = `attribute vec3 aPos,aNrm;attribute vec2 aUV,aHem;
uniform mat4 uPV,uModel,uLightPV; uniform mat3 uRot; varying vec3 vN,vW,vLocal;varying vec2 vUV,vHem;varying vec4 vShadow;
void main(){vec4 w=uModel*vec4(aPos,1.0);vW=w.xyz;vLocal=aPos;vUV=aUV;vHem=aHem;vN=uRot*aNrm;vShadow=uLightPV*w;gl_Position=uPV*w;}`;
  const FS = `#extension GL_OES_standard_derivatives : enable
precision highp float;
varying vec3 vN,vW,vLocal;varying vec2 vUV,vHem;varying vec4 vShadow;
uniform vec3 uEye,uKey,uFill,uBase,uRimCol,uFadeTo,uSky,uGround;
uniform float uSpec,uShine,uRim,uEmit,uFade,uAlpha,uShadowOn,uSurface,uMetal,uRough,uTransmit,uTexture;uniform sampler2D uShadow,uLabel;
float noise(vec3 p){return fract(sin(dot(floor(p),vec3(12.9898,78.233,37.719)))*43758.5453);}
float fleece(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(noise(vec3(i,0.0)),noise(vec3(i+vec2(1.0,0.0),0.0)),f.x),mix(noise(vec3(i+vec2(0.0,1.0),0.0)),noise(vec3(i+vec2(1.0,1.0),0.0)),f.x),f.y);}
float depth(vec2 p){return dot(texture2D(uShadow,p),vec4(1.0/16777216.0,1.0/65536.0,1.0/256.0,1.0))*(255.0/256.0);}
float shade(vec3 N){if(uShadowOn<0.5)return 1.0;vec3 q=vShadow.xyz/vShadow.w*.5+.5;if(q.x<0.0||q.x>1.0||q.y<0.0||q.y>1.0||q.z>1.0)return 1.0;
 float a=0.0,bias=max(.00035,.0012*(1.0-dot(N,uKey))),gap=max(0.0,q.z-depth(q.xy)),radius=1.0+min(3.0,gap*150.0);
 for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++)a+=step(q.z-bias,depth(q.xy+vec2(float(x),float(y))*radius/2048.0));return .12+.88*a/9.0;}
// Analytic studio environment: broad softboxes reflected in the materials, with roughness blur.
vec3 studio(vec3 r,float rough){float hemi=clamp(r.z*.5+.5,0.0,1.0);vec3 env=mix(vec3(.045,.052,.065),vec3(.32,.37,.45),hemi);
 float a=pow(max(0.0,dot(r,normalize(vec3(-.45,-.55,.8)))),mix(180.0,5.0,rough));
 float b=pow(max(0.0,dot(r,normalize(vec3(.7,.25,.65)))),mix(260.0,7.0,rough));
 return env+vec3(2.2,2.06,1.86)*a+vec3(.85,1.0,1.2)*b;}
vec3 aces(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.0,1.0);}
void main(){vec3 N=normalize(vN),V=normalize(uEye-vW);if(uTexture>.5&&dot(N,V)<=0.0)discard;if(dot(N,V)<0.0)N=-N;vec3 base=uBase;if(uTexture>.5)base=pow(texture2D(uLabel,vUV).rgb,vec3(2.2));float rough=clamp(uRough,.08,.98);
 if((uSurface>.5&&uSurface<1.5)||(uSurface>3.5&&uSurface<4.5)){float grain=sin(vLocal.x*210.0+sin(vLocal.y*19.0)*2.0)+.35*sin(vLocal.x*487.0+sin(vLocal.y*29.0));base*=.95+.025*grain;
 if(uSurface>3.5&&abs(N.z)>.8){float row=floor(vLocal.y*6.0),fy=fract(vLocal.y*6.0),fx=fract(vLocal.x*1.35+row*.37),seam=min(min(fy,1.0-fy),min(fx,1.0-fx));base*=.96+.07*noise(vec3(row,0,0));base*=mix(.72,1.0,smoothstep(.0,max(.005,fwidth(seam)*1.2),seam));}}
 if(uSurface>2.5&&uSurface<3.5){vec2 uv=vW.xy+vW.z*vec2(.37,-.29);float visible=1.0-smoothstep(.35,2.5,max(fwidth(uv.x),fwidth(uv.y))*400.0);base*=.87+visible*(.20*fleece(uv*1800.0)+.12*fleece(uv*550.0));N=normalize(N+visible*.20*vec3(fleece(uv*1800.0+vec2(17,3))-.5,fleece(uv*1800.0+vec2(5,29))-.5,0));}
 if(uSurface>4.5&&uSurface<5.5){float visible=1.0-smoothstep(.2,1.0,fwidth(vLocal.z*1800.0));float brush=sin(vLocal.z*1800.0+sin(vLocal.y*19.0));rough+=visible*.025*brush;base*=.98+visible*.015*brush;}
 if(uSurface>5.5&&uSurface<6.5){vec2 thread=vUV*1700.0;float visible=1.0-smoothstep(.25,1.2,max(fwidth(thread.x),fwidth(thread.y))),weave=sin(thread.x*6.283)*sin(thread.y*6.283);base*=.97+visible*.035*weave;
 float seam=(1.0-smoothstep(.0004,.0018,abs(vHem.x-.0035)))*.12;float stitches=(1.0-smoothstep(.00015,.00065,abs(vHem.x-.0018)))*smoothstep(.35,.55,sin(vHem.y*3000.0));base*=1.0-seam;base+=vec3(.035)*stitches;
 vec3 tx=dFdx(vW)*dFdy(vUV.y)-dFdy(vW)*dFdx(vUV.y);if(length(tx)>.0000001){tx=normalize(tx);vec3 ty=normalize(cross(N,tx));N=normalize(N+visible*.035*(tx*cos(thread.x*6.283)+ty*cos(thread.y*6.283)));}}
 if(uSurface>6.5&&uSurface<7.5){float ripple=sin(vUV.y*110.0+vUV.x*14.0);rough+=.02*ripple;}
 float nl=max(dot(N,uKey),0.0),nv=max(dot(N,V),.001),sh=shade(N);vec3 H=normalize(uKey+V);float nh=max(dot(N,H),0.0),vh=max(dot(V,H),0.0);
 float a=rough*rough,a2=a*a,den=nh*nh*(a2-1.0)+1.0,D=a2/(3.14159265*den*den+.0001),k=(rough+1.0)*(rough+1.0)/8.0,G=nv/(nv*(1.0-k)+k)*nl/(nl*(1.0-k)+k);
 vec3 f0=mix(vec3(.04),base,uMetal),F=f0+(1.0-f0)*pow(1.0-vh,5.0),spec=D*G*F/(4.0*nv*max(nl,.001));
 vec3 ambient=mix(uGround,uSky,.5+.5*N.z)*(.8+.2*sh);float fill=max(dot(N,uFill),0.0);
 vec3 diffuse=(1.0-uMetal)*base*mix(1.0,.45,uTransmit);vec3 col=diffuse*(ambient+vec3(1.0,.96,.88)*nl*sh*.95+vec3(.62,.72,.88)*fill*.18)+spec*nl*sh*min(1.3,uSpec);
 vec3 fresnel=f0+(1.0-f0)*pow(1.0-nv,5.0);col+=studio(reflect(-V,N),rough)*fresnel*mix(.45,1.15,uMetal)*(1.0-rough*.45);
 if(uSurface>5.5&&uSurface<6.5)col+=base*.07*pow(1.0-nv,2.5);
 if(uTransmit>0.0)col=mix(col,base*.45+studio(refract(-V,N,.75),.65)*base*.7,uTransmit*.35);
 col=mix(col,base*1.8,uEmit);col=mix(col,uFadeTo,uFade);col=aces(col);float alpha=mix(uAlpha,min(1.0,uAlpha+.35*pow(1.0-nv,3.0)),uTransmit);
 gl_FragColor=vec4(pow(col,vec3(1.0/2.2))*alpha,alpha);}`;
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
    robotMetal: {base:lin('#d8dbde'),spec:.9,shine:90,rough:.3,metal:.38,rim:.8},
    robotShell: {base:lin('#eceeed'),spec:.3,shine:25,rough:.56,metal:.05,rim:.5},
    robotDark: {base:lin('#42474b'),spec:.45,shine:40,rough:.55,rim:.5},
    robotRubber: {base:lin('#303336'),spec:.08,shine:5,rough:.9,rim:.1},
    metal: { base: lin('#b8c0c8'), spec: 1, shine: 110, rim: .9, metal:.94, rough:.32 },
    dark: { base: lin('#24282e'), spec:.4, shine:30, rim:1, rough:.64 },
    glass: { base: lin('#07080c'), spec: 1.3, shine: 220, rim: 1.4 },
    shell: { base: lin('#c9ced4'), spec:.25, shine:20, rim:.8, rough:.78 },
    rubber: {base:lin('#343941'),spec:.12,shine:4,rim:0,rough:.94},
    fabric: { base: lin('#7398c4'), spec: .08, shine: 3, rim: .3 },
    top: { base: lin('#6b737c'), spec: 0.25, shine: 24, rim: 0.5 },
    ball: { base: lin('#2a78d6'), spec: 0.7, shine: 80, rim: 0.6 },
    ballB: { base: lin('#e9eef5'), spec: 0.7, shine: 80, rim: 0.6 },
    skin: {base:lin('#c89978'),spec:.1,shine:12,rim:.35}, shirt:{base:lin('#547d91'),spec:.12,shine:12,rim:.3}, denim:{base:lin('#33455c'),spec:.1,shine:10,rim:.3}, hair:{base:lin('#382e2b'),spec:.16,shine:14,rim:.3}, shoe:{base:lin('#353b44'),spec:.15,shine:18,rim:.3},
    floor:{base:lin('#966d49'),spec:.28,shine:45,rim:0},
    wood:{base:lin('#805638'),spec:.18,shine:24,rim:0},plaster:{base:lin('#e2d4b9'),spec:.08,shine:8,rim:0},fabric:{base:[1,1,1],spec:.08,shine:6,rim:0},rug:{base:lin('#706452'),spec:.03,shine:4,rim:0},
    ceramic: { base: lin('#ece8e1'), spec:.85, shine:90, rim:.6, rough:.23 },
    liquid: { base: lin('#c18a29'), spec:1.2, shine:180, rim:.3, rough:.13, transmit:1, alpha:.42 },
    label: { base: lin('#efe7d4'), spec: 0.15, shine: 12, rim: 0.3,rough:.8 }, labelBand: { base: lin('#2d4f8c'), spec: 0.3, shine: 30, rim: 0.4 },
    foam: {base:lin('#f3ead6'),spec:.12,shine:8,rim:.1},
    cotton: {base:lin('#536f95'),spec:.12,shine:8,rim:0,rough:.9},
    bottleGlass:{base:lin('#5a3514'),spec:1.1,shine:180,rim:.4,rough:.12,transmit:1,alpha:.42},
    pewter: {base:lin('#a4a5a2'),spec:1,shine:45,rim:.3,metal:.92,rough:.4}, gold:{base:lin('#bd9149'),spec:1,shine:60,rim:.3,metal:.88,rough:.3},
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
    for (const n of ['uPV', 'uModel', 'uRot', 'uEye', 'uKey', 'uFill', 'uBase', 'uRimCol', 'uFadeTo', 'uSky', 'uGround', 'uSpec', 'uShine', 'uRim', 'uEmit', 'uFade', 'uAlpha','uLightPV','uShadow','uShadowOn','uSurface','uMetal','uRough','uTransmit','uTexture','uLabel']) U[n] = gl.getUniformLocation(prog, n);
    const aPos = gl.getAttribLocation(prog, 'aPos'), aNrm = gl.getAttribLocation(prog, 'aNrm'), aUV=gl.getAttribLocation(prog,'aUV'), aHem=gl.getAttribLocation(prog,'aHem');
    const depthProg=gl.createProgram();gl.attachShader(depthProg,sh(gl.VERTEX_SHADER,DEPTH_VS));gl.attachShader(depthProg,sh(gl.FRAGMENT_SHADER,DEPTH_FS));gl.linkProgram(depthProg);
    if(!gl.getProgramParameter(depthProg,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(depthProg));
    const depthPos=gl.getAttribLocation(depthProg,'aPos'),depthPV=gl.getUniformLocation(depthProg,'uPV'),depthModel=gl.getUniformLocation(depthProg,'uModel');
    const shadow=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,shadow);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,2048,2048,0,gl.RGBA,gl.UNSIGNED_BYTE,null);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    const shadowDepth=gl.createRenderbuffer();gl.bindRenderbuffer(gl.RENDERBUFFER,shadowDepth);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,2048,2048);
    const shadowFB=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,shadowFB);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,shadow,0);gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,shadowDepth);
    const shadowsSupported=gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE;gl.bindFramebuffer(gl.FRAMEBUFFER,null);

    const self = { lost: false, labelStatus:new Map() };
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); self.lost = true; });
    const labelWhite=gl.createTexture();gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,labelWhite);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([255,255,255,255]));
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.activeTexture(gl.TEXTURE0);
    const labelTextures=new Map();
    function labelTexture(artwork){
      const key=JSON.stringify(artwork);if(labelTextures.has(key))return labelTextures.get(key);
      const texture=gl.createTexture(),paper=document.createElement('canvas');paper.width=1024;paper.height=330;
      const ctx=paper.getContext('2d'),red='#a11d2b',status={title:artwork.title||'',ready:!artwork.lettering,fallback:!artwork.lettering};self.labelStatus.set(key,status);
      const uploadLabel=()=>{
        gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,texture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,paper);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
        // The physical label's aspect ratio is deliberately NPOT: WebGL1 needs clamp+linear, no mipmaps.
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.activeTexture(gl.TEXTURE0);
      };
      const paint=lettering=>{
        ctx.fillStyle='#f3ead3';ctx.fillRect(0,0,paper.width,paper.height);
        for(const x of [0,paper.width/2]){
          if(lettering){const scale=Math.min(468/lettering.naturalWidth,190/lettering.naturalHeight),w=lettering.naturalWidth*scale,h=lettering.naturalHeight*scale;ctx.drawImage(lettering,x+256-w/2,5+(190-h)/2,w,h);}
          else{ctx.fillStyle=red;ctx.textAlign='center';ctx.font='bold 74px "Snell Roundhand", "Apple Chancery", cursive';const words=(artwork.title||'').split(' ');ctx.fillText(words.shift()||'',x+256,77,440);ctx.fillText(words.join(' '),x+256,157,440);}
          ctx.save();ctx.translate(x+256,251);ctx.scale(.48,.48);ctx.translate(-215,-120);ctx.fillStyle=red;
          // A red stag in profile: lifted head, full branching antlers and four tapered legs.
          ctx.fill(new Path2D('M105 132C135 111 215 110 260 125L285 110 295 83 300 55 307 43 324 46 328 63 341 73 339 82 322 84 313 103 310 134 285 155 275 190 268 232 254 232 259 187 264 160 225 163 213 191 204 234 190 234 198 188 205 163 162 159 146 179 134 224 120 224 131 175 142 154 119 151 103 142 88 128 78 122 85 118Z'));
          ctx.strokeStyle=red;ctx.lineWidth=6;ctx.lineCap='round';ctx.lineJoin='round';ctx.stroke(new Path2D('M310 48C303 34 295 18 294 5M303 31 282 21M299 20 309 10M318 48C329 31 337 17 333 4M328 32 345 27M333 17 347 8'));
          ctx.fillStyle='#f3ead3';ctx.beginPath();ctx.arc(325,65,2.5,0,TAU);ctx.fill();ctx.restore();
        }
        uploadLabel();
      };
      paint(null);labelTextures.set(key,texture);
      if(artwork.lettering){const lettering=new Image();lettering.onload=()=>{if(self.lost)return;paint(lettering);status.ready=true;status.fallback=false;};lettering.onerror=()=>{status.ready=true;status.fallback=true;};lettering.src=artwork.lettering;}
      return texture;
    }
    let built = null, builtKey = '';
    const meshCentre=m=>{
      const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
      for(let i=0;i<m.pos.length;i++) {const axis=i%3;lo[axis]=Math.min(lo[axis],m.pos[i]);hi[axis]=Math.max(hi[axis],m.pos[i]);}
      return m.pos.length?lo.map((v,i)=>(v+hi[i])/2):[0,0,0];
    };
    const upload = (m) => {
      const b = gl.createBuffer(), n = gl.createBuffer(), i = gl.createBuffer(), uv=gl.createBuffer(), hem=gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, m.pos, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, n); gl.bufferData(gl.ARRAY_BUFFER, m.nrm, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, i); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.idx, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER,uv);gl.bufferData(gl.ARRAY_BUFFER,m.uv||new Float32Array(m.pos.length/3*2),gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER,hem);gl.bufferData(gl.ARRAY_BUFFER,m.hem||new Float32Array(m.pos.length/3*2),gl.STATIC_DRAW);
      return {b,n,i,uv,hem,count:m.idx.length,vertices:m.pos.length,src:m,centre:meshCentre(m)};
    };
    const free=g=>{for(const x of [g.b,g.n,g.i,g.uv,g.hem])gl.deleteBuffer(x);};
    const updateMesh=(g,m)=>{
      for(const [buffer,data]of [[g.b,m.pos],[g.n,m.nrm]]){gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,data,gl.DYNAMIC_DRAW);}
      for(const [key,buffer]of [['uv',g.uv],['hem',g.hem]])if(m[key]!==g.src[key]){gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,m[key]||new Float32Array(m.pos.length/3*2),gl.DYNAMIC_DRAW);}
      if(m.idx!==g.src.idx){gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,g.i);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,m.idx,gl.DYNAMIC_DRAW);}g.src=m;g.centre=meshCentre(m);
    };

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
    let support=null,supportKey='';
    function buildSupport(m,floor){
      const key=JSON.stringify([m,floor]);if(key===supportKey)return support;
      if(support)for(const p of support)free(p.g);
      support=actorMeshes(m,floor).amr.map(p=>Object.assign({},p,{g:upload(p.mesh)}));supportKey=key;return support;
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
      gl.uniform3fv(U.uEye, e);gl.uniform1f(U.uShadowOn,0);gl.uniformMatrix4fv(U.uLightPV,false,PV);gl.uniform1i(U.uShadow,0);
      const toward = (a, b, c) => unit([r[0] * a + u[0] * b - w[0] * c, r[1] * a + u[1] * b - w[1] * c, r[2] * a + u[2] * b - w[2] * c]);
      gl.uniform3fv(U.uKey, toward(-0.5, 0.75, 0.45)); gl.uniform3fv(U.uFill, toward(0.85, 0.05, 0.3));
      // the lights: the site's violet, saturated and bright in either theme (its dark-theme accent is too pale to glow)
      const T = o.theme, dark = !!T.dark, accent = lin(T.accent, [0.3, 0.25, 0.8]), glow = dark ? lin('#9d8cff') : accent.map((x) => Math.min(1, x * 1.35)), warn = lin(T.warn, [0.9, 0.6, 0.1]), bg = lin(T.bg, dark ? [0.02, 0.025, 0.03] : [0.9, 0.92, 0.92]);
      gl.uniform3fv(U.uSky,o.game?[.30,.35,.42]:dark?[.34,.36,.42]:[.42,.44,.48]);gl.uniform3fv(U.uGround,o.game?[.10,.08,.06]:dark?[.1,.1,.12]:[.2,.19,.2]);
      gl.uniform3fv(U.uFadeTo, bg);
      const rimLight = dark ? lin('#d9d4ff') : lin('#55606a');
      let current;const commands=[];
      const surfaceOf=mat=>({floor:4,wood:1,plaster:2,fabric:3,rug:3,metal:5,robotMetal:5,pewter:5,gold:5,cotton:6,liquid:7,foam:8,bottleGlass:9,glass:9}[mat]||0);
      const applyMat=m=>{gl.uniform3fv(U.uBase,m.base);gl.uniform1f(U.uEmit,m.emit);gl.uniform1f(U.uSpec,m.spec);gl.uniform1f(U.uShine,m.shine);gl.uniform1f(U.uRim,0);gl.uniform1f(U.uFade,m.fade);gl.uniform1f(U.uSurface,m.surface);gl.uniform1f(U.uMetal,m.metal);gl.uniform1f(U.uRough,m.rough);gl.uniform1f(U.uTransmit,m.transmit);gl.uniform1f(U.uAlpha,m.alpha);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,m.texture||labelWhite);gl.uniform1i(U.uLabel,1);gl.uniform1f(U.uTexture,m.texture?1:0);gl.activeTexture(gl.TEXTURE0);};
      const setMat=(mat,fade,tint,exact,artwork)=>{
        const M=mats[mat]||mats.shell;
        current={base:mat==='light'?tint||glow:exact||(tint?(o.game?tint:M.base.map((x,i)=>x*.25+tint[i]*.75)):M.base),emit:mat==='light'?1:0,spec:M.spec,shine:M.shine,fade:fade||0,surface:surfaceOf(mat),metal:M.metal||0,rough:M.rough??Math.max(.15,Math.min(.9,Math.sqrt(2/(M.shine+2)))),transmit:M.transmit||0,alpha:M.alpha??1,texture:artwork?labelTexture(artwork):null};
        applyMat(current);
      };
      const flat=(col,fade)=>{current={base:col,emit:1,spec:0,shine:1,fade:fade||0,surface:0,metal:0,rough:1,transmit:0,alpha:1};applyMat(current);};
      const attributes=g=>{for(const [location,buffer,size]of [[aPos,g.b,3],[aNrm,g.n,3],[aUV,g.uv,2],[aHem,g.hem,2]]){if(location<0)continue;gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,size,gl.FLOAT,false,0,0);}gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,g.i);};
      const drawG = (g, pose, s) => {
        if(o.game){commands.push({g,pose,s,mat:current});return;}
        gl.uniformMatrix4fv(U.uModel, false, model4(pose, s)); gl.uniformMatrix3fv(U.uRot, false, rot3(pose.R));
        gl.bindBuffer(gl.ARRAY_BUFFER, g.b); gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, g.n); gl.enableVertexAttribArray(aNrm); gl.vertexAttribPointer(aNrm, 3, gl.FLOAT, false, 0, 0);
        attributes(g); gl.drawElements(gl.TRIANGLES, g.count, gl.UNSIGNED_SHORT, 0);
      };
      const drawList = (list, pose, fade, tint, override) => { for (const p of list) { setMat(p.keepMaterial?p.mat:override||p.mat, fade, p.keepMaterial?null:tint,undefined,p.artwork); drawG(p.g, pose); } };
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
        if (o.props.table) drawList(PR.table,o.props.table,0,o.game?lin('#89949b'):null,o.game?'top':null);
        // the shadows: faint discs just above the table, without writing depth, so they never hide what's on it
        gl.depthMask(false);
        for (const sh of o.game?[]:o.props.shadows||[]) for (const k of [1, 1.3, 1.65]) {
          flat([0, 0, 0], 0); gl.uniform1f(U.uAlpha, 0.16 * sh.a);
          drawG(PR.shadow, { R: sh.R, t: C.add(sh.t, C.mulv(sh.R, [0, 0, 0.0008])) }, sh.r * k);
        }
        gl.uniform1f(U.uAlpha, 1); gl.depthMask(true);
        for (const b of o.props.bodies) drawList(PR.extra[b.key] || PR[b.kind] || [], b, 0, b.color ? lin(b.color) : null,b.material||(b.kind==='bottle'?'bottleGlass':null));
        const liveCloths = new Set();
        for (const c of [...(o.props.cloths || []),...(o.props.cables || [])]) {
          liveCloths.add(c.key);
          const mesh = c.radius ? cableMesh(c) : clothMesh(c);
          let g = clothGPU.get(c.key);
          if (!g || g.count !== mesh.idx.length || g.vertices !== mesh.pos.length) { if(g)free(g); g = upload(mesh); clothGPU.set(c.key, g); }
          else updateMesh(g,mesh);
          setMat(c.radius?'top':c.kind==='shirt'?'cotton':'fabric', 0, lin(c.color)); drawG(g, { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] });
        }
        // Amber surfaces and streams use the transparent pass; foam stays opaque.
        const meshes = [...(o.props.liquids || []).map(l=>['liquid'+l.key+(l.layer||''),liquidMesh(l),l.color,l.layer]),...(o.props.streams||[]).map((s,i)=>['stream'+i,LiquidRender.streamMesh(s),s.color])];
        if(o.props.particles?.length)meshes.push(['beerDrops',LiquidRender.particleMesh(o.props.particles),o.props.streams?.[0]?.color||mats.liquid.base]);
        for (const [key, mesh, color,layer] of meshes) {
          liveCloths.add(key);
          let g = clothGPU.get(key);
          if (!g || g.count !== mesh.idx.length || g.vertices !== mesh.pos.length) { if (g) free(g); g = upload(mesh); clothGPU.set(key, g); }
          else updateMesh(g,mesh);
          setMat(layer==='foam'?'foam':'liquid', 0, Array.isArray(color)?color:lin(color)); drawG(g, { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] });
        }
        for (const [k, g] of clothGPU) if (!liveCloths.has(k)) { free(g); clothGPU.delete(k); }
      }
      const L=o.locomotion;
      if(o.body){
        drawList(L?buildSupport(o.m,L.floor):B.amr,ch,o.fadeBody||0);
        if(L){const b=supportLayout(o.m,L.floor).base;for(const x of [-1,1])for(const y of [-1,1])keep([b.c[0]+x*b.h[0],b.c[1]+y*b.h[1],L.floor]);}
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
        drawList(B.upper, at(k.Ru, k.shoulder), fade);
        drawList(B.fore, at(k.Rf, k.elbow), fade);
        // the wrist light: violet while its tag is tracked, amber while the hand is out of reach
        if ((!a.reach || (a.live && !a.idle))) for (const p of B.foreLight) { setMat('light', 0, a.reach ? null : warn); drawG(p.g, at(k.Rf, k.elbow)); }
        // Highlight the pickable gripper assembly without tinting its wrist motor or arm.
        const hot = a.hot ? glow.map((x) => x * (a.hot > 1 ? 1.25 : 1)) : null;
        for(const p of B.hand[a.side]){setMat(p.mat,fade,p.grip?hot:null);drawG(p.g,at(k.R,k.wrist));}
        const jaw = a.jaw === undefined ? RC.gripper(o.m).gapMax : a.jaw;
        for (const j of [1, -1]) for(const p of B.finger[j]){setMat(p.mat,fade,p.grip?hot:null);drawG(p.g,at(k.R,C.add(k.wrist,C.mulv(k.R,[0,j*jaw/2,0]))));}
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
            attributes(g); gl.drawElements(gl.TRIANGLES, g.count, gl.UNSIGNED_SHORT, 0);
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
          for(const q of commands.filter(q=>q.mat.alpha>=1)){gl.uniformMatrix4fv(depthModel,false,model4(q.pose,q.s));bind(q.g,depthPos,null);gl.drawElements(gl.TRIANGLES,q.g.count,gl.UNSIGNED_SHORT,0);}
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.enable(gl.DITHER);clear();gl.useProgram(prog);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.enable(gl.DEPTH_TEST);gl.depthMask(true);gl.uniformMatrix4fv(U.uPV,false,PV);gl.uniformMatrix4fv(U.uLightPV,false,lightPV);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,shadow);gl.uniform1i(U.uShadow,0);gl.uniform1f(U.uShadowOn,shadowsSupported?1:0);gl.uniform3fv(U.uKey,light);gl.uniform1f(U.uAlpha,1);
        gl.uniform3fv(U.uFill,unit([.7,.25,.65]));
        const paint=q=>{applyMat(q.mat);gl.uniformMatrix4fv(U.uModel,false,model4(q.pose,q.s));gl.uniformMatrix3fv(U.uRot,false,rot3(q.pose.R));attributes(q.g);gl.drawElements(gl.TRIANGLES,q.g.count,gl.UNSIGNED_SHORT,0);};
        for(const q of commands)if(q.mat.alpha>=1)paint(q);
        const distance=q=>dot(C.sub(C.add(q.pose.t,C.mulv(q.pose.R,q.g.centre.map(v=>v*(q.s??1)))),cam.eye),cam.fwd);
        gl.depthMask(false);
        for(const q of commands.filter(q=>q.mat.alpha<1).sort((a,b)=>distance(b)-distance(a)))paint(q);
        gl.depthMask(true);gl.uniform1f(U.uAlpha,1);

      }
      return pts;
    };
    self.clear = clear;
    return self;
  }

  return { meshes, actorMeshes, supportLayout, propMeshes, compoundMeshes, profileSampler, clothMesh, cableMesh, liquidMesh, beveledBox, create, lin };
});
