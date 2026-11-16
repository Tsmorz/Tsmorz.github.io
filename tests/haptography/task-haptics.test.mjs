import { test } from 'node:test';
import assert from 'node:assert/strict';
import H from '../../tag-tracker/haptic-core.js';
import P from '../../tag-tracker/physics-core.js';
import { fallingImpact,handTableImpact } from './task-impact-fixture.mjs';

const settle=()=>new Promise(resolve=>setImmediate(resolve));
function rig({transport='capture',rate=25,native=transport==='capture'}={}){
  const sent=[],stopped=[],writes=[],world={time:0,hands:{1:{},'-1':{}},record:{hands:{1:{force:[0,0,0]},'-1':{force:[0,0,0]}},events:[]}};let clock=0,playingUntil=-Infinity;
  const board={transport,state:'live',hapticSide:'1',motion:{ready:true},act:{tachammerReady:true},actT:0,hapticRateHz:rate,
    hapticCharacteristic:{writeValueWithResponse:bytes=>{sent.push([...bytes]);writes.push({at:clock,kind:bytes[2],level:bytes[3]});playingUntil=clock+(bytes[2]===6?300:bytes[2]===3?12:6);return Promise.resolve();}}};
  if(native)board.hapticCharacteristic.stopHaptics=()=>{stopped.push(clock);writes.push({at:clock,kind:'stop'});playingUntil=clock;return Promise.resolve();};
  const d=H.dispatcher();
  const tick=async(now,extra={})=>{const {fresh=true,...options}=extra;clock=now;if(fresh)board.actT=now;d.tick({boards:[board],world,arms:[],now,enabled:true,...options});await settle();};
  const force=value=>{world.record.hands[1].force=[0,0,value];};
  const impact=(t,side=1,force=48)=>{world.record.events=[{type:'impact',t,force,impulse:force*P.H,a:{id:side,side},b:{id:22}}];};
  return {sent,stopped,writes,world,board,d,tick,force,impact,playingAt:now=>now<playingUntil,ids:()=>sent.map(b=>b[2])};
}

test('contact clicks scale with force; rumble retains its own 10 Hz force curve and adapts at rest',async()=>{
  for(const level of [37,75]){
    const r=rig();r.force(12);
    await r.tick(0,{level});assert.equal(r.sent[0][3],H.impactLevel(12,level));
    await r.tick(149,{level});assert.deepEqual(r.ids(),[1]);
    await r.tick(150,{level});const first=r.sent.at(-1)[3];
    assert.ok(first>level*.5&&first<level);
    await r.tick(249,{level});assert.deepEqual(r.ids(),[1,6]);
    for(let now=250;now<=2250;now+=100)await r.tick(now,{level});
    assert.ok(r.sent.at(-1)[3]<=Math.max(1,Math.round(level*.04)));
    r.world.hands[1].body={v:[.2,0,0],w:[0,0,0]};
    await r.tick(2350,{level});assert.ok(r.sent.at(-1)[3]>level*.7);
    r.force(6);await r.tick(2450,{level});assert.ok(r.sent.at(-1)[3]<=Math.round(level*Math.sqrt(.5)));
    r.force(1);await r.tick(2550,{level});assert.ok(r.sent.at(-1)[3]<=Math.ceil(level/Math.sqrt(12)));
    r.force(12);for(let now=2650;now<=4950;now+=100)await r.tick(now,{level});
    assert.ok(r.sent.at(-1)[3]<=Math.max(1,Math.round(level*.05)),'constant movement also habituates');
    r.world.hands[1].body.v=[0,0,0];await r.tick(5150,{level});
    r.world.hands[1].body.v=[.2,0,0];await r.tick(5250,{level});
    assert.ok(r.sent.at(-1)[3]>level*.6,'starting movement again restores force feedback');
    assert.ok(r.sent.every(b=>b[0]===2&&b[1]===2&&b[3]<=level&&b[4]===0&&b[5]===0));
  }
});

test('equal-speed real impacts scale with mass/force rather than speed or a fixed selected peak',async()=>{
  const forces=[],levels=[],speeds=[];
  for(const mass of [.015,.03,.1,.3,1]){
    const {world,event}=fallingImpact({mass}),r=rig();
    r.d.tick({boards:[r.board],world,arms:[],now:0,enabled:true,level:75});await settle();
    assert.equal(r.sent.length,1);assert.equal(r.sent[0][2],1);assert.equal(r.sent[0][3],H.impactLevel(event.force));
    assert.ok(Math.abs(event.force-event.impulse/P.H)<1e-12);
    assert.equal(P.haptics(world.record,1).impacts[0].force,event.force);assert.equal(P.haptics(world.record,1).impacts[0].impulse,event.impulse);
    assert.equal(r.board.hapticLast.force,event.force);
    forces.push(event.force);levels.push(r.sent[0][3]);speeds.push(event.speed);
  }
  assert.ok(Math.max(...speeds)-Math.min(...speeds)<1e-9);
  assert.ok(forces.every((v,i)=>!i||v>forces[i-1]));assert.ok(levels.every((v,i)=>!i||v>levels[i-1]));
  assert.deepEqual(levels,[28,30,35,41,50]);
});

test('gentle, firm and hard actual hand/table impacts have distinct useful grades at every render rate',async()=>{
  const expected=[30,39,67,75];
  for(const dt of [1/30,1/60,1/120]){
    const levels=[];
    for(const speed of [.06,.12,.5,1]){
      const {world,event}=handTableImpact({speed,dt}),r=rig();
      r.d.tick({boards:[r.board],world,arms:[],now:0,enabled:true,level:75});await settle();
      assert.equal(r.sent.length,1);levels.push(r.sent[0][3]);assert.equal(r.sent[0][3],H.impactLevel(event.force));
    }
    assert.deepEqual(levels,expected);
  }
});

test('fixed-substep impact force and encoded amplitude do not dilute with render-frame averaging',async()=>{
  const records=[];
  for(const dt of [1/30,1/60,1/120,1/240]){
    const {world,event,averageForce}=fallingImpact({dt}),r=rig();
    r.d.tick({boards:[r.board],world,arms:[],now:0,enabled:true});await settle();
    records.push({force:event.force,averageForce,level:r.sent[0][3]});
  }
  assert.ok(records.every(r=>Math.abs(r.force-10.5667313)<1e-6&&r.level===35));
  assert.ok(records[3].averageForce>records[0].averageForce*7.9,'frame-averaged force differs while the collision and haptic grade stay identical');
});

test('real high-force impacts cap at the selected maximum while discrete wrist stops retain that maximum',async()=>{
  for(const peak of [37,75,100]){
    const {world}=fallingImpact({mass:1,high:true}),r=rig();
    r.d.tick({boards:[r.board],world,arms:[],now:0,enabled:true,level:peak});await settle();
    assert.equal(r.sent[0][3],Math.min(75,peak));
    const stop=rig();await stop.tick(0,{level:peak,arms:[{side:1,wristStop:1}]});assert.equal(stop.sent[0][3],Math.min(75,peak));
  }
});

test('the immediate force scales the moving-load rumble before its selected peak cap',async()=>{
  const levels=[];
  for(const force of [6,12]){
    const r=rig();r.force(force);r.world.hands[1].body={v:[.2,0,0],w:[0,0,0]};
    await r.tick(0);await r.tick(150);levels.push(r.sent.at(-1)[3]);
  }
  assert.ok(levels[0]>levels[1]/2&&levels[0]<levels[1]);
  assert.ok(Math.abs(levels[0]*Math.sqrt(2)-levels[1])<=1);
});

test('light contacts are clear while the force curve stays ordered and adapted static loads stay faint',async()=>{
  const forces=[.12,.5,1,6,12],clicks=[],moving=[];
  for(const force of forces){
    const r=rig();r.force(force);r.world.hands[1].body={v:[.2,0,0],w:[0,0,0]};
    await r.tick(0);clicks.push(r.sent[0][3]);await r.tick(150);moving.push(r.sent.at(-1)[3]);
    r.world.hands[1].body.v=[0,0,0];
    for(let now=250;now<=3250;now+=100)await r.tick(now);
    assert.ok(r.sent.at(-1)[3]<=3,'adaptation keeps a stationary held load to a faint buzz');
  }
  assert.deepEqual(clicks,[20,26,27,32,35]);
  assert.ok(moving[0]>=5&&moving[1]>=10,'light moving loads remain perceptible before adaptation');
  assert.ok(moving.every((v,i)=>!i||v>moving[i-1]));
  for(const peak of [37,75]){
    const levels=[.01,.08,.12,.2,.5,1,10,100,240,1000].map(f=>H.impactLevel(f,peak));
    assert.ok(levels.every((v,i)=>v<=peak&&(!i||v>=levels[i-1])));assert.equal(levels.at(-1),peak);
  }
});

test('a brief impact clicks without starting rumble after the force disappears',async()=>{
  const r=rig();r.force(10);r.impact(0);
  await r.tick(0);assert.deepEqual(r.ids(),[1]);
  r.force(0);r.world.record.events=[];
  for(const now of [20,150,300,700])await r.tick(now);
  assert.deepEqual(r.ids(),[1]);
});

test('a new impact interrupts rumble at the transport cadence and the same event never retriggers',async()=>{
  for(const rate of [10,25]){
    const r=rig({rate});r.force(2);
    await r.tick(0);await r.tick(150);r.impact(.25);
    await r.tick(250);assert.deepEqual(r.ids(),[1,6,1]);
    assert.equal(r.board.hapticLast.reason,'contact impact');
    await r.tick(251);await r.tick(290);await r.tick(350);
    assert.deepEqual(r.ids(),[1,6,1,6]);
    assert.equal(r.board.hapticLast.kind,'rumble');
  }
});

test('release stops rumble and a fresh contact gets a new click and sustain delay',async()=>{
  const r=rig();r.force(2);await r.tick(0);await r.tick(150);
  r.force(0);await r.tick(160);await r.tick(450);await r.tick(900);
  assert.deepEqual(r.ids(),[1,6]);
  r.force(2);await r.tick(1000);await r.tick(1149);assert.deepEqual(r.ids(),[1,6,1]);
  await r.tick(1150);assert.deepEqual(r.ids(),[1,6,1,6]);
});

test('native capture stops the active 300 ms waveform at the first allowed transport slot',async()=>{
  for(const rate of [10,25]){
    const r=rig({rate}),at=150+1000/rate;r.force(2);await r.tick(0);await r.tick(150);
    assert.equal(r.playingAt(449),true,'the firmware waveform itself lasts 300 ms');
    r.force(0);await r.tick(160);await r.tick(at-1);assert.deepEqual(r.stopped,[]);
    await r.tick(at);assert.deepEqual(r.stopped,[at]);assert.equal(r.playingAt(at),false);
    assert.equal(r.board.hapticLast.kind,'stop');assert.deepEqual(r.ids(),[1,6]);
    await r.tick(at+100);await r.tick(700);assert.deepEqual(r.stopped,[at],'release sends one cancellation, without retries');
  }
});

test('a bounded inactive pump can observe a pending cancellation ACK without queuing another command',async()=>{
  for(const acknowledge of [true,false]){
    const r=rig();r.force(2);await r.tick(0);await r.tick(150);let resolve,calls=0;
    r.board.hapticCharacteristic.stopHaptics=()=>{calls++;return new Promise(done=>{resolve=done;});};
    r.d.reset();assert.equal(r.d.hasRumble(160),true);await r.tick(160,{active:false});await r.tick(190,{active:false});
    assert.equal(calls,1);assert.equal(r.d.hasRumble(200),true);
    await r.tick(230,{active:false});assert.equal(calls,1,'an in-flight stop is never queued again');
    if(acknowledge){resolve();await settle();assert.equal(r.d.hasRumble(240),false);}
    else{assert.equal(r.d.hasRumble(449),true);assert.equal(r.d.hasRumble(450),false,'a missing ACK cannot keep a timer pump alive beyond the finite waveform');resolve();await settle();}
  }
});

test('a rejected release is not retried and a newly valid impact can still be sent after transient error recovery',async()=>{
  const r=rig();r.force(2);await r.tick(0);await r.tick(150);let calls=0;
  r.board.hapticCharacteristic.transient=true;
  r.board.hapticCharacteristic.stopHaptics=()=>{calls++;return Promise.reject(new Error('lost release ACK'));};
  r.force(0);await r.tick(190);assert.equal(calls,1);assert.equal(r.d.hasRumble(200),false);
  for(const now of [250,440,450])await r.tick(now);
  assert.equal(calls,1);assert.deepEqual(r.ids(),[1,6]);
  r.impact(.5);await r.tick(500);assert.deepEqual(r.ids(),[1,6,1]);
});

test('legacy BLE and USB replace lingering rumble with one finite minimum click without releasing the servo',async()=>{
  for(const [transport,rate]of [['ble',10],['usb',25]]){
    const r=rig({transport,rate}),at=150+1000/rate;r.force(2);await r.tick(0);await r.tick(150);
    r.force(0);await r.tick(160);assert.equal(r.playingAt(at),true);
    await r.tick(at);assert.deepEqual(r.sent.at(-1),[2,2,1,1,0,0]);
    assert.equal(r.playingAt(at+5),true);assert.equal(r.playingAt(at+6),false);
    await r.tick(at+100);assert.deepEqual(r.ids(),[1,6,1]);
    assert.ok(r.writes.every((w,i)=>!i||w.at-r.writes[i-1].at>=1000/rate));
    assert.ok(r.sent.every(b=>b[1]===2),'never use STOP_ALL, ERM or servo commands');
  }
});

test('release follows the current force after busy/rate gates, without queuing a stale stop or impact',async()=>{
  for(const busy of [false,true]){
    const r=rig({rate:10});r.force(2);await r.tick(0);await r.tick(150);
    r.board.hapticCharacteristic.busy=busy;r.force(0);await r.tick(160);await r.tick(200);
    r.force(2);r.board.hapticCharacteristic.busy=false;await r.tick(250);
    assert.deepEqual(r.stopped,[]);assert.deepEqual(r.ids(),[1,6,6],'a brief separation must not replay a quieting command after contact returns');
  }
  const r=rig();r.force(2);await r.tick(0);await r.tick(150);
  r.board.hapticCharacteristic.busy=true;r.force(0);r.impact(.2);await r.tick(200);
  r.world.record.events=[];await r.tick(250);assert.deepEqual(r.stopped,[]);
  r.board.hapticCharacteristic.busy=false;await r.tick(260);
  assert.deepEqual(r.stopped,[260]);assert.deepEqual(r.ids(),[1,6],'a dropped impact is never replayed after release');
});

test('off, inactive, side-off, world changes and reset retain the active waveform long enough to stop it',async()=>{
  for(const mode of ['off','inactive','side','world','reset']){
    const r=rig();r.force(2);await r.tick(0);await r.tick(150);const options={};
    if(mode==='off')options.enabled=false;
    if(mode==='inactive')options.active=false;
    if(mode==='side')r.board.hapticSide='off';
    if(mode==='world')options.world={hands:{1:{}},record:{hands:{1:{force:[0,0,0]}}}};
    if(mode==='reset'){r.d.reset();r.force(0);}
    await r.tick(160,options);assert.deepEqual(r.stopped,[],'rate cap survives a reset');
    await r.tick(190,options);assert.deepEqual(r.stopped,[190]);assert.equal(r.playingAt(190),false);
    await r.tick(230,options);assert.deepEqual(r.stopped,[190]);assert.deepEqual(r.ids(),[1,6]);
  }
});

test('stale, unavailable and calibrating channels receive no release command and retain the finite safety end',async()=>{
  for(const mode of ['stale','unready','calibrating','disconnected','sim']){
    const r=rig();r.force(2);await r.tick(0);await r.tick(150);r.force(0);
    if(mode==='stale')r.board.actT=-400;
    if(mode==='unready')r.board.act.tachammerReady=false;
    if(mode==='calibrating')r.board.motion.ready=false;
    if(mode==='disconnected')r.board.state='closed';
    if(mode==='sim')r.board.sim=true;
    await r.tick(200,{fresh:mode!=='stale'});await r.tick(300,{fresh:mode!=='stale'});
    assert.deepEqual(r.stopped,[]);assert.deepEqual(r.ids(),[1,6]);assert.equal(r.playingAt(450),false);
  }
});

test('an old render-frame contact cannot renew rumble after its latest fixed substep separated',async()=>{
  const r=rig();r.force(2);await r.tick(0);await r.tick(150);
  r.world.record.touches=[{a:{side:1},b:{id:22}}];
  r.world.contactState={hands:{1:{force:[0,0,0],grip:{slipping:false}}},touches:[]};
  assert.equal(H.cue(r.world,1).load,0);assert.deepEqual(H.cue(r.world,1).contacts,[]);
  await r.tick(190);assert.deepEqual(r.stopped,[190]);assert.deepEqual(r.ids(),[1,6]);
  await r.tick(290);assert.deepEqual(r.ids(),[1,6],'frame-averaged force never restarts released rumble');
});

test('small force fluctuations do not create repeated onset clicks or turn brief touches into sustained load',async()=>{
  const r=rig();r.force(.13);await r.tick(0);
  r.force(.09);await r.tick(50);r.force(.11);await r.tick(100);
  await r.tick(150);assert.deepEqual(r.ids(),[1,6]);
  r.force(.07);await r.tick(200);r.force(.11);await r.tick(450);
  assert.equal(r.ids().filter(id=>id===1).length,1);
  r.force(0);await r.tick(500);await r.tick(610);r.force(.11);await r.tick(750);
  assert.equal(r.ids().filter(id=>id===1).length,1);
});

test('release debounce requires continuous separation, not accumulated brief gaps',async()=>{
  const r=rig();r.force(.2);await r.tick(0);
  for(const [now,f]of [[150,.07],[200,.09],[250,.07],[300,.2]]){r.force(f);await r.tick(now);}
  assert.equal(r.ids().filter(id=>id===1).length,1);
});

test('busy and rate-limited impact clicks are dropped instead of queued or replayed',async()=>{
  const r=rig();r.impact(0);r.board.hapticCharacteristic.busy=true;
  await r.tick(0);r.board.hapticCharacteristic.busy=false;await r.tick(100);
  assert.deepEqual(r.ids(),[]);
  r.impact(.2);await r.tick(200);r.impact(.21);await r.tick(210);await r.tick(300);
  assert.deepEqual(r.ids(),[1]);
});

test('impact spikes do not become sustained-force samples, and the other hand cannot trigger feedback',async()=>{
  const r=rig();r.impact(0,-1);await r.tick(0);assert.deepEqual(r.ids(),[]);
  r.impact(.1);assert.equal(H.cue(r.world,1).load,0);
  await r.tick(100);await r.tick(300);await r.tick(600);assert.deepEqual(r.ids(),[1]);
});

test('inactive, disabled and recalibrating states reset sustained feedback without STOP_ALL writes',async()=>{
  for(const change of [{active:false},{enabled:false},{calibrating:true},{stale:true}]){
    const r=rig();r.force(2);await r.tick(0);await r.tick(150);
    if(change.calibrating)r.board.motion.ready=false;
    if(change.stale)r.board.act.tachammerReady=false;
    await r.tick(450,change);await r.tick(900,change);
    assert.deepEqual(r.ids(),[1,6]);
  }
});

test('fabric and cable tension use rumble under load and a held-prop impact still gets a sharp click',async()=>{
  const r=rig(),prop={id:99};r.world.hands[1].grip={body:prop};
  r.world.cloths=[{reactions:{1:{load:2}}}];await r.tick(0);await r.tick(150);
  assert.deepEqual(r.ids(),[1,6]);assert.equal(r.board.hapticLast.reason,'fabric tension');
  r.world.record.events=[{type:'impact',t:.3,impulse:.1,a:{id:99},b:{id:55}}];await r.tick(300);
  assert.deepEqual(r.ids(),[1,6,1]);
  r.world.record.events=[];r.world.cloths=[];r.world.cables=[{radius:.003,reactions:{1:{load:3}}}];
  await r.tick(400);assert.deepEqual(r.ids(),[1,6,1,6]);assert.equal(r.board.hapticLast.reason,'cable tension');
});

test('direct fabric forces add as vectors and supported loads cancel without a rumble tail',async()=>{
  const r=rig();r.force(3);r.world.cloths=[{reactions:{1:{force:[0,0,2],load:2}}}];
  assert.equal(H.cue(r.world,1).load,5);await r.tick(0);await r.tick(150);assert.equal(r.ids().at(-1),6);
  r.world.cloths[0].reactions[1]={force:[0,0,-3],load:3};
  assert.equal(H.cue(r.world,1).load,0);await r.tick(190);assert.equal(r.stopped.length,1);
  r.force(0);r.world.cloths[0].reactions={};await r.tick(300);assert.equal(H.cue(r.world,1).load,0);assert.equal(r.ids().length,2);
  const plug={id:99};r.world.hands[1].grip={body:plug};r.world.cables=[{plug,tension:20}];
  assert.equal(H.cue(r.world,1).load,0,'a supported held plug does not count its cable tension twice');
});

test('contact features and brief separations coalesce into one physical contact episode',async()=>{
  const r=rig();r.force(1);r.impact(0);await r.tick(0);
  r.world.record.touches=[{a:{side:1},b:{id:22}}];
  for(let now=40;now<=600;now+=40){r.impact(now/1000);r.force(now%80?0:1);await r.tick(now);}
  assert.equal(r.ids().filter(id=>id===1).length,1);
  r.force(0);r.world.record.events=[];r.world.record.touches=[];
  await r.tick(650);await r.tick(800);r.force(1);r.impact(.95);await r.tick(950);
  assert.equal(r.ids().filter(id=>id===1).length,2);
});

test('wrist stop edges click once, rearm after backing off, and stay hand-specific',async()=>{
  const r=rig(),arm={side:1,wristStop:1},arms=[arm];
  await r.tick(0,{arms});assert.equal(r.board.hapticLast.reason,'wrist rotation limit');
  for(const now of [150,300,500])await r.tick(now,{arms});
  assert.deepEqual(r.ids(),[1]);
  arm.wristStop=0;await r.tick(600,{arms});arm.wristStop=1;await r.tick(750,{arms});
  assert.deepEqual(r.ids(),[1,1]);
  await r.tick(900,{arms:[{side:-1,wristStop:2}]});assert.deepEqual(r.ids(),[1,1]);
});
