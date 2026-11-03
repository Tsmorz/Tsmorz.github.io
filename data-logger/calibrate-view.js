// The Calibrate the IMU dialog (Settings › IMU calibration): the selected board's accelerometer
// from six still faces, then its gyroscope from ten turns about each axis. The pose view, drawn large,
// shows which side to stand up and the pose to reach; beside it, a picture of each face or axis to do
// and what the sensor itself reads. imu-calibration.js measures; the board
// keeps the result and applies it before VQF (imu_format.h).
import {
  AXES, AccelFaces, FACES, FACE_TOLERANCE_DEG, GyroTurns, HOLD_SECONDS, TURNS, applyCalibration, faceOf, fitAccel, formatGain, formatOffset, isUncalibrated, tiltFrom,
} from "./imu-calibration.js";
import { headingChangeDegrees, uprightPose, zeroedPose } from "./pose.js";
import { UNCALIBRATED } from "./wire.js";

const $ = (id) => document.getElementById(id);
// The gyro's axes in the order asked for: Z needs no more than the board lying flat.
const GYRO_ORDER = [2, 0, 1];
// How each gyro axis stands straight up on the table: its + face (imu-calibration.js).
const upright = (axis) => FACES.find((face) => face.axis === axis && face.sign > 0);
const GYRO_HOW = ["On its long edge, RGB LED's side up", "On its end, USB port up", "Flat, parts up"];
// The target pose keeps its heading until the board's has turned this far from it.
const GHOST_RESNAP_DEG = 60;
// The accelerometer reading shown, smoothed over about 50 ms so its numbers don't flicker.
const LEVEL_SMOOTHING = 0.1;
const IDENTITY = { w: 1, x: 0, y: 0, z: 0 };

let getBoard = () => null;
let drawPose = () => {};
let drawBoardPicture = () => {};
let setStatus = () => {};
let mode = "accel";
let faces = new AccelFaces();
let fit = null; // fitAccel()'s result once all six faces are in
let chosenFace = -1; // the face clicked to do next, if any
let gyroAxis = GYRO_ORDER[0];
let gyroTest = new GyroTurns(gyroAxis);
let gyroGains = [null, null, null]; // measured this time, per axis
let note = null; // { text, bad }
let tapped = null; // the board feeding samples in
let lastSample = null;
let level = null; // the smoothed accelerometer reading
let ghost = null; // { key, quat }: the pose to reach, held steady
let saving = false;
let picturesShown = null; // the tab whose pictures were drawn last
let frame = 0;

export const calibrateDialogOpen = () => $("cal-dialog").open;

const axisVector = ({ axis, sign }) => [0, 1, 2].map((k) => (k === axis ? sign : 0));

function startOver() {
  faces = new AccelFaces();
  fit = null;
  chosenFace = -1;
  gyroGains = [null, null, null];
  startGyroAxis(GYRO_ORDER[0]);
  note = null;
}

function startGyroAxis(axis) {
  gyroAxis = axis;
  gyroTest = new GyroTurns(axis);
}

function onSamples(samples) {
  for (const sample of samples) {
    lastSample = sample;
    level = level ? level.map((a, k) => a + LEVEL_SMOOTHING * (sample.accelG[k] - a)) : [...sample.accelG];
    if (mode === "accel") {
      const captured = faces.add(sample);
      if (captured >= 0 && captured === chosenFace) chosenFace = -1;
      if (captured >= 0 && faces.done) {
        fit = fitAccel(faces.captured);
        note = fit.error ? { text: fit.error, bad: true } : null;
      }
      continue;
    }
    const wasTurning = gyroTest.phase === "turn";
    gyroTest.add(sample);
    if (gyroTest.phase === "turn" && !wasTurning) note = null;
    if (gyroTest.phase === "failed") {
      note = { text: gyroTest.error, bad: true };
      startGyroAxis(gyroAxis);
    } else if (gyroTest.phase === "done") {
      gyroGains[gyroAxis] = gyroTest.result.gain;
      const lost = gyroTest.result.lost ? ` (${gyroTest.result.lost} samples bridged)` : "";
      note = { text: `${AXES[gyroAxis]}: ${gyroTest.result.measuredTurns.toFixed(3)} turns measured, so its gain is ${formatGain(gyroTest.result.gain)}${lost}.`, bad: false };
      const next = GYRO_ORDER.find((axis) => gyroGains[axis] === null);
      startGyroAxis(next ?? gyroAxis);
      if (next === undefined) gyroTest.phase = "done";
    }
  }
}

// Keeps the selected board's samples coming in while the dialog is open, and only then.
function tap(board) {
  if (tapped === board) return;
  if (tapped) tapped.imuTap = null;
  // Another board's samples mustn't finish what this one's started.
  if (tapped && board) startOver();
  tapped = board?.connected ? board : null;
  if (tapped) tapped.imuTap = onSamples;
  lastSample = null;
  level = null;
  ghost = null;
}

// The pose to reach: the board as it is, tipped until `face` points up. Held still while the board
// moves, so it doesn't swim; it follows only a new face, or the board's heading turning far from it.
function steadyGhost(board, face) {
  if (!board?.quat) return null;
  const key = `${face.axis}${face.sign}`;
  const fresh = uprightPose(zeroedPose(board.quat, board.yawZero), axisVector(face));
  if (!ghost || ghost.key !== key || Math.abs(headingChangeDegrees(ghost.quat, fresh)) > GHOST_RESNAP_DEG) ghost = { key, quat: fresh };
  return ghost.quat;
}

// The face to do next: the one the board is on, else the one clicked, else the first left.
function targetFace() {
  if (faces.facing >= 0 && !faces.captured[faces.facing]) return faces.facing;
  if (chosenFace >= 0 && !faces.captured[chosenFace]) return chosenFace;
  return FACES.findIndex((_, i) => !faces.captured[i]);
}

// What to show: `step` (which one of how many), `say` (the instruction), `detail` (how), `progress`
// (the bar: a hold, or the turns), and for the pose view `target`, `ghost`, `ring` and `caption`
// (drawPose in app.js).
function guide() {
  const board = getBoard();
  if (!lastSample) return { step: "", say: "Waiting for the IMU…", detail: "" };
  return mode === "accel" ? accelGuide(board) : gyroGuide(board);
}

function accelGuide(board) {
  const done = faces.captured.filter(Boolean).length;
  if (faces.done) {
    return fit?.error
      ? { step: "Six of six faces", say: "Those didn't fit: start over", detail: "" }
      : { step: "Six of six faces", say: "Done: save it to the board", detail: "Then the gyroscope." };
  }
  const index = targetFace();
  const face = FACES[index];
  const target = { ...face, name: `${face.name} up` };
  const step = `Face ${done + 1} of 6 · ${face.name} up`;
  const off = tiltFrom(level, face).offDeg;
  if (faces.facing === index) {
    const left = Math.max(0, HOLD_SECONDS * (1 - faces.progress));
    return { step, say: "Hold it still", detail: `Let go and leave it there: it's taken when the bar fills, in ${left.toFixed(1)} s.`, progress: faces.progress, target, ghost: steadyGhost(board, face), caption: `${face.name} up · ${left.toFixed(1)} s to go` };
  }
  return { step, say: face.say, detail: face.detail, target, ghost: steadyGhost(board, face), caption: `Tip it ${off.toFixed(0)}° along the arrow` };
}

function gyroGuide(board) {
  if (gyroTest.phase === "done") return { step: "Three of three axes", say: "Done: save it to the board", detail: "" };
  const axis = AXES[gyroAxis];
  const step = `${axis} axis · ${GYRO_ORDER.indexOf(gyroAxis) + 1} of 3`;
  if (gyroTest.phase === "place") {
    const upFace = faceOf(lastSample.accelG);
    const face = FACES.find((f) => f.axis === gyroAxis && f.sign === (upFace >= 0 && FACES[upFace].axis === gyroAxis ? FACES[upFace].sign : 1));
    return { step, say: upright(gyroAxis).say, detail: "On a flat table, lined up with a mark or an edge so it can come back to exactly the same place.", target: { ...face, name: `${axis} up` }, ghost: steadyGhost(board, face), caption: `${axis} up · 0 of ${TURNS} turns` };
  }
  if (gyroTest.phase === "settle") {
    return { step, say: "Let go and leave it still", detail: "It measures the gyroscope's offset first.", progress: gyroTest.progress, ring: { fraction: 0 }, caption: `${axis} · ready in ${gyroTest.secondsToGo.toFixed(1)} s` };
  }
  const turns = Math.abs(gyroTest.turnsSoFar);
  const ring = { fraction: Math.min(1, turns / TURNS), turnedDeg: gyroTest.turnsSoFar * 360 };
  if (turns >= TURNS - 0.5 && gyroTest.progress > 0) {
    return { step, say: "Leave it still", detail: "It measures the offset again, then the gain.", progress: gyroTest.progress, ring, caption: `${turns.toFixed(2)} turns · ${gyroTest.secondsToGo.toFixed(1)} s to go` };
  }
  return { step, say: `Turn it ${TURNS} times on the table`, detail: "Either way, at any speed, keeping it on the table. Stop lined up exactly where it started.", progress: ring.fraction, ring, caption: `${axis} · ${turns.toFixed(1)} of ${TURNS} turns` };
}

function renderBar(fraction) {
  const percent = Math.round(Math.min(1, fraction) * 100);
  $("cal-bar").firstElementChild.style.width = `calc(${percent}% - 4px)`;
  $("cal-bar").firstElementChild.hidden = percent === 0;
  if ($("cal-bar").getAttribute("aria-valuenow") !== String(percent)) $("cal-bar").setAttribute("aria-valuenow", String(percent));
}

// Written only when it changes, so the live regions don't announce the same thing every frame.
function setText(id, text) {
  if ($(id).textContent !== text) $(id).textContent = text;
}

function loop() {
  if (!calibrateDialogOpen()) {
    frame = 0;
    return;
  }
  tap(getBoard());
  const now = guide();
  drawPose($("cal-pose"), now);
  setText("cal-step", now.step);
  setText("cal-say", now.say);
  setText("cal-detail", now.detail);
  renderBar(now.progress ?? 0);
  if (mode === "accel") {
    renderFaces();
    renderReading();
  } else {
    renderAxes();
  }
  frame = requestAnimationFrame(loop);
}

// ---- accelerometer: face tiles and the level ----------------------------------------------

function makeTile(name, onClick) {
  const tile = Object.assign(document.createElement("button"), { type: "button", className: "cal-face" });
  tile.append(Object.assign(document.createElement("canvas"), { ariaHidden: "true" }), Object.assign(document.createElement("span"), { className: "lamp" }), Object.assign(document.createElement("span"), { className: "name", textContent: name }));
  tile.addEventListener("click", onClick);
  return tile;
}

function buildTiles() {
  $("cal-faces").replaceChildren(...FACES.map((face, i) => makeTile(face.name, () => {
    if (faces.captured[i]) {
      faces.redo(i);
      fit = null;
      note = null;
    }
    chosenFace = i;
    ghost = null;
  })));
  $("cal-axes").replaceChildren(...GYRO_ORDER.map((axis) => makeTile(AXES[axis], () => {
    startGyroAxis(axis);
    note = null;
    ghost = null;
  })));
}

// The tiles' pictures: each face, or each axis to turn about, stood up from the board lying flat.
// Drawn once the dialog is open: its canvases have no size until then.
function drawPictures() {
  [...$("cal-faces").children].forEach((tile, i) => drawBoardPicture(tile.querySelector("canvas"), uprightPose(IDENTITY, axisVector(FACES[i]))));
  [...$("cal-axes").children].forEach((tile, i) => drawBoardPicture(tile.querySelector("canvas"), uprightPose(IDENTITY, axisVector(upright(GYRO_ORDER[i]))), { turn: true }));
}

function renderFaces() {
  const target = faces.done ? -1 : targetFace();
  [...$("cal-faces").children].forEach((tile, i) => {
    const done = Boolean(faces.captured[i]);
    tile.classList.toggle("done", done);
    tile.classList.toggle("current", i === target);
    tile.title = done ? `${FACES[i].name}: ${Math.hypot(...faces.captured[i]).toFixed(4)} g. Click to redo it` : `${FACES[i].say}. Click to do it next`;
  });
}

// The accelerometer's own reading: how far the face is from up, and |a|, raw and corrected.
function renderReading() {
  const index = faces.done ? -1 : targetFace();
  if (!level || index < 0) {
    setText("cal-tilt", faces.done ? "All six faces in." : "");
    setText("cal-reading", "");
    return;
  }
  const face = FACES[index];
  const { offDeg } = tiltFrom(level, face);
  setText("cal-tilt", `${face.name} is ${offDeg.toFixed(0)}° from up${offDeg <= FACE_TOLERANCE_DEG ? ": near enough" : `: within ${FACE_TOLERANCE_DEG}° counts`}`);
  const saved = getBoard()?.imuCalibration;
  const cal = fit && !fit.error ? { ...UNCALIBRATED, accelOffsetG: fit.accelOffsetG, accelGain: fit.accelGain } : saved && !isUncalibrated(saved) ? saved : null;
  const corrected = cal ? Math.hypot(...applyCalibration(cal, level, [0, 0, 0]).accelG) : null;
  setText("cal-reading", `|a| ${Math.hypot(...level).toFixed(3)} g${corrected === null ? "" : ` · ${corrected.toFixed(3)} g ${fit && !fit.error ? "with this fit" : "as saved"}`}`);
}

// ---- gyro: the axes and the reading ------------------------------------------------------

function renderAxes() {
  const allDone = gyroTest.phase === "done";
  [...$("cal-axes").children].forEach((tile, i) => {
    const axis = GYRO_ORDER[i];
    const done = gyroGains[axis] !== null;
    tile.classList.toggle("done", done);
    tile.classList.toggle("current", axis === gyroAxis && !allDone);
    tile.title = `${AXES[axis]}: ${GYRO_HOW[axis].toLowerCase()}, turned ${TURNS} times.${done ? ` Gain ${formatGain(gyroGains[axis])}. Click to redo it` : " Click to do it next"}`;
  });
  setText("cal-turns", gyroReading());
  const measured = GYRO_ORDER.filter((axis) => gyroGains[axis] !== null);
  setText("cal-gains", measured.length ? `Gains ${measured.map((axis) => `${AXES[axis]} ${formatGain(gyroGains[axis])}`).join(" · ")}` : "No gains measured yet");
}

// The gyroscope's own say about the axis under way.
function gyroReading() {
  if (gyroTest.phase === "done") return "All three axes measured.";
  if (!level) return "";
  const axis = AXES[gyroAxis];
  if (gyroTest.phase === "place") {
    const off = Math.min(tiltFrom(level, upright(gyroAxis)).offDeg, tiltFrom(level, { axis: gyroAxis, sign: -1 }).offDeg);
    return `${axis} is ${off.toFixed(0)}° from up${off <= FACE_TOLERANCE_DEG ? ": hold it still" : ""}`;
  }
  if (gyroTest.phase === "settle") return `Measuring its offset · ${gyroTest.secondsToGo.toFixed(1)} s`;
  return `${Math.abs(gyroTest.turnsSoFar).toFixed(2)} of ${TURNS} turns about ${axis}`;
}

/** Redraws the dialog's controls from the selected board (renderBoards() calls it, 4 times a second). */
export function renderCalibrate() {
  const board = getBoard();
  const blocked = !board?.connected ? "Connect a board first." : !board.imuCalibration ? "This board's firmware can't keep a calibration: update it." : "";
  $("cal-board").textContent = board?.displayName ?? "";
  for (const input of document.querySelectorAll('input[name="cal-mode"]')) input.checked = input.value === mode;
  $("cal-accel-help").hidden = mode !== "accel";
  $("cal-gyro-help").hidden = mode !== "gyro";
  // A tab's pictures can only be drawn once it shows: hidden, its canvases have no size.
  if (picturesShown !== mode) {
    picturesShown = mode;
    drawPictures();
  }
  const ready = mode === "accel" ? Boolean(fit && !fit.error) : gyroGains.some((gain) => gain !== null);
  $("cal-save").disabled = Boolean(blocked) || saving || !ready;
  const mouseOn = mode === "gyro" && board?.mouse?.enabled;
  const text = blocked || note?.text || (mouseOn ? "Its mouse is on, so the cursor will move as it turns: switch it off in Settings › Mouse first." : "") || summary(board);
  $("cal-status").textContent = text;
  $("cal-status").className = `voice-status ${blocked || note?.bad ? "bad-text" : ""}`;
}

function summary(board) {
  if (mode === "accel" && fit && !fit.error) {
    const [low, high] = fit.before;
    return `Offsets ${fit.accelOffsetG.map(formatOffset).join(", ")}; gains ${fit.accelGain.map(formatGain).join(", ")}. The faces read ${low.toFixed(3)}–${high.toFixed(3)} g; with this, all 1.000 g.`;
  }
  return describeCalibration(board?.imuCalibration);
}

/** One line for what a board keeps, for here and the Settings drawer. */
export function describeCalibration(cal) {
  if (!cal) return "";
  if (isUncalibrated(cal)) return "Not calibrated yet.";
  const accel = cal.accelOffsetG.some(Boolean) || cal.accelGain.some(Boolean) ? `accelerometer offsets ${cal.accelOffsetG.map(formatOffset).join(", ")}, gains ${cal.accelGain.map(formatGain).join(", ")}` : "accelerometer not calibrated";
  const gyro = cal.gyroGain.some(Boolean) ? `gyroscope gains ${cal.gyroGain.map(formatGain).join(", ")}` : "gyroscope not calibrated";
  return `Saved: ${accel}; ${gyro}.`;
}

async function save() {
  const board = getBoard();
  const current = board.imuCalibration ?? UNCALIBRATED;
  const next = mode === "accel"
    ? { ...current, accelOffsetG: fit.accelOffsetG, accelGain: fit.accelGain }
    : { ...current, gyroGain: current.gyroGain.map((gain, axis) => gyroGains[axis] ?? gain) };
  saving = true;
  renderCalibrate();
  try {
    await board.setImuCalibration(next);
    note = { text: `Saved on ${board.displayName}. ${mode === "accel" ? "Next, the gyroscope." : ""}`, bad: false };
    setStatus(`${board.displayName}: IMU calibration saved`);
    if (mode === "accel") {
      faces = new AccelFaces();
      fit = null;
      setMode("gyro");
    } else {
      gyroGains = [null, null, null];
      startGyroAxis(GYRO_ORDER[0]);
    }
  } catch (error) {
    note = { text: `Couldn't save it: ${error.message}`, bad: true };
  }
  saving = false;
  renderCalibrate();
}

function setMode(next) {
  mode = next;
  ghost = null;
}

/**
 * Wires the dialog up. `getBoard()` is the selected board; drawPose(canvas, guide) the pose view and
 * drawBoardPicture(canvas, quat) a still of the board (both app.js).
 */
export function initCalibrate(options) {
  ({ getBoard, drawPose, drawBoardPicture, setStatus } = options);
  buildTiles();
  $("imu-cal-open").addEventListener("click", () => {
    startOver();
    setMode("accel");
    if (!$("cal-dialog").open) $("cal-dialog").showModal();
    tap(getBoard());
    picturesShown = null; // drawn by renderCalibrate(), now the canvases have a size
    renderCalibrate();
    if (!frame) frame = requestAnimationFrame(loop);
  });
  $("cal-close").addEventListener("click", () => $("cal-dialog").close());
  $("cal-dialog").addEventListener("close", () => tap(null));
  for (const input of document.querySelectorAll('input[name="cal-mode"]')) {
    input.addEventListener("change", () => {
      setMode(input.value);
      note = null;
      renderCalibrate();
    });
  }
  $("cal-save").addEventListener("click", save);
  $("cal-restart").addEventListener("click", () => {
    startOver();
    ghost = null;
    renderCalibrate();
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => calibrateDialogOpen() && drawPictures());
  $("theme").addEventListener("click", () => calibrateDialogOpen() && drawPictures());
}
