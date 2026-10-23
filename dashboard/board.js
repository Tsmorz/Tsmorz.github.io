// One connected board: its Bluetooth connection, the streams it sends, what the page shows of
// them, and its share of a recording. app.js keeps one of these per board and renders whichever
// is selected. Fires "change" (something to redraw), "mark" (a clap sync mark arrived), "seen"
// (a checklist item was seen working) and "disconnected" events.
import { SmpClient, updateFirmware, verifyUpdate } from "./dfu.js";
import {
  DATA_ENVELOPE, DATA_EVENTS, DATA_IMU, DATA_INFO, DATA_SERVICE, DATA_SPECTRUM, LOG_COMMAND, LOG_DATA, LOG_SERVICE, LOG_STATUS,
  TELEMETRY_BATTERY, TELEMETRY_IMU_RANGES, TELEMETRY_LATENCY, TELEMETRY_LED, TELEMETRY_MOUSE, TELEMETRY_POWER,
  TELEMETRY_SERVICE, crc32, decodeImuRanges, encodeImuRanges, temperatureFromEvent,
  decodeBattery, decodeBoardInfo, decodeEnvelopeBatch, decodeLedColor,
  decodeEvent, decodeImuBatch, decodeLatencyReport, decodeLogChunk, decodeLogStatus, decodeMouseSettings, decodeSpectrumBatch,
  encodeLatencyReset, encodeLedColor, encodeLogErase, encodeLogRead, encodeLogStart, encodeLogStop,
  encodeMouseSettings, encodeSleep, missedSince,
} from "./wire.js";
import { TimeUnwrapper } from "./recording.js";
import { SMP_CHARACTERISTIC, SMP_SERVICE } from "./smp.js";

export const TRACE_POINTS = 200;
// Traces show every 4th IMU sample: ~52 Hz, plenty for a 4 s view, and a quarter of the drawing.
export const DISPLAY_DECIMATION = 4;
export const ENVELOPE_SECONDS = 4;
const IDENTITY_QUAT = { w: 1, x: 0, y: 0, z: 0 };

const hostNow = () => performance.timeOrigin + performance.now();

// Board labels are remembered per board ID in this browser, so "left wrist" stays "left wrist".
function savedLabel(boardId) {
  try {
    return localStorage.getItem(`label:${boardId}`) ?? "";
  } catch {
    return "";
  }
}

export class Board extends EventTarget {
  /**
   * `continueFrom`: this device's previous connection, when reconnecting. Its time unwrapping and
   * last sequence numbers carry over, so times stay continuous and the samples missed while it was
   * away count as lost. `recording`: a BoardRecording to add this board's data to from the first
   * notification (app.js owns recordings, so one outlives a dropped connection).
   */
  constructor(device, { continueFrom = null, recording = null } = {}) {
    super();
    this.device = device;
    this.key = device.id;
    this.name = device.name ?? "nrf-controller";
    this.info = null;
    this.label = "";
    this.firmwareVersion = "";
    this.chars = {};
    this.writeChain = Promise.resolve();
    this.unwrap = continueFrom?.unwrap ?? new TimeUnwrapper();
    this.recording = recording;
    this.log = null; // the on-board recorder's status, if this firmware has one
    this.battery = null;
    this.led = null; // the colour the board's LED shows, if this firmware reports it
    this.download = null;
    this.smp = null; // the firmware update client, if this firmware can be updated over Bluetooth
    this.hasSpectrum = false; // whether this firmware sends the mic's spectrum
    this.imuRanges = null; // { gyroDps, accelG }, if this firmware lets them be chosen
    this.temperatureC = null; // the IMU's, if this firmware reports it
    this.seen = new Set();
    // [characteristic, handler] for every notification this connection listens to, removed on
    // disconnect: a reconnect makes a new Board, which mustn't share the old one's notifications.
    this.listeners = [];
    // Removed again on disconnect: a reconnect makes a new Board for the same device.
    this.handleGattDisconnect = () => this.onDisconnected();
    this.resetView();
    if (continueFrom) ({ lastSeq: this.lastSeq, lastWindow: this.lastWindow, lastEventSeq: this.lastEventSeq } = continueFrom);
  }

  resetView() {
    this.gyro = [];
    this.accel = [];
    this.quat = null;
    this.yawZero = IDENTITY_QUAT;
    this.atRest = false;
    this.userPressed = false;
    this.userPressHostMs = 0;
    this.envelope = [];
    this.envelopeEndUs = null;
    this.spectrum = []; // the last ENVELOPE_SECONDS of { tUs, levels } frames, levels in dBFS per bin
    this.spectrumFrameUs = 0;
    this.marks = []; // the latest few, for drawing
    this.markCount = 0;
    this.lastMarkHostMs = null;
    this.lastSeq = null;
    this.lastWindow = null;
    this.lastEventSeq = null;
    this.imuGaps = 0;
    this.envelopeGaps = 0;
    this.eventGaps = 0;
    this.windowSamples = 0;
    this.rateHz = 0;
    this.goodRateSeconds = 0;
    this.mouse = null;
    this.latency = null;
  }

  get boardId() {
    return this.info?.boardId ?? "????";
  }

  get displayName() {
    return this.label || `nrf-controller-${this.boardId}`;
  }

  get connected() {
    return Boolean(this.device.gatt?.connected);
  }

  setLabel(label) {
    this.label = label.trim();
    try {
      if (this.label) localStorage.setItem(`label:${this.boardId}`, this.label);
      else localStorage.removeItem(`label:${this.boardId}`);
    } catch {
      /* storage blocked: the label lasts for this page load */
    }
    this.changed();
  }

  changed() {
    this.dispatchEvent(new Event("change"));
  }

  markSeen(id) {
    if (this.seen.has(id)) return;
    this.seen.add(id);
    this.dispatchEvent(new CustomEvent("seen", { detail: id }));
  }

  // ---- connection -------------------------------------------------------------------------
  async connect(onStatus) {
    this.device.addEventListener("gattserverdisconnected", this.handleGattDisconnect);
    onStatus?.(`Connecting to ${this.name}… (accept the pairing prompt if one appears)`);
    const server = await this.device.gatt.connect();

    const data = await server.getPrimaryService(DATA_SERVICE);
    // Reading the info first also triggers pairing, since every characteristic needs encryption.
    this.chars.info = await data.getCharacteristic(DATA_INFO);
    this.info = decodeBoardInfo(await this.chars.info.readValue());
    if (!this.info) throw new Error("this board's firmware speaks a different data format; flash the current build");
    this.name = `nrf-controller-${this.info.boardId}`;
    this.label = savedLabel(this.info.boardId);

    const subscribe = async (service, uuid, handler) => {
      const characteristic = await service.getCharacteristic(uuid);
      this.listen(characteristic, (event) => handler(event.target.value));
      await characteristic.startNotifications();
      return characteristic;
    };
    this.chars.imu = await subscribe(data, DATA_IMU, (view) => this.onImu(view));
    this.chars.envelope = await subscribe(data, DATA_ENVELOPE, (view) => this.onEnvelope(view));
    this.chars.events = await subscribe(data, DATA_EVENTS, (view) => this.onEvent(view));
    await this.connectSpectrum(data, subscribe);

    const control = await server.getPrimaryService(TELEMETRY_SERVICE);
    await this.connectLed(control, subscribe);
    this.chars.mouse = await subscribe(control, TELEMETRY_MOUSE, (view) => this.onMouse(view));
    this.onMouse(await this.chars.mouse.readValue());
    this.chars.latency = await subscribe(control, TELEMETRY_LATENCY, (view) => this.onLatency(view));
    this.onLatency(await this.chars.latency.readValue());
    await this.connectPower(control, subscribe);
    await this.connectImuRanges(control);

    await this.connectLog(server, subscribe);
    await this.connectSmp(server);

    try {
      const dis = await server.getPrimaryService("device_information");
      this.firmwareVersion = new TextDecoder().decode(await (await dis.getCharacteristic("firmware_revision_string")).readValue());
    } catch {
      this.firmwareVersion = "";
    }
    this.changed();
  }

  // Firmware from before the spectrum view doesn't send it; the rest still works.
  async connectSpectrum(data, subscribe) {
    try {
      await subscribe(data, DATA_SPECTRUM, (view) => this.onSpectrum(view));
    } catch {
      return;
    }
    this.hasSpectrum = true;
  }

  // Firmware from before on-board recording has no log service; the rest still works.
  async connectLog(server, subscribe) {
    let service;
    try {
      service = await server.getPrimaryService(LOG_SERVICE);
    } catch {
      return;
    }
    this.chars.logCommand = await service.getCharacteristic(LOG_COMMAND);
    this.chars.logStatus = await subscribe(service, LOG_STATUS, (view) => this.onLogStatus(view));
    await subscribe(service, LOG_DATA, (view) => this.onLogData(view));
    this.onLogStatus(await this.chars.logStatus.readValue());
  }

  // Firmware from before MCUboot can't be updated over Bluetooth; flash it over USB once.
  async connectSmp(server) {
    let characteristic;
    try {
      characteristic = await (await server.getPrimaryService(SMP_SERVICE)).getCharacteristic(SMP_CHARACTERISTIC);
    } catch {
      return;
    }
    this.smp = new SmpClient((bytes) => this.queue(() => characteristic.writeValueWithoutResponse(bytes)));
    this.listen(characteristic, (event) => {
      const view = event.target.value;
      this.smp.onNotification(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    });
    await characteristic.startNotifications();
  }

  /**
   * Uploads a signed image and resets the board into it (dfu.js); the board disconnects once this
   * resolves, unless it already runs the image (`alreadyRunning`). Resolves with the parsed image.
   */
  updateFirmware(bytes, { onStage, onProgress } = {}) {
    if (!this.smp) throw new Error("this board's firmware can't be updated over Bluetooth: flash it over USB once (task flash)");
    return updateFirmware(this.smp, bytes, { onStage, onProgress });
  }

  /** After an update and reconnect: whether the board runs `image` and has confirmed it. */
  verifyFirmware(image) {
    if (!this.smp) return { ok: false, reason: "the board came back without the update service" };
    return verifyUpdate(this.smp, image);
  }

  // Firmware from before the LED reported its colour can only be written to.
  async connectLed(control, subscribe) {
    try {
      this.chars.led = await subscribe(control, TELEMETRY_LED, (view) => this.onLed(view));
    } catch {
      this.chars.led = await control.getCharacteristic(TELEMETRY_LED);
      return;
    }
    this.onLed(await this.chars.led.readValue());
  }

  onLed(view) {
    const color = decodeLedColor(view);
    if (color) this.led = color;
    this.changed();
  }

  // Firmware from before battery and sleep support has neither; the rest still works.
  async connectPower(control, subscribe) {
    try {
      this.chars.battery = await subscribe(control, TELEMETRY_BATTERY, (view) => this.onBattery(view));
      this.chars.power = await control.getCharacteristic(TELEMETRY_POWER);
    } catch {
      return;
    }
    this.onBattery(await this.chars.battery.readValue());
  }

  // Firmware from before the ranges could be chosen runs at +/-2000 dps and +/-8 g, fixed.
  async connectImuRanges(control) {
    try {
      this.chars.imuRanges = await control.getCharacteristic(TELEMETRY_IMU_RANGES);
    } catch {
      return;
    }
    this.imuRanges = decodeImuRanges(await this.chars.imuRanges.readValue());
  }

  /**
   * Sets the IMU's full-scale ranges (saved on the board), then reads them back with the board
   * info, whose scales every IMU count is multiplied by from then on. The board refuses while it
   * records to flash or uploads; the caller keeps them unchanged during a live recording.
   */
  async setImuRanges(ranges) {
    const bytes = encodeImuRanges(ranges);
    if (!bytes || !this.chars.imuRanges) throw new Error("this board's firmware can't change its ranges");
    await this.write(this.chars.imuRanges, bytes);
    // The IMU switches between samples, a moment after the write is acknowledged.
    for (let attempt = 0; attempt < 5; attempt++) {
      this.imuRanges = decodeImuRanges(await this.queue(() => this.chars.imuRanges.readValue()));
      if (this.imuRanges?.gyroDps === ranges.gyroDps && this.imuRanges?.accelG === ranges.accelG) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await this.refreshInfo();
    this.changed();
    return this.imuRanges;
  }

  onBattery(view) {
    const battery = decodeBattery(view);
    if (battery) this.battery = battery;
    this.changed();
  }

  /** Puts the board to sleep; it disconnects at once, and wakes on a USER press. */
  sleep() {
    return this.write(this.chars.power, encodeSleep());
  }

  disconnect() {
    if (this.connected) this.device.gatt.disconnect();
  }

  listen(characteristic, handler) {
    characteristic.addEventListener("characteristicvaluechanged", handler);
    this.listeners.push([characteristic, handler]);
  }

  onDisconnected() {
    this.device.removeEventListener("gattserverdisconnected", this.handleGattDisconnect);
    for (const [characteristic, handler] of this.listeners) characteristic.removeEventListener("characteristicvaluechanged", handler);
    this.listeners = [];
    this.recording = null;
    this.download?.reject(new Error("disconnected"));
    this.smp?.close(new Error("disconnected"));
    this.dispatchEvent(new Event("disconnected"));
  }

  // GATT operations can't overlap, so writes and reads are queued.
  queue(operation) {
    this.writeChain = this.writeChain.then(operation, operation);
    return this.writeChain;
  }

  write(characteristic, bytes) {
    return this.queue(() =>
      characteristic.writeValueWithResponse ? characteristic.writeValueWithResponse(bytes) : characteristic.writeValue(bytes));
  }

  /** Re-reads the board info, for its count of IMU samples dropped on the board. */
  async refreshInfo() {
    const info = decodeBoardInfo(await this.queue(() => this.chars.info.readValue()));
    if (info) this.info = info;
    return this.info;
  }

  // ---- streams ------------------------------------------------------------------------------
  onImu(view) {
    const hostMs = hostNow();
    const batch = decodeImuBatch(view);
    if (!batch || !this.info) return;

    if (this.lastSeq !== null) this.imuGaps += missedSince(this.lastSeq, batch.firstSeq);
    const samples = batch.samples.map((s) => ({ ...s, tUs: this.unwrap.unwrap(s.tUs) }));
    if (!samples.length) return;
    this.lastSeq = samples[samples.length - 1].seq;
    this.windowSamples += samples.length;
    this.recording?.addImu(samples, batch.gyroBiasDps, hostMs);

    const [bx, by, bz] = batch.gyroBiasDps;
    for (const s of samples) {
      if (s.seq % DISPLAY_DECIMATION !== 0) continue;
      const g = this.info.gyroDpsPerLsb;
      const a = this.info.accelGPerLsb;
      // Shown with the bias removed, as the old telemetry stream was; recorded raw.
      push(this.gyro, [s.gyroRaw[0] * g - bx, s.gyroRaw[1] * g - by, s.gyroRaw[2] * g - bz]);
      push(this.accel, s.accelRaw.map((raw) => raw * a));
    }

    const last = samples[samples.length - 1];
    this.quat = last.quat;
    this.atRest = last.atRest;
    this.checkImu();
  }

  checkImu() {
    const g = this.gyro[this.gyro.length - 1];
    const a = this.accel[this.accel.length - 1];
    if (g) ["x", "y", "z"].forEach((axis, i) => Math.abs(g[i]) > 50 && this.markSeen(`gyro-${axis}`));
    if (a) {
      const norm = Math.hypot(...a);
      if (norm > 0.9 && norm < 1.1) this.markSeen("accel");
    }
    const { w, x, y, z } = this.quat;
    if (Math.abs(Math.hypot(w, x, y, z) - 1) < 0.01) this.markSeen("pose");
    if (this.atRest) this.markSeen("rest");
  }

  onEnvelope(view) {
    const hostMs = hostNow();
    const batch = decodeEnvelopeBatch(view);
    if (!batch || !this.info) return;

    if (this.lastWindow !== null) this.envelopeGaps += missedSince(this.lastWindow, batch.firstWindow);
    this.lastWindow = (batch.firstWindow + batch.peaks.length - 1) >>> 0;
    const tUs = this.unwrap.unwrap(batch.tUs);
    this.recording?.addEnvelope(batch.firstWindow, tUs, batch.peaks, hostMs);

    const windowUs = (1e6 * this.info.envelopeWindowSamples) / this.info.micRateHz;
    const keep = Math.round((ENVELOPE_SECONDS * 1e6) / windowUs);
    this.envelope.push(...batch.peaks);
    if (this.envelope.length > keep) this.envelope.splice(0, this.envelope.length - keep);
    this.envelopeEndUs = tUs + batch.peaks.length * windowUs;
    this.markSeen("mic");
  }

  onSpectrum(view) {
    const batch = decodeSpectrumBatch(view);
    if (!batch?.frames.length || !this.info) return;

    const tUs = this.unwrap.unwrap(batch.tUs);
    this.spectrumFrameUs = (1e6 * batch.frameSamples) / this.info.micRateHz;
    batch.frames.forEach((levels, i) => this.spectrum.push({ tUs: tUs + i * this.spectrumFrameUs, levels }));
    const oldest = this.spectrum.at(-1).tUs - ENVELOPE_SECONDS * 1e6;
    while (this.spectrum[0].tUs < oldest) this.spectrum.shift();
    this.markSeen("spectrum");
  }

  onEvent(view) {
    const hostMs = hostNow();
    const event = decodeEvent(view);
    if (!event) return;

    if (this.lastEventSeq !== null) this.eventGaps += missedSince(this.lastEventSeq, event.seq);
    this.lastEventSeq = event.seq;
    const unwrapped = { ...event, tUs: this.unwrap.unwrap(event.tUs) };
    this.recording?.addEvent(unwrapped, hostMs);

    if (event.type === "temperature") {
      this.temperatureC = temperatureFromEvent(event.peak);
    } else if (event.type === "sync") {
      this.marks.push(unwrapped);
      if (this.marks.length > 50) this.marks.shift();
      this.markCount++;
      this.lastMarkHostMs = hostMs;
      this.markSeen("sync");
      this.dispatchEvent(new CustomEvent("mark", { detail: unwrapped }));
    } else {
      this.userPressed = event.type === "press";
      if (this.userPressed) {
        this.userPressHostMs = hostMs;
        this.markSeen("button");
        this.dispatchEvent(new Event("press"));
      }
    }
    this.changed();
  }

  onMouse(view) {
    const settings = decodeMouseSettings(view);
    if (settings) this.mouse = settings;
    this.changed();
  }

  onLatency(view) {
    const report = decodeLatencyReport(view);
    if (!report) return;
    this.latency = report;
    if (report.reports > 0) this.markSeen("latency");
    this.changed();
  }

  // ---- on-board recording -------------------------------------------------------------------
  onLogStatus(view) {
    const status = decodeLogStatus(view);
    if (!status) return;
    this.log = status;
    const download = this.download;
    if (download) {
      if (status.state === "reading") download.sawReading = true;
      else if (download.sawReading || download.received === download.buffer.length) download.finish(status);
    }
    this.changed();
  }

  onLogData(view) {
    const chunk = decodeLogChunk(view);
    const download = this.download;
    const at = chunk && download ? chunk.offset - download.offset : -1;
    if (at < 0 || at + chunk.bytes.length > download.buffer.length) return;
    download.buffer.set(chunk.bytes, at);
    download.received += chunk.bytes.length;
    download.onProgress?.(download.received / download.buffer.length);
  }

  logStart(sessionTag, hostEpochMs) {
    return this.write(this.chars.logCommand, encodeLogStart(sessionTag, hostEpochMs));
  }

  logStop() {
    return this.write(this.chars.logCommand, encodeLogStop());
  }

  logErase() {
    return this.write(this.chars.logCommand, encodeLogErase());
  }

  /**
   * Reads `length` bytes of the log from `offset` and checks them against the board's CRC-32.
   * Resolves with the bytes. About 12 KB/s to a Mac (see docs/data-collection.md), so a full flash
   * takes ~11 minutes.
   */
  async logDownload(offset, length, onProgress) {
    if (!length) return new Uint8Array(0);
    const timeoutMs = 60000 + (length / 4000) * 1000;
    const done = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out reading the log")), timeoutMs);
      this.download = {
        offset, buffer: new Uint8Array(length), received: 0, sawReading: false, onProgress,
        finish: (status) => (clearTimeout(timer), resolve(status)),
        reject: (error) => (clearTimeout(timer), reject(error)),
      };
    });
    try {
      await this.write(this.chars.logCommand, encodeLogRead(offset, length));
      const status = await done;
      const { buffer, received } = this.download;
      if (status.error) throw new Error(`the board reported error ${status.error}`);
      if (received !== length) throw new Error(`got ${received} of ${length} bytes`);
      if (crc32(buffer) !== status.read.crc32) throw new Error("checksum mismatch");
      return buffer;
    } finally {
      this.download = null;
      // The board pauses its live streams during an upload; don't count the pause as lost data.
      this.lastSeq = this.lastWindow = this.lastEventSeq = null;
    }
  }

  /** Called once a second: updates the sample rate and the rate/loss checks. */
  tick() {
    this.rateHz = this.windowSamples;
    this.windowSamples = 0;
    const expected = this.info?.imuRateHz ?? 208;
    this.goodRateSeconds = Math.abs(this.rateHz - expected) <= expected * 0.08 ? this.goodRateSeconds + 1 : 0;
    if (this.goodRateSeconds >= 2) this.markSeen("rate");
    if (this.goodRateSeconds >= 10 && this.imuGaps === 0) this.markSeen("loss");
  }

  // ---- controls -----------------------------------------------------------------------------
  async setLed(rgb) {
    await this.write(this.chars.led, encodeLedColor(rgb));
    this.markSeen("led");
  }

  setMouse(settings) {
    return this.write(this.chars.mouse, encodeMouseSettings(settings));
  }

  async resetLatency() {
    await this.write(this.chars.latency, encodeLatencyReset());
    this.onLatency(await this.queue(() => this.chars.latency.readValue()));
  }

  zeroYaw() {
    if (this.quat) this.yawZero = this.quat;
  }
}

function push(trace, point) {
  trace.push(point);
  if (trace.length > TRACE_POINTS) trace.shift();
}
