// USB serial controller / XIAO ESB receiver. The same board rows, calibration, fusion and TacHammer dispatcher.
'use strict';
const SERIAL_LINKS=new Set();
async function addSerialBoard(){
  if(!navigator.serial){boardNote(TASK_DATA.link.unsupported);return;}
  let port;try{port=await navigator.serial.requestPort();}catch(e){if(e.name!=='NotFoundError')boardNote(e.message);return;}
  const boards=new Map(),ignored=new Set(),link=new ControllerLink.Serial(port,f=>{
    const id=f.board.toString(16).toUpperCase().padStart(4,'0');if(ignored.has(id))return;const view=new DataView(f.payload.buffer,f.payload.byteOffset,f.payload.length);
    if(f.type===ControllerLink.TYPE.INFO){
      const info=C.decodeBoardInfo(view);if(!info||info.boardId!==id)return;
      let b=boards.get(id);
      if(!b){
        const previous=S.boards.find(q=>q.id===id&&!q.sim);
        if(previous){voiceBoardGone(previous);previous.closing=true;previous.device?.gatt?.disconnect();if(previous.serialLink?.detach)previous.serialLink.detach(id);else previous.serialLink?.close().catch(()=>{});S.boards=S.boards.filter(q=>q!==previous);}
        b=newBoard(id,'nrf-controller-'+id,{transport:'serial',serialLink:link,state:'live',hapticRateHz:25});boards.set(id,b);
        b.hapticCharacteristic={transient:true,get busy(){return !!link.writing;},writeValueWithResponse:bytes=>link.command(f.board,b.pipe,bytes)};
      }
      const wasLost=b.state!=='live';b.info=info;b.pipe=f.pipe;b.state='live';b.lastSerial=performance.now();
      if(!b.hapticCharacteristic)b.hapticCharacteristic={transient:true,get busy(){return !!link.writing;},writeValueWithResponse:bytes=>link.command(f.board,b.pipe,bytes)};
      if(wasLost)renderBoards();boardNote('');
    }
    const b=boards.get(id);if(!b)return;b.lastSerial=performance.now();
    if(f.type===ControllerLink.TYPE.IMU){
      const batch=C.decodeImuBatch(view);if(!batch)return;
      const backwards=b.lastSeq!=null&&((batch.firstSeq-b.lastSeq)>>>0)>0x80000000;
      if(backwards){b.clock=new C.BoardClock();b.buf=[];b.lastSeq=null;b.W=null;b.pairs=[];b.wPairs=[];b.pairT=-Infinity;}
      onBatch(b,view,performance.now()/1000);
    }
    if(f.type===ControllerLink.TYPE.ACT){const status=C.decodeActuatorStatus(view);if(status){b.act=status;b.actT=performance.now();b.actOk=true;}}
    if(f.type===ControllerLink.TYPE.PLAYBACK&&view.byteLength===15&&view.getUint8(14)!==2){const delay=(view.getUint32(4,true)-view.getUint32(0,true))>>>0;if(delay<1000000)b.actuatorDelayMs=delay/1000;}
    if(f.type===ControllerLink.TYPE.ACK)b.serialRtt=link.rtt;
    if(f.type===ControllerLink.TYPE.STATS&&view.byteLength>=8){b.linkDropped=view.getUint32(0,true);b.radioDropped=view.getUint32(4,true);b.transport=view.byteLength>8&&view.getUint8(8)?'esb':'serial';}
  });
  link.detach=id=>{ignored.add(id);const b=boards.get(id);if(b)b.serialLink=null;boards.delete(id);if(!boards.size)link.close().catch(()=>{});};
  link.onClose=error=>{clearInterval(link.helloTimer);SERIAL_LINKS.delete(link);for(const b of boards.values()){b.state=error?'error':'lost';b.err=error?.message||TASK_DATA.link.closed;b.hapticCharacteristic=null;}renderBoards();if(link.writer)queueMicrotask(()=>link.close().catch(()=>{}));};
  try{await link.open(+$('controllerBaud').value);SERIAL_LINKS.add(link);boardNote(TASK_DATA.link.waiting,false);link.helloTimer=setInterval(()=>{link.send({type:ControllerLink.TYPE.HELLO}).catch(()=>{});for(const b of boards.values())if(performance.now()-b.lastSerial>1500){b.state='lost';b.hapticCharacteristic=null;}},1000);}catch(e){boardNote(e.message);try{await link.close();}catch(_){/* port may not have opened */}}
}
$('boardSerial').onclick=addSerialBoard;
navigator.serial?.addEventListener('disconnect',e=>{for(const link of SERIAL_LINKS)if(link.port===e.target)link.close().catch(()=>{});});
window.addEventListener('pagehide',()=>{for(const link of SERIAL_LINKS)link.close().catch(()=>{});});

$('taskSerial').onclick=()=>{$('gameSettings').close();addSerialBoard();};$('taskBluetooth').onclick=()=>{$('gameSettings').close();addBoard();};
