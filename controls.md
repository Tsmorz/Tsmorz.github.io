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
    Four live simulations. Tune a <strong>PID</strong> controller on a mass-spring, a
    ball-balancing tilt table, and a nonlinear aircraft autopilot. On the inverted pendulum on a
    cart, set the four gains of a <strong>state-feedback (LQR)</strong> controller instead. Then add
    transport delay and sensor noise to see what breaks it. Every demo starts in
    <strong>Manual</strong>, so drag the plant yourself to feel how hard the job is, then switch to
    the controller and let it try. The plots
    under each sim show the plant's states and what each term of the controller is contributing.
    For a problem past what PID can do, <a href="{{ '/controls/swingup/' | relative_url }}">swing
    up a double pendulum</a> by hand, or hand it to a reinforcement-learning policy. The map below shows where to go
    from here: the same sims carry you through models, stability, estimation and design.
  </p>
</section>

{% include learning-path.html mode="map" %}

{% include lab.html %}
