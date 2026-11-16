// Reset is a discontinuity, never a physical trajectory through newly spawned props.
module.exports=function({check}){
  const root=require('path').resolve(__dirname,'../..'),R=require(root+'/tag-tracker/robot-core'),P=require(root+'/tag-tracker/physics-core'),C=require(root+'/tag-tracker/tracker-core'),T=require(root+'/tag-tracker/task-core');
  const I=[1,0,0,0,1,0,0,0,1],m=R.model(),G=R.gripper(m),table={R:I,t:[0,0,0],size:[1,1],thick:.03};
  const W=P.world({table,gripper:G}),ball=W.add('ball',[0,0,.08]),pose=x=>({R:I,t:[x,0,.1]});
  W.setRobot({links:[{id:'1f',a:[-.15,-.2,.1],b:[-.15,.2,.1],r:.025}],hands:[{side:1,pose:pose(-.12),opening:0}]});W.step(1/60);
  W.hands[1].body.externalImpulse={linear:[1,0,0],angular:[0,1,0]};W.hands[1].body.v=[3,0,0];W.hands[1].body.w=[0,9,0];
  W.reset();
  check(!Object.keys(W.hands).length&&W.record===null&&W.carry===0&&!W.warm.size,'world reset discards hands, grip/jaw/velocity/impulse state and old contact history');
  const fresh={links:[{id:'1f',a:[.15,-.2,.1],b:[.15,.2,.1],r:.025}],hands:[{side:1,pose:pose(.12),opening:1}]};
  W.resetRobot(fresh);
  check(W.hands[1].gap===G.gapMax&&W.hands[1].target===G.gapMax&&C.norm(W.hands[1].body.v)===0&&C.norm(W.hands[1].body.w)===0&&W.handPose(1).t[0]===.12,'reset robot seeds open, stationary physical hands and both interpolation endpoints without stepping');
  let hits=0;for(let i=0;i<20;i++){W.setRobot(fresh);W.step(1/60);hits+=W.record.events.filter(e=>(e.a.id===ball.id||e.b.id===ball.id)&&[e.a.kind,e.b.kind].some(k=>k==='hand'||k==='arm')).length;}
  check(!hits&&Math.abs(W.poseOf(ball).t[0])<1e-9,'a reset from -12 cm to +12 cm never sweeps the old hand/forearm through the respawned ball');

  const data=JSON.parse(require('child_process').execFileSync('ruby',['-ryaml','-rjson','-e','puts JSON.generate(YAML.load_file(ARGV[0]))',root+'/_data/tag_tasks.yml']));
  const ready=data.ready.joints.map(v=>v*Math.PI/180),home=R.fk(m,1,ready),taskTable={R:I,t:[home.wrist[0]-.03+.25,0,home.wrist[2]-(G.body.h[1]+.045)],size:[.5,.9],thick:.03};
  const robot={links:[],hands:[]};for(const side of [1,-1]){const k=R.fk(m,side,ready);robot.links.push({id:side+'u',a:k.shoulder,b:k.elbow,r:.04},{id:side+'f',a:k.elbow,b:k.wrist,r:.032});robot.hands.push({side,pose:{R:k.R,t:k.wrist},opening:1});}
  for(const level of data.levels){
    const g=T.create(level,taskTable,G),world=g.world;
    world.initialize(robot);
    if(level.id==='laundry'){
      const c=world.cloths[0],start=c.nodes.map(n=>n.p.slice());c.nodes[0].v=[1,2,3];
      g.reset();world.initialize(robot);
      check(c.nodes.every((n,i)=>C.norm(C.sub(n.p,start[i]))<1e-12&&C.norm(n.v)===0)&&!c.pins.size&&Object.values(world.hands).every(h=>!h.grip&&h.gap===G.gapMax),'shirt initial load/restart restores its cut pattern and open hands without a fold simulation');
      continue;
    }
    let contacts=0,impacts=0;const starts=world.bodies.map(b=>world.poseOf(b).t.slice());
    check(world.time===0&&g.elapsed===0&&!g.started&&g.clockStart==null&&world.bodies.filter(b=>!b.fixed).every(b=>b.asleep),level.id+': initial rigid supports settle before the task clock or mechanisms start');
    for(let i=0;i<120;i++){world.setRobot(robot);world.step(1/60);for(const e of world.record.touches)if(e.a.kind==='hand'||e.b.kind==='hand'||e.a.kind==='arm'||e.b.kind==='arm')contacts++;impacts+=world.record.events.length;}
    check(!contacts&&!impacts&&world.bodies.every((b,i)=>Math.hypot(world.poseOf(b).t[0]-starts[i][0],world.poseOf(b).t[1]-starts[i][1])<.002),level.id+': ready hands/arms have no initial contact with props and do not shove them during settling');
    const lifted=world.bodies.find(b=>!b.fixed);lifted.asleep=false;lifted.v=[0,0,.8];let realImpacts=0;
    for(let i=0;i<90;i++){world.setRobot(robot);world.step(1/60);realImpacts+=world.record.events.length;}
    check(realImpacts>0,level.id+': a genuinely lifted prop still reports its later support impact');
    const moved=robot.hands.map((h,i)=>({...h,pose:{R:C.mul3(R.Rx(i?.7:-.6),h.pose.R),t:C.add(h.pose.t,[.09,i?.12:-.12,-.04])},opening:0}));
    world.setRobot({hands:moved,links:robot.links});for(let i=0;i<5;i++)world.step(1/60);
    g.reset();world.initialize(robot);
    check(world.record===null&&Object.values(world.hands).every(h=>h.gap===G.gapMax&&!h.grip&&C.norm(h.body.v)===0&&C.norm(h.body.w)===0),level.id+': displaced/rotated hand state is discarded atomically on restart');
  }
};
if(require.main===module){const assert=require('node:assert/strict');module.exports({check:(ok,msg)=>{assert.ok(ok,msg);process.stdout.write('ok '+msg+'\n');}});}
