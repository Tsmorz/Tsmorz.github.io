import { test } from 'node:test';
import assert from 'node:assert/strict';
import H from '../../tag-tracker/haptic-core.js';
import P from '../../tag-tracker/physics-core.js';
import { fallingImpact,handTableImpact } from './task-impact-fixture.mjs';

const settle=()=>new Promise(resolve=>setImmediate(resolve));
function rig({transport='capture',rate=25}={}){
  const sent=[],world={time:0,hands:{1:{},'-1':{}},record:{hands:{1:{force:[0,0,0]},'-1':{force:[0,0,0]}},events:[]}};
  const board={transport,state:'live',hapticSide:'1',motion:{ready:true},act:{tachammerReady:true},actT:0,hapticRateHz:rate,
    hapticCharacteristic:{writeValueWithResponse:bytes=>{sent.push([...bytes]);return Promise.resolve();}}};
  const d=H.dispatcher();
  const tick=async(now,extra={})=>{board.actT=now;d.tick({boards:[board],world,arms:[],now,enabled:true,...extra});await settle();};
  const force=value=>{world.record.hands[1].force=[0,0,value];};
  const impact=(t,side=1,force=48)=>{world.record.events=[{type:'impact',t,force,impulse:force*P.H,a:{id:side,side},b:{id:22}}];};
  return {sent,world,board,d,tick,force,impact,ids:()=>sent.map(b=>b[2])};
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
    r.force(6);await r.tick(2450,{level});assert.ok(r.sent.at(-1)[3]<=Math.round(level*.5));
    r.force(1);await r.tick(2550,{level});assert.ok(r.sent.at(-1)[3]<=Math.ceil(level/12));
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
  assert.deepEqual(levels,[6,9,16,25,38]);
});

test('gentle, firm and hard actual hand/table impacts have distinct useful grades at every render rate',async()=>{
  const expected=[20,29,63,75];
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
  assert.ok(records.every(r=>Math.abs(r.force-10.5667313)<1e-6&&r.level===16));
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
  assert.ok(Math.abs(levels[0]*2-levels[1])<=1);
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

test('release stops renewing rumble and a fresh contact gets a new click and sustain delay',async()=>{
  const r=rig();r.force(2);await r.tick(0);await r.tick(150);
  r.force(0);await r.tick(160);await r.tick(450);await r.tick(900);
  assert.deepEqual(r.ids(),[1,6]);
  r.force(2);await r.tick(1000);await r.tick(1149);assert.deepEqual(r.ids(),[1,6,1]);
  await r.tick(1150);assert.deepEqual(r.ids(),[1,6,1,6]);
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
