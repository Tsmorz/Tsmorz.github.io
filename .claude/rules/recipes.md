---
paths:
  - "recipes.md"
  - "assets/js/recipes.js"
  - "assets/css/journal.css"
  - "_data/recipes.yml"
  - "script/test-recipes"
---

# Recipes (`/recipes/`)

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
