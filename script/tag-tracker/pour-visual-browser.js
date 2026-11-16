// Visual fixture for the stream/foam; pour-browser.js separately verifies the whole pour through real IK.
(async()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms)),assert=(ok,msg)=>{if(!ok)throw Error(msg);};
  document.querySelectorAll('dialog[open]').forEach(d=>d.close());
  setMode('tasks');setCampaignMode('guided');taskLevel('pour');await sleep(500);
  const W=TB.world,p=TB.game.pour,A=p.from.body,B=p.to.body,T=W.table;
  A.fixed=true;A.R=C.mul3(T.R,RCORE.Rx(-110*Math.PI/180));A.q=PHYS.qOf(A.R);
  const n=C.mulv(C.tr3(A.R),[0,0,1]),lip=PourCore.spout(n,p.from.shape).p;
  const speed=Math.min(.6,p.from.flow/(Math.PI*p.from.r*p.from.r)),velocity=C.mulv(C.tr3(T.R),C.mulv(A.R,[0,0,speed]));
  const height=.055,flight=(velocity[2]+Math.sqrt(velocity[2]**2+2*9.81*height))/9.81;
  const target=C.add(W.poseOf(B).t,C.mulv(T.R,[-velocity[0]*flight,-velocity[1]*flight,TaskCore.STEIN.H+height]));
  A.t=C.sub(C.sub(target,C.mulv(A.R,C.add(lip,[0,0,p.from.floor]))),C.mulv(A.R,A.off));A.v=[0,0,0];A.w=[0,0,0];
  await sleep(2000);
  $('taskLabels').style.display='none';
  Object.assign(S.view,{target:C.add(W.poseOf(B).t,C.mulv(T.R,[0,0,.075])),dist:.72,pitch:1.05,fitted:true,fromCam:false});
  const view=p.view(),spec=tableDraw(),mug=view.surfaces.find(x=>x.key==='mug');
  assert(view.streams.length>0&&view.radii.every(r=>r.every(x=>x>0&&x<=.006)),'a continuous stream has finite flow-derived widths');
  assert(mug?.foam>.1&&mug.agitation>.1&&spec.liquids.some(x=>x.layer==='foam'),'pouring makes foam and ripples over the collected beer');
  const total=p.from.V+p.to.V+p.spilled+p.drops.reduce((s,d)=>s+d.vol,0);
  assert(Math.abs(total-p.V0)<1e-10,'visual detail preserves the beer accounting');
  assert(document.documentElement.scrollWidth<=innerWidth+1,'the pour fits the viewport');
  return {passed:true,stream:true,foam:true,conservation:true,viewport:[innerWidth,innerHeight]};
})()
