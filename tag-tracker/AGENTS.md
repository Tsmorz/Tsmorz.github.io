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
  while iterating, e.g. `task check:tag-tracker -- 5j 5k 5q`. Sections reseed their random numbers. Time with `budget()`, never `check()`.
- Build before browser checks. `task shot -- /tag-tracker/ --eval-file script/tag-tracker/<test>.js`
  fails on page exceptions. Inspect the PNG; repeat with `--phone`. Headless WebGL needs Metal.
- Run `task ci` before finishing. OpenCV detection/calibration tests are optional when the pinned npm
  package isn't installed; the other core tests must run without hardware.

## Look and navigation

Use cool anodised greys, ink, violet accents and Archivo; amber only for warnings. No orange,
rounded cards, pills, monospace labels or shadows. Panels have 1 px outlines and 4 px corners.
Reticle corner marks belong only on video.
Tag colours keep their categorical slot in storage (eight slots, then labelled grey). Label x/y/z.
The robot has one generic look, the Machine; don't restore human avatars, story rooms or rewards.

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
Motion × scales translation from calibrated wrist home, never wrist orientation or chest motion.

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
Every task starts idle arms in the one top-level `ready.joints` pose in `tag_tasks.yml` (degrees); no
task carries its own. It never overrides AprilTag input. Preserve the elbow when the mouse takes a ready
hand. Seed idle joints without a first-frame IK solve, clear idle slew on tab changes, and apply task
camera placement before drawing. Stationary real body/wrist tags auto-calibrate after 0.8 s.
Use `handIK`/`wrist` for task orientation commands: wrist stops never recruit shoulder or elbow motion.
Keep the requested wrist Euler branch unwrapped past stops; otherwise a large turn flips to the opposite stop.

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

No automated tests for the towel simulation: Tony tests it by hand, and a scripted fold is chaotic, so its
outcome flips with last-digit rounding between machines (it failed only on CI). The towel has a fabric core, plush nap, layer contact and a closed shell drawn through `clothSurface`,
a spline 3× finer than the physics grid (never smooth the nodes themselves). `halfThickness` is its
contact radius: `radius` identifies cables in rendering. GPU buffers rebuild when topology changes.
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
stein to its handle; `BOTTLE.grip` keeps the bottle mouth clear of the palm. The left arm pours
outward: inward roll hits its forearm limit. Keep `visual` labels ≥1 mm proud to avoid z-fighting.
The USB fixture (`connector-fixture.json`) is test-only and keeps the cable and insertion code.

Controller firmware belongs in `../nrf-controller`. `decodeImuBatch` matches `src/sysid_wire.h`;
TP/1 framing/freshness (`src/teleop_wire.*`, `teleop_policy.*`) keeps C/JS byte parity. USB/ESB is a
separate 1 Mbaud image. Source clocks survive gateway forwarding and reboot; USB replaces duplicate
BLE links. Never open a serial console on the page's port, start an unseen camera track, or fuse IMU
into anything but a live, aligned Filtered track.

Capture USB uses its native raw IMU via `capture-core.js`/`app-capture.js`, never the TP/VQF
decoder or a teleop firmware flash. Relative orientation requires a stationary gyro calibration
and per-hand neutral pose; IMU never supplies translation. Keep task pulses muted until gyro bias
calibration finishes, or the actuator can prevent its own stillness check. Gaps, resets, blur and
stale data hold the last rotation until recentered. Keep calibration in memory and clear it on hand/task/frame
changes. Capture cues use PLAY_WAVEFORM, matching ACKs, no retries and fresh INFO/stream activity.
`SENSOR_TO_HAND` maps the cable axis to gripper roll, the transverse axis to pitch and board up to yaw;
never apply raw sensor rotations directly in the hand's differently oriented frame.

Task feedback is finite TacHammer CLICK/KNOCK only: six-byte version-2 commands, at the selected drive level (default and maximum 75%), BLE
10 Hz, USB/ESB up to 25 Hz. Force changes pulse timing, not drive percentage. Test pulse uses the
same selected level. No ERM, servo-motion or STOP_ALL writes (STOP_ALL releases a servo). The
firmware acquires the power rail. Unmapped, simulated, stale (>500 ms), unready or disconnected boards
get nothing; drop busy writes, never queue. Reset cues on task change, off, blur and hidden pages. ACK
is acceptance, not motion. Keep 100 ms source freshness, 50 ms gateway expiry, 120 ms ACK timeouts.

Voice uses whole utterances and preserves Tasks unless explicitly changing tabs. Bluetooth controller
push-to-talk follows ACT `keys`, not paused data-event streams. Preserve ordered writes and epoch-
scoped cancellation; grant the optional audio service. USB/ESB has no microphone stream. Keep the
`audio_wire.h`/ADPCM contract with nrf-controller; computer-microphone input remains available.

Stream drops an in-flight message rather than queueing. The UDP bridge accepts only localhost and
`tsmorz.github.io` unless `--origin` adds one. Printing uses true paper size and rejects fit-to-page.
Setup choices apply only through Next/Print/phone actions, never merely by closing the dialog.

## Regression entry points

`teleop.cjs` (5j), `guidance.cjs` (5k), `balance.cjs` (5q), `advanced.cjs` (5l),
`controller-link.cjs` (5m), `pour.cjs` (5n), `voice.cjs` (5p). `capture-browser.js` covers raw IMU,
neutral poses, hold/recenter and simultaneous haptics. Other browser tests run actual IK and contacts:
move hands as a player does (open fully, then retreat smoothly). Repeat responsive checks on a phone.
State what has not run on real hardware.
