// Voice commands on the page (docs/voice-commands.md). Settings › Voice: the selected board's
// model, which actions it obeys, what it heard, and uploading a model to the boards. The keyword
// clips dialog: the words (vocabulary.json in a folder the user picks), and training clips of
// them recorded through the selected board's own microphone (Board.captureClip), saved as WAVs one
// subfolder per label for the training pipeline, each sent over Bluetooth or, with the board
// plugged in, read through its USB programmer (mailbox.js). The clips are the user's voice: they
// only ever go into that folder, never into tools/dashboard/ (published).
import { fitCanvas, hairline } from "./canvas.js";
import { decodeAdpcm } from "./adpcm.js";
import {
  ACTION_TEXT, AudioTrack, DEFAULT_VOCABULARY, MAX_PHRASES, VOCABULARY_FILE, WAV_HEADER_BYTES, clipFileName, clipLevels, encodeWav, keywordLabels,
  labelFor, parseVocabulary, pcmBytes, vocabularyProblems, wavHeader,
} from "./clips.js";
import { modelResultText } from "./board.js";
import { readMailbox } from "./mailbox.js";
import { kvGet, kvSet } from "./storage.js";
import { Dap, Nrf54lm20a, PROBE_FILTER, openProbe } from "./swd.js";
import { parseVoicePackage } from "./voicepkg.js";
import { VOICE_ACTIONS } from "./wire.js";

const $ = (id) => document.getElementById(id);
const FOLDER_KEY = "keyword-folder";
const SPEAKER_KEY = "voice-speaker";
const BACKGROUND_FOLDER = "background"; // not a label, so training skips it as a class
const READ_WRITE = { mode: "readwrite" };
const CAPTURE_MS = 2000; // CLIP_CAPTURE_SAMPLES in src/keyword/clip_capture.h, at 16 kHz
// Below this a phrase is hard to hear over the room (a laptop click 1 m away peaked near -40).
const QUIET_PEAK_DBFS = -35;

let getBoard = () => null;
let getBoards = () => [];
let isRecording = () => false;
let getColors = () => ({});
let folder = null; // the chosen folder's handle; null downloads each clip instead
let vocabulary = DEFAULT_VOCABULARY; // the folder's vocabulary.json, or the default words
let labels = keywordLabels(vocabulary);
let modelBusy = false; // uploading a model to the boards, or removing one
let modelStatus = null; // { text, bad, until } of an upload or removal: shown while it runs, then a while
const MODEL_STATUS_MS = 20000;
let counts = new Map(); // label -> clips in its subfolder
let last = null; // the last clip: { label, name, samples, rateHz, saved }
let busy = false;
let background = null; // the background recording running: { board, writable, track, started, rateHz }
// The USB programmer clips are read through: { device, transport, chip, boardId }, while the dialog is open.
let usb = null;
let usbPending = Promise.resolve(); // connecting or letting go of it
let usbNote = null; // { text, bad } from the last attempt, shown until the next
// Probe serial number -> board ID, kept for the probes chosen here, so reopening the dialog finds
// the selected board's again without asking.
const USB_PROBES_KEY = "voice-usb-probes";

const labelInfo = (label) => labels.find((entry) => entry.label === label) ?? labels[0];

/**
 * Wires the dialog up. `getBoard()` is the selected board, `getBoards()` every board, and
 * `isRecording()` whether a live recording runs (a clip pauses the board's live streams, which
 * would leave a gap in it).
 */
export function initVoice(options) {
  ({ getBoard, getBoards, isRecording, getColors } = options);
  fillLabels();
  $("voice-label").addEventListener("change", renderVoice);
  $("voice-open").addEventListener("click", () => {
    if (!$("voice-dialog").open) $("voice-dialog").showModal();
    renderVoice();
    drawClip();
    reconnectUsb();
  });
  $("voice-close").addEventListener("click", () => $("voice-dialog").close());
  // Let go of the programmer with the dialog, so Flash over USB, OpenOCD or another tab can have it.
  $("voice-dialog").addEventListener("close", () => queueUsb(async () => {
    await letGoOfUsb();
    usbNote = null;
  }));
  $("voice-usb").addEventListener("click", () => (usbFor(getBoard()) ? queueUsb(useBluetooth) : chooseUsb()));
  navigator.usb?.addEventListener("disconnect", (event) => {
    if (usb?.device !== event.device) return;
    usb = null;
    usbNote = { text: "The USB cable was unplugged: clips go over Bluetooth.", bad: false };
    renderVoice();
  });
  $("voice-pick-folder").addEventListener("click", pickFolder);
  $("voice-capture").addEventListener("click", capture);
  $("voice-play").addEventListener("click", play);
  $("voice-discard").addEventListener("click", discard);
  // Space captures, so a run of clips needs no mouse; not while choosing a label.
  $("voice-dialog").addEventListener("keydown", (event) => {
    if (event.key !== " " || event.target.tagName === "SELECT") return;
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
  $("voice-bg-record").addEventListener("click", () => (background ? stopBackground() : startBackground()));
  $("voice-listen").addEventListener("click", () => {
    const board = getBoard();
    if (board?.voice) sendVoiceSettings(board, { ...board.voice, listening: !board.voice.listening });
  });
  $("voice-obeyed").replaceChildren(...VOICE_ACTIONS.map((action) => {
    const box = Object.assign(document.createElement("input"), { type: "checkbox", value: action, disabled: true });
    box.addEventListener("change", () => {
      const board = getBoard();
      if (!board?.voice) return;
      const obeyed = [...$("voice-obeyed").querySelectorAll("input:checked")].map((input) => input.value);
      sendVoiceSettings(board, { ...board.voice, obeyed });
    });
    const label = document.createElement("label");
    label.append(box, document.createElement("span"));
    return label;
  }));
  $("voice-model-upload").addEventListener("click", () => $("voice-model-file").click());
  $("voice-model-file").addEventListener("change", () => {
    const [file] = $("voice-model-file").files;
    $("voice-model-file").value = "";
    if (file) uploadModel(file);
  });
  $("voice-model-remove").addEventListener("click", removeModel);
  initWords();
  restoreFolder();
}

function fillLabels() {
  const current = $("voice-label").value;
  labels = keywordLabels(vocabulary);
  $("voice-label").replaceChildren(...labels.map(({ label }) => new Option(label, label)));
  if (labels.some(({ label }) => label === current)) $("voice-label").value = current;
}

// Shown at once, before the board confirms: the page redraws from board.voice every 250 ms, so
// without this a tick would flip back for the moment the write takes. Put back if the board refuses.
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
  if (!model || model.state === "none") return "No voice model on this board: upload one (a .voice file from task training:export).";
  if (model.state === "failed") return `Its stored model was refused: ${modelResultText(model)}. Upload another.`;
  if (model.state !== "ready" && model.state !== "saving") return "Loading a voice model…";
  return voice.listening ? "Listening. It obeys the ticked actions; every board in earshot hears them." : "Not listening: it ignores every command.";
}

function modelLine(board) {
  const model = board?.connected ? board.voiceModel : null;
  if (!model) return "";
  const name = board.vocabulary?.name;
  const size = model.totalBytes ? ` · ${(model.totalBytes / 1024).toFixed(1)} KB` : "";
  return name ? `Model: ${name} · ${board.vocabulary.commands.length} phrases${size}` : "Model: none";
}

/** Settings › Voice, for the selected board: its model, listening, the actions it obeys, what it heard lately. */
export function renderVoiceSettings() {
  const board = getBoard();
  const voice = board?.connected ? board.voice : null;
  $("voice-listen").disabled = !voice;
  $("voice-listen").setAttribute("aria-checked", String(Boolean(voice?.listening)));
  const takers = getBoards().filter((each) => each.connected && each.voiceModel);
  $("voice-model-upload").disabled = modelBusy || !takers.length;
  $("voice-model-remove").disabled = modelBusy || !board?.connected || !board.vocabulary?.name;
  $("voice-model").textContent = modelLine(board);
  for (const box of $("voice-obeyed").querySelectorAll("input")) {
    box.disabled = !voice;
    box.checked = Boolean(voice?.obeyed.includes(box.value));
    const phrases = phrasesFor(board, box.value);
    const label = box.parentElement;
    label.classList.toggle("unused", Boolean(board?.vocabulary?.name) && !phrases.length);
    label.title = `${ACTION_TEXT[box.value]}${phrases.length ? `: ${phrases.join(", ")}` : ""}`;
    label.querySelector("span").textContent = phrases.length ? `${phrases.join(" / ")} · ${ACTION_TEXT[box.value]}` : ACTION_TEXT[box.value];
  }
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

export const voiceDialogOpen = () => $("voice-dialog").open || $("words-dialog").open;

/** Updates the dialog for the selected board and label; cheap enough to call on every redraw. */
export function renderVoice() {
  const board = getBoard();
  const info = labelInfo($("voice-label").value);
  $("voice-board").textContent = board ? `· ${board.displayName}` : "";
  $("voice-say").textContent = info.label.startsWith("_") ? info.say : `“${info.say}”`;
  $("voice-does").textContent = `${info.does} · ${counts.get(info.label) ?? 0} clips`;
  $("voice-capture").disabled = busy || !board?.connected || !board.canCaptureClips;
  $("voice-play").disabled = !last;
  $("voice-discard").disabled = busy || !last?.saved;
  renderUsb(board);
  if (!busy) {
    const reason = !board?.connected ? "Connect a board first."
      : !board.canCaptureClips ? "This board's firmware can't capture clips: update it." : "";
    if (reason || $("voice-status").dataset.reason) setStatus(reason, { reason: Boolean(reason) });
  }
  $("voice-counts").replaceChildren(...labels.map(({ label }) => {
    const item = document.createElement("li");
    item.classList.toggle("current", label === info.label);
    item.append(label, Object.assign(document.createElement("span"), { className: "num", textContent: String(counts.get(label) ?? 0) }));
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
    : `Saving into ${folder.name}/<label>/`;
  $("voice-folder").className = permission === "denied" ? "bad-text" : "muted";
}

async function restoreFolder() {
  const handle = await kvGet(FOLDER_KEY);
  if (!handle || folder) return renderFolder();
  folder = handle;
  try {
    const permission = await handle.queryPermission(READ_WRITE);
    renderFolder(permission);
    if (permission === "granted") await loadFolder();
  } catch {
    renderFolder("prompt");
  }
}

/** The folder's words (the default ones without a vocabulary.json), then its clip counts. */
async function loadFolder() {
  vocabulary = DEFAULT_VOCABULARY;
  try {
    const file = await (await folder.getFileHandle(VOCABULARY_FILE)).getFile();
    vocabulary = parseVocabulary(await file.text());
  } catch (error) {
    if (error.name !== "NotFoundError") setStatus(`${VOCABULARY_FILE} in ${folder.name}/ isn't usable (${error.message}): the default words for now.`, { bad: true });
  }
  fillLabels();
  await recount();
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
  await loadFolder();
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

async function recount() {
  counts = new Map();
  for (const { label } of labels) {
    let directory;
    try {
      directory = await folder.getDirectoryHandle(label);
    } catch {
      continue; // nothing recorded under this label yet
    }
    let count = 0;
    for await (const name of directory.keys()) if (name.endsWith(".wav")) count++;
    counts.set(label, count);
  }
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
async function capture() {
  const board = getBoard();
  if (busy || $("voice-capture").disabled || !board) return;
  // Over USB the live streams carry on, so only a clip over Bluetooth would leave a gap in a recording.
  const refuseDuringRecording = () => {
    if (!isRecording()) return false;
    setStatus("Stop the live recording first, or use the USB cable: a clip over Bluetooth pauses the board's live streams.", { bad: true });
    return true;
  };
  if (!usbFor(board) && refuseDuringRecording()) return;
  const label = $("voice-label").value;
  const target = await writableFolder();
  busy = true;
  renderVoice();
  setBar(0);
  let speakTimer = null;
  await usbPending;
  const probe = usbFor(board);
  if (!probe && refuseDuringRecording()) {
    busy = false;
    renderVoice();
    return;
  }
  try {
    const samples = await board.captureClip({
      usb: probe?.chip,
      onCapturing: () => {
        const started = performance.now();
        setStatus("Speak now (LED magenta)");
        speakTimer = setInterval(() => setBar(Math.min(1, (performance.now() - started) / CAPTURE_MS)), 50);
      },
      onProgress: (fraction) => {
        clearInterval(speakTimer);
        setBar(fraction);
        setStatus(`${probe ? "Reading over USB" : "Sending"}… ${Math.round(fraction * 100)}%`);
      },
    });
    const rateHz = board.info?.micRateHz ?? 16000;
    const name = clipFileName(board.boardId, new Date(), $("voice-speaker").value);
    const saved = await save(target, label, name, encodeWav(samples, rateHz));
    last = { label, name, samples, rateHz, saved };
    counts.set(label, (counts.get(label) ?? 0) + 1); // downloaded clips count too, for this page load
    setStatus(`${saved ? "Saved" : "Downloaded"} ${label}/${name}. ${verdict(label, clipLevels(samples))}`);
    setBar(1);
  } catch (error) {
    setStatus(`No clip: ${error.message}`, { bad: true });
    setBar(0);
    if (probe) await queueUsb(() => dropUsbIfGone(probe));
  } finally {
    clearInterval(speakTimer);
    busy = false;
    renderVoice();
    drawClip();
  }
}

// ---- clips over the USB cable -------------------------------------------------------------
// The board's own USB programmer (swd.js) reads each clip straight from its RAM (mailbox.js). The
// capture is still asked for over Bluetooth. Attaching the debugger leaves the chip in debug mode,
// so the board can't sleep afterwards until it loses all power (CLAUDE.md, sleep and debug mode).

const usbFor = (board) => (usb && board && usb.boardId === board.boardId ? usb : null);

/** Runs `step` after any connecting or letting go already under way; never rejects. */
function queueUsb(step) {
  usbPending = usbPending.then(step).catch((error) => {
    usbNote = { text: `USB: ${error.message}`, bad: true };
  }).finally(renderVoice);
  return usbPending;
}

function renderUsb(board) {
  const mine = usbFor(board);
  $("voice-usb").textContent = mine ? "Use Bluetooth" : "Use USB cable…";
  $("voice-usb").disabled = busy || !navigator.usb || !board?.connected;
  const note = usbNote ?? (!navigator.usb ? { text: "This browser has no WebUSB: clips go over Bluetooth." }
    : mine ? { text: `Over ${mine.boardId}'s USB cable: under 1 s a clip.` }
    : usb ? { text: `The cable is ${usb.boardId}'s: ${board?.displayName ?? "this board"}'s clips go over Bluetooth.` }
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

/** The button: asks for the programmer (a click, as WebUSB requires), then attaches it. */
async function chooseUsb() {
  const board = getBoard();
  let device;
  try {
    device = await navigator.usb.requestDevice({ filters: [PROBE_FILTER] });
  } catch {
    return; // chooser dismissed
  }
  usbNote = { text: "Connecting to the USB programmer…" };
  await queueUsb(() => attachUsb(device, board));
}

/** On opening the dialog: the selected board's programmer again, if it was chosen here before and is plugged in. */
async function reconnectUsb() {
  const board = getBoard();
  if (!navigator.usb || !board || usbFor(board)) return;
  const serial = Object.entries(rememberedProbes()).find(([, id]) => id === board.boardId)?.[0];
  if (!serial) return;
  await queueUsb(async () => {
    const device = (await navigator.usb.getDevices()).find((each) => each.serialNumber === serial);
    if (device) await attachUsb(device, board);
  });
}

async function attachUsb(device, board) {
  await letGoOfUsb();
  const transport = await openProbe(device);
  const chip = new Nrf54lm20a(new Dap(transport));
  try {
    const { locked } = await chip.attach();
    if (locked) throw new Error("the board's chip is locked: flash it over USB first");
    const { boardId } = await chip.identify();
    if (board && boardId !== board.boardId) throw new Error(`that's ${boardId}'s cable, not ${board.displayName}'s`);
    if (!(await readMailbox(chip))) throw new Error(`${boardId}'s firmware can't hand clips over USB: update it`);
    // Only one that worked, so reopening the dialog never attaches to a board nobody chose here.
    rememberProbe(device.serialNumber, boardId);
    usb = { device, transport, chip, boardId };
    usbNote = null;
  } catch (error) {
    await chip.detach();
    await transport.close().catch(() => {});
    throw error;
  }
}

async function letGoOfUsb() {
  const held = usb;
  usb = null;
  if (!held) return;
  await held.chip.detach();
  await held.transport.close().catch(() => {});
}

/** "Use Bluetooth": lets go, and forgets the probe so reopening the dialog doesn't take it again. */
async function useBluetooth() {
  if (usb) rememberProbe(null, usb.boardId);
  await letGoOfUsb();
  usbNote = null;
}

/** After a failed clip: lets go of a programmer that no longer answers (unplugged, or taken by another program). */
async function dropUsbIfGone(probe) {
  if (usb !== probe) return;
  try {
    await readMailbox(probe.chip);
  } catch {
    await letGoOfUsb();
    usbNote = { text: "The USB cable stopped answering: clips go over Bluetooth.", bad: true };
  }
}

function verdict(label, levels) {
  if (levels.clipped > 0) return "It clipped: speak softer or further away, and discard it.";
  if (!label.startsWith("_") && levels.peakDbfs < QUIET_PEAK_DBFS) return "It's quiet: come closer or speak up.";
  return "";
}

async function discard() {
  if (!last?.saved || busy) return;
  try {
    await (await folder.getDirectoryHandle(last.label)).removeEntry(last.name);
    counts.set(last.label, Math.max(0, (counts.get(last.label) ?? 1) - 1));
    setStatus(`Discarded ${last.label}/${last.name}.`);
    last = null;
  } catch (error) {
    setStatus(`Couldn't discard it: ${error.message}`, { bad: true });
  }
  renderVoice();
  drawClip();
}

function play() {
  if (!last) return;
  const audio = new AudioContext();
  const buffer = audio.createBuffer(1, last.samples.length, last.rateHz);
  const channel = buffer.getChannelData(0);
  last.samples.forEach((sample, i) => (channel[i] = sample / 32768));
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

  const levels = clipLevels(last.samples);
  // The mic is quiet (peaks of -40 dBFS are ordinary), so the plot fills its height with the
  // clip's own peak instead of full scale; a floor keeps silence from being blown up to noise.
  const peak = last.samples.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
  const fullHeight = Math.max(peak, WAVE_MIN_PEAK);
  const zoom = 32768 / fullHeight;
  $("voice-levels").textContent =
    `peak ${levels.peakDbfs.toFixed(0)} dBFS · rms ${levels.rmsDbfs.toFixed(0)} dBFS · plot ×${zoom.toFixed(zoom < 10 ? 1 : 0)}`;
  const perColumn = last.samples.length / width;
  ctx.strokeStyle = levels.clipped ? colors.bad : colors.readout;
  ctx.beginPath();
  for (let x = 0; x < width; x++) {
    let low = 0;
    let high = 0;
    const end = Math.min(last.samples.length, Math.ceil((x + 1) * perColumn));
    for (let i = Math.floor(x * perColumn); i < end; i++) {
      low = Math.min(low, last.samples[i]);
      high = Math.max(high, last.samples[i]);
    }
    ctx.moveTo(x + 0.5, mid - (high / fullHeight) * mid);
    ctx.lineTo(x + 0.5, mid - (low / fullHeight) * mid + 1);
  }
  ctx.stroke();
}

// ---- background audio --------------------------------------------------------------------
// The board streams its mic (ADPCM) and the page writes it straight into a WAV in the folder, so
// an hour (115 MB) never sits in memory. The header is written last, once the length is known.
async function startBackground() {
  const board = getBoard();
  if (!board?.connected || !board.voice) return setBackgroundStatus("Connect a board with current firmware first.", true);
  if (isRecording()) return setBackgroundStatus("Stop the live recording first: streaming audio pauses the board's live data.", true);
  const target = await writableFolder();
  if (!target) return setBackgroundStatus("Choose a folder first: background audio is too long to download.", true);

  const name = clipFileName(board.boardId, new Date(), $("voice-speaker").value);
  const directory = await target.getDirectoryHandle(BACKGROUND_FOLDER, { create: true });
  const writable = await (await directory.getFileHandle(name, { create: true })).createWritable();
  await writable.write(new Uint8Array(WAV_HEADER_BYTES)); // replaced at the end
  const recording = { board, writable, name, track: new AudioTrack(), started: performance.now(), rateHz: board.info?.micRateHz ?? 16000, writing: Promise.resolve() };
  background = recording;
  try {
    await board.startAudioStream((chunk) => {
      if (!chunk) return stopBackground(); // the board disconnected
      const samples = recording.track.add(chunk);
      if (samples.length) recording.writing = recording.writing.then(() => writable.write(pcmBytes(samples)));
    }, (adpcm, state) => decodeAdpcm(adpcm, state));
  } catch (error) {
    background = null;
    await writable.abort();
    return setBackgroundStatus(`The board refused: ${error.message}`, true);
  }
  recording.timer = setInterval(renderBackground, 1000);
  renderBackground();
}

async function stopBackground() {
  const recording = background;
  if (!recording) return;
  background = null;
  clearInterval(recording.timer);
  await recording.board.stopAudioStream().catch(() => {});
  await recording.writing;
  await recording.writable.write({ type: "write", position: 0, data: wavHeader(recording.track.samples, recording.rateHz) });
  await recording.writable.close();
  const minutes = (recording.track.samples / recording.rateHz / 60).toFixed(1);
  const lost = recording.track.lostSamples / recording.rateHz;
  setBackgroundStatus(`Saved ${BACKGROUND_FOLDER}/${recording.name}: ${minutes} min${lost ? `, ${lost.toFixed(1)} s lost (silence in its place)` : ""}.`);
  renderBackground();
}

function renderBackground() {
  $("voice-bg-record").textContent = background ? "Stop" : "Record background audio";
  $("voice-bg-record").classList.toggle("recording", Boolean(background));
  if (!background) return;
  const seconds = background.track.samples / background.rateHz;
  const lost = background.track.lostSamples / background.rateHz;
  setBackgroundStatus(`Recording from ${background.board.displayName}: ${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}${lost ? `, ${lost.toFixed(1)} s lost` : ""}. Talk, play music, work as usual: just don't say the commands.`);
}

function setBackgroundStatus(text, bad = false) {
  $("voice-bg-status").textContent = text;
  $("voice-bg-status").className = bad ? "bad-text" : "muted";
}

// ---- words --------------------------------------------------------------------------------
// The words dialog edits a copy of the vocabulary; Save writes it into the folder as
// vocabulary.json, where training reads it. Each row keeps the label it came with until its
// phrase is changed: the label is its clips' folder, so new words make a new one.
let draft = null; // { name, rows: [{ say, action, original: { label, say } | null }] }

const rowLabel = (row) => (row.original && row.say === row.original.say ? row.original.label : labelFor(row.say));
const draftVocabulary = () => ({ version: 1, name: draft.name.trim(), phrases: draft.rows.map((row) => ({ label: rowLabel(row), say: row.say.trim(), action: row.action })) });

function initWords() {
  $("voice-words").addEventListener("click", () => {
    draft = { name: vocabulary.name ?? "", rows: vocabulary.phrases.map(({ label, say, action }) => ({ say, action, original: { label, say } })) };
    $("words-name").value = draft.name;
    $("words-status").textContent = folder ? `Saving into ${folder.name}/${VOCABULARY_FILE}` : "Choose the clips folder first: the words are saved in it.";
    renderWords();
    $("words-dialog").showModal();
  });
  $("words-close").addEventListener("click", () => $("words-dialog").close());
  $("words-name").addEventListener("input", () => {
    draft.name = $("words-name").value;
    renderWordProblems();
  });
  $("words-add").addEventListener("click", () => {
    const used = new Set(draft.rows.map((row) => row.action));
    draft.rows.push({ say: "", action: VOICE_ACTIONS.find((action) => !used.has(action)) ?? "mark", original: null });
    renderWords();
    $("words-list").querySelector("li:last-child input")?.focus();
  });
  $("words-default").addEventListener("click", () => {
    draft = { name: DEFAULT_VOCABULARY.name, rows: DEFAULT_VOCABULARY.phrases.map(({ label, say, action }) => ({ say, action, original: { label, say } })) };
    $("words-name").value = draft.name;
    renderWords();
  });
  $("words-save").addEventListener("click", saveWords);
}

function renderWords() {
  $("words-list").replaceChildren(...draft.rows.map((row, index) => {
    const item = document.createElement("li");
    const say = Object.assign(document.createElement("input"), { type: "text", value: row.say, placeholder: "a phrase of a few syllables", ariaLabel: `Phrase ${index + 1}` });
    const action = Object.assign(document.createElement("select"), { ariaLabel: `What “${row.say}” does` });
    action.append(...VOICE_ACTIONS.map((name) => new Option(ACTION_TEXT[name], name, false, name === row.action)));
    const remove = Object.assign(document.createElement("button"), { type: "button", textContent: "✕", ariaLabel: `Remove phrase ${index + 1}` });
    const folderName = Object.assign(document.createElement("span"), { className: "num" });
    const showFolder = () => (folderName.textContent = row.say.trim() ? `clips in ${rowLabel(row) || "?"}/` : "");
    say.addEventListener("input", () => {
      row.say = say.value;
      showFolder();
      renderWordProblems();
    });
    action.addEventListener("change", () => {
      row.action = action.value;
      renderWordProblems();
    });
    remove.addEventListener("click", () => {
      draft.rows.splice(index, 1);
      renderWords();
    });
    showFolder();
    item.append(say, action, remove, folderName);
    return item;
  }));
  $("words-add").disabled = draft.rows.length >= MAX_PHRASES;
  renderWordProblems();
}

function renderWordProblems() {
  const { errors, warnings } = vocabularyProblems(draftVocabulary());
  $("words-problems").replaceChildren(...[...errors.map((text) => [text, "bad-text"]), ...warnings.map((text) => [text, "muted"])]
    .map(([text, className]) => Object.assign(document.createElement("li"), { textContent: text, className })));
  $("words-save").disabled = errors.length > 0;
}

async function saveWords() {
  const edited = draftVocabulary();
  if (vocabularyProblems(edited).errors.length) return;
  const target = await writableFolder();
  if (!target) {
    $("words-status").textContent = "Choose the clips folder first (Choose folder… in the clips dialog): the words are saved in it.";
    return;
  }
  try {
    const writable = await (await target.getFileHandle(VOCABULARY_FILE, { create: true })).createWritable();
    await writable.write(`${JSON.stringify(edited, null, 2)}\n`);
    await writable.close();
  } catch (error) {
    $("words-status").textContent = `Not saved: ${error.message}`;
    return;
  }
  vocabulary = edited;
  fillLabels();
  await recount();
  $("words-status").textContent = `Saved ${target.name}/${VOCABULARY_FILE}. Record clips of any new phrases, then train and export.`;
  draft.rows.forEach((row) => (row.original = { label: rowLabel(row), say: row.say.trim() }));
  renderWords();
}
