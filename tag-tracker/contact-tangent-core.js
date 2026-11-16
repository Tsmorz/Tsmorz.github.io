// Fixed-pressure convex tangent QP. ADMM penalties are numerical, never physical compliance.
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./contact-newton-core.js'));else root.ContactTangentCore=factory(root.ContactNewtonCore);
})(typeof self!=='undefined'?self:this,function(Newton){
  'use strict';
  const finite=Number.isFinite,norm=v=>Math.hypot(...v),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
  // H is supplied positive semidefinite. Factoring H+rho I is an ADMM step,
  // not a modification of the objective or of its final canonical KKT test.
  function factor(A,rho){
    const n=A.length,L=Array.from({length:n},()=>Array(n).fill(0));for(let i=0;i<n;i++)for(let j=0;j<=i;j++){let a=A[i][j]+(i===j?rho:0);for(let k=0;k<j;k++)a-=L[i][k]*L[j][k];if(i===j){if(!(a>0&&finite(a)))return null;L[i][j]=Math.sqrt(a);}else L[i][j]=a/L[j][j];}return L;
  }
  function inverse(L,b){
    const n=b.length,y=Array(n).fill(0),x=Array(n).fill(0);for(let i=0;i<n;i++){let a=b[i];for(let j=0;j<i;j++)a-=L[i][j]*y[j];y[i]=a/L[i][i];}for(let i=n-1;i>=0;i--){let a=y[i];for(let j=i+1;j<n;j++)a-=L[j][i]*x[j];x[i]=a/L[i][i];}return x;
  }
  function solve({H,linear,blocks,caps,initial,tolerance=3e-8,forceTolerance=1e-9,maxIterations=1000,checkEvery=10,rho:initialRho}){
    const k=H.length;if(linear.length!==k||linear.some(v=>!finite(v))||H.some(row=>row.length!==k||row.some(v=>!finite(v)))||!Array.isArray(blocks)||caps.length!==blocks.length||caps.some(v=>!(v>=0&&(finite(v)||v===Infinity)))||!(tolerance>0&&finite(tolerance))||!(forceTolerance>=0&&finite(forceTolerance))||!Number.isInteger(maxIterations)||maxIterations<0||!Number.isInteger(checkEvery)||checkEvery<1||initialRho!==undefined&&!(initialRho>0&&finite(initialRho)))throw Error('Invalid fixed-pressure tangent QP.');
    for(let i=0;i<k;i++){if(H[i][i]<0)throw Error('Tangent QP requires positive semidefinite mobility.');for(let j=0;j<i;j++)if(Math.abs(H[i][j]-H[j][i])>64*Number.EPSILON*Math.max(1,Math.abs(H[i][j]),Math.abs(H[j][i])))throw Error('Tangent mobility must be symmetric.');}
    const covered=new Set(),coordinates=[],groups=[];
    blocks.forEach((block,id)=>{const {start,size,metric}=block;if(!Number.isInteger(start)||!Number.isInteger(size)||size<1||size>3||start<0||start+size>k||!(metric>0&&finite(metric)))throw Error('Invalid fixed tangent block.');for(let j=start;j<start+size;j++){if(covered.has(j))throw Error('Overlapping fixed tangent blocks.');covered.add(j);}if(caps[id]>0){const offset=coordinates.length;for(let j=start;j<start+size;j++)coordinates.push(j);groups.push({offset,size,metric,cap:caps[id]});}});
    if(covered.size!==k)throw Error('Fixed tangent blocks must cover every coordinate.');
    const guess=Array.from(initial??Array(k).fill(0));if(guess.length!==k||guess.some(v=>!finite(v)))throw Error('Invalid tangent QP initial forces.');
    const m=coordinates.length,A=coordinates.map(i=>coordinates.map(j=>H[i][j])),b=coordinates.map(i=>linear[i]);let z=coordinates.map(i=>guess[i]),u=Array(m).fill(0),iterations=0,factorizations=0,rho=initialRho??Math.max(0,...A.map((row,i)=>row[i]),...groups.map(group=>group.metric))*1e-6,reason='iteration-limit',method='admm';
    function project(values){const out=values.slice();for(const group of groups){const f=out.slice(group.offset,group.offset+group.size),r=norm(f);if(r>group.cap)for(let j=0;j<group.size;j++)out[group.offset+j]*=group.cap/r;}return out;}
    function certificate(values){
      const g=A.map((row,i)=>dot(row,values)+b[i]);let residual=0,feasibility=0;
      for(const {offset,size,metric:L,cap}of groups){const f=values.slice(offset,offset+size),trial=f.map((v,j)=>L*v-g[offset+j]),r=norm(trial);let error;
        // Inside the disk R=g exactly. Subtracting Lf-(Lf-g) can erase a
        // nonzero gradient when an unbounded iterate grows beyond its ulp.
        if(r<=L*cap)error=norm(g.slice(offset,offset+size));else{const ratio=L*cap/r;error=norm(f.map((v,j)=>L*v-ratio*trial[j]));}
        residual=Math.max(residual,error);feasibility=Math.max(feasibility,norm(f)-cap);
      }
      return {residual,feasibility,valid:values.every(finite)&&g.every(finite)&&finite(residual)&&finite(feasibility)};
    }
    function result(converged,q){const tangents=Array(k).fill(0);coordinates.forEach((id,j)=>tangents[id]=z[j]);return {tangents,converged,reason:converged?'converged':reason,residual:q.residual,feasibility:q.feasibility,iterations,rho,factorizations,activeDOFs:m,method};}
    const accepted=q=>q.valid&&q.residual<=tolerance&&q.feasibility<=forceTolerance;
    z=project(z);let q=certificate(z);if(accepted(q))return result(true,q);if(!m)return result(false,q);
    // A feasible minimum-norm stick solution avoids splitting entirely.
    const stick=Newton.leastSquares(A,b.map(v=>-v));if(stick.x.every(finite)){const trial=project(stick.x),checked=certificate(trial);if(accepted(checked)){z=trial;method='stick';return result(true,checked);}}
    if(!(rho>0&&finite(rho))){reason='invalid-numerical-penalty';return result(false,q);}let L=factor(A,rho);factorizations++;if(!L){reason='non-positive-qp-subproblem';return result(false,q);}
    for(iterations=1;iterations<=maxIterations;iterations++){
      const x=inverse(L,z.map((v,i)=>rho*(v-u[i])-b[i])),old=z;if(x.some(v=>!finite(v))){reason='nonfinite-numerical-step';iterations--;return result(false,q);}z=project(x.map((v,i)=>v+u[i]));u=u.map((v,i)=>v+x[i]-z[i]);
      if(iterations%checkEvery===0||iterations===maxIterations){q=certificate(z);if(accepted(q))return result(true,q);
        const primal=norm(x.map((v,i)=>v-z[i])),dual=rho*norm(z.map((v,i)=>v-old[i]));let next=rho;if(primal>10*dual)next=Math.min(rho*2,.1);else if(dual>10*primal)next=Math.max(rho/2,1e-14);
        if(next!==rho){u=u.map(v=>v*rho/next);rho=next;L=factor(A,rho);factorizations++;if(!L){reason='non-positive-qp-subproblem';return result(false,q);}}
      }
    }
    iterations=maxIterations;q=certificate(z);return result(false,q);
  }
  // A converged fixed-lambda QP is only a numerical proposal. A joint solve and
  // ORIGINAL full normal/Coulomb/actuator certificate are required before use.
  return {solve};
});
