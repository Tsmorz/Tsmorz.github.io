// Thin tangent blocks over a scalar cloth inverse; normals remain matrix-free.
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();else root.ClothCouplingCore=factory();
})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const vector=v=>v&&v.length===3&&Array.from(v).every(Number.isFinite);
  const matrixVector=(A,v)=>[A[0]*v[0]+A[1]*v[1]+A[2]*v[2],A[3]*v[0]+A[4]*v[1]+A[5]*v[2],A[6]*v[0]+A[7]*v[1]+A[8]*v[2]];
  // Work-conjugate nodal forces for a force applied at a shell surface point.
  // The triangle's objective spin transports its midsurface barypoint to the
  // common contact point, including the finite-thickness moment arm.
  function contactGradients({points,weights,point,axis}){
    if(points?.length!==3||points.some(p=>!vector(p))||weights?.length!==3||weights.some(w=>!Number.isFinite(w))||Math.abs(weights.reduce((s,w)=>s+w,0)-1)>1e-8||!vector(point)||!vector(axis))throw Error('Invalid shell contact triangle.');
    const centre=[0,1,2].map(k=>points.reduce((s,p)=>s+p[k]/3,0)),r=points.map(p=>p.map((v,k)=>v-centre[k])),A=Array(9).fill(0);
    for(const v of r)for(let i=0;i<3;i++)for(let j=0;j<3;j++)A[3*i+j]+=(i===j?dot(v,v):0)-v[i]*v[j];
    const [a,b,c,d,e,f,g,h,i]=A,co=[e*i-f*h,c*h-b*i,b*f-c*e,f*g-d*i,a*i-c*g,c*d-a*f,d*h-e*g,b*g-a*h,a*e-b*d],det=a*co[0]+b*co[3]+c*co[6];
    if(!(det>0&&Number.isFinite(det)))throw Error('Degenerate shell contact triangle.');
    const origin=[0,1,2].map(k=>points.reduce((s,p,j)=>s+weights[j]*p[k],0)),lever=point.map((v,k)=>v-origin[k]),spin=matrixVector(co.map(v=>v/det),cross(lever,axis));
    const gradients=r.map((v,j)=>{const moment=cross(spin,v);return axis.map((x,k)=>weights[j]*x+moment[k]);});
    if(gradients.some(g=>!vector(g)))throw Error('Nonfinite shell contact Jacobian.');return gradients;
  }
  function assemble({pins,normalRows,entry,bodyMobility,dt}){
    if(!Array.isArray(pins)||!Array.isArray(normalRows)||typeof entry!=='function'||typeof bodyMobility!=='function'||!(dt>0&&Number.isFinite(dt)))throw Error('Invalid cloth coupling input.');
    const rowValid=row=>row&&row.ids?.length>0&&row.ids.length===row.w?.length&&Array.from(row.ids).every(i=>Number.isInteger(i)&&i>=0)&&Array.from(row.w).every(Number.isFinite);
    const frameValid=row=>(!row.point||vector(row.point))&&(!row.body||vector(row.body.t));
    for(const pin of pins){
      if(!rowValid(pin)||!frameValid(pin)||!Array.isArray(pin.axes)||!(pin.stiffness>0&&(Number.isFinite(pin.stiffness)||pin.stiffness===Infinity))||Math.abs(pin.w.reduce((s,w)=>s+w,0)-(pin.relative?0:1))>1e-8||pin.axes.length>3||pin.axes.some((a,i)=>!vector(a)||pin.axes.some((b,j)=>!vector(b)||Math.abs(dot(a,b)-(i===j?1:0))>1e-8)))throw Error('Invalid cloth tangent pin.');
      if(pin.relative&&pin.body||pin.materialJacobians&&(!pin.relative||pin.materialJacobians.length!==pin.axes.length||pin.materialJacobians.some(row=>!Array.isArray(row)||row.some(g=>!Number.isInteger(g.id)||g.id<0||!vector(g.gradient))||Math.hypot(...[0,1,2].map(k=>row.reduce((s,g)=>s+g.gradient[k],0)))>1e-8)))throw Error('Invalid relative material Jacobian.');
    }
    for(const row of normalRows)if(!rowValid(row)||!frameValid(row)||!vector(row.normal))throw Error('Invalid cloth normal row.');
    const mobility=new Map();
    const bodyOf=body=>{
      if(!mobility.has(body)){
        const value=bodyMobility(body),I=value?.inverseInertia;
        if(!(value?.invM>=0&&Number.isFinite(value.invM))||I?.length!==9||!Array.from(I).every(Number.isFinite))throw Error('Invalid cloth body mobility.');
        mobility.set(body,{invM:value.invM,inverseInertia:Array.from(I)});
      }
      return mobility.get(body);
    };
    const variable=(row,axis,sum)=>{
      const direction=axis.map(v=>-v*sum),point=row.point||[0,0,0],origin=row.body?.t||[0,0,0];
      return {row,axis,body:row.body,direction,torque:cross(point.map((v,i)=>v-origin[i]),direction)};
    };
    const rigid=(a,b)=>{
      if(!a.body||a.body!==b.body)return 0;
      const B=bodyOf(a.body);
      b.inverseTorque??=matrixVector(B.inverseInertia,b.torque);
      return dt*dt*(B.invM*dot(a.direction,b.direction)+dot(a.torque,b.inverseTorque));
    };
    const responses=pins.map(()=>new Map());
    const material=(row,pinIndex)=>{
      const pin=pins[pinIndex],cache=responses[pinIndex];
      let result=0;
      for(let i=0;i<row.ids.length;i++){
        const id=row.ids[i];let response=cache.get(id);
        if(response===undefined){
          response=0;for(let j=0;j<pin.ids.length;j++){
            const value=entry(id,pin.ids[j]);if(!Number.isFinite(value))throw Error('Nonfinite cloth inverse entry.');response+=pin.w[j]*value;
          }
          if(!Number.isFinite(response))throw Error('Nonfinite cloth material response.');cache.set(id,response);
        }
        result+=row.w[i]*response;
      }
      if(!Number.isFinite(result))throw Error('Nonfinite cloth material coupling.');return result;
    };
    const variables=[],byPin=pins.map((pin,index)=>pin.axes.map((axis,j)=>{
      const v={...variable(pin,axis,pin.relative?0:1),pin:index,index:variables.length,general:pin.materialJacobians?.[j]};variables.push(v);return v;
    }));
    const generalResponses=variables.map(()=>new Map()),gradients=v=>v.general||v.row.ids.map((id,i)=>({id,gradient:v.axis.map(x=>x*v.row.w[i])})),generalMaterial=(a,b)=>{
      const cache=generalResponses[b.index];let value=0;
      for(const g of gradients(a)){let response=cache.get(g.id);if(!response){response=[0,0,0];for(const q of gradients(b)){const s=entry(g.id,q.id);if(!Number.isFinite(s))throw Error('Nonfinite cloth inverse entry.');for(let k=0;k<3;k++)response[k]+=s*q.gradient[k];}cache.set(g.id,response);}value+=dot(g.gradient,response);}
      if(!Number.isFinite(value))throw Error('Nonfinite relative cloth response.');return value;
    };
    const count=variables.length,H=Array.from({length:count},()=>new Float64Array(count));
    // A material pair is independent of its two tangent axes. Evaluate it once.
    const pinMaterial=Array.from({length:pins.length},()=>new Float64Array(pins.length).fill(NaN));
    for(let i=0;i<count;i++)for(let j=0;j<=i;j++){
      const a=variables[i],b=variables[j];let elastic=pinMaterial[a.pin][b.pin];
      if(!a.general&&!b.general&&Number.isNaN(elastic))pinMaterial[a.pin][b.pin]=pinMaterial[b.pin][a.pin]=elastic=material(a.row,b.pin);
      // Infinity is the exact rigid-stick limit, without a numerical spring.
      // Singular blocks remain singular; the caller must reject that candidate.
      const value=(a.general||b.general?generalMaterial(a,b):dot(a.axis,b.axis)*elastic)+rigid(a,b)+(i===j?1/pins[a.pin].stiffness:0);
      if(!Number.isFinite(value))throw Error('Nonfinite cloth tangent coupling.');
      H[i][j]=H[j][i]=value;
    }
    const C=normalRows.map(row=>{
      const normal=variable(row,row.normal,row.w.reduce((s,w)=>s+w,0)),out=new Float64Array(count);
      byPin.forEach((axes,i)=>{
        if(!axes.length)return;const elastic=material(row,i);
        for(const pin of axes){const value=(pin.general?generalMaterial(normal,pin):dot(row.normal,pin.axis)*elastic)+rigid(normal,pin);if(!Number.isFinite(value))throw Error('Nonfinite cloth normal coupling.');out[pin.index]=value;}
      });
      return out;
    });
    return {H,C};
  }
  return {assemble,contactGradients};
});
