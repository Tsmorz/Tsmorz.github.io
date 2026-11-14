---
paths:
  - "controls.md"
  - "vision.md"
  - "embedded.md"
  - "_data/labs/**"
  - "assets/js/lab/**"
  - "assets/js/vision/**"
  - "assets/js/embedded/**"
  - "_includes/lab.html"
  - "script/test-lab"
  - "script/test-vision"
  - "script/test-embedded"
---

# The lab template (`/controls/`)

`controls.md` includes `lab.html`, which renders `_data/labs/controls.yml`. **To add or change a lesson, edit
that YAML, not code.** The file is organised around one **running problem**: a mass on a spring. `problem` is its
statement (not shown on the page), `demos` are the rows of the lesson map (the mass first, then the `extend: true`
plants: tilt table, aircraft, cart-pole), and `tabs` are the lessons, in teaching order. A lesson names its `demo` and
`lab`, a view for each of `top`, `row1`, `row2`, the panel `controls`, and its ARIVA fields. `labs` holds the plants
(a plant from `lab-plants.js`, a controller, and optional `params`, `model`, `gains`, `refs`, `net`,
`requirements`, `sysid`, `limit`, `estimator`); lessons may share a lab. The URL hash is a lesson id (`#arx`) or a demo
id (`#flight`, which opens its first lesson); hidden lessons skip physics and drawing.

**The rule for new content:** teach each idea on the mass on a spring first, as a lesson in the first row, then say
what changes on the other plants in their lessons (`needs` and `recall` point back to the mass lesson). Do not add an
idea only to a side plant.

- `lab-plants.js`: one entry per sim (mass-spring, tilt table, cart-pole, aircraft): constants, `deriv`,
  limits, actuator slew, failure `status`, supported controllers, what a Manual drag means, state-plot lanes,
  and `draw`. The aircraft's trim is solved numerically.
- `lab-core.js` (no DOM): linearisation, the closed loop as one state-space model (so loop gain, root locus
  and pole placement are linear algebra), margins, Nyquist counting with delay, Padé poles,
  interval bounds on the small net, ARX identification (instrumental variables), Ho–Kalman, and the simulator.
- `lab.js`: the views and panel controls, listed at the top of the file. The /controls/ demos start in Manual
  and track a Wave | Step reference; noise goes on measurements, never the force.
- `lab-flight-render.js`: the flight sprite, trees and clouds.

Other notes:

- **Estimation:** the mass ("Estimate the speed") and the cart-pole use an `lqg` controller (position and angle
  measured only, LQR on an estimate by differencing or a Kalman filter); each plant's `est` block says which lanes
  the estimator view draws; margins, Nyquist and poles include the filter. Every /controls/ demo has a View toggle
  (Terms, Bode, Nyquist, Poles), a margins readout and an ω probe.
- **Discretisation:** a lab's `ctrlPeriod` runs the controller once per period with a zero-order hold.
- **System ID** (mass-on-a-spring lessons) keeps two methods, least squares (ARX) and Ho–Kalman (ERA), plus a tab to record your own
  data. Both read m, c, k at order 2 or more (the slowest oscillating pole pair plus the DC gain, flagged
  `reduced` above order 2); order 1 reads nothing.
- **Unseen states:** the "Change of basis" lesson (mass) draws the same motion in coordinates `x̃ = T x` (views
  `basis-*`, control `basis`). The aircraft and cart-pole "Unseen ..." lessons use `LabCore.unseen`: a multi-output
  Ho–Kalman (`eraMimo`) on the linearised plant measured through `unseen.outs`, then a one-off calibration of a hard-to-measure
  state (`unseen.targets`) against the realized states, checked on a fresh input (views `unseen-*`, control `unseen`;
  `amp` and `N` keep the open-loop runs small). `script/test-lab` section 4b guards it.
- The ω slider on closed-loop tabs has a "Shake the sim" toggle that adds a sine at ω to input 0.
- **Teaching structure (ARIVA):** every lesson runs through five labelled steps: **Arrive** (`goal`, plus
  `minutes`), **Reactivate** (`needs`, the lessons it builds on, shown as links; `recall`, one line tying back; and `predict: {question,
  options, answer (0-based), try, explain}`, a card shown before the sim whose answer opens the note), **Inform**
  (`note`, folded; `maths` is an optional folded "Show the math"), **Process** (`tasks`, tick-off steps) and
  **Evaluate** (`check`, one question or a list: `{question, options, answer, explain, why}` where `why` has one
  line per option saying why a wrong one is wrong; and `recap`, "You can now ..."). `script/test-data` requires
  goal, recall, predict, note, tasks, check, recap, a valid `demo` and valid `needs` on every lesson.
- `script/test-lab` (`task check:lab`, part of `task check`) checks the plants, textbook margins, Nyquist vs
  eigenvalues, pole placement, the filter, network bounds, identification, and that every `_data/labs` page
  names only plants, views and controls that exist. `assets/models/verify-net.json` is written by
  `script/train-verify-net`; never hand-edit it.

### The vision lab (`/vision/`)

Same template as /controls/: `vision.md` includes `lab.html`, which renders `_data/labs/vision.yml`. A page's `engine: <name>`
makes `lab.html` load `lab-ui.js`, `assets/js/<name>/<name>-core.js` and `<name>.js` instead of the controls scripts, and
`finale` is where the last "Next" goes.
Both pages run their cards, lesson map and ticks through `lab-shell.js`. The running problem: a camera watches a ball roll
on a table; where is it, in centimetres, every frame? The first row goes pixels, blur, edges (Sobel), corners (Harris),
find the ball (redness threshold, blobs, roundness), homography (drag four corners), match features (descriptors, ratio
test, RANSAC against a second view made by a known H), two cameras (block matching, triangulation), learn a filter (one
3×3 kernel by Adam), a small network (a two-layer CNN that trains live in the page) and track (Kalman with a gate and a card
that hides the ball). The `extend: true` row runs the filters and a colour tracker on the visitor's webcam (never sent
anywhere; it stops when another lesson opens).

- A lab's `source` is `photo` (one of the `assets/img/vision/` photos, worked on at 320 × 240, switchable to the table),
  `table` (the ball scene, rendered pixel by pixel in `renderScene` from the homography `CAM`, so every lesson knows the
  truth), `stereo` (ray-cast pair in `renderStereo`) or `camera`.
- Image views get a **magnifier**: the pointer shows the patch under it, enlarged, through the lesson's filter (`loupe` in
  vision.js). On Edges and the camera lesson the photo stays underneath unless the panel asks for the whole filtered picture.
- `script/test-vision` (`task check:vision`, in `check:fast`) guards the filters, the detector (and that it fails in dim
  light, which the network lesson relies on), the geometry, matching at the rotations the Match lesson quotes, stereo,
  both learners, the tracker, and that `vision.yml` names only views, controls, sources and photos that exist.

### The embedded lab (`/embedded/`)

`embedded.md` + `_data/labs/embedded.yml` (`engine: embedded`). The running problem: a board on a CR2032 coin cell reads a
button and a thermistor, blinks an LED, logs to flash, talks to a radio chip, and must last a year. Lessons: digital input
(pull-up, bounce, RC filter, Schmitt, software debounce), analog input (bits, reference, averaging), thermistor (divider,
ratiometric reading, straight line / Beta / table), LED and PWM (current, duty, flicker, gamma), memory (flash, .data, .bss,
heap, the stack through one cycle with the ADC interrupt at its deepest call), flash (erase-before-write, wear, ring log),
buses (UART clock mismatch, I²C pull-ups and rise time, SPI), and battery (charge per wake, internal resistance, brown-out).
The `extend: true` row is a bike light: a mode button as a state machine (act on press vs on release), and a Li-ion cell read
through a divider for step-down. A lab's `kind` picks the model. Every number comes from `embedded-core.js`; the battery
lesson starts deliberately badly (about 47 days) and the visitor fixes it. `script/test-embedded` (`task check:embedded`, in
`check:fast`) checks each claim the lessons make, and that `embedded.yml` names only views, controls and kinds that exist.
