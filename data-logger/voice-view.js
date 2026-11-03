// Voice commands on the page (docs/voice-commands.md). Settings › Voice: the selected board's
// model, whether it listens, what it heard, and uploading a model to the boards. Only the clock
// source listens. The clips dialog records training data of the one phrase through every connected
// board's microphone at once for as long as Space is held (Board.captureClip), so each saying gives
// a clip per board, saved as WAVs for the training pipeline, each sent over Bluetooth or, with a
// board plugged in, read through its USB programmer (mailbox.js). The clips are the user's voice:
// they only ever go into the folder the user picks, never into tools/dashboard/ (published).
import { isArrow, nearestWay } from "./arrow-keys.js";
import { fitCanvas, hairline } from "./canvas.js";
import { decodeAdpcm } from "./adpcm.js";
import {
  ACTION_TEXT, AudioTrack, SPELLER_VOCABULARY, WAV_HEADER_BYTES, clipFileName, clipLevels, encodeWav, nextWord, pcmBytes, wavHeader,
} from "./clips.js";
import {
  CLIP_SAMPLES, HOLD_LEAD_SAMPLES, HOLD_TAIL_SAMPLES, MIN_SECTION_SAMPLES, clipAround, following, grabbedEdge, heldSection, panned, sameSection, sampleAt, sectionBetween, wholeClip, xOf, zoomed,
} from "./clip-view.js";
import { modelResultText } from "./board.js";
import { DEFAULT_TARGET, heardWord, nextStep, progress, wayToSay } from "./collect.js";
import { readMailbox } from "./mailbox.js";
import { meterFraction, peakToDbfs, recentPeak } from "./signal.js";
import { kvGet, kvSet } from "./storage.js";
import { Dap, Nrf54lm20a, PROBE_FILTER, openProbe } from "./swd.js";
import { parseVoicePackage } from "./voicepkg.js";

const $ = (id) => document.getElementById(id);
const FOLDER_KEY = "keyword-folder";
const SPEAKER_KEY = "voice-speaker";
const TARGET_KEY = "voice-target";
const BACKGROUND_FOLDER = "background"; // not a label: training cuts it into _silence and _unknown pieces
const SPELLING = SPELLER_VOCABULARY.phrases;
const READ_WRITE = { mode: "readwrite" };
const MAX_HOLD_MS = (CLIP_SAMPLES - HOLD_LEAD_SAMPLES - HOLD_TAIL_SAMPLES) / 16; // at 16 kHz
const MIN_HOLD_MS = 200; // anything less was a tap, not a word
const ARROW_STOPS = "button:not(:disabled)";
const LEVEL_FLOOR_DBFS = -80; // the room, on the level meter (the mic's words peak near -35)
const LEVEL_PEAKS = 80; // about the last 80 ms

let getBoard = () => null;
let getBoards = () => [];
let isRecording = () => false;
let getColors = () => ({});
let folder = null; // the chosen folder's handle; null downloads each clip instead
let modelBusy = false; // uploading a model to the boards, or removing one
let modelStatus = null; // { text, bad, until } of an upload or removal: shown while it runs, then a while
const MODEL_STATUS_MS = 20000;
let folderState = "none"; // collect.js's nextStep() says what each means
let target = DEFAULT_TARGET; // clips to aim for of each word
let word = SPELLING[0]; // what the next clip records
const wordClips = new Map(); // label -> clips in its subfolder
let backgroundFiles = 0; // recordings in the background subfolder
// The last saying: a clip per board, { label, say, name, boardId, samples, rateHz, saved, held, kept }
// (the take as recorded, a moment either side of the hold; the section held, and the section in its
// saved file), and the one shown.
let last = null; // { clips, shown }
// How the shown clip is looked at, in samples: what the plot holds, and the section highlighted to keep.
let view = null;
let section = null;
let dragAnchor = null; // the sample a drag across the plot holds still; null when not dragging
let dragX = 0;
let playback = null; // { audio, at, start, end, rateHz, frame } while a clip plays
let busy = false;
let recordDown = false; // Space or the record button is held
let pressedAt = 0;
let heldMs = Infinity; // how long the last release followed its press
let holdingBoards = []; // the boards recording for that hold
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
    currentWordKey()?.focus(); // so the arrows start from the word, not the header's buttons
    drawClip();
    reconnectUsb();
    restoreFolder();
  });
  $("voice-close").addEventListener("click", () => $("voice-dialog").close());
  $("voice-dialog").addEventListener("close", stopPlaying);
  $("voice-dialog").addEventListener("close", releaseRecord);
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
  $("voice-capture").addEventListener("pointerdown", (event) => {
    if (event.button === 0) pressRecord();
  });
  // Touch-and-hold would otherwise bring up the context menu and cancel the pointer.
  $("voice-capture").addEventListener("contextmenu", (event) => event.preventDefault());
  // On the window: the pointer may have left the button, and a key's release may go unheard.
  window.addEventListener("pointerup", releaseRecord);
  window.addEventListener("pointercancel", releaseRecord);
  window.addEventListener("blur", releaseRecord);
  $("voice-play").addEventListener("click", play);
  $("voice-discard").addEventListener("click", discard);
  $("voice-keep").addEventListener("click", keepSection);
  $("voice-restore").addEventListener("click", restoreClips);
  initPlotEditing();
  // A run of clips needs no mouse: Space records while held, P plays, Backspace redoes, the arrows
  // move between buttons, Enter presses one (holding the record key records) and Q closes. Space
  // stays record on any button, or a word could be lost to a focus ring nobody was looking at. Not
  // while typing, and on the window: clicking the waveform to trim leaves the focus outside the dialog.
  window.addEventListener("keydown", (event) => {
    if (!$("voice-dialog").open || background.size || isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === " " || (event.key === "Enter" && recordsOnEnter(event.target))) {
      event.preventDefault();
      if (!event.repeat) pressRecord();
    } else if (event.repeat) {
      return;
    } else if (event.key === "p" || event.key === "P") {
      event.preventDefault();
      if (last) play();
    } else if (event.key === "Backspace") {
      event.preventDefault();
      discard();
    }
  });
  window.addEventListener("keyup", (event) => {
    if ((event.key !== " " && event.key !== "Enter") || !recordDown) return;
    event.preventDefault();
    releaseRecord();
  });
  // Apart from the listener above, which stands down while background audio records.
  window.addEventListener("keydown", (event) => {
    if (!$("voice-dialog").open || isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
    if (isArrow(event.key)) moveFocus(event);
    else if ((event.key === "q" || event.key === "Q") && !event.repeat && !recordDown) $("voice-dialog").close();
  });
  $("voice-speaker").value = remembered(SPEAKER_KEY) ?? "";
  $("voice-speaker").addEventListener("change", () => remember(SPEAKER_KEY, $("voice-speaker").value.trim()));
  target = Number(remembered(TARGET_KEY)) || DEFAULT_TARGET;
  $("voice-target").value = target;
  $("voice-target").addEventListener("change", () => {
    target = Math.max(1, Math.round(Number($("voice-target").value)) || DEFAULT_TARGET);
    $("voice-target").value = target;
    remember(TARGET_KEY, target);
    renderVoice();
  });
  // Enter leaves a box, so Space records again without reaching for the mouse.
  for (const id of ["voice-speaker", "voice-target"]) {
    $(id).addEventListener("keydown", (event) => {
      if (event.key === "Enter") event.target.blur();
    });
  }
  buildWords();
  renderVoice();
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

function remembered(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage blocked: it lasts for this page load
  }
}

function remember(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* as above */
  }
}

const isTyping = (element) => element?.matches?.('input[type="text"], input[type="number"]') ?? false;

const currentWordKey = () => $("voice-words").querySelector('[aria-current="true"]');

function chooseWord(phrase) {
  word = phrase;
  renderVoice();
}

/** Enter records like Space, except on a button that does something else with it (Play, Redo, ⓘ…). */
const recordsOnEnter = (target) => !target.matches?.("button") || target === $("voice-capture") || $("voice-words").contains(target);

/**
 * Moves to the button that way, from the focused one or else the current word. A word key chooses
 * its word on arrival: otherwise the ring could sit on one word while Space recorded another.
 */
function moveFocus(event) {
  event.preventDefault();
  if (recordDown) return;
  const stops = [...$("voice-dialog").querySelectorAll(ARROW_STOPS)].filter((stop) => stop.getClientRects().length);
  const from = [document.activeElement, currentWordKey(), stops[0]].find((stop) => stops.includes(stop));
  if (!from) return;
  const box = (stop) => stop.getBoundingClientRect();
  const to = stops[nearestWay(event.key, box(from), stops.map(box))] ?? from;
  to.focus();
  if (to.dataset.label) chooseWord(SPELLING.find(({ label }) => label === to.dataset.label));
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
  const verb = done.length === 1 ? "s" : "";
  setModelStatus([
    done.length ? `${done.join(", ")} now listen${verb} for ${phrases}.` : "",
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

/** The words, one key each, for choosing what to record and seeing how far each has got. */
function buildWords() {
  $("voice-words").replaceChildren(...SPELLING.map((phrase) => {
    const key = Object.assign(document.createElement("button"), { type: "button" });
    key.dataset.label = phrase.label;
    key.append(Object.assign(document.createElement("span"), { textContent: phrase.say }), Object.assign(document.createElement("span"), { className: "count" }));
    key.addEventListener("click", () => chooseWord(phrase));
    return key;
  }));
}

function renderWords() {
  for (const key of $("voice-words").children) {
    const { say } = SPELLING.find(({ label }) => label === key.dataset.label);
    const clips = wordClips.get(key.dataset.label) ?? 0;
    key.lastChild.textContent = String(clips);
    key.classList.toggle("finished", clips >= target);
    key.style.setProperty("--filled", `${Math.min(100, (clips / target) * 100)}%`);
    key.setAttribute("aria-label", `${say}: ${clips} of ${target} clips`);
    const current = key.dataset.label === word.label;
    key.setAttribute("aria-current", String(current));
    key.tabIndex = current ? 0 : -1; // Tab passes the grid in one step; the arrows go through it
    if (current && $("voice-words").contains(document.activeElement)) key.focus(); // the word moved on after a take
  }
  const { clips, wanted, finished } = progress(SPELLING, wordClips, target);
  $("voice-progress-text").textContent = finished ? `All ${SPELLING.length} words done: keep going if you like` : `${clips} of ${wanted} clips`;
}

function renderLevel(board) {
  const dbfs = board ? peakToDbfs(recentPeak(board.envelope, LEVEL_PEAKS)) : -Infinity;
  const percent = Math.round(meterFraction(dbfs, LEVEL_FLOOR_DBFS) * 100);
  $("voice-level").querySelector("i").style.width = `${percent}%`;
  $("voice-level").setAttribute("aria-valuenow", String(percent));
}

function folderValue() {
  if (folderState === "download") return "downloads";
  if (!folder) return "none";
  return folderState === "denied" ? `${folder.name}/ refused` : `${folder.name}/`;
}

function renderSetup(boards, connected) {
  const step = (id, done, bad = false) => {
    $(id).classList.toggle("done", done);
    $(id).classList.toggle("bad", bad);
  };
  step("voice-step-folder", folderState === "granted" || folderState === "download", folderState === "denied");
  step("voice-step-speaker", $("voice-speaker").value.trim() !== "");
  step("voice-step-link", boards.length > 0);
  $("voice-folder").textContent = folderValue();
  $("voice-folder").title = folderValue();
  $("voice-pick-folder").hidden = folderState === "download";
  $("voice-pick-folder").textContent = folderState === "prompt" ? "Allow…" : folderState === "granted" ? "Change…" : "Choose…";
  return nextStep({ connected: connected.length > 0, capturing: boards.length > 0, folder: folderState, speaker: $("voice-speaker").value, typing: isTyping(document.activeElement) });
}

/** Updates the dialog for the connected boards; cheap enough to call on every redraw. */
export function renderVoice() {
  const boards = captureBoards();
  const connected = getBoards().filter((board) => board.connected);
  const step = renderSetup(boards, connected);
  $("voice-board").textContent = boards.length ? `· ${boards.length === 1 ? boards[0].displayName : `${boards.length} boards`}` : "";
  $("voice-say").textContent = word.say;
  const clipsOfWord = wordClips.get(word.label) ?? 0;
  $("voice-way").textContent = wayToSay(clipsOfWord);
  $("voice-does").textContent = `${clipsOfWord} of ${target} clips`;
  renderWords();
  renderLevel(boards.find((board) => board === getBoard()) ?? boards[0]);
  const lastSaid = last?.clips[0];
  $("voice-last-take").textContent = lastSaid ? `Last take: ${lastSaid.say}${lastSaid.unheard ? " (not saved)" : ""}` : "Last take";
  $("voice-empty").hidden = Boolean(last);
  // Left enabled while held: a disabled button can swallow the release.
  $("voice-capture").disabled = (busy && !recordDown) || Boolean(step) || background.size > 0;
  $("voice-bg-record").disabled = (busy || recordDown) && !background.size;
  $("voice-capture-text").textContent = recordDown ? "Recording: let go when you've finished"
    : busy ? "Saving…" : `Hold Space or Enter to record${boards.length > 1 ? ` on ${boards.length} boards` : ""}`;
  $("voice-capture").classList.toggle("recording", recordDown);
  $("voice-capture").setAttribute("aria-pressed", String(recordDown));
  $("voice-play").disabled = !last;
  $("voice-discard").disabled = busy || !last?.clips.some((clip) => clip.saved);
  $("voice-keep").textContent = lastSaid?.unheard ? "Save anyway" : "Keep section";
  $("voice-keep").disabled = busy || !section || (!lastSaid.unheard && sameSection(section, last.shown.kept));
  $("voice-restore").hidden = !last?.clips.some((clip) => !sameSection(clip.kept, clip.held));
  $("voice-restore").disabled = busy;
  renderUsb(boards);
  $("voice-bg-count").textContent = `${backgroundFiles} saved`;
  if (!busy && (step || $("voice-status").dataset.reason)) setStatus(step ?? "", { reason: Boolean(step) });
}

function setStatus(text, { bad = false, reason = false } = {}) {
  $("voice-status").textContent = text;
  $("voice-status").className = `voice-status${bad ? " bad-text" : reason ? " next-step" : ""}`;
  if (reason) $("voice-status").dataset.reason = "1";
  else delete $("voice-status").dataset.reason;
}

function setBar(fraction) {
  $("voice-bar").querySelector("i").style.width = `${Math.round(fraction * 100)}%`;
  $("voice-bar").setAttribute("aria-valuenow", String(Math.round(fraction * 100)));
}

// ---- folder -------------------------------------------------------------------------------
function renderFolder(permission) {
  folderState = !window.showDirectoryPicker ? "download" : !folder ? "none" : permission;
  renderVoice();
}

/** Picks up the folder chosen last time, and the clips in it. */
async function restoreFolder() {
  folder ??= await kvGet(FOLDER_KEY) ?? null;
  if (!folder) return renderFolder();
  try {
    const permission = await folder.queryPermission(READ_WRITE);
    renderFolder(permission);
    if (permission === "granted") await recount();
  } catch {
    renderFolder("prompt");
  }
}

async function pickFolder() {
  if (folderState === "prompt") {
    if (await writableFolder()) await recount();
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
  for (const { label } of SPELLING) wordClips.set(label, await countWavs(label));
  backgroundFiles = await countWavs(BACKGROUND_FOLDER);
  if (!last) word = nextWord(SPELLING, wordClips, SPELLING.at(-1));
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
/** One board's clip, over its USB cable if it has one attached; null for a tap. One with no word heard isn't saved yet. */
async function captureOne(board, date, target, spoken, { onCapturing, onProgress }) {
  const samples = await board.captureClip({ usb: usbFor(board)?.chip, onCapturing, onProgress: (fraction) => onProgress(board, fraction) });
  // Timed here: the clip's own length overstates a tap, whose release waits on the press's reply.
  if (heldMs < MIN_HOLD_MS) return null;
  const held = heldSection(samples.length);
  const unheard = !heardWord(samples, held);
  const rateHz = board.info?.micRateHz ?? 16000;
  // The same date on every board: dataset.py keeps one saying's clips in one split by it.
  const name = clipFileName(board.boardId, date, $("voice-speaker").value);
  const saved = !unheard && await save(target, spoken.label, name, encodeWav(clipAround(samples, held), rateHz));
  return { label: spoken.label, say: spoken.say, name, boardId: board.boardId, samples, rateHz, saved, unheard, held, kept: held };
}

function pressRecord() {
  if (recordDown) return;
  recordDown = true;
  pressedAt = performance.now();
  heldMs = Infinity;
  capture();
}

function releaseRecord() {
  if (!recordDown) return;
  recordDown = false;
  heldMs = performance.now() - pressedAt;
  for (const board of holdingBoards) board.releaseClip();
  renderVoice();
}

async function capture() {
  const boards = captureBoards();
  if (busy || $("voice-capture").disabled || !boards.length) return;
  stopPlaying(); // the mic would hear it
  // Over USB the live streams carry on, so only a clip over Bluetooth would leave a gap in a recording.
  const refuseDuringRecording = () => {
    if (!isRecording() || boards.every(usbFor)) return false;
    setStatus("Stop the live recording first, or use USB cables: a clip over Bluetooth pauses a board's live streams.", { bad: true });
    return true;
  };
  if (refuseDuringRecording()) return;
  const target = await writableFolder(); // Chrome may ask first, and the key will be up by then
  busy = true;
  renderVoice();
  setBar(0);
  let speakTimer = null;
  await usbPending;
  if (refuseDuringRecording() || !recordDown) {
    busy = false;
    renderVoice();
    return;
  }
  const date = new Date();
  const spoken = word;
  const sent = new Map(boards.map((board) => [board, 0]));
  // `lateBy`: the board began a moment before its answer got here.
  const onCapturing = (lateBy) => {
    if (speakTimer) return;
    const started = performance.now() - lateBy;
    setStatus("Speak now.");
    speakTimer = setInterval(() => {
      const fraction = (performance.now() - started) / MAX_HOLD_MS;
      setBar(Math.min(1, fraction));
      renderLevel(boards[0]);
      if (recordDown && fraction < 1) return;
      clearInterval(speakTimer);
      setStatus(recordDown ? "That's the longest a take can be. Fetching clips…" : "Fetching clips…");
    }, 50);
  };
  const onProgress = (board, fraction) => {
    clearInterval(speakTimer);
    sent.set(board, fraction);
    const all = [...sent.values()].reduce((sum, each) => sum + each, 0) / sent.size;
    setBar(all);
    setStatus(`Fetching clips… ${Math.round(all * 100)}%`);
  };
  holdingBoards = boards;
  capturing = Promise.allSettled(boards.map((board) => captureOne(board, date, target, spoken, { onCapturing, onProgress })));
  const results = await capturing;
  holdingBoards = [];
  clearInterval(speakTimer);

  const taken = results.flatMap((result) => (result.value ? [result.value] : []));
  const clips = taken.filter((clip) => !clip.unheard);
  const unheard = taken.filter((clip) => clip.unheard);
  const tapped = results.some((result) => result.status === "fulfilled" && !result.value);
  const failed = results.flatMap((result, i) => (result.status === "rejected" ? [`${boards[i].displayName}: ${result.reason.message}`] : []));
  // A take nobody heard stays on show, with Save anyway, in case it's the check that was wrong.
  const shown = clips.length ? clips : unheard;
  if (shown.length) {
    last = { clips: shown, shown: shown.find((clip) => clip.boardId === getBoard()?.boardId) ?? shown[0] };
    view = wholeClip(last.shown.samples.length);
    section = last.shown.kept;
  }
  if (clips.length) counted(spoken, clips.length);
  const loud = clips.filter((clip) => clipLevels(keptSamples(clip)).clipped > 0);
  const saved = clips.every((clip) => clip.saved);
  setStatus([
    clips.length ? `${saved ? "Saved" : "Downloaded"} “${spoken.say}”${clips.length > 1 ? ` from ${clips.length} boards` : ""}.` : "",
    loud.length ? `${loud.length === clips.length ? "It" : loud.map((clip) => clip.boardId).join(", ")} clipped: speak softer or further away, and press ⌫ to redo it.` : "",
    !clips.length && tapped ? "That was a tap: hold Space for as long as you speak." : "",
    unheard.length ? (clips.length ? `${unheard.map((clip) => clip.boardId).join(", ")} didn't hear it.` : "Nothing heard, so it wasn't saved: say it again, a little closer.") : "",
    failed.length ? `No clip from ${failed.join("; ")}.` : "",
  ].filter(Boolean).join(" "), { bad: failed.length > 0 || unheard.length > 0 && !clips.length });
  setBar(0);
  for (const board of boards) {
    const probe = usbFor(board);
    if (probe && results[boards.indexOf(board)].status === "rejected") await queueUsb(() => dropUsbIfGone(probe));
  }
  busy = false;
  renderVoice();
  drawClip();
}

/** Counts `count` new clips of `spoken` (downloaded ones too, for this page load) and moves on. */
function counted(spoken, count) {
  wordClips.set(spoken.label, (wordClips.get(spoken.label) ?? 0) + count);
  if (word === spoken) word = nextWord(SPELLING, wordClips, spoken); // unless one was chosen meanwhile
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
  $("voice-usb").hidden = !navigator.usb || (boards.length > 0 && cabled.length === boards.length);
  $("voice-usb").disabled = busy || !boards.length;
  $("voice-usb-off").hidden = usb.size === 0;
  $("voice-usb-off").disabled = busy;
  const note = usbNote ?? (!boards.length ? { text: "no board" }
    : !navigator.usb || !cabled.length ? { text: "Bluetooth, ~3 s a take" }
    : { text: `USB${cabled.length < boards.length ? ` on ${cabled.map((board) => board.boardId).join(", ")}` : ""}, under 1 s a take` });
  $("voice-usb-status").textContent = note.text;
  $("voice-usb-status").title = note.text;
  $("voice-step-link").classList.toggle("bad", Boolean(note.bad));
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

const keptSamples = ({ samples, kept }) => samples.subarray(kept.start, kept.end);

/** Removes every board's clip of the last saying. */
async function discard() {
  if (!last || busy || !last.clips.some((clip) => clip.saved)) return;
  stopPlaying();
  try {
    const { label } = last.clips[0];
    const directory = await folder.getDirectoryHandle(label);
    const saved = last.clips.filter((clip) => clip.saved);
    for (const clip of saved) await directory.removeEntry(clip.name);
    wordClips.set(label, Math.max(0, (wordClips.get(label) ?? 0) - saved.length));
    word = SPELLING.find((phrase) => phrase.label === label) ?? word; // so it's said again
    setStatus(`Discarded. Say “${word.say}” again.`);
    last = null;
    section = null;
  } catch (error) {
    setStatus(`Couldn't discard them: ${error.message}`, { bad: true });
  }
  renderVoice();
  drawClip();
}

const seconds = (samples) => (samples / last.shown.rateHz).toFixed(2);

/** Writes every board's clip of the last saying again, keeping the section `sectionOf(clip)` gives. */
async function rewriteClips(sectionOf) {
  const target = await writableFolder();
  for (const clip of last.clips) {
    if (clip.saved && !target) throw new Error("this page can't write to the clips folder");
    const kept = sectionOf(clip);
    const written = await save(clip.saved || clip.unheard ? target : null, clip.label, clip.name, encodeWav(clipAround(clip.samples, kept), clip.rateHz));
    clip.kept = kept;
    clip.saved ||= written;
  }
}

/** Runs an edit of the last saying, with the buttons held off, and redraws. */
async function editClips(work, failed) {
  if (!last || busy) return;
  stopPlaying();
  busy = true;
  renderVoice();
  try {
    await work();
    section = last.shown.kept;
  } catch (error) {
    setStatus(`${failed}: ${error.message}`, { bad: true });
  }
  busy = false;
  renderVoice();
  drawClip();
}

/** Keeps the highlighted section of every board's take of the last saying; their lengths differ by a few ms. */
function keepSection() {
  const { start, end } = section ?? {};
  if (!section) return;
  return editClips(async () => {
    const unheard = last.clips.filter((clip) => clip.unheard);
    await rewriteClips((clip) => ({ start, end: Math.min(end, clip.samples.length) }));
    if (unheard.length) {
      unheard.forEach((clip) => (clip.unheard = false));
      const [{ label, say }] = unheard;
      counted({ label, say }, unheard.length);
      setStatus(`Saved “${say}”.`);
    } else {
      setStatus(`Kept ${seconds(start)}–${seconds(end)} s of ${last.clips.length} clip${last.clips.length === 1 ? "" : "s"}; room noise fills the rest of the file.`);
    }
  }, "Couldn't keep it");
}

/** Goes back to what was held, while they're still the last saying. */
function restoreClips() {
  return editClips(async () => {
    await rewriteClips((clip) => clip.held);
    setStatus("Back to what you held.");
  }, "Couldn't put them back");
}

function play() {
  if (playback) {
    stopPlaying();
    return;
  }
  if (!last) return;
  const { samples, rateHz } = last.shown;
  const { start, end } = section ?? wholeClip(samples.length);
  const audio = new AudioContext();
  const buffer = audio.createBuffer(1, samples.length, rateHz);
  const channel = buffer.getChannelData(0);
  samples.forEach((sample, i) => (channel[i] = sample / 32768));
  const source = Object.assign(audio.createBufferSource(), { buffer });
  source.connect(audio.destination);
  // A moment ahead, so the line and the sound start from the same known time.
  const at = audio.currentTime + PLAY_LEAD_S;
  source.start(at, start / rateHz, (end - start) / rateHz);
  playback = { audio, at, start, end, rateHz, frame: 0 };
  $("voice-play").firstChild.textContent = "Stop ";
  followPlayhead();
}

/** The sample reaching the speakers now, which runs behind the sample being played. */
function playheadSample() {
  const { audio, at, start, end, rateHz } = playback;
  const heard = audio.currentTime - at - (audio.outputLatency || 0);
  return Math.min(end, start + Math.max(0, heard) * rateHz);
}

function followPlayhead() {
  const sample = playheadSample();
  if (sample >= playback.end) {
    stopPlaying();
    return;
  }
  view = following(view, sample, last.shown.samples.length);
  drawClip();
  playback.frame = requestAnimationFrame(followPlayhead);
}

function stopPlaying() {
  if (!playback) return;
  cancelAnimationFrame(playback.frame);
  playback.audio.close();
  playback = null;
  $("voice-play").firstChild.textContent = "Play ";
  drawClip();
}

/** Drag across the plot to highlight a section, or an edge to move it; wheel to zoom, sideways to pan. */
function initPlotEditing() {
  const canvas = $("voice-wave");
  const place = (event) => {
    const { left, width } = canvas.getBoundingClientRect();
    return { x: event.clientX - left, width };
  };
  const dragTo = (x, width) => {
    section = sectionBetween(dragAnchor, sampleAt(x, width, view));
    dragX = x;
    drawClip();
  };
  canvas.addEventListener("pointerdown", (event) => {
    if (!last || event.button !== 0) return;
    const { x, width } = place(event);
    const edge = section && grabbedEdge(x, width, view, section);
    dragAnchor = edge ? (edge === "start" ? section.end : section.start) : sampleAt(x, width, view);
    canvas.setPointerCapture(event.pointerId);
    dragTo(x, width);
  });
  canvas.addEventListener("pointermove", (event) => {
    const { x, width } = place(event);
    if (dragAnchor !== null) dragTo(x, width);
    else canvas.style.cursor = section && grabbedEdge(x, width, view, section) ? "ew-resize" : "";
  });
  const release = () => {
    if (dragAnchor === null) return;
    dragAnchor = null;
    if (section.end - section.start < MIN_SECTION_SAMPLES) section = last.shown.kept; // a click puts back what's saved
    renderVoice();
    drawClip();
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  // Works mid-drag too, so an edge can be set closer than a whole-clip view allows.
  canvas.addEventListener("wheel", (event) => {
    if (!last) return;
    event.preventDefault();
    const length = last.shown.samples.length;
    const { x, width } = place(event);
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) view = panned(view, (event.deltaX / width) * (view.end - view.start), length);
    else view = zoomed(view, sampleAt(x, width, view), Math.exp(event.deltaY * WHEEL_ZOOM), length);
    if (dragAnchor !== null) dragTo(dragX, width);
    else drawClip();
  }, { passive: false });
}

// The plot never zooms in past this peak (-50 dBFS), so a silent clip still looks silent.
const WAVE_MIN_PEAK = 100;
const PLAY_LEAD_S = 0.05;
const WHEEL_ZOOM = 0.003; // per wheel pixel, as a power of e
const DIM_OUTSIDE_SECTION = 0.65;
const SECTION_TINT = 0.14;

/** The last clip's waveform: each pixel column's lowest and highest sample, the clip's peak at the edges. */
function drawClip() {
  const { ctx, width, height } = fitCanvas($("voice-wave"));
  const colors = getColors();
  const mid = height / 2;
  hairline(ctx, 0, mid, width, mid, colors.grid);
  $("voice-levels").textContent = "";
  if (!last) return;

  const { samples, boardId } = last.shown;
  const kept = keptSamples(last.shown);
  const levels = clipLevels(kept);
  // The mic is quiet (peaks of -40 dBFS are ordinary), so the plot fills its height with the
  // word's own peak instead of full scale, whatever the key sounded like; a floor keeps silence
  // from being blown up to noise.
  const peak = kept.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
  const fullHeight = Math.max(peak, WAVE_MIN_PEAK);
  const zoom = 32768 / fullHeight;
  const zoomedIn = view.end - view.start < samples.length;
  $("voice-levels").textContent = [
    `${boardId} · peak ${levels.peakDbfs.toFixed(0)} dBFS · rms ${levels.rmsDbfs.toFixed(0)} dBFS · plot ×${zoom.toFixed(zoom < 10 ? 1 : 0)}`,
    zoomedIn ? `showing ${seconds(view.start)}–${seconds(view.end)} s` : "",
    section ? `keep ${seconds(section.start)}–${seconds(section.end)} s` : "",
  ].filter(Boolean).join(" · ");
  const perColumn = (view.end - view.start) / width;
  ctx.strokeStyle = levels.clipped ? colors.bad : colors.readout;
  ctx.beginPath();
  for (let x = 0; x < width; x++) {
    let low = 0;
    let high = 0;
    const end = Math.min(samples.length, Math.ceil(view.start + (x + 1) * perColumn));
    for (let i = Math.floor(view.start + x * perColumn); i < end; i++) {
      low = Math.min(low, samples[i]);
      high = Math.max(high, samples[i]);
    }
    ctx.moveTo(x + 0.5, mid - (high / fullHeight) * mid);
    ctx.lineTo(x + 0.5, mid - (low / fullHeight) * mid + 1);
  }
  ctx.stroke();
  if (section) drawSection(ctx, width, height, colors);
  if (playback) {
    const x = xOf(playheadSample(), width, view);
    hairline(ctx, x, 0, x, height, colors.text);
  }
}

/** Tints the section and dims the rest, which is what keeping it would drop. */
function drawSection(ctx, width, height, colors) {
  const from = xOf(section.start, width, view);
  const to = xOf(section.end, width, view);
  ctx.globalAlpha = DIM_OUTSIDE_SECTION;
  ctx.fillStyle = colors.screen;
  ctx.fillRect(0, 0, from, height);
  ctx.fillRect(to, 0, width - to, height);
  ctx.globalAlpha = SECTION_TINT;
  ctx.fillStyle = colors.signal;
  ctx.fillRect(from, 0, to - from, height);
  ctx.globalAlpha = 1;
  hairline(ctx, from, 0, from, height, colors.signal);
  hairline(ctx, to, 0, to, height, colors.signal);
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
  $("voice-bg-record").textContent = recordings.length ? "Stop and save" : "Record background audio";
  $("voice-bg-record").classList.toggle("recording", recordings.length > 0);
  renderVoice();
  if (!recordings.length) {
    clearInterval(backgroundTimer);
    return;
  }
  const seconds = Math.max(...recordings.map(({ track, rateHz }) => track.samples / rateHz));
  const lost = recordings.reduce((sum, { track, rateHz }) => sum + track.lostSamples / rateHz, 0);
  const who = recordings.length === 1 ? recordings[0].board.displayName : `${recordings.length} boards`;
  setBackgroundStatus(`Recording from ${who}: ${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}${lost ? `, ${lost.toFixed(1)} s lost` : ""}. Talk, play music, work as usual: just don't say the spelling words.`);
}

function setBackgroundStatus(text, bad = false) {
  $("voice-bg-status").textContent = text;
  $("voice-bg-status").className = `voice-status${bad ? " bad-text" : ""}`;
}
