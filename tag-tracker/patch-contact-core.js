// Coupled finite cloth patches and unilateral contacts. Forces in N, compliance in m/N.
// The caller owns impulse application; this helper never mutates a rigid body or queues work.
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();else root.PatchContactCore=factory();
})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),norm=a=>Math.hypot(...a),mul=(a,s)=>a.map(v=>v*s),sub=(a,b)=>a.map((v,i)=>v-b[i]);
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const mv=(A,v)=>[0,1,2].map(i=>A[3*i]*v[0]+A[3*i+1]*v[1]+A[3*i+2]*v[2]);
  const vector=a=>Array.isArray(a)&&a.length===3&&a.every(Number.isFinite);
  // Tangential displacement is the force gradient at one common physical state.
  // Unlike a projected update's length, this KKT residual cannot shrink merely
  // because an iteration was damped. Capacity feasibility remains in newtons.
  function frictionResidual(force,displacement,cap,physicalMobility){
    if(force?.length!==3||displacement?.length!==3||!Array.from(force).every(Number.isFinite)||!Array.from(displacement).every(Number.isFinite)||!(cap>=0&&Number.isFinite(cap))||physicalMobility!==undefined&&!(physicalMobility>0&&Number.isFinite(physicalMobility)))throw Error('Invalid Coulomb force-ball state.');
    const size=norm(force),feasibility=Math.max(0,size-cap);if(!Number.isFinite(size))throw Error('Nonfinite Coulomb force norm.');
    if(physicalMobility!==undefined){
      // L*f - projection_{L*cap}(L*f-g) is the continuous natural VI
      // residual, in metres. L is a fixed physical response, never a damped
      // iteration step. This scaled form avoids dividing g by a small L.
      const scaled=force.map(v=>v*physicalMobility),trial=scaled.map((v,i)=>v-displacement[i]),radius=physicalMobility*cap;
      if(!scaled.every(Number.isFinite)||!trial.every(Number.isFinite)||!Number.isFinite(radius))throw Error('Nonfinite Coulomb natural response.');
      const length=norm(trial);if(!Number.isFinite(length))throw Error('Nonfinite Coulomb natural response.');
      if(length<=radius)return {residual:norm(displacement),feasibility};
      const ratio=radius/length;return {residual:norm(scaled.map((v,i)=>v-ratio*trial[i])),feasibility};
    }
    if(cap===0)return {residual:0,feasibility};
    const direction=size>0?force.map(v=>v/size):[0,0,0],radial=size>0&&size>=cap-1e-9?Math.max(0,-dot(displacement,direction)):0,residual=norm(displacement.map((v,i)=>v+radial*direction[i]));
    if(!Number.isFinite(residual))throw Error('Nonfinite Coulomb stationarity response.');return {residual,feasibility};
  }
  function factor(A){
    const n=A.length,L=Array.from({length:n},()=>new Float64Array(n));
    for(let i=0;i<n;i++)for(let j=0;j<=i;j++){
      let v=A[i][j];for(let k=0;k<j;k++)v-=L[i][k]*L[j][k];
      if(i===j){if(!(v>0))throw Error('Patch compliance must be positive definite.');L[i][j]=Math.sqrt(v);}else L[i][j]=v/L[j][j];
    }
    return b=>{const x=new Float64Array(n);for(let i=0;i<n;i++){let v=b[i];for(let j=0;j<i;j++)v-=L[i][j]*x[j];x[i]=v/L[i][i];}for(let i=n-1;i>=0;i--){let v=x[i];for(let j=i+1;j<n;j++)v-=L[j][i]*x[j];x[i]=v/L[i][i];}return [...x];};
  }
  // Exact minimizer of .5 f'Af-r'f over a Euclidean force ball. Rotational
  // mobility makes A anisotropic: clipping A^-1 r would solve a different problem.
  function ball(A,r,cap,freeSolve){
    if(cap===0)return r.map(()=>0);const free=freeSolve(r);if(norm(free)<=cap)return free;
    const shifted=t=>factor(A.map((row,i)=>row.map((v,j)=>v+(i===j?t:0))));
    let lo=0,hi=Math.max(1e-12,norm(r)/cap),at=hi,feasible=shifted(hi)(r);
    while(norm(feasible)>cap){hi*=2;at=hi;feasible=shifted(hi)(r);}
    // Safeguarded Newton reuses one factor for f and the norm derivative; the
    // bracket retains a feasible answer even at a nearly singular active block.
    for(let i=0;i<40;i++){
      const inverse=shifted(at),f=inverse(r),length=norm(f),gap=length-cap;
      if(gap>0)lo=at;else{hi=at;feasible=f;if(-gap<1e-12*Math.max(1,cap))return f;}
      const derivative=-dot(f,inverse(f))/(length||1),next=at-gap/derivative;
      at=next>lo&&next<hi?next:(lo+hi)/2;
    }
    return feasible;
  }
  function lcp(A,b){
    const n=b.length,x=Array(n).fill(0),active=new Set();
    for(let it=0;it<4*n*n+4;it++){
      let enter=-1,worst=-1e-11;
      for(let i=0;i<n;i++)if(!active.has(i)){const value=b[i]+dot(A[i],x);if(value<worst){worst=value;enter=i;}}
      if(enter<0)return x;active.add(enter);
      for(let inner=0;inner<=n;inner++){
        const ids=[...active],candidate=factor(ids.map(i=>ids.map(j=>A[i][j])))(ids.map(i=>-b[i]));
        if(candidate.every(v=>v>0)){x.fill(0);ids.forEach((id,i)=>{x[id]=candidate[i];});break;}
        let alpha=1;ids.forEach((id,i)=>{if(candidate[i]<=0)alpha=Math.min(alpha,x[id]/(x[id]-candidate[i]||1));});
        ids.forEach((id,i)=>{x[id]+=alpha*(candidate[i]-x[id]);if(x[id]<1e-12){x[id]=0;active.delete(id);}});
      }
    }
    return null;
  }
  function rigid(body){
    if(!body||body.fixed)return {invM:0,iW:Array(9).fill(0)};
    let iW=body.iW||Array(9).fill(0);
    if(body.R&&body.invIb)iW=Array.from({length:9},(_,at)=>{const i=Math.floor(at/3),j=at%3;let v=0;for(let k=0;k<3;k++)for(let l=0;l<3;l++)v+=body.R[3*i+k]*body.invIb[3*k+l]*body.R[3*j+l];return v;});
    return {invM:body.invM??(body.m>0?1/body.m:0),iW};
  }
  function positiveSemidefinite(A){
    const n=A.length,work=A.map(row=>row.slice());let size=1e-20;for(const row of A)for(const v of row)size=Math.max(size,Math.abs(v));const tolerance=size*1e-10;
    for(let i=0;i<n;i++){
      let pivot=i;for(let j=i+1;j<n;j++)if(work[j][j]>work[pivot][pivot])pivot=j;
      if(pivot!==i){[work[i],work[pivot]]=[work[pivot],work[i]];for(const row of work)[row[i],row[pivot]]=[row[pivot],row[i]];}
      const diagonal=work[i][i];if(diagonal < -tolerance)return false;
      if(diagonal<=tolerance){for(let j=i;j<n;j++)for(let k=i;k<n;k++)if(Math.abs(work[j][k])>tolerance)return false;return true;}
      for(let j=i+1;j<n;j++)for(let k=j;k<n;k++){work[k][j]-=work[j][i]*work[k][i]/diagonal;work[j][k]=work[k][j];}
    }
    return true;
  }
  function solveFixed({S,pins,contacts=[],normalCompliance,normalBounds,errors,stiffness,dt,tolerance}){
    const p=pins.length,axes=[[1,0,0],[0,1,0],[0,0,1]],basis=pins.map(pin=>pin.axes||axes),starts=[];let k=0;
    for(const [pinIndex,directions]of basis.entries()){
      if(!directions.length&&(pins[pinIndex].cap??Infinity)!==0||directions.length>3||directions.some((d,i)=>!vector(d)||directions.some((e,j)=>Math.abs(dot(d,e)-(i===j?1:0))>1e-8)))throw Error('Patch force axes must be orthonormal; empty axes require zero capacity.');
      starts.push(k);k+=directions.length;
    }
    const n=k+contacts.length;
    if(tolerance!==undefined&&!(tolerance>0&&Number.isFinite(tolerance)))throw Error('Patch displacement tolerance must be finite and positive.');
    const stoppingTolerance=tolerance??1e-9,acceptedTolerance=tolerance??1e-8;
    if(normalCompliance){
      const count=contacts.length;
      if(normalCompliance.length!==count||normalCompliance.some(row=>row.length!==count||!row.every(Number.isFinite))||normalCompliance.some((row,i)=>row.some((v,j)=>Math.abs(v-normalCompliance[j][i])>1e-12))||!positiveSemidefinite(normalCompliance))throw Error('Normal compliance must be a finite symmetric positive semidefinite matrix.');
    }
    if(!(dt>0&&Number.isFinite(dt))||S.length!==p||S.some(row=>row.length!==p||!row.every(Number.isFinite))||errors.length!==p||errors.some(e=>!vector(e))||stiffness.length!==p||stiffness.some(v=>!(v>0&&Number.isFinite(v))))throw Error('Invalid patch compliance input.');
    const caps=pins.map(pin=>pin.cap??Infinity);if(caps.some(v=>v<0||!Number.isFinite(v)&&v!==Infinity))throw Error('Invalid patch force cap.');
    const bodies=new Map(),variables=[];
    const variable=(row,direction,body,point)=>{
      if(!vector(direction)||!vector(point)||row.some(([i,v])=>!Number.isInteger(i)||i<0||i>=p||!Number.isFinite(v)))throw Error('Invalid patch contact.');
      if(body&&!bodies.has(body))bodies.set(body,rigid(body));
      const bodyDirection=mul(direction,-row.reduce((sum,[,v])=>sum+v,0)),arm=sub(point,body?.t||[0,0,0]);
      return {row,direction,body,point,bodyDirection,torque:cross(arm,bodyDirection)};
    };
    pins.forEach((pin,i)=>basis[i].forEach(axis=>variables.push({...variable([[i,1]],axis,pin.body,pin.point||pin.target||[0,0,0]),pin:i})));
    for(const contact of contacts){if(!Number.isFinite(contact.base)||!(contact.compliance>=0&&Number.isFinite(contact.compliance)))throw Error('Invalid normal compliance.');variables.push(variable(contact.row,contact.normal,contact.body,contact.point||[0,0,0]));}
    const A=variables.map((u,i)=>variables.map((v,j)=>{
      let value=dot(u.direction,v.direction)*u.row.reduce((sum,[a,wa])=>sum+v.row.reduce((s,[b,wb])=>s+wa*wb*S[a][b],0),0);
      if(u.body&&u.body===v.body){const B=bodies.get(u.body);value+=dt*dt*(B.invM*dot(u.bodyDirection,v.bodyDirection)+dot(u.torque,mv(B.iW,v.torque)));}
      return value+(i>=k&&j>=k&&normalCompliance?normalCompliance[i-k][j-k]:0)+(i===j?(i<k?1/stiffness[u.pin]:contacts[i-k].compliance):0);
    }));
    const linear=basis.flatMap((directions,i)=>directions.map(d=>-dot(d,errors[i]))).concat(contacts.map(c=>c.base)),H=A.slice(0,k).map(row=>row.slice(0,k)),pinSolve=factor(H);
    const free=pinSolve(linear.slice(0,k).map(v=>-v)),coupling=contacts.map((_,j)=>pinSolve(A.slice(0,k).map(row=>row[k+j])));
    const normalMatrix=contacts.map((_,i)=>contacts.map((_,j)=>A[k+i][k+j]-dot(A[k+i].slice(0,k),coupling[j]))),gap=contacts.map((c,i)=>c.base+dot(A[k+i].slice(0,k),free));
    let boundMultipliers=(normalBounds||[]).map(()=>0),normalBoundConverged=true,normalBoundResidual=0;
    const solveNormals=(matrix,right)=>{
      if(!normalBounds?.length)return lcp(matrix,right);
      const solution=normalLCP({size:contacts.length,apply:v=>matrix.map(row=>dot(row,v)),column:j=>matrix.map(row=>row[j]),diagonal:matrix.map((row,i)=>row[i]),base:right,bounds:normalBounds,tolerance:stoppingTolerance});
      boundMultipliers=solution.boundMultipliers;normalBoundConverged=solution.converged;normalBoundResidual=solution.boundResidual;
      return solution.converged?solution.forces:null;
    };
    let normals=solveNormals(normalMatrix,gap);const exactNormal=!!normals;if(!normals)normals=contacts.map(()=>0);
    let x=free.map((v,i)=>v-coupling.reduce((sum,column,j)=>sum+column[i]*normals[j],0)).concat(normals),iterations=0;
    const blocks=pins.map((_,i)=>{const at=starts[i],end=at+basis[i].length,matrix=A.slice(at,end).map(row=>row.slice(at,end));return {at,end,matrix,solve:factor(matrix)};}),normalBlock=A.slice(k).map(row=>row.slice(k));
    let gradient=A.map((row,i)=>dot(row,x)+linear[i]);
    const residual=()=>{
      let worst=0;
      for(let i=0;i<p;i++){
        const {at,end}=blocks[i],f=x.slice(at,end),g=gradient.slice(at,end),length=norm(f);
        if(caps[i]===0)continue;
        const mu=length>=caps[i]*(1-1e-9)?Math.max(0,-dot(g,f)/(length*length||1)):0;
        worst=Math.max(worst,norm(g.map((v,j)=>v+mu*f[j])));
      }
      for(let i=k;i<n;i++){const value=gradient[i]+(normalBounds||[]).reduce((s,b,j)=>s+b.row[i-k]*boundMultipliers[j],0);worst=Math.max(worst,x[i]>1e-9?Math.abs(value):Math.max(0,-value));}
      return worst;
    };
    const feasibility=()=>Math.max(0,...pins.map((_,i)=>norm(x.slice(blocks[i].at,blocks[i].end))-caps[i]),...x.slice(k).map(v=>-v),...(normalBounds||[]).map(b=>dot(b.row,x.slice(k))-b.max));
    if(!exactNormal||pins.some((_,i)=>norm(x.slice(blocks[i].at,blocks[i].end))>caps[i]+1e-9)){
      for(let i=0;i<p;i++){const {at,end}=blocks[i],f=x.slice(at,end),length=norm(f);if(length>caps[i])for(let j=at;j<end;j++)x[j]*=caps[i]/length;}
      gradient=A.map((row,i)=>dot(row,x)+linear[i]);
      const change=(index,value)=>{const d=value-x[index];if(d!==0){x[index]=value;for(let j=0;j<n;j++)gradient[j]+=A[j][index]*d;}};
      for(iterations=1;iterations<=640;iterations++){
        for(let i=0;i<p;i++){
          const {at,end,matrix,solve:blockSolve}=blocks[i],old=x.slice(at,end),rhs=old.map((_,j)=>dot(matrix[j],old)-gradient[at+j]),next=ball(matrix,rhs,caps[i],blockSolve);
          next.forEach((v,j)=>change(at+j,v));
        }
        // Shared rubber modes make individual normal rows nearly dependent.
        // Solve their complementarity together instead of slowly exchanging
        // pressure between scalar coordinates after every pin update.
        const right=contacts.map((c,j)=>linear[k+j]+dot(A[k+j].slice(0,k),x.slice(0,k))),values=solveNormals(normalBlock,right);
        if(values)values.forEach((v,j)=>change(k+j,v));else if(normalBounds?.length)break;else for(let i=k;i<n;i++)change(i,Math.max(0,x[i]-gradient[i]/A[i][i]));
        if(residual()<stoppingTolerance&&feasibility()<=1e-9&&normalBoundConverged)break;
      }
    }
    const forces=pins.map((_,i)=>[0,1,2].map(axis=>basis[i].reduce((sum,d,j)=>sum+d[axis]*x[starts[i]+j],0))),normalForces=x.slice(k),total=forces.map(f=>f.slice()),bodyOffsets=new Map();
    contacts.forEach((contact,i)=>contact.row.forEach(([j,sign])=>{for(let axis=0;axis<3;axis++)total[j][axis]+=sign*contact.normal[axis]*normalForces[i];}));
    variables.forEach((v,i)=>{
      if(!v.body||v.body.fixed)return;
      if(!bodyOffsets.has(v.body))bodyOffsets.set(v.body,{force:[0,0,0],torque:[0,0,0]});const out=bodyOffsets.get(v.body);
      for(let j=0;j<3;j++){out.force[j]+=x[i]*v.bodyDirection[j];out.torque[j]+=x[i]*v.torque[j];}
    });
    for(const [body,out]of bodyOffsets){const B=bodies.get(body);out.translation=mul(out.force,dt*dt*B.invM);out.rotation=mul(mv(B.iW,out.torque),dt*dt);}
    const error=residual(),forceError=feasibility();
    return {forces,total,normalForces,bodyOffsets,residual:error,feasibility:forceError,converged:error<acceptedTolerance&&forceError<=1e-9&&normalBoundConverged,iterations,...normalBounds?.length?{boundMultipliers,normalBoundResidual}:{}};
  }
  function solvePressure(problem,backend){
    const groups=problem.pressureGroups;if(!groups?.length)return backend(problem);
    const nominal=problem.pins.map(pin=>pin.cap??Infinity),used=new Set(),forceTolerance=1e-9,normalTolerance=1e-8;
    for(const group of groups){
      if(!(group.normal>=0&&Number.isFinite(group.normal))||!group.pins?.length||group.sides?.length!==2||group.pins.some(i=>!Number.isInteger(i)||i<0||i>=nominal.length||used.has(i)||!Number.isFinite(nominal[i]))||group.sides.some(side=>side.some(([i,w])=>!Number.isInteger(i)||i<0||i>=(problem.normal?.size??problem.contacts?.length??0)||!(w>=0&&Number.isFinite(w)))))throw Error('Invalid pressure-dependent friction group.');
      group.pins.forEach(i=>used.add(i));
    }
    const pressure=solution=>groups.map(group=>group.sides.map(side=>side.reduce((s,[i,w])=>s+w*solution.normalForces[i],0)));
    // Establish contact causally, with all tangent friction disabled. A grip
    // cannot manufacture its own normal support by first applying a lifting force.
    const baseline=backend({...problem,pins:problem.pins.map(pin=>({...pin,cap:0}))}),basePressure=pressure(baseline),enabled=groups.map((group,i)=>group.normal>0&&Math.min(...basePressure[i])>forceTolerance&&group.pins.some(j=>nominal[j]>0));
    let evaluations=1;
    const evaluate=values=>{
      const caps=nominal.slice();groups.forEach((group,i)=>group.pins.forEach(j=>{caps[j]=enabled[i]?nominal[j]*values[i]/group.normal:0;}));
      const solution=backend({...problem,pins:problem.pins.map((pin,i)=>({...pin,cap:caps[i]}))}),pressures=pressure(solution),target=groups.map((group,i)=>enabled[i]?Math.max(0,Math.min(group.normal,...pressures[i])):0);
      let violation=0,residual=0;
      groups.forEach((group,i)=>group.pins.forEach(j=>{
        const allowed=enabled[i]?nominal[j]*target[i]/group.normal:0,size=norm(solution.forces[j]);violation=Math.max(violation,size-allowed);
        // An inactive cap has no effect on the physical solution. Otherwise it
        // must agree with the support-derived cap as well as be feasible.
        if(enabled[i]&&size>=caps[j]-forceTolerance&&nominal[j]>0)residual=Math.max(residual,Math.abs(values[i]-target[i]));
      }));
      evaluations++;return {values:values.slice(),solution,caps,target,pressures,violation:Math.max(0,violation),residual,valid:baseline.converged&&solution.converged&&violation<=forceTolerance&&residual<=normalTolerance};
    };
    const active=groups.flatMap((_,i)=>enabled[i]?[i]:[]),initial=groups.map((group,i)=>enabled[i]?group.normal:0);let current=evaluate(initial);
    if(!current.valid&&active.length===1){
      const i=active[0];let low=evaluate(groups.map(()=>0)),high=current;
      for(let iteration=0;iteration<64&&!current.valid;iteration++){
        const a=low.values[i],b=high.values[i],fa=a-low.target[i],fb=b-high.target[i],secant=b-fb*(b-a)/(fb-fa),next=initial.slice();next[i]=Number.isFinite(secant)&&secant>a+.1*(b-a)&&secant<b-.1*(b-a)?secant:(a+b)/2;
        current=evaluate(next);if(current.values[i]-current.target[i]>0)high=current;else low=current;
      }
    }else if(!current.valid&&active.length>1){
      // A few hands give a tiny bounded root problem. Recompute a numerical
      // Jacobian of the already converged normal/friction solve; safeguard each
      // Newton step with a residual line search and a bounded fixed-point step.
      const error=q=>active.map(i=>q.values[i]-q.target[i]),merit=q=>Math.max(...error(q).map((v,j)=>Math.abs(v)/Math.max(groups[active[j]].normal,1e-6)));
      for(let iteration=0;iteration<32&&!current.valid;iteration++){
        const f=error(current),columns=active.map(i=>{
          const h=Math.max(1e-7,groups[i].normal*1e-4),values=current.values.slice(),step=values[i]+h<=groups[i].normal?h:-h;values[i]=clampSupport(values[i]+step,groups[i].normal);const actual=values[i]-current.values[i];
          return error(evaluate(values)).map((v,j)=>(v-f[j])/(actual||h));
        }),J=active.map((_,i)=>active.map((_,j)=>columns[j][i])),rhs=f.map(v=>-v),M=J.map((row,i)=>[...row,rhs[i]]);let nonsingular=true;
        for(let i=0;i<active.length;i++){
          let pivot=i;for(let j=i+1;j<active.length;j++)if(Math.abs(M[j][i])>Math.abs(M[pivot][i]))pivot=j;
          if(Math.abs(M[pivot][i])<1e-10){nonsingular=false;break;}[M[i],M[pivot]]=[M[pivot],M[i]];const den=M[i][i];for(let j=i;j<=active.length;j++)M[i][j]/=den;
          for(let row=0;row<active.length;row++)if(row!==i){const value=M[row][i];for(let j=i;j<=active.length;j++)M[row][j]-=value*M[i][j];}
        }
        let accepted=null;
        if(nonsingular)for(let fraction=1;fraction>=1/64;fraction/=2){const values=current.values.slice();active.forEach((i,j)=>{values[i]=clampSupport(values[i]+fraction*M[j][active.length],groups[i].normal);});const trial=evaluate(values);if(trial.valid||merit(trial)<merit(current)){accepted=trial;break;}}
        if(!accepted){const values=current.values.map((v,i)=>enabled[i]?(v+current.target[i])/2:0);accepted=evaluate(values);}
        current=accepted;
      }
    }
    const allowed=nominal.slice();groups.forEach((group,i)=>group.pins.forEach(j=>{allowed[j]=enabled[i]?nominal[j]*current.target[i]/group.normal:0;}));
    return {...current.solution,converged:current.valid,feasibility:Math.max(current.solution.feasibility,current.violation),caps:allowed,pressureFeasibility:current.violation,pressureResidual:current.residual,pressureEvaluations:evaluations,support:groups.map((group,i)=>({command:group.normal,applied:current.values[i],normal:current.target[i],pressure:current.pressures[i],causal:enabled[i]}))};
  }
  const solve=problem=>solvePressure(problem,solveFixed);
  const clampSupport=(value,normal)=>Math.max(0,Math.min(normal,value));
  // Normal-only complementarity with a caller-owned fixed symmetric response.
  // Active-set preconditioned CG stores vectors only; the diagonal changes the
  // search metric, never material compliance. Every accepted result is checked
  // against a freshly evaluated physical operator and nonnegative force bounds.
  function normalFixedLCP({size,apply,column:unitResponse,diagonal,base,tolerance=1e-9,warm,maxIterations=Math.max(128,8*size),maxActiveWorkspaceBytes=2*1024*1024}){
    if(!Number.isInteger(size)||size<0||typeof apply!=='function'||unitResponse!==undefined&&typeof unitResponse!=='function'||diagonal.length!==size||base.length!==size||!(tolerance>0&&Number.isFinite(tolerance))||!Number.isInteger(maxIterations)||maxIterations<1||!Number.isSafeInteger(maxActiveWorkspaceBytes)||maxActiveWorkspaceBytes<0)throw Error('Invalid matrix-free normal system.');
    for(let i=0;i<size;i++)if(!(diagonal[i]>0&&Number.isFinite(diagonal[i]))||!Number.isFinite(base[i]))throw Error('Invalid normal preconditioner or gap.');
    if(warm&&(warm.length!==size||[...warm].some(v=>!Number.isFinite(v))))throw Error('Invalid normal warm start.');
    let applications=0,columnApplications=0,iterations=0,failure=null,pivotIterations=0,peakActive=0,peakCachedColumns=0,peakActiveWorkspaceBytes=0,activeWorkspaceLimited=false,activeFaceRejected=false,activeFactorizations=0,activeRefactorizations=0,activeExtensions=0,warmActiveSeeded=0;
    // Count cached Float64 columns, dense JS input plus Float64 Cholesky, and
    // conservative row/vector overhead. A budget miss selects vector CG below.
    const workspaceBytes=(cached,active)=>8*size*cached+24*active*active+256*(cached+active)+32*size;
    const workspace=()=>({maxActiveWorkspaceBytes,peakActiveWorkspaceBytes,peakCachedColumns,activeWorkspaceLimited,activeFaceRejected,activeFactorizations,activeRefactorizations,activeExtensions,warmActiveSeeded});
    const response=(v,id)=>{const out=new Float64Array(size),value=(id!==undefined&&unitResponse?unitResponse(id,out):apply(v,out))||out;if(value.length!==size)throw Error('Invalid normal response size.');for(let i=0;i<size;i++)if(!Number.isFinite(value[i]))throw Error('Nonfinite normal response.');applications++;if(id!==undefined)columnApplications++;return value;};
    const x=Float64Array.from({length:size},(_,i)=>Math.max(0,warm?.[i]||0)),g=new Float64Array(size),z=new Float64Array(size),d=new Float64Array(size),free=new Uint8Array(size),previousFree=new Uint8Array(size);
    let fresh=true;const refresh=()=>{const value=response(x);for(let i=0;i<size;i++)g[i]=value[i]+base[i];fresh=true;};
    const residual=()=>{let error=0;for(let i=0;i<size;i++)error=Math.max(error,x[i]>1e-12?Math.abs(g[i]):Math.max(0,-g[i]));return error;};
    const inner=(a,b)=>{let value=0;for(let i=0;i<size;i++)value+=a[i]*b[i];return value;};
    if(!size)return {forces:[],residual:0,feasibility:0,converged:true,iterations,applications,columnApplications,evaluations:applications,...workspace()};
    if(x.some(v=>v!==0))refresh();else g.set(base);let restart=true,previousGZ=0;
    // Overlapping surface samples usually support a much smaller active face.
    // Query its columns lazily, with bounded storage. Exceeding this workspace
    // selects CG below; it never removes a physical constraint from the law.
    if(residual()>tolerance&&maxIterations>1&&workspaceBytes(0,0)>maxActiveWorkspaceBytes)activeWorkspaceLimited=true;
    if(residual()>tolerance&&maxIterations>1&&workspaceBytes(0,0)<=maxActiveWorkspaceBytes){
      const active=new Set(),columns=new Map(),trial=new Float64Array(size),gradient=Float64Array.from(base),unit=new Float64Array(size);
      const column=id=>{if(!columns.has(id)){unit[id]=1;const value=Float64Array.from(response(unit,id));unit[id]=0;columns.set(id,value);peakCachedColumns=Math.max(peakCachedColumns,columns.size);}return columns.get(id);};
      let faceIds=[],faceL=[];
      const solveFactor=ids=>{
        const prefix=faceIds.length>0&&faceIds.length<=ids.length&&faceIds.every((id,i)=>id===ids[i]);
        if(!prefix){faceIds=[];faceL=[];activeRefactorizations++;}
        const start=faceL.length;if(prefix)activeExtensions+=ids.length-start;
        // Cholesky's existing prefix is independent of appended rows. Each
        // new coefficient follows exactly the original i/j/k arithmetic order.
        for(let i=start;i<ids.length;i++){
          const row=new Float64Array(i+1);faceL.push(row);
          for(let j=0;j<=i;j++){let value=column(ids[j])[ids[i]];for(let k=0;k<j;k++)value-=row[k]*faceL[j][k];if(i===j){if(!(value>0))throw Error('Patch compliance must be positive definite.');row[j]=Math.sqrt(value);}else row[j]=value/faceL[j][j];}
        }
        faceIds=ids.slice();const x=new Float64Array(ids.length);
        for(let i=0;i<ids.length;i++){let value=-base[ids[i]];for(let j=0;j<i;j++)value-=faceL[i][j]*x[j];x[i]=value/faceL[i][i];}
        for(let i=ids.length-1;i>=0;i--){let value=x[i];for(let j=i+1;j<ids.length;j++)value-=faceL[j][i]*x[j];x[i]=value/faceL[i][i];}return Array.from(x);
      };
      const solveFace=()=>{
        const passes=active.size;for(let pass=0;pass<=passes;pass++){
          const ids=[...active];let candidate;
          try{activeFactorizations++;candidate=solveFactor(ids);}catch(error){if(!/positive definite/.test(error.message))throw error;activeFaceRejected=true;return false;}
          if(candidate.every(v=>v>0)){trial.fill(0);ids.forEach((id,i)=>{trial[id]=candidate[i];});return true;}
          let fraction=1;ids.forEach((id,i)=>{if(candidate[i]<=0)fraction=Math.min(fraction,trial[id]/(trial[id]-candidate[i]||1));});
          ids.forEach((id,i)=>{trial[id]+=fraction*(candidate[i]-trial[id]);if(trial[id]<1e-12){trial[id]=0;active.delete(id);}});
        }
        return false;
      };
      const updateGradient=()=>{gradient.set(base);for(const id of active){const value=column(id),force=trial[id];for(let i=0;i<size;i++)gradient[i]+=force*value[i];}};
      let complete=false,search=true;const initialActive=[];for(let i=0;i<size;i++)if(x[i]>1e-12)initialActive.push(i);
      if(initialActive.length){
        const required=workspaceBytes(initialActive.length,initialActive.length);
        if(required>maxActiveWorkspaceBytes){activeWorkspaceLimited=true;search=false;}else{
          peakActiveWorkspaceBytes=Math.max(peakActiveWorkspaceBytes,required);warmActiveSeeded=initialActive.length;trial.set(x);for(const id of initialActive){active.add(id);column(id);}peakActive=active.size;
          search=solveFace();if(search)updateGradient();
        }
      }
      for(;search&&pivotIterations<4*size+64;pivotIterations++){
        let enter=-1,worst=-tolerance;for(let i=0;i<size;i++)if(!active.has(i)&&gradient[i]<worst){worst=gradient[i];enter=i;}
        if(enter<0){complete=true;break;}
        const required=()=>workspaceBytes(columns.size+(columns.has(enter)?0:1),active.size+1);
        if(required()>maxActiveWorkspaceBytes)for(const id of columns.keys())if(!active.has(id)&&id!==enter){columns.delete(id);if(required()<=maxActiveWorkspaceBytes)break;}
        if(required()>maxActiveWorkspaceBytes){activeWorkspaceLimited=true;break;}
        peakActiveWorkspaceBytes=Math.max(peakActiveWorkspaceBytes,required());active.add(enter);column(enter);peakActive=Math.max(peakActive,active.size);
        if(!solveFace())break;updateGradient();
      }
      if(complete){x.set(trial);refresh();const error=residual();if(error<=tolerance)return {forces:[...x],residual:error,feasibility:0,converged:true,iterations:0,pivotIterations,peakActive,applications,columnApplications,evaluations:applications,...workspace()};}
    }
    // Small manifolds have a useful exact crossover: at most64 physical
    // responses are cheaper than repeated active-face changes in CG. This is
    // bounded workspace, not a contact cutoff; larger systems stay matrix-free.
    if(size<=64&&workspaceBytes(size,size)<=maxActiveWorkspaceBytes&&residual()>tolerance&&maxIterations>1){
      peakActiveWorkspaceBytes=Math.max(peakActiveWorkspaceBytes,workspaceBytes(size,size));
      const A=Array.from({length:size},()=>Array(size).fill(0)),unit=new Float64Array(size);
      for(let j=0;j<size;j++){unit[j]=1;const value=response(unit,j);for(let i=0;i<size;i++)A[i][j]=value[i];unit[j]=0;}
      const exact=lcp(A,base);
      if(exact){x.set(exact);refresh();const error=residual();if(error<=tolerance)return {forces:[...x],residual:error,feasibility:0,converged:true,iterations:0,pivotIterations,peakActive,applications,columnApplications,evaluations:applications,...workspace()};}
    }
    for(iterations=0;iterations<maxIterations;iterations++){
      if(residual()<=tolerance){if(!fresh)refresh();if(residual()<=tolerance)break;restart=true;}
      let same=true;for(let i=0;i<size;i++){free[i]=x[i]>1e-12||g[i]<-tolerance?1:0;if(free[i]!==previousFree[i])same=false;z[i]=free[i]?g[i]/diagonal[i]:0;}
      const gz=inner(g,z),beta=!restart&&same&&previousGZ>0?gz/previousGZ:0;
      let feasible=true;for(let i=0;i<size;i++){d[i]=-z[i]+beta*d[i];if(x[i]===0&&d[i]<0)feasible=false;}
      if(!feasible||inner(g,d)>=0)for(let i=0;i<size;i++)d[i]=-z[i];
      const slope=inner(g,d),Ad=response(d),curvature=inner(d,Ad);
      if(!(slope<0&&curvature>0)){failure='No positive-curvature feasible descent direction.';break;}
      let step=-slope/curvature,bound=-1;
      for(let i=0;i<size;i++)if(d[i]<0){const candidate=-x[i]/d[i];if(candidate<step){step=candidate;bound=i;}}
      if(!(step>=0&&Number.isFinite(step))){failure='Invalid normal search step.';break;}
      for(let i=0;i<size;i++){x[i]=Math.max(0,x[i]+step*d[i]);g[i]+=step*Ad[i];previousFree[i]=free[i];}
      fresh=false;
      if(bound>=0)x[bound]=0;
      previousGZ=gz;restart=bound>=0;
      if((iterations+1)%32===0){refresh();restart=true;}
    }
    if(!fresh)refresh();const error=residual(),feasibility=Math.max(0,...x.map(v=>-v));
    return {forces:[...x],residual:error,feasibility,converged:error<=tolerance&&feasibility<=1e-9,iterations,pivotIterations,peakActive,applications,columnApplications,evaluations:applications,...workspace(),...failure?{failure}:{}};
  }
  // A force-limited shared actuator adds a small number of linear load bounds.
  // Their multipliers have units of metres and are the additional physical
  // opening after saturation. Normal complementarity remains unchanged.
  function normalLCP(problem){
    const bounds=problem.bounds;if(!bounds?.length)return normalFixedLCP(problem);
    const n=problem.size,m=bounds.length,forceTolerance=1e-9,cache=new Map();let applications=0,columnApplications=0,outerIterations=0;
    if(bounds.some(b=>b.row.length!==n||!Array.from(b.row).every(Number.isFinite)||!Number.isFinite(b.max)))throw Error('Invalid normal load bound.');
    const apply=(v,out)=>{applications++;return problem.apply(v,out);},column=(id,out=new Float64Array(n))=>{
      if(!cache.has(id)){if(cache.size===64)cache.delete(cache.keys().next().value);let value;if(problem.column)value=problem.column(id,out)||out;else{const unit=new Float64Array(n);unit[id]=1;value=problem.apply(unit,out)||out;}cache.set(id,Float64Array.from(value));applications++;columnApplications++;}
      out.set(cache.get(id));return out;
    };
    const evaluate=multipliers=>{
      const base=problem.base.map((v,i)=>v+bounds.reduce((s,b,j)=>s+b.row[i]*multipliers[j],0)),solution=normalFixedLCP({...problem,apply,column,base}),loads=bounds.map(b=>dot(b.row,solution.forces)),violation=loads.map((v,j)=>v-bounds[j].max);
      const residual=Math.max(0,...violation.map((v,j)=>multipliers[j]>1e-14?Math.abs(v):Math.max(0,v))),feasibility=Math.max(solution.feasibility,0,...violation);
      return {solution,multipliers:multipliers.slice(),loads,violation,residual,feasibility,valid:solution.converged&&residual<=forceTolerance&&feasibility<=forceTolerance};
    };
    const sensitivity=(current,active)=>{
      const ids=current.solution.forces.flatMap((v,i)=>v>1e-12?[i]:[]);if(!ids.length)return active.map(()=>active.map(()=>0));
      let inverse;
      if(ids.length<=64){const A=ids.map(i=>ids.map(j=>column(j)[i]));try{inverse=factor(A);}catch(e){if(!/positive definite/.test(e.message))throw e;}}
      if(inverse){const vectors=active.map(j=>ids.map(i=>bounds[j].row[i])),responses=vectors.map(inverse);return vectors.map(v=>responses.map(z=>dot(v,z)));}
      // A large positive face retains vector-only storage. Differentiate its
      // checked normal solution; an active-face change is handled by line search.
      const columns=active.map(j=>{const step=1e-7,eta=current.multipliers.slice();eta[j]+=step;const next=evaluate(eta);return active.map(i=>(current.loads[i]-next.loads[i])/step);});
      return active.map((_,i)=>active.map((_,j)=>(columns[j][i]+columns[i][j])/2));
    };
    let current=evaluate(Array(m).fill(0)),low=null,high=null;
    for(;outerIterations<128&&!current.valid;outerIterations++){
      const active=bounds.flatMap((_,j)=>current.multipliers[j]>0||current.violation[j]>forceTolerance?[j]:[]);if(!active.length)break;
      const S=sensitivity(current,active),rhs=active.map(i=>current.violation[i]);let direction;
      try{direction=factor(S)(rhs);}catch(e){if(!/positive definite/.test(e.message))throw e;direction=rhs.map((v,i)=>v/Math.max(S[i][i],1));}
      let accepted=null;
      if(m===1){
        if(current.violation[0]>0)low=current;else high=current;
        let next=current.multipliers[0]+direction[0];
        if(high){const a=low?.multipliers[0]??0,b=high.multipliers[0];if(!(next>a&&next<b))next=low?a-low.violation[0]*(b-a)/(high.violation[0]-low.violation[0]):(a+b)/2;if(!(next>a&&next<b))next=(a+b)/2;}
        else if(!(next>current.multipliers[0]))next=Math.max(1e-7,2*current.multipliers[0]);
        accepted=evaluate([Math.max(0,next)]);
      }else{
        for(let fraction=1;fraction>=1/128;fraction/=2){const eta=current.multipliers.slice();active.forEach((j,i)=>{eta[j]=Math.max(0,eta[j]+fraction*direction[i]);});const trial=evaluate(eta);if(trial.valid||trial.residual<current.residual){accepted=trial;break;}}
        if(!accepted){const scale=Math.max(1,...S.map(row=>row.reduce((s,v)=>s+Math.abs(v),0))),eta=current.multipliers.slice();active.forEach(j=>{eta[j]=Math.max(0,eta[j]+current.violation[j]/scale);});accepted=evaluate(eta);}
      }
      current=accepted;
    }
    return {...current.solution,converged:current.valid,feasibility:current.feasibility,boundMultipliers:current.multipliers,boundLoads:current.loads,boundResidual:current.residual,boundIterations:outerIterations,applications,columnApplications,evaluations:applications};
  }
  // Small captured tangent blocks coupled to a caller-owned, potentially large
  // normal operator. No dense normal matrix or material-sample S is constructed.
  function coupledSystem(problem){
    const {H,C,pins,errors}=problem,normal=problem.normal,n=normal.size,basis=pins.map(pin=>pin.axes||[[1,0,0],[0,1,0],[0,0,1]]),starts=[];let k=0;
    basis.forEach((directions,i)=>{if(!directions.length&&(pins[i].cap??Infinity)!==0||directions.length>3||directions.some((d,a)=>!vector(d)||directions.some((e,b)=>Math.abs(dot(d,e)-(a===b?1:0))>1e-8)))throw Error('Invalid coupled tangent axes.');starts.push(k);k+=directions.length;});
    if(!Number.isInteger(n)||n<0||typeof normal.apply!=='function'||normal.diagonal.length!==n||normal.base.length!==n||H.length!==k||H.some(row=>row.length!==k||!row.every(Number.isFinite))||C.length!==n||C.some(row=>row.length!==k||!Array.from(row).every(Number.isFinite))||errors.length!==pins.length||errors.some(e=>!vector(e)))throw Error('Invalid matrix-free coupled system.');
    const inverse=factor(H),linear=basis.flatMap((directions,i)=>directions.map(d=>-dot(d,errors[i]))),free=inverse(linear.map(v=>-v)),blocks=basis.map((directions,i)=>{const at=starts[i],end=at+directions.length,matrix=H.slice(at,end).map(row=>row.slice(at,end));return {at,end,matrix,inverse:factor(matrix)};}),cache=new Map();
    const transpose=values=>{const out=Array(k).fill(0);for(let i=0;i<n;i++)for(let j=0;j<k;j++)out[j]+=C[i][j]*values[i];return out;};
    let applications=0,columnApplications=0,normalSolves=0,blockIterations=0;
    const apply=(v,out)=>{applications++;return normal.apply(v,out);},column=(id,out=new Float64Array(n))=>{
      if(!cache.has(id)){if(cache.size===64)cache.delete(cache.keys().next().value);let value;if(normal.column)value=normal.column(id,out)||out;else{const unit=new Float64Array(n);unit[id]=1;value=normal.apply(unit,out)||out;}if(value.length!==n||!Array.from(value).every(Number.isFinite))throw Error('Invalid coupled normal column.');cache.set(id,Float64Array.from(value));applications++;columnApplications++;}
      out.set(cache.get(id));return out;
    };
    const schurApply=(v,out=new Float64Array(n))=>{const value=apply(v,out)||out,correction=inverse(transpose(v));for(let i=0;i<n;i++)value[i]-=dot(C[i],correction);return value;},schurColumn=(id,out=new Float64Array(n))=>{column(id,out);const correction=inverse(C[id]);for(let i=0;i<n;i++)out[i]-=dot(C[i],correction);return out;},schurDiagonal=normal.diagonal.map((value,i)=>value-dot(C[i],inverse(C[i]))),schurBase=normal.base.map((value,i)=>value+dot(C[i],free));
    return call=>{
      const caps=call.pins.map(pin=>pin.cap??Infinity),tolerance=call.tolerance??1e-9;if(caps.some(v=>v<0||!Number.isFinite(v)&&v!==Infinity)||!(tolerance>0&&Number.isFinite(tolerance)))throw Error('Invalid coupled force cap or tolerance.');
      const runNormal=(schur,base,warm)=>{normalSolves++;return normalLCP({size:n,apply:schur?schurApply:apply,column:schur?schurColumn:column,diagonal:schur?schurDiagonal:normal.diagonal,base,bounds:call.normalBounds,tolerance,warm});};
      let f,normalResult,iterations=0,fast=false;
      if(caps.every(cap=>cap===0)){f=Array(k).fill(0);normalResult=runNormal(false,normal.base,call.warm?.normalForces);fast=true;}
      else{
        normalResult=runNormal(true,schurBase,call.warm?.normalForces);const correction=inverse(transpose(normalResult.forces));f=free.map((value,j)=>value-correction[j]);
        fast=normalResult.converged&&blocks.every(({at,end},i)=>norm(f.slice(at,end))<=caps[i]+1e-9);
      }
      const pinResidual=()=>{
        const cross=transpose(normalResult.forces),gradient=H.map((row,j)=>dot(row,f)+cross[j]+linear[j]);let worst=0;
        for(let i=0;i<blocks.length;i++){if(caps[i]===0)continue;const {at,end}=blocks[i],force=f.slice(at,end),g=gradient.slice(at,end),length=norm(force),mu=length>=caps[i]*(1-1e-9)?Math.max(0,-dot(g,force)/(length*length||1)):0;worst=Math.max(worst,norm(g.map((v,j)=>v+mu*force[j])));}
        return worst;
      };
      if(!fast){
        if(call.warm?.forces){if(call.warm.forces.length!==pins.length||call.warm.forces.some(v=>!vector(v)))throw Error('Invalid coupled warm forces.');f=basis.flatMap((directions,i)=>directions.map(d=>dot(d,call.warm.forces[i])));}
        blocks.forEach(({at,end},i)=>{const length=norm(f.slice(at,end));if(length>caps[i])for(let j=at;j<end;j++)f[j]*=caps[i]/length;});
        for(iterations=1;iterations<=640;iterations++){
          const cross=transpose(normalResult.forces);
          for(let i=0;i<blocks.length;i++){
            const {at,end,matrix,inverse:blockSolve}=blocks[i],old=f.slice(at,end),rhs=old.map((_,j)=>dot(matrix[j],old)-dot(H[at+j],f)-cross[at+j]-linear[at+j]),next=ball(matrix,rhs,caps[i],blockSolve);next.forEach((value,j)=>{f[at+j]=value;});
          }
          normalResult=runNormal(false,normal.base.map((value,i)=>value+dot(C[i],f)),normalResult.forces);blockIterations++;
          if(!normalResult.converged||Math.max(pinResidual(),normalResult.residual)<=tolerance)break;
        }
      }
      const forces=basis.map((directions,i)=>[0,1,2].map(axis=>directions.reduce((sum,d,j)=>sum+d[axis]*f[starts[i]+j],0))),pinError=pinResidual(),residual=Math.max(pinError,normalResult.residual),feasibility=Math.max(normalResult.feasibility,0,...forces.map((force,i)=>norm(force)-caps[i])),converged=normalResult.converged&&residual<=tolerance&&feasibility<=1e-9;
      const warm={forces:forces.map(v=>v.slice()),normalForces:normalResult.forces.slice(),boundMultipliers:normalResult.boundMultipliers?.slice()||[]};
      return {forces,normalForces:normalResult.forces,boundMultipliers:normalResult.boundMultipliers||[],normalBoundResidual:normalResult.boundResidual||0,residual,pinResidual:pinError,normalResidual:normalResult.residual,feasibility,converged,iterations,fast,applications,columnApplications,normalSolves,blockIterations,normalRows:n,pinDOFs:k,cachedColumns:cache.size,warm};
    };
  }
  function solveCoupled(problem){const backend=coupledSystem(problem);return solvePressure(problem,backend);}
  return {solve,normalLCP,solveCoupled,frictionResidual};
});
