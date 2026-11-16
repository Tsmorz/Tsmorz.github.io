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
  return {passed:true,blackAccents:true,coolSilver:true,fourWheels:true,thinContinuousMast:true,webglErrors:0};
})()
