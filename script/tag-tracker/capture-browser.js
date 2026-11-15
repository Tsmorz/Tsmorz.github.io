// task shot -- /tag-tracker/ --eval-file script/tag-tracker/capture-browser.js (also --phone)
(async()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms)),assert=(ok,message)=>{if(!ok)throw Error(message);};
  const wait=async(f,message)=>{const end=Date.now()+7000;while(!f()){if(Date.now()>end)throw Error(message);await sleep(30);}};
  document.querySelectorAll('dialog[open]').forEach(d=>d.close());setMode('tasks');await sleep(300);
  assert(taskHapticSettings.level===75&&$('taskHapticLevel').textContent==='75%','drive defaults to a visible 75 percent');
  const W=await import('/haptography/wire.js'),commands=[],parser=new W.StreamReader();parser.synced=true;
  let input,timer,packet=0,seq=0,t=1000000,speed=0,imu=true,closed=false;
  const emit=(type,body)=>input.enqueue(W.encodePacket(type,packet++&65535,body));
  const info=()=>emit(W.INFO,W.encodeInfo({version:4,t_us:t,board_id:0x1bde,imu_rate_hz:1000,gyro_dps_per_lsb:.01,accel_g_per_lsb:.0001,mic_rate_hz:16000,tof_budget_ms:15,tof_distance_mode:1,flags:9,haptic_rate_hz:16000,erm_step_us:0,clip_max_samples:96000,clip_max_erm:0}));
  const port={
    async open(){
      this.readable=new ReadableStream({start(c){input=c;c.enqueue(new Uint8Array([0]));},cancel(){clearInterval(timer);}});
      this.writable=new WritableStream({write(bytes){for(const p of parser.feed(bytes)){commands.push(p);emit(W.ACK,W.encodeAck({command_type:p.type,command_number:p.number,status:0}));}}});
      info();timer=setInterval(()=>{
        const samples=Array.from({length:10},(_,i)=>({dt_us:i*1000,gyro:[Math.round((.78+.6*Math.sin(2*Math.PI*20*(t+i*1000)/1e6))/.01),Math.round((-3.02+.42*Math.sin(2*Math.PI*17*(t+i*1000)/1e6))/.01),Math.round((speed+.11+1.03*Math.sin(2*Math.PI*13*(t+i*1000)/1e6))/.01)],accel:[0,0,10400]}));
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
  $('ctlBoards').querySelector('[data-capture-zero]').click();assert(b.captureControl.neutral,'neutral calibration');
  const base=b.captureControl.last.slice();speed=45;await sleep(650);speed=0;await sleep(300);
  const target=b.captureControl.last.slice(),delta=C.angleOf(C.mul3(C.tr3(base),target));
  assert(delta>.3&&delta<.8,'gyro rotation reaches the mapped hand target');
  assert(C.norm(C.sub(drive.t,position))<1e-10&&drive.open===.6,'IMU rotation preserves mouse position and gripper opening');
  const physical=C.mul3(RB.scene.chest.R,RCORE.fk(RB.scene.m,1,RB.scene.arms.find(a=>a.side===1).q).R);
  assert(C.angleOf(C.mul3(C.tr3(base),physical))>.1,'real IK and motor slew rotate the rendered gripper');
  assert(C.angleOf(C.mul3(C.tr3(other),RCORE.fk(RB.scene.m,-1,RB.scene.arms.find(a=>a.side===-1).q).R))<.01,'other hand retains its orientation');
  $('ctlBoards').querySelector('[data-test-haptic]').click();await wait(()=>commands.some(p=>p.type===0x44&&p.body[0]===1&&p.body[1]===75),'concurrent haptic ACK');
  assert($('ctlConnectionStatus').textContent===TASK_DATA.haptics.test_sent.replace('{level}','75'),'test pulse reports the actual 75 percent command');
  $('taskHapticStrength').value=37;$('taskHapticStrength').dispatchEvent(new Event('input'));
  $('ctlBoards').querySelector('[data-test-haptic]').click();await wait(()=>commands.some(p=>p.type===0x44&&p.body[1]===37),'test pulse follows the selected drive percentage');
  assert($('gameHaptics').textContent.includes('37%'),'toolbar shows selected percentage');
  $('taskHapticStrength').value=75;$('taskHapticStrength').dispatchEvent(new Event('input'));
  const epoch=b.motion.epoch;imu=false;await sleep(250);assert(b.captureControl.paused,'stale IMU pauses control even while INFO continues');
  const held=b.captureControl.last.slice();imu=true;
  await wait(()=>b.motion.ready&&b.motion.epoch>epoch,'IMU recovery calibration');await sleep(100);assert(JSON.stringify(b.captureControl.last)===JSON.stringify(held),'recovered stream waits for a new neutral pose');
  $('ctlBoards').querySelector('[data-capture-zero]').click();assert(!b.captureControl.paused,'explicit recenter resumes control');
  window.dispatchEvent(new Event('blur'));await sleep(50);assert(b.captureControl.paused,'blur pauses orientation');
  $('ctlBoards').querySelector('[data-capture-zero]').click();
  select().value='-1';select().dispatchEvent(new Event('change'));assert(!b.captureControl.neutral,'hand remapping clears the old neutral');
  $('ctlBoards').querySelector('[data-capture-zero]').click();assert(b.captureControl.neutral?.side===-1,'other hand can be calibrated independently');
  const right=b.captureControl.last.slice();speed=-40;await sleep(400);speed=0;await sleep(150);
  assert(C.angleOf(C.mul3(C.tr3(right),b.captureControl.last))>.15,'right-hand orientation follows its mapping');
  setMode('track');assert(b.captureControl.paused,'leaving Tasks pauses orientation even when Tracking draws tags');
  setMode('tasks');await sleep(50);assert(b.captureControl.paused,'returning to Tasks still requires recentering');
  taskLevel('sort');assert(!b.captureControl.neutral,'task changes clear IMU calibration');
  await b.serialLink.close();assert(closed&&b.state!=='live'&&!b.hapticCharacteristic,'disconnect releases motion and haptic transport');
  assert($('ctlConnectionStatus').textContent===TASK_DATA.link.capture_lost,'disconnect replaces the active-orientation notice');
  assert(document.documentElement.scrollWidth<=innerWidth+1,'controller panel fits viewport');
  return {passed:true,protocol:4,gyroCalibration:true,physicalOrientation:true,positionPreserved:true,haptics:true,staleHold:true,remapping:true,viewport:[innerWidth,innerHeight]};
})()
