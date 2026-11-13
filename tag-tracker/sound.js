// ContactSound: the tag tracker's table as sound, made in the browser with Web Audio from PhysicsCore's record (no
// recordings, nothing downloaded). An impact rings both materials' modes (a few decaying sines and a click of noise),
// louder the faster they met, and a soft partner damps the other's ring (rubber on the mug is a dull tock, the robot's
// metal on it a clink). A rolling or sliding touch is noise through a band-pass, louder the faster and harder it goes.
// Off until the visitor turns it on (browsers allow sound only after a click anyway).
// hitVoice() and loopVoice() have no DOM, so script/test-tag-tracker checks them; create() needs an AudioContext.
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
  // How loud an impact at `speed` m/s is, 0..1 (a ball dropped 13 cm, 1.6 m/s, is full).
  const loudness = (speed) => Math.min(1, Math.pow(Math.max(0, speed) / 1.6, 0.8));

  // An impact event as sound: {gain, modes: [{f, decay, amp}], click: {f, decay, amp}}; pitch scales every frequency
  // (the page passes a little randomness so repeated hits aren't identical).
  function hitVoice(e, pitch) {
    const k = pitch || 1, A = snd(e.a.mat), B = snd(e.b.mat), gain = loudness(e.speed), modes = [];
    for (const [X, Y] of [[A, B], [B, A]]) for (const [f, d, a] of X.modes) modes.push({ f: f * k, decay: d * Y.damp, amp: 0.5 * a * X.gain });
    return { gain, modes, click: { f: Math.min(A.click, B.click) * k, decay: 0.006, amp: 0.35 } };
  }
  // A touch as a sound that lasts while it does: {type, f (the band's centre, Hz), q, gain}, or null when it's still.
  // Rolling rumbles low; sliding hisses higher with speed, in the softer material's band.
  function loopVoice(t) {
    const force = Math.max(0, t.force), push = Math.sqrt(Math.min(force, 40) / 0.3);
    if (t.slip > 0.01 && t.slip >= 0.5 * t.roll) {
      const band = Math.min(snd(t.a.mat).click, snd(t.b.mat).click);
      return { type: 'slide', f: band * (0.15 + 0.35 * Math.min(1, t.slip)), q: 1.4, gain: Math.min(0.5, 0.09 * Math.pow(t.slip, 0.7) * push) };
    }
    if (t.roll > 0.01) return { type: 'roll', f: 160 + 260 * Math.min(1, t.roll), q: 0.9, gain: Math.min(0.5, 0.6 * Math.pow(t.roll, 0.8) * push) };
    return null;
  }
  // A touch's name, the same from step to step.
  const sideKey = (x) => x.kind + (x.id !== undefined ? x.id : x.link !== undefined ? x.link : '');
  const touchKey = (t) => sideKey(t.a) + '|' + sideKey(t.b);

  // The player. Returns null where there is no Web Audio. set({on, duck}) turns it on and off (duck: quiet while the
  // microphone listens); play(record, panOf) plays a step's impacts and keeps its touches' sounds going (panOf(p) gives
  // a point's place left to right, -1..1); stop() silences the touches.
  function create() {
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return null;
    let ctx = null, master = null, bus = null, noise = null;
    const loops = new Map();
    let on = false, duck = false;
    function init() {
      if (ctx) return;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
      // a compressor, so a pile of hits at once never clips
      bus = ctx.createDynamicsCompressor(); bus.threshold.value = -14; bus.ratio.value = 6; bus.connect(master);
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const panner = (pan) => {
      if (!ctx.createStereoPanner) return bus;
      const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan || 0)); p.connect(bus);
      return p;
    };
    function hit(e, pan) {
      const v = hitVoice(e, 0.97 + 0.06 * Math.random());
      if (v.gain < 0.02) return;
      const t = ctx.currentTime + 0.004, out = panner(pan);
      for (const m of v.modes) {
        if (m.f > ctx.sampleRate / 2.2) continue;
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = m.f; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(m.amp * v.gain, t + 0.001); g.gain.setTargetAtTime(0, t + 0.001, m.decay);
        o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.002 + m.decay * 7);
      }
      const n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      n.buffer = noise; f.type = 'bandpass'; f.frequency.value = Math.min(v.click.f, ctx.sampleRate / 2.2); f.Q.value = 0.8;
      g.gain.setValueAtTime(v.click.amp * v.gain, t); g.gain.setTargetAtTime(0, t, v.click.decay);
      n.connect(f); f.connect(g); g.connect(out); n.start(t, Math.random() * 0.5); n.stop(t + v.click.decay * 8);
    }
    function fade(key, l) { l.g.gain.setTargetAtTime(0, ctx.currentTime, 0.04); l.src.stop(ctx.currentTime + 0.3); loops.delete(key); }
    const self = {
      set(o) {
        if ('on' in o) on = !!o.on;
        if ('duck' in o) duck = !!o.duck;
        if (!on && !ctx) return;
        init();
        if (on && ctx.state === 'suspended') ctx.resume();
        master.gain.setTargetAtTime(on && !duck ? 0.9 : 0, ctx.currentTime, 0.03);
        if (!on) self.stop();
      },
      // browsers start an AudioContext suspended until a click or key: call this from one
      resume() { if (on && ctx && ctx.state === 'suspended') ctx.resume(); },
      play(rec, panOf) {
        if (!on || !ctx || !rec) return;
        let n = 0;
        for (const e of rec.events) if (n++ < 8) hit(e, panOf ? panOf(e.p) : 0);
        const seen = new Set();
        for (const t of rec.touches) {
          const v = loopVoice(t);
          if (!v || v.gain < 0.005) continue;
          const key = touchKey(t);
          seen.add(key);
          let l = loops.get(key);
          if (!l) {
            if (loops.size >= 6) continue;
            const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
            src.buffer = noise; src.loop = true; f.type = 'bandpass'; g.gain.value = 0;
            src.connect(f); f.connect(g); g.connect(panner(panOf ? panOf(t.p) : 0)); src.start(ctx.currentTime, Math.random());
            loops.set(key, (l = { src, f, g }));
          }
          const now = ctx.currentTime;
          l.f.frequency.setTargetAtTime(v.f, now, 0.03); l.f.Q.value = v.q; l.g.gain.setTargetAtTime(v.gain, now, 0.03);
        }
        for (const [key, l] of loops) if (!seen.has(key)) fade(key, l);
      },
      stop() { if (ctx) for (const [key, l] of loops) fade(key, l); },
      get on() { return on; },
    };
    return self;
  }

  return { SOUNDS, hitVoice, loopVoice, loudness, touchKey, create };
});
