// EmbeddedCore — the models behind /embedded/. No DOM, so script/test-embedded runs it in Node.
// The running problem is a sensor node on a CR2032 coin cell: a button, a thermistor read by the ADC, an LED,
// a log in flash, a bus to a radio chip, and a year of battery. Each part is a small model:
//   • button:   contact bounce, the pin's voltage through a pull-up (and an RC filter), thresholds or a Schmitt
//               trigger, and software debounce
//   • ADC:      quantisation against a reference, noise, averaging
//   • sensor:   an NTC thermistor in a divider, and three ways back from the ADC code to °C
//   • LED:      current through its resistor, PWM duty, perceived brightness and gamma, flicker as the eye sees it
//   • memory:   what goes in flash and RAM, and the stack's depth through one measurement cycle
//   • flash:    erase-before-write, and how fast each logging strategy wears the pages out
//   • buses:    UART frames and the receiver's sampling, I²C with pull-ups and slow edges, SPI
//   • power:    one wake cycle's charge, the coin cell's voltage and internal resistance, and its lifetime
//   • bike light (the second row): a mode state machine and a Li-ion cell
(function (root) {
  'use strict';
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function rng(seed) { return function () { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }; }
  function gaussian(rand) { var u = 0, v = 0; while (u === 0) u = rand(); while (v === 0) v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  var VCC = 3.0;

  /* ---------------- the button ---------------- */
  // When a contact closes it bounces: it opens and closes a few times over a few milliseconds, faster and
  // shorter as it settles. Returns the contact's changes [{t (ms), closed}] for one press and one release.
  function contactTrace(rand, o) {
    o = o || {};
    var press = o.press !== undefined ? o.press : 5, release = o.release !== undefined ? o.release : 35, bounce = o.bounce !== undefined ? o.bounce : 3, ev = [];
    function settle(t0, to) {
      ev.push({ t: t0, closed: to });
      if (bounce <= 0) return;
      var t = t0, n = 3 + Math.floor(rand() * 5), state = to;
      for (var k = 0; k < n; k++) {
        t += bounce * (0.05 + 0.5 * rand()) * Math.pow(0.7, k);
        if (t > t0 + bounce) break;
        state = !state; ev.push({ t: t, closed: state });
      }
      if (state !== to) ev.push({ t: Math.min(t0 + bounce, t + 0.05), closed: to });
    }
    settle(press, true); settle(release, false);
    return ev;
  }
  // The pin's voltage, sampled every dt ms for T ms. With a pull-up the pin charges towards VCC through rPull (kΩ)
  // when the contact is open and the contact pulls it down through 100 Ω when closed; cap (nF) is the pin's
  // capacitance plus any filter capacitor. Floating (no pull-up), the open pin drifts with whatever couples into it.
  // read: plain threshold at VCC/2, or a Schmitt trigger (rises above 0.7 VCC, falls below 0.3 VCC).
  // debounce (ms): a change is accepted only once the read level has held that long.
  function pinTrace(ev, o, rand) {
    var dt = o.dt || 0.01, T = o.T || 60, n = Math.round(T / dt), pull = o.pull !== false, R = (o.rPull || 40) * 1e3, Cf = (o.cap || 0.01) * 1e-9;
    var v = VCC, raw = 1, deb = 1, cand = 1, held = 0, k = 0, closed = false, out = { t: [], v: [], closed: [], raw: [], deb: [], rawEdges: 0, debEdges: 0, rawPress: 0, debPress: 0 };
    var noise = o.noise !== undefined ? o.noise : 0.01;
    for (var i = 0; i < n; i++) {
      var t = i * dt;
      while (k < ev.length && ev[k].t <= t) { closed = ev[k].closed; k++; }
      var target, tau;
      if (closed) { target = 0; tau = 100 * Cf; }
      else if (pull) { target = VCC; tau = R * Cf; }
      else { target = 1.5 + 1.3 * Math.sin(2 * Math.PI * 0.05 * t) + 0.4 * Math.sin(2 * Math.PI * 0.31 * t + 1); tau = 2e-3; }
      v = target + (v - target) * Math.exp(-dt * 1e-3 / Math.max(tau, 1e-12));
      var vm = v + (rand ? noise * gaussian(rand) : 0), r;
      if (o.schmitt) r = raw ? (vm < 0.3 * VCC ? 0 : 1) : (vm > 0.7 * VCC ? 1 : 0);
      else r = vm > VCC / 2 ? 1 : 0;
      if (r !== raw) { out.rawEdges++; if (r === 0) out.rawPress++; raw = r; }
      if (raw !== cand) { cand = raw; held = 0; } else held += dt;
      if (cand !== deb && held >= (o.debounce || 0)) { deb = cand; out.debEdges++; if (deb === 0) out.debPress++; }
      out.t.push(t); out.v.push(vm); out.closed.push(closed ? 1 : 0); out.raw.push(raw); out.deb.push(deb);
    }
    return out;
  }

  /* ---------------- the ADC ---------------- */
  // An N-bit ADC splits 0..vref into 2^N steps of one LSB; anything above vref reads as the top code.
  function lsb(bits, vref) { return vref / Math.pow(2, bits); }
  function adcCode(v, bits, vref) { return clamp(Math.floor(v / vref * Math.pow(2, bits)), 0, Math.pow(2, bits) - 1); }
  // One reading: n conversions of v plus noise (V), averaged. Returns the mean code (a fraction when n > 1).
  function adcRead(v, o, rand) {
    var n = o.avg || 1, s = 0;
    for (var i = 0; i < n; i++) s += adcCode(v + (o.noise || 0) * gaussian(rand), o.bits, o.vref);
    return s / n;
  }
  function codeToVolts(code, bits, vref) { return (code + 0.5) * lsb(bits, vref); }

  /* ---------------- the thermistor ---------------- */
  // A 10 kΩ NTC: R = R0 exp(B (1/T − 1/T0)). Real parts drift from one B across the range; here B rises by
  // 2.2 K per °C away from 25 °C, so the Beta formula is good near room temperature and off by a little at the ends.
  var NTC = { R0: 10000, T0: 298.15, B: 3950, Bslope: 2.2 };
  function ntcR(Tc) { var B = NTC.B + NTC.Bslope * (Tc - 25); return NTC.R0 * Math.exp(B * (1 / (Tc + 273.15) - 1 / NTC.T0)); }
  // The NTC sits below a fixed resistor rf (Ω): v = VCC · R / (R + rf). The ADC's reference is VCC itself, so the code
  // depends only on the resistances (ratiometric), not on how full the battery is.
  function ntcVolts(Tc, rf) { var R = ntcR(Tc); return VCC * R / (R + rf); }
  function ntcCode(Tc, rf, bits) { return adcCode(ntcVolts(Tc, rf), bits, VCC); }
  // Back from a code to °C. linear: a straight line through the codes at 0 and 50 °C. beta: undo the divider, then
  // the Beta formula with its 25 °C value of B. table: 11 measured points every 10 °C from −20 to 80, joined by lines.
  function codeToTemp(code, method, rf, bits) {
    var full = Math.pow(2, bits), c = clamp(code + 0.5, 0.5, full - 0.5);
    if (method === 'linear') { var c0 = ntcCode(0, rf, bits) + 0.5, c50 = ntcCode(50, rf, bits) + 0.5; return (c - c0) / (c50 - c0) * 50; }
    if (method === 'beta') { var R = rf * c / (full - c); return 1 / (1 / NTC.T0 + Math.log(R / NTC.R0) / NTC.B) - 273.15; }
    var pts = []; for (var T = -20; T <= 80; T += 10) pts.push([ntcVolts(T, rf) / VCC * full, T]);
    for (var i = 0; i < pts.length - 1; i++) {                      // codes fall as T rises
      if (c <= pts[i][0] && c >= pts[i + 1][0]) return pts[i][1] + (c - pts[i][0]) / (pts[i + 1][0] - pts[i][0]) * 10;
    }
    return c > pts[0][0] ? -20 : 80;
  }
  // How much the voltage moves per °C at Tc (mV/°C): the divider is most sensitive where R(T) ≈ rf.
  function ntcSensitivity(Tc, rf) { return (ntcVolts(Tc - 0.5, rf) - ntcVolts(Tc + 0.5, rf)) * 1000; }
  function ntcCurrent(Tc, rf) { return VCC / (ntcR(Tc) + rf); }

  /* ---------------- the LED ---------------- */
  // A red LED drops about 1.9 V; the resistor sets the current from what's left. Perceived brightness is CIE
  // lightness L* of the light (relative to 20 mA, fully on): the eye is far more sensitive to changes in dim light.
  var LED = { vf: 1.9, imax: 0.020 };
  function ledCurrent(r) { return Math.max(0, (VCC - LED.vf) / r); }
  function lightness(Y) { return Y > 0.008856 ? 116 * Math.cbrt(Y) - 16 : 903.3 * Y; }
  function duty(level, gamma) { var x = clamp(level / 255, 0, 1); return gamma ? Math.pow(x, 2.2) : x; }
  // The light the eye sees: the PWM square wave through three 4 ms smoothing stages (the eye blends flicker above
  // roughly 60–80 Hz). Returns the ripple (max − min) over a period once settled, as a fraction of the mean, and
  // three periods of both waves. Above about 0.1 the flicker is visible.
  function eyeRipple(d, freq) {
    var P = 1 / freq, n = 400, dt = P / n, a = 1 - Math.exp(-dt / 0.004), y = [d, d, d], lo = Infinity, hi = -Infinity, wave = [], eye = [];
    function step(u) { y[0] += (u - y[0]) * a; y[1] += (y[0] - y[1]) * a; y[2] += (y[1] - y[2]) * a; }
    for (var p = 0; p < 200 && p * P < 0.2; p++) for (var i = 0; i < n; i++) step(i < d * n ? 1 : 0);
    for (var q = 0; q < 3; q++) for (i = 0; i < n; i++) {
      var u = i < d * n ? 1 : 0; step(u);
      lo = Math.min(lo, y[2]); hi = Math.max(hi, y[2]); if (i % 4 === 0) { wave.push(u); eye.push(y[2]); }
    }
    return { ripple: d > 0 ? (hi - lo) / d : 0, wave: wave, eye: eye };
  }

  /* ---------------- memory ---------------- */
  // A small microcontroller: 64 KB of flash, 8 KB of RAM. RAM holds .data (initialised globals, copied from flash at
  // start-up), .bss (zeroed globals), the heap growing up after them, and the stack growing down from the top.
  var MEM = { flash: 65536, ram: 8192 };
  var TYPES = { float: 4, int16: 2, int8: 1 };
  // o: samples (the log buffer), type, constTable (the 256-entry calibration table is const, so stays in flash),
  // printf (use printf to format, or a small hand-written routine), window (samples in filter()'s local array),
  // heap (bytes malloc'd). Returns the regions, the stack's path through one cycle, and whether it overflows.
  function memoryMap(o) {
    var sz = TYPES[o.type] || 2, table = 256 * 2;
    var flash = [['code', 14336], ['startup + vectors', 1024], ['calibration table', table], ['float maths', o.type === 'float' ? 3072 : 0], ['printf', o.printf ? 6144 : 0], ['.data initial values', (o.constTable ? 0 : table) + 64]];
    var data = (o.constTable ? 0 : table) + 64, bss = o.samples * sz + 256, heap = o.heap || 0;
    var frames = [['main', 32], ['measure', 48], ['adc_read', 24], ['filter', 40 + o.window * sz], ['log_sample', 40], [o.printf ? 'printf' : 'format_temp', o.printf ? 640 : 40], ['flash_write', 56]];
    // One cycle: main → measure → adc_read → back → filter (the ADC's interrupt lands here, at its deepest) → back →
    // log_sample → format → back → flash_write.
    var calls = [[0], [0, 1], [0, 1, 2], [0, 1], [0, 1, 3], [0, 1, 3, 'isr'], [0, 1, 3], [0, 1], [0], [0, 4], [0, 4, 5], [0, 4], [0, 4, 6], [0, 4], [0]];
    var ISR = 96;
    var path = calls.map(function (cs) {
      var d = 0, names = []; cs.forEach(function (c) { if (c === 'isr') { d += ISR; names.push('ADC interrupt'); } else { d += frames[c][1]; names.push(frames[c][0]); } });
      return { depth: d, names: names };
    });
    var peak = Math.max.apply(null, path.map(function (p) { return p.depth; })), free = MEM.ram - data - bss - heap;
    return {
      flash: flash, flashUsed: flash.reduce(function (a, b) { return a + b[1]; }, 0),
      ram: [['.data', data], ['.bss', bss], ['heap', heap]], data: data, bss: bss, heap: heap,
      path: path, peak: peak, free: free, overflow: peak > free, frames: frames
    };
  }

  /* ---------------- flash ---------------- */
  // NOR flash: erasing a page sets every bit to 1; writing can only turn 1s into 0s. So a byte can go from 0xFF to any
  // value once, and changing it again means erasing its whole page. Each page survives about 10,000 erases.
  var FLASH = { page: 1024, endurance: 10000 };
  function canWrite(oldByte, newByte) { return (oldByte & newByte) === newByte; }
  // Erases per page after t seconds. inplace: the newest reading is rewritten in one place, so page 0 is erased for
  // every record. log: records are appended round a ring of `pages` pages, each erased once per lap.
  function wear(o, t) {
    var n = Math.floor(t / o.interval), counts = new Array(o.pages).fill(0);
    if (o.strategy === 'inplace') { counts[0] = n; return counts; }
    var per = Math.floor(FLASH.page / o.record), laps = n / (per * o.pages);
    for (var p = 0; p < o.pages; p++) counts[p] = Math.floor(laps) + ((laps % 1) * o.pages > p + 1e-9 ? 1 : 0);
    return counts;
  }
  // Seconds until the most-worn page reaches its endurance.
  function wearLife(o) {
    if (o.strategy === 'inplace') return FLASH.endurance * o.interval;
    return FLASH.endurance * Math.floor(FLASH.page / o.record) * o.pages * o.interval;
  }

  /* ---------------- buses ---------------- */
  // UART: each byte is a start bit (0), eight data bits least significant first, and a stop bit (1). The receiver sees
  // the start bit's falling edge, then samples each bit in the middle of where its own clock thinks the bit is. With
  // its clock off by `mismatch` (fraction), the sample point drifts by that much per bit.
  function uartBits(bytes) { var b = []; bytes.forEach(function (x) { b.push(0); for (var i = 0; i < 8; i++) b.push((x >> i) & 1); b.push(1); }); return b; }
  function uartReceive(bytes, mismatch) {
    var out = [], samples = [], framing = false;
    bytes.forEach(function (x, f) {
      var bits = uartBits([x]), byte = 0;
      for (var k = 0; k < 10; k++) {
        var pos = (k + 0.5) * (1 + mismatch), idx = Math.floor(pos), bit = idx < 10 ? bits[idx] : 1;
        samples.push({ frame: f, k: k, pos: pos, bit: bit, ok: bit === bits[k] });
        if (k >= 1 && k <= 8) byte |= bit << (k - 1);
        if (k === 9 && bit !== 1) framing = true;
      }
      out.push(byte);
    });
    return { bytes: out, samples: samples, framing: framing };
  }
  // I²C lines are open-drain: chips only pull them low; a pull-up resistor brings them back up, charging the bus's
  // capacitance. The rise from 0.3 to 0.7 VCC takes 0.847 RC. The standard allows 1000 ns at 100 kHz, 300 ns at 400 kHz.
  function i2cRise(rOhm, cPf) { return 0.8473 * rOhm * cPf * 1e-12; }
  function i2cRiseLimit(freq) { return freq > 200e3 ? 300e-9 : 1000e-9; }
  // The bits of a write: START, address + W, ACK, each data byte + ACK, STOP. SDA bits as [label, level].
  function i2cBits(addr, bytes) {
    var b = [], i; for (i = 6; i >= 0; i--) b.push(['A' + i, (addr >> i) & 1]); b.push(['W', 0]); b.push(['ACK', 0]);
    bytes.forEach(function (x) { for (i = 7; i >= 0; i--) b.push(['D' + i, (x >> i) & 1]); b.push(['ACK', 0]); });
    return b;
  }
  // Time on the wire (s) for n bytes of payload.
  function busTime(proto, n, rate) {
    if (proto === 'uart') return n * 10 / rate;
    if (proto === 'i2c') return ((n + 1) * 9 + 2) / rate;
    return n * 8 / rate;
  }

  /* ---------------- power ---------------- */
  // A CR2032: 225 mAh. Its open-circuit voltage stays near 2.9 V for most of its life and falls at the end, while its
  // internal resistance climbs from about 15 Ω to over 60 Ω. A pulse of current I drops I·R inside the cell.
  var CELL = { mAh: 225, brownout: 2.0 };
  function cellOcv(used) { used = clamp(used, 0, 1); return 3.0 - 0.15 * used - 0.75 * Math.pow(used, 8); }
  function cellR(used) { used = clamp(used, 0, 1); return 15 + 50 * Math.pow(used, 3); }
  // The phases of one wake, as [name, current (A), time (s)], plus the sleep current between wakes.
  // o: interval (s), sleep (A), dividerOn (the thermistor divider left powered all the time), led (ms of LED per wake,
  // at ledI amps), radioEvery (send every k wakes; 0 = never), recordsPerPage (for the flash erase now and then).
  function wakePhases(o) {
    var div = VCC / 20000, ph = [['wake + ADC', 1.2e-3, 3e-3], ['thermistor divider', o.dividerOn ? 0 : div, 3e-3], ['flash write', 3e-3, 0.2e-3],
      ['flash erase', 3e-3, 20e-3 / (o.recordsPerPage || 256)], ['LED', o.ledI || 0, (o.led || 0) * 1e-3], ['radio', 8e-3, o.radioEvery ? 4e-3 / o.radioEvery : 0]];
    return ph.filter(function (p) { return p[1] > 0 && p[2] > 0; });
  }
  // Average current (A) and where it goes: each phase's charge per wake spread over the interval, plus the floor.
  function budget(o) {
    var items = wakePhases(o).map(function (p) { return [p[0], p[1] * p[2] / o.interval]; });
    items.push(['sleep', o.sleep]);
    if (o.dividerOn) items.push(['divider, always on', VCC / 20000]);
    return { items: items, avg: items.reduce(function (a, b) { return a + b[1]; }, 0) };
  }
  // The biggest pulse the cell must supply, and how far the supply sags during it when `capUF` µF sits across the
  // cell: the capacitor carries the first part of a pulse of length tp, so the sag is I·R·(1 − e^(−tp / RC)).
  function sag(I, tp, R, capUF) { var tau = R * capUF * 1e-6; return I * R * (tau > 0 ? 1 - Math.exp(-tp / tau) : 1); }
  // Days the node runs: until the charge is spent, or until the supply under the largest pulse drops below brownout.
  function lifetime(o) {
    var b = budget(o), peakI = 1.2e-3 + Math.max(o.ledI && o.led ? o.ledI : 0, o.radioEvery ? 8e-3 : 0), tp = o.radioEvery ? 4e-3 : (o.led || 3) * 1e-3;
    var dead = 1;
    for (var u = 0; u <= 1; u += 0.002) { if (cellOcv(u) - sag(peakI, tp, cellR(u), o.cap || 0) < CELL.brownout) { dead = u; break; } }
    var hours = CELL.mAh * 1e-3 * dead / b.avg;
    return { days: hours / 24, used: dead, avg: b.avg, peakI: peakI, tp: tp, browns: dead < 1 };
  }

  /* ---------------- the bike light ---------------- */
  // One button: a short press steps OFF → LOW → MID → HIGH → FLASH → LOW …; holding it for `long` seconds turns the
  // light off. onPress: act the moment the button goes down (a long press then steps a mode first, and turns off after);
  // otherwise act on release, when the press's length is known. Events [{t, down}] → the states over time.
  var MODES = ['OFF', 'LOW', 'MID', 'HIGH', 'FLASH'];
  function nextMode(m) { return m === 'OFF' || m === 'FLASH' ? 'LOW' : MODES[MODES.indexOf(m) + 1]; }
  function lightFsm(events, o) {
    var state = 'OFF', downAt = null, longDone = false, log = [];
    function set(t, s, why) { if (s !== state) { state = s; log.push({ t: t, state: s, why: why }); } }
    function tick(t) { if (downAt !== null && !longDone && t - downAt >= o.long) { longDone = true; set(downAt + o.long, 'OFF', 'long press'); } }
    events.forEach(function (e) {
      tick(e.t);
      if (e.down) { downAt = e.t; longDone = false; if (o.onPress) set(e.t, nextMode(state), 'press'); }
      else if (downAt !== null) { if (!o.onPress && !longDone) set(e.t, nextMode(state), 'short press'); downAt = null; }
    });
    return { state: state, log: log, tick: function (t) { tick(t); return state; }, downAt: downAt };
  }
  // A Li-ion 18650: 3000 mAh, 4.2 V full, 3.0 V empty, with a long flat middle around 3.7 V.
  var LIION = { mAh: 3000, full: 4.2, empty: 3.0 };
  function liionV(used) { used = clamp(used, 0, 1); return 4.2 - 0.55 * used - 0.65 * Math.pow(used, 6) + 0.05 * Math.exp(-used * 40) - 0.05; }
  var MODE_I = { LOW: 0.15, MID: 0.5, HIGH: 1.5, FLASH: 0.3 };

  var EmbeddedCore = {
    clamp: clamp, rng: rng, gaussian: gaussian, VCC: VCC,
    contactTrace: contactTrace, pinTrace: pinTrace,
    lsb: lsb, adcCode: adcCode, adcRead: adcRead, codeToVolts: codeToVolts,
    NTC: NTC, ntcR: ntcR, ntcVolts: ntcVolts, ntcCode: ntcCode, codeToTemp: codeToTemp, ntcSensitivity: ntcSensitivity, ntcCurrent: ntcCurrent,
    LED: LED, ledCurrent: ledCurrent, lightness: lightness, duty: duty, eyeRipple: eyeRipple,
    MEM: MEM, TYPES: TYPES, memoryMap: memoryMap,
    FLASH: FLASH, canWrite: canWrite, wear: wear, wearLife: wearLife,
    uartBits: uartBits, uartReceive: uartReceive, i2cRise: i2cRise, i2cRiseLimit: i2cRiseLimit, i2cBits: i2cBits, busTime: busTime,
    CELL: CELL, cellOcv: cellOcv, cellR: cellR, wakePhases: wakePhases, budget: budget, sag: sag, lifetime: lifetime,
    MODES: MODES, nextMode: nextMode, lightFsm: lightFsm, LIION: LIION, liionV: liionV, MODE_I: MODE_I
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = EmbeddedCore;
  root.EmbeddedCore = EmbeddedCore;
})(typeof window !== 'undefined' ? window : this);
