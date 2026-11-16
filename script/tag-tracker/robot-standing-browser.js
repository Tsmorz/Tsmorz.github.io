// task shot -- /tag-tracker/ --eval-file script/tag-tracker/robot-standing-browser.js (also --phone)
(async()=>{
  const wait=ms=>new Promise(r=>setTimeout(r,ms)),assert=(ok,msg)=>{if(!ok)throw Error(msg);};
  document.querySelectorAll('dialog[open]').forEach(d=>d.close());
  setMode('calib');TB.world=null;TB.game=null;TB.sig='';robotReset();
  const m=RCORE.model(S.settings.robot),layout=RobotGL.supportLayout(m),height=layout.post.h[2]*2;
  assert(height>.65,'the calibration/preview model has a full standing mast before a task table exists');
  setMode('track');S.settings.show3d='robot';paintRobotBtns();draw3d();await wait(100);
  const renderer=robotGL(),gl=$('plotGL').getContext('webgl');
  assert(renderer&&gl&&gl.getError()===gl.NO_ERROR,'the standing preview draws through the actual WebGL renderer');
  const preview=RobotGL.supportLayout(RB.scene.m);
  setMode('tasks');taskLevel('bowl');draw3d();await wait(100);
  const task=RobotGL.supportLayout(RB.scene.m,TB.world.floorZ-RB.scene.chest.t[2]);
  assert(Math.abs(task.floor-preview.floor)<1e-8&&Math.abs(task.post.h[2]-preview.post.h[2])<1e-8,'Tracking and a fresh task use the same floor and full-height post');
  setMode('track');S.settings.show3d='robot';paintRobotBtns();draw3d();
  const again=RobotGL.supportLayout(RB.scene.m);
  assert(Math.abs(again.post.h[2]-task.post.h[2])<1e-8,'leaving Tasks preserves the standing height');
  fitView();draw3d();plot.scrollIntoView({block:'center'});
  return {passed:true,consistentStandingHeight:true,postHeight:height,webglErrors:gl.getError()};
})()
