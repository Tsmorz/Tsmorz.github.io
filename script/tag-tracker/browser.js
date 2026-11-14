// Run after task build: task shot -- /tag-tracker/ --eval "$(cat script/tag-tracker/browser.js)"
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const until = async (fn, message, timeout = 3500) => { const t = performance.now(); while (!fn() && performance.now() - t < timeout) await wait(50); assert(fn(), message); };
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  setMode('tasks');setCampaignMode('practice'); taskLevel('bowl'); await wait(400);
  assert(TASK_DATA.levels.length === 5 && $('taskLevels').children.length === TASK_DATA.levels.length, 'all levels are available');
  assert(!robotGL().lost, 'WebGL robot renderer is available');
  assert(!document.querySelector('[data-nudge]')&&!document.querySelector('[data-hand]'),'the obsolete command bar stays removed');
  // Play the first level using only wrist targets passed through IK, motor slew, real pad contacts and physics.
  // Props are never moved directly by this test.
  const sc = RB.scene, W = TB.world, ball = TB.game.byKey.get('ball'), arm = sc.arms.find((a) => a.side === 1), d = driveOf(arm);
  const finger = RCORE.gripper(sc.m).finger.c[2], offset = C.mulv(d.R, [0, 0, finger]), start = W.poseOf(ball).t.slice();
  d.open = 1; d.t = C.sub(C.add(start, [0, 0, 0.07]), offset); await wait(1700);
  d.t = C.sub(start, offset); await wait(1500); d.open = 0;
  await until(() => W.hands[1].grip && W.hands[1].grip.body === ball, 'the robot can grasp the first ball');
  d.t = C.add(d.t, [0, 0, 0.15]); await wait(1500);
  assert(W.poseOf(ball).t[2] > start[2] + 0.07, 'the physical grip lifts its load');
  const bowl = W.poseOf(TB.game.byKey.get('bowl')).t;
  d.t = C.sub(C.add(bowl, [0, 0, 0.16]), offset); await wait(2200); d.open = 1;
  await until(() => TB.game.complete, 'a released ball physically lands in the bowl and completes the level', 4500);
  assert(!$('taskNext').hidden && TASK.saved.bowl && JSON.parse(localStorage.getItem('tag-tracker-teleop')).bowl, 'completion exposes the next level and saves the personal best');
  $('taskNext').click(); await wait(300);
  assert(TB.game.level.id === 'sort' && !TB.game.complete && !TB.drive.size, 'next level starts fresh');
  // A real head-mounted projection, including drag and keyboard controls, rather than an orbit-camera preset.
  $('gameEyes').click();
  $('gameTilt').value = -45; $('gameTilt').dispatchEvent(new Event('input', { bubbles: true }));
  await wait(150);
  const eye = plotOrbit().o.eye, expected = TaskCore.headCamera(RB.scene.chest, RB.scene.m, -45, plot.clientWidth, plot.clientHeight).eye;
  assert(C.norm(C.sub(eye, expected)) < 1e-8, 'the camera is on the robot head');
  const hand=driveOf(RB.scene.arms.find(a=>a.side===1)),beforeZ=hand.t[2];
  plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
  assert(S.settings.robot.headTilt===-45&&hand.t[2]>beforeZ,'the eye-view arrow lifts the selected hand while the slider retains head tilt');
  // Exercise every new mesh and objective view in a live browser.
  for (const l of TASK_DATA.levels) { taskLevel(l.id); await wait(l.id === 'laundry' ? 700 : 120); assert(TB.world && TB.game.level.id === l.id, l.id + ' scene loads'); }
  assert(TB.world.cloths.length === 1 && TB.world.cloths.every((c) => c.nodes.every((n) => n.p.every(Number.isFinite))), 'the thick towel simulates and renders');
  assert(document.documentElement.scrollWidth <= innerWidth + 1, 'the layout has no horizontal page overflow');
  const guide=document.querySelector('.workbench-guide').getBoundingClientRect();
  assert(guide.right<=innerWidth+1&&guide.bottom<=innerHeight+1,'guidance stays inside the viewport');
  const tilt = S.settings.robot.headTilt;
  resetTable(); await wait(150);
  assert(!TB.game.complete && TB.game.elapsed === 0 && S.settings.robot.headTilt === tilt, 'restart clears the task and keeps head tilt');
  $('plot').scrollIntoView({ block: 'center' });
  return { passed: true, levels: TASK_DATA.levels.length, ballPlayedThroughPhysics: true, headCamera: true, cloths: TB.world.cloths.length, viewport: [innerWidth, innerHeight] };
})()
