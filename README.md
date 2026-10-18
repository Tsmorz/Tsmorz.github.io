# tsmorz.github.io

My personal site: projects, interactive controls demos, and how to reach me.
Live at **[https://tsmorz.github.io](https://tsmorz.github.io)**.

A small custom Jekyll site: no theme gem, no bundler for CSS/JS, no CSS framework. The design is
`_layouts/`, `assets/css/main.css` and vanilla JS in `assets/js/`.

## Setup

You need:

- **Ruby ≥ 2.7** (the macOS system Ruby is too old: `brew install ruby@3.3` and put it first on `PATH`)
- **[Task](https://taskfile.dev)** (`brew install go-task`)
- **Node** (for the JS checks)

Then `task install` once.

## Everyday commands

Run `task` (or `task --list`) to see them all.

| Command | What it does |
| --- | --- |
| `task serve` | Run the site at <http://127.0.0.1:4000> with live reload. Extra flags go after `--`, e.g. `task serve -- --port 4001`. |
| `task check:fast` | Quick checks with no build (a few seconds): `_data` content, swing-up port, lab maths. |
| `task check` | Everything CI runs: the quick checks, then build, JS references and internal links. Run it before you push. |
| `task build` | Build into `_site/`. For a subpath: `task build BASEURL=/subpath`. |
| `task clean` | Remove `_site/` and the Jekyll cache. |
| `task check:data` / `check:swingup` / `check:lab` / `check:js` / `check:links` | One check on its own. |

`script/serve` and `script/check` do the same as `task serve` and `task check`.

To change what a task does, edit [Taskfile.yml](Taskfile.yml). It is the one place the build and checks are
defined; CI calls the same tasks, so a change there applies to both.

## Where to edit what

Content lives in `_data/` and a few pages, not in HTML.

| To change | Edit |
| --- | --- |
| A project | `_data/projects.yml` (`featured: true` lists it on /projects/, `on_cv: true` badges it, `tags` make the filter buttons) |
| Name, bio links, CV button | `_config.yml` |
| Bio and education timeline | `about.md` |
| Home page headline and intro | `index.html` |
| Colors, spacing, type | `assets/css/main.css` (tokens at the top) |
| A controls demo | `_data/labs/controls.yml` |
| System ID, sampling, design, modern methods pages | `_data/labs/<page>.yml` |
| Order of the controls pages | `_data/learning_path.yml` |

### Editing a controls demo

Each tab in `_data/labs/controls.yml` follows the five ARIVA steps, and `task check:fast` fails if one is missing:

| Step | Field | What it is |
| --- | --- | --- |
| Arrive | `goal` | One sentence above the sim |
| Reactivate | `predict` | A prediction card under the sim |
| Inform | `note` | A short explanation (HTML) |
| Process | `tasks` | A numbered list of things to do in the sim |
| Evaluate | `check` | A closing multiple-choice question |

After any edit, run `task check:fast`, then `task serve` to look at it.

## Deployment

Pushes to `main` build and deploy through [`.github/workflows/pages.yml`](.github/workflows/pages.yml);
pull requests build and run the checks without deploying. In the repo settings, **Pages → Source** must be
**GitHub Actions**.

See [CLAUDE.md](CLAUDE.md) for the full field reference, conventions and architecture.

## License

Site content © Tony Smoragiewicz. The original theme this site grew out
of, `jekyll-theme-minimal`, is CC0; see [LICENSE](LICENSE).
