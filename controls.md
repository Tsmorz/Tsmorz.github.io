---
layout: default
title: Controls
description: Interactive control-systems demos — PID tuning, nonlinear flight sim, system identification, and LQR.
permalink: /controls/
---

<div class="section wrap">
  <div class="page-head" style="padding-bottom:0">
    <h1 class="page-title" style="font-size:clamp(1.8rem,4vw,2.6rem)">Control Systems</h1>
    <p class="page-sub controls-intro">
      Four interactive demos spanning classical and modern control. Tune a PID controller, fly a
      nonlinear aircraft, identify the linearized dynamics for LQR synthesis, then train a neural
      network to imitate the optimal controller entirely from flight data.
    </p>
  </div>

  <div class="sim-tabs" role="tablist" aria-label="Demo selector">
    <button class="sim-tab active" role="tab" aria-selected="true"  aria-controls="sec-msd"    id="tab-msd"    type="button">PID Tuning</button>
    <button class="sim-tab"        role="tab" aria-selected="false" aria-controls="sec-flight" id="tab-flight" type="button">Flight Sim</button>
    <button class="sim-tab"        role="tab" aria-selected="false" aria-controls="sec-sysid"  id="tab-sysid"  type="button">System ID / LQR</button>
    <button class="sim-tab"        role="tab" aria-selected="false" aria-controls="sec-nn"     id="tab-nn"     type="button">Neural Net</button>
  </div>

  <!-- ── Demo 1: Mass-Spring-Damper ─────────────────────────────── -->
  <section class="sim-section active" id="sec-msd" role="tabpanel" aria-labelledby="tab-msd">
    <p class="demo-sub">
      An underdamped mass-spring-damper tracks a sinusoidal reference. Adjust K<sub>p</sub>,
      K<sub>i</sub>, K<sub>d</sub> to minimise the RMSE score. The spring animation on the left
      updates live.
    </p>
    <div class="sim-layout">
      <div class="sim-canvas-wrap">
        <canvas class="sim-canvas" id="msd-canvas" width="720" height="360" aria-label="Mass-spring-damper simulation"></canvas>
      </div>
      <div class="sim-panel">
        <h3>PID Gains</h3>
        <div class="pid-group">
          <label>K<sub>p</sub> <span id="msd-kp-val">0.0</span></label>
          <input type="range" id="msd-kp" min="0" max="50" step="0.5" value="0">
        </div>
        <div class="pid-group">
          <label>K<sub>i</sub> <span id="msd-ki-val">0.0</span></label>
          <input type="range" id="msd-ki" min="0" max="20" step="0.1" value="0">
        </div>
        <div class="pid-group">
          <label>K<sub>d</sub> <span id="msd-kd-val">0.0</span></label>
          <input type="range" id="msd-kd" min="0" max="10" step="0.05" value="0">
        </div>
        <hr style="border:0;border-top:1px solid var(--border);margin:.25rem 0">
        <div class="score-block">
          <span class="score-value" id="msd-score">—</span>
          <span class="score-label">RMSE (m)</span>
          <div class="score-best" id="msd-best"></div>
        </div>
        <button class="sim-btn" id="msd-reset" type="button">Reset</button>
      </div>
    </div>
  </section>

  <!-- ── Demo 2: Flight Sim ──────────────────────────────────────── -->
  <section class="sim-section" id="sec-flight" role="tabpanel" aria-labelledby="tab-flight">
    <p class="demo-sub">
      Nonlinear longitudinal dynamics (Cessna 172–like). In Manual mode use the elevator
      slider to pitch the aircraft; in PID mode the autopilot tracks the altitude reference.
      The dashed line is the sine-wave altitude target.
    </p>
    <div class="sim-layout">
      <div class="sim-canvas-wrap">
        <canvas class="sim-canvas" id="flight-canvas" width="720" height="380" aria-label="2D flight simulator"></canvas>
      </div>
      <div class="sim-panel">
        <h3>Mode</h3>
        <div class="mode-toggle">
          <button class="mode-btn active" id="fl-manual-btn" type="button">Manual</button>
          <button class="mode-btn"        id="fl-pid-btn"    type="button">PID</button>
        </div>

        <div id="fl-manual-controls">
          <div class="pid-group">
            <label>Elevator δ<sub>e</sub> <span id="fl-elev-val">0.0°</span></label>
            <input type="range" id="fl-elev" min="-20" max="20" step="0.5" value="0">
          </div>
        </div>

        <div id="fl-pid-controls" style="display:none;flex-direction:column;gap:.6rem">
          <div class="pid-group">
            <label>K<sub>p</sub> <span id="fl-kp-val">0.0</span></label>
            <input type="range" id="fl-kp" min="0" max="5" step="0.05" value="0">
          </div>
          <div class="pid-group">
            <label>K<sub>i</sub> <span id="fl-ki-val">0.0</span></label>
            <input type="range" id="fl-ki" min="0" max="2" step="0.01" value="0">
          </div>
          <div class="pid-group">
            <label>K<sub>d</sub> <span id="fl-kd-val">0.0</span></label>
            <input type="range" id="fl-kd" min="0" max="10" step="0.1" value="0">
          </div>
        </div>

        <hr style="border:0;border-top:1px solid var(--border);margin:.1rem 0">
        <div class="telemetry" id="fl-telemetry">
          <span class="t-key">h</span>  <span class="t-val" id="fl-t-h">—</span>
          <span class="t-key">V</span>  <span class="t-val" id="fl-t-v">—</span>
          <span class="t-key">α</span>  <span class="t-val" id="fl-t-a">—</span>
          <span class="t-key">q</span>  <span class="t-val" id="fl-t-q">—</span>
        </div>

        <div class="score-block">
          <span class="score-value" id="fl-score">—</span>
          <span class="score-label">RMSE (m)</span>
        </div>
        <button class="sim-btn" id="fl-reset" type="button">Reset</button>
      </div>
    </div>
  </section>

  <!-- ── Demo 3: System ID + LQR ─────────────────────────────────── -->
  <section class="sim-section" id="sec-sysid" role="tabpanel" aria-labelledby="tab-sysid">
    <p class="demo-sub">
      Fly the aircraft to excite the longitudinal modes, then identify the linearised A and B
      matrices via least squares. Use those to solve the DARE and synthesise an LQR gain that
      automatically improves tracking.
    </p>
    <div class="sim-layout">
      <div class="sim-canvas-wrap">
        <canvas class="sim-canvas" id="sysid-canvas" width="720" height="380" aria-label="System ID flight canvas"></canvas>
      </div>
      <div class="sim-panel">
        <h3>1 — Collect data</h3>
        <div class="sysid-progress">
          <div class="sysid-bar-wrap"><div class="sysid-bar" id="sid-bar"></div></div>
          <div class="sysid-count" id="sid-count">0 / 300 samples</div>
        </div>
        <div class="pid-group">
          <label>Elevator δ<sub>e</sub> <span id="sid-elev-val">0.0°</span></label>
          <input type="range" id="sid-elev" min="-20" max="20" step="0.5" value="0">
        </div>
        <button class="sim-btn" id="sid-record-btn" type="button">Start Recording</button>

        <hr style="border:0;border-top:1px solid var(--border);margin:.1rem 0">
        <h3>2 — System ID</h3>
        <button class="sim-btn" id="sid-identify-btn" type="button" disabled>Identify System</button>
        <div class="matrix-section" id="sid-matrices" style="display:none">
          <div>
            <div class="matrix-label">A  (4 × 4)</div>
            <pre class="matrix-display" id="sid-A-display"></pre>
          </div>
          <div>
            <div class="matrix-label">B  (4 × 1)</div>
            <pre class="matrix-display" id="sid-B-display"></pre>
          </div>
        </div>

        <hr style="border:0;border-top:1px solid var(--border);margin:.1rem 0">
        <h3>3 — LQR</h3>
        <button class="sim-btn" id="sid-lqr-btn" type="button" disabled>Enable LQR</button>
        <div class="matrix-section" id="sid-lqr-section" style="display:none">
          <div>
            <div class="matrix-label">K  (1 × 4)</div>
            <pre class="matrix-display" id="sid-K-display"></pre>
          </div>
          <div class="score-compare" id="sid-score-compare"></div>
        </div>

        <div class="score-block" style="padding-top:.25rem">
          <span class="score-value" id="sid-score">—</span>
          <span class="score-label">RMSE (m)</span>
        </div>
        <button class="sim-btn" id="sid-reset" type="button">Reset</button>
      </div>
    </div>
  </section>

  <!-- ── Demo 4: Neural Network Controller ─────────────────────── -->
  <section class="sim-section" id="sec-nn" role="tabpanel" aria-labelledby="tab-nn">
    <p class="demo-sub">
      A small feedforward network learns to imitate the optimal LQR controller via behavioral
      cloning. Generate training data (the LQR flying the reference), configure the architecture,
      train with Adam, then activate the NN as the live flight controller.
    </p>
    <div class="sim-layout">
      <div class="sim-canvas-wrap">
        <canvas class="sim-canvas" id="nn-canvas" width="720" height="380" aria-label="Neural network flight controller"></canvas>
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

        <hr style="border:0;border-top:1px solid var(--border);margin:.1rem 0">
        <h3>1 — Training data</h3>
        <button class="sim-btn" id="nn-gen-btn" type="button">Generate Data</button>
        <div class="sysid-count" id="nn-gen-status">No data yet</div>

        <hr style="border:0;border-top:1px solid var(--border);margin:.1rem 0">
        <h3>2 — Train</h3>
        <button class="sim-btn" id="nn-train-btn" type="button" disabled>Train Network</button>
        <canvas id="nn-loss-canvas" width="200" height="72" style="width:100%;border-radius:8px;border:1px solid var(--border);display:block;margin-top:.3rem"></canvas>
        <div class="sysid-count" id="nn-train-status">—</div>

        <hr style="border:0;border-top:1px solid var(--border);margin:.1rem 0">
        <h3>3 — Fly</h3>
        <button class="sim-btn mode-btn" id="nn-activate-btn" type="button" disabled>Activate NN</button>

        <div class="score-block" style="padding-top:.25rem">
          <span class="score-value" id="nn-score">—</span>
          <span class="score-label">RMSE (m)</span>
        </div>
        <button class="sim-btn" id="nn-reset" type="button">Reset</button>
      </div>
    </div>
  </section>
</div>

<script src="{{ '/assets/js/controls.js' | relative_url }}"></script>
