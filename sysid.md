---
layout: default
title: System Identification
description: Where models come from - step response, frequency sweep, least squares, Ho-Kalman (ERA) and grey-box identification on the mass-spring-damper, and validating the models on fresh data.
permalink: /controls/sysid/
lab: sysid
---
<section class="wrap page-head">
  <h1 class="page-title">System Identification</h1>
  <p class="su-crumb"><a href="{{ '/controls/' | relative_url }}">&#8592; Control Systems</a></p>
  <p class="page-sub controls-intro">
    Every analysis on this site starts from a model: an equation for how the plant moves. On real hardware
    nobody hands you that equation; you get it by experiment. Push on the plant, record what it does, and fit
    a model to the record. This page runs the five methods engineers reach for most on the mass-spring-damper
    from the <a href="{{ '/controls/' | relative_url }}">Intro demo</a>, each in its own tab: reading a
    <strong>step response</strong>, a <strong>frequency sweep</strong>, <strong>least squares</strong> on sampled
    data, the <strong>Ho–Kalman</strong> realization from an impulse response, and a <strong>grey-box</strong> fit
    of the physics. Then every model is tested on data it has never seen, the step that decides which model to
    trust, and in the last tab you collect your own data by driving the sim yourself.
  </p>
</section>

{% include lab.html %}
