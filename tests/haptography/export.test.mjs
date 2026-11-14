// A take exported as a session folder (haptography/export.js) holds what recording/record.py
// writes for the same bytes, so `task process` reads it. The versioned Python export is
// compared file by file on the C encoder's fixture without any private checkout or Python dependency.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { decodeSession } from "../../haptography/session.js";
import * as X from "../../haptography/export.js";
import { ROOT, fixtureStream } from "./fixture.mjs";


const text = (x) => (typeof x === "string" ? x : new TextDecoder().decode(x));
const take = { created: "2026-11-13T21:30:05.000Z", dataset: "Desk", label: "Cork tile", notes: "n", setup: "", simulated: false, repetition: null, keep: true, spans: [{ t0: 1, t1: 2.5, label: "slide" }] };

test("the fixture's session files", () => {
  const raw = fixtureStream().bytes;
  const files = X.sessionFiles(raw, decodeSession(raw), take);
  assert.equal(files["raw.bin"], raw);
  const imu = text(files["imu.csv"]).split("\r\n");
  assert.equal(imu[0], "t_us,seq,gx,gy,gz,ax,ay,az");
  assert.equal(imu[3], "1001800,102,-200,-199,-198,2000,1999,1998");
  assert.equal(text(files["tof.csv"]).split("\r\n")[1], "1015000,812,0,3000,40,160");
  assert.equal(text(files["mic_blocks.csv"]).split("\r\n")[1], "1002000,16000,1012500,160");
  assert.equal(files["messages.txt"], "warning: ToF: no target\n");
  const wav = files["mic.wav"];
  assert.equal(text(wav.subarray(0, 4)), "RIFF");
  assert.equal(wav.length, 44 + 320);
  const info = JSON.parse(files["info.json"]);
  assert.equal(info.device.board_name, "D892");
  assert.deepEqual([info.packets, info.packets_lost, info.bad_packets], [8, 1, 2]);
  const labels = JSON.parse(files["labels.json"]);
  assert.equal(labels.label, "Cork tile");
  assert.deepEqual(labels.spans, [{ start_s: 1, end_s: 2.5, label: "slide" }]);
});

test("the same files as the versioned Python session export", () => {
  const { bytes } = fixtureStream();
  const out = join(ROOT, "tests/fixtures/capture/v5/session");
  const ours = X.sessionFiles(bytes, decodeSession(bytes), null);
  const theirs = readdirSync(out);
  for (const name of ["raw.bin", "imu.csv", "tof.csv", "mic.wav", "mic_blocks.csv", "messages.txt"]) {
    assert.ok(theirs.includes(name), `record.py wrote no ${name}`);
    const a = readFileSync(join(out, name));
    const b = typeof ours[name] === "string" ? Buffer.from(ours[name]) : Buffer.from(ours[name]);
    assert.ok(a.equals(b), `${name} differs from record.py's`);
  }
  // stats.csv and info.json: every column and key record.py writes, with the same values (the
  // page may know newer fields first, when the wire format grows)
  const rows = (csv) => csv.trimEnd().split("\r\n").map((r) => r.split(","));
  const [pyHead, ...pyRows] = rows(readFileSync(join(out, "stats.csv"), "utf8"));
  const [jsHead, ...jsRows] = rows(ours["stats.csv"]);
  pyHead.forEach((col, i) => {
    const j = jsHead.indexOf(col);
    assert.ok(j >= 0, `stats.csv: no ${col}`);
    pyRows.forEach((r, k) => assert.equal(jsRows[k][j], r[i], `stats.csv ${col}`));
  });
  const py = JSON.parse(readFileSync(join(out, "info.json"), "utf8"));
  const js = JSON.parse(ours["info.json"]);
  for (const key of ["packets", "packets_lost", "bad_packets", "written"]) assert.deepEqual(js[key], py[key], key);
  for (const [k, v] of Object.entries(py.device)) assert.deepEqual(js.device[k], v, `device.${k}`);
  for (const [k, v] of Object.entries(py.device_stats)) assert.deepEqual(js.device_stats[k], v, `device_stats.${k}`);
});

test("labels round trip through labels.json", () => {
  const json = JSON.parse(JSON.stringify(X.labelsJson(take, 91)));
  assert.equal(json.score, 91);
  assert.deepEqual(X.readLabels(json), { dataset: "Desk", label: "Cork tile", notes: "n", setup: "", simulated: false, repetition: null, keep: true, created: take.created, spans: take.spans });
  assert.deepEqual(X.readLabels({ spans: [{ start_s: "x" }] }).spans, []);
});

test("folder names", () => {
  const name = X.folderName(take);
  assert.match(name, /^\d{8}-\d{6}-cork-tile$/);
  assert.equal(X.timeFromFolderName(name), take.created);
  assert.equal(X.timeFromFolderName("notes"), null);
  assert.equal(X.slugify("Felt — coarse / 2"), "felt-coarse-2");
});

test("features.json carries the strokes' frequency features", () => {
  const summary = { strokes: [{ t0: 1, t1: 2, grain_mm: 1.2, vib_peak_hz: 200 }], fingerprint: { vib: { edges: [10, 20], db: [-40] } }, snr: { vib_db: 20 } };
  const files = X.sessionFiles(new Uint8Array(), { imu: { t_us: [] }, tof: { t_us: [] }, mic: { blocks: [] }, stats: [], messages: [], info: null }, take, {}, summary);
  const f = JSON.parse(files["features.json"]);
  assert.equal(f.strokes[0].grain_mm, 1.2);
  assert.equal(f.snr_db.vib_db, 20);
});

test("WAV header", () => {
  const w = X.wavBytes(Int16Array.of(1, -2), 16000);
  const v = new DataView(w.buffer);
  assert.deepEqual([v.getUint32(4, true), v.getUint32(24, true), v.getUint16(34, true), v.getInt16(46, true)], [40, 16000, 16, -2]);
});

test("import keeps raw data and labels together with or without relative paths", () => {
  const raw = { name: "raw.bin" }, labels = { name: "labels.json" };
  assert.deepEqual(X.sessionFolders([raw, labels]), [["", { "raw.bin": raw, "labels.json": labels }]]);
  const nested = [
    { name: "raw.bin", webkitRelativePath: "dataset/a/raw.bin" },
    { name: "labels.json", webkitRelativePath: "dataset/a/labels.json" },
    { name: "raw.bin", webkitRelativePath: "dataset/b/raw.bin" },
    { name: "dataset.json", webkitRelativePath: "dataset/dataset.json" },
  ];
  const groups = X.sessionFolders(nested);
  assert.deepEqual(groups.map(([dir]) => dir), ["dataset/a", "dataset/b"]);
  assert.equal(groups[0][1]["labels.json"], nested[1]);
  assert.equal(groups[1][1]["labels.json"], undefined);
});
