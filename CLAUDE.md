# CLAUDE.md

Guidance for Claude Code (and future me) when editing this repo.

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

### Glide Path (`/glide-path/`)

`glide-path/` is a self-contained page like the serial plotter (no front matter, its own look, outside the layouts):
`index.html` is markup only, `glide.css` the styles, `glide-app.js` the page, `glide-core.js` the maths (no DOM) and
`glide-worker.js` the route search; `glide-3d.js` the 3D view (below). Pick a launch point and set glide ratio, airspeed, launch height, wind, a terrain margin,
the steepest slope you would land on and **how far away you can still see the glider**. It loads a 7 × 7 block of Terrarium
terrain tiles (AWS Terrain Tiles) round the launch and works out the reach two ways: 720 straight glides (`castRays`,
stopping where the glide path minus the margin meets the ground) and a route search on a half-resolution grid
(`reachGrid`: a max-height Dijkstra over 16 neighbours with wind, in the worker) that must stay within the sight distance,
so a glide can curve round a hill. Ground beyond the sight ring is shown as a faint wash ("reachable, but out of sight").
**A long glide gets coarser terrain, never a cut-off**: `chooseZoom` picks the most detailed zoom (13 down to 9) whose block
holds the furthest possible glide, and the page steps down a zoom if a glide still reaches the block's edge. For one launch
and one set of settings it only ever steps down (`zoomKey`): going back up could flip between two zooms for ever, redrawing
everything with nothing touched. **The ground at the launch always comes from zoom 13** (`groundAt13`, kept in `fineGround`),
whatever zoom the reach runs on: coarser terrain smooths a peak tens of metres lower, which used to lower the glider's start
and shrink the reach as the zoom changed. A route asked for is kept across a zoom change and worked out again. Long-press
(right-click) a spot for the best route there. The cross-section is drawn on the map too (white casing, solid while the
glider flies, dashed past where it lands, dots at the strip's distance marks; the route itself when one is shown), and the two
share one cursor: scrubbing the strip moves a probe on the map (panning it into view), and hovering the map within 18 px of
the trace moves the strip's cursor (`showCursor`; the strip is redrawn from a saved `ImageData`, not recomputed). A badge under
the layers button shows the wind: an arrow the way it blows, its speed and where it comes from (`windBadge`). `script/test-glide` (`task check:glide`, in `check:fast`) guards the core,
including the service worker in a mock.

**Base maps and contours**: Street, Topo, Satellite (Esri World Imagery, online only, never stored: it shows what the ground
is, a field or a forest, which slope alone can't) and the offline hillshade; the choice is kept as `base` (not when going
offline swaps in the hillshade). Over Satellite the map's colours switch to the imagery set (below). **Contour lines**
are an overlay drawn by the page from the same Terrarium tiles (`Contours` grid layer, `terrWindow`; `GlideCore.contours`:
3 × 3 smoothing, then marching squares, saddles split by the cell's mean), so they work offline and over any base: light with a
dark edge over imagery, brown over the light maps. Each tile contours a window with a 2 px margin, so lines meet across tile
edges; above zoom 13 it contours the part of the zoom-13 tile under it and draws it sharp. Spacing is `contourStep` (by zoom
and units; every 5th line thick), shown in the Key. They come on with Satellite the first time; after that `contours` keeps the
choice. Google's imagery is not an option: its terms forbid it beside a non-Google map and need a billed API key.

**3D** (the 3D | 2D button under the locate button; kept as `view3d`): the same map tilted, drawn by **MapLibre GL**, vendored
in `glide-path/lib/maplibre/` (5.24.0, source-map comment stripped, BSD licence kept) and loaded with `glide-3d.js` only the
first time 3D is opened. Its mountains are the same Terrarium tiles (raster-dem, `encoding: 'terrarium'`, maxzoom 13, true
scale), so the reach, which is the 2D overlay's own canvas as a `canvas` source (copied once per redraw: `play()` then
`pause()` after a render), lies on exactly the ground it was worked out on. The base follows the 2D layers menu; a MapLibre
hillshade goes over the light maps and is the whole base offline. Lines and points (outline, slope hits, sight ring, the
cross-section with its marks, the route, the probe) are read from the 2D map's Leaflet layers whenever the page calls
`mark3d()`, so the 2D map stays the one source of truth. The 3D map is a `.map3d` layer inside the Leaflet container (z 900:
over the panes, under the controls), so the Key, wind badge and layers menu stay; zoom, scale and attribution are hidden
(`.is-3d`), and its mouse, touch and wheel events are stopped there so the 2D map never pans or sets the launch from them.
In 3D a tap or dragging the pin moves the launch; long-press routes are 2D only. No WebGL: the button says so.
**Fly it** (beside the cross-section's title) follows the glide in 3D, the straight one or the long-press route, at its own
heights (the profile's `glide`): a chase camera 150 m behind and 55 m above the glider (`calculateCameraOptionsFromTo`, kept
25 m over the ground; the centre is unclamped from the ground while it flies), a glider drawn at the middle of the view, a
readout with Stop, and the cross-section's cursor following along. The whole glide takes 8 to 40 s; dragging the map ends it.

**No height limit**: the glider starts at the launch height the visitor sets and is never capped on the way (the US / EU
rules switch was taken out); the note under the panel tells pilots to check their local rules. **Units** are metric or
imperial (`Units` in the core; `SPEC` in glide-app.js gives each slider its range in both systems; `P` always holds metric values).

**Redraws stay cheap**: the reach is painted straight into a canvas that Leaflet positions like an image (`CanvasOverlay`,
no PNG encode), each grid cell's ray and distance are cached until the launch or the terrain changes (`geometry()`), and theme
colours are read once per theme change (`COL`).

Layout: controls on the left; the map with the cross-section strip under it on the right (on a phone, or any screen under
520 px tall: header with the status line, map, cross-section, controls). The header shows an "Offline" badge only when offline.
The panel's sections are `<details>` that remember being open (`open`); a folded one shows its settings in its title row
(`summaries()`). On a wide screen the top button on the map hides the whole left column (`setPanel`, kept as `panel`).
**Quick start** (`#guide`, the book in the header): three steps (where you launch, the glider and its launch height as
presets, reading the map), opened on load until "Show this when the page opens" (`guide`) is switched off; "I'll tap the
map" closes it and brings it back at step 2 after the tap. The glide ratio runs 1:1 to 30:1; a saved value outside a
slider's range is brought inside it on load.
**Look**: the site's own tokens, type and accent (Inter, STIX Two Text headings, JetBrains Mono for numbers and buttons;
violet, never an orange accent), from Google Fonts (offline the system fonts stand in).
The map has its own locate button and a key that folds away on small maps (a `<details>` Leaflet control). Long-press is a
touch timer of its own (550 ms, held within 10 px), not just Leaflet's `contextmenu`, so it behaves the same on iOS and Android
and never also moves the launch. Inputs are 16 px so iOS doesn't zoom in on them; touch targets are at least 40 px. Colours are
the site's chart palette, checked with the dataviz skill's validator (`PAL` in glide-app.js): violet landable on a straight
glide, teal **plus hatching** landable only by curving, red where a straight glide hits steep ground, gold the long-press
route, grey too steep. `PAL.light` (`#5a4fd6`, `#12a599`, `#b8263a`, `#a58d12`) is for the light maps; over satellite imagery
`PAL.img` (`#8a7af7`, `#0fa593`, `#f2526c`, `#b08f10`, light lines on dark casings) takes over (`restyle()`, the Key's
`.on-img`), and the reach is drawn more solid. Every landable region has a solid outline (cells on its border, drawn opaque),
which is what keeps it readable on imagery. Keep identity off colour alone. Tokens are defined three times like main.css, and the page follows the site's `theme` in `localStorage` and
has its own light/dark switch.

It works offline. `sw.js` keeps the page and every terrain tile it has fetched (a capped `glide-terrain-runtime` cache), and
"Save this area" stores 9 × 9 zoom-13 tiles round the launch plus 7 × 7 at each of zooms 12 to 9 (277 tiles) in
`glide-terrain-saved`, which only the page deletes from (a tile shared by two saved areas stays until both are gone). Saved areas
are listed in `localStorage` (`glide-reach-areas`; every key keeps the old `glide-reach-` prefix so nothing saved is lost). **Street maps are never stored for offline use**: OpenStreetMap's tile policy
forbids "save area" features, so offline the page switches to a hillshade it draws from the saved terrain. Leaflet is vendored in
`glide-path/lib/leaflet/` (1.9.4, source-map comment stripped), and MapLibre in `lib/maplibre/`, so the page loads with no network; bump `VERSION` in `sw.js`
whenever `SHELL_FILES` changes (it lists every file of the page). The service worker also registers on `localhost`, so `script/serve` exercises it.

The page was **Glide Reach at `/glide-reach/`** until 2026-11-10. `glide-reach/index.html` redirects to `/glide-path/`
(keeping query and hash), and `glide-reach/sw.js` replaces the service worker browsers installed there: it unregisters
itself and moves open tabs to the new address, deleting no caches (the terrain caches are shared). Leave both in place.

### The tag tracker (`/tag-tracker/`)

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
  (`RB.jhist`, each new pose's angles). `tplotSeries` gives the plot its lines for each tab.
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
  then (`demoAtHome`). Measured in the demo: hand targets within ~3 cm and 4° of the path, joints at most ~2° a frame. A target out of reach puts the wrist on the line to it (`reach`, `gap`). **Calibrate
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
  meet. Arm links are kinematic capsules. Sequential impulses at 240 Hz with Coulomb friction, restitution, **rolling
  resistance and spin friction in proportion to the contact force** (`crr`, `SPIN_R`), warm starting and split impulses.
  Props that touch **sleep together** once all are still, as fixed obstacles, and wake together when something moving
  comes near. The table's grip (0.7) is above the mug's radius over its height, so a push near the rim tips it and one at
  its foot slides it; the robot's metal is slippery (0.15), its pads rubber. **The hands are bodies** (`HAND`), pulled
  towards where the arm puts them by a spring and damper with a force and torque limit, so the table and the props stop
  them; the page then draws the arm by IK to where each hand is (`tableStep`). **The arm's joints** follow the IK within a
  top speed and acceleration (`RobotCore.slew`, `SLEW`), before the physics. **The grip** (`GRIP`): when both pads touch one
  prop while closing, a coupling holds it where it was taken, but only with what the pads' friction allows (2·μ·grip force;
  a twist about the jaws' axis far less, a pad's small patch), and what it can't hold slips and is held where it slipped
  to: a mug pinched by its handle swings down about the jaws. Opening 5 mm past the gap it was taken at lets go. How open
  each gripper should be (`gripOf`): a hand moved with the mouse, else the **feedback servo on the operator's hand**, read
  from the nrf-controller board fixed to that hand's track (`TagCore.ACT`: its telemetry service's Actuators characteristic,
  `struct dashboard_actuator_status`, 20 Hz while subscribed; `gripOpening` maps the feedback's share of the servo rail
  between the readings the board row's **Set open** / **Set closed** keep in `boards`), else open. A board allowed before
  the page asked for that service has to be removed and connected again. **Moving a hand with the mouse** (or a finger;
  works with no tags, in the demo, and over a tag-driven hand): press on a gripper and drag it over the plane at the
  height it is sent to (Alt: the upright plane facing you; the plane follows the target, never the physics hand, or a hand
  held back by the table would drag its own target away), scroll on it to close (down) or open it, Shift-scroll to tip the
  fingers, Space to open or close the last one moved. It stays where it was put (`TB.drive`) until **Tags drive**,
  Calibrate robot or a reload. The grip from the servo is checked only with encoded bytes so far, not a real board.
- **Setup guide** (`#setupDlg`, the book icon in the top bar, which stays there): opens on load while `settings.setup` (its own switch, and Settings → Setup guide): a camera
  or the demo; how many tags (one arm, two arms, body and two arms) with their IDs and sizes, which become tags named Body,
  Left wrist and Right wrist and the robot's roles (applied by Next, Print or the phone link, never by closing); the lens
  (optional); the start pose.
- **Script versions**: index.html loads its own scripts (and the detection worker, which passes it on to `tracker-core.js`)
  with `?v=<date>`. Bump it whenever any of them changes, or a browser can run a cached old `robot-core.js` beside a new
  page (it once froze the 3D view: an error in `frame()` stopped the loop, which now asks for the next frame first and
  reports an error once).
- `index.html`: the UI. `speech-worker.js`: speech to text (above). `physics-core.js` (PhysicsCore, no DOM): the table (above). `tracker-core.js` (TagCore, no DOM): poses, frames, intrinsics, history and axis sampling, the orbit
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
  the robot (section 5h: the home pose, IK against FK on random poses, elbows out and low, steady joints, out of reach,
  calibration with one, two or three tags (and arms swapped by mirrored poses), `tagFit`, its settings, the joints' speed and
  acceleration), the table (section 5i: rolling resistance against its formula, spin, the mug's shape, sleeping, tipping,
  sliding, resting on its handle, the ball in it, hands the table stops, gripping, pressing, pouring, a mug swinging from
  its handle, a fast hand, the time a frame takes, and the servo grip's bytes and mapping), and (with
  python3) the UDP bridge end to end; the motion sensors (their bytes, clock mapping, lining up, the filter with and
  without them); with OpenCV.js, that a search window finds the same corners as the whole picture; with OpenCV.js installed
  (`npm i --no-save @techstark/opencv-js@4.12.0-release.1`) it also renders a board and tags with a known camera and checks
  that calibration recovers the camera and poses come back within millimetres.

## When editing, don't

- Reintroduce theme boilerplate (`_sass/`, a gemspec, `docs/`, bundled font files).
- Hardcode a project into a page's HTML.
- Add a JS dependency for something 20 lines of vanilla JS already does in `site.js`.
- Add a LICENSE: the site is all rights reserved on purpose (README, "License"). Vendored libraries keep their own.
