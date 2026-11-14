module.exports = function({check,near}) {
  const path=require('path'),{spawnSync}=require('child_process'),root=path.resolve(__dirname,'../..');
  const C=require(root+'/tag-tracker/tracker-core'),T=require(root+'/tag-tracker/task-core'),N=require(root+'/tag-tracker/travel-core'),R=require(root+'/tag-tracker/robot-core'),GL=require(root+'/tag-tracker/robot-gl');
  const data=JSON.parse(spawnSync('ruby',['-ryaml','-rjson','-e','puts JSON.generate(YAML.load_file(ARGV[0]))',root+'/_data/tag_tasks.yml'],{encoding:'utf8'}).stdout);
  const I=N.I,table={R:I,t:[.43,0,-.225],size:[.5,.9],thick:.03},G=R.gripper(R.model());
  for(const level of data.levels){
    const before=JSON.stringify(level),l=T.mission(level,'story'),g=T.create(l,table,G);
    check(before===JSON.stringify(level)&&T.mission(level,'practice')===level,l.id+': story overrides preserve the full practice challenge');
    check(l.story.room&&l.story.outro&&l.goals.length<=2&&g.world.bodies.length+g.world.cloths.length<=4&&l.travel.half.every(v=>v<=1.2),l.id+': one tiny room, one small job, with story text');
    check(l.goals.every(r=>g.byKey.has(r.object)&&(!r.target||g.byKey.has(r.target))),l.id+': shortened goals name only props that exist');
    const n=N.create(l.travel);
    check(N.clear(n.x,n.y,n.room,.16)&&!N.docked(n,l.travel.dock),l.id+': starts in free floor space away from the work spot');
    for(let i=0;i<300;i++)g.world.step(1/60);
    check(g.world.capped===0&&g.world.respawns===0&&g.world.bodies.every(b=>b.t.every(Number.isFinite)),l.id+': the small physical scene settles without respawning');
  }
  for(const id of ['bowl']){
    const l=T.mission(data.levels.find(l=>l.id===id),'story'),g=T.create(l,table,G),r=l.goals[0],vessel=g.world.poseOf(g.byKey.get(r.target));
    const model=R.model(),rotation=R.fk(model,1,R.HOME).R,chest=[l.travel.dock[0],l.travel.dock[1],0];
    const wrist=C.sub(C.add(vessel.t,[0,0,.16]),C.mulv(rotation,[0,0,G.finger.c[2]]));
    const ik=R.ik(model,1,{R:rotation,t:C.sub(wrist,chest)});
    check(ik.reach,id+': the tutorial drop point is reachable after parking at its work spot');
  }
  check(T.unlocked(data.levels,{})===0&&T.unlocked(data.levels,{bowl:{stars:1,time:10}})===1&&T.unlocked(data.levels,Object.fromEntries(data.levels.map(l=>[l.id,{stars:1,time:10}])))===7,'story unlocks exactly the next room and keeps the ending replayable');
  const room={half:[1.15,1.15],start:[-.8,0,0],obstacles:[[.43,0,.25,.45]]};
  for(const actor of ['robot','teen']){
    const n=N.create(room);for(let i=0;i<360;i++)N.step(n,{forward:1},1/60,actor);
    check(n.x<=.020001&&n.x>=-.07&&n.blocked&&N.clear(n.x,n.y,room,.16),actor+': the moving base cannot drive through the bench');
    for(let i=0;i<80;i++)N.step(n,{forward:-1},1/60,actor);
    check(n.x<-.2,actor+': reverse leaves an obstacle and the wheels/feet keep moving');
    for(let i=0;i<360;i++)N.step(n,{forward:-1},.1,actor);
    check(n.x>=-room.half[0]+.16-1e-9,actor+': large frame gaps still stop at the room wall');
    for(let i=0;i<60;i++)N.step(n,{},1/60,actor);
    check(n.v===0&&n.w===0,actor+': releasing controls brakes to a full stop');
  }
  const free={half:[5,5],start:[0,0,0],obstacles:[]};const at=[];
  for(const hz of [30,60,144]){const n=N.create(free);for(let i=0;i<hz*2;i++)N.step(n,{forward:1},1/hz,'robot');at.push(n.x);}
  check(Math.max(...at)-Math.min(...at)<.015,'travel speed stays consistent across frame rates');
  const n=N.create(room),anchor={R:C.rodrigues([0,0,.7]),t:[1,2,3]};n.x=.1;n.y=-.3;n.yaw=.6;
  const pose=N.transform(n,anchor),neutral={R:anchor.R,t:anchor.t};const moved=C.compose(pose,neutral);
  check(near(moved.t,C.add(anchor.t,C.mulv(anchor.R,[n.x,n.y,0])),1e-10),'navigation transforms the tracked body into the fixed room frame');
  const object={R:I,t:[.3,.2,0]},round=C.compose(C.inverse(pose),C.compose(pose,object));
  check(near(round.t,object.t,1e-10)&&near(round.R,I,1e-10),'body-relative wrist targets preserve their pose through a drive and a turn');
  const m=R.model(),all=GL.actorMeshes(m),meshes=[...all.amr,...all.wheel];
  check(meshes.every(p=>p.mesh.pos.length&&[...p.mesh.pos,...p.mesh.nrm].every(Number.isFinite)&&p.mesh.idx.every(i=>3*i<p.mesh.pos.length)),'AMR base and wheels have finite indexed meshes');
  const fs=require('fs'),Character=require(root+'/tag-tracker/character-core'),meta=JSON.parse(fs.readFileSync(root+'/tag-tracker/assets/eli/eli.json')),bytes=fs.readFileSync(root+'/tag-tracker/assets/eli/eli.bin'),character=Character.load(meta,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  for(const phase of [0,1.5,3]){
    const parts=Character.pose(character,m,[{side:1,q:R.HOME,jaw:0},{side:-1,q:R.HOME,jaw:.08}],{floor:-.975,phase,speed:.5},-40);
    check(parts.length===10&&parts.every(p=>[...p.mesh.pos,...p.mesh.nrm].every(Number.isFinite)&&p.mesh.idx.every(i=>i*3<p.mesh.pos.length)),'Eli’s clothed, skinned mesh stays finite while walking and gripping at phase '+phase);
    const soles=parts.filter(p=>p.name.includes('Feet')).flatMap(p=>Array.from(p.mesh.pos).filter((v,i)=>i%3===2));
    check(Math.min(...soles)>-1.015&&Math.min(...soles)<-.90,'walking soles stay near the physical floor');
  }
  const home={R:I,t:[0,0,0]};check(N.tagInput(home,home).forward===0&&N.tagInput(home,{R:I,t:[.02,0,0]}).forward===0,'body-tag dead zone keeps neutral hands-on work still');
  const lean=N.tagInput(home,{R:N.rz(.4),t:[.12,0,0]});check(lean.forward>.5&&lean.turn>.4,'body-tag lean and shoulder heading drive forward and turn');
  check(N.tagInput(home,{R:N.rz(-2),t:[-1,0,0]}).forward===-1,'extreme body-tag inputs clamp rather than accelerate without bound');
  const target=N.destination({x:0,y:0,yaw:0},[0,1]);check(target.forward===0&&target.turn>0,'mouse destination turns before driving toward a spot behind a shoulder');
  const catalog=data.story.order.map(id=>id==='door'?data.story.prologue:data.levels.find(l=>l.id===id));
  check(catalog.length===8&&catalog[0].id==='door'&&catalog.at(-1).id==='laundry'&&catalog.every(l=>l.story.reward.label),'Grandma’s campaign begins at her door, ends with laundry and awards every chore');
  check(T.unlocked(catalog,{})===0&&T.unlocked(catalog,{door:{time:1,stars:1}})===1,'knocking unlocks the first chore without unlocking the whole house');
  const entry=T.create(T.mission(catalog[0],'story'),table,G),door=entry.byKey.get('door');entry.arrived=true;
  check(entry.world.hideTable&&door.fixed&&entry.world.bodies.length===1,'the door is solid without an invisible tabletop across its opening');
  function knock(t,speed=.1,kind='hand'){entry.world.record={events:[{t,speed,a:{id:door.id},b:{kind}}]};T.update(entry,.1,true);}
  knock(0,.01);knock(.5,.1,'block');check(entry.knocks===0,'quiet contact and flying props do not count as knocking');
  knock(1);knock(1);knock(1.1);check(entry.knocks===1,'a held contact or the same record cannot count as repeated knocks');knock(1.5);knock(2);entry.world.record=null;T.update(entry,1,true);
  check(entry.knocks===3&&entry.complete,'three spaced hand impacts finish the first visit and earn Grandma’s peppermint');entry.reset();check(entry.knocks===0&&!entry.complete,'restarting clears knock history');
  check(C.clampSettings({robot:{actor:'teen',playMode:'practice'}}).robot.actor==='teen'&&C.clampSettings({robot:{actor:'x',playMode:'x'}}).robot.playMode==='story','actor and campaign choices are validated and saved');
  const physical=T.create(T.mission(data.story.prologue,'story'),table,G),pw=physical.world,k=R.fk(m,1,R.HOME);physical.arrived=true;let hx=.25;
  function frame(){pw.setRobot({hands:[{side:1,pose:{R:k.R,t:[hx,.17,-.2]},opening:1}]});pw.step(1/60);T.update(physical,1/60,true);}
  for(let i=0;i<20;i++)frame();for(let tap=0;tap<3;tap++){for(let i=0;i<25;i++){hx+=.007;frame();}for(let i=0;i<25;i++){hx-=.007;frame();}}for(let i=0;i<60;i++)frame();
  check(physical.knocks===3&&physical.complete&&pw.capped===0,'three actual approaching and withdrawing physical hands knock on the solid door');
  const l=T.mission(data.levels[0],'story'),g=T.create(l,table,G),ball=g.byKey.get('ball'),bowl=g.world.poseOf(g.byKey.get('bowl'));
  ball.t=C.add(bowl.t,[0,0,.03]);ball.v=[0,0,0];ball.w=[0,0,0];
  T.update(g,1,true);check(!g.complete,'finishing a prop objective cannot bypass walking to the workbench');g.arrived=true;T.update(g,1,true);check(g.complete,'the story level completes after both navigation and the physical objective');
  const tray=T.mission(data.levels.find(l=>l.id==='tray'),'story'),delivery=T.create(tray,table,G);
  check(delivery.world.bodies.some(b=>b.kind==='serving')&&tray.goals[0].carry>=.35&&tray.goals[0].at[1]>.5,'the delivery needs real carrying between two physical tables');
};
