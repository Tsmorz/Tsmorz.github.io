---
layout: default
title: Solutions
description: Project work for companies whose robots and devices need to sense, locate themselves and move precisely.
permalink: /solutions/
---
{%- assign s = site.data.solutions -%}
<section class="wrap page-head">
  <h1 class="page-title">Solutions</h1>
  <p class="page-sub">{{ s.intro }}</p>
</section>

<section class="wrap section solutions-services">
  <ul class="solution-list">
    {%- for svc in s.services %}
    <li><strong>{{ svc.name }}</strong><span>{{ svc.blurb }}</span>
      {%- if svc.work %}
      <ul class="solution-work" aria-label="Examples">
        {%- for w in svc.work %}
        {%- assign proj = site.data.projects | where: "name", w.project | first -%}
        {%- assign url = w.url | default: proj.links.first.url -%}
        <li><a href="{% if url contains '://' %}{{ url }}{% else %}{{ url | relative_url }}{% endif %}">{{ w.label | default: w.project }}</a></li>
        {%- endfor %}
      </ul>
      {%- endif %}
    </li>
    {%- endfor %}
  </ul>
</section>

{%- if s.process %}
<section class="wrap section solutions-process">
  <h2>{{ s.process.heading }}</h2>
  <ol class="process-list">
    {%- for st in s.process.steps %}<li><strong>{{ st.name }}</strong><span>{{ st.blurb }}</span></li>{% endfor %}
  </ol>
</section>
{%- endif %}

<section class="wrap section solutions-cta">
  <h2>{{ s.cta.heading }}</h2>
  <p>{{ s.cta.text }}</p>
  <div class="btn-row">
    <a class="btn btn-primary" href="mailto:{{ site.author.email }}?subject={{ s.cta.subject | uri_escape }}">Email me</a>
    <a class="btn" href="{{ site.social.linkedin }}">LinkedIn</a>
    {%- if site.cv_url %}<a class="btn" href="{{ site.cv_url | relative_url }}">Download CV</a>{% endif %}
  </div>
</section>
