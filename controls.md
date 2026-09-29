---
layout: default
title: Controls
description: Interactive control-systems demos — PID tuning, tilt table, flight sim, cart-pole PPO.
permalink: /controls/
---
<section class="wrap page-head">
  <h1 class="page-title">Control Systems</h1>
  <p class="page-sub controls-intro">
    Four interactive demos spanning classical and modern control. Tune a PID controller on a
    mass-spring, a ball-balancing tilt table, and a nonlinear aircraft autopilot, then identify a
    cart-pole balance it with a <strong>PPO policy network</strong>, and train a neural
    network to take over.
  </p>
</section>

<div class="wrap" style="padding-bottom:3rem">
  <div class="sim-tabs" role="tablist" aria-label="Demo selector">
    <button class="sim-tab active" role="tab" aria-selected="true"  aria-controls="sec-msd"    id="tab-msd"    type="button">Intro</button>
    <button class="sim-tab"        role="tab" aria-selected="false" aria-controls="sec-tilt"   id="tab-tilt"   type="button">Tilt Table</button>
    <button class="sim-tab"        role="tab" aria-selected="false" aria-controls="sec-flight" id="tab-flight" type="button">Flight Sim</button>
    <button class="sim-tab"        role="tab" aria-selected="false" aria-controls="sec-sysid"  id="tab-sysid"  type="button">Cart-Pole PPO</button>
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
        and a small outward velocity; the table starts flat. A trial succeeds when the ball holds
        within 8 mm of centre at under 4 cm/s for 0.5 s, and fails if it reaches the edge or 8 s elapse.
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
        <h3>System Identification</h3>
        <p class="panel-hint">Excite the aircraft with a PRBS elevator signal (&#177;5&#176;) for 15 s, then fit a discrete-time linear model by least squares.</p>
        <button class="sim-btn" id="fl-record-btn" type="button">Record Excitation (15 s)</button>
        <div class="sysid-count" id="fl-sysid-status">Press Record to begin</div>
        <button class="sim-btn" id="fl-fit-btn" type="button" disabled style="margin-top:.3rem">Fit Linear Model</button>
        <hr style="border:0;border-top:1px solid var(--border);margin:.5rem 0">
        <h3>LQR Design</h3>
        <p class="panel-hint">Tune cost weights, then solve the discrete Riccati equation (DARE) to get the optimal feedback gain K.</p>
        <div class="pid-group">
          <label>Q (state cost weight) <span id="fl-q-val">1.00</span></label>
          <input type="range" id="fl-q" min="0.1" max="10" step="0.1" value="1">
        </div>
        <div class="pid-group">
          <label>R (control cost) <span id="fl-r-val">1.00</span></label>
          <input type="range" id="fl-r" min="0.1" max="20" step="0.1" value="1">
        </div>
        <button class="sim-btn" id="fl-lqr-btn" type="button" disabled>Compute LQR</button>
        <button class="sim-btn" id="fl-activate-btn" type="button" disabled style="margin-top:.3rem">Activate LQR</button>
        <hr style="border:0;border-top:1px solid var(--border);margin:.5rem 0">
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
        A nonlinear 6-state longitudinal aircraft model (V, &#947;, &#945;, q, h, x) with a sigmoid
        stall model. Each trial starts the plane at a random altitude and pitch offset from a random
        flat reference altitude (dashed line). The workflow mirrors the tilt table but uses
        data-driven control: (1) <strong>record</strong> a PRBS elevator excitation to collect
        input&#8211;output data; (2) <strong>fit</strong> a discrete-time linear model
        &#916;x<sub>k+1</sub> = F<sub>d</sub>&#916;x<sub>k</sub> + G<sub>d</sub>&#916;u<sub>k</sub>
        around the trim point; (3) <strong>design</strong> an LQR controller by solving the
        discrete algebraic Riccati equation; (4) <strong>activate</strong> &#8212; the plane then
        corrects any random starting condition to the reference. &#8594;
        <a href="https://en.wikipedia.org/wiki/System_identification" target="_blank" rel="noopener">System identification &#8212; Wikipedia</a>,
        <a href="https://en.wikipedia.org/wiki/Linear%E2%80%93quadratic_regulator" target="_blank" rel="noopener">LQR &#8212; Wikipedia</a>
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
      <h4 class="demo-note-title">System ID &amp; LQR</h4>
      <div class="eqn-block">
        <div class="eqn-row"><span class="eqn-lhs">&#916;x<sub>k+1</sub></span><span class="eqn-eq">=</span><span class="eqn-rhs">F<sub>d</sub>&#160;&#916;x<sub>k</sub> + G<sub>d</sub>&#160;&#916;u<sub>k</sub>&#160;&#160;&#160;(fit by least squares from PRBS data)</span></div>
        <div class="eqn-row"><span class="eqn-lhs">J</span><span class="eqn-eq">=</span><span class="eqn-rhs">&#8721;<sub>k</sub> (&#916;x<sub>k</sub><sup>T</sup> Q &#916;x<sub>k</sub> + R&#160;&#916;u<sub>k</sub><sup>2</sup>)</span></div>
        <div class="eqn-row"><span class="eqn-lhs">P</span><span class="eqn-eq">=</span><span class="eqn-rhs">Q + F<sub>d</sub><sup>T</sup> P F<sub>d</sub> &#8722; F<sub>d</sub><sup>T</sup> P G<sub>d</sub> (R + G<sub>d</sub><sup>T</sup> P G<sub>d</sub>)<sup>&#8722;1</sup> G<sub>d</sub><sup>T</sup> P F<sub>d</sub>&#160;&#160;&#160;(DARE)</span></div>
        <div class="eqn-row"><span class="eqn-lhs">K</span><span class="eqn-eq">=</span><span class="eqn-rhs">(R + G<sub>d</sub><sup>T</sup> P G<sub>d</sub>)<sup>&#8722;1</sup> G<sub>d</sub><sup>T</sup> P F<sub>d</sub></span></div>
        <div class="eqn-row"><span class="eqn-lhs">&#916;u<sub>k</sub></span><span class="eqn-eq">=</span><span class="eqn-rhs">&#8722;K&#160;&#916;x<sub>k</sub>&#160;&#160;&#160;&#916;x = [&#916;h, &#916;&#947;, &#916;&#945;, &#916;q]</span></div>
        <p class="eqn-note">State: perturbation from trim. Q = diag(Q<sub>h</sub>, 2Q<sub>h</sub>, 5, 0.5). Elevator clamped &#177;15&#176;.</p>
      </div>
    </div>
  </section>

  <!-- ── Demo 4: Cart-Pole System ID + LQR + Neural Net ──────────── -->
  <section class="sim-section" id="sec-sysid" role="tabpanel" aria-labelledby="tab-sysid">
    <div class="sim-layout">
      <div class="sim-canvas-wrap">
        <canvas class="sim-canvas" id="sysid-canvas" width="720" height="380" aria-label="Cart-pole balancing simulation"></canvas>
        <canvas id="sid-state-plot" height="160" style="display:block;width:100%;border-top:1px solid var(--border)" aria-label="State history: cart position, velocity, pole angle, pole rate"></canvas>
      </div>
      <div class="sim-panel">
        <h3>PPO Training</h3>
        <p class="panel-hint">Trains a policy network with <strong>Proximal Policy Optimisation</strong>. The agent learns from simulated experience &#8212; no demonstrations needed. Click Train to start; activate when done to hand it the controls.</p>
        <div class="pid-group">
          <label>Hidden layers <span id="sid-nn-layers-val">2</span></label>
          <input type="range" id="sid-nn-layers" min="1" max="4" step="1" value="2">
        </div>
        <div class="pid-group">
          <label>Neurons / layer <span id="sid-nn-neurons-val">32</span></label>
          <input type="range" id="sid-nn-neurons" min="8" max="64" step="8" value="32">
        </div>
        <button class="sim-btn" id="sid-ppo-train-btn" type="button">Train PPO</button>
        <div class="sysid-count" id="sid-ppo-status">Click Train to start learning from scratch</div>
        <canvas id="sid-nn-loss-canvas" height="60" style="width:100%;margin-top:.3rem" aria-label="Episode reward history"></canvas>
        <button class="sim-btn" id="sid-nn-activate-btn" type="button" disabled style="margin-top:.35rem">Activate Policy</button>

        <hr style="border:0;border-top:1px solid var(--border);margin:.5rem 0">
        <div class="pid-group" style="margin-top:.25rem">
          <label>Push the cart <span id="sid-force-val">0.0 N</span></label>
          <input type="range" id="sid-force" min="-8" max="8" step="0.5" value="0">
          <div class="range-row"><label class="range-lbl">Range &#177;</label><input type="number" id="sid-force-range" class="range-input" value="8" min="1" step="1"></div>
        </div>

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
        can only be pushed left or right. The pole starts hanging down; use &#8592;&#8594; arrow keys
        or the force slider to shove the cart. Click <em>Train PPO</em> to run
        <strong>Proximal Policy Optimisation</strong> entirely in the browser &#8212; the agent
        simulates thousands of episodes in the background, collects advantage-weighted rollouts,
        and updates a small actor&#8211;critic network via Adam. Once training finishes, press
        <em>Activate Policy</em> to deploy the learned controller and watch it balance from a
        random hanging start. &#8594;
        <a href="https://en.wikipedia.org/wiki/Inverted_pendulum" target="_blank" rel="noopener">Inverted pendulum &#8212; Wikipedia</a>,
        <a href="https://en.wikipedia.org/wiki/Proximal_policy_optimization" target="_blank" rel="noopener">PPO &#8212; Wikipedia</a>
      </p>
    </div>
    <div class="demo-note">
      <h4 class="demo-note-title">Equations of motion &amp; PPO</h4>
      <div class="eqn-block">
        <div class="eqn-row"><span class="eqn-lhs">&#952;&#776;</span><span class="eqn-eq">=</span><span class="eqn-rhs">[g sin&#952; &#8722; cos&#952;&#183;&#964;] / [&#8467;(4/3 &#8722; m cos&#178;&#952; / (M+m))]</span></div>
        <div class="eqn-row"><span class="eqn-lhs">x&#776;</span><span class="eqn-eq">=</span><span class="eqn-rhs">&#964; &#8722; m&#8467;&#952;&#776; cos&#952; / (M+m),&#160;&#160; &#964; = [F &#8722; b&#7819; + m&#8467;&#952;&#775;&#178; sin&#952;] / (M+m)</span></div>
        <div class="eqn-row"><span class="eqn-lhs">r</span><span class="eqn-eq">=</span><span class="eqn-rhs">cos&#952; &#8722; 0.1(x/x<sub>max</sub>)&#178; &#8722; 0.001(F/F<sub>max</sub>)&#178; + 1</span></div>
        <div class="eqn-row"><span class="eqn-lhs">L<sub>CLIP</sub></span><span class="eqn-eq">=</span><span class="eqn-rhs">E[min(r<sub>t</sub>&#8239;A&#770;<sub>t</sub>, clip(r<sub>t</sub>, 1&#8722;&#949;, 1+&#949;)&#8239;A&#770;<sub>t</sub>)],&#160; &#949; = 0.2</span></div>
        <div class="eqn-row"><span class="eqn-lhs">r<sub>t</sub></span><span class="eqn-eq">=</span><span class="eqn-rhs">&#960;&#952;(a<sub>t</sub>|s<sub>t</sub>) / &#960;<sub>&#952;&#8320;</sub>(a<sub>t</sub>|s<sub>t</sub>)&#160; (importance ratio)</span></div>
        <p class="eqn-note">M = 0.4 kg cart, m = 0.4 kg pole, &#8467; = 0.9 m half-length, b = 1.2 N&#183;s/m cart friction, g = 9.8 m/s&#178;. GAE advantages (&#947; = 0.99, &#955; = 0.95), rollout 512 steps, 4 epochs per update, minibatch 64. Actor: Gaussian policy &#956;(s) = tanh(net(s))&#183;F<sub>max</sub>, fixed &#963; &#8776; 15 N; critic: separate value network.</p>
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
