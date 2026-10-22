---
layout: default
cat_hat: baker
title: Recipes
description: Kombucha, hummingbird cake, crème brûlée and pizza dough, weighed on a kitchen scale, with a tick box for every ingredient and every step and a switch between metric and imperial.
permalink: /recipes/
---
<section class="wrap page-head">
  <h1 class="page-title">Recipes</h1>
  <p class="page-sub">Everything is weighed, not measured. Scale a recipe up or down, tick the ingredients as they go on the scale, then the steps as you finish them.</p>
</section>

<div class="wrap" style="padding-bottom:3rem">
  {%- for r in site.data.recipes %}<span class="rc-anchor" id="{{ r.id }}"></span>{% endfor %}
  <div class="rc-bar">
    <div class="rc-seg" role="group" aria-label="Recipe">
      {%- for r in site.data.recipes %}
      <button class="sim-tab" type="button" data-recipe="{{ r.id }}" aria-pressed="false">{{ r.name }}</button>
      {%- endfor %}
    </div>
    <div class="rc-opts">
    <div class="rc-seg" role="group" aria-label="Scale">
      <button class="sim-tab" type="button" data-scale="0.5" aria-pressed="false">½×</button>
      <button class="sim-tab" type="button" data-scale="1" aria-pressed="true">1×</button>
      <button class="sim-tab" type="button" data-scale="2" aria-pressed="false">2×</button>
      <label class="rc-x">×<input id="rc-scale" type="number" min="0.25" max="100" step="0.25" value="1" inputmode="decimal" aria-label="Scale by"></label>
    </div>
    <div class="rc-seg" role="group" aria-label="Units">
      <button class="sim-tab" type="button" data-unit="metric" aria-pressed="true">Metric</button>
      <button class="sim-tab" type="button" data-unit="imperial" aria-pressed="false">Imperial</button>
    </div>
    </div>
  </div>

  <div id="rc-view" aria-live="off"><noscript><p>The recipes need JavaScript to switch units and keep your ticks.</p></noscript></div>
</div>

<script type="application/json" id="rc-data">{{ site.data.recipes | jsonify }}</script>

<style>
.rc-anchor{display:block;height:0;scroll-margin-top:5rem}   /* targets of the nav dropdown links: the page scrolls to the tabs under the sticky header */
.rc-bar{display:flex;flex-wrap:wrap;gap:.75rem 2rem;align-items:center;justify-content:space-between;margin-bottom:2rem}
.rc-opts{display:flex;flex-wrap:wrap;gap:.75rem 1.5rem}
.rc-seg{display:flex;flex-wrap:wrap;gap:.4rem;align-items:center}
.rc-x{display:flex;align-items:center;gap:.3rem;margin-left:.2rem;font:500 .85rem var(--mono);color:var(--text-muted)}
.rc-x input{width:4.5rem;padding:.4rem .5rem;border:1px solid var(--border);border-radius:3px;background:var(--surface);color:var(--text);font:500 .9rem var(--mono)}
.rc-x input:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:var(--accent)}
.rc-scaled{color:var(--accent)}
.rc-head h2{margin:0 0 .3rem}
.rc-blurb{margin:0 0 .6rem;color:var(--text-muted);max-width:60ch}
.rc-meta{display:flex;flex-wrap:wrap;gap:.25rem 1.5rem;margin:0;font:.78rem var(--mono);color:var(--text-muted)}
.rc-sec{margin-top:2rem;max-width:46rem}
.rc-sec h3{display:flex;align-items:baseline;justify-content:space-between;gap:1rem;margin:0 0 .6rem;padding-bottom:.4rem;border-bottom:1px solid var(--border-strong);font:600 .72rem var(--mono);letter-spacing:.04em;text-transform:uppercase;color:var(--accent)}
.rc-count{font-weight:400;color:var(--text-muted)}
.rc-tip{margin:0 0 .6rem;font-size:.88rem;color:var(--text-muted)}
.rc-group{margin:1.1rem 0 .1rem;font:600 .8rem var(--mono);color:var(--text)}
.rc-list{list-style:none;margin:0;padding:0}
.rc-row{display:grid;grid-template-columns:auto 6.5rem minmax(0,1fr);gap:.2rem .8rem;align-items:baseline;padding:.6rem .25rem;border-bottom:1px solid var(--border);cursor:pointer}
.rc-step{grid-template-columns:auto 1.4rem minmax(0,1fr)}
.rc-row input{width:1.1rem;height:1.1rem;margin:0;align-self:start;transform:translateY(.2rem);cursor:pointer}
.rc-amt{font:500 .85rem var(--mono)}
.rc-n{font:600 .75rem var(--mono);color:var(--text-muted)}
.rc-note{font-size:.85rem;color:var(--text-muted)}
.rc-val{font-family:var(--mono);font-size:.9em;white-space:nowrap}
.rc-row input:checked ~ span{color:var(--text-muted)}
.rc-row input:checked ~ .rc-name,.rc-row input:checked ~ .rc-text{text-decoration:line-through;text-decoration-color:var(--lime)}
.rc-notes{margin:0;padding-left:1.2rem;font-size:.9rem;color:var(--text-muted)}
.rc-clear{margin-top:1.75rem}
@media (max-width:520px){.rc-row{grid-template-columns:auto 5.2rem minmax(0,1fr)}.rc-step{grid-template-columns:auto 1.2rem minmax(0,1fr)}}
@media (pointer:coarse){.rc-row{padding-block:.8rem}}
</style>
<script src="{{ '/assets/js/recipes.js' | relative_url }}?v={{ site.time | date: '%s' }}"></script>
