// Pure numerical VI checks; no garment trajectories or physical contact-law changes.
module.exports=function({check}){
  const N=require('../../tag-tracker/contact-newton-core'),near=(a,b,t=1e-10)=>Math.abs(a-b)<=t,norm=v=>Math.hypot(...v),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),close=(a,b,t=1e-10)=>norm(a.map((v,i)=>v-b[i]))<=t;
  const cases=[
    {A:[[1,1]],b:[1],x:[.5,.5],rank:1},
    {A:[[1,2],[2,4]],b:[1,2],x:[.2,.4],rank:1},
    {A:[[1,2],[2,4]],b:[1,1],x:[.12,.24],rank:1},
    {A:[[1,1,0],[0,1,1]],b:[1,1],x:[1/3,2/3,1/3],rank:2},
    {A:[[0,2],[1,3]],b:[4,7],x:[1,2],rank:2}
  ];
  check(cases.every(({A,b,x,rank})=>{const q=N.leastSquares(A,b);return q.rank===rank&&close(q.x,x)&&A[0].every((_,j)=>Math.abs(A.reduce((s,row,i)=>s+row[j]*q.residual[i],0))<1e-12);}),
    'complete orthogonal decomposition returns minimum-norm consistent and inconsistent least-squares solutions with column pivoting');
  const ill=[[1,1],[1,1+1e-9]],illRhs=[1,1+.7e-9],illAnswer=N.leastSquares(ill,illRhs),A=cases[3].A,b=cases[3].b,A0=JSON.stringify(A),b0=JSON.stringify(b);
  N.leastSquares(A,b);
  check(illAnswer.rank===2&&close(illAnswer.x,[.3,.7],1e-6)&&JSON.stringify(A)===A0&&JSON.stringify(b)===b0,
    'a real ill-conditioned independent mode survives without normal equations or input mutation');
  const tall=N.leastSquares([[1,0],[0,1],[1,1]],[1,2,4]),extreme=[1e-200,1e200].map(scale=>N.leastSquares([[scale,0],[0,2*scale]],[.3*scale,.8*scale]));
  check(tall.rank===2&&close(tall.x,[4/3,7/3],1e-13)&&extreme.every(q=>q.rank===2&&close(q.x,[.3,.4],1e-13)),
    'full-rank triangular least squares preserves inconsistent tall systems and finite columns whose squares overflow or underflow');
  const sparse=N.leastSquares([[0,0,0,0],[0,1,0,1],[0,2,0,2],[0,0,0,0]],[3,1,2,-4]),zero=N.leastSquares([[0,0],[0,0]],[1,-2]),emptyColumns=N.leastSquares([[],[]],[1,-2]);
  check(sparse.rank===1&&close(sparse.x,[0,.5,0,.5])&&close(sparse.residual,[-3,0,0,4])&&near(sparse.residualNorm,5)&&zero.rank===0&&close(zero.x,[0,0])&&close(zero.residual,[-1,2])&&emptyColumns.rank===0&&emptyColumns.x.length===0&&close(emptyColumns.residual,[-1,2]),
    'zero-only factor workspace rows and columns preserve minimum force norm and every inconsistent original residual');
  const padded=Array.from({length:1000},(_,i)=>i===17?[1,0]:i===823?[0,1e-12]:[0,0]),rankGuard=N.leastSquares(padded,padded.map(row=>row[0]+row[1]));
  check(rankGuard.rank===1&&close(rankGuard.x,[1,0])&&Math.abs(rankGuard.residual[823]+1e-12)<1e-25,
    'workspace compaction keeps the original full-dimension numerical rank policy instead of silently admitting a weak discarded mode');
  const redundant=N.solve({x:[0,0],evaluate:x=>({residualVector:[x[0]+x[1]-1,2*(x[0]+x[1]-1)],feasibility:0}),tolerance:1e-11,residualScale:1,differenceStep:1e-4});
  check(redundant.converged&&redundant.rank===1&&close(redundant.x,[.5,.5],1e-10)&&redundant.residual<=1e-11,
    'redundant traction rows remain present and converge through a minimum-norm Newton step');
  const nonlinear=N.solve({x:[.1],evaluate:x=>({residualVector:[x[0]*x[0]-1],feasibility:0}),tolerance:1e-11,residualScale:1,differenceStep:1e-5});
  check(nonlinear.converged&&near(nonlinear.x[0],1,1e-10)&&nonlinear.lineSearchEvaluations>nonlinear.iterations,
    'residual-merit globalization damps an overshooting nonlinear step and verifies its final physical residual');
  function friction(f,M,e,cap,L){const g=M.map((row,i)=>dot(row,f)-e[i]),q=f.map((v,i)=>L*v-g[i]),r=norm(q),projection=q.map(v=>v*Math.min(1,L*cap/(r||1)));return f.map((v,i)=>L*v-projection[i]);}
  function ballSolve(M,e,cap){
    const inv=eta=>{const a=M[0][0]+eta,b=M[0][1],c=M[1][1]+eta,det=a*c-b*b;return [(c*e[0]-b*e[1])/det,(a*e[1]-b*e[0])/det];};
    let lo=0,hi=1;if(norm(inv(0))<=cap)return inv(0);while(norm(inv(hi))>cap)hi*=2;
    for(let i=0;i<90;i++){const mid=(lo+hi)/2;if(norm(inv(mid))>cap)lo=mid;else hi=mid;}return inv(hi);
  }
  const blocks=[{M:[[.4,.1],[.1,.8]],e:[.1,-.05],cap:1,L:.8},{M:[[.3,.07],[.07,.6]],e:[1,.4],cap:.2,L:.7}],expected=blocks.flatMap(p=>ballSolve(p.M,p.e,p.cap)),mixed=N.solve({x:[0,0,0,0],evaluate:x=>({residualVector:blocks.flatMap((p,i)=>friction(x.slice(2*i,2*i+2),p.M,p.e,p.cap,p.L)),feasibility:Math.max(0,...blocks.map((p,i)=>norm(x.slice(2*i,2*i+2))-p.cap))}),variableScale:1,residualScale:1,tolerance:1e-11,differenceStep:1e-5,maxEvaluations:300});
  check(mixed.converged&&close(mixed.x,expected,1e-9)&&norm(mixed.x.slice(0,2))<1&&near(norm(mixed.x.slice(2)),.2,1e-10),
    'one full natural-VI map solves simultaneous anisotropic interior-stick and Coulomb-slip blocks');
  const variablePressure=N.solve({x:[0,0],evaluate:x=>{const pressure=Math.max(0,1-.2*x[0]),cap=.5*pressure;return {residualVector:friction(x,[[.4,.05],[.05,.8]],[1,.3],cap,.85),feasibility:Math.max(0,norm(x)-cap)};},tolerance:1e-11,residualScale:1,differenceStep:1e-5,maxEvaluations:250}),vp=variablePressure.x,cap=.5*Math.max(0,1-.2*vp[0]),g=[.4*vp[0]+.05*vp[1]-1,.05*vp[0]+.8*vp[1]-.3];
  check(variablePressure.converged&&near(norm(vp),cap,1e-10)&&dot(g,vp)<0&&Math.abs(g[0]*vp[1]-g[1]*vp[0])<1e-10,
    'Newton differences include changing pressure-derived Coulomb capacity rather than freezing an obsolete cap');
  const badForce=N.solve({x:[0],evaluate:()=>({residualVector:[0],feasibility:1}),residualScale:1,tolerance:1e-10,maxIterations:2}),noRange=N.solve({x:[0,0],evaluate:()=>({residualVector:[1],feasibility:0}),residualScale:1,tolerance:1e-10}),inconsistent=N.solve({x:[0],evaluate:x=>({residualVector:[x[0]-1,x[0]+1],feasibility:0}),residualScale:1,tolerance:1e-10});
  check(!badForce.converged&&badForce.feasibility===1&&!noRange.converged&&noRange.rank===0&&!inconsistent.converged&&inconsistent.residual>=1,
    'force infeasibility, a zero Jacobian and inconsistent residual rows cannot be reported as convergence');
  const nonfinite=N.solve({x:[0],evaluate:()=>({residualVector:[NaN],feasibility:0})}),invalid=N.solve({x:[0],evaluate:()=>({residualVector:[0],valid:false})}),badJacobian=N.solve({x:[0],evaluate:x=>({residualVector:[x[0]-1]}),jacobian:()=>[[Infinity]]});
  check(!nonfinite.converged&&nonfinite.reason==='nonfinite-evaluation'&&!invalid.converged&&invalid.reason==='invalid-initial-state'&&!badJacobian.converged&&badJacobian.reason==='invalid-jacobian',
    'nonfinite residuals and Jacobians and explicitly invalid physical states are rejected');
  const constrained=N.solve({x:[.1],evaluate:x=>({residualVector:[Math.log(x[0])],valid:x[0]>0,feasibility:0}),residualScale:1,tolerance:1e-11,differenceStep:.2,maxEvaluations:200});
  check(constrained.converged&&near(constrained.x[0],1,1e-10),
    'invalid perturbations use only valid one-sided derivatives and rejected trials never become the accepted physical state');
  let calls=0;const unstable=N.solve({x:[0],evaluate:()=>({residualVector:[calls++===0?0:1],feasibility:0})}),budget=N.solve({x:[0,0],evaluate:x=>({residualVector:[x[0]-1,x[1]-2]}),maxEvaluations:3}),damped=N.solve({x:[0],evaluate:x=>({residualVector:[1+1e-12*x[0]]}),jacobian:()=>[[1e-12]],residualScale:1,tolerance:1e-10,maxStep:1e-20,maxIterations:2});
  check(!unstable.converged&&unstable.reason==='verification-failed'&&!budget.converged&&budget.evaluations===3&&!damped.converged&&damped.residual>.9,
    'final common-state re-evaluation, deterministic evaluation budgets and strict residual gates prevent false convergence from damping or stale payloads');
  const initial=[0,0],seen=[],analytic=N.solve({x:initial,evaluate:x=>{seen.push(x.slice());x[0]+=0;return {residualVector:[2*x[0]+x[1]-4,x[0]+3*x[1]-7],payload:{value:x.slice()}};},jacobian:()=>[[2,1],[1,3]],residualScale:1,tolerance:1e-12});
  check(analytic.converged&&close(analytic.x,[1,2])&&close(initial,[0,0])&&close(analytic.evaluation.payload.value,analytic.x)&&seen.length===analytic.evaluations&&analytic.jacobianEvaluations===1,
    'an analytic Jacobian preserves force inputs and returns payload from the final verified common state');
  const naturalOnly=N.solve({x:[0],evaluate:x=>({residualVector:[x[0]-1],feasibility:Math.max(0,1-x[0])}),jacobian:()=>[[1]],residualScale:1,tolerance:1e-12,includeFeasibilityInMerit:false}),naturalInfeasible=N.solve({x:[0],evaluate:()=>({residualVector:[0],feasibility:1}),jacobian:()=>[[0]],residualScale:1,tolerance:1e-12,includeFeasibilityInMerit:false});
  check(naturalOnly.converged&&naturalOnly.feasibility===0&&naturalOnly.evaluations===3&&naturalOnly.jacobianEvaluations===1&&!naturalInfeasible.converged&&naturalInfeasible.feasibility===1,
    'natural-VI-only merit uses the analytic Jacobian without force probes while retaining the strict final force-feasibility gate');
  const canonical=N.solve({x:[0],evaluate:()=>({residualVector:[1],payload:{canonical:0}}),acceptEvaluation:q=>q.payload.canonical===0}),forceGuard=N.solve({x:[0],evaluate:()=>({residualVector:[0],feasibility:1}),acceptEvaluation:()=>true}),falseGate=N.solve({x:[0],evaluate:()=>({residualVector:[0]}),acceptEvaluation:()=>false}),finiteGuard=N.solve({x:[0],evaluate:()=>({residualVector:[NaN]}),acceptEvaluation:()=>true}),validGuard=N.solve({x:[0],evaluate:()=>({residualVector:[0],valid:false}),acceptEvaluation:()=>true});
  let freshCalls=0,callbackThrew=false;const freshGate=N.solve({x:[0],evaluate:()=>({residualVector:[0],payload:{canonical:freshCalls++}}),acceptEvaluation:q=>q.payload.canonical===0});
  try{N.solve({x:[0],evaluate:()=>({residualVector:[0]}),acceptEvaluation:()=>{throw Error('caller certificate failure');}});}catch(error){callbackThrew=error.message==='caller certificate failure';}
  check(canonical.converged&&canonical.evaluations===2&&!forceGuard.converged&&!falseGate.converged&&!finiteGuard.converged&&!validGuard.converged&&!freshGate.converged&&freshGate.reason==='verification-failed'&&callbackThrew,
    'a canonical-residual callback replaces only the search residual gate and cannot bypass force, fresh verification or an explicit caller rejection');
};
if(require.main===module){const assert=require('node:assert/strict');module.exports({check:(ok,msg)=>{assert.ok(ok,msg);process.stdout.write('ok '+msg+'\n');}});}
