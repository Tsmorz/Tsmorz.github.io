---
layout: default
title: Discretisation
description: From continuous to discrete - sampling and aliasing, zero-order hold, converting a model with Euler, Tustin and hold methods, and how slow a controller can run.
permalink: /controls/discrete/
lab: discrete
---
<section class="wrap page-head">
  <h1 class="page-title">Discretisation</h1>
  <p class="su-crumb"><a href="{{ '/controls/' | relative_url }}">&#8592; Control Systems</a></p>
  <p class="page-sub controls-intro">
    Real controllers run on a computer: read, compute, hold. See how a signal is <strong>sampled</strong>, how a
    model is discretised (<strong>hold, Euler, Tustin</strong>), and how slowly a controller can run.
  </p>
</section>

{% include lab.html %}
