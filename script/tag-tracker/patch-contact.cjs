// Coupled compliance mathematics only: no DOM, device, cloth trajectory or rigid integration.
module.exports=function({check}){
  const Q=require('../../tag-tracker/patch-contact-core'),near=(a,b,tol=1e-8)=>Math.abs(a-b)<tol,norm=a=>Math.hypot(...a),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),sub=(a,b)=>a.map((v,i)=>v-b[i]),scale=(a,s)=>a.map(v=>v*s);
  const pin=(body=null,point=[0,0,0],cap=Infinity)=>({body,point,cap}),zero=[0,0,0],dt=1/240;
  let r=Q.solve({S:[[.002]],pins:[pin()],contacts:[],errors:[[.003,-.006,.009]],stiffness:[100],dt});
  check(r.converged&&r.forces[0].every((v,i)=>near(v,[.25,-.5,.75][i]))&&r.bodyOffsets.size===0,'a free finite patch solves its elastic compliance exactly without rigid-body mutation');
  const body={t:[0,0,0],invM:1/1.2,iW:Array(9).fill(0)},before=JSON.stringify(body);
  r=Q.solve({S:[[.0001]],pins:[pin(body)],errors:[[.001,0,0]],stiffness:[1000],dt});
  const expected=.001/(.0001+.001+dt*dt/1.2),offset=r.bodyOffsets.get(body);
  check(r.converged&&near(r.forces[0][0],expected)&&near(offset.translation[0],-expected*dt*dt/1.2)&&JSON.stringify(body)===before,'a dynamic hand contributes its real translational compliance and gets the equal opposite virtual response');
  const shared={t:zero,invM:2,iW:Array(9).fill(0)},base={S:[[.003]],pins:[pin(shared)],errors:[[0,0,.002]],stiffness:[100],dt:.1};
  r=Q.solve({...base,contacts:[{row:[[0,1]],normal:[0,0,1],point:zero,body:shared,compliance:.005,base:-.003}]});
  const det=.033*.028-.023**2,force=(.002*.028-.023*.003)/det,normal=(.033*.003-.023*.002)/det;
  check(r.converged&&near(r.forces[0][2],force)&&near(r.normalForces[0],normal)&&near(r.total[0][2],force+normal)&&near(r.bodyOffsets.get(shared).translation[2],-.02*(force+normal)),'shared-body pin/normal cross terms match the analytic coupled2×2 solution and reaction signs');
  const other={t:zero,invM:1,iW:Array(9).fill(0)};
  r=Q.solve({...base,pins:[pin(other)],contacts:[{row:[[0,1]],normal:[0,0,1],point:zero,body:shared,compliance:.005,base:-.003}]});
  const separate=.023*.028-.003**2,fp=(.002*.028-.003*.003)/separate,fn=(.023*.003-.003*.002)/separate;
  check(r.converged&&near(r.forces[0][2],fp)&&near(r.normalForces[0],fn)&&near(r.bodyOffsets.get(other).force[2],-fp)&&near(r.bodyOffsets.get(shared).force[2],-fn),'different rigid bodies couple through cloth only and each receives its own force');
  const spinning={t:zero,invM:1,iW:[1,0,0,0,2,0,0,0,3]},error=[.02,.03,.01],diagonal=[.012,.042,.032],cap=.5;
  r=Q.solve({S:[[.001]],pins:[pin(spinning,[1,0,0],cap)],errors:[error],stiffness:[1000],dt:.1});
  const f=r.forces[0],gradient=f.map((v,i)=>diagonal[i]*v-error[i]),mu=-dot(gradient,f)/(cap*cap),unconstrained=error.map((v,i)=>v/diagonal[i]),clipped=scale(unconstrained,cap/norm(unconstrained));
  check(r.converged&&near(norm(f),cap)&&mu>0&&norm(gradient.map((v,i)=>v+mu*f[i]))<1e-8&&norm(sub(f,clipped))>.03,'an anisotropic active force ball solves(A+muI)f=rhs rather than clipping the wrong unconstrained direction');
  check(norm(sub(r.bodyOffsets.get(spinning).force,scale(f,-1)))<1e-9&&near(r.bodyOffsets.get(spinning).rotation[1],.02*f[2])&&near(r.bodyOffsets.get(spinning).rotation[2],-.03*f[1]),'off-axis patch forces return the correct world torque and inverse-inertia response');
  r=Q.solve({S:[[.001]],pins:[pin(null,zero,.2)],errors:[[0,0,-.01]],stiffness:[100],dt,contacts:[{row:[[0,1]],normal:[0,0,1],point:zero,compliance:.0001,base:-.001}]});
  check(r.converged&&near(r.forces[0][2],-.2)&&near(r.normalForces[0],1.2/1.1)&&near(-.001+.001*r.forces[0][2]+.0011*r.normalForces[0],0),'an active friction cap and unilateral support satisfy the same coupled complementarity problem');
  r=Q.solve({S:[[.001,0],[0,.001]],pins:[pin(),pin()],errors:[zero,zero],stiffness:[100,100],dt,contacts:[{row:[[0,1],[1,-1]],normal:[0,0,1],point:zero,compliance:0,base:-.0006}]});
  check(r.converged&&near(r.normalForces[0],.33)&&near(r.total[0][2],.3)&&near(r.total[1][2],-.3)&&r.bodyOffsets.size===0,'two free material layers exchange equal opposite normals without an invented rigid support');
  r=Q.solve({S:[[.002]],pins:[{...pin(),axes:[[1,0,0],[0,0,1]]}],errors:[[.003,1,-.006]],stiffness:[100],dt,contacts:[{row:[[0,1]],normal:[0,1,0],point:zero,compliance:.001,base:-.003}]});
  check(r.converged&&near(r.forces[0][0],.25)&&near(r.forces[0][1],0)&&near(r.forces[0][2],-.5)&&near(r.normalForces[0],1)&&near(r.total[0][1],1),'tangent-only pad friction has no normal adhesion; rubber/contact normals remain independent');
  r=Q.solve({S:[[1e-8]],pins:[pin(body,zero,.6)],errors:[zero],stiffness:[6000],dt,contacts:[{row:[[0,1]],normal:[0,0,1],point:zero,body,compliance:1/18000,base:-.000133}]});
  check(r.converged&&r.normalForces[0]>1&&r.normalForces[0]<3&&norm(r.forces[0])<.6&&norm(r.bodyOffsets.get(body).translation)<.0001,'a trapped133micron toe interference gets a finite elastic/dynamic response without a force ceiling or tiny artificial regularizer');
  const rotated={t:[2,-1,3],invM:1,iW:[2,0,0,0,1,0,0,0,3]},turn=v=>[-v[1],v[0],v[2]];
  const q=Q.solve({S:[[.001]],pins:[pin(rotated,[2,0,3],cap)],errors:[turn(error)],stiffness:[1000],dt:.1});
  check(q.converged&&norm(sub(q.forces[0],turn(f)))<1e-8&&norm(sub(q.bodyOffsets.get(rotated).translation,turn(scale(f,-.01))))<1e-8,'rotating and translating the complete anisotropic capped problem preserves world-frame force and displacement');
  r=Q.solve({S:[[.001]],pins:[pin(null,zero,0)],errors:[[1,2,3]],stiffness:[100],dt});
  check(r.converged&&norm(r.forces[0])===0,'an open or released zero-cap patch applies no retained force');
  const normalOnly={S:[[.001]],pins:[{...pin(),axes:[]}],errors:[zero],stiffness:[100],dt,contacts:[{row:[[0,1]],normal:[0,0,1],point:zero,compliance:.0001,base:-.0003}]};normalOnly.pins[0].cap=0;
  r=Q.solve(normalOnly);
  check(r.converged&&r.iterations===0&&norm(r.forces[0])===0&&near(r.normalForces[0],.3/1.1)&&near(r.total[0][2],.3/1.1),'normal-only material samples need no dummy tangent variables or pin factorization');
  for(const layers of [1,2,4]){
    const K=9000,preload=1.2,S=Array.from({length:layers},()=>Array(layers).fill(0)),contacts=Array.from({length:layers},(_,i)=>({row:[[i,1]],normal:[0,1,0],point:zero,compliance:1e-12,base:-preload/K+i*.0006})),normalCompliance=contacts.map(()=>contacts.map(()=>1/K));
    const q=Q.solve({S,pins:contacts.map(()=>pin(null,zero,0)),errors:contacts.map(()=>zero),stiffness:contacts.map(()=>1000),dt,contacts,normalCompliance});
    check(q.converged&&near(q.normalForces.reduce((a,b)=>a+b,0),preload,1e-7)&&q.normalForces.slice(1).every(v=>v===0),`one shared rubber-jaw bulk mode retains its actual preload with${layers} material layers rather than diluting pressure`);
  }
  let invalid=0;
  for(const normalCompliance of [[[1,2],[2,1]],[[1,0],[1,1]],[[NaN,0],[0,1]]])try{
    Q.solve({S:[[.001,0],[0,.001]],pins:[pin(),pin()],errors:[zero,zero],stiffness:[100,100],dt,contacts:[0,1].map(i=>({row:[[i,1]],normal:[0,1,0],point:zero,compliance:1e-12,base:0})),normalCompliance});
  }catch(e){if(/finite symmetric positive semidefinite/.test(e.message))invalid++;}
  check(invalid===3,'shared normal compliance rejects indefinite, asymmetric or nonfinite material tensors');
  const fixture=require('./patch-contact-fixture.json'),bodies=fixture.bodies.map(body=>({...body})),captured={...fixture,pins:fixture.pins.map(pin=>({...pin,body:pin.body===null?null:bodies[pin.body]})),contacts:fixture.contacts.map(contact=>({...contact,body:contact.body===null?null:bodies[contact.body]}))};
  const strict=Q.solve(captured),physical=Q.solve({...captured,tolerance:3e-7});
  check(strict.converged&&strict.residual<1e-9&&strict.iterations<40&&strict.feasibility<=1e-9,'the captured six-patch27-normal rubber problem solves redundant pressures together at strict tolerance');
  check(physical.converged&&physical.residual<3e-7&&physical.feasibility<=1e-9&&physical.iterations<=strict.iterations&&physical.forces.every((f,i)=>norm(f)<=captured.pins[i].cap+1e-9)&&physical.normalForces.every(v=>v>=-1e-9),'an explicit physical displacement tolerance never loosens force-ball or nonnegative-pressure feasibility');
  // A rotating hand couples lifting friction to the opposing normal pressure.
  // This has a closed-form cap root; three one-way cap decreases would stick at0.
  const rotor={t:zero,invM:0,iW:[1,0,0,0,0,0,0,0,0]},supported={S:[[.01]],pins:[{body:rotor,point:[0,1,0],axes:[[0,0,1]],cap:1.5}],errors:[[0,0,1]],stiffness:[100],dt:1,contacts:[{row:[[0,1]],normal:[0,1,0],point:[0,0,-1],body:rotor,compliance:.1,base:-.2},{row:[[0,1]],normal:[0,-1,0],point:[0,0,1],body:rotor,compliance:.1,base:-.2}],pressureGroups:[{pins:[0],normal:1,sides:[[[0,1]],[[1,1]]]}]};
  const supportedResult=Q.solve(supported),fSupport=supportedResult.forces[0][2],pressure=supportedResult.normalForces;
  check(supportedResult.converged&&near(fSupport,1/12)&&pressure.every(p=>near(p,1/18))&&near(-.2+fSupport+2.1*pressure[0],0)&&supportedResult.pressureFeasibility<=1e-9,'pressure-dependent friction converges to the analytic support root while preserving the unmodified normal complementarity law');
  const inactive=Q.solve({...supported,errors:[[0,0,2*.2/2.1]]});
  check(inactive.converged&&norm(inactive.forces[0])<1e-9&&inactive.pressureEvaluations===2&&inactive.support[0].applied>inactive.support[0].normal&&inactive.pressureResidual===0,'inactive nominal caps exit immediately when actual tangent forces already satisfy actual pressure');
  const noContact={...supported,contacts:supported.contacts.map(c=>({...c,point:scale(c.point,-1),base:.02}))},unsafe=Q.solve({...noContact,pressureGroups:undefined}),causal=Q.solve(noContact);
  check(unsafe.normalForces.some(v=>v>0)&&causal.converged&&norm(causal.forces[0])===0&&causal.normalForces.every(v=>v===0)&&!causal.support[0].causal,'a zero-friction normal baseline prevents a pin from manufacturing its own opposing support');
  const excluded=Q.solve({...supported,S:[[.01,0],[0,.01]],pins:[{...supported.pins[0],cap:.75},{...supported.pins[0],cap:0}],errors:[[0,0,1],[0,0,10]],stiffness:[100,100],pressureGroups:[{...supported.pressureGroups[0],pins:[0,1]}]});
  check(excluded.converged&&norm(excluded.forces[1])===0&&excluded.caps[1]===0&&near(excluded.forces[0][2],1/19)&&excluded.pressureFeasibility<=1e-9,'a physically excluded sample stays zero without redistributing its lost friction area');
  const coupledContacts=[];for(let i=0;i<2;i++)for(const sign of [1,-1])coupledContacts.push({row:[[i,1]],normal:[0,sign,0],point:[0,0,-sign*[1,.8][i]],body:rotor,compliance:.1,base:-[.2,.16][i]});
  const coupled=Q.solve({S:[[.01,.002],[.002,.01]],pins:[1,1.2].map(r=>({body:rotor,point:[0,r,0],axes:[[0,0,1]],cap:1.5})),contacts:coupledContacts,errors:[[0,0,1],[0,0,.8]],stiffness:[100,100],dt:1,pressureGroups:[0,1].map(i=>({pins:[i],normal:1,sides:[[[2*i,1]],[[2*i+1,1]]]}))});
  check(coupled.converged&&coupled.pressureFeasibility<=1e-9&&coupled.pressureResidual<1e-8&&coupled.forces.every((f,i)=>norm(f)<=1.5*Math.min(...coupled.support[i].pressure)+1e-9),'two rotationally coupled grips converge together with every force below its own solved opposing-pressure bound');
  // Seeded interacting caps/contacts are checked through physical displacement
  // and constitutive laws, independently of the helper's assembled matrix.
  let seed=37,valid=true,worst=0,maxIterations=0;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  for(let sample=0;sample<80;sample++){
    const count=2+sample%4,L=Array.from({length:count},(_,i)=>Array.from({length:count},(_,j)=>j<=i?(i===j?.03:.01*(random()-.5)):0)),S=L.map(a=>L.map(b=>dot(a,b))),body={t:zero,invM:1/1.2,iW:[250,0,0,0,250,0,0,0,500]},pins=Array.from({length:count},()=>pin(body,[(random()-.5)*.03,(random()-.5)*.03,-.1+random()*.03],.03+random()*.2)),errors=pins.map(()=>[.01*(random()-.5),.01*(random()-.5),.01*(random()-.5)]),stiffness=pins.map(()=>500+random()*4000),contacts=Array.from({length:count*2},(_,i)=>({row:[[i%count,1]],normal:[i%3===0?1:0,i%3===1?1:0,i%3===2?1:0],point:pins[i%count].point,body:i%2?body:null,compliance:1/18000,base:(random()-.6)*.003}));
    const q=Q.solve({S,pins,contacts,errors,stiffness,dt}),shift=S.map(row=>[0,1,2].map(k=>row.reduce((sum,s,i)=>sum+s*q.total[i][k],0))),bodyShift=(body,point)=>{const o=q.bodyOffsets.get(body);return o?o.translation.map((v,k)=>v+cross(o.rotation,sub(point,body.t))[k]):zero;};
    valid&&=q.converged;worst=Math.max(worst,q.residual);maxIterations=Math.max(maxIterations,q.iterations);
    for(let i=0;i<count;i++){
      const targetShift=bodyShift(pins[i].body,pins[i].point),spring=errors[i].map((v,k)=>(v-shift[i][k]+targetShift[k])*stiffness[i]),length=norm(spring),expected=length>pins[i].cap?scale(spring,pins[i].cap/length):spring;
      valid&&=norm(q.forces[i])<=pins[i].cap+1e-9&&norm(sub(q.forces[i],expected))<1e-5;
    }
    contacts.forEach((c,i)=>{const clothShift=c.row.reduce((out,[j,s])=>out.map((v,k)=>v+s*shift[j][k]),[0,0,0]),gap=c.base+dot(c.normal,sub(clothShift,bodyShift(c.body,c.point)))+c.compliance*q.normalForces[i];valid&&=q.normalForces[i]>=0&&gap>=-1e-8&&Math.abs(q.normalForces[i]*gap)<1e-8;});
  }
  check(valid&&worst<1e-8&&maxIterations<640,'eighty seeded multi-patch problems satisfy force balls, moving-body spring laws and unilateral complementarity');
  let denseAgreement=true,maxDifference=0;seed=71;
  for(let sample=0;sample<100;sample++){
    const n=2+sample%14,L=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>j<=i?(i===j?.1+random():.3*(random()-.5)):0)),A=L.map(a=>L.map(b=>dot(a,b))),base=Array.from({length:n},()=>random()-.6),apply=v=>A.map(row=>dot(row,v)),dense=Q.solve({S:A,pins:Array.from({length:n},()=>({cap:0,axes:[]})),errors:Array.from({length:n},()=>zero),stiffness:Array(n).fill(1),dt:1,contacts:base.map((v,i)=>({row:[[i,1]],normal:[0,0,1],point:zero,base:v,compliance:0}))}),sparse=Q.normalLCP({size:n,apply,diagonal:A.map((row,i)=>row[i]),base,tolerance:1e-10}),gap=apply(sparse.forces).map((v,i)=>v+base[i]);
    const difference=Math.max(...sparse.forces.map((v,i)=>Math.abs(v-dense.normalForces[i])));maxDifference=Math.max(maxDifference,difference);
    denseAgreement&&=sparse.converged&&sparse.forces.every((v,i)=>v>=0&&gap[i]>=-1e-10&&Math.abs(v*gap[i])<1e-8)&&difference<1e-6;
  }
  check(denseAgreement&&maxDifference<1e-6,'the matrix-free normal solver matches100 deterministic dense complementarity oracles with true nonnegative forces');
  const normalFixture=require('./normal-contact-fixture.json'),nfApply=v=>normalFixture.A.map(row=>dot(row,v)),nf=Q.normalLCP({...normalFixture,size:normalFixture.base.length,apply:nfApply});
  check(nf.converged&&nf.residual<1e-10&&nf.feasibility===0&&nf.applications<=12&&nf.peakActive<=10,'the captured48-row cuff descent queries only its active support columns and satisfies its physical operator below a nanometre');
  let fullApplications=0,columnApplications=0;const nfFast=Q.normalLCP({...normalFixture,size:normalFixture.base.length,apply:v=>{fullApplications++;return nfApply(v);},column:i=>{columnApplications++;return normalFixture.A.map(row=>row[i]);}});
  check(nfFast.converged&&fullApplications===1&&columnApplications===10&&nfFast.forces.every((f,i)=>near(f,nf.forces[i],1e-10)),'an exact sparse-column callback preserves the solve and still checks the final force through the full physical response');
  const wrongColumn=Q.normalLCP({size:2,apply:v=>[2*v[0],4*v[1]],column:i=>[+(i===0),+(i===1)],diagonal:[2,4],base:[-1,-2],tolerance:1e-12});
  check(wrongColumn.converged&&wrongColumn.residual<1e-12&&wrongColumn.forces.every(v=>near(v,.5)),'a mismatched fast column is rejected by the full operator check and corrected by matrix-free CG');
  const size=1536,groups=4,perGroup=size/groups,K=9000,B=dt*dt/1.2,largeDiagonal=Array(size).fill(1e-12+B+1/K),preload=[1,2,.5,1.3],largeBase=Array.from({length:size},(_,i)=>-preload[Math.floor(i/perGroup)]/K),apply=(v,out=new Float64Array(size))=>{
    const sum=[0,0,0,0];for(let i=0;i<size;i++)sum[Math.floor(i/perGroup)]+=v[i];const total=sum.reduce((a,b)=>a+b,0);
    for(let i=0;i<size;i++)out[i]=1e-12*v[i]+B*total+sum[Math.floor(i/perGroup)]/K;return out;
  },large=Q.normalLCP({size,apply,diagonal:largeDiagonal,base:largeBase,tolerance:1e-10}),groupForces=preload.map((_,group)=>large.forces.slice(group*perGroup,(group+1)*perGroup).reduce((a,b)=>a+b,0)),expectedOffset=K*B*preload.reduce((a,b)=>a+b,0)/(1+groups*K*B),trueGap=apply(large.forces).map((v,i)=>v+largeBase[i]);
  check(large.converged&&large.forces.length===size&&large.forces.every(v=>v>=0)&&large.feasibility===0&&Math.max(...trueGap.map(Math.abs))<1e-10&&groupForces.every((v,i)=>near(v,preload[i]-expectedOffset,1e-7))&&large.applications<10,'all1536 nearly redundant normal constraints retain shared-body/rubber pressure and satisfy the physical KKT gap without a dense matrix');
  const warmed=Q.normalLCP({size,apply,diagonal:largeDiagonal,base:largeBase,tolerance:1e-10,warm:large.forces});
  check(warmed.converged&&warmed.iterations===0&&warmed.applications===1&&warmed.forces.every((v,i)=>near(v,large.forces[i],1e-12)),'matrix-free warm states are checked against the actual response before reuse');
  const broadSize=257,broadExpected=Array.from({length:broadSize},(_,i)=>.5+.2*Math.sin(i)),broadApply=(v,out=new Float64Array(broadSize))=>{const sum=v.reduce((s,f)=>s+f,0);for(let i=0;i<broadSize;i++)out[i]=.2*v[i]+.03*sum;return out;},broadBase=Array.from(broadApply(broadExpected),v=>-v),broad=Q.normalLCP({size:broadSize,apply:broadApply,diagonal:Array(broadSize).fill(.23),base:broadBase,tolerance:1e-10});
  check(broad.converged&&broad.activeWorkspaceLimited&&broad.peakActive<broadSize&&broad.peakActiveWorkspaceBytes<=broad.maxActiveWorkspaceBytes&&broad.forces.every((v,i)=>v>0&&near(v,broadExpected[i],1e-8))&&broad.residual<1e-10,'a257-contact fully active face continues with matrix-free CG after the byte-bounded column workspace fills without dropping pressure constraints');
  const conditionedSize=96,conditionedDiagonal=Array.from({length:conditionedSize},(_,i)=>1e-6*(1+i/conditionedSize)),conditionedTruth=Array.from({length:conditionedSize},(_,i)=>.01*(1+.2*Math.sin(i))),conditionedApply=(v,out=new Float64Array(conditionedSize))=>{const total=v.reduce((s,x)=>s+x,0);for(let i=0;i<conditionedSize;i++)out[i]=total+conditionedDiagonal[i]*v[i];return out;},conditionedProblem={size:conditionedSize,apply:conditionedApply,column:(j,out=new Float64Array(conditionedSize))=>{out.fill(1);out[j]+=conditionedDiagonal[j];return out;},diagonal:conditionedDiagonal.map(v=>1+v),base:Array.from(conditionedApply(conditionedTruth),v=>-v),tolerance:1e-10},conditioned=Q.normalLCP(conditionedProblem),faceWarm=Q.normalLCP({...conditionedProblem,warm:conditioned.forces.map(v=>v*.9)});
  check(conditioned.converged&&conditioned.iterations===0&&conditioned.peakActive===conditionedSize&&conditioned.activeFactorizations===conditionedSize&&conditioned.residual<=1e-10&&conditioned.forces.every((v,i)=>near(v,conditionedTruth[i],1e-8))&&conditioned.peakActiveWorkspaceBytes<=conditioned.maxActiveWorkspaceBytes,
    'more than64 active contact-conditioned pressure modes are solved without a hard face cutoff, a physical diagonal or a larger iteration budget');
  check(conditioned.activeRefactorizations===1&&conditioned.activeExtensions===conditionedSize-1&&conditioned.columnApplications===conditionedSize,
    'a growing active pressure face extends the unchanged Cholesky prefix instead of refactoring all prior rows');
  check(faceWarm.converged&&faceWarm.warmActiveSeeded===conditionedSize&&faceWarm.activeFactorizations===1&&faceWarm.pivotIterations===0&&faceWarm.forces.every((v,i)=>near(v,conditionedTruth[i],1e-8))&&faceWarm.residual<=1e-10,
    'a positive feasible warm support is factored once and still checked through every row of the actual normal operator');
  const changedFace=Q.normalLCP({size:3,apply:v=>v,diagonal:[1,1,1],base:[-1,.2,-.8],warm:[.9,.2,0],tolerance:1e-12});
  check(changedFace.converged&&changedFace.warmActiveSeeded===2&&changedFace.forces.every((v,i)=>near(v,[1,0,.8][i],1e-12))&&changedFace.activeFactorizations>1,
    'a changed warm support removes separated pressure and adds newly closing contacts instead of locking the old active set');
  check(changedFace.activeRefactorizations===2&&changedFace.activeExtensions===1,
    'removing an old active row rebuilds the physical factor before a later contact can extend its new prefix');
  const memorySize=160,memoryTruth=Array.from({length:memorySize},(_,i)=>1+i/memorySize),memoryProblem={size:memorySize,apply:v=>v,diagonal:Array(memorySize).fill(1),base:memoryTruth.map(v=>-v),tolerance:1e-12,maxActiveWorkspaceBytes:0},memory=Q.normalLCP(memoryProblem),warmMemory=Q.normalLCP({...memoryProblem,warm:memoryTruth.map(v=>.9*v)});
  check(memory.converged&&warmMemory.converged&&memory.activeWorkspaceLimited&&warmMemory.activeWorkspaceLimited&&memory.columnApplications===0&&warmMemory.columnApplications===0&&memory.peakActiveWorkspaceBytes===0&&warmMemory.peakActiveWorkspaceBytes===0&&memory.forces.every((v,i)=>near(v,memoryTruth[i],1e-12))&&warmMemory.forces.every((v,i)=>near(v,memoryTruth[i],1e-12)),
    'an explicit zero active-workspace budget selects vector-only continuation before active allocations and retains all cold and warm pressure constraints');
  const rankSize=80,rankApply=(v,out=new Float64Array(rankSize))=>{out.set(v);out[0]=out[1]=v[0]+v[1];return out;},rankBase=Array(rankSize).fill(1);rankBase[0]=rankBase[1]=-1;const rankWarm=Array(rankSize).fill(0);rankWarm[0]=rankWarm[1]=1;
  const rank=Q.normalLCP({size:rankSize,apply:rankApply,diagonal:Array(rankSize).fill(1),base:rankBase,warm:rankWarm,tolerance:1e-12});
  check(rank.converged&&rank.activeFaceRejected&&rank.activeFactorizations===1&&rank.warmActiveSeeded===2&&near(rank.forces[0]+rank.forces[1],1,1e-12)&&rank.residual<=1e-12&&rank.forces.every(v=>v>=0),
    'an exactly dependent warm pressure face rejects Cholesky and uses the original matrix-free law without adding compliance');
  let modeValid=true,maxModeApplications=0;seed=79;
  for(let sample=0;sample<30;sample++){
    const n=96,modes=8,rows=Array.from({length:n},()=>Array.from({length:modes},()=>random()-.5)),expected=Array.from({length:n},(_,i)=>i%7===0?.1+random():0),response=(v,out=new Float64Array(n))=>{const modesValue=Array(modes).fill(0);for(let i=0;i<n;i++)for(let k=0;k<modes;k++)modesValue[k]+=rows[i][k]*v[i];for(let i=0;i<n;i++){out[i]=.001*v[i];for(let k=0;k<modes;k++)out[i]+=rows[i][k]*modesValue[k];}return out;},base=Array.from(response(expected),(v,i)=>-v+(expected[i]>0?0:.01+random())),solution=Q.normalLCP({size:n,apply:response,diagonal:rows.map(row=>.001+dot(row,row)),base,tolerance:1e-10}),gap=Array.from(response(solution.forces),(v,i)=>v+base[i]);
    modeValid&&=solution.converged&&solution.forces.every((v,i)=>v>=0&&near(v,expected[i],1e-8)&&gap[i]>=-1e-10&&Math.abs(v*gap[i])<1e-10);maxModeApplications=Math.max(maxModeApplications,solution.applications);
  }
  check(modeValid&&maxModeApplications<=20,'thirty96-contact shared-mode systems recover their independently constructed pressure and open-gap solutions with bounded active-column evaluations');
  const bounded=Q.normalLCP({size:2,apply:v=>v.map(x=>.0001*x),column:i=>[i===0?.0001:0,i===1?.0001:0],diagonal:[.0001,.0001],base:[-.02,-.02],bounds:[{row:[.5,.5],max:60}],tolerance:1e-12});
  check(bounded.converged&&bounded.forces.every(v=>near(v,60))&&near(bounded.boundMultipliers[0],.028)&&bounded.boundResidual<=1e-9&&bounded.boundIterations===1,'two jaws share a60N actuator bound whose multiplier is real additional opening at force saturation');
  const faceChange=Q.normalLCP({size:2,apply:v=>v,diagonal:[1,1],base:[-3,-1],bounds:[{row:[1,1],max:.5}],tolerance:1e-12});
  check(faceChange.converged&&near(faceChange.forces[0],.5)&&faceChange.forces[1]===0&&near(faceChange.boundMultipliers[0],2.5)&&faceChange.boundIterations===2,'saturation re-identifies an opening contact face while keeping every pressure nonnegative');
  const transfer=Q.normalLCP({size:2,apply:v=>[.35*v[0]+.25*v[1],.25*v[0]+.35*v[1]],diagonal:[.35,.35],base:[-.5,-1],bounds:[{row:[.5,.5],max:1}],tolerance:1e-12});
  check(transfer.converged&&transfer.forces[0]===0&&near(transfer.forces[1],2)&&near(transfer.boundMultipliers[0],.6),'a deeper simultaneous contact transfers saturated pressure away from a separating earlier contact');
  const signedBound=Q.normalLCP({size:2,apply:v=>v,diagonal:[1,1],base:[-5,-1],bounds:[{row:[1,-1],max:2},{row:[-1,1],max:2}],tolerance:1e-12});
  check(signedBound.converged&&near(signedBound.forces[0],4)&&near(signedBound.forces[1],2)&&near(signedBound.boundMultipliers[0],1)&&signedBound.boundMultipliers[1]===0,'signed carrier loads support opposing force limits without granting a second actuator budget');
  const priorLoad=Q.normalLCP({size:2,apply:v=>v,diagonal:[1,1],base:[0,0],bounds:[{row:[-1,0],max:-1}],tolerance:1e-12});
  check(priorLoad.converged&&near(priorLoad.forces[0],1)&&priorLoad.forces[1]===0&&near(priorLoad.boundMultipliers[0],1),'a signed contact can balance an existing carrier load even when zero additional pressure is not feasible');
  const normalBounded=Q.solve({...normalOnly,contacts:[{...normalOnly.contacts[0],base:-.01}],normalBounds:[{row:[1],max:2}]});
  check(normalBounded.converged&&near(normalBounded.normalForces[0],2)&&near(normalBounded.boundMultipliers[0],.0078)&&normalBounded.normalBoundResidual<=1e-9,'the dense captured-patch normal block uses the same bounded complementarity law and physical opening multiplier');
  const pressureBounded=Q.solve({...supported,normalBounds:[{row:[.5,.5],max:.03}]});
  check(pressureBounded.converged&&pressureBounded.normalForces.every(v=>near(v,.03))&&near(pressureBounded.forces[0][2],.045)&&pressureBounded.pressureFeasibility<=1e-9&&pressureBounded.normalBoundResidual<=1e-9,'pressure-dependent friction preserves the shared actuator bound through its support-root solves');
  let boundsValid=true,maxBoundsIterations=0;seed=31;
  for(let sample=0;sample<100;sample++){
    const count=3+sample%10,modes=Array.from({length:count},()=>Array.from({length:3},()=>random()-.5)),A=modes.map((a,i)=>modes.map((b,j)=>dot(a,b)+(i===j?.2:0))),truth=Array.from({length:count},(_,i)=>i%3===0?0:.1+random()),U=Array.from({length:2},()=>Array.from({length:count},()=>.1+random())),eta=[.1+random(),.1+random()],base=A.map((a,i)=>-dot(a,truth)-U.reduce((s,row,j)=>s+row[i]*eta[j],0)+(truth[i]===0?.1+random():0)),bounds=U.map(row=>({row,max:dot(row,truth)})),solution=Q.normalLCP({size:count,apply:v=>A.map(row=>dot(row,v)),column:j=>A.map(row=>row[j]),diagonal:A.map((row,i)=>row[i]),base,bounds,tolerance:1e-11});
    const gap=A.map((row,i)=>dot(row,solution.forces)+base[i]+U.reduce((s,row,j)=>s+row[i]*solution.boundMultipliers[j],0));
    boundsValid&&=solution.converged&&solution.forces.every((v,i)=>v>=0&&near(v,truth[i],1e-8)&&gap[i]>=-1e-10&&Math.abs(v*gap[i])<1e-10)&&bounds.every((b,j)=>dot(b.row,solution.forces)<=b.max+1e-9&&solution.boundMultipliers[j]>=0&&Math.abs(solution.boundMultipliers[j]*(dot(b.row,solution.forces)-b.max))<1e-9);maxBoundsIterations=Math.max(maxBoundsIterations,solution.boundIterations);
  }
  check(boundsValid&&maxBoundsIterations<=8,'one hundred coupled two-actuator systems satisfy independently constructed force, pressure, bound and multiplier KKT solutions');
  const largeBound=Q.normalLCP({size:broadSize,apply:broadApply,diagonal:Array(broadSize).fill(.23),base:Array(broadSize).fill(-4),bounds:[{row:Array(broadSize).fill(.5),max:60}],tolerance:1e-10});
  check(largeBound.converged&&largeBound.forces.every(v=>v>0&&near(v,120/broadSize,1e-8))&&largeBound.feasibility<=1e-9&&largeBound.activeWorkspaceLimited&&largeBound.peakActiveWorkspaceBytes<=largeBound.maxActiveWorkspaceBytes,'a257-pressure saturated face keeps byte-bounded continuation and its true shared load bound');
  const impossible=Q.normalLCP({size:2,apply:v=>v,diagonal:[1,1],base:[-1,-1],bounds:[{row:[1,1],max:-1}],tolerance:1e-12});
  check(!impossible.converged&&impossible.feasibility>=1&&impossible.boundResidual>=1,'an infeasible load bound reports the actual force violation and never accepts an iteration cutoff');
  const unfinished=Q.normalLCP({size:2,apply:v=>[2*v[0]+v[1],v[0]+4*v[1]],diagonal:[2,4],base:[-1,-2],tolerance:1e-14,maxIterations:1});
  check(!unfinished.converged&&unfinished.residual>1e-14&&unfinished.applications>0,'an unfinished matrix-free solve reports its real residual rather than accepting an iteration cutoff');
  {
  const interior=Q.frictionResidual([.2,.1,0],[.004,-.002,0],1),sticking=Q.frictionResidual([.2,.1,0],zero,1),sliding=Q.frictionResidual([.6,.8,0],[-.012,-.016,0],1),wrong=Q.frictionResidual([.6,.8,0],[.012,.016,0],1);
  check(near(interior.residual,Math.hypot(.004,.002),1e-12)&&sticking.residual===0&&sliding.residual<1e-12&&near(wrong.residual,.02,1e-12),'Coulomb KKT distinguishes free sticking, true cap sliding and a wrong-direction capped force');
  const noContact=Q.frictionResidual(zero,[1,-2,3],0),badZero=Q.frictionResidual([.01,0,0],[1,0,0],0),over=Q.frictionResidual([1.1,0,0],[-.2,0,0],1);
  check(noContact.residual===0&&noContact.feasibility===0&&near(badZero.feasibility,.01,1e-12)&&near(over.feasibility,.1,1e-12),'zero pressure permits no friction and capacity violations stay visible independently of stationarity');
  const frNormal=[.3,.4,Math.sqrt(.75)],frU=[.8,-.6,0],frV=cross(frNormal,frU),frForce=frU.map((x,i)=>.6*x+.8*frV[i]),frGradient=frForce.map((x,i)=>-.02*x+.003*frV[i]),angle=.7,rotate=a=>[Math.cos(angle)*a[0]-Math.sin(angle)*a[1],Math.sin(angle)*a[0]+Math.cos(angle)*a[1],a[2]],mixed=Q.frictionResidual(frForce,frGradient,1),rotated=Q.frictionResidual(rotate(frForce),rotate(frGradient),1);
  check(Math.abs(dot(frForce,frNormal))<1e-12&&Math.abs(dot(frGradient,frNormal))<1e-12&&near(mixed.residual,rotated.residual,1e-12)&&near(mixed.feasibility,rotated.feasibility,1e-12),'mixed-face tangent coordinates and world rotations preserve the same physical Coulomb residual');
  const tinyStep=1e-12,dampedForce=[.2-tinyStep,0,0],undamped=Q.frictionResidual([.2,0,0],[.01,0,0],1),damped=Q.frictionResidual(dampedForce,[.01,0,0],1);
  check(tinyStep<3e-7&&near(damped.residual,undamped.residual,1e-12)&&damped.residual>3e-7,'arbitrarily damping the force update cannot manufacture displacement-KKT convergence');
  let invalidFriction=0;for(const args of [[[NaN,0,0],zero,1],[zero,[Infinity,0,0],1],[zero,zero,-1],[zero,zero,Infinity],[[0,0],zero,1]])try{Q.frictionResidual(...args);}catch(e){invalidFriction++;}
  check(invalidFriction===5,'the Coulomb residual rejects nonfinite, malformed and negative-capacity states');
  const L=.1,naturalInterior=Q.frictionResidual([.2,0,0],[.004,0,0],1,L),naturalSlide=Q.frictionResidual([1,0,0],[-.02,0,0],1,L),naturalWrong=Q.frictionResidual([1,0,0],[.02,0,0],1,L),nearCap=Q.frictionResidual([.9999,0,0],[-.02,0,0],1,L);
  check(near(naturalInterior.residual,.004,1e-12)&&naturalSlide.residual===0&&near(naturalWrong.residual,.02,1e-12)&&near(nearCap.residual,L*.0001,1e-12),'fixed physical mobility gives the continuous natural VI residual for interior, sliding and near-boundary forces');
  const atZero=Q.frictionResidual(zero,[-.01,0,0],1,L),nearZero=Q.frictionResidual([1e-12,0,0],[-.01,0,0],1,L),naturalZero=Q.frictionResidual(zero,[1,-2,3],0,L),zeroForceError=Q.frictionResidual([.01,0,0],[1,0,0],0,L),naturalOver=Q.frictionResidual([1.001,0,0],[-.02,0,0],1,L);
  check(near(atZero.residual,.01,1e-12)&&near(nearZero.residual,atZero.residual,1e-12)&&naturalZero.residual===0&&near(zeroForceError.residual,.001,1e-12)&&near(zeroForceError.feasibility,.01,1e-12)&&naturalOver.feasibility>1e-9,'natural VI stationarity is continuous at zero force and preserves strict separate zero-cap and over-cap feasibility');
  const naturalDamped=Q.frictionResidual(dampedForce,[.01,0,0],1,L),naturalUndamped=Q.frictionResidual([.2,0,0],[.01,0,0],1,L),naturalMixed=Q.frictionResidual(frForce,frGradient,1,L),naturalRotated=Q.frictionResidual(rotate(frForce),rotate(frGradient),1,L);
  check(near(naturalDamped.residual,naturalUndamped.residual,1e-12)&&naturalDamped.residual>3e-7&&near(naturalMixed.residual,naturalRotated.residual,1e-12),'fixed-L VI accuracy is independent of damping and invariant under mixed-face world rotations');
  const measuredL=.003492,measuredGap=.000095,measured=Q.frictionResidual([1-measuredGap,0,0],[-.000189,0,0],1,measuredL);
  check(near(measured.residual,measuredL*measuredGap,1e-12)&&measured.residual>3e-7&&measured.feasibility===0,'the measured95micronewton interior slack still fails the unchanged0.3micrometre tolerance in the fixed physical metric');
  let invalidMobility=0;for(const value of [0,-1,NaN,Infinity])try{Q.frictionResidual(zero,zero,1,value);}catch(e){invalidMobility++;}
  check(invalidMobility===4,'natural VI evaluation requires a finite positive physical mobility');
  const hugeInterior=Q.frictionResidual([1e16,0,0],[1,0,0],2e16,1);
  check(hugeInterior.residual===1&&hugeInterior.feasibility===0,'an interior natural residual evaluates the gradient directly instead of cancelling it against large force coordinates');
  }
};
if(require.main===module){const assert=require('node:assert/strict');module.exports({check:(ok,msg)=>{assert.ok(ok,msg);process.stdout.write('ok '+msg+'\n');}});}
