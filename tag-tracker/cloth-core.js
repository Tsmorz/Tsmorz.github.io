// Thin sewn cotton: anisotropic material energy, quadratic shell bending and finite pad friction.
// A cached local/global solve keeps SI stiffness independent of step size; legacy towels use XPBD.
// No DOM; the same physical nodes drive rendering, contacts and objective checks.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./physics-core.js'), require('./cable-core.js'),require('./patch-contact-core.js'),require('./cloth-contact-core.js'),require('./cloth-coupling-core.js'),require('./contact-newton-core.js'),require('./contact-vi-core.js'),require('./contact-warm-core.js'),require('./contact-projection-core.js'),require('./contact-ngs-core.js'),require('./contact-tangent-core.js'),require('./contact-refine-core.js'),require('./contact-prox-core.js'));
  else root.ClothCore = factory(root.PhysicsCore, root.CableCore,root.PatchContactCore,root.ClothContactCore,root.ClothCouplingCore,root.ContactNewtonCore,root.ContactVICore,root.ContactWarmCore,root.ContactProjectionCore,root.ContactNGSCore,root.ContactTangentCore,root.ContactRefineCore,root.ContactProxCore);
})(typeof self !== 'undefined' ? self : this, function (P, Cable,Patch,Contact,Coupling,Newton,VI,Warm,Projection,NGS,Tangent,Refine,Prox) {
  'use strict';
  const add = (a, b) => a.map((v, i) => v + b[i]), sub = (a, b) => a.map((v, i) => v - b[i]);
  const mul = (a, s) => a.map((v) => v * s), len = (a) => Math.hypot(...a);
  const mv = (R, p) => [0, 1, 2].map((i) => R[3 * i] * p[0] + R[3 * i + 1] * p[1] + R[3 * i + 2] * p[2]);
  const mt = (R, p) => [0, 1, 2].map((i) => R[i] * p[0] + R[3 + i] * p[1] + R[6 + i] * p[2]);
  const dot = (a,b) => a.reduce((s,v,i)=>s+v*b[i],0);
  const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  function reactWrench(body,force,torque,dt){
    if(!body||body.fixed)return;
    body.asleep=false;body.still=0;
    const pending=body.externalImpulse||(body.externalImpulse={linear:[0,0,0],angular:[0,0,0]});
    pending.linear=add(pending.linear,mul(force,dt));pending.angular=add(pending.angular,mul(torque,dt));
  }
  // Barycentric vertex/face contact catches overlapping fabric between mesh particles.
  function faceContact(point,a,b,c,margin=0,options={}) {
    const q=Contact.pointTriangle(point,[a,b,c],options);if(!q.projectedW)return null;
    // Keep the exported planar query's inside-face semantics. Collision
    // callers explicitly request the true finite vertex/edge/face feature.
    if(!options.closest&&q.projectedW.some(w=>w< -margin-1e-6))return null;
    const sign=q.planeDistance<0?-1:1;
    return {n:mul(q.normal,sign),d:sign*q.distance,w:q.w,feature:q.feature,snapDistance:q.snapDistance};
  }
  // Interior edge crossings are missed by vertex/face tests. Endpoints and nearly
  // parallel edges stay with that manifold instead of creating duplicate contacts.
  function edgeContact(a,b,c,d,limit=Infinity){
    const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=d[0]-c[0],vy=d[1]-c[1],vz=d[2]-c[2],wx=a[0]-c[0],wy=a[1]-c[1],wz=a[2]-c[2],A=ux*ux+uy*uy+uz*uz,B=ux*vx+uy*vy+uz*vz,C=vx*vx+vy*vy+vz*vz,D=ux*wx+uy*wy+uz*wz,E=vx*wx+vy*wy+vz*wz,den=A*C-B*B;
    if(den<.01*A*C||A*C<1e-18)return null;
    const s=(B*E-C*D)/den,t=(A*E-B*D)/den;if(s<=1e-4||s>=1-1e-4||t<=1e-4||t>=1-1e-4)return null;
    const L=Math.sqrt(den),nx=(uy*vz-uz*vy)/L,ny=(uz*vx-ux*vz)/L,nz=(ux*vy-uy*vx)/L,distance=(wx+s*ux-t*vx)*nx+(wy+s*uy-t*vy)*ny+(wz+s*uz-t*vz)*nz;
    return Math.abs(distance)>limit?null:{n:[nx,ny,nz],d:distance,w:[1-s,s,-(1-t),-t]};
  }
  function inverse3(m) {
    const [a,b,c,d,e,f,g,h,i]=m,co=[e*i-f*h,c*h-b*i,b*f-c*e,f*g-d*i,a*i-c*g,c*d-a*f,d*h-e*g,b*g-a*h,a*e-b*d],det=a*co[0]+b*co[3]+c*co[6];
    return co.map(v=>v/det);
  }
  // Multisecant acceleration changes only the trial forces, never the law or
  // acceptance tolerance. Modified Gram–Schmidt drops dependent history rather
  // than regularizing the physical contact matrix.
  function accelerateFriction(history,x,y){
    const f=sub(y,x);history.push({x:x.slice(),f});if(history.length>6)history.shift();if(history.length<2)return y;
    const columns=[],Q=[],R=[];for(let i=1;i<history.length;i++){
      const a=history[i-1],b=history[i],df=sub(b.f,a.f),dx=sub(b.x,a.x),v=df.slice(),row=[];let scale=len(v);
      for(let pass=0;pass<2;pass++)for(let j=0;j<Q.length;j++){const value=dot(Q[j],v);row[j]=(row[j]||0)+value;for(let k=0;k<v.length;k++)v[k]-=value*Q[j][k];}
      const length=len(v);if(!(length>Number.EPSILON*Math.max(1,scale)*x.length))continue;row[Q.length]=length;Q.push(mul(v,1/length));R.push(row);columns.push(add(dx,df));
    }
    const gamma=Q.map(q=>dot(q,f));for(let i=gamma.length-1;i>=0;i--){for(let j=i+1;j<gamma.length;j++)gamma[i]-=R[j][i]*gamma[j];gamma[i]/=R[i][i];}
    const out=y.slice();for(let j=0;j<gamma.length;j++)for(let i=0;i<out.length;i++)out[i]-=columns[j][i]*gamma[j];return out.every(Number.isFinite)?out:y;
  }
  // Effective small-patch shear stiffness: two modelled12mm² rubber faces at
  // assumed G≈1MPa and3.9mm depth give about6kN/m per hand, shared across
  // samples/layers. This is a model parameter, not a measured factory property.
  // Coulomb pressure still caps force independently of elastic stiffness.
  const PAD_STIFFNESS=6000,PAD_NORMAL_STIFFNESS=2*P.JAW.padStiffness,radius = 0.0025, N = 9, ITER = 5;
  const resetJawModes=c=>{c.jawModes=new Map([...(c.jawBaselines||[])].map(([side,base])=>[side,{base,load:0,extra:0,stop:c.jawStops?.get(side),pressure:{1:0,'-1':0}}]));};
  const jawCompliance=mode=>mode?.stop?0:mode?.base.compliance||0;
  const jawOffset=mode=>mode.stop?(mode.stop==='low'?mode.base.minGap:mode.base.maxGap)-mode.base.carrierGap:mode.base.restOffset+mode.base.compliance*mode.load+mode.extra;
  function handGeometry(G,h,baseline){
    const carrierGap=baseline?.carrierGap??h.carrierGap??h.gap,compression=baseline?.padCompression||h.padCompression||{},pads=Object.fromEntries([-1,1].map(jaw=>[jaw,G.padShape?G.padShape(jaw,carrierGap,compression[jaw]||[0,0,0]):{c:[G.pad.c[0],jaw*(carrierGap/2+G.pad.c[1]),G.pad.c[2]],h:G.pad.h}]));
    const low=[0,1,2].map(k=>k===1?pads[-1].c[k]+pads[-1].h[k]:Math.max(...[-1,1].map(j=>pads[j].c[k]-pads[j].h[k]))),high=[0,1,2].map(k=>k===1?pads[1].c[k]-pads[1].h[k]:Math.min(...[-1,1].map(j=>pads[j].c[k]+pads[j].h[k])));
    return {carrierGap,pads,region:{c:low.map((v,k)=>(v+high[k])/2),h:low.map((v,k)=>(high[k]-v)/2)},shape:(shape,jaw)=>shape===G.pad?pads[jaw]:{c:[shape.c[0],jaw*(carrierGap/2+shape.c[1]),shape.c[2]],h:shape.h}};
  }
  function jawContacts(c,contacts,W){
    for(const contact of contacts){const side=contact.side??contact.h?.side,mode=c.jawModes.get(side);contact.jawMode=mode;contact.jawBase=contact.base;contact.jawJ=mode&&contact.jaw?-dot(contact.normal,mv(W.handPose(side).R,[0,contact.jaw/2,0])):0;}
  }
  function solveJawContacts(c,contacts,run){
    for(let attempt=0;attempt<10;attempt++){
      for(const contact of contacts)contact.base=contact.jawBase+contact.jawJ*(contact.jawMode?jawOffset(contact.jawMode):0);
      const bounds=[];for(const mode of c.jawModes.values())if(!mode.stop)for(const sign of [1,-1])bounds.push({row:contacts.map(contact=>contact.jawMode===mode?sign*contact.jawJ:0),max:mode.base.maxForce-sign*mode.load,mode,sign});
      const result=run(bounds);if(!result.converged)return result;
      const forces=result.normalForces||result.forces,totals=new Map([...c.jawModes.values()].map(mode=>[mode,mode.load])),extra=new Map([...c.jawModes.values()].map(mode=>[mode,mode.extra]));
      contacts.forEach((contact,i)=>{if(contact.jawMode)totals.set(contact.jawMode,totals.get(contact.jawMode)+contact.jawJ*forces[i]);});bounds.forEach((bound,i)=>extra.set(bound.mode,extra.get(bound.mode)+bound.sign*(result.boundMultipliers?.[i]||0)));
      let changed=false;for(const [side,mode]of c.jawModes){const a=mode.base,Q=totals.get(mode),carrier=mode.stop?(mode.stop==='low'?a.minGap:a.maxGap):a.driveGap+a.compliance*Q+extra.get(mode),spring=Math.max(-a.maxForce,Math.min(a.maxForce,a.stiffness*(carrier-a.driveGap)));
        if(mode.stop&&(mode.stop==='low'?Q>spring+1e-8:Q<spring-1e-8)){mode.stop=null;mode.extra=0;c.jawStops.delete(side);changed=true;}
        else if(!mode.stop&&(carrier<a.minGap-1e-12||carrier>a.maxGap+1e-12)){mode.stop=carrier<a.minGap?'low':'high';c.jawStops.set(side,mode.stop);changed=true;}
      }
      if(changed)continue;
      for(const mode of c.jawModes.values()){mode.load=totals.get(mode);mode.extra=extra.get(mode);}return result;
    }
    throw new Error('Cloth jaw stroke active set did not converge.');
  }
  // A conforming cut boundary, rather than a staircase of whole grid cells. The inner
  // vertices stay on the material grid; boundary vertices lie on the actual cut lines.
  function cutPattern(points,faces,width,height,bodySpan,neckRadius,swatch){
    const segments=[],put=(a,b,kind)=>segments.push({a,b,kind}),half=width/2,span=bodySpan/2,cuff=height/2,underarm=width*.125,cuffLow=width*.14,cuffHigh=width*.39;
    put([-half,-span],[-half,span],'hem');put([-half,span],[underarm,span],'side');put([underarm,span],[cuffLow,cuff],'side');
    put([cuffLow,cuff],[cuffHigh,cuff],'cuff');put([cuffHigh,cuff],[half,span],'shoulder');put([half,span],[half,neckRadius],'shoulder');
    for(let i=0;i<24;i++){const a=Math.PI/2+i*Math.PI/24,b=a+Math.PI/24;put([half+neckRadius*Math.cos(a),neckRadius*Math.sin(a)],[half+neckRadius*Math.cos(b),neckRadius*Math.sin(b)],'neck');}
    put([half,-neckRadius],[half,-span],'shoulder');put([half,-span],[cuffHigh,-cuff],'shoulder');put([cuffHigh,-cuff],[cuffLow,-cuff],'cuff');
    put([cuffLow,-cuff],[underarm,-span],'side');put([underarm,-span],[-half,-span],'side');
    if(swatch){segments.length=0;put([-half,-cuff],[-half,cuff],'hem');put([-half,cuff],[half,cuff],'side');put([half,cuff],[half,-cuff],'neck');put([half,-cuff],[-half,-cuff],'side');}
    const nearest=p=>{let best=null;for(const s of segments){const d=sub(s.b,s.a),t=Math.max(0,Math.min(1,dot(sub(p,s.a),d)/dot(d,d))),q=add(s.a,mul(d,t)),distance=len(sub(p,q));if(!best||distance<best.distance)best={p:q,distance,kind:s.kind};}return best;};
    const edges=new Map();for(let t=0;t<faces.length;t+=3)for(let k=0;k<3;k++){const a=faces[t+k],b=faces[t+(k+1)%3],key=a<b?a+':'+b:b+':'+a;edges.set(key,(edges.get(key)||0)+1);}
    const boundary=new Set();for(const [key,count]of edges)if(count===1)key.split(':').forEach(i=>boundary.add(+i));
    const moved=points.map((p,i)=>boundary.has(i)?[...nearest(p.slice(0,2)).p,p[2]]:p.slice()),lookup=new Map(),map=[],unique=[];
    moved.forEach(p=>{const key=p.map(v=>Math.round(v*1e8)).join(',');if(!lookup.has(key)){lookup.set(key,unique.length);unique.push(p);}map.push(lookup.get(key));});
    const triangles=[];for(let t=0;t<faces.length;t+=3){const ids=faces.slice(t,t+3).map(i=>map[i]),[a,b,c]=ids.map(i=>unique[i]),area=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);if(area>1e-10)triangles.push(...ids);}
    const used=new Set(triangles),remap=new Map(),material=[];unique.forEach((p,i)=>{if(used.has(i)){remap.set(i,material.length);material.push(p);}});
    const out=triangles.map(i=>remap.get(i)),counts=new Map();for(let t=0;t<out.length;t+=3)for(let k=0;k<3;k++){const a=out[t+k],b=out[t+(k+1)%3],key=a<b?a+':'+b:b+':'+a;counts.set(key,(counts.get(key)||0)+1);}
    const sewn=new Set(),openings={neck:new Set(),hem:new Set(),cuff:new Set()},openingEdges={neck:[],hem:[],cuff:[]};
    for(const [key,count]of counts)if(count===1){const ids=key.split(':').map(Number),middle=mul(add(material[ids[0]],material[ids[1]]),.5),kind=nearest(middle.slice(0,2)).kind;if(kind!=='side'&&kind!=='shoulder')openingEdges[kind].push(ids);for(const i of ids)if(kind==='side'||kind==='shoulder')sewn.add(i);else openings[kind].add(i);}
    return {material,triangles:out,sewn,openings,openingEdges};
  }
  // The opening midpoint is a fixed material anchor, not the closest grid
  // particle. Rest-length weights let its marker follow arbitrary deformation.
  function openingAnchor(material,edges){
    if(!edges.length)return null;
    const adjacent=new Map();for(const [a,b]of edges){if(!adjacent.has(a))adjacent.set(a,[]);if(!adjacent.has(b))adjacent.set(b,[]);adjacent.get(a).push(b);adjacent.get(b).push(a);}
    const ends=[...adjacent.keys()].filter(i=>adjacent.get(i).length===1).sort((a,b)=>material[a][0]-material[b][0]||material[a][1]-material[b][1]);if(ends.length!==2)return null;
    const chain=[ends[0]];let previous=-1;while(chain.length<=edges.length){const i=chain[chain.length-1],next=adjacent.get(i).find(j=>j!==previous);if(next===undefined)break;chain.push(next);previous=i;}
    if(chain.length!==edges.length+1)return null;
    const lengths=chain.slice(1).map((id,i)=>Math.hypot(material[id][0]-material[chain[i]][0],material[id][1]-material[chain[i]][1])),length=lengths.reduce((sum,v)=>sum+v,0);if(!(length>0))return null;
    let remaining=length/2;for(let i=0;i<lengths.length;i++){if(remaining>lengths[i]&&i<lengths.length-1){remaining-=lengths[i];continue;}const ids=[chain[i],chain[i+1]],t=Math.max(0,Math.min(1,remaining/lengths[i])),w=[1-t,t],materialPoint=ids.reduce((p,id,k)=>add(p,mul(material[id],w[k])),[0,0,0]);return Object.freeze({ids:Object.freeze(ids),w:Object.freeze(w),materialPoint:Object.freeze(materialPoint),length});}
    return null;
  }
  function cuffCenter(c,index){const anchor=c.openingAnchors?.cuffs?.[index];return anchor?anchor.ids.reduce((p,id,k)=>add(p,mul(c.nodes[id].p,anchor.w[k])),[0,0,0]):null;}
  function membrane(ids,material,stiffness){
    const [a,b,c]=ids.map(i=>material[i]),u=sub(b,a),v=sub(c,a),det=u[0]*v[1]-v[0]*u[1],area=Math.abs(det)/2;
    const gx=[(u[1]-v[1])/det,v[1]/det,-u[1]/det],gy=[(v[0]-u[0])/det,-v[0]/det,u[0]/det];
    return {ids,gx,gy,area,compliance:stiffness.map(k=>1/(k*area)),lambda:[0,0,0]};
  }
  const bendingCache=new Map();
  function inverseMatrix(A){
    const n=A.length,X=A.map((row,i)=>[...row,...Array.from({length:n},(_,j)=>+(i===j))]);let minimum=Infinity;
    for(let i=0;i<n;i++){
      let pivot=i;for(let j=i+1;j<n;j++)if(Math.abs(X[j][i])>Math.abs(X[pivot][i]))pivot=j;
      minimum=Math.min(minimum,Math.abs(X[pivot][i]));if(minimum<1e-10)return null;
      [X[pivot],X[i]]=[X[i],X[pivot]];const diagonal=X[i][i];for(let k=0;k<2*n;k++)X[i][k]/=diagonal;
      for(let j=0;j<n;j++)if(j!==i){const value=X[j][i];for(let k=0;k<2*n;k++)X[j][k]-=value*X[i][k];}
    }
    return {rows:X.map(row=>row.slice(n)),minimum};
  }
  function positiveSolve(matrix,rhs){
    const n=rhs.length,L=matrix.map(row=>row.slice()),x=new Float64Array(n);
    for(let i=0;i<n;i++)for(let j=0;j<=i;j++){let value=L[i][j];for(let k=0;k<j;k++)value-=L[i][k]*L[j][k];if(i===j){if(value<=1e-15)return null;L[i][j]=Math.sqrt(value);}else L[i][j]=value/L[j][j];}
    for(let i=0;i<n;i++){let value=rhs[i];for(let k=0;k<i;k++)value-=L[i][k]*x[k];x[i]=value/L[i][i];}for(let i=n-1;i>=0;i--){let value=x[i];for(let k=i+1;k<n;k++)value-=L[k][i]*x[k];x[i]=value/L[i][i];}return x;
  }
  function contactSolve(matrix,gap){
    const n=gap.length,lambda=new Float64Array(n),active=new Set();
    for(let iteration=0;iteration<n*n+1;iteration++){
      let enter=-1,worst=-1e-10;for(let i=0;i<n;i++)if(!active.has(i)){let value=gap[i];for(let j=0;j<n;j++)value+=matrix[i][j]*lambda[j];if(value<worst){worst=value;enter=i;}}
      if(enter<0)return lambda;active.add(enter);
      for(let inner=0;inner<n+1;inner++){
        const ids=[...active],values=positiveSolve(ids.map(i=>ids.map(j=>matrix[i][j])),ids.map(i=>-gap[i]));if(!values)return null;
        if(values.every(v=>v>0)){lambda.fill(0);ids.forEach((id,k)=>{lambda[id]=values[k];});break;}
        let alpha=1;ids.forEach((id,k)=>{if(values[k]<=0)alpha=Math.min(alpha,lambda[id]/(lambda[id]-values[k]));});ids.forEach((id,k)=>{lambda[id]+=alpha*(values[k]-lambda[id]);if(lambda[id]<1e-12){lambda[id]=0;active.delete(id);}});
      }
    }
    return null;
  }
  // Material-direction curvature has physical units 1/m. Recovering the three
  // quadratic derivatives gives E=A/2*(Bw|x_uu|²+2sqrt(BwBf)|x_uv|²+Bf|x_vv|²).
  // This zero-Poisson shell model reproduces cylinder rigidity without a hidden
  // triangle-orientation factor; affine material maps have exactly zero bending.
  // Directional curvature energies: Wardetzky et al., Discrete Quadratic Curvature
  // Energies (2007), section4. The compact polynomial recovery is our discretization.
  function bendingHessians(triangles,material,bending,maxSpan){
    const key=maxSpan+'|'+material.map(p=>p.slice(0,2).join(',')).join(';')+'|'+triangles.join(',');let stencils=bendingCache.get(key);
    if(!stencils){
      const neighbours=material.map(()=>new Set()),areas=material.map(()=>0);
      for(let t=0;t<triangles.length;t+=3){const ids=triangles.slice(t,t+3),[a,b,d]=ids.map(i=>material[i]),area=Math.abs((b[0]-a[0])*(d[1]-a[1])-(d[0]-a[0])*(b[1]-a[1]))/6;for(const i of ids){areas[i]+=area;for(const j of ids)neighbours[i].add(j);}}
      stencils=material.map((origin,i)=>{
        const pool=new Set([i]);let fit=null;
        for(let ring=1;ring<=5&&!fit;ring++){
          for(const j of [...pool])for(const k of neighbours[j])pool.add(k);if(ring<2)continue;
          const candidates=[...pool],distance=j=>(material[j][0]-origin[0])**2+(material[j][1]-origin[1])**2,windows=[...new Set([i-maxSpan,i,...candidates.filter(j=>j<=i&&j>=i-maxSpan)])];let best=Infinity;
          for(const lower of windows){
            const sorted=candidates.filter(j=>j>=lower&&j<=lower+maxSpan).sort((a,b)=>distance(a)-distance(b)||a-b);
            for(let count=Math.min(9,sorted.length);count<=sorted.length;count++){
              if(count<6)continue;const ids=sorted.slice(0,count),h=Math.sqrt(Math.max(...ids.map(distance)));if(h<1e-10)continue;
              const basis=ids.map(j=>{const u=(material[j][0]-origin[0])/h,v=(material[j][1]-origin[1])/h;return [1,u,v,u*u/2,u*v,v*v/2];}),gram=Array.from({length:6},(_,a)=>Array.from({length:6},(_,b)=>basis.reduce((s,row)=>s+row[a]*row[b],0))),inverse=inverseMatrix(gram);
              if(!inverse||inverse.minimum<.001)continue;
              const score=ids.reduce((s,j)=>s+distance(j),0);if(score<best){best=score;fit={ids,area:areas[i],rows:[3,4,5].map(k=>basis.map(row=>row.reduce((s,v,a)=>s+v*inverse.rows[k][a],0)/(h*h)))};}break;
            }
          }
        }
        if(!fit)throw new Error('Rank-deficient garment curvature stencil');return fit;
      });
      if(bendingCache.size>8)bendingCache.delete(bendingCache.keys().next().value);bendingCache.set(key,stencils);
    }
    return stencils.flatMap(s=>s.rows.map((k,axis)=>({ids:s.ids,k,compliance:1/(s.area*[bending[0],2*Math.sqrt(bending[0]*bending[1]),bending[1]][axis]),lambda:[0,0,0]})));
  }
  // Local/global material-energy solve (Bouaziz et al. 2014). Interleaving the
  // sewn panels keeps the sparse Cholesky factor banded instead of coupling two
  // distant blocks. The mass and SI material constants remain resolution based.
  function materialSystem(c,dt,attachments,W){
    const count=c.nodes.length,order=c.materialOrder||(c.materialOrder=Int32Array.from({length:c.nodes.length},(_,i)=>c.panels===2?(i%c.panelSize)*2+Math.floor(i/c.panelSize):i)),seams=c.seamEdges||(c.seamEdges=c.edges.filter(e=>e.kind==='seam'));
    let fixedKey='';for(let i=0;i<count;i++)if(!c.weights[i])fixedKey+=i+',';const signature=dt+'|'+fixedKey;
    let system=c.materialSystem;
    if(!system||system.signature!==signature){
      const groups=[...c.membranes.map(m=>m.ids),...c.bends.map(b=>b.ids),...seams.map(e=>[e.a,e.b])];let band=0;
      for(const ids of groups)for(const i of ids)for(const j of ids)band=Math.max(band,Math.abs(order[i]-order[j]));
      const stride=band+1,L=new Float64Array(count*stride),fixed=new Map();
      const block=(ids,value)=>{for(let i=0;i<ids.length;i++)for(let j=0;j<ids.length;j++){
        const a=ids[i],b=ids[j],v=value(i,j);if(!c.weights[a])continue;
        if(!c.weights[b]){const key=order[a]+':'+b;fixed.set(key,(fixed.get(key)||0)+v);}else if(order[a]>=order[b])L[order[a]*stride+order[a]-order[b]]+=v;
      }};
      for(let i=0;i<count;i++)L[order[i]*stride]=c.weights[i]?1/(c.weights[i]*dt*dt):1;
      for(const m of c.membranes){const u=1/m.compliance[0]+2/m.compliance[2],v=1/m.compliance[1]+2/m.compliance[2];block(m.ids,(i,j)=>u*m.gx[i]*m.gx[j]+v*m.gy[i]*m.gy[j]);}
      for(const b of c.bends)block(b.ids,(i,j)=>b.k[i]*b.k[j]/b.compliance);
      for(const e of seams)block([e.a,e.b],(i,j)=>(i===j?1:-1)/e.compliance);
      for(let i=0;i<count;i++)for(let j=Math.max(0,i-band);j<=i;j++){
        let value=L[i*stride+i-j];for(let k=Math.max(0,i-band,j-band);k<j;k++)value-=L[i*stride+i-k]*L[j*stride+j-k];
        L[i*stride+i-j]=i===j?Math.sqrt(Math.max(1e-16,value)):value/L[j*stride];
      }
      const rows=Array.from({length:count},()=>[]),columns=Array.from({length:count},()=>[]);let nonzero=0;
      for(let i=0;i<count;i++)for(let j=Math.max(0,i-band);j<i;j++){const value=L[i*stride+i-j];if(value!==0){rows[i].push(j,value);columns[j].push(i,value);nonzero++;}}
      const compress=lists=>{const offset=new Int32Array(count+1),index=new Int32Array(nonzero),value=new Float64Array(nonzero);let at=0;lists.forEach((row,i)=>{offset[i]=at;for(let k=0;k<row.length;k+=2){index[at]=row[k];value[at++]=row[k+1];}});offset[count]=at;return {offset,index,value};};
      system=c.materialSystem={signature,band,stride,L,forward:compress(rows),backward:compress(columns),fixed:[...fixed].map(([key,value])=>({row:+key.split(':')[0],id:+key.split(':')[1],value})),rhs:new Float64Array(count*3),y:new Float64Array(count*3),x:new Float64Array(count*3)};
    }
    const {stride,L,rhs,y,x,forward,backward}=system;
    const solve=(input,output,work)=>{for(let i=0;i<count;i++){let v=input[i];for(let k=forward.offset[i];k<forward.offset[i+1];k++)v-=forward.value[k]*work[forward.index[k]];work[i]=v/L[i*stride];}for(let i=count-1;i>=0;i--){let v=work[i];for(let k=backward.offset[i];k<backward.offset[i+1];k++)v-=backward.value[k]*output[backward.index[k]];output[i]=v/L[i*stride];}};
    const columns=system.columns||(system.columns=Array(count));
    const column=id=>{if(!columns[id]){const b=new Float64Array(count),out=new Float64Array(count),work=new Float64Array(count);if(c.weights[id])b[order[id]]=1;solve(b,out,work);columns[id]=out;}return columns[id];};
    c.materialEntry=(a,b)=>column(b)[order[a]];
    c.materialForceResponse=(forces,out=new Float64Array(count*3))=>{
      const work=system.contactWork||(system.contactWork={rhs:new Float64Array(count*3),y:new Float64Array(count*3),x:new Float64Array(count*3)}),rhs=work.rhs,y=work.y,x=work.x;
      for(let id=0;id<count;id++)for(let k=0;k<3;k++)rhs[order[id]*3+k]=c.weights[id]?forces[id*3+k]:0;
      for(let i=0;i<count;i++){const at=i*3,diagonal=L[i*stride];let a=rhs[at],b=rhs[at+1],d=rhs[at+2];for(let k=forward.offset[i];k<forward.offset[i+1];k++){const v=forward.value[k],j=forward.index[k]*3;a-=v*y[j];b-=v*y[j+1];d-=v*y[j+2];}y[at]=a/diagonal;y[at+1]=b/diagonal;y[at+2]=d/diagonal;}
      for(let i=count-1;i>=0;i--){const at=i*3,diagonal=L[i*stride];let a=y[at],b=y[at+1],d=y[at+2];for(let k=backward.offset[i];k<backward.offset[i+1];k++){const v=backward.value[k],j=backward.index[k]*3;a-=v*x[j];b-=v*x[j+1];d-=v*x[j+2];}x[at]=a/diagonal;x[at+1]=b/diagonal;x[at+2]=d/diagonal;}
      for(let id=0;id<count;id++)for(let k=0;k<3;k++)out[id*3+k]=x[order[id]*3+k];return out;
    };
    // The scalar interpolation uses the identical accumulation order as the
    // full response column, without allocating a node-sized vector per sample.
    c.materialMobility=row=>{let value=0;for(let a=0;a<row.ids.length;a++){let at=0;for(let b=0;b<row.ids.length;b++)at+=row.w[b]*column(row.ids[b])[order[row.ids[a]]];value+=row.w[a]*at;}return value;};
    c.materialResponse=rows=>{
      const z=rows.map(row=>{const out=new Float64Array(count);row.ids.forEach((id,k)=>{const values=column(id),w=row.w[k];for(let j=0;j<count;j++)out[j]+=w*values[j];});return out;}),S=rows.map(row=>z.map(column=>row.ids.reduce((s,id,k)=>s+row.w[k]*column[order[id]],0)));return {z,S,order};
    };
    return predicted=>{
      resetJawModes(c);
      for(let i=0;i<count;i++)for(let k=0;k<3;k++)rhs[order[i]*3+k]=c.weights[i]?predicted[i][k]/(c.weights[i]*dt*dt):c.nodes[i].p[k];
      for(const term of system.fixed)for(let k=0;k<3;k++)rhs[term.row*3+k]-=term.value*c.nodes[term.id].p[k];
      for(const m of c.membranes){
        let ux=0,uy=0,uz=0,vx=0,vy=0,vz=0;for(let i=0;i<3;i++){const p=c.nodes[m.ids[i]].p;ux+=m.gx[i]*p[0];uy+=m.gx[i]*p[1];uz+=m.gx[i]*p[2];vx+=m.gy[i]*p[0];vy+=m.gy[i]*p[1];vz+=m.gy[i]*p[2];}
        const U=Math.hypot(ux,uy,uz),V=Math.hypot(vx,vy,vz),sx=ux+vx,sy=uy+vy,sz=uz+vz,dx=ux-vx,dy=uy-vy,dz=uz-vz,S=Math.hypot(sx,sy,sz),D=Math.hypot(dx,dy,dz),r=(S+D)/4,rs=S>1e-12?r/S:0,rd=D>1e-12?r/D:0;
        // Orthogonality is |u+v|=|u-v|. Equalizing those two lengths is the
        // exact local projection, so no current-length or shear-energy shortcut.
        const ku=1/m.compliance[0],kv=1/m.compliance[1],ks=2/m.compliance[2];
        const au=U>1e-12?ku/U:0,av=V>1e-12?kv/V:0,tx=rs*sx,ty=rs*sy,tz=rs*sz,qx=rd*dx,qy=rd*dy,qz=rd*dz;
        for(let i=0;i<3;i++)if(c.weights[m.ids[i]]){const at=order[m.ids[i]]*3,gx=m.gx[i],gy=m.gy[i];rhs[at]+=gx*(au*ux+ks*(tx+qx))+gy*(av*vx+ks*(tx-qx));rhs[at+1]+=gx*(au*uy+ks*(ty+qy))+gy*(av*vy+ks*(ty-qy));rhs[at+2]+=gx*(au*uz+ks*(tz+qz))+gy*(av*vz+ks*(tz-qz));}
      }
      for(const e of seams){const d=sub(c.nodes[e.a].p,c.nodes[e.b].p),length=len(d);if(length<1e-12)continue;for(const [id,sign]of [[e.a,1],[e.b,-1]])if(c.weights[id])for(let k=0;k<3;k++)rhs[order[id]*3+k]+=sign*e.rest*d[k]/(length*e.compliance);}
      // Three right-hand sides share every coefficient and index calculation.
      for(let i=0;i<count;i++){const at=i*3,diagonal=L[i*stride];let a=rhs[at],b=rhs[at+1],d=rhs[at+2];for(let k=forward.offset[i];k<forward.offset[i+1];k++){const v=forward.value[k],j=forward.index[k]*3;a-=v*y[j];b-=v*y[j+1];d-=v*y[j+2];}y[at]=a/diagonal;y[at+1]=b/diagonal;y[at+2]=d/diagonal;}
      for(let i=count-1;i>=0;i--){const at=i*3,diagonal=L[i*stride];let a=y[at],b=y[at+1],d=y[at+2];for(let k=backward.offset[i];k<backward.offset[i+1];k++){const v=backward.value[k],j=backward.index[k]*3;a-=v*x[j];b-=v*x[j+1];d-=v*x[j+2];}x[at]=a/diagonal;x[at+1]=b/diagonal;x[at+2]=d/diagonal;}
      for(let i=0;i<count;i++)for(let k=0;k<3;k++)c.nodes[i].p[k]=x[order[i]*3+k];
      attachments.forEach(a=>{a.lambda=[0,0,0];});c.bodyOffsets=null;c.padStates=new Map();c.gripSupport={};c.patchContacts=[];c.gripResidual=0;

    };
  }
  function towel(spec, table) {
    const shirt = spec.kind === 'shirt', N = spec.resolution || (shirt ? 21 : 9), iterations = spec.iterations || (shirt ? 8 : ITER);
    const bendCompliance=spec.bend_compliance ?? .5,bendMemory=shirt?0:spec.bend_memory||0, radius=Math.max(shirt?.00015:.001,Math.min(.012,(spec.thickness || .005)/2));
    const width = spec.width || (shirt ? .28 : .20), height = spec.height || (shirt ? .50 : .24), rows = shirt ? Math.round((N-1)*height/width)+1 : N;
    const start = [], material = [], edges = [], triangles = [], pins = new Map(), grid = new Map();
    const bodySpan = spec.body_span || .18,neckRadius=spec.neck_radius||.034,neckBackDepth=spec.neck_back_depth??.008,panelCount=shirt?Math.max(1,Math.min(2,spec.panels||1)):1;
    const inside = (x,y) => {
      if (!shirt||spec.pattern==='swatch') return true;
      if (Math.abs(y) <= bodySpan/2) return Math.hypot(x-width/2,y) >= neckRadius;
      const t = (Math.abs(y)-bodySpan/2)/(height/2-bodySpan/2);
      return x >= width*(.125+.015*t) && x <= width*(.5-.11*t);
    };
    const vertex = (i,j) => {
      const key = j*N+i;
      if (!grid.has(key)) {
        const crimp=spec.pile ? .0008*(1+Math.sin(i*1.7)*Math.sin(j*1.3)) : 0;
        const p = [(i/(N-1)-.5)*width,(j/(rows-1)-.5)*height,radius+crimp];
        grid.set(key,start.length); material.push(p);
        start.push(add(table.t,mv(table.R,add(p,spec.at))));
      }
      return grid.get(key);
    };
    if(!shirt)for(let j=0;j<rows;j++)for(let i=0;i<N;i++)vertex(i,j);
    for(let j=0;j<rows-1;j++)for(let i=0;i<N-1;i++) {
      if (!inside(((i+.5)/(N-1)-.5)*width,((j+.5)/(rows-1)-.5)*height)) continue;
      const [a,b,c,d]=[vertex(i,j),vertex(i+1,j),vertex(i,j+1),vertex(i+1,j+1)];
      triangles.push(...((i+j)%2 ? [a,b,c,b,d,c] : [a,b,d,a,d,c]));
    }
    let pattern=null,panelSize=material.length;
    if(shirt){
      pattern=cutPattern(material,triangles,width,height,bodySpan,neckRadius,spec.pattern==='swatch');material.splice(0,material.length,...pattern.material);triangles.splice(0,triangles.length,...pattern.triangles);panelSize=material.length;
      if(panelCount===2){
        const back=material.map((p,i)=>[spec.pattern!=='swatch'&&pattern.openings.neck.has(i)&&!pattern.sewn.has(i)?width/2+(p[0]-width/2)*neckBackDepth/neckRadius:p[0],p[1],p[2]]);
        // Outward winding: the visible front is above the shallow back neckline.
        material.forEach(p=>{p[2]+=2*radius;});material.push(...back);const original=triangles.slice();for(let t=0;t<original.length;t+=3)triangles.push(original[t]+panelSize,original[t+2]+panelSize,original[t+1]+panelSize);
      }
      start.splice(0,start.length,...material.map(p=>add(table.t,mv(table.R,add(p,spec.at||[0,0,0])))));
    }
    const linked = new Set(), neighbours = start.map((_,i)=>new Set([i]));
    const link = (a,b,compliance,kind='distance') => {
      const key = Math.min(a,b)+':'+Math.max(a,b); if(linked.has(key))return;linked.add(key);
      const rest=len(sub(start[a],start[b]));if(rest<1e-10)return;edges.push({a,b,rest,rest0:rest,compliance,lambda:0,kind});
      if(kind==='mesh'||kind==='seam'||compliance<1e-6){neighbours[a].add(b);neighbours[b].add(a);}
    };
    if(shirt){for(let t=0;t<triangles.length;t+=3)for(let k=0;k<3;k++)link(triangles[t+k],triangles[t+(k+1)%3],Infinity,'mesh');if(panelCount===2)for(const i of pattern.sewn)link(i,i+panelSize,spec.seam_compliance??1e-6,'seam');}
    else for(let j=0;j<rows;j++)for(let i=0;i<N;i++) {
      const k=grid.get(j*N+i);if(k===undefined)continue;
      for(const [di,dj,compliance] of [[1,0,2e-8],[0,1,2e-8],[1,1,8e-8],[-1,1,8e-8],[2,0,bendCompliance],[0,2,bendCompliance]]) {
        const ni=i+di,nj=j+dj;if(ni<0||ni>=N||nj>=rows)continue;
        const next=grid.get(nj*N+ni),mid=grid.get((j+dj/2)*N+i+di/2);
        if(next!==undefined && (compliance<1e-6 || mid!==undefined))link(k,next,compliance);
      }
    }
    // Triangle area gives cut-pattern boundary particles their proper share of mass.
    const areas=start.map(()=>0);
    for(let t=0;t<triangles.length;t+=3){const ids=triangles.slice(t,t+3),a=sub(material[ids[1]],material[ids[0]]),b=sub(material[ids[2]],material[ids[0]]),area=Math.abs(a[0]*b[1]-a[1]*b[0])/6;for(const i of ids)areas[i]+=area;}
    const totalArea=areas.reduce((a,b)=>a+b,0), mass=spec.areal_density?spec.areal_density*totalArea:spec.mass || (shirt?.11:.08);
    const weights=areas.map(a=>shirt?totalArea/(a*mass):start.length/mass),membranes=shirt?Array.from({length:triangles.length/3},(_,i)=>membrane(triangles.slice(i*3,i*3+3),material,[spec.warp_stiffness||600,spec.weft_stiffness||250,spec.shear_stiffness||25])):[],bends=shirt?bendingHessians(triangles,material,[spec.bend_warp||1.2e-5,spec.bend_weft||8e-6],2*N+10):[];
    const nearest = p => material.reduce((best,v,i)=>len(sub(v,p))<len(sub(material[best],p))?i:best,0);
    const landmarks=shirt?{
      cuffs:[nearest([.067,height/2,radius*(panelCount*2-1)]),nearest([.067,-height/2,radius*(panelCount*2-1)])],
      hem:[nearest([-width/2,bodySpan/2-.014,radius*(panelCount*2-1)]),nearest([-width/2,-bodySpan/2+.014,radius*(panelCount*2-1)])],
      shoulders:[nearest([width/2,bodySpan/2-.014,radius*(panelCount*2-1)]),nearest([width/2,-bodySpan/2+.014,radius*(panelCount*2-1)])],
      sleeves:[material.flatMap((p,i)=>p[1]>bodySpan/2+.005?[i]:[]),material.flatMap((p,i)=>p[1]<-bodySpan/2-.005?[i]:[])]
    }:null;
    const openingAnchors=pattern?{cuffs:[1,-1].map(side=>openingAnchor(material,pattern.openingEdges.cuff.filter(([a,b])=>side*(material[a][1]+material[b][1])>0)))}:null;
    const c = { friction:spec.friction??.5,selfFriction:spec.self_friction??.45,forces:new Map(),layerCompliance:spec.pile ? .005 : 0,foldAxes:spec.fold_axes||'xy',halfThickness:radius,pile:spec.pile||0,foldStage:0,firstHands:new Set(),foldHands:new Set(),restTime:0, key:spec.key,kind:shirt?'shirt':'towel',color:spec.color,label:spec.label,N,rows,width,height,bodySpan,neckRadius,neckBackDepth,triangles,edges,membranes,bends,panels:panelCount,panelSize,openings:pattern&&Object.fromEntries(Object.entries(pattern.openings).map(([key,ids])=>[key,[...ids]])),openingAnchors,mass,area:totalArea,arealDensity:mass/totalArea,patternSmooth:shirt,pins,material,landmarks,table,weights,reactions:{},nodes:[],folds:new Set(),touched:new Set() };
    c.reset = () => { c.acceptedContact=null;c.contactGeneration=0;for(const side of pins.keys())if(c.lastWorld?.hands[side]){delete c.lastWorld.hands[side].fabricGap;c.lastWorld.hands[side].fabricForce=0;}c.nodes = start.map((p) => ({ p:p.slice(),v:[0,0,0] }));pins.clear();c.forces.clear();c.folds.clear();c.touched.clear();c.reactions={};c.restTime=0;c.foldStage=0;c.firstHands.clear();c.foldHands.clear();for(const e of edges)e.rest=e.rest0;for(const m of membranes)m.lambda.fill(0);for(const b of bends)b.lambda.fill(0);c.edgePose=null;c.edgePairs=[];c.edgeBroadphase=null;c.surfacePose=null;c.surfaceManifold=null;c.surfaceBroadphase=null;c.patchContacts=[]; };
    c.reset();
    c.step = (dt, W) => {
      c.newtonCalls=0;const ns = c.nodes,G=W.gripper,pad=G?.pad||{c:[0,0,-.0925],h:[.022,.002,.0375]};c.contactGeneration=(c.contactGeneration||0)+1;if(c.acceptedContact&&(c.acceptedContact.world!==W||c.acceptedContact.gripper!==G||c.acceptedContact.generation<c.contactGeneration-1||c.contactStepComplete===false||c.acceptedContact.hands.some(([side,body])=>W.hands[side]?.body!==body)))c.acceptedContact=null;c.contactStepComplete=false;c.lastWorld=W;c.reactions={};c.patchContacts=[];c.bodyOffsets=null;c.padStates=new Map();c.gripSupport={};c.patchResidual=0;c.patchIterations=0;c.patchFeasibility=0;c.surfaceStats={samples:0,rows:0,iterations:0};c.coldContacts=true;c.surfaceTableWrench={force:[0,0,0],torque:[0,0,0]};c.jawBaselines=new Map();c.jawStops=new Map();c.handGeometry=new Map();for(const [side,h]of Object.entries(W.hands)){const a=W.jawActuator?.(side);if(a)c.jawBaselines.set(side,a);if(G)c.handGeometry.set(side,handGeometry(G,h,a));}resetJawModes(c);
      const bodyResponses=new Map(),frozenBody=body=>{
        if(bodyResponses.has(body))return bodyResponses.get(body);
        const token=shirt&&!body.fixed&&W.deformableResponse?W.deformableResponse(body,dt):null,im=body.fixed?0:token?.inverseMass??body.invM??(body.m?1/body.m:0);let inertia=body.fixed?Array(9).fill(0):token?.inverseInertia||body.iW||Array(9).fill(0);
        if(!token&&!body.fixed&&body.R&&body.invIb)inertia=Array.from({length:9},(_,at)=>{const i=Math.floor(at/3),j=at%3;let value=0;for(let k=0;k<3;k++)for(let l=0;l<3;l++)value+=body.R[3*i+k]*body.invIb[3*k+l]*body.R[3*j+l];return value;});
        const value={token,position:token?.position||body.t.slice(),im,inertia};bodyResponses.set(body,value);return value;
      };
      let commonTableOwned=false,commonOwnershipRetry=false,commonNodes=null;
      // The common solve owns only the material near a hand. Far nodes keep the
      // cheap per-node table/layer contacts, so its size does not grow with the garment.
      const owns=id=>!commonNodes||commonNodes.has(id);
      const trimPin=(side,h,pin,pose)=>{
        if(!shirt||!G)return true;
        const pad=c.handGeometry.get(side).region;const kept=[];for(let layer=0;layer<pin.layers;layer++)if(pin.points.slice(layer*3,layer*3+3).some(point=>{const p=point.ids.reduce((v,id,k)=>add(v,mul(ns[id].p,point.w[k])),[0,0,0]),local=mt(pose.R,sub(p,pose.t));return Math.abs(local[0]-pad.c[0])<=pad.h[0]+radius&&Math.abs(local[2]-pad.c[2])<=pad.h[2]+radius&&Math.abs(local[1]-pad.c[1])<=pad.h[1]+radius;}))kept.push(layer);
        if(kept.length===pin.layers)return true;
        if(!kept.length){pins.delete(side);delete h.fabricGap;if(!c.jawBaselines.has(side))h.fabricForce=0;h.clothSlip=!!(pin.acquired||pin.loaded);return false;}
        pin.points=kept.flatMap(i=>pin.points.slice(i*3,i*3+3));pin.inverses=kept.map(i=>pin.inverses[i]);pin.layers=kept.length;pin.thickness=2*radius*pin.layers;pin.local=pin.points.filter((_,i)=>i%3===0).reduce((v,p)=>add(v,mul(p.local,1/pin.layers)),[0,0,0]);pin.i=pin.points[0].ids[0];pin.ranks=[];pin.points.filter((_,i)=>i%3===0).map((p,patch)=>({patch,y:p.local[1]})).sort((a,b)=>a.y-b.y).forEach((p,rank)=>{pin.ranks[p.patch]=rank;});h.fabricGap=pin.thickness;if(h.gap>pin.thickness+1e-6)h.fabricForce=0;return true;
      };
      // Both jaws must surround a patch. Closing captures it, opening releases it; no cursor-to-cloth teleport.
      for (const [side, h] of Object.entries(W.hands)) {
        const pose = W.handPose(side), pin = pins.get(side), gap = h.gap,pad=c.handGeometry.get(side)?.region||{c:[0,0,-.0925],h:[.022,gap/2,.0375]};
        if (h.target > 0.012) h.clothSlip = false;
        if (pin && (h.target >= (pin.thickness||.012) || h.grip)) { pins.delete(side);delete h.fabricGap;h.fabricForce=0;continue; }
        if(pin&&!trimPin(side,h,pin,pose))continue;
        if(pin&&shirt){h.fabricGap=pin.thickness;if(!c.jawBaselines.has(side))h.gap=Math.max(h.gap,pin.thickness);}
        // Jaws that lost their patch while closed stay empty until reopened, rather than taking whatever is nearest.
        if (!pin && !h.grip && !h.clothSlip && h.target < 0.012 && h.gap < .018 && !W.cloths.some((q) => q !== c && q.pins.has(side))) {
          let best = null;
          for (const cloth of W.cloths) cloth.nodes.forEach((n, i) => {
            if ([...cloth.pins.values()].some((p) => p.points.some(q=>q.ids.includes(i)))) return;
            const p = mt(pose.R, sub(n.p, pose.t));
            if (Math.abs(p[0]-pad.c[0]) < pad.h[0] && Math.abs(p[1]-pad.c[1]) < Math.max(radius*2,pad.h[1]) && Math.abs(p[2]-pad.c[2]) < pad.h[2]) {
              const d = Math.hypot(p[0]-pad.c[0],p[1]-pad.c[1],p[2]-pad.c[2]); if (!best || d < best.d) best = { i, local: p, d, cloth };
            }
          });
          // A finite rubber face can enclose the interior of a coarse triangle
          // without enclosing any vertex. Capture that real material surface,
          // rather than requiring a resolution-dependent particle coincidence.
          if(shirt&&G&&!best){
            const slot={t:add(pose.t,mv(pose.R,pad.c)),R:pose.R,h:[pad.h[0],Math.max(radius,pad.h[1]-radius),pad.h[2]]},candidates=[];
            for(const cloth of W.cloths){const seen=new Set();for(let t=0;t<cloth.triangles.length;t+=3){
              const ids=cloth.triangles.slice(t,t+3),ps=ids.map(id=>cloth.nodes[id].p),contacts=Contact.triangleBox(ps,slot,0,{ids,seen});if(!contacts.length)continue;
              const w=[0,1,2].map(k=>contacts.reduce((s,q)=>s+q.w[k]/contacts.length,0)),point=ids.reduce((p,id,k)=>add(p,mul(cloth.nodes[id].p,w[k])),[0,0,0]),local=mt(pose.R,sub(point,pose.t)),materialPoint=ids.reduce((p,id,k)=>add(p,mul(cloth.material[id],w[k])),[0,0,0]);
              if([...cloth.pins.values()].some(p=>p.points.some(q=>q.ids.some(id=>ids.includes(id)))))continue;
              candidates.push({cloth,ids,w,point,local,materialPoint,d:Math.hypot(local[0]-pad.c[0],local[1]-pad.c[1],local[2]-pad.c[2])});
            }}
            candidates.sort((a,b)=>a.d-b.d);const chosen=[];
            for(const candidate of candidates){if(!chosen.length){if(candidate.cloth!==c)break;chosen.push(candidate);continue;}if(chosen.length>=8)break;
              if(candidate.cloth===c&&len(sub(candidate.point,chosen[0].point))<Math.min(.012,pad.h[0],pad.h[2])&&chosen.every(q=>Math.floor(q.ids[0]/panelSize)!==Math.floor(candidate.ids[0]/panelSize)||Math.hypot(q.materialPoint[0]-candidate.materialPoint[0],q.materialPoint[1]-candidate.materialPoint[1])>Math.max(.025,width/(N-1)*1.5)))chosen.push(candidate);
            }
            const points=[],inverses=[];
            for(const sample of chosen){
              const patch=[{ids:sample.ids.slice(),w:sample.w.slice(),local:sample.local.slice()}],ends=sample.ids.map((id,k)=>({id,k,d:sub(ns[id].p,sample.point)}));ends.sort((a,b)=>len(b.d)-len(a.d));const first=ends[0];ends.sort((a,b)=>len(cross(first.d,b.d))-len(cross(first.d,a.d)));const second=ends[0];
              for(const end of [first,second]){let f=Math.min(.7,.00495/Math.max(.001,len(end.d)));const direction=mt(pose.R,end.d);for(const axis of [0,1,2]){const centre=pad.c[axis],half=axis===1?Math.max(radius,pad.h[1]-radius):pad.h[axis],low=centre-half,high=centre+half;if(direction[axis]>1e-12)f=Math.min(f,Math.max(0,(high-sample.local[axis])/direction[axis]));else if(direction[axis]<-1e-12)f=Math.min(f,Math.max(0,(low-sample.local[axis])/direction[axis]));}
                const w=sample.w.map((v,k)=>v*(1-f)+(k===end.k?f:0)),point=sample.ids.reduce((p,id,k)=>add(p,mul(ns[id].p,w[k])),[0,0,0]);patch.push({ids:sample.ids.slice(),w,local:mt(pose.R,sub(point,pose.t))});
              }
              const matrix=patch.flatMap((a,i)=>patch.map((b,j)=>a.ids.reduce((s,id,k)=>s+weights[id]*a.w[k]*b.w[b.ids.indexOf(id)],i===j?2e-8/(dt*dt):0)));inverses.push(inverse3(matrix));points.push(...patch);
            }
            if(points.length){const layers=inverses.length,thickness=2*radius*layers,ranks=[],centre=chosen.reduce((p,q)=>add(p,mul(q.local,1/layers)),[0,0,0]),throughFold=chosen.some(q=>q.materialPoint[0]<-width*.1)&&chosen.some(q=>q.materialPoint[0]>width*.1);chosen.map((q,patch)=>({patch,y:q.local[1]})).sort((a,b)=>a.y-b.y).forEach((q,rank)=>{ranks[q.patch]=rank;});pins.set(side,{i:chosen[0].ids[0],local:centre,points,inverses,layers,ranks,thickness,throughFold,loaded:false,roll:0});h.fabricGap=thickness;if(!c.jawBaselines.has(side))h.gap=Math.max(gap,thickness);if(!shirt){c.touched.add(+side);if(c.foldStage===1){if(throughFold)c.foldHands.add(+side);}else c.firstHands.add(+side);}}
          }
          if (best && best.cloth === c) {
            // Three material points over an 8 mm patch constrain twist as well as translation. Barycentric
            // points keep the contact area independent of mesh resolution, including at a hem or cuff.
            const indices=[best.i];
            if(shirt&&panelCount===2){const other=best.i<panelSize?best.i+panelSize:best.i-panelSize,local=mt(pose.R,sub(ns[other].p,pose.t));if(len(sub(ns[other].p,ns[best.i].p))<radius*4+.001&&Math.abs(local[0]-pad.c[0])<pad.h[0]&&Math.abs(local[1]-pad.c[1])<Math.max(radius*2,pad.h[1])&&Math.abs(local[2]-pad.c[2])<pad.h[2])indices.push(other);}
            // A plush doubled edge is clamped through its layers. Each layer gets a separate finite
            // material patch; nearby vertices on the same sheet must not create duplicate constraints.
            if(shirt||c.pile)for(let i=0;i<ns.length&&indices.length<(shirt?8:4);i++){
              const local=mt(pose.R,sub(ns[i].p,pose.t));
              const separate=shirt?indices.every(j=>Math.floor(i/panelSize)!==Math.floor(j/panelSize)||Math.hypot(material[i][0]-material[j][0],material[i][1]-material[j][1])>Math.max(.025,width/(N-1)*1.5)):indices.every(j=>len(sub(material[i],material[j]))>.06);
              if(len(sub(ns[i].p,ns[best.i].p))<(shirt?Math.min(.012,pad.h[0],pad.h[2]):.05)&&separate
                && (shirt?Math.abs(local[0]-pad.c[0])<pad.h[0]&&Math.abs(local[1]-pad.c[1])<Math.max(radius*2,pad.h[1])&&Math.abs(local[2]-pad.c[2])<pad.h[2]:Math.abs(local[0])<.022&&Math.abs(local[1])<.014&&local[2]<-.055&&local[2]>-.13)
                && ![...pins.values()].some(p=>p.points.some(q=>q.ids.includes(i))))indices.push(i);
            }
            const points=[],inverses=[];
            for(const index of indices){
              let face=null;
              for(let t=0;t<triangles.length;t+=3)if(triangles.slice(t,t+3).includes(index)){face=triangles.slice(t,t+3);break;}
              if(!face)continue;
              const patch=[{ids:[index],w:[1],local:mt(pose.R,sub(ns[index].p,pose.t))}];
              for(const i of face.filter(i=>i!==index)){
                let f=Math.min(.7,Math.min(.008,pad.h[0]*.45,pad.h[2]*.45)/Math.max(.001,len(sub(ns[i].p,ns[index].p))));
                const centre=patch[0].local,direction=mt(pose.R,sub(ns[i].p,ns[index].p));
                if(shirt)for(const axis of [0,2]){const low=pad.c[axis]-pad.h[axis],high=pad.c[axis]+pad.h[axis];if(direction[axis]>1e-12)f=Math.min(f,Math.max(0,(high-centre[axis])/direction[axis]));else if(direction[axis]<-1e-12)f=Math.min(f,Math.max(0,(low-centre[axis])/direction[axis]));}
                const p=add(ns[index].p,mul(sub(ns[i].p,ns[index].p),f));
                patch.push({ids:[index,i],w:[1-f,f],local:mt(pose.R,sub(p,pose.t))});
              }
              const matrix=patch.flatMap((a,i)=>patch.map((b,j)=>a.ids.reduce((s,id,k)=>s+(b.ids.includes(id)?weights[id]*a.w[k]*b.w[b.ids.indexOf(id)]:0),i===j?2e-8/(dt*dt):0)));
              inverses.push(inverse3(matrix));points.push(...patch);
            }
            if(points.length){const throughFold=indices.some(i=>material[i][0]<-width*.1)&&indices.some(i=>material[i][0]>width*.1);const centre=points.filter((_,i)=>i%3===0).reduce((p,q)=>add(p,mul(q.local,1/inverses.length)),[0,0,0]),thickness=shirt?2*radius*inverses.length:.012,ranks=[];points.filter((_,i)=>i%3===0).map((p,patch)=>({patch,y:p.local[1]})).sort((a,b)=>a.y-b.y).forEach((p,rank)=>{ranks[p.patch]=rank;});pins.set(side,{i:best.i,local:centre,points,inverses,layers:inverses.length,ranks,thickness,throughFold,loaded:shirt?false:undefined,roll:0});if(shirt){h.fabricGap=thickness;if(!c.jawBaselines.has(side))h.gap=Math.max(h.gap,thickness);}if(!shirt){c.touched.add(+side);if(c.foldStage===1){if(throughFold)c.foldHands.add(+side);}else c.firstHands.add(+side);}}
          }
        }
      }
      for (const side of [...pins.keys()]) if (!W.hands[side]) pins.delete(side);
      for(const pin of pins.values()){pin.materialPoints=pin.points.filter((_,i)=>i%3===0).map(q=>q.ids.reduce((p,id,k)=>add(p,mul(material[id],q.w[k])),[0,0,0]));pin.throughFold=pin.materialPoints.some(p=>p[0]<-width*.1)&&pin.materialPoints.some(p=>p[0]>width*.1);}
      for(const [side,pin]of pins)if(c.jawBaselines.has(side)&&!pin.loaded){const pose=W.handPose(side);for(const point of pin.points){const p=point.ids.reduce((v,id,k)=>add(v,mul(ns[id].p,point.w[k])),[0,0,0]);point.local=mt(pose.R,sub(p,pose.t));}pin.local=pin.points.filter((_,i)=>i%3===0).reduce((v,p)=>add(v,mul(p.local,1/pin.layers)),[0,0,0]);}
      const attachments=[];
      for(const [side,pin] of pins){const pose=W.handPose(side);for(const [i,point] of pin.points.entries()){const patch=Math.floor(i/3);if(shirt){const gap=Math.max(W.hands[side].gap,pin.thickness),rank=pin.ranks?.[patch]??patch,low=-gap/2+radius+rank*2*radius,high=gap/2-radius-(pin.layers-rank-1)*2*radius;point.local[1]=Math.max(low,Math.min(high,point.local[1]));}const centre=pin.local,a=pin.roll||0,d=sub(point.local,centre),rolled=[Math.cos(a)*d[0]+Math.sin(a)*d[2],d[1],-Math.sin(a)*d[0]+Math.cos(a)*d[2]];attachments.push({...point,pointRef:point,pinRef:pin,side,patch,target:add(pose.t,mv(pose.R,add(centre,rolled))),lambda:[0,0,0]});}}
      const attached=new Set(attachments.flatMap(a=>a.ids));
      const applyPins=()=>{
        for(let start=0;start<attachments.length;start+=3){
          const patch=attachments.slice(start,start+3),inverse=pins.get(patch[0].side).inverses[patch[0].patch],alpha=2e-8/(dt*dt);
          const errors=patch.map(a=>{const point=a.ids.reduce((p,i,k)=>add(p,mul(ns[i].p,a.w[k])),[0,0,0]);return sub(sub(a.target,point),mul(a.lambda,alpha));});
          const deltas=patch.map((_,i)=>[0,1,2].map(k=>errors.reduce((s,e,j)=>s+inverse[i*3+j]*e[k],0)));
          patch.forEach((a,i)=>{
            const h=W.hands[a.side],pin=pins.get(a.side),capacity=shirt?2*P.GRIP.mu*(h.fabricForce||0):6,next=add(a.lambda,deltas[i]),cap=capacity*dt*dt/pin.points.length,L=len(next),limited=L>cap?mul(next,cap/L):next,dl=sub(limited,a.lambda);a.lambda=limited;
            a.ids.forEach((id,k)=>{ns[id].p=add(ns[id].p,mul(dl,weights[id]*a.w[k]));});
          });
        }
      };
      // Supported, nearly still fabric can sleep, but capture checks above always run first.
      // Plush: a few loose corner nodes chatter on top of a folded stack indefinitely; they must not keep it awake.
      const supported=ns.filter(n=>{const q=mt(table.R,sub(n.p,table.t));return Math.abs(q[0])<table.size[0]/2&&Math.abs(q[1])<table.size[1]/2&&q[2]<radius+.006;}).length;
      const plushRest=c.pile&&supported>ns.length*.04&&ns.every(n=>mt(table.R,sub(n.p,table.t))[2]<.08)&&ns.filter(n=>len(n.v)>=.15).length<=ns.length*.03&&Math.sqrt(ns.reduce((s,n)=>s+dot(n.v,n.v),0)/ns.length)<.04;
      const low=[0,1,2].map(k=>Math.min(...ns.map(n=>n.p[k]))),high=[0,1,2].map(k=>Math.max(...ns.map(n=>n.p[k]))),nearPoint=(p,r)=>p.every((v,k)=>v>=low[k]-r-.005&&v<=high[k]+r+.005),nearArm=(W.robotLinks||[]).some(L=>L.a.every((v,k)=>Math.min(v,L.b[k])-L.r<high[k]+.005&&Math.max(v,L.b[k])+L.r>low[k]-.005)),nearHand=Object.values(W.hands).some(h=>(h.body.sp||[]).some(s=>nearPoint(add(h.body.t,mv(h.body.R,s.p)),s.r))),nearBody=W.bodies.some(b=>nearPoint(b.t,b.bound));
      if(!pins.size&&!c.forces.size&&!nearHand&&!nearArm&&!nearBody&&(plushRest||supported>ns.length*.3&&ns.every(n=>len(n.v)<.002)))c.restTime+=dt;else c.restTime=0;
      if(c.restTime>.4){c.acceptedContact=null;c.contactStepComplete=true;ns.forEach(n=>{n.v=[0,0,0];});c.reactions={};return;}
      const old = ns.map((n) => n.p.slice()), hits = new Set(), tablePush = new Map(), contactNormals=new Map();
      const up=[table.R[2],table.R[5],table.R[8]];
      const tableReaction=(point,force)=>{if(shirt){c.surfaceTableWrench.force=add(c.surfaceTableWrench.force,force);c.surfaceTableWrench.torque=add(c.surfaceTableWrench.torque,cross(point,force));}};
      const supportedDirection=(id,force)=>{
        const vertical=dot(force,up);
        return id!==null&&tablePush.has(id)&&vertical<0?sub(force,mul(up,vertical)):force;
      };
      const supportLoad=(id,force,scale)=>{
        if(id===null||!tablePush.has(id))return;
        const vertical=dot(force,up);if(vertical<0){tablePush.set(id,Math.max(0,tablePush.get(id)-vertical*scale));if(weights[id])tableReaction(ns[id].p,mul(up,-vertical*scale/(weights[id]*dt*dt)));}
      };
      const normalAt=(i,n)=>{if(!contactNormals.has(i))contactNormals.set(i,[]);const all=contactNormals.get(i);if(!all.some(q=>Math.abs(dot(q,n))>.95))all.push(n);hits.add(i);};
      const gravity=W.gravity||[0,0,-9.81];
      ns.forEach((n,i) => { if(!weights[i]){n.v=[0,0,0];return;}n.v=add(n.v,mul(add(gravity,mul(c.forces.get(i)||[0,0,0],weights[i])),dt));n.p = add(n.p, mul(n.v, dt)); });
      for (const e of edges) e.lambda = 0;
      const predicted=ns.map(n=>n.p.slice()),solveMaterial=shirt?materialSystem(c,dt,attachments,W):null;
      // Use the previous material pose for the first nonlinear projection. The
      // inertial target still includes all applied impulses; starting from that
      // target would mistake a light boundary particle's prediction for strain.
      if(shirt){
        let centre=[0,0,0],moment=[0,0,0],rotation=[0,0,0];
        if(weights.every(w=>w>0)){
          centre=old.reduce((p,q,i)=>add(p,mul(q,1/(weights[i]*c.mass))),[0,0,0]);const inertia=Array(9).fill(0);
          old.forEach((p,i)=>{const r=sub(p,centre),m=1/weights[i],r2=dot(r,r);moment=add(moment,mul(cross(r,sub(predicted[i],p)),m));for(let a=0;a<3;a++)for(let b=0;b<3;b++)inertia[3*a+b]+=m*((a===b?r2:0)-r[a]*r[b]);});
          rotation=mv(inverse3(inertia),moment);
        }
        // Keep the inertial rigid rotation in the nonlinear seed; discarding it
        // makes a stiff free sheet damp spin while local/global iterations catch
        // up. Point-force deformation still starts from the old material shape.
        const angle=len(rotation),theta=angle>1e-12?mul(rotation,Math.atan(angle)/angle):[0,0,0],A=len(theta),sinc=A>1e-12?Math.sin(A)/A:1,cosc=A>1e-12?(1-Math.cos(A))/(A*A):.5;
        ns.forEach((n,i)=>{const r=sub(old[i],centre),turn=cross(theta,r);n.p=add(old[i],add(mul(turn,sinc),mul(cross(theta,turn),cosc)));});
      }
      const robotContacts=new Map(),handGroups=Object.entries(W.hands).filter(([,h])=>nearPoint(h.body.t,(h.body.bound||.2)+.04)).map(([side,h])=>({side,body:h.body,pose:W.handPose(side),gap:h.gap,jawRate:h.jawRate||0,spheres:(h.body.sp||[]).filter(s=>!G||!s.jaw&&!s.finger).map(s=>({c:add(h.body.t,mv(h.body.R,s.p)),r:s.r,mu:s.mu??.5}))})),armGroups=(W.robotLinks||[]).filter(L=>L.a.every((v,k)=>Math.min(v,L.b[k])-L.r<high[k]+.04&&Math.max(v,L.b[k])+L.r>low[k]-.04));
      const represented=new Map();for(const a of attachments)if(W.hands[a.side].fabricForce>0)a.ids.forEach((id,k)=>{if(a.w[k]>1-1e-10){if(!represented.has(a.side))represented.set(a.side,new Set());represented.get(a.side).add(id);}});
      const padState=(h,jaw)=>{if(!c.padStates.has(h.body))c.padStates.set(h.body,new Map());const all=c.padStates.get(h.body);if(!all.has(jaw)){const closing=mv(h.pose.R,[0,-jaw,0]);const baseline=c.jawBaselines.get(h.side);all.set(jaw,{closing,rest:baseline?mv(h.pose.R,baseline.padCompression[jaw]):mul(closing,(W.hands[h.side].fabricForce||0)/(PAD_NORMAL_STIFFNESS/2)),force:[0,0,0],innerPressure:0});}return all.get(jaw);};
      const solidContact=(n,i,normal,depth,body,mu=.5,side=null,compliance=0,rubberState=null,extraVelocity=[0,0,0],sample=null)=>{
        const ids=sample?.ids||[i],bary=sample?.w||[1],point=ids.reduce((p,id,k)=>add(p,mul(ns[id].p,bary[k])),[0,0,0]);
        const r0=body?sub(point,body.t):[0,0,0],virtual=c.bodyOffsets?.get(body),pending=robotContacts.get(body);let displacement=[0,0,0];
        if(virtual)displacement=add(virtual.translation,cross(virtual.rotation,r0));
        if(pending&&!body.fixed){const im=body.invM??(body.m?1/body.m:0),spin=body.iW?mul(mv(body.iW,pending.torque),dt*dt):[0,0,0];displacement=add(displacement,add(mul(pending.force,im*dt*dt),cross(spin,r0)));}
        if(rubberState)displacement=add(displacement,sub(rubberState.rest,mul(rubberState.force,1/(PAD_NORMAL_STIFFNESS/2))));
        depth+=dot(normal,displacement);if(depth<=0)return;
        const direction=ids.map(id=>supportedDirection(id,normal)),clothMobility=ids.reduce((v,id,k)=>v+weights[id]*bary[k]**2*dot(normal,direction[k])*dt*dt,0),r=body?sub(point,body.t):[0,0,0],moment=cross(r,normal),inverseMass=body&&!body.fixed?(body.invM??(body.m?1/body.m:0)):0,inertia=body&&!body.fixed?body.iW:null,bodyMobility=dt*dt*(inverseMass+(inertia?dot(moment,mv(inertia,moment)):0)),denom=clothMobility+bodyMobility+compliance;
        if(denom<1e-15)return;
        const force=depth/denom,corrections=ids.map((id,k)=>mul(direction[k],force*weights[id]*bary[k]*dt*dt)),correction=corrections.reduce((v,p,k)=>add(v,mul(p,bary[k])),[0,0,0]),velocity=add(body?add(body.v||[0,0,0],cross(body.w||[0,0,0],r)):[0,0,0],extraVelocity),before=ids.reduce((p,id,k)=>add(p,mul(old[id],bary[k])),[0,0,0]),relative=sub(sub(add(point,correction),before),mul(velocity,dt)),tangent=sub(relative,mul(normal,dot(relative,normal))),T=len(tangent);let frictionForce=[0,0,0];
        if(T>1e-12){const axis=mul(tangent,-1/T),directions=ids.map(id=>supportedDirection(id,axis)),moment=cross(r,axis),mobility=dt*dt*(ids.reduce((v,id,k)=>v+weights[id]*bary[k]**2*dot(axis,directions[k]),0)+inverseMass+(inertia?dot(moment,mv(inertia,moment)):0)),friction=mobility>0?Math.min(T/mobility,Math.sqrt(c.friction*mu)*force):0;frictionForce=mul(axis,friction);for(let k=0;k<ids.length;k++){corrections[k]=add(corrections[k],mul(directions[k],friction*weights[ids[k]]*bary[k]*dt*dt));supportLoad(ids[k],frictionForce,weights[ids[k]]*bary[k]*dt*dt);}}
        // The position correction already accounts for this moving surface.
        // A later world-normal velocity clamp would steal its carried momentum.
        ids.forEach((id,k)=>{ns[id].p=add(ns[id].p,corrections[k]);hits.add(id);supportLoad(id,normal,force*weights[id]*bary[k]*dt*dt);});
        if(rubberState)rubberState.force=add(rubberState.force,mul(normal,force));
        if(body&&!body.fixed){const at=ids.reduce((p,id,k)=>add(p,mul(ns[id].p,bary[k])),[0,0,0]),previous=robotContacts.get(body)||{force:[0,0,0],torque:[0,0,0],at,side},reaction=mul(add(mul(normal,force),frictionForce),-1);previous.force=add(previous.force,reaction);previous.torque=add(previous.torque,cross(sub(at,body.t),reaction));robotContacts.set(body,previous);}
      };
      const collideTable=(n,i)=>{
        if(commonTableOwned&&owns(i))return;
        if (W.tableBox) {
          const B=W.tableBox,dx=n.p[0]-B.t[0],dy=n.p[1]-B.t[1],dz=n.p[2]-B.t[2],lx=B.R[0]*dx+B.R[3]*dy+B.R[6]*dz,ly=B.R[1]*dx+B.R[4]*dy+B.R[7]*dz,lz=B.R[2]*dx+B.R[5]*dy+B.R[8]*dz,oldZ=B.R[2]*(old[i][0]-B.t[0])+B.R[5]*(old[i][1]-B.t[1])+B.R[8]*(old[i][2]-B.t[2]);
          // Fabric pressed into the slab from above leaves through the top, never the nearest face: a grip
          // lowering a corner onto the table must not pop it out underneath.
          if(Math.abs(lx)<B.h[0]&&Math.abs(ly)<B.h[1]&&oldZ>=-B.h[2]){
            if(lz<B.h[2]+radius){const depth=B.h[2]+radius-lz,normal=[B.R[2],B.R[5],B.R[8]];n.p[0]+=normal[0]*depth;n.p[1]+=normal[1]*depth;n.p[2]+=normal[2]*depth;normalAt(i,normal);tablePush.set(i,(tablePush.get(i)||0)+depth);if(weights[i])tableReaction(n.p,mul(normal,depth/(weights[i]*dt*dt)));}
          }else{
            const k = P.sphereBox(n.p, radius, B, B.h);
            if (k.dist < 0) {n.p = add(n.p, mul(k.n, -k.dist)); normalAt(i,k.n);if (mt(table.R, k.n)[2] > 0.9){tablePush.set(i, (tablePush.get(i) || 0) - k.dist);if(weights[i])tableReaction(n.p,mul(k.n,-k.dist/(weights[i]*dt*dt)));}}
          }
        }
      };
      const collide = (n, i) => {
        collideTable(n,i);
        if (n.p[2] < W.floorZ + radius) { n.p[2] = W.floorZ + radius; normalAt(i,[0,0,1]); }
        for (const b of W.bodies) {
          if (len(sub(n.p, b.t)) > b.bound + radius) continue;
          const p = sub(mt(b.R, sub(n.p, b.t)), b.off);
          const d = b.sdf ? P.bodyDistance(b, p) - radius : len(p) - P.BALL.r - radius;
          if (d < 0) {
            const normal = mv(b.R, b.sdf ? P.bodyNormal(b, p) : mul(p, 1 / (len(p) || 1)));
            if(shirt)solidContact(n,i,normal,-d,b,b.mu??.5);else{n.p = add(n.p, mul(normal, -d)); normalAt(i,normal);}
          }
        }
        if(shirt){
          for(const h of handGroups){
            if(len(sub(n.p,h.body.t))>(h.body.bound||.2)+radius)continue;
            for(const s of h.spheres){const dx=n.p[0]-s.c[0],dy=n.p[1]-s.c[1],dz=n.p[2]-s.c[2],d2=dx*dx+dy*dy+dz*dz,reach=s.r+radius;if(d2<reach*reach&&d2>1e-20){const L=Math.sqrt(d2);solidContact(n,i,[dx/L,dy/L,dz/L],reach-L,h.body,s.mu,h.side);}}
          }
          for(const L of armGroups){const reach=L.r+radius;if(n.p.some((v,k)=>v<Math.min(L.a[k],L.b[k])-reach||v>Math.max(L.a[k],L.b[k])+reach))continue;const contact=P.sphereCapsule(n.p,radius,L.a,L.b,L.r);if(contact.dist<0)solidContact(n,i,contact.n,-contact.dist,null,.5);}
          collideTable(n,i);
        }
      };
      const handFaces=c.surfaceFaces||(c.surfaceFaces=Array.from({length:triangles.length/3},(_,i)=>triangles.slice(3*i,3*i+3))),handBoxes=G?handGroups.flatMap(h=>[G.finger,G.pad].flatMap(shape=>[-1,1].map(jaw=>{
        const local=c.handGeometry.get(h.side).shape(shape,jaw),box={t:add(h.pose.t,mv(h.pose.R,local.c)),R:h.pose.R,h:local.h},extent=[0,1,2].map(k=>local.h.reduce((s,v,j)=>s+Math.abs(h.pose.R[3*k+j])*v,0));const baseline=c.jawBaselines.get(h.side),reachable=baseline?[baseline.carrierGap,baseline.driveGap].map(gap=>{const p=shape===G.pad?G.padShape(jaw,gap,[0,0,0]):{c:[shape.c[0],jaw*(gap/2+shape.c[1]),shape.c[2]],h:shape.h};return {t:add(h.pose.t,mv(h.pose.R,p.c)),R:h.pose.R,h:p.h};}):[],bounds=[box,...reachable].map(b=>({t:b.t,h:[0,1,2].map(k=>b.h.reduce((s,v,j)=>s+Math.abs(b.R[3*k+j])*v,0))})),low=[0,1,2].map(k=>Math.min(...bounds.map(b=>b.t[k]-b.h[k]))),high=[0,1,2].map(k=>Math.max(...bounds.map(b=>b.t[k]+b.h[k])));return {h,shape,jaw,box,extent,reachable,low,high};
      }))):[];
      const needsCommonTable=()=>{
        if(!shirt)return false;
        if(attachments.some(a=>W.hands[a.side]&&(W.hands[a.side].fabricForce>0||c.jawBaselines.has(a.side))))return true;
        const B=W.tableBox,R=B?.R,normal=R?[R[2],R[5],R[8]]:[0,0,0];
        // Snapshot each current/old/table-projected vertex once. This is the
        // same conservative face AABB as the nine-point test, shared by every
        // box instead of allocating/projecting the same points for each one.
        let nodes=c.ownershipNodeBounds,faces=c.ownershipFaceBounds,projectedPoints=c.ownershipProjected;
        if(nodes?.length!==6*ns.length)nodes=c.ownershipNodeBounds=new Float64Array(6*ns.length);
        if(faces?.length!==6*handFaces.length)faces=c.ownershipFaceBounds=new Float64Array(6*handFaces.length);
        if(projectedPoints?.length!==3*ns.length)projectedPoints=c.ownershipProjected=new Float64Array(3*ns.length);
        for(let i=0;i<ns.length;i++){
          const p=ns[i].p;let depth=0;if(B){const dx=p[0]-B.t[0],dy=p[1]-B.t[1],dz=p[2]-B.t[2],x=R[0]*dx+R[3]*dy+R[6]*dz,y=R[1]*dx+R[4]*dy+R[7]*dz,z=R[2]*dx+R[5]*dy+R[8]*dz;depth=Math.abs(x)<B.h[0]&&Math.abs(y)<B.h[1]&&z<B.h[2]+radius?B.h[2]+radius-z:0;}
          for(let k=0;k<3;k++){const projected=p[k]+normal[k]*depth;projectedPoints[3*i+k]=projected;nodes[6*i+k]=Math.min(p[k],old[i][k],projected);nodes[6*i+3+k]=Math.max(p[k],old[i][k],projected);}
        }
        for(let i=0;i<handFaces.length;i++){const [a,b,d]=handFaces[i];for(let k=0;k<3;k++){faces[6*i+k]=Math.min(nodes[6*a+k],nodes[6*b+k],nodes[6*d+k]);faces[6*i+3+k]=Math.max(nodes[6*a+3+k],nodes[6*b+3+k],nodes[6*d+3+k]);}}
        for(const box of handBoxes)for(let i=0;i<handFaces.length;i++)if(faces[6*i]<=box.high[0]+radius&&faces[6*i+3]>=box.low[0]-radius&&faces[6*i+1]<=box.high[1]+radius&&faces[6*i+4]>=box.low[1]-radius&&faces[6*i+2]<=box.high[2]+radius&&faces[6*i+5]>=box.low[2]-radius){
          const ids=handFaces[i],touches=points=>Contact.triangleBoxCandidates(points,box.box,box.reachable,radius,{ids}).length>0;
          if(touches(ids.map(id=>ns[id].p))||touches(ids.map(id=>old[id]))||B&&touches(ids.map(id=>[projectedPoints[3*id],projectedPoints[3*id+1],projectedPoints[3*id+2]])))return true;
        }
        return false;
      };
      const ownCommon=()=>{
        if(commonNodes||!handBoxes.length)return;const reach=c.commonReach??.04;commonNodes=new Set();
        for(let i=0;i<ns.length;i++){const p=ns[i].p;for(const box of handBoxes)if(p[0]>=box.low[0]-reach&&p[0]<=box.high[0]+reach&&p[1]>=box.low[1]-reach&&p[1]<=box.high[1]+reach&&p[2]>=box.low[2]-reach&&p[2]<=box.high[2]+reach){commonNodes.add(i);break;}}
        for(const a of attachments)for(const id of a.ids||[])commonNodes.add(id);
      };
      const collideHandSurfaces=()=>{
        const jointPins=attachments.filter(a=>{const h=W.hands[a.side];if(!(h.fabricForce>0)&&!c.jawBaselines.has(a.side))return false;if(!G)return true;const pose=W.handPose(a.side),p=mt(pose.R,sub(a.ids.reduce((v,id,k)=>add(v,mul(ns[id].p,a.w[k])),[0,0,0]),pose.t)),region=c.handGeometry.get(a.side).region;return p.every((v,k)=>Math.abs(v-region.c[k])<=region.h[k]+radius);});
        if(!handBoxes.length&&!jointPins.length&&!commonTableOwned){c.acceptedContact=null;return;}
        const free=ns.map(n=>n.p.slice()),samples=[],sampleMap=new Map(),contacts=[],surfaceTangents=[];
        if(commonTableOwned){
          // Broad-phase/manifold membership may be cached, but contact force
          // moment arms must use this material iterate's closest geometry.
          // A stale barypoint leaves an internal normal-force couple.
          for(const pair of surfacePairs)if(pair.q===c){const near=faceContact(free[pair.i],...pair.ids.map(id=>free[id]),0,{closest:true,ids:pair.ids,featureTolerance:radius*.0001});if(!near)continue;const before=dot(sub(old[pair.i],pair.ids.reduce((p,id,k)=>add(p,mul(old[id],near.w[k])),[0,0,0])),near.n);pair.contact=near;pair.side=before<0?-1:1;}
          uniqueSurfaceRows();
          for(const pair of edgePairs){const [a,b,c,d]=pair.ids.map(id=>free[id]),q=Contact.closestSegments(a,b,c,d),w=[1-q.s,q.s,-(1-q.t),-q.t],delta=sub(q.point,q.other),distance=len(delta);let normal=distance>1e-15?mul(delta,1/distance):pair.n.slice();const before=pair.ids.reduce((s,id,k)=>s+w[k]*dot(old[id],normal),0);if(before<0||before===0&&dot(normal,pair.n)<0)normal=mul(normal,-1);pair.w=w;pair.n=normal;}
        }
        const sample=(ids,w,parent=null)=>{const key=ids.map((id,k)=>[id,w[k]]).filter(q=>q[1]>1e-9).sort((a,b)=>a[0]-b[0]).map(q=>q[0]+':'+Math.round(q[1]*1e9)).join('|');if(sampleMap.has(key))return sampleMap.get(key);const i=samples.length;sampleMap.set(key,i);const materialPoint=ids.reduce((p,id,k)=>add(p,mul(material[id],w[k])),[0,0,0]),panel=Math.floor(ids[0]/panelSize);samples.push({ids,w,materialPoint,panel,ancestry:[...(parent?.ancestry||[]),{panel,point:materialPoint}],point:ids.reduce((p,id,k)=>add(p,mul(ns[id].p,w[k])),[0,0,0])});return i;};
        const displacement=(body,point)=>{let d=[0,0,0];const r=sub(point,body.t),virtual=c.bodyOffsets?.get(body),pending=robotContacts.get(body);if(virtual)d=add(virtual.translation,cross(virtual.rotation,r));if(pending&&!body.fixed){const im=body.invM??(body.m?1/body.m:0),rotation=body.iW?mul(mv(body.iW,pending.torque),dt*dt):[0,0,0];d=add(d,add(mul(pending.force,im*dt*dt),cross(rotation,r)));}return d;};
        const pinSamples=jointPins.map(a=>sample(a.ids,a.w));
        for(const i of pinSamples){const p=samples[i].point;
          for(const body of W.bodies){if(len(sub(p,body.t))>(body.bound||.2)+.025)continue;const local=sub(mt(body.R,sub(p,body.t)),body.off||[0,0,0]),distance=body.sdf?P.bodyDistance(body,local)-radius:len(local)-P.BALL.r-radius,normal=mv(body.R,body.sdf?P.bodyNormal(body,local):mul(local,1/(len(local)||1)));if(distance<.025)contacts.push({row:[[i,1]],normal,point:p,body,base:distance,compliance:1e-12});}
          for(const h of handGroups)for(const sphere of h.spheres){const delta=sub(p,sphere.c),distance=len(delta);if(distance>1e-10&&distance-sphere.r-radius<.025)contacts.push({row:[[i,1]],normal:mul(delta,1/distance),point:p,body:h.body,base:distance-sphere.r-radius,compliance:1e-12,side:h.side});}
        }
        // One exact AABB snapshot serves every rigid box. Node positions stay
        // fixed throughout manifold construction; retain original face ordering.
        let faceBounds=c.handFaceBounds;if(handBoxes.length){if(faceBounds?.length!==6*handFaces.length)faceBounds=c.handFaceBounds=new Float64Array(6*handFaces.length);for(let i=0;i<handFaces.length;i++){const ids=handFaces[i],a=ns[ids[0]].p,b=ns[ids[1]].p,d=ns[ids[2]].p,at=6*i;for(let k=0;k<3;k++){faceBounds[at+k]=Math.min(a[k],b[k],d[k]);faceBounds[at+3+k]=Math.max(a[k],b[k],d[k]);}}}
        for(const {h,shape,jaw,box,reachable,low,high}of handBoxes){
          const seen=new Set(),state=shape===G.pad?padState(h,jaw):null;
          for(let face=0;face<handFaces.length;face++){
            const at=6*face;if(faceBounds[at]>high[0]+radius+1e-12||faceBounds[at+3]<low[0]-radius-1e-12||faceBounds[at+1]>high[1]+radius+1e-12||faceBounds[at+4]<low[1]-radius-1e-12||faceBounds[at+2]>high[2]+radius+1e-12||faceBounds[at+5]<low[2]-radius-1e-12)continue;
            const ids=handFaces[face];
            for(const contact of Contact.triangleBoxCandidates(ids.map(id=>ns[id].p),box,reachable,radius,{ids,seen})){
              const i=sample(ids,contact.w),point=samples[i].point,rubber=state?sub(state.rest,mul(state.force,1/(PAD_NORMAL_STIFFNESS/2))):[0,0,0];
              const row={i,row:[[i,1]],normal:contact.normal,point,body:h.body,base:-contact.depth-dot(contact.normal,add(displacement(h.body,point),rubber)),compliance:1e-12,h,shape,jaw,state};contacts.push(row);surfaceTangents.push(row);
            }
          }
        }
        if(!surfaceTangents.length&&!jointPins.length&&!commonTableOwned){c.acceptedContact=null;return;}
        // A different contact projection can introduce a pad contact after the
        // initial ownership test. Restart this material pass before solving it,
        // so no preliminary table/layer preload survives into the common law.
        if(!commonTableOwned&&(surfaceTangents.length||jointPins.length)){commonTableOwned=true;ownCommon();commonOwnershipRetry=true;return;}
        // Include the actual supporting sheets and table in the same normal
        // system. Projecting a free upper particle and putting it back afterward
        // loses the pressure of a trapped cloth/rubber/table sandwich.
        const layerKeys=new Set(),materialNeighbourhood=c.contactMaterialNeighbourhood||(c.contactMaterialNeighbourhood=Math.max(...edges.filter(e=>e.kind==='mesh').map(e=>len(sub(material[e.a],material[e.b])))));
        // Unified ownership already includes the global vertex/face and
        // edge/edge layer manifold below. Recursive local support ancestry
        // would represent those affine surfaces again at every hand sample.
        if(!commonTableOwned)for(let i=0;i<samples.length;i++){
          const a=samples[i],candidateFaces=new Set();for(const id of a.ids)for(const face of c.surfaceBroadphase?.candidates[id]||[])candidateFaces.add(face);
          const near=[];for(const face of candidateFaces){const ids=handFaces[face];if(ids.some(id=>a.ids.some(j=>Math.floor(id/panelSize)===Math.floor(j/panelSize)&&neighbours[j].has(id))))continue;const q=faceContact(a.point,...ids.map(id=>ns[id].p));if(!q||Math.abs(q.d)>.004)continue;near.push({ids,q,score:Math.abs(q.d)});}near.sort((a,b)=>a.score-b.score);
          for(const {ids,q}of near.slice(0,4)){
            const materialPoint=ids.reduce((p,id,k)=>add(p,mul(material[id],q.w[k])),[0,0,0]),panel=Math.floor(ids[0]/panelSize);if(a.ancestry.some(previous=>previous.panel===panel&&Math.hypot(previous.point[0]-materialPoint[0],previous.point[1]-materialPoint[1])<materialNeighbourhood))continue;
            const j=sample(ids,q.w,a);if(i===j)continue;const key=i<j?i+':'+j:j+':'+i;if(layerKeys.has(key))continue;layerKeys.add(key);
            const oldA=a.ids.reduce((p,id,k)=>add(p,mul(old[id],a.w[k])),[0,0,0]),b=samples[j],oldB=b.ids.reduce((p,id,k)=>add(p,mul(old[id],b.w[k])),[0,0,0]),sign=dot(sub(oldA,oldB),q.n)<0?-1:1,normal=mul(q.n,sign);
            contacts.push({row:[[i,1],[j,-1]],normal,point:a.point,base:sign*q.d-2*radius,compliance:1e-12});
          }
        }
        if(commonTableOwned){
          // Supporting layers are part of the same total-pressure problem.
          // Their preliminary projections are bypassed below, not retained as
          // hidden preload beneath the new surface constraints.
          for(const pair of surfacePairs)if(pair.q===c&&(owns(pair.i)||pair.ids.some(owns))){
            const i=sample([pair.i],[1]),j=sample(pair.ids,pair.contact.w),key=i<j?i+':'+j:j+':'+i;if(layerKeys.has(key))continue;layerKeys.add(key);
            const normal=mul(pair.contact.n,pair.side);contacts.push({row:[[i,1],[j,-1]],normal,point:samples[i].point,base:dot(sub(samples[i].point,samples[j].point),normal)-2*radius,compliance:1e-12});
          }
          for(const pair of edgePairs){if(!pair.ids.some(owns))continue;const row=pair.ids.map((id,k)=>[sample([id],[1]),pair.w[k]]),point=pair.ids.reduce((p,id,k)=>add(p,mul(ns[id].p,pair.w[k])),[0,0,0]);contacts.push({row,normal:pair.n,point:ns[pair.ids[0]].p,base:dot(point,pair.n)-2*radius,compliance:1e-12});}
          // For a flat table and affine cloth triangles, nodal plane support
          // also supports their interiors. Use one total force per node instead
          // of overlapping nodal and barycentric copies of the same support.
          const B=W.tableBox;
          for(let id=0;B&&id<ns.length;id++){if(!owns(id))continue;
            const i=sample([id],[1]),point=samples[i].point,local=mt(B.R,sub(point,B.t)),oldLocal=mt(B.R,sub(old[id],B.t)),top=Math.abs(local[0])<B.h[0]&&Math.abs(local[1])<B.h[1]&&oldLocal[2]>=-B.h[2],q=top?{dist:local[2]-B.h[2]-radius,n:[B.R[2],B.R[5],B.R[8]]}:P.sphereBox(point,radius,B,B.h);
            contacts.push({i,row:[[i,1]],normal:q.n,point,base:q.dist,compliance:1e-12,table:true});
          }
        }else for(let i=0;i<samples.length;i++){const a=samples[i];if(W.tableBox){const q=P.sphereBox(a.point,radius,W.tableBox,W.tableBox.h);if(q.dist<.01)contacts.push({row:[[i,1]],normal:q.n,point:a.point,base:q.dist,compliance:1e-12,table:true});}}
        // The supporting table belongs to the same Coulomb problem as the toe.
        // Its pressure is solved below; a prior nodal projection cannot supply
        // friction for a load that only appears in this common solve.
        const facet=(ids,w,normal)=>{
          const candidates=ids.length===3?[ids]:handFaces.filter(face=>ids.every(id=>face.includes(id)));let chosen=null,score=-Infinity;
          for(const face of candidates){const e=sub(free[face[1]],free[face[0]]),n=cross(e,sub(free[face[2]],free[face[0]])),length=len(n);if(!(length>0))continue;const value=Math.abs(dot(n,normal))/length;if(value>score){score=value;chosen={ids:face,w:face.map(id=>ids.reduce((s,value,k)=>s+(value===id?w[k]:0),0)),normal:mul(n,1/length),edge:mul(e,1/len(e))};}}
          if(!chosen)throw Error('Degenerate relative cloth contact facet.');return chosen;
        };
        if(commonTableOwned)for(const contact of contacts)if(!contact.body&&!contact.table&&Math.abs(contact.row.reduce((s,[,w])=>s+w,0))<1e-8){
          const side=sign=>{const weights=new Map();for(const [i,coefficient]of contact.row)if(coefficient*sign>0)for(let k=0;k<samples[i].ids.length;k++){const id=samples[i].ids[k];weights.set(id,(weights.get(id)||0)+sign*coefficient*samples[i].w[k]);}const entries=[...weights].filter(([,w])=>Math.abs(w)>1e-14);return facet(entries.map(([id])=>id),entries.map(([,w])=>w),contact.normal);};
          const a=side(1),b=side(-1),at=s=>s.ids.reduce((p,id,k)=>add(p,mul(free[id],s.w[k])),[0,0,0]),point=mul(add(at(a),at(b)),.5),y=cross(a.normal,a.edge),R=[a.edge[0],y[0],a.normal[0],a.edge[1],y[1],a.normal[1],a.edge[2],y[2],a.normal[2]];
          contact.relative={a,b,point};contact.point=point;contact.frame={kind:'material',pose:{R,t:point},side:null};surfaceTangents.push(contact);
        }
        const tableFrame={body:{fixed:true,t:table.t,R:table.R,v:[0,0,0],w:[0,0,0]},pose:{R:table.R,t:table.t},side:null};
        for(const contact of surfaceTangents)if(contact.h)contact.frame=contact.h;
        for(const contact of contacts)if(contact.table){contact.i=contact.row[0][0];contact.frame=tableFrame;surfaceTangents.push(contact);}
        const frictionCoefficient=contact=>contact.relative?c.selfFriction:contact.table?c.friction:Math.sqrt(c.friction*(contact.state?P.GRIP.mu:.5));
        jawContacts(c,contacts,W);const rows=contacts.map(contact=>{const merged=new Map();for(const [i,sign]of contact.row)for(let k=0;k<samples[i].ids.length;k++){const id=samples[i].ids[k];merged.set(id,(merged.get(id)||0)+sign*samples[i].w[k]);}return [...merged].filter(([,w])=>Math.abs(w)>1e-14);}),bodies=new Map(),rubber=new Map();
        const addBody=body=>{if(!body||bodies.has(body))return;const response=frozenBody(body);bodies.set(body,{im:response.im,inertia:response.inertia,force:[0,0,0],torque:[0,0,0]});};
        for(const contact of contacts){addBody(contact.body);if(contact.state&&!rubber.has(contact.state))rubber.set(contact.state,[0,0,0]);}for(const a of jointPins)addBody(W.hands[a.side].body);for(const contact of surfaceTangents)addBody(contact.frame.body);
        const jacobians=contacts.map(contact=>{const direction=mul(contact.normal,-contact.row.reduce((s,[,v])=>s+v,0));return {direction,torque:contact.body?cross(sub(contact.point,contact.body.t),direction):[0,0,0]};}),nodeForces=new Float64Array(ns.length*3),nodeResponse=new Float64Array(ns.length*3);
        const jawResponse=new Map();const apply=(lambda,out=new Float64Array(contacts.length))=>{
          jawResponse.clear();nodeForces.fill(0);for(const mode of bodies.values()){mode.force=[0,0,0];mode.torque=[0,0,0];}for(const state of rubber.keys())rubber.set(state,[0,0,0]);
          for(let i=0;i<contacts.length;i++){const contact=contacts[i],force=lambda[i];if(!force)continue;for(const [id,w]of rows[i])for(let k=0;k<3;k++)nodeForces[3*id+k]+=w*contact.normal[k]*force;if(contact.body){const mode=bodies.get(contact.body);mode.force=add(mode.force,mul(jacobians[i].direction,force));mode.torque=add(mode.torque,mul(jacobians[i].torque,force));}if(contact.state)rubber.set(contact.state,add(rubber.get(contact.state),mul(contact.normal,force)));if(contact.jawMode)jawResponse.set(contact.jawMode,(jawResponse.get(contact.jawMode)||0)+contact.jawJ*force);}
          c.materialForceResponse(nodeForces,nodeResponse);
          for(let i=0;i<contacts.length;i++){const contact=contacts[i];let value=contact.compliance*lambda[i];for(const [id,w]of rows[i])for(let k=0;k<3;k++)value+=w*contact.normal[k]*nodeResponse[3*id+k];if(contact.body){const mode=bodies.get(contact.body);value+=dt*dt*(mode.im*dot(jacobians[i].direction,mode.force)+dot(jacobians[i].torque,mv(mode.inertia,mode.torque)));}if(contact.state)value+=dot(contact.normal,rubber.get(contact.state))/(PAD_NORMAL_STIFFNESS/2);if(contact.jawMode)value+=contact.jawJ*jawCompliance(contact.jawMode)*(jawResponse.get(contact.jawMode)||0);out[i]=value;}return out;
        };
        let diagonal;const makeDiagonal=()=>contacts.map((contact,i)=>{let value=contact.compliance;for(const [a,wa]of rows[i])for(const [b,wb]of rows[i])value+=wa*wb*c.materialEntry(a,b);if(contact.body){const mode=bodies.get(contact.body);value+=dt*dt*(mode.im*dot(jacobians[i].direction,jacobians[i].direction)+dot(jacobians[i].torque,mv(mode.inertia,jacobians[i].torque)));}if(contact.state)value+=1/(PAD_NORMAL_STIFFNESS/2);if(contact.jawMode)value+=contact.jawJ**2*jawCompliance(contact.jawMode);return value;});
        const column=(j,out=new Float64Array(contacts.length))=>{const source=contacts[j];for(let i=0;i<contacts.length;i++){const contact=contacts[i];if(i===j){out[i]=diagonal[i];continue;}let scalar=0;for(const [a,wa]of rows[i])for(const [b,wb]of rows[j])scalar+=wa*wb*c.materialEntry(a,b);let value=dot(contact.normal,source.normal)*scalar;if(contact.body&&contact.body===source.body){const mode=bodies.get(contact.body);value+=dt*dt*(mode.im*dot(jacobians[i].direction,jacobians[j].direction)+dot(jacobians[i].torque,mv(mode.inertia,jacobians[j].torque)));}if(contact.state&&contact.state===source.state)value+=dot(contact.normal,source.normal)/(PAD_NORMAL_STIFFNESS/2);if(contact.jawMode&&contact.jawMode===source.jawMode)value+=contact.jawJ*source.jawJ*jawCompliance(contact.jawMode);out[i]=value;}return out;};
        const pinData=jointPins.map((a,i)=>{const R=W.handPose(a.side).R;return {ids:a.ids,w:a.w,point:samples[pinSamples[i]].point,body:W.hands[a.side].body,axes:[[R[0],R[3],R[6]],[R[2],R[5],R[8]]],stiffness:PAD_STIFFNESS/pins.get(a.side).points.length,cap:0,nominal:0};}),counts=new Map();jointPins.forEach(a=>counts.set(a.side,(counts.get(a.side)||0)+1));
        pinData.forEach((pin,i)=>{const a=jointPins[i],held=pins.get(a.side);pin.nominal=2*P.GRIP.mu*(c.jawBaselines.get(a.side)?.maxForce??W.hands[a.side].fabricForce)/counts.get(a.side);pin.cap=held.loaded===false&&!held.acquired?0:pin.nominal;});
        const normalRows=contacts.map((contact,i)=>({ids:rows[i].map(q=>q[0]),w:rows[i].map(q=>q[1]),normal:contact.normal,body:contact.body,point:contact.point})),{H,C}=Coupling.assemble({pins:pinData,normalRows,entry:c.materialEntry,bodyMobility:body=>({invM:bodies.get(body).im,inverseInertia:bodies.get(body).inertia}),dt});
        const groups=G?[...counts.keys()].map(side=>({pins:jointPins.flatMap((a,i)=>a.side===side?[i]:[]),normal:c.jawBaselines.get(side)?.maxForce??W.hands[side].fabricForce,sides:[-1,1].map(jaw=>contacts.flatMap((contact,i)=>{const alignment=contact.state&&contact.h.side===side&&contact.jaw===jaw?dot(contact.normal,contact.state.closing):0;return alignment>.5?[[i,alignment]]:[];}))})):undefined;
        const background=new Map([...robotContacts].map(([body,value])=>[body,{...value,force:value.force.slice(),torque:value.torque.slice()}])),geometryBase=contacts.map(contact=>contact.jawBase),toe=surfaceTangents.map(()=>[0,0,0]),toeEta=new Map([...c.jawModes].map(([side])=>[side,0])),toeNodal=new Float64Array(ns.length*3),toeDelta=new Float64Array(ns.length*3),allNodal=new Float64Array(ns.length*3),allDelta=new Float64Array(ns.length*3);
        const addForce=(field,body,point,force,side=null)=>{if(!body||body.fixed)return;const value=field.get(body)||{force:[0,0,0],torque:[0,0,0],at:point,side};value.force=add(value.force,force);value.torque=add(value.torque,cross(sub(point,body.t),force));field.set(body,value);};
        const fieldOffset=(field,body,point)=>{const force=field.get(body),mobility=bodies.get(body);return force?add(mul(force.force,mobility.im*dt*dt),cross(mul(mv(mobility.inertia,force.torque),dt*dt),sub(point,body.t))):[0,0,0];};
        for(const body of background.keys())addBody(body);
        const pinBase=jointPins.map((a,i)=>sub(add(a.target,fieldOffset(background,pinData[i].body,pinData[i].point)),pinData[i].point));
        // Freeze force/velocity moment arms for this inner linear contact solve.
        // The outer material iteration rebuilds geometry after its deformation.
        const frictionData=surfaceTangents.map(contact=>{
          const h=contact.frame,normal=contact.normal,axis0=Math.abs(normal[0])<.8?[1,0,0]:[0,1,0],u0=sub(axis0,mul(normal,dot(axis0,normal))),u=mul(u0,1/len(u0)),axes=[u,cross(normal,u)];
          if(contact.relative){
            const row=rows[contacts.indexOf(contact)],a={ids:row.map(q=>q[0]),w:row.map(q=>q[1])},materialJacobians=axes.map(axis=>{
              const merged=new Map();for(const [side,sign]of [[contact.relative.a,1],[contact.relative.b,-1]]){const gradients=Coupling.contactGradients({points:side.ids.map(id=>free[id]),weights:side.w,point:contact.point,axis:mul(axis,sign)});side.ids.forEach((id,k)=>merged.set(id,add(merged.get(id)||[0,0,0],gradients[k])));}return [...merged].map(([id,gradient])=>({id,gradient}));
            }),pin={...a,relative:true,axes,materialJacobians,point:contact.point,stiffness:Infinity},M=Coupling.assemble({pins:[pin],normalRows:[],entry:c.materialEntry,bodyMobility:()=>{throw Error('Relative contact has no rigid body.');},dt}).H.map(row=>Array.from(row));
            return {a,h,r:[0,0,0],normal,axes,materialJacobians,M,jawAxis:[0,0,0],j:[0,0],movement:[0,0,0],motionTerms:{rigid:[0,0,0],carrier:[0,0,0],skin:[0,0,0],rest:[0,0,0]}};
          }
          const a=samples[contact.i],r=sub(contact.point,h.body.t),before=a.ids.reduce((p,id,k)=>add(p,mul(old[id],a.w[k])),[0,0,0]),response=a.response||(a.response={S:[[c.materialMobility(a)]],order:c.materialOrder}),jawAxis=mv(h.pose.R,[0,-(contact.jaw||0)/2,0]),j=axes.map(axis=>dot(jawAxis,axis)),body=bodies.get(h.body);
          const rigidMotion=mul(add(h.body.v||[0,0,0],cross(h.body.w||[0,0,0],r)),dt);let carrierMotion=[0,0,0],skinMotion=[0,0,0],movement=rigidMotion.slice();
          if(contact.jawMode){const baseline=contact.jawMode.base,current=c.handGeometry.get(h.side).shape(contact.shape,contact.jaw),previous=contact.state?G.padShape(contact.jaw,baseline.startCarrierGap,baseline.startPadCompression[contact.jaw]):{c:[contact.shape.c[0],contact.jaw*(baseline.startCarrierGap/2+contact.shape.c[1]),contact.shape.c[2]],h:contact.shape.h},local=mt(h.pose.R,sub(contact.point,h.pose.t)),motion=local.map((v,k)=>{const q=Math.max(-1,Math.min(1,(v-current.c[k])/current.h[k]));return current.c[k]+current.h[k]*q-previous.c[k]-previous.h[k]*q;});carrierMotion=mv(h.pose.R,[0,contact.jaw*(baseline.carrierGap-baseline.startCarrierGap)/2,0]);skinMotion=sub(mv(h.pose.R,motion),carrierMotion);movement=add(movement,add(carrierMotion,skinMotion));
          }else{carrierMotion=mv(h.pose.R,[0,(contact.jaw||0)*(h.jawRate||0)*dt/2,0]);movement=add(movement,carrierMotion);}
          // This reduced law keeps rubber recovery in the normal mode only.
          // Exact current/start skin motion above is the tangential boundary
          // motion; adding absolute compression again would creep at rest.
          const M=axes.map((x,i)=>axes.map((y,k)=>(i===k?response.S[0][0]:0)+dt*dt*(body.im*dot(x,y)+dot(cross(r,x),mv(body.inertia,cross(r,y))))));
          return {a,h,r,normal,axes,before,response,jawAxis,j,movement,M,motionTerms:{rigid:rigidMotion,carrier:carrierMotion,skin:skinMotion,rest:[0,0,0]}};
        });
        const surfaceTravel=(index,positions)=>{
          const data=frictionData[index];if(!data.materialJacobians)return data.a.ids.reduce((v,id,k)=>add(v,mul(sub(positions[id],old[id]),data.a.w[k])),[0,0,0]);
          return data.axes.reduce((v,axis,i)=>add(v,mul(axis,data.materialJacobians[i].reduce((s,g)=>s+dot(g.gradient,sub(positions[g.id],old[g.id])),0))),[0,0,0]);
        };
        const surfacePin=(index,stiffness=Infinity)=>{const data=frictionData[index],contact=surfaceTangents[index];return {...data.a,point:contact.point,body:contact.relative?null:data.h.body,axes:data.axes,stiffness,...contact.relative?{relative:true,materialJacobians:data.materialJacobians}:{}};};
        const addSurfaceTangent=(index,force,nodal,field)=>{
          const data=frictionData[index],contact=surfaceTangents[index];
          if(data.materialJacobians){data.axes.forEach((axis,k)=>{const value=dot(axis,force);for(const g of data.materialJacobians[k])for(let j=0;j<3;j++)nodal[3*g.id+j]+=g.gradient[j]*value;});return;}
          data.a.ids.forEach((id,k)=>{for(let axis=0;axis<3;axis++)nodal[3*id+axis]+=data.a.w[k]*force[axis];});addForce(field,data.h.body,contact.point,mul(force,-1),data.h.side);
        };
        const tangentState=(index,positions,field,pressure,trial=null)=>{
          const contact=surfaceTangents[index],data=frictionData[index],{a,h,normal}=data,sourceMode=contact.jawMode,mode=trial?.loads?.has(sourceMode)?{...sourceMode,load:trial.loads.get(sourceMode)}:sourceMode,point=a.ids.reduce((p,id,k)=>add(p,mul(positions[id],a.w[k])),[0,0,0]);let movement=add(data.movement,fieldOffset(field,h.body,contact.point));if(mode)movement=add(movement,mv(h.pose.R,[0,contact.jaw*jawOffset(mode)/2,0]));
          if(contact.relative){const M=data.M,L=(M[0][0]+M[1][1]+Math.hypot(M[0][0]-M[1][1],2*M[0][1]))/2;return {...data,point:contact.point,tangent:surfaceTravel(index,positions),L,cap:c.selfFriction*(trial?.lambda??contact.lambda)};}
          const relative=sub(sub(point,data.before),movement),tangent=sub(relative,mul(normal,dot(relative,normal))),M=data.M.map((row,i)=>row.map((value,k)=>value+data.j[i]*data.j[k]*jawCompliance(mode))),L=(M[0][0]+M[1][1]+Math.hypot(M[0][0]-M[1][1],2*M[0][1]))/2,Pside=pressure.get(h.side),held=jointPins.some(a=>a.side===h.side)&&Pside&&Pside[1]>0&&Pside[-1]>0,inner=contact.state&&dot(normal,contact.state.closing)>.5,cap=held&&inner?0:frictionCoefficient(contact)*(trial?.lambda??contact.lambda);
          return {...data,point,tangent,L,cap};
        };
        // Omitted tangent coordinates are exactly zero trial forces. Reconstruct
        // their final relative slip under ALL normal/selected tangent forces,
        // then add every violated Coulomb row before a candidate can escape.
        const omittedTangents=(payload,active)=>{
          const selected=new Set(active),nodal=new Float64Array(ns.length*3),field=new Map([...background].map(([body,value])=>[body,{...value,force:value.force.slice(),torque:value.torque.slice()}]));
          const applySample=(a,force)=>a.ids.forEach((id,k)=>{for(let axis=0;axis<3;axis++)nodal[3*id+axis]+=a.w[k]*force[axis];});
          contacts.forEach((contact,i)=>{const force=payload.normalForces[i];for(const [id,w]of rows[i])for(let axis=0;axis<3;axis++)nodal[3*id+axis]+=w*contact.normal[axis]*force;if(contact.body)addForce(field,contact.body,contact.point,mul(jacobians[i].direction,force),contact.h?.side??null);});
          let cursor=0;pinData.forEach(pin=>{let force=[0,0,0];for(const axis of pin.axes)force=add(force,mul(axis,payload.tangents[cursor++]));applySample(pin,force);addForce(field,pin.body,pin.point,mul(force,-1));});
          active.forEach(index=>{const data=frictionData[index],force=add(mul(data.axes[0],payload.tangents[cursor++]),mul(data.axes[1],payload.tangents[cursor++]));addSurfaceTangent(index,force,nodal,field);});
          const delta=c.materialForceResponse(nodal),positions=free.map((point,id)=>point.map((value,axis)=>value+delta[3*id+axis])),pressure=new Map(Object.keys(W.hands).map(side=>[side,{'1':0,'-1':0}])),loads=new Map();
          contacts.forEach((contact,i)=>{if(contact.state){const alignment=dot(contact.normal,contact.state.closing);if(alignment>.5)pressure.get(contact.h.side)[contact.jaw]+=alignment*payload.normalForces[i];}});
          payload.loads.forEach(value=>loads.set(c.jawModes.get(String(value.side)),value.load));
          const violations=[];surfaceTangents.forEach((contact,index)=>{if(selected.has(index))return;const state=tangentState(index,positions,field,pressure,{lambda:payload.normalForces[contacts.indexOf(contact)],loads});if(!(state.L>0)||!(state.cap>=0)||!Number.isFinite(state.cap)||!state.tangent.every(Number.isFinite))return;const check=Patch.frictionResidual([0,0,0],state.tangent,state.cap,state.L);if(check.residual>(c.contactTolerance??radius*.001)||check.feasibility>1e-9)violations.push(index);});
          return violations;
        };
        // Numerical continuation only: material coordinates identify the old
        // accepted force field; no stored guess is ever applied without a fresh
        // current-geometry physical certificate and reconstruction check.
        const describe=contact=>{
          const parts=contact.row.filter(([,sign])=>sign!==0).map(([i,sign])=>({panel:samples[i].panel,sign:Math.sign(sign),point:samples[i].materialPoint.slice(0,2)})).sort((a,b)=>a.panel-b.panel||a.point[0]-b.point[0]||a.point[1]-b.point[1]),flip=parts[0]?.sign<0?-1:1,R=contact.relative?contact.frame.pose.R:contact.h?.pose.R||contact.body?.R||table.R;
          return {kind:contact.h?(contact.state?'rubber':'carrier'):contact.body?'body':contact.table?'table':'layer',body:contact.body||(contact.table?W.tableBox:null),jaw:contact.jaw||0,shape:contact.shape||null,orientation:flip,parts:parts.map(p=>({...p,sign:p.sign*flip})),normal:mt(R,mul(contact.normal,flip))};
        };
        const descriptors=contacts.map(describe),previous=c.acceptedContact;let matched=null,warmLambda=null,warmToe=null;
        // Descriptors are frozen in material coordinates for this geometry.
        // Most normal-only states already pass and never need correspondence.
        const prepareWarm=()=>{if(matched)return;matched=previous&&Warm?Warm.match(previous.normals.map(q=>q.descriptor),descriptors,{maxDistance:Math.max(4*radius,materialNeighbourhood*.25),normalCos:.95}):contacts.map(()=>-1);matched=matched.map((old,i)=>old>=0&&contacts[i].relative&&previous.normals[old].descriptor.orientation!==descriptors[i].orientation?-1:old);warmLambda=matched.map((old,i)=>old<0?0:Math.max(0,previous.normals[old].force*dot(previous.normals[old].descriptor.normal,descriptors[i].normal)));warmToe=surfaceTangents.map(contact=>{const old=matched[contacts.indexOf(contact)],local=old>=0?previous.normals[old].tangent:null;if(!local)return [0,0,0];const force=mv(contact.frame.pose.R,local);return sub(force,mul(contact.normal,dot(force,contact.normal)));});c.warmDiagnostic={available:!!previous,matched:matched.filter(i=>i>=0).length,total:contacts.length};};
        c.warmDiagnostic={available:!!previous,matched:null,total:contacts.length};
        const stickTried=new Set(),frictionHistory=[];
        const stickCandidate=(solution,pressure,field,selection=null,source=toe,depth=0)=>{
          if([...c.jawModes.values()].some(mode=>mode.stop))return null;
          const currentPositions=ns.map(n=>n.p),states=surfaceTangents.map((contact,index)=>tangentState(index,currentPositions,field,pressure)),active=selection||states.flatMap((state,index)=>state.cap>1e-10&&len(sub(mul(toe[index],state.L),state.tangent))<=state.L*state.cap?[index]:[]),activeSet=new Set(active),fixed=source.map((force,index)=>activeSet.has(index)?[0,0,0]:force.slice()),key=active.join(',')+':'+fixed.flat().map(v=>Math.round(v*1e6)).join(',');if(!active.length||stickTried.has(key)||depth>=8)return null;stickTried.add(key);
          const fixedNodal=new Float64Array(ns.length*3),fixedField=new Map(),fixedLoad=new Map();surfaceTangents.forEach((contact,index)=>{const F=fixed[index];addSurfaceTangent(index,F,fixedNodal,fixedField);if(contact.jawMode)fixedLoad.set(contact.jawMode,(fixedLoad.get(contact.jawMode)||0)+dot(F,frictionData[index].jawAxis));});
          const fixedDelta=c.materialForceResponse(fixedNodal),fixedPositions=free.map((p,id)=>p.map((v,k)=>v+fixedDelta[3*id+k])),fixedCloth=a=>a.ids.reduce((p,id,k)=>add(p,[0,1,2].map(axis=>a.w[k]*fixedDelta[3*id+axis])),[0,0,0]);
          const trialPins=pinData.concat(active.map(index=>({...surfacePin(index),cap:Infinity}))),trialErrors=pinBase.map((error,i)=>add(error,sub(fieldOffset(fixedField,pinData[i].body,pinData[i].point),fixedCloth(pinData[i])))).concat(active.map(index=>{
            if(surfaceTangents[index].relative)return mul(surfaceTravel(index,fixedPositions),-1);
            const data=frictionData[index],contact=surfaceTangents[index],mode=contact.jawMode,point=add(data.a.ids.reduce((p,id,k)=>add(p,mul(free[id],data.a.w[k])),[0,0,0]),fixedCloth(data.a));let movement=add(data.movement,add(fieldOffset(background,data.h.body,contact.point),fieldOffset(fixedField,data.h.body,contact.point)));if(mode)movement=add(movement,mv(data.h.pose.R,[0,contact.jaw*(mode.base.restOffset+mode.base.compliance*(fixedLoad.get(mode)||0))/2,0]));return sub(movement,sub(point,data.before));
          })),trial=Coupling.assemble({pins:trialPins,normalRows,entry:c.materialEntry,bodyMobility:body=>({invM:bodies.get(body).im,inverseInertia:bodies.get(body).inertia}),dt});
          const variables=trialPins.flatMap((pin,i)=>pin.axes.map(axis=>{const index=i-jointPins.length,contact=index>=0?surfaceTangents[active[index]]:null;return {mode:contact?.jawMode,J:contact?-dot(axis,mv(contact.frame.pose.R,[0,(contact.jaw||0)/2,0])):0};}));
          for(let i=0;i<variables.length;i++)for(let j=0;j<=i;j++)if(variables[i].mode&&variables[i].mode===variables[j].mode){const value=variables[i].J*variables[j].J*jawCompliance(variables[i].mode);trial.H[i][j]+=value;if(i!==j)trial.H[j][i]+=value;}
          contacts.forEach((contact,i)=>variables.forEach((variable,j)=>{if(contact.jawMode&&contact.jawMode===variable.mode)trial.C[i][j]+=contact.jawJ*variable.J*jawCompliance(variable.mode);}));
          // A zero-compliance stick block may contain dependent material/rigid
          // constraints. Reject unresolved double-precision rank, never add a
          // diagonal spring that would change the physical stick condition.
          const rankScale=Math.max(...trial.H.map((row,i)=>row[i])),rankTolerance=Number.EPSILON*trial.H.length*rankScale,Lrank=trial.H.map(row=>new Float64Array(row.length));
          for(let i=0;i<trial.H.length;i++)for(let j=0;j<=i;j++){let value=trial.H[i][j];for(let k=0;k<j;k++)value-=Lrank[i][k]*Lrank[j][k];if(i===j){if(!(value>rankTolerance)){c.stickDiagnostic={reason:'rank',active,pivot:value,rankTolerance};const ordinary=Math.floor((i-pinData.reduce((s,p)=>s+p.axes.length,0))/2);return ordinary>=0?stickCandidate(solution,pressure,field,active.filter((_,at)=>at!==ordinary),source,depth+1):null;}Lrank[i][j]=Math.sqrt(value);}else Lrank[i][j]=value/Lrank[j][j];}
          let result;try{diagonal=makeDiagonal();result=Patch.solveCoupled({...trial,normal:{size:contacts.length,apply,column,diagonal,base:contacts.map((contact,i)=>{let shift=0;for(const [id,w]of rows[i])for(let axis=0;axis<3;axis++)shift+=w*contact.normal[axis]*fixedDelta[3*id+axis];if(contact.body)shift-=dot(contact.normal,fieldOffset(fixedField,contact.body,contact.point));return geometryBase[i]+shift+contact.jawJ*(contact.jawMode?contact.jawMode.base.restOffset+contact.jawMode.base.compliance*(fixedLoad.get(contact.jawMode)||0):0);})},pins:trialPins.map((pin,i)=>({axes:pin.axes,cap:i<jointPins.length?pin.cap:Infinity})),errors:trialErrors,pressureGroups:groups,tolerance:c.contactTolerance??radius*.001});}catch(error){if(/positive definite/.test(error.message)){c.stickDiagnostic={reason:'rank',active};return null;}throw error;}
          if(!result.converged){c.stickDiagnostic={reason:'backend',residual:result.residual,feasibility:result.feasibility,active};return null;}
          const trialPressure=new Map([...pressure].map(([side])=>[side,{'1':0,'-1':0}]));contacts.forEach((contact,i)=>{if(contact.state){const alignment=dot(contact.normal,contact.state.closing);if(alignment>.5)trialPressure.get(contact.h.side)[contact.jaw]+=alignment*result.normalForces[i];}});
          const proposed=fixed.map(force=>force.slice()),loads=new Map([...c.jawModes.values()].map(mode=>[mode,0]));contacts.forEach((contact,i)=>{if(contact.jawMode)loads.set(contact.jawMode,loads.get(contact.jawMode)+contact.jawJ*result.normalForces[i]);});
          for(let i=0;i<active.length;i++){const index=active[i],contact=surfaceTangents[index],force=result.forces[jointPins.length+i],cap=frictionCoefficient(contact)*result.normalForces[contacts.indexOf(contact)];if(len(force)>cap+1e-9){c.stickDiagnostic={reason:'cap',active,index,force,cap};const next=source.map(v=>v.slice());next[index]=mul(force,cap/len(force));return stickCandidate(solution,pressure,field,active.filter(at=>at!==index),next,depth+1);}proposed[index]=force;}
          surfaceTangents.forEach((contact,index)=>{const cap=frictionCoefficient(contact)*result.normalForces[contacts.indexOf(contact)],F=len(proposed[index]);if(F>cap)proposed[index]=mul(proposed[index],cap/F);if(contact.jawMode)loads.set(contact.jawMode,loads.get(contact.jawMode)+dot(proposed[index],frictionData[index].jawAxis));});
          for(const [mode,Q]of loads){const gap=mode.base.driveGap+mode.base.compliance*Q;if(Math.abs(Q)>mode.base.maxForce+1e-9||gap<mode.base.minGap-1e-12||gap>mode.base.maxGap+1e-12)return null;}
          return proposed;
        };
        const newtonTried=new Map(),tangentActive=new Set(),jointNormalActive=new Set();let newtonPrediction=null,pendingNewton=null;
        const newtonCandidate=(solution,pressure,coverageDepth=0,reuseNormalCandidate=false)=>{
          if(coverageDepth===0&&++c.newtonCalls>(c.newtonBudget??2))return null;if(!Newton||coverageDepth>=16||[...c.jawModes.values()].some(mode=>mode.stop||Math.abs(mode.extra)>1e-15))return null;
          prepareWarm();
          surfaceTangents.forEach((_,index)=>{if(len(warmToe[index])>1e-10)tangentActive.add(index);});
          const active=[...tangentActive].sort((a,b)=>a-b),key=active.join(','),prior=newtonTried.get(key);if(!active.length||prior&&!(prior.attempts<3&&frictionResidual<prior.residual*.5))return null;newtonTried.set(key,{attempts:(prior?.attempts||0)+1,residual:frictionResidual});
          const count=pinData.reduce((n,p)=>n+p.axes.length,0),trialPins=pinData.concat(active.map(index=>surfacePin(index))),trial=Coupling.assemble({pins:trialPins,normalRows,entry:c.materialEntry,bodyMobility:body=>({invM:bodies.get(body).im,inverseInertia:bodies.get(body).inertia}),dt}),variables=trialPins.flatMap((pin,i)=>pin.axes.map(axis=>{const ordinary=i-jointPins.length,contact=ordinary>=0?surfaceTangents[active[ordinary]]:null;return {axis,mode:contact?.jawMode,J:contact?-dot(axis,mv(contact.frame.pose.R,[0,(contact.jaw||0)/2,0])):0};}));
          for(let i=0;i<variables.length;i++)for(let j=0;j<=i;j++)if(variables[i].mode&&variables[i].mode===variables[j].mode){const value=variables[i].J*variables[j].J*jawCompliance(variables[i].mode);trial.H[i][j]+=value;if(i!==j)trial.H[j][i]+=value;}
          contacts.forEach((contact,i)=>variables.forEach((variable,j)=>{if(contact.jawMode&&contact.jawMode===variable.mode)trial.C[i][j]+=contact.jawJ*variable.J*jawCompliance(variable.mode);}));
          const errors=pinBase.concat(active.map(index=>{if(surfaceTangents[index].relative)return mul(surfaceTravel(index,free),-1);const data=frictionData[index],contact=surfaceTangents[index],mode=contact.jawMode,point=data.a.ids.reduce((p,id,k)=>add(p,mul(free[id],data.a.w[k])),[0,0,0]);let movement=add(data.movement,fieldOffset(background,data.h.body,contact.point));if(mode)movement=add(movement,mv(data.h.pose.R,[0,contact.jaw*mode.base.restOffset/2,0]));return sub(movement,sub(point,data.before));})),linear=trialPins.flatMap((pin,i)=>pin.axes.map(axis=>dot(axis,errors[i]))),base=contacts.map((contact,i)=>geometryBase[i]+contact.jawJ*(contact.jawMode?.base.restOffset||0)),modeList=[...c.jawModes.values()];diagonal=makeDiagonal();
          const metric=(start,size)=>size===1?trial.H[start][start]:(trial.H[start][start]+trial.H[start+1][start+1]+Math.hypot(trial.H[start][start]-trial.H[start+1][start+1],2*trial.H[start][start+1]))/2;
          const bounds=modeList.flatMap(mode=>[1,-1].map(sign=>({row:contacts.map(contact=>contact.jawMode===mode?sign*contact.jawJ:0),max:mode.base.maxForce}))),baselineTolerance=Math.min(c.contactTolerance??radius*.001,1e-9),reuseNormal=reuseNormalCandidate&&pinData.length===0&&toe.every(force=>force.every(value=>value===0))&&modeList.every(mode=>!mode.stop&&mode.extra===0)&&contacts.every((contact,i)=>Object.is(contact.base,base[i]))&&solution.converged&&Number.isFinite(solution.normalResidual)&&solution.normalResidual<=baselineTolerance&&solution.normalForces.length===contacts.length;
          // With no pin/traction forces, identical free-mode bases and bounds,
          // the preceding cold normal solve IS the zero-traction baseline.
          const baselineProblem={size:contacts.length,apply,column,diagonal,base,bounds};let baseline=reuseNormal?{converged:true,forces:solution.normalForces.slice(),residual:solution.normalResidual}:Patch.normalLCP({...baselineProblem,tolerance:baselineTolerance});
          if(!baseline.converged&&baseline.feasibility<=1e-9&&baseline.residual<=(c.contactTolerance??radius*.001)&&(baseline.boundResidual||0)<=1e-9)baseline=Patch.normalLCP({...baselineProblem,tolerance:c.contactTolerance??radius*.001,warm:baseline.forces});
          if(c.inspectNormalBaseline)c.inspectNormalBaseline({reused:reuseNormal,normal:{size:contacts.length,apply,column,diagonal,base},bounds,tolerance:baselineTolerance,forces:baseline.forces.slice()});if(!baseline.converged)return null;

          const enabled=(groups||[]).map(group=>group.sides.every(side=>side.reduce((sum,[id,w])=>sum+w*baseline.forces[id],0)>1e-9)),blocks=[];let start=0;pinData.forEach((pin,i)=>{const group=(groups||[]).findIndex(group=>group.pins.includes(i)),block={start,size:pin.axes.length,metric:metric(start,pin.axes.length)};if(group<0||pin.cap===0)block.capFixed=pin.cap;else{block.capSides=groups[group].sides;block.capScale=pin.cap/groups[group].normal;block.capMax=pin.cap;block.enabled=enabled[group];}blocks.push(block);start+=pin.axes.length;});
          active.forEach((index,i)=>{const contact=surfaceTangents[index],group=(groups||[]).findIndex(group=>group.pins.some(pin=>jointPins[pin].side===contact.frame.side)),held=group>=0&&enabled[group]&&pinData.some((pin,j)=>jointPins[j].side===contact.frame.side&&pin.cap>0),inner=contact.state&&dot(contact.normal,contact.state.closing)>.5,block={start:count+2*i,size:2,metric:metric(count+2*i,2)};if(held&&inner)block.capFixed=0;else{block.capNormals=[[contacts.indexOf(contact),frictionCoefficient(contact)]];}blocks.push(block);});
          const modes=modeList.map(mode=>({side:mode.base.side,maxForce:mode.base.maxForce,driveGap:mode.base.driveGap,minGap:mode.base.minGap,maxGap:mode.base.maxGap,compliance:mode.base.compliance,normalJ:contacts.map(contact=>contact.jawMode===mode?contact.jawJ:0),tangentJ:variables.map(variable=>variable.mode===mode?variable.J:0)})),normalActive=jointNormalActive,baselineResponse=apply(baseline.forces);contacts.forEach((_,i)=>{if(warmLambda[i]>1e-10||baseline.forces[i]>1e-10||solution.normalForces[i]>1e-10||baselineResponse[i]+base[i]<=(c.contactTolerance??radius*.001))normalActive.add(i);});
          let tangents=Array(trial.H.length).fill(0),lambda=baseline.forces.slice(),result,model;
          const problem={H:trial.H,C:trial.C,linear:linear.map(v=>-v),normal:{size:contacts.length,apply,column,diagonal,base},blocks,modes};
          const allTangents=()=>{
            const all=surfaceTangents.map((_,i)=>i),ps=pinData.concat(all.map(index=>surfacePin(index))),a=Coupling.assemble({pins:ps,normalRows,entry:c.materialEntry,bodyMobility:body=>({invM:bodies.get(body).im,inverseInertia:bodies.get(body).inertia}),dt}),vs=ps.flatMap((pin,i)=>pin.axes.map(axis=>{const q=i-jointPins.length,contact=q>=0?surfaceTangents[q]:null;return {mode:contact?.jawMode,J:contact?-dot(axis,mv(contact.frame.pose.R,[0,(contact.jaw||0)/2,0])):0};}));
            for(let i=0;i<vs.length;i++)for(let j=0;j<=i;j++)if(vs[i].mode&&vs[i].mode===vs[j].mode){const value=vs[i].J*vs[j].J*jawCompliance(vs[i].mode);a.H[i][j]+=value;if(i!==j)a.H[j][i]+=value;}contacts.forEach((contact,i)=>vs.forEach((v,j)=>{if(contact.jawMode&&contact.jawMode===v.mode)a.C[i][j]+=contact.jawJ*v.J*jawCompliance(v.mode);}));
            const es=pinBase.concat(all.map(index=>{if(surfaceTangents[index].relative)return mul(surfaceTravel(index,free),-1);const data=frictionData[index],contact=surfaceTangents[index],mode=contact.jawMode,point=data.a.ids.reduce((v,id,k)=>add(v,mul(free[id],data.a.w[k])),[0,0,0]);let movement=add(data.movement,fieldOffset(background,data.h.body,contact.point));if(mode)movement=add(movement,mv(data.h.pose.R,[0,contact.jaw*mode.base.restOffset/2,0]));return sub(movement,sub(point,data.before));})),e=ps.flatMap((pin,i)=>pin.axes.map(axis=>dot(axis,es[i]))),bs=blocks.slice(0,pinData.length).map(block=>({...block}));
            all.forEach((index,i)=>{const contact=surfaceTangents[index],group=(groups||[]).findIndex(group=>group.pins.some(pin=>jointPins[pin].side===contact.frame.side)),held=group>=0&&enabled[group]&&pinData.some((pin,j)=>jointPins[j].side===contact.frame.side&&pin.cap>0),inner=contact.state&&dot(contact.normal,contact.state.closing)>.5,start=count+2*i,block={start,size:2,metric:(a.H[start][start]+a.H[start+1][start+1]+Math.hypot(a.H[start][start]-a.H[start+1][start+1],2*a.H[start][start+1]))/2};if(held&&inner)block.capFixed=0;else block.capNormals=[[contacts.indexOf(contact),frictionCoefficient(contact)]];bs.push(block);});
            return {H:a.H,C:a.C,errors:e,linear:e.map(v=>-v),blocks:bs,active:all,handRows:surfaceTangents.map(contact=>contacts.indexOf(contact)),modes:modeList.map(mode=>({side:mode.base.side,maxForce:mode.base.maxForce,driveGap:mode.base.driveGap,minGap:mode.base.minGap,maxGap:mode.base.maxGap,compliance:mode.base.compliance,normalJ:contacts.map(contact=>contact.jawMode===mode?contact.jawJ:0),tangentJ:vs.map(v=>v.mode===mode?v.J:0)}))};
          };
          const run=(search,seed,tangentScale=1,preferWarm=false,projectionSearch=false)=>{
            model=VI.create({...problem,normalActive:[...normalActive].sort((a,b)=>a-b),normalSearch:search,tangentSearchScale:tangentScale});const projection=projectionSearch?Projection?.create({model,blocks,normalActive:model.normalActive,tangentCount:trial.H.length}):null;if(projectionSearch&&!projection)return null;

            let initial=seed?.forces?model.initial(seed.forces.tangents,seed.forces.normalForces):seed||model.initial(tangents,lambda),warmSeed=null,usedWarm=false;if(!seed&&previous){const capture=pinData.flatMap((pin,i)=>{const value=previous.pins.get(jointPins[i].pointRef),h=W.hands[jointPins[i].side],world=value&&value.body===h.body?mv(W.handPose(jointPins[i].side).R,value.force):[0,0,0];return pin.axes.map(axis=>dot(axis,world));}),f=capture.concat(active.flatMap(index=>frictionData[index].axes.map(axis=>dot(axis,warmToe[index])))),guess=model.initial(f,warmLambda),q=model.evaluate(guess);blocks.forEach((block,i)=>{const force=guess.slice(block.start,block.start+block.size),F=len(force),cap=q.payload.caps[i];if(F>cap)for(let j=0;j<block.size;j++)guess[block.start+j]*=cap/F;});warmSeed=guess.slice();const warm=model.evaluate(guess),cold=model.evaluate(initial),scale=Math.max(...blocks.map(block=>block.metric),...diagonal),score=value=>value.valid?Math.max(value.payload.maxResidual,value.feasibility*scale):Infinity;if(warm.valid&&(preferWarm||score(warm)<score(cold))){initial=guess;usedWarm=true;c.warmDiagnostic.used=true;c.warmDiagnostic.warmResidual=warm.payload.maxResidual;c.warmDiagnostic.coldResidual=cold.payload.maxResidual;}}
            if(projection)initial=projection.project(initial).y;
            if(c.inspectContact)c.inspectContact({projectionSearch,H:trial.H,C:trial.C,base,errors:linear,captured:count,active,blocks,modes,groups,normal:{apply,column,diagonal},evaluate:model.evaluate,jacobian:model.jacobian,x:initial,warmSeed,warmDiagnostic:{...c.warmDiagnostic},normalActive:model.normalActive,scales:model.scales,normalSearch:search,tangentSearchScale:tangentScale,allTangents,rhsTerms:active.map(index=>{const data=frictionData[index],contact=surfaceTangents[index],point=data.a.ids.reduce((p,id,k)=>add(p,mul(free[id],data.a.w[k])),[0,0,0]),terms={cloth:contact.relative?surfaceTravel(index,free):sub(point,data.before),...data.motionTerms,background:fieldOffset(background,data.h.body,contact.point),actuator:contact.jawMode?mv(data.h.pose.R,[0,contact.jaw*contact.jawMode.base.restOffset/2,0]):[0,0,0]};return {index,row:contacts.indexOf(contact),ids:data.a.ids.slice(),w:data.a.w.slice(),materialPoint:(data.a.materialPoint||data.a.ids.reduce((p,id,k)=>add(p,mul(material[id],data.a.w[k])),[0,0,0])).slice(),panel:data.a.panel??null,freePoint:(data.a.point||contact.point).slice(),jaw:contact.jaw,kind:contact.relative?'relative':contact.table?'table':contact.state?'rubber':'carrier',normalRecovery:contact.state?.rest.slice()||[0,0,0],point:contact.point,local:mt(data.h.pose.R,sub(contact.point,data.h.pose.t)),normal:contact.normal,axes:data.axes,terms,components:Object.fromEntries(Object.entries(terms).map(([key,value])=>[key,data.axes.map(axis=>dot(axis,value))]))};})});
            let feasibleSeed=null,solved=Newton.solve({x:initial,evaluate:projection?projection.evaluate:model.evaluate,jacobian:projection?projection.jacobian:model.jacobian,tolerance:(c.contactTolerance??radius*.001)*(search==='fb'?.5:1/Math.SQRT2)*Math.min(1,tangentScale),forceTolerance:1e-9,variableScale:Array(model.dimensions.unknowns).fill(1),residualScale:model.scales,maxIterations:24,maxEvaluations:512,maxStep:Infinity,includeFeasibilityInMerit:false,acceptEvaluation:raw=>raw.payload.maxResidual<=(c.contactTolerance??radius*.001)});
            const parameter=projection?solved.x.slice():null,projectedState=projection?projection.project(solved.x):null,projectionDiagnostic=projectedState?{gauge:len(sub(parameter,projectedState.y)),flatBlocks:projectedState.groups.filter(group=>group.D.every(row=>row.every(value=>value===0))).length,blocks:projectedState.groups.length}:null;
            if(projection)solved.x=projectedState.y;
            const certificate=model.certificate(solved.x),physicalPass=certificate.valid&&certificate.feasibility<=1e-9&&certificate.payload.maxResidual<=(c.contactTolerance??radius*.001);solved={...solved,evaluation:certificate,searchConverged:solved.converged,converged:physicalPass,reason:physicalPass&&!solved.converged?'physical-certificate':solved.reason};
            // Feasibility projection is a proposal, never a post-applied cap.
            // A fresh actual-operator certificate checks every original gate.
            if(!solved.converged&&solved.evaluation?.payload){const projected=solved.x.slice(),q=solved.evaluation.payload;for(let i=trial.H.length;i<projected.length;i++)projected[i]=Math.max(0,projected[i]);blocks.forEach((block,i)=>{const force=projected.slice(block.start,block.start+block.size),F=len(force),cap=q.caps[i];if(F>cap)for(let j=0;j<block.size;j++)projected[block.start+j]*=cap/F;});const checked=model.certificate(projected);if(checked.valid&&checked.feasibility<=1e-9){feasibleSeed={tangents:checked.payload.tangents,lambda:checked.payload.normalForces};if(checked.payload.maxResidual<=(c.contactTolerance??radius*.001))solved={...solved,x:projected,evaluation:checked,converged:true,reason:'verified-feasible-trial'};}}
            if(c.inspectContactResult)c.inspectContactResult({projectionSearch,parameter,projectionDiagnostic,x:solved.x,evaluation:solved.evaluation,reason:solved.reason,converged:solved.converged,iterations:solved.iterations,evaluations:solved.evaluations});
            return {...solved,warmUsed:usedWarm,feasibleSeed,projectionSearch,projectionDiagnostic};
          };
          // Exact local normal+traction updates traverse redundant pressure
          // allocations without an artificial spring or a merit-line plateau.
          // The certificate model stores no selected normal columns: it checks
          // all full-force rows through the actual operator before reconstruction.
          let supportedNGS=null;
          if(NGS){
            const certificateModel=VI.create({...problem,normalActive:[]}),capture=pinData.flatMap((pin,i)=>{const value=previous?.pins.get(jointPins[i].pointRef),h=W.hands[jointPins[i].side],world=value&&value.body===h.body?mv(W.handPose(jointPins[i].side).R,value.force):[0,0,0];return pin.axes.map(axis=>dot(axis,world));}),guess=capture.concat(active.flatMap(index=>frictionData[index].axes.map(axis=>dot(axis,previous?warmToe[index]:toe[index]))));
            let blockAttempts=0,blockBounds=0;const normalBlock=force=>{
              blockAttempts++;const b=base.map((value,i)=>value+dot(trial.C[i],force.tangents)),limits=modes.flatMap(mode=>[1,-1].map(sign=>({row:mode.normalJ.map(value=>sign*value),max:mode.maxForce-sign*dot(mode.tangentJ,force.tangents)}))),q=Patch.normalLCP({size:contacts.length,apply,column,diagonal,base:b,bounds:limits,tolerance:Math.min(c.contactTolerance??radius*.001,1e-10)});
              if(q.boundMultipliers?.some(value=>Math.abs(value)>1e-12))blockBounds++;return {converged:q.converged,normalForces:q.forces,applications:q.applications,iterations:q.iterations,residual:q.residual,boundMultipliers:q.boundMultipliers||[]};
            },options={...problem,certificate:value=>certificateModel.certificateForces(value),tolerance:c.contactTolerance??radius*.001,forceTolerance:1e-9,maxSweeps:64,checkEvery:2,maxCachedColumns:64,residualPrecheck:true};
            let initial={tangents:guess,normalForces:previous?warmLambda:baseline.forces},warmInitial=initial,ngs=NGS.solve({...options,initial}),coldTried=false,stage='warm';const ngsAttempts=c.inspectNGS?[{stage,initial,result:ngs}]:null;
            // A changed manifold can make transported pressures a poor initial
            // estimate. The already-computed zero-traction normal baseline is
            // an independent bounded restart, never an applied force change.
            if(ngs&&!ngs.converged&&(guess.some(value=>value!==0)||initial.normalForces.some((value,i)=>value!==baseline.forces[i]))){const coldInitial={tangents:Array(trial.H.length).fill(0),normalForces:baseline.forces},cold=NGS.solve({...options,initial:coldInitial});ngsAttempts?.push({stage:'cold',initial:coldInitial,result:cold});coldTried=true;if(cold&&(cold.converged||cold.evaluation?.payload?.maxResidual<ngs.evaluation?.payload?.maxResidual)){ngs=cold;initial=coldInitial;stage='cold';}}
            let proxDiagnostic=null;if(ngs&&!ngs.converged&&Prox){
              const field=ngs.evaluation.payload,proxInitial={tangents:field.tangents,normalForces:field.normalForces},prox=Prox.solve({...problem,initial:proxInitial,certificate:value=>certificateModel.certificateForces(value),tolerance:options.tolerance,forceTolerance:1e-9,innerTolerance:3e-8,maxOuterIterations:32,maxInnerSweeps:20,innerRefine:value=>Refine.solve(value),checkEvery:10,maxCachedColumns:64,relativeAlpha:.001,adaptiveAlpha:true,inexactRatio:.6,progressRatio:.999999});
              if(prox){proxDiagnostic={converged:prox.converged,reason:prox.reason,outerIterations:prox.outerIterations,innerSweeps:prox.innerSweeps,trace:prox.trace};const candidate={...prox,sweeps:prox.innerSweeps,applications:prox.innerApplications,certificates:prox.originalCertificates,cachedColumns:0};ngsAttempts?.push({stage:'proximal',initial:proxInitial,result:candidate});if(prox.converged||prox.evaluation.payload.maxResidual<ngs.evaluation.payload.maxResidual){ngs=candidate;initial=proxInitial;stage='proximal';}}
            }
            if(ngs&&!ngs.converged&&ngs.evaluation.payload.normalResidual>options.tolerance){const current=ngs.evaluation.payload,blockInitial={tangents:current.tangents,normalForces:current.normalForces},blocked=NGS.solve({...options,initial:blockInitial,maxSweeps:500,normalBlock,normalBlockEvery:10});ngsAttempts?.push({stage:'normal-block',initial:blockInitial,result:blocked});if(blocked&&(blocked.converged||blocked.evaluation?.payload?.maxResidual<ngs.evaluation?.payload?.maxResidual)){ngs=blocked;initial=blockInitial;stage='normal-block';}}
            let qpDiagnostic=null;if(ngs&&!ngs.converged&&Tangent){
              const trace=[],history=[],size=trial.H.length,vector=field=>field.tangents.concat(field.normalForces);let seed=vector(ngs.evaluation.payload),fallback=seed,mapFailed=false;
              // This exact two-block map has the original joint conditions as
              // its fixed points. No finite NGS phase sits inside the map.
              for(let cycle=0;cycle<20&&!ngs.converged;cycle++){
                const x=seed,input={tangents:x.slice(0,size),normalForces:x.slice(size)},normal=normalBlock(input);
                if(!normal.converged||normal.boundMultipliers.some(value=>Math.abs(value)>1e-12)){trace.push({cycle,failed:'normal-or-free-branch'});if(mapFailed)break;history.length=0;seed=fallback;mapFailed=true;continue;}
                const at=certificateModel.certificateForces({tangents:input.tangents,normalForces:normal.normalForces}),fixedLinear=problem.linear.map((value,i)=>value+trial.C.reduce((sum,row,j)=>sum+row[i]*normal.normalForces[j],0)),qp=Tangent.solve({H:trial.H,linear:fixedLinear,blocks,caps:at.payload.caps,initial:input.tangents,tolerance:3e-8,forceTolerance:1e-9,maxIterations:1000,checkEvery:10});
                qpDiagnostic={converged:qp.converged,residual:qp.residual,feasibility:qp.feasibility,iterations:qp.iterations,activeDOFs:qp.activeDOFs,method:qp.method,trace};
                if(!qp.converged){trace.push({cycle,failed:'tangent-qp',residual:qp.residual});if(mapFailed)break;history.length=0;seed=fallback;mapFailed=true;continue;}
                const field={tangents:qp.tangents,normalForces:normal.normalForces},evaluation=certificateModel.certificateForces(field),q=evaluation.payload,converged=evaluation.valid&&evaluation.feasibility<=1e-9&&q.maxResidual<=options.tolerance,y=vector(field),mapped={...field,evaluation,converged,reason:converged?'converged':'map-limit',sweeps:0,applications:normal.applications,columns:0,columnApplications:0,cachedColumns:0,certificates:2};mapFailed=false;fallback=y;
                trace.push({cycle,normal:q.normalResidual,friction:q.frictionResidual,residual:q.maxResidual,feasibility:evaluation.feasibility,step:len(sub(y,x)),qp:qp.iterations});ngsAttempts?.push({stage:'exact-block-map',cycle,initial:input,qp:{...qpDiagnostic,trace:trace.slice()},result:mapped});
                if(converged||evaluation.valid&&evaluation.feasibility<=1e-9&&q.maxResidual<ngs.evaluation.payload.maxResidual){ngs=mapped;initial=input;stage='exact-block-map';}
                if(!converged)seed=accelerateFriction(history,x,y);
              }
            }
            if(c.inspectNGS)c.inspectNGS({...problem,initial,stage,attempts:ngsAttempts,result:ngs});
            c.ngsDiagnostic=ngs?{converged:ngs.converged,stage,coldTried,prox:proxDiagnostic,qp:qpDiagnostic,sweeps:ngs.sweeps,applications:ngs.applications,columns:ngs.columnApplications,cached:ngs.cachedColumns,certificates:ngs.certificates,blockAttempts,blockBounds,reason:ngs.reason,residual:ngs.evaluation?.payload?.maxResidual,feasibility:ngs.evaluation?.feasibility}:{supported:false};
            supportedNGS=ngs;
            if(ngs?.converged){result={...ngs,iterations:ngs.sweeps,evaluations:ngs.certificates,ngs:true};model=certificateModel;}
          }
          if(supportedNGS&&!supportedNGS.converged){
            // Hand the SAME feasible force field to the semismooth polish.
            // Old transported pressures belong to another geometry and must not
            // replace this closer state or its actual load-bearing normal rows.
            const best=supportedNGS.evaluation.payload;normalActive.clear();contacts.forEach((_,i)=>{if(best.normalForces[i]>0||best.gaps[i]<=(c.contactTolerance??radius*.001))normalActive.add(i);});let seed={tangents:best.tangents,normalForces:best.normalForces};
            for(let expansion=0;expansion<4;expansion++){
              const polished=run('min',{forces:seed},.001,false,true);if(!polished)break;result=polished;const q=polished.evaluation.payload;
              c.handoffDiagnostic={sourceResidual:best.maxResidual,sourceFeasibility:supportedNGS.evaluation.feasibility,rows:model.normalActive.length,totalRows:contacts.length,residual:q.maxResidual,feasibility:polished.evaluation.feasibility,iterations:polished.iterations,evaluations:polished.evaluations,reason:polished.reason};
              if(polished.converged)break;const before=normalActive.size;contacts.forEach((_,i)=>{if(q.normalForces[i]>0||q.gaps[i]<=(c.contactTolerance??radius*.001))normalActive.add(i);});if(normalActive.size===before)break;seed={tangents:q.tangents,normalForces:q.normalForces};
            }
            c.newtonDiagnostic={joint:true,handoff:true,converged:!!result?.converged,dimensions:model?.dimensions,...c.handoffDiagnostic};if(!result?.converged)return null;
          }
          for(let expansion=0;!supportedNGS&&!result?.converged&&expansion<8;expansion++){

            // Supported layouts keep every iterate force-cone feasible. Start
            // there from the transported physical estimate, before spending a
            // full ordinary search budget on a different pressure allocation.
            const projectedFirst=Projection?run('min',null,.001,true,true):null;result=projectedFirst;
            if(!result?.converged){const ordinary=run('min',null,1,true);if(!result||ordinary.converged||ordinary.evaluation.payload.maxResidual<result.evaluation.payload.maxResidual)result=ordinary;}
            if(!result.converged&&result.warmUsed&&!result.projectionSearch){const cold=run('min',model.initial(Array(trial.H.length).fill(0),baseline.forces));if(cold.converged||cold.evaluation.payload.maxResidual<result.evaluation.payload.maxResidual)result=cold;}let missing=[...new Set([...(result.evaluation?.payload?.omittedViolations||[]),...(projectedFirst?.evaluation?.payload?.omittedViolations||[])])].filter(id=>!normalActive.has(id));
            if(!result.converged&&!missing.length){const q=result.evaluation.payload;q.gaps.forEach((gap,id)=>{if(gap<=(c.contactTolerance??radius*.001))normalActive.add(id);});tangents=q.tangents;lambda=q.normalForces;const scaled=run('min',null,.001);missing=[...new Set(missing.concat(scaled.evaluation?.payload?.omittedViolations||[]))].filter(id=>!normalActive.has(id));if(scaled.converged||scaled.evaluation.payload.maxResidual<result.evaluation.payload.maxResidual)result=scaled;if(!result.converged&&!missing.length){tangents=result.evaluation.payload.tangents;lambda=result.evaluation.payload.normalForces;const smaller=run('min',null,.00001);missing=[...new Set(missing.concat(smaller.evaluation?.payload?.omittedViolations||[]))].filter(id=>!normalActive.has(id));if(smaller.converged||smaller.evaluation.payload.maxResidual<result.evaluation.payload.maxResidual)result=smaller;}if(!result.converged&&!missing.length){tangents=result.evaluation.payload.tangents;lambda=result.evaluation.payload.normalForces;const alternate=run('fb');missing=[...new Set(missing.concat(alternate.evaluation?.payload?.omittedViolations||[]))].filter(id=>!normalActive.has(id));if(alternate.converged||alternate.evaluation.payload.maxResidual<result.evaluation.payload.maxResidual)result=alternate;}}
            // A feasible projection can lie just outside the displacement
            // certificate. Use it once as a numerical continuation seed; every
            // returned force still needs the original actual-operator gates.
            if(!result.converged&&!missing.length&&result.feasibleSeed){const seed=result.feasibleSeed,continued=run('min',model.initial(seed.tangents,seed.lambda),.001);missing=(continued.evaluation?.payload?.omittedViolations||[]).filter(id=>!normalActive.has(id));if(continued.converged||continued.evaluation.payload.maxResidual<result.evaluation.payload.maxResidual)result=continued;}
            // Search in an exactly feasible ordinary force-cone parameterization.
            // The unknown is numerical z; only certified physical P(z) is kept.
            if(!result.converged&&!missing.length&&Projection){const q=result.evaluation.payload,projected=run('min',model.initial(q.tangents,q.normalForces),.001,false,true);if(projected){missing=(projected.evaluation?.payload?.omittedViolations||[]).filter(id=>!normalActive.has(id));if(projected.converged||projected.evaluation.payload.maxResidual<result.evaluation.payload.maxResidual)result=projected;}}
            const payload=result.evaluation?.payload;c.newtonDiagnostic={joint:true,projectionSearch:result.projectionSearch,projectionDiagnostic:result.projectionDiagnostic,converged:result.converged,iterations:result.iterations,evaluations:result.evaluations,rank:result.rank,reason:result.reason,dimensions:model.dimensions,residual:payload?.maxResidual,feasibility:result.evaluation?.feasibility,operatorDifference:payload?.operatorDifference,coverage:{ordinary:active.length,totalOrdinary:surfaceTangents.length,omittedLoaded:payload?surfaceTangents.filter((contact,index)=>!active.includes(index)&&payload.normalForces[contacts.indexOf(contact)]>1e-10).length:null,omittedNormal:payload?.omittedViolations?.length,depth:coverageDepth}};
            if(result.converged)break;
            if(missing.length){for(const id of missing)normalActive.add(id);tangents=payload.tangents;lambda=payload.normalForces;continue;}break;
          }
          if(result?.ngs)c.newtonDiagnostic={joint:true,ngs:true,converged:true,iterations:result.sweeps,evaluations:result.certificates,dimensions:model.dimensions,residual:result.evaluation.payload.maxResidual,feasibility:result.evaluation.feasibility};
          // Close friction coverage before a proposal can escape to a backup
          // or reconstruction path: changing pressure can activate another face.
          const last=result?.evaluation?.payload;let added=false;if(last){for(const index of omittedTangents(last,active))if(!tangentActive.has(index)){tangentActive.add(index);added=true;}last.normalForces.forEach((force,i)=>{if(force>1e-10)jointNormalActive.add(i);});}if(added)return newtonCandidate({...solution,normalForces:last.normalForces},pressure,coverageDepth+1);
          if(!result?.converged)return null;const payload=result.evaluation.payload,proposed=surfaceTangents.map(()=>[0,0,0]),forces=pinData.map((pin,i)=>{let at=pinData.slice(0,i).reduce((sum,p)=>sum+p.axes.length,0);return pin.axes.reduce((f,axis)=>add(f,mul(axis,payload.tangents[at++])),[0,0,0]);});active.forEach((index,i)=>{const data=frictionData[index];proposed[index]=add(mul(data.axes[0],payload.tangents[count+2*i]),mul(data.axes[1],payload.tangents[count+2*i+1]));});
          // The VI accepts only roundoff-scale negative pressure (≤1e−9N).
          // Physical pressure/capacity is nonnegative, matching the VI cap map.
          const physicalNormals=payload.normalForces.map(value=>value<0&&value>=-1e-9?0:value);
          const solved={forces,normalForces:physicalNormals,caps:payload.caps.slice(0,pinData.length),normalResidual:payload.normalResidual,pinResidual:payload.frictionResidual,feasibility:result.evaluation.feasibility,converged:true,iterations:result.iterations,applications:result.applications||0};pendingNewton={solved,modes:payload.loads.map(value=>({side:value.side,load:value.load,extra:0}))};newtonPrediction={ngs:!!result.ngs,active,forces:proposed.map(v=>v.slice()),gradients:active.map((_,i)=>payload.gradient.slice(count+2*i,count+2*i+2)),normal:physicalNormals,caps:payload.caps.slice(pinData.length)};return proposed;

        };
        let accepted=null,best=null,last=null,warm=null,warmVersion=null,lastToe=null,lastEta=null,lastStops=null,frictionResidual=Infinity,previousFriction=Infinity,stepScale=1,frictionTrace=[],trialBackup=null,trialResidual=Infinity,strictCommon=c.coldContacts;
        for(let sweep=0;sweep<128;sweep++){
          toeNodal.fill(0);const toeField=new Map(),toeLoad=new Map();for(let i=0;i<surfaceTangents.length;i++){const contact=surfaceTangents[i],F=toe[i];addSurfaceTangent(i,F,toeNodal,toeField);if(contact.jawMode)toeLoad.set(contact.jawMode,(toeLoad.get(contact.jawMode)||0)-dot(F,mv(contact.frame.pose.R,[0,(contact.jaw||0)/2,0])));}
          c.materialForceResponse(toeNodal,toeDelta);
          for(const [side,mode]of c.jawModes){mode.load=toeLoad.get(mode)||0;mode.extra=toeEta.get(side)||0;mode.stop=c.jawStops.get(side);}
          contacts.forEach((contact,i)=>{let shift=0;for(const [id,w]of rows[i])for(let axis=0;axis<3;axis++)shift+=w*contact.normal[axis]*toeDelta[3*id+axis];if(contact.body)shift-=dot(contact.normal,fieldOffset(toeField,contact.body,contact.point));contact.jawBase=geometryBase[i]+shift;});
          const errors=jointPins.map((a,i)=>{const p=pinData[i],cloth=p.ids.reduce((v,id,k)=>add(v,[0,1,2].map(axis=>p.w[k]*toeDelta[3*id+axis])),[0,0,0]);return add(pinBase[i],sub(fieldOffset(toeField,p.body,p.point),cloth));});
          let solution,coldNormalBaseline=false;if(pendingNewton){solution=pendingNewton.solved;for(const value of pendingNewton.modes){const mode=c.jawModes.get(String(value.side));mode.load=value.load;mode.extra=value.extra;mode.stop=null;c.jawStops.delete(String(value.side));}pendingNewton=null;}else{coldNormalBaseline=strictCommon&&pinData.length===0&&toe.every(force=>force.every(value=>value===0))&&[...c.jawModes.values()].every(mode=>!mode.stop&&mode.load===0&&mode.extra===0);solution=solveJawContacts(c,contacts,normalBounds=>{const version=[...c.jawModes.values()].map(mode=>mode.stop||'free').join(',');if(version!==warmVersion){warm=null;warmVersion=version;}if(strictCommon&&!warm&&previous){prepareWarm();warm={normalForces:warmLambda};}diagonal=makeDiagonal();const physicalTolerance=c.contactTolerance??radius*.001,problem={H,C,normal:{size:contacts.length,apply,column,diagonal,base:contacts.map(contact=>contact.base)},pins:pinData.map(p=>({axes:p.axes,cap:p.cap})),errors,normalBounds,pressureGroups:groups},inner=Patch.solveCoupled({...problem,tolerance:strictCommon?Math.min(physicalTolerance,1e-9):physicalTolerance,warm});
            // A stricter inner target is a numerical aid, never the physical
            // acceptance rule. Re-solve a small inner miss with the ORIGINAL
            // tolerance and a fresh full operator/pressure/bounds certificate.
            if(!inner.converged&&strictCommon&&inner.feasibility<=1e-9&&inner.normalResidual<=physicalTolerance&&inner.pinResidual<=physicalTolerance&&(inner.normalBoundResidual||0)<=1e-9){const checked=Patch.solveCoupled({...problem,tolerance:physicalTolerance,warm:inner.warm});if(checked.converged)c.surfaceStats.certifiedRestarts=(c.surfaceStats.certifiedRestarts||0)+1;return checked;}return inner;});}
          if(!solution.converged){if(lastToe){for(let i=0;i<toe.length;i++)toe[i]=mul(add(toe[i],lastToe[i]),.5);for(const [side,value]of lastEta)toeEta.set(side,((toeEta.get(side)||0)+value)/2);warm=null;stepScale*=.5;frictionHistory.length=0;continue;}if(best&&!c.strictContact)break;if(!c.strictContact&&solution.normalForces?.every(Number.isFinite)&&solution.forces?.every(f=>f.every(Number.isFinite)))c.surfaceStats.unconverged=(c.surfaceStats.unconverged||0)+1;else throw new Error('Joint cloth contact did not converge: pin '+solution.pinResidual+' normal '+solution.normalResidual+' bounds '+solution.normalBoundResidual);}
          warm=solution.warm;allNodal.set(toeNodal);const field=new Map([...background].map(([body,value])=>[body,{...value,force:value.force.slice(),torque:value.torque.slice()}]));for(const [body,value]of toeField)addForce(field,body,body.t,value.force,value.side),field.get(body).torque=add(field.get(body).torque,value.torque);
          for(let i=0;i<contacts.length;i++){const contact=contacts[i],F=solution.normalForces[i];for(const [id,w]of rows[i])for(let axis=0;axis<3;axis++)allNodal[3*id+axis]+=w*contact.normal[axis]*F;if(contact.body)addForce(field,contact.body,contact.point,mul(jacobians[i].direction,F),contact.h?.side??null);}
          for(let i=0;i<jointPins.length;i++){const a=jointPins[i],F=solution.forces[i];a.ids.forEach((id,k)=>{for(let axis=0;axis<3;axis++)allNodal[3*id+axis]+=a.w[k]*F[axis];});addForce(field,pinData[i].body,pinData[i].point,mul(F,-1),a.side);}
          c.materialForceResponse(allNodal,allDelta);for(let id=0;id<ns.length;id++)for(let axis=0;axis<3;axis++)ns[id].p[axis]=free[id][axis]+allDelta[3*id+axis];
          for(const state of rubber.keys()){state.force=[0,0,0];state.innerPressure=0;}contacts.forEach((contact,i)=>{contact.lambda=solution.normalForces[i];if(contact.state){contact.state.force=add(contact.state.force,mul(contact.normal,contact.lambda));const alignment=dot(contact.normal,contact.state.closing);if(alignment>.5)contact.state.innerPressure+=contact.lambda*alignment;}});
          const pressure=new Map();for(const [side,h]of Object.entries(W.hands)){const states=c.padStates.get(h.body);pressure.set(side,{'1':states?.get(1)?.innerPressure||0,'-1':states?.get(-1)?.innerPressure||0});}
          let acquired=false;for(const [side,pin]of pins){const Pside=pressure.get(side),can=G?Pside&&Pside[1]>0&&Pside[-1]>0:(W.hands[side]?.fabricForce||0)>0;if(can&&pin.loaded===false&&!pin.acquired&&jointPins.some(a=>a.side===side)){
            const pose=W.handPose(side),region=c.handGeometry.get(side)?.region;for(const point of pin.points){const p=point.ids.reduce((v,id,k)=>add(v,mul(ns[id].p,point.w[k])),[0,0,0]),reference=sub(p,fieldOffset(field,W.hands[side].body,point.ids.reduce((v,id,k)=>add(v,mul(free[id],point.w[k])),[0,0,0]))),local=mt(pose.R,sub(reference,pose.t));for(const axis of [0,2])point.local[axis]=region?Math.max(region.c[axis]-region.h[axis],Math.min(region.c[axis]+region.h[axis],local[axis])):local[axis];}
            pin.local=pin.points.filter((_,i)=>i%3===0).reduce((v,p)=>add(v,mul(p.local,1/pin.layers)),[0,0,0]);pin.loaded=true;pin.acquired=true;c.touched.add(+side);if(c.foldStage===1){if(pin.throughFold)c.foldHands.add(+side);}else c.firstHands.add(+side);
            jointPins.forEach((a,i)=>{if(a.side===side){a.target=add(pose.t,mv(pose.R,a.pointRef.local));pinBase[i]=sub(add(a.target,fieldOffset(background,pinData[i].body,pinData[i].point)),pinData[i].point);pinData[i].cap=pinData[i].nominal;}});acquired=true;
          }}
          if(acquired){warm=null;lastToe=null;stickTried.clear();newtonTried.clear();pendingNewton=null;newtonPrediction=null;trialBackup=null;frictionHistory.length=0;previousFriction=Infinity;stepScale=1;continue;}
          surfaceTangents.forEach((contact,index)=>{if(len(toe[index])>1e-10)tangentActive.add(index);});contacts.forEach((contact,i)=>{if(contact.lambda>1e-10)jointNormalActive.add(i);});
          const positions=ns.map(n=>n.p.slice()),workingField=new Map([...field].map(([body,value])=>[body,{...value,force:value.force.slice(),torque:value.torque.slice()}]));let residual=0,feasibility=0,controlChanged=false,worst=null;
          // Accept only a fully re-solved common force/normal/actuator state.
          // A small projected update can be caused by damping, not convergence.
          for(let index=0;index<surfaceTangents.length;index++){
            const state=tangentState(index,positions,field,pressure),force=toe[index],cap=state.cap;if(!(state.L>0)||!(cap>=0)||!Number.isFinite(cap)||!state.tangent.every(Number.isFinite)||!force.every(Number.isFinite))continue;const check=Patch.frictionResidual(force,state.tangent,cap,state.L),value=check.residual;
            if(value>(c.contactTolerance??radius*.001))tangentActive.add(index);feasibility=Math.max(feasibility,check.feasibility);if(value>residual){residual=value;worst={index,normal:state.normal,point:surfaceTangents[index].point,updatedPoint:state.point,tangent:state.tangent,force:force.slice(),cap,L:state.L,lambda:surfaceTangents[index].lambda,jawJ:surfaceTangents[index].jawJ};}
          }
          if(newtonPrediction&&toe.every((force,index)=>len(sub(force,newtonPrediction.forces[index]))<1e-12)){const error=Math.max(0,...newtonPrediction.active.map((index,i)=>{const state=tangentState(index,positions,field,pressure),expected=newtonPrediction.gradients[i];return Math.hypot(...state.axes.map((axis,k)=>dot(axis,state.tangent)-expected[k]));}));c.newtonDiagnostic.comparison={gradient:error,capacity:Math.max(0,...newtonPrediction.active.map((index,i)=>Math.abs(tangentState(index,positions,field,pressure).cap-newtonPrediction.caps[i]))),normal:Math.max(0,...solution.normalForces.map((v,i)=>Math.abs(v-newtonPrediction.normal[i]))),normalResidual:solution.normalResidual};if(newtonPrediction.ngs)c.ngsComparison=c.newtonDiagnostic.comparison;newtonPrediction=null;}
          for(const [side,mode]of c.jawModes)if(!mode.stop&&Math.abs(mode.extra)>1e-15){const complementarity=mode.extra>0?mode.base.maxForce-mode.load:mode.base.maxForce+mode.load;if(complementarity>1e-8)residual=Math.max(residual,Math.abs(mode.extra));}
          frictionResidual=residual;frictionTrace.push({sweep,residual,feasibility,stepScale});if(frictionTrace.length>8)frictionTrace.shift();
          if(residual<=(c.contactTolerance??radius*.001)&&feasibility<=1e-9){accepted={solution,field,toeField,pressure};break;}last={residual,accepted:{solution,field,toeField,pressure},positions:ns.map(n=>n.p.slice())};if(feasibility<=1e-9&&(!best||residual<best.residual))best={residual,accepted:{solution,field,toeField,pressure},positions:ns.map(n=>n.p.slice())};
          if(trialBackup&&residual>Math.max(trialResidual*1.2,c.contactTolerance??radius*.001)){for(let i=0;i<toe.length;i++)toe[i]=trialBackup.toe[i].slice();toeEta.clear();for(const [side,value]of trialBackup.eta)toeEta.set(side,value);c.jawStops=new Map(trialBackup.stops);trialBackup=null;frictionHistory.length=0;warm=null;continue;}trialBackup=null;
          // Exact global stick trial removes near-dependent GS modes. It uses
          // only load-bearing tangents, all normals, and zero elastic compliance;
          // singular/capped/actuator-branch trials fall back without softening.
          const freeJaw=[...c.jawModes.values()].every(mode=>!mode.stop&&Math.abs(mode.extra)<1e-15),newton=newtonCandidate(solution,pressure,0,coldNormalBaseline);if(newton){strictCommon=true;c.coldContacts=true;}if(freeJaw&&!newton&&(best||!c.strictContact))break;if(freeJaw&&!newton)throw new Error('Cloth joint VI did not converge: '+JSON.stringify({newton:c.newtonDiagnostic,ngs:c.ngsDiagnostic,ngsComparison:c.ngsComparison,warm:c.warmDiagnostic,residual,feasibility}));const stick=newton||(!freeJaw&&sweep%4===0?stickCandidate(solution,pressure,field):null);if(stick){trialBackup={toe:toe.map(v=>v.slice()),eta:new Map(toeEta),stops:new Map(c.jawStops)};trialResidual=residual;for(let i=0;i<toe.length;i++)toe[i]=stick[i];for(const side of toeEta.keys())toeEta.set(side,0);lastToe=null;frictionHistory.length=0;previousFriction=Infinity;warm=null;continue;}
          if(residual>Math.max(...frictionTrace.slice(0,-1).map(q=>q.residual))*2&&lastToe&&stepScale>1e-6){for(let i=0;i<toe.length;i++)toe[i]=mul(add(toe[i],lastToe[i]),.5);for(const [side,value]of lastEta)toeEta.set(side,((toeEta.get(side)||0)+value)/2);c.jawStops=new Map(lastStops);stepScale*=.5;frictionHistory.length=0;warm=null;continue;}
          previousFriction=residual;lastToe=toe.map(v=>v.slice());lastEta=new Map(toeEta);lastStops=new Map(c.jawStops);
          c.frictionDiagnostic={trace:frictionTrace,worst,active:contacts.flatMap((contact,i)=>solution.normalForces[i]>1e-10?[[i,solution.normalForces[i]]]:[]),modes:[...c.jawModes].map(([side,mode])=>({side,load:mode.load,extra:mode.extra,stop:mode.stop}))};
          for(let index=0;index<surfaceTangents.length;index++){
            const contact=surfaceTangents[index],h=contact.frame,mode=contact.jawMode,normal=contact.normal,oldForce=toe[index],{tangent,L,cap,response,jawAxis}=tangentState(index,positions,workingField,pressure);
            if(!(L>0))continue;let candidate=sub(oldForce,mul(tangent,stepScale/L)),length=len(candidate);if(length>cap)candidate=mul(candidate,cap/length);
            if(mode&&!mode.stop){const Jnormal=contacts.filter(q=>q.jawMode===mode).map(q=>q.jawJ),toeQ=surfaceTangents.reduce((sum,q,i)=>sum+(q.jawMode===mode?-dot(toe[i],mv(q.frame.pose.R,[0,q.jaw/2,0])):0),0),other=toeQ-dot(oldForce,jawAxis),axis=sub(jawAxis,mul(normal,dot(jawAxis,normal))),A=dot(axis,axis);for(const sign of [1,-1])if(A>1e-20&&Jnormal.every(q=>sign*q>=-1e-12)){
              const limit=mode.base.maxForce-sign*other,direction=mul(axis,sign),value=dot(candidate,direction);if(value>limit){const centre=mul(direction,limit/A),perpendicular=sub(candidate,mul(direction,value/A)),R2=cap*cap-limit*limit/A;if(R2< -1e-12){candidate=[0,0,0];controlChanged=true;continue;}const R=Math.sqrt(Math.max(0,R2)),T=len(perpendicular),projected=add(centre,T>0?mul(perpendicular,Math.min(1,R/T)):[0,0,0]),circle=T>R&&R>1e-15?(L/stepScale)*(T/R-1):0,dual=Math.max(0,((L/stepScale)*(value-limit)-circle*limit)/A),eta=sign*dual;candidate=projected;toeEta.set(h.side,(toeEta.get(h.side)||0)+eta);mode.extra+=eta;residual=Math.max(residual,Math.abs(eta)*Math.sqrt(A));}
            }}
            const delta=sub(candidate,oldForce);residual=Math.max(residual,(L/stepScale)*len(delta));toe[index]=candidate;
            if(contact.relative){const nodal=new Float64Array(ns.length*3);addSurfaceTangent(index,delta,nodal,workingField);const moved=c.materialForceResponse(nodal);for(let id=0;id<ns.length;id++)positions[id]=positions[id].map((v,k)=>v+moved[3*id+k]);}
            else{if(!response.z)response.z=c.materialResponse([frictionData[index].a]).z;for(let id=0;id<ns.length;id++)positions[id]=add(positions[id],mul(delta,response.z[0][response.order[id]]));addForce(workingField,h.body,contact.point,mul(delta,-1),h.side);}
            if(mode){mode.load+=dot(delta,jawAxis);const carrier=mode.base.carrierGap+jawOffset(mode);if(!mode.stop&&(carrier<mode.base.minGap-1e-12||carrier>mode.base.maxGap+1e-12)){mode.stop=carrier<mode.base.minGap?'low':'high';c.jawStops.set(h.side,mode.stop);toeEta.set(h.side,0);controlChanged=true;}}
          }
          if(!controlChanged&&[...c.jawModes.values()].every(mode=>!mode.stop&&Math.abs(mode.extra)<1e-15)){
            const trial=accelerateFriction(frictionHistory,lastToe.flat(),toe.flat()),proposed=toe.map((_,index)=>trial.slice(3*index,3*index+3));for(let index=0;index<proposed.length;index++){const cap=tangentState(index,positions,workingField,pressure).cap,F=len(proposed[index]);if(F>cap)proposed[index]=mul(proposed[index],cap/F);}
            const loads=new Map([...c.jawModes.values()].map(mode=>[mode,0]));surfaceTangents.forEach((contact,index)=>{if(contact.jawMode)loads.set(contact.jawMode,loads.get(contact.jawMode)+dot(proposed[index],frictionData[index].jawAxis));});
            if([...loads].every(([mode,Q])=>Math.abs(Q)<=mode.base.maxForce)){trialBackup={toe:toe.map(v=>v.slice()),eta:new Map(toeEta),stops:new Map(c.jawStops)};trialResidual=frictionResidual;for(let index=0;index<toe.length;index++)toe[index]=proposed[index];}
          }else frictionHistory.length=0;
          for(const [side,mode]of c.jawModes)if(!mode.stop){const Qtoe=surfaceTangents.reduce((sum,q,i)=>sum+(q.jawMode===mode?-dot(toe[i],mv(q.frame.pose.R,[0,q.jaw/2,0])):0),0);if(Math.abs(Qtoe)<mode.base.maxForce-1e-8&&Math.abs(toeEta.get(side)||0)>1e-15){residual=Math.max(residual,Math.abs(toeEta.get(side)));toeEta.set(side,0);controlChanged=true;}}

        }
        const fallback=c.strictContact?best:best||last;if(!accepted&&fallback){accepted=fallback.accepted;frictionResidual=fallback.residual;fallback.positions.forEach((p,id)=>{ns[id].p=p;});c.surfaceStats.unconverged=(c.surfaceStats.unconverged||0)+1;}if(!accepted)throw new Error('Cloth normal/tangent replacement did not converge: '+frictionResidual+' '+JSON.stringify({...c.frictionDiagnostic,stick:c.stickDiagnostic,newton:c.newtonDiagnostic}));
        const {solution,field,pressure}=accepted;c.surfaceResidual=solution.normalResidual;c.patchResidual=solution.pinResidual;c.patchFeasibility=solution.feasibility;c.frictionResidual=frictionResidual;c.surfaceStats.samples=Math.max(c.surfaceStats.samples,samples.length);c.surfaceStats.rows=Math.max(c.surfaceStats.rows,contacts.length);c.surfaceStats.applications=Math.max(c.surfaceStats.applications||0,solution.applications);c.surfaceStats.iterations=Math.max(c.surfaceStats.iterations,solution.iterations||0);c.bodyOffsets=new Map([...field].map(([body,value])=>[body,{translation:mul(value.force,bodies.get(body).im*dt*dt),rotation:mul(mv(bodies.get(body).inertia,value.torque),dt*dt)}]));
        attachments.forEach(a=>{a.lambda=[0,0,0];a.capacity=0;a.responsePoint=null;});jointPins.forEach((a,i)=>{a.lambda=mul(solution.forces[i],dt*dt);a.capacity=solution.caps?.[i]??pinData[i].cap;a.responsePoint=pinData[i].point.slice();});c.gripSupport={};for(const [side,pin]of pins){const Pside=pressure.get(side),loaded=G?Pside&&Pside[1]>0&&Pside[-1]>0:(W.hands[side]?.fabricForce||0)>0;pin.loaded=!!loaded&&jointPins.some(a=>a.side===side);if(pin.loaded){pin.acquired=true;c.touched.add(+side);if(c.foldStage===1){if(pin.throughFold)c.foldHands.add(+side);}else c.firstHands.add(+side);}c.gripSupport[side]={command:c.jawBaselines.get(side)?.maxForce??W.hands[side].fabricForce,pressure:Pside||{'1':0,'-1':0},capacity:jointPins.reduce((sum,a)=>sum+(a.side===side?a.capacity:0),0)};}
        const hasLoad=solution.normalForces.some(force=>force>1e-10)||solution.forces.some(force=>len(force)>1e-10)||toe.some(force=>len(force)>1e-10);if(hasLoad){const pinForces=new Map();jointPins.forEach((a,i)=>pinForces.set(a.pointRef,{body:W.hands[a.side].body,force:mt(W.handPose(a.side).R,solution.forces[i])}));const normalForces=descriptors.map((descriptor,i)=>({descriptor,force:Math.max(0,solution.normalForces[i]),tangent:null}));surfaceTangents.forEach((contact,i)=>{normalForces[contacts.indexOf(contact)].tangent=mt(contact.frame.pose.R,toe[i]);});c.acceptedContact={world:W,gripper:G,hands:Object.entries(W.hands).map(([side,h])=>[side,h.body]),generation:c.contactGeneration,normals:normalForces,pins:pinForces};}else c.acceptedContact=null;
        robotContacts.clear();for(const [body,value]of background)robotContacts.set(body,{...value,force:value.force.slice(),torque:value.torque.slice()});const queue=(body,point,force,side=null)=>{if(body&&!body.fixed)addForce(robotContacts,body,point,force,side);};
        contacts.forEach((contact,i)=>{const F=solution.normalForces[i];contact.lambda=F;if(F<=1e-10)return;if(contact.body)queue(contact.body,contact.point,mul(jacobians[i].direction,F),contact.h?.side??contact.side??null);else if(contact.table&&dot(contact.normal,up)>.9){tableReaction(contact.point,mul(contact.normal,F));const a=samples[contact.row[0][0]];a.ids.forEach((id,k)=>tablePush.set(id,(tablePush.get(id)||0)+F*a.w[k]*weights[id]*dt*dt));}});surfaceTangents.forEach((contact,i)=>{if(contact.table)tableReaction(contact.point,toe[i]);else if(!contact.relative)queue(contact.frame.body,contact.point,mul(toe[i],-1),contact.frame.side);});
        c.normalContacts=contacts.flatMap((contact,i)=>solution.normalForces[i]>1e-10?[{normal:contact.normal,force:solution.normalForces[i],jaw:contact.jaw,side:contact.h?.side??contact.side,kind:contact.state?'rubber':contact.h?'carrier':contact.table?'table':'layer'}]:[]);
      };
      // Spatial hash for self-contact and contact with the other towels (neighbouring mesh vertices excluded).
      const cell = radius * 2, hash = new Map(), hashKey = (x, y, z) => (x & 1023) | ((y & 1023) << 10) | ((z & 1023) << 20);
      for (const q of W.cloths) for (let j = 0; j < q.nodes.length; j++) {
        if (q === c) continue;
        const p = q.nodes[j].p, key = hashKey(Math.floor(p[0] / cell), Math.floor(p[1] / cell), Math.floor(p[2] / cell));
        if (!hash.has(key)) hash.set(key, []); hash.get(key).push({ p, j, other: true,radius:q.halfThickness||.0025 });
      }
      if(!shirt)ns.forEach((n, i) => {
        const xyz = n.p.map((v) => Math.floor(v / cell));
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let d = -1; d <= 1; d++) {
          const key = hashKey(xyz[0] + a, xyz[1] + b, xyz[2] + d);
          for (const q of hash.get(key) || []) {
            if (!q.other && neighbours[i].has(q.j)) continue;
            const delta = sub(n.p, q.p), L = len(delta);
            const separation=(q.other?radius+q.radius:cell)*(c.pile?.7:1);
            if (L > 1e-8 && L < separation && !attached.has(i)) { n.p = add(n.p, mul(delta, (separation - L) / L)); normalAt(i,mul(delta,1/L)); }
          }
        }
        const key = hashKey(...xyz); if (!hash.has(key)) hash.set(key, []); hash.get(key).push({ p: n.p, j: i, other: false });
        collide(n, i);

      });
      else ns.forEach(collide);
      // Build a local vertex/face candidate set once; solve it with stretch and attachment constraints,
      // so separating folded layers cannot leave a final, unsolved tensile strain.
      const sweep=Math.max(radius*2,...predicted.map((p,i)=>len(sub(p,old[i])))),facePadding=Math.max(radius*2+1e-5,sweep),faceCell=.025,faceKey=(x,y,z)=>x+','+y+','+z,surfacePairs=[];
      const uniqueSurfaceRows=()=>{const seen=new Set();let at=0;for(const pair of surfacePairs){if(pair.q===c){const row=new Map([[pair.i,1]]);pair.ids.forEach((id,k)=>row.set(id,(row.get(id)||0)-pair.contact.w[k]));const n=mul(pair.contact.n,pair.side),key=[...row].sort((a,b)=>a[0]-b[0]).flatMap(([id,w])=>{const v=n.map(x=>Math.round(x*w*1e12));return v.some(x=>x!==0)?[id,...v]:[];}).join(',');if(seen.has(key))continue;seen.add(key);}surfacePairs[at++]=pair;}surfacePairs.length=at;};
      const buildSurface=()=>{
        surfacePairs.length=0;
        if(shirt&&W.cloths.length===1){
          const relative=ns.map(n=>sub(n.p,ns[0].p)),previous=old.map(p=>sub(p,old[0])),drift0=sub(predicted[0],old[0]),motion=Math.max(...predicted.map((p,i)=>len(sub(sub(p,old[i]),drift0)))),last=c.surfacePose,change=last?Math.max(...relative.map((p,i)=>len(sub(p,last[i])))):Infinity;
          if(change<1e-7&&motion<1e-7&&c.surfaceManifold){for(const pair of c.surfaceManifold)surfacePairs.push({...pair,lambda:0});return;}
          const topology=c.surfaceFaces||(c.surfaceFaces=Array.from({length:triangles.length/3},(_,i)=>triangles.slice(3*i,3*i+3))),cache=c.surfaceBroadphase,padding=Math.max(.006,Math.ceil(motion/.002)*.004),cacheChange=cache?Math.max(...relative.map((p,i)=>len(sub(p,cache.reference[i])))):Infinity;
          if(!cache||cacheChange+motion>(cache.padding-2*radius)/2||padding>cache.padding){
            const bounds=topology.map((ids,id)=>({id,min:[0,1,2].map(k=>Math.min(...ids.map(i=>Math.min(relative[i][k],previous[i][k])))),max:[0,1,2].map(k=>Math.max(...ids.map(i=>Math.max(relative[i][k],previous[i][k]))))})),span=[0,1,2].map(k=>Math.max(...relative.map(p=>p[k]))-Math.min(...relative.map(p=>p[k]))),axis=span.indexOf(Math.max(...span)),other=[0,1,2].filter(k=>k!==axis),vertices=ns.map((_,i)=>({i,min:[0,1,2].map(k=>Math.min(relative[i][k],previous[i][k])),max:[0,1,2].map(k=>Math.max(relative[i][k],previous[i][k]))})),candidates=ns.map(()=>[]);
            if(!c.surfaceExcluded){const incident=ns.map(()=>[]);topology.forEach((ids,t)=>ids.forEach(i=>incident[i].push(t)));c.surfaceExcluded=ns.map((_,i)=>{const excluded=new Set();for(const j of neighbours[i])if(Math.floor(i/panelSize)===Math.floor(j/panelSize))for(const face of incident[j])excluded.add(face);return excluded;});}
            bounds.sort((a,b)=>a.min[axis]-b.min[axis]);vertices.sort((a,b)=>a.min[axis]-b.min[axis]);let first=0;let active=[];
            for(const vertex of vertices){while(first<bounds.length&&bounds[first].min[axis]<=vertex.max[axis]+padding)active.push(bounds[first++]);active=active.filter(face=>face.max[axis]>=vertex.min[axis]-padding);for(const face of active){if(c.surfaceExcluded[vertex.i].has(face.id)||vertex.min[other[0]]>face.max[other[0]]+padding||vertex.max[other[0]]<face.min[other[0]]-padding||vertex.min[other[1]]>face.max[other[1]]+padding||vertex.max[other[1]]<face.min[other[1]]-padding)continue;candidates[vertex.i].push(face.id);}}
            c.surfaceBroadphase={reference:relative.map(p=>p.slice()),padding,candidates};
          }
          for(let i=0;i<ns.length;i++){
            const nearby=[];
            for(const id of c.surfaceBroadphase.candidates[i]){const ids=topology[id],near=faceContact(ns[i].p,ns[ids[0]].p,ns[ids[1]].p,ns[ids[2]].p)||faceContact(predicted[i],predicted[ids[0]],predicted[ids[1]],predicted[ids[2]]);if(!near||Math.abs(near.d)>Math.max(2*radius+1e-5,motion))continue;const before=dot(sub(old[i],ids.reduce((p,id,k)=>add(p,mul(old[id],near.w[k])),[0,0,0])),near.n);nearby.push({i,q:c,ids,contact:near,side:before<0?-1:1,lambda:0,score:Math.abs(near.d)});}
            nearby.sort((a,b)=>a.score-b.score);surfacePairs.push(...nearby.slice(0,4));
          }
          uniqueSurfaceRows();c.surfacePose=relative;c.surfaceManifold=surfacePairs.map(pair=>({...pair,lambda:0}));return;
        }
        const faceHash=new Map(),faces=[];
      for(const q of W.cloths)for(let t=0;t<q.triangles.length;t+=3){
        const ids=q.triangles.slice(t,t+3),ps=ids.map(i=>q.nodes[i].p),id=faces.length,padding=Math.max(facePadding,radius+(q.halfThickness||.0025)),min=[0,1,2].map(k=>Math.min(...ps.map(p=>p[k]))-padding),max=[0,1,2].map(k=>Math.max(...ps.map(p=>p[k]))+padding);faces.push({q,ids,min,max,padding});
        const lo=min.map(v=>Math.floor(v/faceCell)),hi=max.map(v=>Math.floor(v/faceCell));
        for(let x=lo[0];x<=hi[0];x++)for(let y=lo[1];y<=hi[1];y++)for(let z=lo[2];z<=hi[2];z++){const key=faceKey(x,y,z);if(!faceHash.has(key))faceHash.set(key,[]);faceHash.get(key).push(id);}
      }
      for(let i=0;i<ns.length;i++){
        const nearby=[];
        for(const id of faceHash.get(faceKey(...ns[i].p.map(v=>Math.floor(v/faceCell))))||[]){
          const face=faces[id];if(ns[i].p.some((v,k)=>v<face.min[k]||v>face.max[k])||face.q===c&&face.ids.some(j=>neighbours[i].has(j)&&(!shirt||Math.floor(i/panelSize)===Math.floor(j/panelSize))))continue;
          const near=faceContact(ns[i].p,...face.ids.map(j=>face.q.nodes[j].p));if(!near||Math.abs(near.d)>face.padding)continue;
          const before=face.q===c?faceContact(old[i],...face.ids.map(j=>old[j]),.3):near;
          nearby.push({i,...face,contact:near,side:(before?.d??near.d)<0?-1:1,lambda:0,score:Math.abs(near.d)});
        }
        // A surface particle needs its nearest layers, not every overlapping triangle's duplicate contact.
        nearby.sort((a,b)=>a.score-b.score);surfacePairs.push(...nearby.slice(0,4));
      }
      uniqueSurfaceRows();
      };
      buildSurface();
      // A table support removes only motion into its normal. Locking all three
      // coordinates would give tilted layer normals a fictitious lateral anchor.
      const solveLayer=(pair,ids,coeff,normal,distance,thickness,alpha=0)=>{
        let row=pair.contact?pair.contact.solver:pair.solver;
        if(!row){row={ids,coeff,normal,nodes:ids.map((id,k)=>id===null?pair.q.nodes[pair.ids[k-1]]:ns[id]),gradient:new Float64Array(ids.length*3),direction:new Float64Array(ids.length*3),mass:new Float64Array(ids.length)};for(let i=0;i<ids.length;i++)for(let k=0;k<3;k++)row.gradient[3*i+k]=coeff[i]*normal[k];if(pair.contact)pair.contact.solver=row;else pair.solver=row;}
        const count=row.ids.length,g=row.gradient,d=row.direction,mass=row.mass,nodes=row.nodes;let denom=0;
        for(let i=0;i<count;i++){const id=row.ids[i],at=3*i,vertical=g[at]*up[0]+g[at+1]*up[1]+g[at+2]*up[2],blocked=id!==null&&tablePush.has(id)&&vertical<0;mass[i]=id===null?0:(!shirt&&attached.has(id)?0:weights[id]);for(let k=0;k<3;k++)d[at+k]=g[at+k]-(blocked?up[k]*vertical:0);denom+=mass[i]*(g[at]*d[at]+g[at+1]*d[at+1]+g[at+2]*d[at+2]);}
        if(denom<1e-15)return;
        const previous=pair.lambda||0,next=Math.max(0,previous+(thickness-distance-alpha*previous)/(denom+alpha)),dl=next-previous;pair.lambda=next;
        if(dl!==0)for(let i=0;i<count;i++)if(mass[i]){const at=3*i,scale=mass[i]*dl,p=nodes[i].p;for(let k=0;k<3;k++)p[k]+=d[at+k]*scale;if(g[at]*up[0]+g[at+1]*up[1]+g[at+2]*up[2]<0)supportLoad(row.ids[i],[g[at],g[at+1],g[at+2]],scale);}
        if(!shirt||pair.q&&pair.q!==c)return;
        let rx=0,ry=0,rz=0;for(let i=0;i<count;i++){const p=nodes[i].p,before=old[row.ids[i]],w=row.coeff[i];rx+=w*(p[0]-before[0]);ry+=w*(p[1]-before[1]);rz+=w*(p[2]-before[2]);}
        const along=rx*normal[0]+ry*normal[1]+rz*normal[2],tx=rx-along*normal[0],ty=ry-along*normal[1],tz=rz-along*normal[2],T=Math.hypot(tx,ty,tz);if(T<1e-12)return;
        const ax=tx/T,ay=ty/T,az=tz/T;let frictionMobility=0;
        for(let i=0;i<count;i++){const w=row.coeff[i],x=-w*ax,y=-w*ay,z=-w*az,vertical=x*up[0]+y*up[1]+z*up[2],blocked=tablePush.has(row.ids[i])&&vertical<0;frictionMobility-=mass[i]*w*(ax*(x-(blocked?up[0]*vertical:0))+ay*(y-(blocked?up[1]*vertical:0))+az*(z-(blocked?up[2]*vertical:0)));}
        if(frictionMobility<1e-15)return;
        const before=pair.friction||(pair.friction=[0,0,0]),travel=T/frictionMobility,cx=before[0]+ax*travel,cy=before[1]+ay*travel,cz=before[2]+az*travel,length=Math.hypot(cx,cy,cz),limit=c.selfFriction*next,scale=length>limit?limit/length:1,nx=cx*scale,ny=cy*scale,nz=cz*scale,ix=nx-before[0],iy=ny-before[1],iz=nz-before[2];before[0]=nx;before[1]=ny;before[2]=nz;
        for(let i=0;i<count;i++)if(mass[i]){const w=-row.coeff[i],x=w*ix,y=w*iy,z=w*iz,vertical=x*up[0]+y*up[1]+z*up[2],blocked=tablePush.has(row.ids[i])&&vertical<0,p=nodes[i].p;p[0]+=(x-(blocked?up[0]*vertical:0))*mass[i];p[1]+=(y-(blocked?up[1]*vertical:0))*mass[i];p[2]+=(z-(blocked?up[2]*vertical:0))*mass[i];if(blocked)supportLoad(row.ids[i],[x,y,z],mass[i]);}
      };
      const solveSurface=()=>{
        for(const pair of surfacePairs){
          if(commonTableOwned&&pair.q===c&&(owns(pair.i)||pair.ids.some(owns)))continue;
          const {i,q,ids}=pair,w=pair.contact.w,n=pair.contact.n,sgn=pair.side,nx=n[0]*sgn,ny=n[1]*sgn,nz=n[2]*sgn,a=ns[i].p,b=q.nodes[ids[0]].p,d=q.nodes[ids[1]].p,e=q.nodes[ids[2]].p;
          const distance=(a[0]-b[0]*w[0]-d[0]*w[1]-e[0]*w[2])*nx+(a[1]-b[1]*w[0]-d[1]*w[1]-e[1]*w[2])*ny+(a[2]-b[2]*w[0]-d[2]*w[1]-e[2]*w[2])*nz;
          const thickness=radius+(q.halfThickness||.0025);if(distance>=thickness&&!pair.lambda)continue;
          solveLayer(pair,[i,...ids.map(id=>q===c?id:null)],[1,...w.map(v=>-v)],[nx,ny,nz],distance,thickness,((c.layerCompliance+(q.layerCompliance||0))/2)/(dt*dt));
          hits.add(i);if(q===c)ids.forEach(id=>hits.add(id));
        }
      };
      const edgePairs=[];
      const buildEdges=()=>{
        const priorPairs=c.edgePairs?c.edgePairs.slice():[];
        edgePairs.length=0;
      if(shirt){
        const meshEdges=c.meshEdges||(c.meshEdges=edges.filter(e=>e.kind==='mesh')),relative=ns.map(n=>sub(n.p,ns[0].p)),previous=old.map(p=>sub(p,old[0])),last=c.edgePose||material.map(p=>sub(p,material[0])),change=Math.max(...relative.map((p,i)=>len(sub(p,last[i])))),drift0=sub(predicted[0],old[0]),relativeSweep=Math.max(...predicted.map((p,i)=>len(sub(sub(p,old[i]),drift0))));
        // A common translation cannot create an edge crossing. Reuse the broad
        // phase until relative deformation consumes its conservative margin.
        if(change>1e-7||relativeSweep>1e-7){
          const padding=Math.max(.008,Math.ceil((relativeSweep*2+2*radius)/.004)*.004),cache=c.edgeBroadphase,cacheChange=cache?Math.max(...relative.map((p,i)=>len(sub(p,cache.reference[i])))):Infinity;
          if(!cache||cacheChange+relativeSweep>cache.padding/2||padding>cache.padding){
            const candidates=[],bounds=meshEdges.map((e,index)=>({index,min:[0,1,2].map(k=>Math.min(relative[e.a][k],relative[e.b][k],previous[e.a][k],previous[e.b][k])),max:[0,1,2].map(k=>Math.max(relative[e.a][k],relative[e.b][k],previous[e.a][k],previous[e.b][k]))})),span=[0,1,2].map(k=>Math.max(...relative.map(p=>p[k]))-Math.min(...relative.map(p=>p[k]))),axis=span.indexOf(Math.max(...span)),other=[0,1,2].filter(k=>k!==axis),margin=2*padding;
            if(!c.edgeExcluded){const incident=ns.map(()=>[]);meshEdges.forEach((e,i)=>{incident[e.a].push(i);incident[e.b].push(i);});c.edgeExcluded=meshEdges.map(e=>{const excluded=new Set();for(const i of[e.a,e.b])for(const j of neighbours[i])if(Math.floor(i/panelSize)===Math.floor(j/panelSize))for(const edge of incident[j])excluded.add(edge);return excluded;});}
            bounds.sort((a,b)=>a.min[axis]-b.min[axis]);
            // Sweep the longest material extent. This generates each candidate
            // once, without per-cell arrays, string keys or duplicate pair sets.
            for(let i=0;i<bounds.length;i++)for(let j=i+1;j<bounds.length&&bounds[j].min[axis]<=bounds[i].max[axis]+margin;j++){
              const a=bounds[i],b=bounds[j];if(c.edgeExcluded[a.index].has(b.index)||a.min[other[0]]>b.max[other[0]]+margin||b.min[other[0]]>a.max[other[0]]+margin||a.min[other[1]]>b.max[other[1]]+margin||b.min[other[1]]>a.max[other[1]]+margin)continue;
              candidates.push(a.index>b.index?[a.index,b.index]:[b.index,a.index]);
            }
            c.edgeBroadphase={reference:relative.map(p=>p.slice()),padding,candidates};
          }
          const active=new Set(priorPairs.filter(p=>p.lambda>0).map(p=>p.key)),limit=Math.max(2*radius+1e-5,relativeSweep);for(const [i,j]of c.edgeBroadphase.candidates){const e=meshEdges[i],f=meshEdges[j],near=edgeContact(predicted[e.a],predicted[e.b],predicted[f.a],predicted[f.b],limit)||edgeContact(ns[e.a].p,ns[e.b].p,ns[f.a].p,ns[f.b].p,limit);if(!near)continue;const before=near.w[0]*dot(old[e.a],near.n)+near.w[1]*dot(old[e.b],near.n)+near.w[2]*dot(old[f.a],near.n)+near.w[3]*dot(old[f.b],near.n),side=before<0?-1:1,key=i*meshEdges.length+j;if(!active.has(key)&&before*near.d>=0&&(Math.abs(before)<=2*radius+1e-6||Math.abs(near.d)>=2*radius))continue;edgePairs.push({key,ids:[e.a,e.b,f.a,f.b],w:near.w,n:mul(near.n,side),lambda:0});}
        }else for(const pair of priorPairs)edgePairs.push({...pair,lambda:0});
        c.edgePose=relative;c.edgePairs=edgePairs;
      }
      };
      buildEdges();
      const solveEdges=()=>{
        for(const pair of edgePairs){if(commonTableOwned&&pair.ids.some(owns))continue;
          const distance=pair.ids.reduce((s,id,k)=>s+pair.w[k]*dot(ns[id].p,pair.n),0);if(distance>=2*radius&&!pair.lambda)continue;
          solveLayer(pair,pair.ids,pair.w,pair.n,distance,2*radius);
        }
      };
      const tableFriction=new Map();
      const solveTableFriction=()=>{
        for(const [i,normal]of tablePush)if((shirt||!attached.has(i))&&!(commonTableOwned&&owns(i))){
          const delta=mt(table.R,sub(ns[i].p,old[i])),previous=tableFriction.get(i)||[0,0],candidate=[previous[0]+delta[0],previous[1]+delta[1]],L=Math.hypot(...candidate),scale=L>0?Math.min(1,(shirt?c.friction:.75)*normal/L):1,next=candidate.map(v=>v*scale);
          const correction=mv(table.R,[next[0]-previous[0],next[1]-previous[1],0]);ns[i].p=sub(ns[i].p,correction);if(weights[i])tableReaction(ns[i].p,mul(correction,-1/(weights[i]*dt*dt)));tableFriction.set(i,next);
        }
      };
      for (let it = 0; it < iterations; it++) {
        if(shirt){solveMaterial(predicted);robotContacts.clear();c.surfaceTableWrench={force:[0,0,0],torque:[0,0,0]};tablePush.clear();tableFriction.clear();const moved=(cache)=>cache&&ns.some((n,i)=>len(sub(sub(n.p,ns[0].p),cache.reference[i]))>(cache.padding-2*radius)/2);if(moved(c.surfaceBroadphase))buildSurface();if(moved(c.edgeBroadphase))buildEdges();for(const pair of [...surfacePairs,...edgePairs]){pair.lambda=0;pair.friction=[0,0,0];}}
        else {
          for (const e of edges) {
            const a=ns[e.a],b=ns[e.b],d=sub(a.p,b.p),L=len(d);if(L<1e-9)continue;
            const wa=weights[e.a],wb=weights[e.b],alpha=e.compliance/(dt*dt),dl=(-(L-e.rest)-alpha*e.lambda)/(wa+wb+alpha);e.lambda+=dl;
            a.p=add(a.p,mul(d,wa*dl/L));b.p=add(b.p,mul(d,-wb*dl/L));
          }
          applyPins();
        }
        commonOwnershipRetry=false;if(shirt&&!commonTableOwned&&needsCommonTable()){commonTableOwned=true;ownCommon();}
        ns.forEach(collide);solveSurface();solveEdges();solveTableFriction();if(shirt)collideHandSurfaces();
        if(commonOwnershipRetry){it--;continue;}
      }
      if(!shirt){applyPins();ns.forEach(collide);solveTableFriction();}
      if(shirt)for(const [side,mode]of c.jawModes){
        const h=W.hands[side],R=W.handPose(side).R,states=c.padStates.get(h.body),compression=Object.fromEntries([-1,1].map(jaw=>[jaw,states?.get(jaw)?mul(mt(R,states.get(jaw).force),1/mode.base.padStiffness):[0,0,0]])),pressure=Object.fromEntries([-1,1].map(jaw=>[jaw,states?.get(jaw)?.innerPressure||0])),carrierGap=mode.base.carrierGap+jawOffset(mode);
        try{W.applyJawActuator(side,mode.base,{carrierGap,padCompression:compression,load:mode.load,pressure});}catch(error){c.acceptedContact=null;throw error;}c.handGeometry.set(side,handGeometry(G,h));
      }
      const activeAttachment=a=>W.hands[a.side].fabricForce>0&&pins.get(a.side)?.points.includes(a.pointRef);

      if(shirt){c.gripResidual=0;for(const a of attachments)if(activeAttachment(a)){const h=W.hands[a.side],R=W.handPose(a.side).R,normal=[R[1],R[4],R[7]],offset=c.bodyOffsets?.get(h.body),target=offset?add(a.target,add(offset.translation,cross(offset.rotation,sub(a.target,h.body.t)))):a.target,error=sub(target,a.ids.reduce((p,id,k)=>add(p,mul(ns[id].p,a.w[k])),[0,0,0])),raw=mul(sub(error,mul(normal,dot(error,normal))),PAD_STIFFNESS/pins.get(a.side).points.length),cap=a.capacity??0,L=len(raw),physical=L>cap?mul(raw,cap/L):raw;c.gripResidual=Math.max(c.gripResidual,len(sub(physical,mul(a.lambda,1/(dt*dt)))));}}
      // The contact solve already includes each body's same-step mobility.
      // Commit its complete surface/attachment wrench once, about the same
      // frozen COM; queuing it for the next rigid step would count it twice.
      const bodyWrenches=new Map(),bodyCommits=new Map(),addWrench=(body,force,torque)=>{const value=bodyWrenches.get(body)||{force:[0,0,0],torque:[0,0,0]};value.force=add(value.force,force);value.torque=add(value.torque,torque);bodyWrenches.set(body,value);};
      if(shirt){
        for(const [body,contact]of robotContacts){frozenBody(body);addWrench(body,contact.force,contact.torque);}
        for(const a of attachments){const force=mul(a.lambda,-1/(dt*dt));if(len(force)<1e-12)continue;const body=W.hands[a.side].body,point=a.responsePoint||a.ids.reduce((p,id,k)=>add(p,mul(ns[id].p,a.w[k])),[0,0,0]);addWrench(body,force,cross(sub(point,frozenBody(body).position),force));}
        for(const [body,wrench]of bodyWrenches){const state=frozenBody(body);if(state.token&&W.applyDeformableResponse)bodyCommits.set(body,W.applyDeformableResponse(state.token,wrench));else reactWrench(body,wrench.force,wrench.torque,dt);}
        c.bodyOffsets=null;
        for(const [side,pin]of pins)trimPin(side,W.hands[side],pin,W.handPose(side));
        for(const [body,contact]of robotContacts)if(contact.side!==null){const r=c.reactions[contact.side]||(c.reactions[contact.side]={force:[0,0,0],torque:[0,0,0],load:0,at:contact.at}),translation=bodyCommits.get(body)?.translation||[0,0,0];r.force=add(r.force,contact.force);r.torque=add(r.torque,sub(contact.torque,cross(translation,contact.force)));r.load=len(r.force);}
      }
      // Recompute velocities after all contact projections, rather than feeding a late correction into the next step.
      ns.forEach((n,i)=>{n.v=mul(sub(n.p,old[i]),Math.exp(-(shirt?(spec.air_drag??.35):.9)*dt)/dt);});
      // Layer contacts remove only closing relative normal velocity. Projecting each
      // layer against the world would incorrectly stop a freely falling sewn garment.
      const closeLayerVelocity=(ids,coeff,normal)=>{const gradient=coeff.map(v=>mul(normal,v)),direction=gradient.map((v,k)=>supportedDirection(ids[k],v)),denom=ids.reduce((v,id,k)=>v+weights[id]*dot(gradient[k],direction[k]),0),vn=ids.reduce((v,id,k)=>v+coeff[k]*dot(ns[id].v,normal),0);if(vn<0&&denom>0)for(let k=0;k<ids.length;k++){ns[ids[k]].v=sub(ns[ids[k]].v,mul(direction[k],vn*weights[ids[k]]/denom));const vertical=dot(gradient[k],up);if(tablePush.has(ids[k])&&vertical<0)tableReaction(ns[ids[k]].p,mul(up,vertical*vn/(denom*dt)));}};
      if(shirt)for(const pair of surfacePairs)if(pair.q===c&&pair.lambda>0)closeLayerVelocity([pair.i,...pair.ids],[1,...pair.contact.w.map(v=>-v)],mul(pair.contact.n,pair.side));
      if(shirt)for(const pair of edgePairs)if(pair.lambda>0)closeLayerVelocity(pair.ids,pair.w,pair.n);
      ns.forEach((n,i)=>{for(const normal of contactNormals.get(i)||[]){const vn=dot(n.v,normal);if(!shirt||vn<0)n.v=sub(n.v,mul(normal,(shirt?1:.85)*vn));}if(!shirt&&hits.has(i)){const v=mt(table.R,n.v);v[0]*=.82;v[1]*=.82;n.v=mv(table.R,v);}const speed=len(n.v),cap=shirt?8:2;if(speed>cap)n.v=mul(n.v,cap/speed);});
      // Fabric keeps a crease: once released, where both ends of a bending link lie against something (table
      // or another layer), its rest length creeps toward the current shape, so a fold drapes smoothly while
      // moving yet stays folded. Held or hanging fabric takes no set; stretch and shear never creep.
      if(bendMemory&&!pins.size)for(const e of edges)if(e.compliance>=1e-6&&hits.has(e.a)&&hits.has(e.b)){const L=len(sub(ns[e.a].p,ns[e.b].p));e.rest=Math.max(e.rest0*.2,Math.min(e.rest0,e.rest+(L-e.rest)*Math.min(1,bendMemory*dt)));}
      const rollTorque={};
      for (const a of attachments) {
        const force=mul(a.lambda,1/(dt*dt)),onHand=mul(force,-1),point=a.ids.reduce((p,i,k)=>add(p,mul(ns[i].p,a.w[k])),[0,0,0]);
        if(shirt&&len(force)<1e-12)continue;
        if(shirt&&!activeAttachment(a))continue;
        const r=c.reactions[a.side]||(c.reactions[a.side]={force:[0,0,0],torque:[0,0,0],load:0,at:point});
        const currentPin=pins.get(a.side),patchCentre=currentPin.points.filter((_,i)=>i%3===0).reduce((p,q)=>add(p,q.ids.reduce((v,id,k)=>add(v,mul(ns[id].p,q.w[k]/currentPin.layers)),[0,0,0])),[0,0,0]);
        rollTorque[a.side]=(rollTorque[a.side]||0)+mt(W.handPose(a.side).R,cross(sub(point,patchCentre),onHand))[1];
        const torque=cross(sub(shirt?a.responsePoint||point:point,W.hands[a.side].body.t),onHand);r.force=add(r.force,onHand);r.torque=add(r.torque,torque);r.load=len(r.force);if(!shirt)Cable.react(W.hands[a.side].body,onHand,point,dt);
      }
      // Unresolved bending inside a terry pad patch yields under the measured contact moment.
      // Translation and sideways twist remain constrained; no fabric node follows a task target.
      if(c.pile)for(const [side,pin]of pins){const torque=rollTorque[side]||0,rate=Math.sign(torque)*Math.min(3,600*Math.max(0,Math.abs(torque)-.0004));pin.roll+=rate*dt;}
      for(const [side,pin] of pins){const pose=W.handPose(side);const centre=pin.points.filter((_,i)=>i%3===0).reduce((p,q)=>add(p,q.ids.reduce((v,id,k)=>add(v,mul(ns[id].p,q.w[k]/pin.layers)),[0,0,0])),[0,0,0]);if(len(sub(centre,add(pose.t,mv(pose.R,pin.local))))>.035){pins.delete(side);delete W.hands[side].fabricGap;W.hands[side].fabricForce=0;W.hands[side].clothSlip=!!(pin.acquired||pin.loaded);}}
      if (ns.every((n) => n.p[2] < table.t[2] - 0.15) && pins.size === 0) { c.reset(); W.respawns++; }
      c.contactStepComplete=true;
    };
    return c;
  }
  // Opposite edges must overlap along their whole length. A crumpled bundle cannot pass as a folded towel.
  function folded(c) {
    if(c.kind==='shirt')return shirtFolded(c);
    const ns = c.nodes, N = c.N, mean = (pairs) => pairs.reduce((s, [a, b]) => s + len(sub(ns[a].p, ns[b].p)), 0) / pairs.length;
    const x = mean(Array.from({ length: N }, (_, j) => [j * N, j * N + N - 1]));
    const y = mean(Array.from({ length: N }, (_, i) => [i, (N - 1) * N + i]));
    const ps=ns.map(n=>mt(c.table.R,sub(n.p,c.table.t))),flat=[0,1,2].map(i=>Math.max(...ps.map(p=>p[i]))-Math.min(...ps.map(p=>p[i])));
    const thick=c.halfThickness*2,tolerance=Math.max(.035,thick*5,c.pile?Math.min(c.width,c.height)*.16:0),compact=flat[2]<Math.max(.045,thick*(c.pile?7:5.5));
    const first=x<tolerance,second=y<tolerance;
    // A quarter fold has two aligned pairs of edges and a spread footprint: crushed balls cannot pass.
    const quarter=mean(Array.from({length:N},(_,j)=>[j*N+Math.floor(N/2),j*N]));
    const quarters=Array.from({length:4},()=>({sum:[0,0,0],mass:0}));
    ps.forEach((p,i)=>{const q=quarters[Math.min(3,Math.floor((i%N)/(N-1)*4))],m=1/c.weights[i];q.sum=add(q.sum,mul(p,m));q.mass+=m;});
    const centres=quarters.map(q=>mul(q.sum,1/q.mass)),overlap=Math.max(...centres.flatMap(a=>centres.map(b=>Math.hypot(a[0]-b[0],a[1]-b[1]))));
    if(c.foldAxes==='xx')return {x:first,y:second,compact,edges:[x,quarter],span:flat,overlap,complete:x<Math.max(tolerance,c.width/4,3*(thick+2*c.pile))&&quarter<Math.max(tolerance,c.width/4,3*(thick+2*c.pile))&&overlap<Math.max(.035,c.width*.25)&&compact&&flat[0]>c.width*.14&&flat[0]<c.width*.5+(thick+2*c.pile)*2&&flat[1]>c.height*.75&&flat[1]<c.height*1.15};
    const spread=flat[0]>c.width*.28&&flat[1]>c.height*.28&&flat[0]<c.width*.72&&flat[1]<c.height*.72;
    return { x:first,y:second,compact,edges:[x,y],span:flat,complete:first&&second&&compact&&spread };

  }
  function shirtFolded(c) {
    const ps=c.nodes.map(n=>mt(c.table.R,sub(n.p,c.table.t))),m=c.landmarks;
    const shoulder=m.shoulders.map(i=>ps[i]),mid=mul(add(...shoulder),.5),axis=sub(shoulder[0],shoulder[1]),length=len(axis),across=mul(axis,1/Math.max(.001,length));
    const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),sleeves=m.sleeves.map((ids,k)=>Math.abs(dot(sub(ps[m.cuffs[k]],mid),across))<c.bodySpan*.55&&ids.every(i=>Math.abs(dot(sub(ps[i],mid),across))<c.bodySpan/2+.025));
    const hem=m.hem.map((i,k)=>len(sub(ps[i],shoulder[k]))),span=[0,1,2].map(k=>Math.max(...ps.map(p=>p[k]))-Math.min(...ps.map(p=>p[k])));
    const body=m.hem.every((i,k)=>{const d=sub(ps[i],shoulder[k]);return Math.hypot(d[0],d[1])<.045&&Math.abs(d[2])<.04;}),compact=span[2]<.045,spread=length>c.bodySpan*.6&&span[0]>.075&&span[0]<c.width*.72&&span[1]>.11&&span[1]<c.bodySpan*1.35;
    return {x:body,y:false,body,sleeves,compact:compact&&spread,edges:hem,span,complete:body&&sleeves.every(Boolean)&&compact&&spread};
  }
  // Actual material handles and destinations, shared by hints and physical playthroughs.
  function handles(c){return [1,-1].map(side=>{
    const row=side===1?c.N-1:0,a=c.nodes[row*c.N].p,b=c.nodes[row*c.N+c.N-1].p,second=c.foldStage===1;
    return {side,point:second?mul(add(a,b),.5):b.slice(),target:(second?c.nodes[row*c.N+Math.floor(c.N/2)].p:a).slice()};
  });}
  function energy(c){
    const out={warp:0,weft:0,shear:0,bend:0,total:0};
    for(const m of c.membranes||[]){const x=[0,0,0],y=[0,0,0];for(let i=0;i<3;i++)for(let k=0;k<3;k++){x[k]+=m.gx[i]*c.nodes[m.ids[i]].p[k];y[k]+=m.gy[i]*c.nodes[m.ids[i]].p[k];}const X=len(x),Y=len(y),S=len(add(x,y)),D=len(sub(x,y));out.warp+=.5*(X-1)**2/m.compliance[0];out.weft+=.5*(Y-1)**2/m.compliance[1];out.shear+=(S-D)**2/(4*m.compliance[2]);}
    for(const b of c.bends||[]){const value=[0,0,0];b.ids.forEach((id,i)=>{for(let k=0;k<3;k++)value[k]+=b.k[i]*c.nodes[id].p[k];});out.bend+=.5*dot(value,value)/b.compliance;}
    out.total=out.warp+out.weft+out.shear+out.bend;return out;
  }
  return { handles, cuffCenter, faceContact, edgeContact, energy, accelerateFriction, PAD_STIFFNESS, PAD_NORMAL_STIFFNESS, towel, shirt:(spec,table)=>towel({...spec,kind:'shirt'},table),swatch:(spec,table)=>towel({...spec,kind:'shirt',pattern:'swatch'},table), folded, radius, N };
});
