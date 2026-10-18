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
    Four demos, each with a row of lessons: tune a <strong>PID</strong> on a mass-spring, a tilt table and an
    aircraft, or an <strong>LQR</strong> on a cart-pole, then fit a model, sample it, design for requirements,
    keep it safe, and verify it. Every lesson goes arrive, predict, read, try, check. Past what these can do,
    <a href="{{ '/controls/swingup/' | relative_url }}">swing up a double pendulum</a>, or
    <a href="{{ '/controls/fit/' | relative_url }}">upload your own recording</a> to fit a model and design an LQR for it.
  </p>
</section>

{% include lab.html %}
