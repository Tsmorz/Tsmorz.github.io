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
    const bendCompliance=spec.bend_compliance ?? .5;
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
        const p = [(i/(N-1)-.5)*width,(j/(rows-1)-.5)*height,radius];
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
    const c = { restTime:0, key:spec.key,kind:shirt?'shirt':'towel',color:spec.color,label:spec.label,N,rows,width,height,bodySpan,triangles,edges,pins,material,landmarks,table,weights,reactions:{},nodes:[],folds:new Set(),touched:new Set() };
    c.reset = () => { c.nodes = start.map((p) => ({ p:p.slice(),v:[0,0,0] }));pins.clear();c.folds.clear();c.touched.clear();c.reactions={};c.restTime=0; };
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
            let face=null;
            for(let t=0;t<triangles.length;t+=3)if(triangles.slice(t,t+3).includes(best.i)){face=triangles.slice(t,t+3);break;}
            if(face){
              const points=[{ids:[best.i],w:[1],local:best.local}];
              for(const i of face.filter(i=>i!==best.i)){
                const f=Math.min(.7,.008/Math.max(.001,len(sub(ns[i].p,ns[best.i].p)))),p=add(ns[best.i].p,mul(sub(ns[i].p,ns[best.i].p),f));
                points.push({ids:[best.i,i],w:[1-f,f],local:mt(pose.R,sub(p,pose.t))});
              }
              const matrix=points.flatMap((a,i)=>points.map((b,j)=>a.ids.reduce((s,id,k)=>s+(b.ids.includes(id)?weights[id]*a.w[k]*b.w[b.ids.indexOf(id)]:0),i===j?2e-8/(P.H*P.H):0)));
              pins.set(side,{i:best.i,local:best.local,points,inverse:inverse3(matrix)});c.touched.add(+side);
            }
          }
        }
      }
      for (const side of [...pins.keys()]) if (!W.hands[side]) pins.delete(side);
      const attachments=[];
      for(const [side,pin] of pins){const pose=W.handPose(side);for(const point of pin.points)attachments.push({...point,side,target:add(pose.t,mv(pose.R,point.local)),lambda:[0,0,0]});}
      const attached=new Set(attachments.flatMap(a=>a.ids));
      const applyPins=()=>{
        for(let start=0;start<attachments.length;start+=3){
          const patch=attachments.slice(start,start+3),inverse=pins.get(patch[0].side).inverse,alpha=2e-8/(dt*dt);
          const errors=patch.map(a=>{const point=a.ids.reduce((p,i,k)=>add(p,mul(ns[i].p,a.w[k])),[0,0,0]);return sub(sub(a.target,point),mul(a.lambda,alpha));});
          const deltas=patch.map((_,i)=>[0,1,2].map(k=>errors.reduce((s,e,j)=>s+inverse[i*3+j]*e[k],0)));
          patch.forEach((a,i)=>{
            const next=add(a.lambda,deltas[i]),cap=5*dt*dt,L=len(next),limited=L>cap?mul(next,cap/L):next,dl=sub(limited,a.lambda);a.lambda=limited;
            a.ids.forEach((id,k)=>{ns[id].p=add(ns[id].p,mul(dl,weights[id]*a.w[k]));});
          });
        }
      };
      // Supported, nearly still fabric can sleep, but capture checks above always run first.
      const supported=ns.filter(n=>{const q=mt(table.R,sub(n.p,table.t));return Math.abs(q[0])<table.size[0]/2&&Math.abs(q[1])<table.size[1]/2&&q[2]<radius+.006;}).length;
      if(!pins.size&&!W.bodies.length&&supported>ns.length*.3&&ns.every(n=>len(n.v)<.002))c.restTime+=dt;else c.restTime=0;
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
        if (!hash.has(key)) hash.set(key, []); hash.get(key).push({ p, j, other: true });
      }
      ns.forEach((n, i) => {
        const xyz = n.p.map((v) => Math.floor(v / cell));
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let d = -1; d <= 1; d++) {
          const key = hashKey(xyz[0] + a, xyz[1] + b, xyz[2] + d);
          for (const q of hash.get(key) || []) {
            if (!q.other && neighbours[i].has(q.j)) continue;
            const delta = sub(n.p, q.p), L = len(delta);
            if (L > 1e-8 && L < cell && !attached.has(i)) { n.p = add(n.p, mul(delta, (cell - L) / L)); normalAt(i,mul(delta,1/L)); }
          }
        }
        const key = hashKey(...xyz); if (!hash.has(key)) hash.set(key, []); hash.get(key).push({ p: n.p, j: i, other: false });
        collide(n, i);

      });
      // Build a local vertex/face candidate set once; solve it with stretch and attachment constraints,
      // so separating folded layers cannot leave a final, unsolved tensile strain.
      const faceCell=.025,faceHash=new Map(),faceKey=(x,y,z)=>x+','+y+','+z,faces=[],surfacePairs=[];
      for(const q of W.cloths)for(let t=0;t<q.triangles.length;t+=3){
        const ids=q.triangles.slice(t,t+3),ps=ids.map(i=>q.nodes[i].p),id=faces.length,min=[0,1,2].map(k=>Math.min(...ps.map(p=>p[k]))-.012),max=[0,1,2].map(k=>Math.max(...ps.map(p=>p[k]))+.012);faces.push({q,ids,min,max});
        const lo=min.map(v=>Math.floor(v/faceCell)),hi=max.map(v=>Math.floor(v/faceCell));
        for(let x=lo[0];x<=hi[0];x++)for(let y=lo[1];y<=hi[1];y++)for(let z=lo[2];z<=hi[2];z++){const key=faceKey(x,y,z);if(!faceHash.has(key))faceHash.set(key,[]);faceHash.get(key).push(id);}
      }
      for(let i=0;i<ns.length;i++){
        const nearby=[];
        for(const id of faceHash.get(faceKey(...ns[i].p.map(v=>Math.floor(v/faceCell))))||[]){
          const face=faces[id];if(ns[i].p.some((v,k)=>v<face.min[k]||v>face.max[k])||face.q===c&&face.ids.some(j=>neighbours[i].has(j)))continue;
          const near=faceContact(ns[i].p,...face.ids.map(j=>face.q.nodes[j].p),.3);if(!near||Math.abs(near.d)>.012)continue;
          nearby.push({i,...face,score:Math.abs(near.d)+.03*Math.max(0,-Math.min(...near.w))});
        }
        // A surface particle needs its nearest layers, not every overlapping triangle's duplicate contact.
        nearby.sort((a,b)=>a.score-b.score);surfacePairs.push(...nearby.slice(0,4));
      }
      const solveSurface=()=>{
        for(const {i,q,ids} of surfacePairs){
          const contact=faceContact(ns[i].p,...ids.map(j=>q.nodes[j].p));if(!contact||Math.abs(contact.d)>=2*radius)continue;
          const wa=attached.has(i)?0:weights[i],wb=ids.map(j=>q===c&&!attached.has(j)?weights[j]:0),denom=wa+wb.reduce((s,w,k)=>s+w*contact.w[k]**2,0);if(!denom)continue;
          const normal=mul(contact.n,contact.d<0?-1:1),penetration=2*radius-Math.abs(contact.d),dl=penetration/denom;
          ns[i].p=add(ns[i].p,mul(normal,wa*dl));ids.forEach((j,k)=>{q.nodes[j].p=sub(q.nodes[j].p,mul(normal,wb[k]*contact.w[k]*dl));if(q===c&&wb[k]>0)normalAt(j,normal);});normalAt(i,normal);
          if(q===c){
            // Coulomb friction between layers keeps a tucked sleeve supported while the body is folded.
            const surfaceMove=ids.reduce((d,j,k)=>add(d,mul(sub(ns[j].p,old[j]),contact.w[k])),[0,0,0]),relative=sub(sub(ns[i].p,old[i]),surfaceMove),tangent=sub(relative,mul(normal,dot(relative,normal))),L=len(tangent);
            if(L>1e-9){const impulse=mul(tangent,Math.min(L,.55*penetration)/(L*denom));ns[i].p=sub(ns[i].p,mul(impulse,wa));ids.forEach((j,k)=>{q.nodes[j].p=add(q.nodes[j].p,mul(impulse,wb[k]*contact.w[k]));});}
          }
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
        ns.forEach(collide);solveSurface();
      }
      // Coulomb friction is a position constraint too: damping velocity alone lets stretch constraints drag the
      // resting half of a towel sideways through a fold. Limit the correction by the normal contact impulse.
      for (const [i, normal] of tablePush) if (!attached.has(i)) {
        const delta = mt(table.R, sub(ns[i].p, old[i])), L = Math.hypot(delta[0], delta[1]);
        if (L > 1e-10) { const s = Math.min(1, 0.75 * normal / L); ns[i].p = sub(ns[i].p, mv(table.R, [delta[0] * s, delta[1] * s, 0])); }
      }
      applyPins();ns.forEach(collide);
      // Recompute velocities after all contact projections, rather than feeding a late correction into the next step.
      ns.forEach((n,i)=>{n.v=mul(sub(n.p,old[i]),Math.exp(-.9*dt)/dt);for(const normal of contactNormals.get(i)||[])n.v=sub(n.v,mul(normal,.85*dot(n.v,normal)));if(hits.has(i)){const v=mt(table.R,n.v);v[0]*=.82;v[1]*=.82;n.v=mv(table.R,v);}const speed=len(n.v);if(speed>2)n.v=mul(n.v,2/speed);});
      c.reactions = {};
      for (const a of attachments) {
        const force=mul(a.lambda,1/(dt*dt)),onHand=mul(force,-1),point=a.ids.reduce((p,i,k)=>add(p,mul(ns[i].p,a.w[k])),[0,0,0]);
        const r=c.reactions[a.side]||(c.reactions[a.side]={force:[0,0,0],torque:[0,0,0],load:0,at:ns[pins.get(a.side).i].p});
        r.force=add(r.force,onHand);r.torque=add(r.torque,cross(sub(point,W.hands[a.side].body.t),onHand));r.load+=len(onHand);Cable.react(W.hands[a.side].body,onHand,point,dt);
      }
      for(const [side,pin] of pins){const pose=W.handPose(side);if(len(sub(ns[pin.i].p,add(pose.t,mv(pose.R,pin.local))))>.035)pins.delete(side);}
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
    const flat = [0, 1, 2].map((i) => Math.max(...ns.map((n) => n.p[i])) - Math.min(...ns.map((n) => n.p[i])));
    return { x: x < 0.035, y: y < 0.035, compact: flat[2] < 0.045, edges: [x, y] };
  }
  function shirtFolded(c) {
    const ps=c.nodes.map(n=>mt(c.table.R,sub(n.p,c.table.t))),m=c.landmarks;
    const shoulder=m.shoulders.map(i=>ps[i]),mid=mul(add(...shoulder),.5),axis=sub(shoulder[0],shoulder[1]),length=len(axis),across=mul(axis,1/Math.max(.001,length));
    const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),sleeves=m.sleeves.map((ids,k)=>Math.abs(dot(sub(ps[m.cuffs[k]],mid),across))<c.bodySpan*.55&&ids.every(i=>Math.abs(dot(sub(ps[i],mid),across))<c.bodySpan/2+.025));
    const hem=m.hem.map((i,k)=>len(sub(ps[i],shoulder[k]))),span=[0,1,2].map(k=>Math.max(...ps.map(p=>p[k]))-Math.min(...ps.map(p=>p[k])));
    const body=m.hem.every((i,k)=>{const d=sub(ps[i],shoulder[k]);return Math.hypot(d[0],d[1])<.045&&Math.abs(d[2])<.04;}),compact=span[2]<.045,spread=length>c.bodySpan*.6&&span[0]>.075&&span[0]<c.width*.72&&span[1]>.11&&span[1]<c.bodySpan*1.35;
    return {x:body,y:false,body,sleeves,compact:compact&&spread,edges:hem,span,complete:body&&sleeves.every(Boolean)&&compact&&spread};
  }
  return { faceContact, towel, shirt:(spec,table)=>towel({...spec,kind:'shirt'},table), folded, radius, N };
});
