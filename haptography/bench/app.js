import { healthSummary, diagnostics, downloadDiagnostics, encodeProfile } from "./device-health.js";
import { bindProfileEditor } from "./profile-view.js";
// Haptography: record surface textures from the recording device (nrf-controller's capture/
// build) over Web Serial, keep them labelled in a library in this browser, replay them, and score
// each take and each dataset. The pure parts are wire.js, session.js, analysis.js, export.js and
// simulate.js (Node-tested in tests/haptography/); this file is the page.

import * as wire from "./wire.js";
import { CMD, HapticDevice, openBoardPort } from "./device.js";
import { textureDrive } from "./haptics.js";
import { decodeSession } from "./session.js";
import { analyze, scoreTake, scoreDataset, ANALYSIS_VERSION, SETTINGS, spectraBetween, principalAxis, project } from "./analysis.js";
import { spectrogram, welch, peakFrequency } from "./spectrum.js";
import { sessionFiles, folderName, slugify, readLabels, timeFromFolderName, sessionFolders } from "./export.js";
import { Simulator } from "./simulate.js";
import { openStore } from "./storage.js";
import { Plot, XYPlot, readColors, drawAxis, fmtHz } from "./plots.js";

const $ = (id) => document.getElementById(id);
const LIVE_WINDOW_S = 5;
const SPOOL_EVERY_MS = 2000;
const ALL = "\u0000all";

let colors = readColors();
let store = null;
let hapticDevice = null;
let convertedDrive = null;
let hapticBusy = false;
let hapticFault = null;

// ---- Theme ------------------------------------------------------------------------------

const darkQuery = matchMedia("(prefers-color-scheme: dark)");
function effectiveTheme() {
  return document.documentElement.dataset.theme ?? (darkQuery.matches ? "dark" : "light");
}
function themeChanged() {
  colors = readColors();
  document.querySelector('meta[name="theme-color"]').content = getComputedStyle(document.documentElement).getPropertyValue("--panel").trim();
  $("theme").setAttribute("aria-checked", String(effectiveTheme() === "dark"));
  dirty = true;
}
$("theme").addEventListener("click", () => {
  const next = effectiveTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("theme", next);
  } catch {
    /* storage blocked: the choice lasts for this page load */
  }
  themeChanged();
});
darkQuery.addEventListener("change", themeChanged);

// ---- Info popovers: placed under their key ------------------------------------------------

for (const pop of document.querySelectorAll(".info-pop")) {
  const key = document.querySelector(`[popovertarget="${pop.id}"]`);
  pop.addEventListener("toggle", (event) => {
    const open = event.newState === "open";
    pop.classList.toggle("placed", false);
    if (!open || !key) return;
    const r = key.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left - 12, innerWidth - pop.offsetWidth - 8));
    let top = r.bottom + 6;
    if (top + pop.offsetHeight > innerHeight - 8) top = Math.max(8, r.top - pop.offsetHeight - 6);
    Object.assign(pop.style, { top: `${top}px`, left: `${left}px` });
    pop.classList.add("placed");
  });
}

// ---- Small helpers ------------------------------------------------------------------------

function remember(key, value) {
  try {
    localStorage.setItem(`haptography.${key}`, value);
  } catch {
    /* storage blocked: forget it */
  }
}
function recall(key) {
  try {
    return localStorage.getItem(`haptography.${key}`) ?? "";
  } catch {
    return "";
  }
}
const hex4 = (n) => n.toString(16).toUpperCase().padStart(4, "0");
const fmtInt = (n) => Math.round(n).toLocaleString("en-US");
const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fmtDate = (iso) => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
const fmtMB = (n) => `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB`;
const newId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
function setStatus(id, text, kind = "") {
  const el = $(id);
  el.textContent = text;
  el.className = `status-line ${kind}`;
}

// A growable ring of recent values, `width` per row, read back in order.
class Ring {
  constructor(rows, width = 1, Type = Float32Array) {
    this.rows = rows;
    this.width = width;
    this.data = new Type(rows * width);
    this.Type = Type;
    this.clear();
  }
  clear() {
    this.head = 0;
    this.length = 0;
    this.cache = null;
  }
  push(...values) {
    this.data.set(values, this.head * this.width);
    this.head = (this.head + 1) % this.rows;
    this.length = Math.min(this.rows, this.length + 1);
    this.cache = null;
  }
  last(k = 0) {
    if (!this.length) return undefined;
    return this.data[((this.head - 1 + this.rows) % this.rows) * this.width + k];
  }
  view() {
    if (this.cache) return this.cache;
    const out = new this.Type(this.length * this.width);
    const start = (this.head - this.length + this.rows) % this.rows;
    const first = Math.min(this.length, this.rows - start);
    out.set(this.data.subarray(start * this.width, (start + first) * this.width));
    if (first < this.length) out.set(this.data.subarray(0, (this.length - first) * this.width), first * this.width);
    return (this.cache = out);
  }
}

// ---- Live stream --------------------------------------------------------------------------

const imuRows = 1700 * (LIVE_WINDOW_S + 1);
const live = {
  reader: new wire.StreamReader(),
  imuT: new Ring(imuRows, 1, Float64Array),
  vib: new Ring(imuRows, 3),
  accel: new Ring(imuRows, 3),
  gyro: new Ring(imuRows, 3),
  mic: new Ring(16000 * (LIVE_WINDOW_S + 1)),
  micEnd: null, // board time (s) just after the last mic sample
  micRate: 16000,
  tofT: new Ring(500, 1, Float64Array),
  tofD: new Ring(500),
  tofOk: new Ring(500, 1, Uint8Array),
  speedT: new Ring(500, 1, Float64Array),
  speed: new Ring(500),
  lp: null, // the vibration filter's low-pass state per axis
  lastImuT: null,
  info: null,
  firstStats: null,
  lastStats: null,
  lastTof: null,
  counts: { imu: 0, mic: 0, tof: 0 },
  prevCounts: { imu: 0, mic: 0, tof: 0 },
  changed: false,
};

function resetLive() {
  live.reader = new wire.StreamReader();
  for (const k of ["imuT", "vib", "accel", "gyro", "mic", "tofT", "tofD", "tofOk", "speedT", "speed"]) live[k].clear();
  Object.assign(live, { micEnd: null, lp: null, lastImuT: null, info: null, firstStats: null, lastStats: null, lastTof: null, health: null, profile: null, healthReceivedMs: null });
  live.counts = { imu: 0, mic: 0, tof: 0 };
  live.prevCounts = { imu: 0, mic: 0, tof: 0 };
  $("messages").replaceChildren();
  updateLamps();
  updateMeters();
}

function stopFault(message) {
  if (!hapticBusy || hapticFault) return;
  hapticFault = message;
  hapticDevice?.stop().catch(() => {}).finally(updateHaptics);
}
function onBytes(bytes) {
  const priorLost = live.reader.lost, priorBad = live.reader.bad;
  if (rec) {
    rec.chunks.push(bytes.slice());
    rec.pending.push(bytes.slice());
    rec.bytes += bytes.length;
  }
  for (const packet of live.reader.feed(bytes)) handlePacket(packet);
  if (live.reader.lost > priorLost || live.reader.bad > priorBad) stopFault("Stopped: lost or corrupt stream packets.");
  live.changed = true;
}

function handlePacket(packet) {
  hapticDevice?.accept(packet);
  const { type, body } = packet;
  switch (type) {
    case wire.HEALTH: live.health = body; live.healthReceivedMs = performance.now(); break;
    case wire.PROFILE: live.profile = body; break;
    case wire.INFO:
      live.info = body;
      updateHaptics();
      updateLamps();
      break;
    case wire.IMU:
      liveImu(body);
      break;
    case wire.MIC: {
      live.micRate = live.info?.mic_rate_hz || 16000;
      for (const s of body.samples) live.mic.push(s / 32768);
      live.micEnd = body.t0_us * 1e-6 + body.samples.length / live.micRate;
      live.counts.mic += body.samples.length;
      break;
    }
    case wire.TOF:
      liveTof(body);
      break;
    case wire.STATS:
      if (["imu_dropped", "mic_errors", "tof_errors", "tx_dropped", "rx_bad", "haptic_errors"].some(k => body[k] > (live.lastStats?.[k] ?? body[k]))) stopFault("Stopped: the board reported a sensor or playback error.");
      live.firstStats ??= body;
      live.lastStats = body;
      break;
    case wire.TEXT:
      addMessage(["info", "warning", "error"][Math.min(body.level, 2)], body.text);
      break;
    case wire.PLAYBACK:
      addMessage(body.outcome === 2 ? "error" : "info",
        `Played ${wire.PLAYBACK_KINDS[body.kind] ?? "something"} ${body.id} at ${body.level_percent}%: ` +
        `${wire.PLAYBACK_OUTCOMES[body.outcome] ?? "?"}, ${((body.end_us - body.start_us) / 1000).toFixed(0)} ms`);
      break;
  }
}

function liveImu(b) {
  const gs = live.info?.gyro_dps_per_lsb || 0.07;
  const as = live.info?.accel_g_per_lsb || 0.000244;
  for (let i = 0; i < b.seq.length; i++) {
    const t = b.t_us[i] * 1e-6;
    const a = b.accel[i].map((x) => x * as);
    const g = b.gyro[i].map((x) => x * gs);
    if (!live.lp) live.lp = a.slice();
    const dt = live.lastImuT === null ? 0 : Math.max(0, t - live.lastImuT);
    const k = 1 - Math.exp(-2 * Math.PI * SETTINGS.highPassHz * dt);
    const v = a.map((x, c) => {
      live.lp[c] += k * (x - live.lp[c]);
      return x - live.lp[c];
    });
    live.lastImuT = t;
    live.imuT.push(t);
    live.vib.push(...v);
    live.accel.push(...a);
    live.gyro.push(...g);
    if (rec) feedStill(t, g, a);
  }
  live.counts.imu += b.seq.length;
}

function liveTof(b) {
  const t = b.t_us * 1e-6;
  const ok = b.status === 0;
  live.tofT.push(t);
  live.tofD.push(ok ? b.distance_mm : NaN);
  live.tofOk.push(ok ? 1 : 0);
  live.lastTof = b;
  live.counts.tof++;
  // Speed: a line through the last window of good readings (ending now, so it lags by half)
  const T = live.tofT.view(), D = live.tofD.view();
  let n = 0, st = 0, sd = 0;
  for (let i = T.length - 1; i >= 0 && T[i] > t - SETTINGS.speedWindowS; i--) {
    if (Number.isFinite(D[i])) { n++; st += T[i]; sd += D[i]; }
  }
  let v = NaN;
  if (n >= SETTINGS.minFitPoints) {
    const mt = st / n, md = sd / n;
    let sxx = 0, sxy = 0;
    for (let i = T.length - 1; i >= 0 && T[i] > t - SETTINGS.speedWindowS; i--) {
      if (!Number.isFinite(D[i])) continue;
      sxx += (T[i] - mt) ** 2;
      sxy += (T[i] - mt) * (D[i] - md);
    }
    if (sxx > 0) v = sxy / sxx;
  }
  live.speedT.push(t - SETTINGS.speedWindowS / 2);
  live.speed.push(v);
}

function addMessage(level, text) {
  const li = document.createElement("li");
  li.className = level;
  li.textContent = text;
  const log = $("messages");
  log.append(li);
  while (log.children.length > 60) log.firstElementChild.remove();
  log.scrollTop = log.scrollHeight;
}

function lamp(id, on, title) {
  const el = $(id);
  el.classList.toggle("on", on === true);
  el.classList.toggle("fail", on === false);
  if (title) el.title = title;
}

function updateLamps() {
  const info = live.info;
  const f = info?.flags;
  const known = info != null;
  lamp("s-imu", known ? Boolean(f & wire.INFO_IMU_OK) : null);
  lamp("s-mic", known ? Boolean(f & wire.INFO_MIC_OK) : null);
  lamp("s-tof", known ? Boolean(f & wire.INFO_TOF_OK) : null);
  // Actuators are optional on a recording device: one that didn't answer stays dark, not red
  lamp("s-tach", known && f & wire.INFO_TACHAMMER_OK ? true : null, "Drake audio stream ready (the board cannot detect the physical amplifier)");
  lamp("s-erm", known && f & wire.INFO_ERM_OK ? true : null, "ERM, through the DRV2605L (lit when it answered at boot)");
  $("m-board").textContent = known ? hex4(info.board_id) : "—";
  if (known && info.version > wire.VERSION) {
    $("link-lamp").textContent = `Firmware v${info.version}: update the page`;
  }
}

function updateMeters() {
  const c = live.counts, p = live.prevCounts;
  const on = Boolean(source);
  $("m-imu").textContent = on ? fmtInt(c.imu - p.imu) : "—";
  $("m-mic").textContent = on ? fmtInt(c.mic - p.mic) : "—";
  $("m-tof").textContent = on ? fmtInt(c.tof - p.tof) : "—";
  live.measuredImuHz = c.imu - p.imu;
  live.prevCounts = { ...c };
  const tof = live.lastTof;
  const dist = $("m-dist");
  dist.textContent = !on || !tof ? "—" : tof.status === 0 ? `${tof.distance_mm} mm` : `status ${tof.status}`;
  dist.classList.toggle("bad", Boolean(on && tof && tof.status !== 0));
  const dropped = live.lastStats && live.firstStats ? live.lastStats.tx_dropped - live.firstStats.tx_dropped : 0;
  for (const [id, n] of [["m-lost", live.reader.lost], ["m-bad", live.reader.bad], ["m-drop", dropped]]) {
    $(id).textContent = on ? fmtInt(n) : "—";
    $(id).classList.toggle("bad", on && n > 0);
  }
}
setInterval(() => { updateMeters(); renderDeviceHealth(); }, 1000);

// ---- Sources: the serial port, or the demo ------------------------------------------------

let source = null; // {kind: "serial" | "demo", stop()}
let sim = null;

function demoWavelength(label) {
  // Each surface name gets its own grain in the demo, so labels sound and score differently
  let h = 0;
  for (const ch of label) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return 0.6 + (h % 1000) / 400;
}

function startDemo() {
  sim = new Simulator({ seed: (Date.now() % 100000) + 1, wavelengthMm: demoWavelength($("rec-label").value) });
  const timer = setInterval(() => onBytes(sim.next(50)), 50);
  source = { kind: "demo", stop: () => clearInterval(timer) };
  resetLive();
  sourceChanged();
}

async function connectSerial() {
  let port;
  try {
    port = await openBoardPort(navigator.serial);
  } catch (err) {
    if (err.name !== "NotFoundError") setStatus("rec-status", `Couldn't open the port: ${err.message}`, "bad");
    return;
  }
  const reader = port.readable.getReader();
  const writer = port.writable.getWriter();
  hapticDevice = new HapticDevice(bytes => writer.write(bytes));
  let stopping = false;
  source = {
    kind: "serial",
    stop: async () => {
      if (hapticDevice) await hapticDevice.stop().catch(() => {});
      stopping = true;
      await reader.cancel().catch(() => {});
    },
  };
  resetLive();
  sourceChanged();
  setStatus("rec-status", "Connected: waiting for the board's stream…");
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value?.length) onBytes(value);
    }
  } catch (err) {
    if (!stopping) setStatus("rec-status", `The port closed: ${err.message}`, "bad");
  } finally {
    hapticDevice?.close();
    hapticDevice = null;
    reader.releaseLock();
    writer.releaseLock();
    await port.close().catch(() => {});
    if (source?.kind === "serial") {
      source = null;
      if (rec) await stopRecording("the board was disconnected");
      sourceChanged();
    }
  }
}

async function stopSource() {
  const s = source;
  if (!s) return;
  if (rec) await stopRecording();
  source = null;
  await s.stop();
  sourceChanged();
}

function sourceChanged() {
  updateHaptics();
  const kind = source?.kind;
  $("connect").textContent = kind === "serial" ? "Disconnect" : "Connect board";
  $("connect").disabled = kind === "demo" || !("serial" in navigator);
  $("demo").textContent = kind === "demo" ? "Stop demo" : "Demo";
  $("demo").disabled = kind === "serial";
  $("record").disabled = !source;
  // The one orange key is the next thing to press: Connect, then Record
  $("connect").classList.toggle("primary", !source);
  $("record").classList.toggle("primary", Boolean(source));
  const lampEl = $("link-lamp");
  lampEl.classList.toggle("on", Boolean(source));
  lampEl.textContent = kind === "serial" ? "Connected" : kind === "demo" ? "Demo" : "Not connected";
  if (!source) setStatus("rec-status", "serial" in navigator ? "" : "Web Serial needs Chrome or Edge on a computer; the Demo works anywhere.");
  updateMeters();
  updateEmpty();
  dirty = true;
}

$("connect").addEventListener("click", () => (source ? stopSource() : connectSerial()));
$("demo").addEventListener("click", () => (source ? stopSource() : startDemo()));

// ---- Recording ----------------------------------------------------------------------------

let rec = null;
let storageError = false;

function recMeta() {
  return {
    dataset: $("rec-dataset").value.trim(),
    label: $("rec-label").value.trim(),
    notes: $("rec-notes").value.trim(),
  };
}

function startRecording() {
  if (!source || rec || hapticBusy) return;
  stopAudio();
  if (source.kind === "demo") {
    // A fresh simulated take: still for 5 s from now, over this surface's grain
    source.stop();
    startDemo();
  }
  rec = {
    id: newId(),
    created: new Date().toISOString(),
    meta: recMeta(),
    chunks: [],
    pending: [],
    bytes: 0,
    spoolN: 0,
    startMs: performance.now(),
    still: { t0: null, n: 0, sums: new Float64Array(12), run: 0, done: false, brokeAt: null, first: null },
  };
  updateHaptics();
  rec.spoolTimer = setInterval(spool, SPOOL_EVERY_MS);
  $("record").textContent = "Stop";
  $("record").classList.add("recording");
  for (const id of ["rec-dataset", "rec-label", "rec-notes"]) $(id).disabled = true;
  setMode("live");
}

// Coach the still start: VQF needs ~4 s at rest to learn the gyro's bias.
function feedStill(t, g, a) {
  const s = rec.still;
  s.first ??= t;
  if (s.done || s.brokeAt !== null) return;
  if (s.t0 === null) s.t0 = t;
  for (let c = 0; c < 3; c++) {
    s.sums[c] += g[c]; s.sums[3 + c] += g[c] * g[c];
    s.sums[6 + c] += a[c]; s.sums[9 + c] += a[c] * a[c];
  }
  s.n++;
  if (t - s.t0 < SETTINGS.stillWindowS) return;
  const spread = (k) => {
    let v = 0;
    for (let c = 0; c < 3; c++) v += Math.max(0, s.sums[k + 3 + c] / s.n - (s.sums[k + c] / s.n) ** 2);
    return Math.sqrt(v);
  };
  const still = spread(0) < SETTINGS.stillGyroDps && spread(6) < SETTINGS.stillAccelG;
  if (still) {
    s.run = t - s.first;
    if (s.run >= SETTINGS.stillNeededS) s.done = true;
  } else {
    s.brokeAt = t - s.first;
  }
  s.t0 = null;
  s.n = 0;
  s.sums.fill(0);
}

function updateRecording() {
  if (!rec) return;
  const elapsed = (performance.now() - rec.startMs) / 1000;
  $("rec-elapsed").textContent = `${elapsed.toFixed(1)} s`;
  const s = rec.still;
  if (s.first === null) {
    setStatus("rec-status", elapsed > 2 ? "No IMU samples are arriving." : "Hold still…", elapsed > 2 ? "bad" : "");
  } else if (s.done) {
    setStatus("rec-status", `Still for ${SETTINGS.stillNeededS} s: now slide toward and away from the wall, slow and fast.`, "go");
  } else if (s.brokeAt !== null) {
    setStatus("rec-status", `Moved after ${s.brokeAt.toFixed(1)} s: the take needs ${SETTINGS.stillNeededS} s still at the start (Stop and record again, or carry on).`, "bad");
  } else {
    setStatus("rec-status", `Hold still… ${Math.max(0, SETTINGS.stillNeededS - s.run).toFixed(1)} s`);
  }
  const limit = Number($("rec-limit").value);
  if (limit && elapsed >= limit) stopRecording();
}
setInterval(updateRecording, 100);

function concat(chunks) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

async function spool() {
  if (!rec || !rec.pending.length) return;
  const r = rec;
  const bytes = concat(r.pending);
  r.pending = [];
  const n = r.spoolN++;
  try {
    await store.spoolAppend(r.id, n, bytes, n === 0 ? { ...r.meta, created: r.created } : undefined);
    storageError = false;
  } catch {
    storageError = true;
    /* the spool is a safety net only: the recording itself is in memory */
  }
}

async function stopRecording(why) {
  const r = rec;
  if (!r) return;
  rec = null;
  updateHaptics();
  clearInterval(r.spoolTimer);
  $("record").textContent = "Record";
  $("record").classList.remove("recording");
  for (const id of ["rec-dataset", "rec-label", "rec-notes"]) $(id).disabled = false;
  const bytes = concat(r.chunks);
  if (!bytes.length) {
    setStatus("rec-status", "Nothing arrived from the board: no take saved.", "bad");
    await store.spoolClear(r.id).catch(() => {});
    return;
  }
  setStatus("rec-status", "Scoring the take…");
  await new Promise((resolve) => setTimeout(resolve)); // let the status paint
  const meta = await saveTake(bytes, { id: r.id, created: r.created, ...r.meta, keep: true, spans: [] });
  await store.spoolClear(r.id).catch(() => {});
  const score = scoreTake(meta.summary);
  setStatus("rec-status", `${why ? `Stopped: ${why}. ` : ""}Saved ${meta.label || "the take"}: ${score.score} (${score.grade}).`, score.grade === "poor" ? "bad" : "go");
  select(meta.id);
}

$("record").addEventListener("click", () => (rec ? stopRecording() : startRecording()));
for (const id of ["rec-dataset", "rec-label", "rec-notes"]) {
  $(id).value = recall(id);
  $(id).addEventListener("change", () => remember(id, $(id).value));
}
addEventListener("beforeunload", (event) => {
  if (rec) event.preventDefault();
});

// ---- Library ------------------------------------------------------------------------------

const takes = new Map(); // id -> take: {id, created, dataset, label, notes, keep, spans, bytes, seconds, board, summary}
let selectedId = null;
let loaded = null; // the selected take decoded: {id, session, analysis}

/** Decode and analyse a take's bytes, save both, and keep it loaded. */
async function saveTake(bytes, base) {
  const session = decodeSession(bytes);
  const analysis = analyze(session);
  const meta = {
    ...base,
    bytes: bytes.length,
    seconds: analysis.summary.seconds,
    board: analysis.summary.board,
    summary: analysis.summary,
  };
  await store.putRaw(meta.id, bytes);
  await store.putTake(meta);
  takes.set(meta.id, meta);
  loaded = { id: meta.id, session, analysis };
  audioBuffers = {};
  renderLibrary();
  return meta;
}

async function updateTake(id, changes) {
  const meta = { ...takes.get(id), ...changes };
  takes.set(id, meta);
  await store.putTake(meta);
  renderLibrary();
  renderScore();
}

function datasetNames() {
  return [...new Set([...takes.values()].map((t) => t.dataset ?? ""))].sort((a, b) => a.localeCompare(b));
}

function renderDatalists() {
  const fill = (id, values) => $(id).replaceChildren(...values.filter(Boolean).map((v) => Object.assign(document.createElement("option"), { value: v })));
  fill("dataset-names", datasetNames());
  fill("label-names", [...new Set([...takes.values()].map((t) => t.label))].sort());
}

function renderDatasetFilter() {
  const sel = $("lib-dataset");
  const current = sel.value || recall("library") || ALL;
  const names = datasetNames();
  sel.replaceChildren(
    Object.assign(document.createElement("option"), { value: ALL, textContent: "All datasets" }),
    ...names.map((n) => Object.assign(document.createElement("option"), { value: n, textContent: n || "(no dataset)" })),
  );
  sel.value = current === ALL || names.includes(current) ? current : ALL;
}

function visibleTakes() {
  const filter = $("lib-dataset").value;
  return [...takes.values()]
    .filter((t) => filter === ALL || (t.dataset ?? "") === filter)
    .sort((a, b) => b.created.localeCompare(a.created));
}

function renderLibrary() {
  renderDatasetFilter();
  renderDatalists();
  const list = $("takes");
  const items = [];
  const filter = $("lib-dataset").value;
  let group = null;
  const shown = visibleTakes();
  if (filter === ALL) shown.sort((a, b) => (a.dataset ?? "").localeCompare(b.dataset ?? "") || b.created.localeCompare(a.created));
  for (const t of shown) {
    if (filter === ALL && t.dataset !== group) {
      group = t.dataset;
      items.push(Object.assign(document.createElement("li"), { className: "group", textContent: group || "(no dataset)" }));
    }
    const s = scoreTake(t.summary);
    const li = document.createElement("li");
    li.className = `take${t.id === selectedId ? " selected" : ""}${t.keep === false ? " rejected" : ""}`;
    li.dataset.id = t.id;
    li.tabIndex = 0;
    li.title = `${fmtDate(t.created)} · ${t.notes || "no notes"}`;
    const time = Object.assign(document.createElement("time"), { dateTime: t.created, textContent: fmtTime(t.created) });
    const label = Object.assign(document.createElement("span"), { className: "label", textContent: t.label || "(unlabelled)" });
    const dur = Object.assign(document.createElement("span"), { className: "dur", textContent: `${t.seconds.toFixed(0)} s` });
    const badge = Object.assign(document.createElement("span"), { className: `badge ${s.grade}`, textContent: s.score });
    li.append(time, label, dur, badge);
    items.push(li);
  }
  list.replaceChildren(...items);
  const has = selectedId !== null && takes.has(selectedId);
  $("export-take").disabled = !has;
  $("delete-take").disabled = !has;
  $("export-dataset").disabled = !datasetTakes().length;
}

$("takes").addEventListener("click", (event) => {
  const li = event.target.closest(".take");
  if (li) select(li.dataset.id, { replay: !rec });
});
$("takes").addEventListener("keydown", (event) => {
  const li = event.target.closest(".take");
  if (li && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    select(li.dataset.id, { replay: !rec });
  }
});
$("lib-dataset").addEventListener("change", () => {
  remember("library", $("lib-dataset").value);
  renderLibrary();
  renderScore();
});

async function select(id, { replay = false } = {}) {
  selectedId = takes.has(id) ? id : null;
  selection = null;
  convertedDrive = null;
  updateHaptics();
  renderLibrary();
  renderScore();
  if (selectedId && (!loaded || loaded.id !== selectedId)) {
    stopAudio();
    const raw = await store.getRaw(selectedId);
    if (raw && selectedId === id) {
      const session = decodeSession(raw);
      loaded = { id, session, analysis: analyze(session) };
      audioBuffers = {};
    }
  }
  if (loaded?.id === selectedId) fitView();
  updateHaptics();
  if (replay && mode === "spectrum") spectrumOf = "take";
  else if (replay) setMode("replay");
  updateEmpty();
  dirty = true;
}

$("delete-take").addEventListener("click", async () => {
  const t = takes.get(selectedId);
  if (!t) return;
  if (!confirm(`Delete “${t.label || "(unlabelled)"}” from ${fmtDate(t.created)}? Its recording goes too: export it first to keep a copy.`)) return;
  await store.deleteTake(t.id);
  takes.delete(t.id);
  if (loaded?.id === t.id) loaded = null;
  stopAudio();
  select(null);
});

// ---- Convert a selected take into a bounded Drake preview ---------------------------------
function updateHaptics() {
  const hasTake = Boolean(loaded && loaded.id === selectedId);
  const busy = hapticBusy || Boolean(hapticDevice?.stopping);
  $("convert-drive").disabled = !hasTake || busy || Boolean(rec);
  $("save-drive").disabled = !convertedDrive || busy;
  $("play-drive").disabled = !convertedDrive || !hapticDevice || !(live.info?.flags & wire.INFO_TACHAMMER_OK) || busy || Boolean(rec);
  $("stop-drive").disabled = !hapticDevice || !busy;
  $("haptic-level").disabled = busy;
  if (source) $("record").disabled = busy;
}
$("convert-drive").addEventListener("click", () => {
  try {
    const a = loaded.analysis;
    const start = selection ? selection[0] : Math.max(0, a.imu.t[0]);
    const end = selection ? selection[1] : Math.min(a.imu.t.at(-1), start + 5.98);
    convertedDrive = textureDrive(a, start, end, Number($("haptic-level").value));
    convertedDrive.manifest.take_id = loaded.id;
    setStatus("haptic-status", `Ready: ${start.toFixed(2)}–${end.toFixed(2)} s at up to ${convertedDrive.manifest.level_percent}%. Normalised texture preview; no actuator calibration.`, "go");
  } catch (err) { convertedDrive = null; setStatus("haptic-status", err.message, "bad"); }
  updateHaptics();
});
$("haptic-level").addEventListener("input", () => { convertedDrive = null; updateHaptics(); setStatus("haptic-status", "Convert again to apply the new level."); });
$("save-drive").addEventListener("click", async () => {
  const drive = convertedDrive;
  if (!drive) return;
  try {
    const dir = await pickFolder();
    if (!dir) return;
    await writeFolder(dir, `haptic-${Date.now()}`, { "drive.wav": drive.wav, "drive.json": JSON.stringify(drive.manifest, null, 2) + "\n" });
    setStatus("haptic-status", "Saved drive.wav and drive.json. The level is included in the WAV; replay at 100%.", "go");
  } catch (err) { setStatus("haptic-status", `Save failed: ${err.message}`, "bad"); }
});
$("play-drive").addEventListener("click", async () => {
  if (!convertedDrive || !hapticDevice || hapticBusy || rec) return;
  const device = hapticDevice, drive = convertedDrive;
  hapticFault = null;
  hapticBusy = true; updateHaptics(); stopAudio();
  try {
    const before = { lost: live.reader.lost, bad: live.reader.bad, stats: live.lastStats };
    const played = await device.play(drive.samples, live.info, fraction => setStatus("haptic-status", fraction === 1 ? "Playing on Drake…" : `Uploading: ${Math.round(fraction * 100)}%`));
    const keys = ["imu_dropped", "mic_errors", "tof_errors", "tx_dropped", "rx_bad", "haptic_errors"];
    if (live.reader.lost !== before.lost || live.reader.bad !== before.bad || keys.some(k => (live.lastStats?.[k] ?? 0) > (before.stats?.[k] ?? 0))) throw Error("Playback finished, but the stream reported an error; inspect the recording before continuing.");
    drive.manifest.last_playback = played;
    setStatus("haptic-status", `Drake playback complete (${(played.frames / 16000).toFixed(2)} s). Stopped.`, "go");
  } catch (err) { setStatus("haptic-status", hapticFault || err.message, "bad"); }
  finally { hapticBusy = false; updateHaptics(); }
});
$("stop-drive").addEventListener("click", async () => {
  try { await hapticDevice?.stop(); setStatus("haptic-status", "Drake stopped."); }
  catch (err) { setStatus("haptic-status", err.message, "bad"); }
  finally { updateHaptics(); }
});

// ---- Export and import --------------------------------------------------------------------

async function pickFolder() {
  if (!window.showDirectoryPicker) {
    setStatus("lib-status", "Exporting needs Chrome or Edge on a computer.", "bad");
    return null;
  }
  try {
    return await window.showDirectoryPicker({ id: "haptography", mode: "readwrite" });
  } catch {
    return null;
  }
}

async function writeFolder(parent, name, files) {
  const dir = await parent.getDirectoryHandle(name, { create: true });
  for (const [file, data] of Object.entries(files)) {
    const handle = await dir.getFileHandle(file, { create: true });
    const w = await handle.createWritable();
    await w.write(data);
    await w.close();
  }
}

async function exportTake(parent, t) {
  const raw = await store.getRaw(t.id);
  const session = decodeSession(raw);
  const files = sessionFiles(raw, session, t, {
    started: t.created,
    seconds: Math.round(t.seconds * 10) / 10,
    recorded_with: "haptography",
    score: scoreTake(t.summary).score,
  }, t.summary);
  const name = folderName(t);
  await writeFolder(parent, name, files);
  return name;
}

$("export-take").addEventListener("click", async () => {
  const t = takes.get(selectedId);
  const dir = t && (await pickFolder());
  if (!dir) return;
  try {
    const name = await exportTake(dir, t);
    setStatus("lib-status", `Exported ${name}/ into ${dir.name}/.`, "go");
  } catch (err) {
    setStatus("lib-status", `Export failed: ${err.message}`, "bad");
  }
});

function datasetTakes() {
  const name = currentDataset();
  return [...takes.values()].filter((t) => name === ALL || (t.dataset ?? "") === name);
}

$("export-dataset").addEventListener("click", async () => {
  const list = datasetTakes();
  const dir = list.length && (await pickFolder());
  if (!dir) return;
  const name = currentDataset();
  const folder = slugify(name === ALL ? "all-datasets" : name || "no-dataset") || "dataset";
  try {
    const parent = await dir.getDirectoryHandle(folder, { create: true });
    const index = [];
    for (const [i, t] of list.entries()) {
      setStatus("lib-status", `Exporting ${i + 1} of ${list.length}…`);
      index.push({ folder: await exportTake(parent, t), label: t.label, keep: t.keep !== false, score: scoreTake(t.summary).score });
    }
    const handle = await parent.getFileHandle("dataset.json", { create: true });
    const w = await handle.createWritable();
    await w.write(JSON.stringify({ format: "haptography-dataset/1", name: name === ALL ? null : name, exported: new Date().toISOString(), score: scoreDataset(list), takes: index }, null, 2) + "\n");
    await w.close();
    setStatus("lib-status", `Exported ${list.length} takes into ${dir.name}/${folder}/.`, "go");
  } catch (err) {
    setStatus("lib-status", `Export failed: ${err.message}`, "bad");
  }
});

$("import").addEventListener("click", () => $("import-input").click());
$("import-input").addEventListener("change", async (event) => {
  const files = [...event.target.files];
  event.target.value = "";
  const found = sessionFolders(files);
  if (!found.length) {
    setStatus("lib-status", "No raw.bin in that folder: pick a session folder, or a folder of them.", "bad");
    return;
  }
  let imported = 0, skipped = 0;
  for (const [dir, f] of found) {
    setStatus("lib-status", `Importing ${imported + skipped + 1} of ${found.length}…`);
    const parts = dir.split("/");
    const labels = f["labels.json"] ? readLabels(JSON.parse(await f["labels.json"].text())) : readLabels({});
    const created = labels.created || timeFromFolderName(parts.at(-1)) || new Date(f["raw.bin"].lastModified).toISOString();
    const bytes = new Uint8Array(await f["raw.bin"].arrayBuffer());
    if ([...takes.values()].some((t) => t.created === created && t.bytes === bytes.length)) {
      skipped++;
      continue;
    }
    // Takes in a folder of folders, with no dataset of their own, take the folder's name
    const dataset = labels.dataset || (parts.length > 1 ? parts.at(-2) : "");
    await saveTake(bytes, { id: newId(), created, dataset, label: labels.label, notes: labels.notes, keep: labels.keep, spans: labels.spans });
    imported++;
  }
  setStatus("lib-status", `Imported ${imported} take${imported === 1 ? "" : "s"}${skipped ? `, ${skipped} already here` : ""}.`, "go");
  renderScore();
});

// ---- Recovering a recording the page didn't get to save ------------------------------------

let unsaved = [];
function showRecover() {
  const u = unsaved[0];
  $("recover").hidden = !u;
  if (!u) return;
  const when = u.meta?.created ? fmtDate(u.meta.created) : "an earlier visit";
  $("recover-text").textContent = `A recording from ${when} (${fmtMB(u.bytes.length)}${u.meta?.label ? `, ${u.meta.label}` : ""}) wasn't saved: the page closed while it ran.`;
}
$("recover-save").addEventListener("click", async () => {
  const u = unsaved.shift();
  if (!u) return;
  const meta = await saveTake(u.bytes, {
    id: u.take, created: u.meta?.created ?? new Date().toISOString(), dataset: u.meta?.dataset ?? "",
    label: u.meta?.label ?? "", notes: u.meta?.notes ?? "", keep: true, spans: [],
  });
  await store.spoolClear(u.take);
  showRecover();
  select(meta.id);
});
$("recover-discard").addEventListener("click", async () => {
  const u = unsaved.shift();
  if (u) await store.spoolClear(u.take);
  showRecover();
});

// ---- Score --------------------------------------------------------------------------------

function currentDataset() {
  const filter = $("lib-dataset").value;
  if (filter && filter !== ALL) return filter;
  const t = takes.get(selectedId);
  return t ? t.dataset ?? "" : ALL;
}

function renderScore() {
  const t = takes.get(selectedId);
  $("take-none").hidden = Boolean(t);
  $("take-panel").hidden = !t;
  if (t) {
    const s = scoreTake(t.summary);
    const badge = $("take-score");
    badge.textContent = s.score;
    badge.className = `badge big ${s.grade}`;
    $("take-title").textContent = t.label || "(unlabelled)";
    $("take-sub").textContent = `${fmtDate(t.created)} · ${t.seconds.toFixed(1)} s · board ${t.board ?? "?"} · ${fmtMB(t.bytes)}`;
    $("checks").replaceChildren(...s.checks.map((c) => {
      const li = document.createElement("li");
      li.className = c.status;
      li.append(
        Object.assign(document.createElement("span"), { textContent: c.name }),
        Object.assign(document.createElement("span"), { className: "pts", textContent: c.max ? `${c.points}/${c.max}` : "" }),
        Object.assign(document.createElement("span"), { className: "detail", textContent: c.detail }),
      );
      return li;
    }));
    for (const [id, key] of [["take-dataset", "dataset"], ["take-label", "label"], ["take-notes", "notes"]]) {
      if (document.activeElement !== $(id)) $(id).value = t[key] ?? "";
    }
    $("take-keep").checked = t.keep !== false;
    renderSpans(t);
  }
  renderDataset();
}

function renderSpans(t) {
  $("spans").replaceChildren(...(t.spans ?? []).map((s, i) => {
    const li = document.createElement("li");
    const name = Object.assign(document.createElement("b"), { textContent: s.label || "(span)" });
    const when = Object.assign(document.createElement("span"), { className: "num", textContent: `${s.t0.toFixed(2)}–${s.t1.toFixed(2)} s` });
    const show = Object.assign(document.createElement("button"), { className: "small", type: "button", textContent: "Show" });
    show.addEventListener("click", () => {
      setMode("replay");
      const pad = (s.t1 - s.t0) * 0.25;
      setView(s.t0 - pad, s.t1 + pad);
      playhead = s.t0;
    });
    const del = Object.assign(document.createElement("button"), { className: "small", type: "button", textContent: "Remove" });
    del.style.marginLeft = "0";
    del.addEventListener("click", () => updateTake(t.id, { spans: t.spans.filter((_, k) => k !== i) }).then(() => (dirty = true)));
    li.append(name, when, show, del);
    return li;
  }));
}

for (const [id, key] of [["take-dataset", "dataset"], ["take-label", "label"], ["take-notes", "notes"]]) {
  $(id).addEventListener("change", () => selectedId && updateTake(selectedId, { [key]: $(id).value.trim() }));
}
$("take-keep").addEventListener("change", () => selectedId && updateTake(selectedId, { keep: $("take-keep").checked }));

function renderDataset() {
  const name = currentDataset();
  const list = datasetTakes();
  $("ds-name").textContent = name === ALL ? "all takes" : name || "(no dataset)";
  $("ds-none").hidden = list.length > 0;
  $("ds-table").hidden = !list.length;
  const badge = $("ds-score");
  if (!list.length) {
    badge.textContent = "—";
    badge.className = "badge end";
    return;
  }
  const d = scoreDataset(list.map((t) => ({ label: t.label, keep: t.keep, summary: t.summary })));
  badge.textContent = d.score;
  badge.className = `badge end ${d.grade}`;
  $("ds-bins-head").title = `Strokes by mean speed: ${d.bins.join(", ")} mm/s`;
  const rows = [];
  for (const l of d.labels) {
    const tr = document.createElement("tr");
    const bins = document.createElement("span");
    bins.className = "bins";
    bins.title = d.bins.map((b, i) => `${b} mm/s: ${l.binCounts[i]}`).join("\n");
    for (const n of l.binCounts) {
      const bar = document.createElement("i");
      bar.style.height = `${Math.max(1, Math.min(18, (n / 9) * 18))}px`;
      if (n < 3) bar.className = "thin";
      bins.append(bar);
    }
    const score = Object.assign(document.createElement("span"), { className: `badge ${l.score >= 85 ? "good" : l.score >= 60 ? "usable" : "poor"}`, textContent: l.score });
    const cells = [
      Object.assign(document.createElement("td"), { className: "lbl", textContent: l.label, title: l.label }),
      Object.assign(document.createElement("td"), { className: "n", textContent: `${l.kept}/${l.takes}` }),
      Object.assign(document.createElement("td"), { className: "n", textContent: l.strokes }),
      document.createElement("td"),
      document.createElement("td"),
    ];
    cells[3].append(bins);
    cells[4].append(score);
    tr.append(...cells);
    rows.push(tr);
    const notes = [];
    if (l.grain_mm !== null) notes.push(`grain ≈ ${l.grain_mm.toFixed(2)} mm`);
    if (l.match !== null) notes.push(`takes ${Math.round(l.match * 100)}% alike`);
    if (l.next.length) notes.push(`next: ${l.next.join("; ")}`);
    if (notes.length) {
      const next = document.createElement("tr");
      next.className = "next";
      const text = notes.join(" · ");
      next.append(Object.assign(document.createElement("td"), { colSpan: 5, textContent: text[0].toUpperCase() + text.slice(1) }));
      rows.push(next);
    }
  }
  $("ds-body").replaceChildren(...rows);
}

// ---- Scope: live and replay plots ---------------------------------------------------------

const plots = {
  vib: new Plot($("plot-vib")),
  gyro: new Plot($("plot-gyro")),
  mic: new Plot($("plot-mic")),
  dist: new Plot($("plot-dist")),
  speed: new Plot($("plot-speed")),
};
const spectra = {
  vib: new XYPlot($("plot-vspec")),
  mic: new XYPlot($("plot-mspec")),
  grain: new XYPlot($("plot-grain")),
};
let mode = "live";
let viewAs = "wave"; // or "spectrogram": the vibration and sound plots
let spectrumOf = "live"; // what Spectrum shows: the live stream, or the selected take
let specHover = null; // {plot, clientX, clientY}
let lastSpecDraw = 0;
let dirty = true;
let view = { t0: 0, t1: 1 };
let playhead = 0;
let hover = null;
let selection = null;
let lastLiveDraw = 0;

function setMode(next) {
  if (next === "spectrum" && mode !== "spectrum") spectrumOf = mode === "replay" || (!source && loaded) ? "take" : "live";
  mode = next;
  $(`mode-${next}`).checked = true;
  $("transport").hidden = mode !== "replay";
  $("plots").hidden = mode === "spectrum";
  $("spectra").hidden = mode !== "spectrum";
  $("view-as").hidden = mode === "spectrum";
  $("xyz-legend").hidden = mode === "spectrum" || viewAs === "spectrogram";
  $("compare-wrap").hidden = mode !== "spectrum";
  if (mode === "live") stopAudio();
  hover = null;
  updateEmpty();
  dirty = true;
}
for (const id of ["mode-live", "mode-replay", "mode-spectrum"]) $(id).addEventListener("change", () => setMode($(id).value));
for (const id of ["as-wave", "as-spectrogram"]) {
  $(id).addEventListener("change", () => {
    viewAs = $(id).value;
    $("xyz-legend").hidden = viewAs === "spectrogram";
    $("vib-raw").parentElement.hidden = viewAs === "spectrogram";
    dirty = true;
  });
}
$("vib-raw").addEventListener("change", () => (dirty = true));
$("compare").addEventListener("change", () => (dirty = true));

function updateEmpty() {
  const empty = $("scope-empty");
  const specEmpty = $("spectra-empty");
  specEmpty.hidden = mode !== "spectrum" || (spectrumOf === "live" ? Boolean(source) : Boolean(loaded && loaded.id === selectedId));
  specEmpty.textContent = spectrumOf === "live" ? "Connect the board or start the Demo for live spectra." : "Pick a take in the Library to see its spectra.";
  if (mode === "spectrum") return;
  if (mode === "live") {
    empty.hidden = Boolean(source);
    empty.textContent = "Connect the board or start the Demo to see it live.";
  } else {
    empty.hidden = Boolean(loaded && loaded.id === selectedId);
    empty.textContent = "Pick a take in the Library to replay it.";
  }
}

function duration() {
  return loaded ? Math.max(0.1, loaded.analysis.durationS) : 1;
}

function setView(t0, t1) {
  const full = duration();
  const span = Math.min(full, Math.max(0.02, t1 - t0));
  t0 = Math.max(0, Math.min(full - span, t0));
  view = { t0, t1: t0 + span };
  dirty = true;
}
function fitView() {
  setView(0, duration());
}

const xyz = () => [colors.x, colors.y, colors.z];
const rangeText = (r, unit, digits = 2) => {
  const m = Math.max(Math.abs(r[0]), Math.abs(r[1]));
  return r[0] < 0 && r[1] > 0 ? `±${m.toFixed(digits)} ${unit}` : `${r[0].toFixed(digits)}–${r[1].toFixed(digits)} ${unit}`;
};

function drawScope() {
  if (mode === "live") drawLive();
  else if (mode === "replay") drawReplay();
  else drawSpectra();
}

// The vibration and sound plots as spectrograms. vib: {track, t (sample times), rate};
// mic: {samples, t0, rate, scale}. Spectrograms of a take are computed once and kept.
function drawSpectrograms(t0, t1, vib, mic, cache) {
  const vibSg = cache?.vibSg ?? spectrogram(vib.track, { nfft: 256, hop: 32 });
  const micSg = mic && (cache?.micSg ?? spectrogram(mic.samples, { nfft: 512, hop: 128, scale: mic.scale }));
  if (cache) Object.assign(cache, { vibSg, micSg });
  const vibT = (i) => vib.t[Math.min(vib.t.length - 1, i * 32 + 128)];
  plots.vib.drawSpectrogram({ t0, t1, sg: vibSg, frameT: vibT, binHz: vib.rate / 256, fmin: 0, fmax: vib.rate / 2, log: false, colors });
  if (micSg) {
    const micT = (i) => mic.t0 + (i * 128 + 256) / mic.rate;
    plots.mic.drawSpectrogram({ t0, t1, sg: micSg, frameT: micT, binHz: mic.rate / 512, fmin: 50, fmax: mic.rate / 2, log: true, colors });
  } else plots.mic.draw({ t0, t1, series: [], colors });
}

function drawLive() {
  const tEnd = Math.max(live.lastImuT ?? -Infinity, live.micEnd ?? -Infinity, live.tofT.last() ?? -Infinity);
  const t1 = Number.isFinite(tEnd) ? tEnd : LIVE_WINDOW_S;
  const t0 = t1 - LIVE_WINDOW_S;
  const imuT = live.imuT.view();
  const raw = $("vib-raw").checked;
  const accel = (raw ? live.accel : live.vib).view();
  const gyro = live.gyro.view();
  const axes = (y) => xyz().map((color, c) => ({ t: imuT, y, stride: 3, offset: c, color }));
  const common = { t0, t1, colors };
  const mic = live.mic.view();
  const micT0 = (live.micEnd ?? t1) - mic.length / live.micRate;
  if (viewAs === "spectrogram") {
    const vib = live.vib.view();
    const track = project(vib, principalAxis(vib));
    const rate = imuT.length > 1 ? (imuT.length - 1) / (imuT[imuT.length - 1] - imuT[0]) : 1670;
    drawSpectrograms(t0, t1, { track, t: imuT, rate }, mic.length ? { samples: mic, t0: micT0, rate: live.micRate, scale: 1 } : null, null);
  } else {
    plots.vib.draw({ ...common, series: axes(accel), yOptions: { symmetric: !raw, min: 0.01 } });
    const micSeries = { t0: micT0, dt: 1 / live.micRate, n: mic.length, y: mic, color: colors.readout, width: 1 };
    plots.mic.draw({ ...common, series: [micSeries], yOptions: { symmetric: true, min: 0.005 } });
  }
  plots.gyro.draw({ ...common, series: axes(gyro), yOptions: { symmetric: true, min: 1 } });
  const tofT = live.tofT.view();
  const invalid = [];
  const ok = live.tofOk.view();
  tofT.forEach((t, i) => ok[i] || invalid.push({ t, color: colors.bad }));
  plots.dist.draw({ ...common, series: [{ t: tofT, y: live.tofD.view(), color: colors.ink, width: 1.5 }], yOptions: { min: 5 }, ticks: invalid });
  plots.speed.draw({ ...common, series: [{ t: live.speedT.view(), y: live.speed.view(), color: colors.readout, width: 1.5 }], yOptions: { symmetric: true, min: 20 } });
  drawAxis($("axis"), -LIVE_WINDOW_S, 0, colors);
  for (const p of Object.values(plots)) p.overlay({ colors });
  heads();
}

function drawReplay() {
  if (!loaded || loaded.id !== selectedId) {
    for (const p of Object.values(plots)) p.draw({ t0: 0, t1: 1, series: [], colors });
    drawAxis($("axis"), 0, 1, colors);
    heads(true);
    return;
  }
  const a = loaded.analysis;
  const t = takes.get(selectedId);
  const { t0, t1 } = view;
  const raw = $("vib-raw").checked;
  const axes = (y) => xyz().map((color, c) => ({ t: a.imu.t, y, stride: 3, offset: c, color }));
  const spans = (t?.spans ?? []).map((s) => ({ t0: s.t0, t1: s.t1, color: getCss("--band-span"), label: s.label }));
  const spansQuiet = spans.map((s) => ({ ...s, label: undefined }));
  const strokes = a.strokes.map((s) => ({ t0: s.t0, t1: s.t1, color: getCss(s.direction === "away" ? "--band-away" : "--band-toward") }));
  const markers = loaded.session.playbacks.map((p) => ({
    t: (p.start_us - a.origin_us) * 1e-6,
    label: `${wire.PLAYBACK_KINDS[p.kind] ?? "?"} ${p.id}`,
  }));
  const common = { t0, t1, colors };
  if (viewAs === "spectrogram") {
    drawSpectrograms(t0, t1, { track: a.vibrationTrack, t: a.imu.t, rate: a.imuRate },
      a.mic && { samples: a.mic.samples, t0: a.mic.t0, rate: a.mic.rate, scale: 1 / 32768 }, loaded);
  } else {
    plots.vib.draw({ ...common, series: axes(raw ? a.imu.accel : a.vibration), yOptions: { symmetric: !raw, min: 0.01 }, bands: spans, markers });
    if (a.mic) {
      plots.mic.draw({ ...common, series: [{ t0: a.mic.t0, dt: a.mic.dt, n: a.mic.samples.length, y: a.mic.samples, scale: 1 / 32768, color: colors.readout, width: 1 }],
        yOptions: { symmetric: true, min: 0.005 }, bands: spansQuiet });
    } else plots.mic.draw({ ...common, series: [], bands: spansQuiet });
  }
  plots.gyro.draw({ ...common, series: axes(a.imu.gyro), yOptions: { symmetric: true, min: 1 }, bands: spansQuiet });
  if (!loaded.distValid) loaded.distValid = Float64Array.from(a.tof.distance, (d, i) => (a.tof.valid[i] ? d : NaN));
  const invalid = [];
  a.tof.t.forEach((tt, i) => a.tof.valid[i] || invalid.push({ t: tt, color: colors.bad }));
  plots.dist.draw({ ...common, series: [{ t: a.tof.t, y: loaded.distValid, color: colors.ink, width: 1.5 }], yOptions: { min: 5 }, ticks: invalid, bands: spansQuiet });
  plots.speed.draw({ ...common, series: [{ t: a.tof.t, y: a.tof.speed, color: colors.readout, width: 1.5 }], yOptions: { symmetric: true, min: 20 }, bands: strokes });
  drawAxis($("axis"), t0, t1, colors);
  heads();
}

function getCss(name) {
  // Read per draw: the bands follow the theme
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "rgba(128,128,128,.1)";
}

function heads(clear = false) {
  const r = (p) => p.range;
  if (viewAs === "spectrogram" && !clear) {
    $("r-vib").textContent = `0–${fmtHz(plots.vib.range ? (mode === "live" ? 835 : loaded?.analysis.imuRate / 2 || 835) : 835)} Hz, top ${plots.vib.range ? plots.vib.range[1].toFixed(0) : "?"} dB`;
    $("r-mic").textContent = `50 Hz–8 kHz (log), top ${plots.mic.range ? plots.mic.range[1].toFixed(0) : "?"} dBFS`;
    $("r-gyro").textContent = rangeText(r(plots.gyro), "°/s", 1);
    $("r-dist").textContent = rangeText(r(plots.dist), "mm", 0);
    $("r-speed").textContent = rangeText(r(plots.speed), "mm/s", 0);
    return;
  }
  $("r-vib").textContent = clear ? "" : rangeText(r(plots.vib), "g");
  $("r-gyro").textContent = clear ? "" : rangeText(r(plots.gyro), "°/s", 1);
  $("r-mic").textContent = clear ? "" : `peak ${(20 * Math.log10(Math.max(1e-5, Math.abs(r(plots.mic)[1]) / 1.1))).toFixed(0)} dBFS`;
  $("r-dist").textContent = clear ? "" : rangeText(r(plots.dist), "mm", 0);
  $("r-speed").textContent = clear ? "" : rangeText(r(plots.speed), "mm/s", 0);
}

function drawOverlays() {
  if (mode !== "replay") return;
  for (const p of Object.values(plots)) p.overlay({ playhead, hover, selection, colors });
  $("time-readout").textContent = `${playhead.toFixed(2)} / ${duration().toFixed(2)} s`;
  $("span-add").disabled = !selection || Math.abs(selection[1] - selection[0]) < 0.01;
}

function frame(now) {
  if (audio.source) {
    playhead = audio.startT + (audio.ctx.currentTime - audio.startCtx);
    if (playhead >= duration()) stopAudio();
    else if (playhead > view.t1) setView(playhead, playhead + (view.t1 - view.t0));
  }
  if (mode === "spectrum") {
    const liveNow = spectrumOf === "live";
    if (dirty || (liveNow && live.changed && now - lastSpecDraw > 150)) {
      drawSpectra();
      dirty = false;
      live.changed = false;
      lastSpecDraw = now;
    }
  } else if (mode === "live") {
    const every = viewAs === "spectrogram" ? 120 : 33;
    if ((live.changed || dirty) && now - lastLiveDraw > every) {
      drawScope();
      live.changed = false;
      dirty = false;
      lastLiveDraw = now;
    }
  } else {
    if (dirty) {
      drawScope();
      dirty = false;
    }
    drawOverlays();
  }
  requestAnimationFrame(frame);
}
new ResizeObserver(() => (dirty = true)).observe($("plots"));

// ---- Spectrum view ------------------------------------------------------------------------

const toDb = (spec) => spec && Array.from(spec.psd, (p) => 10 * Math.log10(p + 1e-20));
const catColors = () => [1, 2, 3, 4, 5, 6].map((i) => getCss(`--cat-${i}`));
// A fingerprint as a curve through its bands' centres
const printCurve = (f) => f && { x: f.edges.slice(0, -1).map((e, i) => Math.sqrt(e * f.edges[i + 1])), y: f.db };

function drawSpectra() {
  const vibRange = [5, 835], micRange = [50, 8000];
  const vibSeries = [], micSeries = [], points = [], legend = [];
  let grainX = 500;
  const lines = [];
  const peakNote = (spec, lo, hi) => {
    const f = spec && peakFrequency(spec, lo, hi);
    return f ? `peak ${fmtHz(f)} Hz` : "";
  };
  let vibNote = "", micNote = "";

  if (spectrumOf === "live") {
    const vib = live.vib.view();
    const imuT = live.imuT.view();
    const n = Math.min(imuT.length, 1670);
    if (n > 64) {
      const recent = vib.subarray((imuT.length - n) * 3);
      const track = project(recent, principalAxis(recent));
      const rate = (n - 1) / (imuT[imuT.length - 1] - imuT[imuT.length - n]);
      const spec = welch(track, rate, { nfft: SETTINGS.vibNfft });
      if (spec) vibSeries.push({ x: spec.freqs, y: toDb(spec), color: colors.readout });
      vibNote = peakNote(spec, ...SETTINGS.vibBand);
    }
    const mic = live.mic.view();
    if (mic.length > 1024) {
      const spec = welch(mic.subarray(Math.max(0, mic.length - live.micRate)), live.micRate, { nfft: SETTINGS.micNfft });
      if (spec) micSeries.push({ x: spec.freqs, y: toDb(spec), color: colors.readout });
      micNote = peakNote(spec, ...SETTINGS.micBand);
    }
    legend.push([colors.readout, "the last second"]);
  }

  const take = takes.get(selectedId);
  const haveTake = loaded && loaded.id === selectedId && take;
  if (spectrumOf === "take" && haveTake) {
    const a = loaded.analysis, f = a.frequency;
    if (f.floorVib) vibSeries.push({ x: f.floorVib.freqs, y: toDb(f.floorVib), color: colors.text, width: 1, dash: [4, 3] });
    if (f.floorMic) micSeries.push({ x: f.floorMic.freqs, y: toDb(f.floorMic), color: colors.text, width: 1, dash: [4, 3] });
    if (f.floorVib || f.floorMic) legend.push([colors.text, "between strokes", true]);
    if (f.vib) vibSeries.push({ x: f.vib.freqs, y: toDb(f.vib), color: colors.readout, width: 2 });
    if (f.mic) micSeries.push({ x: f.mic.freqs, y: toDb(f.mic), color: colors.readout, width: 2 });
    if (f.vib || f.mic) legend.push([colors.readout, `${take.label || "this take"}: strokes`]);
    vibNote = peakNote(f.vib, ...SETTINGS.vibBand);
    micNote = peakNote(f.mic, ...SETTINGS.micBand);
    if (selection && selection[1] - selection[0] > 0.05) {
      const sel = spectraBetween(a, selection[0], selection[1]);
      if (sel.vib) vibSeries.push({ x: sel.vib.freqs, y: toDb(sel.vib), color: colors.signal, width: 1.5 });
      if (sel.mic) micSeries.push({ x: sel.mic.freqs, y: toDb(sel.mic), color: colors.signal, width: 1.5 });
      legend.push([colors.signal, `selection ${selection[0].toFixed(2)}–${selection[1].toFixed(2)} s`]);
    }
  }

  // Strokes on the grain plot, and other surfaces when comparing
  const strokesOf = (summary) => summary.strokes.filter((s) => s.vib_peak_hz);
  if ($("compare").checked) {
    const list = datasetTakes();
    const d = scoreDataset(list.map((t) => ({ label: t.label, keep: t.keep, summary: t.summary })));
    const cats = catColors();
    d.labels.forEach((l, i) => {
      const color = cats[i % cats.length];
      const v = printCurve(l.fingerprint), m = printCurve(l.micFingerprint);
      if (v) vibSeries.push({ ...v, color, width: 1.25 });
      if (m) micSeries.push({ ...m, color, width: 1.25 });
      const label = l.label;
      for (const t of list) {
        if ((t.label || "(unlabelled)") !== label || t.keep === false) continue;
        for (const s of strokesOf(t.summary)) { points.push({ x: s.peak_mm_s, y: s.vib_peak_hz, color }); grainX = Math.max(grainX, s.peak_mm_s * 1.1); }
      }
      if (l.grain_mm) lines.push({ grain: l.grain_mm, color });
      legend.push([color, `${label}${l.grain_mm ? ` (${l.grain_mm.toFixed(2)} mm)` : ""}`]);
    });
  } else if (haveTake) {
    for (const s of strokesOf(take.summary)) { points.push({ x: s.peak_mm_s, y: s.vib_peak_hz, color: colors.readout }); grainX = Math.max(grainX, s.peak_mm_s * 1.1); }
    const grains = take.summary.strokes.map((s) => s.grain_mm).filter((g) => g).sort((x, y) => x - y);
    if (grains.length) lines.push({ grain: grains[grains.length >> 1], color: colors.readout });
  }

  const grainSeries = lines.map((l) => ({ x: [0, grainX], y: [0, grainX / l.grain], color: l.color, width: 1, dash: [5, 4] }));
  spectra.vib.draw({ x: vibRange, xLog: true, series: vibSeries, colors, yFloorDb: 80, xFmt: fmtHz, yFmt: (v) => `${v}` });
  spectra.mic.draw({ x: micRange, xLog: true, series: micSeries, colors, yFloorDb: 80, xFmt: fmtHz, yFmt: (v) => `${v}` });
  spectra.grain.draw({ x: [0, grainX], y: [0, 420], series: grainSeries, points, colors, xFmt: (v) => `${v}`, yFmt: (v) => `${v} Hz` });
  $("spectrum-legend").replaceChildren(...legend.map(([color, text, dashed]) => {
    const span = document.createElement("span");
    const key = document.createElement("i");
    key.style.background = dashed ? `repeating-linear-gradient(90deg, ${color} 0 3px, transparent 3px 5px)` : color;
    span.append(key, text);
    return span;
  }));
  const lambda = lines.length === 1 ? `grain ≈ ${lines[0].grain.toFixed(2)} mm · ` : "";
  if (!specHover) {
    $("r-vspec").textContent = vibNote;
    $("r-mspec").textContent = micNote;
    $("r-grain").textContent = `${lambda}${points.length} stroke${points.length === 1 ? "" : "s"}`;
  }
  for (const p of Object.values(spectra)) p.overlay(specHover?.plot === p ? specHover : null, colors);
  updateEmpty();
}

for (const [key, p] of Object.entries(spectra)) {
  p.over.addEventListener("pointermove", (event) => {
    specHover = { plot: p, clientX: event.clientX, clientY: event.clientY };
    const v = p.valueAt(event.clientX, event.clientY);
    const head = { vib: "r-vspec", mic: "r-mspec", grain: "r-grain" }[key];
    $(head).textContent = key === "grain" ? `${v.x.toFixed(0)} mm/s · ${v.y.toFixed(0)} Hz · λ ${(v.x / Math.max(1, v.y)).toFixed(2)} mm` : `${fmtHz(v.x)} Hz · ${v.y.toFixed(1)} dB`;
    p.overlay(specHover, colors);
  });
  p.over.addEventListener("pointerleave", () => {
    specHover = null;
    dirty = true;
  });
}

// Replay's pointer: click moves the playhead, drag selects, scroll zooms, Shift-scroll pans.
let press = null;
for (const p of Object.values(plots)) {
  const el = p.over;
  el.addEventListener("pointerdown", (event) => {
    if (mode !== "replay" || !loaded) return;
    el.setPointerCapture(event.pointerId);
    press = { x: event.clientX, t: p.timeAtClientX(event.clientX), dragging: false };
  });
  el.addEventListener("pointermove", (event) => {
    if (mode !== "replay" || !loaded) return;
    const t = p.timeAtClientX(event.clientX);
    hover = t;
    if (press && Math.abs(event.clientX - press.x) > 3) {
      press.dragging = true;
      convertedDrive = null; updateHaptics();
      selection = [press.t, t].sort((a, b) => a - b).map((x) => Math.max(0, Math.min(duration(), x)));
    }
  });
  el.addEventListener("pointerup", (event) => {
    if (!press) return;
    if (!press.dragging) {
      selection = null;
      seek(Math.max(0, Math.min(duration(), p.timeAtClientX(event.clientX))));
    }
    press = null;
  });
  el.addEventListener("pointerleave", () => (hover = null));
  el.addEventListener("dblclick", () => fitView());
  el.addEventListener("wheel", (event) => {
    if (mode !== "replay" || !loaded) return;
    event.preventDefault();
    const span = view.t1 - view.t0;
    const pan = event.shiftKey ? event.deltaY : event.deltaX;
    if (Math.abs(pan) > Math.abs(event.shiftKey ? 0 : event.deltaY)) {
      setView(view.t0 + (pan / el.clientWidth) * span, view.t1 + (pan / el.clientWidth) * span);
      return;
    }
    const at = p.timeAtClientX(event.clientX);
    const k = Math.exp(event.deltaY * 0.002);
    setView(at - (at - view.t0) * k, at + (view.t1 - at) * k);
  }, { passive: false });
}
$("zoom-fit").addEventListener("click", fitView);

$("span-add").addEventListener("click", async () => {
  const t = takes.get(selectedId);
  if (!t || !selection) return;
  const span = { t0: Math.round(selection[0] * 1000) / 1000, t1: Math.round(selection[1] * 1000) / 1000, label: $("span-label").value.trim() };
  const spans = [...(t.spans ?? []), span].sort((a, b) => a.t0 - b.t0);
  selection = null;
  await updateTake(t.id, { spans });
  dirty = true;
});

// ---- Audio: the microphone, or the vibration's strongest axis, from the playhead -----------

const audio = { ctx: null, source: null, startCtx: 0, startT: 0 };
let audioBuffers = {};
const VIB_RATE = 8000;

function bufferFor(which) {
  if (audioBuffers[which]) return audioBuffers[which];
  const a = loaded.analysis;
  let samples, rate, start;
  if (which === "mic") {
    if (!a.mic) return null;
    rate = a.mic.rate;
    start = a.mic.t0;
    samples = Float32Array.from(a.mic.samples, (s) => s / 32768);
  } else {
    // The IMU's own times, resampled to an even rate the audio system takes
    const t = a.imu.t, y = a.vibrationTrack;
    if (t.length < 2) return null;
    rate = VIB_RATE;
    start = t[0];
    const n = Math.floor((t[t.length - 1] - t[0]) * rate);
    samples = new Float32Array(n);
    let j = 0, peak = 1e-6;
    for (let i = 0; i < n; i++) {
      const tt = start + i / rate;
      while (j + 1 < t.length - 1 && t[j + 1] < tt) j++;
      const u = Math.max(0, Math.min(1, (tt - t[j]) / (t[j + 1] - t[j] || 1)));
      samples[i] = y[j] + u * (y[j + 1] - y[j]);
      peak = Math.max(peak, Math.abs(samples[i]));
    }
    for (let i = 0; i < n; i++) samples[i] *= 0.9 / peak;
  }
  if (!samples.length) return null;
  audio.ctx ??= new AudioContext();
  const buffer = audio.ctx.createBuffer(1, samples.length, rate);
  buffer.copyToChannel(samples, 0);
  return (audioBuffers[which] = { buffer, start });
}

function play() {
  if (!loaded || loaded.id !== selectedId) return;
  audio.ctx ??= new AudioContext();
  audio.ctx.resume();
  const which = $("listen-vib").checked ? "vib" : "mic";
  const b = bufferFor(which);
  if (!b) return;
  if (playhead >= duration() - 0.05) playhead = view.t0;
  const offset = Math.max(0, playhead - b.start);
  const src = audio.ctx.createBufferSource();
  src.buffer = b.buffer;
  src.connect(audio.ctx.destination);
  src.onended = () => {
    if (audio.source === src) stopAudio();
  };
  src.start(0, offset);
  Object.assign(audio, { source: src, startCtx: audio.ctx.currentTime, startT: b.start + offset });
  $("play").textContent = "Pause";
}

function stopAudio() {
  if (audio.source) {
    const src = audio.source;
    audio.source = null;
    try {
      src.stop();
    } catch {
      /* already ended */
    }
  }
  $("play").textContent = "Play";
}

function seek(t) {
  playhead = t;
  if (audio.source) {
    stopAudio();
    play();
  }
}

$("play").addEventListener("click", () => (audio.source ? stopAudio() : play()));
for (const id of ["listen-mic", "listen-vib"]) {
  $(id).addEventListener("change", () => {
    if (audio.source) {
      stopAudio();
      play();
    }
  });
}

// ---- Keys ---------------------------------------------------------------------------------

addEventListener("keydown", (event) => {
  if (event.target.closest("input, textarea, select") || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === "r" || event.key === "R") {
    if (rec) stopRecording();
    else if (source) startRecording();
  } else if (event.key === " " && mode === "replay") {
    event.preventDefault();
    audio.source ? stopAudio() : play();
  } else if (event.key === "Escape") {
    selection = null;
  }
});

// ---- Start --------------------------------------------------------------------------------

async function reanalyseOld() {
  for (const t of [...takes.values()]) {
    if (t.summary?.version === ANALYSIS_VERSION) continue;
    const raw = await store.getRaw(t.id);
    if (!raw) continue;
    const analysis = analyze(decodeSession(raw));
    const meta = { ...t, seconds: analysis.summary.seconds, board: analysis.summary.board, summary: analysis.summary };
    takes.set(t.id, meta);
    await store.putTake(meta);
  }
  renderLibrary();
  renderScore();
}

async function start() {
  store = await openStore();
  if (!store.persistent) $("storage-note").textContent = "this browser won't keep takes: export them";
  for (const t of await store.listTakes()) takes.set(t.id, t);
  themeChanged();
  sourceChanged();
  setMode("live");
  renderLibrary();
  renderScore();
  requestAnimationFrame(frame);
  unsaved = await store.spooled().catch(() => []);
  showRecover();
  reanalyseOld();
  // Opened with ?demo: start the simulated board (for a quick look, and the page's own checks)
  if (new URLSearchParams(location.search).has("demo")) startDemo();
}

start();


const profileEditor = bindProfileEditor($("hardware-profile"), {
  save: async (profile, key) => {
    if (source?.kind !== "serial" || !hapticDevice || hapticBusy || rec || String(live.info?.board_id) !== key) throw Error("Stop recording/playback and select the connected board first");
    if ((live.info?.version ?? 0) < 5) throw Error("Update the capture firmware to save profiles");
    await hapticDevice.command(CMD.SET_PROFILE, encodeProfile(profile));
    // ACK is sent after the profile is persisted; wait for its periodic read-back.
    for (let n = 0; n < 25; n++) {
      if (JSON.stringify(live.profile) === JSON.stringify(profile)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw Error("Profile read-back was not confirmed");
  },
});
function currentHealth() {
  return healthSummary({ connected: Boolean(source), health: live.health,
    healthAgeMs: live.healthReceivedMs == null ? null : performance.now() - live.healthReceivedMs,
    rateHz: live.measuredImuHz ?? null, expectedHz: live.info?.imu_rate_hz,
    lost: live.reader.lost, bad: live.reader.bad, storage: storageError ? "error" : store?.persistent === false ? "memory" : null });
}
function renderDeviceHealth() {
  const summary = currentHealth();
  $("device-health").textContent = source?.kind === "demo" ? "Demo · simulated readings" : summary.text;
  $("device-health").dataset.state = source?.kind === "demo" ? "demo" : summary.state;
  $("export-diagnostics").disabled = !live.info;
  profileEditor.sync(live.profile, String(live.info?.board_id), source?.kind === "serial");
}
$("export-diagnostics").addEventListener("click", () => downloadDiagnostics(diagnostics({
  boardId: live.info?.board_id?.toString(16).toUpperCase().padStart(4, "0"), health: live.health,
  profile: live.profile, summary: currentHealth(), counters: { lost: live.reader.lost, bad: live.reader.bad, ...(live.lastStats ?? {}) },
  recording: { active: Boolean(rec), persistent: Boolean(store?.persistent) },
})));
