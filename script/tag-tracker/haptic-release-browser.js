// No device or speakers. task shot -- /tag-tracker/ --eval-file script/tag-tracker/haptic-release-browser.js
(async()=>{
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),assert=(ok,message)=>{if(!ok)throw Error(message);};
  const wait=async(test,message)=>{const end=performance.now()+3000;while(!test()){if(performance.now()>end)throw Error(message);await sleep(10);}};
  const microtasks=async()=>{for(let i=0;i<4;i++)await Promise.resolve();};
  document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());
  const saved={boards:S.boards,enabled:taskHapticSettings.enabled,send:sendTaskHaptics,focus:Object.getOwnPropertyDescriptor(document,'hasFocus'),hidden:Object.getOwnPropertyDescriptor(document,'hidden')},results=[];
  const restoreDocument=()=>{
    for(const [key,descriptor]of [['hasFocus',saved.focus],['hidden',saved.hidden]])if(descriptor)Object.defineProperty(document,key,descriptor);else delete document[key];
  };
  try{
    for(const mode of ['tab','blur','off','hidden']){
      restoreDocument();setTaskHaptics(true);setMode('tasks');await sleep(100);
      clearTimeout(taskHapticReleaseTimer);taskHapticReleaseTimer=null;TASK_HAPTIC.reset();
      const writes=[],voice={until:-Infinity,stopped:0},board={id:'release-fixture',name:'Release fixture',transport:'serial',track:null,use:false,state:'live',hapticSide:'1',hapticRateHz:25,act:{tachammerReady:true},actT:0,buf:[],rateT:performance.now(),rate:0,n:0,nPrev:0};
      board.hapticCharacteristic={
        writeValueWithResponse(bytes){
          assert(bytes.length===6&&bytes[0]===2&&bytes[1]===2,'only finite TacHammer commands enter the simulated device');
          writes.push({kind:bytes[2],level:bytes[3],at:performance.now()});voice.until=performance.now()+(bytes[2]===6?300:6);return Promise.resolve();
        },
        stopHaptics(){writes.push({kind:'stop',at:performance.now()});voice.stopped++;voice.until=performance.now();return Promise.resolve();}
      };
      S.boards=[board];
      const world={hands:{1:{}},contactState:{hands:{1:{force:[0,0,2]}},touches:[]},record:{events:[]}},now=performance.now();board.actT=now;
      // Synthetic past onset + current sustain in one JS turn: RAF must not replace
      // this force with the quiet real table between the CLICK and RUMBLE writes.
      TASK_HAPTIC.tick({boards:[board],world,arms:[],now:now-150,enabled:true});await microtasks();
      TASK_HAPTIC.tick({boards:[board],world,arms:[],now,enabled:true});await microtasks();
      assert(writes.length===2&&writes[0].kind===1&&writes[1].kind===6,mode+': primed the actual shared dispatcher with a playing 300 ms rumble');
      assert(TASK_HAPTIC.hasRumble(performance.now())&&voice.until>performance.now(),mode+': the waveform is still active before leaving');
      let normalCalls=0;sendTaskHaptics=()=>{normalCalls++;};
      const left=performance.now();
      if(mode==='tab')setMode('track');
      if(mode==='blur'){Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>false});window.dispatchEvent(new Event('blur'));}
      if(mode==='off')$('gameHaptics').click();
      if(mode==='hidden'){Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));}
      assert(taskHapticReleaseTimer!==null,mode+': a rate-limited release arms the independent cancellation pump');
      await wait(()=>voice.stopped===1,mode+': leaving must stop rumble without ordinary table haptic ticks');
      await microtasks();
      assert(writes.length===3&&writes[2].kind==='stop',mode+': release cancels once without another stimulus or STOP_ALL');
      assert(!TASK_HAPTIC.hasRumble(performance.now()),mode+': the independent pump has no outstanding waveform after its ACK');
      assert(voice.until<=performance.now(),mode+': the simulated device has no remaining rumble tail');
      results.push({mode,cancelled:true,latencyMs:Math.round(writes[2].at-left),ordinaryHapticCalls:normalCalls});
      await sleep(60);assert(voice.stopped===1,mode+': the cancellation is not retried');
      clearTimeout(taskHapticReleaseTimer);taskHapticReleaseTimer=null;sendTaskHaptics=saved.send;S.boards=[];
    }
    return {passed:true,nativeLike:true,independentPump:true,results,viewport:[innerWidth,innerHeight]};
  }finally{
    clearTimeout(taskHapticReleaseTimer);taskHapticReleaseTimer=null;TASK_HAPTIC.reset();sendTaskHaptics=saved.send;S.boards=saved.boards;restoreDocument();setTaskHaptics(saved.enabled!==false);
  }
})()
