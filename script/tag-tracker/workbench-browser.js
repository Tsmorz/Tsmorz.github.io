// task shot -- /tag-tracker/ --eval-file script/tag-tracker/workbench-browser.js (also --phone)
(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const visible = el => !!el && el.getBoundingClientRect().height > 0 && getComputedStyle(el).display !== 'none';
  const key = (el, value, shiftKey = false) => el.dispatchEvent(new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true }));
  const tabs = [...document.querySelectorAll('.tabs [role=tab]')];
  assert(tabs.map(b => b.textContent.trim()).join(',') === 'Calibrate,Tracking,Tasks', 'tabs follow the setup, tracking, task workflow');
  assert(S.tab === 'tasks' && gameView(), 'the initial workbench is the selected Tasks tab');
  await wait(300);
  const readyFrame = label => {
    for (const a of RB.scene.arms) {
      const k = RCORE.fk(RB.scene.m, a.side, a.q);
      assert(k.elbow[2] < k.shoulder[2] - RB.scene.m.upper * .98 && k.wrist[0] > k.elbow[0] + RB.scene.m.fore * .98, label + ': elbows down, forearms forward');
      assert(Math.abs(k.R[4]) > .99 && -k.R[2] > .99, label + ': fingers forward, jaws sideways');
      assert(a.open === 1, label + ': idle grippers fully open');
    }
    const V = S.view, camera = C.orbit({ yaw: V.yaw, pitch: V.pitch, dist: V.dist, target: V.target, fov: 45, w: plot.clientWidth, h: plot.clientHeight });
    assert(C.norm(C.sub(RB.view.eye, camera.eye)) < 1e-9, label + ': the rendered camera already matches the initialized view');
  };
  // Reproduce a fresh load, including unset fit bounds, and inspect its very first rendered frame.
  robotReset(); RB.pts = []; TB.world = null; TB.sig = ''; Object.assign(S.view, view0());
  draw3d(); readyFrame('first frame');
  // Every task starts in the same pose immediately, through the real renderer, IK, slew and physics.
  const startPoses = [];
  for (const id of TASK_DATA.levels.map(l => l.id)) {
    taskLevel(id); draw3d(); readyFrame(id + ' first frame'); await wait(500);
    readyFrame(id + ' settled');
    startPoses.push({ id, hands: [1, -1].map(side => { const a = RB.scene.arms.find(x => x.side === side), k = RCORE.fk(RB.scene.m, side, a.q); return { wrist: k.wrist, R: k.R }; }) });
  }
  const sameStart = startPoses.every(p => p.hands.every((h, i) => C.norm(C.sub(h.wrist, startPoses[0].hands[i].wrist)) < 1e-6 && C.norm(C.so3Log(C.mul3(h.R, C.tr3(startPoses[0].hands[i].R)))) < 1e-6));
  assert(sameStart && TB.drive.size === 0, 'every task starts both arms in the same ready pose: ' + JSON.stringify(startPoses.map(p => [p.id, p.hands.map(h => h.wrist.map(v => +v.toFixed(3)))])));
  taskLevel(startPoses[0].id); await wait(300);
  const world = TB.world, game = TB.game;
  for (const mode of ['calib', 'track', 'tasks']) {
    $('tab-' + mode).click();
    if (mode !== 'calib') {
      draw3d();
      if (mode === 'tasks') readyFrame('return to Tasks first frame');
      else assert(RB.scene.arms.every(a => C.norm(C.sub(a.q, RCORE.HOME)) < 1e-9), 'Tracking returns directly to HOME without an idle motor transition');
    }
    await wait(120);
    assert(S.tab === mode && $('tab-' + mode).getAttribute('aria-selected') === 'true', mode + ' selects the correct tab');
    assert(tabs.every(visible), 'all navigation stays visible in ' + mode);
    assert(visible($('calibCard')) === (mode === 'calib') && visible($('gameHUD')) === (mode === 'tasks'), 'only the current panel is visible in ' + mode);
    assert(document.documentElement.scrollWidth <= innerWidth + 1, mode + ' fits the viewport');
  }
  const stage = plot.getBoundingClientRect(), hud = $('gameHUD').getBoundingClientRect();
  assert(Math.abs(stage.top-hud.top) < 1 && stage.bottom <= innerHeight, 'the task stage stays aligned below the header without inheriting the sticky Tracking offset');
  assert(TB.world === world && TB.game === game, 'switching tabs preserves the task and physical scene');
  key($('tab-tasks'), 'Home'); assert(S.tab === 'calib' && document.activeElement === $('tab-calib'), 'Home selects and focuses Calibrate');
  key($('tab-calib'), 'ArrowRight'); assert(S.tab === 'track', 'Right arrow advances to Tracking');
  key($('tab-track'), 'End'); assert(S.tab === 'tasks', 'End returns to Tasks');
  assert(!document.querySelector('#handControls,[data-nudge],#playGrip,#playRelease'), 'the old hand command bar is removed entirely');
  setRobotView('eyes'); await wait(120);
  key(plot, '1');
  const arm = chosenHands()[0], drive = driveOf(arm), start = drive.t.slice(), tilt = S.settings.robot.headTilt, axis = C.mulv(TB.world.table.R, [0,0,1]);
  key(plot, 'ArrowUp');
  assert(C.norm(C.sub(C.sub(drive.t,start),axis.map(v=>v*.012))) < 1e-8, 'Up raises the selected gripper by 12 mm');
  key(plot, 'ArrowDown');
  assert(C.norm(C.sub(drive.t,start)) < 1e-8 && S.settings.robot.headTilt === tilt, 'Down lowers the gripper without tilting the head');
  key(plot, 'ArrowUp', true);
  assert(C.norm(C.sub(C.sub(drive.t,start),axis.map(v=>v*.0002))) < 1e-8, 'Shift+Up provides the fine 0.2 mm lift');
  key(plot, 'ArrowDown', true);
  key(plot, 'ArrowLeft'); key(plot, 'ArrowRight');
  assert(C.norm(C.sub(drive.t,start)) < 1e-8, 'Left and Right move the gripper sideways');
  const before = TB.world.handPose(1).t.slice();
  for (let i=0;i<3;i++) key(plot, 'ArrowUp');
  await wait(850);
  const physicalRise = C.sub(TB.world.handPose(1).t,before).reduce((sum,v,i)=>sum+v*axis[i],0);
  assert(physicalRise > .02, 'arrow-key lift moves the physical gripper through IK and motor slew');
  for (let i=0;i<3;i++) key(plot, 'ArrowDown');
  const wristRotation=drive.R.slice();key(plot,'i');
  assert(C.norm(C.so3Log(C.mul3(C.tr3(wristRotation),drive.R)))>.08,'sideways wrist tilt is directly available for sleeve folding');key(plot,'p');
  assert(C.norm(C.so3Log(C.mul3(C.tr3(wristRotation),drive.R)))<1e-8,'opposite sideways wrist keys return to the same orientation');
  key(plot, '2'); assert(TASK.hand === '-1', '2 selects the right gripper');
  key(plot, '3'); assert(chosenHands().length === 2, '3 selects both grippers');
  key(plot, '1');
  assert(!$('gameSettingsBtn')&&!$('gameSettings')&&!$('campaignMode'),'task settings and alternate challenges are removed');
  assert($('taskHapticStrength').closest('.game-actions')&&$('taskMotionScale').closest('.game-actions'),'haptic strength and motion sensitivity share the side control rail');
  setRobotView('orbit');assert(!visible($('gameTiltField')),'head tilt is hidden in the outside view');
  setRobotView('eyes');assert(visible($('gameTiltField')),'head tilt appears in robot-eye view');
  const rail=document.querySelector('.game-corner').getBoundingClientRect(),guide=document.querySelector('.workbench-guide').getBoundingClientRect(),scene=plot.getBoundingClientRect();
  const sliders=['taskHapticStrength','taskMotionScale','gameTilt'].map(id=>$(id).getBoundingClientRect());
  assert(sliders.every((r,i)=>r.width>=110&&r.left>=rail.left&&r.right<=rail.right&&(!i||r.top>=sliders[i-1].bottom)), 'horizontal sliders have usable travel and stack vertically inside the side rail');
  assert(rail.width<=220&&rail.right<=hud.right+1&&rail.bottom<=hud.bottom+1&&rail.top>=hud.top-1,'the compact rail fits within the workbench');
  if(innerWidth<=720) assert(scene.width>=hud.width-2&&scene.bottom<=rail.top+1&&guide.right<=rail.left+1,'phone controls sit beside the guide below an unobscured full-width scene');
  else assert(scene.right<=rail.left+1&&guide.right<=scene.left+1,'desktop guidance, scene and side controls have separate space');
  for(const id of ['gameEyes','soundBtn','gameController','gameKeyboard','gameHaptics','taskHapticStrength','taskMotionScale','gameTilt']){
    $(id).scrollIntoView({block:'nearest'});const r=$(id).getBoundingClientRect();
    assert(r.left>=rail.left&&r.right<=rail.right&&r.top>=rail.top&&r.bottom<=rail.bottom,'every rail control remains reachable without covering the scene: '+id);
  }
  assert($('gameHaptics').textContent.includes('75%')&&$('taskHapticStrength').value==='75','the rail preserves the selected 75% haptic peak');
  const motion=S.settings.robot.scale;$('taskMotionScale').value=.65;$('taskMotionScale').dispatchEvent(new Event('input'));
  assert(S.settings.robot.scale===.65&&$('taskMotionValue').textContent==='0.65×','the rail movement slider updates its visible value and shared movement gain');
  $('taskMotionScale').value=motion;$('taskMotionScale').dispatchEvent(new Event('input'));
  $('gameController').click();assert(visible($('controllerPanel')),'the controller popup opens');
  const popup=$('controllerPanel').getBoundingClientRect();
  assert(popup.left>=hud.left-1&&popup.right<=hud.right+1&&popup.top>=rail.top-1&&popup.bottom<=rail.bottom+1&&getComputedStyle($('controllerPanel')).overflowY==='auto','the controller popup fits the side rail height and can scroll its device details');
  $('ctlClose').click();assert(!visible($('controllerPanel'))&&S.tab==='tasks','the popup X closes in place');
  $('gameTilt').value = -45; $('gameTilt').dispatchEvent(new Event('input'));
  assert(S.settings.robot.headTilt === -45, 'the head slider still tilts the wide camera');
  setRobotView('orbit');
  $('tab-track').click(); document.querySelector('[data-show3d="tags"]').click();
  $('tab-tasks').click(); assert(S.settings.show3d === 'robot' && gameView(), 'Tasks always shows the robot');
  $('tab-track').click(); assert(S.settings.show3d === 'tags' && document.querySelector('[data-show3d="tags"]').getAttribute('aria-checked') === 'true', 'Tracking restores its saved Tags view and selected control');
  $('tab-tasks').click();
  taskLevel('laundry');await wait(450);
  const shirt=TB.world.cloths[0];
  assert(shirt.kind==='shirt'&&shirt.halfThickness===.001&&!shirt.pile&&shirt.landmarks.cuffs.length===2,'the fabric task loads a thin cut-pattern T-shirt');
  const meshes=RobotGL.meshes(RB.scene.m);
  assert([1,-1].every(j=>meshes.finger[j].filter(p=>p.tip).length===1&&meshes.finger[j].every(p=>p.grip))&&[1,-1].every(j=>meshes.hand[j].some(p=>p.grip)&&meshes.hand[j].some(p=>!p.grip))&&[...meshes.upper,...meshes.fore,...meshes.foreLight,...meshes.body].every(p=>!p.grip),'gripper fingers and palm highlight together while wrist cuffs and arms stay unhighlighted');
  return { passed: true, persistentTabs: true, preservedTask: true, eyeArrowControls: true, viewport: [innerWidth,innerHeight] };
})()
