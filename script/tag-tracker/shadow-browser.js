// Actual WebGL1 receiver-plane PCF regression: no physics, hidden cameras or device access.
// task shot -- /tag-tracker/ --eval-file script/tag-tracker/shadow-browser.js (also --phone)
(()=>{
  const assert=(ok,msg)=>{if(!ok)throw Error(msg);},canvas=document.createElement('canvas'),gl=canvas.getContext('webgl');assert(gl,'WebGL1 is available');
  const location=gl.getUniformLocation,uniform=gl.uniform1f;let shadowLocation,shadows=true;
  gl.getUniformLocation=function(program,name){const value=location.call(gl,program,name);if(name==='uShadowOn')shadowLocation=value;return value;};
  gl.uniform1f=function(where,value){return uniform.call(gl,where,where===shadowLocation&&!shadows?0:value);};
  const renderer=RobotGL.create(canvas),I=[1,0,0,0,1,0,0,0,1],base={w:256,h:256,dpr:1,fov:40,m:RCORE.model(),chest:{R:I,t:[0,0,0]},arms:[],body:false,mount:null,tags:[],game:true,theme:{dark:true,accent:'#9988ee',warn:'#ffeeaa',bg:'#000000'}};
  const render=(R,halfHeight,enabled)=>{
    shadows=enabled;const normal=C.mulv(R,[0,0,1]),bodies=[{key:'receiver',kind:'box',R,t:[0,0,0]}],compounds={receiver:[{type:'box',p:[0,0,0],h:[.24,.24,.002],bevel:0,material:'ceramic'}]};
    if(halfHeight){compounds.block=[{type:'box',p:[0,0,0],h:[.03,.03,halfHeight],bevel:0,material:'robotDark'}];bodies.push({key:'block',kind:'box',R,t:C.mulv(R,[0,0,.003+halfHeight])});}
    renderer.draw({...base,cam:{eye:normal.map(v=>v*.8),right:C.mulv(R,[1,0,0]),up:C.mulv(R,[0,1,0]),fwd:normal.map(v=>-v)},props:{dims:{table:{size:[.5,.9],thick:.03,legs:.72},ball:{r:.03},cup:{R:.05,Ri:.043,H:.13,floor:.01},compounds},table:null,bodies,shadows:[]}});
    const image=new Uint8Array(256*256*4);gl.readPixels(0,0,256,256,gl.RGBA,gl.UNSIGNED_BYTE,image);return image;
  };
  const compare=(a,b,unoccluded=null)=>{let sum=0,count=0,dark=0,peak=0;
    for(let y=56;y<200;y++)for(let x=56;x<200;x++){
      // The no-shadow images identify the actual visible block silhouette,
      // including antialiasing; a broad rectangle would hide its contact shadow.
      const i=(y*256+x)*4;if(unoccluded&&[0,1,2].some(k=>Math.abs(b[i+k]-unoccluded[i+k])>1))continue;
      if(a[i+3]!==255||b[i+3]!==255)continue;const delta=(b[i]+b[i+1]+b[i+2]-a[i]-a[i+1]-a[i+2])/3;
      sum+=Math.abs(delta);count++;if(delta>8)dark++;peak=Math.max(peak,delta);
    }
    return {mean:sum/count,dark,peak};
  };
  const cases=[];
  for(const R of [I,RCORE.Rx(-.6),C.mul3(RCORE.Rx(-.4),RCORE.Ry(.35))]){
    const lit=render(R,0,false),bare=compare(render(R,0,true),lit);
    assert(bare.mean<.5&&bare.dark===0,'an unoccluded sloped ceramic receiver has no self-shadow bands or checker acne: '+JSON.stringify(bare));
    const cast=compare(render(R,.025,true),render(R,.025,false),lit),contact=compare(render(R,.003,true),render(R,.003,false),lit);
    assert(cast.dark>25&&cast.peak>15,'a real elevated block still casts a shadow on the sloped receiver: '+JSON.stringify(cast));
    assert(contact.dark>3&&contact.peak>8,'a 6 mm block with 1 mm clearance retains its close contact shadow: '+JSON.stringify(contact));
    cases.push({bare,cast,contact});
  }
  assert(gl.getError()===gl.NO_ERROR,'receiver-plane shadows finish without WebGL errors');gl.getUniformLocation=location;gl.uniform1f=uniform;
  return {passed:true,webgl1:true,receiverPlane:true,cases};
})()
