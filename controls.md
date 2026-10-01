---
layout: default
title: Controls
description: Interactive control-systems demos — tune one PID controller on a mass-spring, tilt table, flight sim, and cart-pole.
permalink: /controls/
---
<section class="wrap page-head">
  <h1 class="page-title">Control Systems</h1>
  <p class="page-sub controls-intro">
    Four live simulations, one controller. Tune the same <strong>PID</strong> panel on a
    mass-spring, a ball-balancing tilt table, a nonlinear aircraft autopilot, and an inverted
    pendulum on a cart, then add transport delay and sensor noise to see what breaks it. Switch
    any demo to <strong>Manual</strong> and drag the plant yourself to feel how hard the job is.
    The plots under each sim show the plant's states and what each of P, I, and D is contributing.
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
        <div class="sim-cell">
          <div class="msd-stage">
            <canvas class="sim-canvas msd-anim" id="msd-canvas" aria-label="Mass-spring-damper simulation"></canvas>
            <canvas class="sim-canvas msd-ts" id="msd-ts-plot" aria-label="Position vs reference time series"></canvas>
          </div>
        </div>
        <div class="sim-cell-pair">
          <div class="sim-cell"><canvas class="sim-states" id="msd-state-plot" aria-label="State history: position, velocity, tracking error, applied force"></canvas></div>
          <div class="sim-cell"><canvas class="sim-states" id="msd-pid-plot" aria-label="PID contribution chart"></canvas></div>
        </div>
      </div>
      <div class="sim-panel">
        <h3>Controller</h3>
        <div class="mode-toggle" id="msd-mode" role="group" aria-label="Who is in control">
          <button class="mode-btn active" type="button" data-mode="pid" aria-pressed="true">PID</button>
          <button class="mode-btn" type="button" data-mode="manual" aria-pressed="false">Manual</button>
        </div>
        <p class="panel-hint"><strong>Manual:</strong> drag the mass up or down. Delay and noise apply to PID only.</p>
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
          <span class="score-value" id="msd-score">&#8212;</span>
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
        (&#950; &#8776; 0.1) to track a slow sine reference. The <em>proportional</em> term
        reacts to the current error, the <em>integral</em> term removes steady-state offset, and
        the <em>derivative</em> term damps oscillation. The score is RMSE over the last 5 s.
        Start with K<sub>p</sub> alone, add K<sub>d</sub> to cut the overshoot, then a small
        K<sub>i</sub> to remove what's left. Then add a <strong>transport delay</strong> to the
        command or <strong>sensor noise</strong> to the measurement: delay eats phase margin, and
        the derivative term amplifies noise the most. In Manual mode, drag the mass to follow the
        reference yourself. &#8594;
        <a href="https://en.wikipedia.org/wiki/PID_controller" target="_blank" rel="noopener">PID controller &#8212; Wikipedia</a>
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
          <button class="mode-btn active" type="button" data-mode="pid" aria-pressed="true">PID</button>
          <button class="mode-btn" type="button" data-mode="manual" aria-pressed="false">Manual</button>
        </div>
        <p class="panel-hint"><strong>Manual:</strong> drag the beam ends to tilt it. Delay and noise apply to PID only.</p>
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
          <span class="score-value" id="tilt-score">&#8212;</span>
          <span class="score-label">RMSE (m)</span>
          <div class="score-best" id="tilt-best"></div>
        </div>
        <button class="sim-btn" id="tilt-reset" type="button">Reset</button>
      </div>
    </div>
    <div class="demo-note">
      <h4 class="demo-note-title">About this demo</h4>
      <p>
        A <strong>PID controller</strong> tilts a beam to bring a rolling ball to rest at the
        centre. Each trial starts with the table flat and the ball somewhere in the
        <em>inner half</em> of the beam, rolling outward. A trial succeeds when the ball stays
        within 8 mm of centre, slower than 4 cm/s, for 0.5 s. It fails if the ball rolls off the
        end or 8 s pass. Either way, the next trial starts. The controller outputs a
        <em>commanded</em> tilt, and a servo turns the beam toward it at no more than
        60&nbsp;&#176;/s, so a big correction takes time. Watch &#952;&#775; saturate in the state
        plot. K<sub>p</sub> alone makes the ball oscillate, K<sub>d</sub> damps it, and a small
        K<sub>i</sub> removes any leftover offset. In Manual mode, drag either end of the beam to
        tilt it. The same servo limit applies to you. &#8594;
        <a href="https://en.wikipedia.org/wiki/Ball_and_beam" target="_blank" rel="noopener">Ball and beam &#8212; Wikipedia</a>
      </p>
    </div>
  </section>

  <!-- ── Demo 3: Flight Sim ──────────────────────────────────────── -->
  <section class="sim-section" id="sec-flight" role="tabpanel" aria-labelledby="tab-flight">
    <div class="sim-layout">
      <div class="sim-canvas-wrap sim-stack">
        <div class="sim-cell"><canvas class="sim-canvas" id="flight-canvas" aria-label="2D flight simulator"
                data-sprite="{{ '/assets/img/cessna.png' | relative_url }}"></canvas></div>
        <div class="sim-cell-pair">
          <div class="sim-cell"><canvas class="sim-states" id="fl-state-plot" aria-label="State history: altitude, airspeed, angle of attack, flight-path angle"></canvas></div>
          <div class="sim-cell"><canvas class="sim-states" id="fl-pid-plot" aria-label="PID contribution chart"></canvas></div>
        </div>
      </div>
      <div class="sim-panel">
        <h3>Controller</h3>
        <div class="mode-toggle" id="fl-mode" role="group" aria-label="Who is in control">
          <button class="mode-btn active" type="button" data-mode="pid" aria-pressed="true">PID</button>
          <button class="mode-btn" type="button" data-mode="manual" aria-pressed="false">Manual</button>
        </div>
        <p class="panel-hint"><strong>Manual:</strong> drag up to pitch the nose up, down for nose down; release to return to trim. Delay and noise apply to PID only.</p>
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
          <span class="score-value" id="fl-score">&#8212;</span>
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
        drops sharply. A <strong>PID autopilot</strong> tracks a sine-wave altitude reference by
        moving the elevator away from trim. Altitude error goes in, and a nose-up elevator command
        in degrees comes out. The aircraft can only change altitude <em>through</em> its pitch and
        flight-path angle, so K<sub>p</sub> alone oscillates. K<sub>d</sub> acts on climb rate,
        and it is what damps the oscillation. Push too hard and the wing stalls. Delay and sensor
        noise work as in the other demos, with noise &#963; in metres. In Manual mode the canvas
        is a control stick: drag up to pitch the nose up, and let go to return to trim. &#8594;
        <a href="https://en.wikipedia.org/wiki/Flight_dynamics_(fixed-wing_aircraft)" target="_blank" rel="noopener">Flight dynamics &#8212; Wikipedia</a>,
        <a href="https://en.wikipedia.org/wiki/Autopilot" target="_blank" rel="noopener">Autopilot &#8212; Wikipedia</a>
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
          <div class="sim-cell"><canvas class="sim-states" id="cp-pid-plot" aria-label="PID contribution chart"></canvas></div>
        </div>
      </div>
      <div class="sim-panel">
        <h3>Controller</h3>
        <div class="mode-toggle" id="cp-mode" role="group" aria-label="Who is in control">
          <button class="mode-btn active" type="button" data-mode="pid" aria-pressed="true">PID</button>
          <button class="mode-btn" type="button" data-mode="manual" aria-pressed="false">Manual</button>
        </div>
        <p class="panel-hint"><strong>Manual:</strong> drag the cart, or hold &#8592; &#8594;. Delay and noise apply to PID only.</p>
        <h3>PID Gains</h3>
        <div class="pid-group">
          <label>K<sub>p</sub> <span id="cp-kp-val">0.00</span></label>
          <input type="range" id="cp-kp" min="-100" max="100" step="1" value="0">
          <div class="range-row"><label class="range-lbl" for="cp-kp-range"><span class="visually-hidden">Range </span>±</label><input type="number" id="cp-kp-range" class="range-input" value="100" min="1" step="1"></div>
        </div>
        <div class="pid-group">
          <label>K<sub>i</sub> <span id="cp-ki-val">0.00</span></label>
          <input type="range" id="cp-ki" min="-50" max="50" step="0.5" value="0">
          <div class="range-row"><label class="range-lbl" for="cp-ki-range"><span class="visually-hidden">Range </span>±</label><input type="number" id="cp-ki-range" class="range-input" value="50" min="1" step="1"></div>
        </div>
        <div class="pid-group">
          <label>K<sub>d</sub> <span id="cp-kd-val">0.00</span></label>
          <input type="range" id="cp-kd" min="-20" max="20" step="0.2" value="0">
          <div class="range-row"><label class="range-lbl" for="cp-kd-range"><span class="visually-hidden">Range </span>±</label><input type="number" id="cp-kd-range" class="range-input" value="20" min="1" step="1"></div>
        </div>
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
          <span class="score-value" id="cp-score">&#8212;</span>
          <span class="score-label">RMS &#952; (&#176;)</span>
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
        1&#8211;4&#176; at random, and with no control it falls within a second or two. A
        <strong>PID controller</strong> on the pole angle drives the cart back under the pole.
        Start with K<sub>p</sub>. Nothing happens until it is strong enough to beat gravity. Then
        add K<sub>d</sub> to stop the wobble. With P and D alone the pole stays up, but the cart
        slowly speeds up until the pole falls. That drift is a real limit of a single loop on
        &#952;, because nothing is measuring the cart. A K<sub>i</sub> above roughly
        b&#183;g &#8776; 12 cancels it by supplying the force that friction takes away. The track
        has no ends and the camera follows the cart. The score is RMS pole angle over the last
        10 s. Hold the &#8592;&#8594; arrow keys to shove the cart and test your tune, or switch to
        Manual and drag the cart to balance the pole yourself. &#8594;
        <a href="https://en.wikipedia.org/wiki/Inverted_pendulum" target="_blank" rel="noopener">Inverted pendulum &#8212; Wikipedia</a>
      </p>
    </div>
    <div class="demo-note">
      <h4 class="demo-note-title">Equations of motion &amp; control law</h4>
      <div class="eqn-block">
        <div class="eqn-row"><span class="eqn-lhs">&#952;&#776;</span><span class="eqn-eq">=</span><span class="eqn-rhs">[g sin&#952; &#8722; cos&#952;&#183;&#964;] / [&#8467;(4/3 &#8722; m cos&#178;&#952; / (M+m))]</span></div>
        <div class="eqn-row"><span class="eqn-lhs">x&#776;</span><span class="eqn-eq">=</span><span class="eqn-rhs">&#964; &#8722; m&#8467;&#952;&#776; cos&#952; / (M+m),&#160;&#160; &#964; = [F &#8722; b&#7819; + m&#8467;&#952;&#775;&#178; sin&#952;] / (M+m)</span></div>
        <div class="eqn-row"><span class="eqn-lhs">F</span><span class="eqn-eq">=</span><span class="eqn-rhs">K<sub>p</sub>&#952; + K<sub>i</sub>&#8747;&#952;&#8202;dt + K<sub>d</sub>&#952;&#775;&#160;&#160;&#160;(&#952; in rad, measured from vertical)</span></div>
        <p class="eqn-note">M = 0.4 kg cart, m = 0.4 kg pole, &#8467; = 0.9 m half-length, b = 1.2 N&#183;s/m cart friction, g = 9.81 m/s&#178;. Force saturates at &#177;10 N; arrow-key pushes add &#177;4 N on top. The trial ends when |&#952;| &gt; 45&#176;. RK4 at 200 Hz.</p>
      </div>
    </div>
  </section>

</div>

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
