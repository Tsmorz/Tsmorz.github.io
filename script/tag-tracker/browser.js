// Run after task build: task shot -- /tag-tracker/ --eval "$(cat script/tag-tracker/browser.js)"
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const until = async (fn, message, timeout = 3500) => { const t = performance.now(); while (!fn() && performance.now() - t < timeout) await wait(50); assert(fn(), message); };
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  taskLevel('bowl'); await wait(400);
  assert(TASK_DATA.levels.length >= 8 && $('taskLevels').children.length === TASK_DATA.levels.length, 'all levels are available');
  assert(!robotGL().lost, 'WebGL robot renderer is available');
  // The actual on-screen buttons move the selected hand, and Both preserves the hand spacing in free air.
  document.querySelector('[data-hand="1"]').click();
  document.querySelector('[data-nudge="up"]').click();
  assert(TB.drive.has(1) && !TB.drive.has(-1), 'the left-hand nudge takes over only the selected hand');
  document.querySelector('[data-hand="both"]').click(); document.querySelector('[data-nudge="up"]').click();
  assert(TB.drive.has(1) && TB.drive.has(-1), 'Both controls both hands');
  const beforeRoll = TB.drive.get(1).R.slice(); document.querySelector('[data-roll="1"]').click();
  assert(C.angleOf(C.mul3(C.tr3(beforeRoll), TB.drive.get(1).R)) > 0.05, 'wrist roll can orient plates for the rack');
  resetTable(); await wait(300);
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
  assert(TB.game.level.id === 'precision' && !TB.game.complete && !TB.drive.size, 'next level starts fresh');
  // A real head-mounted projection, including drag and keyboard controls, rather than an orbit-camera preset.
  document.querySelector('[data-robot-view="eyes"]').click();
  $('headTilt').value = -45; $('headTilt').dispatchEvent(new Event('input', { bubbles: true }));
  await wait(150);
  const eye = plotOrbit().o.eye, expected = TaskCore.headCamera(RB.scene.chest, RB.scene.m, -45, plot.clientWidth, plot.clientHeight).eye;
  assert(C.norm(C.sub(eye, expected)) < 1e-8, 'the camera is on the robot head');
  plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
  assert(S.settings.robot.headTilt === -42, 'up arrow tilts the robot head up');
  // Exercise every new mesh and objective view in a live browser.
  for (const l of TASK_DATA.levels) { taskLevel(l.id); await wait(l.id === 'laundry' ? 700 : 120); assert(TB.world && TB.game.level.id === l.id, l.id + ' scene loads'); }
  assert(TB.world.cloths.length === 3 && TB.world.cloths.every((c) => c.nodes.every((n) => n.p.every(Number.isFinite))), 'the laundry pile simulates and renders');
  assert(document.documentElement.scrollWidth <= innerWidth + 1, 'the layout has no horizontal page overflow');
  const campaign = $('taskPanel').getBoundingClientRect(), stage = $('plot').getBoundingClientRect();
  assert(innerWidth < 1001 || $('taskPanel').lastElementChild.getBoundingClientRect().bottom <= campaign.bottom + 1, 'campaign content stays inside its card');
  const edge = plotOrbit().o.project(C.add(plotOrbit().o.eye, C.add(plotOrbit().o.fwd, plotOrbit().o.right.map(v => v * Math.tan(35 * Math.PI / 180)))));
  assert(Math.abs(edge[0] - stage.width) < 1, 'portrait and landscape views keep the same horizontal field of view');
  const tilt = S.settings.robot.headTilt;
  resetTable(); await wait(150);
  assert(!TB.game.complete && TB.game.elapsed === 0 && S.settings.robot.headTilt === tilt, 'restart clears the task and keeps head tilt');
  $('plot').scrollIntoView({ block: 'center' });
  return { passed: true, levels: TASK_DATA.levels.length, ballPlayedThroughPhysics: true, headCamera: true, cloths: TB.world.cloths.length, viewport: [innerWidth, innerHeight] };
})()
