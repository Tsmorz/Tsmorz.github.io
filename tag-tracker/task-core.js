// Robot workbench: scene construction, physical objectives, progress and a robot-mounted camera. No DOM.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./tracker-core.js'), require('./physics-core.js'), require('./cloth-core.js'), require('./cable-core.js'), require('./charging-core.js'));
  else root.TaskCore = factory(root.TagCore, root.PhysicsCore, root.ClothCore, root.CableCore, root.ChargingCore);
})(typeof self !== 'undefined' ? self : this, function (C, P, Cloth, Cable, Charging) {
  'use strict';
  const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const box = (p, h) => ({ type: 'box', p, h });
  const cyl = (p, r, h) => ({ type: 'cylinder', p, r, h });
  const rz = (a) => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
  function geometry(kind) {
    if(kind==='phone-rest')return [box([0,0,.004],[.082,.044,.004]),box([0,0,.024],[.058,.008,.016])];
    if(kind==='charger')return [{...box([0,0,0],[.020,.025,.029]),material:'shell'},...[-1,1].map(sign=>({...cyl([.0295,sign*.0095,0],.002,.0095),R:[0,0,1,0,1,0,-1,0,0],material:'metal'}))];
    if(kind==='outlet')return [box([.029,0,-.03],[.009,.042,.070]),box([.010,0,.019],[.010,.04,.0163]),box([.010,0,-.019],[.010,.04,.0163]),box([.010,0,0],[.010,.0068,.0027]),...[-1,1].map(sign=>box([.010,sign*.0261,0],[.010,.0139,.0027]))];
    if(kind==='phone')return [{...box([.006,0,0],[.072,.035,.0045]),material:'metal'},...[-1,1].flatMap(sign=>[{...box([-.072,sign*.0198,0],[.006,.0152,.0045]),material:'metal'},{...box([-.072,0,sign*.003],[.006,.0046,.0015]),material:'metal'}]),{...box([-.072,0,0],[.004,.0028,.0003]),material:'dark'},{...box([.006,0,.0048],[.067,.032,.0003]),material:'glass'},...[-.042,-.022,-.002].flatMap(x=>[{...cyl([x,-.024,-.0055],.0055,.001),material:'metal'},{...cyl([x,-.024,-.0066],.0043,.00015),material:'glass'}])];
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
    if(level.charging)Charging.attach(game);
    return game;
  }
  const within = (p, q, tolerance) => p.every((v, i) => Math.abs(v - q[i]) < tolerance[i]);
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
      if(r.type==='power')return g.charging.wallDwell>.3;
      if(r.type==='charge')return Charging.complete(g);
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
    if(g.charging){const state=Charging.guidance(g),first=g.charging.wallDwell<.3,s=g.level.charging,object=first?s.charger:state==='phone_pickup'?s.phone:s.plug,target=first?s.outlet:s.phone;return {state,index:first?0:1,object,target,at:g.local(W.poseOf(g.byKey.get(target)).t)};}
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
  return { geometry, mission, create, update, guidance, progress, best, headCamera };
});
