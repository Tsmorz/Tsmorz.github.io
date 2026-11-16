// Frozen physical surface-contact matrices; no garment trajectory or model tuning.
const Patch=require('../../tag-tracker/patch-contact-core'),Newton=require('../../tag-tracker/contact-newton-core'),VI=require('../../tag-tracker/contact-vi-core');
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),norm=v=>Math.hypot(...v);
function evaluator(fixture,{tolerance=1e-9}={}){
  const {H,C,N,base,errors,ordinary,modes}=fixture,n=N.length,k=H.length;
  if(fixture.captured!==0)throw Error('This physical oracle has no captured tangent variables.');
  const metrics=ordinary.map((_,i)=>{const a=H[2*i][2*i],b=H[2*i][2*i+1],d=H[2*i+1][2*i+1];return (a+d+Math.hypot(a-d,2*b))/2;}),scales=metrics.flatMap(v=>[v,v]);
  const apply=(v,out=new Float64Array(n))=>{for(let i=0;i<n;i++)out[i]=dot(N[i],v);return out;},column=(j,out=new Float64Array(n))=>{for(let i=0;i<n;i++)out[i]=N[i][j];return out;};
  function evaluate(x){
    if(x.length!==k||x.some(v=>!Number.isFinite(v)))throw Error('Invalid frozen tangent force.');
    const tangentLoads=modes.map(mode=>dot(mode.tangentJ,x)),bounds=modes.flatMap((mode,index)=>[1,-1].map(sign=>({row:mode.normalJ.map(v=>sign*v),max:mode.maxForce-sign*tangentLoads[index]})));
    // The seed is fixed for every probe. A rejected Newton/finite-difference
    // trial cannot change the pressure allocation of the next evaluation.
    const normal=Patch.normalLCP({size:n,apply,column,diagonal:fixture.diagonal,base:base.map((v,i)=>v+dot(C[i],x)),bounds,tolerance});
    const extra=modes.map((_,i)=>(normal.boundMultipliers?.[2*i]||0)-(normal.boundMultipliers?.[2*i+1]||0)),loads=modes.map((mode,i)=>tangentLoads[i]+dot(mode.normalJ,normal.forces));
    const gradient=H.map((row,j)=>dot(row,x)-errors[j]+C.reduce((s,row,i)=>s+row[j]*normal.forces[i],0)+modes.reduce((s,mode,i)=>s+mode.tangentJ[j]*extra[i],0));
    const caps=ordinary.map(contact=>contact.mu*Math.max(0,normal.forces[contact.normal])),residualVector=[];
    let feasibility=normal.feasibility||0,maxResidual=0,valid=normal.converged;
    ordinary.forEach((_,i)=>{const L=metrics[i],f=x.slice(2*i,2*i+2),g=gradient.slice(2*i,2*i+2),trial=f.map((v,j)=>L*v-g[j]),ratio=Math.min(1,L*caps[i]/(norm(trial)||1)),r=f.map((v,j)=>L*v-ratio*trial[j]);residualVector.push(...r);maxResidual=Math.max(maxResidual,norm(r));feasibility=Math.max(feasibility,norm(f)-caps[i]);});
    modes.forEach((mode,i)=>{const gap=mode.driveGap+mode.compliance*loads[i]+extra[i];valid=valid&&gap>=mode.minGap-1e-12&&gap<=mode.maxGap+1e-12;feasibility=Math.max(feasibility,Math.abs(loads[i])-mode.maxForce);});
    return {residualVector,feasibility:Math.max(0,feasibility),valid,payload:{normal,gradient,caps,metrics,loads,extra,maxResidual}};
  }
  return {evaluate,scales,apply};
}
function joint(fixture,{normalActive,normalSearch,tangentSearchScale}={}){
  const {scales}=evaluator(fixture),n=fixture.N.length;
  return VI.create({H:fixture.H,C:fixture.C,linear:fixture.errors.map(v=>-v),normal:{size:n,base:fixture.base,diagonal:fixture.diagonal,apply:(v,out=new Float64Array(n))=>{for(let i=0;i<n;i++)out[i]=dot(fixture.N[i],v);return out;},column:(j,out=new Float64Array(n))=>{for(let i=0;i<n;i++)out[i]=fixture.N[i][j];return out;}},blocks:fixture.ordinary.map((contact,i)=>({start:2*i,size:2,metric:scales[2*i],capNormals:[[contact.normal,contact.mu]]})),modes:fixture.modes,...normalActive?{normalActive}:{},...normalSearch?{normalSearch}:{},...tangentSearchScale?{tangentSearchScale}:{}});
}
module.exports=function({check}){
  const fixture=require('./contact-vi-fixture.json'),original=JSON.stringify(fixture),{evaluate,scales}=evaluator(fixture),initial=evaluate(fixture.x),close=(a,b,t)=>norm(a.map((v,i)=>v-b[i]))<=t;
  check(initial.valid&&initial.feasibility===0&&close(initial.payload.normal.forces,fixture.expected.normalForces,1e-9)&&close(initial.residualVector,fixture.expected.residualVector,1e-10),
    'frozen actual cloth/Robotiq surface contact reproduces independent normal pressures and the physical Coulomb VI map');
  const probes=fixture.x.map((_,j)=>fixture.x.map((v,i)=>v+(i===j?1e-4:0))),forward=probes.map(evaluate),reverse=probes.slice().reverse().map(evaluate).reverse();
  check(forward.every((value,i)=>close(value.residualVector,reverse[i].residualVector,1e-15)&&close(value.payload.normal.forces,reverse[i].payload.normal.forces,1e-12))&&JSON.stringify(fixture)===original,
    'finite-difference probe order cannot change a frozen normal pressure allocation or mutate the physical matrices');
  const reduced=Newton.solve({x:fixture.x,evaluate,tolerance:3e-7/Math.SQRT2,forceTolerance:1e-9,variableScale:1,residualScale:scales,maxIterations:16,maxEvaluations:512});
  check(!reduced.converged&&reduced.evaluations===512&&reduced.residual>3e-7&&reduced.feasibility>1e-9,
    'a budget-exhausted reduced pressure map cannot report convergence from small normal residuals alone');
  const q=joint(fixture),result=Newton.solve({x:q.initial(fixture.x,initial.payload.normal.forces),evaluate:q.evaluate,jacobian:q.jacobian,tolerance:3e-7/Math.SQRT2,forceTolerance:1e-9,variableScale:1,residualScale:q.scales,maxIterations:16,maxEvaluations:512,includeFeasibilityInMerit:false}),final=q.certificate(result.x);
  check(result.converged&&final.valid&&final.payload.maxResidual<=3e-7&&final.feasibility<=1e-9&&final.payload.normalResidual<=3e-7,
    'joint normal/tangent Newton resolves the actual mixed contact and passes fresh pressure/Coulomb/actuator gates');
  check(result.evaluations<64&&result.jacobianEvaluations<=16&&result.evaluation.payload.normalForces.length===48&&result.evaluation.residualVector.length===66,
    'an analytic joint solve retains every normal row and avoids nested normal solves and finite-difference search probes');
  const probe=q.initial(fixture.x.map((_,i)=>.01*Math.sin(i+1)),initial.payload.normal.forces.map((v,i)=>v+.0003*(i+1))),J=q.jacobian(probe),h=1e-7;let jacobianError=0;
  for(let j=0;j<probe.length;j++){const a=probe.slice(),b=probe.slice();a[j]+=h;b[j]-=h;const plus=q.evaluate(a).residualVector,minus=q.evaluate(b).residualVector;for(let i=0;i<J.length;i++)jacobianError=Math.max(jacobianError,Math.abs(J[i][j]-(plus[i]-minus[i])/(2*h)));}
  check(jacobianError<1e-9,
    'the exact joint physical Jacobian matches independent central differences through normal, tangent and pressure-cap coupling');
  const zeroNormal={size:0,base:[],diagonal:[],apply:(_,out)=>out,column:(_,out)=>out},zero=VI.create({H:[[.2,.03],[.03,.4]],C:[],linear:[0,0],normal:zeroNormal,blocks:[{start:0,size:2,metric:1,capFixed:0}]}),disabled=VI.create({H:[[.2,.03],[.03,.4]],C:[],linear:[0,0],normal:zeroNormal,blocks:[{start:0,size:2,metric:1,capFixed:1,enabled:false}]}),zJ=zero.jacobian([0,0]),dJ=disabled.jacobian([0,0]);
  check(close(zJ.flat(),[1,0,0,1],1e-15)&&close(dJ.flat(),zJ.flat(),1e-15)&&close(zero.evaluate([h,-h]).residualVector,[h,-h],1e-15),
    'a zero-radius or disabled Coulomb ball has exactly metric times identity at zero force and zero displacement');
  const thin=joint(fixture,{normalActive:[]}),th=thin.evaluate(fixture.x);
  check(thin.dimensions.unknowns===18&&thin.dimensions.residuals===66&&th.payload.omittedViolations.length>0&&th.payload.normalResidual>0,
    'omitted normal-force columns retain every complementarity row and explicitly identify contacts requiring activation');
  const toyNormal={size:2,base:[-.4,-.2],diagonal:[1,1.4],apply:(v,out=new Float64Array(2))=>{out[0]=v[0]+.2*v[1];out[1]=.2*v[0]+1.4*v[1];return out;},column:(i,out=new Float64Array(2))=>{out.set(i?[.2,1.4]:[1,.2]);return out;}},toy={H:[[2,.3],[.3,1.2]],C:[[.1,.2],[-.3,.1]],linear:[.2,-.3],normal:toyNormal,blocks:[{start:0,size:2,metric:2.1,capSides:[[[0,1]],[[1,1]]],capScale:.5,capMax:1}]},a=VI.create(toy),force=[.4,-.1],lambda=[.8,.3],at=a.initial(force,lambda),state=a.evaluate(at),aj=a.jacobian(at),angle=.63,Q=[[Math.cos(angle),-Math.sin(angle)],[Math.sin(angle),Math.cos(angle)]],rotate=v=>Q.map(row=>dot(row,v)),rotH=Q.map(row=>Q.map(col=>row.reduce((s,v,i)=>s+v*dot(toy.H[i],col),0))),rotC=toy.C.map(row=>Q.map(axis=>dot(row,axis))),rot=VI.create({...toy,H:rotH,C:rotC,linear:rotate(toy.linear)}),rs=rot.evaluate(rot.initial(rotate(force),lambda));
  check(close(state.residualVector.slice(0,2).map((_,i)=>dot(Q[i],state.residualVector.slice(0,2))),rs.residualVector.slice(0,2),1e-14)&&close(state.residualVector.slice(2),rs.residualVector.slice(2),1e-14)&&Math.abs(state.feasibility-rs.feasibility)<1e-14&&state.payload.caps[0]===.15,
    'opposing pressure capacity and the natural VI covary with a rotated tangent basis without changing normal forces or force feasibility');
  let toyError=0;for(let j=0;j<at.length;j++){const plus=at.slice(),minus=at.slice();plus[j]+=h;minus[j]-=h;const p=a.evaluate(plus),m=a.evaluate(minus);for(let i=0;i<aj.length;i++)toyError=Math.max(toyError,Math.abs(aj[i][j]-(p.residualVector[i]-m.residualVector[i])/(2*h)));}
  check(toyError<1e-8&&a.evaluate(a.initial(force,[-1,.3])).payload.caps[0]===0,
    'the selected opposing-pressure cap derivative is exact and a negative trial pressure cannot grant friction');
  const guarded=VI.create({...toy,modes:[{normalJ:[0,0],tangentJ:[1,0],maxForce:.2,driveGap:0,compliance:1,minGap:0,maxGap:.3}]}),guard=guarded.evaluate(guarded.initial(force,lambda));
  check(!guard.valid&&guard.feasibility>=.2&&VI.create({H:[],C:[[],[]],linear:[],normal:toyNormal,blocks:[]}).evaluate([0,0]).residualVector.length===2,
    'unsupported saturated/stroke branches remain invalid and a normal-only joint problem retains all physical rows');
  let applications=0,columnCalls=0,gain=1;const fast=VI.create({H:[],C:[[]],linear:[],normal:{size:1,base:[-.1],diagonal:[1],apply:(v,out)=>{applications++;out[0]=gain*v[0];},column:(_,out)=>{columnCalls++;out[0]=1;}},blocks:[]}),x=[.1];for(let i=0;i<20;i++)fast.evaluate(x);const physical=fast.certificate(x);gain=2;const changed=fast.certificate(x);
  check(applications===2&&columnCalls===1&&physical.payload.physical&&physical.payload.operatorDifference===0&&physical.payload.maxResidual===0&&fast.evaluate(x).payload.maxResidual===0&&changed.payload.operatorDifference===.1&&changed.payload.maxResidual===.1,
    'search probes multiply frozen selected columns while an explicit fresh physical certificate detects a changed operator');
  const fb=joint(fixture,{normalSearch:'fb'}),fbj=fb.jacobian(probe);let fbError=0;for(let j=0;j<probe.length;j++){const plus=probe.slice(),minus=probe.slice();plus[j]+=h;minus[j]-=h;const p=fb.evaluate(plus),m=fb.evaluate(minus);for(let i=0;i<fbj.length;i++)fbError=Math.max(fbError,Math.abs(fbj[i][j]-(p.residualVector[i]-m.residualVector[i])/(2*h)));}
  check(fbError<1e-9&&close(fb.certificate(probe).payload.gaps,q.certificate(probe).payload.gaps,1e-14)&&fb.certificate(probe).payload.maxResidual===q.certificate(probe).payload.maxResidual,
    'optional Fischer–Burmeister search has an exact analytic Jacobian and leaves the original physical certificate unchanged');
  const one={size:1,base:[0],diagonal:[1],apply:(v,out)=>{out[0]=v[0];},column:(_,out)=>{out[0]=1;}},atOrigin=VI.create({H:[],C:[[]],linear:[],normal:one,blocks:[],normalSearch:'fb'}),nearOrigin=atOrigin.certificate([4e-7]);
  check(atOrigin.jacobian([0])[0][0]===-2&&Math.abs(atOrigin.evaluate([4e-7]).residualVector[0])<3e-7&&nearOrigin.residualVector[0]===4e-7&&nearOrigin.payload.normalResidual===4e-7&&nearOrigin.payload.maxResidual>3e-7,
    'the zero-contact FB derivative is finite and a small search residual cannot bypass the stricter original min-complementarity certificate');
  const slowMetric=VI.create({H:[[.1]],C:[],linear:[-1],normal:zeroNormal,blocks:[{start:0,size:1,metric:1,capFixed:1}],tangentSearchScale:.001}),slowState=slowMetric.evaluate([.9999]),slowPhysical=slowMetric.certificate([.9999]);
  check(Math.abs(slowState.residualVector[0])<3e-7&&slowPhysical.feasibility===0&&Math.abs(slowPhysical.residualVector[0])>3e-7&&slowPhysical.payload.frictionResidual>3e-7&&slowState.payload.maxResidual===slowPhysical.payload.maxResidual&&slowMetric.scales[0]===.001,
    'an auxiliary tiny search metric cannot fake the original canonical Coulomb certificate or alter the physical force disk');
  const scaled=VI.create({...toy,tangentSearchScale:.001}),scaledRot=VI.create({...toy,H:rotH,C:rotC,linear:rotate(toy.linear),tangentSearchScale:.001}),ss=scaled.evaluate(at),sr=scaledRot.evaluate(scaledRot.initial(rotate(force),lambda)),sj=scaled.jacobian(at);let scaledError=0;
  for(let j=0;j<at.length;j++){const p=at.slice(),m=at.slice();p[j]+=h;m[j]-=h;const plus=scaled.evaluate(p),minus=scaled.evaluate(m);for(let i=0;i<sj.length;i++)scaledError=Math.max(scaledError,Math.abs(sj[i][j]-(plus.residualVector[i]-minus.residualVector[i])/(2*h)));}
  check(scaledError<1e-8&&close(rotate(ss.residualVector.slice(0,2)),sr.residualVector.slice(0,2),1e-14)&&close(scaled.certificate(at).residualVector,a.certificate(at).residualVector,1e-14),
    'auxiliary tangent search scaling preserves frame covariance, the exact Jacobian and the original canonical certificate');
  const roots=[1,.1,.001,10].map(alpha=>{const model=VI.create({H:[[.4]],C:[],linear:[-1],normal:zeroNormal,blocks:[{start:0,size:1,metric:.4,capFixed:.2}],tangentSearchScale:alpha}),solved=Newton.solve({x:[0],evaluate:model.evaluate,jacobian:model.jacobian,tolerance:alpha*1e-12,forceTolerance:1e-9,residualScale:model.scales,includeFeasibilityInMerit:false}),cert=model.certificate(solved.x);return solved.converged&&Math.abs(solved.x[0]-.2)<1e-10&&cert.payload.maxResidual<1e-10&&cert.feasibility<=1e-9;});
  check(roots.every(Boolean),
    'positive auxiliary metrics retain the same exact Coulomb root and strict actual-force feasibility');
  check([0,-1,Infinity,NaN].every(alpha=>{try{VI.create({...toy,tangentSearchScale:alpha});return false;}catch{return true;}}),
    'nonpositive and nonfinite auxiliary metrics are rejected rather than changing the projection law');
  const slide=require('./contact-vi-slide-fixture.json'),ids=new Map(slide.normalActive.map((id,j)=>[id,j])),slideNormal={size:slide.base.length,base:slide.base,diagonal:slide.diagonal,column:(id,out)=>{out.set(slide.columns[ids.get(id)]);return out;},apply:(v,out)=>{out.fill(0);for(let id=0;id<v.length;id++)if(v[id]){if(!ids.has(id))throw Error('Outside frozen physical subspace.');const col=slide.columns[ids.get(id)];for(let i=0;i<v.length;i++)out[i]+=col[i]*v[id];}return out;}},slideModel=VI.create({H:slide.H,C:slide.C,linear:slide.linear,normal:slideNormal,normalActive:slide.normalActive,blocks:slide.blocks,modes:slide.modes,tangentSearchScale:.001}),slideLambda=Array(slide.base.length).fill(0);slide.normalActive.forEach((id,j)=>slideLambda[id]=slide.normalForces[j]);
  const slideResult=Newton.solve({x:slideModel.initial(slide.tangents,slideLambda),evaluate:slideModel.evaluate,jacobian:slideModel.jacobian,tolerance:.001*3e-7/Math.SQRT2,forceTolerance:1e-9,residualScale:slideModel.scales,maxIterations:24,maxEvaluations:512,maxStep:Infinity,includeFeasibilityInMerit:false}),slideCertificate=slideModel.certificate(slideResult.x);
  check(slideResult.converged&&slideCertificate.valid&&slideCertificate.payload.maxResidual<=3e-7&&slideCertificate.feasibility<=1e-9&&slideCertificate.residualVector.length===208&&slideCertificate.payload.normalForces.length===200&&slideModel.dimensions.storedNormalColumns===31&&slideResult.evaluations<=128,
    'the actual redundant-traction slide case converges under auxiliary search while all 200 original normal rows and canonical force gates remain strict');
  const full=q.certificateForces({tangents:final.payload.tangents,normalForces:final.payload.normalForces});
  check(full.payload.fullForces&&full.payload.physical&&close(full.residualVector,final.residualVector,1e-14)&&full.feasibility===final.feasibility&&close(full.payload.caps,final.payload.caps,1e-14),
    'full-force certification exactly matches the selected-coordinate physical certificate without changing canonical pressure or friction formulas');
  let calls=0;const many=1536,largeForces=Float64Array.from({length:many},(_,i)=>i%7===0?.3:0),large=VI.create({H:[],C:Array.from({length:many},()=>[]),linear:[],normal:{size:many,base:Array.from(largeForces,v=>-v),diagonal:Array(many).fill(1),apply:(v,out)=>{calls++;out.set(v);}},blocks:[],normalActive:[]}),largeBefore=Array.from(largeForces),largeCertificate=large.certificateForces({tangents:[],normalForces:largeForces});
  check(calls===1&&large.dimensions.storedNormalColumns===0&&largeCertificate.payload.normalForces.length===many&&largeCertificate.residualVector.length===many&&largeCertificate.payload.maxResidual===0&&largeCertificate.feasibility===0&&close(Array.from(largeForces),largeBefore,0),
    'an independent solver certifies all 1536 normal forces with one actual operator call, zero selected columns and no input mutation');
  const outside=thin.certificateForces({tangents:final.payload.tangents,normalForces:final.payload.normalForces}),badNormals=final.payload.normalForces.slice();badNormals[0]=-1;
  check(close(outside.residualVector,final.residualVector,1e-14)&&thin.certificateForces({tangents:final.payload.tangents,normalForces:badNormals}).feasibility>=1&&slowMetric.certificateForces({tangents:[.9999],normalForces:[]}).payload.maxResidual>3e-7,
    'full forces outside the Newton cache retain strict nonnegative-pressure and original-metric friction acceptance');
  const forbidden=guarded.certificateForces({tangents:force,normalForces:lambda}),wrong=[()=>large.certificateForces({tangents:[0],normalForces:largeForces}),()=>large.certificateForces({tangents:[],normalForces:[NaN]})];
  check(!forbidden.valid&&forbidden.feasibility>=.2&&wrong.every(fn=>{try{fn();return false;}catch{return true;}}),
    'full-force certification cannot bypass actuator stroke/effort gates or accept malformed force vectors');
  const unboundedModel=VI.create({H:[[0]],C:[],linear:[-1],normal:zeroNormal,blocks:[{start:0,size:1,metric:1,capFixed:Infinity}],tangentSearchScale:.001}),unboundedForce=unboundedModel.certificateForces({tangents:[1e20],normalForces:[]}),unboundedSearch=unboundedModel.evaluate([1e20]),noFalseRoot=Newton.solve({x:[1e20],evaluate:unboundedModel.evaluate,jacobian:unboundedModel.jacobian,tolerance:1e-12,maxIterations:1000,includeFeasibilityInMerit:false});
  check(unboundedForce.payload.maxResidual===1&&unboundedForce.residualVector[0]===-1&&unboundedSearch.residualVector[0]===-1&&!noFalseRoot.converged,
    'large unbounded force coordinates cannot cancel a nonzero interior gradient into a false canonical or search root');
};
module.exports.evaluator=evaluator;
module.exports.joint=joint;
if(require.main===module){const assert=require('node:assert/strict');module.exports({check:(ok,msg)=>{assert.ok(ok,msg);process.stdout.write('ok '+msg+'\n');}});}
