// Full proximal-point contact search. Only the original physical certificate can accept forces.
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./contact-ngs-core.js'),require('./contact-vi-core.js'));else root.ContactProxCore=factory(root.ContactNGSCore,root.ContactVICore);
})(typeof self!=='undefined'?self:this,function(NGS,VI){
  'use strict';
  const finite=Number.isFinite;
  function solve(problem){
    const {H,C,linear,normal,blocks,modes=[],certificate}=problem,k=H.length,n=normal.size,tolerance=problem.tolerance??3e-7,forceTolerance=problem.forceTolerance??1e-9,innerTolerance=problem.innerTolerance??3e-8,maxOuterIterations=problem.maxOuterIterations??32,maxInnerSweeps=problem.maxInnerSweeps??500,checkEvery=problem.checkEvery??10,maxCachedColumns=problem.maxCachedColumns??64,relativeAlpha=problem.relativeAlpha??.001,inexactRatio=problem.inexactRatio??.6,progressRatio=problem.progressRatio??.9,adaptiveAlpha=problem.adaptiveAlpha??false;
    if(!Number.isInteger(n)||n<0||typeof normal.apply!=='function'||typeof normal.column!=='function'||typeof certificate!=='function'||problem.innerRefine!==undefined&&typeof problem.innerRefine!=='function'||typeof adaptiveAlpha!=='boolean'||H.some(row=>row.length!==k||row.some(v=>!finite(v)))||C.length!==n||C.some(row=>row.length!==k||row.some(v=>!finite(v)))||linear.length!==k||linear.some(v=>!finite(v))||normal.base.length!==n||normal.base.some(v=>!finite(v))||normal.diagonal.length!==n||normal.diagonal.some(v=>!(v>0&&finite(v)))||!Array.isArray(blocks)||![tolerance,innerTolerance,relativeAlpha].every(v=>v>0&&finite(v))||!(forceTolerance>=0&&finite(forceTolerance))||![inexactRatio,progressRatio].every(v=>v>0&&v<1&&finite(v))||![maxOuterIterations,maxInnerSweeps,checkEvery,maxCachedColumns].every(Number.isInteger)||maxOuterIterations<0||maxInnerSweeps<0||checkEvery<1||maxCachedColumns<1||problem.alpha!==undefined&&!(problem.alpha>0&&finite(problem.alpha)))throw Error('Invalid proximal contact problem.');
    const covered=new Set(),used=new Set();for(const block of blocks){
      const {start,size,metric}=block;if(!Number.isInteger(start)||!Number.isInteger(size)||size<1||start<0||start+size>k||!(metric>0&&finite(metric)))throw Error('Invalid proximal tangent block.');
      for(let j=start;j<start+size;j++){if(covered.has(j))throw Error('Overlapping proximal tangent blocks.');covered.add(j);}
      if(block.capFixed===0){if(block.capNormals!==undefined||block.capSides!==undefined)return null;continue;}
      if(block.capFixed!==undefined||block.capSides!==undefined||block.capMax!==undefined||size!==2||block.capNormals?.length!==1)return null;
      const row=block.capNormals[0];if(!Array.isArray(row)||row.length!==2)throw Error('Invalid proximal pressure cone.');
      const [id,w]=row;if(!Number.isInteger(id)||id<0||id>=n||!(w>=0&&finite(w))||block.capScale!==undefined&&!(block.capScale>=0&&finite(block.capScale)))throw Error('Invalid proximal pressure cone.');if(used.has(id))return null;used.add(id);
    }
    if(covered.size!==k)throw Error('Proximal tangent blocks must cover every coordinate.');
    const initial={tangents:Array.from(problem.initial?.tangents??Array(k).fill(0)),normalForces:Array.from(problem.initial?.normalForces??Array(n).fill(0))};
    if(initial.tangents.length!==k||initial.normalForces.length!==n||initial.tangents.some(v=>!finite(v))||initial.normalForces.some(v=>!finite(v)))throw Error('Invalid proximal initial forces.');
    const copy=field=>({tangents:field.tangents.slice(),normalForces:field.normalForces.slice()});
    function residual(q){return q?.payload?.maxResidual??(q?.residualVector?Math.max(0,...Array.from(q.residualVector,Math.abs)):Infinity);}
    function feasible(q){return q?.valid===true&&q.residualVector?.length===k+n&&Array.from(q.residualVector).every(finite)&&finite(residual(q))&&residual(q)>=0&&finite(q.feasibility)&&q.feasibility>=0&&q.feasibility<=forceTolerance;}
    const accepted=q=>feasible(q)&&residual(q)<=tolerance;
    let originalCertificates=0,outerIterations=0,innerSweeps=0,innerApplications=0,innerCertificates=0,columnApplications=0,baseColumnApplications=0,innerFailures=0,refineAttempts=0,refineUses=0,refineIterations=0,refineEvaluations=0,alpha=0,reason='outer-limit',trace=[];const baseColumns=new Map();
    function original(field){originalCertificates++;return certificate(copy(field));}
    let anchor=copy(initial),evaluation=original(anchor),anchorResidual=residual(evaluation),best={...copy(anchor),evaluation};
    function result(converged){return {...copy(best),evaluation:best.evaluation,converged,reason:converged?'converged':reason,alpha,outerIterations,innerSweeps,innerApplications,innerCertificates,columnApplications,baseColumnApplications,cachedBaseColumns:baseColumns.size,originalCertificates,innerFailures,refineAttempts,refineUses,refineIterations,refineEvaluations,trace};}
    if(accepted(evaluation))return result(true);
    if(!feasible(evaluation)){reason='infeasible-initial-anchor';return result(false);}
    if(maxOuterIterations===0)return result(false);
    const baseH=H.map(row=>Array.from(row)),base=Array.from(normal.base),diagonal=Array.from(normal.diagonal),rhs=Array.from(linear),scale=Math.max(0,...baseH.map((row,i)=>row[i]),...diagonal,...blocks.map(block=>block.metric));
    alpha=problem.alpha??scale*relativeAlpha;if(!(alpha>0&&finite(alpha))){reason='empty-or-invalid-mobility';return result(false);}
    // The original operator is frozen for this solve. Reuse a bounded set of
    // copied columns across numerical penalties without borrowing caller storage.
    function baseColumn(j){
      if(baseColumns.has(j)){const values=baseColumns.get(j);baseColumns.delete(j);baseColumns.set(j,values);return values;}
      const scratch=new Float64Array(n),raw=normal.column(j,scratch)||scratch;if(raw.length!==n)throw Error('Invalid proximal normal column.');for(let i=0;i<n;i++)if(!finite(raw[i]))throw Error('Invalid proximal normal column.');
      const values=Float64Array.from(raw);baseColumnApplications++;if(baseColumns.size>=maxCachedColumns)baseColumns.delete(baseColumns.keys().next().value);baseColumns.set(j,values);return values;
    }
    for(let outer=0;outer<maxOuterIterations;outer++){
      outerIterations=outer+1;const stepAlpha=alpha,fixed=copy(anchor),shiftedH=baseH.map((row,i)=>row.map((v,j)=>v+(i===j?stepAlpha:0))),shiftedLinear=rhs.map((v,i)=>v-stepAlpha*fixed.tangents[i]),shiftedNormal={...normal,base:base.map((v,i)=>v-stepAlpha*fixed.normalForces[i]),diagonal:diagonal.map(v=>v+stepAlpha),
        apply(v,out=new Float64Array(n)){
          const scratch=new Float64Array(n),raw=normal.apply(v,scratch)||scratch;if(raw.length!==n)throw Error('Invalid proximal normal response.');const values=Float64Array.from(raw);
          for(let i=0;i<n;i++)out[i]=values[i]+stepAlpha*v[i];return out;
        },
        column(j,out=new Float64Array(n)){
          const values=baseColumn(j);
          for(let i=0;i<n;i++)out[i]=values[i];out[j]+=stepAlpha;return out;
        }};
      const innerProblem={H:shiftedH,C,linear:shiftedLinear,normal:shiftedNormal,blocks,modes},innerModel=VI.create({...innerProblem,normalActive:[]});let inner=NGS.solve({...innerProblem,initial:fixed,certificate:innerModel.certificateForces,tolerance:innerTolerance,forceTolerance,maxSweeps:maxInnerSweeps,checkEvery,maxCachedColumns,residualPrecheck:true});
      let refinement=null,refineUsed=false;
      if(inner&&problem.innerRefine&&!inner.converged){
        refineAttempts++;refinement=problem.innerRefine({...innerProblem,initial:copy(inner),certificate:innerModel.certificateForces,options:{tolerance:innerTolerance,forceTolerance}});
        if(refinement){
          refineIterations+=refinement.iterations??0;refineEvaluations+=refinement.evaluations??0;
          const f={tangents:Array.from(refinement.tangents??[]),normalForces:Array.from(refinement.normalForces??[])};
          if(f.tangents.length===k&&f.normalForces.length===n&&f.tangents.every(finite)&&f.normalForces.every(finite)){
            const checked=innerModel.certificateForces(f);innerCertificates++;
            if(feasible(checked)&&(!feasible(inner.evaluation)||residual(checked)<residual(inner.evaluation)||residual(checked)<=innerTolerance)){
              inner={...inner,...f,evaluation:checked,converged:residual(checked)<=innerTolerance};refineUsed=true;refineUses++;
            }
          }
        }
      }
      if(!inner)return null;innerSweeps+=inner.sweeps;innerApplications+=inner.applications;innerCertificates+=inner.certificates;columnApplications+=inner.columnApplications;if(!inner.converged)innerFailures++;
      const candidate={tangents:inner.tangents,normalForces:inner.normalForces};evaluation=original(candidate);const innerResidual=residual(inner.evaluation),physicalResidual=residual(evaluation),physicalFeasible=feasible(evaluation),advanceCause=!physicalFeasible?null:inner.converged?'inner-converged':finite(innerResidual)&&innerResidual<inexactRatio*physicalResidual?'relative-inner-residual':physicalResidual<=progressRatio*anchorResidual?'original-merit-decrease':null,advance=advanceCause!==null;
      trace.push({outer,...adaptiveAlpha?{stepAlpha}:{},anchorResidual,innerConverged:inner.converged,innerResidual,originalResidual:physicalResidual,originalFeasibility:evaluation?.feasibility,originalValid:evaluation?.valid,sweeps:inner.sweeps,applications:inner.applications,certificates:inner.certificates,columns:inner.columnApplications,...refinement?{refineUsed,refineReason:refinement.reason,refineIterations:refinement.iterations,refineEvaluations:refinement.evaluations,refineUnknowns:refinement.maxSelectedUnknowns,refineTangents:refinement.maxSelectedTangents,refineNormals:refinement.maxSelectedNormals,refineJacobianEntries:refinement.maxJacobianEntries}:{},advance,advanceCause});
      if(physicalFeasible&&physicalResidual<residual(best.evaluation))best={...copy(candidate),evaluation};
      // Inner convergence or a small force increment is never physical acceptance.
      if(accepted(evaluation)){best={...copy(candidate),evaluation};return result(true);}
      if(!physicalFeasible){reason='infeasible-original-candidate';break;}
      if(!advance){
        if(adaptiveAlpha&&finite(alpha*4)){alpha*=4;trace[trace.length-1].alphaAction='increase-retry';continue;}
        reason='inexact-forcing-not-met';break;
      }
      // These are numerical penalties only. Keep each outer operator immutable;
      // the original physical certificate above remains the sole acceptance gate.
      if(adaptiveAlpha&&inner.converged&&physicalResidual>=.9*anchorResidual&&alpha*.25>0){alpha*=.25;trace[trace.length-1].alphaAction='cool';}
      anchor=copy(candidate);anchorResidual=physicalResidual;
    }
    return result(false);
  }
  return {solve};
});
