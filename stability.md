---
layout: default
title: Stability Analysis
description: How do you know a loop is stable, and by how much? Bode, Nyquist and pole plots of the loops on /controls/ - shake them, cut them open, and drag the poles.
permalink: /controls/stability/
lab: stability
---
<section class="wrap page-head">
  <h1 class="page-title">Stability Analysis</h1>
  <p class="su-crumb"><a href="{{ '/controls/' | relative_url }}">&#8592; Control Systems</a></p>
  <p class="page-sub controls-intro">
    A controller that works in one test can still be one gust away from shaking itself apart. These tabs take the loops you already know from the <a href="{{ '/controls/' | relative_url }}">controls demos</a> and ask how stable they are, and by how much. Start with <strong>The Plant</strong> and shake it, then cut the PID, LQR and aircraft loops open. Under each sim, <strong>View</strong> switches between three pictures of the same loop: Bode, Nyquist and poles, and in the poles view you can drag the poles yourself.
  </p>
</section>

{% include lab.html %}
