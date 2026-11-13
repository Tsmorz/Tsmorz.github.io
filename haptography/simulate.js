// A simulated recording device, for the page's Demo and the tests: the same packets the board
// sends, from a known motion. It holds still for 5 s, then slides back and forth along the ToF's
// beam over a texture, whose grain (wavelength) sets the vibration's pitch at each speed. Pure.

import * as wire from "./wire.js";

const IMU_HZ = 1670; // the chip's own oscillator; INFO says the nominal 1666
const MIC_HZ = 16000;
const TOF_PERIOD_US = 15150;
const GYRO_SCALE = 0.07;
const ACCEL_SCALE = 0.000244;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The motion: still for `stillS`, then strokes of varied length and speed with short pauses,
 *  alternating direction. Returns position (mm along the beam, + away from the wall), speed and
 *  acceleration at time s. */
export function makeMotion({ seed = 1, stillS = 5 } = {}) {
  const rand = mulberry32(seed * 7919 + 1);
  const strokes = [];
  let t = stillS, x = 0, dir = 1;
  while (t < 3600) {
    const length = 90 + rand() * 90;
    const peak = 90 + rand() * 330;
    const duration = (Math.PI / 2) * (length / peak); // a raised-cosine speed profile
    strokes.push({ t0: t, t1: t + duration, x0: x, dx: dir * length });
    x += dir * length;
    dir = -dir;
    t += duration + 0.25 + rand() * 0.35;
  }
  let k = 0;
  return (s) => {
    while (k > 0 && strokes[k].t0 > s) k--;
    while (k + 1 < strokes.length && strokes[k + 1].t0 <= s) k++;
    const st = strokes[k];
    if (s < st.t0) return { x: 0, v: 0, a: 0 };
    if (s >= st.t1) return { x: st.x0 + st.dx, v: 0, a: 0 };
    const T = st.t1 - st.t0, u = (s - st.t0) / T;
    const v = (st.dx / T) * (1 - Math.cos(2 * Math.PI * u));
    const a = (st.dx / T) * (2 * Math.PI / T) * Math.sin(2 * Math.PI * u);
    const x = st.x0 + st.dx * (u - Math.sin(2 * Math.PI * u) / (2 * Math.PI));
    return { x, v, a };
  };
}

export class Simulator {
  /** @param {{seed?:number, boardId?:number, wavelengthMm?:number, wallMm?:number, stillS?:number}} o */
  constructor({ seed = 1, boardId = 0x5eed, wavelengthMm = 1.4, wallMm = 520, stillS = 5 } = {}) {
    this.rand = mulberry32(seed);
    this.motion = makeMotion({ seed, stillS });
    this.boardId = boardId;
    this.wavelength = wavelengthMm;
    this.wall = wallMm;
    this.startUs = 4_000_000;
    this.now = 0; // µs since start
    this.number = 0;
    this.imuIndex = 0;
    this.imuPending = [];
    this.micIndex = 0;
    this.nextTof = TOF_PERIOD_US;
    this.nextReport = 0;
    this.phase = 0; // texture phase, cycles
    this.phaseAt = 0;
    this.counters = { imu: 0, mic: 0, tof: 0, tx: 0, bytes: 0 };
    this.said = false;
  }

  gauss() {
    return Math.sqrt(-2 * Math.log(1 - this.rand())) * Math.cos(2 * Math.PI * this.rand());
  }

  // The texture's vibration (g) at time s: a grain whose frequency follows the speed, plus grit.
  texture(s, v) {
    const dt = s - this.phaseAt;
    if (dt > 0) {
      this.phase += (Math.abs(v) / this.wavelength) * dt;
      this.phaseAt = s;
    }
    const level = Math.min(1, Math.abs(v) / 300);
    return level * (0.25 * Math.sin(2 * Math.PI * this.phase) + 0.08 * Math.sin(4 * Math.PI * this.phase + 1) + 0.04 * this.gauss());
  }

  /** The bytes the device sends over the next `ms` milliseconds. */
  next(ms) {
    const end = this.now + ms * 1000;
    const out = [];
    const emit = (t, type, body) => out.push({ t, type, body });

    if (!this.said) {
      emit(this.now, wire.TEXT, wire.encodeText(0, `Recording device ${this.hex()}: IMU 1666 Hz, mic 16000 Hz, streaming (demo)`));
      this.said = true;
    }
    for (;;) {
      const t = (this.imuIndex * 1e6) / IMU_HZ;
      if (t >= end) break;
      this.imuPending.push(this.imuSample(t));
      this.imuIndex++;
      if (this.imuPending.length === 8) emit(t, wire.IMU, this.flushImu());
    }
    for (;;) {
      const t = ((this.micIndex + 160) * 1e6) / MIC_HZ; // a block goes out when it's full
      if (t >= end) break;
      emit(t, wire.MIC, this.micBlock());
    }
    while (this.nextTof < end) {
      emit(this.nextTof, wire.TOF, this.tofReading(this.nextTof));
      this.nextTof += TOF_PERIOD_US;
    }
    while (this.nextReport < end) {
      emit(this.nextReport, wire.INFO, wire.encodeInfo(this.info(this.nextReport)));
      emit(this.nextReport, wire.STATS, wire.encodeStats(this.stats(this.nextReport)));
      this.nextReport += 1e6;
    }
    this.now = end;

    out.sort((a, b) => a.t - b.t);
    const packets = out.map((p) => wire.encodePacket(p.type, this.number++ & 0xffff, p.body));
    // A reader drops what comes before the first zero (a packet it joined part-way through): the
    // stream opens with one, so the first packet counts
    if (this.number === packets.length) packets.unshift(new Uint8Array(1));
    const total = packets.reduce((n, p) => n + p.length, 0);
    const bytes = new Uint8Array(total);
    let at = 0;
    for (const p of packets) { bytes.set(p, at); at += p.length; }
    this.counters.tx += packets.length;
    this.counters.bytes += total;
    return bytes;
  }

  hex() {
    return this.boardId.toString(16).toUpperCase().padStart(4, "0");
  }

  imuSample(tUs) {
    const s = tUs * 1e-6;
    const { v, a } = this.motion(s);
    const vib = this.texture(s, v);
    const rock = Math.min(1, Math.abs(v) / 300) * 3 * Math.sin(2 * Math.PI * 3 * s); // dps
    const ax = a / 9810 + 0.002 * this.gauss() + 0.3 * vib;
    const ay = 0.002 * this.gauss() + 0.15 * vib;
    const az = 1 + 0.002 * this.gauss() + vib;
    const counts = (g, scale) => Math.max(-32768, Math.min(32767, Math.round(g / scale)));
    return {
      t: tUs,
      gyro: [counts(-3.3 + 0.15 * this.gauss(), GYRO_SCALE), counts(0.8 + rock + 0.15 * this.gauss(), GYRO_SCALE), counts(-0.4 + 0.15 * this.gauss(), GYRO_SCALE)],
      accel: [counts(ax, ACCEL_SCALE), counts(ay, ACCEL_SCALE), counts(az, ACCEL_SCALE)],
    };
  }

  flushImu() {
    const first = this.imuPending[0];
    const t0 = this.startUs + Math.round(first.t);
    const seq = this.imuIndex - this.imuPending.length + 1;
    const body = wire.encodeImu(t0, seq, this.imuPending.map((p) => ({
      dt_us: this.startUs + Math.round(p.t) - t0, gyro: p.gyro, accel: p.accel,
    })));
    this.counters.imu += this.imuPending.length;
    this.imuPending = [];
    return body;
  }

  micBlock() {
    const samples = new Int16Array(160);
    for (let i = 0; i < 160; i++) {
      const s = (this.micIndex + i) / MIC_HZ;
      const { v } = this.motion(s);
      const level = Math.min(1, Math.abs(v) / 300);
      // Scraping sounds like filtered noise whose brightness follows the texture's pitch
      const grain = Math.sin(2 * Math.PI * (Math.abs(v) / this.wavelength) * s);
      const x = 60 * this.gauss() + level * (2500 * this.gauss() * (0.6 + 0.4 * grain));
      samples[i] = Math.max(-32768, Math.min(32767, Math.round(x)));
    }
    const t0 = this.startUs + Math.round((this.micIndex * 1e6) / MIC_HZ);
    const body = wire.encodeMic({ t0_us: t0, first_index: this.micIndex + 64000, arrival_us: t0 + 10_400, samples });
    this.micIndex += 160;
    this.counters.mic++;
    return body;
  }

  tofReading(tUs) {
    // The light is collected over the 15 ms before the reading is ready
    const { x } = this.motion((tUs - 7500) * 1e-6);
    const bad = this.rand() < 0.03;
    this.counters.tof++;
    return wire.encodeTof({
      t_us: this.startUs + tUs,
      distance_mm: Math.max(0, Math.round(this.wall + x + 2 * this.gauss())),
      status: bad ? 1 : 0,
      signal_per_spad: bad ? 300 : 2400 + Math.round(200 * this.rand()),
      ambient: 30 + Math.round(10 * this.rand()),
      spads: 160,
    });
  }

  info(tUs) {
    return {
      t_us: this.startUs + tUs, board_id: this.boardId, imu_rate_hz: 1666,
      gyro_dps_per_lsb: GYRO_SCALE, accel_g_per_lsb: ACCEL_SCALE, mic_rate_hz: MIC_HZ,
      tof_budget_ms: 15, tof_distance_mode: 1, flags: wire.INFO_IMU_OK | wire.INFO_MIC_OK | wire.INFO_TOF_OK,
    };
  }

  stats(tUs) {
    return {
      t_us: this.startUs + tUs, imu_samples: this.counters.imu, imu_dropped: 0, mic_blocks: this.counters.mic,
      mic_errors: 0, tof_readings: this.counters.tof, tof_errors: 0, tx_packets: this.counters.tx,
      tx_dropped: 0, tx_bytes: this.counters.bytes, tx_peak_bytes: 2048,
    };
  }
}
