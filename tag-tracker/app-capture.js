// Capture raw IMU controls relative wrist rotation; its native commands return TacHammer cues.
'use strict';
async function addCaptureBoard(){
  const note=text=>{$('ctlConnectionStatus').textContent=text;};
  if(!navigator.serial){note(TASK_DATA.link.unsupported);return;}
  let port;try{port=await navigator.serial.requestPort({filters:[{usbVendorId:0x2886,usbProductId:0x0068}]});}catch(e){if(e.name!=='NotFoundError')note(e.message);return;}
  let link,b;
  try{
    const {CaptureLink}=await import('../haptography/task-link.js?v=9313bb97');
    const orientation=new CaptureOrientation.Estimator();
    link=new CaptureLink(port,current=>{
      if(!b)return;
      b.act={tachammerReady:current.ready};b.actT=current.lastPacket;b.actOk=true;
      b.motion=orientation.snapshot;b.n=orientation.samples;b.lost=current.decoder.lost;
      b.state='live';b.lastSerial=current.lastPacket;
    });
    link.onImu=(batch,info,at)=>orientation.feed(batch,info,at);
    note(TASK_DATA.link.capture_waiting);await link.open();if(link.closed)throw new Error(TASK_DATA.link.closed);
    const id=link.info.board_id.toString(16).toUpperCase().padStart(4,'0');
    const previous=S.boards.find(q=>q.id===id&&!q.sim);
    if(previous){voiceBoardGone(previous);previous.closing=true;previous.device?.gatt?.disconnect();if(previous.serialLink?.detach)previous.serialLink.detach(id);S.boards=S.boards.filter(q=>q!==previous);}
    b=newBoard(id,'nrf-capture-'+id,{transport:'capture',serialLink:link,state:'live',use:false,track:null,hapticRateHz:25,
      motion:orientation.snapshot,n:orientation.samples,captureControl:new CaptureOrientation.Control()});
    b.act={tachammerReady:link.ready};b.actT=link.lastPacket;b.actOk=true;
    b.hapticCharacteristic={transient:true,get busy(){return link.busy;},writeValueWithResponse:bytes=>link.command(bytes)};
    SERIAL_LINKS.add(link);
    link.onClose=error=>{SERIAL_LINKS.delete(link);b.state=error?'error':'lost';b.err=error?.message||TASK_DATA.link.capture_lost;b.hapticCharacteristic=null;b.captureControl.paused=true;note(b.err);renderBoards();};
    note(TASK_DATA.link.capture_ready);renderBoards();paintControllerPanel(true);
  }catch(e){note(e.message);if(link)await link.close().catch(()=>{});}
}
function captureControlState(b){
  const text=TASK_DATA.link;
  if(b.state!=='live')return text.capture_lost;
  if(b.captureControl?.neutral)return b.captureControl.recenterRequired?text.capture_paused:b.captureControl.paused?text.capture_suspended:text.capture_on;
  if(!b.motion||performance.now()-b.motion.at>=500)return text.capture_waiting_imu;
  if(!b.motion.ready)return text.capture_calibrating.replace('{seconds}',(b.motion.calibrationS||0).toFixed(1));
  return b.state==='live'&&CaptureOrientation.fresh(b.motion,performance.now())?text.capture_neutral:text.capture_still;
}
function zeroCaptureOrientation(b){
  const side=Number(b?.hapticSide),sc=RB.scene,a=sc?.arms.find(a=>a.side===side),note=$('ctlConnectionStatus');
  if(!b||b.transport!=='capture'||b.state!=='live'||!a||!gameView()||document.hidden||!document.hasFocus()){
    note.textContent=TASK_DATA.link.capture_neutral_help;return;
  }
  const R=C.mul3(sc.chest.R,RCORE.fk(sc.m,side,robotReady()).R);
  if(!b.captureControl.zero(b.motion,R,side,S.settings.frame,performance.now(),sc.chest.R)){note.textContent=TASK_DATA.link.capture_still;return;}
  const drive=TB.drive.get(side);if(drive)drive.R=R.slice();
  // Explicit neutral also starts a new wrist branch. Retaining an unwrapped request
  // from a full turn past a stop would keep a canonical rotation pinned at that stop.
  for(const [key,prev] of RB.prev)if(prev.side===side||key==='drive'+side||key==='capture'+side)delete prev.wristInput;
  for(const other of S.boards)if(other!==b&&other.captureControl?.neutral?.side===side)other.captureControl.clear();
  note.textContent=TASK_DATA.link.capture_on;paintControllerPanel(true);
}
function stopCaptureOrientation(b){
  const control=b.captureControl,d=TB.drive.get(control?.neutral?.side);
  if(d&&control.last)d.R=control.last.slice();
  control?.clear();paintControllerPanel(true);
}
function captureHandRotation(side,now,chest=RB.scene?.chest,m=RB.scene?.m){
  const active=gameView()&&!document.hidden&&document.hasFocus()&&!$('setupDlg').open&&!$('settingsDlg').open&&!V.rec&&!V.boardTake&&!V.opening;
  for(const b of S.boards){
    const control=b.captureControl;
    if(b.transport!=='capture'||!control?.neutral||control.neutral.side!==side)continue;
    if(control.needsTaskPose&&active&&chest&&m){
      const R=C.mul3(chest.R,RCORE.fk(m,side,robotReady()).R);
      control.retarget(b.motion,R,side,S.settings.frame,now,chest.R);
    }
    return control.rotation(b.motion,side,S.settings.frame,now,active&&b.state==='live');
  }
  return null;
}
function clearCaptureOrientations(){for(const b of S.boards)b.captureControl?.clear();}
// A task restart has a new ready hand pose, but the live sensor's calibration is still valid.
function rebaseCaptureOrientations(){for(const b of S.boards)if(b.captureControl?.neutral)b.captureControl.needsTaskPose=true;}
// Hold while away; Control resumes the same neutral when fresh samples and focus return.
function pauseCaptureOrientations(){for(const b of S.boards)if(b.captureControl?.neutral)b.captureControl.paused=true;}
window.addEventListener('blur',pauseCaptureOrientations);
document.addEventListener('visibilitychange',()=>{if(document.hidden)pauseCaptureOrientations();});
$('ctlCapture').onclick=addCaptureBoard;
