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
| `task check:fast` | Quick checks with no build (a few seconds): `_data` content, swing-up port, lab math. |
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
| A project | `_data/projects.yml` (`featured: true` lists it on /projects/; `tags` and `on_cv` are kept as data but not shown) |
| Name, bio links, CV button | `_config.yml` |
| Bio and education timeline | `about.md` |
| Home page headline and intro | `index.html` |
| Colors, spacing, type | `assets/css/main.css` (tokens at the top) |
| A controls lesson (every demo and lesson) | `_data/labs/controls.yml` |
| The upload-a-CSV fit page | `fit.md` and `assets/js/fit.js` |

### Editing a controls lesson

`_data/labs/controls.yml` is one course: a running problem (a mass on a spring) taken through every idea, then the same steps on a tilt table, an aircraft and a cart-pole. Teach a new idea on the mass first, then add what changes on the other plants. Every lesson follows the five ARIVA steps, and `task check:fast` fails if one is missing:

| Step | Field | What it is |
| --- | --- | --- |
| Arrive | `goal` | One sentence above the sim |
| Reactivate | `needs`, `recall`, `predict` | The lessons it builds on (ids), a line tying back, and a prediction card before the sim |
| Inform | `note` | A short, folded explanation (HTML); `maths` is an optional "Show the math" |
| Process | `tasks` | A numbered list of things to do in the sim |
| Evaluate | `check`, `recap` | Closing multiple-choice questions (`why` explains each wrong answer) and a "You can now" line |

After any edit, run `task check:fast`, then `task serve` to look at it.

## Deployment

Pushes to `main` build and deploy through [`.github/workflows/pages.yml`](.github/workflows/pages.yml);
pull requests build and run the checks without deploying. In the repo settings, **Pages → Source** must be
**GitHub Actions**.

See [CLAUDE.md](CLAUDE.md) for the full field reference, conventions and architecture.

## License

Site content © Tony Smoragiewicz. The original theme this site grew out
of, `jekyll-theme-minimal`, is CC0; see [LICENSE](LICENSE).
