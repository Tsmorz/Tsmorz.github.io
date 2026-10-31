// Voice commands on the page (docs/voice-commands.md). Settings › Voice: the selected board's
// model, whether it listens, what it heard, and uploading a model to the boards. Only the clock
// source listens. The clips dialog records training data of the one phrase through every connected
// board's microphone at once (Board.captureClip), so each saying gives a clip per board, saved as
// WAVs for the training pipeline, each sent over Bluetooth or, with a board plugged in, read through
// its USB programmer (mailbox.js). The clips are the user's voice: they only ever go into the
// folder the user picks, never into tools/dashboard/ (published).
import { fitCanvas, hairline } from "./canvas.js";
import { decodeAdpcm } from "./adpcm.js";
import {
  ACTION_TEXT, AudioTrack, DEFAULT_VOCABULARY, WAV_HEADER_BYTES, clipFileName, clipLevels, encodeWav, pcmBytes, wavHeader,
} from "./clips.js";
import { modelResultText } from "./board.js";
import { readMailbox } from "./mailbox.js";
import { kvGet, kvSet } from "./storage.js";
import { Dap, Nrf54lm20a, PROBE_FILTER, openProbe } from "./swd.js";
import { parseVoicePackage } from "./voicepkg.js";

const $ = (id) => document.getElementById(id);
const FOLDER_KEY = "keyword-folder";
const SPEAKER_KEY = "voice-speaker";
const BACKGROUND_FOLDER = "background"; // not a label: training cuts it into _silence and _unknown pieces
const [PHRASE] = DEFAULT_VOCABULARY.phrases;
const READ_WRITE = { mode: "readwrite" };
const CAPTURE_MS = 2000; // CLIP_CAPTURE_SAMPLES in src/keyword/clip_capture.h, at 16 kHz
// Below this a phrase is hard to hear over the room (a laptop click 1 m away peaked near -40).
const QUIET_PEAK_DBFS = -35;

let getBoard = () => null;
let getBoards = () => [];
let isRecording = () => false;
let getColors = () => ({});
let folder = null; // the chosen folder's handle; null downloads each clip instead
let modelBusy = false; // uploading a model to the boards, or removing one
let modelStatus = null; // { text, bad, until } of an upload or removal: shown while it runs, then a while
const MODEL_STATUS_MS = 20000;
let phraseClips = 0; // clips in the phrase's subfolder
let backgroundFiles = 0; // recordings in the background subfolder
// The last saying: a clip per board, { label, name, boardId, samples, rateHz, saved }, and the one shown.
let last = null; // { clips, shown }
let busy = false;
let capturing = Promise.resolve(); // the clips being taken, which need their USB cables until they're in
const background = new Map(); // board -> its running recording: { board, writable, track, started, rateHz }
let backgroundTimer = null;
// The USB programmers clips are read through, by board ID: { device, transport, chip, boardId },
// while the dialog is open.
const usb = new Map();
let usbPending = Promise.resolve(); // connecting or letting go of them
let usbNote = null; // { text, bad } from the last attempt, shown until the next
// Probe serial number -> board ID, kept for the probes chosen here, so reopening the dialog finds
// them again without asking.
const USB_PROBES_KEY = "voice-usb-probes";

const captureBoards = () => getBoards().filter((board) => board.connected && board.canCaptureClips);

/**
 * Wires the dialog up. `getBoard()` is the selected board, `getBoards()` every board, and
 * `isRecording()` whether a live recording runs (a clip pauses a board's live streams, which
 * would leave a gap in it).
 */
export function initVoice(options) {
  ({ getBoard, getBoards, isRecording, getColors } = options);
  $("voice-open").addEventListener("click", () => {
    if (!$("voice-dialog").open) $("voice-dialog").showModal();
    renderVoice();
    drawClip();
    reconnectUsb();
  });
  $("voice-close").addEventListener("click", () => $("voice-dialog").close());
  // Let go of the programmer with the dialog, so Flash over USB, OpenOCD or another tab can have it.
  $("voice-dialog").addEventListener("close", () => queueUsb(async () => {
    await capturing;
    await letGoOfUsb();
    usbNote = null;
  }));
  $("voice-usb").addEventListener("click", chooseUsb);
  $("voice-usb-off").addEventListener("click", () => queueUsb(useBluetooth));
  navigator.usb?.addEventListener("disconnect", (event) => {
    const probe = [...usb.values()].find((each) => each.device === event.device);
    if (!probe) return;
    usb.delete(probe.boardId);
    usbNote = { text: `${probe.boardId}'s USB cable was unplugged: its clips go over Bluetooth.`, bad: false };
    renderVoice();
  });
  $("voice-pick-folder").addEventListener("click", pickFolder);
  $("voice-capture").addEventListener("click", capture);
  $("voice-play").addEventListener("click", play);
  $("voice-discard").addEventListener("click", discard);
  // Space captures, so a run of clips needs no mouse; not while typing the speaker's name.
  $("voice-dialog").addEventListener("keydown", (event) => {
    if (event.key !== " " || event.target.tagName === "INPUT") return;
    event.preventDefault();
    capture();
  });
  try {
    $("voice-speaker").value = localStorage.getItem(SPEAKER_KEY) ?? "";
  } catch {
    /* storage blocked: the speaker lasts for this page load */
  }
  $("voice-speaker").addEventListener("change", () => {
    try {
      localStorage.setItem(SPEAKER_KEY, $("voice-speaker").value.trim());
    } catch {
      /* as above */
    }
  });
  $("voice-bg-record").addEventListener("click", () => (background.size ? stopBackground() : startBackground()));
  $("voice-listen").addEventListener("click", () => {
    const board = getBoard();
    if (board?.voice) sendVoiceSettings(board, { ...board.voice, listening: !board.voice.listening });
  });
  $("voice-model-upload").addEventListener("click", () => $("voice-model-file").click());
  $("voice-model-file").addEventListener("change", () => {
    const [file] = $("voice-model-file").files;
    $("voice-model-file").value = "";
    if (file) uploadModel(file);
  });
  $("voice-model-remove").addEventListener("click", removeModel);
  restoreFolder();
}

// Shown at once, before the board confirms: the page redraws from board.voice every 250 ms, so
// without this a switch would flip back for the moment the write takes. Put back if the board refuses.
async function sendVoiceSettings(board, settings) {
  const before = board.voice;
  board.voice = { ...before, ...settings };
  renderVoiceSettings();
  try {
    await board.setVoiceSettings(settings);
  } catch (error) {
    board.voice = before;
    $("voice-settings-status").textContent = `Couldn't change ${board.displayName}'s voice settings: ${error.message}`;
  }
  renderVoiceSettings();
}

const ago = (hostMs) => {
  const seconds = Math.round((performance.timeOrigin + performance.now() - hostMs) / 1000);
  return seconds < 60 ? `${seconds} s ago` : `${Math.round(seconds / 60)} min ago`;
};

/** The selected board's phrases for `action`, from its loaded model. */
const phrasesFor = (board, action) => (board?.vocabulary?.commands ?? []).filter((command) => command.action === action).map(({ phrase }) => `“${phrase}”`);

function voiceStatusText(board, voice) {
  const model = board.voiceModel;
  if (!voice) return "This board's firmware has no voice commands: update it.";
  if (!voice.takesModels && !model) {
    return voice.hasModel ? (voice.listening ? "Listening with the model built into its firmware." : "Not listening: it ignores every command.")
      : "This board's firmware can't take an uploaded model: update it.";
  }
  if (board.clock && board.clock.role !== "source") return "Not listening: only the clock source does, and it's the pointer. Choose it under Clock sync.";
  if (!model || model.state === "none") return "No voice model on this board: upload one (a .voice file from task training:export).";
  if (model.state === "failed") return `Its stored model was refused: ${modelResultText(model)}. Upload another.`;
  if (model.state !== "ready" && model.state !== "saving") return "Loading a voice model…";
  return voice.listening ? "Listening for its commands." : "Not listening: it ignores every command.";
}

function modelLine(board) {
  const model = board?.connected ? board.voiceModel : null;
  if (!model) return "";
  const name = board.vocabulary?.name;
  const size = model.totalBytes ? ` · ${(model.totalBytes / 1024).toFixed(1)} KB` : "";
  return name ? `Model: ${name} · ${board.vocabulary.commands.length} phrases${size}` : "Model: none";
}

/** Settings › Voice, for the selected board: its model, listening, what it heard lately. */
export function renderVoiceSettings() {
  const board = getBoard();
  const voice = board?.connected ? board.voice : null;
  $("voice-listen").disabled = !voice;
  $("voice-listen").setAttribute("aria-checked", String(Boolean(voice?.listening)));
  const takers = getBoards().filter((each) => each.connected && each.voiceModel);
  $("voice-model-upload").disabled = modelBusy || !takers.length;
  $("voice-model-remove").disabled = modelBusy || !board?.connected || !board.vocabulary?.name;
  $("voice-model").textContent = modelLine(board);
  const note = modelStatus && (modelBusy || performance.now() < modelStatus.until) ? modelStatus : null;
  $("voice-settings-status").textContent = note?.text ?? (!board?.connected ? "Connect a board to set up its voice commands." : voiceStatusText(board, voice));
  $("voice-settings-status").className = note?.bad ? "hint bad-text" : "hint";
  $("voice-heard").replaceChildren(...(board?.voiceHeard ?? []).map(({ action, outcome, hostMs }) => {
    const item = document.createElement("li");
    item.append(Object.assign(document.createElement("span"), { textContent: phrasesFor(board, action)[0] ?? ACTION_TEXT[action] ?? action }),
      Object.assign(document.createElement("span"), { textContent: `${outcome} · ${ago(hostMs)}` }));
    return item;
  }));
}

function setModelStatus(text, bad = false) {
  modelStatus = text ? { text, bad, until: performance.now() + MODEL_STATUS_MS } : null;
  renderVoiceSettings();
}

// ---- voice model -------------------------------------------------------------------------
/** Uploads a .voice file to every connected board that takes models, one after another. */
async function uploadModel(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const model = parseVoicePackage(bytes);
  if (model.problem) return setModelStatus(`${file.name}: ${model.problem}.`, true);
  const targets = getBoards().filter((board) => board.connected && board.voiceModel);
  if (!targets.length) return setModelStatus("No connected board takes voice models: update their firmware.", true);

  modelBusy = true;
  const done = [];
  const failed = [];
  for (const board of targets) {
    try {
      await board.uploadVoiceModel(bytes, (fraction) =>
        setModelStatus(`Uploading “${model.name}” to ${board.displayName}… ${Math.round(fraction * 100)}%`));
      done.push(board.displayName);
    } catch (error) {
      failed.push(`${board.displayName}: ${error.message}`);
    }
  }
  modelBusy = false;
  const phrases = model.commands.map(({ phrase }) => `“${phrase}”`).join(", ");
  setModelStatus([
    done.length ? `${done.join(", ")} now listen${done.length === 1 ? "s" : ""} for ${phrases}.` : "",
    failed.length ? `Not uploaded to ${failed.join("; ")}.` : "",
  ].filter(Boolean).join(" "), failed.length > 0);
}

async function removeModel() {
  const board = getBoard();
  if (!board?.connected || modelBusy) return;
  if (!confirm(`Remove the voice model from ${board.displayName}? It stops listening until another is uploaded.`)) return;
  modelBusy = true;
  setModelStatus(`Removing ${board.displayName}'s model…`);
  try {
    await board.removeVoiceModel();
    setModelStatus(`${board.displayName} has no voice model now.`);
  } catch (error) {
    setModelStatus(`Couldn't remove ${board.displayName}'s model: ${error.message}`, true);
  }
  modelBusy = false;
  renderVoiceSettings();
}

export const voiceDialogOpen = () => $("voice-dialog").open;

/** Updates the dialog for the connected boards; cheap enough to call on every redraw. */
export function renderVoice() {
  const boards = captureBoards();
  const connected = getBoards().filter((board) => board.connected);
  $("voice-board").textContent = boards.length ? `· ${boards.length === 1 ? boards[0].displayName : `${boards.length} boards`}` : "";
  $("voice-say").textContent = `“${PHRASE.say}”`;
  $("voice-does").textContent = `${ACTION_TEXT[PHRASE.action]} · ${phraseClips} clips`;
  $("voice-capture").disabled = busy || !boards.length;
  $("voice-capture").textContent = boards.length > 1 ? `Capture on ${boards.length} boards` : "Capture";
  $("voice-play").disabled = !last;
  $("voice-discard").disabled = busy || !last?.clips.some((clip) => clip.saved);
  renderUsb(boards);
  if (!busy) {
    const reason = !connected.length ? "Connect a board first."
      : !boards.length ? "These boards' firmware can't capture clips: update it." : "";
    if (reason || $("voice-status").dataset.reason) setStatus(reason, { reason: Boolean(reason) });
  }
  $("voice-counts").replaceChildren(...[[PHRASE.say, phraseClips], ["background recordings", backgroundFiles]].map(([name, count]) => {
    const item = document.createElement("li");
    item.append(name, Object.assign(document.createElement("span"), { className: "num", textContent: String(count) }));
    return item;
  }));
}

function setStatus(text, { bad = false, reason = false } = {}) {
  $("voice-status").textContent = text;
  $("voice-status").className = bad ? "bad-text" : "muted";
  if (reason) $("voice-status").dataset.reason = "1";
  else delete $("voice-status").dataset.reason;
}

function setBar(fraction) {
  $("voice-bar").querySelector("i").style.width = `${Math.round(fraction * 100)}%`;
  $("voice-bar").setAttribute("aria-valuenow", String(Math.round(fraction * 100)));
}

// ---- folder -------------------------------------------------------------------------------
function renderFolder(permission) {
  $("voice-folder").textContent = !folder ? "No folder: each clip downloads instead. Choose data/keywords/."
    : permission === "denied" ? `Not allowed to write to ${folder.name}/: clips download instead.`
    : `Saving into ${folder.name}/${PHRASE.label}/`;
  $("voice-folder").className = permission === "denied" ? "bad-text" : "muted";
}

async function restoreFolder() {
  const handle = await kvGet(FOLDER_KEY);
  if (!handle || folder) return renderFolder();
  folder = handle;
  try {
    const permission = await handle.queryPermission(READ_WRITE);
    renderFolder(permission);
    if (permission === "granted") await recount();
  } catch {
    renderFolder("prompt");
  }
}

async function pickFolder() {
  if (!window.showDirectoryPicker) {
    $("voice-folder").textContent = "This browser can't write folders; clips will download instead.";
    return;
  }
  try {
    folder = await window.showDirectoryPicker({ id: "keywords", mode: "readwrite" });
  } catch {
    return; // picker dismissed
  }
  kvSet(FOLDER_KEY, folder);
  renderFolder("granted");
  await recount();
}

/** The folder, asking Chrome to allow it again if needed; null to download. Call it from a key press or click. */
async function writableFolder() {
  if (!folder) return null;
  let permission = "denied";
  try {
    permission = await folder.queryPermission(READ_WRITE);
    if (permission !== "granted") permission = await folder.requestPermission(READ_WRITE);
  } catch {
    /* the folder is gone, or the browser refused: download instead */
  }
  renderFolder(permission);
  return permission === "granted" ? folder : null;
}

async function countWavs(name) {
  let directory;
  try {
    directory = await folder.getDirectoryHandle(name);
  } catch {
    return 0; // nothing recorded here yet
  }
  let count = 0;
  for await (const file of directory.keys()) if (file.endsWith(".wav")) count++;
  return count;
}

async function recount() {
  phraseClips = await countWavs(PHRASE.label);
  backgroundFiles = await countWavs(BACKGROUND_FOLDER);
  renderVoice();
}

async function save(target, label, name, bytes) {
  if (!target) {
    const link = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(new Blob([bytes], { type: "audio/wav" })), download: `${label}__${name}`,
    });
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    return false;
  }
  const directory = await target.getDirectoryHandle(label, { create: true });
  const writable = await (await directory.getFileHandle(name, { create: true })).createWritable();
  await writable.write(bytes);
  await writable.close();
  return true;
}

// ---- capturing ----------------------------------------------------------------------------
/** One board's clip, over its USB cable if it has one attached. */
async function captureOne(board, date, target, { onCapturing, onProgress }) {
  const samples = await board.captureClip({ usb: usbFor(board)?.chip, onCapturing, onProgress: (fraction) => onProgress(board, fraction) });
  const rateHz = board.info?.micRateHz ?? 16000;
  // The same date on every board: dataset.py keeps one saying's clips in one split by it.
  const name = clipFileName(board.boardId, date, $("voice-speaker").value);
  const saved = await save(target, PHRASE.label, name, encodeWav(samples, rateHz));
  return { label: PHRASE.label, name, boardId: board.boardId, samples, rateHz, saved };
}

async function capture() {
  const boards = captureBoards();
  if (busy || $("voice-capture").disabled || !boards.length) return;
  // Over USB the live streams carry on, so only a clip over Bluetooth would leave a gap in a recording.
  const refuseDuringRecording = () => {
    if (!isRecording() || boards.every(usbFor)) return false;
    setStatus("Stop the live recording first, or use USB cables: a clip over Bluetooth pauses a board's live streams.", { bad: true });
    return true;
  };
  if (refuseDuringRecording()) return;
  const target = await writableFolder();
  busy = true;
  renderVoice();
  setBar(0);
  let speakTimer = null;
  await usbPending;
  if (refuseDuringRecording()) {
    busy = false;
    renderVoice();
    return;
  }
  const date = new Date();
  const sent = new Map(boards.map((board) => [board, 0]));
  const onCapturing = () => {
    if (speakTimer) return;
    const started = performance.now();
    setStatus("Speak now (LEDs magenta)");
    speakTimer = setInterval(() => setBar(Math.min(1, (performance.now() - started) / CAPTURE_MS)), 50);
  };
  const onProgress = (board, fraction) => {
    clearInterval(speakTimer);
    sent.set(board, fraction);
    const all = [...sent.values()].reduce((sum, each) => sum + each, 0) / sent.size;
    setBar(all);
    setStatus(`Fetching clips… ${Math.round(all * 100)}%`);
  };
  capturing = Promise.allSettled(boards.map((board) => captureOne(board, date, target, { onCapturing, onProgress })));
  const results = await capturing;
  clearInterval(speakTimer);

  const clips = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  const failed = results.flatMap((result, i) => (result.status === "rejected" ? [`${boards[i].displayName}: ${result.reason.message}`] : []));
  if (clips.length) {
    last = { clips, shown: clips.find((clip) => clip.boardId === getBoard()?.boardId) ?? clips[0] };
    phraseClips += clips.length; // downloaded clips count too, for this page load
  }
  const notes = clips.flatMap(({ boardId, samples }) => verdict(clipLevels(samples)).map((text) => `${boardId}: ${text}`));
  const saved = clips.every((clip) => clip.saved);
  setStatus([
    clips.length ? `${saved ? "Saved" : "Downloaded"} ${clips.length} clip${clips.length === 1 ? "" : "s"} (${clips.map((clip) => clip.boardId).join(", ")}).` : "",
    ...notes,
    failed.length ? `No clip from ${failed.join("; ")}.` : "",
  ].filter(Boolean).join(" "), { bad: failed.length > 0 });
  setBar(clips.length ? 1 : 0);
  for (const board of boards) {
    const probe = usbFor(board);
    if (probe && results[boards.indexOf(board)].status === "rejected") await queueUsb(() => dropUsbIfGone(probe));
  }
  busy = false;
  renderVoice();
  drawClip();
}

// ---- clips over the USB cable -------------------------------------------------------------
// A board's own USB programmer (swd.js) reads each clip straight from its RAM (mailbox.js), so
// several plugged-in boards each go through their own cable. The capture is still asked for over
// Bluetooth. Attaching the debugger leaves the chip in debug mode, so the board can't sleep
// afterwards until it loses all power (CLAUDE.md, sleep and debug mode).

const usbFor = (board) => (board ? usb.get(board.boardId) ?? null : null);

/** Runs `step` after any connecting or letting go already under way; never rejects. */
function queueUsb(step) {
  usbPending = usbPending.then(step).catch((error) => {
    usbNote = { text: `USB: ${error.message}`, bad: true };
  }).finally(renderVoice);
  return usbPending;
}

function renderUsb(boards) {
  const cabled = boards.filter(usbFor);
  $("voice-usb").disabled = busy || !navigator.usb || !boards.length;
  $("voice-usb-off").hidden = usb.size === 0;
  $("voice-usb-off").disabled = busy;
  const note = usbNote ?? (!navigator.usb ? { text: "This browser has no WebUSB: clips go over Bluetooth." }
    : cabled.length ? { text: `Over USB: ${cabled.map((board) => board.boardId).join(", ")}, under 1 s a clip. ${cabled.length < boards.length ? "The others use Bluetooth." : ""}` }
    : { text: "Over Bluetooth: ~5 s a clip." });
  $("voice-usb-status").textContent = note.text;
  $("voice-usb-status").className = note.bad ? "bad-text" : "muted";
}

function rememberedProbes() {
  try {
    return JSON.parse(localStorage.getItem(USB_PROBES_KEY) ?? "{}");
  } catch {
    return {}; // storage blocked or unreadable: ask for the probe again
  }
}

function rememberProbe(serial, boardId) {
  const probes = Object.fromEntries(Object.entries(rememberedProbes()).filter(([, id]) => id !== boardId));
  if (serial) probes[serial] = boardId;
  try {
    localStorage.setItem(USB_PROBES_KEY, JSON.stringify(probes));
  } catch {
    /* as above */
  }
}

/** The button: asks for a programmer (a click, as WebUSB requires), then attaches it. */
async function chooseUsb() {
  let device;
  try {
    device = await navigator.usb.requestDevice({ filters: [PROBE_FILTER] });
  } catch {
    return; // chooser dismissed
  }
  usbNote = { text: "Connecting to the USB programmer…" };
  await queueUsb(() => attachUsb(device));
}

/** On opening the dialog: the programmers chosen here before, for boards connected now. */
async function reconnectUsb() {
  if (!navigator.usb) return;
  const remembered = Object.entries(rememberedProbes());
  await queueUsb(async () => {
    const devices = await navigator.usb.getDevices();
    for (const board of captureBoards()) {
      const serial = remembered.find(([, id]) => id === board.boardId)?.[0];
      const device = serial && devices.find((each) => each.serialNumber === serial);
      if (device && !usbFor(board)) await attachUsb(device);
    }
  });
}

async function attachUsb(device) {
  if ([...usb.values()].some((probe) => probe.device === device)) {
    usbNote = null;
    return;
  }
  const transport = await openProbe(device);
  const chip = new Nrf54lm20a(new Dap(transport));
  try {
    const { locked } = await chip.attach();
    if (locked) throw new Error("the board's chip is locked: flash it over USB first");
    const { boardId } = await chip.identify();
    if (!captureBoards().some((board) => board.boardId === boardId)) throw new Error(`that's ${boardId}'s cable: connect that board over Bluetooth too`);
    if (!(await readMailbox(chip))) throw new Error(`${boardId}'s firmware can't hand clips over USB: update it`);
    // Only one that worked, so reopening the dialog never attaches to a board nobody chose here.
    rememberProbe(device.serialNumber, boardId);
    usb.set(boardId, { device, transport, chip, boardId });
    usbNote = null;
  } catch (error) {
    await chip.detach();
    await transport.close().catch(() => {});
    throw error;
  }
}

async function letGoOf(probe) {
  usb.delete(probe.boardId);
  await probe.chip.detach();
  await probe.transport.close().catch(() => {});
}

const letGoOfUsb = () => Promise.all([...usb.values()].map(letGoOf));

/** "Use Bluetooth": lets go of them all, and forgets them so reopening the dialog doesn't take them again. */
async function useBluetooth() {
  for (const boardId of usb.keys()) rememberProbe(null, boardId);
  await letGoOfUsb();
  usbNote = null;
}

/** After a failed clip: lets go of a programmer that no longer answers (unplugged, or taken by another program). */
async function dropUsbIfGone(probe) {
  if (usb.get(probe.boardId) !== probe) return;
  try {
    await readMailbox(probe.chip);
  } catch {
    await letGoOf(probe);
    usbNote = { text: `${probe.boardId}'s USB cable stopped answering: its clips go over Bluetooth.`, bad: true };
  }
}

function verdict(levels) {
  if (levels.clipped > 0) return ["It clipped: speak softer or further away, and discard it."];
  return levels.peakDbfs < QUIET_PEAK_DBFS ? ["It's quiet: come closer or speak up."] : [];
}

/** Removes every board's clip of the last saying. */
async function discard() {
  if (!last || busy) return;
  try {
    const directory = await folder.getDirectoryHandle(PHRASE.label);
    const saved = last.clips.filter((clip) => clip.saved);
    for (const clip of saved) await directory.removeEntry(clip.name);
    phraseClips = Math.max(0, phraseClips - saved.length);
    setStatus(`Discarded ${saved.length} clip${saved.length === 1 ? "" : "s"}.`);
    last = null;
  } catch (error) {
    setStatus(`Couldn't discard them: ${error.message}`, { bad: true });
  }
  renderVoice();
  drawClip();
}

function play() {
  if (!last) return;
  const { samples, rateHz } = last.shown;
  const audio = new AudioContext();
  const buffer = audio.createBuffer(1, samples.length, rateHz);
  const channel = buffer.getChannelData(0);
  samples.forEach((sample, i) => (channel[i] = sample / 32768));
  const source = Object.assign(audio.createBufferSource(), { buffer });
  source.connect(audio.destination);
  source.addEventListener("ended", () => audio.close());
  source.start();
}

// The plot never zooms in past this peak (-50 dBFS), so a silent clip still looks silent.
const WAVE_MIN_PEAK = 100;

/** The last clip's waveform: each pixel column's lowest and highest sample, the clip's peak at the edges. */
function drawClip() {
  const { ctx, width, height } = fitCanvas($("voice-wave"));
  const colors = getColors();
  const mid = height / 2;
  hairline(ctx, 0, mid, width, mid, colors.grid);
  $("voice-levels").textContent = "";
  if (!last) return;

  const { samples, boardId } = last.shown;
  const levels = clipLevels(samples);
  // The mic is quiet (peaks of -40 dBFS are ordinary), so the plot fills its height with the
  // clip's own peak instead of full scale; a floor keeps silence from being blown up to noise.
  const peak = samples.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
  const fullHeight = Math.max(peak, WAVE_MIN_PEAK);
  const zoom = 32768 / fullHeight;
  $("voice-levels").textContent =
    `${boardId} · peak ${levels.peakDbfs.toFixed(0)} dBFS · rms ${levels.rmsDbfs.toFixed(0)} dBFS · plot ×${zoom.toFixed(zoom < 10 ? 1 : 0)}`;
  const perColumn = samples.length / width;
  ctx.strokeStyle = levels.clipped ? colors.bad : colors.readout;
  ctx.beginPath();
  for (let x = 0; x < width; x++) {
    let low = 0;
    let high = 0;
    const end = Math.min(samples.length, Math.ceil((x + 1) * perColumn));
    for (let i = Math.floor(x * perColumn); i < end; i++) {
      low = Math.min(low, samples[i]);
      high = Math.max(high, samples[i]);
    }
    ctx.moveTo(x + 0.5, mid - (high / fullHeight) * mid);
    ctx.lineTo(x + 0.5, mid - (low / fullHeight) * mid + 1);
  }
  ctx.stroke();
}

// ---- background audio --------------------------------------------------------------------
// Each board streams its mic (ADPCM) and the page writes it straight into a WAV in the folder, so
// an hour (115 MB) never sits in memory. The header is written last, once the length is known.

/** Starts one board's recording; throws, leaving nothing behind, if it refuses. */
async function startBackgroundOn(board, target, date) {
  const name = clipFileName(board.boardId, date, $("voice-speaker").value);
  const directory = await target.getDirectoryHandle(BACKGROUND_FOLDER, { create: true });
  const writable = await (await directory.getFileHandle(name, { create: true })).createWritable();
  await writable.write(new Uint8Array(WAV_HEADER_BYTES)); // replaced at the end
  const recording = { board, writable, name, track: new AudioTrack(), started: performance.now(), rateHz: board.info?.micRateHz ?? 16000, writing: Promise.resolve() };
  background.set(board, recording);
  try {
    await board.startAudioStream((chunk) => {
      if (!chunk) return finishBackground(recording).then(renderBackground); // the board disconnected
      const samples = recording.track.add(chunk);
      if (samples.length) recording.writing = recording.writing.then(() => writable.write(pcmBytes(samples)));
    }, (adpcm, state) => decodeAdpcm(adpcm, state));
  } catch (error) {
    background.delete(board);
    await writable.abort();
    await directory.removeEntry(name).catch(() => {}); // getFileHandle left it there, empty
    throw error;
  }
}

async function startBackground() {
  const boards = getBoards().filter((board) => board.connected && board.voice);
  if (!boards.length) return setBackgroundStatus("Connect a board with current firmware first.", true);
  if (isRecording()) return setBackgroundStatus("Stop the live recording first: streaming audio pauses the boards' live data.", true);
  const target = await writableFolder();
  if (!target) return setBackgroundStatus("Choose a folder first: background audio is too long to download.", true);

  const date = new Date();
  const results = await Promise.allSettled(boards.map((board) => startBackgroundOn(board, target, date)));
  const refused = results.flatMap((result, i) => (result.status === "rejected" ? [`${boards[i].displayName}: ${result.reason.message}`] : []));
  if (background.size) backgroundTimer = setInterval(renderBackground, 1000);
  renderBackground();
  if (refused.length) setBackgroundStatus(`Refused: ${refused.join("; ")}.${background.size ? ` Recording from the other${background.size === 1 ? "" : "s"}.` : ""}`, true);
}

/** Ends one board's recording and finishes its file; returns what it saved. */
async function finishBackground(recording) {
  if (background.get(recording.board) !== recording) return null;
  background.delete(recording.board);
  await recording.board.stopAudioStream().catch(() => {});
  await recording.writing;
  await recording.writable.write({ type: "write", position: 0, data: wavHeader(recording.track.samples, recording.rateHz) });
  await recording.writable.close();
  backgroundFiles++;
  const minutes = (recording.track.samples / recording.rateHz / 60).toFixed(1);
  const lost = recording.track.lostSamples / recording.rateHz;
  return `${BACKGROUND_FOLDER}/${recording.name}: ${minutes} min${lost ? `, ${lost.toFixed(1)} s lost (silence in its place)` : ""}`;
}

async function stopBackground() {
  const saved = await Promise.all([...background.values()].map(finishBackground));
  setBackgroundStatus(`Saved ${saved.filter(Boolean).join("; ")}.`);
  renderBackground();
}

function renderBackground() {
  const recordings = [...background.values()];
  $("voice-bg-record").textContent = recordings.length ? "Stop" : "Record background audio";
  $("voice-bg-record").classList.toggle("recording", recordings.length > 0);
  renderVoice();
  if (!recordings.length) {
    clearInterval(backgroundTimer);
    return;
  }
  const seconds = Math.max(...recordings.map(({ track, rateHz }) => track.samples / rateHz));
  const lost = recordings.reduce((sum, { track, rateHz }) => sum + track.lostSamples / rateHz, 0);
  const who = recordings.length === 1 ? recordings[0].board.displayName : `${recordings.length} boards`;
  setBackgroundStatus(`Recording from ${who}: ${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}${lost ? `, ${lost.toFixed(1)} s lost` : ""}. Talk, play music, work as usual: just don't say “${PHRASE.say}”.`);
}

function setBackgroundStatus(text, bad = false) {
  $("voice-bg-status").textContent = text;
  $("voice-bg-status").className = bad ? "bad-text" : "muted";
}
