import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CaptureLink } from '../../haptography/task-link.js';
import * as W from '../../haptography/wire.js';
import { fixtureStream } from './fixture.mjs';
import TaskHaptics from '../../tag-tracker/haptic-core.js';
import Controller from '../../tag-tracker/controller-link.js';
import { fallingImpact } from './task-impact-fixture.mjs';

test('task drive settings use real percentages and migrate legacy force scaling to 75 percent',()=>{
  assert.deepEqual(TaskHaptics.settings(),{version:2,enabled:true,level:75});
  assert.deepEqual(TaskHaptics.settings({enabled:false,strength:.6}),{version:2,enabled:false,level:75});
  assert.equal(TaskHaptics.settings({version:2,level:37}).level,37);
  assert.equal(TaskHaptics.settings({version:2,level:99}).level,75);
  assert.equal(TaskHaptics.settings({version:2,level:NaN}).level,75);
  assert.equal(TaskHaptics.level(0),1);
});

test('contact onset strength grades force below the selected percentage cap',async()=>{
  for(const force of [.2,5,240,1000])for(const level of [undefined,37]){
    const sent=[],b={state:'live',act:{tachammerReady:true},actT:0,hapticSide:'1',hapticCharacteristic:{writeValueWithResponse:bytes=>{sent.push(bytes);return Promise.resolve();}}};
    TaskHaptics.dispatcher().tick({boards:[b],world:{hands:{1:{}},record:{hands:{1:{force:[force,0,0]}}}},arms:[],now:0,enabled:true,level});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(sent.length,1);assert.equal(sent[0][3],TaskHaptics.impactLevel(force,level));
  }
});

function peer({ ack = true, status = 0 } = {}) {
  let input, number = 30, time = 0;
  const commands = [], parser = new W.StreamReader(); parser.synced = true;
  const send = (type, body) => input.enqueue(W.encodePacket(type, number++, body));
  const port = {
    async open(options) {
      this.options = options;
      this.readable = new ReadableStream({ start(c) { input = c; c.enqueue(fixtureStream().bytes); } });
      this.writable = new WritableStream({ write(bytes) {
        for (const p of parser.feed(bytes)) {
          commands.push(p);
          if (ack) send(W.ACK, W.encodeAck({ command_type: p.type, command_number: p.number, status }));
        }
      } });
    },
    async close() { this.closes = (this.closes || 0) + 1; }
  };
  const link = new CaptureLink(port, () => {}, () => time);
  return { link, port, commands, send, advance: ms => { time += ms; } };
}

test('C fixture identifies capture board; finite task cues use native capture waveform bytes and matching ACK', async () => {
  const p = peer(); await p.link.open();
  try {
    assert.equal(p.link.info.board_id, 0xd892); assert.equal(p.port.options.baudRate, 1000000);
    assert.equal(p.commands.length, 0); // Never send TP HELLO, STOP_ALL, clip, servo or ERM commands.
    for (const id of [1, 3, 6]) await p.link.command(TaskHaptics.packet(75, id));
    assert.deepEqual(p.commands.map(c => [c.type, ...c.body]), [[0x44, 1, 75], [0x44, 3, 75], [0x44, 6, 75]]);
    for (const invalid of [[2, 2, 2, 20, 0, 0], [2, 2, 1, 76, 0, 0], [2, 2, 1, 20, 1, 0], [2, 0]]) {
      await assert.rejects(p.link.command(new Uint8Array(invalid)), /Unsupported/);
    }
    assert.equal(p.commands.length, 3);
  } finally { await Promise.all([p.link.close(), p.link.close()]); }
  assert.equal(p.port.closes, 1);
});

test('capture raw IMU reaches its own consumer while haptic acknowledgements keep working', async () => {
  const p=peer(),batches=[];
  p.link.onImu=(batch,info,at)=>batches.push({batch,info,at});
  await p.link.open();
  try {
    assert.equal(batches.length,1);assert.deepEqual(batches[0].batch.seq,[100,101,102]);
    assert.equal(batches[0].info.board_id,0xd892);assert.equal(batches[0].at,0);
    await p.link.command(TaskHaptics.packet(75,3));assert.equal(p.commands[0].type,0x44);
  } finally {await p.link.close();}
});

test('task rumble cancellation sends only the capture TacHammer STOP and obeys freshness/busy gates',async()=>{
  const p=peer();await p.link.open();
  try{
    await p.link.stopTacHammer();assert.deepEqual(p.commands.map(c=>[c.type,...c.body]),[[0x46]]);
    p.link.writing=true;await assert.rejects(p.link.stopTacHammer(),/busy/);p.link.writing=false;
    p.advance(501);await assert.rejects(p.link.stopTacHammer(),/stale/);
    assert.equal(p.commands.length,1);
  }finally{await p.link.close();}
});

test('stale stream, stale readiness and unready actuator refuse feedback', async () => {
  const p = peer(); await p.link.open();
  try {
    p.advance(501); await assert.rejects(p.link.command(TaskHaptics.packet(15)), /stale/);
    p.link.lastPacket = 501; p.advance(1000); p.link.lastPacket = 1501;
    assert.equal(p.link.ready, false); // Other sensor data cannot indefinitely renew INFO readiness.
    p.link.lastInfo = 1501; p.link.info.flags = 0;
    await assert.rejects(p.link.command(TaskHaptics.packet(15)), /ready/);
    assert.equal(p.commands.length, 0);
  } finally { await p.link.close(); }
});

test('missing ACK drops concurrent feedback, times out without retry, and disconnect cancels pending writes', async () => {
  const p = peer({ ack: false }); await p.link.open();
  const pending = p.link.command(TaskHaptics.packet(15));
  await assert.rejects(p.link.command(TaskHaptics.packet(15)), /busy/);
  await assert.rejects(pending, /answer in time/); assert.equal(p.commands.length, 1);
  const next = p.link.command(TaskHaptics.packet(15));
  const rejection = assert.rejects(next, /disconnected/);
  await p.link.close(); await rejection;
  assert.equal(p.link.ready, false); assert.equal(p.link.client.waiters.size, 0);
});

test('firmware refusal is surfaced and not retried', async () => {
  const p = peer({ status: 2 }); await p.link.open();
  try { await assert.rejects(p.link.command(TaskHaptics.packet(15)), /no actuator/); assert.equal(p.commands.length, 1); }
  finally { await p.link.close(); }
});

test('real task dispatcher sends force-graded native capture percentages while retaining readiness and hand gating', async () => {
  const p = peer(); await p.link.open();
  try {
    const b = { state: 'live', act: { tachammerReady: true }, actT: 0, hapticSide: '1', hapticRateHz: 25,
      hapticCharacteristic: { writeValueWithResponse: bytes => p.link.command(bytes),stopHaptics:()=>p.link.stopTacHammer() } };
    const world = { hands: { 1: {} }, record: { hands: { 1: { force: [.2, 0, 0] } } } };
    const d = TaskHaptics.dispatcher();
    b.transport='capture';b.motion={ready:false};
    d.tick({ boards: [b], world, arms: [], now: 0, enabled: true, level: 75 });
    assert.equal(p.commands.length,0); // Stationary gyro calibration must not excite the actuator.
    b.motion.ready=true;
    d.tick({ boards: [b], world, arms: [], now: 0, enabled: true, level: 75 });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(p.commands.length, 1); assert.equal(p.commands[0].type, 0x44);
    assert.equal(p.commands[0].body[1], TaskHaptics.impactLevel(.2));
    p.advance(150);
    d.tick({ boards: [b], world, arms: [], now: 150, enabled: true, level: 75 });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(p.commands.map(c=>[c.type,...c.body]),[[0x44,1,TaskHaptics.impactLevel(.2)],[0x44,6,7]]);
    p.advance(50);b.hapticSide = 'off'; d.tick({ boards: [b], world, arms: [], now: 200, enabled: true });
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(p.commands.length, 3);assert.deepEqual([p.commands[2].type,...p.commands[2].body],[0x46]);
  } finally { await p.link.close(); }
});

test('real mass-dependent impact grades reach capture waveform ACKs and USB/ESB frames unchanged',async()=>{
  const p=peer();await p.link.open();
  try{
    const levels=[];
    for(const mass of [.015,.03,.1,.3,1]){
      const {world,event}=fallingImpact({mass}),peak=75;
      const b={transport:'capture',motion:{ready:true},state:'live',act:{tachammerReady:true},actT:0,hapticSide:'1',hapticRateHz:25,hapticCharacteristic:{writeValueWithResponse:bytes=>p.link.command(bytes)}};
      TaskHaptics.dispatcher().tick({boards:[b],world,arms:[],now:0,enabled:true,level:peak});
      await new Promise(resolve=>setImmediate(resolve));
      const expected=TaskHaptics.impactLevel(event.force,peak),actual=p.commands.at(-1);levels.push(actual.body[1]);
      assert.deepEqual([actual.type,...actual.body],[0x44,1,expected]);assert.equal(b.hapticLast.level,expected);
      const frames=[],packet=TaskHaptics.packet(expected,1),parser=Controller.parser(f=>frames.push(f));
      parser.push(Controller.frame({type:Controller.TYPE.COMMAND,board:23,pipe:1,stamp:100,payload:packet}));
      assert.deepEqual([...frames[0].payload],[2,2,1,expected,0,0]);
    }
    assert.deepEqual(levels,[28,30,35,41,50]);assert.equal(p.commands.length,5);
  }finally{await p.link.close();}
});
