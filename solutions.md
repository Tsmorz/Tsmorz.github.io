---
layout: default
title: Solutions
description: Project-based robotics, state estimation and controls work for companies.
permalink: /solutions/
---
{%- assign s = site.data.solutions -%}
<section class="wrap page-head">
  <h1 class="page-title">Solutions</h1>
  <p class="page-sub">{{ s.intro }}</p>
</section>

<section class="wrap section" style="padding-top: 0;">
  <div class="card-grid">
    {%- for svc in s.services %}
    <article class="card">
      <h3>{{ svc.name }}</h3>
      <p>{{ svc.blurb }}</p>
    </article>
    {%- endfor %}
  </div>
</section>

<section class="wrap section" style="padding-top: 0;">
  <h2>{{ s.cta.heading }}</h2>
  <p>{{ s.cta.text }}</p>
  <div class="btn-row">
    <a class="btn btn-primary" href="mailto:{{ site.author.email }}?subject={{ s.cta.subject | uri_escape }}">Email me</a>
    <a class="btn" href="{{ site.social.linkedin }}">LinkedIn</a>
    {%- if site.cv_url %}<a class="btn" href="{{ site.cv_url | relative_url }}">Download CV</a>{% endif %}
  </div>
</section>
