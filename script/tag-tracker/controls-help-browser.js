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
  const groups=[...body.querySelectorAll('section')],data=TASK_DATA.controls_help.groups;
  assert(groups.length===data.length&&groups.every((g,i)=>g.querySelector('h3').textContent===data[i].title&&g.querySelectorAll('dl>div').length===data[i].mappings.length),'every grouped mapping is rendered from task data');
  for(const [i,g]of groups.entries())assert([...g.querySelectorAll('dl>div')].every((row,j)=>row.querySelector('kbd').textContent===data[i].mappings[j].input&&row.querySelector('dd').textContent===data[i].mappings[j].action),'mapping copy remains complete and data-driven in group '+i);
  const bounds=dialog.getBoundingClientRect(),content=body.getBoundingClientRect(),fixedClose=close.getBoundingClientRect();
  assert(bounds.left>=9&&bounds.right<=innerWidth-9&&bounds.top>=9&&bounds.bottom<=innerHeight-9&&body.scrollWidth<=body.clientWidth+1,'the readable help panel fits the viewport without horizontal scrolling');
  assert(getComputedStyle(body).overflowY==='auto'&&content.bottom<=bounds.bottom&&fixedClose.top>=bounds.top&&fixedClose.bottom<=bounds.bottom,'long mappings scroll within the dialog while the close button stays visible');
  body.scrollTop=body.scrollHeight;assert(close.getBoundingClientRect().top===fixedClose.top,'scrolling to the last mapping keeps the X reachable');
  close.click();await sleep(0);assert(!dialog.open&&document.activeElement===button&&button.getAttribute('aria-expanded')==='false','X closes in place and returns focus to the keyboard button');
  button.click();assert(dialog.open&&typeof dialog.requestClose==='function','help can reopen and supports the native Escape close request');dialog.requestClose();await sleep(0);
  assert(!dialog.open&&document.activeElement===button&&TB.world===world&&TB.game===game,'native cancel/Escape closure returns focus without restarting or navigating');
  // Leave a readable first-page screenshot for desktop and phone review.
  button.click();body.scrollTop=0;close.focus();await sleep(50);
  return {passed:true,groups:groups.length,mappings:data.reduce((n,g)=>n+g.mappings.length,0),modalFocus:true,typingSafe:true,preservedTask:true,viewport:[innerWidth,innerHeight]};
})()
