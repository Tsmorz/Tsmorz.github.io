// Reading a board's on-board recording (src/log_format.h) back into recordings, and turning one
// into CSV files. Pure functions only, no DOM or Bluetooth, so tests/dashboard/flashlog.test.mjs
// can run them in Node. Everything is little-endian.
import { buttonStatesAt, scaleDecimals } from "./recording.js";
import { temperatureFromEvent } from "./wire.js";

const REC = { PAD: 0x00, IMU: 0x01, TIME: 0x02, ORIENT: 0x03, EVENT: 0x04, END: 0x05, START: 0xa5, ERASED: 0xff };
const SIZE = { [REC.IMU]: 15, [REC.TIME]: 13, [REC.ORIENT]: 16, [REC.EVENT]: 16, [REC.END]: 18, [REC.START]: 39 };
const SESSION_MAGIC = 0x4c535953; // "SYSL"
const EVENT_NAMES = { 1: "sync", 2: "press", 3: "release", 4: "temperature" };
const Q14 = 16384;

const u64 = (view, offset) => Number(view.getBigUint64(offset, true));

function decodeStart(view, at) {
  return {
    version: view.getUint8(at + 5),
    boardId: view.getUint16(at + 6, true).toString(16).toUpperCase().padStart(4, "0"),
    sessionTag: view.getUint32(at + 8, true),
    hostEpochMs: u64(view, at + 12),
    startUs: u64(view, at + 20),
    imuRateHz: view.getUint16(at + 28, true),
    gyroDpsPerLsb: view.getFloat32(at + 30, true),
    accelGPerLsb: view.getFloat32(at + 34, true),
    orientEvery: view.getUint8(at + 38),
  };
}

function isSessionStart(view, at) {
  return at + SIZE[REC.START] <= view.byteLength && view.getUint8(at) === REC.START && view.getUint32(at + 1, true) === SESSION_MAGIC;
}

/** Offset of the next SESSION_START at or after `from` (and before `to`), or -1. */
function findSessionStart(view, from, to = view.byteLength) {
  for (let at = from; at < to && at + SIZE[REC.START] <= view.byteLength; at++) if (isSessionStart(view, at)) return at;
  return -1;
}

/**
 * Splits a log into its recordings. Each has its `start` header, every IMU sample (raw counts,
 * board time in µs, seq), the ~10 Hz orientation, its events, and `end` (null if it was cut off,
 * e.g. by a power loss). Damage is reported in `problems` and skipped to the next recording.
 */
export function decodeFlashLog(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sessions = [];
  const problems = [];
  let session = null;
  let t = 0;
  let seq = 0;
  let lastImu = null;

  const close = () => {
    if (session) sessions.push(session);
    session = null;
  };

  let at = 0;
  while (at < view.byteLength) {
    const type = view.getUint8(at);
    if (type === REC.ERASED) break;
    if (type === REC.PAD) {
      at++;
      continue;
    }
    const size = SIZE[type];
    const fits = size !== undefined && at + size <= view.byteLength;
    // A record cut short by a power loss is followed directly by the next recording's padding and
    // header, which would otherwise be read as the rest of it.
    const cutShort = fits && findSessionStart(view, at + 1, at + size) >= 0;
    if (!fits || cutShort || (type === REC.START && !isSessionStart(view, at)) || (type !== REC.START && !session)) {
      const next = findSessionStart(view, at + 1);
      problems.push(`unreadable data at byte ${at}${next < 0 ? ", to the end" : `, skipped to ${next}`}`);
      close();
      if (next < 0) break;
      at = next;
      continue;
    }

    switch (type) {
      case REC.START:
        close();
        session = { start: decodeStart(view, at), imu: [], orient: [], events: [], temperatures: [], end: null };
        lastImu = null;
        break;
      case REC.TIME:
        t = u64(view, at + 1);
        seq = view.getUint32(at + 9, true);
        break;
      case REC.IMU: {
        t += view.getUint16(at + 1, true);
        const i16 = (k) => view.getInt16(at + 3 + 2 * k, true);
        lastImu = { tUs: t, seq, gyroRaw: [i16(0), i16(1), i16(2)], accelRaw: [i16(3), i16(4), i16(5)] };
        session.imu.push(lastImu);
        seq = (seq + 1) >>> 0;
        break;
      }
      case REC.ORIENT: {
        const i16 = (k) => view.getInt16(at + 1 + 2 * k, true);
        if (lastImu) {
          session.orient.push({
            tUs: lastImu.tUs, seq: lastImu.seq,
            quat: { w: i16(0) / Q14, x: i16(1) / Q14, y: i16(2) / Q14, z: i16(3) / Q14 },
            biasDps: [i16(4) / 100, i16(5) / 100, i16(6) / 100],
            atRest: Boolean(view.getUint8(at + 15) & 1),
          });
        }
        break;
      }
      case REC.EVENT: {
        const event = {
          type: EVENT_NAMES[view.getUint8(at + 1)] ?? "unknown",
          seq: view.getUint32(at + 2, true),
          tUs: u64(view, at + 6),
          peak: view.getUint16(at + 14, true),
        };
        if (event.type === "temperature") session.temperatures.push({ tUs: event.tUs, celsius: temperatureFromEvent(event.peak) });
        else session.events.push(event);
        break;
      }
      case REC.END:
        session.end = { endUs: u64(view, at + 1), imuSamples: view.getUint32(at + 9, true), droppedBytes: view.getUint32(at + 13, true) };
        close();
        break;
    }
    at += size;
  }
  close();
  return { sessions, problems };
}

/**
 * The session tag of the log's first recording, if `bytes` (the log from its start) begin with one:
 * a log erased and recorded again starts with a different tag, so this tells whether a board still
 * holds the log the page uploaded part of before.
 */
export function firstSessionTag(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return isSessionStart(view, 0) ? decodeStart(view, 0).sessionTag : null;
}

/**
 * Whether a piece of the log read from where an earlier upload ended starts where a recording
 * would: padding, then a recording's header or the erased end. Anything else means the log was
 * erased and recorded over since, and only a read from its start gets every recording whole.
 */
export function startsWithSession(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  while (at < view.byteLength && view.getUint8(at) === REC.PAD) at++;
  return at === view.byteLength || view.getUint8(at) === REC.ERASED || isSessionStart(view, at);
}

/** Samples lost within a recording: gaps in seq. */
export function lostSamples(session) {
  let lost = 0;
  for (let i = 1; i < session.imu.length; i++) lost += (session.imu[i].seq - session.imu[i - 1].seq - 1) >>> 0;
  return lost;
}

// The board sends its scales as float32, so 0.07 arrives as 0.0700000003; trim that back.
const cleanScale = (scale) => Math.round(scale * 1e9) / 1e9;
const csv = (columns, rows) => [columns.join(","), ...rows.map((row) => row.join(","))].join("\n") + "\n";

export const FLASH_IMU_COLUMNS = [
  "board_time_us", "seq", "gyro_x_dps", "gyro_y_dps", "gyro_z_dps", "accel_x_g", "accel_y_g", "accel_z_g", "user_button",
];
export const FLASH_ORIENT_COLUMNS = [
  "board_time_us", "seq", "quat_w", "quat_x", "quat_y", "quat_z", "gyro_bias_x_dps", "gyro_bias_y_dps", "gyro_bias_z_dps", "at_rest",
];
export const FLASH_EVENT_COLUMNS = ["board_time_us", "seq", "type", "peak"];
export const FLASH_TEMPERATURE_COLUMNS = ["board_time_us", "temperature_c"];

/** imu.csv, orientation.csv, events.csv and (if recorded) temperature.csv for one recording. */
export function flashSessionFiles(session) {
  const gyro = cleanScale(session.start.gyroDpsPerLsb);
  const accel = cleanScale(session.start.accelGPerLsb);
  const gyroDecimals = scaleDecimals(gyro);
  const accelDecimals = scaleDecimals(accel);
  const buttons = buttonStatesAt(session.imu.map((s) => s.tUs), session.events);
  return {
    "imu.csv": csv(FLASH_IMU_COLUMNS, session.imu.map((s, i) => [
      s.tUs, s.seq, ...s.gyroRaw.map((raw) => (raw * gyro).toFixed(gyroDecimals)), ...s.accelRaw.map((raw) => (raw * accel).toFixed(accelDecimals)), buttons[i],
    ])),
    "orientation.csv": csv(FLASH_ORIENT_COLUMNS, session.orient.map((o) => [
      o.tUs, o.seq, ...[o.quat.w, o.quat.x, o.quat.y, o.quat.z].map((c) => c.toFixed(5)), ...o.biasDps.map((b) => b.toFixed(2)), o.atRest ? 1 : 0,
    ])),
    "events.csv": csv(FLASH_EVENT_COLUMNS, session.events.map((e) => [e.tUs, e.seq, e.type, e.peak])),
    ...(session.temperatures?.length && {
      "temperature.csv": csv(FLASH_TEMPERATURE_COLUMNS, session.temperatures.map((t) => [t.tUs, t.celsius.toFixed(3)])),
    }),
  };
}

/** Local date and time from epoch seconds, sortable: 2026-09-30_14-05-09. */
export function tagName(epochSeconds) {
  const date = new Date(epochSeconds * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

/**
 * Groups recordings from several boards into sessions. Boards started together from the
 * dashboard share a session tag (the start time, in epoch seconds); one started with the USER
 * button has tag 0 and becomes a session of its own. Returns [{ name, boards: [{ board, session }] }].
 */
export function groupSessions(perBoard) {
  const groups = new Map();
  for (const { board, sessions } of perBoard) {
    sessions.forEach((session, index) => {
      const tag = session.start.sessionTag;
      const name = tag ? `flash_${tagName(tag)}` : `flash_${session.start.boardId}_${index + 1}`;
      if (!groups.has(name)) groups.set(name, { name, boards: [] });
      groups.get(name).boards.push({ board, session });
    });
  }
  return [...groups.values()];
}
