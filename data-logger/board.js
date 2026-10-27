// One connected board: its Bluetooth connection, the streams it sends, what the page shows of
// them, and its share of a recording. app.js keeps one of these per board and renders whichever
// is selected. Fires "change" (something to redraw), "seen" (a checklist item was seen working)
// and "disconnected" events. Older firmware also sends clap and tap events, which are recorded as
// they come but not shown.
import { SmpClient, updateFirmware, verifyUpdate } from "./dfu.js";
import {
  DATA_CLOCK, DATA_ENVELOPE, DATA_EVENTS, DATA_IMU, DATA_INFO, DATA_SERVICE, DATA_SPECTRUM, KEYWORD_AUDIO, KEYWORD_CLIP, KEYWORD_COMMAND, KEYWORD_MODEL, KEYWORD_SERVICE, KEYWORD_SETTINGS,
  KEYWORD_VOCABULARY, LOG_COMMAND, LOG_DATA, LOG_SERVICE, LOG_STATUS,
  TELEMETRY_BATTERY, TELEMETRY_CLOCK, TELEMETRY_IMU_RANGES, TELEMETRY_MOTION_WAKE, TELEMETRY_LATENCY, TELEMETRY_LED, TELEMETRY_MOUSE, TELEMETRY_POWER,
  TELEMETRY_SERVICE, crc32, decodeImuRanges, encodeImuRanges, temperatureFromEvent,
  decodeBattery, decodeBoardInfo, decodeEnvelopeBatch, decodeLedColor,
  decodeAudioChunk, decodeClipChunk, decodeClockPair, decodeKeywordEvent, decodeKeywordSettings, decodeClockStatus, decodeEvent, decodeImuBatch, decodeMotionWake, decodeLatencyReport, decodeLogChunk, decodeLogStatus, decodeMouseSettings, decodeSpectrumBatch,
  encodeClipCapture, encodeClockRole, encodeKeywordSettings, encodeStreamStart, encodeStreamStop, encodeLatencyReset, encodeLedColor, encodeMotionWake, encodeLogErase, encodeLogRead, encodeLogStart, encodeLogStop,
  encodeMouseSettings, encodeSleep, missedSince,
  MODEL_CHUNK_BYTES, decodeModelStatus, decodeVocabulary, encodeModelBegin, encodeModelCancel, encodeModelChunk, encodeModelCommit, encodeModelRemove,
} from "./wire.js";
import { ClipAssembler } from "./clips.js";
import { RateMeter } from "./rate-meter.js";
import { TimeUnwrapper, restartedSince } from "./recording.js";
import { SMP_CHARACTERISTIC, SMP_SERVICE } from "./smp.js";

export const TRACE_POINTS = 200;
// Traces show every 4th IMU sample: ~52 Hz, plenty for a 4 s view, and a quarter of the drawing.
export const DISPLAY_DECIMATION = 4;
export const ENVELOPE_SECONDS = 4;
const IDENTITY_QUAT = { w: 1, x: 0, y: 0, z: 0 };

const hostNow = () => performance.timeOrigin + performance.now();
// A notification's DataView, kept to be handled later.
const copyView = (view) => new DataView(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
// How long connect() waits for an IMU batch to tell whether the board restarted (see `continuing`).
const CONTINUITY_WAIT_MS = 2000;

// Board labels are remembered per board ID in this browser, so "left wrist" stays "left wrist".
function savedLabel(boardId) {
  try {
    return localStorage.getItem(`label:${boardId}`) ?? "";
  } catch {
    return "";
  }
}

// A USER hold this long puts the board to sleep when it's let go (POWER_SLEEP_HOLD_MS in
// src/power/power.h; firmware-consistency test). The disconnect follows within moments.
export const SLEEP_HOLD_US = 5000 * 1000;
const HOLD_SLEEP_DISCONNECT_MS = 5000;

export class Board extends EventTarget {
  /**
   * `continueFrom`: this device's previous connection, when reconnecting. Its time unwrapping and
   * last sequence numbers carry over, so times stay continuous and the samples missed while it was
   * away count as lost. `recording`: a BoardRecording to add this board's data to from the first
   * notification (app.js owns recordings, so one outlives a dropped connection).
   *
   * Unless the board restarted while it was away: then its clock and counts began again. So when
   * continuing, every notification is held back until the first IMU batch shows which (the hold
   * ends within connect()); if it restarted, `restarted` is set, nothing carries on, and the held
   * data waits for app.js to give the connection a recording of its own with release().
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
    // The last IMU batch seen, { seq, hostMs }: unlike lastSeq, not forgotten over a pause.
    this.lastImu = continueFrom?.lastImu ?? null;
    this.restarted = false;
    // { recording } while it isn't yet known whether the board restarted; `held` meanwhile holds
    // [handler, view] for every notification, in the order they came.
    this.continuing = continueFrom && this.lastImu ? { recording } : null;
    this.held = this.continuing ? [] : null;
    this.decided = new Promise((resolve) => (this.onDecided = resolve));
    this.recording = this.continuing ? null : recording;
    this.log = null; // the on-board recorder's status, if this firmware has one
    this.battery = null;
    this.led = null; // the colour the board's LED shows, if this firmware reports it
    this.download = null;
    this.clip = null; // the keyword clip being captured, if any
    this.canCaptureClips = false; // whether this firmware has the keyword service
    this.voice = null; // { listening, obeyed, hasModel, takesModels }, if this firmware has voice settings
    this.voiceHeard = []; // the latest keyword events: { action, outcome, hostMs }
    this.voiceModel = null; // the model's status (decodeModelStatus), if this firmware takes uploaded models
    this.vocabulary = null; // { name, commands: [{ action, phrase }] } of the loaded model
    this.modelWaiter = null; // resolves with the status once an upload or removal has finished
    this.audioStream = null; // the background-audio stream running, if any
    this.smp = null; // the firmware update client, if this firmware can be updated over Bluetooth
    this.hasSpectrum = false; // whether this firmware sends the mic's spectrum
    this.imuRanges = null; // { gyroDps, accelG }, if this firmware lets them be chosen
    this.temperatureC = null; // the IMU's, if this firmware reports it
    this.motionWake = null; // whether moving the board wakes it from sleep, if this firmware can
    this.clock = null; // { role, state, sourceBoard } of the radio clock sync, if this firmware has it
    this.clockPairs = 0; // radio clock pairs received this connection
    // Each clock source's times wrap too, on its own clock: one unwrapper per source board.
    this.sourceUnwraps = continueFrom?.sourceUnwraps ?? new Map();
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
    this.userPressUs = null; // board time of the latest press
    this.holdReleased = null; // { heldUs, hostMs } of the latest release
    this.envelope = [];
    this.envelopeEndUs = null;
    this.spectrum = []; // the last ENVELOPE_SECONDS of { tUs, levels } frames, levels in dBFS per bin
    this.spectrumFrameUs = 0;
    this.lastSeq = null;
    this.lastWindow = null;
    this.lastEventSeq = null;
    this.imuGaps = 0;
    this.envelopeGaps = 0;
    this.eventGaps = 0;
    this.rateMeter = new RateMeter();
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
    onStatus?.(`Connecting to ${this.name}…`);
    const server = await this.device.gatt.connect();

    const data = await server.getPrimaryService(DATA_SERVICE);
    // Reading the info first also triggers pairing, since every characteristic needs encryption.
    this.chars.info = await data.getCharacteristic(DATA_INFO);
    this.info = decodeBoardInfo(await this.chars.info.readValue());
    if (!this.info) throw new Error("this board's firmware speaks a different data format; flash the current build");
    this.name = `nrf-controller-${this.info.boardId}`;
    this.label = savedLabel(this.info.boardId);

    const subscribe = async (service, uuid, handler, { decides = false } = {}) => {
      const characteristic = await service.getCharacteristic(uuid);
      this.listen(characteristic, (event) => this.deliver(handler, event.target.value, decides));
      await characteristic.startNotifications();
      return characteristic;
    };
    this.chars.imu = await subscribe(data, DATA_IMU, (view) => this.onImu(view), { decides: true });
    this.chars.envelope = await subscribe(data, DATA_ENVELOPE, (view) => this.onEnvelope(view));
    this.chars.events = await subscribe(data, DATA_EVENTS, (view) => this.onEvent(view));
    await this.connectSpectrum(data, subscribe);
    await this.connectClockPairs(data, subscribe);

    const control = await server.getPrimaryService(TELEMETRY_SERVICE);
    await this.connectLed(control, subscribe);
    this.chars.mouse = await subscribe(control, TELEMETRY_MOUSE, (view) => this.onMouse(view));
    this.onMouse(await this.chars.mouse.readValue());
    this.chars.latency = await subscribe(control, TELEMETRY_LATENCY, (view) => this.onLatency(view));
    this.onLatency(await this.chars.latency.readValue());
    await this.connectPower(control, subscribe);
    await this.connectImuRanges(control);
    await this.connectMotionWake(control);
    await this.connectClock(control, subscribe);

    await this.connectLog(server, subscribe);
    await this.connectKeyword(server, subscribe);
    await this.connectSmp(server);

    try {
      const dis = await server.getPrimaryService("device_information");
      this.firmwareVersion = new TextDecoder().decode(await (await dis.getCharacteristic("firmware_revision_string")).readValue());
    } catch {
      this.firmwareVersion = "";
    }
    if (this.continuing) {
      await Promise.race([this.decided, new Promise((resolve) => setTimeout(resolve, CONTINUITY_WAIT_MS))]);
      // No IMU data to tell by: carry on, as a board that kept running would.
      if (this.continuing) this.release(this.continuing.recording);
    }
    this.changed();
  }

  // ---- carrying on a recording ----------------------------------------------------------------
  // While held, a notification waits its turn; only the first IMU batch, which decides, goes on.
  deliver(handler, view, decides) {
    if (this.held && !(decides && this.continuing)) {
      this.held.push([handler, copyView(view)]);
      return;
    }
    handler(view);
  }

  /** Ends the hold: `recording` (or none) gets this connection's data, the held data first. */
  release(recording) {
    const held = this.held ?? [];
    this.held = null;
    this.continuing = null;
    this.recording = recording;
    this.onDecided();
    for (const [handler, view] of held) handler(view);
  }

  // The board restarted while away: its times and counts start again, as a new board's would.
  startOver() {
    this.restarted = true;
    this.continuing = null;
    this.unwrap = new TimeUnwrapper();
    this.lastSeq = this.lastWindow = this.lastEventSeq = null;
    this.onDecided();
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

  // Firmware from before the radio clock sync has none of the next three; the rest still works.
  async connectClockPairs(data, subscribe) {
    try {
      await subscribe(data, DATA_CLOCK, (view) => this.onClockPair(view));
    } catch {
      /* no clock pairs from this firmware */
    }
  }

  async connectClock(control, subscribe) {
    try {
      this.chars.clock = await subscribe(control, TELEMETRY_CLOCK, (view) => this.onClockStatus(view));
    } catch {
      return;
    }
    this.onClockStatus(await this.chars.clock.readValue());
  }

  async connectMotionWake(control) {
    try {
      this.chars.motionWake = await control.getCharacteristic(TELEMETRY_MOTION_WAKE);
    } catch {
      return;
    }
    this.motionWake = decodeMotionWake(await this.chars.motionWake.readValue());
  }

  onClockStatus(view) {
    const status = decodeClockStatus(view);
    if (status) this.clock = status;
    this.changed();
  }

  onClockPair(view) {
    const hostMs = hostNow();
    const pair = decodeClockPair(view);
    if (!pair) return;
    if (!this.sourceUnwraps.has(pair.sourceBoard)) this.sourceUnwraps.set(pair.sourceBoard, new TimeUnwrapper());
    const unwrapped = { ...pair, tUs: this.unwrap.unwrap(pair.tUs), sourceTUs: this.sourceUnwraps.get(pair.sourceBoard).unwrap(pair.sourceTUs) };
    this.recording?.addClockPair(unwrapped, hostMs);
    this.clockPairs++;
    this.markSeen("clock");
  }

  /** Makes this board the clock source ("source") or a listener ("listener"); saved on the board. */
  setClockRole(role) {
    const bytes = encodeClockRole(role);
    if (!bytes || !this.chars.clock) throw new Error("this board's firmware has no radio clock sync: update it");
    return this.write(this.chars.clock, bytes);
  }

  /** Sets whether moving the board wakes it from sleep (saved on the board), then reads it back. */
  async setMotionWake(enabled) {
    if (!this.chars.motionWake) throw new Error("this board's firmware can't wake on motion: update it");
    await this.write(this.chars.motionWake, encodeMotionWake(enabled));
    this.motionWake = decodeMotionWake(await this.queue(() => this.chars.motionWake.readValue()));
    this.changed();
    return this.motionWake;
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

  // Firmware from before voice commands has no keyword service; the rest still works.
  async connectKeyword(server, subscribe) {
    let service;
    try {
      service = await server.getPrimaryService(KEYWORD_SERVICE);
    } catch {
      return;
    }
    this.chars.keywordCommand = await service.getCharacteristic(KEYWORD_COMMAND);
    await subscribe(service, KEYWORD_CLIP, (view) => this.onClipChunk(view));
    this.canCaptureClips = true;
    try {
      this.chars.voiceSettings = await service.getCharacteristic(KEYWORD_SETTINGS);
      this.voice = decodeKeywordSettings(await this.chars.voiceSettings.readValue());
      await subscribe(service, KEYWORD_AUDIO, (view) => this.onAudioChunk(view));
    } catch {
      /* firmware from before voice settings and background audio */
    }
    try {
      this.chars.voiceModel = await subscribe(service, KEYWORD_MODEL, (view) => this.onModelStatus(view));
      this.chars.vocabulary = await service.getCharacteristic(KEYWORD_VOCABULARY);
    } catch {
      return; /* firmware from before uploadable models (or built without them) */
    }
    this.onModelStatus(await this.chars.voiceModel.readValue());
    await this.readVocabulary();
  }

  onModelStatus(view) {
    const status = decodeModelStatus(view);
    if (!status) return;
    this.voiceModel = status;
    if (["ready", "none", "failed"].includes(status.state)) this.modelWaiter?.resolve(status);
    this.changed();
  }

  async readVocabulary() {
    this.vocabulary = decodeVocabulary(await this.queue(() => this.chars.vocabulary.readValue()));
    if (this.voice) this.voice = decodeKeywordSettings(await this.queue(() => this.chars.voiceSettings.readValue()));
    this.changed();
  }

  /** The model's status once it settles (ready, none or failed), or a rejection after `ms`. */
  waitForModel(ms) {
    this.modelWaiter?.reject(new Error("superseded"));
    const waiter = {};
    const promise = new Promise((resolve, reject) => Object.assign(waiter, { resolve, reject }));
    const timer = setTimeout(() => waiter.reject(new Error("the board didn't say how it went")), ms);
    this.modelWaiter = waiter;
    return promise.finally(() => {
      clearTimeout(timer);
      if (this.modelWaiter === waiter) this.modelWaiter = null;
    });
  }

  /**
   * Uploads a voice model package (voicepkg.js checked it) to the board, which stops listening
   * meanwhile, checks it, runs it and saves it. Resolves with the board's status once it is
   * listening with it; rejects with why not, the board having gone back to its previous model.
   * onProgress(fraction) follows the transfer. One link-layer packet per write: ~5 s for 48 KB.
   */
  async uploadVoiceModel(bytes, onProgress) {
    if (!this.chars.voiceModel) throw new Error("this board's firmware can't take voice models: update it");
    if (this.voiceModel && bytes.length > this.voiceModel.maxBytes) {
      throw new Error(`too big for this board's firmware (${bytes.length} of ${this.voiceModel.maxBytes} bytes)`);
    }
    await this.write(this.chars.keywordCommand, encodeModelBegin(bytes.length));
    try {
      for (let offset = 0; offset < bytes.length; offset += MODEL_CHUNK_BYTES) {
        await this.write(this.chars.keywordCommand, encodeModelChunk(offset, bytes.subarray(offset, offset + MODEL_CHUNK_BYTES)));
        onProgress?.(Math.min(1, (offset + MODEL_CHUNK_BYTES) / bytes.length));
      }
    } catch (error) {
      if (this.connected) await this.write(this.chars.keywordCommand, encodeModelCancel()).catch(() => {});
      throw error;
    }
    // Waiting before the commit: the board's answer can come before the write's.
    const settled = this.waitForModel(30000);
    await this.write(this.chars.keywordCommand, encodeModelCommit());
    const status = await settled;
    await this.readVocabulary();
    if (status.result !== "ok" || status.state !== "ready") throw new Error(modelResultText(status));
    return status;
  }

  /** Erases the board's voice model: it stops listening. */
  async removeVoiceModel() {
    if (!this.chars.voiceModel) throw new Error("this board's firmware has no voice model to remove");
    const settled = this.waitForModel(15000);
    await this.write(this.chars.keywordCommand, encodeModelRemove());
    await settled;
    await this.readVocabulary();
  }

  /** Sets whether the board listens and which commands it obeys (saved on it); reads them back. */
  async setVoiceSettings(settings) {
    if (!this.chars.voiceSettings) throw new Error("this board's firmware has no voice settings: update it");
    await this.write(this.chars.voiceSettings, encodeKeywordSettings(settings));
    this.voice = decodeKeywordSettings(await this.queue(() => this.chars.voiceSettings.readValue()));
    this.changed();
    return this.voice;
  }

  /**
   * Streams the board's microphone (ADPCM, ~8 KB/s) until stopAudioStream(); the live data
   * streams pause meanwhile. onChunk({ firstSample, samples }) gets each 20 ms chunk decoded;
   * firstSample counts from the stream's start, so a gap shows a lost chunk.
   */
  async startAudioStream(onChunk, decode) {
    if (!this.chars.voiceSettings) throw new Error("this board's firmware can't stream audio: update it");
    if (this.audioStream) throw new Error("already streaming");
    const streamId = Math.floor(Math.random() * 0x10000);
    this.audioStream = { streamId, onChunk, decode };
    try {
      await this.write(this.chars.keywordCommand, encodeStreamStart(streamId));
    } catch (error) {
      this.audioStream = null;
      throw error;
    }
  }

  async stopAudioStream() {
    if (!this.audioStream) return;
    this.audioStream = null;
    try {
      if (this.connected) await this.write(this.chars.keywordCommand, encodeStreamStop());
    } finally {
      // The board paused its live streams while it sent audio; don't count the pause as lost data.
      this.lastSeq = this.lastWindow = this.lastEventSeq = null;
      this.rateMeter.reset();
    }
  }

  onAudioChunk(view) {
    const chunk = decodeAudioChunk(view);
    const stream = this.audioStream;
    if (!chunk || chunk.streamId !== stream?.streamId) return;
    stream.onChunk({ firstSample: chunk.firstSample, samples: stream.decode(chunk.adpcm, chunk) });
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

  /**
   * Whether a disconnect at `hostMs` is the board going to sleep on a USER hold: released after
   * SLEEP_HOLD_US (power.h), just before. It sleeps on the release.
   */
  sleptOnHold(hostMs) {
    const release = this.holdReleased;
    return Boolean(release) && release.heldUs >= SLEEP_HOLD_US && hostMs - release.hostMs < HOLD_SLEEP_DISCONNECT_MS;
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
    this.modelWaiter?.reject(new Error("disconnected"));
    this.clip?.reject(new Error("disconnected"));
    this.audioStream?.onChunk(null); // tells the recorder the stream ended
    this.audioStream = null;
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
    if (this.continuing) {
      if (restartedSince({ seq: batch.firstSeq, hostMs }, this.lastImu, this.info.imuRateHz)) {
        this.startOver();
        this.held.push([(held) => this.onImu(held), copyView(view)]);
        return;
      }
      this.release(this.continuing.recording);
    }

    if (this.lastSeq !== null) this.imuGaps += missedSince(this.lastSeq, batch.firstSeq);
    const samples = batch.samples.map((s) => ({ ...s, tUs: this.unwrap.unwrap(s.tUs) }));
    if (!samples.length) return;
    this.lastSeq = samples[samples.length - 1].seq;
    this.lastImu = { seq: this.lastSeq, hostMs };
    this.rateMeter.add(samples.length);
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
    } else if (event.type === "keyword") {
      this.voiceHeard.unshift({ ...decodeKeywordEvent(event.peak), hostMs });
      this.voiceHeard.length = Math.min(this.voiceHeard.length, 8);
    } else if (event.type === "press" || event.type === "release") {
      this.userPressed = event.type === "press";
      if (this.userPressed) {
        this.userPressHostMs = hostMs;
        this.userPressUs = unwrapped.tUs;
        this.markSeen("button");
        this.dispatchEvent(new Event("press"));
      } else if (this.userPressUs !== null) {
        this.holdReleased = { heldUs: unwrapped.tUs - this.userPressUs, hostMs };
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
      this.rateMeter.reset();
    }
  }

  // ---- keyword clips ------------------------------------------------------------------------
  onClipChunk(view) {
    const chunk = decodeClipChunk(view);
    const clip = this.clip;
    if (!chunk || chunk.clipId !== clip?.assembler.clipId) return; // none asked for, or an earlier one's
    if (clip.assembler.add(chunk)) clip.finish();
    else clip.onProgress?.(clip.assembler.progress);
  }

  /**
   * Captures the next 2 s of the board's microphone (its LED shows magenta meanwhile) and resolves
   * with the samples, at the board info's micRateHz. `onCapturing` is called once the board has
   * started, `onProgress` with the fraction sent: ~5 s more to a Mac, with the live streams paused.
   */
  async captureClip({ onCapturing, onProgress } = {}) {
    if (!this.canCaptureClips) throw new Error("this board's firmware can't capture clips: update it");
    if (this.clip) throw new Error("already capturing a clip");
    this.clipId = ((this.clipId ?? Math.floor(Math.random() * 0x10000)) + 1) & 0xffff;
    const assembler = new ClipAssembler(this.clipId);
    const done = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("the clip didn't arrive")), 20000);
      this.clip = {
        assembler, onProgress,
        finish: () => (clearTimeout(timer), resolve(assembler.samples)),
        reject: (error) => (clearTimeout(timer), reject(error)),
      };
    });
    try {
      // A refusal (busy, or the board uploading its flash) ends the capture with the write's error.
      await this.write(this.chars.keywordCommand, encodeClipCapture(this.clipId))
        .then(() => onCapturing?.(), (error) => this.clip.reject(error));
      return await done;
    } finally {
      this.clip = null;
      // The board pauses its live streams while it sends a clip; don't count the pause as lost data.
      this.lastSeq = this.lastWindow = this.lastEventSeq = null;
      this.rateMeter.reset();
    }
  }

  /** Called once a second: updates the sample rate and the rate/loss checks. */
  tick() {
    this.rateHz = Math.round(this.rateMeter.tick(performance.now()));
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

/** Why the board refused a model, or what went wrong with one, in words. */
export function modelResultText({ state, result }) {
  const reasons = {
    "other features": "it was trained on other features than this firmware computes: retrain it",
    "other format": "its format is newer than this firmware reads: update the firmware",
    "bad labels": "its phrases or actions don't make sense to this firmware",
    "bad settings": "its decision-rule settings are out of range",
    corrupt: "it arrived damaged",
    truncated: "it arrived incomplete",
    "too big": "it's too big for this firmware",
    "model refused": "this firmware can't run it (an operator it lacks, or too little memory): the board's log names which",
    "not saved": "the board runs it, but couldn't save it to flash: it lasts until the board restarts",
    interrupted: "the upload stopped part way",
  };
  if (result === "ok") return state === "ready" ? "listening" : `the board's model is ${state}`;
  return reasons[result] ?? result;
}
