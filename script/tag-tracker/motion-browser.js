// task shot -- /tag-tracker/ --eval-file script/tag-tracker/motion-browser.js (also --phone)
(async()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms)),assert=(ok,msg)=>{if(!ok)throw Error(msg);};
  document.querySelectorAll('dialog[open]').forEach(d=>d.close());setMode('tasks');setRobotView('orbit');await sleep(250);
  const slider=$('taskMotionScale'),value=$('taskMotionValue');
  const gain=n=>{slider.value=n;slider.dispatchEvent(new Event('input'));};
  assert(slider.getBoundingClientRect().height>0&&slider.closest('.game-actions'),'sensitivity slider is visible in the task bar');
  assert(slider.min==='0.1'&&slider.max==='5','fine movement and larger movement are both available');
  gain(.25);assert(value.textContent==='0.25×'&&$('robotScale').value==='0.25'&&store.get('settings').robot.scale===.25,'slider, Tracking selector and persisted gain agree');
  // Synthetic pointers use the real picking, ray/plane drag, reach and contact code. Native
  // pointer capture requires a trusted pointer, so only capture itself is stubbed here.
  const capture=plot.setPointerCapture;plot.setPointerCapture=()=>{};
  const grab=()=>{
    taskLevel('bowl');draw3d();
    const arm=RB.scene.arms.find(a=>a.side===1),p=gripPoint(RB.scene,arm),{o,r}=plotOrbit(),s=o.project(p);
    const e={pointerId:77,pointerType:'mouse',button:0,buttons:1,altKey:false,shiftKey:false,clientX:r.left+s[0],clientY:r.top+s[1]};
    assert(handGrab(e),'the actual gripper is picked');
    return {e,p,o,r,d:TB.drive.get(1),start:TB.drive.get(1).t.slice(),at:TB.grab.at.slice(),n:TB.grab.n};
  };
  try{
    for(const k of [.25,1,2]){
      gain(k);const g=grab(),e={...g.e,clientX:g.e.clientX+2};
      handMove(e);const first=g.d.t.slice();
      const end={...e,clientX:g.e.clientX+4};handMove(end);
      const travel=C.sub(rayHit(g.o,g.r,end,g.p,g.n),g.at),moved=C.sub(g.d.t,g.start);
      assert(C.norm(travel)>1e-5&&C.norm(C.sub(moved,travel.map(v=>v*k)))<1e-8,`mouse travel scales by ${k} without compounding`);
      assert(C.norm(C.sub(first,g.start))<C.norm(moved),'successive pointer moves continue smoothly');
      handDrop(g.e);
      // A calibrated wrist tag sees the same slider gain; turning it remains 1:1.
      for(const side of [1,-1]){
        const m=RB.scene.m,h=RCORE.fk(m,side,RCORE.HOME),cal=RCORE.calibrate(m,{arms:[{key:'w',side,pose:h}]},{toward:C.add(h.t,[1,0,0])});
        const delta=[.01,.004,.005],R=C.mul3(h.R,RCORE.Rz(.13)),poses={arms:{w:{R,t:C.add(h.t,delta)}}};
        const target=RCORE.targets(cal,poses,{scale:S.settings.robot.scale}).arms[0].target;
        assert(C.norm(C.sub(C.sub(target.t,h.t),delta.map(v=>v*k)))<1e-9,`AprilTag movement uses ${k} on side ${side}`);
        assert(C.angleOf(C.mul3(target.R,C.tr3(R)))<1e-7,'sensitivity does not scale wrist rotation');
      }
    }
    gain(.5);const g=grab(),e={...g.e,clientX:g.e.clientX+2};handMove(e);
    const before=g.d.t.slice(),seed=RB.prev.get('drive1');gain(2);
    assert(C.norm(C.sub(g.d.t,before))<1e-12&&RB.prev.get('drive1')===seed,'changing gain keeps the world target and IK seed');
    handMove(e);assert(C.norm(C.sub(g.d.t,before))<1e-9,'stationary pointer does not move after gain changes');
    const end={...e,clientX:g.e.clientX+4},at=TB.grab.at.slice();handMove(end);
    const travel=C.sub(rayHit(g.o,g.r,end,g.p,g.n),at);
    assert(C.norm(C.sub(C.sub(g.d.t,before),travel.map(v=>2*v)))<1e-8,'the new gain affects only subsequent pointer travel');
    const beforeAlt=g.d.t.slice();handMove({...end,altKey:true});
    assert(C.norm(C.sub(g.d.t,beforeAlt))<1e-12,'the retired Alt modifier does not move the gripper or change its drag plane');
    handDrop(g.e);
    gain(.5);const atKey=g.d.t.slice(),up=C.mulv(TB.world.table.R,[0,0,.006]);playNudge('up');
    assert(C.norm(C.sub(C.sub(g.d.t,atKey),up))<1e-9,'keyboard movement shares the sensitivity');
    gain(1);const edge=grab(),normal=edge.n;
    let dir=C.sub(edge.o.right,normal.map(v=>v*edge.o.right.reduce((s,x,i)=>s+x*normal[i],0)));
    dir=dir.map(v=>v/C.norm(dir));
    const wristAt=p=>C.sub(p,C.mulv(edge.d.R,[0,0,RCORE.gripper(RB.scene.m).finger.c[2]]));
    const shoulder=RCORE.place(RB.scene.chest,RCORE.fk(RB.scene.m,1,RCORE.HOME).shoulder);
    if(C.norm(C.sub(wristAt(C.add(edge.p,dir.map(v=>v*.7))),shoulder))<C.norm(C.sub(wristAt(C.sub(edge.p,dir.map(v=>v*.7))),shoulder)))dir=dir.map(v=>-v);
    const far=C.add(edge.p,dir.map(v=>v*.7)),eventAt=p=>{const s=edge.o.project(p);return {...edge.e,clientX:edge.r.left+s[0],clientY:edge.r.top+s[1]};};
    handMove(eventAt(far));const limited=edge.d.t.slice();
    assert(C.norm(C.sub(limited,shoulder))<=RCORE.reachOf(RB.scene.m)+1e-9,'a large mouse drag respects arm reach');
    handMove(eventAt(C.sub(far,dir.map(v=>v*.005))));
    assert(C.norm(C.sub(edge.d.t,limited))>.001&&Math.abs(C.sub(edge.d.t,limited).reduce((s,v,i)=>s+v*normal[i],0))<1e-9,'reversing away from the reach limit moves immediately inside the drag plane');
    handDrop(edge.e);
  }finally{plot.setPointerCapture=capture;TB.grab=null;}
  $('robotScale').value='2';$('robotScale').dispatchEvent(new Event('change'));
  assert(slider.value==='2'&&value.textContent==='2×','Tracking selector also updates the task bar');
  setMotionScale(1);assert(S.settings.robot.scale===1&&slider.value==='1'&&value.textContent==='1×','reset restores normal sensitivity');
  taskLevel('bowl');draw3d();
  assert(document.documentElement.scrollWidth<=innerWidth+1,'controls fit the viewport');
  return {passed:true,mouseGains:[.25,1,2],aprilTagGains:true,keyboardGain:true,noTargetJump:true,persisted:true,viewport:[innerWidth,innerHeight]};
})()
