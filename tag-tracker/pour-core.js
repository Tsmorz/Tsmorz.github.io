// Conserved beer volume and momentum: hydrostatic discharge, finite falling parcels,
// and damped planar slosh. The air/glug and foam closures are reduced empirical
// models, not compressible-air, bubble-resolved or free-surface CFD. No DOM.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./tracker-core.js'));
  else root.PourCore = factory(root.TagCore);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';
  const G = 9.81, TAU = 2 * Math.PI;
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  // A container's inside is a stack of upright cylindrical sections {z0, z1, r} from its inner floor (z = 0) up to its
  // mouth, the top section's rim: one for a mug, body + stepped shoulder + neck for a bottle.
  const cylinder = (r, h) => ({ sections: [{ z0: 0, z1: h, r }] });
  const mouth = (s) => s.sections[s.sections.length - 1];
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  // Analytic circular-segment area and its axial antiderivative. Unlike a finite disc
  // sample grid these remain continuous when the bottle's axis passes through horizontal.
  function discArea(r,c){const u=clamp(c/r,-1,1);return r*r*(Math.asin(u)+Math.PI/2+u*Math.sqrt(Math.max(0,1-u*u)));}
  function discPrimitive(u){if(u<=-1)return 0;if(u>=1)return Math.PI*u;const q=Math.sqrt(1-u*u);return u*(Math.asin(u)+Math.PI/2)+q-q*q*q/3;}
  const GX=[-.9602898564975363,-.7966664774136267,-.525532409916329,-.1834346424956498,.1834346424956498,.525532409916329,.7966664774136267,.9602898564975363];
  const GW=[.1012285362903763,.2223810344533745,.3137066458778873,.362683783378362,.362683783378362,.3137066458778873,.2223810344533745,.1012285362903763];
  // Liquid volume (m³) on n·p ≤ d inside a stack of cylindrical sections.
  function volumeBelow(n, d, shape) {
    let V = 0;const s=Math.hypot(n[0],n[1]);
    for (const { z0, z1, r } of shape.sections) {
      const h=z1-z0,area=Math.PI*r*r;
      if(s<1e-12){const wet=clamp(d/n[2]-z0,0,h);V+=area*(n[2]>0?wet:h-wet);}
      else if(Math.abs(n[2])*h<s*r*1e-4){for(let k=0;k<GX.length;k++){const z=(z0+z1)/2+GX[k]*h/2;V+=GW[k]*h/2*discArea(r,(d-n[2]*z)/s);}}
      else V+=r*r*s*r/n[2]*(discPrimitive((d-n[2]*z0)/(s*r))-discPrimitive((d-n[2]*z1)/(s*r)));
    }
    return Math.max(0,V);
  }
  // The lowest point of the mouth's rim along n (local), where liquid leaves first, and the volume then held.
  function spout(n, shape) {
    const { r, z1 } = mouth(shape);
    const s=Math.hypot(n[0],n[1]),p=s>1e-12?[-r*n[0]/s,-r*n[1]/s,z1]:[r,0,z1],d=dot(n,p);
    return {p,d,capacity:volumeBelow(n,d,shape)};
  }
  // The plane offset d at which the container holds volume V with its surface normal n (local).
  function level(n, V, shape) {
    let lo = Infinity, hi = -Infinity;
    const s=Math.hypot(n[0],n[1]);
    for (const { z0, z1, r } of shape.sections) for (const z of [z0, z1]) {lo=Math.min(lo,n[2]*z-s*r);hi=Math.max(hi,n[2]*z+s*r);}
    for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (volumeBelow(n, mid, shape) < V) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }
  // Raw first/second volume moments, integrated over exact disc segments. Splitting at
  // wet/dry transitions keeps the eight-point Gaussian rule accurate near the wall.
  function momentsBelow(n,d,shape){
    const s=Math.hypot(n[0],n[1]),ex=s>1e-12?n[0]/s:1,ey=s>1e-12?n[1]/s:0,first=[0,0,0],second=Array(9).fill(0);let volume=0;
    for(const {z0,z1,r}of shape.sections){
      const breaks=[z0,z1];if(Math.abs(n[2])>1e-12)for(const c of [-s*r,s*r]){const z=(d-c)/n[2];if(z>z0&&z<z1)breaks.push(z);}breaks.sort((a,b)=>a-b);
      for(let j=1;j<breaks.length;j++)for(let k=0;k<GX.length;k++){
        const h=(breaks[j]-breaks[j-1])/2,z=(breaks[j]+breaks[j-1])/2+GX[k]*h,w=GW[k]*h,c=s>1e-12?(d-n[2]*z)/s:(d-n[2]*z>=0?r:-r),u=clamp(c/r,-1,1),q=Math.sqrt(Math.max(0,1-u*u)),a=Math.asin(u)+Math.PI/2,A=r*r*(a+u*q),M=-2/3*r*r*r*q*q*q,Q=r**4/4*(a-u*(1-2*u*u)*q),P=r**4*(a/4+u*q*(5-2*u*u)/12),x=ex*M,y=ey*M,xx=ex*ex*Q+ey*ey*P,yy=ey*ey*Q+ex*ex*P,xy=ex*ey*(Q-P);
        volume+=w*A;first[0]+=w*x;first[1]+=w*y;first[2]+=w*z*A;
        const raw=[xx,xy,z*x,xy,yy,z*y,z*x,z*y,z*z*A];for(let i=0;i<9;i++)second[i]+=w*raw[i];
      }
    }
    return {volume,first,second};
  }
  // Fluid mass properties in the BODY SHAPE frame; inertia is about the fluid COM.
  function massProperties(v){
    const zero={mass:0,center:[0,0,v.floor||0],inertia:Array(9).fill(0)};if(v.V<=1e-12)return zero;
    const d=level(v.n,v.V,v.shape),m=momentsBelow(v.n,d,v.shape);if(m.volume<=1e-15)return zero;
    const center=m.first.map(x=>x/m.volume),mass=(v.density||1000)*v.V,k=mass/m.volume,q=m.second,tr=q[0]+q[4]+q[8],c2=dot(center,center),inertia=q.map((x,i)=>k*((i%4===0?tr:0)-x-m.volume*((i%4===0?c2:0)-center[Math.floor(i/3)]*center[i%3])));
    return {mass,center:[center[0],center[1],center[2]+(v.floor||0)],inertia};
  }
  // Uniform hollow glass: exact outer-minus-inner cylindrical volume moments,
  // normalized to a measured dry mass. Geometry remains in the shape/base frame.
  function shellMassProperties(outside,inside,floor,mass){
    let volume=0,first=0,radial=0,axial=0;
    for(const [sections,sign,offset]of [[outside,1,0],[inside,-1,floor]])for(const s of sections){
      const h=s.z1-s.z0,z=(s.z0+s.z1)/2+offset,V=sign*Math.PI*s.r*s.r*h;
      volume+=V;first+=V*z;radial+=V*s.r*s.r/4;axial+=V*(z*z+h*h/12);
    }
    if(!(volume>0&&mass>0))throw new Error('A glass shell needs positive volume and dry mass.');
    const z=first/volume,k=mass/volume,transverse=k*(radial+axial-volume*z*z),polar=2*k*radial;
    if(!(transverse>0&&polar>0))throw new Error('A glass shell needs positive inertia.');
    return {center:[0,0,z],inertia:[transverse,0,0,0,transverse,0,0,0,polar]};
  }
  // Bernoulli discharge integrated over the wetted neck opening. A wide open lip
  // instead behaves as a circular weir, not an imaginary hole over its whole top.
  function outflow(v,dt,gravity=G){
    const m=mouth(v.shape),s=Math.hypot(v.n[0],v.n[1]),base=v.d-v.n[2]*m.z1,Cd=v.discharge??.64;
    if(gravity<1e-5)return {rate:0,speed:0,point:spout(v.n,v.shape).p,wet:0,head:0};
    if(v.shape.sections.length===1){
      let rate=0,momentum=0,x=0,y=0;
      for(let i=0;i<48;i++){const a=TAU*(i+.5)/48,p=[m.r*Math.cos(a),m.r*Math.sin(a),m.z1],head=Math.max(0,v.d-dot(v.n,p)),q=Cd*2/3*Math.sqrt(2*gravity)*head**1.5*TAU*m.r/48;rate+=q;momentum+=q*Math.sqrt(2*gravity*head);x+=q*p[0];y+=q*p[1];}
      v.regime='lip';return {rate:Math.min(v.flow,rate),speed:rate?momentum/rate:0,point:rate?[x/rate,y/rate,m.z1]:spout(v.n,v.shape).p,wet:rate?1:0,head:Math.max(0,v.d-spout(v.n,v.shape).d)};
    }
    let flux=0,momentum=0,first=0;const quadrature=[],wet=s>1e-10?discArea(m.r,base/s):base>0?Math.PI*m.r*m.r:0;
    if(s<1e-10){const speed=Math.sqrt(2*gravity*Math.max(0,base));flux=wet*speed;momentum=flux*speed;}
    else{
      const lo=-m.r,hi=clamp(base/s,-m.r,m.r);
      for(let i=0;i<GX.length;i++){const x=(lo+hi)/2+GX[i]*(hi-lo)/2,head=Math.max(0,base-s*x),width=2*Math.sqrt(Math.max(0,m.r*m.r-x*x)),speed=Math.sqrt(2*gravity*head),q=GW[i]*(hi-lo)/2*width*speed;flux+=q;momentum+=q*speed;first+=q*x;quadrature.push({x,width:width/2,weight:q});}
    }
    // Reduced counterflow model: a dry part of the neck admits air continuously;
    // a flooded neck alternates liquid discharge and air slugs. Its time scale is
    // neck length / Taylor-bubble rise speed. The duty cycle is an empirical closure,
    // not a compressible-air or CFD solution (Clanet/Searby 2004; Schwefler et al. 2023).
    const fraction=wet/(Math.PI*m.r*m.r),vent=clamp((1-fraction)/.08,0,1),period=clamp((m.z1-m.z0)/(.35*Math.sqrt(gravity*2*m.r)),.08,.65);
    v.glugPhase=((v.glugPhase||0)+dt/period)%1;
    const wave=.5+.5*Math.sin(TAU*v.glugPhase),u=clamp((wave-.2)/.6,0,1),pulse=.06+.94*u*u*(3-2*u),factor=v.glug===false?1:vent+(1-vent)*pulse;
    v.regime=vent>.95?'vented':'glug';
    return {rate:Math.min(v.flow,Cd*flux)*factor,speed:flux?momentum/flux:0,point:s>1e-10&&flux?[v.n[0]/s*first/flux,v.n[1]/s*first/flux,m.z1]:[0,0,m.z1],wet:fraction,head:Math.max(0,base+s*m.r),quadrature};
  }
  // Low-discrepancy temporal quadrature resolves the finite wetted neck without
  // multiplying parcel count. A row is selected by its Bernoulli flux, then a
  // point uniformly across that row. Display uses the smooth flux centroid.
  function sampleOpening(v,flow,index){
    if(v.shape.sections.length===1)return flow.point.slice();
    const fract=x=>x-Math.floor(x),u=fract((index+.5)*.7548776662466927),w=fract((index+.5)*.5698402909980532),m=mouth(v.shape),s=Math.hypot(v.n[0],v.n[1]);
    if(s<1e-10){const r=m.r*Math.sqrt(u),a=TAU*w;return [r*Math.cos(a),r*Math.sin(a),m.z1];}
    const rows=flow.quadrature||[],total=rows.reduce((sum,p)=>sum+p.weight,0);if(total<=0)return flow.point.slice();
    let at=u*total,row=rows.at(-1);for(const p of rows){if(at<=p.weight){row=p;break;}at-=p.weight;}
    const x=row.x,y=(2*w-1)*row.width,ex=v.n[0]/s,ey=v.n[1]/s;
    return [ex*x-ey*y,ey*x+ex*y,m.z1];
  }
  // The free surface's outline (local points on the inner wall) in a one-section container, exact: where the wall line
  // leaves the slab 0..h the outline follows the straight chord across that cap, so those wall points are skipped.
  // A bottle's surface is hidden in brown glass and not drawn.
  function surface(n, d, shape, steps = 40) {
    if (shape.sections.length !== 1) return [];
    const {r,z0=0,z1:h}=shape.sections[0],s=Math.hypot(n[0],n[1]),out=[];
    if(Math.abs(n[2])<1e-8){
      if(s<1e-12||Math.abs(d/s)>=r)return [];
      const e=[n[0]/s,n[1]/s],c=d/s,t=Math.sqrt(r*r-c*c),a=[e[0]*c-e[1]*t,e[1]*c+e[0]*t],b=[e[0]*c+e[1]*t,e[1]*c-e[0]*t];return [[...a,z0],[...a,h],[...b,h],[...b,z0]];
    }
    const angles=Array.from({length:steps},(_,k)=>TAU*k/steps);
    if(s>1e-12)for(const z of [z0,h]){const u=(d-n[2]*z)/(s*r);if(Math.abs(u)<=1){const a=Math.atan2(n[1],n[0]),b=Math.acos(u);angles.push((a+b+TAU)%TAU,(a-b+TAU)%TAU);}}
    angles.sort((a,b)=>a-b);
    for(const a of angles){const z=(d-n[0]*r*Math.cos(a)-n[1]*r*Math.sin(a))/n[2];if(z>=z0-1e-9&&z<=h+1e-9){const p=[r*Math.cos(a),r*Math.sin(a),clamp(z,z0,h)];if(!out.length||C.norm(C.sub(p,out.at(-1)))>1e-8)out.push(p);}}
    return out;
  }
  // A container's liquid. spec: {shape, floor (m above the body's base), volume (m³), flow (most m³/s its mouth passes)}.
  function vessel(body, spec) {
    const m = mouth(spec.shape);
    return { body, shape: spec.shape, r: m.r, h: m.z1, floor: spec.floor, flow: spec.flow ?? Infinity, density:spec.density||1000,discharge:spec.discharge??.64,glug:spec.glug!==false,V0: spec.volume || 0, V: spec.volume || 0, a: [0, 0, 0], vPrev: null, n: [0, 0, 1], d: 0, pouring: 0, agitation:0, foam:0,foamVolume:0,glugPhase:0,receiving:null, visualSplashAt:-Infinity };
  }
  // The inner frame of a stein: origin at the centre of its inner floor, z along its axis.
  const inner = (W, v) => { const p = W.poseOf(v.body); return { R: p.R, t: C.add(p.t, C.mulv(p.R, [0, 0, v.floor])) }; };
  // One pour: the steins in `vessels`, the falling drops, and what reached the table. Call each physics substep.
  // solid(p, skip): whether p is inside a body other than skip, so a drop that hits it splashes rather than passing through.
  function pour(W, vessels, table, solid = null) {
    const state = { vessels, drops: [], spilled: 0, caught: 0, poured: 0, table, time:0, visualImpacts:[],impacts:[],nextDrop:0,prepared:false };
    const fluxes=new Map(),sync=v=>{if(W.setFluid&&!v.body.fixed)W.setFluid(v.body,massProperties(v),fluxes.get(v)||[]);fluxes.set(v,[]);};
    const addFlux=(v,mass,point,velocity)=>fluxes.get(v).push({mass,point:point.slice(),velocity:velocity.slice()});
    const pointVelocity=(v,p)=>C.add(v.body.v,cross(v.body.w,C.sub(p,v.body.t)));
    const normalized=(v,fallback=[0,0,1])=>{const n=C.norm(v);return n>1e-9?v.map(x=>x/n):fallback.slice();};
    const impulse=(v,volume,point,velocity)=>{const mass=volume*v.density;addFlux(v,mass,point,velocity);addFlux(v,-mass,point,pointVelocity(v,point));};
    const spill=(d,point,body,surfaceVelocity,centroid=point)=>{
      state.spilled+=d.vol;
      // Parcels carry orbital momentum at their centroid and no independent
      // spin; the radius-offset skin point belongs only to contact geometry.
      const vessel=vessels.find(v=>v.body===body);if(vessel)impulse(vessel,d.vol,centroid,d.v);
      else if(body&&W.applyImpulse){const wall=surfaceVelocity||C.add(body.v||[0,0,0],cross(body.w||[0,0,0],C.sub(point,body.t))),mass=d.vol*(d.from?.density||1000);W.applyImpulse(body,C.sub(d.v,wall).map(x=>x*mass),centroid);}
      state.impacts.push({point:point.slice(),velocity:d.v.slice(),volume:d.vol,at:state.time,kind:'spill'});
    };
    // Emission precedes rigid gravity. Parcel transport/arrival follows rigid gravity:
    // each piece of beer therefore receives gravity exactly once in the fixed substep.
    state.prepare=dt=>{
      if(state.prepared||!(dt>0))return;
      state.prepared=true;state.time+=dt;solid?.beginStep?.(dt);
      state.visualImpacts=state.visualImpacts.filter(e=>state.time-e.at<.24);state.impacts=state.impacts.filter(e=>state.time-e.at<.3);
      for(const v of vessels){
        fluxes.set(v,[]);v.frameStart=inner(W,v);
        v.agitation*=Math.exp(-dt/.45);v.foamVolume*=Math.exp(-dt/35);
        const vel=pointVelocity(v,v.frameStart.t);
        if(v.vPrev){const acc=C.sub(vel,v.vPrev).map(x=>x/dt),k=1-Math.exp(-dt/.045);v.a=v.a.map((x,i)=>x+(acc[i]-x)*k);}v.vPrev=vel;
        const acceleration=C.norm(v.a)>50?v.a.map(x=>x*50/C.norm(v.a)):v.a,up=C.add([0,0,G],acceleration),gravity=C.norm(up),target=normalized(up,v.surfaceUp||[0,0,1]);
        v.surfaceUp=v.surfaceUp||target.slice();v.surfaceVelocity=v.surfaceVelocity||[0,0,0];
        const r=v.shape.sections[0].r,depth=Math.max(.001,v.V/(Math.PI*r*r)),omega=Math.sqrt(Math.max(.1,gravity)*1.841/r*Math.tanh(1.841*depth/r));
        if(gravity>.05){
          v.surfaceVelocity=v.surfaceVelocity.map((x,i)=>x+(omega*omega*(target[i]-v.surfaceUp[i])-2*.2*omega*x)*dt);
          v.surfaceUp=normalized(C.add(v.surfaceUp,v.surfaceVelocity.map(x=>x*dt)),target);
          const radial=dot(v.surfaceVelocity,v.surfaceUp);v.surfaceVelocity=v.surfaceVelocity.map((x,i)=>x-radial*v.surfaceUp[i]);
        }
        v.gravity=gravity;v.n=C.mulv(C.tr3(v.frameStart.R),v.surfaceUp);v.d=level(v.n,v.V,v.shape);v.pouring=0;v.jet=null;
        v.agitation=Math.min(1,v.agitation+C.norm(v.surfaceVelocity)*r*dt);
        if(v.V>1e-12){
          const lip=spout(v.n,v.shape),excess=Math.max(0,v.V-lip.capacity),f=outflow(v,dt,gravity),out=Math.min(excess,f.rate*dt);
          if(out>1e-12&&f.speed>0){
            const at=C.add(v.frameStart.t,C.mulv(v.frameStart.R,f.point)),radial=normalized(C.mulv(v.frameStart.R,[f.point[0],f.point[1],0]),C.mulv(v.frameStart.R,[1,0,0])),axis=v.shape.sections.length>1?C.mulv(v.frameStart.R,[0,0,1]):radial,velocity=C.add(pointVelocity(v,at),axis.map(x=>x*f.speed)),count=Math.max(1,Math.ceil(out/1e-6));
            v.V-=out;v.pouring=out/dt;v.lip=at;v.jet={point:at,velocity,rate:v.pouring};state.poured+=out;
            // A partially wetted neck emits a crescent, not a sphere whose radius is
            // inferred from its flow area. Transport parcels are small quadrature
            // samples; the rendered area separately follows continuity/packet spacing.
            const hydraulicRadius=Math.sqrt(v.pouring/(Math.PI*f.speed)),radius=Math.min(.001,Math.max(.0001,(v.r-Math.hypot(f.point[0],f.point[1]))*.5));
            for(let i=0;i<count;i++){
              const id=state.nextDrop++,local=sampleOpening(v,f,id),offset=C.mulv(v.frameStart.R,C.sub(local,f.point)),point=C.add(at,offset),dv=cross(v.body.w,offset),speed=C.add(velocity,dv),sampleRadius=v.shape.sections.length>1?Math.min(.001,Math.max(.0001,(v.r-Math.hypot(local[0],local[1]))*.5)):radius;
              state.drops.push({p:point,v:speed,visualOffset:offset,visualVelocityOffset:dv,flow:v.pouring,exitSpeed:f.speed,hydraulicRadius,radius:sampleRadius,vol:out/count,age:0,from:v,t:state.time,id});
              addFlux(v,-out/count*v.density,point,speed);
            }
          }
        }
        sync(v);
      }
    };
    state.step=dt=>{
      if(!(dt>0))return;if(!state.prepared)state.prepare(dt);
      for(const v of vessels){v.frameEnd=inner(W,v);v.frameRotation=C.so3Log(C.mul3(C.tr3(v.frameStart.R),v.frameEnd.R));v.n=C.mulv(C.tr3(v.frameEnd.R),v.surfaceUp);v.d=level(v.n,v.V,v.shape);}
      const frameAt=(v,t)=>t<=0?v.frameStart:t>=1?v.frameEnd:{R:C.mul3(v.frameStart.R,C.rodrigues(v.frameRotation.map(x=>x*t))),t:v.frameStart.t.map((x,i)=>x+(v.frameEnd.t[i]-x)*t)};
      const sweep=(a,b,skip,radius,start=0,end=1)=>{
        if(solid?.sweep)return solid.sweep(a,b,skip,radius,start,end);
        if(solid){const length=C.norm(C.sub(b,a)),n=Math.max(1,Math.ceil(length/.00075));for(let k=0;k<=n;k++){const point=a.map((x,i)=>x+(b[i]-x)*k/n);if(solid(point,skip))return {fraction:k/n,point};}}
        return null;
      };
      const collisionAt=(hit,a,velocity,duration,radius)=>{
        if(!hit)return null;const t=duration*hit.fraction,centre=C.add(a,C.add(velocity.map(x=>x*t),[0,0,-.5*G*t*t]));
        // The sweep chord differs from the ballistic arc by at most21µm at
        // 240Hz (below its50µm tolerance). Keep orbital momentum on the arc.
        const point=hit.normal?C.sub(centre,hit.normal.map(x=>x*radius)):centre;
        return {...hit,centre,point,surfaceVelocity:hit.surfaceVelocityAt?hit.surfaceVelocityAt(point):hit.surfaceVelocity};
      };
      const deposition=(d,a,b,start=0,end=1,entry=0)=>{
        const v=d.inside;if(!v)return null;
        const radius=d.radius||.00025,f0=frameAt(v,start),f1=frameAt(v,end),q0=C.mulv(C.tr3(f0.R),C.sub(a,f0.t)),q1=C.mulv(C.tr3(f1.R),C.sub(b,f1.t)),n0=C.mulv(C.tr3(f0.R),v.surfaceUp),n1=C.mulv(C.tr3(f1.R),v.surfaceUp),above=dot(n0,q0)-level(n0,v.V,v.shape)-radius,below=dot(n1,q1)-level(n1,v.V,v.shape)-radius;
        if(above>=0&&below<=0||above<0&&entry<Infinity){
          const t=Math.max(entry,above>0?above/(above-below):0),q=q0.map((x,i)=>x+(q1[i]-x)*t),section=v.shape.sections.find(s=>q[2]>=s.z0-radius&&q[2]<=s.z1+radius);
          if(t<=1&&section&&Math.hypot(q[0],q[1])+radius<=section.r+1e-7)return {v,t,q};
        }
        return null;
      };
      const arrives=(deposit,hit,length)=>deposit&&(!hit||deposit.t<=hit.fraction||hit.body===deposit.v.body&&Math.abs(deposit.t-hit.fraction)*length<.0003);
      const receive=(d,deposit,a,b,startVelocity,endVelocity)=>{
        const {v,q,t}=deposit,point=a.map((x,i)=>x+(b[i]-x)*t),speed=startVelocity.map((x,i)=>x+(endVelocity[i]-x)*t),capacity=v.shape.sections.reduce((s,x)=>s+Math.PI*x.r*x.r*(x.z1-x.z0),0),accepted=Math.min(d.vol,Math.max(0,capacity-v.V));
        if(accepted>0){
          // Parcel gravity was integrated once before any contact in this step.
          v.V+=accepted;state.caught+=accepted;addFlux(v,accepted*v.density,point,d.v);
          const relative=C.sub(speed,pointVelocity(v,point)),normalSpeed=Math.max(0,-dot(relative,v.surfaceUp));
          v.agitation=Math.min(1,v.agitation+accepted*Math.min(2,C.norm(relative))*5e4);v.foamVolume+=accepted*.18*clamp(normalSpeed/.8,0,2);
          v.receiving={local:q,velocity:C.mulv(C.tr3(v.frameEnd.R),relative),flow:d.flow||0,from:d.from,at:state.time};
          if(state.time-v.visualSplashAt>.045){v.visualSplashAt=state.time;state.visualImpacts.push({vessel:v,local:q,at:state.time,seed:Math.round(state.time*1000),speed:normalSpeed});if(state.visualImpacts.length>12)state.visualImpacts.shift();}
        }
        if(accepted<d.vol)spill({...d,vol:d.vol-accepted},point,v.body);
        v.d=level(v.n,v.V,v.shape);
      };
      const wallBound=(d,v,p,elapsed)=>{
        const radius=d.radius||.00025,f=frameAt(v,elapsed),q=C.mulv(C.tr3(f.R),C.sub(p,f.t)),section=v.shape.sections.find(s=>q[2]>=s.z0-radius&&q[2]<=s.z1+radius),r=Math.hypot(q[0],q[1]);
        if(section&&r>section.r-radius-.0001){const k=Math.max(0,section.r-radius-.0001)/r;q[0]*=k;q[1]*=k;}
        const end=C.add(v.frameEnd.t,C.mulv(v.frameEnd.R,q)),velocity=pointVelocity(v,end),mass=d.vol*v.density;
        addFlux(v,mass,p,C.add(d.v,[0,0,-G*dt*(1-elapsed)]));addFlux(v,-mass,end,velocity);
        d.p=end;d.v=velocity;d.wallLimited=true;d.visualOffset=null;d.visualVelocityOffset=null;
      };
      const keep=[];
      for(const d of state.drops){
        const before=d.p.slice(),velocity=d.v.slice();d.p=C.add(before,C.add(velocity.map(x=>x*dt),[0,0,-.5*G*dt*dt]));d.v=C.add(velocity,[0,0,-G*dt]);d.age+=dt;
        const length=C.norm(C.sub(d.p,before)),radius=d.radius||.00025,skip=d.age<.02?d.from?.body:null;
        let hit=sweep(before,d.p,skip,radius);
        let entryTime=d.inside?0:Infinity;
        if(d.inside){const v=d.inside,q=C.mulv(C.tr3(v.frameEnd.R),C.sub(d.p,v.frameEnd.t));if(q[2]>v.h+radius){d.inside=null;entryTime=Infinity;}}
        if(!d.inside){
          let entered=null;
          for(const v of vessels){
            if(v===d.from&&d.age<.08)continue;
            const q0=C.mulv(C.tr3(v.frameStart.R),C.sub(before,v.frameStart.t)),q1=C.mulv(C.tr3(v.frameEnd.R),C.sub(d.p,v.frameEnd.t));
            if(q0[2]>=v.h&&q1[2]<v.h){
              const t=(q0[2]-v.h)/(q0[2]-q1[2]),q=q0.map((x,i)=>x+(q1[i]-x)*t),distance=Math.hypot(q[0],q[1]);
              if(distance+radius<=v.r+1e-8&&t<entryTime){entered=v;entryTime=t;}
            }
          }
          if(entered&&(!hit||entryTime<=hit.fraction)){d.inside=entered;}
        }
        const deposit=deposition(d,before,d.p,0,1,entryTime);
        if(arrives(deposit,hit,length)){receive(d,deposit,before,d.p,velocity,d.v);continue;}
        if(hit){
          hit=collisionAt(hit,before,velocity,dt,radius);
          let elapsed=hit.fraction,finished=false;
          d.v=C.add(velocity,[0,0,-G*dt*elapsed]);
          // A tangential chord leaves a curved wall again. Re-sweep every remaining
          // segment; stopping the loop must never advance an unchecked remainder.
          for(let contact=0;contact<12;contact++){
            const v=d.inside,f=v&&frameAt(v,elapsed),local=f&&C.mulv(C.tr3(f.R),C.sub(hit.point,f.t)),n=f&&hit.normal&&C.mulv(C.tr3(f.R),hit.normal),insideWall=v&&hit.body===v.body&&n&&local[2]>=-radius&&local[2]<=v.h&&((n[0]*local[0]+n[1]*local[1])<-.001||local[2]<v.h-radius*2&&n[2]>.2);
            if(hit.limited&&v&&hit.body===v.body){wallBound(d,v,hit.centre,elapsed);break;}
            if(!insideWall){spill(d,hit.point||d.p,hit.body,hit.surfaceVelocity,hit.centre||hit.point||d.p);finished=true;break;}
            {
              const wall=pointVelocity(v,hit.point),relative=C.sub(d.v,wall),normalSpeed=Math.min(0,dot(relative,hit.normal)),out=C.sub(relative,hit.normal.map(x=>x*normalSpeed*1.04)).map(x=>x*.82),next=C.add(wall,out),mass=d.vol*v.density,centre=hit.centre,remaining=dt*(1-elapsed);
              d.p=C.add(centre,hit.normal.map(x=>x*.0001));
              // The quadrature parcel has no independent spin: transfer its
              // orbital P/L, including the tiny separation correction, exactly.
              addFlux(v,mass,centre,d.v);addFlux(v,-mass,d.p,next);
              d.v=next;d.wallHits=(d.wallHits||0)+1;d.visualOffset=null;d.visualVelocityOffset=null;
              if(contact===11){
                // Extreme grazing speeds become wall-bound runoff for this last
                // unresolved interval. Transfer its lost momentum, follow that
                // same material point to the final pose, and retain its volume.
                wallBound(d,v,d.p,elapsed);break;
              }
              const end=C.add(d.p,C.add(next.map(x=>x*remaining),[0,0,-.5*G*remaining*remaining])),endVelocity=C.add(next,[0,0,-G*remaining]),again=sweep(d.p,end,skip,radius,elapsed,1),deposit=deposition(d,d.p,end,elapsed,1);
              if(arrives(deposit,again,C.norm(C.sub(end,d.p)))){d.v=endVelocity;receive(d,deposit,d.p,end,next,endVelocity);finished=true;break;}
              if(!again){d.p=end;d.v=endVelocity;break;}
              hit=collisionAt(again,d.p,next,remaining,radius);d.v=C.add(next,[0,0,-G*remaining*again.fraction]);elapsed+=(1-elapsed)*again.fraction;
            }
          }
          if(!finished)keep.push(d);continue;
        }
        let ground=null;
        if(table){
          const a=C.mulv(C.tr3(table.R),C.sub(before,table.t)),b=C.mulv(C.tr3(table.R),C.sub(d.p,table.t));
          if(a[2]>=radius&&b[2]<=radius){const t=(a[2]-radius)/(a[2]-b[2]),p=a.map((x,i)=>x+(b[i]-x)*t);if(!table.size||Math.abs(p[0])<=table.size[0]/2&&Math.abs(p[1])<=table.size[1]/2)ground={point:before.map((x,i)=>x+(d.p[i]-x)*t)};}
        }
        const floor=W.floorZ??(table?table.t[2]-.75:0);
        if(!ground&&d.p[2]<=floor+radius)ground={point:[d.p[0],d.p[1],floor]};
        if(ground||d.age>6){spill(d,ground?.point||d.p);continue;}
        keep.push(d);
      }
      state.drops=keep;
      for(const v of vessels){
        const capacity=v.shape.sections.reduce((s,x)=>s+Math.PI*x.r*x.r*(x.z1-x.z0),0);v.foamVolume=Math.min(v.foamVolume,Math.max(0,capacity-v.V));v.foam=clamp(v.foamVolume/(Math.PI*v.r*v.r*.012),0,1);sync(v);
      }
      state.impacts=state.impacts.slice(-48);state.prepared=false;solid?.endStep?.();
    };
    for(const v of vessels){fluxes.set(v,[]);v.n=C.mulv(C.tr3(inner(W,v).R),[0,0,1]);v.d=level(v.n,v.V,v.shape);sync(v);}
    // For drawing: each stein's surface outline in the world, and the stream as chains of nearby drops.
    state.view = () => {
      const drawPoint=d=>d.visualOffset?C.sub(d.p,C.add(d.visualOffset,d.visualVelocityOffset.map(x=>x*d.age))):d.p;
      const allChains=state.drops.slice().reverse().reduce((chains,d)=>{
        const last=chains.at(-1),tail=last?.at(-1);
        if(tail&&tail.from===d.from&&C.norm(C.sub(drawPoint(tail),drawPoint(d)))<.05)last.push(d);
        else chains.push(d.from.pouring>0&&!chains.some(c=>c[0].from===d.from)&&C.norm(C.sub(d.from.lip,drawPoint(d)))<.05?[{p:d.from.lip,from:d.from,flow:d.flow,v:d.v},d]:[d]);
        return chains;
      },[]),chains=allChains.filter(c=>c.length>1),particles=[];
      const shown=new Map();
      const surfaces=vessels.filter((v)=>v.V>2e-6&&v.shape.sections.length===1).map(v=>{
        const f=inner(W,v),d=level(v.n,v.V,v.shape),shape={sections:v.shape.sections.map(x=>({...x,r:x.r*.995}))};
        const at=q=>C.add(f.t,C.mulv(f.R,q)),ontoSurface=q=>{
          const r=Math.hypot(q[0],q[1]),k=r>v.r*.91?v.r*.91/r:1,x=q[0]*k,y=q[1]*k;
          return [x,y,clamp((d-v.n[0]*x-v.n[1]*y)/(Math.abs(v.n[2])<1e-5?1:v.n[2]),0,v.h)];
        };
        const receiving=v.receiving&&state.time-v.receiving.at<.12?v.receiving:null;
        const hit=receiving?ontoSurface(receiving.local):null;
        shown.set(v,{f,d,at,ontoSurface,hit});
        const headroom=Math.max(0,spout(v.n,v.shape).d-d);
        return {key:v.body.key,points:surface(v.n,d,shape).map(at),up:C.mulv(f.R,v.n),phase:state.time,agitation:v.agitation,foam:v.foam,depth:v.V/(Math.PI*v.r*v.r),headroom,foamHeight:Math.min(headroom,.035,v.foamVolume/(Math.PI*v.r*v.r)),
          impact:hit?{point:at(hit),strength:v.agitation}:null};
      });
      // Single separated flow packets remain visible as tiny elongated droplets, not 5 ml spheres.
      for(const chain of allChains)if(chain.length===1){const d=chain[0],count=Math.min(8,Math.max(1,Math.ceil(d.vol/.08e-6))),r=Math.min(.003,Math.cbrt(3*d.vol/(4*Math.PI*count))),axis=normalized(d.v);for(let i=0;i<count;i++)particles.push({p:C.add(d.p,axis.map(x=>x*(i-(count-1)/2)*r*2.2)),velocity:d.v.slice(),r,stretch:1.4});}
      for(const e of state.visualImpacts){
        const s=shown.get(e.vessel);if(!s)continue;
        const age=state.time-e.at,base=s.at(s.ontoSurface(e.local)),up=C.mulv(s.f.R,e.vessel.n),tangent=C.mulv(s.f.R,[1,0,0]),side=C.mulv(s.f.R,[0,1,0]);
        for(let k=0;k<2;k++){
          const a=e.seed*.37+k*2.4,velocity=C.add(up.map(x=>x*(.19+.025*k)),C.add(tangent.map(x=>x*Math.cos(a)*.07),side.map(x=>x*Math.sin(a)*.07)));
          const p=C.add(base,C.add(velocity.map(x=>x*age),[0,0,-.5*G*age*age]));
          if(dot(C.sub(p,base),up)<.0002)continue;
          particles.push({p,velocity:C.add(velocity,[0,0,-G*age]),r:.00065+.0002*k,stretch:1.3});
        }
      }
      return {
      surfaces,phase:state.time,particles:particles.slice(0,48),
      streams:chains.map(c=>c.map(drawPoint)),
      radii:chains.map(c=>c.map((d,i)=>{const previous=c[Math.max(0,i-1)],next=c[Math.min(c.length-1,i+1)],length=(C.norm(C.sub(drawPoint(d),drawPoint(previous)))+C.norm(C.sub(drawPoint(next),drawPoint(d))))/(i===0||i===c.length-1?1:2),area=d.vol&&length>1e-6?d.vol/length:(d.flow||0)/Math.max(.05,d.exitSpeed||C.norm(d.v));return Math.max(.00025,Math.min(.008,Math.sqrt(area/Math.PI)));})),
    };};
    state.reset = () => { for (const v of vessels) { v.V = v.V0; v.a = [0, 0, 0]; v.vPrev = null; v.pouring = 0;v.jet=null;v.agitation=0;v.foam=0;v.foamVolume=0;v.glugPhase=0;v.surfaceUp=[0,0,1];v.surfaceVelocity=[0,0,0];v.receiving=null;v.visualSplashAt=-Infinity;v.n=C.mulv(C.tr3(inner(W,v).R),v.surfaceUp);v.d=level(v.n,v.V,v.shape);fluxes.set(v,[]);sync(v); } state.drops = []; state.spilled = 0; state.caught = 0; state.poured = 0;state.time=0;state.visualImpacts=[];state.impacts=[];state.nextDrop=0;state.prepared=false; };
    return state;
  }
  return { cylinder, volumeBelow, momentsBelow,massProperties,shellMassProperties,outflow,sampleOpening,spout, level, surface, vessel, pour };
});
