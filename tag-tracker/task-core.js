// Robot workbench: scene construction, physical objectives, progress and a robot-mounted camera. No DOM.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./tracker-core.js'), require('./physics-core.js'), require('./cloth-core.js'), require('./cable-core.js'));
  else root.TaskCore = factory(root.TagCore, root.PhysicsCore, root.ClothCore, root.CableCore);
})(typeof self !== 'undefined' ? self : this, function (C, P, Cloth, Cable) {
  'use strict';
  const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const box = (p, h) => ({ type: 'box', p, h });
  const cyl = (p, r, h) => ({ type: 'cylinder', p, r, h });
  const rz = (a) => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
  function geometry(kind) {
    if (kind === 'plug-rest') return [box([0,0,.004],[.028,.024,.004]),box([0,0,.035],[.018,.003,.027])];
    if (kind === 'usb-plug') return [box([0,0,0],[.020,.007,.0055]),box([.024,0,.00115],[.004,.0042,.00015]),box([.024,0,-.00115],[.004,.0042,.00015]),box([.024,.004,0],[.004,.0002,.001]),box([.024,-.004,0],[.004,.0002,.001])];
    if (kind === 'usb-port') return [box([.005,0,.0035],[.005,.008,.002]),box([.005,0,-.0035],[.005,.008,.002]),box([.005,.0062,0],[.005,.0016,.0015]),box([.005,-.0062,0],[.005,.0016,.0015]),box([.006,0,0],[.004,.0028,.0003]),box([.011,0,0],[.001,.008,.006]),box([.012,0,-.034],[.012,.022,.028])];
    if (kind === 'book') return [box([0,0,0],[.045,.065,.012])];
    if (kind === 'block') return [box([0, 0, 0], [0.025, 0.025, 0.025])];
    if (kind === 'plate') return [cyl([0, 0, 0], 0.06, 0.006)];
    if (kind === 'bowl') {
      const parts = [cyl([0, 0, 0.005], 0.088, 0.005)];
      for (let i = 0; i < 20; i++) {
        const a = i * Math.PI / 10;
        parts.push({ ...box([0.084 * Math.cos(a), 0.084 * Math.sin(a), 0.027], [0.004, 0.014, 0.022]), R: rz(a) });
      }
      return parts;
    }
    if (kind === 'tray') return [box([0, 0, 0], [0.085, 0.19, 0.006]), ...[-1, 1].flatMap((s) => [box([s * 0.081, 0, 0.014], [0.004, 0.19, 0.014]), box([0, s * 0.186, 0.014], [0.085, 0.004, 0.014])])];
    if (kind === 'rack') {
      // An open dishwasher rack with real dividers: three 2.6 cm slots for plates held upright across y.
      const parts = [box([0, 0, 0.006], [0.095, 0.135, 0.006])];
      for (const y of [-0.105, -0.035, 0.035, 0.105]) for (const x of [-0.06, 0.06]) parts.push(box([x, y, 0.045], [0.004, 0.004, 0.04]));
      parts.push(box([0.091, 0, 0.06], [0.004, 0.135, 0.06]));
      return parts;
    }
    throw new Error('Unknown task geometry: ' + kind);
  }
  // Small tasks retain the full challenge as a separate selectable variant.
  function mission(level, mode) {
    if (mode !== 'guided' || !level.guided) return level;
    const l=JSON.parse(JSON.stringify(level)),s=l.guided;
    l.name=s.name;l.brief=s.brief;l.par=s.par;
    l.objects=(s.objects || l.objects || []).filter(o=>!s.keep || s.keep.includes(o.key));
    l.cloths=(s.cloths || l.cloths || []).filter(o=>!s.keep || s.keep.includes(o.key));
    for(const o of l.objects)if(s.placements&&s.placements[o.key])o.at=s.placements[o.key];
    l.goals=s.goals || (s.goal_indices?s.goal_indices.map(i=>l.goals[i]):l.goals.slice(0,s.goal_count));
    if(s.goal_x!==undefined)for(const r of l.goals)if(r.at)r.at[0]=s.goal_x;
    if(s.markers)l.markers=s.markers;
    return l;
  }
  function create(level, table, gripper) {
    const W = P.world({ table, gripper }), byKey = new Map();
    const at = (p) => C.add(table.t, C.mulv(table.R, p));
    for (const s of level.objects || []) {
      const b = W.add(s.kind === 'ball' || s.kind === 'cup' ? s.kind : { ...s, pieces: geometry(s.kind) }, at(s.at), C.mul3(table.R, s.R || I));
      Object.assign(b, { key: s.key, color: s.color, label: s.label }); byKey.set(s.key, b);
    }
    for (const s of level.cloths || []) { const c = Cloth.towel(s, table); W.cloths.push(c); byKey.set(s.key, c); }
    for (const s of level.cables || []) { const c = Cable.cable(s, table, byKey.get(s.plug)); W.cables.push(c); byKey.set(s.key,c); }
    for (const r of level.goals.filter(r=>r.type==='insert')) {
      const plug=byKey.get(r.object),port=byKey.get(r.target);
      W.contactGenerators.push(()=>Cable.sleeveContacts(W,plug,port));
      W.mechanisms.push(()=>{ plug.insertion=Cable.insertion(W,plug,port); });
    }
    const game = { level, world: W, byKey, elapsed: 0, complete: false, dwell: 0, heldBy: new Map(), dual: new Set(), steps: [], started: false, stars: 0, gripper };
    game.local = (p) => C.mulv(C.tr3(table.R), C.sub(p, table.t));
    game.reset = () => { W.reset(); game.elapsed = 0; game.complete = false; game.dwell = 0; game.heldBy.clear(); game.dual.clear(); game.started = false; game.stars = 0; game.steps = []; };
    return game;
  }
  const within = (p, q, tolerance) => p.every((v, i) => Math.abs(v - q[i]) < tolerance[i]);
  function update(g, dt, active) {
    if (g.complete) return g;
    const W = g.world, holds = new Map();
    for (const [side, h] of Object.entries(W.hands)) if (h.grip) {
      const key = h.grip.body.key; if (!holds.has(key)) holds.set(key, new Set()); holds.get(key).add(+side);
      if (!g.heldBy.has(key)) g.heldBy.set(key, new Set()); g.heldBy.get(key).add(+side);
    }
    for (const [key, sides] of holds) if (sides.size === 2) {
      const b = g.byKey.get(key), p = g.local(W.poseOf(b).t);
      if (p[2] > 0.04) g.dual.add(key);
    }
    if (active || holds.size || W.cloths.some(c=>c.pins.size) || W.cables.some(c=>c.pins.size)) g.started = true;
    if (g.started) g.elapsed += dt;
    const released = (b) => !holds.has(b.key);
    const settled = (b) => C.norm(b.v) < 0.04 && C.norm(b.w) < 0.25;
    g.steps = g.level.goals.map((r) => {
      const b = g.byKey.get(r.object);
      if (r.type === 'fold') {
        const f = Cloth.folded(b), ps = b.nodes.map((n) => g.local(n.p)), mid = [0, 1, 2].map((i) => ps.reduce((s, p) => s + p[i], 0) / ps.length);
        const span = [0, 1].map((i) => Math.max(...ps.map((p) => p[i])) - Math.min(...ps.map((p) => p[i])));
        return (f.x || f.y) && f.compact && Math.max(...span) > Math.min(b.width, b.height) * 0.75 && b.pins.size === 0 && b.touched.size === 2
          && within(mid, r.at, r.tolerance) && b.nodes.every((n) => C.norm(n.v) < 0.05);
      }
      const pose = W.poseOf(b), p = g.local(pose.t);
      if (!released(b) || !settled(b)) return false;
      if (r.type === 'insert') return !!b.insertion?.seated && W.cables.filter(c=>c.plug===b).every(c=>c.pins.size===0);
      if (r.type === 'inside') {
        const vessel = g.byKey.get(r.target), vp = W.poseOf(vessel), q = C.mulv(C.tr3(vp.R), C.sub(pose.t, vp.t));
        const radius = vessel.kind === 'cup' ? P.CUP.Ri : 0.08, floor = vessel.kind === 'cup' ? P.CUP.floor : 0.01;
        if (Math.hypot(q[0], q[1]) > radius - P.BALL.r + 0.002 || q[2] < floor + P.BALL.r - 0.003 || q[2] > floor + P.BALL.r + 0.012 || !settled(vessel)) return false;
      } else if (!within(p, r.at, r.tolerance)) return false;
      if (r.upright !== undefined) {
        const localR = C.mul3(C.tr3(W.table.R), pose.R);
        if (r.upright === true && localR[8] < 0.94 || r.upright === false && Math.abs(localR[8]) > 0.2) return false;
      }
      if (r.handoff && (g.heldBy.get(r.object) || new Set()).size !== 2) return false;
      if (r.dual && !g.dual.has(r.object)) return false;
      return true;
    });
    const all = g.started && g.steps.every(Boolean);
    g.dwell = all ? g.dwell + dt : 0;
    if (g.dwell >= 0.75) { g.complete = true; g.stars = 1 + (g.elapsed <= g.level.par ? 1 : 0) + (W.respawns === 0 ? 1 : 0); }
    return g;
  }
  function guidance(g) {
    const W=g.world,goals=g.level.goals,held=Object.values(W.hands).filter(h=>h.grip);
    let index=goals.findIndex((r,i)=>!g.steps[i]);
    if(g.complete)return {state:'done',index:0,object:goals[0].object};
    const selected=goals.findIndex((r,i)=>!g.steps[i]&&held.some(h=>h.grip.body.key===r.object));
    if(selected>=0)index=selected;
    if(index<0)index=0;
    if(!held.length&&goals.some((r,i)=>!g.steps[i])){
      for(let i=0;i<goals.length;i++)if(g.steps[i]&&goals[i].type!=='fold'){
        const placed=g.local(W.poseOf(g.byKey.get(goals[i].object)).t);
        for(const h of Object.values(W.hands)){
          const wrist=W.handPose(h.side),point=g.local(C.add(wrist.t,C.mulv(wrist.R,[0,0,g.gripper.finger.c[2]])));
          if(Math.hypot(point[0]-placed[0],point[1]-placed[1])<.09&&point[2]<placed[2]+.08)return {state:'clear',index:i,object:goals[i].object,next:goals[index].object,at:goals[i].at};
        }
      }
    }
    const r=goals[index],b=g.byKey.get(r.object),holds=held.filter(h=>h.grip.body===b),base={index,object:r.object,target:r.target||null};
    const result=state=>({...base,state});
    if(r.type==='fold'){
      if(b.pins.size===1)return result('fold_second');
      if(b.pins.size){const f=Cloth.folded(b);return result((f.x||f.y)&&f.compact?'fold_release':'fold_move');}
      return result(b.touched.size===2&&(Cloth.folded(b).x||Cloth.folded(b).y)&&Cloth.folded(b).compact?'settle':'fold_grab');
    }
    if(r.type==='insert'){
      base.at=g.local(W.poseOf(g.byKey.get(r.target)).t);
      if(b.insertion?.seated)return result(holds.length?'usb_release':W.cables.some(c=>c.plug===b&&c.pins.size)?'usb_cable_release':'settle');
      return result(holds.length?(b.insertion?.aligned?'usb_insert':'usb_align'):'usb_grab');
    }
    const pose=W.poseOf(b),p=g.local(pose.t),destination=r.type==='inside'?g.local(W.poseOf(g.byKey.get(r.target)).t):r.at;
    base.at=destination;
    const xy=Math.hypot(p[0]-destination[0],p[1]-destination[1]),floor=r.type==='inside'?(g.byKey.get(r.target).kind==='cup'?P.CUP.floor:.01)+P.BALL.r:destination[2];
    const localR=C.mul3(C.tr3(W.table.R),pose.R),upright=r.upright===undefined||(r.upright===true?localR[8]>=.94:Math.abs(localR[8])<=.2);
    const aligned=r.type==='inside'?xy<Math.min(.035,(g.byKey.get(r.target).kind==='cup'?P.CUP.Ri:.08)-P.BALL.r-.004):Math.abs(p[0]-destination[0])<(r.tolerance?.[0]||.035)*.8&&Math.abs(p[1]-destination[1])<(r.tolerance?.[1]||.035)*.8;
    if(holds.length){
      if(r.handoff&&(g.heldBy.get(r.object)||new Set()).size<2)return result('handoff');
      if(r.dual&&holds.length<2)return result('dual');
      if(!upright)return result('orient');
      if(!aligned){
        const start=(g.level.objects||[]).find(o=>o.key===r.object),height=(start?start.at[2]:0)+.055;
        return result(p[2]<height?'lift':'move');
      }
      return result(p[2]>floor+(r.type==='inside'?.10:.035)?'lower':'release');
    }
    if(aligned&&Math.abs(p[2]-floor)<.025&&upright&&(!r.dual||g.dual.has(r.object))&&(!r.handoff||(g.heldBy.get(r.object)||new Set()).size===2))return result('settle');
    if(held.length)return {...base,state:'wrong',held:held[0].grip.body.key};
    if(r.dual)return result('dual');
    for(const h of Object.values(W.hands)){
      const wrist=W.handPose(h.side),point=C.add(wrist.t,C.mulv(wrist.R,[0,0,g.gripper.finger.c[2]]));
      if(C.norm(C.sub(point,pose.t))<.065){
        if(h.target<g.gripper.gapMax*.2&&h.gap<.015)return result('retry');
        if(C.norm(C.sub(point,pose.t))<.035)return result('grip');
      }
    }
    return result('approach');
  }
  function progress(raw, levels) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const l of levels) {
      const p = raw[l.id];
      if (p && Number.isFinite(p.time) && p.time >= 0 && Number.isInteger(p.stars) && p.stars >= 1 && p.stars <= 3) out[l.id] = { stars: p.stars, time: p.time };
    }
    return out;
  }
  function best(previous, game) {
    return { stars: Math.max(previous ? previous.stars : 0, game.stars), time: Math.min(previous ? previous.time : Infinity, game.elapsed) };
  }
  function headCamera(chest, m, tilt, w, h) {
    const a = Math.max(-80, Math.min(25, Number.isFinite(tilt) ? tilt : -40)) * Math.PI / 180;
    const eye = C.add(chest.t, C.mulv(chest.R, [-m.back + 0.02 + 0.078 * Math.cos(a), 0, m.up + 0.17 + 0.078 * Math.sin(a)]));
    const fwd = C.mulv(chest.R, [Math.cos(a), 0, Math.sin(a)]), right = C.mulv(chest.R, [0, -1, 0]), up = C.mulv(chest.R, [-Math.sin(a), 0, Math.cos(a)]);
    // Fixed 70° horizontal field of view: portrait screens still show both hands instead of cropping them away.
    const f = w / (2 * Math.tan(35 * Math.PI / 180)), fov = 2 * Math.atan(h / (2 * f)) * 180 / Math.PI;
    return { eye, fwd, right, up, fov, project(p) { const d = C.sub(p, eye), z = d.reduce((s, v, i) => s + v * fwd[i], 0); if (z < 0.001) return null;
      return [w / 2 + f * d.reduce((s, v, i) => s + v * right[i], 0) / z, h / 2 - f * d.reduce((s, v, i) => s + v * up[i], 0) / z, z]; } };
  }
  return { geometry, mission, create, update, guidance, progress, best, headCamera };
});
