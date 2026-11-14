// A clean, physical tray lift and a failed tilt: the ball must never use a rim as a stop.
module.exports=function({check}){
  const root=require('path').resolve(__dirname,'../..'),C=require(root+'/tag-tracker/tracker-core'),R=require(root+'/tag-tracker/robot-core'),T=require(root+'/tag-tracker/task-core');
  const data=JSON.parse(require('child_process').execFileSync('ruby',['-ryaml','-rjson','-e','puts JSON.generate(YAML.load_file(ARGV[0]))',root+'/_data/tag_tasks.yml'])),I=[1,0,0,0,1,0,0,0,1],table={R:I,t:[0,0,0],size:[.5,.9],thick:.03};
  let g=T.create(T.mission(data.levels.find(l=>l.id==='tray'),'guided'),table,R.gripper(R.model())),W=g.world,tray=g.byKey.get('tray'),ball=g.byKey.get('ball');
  let z=.13,x=-.105,opening=1,rotation=I,rimContact=false;
  const step=()=>{
    W.setRobot({hands:[1,-1].map(side=>({side,pose:{R:rotation,t:[x,side*.186,z]},opening}))});W.step(1/60);T.update(g,1/60,true);
    if(g.balance.rimHit&&(W.record?.touches||[]).some(c=>[c.a.id,c.b.id].includes(tray.id)&&[c.a.id,c.b.id].includes(ball.id)))rimContact=true;
  };
  const run=n=>{for(let i=0;i<n;i++)step();};
  const lift=()=>{run(20);opening=0;run(50);for(let i=0;i<120;i++){z+=.00075;step();}};
  lift();check([1,-1].every(s=>W.hands[s].grip?.body===tray)&&!g.complete,'both real grips lift the loaded tray without awarding a held assembly');
  run(90);check(g.steps[0]&&!g.balance.rimHit&&T.guidance(g).state==='tray_move','a full second of elevated two-hand balance advances to controlled set-down');
  for(let i=1;i<=180;i++){const u=i/180;x=-.105+.12*(u*u*(3-2*u));step();}
  for(let i=0;i<120;i++){z-=.00075;step();}opening=1;run(100);
  check(g.complete&&g.steps.every(Boolean)&&!g.balance.rimHit&&W.capped===0,'the loaded tray completes through a clean physical lift, carry, release and settling');
  g=T.create(T.mission(data.levels.find(l=>l.id==='tray'),'guided'),table,R.gripper(R.model()));W=g.world;tray=g.byKey.get('tray');ball=g.byKey.get('ball');x=-.105;z=.13;opening=1;rotation=I;lift();
  rotation=R.Ry(.3);run(150);
  check(g.balance.rimHit&&rimContact&&!g.complete&&T.guidance(g).state==='tray_retry','a real ball/rim contact latches a failed attempt and a restart hint');
  rotation=I;run(60);check(g.balance.rimHit&&!g.complete,'levelling again cannot erase a rim hit or earn a clean time');
  g.reset();check(!g.balance.rimHit&&g.balance.liftTime===0&&!g.complete,'restart clears the rim-hit latch and the balanced-lift timer');
  W.setRobot({hands:[]});ball.t=C.add(W.poseOf(tray).t,[.061,0,.026]);W.step(1/60);
  check(g.balance.rimHit,'the rim monitor also catches a ball bump before either tray grip is acquired');
};
