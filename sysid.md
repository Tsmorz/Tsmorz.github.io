---
layout: default
title: System Identification
description: Where models come from: push on the mass-spring-damper, record what it does, and fit a model to the data.
permalink: /controls/sysid/
lab: sysid
---
<section class="wrap page-head">
  <h1 class="page-title">System Identification</h1>
  <p class="su-crumb"><a href="{{ '/controls/' | relative_url }}">&#8592; Control Systems</a></p>
  <p class="page-sub controls-intro">
    Every analysis on this site starts from a model: an equation for how the plant moves. On real hardware nobody hands you that equation. You get it by experiment: push on the plant, record what it does, and fit a model to the record. This page does that to the mass-spring-damper from the <a href="{{ '/controls/' | relative_url }}">Intro demo</a>.
  </p>
</section>

{% include lab.html %}
