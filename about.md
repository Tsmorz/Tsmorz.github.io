---
layout: page
title: About
subtitle: Aerospace by training, robotics by choice — currently in Munich.
permalink: /about/
---

I'm a **Robotics Software Engineer at Agile Robots SE** in Munich, building the software
that keeps a fleet of robots connected and controllable — remote over-the-air updates and
low-latency teleoperation for machines deployed around the world.

Before Agile Robots I was a PhD candidate at the **Technical University of Munich**,
working under **Prof. Lorenzo Masia** on sensor fusion for soft exosuits — turning noisy
wearable sensor data into a reliable read on how a joint is actually moving.

<div class="about-photos">
  <img src="{{ '/assets/img/about/exosuit-1.jpg' | relative_url }}" alt="Soft exosuit research at TU Munich">
  <img src="{{ '/assets/img/about/exosuit-2.jpg' | relative_url }}" alt="Soft exosuit research at TU Munich">
</div>

Before that, an **MSc in Robotics** at Northeastern University and a **BSc in Aerospace
Engineering** at the University of Michigan. The aerospace background still shows — most
of what I build flies.

Outside of work I'm usually outside: photography, travel, and the occasional robot built
purely because the idea was too good to leave alone.

## Education

<ul class="timeline">
  <li>
    <span class="t-when">2025 – 2026</span>
    <p class="t-what">PhD Candidate, Robotics</p>
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

- **Robot fleet software** — over-the-air updates and low-latency teleoperation
- **State estimation & sensor fusion** — Kalman filtering, IMU fusion, SLAM
- **Autonomous aerial vehicles** — multirotor and fixed-wing design, control, and localization
- **Learning for control** — vision-based policies for flight
- **Teaching** — a hands-on undergraduate course in quadcopter design

## Projects

A few things I've built, at work and on weekends. More on the
[projects page]({{ '/projects/' | relative_url }}).

{% assign about_projects = site.data.projects | where: "about", true %}
<div class="card-grid about-projects">
  {%- for project in about_projects %}{% include project-card.html project=project %}{% endfor %}
</div>

## Hardware design

Software is most of what I do, but not all of it. When a project needs a physical part
that doesn't exist yet, I design it — modelling in CAD, iterating on the geometry, and
fabricating the result to test it in the real world. The most satisfying hardware is the
kind I get to put through its paces myself.

<figure class="about-figure">
  <img src="{{ '/assets/img/about/bike-aerobar-cad.png' | relative_url }}" alt="CAD model of a bike aerobar I designed">
  <figcaption>A bike aerobar I designed in CAD. I raced it through my 2020 professional
  season and used it to take top finishes on the World Cup circuit.</figcaption>
</figure>

## Racing

Before robotics was the day job, I raced professionally. The 2020 season was the
highlight — top finishes on the World Cup circuit, on a setup I'd designed and built
myself (above). Chasing marginal gains on the bike is where a lot of my instinct for
hardware and control came from: measure, model, change one thing, test, repeat.

## Elsewhere

- [GitHub]({{ site.social.github }}) — most of my work, open source
- [LinkedIn]({{ site.social.linkedin }}) — the formal version
- [{{ site.author.email }}](mailto:{{ site.author.email }}) — the fastest way to reach me

{% if site.cv_url %}
<p><a class="btn btn-primary" href="{{ site.cv_url | relative_url }}">Download my CV</a></p>
{% endif %}
