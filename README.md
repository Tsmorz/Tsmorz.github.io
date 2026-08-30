# tsmorz.github.io

My personal site — projects, photography, and how to reach me.
Live at **<https://tsmorz.github.io>**.

A small custom Jekyll site: no theme gem, no bundler, no CSS framework. The design is
`_layouts/`, `assets/css/main.css`, and about 90 lines of vanilla JS.

## Running it locally

Requires Ruby ≥ 2.7 (macOS system Ruby is too old — `brew install ruby@3.3`).

```sh
script/serve    # http://127.0.0.1:4000, live reload
script/check    # build + internal link check, same as CI
```

## Adding content

Everything that repeats lives in `_data/`:

- **A project** — add a block to `_data/projects.yml`. `featured: true` puts it on the
  homepage; `on_cv: true` badges it as formal work; `tags` feed the filter buttons.
- **A photo** — `script/add-photo <source-image> <slug>` makes the web-sized versions,
  then add a block to `_data/photos.yml`.

See [CLAUDE.md](CLAUDE.md) for the full field reference and conventions.

## Deployment

Pushes to `main` build and deploy through
[`.github/workflows/pages.yml`](.github/workflows/pages.yml); pull requests build and
run the link check without deploying.

## License

Site content and photographs © Tony Smoragiewicz. The original theme this site grew out
of, `jekyll-theme-minimal`, is CC0 — see [LICENSE](LICENSE).
