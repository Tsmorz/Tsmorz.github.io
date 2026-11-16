// Read-only ready garment/render fixture; no folding or node shaping.
(async()=>{
  taskLevel('laundry');setRobotView('orbit');await new Promise(r=>setTimeout(r,500));
  const W=TB.world,T=W.table,c=W.cloths[0];Object.assign(S.view,{yaw:-.65,pitch:1.15,dist:.7,target:C.add(T.t,C.mulv(T.R,[-.04,0,.015]))});draw3d();
  if(c.panels!==2||c.nodes.some(n=>[...n.p,...n.v].some(v=>!Number.isFinite(v))))throw new Error('ready garment is not finite');
  return {passed:true,nodes:c.nodes.length,panels:c.panels,mass:c.mass,area:c.area,neckRadius:c.neckRadius,backNeckDepth:c.neckBackDepth,taskComplete:TB.game.complete};
})()
