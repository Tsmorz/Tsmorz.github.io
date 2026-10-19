---
layout: default
title: Fit and Control
description: Upload a recording of states and inputs, fit a linear model to it, and design an LQR that stabilises it.
permalink: /controls/fit/
---
<section class="wrap page-head">
  <h1 class="page-title">Fit and Control</h1>
  <p class="su-crumb"><a href="{{ '/controls/' | relative_url }}">&#8592; Control Systems</a></p>
  <p class="page-sub controls-intro">
    Upload a recording with columns <code>t</code>, <code>x1, x2, ...</code> and <code>u1, u2, ...</code>. It is plotted, a linear model
    <code>x[k+1] = A x[k] + B u[k]</code> is fitted to it, and an <strong>LQR</strong> is designed on that model.
    Nothing leaves your browser.
  </p>
</section>

<div class="wrap" id="fit-root" style="padding-bottom:3rem">
  <p class="lab-goal"><span class="lab-phase">1 &middot; Arrive</span> Turn a recording into a model, and the model into a controller that stabilises it. <span class="lab-time">about 10 min</span></p>
  <details class="demo-note lab-inform" open>
    <summary><span class="lab-phase">2 &middot; Inform</span> What the page does</summary>
    <p>A recording sampled much faster than the plant moves has all its poles crowded near 1, which makes a model hard to read. The <strong>model sample rate</strong> slider resamples the data to a slower rate before fitting, so the model, its poles and the LQR all live at that rate. The model is found by least squares: it picks the A and B that best predict each sample from the one before. The dashed
    lines show those one-step predictions against your data; the fit percentage says how close. The poles show the model's own
    motions: any outside the unit circle is unstable. The <strong>LQR</strong> trades state error (Q) against input effort (R)
    and gives a feedback u&#8201;=&#8201;&#8722;Kx; the bottom plot runs it on the model.</p>
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
        <canvas class="fit-canvas" id="fit-c3" aria-label="The model with and without LQR from a small push"></canvas>
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
      <h3>Model sample rate</h3>
      <div id="fit-rate" class="pid-group" hidden>
        <label for="fit-rate-in">Fit at <span class="fit-rate-val"></span></label>
        <input type="range" id="fit-rate-in" min="0" max="130" step="1" value="0">
      </div>
      <label class="fit-role"><input type="checkbox" id="fit-mean" checked> Subtract the mean (the operating point)</label>
      <h3>LQR weights</h3>
      <div id="fit-weights"></div>
      <h3>Result</h3>
      <pre class="fit-info" id="fit-info"></pre>
    </div>
  </div>

  <div class="lab-card lab-tasks">
    <span class="lab-phase">3 &middot; Process</span>
    <h4 class="lab-card-title">Try it</h4>
    <ol>
      <li>Press <strong>Load an example</strong>: a cart-pole balanced by an LQR with a little dither. How well does the model predict each state?</li>
      <li>Look at the poles: is the model unstable on its own? Where do the poles go with the LQR?</li>
      <li>Slow the <strong>model sample rate</strong>: the poles move away from 1 and the fit changes. Which rate gives the cleanest model?</li>
      <li>Raise a Q weight, or lower R, and watch the push die out faster at the cost of more input.</li>
      <li>Download the example CSV, rename a state column (say <code>x3</code> to <code>y3</code>) so it is ignored, and see what the model loses. Then try your own recording.</li>
    </ol>
  </div>
</div>

<style>
.fit-layout{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:1rem;align-items:start}
.fit-plots{display:flex;flex-direction:column;gap:.75rem;min-width:0}
.fit-canvas{display:block;width:100%;height:calc(var(--lanes, 4) * 100px + 44px);border:1px solid var(--border);border-radius:var(--radius);background:var(--bg-soft)}
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
.fit-info{font:.74rem/1.45 var(--mono);white-space:pre;overflow-x:auto;margin:0}
</style>
<script src="{{ '/assets/js/lab/lab-core.js' | relative_url }}"></script>
<script src="{{ '/assets/js/lab/lab-plants.js' | relative_url }}"></script>
<script src="{{ '/assets/js/fit.js' | relative_url }}"></script>
