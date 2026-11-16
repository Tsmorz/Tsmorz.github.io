// Beer in a bottle and a mug: a level free surface, pouring over the lowest point of the mouth (no faster than the
// neck passes) and a falling stream that another container can catch. No DOM. Representative, not CFD: the surface stays flat and perpendicular to the effective
// gravity (gravity less the stein's acceleration), so a quick swing sloshes over the rim just as a tilt does.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./tracker-core.js'));
  else root.PourCore = factory(root.TagCore);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';
  const G = 9.81, RINGS = 8, SECTORS = 24, RIM = 48, TAU = 2 * Math.PI;
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  // Equal-area samples over the inner floor disc, as fractions of the radius.
  const DISC = [];
  for (let i = 0; i < RINGS; i++) for (let j = 0; j < SECTORS; j++) {
    const r = Math.sqrt((i + 0.5) / RINGS), a = TAU * (j + (i % 2) * 0.5) / SECTORS;
    DISC.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  // A container's inside is a stack of upright cylindrical sections {z0, z1, r} from its inner floor (z = 0) up to its
  // mouth, the top section's rim: one for a mug, body + stepped shoulder + neck for a bottle.
  const cylinder = (r, h) => ({ sections: [{ z0: 0, z1: h, r }] });
  const mouth = (s) => s.sections[s.sections.length - 1];
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  // Liquid volume (m³) on the side n·p ≤ d of a plane, inside the container (each section exact along its axis).
  function volumeBelow(n, d, shape) {
    let V = 0;
    for (const { z0, z1, r } of shape.sections) {
      const h = z1 - z0;
      let length = 0;
      for (const [x, y] of DISC) {
        const c = d - n[0] * x * r - n[1] * y * r - n[2] * z0;
        if (n[2] > 1e-9) length += clamp(c / n[2], 0, h);
        else if (n[2] < -1e-9) length += h - clamp(c / n[2], 0, h);
        else length += c >= 0 ? h : 0;
      }
      V += (length / DISC.length) * Math.PI * r * r;
    }
    return V;
  }
  // The lowest point of the mouth's rim along n (local), where liquid leaves first, and the volume then held.
  function spout(n, shape) {
    const { r, z1 } = mouth(shape);
    let best = null;
    for (let k = 0; k < RIM; k++) {
      const a = TAU * k / RIM, p = [r * Math.cos(a), r * Math.sin(a), z1], d = dot(n, p);
      if (!best || d < best.d) best = { d, p };
    }
    return { p: best.p, d: best.d, capacity: volumeBelow(n, best.d, shape) };
  }
  // The plane offset d at which the container holds volume V with its surface normal n (local).
  function level(n, V, shape) {
    let lo = Infinity, hi = -Infinity;
    for (const { z0, z1, r } of shape.sections) for (const z of [z0, z1]) for (let k = 0; k < RIM; k++) { const a = TAU * k / RIM, d = dot(n, [r * Math.cos(a), r * Math.sin(a), z]); lo = Math.min(lo, d); hi = Math.max(hi, d); }
    for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (volumeBelow(n, mid, shape) < V) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }
  // The free surface's outline (local points on the inner wall) in a one-section container, exact: where the wall line
  // leaves the slab 0..h the outline follows the straight chord across that cap, so those wall points are skipped.
  // A bottle's surface is hidden in brown glass and not drawn.
  function surface(n, d, shape, steps = 40) {
    if (shape.sections.length !== 1 || Math.abs(n[2]) < 1e-6) return [];
    const { r, z1: h } = shape.sections[0], z = (a) => (d - n[0] * r * Math.cos(a) - n[1] * r * Math.sin(a)) / n[2], out = [];
    for (let k = 0; k < steps; k++) {
      const a0 = TAU * k / steps, a1 = TAU * (k + 1) / steps, z0 = z(a0), z1 = z(a1), in0 = z0 >= 0 && z0 <= h;
      if (in0) out.push([r * Math.cos(a0), r * Math.sin(a0), z0]);
      for (const cap of [0, h]) if ((z0 - cap) * (z1 - cap) < 0) {
        const f = (z0 - cap) / (z0 - z1), a = a0 + f * (a1 - a0);
        out.push([r * Math.cos(a), r * Math.sin(a), cap]);
      }
    }
    return out;
  }
  // A container's liquid. spec: {shape, floor (m above the body's base), volume (m³), flow (most m³/s its mouth passes)}.
  function vessel(body, spec) {
    const m = mouth(spec.shape);
    return { body, shape: spec.shape, r: m.r, h: m.z1, floor: spec.floor, flow: spec.flow || Infinity, V0: spec.volume || 0, V: spec.volume || 0, a: [0, 0, 0], vPrev: null, n: [0, 0, 1], d: 0, pouring: 0, agitation:0, foam:0, receiving:null, visualSplashAt:-Infinity };
  }
  // The inner frame of a stein: origin at the centre of its inner floor, z along its axis.
  const inner = (W, v) => { const p = W.poseOf(v.body); return { R: p.R, t: C.add(p.t, C.mulv(p.R, [0, 0, v.floor])) }; };
  // One pour: the steins in `vessels`, the falling drops, and what reached the table. Call each physics substep.
  // solid(p, skip): whether p is inside a body other than skip, so a drop that hits it splashes rather than passing through.
  function pour(W, vessels, table, solid = null) {
    const state = { vessels, drops: [], spilled: 0, caught: 0, poured: 0, table, time:0, visualImpacts:[] };
    state.step = (dt) => {
      state.time+=dt;
      state.visualImpacts=state.visualImpacts.filter(e=>state.time-e.at<.24);
      for (const v of vessels) {
        v.agitation*=Math.exp(-dt/.35);v.foam*=Math.exp(-dt/35);
        const b = v.body, vel = b.v.slice();
        // the stein's acceleration, smoothed over ~60 ms so contact jitter doesn't slosh
        if (v.vPrev) { const acc = C.sub(vel, v.vPrev).map((x) => x / dt), k = Math.min(1, dt / 0.06); v.a = v.a.map((x, i) => x + (acc[i] - x) * k); }
        v.vPrev = vel;
        const a = C.norm(v.a) > 30 ? v.a.map((x) => (x * 30) / C.norm(v.a)) : v.a, up = C.add([0, 0, G], a), frame = inner(W, v);
        v.n = C.mulv(C.tr3(frame.R), up.map((x) => x / C.norm(up)));
        v.pouring = 0;
        if (v.V <= 1e-12) continue;
        const s = spout(v.n, v.shape), excess = v.V - s.capacity;
        if (excess > 1e-9) {
          // The excess leaves over the lowest point of the mouth within ~50 ms, or as fast as a narrow neck lets it
          // (a bottle glugs), as a stream of drops (each ≤ 5 ml) leaving at the flow's speed through the mouth.
          const out = Math.min(excess * Math.min(1, dt / 0.05), v.flow * dt), at = C.add(frame.t, C.mulv(frame.R, s.p)), radial = C.mulv(frame.R, [s.p[0], s.p[1], 0].map((x) => x / v.r));
          const rim = C.add(b.v, cross(b.w, C.sub(at, b.t))), speed = Math.min(0.6, out / dt / (Math.PI * v.r * v.r));
          // over a wide lip the beer spills sideways; out of a narrow neck it leaves along the neck
          const along = Number.isFinite(v.flow) ? C.mulv(frame.R, [0, 0, 1]) : radial;
          v.V -= out; v.pouring = out / dt; v.lip = at; state.poured += out;
          const last = state.drops[state.drops.length - 1];
          if (last && last.from === v && last.age < 0.02 && last.vol < 5e-6) last.vol += out;
          else state.drops.push({ p: C.add(at, along.map((x) => x * 0.003)), v: C.add(rim, along.map((x) => x * speed)), flow:out/dt, vol: out, age: 0, from: v, t: W.time });
        }
      }
      // Drops fall freely; one inside another stein's opening below its rim joins it, one at the table is spilled.
      const keep = [];
      for (const d of state.drops) {
        const before = d.p; d.v = C.add(d.v, [0, 0, -G * dt]); d.p = C.add(d.p, d.v.map((x) => x * dt)); d.age += dt;
        let gone = false;
        // A drop joins a container only by falling through its mouth: its path crosses the mouth's plane inside the rim.
        for (const v of vessels) {
          if (v === d.from && d.age < 0.15) continue;
          const f = inner(W, v), q = C.mulv(C.tr3(f.R), C.sub(d.p, f.t)), q0 = C.mulv(C.tr3(f.R), C.sub(before, f.t));
          if (q0[2] >= v.h && q[2] < v.h) {
            const k = (q0[2] - v.h) / (q0[2] - q[2]);
            const entry=[q0[0]+k*(q[0]-q0[0]),q0[1]+k*(q[1]-q0[1]),v.h];
            if (Math.hypot(entry[0],entry[1]) < v.r) {
              v.V += d.vol; v.agitation=Math.min(1,v.agitation+d.vol*2e5);v.foam=Math.min(1,v.foam+d.vol*1e4);state.caught += d.vol; gone = true;
              // Render-only continuation and splash timing. Accounted drops still join only through the mouth.
              v.receiving={local:entry,velocity:C.mulv(C.tr3(f.R),d.v),flow:d.flow||d.from.flow,from:d.from,at:state.time};
              if(state.time-v.visualSplashAt>.045){
                v.visualSplashAt=state.time;state.visualImpacts.push({vessel:v,local:entry,at:state.time,seed:Math.round(state.time*1000)});
                if(state.visualImpacts.length>8)state.visualImpacts.shift();
              }
              break;
            }
          }
        }
        // Anything solid it hits instead (a wall, a handle, a bottle) splashes it off to the table: spilled.
        if (!gone && solid && solid(d.p, d.age < 0.05 ? d.from.body : null)) { state.spilled += d.vol; gone = true; }
        if (!gone) {
          const local = table ? C.mulv(C.tr3(table.R), C.sub(d.p, table.t)) : d.p;
          if (local[2] <= 0.002 || d.age > 3) { state.spilled += d.vol; gone = true; }
        }
        if (!gone) keep.push(d);
      }
      state.drops = keep;
    };
    // For drawing: each stein's surface outline in the world, and the stream as chains of nearby drops.
    state.view = () => {
      const allChains=state.drops.slice().reverse().reduce((chains,d)=>{
        const last=chains.at(-1),tail=last?.at(-1);
        if(tail&&tail.from===d.from&&C.norm(C.sub(tail.p,d.p))<.05)last.push(d);
        else chains.push(d.from.pouring>0&&!chains.some(c=>c[0].from===d.from)&&C.norm(C.sub(d.from.lip,d.p))<.05?[{p:d.from.lip,from:d.from,flow:d.flow,v:d.v},d]:[d]);
        return chains;
      },[]),chains=allChains.filter(c=>c.length>1),particles=[];
      const shown=new Map();
      const surfaces=vessels.filter((v)=>v.V>2e-6&&v.shape.sections.length===1).map(v=>{
        const f=inner(W,v),d=level(v.n,v.V,v.shape),shape={sections:v.shape.sections.map(x=>({...x,r:x.r*.995}))};
        const at=q=>C.add(f.t,C.mulv(f.R,q)),ontoSurface=q=>{
          const r=Math.hypot(q[0],q[1]),k=r>v.r*.91?v.r*.91/r:1,x=q[0]*k,y=q[1]*k;
          return [x,y,clamp((d-v.n[0]*x-v.n[1]*y)/(Math.abs(v.n[2])<1e-5?1:v.n[2]),0,v.h)];
        };
        const receiving=v.receiving&&state.time-v.receiving.at<.12?v.receiving:null;
        const hit=receiving?ontoSurface(C.add(receiving.local,receiving.velocity.map(x=>x*.055))):null;
        shown.set(v,{f,d,at,ontoSurface,hit});
        if(receiving&&hit){
          const top=receiving.local,points=Array.from({length:6},(_,i)=>{const t=i/5,q=top.map((x,j)=>x+(hit[j]-x)*t);return {p:at(q),from:receiving.from,flow:receiving.flow,v:C.mulv(f.R,receiving.velocity)};});
          chains.push(points);
        }
        return {key:v.body.key,points:surface(v.n,d,shape).map(at),up:C.mulv(f.R,v.n),phase:state.time,agitation:v.agitation,foam:v.foam,
          impact:hit?{point:at(hit),strength:v.agitation}:null};
      });
      // Single separated flow packets remain visible as tiny elongated droplets, not 5 ml spheres.
      for(const chain of allChains)if(chain.length===1){const d=chain[0];particles.push({p:d.p.slice(),velocity:d.v.slice(),r:.0012,stretch:1.7});}
      for(const e of state.visualImpacts){
        const s=shown.get(e.vessel);if(!s)continue;
        const age=state.time-e.at,base=s.at(s.ontoSurface(e.local)),up=C.mulv(s.f.R,e.vessel.n),tangent=C.mulv(s.f.R,[1,0,0]),side=C.mulv(s.f.R,[0,1,0]);
        for(let k=0;k<2;k++){
          const a=e.seed*.37+k*2.4,velocity=C.add(up.map(x=>x*(.19+.025*k)),C.add(tangent.map(x=>x*Math.cos(a)*.07),side.map(x=>x*Math.sin(a)*.07)));
          const p=C.add(base,C.add(velocity.map(x=>x*age),[0,0,-.5*G*age*age]));
          if(dot(C.sub(p,base),up)<.0002)continue;
          particles.push({p,velocity:C.add(velocity,[0,0,-G*age]),r:.00065+.0002*k,stretch:1.3});
        }
      }
      return {
      surfaces,phase:state.time,particles:particles.slice(0,48),
      streams:chains.map(c=>c.map(d=>d.p)),
      radii:chains.map(c=>c.map(d=>Math.max(.0008,Math.min(.006,Math.sqrt((d.flow||0)/(Math.PI*Math.max(.05,C.norm(d.v)))))))),
    };};
    state.reset = () => { for (const v of vessels) { v.V = v.V0; v.a = [0, 0, 0]; v.vPrev = null; v.pouring = 0;v.agitation=0;v.foam=0;v.receiving=null;v.visualSplashAt=-Infinity; } state.drops = []; state.spilled = 0; state.caught = 0; state.poured = 0;state.time=0;state.visualImpacts=[]; };
    return state;
  }
  return { cylinder, volumeBelow, spout, level, surface, vessel, pour };
});
