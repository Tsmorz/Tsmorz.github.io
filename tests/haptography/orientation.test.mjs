import { test } from 'node:test';
import assert from 'node:assert/strict';
import O from '../../tag-tracker/capture-core.js';
import C from '../../tag-tracker/tracker-core.js';

const info={board_id:0x1bde,flags:1,imu_rate_hz:1000,gyro_dps_per_lsb:.01,accel_g_per_lsb:.0001};
const I=[1,0,0,0,1,0,0,0,1],degrees=Math.PI/180;
function stream(){
  const estimator=new O.Estimator();let seq=0,t=0;
  function run(seconds,gyro=[0,0,0],acc=[0,0,1]){
    const count=Math.round(seconds*1000);
    for(let start=0;start<count;start+=10){
      const b={seq:[],t_us:[],gyro:[],accel:[]};
      for(let i=start;i<Math.min(count,start+10);i++){
        const g=typeof gyro==='function'?gyro(i/1000):gyro,a=typeof acc==='function'?acc(i/1000):acc;
        b.seq.push(seq++>>>0);b.t_us.push(t+=1000);b.gyro.push(g.map(x=>Math.round(x/.01)));b.accel.push(a.map(x=>Math.round(x/.0001)));
      }
      estimator.feed(b,info,t/1000);
    }
    return estimator.snapshot;
  }
  return {estimator,run,get now(){return t/1000;}};
}
const error=(q,R)=>C.angleOf(C.mul3(C.rotOfQuat(q),C.tr3(R)));

test('capture orientation requires still calibration and removes a real-sized gyro bias',()=>{
  const s=stream();assert.equal(s.run(1,[4,-2,3]).ready,false);
  assert.equal(s.run(1.1,[4,-2,3]).ready,true);
  const q=s.run(8,[4,-2,3]).q;
  assert.ok(error(q,I)<.001);assert.equal(s.estimator.samples,10100);
});

test('raw gyro follows known yaw, roll and pitch with normalized finite quaternions',()=>{
  for(const axis of [0,1,2]){
    const s=stream();s.run(2.1);
    const gyro=[0,0,0];gyro[axis]=60;
    const q=s.run(.5,gyro,t=>C.mulv(C.tr3(C.rodrigues(gyro.map(v=>v*degrees*(t+.001)))),[0,0,1])).q;
    assert.ok(Math.abs(Math.hypot(...q)-1)<1e-12);
    assert.ok(error(q,C.rodrigues(gyro.map(v=>v*degrees*.5)))<2*degrees,`axis ${axis}`);
  }
});

test('tilted and upside-down startup gravity produces the right world up',()=>{
  for(const acc of [[1,0,0],[0,1,0],[0,0,-1]]){
    const s=stream(),q=s.run(2.1,[0,0,0],acc).q;
    assert.ok(C.norm(C.sub(C.mulv(C.rotOfQuat(q),acc),[0,0,1]))<1e-6);
  }
});

test('large linear acceleration and saturated actuator impulses do not become tilt commands',()=>{
  const s=stream();s.run(2.1);const q=s.run(1,[0,0,0],[1,0,1.5]).q;
  assert.ok(error(q,I)<1e-6);
  const next=s.run(.1,[0,0,60],[3.2767,0,1]);
  assert.equal(next.ready,true);assert.ok(error(next.q,C.rodrigues([0,0,6*degrees]))<1e-6);
});

test('gaps, restarts, clipping, bad scales and nonfinite samples invalidate calibration',()=>{
  const cases=[
    b=>b.seq[0]+=4,b=>b.t_us[0]+=50000,b=>b.t_us[0]=0,
    b=>b.gyro[0][0]=32767,b=>b.gyro[0][0]=NaN
  ];
  for(const change of cases){
    const s=stream();s.run(2.1);const epoch=s.estimator.snapshot.epoch;
    const b={seq:[2100],t_us:[2101000],gyro:[[0,0,0]],accel:[[0,0,10000]]};change(b);
    const next=s.estimator.feed(b,info,2101);assert.equal(next.ready,false);assert.ok(next.epoch>epoch);
  }
  const s=stream();s.run(2.1);s.estimator.feed({seq:[2100],t_us:[2101000],gyro:[[0,0,0]],accel:[[0,0,10000]]},{...info,gyro_dps_per_lsb:Infinity},2101);
  assert.equal(s.estimator.snapshot.ready,false);
});

test('neutral pose maps sensor rotation to a selected hand without changing its reference frame',()=>{
  const s=stream(),control=new O.Control();s.run(2.1);
  const base=C.rodrigues([.2,-.4,.1]);
  assert.ok(control.zero(s.estimator.snapshot,base,-1,'camera',s.now));
  const sample=s.run(.5,[0,0,60]),R=control.rotation(sample,-1,'camera',s.now,true);
  assert.ok(C.angleOf(C.mul3(R,C.tr3(C.mul3(base,C.rodrigues([0,0,30*degrees])))))<1e-5);
  assert.equal(control.rotation(sample,1,'camera',s.now,true),null);
});

test('stale data, background use and estimator resets hold the last target until recentered',()=>{
  for(const reason of ['stale','background','restart']){
    const s=stream(),control=new O.Control();s.run(2.1);control.zero(s.estimator.snapshot,I,1,'camera',s.now);
    const moved=s.run(.2,[0,0,60]),last=control.rotation(moved,1,'camera',s.now,true);
    const next={...moved,epoch:moved.epoch+(reason==='restart'?1:0)};
    assert.deepEqual(control.rotation(next,1,'camera',s.now+(reason==='stale'?101:0),reason!=='background'),last);
    const resumed=s.run(.2,[0,0,60]);assert.deepEqual(control.rotation(resumed,1,'camera',s.now,true),last);
    assert.ok(control.zero(resumed,last,1,'camera',s.now));assert.equal(control.paused,false);
    assert.equal(control.rotation(resumed,1,'tag',s.now,true),null);
  }
});

test('neutral calibration refuses unready or stale data',()=>{
  const control=new O.Control(),s=stream();assert.equal(control.zero(s.run(1),I,1,'camera',s.now),false);
  const sample=s.run(1.1);assert.equal(control.zero(sample,I,1,'camera',s.now+100),false);
  assert.equal(control.zero(sample,I,0,'camera',s.now),false);
});
