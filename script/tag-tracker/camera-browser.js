// task shot -- /tag-tracker/ --eval-file script/tag-tracker/camera-browser.js (also --phone)
// Synthetic video only: this check never opens a physical camera.
(async()=>{
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const assert=(ok,message)=>{if(!ok)throw Error(message);};
  const wait=async(predicate,message)=>{const end=Date.now()+7000;while(!predicate()){if(Date.now()>end)throw Error(message);await sleep(20);}};
  document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());stop(true);setMode('track');
  const media=navigator.mediaDevices,saved={getUserMedia:media.getUserMedia,enumerateDevices:media.enumerateDevices,res:S.res,fps:S.captureFps,camId:S.camId};
  const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#edf0f3';ctx.fillRect(0,0,1280,720);ctx.fillStyle='#111820';ctx.fillRect(460,180,360,360);ctx.fillStyle='#fff';ctx.fillRect(500,220,280,280);
  const repaint=setInterval(()=>{ctx.fillStyle='#edf0f3';ctx.fillRect(0,0,4,4);},30);
  const fakeDevices=[{kind:'videoinput',deviceId:'mock:fixed',label:'Built-in camera',groupId:'synthetic'},{kind:'videoinput',deviceId:'mock:manual',label:'Camera with exposure control',groupId:'synthetic'}];
  const opened=[],streams=[];let requests=0,ignoreExposure=false,rejectExposure=false,blockExposure=false,pendingExposure=null;
  const rowFor=c=>[...$('cameraCaptureList').querySelectorAll('.camera-capture-row')][S.cams.indexOf(c)];
  const exposureFor=c=>rowFor(c)?.querySelector('.capture-exposure');
  const visible=element=>!!element&&!element.closest('[hidden]');
  const change=(select,value)=>{select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));};
  const startSynthetic=key=>Promise.race([addCamera(key),sleep(7000).then(()=>{throw Error('synthetic video did not start: '+key);})]);
  const manualChanges=constraints=>(constraints.advanced||[]).filter(change=>change.exposureMode==='manual');
  let complete=false;
  try{
    media.enumerateDevices=async()=>fakeDevices;
    media.getUserMedia=async constraints=>{
      requests++;assert(constraints.audio===false,'camera capture never requests a microphone');
      const id=constraints.video.deviceId?.exact||fakeDevices[0].deviceId,manual=id==='mock:manual';
      const stream=canvas.captureStream(30),track=stream.getVideoTracks()[0],nativeStop=track.stop.bind(track);
      const settings={deviceId:id,width:1280,height:720,frameRate:30,...(manual?{exposureMode:'continuous',exposureTime:333}:{})};
      const calls=[],fixture={id,stream,track,settings,calls,request:constraints};opened.push(fixture);streams.push(stream);
      track.getCapabilities=()=>manual?{width:{min:640,max:1920},height:{min:360,max:1080},frameRate:{min:1,max:60},exposureMode:['continuous','manual'],exposureTime:{min:10,max:10000,step:1}}:{};
      track.getSettings=()=>({...settings});
      track.applyConstraints=async value=>{
        calls.push(value);
        const exposure=(value.advanced||[]).find(change=>change.exposureMode);
        if(!exposure)return;
        if(blockExposure){await new Promise(resolve=>{pendingExposure=resolve;});return;}
        if(rejectExposure)throw Object.assign(new Error('The camera refused that exposure.'),{name:'OverconstrainedError',constraint:'exposureTime'});
        if(ignoreExposure)return;
        settings.exposureMode=exposure.exposureMode;
        if(exposure.exposureTime!==undefined)settings.exposureTime=exposure.exposureTime;
      };
      track.stop=()=>{fixture.stopped=true;nativeStop();};
      return stream;
    };
    await listCameras();$('camSel').value='mock:fixed';
    const before=requests;$('settingsBtn').click();refreshCameraSettings();
    assert($('settingsDlg').open&&requests===before,'opening camera settings never starts a camera');
    assert(S.quality==='fast','new visitors start with fast detection');
    assert($('cameraFps').value===String(S.captureFps),'the frame-rate control reflects the saved preference');
    assert(['640x360','640x480','1280x720','1920x1080'].every(value=>[...$('cameraResolution').options].some(option=>option.value===value)),'camera settings offer all supported resolution preferences');
    change($('cameraResolution'),'640x360');
    assert(S.res==='640x360'&&$('resSel').value==='640x360'&&requests===before,'settings resolution updates the top bar without opening a camera');
    change($('resSel'),'640x480');
    assert(S.res==='640x480'&&$('cameraResolution').value==='640x480'&&requests===before,'the top-bar resolution stays synchronized with open camera settings');
    change($('cameraResolution'),saved.res);
    await startSynthetic('mock:fixed');await startSynthetic('mock:manual');refreshCameraSettings();
    assert(requests===before+2&&S.cams.length===2,'only explicit starts acquire the two synthetic streams');
    let fixed=S.cams.find(c=>c.key==='mock:fixed'),manual=S.cams.find(c=>c.key==='mock:manual');
    assert(!visible(exposureFor(fixed)),'a camera without exposed manual capabilities has no shutter control');
    assert(visible(exposureFor(manual)),'a camera exposing manual exposure has a shutter control');
    assert(/30\s*fps/i.test(rowFor(manual).querySelector('.capture-info').textContent),'camera information reports negotiated 30 fps rather than the requested maximum');
    change($('cameraFps'),'60');
    await wait(()=>S.captureFps==='60'&&S.cams.length===2&&fixed.gone&&manual.gone,'changing the frame-rate preference restarts the requested cameras');
    fixed=S.cams.find(c=>c.key==='mock:fixed');manual=S.cams.find(c=>c.key==='mock:manual');
    await wait(()=>!!exposureFor(manual),'camera controls return after the restart');
    assert(opened.slice(0,2).every(camera=>camera.stopped),'the previous camera streams stop before being replaced');
    assert(/30\s*fps/i.test(rowFor(manual).querySelector('.capture-info').textContent),'a 60 fps request never masquerades as 60 fps when the camera negotiates 30');
    const fixture=opened.findLast(camera=>camera.id==='mock:manual');
    assert(opened.slice(-2).every(camera=>camera.request.video.frameRate.ideal===60),'the selected frame-rate preference reaches camera acquisition');
    change(exposureFor(manual),'120');
    await wait(()=>fixture.settings.exposureMode==='manual'&&manual.captureExposure==='120','a supported short exposure is applied');
    const shutter=fixture.calls.flatMap(manualChanges).at(-1)?.exposureTime;
    assert(Math.abs(shutter-10000/120)<=1&&exposureFor(manual).value==='120','1/120 second uses the camera API’s 100-microsecond units, rounded to a supported step');
    change(exposureFor(manual),'auto');await wait(()=>fixture.settings.exposureMode==='continuous'&&manual.captureExposure==='auto','automatic exposure can be restored');
    ignoreExposure=true;change(exposureFor(manual),'250');
    await wait(()=>exposureFor(manual)?.value==='auto'&&!exposureFor(manual).disabled&&!!rowFor(manual).querySelector('.capture-note').textContent.trim(),'an ignored advanced constraint reports feedback and restores the actual exposure selection');
    assert(manual.captureExposure==='auto'&&fixture.settings.exposureMode==='continuous','an ignored constraint cannot claim manual exposure succeeded');
    ignoreExposure=false;rejectExposure=true;const writes=fixture.calls.length;change(exposureFor(manual),'120');
    await wait(()=>fixture.calls.length>writes&&exposureFor(manual)?.value==='auto'&&!exposureFor(manual).disabled&&!!rowFor(manual).querySelector('.capture-note').textContent.trim(),'a rejected shutter request reports feedback and restores automatic exposure');
    rejectExposure=false;blockExposure=true;change(exposureFor(manual),'250');await wait(()=>!!pendingExposure,'the shutter request is pending');
    stop(true);const stoppedContent=$('cameraCaptureList').textContent;pendingExposure();pendingExposure=null;await sleep(40);
    assert(manual.gone&&fixture.stopped&&!$('cameraCaptureList').querySelector('.camera-capture-row')&&$('cameraCaptureList').textContent===stoppedContent,'a late exposure result cannot revive a stopped camera or update its retired controls');
    blockExposure=false;
    await startSynthetic('mock:fixed');await startSynthetic('mock:manual');refreshCameraSettings();
    let fastDetection='skipped: detector CDN unavailable';
    const detectorReady=await Promise.race([workerReady.then(()=>true),sleep(15000).then(()=>false)]);
    if(detectorReady){
      const tag=await Promise.race([requestImage('tagImage',{family:S.settings.family,id:42,px:320}),sleep(7000).then(()=>null)]);
      assert(tag,'the loaded detector can render the synthetic AprilTag');
      const picture=grayToCanvas(tag,40);ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(picture,(canvas.width-picture.width)/2,(canvas.height-picture.height)/2);
      await wait(()=>S.cams.every(camera=>camera.last?.tags.some(found=>found.id===42)),'Fast detection finds the generated AprilTag in both synthetic camera streams');
      assert(S.quality==='fast'&&S.seen.has(42),'the real detector finds tag 42 while Fast is selected');
      fastDetection=true;
    }
    $('settingsDlg').scrollTop=0;await sleep(80);
    assert(document.documentElement.scrollWidth<=innerWidth+1,'camera settings fit the viewport');
    complete=true;
    return {passed:true,syntheticCameras:true,noImplicitStart:true,negotiatedFps:true,capabilityGating:true,shortExposure:true,ignoredConstraint:true,rejectedConstraint:true,stopWhilePending:true,fastDetection,viewport:[innerWidth,innerHeight]};
  }finally{
    clearInterval(repaint);
    media.getUserMedia=saved.getUserMedia;media.enumerateDevices=saved.enumerateDevices;
    if(pendingExposure)pendingExposure();
    if(!complete){stop(true);for(const stream of streams)stream.getTracks().forEach(track=>track.stop());}
    S.res=saved.res;S.captureFps=saved.fps;S.camId=saved.camId;
    store.set('res',saved.res);store.set('captureFps',saved.fps);store.set('camId',saved.camId);
    if(complete)refreshCameraSettings();
  }
})()
