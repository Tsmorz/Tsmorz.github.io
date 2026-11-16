// Compact inner Newton proposals keep all canonical rows and never authorize outer forces.
module.exports=function({check}){
  const Refine=require('../../tag-tracker/contact-refine-core'),VI=require('../../tag-tracker/contact-vi-core'),Prox=require('../../tag-tracker/contact-prox-core'),norm=v=>Math.hypot(...v),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),close=(a,b,t=1e-8)=>norm(a.map((v,i)=>v-b[i]))<=t;
  function system({H=[],C,N,base,linear=[],blocks=[],modes=[]}){
    const n=N.length,counts={apply:0,column:0},normal={size:n,base:base.slice(),diagonal:N.map((row,i)=>row[i]),apply:(v,out=new Float64Array(n))=>{counts.apply++;for(let i=0;i<n;i++)out[i]=dot(N[i],v);return out;},column:(j,out=new Float64Array(n))=>{counts.column++;for(let i=0;i<n;i++)out[i]=N[i][j];return out;}},model=VI.create({H,C,linear,normal,blocks,modes,normalActive:[]});
    return {problem:{H,C,linear,normal,blocks,modes,certificate:model.certificateForces,initial:{tangents:Array(H.length).fill(0),normalForces:Array(n).fill(0)}},model,counts};
  }
  const mixed=system({H:[[1,0],[0,1]],C:[[.1,0]],N:[[1]],base:[-1],linear:[-.2,0],blocks:[{start:0,size:2,metric:1,capNormals:[[0,.5]]}]}),r=Refine.solve(mixed.problem);
  check(r.converged&&close(r.tangents,[.1/.99,0])&&close(r.normalForces,[1-.01/.99])&&r.evaluation.payload.physical&&r.evaluation.payload.fullForces&&r.evaluation.payload.maxResidual<=Refine.CONFIG.tolerance&&r.iterations>0&&r.evaluations>0,
    'the compact inner Newton proposal satisfies the original full normal and Coulomb certificate on a coupled stick problem');
  const sliding=system({H:[[1,0],[0,1]],C:[[0,0]],N:[[1]],base:[-1],linear:[-2,0],blocks:[{start:0,size:2,metric:1,capNormals:[[0,.5]]}]}),s=Refine.solve(sliding.problem);
  check(s.converged&&close(s.tangents,[.5,0])&&close(s.normalForces,[1])&&s.evaluation.feasibility<=1e-9,
    'a sliding cone boundary is certified with actual pressure and cannot return an unconstrained stick force');
  const expanding=system({C:[[],[]],N:[[1,-.5],[-.5,1]],base:[-1,.1]}),expanded=Refine.solve(expanding.problem);
  check(expanded.converged&&close(expanded.normalForces,[1.2666666666666666,.5333333333333333])&&expanded.trace.some(q=>q.missing>0)&&expanded.maxSelectedNormals===2&&expanded.evaluation.residualVector.length===2,
    'every omitted negative-gap normal expands the selected workspace while all original residual rows remain certified');
  const scalar=system({C:[[]],N:[[1]],base:[-1]}),beforeColumns=scalar.counts.column,guarded=Refine.solve({...scalar.problem,options:{maxUnknowns:0}}),guardEntries=Refine.solve({...scalar.problem,options:{maxJacobianEntries:0}});
  check(!guarded.converged&&guarded.reason==='workspace-limit'&&!guardEntries.converged&&guardEntries.reason==='workspace-limit'&&scalar.counts.column===beforeColumns&&guarded.normalForces[0]===0&&guarded.maxSelectedUnknowns===1&&Refine.solve({...scalar.problem,options:{maxUnknowns:1,maxJacobianEntries:1}}).converged,
    'configurable workspace guards fail explicitly before storing a column or dropping a row and preserve the feasible input proposal');
  const n=1200,largeCounts={column:0},largeNormal={size:n,base:Array.from({length:n},(_,i)=>i===0?-1:1),diagonal:Array(n).fill(1),apply:(v,out=new Float64Array(n))=>{out.set(v);return out;},column:(j,out=new Float64Array(n))=>{largeCounts.column++;out[j]=1;return out;}},largeProblem={H:[],C:Array.from({length:n},()=>[]),linear:[],normal:largeNormal,blocks:[],normalActive:[]},largeModel=VI.create(largeProblem),large=Refine.solve({...largeProblem,certificate:largeModel.certificateForces,options:{maxUnknowns:1,maxJacobianEntries:2000}});
  check(large.converged&&large.maxSelectedUnknowns===1&&large.maxJacobianEntries===n&&largeCounts.column===1&&large.evaluation.residualVector.length===n&&large.normalForces.length===n,
    'many inactive original rows do not trigger an arbitrary manifold-count limit or a dense normal matrix');
  let rootColumns=0;const root=Refine.solve({...scalar.problem,initial:{tangents:[],normalForces:[1]},normal:{...scalar.problem.normal,column:()=>{rootColumns++;throw Error('unexpected column');}}}),empty=system({C:[],N:[],base:[]}),emptyResult=Refine.solve(empty.problem);
  check(root.converged&&root.iterations===0&&root.evaluations===0&&root.certificates===1&&rootColumns===0&&emptyResult.converged&&emptyResult.maxSelectedUnknowns===0,
    'existing full roots and empty systems exit before selecting or allocating a Newton workspace');
  let originalGate=true;for(const reject of [q=>({...q,valid:false}),q=>({...q,feasibility:1})]){
    const bad=Refine.solve({...scalar.problem,certificate:f=>{const q=scalar.model.certificateForces(f);return f.normalForces[0]>.2?reject(q):q;}});originalGate&&=!bad.converged&&bad.normalForces[0]===0&&bad.evaluation.valid&&bad.evaluation.feasibility===0;
  }
  check(originalGate,'later force- or stroke-invalid local roots cannot overwrite the best feasible full-operator proposal');
  const inconsistent=Refine.solve({...scalar.problem,certificate:f=>{const q=scalar.model.certificateForces(f);return {...q,payload:{...q.payload,maxResidual:1}};}}),limited=Refine.solve({...mixed.problem,options:{maxIterations:0,maxEvaluations:1}});
  check(!inconsistent.converged&&inconsistent.evaluation.payload.maxResidual===1&&!limited.converged&&limited.tangents.every(Number.isFinite)&&limited.normalForces.every(Number.isFinite),
    'fresh canonical rejection and bounded numerical failure cannot be hidden by a search convergence flag');
  const pending=system({H:[[1]],C:[[0]],N:[[1]],base:[-1],linear:[-10],blocks:[{start:0,size:1,metric:1,capFixed:0}]}),pendingResult=Refine.solve(pending.problem);
  check(pendingResult.converged&&pendingResult.tangents[0]===0&&pendingResult.maxSelectedTangents===0&&pendingResult.normalForces[0]===1,
    'fixed-zero pending tangent blocks remain zero while normal contact can be refined');
  const input={...mixed.problem,H:mixed.problem.H.map(row=>row.slice()),C:mixed.problem.C.map(row=>row.slice()),linear:mixed.problem.linear.slice(),initial:{tangents:[0,0],normalForces:[0]},blocks:mixed.problem.blocks.map(b=>({...b,capNormals:b.capNormals.map(row=>row.slice())}))},snapshot=JSON.stringify(input);Refine.solve(input);
  check(snapshot===JSON.stringify(input),'slicing, Newton probes, feasible polishing and warm-force handling do not mutate caller inputs');
  let calls=0;const unsupported=Refine.solve({...mixed.problem,blocks:[{start:0,size:2,metric:1,capFixed:1}],certificate:()=>{calls++;throw Error('unexpected');}});let malformed=false;try{Refine.solve({...mixed.problem,blocks:[{start:0,size:2,metric:1,capNormals:[[0,.5,7]]}],certificate:()=>{calls++;}});}catch{malformed=true;}
  check(unsupported===null&&malformed&&calls===0,'unsupported positive captured caps and malformed pressure pairs are rejected before any certificate or allocation');
  const refinedOuter=Prox.solve({...scalar.problem,alpha:1,maxInnerSweeps:0,maxOuterIterations:1,innerRefine:value=>Refine.solve(value)}),forged=Prox.solve({...scalar.problem,alpha:1,maxInnerSweeps:0,maxOuterIterations:1,innerRefine:()=>({tangents:[],normalForces:[1],converged:true,evaluation:{valid:true,feasibility:0,residualVector:[0],payload:{maxResidual:0}},iterations:2,evaluations:3})}),nullRefine=Prox.solve({...scalar.problem,alpha:1,maxInnerSweeps:0,maxOuterIterations:1,innerRefine:()=>null});
  check(!refinedOuter.converged&&refinedOuter.refineUses===1&&refinedOuter.refineIterations>0&&close(refinedOuter.normalForces,[.5])&&refinedOuter.trace[0].innerConverged&&refinedOuter.evaluation.payload.maxResidual===.5&&!forged.converged&&forged.refineUses===0&&forged.normalForces[0]===0&&forged.refineIterations===2&&forged.refineEvaluations===3&&!nullRefine.converged&&nullRefine.refineAttempts===1,
    'optional Prox refinement is freshly checked on the shifted inner problem and only the unmodified outer certificate can accept physical forces');
};
if(require.main===module){const assert=require('node:assert/strict');module.exports({check:(ok,msg)=>{assert.ok(ok,msg);process.stdout.write('ok '+msg+'\n');}});}
