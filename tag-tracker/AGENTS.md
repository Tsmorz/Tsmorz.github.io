# Tag Tracker

A self-contained page with `layout: null` front matter to render `_data/tag_tasks.yml`. The classic
scripts in `index.html` share one global scope. The page tracks AprilTags and drives a simulated robot.

## Editing and checking

- Content, task variants and hints belong in `_data/tag_tasks.yml`, never in markup or JS strings.
- `app-*.js` files may declare functions and wire handlers at load, but cannot read or call later files.
  Startup calls belong in the boot script at the end of `index.html`. Keep its script order intact.
- Avoid top-level names belonging to `window` (`name`, `status`, `stop`, `print`, `on...`).
- Run `node --check` on edited JS, then `task versions`: every script's `?v=` must match its content.
  The worker's version also covers `tracker-core.js`, which it imports with the same query.
- Keep no-DOM logic in the cores. `script/test-tag-tracker` is `task check:tag-tracker`; select sections
  while iterating, e.g. `task check:tag-tracker -- 5j 5k 5o 5q`. Sections reseed their random numbers.
- Build before browser checks. `task shot -- /tag-tracker/ --eval-file script/tag-tracker/<test>.js`
  fails on page exceptions. Inspect the PNG; repeat with `--phone`. Headless WebGL needs Metal.
- Run `task ci` before finishing. OpenCV detection/calibration tests are optional when the pinned npm
  package isn't installed; the other core tests must run without hardware.

## Look and navigation

Cool anodised greys, ink and the site's violet accent; amber only for warnings. No orange accent,
rounded cards, pills, monospace labels or panel shadows. Use Archivo, wide for names and titles.
Panels have a 1 px outline and 4 px corners; reticle corner marks belong only on video.
Tag colours keep their categorical slot in storage (eight slots, then labelled grey). Label x/y/z.
The robot has one generic look, the Machine; don't restore human avatars, story rooms or rewards.

The shared header has Calibrate → Tracking → Tasks. Tracking and Calibrate share the camera column;
Tasks alone mounts `#gameHUD`. Tab switches must preserve the physical scene and current task.
`S.tab` selects the page; `S.mode` selects calibration or tracking detection. Setup belongs in Settings
and Task settings, not a hand command bar. Camera & AprilTags opens Tracking and its setup guide.

## Tracking contracts

- OpenCV.js is pinned to `@techstark/opencv-js@4.12.0-release.1`; Transformers to `4.3.2`, CDN-loaded,
  not vendored. AprilTags use corner refinement and the half-pixel OpenCV pixel-centre shift.
  ChArUco uses DICT_5X5_100 so it cannot collide with the tag dictionary.
- Poses are always the camera's true poses. Mirror, Flip and Blur affect the picture and overlay only
  (`TagCore.displayMap`), never detection, fusion, plots, recordings or robot input.
- Lens calibrations are keyed by the device's own label, never its user-visible name.
  Tares and robot calibration (`S.tare`, `RB.cal`) stay in memory, not persistent storage.
- Camera 1 is the common frame. `toRig` transforms sightings; rig calibrations are stored by device
  key and re-expressed when cameras change order. Unplaced cameras draw only their own poses.
- Fusion uses every camera's corners (`refineJoint`, `PoseFilter.updateCorners`), with late frames
  moved using track velocity. Retain model-error noise (`modelPx`, `MODEL_PX`) or calibration error
  makes the filter chase incompatible cameras.
- Raw uses IPPE; Refined fits on SE(3) from both planar mirror candidates; Filtered chooses among
  similarly good candidates using the prediction and gates outliers. Preserve covariance checks.
- Rigid objects are solved from all visible corners. Learning stores tag poses relative to the first
  tag and averages on SO(3) × R³; component tags are not also tracked independently.
- Search windows (`searchPlan`, `planSearch`) must preserve whole-image coordinates and fall back to
  full search after misses. Worker frames are luma, windows even-sized; drop overtaken results.
- The three-camera Demo is real rendered input to detection. It overrides saved roles: Body 2,
  Left wrist 1, Right wrist 0. Keep its stationary calibration gate and roughly 20 ms frame delay;
  compare against truth at capture time minus that delay. `demoPose` must avoid joint limits.

## Robot, table and input

`robot-core.js` owns the seven-joint arms and analytic IK. Keep `MIN_BEND`: fully straight elbows are
singular. Follow previous solutions with bounded elbow swing, and retain motor slew. Motion × scales
translation from the calibrated wrist home, not wrist orientation or chest motion.

Mouse targets (`TB.drive`) are world-fixed until Resume AprilTags or recalibration. `grabPlane` and
`holdBack` must keep corrections inside the drag plane; reaching an arm limit must not lift its target
out of that plane. Only the actual gripper is pickable. Picking, drawing and projection must share the
head camera, including its tilt. Calibrate robot reads un-tared poses.

The hands are physical bodies pulled by limited springs, not cursor teleports. They collide with the
other arm and gripper, excluding their own links by side-prefixed IDs. Rigid grip loads include both
joint and pad forces; don't report their internal cancellation as an external load.
Compound rendering and collision dimensions must agree, with hollow openings. Mass properties use
piece inertia and the parallel-axis theorem. Material IDs in `MATERIALS` go over the air: never renumber.
Keep fixed 240 Hz substeps, contact friction, warm starting, sleeping and bounded reactions together.

AprilTags remain the default input. Mouse drag moves a gripper; scroll closes/opens it, Space toggles,
Shift-scroll tilts and Alt-drag changes plane. 1/2/3 select left/right/both. Q/E lift/lower; J/K tilt,
I/P tilt sideways, U/O roll. In Robot eyes, arrow keys move the selected hand; tilt stays on the slider.
Task `ready` poses apply only to idle arms, never to AprilTag input. Preserve the existing elbow when
mouse control takes a ready hand. Stationary real body/wrist tags auto-calibrate after 0.8 s.

## The five tasks

The catalogue is exactly `bowl`, `sort`, `tray`, `cable`, `laundry`, freely selectable in that order.
Both placement variants contain two blocks. Removed IDs fall back to `bowl`; don't add progression
locks. `TaskCore.mission` must not mutate its full variant. Keep small/full records separate.
Changed objectives need new revisions: old shirt, single-fold and fixed-socket times cannot compete
with the new towel or phone tasks. Timers use monotonic elapsed time, not capped physics time.

Guidance reads actual constraints and goals; it never moves props or awards success. After placing A,
keep the empty-gripper retreat before picking B with the same gripper. Show wrong-prop, missing-hand
and missing-layer hints. Keep guidance, destinations and objectives visible.

`balance` monitors ball/rim geometry every physics substep, including before grasping the tray.
A rim hit or lost load invalidates the attempt until restart. Require both a clean elevated two-hand
hold and released set-down. Test actual contacts, not just a ball parked at its final coordinates.

The towel has a fabric core, plush nap, layer contact and a closed render shell. `halfThickness` is
its contact radius: do not name it `radius`, which identifies cables in rendering. Keep loft visible
and table clearance real. GPU buffers must rebuild when deformable topology changes. Plush sleep
tolerates a few (≤3%) chattering corner nodes: requiring every node still leaves a folded towel
awake, and its `settle` unmet, for tens of seconds on some platforms' floating point.

Grips use finite barycentric material patches; a single pinned vertex permits free spinning. Clamp
both actual material halves at the doubled open edge; neighbouring points on one ply are insufficient.
Bound the total force across captured layers. Plush patches may yield in bending under measured
contact moment, retaining a shared grip centre and sideways twist constraint. Keep their reactions.
Solve layer contact and accumulated table friction with stretch; late projections leave artificial
strain. Preserve contact side across a substep rather than pushing a crossed layer further through.

The `xx` objective requires a released first-fold checkpoint, both second grasps, overlapping material
quarters, a spread footprint and released settling. Loose fluffy corners are allowed; one fold or a
crushed bundle is not. First fold toward the robot, then return the doubled open edge to the crease.
Keep grippers down so this is playable without wrist inversion. Geometry and forces are representative,
not calibrated fabric FEM. Waking a resting towel must still permit a real grasp.

## Charging and controller contracts

`charging-core.js` requires a released two-pin charger in the outlet, then USB-C insertion while a
raised, free Samsung-style phone is held in the other hand. Both opposing grips must overlap during
insertion for at least 0.1 s; picking up a preconnected assembly cannot pass. Release the plug while
continuing to hold the phone; keep both connections seated. No pose snapping or locking.

The socket is a frame on the phone body. Preserve continuous sleeve contact, spring detent and equal
and opposite reactions. Tiny cylinder samples must fit the real 2 mm charger pins. The cable couples
both moving endpoints, with stretch, curvature, gravity, self/rigid/table contact and friction.
The old fixed socket is test-only (`connector-fixture.json`). The outlet is not electrical simulation.

Controller firmware belongs in `../nrf-controller`, never this repo. `decodeImuBatch` must match
`src/sysid_wire.h`. TP/1 framing/freshness policies live in `src/teleop_wire.*` and `teleop_policy.*`;
keep their C/JS byte parity. USB/ESB is a separate image, default 1 Mbaud, not normal BLE firmware.
Source clocks must survive gateway forwarding and reboot; USB replaces duplicate BLE connections.
Never open a serial console on a port owned by the page. Neither transport starts an unseen camera
track. Fuse IMU only into a still-live, aligned Filtered track.

Task feedback is finite TacHammer CLICK/KNOCK only: six-byte version-2 commands, capped at 45%, BLE
10 Hz and USB/ESB changing cues up to 25 Hz. No ERM, servo-motion or STOP_ALL writes (the latter would
also release a servo). Readiness doesn't require the power rail already on; firmware acquires it.
Unmapped, simulated, stale (>500 ms), unready or disconnected boards receive no task output. Drop busy
writes rather than queueing them. Reset cues on task changes, off, blur and hidden pages. ACK means
acceptance, not physical motion. Retain 100 ms source freshness, 50 ms gateway expiry and 120 ms ACK
timeouts. Configured 416 Hz/2 Mbit/s targets are not hardware latency or force measurements.

Voice uses whole utterances and preserves Tasks unless explicitly changing tabs. Bluetooth controller
push-to-talk follows ACT `keys`, not paused data-event streams. Preserve ordered writes and epoch-
scoped cancellation; grant the optional audio service. USB/ESB has no microphone stream. Keep the
`audio_wire.h`/ADPCM contract with nrf-controller; computer-microphone input remains available.

Stream drops an in-flight message rather than queueing. The UDP bridge accepts only localhost and
`tsmorz.github.io` unless `--origin` adds one. Printing uses true paper size and rejects fit-to-page.
Setup choices apply only through Next/Print/phone actions, never merely by closing the dialog.

## Regression entry points

`teleop.cjs` (5j), `guidance.cjs` (5k), `balance.cjs` (5q), `fabric.cjs` (5o), `advanced.cjs` (5l),
`controller-link.cjs` (5m), `charging.cjs` (5n), `voice.cjs` (5p). Browser counterparts exercise actual
IK, motor slew, physical grasps and release: `guided-browser.js`, `balance-browser.js`,
`fabric-browser.js`, `charging-browser.js`, `serial-browser.js`, `voice-browser.js` and
`workbench-browser.js`. Repeat responsive checks on a phone. State what has not run on real hardware.
