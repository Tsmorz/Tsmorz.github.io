// Acknowledged commands on the recording device's existing serial stream. No serial port is
// opened here: the recorder owns it, and forwards decoded ACK/PLAYBACK packets to this client.
import { ACK, PLAYBACK, INFO_TACHAMMER_OK, INFO_ERM_OK, encodePacket } from "./wire.js";
import { packClip, GRID, bandpass, interpolate, peak, driveSafe } from "./haptics-core.js";

export const COMMAND = { begin: 0x41, data: 0x42, play: 0x43, waveform: 0x44, effect: 0x45, stop: 0x46, setProfile: 0x48 };
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

export async function openBoardPort(serial) {
  const known = (await serial.getPorts()).filter(port => {
    const info = port.getInfo();
    return info.usbVendorId === 0x2886 && info.usbProductId === 0x0068;
  });
  const port = known.length === 1 ? known[0] : await serial.requestPort({ filters: [{ usbVendorId: 0x2886, usbProductId: 0x0068 }] });
  await port.open({ baudRate: 1000000, bufferSize: 1 << 20 });
  return port;
}


export class DeviceClient {
  constructor(write, { timeout = 800, attempts = 3 } = {}) {
    this.write = write; this.timeout = timeout; this.attempts = attempts;
    this.number = 0; this.tag = 0; this.waiters = new Set(); this.closed = false;
    this.capture = null; this.commandPending = false; this.playing = false; this.stopping = null; this.playAbort = null;
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
    if (this.commandPending) throw new Error("Another command is waiting for the board.");
    this.commandPending = true;
    try {
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
          if (err.name === "AbortError" || signal?.aborted || this.closed || err.message.startsWith("Device refused") || attempt + 1 === this.attempts) throw err;
        }
      }
    } finally { this.commandPending = false; }
  }

  async upload(drive, erm, info, signal, progress = () => {}) {
    if (info?.flags != null && (!(info.flags & INFO_TACHAMMER_OK) || (erm && !(info.flags & INFO_ERM_OK)))) throw new Error("The selected actuator output is not ready.");
    if (!driveSafe(drive) || (erm && (peak(erm) > 0.7 || erm.some(v => !Number.isFinite(v) || v < 0)))) throw new Error("Reduce the drive: preview exceeds the 70% peak or sustained drive limit.");
    const rate = info?.haptic_rate_hz, step = info?.erm_step_us;
    const clip = packClip(drive, erm, rate, step);
    if (!(info?.clip_max_samples > 0) || clip.samples > info.clip_max_samples || clip.levels.length > info.clip_max_erm) {
      throw new Error("This signal exceeds the device's clip capacity. Shorten the selection or duration.");
    }
    await this.command(COMMAND.begin, body(8, (v) => { v.setUint32(0, clip.samples, true); v.setUint32(4, clip.levels.length, true); }), signal);
    const total = clip.pcm.length + clip.levels.length;
    let sent = 0;
    for (const [track, bytes, stride] of [[0, clip.pcm, 2], [1, clip.levels, 1]]) {
      for (let at = 0; at < bytes.length; at += 448) {
        checkAbort(signal);
        const part = bytes.subarray(at, at + 448);
        await this.command(COMMAND.data, body(5 + part.length, (v, b) => { v.setUint8(0, track); v.setUint32(1, at / stride, true); b.set(part, 5); }), signal);
        sent += part.length; progress(sent / total);
      }
    }
    return clip;
  }

  async play(drive, erm, info, signal, status = () => {}) {
    if (this.playing || this.stopping) throw new Error("A haptic playback is already in progress.");
    this.playing = true;
    const abort = this.playAbort = new AbortController();
    const cancel = () => abort.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    const external = signal;
    signal = abort.signal;
    this.capture = [];
    let pending;
    try {
      await this.command(COMMAND.stop, new Uint8Array(), signal);
      status("Uploading", 0);
      const clip = await this.upload(drive, erm, info, signal, (p) => status("Uploading", p));
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
      pending?.cancel();
      external?.removeEventListener("abort", cancel);
      this.capture = null;
      try { if (!this.closed) await this.stop(); }
      finally { this.playing = false; this.playAbort = null; }
    }
  }

  stop() {
    if (this.stopping) return this.stopping;
    this.playAbort?.abort();
    for (const waiter of [...this.waiters]) waiter.reject(abortError());
    this.stopping = (async () => {
      while (this.commandPending) await new Promise(resolve => setTimeout(resolve, 0));
      return this.command(COMMAND.stop);
    })().finally(() => { this.stopping = null; });
    return this.stopping;
  }
  close() {
    this.closed = true; this.playAbort?.abort();
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
