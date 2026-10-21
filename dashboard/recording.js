// Recording one board's streams into CSV files, and the time bookkeeping behind it. Pure
// functions and classes only, no DOM or Bluetooth, so tests/dashboard/recording.test.mjs can run
// them in Node. The file formats are documented in docs/data-collection.md; sysid/align.py reads
// them.

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

// The board sends its scales as float32, so 0.07 arrives as 0.0700000003; trim that back.
const cleanScale = (scale) => Math.round(scale * 1e9) / 1e9;
const fixed = (value, digits) => value.toFixed(digits);

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

/**
 * One board's share of a recording. Everything added is already decoded (wire.js) and its times
 * unwrapped; files() turns it into CSV text. host_ms is when the page received each notification
 * (performance.timeOrigin + performance.now(), the same clock for every board on the page): the
 * aligner uses it only to pair up sync marks roughly, then aligns on the board times.
 */
export class BoardRecording {
  constructor(info) {
    this.gyroScale = cleanScale(info.gyroDpsPerLsb);
    this.accelScale = cleanScale(info.accelGPerLsb);
    this.windowUs = (1e6 * info.envelopeWindowSamples) / info.micRateHz;
    this.imu = [];
    this.envelope = [];
    this.events = [];
  }

  /** samples: decodeImuBatch() samples with tUs unwrapped; biasDps: the batch's gyro bias. */
  addImu(samples, biasDps, hostMs) {
    for (const s of samples) this.imu.push({ ...s, biasDps, hostMs });
  }

  /** tUs: the batch's first window time, unwrapped. */
  addEnvelope(firstWindow, tUs, peaks, hostMs) {
    peaks.forEach((peak, i) => this.envelope.push([Math.round(tUs + i * this.windowUs), hostMs, firstWindow + i, peak]));
  }

  /** event: decodeEvent() output with tUs unwrapped. */
  addEvent(event, hostMs) {
    this.events.push({ ...event, hostMs });
  }

  get counts() {
    return {
      imuSamples: this.imu.length,
      envelopeWindows: this.envelope.length,
      syncMarks: this.events.filter((e) => e.type === "sync").length,
      buttonEvents: this.events.filter((e) => e.type !== "sync").length,
    };
  }

  /** The USER button state at each IMU sample (see buttonStatesAt()). */
  buttonStates() {
    return buttonStatesAt(this.imu.map((s) => s.tUs), this.events);
  }

  /** The three CSV files, as text, keyed by file name. */
  files() {
    const csv = (columns, rows) => [columns.join(","), ...rows.map((row) => row.join(","))].join("\n") + "\n";
    const buttons = this.buttonStates();
    const imuRows = this.imu.map((s, i) => [
      s.tUs, fixed(s.hostMs, 3), s.seq,
      ...s.gyroRaw.map((raw) => fixed(raw * this.gyroScale, 2)),
      ...s.accelRaw.map((raw) => fixed(raw * this.accelScale, 6)),
      ...s.biasDps.map((bias) => fixed(bias, 2)),
      ...[s.quat.w, s.quat.x, s.quat.y, s.quat.z].map((c) => fixed(c, 5)),
      s.atRest ? 1 : 0, buttons[i],
    ]);
    const envelopeRows = this.envelope.map(([t, hostMs, window, peak]) => [t, fixed(hostMs, 3), window, peak]);
    const eventRows = this.events.map((e) => [e.tUs, fixed(e.hostMs, 3), e.seq, e.type, e.peak]);
    return {
      "imu.csv": csv(IMU_COLUMNS, imuRows),
      "mic_envelope.csv": csv(ENVELOPE_COLUMNS, envelopeRows),
      "events.csv": csv(EVENT_COLUMNS, eventRows),
    };
  }
}
