// The Actuators dialog (Settings › Actuators › Test…): plays the TacHammer's waveforms, the ERM's
// effects and the servo's motions on the selected board by hand, and shows what the board reports
// back: the servo's command against its feedback, the joystick and the wired keys. actuators.js
// has the library and the arithmetic; the board runs everything (src/actuators/).
import { fitCanvas, hairline } from "./canvas.js";
import {
  ERM_PRESETS, ERM_ROM_EFFECT_MAX, KEYS, RUMBLE_MS, SERVO_PATTERNS, SERVO_PULSE_US, ServoTrace, TACHAMMER_WAVEFORMS, feedbackFraction,
  heldKeys, pulseToDegrees, stickPoint,
} from "./actuators.js";
import { ACTUATOR_COMMANDS } from "./wire.js";

const $ = (id) => document.getElementById(id);

// The servo follows the slider as it moves, but no faster than this: each move is a write.
const SLIDER_SEND_MS = 50;

let getBoard = () => null;
let shown = null; // the board the dialog is showing
const trace = new ServoTrace();
let sliderTimer = null;

export const actuatorDialogOpen = () => $("act-dialog").open;

function say(text, bad = false) {
  $("act-status").textContent = text;
  $("act-status").classList.toggle("bad-text", bad);
}

async function send(command, done) {
  const board = shown;
  if (!board?.connected) return say("The board isn't connected.", true);
  try {
    await board.actuatorCommand(command);
    if (done) say(done);
  } catch (error) {
    say(`${board.displayName}: ${error.message}.`, true);
  }
}

const levelOf = (id) => Number($(id).value);

function fillSelect(select, entries) {
  select.replaceChildren(...entries.map(({ id, label }) => Object.assign(document.createElement("option"), { value: id, textContent: label })));
}

// ---- the board the dialog follows ---------------------------------------------------------------
function onStatus() {
  if (!shown?.actuators) return;
  trace.add(performance.now(), shown.actuators);
  renderActuators();
}

function follow(board) {
  if (shown === board) return;
  if (shown) {
    shown.removeEventListener("actuators", onStatus);
    shown.watchActuators(false).catch(() => {});
  }
  shown = board;
  trace.clear();
  if (shown) shown.addEventListener("actuators", onStatus);
}

function open() {
  const board = getBoard();
  if (!board?.connected || !board.hasActuators) return;
  follow(board);
  say("");
  $("act-dialog").showModal();
  renderActuators();
}

/** Closing stops everything: nothing keeps buzzing or pushing once you stop watching it. */
function closed() {
  const board = shown;
  clearTimeout(sliderTimer);
  if (board?.connected && board.hasActuators) {
    board.actuatorCommand({ command: ACTUATOR_COMMANDS.stopAll }).catch(() => {});
  }
  follow(null);
}

// ---- drawing ----------------------------------------------------------------------------------
function drawServoPlot() {
  const canvas = $("act-servo-plot");
  const { ctx, width, height } = fitCanvas(canvas);
  const style = getComputedStyle(document.documentElement);
  const color = (name) => style.getPropertyValue(name).trim();
  const y = (fraction) => height - 4 - fraction * (height - 8);
  hairline(ctx, 0, y(0.5), width, y(0.5), color("--screen-grid"));
  const points = trace.points;
  if (points.length < 2) return;
  const t0 = points.at(-1).tMs - trace.windowMs;
  const x = (tMs) => ((tMs - t0) / trace.windowMs) * width;
  for (const [key, name] of [["command", "--series-z"], ["feedback", "--signal"]]) {
    ctx.strokeStyle = color(name);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let drawing = false;
    for (const point of points) {
      if (point[key] === null) {
        drawing = false;
        continue;
      }
      if (drawing) ctx.lineTo(x(point.tMs), y(point[key]));
      else ctx.moveTo(x(point.tMs), y(point[key]));
      drawing = true;
    }
    ctx.stroke();
  }
}

function renderInputs(status) {
  const point = stickPoint(status.joystickXMv, status.joystickYMv);
  const dot = $("act-stick").firstElementChild;
  dot.style.left = `${50 + point.x * 46}%`;
  dot.style.top = `${50 - point.y * 46}%`;
  $("act-stick-mv").textContent = status.analogReady ? `X ${status.joystickXMv} mV · Y ${status.joystickYMv} mV` : "No ADC on this board";
  const held = new Set(heldKeys(status.keys));
  for (const item of $("act-keys").children) item.classList.toggle("on", held.has(item.dataset.key));
}

/** Redraws the dialog from the board's latest status. */
export function renderActuators() {
  if (!actuatorDialogOpen()) return;
  const board = getBoard();
  if (board !== shown) follow(board);
  const status = shown?.connected ? shown.actuators : null;
  $("act-board").textContent = shown ? shown.displayName : "";
  const usable = Boolean(status) && shown.hasActuators;
  if (usable && !shown.actuatorsWatched) shown.watchActuators(true).catch(() => {});

  const set = (ids, enabled) => ids.forEach((id) => ($(id).disabled = !enabled));
  set(["act-tac-play"], usable && status.tachammerReady);
  set(["act-erm-play", "act-erm-effect-play", "act-erm-rumble"], usable && status.ermReady);
  set(["act-servo-pulse", "act-servo-center", "act-servo-run", "act-servo-release"], usable && status.servoReady);
  set(["act-stop"], usable);

  if (!usable) {
    $("act-rail").textContent = shown?.connected ? "This board's firmware has no actuators: update it." : "Not connected.";
    return;
  }
  const playing = TACHAMMER_WAVEFORMS.find((entry) => entry.id === status.tachammerWaveform);
  $("act-tac-note").textContent = !status.tachammerReady ? "No I2S on this board." : playing ? `Playing: ${playing.label}` : "";
  $("act-erm-note").textContent = !status.ermReady ? "No DRV2605L answered at boot: check its wiring and 3V3." : status.ermPlaying ? "Playing…" : "";
  const pattern = SERVO_PATTERNS.find((entry) => entry.id === status.servoPattern);
  const fraction = feedbackFraction(status);
  $("act-servo-readout").textContent = [
    status.servoPulseUs ? `${status.servoPulseUs} µs (~${Math.round(pulseToDegrees(status.servoPulseUs))}°)` : "limp",
    pattern ? pattern.label : null,
    fraction === null ? "no feedback" : `feedback ${(fraction * 100).toFixed(1)}%`,
    status.servoRailMv ? `rail ${(status.servoRailMv / 1000).toFixed(2)} V` : null,
  ].filter(Boolean).join(" · ");
  $("act-rail").textContent = status.railOn ? "Actuator supply on" : "Actuator supply off";
  $("act-rail").classList.toggle("good-text", status.railOn);
  renderInputs(status);
  drawServoPlot();
}

// ---- controls ---------------------------------------------------------------------------------
function showLevel(input, output, unit = "%") {
  const update = () => ($(output).textContent = `${$(input).value}${unit}`);
  $(input).addEventListener("input", update);
  update();
}

function sendSliderPulse() {
  sliderTimer = null;
  send({ command: ACTUATOR_COMMANDS.servoPulse, value: Number($("act-servo-pulse").value) });
}

export function initActuators(options) {
  ({ getBoard } = options);
  fillSelect($("act-tac-wave"), TACHAMMER_WAVEFORMS);
  fillSelect($("act-erm-preset"), ERM_PRESETS.map((entry) => ({ ...entry, label: `${entry.label} (#${entry.effect})` })));
  fillSelect($("act-servo-pattern"), SERVO_PATTERNS);
  $("act-keys").replaceChildren(...Object.values(KEYS).map((key) => {
    const item = Object.assign(document.createElement("li"), { textContent: key });
    item.dataset.key = key;
    return item;
  }));
  Object.assign($("act-erm-effect"), { min: 1, max: ERM_ROM_EFFECT_MAX });
  Object.assign($("act-erm-ms"), { min: RUMBLE_MS.min, max: RUMBLE_MS.max });
  Object.assign($("act-servo-pulse"), { min: SERVO_PULSE_US.min, max: SERVO_PULSE_US.max, value: SERVO_PULSE_US.center });
  showLevel("act-tac-level", "act-tac-level-out");
  showLevel("act-erm-level", "act-erm-level-out");
  showLevel("act-servo-amp", "act-servo-amp-out");
  showLevel("act-servo-pulse", "act-servo-pulse-out", " µs");

  $("act-open").addEventListener("click", open);
  $("act-close").addEventListener("click", () => $("act-dialog").close());
  $("act-dialog").addEventListener("close", closed);

  $("act-tac-play").addEventListener("click", () =>
    send({ command: ACTUATOR_COMMANDS.tachammerPlay, id: Number($("act-tac-wave").value), level: levelOf("act-tac-level") }));
  $("act-erm-play").addEventListener("click", () => send({ command: ACTUATOR_COMMANDS.ermPreset, id: Number($("act-erm-preset").value) }));
  $("act-erm-effect-play").addEventListener("click", () => {
    const effect = Number($("act-erm-effect").value);
    if (!Number.isInteger(effect) || effect < 1 || effect > ERM_ROM_EFFECT_MAX) return say(`Effects run from 1 to ${ERM_ROM_EFFECT_MAX}.`, true);
    send({ command: ACTUATOR_COMMANDS.ermEffect, value: effect });
  });
  $("act-erm-rumble").addEventListener("click", () => {
    const ms = Number($("act-erm-ms").value);
    if (!Number.isInteger(ms) || ms < RUMBLE_MS.min || ms > RUMBLE_MS.max) return say(`A rumble lasts ${RUMBLE_MS.min}-${RUMBLE_MS.max} ms.`, true);
    send({ command: ACTUATOR_COMMANDS.ermRumble, level: levelOf("act-erm-level"), value: ms });
  });
  $("act-servo-pulse").addEventListener("input", () => {
    if (!sliderTimer) sliderTimer = setTimeout(sendSliderPulse, SLIDER_SEND_MS);
  });
  $("act-servo-center").addEventListener("click", () => {
    $("act-servo-pulse").value = SERVO_PULSE_US.center;
    $("act-servo-pulse").dispatchEvent(new Event("input"));
  });
  $("act-servo-run").addEventListener("click", () =>
    send({ command: ACTUATOR_COMMANDS.servoPattern, id: Number($("act-servo-pattern").value), level: levelOf("act-servo-amp") }));
  $("act-servo-release").addEventListener("click", () => send({ command: ACTUATOR_COMMANDS.servoRelease }, "Servo released: it goes limp."));
  $("act-stop").addEventListener("click", () => send({ command: ACTUATOR_COMMANDS.stopAll }, "Stopped."));
}

/** The summary under Settings › Actuators, for the selected board. */
export function renderActuatorSummary() {
  const board = getBoard();
  const status = board?.connected ? board.actuators : null;
  $("act-open").disabled = !(board?.connected && board.hasActuators);
  if (!board?.connected) $("act-summary").textContent = "Connect a board to test its actuators.";
  else if (!board.hasActuators) $("act-summary").textContent = "This board's firmware has no actuators: update it.";
  else {
    const parts = [["TacHammer", status.tachammerReady], ["ERM", status.ermReady], ["servo", status.servoReady], ["joystick", status.analogReady]];
    const found = parts.filter(([, ready]) => ready).map(([name]) => name);
    $("act-summary").textContent = found.length ? `Ready: ${found.join(", ")}.` : "Nothing found on this board.";
  }
}
