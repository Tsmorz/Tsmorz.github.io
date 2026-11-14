// The waveform library's shapes, rendered from the parameters in _data/haptography.yml (`library`).
// No DOM: the Node tests render every entry. A shape is normalized to a peak of 1; drive() turns
// it into a TacHammer command inside the studio's tested limits, speaker() into audio.
import { GRID, bandpass, boundDrive, peak, resample, PREVIEW_PEAK } from "./haptics-core.js";

export const KINDS = ["knock", "tone", "noise"];
export const MAX_SECONDS = 3;

// A string's own seed, so every noise texture is the same each time it plays.
const seedOf = (text) => Array.from(String(text)).reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
function random(seed) {
  let state = seed >>> 0 || 1;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 31 - 1; };
}
const list = (v, n, fallback) => Array.from({ length: n }, (_, i) => Array.isArray(v) ? v[Math.min(i, v.length - 1)] ?? fallback : v ?? fallback);

// One hit: a half-sine push of `ms`, a reversed `brake` pulse that stops the mass, and an
// optional ringing tail (`ring` Hz, `decay` ms, `tail` level) for the material's resonance.
function knock(e, rate) {
  const width = Math.max(2, Math.round((e.ms ?? 4) / 1000 * rate)), brake = e.brake ?? 0.6;
  const tail = e.ring ? Math.round(Math.min(5 * (e.decay ?? 30), 1500) / 1000 * rate) : 0;
  const out = new Float64Array(width * (brake ? 2 : 1) + tail);
  for (let i = 0; i < width; i++) {
    const s = Math.sin(Math.PI * (i + 0.5) / width);
    out[i] = s;
    if (brake) out[width + i] = -brake * s;
  }
  const at = width * (brake ? 2 : 1), tau = (e.decay ?? 30) / 1000 * rate;
  for (let i = 0; i < tail; i++) out[at + i] += (e.tail ?? 0.5) * Math.exp(-i / tau) * Math.sin(2 * Math.PI * e.ring * i / rate);
  return out;
}

// A sine of `hz` (sweeping to `to` Hz), `ms` long, with a `shape`: flat, up, down or swell,
// and an optional `wobble` Hz of amplitude modulation.
function tone(e, rate) {
  const n = Math.round((e.ms ?? 300) / 1000 * rate), f0 = e.hz ?? 150, f1 = e.to ?? f0, seconds = n / rate;
  const k = Math.log(f1 / f0) / seconds;
  return Float64Array.from({ length: n }, (_, i) => {
    const t = i / rate, phase = Math.abs(k) > 1e-9 ? f0 * Math.expm1(k * t) / k : f0 * t;
    return Math.sin(2 * Math.PI * phase) * shapeAt(e, t / seconds, t);
  });
}

// Band-limited noise from `low` to `high` Hz: a texture. `grain` Hz adds regular bumps (rolling,
// gravel), `stick` Hz a stick-slip rhythm of quiet sticking and sudden slips.
function noise(e, rate) {
  const n = Math.round((e.ms ?? 800) / 1000 * rate), next = random(seedOf(e.id));
  const white = Float64Array.from({ length: n }, next);
  const hi = Math.min(e.high ?? 400, rate / 2 - 1), lo = Math.min(e.low ?? 40, hi / 2);
  const x = bandpass(white, rate, lo, hi), level = peak(x) || 1, seconds = n / rate;
  let bumps = null;
  if (e.grain) {
    const jitter = random(seedOf(`${e.id}/grain`));
    bumps = new Float64Array(n);
    for (let t = 0; t < seconds; t += (1 + 0.3 * jitter()) / e.grain) {
      const c = Math.round(t * rate), w = Math.max(1, Math.round(0.006 * rate)), h = 0.6 + 0.4 * Math.abs(jitter());
      for (let i = Math.max(0, c - 3 * w); i < Math.min(n, c + 3 * w); i++) bumps[i] = Math.max(bumps[i], h * Math.exp(-(((i - c) / w) ** 2)));
    }
  }
  return Float64Array.from(x, (v, i) => {
    const t = i / rate;
    let env = shapeAt(e, t / seconds, t);
    if (bumps) env *= 0.2 + 0.8 * bumps[i];
    if (e.stick) { const p = (t * e.stick) % 1; env *= 0.15 + 0.85 * Math.exp(-(((p - 0.9) / 0.05) ** 2)); }
    return v / level * env;
  });
}

function shapeAt(e, u, t) {
  let a = e.shape === "up" ? u : e.shape === "down" ? 1 - u : e.shape === "swell" ? Math.sin(Math.PI * u) : 1;
  if (e.wobble) a *= 0.6 + 0.4 * Math.sin(2 * Math.PI * e.wobble * t);
  return a;
}

const RENDER = { knock, tone, noise };

/** The entry's shape at `rate`, peak 1: one hit, repeated `repeat` times with `gap` ms (a number or
 * a list) between starts and `levels` (a number or list) for each. Short fades keep tones clickless. */
export function render(entry, rate = GRID) {
  const make = RENDER[entry?.kind];
  if (!make) throw new Error(`Unknown waveform kind: ${entry?.kind}`);
  const hit = make(entry, rate);
  if (entry.kind !== "knock") {
    const edge = Math.min(Math.round(0.006 * rate), hit.length >> 1);
    for (let i = 0; i < edge; i++) { const g = 0.5 - 0.5 * Math.cos(Math.PI * i / edge); hit[i] *= g; hit[hit.length - 1 - i] *= g; }
  }
  const count = Math.max(1, entry.repeat ?? 1), gaps = list(entry.gap, count - 1, 100), levels = list(entry.levels, count, 1);
  const starts = [0];
  for (let i = 1; i < count; i++) starts.push(starts[i - 1] + Math.round(gaps[i - 1] / 1000 * rate));
  const out = new Float64Array(starts[count - 1] + hit.length);
  starts.forEach((s, i) => { for (let j = 0; j < hit.length; j++) out[s + j] += hit[j] * levels[i]; });
  const top = peak(out);
  if (!(top > 0) || !out.every(Number.isFinite)) throw new Error(`Waveform ${entry.id} is silent or invalid.`);
  return out.map((v) => v / top);
}

/** A TacHammer command on the analysis grid: the shape at `entry.level` × `level` of the safe peak,
 * then held inside the 100 ms sustained-drive budget (long buzzes come out quieter than clicks).
 * Padded with silence to 100 ms: windowRms() measures a shorter clip over its own length, which
 * would hold a 6 ms click to the budget meant for a continuous buzz. */
export function drive(entry, level = 1) {
  const x = render(entry, GRID), scale = Math.min(1, Math.max(0, (entry.level ?? 1) * level)) * PREVIEW_PEAK;
  const out = new Float64Array(Math.max(x.length, Math.round(0.1 * GRID)));
  x.forEach((v, i) => { out[i] = v * scale; });
  return boundDrive(out);
}

/** Audio of the same command at `rate` for the computer's speakers: drive full scale is 0.9. */
export function speaker(entry, level = 1, rate = 16000) {
  const d = drive(entry, level), x = render(entry, rate), gain = peak(d) / PREVIEW_PEAK * 0.9;
  return Float32Array.from(x, (v) => v * gain);
}

/** Any drive on the grid (a recreated waveform) as speaker audio. */
export function driveAudio(d, rate = 16000) {
  return Float32Array.from(resample(d, GRID, rate), (v) => Math.max(-1, Math.min(1, v / PREVIEW_PEAK * 0.9)));
}

/** Problems with a catalog: unknown kinds, duplicate ids, groups not listed, overlong shapes. */
export function validate(entries, groups) {
  const errors = [], seen = new Set(), known = new Set(groups.map((g) => g.id));
  for (const e of entries) {
    if (!e.id || !e.name) errors.push(`An entry needs an id and a name: ${JSON.stringify(e)}`);
    if (seen.has(e.id)) errors.push(`Duplicate id ${e.id}`);
    seen.add(e.id);
    if (!known.has(e.group)) errors.push(`${e.id}: group ${e.group} is not in library_groups`);
    if (!KINDS.includes(e.kind)) { errors.push(`${e.id}: unknown kind ${e.kind}`); continue; }
    try {
      const x = render(e, GRID);
      if (x.length / GRID > MAX_SECONDS) errors.push(`${e.id}: ${(x.length / GRID).toFixed(2)} s is longer than ${MAX_SECONDS} s`);
    } catch (err) { errors.push(`${e.id}: ${err.message}`); }
  }
  return errors;
}

/** The favorites export: names and parameters, so the firmware or another page can rebuild them. */
export function libraryJson(entries, extra = []) {
  return {
    format: "haptography-library/1", exported: new Date().toISOString(), grid_hz: GRID, audio_hz: 16000,
    waveforms: [...entries.map((e) => ({ ...e, source: "library", seconds: render(e, GRID).length / GRID })), ...extra],
  };
}
