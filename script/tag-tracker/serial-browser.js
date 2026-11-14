// Test the real Web Serial adapter with a fake USB/ESB receiver and real simulated hand/table contact.
(async()=>{
  const wait=ms=>new Promise(r=>setTimeout(r,ms)),assert=(ok,msg)=>{if(!ok)throw new Error(msg);};
  document.querySelectorAll('dialog[open]').forEach(d=>d.close());taskLevel('sort');await wait(350);
  let rx,closed=false,stamp=1000000,seq=0;const writes=[],id=0xface;
  const send=f=>{if(!closed)rx.enqueue(ControllerLink.frame({board:id,pipe:1,stamp,...f}));};
  const data=v=>new Uint8Array(v.buffer,v.byteOffset,v.byteLength);
  const act=(board=id,pipe=1,delta=0)=>send({board,pipe,stamp:stamp+delta,type:ControllerLink.TYPE.ACT,payload:data(C.encodeActuatorStatus({railOn:true,tachammerReady:true,analogReady:true,feedbackMv:2900,railMv:5000}))});
  const usb={open:async()=>{},close:async()=>{closed=true;},readable:new ReadableStream({start(c){rx=c;}}),writable:new WritableStream({write(bytes){ControllerLink.parser(f=>{if(f.type===ControllerLink.TYPE.HELLO){send({type:ControllerLink.TYPE.INFO,payload:data(C.encodeBoardInfo(id,416,.07,.000244))});act();send({type:ControllerLink.TYPE.STATS,payload:[0,0,0,0,0,0,0,0,1]});}if(f.type===ControllerLink.TYPE.COMMAND){writes.push(f);send({type:ControllerLink.TYPE.ACK,board:f.board,pipe:f.pipe,payload:[f.seq&255,f.seq>>8,0]});}}).push(bytes);}})};
  Object.defineProperty(navigator,'serial',{configurable:true,value:{requestPort:async()=>usb,addEventListener(){}}});await addSerialBoard();await wait(100);
  const b=S.boards.find(b=>b.id==='FACE');assert(b&&b.info.imuRateHz===416&&b.transport==='esb','a USB receiver discovers an individually addressed ESB controller');b.hapticSide='-1';b.grip={closed:300,open:700};
  const secondId=0xbeef;send({type:ControllerLink.TYPE.INFO,board:secondId,pipe:0,payload:data(C.encodeBoardInfo(secondId,416,.07,.000244))});act(secondId,0,1234);await wait(30);const b2=S.boards.find(q=>q.id==='BEEF');assert(b2&&b2!==b&&b2.pipe===0&&b.pipe===1,'two wireless controllers have independent board IDs and pipes on one USB receiver');
  const timer=setInterval(()=>{for(let i=0;i<7;i++){stamp+=2404;const payload=C.encodeImuBatch(seq++,[0,0,0],[{tUs:stamp,gyro:[0,0,0],accel:[0,0,4096],q:[1,0,0,0],rest:true}]);send({type:ControllerLink.TYPE.IMU,payload:data(payload)});const p2=C.encodeImuBatch(seq-1,[0,0,0],[{tUs:stamp+1234,gyro:[0,0,0],accel:[0,0,4096],q:[1,0,0,0],rest:true}]);send({type:ControllerLink.TYPE.IMU,board:secondId,pipe:0,stamp:stamp+1234,payload:data(p2)});}act();act(secondId,0,1234);},17);
  await wait(500);assert(b.n>100&&b2.n>100&&b.buf.length>100&&b2.buf.length>100&&b.buf.every(x=>Number.isFinite(x.t)&&x.Q.every(Number.isFinite)),'serial sensor frames feed the existing time-aligned fusion input buffer');
  assert(Math.abs(C.gripOpening(b.act,b.grip)-.7)<.001,'serial actuator status also supplies calibrated gripper feedback');
  const arm=RB.scene.arms.find(a=>a.side===-1),d=driveOf(arm);d.R=TB.world.table.R.slice();d.t=C.add(TB.world.table.t,C.mulv(TB.world.table.R,[-.12,-.18,.06]));TASK.moved=true;await wait(1400);
  assert(writes.length>0&&writes.every(f=>f.type===5&&f.board===id&&f.pipe===1&&f.payload[0]===2&&f.payload[1]===2&&f.payload[3]<=45),'physical contact sends addressed TacHammer-only packets through the real USB adapter');
  while(b2.serialLink.writing)await wait(10);await b2.hapticCharacteristic.writeValueWithResponse(TaskHaptics.packet(5));assert(writes.some(f=>f.board===secondId&&f.pipe===0),'feedback can address the second hand without sending it to the first');
  assert(writes.every(f=>f.stamp>1000000&&f.stamp<=stamp+1234),'commands echo recent source-controller status timestamps');
  const clock=b.clock;seq=0;stamp=50000;await wait(120);assert(b.clock!==clock&&b.buf.every(x=>Number.isFinite(x.t)),'a restarted wireless controller resets its clock fit and fusion heading');
  clearInterval(timer);const n=writes.length;rx.close();await wait(500);assert(b.state!=='live'&&!b.hapticCharacteristic&&writes.length===n,'USB disconnect invalidates haptic output and stops further writes');
  const ch={readValue:async()=>C.encodeBoardInfo(id,208,.07,.000244),addEventListener(){},startNotifications:async()=>{}};const dev={name:'nrf-controller-FACE',id:'test-ble',addEventListener(){},gatt:{connected:true,connect:async()=>({getPrimaryService:async()=>({getCharacteristic:async()=>ch})}),disconnect(){this.connected=false;}}};await connectDevice(dev);
  assert(b.state==='live'&&!b.serialLink&&!b.transport&&b.hapticRateHz===10&&b.hapticCharacteristic===ch,'switching back to BLE clears USB state and restores its feedback rate');
  return {passed:true,usbAdapter:true,esbMultiplex:true,sensorFusionInput:true,gripFeedback:true,tacHammerCommands:writes.length,disconnect:true};
})()
