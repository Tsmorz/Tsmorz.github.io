# CLAUDE.md

Guidance for Claude Code (and future me) when editing this repo.

## What this is

Tony Smoragiewicz's personal site — a custom Jekyll site deployed to GitHub Pages at
<https://tsmorz.github.io>. It started as a fork of `jekyll-theme-minimal`; the theme is
gone and the layouts, CSS, and JS here are the whole design. There is no theme gem to
fall back on, so nothing is inherited from outside this repo.

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

### Adding a project

Append a block to `_data/projects.yml`. Only `name` and `blurb` are required:

```yaml
- name: Project Name
  blurb: >-
    One or two sentences. Plain language beats buzzwords.
  year: "2026"
  tags: [Python, Robotics]      # feeds the filter buttons on /projects/ automatically
  featured: true                # shows it on the homepage AND on /projects/ — the projects
                                 # page only lists featured=true, so this is what controls
                                 # who makes the cut, not just what's on top
  on_cv: true                   # renders the "On my CV" badge
  image: /assets/img/projects/foo.jpg   # optional, 16:9 crops best
  links:
    - label: GitHub
      url: https://github.com/Tsmorz/foo
    - label: Paper                      # any label/url pairs work
      url: https://...
```

The **first** link is what the card title links to. Tag filter buttons on `/projects/` are
derived from the union of all `tags` — no separate list to maintain.

### Adding a photo

```sh
script/add-photo "images/DSC_1234.jpg" sunrise-ridge
```

That writes an 1800px web version to `assets/img/photos/<slug>.jpg` and a 700px thumbnail
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

The homepage shows the first 4 entries, so put the strongest shot first.

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
script/                  serve, check, add-photo
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
- **Includes take explicit params** (`{% include project-card.html project=foo %}`), never
  reaching into `site.data` themselves. Keeps them reusable across pages.
- **Liquid on GitHub Pages is Liquid 4.** `uniq`, `concat`, `slice`, and `where` exist;
  `push` does not. Watch out for that when aggregating lists.

## Running and checking

```sh
script/serve    # http://127.0.0.1:4000 with live reload
script/check    # build + html-proofer internal link check (what CI runs)
```

Needs Ruby ≥ 2.7 — **system Ruby on this Mac is 2.6.10 and cannot run Jekyll 4**
(`rouge` requires 2.7+). Use `brew install ruby@3.3` and put it ahead on `PATH`, or rely
on CI to build.

## Deployment

`.github/workflows/pages.yml` builds on every push and PR, runs html-proofer, and deploys
to Pages from `main`. Repo setting required: **Settings → Pages → Source = GitHub Actions**.
Don't re-enable the legacy branch-based Pages build; the two conflict.

## When editing, don't

- Reintroduce theme boilerplate (`_sass/`, a gemspec, `docs/`, bundled font files) — all
  deliberately deleted.
- Hardcode a project or photo into a page's HTML.
- Add a JS dependency for something 20 lines of vanilla JS already does in `site.js`.
