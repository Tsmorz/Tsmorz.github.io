# The tag tracker (`/tag-tracker/`)

`tag-tracker/` is a self-contained tool page (no front matter, so Jekyll copies it as-is) with its own look: an instrument on a
vision bench. Cool anodised greys and ink with the site's violet (`--accent`, as in main.css) for what is live or pressed, and amber
only for warnings (never an orange accent on the dark greys: it reads as a certain adult site's branding); panels are plain outlined boxes
(1 px rule, 4 px corners, no shadows); viewfinder corner marks only on the video (`.reticle`, violet while detecting); flat ink-outlined
keys that invert when chosen; one typeface, Archivo, its width axis wide for the name and titles. Keep it that way: no rounded
cards, pills, middle-dot strings or monospace labels.
It tracks AprilTags from one or more webcams (or a built-in three-camera Demo) in Chrome/Edge: the visitor names each tag ID and enters its
printed size, calibrates the camera with a printed ChArUco board, and sees in 3D either a **robot** the tags drive (below) or
the last `History` seconds of each tag (Show: Robot | Tags on the Tracking card; axes drawn every `Axes every` seconds,
defaults 1 s and 0.1 s), relative to the camera or to a chosen tag, plus an x/y/z plot and a readout table. Tags, settings and calibrations (keyed by camera label) live in `localStorage`.
**Mirror**, **Flip** and **Blur** on the Cameras card are the picture's only (kept in `settings.mirror` / `flip` / `blur`).
Blur is a CSS filter on the on-screen video (about 2.6% of the view's width, at least 10 px: enough to hide faces when working
in public); detection reads the sharp frames and the overlay's outlines stay sharp. For Mirror and Flip the video
turns with a CSS transform and the overlay with `TagCore.displayMap`, its labels kept readable. Flip is half a turn, for a
camera mounted upside down (both axes reversed, so `displayMap` gets mirror XOR flip). Detection, fusion, every plotted,
tabled, streamed and recorded pose and the robot are always the camera's own (`shown()` never mirrors; `TagCore.mirrorPose`
stays in the core, tested, unused by the page, and Stream and recordings always say `view: 'in person'`). The 3D view starts,
and Reset view (key R) goes back, **at camera 1's position** looking at what is plotted (`resetView`, from `cameraInPlot`;
the first fit does it once, `S.view.fromCam`); camera 1's own pyramid and the origin axes aren't drawn while the eye is on
them. Where camera 1's place isn't known (relative to a tag before it is seen) it falls back to `view0()`, from behind.
Two tabs, Track and Calibrate, with the camera column the same width on both. **Settings** (what is set once: the robot's
roles and lengths, the detector and pose options, the Tags view's History / Axes every / Axis length, the default paper, and
the setup guide switch) is a panel that slides in from the right (`#settingsDlg`, a modal `<dialog>`), opened by the gear
beside the theme toggle (or saying "settings"). The **Stream** card sits at the bottom of Track's left column. `S.tab` is the
tab shown; `S.mode` is what the detector looks for (`calib`: the board; `track`: tags). The top bar's status shows only while
there is something to say (loading the detector, an error, the frame rate while detecting): `status('')` hides it, so there is
no "Ready to start". The page's icon (`favicon.svg`, and the logo) is the real tag36h11 #0.
- Layout: on a wide screen the right column (the 3D plot, then the **Now** panel) is sticky and fills the window, so nothing
  in it needs scrolling; the 3D plot takes the height that is left, and it has Calibrate robot, Fit, Reset view (from camera 1,
  above) and Full screen (the element's own, else a `.plot3d.full` class filling the window, as on an iPhone).
  Now is one panel: the readout table (position in cm, orientation as a unit quaternion w, x, y, z from `TagCore.quatOf`,
  distance, speed, corner fit, ± depth; click a row to plot it) over the time plot. Its tabs, in this order: **Orientation** (the
  quaternion, its sign kept continuous with `quatNear`), **Position** (cm), **Velocity** (cm/s, each sample's change over
  the last 0.1 s; it replaced Motion, and a saved `motion` reads as it) and, while the robot has an arm, **Joint angles**:
  a table of both arms' seven joints with their ranges in place of the readout table, and the chosen arm's joints over time
  (`RB.jhist`, each new pose's angles), and, while a hand is on the table, **Forces** (N, `RB.fhist` from `forceRow`): each
  hand's squeeze, what it can hold (2·μ·squeeze), the grip's load and everything else it touches, plus how much of its hold
  the grip uses. `tplotSeries` gives the plot its lines for each tab.
- **Detection runs in a pool of workers** (`S.pool`, `POOL`: one per spare core, up to 4, each with its own OpenCV; the
  others start once the first is ready, from the browser's cache). Each camera's frames go to an idle worker, up to its share
  of the pool in flight (`idleWorker`), so one camera is detected several frames at a time; a result overtaken by a later
  frame of the same camera is dropped (`doneSeq`). The first worker also calibrates and draws tags and boards.
  Frames go to the workers as WebCodecs `VideoFrame`s (`HAS_VF`; an ImageBitmap where there are none), and the worker
  reads only the pixels it searches with `copyTo` (`grey`, `greyRect`): a webcam's NV12/I420 luma plane is already grey,
  so a 720p frame takes about 0.5 ms instead of ~9 ms through a canvas. Windows start and end on even pixels (chroma).
- **Search windows** (Detector card, Search: Predicted | Whole picture; `searchPlan`, `TagCore.planSearch`): once tags are
  found, a camera searches only where each should be next (its last corners moved on by their speed across the picture,
  padded by 40% of its size plus half the move) and where tracks the other cameras see should appear in it; windows that
  touch are merged, and more than half the picture means a full search. The whole picture is searched every `FULL_EVERY`
  (10) frames to find new tags, and on the next frame when a predicted tag wasn't found (`expect`, `forceFull`). In the
  demo a window-only frame takes ~4.5 ms against ~13 ms for a full one; the tile shows the share searched.
- **Several cameras** (`S.cams`, each with its own tile, video, overlay and frame loop; results tagged with the camera's key as `src`). Camera 1 (the top bar's camera) is the frame of everything;
  "Add camera" adds more. The full-screen button beside Blur puts every camera view full screen (`#camsBox`,
  `setCamsFull`; the browser's own, else a `.full` class filling the window), arranged as on the page and as big as the screen
  allows, with a leave button in its corner (or Esc). **Placing the cameras** is Calibrate step 4: whenever two or more cameras see the whole board,
  held still, the board's pose in each (the worker's `boardPose`: IPPE, then `refinePose`) is captured as a rig view;
  `TagCore.calibrateRig` chains first poses out from camera 1 through shared views, then refines every camera pose and
  every board pose together (a bundle adjustment of all corners in all cameras). The rig is saved by camera key
  (`rig`; device ids, or `demo:k`), and `placeCameras` re-expresses it from whichever camera is now first. A placed
  camera's measurements go into the rig frame (`toRig`, covariance turned too) and are fused per track: Filtered feeds
  every camera's frames to the one Kalman filter (it takes frames up to `lateBy` 0.1 s out of order), Refined fuses the
  latest from each camera within 50 ms by one fit to all their corners, Raw takes each camera's as it comes. **Both use
  the corners, not each camera's pose** ("tightly coupled", as in Neunert et al. 2016 and TagSLAM's tag projection
  factors): `TagCore.sighting` (a camera's corners of a track, its lens, rig pose, corner noise and time offset);
  `refineJoint` for Refined, Levenberg–Marquardt on one SE(3) pose against every sighting, Huber-weighted, each frame
  moved to the newest one's time by the track's velocity (`trackVelocity`, from its last poses), since webcams aren't
  synchronised; and `PoseFilter.updateCorners` for Filtered, an iterated error-state update in information form
  (Gauss–Newton on the posterior, Bell and Cathey 1993), each camera's frame at its own time (a late one moved back by the
  state's velocity), gated on the correction's size and the fit. Each sighting's noise is its own corner scatter plus a
  model error in quadrature (`c.modelPx`: the camera's rig RMS, at least `MODEL_PX` 0.25 px), or the filter chases
  the small disagreements every rig calibration leaves. Before
  that, `TagCore.chooseCand` picks between a face-on tag's two mirror-image poses (`plausible`: those that fit about as well
  as the best): the one the other cameras agree with, else the one nearest the track's last pose, so Refined doesn't flip
  frame to frame; with other cameras the filter gets only that choice. An unplaced
  camera only draws its own view. A placed camera also draws, dashed, the tags only the other cameras see.
  The table says which cameras see each track; the 3D plot draws every placed camera (relative to a tag, from that tag's mean
  pose over the last half second, `steadyRef`, so its noise doesn't shake them). The time plot never offers the reference
  tag (it sits at the origin). Lens calibration (steps 2–3) picks
  its camera in step 2.
- **Camera names**: click a camera's name on its view to rename it (Enter keeps, Escape cancels, empty goes back to the
  device's label). Names are kept by camera key in `camNames` and shown everywhere a camera is named (`camName`); lens
  calibrations stay keyed by the device's own label, so renaming never loses one.
- **Print** (a tag row's print button, "Print board" in Calibrate step 1, or the setup guide's Print; not in the top bar) opens a dialog to print any of your tags (at their own sizes), other IDs typed as a list
  (`TagCore.parseIdList`: "3, 10-12") at one size, and the ChArUco board, in one print window: tags packed at true size
  with captions, the board on its own landscape page (`@page board`), check bars of 50 mm and 2 inches under each.
  **Paper** is A4 or US Letter (`TagCore.PAPER`; the default from the browser's region, `paperFor`, then kept as
  `paper`): the print page declares it in `@page`, and the dialog refuses anything that wouldn't print at full size on it
  (`maxTagSize`, `maxBoardSquare`: about 148 mm tags and 26 mm squares on either), since fit-to-page would shrink it.
  A tag's row print button and "Print board" in step 1 open the same dialog with that already chosen.
- **Arranging the views** like monitors in display settings (`arrangement()`, `layoutTiles()`): Auto sizes each tile by
  its picture's pixels and places it where its camera sits, as seen from behind camera 1 (`TagCore.arrangeTiles`, spread
  just enough not to overlap; unplaced cameras in rows of two; one column under 500 px). Dragging a view (or its corner,
  or arrow keys and +/−) makes it Custom, kept per camera key in `arrange`. Small views drop their name plates.
- **The demo** is three cameras round one scene (`DEMO`), rendered with WebGL in true perspective from each camera's
  pose and the exact 70° lens (`demoRenderer`), so detection, fusion and placing run on real pictures. The scene: a Body
  tag (#2, tipped back so one camera can tell its mirror poses apart) and two hands (moved along `RobotCore.demoPose`, below), each a 10 cm partial cube
  (`CUBE`, `DEMO_HANDS`, `cubeMembers`: tags on the front, both sides and the top), added as rigid objects with their exact
  shape when the demo starts (`demoScene` gives every tag's pose); in Calibrate the
  scene is the board, holding 12 poses in turn (`demoBoard`, 60 mm squares). Step 4 then shows how far the solved rig is
  from the demo's true layout (under a millimetre). Demo frames reach the page ~20 ms after they are drawn, so compare a
  pose against the scene at its frame time minus 20 ms (then the cube hands are within ~1 mm and 0.15° when filtered,
  with the cameras placed). Headless Chrome needs the GPU (`--use-angle=metal`) to run it at speed.
- **Tare orientation** makes the current orientation of every tag in view the identity: plotted poses become `R0ᵀR`
  (`TagCore.tared`, in the tag's own tared axes; positions unchanged). Tares live in `S.tare`, in memory only, and are
  cleared by Clear tare or a change of "Relative to"; the stored history is re-expressed at once (`retare`). The video
  overlay always shows true poses.

- **The robot** (`robot-core.js`, RobotCore, no DOM; Show: Robot, the default): a humanoid with two 7-joint arms (spherical
  shoulder, elbow, spherical wrist; the right arm the left one's mirror image). The chest follows the Body track and each wrist
  the track on its side. Roles are Settings → Robot (Auto: the track named Body/Chest/Torso is the body, else with three the
  highest; the others are arms, each taking the side of the chest it is on when calibrated; a role set to a tag that is part of
  an object is that object). **The demo ignores the saved roles** (`robotSet`): tag 2 is its chest and the hand cubes its arms,
  whatever the setup guide chose, whose default IDs (Body 2, Left wrist 1, Right wrist 0) match the demo's. One track draws one arm on a mount,
  two draw both arms on a shoulder bar, a body adds the torso and head; only tracks seen since load (or the last frame change)
  count, and a track out of view holds its last pose, faded. `RobotCore.ik` is analytic: the elbow lies on a circle about the
  shoulder-wrist line, 120 swivel angles are scored and the best refined, preferring the elbow below the hand and out to the
  side, then low, with soft joint limits and steadiness against the last elbow position and joint angles (`PREFER`; the elbow switch in
  Settings turns the preference off). Following a previous solution (`prev.psi`), the elbow searches only within `swing` (6°)
  of where it was and heads for a much better place elsewhere 6° at a time, so a straight arm (where the upper arm's turn
  trades freely against the forearm's) or a joint limit never makes it jump. **The demo's hands follow `RobotCore.demoPose`**, a path
  in the robot's own chest frame (each cube's front tag rides on a wrist, on the chest the robot finds from the body tag) that
  stays clear of every singularity and limit (elbow 75° or more, wrist bend under 35°, each joint 20° from its limits, hands
  above the elbows and elbows out, so the elbow preference never switches on) and keeps each hand facing camera 1 within ~36°
  (only camera 1 measures them until the cameras are placed). The cubes are turned so camera 1 sees two or three faces, and the
  body tag is square to camera 1 and tipped back, so neither is a face-on single tag (two mirror-image poses) and the hands never
  pass in front of it. It rests in the start pose 3.5 s of every 18 s (`DEMO_CYCLE`), and the demo calibrates the robot only
  then (`demoAtHome`). Measured in the demo: hand targets within ~3 cm and 4° of the path, joints at most ~2° a frame. A target out of reach puts the wrist on the line to it (`reach`, `gap`). **The elbow never goes quite straight**
  (`MIN_BEND`, 5°, so the reach is `reachOf(m)`, 0.4 mm short of upper + fore): a straight arm is the singular pose, where the
  elbow's circle is a point and ψ means nothing, and an arm let go straight came back with its elbow wherever the joints'
  steadiness left it (a median 10 cm from the preferred place, sometimes up) and stayed there. **Calibrate
  robot** (key C on the plot, voice "calibrate robot") is a tare for the robot: `RobotCore.calibrate` takes the start pose (arms
  at the sides, forearms forward, palms in: `HOME`) from the tags now, keeping each wrist tag's turn to the home hand and
  its shift to the home wrist in the chest's frame, so a turned wrist turns the hand in place. Until then the robot stands in
  `HOME` wherever the tags are; the demo calibrates itself once it sees all three. The calibration is in memory only, cleared
  by a frame change, a new camera 1, or a new track. It reads the plotted poses with the tare taken off, so taring
  never moves it, and Mirror never changes it. Each tag is drawn riding on the robot (on the chest, on the
  back of its wrist); joint angles are the Now panel's Joint angles tab. **Motion ×** on the Tracking card (`settings.robot.scale`,
  0.1 to 5, offered as 0.25 to 3) scales for teleoperation: `RobotCore.targets(cal, poses, {scale})` multiplies each wrist's
  move from its start position (`cal.arms[].home`, in the chest's frame); the hand's orientation and the chest (the body tag)
  are never scaled. **It is drawn shaded with WebGL** (`robot-gl.js`, RobotGL) on
  `#plotGL`, a canvas over the plot's own (pointer events off), with the plot's camera (`TagCore.orbit`) so it lines up with
  the grid: **the Machine**, curved meshes built from the robot's lengths in the frame each rides in (aluminium box
  sections, motor drums on the joint axes, a sensor-bar head, a parallel gripper whose jaws close along the hand's y, side to
  side in the start pose (`RobotCore.gripper`: its boxes, shared with the physics; each jaw drawn at the gap the table's
  physics gives, `arms[].jaw`), on a column), lit by a key, a fill and the
  sky with specular highlights and a rim, graphite joints and violet lights (the wrist light turns amber while that hand is
  out of reach). It is the only look: Pearl, Companion and Hologram were tried and taken out, and a saved `look` is dropped.
  The chest tag sits just in front of its body. A generic design; keep it looking like no company's robot. `meshes()` has no DOM and test section 5h checks it. Where there is no WebGL
  (or the context is lost) the robot is drawn flat on the plot canvas (`drawRobotFlat`). The demo's hands are named for the body's sides (its right hand is on
  the cameras' left).
- **The table** (`physics-core.js`, PhysicsCore, no DOM; Table: Off | Ball | Ball and cup on the Tracking card,
  `settings.robot.props`, default the ball and a mug): a table in front of the robot with a 4 cm ball and a mug with a handle
  it fits in, to push about and pick up. Placed from the chest's pose when the robot is first shown and on each Calibrate
  robot (`placeTable`: the top just under the fingers in the start pose, its near edge under the wrists; the ball past the
  left fingertips, the mug past the right with its handle towards the robot; on its own the ball sits between the hands),
  it then stays put in the world while the body moves. Reset table (key T, voice "reset the table") puts them back; anything
  that falls off comes back 2 s after it lands. A small rigid-body engine made for this one scene. **Bodies**: the props and
  the two hands. Each touches things with spheres (the ball one; the mug's on its rims and handle, all a flat surface can
  touch; a hand's fill its gripper and line its jaws), and the mug also has its exact shape as a distance function
  (`cupSdf`: walls, floor, rounded lip, a half-torus handle; mass and inertia sampled from it), which the ball and the hands
  meet. Arm links are kinematic capsules. **The grippers are rigid against each other** (sphere against sphere, both
  moving) **and against the other arm's links** (never their own, which they hang on; a link's `id` starts with its
  arm's side). **Things bounce**: a contact that will close within the substep at more than
  `BOUNCE` (0.3 m/s) turns round with its restitution, even while still a few mm apart (contacts are taken `MARGIN` early,
  and otherwise only closed their gap, so the ball used to stop dead). The table's grip is `table.mu` (default the mat's
  0.7; a lacquered table is about 0.12, where a ball thrown with backspin skids before it rolls). Sequential impulses at 240 Hz with Coulomb friction, restitution, **rolling
  resistance and spin friction in proportion to the contact force** (`crr`, `SPIN_R`), warm starting and split impulses.
  Props that touch **sleep together** once all are still, as fixed obstacles, and wake together when something moving
  comes near. The table's grip (0.7) is above the mug's radius over its height, so a push near the rim tips it and one at
  its foot slides it; the robot's metal is slippery (0.15), its pads rubber. **The hands are bodies** (`HAND`), pulled
  towards where the arm puts them by a spring and damper with a force and torque limit, so the table and the props stop
  them; the page then draws the arm by IK to where each hand is (`tableStep`). **The arm's joints** follow the IK within a
  top speed and acceleration (`RobotCore.slew`, `SLEW`), before the physics. **The grip** (`GRIP`): the jaws close until both pads
  meet one prop, then squeeze like a servo, with a force in proportion to how far past it they are told to close (`k`, up to
  `force`), so a slight close holds lightly. The grip is a joint solved with the contacts (`joint`, `solveJoint`): it
  holds the pinched point and the prop's turn with only what the pads allow, friction (2·μ·F) along any direction and, against
  a turn, what the patch of pad touching it resists (its spread along and across the fingers, `takeGrip`). What it can't hold
  slips and is held where it slipped to, so a fingertip pinch or a light hold on the handle lets the mug swing about the
  pads, and a firm whole-pad grip holds it level. The pads stay solid against what they hold; the prop is let go when it
  slides out of them or the jaws are opened to its width. A prop never turns faster than `W_MAX` (a guard; the tests check
  it is never reached: an early grip that held the centre of mass, not the pinch, spun the mug at hundreds of rad/s). How open
  each gripper should be (`gripOf`): a hand moved with the mouse, else the **feedback servo on the operator's hand**, read
  from the nrf-controller board fixed to that hand's track (`TagCore.ACT`: its telemetry service's Actuators characteristic,
  `struct dashboard_actuator_status`, 20 Hz while subscribed; `gripOpening` maps the feedback's share of the servo rail
  between the readings the board row's **Set open** / **Set closed** keep in `boards`), else open. A board allowed before
  the page asked for that service has to be removed and connected again. **Moving a hand with the mouse** (or a finger;
  works with no tags, in the demo, and over a tag-driven hand): press on a gripper and drag it across the view, in the
  robot's plane (forward, side or up as its normal, from the table's axes) that the view looks most squarely at: from above
  side to side and forward and back, from the side forward and back and up and down, from the front side to side and up
  and down (`grabPlane`; Alt: the next nearest, so from above it lifts; the plane goes through the target, never the
  physics hand, or a hand held back by the table would drag its own target away), scroll on it to close (down) or open it, Shift-scroll to tip the
  fingers, Space to open or close the last one moved. **The gripper the pointer can take lights up** (`hoverNow`, every
  frame from where the pointer last was, so one that moves under a still pointer lights too; not while orbiting): it is
  tinted violet (`hot` in robot-gl.js; within `GRAB_PX`, 30 px), brighter while dragged. Only the gripper: no disc round
  it. It stays where it was put (`TB.drive`, **in the world**, the plot's frame, so the arm reaches to
  keep it there when the body moves, and a change of "Relative to" gives it back to its tag) until **Tags drive**,
  Calibrate robot or a reload. Dragged into the table (or the floor, the other arm or the other gripper) its target goes
  at most `PhysicsCore.PRESS` (5 mm) past where it rests (`holdBack`), and the pointer's offset takes up the rest, so it
  presses lightly (10 to 20 N, not all the arm has), never sends the arm out of reach under the table (which slid it
  along), and comes up as soon as the pointer does. That shift stays **in the drag plane** (`holdBack`'s `plane`): a push
  that isn't level (a tilted gripper, a capsule's round side) moved the target up along it, and with the drive spending all
  of `HAND.force` on the push the two grippers slid 3 to 4 cm past each other. Dragged past the arm's reach the wrist is
  kept on the edge of it, in the drag plane (`RobotCore.inReach`): out of reach the IK stretches along the line from the
  shoulder, which lies above the target, so the hand rose (and the target had to come all the way back before anything
  moved). Grabbing a hand whose target was left out of reach (the body moved away) starts it again from the hand. The grip from the servo is checked only with encoded bytes so far, not a real board.
- **What the contacts did** (`W.record`, after each physics step; the comment above `W.step` has its shape): every touching
  pair's force, slip and rolling speed; **impacts** (a pair that starts touching after 30 ms apart, at 3 cm/s or more, with
  the speed they met at); and for each hand the forces on it: each contact's, the grip's, and the whole wrench. **A grip's
  load is the joint and the pads on the held prop together**: the joint and the pads pull against each other inside the
  grip (about 13 N holding the ball still, growing until the joint "slips"), which cancels in their sum, what a wrist sensor
  would read; its share of the hold (`use`, slipping at 98%) is that load against 2·μ·F and its turn about the pinch
  against the joint's torque caps. Every body has a **material** (`MATERIALS`: wood 1 the table, ceramic 2 the mug, rubber
  3 the ball and the pads, aluminium 4 the robot, stone 5 the floor; the ids are meant to go over the air, so they never
  change). Three things read it:
  - **Force arrows** (Forces: Shown | Hidden on the Tracking card, `settings.robot.forces`, shown by default;
    `forceArrows`): what pushes on a hand ends where it pushes, a grip's load starts at the pinch (amber while it slips),
    3.5 cm per doubling past 0.2 N; drawn over everything (`o.forces` in robot-gl.js, and flat without WebGL).
  - **Sound** (`sound.js`, ContactSound; the speaker button among the plot's buttons, M, or "sound on" / "mute";
    `settings.robot.sound`, off by default): synthesized with Web Audio, no recordings, and **it follows the speeds**. An
    impact rings both materials' modes (`SOUNDS`: decaying sines and a click of noise) with an amplitude in proportion to
    the speed they met at (`hitVoice`, `loudness`: full at `IMPACT_FULL`, 4 m/s), brighter when harder (`brightness`: the
    higher modes and the click grow faster), a soft partner damping the other's ring. A touch that lasts makes two sounds
    at once, each in proportion to its own speed (`loopVoices`): sliding hisses with the slip, rolling rumbles with the
    travel, so a skidding ball does both. Stereo: each sound is panned by where it is in the view (`panOf`, a
    StereoPanner). Played in step with the physics (each impact at its own time within the step); the output stage only
    limits peaks, so loudness stays in proportion. `render()` does the same offline (an OfflineAudioContext), for a clip.
    Quiet while the microphone listens (`duckSound`) or the page is hidden.
  - **Haptics** (`PhysicsCore.haptics(record, side)`, no DOM, not yet sent anywhere): what the operator of a hand should feel,
    as events for an nrf-controller board's haptography library (material and speed, played on its TacHammer): impacts
    and touches (slide, roll or press, with speed and force) that reach the hand through itself, the prop it holds
    (`through` that prop's material) or its own arm. Touches are state, sent again each step, so a lost packet never
    leaves one buzzing. The BLE stream and the firmware side belong in nrf-controller.
- **Setup guide** (`#setupDlg`, the book icon in the top bar, which stays there): opens on load while `settings.setup` (its own switch, and Settings → Setup guide): a camera
  or the demo; how many tags (one arm, two arms, body and two arms) with their IDs and sizes, which become tags named Body,
  Left wrist and Right wrist and the robot's roles (applied by Next, Print or the phone link, never by closing); the lens
  (optional); the start pose.
- **Script versions**: index.html loads its own scripts (and the detection worker, which passes it on to `tracker-core.js`)
  with `?v=<date>`. Bump it whenever any of them changes, or a browser can run a cached old `robot-core.js` beside a new
  page (it once froze the 3D view: an error in `frame()` stopped the loop, which now asks for the next frame first and
  reports an error once).
- `index.html`: the UI. `speech-worker.js`: speech to text (above). `physics-core.js` (PhysicsCore, no DOM): the table (above). `sound.js` (ContactSound): its sounds (above). `tracker-core.js` (TagCore, no DOM): poses, frames, intrinsics, history and axis sampling, the orbit
  camera, calibration-view checks, and the SE(3) refinement, rigid objects and filter below. `worker.js`: the OpenCV side in a Web Worker (detection, solvePnP, ChArUco calibration);
  its `TagVision` factory also runs in Node.
- OpenCV.js is **pinned** (`@techstark/opencv-js@4.12.0-release.1`, jsDelivr then unpkg) and loaded by the worker; it is
  not vendored. Tags use OpenCV's ArUco detector with an AprilTag dictionary and AprilTag corner refinement, shifted by
  half a pixel to OpenCV's pixel-centre convention; the board uses DICT_5X5_100 so it never clashes with tag IDs.
- Pose (the "Pose" control): **Raw** is OpenCV's IPPE pose per tag. **Refined** runs `TagCore.refinePose`, Levenberg–Marquardt
  on SE(3) with left perturbations `T ← exp(ξ^)·T`, from that pose and from its mirror image (`flipPose`: a flat tag seen
  nearly face-on has two poses that fit), keeping both as candidates with covariances (corner noise from the fit, 0.15 to 3 px).
  **Filtered** adds `PoseFilter`, an error-state Kalman filter on SE(3) with a constant-velocity model (state p, v, R, ω;
  `R ← exp(δθ)·R`); among candidates that fit about as well as the best it takes the one nearest the prediction, which
  settles the mirror-image doubt, and it gates outliers (restarting after 3 in a row). `MOTION` holds the three tunings.
  "Compare with raw" draws the raw track dashed. All of it runs in the worker except the filter.
- Rigid objects (`bodies` in storage): two or more tags fixed to one thing. "Learn shape" collects each tag's pose relative
  to the first (the origin) over 20 unambiguous frames and averages them on SO(3) × R³ (`meanPose`, outliers dropped);
  then the worker solves one SE(3) pose from every visible corner (`solveBody`, started from the two biggest-looking tags
  and their mirrors). Tags in an object are tracked only as it, and refined on their own only while learning (`learn`).
- **Stream** sends the poses on: after each detection, at most `rate` times a second, one message (`TagCore.streamMessage`,
  JSON lines or CSV under `STREAM_CSV_HEADER`) with the newest plotted pose of every track in view, so in the 3D view's
  frame and tare: key, name, metres, quaternion w, x, y, z, Unix time. **Serial/USB** goes through Web Serial; **UDP** goes
  through `udp-bridge.py` (Python standard library, served for download), a WebSocket server on 127.0.0.1:8770 that sends
  each message as one datagram to the `?to=host:port` the page names, and refuses pages from origins other than
  tsmorz.github.io and localhost unless `--origin` adds one. A message that finds the last still being written is dropped
  and counted, never queued. Settings in `stream`.
- **Motion sensors** (Tags card; `S.boards`): nrf-controller boards (XIAO nRF54LM20A Sense, the private repo's firmware)
  over Web Bluetooth. The page reads the board's data service the way nrf-controller's dashboard does (`TagCore.IMU`,
  `decodeBoardInfo`, `decodeImuBatch`: a copy of its `src/sysid_wire.h` IMU batch, keep the two in step): 208 Hz, up to
  8 samples a notification, each with board µs, gyro and accelerometer counts and VQF's quaternion (IMU → a z-up world
  whose heading drifts). Every characteristic needs an authenticated link, so an unbonded board makes the system ask
  for its code. `rememberBoards` lists boards the site may already use (`getDevices`; the data logger shares the
  origin). Each board's clock goes onto the page's with `TagCore.BoardClock` (lower envelope of arrival − board time,
  with drift; it can't see the smallest delay, a few ms). A board is fixed to one track (`boards` in storage: track,
  M, use). `TagCore.lineUp` learns M (object → IMU) and W (VQF's world → rig) from the cameras' own poses of the track
  (`noteCamPose`, the chosen candidate, never the filter's) paired with the board's orientation at the same moment
  (`imuAt`): hand-eye from turn axes, then Gauss–Newton on SO(3)×SO(3) with outliers dropped; it asks for turns about
  two axes. M is kept; W is found again on each connection and its heading follows the cameras slowly (`pairUp`).
  Lined up, each batch goes into the track's filter in Filtered mode only (`boardFuse`): the mean gyro turned into the
  rig (`PoseFilter.updateRate`) and VQF's tilt (`updateTilt`, loose about world up). Neither starts a track or keeps
  one alive past `imuFor` (0.5 s) without a camera. The demo adds a simulated board on each hand (`SIM_BOARDS`,
  `startSimBoards`) that sends the real bytes with its own clock, bias, noise, drifting heading and delay; it lines up in
  ~4 s. Measured in the demo: one camera, a hand's orientation 0.18° with its board against 0.73° without (worst frame
  0.4° against 4.7°); with three placed cameras the hands are ~0.16° either way. Not yet run with real boards.
- Colours: tags take the eight validated categorical slots in a fixed order and keep their slot (`slot` in storage); a
  ninth tag is grey with its name. The demo cubes' side and top tags have no slot (`-1`), since only their hand is drawn. x/y/z are `--x/--y/--z`, chosen to pass the colour-vision checks, and always labelled.
- **Recording and notes** (the Recording card, on Track): Record keeps every new plotted pose (each track's sample
  from each detection, once; `recTick`), in the Track tab's frame, tare and view, up to an hour or 600,000 poses, in memory
  only (leaving the page with one not downloaded asks first). The notes box is the recording's: one line per note, and while
  recording a new line starts with the time it was begun (`TagCore.fmtStamp`; `parseNotes` reads them back). Downloads:
  CSV (the Stream columns plus `note`, notes on rows of their own) or JSON (`tag-tracker-recording/1`, samples shaped like
  Stream messages); all times Unix seconds.
- **Voice** (V outside a text box, the top bar's Voice button, or Dictate): MediaRecorder takes the microphone until
  `TagCore.VoiceGate` hears a pause; the clip is decoded to 16 kHz mono and `speech-worker.js` (a module worker) turns it
  into text with Whisper tiny.en through Transformers.js (**pinned**, `@huggingface/transformers@4.3.2`, jsDelivr then
  unpkg; WebGPU where there is one, else WebAssembly), on the computer. The model downloads on first use only. A whole
  utterance that is a command (`TagCore.voiceCommand`, `VOICE_COMMANDS`: the tabs, start/stop recording, tare, clear tare,
  calibrate robot, fit, reset view) runs it (`VOICE_ACTIONS`); anything else, or "Note ...", is a note (`tidySpeech`, `insertSpeech`).
- **The board on a screen**: `/tag-tracker/#board` is a shareable link that fills any screen with the ChArUco board (nothing
  stored), for a tablet or second monitor. `TagCore.boardFit` picks whole device pixels per square with half a square of
  white round it, turning the board a quarter when that's bigger; the worker draws it (`boardImage`), so the page waits for
  OpenCV. It keeps the screen awake (Wake Lock), has a Full screen button, and its instructions fade after 5 s so nothing
  covers the board. "Show on a screen" in Calibrate step 1 gives the link as a QR code, Copy, Share (Web Share) and a new
  window. The QR code comes from `lib/qrcode-generator/` (1.4.4, MIT, vendored unchanged). With OpenCV.js installed, test
  section 6b finds all 40 corners on the screen board (turned too) and decodes the QR code back to the link.
- **Tags on a phone**: `/tag-tracker/#tags=2:Body,0:Left%20wrist` (IDs, each with an optional name; `&f=` for a family other
  than tag36h11) shows the tags one at a time on the same overlay as the board, as big as the screen allows in whole pixels
  per cell (`TagCore.tagFit`, a cell and a half of white round it), with the name and number under it; tap the sides, swipe
  or use the arrow keys for the next. "Show on a phone" on the Tags card (all your tags), each tag row's phone button (that
  one) and the setup guide give the link as a QR code (`fillShare`, the same panel as the board's; from the Tags card it pops
  up in `#shareDlg`, in the guide it opens inside it); on a
  phone or tablet itself (`onPhone()`: a coarse pointer and a screen under 900 px) they open the tags right there instead. Screens don't show true
  millimetres, so the instructions say to measure the black square and enter it.
- `script/test-tag-tracker` (`task check:tag-tracker`, in `check:fast`) checks TagCore, including the refinement's covariance
  against Monte Carlo, the mirror-image case, a three-tag cube, the filter against a textbook Kalman filter, flips and gating,
  the mirror-image choice, the joint fit (against one camera and against fusing poses, its covariance by Monte Carlo,
  unsynchronised moving tags, a bad corner), the corner-fed filter, the search windows, the Stream messages, the recording exports, notes, voice commands and the voice gate,
  the robot (section 5h: the home pose, IK against FK on random poses, elbows out and low, steady joints, out of reach and
  back (the elbow bends straight back out to its preferred place), `inReach` keeping a dragged target's height,
  calibration with one, two or three tags (and arms swapped by mirrored poses), `tagFit`, its settings, the joints' speed and
  acceleration), the table (section 5i: rolling resistance against its formula, spin, the mug's shape, sleeping, tipping,
  sliding, resting on its handle, the ball in it, hands the table stops, gripping, pressing, pouring, a mug swinging from
  its handle, a fast hand, the time a frame takes, grippers against each other and the other arm, a drag into the table
  and a tilted gripper dragged level into the other (holding its height), and the servo grip's bytes and mapping; the record: impacts at the
  speed of the fall, rolling and sliding speeds, a hand pushing the table, a grip's load against the ball's weight and its
  share of the hold, haptics through the hand and through a held ball, materials' ids, a dropped ball's bounces (each about
  its restitution times the last), a skid on lacquered wood against Coulomb friction, and the sounds: amplitude in
  proportion to impact speed, brighter when harder, sliding and rolling each as loud as its speed), and (with
  python3) the UDP bridge end to end; the motion sensors (their bytes, clock mapping, lining up, the filter with and
  without them); with OpenCV.js, that a search window finds the same corners as the whole picture; with OpenCV.js installed
  (`npm i --no-save @techstark/opencv-js@4.12.0-release.1`) it also renders a board and tags with a known camera and checks
  that calibration recovers the camera and poses come back within millimetres.
