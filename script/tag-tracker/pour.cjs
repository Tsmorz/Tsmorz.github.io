// Called by script/test-tag-tracker section 5n. A Weissbier bottle poured into a mug, and props off the table.
module.exports = function ({ check }) {
  const root = require('path').resolve(__dirname, '../..'), C = require(root + '/tag-tracker/tracker-core'), R = require(root + '/tag-tracker/robot-core');
  const T = require(root + '/tag-tracker/task-core'), Pour = require(root + '/tag-tracker/pour-core');
  const data = JSON.parse(require('child_process').execFileSync('ruby', ['-ryaml', '-rjson', '-e', 'puts JSON.generate(YAML.load_file(ARGV[0]))', root + '/_data/tag_tasks.yml']));
  const I = [1, 0, 0, 0, 1, 0, 0, 0, 1], table = { R: I, t: [0, 0, 0], size: [0.5, 0.9], thick: 0.03 }, G = R.gripper(R.model()), S = T.STEIN, BO = T.BOTTLE, level = data.levels.find((l) => l.id === 'pour');
  const tilted = (deg) => { const a = (deg * Math.PI) / 180; return [Math.sin(a), 0, Math.cos(a)]; };

  // The level surface: a mug against a tilted cylinder's closed form; a bottle holds its beer until the neck tips.
  const r = 0.043, h = 0.12, mug = Pour.cylinder(r, h), full = Math.PI * r * r * h;
  check(Math.abs(Pour.volumeBelow([0, 0, 1], h / 2, mug) / full - 0.5) < 1e-9, 'an upright mug half full holds half its volume');
  check([10, 20].every((d) => Math.abs(Pour.spout(tilted(d), mug).capacity / full - (1 - (r * Math.tan((d * Math.PI) / 180)) / h)) < 0.005), 'a tilted mug holds what reaches its lowest rim point, as the closed form says');
  const n = tilted(25), V = full * 0.5, d = Pour.level(n, V, mug);
  check(Math.abs(Pour.volumeBelow(n, d, mug) / V - 1) < 1e-4 && Pour.surface(n, d, mug).length > 20, 'the level is found for a volume, with a closed surface outline');
  const bottle = { sections: BO.inside }, holds = (deg) => Pour.spout(tilted(deg), bottle).capacity;
  check(holds(0) > 0.00055 && holds(60) > 0.0005 && holds(110) < 0.00001, 'a full 0.5 l bottle keeps its beer past 60 degrees and is empty by 110: ' + JSON.stringify([0, 60, 90, 110].map((x) => Math.round(holds(x) * 1e6))));
  check(Pour.surface(tilted(10), 0.1, bottle).length === 0, "a bottle's hidden surface is not drawn");
  const GL=require(root+'/tag-tracker/robot-gl'),stream=GL.cableMesh({nodes:[{p:[0,0,0]},{p:[0,0,-.1]}],radius:.006,radii:[.006,.003],boot:false});
  check(Math.abs(Math.hypot(...stream.pos.slice(0,2))-.006)<1e-8&&Math.abs(Math.hypot(...stream.pos.slice(-3,-1))-.003)<1e-8,'a falling stream narrows as it accelerates rather than using one cable-like thickness');

  const play = () => {
    const g = T.create(T.mission(level, 'guided'), table, G), W = g.world, p = g.pour, A = p.from.body, B = p.to.body, hand = { R: I, t: [0, 0, 0.35], open: 1 };
    const tick = () => { W.setRobot({ hands: [{ side: 1, pose: { R: hand.R, t: hand.t }, opening: hand.open }] }); W.step(1 / 60); T.update(g, 1 / 60, true); };
    const run = (k) => { for (let i = 0; i < k; i++) tick(); };
    const at = (b, q) => { const s = W.poseOf(b); return C.add(s.t, C.mulv(s.R, q)); };
    const total = () => p.from.V + p.to.V + p.spilled + p.drops.reduce((s, x) => s + x.vol, 0);
    return { g, W, p, A, B, hand, tick, run, at, total };
  };

  // The mug is wider than the jaws open: pads straddling its rim rest on it without a grip.
  {
    const s = play(), fin = G.finger.c[2], rim = s.at(s.B, [0, -S.Ri - 0.0035, S.H]);
    s.hand.R = R.Rz(Math.PI / 2); s.hand.t = C.add(rim, [0, 0, -fin - 0.02]); s.run(60); s.hand.open = 0; s.run(60);
    check(!s.W.hands[1].grip, "pads straddling the mug's rim rest on the stoneware without a grip");
  }

  // Beer joins the mug only through its mouth. A stream that reaches it sideways, through the handle or the wall,
  // splashes off to the table rather than passing through the stoneware into the mug.
  {
    const s = play(), { p, B, at, run } = s, A = p.from.body, centre = at(B, [0, 0, 0.075]);
    A.fixed = true; A.t = C.add(A.t, [0, -0.15, 0]); // the bottle out of the way, still full
    for (const [start, name] of [[at(B, [S.handle.x + 0.03, 0, 0.075]), 'handle'], [at(B, [-S.R - 0.03, 0, 0.075]), 'wall']]) {
      const before = { mug: p.to.V, spilled: p.spilled }, dir = C.sub(centre, start).map((x, _, v) => x / C.norm(v));
      p.drops.push({ p: start, v: dir.map((x) => x * 1.2), vol: 2e-5, age: 1, from: p.from, t: 0 }); run(20);
      check(p.to.V === before.mug && p.spilled > before.spilled && !p.drops.length, 'beer thrown sideways at the mug\'s ' + name + ' splashes off to the table instead of passing through into the mug');
    }
    const before = p.to.V;
    p.drops.push({ p: at(B, [0, 0, S.H + 0.05]), v: [0, 0, -0.5], vol: 2e-5, age: 1, from: p.from, t: 0 }); run(20);
    check(Math.abs(p.to.V - before - 2e-5) < 1e-12, 'beer falling into the mouth joins the mug');
  }

  // A person's pour: grip the neck from above, bring the bottle beside the mug, tilt outward with the mouth low over
  // the rim while aiming where the stream lands, stand it back up, carry it clear, set it down and let go.
  const pourIt = ({ rate = 30, vmax = 0.15, beside = true } = {}) => {
    const s = play(), { p, A, B, hand, tick, run, at } = s, fin = G.finger.c[2];
    const neck = at(A, [0, 0, BO.grip]); hand.t = C.add(neck, [0, 0, 0.2]); run(60); hand.t = C.add(neck, [0, 0, -fin]); run(80); hand.open = 0; run(60);
    const held = !!s.W.hands[1].grip, Bc = at(B, [0, 0, 0]), Brim = at(B, [0, 0, S.H])[2], a0 = at(A, [0, 0, 0]), toB = [Bc[0] - a0[0], Bc[1] - a0[1]].map((x, _, v) => x / Math.hypot(...v));
    const roll = toB[1] > 0 ? -1 : 1, mouth = () => at(A, [0, 0, BO.H]);
    const lowestZ = () => { let m = Infinity; for (let k = 0; k < 16; k++) { const a = (k / 16) * 2 * Math.PI; for (const x of BO.outside) for (const z of [x.z0, x.z1]) m = Math.min(m, at(A, [x.r * Math.cos(a), x.r * Math.sin(a), z])[2]); } return m; };
    const clearance = () => { let m = Infinity; for (let k = 0; k < 16; k++) { const a = (k / 16) * 2 * Math.PI; for (const x of BO.outside) for (const z of [x.z0, x.z1]) { const q = at(A, [x.r * Math.cos(a), x.r * Math.sin(a), z]); if (Math.hypot(q[0] - Bc[0], q[1] - Bc[1]) < S.R + 0.008) m = Math.min(m, q[2] - Brim); } } return m; };
    for (let i = 0; i < 40; i++) { hand.t = C.add(hand.t, [0, 0, 0.001]); tick(); }
    if (beside) { const goal = [Bc[0] - toB[0] * 0.095, Bc[1] - toB[1] * 0.095]; for (let i = 0; i < 240; i++) { const e = [goal[0] - hand.t[0], goal[1] - hand.t[1]], l = Math.hypot(...e) || 1, k = Math.min(1, vmax / 60 / l); hand.t = C.add(hand.t, [e[0] * k, e[1] * k, 0]); tick(); } }
    let tilt = 0, worst = 0;
    for (let i = 0; i < 60 * 30 && !(p.from.V < p.V0 * 0.02 && !p.drops.length); i++) {
      const recent = p.drops.filter((x) => x.from === p.from && x.age < 0.12), pouring = recent.length > 0;
      const aim = pouring ? [0, 1].map((j) => recent.reduce((acc, x) => { const z = x.p[2] - Brim, vz = x.v[2], t = (vz + Math.sqrt(Math.max(0, vz * vz + 2 * 9.81 * Math.max(0, z)))) / 9.81; return acc + x.p[j] + x.v[j] * t; }, 0) / recent.length) : mouth().slice(0, 2);
      const err = [Bc[0] - aim[0], Bc[1] - aim[1]], step = err.map((x) => x * (pouring && beside ? 0.06 : 0)), sl = Math.hypot(...step), k = sl > vmax / 60 ? vmax / 60 / sl : 1, c = clearance();
      // vertical moves are made from where the hand really is, so a target never sinks into something it rests on
      const z = s.W.handPose(1).t[2];
      hand.t = [hand.t[0] + step[0] * k, hand.t[1] + step[1] * k, c < 0.012 || lowestZ() < 0.01 ? Math.max(hand.t[2], z) + 0.002 : Number.isFinite(c) && c > 0.035 && lowestZ() > 0.02 && mouth()[2] - Brim > 0.05 ? Math.min(hand.t[2], z) - 0.0008 : hand.t[2]];
      if (!pouring || !beside || Math.hypot(...err) < 0.025) tilt = Math.min(170, tilt + rate / 60);
      hand.R = R.Rx((roll * tilt * Math.PI) / 180); tick();
      worst = Math.max(worst, Math.abs(s.total() / p.V0 - 1));
    }
    const poured = { bottle: p.from.V, mug: p.to.V, spilled: p.spilled, held, worst };
    hand.t = s.W.handPose(1).t.slice();
    // carry it, still tipped, back over where it stood; stand it up (rising only to keep clear of mug and table); lower it
    for (let i = 0; i < 300; i++) { const e = [a0[0] - hand.t[0], a0[1] - hand.t[1]], l = Math.hypot(...e); if (l < 0.005) break; const k = Math.min(1, 0.0015 / l); hand.t = [hand.t[0] + e[0] * k, hand.t[1] + e[1] * k, hand.t[2] + (clearance() < 0.015 ? 0.002 : 0)]; tick(); }
    for (let i = 0; i < 200 && tilt > 0; i++) { tilt = Math.max(0, tilt - 1); hand.R = R.Rx((roll * tilt * Math.PI) / 180); const z = s.W.handPose(1).t[2]; if (clearance() < 0.015 || lowestZ() < 0.015) hand.t = [hand.t[0], hand.t[1], Math.max(hand.t[2], z) + 0.003]; tick(); }
    for (let i = 0; i < 400 && Math.hypot(...[0, 1].map((j) => at(A, [0, 0, 0])[j] - Bc[j])) < 0.13; i++) { hand.t = C.add(hand.t, [-toB[0] * 0.0016, -toB[1] * 0.0016, 0]); tick(); }
    for (let i = 0; i < 300 && s.g.local(s.W.poseOf(A).t)[2] > 0.003; i++) { hand.t = C.add(s.W.handPose(1).t, [0, 0, -0.0015]); tick(); }
    hand.open = 1; run(40); hand.t = C.add(hand.t, [0, 0, 0.12]); run(150);
    return { s, poured };
  };
  {
    const { s, poured } = pourIt();
    check(poured.held && poured.mug > 0.94 * s.p.V0 && poured.spilled < level.pour.spill_limit * s.p.V0, 'gripped by the neck and tipped with the mouth low over the mug, the bottle empties into it: ' + JSON.stringify({ bottle: poured.bottle * 1e6, mug: poured.mug * 1e6, spilled: poured.spilled * 1e6 }));
    check(poured.worst < 1e-9, 'no beer is made or lost: bottle, mug, stream and table always add up to what was poured');
    check(s.g.complete && !s.p.spoiled && T.guidance(s.g).state === 'done', 'stood back up and released, the pour completes: ' + JSON.stringify({ guide: T.guidance(s.g).state, steps: s.g.steps, bottle: s.g.local(s.W.poseOf(s.A).t) }));
    const view=s.p.view(),liquid=view.surfaces.find(x=>x.key==='mug'),GL=require(root+'/tag-tracker/robot-gl');
    check(liquid.foam>.1&&liquid.phase>=0&&view.streams.length===view.radii.length,'mouth collection creates a persistent foam head independently of the conserved beer volume');
    const mesh=GL.liquidMesh({...liquid,layer:'foam'});
    check([...mesh.pos,...mesh.nrm].every(Number.isFinite)&&mesh.idx.every(i=>i<mesh.pos.length/3)&&mesh.pos.length>liquid.points.length*3,'foam and ripples form a finite curved surface instead of one flat fan');
    s.g.reset();
    check(s.p.from.V === s.p.V0 && s.p.to.V === 0 && !s.p.spilled && !s.p.drops.length && !s.p.spoiled && !s.g.complete, 'restart refills the bottle and empties the mug');
  }
  {
    // the neck limits the flow however far the bottle tips
    const rate = (deg) => { const st = play(); st.A.fixed = true; st.A.R = C.mul3(R.Rx((deg * Math.PI) / 180), st.A.R); st.run(2); const v0 = st.p.from.V; st.run(30); return (v0 - st.p.from.V) / 0.5; };
    const flows = [100, 150].map(rate);
    check(flows.every((f) => f > 0 && f <= 0.00016 * 1.01), 'a tipped bottle glugs no faster than its neck passes: ' + flows.map((f) => (f * 1e3).toFixed(3) + ' l/s').join(', '));
  }
  {
    const { s, poured } = pourIt({ beside: false });
    check(poured.spilled > 0.05 * s.p.V0 && s.p.spoiled && !s.g.complete && T.guidance(s.g).state === 'pour_spilled', 'tipping the bottle before it is over the mug pours beer on the table and spoils the attempt until restart: ' + Math.round(poured.spilled * 1e6) + ' ml');
  }

  // Off the table: a prop below the top, or most of a cloth, ends the attempt; props resting on it do not.
  {
    const g = T.create(T.mission(level, 'guided'), table, G), b = g.byKey.get('mug');
    check(T.fallen(g) === null, 'props standing on the table have not fallen');
    b.t = C.add(b.t, [0, 0, -0.2]); check(T.fallen(g) === b.label, 'a prop below the tabletop is reported by name');
    const towel = T.create(T.mission(data.levels.find((l) => l.id === 'laundry'), 'guided'), table, G), c = towel.world.cloths[0];
    for (const [i, node] of c.nodes.entries()) if (i < c.nodes.length * 0.6) node.p = C.add(node.p, [0, 0, -0.2]);
    check(T.fallen(towel) === c.label, 'a towel mostly hanging below the tabletop has fallen');
  }
};
