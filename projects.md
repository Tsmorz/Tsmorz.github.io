---
layout: default
title: Projects
description: Robotics, aerospace, and software projects — from CV research work to weekend builds.
permalink: /projects/
---

<section class="wrap page-head">
  <h1 class="page-title">Projects</h1>
  <p class="page-sub">
    A few things I've built — research work and weekend projects alike.
    Anything marked <em>On my CV</em> is formal work; the rest is what I do for fun.
  </p>
</section>

{%- assign visible_projects = site.data.projects | where: "featured", true -%}

<section class="wrap section" style="padding-top: 0;">
  <div class="section-head"><h2>By topic</h2></div>
  {% include topic-chart.html projects=visible_projects %}
</section>

<section class="wrap section" style="padding-top: 1rem;">
  {%- assign tag_str = "" -%}
  {%- for project in visible_projects -%}
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
    {%- for project in visible_projects %}{% include project-card.html project=project %}{% endfor %}
  </div>
</section>
