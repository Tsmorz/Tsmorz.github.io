// task shot -- /tag-tracker/ --eval-file script/tag-tracker/pour-browser.js
// The Weissbier pour through actual IK, motor slew and the physical grip: grip the neck, bring the bottle beside the
// mug, tip it outward with the mouth low over the rim while aiming the stream, stand it up, set it down and let go.
(async()=>{
  const wait=ms=>new Promise(r=>setTimeout(r,ms)),assert=(ok,msg)=>{if(!ok)throw new Error(typeof msg==='function'?msg():msg);};
  const until=async(fn,msg,ms=6000)=>{const t=performance.now();while(!fn()&&performance.now()-t<ms)await wait(40);assert(fn(),msg);};
  document.querySelectorAll('dialog[open]').forEach(d=>d.close());setMode('tasks');setCampaignMode('guided');taskLevel('pour');await wait(700);
  const W=TB.world,g=TB.game,p=g.pour,A=p.from.body,B=p.to.body,S=TaskCore.STEIN,BO=TaskCore.BOTTLE,T=W.table,vec=v=>C.mulv(T.R,v),at=(b,q)=>{const s=W.poseOf(b);return C.add(s.t,C.mulv(s.R,q));};
  assert(TASK.guide.state==='pour_grab'&&$('taskLabels').textContent.includes(g.level.guide.labels.grab),'the task opens on the neck marker');
  const d=driveOf(RB.scene.arms.find(a=>a.side===1)),fin=RCORE.gripper(RB.scene.m).finger.c[2],up=v=>vec([0,0,v]),L=q=>g.local(q),hand=()=>W.handPose(1).t;
  const neck=at(A,[0,0,BO.grip]);
  d.open=1;d.t=C.add(d.t,up(.25));await wait(1000);d.R=T.R.slice();d.t=C.add(neck,up(.2-fin));await wait(1500);d.t=C.add(neck,up(-fin));await wait(1500);d.open=0;
  await until(()=>W.hands[1].grip?.body===A,()=>'the left gripper holds the neck: '+JSON.stringify({guide:TASK.guide,hand:L(hand()),neck:L(neck)}));
  const Bc=L(at(B,[0,0,0])),Brim=S.H,a0=L(at(A,[0,0,0])),toB=[Bc[0]-a0[0],Bc[1]-a0[1]].map((x,_,v)=>x/Math.hypot(...v)),roll=toB[1]>0?-1:1;
  const lowestZ=()=>{let m=Infinity;for(let k=0;k<16;k++){const a=k/16*2*Math.PI;for(const x of BO.outside)for(const z of [x.z0,x.z1])m=Math.min(m,L(at(A,[x.r*Math.cos(a),x.r*Math.sin(a),z]))[2]);}return m;};
  const mouth=()=>L(at(A,[0,0,BO.H])),clearance=()=>{let m=Infinity;for(let k=0;k<16;k++){const a=k/16*2*Math.PI;for(const x of BO.outside)for(const z of [x.z0,x.z1]){const q=L(at(A,[x.r*Math.cos(a),x.r*Math.sin(a),z]));if(Math.hypot(q[0]-Bc[0],q[1]-Bc[1])<S.R+.008)m=Math.min(m,q[2]-Brim);}}return m;};
  // the drive in table coordinates
  const setT=q=>{d.t=C.add(T.t,C.mulv(T.R,q));},getT=()=>L(d.t);
  for(let i=0;i<30;i++){setT(C.add(getT(),[0,0,.001]));await wait(16);}
  const goal=[Bc[0]-toB[0]*.095,Bc[1]-toB[1]*.095];
  for(let i=0;i<240;i++){const q=getT(),e=[goal[0]-q[0],goal[1]-q[1]],l=Math.hypot(...e)||1,k=Math.min(1,.0025/l);setT([q[0]+e[0]*k,q[1]+e[1]*k,q[2]]);await wait(16);}
  let tilt=0,maxTilt=0;const start=performance.now();
  while(performance.now()-start<40000&&!(p.from.V<p.V0*.02&&!p.drops.length)){
    const recent=p.drops.filter(x=>x.from===p.from&&x.age<.12),pouring=recent.length>0;
    const aim=pouring?[0,1].map(j=>recent.reduce((acc,x)=>{const q=L(x.p),v=C.mulv(C.tr3(T.R),x.v),z=q[2]-Brim,t=(v[2]+Math.sqrt(Math.max(0,v[2]*v[2]+2*9.81*Math.max(0,z))))/9.81;return acc+q[j]+v[j]*t;},0)/recent.length):mouth().slice(0,2);
    const err=[Bc[0]-aim[0],Bc[1]-aim[1]],step=err.map(x=>x*(pouring?.06:0)),sl=Math.hypot(...step),k=sl>.0025?.0025/sl:1,c=clearance(),q=getT(),z=L(hand())[2];
    setT([q[0]+step[0]*k,q[1]+step[1]*k,c<.012||lowestZ()<.01?Math.max(q[2],z)+.002:Number.isFinite(c)&&c>.035&&lowestZ()>.02&&mouth()[2]-Brim>.05?Math.min(q[2],z)-.0008:q[2]]);
    if(!pouring||Math.hypot(...err)<.025)tilt=Math.min(170,tilt+.5);
    d.R=C.mul3(T.R,RCORE.Rx(roll*tilt*Math.PI/180));
    const R=C.mul3(C.tr3(T.R),W.poseOf(A).R);maxTilt=Math.max(maxTilt,Math.acos(Math.max(-1,Math.min(1,R[8])))*180/Math.PI);
    await wait(16);
  }
  const poured={bottle:Math.round(p.from.V*1e6),mug:Math.round(p.to.V*1e6),spilled:Math.round(p.spilled*1e6),maxTilt:Math.round(maxTilt),wrist:Math.round(tilt)};
  assert(p.to.V>.94*p.V0&&p.spilled<g.level.pour.spill_limit*p.V0,()=>'the robot arm pours the bottle into the mug: '+JSON.stringify({...poured,guide:TASK.guide}));
  // move it off the mug, stand it up (rising only to keep clear of the mug and table), lower it and let go
  setT(L(hand()));
  // carry it, still tipped, back over where it stood, so standing it up swings its base down there, not into the mug
  for(let i=0;i<300;i++){const q=getT(),e=[a0[0]-q[0],a0[1]-q[1]],l=Math.hypot(...e);if(l<.005)break;const k=Math.min(1,.0015/l);setT([q[0]+e[0]*k,q[1]+e[1]*k,q[2]+(clearance()<.015?.002:0)]);await wait(16);}
  while(tilt>0){tilt=Math.max(0,tilt-1);d.R=C.mul3(T.R,RCORE.Rx(roll*tilt*Math.PI/180));const z=L(hand())[2];if(clearance()<.015||lowestZ()<.015)setT([getT()[0],getT()[1],Math.max(getT()[2],z)+.003]);await wait(16);}
  while(Math.hypot(...[0,1].map(j=>L(at(A,[0,0,0]))[j]-Bc[j]))<.13){setT(C.add(getT(),[-toB[0]*.0025,-toB[1]*.0025,0]));await wait(16);}
  // wait until the arm has really stood it up, then lower it slowly onto its base
  // a bottle picked up a little crooked is straightened by eye: turn the wrist until the bottle itself is upright
  const upright=()=>C.mul3(C.tr3(T.R),W.poseOf(A).R)[8];
  for(let i=0;i<300&&upright()<.998;i++){const u=C.mulv(W.poseOf(A).R,[0,0,1]),z=C.mulv(T.R,[0,0,1]),ax=[u[1]*z[2]-u[2]*z[1],u[2]*z[0]-u[0]*z[2],u[0]*z[1]-u[1]*z[0]],sn=C.norm(ax);if(sn<1e-6)break;const ang=Math.atan2(sn,u[0]*z[0]+u[1]*z[1]+u[2]*z[2]);d.R=C.mul3(C.rodrigues(ax.map(v=>v/sn*ang*.15)),d.R);await wait(16);}
  await until(()=>upright()>.995,()=>'the bottle stands upright in the air: '+upright().toFixed(3),4000);
  for(let i=0;i<900&&L(W.poseOf(A).t)[2]>.002;i++){setT(C.add(L(hand()),[0,0,-.0008]));await wait(16);}
  await wait(300);d.open=1;await wait(600);setT(C.add(getT(),[0,0,.12]));
  await until(()=>g.complete,()=>'stood up and released, the pour completes: '+JSON.stringify({notice:TASK.notice,guide:TASK.guide,steps:g.steps,bottle:L(W.poseOf(A).t),spoiled:p.spoiled}),8000);
  return {passed:true,realRobotIK:true,...poured};
})()
