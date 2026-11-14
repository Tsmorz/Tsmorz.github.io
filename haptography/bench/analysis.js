// What a recording holds and how good it is: speed and strokes from the ToF, how long it starts
// still, gaps and clipping, then a score for each take and for each surface in a dataset. Pure:
// no DOM. The speed is the ToF's alone, uncorrected for tilt (recording/process.py does that on
// the PC); the stroke rules are recording/strokes.py's, with its default thresholds.

import { micTimeline, timeSpan } from "./session.js";
import { welch, averageSpectra, logEdges, bandsDb, peakFrequency, centroid, bandPower, similarity } from "./spectrum.js";

// Bump when a summary's contents or the scoring change: stored takes are re-analysed.
export const ANALYSIS_VERSION = 2;

export const SETTINGS = {
  speedWindowS: 0.25, // ToF line fit (recording/geometry.py smoothing_window_s)
  minFitPoints: 5,
  strokeStartSpeed: 30, // mm/s
  strokeEndSpeed: 10,
  strokeMinDurationS: 0.1,
  strokeMinLengthMm: 5,
  stillWindowS: 0.25,
  stillGyroDps: 1.5, // VQF's rest thresholds, on each window's spread
  stillAccelG: 0.05,
  stillNeededS: 4, // VQF needs about this long to learn the gyro bias (docs/capture.md)
  highPassHz: 5, // vibration: the accelerometer without gravity and hand motion
  // Frequency domain. The accelerometer's own filters roll off above ~400 Hz (docs/capture.md),
  // so the vibration's band stops there; the microphone carries the rest.
  vibNfft: 256, // ~0.15 s at 1670 Hz, 6.5 Hz bins
  micNfft: 1024, // 64 ms at 16 kHz, 15.6 Hz bins
  vibBand: [10, 400],
  micBand: [50, 8000],
  fingerprintBands: 24,
  coreSpeedShare: 0.6, // a stroke's steady part: where its speed is at least this share of its peak
  goodSnrDb: 10, // the texture's vibration over the floor between strokes
};

// What a good dataset holds for each surface.
export const TARGETS = {
  takes: 3,
  strokes: 24,
  spectrumMatch: 0.8, // takes of one surface whose vibration spectra are this alike
  speedBins: [0, 100, 200, 300, Infinity], // mm/s, a stroke's mean speed
  strokesPerBin: 3,
};

const CLIP_COUNT = 32700; // raw counts at the edge of full scale (int16)

// ST's VL53L1X range status codes (ULD), for the score's explanation.
export const TOF_STATUS = {
  0: "good",
  1: "sigma fail (noisy)",
  2: "signal fail (weak return)",
  3: "below range",
  4: "out of range",
  5: "hardware fail",
  7: "wrapped",
  8: "processing fail",
  14: "invalid",
};

// ---- Signals ----

/** IMU arrays in physical units, times in seconds from `origin_us`. */
export function scaleImu(session, origin_us) {
  const { imu, info } = session;
  const n = imu.t_us.length;
  const gScale = info?.gyro_dps_per_lsb || 0.07;
  const aScale = info?.accel_g_per_lsb || 0.000244;
  const t = new Float64Array(n);
  const gyro = new Float32Array(n * 3);
  const accel = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) t[i] = (imu.t_us[i] - origin_us) * 1e-6;
  for (let i = 0; i < n * 3; i++) {
    gyro[i] = imu.gyro[i] * gScale;
    accel[i] = imu.accel[i] * aScale;
  }
  return { t, gyro, accel };
}

/** Each of `width` interleaved channels minus its own first-order low-pass at `hz`. */
export function highPass(t, values, width, hz) {
  const out = new Float32Array(values.length);
  const lp = new Float64Array(width);
  const n = t.length;
  if (!n) return out;
  for (let c = 0; c < width; c++) lp[c] = values[c];
  for (let i = 0; i < n; i++) {
    const dt = i ? Math.max(0, t[i] - t[i - 1]) : 0;
    const a = 1 - Math.exp(-2 * Math.PI * hz * dt);
    for (let c = 0; c < width; c++) {
      const x = values[i * width + c];
      lp[c] += a * (x - lp[c]);
      out[i * width + c] = x - lp[c];
    }
  }
  return out;
}

/** The vibration along its strongest direction: the high-passed accelerometer projected on its
 *  principal axis, so one signed track can be played or fed to a single-axis actuator. */
export function principalAxis(values) {
  const n = values.length / 3;
  const c = [0, 0, 0, 0, 0, 0]; // xx xy xz yy yz zz
  for (let i = 0; i < n; i++) {
    const x = values[i * 3], y = values[i * 3 + 1], z = values[i * 3 + 2];
    c[0] += x * x; c[1] += x * y; c[2] += x * z; c[3] += y * y; c[4] += y * z; c[5] += z * z;
  }
  let v = [1, 1, 1];
  for (let k = 0; k < 50; k++) {
    const w = [
      c[0] * v[0] + c[1] * v[1] + c[2] * v[2],
      c[1] * v[0] + c[3] * v[1] + c[4] * v[2],
      c[2] * v[0] + c[4] * v[1] + c[5] * v[2],
    ];
    const norm = Math.hypot(...w);
    if (!norm) return [0, 0, 1];
    v = w.map((x) => x / norm);
  }
  return v;
}

export function project(values, axis) {
  const n = values.length / 3;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = values[i * 3] * axis[0] + values[i * 3 + 1] * axis[1] + values[i * 3 + 2] * axis[2];
  }
  return out;
}

/** Slope of a straight line fitted to the valid samples within ±window/2 of each t: the speed.
 *  NaN where fewer than `minPoints` fall in the window or they lie on one side only. As
 *  recording/speed.py's local_line_fit. */
export function lineFitSlope(t, y, valid, windowS, minPoints) {
  const tv = [], yv = [];
  for (let i = 0; i < t.length; i++) if (valid[i]) { tv.push(t[i]); yv.push(y[i]); }
  const slope = new Float64Array(t.length).fill(NaN);
  if (tv.length < minPoints) return slope;
  const half = windowS / 2;
  let lo = 0, hi = 0;
  for (let i = 0; i < t.length; i++) {
    while (lo < tv.length && tv[lo] < t[i] - half) lo++;
    if (hi < lo) hi = lo;
    while (hi < tv.length && tv[hi] <= t[i] + half) hi++;
    const count = hi - lo;
    if (count < minPoints) continue;
    if (tv[lo] - t[i] > 0 || tv[hi - 1] - t[i] < 0) continue;
    let tm = 0, ym = 0;
    for (let k = lo; k < hi; k++) { tm += tv[k]; ym += yv[k]; }
    tm /= count; ym /= count;
    let sxx = 0, sxy = 0;
    for (let k = lo; k < hi; k++) {
      const dt = tv[k] - tm;
      sxx += dt * dt;
      sxy += dt * (yv[k] - ym);
    }
    if (sxx > 0) slope[i] = sxy / sxx;
  }
  return slope;
}

/** One stroke per movement, as recording/strokes.py's segment_strokes. */
export function segmentStrokes(t, speed, valid, s = SETTINGS) {
  const n = t.length;
  const ok = (i) => valid[i] && Number.isFinite(speed[i]);
  const strokes = [];
  let lastEnd = -1;
  let i = 0;
  while (i < n) {
    if (!ok(i) || Math.abs(speed[i]) < s.strokeStartSpeed) { i++; continue; }
    const sign = Math.sign(speed[i]);
    let lo = i;
    while (lo > 0 && ok(lo - 1) && speed[lo - 1] * sign > s.strokeEndSpeed) lo--;
    let hi = i;
    while (hi + 1 < n && ok(hi + 1) && speed[hi + 1] * sign > s.strokeEndSpeed) hi++;
    i = hi + 1;
    if (lo <= lastEnd) {
      lo = lastEnd + 1;
      if (lo > hi) continue;
    }
    const duration = t[hi] - t[lo];
    let length = 0, peak = 0;
    for (let k = lo; k <= hi; k++) {
      peak = Math.max(peak, Math.abs(speed[k]));
      if (k > lo) length += 0.5 * (speed[k] + speed[k - 1]) * (t[k] - t[k - 1]);
    }
    length = Math.abs(length);
    if (duration < s.strokeMinDurationS || length < s.strokeMinLengthMm) continue;
    strokes.push({
      start: lo, end: hi, t0: t[lo], t1: t[hi],
      direction: sign > 0 ? "away" : "toward",
      length_mm: length, mean_mm_s: length / duration, peak_mm_s: peak,
    });
    lastEnd = hi;
  }
  return strokes;
}

/** How long the device is still from the start: the run of still windows (gyro and accelerometer
 *  spread under VQF's rest thresholds) that begins within the first second. */
export function stillAtStart(t, gyro, accel, s = SETTINGS) {
  const n = t.length;
  if (n < 2) return 0;
  let runStart = null, runEnd = null;
  let i = 0;
  while (i < n) {
    const w0 = t[i];
    let j = i;
    while (j < n && t[j] < w0 + s.stillWindowS) j++;
    if (j - i < 8) break;
    const still = spread(gyro, i, j) < s.stillGyroDps && spread(accel, i, j) < s.stillAccelG;
    if (still) {
      if (runStart === null) {
        if (w0 - t[0] > 1) break;
        runStart = w0;
      }
      runEnd = t[j - 1];
    } else if (runStart !== null) break;
    i = j;
  }
  return runStart === null ? 0 : runEnd - runStart;
}

// The norm of the per-axis standard deviations of rows [i, j) of a 3-wide array.
function spread(values, i, j) {
  let total = 0;
  for (let c = 0; c < 3; c++) {
    let m = 0;
    for (let k = i; k < j; k++) m += values[k * 3 + c];
    m /= j - i;
    let v = 0;
    for (let k = i; k < j; k++) v += (values[k * 3 + c] - m) ** 2;
    total += v / (j - i);
  }
  return Math.sqrt(total);
}

function countClipped(values, limit) {
  let n = 0;
  for (let i = 0; i < values.length; i++) if (values[i] >= limit || values[i] <= -limit) n++;
  return n;
}

// ---- A whole take ----

/** Everything the replay draws and the score reads, from a decoded session. */
export function analyze(session) {
  const span = timeSpan(session) ?? { start_us: 0, end_us: 0 };
  const origin = span.start_us;
  const imu = scaleImu(session, origin);
  const vibration = highPass(imu.t, imu.accel, 3, SETTINGS.highPassHz);
  const axis = principalAxis(vibration);

  const tofT = Float64Array.from(session.tof.t_us, (x) => (x - origin) * 1e-6);
  const tofValid = Uint8Array.from(session.tof.status, (s) => (s === 0 ? 1 : 0));
  const speed = lineFitSlope(tofT, session.tof.distance_mm, tofValid, SETTINGS.speedWindowS, SETTINGS.minFitPoints);
  const speedValid = Uint8Array.from(speed, (v) => (Number.isFinite(v) ? 1 : 0));
  const strokes = segmentStrokes(tofT, speed, speedValid);

  const mt = micTimeline(session.mic);
  const n = imu.t.length;
  const out = {
    origin_us: origin,
    durationS: (span.end_us - span.start_us) * 1e-6,
    imu,
    imuRate: n > 1 ? (n - 1) / (imu.t[n - 1] - imu.t[0]) : 1666,
    vibration,
    vibrationAxis: axis,
    vibrationTrack: project(vibration, axis),
    mic: mt && { t0: (mt.t0_us - origin) * 1e-6, dt: mt.us_per_sample * 1e-6, samples: session.mic.samples, rate: 1e6 / mt.us_per_sample },
    tof: { t: tofT, distance: session.tof.distance_mm, status: session.tof.status, valid: tofValid, speed },
    strokes,
  };
  out.frequency = frequencyFeatures(out);
  out.summary = summarize(session, imu, strokes, out.frequency);
  return out;
}

function lowerBound(t, x) {
  let lo = 0, hi = t.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (t[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Index range of the IMU and of the microphone over [t0, t1) seconds. */
export function sampleRanges(a, t0, t1) {
  const imu = [lowerBound(a.imu.t, t0), lowerBound(a.imu.t, t1)];
  const mic = a.mic
    ? [Math.max(0, Math.ceil((t0 - a.mic.t0) / a.mic.dt)), Math.min(a.mic.samples.length, Math.ceil((t1 - a.mic.t0) / a.mic.dt))]
    : [0, 0];
  return { imu, mic };
}

/** Vibration and sound spectra (Welch) over [t0, t1) seconds of an analysed take. */
export function spectraBetween(a, t0, t1, s = SETTINGS) {
  const r = sampleRanges(a, t0, t1);
  return {
    vib: welch(a.vibrationTrack, a.imuRate, { nfft: s.vibNfft, start: r.imu[0], end: r.imu[1] }),
    mic: a.mic ? welch(a.mic.samples, a.mic.rate, { nfft: s.micNfft, start: r.mic[0], end: r.mic[1], scale: 1 / 32768 }) : null,
  };
}

const db10 = (p) => 10 * Math.log10(p + 1e-20);

/** The ToF speed at time t, interpolated between readings with a speed; NaN outside them. */
function speedAt(a, t) {
  const T = a.tof.t, V = a.tof.speed;
  const i = lowerBound(T, t);
  if (i === 0 || i >= T.length) return NaN;
  const u = (t - T[i - 1]) / (T[i] - T[i - 1]);
  return V[i - 1] + u * (V[i] - V[i - 1]);
}

/** A stroke's grain (mm): the median over short frames of its steady part of speed / vibration
 *  peak, each frame's speed taken at its own centre, so a stroke's changing speed doesn't bias it.
 *  Frames whose peak sits at the band's edges (the accelerometer's roll-off) are skipped. */
function frameGrain(a, st, ta, tb, s) {
  const [vlo, vhi] = s.vibBand;
  const nfft = s.vibNfft;
  const half = nfft / 2 / a.imuRate;
  const ratios = [];
  for (let t = ta; t <= tb; t += 0.02) {
    const i0 = lowerBound(a.imu.t, t - half);
    if (i0 + nfft > a.vibrationTrack.length) break;
    const spec = welch(a.vibrationTrack, a.imuRate, { nfft, start: i0, end: i0 + nfft });
    // Searched past the band, so a frame whose grain sits above it is dropped, not misread
    const f = spec && peakFrequency(spec, vlo, a.imuRate / 2);
    const v = Math.abs(speedAt(a, t));
    if (!f || f < vlo * 1.5 || f > vhi * 0.95 || !(v >= s.coreSpeedShare * st.peak_mm_s)) continue;
    ratios.push(v / f);
  }
  if (ratios.length < 3) return null;
  ratios.sort((x, y) => x - y);
  return ratios[ratios.length >> 1];
}

/** Each stroke's spectra over its steady part, its grain (speed over vibration peak), the take's
 *  fingerprints over all strokes, and the vibration and sound over the floor between strokes. */
export function frequencyFeatures(a, s = SETTINGS) {
  const [vlo, vhi] = s.vibBand, [mlo, mhi] = s.micBand;
  const features = [];
  const vibSpectra = [], micSpectra = [];
  for (const st of a.strokes) {
    // The steady part: ToF readings at speed, so one speed, and one grain frequency, dominate
    let ta = Infinity, tb = -Infinity, vs = 0, nv = 0;
    for (let i = st.start; i <= st.end; i++) {
      const v = Math.abs(a.tof.speed[i]);
      if (v >= s.coreSpeedShare * st.peak_mm_s) {
        ta = Math.min(ta, a.tof.t[i]);
        tb = Math.max(tb, a.tof.t[i]);
        vs += v;
        nv++;
      }
    }
    if (tb - ta < 0.08) { ta = st.t0; tb = st.t1; vs = st.mean_mm_s; nv = 1; }
    const core = spectraBetween(a, ta, tb, s);
    const whole = spectraBetween(a, st.t0, st.t1, s);
    if (whole.vib) vibSpectra.push(whole.vib);
    if (whole.mic) micSpectra.push(whole.mic);
    const peak = core.vib ? peakFrequency(core.vib, vlo, vhi) : null;
    const speed = vs / nv;
    const grain = frameGrain(a, st, ta, tb, s);
    features.push({
      vib_peak_hz: peak,
      vib_centroid_hz: core.vib ? centroid(core.vib, vlo, vhi) : null,
      vib_rms_g: whole.vib ? Math.sqrt(bandPower(whole.vib, vlo, vhi)) : null,
      mic_centroid_hz: core.mic ? centroid(core.mic, mlo, mhi) : null,
      mic_dbfs: whole.mic ? db10(bandPower(whole.mic, mlo, mhi)) : null,
      core_speed_mm_s: speed,
      grain_mm: grain,
    });
  }

  // The floor: everything at least 0.2 s away from a stroke
  const quiet = [];
  let from = 0;
  for (const st of a.strokes) {
    if (st.t0 - 0.2 - from > 0.3) quiet.push([from, st.t0 - 0.2]);
    from = st.t1 + 0.2;
  }
  if (a.durationS - from > 0.3) quiet.push([from, a.durationS]);
  const floorSpectra = quiet.map(([t0, t1]) => spectraBetween(a, t0, t1, s));
  const floorVib = averageSpectra(floorSpectra.map((f) => f.vib));
  const floorMic = averageSpectra(floorSpectra.map((f) => f.mic));
  const vib = averageSpectra(vibSpectra), mic = averageSpectra(micSpectra);
  const snr = (sig, floor, lo, hi) => (sig && floor ? db10(bandPower(sig, lo, hi)) - db10(bandPower(floor, lo, hi)) : null);

  const vibEdges = logEdges(vlo, vhi, s.fingerprintBands), micEdges = logEdges(mlo, mhi, s.fingerprintBands);
  return {
    strokes: features,
    vib, mic, floorVib, floorMic,
    fingerprint: {
      vib: vib && { edges: vibEdges.map((e) => round(e, 1)), db: bandsDb(vib, vibEdges).map((v) => round(v, 1)) },
      mic: mic && { edges: micEdges.map((e) => round(e, 1)), db: bandsDb(mic, micEdges).map((v) => round(v, 1)) },
    },
    snr: { vib_db: snr(vib, floorVib, vlo, vhi), mic_db: snr(mic, floorMic, mlo, mhi) },
  };
}

/** What the score and the library need, small enough to store with the take. */
export function summarize(session, imu, strokes, frequency = null) {
  const { info } = session;
  const seq = session.imu.seq;
  let lost = 0, restarts = 0;
  for (let i = 1; i < seq.length; i++) {
    const d = seq[i] - seq[i - 1];
    if (d > 1) lost += d - 1;
    else if (d <= 0) restarts++;
  }
  const imuSeconds = imu.t.length > 1 ? imu.t[imu.t.length - 1] - imu.t[0] : 0;

  const blocks = session.mic.blocks;
  let micMissing = 0;
  for (let i = 4; i < blocks.length; i += 4) {
    const gap = blocks[i + 1] - (blocks[i - 3] + blocks[i - 1]);
    if (gap > 0) micMissing += gap;
  }
  const micN = session.mic.samples.length;

  const statuses = {};
  for (const s of session.tof.status) statuses[s] = (statuses[s] ?? 0) + 1;
  const tofN = session.tof.status.length;
  const tofT = session.tof.t_us;

  const last = session.stats.at(-1);
  const first = session.stats[0];
  return {
    version: ANALYSIS_VERSION,
    board: info ? info.board_id.toString(16).toUpperCase().padStart(4, "0") : null,
    flags: info ? info.flags : null,
    seconds: Math.max(imuSeconds, tofN > 1 ? (tofT[tofN - 1] - tofT[0]) * 1e-6 : 0),
    link: {
      packets: session.packets,
      lost: session.lost,
      bad: session.bad,
      // The device's own count of packets it couldn't send, over this take
      deviceDropped: last && first ? last.tx_dropped - first.tx_dropped : 0,
      errors: session.messages.filter((m) => m.level >= 2).map((m) => m.text).slice(0, 5),
      warnings: session.messages.filter((m) => m.level === 1).length,
    },
    imu: {
      samples: seq.length,
      rateHz: imuSeconds > 0 ? (seq.length - 1) / imuSeconds : 0,
      lost,
      restarts,
      clipped: countClipped(session.imu.accel, CLIP_COUNT) + countClipped(session.imu.gyro, CLIP_COUNT),
    },
    mic: { samples: micN, missing: micMissing, clipped: countClipped(session.mic.samples, 32767) },
    tof: { readings: tofN, statuses },
    stillS: stillAtStart(imu.t, imu.gyro, imu.accel),
    strokes: strokes.map((s, i) => {
      const f = frequency?.strokes[i] ?? {};
      const r = (x, d) => (x === null || x === undefined || !Number.isFinite(x) ? null : round(x, d));
      return {
        t0: round(s.t0, 3), t1: round(s.t1, 3), direction: s.direction,
        length_mm: round(s.length_mm, 1), mean_mm_s: round(s.mean_mm_s, 1), peak_mm_s: round(s.peak_mm_s, 1),
        vib_peak_hz: r(f.vib_peak_hz, 1), vib_centroid_hz: r(f.vib_centroid_hz, 1), vib_rms_g: r(f.vib_rms_g, 4),
        mic_centroid_hz: r(f.mic_centroid_hz, 0), mic_dbfs: r(f.mic_dbfs, 1), grain_mm: r(f.grain_mm, 3),
      };
    }),
    fingerprint: frequency?.fingerprint ?? { vib: null, mic: null },
    snr: {
      vib_db: frequency?.snr.vib_db == null ? null : round(frequency.snr.vib_db, 1),
      mic_db: frequency?.snr.mic_db == null ? null : round(frequency.snr.mic_db, 1),
    },
  };
}

function round(x, digits) {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

// ---- Scores ----

const fmt = (n) => Math.round(n).toLocaleString("en-US");
const pct = (x) => `${(x * 100).toFixed(x < 0.01 && x > 0 ? 2 : 0)}%`;

/** Score one take from its summary: checks worth 100 points between them, each pass, warn or fail
 *  with a line saying why. */
export function scoreTake(summary) {
  const checks = [];
  const add = (id, name, max, points, status, detail) =>
    checks.push({ id, name, max, points: Math.round(points * 10) / 10, status, detail });

  // The link: packets lost on the way, damaged, or dropped by the device
  const { link } = summary;
  const missing = link.lost + link.bad + link.deviceDropped;
  const share = missing / Math.max(1, link.packets + link.lost);
  const linkDetail = missing
    ? `${fmt(link.lost)} lost, ${fmt(link.bad)} damaged, ${fmt(link.deviceDropped)} dropped by the board (${pct(share)})`
    : `${fmt(link.packets)} packets, none lost`;
  if (!missing) add("link", "Serial link", 15, 15, "pass", linkDetail);
  else if (share <= 0.001) add("link", "Serial link", 15, 10, "warn", linkDetail);
  else if (share <= 0.01) add("link", "Serial link", 15, 5, "warn", linkDetail);
  else add("link", "Serial link", 15, 0, "fail", linkDetail);

  const { imu } = summary;
  if (!imu.samples) add("imu", "IMU", 10, 0, "fail", "No IMU samples");
  else {
    const lostShare = imu.lost / (imu.samples + imu.lost);
    const detail = `${fmt(imu.samples)} samples at ${fmt(imu.rateHz)} Hz` +
      (imu.lost ? `, ${fmt(imu.lost)} lost` : ", none lost") +
      (imu.restarts ? `; the board restarted ${imu.restarts}×` : "");
    if (imu.restarts) add("imu", "IMU", 10, 0, "fail", detail);
    else if (!imu.lost) add("imu", "IMU", 10, 10, "pass", detail);
    else if (lostShare <= 0.001) add("imu", "IMU", 10, 6, "warn", detail);
    else add("imu", "IMU", 10, 0, "fail", detail);
  }

  const { mic } = summary;
  if (!mic.samples) add("mic", "Microphone", 10, 0, "fail", "No microphone samples");
  else {
    const missShare = mic.missing / mic.samples;
    const clipShare = mic.clipped / mic.samples;
    const detail = (mic.missing ? `${pct(missShare)} of the audio missing` : "Gapless") +
      (mic.clipped ? `, ${pct(clipShare)} clipped` : ", no clipping");
    if (!mic.missing && clipShare < 0.001) add("mic", "Microphone", 10, 10, "pass", detail);
    else if (missShare <= 0.005 && clipShare < 0.01) add("mic", "Microphone", 10, 5, "warn", detail);
    else add("mic", "Microphone", 10, 0, "fail", detail);
  }

  const { tof } = summary;
  if (!tof.readings) add("tof", "Distance (ToF)", 20, 0, "fail", "No ToF readings: is the VL53L1X wired?");
  else {
    const good = (tof.statuses[0] ?? 0) / tof.readings;
    const worst = Object.entries(tof.statuses).filter(([s]) => s !== "0").sort((a, b) => b[1] - a[1])[0];
    const detail = `${pct(good)} good readings` +
      (worst ? `; mostly ${TOF_STATUS[worst[0]] ?? `status ${worst[0]}`} otherwise` : "");
    const points = 20 * Math.min(1, Math.max(0, (good - 0.5) / 0.4));
    add("tof", "Distance (ToF)", 20, points, good >= 0.9 ? "pass" : good >= 0.6 ? "warn" : "fail", detail);
  }

  const still = summary.stillS;
  const stillDetail = `${still.toFixed(1)} s still at the start (${SETTINGS.stillNeededS} s lets VQF learn the gyro bias)`;
  if (still >= SETTINGS.stillNeededS) add("still", "Still start", 10, 10, "pass", stillDetail);
  else if (still >= SETTINGS.stillNeededS / 2) add("still", "Still start", 10, 5, "warn", stillDetail);
  else add("still", "Still start", 10, 0, "fail", stillDetail);

  const strokes = summary.strokes;
  const want = 6;
  if (!strokes.length) add("strokes", "Strokes", 15, 0, "fail", "No strokes found in the ToF speed");
  else {
    const peaks = strokes.map((s) => s.peak_mm_s);
    const dirs = new Set(strokes.map((s) => s.direction)).size;
    const detail = `${strokes.length} stroke${strokes.length === 1 ? "" : "s"}` +
      `${dirs === 2 ? ", both ways" : ", one way"}, ${fmt(Math.min(...peaks))}–${fmt(Math.max(...peaks))} mm/s peak`;
    add("strokes", "Strokes", 15, 15 * Math.min(1, strokes.length / want), strokes.length >= want ? "pass" : "warn", detail);
  }

  // The texture itself: the strokes' vibration over the floor between them, in the frequency band
  const snr = summary.snr ?? {};
  const fmtDb = (x) => (x === null || x === undefined ? "?" : `${x >= 0 ? "+" : ""}${x.toFixed(0)} dB`);
  if (!strokes.length || snr.vib_db === null || snr.vib_db === undefined) {
    add("texture", "Texture signal", 10, 0, "fail", "No strokes with quiet between them to compare: nothing to measure");
  } else {
    const grains = strokes.map((s) => s.grain_mm).filter((g) => g !== null && g !== undefined).sort((a, b) => a - b);
    const detail = `Vibration ${fmtDb(snr.vib_db)}, sound ${fmtDb(snr.mic_db)} over the quiet between strokes` +
      (grains.length ? `; grain ≈ ${grains[grains.length >> 1].toFixed(2)} mm` : "");
    const v = snr.vib_db;
    if (v >= SETTINGS.goodSnrDb) add("texture", "Texture signal", 10, 10, "pass", detail);
    else if (v >= 3) add("texture", "Texture signal", 10, 10 * (v - 3) / (SETTINGS.goodSnrDb - 3), "warn", detail);
    else add("texture", "Texture signal", 10, 0, "fail", detail);
  }

  const clipShare = imu.samples ? imu.clipped / (imu.samples * 6) : 0;
  const clipDetail = imu.clipped ? `${fmt(imu.clipped)} IMU values at full scale (±8 g / ±2000 °/s)` : "Nothing at full scale";
  if (!imu.clipped) add("clip", "IMU headroom", 10, 10, "pass", clipDetail);
  else if (clipShare <= 0.001) add("clip", "IMU headroom", 10, 5, "warn", clipDetail);
  else add("clip", "IMU headroom", 10, 0, "fail", clipDetail);

  if (summary.link.errors.length) {
    checks.push({ id: "messages", name: "Board errors", max: 0, points: 0, status: "warn", detail: summary.link.errors.join("; ") });
  }
  const score = Math.round(checks.reduce((sum, c) => sum + c.points, 0));
  return { score, grade: grade(score), checks };
}

export function grade(score) {
  return score >= 85 ? "good" : score >= 60 ? "usable" : "poor";
}

const binName = (lo, hi) => (hi === Infinity ? `≥${lo}` : `${lo}–${hi}`);

/** Score a dataset: for each surface label, how many usable takes, strokes and stroke speeds it
 *  has against TARGETS, and what to record next. `takes`: [{label, keep, summary}] with summaries
 *  scored by scoreTake (pass `score`), or computed here. */
export function scoreDataset(takes) {
  const byLabel = new Map();
  for (const take of takes) {
    const label = (take.label || "").trim() || "(unlabelled)";
    if (!byLabel.has(label)) byLabel.set(label, []);
    byLabel.get(label).push(take);
  }
  const bins = TARGETS.speedBins;
  const labels = [...byLabel.entries()].map(([label, list]) => {
    const scored = list.map((t) => ({ take: t, score: t.score ?? scoreTake(t.summary).score }));
    const kept = scored.filter((s) => s.take.keep !== false && s.score >= 60);
    const strokes = kept.flatMap((s) => s.take.summary.strokes);
    const binCounts = bins.slice(0, -1).map((lo, i) =>
      strokes.filter((s) => s.mean_mm_s >= lo && s.mean_mm_s < bins[i + 1]).length);
    const covered = binCounts.filter((n) => n >= TARGETS.strokesPerBin).length / binCounts.length;
    const quality = kept.length ? kept.reduce((s, k) => s + k.score, 0) / kept.length : 0;
    const takesShare = Math.min(1, kept.length / TARGETS.takes);
    const strokeShare = Math.min(1, strokes.length / TARGETS.strokes);
    const score = Math.round(0.4 * quality * takesShare + 30 * strokeShare + 30 * covered);
    const away = strokes.filter((s) => s.direction === "away").length;
    const grains = strokes.map((s) => s.grain_mm).filter((g) => g !== null && g !== undefined).sort((a, b) => a - b);
    const prints = kept.map((k) => k.take.summary.fingerprint?.vib?.db).filter(Boolean);
    let match = null;
    if (prints.length >= 2) {
      let sum = 0, n = 0;
      for (let i = 0; i < prints.length; i++) for (let j = i + 1; j < prints.length; j++) { sum += similarity(prints[i], prints[j]); n++; }
      match = sum / n;
    }

    const next = [];
    if (kept.length < TARGETS.takes) next.push(`${TARGETS.takes - kept.length} more usable take${TARGETS.takes - kept.length === 1 ? "" : "s"}`);
    if (strokes.length < TARGETS.strokes) next.push(`${TARGETS.strokes - strokes.length} more strokes`);
    const thin = binCounts.map((n, i) => (n < TARGETS.strokesPerBin ? binName(bins[i], bins[i + 1]) : null)).filter(Boolean);
    if (strokes.length && thin.length) next.push(`strokes at ${thin.join(", ")} mm/s`);
    if (strokes.length >= 6 && (away === 0 || away === strokes.length)) next.push(`strokes ${away ? "toward" : "away from"} the wall`);
    if (match !== null && match < TARGETS.spectrumMatch) next.push(`takes' vibration spectra differ (${Math.round(match * 100)}% alike): same surface and pressure?`);
    return {
      label,
      takes: list.length,
      kept: kept.length,
      quality: Math.round(quality),
      strokes: strokes.length,
      strokeSeconds: strokes.reduce((s, k) => s + (k.t1 - k.t0), 0),
      away,
      toward: strokes.length - away,
      binCounts,
      score,
      next,
      grain_mm: grains.length ? grains[grains.length >> 1] : null,
      match,
      fingerprint: meanFingerprint(kept.map((k) => k.take.summary.fingerprint?.vib)),
      micFingerprint: meanFingerprint(kept.map((k) => k.take.summary.fingerprint?.mic)),
    };
  });
  labels.sort((a, b) => a.label.localeCompare(b.label));
  const score = labels.length ? Math.round(labels.reduce((s, l) => s + l.score, 0) / labels.length) : 0;
  return { score, grade: grade(score), labels, bins: bins.slice(0, -1).map((lo, i) => binName(lo, bins[i + 1])) };
}

/** The mean of several fingerprints (in power, back to dB), or null. */
export function meanFingerprint(list) {
  const valid = list.filter((f) => f && f.db && f.db.every((v) => v !== null));
  if (!valid.length) return null;
  const db = valid[0].db.map((_, i) => 10 * Math.log10(valid.reduce((s, f) => s + 10 ** (f.db[i] / 10), 0) / valid.length));
  return { edges: valid[0].edges, db: db.map((v) => round(v, 1)) };
}
