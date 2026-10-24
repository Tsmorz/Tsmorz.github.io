---
layout: default
title: Projects
description: Robotics, aerospace, and software projects, from research work to weekend builds.
permalink: /projects/
---
<section class="wrap page-head">
  <h1 class="page-title">Projects</h1>
  <p class="page-sub">
    A few things I've built: research work and weekend projects alike.
  </p>
</section>

{%- assign visible_projects = site.data.projects | where: "featured", true -%}

<section class="wrap section" style="padding-top: 0;">
  <div class="card-grid">
    {%- for project in visible_projects %}{% include project-card.html project=project %}{% endfor %}
  </div>
</section>

{%- assign hw = site.data.hardware -%}
<section class="wrap section" id="hardware" style="padding-top: 0;">
  <h2>{{ hw.heading }}</h2>
  <div class="photo-row">
    {%- for ph in hw.photos %}
    <img style="--r: {{ ph.ratio }}" src="{{ ph.src | relative_url }}" alt="{{ ph.alt }}" loading="lazy">
    {%- endfor %}
  </div>
  <p class="about-caption">{{ hw.text | markdownify | remove: '<p>' | remove: '</p>' | strip }}</p>
</section>
