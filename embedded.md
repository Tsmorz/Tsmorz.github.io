---
layout: default
title: Embedded Systems
description: An interactive embedded systems course built on one coin-cell sensor node (digital and analog input, a thermistor, LED PWM, memory, flash, UART, I²C and SPI, and a battery budget), then a bike light.
permalink: /embedded/
lab: embedded
cat_hat: grad
---
<section class="wrap page-head">
  <h1 class="page-title">Embedded Systems</h1>
  <p class="page-sub controls-intro">
    One problem, taken all the way through: a small board on a coin cell reads a button and a temperature, blinks an
    LED, logs to flash, talks to a radio chip, and has to last a year. Every lesson follows the same five steps as the
    <a href="{{ '/controls/' | relative_url }}">controls lab</a>, and the last two carry the ideas to a bike light.
  </p>
</section>

{% include lab.html %}
