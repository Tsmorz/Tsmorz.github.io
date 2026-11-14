// Called by script/test-tag-tracker section 5j. Deterministic physical and objective regressions.
module.exports = function ({ check, near }) {
  const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
  const root = path.resolve(__dirname, '../..'), C = require(root + '/tag-tracker/tracker-core'), R = require(root + '/tag-tracker/robot-core');
  const P = require(root + '/tag-tracker/physics-core'), T = require(root + '/tag-tracker/task-core'), Cloth = require(root + '/tag-tracker/cloth-core'), GL = require(root + '/tag-tracker/robot-gl');
  const data = spawnSync('ruby', ['-ryaml', '-rjson', '-e', 'puts JSON.generate(YAML.load_file(ARGV[0]))', path.join(root, '_data/tag_tasks.yml')], { encoding: 'utf8' });
  if (data.status !== 0) throw new Error(data.stderr);
  const levels = JSON.parse(data.stdout).levels, I = [1,0,0,0,1,0,0,0,1], model = R.model(), G = R.gripper(model);
  const table = { R: I, t: [0,0,0], size: [.5,.9], thick: .03 };
  const run = (W, n = 60) => { for (let i = 0; i < n; i++) W.step(1/60); };
  const create = (id) => T.create(levels.find((l) => l.id === id), table, G);
  const put = (W, b, at, rot = I) => { b.R = rot.slice(); b.q = P.qOf(rot); b.t = C.sub(at, C.mulv(rot, b.off)); b.v = [0,0,0]; b.w = [0,0,0]; b.asleep = false; b.still = 0; };
  const finish = (g, n = 60) => { for (let i = 0; i < n; i++) { g.world.step(1/60); T.update(g,1/60,true); } };
  check(levels.map(l=>l.id).join(',')==='bowl,sort,tray,cable,laundry'&&levels.slice(0,2).every(l=>l.hands===1)&&levels.slice(2).every(l=>l.hands===2), 'exactly five tasks progress from a first grasp to two-handed balance, charging and a towel');
  check(levels.find(l=>l.id==='sort').objects.length===2&&T.mission(levels.find(l=>l.id==='sort'),'guided').objects.length===2,'both modes offer exactly two blocks');
  for (const l of levels) {
    const g = create(l.id), W = g.world, keys = new Set([...W.bodies, ...W.cloths].map((b) => b.key));
    check(l.name && l.brief && l.hint && l.par > 0 && l.goals.length && l.goals.every((r) => keys.has(r.object) && (!r.target || keys.has(r.target))), l.id + ': content and objective references are valid');
    const t = performance.now(); run(W,60); T.update(g,1,false);
    check(!g.complete && !g.steps.some((done,i)=>done&&l.goals[i].type!=='aboard') && W.capped === 0 && W.respawns === 0 && W.bodies.every((b) => [...b.t,...b.v,...b.R].every(Number.isFinite)) && W.cloths.every((c) => c.nodes.every((n) => [...n.p,...n.v].every(Number.isFinite))), l.id + ': initial state is stable, finite and does not award itself');
    const ms = (performance.now()-t)/60;
    check(ms < 50, `${l.id}: physics frame ${ms.toFixed(2)} ms (60 Hz input)`);
    for (const b of W.bodies.filter((b) => b.pieces)) {
      const meshes = GL.compoundMeshes(b.pieces);
      check(meshes.every((p) => [...p.mesh.pos,...p.mesh.nrm].every(Number.isFinite) && p.mesh.idx.every((i) => i*3 < p.mesh.pos.length)), l.id + ': compound collision shapes have finite, indexed meshes');
    }
  }
  const clocks=[60,144,300].map((hz)=>{const w=P.world();for(let i=0;i<hz*2;i++)w.step(1/hz);return w.time;});
  check(clocks.every(t=>Math.abs(t-2)<P.H), 'fixed-step accumulation keeps physics time independent of 60, 144 and 300 Hz rendering');
  check(P.shapeDistance([0,0,.03],T.geometry('bowl')) > .015 && P.shapeDistance([.084,0,.03],T.geometry('bowl')) < 0, 'the wide bowl is hollow, with a solid rim and bottom');
  const bowlMesh = GL.compoundMeshes(T.geometry('bowl'));
  check(bowlMesh.length === 1 && bowlMesh[0].mesh.pos.length > 20000 && [...bowlMesh[0].mesh.nrm].every(Number.isFinite), 'the bowl has one continuous smooth ceramic shell instead of visible collision segments');
  for (const z of [.018,.03,.043]) {
    const r = .082 + (z-.0285)*.016/.041;
    check(P.shapeDistance([r,0,z],T.geometry('bowl')) < 0 && P.shapeDistance([r-.015,0,z],T.geometry('bowl')) > .008, 'the flared bowl has a solid wall and hollow interior at '+z+' m');
  }
  let g = create('bowl'), W = g.world;
  put(W,g.byKey.get('ball'),[.04,-.17,.03]); finish(g);
  check(g.complete && g.stars === 3, 'a ball released inside a physically settled bowl completes the easy level');
  g = create('bowl'); W = g.world; put(W,g.byKey.get('ball'),[.04,-.17,.14]); T.update(g,.8,true);
  check(!g.complete, 'hovering above the bowl does not complete the task');
  W.hands[1] = { grip: {body:g.byKey.get('ball')} }; put(W,g.byKey.get('ball'),[.04,-.17,.03]); T.update(g,.8,true);
  check(!g.complete, 'a held ball does not count as released');
  g = create('sort'); W = g.world; for (const r of g.level.goals) put(W,g.byKey.get(r.object),r.at); finish(g);
  check(g.complete, 'two correctly placed, settled blocks complete placement');
  g = create('tray'); W = g.world; const trayGoal=g.level.goals.find(r=>r.type==='place');
  put(W,g.byKey.get('tray'),trayGoal.at);put(W,g.byKey.get('ball'),C.add(trayGoal.at,[0,0,.026]));finish(g);
  check(!g.complete, 'parking the tray without the clean two-hand lift cannot skip balancing');
  g.balance.liftTime=1;g.dual.add('tray');finish(g);
  check(g.complete,'a clean lifted tray and its settled load complete together after release');
  // Force-limited grasp on a new shape, not a teleport or a scoring-only prop.
  W = P.world({table,gripper:G}); const block = W.add({kind:'block',mass:.09,pieces:T.geometry('block')},[0,0,.025]);
  let z = .13; const hand = (opening) => W.setRobot({hands:[{side:1,pose:{R:I,t:[0,0,z]},opening}]});
  hand(1); run(W,20); hand(0); run(W,45); const gripped = W.hands[1].grip && W.hands[1].grip.body === block;
  for(let i=0;i<50;i++){z+=.002;hand(0);W.step(1/60);} const lifted = block.t[2];
  hand(1);run(W,80);
  check(gripped && lifted>.10 && Math.abs(block.t[2]-.025)<.002 && !W.hands[1].grip, 'the real pad contact grasps, lifts and releases a compound block');
  W=P.world({table,gripper:G});const dropped=W.add({kind:'block',mass:.09,pieces:T.geometry('block')},[0,0,.025]);
  put(W,dropped,[.4,0,-.5]);run(W,150);
  check(W.respawns===1 && Math.abs(W.poseOf(dropped).t[2]-.025)<.002, 'a low-bounce prop returns after a drop even if it falls asleep on the floor');
  // Two simultaneous independent grips on a broad tray.
  W = P.world({table,gripper:G}); const tray = W.add({kind:'tray',mass:.35,pieces:T.geometry('tray')},[0,0,.006]);
  z = .13;
  const two = (opening) => W.setRobot({hands:[1,-1].map((side)=>({side,pose:{R:I,t:[0,side*.186,z]},opening}))});
  two(1);run(W,20);two(0);run(W,50);
  const both = [1,-1].every((s)=>W.hands[s].grip && W.hands[s].grip.body === tray);
  for(let i=0;i<50;i++){z+=.002;two(0);W.step(1/60);}
  check(both && W.poseOf(tray).t[2]>.07 && P.tilt(tray)<.15 && W.capped===0, 'two grippers can share a loaded-width tray without a solver blow-up');
  // Deformable cloth: real capture, stretch bounds, release, collisions, reset and objective specificity.
  W = P.world({table,gripper:G}); const cloth = Cloth.towel({key:'cloth',at:[0,0,0],width:.2,height:.24},table); W.cloths.push(cloth);
  z=.11; const ch = (opening) => W.setRobot({hands:[{side:1,pose:{R:I,t:[-.10,-.12,z]},opening}]});
  ch(1);run(W,20);ch(0);run(W,30);const took=cloth.pins.has('1');
  for(let i=0;i<45;i++){z+=.002;ch(0);W.step(1/60);}
  const high=Math.max(...cloth.nodes.map((n)=>n.p[2])), stretch=Math.max(...cloth.edges.filter((e)=>e.compliance<1e-6).map((e)=>C.norm(C.sub(cloth.nodes[e.a].p,cloth.nodes[e.b].p))/e.rest));
  ch(1);run(W,80);
  check(took && high>.06 && stretch<1.15 && cloth.pins.size===0 && cloth.nodes.every((n)=>n.p[2]>-.002), `a cloth patch can be pinched, lifted and released; stretch stays bounded (${stretch.toFixed(3)}×) and the table stays solid`);
  check(!Cloth.folded(cloth).x && !Cloth.folded(cloth).y, 'an unfolded towel does not count as folded');
  W.reset(); z=.13;
  const foldingHands=(opening)=>W.setRobot({hands:[1,-1].map(side=>({side,pose:{R:I,t:[-.1,side*.12,z]},opening}))});
  foldingHands(1);run(W,25);foldingHands(0);run(W,45);
  const foldPins=[1,-1].map(side=>({side,pin:cloth.pins.get(String(side))}));let foldedHands=[];
  check(foldPins.every(p=>p.pin),'both towel corners can be pinched before folding');
  if(foldPins.every(p=>p.pin))for(let i=0;i<=160;i++){
    const t=i/160,rot=R.Ry(-Math.PI*t);
    foldedHands=foldPins.map(({side,pin})=>({side,pose:{R:rot,t:C.sub([-.1+.2*t,side*.12,.0025+.16*Math.sin(Math.PI*t/2)],C.mulv(rot,pin.local))},opening:0}));W.setRobot({hands:foldedHands});W.step(1/60);
  }
  W.setRobot({hands:foldedHands.map(h=>({...h,opening:1}))});run(W,150);
  check(Cloth.folded(cloth).x && Cloth.folded(cloth).compact && cloth.touched.size===2, 'two physical grippers turn their finite fabric patches through a towel fold and release: '+JSON.stringify(Cloth.folded(cloth)));
  g=create('laundry');const taskTowel=g.world.cloths[0];taskTowel.touched=new Set([1,-1]);
  const shape=(twice)=>taskTowel.nodes.forEach((n,i)=>{const p=taskTowel.material[i],x=Math.abs(p[0]);n.p=[twice?-.21+Math.abs(x-.06):-.21+x,p[1],.005+(p[0]>0?.01:0)+(twice&&x<.06?.02:0)];n.v=[0,0,0];});
  shape(true);T.update(g,1,true);check(!g.complete,'a quarter fold cannot skip the released first fold');
  g.reset();taskTowel.touched=new Set([1,-1]);taskTowel.firstHands=new Set([1,-1]);shape(false);T.update(g,1,true);
  check(!g.complete&&taskTowel.foldStage===1,'one aligned half fold advances guidance but cannot complete the towel task');
  taskTowel.foldHands=new Set([1,-1]);shape(true);T.update(g,1,true);check(g.complete,'a released, spread four-layer towel passes both folds after the first-fold checkpoint');
  W.reset();const N=cloth.N;
  for(let j=0;j<N;j++)for(let i=0;i<N;i++)cloth.nodes[j*N+i].p=[Math.abs((i/(N-1)-.5)*.2), (j/(N-1)-.5)*.24, .005+(i<N/2?.005:0)];
  check(Cloth.folded(cloth).x && !Cloth.folded(cloth).y && Cloth.folded(cloth).compact, 'aligned opposite edges detect a half fold');
  const mesh=GL.clothMesh(cloth);check([...mesh.pos,...mesh.nrm].every(Number.isFinite) && mesh.idx.length===(N-1)**2*6, 'the cloth surface has finite normals and two triangles per cell');
  W.reset();check(cloth.pins.size===0 && cloth.touched.size===0 && near(cloth.nodes[0].p,[-.1,-.12,Cloth.radius],1e-12), 'restart restores cloth, releases patches and clears hand history');
  g=create('laundry');const towel=g.world.cloths[0];for(const n of towel.nodes)n.p=[.1,-.22,.01];towel.touched=new Set([1,-1]);T.update(g,1,true);
  check(!g.steps[0], 'a crumpled point cannot pass as a twice-folded towel');
  check(!T.progress({laundry:{stars:3,time:10}},levels).laundry,'old shirt and single-fold times do not seed the twice-folded towel task');
  const p = T.progress({bowl:{stars:3,time:40},laundry:{stars:99,time:-1},other:{stars:1,time:1}},levels);
  check(Object.keys(p).join() === 'bowl' && T.best(p.bowl,{stars:2,elapsed:60}).time===40 && T.best(p.bowl,{stars:2,elapsed:60}).stars===3, 'saved progress validates input and preserves the best time and stars independently');
  // Head camera follows the body, keeps an orthonormal basis, and projects what the robot looks towards at centre.
  for(const angle of [-80,-40,0,25]){
    const chest={R:C.rodrigues([.2,-.1,.8]),t:[.4,-.2,1]}, cam=T.headCamera(chest,model,angle,800,600), centre=cam.project(C.add(cam.eye,cam.fwd));
    const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
    check(near(centre.slice(0,2),[400,300],1e-8) && near([C.norm(cam.right),C.norm(cam.up),C.norm(cam.fwd)],[1,1,1],1e-10) && Math.abs(dot(cam.right,cam.up))<1e-10 && cam.project(C.sub(cam.eye,cam.fwd))===null, `robot-eye camera at ${angle}° is attached, orthonormal and rejects points behind it`);
  }
  for (const [w,h] of [[1000,400],[390,500]]) {
    const cam=T.headCamera({R:I,t:[0,0,0]},model,-40,w,h),at=(x,y)=>C.add(cam.eye,C.add(cam.fwd,C.add(cam.right.map(v=>v*x),cam.up.map(v=>v*y))));
    const sides=[cam.project(at(-1,0)),cam.project(at(1,0))],vertical=[cam.project(at(0,-Math.tan(Math.PI/6))),cam.project(at(0,Math.tan(Math.PI/6)))];
    check(sides.every(p=>p[0]>=-1e-8&&p[0]<=w+1e-8)&&vertical.every(p=>p[1]>=-1e-8&&p[1]<=h+1e-8),'robot eyes show at least 90 degrees across and 60 vertically at '+w+' × '+h);
  }
  const s=C.clampSettings({robot:{props:'arcade',level:'laundry',view:'eyes',headTilt:-200}});
  check(s.robot.props==='arcade' && s.robot.level==='laundry' && s.robot.view==='eyes' && s.robot.headTilt===-80 && C.clampSettings({robot:{headTilt:NaN}}).robot.headTilt===-40, 'campaign, camera and bounded tilt survive settings validation');
};
