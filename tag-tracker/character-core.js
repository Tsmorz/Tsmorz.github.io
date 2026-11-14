// Retargeted CC0 character: CPU linear-blend skinning of a compact 14-segment rig. Physics and mouse hit points stay RobotCore's.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./tracker-core.js'),require('./robot-core.js'));else root.CharacterCore=factory(root.TagCore,root.RobotCore);})(typeof self!=='undefined'?self:this,function(C,R){
  'use strict';
  const I=[1,0,0,0,1,0,0,0,1],sub=C.sub,add=C.add,mv=C.mulv;
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],unit=a=>{const l=Math.hypot(...a)||1;return a.map(v=>v/l);};
  function load(meta,buffer){
    const read=(x,T)=>new T(buffer,x.offset,x.count);
    return {detailed:!!meta.detailed,groups:meta.groups,parts:meta.parts.map(p=>({...p,source:read(p.pos,Float32Array),sourceNormal:read(p.normal,Float32Array),joints:read(p.joints,Uint8Array),weights:read(p.weights,Float32Array),fingers:read(p.fingers,Float32Array),mesh:{pos:new Float32Array(p.pos.count),nrm:new Float32Array(p.normal.count),uv:p.uv?read(p.uv,Float32Array):null,idx:read(p.indices,Uint16Array)}}))};
  }
  function link(a,b){const z=unit(sub(a,b)),x=unit(cross([0,1,0],z)),y=cross(z,x);return {R:[x[0],y[0],z[0],x[1],y[1],z[1],x[2],y[2],z[2]],t:a};}
  function pose(character,m,arms,locomotion,headTilt){
    const L=locomotion||{floor:-.975,phase:0,speed:0},detailed=character.detailed,targets={body:{R:I,t:[-m.back-.04,0,.055],s:[.9,m.half/.151,.8]},head:{R:R.Ry(-(headTilt||0)*Math.PI/180),t:[-m.back-.015,0,m.up+.10],s:[.8,.8,.8]}};
    if(detailed){targets.body={R:I,t:[-m.back,0,.10],s:[1,1.05,.95]};targets.head={R:R.Ry(-(headTilt||0)*Math.PI/180),t:[-m.back,0,m.up+.115],s:[.9,.9,.9]};}
    for(const side of [1,-1]){
      const suffix=side===1?'L':'R',a=arms.find(a=>a.side===side)||{q:R.HOME},k=R.fk(m,side,a.q),hand=R.gripper(m);
      targets['upper'+suffix]={R:k.Ru,t:k.shoulder,length:m.upper,width:.95};
      targets['fore'+suffix]={R:k.Rf,t:k.elbow,length:m.fore,width:.85};
      targets['hand'+suffix]={R:k.R,t:k.wrist,s:detailed?[.9,.9,.9]:[.7,.8,.72],open:a.jaw===undefined?1:Math.min(1,a.jaw/hand.gapMax)};
      const leg=detailed?.30:.37,sole=detailed?character.groups.find(g=>g.name==='foot'+suffix).t[2]*.9:.02;
      const swing=Math.sin(L.phase+(side===1?0:Math.PI))*Math.min(1,L.speed/.2),hip=[-m.back,side*.09,detailed?-.29:-.24],foot=[-m.back+.1*swing,side*.09,L.floor+sole+.035*Math.max(0,swing)],d=sub(foot,hip),length=Math.hypot(...d),knee=add(add(hip,d.map(v=>v*.5)),unit([-d[2],0,d[0]]).map(v=>v*Math.sqrt(Math.max(0,leg**2-length**2/4))));
      targets['thigh'+suffix]={...link(hip,knee),length:leg,width:.85};targets['shin'+suffix]={...link(knee,foot),length:leg,width:.8};targets['foot'+suffix]={R:I,t:foot,s:detailed?[.9,.9,.9]:[.8,.8,.8]};
    }
    const palette=character.groups.map(g=>{const p=targets[g.name],s=p.s||[p.width,p.width,p.length/g.length];return {...p,s,rest:g.t,restR:C.tr3(g.R)};});
    for(const part of character.parts){
      const src=part.source,norm=part.sourceNormal,out=part.mesh.pos,on=part.mesh.nrm;
      for(let i=0;i<src.length/3;i++){
        const v=i*3,j=i*4;let px=0,py=0,pz=0,nx=0,ny=0,nz=0;
        for(let q=0;q<4;q++){
          const weight=part.weights[j+q];if(weight<1e-6)continue;
          const p=palette[part.joints[j+q]],A=p.restR,B=p.R,dx=src[v]-p.rest[0],dy=src[v+1]-p.rest[1],dz=src[v+2]-p.rest[2];
          let x=(A[0]*dx+A[1]*dy+A[2]*dz)*p.s[0],y=(A[3]*dx+A[4]*dy+A[5]*dz)*p.s[1],z=(A[6]*dx+A[7]*dy+A[8]*dz)*p.s[2];
          let a=(A[0]*norm[v]+A[1]*norm[v+1]+A[2]*norm[v+2])/p.s[0],b=(A[3]*norm[v]+A[4]*norm[v+1]+A[5]*norm[v+2])/p.s[1],c=(A[6]*norm[v]+A[7]*norm[v+1]+A[8]*norm[v+2])/p.s[2];
          if(p.open!==undefined&&part.fingers[i]!==0){const bend=(1-p.open)*Math.max(0,Math.min(1,(-z-.03)/.10))*(part.fingers[i]<0?.4:1.15),co=Math.cos(bend),si=Math.sin(bend),zz=z+.035,xx=x;x=xx*co+zz*si;z=-xx*si+zz*co-.035;const aa=a;a=aa*co+c*si;c=-aa*si+c*co;}
          px+=weight*(p.t[0]+B[0]*x+B[1]*y+B[2]*z);py+=weight*(p.t[1]+B[3]*x+B[4]*y+B[5]*z);pz+=weight*(p.t[2]+B[6]*x+B[7]*y+B[8]*z);
          nx+=weight*(B[0]*a+B[1]*b+B[2]*c);ny+=weight*(B[3]*a+B[4]*b+B[5]*c);nz+=weight*(B[6]*a+B[7]*b+B[8]*c);
        }
        out[v]=px;out[v+1]=py;out[v+2]=pz;const n=Math.hypot(nx,ny,nz)||1;on[v]=nx/n;on[v+1]=ny/n;on[v+2]=nz/n;
      }
    }
    return character.parts;
  }
  return {load,pose};
});
