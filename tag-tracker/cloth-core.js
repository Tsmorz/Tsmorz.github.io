// Small-step XPBD fabric with finite gripper patches and a cut-pattern shirt. Stretch/shear and compliant bending constraints follow Macklin et al. (2016):
// https://mmacklin.com/xpbd.pdf . No DOM; the same state drives the mesh and the objective checks.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./physics-core.js'), require('./cable-core.js'));
  else root.ClothCore = factory(root.PhysicsCore, root.CableCore);
})(typeof self !== 'undefined' ? self : this, function (P, Cable) {
  'use strict';
  const add = (a, b) => a.map((v, i) => v + b[i]), sub = (a, b) => a.map((v, i) => v - b[i]);
  const mul = (a, s) => a.map((v) => v * s), len = (a) => Math.hypot(...a);
  const mv = (R, p) => [0, 1, 2].map((i) => R[3 * i] * p[0] + R[3 * i + 1] * p[1] + R[3 * i + 2] * p[2]);
  const mt = (R, p) => [0, 1, 2].map((i) => R[i] * p[0] + R[3 + i] * p[1] + R[6 + i] * p[2]);
  const dot = (a,b) => a.reduce((s,v,i)=>s+v*b[i],0);
  const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  // Barycentric vertex/face contact catches overlapping fabric between mesh particles.
  function faceContact(point,a,b,c,margin=0) {
    const u=sub(b,a),v=sub(c,a),normal=cross(u,v),area=len(normal);if(area<1e-10)return null;
    const n=mul(normal,1/area),d=dot(sub(point,a),n),q=sub(sub(point,a),mul(n,d));
    const uu=dot(u,u),uv=dot(u,v),vv=dot(v,v),qu=dot(q,u),qv=dot(q,v),denom=uu*vv-uv*uv;
    const y=(vv*qu-uv*qv)/denom,z=(uu*qv-uv*qu)/denom;
    return y>=-margin-1e-6&&z>=-margin-1e-6&&y+z<=1+margin+1e-6?{n,d,w:[1-y-z,y,z]}:null;
  }
  function inverse3(m) {
    const [a,b,c,d,e,f,g,h,i]=m,co=[e*i-f*h,c*h-b*i,b*f-c*e,f*g-d*i,a*i-c*g,c*d-a*f,d*h-e*g,b*g-a*h,a*e-b*d],det=a*co[0]+b*co[3]+c*co[6];
    return co.map(v=>v/det);
  }
  const radius = 0.0025, N = 9, ITER = 5;
  function towel(spec, table) {
    const shirt = spec.kind === 'shirt', N = spec.resolution || (shirt ? 21 : 9), iterations = spec.iterations || (shirt ? 8 : ITER);
    const bendCompliance=spec.bend_compliance ?? .5, radius=Math.max(.001,Math.min(.012,(spec.thickness || .005)/2));
    const width = spec.width || (shirt ? .28 : .20), height = spec.height || (shirt ? .50 : .24), rows = shirt ? Math.round((N-1)*height/width)+1 : N;
    const start = [], material = [], edges = [], triangles = [], pins = new Map(), grid = new Map();
    const bodySpan = spec.body_span || .18;
    const inside = (x,y) => {
      if (!shirt) return true;
      if (Math.abs(y) <= bodySpan/2) return Math.hypot(x-width/2,y) >= .028;
      const t = (Math.abs(y)-bodySpan/2)/(height/2-bodySpan/2);
      return x >= .035-.025*t && x <= width/2-.015*t;
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
    const linked = new Set(), neighbours = start.map((_,i)=>new Set([i]));
    const link = (a,b,compliance) => {
      const key = Math.min(a,b)+':'+Math.max(a,b); if(linked.has(key))return;linked.add(key);
      edges.push({a,b,rest:len(sub(start[a],start[b])),compliance,lambda:0});
      if(compliance<1e-6){neighbours[a].add(b);neighbours[b].add(a);}
    };
    for(let j=0;j<rows;j++)for(let i=0;i<N;i++) {
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
    const totalArea=areas.reduce((a,b)=>a+b,0), mass=spec.mass || (shirt?.11:.08);
    const weights=areas.map(a=>shirt?totalArea/(Math.max(a,totalArea/start.length*.2)*mass):start.length/mass);
    const nearest = p => material.reduce((best,v,i)=>len(sub(v,p))<len(sub(material[best],p))?i:best,0);
    const landmarks=shirt?{
      cuffs:[nearest([.067,height/2,radius]),nearest([.067,-height/2,radius])],
      hem:[nearest([-width/2,bodySpan/2-.014,radius]),nearest([-width/2,-bodySpan/2+.014,radius])],
      shoulders:[nearest([width/2,bodySpan/2-.014,radius]),nearest([width/2,-bodySpan/2+.014,radius])],
      sleeves:[material.flatMap((p,i)=>p[1]>bodySpan/2+.005?[i]:[]),material.flatMap((p,i)=>p[1]<-bodySpan/2-.005?[i]:[])]
    }:null;
    const c = { layerCompliance:spec.pile ? .005 : 0,foldAxes:spec.fold_axes||'xy',halfThickness:radius,pile:spec.pile||0,foldStage:0,firstHands:new Set(),foldHands:new Set(),restTime:0, key:spec.key,kind:shirt?'shirt':'towel',color:spec.color,label:spec.label,N,rows,width,height,bodySpan,triangles,edges,pins,material,landmarks,table,weights,reactions:{},nodes:[],folds:new Set(),touched:new Set() };
    c.reset = () => { c.nodes = start.map((p) => ({ p:p.slice(),v:[0,0,0] }));pins.clear();c.folds.clear();c.touched.clear();c.reactions={};c.restTime=0;c.foldStage=0;c.firstHands.clear();c.foldHands.clear(); };
    c.reset();
    c.step = (dt, W) => {
      const ns = c.nodes;
      // Both jaws must surround a patch. Closing captures it, opening releases it; no cursor-to-cloth teleport.
      for (const [side, h] of Object.entries(W.hands)) {
        const pose = W.handPose(side), pin = pins.get(side), gap = h.gap;
        if (pin && (h.target > 0.012 || h.grip)) { pins.delete(side); continue; }
        if (!pin && !h.grip && h.target < 0.012 && h.gap < .018 && !W.cloths.some((q) => q !== c && q.pins.has(side))) {
          let best = null;
          for (const cloth of W.cloths) cloth.nodes.forEach((n, i) => {
            if ([...cloth.pins.values()].some((p) => p.points.some(q=>q.ids.includes(i)))) return;
            const p = mt(pose.R, sub(n.p, pose.t));
            if (Math.abs(p[0]) < 0.022 && Math.abs(p[1]) < Math.max(0.012, gap / 2) && p[2] < -0.055 && p[2] > -0.13) {
              const d = Math.hypot(p[0], p[1], p[2] + 0.0925); if (!best || d < best.d) best = { i, local: p, d, cloth };
            }
          });
          if (best && best.cloth === c) {
            // Three material points over an 8 mm patch constrain twist as well as translation. Barycentric
            // points keep the contact area independent of mesh resolution, including at a hem or cuff.
            const indices=[best.i];
            // A plush doubled edge is clamped through its layers. Each layer gets a separate finite
            // material patch; nearby vertices on the same sheet must not create duplicate constraints.
            if(c.pile)for(let i=0;i<ns.length&&indices.length<4;i++){
              const local=mt(pose.R,sub(ns[i].p,pose.t));
              if(len(sub(ns[i].p,ns[best.i].p))<.05 && indices.every(j=>len(sub(material[i],material[j]))>.06)
                && Math.abs(local[0])<.022&&Math.abs(local[1])<.014&&local[2]<-.055&&local[2]>-.13
                && ![...pins.values()].some(p=>p.points.some(q=>q.ids.includes(i))))indices.push(i);
            }
            const points=[],inverses=[];
            for(const index of indices){
              let face=null;
              for(let t=0;t<triangles.length;t+=3)if(triangles.slice(t,t+3).includes(index)){face=triangles.slice(t,t+3);break;}
              if(!face)continue;
              const patch=[{ids:[index],w:[1],local:mt(pose.R,sub(ns[index].p,pose.t))}];
              for(const i of face.filter(i=>i!==index)){
                const f=Math.min(.7,.008/Math.max(.001,len(sub(ns[i].p,ns[index].p)))),p=add(ns[index].p,mul(sub(ns[i].p,ns[index].p),f));
                patch.push({ids:[index,i],w:[1-f,f],local:mt(pose.R,sub(p,pose.t))});
              }
              const matrix=patch.flatMap((a,i)=>patch.map((b,j)=>a.ids.reduce((s,id,k)=>s+(b.ids.includes(id)?weights[id]*a.w[k]*b.w[b.ids.indexOf(id)]:0),i===j?2e-8/(P.H*P.H):0)));
              inverses.push(inverse3(matrix));points.push(...patch);
            }
            if(points.length){const throughFold=indices.some(i=>material[i][0]<-width*.1)&&indices.some(i=>material[i][0]>width*.1);const centre=points.filter((_,i)=>i%3===0).reduce((p,q)=>add(p,mul(q.local,1/inverses.length)),[0,0,0]);pins.set(side,{i:best.i,local:centre,points,inverses,layers:inverses.length,throughFold,roll:0});c.touched.add(+side);if(c.foldStage===1){if(throughFold)c.foldHands.add(+side);}else c.firstHands.add(+side);}
          }
        }
      }
      for (const side of [...pins.keys()]) if (!W.hands[side]) pins.delete(side);
      const attachments=[];
      for(const [side,pin] of pins){const pose=W.handPose(side);for(const [i,point] of pin.points.entries()){const patch=Math.floor(i/3),centre=pin.local,a=pin.roll||0,d=sub(point.local,centre),rolled=[Math.cos(a)*d[0]+Math.sin(a)*d[2],d[1],-Math.sin(a)*d[0]+Math.cos(a)*d[2]];attachments.push({...point,side,patch,target:add(pose.t,mv(pose.R,add(centre,rolled))),lambda:[0,0,0]});}}
      const attached=new Set(attachments.flatMap(a=>a.ids));
      const applyPins=()=>{
        for(let start=0;start<attachments.length;start+=3){
          const patch=attachments.slice(start,start+3),inverse=pins.get(patch[0].side).inverses[patch[0].patch],alpha=2e-8/(dt*dt);
          const errors=patch.map(a=>{const point=a.ids.reduce((p,i,k)=>add(p,mul(ns[i].p,a.w[k])),[0,0,0]);return sub(sub(a.target,point),mul(a.lambda,alpha));});
          const deltas=patch.map((_,i)=>[0,1,2].map(k=>errors.reduce((s,e,j)=>s+inverse[i*3+j]*e[k],0)));
          patch.forEach((a,i)=>{
            const next=add(a.lambda,deltas[i]),cap=6*dt*dt/pins.get(a.side).points.length,L=len(next),limited=L>cap?mul(next,cap/L):next,dl=sub(limited,a.lambda);a.lambda=limited;
            a.ids.forEach((id,k)=>{ns[id].p=add(ns[id].p,mul(dl,weights[id]*a.w[k]));});
          });
        }
      };
      // Supported, nearly still fabric can sleep, but capture checks above always run first.
      const supported=ns.filter(n=>{const q=mt(table.R,sub(n.p,table.t));return Math.abs(q[0])<table.size[0]/2&&Math.abs(q[1])<table.size[1]/2&&q[2]<radius+.006;}).length;
      const plushRest=c.pile&&supported>ns.length*.04&&ns.every(n=>len(n.v)<.15&&mt(table.R,sub(n.p,table.t))[2]<.08)&&Math.sqrt(ns.reduce((s,n)=>s+dot(n.v,n.v),0)/ns.length)<.04;
      if(!pins.size&&!W.bodies.length&&(plushRest||supported>ns.length*.3&&ns.every(n=>len(n.v)<.002)))c.restTime+=dt;else c.restTime=0;
      if(c.restTime>.4){ns.forEach(n=>{n.v=[0,0,0];});c.reactions={};return;}
      const old = ns.map((n) => n.p.slice()), hits = new Set(), tablePush = new Map(), contactNormals=new Map();
      const normalAt=(i,n)=>{if(!contactNormals.has(i))contactNormals.set(i,[]);const all=contactNormals.get(i);if(!all.some(q=>Math.abs(dot(q,n))>.95))all.push(n);hits.add(i);};
      ns.forEach((n) => { n.v[2] -= 9.81 * dt; n.p = add(n.p, mul(n.v, dt)); });
      for (const e of edges) e.lambda = 0;
      const collide = (n, i) => {
        if (W.tableBox) {
          const k = P.sphereBox(n.p, radius, W.tableBox, W.tableBox.h);
          if (k.dist < 0) {
            n.p = add(n.p, mul(k.n, -k.dist)); normalAt(i,k.n);
            if (mt(table.R, k.n)[2] > 0.9) tablePush.set(i, (tablePush.get(i) || 0) - k.dist);
          }
        }
        if (n.p[2] < W.floorZ + radius) { n.p[2] = W.floorZ + radius; normalAt(i,[0,0,1]); }
        for (const b of W.bodies) {
          if (len(sub(n.p, b.t)) > b.bound + radius) continue;
          const p = sub(mt(b.R, sub(n.p, b.t)), b.off);
          const d = b.sdf ? P.bodyDistance(b, p) - radius : len(p) - P.BALL.r - radius;
          if (d < 0) {
            const normal = mv(b.R, b.sdf ? P.bodyNormal(b, p) : mul(p, 1 / (len(p) || 1)));
            n.p = add(n.p, mul(normal, -d)); normalAt(i,normal);
          }
        }
      };
      // Spatial hash for self-contact and contact with the other towels (neighbouring mesh vertices excluded).
      const cell = radius * 2, hash = new Map(), hashKey = (x, y, z) => (x & 1023) | ((y & 1023) << 10) | ((z & 1023) << 20);
      for (const q of W.cloths) for (let j = 0; j < q.nodes.length; j++) {
        if (q === c) continue;
        const p = q.nodes[j].p, key = hashKey(Math.floor(p[0] / cell), Math.floor(p[1] / cell), Math.floor(p[2] / cell));
        if (!hash.has(key)) hash.set(key, []); hash.get(key).push({ p, j, other: true,radius:q.halfThickness||.0025 });
      }
      ns.forEach((n, i) => {
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
      // Build a local vertex/face candidate set once; solve it with stretch and attachment constraints,
      // so separating folded layers cannot leave a final, unsolved tensile strain.
      const faceCell=.025,faceHash=new Map(),faceKey=(x,y,z)=>x+','+y+','+z,faces=[],surfacePairs=[];
      for(const q of W.cloths)for(let t=0;t<q.triangles.length;t+=3){
        const ids=q.triangles.slice(t,t+3),ps=ids.map(i=>q.nodes[i].p),id=faces.length,min=[0,1,2].map(k=>Math.min(...ps.map(p=>p[k]))-Math.max(.012,radius+(q.halfThickness||.0025))),max=[0,1,2].map(k=>Math.max(...ps.map(p=>p[k]))+Math.max(.012,radius+(q.halfThickness||.0025)));faces.push({q,ids,min,max});
        const lo=min.map(v=>Math.floor(v/faceCell)),hi=max.map(v=>Math.floor(v/faceCell));
        for(let x=lo[0];x<=hi[0];x++)for(let y=lo[1];y<=hi[1];y++)for(let z=lo[2];z<=hi[2];z++){const key=faceKey(x,y,z);if(!faceHash.has(key))faceHash.set(key,[]);faceHash.get(key).push(id);}
      }
      for(let i=0;i<ns.length;i++){
        const nearby=[];
        for(const id of faceHash.get(faceKey(...ns[i].p.map(v=>Math.floor(v/faceCell))))||[]){
          const face=faces[id];if(ns[i].p.some((v,k)=>v<face.min[k]||v>face.max[k])||face.q===c&&face.ids.some(j=>neighbours[i].has(j)))continue;
          const near=faceContact(ns[i].p,...face.ids.map(j=>face.q.nodes[j].p),.3);if(!near||Math.abs(near.d)>.012)continue;
          const before=face.q===c?faceContact(old[i],...face.ids.map(j=>old[j]),.3):near;
          nearby.push({i,...face,side:(before?.d??near.d)<0?-1:1,lambda:0,score:Math.abs(near.d)+.03*Math.max(0,-Math.min(...near.w))});
        }
        // A surface particle needs its nearest layers, not every overlapping triangle's duplicate contact.
        nearby.sort((a,b)=>a.score-b.score);surfacePairs.push(...nearby.slice(0,4));
      }
      const solveSurface=()=>{
        for(const pair of surfacePairs){const {i,q,ids}=pair;
          const contact=faceContact(ns[i].p,...ids.map(j=>q.nodes[j].p));if(!contact||contact.d*pair.side>=radius+(q.halfThickness||.0025))continue;
          const wa=attached.has(i)?0:weights[i],wb=ids.map(j=>q===c&&!attached.has(j)?weights[j]:0),denom=wa+wb.reduce((s,w,k)=>s+w*contact.w[k]**2,0);if(!denom)continue;
          const normal=mul(contact.n,pair.side),penetration=radius+(q.halfThickness||.0025)-contact.d*pair.side,alpha=((c.layerCompliance+(q.layerCompliance||0))/2)/(dt*dt),previous=pair.lambda;
          pair.lambda=Math.max(0,previous+(penetration-alpha*previous)/(denom+alpha));const dl=pair.lambda-previous;
          ns[i].p=add(ns[i].p,mul(normal,wa*dl));ids.forEach((j,k)=>{q.nodes[j].p=sub(q.nodes[j].p,mul(normal,wb[k]*contact.w[k]*dl));if(q===c&&wb[k]>0)normalAt(j,normal);});normalAt(i,normal);
          if(q===c){
            // Coulomb friction between layers keeps a tucked sleeve supported while the body is folded.
            const surfaceMove=ids.reduce((d,j,k)=>add(d,mul(sub(ns[j].p,old[j]),contact.w[k])),[0,0,0]),relative=sub(sub(ns[i].p,old[i]),surfaceMove),tangent=sub(relative,mul(normal,dot(relative,normal))),L=len(tangent);
            if(L>1e-9){const impulse=mul(tangent,Math.min(L,.55*(alpha?pair.lambda*denom:penetration))/(L*denom));ns[i].p=sub(ns[i].p,mul(impulse,wa));ids.forEach((j,k)=>{q.nodes[j].p=add(q.nodes[j].p,mul(impulse,wb[k]*contact.w[k]));});}
          }
        }
      };
      const tableFriction=new Map();
      const solveTableFriction=()=>{
        for(const [i,normal]of tablePush)if(!attached.has(i)){
          const delta=mt(table.R,sub(ns[i].p,old[i])),previous=tableFriction.get(i)||[0,0],candidate=[previous[0]+delta[0],previous[1]+delta[1]],L=Math.hypot(...candidate),scale=L>0?Math.min(1,.75*normal/L):1,next=candidate.map(v=>v*scale);
          ns[i].p=sub(ns[i].p,mv(table.R,[next[0]-previous[0],next[1]-previous[1],0]));tableFriction.set(i,next);
        }
      };
      for (let it = 0; it < iterations; it++) {
        for (const e of edges) {
          const a = ns[e.a], b = ns[e.b], d = sub(a.p, b.p), L = len(d);
          if (L < 1e-9) continue;
          const wa = weights[e.a], wb = weights[e.b], alpha = e.compliance / (dt * dt);
          const dl = (-(L - e.rest) - alpha * e.lambda) / (wa + wb + alpha); e.lambda += dl;
          a.p = add(a.p, mul(d, wa * dl / L)); b.p = add(b.p, mul(d, -wb * dl / L));
        }
        applyPins();
        ns.forEach(collide);solveSurface();solveTableFriction();
      }
      applyPins();ns.forEach(collide);
      // Recompute velocities after all contact projections, rather than feeding a late correction into the next step.
      ns.forEach((n,i)=>{n.v=mul(sub(n.p,old[i]),Math.exp(-.9*dt)/dt);for(const normal of contactNormals.get(i)||[])n.v=sub(n.v,mul(normal,.85*dot(n.v,normal)));if(hits.has(i)){const v=mt(table.R,n.v);v[0]*=.82;v[1]*=.82;n.v=mv(table.R,v);}const speed=len(n.v);if(speed>2)n.v=mul(n.v,2/speed);});
      c.reactions = {};const rollTorque={};
      for (const a of attachments) {
        const force=mul(a.lambda,1/(dt*dt)),onHand=mul(force,-1),point=a.ids.reduce((p,i,k)=>add(p,mul(ns[i].p,a.w[k])),[0,0,0]);
        const r=c.reactions[a.side]||(c.reactions[a.side]={force:[0,0,0],torque:[0,0,0],load:0,at:ns[pins.get(a.side).i].p});
        const currentPin=pins.get(a.side),patchCentre=currentPin.points.filter((_,i)=>i%3===0).reduce((p,q)=>add(p,mul(ns[q.ids[0]].p,1/currentPin.layers)),[0,0,0]);
        rollTorque[a.side]=(rollTorque[a.side]||0)+mt(W.handPose(a.side).R,cross(sub(point,patchCentre),onHand))[1];
        r.force=add(r.force,onHand);r.torque=add(r.torque,cross(sub(point,W.hands[a.side].body.t),onHand));r.load+=len(onHand);Cable.react(W.hands[a.side].body,onHand,point,dt);
      }
      // Unresolved bending inside a terry pad patch yields under the measured contact moment.
      // Translation and sideways twist remain constrained; no fabric node follows a task target.
      if(c.pile)for(const [side,pin]of pins){const torque=rollTorque[side]||0,rate=Math.sign(torque)*Math.min(3,600*Math.max(0,Math.abs(torque)-.0004));pin.roll+=rate*dt;}
      for(const [side,pin] of pins){const pose=W.handPose(side);const centre=pin.points.filter((_,i)=>i%3===0).reduce((p,q)=>add(p,mul(ns[q.ids[0]].p,1/pin.layers)),[0,0,0]);if(len(sub(centre,add(pose.t,mv(pose.R,pin.local))))>.035)pins.delete(side);}
      if (ns.every((n) => n.p[2] < table.t[2] - 0.15) && pins.size === 0) { c.reset(); W.respawns++; }
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
  return { handles, faceContact, towel, shirt:(spec,table)=>towel({...spec,kind:'shirt'},table), folded, radius, N };
});
