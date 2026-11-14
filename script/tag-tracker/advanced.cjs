// Real gripper manipulation, deformable loads and the exact finite TacHammer wire protocol.
module.exports=async function({check}){
  const path=require('path'),root=path.resolve(__dirname,'../..'),{execFileSync}=require('child_process');
  const C=require(root+'/tag-tracker/tracker-core'),R=require(root+'/tag-tracker/robot-core'),P=require(root+'/tag-tracker/physics-core'),T=require(root+'/tag-tracker/task-core'),Cable=require(root+'/tag-tracker/cable-core'),GL=require(root+'/tag-tracker/robot-gl'),H=require(root+'/tag-tracker/haptic-core');
  const data=JSON.parse(execFileSync('ruby',['-ryaml','-rjson','-e','puts JSON.generate(YAML.load_file(ARGV[0]))',root+'/_data/tag_tasks.yml'])),I=[1,0,0,0,1,0,0,0,1],G=R.gripper(R.model()),table={R:I,t:[0,0,0],size:[.5,.9],thick:.03};
  const g=T.create(data.levels.find(l=>l.id==='connector'),table,G),W=g.world,plug=g.byKey.get('plug'),wire=W.cables[0];
  const socket=g.byKey.get('port'),portAt=W.poseOf(socket).t;
  let orient=I,wrist=C.add(W.poseOf(plug).t,[-.012,0,.0925]),opening=1;
  const frame=()=>{W.setRobot({hands:[{side:1,pose:{R:orient,t:wrist},opening}]});W.step(1/60);T.update(g,1/60,true);};
  const run=n=>{for(let i=0;i<n;i++)frame();};
  const move=(to,n=120)=>{const from=wrist.slice();for(let i=1;i<=n;i++){wrist=from.map((v,k)=>v+(to[k]-v)*i/n);frame();}};
  run(30);check(!g.complete&&!g.steps[0]&&wire.nodes.every(n=>n.p.every(Number.isFinite)),'USB task starts finite without awarding itself');
  opening=0;run(60);check(W.hands[1].grip?.body===plug,'real pads pinch the plug housing on its cradle');
  move([wrist[0],wrist[1],wrist[2]+.16]);
  const stretch=Math.max(...wire.edges.filter(e=>e.compliance<1e-6).map(e=>C.norm(C.sub(wire.nodes[e.a].p,wire.nodes[e.b].p))/e.rest));
  check(W.poseOf(plug).t[2]>.20&&wire.tension>.02&&stretch<1.1,'lifting the gripped plug deforms its cable, transmits a load and keeps stretch bounded');
  const patch=wire.nodes[16].p.slice();let second=C.add(patch,[0,0,.105]);
  for(let i=0;i<30;i++){W.setRobot({hands:[{side:1,pose:{R:orient,t:wrist},opening},{side:-1,pose:{R:I,t:second},opening:i<10?1:0}]});W.step(1/60);}
  check(wire.pins.has('-1'),'the second physical gripper can pinch a patch of the flexible cable');
  for(let i=0;i<30;i++){second=C.add(second,[0,0,.001]);W.setRobot({hands:[{side:1,pose:{R:orient,t:wrist},opening},{side:-1,pose:{R:I,t:second},opening:0}]});W.step(1/60);}
  check(wire.reactions[-1]?.load>0&&wire.touched.has(-1),'supporting cable slack transmits a reaction to its own hand');run(20);
  const mesh=GL.cableMesh(wire);check(mesh.pos.every(Number.isFinite)&&mesh.nrm.every(Number.isFinite)&&mesh.idx.every(i=>i*3<mesh.pos.length),'the rendered tube follows the physical cable nodes');
  const offset=C.sub(wrist,W.poseOf(plug).t);move(C.add(C.add(portAt,[-.038,0,0]),offset));
  // A user-like feedback controller adjusts only the wrist target and angle. No prop pose, grip or goal is set.
  const track=(to,n)=>{for(let i=0;i<n;i++){
    const pp=W.poseOf(plug),err=C.sub(to,pp.t),angle=P.rotvec(C.tr3(pp.R)),delta=C.rodrigues(angle.map(v=>v*.15));
    wrist=C.add(C.add(pp.t,C.mulv(delta,C.sub(wrist,pp.t))),err.map(v=>Math.max(-.0002,Math.min(.0002,v*.15))));orient=C.mul3(delta,orient);frame();
  }};
  track(C.add(portAt,[-.031,0,0]),180);check(plug.insertion.aligned&&!plug.insertion.seated&&T.guidance(g).state==='usb_insert','physical axis alignment prompts slow insertion');
  track(C.add(portAt,[-.020,0,0]),650);
  check(plug.insertion.seated&&!g.complete&&T.guidance(g).state==='usb_release','the physical detent seats but a held connector cannot finish');
  const contacts=Cable.sleeveContacts(W,plug,g.byKey.get('port'));
  check(contacts.length>0&&contacts.every(c=>Number.isFinite(c.dist)),'continuous sleeve contacts cover the thin metal shell between surface samples');
  opening=1;run(150);
  check(g.complete&&g.steps[0]&&plug.insertion.seated&&!W.hands[1].grip&&W.capped===0,'a genuinely grasped, inserted and released USB-C plug stays seated and settles');
  const seatedPose=W.poseOf(plug),port=g.byKey.get('port'),saved={R:plug.R,q:plug.q,t:plug.t};
  // Geometry/objective boundary checks are separate from the manipulation playthrough above.
  for(const rotation of [R.Rz(Math.PI/2),R.Rx(Math.PI/2)]){
    plug.R=rotation;plug.q=P.qOf(rotation);plug.t=C.sub(seatedPose.t,C.mulv(rotation,plug.off));
    check(!Cable.insertion(W,plug,port).seated,'a quarter-turn or sideways plug cannot count as seated');
  }
  Object.assign(plug,saved);g.reset();
  check(!g.complete&&wire.pins.size===0&&wire.nodes.every(n=>n.v.every(v=>v===0))&&!plug.externalImpulse,'restart clears the cable, results and pending reaction impulses');
  // Fabric patch rotation and the complete shirt fold are covered separately by section 5o.
  // Wire packets, per-hand routing, unavailable/stale/off guards, rate limits and no asynchronous backlog.
  check([...H.packet(99,3)].join(',')==='2,2,3,45,0,0','TacHammer command is version 2 / play / knock / capped strength / zero value');
  const status=C.decodeActuatorStatus(new DataView(C.encodeActuatorStatus({railOn:true,tachammerReady:true,ermReady:true}).buffer));
  check(status.tachammerReady&&status.ermReady,'firmware capability bits decode independently of servo availability');
  const writes=[],board={state:'live',track:7,act:status,actT:1000,hapticCharacteristic:{writeValueWithResponse:bytes=>{writes.push([...bytes]);return Promise.resolve();}}},arms=[{key:7,side:1,live:true}],world={hands:{1:{}},record:{hands:{1:{force:[0,0,2]}}}},D=H.dispatcher();
  const tick=(now=1000,extra={})=>D.tick({boards:[board],arms,world,now,enabled:true,active:true,...extra});
  tick();tick(1010);await new Promise(r=>setImmediate(r));
  check(writes.length===1&&writes[0][1]===2&&writes[0][2]===1&&board.hapticLast.side===1,'a mapped hand force writes exactly one finite TacHammer click and gets a GATT acknowledgement');
  tick(1050);check(writes.length===1,'sustained load is rate-limited');
  const sleepingRail={...board,act:{...status,railOn:false},hapticBusy:false};H.dispatcher().tick({boards:[sleepingRail],arms,world,now:1100,enabled:true,active:true});await new Promise(r=>setImmediate(r));check(writes.length===2,'a ready TacHammer may start with the power rail off: firmware acquires its rail automatically');writes.pop();
  for(const change of [{actT:0},{act:{...status,tachammerReady:false}},{state:'lost'},{sim:true},{track:8},{hapticSide:'off'}]){
    const b={...board,...change},d=H.dispatcher(),n=writes.length;d.tick({boards:[b],arms,world,now:1000,enabled:true,active:true});check(writes.length===n,'unavailable, stale, disconnected or unmapped controllers receive no commands: '+Object.keys(change)[0]);
  }
  tick(1400,{enabled:false});tick(1400,{active:false});check(writes.length===1,'off and hidden/unfocused task states produce no output');
  let resolve;board.hapticCharacteristic={writeValueWithResponse:bytes=>{writes.push([...bytes]);return new Promise(r=>resolve=r);}};
  tick(1400);D.reset();tick(1450);check(writes.length===2,'resetting while a write is in flight cannot queue or overlap another command');resolve();await new Promise(r=>setImmediate(r));
  check(writes.every(b=>b[1]===2&&b[2]<=3&&b[4]===0&&b[5]===0),'no ERM, continuous-rumble, STOP_ALL or servo command is sent');
  const detentWrites=[],seatBoard={...board,hapticBusy:false,hapticCharacteristic:{writeValueWithResponse:x=>{detentWrites.push([...x]);return Promise.resolve();}}},seatWorld={time:4,hands:{1:{grip:{body:{id:10,insertion:{clickAt:4}}}}},record:{hands:{1:{force:[0,0,0]}}}},seatD=H.dispatcher();
  const seatTick=now=>seatD.tick({boards:[seatBoard],world:seatWorld,arms,now,enabled:true,active:true});
  seatTick(1100);await new Promise(r=>setImmediate(r));seatTick(1250);await new Promise(r=>setImmediate(r));
  check(detentWrites.length===1&&detentWrites[0][2]===3,'one detent crossing sends one knock even if alignment chatters or the plug is regrasped');
  seatD.reset();seatWorld.time=5;seatTick(1300);check(detentWrites.length===1,'a stale seating event is not replayed after reset');

};
