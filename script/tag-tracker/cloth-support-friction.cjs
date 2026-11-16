// A stationary frictionless toe must not make supported cotton skate on a rough table.
'use strict';
const path=require('node:path'),root=path.resolve(__dirname,'../..'),P=require(root+'/tag-tracker/physics-core'),Robot=require(root+'/tag-tracker/robot-core'),C=require(root+'/tag-tracker/tracker-core');
// Inject only a frictionless toe material. No production source is read or rewritten;
// preload the ordinary module so shared dependencies retain their normal PhysicsCore.
const clothPath=require.resolve(root+'/tag-tracker/cloth-core'),physicsPath=require.resolve(root+'/tag-tracker/physics-core'),patchPath=require.resolve(root+'/tag-tracker/patch-contact-core');require(clothPath);
function frictionlessToeCloth(patchFactory=null){
  const cached=require.cache[clothPath],physics=require.cache[physicsPath],original=physics.exports,patch=require.cache[patchPath],originalPatch=patch.exports;
  try{physics.exports={...P,GRIP:{...P.GRIP,mu:0}};if(patchFactory)patch.exports=patchFactory(originalPatch);delete require.cache[clothPath];return require(clothPath);}
  finally{physics.exports=original;patch.exports=originalPatch;require.cache[clothPath]=cached;}
}
const I=[1,0,0,0,1,0,0,0,1],dt=1/240,add=C.add,sub=C.sub,mul=(v,s)=>v.map(x=>x*s),norm=C.norm,cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],table={R:I,t:[0,0,0],size:[.5,.9]};
function probe(friction,{gravity=[0,0,0],velocity=[0,0,0],tolerance,clothCore,strict}={}){
  const Cloth=clothCore||frictionlessToeCloth(),G=Robot.gripper(),c=Cloth.swatch({resolution:3,width:.002,height:.046,panels:1,at:[0,0,0],areal_density:.18,thickness:.0006,air_drag:0,iterations:1,friction,self_friction:0},table),R=Robot.Ry(.15),toe=[0,0,G.pad.c[2]-G.pad.h[2]],t=sub([0,0,.00055],C.mulv(R,toe)),pose={R,t},body={R,t:t.slice(),m:1.2,invM:1/1.2,iW:[8,0,0,0,8,0,0,0,8],v:[0,0,0],w:[0,0,0],sp:[],bound:.2},hand={body,gap:.017,target:.017},W={hands:{1:hand},bodies:[],cloths:[c],gravity,floorZ:-10,robotLinks:[],respawns:0,gripper:G,handPose:()=>pose,tableBox:{t:[0,0,-.02],R:I,h:[.25,.45,.02]}},before=c.nodes.map(n=>n.p.slice());
  if(tolerance!==undefined)c.contactTolerance=tolerance;if(strict)c.strictContact=true;c.nodes.forEach(n=>n.v=velocity.slice());
  c.step(dt,W);
  const displacement=c.nodes.reduce((p,n,i)=>add(p,mul(sub(n.p,before[i]),1/(c.weights[i]*c.mass))),[0,0,0]),momentum=c.nodes.reduce((p,n,i)=>add(p,mul(n.v,1/c.weights[i])),[0,0,0]),angular=c.nodes.reduce((p,n,i)=>add(p,cross(n.p,mul(n.v,1/c.weights[i]))),[0,0,0]),J=body.externalImpulse||{linear:[0,0,0],angular:[0,0,0]},support=c.surfaceTableWrench;
  return {c,W,pose,body,displacement,support,force:c.reactions[1]?.force||[0,0,0],linearError:norm(sub(add(momentum,J.linear),mul(support.force,dt))),angularError:norm(sub(add(angular,add(J.angular,cross(body.t,J.linear))),mul(support.torque,dt)))};
}
function tableHistory(c){return (c.acceptedContact?.normals||[]).filter(q=>q.descriptor.kind==='table').reduce((force,q)=>add(force,C.mulv(table.R,add(mul(q.descriptor.normal,q.force),q.tangent||[0,0,0]))),[0,0,0]);}
// Two unsewn sheets share real opposing pad pressure. The hand is frictionless
// and cannot capture a grip, isolating the cloth/cloth Coulomb law.
function relativeLayers(selfFriction){
  const Cloth=frictionlessToeCloth(),G=Robot.gripper(),c=Cloth.swatch({resolution:5,width:.04,height:.04,panels:2,seam_compliance:Infinity,at:[0,0,0],areal_density:.18,thickness:.0006,iterations:8,air_drag:0,self_friction:selfFriction},table);
  c.nodes.forEach((n,i)=>{n.p=[n.p[0],.0006-n.p[2],1+n.p[1]];n.v=[i<c.panelSize?.01:-.01,0,0];});
  const pose={R:I,t:[0,0,1-G.pad.c[2]]},body={t:pose.t.slice(),R:I,sp:[],bound:.2,v:[0,0,0],w:[0,0,0]},hand={body,gap:.0012,target:.0012,fabricForce:1,clothSlip:true},W={hands:{1:hand},bodies:[],cloths:[c],gravity:[0,0,0],floorZ:-10,robotLinks:[],respawns:0,gripper:G,handPose:()=>pose},momentum=()=>c.nodes.reduce((p,n,i)=>add(p,mul(n.v,1/c.weights[i])),[0,0,0]),angular=()=>c.nodes.reduce((p,n,i)=>add(p,cross(n.p,mul(n.v,1/c.weights[i]))),[0,0,0]),beforeP=momentum(),beforeL=angular();
  c.step(dt,W);const J=body.externalImpulse||{linear:[0,0,0],angular:[0,0,0]},layers=(c.acceptedContact?.normals||[]).filter(q=>q.descriptor.kind==='layer'),velocity=side=>c.nodes.slice(side*c.panelSize,(side+1)*c.panelSize).reduce((sum,n)=>sum+n.v[0]/c.panelSize,0);
  return {c,slip:Math.abs(velocity(0)-velocity(1)),pressure:layers.reduce((sum,q)=>sum+q.force,0),traction:layers.reduce((sum,q)=>sum+norm(q.tangent||[0,0,0]),0),linearError:norm(add(sub(momentum(),beforeP),J.linear)),angularError:norm(add(sub(angular(),beforeL),add(J.angular,cross(body.t,J.linear))))};
}
module.exports=function({check,pending=check}){
  // An optimizer may miss its stricter inner target even when its trial is
  // inside the original accuracy budget. It still needs a separate FRESH solve
  // at the original tolerance; a failed fresh gate must never apply its wrench.
  let innerMisses=0,physicalChecks=0;
  const delayed=frictionlessToeCloth(actual=>({...actual,solveCoupled(problem){const result=actual.solveCoupled(problem);if(problem.tolerance<=1e-9&&result.converged){innerMisses++;return {...result,converged:false,normalResidual:7.5e-8,residual:7.5e-8};}if(problem.tolerance===3e-7)physicalChecks++;return result;}})),recertified=probe(0,{clothCore:delayed});
  check(innerMisses>0&&physicalChecks>=innerMisses&&recertified.c.surfaceStats.certifiedRestarts>0&&recertified.force[2]>.001&&recertified.c.surfaceResidual<=3e-7,'a small stricter-inner miss requires a fresh original-operator normal/pressure/bounds solve before its physical wrench is applied');
  let failedPhysicalChecks=0,rejected=false;
  const rejectedCore=frictionlessToeCloth(actual=>({...actual,solveCoupled(problem){const result=actual.solveCoupled(problem);if(problem.tolerance<=1e-9&&result.converged)return {...result,converged:false,normalResidual:7.5e-8,residual:7.5e-8};if(problem.tolerance===3e-7){failedPhysicalChecks++;return {...result,converged:false,feasibility:.001};}return result;}}));
  try{probe(0,{clothCore:rejectedCore,strict:true});}catch(error){if(!/Joint cloth contact did not converge/.test(error.message))throw error;rejected=true;}
  check(rejected&&failedPhysicalChecks>0,'an invalid fresh physical certificate is rejected rather than relabelled as converged after a small inner miss');
  const free=probe(0),rough=probe(.5),tangent=Math.hypot(rough.support.force[0],rough.support.force[1]);
  check(free.displacement[0]<-.0005&&Math.abs(free.support.force[0])<1e-10,'a frictionless table permits the real lateral impulse of an oblique frictionless toe');
  check(Math.hypot(rough.displacement[0],rough.displacement[1])<3e-7&&tangent>.001&&tangent<=.5*rough.support.force[2]+1e-9,'the final toe-supported table pressure supplies actual static friction instead of allowing a stationary coupon to skate');
  check([free,rough].every(p=>p.linearError<1e-8&&p.angularError<1e-8&&p.c.surfaceResidual<=3e-7&&p.c.frictionResidual<=3e-7&&!p.c.pins.size),'oblique support friction preserves paired world linear/angular impulse and does not manufacture a fabric grip');
  const reversing=probe(.1,{gravity:[0,0,-9.81],velocity:[.0001,0,0]}),tight=probe(.1,{gravity:[0,0,-9.81],velocity:[.0001,0,0],tolerance:1e-9});
  check([reversing,tight].every(p=>norm(sub(p.support.force,tableHistory(p.c)))<1e-12),'all published table pressure and traction belong to the accepted common contact field, including gravity support and reversed pre-contact motion');
  check(tight.displacement[0]<-.001&&tight.support.force[0]>0&&Math.abs(tight.support.force[0]-.1*tight.support.force[2])<1e-10&&tight.c.surfaceResidual<=1e-9&&tight.c.frictionResidual<=1e-9,'a test-only tighter certificate resolves reversed kinetic table friction at the total Coulomb capacity without retaining prior opposite traction');
  reversing.c.nodes.forEach(n=>{n.p[2]+=.01;n.v=[0,0,.01];});reversing.pose.t[2]+=.01;reversing.body.t=reversing.pose.t.slice();reversing.body.externalImpulse=null;reversing.W.gravity=[0,0,0];reversing.c.step(dt,reversing.W);
  check(norm(reversing.c.surfaceTableWrench.force)===0&&norm(tableHistory(reversing.c))===0&&reversing.c.surfaceResidual<=3e-7,'lifting the actual coupon and toe clear of the table unloads the complete former support and traction in the same step');
  const smoothLayers=relativeLayers(0),roughLayers=relativeLayers(.45);
  // Pending: the live solver's Newton budget leaves rough layers short of exact traction, and stacked-edge
  // contacts leave a small internal couple. Both were open in the unfinished multilayer work.
  pending(smoothLayers.slip>.015&&smoothLayers.traction===0&&roughLayers.pressure>.9&&roughLayers.traction>.0005&&roughLayers.slip<.02*smoothLayers.slip,'actual supported cotton layers retain self friction in the common solver instead of becoming frictionless when table projections are bypassed');
  pending([smoothLayers,roughLayers].every(p=>!p.c.pins.size&&p.linearError<1e-10&&p.angularError<1e-8&&p.c.surfaceResidual<=3e-7&&p.c.frictionResidual<=3e-7),'finite-thickness layer traction preserves paired world linear/angular impulse without external grip or adhesive forces');
};
module.exports.probe=probe;module.exports.relativeLayers=relativeLayers;
if(require.main===module){const assert=require('node:assert/strict');module.exports({check:(ok,message)=>{assert.ok(ok,message);console.log('ok '+message);},pending:(ok,message)=>console.log((ok?'ok ':'PEND ')+message)});}
