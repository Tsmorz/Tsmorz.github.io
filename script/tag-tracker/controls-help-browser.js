// task shot -- /tag-tracker/ --eval-file script/tag-tracker/controls-help-browser.js (also --phone)
(async()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms)),assert=(ok,msg)=>{if(!ok)throw Error(msg);};
  const press=(el,key,modifiers={})=>{const event=new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...modifiers});el.dispatchEvent(event);return event;};
  document.querySelectorAll('dialog[open]').forEach(d=>d.close());setMode('tasks');setRobotView('orbit');await sleep(180);
  const button=$('gameKeyboard'),dialog=$('controlsDlg'),close=$('controlsClose'),body=dialog.querySelector('.controls-help');
  assert(button.closest('.game-actions')&&button.querySelector('use').getAttribute('href')==='#i-keyboard'&&button.getAttribute('aria-haspopup')==='dialog'&&button.getAttribute('aria-label')===TASK_DATA.controls_help.button,'a labelled keyboard icon opens help directly from the task rail');
  const drive=driveOf(RB.scene.arms.find(a=>a.side===1));
  const state=()=>JSON.stringify({hand:TASK.hand,drive:[...TB.drive],generation:TB.generation,level:S.settings.robot.level,view:S.view,robotView:S.settings.robot.view,sound:S.settings.robot.sound,voice:!!(V.rec||V.boardTake||V.opening)});
  const camera=JSON.stringify(S.view);for(const [key,modifiers]of [['r',{ctrlKey:true}],['f',{metaKey:true}],['ArrowUp',{altKey:true}]])assert(!press(plot,key,modifiers).defaultPrevented&&JSON.stringify(S.view)===camera,'browser modifier chords do not become camera shortcuts: '+key);
  // Shortcuts follow logical characters, including the shifted German number row.
  const distance=S.view.dist;
  press(plot,'0',{code:'Digit0'});assert(S.view.dist===distance,'bare 0 has no camera binding');
  press(plot,'=',{code:'Digit0',shiftKey:true});assert(Math.abs(S.view.dist-distance*.9)<1e-9,'German Shift+0 (=) zooms in through the actual scene handler');
  press(plot,'-',{code:'Slash'});assert(Math.abs(S.view.dist-distance)<1e-9,'German bottom-row minus zooms out through the actual scene handler');
  press(plot,'+',{code:'BracketRight'});assert(Math.abs(S.view.dist-distance*.9)<1e-9,'German plus key also zooms in through the actual scene handler');S.view.dist=distance;
  // Scene keys must never become robot commands while a text field has focus.
  const leaderboard=$('taskLeaderboard'),wasOpen=leaderboard.open;leaderboard.open=true;$('taskPlayer').focus();const typed=state();
  for(const key of ['w','s','a','d','q','e','i','p','j','k','u','o',' ','t','m','c','r','f','v','1','2','3','ArrowUp'])press($('taskPlayer'),key);
  assert(state()===typed,'typing scene shortcut letters in a player field leaves grippers, task and camera unchanged');leaderboard.open=wasOpen;
  const world=TB.world,game=TB.game,cal=RB.cal,input=RB.taskInput,oldDrive={R:drive.R.slice(),t:drive.t.slice(),open:drive.open};
  button.focus();button.click();
  assert(dialog.open&&dialog.matches(':modal')&&dialog.contains(document.activeElement)&&button.getAttribute('aria-expanded')==='true','help uses a native modal with initial focus inside');
  plot.focus();assert(dialog.contains(document.activeElement),'the modal prevents focus from reaching the scene behind it');
  const before=state();let escaped=false;const observer=e=>{if(e.key==='Escape')escaped=true;};document.addEventListener('keydown',observer);
  body.focus();for(const key of ['w','q','i','u',' ','t','m','c','r','f','v','1','2','3','ArrowUp'])press(body,key);
  assert(!press(body,'Escape').defaultPrevented,'help leaves the native Escape dismissal action enabled');
  document.removeEventListener('keydown',observer);
  assert(state()===before&&!escaped,'help keys cannot move grippers, reset the task or trigger shortcuts behind the modal');
  assert(TB.world===world&&TB.game===game&&RB.cal===cal&&RB.taskInput===input&&C.norm(C.sub(drive.t,oldDrive.t))===0&&drive.open===oldDrive.open&&C.norm(C.sub(drive.R,oldDrive.R))===0,'opening help preserves the world, calibration, task origin and current gripper target');
  const help=TASK_DATA.controls_help,keyboard=$('controlsKeyboard'),windowOfKeys=body.querySelector('.controls-keyboard-window'),keyTitle=$('controlsKeyTitle'),keyDetail=$('controlsKeyDetail');
  const choose=id=>document.querySelector('[data-keyboard-layout="'+id+'"]').click();
  const keys=()=>[...keyboard.querySelectorAll('.controls-key')],key=label=>keys().find(k=>k.dataset.keyLabel===label),row=i=>[...keyboard.querySelector('[data-row="'+i+'"]').querySelectorAll('[data-key-label]')].map(k=>k.dataset.keyLabel);
  const radios=[...dialog.querySelectorAll('[data-keyboard-layout]')];choose('us');radios[0].focus();
  for(const [input,selected]of [['ArrowRight',1],['ArrowRight',0],['ArrowLeft',1],['Home',0],['End',1]]){
    assert(press(document.activeElement,input).defaultPrevented&&document.activeElement===radios[selected]&&radios.every((radio,i)=>radio.tabIndex===(i===selected?0:-1)&&radio.getAttribute('aria-checked')===String(i===selected))&&keyboard.dataset.layout===radios[selected].dataset.keyboardLayout,'layout radio keys select, focus and maintain one tab stop: '+input);
  }
  for(const layout of help.keyboard.layouts){
    choose(layout.id);
    assert(keyboard.dataset.layout===layout.id&&document.querySelector('[data-keyboard-layout="'+layout.id+'"]').getAttribute('aria-checked')==='true','the layout toggle selects '+layout.label);
    assert(row(1).slice(1,11).join('')===(layout.id==='de'?'QWERTZUIOP':'QWERTYUIOP'),'the physical top letter row matches '+layout.label);
    assert(row(3).includes(layout.id==='de'?'Y':'Z')&&!row(3).includes(layout.id==='de'?'Z':'Y'),'Y and Z occupy the correct physical rows in '+layout.label);
    assert(key('F').tagName==='BUTTON'&&['F1','G','H','Y','Z','Tab','Enter'].every(label=>key(label).tagName==='SPAN'&&!key(label).dataset.controlAction),'only actually bound keys are highlighted and interactive, not nearby letters or function keys');
    const expected=layout.rows.flat().filter(k=>k.action).length+help.keyboard.function_row.filter(k=>k.action).length;
    assert(keyboard.querySelectorAll('button.is-bound').length===expected&&keys().every(k=>k.tagName!=='BUTTON'||help.actions[k.dataset.controlAction]),'every highlighted key has one data-backed action in '+layout.label);
    for(const line of keyboard.children){const rects=[...line.children].map(el=>el.getBoundingClientRect());assert(Math.abs(line.getBoundingClientRect().height-44)<1&&rects.every((r,i)=>r.width>5&&(!i||r.left>=rects[i-1].right)),'physical key rows preserve spacing, fixed height and order in '+layout.label);}
    assert(windowOfKeys.clientHeight>=keyboard.getBoundingClientRect().height,'the full keyboard height remains visible rather than collapsing inside the scrolling dialog');
    if(layout.id==='de'){
      assert(key('0').dataset.shiftLabel==='='&&key('0').dataset.controlAction==='zoom_in_shift'&&keyboard.querySelector('[data-row="1"] [data-key-label="+"]').dataset.controlAction==='zoom_in'&&keyboard.querySelector('[data-row="3"] [data-key-label="-"]').dataset.controlAction==='zoom_out','German zoom bindings appear on Shift+0, + and bottom-row minus');
      assert(row(1).includes('Ü')&&row(2).includes('Ö')&&row(2).includes('Ä')&&row(2).includes('#')&&row(3)[1]==='<','German umlauts, ISO extra key and punctuation occupy their physical positions');
      key('0').click();assert(keyTitle.textContent.startsWith('Shift + 0')&&keyDetail.textContent===help.actions.zoom_in_shift.detail,'German 0 explains the required Shift character rather than advertising an unbound bare 0');
    }else assert(key('0').tagName==='SPAN'&&keyboard.querySelector('[data-row="0"] [data-key-label="="]').dataset.controlAction==='zoom_in'&&keyboard.querySelector('[data-row="0"] [data-key-label="-"]').dataset.controlAction==='zoom_out','US zoom bindings occupy the equals and minus keys, with 0 unbound');
    key('Q').dispatchEvent(new PointerEvent('pointerenter'));assert(keyDetail.textContent===help.actions.up.detail,'hovering a bound key shows its actual use');
    key('W').focus();assert(keyDetail.textContent===help.actions.forward.detail,'keyboard focus exposes the same usage as hover');
    key('E').click();assert(keyDetail.textContent===help.actions.down.detail,'tapping a key exposes its use without executing a command');
    const oldDetail=keyDetail.textContent;key('Z').click();assert(keyDetail.textContent===oldDetail,'unbound keys do not invent actions');
  }
  assert($('controlsArrows').querySelectorAll('button').length===4&&[...$('controlsArrows').querySelectorAll('button')].every(b=>help.actions[b.dataset.controlAction]),'the separate physical arrow cluster includes all four real bindings');
  for(const mouse of help.mouse){const control=document.querySelector('[data-mouse-control="'+mouse.id+'"]');control.click();assert(keyDetail.textContent===help.actions[mouse.action].detail&&control.getAttribute('aria-label').includes(mouse.label),'mouse diagram control explains its data-backed use: '+mouse.id);}
  assert(state()===before&&TB.world===world&&TB.game===game,'layout changes and keyboard/mouse inspection never execute the pictured shortcuts');
  const bounds=dialog.getBoundingClientRect(),content=body.getBoundingClientRect(),fixedClose=close.getBoundingClientRect();
  assert(bounds.left>=9&&bounds.right<=innerWidth-9&&bounds.top>=9&&bounds.bottom<=innerHeight-9&&body.scrollWidth<=body.clientWidth+1&&document.documentElement.scrollWidth<=innerWidth,'the help panel fits the viewport; only the physical keyboard can scroll sideways');
  if(innerWidth<=760)assert(windowOfKeys.scrollWidth>windowOfKeys.clientWidth&&getComputedStyle(windowOfKeys).overflowX==='auto','phone users can swipe a readable physical keyboard without shrinking its keys');
  assert(getComputedStyle(body).overflowY==='auto'&&content.bottom<=bounds.bottom&&fixedClose.top>=bounds.top&&fixedClose.bottom<=bounds.bottom,'long mappings scroll within the dialog while the close button stays visible');
  body.scrollTop=body.scrollHeight;assert(close.getBoundingClientRect().top===fixedClose.top,'scrolling to the last mapping keeps the X reachable');
  close.click();await sleep(0);assert(!dialog.open&&document.activeElement===button&&button.getAttribute('aria-expanded')==='false','X closes in place and returns focus to the keyboard button');
  button.click();assert(dialog.open&&typeof dialog.requestClose==='function','help can reopen and supports the native Escape close request');dialog.requestClose();await sleep(0);
  assert(!dialog.open&&document.activeElement===button&&TB.world===world&&TB.game===game,'native cancel/Escape closure returns focus without restarting or navigating');
  // Leave a physical keyboard and its selected usage visible for screenshot review.
  button.click();choose('us');key('W').click();windowOfKeys.scrollLeft=0;windowOfKeys.scrollTop=0;body.scrollTop=0;close.focus();await sleep(50);
  return {passed:true,physicalLayouts:help.keyboard.layouts.length,mouseControls:help.mouse.length,modalFocus:true,typingSafe:true,preservedTask:true,viewport:[innerWidth,innerHeight]};
})()
