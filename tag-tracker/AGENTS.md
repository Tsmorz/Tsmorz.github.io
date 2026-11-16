# Tag Tracker

A self-contained AprilTag/robot page; `layout: null` renders `_data/tag_tasks.yml`. Classic scripts share one global scope.

## Editing and checking

- Content, task variants and hints belong in `_data/tag_tasks.yml`, never in markup or JS strings.
- `app-*.js` files may declare functions and wire handlers at load, but cannot read or call later files.
  Startup calls belong in the boot script at the end of `index.html`. Keep its script order intact.
- Avoid top-level names belonging to `window` (`name`, `status`, `stop`, `print`, `on...`).
- Run `node --check` on edited JS, then `task versions`; the worker version also covers its imported `tracker-core.js`.
- Keep no-DOM logic in cores. `task check:tag-tracker -- 5j 5k 5q` selects reseeded test sections; time with `budget()`, never `check()`.
- Build before browser checks. `task shot -- /tag-tracker/ --eval-file script/tag-tracker/<test>.js`
  fails on page exceptions. Inspect the PNG; repeat with `--phone`. Headless WebGL needs Metal.
- Run `task ci` before finishing. OpenCV detection/calibration tests are optional when the pinned npm
  package isn't installed; the other core tests must run without hardware.

## Look and navigation

Use cool anodised greys, ink, violet accents and Archivo; amber only for warnings. No orange,
rounded cards, pills, monospace labels or shadows. Panels have 1 px outlines and 4 px corners.
Reticle corner marks belong only on video.
Tag colours keep their categorical slot in storage (eight slots, then labelled grey). Label x/y/z.
Keep the generic Machine robot; no human avatars, story rooms or rewards.

Preserve Calibrate → Tracking → Tasks and the scene across tab switches. Tasks alone mounts
`#gameHUD`; Tracking pauses and hides the task table (`tableShown`). No Physics or Forces UI.
`S.tab` selects the page; `S.mode` selects calibration/tracking detection. Keep setup in Settings
and Task settings, with Sound, Haptics and Controller available on the task bar.

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

Keep `robot-core.js`'s `MIN_BEND` (straight elbows are singular), bounded elbow swing and motor slew.
`robot.scale` is shared by the Task sensitivity slider and Tracking's Motion × selector. Scale
AprilTag translation from calibrated wrist home and incremental mouse/keyboard travel, never wrist
rotation or chest motion. Changing gain must not rescale an existing mouse target or reset its IK seed.

Mouse targets (`TB.drive`) are world-fixed until Resume AprilTags or recalibration. `grabPlane` and
`holdBack` must keep corrections inside the drag plane; reaching an arm limit must not lift its target
out of that plane. Only the actual gripper is pickable. Picking, drawing and projection must share the
head camera, including its tilt. Calibrate robot reads un-tared poses.

Keep limited-spring physical hands and collisions with the other arm/gripper; exclude their own
side-prefixed links. Rigid grip loads sum joint and pad forces; internal cancellation is not external load.
Match compound rendering/collision dimensions, openings and parallel-axis inertia; never renumber wire `MATERIALS` IDs.
Keep fixed 240 Hz substeps, contact friction, warm starting, sleeping and bounded reactions together.

Every task starts idle arms in the one top-level `ready.joints` pose in `tag_tasks.yml` (degrees); no
task carries its own. It never overrides AprilTag input. Preserve the elbow when the mouse takes a ready
hand. Seed idle joints without a first-frame IK solve, clear idle slew on tab changes, and apply task
camera placement before drawing. Stationary real body/wrist tags auto-calibrate after 0.8 s.
Use `handIK`/`wrist` for task orientation commands: wrist stops never recruit shoulder or elbow motion.
Keep requested wrist Euler angles unwrapped past stops. Contact reconstruction must seed the commanded elbow
and use position-only IK costs; wrist limits must never recruit the shoulder. `wristStop` identifies stop edges.

## The five tasks

Keep `bowl`, `sort`, `tray`, `pour`, `laundry` freely selectable, in order; removed IDs fall back to
`bowl`. Both placement variants need two blocks. `TaskCore.fallen` immediately restarts with a notice.
`TaskCore.mission` must not mutate its full variant. Separate small/full records; changed objectives
need new revisions. Timers use monotonic elapsed time.

Guidance reads actual constraints; never move props or award success. Preserve the empty-gripper
retreat between blocks, wrong-prop/missing-hand/layer hints and visible destinations/objectives.

`balance` monitors ball/rim geometry every physics substep, including before grasping the tray.
A rim hit or lost load invalidates the attempt until restart. Require both a clean elevated two-hand
hold and released set-down. Test actual contacts, not just a ball parked at its final coordinates.

No automated towel tests: Tony tests by hand; scripted folds vary with last-digit rounding.
Keep the fabric core, plush nap, layer contact and closed `clothSurface` shell, 3× finer than the
physics grid; never smooth the nodes themselves. `halfThickness` is its contact radius; `radius`
identifies cables in rendering. Rebuild GPU buffers when topology changes.
Plush sleep tolerates ≤3% chattering corner nodes, or a folded towel stays awake on some platforms.
`bend_memory` sets creases only while released and where both link ends touch something: a set taken
while held or hanging props up arches and fails `compact`. Bending stiffer than `bend_compliance` 15
springs the first fold open. Fabric pressed into the table leaves through its top, never the bottom.

Grips use finite barycentric material patches; a single pinned vertex permits free spinning. Clamp
both actual halves at the doubled open edge. Jaws that lose a patch while closed stay empty until
reopened (`clothSlip`). Grab markers show only during grab states, destinations once both are held.
Bound total force across captured layers. Plush patches may yield in bending under measured moment,
keeping a shared grip centre, sideways twist constraint and reactions. Solve layer contact and table
friction with stretch (late projections leave strain); keep a contact's side across a substep.

The `xx` objective requires a released first-fold checkpoint, both second grasps, overlapping material
quarters, a spread footprint and released settling. Loose fluffy corners are allowed; one fold or a
crushed bundle is not. First fold toward the robot, then return the doubled open edge to the crease.
Waking a resting towel must still permit a real grasp.

## Pouring and controller contracts

In `pour-core.js`, preserve beer conservation and mouth-only collection; solid hits spill.
`CONTAINER`, `flow` and `spill_limit` govern geometry, flow and failure. `grip_zone` restricts the
stein to its handle; `BOTTLE.grip` keeps the bottle mouth clear of the palm. Decorative `visual` pieces have no collision or mass; stream widths follow flow/speed. Foam never changes beer volume. The left arm pours
outward: inward roll hits its forearm limit. Keep `visual` labels ≥1 mm proud to avoid z-fighting.
`connector-fixture.json` is test-only; keep its cable and insertion code.

Firmware belongs in `../nrf-controller`; `decodeImuBatch` matches `src/sysid_wire.h`. Preserve C/JS parity
for TP/1 framing/freshness (`src/teleop_wire.*`, `teleop_policy.*`); USB/ESB uses a separate 1 Mbaud image.
Source clocks survive gateway forwarding/reboot; USB replaces duplicate BLE. Never open a console on
the page's port, start an unseen camera, or fuse IMU outside a live, aligned Filtered track.

Capture USB uses native raw IMU via `capture-core.js`/`app-capture.js`, never TP/VQF or teleop firmware.
Relative orientation needs stationary gyro calibration and per-hand neutral; IMU supplies no translation.
Mute task pulses until gyro bias calibration finishes, or the actuator prevents its own stillness check.
Blur/hidden/dialogs/stale delivery hold rotation and resume on fresh samples in the same estimator epoch;
an epoch change requires recentering. Calibration stays in memory and clears on hand/task/frame changes.
Use PLAY_WAVEFORM with matching ACKs, no retries and fresh INFO/stream activity.
`Control.zero` uses chest `basis`, never jaw orientation: cable-axis roll, transverse pitch, board-up yaw.
`SENSOR_TO_ROBOT`: raw X → pitch (+Y), raw Y → cable-axis roll (-X), raw Z → yaw (+Z).

Task feedback uses six-byte v2 finite TacHammer commands: CLICK for contacts/wrist stops, KNOCK for seating and
BUZZ_50HZ under load. BLE is capped at 10 Hz, USB/ESB at 25 Hz. Coalesce contacts until separation; never replay dropped events.
`TaskHaptics` adapts constant loads toward a faint floor; current force and motion set rumble amplitude,
capped by the selected peak (default/max 75%). Refresh finite 300 ms rumble at 10 Hz; release stops renewal.
No ERM, servo-motion or STOP_ALL writes (STOP_ALL releases a servo). Test pulse uses the selected peak.
Firmware acquires the power rail. Unmapped, simulated, stale (>500 ms), unready or disconnected boards
get nothing; drop busy writes, never queue. Reset on task change, off, blur and hidden pages. ACK means
acceptance, not motion. Keep 100 ms source freshness, 50 ms gateway expiry and 120 ms ACK timeouts.

Voice preserves Tasks unless explicitly switching tabs. Bluetooth PTT follows ACT `keys`, not paused streams.
Keep ordered writes, epoch cancellation, optional audio and `audio_wire.h`/ADPCM. USB/ESB has no mic; computer mic remains available.

Stream drops in-flight messages. UDP accepts localhost/`tsmorz.github.io` unless `--origin` adds one.
Print at true size, rejecting fit-to-page. Setup applies only via Next/Print/phone actions, never dialog close.

## Regression entry points

`teleop.cjs` (5j), `guidance.cjs` (5k), `balance.cjs` (5q), `advanced.cjs` (5l), `controller-link.cjs` (5m),
`pour.cjs` (5n), `voice.cjs` (5p). `capture-browser.js` covers IMU, neutral, hold/resume and haptics.
Use actual IK/contacts in browser tests: open fully, retreat smoothly. Repeat on a phone; state hardware limits.
