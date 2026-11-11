// Talk, under Microphone: press it, speak to the selected board, press Stop (or wait 30 s), and
// what the board heard is written below. The board streams its mic to the page (its live streams
// pause meanwhile, as for any audio stream), and Whisper turns the take into text on this computer
// (speech-worker.js). speech.js has the pure parts.
import { decodeAdpcm } from "./adpcm.js";
import { AudioTrack, MAX_TAKE_S, MIN_TAKE_S, takeClock, tidySpeech, whisperInput } from "./speech.js";

const $ = (id) => document.getElementById(id);

let getBoard = () => null;
let isRecording = () => false;
let take = null; // { board, track, pieces, rateHz, timer } while the board streams
let starting = false;
let working = 0; // takes being turned into text
const lines = []; // { text, board, at }, newest first

// ---- the speech model ---------------------------------------------------------------------
const model = { worker: null, ready: false, failed: "", progress: 0, sawTotal: false, job: 0, pending: new Map() };

function speechWorker() {
  if (model.worker) return;
  model.worker = new Worker(new URL("./speech-worker.js", import.meta.url), { type: "module" });
  const fail = (message) => {
    model.failed = message;
    for (const settle of model.pending.values()) settle({ error: message });
    model.pending.clear();
  };
  model.worker.onmessage = ({ data }) => {
    if (data.type === "progress") {
      // Overall progress has no file; once it comes, the per-file figures would only make it jump.
      if (data.file === undefined) model.sawTotal = true;
      else if (model.sawTotal) return;
      model.progress = data.value;
      if (working) render();
    } else if (data.type === "ready") model.ready = true;
    else if (data.type === "error") fail(`the speech model couldn't load (${data.message})`);
    else if (data.type === "result") {
      const settle = model.pending.get(data.id);
      model.pending.delete(data.id);
      settle?.(data);
    }
  };
  model.worker.onerror = (event) => fail(event.message || "the speech model stopped");
  model.worker.postMessage({ type: "load" });
}

function transcribe(audio) {
  if (model.failed) return Promise.reject(new Error(model.failed));
  const id = ++model.job;
  return new Promise((resolve, reject) => {
    model.pending.set(id, (data) => (data.error ? reject(new Error(data.error)) : resolve(data.text)));
    model.worker.postMessage({ type: "transcribe", id, audio }, [audio.buffer]);
  });
}

// ---- a take -------------------------------------------------------------------------------
async function startTake() {
  const board = getBoard();
  if (!board?.connected) return say("Connect a board first.", true);
  if (!board.canStreamAudio) return say(`${board.displayName}'s firmware can't stream its microphone: update it.`, true);
  if (isRecording()) return say("Stop the recording first: while the board sends audio, its live data pause.", true);
  if (model.failed) Object.assign(model, { worker: (model.worker?.terminate(), null), failed: "", ready: false }); // try again
  speechWorker(); // loads while you speak
  const fresh = { board, track: new AudioTrack(), pieces: [], rateHz: board.info?.micRateHz ?? 16000, timer: null };
  starting = true;
  take = fresh; // before the stream starts: its first chunks can come before the write's reply
  render();
  try {
    await board.startAudioStream((chunk) => {
      if (take !== fresh) return;
      if (!chunk) return void stopTake(); // the board disconnected: keep what came
      const samples = fresh.track.add(chunk);
      if (samples.length) fresh.pieces.push(samples);
      if (fresh.track.samples >= MAX_TAKE_S * fresh.rateHz) stopTake();
    }, (adpcm, state) => decodeAdpcm(adpcm, state));
    fresh.timer = setInterval(render, 250);
    say(`Speak to ${board.displayName}, then press Stop.`);
  } catch (error) {
    if (take === fresh) take = null;
    say(`${board.displayName} wouldn't send its microphone: ${error.message}.`, true);
  } finally {
    starting = false;
    render();
  }
}

async function stopTake() {
  const done = take;
  if (!done) return;
  take = null;
  clearInterval(done.timer);
  await done.board.stopAudioStream().catch(() => {});
  const seconds = done.track.samples / done.rateHz;
  if (seconds < MIN_TAKE_S) {
    render();
    return say("That was too short to hear anything. Press Talk and speak, then Stop.", true);
  }
  working++;
  render();
  try {
    const text = tidySpeech(await transcribe(whisperInput(done.pieces, done.rateHz)));
    if (!text) say(`Heard nothing to write down in ${seconds.toFixed(1)} s.`);
    else {
      lines.unshift({ text, board: done.board.displayName, at: new Date() });
      const lost = done.track.lostSamples / done.rateHz;
      say(lost > 0.2 ? `${lost.toFixed(1)} s of the take was lost on the way, so some words may be missing.` : "");
    }
  } catch (error) {
    say(`Couldn't turn it into text: ${error.message}.`, true);
  } finally {
    working--;
    render();
  }
}

// ---- the panel ----------------------------------------------------------------------------
let note = { text: "", bad: false };
function say(text, bad = false) {
  note = { text, bad };
  render();
}

function status() {
  if (starting) return { text: "Asking the board for its microphone…", bad: false };
  if (take) return { text: `Listening through ${take.board.displayName}: ${takeClock(take.track.samples / take.rateHz)} of ${takeClock(MAX_TAKE_S)}.`, bad: false };
  if (working && !model.ready) {
    return { text: model.progress ? `Downloading the speech model, ${Math.round(model.progress)}% (only the first time)…` : "Loading the speech model (only slow the first time)…", bad: false };
  }
  if (working) return { text: "Turning it into text…", bad: false };
  if (note.text) return note;
  const board = getBoard();
  if (board?.connected && !board.canStreamAudio) return { text: `${board.displayName}'s firmware can't stream its microphone: update it.`, bad: true };
  return { text: "Press Talk, speak to the board, then Stop.", bad: false };
}

const timeOf = (date) => date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

/** Called whenever the boards change, and while a take runs. */
export function renderSpeech() {
  const board = getBoard();
  const talk = $("talk");
  talk.textContent = take && !starting ? `Stop ${takeClock(take.track.samples / take.rateHz)}` : "Talk";
  talk.classList.toggle("recording", Boolean(take) && !starting);
  talk.setAttribute("aria-pressed", String(Boolean(take)));
  talk.disabled = starting || (!take && !(board?.connected && board.canStreamAudio));
  const { text, bad } = status();
  $("talk-status").textContent = text;
  $("talk-status").className = `status-line ${bad ? "bad-text" : "muted"}`;
  const list = $("transcript");
  if (list.childElementCount !== lines.length) {
    list.replaceChildren(...lines.map((line) => {
      const item = document.createElement("li");
      const when = Object.assign(document.createElement("span"), { className: "when", textContent: timeOf(line.at) });
      when.title = line.board;
      item.append(when, Object.assign(document.createElement("span"), { textContent: line.text }));
      return item;
    }));
  }
  $("transcript-copy").hidden = $("transcript-clear").hidden = lines.length === 0;
}
const render = renderSpeech;

export function initSpeech(options) {
  ({ getBoard, isRecording } = options);
  $("talk").addEventListener("click", () => (take ? stopTake() : startTake()));
  $("transcript-copy").addEventListener("click", async () => {
    const text = [...lines].reverse().map((line) => `${timeOf(line.at)} ${line.text}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      say("Copied, oldest first.");
    } catch {
      say("This browser wouldn't copy: select the text instead.", true);
    }
  });
  $("transcript-clear").addEventListener("click", () => {
    lines.length = 0;
    say("");
  });
  render();
}
