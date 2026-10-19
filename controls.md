---
layout: default
title: Controls
description: Interactive control-systems demos - tune PID controllers on a mass-spring, tilt table, and flight sim, and state-feedback (LQR) gains on a cart-pole.
permalink: /controls/
lab: controls
---
<section class="wrap page-head">
  <h1 class="page-title">Control Systems</h1>
  <p class="page-sub controls-intro">
    One problem, taken all the way through: a mass on a spring. Each lesson follows the same five steps (arrive, reactivate, inform,
    process, evaluate), and some of the ideas then return on a tilt table, an aircraft and a cart-pole. Past what these can do,
    <a href="{{ '/controls/swingup/' | relative_url }}">control a double pendulum</a>, or
    <a href="{{ '/controls/fit/' | relative_url }}">upload your own recording</a> to fit a model and design an LQR for it.
  </p>
</section>

{% include lab.html %}
