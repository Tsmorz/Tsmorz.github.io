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
  <div class="card-grid">
    {%- for project in visible_projects %}{% include project-card.html project=project %}{% endfor %}
  </div>
</section>

<section class="wrap section" style="padding-top: 0;">
  <h2>Hardware design</h2>
  <p>Software is most of what I do, but not all of it. When a project needs a physical part
  that doesn't exist yet, I design it — modelling in CAD, iterating on the geometry, and
  fabricating the result to test it in the real world. The most satisfying hardware is the
  kind I get to put through its paces myself.</p>

  <figure class="about-figure">
    <img src="{{ '/assets/img/about/bike-aerobar-cad.png' | relative_url }}" alt="CAD model of a bike aerobar I designed">
    <figcaption>A bike aerobar I designed in CAD. I raced it through my 2020 professional
    season and used it to take top finishes on the World Cup circuit.</figcaption>
  </figure>
</section>
