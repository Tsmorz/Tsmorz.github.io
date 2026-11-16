// Compact Newton refinement of an already shifted numerical contact problem.
// Returned forces remain proposals: the caller must certify its original operator.
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./contact-vi-core.js'),require('./contact-newton-core.js'));else root.ContactRefineCore=factory(root.ContactVICore,root.ContactNewtonCore);
})(typeof self!=='undefined'?self:this,function(VI,Newton){
  'use strict';
  const finite=Number.isFinite,CONFIG=Object.freeze({tangentSearchScale:.001,normalSearch:'min',gapWindow:3e-7,tolerance:3e-8,forceTolerance:1e-9,maxExpansions:6,maxIterations:24,maxEvaluations:256,maxStep:Infinity,includeFeasibilityInMerit:false,maxUnknowns:192,maxJacobianEntries:1048576});
  function solve(problem){
    const {H,C,linear,normal,blocks,modes=[],certificate}=problem,cfg={...CONFIG,...problem.options},k=H.length,n=normal.size;
    if(!Number.isInteger(n)||n<0||typeof normal.apply!=='function'||typeof normal.column!=='function'||typeof certificate!=='function'||normal.base.length!==n||normal.base.some(v=>!finite(v))||normal.diagonal.length!==n||normal.diagonal.some(v=>!(v>0&&finite(v)))||H.some(row=>row.length!==k||row.some(v=>!finite(v)))||C.length!==n||C.some(row=>row.length!==k||row.some(v=>!finite(v)))||linear.length!==k||linear.some(v=>!finite(v))||!Array.isArray(blocks)||![cfg.tangentSearchScale,cfg.tolerance].every(v=>v>0&&finite(v))||![cfg.forceTolerance,cfg.gapWindow].every(v=>v>=0&&finite(v))||cfg.normalSearch!=='min'||![cfg.maxExpansions,cfg.maxIterations,cfg.maxEvaluations,cfg.maxUnknowns,cfg.maxJacobianEntries].every(v=>Number.isInteger(v)&&v>=0)||!(cfg.maxStep>0)||typeof cfg.includeFeasibilityInMerit!=='boolean')throw Error('Invalid contact refinement problem.');
    const covered=new Set(),used=new Set();for(const b of blocks){
      if(!Number.isInteger(b.start)||!Number.isInteger(b.size)||b.size<1||b.size>3||b.start<0||b.start+b.size>k||!(b.metric>0&&finite(b.metric)))throw Error('Invalid refinement tangent block.');
      for(let j=b.start;j<b.start+b.size;j++){if(covered.has(j))throw Error('Overlapping refinement tangent blocks.');covered.add(j);}
      if(b.capFixed===0){if(b.capNormals!==undefined||b.capSides!==undefined)return null;continue;}
      if(b.capFixed!==undefined||b.capSides!==undefined||b.capMax!==undefined||b.size!==2||b.capNormals?.length!==1)return null;
      const row=b.capNormals[0];if(!Array.isArray(row)||row.length!==2)throw Error('Invalid refinement pressure cone.');const [id,w]=row;
      if(!Number.isInteger(id)||id<0||id>=n||!(w>=0&&finite(w))||b.capScale!==undefined&&!(b.capScale>=0&&finite(b.capScale)))throw Error('Invalid refinement pressure cone.');if(used.has(id))return null;used.add(id);
    }
    if(covered.size!==k||modes.some(m=>m.normalJ.length!==n||m.tangentJ.length!==k||m.normalJ.some(v=>!finite(v))||m.tangentJ.some(v=>!finite(v))))throw Error('Invalid refinement coverage or actuator.');
    const copy=f=>({tangents:Array.from(f.tangents),normalForces:Array.from(f.normalForces)}),initial=copy(problem.initial??{tangents:Array(k).fill(0),normalForces:Array(n).fill(0)});
    if(initial.tangents.length!==k||initial.normalForces.length!==n||initial.tangents.some(v=>!finite(v))||initial.normalForces.some(v=>!finite(v)))throw Error('Invalid refinement initial forces.');
    let certificates=0,iterations=0,evaluations=0,maxSelectedUnknowns=0,maxSelectedTangents=0,maxSelectedNormals=0,maxJacobianEntries=0,reason='expansion-limit';const trace=[];
    const residual=q=>q?.payload?.maxResidual??Infinity,feasible=q=>q?.valid===true&&q.residualVector?.length===k+n&&Array.from(q.residualVector).every(finite)&&finite(residual(q))&&residual(q)>=0&&finite(q.feasibility)&&q.feasibility>=0&&q.feasibility<=cfg.forceTolerance;
    function certify(f){certificates++;return certificate(copy(f));}
    let candidate=copy(initial),final=certify(candidate),best={...copy(candidate),evaluation:final};
    function remember(f,q){if(feasible(q)&&(!feasible(best.evaluation)||residual(q)<residual(best.evaluation)))best={...copy(f),evaluation:q};}
    function result(){return {...copy(best),evaluation:best.evaluation,converged:feasible(best.evaluation)&&residual(best.evaluation)<=cfg.tolerance,reason:feasible(best.evaluation)&&residual(best.evaluation)<=cfg.tolerance?'converged':reason,iterations,evaluations,certificates,maxSelectedUnknowns,maxSelectedTangents,maxSelectedNormals,maxJacobianEntries,trace};}
    if(feasible(final)&&residual(final)<=cfg.tolerance)return result();
    if(!feasible(final)){reason='infeasible-initial';return result();}
    const ids=new Set();for(let i=0;i<n;i++)if(candidate.normalForces[i]>0||final.payload.gaps[i]<=cfg.gapWindow)ids.add(i);
    for(let expansion=0;expansion<cfg.maxExpansions;expansion++){
      const coordinates=[],selectedBlocks=[];for(const b of blocks)if(b.capNormals?.some(([id])=>ids.has(id))||candidate.tangents.slice(b.start,b.start+b.size).some(v=>v!==0)){
        const start=coordinates.length;for(let j=0;j<b.size;j++)coordinates.push(b.start+j);selectedBlocks.push({...b,start});
      }
      const unknowns=coordinates.length+ids.size,entries=(coordinates.length+n)*unknowns;maxSelectedUnknowns=Math.max(maxSelectedUnknowns,unknowns);maxSelectedTangents=Math.max(maxSelectedTangents,coordinates.length);maxSelectedNormals=Math.max(maxSelectedNormals,ids.size);maxJacobianEntries=Math.max(maxJacobianEntries,entries);
      // Guard the selected workspace, never truncate original normal residuals.
      if(unknowns>cfg.maxUnknowns||entries>cfg.maxJacobianEntries){reason='workspace-limit';trace.push({expansion,activeNormals:ids.size,tangentDOFs:coordinates.length,unknowns,jacobianEntries:entries,reason});break;}
      const model=VI.create({H:coordinates.map(i=>coordinates.map(j=>H[i][j])),C:C.map(row=>coordinates.map(i=>row[i])),linear:coordinates.map(i=>linear[i]),normal,blocks:selectedBlocks,modes:modes.map(m=>({...m,tangentJ:coordinates.map(i=>m.tangentJ[i])})),normalActive:[...ids].sort((a,b)=>a-b),tangentSearchScale:cfg.tangentSearchScale,normalSearch:cfg.normalSearch});
      const solved=Newton.solve({x:model.initial(coordinates.map(i=>candidate.tangents[i]),candidate.normalForces),evaluate:model.evaluate,jacobian:model.jacobian,tolerance:cfg.tolerance/Math.SQRT2*Math.min(1,cfg.tangentSearchScale),forceTolerance:cfg.forceTolerance,variableScale:1,residualScale:model.scales,maxIterations:cfg.maxIterations,maxEvaluations:cfg.maxEvaluations,maxStep:cfg.maxStep,includeFeasibilityInMerit:cfg.includeFeasibilityInMerit,acceptEvaluation:q=>q.payload.maxResidual<=cfg.tolerance});
      iterations+=solved.iterations;evaluations+=solved.evaluations;
      const local=model.certificate(solved.x),raw={tangents:Array(k).fill(0),normalForces:local.payload.normalForces};coordinates.forEach((id,j)=>raw.tangents[id]=local.payload.tangents[j]);
      const actual=certify(raw);remember(raw,actual);
      const polished={tangents:raw.tangents.slice(),normalForces:raw.normalForces.map(v=>Math.max(0,v))},caps=certify(polished).payload.caps;
      blocks.forEach((b,i)=>{const magnitude=Math.hypot(...polished.tangents.slice(b.start,b.start+b.size));if(magnitude>caps[i])for(let j=0;j<b.size;j++)polished.tangents[b.start+j]*=caps[i]/magnitude;});
      const checked=certify(polished);remember(polished,checked);
      if(feasible(checked)&&(residual(checked)<=cfg.tolerance||residual(checked)<residual(actual))){candidate=polished;final=checked;}else{candidate=raw;final=actual;}
      const missing=final.payload.gaps.flatMap((v,i)=>!ids.has(i)&&v<0?[i]:[]);
      trace.push({expansion,activeNormals:ids.size,tangentDOFs:coordinates.length,unknowns,jacobianEntries:entries,iterations:solved.iterations,evaluations:solved.evaluations,rank:solved.rank,reason:solved.reason,residual:residual(final),feasibility:final.feasibility,valid:final.valid,missing:missing.length});
      if(feasible(final)&&residual(final)<=cfg.tolerance){best={...copy(candidate),evaluation:final};break;}
      if(!missing.length){reason=solved.reason;break;}for(const id of missing)ids.add(id);
    }
    return result();
  }
  return {CONFIG,solve};
});
