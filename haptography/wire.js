import { decodeHealth, decodeProfile } from "./device-health.js";
// The recording device's serial stream (capture/ in nrf-controller): COBS-framed packets with a
// type, a packet number and a CRC-16. The layout is src/capture_wire.h's, the same one
// recording/wire.py reads; tests/haptography/wire.test.mjs reads the versioned C encoder fixture stream
// with this file and checks VERSION and packet types against its generated contract. Pure: no DOM.

export const VERSION = 5;
// Version 2 recordings (before the actuators) read the same: INFO and STATS were shorter, and the
// fields they lacked are left out.
export const OLDEST_VERSION = 2;

export const HEALTH = 10;
export const PROFILE = 11;
export const INFO = 1;
export const IMU = 2;
// 3 was the board's orientation, dropped: the PC works it out from the IMU samples
export const MIC = 4;
export const TOF = 5;
export const STATS = 6;
export const TEXT = 7;
export const ACK = 8; // the answer to a command from the PC
export const PLAYBACK = 9; // an actuator played something: when, and how it went

export const INFO_IMU_OK = 0x01;
export const INFO_MIC_OK = 0x02;
export const INFO_TOF_OK = 0x04;
export const INFO_TACHAMMER_OK = 0x08;
export const INFO_ERM_OK = 0x10;

export const PLAYBACK_KINDS = { 1: "waveform", 2: "clip", 3: "ERM effect", 4: "ERM pulse" };
export const PLAYBACK_OUTCOMES = { 0: "played", 1: "stopped", 2: "failed" };

export const IMU_MAX_SAMPLES = 32;
export const MIC_MAX_SAMPLES = 160;
export const TEXT_MAX = 120;

// A packet longer than this (encoded) can't be one of ours: the reader gives up on it.
export const MAX_ENCODED = 600;

export const STATS_FIELDS = [
  "t_us", "imu_samples", "imu_dropped", "mic_blocks", "mic_errors", "tof_readings",
  "tof_errors", "tx_packets", "tx_dropped", "tx_bytes", "tx_peak_bytes",
  // version 3
  "rx_commands", "rx_bad", "haptic_errors",
];

/** CRC-16/CCITT-FALSE, as capture_wire_crc16(). */
export function crc16(bytes, start = 0, end = bytes.length) {
  let crc = 0xffff;
  for (let i = start; i < end; i++) {
    crc ^= bytes[i] << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

/** One packet's COBS bytes (without the closing zero) back to its frame; null if invalid. */
export function cobsDecode(data) {
  const out = new Uint8Array(data.length);
  let o = 0;
  let i = 0;
  while (i < data.length) {
    const code = data[i++];
    if (code === 0 || i + code - 1 > data.length) return null;
    for (let k = 1; k < code; k++) {
      const b = data[i++];
      if (b === 0) return null;
      out[o++] = b;
    }
    // A block shorter than 254 data bytes stood for a zero, unless it was the last.
    if (code < 0xff && i < data.length) out[o++] = 0;
  }
  return out.subarray(0, o);
}

/** COBS-encode `data`: the result holds no zero bytes (no closing zero added). */
export function cobsEncode(data) {
  const out = new Uint8Array(data.length + Math.floor(data.length / 254) + 2);
  let codeAt = 0;
  let o = 1;
  let code = 1;
  for (let i = 0; i < data.length; i++) {
    if (data[i] === 0) {
      out[codeAt] = code;
      codeAt = o++;
      code = 1;
      continue;
    }
    out[o++] = data[i];
    if (++code === 0xff) {
      out[codeAt] = code;
      codeAt = o++;
      code = 1;
    }
  }
  out[codeAt] = code;
  return out.subarray(0, o);
}

const decoder = new TextDecoder("utf-8");

/** The body of a packet of this type: an object, or the raw bytes for a type this reader doesn't
 *  know. Throws RangeError on a body too short for its type. */
export function parseBody(type, body) {
  const v = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const u64 = (at) => v.getUint32(at, true) + v.getUint32(at + 4, true) * 2 ** 32;
  switch (type) {
    case HEALTH: { const h = decodeHealth(v); if (!h) throw new RangeError("invalid health"); return h; }
    case PROFILE: { const p = decodeProfile(v); if (!p) throw new RangeError("invalid profile"); return p; }
    case INFO: {
      const info = {
        version: v.getUint16(0, true),
        t_us: u64(2),
        board_id: v.getUint16(10, true),
        imu_rate_hz: v.getUint16(12, true),
        gyro_dps_per_lsb: v.getFloat32(14, true),
        accel_g_per_lsb: v.getFloat32(18, true),
        mic_rate_hz: v.getUint16(22, true),
        tof_budget_ms: v.getUint16(24, true),
        tof_distance_mode: v.getUint8(26),
        flags: v.getUint8(27),
      };
      if (body.length >= 40) {
        info.haptic_rate_hz = v.getUint16(28, true);
        info.erm_step_us = v.getUint16(30, true);
        info.clip_max_samples = v.getUint32(32, true);
        info.clip_max_erm = v.getUint32(36, true);
      }
      return info;
    }
    case IMU: {
      const t0 = u64(0);
      const firstSeq = v.getUint32(8, true);
      const count = v.getUint8(12);
      const seq = new Array(count);
      const t = new Array(count);
      const gyro = new Array(count);
      const accel = new Array(count);
      for (let i = 0; i < count; i++) {
        const at = 13 + 14 * i;
        seq[i] = firstSeq + i;
        t[i] = t0 + v.getUint16(at, true);
        gyro[i] = [v.getInt16(at + 2, true), v.getInt16(at + 4, true), v.getInt16(at + 6, true)];
        accel[i] = [v.getInt16(at + 8, true), v.getInt16(at + 10, true), v.getInt16(at + 12, true)];
      }
      return { seq, t_us: t, gyro, accel };
    }
    case MIC: {
      const count = v.getUint16(24, true);
      const samples = new Int16Array(count);
      for (let i = 0; i < count; i++) samples[i] = v.getInt16(26 + 2 * i, true);
      return { t0_us: u64(0), first_index: u64(8), arrival_us: u64(16), samples };
    }
    case TOF:
      return {
        t_us: u64(0),
        distance_mm: v.getUint16(8, true),
        status: v.getUint8(10),
        signal_per_spad: v.getUint16(11, true),
        ambient: v.getUint16(13, true),
        spads: v.getUint16(15, true),
      };
    case STATS: {
      // Version 2 sent the first ten counters: only those a body holds are read
      const out = { t_us: u64(0) };
      if (body.length < 48) throw new RangeError("short stats");
      STATS_FIELDS.slice(1).forEach((name, i) => {
        if (8 + 4 * i + 4 <= body.length) out[name] = v.getUint32(8 + 4 * i, true);
      });
      return out;
    }
    case ACK:
      return { command_type: v.getUint8(0), command_number: v.getUint16(1, true), status: v.getUint8(3) };
    case PLAYBACK:
      return {
        kind: v.getUint8(0),
        id: v.getUint16(1, true),
        level_percent: v.getUint8(3),
        outcome: v.getUint8(4),
        start_us: u64(5),
        end_us: u64(13),
        frames: v.getUint32(21, true),
      };
    case TEXT:
      if (body.length < 1) throw new RangeError("empty text");
      return { level: body[0], text: decoder.decode(body.subarray(1)) };
    default:
      return body;
  }
}

/** Splits the byte stream into packets, dropping any that fail their checks, and counts packets
 *  lost (gaps in the packet numbers) and bad ones. Feed it bytes as they arrive. */
export class StreamReader {
  constructor() {
    this.packets = 0;
    this.lost = 0;
    this.bad = 0;
    this.lastNumber = null;
    this.synced = false;
    this.pending = new Uint8Array(1024);
    this.pendingLength = 0;
  }

  /** @param {Uint8Array} data @returns {{type:number, number:number, body:any, bytes:Uint8Array}[]} */
  feed(data) {
    const out = [];
    let start = 0;
    for (let i = 0; i < data.length; i++) {
      if (data[i] !== 0) continue;
      this.chunk(this.joined(data, start, i), out);
      start = i + 1;
    }
    this.keep(data, start);
    return out;
  }

  // The bytes of the packet ending at data[end]: what's pending plus data[start..end).
  joined(data, start, end) {
    if (this.pendingLength === 0) return data.subarray(start, end);
    const whole = new Uint8Array(this.pendingLength + end - start);
    whole.set(this.pending.subarray(0, this.pendingLength));
    whole.set(data.subarray(start, end), this.pendingLength);
    this.pendingLength = 0;
    return whole;
  }

  keep(data, start) {
    const rest = data.length - start;
    if (rest === 0) return;
    if (this.pendingLength + rest > MAX_ENCODED) {
      // No zero in sight: not our stream
      this.bad++;
      this.pendingLength = 0;
      return;
    }
    if (this.pendingLength + rest > this.pending.length) {
      const grown = new Uint8Array(MAX_ENCODED + 1);
      grown.set(this.pending.subarray(0, this.pendingLength));
      this.pending = grown;
    }
    this.pending.set(data.subarray(start), this.pendingLength);
    this.pendingLength += rest;
  }

  chunk(chunk, out) {
    if (!this.synced) {
      // Bytes before the first zero are the tail of a packet we joined part-way through
      this.synced = true;
      if (chunk.length) return;
    }
    if (!chunk.length) return;
    const packet = this.decode(chunk);
    if (packet) out.push(packet);
  }

  decode(chunk) {
    const frame = cobsDecode(chunk);
    if (!frame || frame.length < 5) {
      this.bad++;
      return null;
    }
    const n = frame.length;
    if ((frame[n - 2] | (frame[n - 1] << 8)) !== crc16(frame, 0, n - 2)) {
      this.bad++;
      return null;
    }
    const type = frame[0];
    const number = frame[1] | (frame[2] << 8);
    let body;
    try {
      body = parseBody(type, frame.slice(3, n - 2));
    } catch {
      this.bad++;
      return null;
    }
    if (this.lastNumber !== null) this.lost += (number - this.lastNumber - 1 + 65536) % 65536;
    this.lastNumber = number;
    this.packets++;
    return { type, number, body };
  }
}

// ---- Encoding: the device's side, for the demo stream and the tests ----

class Writer {
  constructor(size) {
    this.bytes = new Uint8Array(size);
    this.view = new DataView(this.bytes.buffer);
    this.at = 0;
  }
  u8(x) { this.view.setUint8(this.at, x); this.at += 1; }
  u16(x) { this.view.setUint16(this.at, x, true); this.at += 2; }
  i16(x) { this.view.setInt16(this.at, x, true); this.at += 2; }
  u32(x) { this.view.setUint32(this.at, x >>> 0, true); this.at += 4; }
  u64(x) { this.u32(x % 2 ** 32); this.u32(Math.floor(x / 2 ** 32)); }
  f32(x) { this.view.setFloat32(this.at, x, true); this.at += 4; }
  done() { return this.bytes.slice(0, this.at); }
}

export function encodeInfo(info) {
  const w = new Writer(40);
  w.u16(VERSION); w.u64(info.t_us); w.u16(info.board_id); w.u16(info.imu_rate_hz);
  w.f32(info.gyro_dps_per_lsb); w.f32(info.accel_g_per_lsb); w.u16(info.mic_rate_hz);
  w.u16(info.tof_budget_ms); w.u8(info.tof_distance_mode); w.u8(info.flags);
  w.u16(info.haptic_rate_hz ?? 0); w.u16(info.erm_step_us ?? 0);
  w.u32(info.clip_max_samples ?? 0); w.u32(info.clip_max_erm ?? 0);
  return w.done();
}

/** samples: [{dt_us, gyro:[x,y,z], accel:[x,y,z]}] */
export function encodeImu(t0_us, firstSeq, samples) {
  const count = Math.min(samples.length, IMU_MAX_SAMPLES);
  const w = new Writer(13 + 14 * count);
  w.u64(t0_us); w.u32(firstSeq); w.u8(count);
  for (let i = 0; i < count; i++) {
    const s = samples[i];
    w.u16(s.dt_us);
    s.gyro.forEach((x) => w.i16(x));
    s.accel.forEach((x) => w.i16(x));
  }
  return w.done();
}

export function encodeMic(block) {
  const count = Math.min(block.samples.length, MIC_MAX_SAMPLES);
  const w = new Writer(26 + 2 * count);
  w.u64(block.t0_us); w.u64(block.first_index); w.u64(block.arrival_us); w.u16(count);
  for (let i = 0; i < count; i++) w.i16(block.samples[i]);
  return w.done();
}

export function encodeTof(tof) {
  const w = new Writer(17);
  w.u64(tof.t_us); w.u16(tof.distance_mm); w.u8(tof.status);
  w.u16(tof.signal_per_spad); w.u16(tof.ambient); w.u16(tof.spads);
  return w.done();
}

export function encodeStats(stats) {
  const w = new Writer(8 + 4 * (STATS_FIELDS.length - 1));
  w.u64(stats.t_us);
  STATS_FIELDS.slice(1).forEach((name) => w.u32(stats[name] ?? 0));
  return w.done();
}

export function encodeAck(ack) {
  const w = new Writer(4);
  w.u8(ack.command_type); w.u16(ack.command_number); w.u8(ack.status);
  return w.done();
}

export function encodePlayback(p) {
  const w = new Writer(25);
  w.u8(p.kind); w.u16(p.id); w.u8(p.level_percent); w.u8(p.outcome);
  w.u64(p.start_us); w.u64(p.end_us); w.u32(p.frames);
  return w.done();
}

export function encodeText(level, text) {
  const bytes = new TextEncoder().encode(text).subarray(0, TEXT_MAX);
  const out = new Uint8Array(1 + bytes.length);
  out[0] = level;
  out.set(bytes, 1);
  return out;
}

/** A whole packet, ready to send: type, number, body and CRC, COBS-encoded, with the closing zero. */
export function encodePacket(type, number, body) {
  const frame = new Uint8Array(body.length + 5);
  frame[0] = type;
  frame[1] = number & 0xff;
  frame[2] = (number >> 8) & 0xff;
  frame.set(body, 3);
  const crc = crc16(frame, 0, body.length + 3);
  frame[body.length + 3] = crc & 0xff;
  frame[body.length + 4] = crc >> 8;
  const encoded = cobsEncode(frame);
  const out = new Uint8Array(encoded.length + 1);
  out.set(encoded);
  return out;
}
