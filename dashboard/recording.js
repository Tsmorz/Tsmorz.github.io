// Recording one board's streams into CSV files, and the time bookkeeping behind it. Pure
// functions and classes only, no DOM or Bluetooth, so tests/dashboard/recording.test.mjs can run
// them in Node. The file formats are documented in docs/data-collection.md; sysid/align.py reads
// them.
import { temperatureFromEvent } from "./wire.js";

const WRAP = 2 ** 32;

/**
 * Turns the board's 32-bit microsecond times (they wrap every ~71.6 minutes) back into a
 * continuous count. Each time is placed in whichever wrap puts it nearest the latest time seen,
 * so streams that arrive slightly out of order (events vs IMU batches) unwrap consistently.
 * One per board, shared by all of its streams.
 */
export class TimeUnwrapper {
  constructor() {
    this.latest = null;
  }

  unwrap(low32) {
    if (this.latest === null) {
      this.latest = low32;
      return low32;
    }
    const base = this.latest - (this.latest % WRAP);
    let best = base + low32;
    for (const candidate of [best - WRAP, best + WRAP]) {
      if (candidate >= 0 && Math.abs(candidate - this.latest) < Math.abs(best - this.latest)) best = candidate;
    }
    this.latest = Math.max(this.latest, best);
    return best;
  }
}

export const IMU_COLUMNS = [
  "board_time_us", "host_ms", "seq",
  "gyro_x_dps", "gyro_y_dps", "gyro_z_dps", "accel_x_g", "accel_y_g", "accel_z_g",
  "gyro_bias_x_dps", "gyro_bias_y_dps", "gyro_bias_z_dps",
  "quat_w", "quat_x", "quat_y", "quat_z", "at_rest", "user_button",
];
export const ENVELOPE_COLUMNS = ["board_time_us", "host_ms", "window", "peak"];
export const EVENT_COLUMNS = ["board_time_us", "host_ms", "seq", "type", "peak"];
export const TEMPERATURE_COLUMNS = ["board_time_us", "host_ms", "temperature_c"];

// The board sends its scales as float32, so 0.07 arrives as 0.0700000003; trim that back.
const cleanScale = (scale) => Math.round(scale * 1e9) / 1e9;
const fixed = (value, digits) => value.toFixed(digits);

/**
 * Decimal places that write every multiple of a (cleaned) scale exactly: 2 for 0.07 dps, 4 for
 * 0.0175, 6 for 0.004375. Fewer would round away part of a count at the finer ranges.
 */
export function scaleDecimals(scale) {
  const text = String(cleanScale(scale));
  const exponent = text.match(/e-(\d+)$/);
  if (exponent) return Number(exponent[1]) + (text.split("e")[0].split(".")[1]?.length ?? 0);
  return text.split(".")[1]?.length ?? 0;
}

/** A folder- and file-name-safe version of a label: letters, digits, - and _ only. */
export function safeName(label) {
  const cleaned = String(label).trim().replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "board";
}

/**
 * The USER button state (0/1) at each of `times` (µs), from the press/release events among
 * `events`. Events and IMU data arrive separately, so this is worked out at the end, by time.
 * Released before the first event.
 */
export function buttonStatesAt(times, events) {
  const edges = events.filter((e) => e.type === "press" || e.type === "release").sort((a, b) => a.tUs - b.tUs);
  const order = [...times.keys()].sort((a, b) => times[a] - times[b]);
  const states = new Array(times.length).fill(0);
  let pressed = 0;
  let next = 0;
  for (const index of order) {
    while (next < edges.length && edges[next].tUs <= times[index]) pressed = edges[next++].type === "press" ? 1 : 0;
    states[index] = pressed;
  }
  return states;
}

/** The files a live recording writes, with their columns. temperature.csv only if the firmware sent temperatures. */
export const LIVE_FILES = {
  "imu.csv": IMU_COLUMNS, "mic_envelope.csv": ENVELOPE_COLUMNS, "events.csv": EVENT_COLUMNS, "temperature.csv": TEMPERATURE_COLUMNS,
};

/**
 * One board's share of a recording, encoded into CSV rows as it arrives (far smaller than the
 * decoded samples) and handed over in batches by takePending(), which app.js writes to the
 * browser's storage every couple of seconds. Everything added is already decoded (wire.js) and
 * its times unwrapped. host_ms is when the page received each notification
 * (performance.timeOrigin + performance.now(), the same clock for every board on the page): the
 * aligner uses it only to pair up sync marks roughly, then aligns on the board times.
 */
export class BoardRecording {
  constructor(info) {
    this.gyroScale = cleanScale(info.gyroDpsPerLsb);
    this.accelScale = cleanScale(info.accelGPerLsb);
    this.gyroDecimals = scaleDecimals(this.gyroScale);
    this.accelDecimals = scaleDecimals(this.accelScale);
    this.windowUs = (1e6 * info.envelopeWindowSamples) / info.micRateHz;
    this.pending = Object.fromEntries(Object.keys(LIVE_FILES).map((file) => [file, []]));
    this.counts = { imuSamples: 0, envelopeWindows: 0, syncMarks: 0, buttonEvents: 0 };
  }

  /**
   * samples: decodeImuBatch() samples with tUs unwrapped; biasDps: the batch's gyro bias. The
   * user_button column is added when the file is put together (liveFileParts), as the press and
   * release events arrive separately.
   */
  addImu(samples, biasDps, hostMs) {
    const host = fixed(hostMs, 3);
    const bias = biasDps.map((value) => fixed(value, 2)).join(",");
    for (const s of samples) {
      this.pending["imu.csv"].push([
        s.tUs, host, s.seq,
        ...s.gyroRaw.map((raw) => fixed(raw * this.gyroScale, this.gyroDecimals)),
        ...s.accelRaw.map((raw) => fixed(raw * this.accelScale, this.accelDecimals)),
        bias,
        ...[s.quat.w, s.quat.x, s.quat.y, s.quat.z].map((c) => fixed(c, 5)),
        s.atRest ? 1 : 0,
      ].join(","));
    }
    this.counts.imuSamples += samples.length;
  }

  /** tUs: the batch's first window time, unwrapped. */
  addEnvelope(firstWindow, tUs, peaks, hostMs) {
    const host = fixed(hostMs, 3);
    peaks.forEach((peak, i) => this.pending["mic_envelope.csv"].push(`${Math.round(tUs + i * this.windowUs)},${host},${firstWindow + i},${peak}`));
    this.counts.envelopeWindows += peaks.length;
  }

  /** event: decodeEvent() output with tUs unwrapped. Temperatures go to their own file. */
  addEvent(event, hostMs) {
    const host = fixed(hostMs, 3);
    if (event.type === "temperature") {
      this.pending["temperature.csv"].push(`${event.tUs},${host},${fixed(temperatureFromEvent(event.peak), 3)}`);
      return;
    }
    this.pending["events.csv"].push(`${event.tUs},${host},${event.seq},${event.type},${event.peak}`);
    if (event.type === "sync") this.counts.syncMarks++;
    else this.counts.buttonEvents++;
  }

  /** The rows added since the last call, as CSV text (no header) per file that has any. */
  takePending() {
    const taken = {};
    for (const [file, rows] of Object.entries(this.pending)) {
      if (!rows.length) continue;
      taken[file] = rows.join("\n") + "\n";
      this.pending[file] = [];
    }
    return taken;
  }
}

/** The events (board time and type) in rows of a live events.csv, without its header. */
export function parseEventRows(text) {
  const column = EVENT_COLUMNS.indexOf("type");
  return text.split("\n").filter(Boolean).map((line) => {
    const cells = line.split(",");
    return { tUs: Number(cells[0]), type: cells[column] };
  });
}

/**
 * One file of a board's live recording, as the parts to write in order (or to make a Blob of):
 * its header line, then each chunk of rows from takePending(). imu.csv rows get their user_button
 * column here, from the board's `events` (parseEventRows()).
 */
export function liveFileParts(file, chunks, events) {
  const header = LIVE_FILES[file].join(",") + "\n";
  if (file !== "imu.csv") return [header, ...chunks];
  return [header, ...chunks.map((chunk) => {
    const lines = chunk.split("\n").filter(Boolean);
    const states = buttonStatesAt(lines.map((line) => Number(line.slice(0, line.indexOf(",")))), events);
    return lines.map((line, i) => `${line},${states[i]}\n`).join("");
  })];
}
