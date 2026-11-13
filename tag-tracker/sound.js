// ContactSound: the tag tracker's table as sound, made with Web Audio from PhysicsCore's record (no recordings, nothing
// downloaded). The sound follows the speeds:
//   - An impact rings both materials' modes (a few decaying sines and a click of noise). Its amplitude is in proportion
//     to how fast they met (full at IMPACT_FULL m/s), and a harder hit is brighter: its higher modes and its click grow
//     faster than its lowest, as a shorter, harder contact puts more into high frequencies. A soft partner damps the
//     other's ring (rubber on the mug is a dull tock, the robot's metal on it a clink).
//   - A touch that lasts makes two sounds at once, each in proportion to its own speed: sliding hisses (the surfaces'
//     speed past each other, its band rising with it) and rolling rumbles (how fast the ball travels over the other).
//     A skidding ball does both.
// Off until the visitor turns it on (browsers allow sound only after a click anyway). hitVoice() and loopVoices() have
// no DOM, so script/test-tag-tracker checks them; create() needs an AudioContext; render() an OfflineAudioContext.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ContactSound = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // Each material: modes [frequency (Hz), decay (s, the time constant), amplitude], the click's band (Hz), its loudness,
  // and how much it lets the other ring on (damp: 1 rings freely, rubber cuts it short).
  const SOUNDS = {
    wood: { modes: [[190, 0.06, 1], [480, 0.035, 0.5], [1150, 0.018, 0.25]], click: 2400, gain: 0.9, damp: 0.7 },
    ceramic: { modes: [[1320, 0.4, 1], [3080, 0.22, 0.55], [5150, 0.12, 0.3]], click: 6000, gain: 0.55, damp: 1 },
    rubber: { modes: [[150, 0.03, 1], [380, 0.018, 0.4]], click: 900, gain: 0.8, damp: 0.25 },
    aluminium: { modes: [[880, 0.28, 1], [2390, 0.16, 0.6], [4170, 0.09, 0.35]], click: 5000, gain: 0.5, damp: 0.9 },
    stone: { modes: [[120, 0.05, 1], [310, 0.03, 0.5]], click: 1800, gain: 1, damp: 0.6 },
  };
  const FALLBACK = SOUNDS.wood;
  const snd = (m) => SOUNDS[m] || FALLBACK;
  const IMPACT_FULL = 4; // m/s: an impact this fast or faster is full amplitude (a ball dropped from a table is 3.9)
  // An impact's amplitude, 0..1: in proportion to the speed they met at.
  const loudness = (speed) => Math.min(1, Math.max(0, speed) / IMPACT_FULL);
  // How bright, 0.35..1: the share of the higher modes and the click, growing with the speed.
  const brightness = (speed) => Math.min(1, 0.35 + (0.65 * Math.max(0, speed)) / 3);

  // An impact event as sound: {gain, modes: [{f, decay, amp}], click: {f, decay, amp}}; pitch scales every frequency
  // (a little randomness, so repeated hits aren't identical).
  function hitVoice(e, pitch) {
    const k = pitch || 1, A = snd(e.a.mat), B = snd(e.b.mat), gain = loudness(e.speed), br = brightness(e.speed), modes = [];
    for (const [X, Y] of [[A, B], [B, A]]) X.modes.forEach(([f, d, a], i) => modes.push({ f: f * k, decay: d * Y.damp, amp: 0.5 * a * X.gain * Math.pow(br, i) }));
    return { gain, modes, click: { f: Math.min(A.click, B.click) * k, decay: 0.006, amp: 0.35 * br * br } };
  }
  // A touch's lasting sounds: [{type: 'slide' | 'roll', f (the band's centre, Hz), q, gain}], none while it's still.
  // Each gain is in proportion to its speed (and grows with the square root of how hard they press).
  function loopVoices(t) {
    const force = Math.max(0, t.force), push = Math.sqrt(Math.min(force, 40) / 0.3), out = [];
    if (t.slip > 0.02) {
      const band = Math.min(snd(t.a.mat).click, snd(t.b.mat).click);
      out.push({ type: 'slide', f: band * (0.15 + 0.35 * Math.min(1, t.slip)), q: 1.4, gain: Math.min(0.4, 0.09 * t.slip * push) });
    }
    const roll = Math.max(0, t.roll - 0.5 * t.slip); // a skid's own travel is the slide's
    if (roll > 0.02) out.push({ type: 'roll', f: 140 + 220 * Math.min(1, roll), q: 0.9, gain: Math.min(0.4, 0.22 * roll * push) });
    return out;
  }
  // A touch's name, the same from step to step.
  const sideKey = (x) => x.kind + (x.id !== undefined ? x.id : x.link !== undefined ? x.link : '');
  const touchKey = (t) => sideKey(t.a) + '|' + sideKey(t.b);

  // The sound of records on any audio context, into `out`: hit(e, pan, when) plays an impact; touches(rec, panOf, when)
  // keeps each touch's sounds going (started, changed and stopped at `when`).
  function voices(ctx, out) {
    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const loops = new Map(), nyq = ctx.sampleRate / 2.2;
    const panner = (pan) => {
      if (!ctx.createStereoPanner) return out;
      const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan || 0)); p.connect(out);
      return p;
    };
    function hit(e, pan, t) {
      const v = hitVoice(e, 0.97 + 0.06 * Math.random());
      if (v.gain < 0.005) return;
      const dst = panner(pan);
      for (const m of v.modes) {
        if (m.f > nyq) continue;
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = m.f; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(m.amp * v.gain, t + 0.001); g.gain.setTargetAtTime(0, t + 0.001, m.decay);
        o.connect(g); g.connect(dst); o.start(t); o.stop(t + 0.002 + m.decay * 7);
      }
      const n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      n.buffer = noise; f.type = 'bandpass'; f.frequency.value = Math.min(v.click.f, nyq); f.Q.value = 0.8;
      g.gain.setValueAtTime(v.click.amp * v.gain, t); g.gain.setTargetAtTime(0, t, v.click.decay);
      n.connect(f); f.connect(g); g.connect(dst); n.start(t, Math.random() * 0.5); n.stop(t + v.click.decay * 8);
    }
    function fade(key, l, t) { l.g.gain.setTargetAtTime(0, t, 0.03); l.src.stop(t + 0.3); loops.delete(key); }
    function touches(rec, panOf, t) {
      const seen = new Set();
      for (const tc of rec.touches) for (const v of loopVoices(tc)) {
        const key = touchKey(tc) + '|' + v.type;
        seen.add(key);
        let l = loops.get(key);
        if (!l) {
          if (loops.size >= 8) continue;
          const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
          src.buffer = noise; src.loop = true; f.type = 'bandpass'; f.frequency.value = v.f; g.gain.setValueAtTime(0, t);
          src.connect(f); f.connect(g); g.connect(panner(panOf ? panOf(tc.p) : 0)); src.start(t, Math.random());
          loops.set(key, (l = { src, f, g }));
        }
        l.f.frequency.setTargetAtTime(v.f, t, 0.02); l.f.Q.setValueAtTime(v.q, t); l.g.gain.setTargetAtTime(v.gain, t, 0.015);
      }
      for (const [key, l] of loops) if (!seen.has(key)) fade(key, l, t);
    }
    return { hit, touches, stop: (t) => { for (const [key, l] of loops) fade(key, l, t); } };
  }
  // The output stage: a master gain, then a limiter that only catches peaks (so the loudness still follows the speed).
  function master(ctx, level) {
    const m = ctx.createGain(), lim = ctx.createDynamicsCompressor();
    m.gain.value = level;
    lim.threshold.value = -2; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.08;
    m.connect(lim); lim.connect(ctx.destination);
    return m;
  }

  // The player. Returns null where there is no Web Audio. set({on, duck}) turns it on and off (duck: quiet while the
  // microphone listens); play(record, panOf) plays a step's impacts, each at its own time within the step, and keeps
  // its touches' sounds going (panOf(p) gives a point's place left to right, -1..1); stop() silences the touches.
  function create() {
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return null;
    let ctx = null, gain = null, V = null, on = false, duck = false;
    function init() {
      if (ctx) return;
      ctx = new AC();
      gain = ctx.createGain(); gain.gain.value = 0; gain.connect(master(ctx, 0.8));
      V = voices(ctx, gain);
    }
    const self = {
      set(o) {
        if ('on' in o) on = !!o.on;
        if ('duck' in o) duck = !!o.duck;
        if (!on && !ctx) return;
        init();
        if (on && ctx.state === 'suspended') ctx.resume();
        gain.gain.setTargetAtTime(on && !duck ? 1 : 0, ctx.currentTime, 0.03);
        if (!on) V.stop(ctx.currentTime);
      },
      // browsers start an AudioContext suspended until a click or key: call this from one
      resume() { if (on && ctx && ctx.state === 'suspended') ctx.resume(); },
      play(rec, panOf) {
        if (!on || !ctx || !rec) return;
        const now = ctx.currentTime + 0.005, t0 = rec.time - rec.dt;
        let n = 0;
        for (const e of rec.events) if (n++ < 8) V.hit(e, panOf ? panOf(e.p) : 0, now + Math.max(0, e.t - t0));
        V.touches(rec, panOf, now);
      },
      stop() { if (ctx) V.stop(ctx.currentTime); },
      get on() { return on; },
    };
    return self;
  }

  // Records as sound, offline: passes [{records, at (s: where the first record's step starts in the output), scale
  // (time stretch: 4 plays it four times slower, each sound itself unchanged)}], duration (s); opts {rate, level, panOf}.
  // Resolves to an AudioBuffer (stereo).
  function render(passes, duration, opts) {
    const o = Object.assign({ rate: 48000, level: 0.8, panOf: null }, opts || {});
    const ctx = new OfflineAudioContext(2, Math.ceil(duration * o.rate), o.rate), out = master(ctx, o.level);
    for (const p of passes) {
      if (!p.records.length) continue;
      const V = voices(ctx, out), r0 = p.records[0], start = r0.time - r0.dt, k = p.scale || 1, at = (t) => p.at + (t - start) * k;
      for (const rec of p.records) {
        for (const e of rec.events) V.hit(e, o.panOf ? o.panOf(e.p) : 0, at(e.t));
        V.touches(rec, o.panOf, at(rec.time - rec.dt));
      }
      const last = p.records[p.records.length - 1];
      V.stop(at(last.time));
    }
    return ctx.startRendering();
  }

  return { SOUNDS, IMPACT_FULL, hitVoice, loopVoices, loudness, brightness, touchKey, create, render };
});
