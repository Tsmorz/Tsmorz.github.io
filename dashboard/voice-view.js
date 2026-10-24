// The keyword clips dialog: records training clips of the voice commands through the selected
// board's own microphone (Board.captureClip) and saves each as a WAV in a folder the user picks,
// one subfolder per label, for the training pipeline (docs/voice-commands.md). The clips are the
// user's voice: they only ever go into that folder, never into tools/dashboard/ (published).
import { fitCanvas, hairline } from "./canvas.js";
import { decodeAdpcm } from "./adpcm.js";
import { AudioTrack, KEYWORD_LABELS, WAV_HEADER_BYTES, clipFileName, clipLevels, encodeWav, pcmBytes, wavHeader } from "./clips.js";
import { kvGet, kvSet } from "./storage.js";
import { VOICE_COMMANDS } from "./wire.js";

const $ = (id) => document.getElementById(id);
const FOLDER_KEY = "keyword-folder";
const SPEAKER_KEY = "voice-speaker";
const BACKGROUND_FOLDER = "background"; // not a label, so training skips it as a class
const READ_WRITE = { mode: "readwrite" };
const CAPTURE_MS = 2000; // CLIP_CAPTURE_SAMPLES in src/keyword/clip_capture.h, at 16 kHz
// Below this a phrase is hard to hear over the room (a laptop click 1 m away peaked near -40).
const QUIET_PEAK_DBFS = -35;

let getBoard = () => null;
let isRecording = () => false;
let getColors = () => ({});
let folder = null; // the chosen folder's handle; null downloads each clip instead
let counts = new Map(); // label -> clips in its subfolder
let last = null; // the last clip: { label, name, samples, rateHz, saved }
let busy = false;
let background = null; // the background recording running: { board, writable, track, started, rateHz }

const labelInfo = (label) => KEYWORD_LABELS.find((entry) => entry.label === label);

/**
 * Wires the dialog up. `getBoard()` is the selected board, `isRecording()` whether a live
 * recording runs (a clip pauses the board's live streams, which would leave a gap in it).
 */
export function initVoice(options) {
  ({ getBoard, isRecording, getColors } = options);
  for (const { label } of KEYWORD_LABELS) $("voice-label").append(new Option(label, label));
  $("voice-label").addEventListener("change", renderVoice);
  $("voice-open").addEventListener("click", () => {
    if (!$("voice-dialog").open) $("voice-dialog").showModal();
    renderVoice();
    drawClip();
  });
  $("voice-close").addEventListener("click", () => $("voice-dialog").close());
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
  $("voice-obeyed").replaceChildren(...VOICE_COMMANDS.map((name) => {
    const box = Object.assign(document.createElement("input"), { type: "checkbox", value: name, disabled: true });
    box.addEventListener("change", () => {
      const board = getBoard();
      if (!board?.voice) return;
      const obeyed = [...$("voice-obeyed").querySelectorAll("input:checked")].map((input) => input.value);
      sendVoiceSettings(board, { ...board.voice, obeyed });
    });
    const label = document.createElement("label");
    label.append(box, labelInfo(name).say);
    return label;
  }));
  restoreFolder();
}

async function sendVoiceSettings(board, settings) {
  try {
    await board.setVoiceSettings(settings);
  } catch (error) {
    $("voice-settings-status").textContent = `Couldn't change ${board.displayName}'s voice settings: ${error.message}`;
  }
  renderVoiceSettings();
}

const ago = (hostMs) => {
  const seconds = Math.round((performance.timeOrigin + performance.now() - hostMs) / 1000);
  return seconds < 60 ? `${seconds} s ago` : `${Math.round(seconds / 60)} min ago`;
};

/** Settings › Voice, for the selected board: listening, the commands it obeys, what it heard lately. */
export function renderVoiceSettings() {
  const board = getBoard();
  const voice = board?.connected ? board.voice : null;
  $("voice-listen").disabled = !voice;
  $("voice-listen").setAttribute("aria-checked", String(Boolean(voice?.listening)));
  for (const box of $("voice-obeyed").querySelectorAll("input")) {
    box.disabled = !voice;
    box.checked = Boolean(voice?.obeyed.includes(box.value));
  }
  $("voice-settings-status").textContent = !board?.connected ? "Connect a board to set up its voice commands."
    : !voice ? "This board's firmware has no voice commands: update it."
    : !voice.hasModel ? "No voice model in this board's firmware yet: these settings apply once one is built in."
    : voice.listening ? `Listening. It obeys the ticked commands; every board in earshot hears them.`
    : "Not listening: it ignores every command.";
  $("voice-heard").replaceChildren(...(board?.voiceHeard ?? []).map(({ label, outcome, hostMs }) => {
    const item = document.createElement("li");
    item.append(Object.assign(document.createElement("span"), { textContent: labelInfo(label)?.say ?? label }),
      Object.assign(document.createElement("span"), { textContent: `${outcome} · ${ago(hostMs)}` }));
    return item;
  }));
}

export const voiceDialogOpen = () => $("voice-dialog").open;

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
  if (!busy) {
    const reason = !board?.connected ? "Connect a board first."
      : !board.canCaptureClips ? "This board's firmware can't capture clips: update it." : "";
    if (reason || $("voice-status").dataset.reason) setStatus(reason, { reason: Boolean(reason) });
  }
  $("voice-counts").replaceChildren(...KEYWORD_LABELS.map(({ label }) => {
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

async function recount() {
  counts = new Map();
  for (const { label } of KEYWORD_LABELS) {
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
  if (isRecording()) {
    setStatus("Stop the live recording first: a clip pauses the board's live streams.", { bad: true });
    return;
  }
  const label = $("voice-label").value;
  const target = await writableFolder();
  busy = true;
  renderVoice();
  setBar(0);
  let speakTimer = null;
  try {
    const samples = await board.captureClip({
      onCapturing: () => {
        const started = performance.now();
        setStatus("Speak now (LED magenta)");
        speakTimer = setInterval(() => setBar(Math.min(1, (performance.now() - started) / CAPTURE_MS)), 50);
      },
      onProgress: (fraction) => {
        clearInterval(speakTimer);
        setBar(fraction);
        setStatus(`Sending… ${Math.round(fraction * 100)}%`);
      },
    });
    const rateHz = board.info?.micRateHz ?? 16000;
    const name = clipFileName(board.boardId, new Date(), $("voice-speaker").value);
    const saved = await save(target, label, name, encodeWav(samples, rateHz));
    last = { label, name, samples, rateHz, saved };
    if (saved) counts.set(label, (counts.get(label) ?? 0) + 1);
    setStatus(`${saved ? "Saved" : "Downloaded"} ${label}/${name}. ${verdict(label, clipLevels(samples))}`);
    setBar(1);
  } catch (error) {
    setStatus(`No clip: ${error.message}`, { bad: true });
    setBar(0);
  } finally {
    clearInterval(speakTimer);
    busy = false;
    renderVoice();
    drawClip();
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

/** The last clip's waveform: each pixel column's lowest and highest sample, full scale at the edges. */
function drawClip() {
  const { ctx, width, height } = fitCanvas($("voice-wave"));
  const colors = getColors();
  const mid = height / 2;
  hairline(ctx, 0, mid, width, mid, colors.grid);
  $("voice-levels").textContent = "";
  if (!last) return;

  const levels = clipLevels(last.samples);
  $("voice-levels").textContent = `peak ${levels.peakDbfs.toFixed(0)} dBFS · rms ${levels.rmsDbfs.toFixed(0)} dBFS`;
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
    ctx.moveTo(x + 0.5, mid - (high / 32768) * mid);
    ctx.lineTo(x + 0.5, mid - (low / 32768) * mid + 1);
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
