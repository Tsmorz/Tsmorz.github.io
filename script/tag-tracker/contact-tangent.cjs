// Fixed-pressure QP proposals; original objective KKT and later joint certification remain distinct.
module.exports=function({check}){
  const Q=require('../../tag-tracker/contact-tangent-core'),VI=require('../../tag-tracker/contact-vi-core'),norm=v=>Math.hypot(...v),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),close=(a,b,t=1e-8)=>norm(a.map((v,i)=>v-b[i]))<=t;
  const H=[[2,.2],[.2,1]],wanted=[.2,-.1],block={start:0,size:2,metric:2.1},stick=Q.solve({H,linear:H.map(row=>-dot(row,wanted)),blocks:[block],caps:[1],tolerance:1e-12});
  check(stick.converged&&close(stick.tangents,wanted,1e-12)&&stick.residual<1e-12,
    'a feasible minimum-norm stick proposal satisfies the original fixed-pressure tangent KKT law');
  const A=[[.6,.2],[.2,1.1]],b=[-2,-.3],cap=.3,problem={H:A,linear:b,blocks:[{start:0,size:2,metric:1.2}],caps:[cap],tolerance:1e-10,maxIterations:5000,checkEvery:2};
  function at(gamma){const a=A[0][0]+gamma,c=A[1][1]+gamma,det=a*c-A[0][1]**2;return [(-c*b[0]+A[0][1]*b[1])/det,(A[0][1]*b[0]-a*b[1])/det];}
  let lo=0,hi=1;while(norm(at(hi))>cap)hi*=2;for(let i=0;i<90;i++){const mid=(lo+hi)/2;if(norm(at(mid))>cap)lo=mid;else hi=mid;}const expected=at(hi),slip=Q.solve(problem),gradient=A.map((row,i)=>dot(row,slip.tangents)+b[i]);
  check(slip.converged&&close(slip.tangents,expected,1e-9)&&norm(slip.tangents)<=cap+1e-14&&dot(gradient,slip.tangents)<0&&Math.abs(gradient[0]*slip.tangents[1]-gradient[1]*slip.tangents[0])<1e-9,
    'bounded ADMM finds the independent anisotropic force-ball KKT root and returns projected forces rather than its unconstrained subproblem');
  const penalties=[1e-5,1e-2].map(rho=>Q.solve({...problem,rho}));
  check(penalties.every(q=>q.converged&&close(q.tangents,expected,1e-9)&&q.residual<=problem.tolerance&&q.feasibility<=1e-9),
    'different positive numerical penalties converge to the same original-H constrained solution');
  const redundant=Q.solve({H:[[1,1],[1,1]],linear:[-1,-1],blocks:[{start:0,size:1,metric:1},{start:1,size:1,metric:1}],caps:[.1,1],tolerance:1e-10,maxIterations:5000,checkEvery:2});
  check(redundant.converged&&Math.abs(redundant.tangents[0]+redundant.tangents[1]-1)<1e-9&&Math.abs(redundant.tangents[0])<=.1+1e-14&&Math.abs(redundant.tangents[1])<=1+1e-14,
    'a singular PSD mobility redistributes traction in its nullspace to satisfy unequal caps without adding physical stiffness');
  const zero=Q.solve({H:[[2,.1,.3],[.1,3,.4],[.3,.4,1]],linear:[-100,200,-.4],blocks:[{start:0,size:2,metric:3.1},{start:2,size:1,metric:1}],caps:[0,1],initial:[9,-4,0],tolerance:1e-12}),linearOnly=Q.solve({H:[[0]],linear:[-1],blocks:[{start:0,size:1,metric:1}],caps:[.4],tolerance:1e-12});
  check(zero.converged&&zero.activeDOFs===1&&close(zero.tangents,[0,0,.4],1e-12)&&linearOnly.converged&&close(linearOnly.tangents,[.4],1e-12),
    'exact zero-cap elimination preserves coupling and a bounded linear objective needs no physical diagonal');
  const angle=.71,R=[[Math.cos(angle),-Math.sin(angle)],[Math.sin(angle),Math.cos(angle)]],rotate=v=>R.map(row=>dot(row,v)),rotH=R.map(row=>R.map(other=>row.reduce((s,v,i)=>s+v*dot(A[i],other),0))),rot=Q.solve({...problem,H:rotH,linear:rotate(b)});
  check(rot.converged&&close(rot.tangents,rotate(slip.tangents),1e-9),'the force-ball QP covaries with an orthonormal tangent-frame rotation');
  const input={...problem,H:A.map(row=>row.slice()),linear:b.slice(),blocks:problem.blocks.map(block=>({...block})),caps:[cap],initial:[.01,-.02]},before=JSON.stringify(input);Q.solve(input);
  check(JSON.stringify(input)===before,'factorization, numerical splitting and force projection do not mutate any input or warm guess');
  const limited=Q.solve({...problem,maxIterations:0}),unbounded=Q.solve({H:[[0]],linear:[-1],blocks:[{start:0,size:1,metric:1}],caps:[Infinity],maxIterations:3,checkEvery:1});
  check(!limited.converged&&limited.iterations===0&&limited.residual>problem.tolerance&&norm(limited.tangents)<=cap+1e-14&&!unbounded.converged&&unbounded.iterations===3,
    'an exhausted budget or an unbounded objective cannot report convergence, while returned finite proposals respect their caps');
  const longUnbounded=Q.solve({H:[[0]],linear:[-1],blocks:[{start:0,size:1,metric:1}],caps:[Infinity],maxIterations:1000,checkEvery:1});
  check(!longUnbounded.converged&&longUnbounded.iterations===1000&&longUnbounded.residual===1&&longUnbounded.tangents[0]>1e15,
    'large unbounded iterates cannot cancel a nonzero interior gradient and falsely satisfy the original KKT gate');
  const normal={size:1,base:[-1],diagonal:[1],apply:(v,out=new Float64Array(1))=>{out[0]=v[0];return out;}},joint=VI.create({H:[[1,0],[0,1]],C:[[.2,0]],linear:[-.4,0],normal,blocks:[{start:0,size:2,metric:1,capNormals:[[0,1]]}],normalActive:[]}),proposal=Q.solve({H:[[1,0],[0,1]],linear:[-.2,0],blocks:[{start:0,size:2,metric:1}],caps:[1],tolerance:1e-12}),certificate=joint.certificateForces({tangents:proposal.tangents,normalForces:[1]});
  check(proposal.converged&&certificate.payload.normalResidual>.03&&certificate.payload.maxResidual>3e-7,
    'a fixed-pressure tangent solution is only a proposal and cannot bypass the later original joint normal certificate');
  let rejected=0;for(const bad of [{...problem,linear:[NaN,0]},{...problem,caps:[-1]},{...problem,initial:[Infinity,0]},{...problem,rho:0},{...problem,H:[[1,0],[.1,1]]}])try{Q.solve(bad);}catch{rejected++;}
  check(rejected===5,'nonfinite forces, invalid caps, nonpositive penalties and nonsymmetric mobility are rejected');
};
if(require.main===module){const assert=require('node:assert/strict');module.exports({check:(ok,msg)=>{assert.ok(ok,msg);process.stdout.write('ok '+msg+'\n');}});}
