/* Double cart-pole: swing it up by hand, or command a goal-conditioned TQC
   policy trained in n-cartpole to move between UU / UD / DU / DD.

   Two parts:
   - SwingupCore — physics, actuator, and the policy network. No DOM, so
     script/test-swingup can check it against the Python original under Node.
   - The page — only runs when there's a document with #su-canvas.

   Every physical constant comes from assets/models/swingup-tqc.json, which
   n-cartpole's `task export-web` writes from the checkpoint's own training
   config. Don't hard-code any of them here: the policy only works on the
   plant it was trained on. The JSON's optional "goals" block (labels and
   target angles) marks a goal-conditioned net; without it the net is a plain
   swing-up policy and the target is always all-up. */
(function (root) {
  'use strict';

  /* ================================================================
     SwingupCore
  ================================================================ */
  var Core = (function () {

    /* ---- Plant: port of n_cartpole/env/dynamics.py ----
       state = [x, ẋ, θ₀, θ̇₀, θ₁, θ̇₁, …], absolute angles, θ = 0 upright.
       M(θ) q̈ = rhs with M[0][0] = M + Σm, M[0][k+1] = μₖlₖcosθₖ,
       M[j+1][k+1] = μ_max(j,k) lⱼlₖ cos(θⱼ−θₖ), μₖ = Σ_{i≥k} mᵢ. */
    function createPlant(meta) {
      var p = meta.physics, n = meta.n_links;
      var m = p.masses, l = p.lengths, c = p.joint_friction;
      var mu = new Array(n), acc = 0;
      for (var k = n - 1; k >= 0; k--) { acc += m[k]; mu[k] = acc; }
      var mTotal = p.M + acc, dim = 2 + 2 * n, N = n + 1;
      var substeps = (meta.integrator && meta.integrator.substeps) || 4;

      var A = [], r = new Float64Array(N), qdd = new Float64Array(N);
      for (var i = 0; i < N; i++) A.push(new Float64Array(N));

      // Gaussian elimination with partial pivoting; M is SPD but may be ill-conditioned.
      function solve() {
        for (var col = 0; col < N; col++) {
          var piv = col;
          for (var row = col + 1; row < N; row++) {
            if (Math.abs(A[row][col]) > Math.abs(A[piv][col])) piv = row;
          }
          if (piv !== col) {
            var tr = A[col]; A[col] = A[piv]; A[piv] = tr;
            var tv = r[col]; r[col] = r[piv]; r[piv] = tv;
          }
          for (var rr = col + 1; rr < N; rr++) {
            var f = A[rr][col] / A[col][col];
            if (f === 0) continue;
            for (var cc = col; cc < N; cc++) A[rr][cc] -= f * A[col][cc];
            r[rr] -= f * r[col];
          }
        }
        for (var q = N - 1; q >= 0; q--) {
          var s = r[q];
          for (var j = q + 1; j < N; j++) s -= A[q][j] * qdd[j];
          qdd[q] = s / A[q][q];
        }
      }

      function deriv(s, F, out) {
        var xd = s[1], j, k;
        A[0][0] = mTotal;
        var cart = F - p.b * xd;
        for (k = 0; k < n; k++) {
          var thk = s[2 + 2 * k], wk = s[3 + 2 * k];
          A[0][k + 1] = A[k + 1][0] = mu[k] * l[k] * Math.cos(thk);
          cart += mu[k] * l[k] * Math.sin(thk) * wk * wk;
          for (j = 0; j < n; j++) {
            A[j + 1][k + 1] = mu[Math.max(j, k)] * l[j] * l[k] * Math.cos(s[2 + 2 * j] - thk);
          }
        }
        r[0] = cart;
        for (k = 0; k < n; k++) {
          var th = s[2 + 2 * k], w = s[3 + 2 * k];
          var rk = mu[k] * p.g * l[k] * Math.sin(th);             // gravity
          for (j = 0; j < n; j++) {                                // centrifugal coupling
            if (j === k) continue;
            var wj = s[3 + 2 * j];
            rk += mu[Math.max(j, k)] * l[k] * l[j] * Math.sin(s[2 + 2 * j] - th) * wj * wj;
          }
          rk -= c[k] * (w - (k >= 1 ? s[1 + 2 * k] : 0));          // own joint (relative rate)
          if (k + 1 < n) rk += c[k + 1] * (s[5 + 2 * k] - w);      // child joint's reaction
          r[k + 1] = rk;
        }
        solve();
        out[0] = xd; out[1] = qdd[0];
        for (k = 0; k < n; k++) { out[2 + 2 * k] = s[3 + 2 * k]; out[3 + 2 * k] = qdd[k + 1]; }
      }

      var k1 = new Float64Array(dim), k2 = new Float64Array(dim),
          k3 = new Float64Array(dim), k4 = new Float64Array(dim), tmp = new Float64Array(dim);

      // One control step (dt) of fixed-step RK4 with h = dt / substeps. Python uses
      // RK45 with max_step = dt/4; at this step size the two agree to ~1e-6.
      // Angles are deliberately left unwrapped, as in the Python.
      function step(state, F) {
        F = Math.max(-p.force_max, Math.min(p.force_max, F));
        var h = p.dt / substeps, s = Float64Array.from(state), i;
        for (var sub = 0; sub < substeps; sub++) {
          deriv(s, F, k1);
          for (i = 0; i < dim; i++) tmp[i] = s[i] + 0.5 * h * k1[i];
          deriv(tmp, F, k2);
          for (i = 0; i < dim; i++) tmp[i] = s[i] + 0.5 * h * k2[i];
          deriv(tmp, F, k3);
          for (i = 0; i < dim; i++) tmp[i] = s[i] + h * k3[i];
          deriv(tmp, F, k4);
          for (i = 0; i < dim; i++) s[i] += h / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
        }
        return s;
      }

      return { n: n, dim: dim, physics: p, step: step };
    }

    /* ---- Actuator: force limit + slew limit, as in NPendulumCartpole.step ---- */
    function createActuator(meta) {
      var p = meta.physics, slew = meta.force_slew, prev = 0;
      return {
        apply: function (cmd) {
          var F = Math.max(-p.force_max, Math.min(p.force_max, cmd));
          if (slew != null) {
            var dF = slew * p.dt;
            F = prev + Math.max(-dF, Math.min(dF, F - prev));
          }
          prev = F;
          return F;
        },
        reset: function () { prev = 0; }
      };
    }

    // [x, ẋ, cos θ₀, sin θ₀, θ̇₀, …] — matches n_cartpole.env.cartpole.encode_obs.
    // A goal net also gets cos of each link's target angle after the kinematics
    // (NPendulumCartpole._make_obs); pass target = null for a plain swing-up net.
    function encodeObs(state, n, target) {
      var o = new Float32Array(2 + 3 * n + (target ? n : 0));
      o[0] = state[0]; o[1] = state[1];
      for (var k = 0; k < n; k++) {
        var th = state[2 + 2 * k];
        o[2 + 3 * k] = Math.cos(th); o[3 + 3 * k] = Math.sin(th); o[4 + 3 * k] = state[3 + 2 * k];
        if (target) o[2 + 3 * n + k] = Math.cos(target[k]);
      }
      return o;
    }

    function wrapAngle(a) {
      a = (a + Math.PI) % (2 * Math.PI);
      if (a < 0) a += 2 * Math.PI;
      return a - Math.PI;
    }

    // Every link within tol_angle of its target (default upright) and slower than
    // tol_vel — NPendulumCartpole._at_goal (held for settle_steps in a row).
    function atGoal(state, meta, target) {
      var sc = meta.success;
      for (var k = 0; k < meta.n_links; k++) {
        var th = state[2 + 2 * k] - (target ? target[k] : 0);
        // Written as !(… < tol) so a NaN state never counts as reached.
        if (!(Math.abs(wrapAngle(th)) < sc.tol_angle)) return false;
        if (!(Math.abs(state[3 + 2 * k]) < sc.tol_vel)) return false;
      }
      return true;
    }

    /* ---- Policy: SimBa actor (n_cartpole/policy/simba.py), deterministic head ----
       in_proj → blocks × [h += fc2(relu(fc1(LN(h))))] → LN → mean; F = tanh(mean)·Fmax.
       The exporter already folded the RunningNorm into in_proj. */
    function halfToFloat(buffer) {
      var dv = new DataView(buffer), len = buffer.byteLength / 2;
      var out = new Float32Array(len);
      for (var i = 0; i < len; i++) {
        var h = dv.getUint16(2 * i, true);
        var sign = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
        out[i] = e === 0 ? sign * f * 5.960464477539063e-8               // 2^-24, subnormal
               : e === 31 ? (f ? NaN : sign * Infinity)
               : sign * (1 + f / 1024) * Math.pow(2, e - 15);
      }
      return out;
    }

    function createPolicy(meta, buffer) {
      var net = meta.network, all = halfToFloat(buffer), T = {};
      net.tensors.forEach(function (t) {
        var size = t.shape.reduce(function (a, b) { return a * b; }, 1);
        T[t.name] = all.subarray(t.offset, t.offset + size);
      });
      var H = net.hidden, E = H * net.expand, D = net.obs_dim, eps = net.ln_eps;
      var fmax = meta.physics.force_max;
      var h = new Float32Array(H), t = new Float32Array(H), u = new Float32Array(E);

      function linear(W, b, x, inDim, outDim, out) {
        for (var o = 0; o < outDim; o++) {
          var s = b[o], row = o * inDim;
          for (var i = 0; i < inDim; i++) s += W[row + i] * x[i];
          out[o] = s;
        }
      }
      function layerNorm(x, w, b, out) {
        var mean = 0, v = 0, i;
        for (i = 0; i < H; i++) mean += x[i];
        mean /= H;
        for (i = 0; i < H; i++) { var d = x[i] - mean; v += d * d; }
        var inv = 1 / Math.sqrt(v / H + eps);
        for (i = 0; i < H; i++) out[i] = (x[i] - mean) * inv * w[i] + b[i];
      }

      function act(obs) {
        linear(T.in_w, T.in_b, obs, D, H, h);
        for (var bi = 0; bi < net.blocks; bi++) {
          var P = 'b' + bi + '_';
          layerNorm(h, T[P + 'ln_w'], T[P + 'ln_b'], t);
          linear(T[P + 'fc1_w'], T[P + 'fc1_b'], t, H, E, u);
          for (var i = 0; i < E; i++) if (u[i] < 0) u[i] = 0;
          var W2 = T[P + 'fc2_w'], b2 = T[P + 'fc2_b'];
          for (var o = 0; o < H; o++) {                   // residual: h += fc2(u)
            var s = b2[o], row = o * E;
            for (var j = 0; j < E; j++) s += W2[row + j] * u[j];
            h[o] += s;
          }
        }
        layerNorm(h, T.final_ln_w, T.final_ln_b, t);
        var mean = T.out_b[0];
        for (var k = 0; k < H; k++) mean += T.out_w[k] * t[k];
        return Math.tanh(mean) * fmax;
      }

      return { act: act };
    }

    return {
      createPlant: createPlant,
      createActuator: createActuator,
      createPolicy: createPolicy,
      encodeObs: encodeObs,
      wrapAngle: wrapAngle,
      atGoal: atGoal
    };
  })();

  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  root.SwingupCore = Core;

  /* ================================================================
     Page
  ================================================================ */
  if (typeof document === 'undefined') return;
  var canvas = document.getElementById('su-canvas');
  if (!canvas) return;

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function uniform(a) { return (2 * Math.random() - 1) * a; }

  var plotCanvas = document.getElementById('su-plot');
  var modeBtns   = Array.prototype.slice.call(document.querySelectorAll('.mode-btn[data-mode]'));
  var tqcBtn     = document.querySelector('.mode-btn[data-mode="tqc"]');
  var scoreEl    = document.getElementById('su-score');
  var scoreLblEl = document.getElementById('su-score-label');
  var bestManEl  = document.getElementById('su-best-manual');
  var bestTqcEl  = document.getElementById('su-best-tqc');
  var bestHeadEl = document.getElementById('su-best-head');
  var targetsEl  = document.getElementById('su-targets');
  var goalBtns   = Array.prototype.slice.call(document.querySelectorAll('.goal-btn[data-goal]'));
  var randomGoalBtn = document.getElementById('su-goal-random');
  var modelEl    = document.getElementById('su-model-status');
  var paramsEl   = document.getElementById('su-params');

  // Manual drag: a stiff, well-damped virtual spring from the cart to the pointer
  // (ζ ≈ 0.7 on the 1.35 kg cart+bobs), then the same ±Fmax / slew limits as the robot.
  var DRAG_K = 150, DRAG_C = 20;
  var MANUAL_F = 10;   // manual force cap (N); the plant's own limit stays as exported
  var PUSH_F = 5;                     // N — arrow-key shove in TQC mode (a disturbance)
  var HIST = 600;                     // telemetry samples (6 s at 100 Hz)
  var MAX_STEPS_PER_FRAME = 8;
  var RANDOM_DWELL = 100;             // steps (1 s) held at a reached target before Random moves on
  // The one deliberate departure from the exported plant: a longer rail than the
  // network trained on (meta.physics.x_lim, kept as trainedXLim) so there's room to
  // play by hand. Past ±trainedXLim the policy is outside its training data.
  var RAIL_HALF = 1.0;                // m
  var trainedXLim = null;

  var meta = null, plant = null, actuator = null, policy = null, policyLoading = false;
  var state = null, mode = 'manual', status = 'loading';
  // goal: U/D label, base link first; target: its angles (null = all upright, for a
  // plain swing-up export). fromLabel: the pose the clock started at, if any.
  var goal = 'UU', target = null, fromLabel = null, randomOn = false;
  var simT = 0, segT = 0, settled = 0, reachTime = null, modesUsed = {};
  var applied = 0, crashTimer = null;
  var best = {};                      // goal label → { manual, tqc } in seconds
  var dragX = null, keyL = false, keyR = false;
  var hist = { x: [], th1: [], th2: [], F: [] };
  var view = { W: 0, H: 0, scale: 1, cx: 0, trackY: 0 };

  fetch(canvas.dataset.meta)
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (m) {
      meta = m;
      trainedXLim = meta.physics.x_lim;
      meta.physics.x_lim = Math.max(RAIL_HALF, trainedXLim);
      plant = Core.createPlant(meta);
      actuator = Core.createActuator(meta);
      renderParams();
      if (meta.goals) {
        goalBtns.forEach(function (b) { b.querySelector('.goal-icon').innerHTML = goalIcon(b.dataset.goal); });
        if (targetsEl) targetsEl.hidden = false;
        selectGoal('UU', false);
      }
      reset('hanging');
    })
    .catch(function () {
      status = 'error';
      if (modelEl) modelEl.textContent = 'Could not load the simulation parameters.';
    });

  function renderParams() {
    if (!paramsEl) return;
    var p = meta.physics;
    paramsEl.textContent =
      'Cart M = ' + p.M + ' kg, bobs m = ' + p.masses.join(' / ') + ' kg on massless rods l = ' +
      p.lengths.join(' / ') + ' m, cart friction b = ' + p.b + ' N·s/m, joint friction ' +
      p.joint_friction.join(' / ') + ' N·m·s/rad. Force limit ±' + p.force_max + ' N, slew ' +
      meta.force_slew + ' N/s, rail ±' + p.x_lim + ' m (trained on ±' + trainedXLim + ' m), ' + Math.round(1 / p.dt) +
      ' Hz control, RK4 with ' + meta.integrator.substeps + ' substeps per step. ' +
      'Network: ' + meta.network.blocks + ' residual blocks, width ' + meta.network.hidden +
      ', trained ' + (meta.source.step / 1000) + 'k steps.';
  }

  // Pictogram of a target pose: cart on a rail, link 1 then link 2. The splay is
  // only for legibility (wider where a link folds back); in UD / DU the real
  // poles fold exactly onto each other.
  function goalIcon(label) {
    var cx = 16, cy = 26, L = 12, x = cx, y = cy, tilt = -0.1;
    var out = '<svg viewBox="0 0 32 52" focusable="false">' +
      '<line class="gi-rail" x1="2" y1="' + (cy + 3) + '" x2="30" y2="' + (cy + 3) + '"/>' +
      '<rect class="gi-cart" x="11" y="' + (cy - 2.5) + '" width="10" height="5" rx="1.5"/>';
    for (var k = 0; k < label.length; k++) {
      if (k > 0) tilt += label[k] === label[k - 1] ? 0.4 : 0.8;
      var th = (label[k] === 'D' ? Math.PI : 0) + tilt;
      var nx = x + L * Math.sin(th), ny = y - L * Math.cos(th);
      out += '<line class="gi-rod" x1="' + x.toFixed(1) + '" y1="' + y.toFixed(1) +
             '" x2="' + nx.toFixed(1) + '" y2="' + ny.toFixed(1) + '"/>' +
             '<circle class="gi-bob-' + (k % 2) + '" cx="' + nx.toFixed(1) + '" cy="' + ny.toFixed(1) + '" r="3"/>';
      x = nx; y = ny;
    }
    return out + '</svg>';
  }

  function targetOf(label) {
    return meta.goals ? meta.goals.targets[meta.goals.labels.indexOf(label)] : null;
  }

  // The pose the rig is resting in right now (within the "reached" tolerances), or null.
  function poseOf(s) {
    if (!meta.goals) return Core.atGoal(s, meta, null) ? 'UU' : null;
    for (var i = 0; i < meta.goals.labels.length; i++) {
      if (Core.atGoal(s, meta, meta.goals.targets[i])) return meta.goals.labels[i];
    }
    return null;
  }

  // Restart the clock: from a reset, or from wherever the rig is when the target changes.
  function startClock() {
    fromLabel = state ? poseOf(state) : null;
    segT = 0; settled = 0; reachTime = null;
    modesUsed = {};
    updateScore();
  }

  function selectGoal(label, handOff) {
    if (!meta || !meta.goals || meta.goals.labels.indexOf(label) < 0) return;
    if (label !== goal || target === null) {
      goal = label;
      target = targetOf(label);
      goalBtns.forEach(function (b) {
        var on = b.dataset.goal === goal;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      if (state) startClock();
    }
    if (handOff && mode !== 'tqc') setMode('tqc');
  }

  // handOff: a click hands control to the network; Random's own later picks don't,
  // so a visitor who switched back to Manual keeps it.
  function randomGoal(handOff) {
    if (!meta || !meta.goals) return;
    var others = meta.goals.labels.filter(function (l) { return l !== goal; });
    selectGoal(others[Math.floor(Math.random() * others.length)], handOff);
  }

  // Random stays on, picking a new target each time the last one is reached,
  // until a specific target is chosen.
  function setRandom(on) {
    randomOn = on;
    if (randomGoalBtn) {
      randomGoalBtn.classList.toggle('active', on);
      randomGoalBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function reset(kind) {
    if (!meta) return;
    if (crashTimer) { clearTimeout(crashTimer); crashTimer = null; }
    var n = meta.n_links, s = new Float64Array(plant.dim), i;
    if (kind === 'random') {
      // Like NPendulumCartpole._random_state: anywhere, modest velocities.
      // Positions stay within the trained rail so TQC starts in familiar territory.
      s[0] = uniform(0.5 * trainedXLim); s[1] = uniform(2);
      for (i = 0; i < n; i++) { s[2 + 2 * i] = uniform(Math.PI); s[3 + 2 * i] = uniform(2); }
    } else {
      // Like eval_swingup.py: near hanging, low energy.
      s[1] = uniform(0.2);
      for (i = 0; i < n; i++) { s[2 + 2 * i] = Math.PI + uniform(0.2); s[3 + 2 * i] = uniform(0.2); }
    }
    state = s;
    actuator.reset();
    applied = 0; simT = 0;
    hist = { x: [], th1: [], th2: [], F: [] };
    status = 'running';
    startClock();
  }

  function setMode(next) {
    if (next === 'tqc' && !policy) { loadPolicy(); return; }
    mode = next;
    modeBtns.forEach(function (b) {
      var on = b.dataset.mode === mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function loadPolicy() {
    if (policyLoading || !meta) return;
    policyLoading = true;
    if (tqcBtn) { tqcBtn.disabled = true; tqcBtn.textContent = 'Loading…'; }
    fetch(canvas.dataset.weights)
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then(function (buf) {
        policy = Core.createPolicy(meta, buf);
        if (modelEl) modelEl.textContent = '';
        setMode('tqc');
      })
      .catch(function () {
        if (modelEl) modelEl.textContent = 'Could not load the network weights.';
      })
      .then(function () {
        policyLoading = false;
        if (tqcBtn) { tqcBtn.disabled = false; tqcBtn.textContent = 'TQC network'; }
      });
  }

  modeBtns.forEach(function (b) {
    b.addEventListener('click', function () { setMode(b.dataset.mode); });
  });
  document.getElementById('su-reset').addEventListener('click', function () { reset('hanging'); });
  document.getElementById('su-random').addEventListener('click', function () { reset('random'); });
  goalBtns.forEach(function (b) {
    b.addEventListener('click', function () { setRandom(false); selectGoal(b.dataset.goal, true); });
  });
  if (randomGoalBtn) {
    randomGoalBtn.addEventListener('click', function () { setRandom(true); randomGoal(true); });
  }

  /* ---- Input ---- */
  function pointerToX(e) {
    var rect = canvas.getBoundingClientRect();
    return (e.clientX - rect.left - view.cx) / view.scale;
  }
  canvas.addEventListener('pointerdown', function (e) {
    if (!meta) return;
    dragX = pointerToX(e);
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', function (e) { if (dragX !== null) dragX = pointerToX(e); });
  function endDrag() { dragX = null; }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  function typing(e) {
    var t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }
  document.addEventListener('keydown', function (e) {
    if (typing(e)) return;
    if (e.key === 'ArrowLeft')  { keyL = true; e.preventDefault(); }
    if (e.key === 'ArrowRight') { keyR = true; e.preventDefault(); }
  });
  document.addEventListener('keyup', function (e) {
    if (e.key === 'ArrowLeft')  keyL = false;
    if (e.key === 'ArrowRight') keyR = false;
  });
  window.addEventListener('blur', function () { keyL = keyR = false; dragX = null; });

  /* ---- Simulation step (100 Hz) ---- */
  function simStep() {
    var p = meta.physics, keys = (keyR ? 1 : 0) - (keyL ? 1 : 0), cmd, shove = 0;
    if (mode === 'tqc' && policy) {
      cmd = policy.act(Core.encodeObs(state, meta.n_links, meta.goals ? target : null));
      shove = keys * PUSH_F;
      modesUsed.tqc = true;
    } else {
      cmd = keys * MANUAL_F;
      if (dragX !== null) {
        var dragTo = clamp(dragX, -p.x_lim, p.x_lim);
        cmd += DRAG_K * (dragTo - state[0]) - DRAG_C * state[1];
      }
      cmd = clamp(cmd, -MANUAL_F, MANUAL_F);
      // Idle manual time (e.g. while the weights load) doesn't disqualify a TQC run.
      if (cmd !== 0) modesUsed.manual = true;
    }
    applied = actuator.apply(cmd);
    state = plant.step(state, applied + shove);
    simT += p.dt; segT += p.dt;

    if (Math.abs(state[0]) > p.x_lim) {          // the rail end (training terminated at ±trainedXLim)
      status = 'crashed';
      crashTimer = setTimeout(function () { crashTimer = null; reset('hanging'); }, 1500);
      return;
    }
    // Keep counting after the target is reached, so the status can tell holding from recovering.
    settled = Core.atGoal(state, meta, target) ? settled + 1 : 0;
    if (reachTime === null && settled >= meta.success.settle_steps) {
      reachTime = segT - (meta.success.settle_steps - 1) * p.dt;
      var who = modesUsed.manual && !modesUsed.tqc ? 'manual'
              : modesUsed.tqc && !modesUsed.manual ? 'tqc' : null;
      var rec = best[goal] || (best[goal] = { manual: null, tqc: null });
      // Starting already at the target is no record.
      if (who && fromLabel !== goal && (rec[who] === null || reachTime < rec[who])) rec[who] = reachTime;
      updateScore();
    }
    if (randomOn && reachTime !== null && settled >= meta.success.settle_steps + RANDOM_DWELL) {
      randomGoal(false);
    }

    hist.x.push(state[0]);
    hist.th1.push(Core.wrapAngle(state[2]) * 180 / Math.PI);
    hist.th2.push(Core.wrapAngle(state[4]) * 180 / Math.PI);
    hist.F.push(applied + shove);
    if (hist.x.length > HIST) { hist.x.shift(); hist.th1.shift(); hist.th2.shift(); hist.F.shift(); }
  }

  function updateScore() {
    var rec = best[goal] || {};
    function secs(v) { return v == null ? '—' : v.toFixed(2) + ' s'; }
    if (scoreEl) scoreEl.textContent = reachTime === null ? '—' : reachTime.toFixed(2);
    if (scoreLblEl) scoreLblEl.textContent = (fromLabel ? fromLabel + ' ' : '') + '→ ' + goal + ' time (s)';
    // The goal lives in its own header row so the rows below never change length and wrap.
    if (bestHeadEl) bestHeadEl.textContent = 'Best → ' + goal;
    if (bestManEl) bestManEl.textContent = secs(rec.manual);
    if (bestTqcEl) bestTqcEl.textContent = secs(rec.tqc);
  }

  /* ---- Rendering ---- */
  // The layout sets each canvas's CSS box (half the panel height each); only
  // the pixel buffer is sized here.
  function sizeCanvas(cv) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var W = cv.clientWidth || 720, H = cv.clientHeight || 300;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    }
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, W: W, H: H };
  }

  function drawScene() {
    var c = sizeCanvas(canvas);
    var ctx = c.ctx, W = c.W, H = c.H;
    var bg = cssVar('--bg-soft'), border = cssVar('--border'), strong = cssVar('--border-strong');
    var text = cssVar('--text'), muted = cssVar('--text-muted'), accent = cssVar('--accent');
    var mono = cssVar('--mono'), font = cssVar('--font');
    var col1 = cssVar('--viz-1'), col2 = cssVar('--viz-2'), colF = cssVar('--viz-4');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    if (!meta || !state) {
      ctx.fillStyle = muted; ctx.font = '13px ' + font; ctx.textAlign = 'center';
      ctx.fillText(status === 'error' ? 'Simulation unavailable' : 'Loading…', W / 2, H / 2);
      return;
    }

    var p = meta.physics, reach = p.lengths.reduce(function (a, b) { return a + b; }, 0);
    var cartHalf = 0.08;
    // Fit the rail across, and the full reach both straight up and straight down,
    // with just enough margin that a bob (and its target ring) stays inside.
    var scale = Math.min((W - 40) / (2 * (p.x_lim + cartHalf) + 0.1), (H - 28) / (2 * reach + 0.04));
    var cx = W / 2, trackY = Math.round(H / 2 + 6);
    view = { W: W, H: H, scale: scale, cx: cx, trackY: trackY };
    function sx(xm) { return cx + xm * scale; }

    // Rail with hard stops where the cart centre reaches ±x_lim.
    var railL = sx(-p.x_lim - cartHalf), railR = sx(p.x_lim + cartHalf);
    ctx.strokeStyle = strong; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(railL, trackY); ctx.lineTo(railR, trackY); ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.fillStyle = muted;
    [railL, railR].forEach(function (xp) { ctx.fillRect(xp - 3, trackY - 14, 6, 28); });
    ctx.font = '10px ' + mono; ctx.textAlign = 'center';
    for (var m = -p.x_lim; m <= p.x_lim + 1e-9; m += 0.25) {
      ctx.strokeStyle = border; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(sx(m), trackY + 8); ctx.lineTo(sx(m), trackY + 14); ctx.stroke();
    }

    var cartX = sx(state[0]);

    // Drag target + spring
    if (dragX !== null && mode === 'manual') {
      var tx = sx(clamp(dragX, -p.x_lim, p.x_lim));
      ctx.strokeStyle = accent; ctx.globalAlpha = 0.5; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(tx, trackY - 30); ctx.lineTo(tx, trackY + 30); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cartX, trackY); ctx.lineTo(tx, trackY); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }

    // Target pose ghost, hung from the cart: dashed rods and hollow bobs.
    var gx = cartX, gy = trackY, gk, gth, gnx, gny;
    ctx.globalAlpha = 0.45; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
    for (gk = 0; gk < meta.n_links; gk++) {
      gth = target ? target[gk] : 0;
      gnx = gx + p.lengths[gk] * scale * Math.sin(gth); gny = gy - p.lengths[gk] * scale * Math.cos(gth);
      ctx.strokeStyle = accent;
      ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gnx, gny); ctx.stroke();
      ctx.setLineDash([]); ctx.strokeStyle = gk % 2 ? col2 : col1;
      ctx.beginPath(); ctx.arc(gnx, gny, Math.max(6, 0.028 * scale * Math.sqrt(p.masses[gk] / 0.15)) + 2, 0, 2 * Math.PI); ctx.stroke();
      ctx.setLineDash([4, 4]);
      gx = gnx; gy = gny;
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1;

    // Cart
    var cw = 2 * cartHalf * scale, ch = Math.max(16, 0.07 * scale);
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.roundRect(cartX - cw / 2, trackY - ch / 2, cw, ch, 5); ctx.fill();

    // Links (bob x = x + l sin θ, height = l cos θ)
    var px = cartX, py = trackY;
    var cols = [col1, col2];
    for (var k = 0; k < meta.n_links; k++) {
      var th = state[2 + 2 * k], len = p.lengths[k] * scale;
      var qx = px + len * Math.sin(th), qy = py - len * Math.cos(th);
      ctx.strokeStyle = text; ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(qx, qy); ctx.stroke();
      ctx.fillStyle = cols[k % 2];
      ctx.beginPath(); ctx.arc(qx, qy, Math.max(6, 0.028 * scale * Math.sqrt(p.masses[k] / 0.15)), 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.arc(px, py, 3, 0, 2 * Math.PI); ctx.fill();
      px = qx; py = qy;
    }
    ctx.lineCap = 'butt';

    // Force arrow
    if (Math.abs(applied) > 0.2) {
      var fl = applied / p.force_max * 60, ay = trackY + 28, fs = fl >= 0 ? 1 : -1;
      ctx.strokeStyle = colF; ctx.fillStyle = colF; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(cartX, ay); ctx.lineTo(cartX + fl, ay); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cartX + fl + 3 * fs, ay);
      ctx.lineTo(cartX + fl - 6 * fs, ay - 5); ctx.lineTo(cartX + fl - 6 * fs, ay + 5);
      ctx.closePath(); ctx.fill();
    }

    // Status
    var label, colr = muted;
    if (status === 'crashed')            { label = 'Hit the end of the rail — resetting…'; colr = col2; }
    else if (reachTime !== null && settled > 0) {
      label = 'Reached ' + goal + ' in ' + reachTime.toFixed(2) + ' s — holding'; colr = accent;
    }
    else if (reachTime !== null)         { label = 'Knocked out of ' + goal + ' — recovering'; colr = accent; }
    else if (mode === 'tqc')             { label = 'TQC network → ' + goal; colr = accent; }
    else                                 { label = 'Manual → ' + goal + ' — drag the cart or hold ← →'; }
    if (randomOn && status !== 'crashed') label += '  · random';
    ctx.textAlign = 'left'; ctx.font = '600 13px ' + font; ctx.fillStyle = colr;
    ctx.fillText(label, 14, 24);
    ctx.font = '11px ' + mono; ctx.fillStyle = muted;
    ctx.fillText('t = ' + simT.toFixed(1) + ' s   F = ' + applied.toFixed(1) + ' N', 14, 42);
  }

  var PLOT_SPEC = [
    { key: 'x',   label: 'x (m)',  lim: 0.5 },
    { key: 'th1', label: 'θ₁ (°)', lim: 180 },
    { key: 'th2', label: 'θ₂ (°)', lim: 180 },
    { key: 'F',   label: 'F (N)',  lim: 20 }
  ];

  // Hover: a crosshair snaps to the nearest sample and the margin values show
  // that sample instead of the live one (they stay visible without hovering).
  var plotHoverX = null;
  if (plotCanvas) {
    plotCanvas.style.cursor = 'crosshair';
    plotCanvas.addEventListener('pointermove', function (e) {
      plotHoverX = e.clientX - plotCanvas.getBoundingClientRect().left;
    });
    plotCanvas.addEventListener('pointerleave', function () { plotHoverX = null; });
  }

  function drawPlot() {
    if (!plotCanvas) return;
    var c = sizeCanvas(plotCanvas), ctx = c.ctx, W = c.W, H = c.H;
    var bg = cssVar('--bg'), border = cssVar('--border'), muted = cssVar('--text-muted');
    var text = cssVar('--text'), mono = cssVar('--mono');
    var colors = [cssVar('--accent'), cssVar('--viz-1'), cssVar('--viz-2'), cssVar('--viz-4')];
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    var PAD_L = 70, PAD_R = 8, PAD_T = 4, PAD_B = 4;
    var rowH = (H - PAD_T - PAD_B) / PLOT_SPEC.length, pw = W - PAD_L - PAD_R;
    var xStep = pw / (HIST - 1);
    var hk = plotHoverX === null || plotHoverX < PAD_L || plotHoverX > PAD_L + pw ? -1
           : Math.round((plotHoverX - PAD_L) / xStep);
    var dots = [];
    if (meta) PLOT_SPEC[0].lim = meta.physics.x_lim;
    if (meta) PLOT_SPEC[3].lim = meta.physics.force_max;
    PLOT_SPEC.forEach(function (s, si) {
      var yTop = PAD_T + si * rowH, mid = yTop + rowH / 2, vals = hist[s.key];
      function yPx(v) { return mid - clamp(v / s.lim, -1, 1) * rowH * 0.42; }
      if (si > 0) {
        ctx.strokeStyle = border; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(PAD_L, yTop); ctx.lineTo(W - PAD_R, yTop); ctx.stroke();
      }
      ctx.strokeStyle = border; ctx.lineWidth = 0.5;      // zero line: solid hairline
      ctx.beginPath(); ctx.moveTo(PAD_L, mid); ctx.lineTo(W - PAD_R, mid); ctx.stroke();
      ctx.strokeStyle = colors[si]; ctx.lineWidth = 1.4;
      ctx.beginPath();
      var off = HIST - vals.length, prev = null;
      for (var i = 0; i < vals.length; i++) {
        var xp = PAD_L + (i + off) * xStep, yp = yPx(vals[i]);
        // Break the line where a wrapped angle jumps across ±180°.
        if (i === 0 || (s.lim === 180 && Math.abs(vals[i] - prev) > 180)) ctx.moveTo(xp, yp);
        else ctx.lineTo(xp, yp);
        prev = vals[i];
      }
      ctx.stroke();

      // Label (swatch + text-colored name) and value, live or at the crosshair.
      var hj = hk - off, hovered = hk >= 0 && hj >= 0 && hj < vals.length;
      var cur = hovered ? vals[hj] : vals.length ? vals[vals.length - 1] : 0;
      if (hovered) dots.push({ y: yPx(cur), color: colors[si] });
      ctx.font = '10px ' + mono; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      var lw = ctx.measureText(s.label).width;
      ctx.fillStyle = colors[si];
      ctx.fillRect(PAD_L - 6 - lw - 12, mid - 7 - 1.5, 8, 3);
      ctx.fillStyle = muted;
      ctx.fillText(s.label, PAD_L - 6, mid - 7);
      ctx.fillStyle = text;
      ctx.fillText(cur.toFixed(s.lim === 180 ? 0 : 2), PAD_L - 6, mid + 7);
    });
    if (hk >= 0 && dots.length) {
      var cx = PAD_L + hk * xStep;
      ctx.strokeStyle = muted; ctx.globalAlpha = 0.6; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, PAD_T); ctx.lineTo(cx, H - PAD_B); ctx.stroke();
      ctx.globalAlpha = 1;
      dots.forEach(function (d) {
        ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(cx, d.y, 5, 0, 2 * Math.PI); ctx.fill();
        ctx.fillStyle = d.color; ctx.beginPath(); ctx.arc(cx, d.y, 3.5, 0, 2 * Math.PI); ctx.fill();
      });
    }
  }

  /* ---- Loop: fixed 100 Hz physics inside requestAnimationFrame ---- */
  var lastT = null, accum = 0;
  function frame(now) {
    if (meta && status === 'running') {
      if (lastT !== null) accum += Math.min((now - lastT) / 1000, 0.1);
      var dt = meta.physics.dt, steps = 0;
      while (accum >= dt && steps < MAX_STEPS_PER_FRAME && status === 'running') {
        simStep(); accum -= dt; steps++;
      }
      if (steps === MAX_STEPS_PER_FRAME) accum = 0;   // slow device: run slower, don't spiral
    } else {
      accum = 0;
    }
    lastT = now;
    drawScene();
    drawPlot();
    requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', function () { lastT = null; });
  requestAnimationFrame(frame);
})(typeof window !== 'undefined' ? window : this);
