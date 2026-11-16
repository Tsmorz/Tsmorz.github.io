// Fast input and hard-stop regressions. No camera, device or cloth simulation.
module.exports=function({check}){
  const root=require('path').resolve(__dirname,'../..'),R=require(root+'/tag-tracker/robot-core'),C=require(root+'/tag-tracker/tracker-core'),m=R.model();
  const legal=q=>q.every((v,j)=>Number.isFinite(v)&&v>=(j===3?R.MIN_BEND:R.JOINTS[j].lo)-1e-9&&v<=R.JOINTS[j].hi+1e-9);
  const near=(a,b,e=1e-9)=>a.every((v,j)=>Math.abs(v-b[j])<e);
  let seed=5;const rnd=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/2**32);
  for(const side of [1,-1]){
    const home=R.fk(m,side,R.HOME);let prev={q:R.HOME.slice()},motor={q:R.HOME.slice(),v:Array(7).fill(0)},stops=0,valid=true,fastest=0;
    // Targets are inside the distance envelope: an outer reach clamp alone cannot guard this case.
    // Change both translation and wrist rotation abruptly while the motors retain their velocity.
    for(let i=0;i<1000;i++){
      const t=R.inReach(m,side,C.add(home.shoulder,[rnd()-.5,rnd()-.5,rnd()-.5]));
      const s=R.handIK(m,side,{t,R:C.mul3(home.R,C.rodrigues([rnd()*6-3,rnd()*6-3,rnd()*6-3]))},prev);
      const dt=[1/120,1/60,1/30,.1][i%4],next=R.slew(motor,s.q,dt);
      valid=valid&&legal(s.q)&&legal(next.q)&&[...s.elbow,...s.wrist,...next.v].every(Number.isFinite);
      fastest=Math.max(fastest,...next.v.map((v,j)=>Math.abs(v)/R.SLEW.speed[j]));
      stops+=!!s.positionLimited;prev=s;motor=next;
    }
    check(valid&&stops>100&&fastest<=1+1e-9,`side ${side}: 1,000 aggressive position/orientation changes keep solved and motor joints inside every hard stop (${stops} constrained targets)`);

    const normal=[0,0,1],target=R.inReach(m,side,[-.1,-side*.7,home.wrist[2]],normal);
    const stopped=R.handIK(m,side,{t:target,R:home.R},{q:R.HOME.slice()});
    const rotated=R.handIK(m,side,{t:target,R:C.mul3(home.R,R.Rx(2))},{q:R.HOME.slice()});
    const back=C.add(stopped.wrist,C.sub(home.wrist,stopped.wrist).map(v=>v*.005/C.norm(C.sub(home.wrist,stopped.wrist))));
    const reversed=R.handIK(m,side,{t:back,R:home.R},stopped);
    check(stopped.positionLimited&&legal(stopped.q)&&near(stopped.q.slice(0,4),rotated.q.slice(0,4),1e-12)&&Math.abs(stopped.wrist[2]-home.wrist[2])<1e-9&&near(R.fk(m,side,reversed.q).wrist,back)&&!reversed.positionLimited,`side ${side}: a shoulder/upper-arm stop preserves the drag plane, ignores wrist demand and reverses 5 mm immediately`);

    let recovery={q:[1.7609394181999203,.719444126571142,.5451883037381887,1.7623095900802916,.8425343307405125,-.2604325962960651,.8726646259971648]},pending=0,continuous=true;
    for(let i=0;i<60;i++){
      const next=R.handIK(m,side,{t:home.wrist,R:home.R},recovery),turned=R.handIK(m,side,{t:home.wrist,R:C.mul3(home.R,R.Rx(2))},recovery);
      if(next.positionPending)pending++;
      if(next.positionPending||recovery.positionPending)continuous=continuous&&next.q.slice(0,4).every((v,j)=>Math.abs(v-recovery.q[j])<=R.PREFER.swing+1e-9);
      continuous=continuous&&legal(next.q)&&near(next.q.slice(0,4),turned.q.slice(0,4),1e-12)&&!next.positionLimited;recovery=next;
    }
    check(pending>0&&continuous&&near(R.fk(m,side,recovery.q).wrist,home.wrist),`side ${side}: a large legal return target survives a local elbow-branch boundary and recovers continuously, independently of wrist demand`);
  }
  for(let j=0;j<R.JOINTS.length;j++)for(const sign of [-1,1]){
    const joint=R.JOINTS[j],edge=sign<0?(j===3?R.MIN_BEND:joint.lo):joint.hi,q=R.HOME.slice(),v=Array(7).fill(0),cmd=R.HOME.slice();
    q[j]=edge-sign*.0001;v[j]=sign*R.SLEW.speed[j];cmd[j]=(joint.lo+joint.hi)/2;
    const stop=R.slew({q,v},cmd,1/60),back=R.slew(stop,cmd,1/60);
    check(legal(stop.q)&&stop.q[j]===edge&&stop.v[j]===0&&sign*(back.q[j]-edge)<0,`joint ${j}, direction ${sign}: a reversal cancels outward momentum at the hard stop and moves inward next frame`);
  }
  const q=[.12866161827982125,-.35974620732431606,1.64520310587178,2.502668837481288,1.9624459773825076,.8684889760112486,.5994871264228782],t=[-.23896285457927088,.17091598028155403,-.41963458654048824],rotation=R.fk(m,1,q).R;
  let recovery={q},settled=true;
  for(let i=0;i<100;i++){
    const next=R.handIK(m,1,{t,R:rotation},recovery);
    if(next.positionPending||recovery.positionPending)settled=settled&&next.q.slice(0,4).every((v,j)=>Math.abs(v-recovery.q[j])<=R.PREFER.swing+1e-9);
    recovery={q:next.q,elbow:next.elbow,psi:next.psi,wristInput:next.wristInput,positionPending:next.positionPending,positionGoal:next.positionGoal};
    if(i>60)settled=settled&&!next.positionPending&&near(R.fk(m,1,next.q).wrist,t);
  }
  check(settled,'a fixed reachable target retains its legal recovery endpoint instead of oscillating between global elbow branches');
};
if(require.main===module){const assert=require('node:assert/strict');module.exports({check:(ok,msg)=>{assert.ok(ok,msg);process.stdout.write('ok '+msg+'\n');}});}
