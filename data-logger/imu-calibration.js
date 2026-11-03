// The IMU calibration the Calibrate dialog runs (calibrate-view.js shows it; the board keeps the
// result, imu_format.h): the accelerometer's offset and gain per axis from six still faces, and the
// gyro's gain per axis from ten whole turns about it. Pure, so tests/dashboard/imu-calibration.test.mjs
// runs it in Node on simulated sensors.
//
// Samples are { seq, tUs, gyroDps: [x, y, z], accelG: [x, y, z], saturated }: every IMU sample,
// uncalibrated (raw counts times the board's scales), tUs the board's unwrapped microseconds.
import { IMU_CAL_LIMITS } from "./wire.js";

// The six faces, each a board axis that points up. The board frame (board-model.js): +z out of the
// side with the parts, +y toward the USB port, +x toward the RGB LED's side. `say` is what to do,
// `detail` how.
export const FACES = [
  { axis: 2, sign: 1, name: "+Z", say: "Lay it flat, parts up", detail: "On the table, the USB port and LEDs on top." },
  { axis: 2, sign: -1, name: "−Z", say: "Lay it flat, upside down", detail: "Parts facing the table. Resting on the USB port's shell tips it a little, which is fine." },
  { axis: 1, sign: 1, name: "+Y", say: "Stand it on its end, USB port up", detail: "Lean it against something so it stays put, then let go." },
  { axis: 1, sign: -1, name: "−Y", say: "Stand it on its end, USB port down", detail: "Lean it against something so it stays put, then let go." },
  { axis: 0, sign: 1, name: "+X", say: "Stand it on its long edge, RGB LED's side up", detail: "Lean it against something so it stays put, then let go." },
  { axis: 0, sign: -1, name: "−X", say: "Stand it on its long edge, red LED's side up", detail: "Lean it against something so it stays put, then let go." },
];
export const AXES = ["X", "Y", "Z"];

// Still enough: over HOLD_SECONDS, each axis's spread under these (the board at rest on a table
// reads ~0.05 °/s and ~0.6 mg; a hand holding it against something, a few times that). The gyro test's
// holds, which measure its bias, need it resting on the table, and then a second more, so the slow
// end of a stop is out of the window.
export const HOLD_SECONDS = 2;
const STILL = { gyroStdDps: 0.75, accelStdG: 0.005 };
const RESTING = { gyroStdDps: 0.25, accelStdG: 0.005 };
const SETTLE_SECONDS = 1;

export const TURNS = 10;
// A turn that comes out further than this from TURNS whole turns is taken for a miscount or a stop
// short of the start (0.3 turns in ten), not a gain: the gyros measured were ~1% out.
const TURN_GAIN_ACCEPT = 0.03;
// The turn must be this nearly about the axis tested (5.7°), so the other axes' own gain errors
// can't reach the result (under 0.05% at the 5% limit).
const TURN_AXIS_SHARE = 0.995;
// A pause in the samples longer than this can't be bridged.
const LONGEST_GAP_US = 100_000;


const norm = (v) => Math.hypot(v[0], v[1], v[2]);

/** The most a face may be tipped and still count, degrees: the fit doesn't need it square, only
 * near enough that each face pins its own axis. */
export const FACE_TOLERANCE_DEG = 25;
const FACE_COS = Math.cos((FACE_TOLERANCE_DEG * Math.PI) / 180);

/** How far an accelerometer reading says `face` is from pointing straight up: { offDeg }. */
export function tiltFrom(accelG, { axis, sign }) {
  const cos = Math.max(-1, Math.min(1, (sign * accelG[axis]) / (norm(accelG) || 1)));
  return { offDeg: (Math.acos(cos) * 180) / Math.PI };
}

/** The face whose axis points up for this accelerometer reading, or -1 between faces. */
export function faceOf(accelG) {
  const length = norm(accelG);
  if (!length) return -1;
  return FACES.findIndex(({ axis, sign }) => (sign * accelG[axis]) / length >= FACE_COS);
}

/** The last `seconds` of samples, with running sums: whether they were still, and their means. */
export class StillWindow {
  constructor(seconds = HOLD_SECONDS, { gyroStdDps, accelStdG } = STILL) {
    this.spanUs = seconds * 1e6;
    this.limits = { gyroStdDps, accelStdG };
    this.clear();
  }

  clear() {
    this.samples = [];
    this.stillSinceUs = null;
    this.sum = new Float64Array(6);
    this.sumSquares = new Float64Array(6);
  }

  add(sample) {
    this.stillSinceUs ??= sample.tUs;
    this.samples.push(sample);
    this.accumulate(sample, 1);
    while (this.samples.length > 1 && sample.tUs - this.samples[1].tUs >= this.spanUs) this.accumulate(this.samples.shift(), -1);
    if (!this.still) {
      this.clear();
      this.stillSinceUs = sample.tUs;
      this.samples.push(sample);
      this.accumulate(sample, 1);
    }
  }

  accumulate({ gyroDps, accelG }, sign) {
    [...gyroDps, ...accelG].forEach((value, i) => {
      this.sum[i] += sign * value;
      this.sumSquares[i] += sign * value * value;
    });
  }

  std(i) {
    const n = this.samples.length;
    return n < 2 ? 0 : Math.sqrt(Math.max(0, this.sumSquares[i] / n - (this.sum[i] / n) ** 2));
  }

  get still() {
    return [0, 1, 2].every((i) => this.std(i) <= this.limits.gyroStdDps) && [3, 4, 5].every((i) => this.std(i) <= this.limits.accelStdG);
  }

  /** How much of the hold has passed, 0-1 (the window only holds still samples). */
  get progress() {
    return Math.min(1, this.stillUs / this.spanUs);
  }

  /** How long the samples have been still, µs: past the span once the window is full. */
  get stillUs() {
    const n = this.samples.length;
    return n < 2 ? 0 : this.samples[n - 1].tUs - this.stillSinceUs;
  }

  get full() {
    return this.progress >= 1;
  }

  /** Board time of the window's middle, µs. */
  get centerUs() {
    return (this.samples[0].tUs + this.samples[this.samples.length - 1].tUs) / 2;
  }

  get meanGyro() {
    return [0, 1, 2].map((i) => this.sum[i] / this.samples.length);
  }

  get meanAccel() {
    return [3, 4, 5].map((i) => this.sum[i] / this.samples.length);
  }
}

/**
 * Collects the six faces: each is captured, as its mean reading, once the board has been still on
 * it for HOLD_SECONDS. Any order; a face already captured stays until redo().
 */
export class AccelFaces {
  constructor() {
    this.window = new StillWindow();
    this.reset();
  }

  reset() {
    this.captured = FACES.map(() => null);
    this.facing = -1;
    this.window.clear();
  }

  redo(face) {
    this.captured[face] = null;
    this.window.clear();
  }

  /** Adds a sample; returns the face it completed, or -1. */
  add(sample) {
    const facing = faceOf(sample.accelG);
    if (facing !== this.facing) this.window.clear();
    this.facing = facing;
    this.window.add(sample);
    if (facing < 0 || this.captured[facing] || !this.window.full) return -1;
    this.captured[facing] = this.window.meanAccel;
    return facing;
  }

  /** How far the hold on the face up now has got, 0-1 (1 once it's captured). */
  get progress() {
    if (this.facing < 0) return 0;
    return this.captured[this.facing] ? 1 : this.window.progress;
  }

  get done() {
    return this.captured.every(Boolean);
  }
}

// Solves the n x n system a x = b (Gaussian elimination, partial pivoting); null if singular.
function solve(a, b) {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    if (Math.abs(m[pivot][col]) < 1e-12) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = m[row][col] / m[col][col];
      for (let k = col; k <= n; k++) m[row][k] -= factor * m[col][k];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}

/**
 * The offset o and gain g per axis that make every face read 1 g: |(a - o)(1 + g)| = 1, by
 * Gauss-Newton from the faces' readings (six readings, six unknowns, so it needs no face square).
 * Returns { accelOffsetG, accelGain, before: [smallest, largest] |a| over the faces }, or
 * { error } if the faces don't give one within the board's limits.
 */
export function fitAccel(readings) {
  if (readings.length < 6 || readings.some((r) => !r)) return { error: "Six faces are needed." };
  // Starting point: each axis's two faces, as if each were square.
  const offset = [0, 1, 2].map((axis) => (readings[FACES.findIndex((f) => f.axis === axis && f.sign > 0)][axis] + readings[FACES.findIndex((f) => f.axis === axis && f.sign < 0)][axis]) / 2);
  const scale = [0, 1, 2].map((axis) => 2 / (readings[FACES.findIndex((f) => f.axis === axis && f.sign > 0)][axis] - readings[FACES.findIndex((f) => f.axis === axis && f.sign < 0)][axis]));
  for (let iteration = 0; iteration < 50; iteration++) {
    const jtj = Array.from({ length: 6 }, () => new Array(6).fill(0));
    const jtr = new Array(6).fill(0);
    for (const a of readings) {
      const v = [0, 1, 2].map((k) => scale[k] * (a[k] - offset[k]));
      const length = norm(v);
      const residual = length - 1;
      const row = [...[0, 1, 2].map((k) => (-v[k] * scale[k]) / length), ...[0, 1, 2].map((k) => (v[k] * (a[k] - offset[k])) / length)];
      for (let i = 0; i < 6; i++) {
        jtr[i] += row[i] * residual;
        for (let j = 0; j < 6; j++) jtj[i][j] += row[i] * row[j];
      }
    }
    const step = solve(jtj, jtr);
    if (!step) return { error: "The faces don't pin down every axis: redo them." };
    for (let k = 0; k < 3; k++) {
      offset[k] -= step[k];
      scale[k] -= step[3 + k];
    }
    if (Math.max(...step.map(Math.abs)) < 1e-12) break;
  }
  const accelGain = scale.map((s) => s - 1);
  const lengths = readings.map(norm);
  const before = [Math.min(...lengths), Math.max(...lengths)];
  if (offset.some((o) => !Number.isFinite(o) || Math.abs(o) > IMU_CAL_LIMITS.accelOffsetG) || accelGain.some((g) => !Number.isFinite(g) || Math.abs(g) > IMU_CAL_LIMITS.gain)) {
    return { error: "That's beyond what this sensor could be off by: the board probably moved during a face. Start over." };
  }
  return { accelOffsetG: offset, accelGain, before };
}

/**
 * One gyro axis's gain from TURNS whole turns about it: the board still with the axis up (its
 * bias, before), turned TURNS times and stopped where it started (lined up with a mark), still
 * again (the bias after). The turn is the gyro integrated over the samples' own times, less the
 * bias drifting in a straight line from before to after, so the result doesn't depend on the
 * sample rate or on VQF. `phase` is "place" (the axis isn't up), "settle" (holding still to start),
 * "turn", "done" (`result`) or "failed" (`error`).
 */
export class GyroTurns {
  constructor(axis, turns = TURNS) {
    this.axis = axis;
    this.turns = turns;
    this.window = new StillWindow(HOLD_SECONDS, RESTING);
    this.phase = "place";
    this.result = null;
    this.error = null;
    this.angle = [0, 0, 0]; // degrees turned about each axis, bias removed
    this.lost = 0;
  }

  /** Turns so far about the axis tested, signed. */
  get turnsSoFar() {
    return this.angle[this.axis] / 360;
  }

  /** How far the hold to start or to finish has got, 0-1. */
  get progress() {
    if (this.phase !== "settle" && this.phase !== "turn") return 0;
    return Math.min(1, this.window.stillUs / ((HOLD_SECONDS + SETTLE_SECONDS) * 1e6));
  }

  /** Seconds left before the hold is long enough. */
  get secondsToGo() {
    return Math.max(0, HOLD_SECONDS + SETTLE_SECONDS - this.window.stillUs / 1e6);
  }

  get settled() {
    return this.window.stillUs >= (HOLD_SECONDS + SETTLE_SECONDS) * 1e6;
  }

  add(sample) {
    if (this.phase === "done" || this.phase === "failed") return;
    if (this.phase === "turn") {
      this.integrate(sample);
      return;
    }
    const face = faceOf(sample.accelG);
    if (face < 0 || FACES[face].axis !== this.axis) {
      this.phase = "place";
      this.window.clear();
      return;
    }
    this.phase = "settle";
    this.window.add(sample);
    if (!this.settled) return;
    this.biasBefore = this.window.meanGyro;
    this.centerBefore = this.window.centerUs;
    this.startUs = sample.tUs;
    this.previous = sample;
    this.window.clear();
    this.phase = "turn";
  }

  integrate(sample) {
    const previous = this.previous;
    this.previous = sample;
    if (sample.saturated) return this.fail("It turned faster than the gyroscope's range: turn more slowly, or widen the range in Settings › IMU ranges.");
    if (sample.tUs - previous.tUs > LONGEST_GAP_US) return this.fail("Samples stopped arriving for a moment: keep the board close to this computer and try again.");
    this.lost += Math.max(0, sample.seq - previous.seq - 1);
    const dt = (sample.tUs - previous.tUs) / 1e6;
    for (let k = 0; k < 3; k++) this.angle[k] += ((previous.gyroDps[k] + sample.gyroDps[k]) / 2 - this.biasBefore[k]) * dt;

    this.window.add(sample);
    if (Math.abs(this.turnsSoFar) < this.turns - 0.5 || !this.settled) return;
    this.finish(sample.tUs);
  }

  finish(endUs) {
    // The bias in a straight line between the two holds: what it added beyond biasBefore.
    const biasAfter = this.window.meanGyro;
    const span = this.window.centerUs - this.centerBefore;
    const weight = ((endUs - this.centerBefore) ** 2 - (this.startUs - this.centerBefore) ** 2) / 2 / 1e6 / span;
    const angle = this.angle.map((a, k) => a - (biasAfter[k] - this.biasBefore[k]) * weight);
    const turned = norm(angle);
    const share = Math.abs(angle[this.axis]) / turned;
    if (share < TURN_AXIS_SHARE) {
      return this.fail(`It turned partly about another axis (${(Math.acos(share) * 180 / Math.PI).toFixed(0)}° off): keep the ${AXES[this.axis]} axis straight up, on a flat table.`);
    }
    const gain = (360 * this.turns) / turned - 1;
    if (Math.abs(gain) > TURN_GAIN_ACCEPT) {
      return this.fail(`That came to ${(turned / 360).toFixed(2)} turns: turn it exactly ${this.turns} times and stop where it started.`);
    }
    this.angle = angle;
    this.result = { gain, measuredTurns: turned / 360, lost: this.lost };
    this.phase = "done";
  }

  fail(error) {
    this.error = error;
    this.phase = "failed";
  }
}

/** Gains are shown as percent with a sign. */
export const formatGain = (gain) => `${gain >= 0 ? "+" : "−"}${Math.abs(gain * 100).toFixed(2)}%`;
/** Offsets as mg with a sign. */
export const formatOffset = (g) => `${g >= 0 ? "+" : "−"}${Math.abs(g * 1000).toFixed(1)} mg`;

/** Whether a calibration is all zero (the board's "uncalibrated"). */
export const isUncalibrated = (cal) => [...cal.accelOffsetG, ...cal.accelGain, ...cal.gyroGain].every((v) => v === 0);

/** A reading corrected as the firmware's imu_calibration_apply() does. */
export function applyCalibration(cal, accelG, gyroDps) {
  return {
    accelG: accelG.map((a, k) => (a - cal.accelOffsetG[k]) * (1 + cal.accelGain[k])),
    gyroDps: gyroDps.map((w, k) => w * (1 + cal.gyroGain[k])),
  };
}
