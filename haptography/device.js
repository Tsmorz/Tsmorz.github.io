// Acknowledged commands on the recording device's existing serial stream. No serial port is
// opened here: the recorder owns it, and forwards decoded ACK/PLAYBACK packets to this client.
import { ACK, PLAYBACK, INFO_TACHAMMER_OK, encodePacket } from "./wire.js";
import { packClip, GRID, bandpass, interpolate } from "./haptics-core.js";

export const COMMAND = { begin: 0x41, data: 0x42, play: 0x43, waveform: 0x44, stop: 0x46 };
const STATUS = ["ok", "bad command", "no actuator", "busy", "not ready", "too long", "gap in upload", "bad value", "device failure"];
export const abortError = () => new DOMException("Stopped", "AbortError");
export function checkAbort(signal) { if (signal?.aborted) throw abortError(); }
export function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    checkAbort(signal);
    const done = () => { signal?.removeEventListener("abort", cancel); resolve(); };
    const timer = setTimeout(done, ms);
    const cancel = () => { clearTimeout(timer); signal?.removeEventListener("abort", cancel); reject(abortError()); };
    signal?.addEventListener("abort", cancel, { once: true });
  });
}

function body(size, fill) {
  const bytes = new Uint8Array(size);
  fill(new DataView(bytes.buffer), bytes);
  return bytes;
}

export class DeviceClient {
  constructor(write, { timeout = 800, attempts = 3 } = {}) {
    this.write = write; this.timeout = timeout; this.attempts = attempts;
    this.number = 0; this.tag = 0; this.waiters = new Set(); this.closed = false;
    this.capture = null;
  }

  feed(packet) {
    for (const waiter of [...this.waiters]) if (waiter.matches(packet)) waiter.resolve(packet.body);
  }

  bytes(bytes) { if (this.capture) this.capture.push(bytes.slice()); }

  wait(matches, timeout, signal) {
    let cancel;
    const promise = new Promise((resolve, reject) => {
      if (this.closed) { reject(new Error("Device disconnected.")); return; }
      if (signal?.aborted) { reject(abortError()); return; }
      const cleanup = () => { clearTimeout(timer); this.waiters.delete(waiter); signal?.removeEventListener("abort", abort); };
      const waiter = { matches, resolve: (v) => { cleanup(); resolve(v); }, reject: (e) => { cleanup(); reject(e); } };
      const abort = () => waiter.reject(abortError());
      const timer = setTimeout(() => waiter.reject(new Error("The device did not answer in time.")), timeout);
      cancel = (e = abortError()) => waiter.reject(e);
      signal?.addEventListener("abort", abort, { once: true });
      this.waiters.add(waiter);
    });
    // A response may fail while a serial write is still settling. Attach a handler immediately.
    promise.catch(() => {});
    return { promise, cancel: (e) => cancel?.(e) };
  }

  async command(type, bytes = new Uint8Array(), signal) {
    checkAbort(signal);
    if (this.closed) throw new Error("Device disconnected.");
    const number = this.number++ & 0xffff, packet = encodePacket(type, number, bytes);
    for (let attempt = 0; attempt < this.attempts; attempt++) {
      checkAbort(signal);
      const pending = this.wait((p) => p.type === ACK && p.body.command_type === type && p.body.command_number === number, this.timeout, signal);
      try {
        await this.write(packet);
        const ack = await pending.promise;
        if (ack.status) throw new Error(`Device refused: ${STATUS[ack.status] ?? ack.status}.`);
        return ack;
      } catch (err) {
        pending.cancel();
        if (signal?.aborted || this.closed || err.message.startsWith("Device refused") || attempt + 1 === this.attempts) throw err;
      }
    }
  }

  async upload(drive, info, signal, progress = () => {}) {
    if (info?.flags != null && !(info.flags & INFO_TACHAMMER_OK)) throw new Error("The TacHammer output is not ready.");
    const clip = packClip(drive, info?.haptic_rate_hz);
    if (!(info?.clip_max_samples > 0) || clip.samples > info.clip_max_samples) {
      throw new Error("This signal exceeds the device's clip capacity. Shorten the selection or duration.");
    }
    // Protocol 3 retains the second track count; TacHammer-only firmware requires zero.
    await this.command(COMMAND.begin, body(8, (v) => { v.setUint32(0, clip.samples, true); v.setUint32(4, 0, true); }), signal);
    for (let at = 0; at < clip.pcm.length; at += 448) {
      checkAbort(signal);
      const part = clip.pcm.subarray(at, at + 448);
      await this.command(COMMAND.data, body(5 + part.length, (v, b) => { v.setUint8(0, 0); v.setUint32(1, at / 2, true); b.set(part, 5); }), signal);
      progress((at + part.length) / clip.pcm.length);
    }
    return clip;
  }

  async play(drive, info, signal, status = () => {}) {
    this.capture = [];
    let pending;
    try {
      status("Uploading", 0);
      const clip = await this.upload(drive, info, signal, (p) => status("Uploading", p));
      await pause(300, signal); // pre-roll for the measurement filter
      const tag = this.tag = (this.tag + 1) & 0xffff;
      pending = this.wait((p) => p.type === PLAYBACK && p.body.kind === 2 && p.body.id === tag && p.body.outcome !== 1,
        drive.length / GRID * 1000 + 4000, signal);
      status("Playing", 1);
      await this.command(COMMAND.play, body(3, (v) => { v.setUint16(0, tag, true); v.setUint8(2, 100); }), signal);
      const report = await pending.promise;
      if (report.outcome !== 0) throw new Error("The actuator playback failed.");
      if (report.frames !== clip.samples || report.end_us < report.start_us) throw new Error("The device reported an incomplete playback. Try a shorter signal.");
      status("Measuring", 1);
      await pause(300, signal);
      const chunks = this.capture;
      const raw = new Uint8Array(chunks.reduce((s, b) => s + b.length, 0));
      let at = 0; for (const b of chunks) { raw.set(b, at); at += b.length; }
      return { report, raw };
    } finally {
      pending?.cancel(); this.capture = null;
    }
  }

  stop() { return this.command(COMMAND.stop); }
  close() {
    this.closed = true;
    for (const w of [...this.waiters]) w.reject(new Error("Device disconnected."));
    this.capture = null;
  }
}

// Measurement times use the board clock, not browser scheduling. Missing coverage, gaps, or
// saturation are failures, never silently interpolated into a good reproduction score.
export function measuredVibration(analysis, report, n) {
  const times = analysis.imu.t, values = analysis.imu.accel;
  const start = (report.start_us - analysis.origin_us) / 1e6;
  const end = start + (n - 1) / GRID;
  if (times.length < 2 || times[0] > start - 0.2 || times.at(-1) < end) throw new Error("The IMU did not cover the full playback. Try again.");
  for (let i = 1; i < times.length; i++) {
    if (times[i] < start || times[i - 1] > end) continue;
    if (times[i] - times[i - 1] > 0.004) throw new Error("IMU gaps during playback. Check the connection and try again.");
    if ([0, 1, 2].some((c) => Math.abs(values[3 * i + c]) >= 7.95)) throw new Error("The IMU clipped. Reduce the drive limit and measure again.");
  }
  const pre = 400, query = Float64Array.from({ length: n + pre }, (_, i) => start + (i - pre) / GRID);
  const cols = [0, 1, 2].map((c) => {
    const x = interpolate(times, values, query, 3, c);
    const mean = x.reduce((s, v) => s + v, 0) / x.length;
    return bandpass(Float64Array.from(x, (v) => v - mean), GRID, 20, 600).subarray(pre);
  });
  return Float64Array.from({ length: n * 3 }, (_, i) => cols[i % 3][Math.floor(i / 3)]);
}
