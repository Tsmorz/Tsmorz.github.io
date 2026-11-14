// Texture preview drives. Amplitude-normalised, not an inverse model of the mounted actuator.
import { fft } from "./spectrum.js";
import { wavBytes } from "./export.js";

export const RATE = 16000;
export const MAX_SECONDS = 6;
export const MAX_LEVEL = 70;
export const HEADROOM = 0.95;
export const MAX_RMS_COUNTS = 7000; // conservative sustained-texture budget; see docs/haptography.md
export const LEAD_SECONDS = 0.02; // clocks running before a short event reaches the MAX98357A

export function textureDrive(analysis, start, end, level = 40) {
  const { t } = analysis.imu;
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(level) || level < 1 || level > MAX_LEVEL) throw Error("Choose a level from 1 to 70%.");
  if (start < t[0] || end > t.at(-1) || end - start < 0.05 || end - start > MAX_SECONDS - LEAD_SECONDS + 1e-9) throw Error("Select 0.05–5.98 seconds covered by the IMU.");
  let first = 0;
  while (first < t.length && t[first] < start) first++;
  let last = first;
  while (last < t.length && t[last] <= end) last++;
  for (let i = first + 1; i < last; i++) if (t[i] - t[i - 1] > 0.01) throw Error("The selected span has an IMU gap; choose another span.");
  for (let i = Math.max(0, first - 1); i < last; i++) if (!Number.isFinite(analysis.vibrationTrack[i]) || !Number.isFinite(t[i]) || (i && t[i] <= t[i - 1])) throw Error("The selected span has invalid IMU samples.");
  const gridRate = 1600, count = Math.round((end - start) * gridRate);
  let size = 1;
  while (size < count * 2) size *= 2;
  const re = new Float64Array(size), im = new Float64Array(size);
  let j = Math.max(0, first - 1), mean = 0;
  for (let i = 0; i < count; i++) {
    const at = start + i / gridRate;
    while (j + 1 < t.length - 1 && t[j + 1] < at) j++;
    const k = Math.min(j + 1, t.length - 1), f = (at - t[j]) / (t[k] - t[j] || 1);
    re[i] = analysis.vibrationTrack[j] * (1 - f) + analysis.vibrationTrack[k] * f;
    mean += re[i];
  }
  mean /= count;
  let inputEnergy = 0;
  for (let i = 0; i < count; i++) { re[i] -= mean; inputEnergy += re[i] ** 2; }
  if (Math.sqrt(inputEnergy / count) < 0.0005) throw Error("Too little vibration in this span; record contact with a surface.");
  fft(re, im);
  // Smooth 20–300 Hz band, with 10 Hz transition bands. Keep gravity and sensor noise out.
  for (let i = 0; i < size; i++) {
    const hz = Math.min(i, size - i) * gridRate / size;
    const gain = hz < 10 || hz > 310 ? 0 : hz < 20 ? (1 - Math.cos(Math.PI * (hz - 10) / 10)) / 2 : hz > 300 ? (1 + Math.cos(Math.PI * (hz - 300) / 10)) / 2 : 1;
    re[i] *= gain; im[i] *= -gain;
  }
  fft(re, im); // conjugate trick: real inverse FFT
  const lead = Math.round(LEAD_SECONDS * RATE), n = Math.round((end - start) * RATE);
  const floats = new Float64Array(n);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const p = i * gridRate / RATE, lo = Math.min(count - 1, Math.floor(p)), hi = Math.min(count - 1, lo + 1);
    const fade = Math.sin(Math.PI / 2 * Math.min(1, i / 160, (n - 1 - i) / 160)) ** 2;
    floats[i] = ((1 - (p - lo)) * re[lo] + (p - lo) * re[hi]) / size * fade;
    peak = Math.max(peak, Math.abs(floats[i]));
  }
  if (peak < 1e-7) throw Error("No vibration in the Drake's useful band.");
  // Bake the requested level into the WAV; upload at 100%, so a normal replay is identical.
  const scale = 30000 * HEADROOM * level / 100 / peak;
  const window = Math.min(1600, n); // 100 ms: bound sustained drive as well as its peak.
  let energy = 0, maxEnergy = 0;
  for (let i = 0; i < n; i++) {
    energy += (floats[i] * scale) ** 2;
    if (i >= window) energy -= (floats[i - window] * scale) ** 2;
    maxEnergy = Math.max(maxEnergy, energy);
  }
  const rmsGain = Math.min(1, MAX_RMS_COUNTS / Math.sqrt(maxEnergy / window));
  const samples = new Int16Array(lead + n);
  for (let i = 0; i < n; i++) samples[lead + i] = Math.round(floats[i] * scale * rmsGain);
  return { samples, wav: wavBytes(samples, RATE), manifest: { format: "haptography-drive/1", method: "normalised-bandpass", band_hz: [20, 300], source_start_s: start, source_end_s: end, rate_hz: RATE, level_percent: level, output_headroom: HEADROOM, lead_seconds: LEAD_SECONDS, playback_level_percent: 100, rms_limit_counts: MAX_RMS_COUNTS, rms_gain: rmsGain, calibrated: false, erm: false } };
}
