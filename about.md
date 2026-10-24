---
layout: page
title: About
permalink: /about/
---
I'm a **Robotics Software Engineer at Agile Robots SE** in Munich, building the software
that keeps robots all over the world connected: sending them software updates over the
internet, and letting a person drive one from far away with almost no delay.

Before Agile Robots I started a PhD at the **Technical University of Munich**, working under
**Prof. Lorenzo Masia** on soft exosuits (robotic suits made of fabric that help people
move), combining the readings of their sensors to track how the wearer moves.

Before that, an **MSc in Robotics** at Northeastern University and a **BSc in Aerospace
Engineering** at the University of Michigan.

Outside of work I'm usually outside: hiking, and above all on a bike, because I love cycling.
Otherwise I'm baking, visiting family and friends around the world, or building the occasional
robot purely because the idea was too good to leave alone.

<div class="about-photos">
  <img src="{{ '/assets/img/about/exosuit-1.jpg' | relative_url }}" alt="Soft exosuit research at TU Munich">
  <img src="{{ '/assets/img/about/exosuit-2.jpg' | relative_url }}" alt="Soft exosuit research at TU Munich">
</div>

## Education

<ul class="timeline">
  <li>
    <span class="t-when">2025–2026</span>
    <p class="t-what">PhD Candidate, Robotics</p>
    <p class="t-where">Technical University of Munich · Munich, Germany</p>
  </li>
  <li>
    <span class="t-when">2021–2023</span>
    <p class="t-what">MSc, Robotics</p>
    <p class="t-where">Northeastern University · Boston, USA</p>
  </li>
  <li>
    <span class="t-when">2012–2017</span>
    <p class="t-what">BSc, Aerospace Engineering</p>
    <p class="t-where">University of Michigan · Ann Arbor, USA</p>
  </li>
</ul>

## What I work on

- **Robot fleet software** – updating robots over the internet and driving them remotely without lag
- **Sensor fusion** – combining noisy sensors (GPS, motion sensors, cameras) so a robot knows where it is and which way it faces
- **Drones** – still trying to get one I built from scratch to fly
- **Teaching** – actively mentoring for [Polygence](https://www.polygence.org/) and previously with the [Boston Youth Farm Project](https://bostonyfp.org/)

## Professional athlete

Before robotics was the day job, I raced as a professional triathlete for Team USA. At one point I was ranked top 40 in the world. The 2019 and 2020 seasons were the
highlight – top finishes on the World Cup circuit, on handlebar extensions I'd designed and built
myself (see the hardware design on my
[projects page]({{ '/projects/#hardware' | relative_url }})). I raced and trained in 25 countries and loved the adventure but I'm more than happy that my income is more reliable than during this time.

<div class="about-photos about-photos-3x2">
  <img src="{{ '/assets/img/about/cape-town-finish-line.jpg' | relative_url }}" alt="Sprinting to the finish at the Cape Town triathlon World Cup" loading="lazy">
  <img src="{{ '/assets/img/about/cape-town-world-cup.jpg' | relative_url }}" alt="Celebrating on the podium at the Cape Town triathlon World Cup" loading="lazy">
</div>

## Elsewhere

- [GitHub]({{ site.social.github }}) – much of my work
- [LinkedIn]({{ site.social.linkedin }}) – the formal version
- [{{ site.author.email }}](mailto:{{ site.author.email }}) – the fastest way to reach me

{% if site.cv_url %}

<p><a class="btn btn-primary" href="{{ site.cv_url | relative_url }}">Download my CV</a></p>
{% endif %}
