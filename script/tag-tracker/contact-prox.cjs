// Proximal contact search is numerical only; every physical acceptance uses the original operator.
module.exports=function({check}){
  const Prox=require('../../tag-tracker/contact-prox-core'),VI=require('../../tag-tracker/contact-vi-core'),NGS=require('../../tag-tracker/contact-ngs-core'),norm=v=>Math.hypot(...v),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),close=(a,b,t=1e-9)=>norm(a.map((v,i)=>v-b[i]))<=t;
  function system({H=[],C,N,base,linear=[],blocks=[],modes=[]},borrowed=false){
    const n=N.length,counts={apply:0,column:0,mutated:false},cache=new Float64Array(n),columns=N.map((_,j)=>Object.freeze(N.map(row=>row[j])));let snapshot=null;
    const normal={size:n,base:base.slice(),diagonal:N.map((row,i)=>row[i]),apply:(v,out=new Float64Array(n))=>{counts.apply++;if(snapshot&&cache.some((v,i)=>v!==snapshot[i]))counts.mutated=true;for(let i=0;i<n;i++)cache[i]=dot(N[i],v);snapshot=Array.from(cache);if(borrowed)return cache;out.set(cache);return out;},column:(j,out=new Float64Array(n))=>{counts.column++;if(borrowed)return columns[j];out.set(columns[j]);return out;}},model=VI.create({H,C,linear,normal,blocks,modes,normalActive:[]});
    return {problem:{H,C,linear,normal,blocks,modes,certificate:model.certificateForces,tolerance:1e-8,innerTolerance:1e-10,maxOuterIterations:32,maxInnerSweeps:100,checkEvery:1},model,counts,columns};
  }
  const scalar=system({C:[[]],N:[[1]],base:[-1]}),one=Prox.solve({...scalar.problem,alpha:1,maxOuterIterations:1});
  check(!one.converged&&one.trace[0].innerConverged&&close(one.normalForces,[.5])&&one.evaluation.payload.maxResidual===.5,
    'an exactly solved proximal inner problem cannot certify a nonroot of the original unmodified contact law');
  const complete=Prox.solve({...scalar.problem,alpha:.2,tolerance:1e-7}),root=Prox.solve({...scalar.problem,initial:{tangents:[],normalForces:[1]},alpha:99});
  check(complete.converged&&Math.abs(complete.normalForces[0]-1)<1e-7&&complete.evaluation.payload.maxResidual<=1e-7&&root.converged&&root.outerIterations===0&&root.innerSweeps===0&&root.originalCertificates===1&&root.alpha===0,
    'converged forces satisfy the original law and an existing original root exits before introducing any proximal shift');
  const empty=system({C:[],N:[],base:[]}),nothing=Prox.solve(empty.problem);
  check(nothing.converged&&nothing.outerIterations===0&&nothing.alpha===0&&nothing.tangents.length===0&&nothing.normalForces.length===0,
    'an empty original root exits without taking the maximum of an empty mobility set');
  const coupled=system({C:[[],[]],N:[[1,.5],[.5,1]],base:[-1,-1]}),inexact=Prox.solve({...coupled.problem,alpha:1,innerTolerance:1e-14,maxInnerSweeps:1,maxOuterIterations:40,tolerance:1e-6});
  check(inexact.converged&&inexact.innerFailures>0&&inexact.trace.some(q=>!q.innerConverged&&q.advance)&&close(inexact.normalForces,[2/3,2/3],3e-6)&&inexact.evaluation.feasibility===0,
    'bounded inexact inner candidates can advance numerical anchors while only the original full certificate accepts physical forces');
  let guarded=true;for(const reject of [q=>({...q,valid:false}),q=>({...q,feasibility:1})]){const q=Prox.solve({...scalar.problem,alpha:1,maxOuterIterations:5,certificate:f=>{const at=scalar.model.certificateForces(f);return f.normalForces[0]>.4?reject(at):at;}});guarded&&=!q.converged&&q.outerIterations===1&&!q.trace[0].advance&&q.reason==='infeasible-original-candidate'&&q.normalForces[0]===0;}
  check(guarded,'force- or stroke-invalid original candidates cannot advance anchors even when the inner solve converges');
  const budget=Prox.solve({...scalar.problem,maxOuterIterations:0}),stuck=Prox.solve({...scalar.problem,maxInnerSweeps:0,maxOuterIterations:5,alpha:1});
  check(!budget.converged&&budget.outerIterations===0&&budget.originalCertificates===1&&!stuck.converged&&stuck.outerIterations===1&&!stuck.trace[0].advance&&stuck.reason==='inexact-forcing-not-met',
    'outer and inner budgets stay bounded and a nonroot fixed anchor cannot satisfy the inexact forcing test');
  const borrowed=system({C:[[],[]],N:[[1,.2],[.2,2]],base:[-1,-1]},true),inputBefore=JSON.stringify({H:borrowed.problem.H,C:borrowed.problem.C,base:borrowed.problem.normal.base,diagonal:borrowed.problem.normal.diagonal,columns:borrowed.columns}),br=Prox.solve({...borrowed.problem,alpha:.2,tolerance:1e-6});
  check(br.converged&&close(br.normalForces,[1.8/1.96,.8/1.96],2e-6)&&!borrowed.counts.mutated&&inputBefore===JSON.stringify({H:borrowed.problem.H,C:borrowed.problem.C,base:borrowed.problem.normal.base,diagonal:borrowed.problem.normal.diagonal,columns:borrowed.columns}),
    'returned cached apply/column buffers are honored and copied before numerical diagonal shifts without mutating the physical operator');
  const originalSolve=NGS.solve;let shiftOkay=false,best,nullHandled,meritAccepted,smallDeclined,tinyEnabled,tinyDefault,tinyBlocked;
  try{
    const mixed=system({H:[[2,.3],[.3,1]],C:[[.2,-.1]],N:[[1]],base:[-2],linear:[-.5,.2],blocks:[{start:0,size:2,metric:2.1,capNormals:[[0,1]]}]}),anchor={tangents:[.1,.05],normalForces:[1]},before=JSON.stringify({...anchor,H:mixed.problem.H,C:mixed.problem.C,linear:mixed.problem.linear,base:mixed.problem.normal.base,diag:mixed.problem.normal.diagonal});
    NGS.solve=options=>{const out=options.normal.apply([2]),col=options.normal.column(0);shiftOkay=close(options.H.flat(),[2.4,.3,.3,1.4])&&close(options.linear,[-.54,.18])&&close(options.C.flat(),[.2,-.1])&&close(options.normal.base,[-2.4])&&close(options.normal.diagonal,[1.4])&&close(out,[2.8])&&close(col,[1.4]);return {...anchor,converged:false,sweeps:0,applications:1,certificates:1,columnApplications:1,evaluation:options.certificate(anchor)};};
    Prox.solve({...mixed.problem,initial:anchor,alpha:.4,maxOuterIterations:1});shiftOkay&&=before===JSON.stringify({...anchor,H:mixed.problem.H,C:mixed.problem.C,linear:mixed.problem.linear,base:mixed.problem.normal.base,diag:mixed.problem.normal.diagonal});
    let call=0;NGS.solve=options=>{const f={tangents:[],normalForces:[call++===0?.5:.4]};return {...f,converged:false,sweeps:1,applications:1,certificates:1,columnApplications:0,evaluation:options.certificate(f)};};best=Prox.solve({...scalar.problem,alpha:1,maxOuterIterations:2});
    for(const value of [.2,.05]){NGS.solve=options=>{const f={tangents:[],normalForces:[value]};return {...f,converged:false,sweeps:1,applications:1,certificates:1,columnApplications:0,evaluation:options.certificate(f)};};const result=Prox.solve({...scalar.problem,alpha:1,maxOuterIterations:1});if(value===.2)meritAccepted=result;else smallDeclined=result;}
    NGS.solve=options=>{const f={tangents:[],normalForces:[1e-5]};return {...f,converged:false,sweeps:1,applications:1,certificates:1,columnApplications:0,evaluation:options.certificate(f)};};
    tinyEnabled=Prox.solve({...scalar.problem,alpha:1,maxOuterIterations:1,progressRatio:.999999});tinyDefault=Prox.solve({...scalar.problem,alpha:1,maxOuterIterations:1});tinyBlocked=Prox.solve({...scalar.problem,alpha:1,maxOuterIterations:1,progressRatio:.999999,certificate:f=>({...scalar.model.certificateForces(f),feasibility:f.normalForces[0]>0?1:0})});
    NGS.solve=()=>null;nullHandled=Prox.solve({...scalar.problem,alpha:1,maxOuterIterations:1})===null;
  }finally{NGS.solve=originalSolve;}
  check(shiftOkay,'the full H and normal diagonal/operator receive alpha while both RHS anchors shift and C and physical inputs stay unchanged');
  check(close(best.normalForces,[.5])&&best.evaluation.payload.maxResidual===.5&&best.trace.length===2&&best.trace[1].originalResidual>.5&&!best.converged,
    'a later worse feasible proposal cannot overwrite the best original-certified force field');
  check(!meritAccepted.converged&&meritAccepted.trace[0].advance&&meritAccepted.trace[0].advanceCause==='original-merit-decrease'&&meritAccepted.trace[0].anchorResidual===1&&meritAccepted.trace[0].innerResidual>.6*meritAccepted.trace[0].originalResidual&&!smallDeclined.trace[0].advance,
    'a clear original-merit decrease can advance only a numerical anchor while insufficient progress cannot bypass either search forcing or physical acceptance');
  check(tinyEnabled.trace[0].advance&&tinyEnabled.trace[0].advanceCause==='original-merit-decrease'&&!tinyEnabled.converged&&tinyEnabled.evaluation.payload.maxResidual>.99&&!tinyDefault.trace[0].advance&&!tinyBlocked.trace[0].advance&&!tinyBlocked.converged,
    'the explicit near-monotone search option permits tiny numerical progress without changing original-root acceptance, force feasibility or the default policy');
  const unsupported=system({H:[[1]],C:[],N:[],base:[],linear:[0],blocks:[{start:0,size:1,metric:1,capFixed:1}]}),u=Prox.solve(unsupported.problem);
  check(u===null&&unsupported.counts.apply===0&&nullHandled,'unsupported positive captured caps and unsupported inner solvers return null without dereferencing or accepting a partial solve');
  let malformed=false,called=0;try{Prox.solve({...scalar.problem,H:[[1,0],[0,1]],C:[[0,0]],linear:[0,0],blocks:[{start:0,size:2,metric:1,capNormals:[[0,1,9]]}],initial:{tangents:[0,0],normalForces:[1]},certificate:()=>{called++;return {valid:true,feasibility:0,residualVector:[0,0,0]};}});}catch{malformed=true;}
  check(malformed&&called===0,'malformed pressure rows are rejected consistently before even an initial-original-root fast exit');
  const cool=Prox.solve({...scalar.problem,alpha:10,maxOuterIterations:2,adaptiveAlpha:true}),noCool=Prox.solve({...scalar.problem,alpha:10,maxOuterIterations:2});
  check(!cool.converged&&cool.trace[0].innerConverged&&cool.trace[0].alphaAction==='cool'&&cool.trace[0].stepAlpha===10&&cool.trace[1].stepAlpha===2.5&&cool.evaluation.payload.maxResidual<noCool.evaluation.payload.maxResidual&&!noCool.trace.some(t=>t.alphaAction),
    'optional cooling changes only the next numerical penalty after an exact inner root stagnates while default fixed-alpha behavior and physical acceptance stay unchanged');
  let heated,defaultStopped,retryLimited,invalidRetry,oldOperatorOkay=false;
  try{
    let visits=[];NGS.solve=options=>{visits.push(options);const f={tangents:[],normalForces:[visits.length===1?.05:.2]},q=options.certificate(f);return {...f,evaluation:q,converged:q.payload.maxResidual<=options.tolerance,sweeps:1,applications:1,certificates:1,columnApplications:0};};
    heated=Prox.solve({...scalar.problem,alpha:1,maxOuterIterations:2,adaptiveAlpha:true});
    oldOperatorOkay=visits.length===2&&visits.every(v=>v.normal.base[0]===-1)&&visits[0].normal.diagonal[0]===2&&visits[1].normal.diagonal[0]===5&&visits[0].normal.apply([2])[0]===4&&visits[0].normal.column(0)[0]===2&&visits[1].normal.apply([2])[0]===10;
    visits=[];defaultStopped=Prox.solve({...scalar.problem,alpha:1,maxOuterIterations:2});
    NGS.solve=options=>{const f={tangents:[],normalForces:[0]};return {...f,evaluation:options.certificate(f),converged:false,sweeps:0,applications:1,certificates:1,columnApplications:0};};
    retryLimited=Prox.solve({...scalar.problem,alpha:1,maxOuterIterations:4,adaptiveAlpha:true});
    NGS.solve=options=>{const f={tangents:[],normalForces:[.05]};return {...f,evaluation:options.certificate(f),converged:false,sweeps:0,applications:1,certificates:1,columnApplications:0};};
    invalidRetry=Prox.solve({...scalar.problem,alpha:1,maxOuterIterations:4,adaptiveAlpha:true,certificate:f=>({...scalar.model.certificateForces(f),valid:f.normalForces[0]===0})});
  }finally{NGS.solve=originalSolve;}
  check(!heated.converged&&heated.trace[0].alphaAction==='increase-retry'&&!heated.trace[0].advance&&heated.trace[1].stepAlpha===4&&heated.trace[1].anchorResidual===1&&heated.trace[1].innerConverged&&close(heated.normalForces,[.2])&&defaultStopped.outerIterations===1&&defaultStopped.reason==='inexact-forcing-not-met'&&oldOperatorOkay,
    'failed inner forcing can heat and retry the same feasible anchor without changing retained earlier operator callbacks or default one-attempt behavior');
  check(!retryLimited.converged&&retryLimited.outerIterations===4&&retryLimited.reason==='outer-limit'&&close(retryLimited.trace.map(t=>t.stepAlpha),[1,4,16,64])&&retryLimited.trace.every(t=>!t.advance&&t.anchorResidual===1&&t.alphaAction==='increase-retry')&&invalidRetry.outerIterations===1&&invalidRetry.reason==='infeasible-original-candidate'&&!invalidRetry.trace[0].alphaAction,
    'heating retries share the fixed total outer budget and invalid original force/stroke candidates cannot advance or trigger a retry');
  const cached=system({C:[[]],N:[[1]],base:[-1]}),shifted=[],cachedResult=Prox.solve({...cached.problem,alpha:1,adaptiveAlpha:true,maxInnerSweeps:0,maxOuterIterations:2,innerRefine:options=>{shifted.push(options.normal);const out=options.normal.column(0);out[0]=999;options.normal.column(0);return null;}});
  check(!cachedResult.converged&&cached.counts.column===1&&cachedResult.baseColumnApplications===1&&cachedResult.cachedBaseColumns===1&&shifted.length===2&&shifted[0].column(0)[0]===2&&shifted[1].column(0)[0]===5&&shifted[0].column(0)[0]===2,
    'one immutable original column is reused across alpha values and modifying a returned shifted column cannot change cached geometry or earlier callbacks');
  const sharedBuffer=new Float64Array(2),borrowedSource=system({C:[[],[]],N:[[1,.2],[.2,2]],base:[-1,-1]});let borrowedCalls=0;
  const sharedColumn=(j,out)=>{borrowedCalls++;sharedBuffer[0]=j===0?1:.2;sharedBuffer[1]=j===0?.2:2;return sharedBuffer;},borrowedCached=Prox.solve({...borrowedSource.problem,normal:{...borrowedSource.problem.normal,column:sharedColumn},alpha:1,maxInnerSweeps:0,maxOuterIterations:2,adaptiveAlpha:true,maxCachedColumns:2,innerRefine:options=>{const first=options.normal.column(0);options.normal.column(1);if(first[0]!==options.normal.column(0)[0])throw Error('Borrowed column changed');return null;}}),evicted=Prox.solve({...borrowedSource.problem,alpha:1,maxInnerSweeps:0,maxOuterIterations:2,adaptiveAlpha:true,maxCachedColumns:1,innerRefine:options=>{options.normal.column(0);options.normal.column(1);options.normal.column(0);return null;}});
  check(borrowedCalls===2&&borrowedCached.baseColumnApplications===2&&borrowedCached.cachedBaseColumns===2&&evicted.baseColumnApplications===5&&evicted.cachedBaseColumns===1&&!borrowedCached.converged&&!evicted.converged,
    'borrowed reusable source buffers are copied and the solve-local LRU obeys the configured column bound across numerical retries');
};
if(require.main===module){const assert=require('node:assert/strict');module.exports({check:(ok,msg)=>{assert.ok(ok,msg);process.stdout.write('ok '+msg+'\n');}});}
