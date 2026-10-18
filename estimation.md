---
layout: default
title: State Estimation
description: You can't control what you can't measure. Differencing noisy sensors versus a Kalman filter on the cart-pole, and what estimation does to LQR's guaranteed margins (LQG).
permalink: /controls/estimation/
lab: estimation
---
<section class="wrap page-head">
  <h1 class="page-title">State Estimation</h1>
  <p class="su-crumb"><a href="{{ '/controls/' | relative_url }}">&#8592; Control Systems</a></p>
  <p class="page-sub controls-intro">
    The <a href="{{ '/controls/#cartpole' | relative_url }}">cart-pole's</a> LQR needs four states but only two are
    measured. See why differencing fails, how a <strong>Kalman filter</strong> fixes it, and what it costs in
    robustness.
  </p>
</section>

{% include lab.html %}
