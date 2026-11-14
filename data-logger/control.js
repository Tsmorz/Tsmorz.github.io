// Application-level actuator acknowledgements. A transport write alone never means playback.
import { ACTUATOR_COMMANDS, encodeActuatorCommand } from "./wire.js";

export const CONTROL_VERSION = 1;
export const CONTROL_STATES = Object.freeze({ queued: 1, started: 2, completed: 3, failed: 4, stopped: 5, expired: 6 });
export const CONTROL_HEARTBEAT_MS = 400;
export const CONTROL_RESULT_MS = 2500;

export function encodeControl(command, requestId) {
  const body = encodeActuatorCommand(command);
  if (!body || !Number.isInteger(requestId) || requestId < 1 || requestId > 65535) return null;
  const bytes = new Uint8Array(10);
  bytes.set([CONTROL_VERSION, requestId & 255, requestId >>> 8, 1]);
  bytes.set(body, 4);
  return bytes;
}
export const encodeHeartbeat = () => Uint8Array.of(CONTROL_VERSION, 0, 0, 0, 0, 0, 0, 0, 0, 0);

export function decodeControlResult(view) {
  if (view.byteLength !== 15 || view.getUint8(0) !== CONTROL_VERSION) return null;
  const state = view.getUint8(4);
  if (!Object.values(CONTROL_STATES).includes(state)) return null;
  return { requestId: view.getUint16(1, true), command: view.getUint8(3), state,
    error: view.getInt16(5, true), atUs: Number(view.getBigUint64(7, true)) };
}

export class ControlClient {
  constructor(write, { onResult = () => {}, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    Object.assign(this, { write, onResult, setTimer, clearTimer });
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
    this.heartbeatOn = false;
    this.heartbeatEpoch = 0;
    this.heartbeatTimer = null;
    this.writing = false;
  }
  receive(view) {
    const report = decodeControlResult(view);
    if (!report) return;
    this.onResult(report);
    const pending = this.pending.get(report.requestId);
    if (!pending || pending.command !== report.command || report.state === CONTROL_STATES.queued) return;
    this.clearTimer(pending.timer);
    this.pending.delete(report.requestId);
    if ([CONTROL_STATES.failed, CONTROL_STATES.stopped, CONTROL_STATES.expired].includes(report.state)) {
      pending.reject(new Error(`Actuator ${Object.entries(CONTROL_STATES).find(([, n]) => n === report.state)[0]} (${report.error})`));
    } else pending.resolve(report);
  }
  async send(command) {
    if (this.closed) throw Error("controller disconnected");
    const stopped = command.command === ACTUATOR_COMMANDS.stopAll;
    if (!stopped && (this.writing || this.pending.size)) throw Error("an actuator command is still awaiting its result");
    if (stopped) {
      this.stopHeartbeats();
      this.generation = (this.generation ?? 0) + 1;
      for (const pending of this.pending.values()) {
        this.clearTimer(pending.timer); pending.reject(Error("Actuator command canceled by Stop"));
      }
      this.pending.clear();
    }
    const generation = this.generation;
    const id = this.nextId++;
    if (this.nextId > 65535) this.nextId = 1;
    const bytes = encodeControl(command, id);
    if (!bytes) throw Error("invalid actuator command");
    let rejectResult;
    const result = new Promise((resolve, reject) => {
      rejectResult = reject;
      const timer = this.setTimer(() => {
        this.pending.delete(id);
        reject(Error("No actuator result: output will stop when the firmware lease expires"));
        this.stopHeartbeats();
      }, CONTROL_RESULT_MS);
      this.pending.set(id, { command: command.command, resolve, reject, timer });
    });
    // A notification may arrive before the GATT write promise resolves.
    result.catch(() => {});
    this.writing = true;
    try {
      await this.write(bytes);
      if (stopped) this.stopHeartbeats();
      else if (generation === this.generation) this.startHeartbeats();
    } catch (error) {
      const pending = this.pending.get(id);
      if (pending) this.clearTimer(pending.timer);
      this.pending.delete(id);
      rejectResult(error);
    } finally { this.writing = false; }
    return result;
  }
  startHeartbeats() {
    if (this.closed || this.heartbeatOn) return;
    this.heartbeatOn = true;
    const epoch = ++this.heartbeatEpoch;
    const tick = async () => {
      if (!this.heartbeatOn || this.closed || epoch !== this.heartbeatEpoch) return;
      try { if (!this.writing) await this.write(encodeHeartbeat()); }
      catch { if (epoch === this.heartbeatEpoch) this.stopHeartbeats(); return; }
      if (this.heartbeatOn && epoch === this.heartbeatEpoch) this.heartbeatTimer = this.setTimer(tick, CONTROL_HEARTBEAT_MS);
    };
    this.heartbeatTimer = this.setTimer(tick, CONTROL_HEARTBEAT_MS);
  }
  stopHeartbeats() {
    this.heartbeatEpoch++;
    this.heartbeatOn = false;
    this.clearTimer(this.heartbeatTimer);
  }
  close() {
    this.closed = true;
    this.stopHeartbeats();
    for (const pending of this.pending.values()) {
      this.clearTimer(pending.timer);
      pending.reject(Error("controller disconnected"));
    }
    this.pending.clear();
  }
}
