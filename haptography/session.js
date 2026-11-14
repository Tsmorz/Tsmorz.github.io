// A recording's raw bytes, decoded into arrays: what record.py writes as a session folder, held in
// memory. Pure: no DOM.

import * as wire from "./wire.js";

// A gap in the microphone's samples longer than this isn't filled with silence (the device
// restarted, or the stream was lost for a long time): the samples just carry on. As record.py.
export const MAX_MIC_GAP_S = 60;

class Grow {
  constructor(Type, width = 1) {
    this.Type = Type;
    this.width = width;
    this.data = new Type(1024 * width);
    this.length = 0; // rows
  }
  push(...values) {
    if ((this.length + 1) * this.width > this.data.length) this.reserve(this.length + 1);
    this.data.set(values, this.length * this.width);
    this.length++;
  }
  pushArray(values) {
    const rows = values.length / this.width;
    this.reserve(this.length + rows);
    this.data.set(values, this.length * this.width);
    this.length += rows;
  }
  pushZeros(rows) {
    this.reserve(this.length + rows);
    this.data.fill(0, this.length * this.width, (this.length + rows) * this.width);
    this.length += rows;
  }
  reserve(rows) {
    if (rows * this.width <= this.data.length) return;
    let size = this.data.length;
    while (size < rows * this.width) size *= 2;
    const grown = new this.Type(size);
    grown.set(this.data.subarray(0, this.length * this.width));
    this.data = grown;
  }
  done() {
    return this.data.slice(0, this.length * this.width);
  }
}

/** Builds a session from packets as they arrive. */
export class SessionBuilder {
  constructor() {
    this.info = null;
    this.health = null;
    this.profile = null;
    this.imuT = new Grow(Float64Array);
    this.imuSeq = new Grow(Float64Array);
    this.gyro = new Grow(Int16Array, 3);
    this.accel = new Grow(Int16Array, 3);
    this.mic = new Grow(Int16Array);
    this.micBlocks = new Grow(Float64Array, 4); // t0_us, first_index, arrival_us, count
    this.micFirstIndex = null;
    this.micNextIndex = null;
    this.tof = new Grow(Float64Array, 6); // t_us, distance_mm, status, signal_per_spad, ambient, spads
    this.stats = [];
    this.messages = [];
    this.playbacks = []; // actuator playbacks the device reported (capture wire version 3)
  }

  add(packet) {
    const b = packet.body;
    switch (packet.type) {
      case wire.HEALTH: this.health = b; break;
      case wire.PROFILE: this.profile = b; break;
      case wire.INFO:
        this.info = b;
        break;
      case wire.IMU:
        for (let i = 0; i < b.seq.length; i++) {
          this.imuT.push(b.t_us[i]);
          this.imuSeq.push(b.seq[i]);
          this.gyro.push(...b.gyro[i]);
          this.accel.push(...b.accel[i]);
        }
        break;
      case wire.MIC:
        this.addMic(b);
        break;
      case wire.TOF:
        this.tof.push(b.t_us, b.distance_mm, b.status, b.signal_per_spad, b.ambient, b.spads);
        break;
      case wire.STATS:
        this.stats.push(b);
        break;
      case wire.TEXT:
        this.messages.push(b);
        break;
      case wire.PLAYBACK:
        this.playbacks.push(b);
        break;
    }
  }

  addMic(block) {
    const rate = this.info ? this.info.mic_rate_hz : 16000;
    if (this.micNextIndex === null) {
      this.micFirstIndex = block.first_index;
      this.micNextIndex = block.first_index;
    }
    const gap = block.first_index - this.micNextIndex;
    if (gap > 0 && gap <= MAX_MIC_GAP_S * rate) this.mic.pushZeros(gap);
    this.mic.pushArray(block.samples);
    this.micNextIndex = block.first_index + block.samples.length;
    this.micBlocks.push(block.t0_us, block.first_index, block.arrival_us, block.samples.length);
  }

  done(reader) {
    const tof = this.tof.done();
    const col = (k) => Float64Array.from({ length: tof.length / 6 }, (_, i) => tof[i * 6 + k]);
    return {
      info: this.info,
      ...(this.health && { health: this.health }),
      ...(this.profile && { profile: this.profile }),
      imu: { t_us: this.imuT.done(), seq: this.imuSeq.done(), gyro: this.gyro.done(), accel: this.accel.done() },
      mic: {
        samples: this.mic.done(),
        rate: this.info ? this.info.mic_rate_hz : 16000,
        firstIndex: this.micFirstIndex,
        blocks: this.micBlocks.done(),
      },
      tof: {
        t_us: col(0), distance_mm: col(1), status: col(2), signal_per_spad: col(3), ambient: col(4), spads: col(5),
      },
      stats: this.stats,
      messages: this.messages,
      playbacks: this.playbacks,
      packets: reader.packets,
      lost: reader.lost,
      bad: reader.bad,
    };
  }
}

/** Decode a whole recording's bytes, as record.py --from-raw does. */
export function decodeSession(bytes) {
  const reader = new wire.StreamReader();
  const builder = new SessionBuilder();
  // In pieces, so a long recording doesn't build one huge packet list
  const step = 1 << 16;
  for (let i = 0; i < bytes.length; i += step) {
    for (const p of reader.feed(bytes.subarray(i, i + step))) builder.add(p);
  }
  return builder.done(reader);
}

/** The microphone's sample times: a straight line through its blocks' (first_index, t0_us),
 *  fitted by least squares. Returns {t0_us, us_per_sample} for sample 0 of `mic.samples`, or null
 *  with no blocks. With one block, the nominal rate. */
export function micTimeline(mic) {
  const n = mic.blocks.length / 4;
  if (n === 0) return null;
  const nominal = 1e6 / mic.rate;
  const x0 = mic.blocks[1];
  if (n === 1) return { t0_us: mic.blocks[0], us_per_sample: nominal };
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += mic.blocks[i * 4 + 1] - x0; sy += mic.blocks[i * 4]; }
  const mx = sx / n, my = sy / n;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = mic.blocks[i * 4 + 1] - x0 - mx;
    sxx += dx * dx;
    sxy += dx * (mic.blocks[i * 4] - my);
  }
  const slope = sxx > 0 ? sxy / sxx : nominal;
  // Sample 0 of the array is firstIndex; a negative gap (restart) breaks the line, which the
  // fit then averages over: rare, and only the replay's mic plot uses this.
  return { t0_us: my - slope * mx + slope * (mic.firstIndex - x0), us_per_sample: slope };
}

/** The recording's first and last times on the board clock (µs), over every sensor. */
export function timeSpan(session) {
  let lo = Infinity, hi = -Infinity;
  const take = (t) => {
    if (!t.length) return;
    lo = Math.min(lo, t[0]);
    hi = Math.max(hi, t[t.length - 1]);
  };
  take(session.imu.t_us);
  take(session.tof.t_us);
  const mt = micTimeline(session.mic);
  if (mt) {
    lo = Math.min(lo, mt.t0_us);
    hi = Math.max(hi, mt.t0_us + mt.us_per_sample * session.mic.samples.length);
  }
  return lo <= hi ? { start_us: lo, end_us: hi } : null;
}
