---
layout: default
title: Controls
description: Interactive control-systems demos - tune PID controllers on a mass-spring, tilt table, and flight sim, and state-feedback (LQR) gains on a cart-pole.
permalink: /controls/
---
<section class="wrap page-head">
  <h1 class="page-title">Control Systems</h1>
  <p class="page-sub controls-intro">
    Four live simulations. Tune a <strong>PID</strong> controller on a mass-spring, a
    ball-balancing tilt table, and a nonlinear aircraft autopilot. On the inverted pendulum on a
    cart, set the four gains of a <strong>state-feedback (LQR)</strong> controller instead. Then add
    transport delay and sensor noise to see what breaks it. Every demo starts in
    <strong>Manual</strong>, so drag the plant yourself to feel how hard the job is, then switch to
    the controller and let it try. The plots
    under each sim show the plant's states and what each term of the controller is contributing.
    For a problem past what PID can do, <a href="{{ '/controls/swingup/' | relative_url }}">swing
    up a double pendulum</a> by hand, or hand it to a reinforcement-learning policy.
  </p>
</section>

<div class="wrap" style="padding-bottom:3rem">
  <div class="sim-tabs-row">
    <div class="sim-tabs" role="tablist" aria-label="Demo selector">
      <button class="sim-tab active" role="tab" aria-selected="true"  aria-controls="sec-msd"    id="tab-msd"    type="button">Intro</button>
      <button class="sim-tab"        role="tab" aria-selected="false" aria-controls="sec-tilt"   id="tab-tilt"   type="button">Tilt Table</button>
      <button class="sim-tab"        role="tab" aria-selected="false" aria-controls="sec-flight" id="tab-flight" type="button">Flight Sim</button>
      <button class="sim-tab"        role="tab" aria-selected="false" aria-controls="sec-cartpole" id="tab-cartpole" type="button">Cart-Pole</button>
    </div>
    <!-- Its own page, not a tab — so not .sim-tab, which controls.js wires up as one. -->
    <a class="sim-tab-link" href="{{ '/controls/swingup/' | relative_url }}">Double Swing-Up &#8594;</a>
  </div>

  <!-- ── Demo 1: Mass-Spring-Damper ─────────────────────────────── -->
  <section class="sim-section active" id="sec-msd" role="tabpanel" aria-labelledby="tab-msd">
    <div class="sim-layout">
      <div class="sim-canvas-wrap sim-stack">
        <div class="sim-cell"><canvas class="sim-canvas" id="msd-canvas" aria-label="Mass-spring-damper simulation with the reference trajectory ahead"></canvas></div>
        <div class="sim-cell-pair">
          <div class="sim-cell"><canvas class="sim-states" id="msd-state-plot" aria-label="State history: position, velocity, tracking error, applied force"></canvas></div>
          <div class="sim-cell"><canvas class="sim-states" id="msd-pid-plot" aria-label="PID contribution chart"></canvas></div>
        </div>
      </div>
      <div class="sim-panel">
        <h3>Controller</h3>
        <div class="mode-toggle" id="msd-mode" role="group" aria-label="Who is in control">
          <button class="mode-btn active" type="button" data-mode="manual" aria-pressed="true">Manual</button>
          <button class="mode-btn" type="button" data-mode="pid" aria-pressed="false">PID</button>
        </div>
        <p class="panel-hint"><strong>Manual:</strong> drag the mass up or down. Delay and noise apply to PID only.</p>
        <h3>Reference</h3>
        <div class="mode-toggle" id="msd-ref" role="group" aria-label="Reference signal">
          <button class="mode-btn active" type="button" data-ref="wave" aria-pressed="true">Wave</button>
          <button class="mode-btn" type="button" data-ref="step" aria-pressed="false">Step</button>
        </div>
        <div class="hint-box" hidden id="msd-hint" data-prefix="msd" data-gains="kp:40,ki:5,kd:6">
          <p class="hint-text"><strong>Stuck?</strong> A good solution is K<sub>p</sub>&#8201;=&#8201;40, K<sub>i</sub>&#8201;=&#8201;5, K<sub>d</sub>&#8201;=&#8201;6. A high K<sub>p</sub> tracks the sine closely, K<sub>d</sub> stops the spring from ringing, and a little K<sub>i</sub> removes the offset.</p>
          <div class="hint-row"><button class="sim-btn hint-apply" type="button">Try it</button></div>
        </div>
        <h3>PID Gains</h3>
        <div class="pid-group">
          <label>K<sub>p</sub> <span id="msd-kp-val">0.0</span></label>
          <input type="range" id="msd-kp" min="-50" max="50" step="0.5" value="0">
          <div class="range-row"><label class="range-lbl" for="msd-kp-range"><span class="visually-hidden">Range </span>±</label><input type="number" id="msd-kp-range" class="range-input" value="50" min="1" step="1"></div>
        </div>
        <div class="pid-group">
          <label>K<sub>i</sub> <span id="msd-ki-val">0.0</span></label>
          <input type="range" id="msd-ki" min="-20" max="20" step="0.1" value="0">
          <div class="range-row"><label class="range-lbl" for="msd-ki-range"><span class="visually-hidden">Range </span>±</label><input type="number" id="msd-ki-range" class="range-input" value="20" min="1" step="1"></div>
        </div>
        <div class="pid-group">
          <label>K<sub>d</sub> <span id="msd-kd-val">0.0</span></label>
          <input type="range" id="msd-kd" min="-10" max="10" step="0.05" value="0">
          <div class="range-row"><label class="range-lbl" for="msd-kd-range"><span class="visually-hidden">Range </span>±</label><input type="number" id="msd-kd-range" class="range-input" value="10" min="1" step="1"></div>
        </div>
        <h3>Disturbances</h3>
        <div class="pid-group">
          <label>Delay <span id="msd-delay-val">0 ms</span></label>
          <input type="range" id="msd-delay" min="0" max="1000" step="10" value="0">
          <div class="range-row"><label class="range-lbl visually-hidden" for="msd-delay-amt">Delay amount (ms)</label><input type="number" id="msd-delay-amt" class="range-input" value="0" min="0" max="1000" step="10"></div>
        </div>
        <div class="pid-group">
          <label>Sensor noise &#963; <span id="msd-noise-val">0.00</span></label>
          <input type="range" id="msd-noise" min="0" max="0.5" step="0.01" value="0">
        </div>
        <div class="score-block">
          <span class="score-value" id="msd-score">-</span>
          <span class="score-label">RMSE (m)</span>
          <div class="score-best" id="msd-best"></div>
        </div>
        <button class="sim-btn" id="msd-reset" type="button">Reset</button>
      </div>
    </div>
    <div class="demo-note">
      <h4 class="demo-note-title">About this demo</h4>
      <p>
        A <strong>PID controller</strong> pushes a lightly damped mass on a spring
        (&#950; &#8776; 0.1) to track a reference: a slow sine wave, or a <strong>step</strong>
        that jumps to the opposite position every half period. The line ahead of the mass shows
        where the reference is going. The <em>proportional</em> term
        reacts to the current error, the <em>integral</em> term removes steady-state offset, and
        the <em>derivative</em> term damps oscillation. The score is RMSE over the last 5 s.
        Start with K<sub>p</sub> alone, add K<sub>d</sub> to cut the overshoot, then a small
        K<sub>i</sub> to remove what's left. Then add a <strong>transport delay</strong> to the
        command or <strong>sensor noise</strong> to the measurement: delay eats phase margin, and
        the derivative term amplifies noise the most. In Manual mode, drag the mass to follow the
        reference yourself. &#8594;
        <a href="https://en.wikipedia.org/wiki/PID_controller" target="_blank" rel="noopener">PID controller - Wikipedia</a>
      </p>
    </div>
  </section>

  <!-- ── Demo 2: Tilt Table ─────────────────────────────────────── -->
  <section class="sim-section" id="sec-tilt" role="tabpanel" aria-labelledby="tab-tilt">
    <div class="sim-layout">
      <div class="sim-canvas-wrap sim-stack">
        <div class="sim-cell"><canvas class="sim-canvas" id="tilt-canvas" aria-label="Ball-balancing tilt table"></canvas></div>
        <div class="sim-cell-pair">
          <div class="sim-cell"><canvas class="sim-states" id="tilt-state-plot" aria-label="State history: ball position, ball velocity, beam angle, beam rate"></canvas></div>
          <div class="sim-cell"><canvas class="sim-states" id="tilt-pid-plot" aria-label="PID contribution chart"></canvas></div>
        </div>
      </div>
      <div class="sim-panel">
        <h3>Controller</h3>
        <div class="mode-toggle" id="tilt-mode" role="group" aria-label="Who is in control">
          <button class="mode-btn active" type="button" data-mode="manual" aria-pressed="true">Manual</button>
          <button class="mode-btn" type="button" data-mode="pid" aria-pressed="false">PID</button>
        </div>
        <p class="panel-hint"><strong>Manual:</strong> drag the beam ends to tilt it. Delay and noise apply to PID only.</p>
        <h3>Reference</h3>
        <div class="mode-toggle" id="tilt-ref" role="group" aria-label="Reference signal">
          <button class="mode-btn active" type="button" data-ref="wave" aria-pressed="true">Wave</button>
          <button class="mode-btn" type="button" data-ref="step" aria-pressed="false">Step</button>
        </div>
        <div class="hint-box" hidden id="tilt-hint" data-prefix="tilt" data-gains="kp:3,ki:0,kd:2">
          <p class="hint-text"><strong>Stuck?</strong> A good solution is K<sub>p</sub>&#8201;=&#8201;3, K<sub>i</sub>&#8201;=&#8201;0, K<sub>d</sub>&#8201;=&#8201;2. Enough K<sub>p</sub> to chase the reference, and K<sub>d</sub> to brake the ball before it overshoots.</p>
          <div class="hint-row"><button class="sim-btn hint-apply" type="button">Try it</button></div>
        </div>
        <h3>PID Gains</h3>
        <div class="pid-group">
          <label>K<sub>p</sub> <span id="tilt-kp-val">0.0</span></label>
          <input type="range" id="tilt-kp" min="-10" max="10" step="0.1" value="0">
          <div class="range-row"><label class="range-lbl" for="tilt-kp-range"><span class="visually-hidden">Range </span>±</label><input type="number" id="tilt-kp-range" class="range-input" value="10" min="1" step="1"></div>
        </div>
        <div class="pid-group">
          <label>K<sub>i</sub> <span id="tilt-ki-val">0.0</span></label>
          <input type="range" id="tilt-ki" min="-5" max="5" step="0.05" value="0">
          <div class="range-row"><label class="range-lbl" for="tilt-ki-range"><span class="visually-hidden">Range </span>±</label><input type="number" id="tilt-ki-range" class="range-input" value="5" min="1" step="1"></div>
        </div>
        <div class="pid-group">
          <label>K<sub>d</sub> <span id="tilt-kd-val">0.0</span></label>
          <input type="range" id="tilt-kd" min="-5" max="5" step="0.05" value="0">
          <div class="range-row"><label class="range-lbl" for="tilt-kd-range"><span class="visually-hidden">Range </span>±</label><input type="number" id="tilt-kd-range" class="range-input" value="5" min="1" step="1"></div>
        </div>
        <h3>Disturbances</h3>
        <div class="pid-group">
          <label>Delay <span id="tilt-delay-val">0 ms</span></label>
          <input type="range" id="tilt-delay" min="0" max="1000" step="10" value="0">
          <div class="range-row"><label class="range-lbl visually-hidden" for="tilt-delay-amt">Delay amount (ms)</label><input type="number" id="tilt-delay-amt" class="range-input" value="0" min="0" max="1000" step="10"></div>
        </div>
        <div class="pid-group">
          <label>Sensor noise &#963; <span id="tilt-noise-val">0.00</span></label>
          <input type="range" id="tilt-noise" min="0" max="0.5" step="0.01" value="0">
        </div>
        <div class="score-block">
          <span class="score-value" id="tilt-score">-</span>
          <span class="score-label">RMSE (m)</span>
          <div class="score-best" id="tilt-best"></div>
        </div>
        <button class="sim-btn" id="tilt-reset" type="button">Reset</button>
      </div>
    </div>
    <div class="demo-note">
      <h4 class="demo-note-title">About this demo</h4>
      <p>
        A <strong>PID controller</strong> tilts a beam so a rolling ball tracks a reference
        position: a sine wave, or a <strong>step</strong> that jumps to the other side of the beam
        every half period (the dashed ring on the beam is where the ball should be). The run
        restarts if the ball rolls off an end. The controller outputs a
        <em>commanded</em> tilt, and a servo turns the beam toward it at no more than
        60&nbsp;&#176;/s, so a big correction takes time. Watch &#952;&#775; saturate in the state
        plot. K<sub>p</sub> alone makes the ball oscillate, K<sub>d</sub> damps it, and a small
        K<sub>i</sub> removes any leftover offset. In Manual mode, drag either end of the beam to
        tilt it. The same servo limit applies to you. &#8594;
        <a href="https://en.wikipedia.org/wiki/Ball_and_beam" target="_blank" rel="noopener">Ball and beam - Wikipedia</a>
      </p>
    </div>
  </section>

  <!-- ── Demo 3: Flight Sim ──────────────────────────────────────── -->
  <section class="sim-section" id="sec-flight" role="tabpanel" aria-labelledby="tab-flight">
    <div class="sim-layout">
      <div class="sim-canvas-wrap sim-stack">
        <div class="sim-cell"><canvas class="sim-canvas" id="flight-canvas" aria-label="2D flight simulator"
                data-sprite="{{ '/assets/img/controls/cessna.png' | relative_url }}"></canvas></div>
        <div class="sim-cell-pair">
          <div class="sim-cell"><canvas class="sim-states" id="fl-state-plot" aria-label="State history: altitude, airspeed, angle of attack, flight-path angle"></canvas></div>
          <div class="sim-cell"><canvas class="sim-states" id="fl-pid-plot" aria-label="PID contribution chart"></canvas></div>
        </div>
      </div>
      <div class="sim-panel">
        <h3>Controller</h3>
        <div class="mode-toggle" id="fl-mode" role="group" aria-label="Who is in control">
          <button class="mode-btn active" type="button" data-mode="manual" aria-pressed="true">Manual</button>
          <button class="mode-btn" type="button" data-mode="pid" aria-pressed="false">PID</button>
        </div>
        <p class="panel-hint"><strong>Manual:</strong> drag up to pitch the nose up, down for nose down; release to return to trim. Delay and noise apply to PID only.</p>
        <h3>Reference</h3>
        <div class="mode-toggle" id="fl-ref" role="group" aria-label="Reference signal">
          <button class="mode-btn active" type="button" data-ref="wave" aria-pressed="true">Wave</button>
          <button class="mode-btn" type="button" data-ref="step" aria-pressed="false">Step</button>
        </div>
        <div class="hint-box" hidden id="fl-hint" data-prefix="fl" data-gains="kp:0.5,ki:0.1,kd:0.35">
          <p class="hint-text"><strong>Stuck?</strong> A good solution is K<sub>p</sub>&#8201;=&#8201;0.5, K<sub>i</sub>&#8201;=&#8201;0.1, K<sub>d</sub>&#8201;=&#8201;0.35. K<sub>d</sub> damps the climb rate, and K<sub>i</sub> holds the altitude against drift.</p>
          <div class="hint-row"><button class="sim-btn hint-apply" type="button">Try it</button></div>
        </div>
        <h3>PID Gains</h3>
        <div class="pid-group">
          <label>K<sub>p</sub> <span id="fl-kp-val">0.000</span></label>
          <input type="range" id="fl-kp" min="-0.5" max="0.5" step="0.005" value="0">
          <div class="range-row"><label class="range-lbl" for="fl-kp-range"><span class="visually-hidden">Range </span>±</label><input type="number" id="fl-kp-range" class="range-input" value="0.5" min="0.05" step="0.05"></div>
        </div>
        <div class="pid-group">
          <label>K<sub>i</sub> <span id="fl-ki-val">0.000</span></label>
          <input type="range" id="fl-ki" min="-0.5" max="0.5" step="0.005" value="0">
          <div class="range-row"><label class="range-lbl" for="fl-ki-range"><span class="visually-hidden">Range </span>±</label><input type="number" id="fl-ki-range" class="range-input" value="0.5" min="0.05" step="0.05"></div>
        </div>
        <div class="pid-group">
          <label>K<sub>d</sub> <span id="fl-kd-val">0.000</span></label>
          <input type="range" id="fl-kd" min="-0.5" max="0.5" step="0.005" value="0">
          <div class="range-row"><label class="range-lbl" for="fl-kd-range"><span class="visually-hidden">Range </span>±</label><input type="number" id="fl-kd-range" class="range-input" value="0.5" min="0.05" step="0.05"></div>
        </div>
        <h3>Disturbances</h3>
        <div class="pid-group">
          <label>Delay <span id="fl-delay-val">0 ms</span></label>
          <input type="range" id="fl-delay" min="0" max="1000" step="10" value="0">
          <div class="range-row"><label class="range-lbl visually-hidden" for="fl-delay-amt">Delay amount (ms)</label><input type="number" id="fl-delay-amt" class="range-input" value="0" min="0" max="1000" step="10"></div>
        </div>
        <div class="pid-group">
          <label>Sensor noise &#963; <span id="fl-noise-val">0.00</span></label>
          <input type="range" id="fl-noise" min="0" max="0.5" step="0.01" value="0">
        </div>
        <div class="score-block">
          <span class="score-value" id="fl-score">-</span>
          <span class="score-label">RMSE (m)</span>
          <div class="score-best" id="fl-best"></div>
        </div>
        <button class="sim-btn" id="fl-reset" type="button">Reset</button>
      </div>
    </div>
    <div class="demo-note">
      <h4 class="demo-note-title">About this demo</h4>
      <p>
        A nonlinear longitudinal aircraft model with six states (V, &#947;, &#945;, q, h, x) and
        a smooth stall: C<sub>L</sub> rises linearly up to about 16&#176; angle of attack, then
        drops sharply. A <strong>PID autopilot</strong> tracks an altitude reference, a sine wave or a
        <strong>step</strong> that jumps up and down every half period, by moving the elevator
        away from trim. Altitude error goes in, and a nose-up elevator command
        in degrees comes out. The aircraft can only change altitude <em>through</em> its pitch and
        flight-path angle, so K<sub>p</sub> alone oscillates. K<sub>d</sub> acts on climb rate,
        and it is what damps the oscillation. Push too hard and the wing stalls. Delay and sensor
        noise work as in the other demos, with noise &#963; in metres. In Manual mode the canvas
        is a control stick: drag up to pitch the nose up, and let go to return to trim. &#8594;
        <a href="https://en.wikipedia.org/wiki/Flight_dynamics_(fixed-wing_aircraft)" target="_blank" rel="noopener">Flight dynamics - Wikipedia</a>,
        <a href="https://en.wikipedia.org/wiki/Autopilot" target="_blank" rel="noopener">Autopilot - Wikipedia</a>
      </p>
    </div>
    <div class="demo-note">
      <h4 class="demo-note-title">Equations of motion</h4>
      <div class="eqn-block">
        <div class="eqn-row"><span class="eqn-lhs">V&#775;</span><span class="eqn-eq">=</span><span class="eqn-rhs">[T cos&#945; &#8722; D] / m &#8722; g sin&#947;</span></div>
        <div class="eqn-row"><span class="eqn-lhs">&#947;&#775;</span><span class="eqn-eq">=</span><span class="eqn-rhs">[T sin&#945; + L &#8722; mg cos&#947;] / (mV)</span></div>
        <div class="eqn-row"><span class="eqn-lhs">&#945;&#775;</span><span class="eqn-eq">=</span><span class="eqn-rhs">q &#8722; &#947;&#775;</span></div>
        <div class="eqn-row"><span class="eqn-lhs">q&#775;</span><span class="eqn-eq">=</span><span class="eqn-rhs">M<sub>y</sub> / I<sub>yy</sub></span></div>
        <div class="eqn-row"><span class="eqn-lhs">h&#775;</span><span class="eqn-eq">=</span><span class="eqn-rhs">V sin&#947;</span></div>
        <div class="eqn-row"><span class="eqn-lhs">x&#775;</span><span class="eqn-eq">=</span><span class="eqn-rhs">V cos&#947;</span></div>
        <p class="eqn-note">L, D, M<sub>y</sub> from nonlinear aero (sigmoid stall ~16&#176;). T = trim thrust. RK4 at 200 Hz.</p>
      </div>
    </div>
    <div class="demo-note">
      <h4 class="demo-note-title">PID autopilot</h4>
      <div class="eqn-block">
        <div class="eqn-row"><span class="eqn-lhs">e</span><span class="eqn-eq">=</span><span class="eqn-rhs">h<sub>ref</sub>(t) &#8722; h<sub>meas</sub>,&#160;&#160; h<sub>ref</sub> = 60 + 25 sin(2&#960;t / 16)&#160;m</span></div>
        <div class="eqn-row"><span class="eqn-lhs">u</span><span class="eqn-eq">=</span><span class="eqn-rhs">K<sub>p</sub>e + K<sub>i</sub>&#8747;e&#8202;dt + K<sub>d</sub>&#8202;&#279;&#160;&#160;&#160;(nose-up command, &#176;)</span></div>
        <div class="eqn-row"><span class="eqn-lhs">&#948;<sub>e</sub></span><span class="eqn-eq">=</span><span class="eqn-rhs">&#948;<sub>e,trim</sub> &#8722; u</span></div>
        <p class="eqn-note">Elevator clamped &#177;15&#176; and slew-limited to 40&#176;/s. The run resets on a crash, a stall, a loop, or a climb past 590&#160;m. The score is altitude RMSE over the last 6 s.</p>
      </div>
    </div>
  </section>

  <!-- ── Demo 4: Cart-Pole PID ────────────────────────────────────── -->
  <section class="sim-section" id="sec-cartpole" role="tabpanel" aria-labelledby="tab-cartpole">
    <div class="sim-layout">
      <div class="sim-canvas-wrap sim-stack">
        <div class="sim-cell"><canvas class="sim-canvas" id="cp-canvas" aria-label="Cart-pole balancing simulation"></canvas></div>
        <div class="sim-cell-pair">
          <div class="sim-cell"><canvas class="sim-states" id="cp-state-plot" aria-label="State history: cart position, velocity, pole angle, pole rate"></canvas></div>
          <div class="sim-cell"><canvas class="sim-states" id="cp-pid-plot" aria-label="Controller contribution chart"></canvas></div>
        </div>
      </div>
      <div class="sim-panel">
        <h3>Controller</h3>
        <div class="mode-toggle" id="cp-mode" role="group" aria-label="Who is in control">
          <button class="mode-btn active" type="button" data-mode="manual" aria-pressed="true">Manual</button>
          <button class="mode-btn" type="button" data-mode="pid" aria-pressed="false">LQR</button>
        </div>
        <p class="panel-hint"><strong>Manual:</strong> drag the cart. Delay and noise apply to the controller only.</p>
        <h3>Reference</h3>
        <div class="mode-toggle" id="cp-ref" role="group" aria-label="Reference signal">
          <button class="mode-btn active" type="button" data-ref="wave" aria-pressed="true">Wave</button>
          <button class="mode-btn" type="button" data-ref="step" aria-pressed="false">Step</button>
        </div>
        <div class="hint-box" hidden id="cp-hint" data-prefix="cp" data-gains="kx:3.1,kv:5.9,kth:43.5,kw:18.1">
          <p class="hint-text"><strong>Stuck?</strong> A good solution is k<sub>x</sub>&#8201;=&#8201;3.1, k<sub>&#7819;</sub>&#8201;=&#8201;5.9, k<sub>&#952;</sub>&#8201;=&#8201;43.5, k<sub>&#952;&#775;</sub>&#8201;=&#8201;18.1. These are the LQR gains. The pole terms keep it up and the cart terms pull it back to the middle.</p>
          <div class="hint-row"><button class="sim-btn hint-apply" type="button">Try it</button></div>
        </div>
        <h3>State-feedback gains</h3>
        <div class="mx-line" aria-label="Force equals the gain row times the state column">
          <span class="mx-f">F =</span>
          <span class="mx mx-row"><span id="cp-mx-kx">0.0</span><span id="cp-mx-kv">0.0</span><span id="cp-mx-kth">0.0</span><span id="cp-mx-kw">0.0</span></span>
          <span class="mx mx-col mx-state"><span>x</span><span>&#7819;</span><span>&#952;</span><span>&#952;&#775;</span></span>
        </div>
        <div class="pid-group">
          <label>k<sub>x</sub>&nbsp;&middot;&nbsp;position <span id="cp-kx-val">0.0</span></label>
          <input type="range" id="cp-kx" min="-20" max="20" step="0.1" value="0">
          <div class="range-row"><label class="range-lbl" for="cp-kx-range"><span class="visually-hidden">Range </span>±</label><input type="number" id="cp-kx-range" class="range-input" value="20" min="1" step="1"></div>
        </div>
        <div class="pid-group">
          <label>k<sub>&#7819;</sub>&nbsp;&middot;&nbsp;velocity <span id="cp-kv-val">0.0</span></label>
          <input type="range" id="cp-kv" min="-20" max="20" step="0.1" value="0">
          <div class="range-row"><label class="range-lbl" for="cp-kv-range"><span class="visually-hidden">Range </span>±</label><input type="number" id="cp-kv-range" class="range-input" value="20" min="1" step="1"></div>
        </div>
        <div class="pid-group">
          <label>k<sub>&#952;</sub>&nbsp;&middot;&nbsp;pole angle <span id="cp-kth-val">0.0</span></label>
          <input type="range" id="cp-kth" min="-100" max="100" step="0.5" value="0">
          <div class="range-row"><label class="range-lbl" for="cp-kth-range"><span class="visually-hidden">Range </span>±</label><input type="number" id="cp-kth-range" class="range-input" value="100" min="1" step="1"></div>
        </div>
        <div class="pid-group">
          <label>k<sub>&#952;&#775;</sub>&nbsp;&middot;&nbsp;pole rate <span id="cp-kw-val">0.0</span></label>
          <input type="range" id="cp-kw" min="-40" max="40" step="0.1" value="0">
          <div class="range-row"><label class="range-lbl" for="cp-kw-range"><span class="visually-hidden">Range </span>±</label><input type="number" id="cp-kw-range" class="range-input" value="40" min="1" step="1"></div>
        </div>
        <button class="sim-btn" id="cp-lqr" type="button">Load LQR gains</button>
        <h3>Disturbances</h3>
        <div class="pid-group">
          <label>Delay <span id="cp-delay-val">0 ms</span></label>
          <input type="range" id="cp-delay" min="0" max="1000" step="10" value="0">
          <div class="range-row"><label class="range-lbl visually-hidden" for="cp-delay-amt">Delay amount (ms)</label><input type="number" id="cp-delay-amt" class="range-input" value="0" min="0" max="1000" step="10"></div>
        </div>
        <div class="pid-group">
          <label>Sensor noise &#963; <span id="cp-noise-val">0.00&#176;</span></label>
          <input type="range" id="cp-noise" min="0" max="2" step="0.05" value="0">
        </div>
        <div class="score-block">
          <span class="score-value" id="cp-score">-</span>
          <span class="score-label">RMSE (m)</span>
          <div class="score-best" id="cp-best"></div>
        </div>
        <button class="sim-btn" id="cp-reset" type="button">Reset</button>
      </div>
    </div>

    <div class="demo-note">
      <h4 class="demo-note-title">About this demo</h4>
      <p>
        The <strong>cart-pole</strong> is the classic unstable plant: a pole hinged on a cart that
        can only be pushed left or right. Each trial starts with the pole <em>upright</em>, tilted
        1&#8211;4&#176; at random, and with no control it falls within a second or two. One force has to
        hold two things at once, the pole angle and the cart position, so this demo uses
        <strong>full-state feedback</strong> instead of a single PID loop: the force is a weighted
        sum of cart position, cart velocity, pole angle and pole rate. Start with
        k<sub>&#952;</sub> and k<sub>&#952;&#775;</sub>. They keep the pole up, but the cart then drifts away
        and eventually the pole falls. Adding k<sub>x</sub> and k<sub>&#7819;</sub> makes the cart follow
        the reference position (the dashed marker on the rail), which is a sine wave or a
        <strong>step</strong> that jumps to the other side every half period. Their sign looks
        backwards at first: to bring the cart left, it must first be pushed right so the pole tips
        left. Hand-tuning four gains is hard, so
        <strong>Load LQR gains</strong> fills in the optimal set, found by solving a Riccati
        equation for this plant. LQR picks the gains by trading off state error against force use
        (here Q&#8201;=&#8201;diag(1, 0.1, 10, 0.1), R&#8201;=&#8201;0.1). The rail is 8 m long with hard stops, and
        running into an end ends the trial. Sensor noise perturbs all four measurements the controller sees (sigma degrees on the angle, sigma centimetres on the cart position, and the same amount per 0.2 s on the two rates), never the force. The score is the RMS position error over the last 10 s. Switch to
        Manual and drag the cart to balance the pole yourself. &#8594;
        <a href="https://en.wikipedia.org/wiki/Inverted_pendulum" target="_blank" rel="noopener">Inverted pendulum - Wikipedia</a>
      </p>
    </div>
    <div class="demo-note">
      <h4 class="demo-note-title">Equations of motion &amp; control law</h4>
      <div class="eqn-block">
        <div class="eqn-row"><span class="eqn-lhs">&#952;&#776;</span><span class="eqn-eq">=</span><span class="eqn-rhs">[g sin&#952; &#8722; cos&#952;&#183;&#964;] / [&#8467;(4/3 &#8722; m cos&#178;&#952; / (M+m))]</span></div>
        <div class="eqn-row"><span class="eqn-lhs">x&#776;</span><span class="eqn-eq">=</span><span class="eqn-rhs">&#964; &#8722; m&#8467;&#952;&#776; cos&#952; / (M+m),&#160;&#160; &#964; = [F &#8722; b&#7819; + m&#8467;&#952;&#775;&#178; sin&#952;] / (M+m)</span></div>
        <div class="eqn-row" style="align-items:center"><span class="eqn-lhs">F</span><span class="eqn-eq">=</span><span class="eqn-rhs"><span class="mx mx-row"><span>k<sub>x</sub></span><span>k<sub>&#7819;</sub></span><span>k<sub>&#952;</sub></span><span>k<sub>&#952;&#775;</sub></span></span><span class="mx mx-col"><span>x</span><span>&#7819;</span><span>&#952;</span><span>&#952;&#775;</span></span>&#160;&#160;=&#160;&#160;&#8722;K&#8201;<b>s</b>,&#160;&#160; <b>s</b> =<span class="mx mx-col"><span>x</span><span>&#7819;</span><span>&#952;</span><span>&#952;&#775;</span></span></span></div>
        <p class="eqn-note">Linearised about upright (small &#952;), with this cart-pole's numbers. Q and R weight state error against force; the Riccati solution for them gives K.</p>
        <div class="eqn-row" style="align-items:center"><span class="eqn-lhs">s&#775;</span><span class="eqn-eq">=</span><span class="eqn-rhs"><span class="mx mx-grid" style="grid-template-columns:repeat(4,auto)"><span>0</span><span>1</span><span>0</span><span>0</span><span>0</span><span>&#8722;2.13</span><span>&#8722;5.89</span><span>0</span><span>0</span><span>0</span><span>0</span><span>1</span><span>0</span><span>1.07</span><span>7.85</span><span>0</span></span><span class="mx mx-col"><span>x</span><span>&#7819;</span><span>&#952;</span><span>&#952;&#775;</span></span> + <span class="mx mx-col"><span>0</span><span>2.67</span><span>0</span><span>&#8722;1.33</span></span>F</span></div>
        <div class="eqn-row" style="align-items:center"><span class="eqn-lhs">Q</span><span class="eqn-eq">=</span><span class="eqn-rhs"><span class="mx mx-grid" style="grid-template-columns:repeat(4,auto)"><span>1</span><span>0</span><span>0</span><span>0</span><span>0</span><span>0.1</span><span>0</span><span>0</span><span>0</span><span>0</span><span>10</span><span>0</span><span>0</span><span>0</span><span>0</span><span>0.1</span></span>,&#160;&#160; R = 0.1</span></div>
        <div class="eqn-row" style="align-items:center"><span class="eqn-lhs">K</span><span class="eqn-eq">=</span><span class="eqn-rhs"><span class="mx mx-row"><span>&#8722;3.1</span><span>&#8722;5.9</span><span>&#8722;43.5</span><span>&#8722;18.1</span></span>,&#160;&#160; F = &#8722;K<b>s</b></span></div>
        <p class="eqn-note">M = 0.3 kg cart, m = 0.3 kg pole, &#8467; = 1.5 m half-length, b = 0.8 N&#183;s/m cart friction, g = 9.81 m/s&#178;. Force saturates at &#177;10 N; LQR's K comes out negative in every entry (u = &#8722;K<b>s</b>), so the sliders show &#8722;K and all four gains are positive. &#952; is in rad, measured from vertical. The trial ends when |&#952;| &gt; 45&#176; or the cart hits a rail end at &#177;4 m. RK4 at 200 Hz.</p>
      </div>
    </div>
  </section>

</div>

<script src="{{ '/assets/js/statebox.js' | relative_url }}"></script>
<script src="{{ '/assets/js/controls.js' | relative_url }}"></script>

<style>
.ctrl-row{display:flex;flex-direction:column;gap:.2rem;margin:.35rem 0}
.ctrl-row label{display:flex;justify-content:space-between;align-items:baseline;font-size:.85rem;font-weight:550;color:var(--text-muted)}
.ctrl-row label span{font-family:var(--mono);font-size:.82rem;color:var(--accent);font-weight:400}
.ctrl-row input[type="range"]{width:100%;accent-color:var(--accent);cursor:pointer}
.eqn-block{padding:.25rem 0 0;font-family:var(--mono);font-size:.8rem}
.eqn-row{display:flex;gap:.4rem;margin:.18rem 0}
.eqn-lhs{min-width:2.4rem;text-align:right;font-weight:600}
.eqn-eq{min-width:1rem}
.eqn-rhs{color:var(--text-muted)}
.range-row{display:flex;align-items:center;gap:.25rem}
.range-lbl{font-size:.75rem;color:var(--text-muted);white-space:nowrap}
.range-input{width:3.6rem;font-size:.78rem;padding:.15rem .3rem;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text)}
.trial-status-row{display:flex;justify-content:space-between;align-items:center;gap:.5rem;margin:.3rem 0 .2rem;background:var(--bg-soft);border:1px solid var(--border);border-radius:6px;padding:.35rem .55rem}
.trial-status-text{font-size:.82rem;color:var(--text-muted)}
.trial-status-text.success{color:#22c55e;font-weight:600}
.trial-status-text.failed{color:#ef4444}
.trial-timer{font-family:var(--mono);font-size:1.1rem;font-weight:700;color:var(--accent);min-width:4ch;text-align:right}
.trial-timer.urgent{color:#ef4444}
</style>
