// Exact deformed rubber boxes; legacy vessel samples are generated only on demand.
module.exports=function({check}){
  const P=require('../../tag-tracker/physics-core'),R=require('../../tag-tracker/robot-core'),C=require('../../tag-tracker/tracker-core'),I=[1,0,0,0,1,0,0,0,1],G=R.gripper(),near=(a,b,t=1e-9)=>Math.abs(a-b)<t;
  const box=(t,h,R=I)=>({R,t,h}),B=box([0,0,0],[.011,.0005666666667,.019]);
  const hit=P.boxBox(B,box([0,.001,0],B.h));
  check(near(hit.dist,-.0001333333334)&&hit.points.length===4&&hit.n[1]===-1&&hit.points.every(q=>q.p.every((v,k)=>Math.abs(v)<=B.h[k]+1e-10)),'two60N-thin pad boxes retain their full exact face polygon and penetration without inflated spheres');
  const rotated=box([.012,0,0],[.004,.005,.006],R.Rz(.4)),forward=P.boxBox(B,rotated),reverse=P.boxBox(rotated,B);
  check(near(forward.dist,reverse.dist)&&C.norm(C.add(forward.n,reverse.n))<1e-8&&forward.points.every(q=>[...q.p,q.dist].every(Number.isFinite)),'oriented box overlap is symmetric and produces finite physical witness points');
  const capsule=P.boxCapsule(B,[-.03,.0015,.005],[.03,.0015,.005],.001),miss=P.boxCapsule(B,[-.03,.003,.005],[.03,.003,.005],.001);
  check(near(capsule.dist,-.0000666666667)&&miss.dist>0&&capsule.u>=0&&capsule.u<=1&&capsule.p.every((v,k)=>Math.abs(v)<=B.h[k]+1e-10),'a capsule sees the actual thin side face at its exact closest segment feature');
  const diagonal=P.boxCapsule(B,[-.03,-.03,0],[.03,.03,0],.001);
  check(near(diagonal.dist,-((B.h[0]+B.h[1])/Math.SQRT2+.001))&&diagonal.p.every((v,k)=>Math.abs(v)<=B.h[k]+1e-10),'a crossing diagonal capsule uses its edge-separating direction rather than an exaggerated whole-face penetration');
  const K=P.JAW.padStiffness,compression={'1':[0,-60/K,0],'-1':[0,60/K,0]},carrier=60/P.JAW.carrierStiffness,rubber=P.padSpheres(G,.03,carrier,compression);
  check(rubber.length===2340&&rubber.every(s=>{const p=G.padShape(s.jaw,carrier,compression[s.jaw]),q=C.sub(C.add(s.p,P.HAND.com),p.c);return q.every((v,k)=>Math.abs(v)+s.r<=p.h[k]+1e-10);}), 'the optional60N legacy vessel grid keeps every original inscribed rubber feature without expansion or truncation');
  const deform={gap:.03,carrierGap:.026,padCompression:{'1':[0,-.002,0],'-1':[0,.002,0]},body:{R:I,t:[0,0,0]},_jawStart:{carrierGap:.026,padCompression:{'1':[0,0,0],'-1':[0,0,0]}}},deformed=P.padBoxes(G,deform).find(p=>p.jaw===1),front=C.add(deformed.t,[0,-deformed.h[1],0]),back=C.add(deformed.t,[0,deformed.h[1],0]);
  check(C.norm(C.sub(P.padMaterialMotion(G,deform,deformed,front).motion,[0,.002/P.H,0]))<1e-9&&C.norm(P.padMaterialMotion(G,deform,deformed,back).motion)<1e-9,'deforming-surface velocity follows the same material point: the compressed face moves while its backing stays attached');
  const robot={hands:[{side:1,pose:{R:I,t:[-.04,0,.5]},opening:0},{side:-1,pose:{R:I,t:[.04,0,.5]},opening:0}]},W=P.world({gripper:G,floor:-10});W.resetRobot(robot);
  W.cloths.push({step:()=>{for(const side of [1,-1])W.applyJawActuator(side,W.jawActuator(side),{carrierGap:carrier,padCompression:compression,load:60,pressure:{'1':60,'-1':60}});}});
  W.setRobot(robot);W.step(P.H);W.setRobot(robot);W.step(P.H);
  check(Object.values(W.hands).every(h=>h.body.sp.length===66&&P.padBoxes(G,h).length===2&&h.body.padBoxes.length===2&&P.padBoxes(G,h).every(b=>b.h.every(v=>v>0)))&&W.padContactStats.legacyRubber===0&&W.padContactStats.handSpherePairs===4356&&W.padContactStats.padSpherePairs===264&&W.padContactStats.padBoxPairs===4,'two maximally compressed empty-world hands use four exact pad boxes and4624 bounded pair tests rather than5.79million sphere pairs');
  const ball=W.add('ball',[0,0,.4]);W.setRobot(robot);W.step(P.H);
  check(W.padContactStats.legacyRubber===4680&&W.padContactStats.handSpherePairs===4356&&W.padContactStats.padBoxPairs===4&&ball.sp.length===1,'nearby rigid props retain the legacy rubber/SDF path without adding those samples to hand-hand pair loops');
  const table={R:I,t:[0,0,0],size:[.5,.9],thick:.03},T=P.world({gripper:G,table}),target={hands:[{side:1,pose:{R:I,t:[0,0,.119]},opening:.5}]};T.resetRobot(target);let tableRubber=false;
  for(let i=0;i<25;i++){T.setRobot(target);T.step(P.H);tableRubber||=T.contactState.touches.some(t=>(t.a.mat==='rubber'||t.b.mat==='rubber')&&(t.a.kind==='table'||t.b.kind==='table'));}
  check(tableRubber&&T.padContactStats.legacyRubber===0&&T.padContactStats.padContacts>0&&T.contactState.hands[1].force.every(Number.isFinite),'a real loaded pad/table contact records rubber force through the exact box path without any rigid-prop grid');
  const A=P.world({gripper:G,floor:-10}),jaw=.5*G.gapMax/2+G.pad.c[1],arm={hands:[{side:1,pose:{R:I,t:[0,0,.5]},opening:.5}],links:[{id:'-1fore',a:[.0106,jaw-.005,.39],b:[.0106,jaw+.005,.39],r:.001}]};A.resetRobot(arm);let armRubber=false;
  for(let i=0;i<25;i++){A.setRobot(arm);A.step(P.H);armRubber||=A.contactState.touches.some(t=>(t.a.mat==='rubber'||t.b.mat==='rubber')&&(t.a.kind==='arm'||t.b.kind==='arm'));}
  check(armRubber&&A.padContactStats.legacyRubber===0&&A.padContactStats.padContacts>0,'a narrow other-arm capsule contacts the actual rubber side outside the metal holder without sampling gaps');
  const closing=P.world({gripper:G,floor:-10}),closeRobot=opening=>({hands:[{side:1,pose:{R:I,t:[0,0,.5]},opening}],links:[{id:'-1fore',a:[-.005,.020,.39],b:[.005,.020,.39],r:.0015}]});closing.resetRobot(closeRobot(.5));closing.setRobot(closeRobot(0));closing.step(P.H);const impact=closing.record.events.find(e=>e.a.mat==='rubber'&&e.b.kind==='arm');
  check(impact?.a.part==='pad'&&near(impact.speed,P.JAW_SPEED/2)&&impact.force>0&&closing.padContactStats.legacyRubber===0,'a closing exact pad reports its actual half-gap surface speed and rubber impact wrench with a stationary wrist');
  const pair=P.world({gripper:G,floor:-10}),opposed={hands:[{side:1,pose:{R:I,t:[0,0,.5]},opening:.5},{side:-1,pose:{R:R.Rx(Math.PI),t:[0,0,.2595]},opening:.5}]};pair.resetRobot(opposed);let padPair=false;
  for(let i=0;i<20;i++){pair.setRobot(opposed);pair.step(P.H);padPair||=pair.contactState.touches.some(t=>t.a.kind==='hand'&&t.b.kind==='hand'&&t.a.mat==='rubber'&&t.b.mat==='rubber');}
  check(padPair&&pair.padContactStats.legacyRubber===0&&Object.values(pair.contactState.hands).every(h=>h.force.every(Number.isFinite)),'opposed real hands exchange a finite rubber-pad contact wrench through the exact box manifold without a legacy grid');
};
if(require.main===module){const assert=require('node:assert/strict');module.exports({check:(ok,msg)=>{assert.ok(ok,msg);process.stdout.write('ok '+msg+'\n');}});}
