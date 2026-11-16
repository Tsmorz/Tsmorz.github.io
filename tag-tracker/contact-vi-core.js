// One frozen joint normal/Coulomb VI. Search algorithms do not select a hidden
// pressure allocation: every active normal force is an explicit unknown.
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();else root.ContactVICore=factory();
})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  const finite=Number.isFinite,norm=v=>Math.hypot(...v);
  function dot(a,b){let sum=0;for(let i=0;i<a.length;i++)sum+=a[i]*b[i];return sum;}
  // `linear` is additive in g=H*f+C^T*lambda+linear. Blocks partition the
  // tangent coordinates. Pressure cap rows use nonnegative physical normals;
  // enabled:false supplies the caller's causal-contact/duplicate-grip exclusion.
  // tangentSearchScale changes only the positive numerical projection metric;
  // certificate() always uses the original metric and min-normal map.
  // Actuator modes describe ONLY an unsaturated, interior-stroke branch. Its
  // strict gates reject solutions needing a stop/dual; that branch is not hidden.
  function create(problem){
    const {H,C,linear,normal,blocks,modes=[]}=problem,k=H.length,n=normal.size,active=Array.from(problem.normalActive??Array.from({length:n},(_,i)=>i)),m=active.length,d=k+m,indices=new Map(active.map((id,j)=>[id,j])),normalSearch=problem.normalSearch??'min',tangentSearchScale=problem.tangentSearchScale??1;
    if(!(tangentSearchScale>0&&finite(tangentSearchScale))||!['min','fb'].includes(normalSearch)||!Number.isInteger(n)||n<0||typeof normal.apply!=='function'||m>0&&typeof normal.column!=='function'||normal.base.length!==n||normal.diagonal.length!==n||normal.base.some(v=>!finite(v))||normal.diagonal.some(v=>!(v>0&&finite(v)))||H.some(row=>row.length!==k||row.some(v=>!finite(v)))||C.length!==n||C.some(row=>row.length!==k||row.some(v=>!finite(v)))||linear.length!==k||linear.some(v=>!finite(v))||new Set(active).size!==m||active.some(i=>!Number.isInteger(i)||i<0||i>=n))throw Error('Invalid joint contact VI.');
    const covered=new Set(),validated=blocks.map(block=>{
      const {start,size,metric}=block;if(!Number.isInteger(start)||!Number.isInteger(size)||size<1||size>3||start<0||start+size>k||!(metric>0&&finite(metric))||!(metric*tangentSearchScale>0&&finite(metric*tangentSearchScale)))throw Error('Invalid contact tangent block.');
      for(let j=start;j<start+size;j++){if(covered.has(j))throw Error('Overlapping contact tangent blocks.');covered.add(j);}
      const forms=[block.capFixed!==undefined,block.capNormals!==undefined,block.capSides!==undefined].filter(Boolean).length;
      if(forms!==1||block.capFixed!==undefined&&!(block.capFixed>=0&&(finite(block.capFixed)||block.capFixed===Infinity))||block.capScale!==undefined&&!(block.capScale>=0&&finite(block.capScale))||block.capMax!==undefined&&!(block.capMax>=0&&(finite(block.capMax)||block.capMax===Infinity)))throw Error('Invalid contact friction capacity.');
      const sides=block.capSides??(block.capNormals?[block.capNormals]:[]);
      if(block.capSides&&sides.length!==2||sides.some(side=>!Array.isArray(side)||side.some(row=>row.length!==2||!Number.isInteger(row[0])||row[0]<0||row[0]>=n||!(row[1]>=0&&finite(row[1])))))throw Error('Invalid contact pressure rows.');
      return {...block,sides};
    });
    if(covered.size!==k||modes.some(mode=>mode.normalJ.length!==n||mode.tangentJ.length!==k||mode.normalJ.some(v=>!finite(v))||mode.tangentJ.some(v=>!finite(v))||!(mode.maxForce>=0&&finite(mode.maxForce))||!(mode.compliance>=0&&finite(mode.compliance))||![mode.driveGap,mode.minGap,mode.maxGap].every(finite)||mode.minGap>mode.maxGap))throw Error('Invalid contact actuator mode.');
    // Only selected columns are stored; all physical rows remain in the map.
    const columns=active.map(id=>{const out=new Float64Array(n),value=normal.column(id,out)||out;if(value.length!==n||Array.from(value).some(v=>!finite(v)))throw Error('Invalid contact normal column.');return Float64Array.from(value);});
    const canonicalMetrics=validated.map(block=>block.metric),searchMetrics=canonicalMetrics.map(metric=>metric*tangentSearchScale),scales=validated.flatMap((block,i)=>Array(block.size).fill(searchMetrics[i])).concat(Array.from(normal.diagonal)),dimensions={tangents:k,normals:n,activeNormals:m,unknowns:d,residuals:k+n,storedNormalColumns:m};
    // Residual rows are in tangent-coordinate order, independent of block order.
    for(const [i,block]of validated.entries())for(let j=0;j<block.size;j++)scales[block.start+j]=searchMetrics[i];
    function initial(tangents=Array(k).fill(0),lambda=Array(n).fill(0)){
      if(tangents.length!==k||lambda.length!==n)return invalid();return Array.from(tangents).concat(active.map(i=>lambda[i]));
    }
    function invalid(){throw Error('Invalid joint contact state.');}
    function state(x,physical=false,fullForces=null){
      let tangents,lambda;
      if(fullForces){
        tangents=Array.from(fullForces.tangents||[]);lambda=Array.from(fullForces.normalForces||[]);
        if(tangents.length!==k||lambda.length!==n||tangents.some(v=>!finite(v))||lambda.some(v=>!finite(v)))return invalid();physical=true;
      }else{
        if(x.length!==d||x.some(v=>!finite(v)))return invalid();
        tangents=Array.from(x).slice(0,k);lambda=Array(n).fill(0);active.forEach((id,j)=>lambda[id]=x[k+j]);
      }
      const response=new Float64Array(n);if(!fullForces)for(let j=0;j<m;j++){const force=lambda[active[j]];if(force)for(let i=0;i<n;i++)response[i]+=force*columns[j][i];}
      let computed=response;if(physical){const fresh=new Float64Array(n);computed=normal.apply(lambda,fresh)||fresh;}
      if(computed.length!==n||Array.from(computed).some(v=>!finite(v)))throw Error('Invalid contact normal response.');
      const gaps=Array.from(computed,(v,i)=>v+normal.base[i]+dot(C[i],tangents)),gradient=Array(k),residualVector=Array(k+n).fill(0),caps=[],capRows=[];
      // Preserve both original accumulation orders without one callback per
      // matrix element on every full-operator certificate and search probe.
      for(let j=0;j<k;j++){let pressure=0;for(let i=0;i<n;i++)pressure+=C[i][j]*lambda[i];gradient[j]=dot(H[j],tangents)+linear[j]+pressure;}
      if(gaps.some(v=>!finite(v))||gradient.some(v=>!finite(v)))throw Error('Nonfinite joint contact state.');
      let feasibility=Math.max(0,...lambda.map(v=>-v)),frictionResidual=0,normalResidual=0;
      for(const [blockIndex,block]of validated.entries()){
        let cap=block.capFixed??0,derivative=Array(m).fill(0);
        if(block.capFixed===undefined){
          const pressures=block.sides.map(side=>side.reduce((s,[id,w])=>s+w*Math.max(0,lambda[id]),0));let side=0;for(let i=1;i<pressures.length;i++)if(pressures[i]<pressures[side])side=i;
          const scale=block.capScale??1;cap=scale*pressures[side];if(cap>0)for(const [id,w]of block.sides[side])if(lambda[id]>0&&indices.has(id))derivative[indices.get(id)]+=scale*w;
          const maximum=block.capMax??Infinity;if(cap>=maximum){cap=maximum;derivative.fill(0);}
        }
        if(block.enabled===false){cap=0;derivative.fill(0);}caps.push(cap);capRows.push(derivative);
        const f=tangents.slice(block.start,block.start+block.size),g=gradient.slice(block.start,block.start+block.size),L=physical?block.metric:searchMetrics[blockIndex],trial=f.map((v,j)=>L*v-g[j]),magnitude=norm(trial),ratio=magnitude>L*cap?L*cap/magnitude:1;
        const r=magnitude<=L*cap?g.slice():f.map((v,j)=>L*v-ratio*trial[j]);r.forEach((v,j)=>residualVector[block.start+j]=v);
        // An auxiliary positive projection metric changes search conditioning,
        // never the canonical physical residual, compliance or Coulomb disk.
        let canonical=r;if(!physical&&tangentSearchScale!==1){const canonicalTrial=f.map((v,j)=>block.metric*v-g[j]),length=norm(canonicalTrial),canonicalRatio=Math.min(1,block.metric*cap/(length||1));canonical=length<=block.metric*cap?g.slice():f.map((v,j)=>block.metric*v-canonicalRatio*canonicalTrial[j]);}
        frictionResidual=Math.max(frictionResidual,norm(canonical));feasibility=Math.max(feasibility,norm(f)-cap);
      }
      for(let i=0;i<n;i++){
        const a=normal.diagonal[i]*lambda[i],b=gaps[i],r=Math.min(a,b);
        // FB is a numerical search map with the SAME unilateral zeros. The
        // physical certificate below always retains the original min residual.
        residualVector[k+i]=!physical&&normalSearch==='fb'?Math.hypot(a,b)-a-b:r;normalResidual=Math.max(normalResidual,Math.abs(r));
      }
      const loads=modes.map(mode=>{const load=dot(mode.normalJ,lambda)+dot(mode.tangentJ,tangents),gap=mode.driveGap+mode.compliance*load;feasibility=Math.max(feasibility,Math.abs(load)-mode.maxForce);return {side:mode.side,load,gap,valid:gap>=mode.minGap-1e-12&&gap<=mode.maxGap+1e-12};});
      const omittedViolations=fullForces?[]:gaps.flatMap((gap,i)=>!indices.has(i)&&gap<0?[i]:[]);
      const operatorDifference=physical&&!fullForces?Array.from(computed).reduce((error,v,i)=>Math.max(error,Math.abs(v-response[i])),0):undefined;
      return {residualVector,feasibility:Math.max(0,feasibility),valid:loads.every(mode=>mode.valid),payload:{tangents,normalForces:lambda,caps,capRows,metrics:canonicalMetrics.slice(),searchMetrics:searchMetrics.slice(),gradient,gaps,loads,omittedViolations,normalResidual,frictionResidual,maxResidual:Math.max(normalResidual,frictionResidual),...physical?{physical:true,...fullForces?{fullForces:true}:{operatorDifference}}:{}}};
    }
    function jacobian(x,evaluation){
      const q=evaluation||state(x),{tangents,normalForces:lambda,gradient,gaps,caps,capRows}=q.payload,J=Array.from({length:k+n},()=>Array(d).fill(0));
      validated.forEach((block,index)=>{
        const {start,size}=block,L=searchMetrics[index],f=tangents.slice(start,start+size),trial=f.map((v,j)=>L*v-gradient[start+j]),magnitude=norm(trial),radius=L*caps[index],inside=radius>0&&magnitude<=radius;
        for(let a=0;a<size;a++)for(let j=0;j<d;j++){
          const dg=j<k?H[start+a][j]:C[active[j-k]][start+a];
          if(inside){J[start+a][j]=dg;continue;}
          const own=j===start+a?L:0,dt=own-dg,u=trial[a]/(magnitude||1);let projected=0;
          for(let b=0;b<size;b++){const dgb=j<k?H[start+b][j]:C[active[j-k]][start+b],dtb=(j===start+b?L:0)-dgb;projected+=trial[b]/(magnitude||1)*dtb;}
          const dr=j<k?0:L*capRows[index][j-k];J[start+a][j]=own-dr*u-(radius/(magnitude||1))*(dt-u*projected);
        }
      });
      for(let i=0;i<n;i++){
        const a=normal.diagonal[i]*lambda[i],b=gaps[i],h=Math.hypot(a,b),db=normalSearch==='fb'?(h?b/h-1:-1):b<=a?1:0,da=normalSearch==='fb'?(h?a/h-1:-1):b<=a?0:1;
        for(let j=0;j<k;j++)J[k+i][j]=db*C[i][j];for(let j=0;j<m;j++)J[k+i][k+j]=db*columns[j][i];if(indices.has(i))J[k+i][k+indices.get(i)]+=da*normal.diagonal[i];
      }
      return J;
    }
    // Search probes use only immutable selected columns. A caller must freshly
    // certify an accepted candidate against the actual physical operator before
    // applying its forces/pose; this is intentionally separate from globalization.
    // An independent solver may supply full physical forces without selecting
    // every normal as a Newton unknown (and storing a dense normal matrix).
    // This path uses the actual operator and every original canonical gate.
    return {evaluate:x=>state(x),certificate:x=>state(x,true),certificateForces:forces=>state(null,true,forces),jacobian,initial,scales,dimensions,normalActive:active.slice()};
  }
  return {create};
});
