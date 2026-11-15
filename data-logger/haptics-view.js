// The Haptics panel on the main page: plays a TacHammer cue (the Drake cues tuned on the recording
// board, or a test pattern) on the selected board or on every board at once, and stops them.
// haptics.js has the rules; the board's firmware renders and plays the cue (src/actuators/).
import { cueLevel, CUE_GROUPS, DEFAULT_CUE, DEFAULT_LEVEL, finishedState, outcomeText, playableBoards, unplayableReason } from "./haptics.js";
import { TACHAMMER_WAVEFORMS, tachammerMaxLevel } from "./actuators.js";
import { CONTROL_STATES } from "./control.js";
import { ACTUATOR_COMMANDS } from "./wire.js";

const $ = (id) => document.getElementById(id);

// How long after a cue should have ended to stop waiting for the board to say so.
const RESULT_GRACE_MS = 3000;
const LONGEST_CUE_MS = 2000; // deep rumble, the longest cue, is 1.2 s

let getBoard = () => null;
let shownReason = null; // why the selected board can't play, as last shown in the status line
let getBoards = () => [];
// The last request sent to each board: only its end lets that board's lease go (stopHeartbeats()).
const lastRequest = new WeakMap();

function say(text, bad = false) {
  $("hap-status").textContent = text;
  $("hap-status").title = text; // the line is cut short to fit the heading: hover for all of it
  $("hap-status").classList.toggle("bad-text", bad);
}

const selectedCue = () => TACHAMMER_WAVEFORMS.find((entry) => entry.id === Number($("hap-cue").value));

/** Holds the slider to the chosen cue's ceiling (70% for the Drake cues). */
function fitLevel() {
  const cue = selectedCue();
  const slider = $("hap-level");
  slider.max = tachammerMaxLevel(cue.id);
  slider.value = cueLevel(cue.id, slider.value);
  $("hap-level-out").textContent = `${slider.value}%`;
}

/**
 * Resolves with the cue's final control state on board, or null if none arrives in time. Listens
 * from before the command goes, since a short cue can finish before the write has settled.
 */
function watchResults(board) {
  const seen = new Map();
  const waiters = new Map();
  const listener = (event) => {
    const report = event.detail;
    if (!finishedState(report.state)) return;
    seen.set(report.requestId, report.state);
    waiters.get(report.requestId)?.(report.state);
  };
  board.addEventListener("control-result", listener);
  return {
    until(requestId, timeoutMs) {
      if (seen.has(requestId)) return Promise.resolve(seen.get(requestId));
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), timeoutMs);
        waiters.set(requestId, (state) => { clearTimeout(timer); resolve(state); });
      });
    },
    close: () => board.removeEventListener("control-result", listener),
  };
}

/** Plays cue at level on one board; returns { name, state } or { name, error }. */
async function playOn(board, cue, level) {
  const name = board.displayName;
  const results = board.control ? watchResults(board) : null;
  try {
    const report = await board.actuatorCommand({ command: ACTUATOR_COMMANDS.tachammerPlay, id: cue.id, level });
    if (!results || !report?.requestId) return { name, state: null };
    lastRequest.set(board, report.requestId);
    const state = finishedState(report.state) ? report.state : await results.until(report.requestId, LONGEST_CUE_MS + RESULT_GRACE_MS);
    // A finite cue needs no lease once it is over: let it lapse, unless another cue followed it.
    if (lastRequest.get(board) === report.requestId) board.control?.stopHeartbeats();
    return { name, state };
  } catch (error) {
    return { name, error: error.message.replace(/\.$/, "") };
  } finally {
    results?.close();
  }
}

async function play(targets) {
  const cue = selectedCue();
  const level = cueLevel(cue.id, $("hap-level").value);
  if (!targets.length) return say(unplayableReason(getBoard()) ?? "No board can play haptics.", true);
  say(`${cue.label} at ${level}%…`);
  const results = await Promise.all(targets.map((board) => playOn(board, cue, level)));
  const bad = results.some((result) => result.error || (result.state && result.state !== CONTROL_STATES.completed));
  say(outcomeText(cue, level, results), bad);
}

async function stopAll() {
  const targets = [...getBoards()].filter((board) => board.connected && board.hasActuators);
  const results = await Promise.allSettled(targets.map((board) => board.actuatorCommand({ command: ACTUATOR_COMMANDS.stopAll })));
  const failed = results.filter((result) => result.status === "rejected").length;
  say(failed ? `Stop failed on ${failed} of ${targets.length} boards.` : "Stopped.", failed > 0);
}

export function initHaptics(options) {
  ({ getBoard, getBoards } = options);
  $("hap-cue").replaceChildren(...CUE_GROUPS.map(({ label, cues }) => {
    const group = Object.assign(document.createElement("optgroup"), { label });
    group.append(...cues.map(({ id, label: name }) => Object.assign(document.createElement("option"), { value: id, textContent: name })));
    return group;
  }));
  $("hap-cue").value = DEFAULT_CUE;
  $("hap-level").value = DEFAULT_LEVEL;
  fitLevel();
  $("hap-cue").addEventListener("change", fitLevel);
  $("hap-level").addEventListener("input", fitLevel);
  $("hap-play").addEventListener("click", () => {
    const board = getBoard();
    play(unplayableReason(board) ? [] : [board]);
  });
  $("hap-play-all").addEventListener("click", () => play(playableBoards(getBoards())));
  $("hap-stop").addEventListener("click", stopAll);
}

/** Enables what the boards allow; cheap, as the page calls it every 250 ms. */
export function renderHaptics() {
  const board = getBoard();
  const reason = unplayableReason(board);
  const playable = playableBoards(getBoards()).length;
  $("hap-board").textContent = board ? board.displayName : "TacHammer";
  $("hap-play").disabled = Boolean(reason);
  $("hap-play-all").hidden = playable < 2;
  $("hap-play-all").textContent = `Play on all ${playable}`;
  $("hap-stop").disabled = ![...getBoards()].some((each) => each.connected && each.hasActuators);
  if (reason !== shownReason) {
    if (!$("hap-status").textContent || $("hap-status").textContent === shownReason) say(reason ?? "");
    shownReason = reason;
  }
}
