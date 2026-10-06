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
    up a double pendulum</a> by hand, or hand it to a reinforcement-learning policy. Then follow
    the same sims through the rest of the craft: where models come from
    (<a href="{{ '/controls/sysid/' | relative_url }}">system identification</a>), how to tell a loop is
    stable and by how much (<a href="{{ '/controls/stability/' | relative_url }}">stability</a>), how the
    steps fit together (<a href="{{ '/controls/design/' | relative_url }}">the design process</a>), and
    newer ideas like safety filters and verified neural networks
    (<a href="{{ '/controls/modern/' | relative_url }}">modern methods</a>).
  </p>
</section>

{% include lab.html %}
