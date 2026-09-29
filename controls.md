---
layout: default
title: Controls
description: Interactive control-systems demos — PID tuning, path tracking, a nonlinear flight sim, cart-pole system-ID + LQR, and behavioral cloning.
permalink: /controls/
---
<section class="wrap page-head">
  <h1 class="page-title">Control Systems</h1>
  <p class="page-sub controls-intro">
    Six interactive demos spanning classical and modern control. Tune a PID controller, track
    a B-spline race course with a PID path follower, fly a nonlinear aircraft, then <strong>identify a
    cart-pole from data and balance it with an LQR controller you tune</strong>, train a neural network
    to drive the race car by imitating an expert, and finally become the controller yourself — chase a
    jumping target and let the site fit the PID gains and reaction delay hidden in your own hand.
  </p>
</section>

<div class="wrap" style="padding-bottom:3rem">
  <div class="sim-tabs" role="tablist" aria-label="Demo selector">
    <button class="sim-tab active" role="tab" aria-selected="true"  aria-controls="sec-msd"    id="tab-msd"    type="button">PID Tuning</button>
    <button class="sim-tab"        role="tab" aria-selected="false" aria-controls="sec-race"   id="tab-race"   type="button">Race Track</button>
    <button class="sim-tab"        role="tab" aria-selected="false" aria-controls="sec-flight" id="tab-flight" type="button">Flight Sim</button>
    <button class="sim-tab"        role="tab" aria-selected="false" aria-controls="sec-sysid"  id="tab-sysid"  type="button">Cart-Pole LQR</button>
    <button class="sim-tab"        role="tab" aria-selected="false" aria-controls="sec-nn"     id="tab-nn"     type="button">Neural Net</button>
    <button class="sim-tab"        role="tab" aria-selected="false" aria-controls="sec-react"  id="tab-react"  type="button">Be the Controller</button>
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

  <!-- ── Demo 1.5: Race Track ───────────────────────────────────── -->
  <section class="sim-section" id="sec-race" role="tabpanel" aria-labelledby="tab-race">
    <div class="sim-layout">
      <div class="sim-canvas-wrap">
        <canvas class="sim-canvas" id="race-canvas" width="700" height="400" aria-label="B-spline race track PID demo"></canvas>
        <canvas id="race-state-plot" height="160" style="display:block;width:100%;border-top:1px solid var(--border)" aria-label="State history: cross-track error and heading error"></canvas>
      </div>
      <div class="sim-panel">
        <h3>PID Gains</h3>
        <div class="pid-group">
          <label>K<sub>p</sub> <span id="race-kp-val">0.00</span></label>
          <input type="range" id="race-kp" min="-5" max="5" step="0.05" value="0">
          <div class="range-row"><label class="range-lbl">Range &#177;</label><input type="number" id="race-kp-range" class="range-input" value="5" min="0.1" step="0.1"></div>
        </div>
        <div class="pid-group">
          <label>K<sub>i</sub> <span id="race-ki-val">0.00</span></label>
          <input type="range" id="race-ki" min="-2" max="2" step="0.01" value="0">
          <div class="range-row"><label class="range-lbl">Range &#177;</label><input type="number" id="race-ki-range" class="range-input" value="2" min="0.1" step="0.1"></div>
        </div>
        <div class="pid-group">
          <label>K<sub>d</sub> <span id="race-kd-val">0.00</span></label>
          <input type="range" id="race-kd" min="-5" max="5" step="0.05" value="0">
          <div class="range-row"><label class="range-lbl">Range &#177;</label><input type="number" id="race-kd-range" class="range-input" value="5" min="0.1" step="0.1"></div>
        </div>
        <div class="pid-group">
          <label>Speed <span id="race-speed-val">50%</span></label>
          <input type="range" id="race-speed" min="0" max="1" step="0.05" value="0.5">
        </div>
        <hr style="border:0;border-top:1px solid var(--border);margin:.25rem 0">
        <div class="telemetry">
          <span class="t-key">e<sub>y</sub></span>   <span class="t-val" id="race-ey">&#8212;</span>
          <span class="t-key">e<sub>&#952;</sub></span> <span class="t-val" id="race-eth">&#8212;</span>
          <span class="t-key">Lap</span>              <span class="t-val" id="race-lap-pid">0</span>
          <span class="t-key">Best</span>             <span class="t-val" id="race-best-pid">&#8212;</span>
        </div>
        <div class="score-block" style="padding-top:.2rem">
          <span class="score-value" id="race-score">&#8212;</span>
          <span class="score-label">RMS CTE (px)</span>
          <div class="score-best" id="race-best"></div>
        </div>
        <h3 style="margin-top:.4rem">AI Reference</h3>
        <div class="telemetry">
          <span class="t-key">Lap</span>  <span class="t-val" id="race-lap-ai">0</span>
          <span class="t-key">Best</span> <span class="t-val" id="race-best-ai">&#8212;</span>
        </div>
        <button class="sim-btn" id="race-reset" type="button">Reset</button>
      </div>
    </div>
    <div class="demo-note">
      <h4 class="demo-note-title">About this demo</h4>
      <p>
        A car follows a closed <strong>B-spline</strong> track at constant speed. The controller
        observes two state variables: <strong>e<sub>y</sub></strong> (signed lateral distance from
        the centreline, in pixels) and <strong>e<sub>&#952;</sub></strong> (heading error &#8212; angle
        between the car and the track tangent). The PID acts on e<sub>y</sub> and produces a
        steering command; the derivative term naturally suppresses heading error because
        &#279;<sub>y</sub> &#8776; v&#183;sin(e<sub>&#952;</sub>). Tune the gains to minimise RMS CTE.
        The red AI car uses a pure-pursuit reference for comparison. &#8594;
        <a href="https://en.wikipedia.org/wiki/PID_controller" target="_blank" rel="noopener">PID controller &#8212; Wikipedia</a>
      </p>
    </div>
  </section>

  <!-- ── Demo 2: Flight Sim ──────────────────────────────────────── -->
  <section class="sim-section" id="sec-flight" role="tabpanel" aria-labelledby="tab-flight">
    <div class="sim-layout">
      <div class="sim-canvas-wrap">
        <canvas class="sim-canvas" id="flight-canvas" width="720" height="380" aria-label="2D flight simulator"></canvas>
        <canvas id="fl-state-plot" height="150" style="display:block;width:100%;border-top:1px solid var(--border)" aria-label="State history"></canvas>
        <canvas id="fl-pid-plot"   height="180" style="display:block;width:100%;border-top:1px solid var(--border)" aria-label="PID contribution chart"></canvas>
      </div>
      <div class="sim-panel">
        <h3>Mode</h3>
        <div class="mode-toggle">
          <button class="mode-btn active" id="fl-manual-btn" type="button">Manual</button>
          <button class="mode-btn"        id="fl-pid-btn"    type="button">PID</button>
        </div>

        <div id="fl-manual-controls">
          <div class="pid-group">
            <label>Elevator &#948;<sub>e</sub> <span id="fl-elev-val">0.0&#176;</span></label>
            <input type="range" id="fl-elev" min="-25" max="25" step="0.5" value="0">
          </div>
          <p style="font-size:.75rem;color:var(--text-muted);margin:.15rem 0 0">&#8593;/&#8595; arrows also adjust elevator</p>
        </div>

        <div id="fl-pid-controls" style="display:none;flex-direction:column;gap:.6rem">
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
        </div>

        <hr style="border:0;border-top:1px solid var(--border);margin:.1rem 0">
        <div class="telemetry" id="fl-telemetry">
          <span class="t-key">h</span>  <span class="t-val" id="fl-t-h">&#8212;</span>
          <span class="t-key">V</span>  <span class="t-val" id="fl-t-v">&#8212;</span>
          <span class="t-key">&#945;</span>  <span class="t-val" id="fl-t-a">&#8212;</span>
          <span class="t-key">q</span>  <span class="t-val" id="fl-t-q">&#8212;</span>
        </div>

        <div class="score-block">
          <span class="score-value" id="fl-score">&#8212;</span>
          <span class="score-label">RMSE (m)</span>
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
        matching a real NACA airfoil curve. In Manual mode use the elevator slider (or &#8593;/&#8595; keys)
        to pitch the aircraft; in PID mode an autopilot tracks the altitude sine wave. &#8594;
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

  <!-- ── Demo 3: Cart-Pole System ID + LQR ───────────────────────── -->
  <section class="sim-section" id="sec-sysid" role="tabpanel" aria-labelledby="tab-sysid">
    <div class="sim-layout">
      <div class="sim-canvas-wrap">
        <canvas class="sim-canvas" id="sysid-canvas" width="720" height="380" aria-label="Cart-pole balancing simulation"></canvas>
        <canvas id="sid-state-plot" height="160" style="display:block;width:100%;border-top:1px solid var(--border)" aria-label="State history: cart position, velocity, pole angle, pole rate"></canvas>
        <canvas id="sid-pid-plot"   height="180" style="display:block;width:100%;border-top:1px solid var(--border)" aria-label="LQR force contribution chart"></canvas>
      </div>
      <div class="sim-panel">
        <h3>1 &#8212; Collect data</h3>
        <p class="panel-hint">A built-in stabiliser keeps the pole up while random shoves excite the dynamics &#8212; closed-loop system ID.</p>
        <div class="sysid-progress">
          <div class="sysid-bar-wrap"><div class="sysid-bar" id="sid-bar"></div></div>
          <div class="sysid-count" id="sid-count">0 / 300 samples</div>
        </div>
        <button class="sim-btn" id="sid-record-btn" type="button">Start Recording</button>
        <div class="pid-group" style="margin-top:.5rem">
          <label>Push the cart (disturbance) <span id="sid-force-val">0.0 N</span></label>
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

        <div class="score-block" style="padding-top:.25rem">
          <span class="score-value" id="sid-score">&#8212;</span>
          <span class="score-label">RMS &#952; (&#176;)</span>
        </div>
        <button class="sim-btn" id="sid-reset" type="button">Reset</button>
      </div>
    </div>
    <div class="demo-note">
      <h4 class="demo-note-title">About this demo</h4>
      <p>
        The <strong>cart-pole</strong> is the classic unstable plant: a pole hinged on a cart that
        you can only push left or right. Balancing it upright is the textbook test for
        <strong>LQR</strong>. First press <em>Start Recording</em> &#8212; a light built-in stabiliser
        holds the pole near vertical while random shoves excite all four states, and the run is logged.
        With 300 samples, <em>Identify System</em> fits a linear model &#7819; = Ax + Bu by least
        squares (<strong>system identification</strong>).
      </p>
      <p>
        The identified A and B feed the <strong>discrete algebraic Riccati equation (DARE)</strong>,
        which returns the LQR gain K that minimises J = &#8721;(x&#7488;Qx + u&#7488;Ru). Tune the Q/R
        weights and press <em>Enable LQR</em> to hand it the controls, or click <em>Analytic LQR</em> to
        skip data collection and solve K from the exact numerical Jacobian. Drag <em>Push the cart</em>
        to disturb it and watch the regulator recover. &#8594;
        <a href="https://en.wikipedia.org/wiki/Inverted_pendulum" target="_blank" rel="noopener">Inverted pendulum &#8212; Wikipedia</a>,
        <a href="https://en.wikipedia.org/wiki/Linear%E2%80%93quadratic_regulator" target="_blank" rel="noopener">LQR &#8212; Wikipedia</a>
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

  <!-- ── Demo 4: Neural Network Controller ─────────────────────── -->
  <section class="sim-section" id="sec-nn" role="tabpanel" aria-labelledby="tab-nn">
    <div class="sim-layout">
      <div class="sim-canvas-wrap">
        <canvas class="sim-canvas" id="nn-canvas" width="720" height="380" aria-label="Neural network race-car controller"></canvas>
        <canvas id="nn-state-plot" height="150" style="display:block;width:100%;border-top:1px solid var(--border)" aria-label="State history: cross-track and heading error"></canvas>
        <canvas id="nn-pid-plot"   height="180" style="display:block;width:100%;border-top:1px solid var(--border)" aria-label="NN vs expert steering"></canvas>
      </div>
      <div class="sim-panel">
        <h3>Architecture</h3>
        <div class="pid-group">
          <label>Hidden layers <span id="nn-layers-val">1</span></label>
          <input type="range" id="nn-layers" min="1" max="3" step="1" value="1">
        </div>
        <div class="pid-group">
          <label>Neurons / layer <span id="nn-neurons-val">16</span></label>
          <input type="range" id="nn-neurons" min="4" max="32" step="4" value="16">
        </div>

        <hr style="border:0;border-top:1px solid var(--border);margin:.6rem 0 .3rem">
        <div class="pid-group">
          <label>Steering &#948; <span id="nn-steer-val">0.00</span></label>
          <input type="range" id="nn-steer" min="-1" max="1" step="0.05" value="0">
        </div>
        <p style="font-size:.75rem;color:var(--text-muted);margin:.1rem 0 .4rem">&#8592;/&#8594; arrows steer in manual mode</p>

        <hr style="border:0;border-top:1px solid var(--border);margin:.3rem 0">
        <h3>1 &#8212; Training data</h3>
        <button class="sim-btn" id="nn-gen-btn" type="button">Generate Data</button>
        <div class="sysid-count" id="nn-gen-status">No data yet</div>

        <hr style="border:0;border-top:1px solid var(--border);margin:.3rem 0">
        <h3>2 &#8212; Train</h3>
        <button class="sim-btn" id="nn-train-btn" type="button" disabled>Train Network</button>
        <canvas id="nn-loss-canvas" height="72" style="width:100%;margin-top:.4rem" aria-label="Training loss"></canvas>
        <div class="sysid-count" id="nn-train-status"></div>

        <hr style="border:0;border-top:1px solid var(--border);margin:.3rem 0">
        <h3>3 &#8212; Activate</h3>
        <button class="sim-btn" id="nn-activate-btn" type="button" disabled>Activate NN</button>

        <div class="score-block" style="padding-top:.25rem">
          <span class="score-value" id="nn-score">&#8212;</span>
          <span class="score-label">RMS CTE (px)</span>
        </div>
        <button class="sim-btn" id="nn-reset" type="button">Reset</button>
      </div>
    </div>

    <div class="nn-netviz">
      <div class="nn-netviz-head">
        <h3>Network activations</h3>
        <div class="nn-legend" aria-hidden="true">
          <span class="nn-legend-cap">&#8722;</span>
          <span class="nn-legend-bar"></span>
          <span class="nn-legend-cap">+</span>
          <span class="nn-legend-txt">neuron activation</span>
        </div>
      </div>
      <canvas id="nn-net-canvas" height="440" aria-label="Neural network diagram with color-coded neuron activations"></canvas>
    </div>

    <div class="demo-note">
      <h4 class="demo-note-title">About this demo</h4>
      <p>
        A small feedforward network learns to drive the car around the B-spline track via
        <strong>behavioral cloning</strong>: a pure-pursuit expert laps the circuit and the network is
        trained (Adam SGD) to reproduce its steering from the car's observations &#8212; cross-track
        error e<sub>y</sub>, heading error e<sub>&#952;</sub>, and four look-ahead angles &#968;<sub>1..4</sub>.
        Generate data, train, then <strong>Activate NN</strong> to hand it the wheel; the red
        <strong>Expert</strong> car shows the target line. Use &#8592;/&#8594; arrows or the slider to steer
        manually. &#8594;
        <a href="https://en.wikipedia.org/wiki/Feedforward_neural_network" target="_blank" rel="noopener">Feedforward neural network &#8212; Wikipedia</a>,
        <a href="https://en.wikipedia.org/wiki/Imitation_learning" target="_blank" rel="noopener">Imitation learning &#8212; Wikipedia</a>
      </p>
    </div>
  </section>

  <!-- ── Demo 5: Be the Controller ──────────────────────────────── -->
  <section class="sim-section" id="sec-react" role="tabpanel" aria-labelledby="tab-react">
    <div class="sim-layout">
      <div class="sim-canvas-wrap">
        <canvas class="sim-canvas" id="react-canvas" width="720" height="380" aria-label="Reaction step-response — chase the jumping target"></canvas>
        <canvas id="react-plot" height="180" style="display:block;width:100%;border-top:1px solid var(--border)" aria-label="Step response: your path vs the fitted PID controller"></canvas>
      </div>
      <div class="sim-panel">
        <h3>Reaction test</h3>
        <p class="react-help" id="react-status">Press &#8220;Start trial&#8221;, then chase the dot the instant it jumps.</p>
        <button class="sim-btn" id="react-start" type="button">Start trial</button>

        <div class="score-block">
          <span class="score-value" id="react-reaction">&#8212;</span>
          <span class="score-label">reaction (ms)</span>
          <div class="score-best" id="react-best"></div>
        </div>

        <div id="react-results" style="display:none;flex-direction:column;gap:.6rem">
          <h3 style="margin-top:.2rem">Your fitted PID</h3>
          <div class="telemetry">
            <span class="t-key">K<sub>p</sub></span>       <span class="t-val" id="react-kp">&#8212;</span>
            <span class="t-key">K<sub>i</sub></span>       <span class="t-val" id="react-ki">&#8212;</span>
            <span class="t-key">K<sub>d</sub></span>       <span class="t-val" id="react-kd">&#8212;</span>
            <span class="t-key">dead time L</span>        <span class="t-val" id="react-L">&#8212;</span>
            <span class="t-key">overshoot</span>          <span class="t-val" id="react-os">&#8212;</span>
            <span class="t-key">fit R&#178;</span>        <span class="t-val" id="react-r2">&#8212;</span>
          </div>
          <p class="react-read" id="react-read"></p>
        </div>

        <button class="sim-btn" id="react-reset" type="button">Reset</button>
      </div>
    </div>
    <div class="demo-note">
      <h4 class="demo-note-title">About this demo</h4>
      <p>
        The tables turn &#8212; now <em>you</em> are the controller. A target jumps between the
        corners of the box at a random moment you can&#8217;t predict; chase it with your mouse or
        finger. The site records your trajectory and treats your hand as a controller: it measures
        your <strong>reaction delay</strong> (the pure <em>dead time</em> L before you move) and then
        least-squares fits the PID law
        <em>&#7819; = K<sub>p</sub>&#183;e + K<sub>i</sub>&#183;&#8747;e + K<sub>d</sub>&#183;&#279;</em>
        to the motion after that &#8212; the same system-identification tool as the LQR demo, run
        backwards. The lower plot overlays your normalized path against a PID controller replaying
        your fitted gains, so you can see how PID-like your reflexes really are. &#8594;
        <a href="https://en.wikipedia.org/wiki/System_identification" target="_blank" rel="noopener">System identification &#8212; Wikipedia</a>,
        <a href="https://en.wikipedia.org/wiki/PID_controller" target="_blank" rel="noopener">PID controller &#8212; Wikipedia</a>
      </p>
    </div>
  </section>

</div>

<script src="{{ '/assets/js/controls.js' | relative_url }}"></script>

<style>
.race-steer-btns{display:flex;gap:.4rem;margin:.35rem 0 .1rem}
.race-steer{flex:1;padding:.35rem .2rem;font-size:.82rem}
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
.react-help{font-size:.82rem;line-height:1.45;color:var(--text-muted);margin:.1rem 0 .2rem;min-height:2.6em}
.react-read{font-size:.8rem;line-height:1.5;color:var(--text-muted);margin:.1rem 0 0;font-style:italic}
</style>
