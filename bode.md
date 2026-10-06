---
layout: default
title: Bode Plots
description: See where a Bode plot comes from - shake a mass on a spring at different frequencies, then read gain, phase and delay margins off the PID and LQR loops from the controls demos.
permalink: /controls/bode/
---
<section class="wrap page-head">
  <h1 class="page-title">Bode Plots</h1>
  <p class="su-crumb"><a href="{{ '/controls/' | relative_url }}">&#8592; Control Systems</a></p>
  <p class="page-sub controls-intro">
    A Bode plot answers one question: if you shake a system with a sine wave, what comes out?
    At each frequency the output is another sine wave, just bigger or smaller and shifted later.
    Plot that size ratio and that shift against frequency and you have the two curves. Start
    with the <strong>Intro</strong> and sweep the frequency yourself. The <strong>PID</strong>
    and <strong>LQR</strong> tabs then cut open the feedback loops from the
    <a href="{{ '/controls/' | relative_url }}">controls demos</a> and show how far each one is
    from shaking itself apart. Under each experiment, <strong>View</strong> switches between three
    pictures of the same system: the Bode plot, the Nyquist plot, and its poles.
  </p>
</section>

<div class="wrap" style="padding-bottom:3rem">
  <div class="sim-tabs-row">
    <div class="sim-tabs" role="tablist" aria-label="Demo selector">
      <button class="sim-tab active" role="tab" aria-selected="true"  aria-controls="sec-intro" id="tab-intro" type="button">Intro</button>
      <button class="sim-tab"        role="tab" aria-selected="false" aria-controls="sec-pid"   id="tab-pid"   type="button">PID Loop</button>
      <button class="sim-tab"        role="tab" aria-selected="false" aria-controls="sec-lqr"   id="tab-lqr"   type="button">LQR Loop</button>
    </div>
  </div>

  <!-- ── Intro: the plant on its own ──────────────────────────────── -->
  <section class="sim-section active" id="sec-intro" role="tabpanel" aria-labelledby="tab-intro">
    <div class="sim-layout">
      <div class="sim-canvas-wrap sim-stack">
        <div class="sim-cell"><canvas class="sim-canvas" id="intro-time" aria-label="A mass on a spring shaken by a sine-wave force, with the force and the resulting position plotted over three periods"></canvas></div>
        <div class="bode-views">
          <div class="sim-cell-pair" id="intro-pair">
          <div class="sim-cell"><canvas class="sim-states" id="intro-mag" aria-label="Bode magnitude plot of the mass-spring-damper"></canvas></div>
          <div class="sim-cell"><canvas class="sim-states" id="intro-phase" aria-label="Bode phase plot of the mass-spring-damper"></canvas></div>
        </div>
          <div class="sim-cell bode-alt" id="intro-alt-cell" hidden>
            <canvas class="sim-states" id="intro-alt" aria-label=""></canvas>
            <div class="tf-box" id="intro-tf" aria-live="polite"></div>
          </div>
        </div>
      </div>
      <div class="sim-panel">
        <h3>Shake it</h3>
        <div class="pid-group">
          <label for="intro-w">Frequency <span id="intro-w-val">-</span></label>
          <input type="range" id="intro-w" min="0" max="1000" step="1" value="0">
        </div>
        <button class="sim-btn" id="intro-sweep" type="button" aria-pressed="false">Sweep frequency</button>
        <h3>View</h3>
        <div class="mode-toggle" id="intro-view" role="group" aria-label="Plot shown under the experiment">
          <button class="mode-btn active" type="button" data-view="bode" aria-pressed="true">Bode</button>
          <button class="mode-btn" type="button" data-view="poles" aria-pressed="false">Poles</button>
        </div>
        <p class="panel-hint">Each dot on the curves is one experiment: one frequency, one size ratio, one lag. A sweep runs them all from slow to fast.</p>
        <div class="telemetry" aria-live="off">
          <span class="t-key">Gain</span><span class="t-val" id="intro-gain">-</span>
          <span class="t-key">Phase</span><span class="t-val" id="intro-ph">-</span>
        </div>
        <p class="panel-hint">Watch three places: slow (the spring wins, output in step), near 2&nbsp;rad/s (resonance, output grows), and fast (the mass can't keep up, output shrinks and lags by almost half a cycle).</p>
      </div>
    </div>
    <div class="demo-note">
      <h4 class="demo-note-title">About this demo</h4>
      <p>
        This is the mass on a spring from the <a href="{{ '/controls/' | relative_url }}">Intro
        demo</a> (m&#8201;=&#8201;1&nbsp;kg, k&#8201;=&#8201;4&nbsp;N/m, c&#8201;=&#8201;0.4&nbsp;N&#183;s/m),
        with no controller. A force of 1&nbsp;N amplitude shakes it, and the plots show where the
        mass ends up once the start-up wobble has died away. The <strong>gain</strong> is the
        output amplitude divided by the input amplitude, in decibels (20&#8201;log<sub>10</sub>
        of the ratio, so 0&nbsp;dB means the same size and &#8722;20&nbsp;dB means a tenth). The
        <strong>phase</strong> is how far the output peaks lag behind the input peaks, in degrees
        of one cycle. Real periods run from a third of a second to a minute, so the traces always
        replay at one cycle every two seconds; the note under them gives the real period. &#8594;
        <a href="https://en.wikipedia.org/wiki/Bode_plot" target="_blank" rel="noopener">Bode plot - Wikipedia</a>
      </p>
    </div>
    <div class="demo-note">
      <h4 class="demo-note-title">Where the curve comes from: poles</h4>
      <p>
        Switch <strong>View</strong> to <strong>Poles</strong>. The plant's
        <strong>transfer function</strong> G(s)&#8201;=&#8201;1&#8201;/&#8201;(s&#178;&#8201;+&#8201;0.4s&#8201;+&#8201;4)
        is the equation of motion with every derivative replaced by s. Its <strong>poles</strong>
        are the values of s that make the bottom zero: the two &#215; marks. They are the mass's
        own motions, a ring at about 2&nbsp;rad/s that fades over about 20&nbsp;s. Shaking at a
        frequency &#969; means evaluating G at the point j&#969; on the imaginary axis, and the gain
        there is one over the product of the distances to the poles. Sweep and watch: as j&#969;
        slides past the upper pole that distance gets tiny, and that is the resonance peak on the
        Bode plot. Poles to the left of the axis die away; a pole on the right would grow without
        limit. &#8594;
        <a href="https://en.wikipedia.org/wiki/Pole%E2%80%93zero_plot" target="_blank" rel="noopener">Pole–zero plot - Wikipedia</a>
      </p>
    </div>
  </section>

  <!-- ── PID loop ───────────────────────────────────────────────── -->
  <section class="sim-section" id="sec-pid" role="tabpanel" aria-labelledby="tab-pid">
    <div class="sim-layout">
      <div class="sim-canvas-wrap sim-stack">
        <div class="sim-cell"><canvas class="sim-canvas" id="pid-time" aria-label="A sine wave injected into the PID loop and what comes back after one trip round it, next to the closed-loop step response"></canvas></div>
        <div class="bode-views">
          <div class="sim-cell-pair" id="pid-pair">
          <div class="sim-cell"><canvas class="sim-states" id="pid-mag" aria-label="Loop gain of the PID loop, with the gain margin marked"></canvas></div>
          <div class="sim-cell"><canvas class="sim-states" id="pid-phase" aria-label="Loop phase of the PID loop, with the phase margin marked"></canvas></div>
        </div>
          <div class="sim-cell bode-alt" id="pid-alt-cell" hidden>
            <canvas class="sim-states" id="pid-alt" aria-label=""></canvas>
            <div class="tf-box" id="pid-tf" aria-live="polite"></div>
          </div>
        </div>
      </div>
      <div class="sim-panel">
        <h3>Shake it</h3>
        <div class="pid-group">
          <label for="pid-w">Frequency <span id="pid-w-val">-</span></label>
          <input type="range" id="pid-w" min="0" max="1000" step="1" value="0">
        </div>
        <button class="sim-btn" id="pid-sweep" type="button" aria-pressed="false">Sweep frequency</button>
        <h3>View</h3>
        <div class="mode-toggle" id="pid-view" role="group" aria-label="Plot shown under the experiment">
          <button class="mode-btn active" type="button" data-view="bode" aria-pressed="true">Bode</button>
          <button class="mode-btn" type="button" data-view="nyquist" aria-pressed="false">Nyquist</button>
          <button class="mode-btn" type="button" data-view="poles" aria-pressed="false">Poles</button>
        </div>
        <h3>PID Gains</h3>
        <div class="pid-group">
          <label>K<sub>p</sub> <span id="pid-kp-val">40.0</span></label>
          <input type="range" id="pid-kp" min="-50" max="50" step="0.5" value="40">
          <div class="range-row"><label class="range-lbl" for="pid-kp-range"><span class="visually-hidden">Range </span>±</label><input type="number" id="pid-kp-range" class="range-input" value="50" min="1" step="1"></div>
        </div>
        <div class="pid-group">
          <label>K<sub>i</sub> <span id="pid-ki-val">5.0</span></label>
          <input type="range" id="pid-ki" min="-20" max="20" step="0.1" value="5">
          <div class="range-row"><label class="range-lbl" for="pid-ki-range"><span class="visually-hidden">Range </span>±</label><input type="number" id="pid-ki-range" class="range-input" value="20" min="1" step="1"></div>
        </div>
        <div class="pid-group">
          <label>K<sub>d</sub> <span id="pid-kd-val">6.00</span></label>
          <input type="range" id="pid-kd" min="-10" max="10" step="0.05" value="6">
          <div class="range-row"><label class="range-lbl" for="pid-kd-range"><span class="visually-hidden">Range </span>±</label><input type="number" id="pid-kd-range" class="range-input" value="10" min="1" step="1"></div>
        </div>
        <button class="sim-btn" id="pid-preset" type="button">Load suggested gains</button>
        <h3>Disturbances</h3>
        <div class="pid-group">
          <label>Delay <span id="pid-delay-val">0 ms</span></label>
          <input type="range" id="pid-delay" min="0" max="300" step="5" value="0">
        </div>
        <div class="telemetry">
          <span class="t-key">Stability</span><span class="t-val" id="pid-stable">-</span>
          <span class="t-key">Phase margin</span><span class="t-val" id="pid-pm">-</span>
          <span class="t-key">Crossover</span><span class="t-val" id="pid-wc">-</span>
          <span class="t-key">Gain up</span><span class="t-val" id="pid-gmup">-</span>
          <span class="t-key">Gain down</span><span class="t-val" id="pid-gmdown">-</span>
          <span class="t-key">Delay margin</span><span class="t-val" id="pid-dm">-</span>
        </div>
      </div>
    </div>
    <div class="demo-note">
      <h4 class="demo-note-title">About this demo</h4>
      <p>
        Same plant, now inside the PID loop from the controls Intro, with the suggested gains
        loaded. To get a Bode plot of a <em>loop</em>, cut it open at the plant input, inject a
        sine wave there, and see what arrives back at the cut after it has gone through the plant,
        the controller and any delay. That trip is the <strong>loop transfer function</strong>
        L(s)&#8201;=&#8201;C(s)&#8201;G(s)&#8201;e<sup>&#8722;sT</sup>. If what comes back is the
        same size and in step with what went in, the loop can keep that oscillation going with no
        input at all: that's instability. On the plots, "the same size" is the dashed 0&nbsp;dB line
        and "in step" is the dashed &#8722;180&#176; line (the minus sign of negative feedback
        supplies the other half-turn).
      </p>
      <p>
        The <strong>phase margin</strong> is how far the phase is from &#8722;180&#176; where the gain
        crosses 0&nbsp;dB. The <strong>gain margin</strong> is how much the gain could change before
        it reaches 0&nbsp;dB where the phase crosses &#8722;180&#176;. Delay doesn't change the gain at
        all, but it drags the phase down by &#969;T, more at every higher frequency, so it eats the
        phase margin. The <strong>delay margin</strong> is how much delay it takes to eat all of it.
        Push the delay past it and the step response, simulated on the same linear model, rings
        and grows. This is the same delay slider as on /controls/, now with a number attached.
      </p>
      <p class="eqn-note">Linear analysis, so no force limit and no noise. Stability is decided by the Nyquist criterion, which handles delay; the margins are read from the plots and only mean something when it says Stable.</p>
    </div>
    <div class="demo-note">
      <h4 class="demo-note-title">Three views of one loop</h4>
      <p>
        <strong>Bode</strong> splits L(j&#969;) into gain and phase against frequency, which is
        best for reading margins and seeing what delay does. <strong>Nyquist</strong> draws the
        same numbers as one curve in the complex plane: each point is L(j&#969;), so its distance
        from the centre is the gain and its angle is the phase. The loop oscillates on its own if
        the curve runs through &#8722;1, so the phase margin becomes an arc on the unit circle and
        the gain margin a stretch of the negative real axis. Add delay and the tail of the curve
        winds into a spiral that eventually wraps around &#8722;1. <strong>Poles</strong> shows
        the closed loop's own motions, the roots of 1&#8201;+&#8201;L(s)&#8201;=&#8201;0, with the
        transfer function written out above. The faint trail is the <strong>root locus</strong>:
        where those poles travel as every gain is scaled together. Drag K<sub>p</sub> or the delay
        and watch them move. The slowest one sets how long the step response takes to settle.
      </p>
    </div>
    <div class="demo-note">
      <h4 class="demo-note-title">Four ways to tell it's stable</h4>
      <p>
        <strong>Poles:</strong> the linear loop is stable exactly when every closed-loop pole is
        left of the imaginary axis. That's the simplest proof when there is no delay.
        <strong>Nyquist:</strong> count how the curve circles &#8722;1. This also works with delay
        and with plants that are unstable on their own, which is why the Stability readout uses it.
        <strong>Margins:</strong> not a proof by themselves, but they say how much gain or delay
        it would take to lose stability, which is what matters on real hardware.
        <strong>Simulation:</strong> the step response above. It shows the behaviour but proves
        nothing about the cases you didn't try. All four describe the <em>linear model</em>;
        a real plant with a force limit and friction needs testing on top.
      </p>
    </div>
  </section>

  <!-- ── LQR loop ───────────────────────────────────────────────── -->
  <section class="sim-section" id="sec-lqr" role="tabpanel" aria-labelledby="tab-lqr">
    <div class="sim-layout">
      <div class="sim-canvas-wrap sim-stack">
        <div class="sim-cell"><canvas class="sim-canvas" id="lqr-time" aria-label="A sine wave injected at the cart force and what comes back after one trip round the state-feedback loop, next to the pole angle after a small tilt"></canvas></div>
        <div class="bode-views">
          <div class="sim-cell-pair" id="lqr-pair">
          <div class="sim-cell"><canvas class="sim-states" id="lqr-mag" aria-label="Loop gain of the cart-pole state-feedback loop, with the gain margin marked"></canvas></div>
          <div class="sim-cell"><canvas class="sim-states" id="lqr-phase" aria-label="Loop phase of the cart-pole state-feedback loop, with the phase margin marked"></canvas></div>
        </div>
          <div class="sim-cell bode-alt" id="lqr-alt-cell" hidden>
            <canvas class="sim-states" id="lqr-alt" aria-label=""></canvas>
            <div class="tf-box" id="lqr-tf" aria-live="polite"></div>
          </div>
        </div>
      </div>
      <div class="sim-panel">
        <h3>Shake it</h3>
        <div class="pid-group">
          <label for="lqr-w">Frequency <span id="lqr-w-val">-</span></label>
          <input type="range" id="lqr-w" min="0" max="1000" step="1" value="0">
        </div>
        <button class="sim-btn" id="lqr-sweep" type="button" aria-pressed="false">Sweep frequency</button>
        <h3>View</h3>
        <div class="mode-toggle" id="lqr-view" role="group" aria-label="Plot shown under the experiment">
          <button class="mode-btn active" type="button" data-view="bode" aria-pressed="true">Bode</button>
          <button class="mode-btn" type="button" data-view="nyquist" aria-pressed="false">Nyquist</button>
          <button class="mode-btn" type="button" data-view="poles" aria-pressed="false">Poles</button>
        </div>
        <h3>State-feedback gains</h3>
        <div class="pid-group">
          <label>k<sub>x</sub>&nbsp;&middot;&nbsp;position <span id="lqr-kx-val">3.1</span></label>
          <input type="range" id="lqr-kx" min="-20" max="20" step="0.1" value="3.1">
          <div class="range-row"><label class="range-lbl" for="lqr-kx-range"><span class="visually-hidden">Range </span>±</label><input type="number" id="lqr-kx-range" class="range-input" value="20" min="1" step="1"></div>
        </div>
        <div class="pid-group">
          <label>k<sub>&#7819;</sub>&nbsp;&middot;&nbsp;velocity <span id="lqr-kv-val">5.9</span></label>
          <input type="range" id="lqr-kv" min="-20" max="20" step="0.1" value="5.9">
          <div class="range-row"><label class="range-lbl" for="lqr-kv-range"><span class="visually-hidden">Range </span>±</label><input type="number" id="lqr-kv-range" class="range-input" value="20" min="1" step="1"></div>
        </div>
        <div class="pid-group">
          <label>k<sub>&#952;</sub>&nbsp;&middot;&nbsp;pole angle <span id="lqr-kth-val">43.5</span></label>
          <input type="range" id="lqr-kth" min="-100" max="100" step="0.5" value="43.5">
          <div class="range-row"><label class="range-lbl" for="lqr-kth-range"><span class="visually-hidden">Range </span>±</label><input type="number" id="lqr-kth-range" class="range-input" value="100" min="1" step="1"></div>
        </div>
        <div class="pid-group">
          <label>k<sub>&#952;&#775;</sub>&nbsp;&middot;&nbsp;pole rate <span id="lqr-kw-val">18.1</span></label>
          <input type="range" id="lqr-kw" min="-40" max="40" step="0.1" value="18.1">
          <div class="range-row"><label class="range-lbl" for="lqr-kw-range"><span class="visually-hidden">Range </span>±</label><input type="number" id="lqr-kw-range" class="range-input" value="40" min="1" step="1"></div>
        </div>
        <button class="sim-btn" id="lqr-preset" type="button">Load LQR gains</button>
        <h3>Disturbances</h3>
        <div class="pid-group">
          <label>Delay <span id="lqr-delay-val">0 ms</span></label>
          <input type="range" id="lqr-delay" min="0" max="300" step="5" value="0">
        </div>
        <div class="telemetry">
          <span class="t-key">Stability</span><span class="t-val" id="lqr-stable">-</span>
          <span class="t-key">Phase margin</span><span class="t-val" id="lqr-pm">-</span>
          <span class="t-key">Crossover</span><span class="t-val" id="lqr-wc">-</span>
          <span class="t-key">Gain up</span><span class="t-val" id="lqr-gmup">-</span>
          <span class="t-key">Gain down</span><span class="t-val" id="lqr-gmdown">-</span>
          <span class="t-key">Delay margin</span><span class="t-val" id="lqr-dm">-</span>
        </div>
      </div>
    </div>
    <div class="demo-note">
      <h4 class="demo-note-title">About this demo</h4>
      <p>
        The cart-pole's state-feedback loop, with the LQR gains loaded. LQR isn't a PID loop, but
        it's still one force computed from the measured state, so you can cut the loop at that
        force and do the same experiment: L(s)&#8201;=&#8201;K(sI&#8201;&#8722;&#8201;A)<sup>&#8722;1</sup>B,
        using the A and B printed under the
        <a href="{{ '/controls/#cartpole' | relative_url }}">cart-pole demo</a>. With every state
        measured and no delay, LQR comes with guaranteed margins whatever Q and R you pick: at least
        60&#176; of phase margin, a gain that can rise without limit, and a gain that can drop to
        half (&#8722;6&nbsp;dB). The readout shows all three. This plant is unstable on its own,
        so the loop also fails if the gain <em>drops</em> too far: that lower limit, not the
        upper one, is the gain margin that matters here.
      </p>
      <p>
        The guarantee only covers the model. Add delay and it erodes the same way as the PID's:
        about 140&nbsp;ms is enough to break it here. A Kalman filter in place of perfect measurements takes it
        away too. Try k<sub>&#952;</sub> and k<sub>&#952;&#775;</sub> alone: the Bode plot can look
        healthy while Stability says Unstable, because the cart drifts off. With an unstable
        plant you can't read stability off the Bode plot alone; you have to count encirclements.
        Switch to <strong>Nyquist</strong> to see it: with the LQR gains the curve circles
        &#8722;1 once counterclockwise, which cancels the one unstable pole of the upright pole;
        with only k<sub>&#952;</sub> and k<sub>&#952;&#775;</sub> it doesn't circle at all. In
        <strong>Poles</strong>, the open-loop &#215; on the right is the pole falling over, and
        the gains pull every closed-loop pole into the left half-plane.
      </p>
      <p>
        LQR has one more proof of its own. The Riccati equation that gives K also gives a matrix P,
        and V&#8201;=&#8201;x<sup>T</sup>Px works like an energy that can only fall while the loop
        runs. A quantity that is always positive and always falling has to reach zero, so the state
        does too. That's a <strong>Lyapunov function</strong>, and it is why LQR is stable whatever
        Q and R you choose.
      </p>
      <p class="eqn-note">Linearised about upright, no force limit or rail ends, so the tilt response can differ from the nonlinear sim on /controls/. The pole starts 3&#176; from vertical.</p>
    </div>
  </section>
</div>

<script src="{{ '/assets/js/bode.js' | relative_url }}"></script>

<style>
.range-row{display:flex;align-items:center;gap:.25rem}
.range-lbl{font-size:.75rem;color:var(--text-muted);white-space:nowrap}
.range-input{width:3.6rem;font-size:.78rem;padding:.15rem .3rem;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text)}
.telemetry .t-key,.telemetry .t-val{white-space:nowrap}
.telemetry .t-val.bode-bad{color:var(--nn-act-neg);font-weight:600}
.bode-views{position:relative;display:grid;min-height:0}
.bode-views>*{grid-area:1/1;min-height:0}
.bode-views>[hidden]{display:none!important}
.bode-alt .tf-box{position:absolute;top:1px;left:1px;right:1px;padding:.45rem .7rem .3rem;font-family:var(--mono);font-size:.76rem;line-height:1.5;color:var(--text);overflow-x:auto;white-space:nowrap;border-radius:var(--radius) var(--radius) 0 0;pointer-events:auto}
.bode-alt .tf-box:empty{display:none}
.sim-btn[aria-pressed="true"]{background:var(--accent-soft);border-color:var(--accent);color:var(--accent)}
</style>
