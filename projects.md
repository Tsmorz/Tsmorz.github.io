---
layout: default
title: Projects
description: Robotics, aerospace, and software projects — from CV research work to weekend builds.
permalink: /projects/
---

<section class="wrap page-head">
  <h1 class="page-title">Projects</h1>
  <p class="page-sub">
    Research work, coursework, and things I built because I wanted them to exist.
    Anything marked <em>On my CV</em> is formal work; the rest is what I do for fun.
  </p>
</section>

<section class="wrap section" style="padding-top: 0;">
  <div class="section-head"><h2>By topic</h2></div>
  {% include topic-chart.html projects=site.data.projects %}
</section>

<section class="wrap section" style="padding-top: 1rem;">
  {%- assign tag_str = "" -%}
  {%- for project in site.data.projects -%}
    {%- assign joined = project.tags | join: "|" -%}
    {%- assign tag_str = tag_str | append: "|" | append: joined -%}
  {%- endfor -%}
  {%- assign all_tags = tag_str | split: "|" | uniq | sort -%}

  <div class="filters">
    <button class="filter" type="button" data-tag="*" aria-pressed="true">All</button>
    {%- for t in all_tags %}{% if t != "" %}
    <button class="filter" type="button" data-tag="{{ t }}" aria-pressed="false">{{ t }}</button>
    {%- endif %}{% endfor %}
  </div>

  <div class="card-grid">
    {%- for project in site.data.projects %}{% include project-card.html project=project %}{% endfor %}
  </div>
</section>
