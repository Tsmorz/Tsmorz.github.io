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
| Name, bio links, CV button | `_config.yml` |
| Bio prose, education timeline | `about.md` |
| Hero headline / intro paragraph | `index.html` |
| Colors, spacing, type | `assets/css/main.css` (tokens at the top) |
| Swing-up network or its physics | re-run `task export-web` in `../n-cartpole` (never hand-edit `assets/models/`) |

**Adding a project:** append to `_data/projects.yml`. Only `name` and `blurb` are required; `tags` feed the
filter buttons on `/projects/`, `featured: true` is what lists it there, `on_cv: true` adds the badge, `image`
is optional (16:9), and the **first** entry in `links` is what the card title links to.

## Architecture

```
_config.yml              site metadata + author/social; blank `cv_url` and `social.scholar` hide their UI
_data/*.yml              all page content that repeats
_layouts/                default (nav, theme toggle, footer) and page (+ title header, .prose)
_includes/               project-card, learning-path, lab: take params, not globals
assets/css/main.css      hand-written, token-based, no build step
assets/js/site.js        theme toggle, tag filter
assets/js/statebox.js    `drawStateBox`: the state/units panel shared by the lab and swingup.js (load first)
assets/js/swingup.js     /controls/swingup/: double cart-pole + goal-conditioned TQC policy in vanilla JS
assets/js/lab/           the lab template behind every /controls/ page except swingup
assets/models/           swingup-tqc.{json,bin} from n-cartpole; the fixture is test-only
script/                  serve, check, test-data, test-swingup, test-lab, train-verify-net
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
The dynamics are a line-for-line port of `n_cartpole/env/dynamics.py`. The ~2 MB weights load only when a
visitor first picks TQC. `script/test-swingup` guards the port (JS vs torch actions, JS vs Python trajectory,
closed-loop runs of every transition); if it fails after a re-export, the port has drifted.

### The learning path

`_data/learning_path.yml` lists the controls pages in reading order with `needs` (step ids).
`_includes/learning-path.html` draws it as a strip on the swing-up page; `_includes/lab.html` uses it for
"You'll need:" on a page's first tab and "Next:" on its last. **A new controls page must be added there.**

### The lab template (`/controls/` and `/controls/stability|sysid|estimation|discrete|design|modern/`)

These pages share one engine; a page differs only in its data. **To add or change one, edit
`_data/labs/<page>.yml`, not code.** `<page>.md` has `lab: <page>`, a title, a short intro, and
`{% include lab.html %}`. The YAML has `labs` (a plant from `lab-plants.js`, a controller, and optional
`params`, `model`, `gains`, `refs`, `cbf`, `net`, `requirements`, `sysid`, `limit`) and `tabs` (`lab`, a view
for each of `top`, `row1`, `row2`, the panel `controls`, and a short `note` in HTML with root-relative links).
Tabs may share a lab. Each tab deep-links as `#<tab id>`, and hidden tabs skip physics and drawing.

- `lab-plants.js`: one entry per sim (mass-spring, tilt table, cart-pole, aircraft): constants, `deriv`,
  limits, actuator slew, failure `status`, supported controllers, what a Manual drag means, state-plot lanes,
  and `draw`. The aircraft's trim is solved numerically.
- `lab-core.js` (no DOM): linearisation, the closed loop as one state-space model (so loop gain, root locus
  and pole placement are linear algebra), margins, Nyquist counting with delay, Padé poles, the CBF filter,
  interval bounds on the small net, ARX identification (instrumental variables), Ho–Kalman, and the simulator.
- `lab.js`: the views and panel controls, listed at the top of the file. The /controls/ demos start in Manual
  and track a Wave | Step reference; noise goes on measurements, never the force.
- `lab-flight-render.js`: the flight sprite, trees and clouds.

Other notes:

- **Estimation** uses the cart-pole's `lqg` controller (measures x and θ only, LQR on an estimate by
  differencing or a Kalman filter); margins, Nyquist and poles include the filter.
- **Discretisation:** a lab's `ctrlPeriod` runs the controller once per period with a zero-order hold.
- **System ID** keeps two methods, least squares (ARX) and Ho–Kalman (ERA), plus a tab to record your own
  data. Both read m, c, k at order 2 or more (the slowest oscillating pole pair plus the DC gain, flagged
  `reduced` above order 2); order 1 reads nothing.
- The ω slider on closed-loop tabs has a "Shake the sim" toggle that adds a sine at ω to input 0.
- `predict: {question, options, answer (0-based), try, explain}` on any tab adds a "Predict first" card.
- `script/test-data` checks every prediction is well formed.
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

## When editing, don't

- Reintroduce theme boilerplate (`_sass/`, a gemspec, `docs/`, bundled font files).
- Hardcode a project into a page's HTML.
- Add a JS dependency for something 20 lines of vanilla JS already does in `site.js`.
