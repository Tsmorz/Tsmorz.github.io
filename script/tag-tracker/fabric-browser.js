// Fold the small towel with actual robot IK and both physical grippers.
(async()=>{
  const wait=ms=>new Promise(r=>setTimeout(r,ms)),assert=(ok,msg)=>{if(!ok)throw new Error(msg);};
  document.querySelectorAll('dialog[open]').forEach(d=>d.close());setCampaignMode('guided');taskLevel('laundry');await wait(500);
  const W=TB.world,g=TB.game,c=W.cloths[0],T=W.table,vec=p=>C.mulv(T.R,p),at=p=>C.add(T.t,vec(p)),drives=[1,-1].map(side=>({side,d:driveOf(RB.scene.arms.find(a=>a.side===side))}));
  const spec=g.level.cloths[0],x=spec.at[0]-spec.width/2;
  for(const {d} of drives){d.open=1;d.t=C.add(d.t,vec([0,0,.24]));}await wait(1300);
  for(const {d} of drives)d.R=T.R.slice();await wait(900);
  for(const {side,d} of drives)d.t=at([x,spec.at[1]+side*spec.height/2,.21]);await wait(1400);
  for(const {side,d} of drives)d.t=at([x,spec.at[1]+side*spec.height/2,.11]);await wait(1400);
  for(const {d} of drives)d.open=0;await wait(800);
  assert(c.pins.size===2,'both real robot grippers must capture their own corner: '+JSON.stringify({pins:[...c.pins],hands:[1,-1].map(s=>W.handPose(s))}));
  assert(TASK.guide.state==='fold_move','a flat pinned towel needs to be moved, not released');
  for(let i=0;i<=150;i++){
    const t=i/150;for(const {side,d} of drives)d.t=at([x+.19*t,spec.at[1]+side*spec.height/2,.11+.08*Math.sin(Math.PI*t)]);await wait(30);
  }
  for(const {d} of drives)d.open=1;
  const t=performance.now();while(!g.complete&&performance.now()-t<6000)await wait(60);
  assert(g.complete&&c.pins.size===0&&c.touched.size===2&&W.capped===0,'a towel folded through both robot arms must stay folded and settle on its pad: '+JSON.stringify({fold:ClothCore.folded(c),steps:g.steps,pins:c.pins.size,capped:W.capped,guide:TASK.guide}));
  return {passed:true,twoRobotGrippers:true,deformableFabric:true,foldedAndReleased:true,viewport:[innerWidth,innerHeight]};
})()
