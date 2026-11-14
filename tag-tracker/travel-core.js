// Tiny-room locomotion: a swept circle against furniture and room bounds, with acceleration and braking. No DOM.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./tracker-core.js'));else root.TravelCore=factory(root.TagCore);})(typeof self!=='undefined'?self:this,function(C){
  'use strict';
  const I=[1,0,0,0,1,0,0,0,1], rz=a=>[Math.cos(a),-Math.sin(a),0,Math.sin(a),Math.cos(a),0,0,0,1];
  function create(room){const s=room.start||[-.8,-.45,0];return {x:s[0],y:s[1],yaw:s[2]||0,v:0,w:0,distance:0,roll:0,phase:0,blocked:false,room};}
  function clear(x,y,room,r){
    if(Math.abs(x)>room.half[0]-r||Math.abs(y)>room.half[1]-r)return false;
    for(const b of room.obstacles||[]){const dx=x-Math.max(b[0]-b[2],Math.min(b[0]+b[2],x)),dy=y-Math.max(b[1]-b[3],Math.min(b[1]+b[3],y));if(dx*dx+dy*dy<r*r-1e-10)return false;}
    return true;
  }
  function step(s,input,dt,actor){
    const d=Math.min(.1,Math.max(0,dt)), radius=actor==='teen'?.18:.22, speed=actor==='teen'?.65:.5, accel=actor==='teen'?1.8:1.2;
    const approach=(a,b,cap)=>a+Math.max(-cap,Math.min(cap,b-a));
    s.v=approach(s.v,Math.max(-1,Math.min(1,input.forward||0))*speed,accel*d);
    s.w=approach(s.w,Math.max(-1,Math.min(1,input.turn||0))*1.8,5*d);
    s.blocked=false;let travelled=0;
    // Swept substeps stay below 8 mm, including long frames: no tunnelling through a table corner.
    const n=Math.max(1,Math.ceil(Math.abs(s.v)*d/.008));
    for(let i=0;i<n;i++){
      s.yaw+=s.w*d/n;
      const dx=Math.cos(s.yaw)*s.v*d/n,dy=Math.sin(s.yaw)*s.v*d/n;
      let x=s.x+dx,y=s.y+dy;
      if(!clear(x,y,s.room,radius)){
        s.blocked=true;
        if(clear(x,s.y,s.room,radius))y=s.y;
        else if(clear(s.x,y,s.room,radius))x=s.x;
        else{x=s.x;y=s.y;}
      }
      travelled+=Math.hypot(x-s.x,y-s.y);s.x=x;s.y=y;
    }
    s.roll+=travelled*Math.sign(s.v);
    if(s.blocked)s.v=0;
    s.distance+=travelled;s.phase+=travelled*12;
    return travelled;
  }
  function transform(s,anchor){const R=C.mul3(C.mul3(anchor.R,rz(s.yaw)),C.tr3(anchor.R));return {R,t:C.sub(C.add(anchor.t,C.mulv(anchor.R,[s.x,s.y,0])),C.mulv(R,anchor.t))};}
  function docked(s,dock){return Math.hypot(s.x-dock[0],s.y-dock[1])<.17;}
  function roomGeometry(room,floor){
    const box=(p,h)=>({type:'box',p,h});
    const [x,y]=room.half;
    return [box([0,0,floor-.02],[x,y,.02]),box([x,0,floor+.22],[.018,y,.22]),box([0,y,floor+.22],[x,.018,.22])];
  }
  return {create,step,clear,transform,docked,roomGeometry,rz,I};
});
