// Ordinary Coulomb contacts: exact local three-force solves with matrix-free normal columns.
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();else root.ContactNGSCore=factory();
})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  const finite=Number.isFinite,norm=v=>Math.hypot(...v);
  function solve(problem){
    const {H,C,linear,normal,blocks,certificate,normalBlock}=problem,k=H.length,n=normal.size,tolerance=problem.tolerance??3e-7,forceTolerance=problem.forceTolerance??1e-9,maxSweeps=problem.maxSweeps??500,checkEvery=problem.checkEvery??10,maxCachedColumns=problem.maxCachedColumns??64,normalBlockEvery=problem.normalBlockEvery??10;
    if(!Number.isInteger(n)||n<0||typeof normal.apply!=='function'||typeof normal.column!=='function'||typeof certificate!=='function'||normalBlock!==undefined&&typeof normalBlock!=='function'||normal.base.length!==n||normal.diagonal.length!==n||normal.base.some(v=>!finite(v))||normal.diagonal.some(v=>!(v>0&&finite(v)))||H.some(row=>row.length!==k||row.some(v=>!finite(v)))||C.length!==n||C.some(row=>row.length!==k||row.some(v=>!finite(v)))||linear.length!==k||linear.some(v=>!finite(v))||!Array.isArray(blocks)||!(tolerance>0&&finite(tolerance))||!(forceTolerance>=0&&finite(forceTolerance))||![maxSweeps,checkEvery,maxCachedColumns,normalBlockEvery].every(Number.isInteger)||maxSweeps<0||checkEvery<1||maxCachedColumns<1||normalBlockEvery<1)throw Error('Invalid local Coulomb system.');
    const covered=new Set(),used=new Set(),pairs=[],zeros=[];
    for(const block of blocks){
      const {start,size}=block;if(!Number.isInteger(start)||!Number.isInteger(size)||size<1||start<0||start+size>k)throw Error('Invalid local tangent block.');
      for(let j=start;j<start+size;j++){if(covered.has(j))throw Error('Overlapping local tangent blocks.');covered.add(j);}
      if(block.capFixed===0){if(block.capNormals!==undefined||block.capSides!==undefined)return null;for(let j=start;j<start+size;j++)zeros.push(j);continue;}
      if(block.capFixed!==undefined||block.capSides!==undefined||block.capMax!==undefined||size!==2||block.capNormals?.length!==1)return null;
      const row=block.capNormals[0];if(!Array.isArray(row)||row.length!==2||!Number.isInteger(row[0])||row[0]<0||row[0]>=n||!(row[1]>=0&&finite(row[1]))||block.capScale!==undefined&&!(block.capScale>=0&&finite(block.capScale)))throw Error('Invalid local pressure cone.');
      const [id,w]=row,mu=block.enabled===false?0:w*(block.capScale??1);if(!finite(mu))throw Error('Invalid local friction coefficient.');if(used.has(id))return null;used.add(id);pairs.push({id,start,mu,metric:block.metric});
    }
    if(covered.size!==k)throw Error('Local tangent blocks must cover every tangent coordinate.');
    const tangents=Array.from(problem.initial?.tangents??Array(k).fill(0)),lambda=Array.from(problem.initial?.normalForces??Array(n).fill(0));
    if(tangents.length!==k||lambda.length!==n||tangents.some(v=>!finite(v))||lambda.some(v=>!finite(v)))throw Error('Invalid local initial forces.');
    // Numerical warm guesses are made feasible before any iteration/certificate.
    for(let i=0;i<n;i++)lambda[i]=Math.max(0,lambda[i]);for(const j of zeros)tangents[j]=0;
    for(const pair of pairs){const f=tangents.slice(pair.start,pair.start+2),r=norm(f),cap=pair.mu*lambda[pair.id];if(r>cap)for(let j=0;j<2;j++)tangents[pair.start+j]*=cap/r;}
    const gt=new Float64Array(k),gap=new Float64Array(n),cache=new Map(),scalars=Array.from({length:n},(_,i)=>i).filter(i=>!used.has(i));
    const residualPrecheckEnabled=problem.residualPrecheck===true&&pairs.every(pair=>pair.metric>0&&finite(pair.metric));
    let applications=0,columnApplications=0,certificates=0,localSolves=0,schurSolves=0,sweeps=0,evaluation=null,reason='sweep-limit',normalBlocks=0,normalBlockAttempts=0,normalBlockApplications=0,skippedCertificates=0;
    function column(id){
      if(cache.has(id)){const v=cache.get(id);cache.delete(id);cache.set(id,v);return v;}
      const out=new Float64Array(n),value=normal.column(id,out)||out;columnApplications++;
      if(value.length!==n||Array.from(value).some(v=>!finite(v)))throw Error('Invalid local normal column.');
      const v=Float64Array.from(value);if(cache.size>=maxCachedColumns)cache.delete(cache.keys().next().value);cache.set(id,v);return v;
    }
    function rebuild(){
      const out=new Float64Array(n),value=normal.apply(lambda,out)||out;applications++;
      if(value.length!==n||Array.from(value).some(v=>!finite(v)))throw Error('Invalid local normal response.');
      for(let i=0;i<n;i++){let s=value[i]+normal.base[i];for(let j=0;j<k;j++)s+=C[i][j]*tangents[j];gap[i]=s;}
      for(let i=0;i<k;i++){let s=linear[i];for(let j=0;j<k;j++)s+=H[i][j]*tangents[j];for(let j=0;j<n;j++)s+=C[j][i]*lambda[j];gt[i]=s;}
    }
    function normalUpdate(id,value){const delta=value-lambda[id];if(delta===0)return;lambda[id]=value;const col=column(id);for(let i=0;i<n;i++)gap[i]+=col[i]*delta;for(let i=0;i<k;i++)gt[i]+=C[id][i]*delta;}
    function tangentUpdate(at,value){const delta=value-tangents[at];if(delta===0)return;tangents[at]=value;for(let i=0;i<k;i++)gt[i]+=H[i][at]*delta;for(let i=0;i<n;i++)gap[i]+=C[i][at]*delta;}
    function local(pair){
      localSolves++;const {id,start:i,mu}=pair,j=i+1,a=normal.diagonal[id],u=C[id][i],v=C[id][j],B00=H[i][i],B01=H[i][j],B11=H[j][j],qn=gap[id]-a*lambda[id]-u*tangents[i]-v*tangents[j],q0=gt[i]-u*lambda[id]-B00*tangents[i]-B01*tangents[j],q1=gt[j]-v*lambda[id]-B01*tangents[i]-B11*tangents[j];
      if(qn>=0)return [0,0,0];if(mu===0)return [-qn/a,0,0];
      const A00=B00-u*u/a,A01=B01-u*v/a,A11=B11-v*v/a,b0=q0-u*qn/a,b1=q1-v*qn/a;
      function at(gamma){
        schurSolves++;const a0=A00+gamma,den=A11+gamma-A01*A01/a0;if(!(a0>0&&den>0))return null;
        const f1=(-b1+A01*b0/a0)/den,f0=(-b0-A01*f1)/a0,fn=-(qn+u*f0+v*f1)/a,force=[fn,f0,f1];if(force.some(v=>!finite(v)))return null;return {force,h:Math.hypot(f0,f1)-mu*fn};
      }
      let q=at(0);if(!q){reason='non-positive-local-mobility';return null;}if(q.force[0]>=0&&q.h<=0)return q.force;
      let lo=0,hi=Math.max(A00,A11,1e-12);q=at(hi);for(let iteration=0;q&&q.h>0&&iteration<80;iteration++){lo=hi;hi*=2;q=at(hi);}
      if(!q||q.h>0){reason='local-root-not-bracketed';return null;}
      // The feasible bracket endpoint, never a late force clamp, defines sliding.
      for(let iteration=0;iteration<60;iteration++){const middle=(lo+hi)/2,candidate=at(middle);if(!candidate){reason='nonfinite-local-root';return null;}if(candidate.h>0)lo=middle;else{hi=middle;q=candidate;}}
      return q.force;
    }
    function incrementalResidual(){
      let error=0;for(let i=0;i<n;i++)error=Math.max(error,Math.abs(Math.min(normal.diagonal[i]*lambda[i],gap[i])));
      for(const {id,start,mu,metric:L}of pairs){const a=L*tangents[start],b=L*tangents[start+1],x=a-gt[start],y=b-gt[start+1],r=Math.hypot(x,y),radius=L*mu*lambda[id];
        if(r<=radius)error=Math.max(error,Math.hypot(gt[start],gt[start+1]));else{const scale=radius/r;error=Math.max(error,Math.hypot(a-scale*x,b-scale*y));}
      }
      return error;
    }
    function certify(force=false){
      // This only skips expensive probes. It can never accept a force state;
      // a cushion tolerates incremental roundoff, and the final probe is mandatory.
      if(residualPrecheckEnabled&&!force){const error=incrementalResidual();if(!finite(error)||error>2*tolerance){skippedCertificates++;return false;}}
      evaluation=certificate({tangents:tangents.slice(),normalForces:lambda.slice()});certificates++;const r=evaluation?.residualVector,error=evaluation?.payload?.maxResidual??(r?Math.max(0,...r.map(Math.abs)):Infinity);return evaluation?.valid!==false&&r&&Array.from(r).every(finite)&&finite(error)&&error<=tolerance&&finite(evaluation.feasibility)&&evaluation.feasibility>=0&&evaluation.feasibility<=forceTolerance;
    }
    function result(converged){return {tangents:tangents.slice(),normalForces:lambda.slice(),evaluation,converged,reason:converged?'converged':reason,sweeps,applications,columnApplications,certificates,localSolves,schurSolves,cachedColumns:cache.size,normalRows:n,tangentDOFs:k,normalBlocks,normalBlockAttempts,normalBlockApplications,residualPrecheckEnabled,skippedCertificates};}
    rebuild();if(certify(maxSweeps===0))return result(true);
    for(sweeps=1;sweeps<=maxSweeps;sweeps++){
      if(normalBlock&&sweeps%normalBlockEvery===0){
        normalBlockAttempts++;const proposal=normalBlock({tangents:tangents.slice(),normalForces:lambda.slice()});
        if(proposal?.converged===true&&proposal.normalForces?.length===n){
          const values=Array.from(proposal.normalForces);
          if(values.every(v=>v>=0&&finite(v))){
            // This is a numerical trial. Joint local solves restore every cone
            // before certification; no intermediate pressure is physical output.
            for(let i=0;i<n;i++)lambda[i]=values[i];normalBlocks++;
            if(proposal.applications>=0&&finite(proposal.applications))normalBlockApplications+=proposal.applications;
            rebuild();
          }
        }
      }
      for(const pair of pairs){const f=local(pair);if(!f){certify(true);return result(false);}normalUpdate(pair.id,f[0]);tangentUpdate(pair.start,f[1]);tangentUpdate(pair.start+1,f[2]);}
      for(const id of scalars)normalUpdate(id,Math.max(0,lambda[id]-gap[id]/normal.diagonal[id]));
      if(sweeps%64===0)rebuild();
      if((sweeps%checkEvery===0||sweeps===maxSweeps)&&certify(sweeps===maxSweeps))return result(true);
    }
    sweeps=maxSweeps;return result(false);
  }
  return {solve};
});
