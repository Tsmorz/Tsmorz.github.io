# frozen_string_literal: true

source "https://rubygems.org"

# Matches the GitHub Pages build environment, so `bundle exec jekyll serve`
# locally renders the same site that gets deployed.
gem "github-pages", group: :jekyll_plugins

group :jekyll_plugins do
  gem "jekyll-seo-tag"
  gem "jekyll-sitemap"
end

# Link/accessibility checking in CI.
gem "html-proofer", "~> 5.0", group: :test

gem "webrick", "~> 1.8"
