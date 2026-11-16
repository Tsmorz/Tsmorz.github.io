// Feasible force coordinates for ordinary Coulomb contacts; the physical VI is unchanged.
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();else root.ContactProjectionCore=factory();
})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  const finite=Number.isFinite,identity=n=>Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>i===j?1:0)),zero=n=>Array.from({length:n},()=>Array(n).fill(0));
  function cone(a,b,mu){
    const r=Math.hypot(...b);
    // A zero-friction cone is a ray, including its positive normal interior.
    if(mu===0)return {value:[Math.max(0,a),0,0],D:[[a>0?1:a<0?0:.5,0,0],[0,0,0],[0,0,0]]};
    if(a===0&&r===0)return {value:[0,0,0],D:identity(3).map(row=>row.map(v=>v*.5))};
    if(a>=0&&r<=mu*a)return {value:[a,...b],D:identity(3)};
    if(a+mu*r<=0)return {value:[0,0,0],D:zero(3)};
    const u=b.map(v=>v/r),h=Math.hypot(1,mu),c=1/h,s=mu/h,cc=c*c,cs=c*s,ss=s*s,normal=cc*a+cs*r,tangent=cs*a+ss*r,ratio=tangent/r,D=zero(3);
    D[0][0]=cc;for(let i=0;i<2;i++){D[0][i+1]=D[i+1][0]=cs*u[i];for(let j=0;j<2;j++)D[i+1][j+1]=ratio*((i===j?1:0)-u[i]*u[j])+ss*u[i]*u[j];}
    return {value:[normal,...u.map(v=>tangent*v)],D};
  }
  /**
   * Only disjoint ordinary (lambda,Ft[2]) cones and fixed-zero tangent blocks
   * are supported. A positive captured/min-opposing cap needs a different
   * intersection projection, so create returns null rather than approximating it.
   * project(z).y is the physical vector; raw Newton coordinates z are never forces.
   */
  function create({model,blocks,normalActive,tangentCount:k}){
    if(!model||!['evaluate','jacobian','certificate'].every(key=>typeof model[key]==='function')||!Number.isInteger(k)||k<0||!Array.isArray(blocks)||!Array.isArray(normalActive)||new Set(normalActive).size!==normalActive.length||normalActive.some(id=>!Number.isInteger(id)||id<0))throw Error('Invalid projected contact model.');
    const d=k+normalActive.length,normalIndex=new Map(normalActive.map((id,j)=>[id,k+j])),covered=new Set(),normalUsed=new Set(),plans=[];
    if(model.dimensions&&(model.dimensions.tangents!==k||model.dimensions.unknowns!==d||normalActive.some(id=>id>=model.dimensions.normals)))throw Error('Projected contact dimensions do not match.');
    for(const block of blocks){
      const {start,size}=block;if(!Number.isInteger(start)||!Number.isInteger(size)||size<1||start<0||start+size>k)throw Error('Invalid projected tangent block.');
      for(let j=start;j<start+size;j++){if(covered.has(j))throw Error('Overlapping projected tangent blocks.');covered.add(j);}
      if(block.capFixed===0){if(block.capNormals!==undefined||block.capSides!==undefined)return null;plans.push({kind:'zero',indices:Array.from({length:size},(_,i)=>start+i)});continue;}
      if(block.capFixed!==undefined||block.capSides!==undefined||block.capMax!==undefined||size!==2||block.capNormals?.length!==1)return null;
      const row=block.capNormals[0];if(!Array.isArray(row)||row.length!==2||!Number.isInteger(row[0])||row[0]<0||!(row[1]>=0&&finite(row[1]))||block.capScale!==undefined&&!(block.capScale>=0&&finite(block.capScale)))throw Error('Invalid projected pressure cone.');
      const [id,weight]=row,mu=block.enabled===false?0:weight*(block.capScale??1);if(!finite(mu))throw Error('Invalid projected friction coefficient.');
      if(model.dimensions&&id>=model.dimensions.normals)throw Error('Invalid projected normal index.');
      if(normalUsed.has(id))return null;normalUsed.add(id);
      const at=normalIndex.get(id);plans.push(at===undefined?{kind:'zero',indices:[start,start+1]}:{kind:'cone',mu,indices:[at,start,start+1]});
    }
    if(covered.size!==k)throw Error('Projected tangent blocks must cover every tangent coordinate.');
    for(const [id,at]of normalIndex)if(!normalUsed.has(id))plans.push({kind:'normal',indices:[at]});
    function project(parameter){
      const z=Array.from(parameter);if(z.length!==d||z.some(v=>!finite(v)))throw Error('Invalid projected force coordinates.');
      const y=z.slice(),groups=plans.map(plan=>{
        let value,D;if(plan.kind==='cone'){const p=cone(z[plan.indices[0]],plan.indices.slice(1).map(i=>z[i]),plan.mu);value=p.value;D=p.D;}
        else if(plan.kind==='normal'){const a=z[plan.indices[0]];value=[Math.max(0,a)];D=[[a>0?1:a<0?0:.5]];}
        else{value=plan.indices.map(()=>0);D=zero(plan.indices.length);}
        plan.indices.forEach((at,i)=>y[at]=value[i]);return {indices:plan.indices.slice(),D};
      });
      if(y.some(v=>!finite(v))||groups.some(g=>g.D.some(row=>row.some(v=>!finite(v)))))throw Error('Nonfinite projected force state.');
      return {y,groups};
    }
    function evaluate(z){const p=project(z),q=model.evaluate(p.y);return {...q,payload:{...q.payload,projection:{...p,parameter:Array.from(z)}}};}
    function jacobian(z,evaluation){
      const p=project(z),saved=evaluation?.payload?.projection,q=saved?.parameter?.length===d&&saved.parameter.every((v,i)=>v===z[i])?evaluation:evaluate(z),A=model.jacobian(p.y,q);
      if(!Array.isArray(A)||A.some(row=>row.length!==d||Array.from(row).some(v=>!finite(v))))throw Error('Invalid physical contact Jacobian.');
      const J=Array.from({length:A.length},()=>Array(d).fill(0));
      // Disjoint 3x3 cone blocks (and scalar orthants), not a dense cubic product.
      for(const group of p.groups)for(let column=0;column<group.indices.length;column++)for(let i=0;i<A.length;i++)for(let j=0;j<group.indices.length;j++)J[i][group.indices[column]]+=A[i][group.indices[j]]*group.D[j][column];
      return J;
    }
    // Fresh actual-operator/canonical certification of P(z), never raw z.
    function certificate(z){return model.certificate(project(z).y);}
    return {project,evaluate,jacobian,certificate};
  }
  return {create};
});
