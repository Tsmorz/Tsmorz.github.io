// Shared jaw spring, loaded-face geometry and commit contracts; no garment trajectory.
module.exports=function({check}){
  const P=require('../../tag-tracker/physics-core'),R=require('../../tag-tracker/robot-core'),C=require('../../tag-tracker/tracker-core'),I=[1,0,0,0,1,0,0,0,1],G=R.gripper(),near=(a,b,t=1e-10)=>Math.abs(a-b)<t,zero=()=>({'1':[0,0,0],'-1':[0,0,0]}),K=P.JAW.padStiffness,ka=P.JAW.carrierStiffness;
  const pressure=(a,b=a)=>({'1':a,'-1':b}),compression=(a,b=a)=>({'1':[0,-a/K,0],'-1':[0,b/K,0]}),pose={R:I,t:[0,0,1]};
  function fixture(gap=0){
    const W=P.world({gripper:G,floor:-10}),robot=opening=>({hands:[{side:1,pose,opening}]});let action=null;
    W.resetRobot(robot(gap/G.gapMax));W.cloths.push({step:()=>action?.(W,W.jawActuator(1))});
    return {W,get h(){return W.hands[1];},step(opening=0,fn=null){action=fn;W.setRobot(robot(opening));W.step(P.H);},robot};
  }
  check(near(1/P.GRIP.k,1/ka+2/K)&&near(ka,3600),'the carrier and two explicit rubber faces preserve the2000N/m loaded-face stiffness in series');
  const free=fixture(.017);let baseline;
  free.step(0,(_,a)=>{baseline=a;});
  check(near(free.h.driveGap,.017-P.JAW_SPEED*P.H)&&near(free.h.gap,free.h.driveGap)&&baseline.preload===0&&Object.isFrozen(baseline)&&Object.isFrozen(baseline.padCompression[1]),'unloaded jaws slew by the original speed and expose an immutable zero-load substep baseline');
  check(near(baseline.startCarrierGap,.017)&&baseline.dt===P.H&&Object.isFrozen(baseline.startPadCompression[-1])&&near((baseline.carrierGap-baseline.startCarrierGap)/baseline.dt,-P.JAW_SPEED),'the immutable baseline carries previous geometry and the fixed substep for work-consistent pad material-point velocities');
  for(let i=0;i<30;i++)free.step();
  check(free.h.driveGap===0&&free.h.gap===0&&free.h.fabricForce===0,'an empty cloth world closes without a fabricated preload or captured thickness');
  const clamped=fixture(),d=.0012,F=P.GRIP.k*d,q=d-2*F/K;let token;
  clamped.step(0,(W,a)=>{token=a;W.applyJawActuator(1,a,{carrierGap:q,padCompression:compression(F),load:F,pressure:pressure(F),gap:d});});
  check(near(clamped.h.gap,d)&&near(clamped.h.carrierGap,q)&&near(clamped.h.jawForce,F)&&near(clamped.h.fabricForce,F)&&clamped.h.jawEquilibriumResidual<1e-9,'cloth can open initially empty jaws through the shared spring and rubber compliance without a pin or kinematic thickness stop');
  const loaded=clamped.h.gap;let opening;
  clamped.step(1,(_,a)=>{opening=a;});
  check(opening.preload===0&&clamped.h.fabricForce===0&&clamped.h.jawLoad===0&&clamped.h.gap>loaded&&Object.values(clamped.h.padCompression).flat().every(v=>v===0),'opening releases closing preload and old pad compression immediately while the unloaded drive keeps slewing');
  let stale=false;try{clamped.W.applyJawActuator(1,token,{carrierGap:0,padCompression:zero(),load:0});}catch(e){stale=/Stale or repeated/.test(e.message);}
  check(stale,'a prior substep cannot apply a late jaw result');
  const asymmetric=fixture();let repeated=false;
  asymmetric.step(0,(W,a)=>{const result={carrierGap:.003,padCompression:compression(2,1),load:ka*.003,pressure:pressure(2,1)};W.applyJawActuator(1,a,result);try{W.applyJawActuator(1,a,result);}catch(e){repeated=/repeated/.test(e.message);}});
  check(repeated&&near(asymmetric.h.fabricForce,1)&&near(asymmetric.h.jawLoad,10.8)&&!near(P.GRIP.k*asymmetric.h.gap,asymmetric.h.jawLoad),'asymmetric rubber and metal loads share one actuator while only actual opposing normal pressure grants grip');
  let persisted;
  asymmetric.step(0,(W,a)=>{persisted=a;W.applyJawActuator(1,a,{carrierGap:.003,padCompression:compression(2,1),load:ka*.003,pressure:pressure(2,1)});});
  check(near(persisted.preload,10.8)&&near(persisted.carrierGap,.003)&&!near(persisted.preload,persisted.nominalPreload),'a later baseline preserves the real carrier spring instead of rebasing asymmetric state from loaded gap');
  const metalOnly=fixture();let falseGrip=false;
  for(let i=0;i<2;i++)metalOnly.step(0,(W,a)=>{falseGrip||=W.hands[1].fabricForce>0;W.applyJawActuator(1,a,{carrierGap:.003,padCompression:zero(),load:10.8});});
  check(!falseGrip&&metalOnly.h.fabricForce===0&&metalOnly.h.jawLoad>0,'metal-only carrier support never becomes opposing rubber pressure in the next substep');
  const h=asymmetric.h;
  check(h.body.padBoxes.length===2&&h.body.padBoxes.every(box=>{const shape=G.padShape(box.jaw,h.carrierGap,h.padCompression[box.jaw]);return C.norm(C.sub(C.add(box.p,P.HAND.com),shape.c))<1e-12&&C.norm(C.sub(box.h,shape.h))<1e-12;})&&h.body.sp.filter(s=>s.jaw).every(s=>{const shape=G.padShape(s.jaw,h.carrierGap,h.padCompression[s.jaw]),point=C.add(s.p,P.HAND.com);return point.every((v,i)=>Math.abs(v-shape.c[i])+s.r<=shape.h[i]+1e-12);}), 'both exact deformed rubber collision boxes and any prop-contact samples match the actual shared pad shape');
  asymmetric.step();
  check(asymmetric.h.jawLoad===0&&asymmetric.h.fabricForce===0&&near(asymmetric.h.gap,asymmetric.h.driveGap)&&Object.values(asymmetric.h.padCompression).flat().every(v=>v===0),'a cloth step that returns without contact or commit releases previous pressure geometry and feedback');
  function steadyPad(value,load,innerPressure=0){
    const f=fixture(.017),baselines=[],motions=[],opening=.017/G.gapMax;
    for(let step=0;step<3;step++)f.step(opening,(W,a)=>{
      baselines.push(a);if(step)for(const jaw of [-1,1])for(const u of [[0,-jaw,-1],[1,-jaw,0],[-1,0,1]]){
        const before=G.padShape(jaw,a.startCarrierGap,a.startPadCompression[jaw]),current=G.padShape(jaw,a.carrierGap,a.padCompression[jaw]);
        motions.push(C.norm(current.c.map((v,k)=>v+u[k]*current.h[k]-before.c[k]-u[k]*before.h[k])));
      }
      W.applyJawActuator(1,a,{carrierGap:a.driveGap+load/ka,padCompression:value,load,pressure:pressure(innerPressure)});
    });
    return {f,baselines,motions,opening};
  }
  const toe=steadyPad({'1':[0,0,-1/K],'-1':[0,0,0]},0),inner=steadyPad(compression(1),1,1),mixedValue={'1':[.2/K,-1/K,-.7/K],'-1':[-.1/K,1/K,-.4/K]},mixed=steadyPad(mixedValue,1,1);
  check(Math.max(...toe.motions)<1e-12&&toe.baselines.slice(1).every(a=>near(a.padCompression[1][2],-1/K)&&a.preload===0&&a.opening)&&toe.f.h.fabricForce===0,
    'a sustained toe load preserves committed pad compression with zero carrier effort and creates no repeated material-skin recovery motion');
  check(Math.max(...inner.motions,...mixed.motions)<1e-12&&inner.baselines.slice(1).every(a=>near(a.preload,1))&&mixed.baselines.slice(1).every(a=>near(a.padCompression[1][0],mixedValue[1][0])&&near(a.padCompression[-1][2],mixedValue[-1][2])),
    'steady inner-face and mixed side/toe loads retain the same material-point geometry over three actual substeps');
  const priorGap=inner.f.h.gap;let release;
  inner.f.step(priorGap/G.gapMax,(_,a)=>{release=a;});
  check(release.opening&&release.preload===0&&release.gap>priorGap&&near(release.gap,G.padShape(1,release.carrierGap,release.padCompression[1]).c[1]-G.padShape(1,release.carrierGap,release.padCompression[1]).h[1]-(G.padShape(-1,release.carrierGap,release.padCompression[-1]).c[1]+G.padShape(-1,release.carrierGap,release.padCompression[-1]).h[1]))&&Object.values(inner.f.h.padCompression).flat().every(v=>v===0)&&inner.f.h.fabricForce===0,
    'opening releases the carrier preload immediately, retains the prior-command opening flag and uses the real loaded face gap until a no-contact step clears deformation');
  let toeRelease,toeClear;
  toe.f.step(toe.opening,(_,a)=>{toeRelease=a;});toe.f.step(toe.opening,(_,a)=>{toeClear=a;});
  check(near(toeRelease.padCompression[1][2],-1/K)&&Object.values(toe.f.h.padCompression).flat().every(v=>v===0)&&Object.values(toeClear.startPadCompression).flat().every(v=>v===0)&&Object.values(toeClear.padCompression).flat().every(v=>v===0)&&toe.f.h.jawLoad===0&&toe.f.h.fabricForce===0&&C.norm(toe.f.W.contactState.hands[1].force)<1e-12&&!toe.f.h.body.externalImpulse,
    'true separation without a new cloth commit clears toe deformation and feedback in that step, then never replays recovery or adds an artificial impulse');
  const legacyG={...G};delete legacyG.padShape;const legacy=P.world({gripper:legacyG,floor:-10}),legacyRobot={hands:[{side:1,pose,opening:.2}]};legacy.resetRobot(legacyRobot);legacy.cloths.push({step(){}});legacy.setRobot(legacyRobot);legacy.step(P.H);
  check(near(legacy.hands[1].gap,.2*G.gapMax)&&legacy.hands[1].fabricForce===0&&Number.isFinite(legacy.hands[1].carrierGap),
    'an undeformed legacy gripper without padShape retains its free-jaw cloth-world path');
  const turn=C.rodrigues([.4,-.6,.2]),v=[3,-4,-2],world=C.mulv(turn,v);
  check(near(P.jawLoad(I,1,[0,-15,0])+P.jawLoad(I,-1,[0,15,0]),15)&&near(P.jawLoad(I,1,v),2)&&near(P.jawLoad(turn,1,world),2),'both jaws share a single generalized force budget and tangential carrier loads preserve frame covariance');
  const plateau=fixture();
  plateau.step(0,(W,a)=>W.applyJawActuator(1,a,{carrierGap:.084,padCompression:compression(9),load:60,pressure:pressure(9)}));
  check(plateau.h.gap>G.gapMax&&plateau.h.carrierGap<G.gapMax&&plateau.h.jawForce===60,'the force-limited plateau permits real rubber compression beyond the unloaded stroke without clamping loaded faces');
  let plateauBase,ratchetRejected=false;
  plateau.step(0,(W,a)=>{plateauBase=a;const load=3;try{W.applyJawActuator(1,a,{carrierGap:a.carrierGap+(load-a.preload)/ka,padCompression:compression(load),load,pressure:pressure(load)});}catch(e){ratchetRejected=/equilibrium/.test(e.message);}W.applyJawActuator(1,a,{carrierGap:a.driveGap+load/ka,padCompression:compression(load),load,pressure:pressure(load)});});
  check(ratchetRejected&&near(plateauBase.restOffset,plateauBase.driveGap-plateauBase.carrierGap)&&plateauBase.rawForce>60&&near(plateau.h.jawForce,3)&&plateau.h.carrierGap<.001,'unloading a saturated actuator rejects a clipped-preload ratchet and returns to its actual unloaded drive');
  function reject(result){const f=fixture();let rejected=false;try{f.step(0,(W,a)=>W.applyJawActuator(1,a,result));}catch(e){rejected=true;}return rejected;}
  check(reject({carrierGap:.002,padCompression:zero(),load:0})&&reject({carrierGap:0,padCompression:zero(),load:1})&&reject({carrierGap:G.gapMax,padCompression:zero(),load:-1}),'interior imbalance and both wrong-direction mechanical-stop reactions are rejected');
  check(reject({carrierGap:.02,padCompression:zero(),load:61})&&reject({carrierGap:G.gapMax+.001,padCompression:zero(),load:60})&&reject({carrierGap:.001,padCompression:{'1':[0,-2*G.pad.h[1],0],'-1':[0,0,0]},load:ka*.001}),'over-force without a stop, out-of-stroke carriers and collapsed rubber are rejected rather than clipped');
  const stop=fixture();stop.step(0,(W,a)=>W.applyJawActuator(1,a,{carrierGap:G.gapMax,padCompression:zero(),load:70}));
  check(stop.h.jawForce===60&&stop.h.jawLoad===70&&stop.h.jawStopForce===10,'a true fully open mechanical stop carries excess external load without relabelling it as actuator force');
  stop.W.resetRobot(stop.robot(.4));
  check(near(stop.h.driveGap,.4*G.gapMax)&&near(stop.h.carrierGap,stop.h.gap)&&stop.h.F===0&&stop.h.fabricForce===0&&Object.values(stop.h.padCompression).flat().every(v=>v===0)&&stop.W.jawActuator(1)===null,'reset seeds a fresh unloaded carrier and removes every old actuator, pressure and deformation state');
};
if(require.main===module){const assert=require('node:assert/strict');module.exports({check:(ok,msg)=>{assert.ok(ok,msg);process.stdout.write('ok '+msg+'\n');}});}
