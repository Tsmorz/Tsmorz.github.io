---
layout: default
title: Double Pendulum Swing-Up
description: Swing a double pendulum on a cart up by hand, or pick a target (both up, both down, or either pole folded) and let a goal-conditioned TQC reinforcement-learning policy running in your browser take it there.
permalink: /controls/swingup/
---
<section class="wrap page-head">
  <p class="su-crumb"><a href="{{ '/controls/' | relative_url }}">&#8592; Control Systems</a></p>
  <h1 class="page-title">Double Pendulum Swing-Up</h1>
  <p class="page-sub controls-intro">
    Two poles hang from a cart on a two-metre rail. Push the cart to swing both poles up and
    balance them. That's hard by hand, so a <strong>TQC</strong> reinforcement-learning policy
    is also available. It runs in your browser, and one network handles every target: both
    poles up, both down, or either one folded over the other. Pick a target and it moves the
    poles there from wherever they are.
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
      <div class="sim-cell"><canvas class="sim-states su-plot" id="su-plot" aria-label="Last 6 seconds of cart position, both pole angles, and applied force"></canvas></div>
    </div>
    <div class="sim-panel">
      <h3>Controller</h3>
      <div class="mode-toggle" role="group" aria-label="Who is in control">
        <button class="mode-btn active" type="button" data-mode="manual" aria-pressed="true">Manual</button>
        <button class="mode-btn" type="button" data-mode="tqc" aria-pressed="false">TQC network</button>
      </div>
      <p class="panel-hint">
        <strong>Manual:</strong> drag the cart, or hold &#8592; &#8594;.
        <strong>TQC:</strong> the network drives to the target; &#8592; &#8594; shove the cart.
        Picking a target hands it control.
      </p>
      <p class="panel-hint su-model-status" id="su-model-status" aria-live="polite"></p>
      <div class="su-targets" id="su-targets" hidden>
        <h3>Target</h3>
        <!-- 2 x 2: rows are link 1 (up, down), columns are link 2 (up, down). -->
        <div class="goal-grid" role="group" aria-label="Target pose">
          <button class="goal-btn" type="button" data-goal="UU" aria-pressed="false" title="Both up" aria-label="UU: both up">
            <span class="goal-icon" aria-hidden="true"></span><span class="goal-label">UU</span>
          </button>
          <button class="goal-btn" type="button" data-goal="UD" aria-pressed="false" title="&#952;&#8321; up, &#952;&#8322; down" aria-label="UD: link 1 up, link 2 down">
            <span class="goal-icon" aria-hidden="true"></span><span class="goal-label">UD</span>
          </button>
          <button class="goal-btn" type="button" data-goal="DU" aria-pressed="false" title="&#952;&#8321; down, &#952;&#8322; up" aria-label="DU: link 1 down, link 2 up">
            <span class="goal-icon" aria-hidden="true"></span><span class="goal-label">DU</span>
          </button>
          <button class="goal-btn" type="button" data-goal="DD" aria-pressed="false" title="Both down" aria-label="DD: both down">
            <span class="goal-icon" aria-hidden="true"></span><span class="goal-label">DD</span>
          </button>
          <button class="goal-btn goal-btn-random" type="button" id="su-goal-random" aria-pressed="false"
                  title="Pick a new target each time one is reached, until you pick a specific target">
            <span class="goal-icon" aria-hidden="true">?</span><span class="goal-label">Random</span>
          </button>
        </div>
      </div>
      <div class="score-block">
        <span class="score-value" id="su-score">&#8212;</span>
        <span class="score-label" id="su-score-label">Time to target (s)</span>
      </div>
      <div class="telemetry">
        <span class="t-head" id="su-best-head">Best</span>
        <span class="t-key">Manual</span><span class="t-val" id="su-best-manual">&#8212;</span>
        <span class="t-key">TQC</span><span class="t-val" id="su-best-tqc">&#8212;</span>
      </div>
      <div class="su-reset-row">
        <button class="sim-btn" id="su-reset" type="button" title="Restart hanging straight down">Reset</button>
        <button class="sim-btn" id="su-random" type="button" title="Restart from a random state">Random start</button>
      </div>
    </div>
  </div>

  <div class="demo-note">
    <h4 class="demo-note-title">About this demo</h4>
    <p>
      The policy was trained in <a href="https://github.com/Tsmorz/n-cartpole">n-cartpole</a>
      with <strong>TQC</strong> (Truncated Quantile Critics), an off-policy actor-critic that
      learns a whole distribution of returns rather than a single value. At every 10&nbsp;ms step
      it sees the cart position and velocity, cos&#8201;&#952;, sin&#8201;&#952; and
      &#952;&#775; for each pole, and the target as cos of each pole's goal angle (+1 up,
      &#8722;1 down). It outputs one horizontal force. Its reward peaks only when both poles
      sit at their targets, still, with the cart near the centre. During training the target
      changed every few seconds, and episodes started at every pose as well as at fully
      random states. That's why it can move between any two targets, and why it can catch a
      swing you started by hand.
    </p>
    <p>
      Labels give one letter per pole, base pole (&#952;&#8321;) first: <strong>U</strong> is up,
      <strong>D</strong> is down. Only DD is stable on its own. The other three have to be
      balanced actively, and in UD and DU one pole is folded back over the other.
    </p>
    <p>
      "Reached" means both poles within 0.3&nbsp;rad of their targets and slower than
      1.5&nbsp;rad/s for half a second. That's the same test the training repo's evaluation
      uses. The clock restarts at every reset and every new target. A time counts as
      <em>TQC</em> only if you never pushed the cart yourself (shoves in TQC mode are fine), and
      as <em>manual</em> only if the network never drove. Hitting either end of the rail ends
      the run. The network trained on a &#177;0.5&nbsp;m rail; this one runs to &#177;1&nbsp;m
      so there's room to swing by hand, but past half a metre from centre the network is
      outside anything it saw in training.
    </p>
    <p class="eqn-note" id="su-params">
      The simulation uses the exact plant the network was trained on, except the rail.
    </p>
  </div>
</div>

<script src="{{ '/assets/js/swingup.js' | relative_url }}"></script>
