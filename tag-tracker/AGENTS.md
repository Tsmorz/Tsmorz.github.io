# The tag tracker (`/tag-tracker/`)

A self-contained tool page (`layout: null` front matter, only to render `_data/tag_tasks.yml`; no site layout). It tracks
AprilTags from one or more webcams (or a built-in three-camera Demo) in Chrome/Edge, fuses them into poses, and drives a
simulated humanoid robot and a tabletop physics scene from them. Tags, settings and calibrations live in `localStorage`.

## Files

| File | What it is |
| --- | --- |
| `index.html` | the markup, then the scripts in order, then the boot script (the only code that runs others at load) |
| `app-*.js` | the page's logic, in load order: `state` (S, settings, tags, tare, status), `cameras` (workers, cameras, tiles, search windows, frame loop, results, overlays, rigid objects), `plot` (3D), `robot` (robot and table), `tasks` (the robot task UI), `views` (full screen, time plot, readout, render loop, modes), `calibrate` (steps 1–4), `share` (printing, board and tags on a screen), `io` (Stream, recording, voice), `boards` (motion sensors), `demo` (demo and setup guide) |
| `tracker-core.js` | `TagCore`, no DOM: poses, frames, intrinsics, history, orbit camera, SE(3) refinement, rigid objects, `PoseFilter`, search windows, Stream/recording formats, voice parsing, IMU bytes and lining up |
| `worker.js` | OpenCV side in a Web Worker (detection, solvePnP, ChArUco calibration); its `TagVision` factory also runs in Node |
| `robot-core.js` | `RobotCore`, no DOM: the humanoid, IK, calibration, joint slew, demo path |
| `robot-gl.js` | `RobotGL`: the shaded robot; `meshes()` has no DOM |
| `physics-core.js` | `PhysicsCore`, no DOM: the table, props, hands, grip, contact record, haptic events |
| `cloth-core.js` | small-step XPBD fabric, cut-pattern shirt and gripper reactions, no DOM |
| `cable-core.js` | elastic cable, endpoint reactions, continuous USB-C sleeve contacts and spring detent, no DOM |
| `haptic-core.js` | finite TacHammer cue mapping and BLE write dispatcher, no DOM |
| `task-core.js` | `TaskCore`, no DOM: the robot workbench's scenes, physical objectives, progress, `guidance`, the head camera |
| `sound.js` | `ContactSound`: Web Audio contact sounds |
| `speech-worker.js` | speech to text (Whisper tiny.en through Transformers.js) |
| `voice-core.js` | `ControllerVoice`, no DOM: nrf-controller audio packets, IMA ADPCM and bounded 16 kHz takes |
| `udp-bridge.py` | WebSocket → UDP bridge for Stream (Python standard library, served for download) |
| `lib/qrcode-generator/` | 1.4.4, MIT, vendored unchanged |

`script/test-tag-tracker` (`task check:tag-tracker`, in `check:fast`) covers all the no-DOM cores: refinement (covariance vs Monte
Carlo, mirror poses), the filter vs a textbook Kalman filter, the joint fit, search windows, Stream/recording formats, voice, the
robot (section 5h), the table and its record and sounds (section 5i), the UDP bridge (with python3) and the motion sensors. With
OpenCV.js installed (`npm i --no-save @techstark/opencv-js@4.12.0-release.1`) it also checks detection and calibration on
rendered pictures, and the screen board (section 6b). **Run only what you touched while iterating**:
`task check:tag-tracker -- 5i` (or `5h 5i`; `5` is only section 5). Each section reseeds its random numbers, so it draws the
same ones alone as in the full run.

## Rules

- **The `app-*.js` files are classic scripts sharing one global scope** (`'use strict'` each, no modules, no wrapper).
  At load, a file may only declare things and wire handlers; it must not call or read anything from a later file (it
  isn't defined yet). Startup calls go in the boot script at the end of index.html. New code goes in the file for its
  area; a new file goes in index.html's list in order, then `task versions`. Check a change with
  `task shot -- /tag-tracker/ --click '#emptyDemo' --wait 8000` (fails on any exception).
- Don't name a top-level function or variable after a `window` property (`name`, `status`, `stop`, `print`, `on...`):
  they're globals now.
- **Run `task versions` after changing any script.** Each `?v=` is a hash of its file (`worker.js`'s also covers
  `tracker-core.js`, which it loads with the same `?v=`); `check:versions` fails on a stale one. A cached old script beside a
  new page once froze the 3D view.
- **Pinned, not vendored:** OpenCV.js `@techstark/opencv-js@4.12.0-release.1` and `@huggingface/transformers@4.3.2`, each from
  jsDelivr then unpkg. Keep exact versions.
- **Poses are always the camera's own.** Mirror, Flip and Blur change only the picture (CSS transform/filter, `TagCore.displayMap`
  for the overlay). Detection, fusion, plots, tables, Stream, recordings and the robot never mirror (`shown()`); Stream and
  recordings always say `view: 'in person'`. `TagCore.mirrorPose` stays, tested, unused.
- **Lens calibrations are keyed by the device's own label**, never the user's camera name (`camNames`), so renaming never loses one.
- **`decodeImuBatch` is a copy of nrf-controller's `src/sysid_wire.h` IMU batch**: keep the two in step. The haptics BLE stream
  and its firmware belong in nrf-controller, not here.
- **The demo ignores the saved robot roles** (`robotSet`): tag 2 is its chest and the hand cubes its arms. The setup guide's
  default IDs (Body 2, Left wrist 1, Right wrist 0) match it.
- **Calibrations, tares and the robot calibration are in memory only** (`S.tare`, the robot's `cal`); don't persist them.
- **The UDP bridge refuses origins other than tsmorz.github.io and localhost** unless `--origin` adds one. Keep that.
- A message to Stream that finds the last still being written is dropped and counted, never queued.
- What hasn't been run on real hardware yet: the servo grip (only encoded bytes), the motion sensors with real boards.

## Look

An instrument on a vision bench: cool anodised greys and ink, the site's violet (`--accent`, as in main.css) for what is live or
pressed, amber only for warnings (never an orange accent on the dark greys). Panels are plain outlined boxes (1 px rule, 4 px
corners, no shadows); viewfinder corner marks only on the video (`.reticle`); flat ink-outlined keys that invert when chosen;
one typeface, Archivo, wide for the name and titles. **No rounded cards, pills, middle-dot strings or monospace labels.**
Tag colours take the eight validated categorical slots in a fixed order and keep their slot (`slot`); a ninth is grey; the demo
cubes' side and top tags have `-1`. x/y/z are `--x/--y/--z`, always labelled. The page icon is the real tag36h11 #0.

The robot has one look, **the Machine** (Pearl, Companion and Hologram were taken out; a saved `look` is dropped). Keep it
generic: like no company's robot. Without WebGL it is drawn flat (`drawRobotFlat`).

## Layout

Three tabs, Calibrate → Tracking → Tasks, always in the shared header. Tracking and Calibrate share the camera column.
Tasks alone mounts `#gameHUD`; switching tabs must preserve the physical scene and active task. `S.tab` is the tab shown; `S.mode` is what the detector
looks for (`calib` or `track`). **Settings** (`#settingsDlg`, the gear) holds what is set once: robot roles and lengths, detector
and pose options, Tags-view options, default paper, the setup-guide switch. The top bar's status shows only while there is
something to say (`status('')` hides it). On a wide screen the right column (3D plot, then the **Now** panel) is sticky and fills
the window. Now's tabs, in order: Orientation, Position, Velocity (a saved `motion` reads as it), Joint angles (while the robot
has an arm), Forces (while a hand is on the table); `tplotSeries` gives each its lines.

The 3D view starts, and Reset view (R) returns, at camera 1's position (`resetView`, `cameraInPlot`), else `view0()`.

## Detection

- **A pool of workers** (`S.pool`, `POOL`); each camera's frames go to an idle worker (`idleWorker`), results overtaken by a later
  frame are dropped (`doneSeq`). The first worker also calibrates and draws tags and boards. Frames go as `VideoFrame`s (`HAS_VF`)
  and the worker reads only the luma it needs (`grey`, `greyRect`); windows start and end on even pixels (chroma).
- **Search windows** (`searchPlan`, `TagCore.planSearch`): search only where each tag should be next; a full search every
  `FULL_EVERY` frames and after a predicted tag is missed (`expect`, `forceFull`).
- Tags use OpenCV's ArUco detector with an AprilTag dictionary and AprilTag corner refinement, shifted half a pixel to OpenCV's
  pixel-centre convention; the board uses DICT_5X5_100 so it never clashes with tag IDs.
- **Pose modes** (`MOTION` holds the tunings): **Raw** is IPPE; **Refined** is `TagCore.refinePose` (LM on SE(3), left
  perturbations) from the pose and its mirror (`flipPose`), keeping both as candidates; **Filtered** adds `PoseFilter`, an
  error-state Kalman filter (constant velocity) that picks the candidate nearest its prediction and gates outliers.
- **Rigid objects** (`bodies`): "Learn shape" averages each tag's pose relative to the first (`meanPose`); then `solveBody` fits one
  SE(3) pose to every visible corner. Tags in an object are tracked only as it, except while learning (`learn`).

## Several cameras

`S.cams`; camera 1 is the frame of everything. **Placing the cameras** is Calibrate step 4: board poses seen by two or more
cameras become rig views; `TagCore.calibrateRig` chains first poses from camera 1, then bundle-adjusts. Saved by camera key
(`rig`); `placeCameras` re-expresses it from whichever camera is first. Measurements go into the rig frame (`toRig`).

**Fusion uses corners, not each camera's pose** (tightly coupled): `TagCore.sighting` per camera; Refined uses `refineJoint` (LM on
one pose against every sighting, moved to the newest frame's time by `trackVelocity`, since webcams aren't synchronised);
Filtered uses `PoseFilter.updateCorners` (iterated update, late frames moved back by the state's velocity). Each sighting's noise
includes a model error (`c.modelPx`, at least `MODEL_PX`), or the filter chases rig-calibration disagreements. `TagCore.chooseCand`
picks between mirror poses by agreement with other cameras, else nearness to the last pose. An unplaced camera only draws its own
view. Tile arrangement: `arrangement()`, `layoutTiles()`, `TagCore.arrangeTiles`; dragging makes it Custom (`arrange`).

## The demo

Three cameras round one scene (`DEMO`), rendered with WebGL from each camera's exact pose and lens (`demoRenderer`), so detection,
fusion and placing run on real pictures. A body tag (#2, tipped back) and two hand cubes (`CUBE`, `DEMO_HANDS`, `cubeMembers`)
moved along `RobotCore.demoPose`; in Calibrate, the board in 12 poses (`demoBoard`). Demo frames reach the page ~20 ms after they
are drawn: compare a pose against the scene at frame time minus 20 ms. `demoPose` must stay clear of singularities and joint
limits and keep each hand facing camera 1 (the only one measuring before placing). The demo calibrates the robot only at rest
(`demoAtHome`, `DEMO_CYCLE`). Headless Chrome needs `--use-angle=metal` to run it at speed. Simulated IMU boards: `SIM_BOARDS`,
`startSimBoards`.

## The robot (`robot-core.js`)

A humanoid with two 7-joint arms; the chest follows the Body track and each wrist the track on its side. Roles: Settings → Robot
(Auto picks Body/Chest/Torso by name). `RobotCore.ik` is analytic (elbow on a circle about the shoulder–wrist line, swivel angles
scored by `PREFER`); following a previous solution it moves the elbow at most `swing` per frame, so a straight arm or a limit
never makes it jump. **The elbow never goes quite straight** (`MIN_BEND`; reach is `reachOf(m)`): a straight arm is singular, and
one let go straight came back with its elbow anywhere. **Calibrate robot** (C, `RobotCore.calibrate`) is a tare to the start pose (`HOME`), read from plotted poses
with the tare taken off; cleared by a frame change, a new camera 1 or a new track. **Motion ×** (`settings.robot.scale`) scales each
wrist's move from its home position, never orientation or the chest. Joint speed limits: `RobotCore.slew`, `SLEW`.

## The table (`physics-core.js`)

A small rigid-body engine for one scene: a table, a ball and a mug (`settings.robot.props`), placed by `placeTable`, then fixed in
the world. Sequential impulses at 240 Hz, Coulomb friction, restitution (`BOUNCE`), rolling and spin resistance (`crr`, `SPIN_R`),
warm starting, split impulses, sleeping together. The mug has an exact distance function (`cupSdf`). **The hands are bodies**
(`HAND`) pulled by a limited spring toward the arm's target, so the table stops them; the page draws the arm by IK to where each
hand is (`tableStep`). Grippers are rigid against each other and the other arm's links (never their own; a link's `id` starts with
its arm's side).

**The grip** (`GRIP`, `joint`, `solveJoint`, `takeGrip`) is a joint solved with the contacts that holds only what friction and the
pad patch allow, so a light grip lets the mug swing. `W_MAX` is a guard the tests check is never reached (an old grip spun the
mug up). How open a gripper is (`gripOf`): the mouse, else the nrf-controller board's feedback servo (`TagCore.ACT`,
`gripOpening`, with Set open / Set closed in `boards`), else open.

**Mouse drag**: `grabPlane` (the robot plane the view faces most squarely; Alt for the next), through the target, never the physics
hand. `TB.drive` keeps a dragged hand's target in the world until Tags drive or Calibrate robot. Into the table, floor, other arm
or other gripper its target goes at most `PhysicsCore.PRESS` past contact (`holdBack`), and **that shift stays in the drag plane**
(`plane`), or a tilted push slides the grippers past each other. Past the arm's reach the target is kept on its edge in the drag
plane (`RobotCore.inReach`), or the IK lifts the hand. The grabbable gripper lights up (`hoverNow`, `hot` in robot-gl.js, within
`GRAB_PX`): only the gripper, no disc round it.

**The contact record** (`W.record`; its shape is in the comment above `W.step`): pair forces, slip, rolling, impacts, each hand's
wrench. A grip's load is the joint and the pads together (they cancel inside the grip). Materials (`MATERIALS`) have ids that go
over the air: **never change them**. Read by force arrows (`forceArrows`, `o.forces`), sound (`sound.js`: impacts by `hitVoice`,
`loudness`, `brightness`; sliding and rolling by `loopVoices`; stereo `panOf`; quiet under `duckSound`; `render()` offline) and
`PhysicsCore.haptics(record, side)`.

## Inputs and outputs

- **Stream** (`TagCore.streamMessage`, JSON lines or CSV under `STREAM_CSV_HEADER`): Serial via Web Serial, UDP via `udp-bridge.py`
  (127.0.0.1:8770). Settings in `stream`.
- **Motion sensors** (`S.boards`): nrf-controller boards over Web Bluetooth (`TagCore.IMU`, `decodeBoardInfo`, `decodeImuBatch`).
  Characteristics need an authenticated link. `TagCore.BoardClock` maps board time; `TagCore.lineUp` learns M (object → IMU, kept
  in `boards`) and W (world → rig, found per connection, `pairUp`) from camera poses (`noteCamPose`, never the filter's). Fused in
  Filtered mode only (`boardFuse`: `updateRate`, `updateTilt`); a board never starts a track or keeps one alive past `imuFor`.
- **Recording** (`recTick`, in memory, capped): CSV or JSON (`tag-tracker-recording/1`); notes with `TagCore.fmtStamp` /
  `parseNotes`.
- **Voice** (V): `speech-worker.js` transcribes locally; whole-utterance commands (`voiceCommand`, `VOICE_ACTIONS`), else a note.
  BLE audio follows nrf-controller's `src/audio_wire.h` and `src/adpcm.c`; `voice.cjs` (section 5p) checks that contract.
  Joystick push-to-talk uses actuator status `keys`, **not data events**, which firmware pauses during audio. Keep start/stop
  writes ordered and cancellation scoped to the take's epoch and controller; `voice-browser.js` exercises those races.
  The Bluetooth chooser must grant the optional audio service. USB/ESB teleoperation firmware has no microphone stream;
  computer-microphone input remains available. Commands must preserve Tasks unless they explicitly select another tab.
- **Tare** (`TagCore.tared`, `S.tare`, `retare`): plotted orientations only; the video overlay always shows true poses.
- **Print** dialog: tags and the ChArUco board at true size on A4 or Letter (`TagCore.PAPER`, `paperFor`, `paper`); it refuses
  sizes that wouldn't fit (`maxTagSize`, `maxBoardSquare`), since fit-to-page would shrink them.
- **`#board`** fills a screen with the ChArUco board (`TagCore.boardFit`, drawn by the worker's `boardImage`); **`#tags=2:Body,...`**
  (`&f=` for another family) shows tags one at a time on a phone (`TagCore.tagFit`). Share panels: `fillShare`, `#shareDlg`;
  `onPhone()` opens them in place.
- **Setup guide** (`#setupDlg`, `settings.setup`): its choices are applied by Next, Print or the phone link, never by closing.

## Robot tasks

Keep task content, variants, instructions and hints in `_data/tag_tasks.yml`; no story rooms, avatars or
progression locks. `TaskCore.mission(level, 'guided')` applies overrides without mutating the full challenge.
Results use `tag-tracker-guided` and `tag-tracker-teleop`; legacy human/door settings migrate to the robot.

`TaskCore.guidance` is DOM-free and must read actual grip constraints and objective state: it never moves
props or awards completion. Keep the empty-gripper retreat after release; otherwise the next pick can knock
a placed prop out of its outline. The one-gripper two-block task must place A, release, lift clear, then place B
with the same gripper. Wrong props, missing tray grips and missing fabric grips need explicit guidance.

Keep active guidance, objectives and destinations visible. Task settings holds setup and device options,
not a manual hand command bar. Camera & AprilTags opens Tracking and the setup guide.
AprilTags remain the default input. Drag either gripper with the mouse, scroll on it to close/open, Space toggles
it, Shift-scroll tilts and Alt-drag changes the movement plane. Q/E lift/lower the selected gripper. In Robot eyes,
↑/↓ lift/lower and ←/→ move sideways; head tilt stays on the slider. I/P tilts the wrist sideways for sleeve
folds. 1/2/3 select left/right/both grippers. Stationary body/wrist tags auto-calibrate after 0.8 s in the start pose.

Projection and hand picking must share the robot head camera. Compound collision boxes
and cylinders share dimensions with rendering; openings stay hollow. Mass properties use analytic piece inertia
and the parallel-axis theorem (seam overlaps are an approximation). `cloth-core.js` uses a cut-pattern, single-layer
shirt mesh; do not fill the neckline or bridge missing sleeve cells. Finite 8 mm gripper patches use three barycentric
material points solved together: a single pinned vertex permits free spinning. Keep bounded attachment forces,
reaction torque, vertex/face layer contact and Coulomb friction together. Solve layer contact with stretch
constraints; a late contact projection can leave artificial strain and prevent settling.
`shirtFolded` must require both sleeves, aligned hem/shoulders, a non-crumpled footprint, release and settling.
The laundry task is revision 2; old towel times must not compete with shirt results. This is a fabric-sheet
approximation, not a sewn volumetric garment or garment FEM. Props must be released and settled for 0.75 s; handoff, two-gripper lifts and folding have additional checks.

`task check:tag-tracker -- 5j 5k` covers physical manipulation and guidance (`script/tag-tracker/teleop.cjs` and
`guidance.cjs`), including an actual sequential A/B placement with one gripper and the empty-gripper retreat.
After building, `task shot -- /tag-tracker/ --eval-file script/tag-tracker/guided-browser.js` performs the same
exercise through IK and motor slew, checks live hints, mode changes, all task views and the head camera.
`browser.js` covers the full challenges. `workbench-browser.js` checks persistent tabs, task preservation and eye-view
arrow controls. Repeat browser checks with `--phone`.


### Cable insertion and tactile output

The USB-C task starts the plug on a narrow cradle so the robot's bulky fingers can pinch its housing without
hitting the table. The right gripper takes the plug; the left can lift cable slack. The cable is a 33-node XPBD
elastic rod with stretch, compliant bending, gravity, table friction, self-contact and rigid-body collision.
Its endpoint reactions act back on the plug and optional cable-pinching hand. Cloth pin reactions similarly
act back on the hands. These impulses are consumed before the next rigid contact solve, so a supported
load does not leave a false final velocity. They reset with the scene.

The metal plug is a hollow shell. The fixed socket has real walls and a centre tongue. A clipped shell-edge
manifold covers the sleeve continuously between the general engine's surface samples, with 0.05 mm slop
and 24 solver iterations for precision bodies. Axial friction and a damped spring detent are force laws;
no pose snapping or locking is used. Release and settle remain required. Geometry and forces are
representative approximations, not USB compliance or measured connector calibration. Cable torsion,
individual conductors and electrical contacts are not modelled. Shift + movement keys gives 0.2 mm
steps; Shift + wrist keys gives fine turns. AprilTag translation supports Motion × 0.1.

`haptic-core.js` uses the existing nrf-controller actuator characteristic (`TagCore.ACT.status`, read/notify/write),
matching `src/dashboard_wire.h`: six bytes `version=2, command=2, waveform=1 or 3, level, value_le16=0`.
Firmware acquires its power rail on play; readiness does not require the rail already on. Only finite TacHammer CLICK (6 ms) and KNOCK (12 ms including brake) are sent, capped at 45 percent and
10 writes/s or less. Contact impacts, slip, fabric tension, cable tension and the seating edge drive the cues.
**No ERM, servo or STOP_ALL writes**: STOP_ALL would also release the gripper servo. This is tactile vibration,
not calibrated force feedback. Each write self-terminates in firmware; no sustained-output stop command is needed.

Boards route automatically from live wrist-tag assignments, or explicitly to Left/Right/Off for mouse practice.
Unmapped, simulated, disconnected, unready or stale-status (>500 ms) boards get no output. A busy GATT
characteristic drops new cues, never queues old commands. Task changes, off, blur and hidden pages reset cues.
Settings expose enable/strength and connection/acknowledgement status. Acknowledgement means GATT write
success, not proof that an actuator moved. Real controller feel and physical material calibration remain unverified.

`task check:tag-tracker -- 5l` (`script/tag-tracker/advanced.cjs`) performs real grasp/lift/insert/release, checks
cable tension and stretch, and checks TacHammer packets,
routing, capability/stale/off guards and in-flight writes with mocked GATT. `advanced-browser.js` repeats USB
insertion through actual robot IK/motor slew and the rendered page; it never moves a prop directly. `task check:tag-tracker -- 5o` (`fabric.cjs`) checks patch twist/release, surface contacts and the full shirt fold.
`fabric-browser.js` folds both sleeves and the body through actual robot IK and checks released completion; repeat with `--phone`.


## Local leaderboards, charging and serial/ESB controllers

`score-core.js` must separate task revisions and small/full mode. Use monotonic real elapsed time,
including dropped rendering time, rather than the physics accumulator's capped step count.
Never attribute old unnamed personal bests to a player; fixed-socket times cannot compete with the phone task.

`charging-core.js` adds the household cable task: a two-pin wall charger must seat and be released,
then one gripper holds a raised Samsung Galaxy-style phone while the other inserts USB-C. The cable
plug must be released while the phone remains held and both connections stay seated. At least 0.1 s
of simultaneous opposing grips during insertion is required; a pre-connected or table-supported
phone cannot pass. The phone's hollow socket is a frame on its free rigid body. Sleeve contacts and
equal-and-opposite insertion reactions affect both hands; no phone or connector is snapped/locked.
A simpler fixed-socket exercise remains `connector`. Content and hints stay in `_data/tag_tasks.yml`.
The wall fixture represents a simulated outlet, not electrical circuit physics.

The household cable has 65 nodes, stretch, vector-curvature XPBD bending, table/prop/self contact,
friction and two moving rigid endpoints. Its flexural stiffness is a representative model parameter,
not a calibrated cable measurement. Rendering uses a parallel-transport tube frame, smooth centreline
interpolation and tapered strain relief. Deformable GPU buffers rebuild when topology changes (e.g.
65-node charging cable → 33-node practice cable; rectangular cloth → cut-pattern shirt). Small cylinder samples
must use radius no larger than their actual cylinder radius, including 2 mm charger pins.

`controller-link.js` implements bounded COBS + CRC TP/1 frames; `app-serial.js` attaches Web Serial or a
XIAO ESB receiver to the existing board rows, source-clock fit, camera alignment, Filtered pose inputs,
gripper feedback and TacHammer dispatcher. Firmware belongs in `../nrf-controller/teleop/`, with pure
wire/freshness policies in `src/teleop_wire.*` and `teleop_policy.*`, documented in `docs/teleop.md`.
Connect USB / ESB uses 1 Mbaud by default. Multiple wireless controllers are addressed independently.
Selecting USB for an existing board replaces its BLE connection. Never open a serial console on the
same port while the page owns it. Normal BLE firmware has no TP/1 input and must be replaced with
the separate teleop build for this route. The regular BLE firmware stays unchanged.

The controller targets 416 Hz VQF samples and ESB 2 Mbit/s. The gateway holds only the latest command
per pipe and flushes it after ACK/50 ms expiry; source boards refuse commands whose echoed ACT stamp
is over 100 ms old. Feedback writes have finite waveforms and no backlog, with 120 ms ACK timeouts.
Serial/ESB supports changing cues up to 25 Hz (BLE stays at 10 Hz), capped at 45% TacHammer only.
Transient serial failures back off and retry; disconnect and stale readiness suppress output.
Board rows show measured source rate, command RTT and reported accepted-command → I2S-start delay.
Those metrics are not interchangeable: an ACK alone does not prove motion. Actual radio latency,
SAMD11 throughput and actuator feel have not been hardware-verified; only builds and mocked I/O pass.

`task check:tag-tracker -- 5m 5n` covers ranking, real-time clocks, stream fragmentation/corruption,
C/JS wire parity, ACK/timeout/disconnect, and a genuine two-gripper charger/phone completion. After
building, `serial-browser.js` verifies the actual USB adapter with fake streams and real table contact;
`charging-browser.js` completes the full sequence through robot IK and checks the saved ranking.
`guided-browser.js` still checks sequential two-block manipulation; repeat with `--phone`.
