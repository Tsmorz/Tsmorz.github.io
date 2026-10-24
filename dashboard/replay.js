// Reading a recorded session back for the Replay view: finding its files among those picked,
// parsing the CSVs, putting every board on one timebase, and thinning traces to the screen's pixel
// columns. Pure functions only, no DOM, so tests/dashboard/replay.test.mjs can run them in Node.
// The file formats are in docs/data-collection.md.
import { headingChangeDegrees, quatToEulerDegrees } from "./pose.js";
import { peakToDbfs } from "./signal.js";

// ---- finding sessions ---------------------------------------------------------------------

/**
 * A picked file's path as folder names then file name. A folder pick gives
 * "session/board/imu.csv"; a session saved without a folder downloads as "session__board__imu.csv",
 * and Chrome names a second download of that file "session__board__imu (1).csv": the same file.
 */
export function pathParts(path) {
  const parts = path.split("/").filter(Boolean);
  const name = (parts.at(-1) ?? "").replace(/ \(\d+\)(?=\.[^.]*$)/, "");
  return [...parts.slice(0, -1), ...name.split("__")];
}

/**
 * When a session was recorded, from the date and time in its name (local time, as the dashboard
 * names sessions: "2026-10-20_14-05-09", "flash_2026-10-20_14-05-09"), in epoch ms; null if none.
 */
export function sessionDateMs(name) {
  const match = name.match(/(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  return new Date(year, month - 1, day, hour, minute, second).getTime();
}

/**
 * The sessions among picked files: each folder whose subfolders hold an imu.csv, with those boards'
 * files and its session.json. Newest first: by the date in the name, or for a session named by
 * hand, by its files' modification times (`modifiedMs(path)`). Where a file was picked more than
 * once (Chrome's numbered copies of a download), the last in `paths` wins. Every path returned is
 * one of `paths`:
 * [{ name, manifest: path | null, boards: [{ folder, files: { "imu.csv": path, ... } }] }]
 */
export function findSessions(paths, modifiedMs = () => 0) {
  const dirs = new Map(); // folder path -> { file name: path }
  for (const path of paths) {
    const parts = pathParts(path);
    const dir = parts.slice(0, -1).join("/");
    if (!dirs.has(dir)) dirs.set(dir, {});
    dirs.get(dir)[parts.at(-1)] = path;
  }
  const sessions = new Map();
  for (const [dir, files] of dirs) {
    if (!files["imu.csv"]) continue;
    const parts = dir.split("/");
    const folder = parts.pop();
    const root = parts.join("/");
    if (!sessions.has(root)) {
      sessions.set(root, {
        name: parts.at(-1) || "session",
        manifest: dirs.get(root)?.["session.json"] ?? null,
        boards: [],
      });
    }
    sessions.get(root).boards.push({ folder, files });
  }
  const when = new Map([...sessions.values()].map((session) => [session, sessionDateMs(session.name) ??
    Math.max(0, ...session.boards.flatMap((board) => Object.values(board.files).map(modifiedMs)))]));
  for (const session of sessions.values()) session.boards.sort((a, b) => a.folder.localeCompare(b.folder));
  return [...sessions.values()].sort((a, b) => when.get(b) - when.get(a) || b.name.localeCompare(a.name));
}

// ---- parsing ------------------------------------------------------------------------------

// Columns kept as text; every other column is parsed as a number.
const TEXT_COLUMNS = new Set(["type"]);

/** A CSV as { header, length, columns: { name: Float64Array (or string[] for text columns) } }. */
export function parseCsv(text) {
  const lines = text.split(/\r?\n/);
  while (lines.length && !lines.at(-1)) lines.pop();
  const header = lines.length ? lines[0].split(",") : [];
  const length = Math.max(0, lines.length - 1);
  const isText = header.map((name) => TEXT_COLUMNS.has(name));
  const targets = header.map((_, c) => (isText[c] ? new Array(length) : new Float64Array(length)));
  for (let row = 0; row < length; row++) {
    const cells = lines[row + 1].split(",");
    for (let c = 0; c < targets.length; c++) targets[c][row] = isText[c] ? cells[c] : Number(cells[c]);
  }
  return { header, length, columns: Object.fromEntries(header.map((name, c) => [name, targets[c]])) };
}

const EMPTY_EVENTS = parseCsv("board_time_us,seq,type,peak\n");

/**
 * The quaternion (`quat`: [w, x, y, z]) and roll, pitch and yaw (degrees) at each row of a table
 * with quat_{w,x,y,z}; yaw relative to the first row.
 */
function orientationOf(table) {
  const { quat_w: w, quat_x: x, quat_y: y, quat_z: z } = table.columns;
  if (!w || !table.length) return null;
  const n = table.length;
  const roll = new Float32Array(n);
  const pitch = new Float32Array(n);
  const yaw = new Float32Array(n);
  const first = { w: w[0], x: x[0], y: y[0], z: z[0] };
  for (let i = 0; i < n; i++) {
    const q = { w: w[i], x: x[i], y: y[i], z: z[i] };
    const euler = quatToEulerDegrees(q);
    roll[i] = euler.roll;
    pitch[i] = euler.pitch;
    yaw[i] = headingChangeDegrees(first, q);
  }
  return { us: table.columns.board_time_us, quat: [w, x, y, z], roll, pitch, yaw };
}

/**
 * One board's recording from its parsed CSVs and its session.json entry (`meta`, may be {}).
 * `envelope` (mic_envelope.csv) comes with live recordings, `orientation` (orientation.csv) with
 * flash ones; a live imu.csv carries the orientation itself. Times stay on the board's clock (µs).
 */
export function loadBoard(folder, meta, { imu, events = EMPTY_EVENTS, envelope = null, orientation = null }) {
  const column = (name) => imu.columns[name];
  const axes = (pattern) => ["x", "y", "z"].map((axis) => column(pattern.replace("%", axis)));
  const us = column("board_time_us");
  const seq = column("seq");
  const lost = [];
  for (let i = 1; i < imu.length; i++) {
    const count = seq[i] - seq[i - 1] - 1;
    if (count > 0) lost.push({ us: us[i - 1], count });
  }
  const eventColumns = events.columns;
  return {
    folder,
    meta,
    imu: { us, hostMs: column("host_ms") ?? null, gyro: axes("gyro_%_dps"), accel: axes("accel_%_g") },
    orientation: orientationOf(orientation ?? imu),
    envelope: envelope?.length ? { us: envelope.columns.board_time_us, dbfs: Float32Array.from(envelope.columns.peak, peakToDbfs) } : null,
    events: Array.from({ length: events.length }, (_, i) => ({ us: eventColumns.board_time_us[i], type: eventColumns.type[i], peak: eventColumns.peak[i] })),
    lost,
  };
}

// ---- timebase -----------------------------------------------------------------------------
// A clock maps one board's microseconds to seconds on the session's timebase:
// t = t0 + (us - us0) * perUs.

// Arrivals later than the earliest by more than this are left out of the rough map's second pass.
const LATE_ARRIVAL_MS = 20;

function lineFit(x, y, keep) {
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < x.length; i++) {
    if (!keep(i)) continue;
    n++;
    sx += x[i];
    sy += y[i];
    sxx += x[i] * x[i];
    sxy += x[i] * y[i];
  }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  return { slope, intercept: (sy - slope * sx) / n };
}

/**
 * A rough map from a live recording's board clock to the computer's, from when each IMU batch
 * arrived (host_ms): { us0, h0 (host ms at us0), perUs (host ms per board µs) }. A batch only ever
 * arrives late, so the line rests on the earliest arrivals. Good to ~10-20 ms.
 */
export function roughHostClock(us, hostMs) {
  const us0 = us[0];
  const h0 = hostMs[0];
  // Relative to the first point: epoch milliseconds leave little precision for the fraction.
  const x = Float64Array.from(us, (value) => value - us0);
  const y = Float64Array.from(hostMs, (value) => value - h0);
  let fit = x.length > 1 && x.at(-1) > 0 ? lineFit(x, y, () => true) : { slope: 1e-3, intercept: 0 };
  const residual = (i) => y[i] - (fit.intercept + fit.slope * x[i]);
  const restOnEarliest = () => {
    let lowest = Infinity;
    for (let i = 0; i < x.length; i++) lowest = Math.min(lowest, residual(i));
    fit.intercept += lowest;
  };
  restOnEarliest();
  const early = (i) => residual(i) <= LATE_ARRIVAL_MS;
  let earlyCount = 0;
  for (let i = 0; i < x.length; i++) if (early(i)) earlyCount++;
  if (earlyCount >= 2 && x.length > 1 && x.at(-1) > 0) {
    fit = lineFit(x, y, early);
    restOnEarliest();
  }
  return { us0, h0: h0 + fit.intercept, perUs: fit.slope };
}

/** A board's map to the computer's clock (see roughHostClock), or null if the files have none. */
function hostClock(board) {
  if (board.imu.hostMs) return roughHostClock(board.imu.us, board.imu.hostMs);
  // A flash recording carries the computer's time of its start command.
  const { host_epoch_ms: epochMs, start_us: startUs } = board.meta;
  return epochMs && startUs != null ? { us0: startUs, h0: epochMs, perUs: 1e-3 } : null;
}

/**
 * Every board's clock on one timebase, in seconds, from the best that the files allow:
 * - "computer": the computer's clock (live: when data arrived; flash: the start command's time),
 *   t = 0 at the earliest board's first sample;
 * - "board": each board's own clock from its own first sample, no shared time at all.
 * Every board needs at least one IMU sample.
 */
export function sessionTimebase(boards) {
  const host = boards.map(hostClock);
  if (boards.length && host.every(Boolean)) {
    const start = Math.min(...host.map((clock, i) => clock.h0 + (boards[i].imu.us[0] - clock.us0) * clock.perUs));
    const clocks = boards.map((board, i) => [board.folder, { us0: host[i].us0, t0: (host[i].h0 - start) / 1000, perUs: host[i].perUs / 1000 }]);
    return { kind: "computer", clocks: new Map(clocks) };
  }
  return { kind: "board", clocks: new Map(boards.map((board) => [board.folder, { us0: board.imu.us[0], t0: 0, perUs: 1e-6 }])) };
}

/**
 * A board placed on the timebase: its times in seconds alongside its data, the stretches USER was
 * held (`presses`, a press with no release lasting to the end) and a summary for the board table.
 */
export function placeBoard(board, { us0, t0, perUs }) {
  const seconds = (us) => t0 + (us - us0) * perUs;
  const times = (us) => Float64Array.from(us, seconds);
  const imuT = times(board.imu.us);
  const events = board.events.map((event) => ({ ...event, t: seconds(event.us) })).sort((a, b) => a.t - b.t);
  const n = imuT.length;
  const presses = [];
  let held = null;
  for (const event of events) {
    if (event.type === "press" && !held) presses.push((held = { from: event.t, to: imuT[n - 1] }));
    else if (event.type === "release" && held) {
      held.to = event.t;
      held = null;
    }
  }
  const boardSpanS = n > 1 ? (board.imu.us[n - 1] - board.imu.us[0]) / 1e6 : 0;
  return {
    board,
    imuT,
    orientationT: board.orientation ? times(board.orientation.us) : null,
    envelopeT: board.envelope ? times(board.envelope.us) : null,
    events,
    presses,
    lost: board.lost.map((gap) => ({ ...gap, t: seconds(gap.us) })),
    summary: {
      samples: n,
      seconds: boardSpanS,
      rateHz: boardSpanS > 0 ? (n - 1) / boardSpanS : 0,
      lost: board.lost.reduce((sum, gap) => sum + gap.count, 0),
      claps: events.filter((event) => event.type === "sync").length,
      presses: events.filter((event) => event.type === "press").length,
      envelopeWindows: board.envelope?.us.length ?? 0,
    },
  };
}

// ---- views --------------------------------------------------------------------------------

/** The first index whose time is at or after t (times ascending); times.length if none. */
export function lowerBound(times, t) {
  let low = 0;
  let high = times.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (times[mid] < t) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** The index of the time nearest t, or -1 if there are none. */
export function nearestIndex(times, t) {
  if (!times.length) return -1;
  const after = Math.min(lowerBound(times, t), times.length - 1);
  return after > 0 && t - times[after - 1] < times[after] - t ? after - 1 : after;
}

/**
 * The smallest and largest value in each of `columns` equal slices of [t0, t1], for drawing more
 * samples than there are pixel columns. A slice with no samples is NaN in both.
 */
export function columnExtents(times, values, t0, t1, columns) {
  const min = new Float32Array(columns).fill(NaN);
  const max = new Float32Array(columns).fill(NaN);
  const perSecond = columns / (t1 - t0);
  for (let i = lowerBound(times, t0); i < times.length && times[i] <= t1; i++) {
    const column = Math.min(columns - 1, Math.floor((times[i] - t0) * perSecond));
    const value = values[i];
    if (!(value >= min[column])) min[column] = value;
    if (!(value <= max[column])) max[column] = value;
  }
  return { min, max };
}

/** `view` ({ t0, t1 }, seconds) slid into `bounds`, keeping its span unless bounds are shorter. */
export function clampView({ t0, t1 }, bounds) {
  const span = Math.min(t1 - t0, bounds.t1 - bounds.t0);
  const start = Math.min(Math.max(t0, bounds.t0), bounds.t1 - span);
  return { t0: start, t1: start + span };
}

/** `view` zoomed by `factor` (< 1 zooms in) about time `anchor`, no shorter than minSpan. */
export function zoomView(view, factor, anchor, bounds, minSpan) {
  const span = Math.min(bounds.t1 - bounds.t0, Math.max(minSpan, (view.t1 - view.t0) * factor));
  const fraction = (anchor - view.t0) / (view.t1 - view.t0);
  const t0 = anchor - fraction * span;
  return clampView({ t0, t1: t0 + span }, bounds);
}

/** `view` moved later by dt seconds (earlier if negative), within bounds. */
export function panView(view, dt, bounds) {
  return clampView({ t0: view.t0 + dt, t1: view.t1 + dt }, bounds);
}

/**
 * The multiples of `step` from t0 to t1. Rounding can put a session's start a hair after 0 (or its
 * end a hair before a tick); those ticks still count.
 */
export function tickTimes(t0, t1, step) {
  const ticks = [];
  for (let k = Math.ceil(t0 / step - 1e-6); k * step <= t1 + step * 1e-6; k++) ticks.push(k * step || 0); // not -0
  return ticks;
}

/** A round tick step (1, 2 or 5 × a power of ten) giving about `count` ticks across `span`. */
export function niceStep(span, count) {
  const raw = span / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * power).find((step) => step >= raw * 0.999);
}
