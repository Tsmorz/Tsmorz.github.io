# CLAUDE.md

Guidance for Claude Code (and future me) when editing this repo.

## What this is

Tony Smoragiewicz's personal site — a custom Jekyll site deployed to GitHub Pages at
<https://tsmorz.github.io>. It started as a fork of `jekyll-theme-minimal`; the theme is
gone and the layouts, CSS, and JS here are the whole design. There is no theme gem to
fall back on, so nothing is inherited from outside this repo.

## What the controls pages are for

The `/controls/` section should be the clearest way to *see* controls engineering. **Every
piece of theory is explained with a figure or an animation the visitor can drive**, not with
equations alone: a margin is a bar on a plot, a pole is a mark that moves when you drag a gain,
stability is something you watch break. Equations are welcome as labels on a picture, written
out with the visitor's current numbers. When adding a concept, ask what the visitor would drag
to understand it, and build that.

## The one rule: content lives in `_data/`, not in markup

Pages are thin. The projects list and the photo gallery are YAML files rendered through
includes. **To change what the site says, edit YAML — not HTML.**

| Want to change | Edit |
| --- | --- |
| Projects shown anywhere | `_data/projects.yml` |
| Photos in the gallery | `_data/photos.yml` |
| Name, bio links, CV button | `_config.yml` |
| Bio prose, education timeline | `about.md` |
| Hero headline / intro paragraph | `index.html` |
| Colors, spacing, type | `assets/css/main.css` (tokens at the top) |
| Swing-up network or its physics | re-run `task export-web` in `../n-cartpole` (never hand-edit `assets/models/`) |

### Adding a project

Append a block to `_data/projects.yml`. Only `name` and `blurb` are required:

```yaml
- name: Project Name
  blurb: >-
    One or two sentences. Plain language beats buzzwords.
  year: "2026"
  tags: [Python, Robotics]      # feeds the filter buttons on /projects/ automatically
  featured: true                # lists it on /projects/, which only shows featured=true —
                                 # so this is what controls who makes the cut
  on_cv: true                   # renders the "On my CV" badge
  image: /assets/img/projects/foo.jpg   # optional, 16:9 crops best
  links:
    - label: GitHub
      url: https://github.com/Tsmorz/foo
    - label: Paper                      # any label/url pairs work; a site path
      url: https://...                  # like /controls/swingup/ gets relative_url
```

The **first** link is what the card title links to. Tag filter buttons on `/projects/` are
derived from the union of all `tags` — no separate list to maintain.

### Adding a photo

```sh
script/add-photo "images/DSC_1234.jpg" sunrise-ridge
```

That writes a web version (long edge 1800px, never enlarged) to `assets/img/photos/<slug>.jpg` and a 700px thumbnail
to `assets/img/photos/thumbs/<slug>.jpg` (macOS `sips`, or ImageMagick if present). Then
add the block it prints to `_data/photos.yml`:

```yaml
- slug: sunrise-ridge
  title: Sunrise Ridge
  caption: Shown on hover and in the lightbox.
  location: Bavaria, Germany
  year: "2026"
  tall: true      # optional — spans two grid rows, good for portrait shots
```

**Never reference the originals in `images/` from a page.** They are 5–21 MB each and
`_config.yml` excludes that directory from the build. Always go through `script/add-photo`.

The gallery shows entries in file order, so put the strongest shot first.

## Architecture

```
_config.yml              site metadata + author/social; `cv_url` and `social.scholar`
                         are intentionally blank — filling them turns on UI
_data/*.yml              all page content that repeats
_layouts/default.html    shell: nav, theme toggle, footer
_layouts/page.html       default + a title header and .prose wrapper (used by about.md)
_includes/               project-card.html, photo-grid.html — take params, not globals
assets/css/main.css      hand-written, token-based, no build step
assets/js/site.js        three small IIFEs: theme toggle, tag filter, lightbox
assets/js/statebox.js    `drawStateBox`: the lower-right state/units panel (decimal points and
                         units aligned), shared by the lab template and swingup.js; load it first
assets/js/swingup.js     /controls/swingup/ (swingup.md): double cart-pole + goal-conditioned
                         TQC policy in vanilla JS — SwingupCore (no DOM, Node-testable) + the page
assets/js/lab/           the lab template behind every /controls/ page except swingup (see below).
                         Each tab deep-links as #<tab id> (#tilt, #flight, #cartpole); hidden tabs
                         skip physics and drawing. The /controls/ demos start in Manual and track a
                         Wave | Step reference; noise goes on measurements, never on the force
assets/models/           swingup-tqc.{json,bin} exported from n-cartpole; the fixture
                         is test-only and excluded from the build
script/                  serve, check, add-photo, test-data, test-swingup, test-lab,
                         train-verify-net (writes assets/models/verify-net.json)
```

### Conventions worth keeping

- **No build step for CSS/JS.** Plain `.css` and `.js`, served as-is. Don't introduce a
  bundler, Tailwind, or Sass unless there's a real reason — the whole point is that this
  site still builds in five years untouched.
- **Theming is CSS custom properties only.** Every color is a token defined on bare
  `:root`, redefined under `@media (prefers-color-scheme: dark)` guarded with
  `:root:not([data-theme="light"])`, and again under `:root[data-theme="dark"]` so the
  manual toggle wins both ways. If you add a color, define it in all three places or the
  toggle breaks in one direction.
- **Sim canvases get their size from CSS, never JS.** Each demo is a `.sim-stack` (sim on
  top, state plot below, two equal rows) that stretches to its control panel's height;
  `/controls/` tabs share one `min-height` so every sim is the same size. There the bottom
  half is a `.sim-cell-pair`: state plot over PID (control-input) plot, equal rows. Canvases are absolutely positioned in `.sim-cell`s and
  the JS only sizes the pixel buffer from `clientWidth/clientHeight`. Don't set
  `style.height` from JS or give a flex/grid canvas `min-width: auto`: at 2x DPR the
  buffer feeds back into the layout and the canvas grows every frame.
- **Includes take explicit params** (`{% include project-card.html project=foo %}`), never
  reaching into `site.data` themselves. Keeps them reusable across pages.
- **Liquid on GitHub Pages is Liquid 4.** `uniq`, `concat`, `slice`, and `where` exist;
  `push` does not. Watch out for that when aggregating lists.

### The swing-up demo

`/controls/swingup/` runs the goal-conditioned TQC policy from
[n-cartpole](https://github.com/Tsmorz/n-cartpole) (`checkpoints/double/tqc-goal/`) in the
browser: the visitor picks a target pose — UU, UD, DU, DD (one U/D per link, base first) or
Random — and one network drives there from wherever the rig is. The JSON's `goals` block
(labels + target angles) switches that on; the net sees `cos` of each target angle appended
after the 8 kinematic inputs. Without a `goals` block (a plain swing-up export) the page
hides the target column and the target is all-up. The policy only works on the
plant it was trained on, so **`swingup.js` hard-codes no physical constants**: masses, lengths,
friction, dt, force limit, slew, rail length, and the "swung up" tolerances all come from
`assets/models/swingup-tqc.json`, which `task export-web` in n-cartpole writes from the
checkpoint's own config. The one deliberate exception is the rail: `RAIL_HALF` in `swingup.js`
widens it to ±1 m on the page (the net trained on ±0.5 m, so past that it's extrapolating);
random starts stay inside the trained range. `SwingupCore` and the tests use the exported value. The equations of motion are a line-for-line port of
`n_cartpole/env/dynamics.py` (RK4 with dt/4 substeps stands in for its RK45 with
`max_step=dt/4`). The weights (`.bin`, ~2 MB float16, normalizer pre-folded) load only when a
visitor first picks TQC.

`script/test-swingup` (`task check:swingup`, part of `task check`) guards this: JS vs torch
actions (max < 0.2 N — float16 rounding alone reaches ~0.14 N on the goal net — and mean
< 0.01 N), JS vs Python RK45 trajectory, and a closed-loop JS run of every start → goal
transition in the fixture.
If it fails after a re-export, the port in `swingup.js` has drifted from n-cartpole.

### The learning path

`_data/learning_path.yml` lists the controls pages in reading order, each with `needs` (step ids).
`_includes/learning-path.html` draws it as a map (on /controls/) or a strip (top of every other
controls page, swing-up included), and `_includes/lab.html` uses it for "You'll need:" on a page's
first tab and the final "Next:" link on its last tab (other tabs link to the next tab). **A new
controls page must be added there**, or it won't appear in the path.

### The lab template (`/controls/` and `/controls/stability|sysid|estimation|design|modern/`)

These pages share one engine; a page differs only in its data. **To add or change one, edit its
`_data/labs/<page>.yml`, not code.** The pieces:

- `<page>.md`: front matter `lab: <page>`, a title and intro, then `{% include lab.html %}`.
- `_data/labs/<page>.yml`: `labs` (a plant from `lab-plants.js`, a controller key, and optional
  `params` for the simulated plant, `model` for the analysed one, `gains`, `refs`, `cbf`, `net`,
  `requirements`, `sysid`, `limit`) and `tabs` (`lab`, a view for each of `top`, `row1`, `row2`,
  the panel `controls`, and a `note` in HTML; write links root-relative, the include adds the baseurl).
  Tabs may share a lab: the design page walks one lab through six steps.
- `assets/js/lab/lab-plants.js`: one entry per sim (mass-spring, tilt table, cart-pole, aircraft):
  constants, `deriv`, equilibrium, limits, actuator slew (`uRate`), failure `status`, the
  controllers it supports, what a Manual drag means (`manual`), the state-plot lanes (`states`) and
  its `draw` (the original /controls/ pictures). The aircraft's trim is solved numerically (the
  old closed form treated the stall blend as 1; it's ≈ 0.92 at trim, so that "trim" sank and slowed).
- `assets/js/lab/lab-flight-render.js`: the flight sim's sprite, trees and clouds, moved unchanged
  from the old controls.js; `LabPlants.flight.draw` calls it.
- `assets/js/lab/lab-core.js` (LabCore, no DOM): linearisation; the closed loop as one state-space
  model with each gain as a feedback row (so the loop gain, root locus and pole placement are linear
  algebra); margins; a Nyquist count that handles delay and unstable plants; Padé poles; the CBF
  filter; interval bounds on the small net; ARX identification refined with instrumental variables
  (plain least squares is biased by sensor noise); the nonlinear simulator.
- `assets/js/lab/lab.js`: the views and panel controls, listed at the top of the file. The
  /controls/ demos use `mode` (Manual | controller), `hint` (shown after 10 gain adjustments),
  `score` (RMS tracking error and best), `reset`, and the `states` / `contrib` plots. Poles views
  let you drag closed-loop poles (gains are solved) when one input has as many gains as states.

State estimation (`/controls/estimation/`) uses the cart-pole's `lqg` controller: an `obs` channel that
measures only x and θ and runs LQR on an estimate, made by differencing (`estimator: diff`) or a
discrete Kalman filter (`estimator: kalman`; `LabCore.buildEstimator`, trust = process-noise level
`logQ`). For analysis the controller becomes a dynamic system from measurements to force, so
margins, Nyquist and poles all include the filter (the separation principle and Doyle's LQG result).

`script/test-lab` (`task check:lab`, part of `task check`) checks the plants against /controls/,
the textbook margins, Nyquist against eigenvalues, pole placement, the filter, sound network bounds,
that identification recovers the mass-spring, and that every `_data/labs` page only names plants,
views and controls that exist. `assets/models/verify-net.json` is written by
`script/train-verify-net` (seeded; never hand-edit it). 
## Running and checking

```sh
script/serve    # http://127.0.0.1:4000 with live reload
script/check    # build + html-proofer internal link check (what CI runs)
```

Needs Ruby ≥ 2.7 — **system Ruby on this Mac is 2.6.10 and cannot run Jekyll 4**
(`rouge` requires 2.7+). Use `brew install ruby@3.3` and put it ahead on `PATH`, or rely
on CI to build.

`Taskfile.yml` is the single entrypoint (`task --list`: `serve`, `build`, `check`,
`check:data`, `check:swingup`, `check:lab`, `check:js`, `check:links`, `install`, `clean`, `add-photo`). `check:data`
validates `_data/*.yml` — required fields, and that each photo's full-size + thumbnail and
each local project image actually exist (the full-size lives in a `data-full` attribute
that html-proofer never sees, so this is the only thing guarding it). It's pure Ruby
stdlib, no build. The build and the CI checks
are **defined here once** — `script/check` and `.github/workflows/pages.yml` both delegate
to these tasks, so there's no duplicated JS/link-check logic to keep in sync. CI installs
Task and runs `task check BASEURL="${{ steps.pages.outputs.base_path }}"` (data → swingup → lab →
build → JS → links; the swingup check uses the runner's preinstalled Node); that build is the uploaded deploy artifact. `serve` and `add-photo` still wrap
the `script/` files (`task add-photo -- <source-image> <slug>`).

## Deployment

`.github/workflows/pages.yml` builds on every push and PR, runs html-proofer, and deploys
to Pages from `main`. Repo setting required: **Settings → Pages → Source = GitHub Actions**.
Don't re-enable the legacy branch-based Pages build; the two conflict.

### CI gotchas — things that pass locally but fail on the runner

The runner is Linux with no git-inferred repo context; a Mac dev box is neither. Each of
these bit us once; the guard that now prevents it is noted.

- **Always pass `--baseurl` to the build, even when it's empty.** `task build` runs
  `jekyll build --baseurl "{{.BASEURL}}"` unconditionally (empty by default). This matters:
  if you *omit* the flag, `jekyll-github-metadata` (pulled in by the `github-pages` gem)
  tries to *derive* `site.baseurl` from GitHub, which fails on the runner with
  **`No repo name found`**, and if you then force it to resolve (e.g. by setting
  `PAGES_REPO_NWO`) it injects an unwanted `/pages/<owner>` prefix into every URL — which
  then makes html-proofer report every asset as missing. An explicit `--baseurl` sidesteps
  the whole chain, which is why the original workflow always passed it. Don't "simplify" it
  back to a conditional flag. (This bit us: making the flag conditional caused *both* CI
  failures, and `PAGES_REPO_NWO` / `--swap-urls` were wrong patches for a self-inflicted bug.)
- **Case-sensitive filesystem.** macOS is case-insensitive, so `logo.JPG` referenced as
  `logo.jpg` works locally and 404s on Linux. **Guard:** `script/test-data` compares exact
  basenames (not `File.exist?`), so `task check:data` catches wrong-case photo/project
  images before you push.
- **External links are not checked** (`--disable-external`), on purpose — a third-party
  site going down shouldn't fail our deploy. So a typo'd external URL won't be caught here;
  it's the one class of link the pipeline is blind to.

## When editing, don't

- Reintroduce theme boilerplate (`_sass/`, a gemspec, `docs/`, bundled font files) — all
  deliberately deleted.
- Hardcode a project or photo into a page's HTML.
- Add a JS dependency for something 20 lines of vanilla JS already does in `site.js`.
