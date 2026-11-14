// A take as a session folder: the files recording/record.py writes (raw.bin, info.json, imu.csv,
// tof.csv, mic.wav, mic_blocks.csv, stats.csv, messages.txt), byte for byte the same for the same
// raw bytes, so `task process SESSION=<folder>` reads it, plus labels.json with what was labelled
// here. Pure: returns {name: Uint8Array | string}; the page writes them to disk.

import { STATS_FIELDS } from "./wire.js";

const CRLF = "\r\n"; // Python's csv module ends every row this way

function csv(header, rows) {
  return header.join(",") + CRLF + rows.map((r) => r.join(",") + CRLF).join("");
}

/** 16-bit mono PCM WAV, as Python's wave module writes it. */
export function wavBytes(samples, rate) {
  const data = samples.length * 2;
  const out = new Uint8Array(44 + data);
  const v = new DataView(out.buffer);
  const ascii = (at, s) => [...s].forEach((c, i) => (out[at + i] = c.charCodeAt(0)));
  ascii(0, "RIFF"); v.setUint32(4, 36 + data, true); ascii(8, "WAVE");
  ascii(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  ascii(36, "data"); v.setUint32(40, data, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + 2 * i, samples[i], true);
  return out;
}

/** The labels a take carries, as written to and read from labels.json. */
export function labelsJson(take, score) {
  return {
    format: "haptography-labels/1",
    dataset: take.dataset ?? "",
    label: take.label ?? "",
    notes: take.notes ?? "",
    setup: take.setup ?? "",
    simulated: Boolean(take.simulated),
    repetition: take.repetition ?? null,
    keep: take.keep !== false,
    created: take.created,
    spans: (take.spans ?? []).map((s) => ({ start_s: s.t0, end_s: s.t1, label: s.label })),
    score: score ?? null,
  };
}

/** Labels from a labels.json, for importing a folder back. Unknown fields are ignored. */
export function readLabels(json) {
  return {
    dataset: typeof json.dataset === "string" ? json.dataset : "",
    label: typeof json.label === "string" ? json.label : "",
    notes: typeof json.notes === "string" ? json.notes : "",
    setup: typeof json.setup === "string" ? json.setup : "",
    simulated: json.simulated === true,
    repetition: Number.isInteger(json.repetition) && json.repetition > 0 ? json.repetition : null,
    keep: json.keep !== false,
    created: typeof json.created === "string" ? json.created : null,
    spans: Array.isArray(json.spans)
      ? json.spans
          .filter((s) => Number.isFinite(s.start_s) && Number.isFinite(s.end_s))
          .map((s) => ({ t0: s.start_s, t1: s.end_s, label: String(s.label ?? "") }))
      : [],
  };
}

/** The frequency-domain features of a take (its analysis summary), as written to features.json:
 *  each stroke's speed, vibration peak and centroid, sound centroid and level, grain; the take's
 *  spectral fingerprints (mean power in log-spaced bands, dB) and texture signal over the floor. */
export function featuresJson(summary) {
  return {
    format: "haptography-features/1",
    note: "Speeds from the ToF alone (uncorrected for tilt). Vibration: the high-passed accelerometer on its strongest axis, g. Sound: full scale. Fingerprints: mean PSD per band, dB.",
    strokes: summary.strokes,
    fingerprint: summary.fingerprint ?? null,
    snr_db: summary.snr ?? null,
  };
}

/** Every file of the session folder for `raw` (the take's bytes) decoded into `session`; with an
 *  analysis `summary`, features.json too. */
export function sessionFiles(raw, session, take, extra = {}, summary = null) {
  const files = { "raw.bin": raw };
  const { imu, tof, mic, info } = session;

  if (imu.t_us.length) {
    const rows = [];
    for (let i = 0; i < imu.t_us.length; i++) {
      const g = imu.gyro.subarray(i * 3, i * 3 + 3), a = imu.accel.subarray(i * 3, i * 3 + 3);
      rows.push([imu.t_us[i], imu.seq[i], g[0], g[1], g[2], a[0], a[1], a[2]]);
    }
    files["imu.csv"] = csv(["t_us", "seq", "gx", "gy", "gz", "ax", "ay", "az"], rows);
  }
  if (tof.t_us.length) {
    const rows = [];
    for (let i = 0; i < tof.t_us.length; i++) {
      rows.push([tof.t_us[i], tof.distance_mm[i], tof.status[i], tof.signal_per_spad[i], tof.ambient[i], tof.spads[i]]);
    }
    files["tof.csv"] = csv(["t_us", "distance_mm", "status", "signal_per_spad", "ambient", "spads"], rows);
  }
  if (mic.blocks.length) {
    files["mic.wav"] = wavBytes(mic.samples, mic.rate);
    const rows = [];
    for (let i = 0; i < mic.blocks.length; i += 4) rows.push([mic.blocks[i], mic.blocks[i + 1], mic.blocks[i + 2], mic.blocks[i + 3]]);
    files["mic_blocks.csv"] = csv(["t0_us", "first_index", "arrival_us", "count"], rows);
  }
  if (session.stats.length) {
    files["stats.csv"] = csv(STATS_FIELDS, session.stats.map((s) => STATS_FIELDS.map((k) => s[k])));
  }
  const level = ["info", "warning", "error"];
  files["messages.txt"] = session.messages.map((m) => `${level[Math.min(m.level, 2)]}: ${m.text}\n`).join("");

  const infoJson = {
    device: info ? { ...info, board_name: info.board_id.toString(16).toUpperCase().padStart(4, "0") } : null,
    packets: session.packets,
    packets_lost: session.lost,
    bad_packets: session.bad,
    written: { imu: imu.t_us.length, mic_blocks: mic.blocks.length / 4, tof: tof.t_us.length },
    device_stats: session.stats.at(-1) ?? null,
    ...(session.health && { health: session.health }),
    ...(session.profile && { profile: session.profile }),
    ...extra,
  };
  files["info.json"] = JSON.stringify(infoJson, null, 2) + "\n";
  if (take) files["labels.json"] = JSON.stringify(labelsJson(take, extra.score), null, 2) + "\n";
  if (summary) files["features.json"] = JSON.stringify(featuresJson(summary), null, 2) + "\n";
  return files;
}

/** A folder name for a take: its start time as record.py names folders, then its label. */
export function folderName(take) {
  const d = new Date(take.created);
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  const slug = slugify(take.label);
  return slug ? `${stamp}-${slug}` : stamp;
}

export function slugify(text) {
  return (text ?? "").toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_-]+/g, "-").slice(0, 40);
}

/** When a folder named by folderName() (or record.py) was recorded, or null. */
export function timeFromFolderName(name) {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(name);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  return new Date(y, mo - 1, d, h, mi, s).toISOString();
}

/** Group imported files by session directory, including browsers that omit relative paths. */
export function sessionFolders(files) {
  const folders = new Map();
  for (const file of files) {
    const path = file.webkitRelativePath || file.name;
    const slash = path.lastIndexOf("/");
    const dir = slash < 0 ? "" : path.slice(0, slash);
    if (!folders.has(dir)) folders.set(dir, {});
    folders.get(dir)[file.name] = file;
  }
  return [...folders.entries()].filter(([, files]) => files["raw.bin"]);
}
