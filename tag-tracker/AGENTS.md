# Tag Tracker

## Editing and checking

- Content, task variants, hints and `controls_help` mappings belong in `_data/tag_tasks.yml`, never in markup or JS strings.
- Classic scripts share one global scope. `app-*.js` may declare functions and wire handlers at load, but cannot read or call later files.
  Startup calls belong in the boot script at the end of `index.html`. Keep its script order intact.
- Avoid top-level `window` names (`name`, `status`, `stop`, `print`, `on...`).
- `task versions` also versions dynamic imports; the worker hash includes `tracker-core.js`.
- Keep no-DOM logic in cores. `task check:tag-tracker -- 5j 5k 5q` selects reseeded test sections; time with `budget()`, never `check()`.
- Build before browser checks. `task shot -- /tag-tracker/ --eval-file script/tag-tracker/<test>.js`
  fails on page exceptions. Inspect the PNG; repeat with `--phone`. Headless WebGL needs Metal.

## Look and navigation

Use cool greys, ink, violet and Archivo; amber only for warnings. No orange, rounded cards, pills, monospace or shadows.
Panels have 1 px outlines and 4 px corners; reticle corner marks belong only on video.
Tag colours keep their categorical slot in storage (eight slots, then labelled grey). Label x/y/z.
Keep the cool-silver Machine with black joints/accents, Robotiq 2F-85 grippers, one thin tubular mast and an AMR chassis.
No human avatars, story rooms or rewards. `supportLayout` derives its preview floor from the fresh-task standing height; switching views must not shorten the mast.

Preserve Calibrate → Tracking → Tasks and the scene across tab switches. Tasks alone mounts
`#gameHUD`; Tracking pauses and hides the task table (`tableShown`). No Physics or Forces UI.
`S.tab` selects the page; `S.mode` selects calibration/tracking detection. Keep setup in Settings
with Sound, Haptics, Controller and the keyboard reference on the right rail. Stack haptic strength and movement sensitivity there;
show head tilt only in robot-eye view. Popups close with an accessible ×; do not restore task settings.

## Tracking contracts

- OpenCV.js is pinned to `@techstark/opencv-js@4.12.0-release.1`; Transformers to `4.3.2`, CDN-loaded.
  AprilTags use corner refinement and the half-pixel shift; ChArUco uses DICT_5X5_100 to avoid tag collisions.
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
  Echo each frame's `session` in replies/errors: a device key survives camera restarts but its sequence does not.
  Camera exposure uses 100 µs units; verify readback after advisory constraints before claiming they applied.
- The three-camera Demo is real rendered input to detection. It overrides saved roles: Body 2,
  Left wrist 1, Right wrist 0. Keep its stationary calibration gate and roughly 20 ms frame delay;
  compare against truth at capture time minus that delay. `demoPose` must avoid joint limits.

## Robot, table and input

Keep `MIN_BEND` (straight elbows are singular) and bounded elbow swing. `handIK` stops at feasible shoulder/elbow limits; `slew` cancels outward momentum at hard stops.
`robot.scale` is shared by the Task sensitivity slider and Tracking's Motion × selector. Scale
AprilTag translation from calibrated wrist home and incremental mouse/keyboard travel, never wrist
rotation or chest motion. Changing gain must not rescale an existing mouse target or reset its IK seed.

Mouse targets (`TB.drive`) are world-fixed until Resume AprilTags or recalibration. `grabPlane` and
`holdBack` must keep corrections inside the drag plane; reaching an arm limit must not lift its target
out of that plane. Only the actual gripper is pickable; highlight its palm/rail and fingers, never the arm. Picking, drawing and projection must share the
head camera, including its tilt. Calibrate robot reads un-tared poses.
`dragPlaneGuide` projects the locked `TB.grab.n` at the commanded grasp point with the final camera;
never infer another plane from the pointer or let the guide intercept input.

Keep limited-spring hands and opposite arm/gripper collisions; exclude own side-prefixed links. Rigid grip loads sum joint and pad forces; internal cancellation is not external load.
Match compound rendering/collision dimensions, openings and parallel-axis inertia; never renumber wire `MATERIALS` IDs.
Keep fixed 240 Hz substeps, contact friction, warm starting, sleeping and bounded reactions together.
Deformable contacts share rigid-body effective mass and finite rubber compliance (`patch-contact-core.js`). Friction needs opposing inner-face pressure; toe pressure supplies no adhesive grip.
Freeze `W.deformableResponse` before solving; aggregate surface/pin wrenches about its COM and commit once in the same substep. Never also queue that wrench or reuse consumed `bodyOffsets`.
`contact-vi-core.js` certifies the common pressure/friction state; `contact-prox-core.js` shifts numerical subproblems only and never authorizes forces from inner convergence. The live cloth step never throws on a solver miss: it applies its best (else last) iterate and counts `surfaceStats.unconverged`; `c.strictContact` (tests only) restores the throws. The common cloth solve owns only nodes near a pad (`owns`, `commonReach`) and caps exact candidates per step (`newtonBudget`). Whole-garment rows or an unbounded budget freeze the page for seconds per frame.
Use the operator/column path for ordinary surface normals; dense matrices over a cloth contact manifold exhaust memory on folded layers.
`W.jawActuator` is immutable per fixed step; commit once through `W.applyJawActuator`. Keep committed pad geometry until fresh contacts replace it: zero carrier effort does not mean unloaded rubber. Use `restOffset` even when the actuator saturates.
`gap` is the loaded face gap; `carrierGap` drives metal/linkages, and `padCompression`/`G.padShape` deforms rubber. Share those coordinates with rendering.
`body.padBoxes` covers hand/table/arm contacts and liquid CCD. `padSpheres` is the lazy rigid-prop/SDF path, never hand-hand; bounds must include the boxes.
`W.contactState` is the latest fixed-step load; render-frame averages must not renew sustained haptics after separation.
`W.setFluid` uses shape-frame COM/tensors and signed world-space mass fluxes. Preserve world P/L, shape origin and grip anchors; restore dry properties before refilling on reset.

Every task starts from top-level `ready.joints` in `tag_tasks.yml` (degrees), never a task-local pose.
Restart rebases live tag input through `RB.taskInput`; never mutate Tracking calibration or source poses.
Preserve the elbow on mouse takeover. Seed idle joints without first-frame IK, clear idle slew on tab
changes, and place the task camera before drawing. Stationary real tags auto-calibrate after 0.8 s.
Use `handIK`/`wrist` for task orientation commands: wrist stops never recruit the arm. Preserve `positionPending`/`positionGoal` in `RB.prev` to avoid recovery branch jumps or oscillation.
Keep requested wrist Euler angles unwrapped past stops. Contact reconstruction seeds the commanded elbow with position-only IK costs; wrist limits never recruit the shoulder. `wristStop` identifies stop edges.

## The five tasks

Keep `bowl`, `sort`, `tray`, `pour`, `laundry` freely selectable in order, with one canonical definition each.
`TaskCore.mission` accepts legacy mode arguments but never changes the task. Retired Small/Full settings
normalize to `tasks`; keep old score namespaces separate. Changed objectives need new revisions.
Restart atomically reseeds robot/props/history. `W.initialize` settles rigid supports with task clocks/mechanisms paused.
Cancel pointer capture, clear feedback/`ContactSound.reset()`, and abort the old frame before feedback or contact reconstruction.

Guidance reads actual constraints; never move props or award success. Preserve empty-gripper retreat,
wrong-prop/missing-hand/layer hints and visible destinations/objectives. Start `guidePlan` closed on task placement; repainting must preserve a visitor's choice to expand it.

`balance` monitors ball/rim geometry every physics substep, including before grasping the tray.
A rim hit or lost load invalidates the attempt until restart. Require both a clean elevated two-hand
hold and released set-down. Test actual contacts, not just a ball parked at its final coordinates.

No automated fabric-fold playthroughs: Tony tests folding by hand; scripted folds vary with rounding.
Nonfold drape/drop/stretch/bend/grip checks are fine (`cloth-mechanics.cjs`, `cloth-pickup.cjs`, `cloth-drape-browser.js`). `laundry` uses two sewn `shirt` panels with open neck, cuffs and hem; objectives follow both panels' material landmarks. Pending (`pending()` in `script/test-tag-tracker`, reported but not failing): the jaws don't yet capture/lift the cuff, and rough-layer traction needs more than `newtonBudget`. Turn each back into `check()` once it passes.
Cotton uses areal density in kg/m², membrane moduli in N/m and bending rigidity in N·m. Preserve these across timestep, mesh and solver changes; `bend_memory` belongs to legacy fabric only.
`halfThickness` is contact radius; `pile` is nap. Render helpers follow nodes without mutation; cotton UV/hem stays in material coordinates. Refresh GPU indices even for equal-size topology changes.
Grips use finite barycentric patches inside actual Robotiq pads. `fabricGap`/`fabricForce` couple squeeze and Coulomb limits; return the full force/torque across captured layers. Fabric pressed into the table leaves through its top.
Losing a patch while closed requires reopening (`clothSlip`). Grab markers show at the actual landmarks;
show shoulder destinations once the hem is held. Preserve sleeve/hem/compactness checks so a bundle cannot pass.

## Pouring and controller contracts

In `pour-core.js`, conserve beer and momentum. Entry requires a mouth crossing; deposit occurs at the free surface/floor. Inner-wall runoff stays inside only after valid entry; exterior walls/handles spill.
Source emission runs in `W.preStep` before rigid gravity; parcel transport/receiver capture runs afterward to avoid counting gravity twice. Both phases pause during initialization.
`CONTAINER`, `flow` and `spill_limit` govern geometry, flow and failure. `grip_zone` restricts the
stein to its handle; `BOTTLE.grip` keeps the bottle mouth clear of the palm. Decorative `visual` pieces have no collision or mass; stream widths follow flow/speed. Foam never changes beer volume. The left arm pours
outward: inward roll hits its forearm limit. Labels stay ≥1 mm proud, with no end caps. Bottle artwork comes from `_data/tag_tasks.yml`; lettering uses outlined SVG, never a system font dependency.
Draw transparent meshes after opaque ones with depth writes off, sorted by actual mesh centre. Restore texture units and upload flags after label uploads.
`connector-fixture.json` is test-only; keep its cable and insertion code.

Firmware belongs in `../nrf-controller`; `decodeImuBatch` matches `src/sysid_wire.h`. Preserve C/JS parity
for TP/1 framing/freshness (`src/teleop_wire.*`, `teleop_policy.*`); USB/ESB uses a separate 1 Mbaud image.
Source clocks survive gateway forwarding/reboot; USB replaces duplicate BLE. Never open a console on
the page's port, start an unseen camera, or fuse IMU outside a live, aligned Filtered track.

Capture USB uses native raw IMU (`capture-core.js`/`app-capture.js`), never TP/VQF or teleop firmware; IMU supplies no translation.
Stationary gyro calibration and per-hand neutral stay in memory and clear on hand/frame changes. Mute pulses during bias calibration or they prevent stillness.
Blur/hidden/dialogs/stale delivery hold rotation until fresh samples in the same epoch; an epoch change requires recentering.
Tasks/restarts call `rebaseCaptureOrientations`: hold ready while `Control.retarget` awaits fresh samples in the same epoch. Views preserve neutral; never bypass a stream reset.
Use PLAY_WAVEFORM with matching ACKs, no retries and fresh INFO/stream activity.
Set neutral restores the `robotReady()` hand rotation, preserves position/opening and clears wrist unwrap history. `Control.zero` uses chest `basis`, never jaw orientation: cable-axis roll, transverse pitch, board-up yaw.
`SENSOR_TO_ROBOT`: raw X → pitch (+Y), raw Y → cable-axis roll (-X), raw Z → yaw (+Z).

Task feedback uses six-byte v2 finite TacHammer commands: CLICK for contacts/wrist stops, KNOCK for seating and
BUZZ_50HZ under load. BLE is capped at 10 Hz, USB/ESB at 25 Hz. Coalesce contacts until separation; never replay dropped events.
Scale physical clicks from fixed-substep `event.force`, never render-frame averages or speed alone; retain discrete wrist-stop/detent cues.
`TaskHaptics` adapts constant loads toward a faint floor; current force/motion set amplitude, capped at the selected peak (default/max 75%).
Release cancels capture rumble with TacHammer-only STOP; legacy links preempt with a 1%/6 ms CLICK. `hasRumble` retains cancellation across resets; the inactive UI pump obeys link cadence/freshness and finite expiry.
No ERM, servo-motion or STOP_ALL writes (STOP_ALL releases a servo). Test pulse uses the selected peak.
Firmware acquires the power rail. Unmapped, simulated, stale (>500 ms), unready or disconnected boards
get nothing; drop busy writes, never queue. Reset on task change, off, blur and hidden pages. ACK means
acceptance, not motion. Keep 100 ms source freshness, 50 ms gateway expiry and 120 ms ACK timeouts.

Voice preserves Tasks unless switching tabs. PTT follows ACT `keys`, not paused streams. Preserve ordered writes, epoch cancellation, optional `audio_wire.h`/ADPCM; USB/ESB uses the computer mic.

Stream drops in-flight messages. UDP accepts localhost/`tsmorz.github.io` unless `--origin` adds one.
Print at true size, rejecting fit-to-page. Setup applies via Next/Print/phone actions, never dialog close.

## Regression entry points

`teleop.cjs` (5j), `guidance.cjs` (5k), `balance.cjs` (5q), `advanced.cjs` (5l), `controller-link.cjs` (5m), `pour.cjs` (5n), `voice.cjs` (5p). Capture/restart checks cover IMU, neutral, live input and quiet reset; `robot-standing-browser.js` checks preview/task floor equality.
Use actual IK/contacts in browser tests: open fully, retreat smoothly. Repeat on a phone; state hardware limits.
