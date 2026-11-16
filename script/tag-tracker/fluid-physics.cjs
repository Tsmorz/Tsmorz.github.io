// Fluid/rigid momentum and current-contact contracts; no device or garment fold.
module.exports=function({check}){
  const root=require('path').resolve(__dirname,'../..'),P=require(root+'/tag-tracker/physics-core'),R=require(root+'/tag-tracker/robot-core'),C=require(root+'/tag-tracker/tracker-core');
  const I=[1,0,0,0,1,0,0,0,1],add=C.add,sub=C.sub,norm=C.norm,mv=C.mulv,scale=(v,s)=>v.map(x=>x*s),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
  const momentum=b=>scale(b.v,b.m),angular=b=>add(mv(C.mul3(C.mul3(b.R,b.Ib),C.tr3(b.R)),b.w),cross(b.t,momentum(b)));
  const energy=b=>.5*b.m*dot(b.v,b.v)+.5*dot(b.w,mv(C.mul3(C.mul3(b.R,b.Ib),C.tr3(b.R)),b.w));
  const W=P.world(),rotation=R.Ry(.6),position=[1,-.4,.8],body=W.add({kind:'bottle',mass:.25,pieces:[{type:'box',p:[0,0,.04],h:[.03,.025,.04]}]},position,rotation),dryMass=body.m;
  const origin=()=>W.poseOf(body).t,worldPoint=p=>add(body.t,mv(body.R,p)),spheres=body.sp.map(s=>worldPoint(s.p));
  body.v=[.2,-.1,.3];body.w=[.4,.2,-.3];
  const beforeP=momentum(body),beforeL=angular(body),beforeE=energy(body),fluid={mass:.5,center:[0,0,.09],inertia:[.0005,0,0,0,.0005,0,0,0,.0002]},point=add(position,mv(rotation,fluid.center)),velocity=[.3,.5,-.7];
  // A held vessel's anchor is in COM coordinates and must survive a mass shift.
  W.hands[1]={grip:{body,pB:[.015,0,.02]}};const anchor=worldPoint(W.hands[1].grip.pB);
  W.setFluid(body,fluid,[{mass:.5,point,velocity}]);
  check(Math.abs(body.m-.75)<1e-12&&norm(sub(origin(),position))<1e-12&&body.sp.every((s,i)=>norm(sub(worldPoint(s.p),spheres[i]))<1e-12)&&norm(sub(worldPoint(W.hands[1].grip.pB),anchor))<1e-12,'adding beer changes vessel mass/COM/inertia without moving its shape, collision surface or grip anchor');
  check(norm(sub(momentum(body),add(beforeP,scale(velocity,.5))))<1e-12&&norm(sub(angular(body),add(beforeL,cross(point,scale(velocity,.5)))))<1e-12,'collecting beer conserves incoming linear and angular momentum at the impact point');
  check(energy(body)<=beforeE+.25*dot(velocity,velocity)+1e-12,'inelastic collection dissipates kinetic energy rather than creating it');
  const loadedTensor=body.Ib.slice();for(let i=0;i<100;i++)W.setFluid(body,fluid);
  check(body.m===.75&&body.Ib.every((v,i)=>Math.abs(v-loadedTensor[i])<1e-15),'refreshing the same fluid moments never accumulates its mass or inertia');
  const oldP=momentum(body),oldL=angular(body),jetPoint=add(position,mv(rotation,[0,0,.18])),jetVelocity=add(body.v,add(cross(body.w,sub(jetPoint,body.t)),[.4,0,.7]));
  W.setFluid(body,{...fluid,mass:.4,inertia:scale(fluid.inertia,.8)},[{mass:-.1,point:jetPoint,velocity:jetVelocity}]);
  check(norm(sub(add(momentum(body),scale(jetVelocity,.1)),oldP))<1e-12&&norm(sub(add(angular(body),cross(jetPoint,scale(jetVelocity,.1))),oldL))<1e-12,'beer leaving the lip transfers its momentum to the jet and gives the vessel the corresponding recoil');
  W.hands={};W.reset();check(body.m===dryMass&&norm(sub(origin(),position))<1e-12&&norm(body.v)===0&&norm(body.w)===0,'reset restores dry properties and original shape pose before the pour refills');
  W.setFluid(body,fluid);check(body.m===.75&&norm(body.v)===0&&norm(body.w)===0,'refilling a reset vessel restores the full weight without a startup impulse');
  let rejected=false;try{W.setFluid(body,{mass:.01,center:[0,0,.05],inertia:[1e-6,2e-6,0,2e-6,1e-6,0,0,0,1e-6]});}catch(e){rejected=/positive semidefinite/.test(e.message);}
  check(rejected&&body.m===.75,'a negative-energy fluid inertia is rejected before changing the vessel');
  const shellWorld=P.world(),r=.04,ri=.035,height=.12,mass=.3,axial=mass*(r*r+ri*ri)/2,lateral=mass*(3*(r*r+ri*ri)+height*height)/12;
  const shell=shellWorld.add({kind:'bottle',mass,pieces:[{type:'cylinder',p:[0,0,height/2],r,h:height/2}],massProperties:{center:[0,0,height/2],inertia:[lateral,0,0,0,lateral,0,0,0,axial]}},[0,0,0],I);
  check(Math.abs(shell.Ib[8]-axial)<1e-15&&shell.Ib[8]>mass*r*r/2&&norm(shellWorld.poseOf(shell).t)<1e-15,'solid collision proxies use hollow-shell mass/inertia without changing their visible origin');
  const hit=[.04,0,.1],J=[.01,.02,-.03],p0=momentum(shell),l0=angular(shell);shell.asleep=true;
  shellWorld.applyImpulse(shell,J,hit);
  check(!shell.asleep&&norm(sub(momentum(shell),add(p0,J)))<1e-12&&norm(sub(angular(shell),add(l0,cross(hit,J))))<1e-12,'a jet striking a sleeping exterior shell transfers its linear/angular impulse and wakes it');

  const G=R.gripper(R.model()),table={R:I,t:[0,0,0],size:[1,1],thick:.03},Q=P.world({table,gripper:G}),pose=z=>({R:R.Ry(-Math.PI/2),t:[0,0,z]}),robot=z=>({hands:[{side:1,pose:pose(z),opening:1}]});
  Q.resetRobot(robot(.05));for(let i=0;i<120;i++){Q.setRobot(robot(.02));Q.step(P.H);}
  check(norm(Q.contactState.hands[1].force)>5,'the current fixed-step contact record measures a real sustained press');
  let contactSteps=0;Q.preStep.push(()=>{if(++contactSteps===4)Q.hands[1].body.externalImpulse={linear:[0,0,1.2],angular:[0,0,0]};});
  Q.setRobot(robot(.02));Q.step(1/30);
  check(norm(Q.record.hands[1].force)>.08&&norm(Q.contactState.hands[1].force)<.08,'separation clears current force even when the same render frame still contains an earlier table impulse');
  Q.resetRobot(robot(.2));check(Q.contactState===null,'reset clears current contact history as well as frame averages');

  const F=P.world({gripper:G});F.resetRobot(robot(.5));const h=F.hands[1];h.fabricGap=.004;
  for(let i=0;i<120;i++){F.setRobot({hands:[{side:1,pose:pose(.5),opening:0}]});F.step(P.H);}
  check(Math.abs(h.gap-.004)<1e-12&&Math.abs(h.fabricForce-Math.min(P.GRIP.force,P.GRIP.k*.004))<1e-9,'clamped fabric stops the jaws at its measured gap and gets finite servo squeeze');
  F.setRobot(robot(.5));F.step(P.H);check(h.fabricForce===0&&h.gap>.004,'opening releases fabric normal force immediately');
};
if(require.main===module){const assert=require('node:assert/strict');module.exports({check:(ok,msg)=>{assert.ok(ok,msg);process.stdout.write('ok '+msg+'\n');}});}
