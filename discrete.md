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
    Everything else on this site is drawn in continuous time, but every real controller runs on a computer: it
    reads its sensors every few milliseconds, computes, and holds its output until the next update. This page,
    on the mass-spring from the <a href="{{ '/controls/' | relative_url }}">Intro demo</a>, shows what that
    changes: how a signal is <strong>sampled</strong> and rebuilt, how a continuous model is turned into a
    step-by-step update (<strong>zero-order hold, Euler, Tustin</strong>), and how slowly a controller can run
    before the loop falls apart.
  </p>
</section>

{% include lab.html %}
