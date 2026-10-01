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
<div class="photo-row">
    <img style="--r: 1.351" src="{{ '/assets/img/about/bike-aerobar-cad.png' | relative_url }}" alt="CAD model of a bike aerobar I designed" loading="lazy">
    <img style="--r: 0.75" src="{{ '/assets/img/about/aerobar-bike-front.jpg' | relative_url }}" alt="Front view of the aerobar mounted on my bike" loading="lazy">
    <img style="--r: 0.667" src="{{ '/assets/img/about/aerobar-bike-deer.jpg' | relative_url }}" alt="My bike with the aerobar, parked at a fence with deer behind it" loading="lazy">
  </div>
  <p class="about-caption">In 2020 I designed, built, and raced on custom hardware for my bike. Modern aerodynamic
  road handlebars aren't round, so they can't accept standard clamp-on aerobars, and I needed
  something purpose-built. Aerobars give a big advantage in the moments that decide a race, so
  I knew the effort would be worthwhile. The design was inspired by an earlier product from
  Oval Concepts. It worked well for racing, but fatigue testing showed the bolts would fail
  too early for it to ever become a product.</p>
  <p><a href="https://cad.onshape.com/documents/7ba426488dc4cee808e2ab41/w/6d04e286156affca42996beb/e/86fb2f0a3aa78e48a1cfdd21?renderMode=0&amp;uiState=6abe3bc36909f7bf5121492c">View the aerobars in Onshape &rarr;</a></p>
</section>
