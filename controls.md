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
    Tune a <strong>PID</strong> controller on a mass-spring, a tilt table and an aircraft, or set the gains of an
    <strong>LQR</strong> on a cart-pole. Every demo starts in <strong>Manual</strong>: drag the plant yourself,
    then let the controller try. Past what PID can do, <a href="{{ '/controls/swingup/' | relative_url }}">swing
    up a double pendulum</a>.
  </p>
</section>

{% include lab.html %}
