# AGENTS.md

Guidance for coding agents (Codex, Claude Code) and future me when editing this repo. `CLAUDE.md` only imports this file,
so edit guidance here.

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
| Tag tracker robot tasks, instructions and hints | `_data/tag_tasks.yml` |
| DynaSoar aircraft presets, branding, weather copy and landmarks | `_data/glide.yml` |
| Haptography workspaces, collection guidance, signal controls and presets | `_data/haptography.yml` |
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
assets/js/cat.js         the footer cat: a pixel-art orange tabby that lives on the footer line
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
tag-tracker/, glide-path/, haptography/   self-contained tool pages with their own look (see their guides)
.agents/guides/          area guides for the shared lab pages, swing-up, fit, recipes and the footer cat
script/                  serve, check, test-data, test-installer, test-swingup, test-lab, test-vision, test-embedded, test-fit, test-recipes, test-glide, test-tag-tracker, test-haptography, train-verify-net
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

### Area guides (read the one for the area you work in)

Detail for each subsystem lives next to it, so it isn't in every session's context. **Read the guide before editing
there.**

| Working on | Guide |
| --- | --- |
| `/tag-tracker/` | `tag-tracker/AGENTS.md` |
| `/glide-path/` (DynaSoar) | `glide-path/AGENTS.md` |
| `/haptography/` | `haptography/AGENTS.md` |
| `/controls/`, `/vision/`, `/embedded/` lab template and lessons | `.agents/guides/labs.md` |
| `/controls/swingup/` | `.agents/guides/swingup.md` |
| `/controls/fit/` | `.agents/guides/fit.md` |
| `/recipes/` and the Journal look | `.agents/guides/recipes.md` |
| The footer cat | `.agents/guides/footer-cat.md` |

If you change how an area works, update its guide, not this file. A new guide goes in this table; a guide in
`.agents/guides/` also gets a `paths:` front matter block and a symlink from `.claude/rules/`, which is how Claude Code
loads it automatically for those paths. A guide inside a page folder gets a one-line `CLAUDE.md` beside it (`@AGENTS.md`)
and an entry in `_config.yml`'s `exclude`, or Jekyll publishes it.

**Guides hold rules and gotchas; the commit message holds the story.** Add a line to a guide only when it is something the
code can't say and the next edit could get wrong: a rule ("never hand-edit ..."), a trap and why it bites, a pinned version,
a cross-repo contract, which test guards what. Don't add how a feature works step by step, measured numbers, or history
("used to ..., now ..."): the code, the tests and `git log` already hold those. Name the identifier to search for rather than
describing it. When a guide passes about 150 lines, trim it before adding to it.

## Running and checking

```sh
script/serve    # http://127.0.0.1:4000 with live reload
task check:fast # seconds, no build: data, script versions, every page's maths
task check      # what CI runs: check:fast → build → JS → links
task versions   # after changing a self-contained page's script: its ?v= becomes the file's hash
task shot -- /tag-tracker/ --click '#emptyDemo' --wait 8000   # headless screenshot to .shots/, exits 1 on a page exception
```

**See UI changes yourself**: after changing a page, `task shot` it (`--dark`, `--phone`, `--eval JS`, `--click SEL`; options
at the top of `script/shot`), read the PNG and fix what it shows or throws, instead of asking me to look. Jekyll pages need
`task build` first; self-contained ones don't. Still say what only a real device (camera, Bluetooth, a board) can check.

`.claude/settings.json` allows the usual commands for Claude Code and runs `.claude/hooks/check-js.sh` (`node --check`)
after every edit of a `.js` file, so a syntax error comes back at once. Other agents: run `node --check` on a `.js` file
you edited.

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

## When editing, don't

- Reintroduce theme boilerplate (`_sass/`, a gemspec, `docs/`, bundled font files).
- Hardcode a project into a page's HTML.
- Add a JS dependency for something 20 lines of vanilla JS already does in `site.js`.
- Add a LICENSE: the site is all rights reserved on purpose (README, "License"). Vendored libraries keep their own.
