// Physical/render contracts only; no scripted garment folding.
module.exports=function({check}){
  const root=require('path').resolve(__dirname,'../..'),R=require(root+'/tag-tracker/robot-core'),P=require(root+'/tag-tracker/physics-core'),V=require(root+'/tag-tracker/robot-gl'),C=require(root+'/tag-tracker/tracker-core');
  const I=[1,0,0,0,1,0,0,0,1],near=(a,b)=>Math.abs(a-b)<1e-8,point=s=>C.add(s.p,P.HAND.com);
  const segmentDistance=(p,s)=>{const d=C.sub(s.b,s.a),v=C.sub(p,s.a),f=Math.max(0,Math.min(1,v.reduce((a,x,i)=>a+x*d[i],0)/d.reduce((a,x)=>a+x*x,0)));return C.norm(C.sub(p,C.add(s.a,d.map(x=>x*f))));};
  for(const hand of [.09,.3]){
    const m=R.model({hand}),G=R.gripper(m);let count;
    for(const opening of [0,.25,.5,.75,1]){
      const gap=opening*G.gapMax,W=P.world({gripper:G}),robot={hands:[{side:1,pose:{R:I,t:[0,0,.5]},opening}]};W.resetRobot(robot);
      const b=W.hands[1].body,sp=b.sp,layout=V.gripperLayout(m,gap),jaws=G.linkage(gap),segments=jaws.flatMap(j=>j.segments),joints=jaws.flatMap(j=>j.joints),palm=sp.filter(s=>s.palm),links=sp.filter(s=>s.link),pads=sp.filter(s=>s.jaw);
      check(near(G.gapMax,.085)&&near(G.body.r*2,.075)&&palm.every(s=>{const p=C.sub(point(s),G.body.c);return Math.hypot(p[0],p[1])+s.r<=G.body.r+1e-9&&Math.abs(p[2])+s.r<=G.body.h[2]+1e-9;}),`Robotiq hand ${hand}, opening ${opening}: housing collision fits the75mm cylinder and85mm stroke`);
      check([-1,1].every(side=>Math.min(...sp.map(s=>C.norm(C.sub([0,side*.055,G.body.c[2]],point(s)))-s.r))>.004),`Robotiq hand ${hand}, opening ${opening}: removed128mm-wide palm leaves no invisible collision`);
      check(pads.length===24&&pads.every(s=>near(point(s)[1]+s.flat[1]*s.r,s.jaw*gap/2)&&s.mat==='rubber')&&layout.fingers.every(j=>near(j.pad.c[2],G.pad.c[2])&&near(j.backbone.c[2],G.finger.c[2])),`Robotiq hand ${hand}, opening ${opening}: mirrored pad faces and reach keep the grasp/picking frame`);
      check(links.length>0&&links.every(s=>s.mat==='aluminium'&&!s.jaw&&(joints.some(j=>near(C.norm(C.sub(point(s),j.p)),0)&&near(s.r,j.r))||segments.some(j=>segmentDistance(point(s),j)<1e-8&&near(s.r,j.r))))&&segments.every(s=>Array.from({length:25},(_,i)=>C.add(s.a,C.sub(s.b,s.a).map(x=>x*i/24))).every(p=>links.some(v=>C.norm(C.sub(p,point(v)))<=v.r+1e-9))),`Robotiq hand ${hand}, opening ${opening}: metal collision chains cover the visible linkage without ghost shapes`);
      count??=sp.length;check(sp.length===count&&sp.every(s=>C.norm(s.p)+s.r<=b.bound+1e-9),`Robotiq hand ${hand}, opening ${opening}: stable contact feature count stays inside the hand broadphase bound`);
    }
  }
  const G=R.gripper(R.model()),W=P.world({gripper:G}),hand=opening=>({hands:[{side:1,pose:{R:I,t:[0,0,.5]},opening}]});W.resetRobot(hand(1));W.setRobot(hand(0));W.step(P.H);
  check(C.norm(W.hands[1].body.v)<1e-9&&W.hands[1].body.sp.filter(s=>s.link).some(s=>s.motion&&C.norm(s.motion)>.01)&&W.hands[1].body.sp.every(s=>!s.motion||s.motion.every(Number.isFinite)),'closing the Robotiq has finite moving-link contact velocities even with a stationary wrist');
};
if(require.main===module){const assert=require('node:assert/strict');module.exports({check:(ok,msg)=>{assert.ok(ok,msg);process.stdout.write('ok '+msg+'\n');}});}
