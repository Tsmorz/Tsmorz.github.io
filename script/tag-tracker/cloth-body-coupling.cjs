// Real-world same-substep deformable response: no task or fold trajectory.
module.exports=function({check}){
  const root=require('path').resolve(__dirname,'../..'),P=require(root+'/tag-tracker/physics-core'),Robot=require(root+'/tag-tracker/robot-core'),Cloth=require(root+'/tag-tracker/cloth-core'),C=require(root+'/tag-tracker/tracker-core');
  const I=[1,0,0,0,1,0,0,0,1],h=P.H,add=C.add,sub=C.sub,mul=(v,s)=>v.map(x=>x*s),norm=C.norm,dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],tensor=(R,M)=>C.mul3(C.mul3(R,M),C.tr3(R)),close=(a,b,t=1e-11)=>norm(sub(a,b))<=t;
  const momentum=b=>mul(b.v,b.m),angular=b=>add(C.mulv(tensor(b.R,b.Ib),b.w),cross(b.t,momentum(b))),throws=f=>{try{f();return false;}catch{return true;}};
  const W=P.world(),b=W.add({kind:'block',mass:1.7,pieces:[{type:'box',p:[.025,-.01,.015],h:[.025,.04,.06]}]},[.2,-.3,.7],C.rodrigues([.3,-.4,.2]));b.v=[.2,-.3,.1];b.w=[.4,-.2,.3];
  const before={p:momentum(b),l:angular(b),t:b.t.slice(),R:b.R.slice()},token=W.deformableResponse(b,h),F=[2.4,-1.8,.9],T=[.003,-.002,.001],delta=mul(F,h*h/b.m),turn=mul(C.mulv(tensor(before.R,b.invIb),T),h*h),expectedR=C.mul3(C.rodrigues(turn),before.R),expectedP=add(before.p,mul(F,h)),expectedL=add(before.l,mul(add(T,cross(before.t,F)),h)),response=W.applyDeformableResponse(token,{force:F,torque:T});
  check(Object.isFrozen(token)&&Object.isFrozen(token.position)&&Object.isFrozen(token.inverseInertia)&&close(b.t,add(before.t,delta))&&close(C.so3Log(C.mul3(C.tr3(expectedR),b.R)),[0,0,0])&&close(response.translation,delta)&&close(response.rotation,turn),
    'one frozen finite-body response commits its certified translation and rotation in the same substep');
  check(close(momentum(b),expectedP)&&close(angular(b),expectedL)&&!b.externalImpulse,
    'a rotated anisotropic moving body preserves signed world linear/angular momentum and does not queue the wrench for the next step');
  check(throws(()=>W.applyDeformableResponse(token,{force:F,torque:T})),
    'an aggregate deformable wrench cannot be committed twice with the same token');
  const stale=W.deformableResponse(b,h),other=W.deformableResponse(b,h);W.applyDeformableResponse(other,{force:[0,0,0],torque:[0,0,0]});
  check(throws(()=>W.applyDeformableResponse(stale,{force:F,torque:T})),
    'a second token from an already consumed body state is stale even for a zero response');
  const safe=W.deformableResponse(b,h),snapshot=JSON.stringify({t:b.t,R:b.R,v:b.v,w:b.w});
  check(throws(()=>W.applyDeformableResponse(safe,{force:[NaN,0,0],torque:T}))&&snapshot===JSON.stringify({t:b.t,R:b.R,v:b.v,w:b.w})&&W.applyDeformableResponse(safe,{force:[0,0,0],torque:[0,0,0]}),
    'invalid aggregate forces leave both physical state and the valid response token untouched');
  const frozenBody=W.add('ball',[0,0,1]);frozenBody.fixed=true;const fixed=W.deformableResponse(frozenBody,h),fixedBefore=JSON.stringify({t:frozenBody.t,R:frozenBody.R,v:frozenBody.v,w:frozenBody.w});W.applyDeformableResponse(fixed,{force:F,torque:T});
  check(fixed.fixed&&fixed.inverseMass===0&&fixed.inverseInertia.every(v=>v===0)&&[...fixed.position,...fixed.rotation,...fixed.linearMomentum,...fixed.angularMomentum].every(Number.isFinite)&&fixedBefore===JSON.stringify({t:frozenBody.t,R:frozenBody.R,v:frozenBody.v,w:frozenBody.w})&&!frozenBody.externalImpulse,
    'a fixed body has finite frozen properties and absorbs a wrench without a fictitious pose or delayed impulse');
  b.externalImpulse={linear:[.003,-.002,.001],angular:[.0002,-.0001,.0003]};const pendingBefore=add(b.externalImpulse.angular,cross(b.t,b.externalImpulse.linear)),pending=W.deformableResponse(b,h);W.applyDeformableResponse(pending,{force:[-.3,.7,.2],torque:[0,0,0]});
  check(close(add(b.externalImpulse.angular,cross(b.t,b.externalImpulse.linear)),pendingBefore)&&close(b.externalImpulse.linear,[.003,-.002,.001]),
    'an independent pending impulse retains its signed world moment when the committed COM moves');
  const G=Robot.gripper(),Q=P.world({gripper:G}),pose={R:C.rodrigues([-.2,.35,.1]),t:[.1,-.2,1]},robot={hands:[{side:1,pose,opening:1}],links:[]};Q.resetRobot(robot);const moving=Q.hands[1].body;moving.v=[.31,-.27,.18];moving.w=[.2,-.3,.1];const oldP=momentum(moving),oldL=angular(moving),oldT=moving.t.slice(),movingToken=Q.deformableResponse(moving,h),movingF=[12,-7,9],movingTorque=[.12,-.08,.05];Q.applyDeformableResponse(movingToken,{force:movingF,torque:movingTorque});
  check(close(momentum(moving),add(oldP,mul(movingF,h)))&&close(angular(moving),add(oldL,mul(add(movingTorque,cross(oldT,movingF)),h)))&&!moving.externalImpulse,
    'a moving hand transports orbital and spin momentum when cloth changes its COM pose and inertia frame');
  const N=P.world({gripper:G}),neutral={R:I,t:[0,0,1]},idle={hands:[{side:1,pose:neutral,opening:1}],links:[]};N.resetRobot(idle);const hand=N.hands[1].body,handToken=N.deformableResponse(hand,h);N.applyDeformableResponse(handToken,{force:[0,0,2],torque:[0,0,0]});const at=hand.t.slice(),v=hand.v.slice(),goal=add(neutral.t,P.HAND.com),motor=mul(add(mul(sub(goal,at),P.HAND.w**2),mul(v,-2*P.HAND.w)),P.HAND.mass),expectedV=add(v,mul(motor,h/hand.m)),expectedT=add(at,mul(expectedV,h));N.setRobot(idle);N.step(h);
  check(close(hand.v,expectedV)&&close(hand.t,expectedT)&&!hand.externalImpulse,
    'the next fixed step applies only its ordinary hand motor and never repeats the already committed cloth impulse');

  function pressure(toe,loadStep=false){
    const table={R:I,t:[0,0,0],size:[.3,.3],thick:.03,mu:0},world=P.world({table,gripper:G}),c=Cloth.swatch({resolution:9,width:.04,height:.04,panels:2,at:[0,0,0],areal_density:.18,thickness:.0006,air_drag:0,friction:0,self_friction:0,iterations:1},table);world.gravity=[0,0,0];world.cloths.push(c);
    const ready={hands:[{side:1,pose:{R:I,t:[0,0,toe-(G.pad.c[2]-G.pad.h[2])]},opening:.017/G.gapMax}],links:[]};world.resetRobot(ready);const body=world.hands[1].body,initial=body.t.slice(),steps=[],commit=world.applyDeformableResponse;let current,commits=0;
    world.applyDeformableResponse=function(...args){commits++;return commit(...args);};
    const step=c.step;c.step=function(dt,W){current={before:{t:body.t.slice(),v:body.v.slice(),w:body.w.slice()},beforeK:.5*body.m*dot(body.v,body.v)};step(dt,W);};
    const actualGap=()=>{let gap=Infinity;for(const box of P.padBoxes(G,world.hands[1]))for(const n of c.nodes){const local=C.mulv(C.tr3(box.R),sub(n.p,box.t));if(Math.abs(local[0])<=box.h[0]+1e-10&&Math.abs(local[1])<=box.h[1]+1e-10)gap=Math.min(gap,box.t[2]-box.h[2]-n.p[2]-c.halfThickness);}return gap;};
    for(let i=0;i<(loadStep?14:1);i++){
      if(loadStep&&i>=2&&i<9){const q=body.externalImpulse||(body.externalImpulse={linear:[0,0,0],angular:[0,0,0]});q.linear[2]-=2*h;}
      commits=0;world.setRobot(ready);world.step(h);const reaction=c.reactions[1]||{force:[0,0,0],torque:[0,0,0],load:0},J=mul(reaction.force,h),predictedK=dot(J,current.before.v)+.5*dot(J,J)/body.m,kineticChange=.5*body.m*dot(body.v,body.v)-current.beforeK;
      steps.push({gap:actualGap(),reaction,commits,position:body.t.slice(),velocity:body.v.slice(),before:current.before,predictedK,kineticChange,queue:body.externalImpulse,normalResidual:c.surfaceResidual,feasibility:c.patchFeasibility,rigidOverlap:Math.max(0,...body.sp.map(s=>-P.sphereBox(add(body.t,C.mulv(body.R,s.p)),s.r,world.tableBox,world.tableBox.h).dist),...P.padBoxes(G,world.hands[1]).map(box=>-P.boxBox(box,world.tableBox).dist))});
    }
    return {c,world,body,initial,steps};
  }
  const finite=pressure(.0005),first=finite.steps[0],analytic=.0014/(1/P.JAW.padStiffness+2*h*h/P.HAND.mass);
  check(Math.abs(first.reaction.force[2]-analytic)<1e-5&&first.normalResidual<=3e-7&&first.gap>=-3e-7&&first.commits===1&&close(sub(first.position,finite.initial),mul(first.reaction.force,h*h/P.HAND.mass),1e-10)&&close(first.velocity,mul(first.reaction.force,h/P.HAND.mass),1e-9)&&!first.queue,
    'the real finite-hand pressure coupon realizes its analytic same-H displacement and actual pad/cloth gap, not only a virtual certificate');
  const loaded=pressure(.0012,true),load=loaded.steps[2];
  check(loaded.steps.slice(0,2).every(s=>Math.abs(s.gap)<1e-9&&s.reaction.load===0)&&load.reaction.load>.1&&loaded.steps.every(s=>s.gap>=-3e-7&&s.rigidOverlap<1e-9&&s.reaction.load<P.HAND.force&&(s.feasibility||0)<=1e-9&&!s.queue),
    'a zero-preload2N load step and release preserve actual same-H gaps, strict force feasibility and the original hand/table budgets');
  check(Math.abs(load.kineticChange-load.predictedK)<1e-10&&Math.abs(load.kineticChange)>1e-7&&close(sub(load.position,load.before.t),mul(load.reaction.force,h*h/P.HAND.mass),1e-10),
    'the first loaded substep applies the reaction work and body motion now instead of leaving them in a deferred momentum buffer');
};
if(require.main===module){const assert=require('node:assert/strict');module.exports({check:(ok,msg)=>{assert.ok(ok,msg);process.stdout.write('ok '+msg+'\n');}});}
