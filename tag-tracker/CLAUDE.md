# The tag tracker (`/tag-tracker/`)

A self-contained tool page (no front matter, so Jekyll copies it as-is). It tracks AprilTags from one or more webcams (or a
built-in three-camera Demo) in Chrome/Edge, fuses them into poses, and drives a simulated humanoid robot and a tabletop physics
scene from them. Tags, settings and calibrations live in `localStorage`.

## Files

| File | What it is |
| --- | --- |
| `index.html` | the UI and page logic |
| `tracker-core.js` | `TagCore`, no DOM: poses, frames, intrinsics, history, orbit camera, SE(3) refinement, rigid objects, `PoseFilter`, search windows, Stream/recording formats, voice parsing, IMU bytes and lining up |
| `worker.js` | OpenCV side in a Web Worker (detection, solvePnP, ChArUco calibration); its `TagVision` factory also runs in Node |
| `robot-core.js` | `RobotCore`, no DOM: the humanoid, IK, calibration, joint slew, demo path |
| `robot-gl.js` | `RobotGL`: the shaded robot; `meshes()` has no DOM |
| `physics-core.js` | `PhysicsCore`, no DOM: the table, props, hands, grip, contact record, haptic events |
| `sound.js` | `ContactSound`: Web Audio contact sounds |
| `speech-worker.js` | speech to text (Whisper tiny.en through Transformers.js) |
| `udp-bridge.py` | WebSocket → UDP bridge for Stream (Python standard library, served for download) |
| `lib/qrcode-generator/` | 1.4.4, MIT, vendored unchanged |

`script/test-tag-tracker` (`task check:tag-tracker`, in `check:fast`) covers all the no-DOM cores: refinement (covariance vs Monte
Carlo, mirror poses), the filter vs a textbook Kalman filter, the joint fit, search windows, Stream/recording formats, voice, the
robot (section 5h), the table and its record and sounds (section 5i), the UDP bridge (with python3) and the motion sensors. With
OpenCV.js installed (`npm i --no-save @techstark/opencv-js@4.12.0-release.1`) it also checks detection and calibration on
rendered pictures, and the screen board (section 6b).

## Rules

- **Bump the `?v=<date>` script version** in index.html (it also reaches the worker and `tracker-core.js`) whenever any script
  changes. A cached old `robot-core.js` beside a new page once froze the 3D view.
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

Two tabs, Track and Calibrate, the camera column the same width on both. `S.tab` is the tab shown; `S.mode` is what the detector
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
never makes it jump. **Calibrate robot** (C, `RobotCore.calibrate`) is a tare to the start pose (`HOME`), read from plotted poses
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
hand. `TB.drive` keeps a dragged hand's target in the world until Tags drive or Calibrate robot. Into the table its target goes at
most `PhysicsCore.PRESS` past contact (`holdBack`). The grabbable gripper lights up (`hoverNow`, `hot` in robot-gl.js, `GRAB_PX`).

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
- **Voice** (V): `TagCore.VoiceGate` ends the clip; `speech-worker.js` transcribes on the computer; whole-utterance commands
  (`voiceCommand`, `VOICE_COMMANDS`, `VOICE_ACTIONS`), else a note (`tidySpeech`, `insertSpeech`).
- **Tare** (`TagCore.tared`, `S.tare`, `retare`): plotted orientations only; the video overlay always shows true poses.
- **Print** dialog: tags and the ChArUco board at true size on A4 or Letter (`TagCore.PAPER`, `paperFor`, `paper`); it refuses
  sizes that wouldn't fit (`maxTagSize`, `maxBoardSquare`), since fit-to-page would shrink them.
- **`#board`** fills a screen with the ChArUco board (`TagCore.boardFit`, drawn by the worker's `boardImage`); **`#tags=2:Body,...`**
  (`&f=` for another family) shows tags one at a time on a phone (`TagCore.tagFit`). Share panels: `fillShare`, `#shareDlg`;
  `onPhone()` opens them in place.
- **Setup guide** (`#setupDlg`, `settings.setup`): its choices are applied by Next, Print or the phone link, never by closing.
