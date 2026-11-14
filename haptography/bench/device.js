// Capture v3/v4 commands over the same full-duplex stream as the recordings. No ERM dependency.
import { ACK, PLAYBACK, INFO_TACHAMMER_OK, encodePacket } from "./wire.js";
export const CMD = { BEGIN: 0x41, DATA: 0x42, PLAY: 0x43, STOP: 0x46, SET_PROFILE: 0x48 };
const STATUS = ["ok", "bad command", "no actuator", "busy", "not ready", "too long", "gap", "bad value", "failed"];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(promise, ms) {
  let timer;
  try { return await Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve(null), ms); })]); }
  finally { clearTimeout(timer); }
}
function body(size, fill) { const b = new Uint8Array(size); fill(new DataView(b.buffer)); return b; }

export async function openBoardPort(serial) {
  const known = (await serial.getPorts()).filter(port => {
    const info = port.getInfo();
    return info.usbVendorId === 0x2886 && info.usbProductId === 0x0068;
  });
  const port = known.length === 1 ? known[0] : await serial.requestPort({ filters: [{ usbVendorId: 0x2886, usbProductId: 0x0068 }] });
  await port.open({ baudRate: 1000000, bufferSize: 1 << 20 });
  return port;
}

export class HapticDevice {
  constructor(write, { timeout = 400, attempts = 5 } = {}) {
    this.write = write; this.timeout = timeout; this.attempts = attempts;
    this.number = 0; this.pending = null; this.report = null; this.busy = false; this.generation = 0; this.stopping = null;
  }
  accept(packet) {
    const b = packet.body;
    if (packet.type === ACK && this.pending?.type === b.command_type && this.pending?.number === b.command_number) this.pending.resolve(b);
    if (packet.type === PLAYBACK && b.kind === 2 && this.report?.tag === b.id) this.report.resolve(b);
  }
  close() {
    this.generation++;
    this.pending?.reject(Error("Board disconnected."));
    this.report?.reject(Error("Board disconnected."));
  }
  async command(type, data = new Uint8Array()) {
    if (this.pending) throw Error("Another command is waiting for the board.");
    const number = this.number++ & 65535, bytes = encodePacket(type, number, data);
    let resolve, reject;
    const ack = new Promise((yes, no) => { resolve = yes; reject = no; });
    ack.catch(() => {});
    const pending = { type, number, resolve, reject };
    this.pending = pending;
    try {
      for (let i = 0; i < this.attempts; i++) {
        await this.write(bytes);
        const result = await until(ack, this.timeout);
        if (!result) continue;
        if (result.status !== 0) throw Error(`Board refused command: ${STATUS[result.status] ?? result.status}.`);
        return result;
      }
      throw Error("Board did not acknowledge the command.");
    } finally { if (this.pending === pending) this.pending = null; }
  }
  stop() {
    if (this.stopping) return this.stopping;
    this.generation++;
    this.pending?.reject(Error("Stopped."));
    this.report?.reject(Error("Stopped."));
    this.stopping = (async () => {
      while (this.pending) await delay(0);
      await this.command(CMD.STOP);
    })().finally(() => { this.stopping = null; });
    return this.stopping;
  }
  async play(samples, info, progress = () => {}) {
    if (this.busy || this.stopping) throw Error("A haptic playback is already in progress.");
    if (!(samples instanceof Int16Array) || samples.length < 1 || samples.length > Math.min(96000, info?.clip_max_samples ?? 0) || info?.haptic_rate_hz !== 16000 || !(info?.flags & INFO_TACHAMMER_OK)) throw Error("This board cannot play this Drake clip.");
    const limit = Math.round(30000 * 0.95 * 0.70);
    if (samples.some(x => Math.abs(x) > limit)) throw Error("The drive exceeds the 70% preview ceiling.");
    this.busy = true;
    const generation = ++this.generation;
    const check = () => { if (generation !== this.generation) throw Error("Stopped."); };
    try {
      await this.command(CMD.STOP); check();
      await this.command(CMD.BEGIN, body(8, v => { v.setUint32(0, samples.length, true); v.setUint32(4, 0, true); }));
      for (let offset = 0; offset < samples.length; offset += 224) {
        check();
        const count = Math.min(224, samples.length - offset);
        await this.command(CMD.DATA, body(5 + 2 * count, v => { v.setUint8(0, 0); v.setUint32(1, offset, true); for (let i = 0; i < count; i++) v.setInt16(5 + 2 * i, samples[offset + i], true); }));
        progress((offset + count) / samples.length);
      }
      check();
      const tag = this.number & 65535;
      let resolve, reject;
      const report = new Promise((yes, no) => { resolve = yes; reject = no; });
      report.catch(() => {});
      this.report = { tag, resolve, reject };
      await this.command(CMD.PLAY, body(3, v => { v.setUint16(0, tag, true); v.setUint8(2, 100); }));
      const played = await until(report, samples.length / 16 + 3000);
      if (!played) throw Error("No playback completion from the board.");
      if (played.outcome !== 0 || played.frames !== samples.length) throw Error("Playback stopped or failed before completing.");
      return played;
    } finally {
      this.report = null;
      if (generation === this.generation) await this.command(CMD.STOP).finally(() => { this.busy = false; });
      else this.busy = false;
    }
  }
}
