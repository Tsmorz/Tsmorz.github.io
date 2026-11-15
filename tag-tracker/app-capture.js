// Capture firmware stays intact: use its native stream solely for task haptic output.
'use strict';
async function addCaptureBoard(){
  const note=text=>{$('ctlConnectionStatus').textContent=text;};
  if(!navigator.serial){note(TASK_DATA.link.unsupported);return;}
  let port;try{port=await navigator.serial.requestPort({filters:[{usbVendorId:0x2886,usbProductId:0x0068}]});}catch(e){if(e.name!=='NotFoundError')note(e.message);return;}
  let link,b;
  try{
    const {CaptureLink}=await import('../haptography/task-link.js?v=d4eb8a86');
    link=new CaptureLink(port,current=>{
      if(!b)return;
      b.act={tachammerReady:current.ready};b.actT=current.lastPacket;b.actOk=true;
      b.state='live';b.lastSerial=current.lastPacket;
    });
    note(TASK_DATA.link.capture_waiting);await link.open();if(link.closed)throw new Error(TASK_DATA.link.closed);
    const id=link.info.board_id.toString(16).toUpperCase().padStart(4,'0');
    const previous=S.boards.find(q=>q.id===id&&!q.sim);
    if(previous){voiceBoardGone(previous);previous.closing=true;previous.device?.gatt?.disconnect();if(previous.serialLink?.detach)previous.serialLink.detach(id);S.boards=S.boards.filter(q=>q!==previous);}
    b=newBoard(id,'nrf-capture-'+id,{transport:'capture',serialLink:link,state:'live',use:false,track:null,hapticRateHz:25});
    b.act={tachammerReady:link.ready};b.actT=link.lastPacket;b.actOk=true;
    b.hapticCharacteristic={transient:true,get busy(){return link.busy;},writeValueWithResponse:bytes=>link.command(bytes)};
    SERIAL_LINKS.add(link);
    link.onClose=error=>{SERIAL_LINKS.delete(link);b.state=error?'error':'lost';b.err=error?.message||TASK_DATA.link.closed;b.hapticCharacteristic=null;renderBoards();};
    note(TASK_DATA.link.capture_ready);renderBoards();paintControllerPanel(true);
  }catch(e){note(e.message);if(link)await link.close().catch(()=>{});}
}
$('ctlCapture').onclick=addCaptureBoard;
