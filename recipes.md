---
layout: default
cat_hat: baker
title: Recipes
description: Kombucha, hummingbird cake, crème brûlée and pizza dough, weighed on a kitchen scale, with a tick box for every ingredient and every step and a switch between metric and imperial.
permalink: /recipes/
style: journal
---
<div class="journal" data-view="index">
<header class="wrap j-mast j-print-hide">
  <h1 class="j-title">Recipes</h1>
  <p class="j-standfirst">A few of my favorites, written up to be easy to cook from. Everything is weighed on a kitchen scale, so you can scale a batch up or down, switch to imperial, and tick off each ingredient and step as you go.</p>
</header>

<div class="wrap rc-page">
  {%- for r in site.data.recipes %}<span class="rc-anchor" id="{{ r.id }}"></span>{% endfor %}
  <a class="rc-back j-print-hide" href="{{ '/recipes/' | relative_url }}">← All recipes</a>
  <div class="rc-index j-print-hide" role="group" aria-label="Recipe">
  <ol class="j-index">
    {%- for r in site.data.recipes %}
    <li><button class="j-index-row" type="button" data-recipe="{{ r.id }}" aria-pressed="false">
      <span class="j-index-no">{% if forloop.index < 10 %}0{% endif %}{{ forloop.index }}</span>
      <span class="j-index-name">{{ r.name }}</span>
      <span class="j-index-blurb">{{ r.blurb }}</span>
      <span class="j-index-meta" data-meta="{{ r.id }}"></span>
      <svg class="j-index-arrow" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2 8h11M9 4l4 4-4 4"/></svg>
    </button></li>
    {%- endfor %}
  </ol>
  </div>

  <div class="rc-bar j-print-hide">
    <div class="rc-seg" role="group" aria-label="Scale">
      <span class="j-label">Scale</span>
      <button class="sim-tab" type="button" data-scale="0.5" aria-pressed="false">½×</button>
      <button class="sim-tab" type="button" data-scale="1" aria-pressed="true">1×</button>
      <button class="sim-tab" type="button" data-scale="2" aria-pressed="false">2×</button>
      <label class="rc-x">×<input id="rc-scale" type="number" min="0.25" max="100" step="0.25" value="1" inputmode="decimal" aria-label="Scale by"></label>
    </div>
    <div class="rc-seg" role="group" aria-label="Units">
      <span class="j-label">Units</span>
      <button class="sim-tab" type="button" data-unit="metric" aria-pressed="true">Metric</button>
      <button class="sim-tab" type="button" data-unit="imperial" aria-pressed="false">Imperial</button>
    </div>
    <button class="sim-tab rc-clear" type="button">Clear ticks</button>
  </div>

  <div id="rc-view" aria-live="off"><noscript><p>The recipes need JavaScript to switch units and keep your ticks.</p></noscript></div>
</div>
</div>

<script type="application/json" id="rc-data">{{ site.data.recipes | jsonify }}</script>

<style>
.rc-anchor{display:block;height:0;scroll-margin-top:5rem}   /* targets of the nav dropdown links (html-proofer checks them) */
/* /recipes/ is the index; /recipes/#id is that recipe alone. recipes.js sets data-view. */
.journal[data-view="index"] .rc-back,.journal[data-view="index"] .rc-bar,.journal[data-view="index"] #rc-view,
.journal[data-view="recipe"] .j-mast,.journal[data-view="recipe"] .rc-index{display:none}
.rc-back{display:inline-block;margin-top:2.5rem;font:.75rem var(--j-mono);letter-spacing:.04em;color:var(--ink-muted);text-decoration:none}
.rc-back:hover{color:var(--ink-accent)}
.rc-page{padding-bottom:4rem}
.rc-index{margin-top:2.5rem;border-top:1px solid var(--ink)}
.j-index-meta{grid-column:3;display:flex;flex-wrap:wrap;gap:.1rem 1.25rem;font:.72rem var(--j-mono);color:var(--ink-muted)}
.j-index-meta:empty{display:none}
.j-index-arrow{grid-column:4;grid-row:1 / span 2}
.j-index-meta .rc-val,.rc-meta .rc-val{font-size:inherit}
.rc-bar{grid-area:bar;display:flex;flex-wrap:wrap;gap:.75rem 2.5rem;align-items:center;justify-content:space-between;margin:0 0 3rem;padding:.75rem 0;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule)}
.rc-seg{display:flex;flex-wrap:wrap;gap:0 .35rem;align-items:baseline}
.rc-seg .j-label{margin-right:.6rem}
.rc-x{display:flex;align-items:baseline;gap:.15rem;margin-left:.45rem;font:italic 1.2rem var(--j-serif);color:var(--ink-muted)}
.rc-x input{width:3.2rem;height:2rem;padding:0 .1rem;border:0;border-bottom:1px solid var(--ink-muted);border-radius:0;background:transparent;color:var(--ink);font:1.2rem var(--j-serif);text-align:center;-moz-appearance:textfield}
.rc-x input::-webkit-inner-spin-button,.rc-x input::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
.rc-x input:focus{outline:none;border-bottom:1.5px solid var(--ink-accent)}

/* The open recipe: its head across the top, ingredients and notes in the narrow column, steps beside them. */
#rc-view{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);grid-template-areas:"head head" "bar bar" "ing steps" "notes steps" "pager pager";grid-template-rows:auto auto auto 1fr auto;gap:0 4rem;align-items:start;counter-reset:rc-sec}
#rc-view{margin-top:1.75rem}
.rc-head{grid-area:head;margin-bottom:2rem}
.rc-sec[data-sec="ing"]{grid-area:ing}
.rc-sec[data-sec="step"]{grid-area:steps}
.rc-sec.rc-notes-sec{grid-area:notes}
.journal .rc-clear{font-style:italic;font-size:1.05rem;color:var(--ink-2);text-decoration-color:var(--ink-accent)}
.rc-pager{grid-area:pager;display:grid;grid-template-columns:1fr auto 1fr;gap:1rem;align-items:baseline;margin-top:1.5rem;padding-top:1.25rem;border-top:1px solid var(--ink)}
.rc-pager a{color:var(--ink-2);text-decoration:none;font-size:1.25rem;line-height:1.3}
.rc-pager a:hover{color:var(--ink-accent)}
.rc-pager .j-label{display:block;margin-bottom:.2rem}
.rc-pager > *{grid-row:1}
.rc-pager .rc-prev{grid-column:1}
.rc-pager .rc-next{grid-column:3;text-align:right}
.rc-pager .rc-all{grid-column:2;font:.75rem var(--j-mono);letter-spacing:.04em;color:var(--ink-muted)}
.rc-kicker{margin:0 0 .75rem}
.rc-head h2{margin:0 0 .75rem;font-size:clamp(2.4rem,5vw,3.6rem);line-height:1.04;font-weight:380;letter-spacing:-.022em;font-variation-settings:"opsz" 72}
.rc-blurb{margin:0 0 1rem;max-width:34em;font-size:1.25rem;line-height:1.5;font-style:italic;color:var(--ink-2)}
.rc-meta{display:flex;flex-wrap:wrap;gap:.25rem 1.5rem;margin:0;font:.75rem var(--j-mono);color:var(--ink-muted)}
.rc-scaled{color:var(--ink-accent)}
.rc-sec{margin-bottom:2.5rem;counter-increment:rc-sec}
.rc-sec h3{display:flex;align-items:baseline;gap:.9rem;margin:0 0 .75rem;padding-bottom:.6rem;border-bottom:1px solid var(--ink);font-size:1.75rem;line-height:1.1}
.rc-sec h3::before{content:"§ " counter(rc-sec);font:.8rem var(--j-mono);letter-spacing:0;color:var(--ink-accent)}
.rc-count{margin-left:auto;font:.72rem var(--j-mono);letter-spacing:0;color:var(--ink-muted)}
.rc-tip{margin:0 0 .75rem;font-size:.98rem;line-height:1.5;font-style:italic;color:var(--ink-2)}
.rc-group{margin:1.5rem 0 .2rem;font:400 .72rem var(--j-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-muted)}
.rc-list{list-style:none;margin:0;padding:0}
.rc-row{display:grid;grid-template-columns:1rem 4.6rem minmax(0,1fr);gap:.2rem .9rem;align-items:baseline;padding:.6rem 0;border-bottom:1px solid var(--rule);cursor:pointer}
.rc-step{grid-template-columns:1rem 1.75rem minmax(0,1fr);padding:.85rem 0}
.rc-row input{align-self:start;transform:translateY(.3rem)}
.rc-amt{font:500 .8rem var(--j-mono);text-align:right;white-space:nowrap}
.rc-name{font-size:1.08rem;line-height:1.4}
.rc-n{font-size:1.5rem;line-height:1;color:var(--ink-accent);font-variation-settings:"opsz" 48}
.rc-text{font-size:1.15rem;line-height:1.6}
.rc-note{font-size:.95rem;font-style:italic;color:var(--ink-muted)}
.rc-val{font-family:var(--j-mono);font-size:.8em;white-space:nowrap}
.rc-row input:checked ~ span{color:var(--ink-muted)}
.rc-row input:checked ~ .rc-name,.rc-row input:checked ~ .rc-text{text-decoration:line-through;text-decoration-color:var(--ink-accent);text-decoration-thickness:1.5px}
.rc-notes{list-style:none;margin:0;padding:0;font-size:1rem;line-height:1.55;color:var(--ink-2)}
.rc-notes li{padding:.6rem 0;border-bottom:1px solid var(--rule)}
@media (max-width:820px){
  #rc-view{grid-template-columns:minmax(0,1fr);grid-template-areas:"head" "bar" "ing" "steps" "notes" "pager";grid-template-rows:none}
  .rc-pager{grid-template-columns:1fr 1fr}
  .rc-pager .rc-all{display:none}
  .rc-pager .rc-next{grid-column:2}
  .j-index-meta{grid-column:2 / 3}
  .j-index-row{grid-template-columns:2.25rem minmax(0,1fr) 1.1rem;gap:.2rem .75rem}
  .j-index-blurb{grid-column:2 / 3}
  .j-index-arrow{grid-column:3;grid-row:1}
}
@media (max-width:520px){.rc-row{grid-template-columns:1rem 4rem minmax(0,1fr)}.rc-step{grid-template-columns:1rem 1.4rem minmax(0,1fr)}}
@media (pointer:coarse){.rc-row{padding-block:.85rem}}
@media print{#rc-view{grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:0 2.5rem}.rc-head{margin-bottom:1.5rem}.rc-row{grid-template-columns:4.6rem minmax(0,1fr)}.rc-step{grid-template-columns:1.75rem minmax(0,1fr)}.rc-row input:checked ~ span{color:inherit}.rc-row input:checked ~ .rc-name,.rc-row input:checked ~ .rc-text{text-decoration:none}}
</style>
<script src="{{ '/assets/js/recipes.js' | relative_url }}?v={{ site.time | date: '%s' }}"></script>
