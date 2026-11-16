// task shot -- /tag-tracker/ --eval-file script/tag-tracker/drag-plane-browser.js (also --phone)
(async()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms)),assert=(ok,msg)=>{if(!ok)throw Error(msg);};
  document.querySelectorAll('dialog[open]').forEach(d=>d.close());setMode('tasks');taskLevel('bowl');setMotionScale(1);await sleep(400);
  const el=$('dragPlaneGuide'),capture=plot.setPointerCapture;plot.setPointerCapture=()=>{};
  const begin=()=>{
    draw3d();const a=RB.scene.arms.find(a=>a.side===1),{o,r}=plotOrbit(),p=o.project(gripPoint(RB.scene,a));
    const e={pointerId:73,pointerType:'mouse',button:0,buttons:1,altKey:false,shiftKey:false,clientX:r.left+p[0],clientY:r.top+p[1]};
    handMove({...e,buttons:0});draw3d();assert(el.hidden,'hover alone does not show a plane');
    assert(handGrab(e),'the pointer takes the real gripper');draw3d();assert(!el.hidden&&el.getBoundingClientRect().height>0,'a drag shows the guide');
    return e;
  };
  const verify=()=>{
    const g=TB.grab,d=TB.drive.get(g.side),centre=C.add(d.t,C.mulv(d.R,[0,0,RCORE.gripper(RB.scene.m).finger.c[2]]));
    const corners=[...el.querySelector('polygon').points],expected=RCORE.dragPlaneGuide(centre,g.basis,g.n).corners.map(p=>RB.view.project(p));
    assert(corners.length===4&&corners.every((p,i)=>Math.hypot(p.x-expected[i][0],p.y-expected[i][1])<.15),'the guide uses the final camera at the constrained grasp point');
    assert(getComputedStyle(el).pointerEvents==='none','the guide cannot intercept dragging');
    return [...el.querySelectorAll('[data-drag-axis]')].map(n=>+n.dataset.dragAxis);
  };
  try{
    for(const view of ['orbit','eyes']){
      setRobotView(view);draw3d();const e=begin(),axes=verify(),d=TB.drive.get(1),before=d.t.slice();
      handMove({...e,clientX:e.clientX+8});draw3d();verify();
      const delta=C.sub(d.t,before);
      assert(C.norm(delta)>1e-5&&Math.abs(delta.reduce((s,v,i)=>s+v*TB.grab.n[i],0))<1e-9,'real pointer movement stays in the visible plane');
      const at=d.t.slice(),normal=TB.grab.n.slice();handMove({...e,clientX:e.clientX+8,altKey:true});draw3d();
      const changed=verify();assert(C.norm(C.sub(d.t,at))<1e-12,'Alt changes the plane without moving the target');
      assert(Math.abs(normal.reduce((s,v,i)=>s+v*TB.grab.n[i],0))<1e-9&&axes.join()!==changed.join(),'Alt replaces the visible movement axes with the new locked plane');
      const basis=TB.grab.basis.slice(),chest=RB.scene.chest.R;
      RB.scene.chest.R=C.mul3(RCORE.Rz(.3),chest);paintDragPlaneGuide(RB.view,plot.clientWidth,plot.clientHeight);verify();
      assert(C.norm(C.sub(TB.grab.basis,basis))<1e-12,'body movement cannot rotate an ongoing drag guide');RB.scene.chest.R=chest;
      handDrop({...e,pointerId:99});assert(!el.hidden,'another pointer cannot cancel the active drag');
      handDrop(e);assert(el.hidden&&!TB.grab,'release hides the guide immediately');
    }
    setRobotView('orbit');let e=begin();
    plot.dispatchEvent(new PointerEvent('pointercancel',{pointerId:e.pointerId,bubbles:true}));assert(el.hidden&&!TB.grab,'pointer cancellation hides the guide');
    e=begin();plot.dispatchEvent(new PointerEvent('lostpointercapture',{pointerId:e.pointerId,bubbles:true}));assert(el.hidden&&!TB.grab,'lost pointer capture hides the guide');
    begin();setMode('track');assert(el.hidden&&!TB.grab,'leaving Tasks hides the guide');
    setMode('tasks');await sleep(150);begin();taskLevel('sort');draw3d();assert(el.hidden&&!TB.grab,'a new task hides the guide');
    taskLevel('bowl');await sleep(150);e=begin();handMove({...e,clientX:e.clientX+12});draw3d();verify();
    assert(document.documentElement.scrollWidth<=innerWidth+1,'the overlay adds no page overflow');
    return {passed:true,outsideAndEyes:true,altPlane:true,constrainedProjection:true,lifecycle:true,viewport:[innerWidth,innerHeight]};
  }finally{plot.setPointerCapture=capture;}
})()
