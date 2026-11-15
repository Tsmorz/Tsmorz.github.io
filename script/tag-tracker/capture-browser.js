// task shot -- /tag-tracker/ --eval-file script/tag-tracker/capture-browser.js (also --phone)
(async()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms)),assert=(ok,message)=>{if(!ok)throw Error(message);};
  const wait=async(f,message)=>{const end=Date.now()+7000;while(!f()){if(Date.now()>end)throw Error(message);await sleep(30);}};
  document.querySelectorAll('dialog[open]').forEach(d=>d.close());setMode('tasks');await sleep(300);
  assert(taskHapticSettings.level===75&&$('taskHapticLevel').textContent==='75%','drive defaults to a visible 75 percent');
  const W=await import('/haptography/wire.js'),commands=[],parser=new W.StreamReader();parser.synced=true;
  let input,timer,packet=0,seq=0,t=1000000,speed=0,pitchSpeed=0,rollSpeed=0,imu=true,closed=false;
  let sensorR=[1,0,0,0,1,0,0,0,1];
  const emit=(type,body)=>input.enqueue(W.encodePacket(type,packet++&65535,body));
  const info=()=>emit(W.INFO,W.encodeInfo({version:4,t_us:t,board_id:0x1bde,imu_rate_hz:1000,gyro_dps_per_lsb:.01,accel_g_per_lsb:.0001,mic_rate_hz:16000,tof_budget_ms:15,tof_distance_mode:1,flags:9,haptic_rate_hz:16000,erm_step_us:0,clip_max_samples:96000,clip_max_erm:0}));
  const port={
    async open(){
      this.readable=new ReadableStream({start(c){input=c;c.enqueue(new Uint8Array([0]));},cancel(){clearInterval(timer);}});
      this.writable=new WritableStream({write(bytes){for(const p of parser.feed(bytes)){commands.push(p);emit(W.ACK,W.encodeAck({command_type:p.type,command_number:p.number,status:0}));}}});
      info();timer=setInterval(()=>{
        const turn=C.rodrigues([pitchSpeed,rollSpeed,speed].map(v=>v*Math.PI/180*.001));
        const samples=Array.from({length:10},(_,i)=>{
          sensorR=C.mul3(sensorR,turn);
          const accel=C.mulv(C.tr3(sensorR),[0,0,1.04]).map(v=>Math.round(v/.0001));
          return {dt_us:i*1000,gyro:[Math.round((pitchSpeed+.78+.6*Math.sin(2*Math.PI*20*(t+i*1000)/1e6))/.01),Math.round((rollSpeed-3.02+.42*Math.sin(2*Math.PI*17*(t+i*1000)/1e6))/.01),Math.round((speed+.11+1.03*Math.sin(2*Math.PI*13*(t+i*1000)/1e6))/.01)],accel};
        });
        if(imu)emit(W.IMU,W.encodeImu(t,seq,samples));t+=10000;seq+=10;
        if(seq%500===0)info();
      },10);
    },
    async close(){clearInterval(timer);closed=true;}
  };
  Object.defineProperty(navigator,'serial',{configurable:true,value:{requestPort:async()=>port}});
  $('gameController').click();$('ctlCapture').click();
  await wait(()=>S.boards.some(b=>b.transport==='capture'),'capture connection');
  const b=S.boards.find(b=>b.transport==='capture');
  const select=()=> $('ctlBoards').querySelector('select');
  select().value='1';select().dispatchEvent(new Event('change'));await sleep(50);
  $('ctlBoards').querySelector('[data-test-haptic]').click();await sleep(50);
  assert(commands.length===0,'test pulse stays muted during stationary calibration');
  await wait(()=>b.motion?.calibrationS>.3,'visible calibration progress');
  assert($('ctlStatus').textContent===TASK_DATA.haptics.calibrating,'task feedback reports its calibration pause');
  await wait(()=>b.motion?.ready,'stationary gyro calibration with real-sized noise');
  assert(b.n>=2000&&b.buf.length===0&&b.track===null,'native capture IMU is estimated without entering TP/VQF fusion');
  const arm=RB.scene.arms.find(a=>a.side===1),drive=driveOf(arm);drive.open=.6;
  const position=drive.t.slice(),other=RCORE.fk(RB.scene.m,-1,RB.scene.arms.find(a=>a.side===-1).q).R;
  const checkPitchRoll=async side=>{
    for(const [motion,axis] of [['pitch',[0,1,0]],['roll',[-1,0,0]]]){
      $('ctlBoards').querySelector('[data-capture-zero]').click();
      const base=b.captureControl.last.slice(),want=C.mulv(RB.scene.chest.R,axis),upper=RB.slew.get(side).q.slice(0,4);
      if(motion==='pitch')pitchSpeed=35;else rollSpeed=35;
      await sleep(450);pitchSpeed=rollSpeed=0;await sleep(150);
      const target=C.so3Log(C.mul3(b.captureControl.last,C.tr3(base)));
      assert(C.norm(target)>.15&&target.reduce((s,v,i)=>s+v*want[i],0)/C.norm(target)>.99,`${motion} uses its cable-based axis on side ${side}`);
      const R=C.mul3(RB.scene.chest.R,RCORE.fk(RB.scene.m,side,RB.scene.arms.find(a=>a.side===side).q).R),physical=C.so3Log(C.mul3(R,C.tr3(base)));
      assert(C.norm(physical)>.12&&physical.reduce((s,v,i)=>s+v*want[i],0)/C.norm(physical)>.98,`rendered ${motion} follows the correct axis on side ${side}`);
      assert(C.norm(C.sub(RB.slew.get(side).q.slice(0,4),upper))<1e-8,`${motion} does not turn the arm on side ${side}`);
      if(motion==='pitch')pitchSpeed=-35;else rollSpeed=-35;
      await sleep(450);pitchSpeed=rollSpeed=0;await sleep(400);
    }
  };
  await checkPitchRoll(1);
  $('ctlBoards').querySelector('[data-capture-zero]').click();assert(b.captureControl.neutral,'neutral calibration');
  const base=b.captureControl.last.slice();speed=45;await sleep(650);speed=0;await sleep(300);
  const target=b.captureControl.last.slice(),delta=C.angleOf(C.mul3(C.tr3(base),target));
  assert(delta>.3&&delta<.8,'gyro rotation reaches the mapped hand target');
  assert(C.norm(C.sub(drive.t,position))<1e-10&&drive.open===.6,'IMU rotation preserves mouse position and gripper opening');
  const physical=C.mul3(RB.scene.chest.R,RCORE.fk(RB.scene.m,1,RB.scene.arms.find(a=>a.side===1).q).R);
  assert(C.angleOf(C.mul3(C.tr3(base),physical))>.1,'real IK and motor slew rotate the rendered gripper');
  assert(C.angleOf(C.mul3(C.tr3(other),RCORE.fk(RB.scene.m,-1,RB.scene.arms.find(a=>a.side===-1).q).R))<.01,'other hand retains its orientation');
  const upper=RB.slew.get(1).q.slice(0,4),m=RB.scene.m;
  speed=120;await sleep(2500);speed=0;await sleep(700);
  const stopped=RB.slew.get(1).q,actual=RB.scene.arms.find(a=>a.side===1).q;
  assert(C.norm(C.sub(stopped.slice(0,4),upper))<1e-8,'turning beyond the wrist stop never moves shoulder or elbow commands');
  assert(Math.abs(stopped[5]-RCORE.JOINTS[5].hi)<.01&&stopped.slice(4).every((v,i)=>v>=RCORE.JOINTS[i+4].lo-1e-8&&v<=RCORE.JOINTS[i+4].hi+1e-8),'chip yaw stops at the wrist limit after more than half a turn');
  assert(actual.slice(4).every((v,i)=>v>=RCORE.JOINTS[i+4].lo-1e-8&&v<=RCORE.JOINTS[i+4].hi+1e-8)&&C.norm(C.sub(RCORE.fk(m,1,actual).elbow,RCORE.fk(m,1,stopped).elbow))<.005,'the physical/rendered hand also respects stops without twisting the elbow');
  $('ctlBoards').querySelector('[data-test-haptic]').click();await wait(()=>commands.some(p=>p.type===0x44&&p.body[0]===1&&p.body[1]===75),'concurrent haptic ACK');
  assert($('ctlConnectionStatus').textContent===TASK_DATA.haptics.test_sent.replace('{level}','75'),'test pulse reports the actual 75 percent command');
  $('taskHapticStrength').value=37;$('taskHapticStrength').dispatchEvent(new Event('input'));
  $('ctlBoards').querySelector('[data-test-haptic]').click();await wait(()=>commands.some(p=>p.type===0x44&&p.body[1]===37),'test pulse follows the selected drive percentage');
  assert($('gameHaptics').textContent.includes('37%'),'toolbar shows selected percentage');
  $('taskHapticStrength').value=75;$('taskHapticStrength').dispatchEvent(new Event('input'));
  // Recenter while the fingers are stacked: chip yaw must still be vertical-axis yaw.
  taskLevel('bowl');await sleep(250);
  const rolled=RCORE.HOME.slice();rolled[4]=Math.PI/2;
  const rolledDrive=driveOf(RB.scene.arms.find(a=>a.side===1));
  rolledDrive.R=C.mul3(RB.scene.chest.R,RCORE.fk(RB.scene.m,1,rolled).R);await sleep(1200);
  $('ctlBoards').querySelector('[data-capture-zero]').click();
  const rolledBase=b.captureControl.last.slice(),up=C.mulv(RB.scene.chest.R,[0,0,1]);
  speed=45;await sleep(650);speed=0;await sleep(400);
  const yawAxis=C.so3Log(C.mul3(b.captureControl.last,C.tr3(rolledBase)));
  assert(C.norm(yawAxis)>.3&&yawAxis.reduce((s,v,i)=>s+v*up[i],0)/C.norm(yawAxis)>.99,'Set neutral with stacked fingers does not turn chip yaw into pitch');
  const rendered=C.mul3(RB.scene.chest.R,RCORE.fk(RB.scene.m,1,RB.scene.arms.find(a=>a.side===1).q).R),renderedAxis=C.so3Log(C.mul3(rendered,C.tr3(rolledBase)));
  assert(C.norm(renderedAxis)>.2&&renderedAxis.reduce((s,v,i)=>s+v*up[i],0)/C.norm(renderedAxis)>.98,'the rendered stacked gripper also yaws about robot up');
  const epoch=b.motion.epoch;imu=false;await sleep(250);assert(b.captureControl.paused,'stale IMU pauses control even while INFO continues');
  const held=b.captureControl.last.slice();imu=true;
  await wait(()=>b.motion.ready&&b.motion.epoch>epoch,'IMU recovery calibration');await sleep(100);assert(JSON.stringify(b.captureControl.last)===JSON.stringify(held),'recovered stream waits for a new neutral pose');
  assert(b.captureControl.recenterRequired&&captureControlState(b)===TASK_DATA.link.capture_paused,'a true stream reset explains why neutral is required');
  $('ctlBoards').querySelector('[data-capture-zero]').click();assert(!b.captureControl.paused,'explicit recenter resumes control');
  const neutral=b.captureControl.neutral,focused=Object.getOwnPropertyDescriptor(document,'hasFocus'),visible=Object.getOwnPropertyDescriptor(document,'hidden');
  try{
    Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>false});
    window.dispatchEvent(new Event('blur'));await sleep(100);
    assert(b.captureControl.paused&&!b.captureControl.recenterRequired,'leaving the window holds orientation without invalidating neutral');
    assert(captureControlState(b)===TASK_DATA.link.capture_suspended,'temporary pause promises automatic resume');
    const away=b.captureControl.last.slice();speed=-40;await sleep(350);speed=0;await sleep(100);
    assert(JSON.stringify(b.captureControl.last)===JSON.stringify(away),'the gripper target holds while the window is unfocused');
    if(focused)Object.defineProperty(document,'hasFocus',focused);else delete document.hasFocus;
    window.dispatchEvent(new Event('focus'));await wait(()=>!b.captureControl.paused,'focus return resumes without Set neutral');await sleep(400);
    assert(b.captureControl.neutral===neutral&&C.angleOf(C.mul3(b.captureControl.last,C.tr3(away)))>.15,'returning follows motion made while away using the original neutral');
    const returned=C.mul3(RB.scene.chest.R,RCORE.fk(RB.scene.m,1,RB.scene.arms.find(a=>a.side===1).q).R);
    assert(C.angleOf(C.mul3(returned,C.tr3(away)))>.1,'the rendered gripper resumes orientation too');
    Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));await sleep(100);
    assert(b.captureControl.paused,'a hidden page holds the orientation');
    if(visible)Object.defineProperty(document,'hidden',visible);else delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));await wait(()=>!b.captureControl.paused,'visible page resumes without Set neutral');
    assert(b.captureControl.neutral===neutral,'visibility preserves the original neutral');
    $('gameSettingsBtn').click();await sleep(100);assert(b.captureControl.paused,'task settings hold orientation');
    $('gameSettingsClose').click();await wait(()=>!b.captureControl.paused,'closing task settings resumes orientation');
    assert(b.captureControl.neutral===neutral,'task settings do not need another neutral');
  }finally{
    if(focused)Object.defineProperty(document,'hasFocus',focused);else delete document.hasFocus;
    if(visible)Object.defineProperty(document,'hidden',visible);else delete document.hidden;
  }
  select().value='-1';select().dispatchEvent(new Event('change'));assert(!b.captureControl.neutral,'hand remapping clears the old neutral');
  $('ctlBoards').querySelector('[data-capture-zero]').click();assert(b.captureControl.neutral?.side===-1,'other hand can be calibrated independently');
  const right=b.captureControl.last.slice();speed=-40;await sleep(400);speed=0;await sleep(150);
  assert(C.angleOf(C.mul3(C.tr3(right),b.captureControl.last))>.15,'right-hand orientation follows its mapping');
  await checkPitchRoll(-1);
  setMode('track');assert(b.captureControl.paused,'leaving Tasks pauses orientation even when Tracking draws tags');
  const tabNeutral=b.captureControl.neutral;
  setMode('tasks');await wait(()=>!b.captureControl.paused,'returning to Tasks automatically resumes orientation');
  assert(b.captureControl.neutral===tabNeutral,'switching tabs preserves the neutral pose');
  taskLevel('sort');assert(!b.captureControl.neutral,'task changes clear IMU calibration');
  await b.serialLink.close();assert(closed&&b.state!=='live'&&!b.hapticCharacteristic,'disconnect releases motion and haptic transport');
  assert($('ctlConnectionStatus').textContent===TASK_DATA.link.capture_lost,'disconnect replaces the active-orientation notice');
  assert(document.documentElement.scrollWidth<=innerWidth+1,'controller panel fits viewport');
  return {passed:true,protocol:4,gyroCalibration:true,physicalPitchRoll:true,physicalOrientation:true,positionPreserved:true,haptics:true,focusResume:true,visibilityResume:true,settingsResume:true,tabResume:true,streamResetRequiresNeutral:true,remapping:true,viewport:[innerWidth,innerHeight]};
})()
