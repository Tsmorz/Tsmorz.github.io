// task shot -- /tag-tracker/ --eval-file script/tag-tracker/robot-visuals-browser.js (also --phone)
(async()=>{
  const wait=ms=>new Promise(r=>setTimeout(r,ms)),assert=(ok,msg)=>{if(!ok)throw Error(msg);};
  document.querySelectorAll('dialog[open]').forEach(d=>d.close());setMode('tasks');setRobotView('orbit');taskLevel('bowl');await wait(250);draw3d();
  const renderer=robotGL(),gl=$('plotGL').getContext('webgl');assert(renderer&&gl,'the actual WebGL renderer is active');
  assert(gl.getError()===gl.NO_ERROR,'the AMR, tubular mast and restored robot materials draw without WebGL errors');
  const m=RB.scene.m,floor=TB.world.floorZ-RB.scene.chest.t[2],layout=RobotGL.supportLayout(m,floor);
  assert(layout.wheels.length===4&&layout.wheels.every(w=>Math.abs(w.c[2]-w.r-floor)<1e-8),'the rendered AMR wheel layout meets the task floor');
  assert(layout.post.r<.04&&layout.post.c[2]+layout.post.h[2]>=m.up-.25,'one slender tube reaches the torso');
  assert(RobotGL.robotPalette.dark==='#24282e'&&[1,-1].every(s=>RobotGL.meshes(m).finger[s].every(p=>p.grip)),'black joints/fingers retain the complete gripper highlight region');
  const saved=RB.scene.arms.map(a=>({a,jaw:a.jaw,state:a.jawState})),draw=gl.drawElements;let compressedDraws=0;
  try{
    for(const {a}of saved){a.jaw=.012;a.jawState={carrierGap:.01,padCompression:{1:[.001,-.0008,-.0005],'-1':[-.0004,.0003,.0002]}};}
    gl.drawElements=function(...args){
      const program=gl.getParameter(gl.CURRENT_PROGRAM),normal=gl.getUniformLocation(program,'uRot');
      if(normal){
        const A=gl.getUniform(program,gl.getUniformLocation(program,'uModel')),N=gl.getUniform(program,normal),lengths=[0,1,2].map(i=>Math.hypot(A[i*4],A[i*4+1],A[i*4+2]));
        if(Math.max(...lengths)-Math.min(...lengths)>1e-4){
          for(let i=0;i<3;i++)for(let j=0;j<3;j++){let product=0;for(let k=0;k<3;k++)product+=A[i*4+k]*N[j*3+k];assert(Math.abs(product-(i===j?1:0))<5e-5,'compressed pad lighting uses the inverse-transpose of its actual nonuniform geometry');}
          compressedDraws++;
        }
      }
      return draw.apply(gl,args);
    };
    const {o,r}=plotOrbit();drawRobotGL(renderer,o,r.width,r.height,performance.now()/1000);
    assert(compressedDraws>=4&&gl.getError()===gl.NO_ERROR,'both asymmetric pads on both grippers draw correctly in the real shaded/depth passes');
  }finally{gl.drawElements=draw;for(const {a,jaw,state}of saved){a.jaw=jaw;a.jawState=state;}draw3d();}
  return {passed:true,blackAccents:true,coolSilver:true,fourWheels:true,thinContinuousMast:true,compressedDraws,webglErrors:0};
})()
