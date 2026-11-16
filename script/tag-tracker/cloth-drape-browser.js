// Isolated physical cuff-lift/load specimen. No folding sequence or task success manipulation.
// task shot -- /tag-tracker/ --eval-file script/tag-tracker/cloth-drape-browser.js
(async()=>{
  const wait=ms=>new Promise(r=>setTimeout(r,ms)),assert=(ok,msg)=>{if(!ok)throw new Error(msg);};
  taskLevel('laundry');await wait(300);setRobotView('orbit');
  const W=TB.world,c=W.cloths[0],savedStep=W.step;W.step=()=>{};c.reset();
  const T=W.table,G=RCORE.gripper(RB.scene.m),R=C.mul3(T.R,C.rodrigues([Math.PI/2,0,0])),up=C.mulv(T.R,[0,0,1]),point=C.sub(c.nodes[c.landmarks.cuffs[0]].p,up.map(v=>v*c.halfThickness)),pose={R,t:C.sub(point,C.mulv(R,[G.pad.c[0],0,G.pad.c[2]]))},body={t:pose.t.slice(),R,sp:[],bound:.2,v:[0,0,0],w:[0,0,0]},hand={body,gap:4*c.halfThickness,target:0},probe={cloths:[c],gripper:G,hands:{1:hand},handPose:()=>pose,bodies:[],robotLinks:[],gravity:[0,0,-9.81],floorZ:W.floorZ,tableBox:W.tableBox};
  c.step(1/240,probe);hand.fabricForce=2;
  assert(c.pins.get('1')?.layers===2,'the isolated pad physically captures both garment panels');
  const start=performance.now();for(let i=0;i<200;i++){pose.t=C.add(pose.t,up.map(v=>v*.0005));body.t=pose.t.slice();body.v=up.map(v=>v*.12);c.step(1/240,probe);}
  const physicsMsPerFrame=(performance.now()-start)/50,load=c.reactions[1]?.load,finite=c.nodes.every(n=>[...n.p,...n.v].every(Number.isFinite));
  assert(finite&&c.pins.size===1&&c.nodes.some(n=>C.mulv(C.tr3(T.R),C.sub(n.p,T.t))[2]>.09),'a100mmcufflift produces a finite physical drape');
  Object.assign(S.view,{yaw:-.65,pitch:.65,dist:.7,target:C.add(T.t,C.mulv(T.R,[-.04,0,.03]))});draw3d();
  window.finishClothDrapeProbe=()=>{hand.target=.085;hand.gap=.085;hand.fabricForce=0;body.v=[0,0,0];c.step(1/240,probe);assert(!c.pins.size&&hand.fabricGap===undefined&&!hand.fabricForce,'release clears the finite patch and its squeeze force');W.step=savedStep;resetTable();return {released:true};};
  return {passed:true,physicsMsPerFrame,nodes:c.nodes.length,panels:c.panels,loadN:load,finite,taskComplete:TB.game.complete};
})()
