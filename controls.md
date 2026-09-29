---
layout: default
title: Controls
description: Interactive control-systems demos — PID tuning, tilt table, flight sim, cart-pole LQR and behavioral cloning.
permalink: /controls/
---
<section class="wrap page-head">
  <h1 class="page-title">Control Systems</h1>
  <p class="page-sub controls-intro">
    Four interactive demos spanning classical and modern control. Tune a PID controller on a
    mass-spring, a ball-balancing tilt table, and a nonlinear aircraft autopilot, then identify a
    cart-pole from data, balance it with an <strong>LQR controller</strong>, and train a neural
    network to take over.
  </p>
</section>

<div class="wrap" style="padding-bottom:3rem">
  <div class="sim-tabs" role="tablist" aria-label="Demo selector">
    <button class="sim-tab active" role="tab" aria-selected="true"  aria-controls="sec-msd"    id="tab-msd"    type="button">Intro</button>
    <button class="sim-tab"        role="tab" aria-selected="false" aria-controls="sec-tilt"   id="tab-tilt"   type="button">Tilt Table</button>
    <button class="sim-tab"        role="tab" aria-selected="false" aria-controls="sec-flight" id="tab-flight" type="button">Flight Sim</button>
    <button class="sim-tab"        role="tab" aria-selected="false" aria-controls="sec-sysid"  id="tab-sysid"  type="button">Cart-Pole LQR</button>
  </div>

  <!-- ── Demo 1: Mass-Spring-Damper ─────────────────────────────── -->
  <section class="sim-section active" id="sec-msd" role="tabpanel" aria-labelledby="tab-msd">
    <div class="sim-layout">
      <div class="sim-canvas-wrap">
        <div class="msd-stage">
          <canvas class="sim-canvas msd-anim" id="msd-canvas" width="220" height="320" aria-label="Mass-spring-damper simulation"></canvas>
          <canvas class="sim-canvas msd-ts" id="msd-ts-plot" width="480" height="320" aria-label="Position vs reference time series"></canvas>
        </div>
        <canvas class="msd-gain" id="msd-pid-plot" height="240" aria-label="PID contribution chart"></canvas>
      </div>
      <div class="sim-panel">
        <h3>PID Gains</h3>
        <div class="pid-group">
          <label>K<sub>p</sub> <span id="msd-kp-val">0.0</span></label>
          <input type="range" id="msd-kp" min="-50" max="50" step="0.5" value="0">
          <div class="range-row"><label class="range-lbl">Range ±</label><input type="number" id="msd-kp-range" class="range-input" value="50" min="1" step="1"></div>
        </div>
        <div class="pid-group">
          <label>K<sub>i</sub> <span id="msd-ki-val">0.0</span></label>
          <input type="range" id="msd-ki" min="-20" max="20" step="0.1" value="0">
          <div class="range-row"><label class="range-lbl">Range ±</label><input type="number" id="msd-ki-range" class="range-input" value="20" min="1" step="1"></div>
        </div>
        <div class="pid-group">
          <label>K<sub>d</sub> <span id="msd-kd-val">0.0</span></label>
          <input type="range" id="msd-kd" min="-10" max="10" step="0.05" value="0">
          <div class="range-row"><label class="range-lbl">Range ±</label><input type="number" id="msd-kd-range" class="range-input" value="10" min="1" step="1"></div>
        </div>
        <hr style="border:0;border-top:1px solid var(--border);margin:.25rem 0">
        <h3>Disturbances</h3>
        <div class="pid-group">
          <label>Delay <span id="msd-delay-val">0 ms</span></label>
          <input type="range" id="msd-delay" min="0" max="1000" step="10" value="0">
          <div class="range-row"><label class="range-lbl">Amount (ms)</label><input type="number" id="msd-delay-amt" class="range-input" value="0" min="0" max="1000" step="10"></div>
        </div>
        <div class="pid-group">
          <label>Sensor noise &#963; <span id="msd-noise-val">0.00</span></label>
          <input type="range" id="msd-noise" min="0" max="0.5" step="0.01" value="0">
        </div>
        <hr style="border:0;border-top:1px solid var(--border);margin:.25rem 0">
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
        A <strong>PID controller</strong> drives an underdamped mass-spring-damper to track a
        sinusoidal reference. The <em>proportional</em> term reacts to current error, the
        <em>integral</em> term eliminates steady-state offset, and the <em>derivative</em> term
        damps oscillation. RMSE measures average tracking accuracy over the last 10 s.
        Try starting with K<sub>p</sub> alone, then add K<sub>d</sub> to reduce overshoot,
        and finally a small K<sub>i</sub> to remove any remaining offset. Add a
        <strong>transport delay</strong> to the control command or inject <strong>sensor
        noise</strong> to see how each erodes stability &#8212; delay eats phase margin, and
        noise is amplified hardest by the derivative term. &#8594;
        <a href="https://en.wikipedia.org/wiki/PID_controller" target="_blank" rel="noopener">PID controller &#8212; Wikipedia</a>
      </p>
    </div>
  </section>

  <!-- ── Demo 2: Tilt Table ─────────────────────────────────────── -->
  <section class="sim-section" id="sec-tilt" role="tabpanel" aria-labelledby="tab-tilt">
    <div class="sim-layout">
      <div class="sim-canvas-wrap">
        <canvas class="sim-canvas" id="tilt-canvas" width="700" height="300" aria-label="Ball-balancing tilt table"></canvas>
        <canvas id="tilt-heatmap" height="200" style="display:block;width:100%;border-top:1px solid var(--border)" aria-label="Stabilisation heatmap by initial conditions"></canvas>
      </div>
      <div class="sim-panel">
        <h3>PID Gains</h3>
        <div class="pid-group">
          <label>K<sub>p</sub> <span id="tilt-kp-val">0.0</span></label>
          <input type="range" id="tilt-kp" min="-10" max="10" step="0.1" value="0">
          <div class="range-row"><label class="range-lbl">Range ±</label><input type="number" id="tilt-kp-range" class="range-input" value="10" min="1" step="1"></div>
        </div>
        <div class="pid-group">
          <label>K<sub>i</sub> <span id="tilt-ki-val">0.0</span></label>
          <input type="range" id="tilt-ki" min="-5" max="5" step="0.05" value="0">
          <div class="range-row"><label class="range-lbl">Range ±</label><input type="number" id="tilt-ki-range" class="range-input" value="5" min="1" step="1"></div>
        </div>
        <div class="pid-group">
          <label>K<sub>d</sub> <span id="tilt-kd-val">0.0</span></label>
          <input type="range" id="tilt-kd" min="-5" max="5" step="0.05" value="0">
          <div class="range-row"><label class="range-lbl">Range ±</label><input type="number" id="tilt-kd-range" class="range-input" value="5" min="1" step="1"></div>
        </div>
        <hr style="border:0;border-top:1px solid var(--border);margin:.25rem 0">
        <h3>Disturbances</h3>
        <div class="pid-group">
          <label>Delay <span id="tilt-delay-val">0 ms</span></label>
          <input type="range" id="tilt-delay" min="0" max="1000" step="10" value="0">
          <div class="range-row"><label class="range-lbl">Amount (ms)</label><input type="number" id="tilt-delay-amt" class="range-input" value="0" min="0" max="1000" step="10"></div>
        </div>
        <div class="pid-group">
          <label>Sensor noise &#963; <span id="tilt-noise-val">0.00</span></label>
          <input type="range" id="tilt-noise" min="0" max="0.5" step="0.01" value="0">
        </div>
        <hr style="border:0;border-top:1px solid var(--border);margin:.25rem 0">
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
        A <strong>PID controller</strong> tilts a beam to balance a rolling ball at the centre.
        Each trial starts with the ball at a random position in the <em>inner half</em> of the beam
        and a small random velocity; the table starts flat. A trial succeeds when the ball holds
        within 3 cm of centre for 0.5 s, and fails if it reaches the edge or 8 s elapse.
        The <strong>stabilisation heatmap</strong> below accumulates results across trials:
        x-axis = initial distance from centre, y-axis = initial speed, colour = time to stabilise
        (green = fast, red = slow, dark = failed, grey = no data). Start with K<sub>p</sub> alone
        &#8212; the ball oscillates; add K<sub>d</sub> to damp it; a small K<sub>i</sub> removes any
        residual offset. Watch the green region expand as the gains improve. &#8594;
        <a href="https://en.wikipedia.org/wiki/Ball_and_beam" target="_blank" rel="noopener">Ball and beam &#8212; Wikipedia</a>
      </p>
    </div>
  </section>

  <!-- ── Demo 3: Flight Sim ──────────────────────────────────────── -->
  <section class="sim-section" id="sec-flight" role="tabpanel" aria-labelledby="tab-flight">
    <div class="sim-layout">
      <div class="sim-canvas-wrap">
        <canvas class="sim-canvas" id="flight-canvas" width="720" height="380" aria-label="2D flight simulator"></canvas>
        <canvas id="fl-state-plot" height="150" style="display:block;width:100%;border-top:1px solid var(--border)" aria-label="State history"></canvas>
        <canvas id="fl-pid-plot"   height="180" style="display:block;width:100%;border-top:1px solid var(--border)" aria-label="PID contribution chart"></canvas>
      </div>
      <div class="sim-panel">
        <h3>PID Gains</h3>
        <div class="pid-group">
          <label>K<sub>p</sub> <span id="fl-kp-val">0.000</span></label>
          <input type="range" id="fl-kp" min="-0.5" max="0.5" step="0.005" value="0">
          <div class="range-row"><label class="range-lbl">Range &#177;</label><input type="number" id="fl-kp-range" class="range-input" value="0.5" min="0.05" step="0.05"></div>
        </div>
        <div class="pid-group">
          <label>K<sub>i</sub> <span id="fl-ki-val">0.000</span></label>
          <input type="range" id="fl-ki" min="-0.5" max="0.5" step="0.005" value="0">
          <div class="range-row"><label class="range-lbl">Range &#177;</label><input type="number" id="fl-ki-range" class="range-input" value="0.5" min="0.05" step="0.05"></div>
        </div>
        <div class="pid-group">
          <label>K<sub>d</sub> <span id="fl-kd-val">0.000</span></label>
          <input type="range" id="fl-kd" min="-0.5" max="0.5" step="0.005" value="0">
          <div class="range-row"><label class="range-lbl">Range &#177;</label><input type="number" id="fl-kd-range" class="range-input" value="0.5" min="0.05" step="0.05"></div>
        </div>
        <hr style="border:0;border-top:1px solid var(--border);margin:.25rem 0">
        <h3>Disturbances</h3>
        <div class="pid-group">
          <label>Delay <span id="fl-delay-val">0 ms</span></label>
          <input type="range" id="fl-delay" min="0" max="1000" step="10" value="0">
          <div class="range-row"><label class="range-lbl">Amount (ms)</label><input type="number" id="fl-delay-amt" class="range-input" value="0" min="0" max="1000" step="10"></div>
        </div>
        <div class="pid-group">
          <label>Sensor noise &#963; <span id="fl-noise-val">0.00</span></label>
          <input type="range" id="fl-noise" min="0" max="0.5" step="0.01" value="0">
        </div>
        <hr style="border:0;border-top:1px solid var(--border);margin:.25rem 0">
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
        A nonlinear longitudinal aircraft model with six states: airspeed V, flight-path angle &#947;,
        angle of attack &#945;, pitch rate q, altitude h, and downrange x. Lift uses a nonlinear
        stall model &#8212; C<sub>L</sub> rises linearly to ~16&#176; angle of attack then drops sharply,
        matching a real NACA airfoil curve. A PID autopilot tracks a sinusoidal altitude reference
        by commanding elevator deflection. &#8594;
        <a href="https://en.wikipedia.org/wiki/Flight_dynamics_(fixed-wing_aircraft)" target="_blank" rel="noopener">Flight dynamics &#8212; Wikipedia</a>,
        <a href="https://en.wikipedia.org/wiki/Angle_of_attack" target="_blank" rel="noopener">Angle of attack</a>
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
        <p class="eqn-note">L, D, M<sub>y</sub> from nonlinear aero model (sigmoid stall at ~16&#176;). T = trim thrust (constant). RK4 at 200 Hz.</p>
      </div>
    </div>
  </section>

  <!-- ── Demo 4: Cart-Pole System ID + LQR + Neural Net ──────────── -->
  <section class="sim-section" id="sec-sysid" role="tabpanel" aria-labelledby="tab-sysid">
    <div class="sim-layout">
      <div class="sim-canvas-wrap">
        <canvas class="sim-canvas" id="sysid-canvas" width="720" height="380" aria-label="Cart-pole balancing simulation"></canvas>
        <canvas id="sid-state-plot" height="160" style="display:block;width:100%;border-top:1px solid var(--border)" aria-label="State history: cart position, velocity, pole angle, pole rate"></canvas>
        <canvas id="sid-pid-plot"   height="180" style="display:block;width:100%;border-top:1px solid var(--border)" aria-label="LQR force contribution chart"></canvas>
      </div>
      <div class="sim-panel">
        <h3>1 &#8212; Swing-Up Trials</h3>
        <p class="panel-hint">Pole starts hanging down. Use &#8592;&#8594; arrow keys or the slider to push the cart and swing it upright. Hold within 20&#176; of vertical for 2 s to succeed. Each successful trial saves training data for the neural network.</p>
        <div class="trial-status-row">
          <span class="trial-status-text" id="sid-trial-status">Ready to start</span>
          <span class="trial-timer" id="sid-trial-timer">20.0 s</span>
        </div>
        <div class="sysid-count" id="sid-trials-saved">0 trials saved</div>
        <button class="sim-btn" id="sid-trial-btn" type="button">Start Trial</button>
        <div class="pid-group" style="margin-top:.5rem">
          <label>Push the cart <span id="sid-force-val">0.0 N</span></label>
          <input type="range" id="sid-force" min="-8" max="8" step="0.5" value="0">
          <div class="range-row"><label class="range-lbl">Range &#177;</label><input type="number" id="sid-force-range" class="range-input" value="8" min="1" step="1"></div>
        </div>

        <hr style="border:0;border-top:1px solid var(--border);margin:.1rem 0">
        <h3>2 &#8212; System ID</h3>
        <button class="sim-btn" id="sid-identify-btn" type="button" disabled>Identify System</button>
        <div class="matrix-section" id="sid-matrices" style="display:none">
          <div>
            <div class="matrix-label">A&#160; (4 &#215; 4)</div>
            <pre class="matrix-display" id="sid-A-display"></pre>
          </div>
          <div>
            <div class="matrix-label">B&#160; (4 &#215; 1)</div>
            <pre class="matrix-display" id="sid-B-display"></pre>
          </div>
        </div>

        <hr style="border:0;border-top:1px solid var(--border);margin:.1rem 0">
        <h3>3 &#8212; LQR</h3>
        <p style="font-size:.8rem;margin:.15rem 0 .4rem;color:var(--text-muted)">Cost weights — LQR minimises <em>x&#7488;Qx + u&#7488;Ru</em>. Higher Q punishes state error; higher R punishes large pushes.</p>
        <div class="ctrl-row"><label>Q<sub>x</sub> (cart position) <span id="sid-qx-val">5.0</span></label><input type="range" id="sid-qx" min="0" max="60" step="0.5" value="5"><div class="range-row"><label class="range-lbl">Max</label><input type="number" id="sid-qx-range" class="range-input" value="60" min="1" step="1"></div></div>
        <div class="ctrl-row"><label>Q<sub>&#952;</sub> (pole angle) <span id="sid-qth-val">100</span></label><input type="range" id="sid-qth" min="1" max="400" step="1" value="100"><div class="range-row"><label class="range-lbl">Max</label><input type="number" id="sid-qth-range" class="range-input" value="400" min="1" step="1"></div></div>
        <div class="ctrl-row"><label>Q<sub>&#952;&#775;</sub> (pole rate) <span id="sid-qthd-val">1.0</span></label><input type="range" id="sid-qthd" min="0" max="20" step="0.1" value="1"><div class="range-row"><label class="range-lbl">Max</label><input type="number" id="sid-qthd-range" class="range-input" value="20" min="1" step="1"></div></div>
        <div class="ctrl-row"><label>R (control effort) <span id="sid-r-val">0.10</span></label><input type="range" id="sid-r" min="0.01" max="2" step="0.01" value="0.10"><div class="range-row"><label class="range-lbl">Max</label><input type="number" id="sid-r-range" class="range-input" value="2" min="0.1" step="0.1"></div></div>
        <button class="sim-btn" id="sid-lqr-btn" type="button" disabled>Enable LQR</button>
        <button class="sim-btn" id="sid-analytic-lqr-btn" type="button" style="margin-top:.35rem">Analytic LQR</button>
        <div class="matrix-section" id="sid-lqr-section" style="display:none">
          <div>
            <div class="matrix-label">K&#160; (1 &#215; 4)</div>
            <pre class="matrix-display" id="sid-K-display"></pre>
          </div>
          <div class="score-compare" id="sid-score-compare"></div>
        </div>

        <hr style="border:0;border-top:1px solid var(--border);margin:.1rem 0">
        <h3>4 &#8212; Neural Network</h3>
        <p class="panel-hint">Train a feedforward net to imitate your swing-up demos. With saved trial data, &#8220;Prepare Training Data&#8221; converts them into input&#8211;output pairs. Without trials, falls back to LQR expert rollouts (balance only).</p>
        <div class="pid-group">
          <label>Hidden layers <span id="sid-nn-layers-val">1</span></label>
          <input type="range" id="sid-nn-layers" min="1" max="3" step="1" value="1">
        </div>
        <div class="pid-group">
          <label>Neurons / layer <span id="sid-nn-neurons-val">16</span></label>
          <input type="range" id="sid-nn-neurons" min="4" max="32" step="4" value="16">
        </div>
        <button class="sim-btn" id="sid-nn-gen-btn" type="button">Prepare Training Data</button>
        <div class="sysid-count" id="sid-nn-gen-status">Complete trials first, or uses LQR expert as fallback</div>
        <button class="sim-btn" id="sid-nn-train-btn" type="button" disabled style="margin-top:.35rem">Train Network</button>
        <canvas id="sid-nn-loss-canvas" height="60" style="width:100%;margin-top:.3rem" aria-label="Training loss"></canvas>
        <div class="sysid-count" id="sid-nn-train-status"></div>
        <button class="sim-btn" id="sid-nn-activate-btn" type="button" disabled style="margin-top:.35rem">Activate NN</button>

        <hr style="border:0;border-top:1px solid var(--border);margin:.25rem 0">
        <div class="score-block" style="padding-top:.25rem">
          <span class="score-value" id="sid-score">&#8212;</span>
          <span class="score-label">RMS &#952; (&#176;)</span>
        </div>
        <button class="sim-btn" id="sid-reset" type="button">Reset</button>
      </div>
    </div>

    <div class="nn-netviz" id="sid-netviz" style="display:none">
      <div class="nn-netviz-head">
        <h3>Network activations</h3>
        <div class="nn-legend" aria-hidden="true">
          <span class="nn-legend-cap">&#8722;</span>
          <span class="nn-legend-bar"></span>
          <span class="nn-legend-cap">+</span>
          <span class="nn-legend-txt">neuron activation</span>
        </div>
      </div>
      <canvas id="sid-net-canvas" height="440" aria-label="Neural network diagram with color-coded neuron activations"></canvas>
    </div>

    <div class="demo-note">
      <h4 class="demo-note-title">About this demo</h4>
      <p>
        The <strong>cart-pole</strong> is the classic unstable plant: a pole hinged on a cart that
        you can only push left or right. This demo turns it into a <strong>swing-up game</strong>:
        the pole starts hanging down and you have 20 seconds to swing it upright and hold it stable.
        Use &#8592;&#8594; arrow keys or the force slider to push the cart. Each successful trial
        (pole held within 20&#176; of vertical for 2 s) saves your actions as training data.
      </p>
      <p>
        Once you have saved trials, press <em>Prepare Training Data</em> to convert them into
        input&#8211;output pairs, then <em>Train Network</em> to fit a feedforward net via
        Adam SGD using <strong>behavioral cloning</strong> &#8212; the net learns to imitate
        your successful demonstrations. Press <em>Activate NN</em> to hand it the controls and
        watch it attempt the full swing-up from scratch. The optional <em>Analytic LQR</em>
        button solves the exact Jacobian-based balance gain if you want to compare against an
        optimal controller. &#8594;
        <a href="https://en.wikipedia.org/wiki/Inverted_pendulum" target="_blank" rel="noopener">Inverted pendulum &#8212; Wikipedia</a>,
        <a href="https://en.wikipedia.org/wiki/Behavioral_cloning" target="_blank" rel="noopener">Behavioral cloning</a>
      </p>
    </div>
    <div class="demo-note">
      <h4 class="demo-note-title">Equations of motion &amp; LQR</h4>
      <div class="eqn-block">
        <div class="eqn-row"><span class="eqn-lhs">&#952;&#776;</span><span class="eqn-eq">=</span><span class="eqn-rhs">[g sin&#952; &#8722; cos&#952;&#183;&#964;] / [&#8467;(4/3 &#8722; m cos&#178;&#952; / (M+m))]</span></div>
        <div class="eqn-row"><span class="eqn-lhs">x&#776;</span><span class="eqn-eq">=</span><span class="eqn-rhs">&#964; &#8722; m&#8467;&#952;&#776; cos&#952; / (M+m),&#160;&#160; &#964; = [F + m&#8467;&#952;&#775;&#178; sin&#952;] / (M+m)</span></div>
        <div class="eqn-row"><span class="eqn-lhs">A<sub>d</sub></span><span class="eqn-eq">=</span><span class="eqn-rhs">I + dt&#183;A,&#160; B<sub>d</sub> = dt&#183;B&#160;&#160;(dt = 0.025 s)</span></div>
        <div class="eqn-row"><span class="eqn-lhs">K</span><span class="eqn-eq">=</span><span class="eqn-rhs">(R + B<sub>d</sub>'PB<sub>d</sub>)<sup>&#8722;1</sup> B<sub>d</sub>'PA<sub>d</sub>,&#160; from the DARE solution P</span></div>
        <div class="eqn-row"><span class="eqn-lhs">F</span><span class="eqn-eq">=</span><span class="eqn-rhs">&#8722;K [x, &#7819;, &#952;, &#952;&#775;]'</span></div>
        <p class="eqn-note">M = 0.4 kg cart, m = 0.4 kg pole, &#8467; = 0.9 m half-length, g = 9.8 &#8212; a light cart under a long, heavy pole, so it shoves easily and topples slowly. State [x, &#7819;, &#952;, &#952;&#775;]; upright &#952; = 0 is unstable. Riccati recursion iterated to convergence.</p>
      </div>
    </div>
  </section>

</div>

<script src="{{ '/assets/js/controls.js' | relative_url }}"></script>

<style>
.demo-note{margin:.55rem 0 .85rem;border:1px solid var(--border);border-radius:8px;padding:.65rem .85rem;background:var(--bg-soft)}
.demo-note-title{margin:0 0 .35rem;font-size:.8rem;font-weight:600;color:var(--text);letter-spacing:.01em}
.demo-note>p{margin:.15rem 0;font-size:.82rem;line-height:1.55}
.demo-note>p+p{margin-top:.5rem}
.panel-hint{font-size:.75rem;line-height:1.45;color:var(--text-muted);margin:.1rem 0 .5rem}
.ctrl-row{display:flex;flex-direction:column;gap:.2rem;margin:.35rem 0}
.ctrl-row label{display:flex;justify-content:space-between;align-items:baseline;font-size:.85rem;font-weight:550;color:var(--text-muted)}
.ctrl-row label span{font-family:var(--mono);font-size:.82rem;color:var(--accent);font-weight:400}
.ctrl-row input[type="range"]{width:100%;accent-color:var(--accent);cursor:pointer}
.eqn-block{padding:.25rem 0 0;font-family:var(--mono);font-size:.8rem}
.eqn-row{display:flex;gap:.4rem;margin:.18rem 0}
.eqn-lhs{min-width:2.4rem;text-align:right;font-weight:600}
.eqn-eq{min-width:1rem}
.eqn-rhs{color:var(--text-muted)}
.eqn-note{margin:.5rem 0 0;font-size:.74rem;color:var(--text-muted);font-family:var(--font);font-style:italic}
.range-row{display:flex;align-items:center;gap:.35rem;margin-top:.2rem}
.range-lbl{font-size:.75rem;color:var(--text-muted);white-space:nowrap}
.range-input{width:5rem;font-size:.78rem;padding:.15rem .3rem;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text)}
.trial-status-row{display:flex;justify-content:space-between;align-items:center;gap:.5rem;margin:.3rem 0 .2rem;background:var(--bg-soft);border:1px solid var(--border);border-radius:6px;padding:.35rem .55rem}
.trial-status-text{font-size:.82rem;color:var(--text-muted)}
.trial-status-text.success{color:#22c55e;font-weight:600}
.trial-status-text.failed{color:#ef4444}
.trial-timer{font-family:var(--mono);font-size:1.1rem;font-weight:700;color:var(--accent);min-width:4ch;text-align:right}
.trial-timer.urgent{color:#ef4444}
</style>
