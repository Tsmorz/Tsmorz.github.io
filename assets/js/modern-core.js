// ModernCore — the maths behind /controls/modern/, with no DOM so script/test-modern can
// run it in Node. Three parts:
//   CBF:    a control-barrier-function safety filter for a robot moving in the plane.
//   Verify: interval bound propagation (IBP) and branch-and-bound on two policy networks:
//           a small ReLU net that imitates the cart-pole LQR (assets/models/verify-net.json)
//           and the 1M-parameter swing-up TQC net (assets/models/swingup-tqc.*).
//   MIMO:   Doyle's spinning satellite, the classic two-loop plant whose loops each have
//           huge margins on their own but fail together at about 10%.
(function (root) {
  'use strict';

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  /* ================================================================
     CBF safety filter
     Robot: ṗ = u in the plane. Obstacle i is safe while h_i = |p − o_i|² − r_i² ≥ 0.
     The filter keeps ḣ_i ≥ −α h_i, which is linear in u:  ∇h_i · u ≥ −α h_i,
     and changes the requested u as little as possible:
         u* = argmin |u − u_nom|²  subject to  a_i · u ≥ b_i  for every obstacle.
  ================================================================ */

  function cbfConstraints(p, obstacles, alpha) {
    return obstacles.map(function (o) {
      var dx = p[0] - o.x, dy = p[1] - o.y, h = dx * dx + dy * dy - o.r * o.r;
      return { a: [2 * dx, 2 * dy], b: -alpha * h, h: h };
    });
  }

  // Hildreth's method: coordinate ascent on the dual. Exact for one active constraint,
  // converges for several; a handful of obstacles needs only a few sweeps.
  function qpProject(un, cons) {
    var u = un.slice(), lam = cons.map(function () { return 0; });
    for (var it = 0; it < 300; it++) {
      var change = 0;
      for (var i = 0; i < cons.length; i++) {
        var a = cons[i].a, aa = a[0] * a[0] + a[1] * a[1];
        if (aa < 1e-12) continue;
        var slack = a[0] * u[0] + a[1] * u[1] - cons[i].b;
        var nl = Math.max(0, lam[i] - slack / aa), d = nl - lam[i];
        if (d !== 0) {
          u[0] += d * a[0]; u[1] += d * a[1]; lam[i] = nl;
          change = Math.max(change, Math.abs(d) * Math.sqrt(aa));
        }
      }
      if (change < 1e-10) break;
    }
    return { u: u, lam: lam };
  }

  function cbfFilter(p, un, obstacles, alpha) {
    var cons = cbfConstraints(p, obstacles, alpha), r = qpProject(un, cons);
    return { u: r.u, cons: cons, active: r.lam.map(function (l) { return l > 1e-9; }) };
  }

  // Distance from an obstacle's centre inside which the filter can ever step in at full
  // speed v: where α·h = |∇h|·v, i.e. α(d² − r²) = 2 d v.
  function cbfReach(r, alpha, v) {
    return (2 * v + Math.sqrt(4 * v * v + 4 * alpha * alpha * r * r)) / (2 * alpha);
  }

  /* ================================================================
     Verification
  ================================================================ */

  // Small net: { layers: [{in, out, W (out × in row-major), b}] }, ReLU between layers,
  // force = force_max · tanh(last). Inputs [x, ẋ, θ, θ̇].
  function smallForward(net, s) {
    var x = s;
    for (var li = 0; li < net.layers.length; li++) {
      var L = net.layers[li], y = new Array(L.out);
      for (var o = 0; o < L.out; o++) {
        var a = L.b[o];
        for (var i = 0; i < L.in; i++) a += L.W[o * L.in + i] * x[i];
        y[o] = li < net.layers.length - 1 ? Math.max(0, a) : a;
      }
      x = y;
    }
    return net.force_max * Math.tanh(x[0]);
  }

  // Interval bound propagation: push the box [lo, hi] through each layer in centre/radius
  // form (c' = W c + b, r' = |W| r), clip at the ReLUs. Sound: every input in the box
  // gives an output inside the returned interval. `widths` (optional) collects the
  // widest neuron interval after each stage, for the layer-by-layer chart.
  function smallBounds(net, lo, hi, widths) {
    var l = lo.slice(), u = hi.slice();
    if (widths) widths.push(maxWidth(l, u));
    for (var li = 0; li < net.layers.length; li++) {
      var L = net.layers[li], nl = new Array(L.out), nu = new Array(L.out);
      for (var o = 0; o < L.out; o++) {
        var c = L.b[o], r = 0;
        for (var i = 0; i < L.in; i++) {
          var w = L.W[o * L.in + i];
          c += w * (l[i] + u[i]) / 2; r += Math.abs(w) * (u[i] - l[i]) / 2;
        }
        nl[o] = c - r; nu[o] = c + r;
      }
      if (li < net.layers.length - 1) {
        for (var k = 0; k < L.out; k++) { nl[k] = Math.max(0, nl[k]); nu[k] = Math.max(0, nu[k]); }
      }
      l = nl; u = nu;
      if (widths) widths.push(maxWidth(l, u));
    }
    var F = [net.force_max * Math.tanh(l[0]), net.force_max * Math.tanh(u[0])];
    if (widths) widths.push(F[1] - F[0]);
    return F;
  }

  function maxWidth(l, u) { var m = 0; for (var i = 0; i < l.length; i++) m = Math.max(m, u[i] - l[i]); return m; }

  // The query: a sensor error of up to ε on the angle and 5ε on the rate (the same ratio
  // as the noise on /controls/), cart position and velocity measured exactly.
  var RATE_PER_ANGLE = 5;
  function queryBox(sc, eps) {
    return {
      lo: [sc[0], sc[1], sc[2] - eps, sc[3] - RATE_PER_ANGLE * eps],
      hi: [sc[0], sc[1], sc[2] + eps, sc[3] + RATE_PER_ANGLE * eps]
    };
  }

  // Split the box into 2^depth × 2^depth pieces along θ and θ̇ and bound each one:
  // branch-and-bound without the pruning, so the page can draw every piece.
  function splitBounds(boundFn, box, depth) {
    var n = 1 << depth, out = [], lo = box.lo, hi = box.hi;
    for (var i = 0; i < n; i++) {
      for (var j = 0; j < n; j++) {
        var sl = lo.slice(), sh = hi.slice();
        sl[2] = lo[2] + (hi[2] - lo[2]) * i / n; sh[2] = lo[2] + (hi[2] - lo[2]) * (i + 1) / n;
        sl[3] = lo[3] + (hi[3] - lo[3]) * j / n; sh[3] = lo[3] + (hi[3] - lo[3]) * (j + 1) / n;
        var F = boundFn(sl, sh);
        out.push({ lo: sl, hi: sh, F: F });
      }
    }
    return out;
  }

  // How far the force can move from its value at the centre, as far as the bounds can prove.
  function certifiedDeviation(net, sc, eps, depth) {
    var Fc = smallForward(net, sc);
    var pieces = splitBounds(function (l, h) { return smallBounds(net, l, h); }, queryBox(sc, eps), depth);
    var dev = 0, lo = Infinity, hi = -Infinity;
    pieces.forEach(function (p) {
      dev = Math.max(dev, p.F[1] - Fc, Fc - p.F[0]);
      lo = Math.min(lo, p.F[0]); hi = Math.max(hi, p.F[1]);
    });
    return { Fc: Fc, dev: dev, lo: lo, hi: hi, pieces: pieces };
  }

  // Largest deviation actually found by trying inputs: the corners, a grid, and random
  // points from a fixed seed (so the page and the test agree). A lower bound on the truth.
  function attackDeviation(net, sc, eps, n) {
    var Fc = smallForward(net, sc), box = queryBox(sc, eps), dev = 0, lo = Fc, hi = Fc, seed = 99991;
    function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
    function tryAt(a, b) {
      var s = [sc[0], sc[1], box.lo[2] + a * (box.hi[2] - box.lo[2]), box.lo[3] + b * (box.hi[3] - box.lo[3])];
      var F = smallForward(net, s);
      dev = Math.max(dev, Math.abs(F - Fc)); lo = Math.min(lo, F); hi = Math.max(hi, F);
    }
    var g = 6;
    for (var i = 0; i <= g; i++) for (var j = 0; j <= g; j++) tryAt(i / g, j / g);
    for (var k = 0; k < (n || 40); k++) tryAt(rnd(), rnd());
    return { Fc: Fc, dev: dev, lo: lo, hi: hi };
  }

  // Largest ε the bounds can certify for |ΔF| ≤ δ (bisection; certification is monotone in ε).
  function certifiedRadius(net, sc, delta, depth, epsMax) {
    var lo = 0, hi = epsMax;
    if (certifiedDeviation(net, sc, hi, depth).dev <= delta) return hi;
    for (var it = 0; it < 14; it++) {
      var m = (lo + hi) / 2;
      if (certifiedDeviation(net, sc, m, depth).dev <= delta) lo = m; else hi = m;
    }
    return lo;
  }

  // Smallest ε at which trying inputs finds |ΔF| > δ. An upper bound on the true radius.
  function attackRadius(net, sc, delta, epsMax) {
    if (attackDeviation(net, sc, epsMax).dev <= delta) return Infinity;
    var lo = 0, hi = epsMax;
    for (var it = 0; it < 14; it++) {
      var m = (lo + hi) / 2;
      if (attackDeviation(net, sc, m).dev > delta) hi = m; else lo = m;
    }
    return hi;
  }

  /* ---- The swing-up network (SimBa: in_proj → 2 × [h += fc2(relu(fc1(LN h)))] → LN → out) ---- */

  function halfToFloat(buffer) {
    var dv = new DataView(buffer), len = buffer.byteLength / 2, out = new Float32Array(len);
    for (var i = 0; i < len; i++) {
      var h = dv.getUint16(2 * i, true);
      var sign = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
      out[i] = e === 0 ? sign * f * 5.960464477539063e-8
             : e === 31 ? (f ? NaN : sign * Infinity)
             : sign * (1 + f / 1024) * Math.pow(2, e - 15);
    }
    return out;
  }

  function loadBigNet(meta, buffer) {
    var all = halfToFloat(buffer), T = {};
    meta.network.tensors.forEach(function (t) {
      var size = t.shape.reduce(function (a, b) { return a * b; }, 1);
      T[t.name] = all.subarray(t.offset, t.offset + size);
    });
    return { T: T, H: meta.network.hidden, E: meta.network.hidden * meta.network.expand,
             D: meta.network.obs_dim, blocks: meta.network.blocks, eps: meta.network.ln_eps,
             fmax: meta.physics.force_max };
  }

  function linI(W, b, l, u, inD, outD) {
    var L = new Float64Array(outD), U = new Float64Array(outD);
    for (var o = 0; o < outD; o++) {
      var c = b[o], r = 0, row = o * inD;
      for (var i = 0; i < inD; i++) { var w = W[row + i]; c += w * (l[i] + u[i]) / 2; r += Math.abs(w) * (u[i] - l[i]) / 2; }
      L[o] = c - r; U[o] = c + r;
    }
    return [L, U];
  }

  // LayerNorm on intervals. x_i − mean is bounded per neuron (tighter than subtracting
  // the mean's interval); the variance from the squares; 1/√(var + eps) is monotone.
  function lnI(l, u, w, b, H, eps) {
    var sl = 0, su = 0, i;
    for (i = 0; i < H; i++) { sl += l[i]; su += u[i]; }
    var dl = new Float64Array(H), du = new Float64Array(H), vl = 0, vh = 0;
    for (i = 0; i < H; i++) {
      dl[i] = l[i] * (1 - 1 / H) - (su - u[i]) / H;
      du[i] = u[i] * (1 - 1 / H) - (sl - l[i]) / H;
      var a = dl[i] * dl[i], c = du[i] * du[i];
      if (dl[i] <= 0 && du[i] >= 0) vh += Math.max(a, c);
      else { vl += Math.min(a, c); vh += Math.max(a, c); }
    }
    vl /= H; vh /= H;
    var il = 1 / Math.sqrt(vh + eps), ih = 1 / Math.sqrt(vl + eps);
    var L = new Float64Array(H), U = new Float64Array(H);
    for (i = 0; i < H; i++) {
      var p1 = dl[i] * il, p2 = dl[i] * ih, p3 = du[i] * il, p4 = du[i] * ih;
      var lo = Math.min(p1, p2, p3, p4), hi = Math.max(p1, p2, p3, p4);
      var x = lo * w[i], y = hi * w[i];
      L[i] = Math.min(x, y) + b[i]; U[i] = Math.max(x, y) + b[i];
    }
    return [L, U];
  }

  function bigBounds(net, lo, hi, widths) {
    var T = net.T, H = net.H, E = net.E, r;
    if (widths) widths.push(maxWidth(lo, hi));
    r = linI(T.in_w, T.in_b, lo, hi, net.D, H);
    var hl = r[0], hu = r[1];
    if (widths) widths.push(maxWidth(hl, hu));
    for (var bi = 0; bi < net.blocks; bi++) {
      var P = 'b' + bi + '_';
      var t = lnI(hl, hu, T[P + 'ln_w'], T[P + 'ln_b'], H, net.eps);
      if (widths) widths.push(maxWidth(t[0], t[1]));
      var f1 = linI(T[P + 'fc1_w'], T[P + 'fc1_b'], t[0], t[1], H, E);
      for (var i = 0; i < E; i++) { if (f1[0][i] < 0) f1[0][i] = 0; if (f1[1][i] < 0) f1[1][i] = 0; }
      if (widths) widths.push(maxWidth(f1[0], f1[1]));
      var f2 = linI(T[P + 'fc2_w'], T[P + 'fc2_b'], f1[0], f1[1], E, H);
      for (i = 0; i < H; i++) { hl[i] += f2[0][i]; hu[i] += f2[1][i]; }
      if (widths) widths.push(maxWidth(hl, hu));
    }
    var fl = lnI(hl, hu, T.final_ln_w, T.final_ln_b, H, net.eps);
    if (widths) widths.push(maxWidth(fl[0], fl[1]));
    var o = linI(T.out_w, T.out_b, fl[0], fl[1], H, 1);
    var F = [Math.tanh(o[0][0]) * net.fmax, Math.tanh(o[1][0]) * net.fmax];
    if (widths) { widths.push(o[1][0] - o[0][0]); widths.push(F[1] - F[0]); }
    return F;
  }

  function bigForward(net, obs) { return bigBounds(net, obs, obs)[0]; }

  // Observation box for the swing-up net: both poles near upright (target UU), each
  // angle ±ε and each rate ±5ε, the cart exact. cos/sin are bounded over the angle range.
  function cosRange(a, b) {
    var lo = Math.min(Math.cos(a), Math.cos(b)), hi = Math.max(Math.cos(a), Math.cos(b));
    for (var k = Math.ceil(a / Math.PI); k * Math.PI <= b; k++) { if (k % 2 === 0) hi = 1; else lo = -1; }
    return [lo, hi];
  }
  function bigQueryBox(th1, th2, eps) {
    var lo = new Float64Array(10), hi = new Float64Array(10);
    [[th1, 2], [th2, 5]].forEach(function (p) {
      var c = cosRange(p[0] - eps, p[0] + eps), s = cosRange(p[0] - eps - Math.PI / 2, p[0] + eps - Math.PI / 2);
      lo[p[1]] = c[0]; hi[p[1]] = c[1]; lo[p[1] + 1] = s[0]; hi[p[1] + 1] = s[1];
      lo[p[1] + 2] = -RATE_PER_ANGLE * eps; hi[p[1] + 2] = RATE_PER_ANGLE * eps;
    });
    lo[8] = hi[8] = 1; lo[9] = hi[9] = 1;     // target: both up
    return { lo: lo, hi: hi };
  }

  var SMALL_STAGES = ['input', 'layer 1', 'layer 2', 'output', 'force'];
  var BIG_STAGES = ['input', 'in', 'norm', 'fc1', 'fc2', 'norm', 'fc1', 'fc2', 'norm', 'output', 'force'];

  /* ================================================================
     MIMO: the spinning satellite (Doyle; Skogestad & Postlethwaite, Example 3.12)
       ẋ = A x + u,  y = C x,  A = [[0, a], [−a, 0]],  C = [[1, a], [−a, 1]],  a = 10,
     each input fed back on its own: u_i = −k_i y_i, with k_i = 1 + δ_i the gain error.
  ================================================================ */
  var SAT = { a: 10 };

  function satAcl(d1, d2) {
    var a = SAT.a, k1 = 1 + d1, k2 = 1 + d2;
    // A − diag(k) C
    return [[-k1, a - k1 * a], [-a + k2 * a, -k2]];
  }
  // 2 × 2: stable iff trace < 0 and det > 0.
  function satStable(d1, d2) {
    var M = satAcl(d1, d2), tr = M[0][0] + M[1][1], det = M[0][0] * M[1][1] - M[0][1] * M[1][0];
    return tr < 0 && det > 0;
  }
  function satEig(d1, d2) {
    var M = satAcl(d1, d2), tr = M[0][0] + M[1][1], det = M[0][0] * M[1][1] - M[0][1] * M[1][0];
    var disc = tr * tr / 4 - det;
    if (disc >= 0) return [[tr / 2 + Math.sqrt(disc), 0], [tr / 2 - Math.sqrt(disc), 0]];
    return [[tr / 2, Math.sqrt(-disc)], [tr / 2, -Math.sqrt(-disc)]];
  }
  function satStep(x, d1, d2, dt) {
    var M = satAcl(d1, d2);
    function f(s) { return [M[0][0] * s[0] + M[0][1] * s[1], M[1][0] * s[0] + M[1][1] * s[1]]; }
    var k1 = f(x), k2 = f([x[0] + k1[0] * dt / 2, x[1] + k1[1] * dt / 2]);
    var k3 = f([x[0] + k2[0] * dt / 2, x[1] + k2[1] * dt / 2]), k4 = f([x[0] + k3[0] * dt, x[1] + k3[1] * dt]);
    return [x[0] + (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]) * dt / 6, x[1] + (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]) * dt / 6];
  }
  function satOutput(x) { var a = SAT.a; return [x[0] + a * x[1], -a * x[0] + x[1]]; }

  // Complex helpers for the loop-at-a-time responses.
  function cmul(p, q) { return [p[0] * q[0] - p[1] * q[1], p[0] * q[1] + p[1] * q[0]]; }
  function cdiv(p, q) { var d = q[0] * q[0] + q[1] * q[1]; return [(p[0] * q[0] + p[1] * q[1]) / d, (p[1] * q[0] - p[0] * q[1]) / d]; }
  function cadd(p, q) { return [p[0] + q[0], p[1] + q[1]]; }
  function csub(p, q) { return [p[0] - q[0], p[1] - q[1]]; }

  // G(jω) = C (jωI − A)⁻¹, entry by entry. (jωI − A)⁻¹ = adj / det for the 2 × 2.
  function satG(w) {
    var a = SAT.a, s = [0, w];
    var det = cadd(cmul(s, s), [a * a, 0]);          // s² + a²
    var inv = [[cdiv(s, det), cdiv([a, 0], det)], [cdiv([-a, 0], det), cdiv(s, det)]];
    var C = [[1, a], [-a, 1]], G = [[[0, 0], [0, 0]], [[0, 0], [0, 0]]];
    for (var i = 0; i < 2; i++) for (var j = 0; j < 2; j++)
      for (var k = 0; k < 2; k++) G[i][j] = cadd(G[i][j], cmul([C[i][k], 0], inv[k][j]));
    return G;
  }
  // Loop i cut open with the other loop closed (gain 1): L_i = G_ii − G_ij G_ji / (1 + G_jj).
  function satLoop(i, w) {
    var G = satG(w), j = 1 - i;
    return csub(G[i][i], cdiv(cmul(G[i][j], G[j][i]), cadd([1, 0], G[j][j])));
  }

  function loopMargins(Lfn, wmin, wmax, n) {
    var pm = null, wc = null, gmUp = null, gmDown = null, prevM = null, prevP = null, prevW = null;
    for (var k = 0; k < n; k++) {
      var w = Math.pow(10, Math.log10(wmin) + (Math.log10(wmax) - Math.log10(wmin)) * k / (n - 1));
      var L = Lfn(w), m = 20 * Math.log10(Math.hypot(L[0], L[1])), p = Math.atan2(L[1], L[0]) * 180 / Math.PI;
      if (prevP !== null) p = prevP + (((p - prevP + 180) % 360 + 360) % 360 - 180);
      if (prevM !== null && (prevM > 0) !== (m > 0)) {
        var t = prevM / (prevM - m), ph = prevP + (p - prevP) * t;
        var v = ((ph + 180) % 360 + 360) % 360; if (v > 180) v -= 360;
        if (pm === null || v < pm) { pm = v; wc = prevW * Math.pow(w / prevW, t); }
      }
      if (prevP !== null) {
        for (var nn = Math.ceil((Math.min(prevP, p) + 180) / 360); -180 + 360 * nn < Math.max(prevP, p); nn++) {
          var line = -180 + 360 * nn, tt = (line - prevP) / (p - prevP), g = -(prevM + (m - prevM) * tt);
          if (g >= 0 && (gmUp === null || g < gmUp)) gmUp = g;
          if (g < 0 && (gmDown === null || g > gmDown)) gmDown = g;
        }
      }
      prevM = m; prevP = p; prevW = w;
    }
    return { pm: pm, wc: wc, gmUp: gmUp, gmDown: gmDown };
  }

  // The smallest simultaneous gain error max(|δ1|, |δ2|) that breaks the loop, by scanning
  // squares of growing size. Exact answer for a = 10: 1/√(1 + a²) ≈ 0.0995.
  function satSimultaneousMargin() {
    var lo = 0, hi = 1;
    function breaks(r) {
      var n = 400;
      for (var i = 0; i <= n; i++) {
        var t = -r + 2 * r * i / n;
        if (!satStable(t, r) || !satStable(t, -r) || !satStable(r, t) || !satStable(-r, t)) return true;
      }
      return false;
    }
    for (var it = 0; it < 30; it++) { var m = (lo + hi) / 2; if (breaks(m)) hi = m; else lo = m; }
    return hi;
  }

  var ModernCore = {
    clamp: clamp,
    cbfConstraints: cbfConstraints, qpProject: qpProject, cbfFilter: cbfFilter, cbfReach: cbfReach,
    smallForward: smallForward, smallBounds: smallBounds, queryBox: queryBox, splitBounds: splitBounds,
    certifiedDeviation: certifiedDeviation, attackDeviation: attackDeviation,
    certifiedRadius: certifiedRadius, attackRadius: attackRadius, RATE_PER_ANGLE: RATE_PER_ANGLE,
    loadBigNet: loadBigNet, bigBounds: bigBounds, bigForward: bigForward, bigQueryBox: bigQueryBox,
    SMALL_STAGES: SMALL_STAGES, BIG_STAGES: BIG_STAGES,
    SAT: SAT, satAcl: satAcl, satStable: satStable, satEig: satEig, satStep: satStep, satOutput: satOutput,
    satG: satG, satLoop: satLoop, loopMargins: loopMargins, satSimultaneousMargin: satSimultaneousMargin
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = ModernCore;
  root.ModernCore = ModernCore;
})(typeof window !== 'undefined' ? window : this);
