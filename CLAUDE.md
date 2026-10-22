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
| Services, process, contact on /solutions/ | `_data/solutions.yml` |
| Recipes, and the Recipes nav dropdown | `_data/recipes.yml` |
| Name, bio links, CV button | `_config.yml` |
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
assets/js/lab/           the lab template behind /controls/
assets/models/           swingup-tqc.{json,bin} from n-cartpole; the fixture is test-only
script/                  serve, check, test-data, test-swingup, test-lab, test-fit, test-recipes, train-verify-net
```

### Conventions

- **No build step for CSS/JS.** Plain files served as-is; no bundler, Tailwind or Sass.
- **Theming is CSS custom properties only.** Define every color on bare `:root`, redefine it under
  `@media (prefers-color-scheme: dark)` guarded with `:root:not([data-theme="light"])`, and again under
  `:root[data-theme="dark"]`, or the toggle breaks in one direction.
- **Sim canvases get their size from CSS, never JS.** Each demo is a `.sim-stack` that stretches to its
  panel's height; canvases are absolutely positioned and JS only sizes the pixel buffer from
  `clientWidth/clientHeight`. Don't set `style.height` from JS: at 2x DPR the buffer feeds back into layout and
  the canvas grows every frame.
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
The page wears the Journal (`style: journal`, see Recipes) with its own rules in a `<style>` block at the bottom of
`swingup.md`: § marks in the panel, Manual / AI as words, a ruled target table. Its canvases read tokens off `<html>`, not
`body`, so that block points the root tokens at the Journal's ink too, with a second ink (red) for the lower bob and
negative activations.

### The footer cat (`assets/js/cat.js`)

30 s after load an orange tabby walks in along the footer line, washes, yawns and curls up above the copyright
with its tail wrapped round its front, and stays there asleep for good (the last act is `sleepAct(Infinity)`). Hover gives
content `^` eyes, a click a slow blink and a heart, and stroking (the pointer back and forth over it) kneading paws (`KNEAD`).
It purrs only after a click, for `PURR` seconds: the canvas buzzes by one screen pixel (a CSS transform, finer than an art
pixel). On its way in, a click stops it to look round at you (`lookAct`) and stroking sits it down to knead (`petAct`); both
`interrupt` the timeline, and a walk then carries on to where it was going. The sprite acts are `busy` and ignore it. The hit box follows the drawn pixels. It is pixel art (2 px per art pixel, a 48 px lane) drawn from a **rig** (body, head, two-bone IK legs, a tail
chain) posed by a timeline of acts; each frame is drawn 4x fine on an offscreen canvas and every art pixel takes the
majority palette color of its block, so it stays crisp. Eye (a dark pupil with a greenish-yellow `--eye` iris behind it) and nose are stamped as exact pixels, and the forehead stripes stay clear of the eye so they never read as a second one; curling up and sleeping
are hand-drawn letter-grid sprites (`CURL1`, `CURL2`, `SLEEP_IN`, `SLEEP_OUT`). It draws at 15 fps and its clock only runs
while the footer is on screen; reduced motion shows it asleep. It carries on across pages: the clock and the wait so far are
kept in `localStorage` (`footer-cat`) on `pagehide`, for 30 minutes, and the next page jumps the timeline to that clock. Coat colors are CSS variables on `.cat-lane` in main.css. A page can give it a hat: `cat_hat: baker` in its front matter puts `data-cat-hat` on `<body>` and cat.js
stamps that glyph from `HATS` on its head, rig and sleeping sprite alike (/recipes/ wears a baker's toque; `--hat`, `--hat-shade`, `--hat-edge`).

### Recipes (`/recipes/`)

The page has its own look, **the Journal** (`assets/css/journal.css`, loaded with Newsreader and Geist Mono by the
default layout when the front matter says `style: journal`): ink on paper, a serif for everything you read and mono only
for marginalia (§ marks, numbers, amounts, labels), hairline rules instead of cards, and one ink colour (ultramarine)
for what you act on. Choices are words, not keys: serif, greyed until chosen, the chosen one underlined like a link
(`.journal .sim-tab`); don't bring back boxed buttons, which read as the nrf-controller dashboard. It re-points the site's tokens on `body`, so the nav and footer turn to paper too; keep
its colors in journal.css, defined three times like main.css. The recipes index is a numbered list of `[data-recipe]`
buttons, ingredients and notes sit beside the steps, and the page prints as just the open recipe (`.j-print-hide`).
`recipes.md` + `assets/js/recipes.js`, all content in `_data/recipes.yml` (the file's header comment documents the fields). **Every amount
is a weight in grams**, so each recipe runs on a kitchen scale (eggs, cream and water included); `RecipeCore` shows ounces, pounds and
°F when the visitor picks imperial. Steps are plain strings with `[[...]]` tokens (`[[i:id]]` an ingredient's amount, `[[g:700]]`,
`[[t:175]]` or `[[t:22-26]]`, `[[len:20]]`, `[[ml:175]]`); never write a unit into a step by hand. The visitor can **scale** each recipe
(½×, 1×, 2× or any factor): ingredients, `spoon` measures, `[[i:...]]`, counts `[[n:4]]` and `[[gx:340]]`/`[[mlx:4000]]` multiply, while
`[[g:]]`, `[[ml:]]`, `[[t:]]` and `[[len:]]` are per piece (a dough ball, a ramekin, the oven) and stay put, so pick the token by which it is.
Ingredients and steps each get a tick box, and the ticks, the unit choice and each recipe's scale live in `localStorage`. A recipe is its `id` in the URL hash, and the nav dropdown (built from the
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
It is its own page, not a lab lesson, so it has a goal, an explanation and tasks but no predict or check cards. `script/test-fit`
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
  `script/test-data` compares exact basenames to catch it.
- **External links aren't checked** (`--disable-external`) on purpose, so a typo'd external URL won't be caught.

### The nrf-controller dashboard (`/dashboard/`)

`dashboard/` is a copy of `tools/dashboard/` from the private nrf-controller repo, written by `task
publish-dashboard` there (it replaces the whole folder). **Never edit it here**: change it in
nrf-controller and publish again. It is a standalone Web Bluetooth page with its own look, outside the
site's layouts (no front matter, so Jekyll copies it as-is).

## When editing, don't

- Reintroduce theme boilerplate (`_sass/`, a gemspec, `docs/`, bundled font files).
- Hardcode a project into a page's HTML.
- Add a JS dependency for something 20 lines of vanilla JS already does in `site.js`.
