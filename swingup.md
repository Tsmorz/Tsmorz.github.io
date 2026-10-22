---
layout: default
title: Double Pendulum Control
description: Swing a double pendulum on a cart up by hand, or pick a target (both up, both down, or either link folded) and let a goal-conditioned TQC reinforcement-learning policy running in your browser take it there.
permalink: /controls/swingup/
style: journal
---
<div class="journal su-journal">
<header class="wrap j-mast">
  <p class="j-label su-kicker">Controls &middot; Reinforcement learning</p>
  <h1 class="j-title">Double Pendulum</h1>
  <p class="j-standfirst">
    A pendulum on a sliding cart is a classic controls problem; this one has two links. Push the cart and try to
    swing both up: the dynamics and your reaction time make it all but impossible. A reinforcement-learning policy
    does it most of the time. Sometimes a learned controller is the only way to stability.
  </p>
  <div class="j-rule" aria-hidden="true"></div>
  <p class="j-meta"><span>Goal-conditioned TQC</span><span>10 ms control step</span><span>&plusmn;20 N on the cart</span><span>Runs in your browser</span></p>
</header>

<div class="wrap su-body">
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
      <h3 class="su-h"><span class="j-mark">&sect;1</span> <span class="j-label">Controller</span></h3>
      <div class="mode-toggle" role="group" aria-label="Who is in control">
        <button class="mode-btn active" type="button" data-mode="manual" aria-pressed="true">Manual</button>
        <button class="mode-btn" type="button" data-mode="tqc" aria-pressed="false">AI</button>
      </div>
      <p class="panel-hint"><strong>Manual:</strong> drag the cart. <strong>AI:</strong> the network drives to the target; picking a target hands it control.</p>
      <p class="panel-hint su-model-status" id="su-model-status" aria-live="polite"></p>
      <div class="su-targets" id="su-targets" hidden>
        <h3 class="su-h"><span class="j-mark">&sect;2</span> <span class="j-label">Target</span></h3>
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
      <h3 class="su-h"><span class="j-mark">&sect;3</span> <span class="j-label">Disturbances</span></h3>
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

  <div class="su-net-wrap">
    <h2 class="su-sec"><span class="j-mark">&sect;4</span> Inside the network</h2>
    <div class="su-net-scroll">
      <canvas class="su-net" id="su-net" aria-label="Diagram of the policy network with live activations: ten inputs, a 256-unit embedding, two residual blocks of 1024 ReLU units each, and one output force."></canvas>
    </div>
    <p class="su-net-hint">Swipe sideways to see the whole network.</p>
    <p class="eqn-note">
      Each square is one neuron, ultramarine when positive and red when negative. The ten inputs feed a
      256-unit embedding, then two residual blocks (each widens to 1024 ReLU units and adds its
      result back through the skip), and a single number comes out. <code>tanh</code> squashes it
      to a force of at most 20&nbsp;N.
    </p>
  </div>

  <div class="su-about">
    <h2 class="su-sec"><span class="j-mark">&sect;5</span> About this demo</h2>
    <p>
      The policy was trained in <a href="https://github.com/Tsmorz/n-cartpole">n-cartpole</a>
      with <strong>TQC</strong> (Truncated Quantile Critics), an off-policy actor-critic that
      learns a whole distribution of returns rather than a single value. At every 10&nbsp;ms step
      it sees the cart position and velocity, cos&#8201;&#952;, sin&#8201;&#952; and
      &#952;&#775; for each link, and the target as cos of each link's goal angle (+1 up,
      &#8722;1 down). It outputs one horizontal force. Its reward peaks only when both links
      sit at their targets, still, with the cart near the center. During training the target
      changed every few seconds, and episodes started at every pose as well as at fully
      random states. That's why it can move between any two targets, and why it can catch a
      swing you started by hand.
    </p>
    <p>
      "Reached" means both links within 0.3&nbsp;rad of their targets and slower than
      1.5&nbsp;rad/s for half a second. That's the same test the training repo's evaluation
      uses. The clock restarts at every reset and every new target. A time counts as
      <em>AI</em> only if you never pushed the cart yourself, and
      as <em>manual</em> only if the network never drove. Hitting either end of the rail ends
      the run. The network trained on a &#177;0.5&nbsp;m rail; this one runs to &#177;1&nbsp;m
      so there's room to swing by hand, but past half a meter from center the network is
      outside anything it saw in training.
    </p>
    <p class="eqn-note" id="su-params">
      The simulation uses the exact plant the network was trained on, except the rail.
    </p>
  </div>
</div>

</div>

<script src="{{ '/assets/js/statebox.js' | relative_url }}"></script>
<script src="{{ '/assets/js/swingup.js' | relative_url }}"></script>

<style>
/* The canvases read tokens off <html>, so point those at the Journal's paper and ink too (beats main.css's dark block). */
:root:root:root {
  --bg: var(--paper); --bg-soft: var(--plate); --surface: var(--paper); --border: var(--rule); --border-strong: var(--rule-strong);
  --text: var(--ink); --text-muted: var(--ink-muted); --accent: var(--ink-accent);
  --font: var(--j-serif); --mono: var(--j-mono);
  --pend-cart: var(--ink-muted); --pend-rod: var(--ink-2); --pend-1: var(--ink-accent); --pend-2: var(--ink-red); --viz-4: var(--ink-2);
  --ink-red: #c23b22; --nn-act-pos: #2b3bd6; --nn-act-neg: #c23b22; --nn-act-zero: #ecece6;
}
@media (prefers-color-scheme: dark) { :root:root:root:not([data-theme="light"]) { --ink-red: #ff8a6b; --nn-act-pos: #9aa6ff; --nn-act-neg: #ff8a6b; --nn-act-zero: #2a2b2f; } }
:root:root:root[data-theme="dark"] { --ink-red: #ff8a6b; --nn-act-pos: #9aa6ff; --nn-act-neg: #ff8a6b; --nn-act-zero: #2a2b2f; }

.su-kicker { margin: 0 0 1rem; color: var(--ink-accent); }
.su-body { padding-block: 2.5rem 4rem; }
.su-journal .sim-states, .su-journal .su-net { border-radius: 0; border-color: var(--rule); }
.su-journal .su-canvas { border-radius: 0; }
/* The panel is a column in the margin: a hairline down its left, no card. */
.su-journal .sim-panel { border: 0; border-left: 1px solid var(--ink); border-radius: 0; background: none; padding: 0 0 0 1.25rem; gap: .7rem; }
@media (max-width: 720px) { .su-journal .sim-panel { border-left: 0; border-top: 1px solid var(--ink); padding: 1rem 0 0; } }
.su-journal .su-h { margin: .4rem 0 0; padding-top: .55rem; border-top: 1px solid var(--rule); font-weight: 400; display: flex; gap: .5rem; align-items: baseline; }
.su-journal .su-h:first-child { margin-top: 0; padding-top: 0; border-top: 0; }
.su-journal .panel-hint { font: italic .9rem/1.4 var(--j-serif); color: var(--ink-2); }
.su-journal .panel-hint strong { font-style: normal; font-weight: 500; color: var(--ink); }
/* Manual | AI are words, like the recipe choices. */
.su-journal .mode-toggle { display: flex; gap: 0 .4rem; border: 0; background: none; padding: 0; }
.su-journal .mode-btn { flex: none; min-height: 2.4rem; padding: 0 .3rem; border: 0; border-radius: 0; background: none; box-shadow: none; color: var(--ink-muted);
  font: 400 1.35rem var(--j-serif); text-decoration: underline; text-decoration-color: transparent; text-decoration-thickness: 1.5px; text-underline-offset: 6px; }
.su-journal .mode-btn:hover { color: var(--ink); text-decoration-color: var(--rule-strong); }
.su-journal .mode-btn.active { color: var(--ink); background: none; box-shadow: none; text-decoration-color: var(--ink-accent); }
/* Targets: a ruled 2x2 table, the picked cell inked. */
.su-journal .goal-grid { gap: 0; border-top: 1px solid var(--rule); border-left: 1px solid var(--rule); }
.su-journal .goal-btn { border: 0; border-right: 1px solid var(--rule); border-bottom: 1px solid var(--rule); border-radius: 0; background: none; box-shadow: none; }
.su-journal .goal-btn:hover { background: var(--plate); }
.su-journal .goal-btn.active { background: var(--ink-accent-soft); box-shadow: inset 0 -2px 0 var(--ink-accent); }
.su-journal .goal-label { font: .75rem var(--j-mono); }
.su-journal .goal-btn-random .goal-label { font: italic 1rem var(--j-serif); }
.su-journal .pid-group > label { font: 400 1rem var(--j-serif); color: var(--ink); }
.su-journal .pid-group > label span { font-family: var(--j-mono); color: var(--ink-accent); }
.su-journal input[type="range"] { accent-color: var(--ink); }
/* The score is the headline number of the panel. */
.su-journal .score-block { text-align: left; padding: .5rem 0 .2rem; border-top: 3px double var(--ink); }
.su-journal .score-value { display: block; font: 380 2.6rem/1 var(--j-serif); letter-spacing: -0.02em; color: var(--ink); font-variant-numeric: tabular-nums; }
.su-journal .score-label { font: .68rem var(--j-mono); letter-spacing: .08em; color: var(--ink-muted); }
.su-journal .telemetry { font: .78rem var(--j-mono); border-top: 1px solid var(--rule); padding-top: .4rem; }
.su-journal .telemetry .t-val { color: var(--ink); }
.su-journal .telemetry .t-head { font: italic .95rem var(--j-serif); color: var(--ink-2); }
.su-journal .sim-btn { border: 1px solid var(--ink); border-radius: 0; background: none; box-shadow: none; color: var(--ink); font: .75rem var(--j-mono); letter-spacing: .04em; text-transform: uppercase; }
.su-journal .sim-btn:hover { background: var(--ink); color: var(--paper); }
/* Sections below the sim: a serif heading on a rule, prose in the text face. */
.su-sec { margin: 0 0 1rem; padding-top: .8rem; border-top: 1px solid var(--ink); font-size: 1.9rem; line-height: 1.15; display: flex; gap: .75rem; align-items: baseline; }
.su-net-wrap { margin-top: 3.5rem; }
.su-journal .eqn-note { font: italic 1rem/1.5 var(--j-serif); color: var(--ink-2); max-width: 44em; }
.su-about { margin-top: 3.5rem; }
.su-about > p { margin: 0 0 1rem; font-size: 1.1rem; line-height: 1.6; color: var(--ink); max-width: 38em; text-wrap: pretty; }
@media (min-width: 900px) { .su-about { column-count: 2; column-gap: 3rem; } .su-about > .su-sec { column-span: all; } .su-about > p { max-width: none; } }
.su-journal code { font-family: var(--j-mono); font-size: .85em; }
</style>
