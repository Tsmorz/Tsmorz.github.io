// Wire formats shared with the firmware (src/sysid_wire.h for the recorded data streams,
// src/dashboard_wire.h for the control service). Pure functions only, no DOM or Bluetooth, so
// tests/dashboard/wire.test.mjs can run them in Node. Everything on the wire is little-endian.

// Control service: LED, mouse settings, latency (DASHBOARD_PROTOCOL_VERSION in dashboard_wire.h).
export const PROTOCOL_VERSION = 2;
// Data streams: IMU, mic envelope, events, board info (SYSID_WIRE_VERSION in sysid_wire.h).
export const DATA_VERSION = 1;

export const TELEMETRY_SERVICE = "6f524c01-0001-4a3c-9d21-1122334455aa";
export const TELEMETRY_LED = "6f524c01-0003-4a3c-9d21-1122334455aa";
export const TELEMETRY_MOUSE = "6f524c01-0004-4a3c-9d21-1122334455aa";
export const TELEMETRY_LATENCY = "6f524c01-0005-4a3c-9d21-1122334455aa";
export const TELEMETRY_BATTERY = "6f524c01-0006-4a3c-9d21-1122334455aa";
export const TELEMETRY_POWER = "6f524c01-0007-4a3c-9d21-1122334455aa";
export const TELEMETRY_IMU_RANGES = "6f524c01-0008-4a3c-9d21-1122334455aa";
export const TELEMETRY_MOTION_WAKE = "6f524c01-0009-4a3c-9d21-1122334455aa";
export const TELEMETRY_CLOCK = "6f524c01-000a-4a3c-9d21-1122334455aa";
export const DATA_SERVICE = "6f524c03-0001-4a3c-9d21-1122334455aa";
export const DATA_IMU = "6f524c03-0002-4a3c-9d21-1122334455aa";
export const DATA_ENVELOPE = "6f524c03-0003-4a3c-9d21-1122334455aa";
export const DATA_EVENTS = "6f524c03-0004-4a3c-9d21-1122334455aa";
export const DATA_INFO = "6f524c03-0005-4a3c-9d21-1122334455aa";
export const DATA_SPECTRUM = "6f524c03-0006-4a3c-9d21-1122334455aa";
export const DATA_CLOCK = "6f524c03-0007-4a3c-9d21-1122334455aa";
// On-board recording (src/logger/log_service.c; formats in src/log_format.h, LOG_WIRE_VERSION).
export const LOG_SERVICE = "6f524c04-0001-4a3c-9d21-1122334455aa";
export const LOG_COMMAND = "6f524c04-0002-4a3c-9d21-1122334455aa";
export const LOG_STATUS = "6f524c04-0003-4a3c-9d21-1122334455aa";
export const LOG_DATA = "6f524c04-0004-4a3c-9d21-1122334455aa";
export const LOG_VERSION = 1;
export const LOG_STATES = ["idle", "recording", "erasing", "reading", "full", "error"];
// Keyword clips for training voice commands (src/keyword/keyword_service.c; formats in
// src/keyword_wire.h, KEYWORD_WIRE_VERSION).
export const KEYWORD_SERVICE = "6f524c05-0001-4a3c-9d21-1122334455aa";
export const KEYWORD_COMMAND = "6f524c05-0002-4a3c-9d21-1122334455aa";
export const KEYWORD_CLIP = "6f524c05-0003-4a3c-9d21-1122334455aa";
export const KEYWORD_SETTINGS = "6f524c05-0004-4a3c-9d21-1122334455aa";
export const KEYWORD_AUDIO = "6f524c05-0005-4a3c-9d21-1122334455aa";
// The voice model's labels, in its output order (src/voice_commands.h, training/labels.py:
// tests/test_training_labels.py checks all three agree), and what a keyword event says was done.
export const VOICE_LABELS = [
  "_silence", "_unknown", "pointer_online", "freeze_cursor", "begin_recording", "capture_complete", "power_down_now", "mark_this_moment",
];
export const VOICE_COMMANDS = VOICE_LABELS.slice(2);
export const VOICE_OUTCOMES = ["done", "say again", "not this board's", "refused"];
const KEYWORD_AUDIO_HEADER_BYTES = 10;
export const KEYWORD_VERSION = 1;
const KEYWORD_CLIP_HEADER_BYTES = 7;
const LOG_STATUS_BYTES = 36;
const LOG_ERASE_CONFIRM = 0xe5a5e5a5;

export const MOUSE_SETTINGS_BYTES = 4;
export const MOUSE_SPEED_PERCENT = { min: 10, default: 100, max: 300 };

// struct dashboard_latency_report / dashboard_latency_command in dashboard_wire.h.
export const LATENCY_REPORT_BYTES = 57;
export const LATENCY_COMMAND_RESET = 1;

const IMU_HEADER_BYTES = 12;
const IMU_SAMPLE_BYTES = 25;
const ENVELOPE_HEADER_BYTES = 10;
const SPECTRUM_HEADER_BYTES = 13;
// A spectrum level byte is half-dB steps above this (MIC_SPECTRUM_FLOOR_DBFS in mic_spectrum.h).
export const SPECTRUM_FLOOR_DBFS = -127.5;
const EVENT_BYTES = 12;
const BOARD_INFO_BYTES = 20;
const Q14 = 16384;

// enum sysid_event_type in sysid_wire.h.
export const EVENT_TYPES = { 1: "sync", 2: "press", 3: "release", 4: "temperature", 5: "tap", 6: "double_tap", 7: "keyword" };
const CLOCK_PAIR_BYTES = 15;

/** A temperature event's value in degrees C: the IMU's raw OUT_TEMP count, signed, 256 per degree from 25. */
export function temperatureFromEvent(peak) {
  return 25 + ((peak << 16) >> 16) / 256;
}

/**
 * Decodes one IMU batch: consecutive samples, raw counts as sent (scale them with the board
 * info's gyroDpsPerLsb / accelGPerLsb). Times are the board's microseconds, low 32 bits only.
 */
export function decodeImuBatch(view) {
  if (view.byteLength < IMU_HEADER_BYTES || view.getUint8(0) !== DATA_VERSION) return null;
  const count = view.getUint8(1);
  if (view.byteLength !== IMU_HEADER_BYTES + count * IMU_SAMPLE_BYTES) return null;
  const i16 = (offset) => view.getInt16(offset, true);
  const firstSeq = view.getUint32(2, true);
  const samples = [];
  for (let i = 0; i < count; i++) {
    const at = IMU_HEADER_BYTES + i * IMU_SAMPLE_BYTES;
    samples.push({
      seq: (firstSeq + i) >>> 0,
      tUs: view.getUint32(at, true),
      gyroRaw: [i16(at + 4), i16(at + 6), i16(at + 8)],
      accelRaw: [i16(at + 10), i16(at + 12), i16(at + 14)],
      quat: { w: i16(at + 16) / Q14, x: i16(at + 18) / Q14, y: i16(at + 20) / Q14, z: i16(at + 22) / Q14 },
      atRest: Boolean(view.getUint8(at + 24) & 1),
    });
  }
  return { firstSeq, gyroBiasDps: [i16(6) / 100, i16(8) / 100, i16(10) / 100], samples };
}

/** Decodes one mic envelope batch: the peak level of consecutive 1 ms windows. */
export function decodeEnvelopeBatch(view) {
  if (view.byteLength < ENVELOPE_HEADER_BYTES || view.getUint8(0) !== DATA_VERSION) return null;
  const count = view.getUint8(1);
  if (view.byteLength !== ENVELOPE_HEADER_BYTES + count * 2) return null;
  const peaks = Array.from({ length: count }, (_, i) => view.getUint16(ENVELOPE_HEADER_BYTES + i * 2, true));
  return { firstWindow: view.getUint32(2, true), tUs: view.getUint32(6, true), peaks };
}

/**
 * Decodes one mic spectrum batch: consecutive frames, each the level of every frequency bin in
 * dBFS (SPECTRUM_FLOOR_DBFS or below reads as the floor). Bin b is centred on
 * b * micRateHz / (2 * bins); frames start frameSamples mic samples apart.
 */
export function decodeSpectrumBatch(view) {
  if (view.byteLength < SPECTRUM_HEADER_BYTES || view.getUint8(0) !== DATA_VERSION) return null;
  const count = view.getUint8(1);
  const bins = view.getUint8(2);
  if (!bins || view.byteLength !== SPECTRUM_HEADER_BYTES + count * bins) return null;
  const frames = Array.from({ length: count }, (_, frame) => {
    const levels = new Float32Array(bins);
    for (let b = 0; b < bins; b++) levels[b] = view.getUint8(SPECTRUM_HEADER_BYTES + frame * bins + b) / 2 + SPECTRUM_FLOOR_DBFS;
    return levels;
  });
  return {
    frameSamples: view.getUint16(3, true),
    firstFrame: view.getUint32(5, true),
    tUs: view.getUint32(9, true),
    bins,
    frames,
  };
}

/** Decodes one event: a clap sync mark or a USER button press/release. */
export function decodeEvent(view) {
  if (view.byteLength !== EVENT_BYTES || view.getUint8(0) !== DATA_VERSION) return null;
  return {
    type: EVENT_TYPES[view.getUint8(1)] ?? "unknown",
    seq: view.getUint32(2, true),
    tUs: view.getUint32(6, true),
    peak: view.getUint16(10, true),
  };
}

const hexId = (id) => id.toString(16).toUpperCase().padStart(4, "0");

/**
 * Decodes one radio clock pair (struct sysid_clock_pair): the source board's packet `counter`
 * happened at sourceTUs on the source's clock and tUs on this board's, both low 32 bits.
 */
export function decodeClockPair(view) {
  if (view.byteLength !== CLOCK_PAIR_BYTES || view.getUint8(0) !== DATA_VERSION) return null;
  return {
    sourceBoard: hexId(view.getUint16(1, true)),
    counter: view.getUint32(3, true),
    sourceTUs: view.getUint32(7, true),
    tUs: view.getUint32(11, true),
  };
}

/** Decodes the board info: its ID and the scales its data needs. */
export function decodeBoardInfo(view) {
  if (view.byteLength !== BOARD_INFO_BYTES || view.getUint8(0) !== DATA_VERSION) return null;
  return {
    boardId: hexId(view.getUint16(1, true)),
    imuRateHz: view.getUint16(3, true),
    gyroDpsPerLsb: view.getFloat32(5, true),
    accelGPerLsb: view.getFloat32(9, true),
    micRateHz: view.getUint16(13, true),
    envelopeWindowSamples: view.getUint8(15),
    imuDropped: view.getUint32(16, true),
  };
}

/** Number of items lost between two consecutive 32-bit sequence numbers (wrap aware). */
export function missedSince(previousSeq, seq) {
  return (seq - previousSeq - 1) >>> 0;
}

const clampByte = (value) => Math.max(0, Math.min(255, Math.round(value)));

/** Encodes the LED colour the firmware's dashboard_decode_led_color() expects. */
export function encodeLedColor({ red, green, blue }) {
  return Uint8Array.of(PROTOCOL_VERSION, clampByte(red), clampByte(green), clampByte(blue));
}

/** Decodes the colour the board's LED shows (read and notified), or null if it is not that. */
export function decodeLedColor(view) {
  if (view.byteLength !== 4 || view.getUint8(0) !== PROTOCOL_VERSION) return null;
  return { red: view.getUint8(1), green: view.getUint8(2), blue: view.getUint8(3) };
}

// The IMU's full-scale ranges (struct dashboard_imu_ranges, imu_format.h): degrees/sec and g.
export const GYRO_RANGES_DPS = [125, 250, 500, 1000, 2000];
export const ACCEL_RANGES_G = [2, 4, 8, 16];
const IMU_RANGES_BYTES = 4;

/** Encodes the ranges the firmware's dashboard_decode_imu_ranges() expects; null for one it lacks. */
export function encodeImuRanges({ gyroDps, accelG }) {
  if (!GYRO_RANGES_DPS.includes(gyroDps) || !ACCEL_RANGES_G.includes(accelG)) return null;
  const bytes = new Uint8Array(IMU_RANGES_BYTES);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, PROTOCOL_VERSION);
  view.setUint16(1, gyroDps, true);
  view.setUint8(3, accelG);
  return bytes;
}

/** Decodes the ranges the board reads back, or null if they are not that. */
export function decodeImuRanges(view) {
  if (view.byteLength !== IMU_RANGES_BYTES || view.getUint8(0) !== PROTOCOL_VERSION) return null;
  const ranges = { gyroDps: view.getUint16(1, true), accelG: view.getUint8(3) };
  return GYRO_RANGES_DPS.includes(ranges.gyroDps) && ACCEL_RANGES_G.includes(ranges.accelG) ? ranges : null;
}

/** Encodes wake on motion as the firmware's dashboard_decode_motion_wake() expects. */
export const encodeMotionWake = (enabled) => Uint8Array.of(PROTOCOL_VERSION, enabled ? 1 : 0);

/** Decodes whether the board wakes on motion (true/false), or null. */
export function decodeMotionWake(view) {
  if (view.byteLength !== 2 || view.getUint8(0) !== PROTOCOL_VERSION || view.getUint8(1) > 1) return null;
  return view.getUint8(1) === 1;
}

// The radio clock sync (struct dashboard_clock_status, dashboard_wire.h).
export const CLOCK_ROLES = ["listener", "source"];
export const CLOCK_STATES = ["searching", "synced", "broadcasting", "failed"];

/** Encodes a role ("listener" or "source") as dashboard_decode_clock_role() expects; null otherwise. */
export function encodeClockRole(role) {
  const index = CLOCK_ROLES.indexOf(role);
  return index < 0 ? null : Uint8Array.of(PROTOCOL_VERSION, index);
}

/** Decodes the board's clock role and state, and the source it hears (or is), or null. */
export function decodeClockStatus(view) {
  if (view.byteLength !== 5 || view.getUint8(0) !== PROTOCOL_VERSION) return null;
  const source = view.getUint16(3, true);
  return {
    role: CLOCK_ROLES[view.getUint8(1)] ?? "unknown",
    state: CLOCK_STATES[view.getUint8(2)] ?? "unknown",
    sourceBoard: source ? hexId(source) : null,
  };
}

/** Encodes the mouse settings the firmware's dashboard_decode_mouse_settings() expects. */
export function encodeMouseSettings({ enabled, speedPercent }) {
  const bytes = new Uint8Array(MOUSE_SETTINGS_BYTES);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, PROTOCOL_VERSION);
  view.setUint8(1, enabled ? 1 : 0);
  // Out-of-range speeds clamp to what the firmware accepts rather than being rejected by it.
  const speed = Math.max(MOUSE_SPEED_PERCENT.min, Math.min(MOUSE_SPEED_PERCENT.max, Math.round(speedPercent)));
  view.setUint16(2, speed, true);
  return bytes;
}

/** Decodes the mouse settings the board reads and notifies, or null if they are not that. */
export function decodeMouseSettings(view) {
  if (view.byteLength !== MOUSE_SETTINGS_BYTES || view.getUint8(0) !== PROTOCOL_VERSION) return null;
  return { enabled: view.getUint8(1) !== 0, speedPercent: view.getUint16(2, true) };
}

/**
 * Decodes the bench latency probe's results, or null if they are not that. Times stay in
 * microseconds, as sent: "ack" is IMU sample to the host's radio acknowledging the HID report,
 * "queue" is IMU sample to the report being handed to the board's Bluetooth stack.
 */
export function decodeLatencyReport(view) {
  if (view.byteLength !== LATENCY_REPORT_BYTES || view.getUint8(0) !== PROTOCOL_VERSION) return null;
  const u32 = (offset) => view.getUint32(offset, true);
  return {
    elapsedMs: u32(1),
    imuSamples: u32(5),
    reports: u32(9),
    deferred: u32(13),
    sendErrors: u32(17),
    connIntervalUs: u32(21),
    ackUs: { min: u32(25), p50: u32(29), p90: u32(33), p99: u32(37), max: u32(41) },
    queueUs: { p50: u32(45), max: u32(49) },
    loopMaxUs: u32(53),
  };
}

// struct dashboard_battery in dashboard_wire.h; enum battery_state in battery_level.h.
export const BATTERY_BYTES = 11;
export const BATTERY_STATES = ["absent", "discharging", "charging", "charged", "fault"];

/** Decodes a battery reading, or null if it is not one. Unknown values come back as null. */
export function decodeBattery(view) {
  if (view.byteLength !== BATTERY_BYTES || view.getUint8(0) !== PROTOCOL_VERSION) return null;
  const percent = view.getUint8(2);
  const temp = view.getInt16(7, true);
  const hours = view.getUint16(9, true);
  return {
    state: BATTERY_STATES[view.getUint8(1)] ?? "unknown",
    percent: percent === 0xff ? null : percent,
    volts: view.getUint16(3, true) / 1000,
    currentMa: view.getInt16(5, true) / 10,
    tempC: temp === -32768 ? null : temp / 10,
    hoursLeft: hours === 0xffff ? null : hours,
  };
}

/** Puts the board to sleep (as a 5 s USER hold does); a USER press wakes it. */
export const encodeSleep = () => Uint8Array.of(PROTOCOL_VERSION, 1);

/** Encodes the command that clears the latency probe, to start a measurement. */
export function encodeLatencyReset() {
  return Uint8Array.of(PROTOCOL_VERSION, LATENCY_COMMAND_RESET);
}

/** Decodes the on-board recorder's status. */
export function decodeLogStatus(view) {
  if (view.byteLength !== LOG_STATUS_BYTES || view.getUint8(0) !== LOG_VERSION) return null;
  const u32 = (offset) => view.getUint32(offset, true);
  return {
    state: LOG_STATES[view.getUint8(1)] ?? "unknown",
    error: view.getInt16(2, true),
    usedBytes: u32(4),
    capacityBytes: u32(8),
    sessionTag: u32(12),
    recordingS: u32(16),
    droppedBytes: u32(20),
    read: { offset: u32(24), length: u32(28), crc32: u32(32) },
  };
}

/** Starts recording to the board's flash. Boards started together share sessionTag. */
export function encodeLogStart(sessionTag, hostEpochMs) {
  const bytes = new Uint8Array(14);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, LOG_VERSION);
  view.setUint8(1, 1);
  view.setUint32(2, sessionTag, true);
  view.setBigUint64(6, BigInt(Math.round(hostEpochMs)), true);
  return bytes;
}

export const encodeLogStop = () => Uint8Array.of(LOG_VERSION, 2);

/** Erases the whole log. The confirmation word is what stops a stray write from doing it. */
export function encodeLogErase() {
  const bytes = new Uint8Array(6);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, LOG_VERSION);
  view.setUint8(1, 3);
  view.setUint32(2, LOG_ERASE_CONFIRM, true);
  return bytes;
}

/** Asks for log bytes [offset, offset + length) to be streamed back on the data characteristic. */
export function encodeLogRead(offset, length) {
  const bytes = new Uint8Array(10);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, LOG_VERSION);
  view.setUint8(1, 4);
  view.setUint32(2, offset, true);
  view.setUint32(6, length, true);
  return bytes;
}

/** One read-out chunk: the offset of its first byte, then the bytes. */
export function decodeLogChunk(view) {
  if (view.byteLength < 4) return null;
  return { offset: view.getUint32(0, true), bytes: new Uint8Array(view.buffer, view.byteOffset + 4, view.byteLength - 4) };
}

/** Asks the board to capture its next 2 s of microphone and send it back as clip `clipId`. */
export function encodeClipCapture(clipId) {
  const bytes = new Uint8Array(4);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, KEYWORD_VERSION);
  view.setUint8(1, 1);
  view.setUint16(2, clipId, true);
  return bytes;
}

/** One chunk of a clip: which clip, its length, where this chunk starts, and its samples. */
export function decodeClipChunk(view) {
  if (view.byteLength < KEYWORD_CLIP_HEADER_BYTES || view.getUint8(0) !== KEYWORD_VERSION) return null;
  const count = Math.floor((view.byteLength - KEYWORD_CLIP_HEADER_BYTES) / 2);
  const samples = new Int16Array(count);
  for (let i = 0; i < count; i++) samples[i] = view.getInt16(KEYWORD_CLIP_HEADER_BYTES + 2 * i, true);
  return { clipId: view.getUint16(1, true), totalSamples: view.getUint16(3, true), firstSample: view.getUint16(5, true), samples };
}

/** Starts the board streaming its mic (ADPCM) as stream `streamId`, until encodeStreamStop(). */
export const encodeStreamStart = (streamId) => Uint8Array.of(KEYWORD_VERSION, 2, streamId & 0xff, (streamId >> 8) & 0xff);
export const encodeStreamStop = () => Uint8Array.of(KEYWORD_VERSION, 3);

/** One chunk of the background-audio stream: where it starts, the ADPCM state, and its bytes. */
export function decodeAudioChunk(view) {
  if (view.byteLength <= KEYWORD_AUDIO_HEADER_BYTES || view.getUint8(0) !== KEYWORD_VERSION) return null;
  return {
    streamId: view.getUint16(1, true),
    firstSample: view.getUint32(3, true),
    predictor: view.getInt16(7, true),
    stepIndex: view.getUint8(9),
    adpcm: new Uint8Array(view.buffer, view.byteOffset + KEYWORD_AUDIO_HEADER_BYTES, view.byteLength - KEYWORD_AUDIO_HEADER_BYTES),
  };
}

/** The board's voice settings: listening, which commands it obeys (by name), and whether it has a model. */
export function decodeKeywordSettings(view) {
  if (view.byteLength !== 3 || view.getUint8(0) !== KEYWORD_VERSION) return null;
  const flags = view.getUint8(1);
  const bits = view.getUint8(2);
  return { listening: Boolean(flags & 1), hasModel: Boolean(flags & 2), obeyed: VOICE_COMMANDS.filter((_, i) => bits & (1 << i)) };
}

export function encodeKeywordSettings({ listening, obeyed }) {
  const bits = VOICE_COMMANDS.reduce((sum, name, i) => (obeyed.includes(name) ? sum | (1 << i) : sum), 0);
  return Uint8Array.of(KEYWORD_VERSION, listening ? 1 : 0, bits);
}

/** A keyword event's value (voice_event_value()): which label was heard and what the board did. */
export function decodeKeywordEvent(peak) {
  return { label: VOICE_LABELS[peak & 0xff] ?? "unknown", outcome: VOICE_OUTCOMES[peak >> 8] ?? "unknown" };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** IEEE CRC-32, matching Zephyr's crc32_ieee(). */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
