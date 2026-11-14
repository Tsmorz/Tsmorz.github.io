# AGENTS.md

Guidance for Codex (and future me) when editing this repo.

## What this is

Tony Smoragiewicz's personal site: a custom Jekyll site on GitHub Pages at <https://tsmorz.github.io>.
It started as a fork of `jekyll-theme-minimal`, but the theme is gone; the layouts, CSS and JS here are the
whole design.

The `/controls/` section should be the clearest way to *see* controls engineering. **Every piece of theory
is explained with a figure or animation the visitor can drive**, not with equations alone: a margin is a bar
on a plot, a pole is a mark that moves when you drag a gain. Equations are labels on a picture, written with
the visitor's current numbers. When adding a concept, ask what the visitor would drag to understand it.
Keep prose short; less is better.

## The one rule: content lives in `_data/`, not in markup

To change what the site says, edit YAML, not HTML.

| Want to change | Edit |
| --- | --- |
| Projects shown anywhere | `_data/projects.yml` |
| Services (and the work that shows each), process, contact on /solutions/ | `_data/solutions.yml` |
| The "Have a look around" tiles under the home hero | `_data/home.yml` |
| The Hardware design photos and text on /projects/ | `_data/hardware.yml` |
| Tag tracker teleoperation levels, objectives, hints and scoring targets | `_data/tag_tasks.yml` |
| Glide Path aircraft presets and destination/input labels | `_data/glide.yml` |
| Recipes, and the Recipes nav dropdown | `_data/recipes.yml` |
| Lessons on /controls/, /vision/ or /embedded/ | `_data/labs/controls.yml`, `vision.yml`, `embedded.yml` |
| Name, bio links, CV button | `_config.yml` |
| The Labs nav menu (Controls, Double Pendulum, Custom data, Vision, Embedded) | `_layouts/default.html` |
| Nav logo (cartpole, fade, radial, pendulum, pendulum4 or pendulum3) | `logo:` in `_config.yml`; all are drawn in `_includes/logo.html` (the favicons in `assets/img/` are separate files) |
| Bio prose, education timeline | `about.md` |
| Hero headline / intro paragraph | `index.html` |
| Colors, spacing, type | `assets/css/main.css` (tokens at the top) |
| The Journal look of /recipes/ | `assets/css/journal.css` (its own tokens at the top) |
| Swing-up network or its physics | re-run `task export-web` in `../n-cartpole` (never hand-edit `assets/models/`) |

**Adding a project:** append to `_data/projects.yml`. Only `name` and `blurb` are required; `featured: true` is what
lists it on `/projects/` (`tags` and `on_cv` are kept as data but not shown), `image`
is optional (16:9), and the **first** entry in `links` is what the card title links to.

## Architecture

```
_config.yml              site metadata + author/social; blank `cv_url` and `social.scholar` hide their UI
_data/*.yml              all page content that repeats
_layouts/                default (nav, theme toggle, footer) and page (+ title header, .prose)
_includes/               project-card, learning-path, lab: take params, not globals
assets/css/main.css      hand-written, token-based, no build step
assets/css/journal.css   the Journal: /recipes/'s own look, loaded after main.css on pages with `style: journal`
assets/js/site.js        theme toggle, tag filter, nav menus, hero symbols
assets/js/cat.js         the footer cat: a pixel-art orange tabby that lives on the footer line (see below)
assets/js/statebox.js    `drawStateBox`: the state/units panel shared by the lab and swingup.js (load first)
assets/js/swingup.js     /controls/swingup/: double cart-pole + goal-conditioned TQC policy in vanilla JS
assets/js/fit.js         /controls/fit/ (fit.md): upload a CSV, fit x[k+1] = Ax + Bu, design a discrete LQR; FitCore has no DOM
assets/js/recipes.js     /recipes/ (recipes.md): tick lists, metric/imperial; RecipeCore (unit conversion) has no DOM
assets/js/lab/           the lab template behind /controls/; lab-shell.js (cards, lesson map, hash) is shared by every lab page,
                         lab-ui.js (plots, panel controls, pointer) by the newer engines (vision.js, embedded.js)
assets/js/vision/        /vision/ (vision.md): vision-core.js (no DOM) and vision.js (views, controls, loop)
assets/js/embedded/      /embedded/ (embedded.md): embedded-core.js (no DOM) and embedded.js
assets/img/vision/       the /vision/ photos: three CC0 Commons photos at 640 × 480, credited on vision.md; add new ones only once approved
assets/models/           swingup-tqc.{json,bin} from n-cartpole; the fixture is test-only
controls/swingup/real/   /controls/swingup/real/: browser firmware installer (esp-web-tools, pinned to an exact version); manifest, image pieces, the model (`n-cartpole-model.ncpm`) and its own `manifest-model.json` (an "Install model" button that writes it to the `model` partition) come from `task fw-installer -- fw-vX.Y.Z [--model <.ncpm>]` in `../n-cartpole`, never hand-edit; `script/test-installer` checks them
script/                  serve, check, test-data, test-installer, test-swingup, test-lab, test-vision, test-embedded, test-fit, test-recipes, test-glide, test-tag-tracker, train-verify-net
```

### Conventions

- **No build step for CSS/JS.** Plain files served as-is; no bundler, Tailwind or Sass.
- **Theming is CSS custom properties only.** Define every color on bare `:root`, redefine it under
  `@media (prefers-color-scheme: dark)` guarded with `:root:not([data-theme="light"])`, and again under
  `:root[data-theme="dark"]`, or the toggle breaks in one direction.
- **Sim canvases get their size from CSS, never JS.** Each demo is a `.sim-stack` that stretches to its
  panel's height; canvases are absolutely positioned and JS only sizes the pixel buffer from
  `clientWidth/clientHeight`. Don't set `style.height` from JS: at 2x DPR the buffer feeds back into layout and
  the canvas grows every frame. On phones (≤ 720 px) the /controls/ and swing-up stacks
  turn to `display: contents`, so the panel sits between the sim and its plots; each cell's height is set there.
- **Includes take explicit params** and never reach into `site.data` themselves.
- **GitHub Pages runs Liquid 4:** `uniq`, `concat`, `slice`, `where` exist; `push` does not.

### The swing-up demo

`/controls/swingup/` runs the goal-conditioned TQC policy from
[n-cartpole](https://github.com/Tsmorz/n-cartpole) in the browser: pick a target pose (UU, UD, DU, DD, or
Random) and one network drives there. The JSON's `goals` block switches that on. The policy only works on the
plant it was trained on, so **`swingup.js` hard-codes no physical constants**: everything comes from
`assets/models/swingup-tqc.json`. The one exception is `RAIL_HALF`, which widens the rail to ±1 m on the page.
The dynamics are a line-for-line port of `n_cartpole/env/dynamics.py`. The page opens with the network on (button "AI") and Random targets cycling, so the ~2 MB weights download on load; Manual
is a click away. `script/test-swingup` guards the port (JS vs torch actions, JS vs Python trajectory,
closed-loop runs of every transition); if it fails after a re-export, the port has drifted.

### The footer cat (`assets/js/cat.js`)

30 s after load an orange tabby walks in along the footer line, washes, yawns and curls up above the copyright
with its tail wrapped round its front, and sleeps. `NAP` (10 min, wall clock from when it fell asleep, kept across pages as `nap`)
later the page calls `wake()`, but only while the footer is on screen and not while it is stroked or purring: it uncurls, yawns and
walks off the left end (`leave()`, ending in a `gone` act); the page then removes the lane and starts over with the 30 s `DELAY`. Hover gives
content `^` eyes, a click a slow blink and a heart, and stroking (the pointer back and forth over it) kneading paws (`KNEAD`).
It purrs only after a click, for `PURR` seconds: the canvas buzzes by one screen pixel (a CSS transform, finer than an art
pixel). On its way in, a click stops it to look round at you (`lookAct`) and stroking sits it down to knead (`petAct`); both
`interrupt` the timeline, and a walk then carries on to where it was going. The sprite acts are `busy` and ignore it. The hit box follows the drawn pixels. It is pixel art (2 px per art pixel, a 48 px lane) drawn from a **rig** (body, head, two-bone IK legs, a tail
chain) posed by a timeline of acts; each frame is drawn 4x fine on an offscreen canvas and every art pixel takes the
majority palette color of its block, so it stays crisp. Eye (a dark pupil with a greenish-yellow `--eye` iris behind it) and nose are stamped as exact pixels, and the forehead stripes stay clear of the eye so they never read as a second one; curling up and sleeping
are hand-drawn letter-grid sprites (`CURL1`, `CURL2`, `SLEEP_IN`, `SLEEP_OUT`). It draws at 15 fps and its clock only runs
while the footer is on screen; reduced motion shows it asleep for good. It carries on across pages: the clock and the wait so far are
kept in `localStorage` (`footer-cat`) on `pagehide`, for 30 minutes, and the next page jumps the timeline to that clock. Coat colors are CSS variables on `.cat-lane` in main.css. A page can give it a hat: `cat_hat: baker` in its front matter puts `data-cat-hat` on `<body>` and cat.js
stamps that glyph from `HATS` on its head, rig and sleeping sprite alike (/recipes/ wears a baker's toque, /controls/ a mortarboard, `grad`; `--hat`, `--hat-shade`, `--hat-edge`, `--hat-tassel`, re-pointed per hat in main.css).

### Recipes (`/recipes/`)

The page has its own look, **the Journal** (`assets/css/journal.css`, loaded with Newsreader and Geist Mono by the
default layout when the front matter says `style: journal`): ink on paper, a serif for everything you read and mono only
for marginalia (§ marks, numbers, amounts, labels), hairline rules instead of cards, and one ink colour (ultramarine)
for what you act on. Choices are words, not keys: serif, greyed until chosen, the chosen one underlined like a link
(`.journal .sim-tab`); don't bring back boxed buttons, which read as the nrf-controller dashboard. It re-points the site's tokens on `body`, so the nav and footer turn to paper too; keep
its colors in journal.css, defined three times like main.css. The recipes index is a numbered list of `[data-recipe]`
links (`href="#id"`), ingredients and notes sit beside the steps, and the page prints as just the open recipe (`.j-print-hide`).
`recipes.md` + `assets/js/recipes.js`, all content in `_data/recipes.yml` (the file's header comment documents the fields). **Every amount
is a weight in grams**, so each recipe runs on a kitchen scale (eggs, cream and water included); `RecipeCore` shows ounces, pounds and
°F when the visitor picks imperial. Steps are plain strings with `[[...]]` tokens (`[[i:id]]` an ingredient's amount, `[[g:700]]`,
`[[t:175]]` or `[[t:22-26]]`, `[[len:20]]`, `[[ml:175]]`); never write a unit into a step by hand. The visitor can **scale** each recipe
(½×, 1×, 2× or any factor): ingredients, `spoon` measures, `[[i:...]]`, counts `[[n:4]]` and `[[gx:340]]`/`[[mlx:4000]]` multiply, while
`[[g:]]`, `[[ml:]]`, `[[t:]]` and `[[len:]]` are per piece (a dough ball, a ramekin, the oven) and stay put, so pick the token by which it is.
Ingredients and steps each get a tick box, and the ticks, the unit choice and each recipe's scale live in `localStorage`. A recipe is its `id` in the URL hash: bare `/recipes/` is the index (masthead and list only), and a hash shows that one recipe alone
with an "All recipes" link back (recipes.js sets `data-view` on `.journal`). The index rows show each recipe's `makes` and `time`;
an open recipe has the scale/units/clear-ticks bar (`.rc-bar`, moved by `build()`) under its head (Clear ticks turns into an
Undo for 10 s) and a previous/next pager at the bottom. The nav dropdown (built from the
same data, `.nav-menu` in the layout) links to those hashes. **Adding a recipe:** append to the YAML. `script/test-data` checks the shape and
the tokens; `script/test-recipes` (`task check:recipes`, in `check:fast`) checks the conversions and the scaling, renders every recipe in both systems at three scales
and checks that the batter and custard weights quoted in the steps match the ingredients.

### The custom data page (`/controls/fit/`)

`fit.md` + `assets/js/fit.js`. The visitor uploads a CSV with a header row and exactly three kinds of column:
`t` (seconds), `x` or `x1, x2, ...` (states) and `u` or `u1, u2, ...` (inputs); other columns are ignored. There is no
column picker or unit setting, on purpose. `FitCore` resamples to a uniform time base: states are interpolated, and each
input (held between samples) is averaged over every interval. The page fits `x[k+1] = Ax + Bu` by **least squares only** (the
page no longer offers a sample-rate slider or Ho–Kalman; `fitHoKalman` and the `mult` argument of `prepare` stay in `FitCore`, tested
but unused by the page). `dlqr` solves the Riccati recursion on the model; `reachability` counts the directions the input can move
(rank of the controllability matrix, states scaled by their spread), and the page says when some states may not be reachable.
Once a model is found the bottom plot is a **live simulation** of it: stepped in real time under `u = u_ss r − K(x − x_ss r)` (steady state from
`steadyState`; one state is tracked, chosen in the panel), with a reference slider, a push button, a reset and a controller on/off switch. Weight
sliders keep the running sim; changing the tracked state restarts it. The page also plots data against one-step predictions and the z-plane poles.
The page opens on the built-in cart-pole example (`exampleCsv`), so it is never empty, and says so above the results. It is its own page, not a lab lesson, so it has a goal, an explanation and tasks but no predict or check cards. `script/test-fit`
(`task check:fit`, in `check:fast`) guards the parser, the resampling, both fits, the LQR, the tracking and reachability.

### The lab template (`/controls/`)

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

## Running and checking

```sh
script/serve    # http://127.0.0.1:4000 with live reload
task check      # what CI runs: data → swingup → lab → build → JS → links
```

Needs Ruby ≥ 2.7; the system Ruby on this Mac (2.6.10) can't run Jekyll 4, so use `brew install ruby@3.3`
or rely on CI. `Taskfile.yml` is the single entrypoint (`task --list`); `script/check` and
`.github/workflows/pages.yml` both delegate to it. `check:data` validates `_data/*.yml` (required fields, local project images exist).

## Deployment

`.github/workflows/pages.yml` builds on every push and PR, runs html-proofer, and deploys to Pages from
`main`. Repo setting: **Settings → Pages → Source = GitHub Actions**; don't re-enable the legacy build.

### CI gotchas

- **Always pass `--baseurl` to the build, even when empty** (`task build` does). Omitting it makes
  `jekyll-github-metadata` try to derive it on the runner and fail with `No repo name found`, or inject a
  `/pages/<owner>` prefix that breaks every asset link. Don't make the flag conditional.
- **Linux is case-sensitive, macOS isn't.** `logo.JPG` referenced as `logo.jpg` works locally and 404s in CI.
  `script/test-data` compares exact basenames to catch it (project images and `_data/hardware.yml` photos).
- **External links aren't checked** (`--disable-external`) on purpose, so a typo'd external URL won't be caught.

### The nrf-controller data logger (`/data-logger/`)

`data-logger/` is a copy of `tools/dashboard/` from the private nrf-controller repo, written by `task
publish-dashboard` there (it replaces the whole folder). **Never edit it here**: change it in
nrf-controller and publish again. It is a standalone Web Bluetooth page with its own look, outside the
site's layouts (no front matter, so Jekyll copies it as-is).

`dashboard/index.html` is this site's own: a redirect from the page's old address (`/dashboard/`, until
2026-10-25) to `/data-logger/`, keeping any query and hash. The publish task doesn't touch it.

### The serial plotter (`/serial-plotter/`)

`serial-plotter/index.html` is one self-contained page (no front matter, so Jekyll copies it as-is) with its own
look, like the data logger. It talks to a board over Web Serial (Chrome/Edge desktop), pulls `name:value unit`, `name=value`,
Teleplot `>name:value` or CSV columns out of each line and draws one chart per unit; a console with filters, recorded
test runs (kept in IndexedDB, compared as overlays, exported as CSV, log or a Markdown report), markers, A/B measurement
cursors and an ESP-IDF/Zephyr device-clock time axis. It has a Demo stream and opens saved logs, so it works without a board.
The same file is also published as a Claude artifact; edit it here and copy it there, not the other way round.

### Dyna-soar (`/glide-path/`)

`glide-path/` has its own look outside the site layouts (`layout: null` front matter renders `_data/glide.yml`):
`index.html` is markup, `glide.css` the styles, `glide-app.js` the page, `glide-plan.js` the pure plan/units/destination logic, `glide-core.js` the maths (no DOM) and
`glide-worker.js` the route search. Pick a launch point and set glide ratio, airspeed, launch height, wind, a terrain margin,
the steepest slope you would land on and **how far away you can still see the glider**. It loads a 7 × 7 block of Terrarium
terrain tiles (AWS Terrain Tiles) round the launch and works out the reach two ways: 720 straight glides (`castRays`,
stopping where the glide path minus the margin meets the ground) and a route search on a half-resolution grid
(`reachGrid`: a max-height Dijkstra over 16 neighbours with wind, in the worker) that must stay within the sight distance,
so a glide can curve round a hill. Ground beyond the sight ring is shown as a faint wash ("reachable, but out of sight").
**A long glide gets coarser terrain, never a cut-off**: `chooseZoom` picks the most detailed zoom (13 down to 9) whose block
holds the furthest possible glide, and the page steps down a zoom if a glide still reaches the block's edge. Long-press
(right-click) a spot for the best route there. The cross-section is drawn on the map too (white casing, solid while the
glider flies, dashed past where it lands, dots at the strip's distance marks; the route itself when one is shown), and the two
share one cursor: scrubbing the strip moves a probe on the map (panning it into view), and hovering the map within 18 px of
the trace moves the strip's cursor (`showCursor`; the strip is redrawn from a saved `ImageData`, not recomputed). A badge under
the layers button shows the wind: an arrow the way it blows, its speed and where it comes from (`windBadge`). `script/test-glide` (`task check:glide`, in `check:fast`) guards the core,
including the service worker in a mock.

**No height limit**: the glider starts at the launch height the visitor sets and is never capped on the way (the US / EU
rules switch was taken out); the note under the panel tells pilots to check their local rules. **Units** are metric or
imperial (`Units` in the core; `SPEC` in glide-plan.js gives each slider its range in both systems; `P` always holds metric values).

**Redraws stay cheap**: the reach is painted straight into a canvas that Leaflet positions like an image (`CanvasOverlay`,
no PNG encode), each grid cell's ray and distance are cached until the launch or the terrain changes (`geometry()`), and theme
colours are read once per theme change (`COL`).

Layout: controls on the left; the map with the cross-section strip under it on the right (on a phone, or any screen under
520 px tall: header, map, destination readout, collapsible cross-section and a bottom settings drawer). The header shows an "Offline" badge only when offline.
The map has its own locate button and a key that folds away on small maps (a `<details>` Leaflet control). Long-press is a
touch timer of its own (550 ms, held within 10 px), not just Leaflet's `contextmenu`, so it behaves the same on iOS and Android
and never also moves the launch. Inputs are 16 px so iOS doesn't zoom in on them; touch targets are at least 40 px. Colours are
the colour-blind-safe set validated with the dataviz skill (blue `#2a78d6` landable on a straight glide, aqua `#1baf7a` **plus
hatching** landable only by curving, orange `#eb6834` where a straight glide hits steep ground, grey too steep); keep identity
off colour alone. Tokens are defined three times like main.css, and the page follows the site's `theme` in `localStorage` and
has its own light/dark switch.

Planning: the map defaults to **Inspect destination**; **Move launch** is a one-shot mode that returns to inspection after a tap, with Undo for the last 20 launch moves. The launch is a square L and the destination a circle. Dragging L always moves the launch; long-press always inspects. Selected destinations survive a launch move, a parameter change and an unreachable result. Their readout includes arrival AGL, flown distance, minimum grid clearance (including cells crossed between route vertices), slope and sight distance. A route maximizes predicted arrival height, not minimum distance. Potential landing ground only considers slope; it does not assess obstacles or land cover.

Each slider has an exact numeric input; wind and profile bearings also accept degrees. Named aircraft store glide ratio, airspeed and sight distance, leaving launch height and wind unchanged. Named plans store launch, all settings, destination and units in `glide-reach-plans`; aircraft use `glide-reach-aircraft`. Matching names update the saved item. Modified controls are marked against the loaded plan. **Copy plan link** serializes the same validated SI data into `#plan=`; a shared plan overrides local defaults on load. Malformed links report an error and retain local defaults. `tests/glide/browser.js` exercises these flows via `task shot -- /glide-path/ --eval-file tests/glide/browser.js` (also `--phone`), after `task build`.

Calculation states distinguish loading, updating (previous overlay explicitly labelled), ready, incomplete terrain and missing terrain. Old worker results never repaint an overlay for new settings. Offline areas report actual cached tile counts; Verify saved terrain also asks the active service worker to check its own complete shell file list. Coverage at the current launch counts all 277 required terrain tiles across zoom levels, rather than trusting a saved-area name.

It works offline. `sw.js` keeps the page and every terrain tile it has fetched (a capped `glide-terrain-runtime` cache), and
"Save this area" stores 9 × 9 zoom-13 tiles round the launch plus 7 × 7 at each of zooms 12 to 9 (277 tiles) in
`glide-terrain-saved`, which only the page deletes from (a tile shared by two saved areas stays until both are gone). Saved areas
are listed in `localStorage` (`glide-reach-areas`; every key keeps the old `glide-reach-` prefix so nothing saved is lost). **Street maps are never stored for offline use**: OpenStreetMap's tile policy
forbids "save area" features, so offline the page switches to a hillshade it draws from the saved terrain. Leaflet is vendored in
`glide-path/lib/leaflet/` (1.9.4, source-map comment stripped) so the page loads with no network; bump `VERSION` in `sw.js`
whenever `SHELL_FILES` changes (it lists every file of the page). The service worker also registers on `localhost`, so `script/serve` exercises it.

The page was **Glide Reach at `/glide-reach/`** until 2026-11-10. `glide-reach/index.html` redirects to `/glide-path/`
(keeping query and hash), and `glide-reach/sw.js` replaces the service worker browsers installed there: it unregisters
itself and moves open tabs to the new address, deleting no caches (the terrain caches are shared). Leave both in place.

### The tag tracker (`/tag-tracker/`)

`tag-tracker/` is a self-contained tool page (`index.html` uses front matter only to render `_data/tag_tasks.yml`, with no site layout) with its own look: an instrument on a
vision bench. Cool anodised greys and ink with the site's violet (`--accent`, as in main.css) for what is live or pressed, and amber
only for warnings (never an orange accent on the dark greys: it reads as a certain adult site's branding); panels are plain outlined boxes
(1 px rule, 4 px corners, no shadows); viewfinder corner marks only on the video (`.reticle`, violet while detecting); flat ink-outlined
keys that invert when chosen; one typeface, Archivo, its width axis wide for the name and titles. Keep it that way: no rounded
cards, pills, middle-dot strings or monospace labels.
It tracks AprilTags from a webcam (or a built-in Demo camera) in Chrome/Edge: the visitor names each tag ID and enters its
printed size, calibrates the camera with a printed ChArUco board, and sees the last `History` seconds of each tag in 3D
(axes drawn every `Axes every` seconds, defaults 1 s and 0.1 s), relative to the camera or to a chosen tag, plus an x/y/z
plot and a readout table. Tags, settings and calibrations (keyed by camera label) live in `localStorage`.

- `index.html`: the UI. `tracker-core.js` (TagCore, no DOM): poses, frames, intrinsics, history and axis sampling, the orbit
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
  then the worker solves one SE(3) pose from every visible corner (`solveBody`). Tags in an object are tracked only as it.
- Colours: tags take the eight validated categorical slots in a fixed order and keep their slot (`slot` in storage); a
  ninth tag is grey with its name. x/y/z are `--x/--y/--z`, chosen to pass the colour-vision checks, and always labelled.
- **The board on a screen**: `/tag-tracker/#board` is a shareable link that fills any screen with the ChArUco board (nothing
  stored), for a tablet or second monitor. `TagCore.boardFit` picks whole device pixels per square with half a square of
  white round it, turning the board a quarter when that's bigger; the worker draws it (`boardImage`), so the page waits for
  OpenCV. It keeps the screen awake (Wake Lock), has a Full screen button, and its instructions fade after 5 s so nothing
  covers the board. "Show on a screen" in Calibrate step 1 gives the link as a QR code, Copy, Share (Web Share) and a new
  window. The QR code comes from `lib/qrcode-generator/` (1.4.4, MIT, vendored unchanged). With OpenCV.js installed, test
  section 6b finds all 40 corners on the screen board (turned too) and decodes the QR code back to the link.
- `script/test-tag-tracker` (`task check:tag-tracker`, in `check:fast`) checks TagCore, including the refinement's covariance
  against Monte Carlo, the mirror-image case, a three-tag cube, the filter against a textbook Kalman filter, flips and gating;
  with OpenCV.js installed
  (`npm i --no-save @techstark/opencv-js@4.12.0-release.1`) it also renders a board and tags with a known camera and checks
  that calibration recovers the camera and poses come back within millimetres.

### Tag tracker robot tasks

The Physics selector opens a robot workbench. **Small tasks** is the default: a ball in a bowl, a cup on a coaster,
two blocks in separate outlines, two stacked books, using each gripper for a ball, a loaded tray, one dishwasher
plate, a USB-C cable insertion and one folded towel. **Full challenges** retains the original larger tasks. Every task is selectable;
there are no story rooms, human avatars, rewards, navigation requirements or level locks. Keep all task content,
variant definitions, instructions and hints in `_data/tag_tasks.yml`. `TaskCore.mission(level, 'guided')` applies
`guided` overrides without mutating the full challenge. Results use `tag-tracker-guided` and `tag-tracker-teleop`;
old story results can seed guided results, and old human/door settings migrate to the robot and first task.

`TaskCore.guidance` is DOM-free. It reads actual grip constraints, prop pose, destination tolerance and objective
state to choose an action: line up, close, retry empty jaws, lift, move, orient, lower, release or settle. It detects
holding the wrong prop, a tray missing its second gripper and a towel missing its second corner. After placing
one prop, a low nearby empty gripper must lift clear before the next pick; otherwise it can knock the placed
prop out of its outline. Guidance never moves props or awards completion. The one-gripper two-block exercise
means **place A, release, lift the open gripper clear, then place B with the same gripper**. It never asks the user
to hold both blocks at once. A release cue uses a conservative fraction of the actual target tolerance.

The workbench keeps the active action, objective checkmarks and labelled destinations visible beside the scene.
Step-by-step instructions open automatically for the two-block task. Extra hints and mouse/keyboard help fold
away. Setup/manual command bars are in Task settings; Camera & AprilTags opens the instrument and setup guide.
AprilTags remain the default input. Drag either gripper with the mouse, scroll on it to close/open, Space toggles
it, Shift-scroll tilts and Alt-drag changes the movement plane. Q/E lift/lower the selected gripper. One stationary
initial set of body/wrist tags auto-calibrates after 0.8 s in the start pose; setup retains explicit recalibration.

The robot and AMR meshes are local code in `robot-gl.js`; no human mesh or textures are loaded. The robot head
camera tilts −80° to +25°, with a fixed 70° horizontal field of view. Projection and hand picking share that camera.
The renderer retains material lighting, tone mapping, soft sampled shadows and beveled rigid-prop visuals.
`physics-core.js` runs a 240 Hz accumulator, friction-limited grasps, contacts and sleep. Compound collision boxes
and cylinders share dimensions with rendering; openings stay hollow. Mass properties use analytic piece inertia
and the parallel-axis theorem (seam overlaps are an approximation). `cloth-core.js` is coarse XPBD towel cloth,
with stretch/shear, compliant bending, table friction and particle self-contact. The small towel uses a 13 × 13 mesh; the full pile keeps 9 × 9 per towel. The small towel folds in place on a pad. It is a physical approximation, not garment FEM. Props
must be released and settled for 0.75 s; handoff, two-gripper lifts and folding have additional checks.

`task check:tag-tracker -- 5j 5k` covers physical manipulation and guidance (`script/tag-tracker/teleop.cjs` and
`guidance.cjs`), including an actual sequential A/B placement with one gripper and the empty-gripper retreat.
After building, `task shot -- /tag-tracker/ --eval-file script/tag-tracker/guided-browser.js` performs the same
exercise through IK and motor slew, checks live hints, mode changes, all task views and the head camera.
`browser.js` covers the full challenges. Repeat browser checks with `--phone`.


#### Cable insertion and tactile output

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
cable tension and stretch, folds the finer towel with both physical grippers, and checks TacHammer packets,
routing, capability/stale/off guards and in-flight writes with mocked GATT. `advanced-browser.js` repeats USB
insertion through actual robot IK/motor slew and the rendered page; it never moves a prop directly. `fabric-browser.js` folds the small towel through both actual robot arms and checks released completion.

## When editing, don't

- Reintroduce theme boilerplate (`_sass/`, a gemspec, `docs/`, bundled font files).
- Hardcode a project into a page's HTML.
- Add a JS dependency for something 20 lines of vanilla JS already does in `site.js`.
- Add a LICENSE: the site is all rights reserved on purpose (README, "License"). Vendored libraries keep their own.

### Dyna-soar ridge screen and local wind

The name is **Dyna-soar**; the URL remains `/glide-path/`, and existing `glide-reach-*` storage, shared plans and terrain caches are retained. The exact Dinosaur Park statue location (44.077964, −103.245844; Library of Congress survey) is the default when no launch or shared plan is saved. Its launch button never snaps to a neighbouring peak. Aircraft, branding, weather copy, screening explanations and landmark coordinates live in `_data/glide.yml`. `dyna-soar.png` is the generated cartoon; `glide-path/ARTWORK.md` records the reference and generation prompt.

`soaring-core.js` is pure geometry and weather parsing; `soaring-ui.js` owns ridge marks and the wind-aligned profile; `wind-ui.js` owns regional forecasts, the terrain-flow worker, map vectors and the separate vertical-flow overlay. A ridge needs a local crest, ≥15 m rise/drop over roughly 140 m along the wind, and ≥8° lee angle. These are explicit screening choices, not validated flight thresholds. Calm ≤0.5 m/s has no directional screen. Terrain cells >40 m are rejected. Missing terrain never forms a candidate. Six separated candidates are shown with **DS?** labels and dashed lee outlines, independent of the reach palette. Profiles run from upwind through the crest to the lee; there is no resolved separated shear layer or energy-gaining flight path. **Fly it** is hidden for this terrain-only view. Glide reach uses one selected fixed-AGL horizontal layer of the spatial wind field, with no credit for vertical air motion or soaring energy gain.

The existing worker keeps independent `screenGrid` terrain for `SoaringCore.scan`, tagged by terrain ID and a launch/wind/sight key. Its replies do not complete a route-search job. Screening retains zoom-13 terrain when reach steps to a coarser zoom; if necessary it loads a bounded local mosaic sized to the sight distance. Only the latest matching screen paints. Its markings and selected profile also work in 3D.

**Load local wind** requests a centre and eight surrounding Open-Meteo forecasts covering the loaded map, at 10 and (when available) 80 m. Forecast vectors, rather than compass angles, are interpolated; the UI reports distinct provider grid points and the valid time. Mean wind drives the plan; gust remains informational. Editing reference wind clears the regional scenario. An old-area forecast is labelled and is not extrapolated into another area. Failed, malformed, outdated or late responses do not overwrite edited wind. Manual/reference wind and cached snapshots still work offline; no snapshot is described as current observations.

`wind-core.js` implements a diagnostic finite-volume mass projection, `U = U₀ − ∇φ`, on a local 56 × 56 × 24 Cartesian fluid grid. Terrain cells have zero normal flux; the top and lateral boundaries are open (`φ = 0`). Red/black SOR solves the Poisson equation to a residual target; `diagnostics` records convergence, initial/final divergence and maximum speed. This solves mass conservation, not momentum, turbulence, atmospheric stability or separated lee eddies. The input terrain stays at zoom 13 even if glide calculations change zoom. Missing terrain yields regional wind only; it cannot generate local lift/sink. Resolution is reported in the panel.

`wind-worker.js` computes the volume independently of the route/screen worker. Only the newest matching key may apply. Wind at the selected 10–150 m AGL layer is compacted for reach. Regional vectors outside the local terrain solve are cached on a 33 × 33 grid, with exact regional interpolation beyond that grid. A logarithmic neutral profile and explicit roughness assumption supply heights not covered by the forecast. These assumptions are saved/shared as `windModel`, including the forecast samples; legacy plans without `windModel` retain uniform reference wind. Unit changes never alter SI inputs.

Straight glides integrate local along-track ground speed step by step and retain cumulative altitude profiles for destination interpolation. Curved paths use the same fixed-layer field, positive height loss only, and distinct first/second half-edge losses; intermediate terrain checks and `midAlt` retain the correct halfway altitude. `GlideCore.reachAltitude` and the cross-section share those integrated results. Changing wind, roughness or layer recomputes the whole envelope and all arrivals. Vertical velocity is never included in the ray or route height update.

Wind arrows are available in 2D and 3D. Optional teal upflow/red-hatched downflow shading is separate from reach classification. The ridge strip shows estimated flow paths projected into its vertical section, not a 3-D glider trajectory; its cursor reports horizontal wind, estimated vertical air and the 10–80 m vector difference. Neither these differences nor candidate marks confirm a flyable dynamic-soaring shear layer.

`task check:glide` includes asymmetric ridge fixtures, wind reversal/along-ridge rejection, missing terrain, screening separation, wind-aligned sections, forecast units/times and worker message checks. After `task build`, `task shot -- /glide-path/ --eval-file tests/glide/soaring.js --console` checks the actual Dinosaur Park terrain, mock forecasts, a full-map wind reversal, candidate selection, profile and weather failure/staleness. Repeat with `--phone`; the existing `tests/glide/browser.js` still checks saved plans, unit invariance and offline coverage.


Wind checks in `task check:glide` cover flat flow, ridge speed-up, windward lift/lee sink, wind reversal, mass residual reduction, missing data, vector interpolation across north, separate 80 m inputs, uniform-field parity, changing wind along a path, integrated arrival/profile agreement, positive-loss routing without vertical energy, and wind-model plan round trips. `tests/glide/soaring.js` checks regional requests, actual Dinosaur Park terrain, converged flow, whole-map reversal, assumed-height changes, independent shading and late forecast protection.
