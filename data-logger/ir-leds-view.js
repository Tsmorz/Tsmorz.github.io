// Settings › Tracking LEDs: the selected board's IR LEDs on or off, and their level. Both are saved
// on the board; the switch shows the new state at once and goes back if the board refuses, and the
// level is sent when the slider is let go.
import { IR_LEDS, irLedsCellMa } from "./wire.js";

const $ = (id) => document.getElementById(id);

let getBoard = () => null;
let setStatus = () => {};

/** Redraws the section for the selected board (app.js calls it with the rest of the page). */
export function renderIrLeds() {
  const board = getBoard();
  const leds = board?.connected ? board.irLeds : null;
  const toggle = $("ir-toggle");
  toggle.disabled = !leds;
  $("ir-level").disabled = !leds;
  toggle.setAttribute("aria-checked", String(Boolean(leds?.on)));
  toggle.title = !leds
    ? board?.connected ? "This board's firmware has no tracking LEDs: update it" : "Connect a board to choose"
    : `Click to switch them ${leds.on ? "off" : "on"} for ${board.displayName} (saved on the board)`;
  if (!leds) {
    $("ir-status").textContent = board?.connected
      ? "This board's firmware has no tracking LEDs: update it."
      : "Connect a board to switch its tracking LEDs.";
    return;
  }
  if (document.activeElement !== $("ir-level")) {
    $("ir-level").value = leds.levelPercent;
    $("ir-level-value").textContent = `${leds.levelPercent}%`;
  }
  $("ir-status").textContent = leds.on
    ? `On at ${leds.levelPercent}%: about ${Math.round(irLedsCellMa(leds.levelPercent))} mA from the battery.`
    : "Off. Infrared, so you won't see them: a phone camera shows them faintly purple.";
}

async function send(board, settings) {
  const before = board.irLeds;
  board.irLeds = settings;
  renderIrLeds();
  try {
    await board.setIrLeds(settings);
  } catch (error) {
    board.irLeds = before;
    setStatus(`${board.displayName}: couldn't change the tracking LEDs (${error.message})`, { bad: true });
  }
  renderIrLeds();
}

export function initIrLeds(options) {
  ({ getBoard, setStatus } = options);
  Object.assign($("ir-level"), { min: IR_LEDS.levelMinPercent, max: IR_LEDS.levelMaxPercent, value: IR_LEDS.levelDefaultPercent });
  $("ir-toggle").addEventListener("click", () => {
    const board = getBoard();
    if (!board?.connected || !board.irLeds) return;
    send(board, { ...board.irLeds, on: !board.irLeds.on });
  });
  $("ir-level").addEventListener("input", () => ($("ir-level-value").textContent = `${$("ir-level").value}%`));
  $("ir-level").addEventListener("change", () => {
    const board = getBoard();
    if (!board?.connected || !board.irLeds) return;
    send(board, { ...board.irLeds, levelPercent: Number($("ir-level").value) });
    $("ir-level").blur();
  });
}
