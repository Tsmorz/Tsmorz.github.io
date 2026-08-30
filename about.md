---
layout: page
title: About
subtitle: Aerospace by training, robotics by choice — currently in Munich.
permalink: /about/
---

I'm a PhD researcher in robotics at the **Technical University of Munich**. My work sits
at the point where sensing meets control: how a vehicle turns noisy accelerometers,
cameras, and barometers into a confident answer to "where am I, and where am I going?"

Before Munich I earned an **MSc in Robotics** at Northeastern University and a
**BSc in Aerospace Engineering** at the University of Michigan. The aerospace background
still shows — most of what I build flies.

Outside the lab I'm usually outside: photography, travel, and the occasional
robot built purely because the idea was too good to leave alone.

## Education

<ul class="timeline">
  <li>
    <span class="t-when">Present</span>
    <p class="t-what">PhD, Robotics</p>
    <p class="t-where">Technical University of Munich &middot; Munich, Germany</p>
  </li>
  <li>
    <span class="t-when">MSc</span>
    <p class="t-what">MSc, Robotics</p>
    <p class="t-where">Northeastern University &middot; Boston, USA</p>
  </li>
  <li>
    <span class="t-when">BSc</span>
    <p class="t-what">BSc, Aerospace Engineering</p>
    <p class="t-where">University of Michigan &middot; Ann Arbor, USA</p>
  </li>
</ul>

## What I work on

- **State estimation & sensor fusion** — Kalman filtering, IMU fusion, SLAM
- **Autonomous aerial vehicles** — multirotor and fixed-wing design, control, and localization
- **Learning for control** — vision-based policies for flight
- **Teaching** — a hands-on undergraduate course in quadcopter design

## Elsewhere

- [GitHub]({{ site.social.github }}) — most of my work, open source
- [LinkedIn]({{ site.social.linkedin }}) — the formal version
- [{{ site.author.email }}](mailto:{{ site.author.email }}) — the fastest way to reach me

{% if site.cv_url %}
<p><a class="btn btn-primary" href="{{ site.cv_url | relative_url }}">Download my CV</a></p>
{% endif %}
