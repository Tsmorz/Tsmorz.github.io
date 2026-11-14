// The waveform library: every catalog entry in _data/haptography.yml renders, stays inside the
// actuator's tested drive limits, fits a clip, and sounds the same each time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { ROOT } from "./fixture.mjs";
import * as L from "../../haptography/library-core.js";
import { GRID, driveSafe, peak, rms, PREVIEW_PEAK } from "../../haptography/haptics-core.js";

// YAML through Ruby (already needed by check:data), so the tests read exactly what Jekyll renders.
const data = JSON.parse(execFileSync("ruby", ["-ryaml", "-rjson", "-e", "puts JSON.generate(YAML.safe_load_file(ARGV[0]))", join(ROOT, "_data/haptography.yml")], { encoding: "utf8" }));

test("the catalog is valid: known kinds and groups, unique ids, at most 3 s", () => {
  assert.ok(data.library.length >= 30, "a useful number of common waveforms");
  assert.deepEqual(L.validate(data.library, data.library_groups), []);
  for (const g of data.library_groups) assert.ok(data.library.some((e) => e.group === g.id), `group ${g.id} has waveforms`);
});

test("every drive is safe for the actuator at full level", () => {
  for (const e of data.library) {
    const d = L.drive(e, 1);
    assert.ok(driveSafe(d), `${e.id} exceeds the drive limits`);
    assert.ok(peak(d) > 0.02, `${e.id} is almost silent`);
  }
});

test("the level control scales the drive and the speaker audio together", () => {
  const click = data.library.find((e) => e.id === "click");
  assert.ok(Math.abs(peak(L.drive(click, 0.5)) - peak(L.drive(click, 1)) / 2) < 1e-9);
  const audio = L.speaker(click, 1);
  assert.ok(audio instanceof Float32Array && Math.abs(peak(audio) - 0.9) < 1e-6, "full drive is 0.9 on the speakers");
  assert.ok(Math.abs(peak(L.speaker(click, 0.5)) - 0.45) < 1e-6);
});

test("long buzzes are held to the sustained budget, clicks are not", () => {
  const buzz = L.drive(data.library.find((e) => e.id === "long-buzz"));
  const click = L.drive(data.library.find((e) => e.id === "click"));
  assert.ok(peak(buzz) < PREVIEW_PEAK * 0.6, "a continuous sine is held down by the 100 ms RMS budget");
  assert.ok(Math.abs(peak(click) - PREVIEW_PEAK) < 1e-9, "a single click uses the full safe peak");
  assert.ok(click.length >= 0.1 * GRID, "short hits are padded to the budget's 100 ms window");
});

test("shapes do what their parameters say", () => {
  const tone = (extra) => L.render({ id: "t", kind: "tone", hz: 100, ms: 1000, ...extra }, GRID);
  const up = tone({ shape: "up" });
  assert.ok(rms(up.subarray(0, 400)) < rms(up.subarray(1200)) / 3, "a ramp up starts quiet");
  const down = tone({ shape: "down" });
  assert.ok(rms(down.subarray(0, 400)) > rms(down.subarray(1200)) * 3, "a ramp down ends quiet");
  const twice = L.render({ id: "k", kind: "knock", ms: 4, repeat: 2, gap: 100 }, GRID);
  assert.ok(twice.length >= 0.1 * GRID, "the second hit starts 100 ms later");
  assert.ok(Math.abs(twice[Math.round(0.1 * GRID) + 3]) > 0.5, "and is as strong as the first");
  const noise = { id: "n", kind: "noise", low: 50, high: 300, ms: 500 };
  assert.deepEqual(L.render(noise, GRID), L.render(noise, GRID), "textures repeat exactly");
  assert.throws(() => L.render({ id: "x", kind: "laser" }), /Unknown waveform kind/);
  assert.match(L.validate([{ id: "a", name: "A", group: "nope", kind: "knock" }], [{ id: "clicks" }])[0], /group nope/);
});

test("speaker audio and recreated drives stay in range", () => {
  for (const e of data.library) assert.ok(peak(L.speaker(e)) <= 0.9 + 1e-6, e.id);
  const d = Float64Array.from({ length: GRID }, (_, i) => PREVIEW_PEAK * Math.sin(i / 3));
  const a = L.driveAudio(d);
  assert.equal(a.length, 16000); assert.ok(peak(a) <= 0.9 + 1e-6);
});

test("the export lists each waveform with its parameters and length", () => {
  const out = L.libraryJson(data.library.slice(0, 2), [{ id: "v:1", name: "Mine", source: "recording" }]);
  assert.equal(out.format, "haptography-library/1");
  assert.equal(out.waveforms.length, 3);
  assert.equal(out.waveforms[0].kind, data.library[0].kind);
  assert.ok(out.waveforms[0].seconds > 0);
});
