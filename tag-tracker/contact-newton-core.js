// Numerical globalization for a caller-owned physical natural-VI map. No contact law lives here.
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();else root.ContactNewtonCore=factory();
})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  const finite=Number.isFinite,norm=v=>Math.hypot(...v),maxAbs=v=>v.reduce((s,x)=>Math.max(s,Math.abs(x)),0);
  function dot(a,b){let sum=0;for(let i=0;i<a.length;i++)sum+=a[i]*b[i];return sum;}
  function vector(value,n,label,otherwise){
    const v=value===undefined?Array(n).fill(otherwise):typeof value==='number'?Array(n).fill(value):Array.from(value);
    if(v.length!==n||v.some(x=>!(x>0&&finite(x))))throw Error('Invalid '+label+'.');return v;
  }
  // Householder QR with recomputed column norms: no normal equations or diagonal regularization.
  function columnNorm(A,start,j){
    let sum=0;for(let i=start;i<A.length;i++){const v=A[i][j];sum+=v*v;}
    if(sum>=1e-280&&finite(sum))return Math.sqrt(sum);
    // Rare extreme scales use a scaled sum, preserving tiny/huge finite columns.
    let largest=0;for(let i=start;i<A.length;i++)largest=Math.max(largest,Math.abs(A[i][j]));if(largest===0)return 0;
    sum=0;for(let i=start;i<A.length;i++){const v=A[i][j]/largest;sum+=v*v;}return largest*Math.sqrt(sum);
  }
  function qr(matrix,pivot,relativeTolerance){
    // Both callers supply fresh workspaces; do not copy those rows again.
    const A=matrix,m=A.length,n=A[0]?.length||0,permutation=Array.from({length:n},(_,i)=>i),reflectors=[];
    let scale=0;for(let j=0;j<n;j++)scale=Math.max(scale,columnNorm(A,0,j));
    const threshold=scale*relativeTolerance;let rank=0;
    for(let k=0;k<Math.min(m,n);k++){
      let best=k,bestNorm=-1;
      if(pivot)for(let j=k;j<n;j++){const s=columnNorm(A,k,j);if(s>bestNorm){bestNorm=s;best=j;}}
      if(best!==k){for(let i=0;i<m;i++)[A[i][k],A[i][best]]=[A[i][best],A[i][k]];[permutation[k],permutation[best]]=[permutation[best],permutation[k]];}
      const magnitude=columnNorm(A,k,k);
      if(!(magnitude>threshold))break;
      const alpha=A[k][k]>=0?-magnitude:magnitude,v=Array.from({length:m-k},(_,i)=>A[k+i][k]);v[0]-=alpha;
      const vn=norm(v);for(let i=0;i<v.length;i++)v[i]/=vn;
      for(let j=k;j<n;j++){let projection=0;for(let i=k;i<m;i++)projection+=v[i-k]*A[i][j];for(let i=k;i<m;i++)A[i][j]-=2*v[i-k]*projection;}
      A[k][k]=alpha;for(let i=k+1;i<m;i++)A[i][k]=0;
      reflectors.push({k,v});rank++;
    }
    return {A,permutation,reflectors,rank};
  }
  function reflect(v,reflectors,reverse=false){
    const out=Array.from(v),order=reverse?reflectors.slice().reverse():reflectors;
    for(const {k,v:r}of order){let projection=0;for(let i=0;i<r.length;i++)projection+=r[i]*out[k+i];for(let i=0;i<r.length;i++)out[k+i]-=2*r[i]*projection;}return out;
  }
  // Complete orthogonal decomposition gives the least-norm numerical-range solution,
  // including rectangular/redundant systems. All original residual rows remain in the check.
  function leastSquares(matrix,rhs,{rankTolerance}={}){
    const m=matrix.length,n=matrix[0]?.length||0,b=Array.from(rhs),tol=rankTolerance??64*Number.EPSILON*Math.max(1,m,n);
    if(!(tol>0&&tol<1&&finite(tol))||b.length!==m||b.some(x=>!finite(x)))throw Error('Invalid least-squares system.');
    // Identically zero rows/columns add no information to the factorization.
    // Keep the original rank threshold and every residual in the final check;
    // an omitted constant inconsistent row must still reject convergence.
    const rows=[],right=[],active=[];
    for(let i=0;i<m;i++){const row=matrix[i];if(row.length!==n)throw Error('Invalid least-squares system.');let nonzero=false;for(let j=0;j<n;j++){if(!finite(row[j]))throw Error('Invalid least-squares system.');if(row[j]!==0)nonzero=true;}if(nonzero){rows.push(row);right.push(b[i]);}}
    for(let j=0;j<n;j++)for(let i=0;i<rows.length;i++)if(rows[i][j]!==0){active.push(j);break;}
    const width=active.length,first=qr(rows.map(row=>active.map(j=>row[j])),true,tol),r=first.rank,x=Array(n).fill(0);
    if(r){
      const y=reflect(right,first.reflectors).slice(0,r);let z;
      if(r===width){
        // Full column rank has one LS solution; the second QR is unnecessary.
        z=Array(width).fill(0);for(let i=width-1;i>=0;i--){let v=y[i];for(let j=i+1;j<width;j++)v-=first.A[i][j]*z[j];z[i]=v/first.A[i][i];}
      }else{
        const transpose=Array.from({length:width},(_,j)=>Array.from({length:r},(_,i)=>first.A[i][j])),second=qr(transpose,false,0),w=Array(r).fill(0);
        for(let i=0;i<r;i++){let v=y[i];for(let j=0;j<i;j++)v-=second.A[j][i]*w[j];w[i]=v/second.A[i][i];}
        z=reflect(w.concat(Array(width-r).fill(0)),second.reflectors,true);
      }
      for(let j=0;j<width;j++)x[active[first.permutation[j]]]=z[j];
    }
    const residual=matrix.map((row,i)=>dot(row,x)-b[i]);return {x,rank:r,residual,residualNorm:norm(residual)};
  }
  /**
   * evaluate(x) must deterministically rebuild ONE common physical state from the same
   * free pose/warm seed. Return {residualVector (metres), feasibility (newtons), valid,
   * payload}. Calls include rejected/finite-difference trials; never inherit their state.
   * jacobian(x,evaluation), if supplied, returns d(residualVector)/dx in metres/newton.
   * includeFeasibilityInMerit:false searches the natural VI alone; it never disables
   * the separate force-feasibility acceptance gate. Scales and step clipping affect
   * numerical search only. Acceptance always uses the
   * unscaled residual and force gates, followed by a fresh evaluation of the accepted x.
   * acceptEvaluation(raw), if supplied, replaces ONLY the search residual gate
   * with a caller's canonical-residual test; valid/finite/force/fresh gates remain.
   */
  function solve(options){
    const {evaluate,jacobian,acceptEvaluation}=options,x0=Array.from(options.x||[]),n=x0.length,tolerance=options.tolerance??3e-7,forceTolerance=options.forceTolerance??1e-9,maxIterations=options.maxIterations??16,maxEvaluations=options.maxEvaluations??Math.max(64,8*n+64),maxBacktracks=options.maxBacktracks??20,maxStep=options.maxStep??8,includeFeasibilityInMerit=options.includeFeasibilityInMerit!==false;
    if(typeof evaluate!=='function'||acceptEvaluation!==undefined&&typeof acceptEvaluation!=='function'||x0.some(x=>!finite(x))||!(tolerance>0&&finite(tolerance))||!(forceTolerance>=0&&finite(forceTolerance))||!Number.isInteger(maxIterations)||maxIterations<0||!Number.isInteger(maxEvaluations)||maxEvaluations<1||!Number.isInteger(maxBacktracks)||maxBacktracks<1||!(maxStep>0))throw Error('Invalid Newton options.');
    const variableScale=vector(options.variableScale,n,'variable scale',1),differenceStep=vector(options.differenceStep,n,'difference step',1e-4).map((v,i)=>options.differenceStep===undefined?v*variableScale[i]:v),feasibilityScale=options.feasibilityScale??Math.max(1,...variableScale);
    if(!(feasibilityScale>0&&finite(feasibilityScale)))throw Error('Invalid feasibility scale.');
    let evaluations=0,iterations=0,jacobianEvaluations=0,lineSearchEvaluations=0,rank=0,residualSize=null,residualScale=null,current=null,x=x0.slice(),reason='iteration-limit';
    function sample(at){
      if(evaluations>=maxEvaluations)return null;evaluations++;
      const raw=evaluate(at.slice());
      if(!raw||!raw.residualVector)return {valid:false,finite:false,residual:Infinity,feasibility:Infinity,merit:Infinity,raw};
      const residualVector=Array.from(raw.residualVector),feasibility=raw.feasibility??0,isFinite=residualVector.every(finite)&&finite(feasibility)&&feasibility>=0;
      if(residualSize===null){residualSize=residualVector.length;residualScale=vector(options.residualScale,residualSize,'residual scale',tolerance);}
      if(residualVector.length!==residualSize)throw Error('Newton residual dimension changed.');
      const scaled=residualVector.map((v,i)=>v/residualScale[i]),valid=raw.valid!==false&&isFinite,merit=valid?.5*(dot(scaled,scaled)+(includeFeasibilityInMerit?(feasibility/feasibilityScale)**2:0)):Infinity;
      return {raw,residualVector,feasibility,scaled,valid,finite:isFinite,residual:maxAbs(residualVector),merit};
    }
    const accepted=s=>s&&s.valid&&s.feasibility<=forceTolerance&&(acceptEvaluation?acceptEvaluation(s.raw)===true:s.residual<=tolerance);
    function result(converged,why){return {x:x.slice(),evaluation:current?.raw,converged,reason:why,iterations,evaluations,jacobianEvaluations,lineSearchEvaluations,rank,residual:current?.residual??Infinity,feasibility:current?.feasibility??Infinity};}
    function verify(){const check=sample(x);if(!check)return result(false,'evaluation-limit');current=check;const okay=accepted(check);return result(okay,okay?'converged':check.valid?'verification-failed':'invalid-verification');}
    current=sample(x);if(!current.valid)return result(false,current.finite?'invalid-initial-state':'nonfinite-evaluation');
    for(;iterations<maxIterations;iterations++){
      if(accepted(current))return verify();
      let J,feasibilityGradient=Array(n).fill(0),derivativeValid=true;
      if(jacobian){
        const physical=jacobian(x.slice(),current.raw);jacobianEvaluations++;
        if(!physical||physical.length!==residualSize)return result(false,'invalid-jacobian');J=Array(residualSize);
        for(let i=0;i<residualSize;i++){const row=physical[i];if(!row||row.length!==n)return result(false,'invalid-jacobian');const out=J[i]=Array(n);for(let j=0;j<n;j++){const value=row[j];if(!finite(value))return result(false,'invalid-jacobian');out[j]=value*variableScale[j]/residualScale[i];}}
      }else J=Array.from({length:residualSize},()=>Array(n).fill(0));
      // Central differences remain deterministic at active-set changes. At an invalid
      // trial use a one-sided derivative; no invalid state supplies a physical Jacobian.
      if(!jacobian||includeFeasibilityInMerit&&current.feasibility>forceTolerance)for(let j=0;j<n;j++){
        let plus=null,minus=null,h=differenceStep[j]*Math.max(1,Math.abs(x[j])/variableScale[j]);
        for(let attempt=0;attempt<4;attempt++){
          const xp=x.slice(),xm=x.slice();xp[j]+=h;xm[j]-=h;plus=sample(xp);minus=sample(xm);
          if(!plus||!minus)return result(false,'evaluation-limit');
          if(plus.valid||minus.valid)break;h*=.25;
        }
        if(!plus.valid&&!minus.valid){derivativeValid=false;break;}
        const a=plus.valid?plus:current,b=minus.valid?minus:current,den=plus.valid&&minus.valid?2*h:h;
        if(!jacobian)for(let i=0;i<residualSize;i++)J[i][j]=(a.scaled[i]-b.scaled[i])*variableScale[j]/den;
        if(includeFeasibilityInMerit)feasibilityGradient[j]=(a.feasibility-b.feasibility)*variableScale[j]/(den*feasibilityScale);
      }
      if(!derivativeValid)return result(false,'invalid-derivative');
      if(J.some(row=>row.some(v=>!finite(v)))||feasibilityGradient.some(v=>!finite(v)))return result(false,'nonfinite-jacobian');
      const augmented=includeFeasibilityInMerit?J.concat([feasibilityGradient]):J,r=includeFeasibilityInMerit?current.scaled.concat([current.feasibility/feasibilityScale]):current.scaled,linear=leastSquares(augmented,r.map(v=>-v),{rankTolerance:options.rankTolerance});rank=linear.rank;jacobianEvaluations+=jacobian?0:1;
      if(linear.x.some(v=>!finite(v)))return result(false,'nonfinite-step');
      const gradient=Array(n);for(let j=0;j<n;j++){let value=0;for(let i=0;i<augmented.length;i++)value+=augmented[i][j]*r[i];gradient[j]=value;}
      const directions=[linear.x],gradientNorm=norm(gradient);
      if(gradientNorm>0)directions.push(gradient.map(v=>-v/gradientNorm*Math.min(1,maxStep)));
      let next=null,nextX=null;
      for(const direction of directions){
        const size=norm(direction);if(!(size>0))continue;const factor=Math.min(1,maxStep/size),step=direction.map(v=>factor*v),slope=dot(gradient,step);
        if(!(slope<0))continue;
        for(let backtrack=0,alpha=1;backtrack<maxBacktracks;backtrack++,alpha*=.5){
          const trialX=x.map((v,j)=>v+alpha*step[j]*variableScale[j]);if(trialX.every((v,j)=>v===x[j]))break;
          const trial=sample(trialX);lineSearchEvaluations++;if(!trial)return result(false,'evaluation-limit');
          if(trial.valid&&(accepted(trial)||trial.merit<=current.merit+1e-4*alpha*slope)){next=trial;nextX=trialX;break;}
        }
        if(next)break;
      }
      if(!next){reason=rank?'line-search-failed':'rank-zero';break;}
      x=nextX;current=next;
    }
    if(accepted(current))return verify();return result(false,reason);
  }
  return {solve,leastSquares};
});
