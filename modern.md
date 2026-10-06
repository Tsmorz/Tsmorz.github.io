---
layout: default
title: Modern Control
description: Three newer ideas you can drag - a control barrier function that keeps a robot out of obstacles, proving things about a neural-network controller, and two loops that pass every one-at-a-time check but fail together.
permalink: /controls/modern/
---
<section class="wrap page-head">
  <h1 class="page-title">Modern Control</h1>
  <p class="su-crumb"><a href="{{ '/controls/' | relative_url }}">&#8592; Control Systems</a></p>
  <p class="page-sub controls-intro">
    The classic tools on the other pages assume one input, one output, and a controller you
    can write down. Real systems break all three. A <strong>safety filter</strong> lets any
    controller, even a learned one, run without hitting anything. <strong>Verification</strong>
    proves what a neural-network controller will do, instead of hoping. And with
    <strong>many inputs and outputs</strong>, loops that each look perfect on their own can
    still fail together. Each tab is something to drag.
  </p>
</section>

<div class="wrap" style="padding-bottom:3rem">
  <div class="sim-tabs-row">
    <div class="sim-tabs" role="tablist" aria-label="Demo selector">
      <button class="sim-tab active" role="tab" aria-selected="true"  aria-controls="sec-cbf"    id="tab-cbf"    type="button">Safety Filter</button>
      <button class="sim-tab"        role="tab" aria-selected="false" aria-controls="sec-verify" id="tab-verify" type="button">Verifying Networks</button>
      <button class="sim-tab"        role="tab" aria-selected="false" aria-controls="sec-mimo"   id="tab-mimo"   type="button">Many Loops</button>
    </div>
  </div>

  <!-- ── Control barrier functions ─────────────────────────────── -->
  <section class="sim-section active" id="sec-cbf" role="tabpanel" aria-labelledby="tab-cbf">
    <div class="sim-layout">
      <div class="sim-canvas-wrap sim-stack">
        <div class="sim-cell"><canvas class="sim-canvas" id="cbf-world" aria-label="A robot driving among three circular obstacles. Drag the goal or the obstacles. Dashed arrow: requested velocity; solid arrow: velocity after the safety filter."></canvas></div>
        <div class="sim-cell-pair">
          <div class="sim-cell"><canvas class="sim-states" id="cbf-h" aria-label="Barrier value for each obstacle over the last ten seconds"></canvas></div>
          <div class="sim-cell"><canvas class="sim-states" id="cbf-u" aria-label="Velocity space: the requested velocity, the forbidden half-planes, and the filtered velocity"></canvas></div>
        </div>
      </div>
      <div class="sim-panel">
        <h3>Safety filter</h3>
        <div class="mode-toggle" id="cbf-mode" role="group" aria-label="Safety filter">
          <button class="mode-btn" type="button" data-mode="off" aria-pressed="false">Off</button>
          <button class="mode-btn active" type="button" data-mode="cbf" aria-pressed="true">On</button>
        </div>
        <h3>Controller underneath</h3>
        <div class="mode-toggle" id="cbf-nominal" role="group" aria-label="Controller underneath the filter">
          <button class="mode-btn active" type="button" data-nominal="goal" aria-pressed="true">Go to goal</button>
          <button class="mode-btn" type="button" data-nominal="wander" aria-pressed="false">Wander</button>
        </div>
        <p class="panel-hint">Neither controller knows the obstacles exist. <strong>Wander</strong> stands in for a learned policy you can't inspect.</p>
        <h3>Caution</h3>
        <div class="pid-group">
          <label for="cbf-alpha">&#945; <span id="cbf-alpha-val">3.0 /s</span></label>
          <input type="range" id="cbf-alpha" min="0.3" max="8" step="0.1" value="3">
        </div>
        <p class="panel-hint">Small &#945;: the filter starts braking far away (the dashed rings). Large &#945;: it waits until the last moment.</p>
        <div class="telemetry">
          <span class="t-key">Collisions</span><span class="t-val" id="cbf-hits">0</span>
          <span class="t-key">Smallest h</span><span class="t-val" id="cbf-minh">-</span>
          <span class="t-key">Filter acting</span><span class="t-val" id="cbf-active">-</span>
        </div>
        <button class="sim-btn" id="cbf-reset" type="button">Restart</button>
      </div>
    </div>
    <div class="demo-note">
      <h4 class="demo-note-title">About this demo</h4>
      <p>
        A robot steers by choosing its velocity. Underneath, a simple controller asks for a
        velocity (dashed blue arrow): head for the goal, or wander. With the filter off it drives
        straight through the obstacles. With it on, every command passes through a
        <strong>control barrier function</strong> (CBF) filter first, and the robot slides round
        them, never inside, whatever the controller underneath asks for. The orange trail marks
        where the filter stepped in.
      </p>
      <p>
        Each obstacle gets a <strong>barrier</strong> h&#8201;=&#8201;distance&#178;&#8201;&#8722;&#8201;radius&#178;:
        positive outside, zero on the edge, negative inside. The filter's one rule is
        &#7723;&#8201;&#8805;&#8201;&#8722;&#945;h: you may approach an obstacle, but only slower and slower
        as you get close, so h can shrink towards zero but never cross it. Because &#7723; is just
        the velocity dotted with the direction away from the obstacle, each rule forbids a
        half-plane of velocities: the shaded regions in <em>Velocity space</em>. The filter sends
        the allowed velocity closest to the requested one (solid orange arrow): a tiny optimisation
        solved hundreds of times a second. When nothing is nearby it changes nothing at all.
      </p>
      <p>
        This is how learned controllers can be made safe without being trusted: the policy
        proposes, a filter with a proof disposes. The proof needs a model of how the robot moves,
        and it's only as good as that model. Drag an obstacle so it sits straight between the robot
        and the goal: the robot can stall against it, because the filter guarantees safety, not
        progress. Getting round is the planner's job. &#8594;
        <a href="https://en.wikipedia.org/wiki/Control_barrier_function" target="_blank" rel="noopener">Control barrier function - Wikipedia</a>
      </p>
    </div>
  </section>

  <!-- ── Verifying networks ─────────────────────────────────────── -->
  <section class="sim-section" id="sec-verify" role="tabpanel" aria-labelledby="tab-verify">
    <div class="sim-layout">
      <div class="sim-canvas-wrap sim-stack">
        <div class="sim-cell"><canvas class="sim-canvas" id="ver-map" data-net="{{ '/assets/models/verify-net.json' | relative_url }}" aria-label="Left: the network's force over pole angle and rate. Right: how large a sensor error can be proved harmless at each state. Click either map to choose a state."></canvas></div>
        <div class="sim-cell-pair">
          <div class="sim-cell"><canvas class="sim-states" id="ver-line" aria-label="The force range proved by interval bounds compared with the range found by trying inputs"></canvas></div>
          <div class="sim-cell"><canvas class="sim-states" id="ver-box" aria-label="The query box split into pieces, and how wide the bound grows layer by layer"></canvas></div>
        </div>
      </div>
      <div class="sim-panel">
        <h3>The question</h3>
        <p class="panel-hint">Click a state on either map. Can a sensor error up to &#949; change the force by more than &#948;?</p>
        <div class="pid-group">
          <label for="ver-eps">Sensor error &#949; <span id="ver-eps-val">-</span></label>
          <input type="range" id="ver-eps" min="-3.3" max="-1.3" step="0.02" value="-2.8">
        </div>
        <div class="pid-group">
          <label for="ver-delta">Allowed change &#948; <span id="ver-delta-val">-</span></label>
          <input type="range" id="ver-delta" min="0.1" max="2" step="0.05" value="0.5">
        </div>
        <h3>Split the box</h3>
        <div class="mode-toggle" id="ver-depth" role="group" aria-label="How many times to split the box">
          <button class="mode-btn active" type="button" data-depth="0" aria-pressed="true">1</button>
          <button class="mode-btn" type="button" data-depth="1" aria-pressed="false">4</button>
          <button class="mode-btn" type="button" data-depth="2" aria-pressed="false">16</button>
          <button class="mode-btn" type="button" data-depth="3" aria-pressed="false">64</button>
        </div>
        <div class="telemetry">
          <span class="t-key">Force here</span><span class="t-val" id="ver-force">-</span>
          <span class="t-key">Proved</span><span class="t-val" id="ver-bound">-</span>
          <span class="t-key">Found</span><span class="t-val" id="ver-attack">-</span>
          <span class="t-key">Answer</span><span class="t-val" id="ver-verdict">-</span>
        </div>
        <button class="sim-btn" id="ver-big" type="button"
                data-meta="{{ '/assets/models/swingup-tqc.json' | relative_url }}"
                data-weights="{{ '/assets/models/swingup-tqc.bin' | relative_url }}">Try the swing-up network too</button>
      </div>
    </div>
    <div class="demo-note">
      <h4 class="demo-note-title">About this demo</h4>
      <p>
        The network here is a small one (4 inputs, two layers of 16, one output) trained to copy
        the <a href="{{ '/controls/#cartpole' | relative_url }}">cart-pole's LQR controller</a>.
        The left map is what it does: the force it commands at each pole angle and rate. Testing
        it at a few thousand states says it <em>looks</em> fine. Verification asks for more: a
        proof that holds for <em>every</em> input in a region, including the ones no test tried.
        The question here is about sensor error: if the angle reading is off by up to &#949; and the
        rate by up to 5&#949; (the same ratio as the noise on /controls/), can the force move more than
        &#948; from its true value?
      </p>
      <p>
        <strong>Interval bound propagation</strong> answers it by pushing the whole box of possible
        inputs through the network at once, layer by layer, keeping each neuron's lowest and highest
        possible value. Whatever comes out the end is guaranteed to contain every real output. But
        each layer loses some precision, so the bound is <em>loose</em>: the hatched bar is always
        wider than the range actually found by trying inputs (orange). Three outcomes: the proof fits
        inside the allowed band (<strong>proved</strong>), a tried input lands outside it
        (<strong>disproved</strong>, with the counterexample), or neither
        (<strong>unknown</strong>). Then you split the box into pieces and bound each one separately,
        which tightens the proof. That is <strong>branch and bound</strong>, the core of real
        network verifiers. The right map runs this at every state: teal where large sensor errors are
        provably harmless, red where even tiny ones aren't, which is wherever the network's
        force changes steeply.
      </p>
      <p>
        Now press <strong>Try the swing-up network too</strong>. It runs the same proof on the
        1-million-weight policy from the <a href="{{ '/controls/swingup/' | relative_url }}">swing-up page</a>,
        and the bar chart shows what happens: the bound grows a little at every layer and compounds,
        so by the output it covers the whole ±20&nbsp;N force range even for a thousandth of a radian.
        Nothing is wrong with the network; the proof method just doesn't scale this simply. Real
        verifiers use tighter linear bounds (CROWN, &#945;,&#946;-CROWN) and lots of splitting, and
        even they struggle with networks this size. That's why the practical answer for big
        policies is the <strong>Safety Filter</strong> tab: verify the small thing you can, and
        wrap the big thing you can't. &#8594;
        <a href="https://arxiv.org/abs/1810.12715" target="_blank" rel="noopener">Gowal et al., interval bound propagation</a>
      </p>
    </div>
  </section>

  <!-- ── MIMO ────────────────────────────────────────────────────── -->
  <section class="sim-section" id="sec-mimo" role="tabpanel" aria-labelledby="tab-mimo">
    <div class="sim-layout">
      <div class="sim-canvas-wrap sim-stack">
        <div class="sim-cell"><canvas class="sim-canvas" id="mimo-sat" aria-label="Left: where the spinning satellite's axis points. Right: a map of which pairs of gain errors keep it stable; drag the dot."></canvas></div>
        <div class="sim-cell-pair">
          <div class="sim-cell"><canvas class="sim-states" id="mimo-time" aria-label="Pointing error on both axes over the last ten seconds"></canvas></div>
          <div class="sim-cell"><canvas class="sim-states" id="mimo-loops" aria-label="Nyquist plot of each loop on its own, and the closed-loop poles with both loops together"></canvas></div>
        </div>
      </div>
      <div class="sim-panel">
        <h3>Gain errors</h3>
        <div class="pid-group">
          <label for="mimo-d1">Actuator 1 &#948;<sub>1</sub> <span id="mimo-d1-val">0%</span></label>
          <input type="range" id="mimo-d1" min="-0.5" max="0.5" step="0.01" value="0">
        </div>
        <div class="pid-group">
          <label for="mimo-d2">Actuator 2 &#948;<sub>2</sub> <span id="mimo-d2-val">0%</span></label>
          <input type="range" id="mimo-d2" min="-0.5" max="0.5" step="0.01" value="0">
        </div>
        <button class="sim-btn" id="mimo-preset" type="button">Try +15% / &#8722;15%</button>
        <button class="sim-btn" id="mimo-zero" type="button">No errors</button>
        <button class="sim-btn" id="mimo-nudge" type="button">Nudge it</button>
        <div class="telemetry">
          <span class="t-key">Now</span><span class="t-val" id="mimo-stable">-</span>
          <span class="t-key">Loop 1 alone</span><span class="t-val" id="mimo-l1">-</span>
          <span class="t-key">Loop 2 alone</span><span class="t-val" id="mimo-l2">-</span>
          <span class="t-key">Both at once</span><span class="t-val" id="mimo-both">-</span>
        </div>
      </div>
    </div>
    <div class="demo-note">
      <h4 class="demo-note-title">About this demo</h4>
      <p>
        A satellite spins about its long axis, and two thrusters keep that axis pointed at a target.
        Because it spins, pushing on one axis also swings the other: the two loops are
        <strong>coupled</strong>. The controller is the simplest possible, each thruster correcting
        its own axis. Check it the classic way, one loop at a time (break one loop, keep the other
        closed): each has 90&#176; of phase margin and no gain limit at all. Its Nyquist curve never
        comes near &#8722;1. Every single-loop check on the other pages says this is a superb design.
      </p>
      <p>
        Now drag the dot on the map, which sets a gain error on each thruster. Along the two
        teal lines (one thruster wrong, the other perfect) it stays stable from &#8722;50% to +50%,
        and far beyond. But move off the lines, one thruster a bit strong and the other a bit weak,
        and it fails at under 10%: the dashed square. The closed-loop poles show it, one of them
        crossing into the right half-plane, and the axis spirals off the target. Single-loop margins
        only test perturbations along the axes; real hardware errs in every direction at once.
      </p>
      <p>
        The multivariable fixes look at the loops together: <strong>singular values</strong> of the
        loop matrix generalise the Bode gain, and <strong>disk margins</strong> and the
        <strong>structured singular value</strong> (&#956;) ask for the smallest simultaneous error
        that breaks the loop, which is the size of the dashed square. The example is from Doyle,
        and the numbers are textbook (Skogestad &amp; Postlethwaite, Example 3.12): with spin
        a&#8201;=&#8201;10, the loop breaks at 1/&#8730;(1&#8201;+&#8201;a&#178;)&#8201;&#8776;&#8201;9.95%.
        LQR's guaranteed margins hold in every input channel at the same time, so a full-state
        LQR design doesn't have this blind spot, which is one reason it's used for coupled systems
        like this. &#8594;
        <a href="https://en.wikipedia.org/wiki/Structured_singular_value" target="_blank" rel="noopener">Structured singular value - Wikipedia</a>
      </p>
      <p class="eqn-note">ẋ&#8201;=&#8201;Ax&#8201;+&#8201;u, y&#8201;=&#8201;Cx, A&#8201;=&#8201;[[0, a], [&#8722;a, 0]], C&#8201;=&#8201;[[1, a], [&#8722;a, 1]], u<sub>i</sub>&#8201;=&#8201;&#8722;(1&#8201;+&#8201;&#948;<sub>i</sub>)&#8201;y<sub>i</sub>. With both &#948;&#8201;=&#8201;0 the closed loop has a double pole at &#8722;1.</p>
    </div>
  </section>
</div>

<script src="{{ '/assets/js/modern-core.js' | relative_url }}"></script>
<script src="{{ '/assets/js/modern.js' | relative_url }}"></script>

<style>
.telemetry .t-key,.telemetry .t-val{white-space:nowrap}
.telemetry .t-val.bode-bad{color:var(--nn-act-neg);font-weight:600}
.telemetry .t-val.ver-unknown{color:var(--text)}
#sec-verify .sim-canvas, #sec-mimo .sim-canvas { cursor: crosshair; }
#sec-cbf .sim-canvas { cursor: grab; touch-action: none; }
#sec-verify .sim-canvas, #sec-mimo .sim-canvas { touch-action: none; }
</style>
