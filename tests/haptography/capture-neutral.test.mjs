import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import O from '../../tag-tracker/capture-core.js';
import C from '../../tag-tracker/tracker-core.js';
import R from '../../tag-tracker/robot-core.js';

const source=readFileSync(new URL('../../tag-tracker/app-capture.js',import.meta.url),'utf8');
const angle=(a,b)=>C.angleOf(C.mul3(a,C.tr3(b)));
function page(side){
  const m=R.model(),ready=R.HOME.slice(),chest={R:R.Rz(.63),t:[.2,-.4,.7]},base=C.mul3(chest.R,R.fk(m,side,ready).R);
  const control=new O.Control();let sample={ready:true,q:[1,0,0,0],at:1000,epoch:7},prev={q:ready};
  control.zero(sample,base,side,'camera',1000,chest.R);
  for(let degrees=0;degrees<=810;degrees+=2){
    sample={...sample,q:C.quatOf(R.Rz(degrees*Math.PI/180))};
    const target=control.rotation(sample,side,'camera',1000,true);
    prev=R.wrist(m,side,ready,C.mul3(C.tr3(chest.R),target),prev.wristInput);
  }
  assert.ok(prev.wristInput.some(v=>Math.abs(v)>2*Math.PI),'fixture has an unwrapped full-turn wrist request');
  const board={transport:'capture',state:'live',hapticSide:String(side),motion:sample,captureControl:control};
  const otherControl=new O.Control();otherControl.zero(sample,base,-side,'camera',1000,chest.R);
  const other={transport:'capture',captureControl:otherControl};
  const drive={R:control.last.slice(),t:[.31,-.18,.47],open:.43,frame:'camera'},selected={...prev,side,elbow:R.fk(m,side,ready).elbow,positionPending:true,positionGoal:{kept:true}};
  const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);};
  const RB={scene:{m,chest,arms:[{side,q:prev.q.slice()},{side:-side,q:ready.slice()}]},prev:new Map([
    ['drive'+side,selected],['capture'+side,{...prev}],['wrist-tag',{...prev,side,tag:{keep:true}}],['drive'+(-side),{...prev,side:-side}]
  ]),slew:new Map([[side,{q:prev.q.slice(),v:[0,0,0,0,.2,-.3,.1]}]])};
  const context=vm.createContext({C,RCORE:R,CaptureOrientation:O,RB,TB:{drive:new Map([[side,drive]])},S:{boards:[board,other],settings:{frame:'camera'}},
    TASK_DATA:{link:{capture_neutral_help:'help',capture_still:'still',capture_on:'on'}},V:{},$,robotReady:()=>ready.slice(),gameView:()=>true,
    performance:{now:()=>1000},document:{hidden:false,hasFocus:()=>true,addEventListener(){}},window:{addEventListener(){}},paintControllerPanel(){}});
  vm.runInContext(source,context);
  return {context,board,other,drive,RB,base,side,selected,nodes};
}

test('Set neutral returns either saturated gripper to its canonical base without changing translation or calibration',()=>{
  for(const side of [1,-1]){
    const p=page(side),{context,board,other,drive,RB,base}=p;
    const before={t:drive.t.slice(),open:drive.open,motion:board.motion,otherNeutral:other.captureControl.neutral,motor:JSON.stringify([...RB.slew]),arm:RB.scene.arms[0].q.slice(),unrelated:RB.prev.get('drive'+(-side)).wristInput};
    context.zeroCaptureOrientation(board);
    assert.ok(angle(board.captureControl.neutral.R,base)<1e-7);
    assert.ok(angle(board.captureControl.rotation(board.motion,side,'camera',1000,true),base)<1e-7);
    assert.ok(angle(drive.R,base)<1e-7);
    assert.deepEqual(drive.t,before.t);assert.equal(drive.open,before.open);assert.equal(board.motion,before.motion);
    assert.equal(board.captureControl.neutral.epoch,before.motion.epoch);assert.equal(other.captureControl.neutral,before.otherNeutral);
    assert.equal(JSON.stringify([...RB.slew]),before.motor);assert.deepEqual(RB.scene.arms[0].q,before.arm);
    for(const key of ['drive'+side,'capture'+side,'wrist-tag'])assert.equal(RB.prev.get(key).wristInput,undefined);
    assert.equal(RB.prev.get('drive'+(-side)).wristInput,before.unrelated);
    assert.equal(p.selected.positionPending,true);assert.deepEqual(p.selected.positionGoal,{kept:true});
    const next=R.wrist(RB.scene.m,side,before.arm,C.mul3(C.tr3(RB.scene.chest.R),base),p.selected.wristInput);
    assert.deepEqual(next.q.slice(0,4),before.arm.slice(0,4));
    assert.ok(angle(R.fk(RB.scene.m,side,next.q).R,R.fk(RB.scene.m,side,R.HOME).R)<1e-7,'cleared turn history allows the actual wrist command to return to base');
  }
});

test('refused Set neutral preserves the existing wrist request and mouse controls',()=>{
  const p=page(1);p.board.motion={...p.board.motion,ready:false};
  const before={neutral:p.board.captureControl.neutral,R:p.drive.R.slice(),wrist:p.selected.wristInput};
  p.context.zeroCaptureOrientation(p.board);
  assert.equal(p.board.captureControl.neutral,before.neutral);assert.deepEqual(p.drive.R,before.R);assert.equal(p.selected.wristInput,before.wrist);
  assert.equal(p.nodes.get('ctlConnectionStatus').textContent,'still');
});

test('a restart holds the ready hand until fresh capture data can retarget without hiding a stream reset',()=>{
  for(const side of [1,-1])for(const reset of [false,true])for(const inactive of [false,true]){
    const p=page(side),control=p.board.captureControl,epoch=p.board.motion.epoch;
    control.needsTaskPose=true;p.board.motion={...p.board.motion,at:700,epoch:epoch+(reset?1:0)};p.context.document.hidden=inactive;
    const target=p.context.captureHandRotation(side,1000);
    assert.ok(angle(target,p.base)<1e-7);assert.ok(angle(control.last,p.base)<1e-7);assert.equal(control.needsTaskPose,true);
    assert.equal(control.recenterRequired,reset);
    p.board.motion={...p.board.motion,at:1000};p.context.document.hidden=false;
    assert.ok(angle(p.context.captureHandRotation(side,1000),p.base)<1e-7);
    assert.equal(control.needsTaskPose,reset);assert.equal(control.recenterRequired,reset);
    assert.equal(control.neutral.epoch,epoch);
  }
});
