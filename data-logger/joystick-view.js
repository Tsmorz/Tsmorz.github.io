// The Joystick curve dialog (Settings › Mouse › Joystick curve…): the selected board's dead zone and
// two gains, drawn as the curve they make, with the stick's push as a dot on it while the board
// reports it. Each slider saves on release, so the cursor can be tried at once. joystick.js has the
// curve itself.
import { fitCanvas, hairline } from "./canvas.js";
import { curvePoints, joystickSpeed, stickPush } from "./joystick.js";
import { JOYSTICK_DEFAULT, JOYSTICK_LIMITS } from "./wire.js";

const $ = (id) => document.getElementById(id);

let getBoard = () => null;
let shown = null; // the board the dialog shows
let draft = null; // the curve on the sliders, saved or not

export const joystickDialogOpen = () => $("joy-dialog").open;

function say(text, bad = false) {
  $("joy-status").textContent = text;
  $("joy-status").classList.toggle("bad-text", bad);
}

const speedPercent = () => shown?.mouse?.speedPercent ?? 100;

function readSliders() {
  return { deadzonePercent: Number($("joy-deadzone").value), slowGain: Number($("joy-slow").value), fastGain: Number($("joy-fast").value) };
}

function setSliders(tuning) {
  $("joy-deadzone").value = tuning.deadzonePercent;
  $("joy-slow").value = tuning.slowGain;
  $("joy-fast").value = tuning.fastGain;
  showValues();
}

function showValues() {
  draft = readSliders();
  $("joy-deadzone-out").textContent = `${draft.deadzonePercent}%`;
  $("joy-slow-out").textContent = `${draft.slowGain} /s`;
  $("joy-fast-out").textContent = `${draft.fastGain} /s`;
  const full = Math.round(joystickSpeed(1, draft, speedPercent()));
  const half = Math.round(joystickSpeed(0.5, draft, speedPercent()));
  $("joy-summary").textContent = draft.slowGain + draft.fastGain > 0
    ? `Full push ${full} counts/s, half push ${half}, at ${speedPercent()}% mouse speed.`
    : "Both gains at 0 would stop the cursor: the board won't take that.";
}

// ---- the plot ---------------------------------------------------------------------------------
function drawCurve() {
  const { ctx, width, height } = fitCanvas($("joy-plot"));
  if (!draft) return;
  const style = getComputedStyle(document.documentElement);
  const color = (name) => style.getPropertyValue(name).trim();
  const pad = { left: 8, right: 8, top: 18, bottom: 18 };
  const top = Math.max(500, Math.ceil(joystickSpeed(1, draft, speedPercent()) / 500) * 500);
  const x = (push) => pad.left + push * (width - pad.left - pad.right);
  const y = (speed) => height - pad.bottom - (speed / top) * (height - pad.top - pad.bottom);

  // The dead zone, shaded; the grid at quarters of the push and of the top speed.
  ctx.fillStyle = color("--screen-shade");
  ctx.fillRect(x(0), pad.top, x(draft.deadzonePercent / 100) - x(0), height - pad.top - pad.bottom);
  for (let i = 0; i <= 4; i++) {
    hairline(ctx, x(i / 4), pad.top, x(i / 4), height - pad.bottom, color("--screen-grid"));
    hairline(ctx, x(0), y((top * i) / 4), x(1), y((top * i) / 4), color("--screen-grid"));
  }
  ctx.font = `11px ${color("--mono")}`;
  ctx.fillStyle = color("--screen-muted");
  ctx.textBaseline = "top";
  ctx.fillText(`${top} counts/s`, x(0) + 4, 3);
  ctx.textBaseline = "bottom";
  ctx.fillText("no push", x(0), height - 2);
  ctx.textAlign = "right";
  ctx.fillText("full push", x(1), height - 2);
  ctx.textAlign = "left";

  ctx.strokeStyle = color("--signal");
  ctx.lineWidth = 2;
  ctx.beginPath();
  curvePoints(draft, speedPercent()).forEach(({ deflection, speed }, i) => (i ? ctx.lineTo(x(deflection), y(speed)) : ctx.moveTo(x(deflection), y(speed))));
  ctx.stroke();

  const status = shown?.connected ? shown.actuators : null;
  if (status?.analogReady) {
    const push = stickPush(status);
    ctx.fillStyle = color("--series-z");
    ctx.beginPath();
    ctx.arc(x(push), y(joystickSpeed(push, draft, speedPercent())), 5, 0, 2 * Math.PI);
    ctx.fill();
  }
}

// ---- the board it follows -----------------------------------------------------------------------
const onStatus = () => joystickDialogOpen() && drawCurve();

function follow(board) {
  if (shown === board) return;
  if (shown) {
    shown.removeEventListener("actuators", onStatus);
    shown.watchActuators(false).catch(() => {});
  }
  shown = board;
  if (shown) {
    shown.addEventListener("actuators", onStatus);
    shown.watchActuators(true).catch(() => {});
  }
}

function open() {
  const board = getBoard();
  if (!board?.connected || !board.joystickTuning) return;
  follow(board);
  setSliders(board.joystickTuning);
  say("");
  $("joy-dialog").showModal();
  renderJoystick();
}

async function save(tuning) {
  const board = shown;
  if (!board?.connected) return say("The board isn't connected.", true);
  try {
    const saved = await board.setJoystickTuning(tuning);
    setSliders(saved);
    say(`Saved on ${board.displayName}.`);
  } catch (error) {
    setSliders(board.joystickTuning ?? tuning);
    say(`${board.displayName}: ${error.message}.`, true);
  }
  drawCurve();
}

/** Redraws the dialog for the selected board (app.js calls it with the rest of the page). */
export function renderJoystick() {
  if (!joystickDialogOpen()) return;
  const board = getBoard();
  if (board !== shown) {
    follow(board);
    if (board?.joystickTuning) setSliders(board.joystickTuning);
  }
  const usable = Boolean(shown?.connected && shown.joystickTuning);
  $("joy-board").textContent = shown ? shown.displayName : "";
  for (const id of ["joy-deadzone", "joy-slow", "joy-fast", "joy-defaults"]) $(id).disabled = !usable;
  if (!usable) say(shown?.connected ? "This board's firmware has no joystick curve: update it." : "Not connected.", true);
  showValues();
  drawCurve();
}

/** Whether the selected board has a curve to tune (the Mouse section's button). */
export function renderJoystickKey() {
  const board = getBoard();
  $("joy-open").disabled = !(board?.connected && board.joystickTuning);
}

export function initJoystick(options) {
  ({ getBoard } = options);
  Object.assign($("joy-deadzone"), { max: JOYSTICK_LIMITS.deadzoneMaxPercent });
  Object.assign($("joy-slow"), { max: JOYSTICK_LIMITS.gainMax });
  Object.assign($("joy-fast"), { max: JOYSTICK_LIMITS.gainMax });
  setSliders(JOYSTICK_DEFAULT);

  $("joy-open").addEventListener("click", open);
  $("joy-close").addEventListener("click", () => $("joy-dialog").close());
  $("joy-dialog").addEventListener("close", () => follow(null));
  for (const id of ["joy-deadzone", "joy-slow", "joy-fast"]) {
    $(id).addEventListener("input", () => {
      showValues();
      drawCurve();
    });
    $(id).addEventListener("change", () => save(readSliders()));
  }
  $("joy-defaults").addEventListener("click", () => save({ ...JOYSTICK_DEFAULT }));
}
