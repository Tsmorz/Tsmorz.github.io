// The Teach a phrase dialog: the selected board learns a phrase from a few takes, recorded and kept
// on the board, so no audio reaches this page. Board.enroll* does the talking; teach.js the choosing.
import { ACTION_TEXT } from "./clips.js";
import { MOST_TAKES, firstFreeSlot, slotOfPhrase, takeAdvice } from "./teach.js";
import { ENROLL_PHRASE_MAX_BYTES } from "./wire.js";

const $ = (id) => document.getElementById(id);
const DEFAULT_ACTION = "mouse_toggle";

let getBoard = () => null;
let working = false; // a step is on its way to the board
let note = null; // { text, bad }

export const teachDialogOpen = () => $("teach-dialog").open;

const teaching = (board) => board?.enrollment && board.enrollment.state !== "idle";
const phraseFits = (phrase) => phrase.length > 0 && new TextEncoder().encode(phrase).length <= ENROLL_PHRASE_MAX_BYTES;

async function step(work) {
  if (working) return;
  working = true;
  renderTeach();
  try {
    await work();
  } catch (error) {
    note = { text: error.message, bad: true };
  }
  working = false;
  renderTeach();
}

function takeOne() {
  const board = getBoard();
  step(async () => {
    if (!teaching(board)) {
      await board.enrollBegin(firstFreeSlot(board.enrollment.usedSlots), $("teach-action").value, $("teach-phrase").value.trim());
    }
    note = { text: "Say it now, while the LED is magenta.", bad: false };
    renderTeach();
    note = takeAdvice(await board.enrollTake());
  });
}

function save() {
  const board = getBoard();
  step(async () => {
    const phrase = $("teach-phrase").value.trim();
    await board.enrollFinish();
    note = { text: `${board.displayName} now listens for “${phrase}”.`, bad: false };
    $("teach-phrase").value = "";
  });
}

function startOver() {
  const board = getBoard();
  step(async () => {
    await board.enrollCancel();
    note = null;
  });
}

function forget(slot, phrase) {
  const board = getBoard();
  if (!confirm(`Forget “${phrase}” on ${board.displayName}?`)) return;
  step(async () => {
    await board.enrollForget(slot);
    note = null;
  });
}

function blocker(board) {
  if (!board?.connected) return "Connect a board first.";
  if (!board.enrollment) return "This board's firmware can't learn phrases: update it.";
  if (!board.enrollment.learns) return "This board's voice model can't learn phrases: upload one that does.";
  if (!teaching(board) && firstFreeSlot(board.enrollment.usedSlots) < 0) return "This board knows four phrases: forget one first.";
  return "";
}

/** Redraws the dialog from the selected board's status. */
export function renderTeach() {
  const board = getBoard();
  const status = board?.enrollment;
  const blocked = blocker(board);
  const inProgress = teaching(board);
  $("teach-board").textContent = board?.displayName ?? "";
  $("teach-phrase").disabled = $("teach-action").disabled = Boolean(blocked) || inProgress || working;
  $("teach-take").disabled = Boolean(blocked) || working || !phraseFits($("teach-phrase").value.trim()) || (status?.takes ?? 0) >= MOST_TAKES;
  $("teach-take").textContent = inProgress ? "Say it again" : "Say it";
  $("teach-finish").disabled = working || status?.state !== "ready" || !status.takes;
  $("teach-cancel").disabled = working || status?.state !== "ready";
  $("teach-status").textContent = blocked || note?.text || "";
  $("teach-status").className = blocked || note?.bad ? "bad-text" : "muted";
  $("teach-phrases").replaceChildren(...(board?.vocabulary?.commands ?? []).map(({ action, phrase }, index) => {
    const forgetButton = Object.assign(document.createElement("button"), { textContent: "Forget", disabled: working || inProgress });
    forgetButton.addEventListener("click", () => forget(slotOfPhrase(status?.usedSlots ?? 0, index), phrase));
    const item = document.createElement("li");
    item.append(Object.assign(document.createElement("span"), { textContent: `“${phrase}”: ${ACTION_TEXT[action] ?? action}` }), forgetButton);
    return item;
  }));
}

/** Wires the dialog up. `getBoard()` is the selected board. */
export function initTeach(options) {
  ({ getBoard } = options);
  $("teach-action").replaceChildren(...Object.entries(ACTION_TEXT).map(([value, textContent]) => Object.assign(document.createElement("option"), { value, textContent })));
  $("teach-action").value = DEFAULT_ACTION;
  $("teach-open").addEventListener("click", () => {
    note = null;
    if (!$("teach-dialog").open) $("teach-dialog").showModal();
    renderTeach();
  });
  $("teach-close").addEventListener("click", () => $("teach-dialog").close());
  // Takes kept and never saved would hold the board's spotter quiet until it gives up on them.
  $("teach-dialog").addEventListener("close", () => {
    const board = getBoard();
    if (board?.connected && board.enrollment?.state === "ready") board.enrollCancel().catch(() => {});
  });
  $("teach-phrase").addEventListener("input", renderTeach);
  $("teach-take").addEventListener("click", takeOne);
  $("teach-finish").addEventListener("click", save);
  $("teach-cancel").addEventListener("click", startOver);
}
