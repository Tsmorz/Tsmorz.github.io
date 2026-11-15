// Haptics-only adapter for Tag Tracker. Share the capture decoder and command ACK contract.
import { StreamReader, INFO, INFO_TACHAMMER_OK, OLDEST_VERSION, VERSION } from './wire.js';
import { DeviceClient, COMMAND } from './device.js';

export class CaptureLink {
  constructor(port, onStatus, now = () => performance.now()) {
    this.port = port; this.onStatus = onStatus; this.now = now;
    this.decoder = new StreamReader(); this.closed = false;
    this.lastPacket = -Infinity; this.lastInfo = -Infinity;
    // Contact cues are disposable: never retry a late pulse.
    this.client = new DeviceClient(bytes => this.write(bytes), { timeout: 120, attempts: 1 });
  }
  get ready() {
    return !this.closed && this.info?.version >= 3 && this.info.version <= VERSION &&
      !!(this.info.flags & INFO_TACHAMMER_OK) && this.now() - this.lastPacket < 500 &&
      this.now() - this.lastInfo < 1500;
  }
  get busy() { return !!this.writing || this.client.commandPending; }
  async open() {
    await this.port.open({ baudRate: 1000000, bufferSize: 1 << 20 });
    this.opened = true;
    this.writer = this.port.writable.getWriter(); this.reader = this.port.readable.getReader();
    const identity = new Promise((resolve, reject) => {
      this.identify = resolve; this.rejectIdentity = reject;
      this.identityTimer = setTimeout(() => reject(new Error('No capture identity received. Choose the capture board; use BLE or USB / ESB for controller firmware.')), 3000);
    });
    this.reading = this.read();
    try { await identity; } catch (e) { await this.close(); throw e; }
    finally { clearTimeout(this.identityTimer); this.identify = this.rejectIdentity = null; }
  }
  async read() {
    try {
      while (!this.closed) {
        const { value, done } = await this.reader.read(); if (done) break;
        for (const packet of this.decoder.feed(value)) {
          if (packet.type === INFO) {
            if (packet.body.version < OLDEST_VERSION || packet.body.version > VERSION) {
              throw new Error('Unsupported capture protocol version.');
            }
            if (this.info && this.info.board_id !== packet.body.board_id) throw new Error('Capture identity changed. Reconnect the device.');
            this.info = packet.body; this.lastInfo = this.now(); this.identify?.();
          }
          this.lastPacket = this.now(); this.client.feed(packet);
        }
        if (this.info) this.onStatus(this);
      }
    } catch (e) { if (!this.closed) this.error = e; }
    finally {
      this.reader.releaseLock(); this.reader = null;
      this.fail(); this.onClose?.(this.error);
      // Do not await close here: it awaits this read loop.
      queueMicrotask(() => this.close().catch(() => {}));
    }
  }
  async write(bytes) {
    if (this.closed || !this.writer) throw new Error('Capture device disconnected.');
    if (this.writing) throw new Error('Capture link busy.');
    this.writing = true; const at = this.now();
    try {
      await this.writer.ready;
      if (this.closed) throw new Error('Capture device disconnected.');
      if (!this.ready || this.now() - at > 50) throw new Error('Capture cue expired before write.');
      await this.writer.write(bytes);
    } finally { this.writing = false; }
  }
  async command(bytes) {
    // Only the existing finite CLICK/KNOCK command subset; never forward servo or ERM commands.
    if (bytes.length !== 6 || bytes[0] !== 2 || bytes[1] !== 2 || ![1, 3].includes(bytes[2]) ||
        bytes[3] < 1 || bytes[3] > 45 || bytes[4] || bytes[5]) throw new Error('Unsupported task haptic cue.');
    if (!this.ready) throw new Error('Capture TacHammer is not ready or its stream is stale.');
    if (this.busy) throw new Error('Capture link busy.');
    return this.client.command(COMMAND.waveform, new Uint8Array([bytes[2], bytes[3]]));
  }
  fail() {
    this.closed = true; this.client.close();
    this.rejectIdentity?.(this.error || new Error('Capture device disconnected.'));
  }
  detach() { return this.close(); }
  close() {
    if (!this.closing) this.closing = this.finishClose();
    return this.closing;
  }
  async finishClose() {
    this.fail(); clearTimeout(this.identityTimer);
    try { await this.reader?.cancel(); await this.reading; }
    finally {
      this.writer?.releaseLock(); this.writer = null;
      if (this.opened) { this.opened = false; await this.port.close(); }
    }
  }
}
