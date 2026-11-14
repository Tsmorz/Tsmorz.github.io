// Decoding, analysis and scores on the simulated device (haptography/simulate.js), whose
// motion is known: still for 5 s, then strokes back and forth.
import { test } from "node:test";
import assert from "node:assert/strict";

import { Simulator, makeMotion } from "../../haptography/simulate.js";
import { decodeSession, micTimeline, timeSpan } from "../../haptography/session.js";
import * as A from "../../haptography/analysis.js";

function record(seconds, sim = new Simulator({ seed: 3 })) {
  const parts = [];
  for (let ms = 0; ms < seconds * 1000; ms += 50) parts.push(sim.next(50));
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { bytes.set(p, at); at += p.length; }
  return bytes;
}

const bytes = record(30);
const session = decodeSession(bytes);
const analysis = A.analyze(session);

test("the demo stream decodes whole", () => {
  assert.equal(session.lost, 0);
  assert.equal(session.bad, 0);
  assert.equal(session.info.board_id, 0x5eed);
  const imuRate = session.imu.t_us.length / 30;
  assert.ok(Math.abs(imuRate - 1670) < 2, `IMU ${imuRate}/s`);
  assert.ok(session.mic.samples.length >= 30 * 16000 - 160); // the last block may not have filled
  assert.ok(Math.abs(session.tof.t_us.length / 30 - 66) < 1);
  assert.equal(session.messages.length, 1);
});

test("the mic's timeline is its blocks' line", () => {
  const mt = micTimeline(session.mic);
  assert.ok(Math.abs(mt.us_per_sample - 62.5) < 1e-6);
  assert.ok(Math.abs(mt.t0_us - 4_000_000) < 1);
  const span = timeSpan(session);
  assert.ok(span.end_us - span.start_us > 29.9e6);
});

test("still at the start for the simulator's 5 s", () => {
  assert.ok(analysis.summary.stillS > 4.5 && analysis.summary.stillS <= 5.1, `${analysis.summary.stillS}`);
});

test("strokes match the known motion", () => {
  const motion = makeMotion({ seed: 3 });
  // The true strokes: runs of speed above the detector's end threshold
  const truth = [];
  let inStroke = false;
  for (let s = 0; s < 30; s += 0.001) {
    const moving = Math.abs(motion(s).v) > A.SETTINGS.strokeEndSpeed;
    if (moving && !inStroke) truth.push({ t0: s, dir: motion(s + 0.01).v > 0 ? "away" : "toward" });
    if (!moving && inStroke) truth.at(-1).t1 = s;
    inStroke = moving;
  }
  const done = truth.filter((t) => t.t1 !== undefined && t.t1 < 29.5);
  const found = analysis.strokes;
  assert.ok(Math.abs(found.length - done.length) <= 1, `${found.length} found, ${done.length} true`);
  // Every finished true stroke has a found one starting within 0.15 s, in the same direction
  // (times: the simulator's clock starts at the recording's origin)
  for (const t of done) {
    const match = found.find((f) => Math.abs(f.t0 - t.t0) < 0.15);
    assert.ok(match, `no stroke near ${t.t0.toFixed(2)} s`);
    assert.equal(match.direction, t.dir);
  }
});

test("ToF speed follows the motion", () => {
  const motion = makeMotion({ seed: 3 });
  let sq = 0, n = 0;
  analysis.tof.t.forEach((t, i) => {
    const v = analysis.tof.speed[i];
    if (!Number.isFinite(v) || t < 1) return;
    sq += (v - motion(t - 0.0075).v) ** 2;
    n++;
  });
  assert.ok(Math.sqrt(sq / n) < 25, `speed RMS error ${Math.sqrt(sq / n)} mm/s`);
});

test("a clean take scores well", () => {
  const s = A.scoreTake(analysis.summary);
  assert.ok(s.score >= 85, JSON.stringify(s.checks));
  assert.equal(s.grade, "good");
  assert.equal(s.checks.reduce((sum, c) => sum + c.max, 0), 100);
});

test("lost bytes cost points on the link and the IMU", () => {
  const broken = bytes.slice();
  for (let i = 100_000; i < broken.length; i += 97_000) broken.fill(0x55, i, i + 400);
  const s = A.scoreTake(A.analyze(decodeSession(broken)).summary);
  const link = s.checks.find((c) => c.id === "link");
  assert.notEqual(link.status, "pass");
  assert.ok(s.score < A.scoreTake(analysis.summary).score);
});

test("moving from the start fails the still check", () => {
  const sim = new Simulator({ seed: 4, stillS: 0.2 });
  const s = A.scoreTake(A.analyze(decodeSession(record(8, sim))).summary);
  assert.equal(s.checks.find((c) => c.id === "still").status, "fail");
});

test("segmentStrokes: hysteresis, minimums and sign changes", () => {
  const t = Array.from({ length: 40 }, (_, i) => i * 0.02);
  const v = t.map((x) => (x < 0.1 ? 0 : x < 0.4 ? 100 : x < 0.42 ? 0 : x < 0.7 ? -80 : x < 0.72 ? 50 : 0));
  const strokes = A.segmentStrokes(t, v, t.map(() => 1));
  assert.deepEqual(strokes.map((s) => s.direction), ["away", "toward"]); // the 20 ms blip is too short
  assert.ok(Math.abs(strokes[0].length_mm - 30) < 3);
});

test("lineFitSlope needs points on both sides", () => {
  const t = [0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06];
  const y = t.map((x) => 100 + 200 * x);
  const s = A.lineFitSlope(t, y, t.map(() => 1), 0.25, 5);
  assert.ok(Math.abs(s[3] - 200) < 1e-9);
  const none = A.lineFitSlope(t, y, t.map(() => 1), 0.25, 8);
  assert.ok(none.every(Number.isNaN));
});

test("principal axis of a vibration along y", () => {
  const values = new Float32Array(300);
  for (let i = 0; i < 100; i++) values[i * 3 + 1] = Math.sin(i);
  const axis = A.principalAxis(values);
  assert.ok(Math.abs(Math.abs(axis[1]) - 1) < 1e-6);
});

test("dataset score: targets per surface and what to record next", () => {
  const stroke = (mean) => ({ t0: 0, t1: 0.5, direction: mean > 0 ? "away" : "toward", length_mm: 100, mean_mm_s: Math.abs(mean), peak_mm_s: 1.5 * Math.abs(mean) });
  const good = A.scoreTake(analysis.summary).score;
  const full = { ...analysis.summary, strokes: [50, -60, 70, 150, -160, 170, 250, -260, 270, 350, -360, 370].map(stroke) };
  const takes = [
    { label: "cork", keep: true, summary: full },
    { label: "cork", keep: true, summary: full },
    { label: "cork", keep: true, summary: full },
    { label: "felt", keep: true, summary: { ...analysis.summary, strokes: [stroke(120), stroke(-130)] } },
    { label: "felt", keep: false, summary: full }, // rejected: doesn't count
  ];
  const d = A.scoreDataset(takes);
  const cork = d.labels.find((l) => l.label === "cork");
  const felt = d.labels.find((l) => l.label === "felt");
  assert.equal(cork.kept, 3);
  assert.equal(cork.strokes, 36);
  assert.deepEqual(cork.binCounts, [9, 9, 9, 9]);
  assert.deepEqual(cork.next, []);
  assert.ok(Math.abs(cork.score - Math.round(0.4 * good + 60)) <= 1);
  assert.equal(felt.kept, 1);
  assert.ok(felt.next.some((n) => n.startsWith("2 more usable takes")));
  assert.ok(felt.next.some((n) => n.includes("strokes at")));
  assert.ok(felt.score < cork.score);
  assert.equal(d.score, Math.round((cork.score + felt.score) / 2));
});
