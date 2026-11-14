// Discrete elastic cable: XPBD stretch/bend, gravity, contact and two-way endpoint forces.
// A coarse rod approximation (no torsional wire bundle or electrical model). SI units, no DOM.
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./tracker-core'),require('./physics-core'));
  else root.CableCore=factory(root.TagCore,root.PhysicsCore);
})(typeof self!=='undefined'?self:this,function(C,P){
  'use strict';
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const add=C.add,sub=C.sub,mul=(a,s)=>a.map(v=>v*s),len=C.norm,mv=C.mulv,mt=(R,p)=>mv(C.tr3(R),p);
  // Equal and opposite impulses are applied at their attachment points. A guard limits only a pathological
  // solver impulse, never positions; the rigid solver handles the resulting contact and gripper deflection.
  function react(b,force,point,dt){
    if(!b||b.fixed)return;
    const L=len(force),f=L>15?mul(force,15/L):force;
    if(len(f)<.00001)return;
    b.asleep=false;b.still=0;
    const pending=b.externalImpulse||(b.externalImpulse={linear:[0,0,0],angular:[0,0,0]});
    pending.linear=add(pending.linear,mul(f,dt));pending.angular=add(pending.angular,mul(cross(sub(point,b.t),f),dt));
  }
  function cable(spec,table,plug,anchorBody=null){
    const N=spec.resolution||33,radius=spec.radius||.0016,mass=spec.mass||.025,pins=new Map(),edges=[];
    const at=p=>add(table.t,mv(table.R,p)),origin=add(plug.t,mv(plug.R,plug.off)),a=add(origin,mv(plug.R,[-.020,0,0])),b=anchorBody?add(anchorBody.t,mv(anchorBody.R,add(anchorBody.off,spec.anchor_local||[-.020,0,0]))):at(spec.anchor),axis=sub(b,a),side=mv(table.R,[0,spec.loop_direction===-1?-1:1,0]);
    const curve=amp=>Array.from({length:N},(_,i)=>{const t=i/(N-1);return add(add(a,mul(axis,t)),mul(side,amp*Math.sin(Math.PI*t)));});
    const arclength=ps=>ps.slice(1).reduce((s,p,i)=>s+len(sub(p,ps[i])),0);
    let lo=0,hi=.5;for(let i=0;i<35;i++){const mid=(lo+hi)/2;if(arclength(curve(mid))<(spec.length||.48))lo=mid;else hi=mid;}
    const start=curve((lo+hi)/2),c={key:spec.key,label:spec.label,color:spec.color||'#343e4b',radius,pins,nodes:[],reactions:{},touched:new Set(),plug,anchorBody,bend:spec.bend_stiffness||0};
    const link=(a,b,compliance)=>edges.push({a,b,rest:len(sub(start[a],start[b])),compliance,lambda:0});
    for(let i=0;i<N-1;i++)link(i,i+1,1e-7);
    if(!c.bend)for(let i=0;i<N-2;i++)link(i,i+2,.003);
    const segment=arclength(start)/(N-1),bendCompliance=c.bend?segment**3/c.bend:0;
    c.edges=edges;c.reset=()=>{c.nodes=start.map(p=>({p:p.slice(),v:[0,0,0]}));pins.clear();c.touched.clear();c.reactions={};};c.reset();
    c.step=(dt,W)=>{
      const ns=c.nodes,invM=N/mass,old=ns.map(n=>n.p.slice());c.reactions={};
      for(const [s,h] of Object.entries(W.hands)){
        if(pins.has(s)&&(h.target>.025||h.grip))pins.delete(s);
        if(!pins.has(s)&&!h.grip&&h.target<.012&&!W.cloths.some(q=>q.pins.has(s))){
          const pose=W.handPose(s);let best=null;
          for(let i=2;i<N-2;i++){
            if([...pins.values()].some(p=>p.i===i))continue;
            const p=mt(pose.R,sub(ns[i].p,pose.t)),d=Math.hypot(p[0],p[1],p[2]+.0925);
            if(Math.abs(p[0])<.018&&Math.abs(p[1])<Math.max(.009,h.gap/2)&&p[2]<-.06&&p[2]>-.12&&(!best||d<best.d))best={i,local:p,d};
          }
          if(best){pins.set(s,best);c.touched.add(+s);}
        }
      }
      for(const s of pins.keys())if(!W.hands[s])pins.delete(s);
      const anchor=anchorBody?add(W.poseOf(anchorBody).t,mv(anchorBody.R,spec.anchor_local||[-.020,0,0])):b;
      const fixed=new Map([[0,add(W.poseOf(plug).t,mv(plug.R,[-.020,0,0]))],[N-1,anchor]]);
      for(const [s,p] of pins)fixed.set(p.i,add(W.handPose(s).t,mv(W.handPose(s).R,p.local)));
      ns.forEach(n=>{n.v[2]-=9.81*dt;n.p=add(n.p,mul(n.v,dt));});edges.forEach(e=>e.lambda=0);const bends=Array.from({length:N-2},()=>[0,0,0]);
      for(let it=0;it<10;it++){
        for(const e of edges){
          const delta=sub(ns[e.a].p,ns[e.b].p),L=len(delta);if(L<1e-9)continue;
          const wa=fixed.has(e.a)?0:invM,wb=fixed.has(e.b)?0:invM,alpha=e.compliance/(dt*dt);
          const dl=(-(L-e.rest)-alpha*e.lambda)/(wa+wb+alpha);e.lambda+=dl;
          ns[e.a].p=add(ns[e.a].p,mul(delta,wa*dl/L));ns[e.b].p=add(ns[e.b].p,mul(delta,-wb*dl/L));
        }
        if(c.bend)for(let i=1;i<N-1;i++)for(let axis=0;axis<3;axis++){
          const ids=[i-1,i,i+1],gradient=[1,-2,1],weights=ids.map(j=>fixed.has(j)?0:invM),alpha=bendCompliance/(dt*dt);
          const value=ns[i-1].p[axis]-2*ns[i].p[axis]+ns[i+1].p[axis],dl=(-value-alpha*bends[i-1][axis])/(weights[0]+4*weights[1]+weights[2]+alpha);
          bends[i-1][axis]+=dl;ids.forEach((j,k)=>ns[j].p[axis]+=weights[k]*gradient[k]*dl);
        }
        for(let i=0;i<N;i++){
          const n=ns[i];if(fixed.has(i)){n.p=fixed.get(i).slice();continue;}
          if(W.tableBox){const k=P.sphereBox(n.p,radius,W.tableBox,W.tableBox.h);if(k.dist<0)n.p=add(n.p,mul(k.n,-k.dist));}
          n.p[2]=Math.max(n.p[2],W.floorZ+radius);
          for(const body of W.bodies){
            if(len(sub(n.p,body.t))>body.bound+radius)continue;
            const local=sub(mt(body.R,sub(n.p,body.t)),body.off),d=P.bodyDistance(body,local)-radius;
            if(d<0)n.p=add(n.p,mul(mv(body.R,P.bodyNormal(body,local)),-d));
          }
          for(let j=0;j<i-2;j++){
            const d=sub(n.p,ns[j].p),L=len(d);if(L>1e-9&&L<2*radius)n.p=add(n.p,mul(d,(2*radius-L)/L));
          }
        }
      }
      const loads=new Map();
      for(const e of edges){const d=sub(ns[e.a].p,ns[e.b].p),L=len(d)||1;
        for(const [i,sign] of [[e.a,1],[e.b,-1]])if(fixed.has(i))loads.set(i,add(loads.get(i)||[0,0,0],mul(d,sign*e.lambda/(dt*dt*L))));
      }
      if(c.bend)for(let i=1;i<N-1;i++)for(const [j,sign] of [[i-1,1],[i,-2],[i+1,1]])if(fixed.has(j))loads.set(j,add(loads.get(j)||[0,0,0],mul(bends[i-1],sign/(dt*dt))));
      c.tension=len(loads.get(0)||[0,0,0]);if(anchorBody)react(anchorBody,loads.get(N-1)||[0,0,0],ns[N-1].p,dt);react(plug,loads.get(0)||[0,0,0],ns[0].p,dt);
      for(const [s,p] of pins){const f=loads.get(p.i)||[0,0,0];c.reactions[s]={force:f,load:len(f),at:ns[p.i].p};react(W.hands[s].body,f,ns[p.i].p,dt);}
      ns.forEach((n,i)=>{n.v=mul(sub(n.p,old[i]),.995/dt);if(W.tableBox&&P.sphereBox(n.p,radius,W.tableBox,W.tableBox.h).dist<.0001){const v=mt(table.R,n.v);v[0]*=.85;v[1]*=.85;n.v=mv(table.R,v);}const L=len(n.v);if(L>3)n.v=mul(n.v,3/L);});
    };
    return c;
  }
  // Socket walls/tongue are ordinary rigid contacts. This adds only axial friction and a compliant detent,
  // not a snap, kinematic alignment or a latch. Either 180-degree USB-C roll fits; a quarter turn does not.
  function insertion(W,plug,port,spec={}){
    const pose=W.poseOf(plug),socket=socketPose(W,port,spec),R=C.mul3(C.tr3(socket.R),pose.R),p=mt(socket.R,sub(pose.t,socket.t)),tip=add(p,mv(R,[spec.kind==='mains'?.039:.028,0,0]));
    const mains=spec.kind==='mains',depth=tip[0],aligned=R[0]>.996&&Math.abs(R[4])>.99&&Math.abs(tip[1])<(mains?.001:.0009)&&Math.abs(tip[2])<.001;
    const seated=aligned&&depth>(mains?.015:.007)&&depth<(mains?.019:.0095),relative=sub(add(plug.v,mulCross(plug.w,sub(pose.t,plug.t))),add(port.v,mulCross(port.w,sub(pose.t,port.t)))),vel=mt(socket.R,relative)[0];
    if(aligned&&depth>0&&depth<(mains?.020:.010)){
      const k=depth>(mains?.013:.0055)?(mains?900:600):0,damping=mains?15:9,mass=1/(1/plug.m+(port.fixed?0:1/port.m));
      // Implicit spring/dashpot: an explicit dry-friction force reverses a 35 g plug every substep.
      const f=Math.max(-6,Math.min(6,(k*((mains?.017:.008)-depth)-damping*vel)/(1+damping*P.H/mass+k*P.H*P.H/mass))); react(plug,mv(socket.R,[f,0,0]),pose.t,P.H);react(port,mv(socket.R,[-f,0,0]),pose.t,P.H);
    }
    const previous=plug.insertion,latched=depth<.003?false:!!previous?.latched||seated;
    const clickAt=latched&&!previous?.latched?W.time:previous?.clickAt??null;
    return {depth,aligned,seated,latched,clickAt};
  }
  // Clip the four longitudinal shell edges to the socket. Contacts at the clipped endpoints give a
  // continuous sleeve manifold: sub-mm walls cannot fall between the general engine's surface samples.
  function sleeveContacts(W,plug,port,spec={}){
    const pp=W.poseOf(plug),sp=socketPose(W,port,spec),R=C.mul3(C.tr3(sp.R),pp.R),p=mt(sp.R,sub(pp.t,sp.t)),out=[];
    if(R[0]<.95)return out;
    let key=0;
    for(const y of [-.0042,.0042])for(const z of [-.0013,.0013]){
      const a=add(p,mv(R,[.020,y,z])),b=add(p,mv(R,[.028,y,z])),dx=b[0]-a[0];
      const lo=Math.max(0,-a[0]/dx),hi=Math.min(1,(.010-a[0])/dx);if(lo>hi)continue;
      for(const t of [lo,hi]){
        const q=add(a,mul(sub(b,a),t));if(Math.abs(q[1])>.008||Math.abs(q[2])>.0055)continue;
        for(const axis of [1,2])for(const sign of [-1,1]){
          const dist=(axis===1?.0046:.0015)-sign*q[axis],n=[0,0,0];n[axis]=-sign;
          if(dist<.004)out.push({A:plug,B:port,p:add(sp.t,mv(sp.R,q)),n:mv(sp.R,n),dist,mu:.25,key:'sleeve'+key});key++;
        }
      }
    }
    return out;
  }
  const mulCross=(a,b)=>cross(a,b);
  function socketPose(W,port,spec={}){const p=W.poseOf(port);return {R:C.mul3(p.R,spec.R||[1,0,0,0,1,0,0,0,1]),t:add(p.t,mv(p.R,spec.at||[0,0,0]))};}
  function mainsContacts(W,plug,port,spec={}){
    const pp=W.poseOf(plug),sp=socketPose(W,port,spec),R=C.mul3(C.tr3(sp.R),pp.R),p=mt(sp.R,sub(pp.t,sp.t)),out=[];if(R[0]<.95)return out;
    for(const sign of [-1,1]){
      const a=add(p,mv(R,[.020,sign*.0095,0])),b=add(p,mv(R,[.039,sign*.0095,0])),dx=b[0]-a[0],lo=Math.max(0,-a[0]/dx),hi=Math.min(1,(.020-a[0])/dx);if(lo>hi)continue;
      for(const [i,t] of [lo,hi].entries()){
        const q=add(a,mul(sub(b,a),t)),delta=[0,q[1]-sign*.0095,q[2]],L=len(delta);if(L>.008||L<1e-9)continue;
        const n=mul(delta,-1/L),dist=.00065-L;
        if(dist<.004)out.push({A:plug,B:port,p:add(sp.t,mv(sp.R,sub(q,mul(n,.002)))),n:mv(sp.R,n),dist,mu:.3,key:'mains'+sign+':'+i});
      }
    }return out;
  }
  return {cable,insertion,sleeveContacts,mainsContacts,socketPose,react};


});
