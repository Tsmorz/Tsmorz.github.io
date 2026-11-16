// Physical/render contracts only; no scripted garment folding.
module.exports=function({check}){
  const root=require('path').resolve(__dirname,'../..'),R=require(root+'/tag-tracker/robot-core'),P=require(root+'/tag-tracker/physics-core'),V=require(root+'/tag-tracker/robot-gl'),C=require(root+'/tag-tracker/tracker-core');
  const I=[1,0,0,0,1,0,0,0,1],near=(a,b)=>Math.abs(a-b)<1e-8,point=s=>C.add(s.p,P.HAND.com);
  const segmentDistance=(p,s)=>{const d=C.sub(s.b,s.a),v=C.sub(p,s.a),f=Math.max(0,Math.min(1,v.reduce((a,x,i)=>a+x*d[i],0)/d.reduce((a,x)=>a+x*x,0)));return C.norm(C.sub(p,C.add(s.a,d.map(x=>x*f))));};
  for(const hand of [.09,.3]){
    const m=R.model({hand}),G=R.gripper(m);let count;
    for(const opening of [0,.25,.5,.75,1]){
      const gap=opening*G.gapMax,W=P.world({gripper:G}),robot={hands:[{side:1,pose:{R:I,t:[0,0,.5]},opening}]};W.resetRobot(robot);
      const b=W.hands[1].body,sp=b.sp,layout=V.gripperLayout(m,gap),jaws=G.linkage(gap),segments=jaws.flatMap(j=>j.segments),joints=jaws.flatMap(j=>j.joints),palm=sp.filter(s=>s.palm),links=sp.filter(s=>s.link),pads=P.padBoxes(G,W.hands[1]);
      check(near(G.gapMax,.085)&&near(G.body.r*2,.075)&&palm.every(s=>{const p=C.sub(point(s),G.body.c);return Math.hypot(p[0],p[1])+s.r<=G.body.r+1e-9&&Math.abs(p[2])+s.r<=G.body.h[2]+1e-9;}),`Robotiq hand ${hand}, opening ${opening}: housing collision fits the75mm cylinder and85mm stroke`);
      check([-1,1].every(side=>Math.min(...sp.map(s=>C.norm(C.sub([0,side*.055,G.body.c[2]],point(s)))-s.r))>.004),`Robotiq hand ${hand}, opening ${opening}: removed128mm-wide palm leaves no invisible collision`);
      const within=(s,box,side)=>{const p=C.sub(point(s),[box.c[0],side*(gap/2+box.c[1]),box.c[2]]);return p.every((v,i)=>Math.abs(v)+s.r<=box.h[i]+1e-9);},holders=sp.filter(s=>s.finger);
      check(near(2*G.pad.h[0],.022)&&near(2*G.pad.h[1],.0078)&&near(2*G.pad.h[2],.038)&&near(2*G.finger.h[0],.0162)&&pads.length===2&&pads.every(s=>near(s.shape.c[1]-s.jaw*s.h[1],s.jaw*gap/2)&&s.mat==='rubber'&&s.h.every((v,k)=>near(v,G.pad.h[k])))&&holders.length>0&&holders.every(s=>s.mat==='aluminium'&&!s.jaw&&within(s,G.finger,s.finger))&&layout.fingers.every(j=>near(j.pad.c[2],G.pad.c[2])&&near(j.backbone.c[2],G.finger.c[2])),`Robotiq hand ${hand}, opening ${opening}: true22×38mm overmold surrounds its16.2mm metal holder with no ghost rubber contact`);
      check(G.pad.c[2]-G.pad.h[2]<G.finger.c[2]-G.finger.h[2]-.0007&&G.pad.h[0]>G.finger.h[0]&&near(G.pad.c[1]-G.pad.h[1],0),`Robotiq hand ${hand}, opening ${opening}: rubber wraps the holder tip and sides while preserving the actual gap`);
      check(links.length>0&&links.every(s=>s.mat==='aluminium'&&!s.jaw&&(joints.some(j=>near(C.norm(C.sub(point(s),j.p)),0)&&near(s.r,j.r))||segments.some(j=>segmentDistance(point(s),j)<1e-8&&near(s.r,j.r))))&&segments.every(s=>Array.from({length:25},(_,i)=>C.add(s.a,C.sub(s.b,s.a).map(x=>x*i/24))).every(p=>links.some(v=>C.norm(C.sub(p,point(v)))<=v.r+1e-9))),`Robotiq hand ${hand}, opening ${opening}: metal collision chains cover the visible linkage without ghost shapes`);
      count??=sp.length;check(sp.length===count&&sp.every(s=>C.norm(s.p)+s.r<=b.bound+1e-9),`Robotiq hand ${hand}, opening ${opening}: stable contact feature count stays inside the hand broadphase bound`);
    }
  }
  const G=R.gripper(R.model()),W=P.world({gripper:G}),hand=opening=>({hands:[{side:1,pose:{R:I,t:[0,0,.5]},opening}]});W.resetRobot(hand(1));W.setRobot(hand(0));W.step(P.H);
  check(C.norm(W.hands[1].body.v)<1e-9&&W.hands[1].body.sp.filter(s=>s.link).some(s=>s.motion&&C.norm(s.motion)>.01)&&W.hands[1].body.sp.every(s=>!s.motion||s.motion.every(Number.isFinite)),'closing the Robotiq has finite moving-link contact velocities even with a stationary wrist');
  const metal=P.world({gripper:G}),peg=metal.add({kind:'fixture',mass:1,fixed:true,pieces:[{type:'box',p:[0,0,0],h:[.001,.001,.001]}]},[0,.041,.427]);metal.resetRobot(hand(1));let strike;
  for(let i=0;i<3;i++){metal.setRobot(hand(0));metal.step(P.H);strike??=metal.record.events.find(e=>e.a.kind==='hand'&&e.b.id===peg.id);}
  check(strike?.a.mat==='aluminium'&&strike.a.part==='metal'&&near(strike.speed,.125)&&strike.force>0&&metal.hands[1].pads.every(p=>p.every(q=>q.other!==peg)),'a closing metal carrier hits a proximal fixture at half the actual jaw rate without inventing rubber contact or wrist travel');
};
if(require.main===module){const assert=require('node:assert/strict');module.exports({check:(ok,msg)=>{assert.ok(ok,msg);process.stdout.write('ok '+msg+'\n');}});}
