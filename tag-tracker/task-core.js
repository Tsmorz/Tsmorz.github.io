// Robot workbench: scene construction, physical objectives, progress and a robot-mounted camera. No DOM.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./tracker-core.js'), require('./physics-core.js'), require('./cloth-core.js'), require('./cable-core.js'), require('./pour-core.js'));
  else root.TaskCore = factory(root.TagCore, root.PhysicsCore, root.ClothCore, root.CableCore, root.PourCore);
})(typeof self !== 'undefined' ? self : this, function (C, P, Cloth, Cable, Pour) {
  'use strict';
  const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const box = (p, h) => ({ type: 'box', p, h });
  const cyl = (p, r, h) => ({ type: 'cylinder', p, r, h });
  const rz = (a) => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
  // Stein dimensions (m), shared by its geometry, its liquid and its grip zone.
  const STEIN = { R: 0.05, Ri: 0.043, H: 0.13, floor: 0.01, handle: { x: 0.078, r: 0.005, w: 0.009, z0: 0.035, z1: 0.115 } };
  // A 0.5 l Weissbier bottle: outside sections {z0, z1, r} from its base, and the inside (3 mm glass) from its inner floor.
  // 72 mm across, so the jaws close on its body or neck; gripped from above, only the neck clears the palm.
  // `grip`: where the pads go, high on the neck so the palm clears the mouth by over a centimetre.
  const BOTTLE = { floor: 0.006, H: 0.241, grip: 0.221, neck: { r: 0.0135, z0: 0.185, z1: 0.236 },
    outside: [{ z0: 0, z1: 0.145, r: 0.036 }, { z0: 0.145, z1: 0.16, r: 0.03 }, { z0: 0.16, z1: 0.172, r: 0.024 }, { z0: 0.172, z1: 0.185, r: 0.018 }, { z0: 0.185, z1: 0.241, r: 0.0135 }],
    inside: [{ z0: 0, z1: 0.139, r: 0.033 }, { z0: 0.139, z1: 0.152, r: 0.028 }, { z0: 0.152, z1: 0.165, r: 0.022 }, { z0: 0.165, z1: 0.177, r: 0.016 }, { z0: 0.177, z1: 0.235, r: 0.0105 }] };
  // What a container holds and how fast its mouth lets it out (m³/s), for the pour.
  const CONTAINER = {
    stein: { shape: { sections: [{ z0: 0, z1: STEIN.H - STEIN.floor, r: STEIN.Ri }] }, floor: STEIN.floor },
    bottle: { shape: { sections: BOTTLE.inside }, floor: BOTTLE.floor, flow: 0.00016 },
  };
  function geometry(kind) {
    if (kind === 'plug-rest') return [box([0,0,.004],[.028,.024,.004]),box([0,0,.035],[.020,.005,.027])];
    if (kind === 'usb-plug') return [box([0,0,0],[.020,.007,.0055]),box([.024,0,.00115],[.004,.0042,.00015]),box([.024,0,-.00115],[.004,.0042,.00015]),box([.024,.004,0],[.004,.0002,.001]),box([.024,-.004,0],[.004,.0002,.001])];
    if (kind === 'usb-port') return [box([.005,0,.0035],[.005,.008,.002]),box([.005,0,-.0035],[.005,.008,.002]),box([.005,.0062,0],[.005,.0016,.0015]),box([.005,-.0062,0],[.005,.0016,.0015]),box([.006,0,0],[.004,.0028,.0003]),box([.011,0,0],[.001,.008,.006]),box([.012,0,-.034],[.012,.022,.028])];
    if (kind === 'book') return [box([0,0,0],[.045,.065,.012])];
    if (kind === 'block') return [box([0, 0, 0], [0.025, 0.025, 0.025])];
    if (kind === 'plate') return [cyl([0, 0, 0], 0.06, 0.006)];
    if (kind === 'bowl') {
      // A flared ceramic shell: a solid foot and overlapping, tilted wall segments.
      // The renderer revolves the same cross-section instead of drawing the collision seams.
      const profile = [[0,0],[.064,0],[.073,.002],[.077,.007],[.092,.044],[.093,.048],[.092,.051],[.089,.052],[.087,.050],[.085,.044],[.071,.012],[.067,.008],[0,.008]];
      const parts = [{ ...cyl([0, 0, 0.004], 0.076, 0.004), bowlProfile: profile }];
      const dr = .016, dz = .041, len = Math.hypot(dr, dz), tilt = Math.atan2(dr, dz);
      for (let i = 0; i < 32; i++) {
        const a = i * Math.PI / 16;
        const ry = [Math.cos(tilt),0,Math.sin(tilt),0,1,0,-Math.sin(tilt),0,Math.cos(tilt)];
        parts.push({ ...box([.082 * Math.cos(a), .082 * Math.sin(a), .0285], [.003, .082 * Math.tan(Math.PI / 32) * 1.04, len / 2 + .001]), R: C.mul3(rz(a), ry) });
      }
      return parts;
    }
    if (kind === 'stein') {
      // A stoneware stein, 100 mm across: wider than the jaws open (90 mm), so only its handle can be gripped.
      // The renderer revolves `profile`; collision uses a floor disc, a ring of wall segments and a D-shaped handle.
      const R = STEIN.R, Ri = STEIN.Ri, H = STEIN.H, wall = (R - Ri) / 2, n = 28, hx = STEIN.handle;
      const profile = [[0,0],[R-.002,0],[R,.003],[R,H-.004],[R-.0015,H],[Ri+.0015,H],[Ri,H-.004],[Ri,STEIN.floor+.002],[Ri-.002,STEIN.floor],[0,STEIN.floor]];
      const parts = [{ ...cyl([0, 0, STEIN.floor / 2], R, STEIN.floor / 2), profile }];
      for (let i = 0; i < n; i++) { const a = i * 2 * Math.PI / n, rr = Ri + wall; parts.push({ ...box([rr * Math.cos(a), rr * Math.sin(a), (STEIN.floor + H) / 2], [wall, rr * Math.tan(Math.PI / n) * 1.05, (H - STEIN.floor) / 2]), R: rz(a) }); }
      // the handle: a vertical bar joined to the wall by two arms, all 18 mm thick across y so the pads can close on it
      parts.push({ ...box([hx.x, 0, (hx.z0 + hx.z1) / 2], [hx.r, hx.w, (hx.z1 - hx.z0) / 2]), show: true });
      for (const z of [hx.z0 + .005, hx.z1 - .005]) parts.push({ ...box([(R - .002 + hx.x - hx.r) / 2, 0, z], [(hx.x - hx.r - R + .002) / 2 + .001, hx.w, .005]), show: true });
      parts.push(...[.009,H-.005].map(z=>({type:'trim',p:[0,0,z],r:R+.001,h:.002,visual:true,show:true,material:'pewter'})),
        {type:'lozenges',p:[0,0,.063],r:R+.0015,h:.038,visual:true,show:true,material:'labelBand'},
        {type:'ellipsoid',p:[-.052,0,.07],r:[.002,.022,.029],visual:true,show:true,material:'gold'},
        {type:'ellipsoid',p:[-.054,0,.07],r:[.002,.019,.026],visual:true,show:true,material:'labelBand'},
        {type:'ellipsoid',p:[-.056,0,.071],r:[.002,.009,.016],visual:true,show:true,material:'label'});
      return parts;
    }
    if (kind === 'bottle') {
      // Collision: solid stacked cylinders. Drawn: one smooth brown-glass revolve plus a paper label and band.
      const parts = BOTTLE.outside.map((x, i) => ({ ...cyl([0, 0, (x.z0 + x.z1) / 2], x.r, (x.z1 - x.z0) / 2), ...(i ? {} : { profile: [[0,0],[.034,0],[.036,.004],[.036,.145],[.031,.158],[.023,.171],[.0155,.184],[.0135,.196],[.0135,.231],[.0152,.233],[.0152,.24],[.011,.241],[.0105,.237],[.0105,.228]] }) }));
      // (paper stands ~1 mm proud of the glass so the two surfaces never fight in the depth buffer)
      parts.push({ ...cyl([0, 0, .075], .0372, .038), visual: true, show: true, material: 'label' }, { ...cyl([0, 0, .116], .0373, .003), visual: true, show: true, material: 'labelBand' }, { ...cyl([0, 0, .212], .0145, .012), visual: true, show: true, material: 'label' },
        {type:'lozenges',p:[0,0,.075],r:.0385,h:.024,visual:true,show:true,material:'labelBand'},
        ...[.036,.112,.2,.224].map(z=>({type:'trim',p:[0,0,z],r:z>.15?.0155:.038,h:.0015,visual:true,show:true,material:'gold'})),
        {type:'ellipsoid',p:[-.039,0,.078],r:[.002,.022,.029],visual:true,show:true,material:'gold'},
        {type:'ellipsoid',p:[-.041,0,.078],r:[.002,.019,.026],visual:true,show:true,material:'labelBand'},
        {type:'ellipsoid',p:[-.043,0,.08],r:[.002,.008,.016],visual:true,show:true,material:'label'});
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
      const zone = s.kind === 'stein' ? { grip_zone: { min: [STEIN.R + .002, -.03, .02], max: [STEIN.handle.x + .03, .03, STEIN.H + .01] } } : {};
      const b = W.add(s.kind === 'ball' || s.kind === 'cup' ? s.kind : { ...s, ...zone, pieces: geometry(s.kind) }, at(s.at), C.mul3(table.R, s.R || I));
      Object.assign(b, { key: s.key, color: s.color, label: s.label }); byKey.set(s.key, b);
    }
    for (const s of level.cloths || []) { const c = Cloth.towel(s, table); W.cloths.push(c); byKey.set(s.key, c); }
    for (const s of level.cables || []) { const c = Cable.cable(s, table, byKey.get(s.plug),s.anchor_body?byKey.get(s.anchor_body):null); W.cables.push(c); byKey.set(s.key,c); }
    for (const r of level.goals.filter(r=>r.type==='insert')) {
      const plug=byKey.get(r.object),port=byKey.get(r.target);
      W.contactGenerators.push(()=>Cable.sleeveContacts(W,plug,port));
      W.mechanisms.push(()=>{ plug.insertion=Cable.insertion(W,plug,port); });
    }
    const game = { level, world: W, byKey, elapsed: 0, complete: false, dwell: 0, heldBy: new Map(), dual: new Set(), steps: [], started: false, stars: 0, gripper };
    game.local = (p) => C.mulv(C.tr3(table.R), C.sub(p, table.t));
    game.reset = () => { W.reset(); game.elapsed = 0; game.clockStart = null; game.complete = false; game.dwell = 0; game.heldBy.clear(); game.dual.clear(); game.started = false; game.stars = 0; game.steps = []; if(level.balance)game.balance={rimHit:false,liftTime:0}; };
    if(level.balance){
      game.balance={rimHit:false,liftTime:0};
      const spec=level.balance,tray=byKey.get(spec.tray),ball=byKey.get(spec.ball);
      W.mechanisms.push(dt=>{
        const state=game.balance,tp=W.poseOf(tray),bp=W.poseOf(ball),q=C.mulv(C.tr3(tp.R),C.sub(bp.t,tp.t));
        const hands=Object.values(W.hands).filter(h=>h.grip?.body===tray),height=game.local(tp.t)[2];
        {
          const rim=P.shapeDistance(q,tray.pieces.slice(1))<=P.BALL.r+.0006;
          const lost=Math.abs(q[0])>.085||Math.abs(q[1])>.19||q[2]<-.015||q[2]>.12;
          if(rim||lost)state.rimHit=true;
        }
        if(!state.rimHit&&hands.length===2&&height>=spec.min_height)state.liftTime+=dt;
        else if(state.liftTime<spec.seconds)state.liftTime=0;
      });
    }
    if(level.pour){
      // Beer poured from one stein into the other: more than `spill_limit` of it outside both spoils the attempt.
      const spec=level.pour,V0=spec.litres/1000,container=key=>CONTAINER[byKey.get(key).kind];
      const from=Pour.vessel(byKey.get(spec.from),{...container(spec.from),volume:V0}),to=Pour.vessel(byKey.get(spec.to),{...container(spec.to),volume:0});
      const solid=(q,skip)=>W.bodies.some(b=>b!==skip&&b.pieces&&C.norm(C.sub(q,b.t))<b.bound+.005&&P.bodyDistance(b,C.sub(C.mulv(C.tr3(b.R),C.sub(q,b.t)),b.off))<0);
      game.pour=Pour.pour(W,[from,to],table,solid);game.pour.from=from;game.pour.to=to;game.pour.V0=V0;game.pour.spoiled=false;
      W.mechanisms.push(dt=>{game.pour.step(dt);if(game.pour.spilled>spec.spill_limit*V0)game.pour.spoiled=true;});
      const reset=game.reset;game.reset=()=>{reset();game.pour.reset();game.pour.spoiled=false;};
    }
    return game;
  }
  const within = (p, q, tolerance) => p.every((v, i) => Math.abs(v - q[i]) < tolerance[i]);
  // A prop (or most of a cloth) below the tabletop has left the table: the attempt is over. Returns its label or null.
  // The table is 3 cm thick, so 4 cm below its top can only be past an edge, never resting on it.
  function fallen(g) {
    const W = g.world, low = (p) => g.local(p)[2] < -0.04;
    for (const b of W.bodies) if (!b.fixed && b.key && low(W.poseOf(b).t)) return b.label || b.key;
    for (const c of W.cloths) if (c.nodes.filter((n) => low(n.p)).length > c.nodes.length / 2) return c.label || c.key;
    return null;
  }
  function update(g, dt, active, clock) {
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
    if (g.started) {
      if(Number.isFinite(clock)){if(g.clockStart==null)g.clockStart=clock-g.elapsed;g.elapsed=Math.max(g.elapsed,clock-g.clockStart);}
      else g.elapsed+=dt;
    }
    const released = (b) => !holds.has(b.key);
    const settled = (b) => C.norm(b.v) < 0.04 && C.norm(b.w) < 0.25;
    g.steps = g.level.goals.map((r) => {
      const b = g.byKey.get(r.object);
      if(r.type==='balance')return !g.balance.rimHit&&g.balance.liftTime>=g.level.balance.seconds;
      if(g.balance?.rimHit)return false;
      if(r.type==='aboard'){
        const tray=g.byKey.get(r.target),tp=W.poseOf(tray),q=C.mulv(C.tr3(tp.R),C.sub(W.poseOf(b).t,tp.t));
        return released(b)&&settled(b)&&settled(tray)&&Math.abs(q[0])+P.BALL.r<.077&&Math.abs(q[1])+P.BALL.r<.182&&Math.abs(q[2]-(.006+P.BALL.r))<.015;
      }
      if(r.type==='pour'){
        // Emptied into the other stein, both set down upright, released and still, nothing still falling.
        const p=g.pour,steins=[p.from.body,p.to.body];
        return !p.spoiled&&p.from.V<=r.empty*p.V0&&!p.drops.length&&steins.every(s=>released(s)&&settled(s)&&C.mulv(C.tr3(W.table.R),[W.poseOf(s).R[2],W.poseOf(s).R[5],W.poseOf(s).R[8]])[2]>Math.cos(.26)&&g.local(W.poseOf(s).t)[2]<.01);
      }
      if (r.type === 'fold') {
        const f = Cloth.folded(b), ps = b.nodes.map((n) => g.local(n.p)), mid = [0, 1, 2].map((i) => ps.reduce((s, p) => s + p[i], 0) / ps.length);
        const span = [0, 1].map((i) => Math.max(...ps.map((p) => p[i])) - Math.min(...ps.map((p) => p[i])));
        if(b.kind==='towel'&&!b.pins.size&&b.firstHands.size===2&&f.x&&f.compact)b.foldStage=1;
        return (b.kind==='shirt' ? f.complete : r.folds===2 ? b.foldStage===1&&b.foldHands.size===2&&f.complete : (f.x || f.y) && f.compact && Math.max(...span) > Math.min(b.width, b.height) * 0.75) && b.pins.size === 0 && b.touched.size === 2
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
    if(g.balance){
      const spec=g.level.balance,base={index:0,object:spec.tray};
      if(g.balance.rimHit)return {...base,state:'tray_retry'};
      const holds=held.filter(h=>h.grip.body.key===spec.tray);
      if(g.balance.liftTime<spec.seconds)return {...base,state:holds.length<2?'dual':g.local(W.poseOf(g.byKey.get(spec.tray)).t)[2]<spec.min_height?'tray_lift':'tray_hold'};
      const goal=goals.find(r=>r.type==='place'),tray=g.byKey.get(spec.tray),p=g.local(W.poseOf(tray).t);
      if(holds.length)return {...base,index:1,at:goal.at,state:within(p,goal.at,goal.tolerance)?'release':'tray_move'};
      return {...base,index:1,at:goal.at,state:'settle'};
    }
    if(g.pour){
      const p=g.pour,A=p.from.body,B=p.to.body,base={index:0,object:A.key,target:B.key,at:g.local(W.poseOf(B).t)},state=s=>({...base,state:s});
      const holding=b=>held.some(h=>h.grip.body===b),a=g.local(W.poseOf(A).t),upright=b=>{const R=W.poseOf(b).R;return C.mulv(C.tr3(W.table.R),[R[2],R[5],R[8]])[2]>Math.cos(.26);};
      if(p.spoiled)return state('pour_spilled');
      if(p.from.V>goals[0].empty*p.V0){
        if(!holding(A))return state(A.gripZone&&Object.values(W.hands).some(h=>!h.grip&&h.touch[0]===A&&h.touch[1]===A)?'pour_handle':'pour_grab');
        if(a[2]<.03&&!p.from.pouring)return state('pour_lift');
        // judged by the mouth, which a tipped bottle holds far from its base; beer flowing is pouring
        const mouth=g.local(C.add(W.poseOf(A).t,C.mulv(W.poseOf(A).R,[0,0,p.from.floor+p.from.h])));
        return state(p.from.pouring>0||Math.hypot(mouth[0]-base.at[0],mouth[1]-base.at[1])<.12?'pour_tilt':'pour_move');
      }
      if(holding(A)||!upright(A)||a[2]>.01)return {...state('pour_set_down'),at:null};
      if(holding(B))return {...state('release'),object:B.key};
      return state('settle');
    }
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
      if(b.kind==='shirt'){
        const f=Cloth.folded(b);
        if([...b.pins.values()].some(p=>{const y=b.material[p.i][1];return y>b.bodySpan/2&&f.sleeves[0]||y<-b.bodySpan/2&&f.sleeves[1];}))return result('shirt_sleeve_release');
        if(!f.sleeves[0])return result('shirt_left');
        if(!f.sleeves[1])return result('shirt_right');
        return result(f.complete?(b.pins.size?'shirt_release':'settle'):b.pins.size>=2?'shirt_fold':'shirt_hem');
      }
      if(r.folds===2){
        const f=Cloth.folded(b),second=b.foldStage===1;
        if(second&&b.pins.size===2&&[...b.pins.values()].some(p=>!p.throughFold))return result('towel_layers');
        if(second&&!b.foldHands.size&&!f.x)return result('towel_repair');
        if(second&&b.foldHands.size===2&&!b.pins.size&&!f.complete)return result('towel_tidy');
        if(f.complete&&second&&b.foldHands.size===2)return result(b.pins.size?'towel_release':'settle');
        if(second)return result(b.pins.size>=2?'towel_second_move':'towel_second_grab');
        if(f.x&&f.compact&&b.pins.size)return result('towel_first_release');
        return result(b.pins.size>=2?'towel_first_move':'towel_first_grab');
      }
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
      const legacy=l.legacy_id&&raw[l.legacy_id];
      const p = raw[l.id] || (legacy&&!legacy.revision?legacy:null);
      if (p && (!l.revision||p.revision===l.revision) && Number.isFinite(p.time) && p.time >= 0 && Number.isInteger(p.stars) && p.stars >= 1 && p.stars <= 3) out[l.id] = { stars: p.stars, time: p.time, ...(l.revision?{revision:l.revision}:{}) };
    }
    return out;
  }
  function best(previous, game) {
    return { stars: Math.max(previous ? previous.stars : 0, game.stars), time: Math.min(previous ? previous.time : Infinity, game.elapsed), ...(game.level?.revision?{revision:game.level.revision}:{}) };
  }
  function headCamera(chest, m, tilt, w, h) {
    const a = Math.max(-80, Math.min(25, Number.isFinite(tilt) ? tilt : -40)) * Math.PI / 180;
    const eye = C.add(chest.t, C.mulv(chest.R, [-m.back + 0.02 + 0.078 * Math.cos(a), 0, m.up + 0.17 + 0.078 * Math.sin(a)]));
    const fwd = C.mulv(chest.R, [Math.cos(a), 0, Math.sin(a)]), right = C.mulv(chest.R, [0, -1, 0]), up = C.mulv(chest.R, [-Math.sin(a), 0, Math.cos(a)]);
    // At least 90° across and 60° vertically: both hands and the table fit even in a wide viewport.
    const f = Math.min(w / 2, h / (2 * Math.tan(Math.PI / 6))), fov = 2 * Math.atan(h / (2 * f)) * 180 / Math.PI;
    return { eye, fwd, right, up, fov, project(p) { const d = C.sub(p, eye), z = d.reduce((s, v, i) => s + v * fwd[i], 0); if (z < 0.001) return null;
      return [w / 2 + f * d.reduce((s, v, i) => s + v * right[i], 0) / z, h / 2 - f * d.reduce((s, v, i) => s + v * up[i], 0) / z, z]; } };
  }
  return { geometry, mission, create, update, guidance, progress, best, headCamera, fallen, STEIN, BOTTLE };
});
