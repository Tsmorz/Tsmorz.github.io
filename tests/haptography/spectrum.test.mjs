// The frequency-domain tools (haptography/spectrum.js), on signals with known spectra, and
// the grain they find in the simulated device's strokes, whose wavelength is known.
import { test } from "node:test";
import assert from "node:assert/strict";

import * as S from "../../haptography/spectrum.js";
import { Simulator } from "../../haptography/simulate.js";
import { decodeSession } from "../../haptography/session.js";
import { analyze, scoreTake, scoreDataset } from "../../haptography/analysis.js";
import { rng } from "./fixture.mjs";

const sine = (n, rate, f, amp = 1) => Float64Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / rate));

test("FFT of an impulse and of a bin-centred cosine", () => {
  const re = new Float64Array(8), im = new Float64Array(8);
  re[0] = 1;
  S.fft(re, im);
  assert.ok(re.every((v) => Math.abs(v - 1) < 1e-12) && im.every((v) => Math.abs(v) < 1e-12));
  const x = Float64Array.from({ length: 16 }, (_, i) => Math.cos((2 * Math.PI * 3 * i) / 16));
  const xi = new Float64Array(16);
  S.fft(x, xi);
  assert.ok(Math.abs(x[3] - 8) < 1e-9 && Math.abs(x[13] - 8) < 1e-9 && Math.abs(x[4]) < 1e-9);
});

test("Welch: a sine's peak and power", () => {
  const rate = 1670, f = 237.3, amp = 0.3;
  const spec = S.welch(sine(8000, rate, f, amp), rate, { nfft: 256 });
  assert.ok(Math.abs(S.peakFrequency(spec, 10, 800) - f) < 2, `peak ${S.peakFrequency(spec, 10, 800)}`);
  // Parseval: a sine of amplitude A carries A²/2
  assert.ok(Math.abs(S.bandPower(spec, 0, rate / 2) / (amp * amp / 2) - 1) < 0.05);
  assert.ok(Math.abs(S.centroid(spec, 200, 280) - f) < 5);
});

test("Welch: white noise is flat at its variance over the band", () => {
  const rand = rng(5);
  const x = Float64Array.from({ length: 40000 }, () => rand() * 2 - 1); // variance 1/3
  const spec = S.welch(x, 1000, { nfft: 256 });
  const level = S.bandPower(spec, 0, 500);
  assert.ok(Math.abs(level / (1 / 3) - 1) < 0.05);
  const bands = S.bandsDb(spec, S.logEdges(20, 480, 8));
  assert.ok(Math.max(...bands) - Math.min(...bands) < 1.5, bands.join(" "));
});

test("a short stretch is one padded window, with its own power", () => {
  const spec = S.welch(sine(100, 1000, 100, 1), 1000, { nfft: 256 });
  assert.equal(spec.segments, 1);
  assert.ok(Math.abs(S.peakFrequency(spec, 10, 400) - 100) < 4);
  assert.equal(S.welch(new Float64Array(10), 1000), null);
});

test("spectrogram: the frame of a tone's onset", () => {
  const x = new Float64Array(4000);
  x.set(sine(2000, 1000, 125), 2000);
  const sg = S.spectrogram(x, { nfft: 128, hop: 64 });
  const bin = Math.round((125 * 128) / 1000);
  const level = (frame) => sg.db[frame * sg.bins + bin];
  assert.ok(level(5) < -100 && level(sg.frames - 2) > -7, `${level(5)} ${level(sg.frames - 2)}`);
});

test("similarity: shape, not loudness", () => {
  const a = [-20, -10, -30, -40];
  assert.ok(Math.abs(S.similarity(a, a.map((v) => v + 12)) - 1) < 1e-9);
  assert.ok(S.similarity(a, [-40, -30, -10, -20]) < 0.3);
});

function take(seconds, wavelengthMm, seed) {
  const sim = new Simulator({ seed, wavelengthMm });
  const parts = [];
  for (let ms = 0; ms < seconds * 1000; ms += 100) parts.push(sim.next(100));
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { bytes.set(p, at); at += p.length; }
  return analyze(decodeSession(bytes));
}

const fine = take(30, 1.0, 11);
const coarse = take(30, 2.4, 12);
const fineAgain = take(30, 1.0, 13);

test("each stroke's grain is the texture's wavelength", () => {
  for (const [a, lambda] of [[fine, 1.0], [coarse, 2.4]]) {
    const grains = a.summary.strokes.map((s) => s.grain_mm).filter((g) => g !== null).sort((x, y) => x - y);
    assert.ok(grains.length >= 5, `${grains.length} strokes with a grain`);
    const median = grains[grains.length >> 1];
    assert.ok(Math.abs(median / lambda - 1) < 0.15, `median grain ${median} mm for ${lambda} mm`);
  }
});

test("the texture stands well above the floor between strokes", () => {
  assert.ok(fine.summary.snr.vib_db > 15, `${fine.summary.snr.vib_db} dB`);
  assert.ok(fine.summary.snr.mic_db > 15, `${fine.summary.snr.mic_db} dB`);
  const check = scoreTake(fine.summary).checks.find((c) => c.id === "texture");
  assert.equal(check.status, "pass");
  assert.equal(fine.summary.fingerprint.vib.db.length, 24);
});

test("a dataset: takes of one surface match, its grain is found", () => {
  const d = scoreDataset([
    { label: "fine", keep: true, summary: fine.summary },
    { label: "fine", keep: true, summary: fineAgain.summary },
    { label: "coarse", keep: true, summary: coarse.summary },
  ]);
  const f = d.labels.find((l) => l.label === "fine");
  assert.ok(f.match > 0.8, `match ${f.match}`);
  assert.ok(Math.abs(f.grain_mm - 1) < 0.15);
  assert.ok(!f.next.some((n) => n.includes("spectra differ")));
  assert.ok(S.similarity(f.fingerprint.db, d.labels.find((l) => l.label === "coarse").fingerprint.db) < f.match);
});
