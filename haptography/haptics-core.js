// Browser equivalent of nrf-controller/recording/haptics: no DOM or device access.
// Floating point drives are fractions of full scale; targets and measurements are in g.
import { fft } from "./spectrum.js";
import { principalAxis, project } from "./analysis.js";

export const GRID = 1600;
export const BANDS = [20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500];
export const clamp = (x, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, x));
export const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / Math.max(1, x.length));
export const peak = (x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const sizeFor = (n) => 2 ** Math.ceil(Math.log2(Math.max(2, n)));

export function transform(x, size = sizeFor(x.length * 2)) {
  const re = new Float64Array(size), im = new Float64Array(size);
  re.set(x.subarray ? x.subarray(0, size) : x.slice(0, size));
  fft(re, im);
  return { re, im };
}

export function inverseFFT(re, im, n = re.length) {
  const r = re.slice(), j = Float64Array.from(im, (v) => -v);
  fft(r, j);
  return Float64Array.from(r.subarray(0, n), (v) => v / r.length);
}

export function interpolate(t, values, query, stride = 1, axis = 0) {
  if (!t.length) throw new Error("No samples in this interval.");
  let i = 0;
  return Float64Array.from(query, (tt) => {
    while (i + 1 < t.length && t[i + 1] < tt) i++;
    const j = Math.min(i + 1, t.length - 1);
    const u = clamp((tt - t[i]) / (t[j] - t[i] || 1), 0, 1);
    return values[i * stride + axis] * (1 - u) + values[j * stride + axis] * u;
  });
}

export function resample(x, from, to) {
  if (!x.length || from <= 0 || to <= 0) throw new Error("Invalid sample rate or empty signal.");
  return Float64Array.from({ length: Math.round(x.length * to / from) }, (_, i) => {
    const p = i * from / to, a = Math.min(x.length - 1, Math.floor(p));
    return x[a] + (x[Math.min(a + 1, x.length - 1)] - x[a]) * (p - a);
  });
}

export function bandpass(x, rate = GRID, lo = 20, hi = 400) {
  if (!(lo >= 0 && hi > lo && hi < rate / 2)) throw new Error("Choose a passband below the sample rate's Nyquist frequency.");
  const { re, im } = transform(x);
  for (let k = 0; k < re.length; k++) {
    const f = Math.min(k, re.length - k) * rate / re.length;
    let mask = 1;
    for (const [edge, rising] of [[lo, true], [hi, false]]) {
      if (!edge) continue;
      const ramp = clamp((Math.log2(Math.max(f, 1e-9) / edge) + 0.1) / 0.2, 0, 1);
      const raised = 0.5 - 0.5 * Math.cos(Math.PI * ramp);
      mask *= rising ? raised : 1 - raised;
    }
    re[k] *= mask; im[k] *= mask;
  }
  return inverseFFT(re, im, x.length);
}

export function fade(x, attack = 0.02, release = attack, rate = GRID) {
  const out = Float64Array.from(x);
  const a = Math.min(Math.round(attack * rate), Math.floor(x.length / 2));
  const b = Math.min(Math.round(release * rate), Math.floor(x.length / 2));
  for (let i = 0; i < a; i++) out[i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / Math.max(1, a - 1));
  for (let i = 0; i < b; i++) out[out.length - 1 - i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / Math.max(1, b - 1));
  return out;
}

export function recordingTarget(analysis, t0, t1, axis = "principal") {
  const t = analysis.imu.t;
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t0 < t[0] || t1 > t.at(-1) || t1 - t0 < 0.05) {
    throw new Error("Select at least 0.05 s inside the recording.");
  }
  for (let i = 1; i < t.length; i++) {
    if (t[i] < t0 || t[i - 1] > t1) continue;
    if (!Number.isFinite(t[i]) || !Number.isFinite(t[i - 1]) || t[i] <= t[i - 1] || t[i] - t[i - 1] > 0.01) throw new Error("The selected span has an IMU gap or invalid timestamps.");
    for (let at = (i - 1) * 3; at < (i + 1) * 3; at++) if (!Number.isFinite(analysis.imu.accel[at])) throw new Error("The selected span has invalid IMU samples.");
  }
  const query = Float64Array.from({ length: Math.floor((t1 - t0) * GRID) }, (_, i) => t0 + i / GRID);
  const cols = [0, 1, 2].map(c => {
    const x = interpolate(t, analysis.imu.accel, query, 3, c), mean = x.reduce((sum, v) => sum + v, 0) / x.length;
    return bandpass(Float64Array.from(x, v => v - mean), GRID, 20, 600);
  });
  const values = Float64Array.from({ length: query.length * 3 }, (_, i) => cols[i % 3][Math.floor(i / 3)]);
  const direction = axis === "principal" ? principalAxis(values) : [0, 1, 2].map((c) => c === Number(axis) ? 1 : 0);
  const target = project(values, direction);
  if (rms(target) < 0.0005) throw new Error("Too little vibration in this span; select contact with a surface.");
  return { target, axis: direction };
}

export function makeSignal({ kind, seconds = 1, frequency = 150, endFrequency = 400, width = 5, seed = 17 }) {
  if (!(seconds >= 0.05 && seconds <= 30) || ![frequency, endFrequency, width].every(Number.isFinite)) throw new Error("Invalid signal settings.");
  const n = Math.round(seconds * GRID);
  let state = seed >>> 0;
  const noise = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 31 - 1; };
  const k = Math.log(endFrequency / frequency) / seconds;
  return Float64Array.from({ length: n }, (_, i) => {
    const t = i / GRID;
    if (kind === "noise") return noise();
    if (kind === "pulse") return (t % (1 / frequency)) < width / 1000 ? 1 : 0;
    const phase = kind === "sweep" && Math.abs(k) > 1e-9 ? frequency * Math.expm1(k * t) / k : frequency * t;
    return Math.sin(2 * Math.PI * phase);
  });
}

function interpAt(x, y, at) {
  let lo = 0, hi = x.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (x[mid] <= at) lo = mid; else hi = mid; }
  const u = clamp((at - x[lo]) / (x[hi] - x[lo] || 1), 0, 1);
  return y[lo] * (1 - u) + y[hi] * u;
}

export function validateModel(m) {
  const n = m?.freqs?.length;
  if (m?.grid_hz !== GRID || !Number.isInteger(n) || n < 2 || n > 8193 ||
      ![m.freqs, m.h_re, m.h_im, m.coherence].every((a) => a?.length === n && Array.from(a).every(Number.isFinite)) ||
      m.freqs[0] < 0 || m.freqs.at(-1) > GRID / 2 || m.freqs.some((f, i) => i && f <= m.freqs[i - 1]) ||
      !Number.isInteger(m.delay) || m.delay < 0 || m.delay > GRID ||
      m.axis?.length !== 3 || !m.axis.every(Number.isFinite) || Math.abs(Math.hypot(...m.axis) - 1) > 0.02 ||
      !m.coherence.every((v) => v >= 0 && v <= 1.001) ||
      (m.erm_gain_g != null && !(Number.isFinite(m.erm_gain_g) && m.erm_gain_g > 0))) {
    throw new Error("Invalid actuator profile; expected the 1600 Hz model.json format.");
  }
  return m;
}

function responseAt(m, f) {
  if (f < 20 || f > 600 || f < m.freqs[0] || f > m.freqs.at(-1) || interpAt(m.freqs, m.coherence, f) < 0.5) return [0, 0];
  return [interpAt(m.freqs, m.h_re, f), interpAt(m.freqs, m.h_im, f)];
}

export function inverseDrive(target, model, reg = 0.05) {
  validateModel(model);
  const { re, im } = transform(target);
  const hs = Array.from({ length: re.length / 2 + 1 }, (_, k) => responseAt(model, k * GRID / re.length));
  const maximum = Math.max(...hs.map(([r, j]) => r * r + j * j), 1e-12);
  for (let k = 0; k < re.length; k++) {
    const mirror = k > re.length / 2;
    const [hr, hj0] = hs[mirror ? re.length - k : k], hj = mirror ? -hj0 : hj0;
    const den = hr * hr + hj * hj + reg * maximum;
    const r = re[k], j = im[k];
    re[k] = (r * hr + j * hj) / den;
    im[k] = (j * hr - r * hj) / den;
  }
  const drive = inverseFFT(re, im, target.length);
  return Float64Array.from(drive, (_, i) => drive[i + model.delay] ?? 0);
}

export function predict(drive, model) {
  const { re, im } = transform(drive);
  for (let k = 0; k < re.length; k++) {
    const mirror = k > re.length / 2;
    const f = (mirror ? re.length - k : k) * GRID / re.length;
    const [hr, hj0] = responseAt(model, f), hj = mirror ? -hj0 : hj0;
    const r = re[k], j = im[k];
    re[k] = r * hr - j * hj; im[k] = r * hj + j * hr;
  }
  const y = inverseFFT(re, im, drive.length);
  return Float64Array.from(y, (_, i) => i >= model.delay ? y[i - model.delay] : 0);
}

export function envelope(x, frame = 32) {
  return Float64Array.from({ length: Math.floor(x.length / frame) }, (_, i) => rms(x.subarray(i * frame, (i + 1) * frame)));
}

export function generate(raw, settings, model = null) {
  const { low = 20, high = 400, attack = 20, release = 20, strength = 40, ermShare = 0, output = "hammer", regularization = 0.05 } = settings;
  const target = fade(bandpass(raw, GRID, low, high), attack / 1000, release / 1000);
  const limit = clamp(strength / 100 * 0.95, 0, PREVIEW_PEAK);
  const calibrated = Boolean(model && settings.kind === "recording");
  const rawPeak = peak(target) || 1;
  let unbounded = calibrated ? inverseDrive(target, model, regularization) : Float64Array.from(target, (v) => v * limit / rawPeak);
  if (output === "erm") unbounded = new Float64Array(target.length);
  const clipped = unbounded.reduce((s, v) => s + (Math.abs(v) > limit + 1e-8), 0) / Math.max(1, unbounded.length);
  const drive = boundDrive(Float64Array.from(unbounded, (v) => clamp(v, -limit, limit)), limit);
  const env = envelope(target, 16), smooth = env.length > 1 ? bandpass(env, 100, 0, 8) : env;
  const share = output === "hammer" ? 0 : output === "erm" ? 1 : ermShare / 100;
  const gain = model?.erm_gain_g || peak(smooth) || 1;
  const erm = share ? Float64Array.from(smooth, (v) => clamp(share * v / gain, 0, limit)) : null;
  return { target, drive, erm, clipped, calibrated, predicted: model ? predict(drive, model) : null };
}

export function refine(drive, target, measured, model, gain = 0.6, regularization = 0.05, limit = 1) {
  if (drive.length !== target.length || drive.length !== measured.length) throw new Error("The measurement must cover the complete target.");
  const correction = inverseDrive(Float64Array.from(target, (v, i) => v - measured[i]), model, regularization);
  return Float64Array.from(drive, (v, i) => clamp(v + gain * correction[i], -limit, limit));
}

export function bandLevels(x) {
  const { re, im } = transform(x, sizeFor(x.length));
  return BANDS.map((f) => {
    let power = 0;
    for (let k = 0; k <= re.length / 2; k++) {
      const hz = k * GRID / re.length;
      if (hz >= f * 2 ** (-1 / 6) && hz < f * 2 ** (1 / 6)) power += (re[k] ** 2 + im[k] ** 2) / (GRID * re.length) * x.length;
    }
    return 10 * Math.log10(power + 1e-20);
  });
}

export function compare(target, measured) {
  if (target.length < 80 || target.length !== measured.length || rms(target) < 1e-8) throw new Error("Comparison needs a non-silent target and a full measurement.");
  const a = bandLevels(target), b = bandLevels(measured), top = Math.max(...a);
  const errors = a.map((v, i) => v >= top - 30 ? Math.abs(b[i] - v) : null).filter((v) => v !== null);
  const ea = envelope(target), eb = envelope(measured);
  const ma = ea.reduce((s, v) => s + v, 0) / ea.length, mb = eb.reduce((s, v) => s + v, 0) / eb.length;
  let ab = 0, aa = 0, bb = 0;
  ea.forEach((v, i) => { ab += (v - ma) * (eb[i] - mb); aa += (v - ma) ** 2; bb += (eb[i] - mb) ** 2; });
  return { bandError: errors.reduce((s, v) => s + v, 0) / errors.length, envelope: aa * bb > 1e-20 ? clamp(ab / Math.sqrt(aa * bb)) : null,
    nrmse: rms(Float64Array.from(target, (v, i) => v - measured[i])) / rms(target), targetBands: a, measuredBands: b };
}

export function identify(takes) {
  if (!takes.length) throw new Error("No response measurements.");
  const strongest = takes.reduce((a, b) => rms(a.vibration) > rms(b.vibration) ? a : b);
  let axis = principalAxis(strongest.vibration);
  const responses = takes.map((t) => project(t.vibration, axis));
  const lags = [], signs = [];
  takes.forEach((t, i) => {
    let best = 0, lag = 0;
    for (let d = 0; d <= 80; d++) {
      let sum = 0;
      for (let j = 0; j < t.drive.length - d; j++) sum += t.drive[j] * responses[i][j + d];
      if (Math.abs(sum) > Math.abs(best)) { best = sum; lag = d; }
    }
    lags.push(lag); signs.push(Math.sign(best));
  });
  const delay = lags.sort((a, b) => a - b)[Math.floor(lags.length / 2)];
  if (signs.reduce((a, b) => a + b, 0) < 0) axis = axis.map((v) => -v);
  const n = 512, bins = n / 2 + 1;
  const xx = new Float64Array(bins), yy = new Float64Array(bins), xyR = new Float64Array(bins), xyI = new Float64Array(bins);
  const gains = {};
  takes.forEach((take, index) => {
    const y = project(take.vibration, axis);
    gains[`test-${index + 1}`] = rms(y) / Math.max(1e-12, rms(take.drive));
    for (let s = 0; s + n + delay <= take.drive.length; s += n / 2) {
      const w = (i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
      const x = transform(Float64Array.from({ length: n }, (_, i) => take.drive[s + i] * w(i)), n);
      const z = transform(Float64Array.from({ length: n }, (_, i) => y[s + i + delay] * w(i)), n);
      for (let k = 0; k < bins; k++) {
        xx[k] += x.re[k] ** 2 + x.im[k] ** 2; yy[k] += z.re[k] ** 2 + z.im[k] ** 2;
        xyR[k] += x.re[k] * z.re[k] + x.im[k] * z.im[k]; xyI[k] += x.re[k] * z.im[k] - x.im[k] * z.re[k];
      }
    }
  });
  const model = { grid_hz: GRID, freqs: Array.from(xx, (_, k) => k * GRID / n), h_re: Array.from(xyR, (v, k) => v / (xx[k] + 1e-30)),
    h_im: Array.from(xyI, (v, k) => v / (xx[k] + 1e-30)), coherence: Array.from(xx, (_, k) => clamp((xyR[k] ** 2 + xyI[k] ** 2) / (xx[k] * yy[k] + 1e-30), 0, 1)),
    delay, axis, level_gains: gains, erm_gain_g: null, erm_rise_s: null };
  if (rms(strongest.vibration) < 1e-4 || !model.freqs.some((f, i) => f > 20 && f < 400 && model.coherence[i] > 0.5)) {
    throw new Error("No reliable actuator response. Check the actuator, mounting and IMU, then measure again.");
  }
  return validateModel(model);
}

export function packClip(drive, erm, rate = 16000, ermStepUs = 10000) {
  if (!(rate >= GRID && rate <= 48000)) throw new Error("Unsupported actuator sample rate.");
  // Drake-only capture firmware reports erm_step_us 0, so the step only matters for an ERM track.
  if (erm && !(ermStepUs >= 1000 && ermStepUs <= 1000000)) throw new Error("Unsupported ERM step.");
  const samples = resample(drive, GRID, rate);
  const pcm = new Uint8Array(samples.length * 2), view = new DataView(pcm.buffer);
  samples.forEach((v, i) => view.setInt16(i * 2, Math.round(clamp(v) * 30000), true));
  const levels = erm ? Uint8Array.from(resample(erm, 100, 1e6 / ermStepUs), (v) => Math.round(clamp(v, 0, 1) * 127)) : new Uint8Array();
  return { pcm, levels, samples: samples.length };
}

export function wav(drive, rate = 16000) {
  const { pcm } = packClip(drive, null, rate);
  const bytes = new Uint8Array(44 + pcm.length), v = new DataView(bytes.buffer);
  const str = (at, s) => Array.from(s).forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  str(0, "RIFF"); v.setUint32(4, 36 + pcm.length, true); str(8, "WAVE"); str(12, "fmt "); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, pcm.length, true); bytes.set(pcm, 44);
  return bytes;
}

// Explicitly simulated actuator for the page's demo and tests: a damped resonance, 7.5 ms
// delay, soft stops, and an ERM carrier with a 50 ms envelope response.
export function demoVibration(drive, erm = null) {
  const axis = [0.3, 0.2, Math.sqrt(0.87)], out = new Float64Array(drive.length * 3);
  const w = 2 * Math.PI * 150 / GRID, decay = Math.exp(-w * 0.22);
  const a1 = 2 * decay * Math.cos(w), a2 = -decay * decay, gain = 0.12;
  let y1 = 0, y2 = 0, level = 0;
  for (let i = 0; i < drive.length; i++) {
    const u = i >= 12 ? drive[i - 12] : 0;
    const y = a1 * y1 + a2 * y2 + gain * u;
    y2 = y1; y1 = y;
    level += (Math.max(0, erm?.[Math.floor(i / 16)] ?? 0) - level) * (1 - Math.exp(-1 / (GRID * 0.05)));
    const v = 0.65 * Math.tanh(y / 0.65) + level * 0.4 * Math.sin(2 * Math.PI * 160 * i / GRID);
    for (let c = 0; c < 3; c++) out[3 * i + c] = v * axis[c];
  }
  return out;
}

// Keep the bench's tested peak headroom and 100 ms sustained-drive budget in the studio.
export const PREVIEW_PEAK = 0.70 * 0.95;
export const PREVIEW_RMS = 7000 / 30000;
export function windowRms(x, rate = GRID) {
  const width = Math.min(x.length, Math.round(rate * 0.1));
  let energy = 0, maximum = 0;
  for (let i = 0; i < x.length; i++) {
    energy += x[i] ** 2;
    if (i >= width) energy -= x[i - width] ** 2;
    maximum = Math.max(maximum, energy);
  }
  return Math.sqrt(maximum / (width || 1));
}
export function driveSafe(x) {
  return x?.length > 0 && x.every(Number.isFinite) && peak(x) <= PREVIEW_PEAK + 1e-8 && windowRms(x) <= PREVIEW_RMS + 1e-8;
}
export function boundDrive(x, limit = PREVIEW_PEAK) {
  const gain = Math.min(1, limit / (peak(x) || 1), PREVIEW_RMS / (windowRms(x) || 1));
  return Float64Array.from(x, v => v * gain);
}
