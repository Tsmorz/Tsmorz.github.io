---
layout: default
title: Custom Data
description: Upload a recording of states and inputs, fit a linear model to it, and run it as a live simulation under an LQR.
permalink: /controls/fit/
---
<section class="wrap page-head">
  <h1 class="page-title">Custom Data</h1>
  <p class="su-crumb"><a href="{{ '/controls/' | relative_url }}">&#8592; Control Systems</a></p>
  <p class="page-sub controls-intro">
    Upload a recording with columns <code>t</code>, <code>x1, x2, ...</code> and <code>u1, u2, ...</code>. A linear model
    <code>x[k+1] = A x[k] + B u[k]</code> is fitted to it by least squares, and once it is found your data becomes a <strong>live simulation</strong>
    you can push and steer with an <strong>LQR</strong>. Nothing leaves your browser.
  </p>
</section>

<div class="wrap" id="fit-root" style="padding-bottom:3rem">
  <p class="lab-goal"><span class="lab-phase">1 &middot; Arrive</span> Turn a recording into a model, then drive the model as a live simulation with a controller you designed. <span class="lab-time">about 10 min</span></p>
  <details class="demo-note lab-inform" open>
    <summary><span class="lab-phase">2 &middot; Inform</span> What the page does</summary>
    <p><strong>Least squares</strong> picks the A and B that best predict each sample from the one before. The dashed lines show those one-step predictions against your data; the fit percentage says how close.
    The poles show the model's own motions: any outside the unit circle is unstable.</p>
    <p>The <strong>LQR</strong> trades state error (Q) against input effort (R) and gives a feedback u&#8201;=&#8201;&#8722;K(x&#8201;&#8722;&#8201;x<sub>ref</sub>) plus the input that holds the reference.
    Once the model is found, the bottom plot becomes a <strong>simulation</strong> of it, running live: drag the reference, push the states, or switch the controller off to see the model on its own.</p>
    <p><strong>Some states may not be reachable.</strong> The input only moves a state directly or through the other states. If nothing connects a state to the input, no controller can steer it, and a recording that never excited it cannot show how it responds.
    The page counts the directions the input can move (<em>reachable: r of n</em>) and tells you when some are out of reach. The same goes for tracking: a state can be followed only if some steady input holds it at a constant value.</p>
    <p>The recording is a plain-text CSV, described below. </p>
  </details>

  <details class="demo-note lab-inform lab-format" open>
    <summary>CSV format</summary>
    <p>A header row, then one row per sample. Three kinds of column, named like this:</p>
<pre class="fit-example">t,x1,x2,x3,x4,u1
0.00,0.00000,0.00000,0.08000,0.00000,-1.9060
0.05,0.00031,0.00112,0.08140,0.01560,-2.0420
0.10,0.00112,...</pre>
    <table class="fit-spec">
      <tr><th>Column</th><th>Rule</th></tr>
      <tr><td>t</td><td>Time in seconds. One column, strictly increasing.</td></tr>
      <tr><td>x1, x2, ...</td><td>The states, measured at each sample. A single state can be just <code>x</code>.</td></tr>
      <tr><td>u1, u2, ...</td><td>The inputs, as commanded at each sample. A single input can be just <code>u</code>. The input in row k acts between row k and row k+1.</td></tr>
    </table>
    <p>Columns with any other name are ignored. Commas, semicolons or tabs separate the columns, and lines starting with
    <code>#</code> are skipped. Values are plain numbers in your own units; the LQR gain comes out in those units. A row with an
    empty cell is dropped. You need at least 20 complete rows. Evenly spaced times are best: if the spacing varies by more than
    5%, the data is resampled onto the median spacing. The signals should wiggle around one operating point, since the model is linear.</p>
  </details>

  <div class="fit-layout">
    <div class="fit-plots">
      <canvas class="fit-canvas" id="fit-c1" aria-label="Your data and the model's one-step predictions"></canvas>
      <div class="fit-pair">
        <canvas class="fit-canvas" id="fit-c2" aria-label="Poles of the model and of the model with LQR"></canvas>
        <canvas class="fit-canvas" id="fit-c3" aria-label="Live simulation of the fitted model, optionally under LQR"></canvas>
      </div>
    </div>
    <div class="sim-panel">
      <h3>Recording</h3>
      <label class="fit-drop" id="fit-drop">Choose or drop a CSV
        <input type="file" id="fit-file" accept=".csv,.txt,text/csv"></label>
      <button class="sim-btn" id="fit-example" type="button">Load an example</button>
      <button class="sim-btn" id="fit-csv" type="button">Download the example CSV</button>
      <p class="fit-msg" id="fit-msg" role="status"></p>
      <p class="fit-msg" id="fit-found"></p>
      <p class="fit-msg" id="fit-reach"></p>
      <label class="fit-role"><input type="checkbox" id="fit-mean" checked> Subtract the mean (the operating point)</label>
      <h3>LQR weights</h3>
      <div id="fit-weights"></div>
      <h3>Simulation</h3>
      <label class="fit-role"><input type="checkbox" id="fit-ctrl" checked> LQR controller on</label>
      <label class="fit-role">Track <select id="fit-track" aria-label="State to track"></select></label>
      <div class="pid-group">
        <label for="fit-ref">Reference <span class="fit-note">(in spreads of the data)</span></label>
        <input type="range" id="fit-ref" min="-3" max="3" step="0.1" value="0">
      </div>
      <button class="sim-btn" id="fit-push" type="button">Push the states</button>
      <button class="sim-btn" id="fit-reset" type="button">Reset to the operating point</button>
      <h3>Result</h3>
      <pre class="fit-info" id="fit-info"></pre>
    </div>
  </div>

  <div class="lab-card lab-tasks">
    <span class="lab-phase">3 &middot; Process</span>
    <h4 class="lab-card-title">Try it</h4>
    <ol>
      <li>Press <strong>Load an example</strong>: a cart-pole balanced by an LQR with a little dither, recorded through noisy sensors. How well does the model predict each state, noise and all?</li>
      <li>Look at the poles: is the model unstable on its own? Where do the poles go with the LQR?</li>
      <li>Watch the bottom plot: it is your model running live under the LQR. Drag the <strong>reference</strong> and the tracked state follows it.</li>
      <li>Press <strong>Push the states</strong>: how fast does the controller recover? Raise a Q weight and it recovers faster, at the cost of more input.</li>
      <li>Switch the controller <strong>off</strong>. Does the model sit still or run away? Compare with the poles.</li>
      <li>Change the tracked state. Some states may have no steady state of their own, or may not be reachable at all: read the reachable count above the weights.</li>
      <li>Download the example CSV, rename a state column (say <code>x3</code> to <code>y3</code>) so it is ignored, and see what the model loses. Then try your own recording.</li>
    </ol>
  </div>
</div>

<style>
.fit-layout{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:1rem;align-items:start}
.fit-plots{display:flex;flex-direction:column;gap:.75rem;min-width:0}
.fit-canvas{display:block;width:100%;height:calc(var(--lanes, 4) * 100px + 44px);border:1px solid var(--border);border-radius:var(--radius);background:var(--bg-soft)}
.fit-canvas[hidden],.pid-group[hidden]{display:none}
.fit-pair{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);gap:.75rem}
@media (max-width:860px){.fit-layout{grid-template-columns:minmax(0,1fr)}.fit-pair{grid-template-columns:minmax(0,1fr)}}
.lab-phase{display:inline-block;font:600 .68rem var(--mono);letter-spacing:.04em;text-transform:uppercase;color:var(--accent);margin-bottom:.25rem}
.lab-goal{margin:0 0 .8rem;font-size:.95rem}
.lab-goal .lab-phase{margin-right:.5rem}
.lab-time{font:400 .72rem var(--mono);color:var(--text-muted);margin-left:.4rem}
.lab-inform>summary{cursor:pointer;font-weight:600;font-size:.92rem}
.lab-card{background:var(--bg-soft);border:1px solid var(--border);border-radius:var(--radius);padding:1rem 1.1rem;margin-top:1rem}
.lab-card-title{margin:0 0 .5rem;font-size:.95rem}
.lab-tasks ol{margin:0;padding-left:1.2rem;font-size:.9rem}
.lab-tasks li{margin:.25rem 0}
.fit-drop{display:block;border:1.5px dashed var(--border-strong);border-radius:var(--radius);padding:.7rem;text-align:center;font-size:.88rem;cursor:pointer;margin-bottom:.5rem}
.fit-drop.over{border-color:var(--accent);background:var(--accent-soft)}
.fit-drop input{display:block;margin:.4rem auto 0;max-width:100%}
.fit-role{display:flex;justify-content:space-between;align-items:center;gap:.5rem;font-size:.82rem;margin:.25rem 0}
.fit-role select{font:inherit;font-size:.82rem}
.fit-spec{border-collapse:collapse;font-size:.85rem;margin:.6rem 0}
.fit-spec th,.fit-spec td{border:1px solid var(--border);padding:.35rem .6rem;text-align:left;vertical-align:top}
.fit-spec th{font:600 .72rem var(--mono);text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted)}
.fit-spec td:first-child{white-space:nowrap;font-family:var(--mono);font-size:.8rem}
.fit-example{font:.78rem/1.5 var(--mono);background:var(--bg-soft);border:1px solid var(--border);border-radius:var(--radius);padding:.6rem .8rem;overflow-x:auto;margin:.4rem 0}
.lab-format{margin-top:.75rem}
.fit-msg{font-size:.82rem;color:var(--text-muted);margin:.4rem 0}
.fit-msg.bad{color:var(--bad)}
.fit-note{font-size:.72rem;color:var(--text-muted)}
.fit-info{font:.74rem/1.45 var(--mono);white-space:pre;overflow-x:auto;margin:0}
</style>
<script src="{{ '/assets/js/lab/lab-core.js' | relative_url }}"></script>
<script src="{{ '/assets/js/lab/lab-plants.js' | relative_url }}"></script>
<script src="{{ '/assets/js/fit.js' | relative_url }}"></script>
