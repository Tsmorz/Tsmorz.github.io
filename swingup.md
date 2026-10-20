---
layout: default
title: Double Pendulum Control
description: Swing a double pendulum on a cart up by hand, or pick a target (both up, both down, or either link folded) and let a goal-conditioned TQC reinforcement-learning policy running in your browser take it there.
permalink: /controls/swingup/
---
<section class="wrap page-head">
  <h1 class="page-title">Double Pendulum Control</h1>
  <p class="su-crumb"><a href="{{ '/controls/' | relative_url }}">← Control Systems</a></p>
  <p class="page-sub controls-intro">
    An unactuated pendulum on a sliding cart is a classic controls problem and this two link version extends it.
    You can push the cart to swing both links up but the sytem dynamics and human reaction time make this impossible. However, a <strong>TQC reinforcement-learning policy</strong>
    can do this with a high rate of success. Sometimes learned control policies are the only way to achieve stability!
  </p>
</section>

<div class="wrap" style="padding-bottom:3rem">
  <div class="sim-layout su-layout">
    <div class="sim-canvas-wrap sim-stack">
      <div class="sim-cell">
        <canvas class="sim-canvas su-canvas" id="su-canvas"
                data-meta="{{ '/assets/models/swingup-tqc.json' | relative_url }}"
                data-weights="{{ '/assets/models/swingup-tqc.bin' | relative_url }}"
                aria-label="Double pendulum on a cart. Drag horizontally to push the cart. Faint outlines show the target pose."></canvas>
      </div>
      <div class="sim-cell"><canvas class="sim-states su-plot" id="su-plot" aria-label="Last 6 seconds of cart position, both link angles, and applied force"></canvas></div>
    </div>
    <div class="sim-panel">
      <h3>Controller</h3>
      <div class="mode-toggle" role="group" aria-label="Who is in control">
        <button class="mode-btn active" type="button" data-mode="manual" aria-pressed="true">Manual</button>
        <button class="mode-btn" type="button" data-mode="tqc" aria-pressed="false">AI</button>
      </div>
      <p class="panel-hint"><strong>Manual:</strong> drag the cart. <strong>AI:</strong> the network drives to the target; picking a target hands it control.</p>
      <p class="panel-hint su-model-status" id="su-model-status" aria-live="polite"></p>
      <div class="su-targets" id="su-targets" hidden>
        <h3>Target</h3>
        <!-- 2 x 2: rows are link 1 (up, down), columns are link 2 (up, down). -->
        <div class="goal-grid" role="group" aria-label="Target pose">
          <button class="goal-btn" type="button" data-goal="UU" aria-pressed="false" title="Both up" aria-label="UU: both up">
            <span class="goal-icon" aria-hidden="true"></span><span class="goal-label">UU</span>
          </button>
          <button class="goal-btn" type="button" data-goal="UD" aria-pressed="false" title="θ₁ up, θ₂ down" aria-label="UD: link 1 up, link 2 down">
            <span class="goal-icon" aria-hidden="true"></span><span class="goal-label">UD</span>
          </button>
          <button class="goal-btn" type="button" data-goal="DU" aria-pressed="false" title="θ₁ down, θ₂ up" aria-label="DU: link 1 down, link 2 up">
            <span class="goal-icon" aria-hidden="true"></span><span class="goal-label">DU</span>
          </button>
          <button class="goal-btn" type="button" data-goal="DD" aria-pressed="false" title="Both down" aria-label="DD: both down">
            <span class="goal-icon" aria-hidden="true"></span><span class="goal-label">DD</span>
          </button>
          <button class="goal-btn goal-btn-random" type="button" id="su-goal-random" aria-pressed="false"
                  title="Pick a new target each time one is reached, until you pick a specific target">
            <span class="goal-label">Random</span>
          </button>
        </div>
      </div>
      <h3>Disturbances</h3>
      <div class="pid-group">
        <label>Delay <span id="su-delay-val">0 ms</span></label>
        <input type="range" id="su-delay" min="0" max="50" step="10" value="0">
      </div>
      <div class="pid-group">
        <label>Sensor noise <span class="sigma">σ</span> <span id="su-noise-val">0.00</span></label>
        <input type="range" id="su-noise" min="0" max="0.1" step="0.01" value="0">
      </div>
      <p class="panel-hint">Delay holds back the force; noise corrupts what the network measures, never the force. It was trained with neither, so 30 ms of delay or noise above 0.05 usually breaks it.</p>
      <div class="score-block">
        <span class="score-value" id="su-score">-</span>
        <span class="score-label" id="su-score-label">Time to target (s)</span>
      </div>
      <div class="telemetry">
        <span class="t-head" id="su-best-head">Best</span>
        <span class="t-key">Manual</span><span class="t-val" id="su-best-manual">-</span>
        <span class="t-key">AI</span><span class="t-val" id="su-best-tqc">-</span>
      </div>
      <div class="su-reset-row">
        <button class="sim-btn" id="su-reset" type="button" title="Restart hanging straight down">Reset</button>
        <button class="sim-btn" id="su-random" type="button" title="Restart from a random state">Random start</button>
      </div>
    </div>
  </div>

<script src="{{ '/assets/js/statebox.js' | relative_url }}"></script>

<script src="{{ '/assets/js/swingup.js' | relative_url }}"></script>
