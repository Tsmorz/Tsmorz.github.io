import { Board, DISPLAY_DECIMATION, ENVELOPE_SECONDS, TRACE_POINTS } from "./board.js";
import { fitCanvas, hairline } from "./canvas.js";
import { describeLatency, resultRow } from "./latency.js";
import { dragSeam, gridTracks, parseSavedLayout, toFractions } from "./layout.js";
import { headingChangeDegrees, quatToEulerDegrees, removeYaw, rotateVector } from "./pose.js";
import { decodeFlashLog, flashSessionFiles, groupSessions, lostSamples } from "./flashlog.js";
import { safeName } from "./recording.js";
import { initReplay } from "./replay-view.js";
import {
  ledDisplayColor, levelFraction, loudestIndex, meterFraction, peakOf, peakToDbfs, pickRange, recentPeak,
} from "./signal.js";
import { ACCEL_RANGES_G, DATA_SERVICE, GYRO_RANGES_DPS, LOG_SERVICE, TELEMETRY_SERVICE } from "./wire.js";
import { SMP_SERVICE, parseMcubootImage } from "./smp.js";

const $ = (id) => document.getElementById(id);
const IDENTITY_QUAT = { w: 1, x: 0, y: 0, z: 0 };
const ENVELOPE_FLOOR_DBFS = -80;
const MARK_LAMP_MS = 400;
// A tap is over well within one 250 ms table redraw, so a press keeps the USER lamp lit this long.
const USER_LAMP_MIN_MS = 400;

const boards = new Map(); // by Web Bluetooth device id
let selected = null;
const recorder = { active: false, startedAt: null, members: [], dirHandle: null };

// ---- "seen working" checklist, for the selected board ------------------------------------
const CHECKS = [
  ["rate", "IMU samples arrive at ~208 Hz"],
  ["loss", "No IMU samples lost over 10 s"],
  ["accel", "Accelerometer reads ~1 g at rest"],
  ["pose", "Orientation estimate arriving (VQF)"],
  ["rest", "VQF detected rest (leave the board still for a few seconds)"],
  ["gyro-x", "Gyro X responded to rotation"],
  ["gyro-y", "Gyro Y responded to rotation"],
  ["gyro-z", "Gyro Z responded to rotation"],
  ["mic", "Microphone envelope arriving"],
  ["spectrum", "Microphone spectrum arriving"],
  ["sync", "Clap heard (sync mark)"],
  ["button", "USER button press recorded"],
  ["led", "LED command accepted"],
  ["latency", "Mouse reports acknowledged by the host (latency measured)"],
];
$("checks").innerHTML = CHECKS.map(([id, text]) => `<li id="check-${id}">${text}</li>`).join("");
function renderChecks() {
  const seen = selected?.seen ?? new Set();
  for (const [id] of CHECKS) $(`check-${id}`).classList.toggle("done", seen.has(id));
  $("check-count").textContent = `${CHECKS.filter(([id]) => seen.has(id)).length} of ${CHECKS.length}`;
}
renderChecks();

// ---- theme --------------------------------------------------------------------------------
// The page follows the OS until the toggle is used; the choice is then remembered per browser.
const darkQuery = matchMedia("(prefers-color-scheme: dark)");
let colors = {};
// Every canvas is a dark "screen" in both themes, so it draws with the screen tokens.
function readColors() {
  const css = getComputedStyle(document.documentElement);
  const token = (name) => css.getPropertyValue(`--${name}`).trim();
  colors = {
    grid: token("screen-grid"), line: token("screen-line"), muted: token("screen-muted"), text: token("screen-text"), screen: token("screen"),
    readout: token("readout"), board: token("board"), mono: token("mono"), signal: token("signal"), bad: token("bad"),
    ledRed: token("led-red"), ledGreen: token("led-green"),
    series: [token("series-x"), token("series-y"), token("series-z")],
  };
  // The phone browser's bar follows the header, toggle included.
  document.querySelector('meta[name="theme-color"]').content = token("panel");
  syncThemeSwitch();
}
function effectiveTheme() {
  return document.documentElement.dataset.theme ?? (darkQuery.matches ? "dark" : "light");
}
function syncThemeSwitch() {
  $("theme").setAttribute("aria-checked", String(effectiveTheme() === "dark"));
}
$("theme").addEventListener("click", () => {
  const next = effectiveTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("theme", next);
  } catch {
    /* storage blocked: the choice lasts for this page load */
  }
  readColors();
});
darkQuery.addEventListener("change", readColors);
readColors();

// Settings (mouse, lights, firmware update, latency, the seen-working checklist) open in a drawer over the page's
// right edge, just below the header, so they never take room from the panels.
function setSettingsOpen(open) {
  const drawer = $("settings-drawer");
  drawer.style.top = `${Math.max(0, document.querySelector("header").getBoundingClientRect().bottom)}px`;
  drawer.hidden = !open;
  $("settings").setAttribute("aria-expanded", String(open));
}
$("settings").addEventListener("click", () => setSettingsOpen($("settings-drawer").hidden));
$("settings-close").addEventListener("click", () => setSettingsOpen(false));
window.addEventListener("resize", () => !$("settings-drawer").hidden && setSettingsOpen(true));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("settings-drawer").hidden && !$("fw-dialog").open) setSettingsOpen(false);
});
// A press anywhere else closes it too, except on its own key (which toggles it) and in the
// firmware dialog it opens. The press still does whatever it was for, e.g. picks a board.
document.addEventListener("pointerdown", (event) => {
  const drawer = $("settings-drawer");
  if (drawer.hidden || $("fw-dialog").open) return;
  if (drawer.contains(event.target) || $("settings").contains(event.target)) return;
  setSettingsOpen(false);
});

// ---- draggable seams ----------------------------------------------------------------------
// In the laptop layout the seams between panels can be dragged, or moved with the arrow keys once
// focused, to resize them; a double-click puts that split back to its default. The sizes are kept
// as fractions in this browser (layout.js), so they scale with the window. Most splits are the
// page grid's tracks; one `within` a module shares that module's height between its plots instead.
const LAYOUT_KEY = "layout";
const WIDE_LAYOUT = matchMedia("(min-width: 1200px) and (min-height: 600px)");
const mainEl = document.querySelector("main");
const SPLITS = {
  top: { axis: "x", minPx: 320, panels: [".boards-section", ".recording-section"] },
  bottom: { axis: "x", minPx: 240, panels: [".orientation-section", ".motion-section", ".mic-section"] },
  rows: { axis: "y", minPx: 150, panels: [".top-row", ".motion-section"] },
  mic: { axis: "y", minPx: 64, panels: ["#envelope-plot", "#spectrum-plot"], within: ".mic-section" },
};
let savedLayout = {};
try {
  savedLayout = parseSavedLayout(localStorage.getItem(LAYOUT_KEY));
} catch { /* storage blocked: the default layout */ }

function saveLayout() {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(savedLayout));
  } catch { /* storage blocked: the sizes last until the page reloads */ }
}

function applySplit(name) {
  const fractions = savedLayout[name];
  if (SPLITS[name].within) {
    // The plots grow from no height (flex-basis 0), so their heights keep these proportions.
    SPLITS[name].panels.forEach((selector, i) => (document.querySelector(selector).style.flexGrow = fractions?.[i] ?? ""));
    return;
  }
  if (fractions) mainEl.style.setProperty(`--${name}-tracks`, gridTracks(fractions));
  else mainEl.style.removeProperty(`--${name}-tracks`);
  mainEl.classList.toggle(`${name}-sized`, Boolean(fractions));
}

const seams = [];
function placeSeams() {
  if (!WIDE_LAYOUT.matches) return;
  const box = mainEl.getBoundingClientRect();
  for (const { seam, split, index } of seams) {
    const panel = document.querySelector(split.panels[index]).getBoundingClientRect();
    if (split.axis === "x") {
      Object.assign(seam.style, { left: `${panel.right - box.left}px`, top: `${panel.top - box.top}px`, height: `${panel.height}px` });
    } else if (split.within) {
      // Just under the upper plot, in the gap above the lower one's heading.
      const area = document.querySelector(split.within).getBoundingClientRect();
      Object.assign(seam.style, { left: `${area.left - box.left}px`, top: `${panel.bottom - box.top + 6}px`, width: `${area.width}px` });
    } else {
      Object.assign(seam.style, { left: "0px", top: `${panel.bottom - box.top}px`, width: `${box.width}px` });
    }
  }
}

function addSeam(name, split, index) {
  const seam = document.createElement("div");
  seam.className = `seam ${split.axis === "x" ? "vertical" : "horizontal"}`;
  seam.tabIndex = 0;
  seam.title = "Drag to resize; double-click to reset";
  seam.setAttribute("role", "separator");
  seam.setAttribute("aria-orientation", split.axis === "x" ? "vertical" : "horizontal");
  seam.setAttribute("aria-label", split.within ? "Resize plots" : "Resize panels");
  mainEl.append(seam);
  seams.push({ seam, split, index });

  const sizes = () => split.panels.map((selector) => {
    const rect = document.querySelector(selector).getBoundingClientRect();
    return split.axis === "x" ? rect.width : rect.height;
  });
  const resize = (from, delta) => {
    savedLayout[name] = toFractions(dragSeam(from, index, delta, split.minPx));
    applySplit(name);
    placeSeams();
  };
  const position = (event) => (split.axis === "x" ? event.clientX : event.clientY);

  seam.addEventListener("pointerdown", (event) => {
    const start = position(event);
    const from = sizes();
    const drag = new AbortController();
    seam.setPointerCapture(event.pointerId);
    seam.classList.add("dragging");
    document.body.classList.add(`resizing-${split.axis}`);
    seam.addEventListener("pointermove", (move) => resize(from, position(move) - start), { signal: drag.signal });
    const end = () => {
      drag.abort();
      seam.classList.remove("dragging");
      document.body.classList.remove(`resizing-${split.axis}`);
      saveLayout();
    };
    seam.addEventListener("pointerup", end, { signal: drag.signal });
    seam.addEventListener("pointercancel", end, { signal: drag.signal });
  });
  seam.addEventListener("keydown", (event) => {
    const keys = split.axis === "x" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
    const direction = keys.indexOf(event.key);
    if (direction < 0) return;
    event.preventDefault();
    resize(sizes(), (direction ? 1 : -1) * (event.shiftKey ? 64 : 16));
    saveLayout();
  });
  seam.addEventListener("dblclick", () => {
    delete savedLayout[name];
    applySplit(name);
    placeSeams();
    saveLayout();
  });
}

for (const [name, split] of Object.entries(SPLITS)) {
  applySplit(name);
  for (let index = 0; index < split.panels.length - 1; index++) addSeam(name, split, index);
}
const seamObserver = new ResizeObserver(placeSeams);
seamObserver.observe(mainEl);
for (const split of Object.values(SPLITS)) for (const selector of split.panels) seamObserver.observe(document.querySelector(selector));
WIDE_LAYOUT.addEventListener("change", placeSeams);

// ---- canvas helpers -----------------------------------------------------------------------
// Tracks the pointer over a plot as a 0..1 fraction of its width (null when outside).
function trackHover(canvas) {
  const hover = { fraction: null, fractionY: null };
  const update = (event) => {
    const box = canvas.getBoundingClientRect();
    hover.fraction = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width));
    hover.fractionY = Math.max(0, Math.min(1, (event.clientY - box.top) / box.height));
  };
  canvas.addEventListener("pointermove", update);
  canvas.addEventListener("pointerdown", update);
  // pointercancel: a touch that turns into a page scroll.
  for (const type of ["pointerleave", "pointercancel"]) canvas.addEventListener(type, () => (hover.fraction = null));
  return hover;
}

// Fills a tooltip with a heading and rows of [value, label, key colour]. Uses text nodes only.
function showTooltip(tip, canvas, fraction, heading, rows) {
  tip.replaceChildren();
  const head = document.createElement("div");
  head.className = "when";
  head.textContent = heading;
  tip.append(head);
  for (const [value, label, color] of rows) {
    const row = document.createElement("div");
    const val = Object.assign(document.createElement("span"), { className: "val", textContent: value });
    const name = Object.assign(document.createElement("span"), { className: "name", textContent: label });
    if (color) {
      const key = Object.assign(document.createElement("span"), { className: "key" });
      key.style.background = color;
      row.append(val, key, name);
    } else {
      row.append(val, name);
    }
    tip.append(row);
  }
  tip.hidden = false;
  const x = fraction * canvas.clientWidth;
  const flip = x > canvas.clientWidth - tip.offsetWidth - 16;
  tip.style.left = `${flip ? x - tip.offsetWidth - 10 : x + 10}px`;
}

// Live X/Y/Z values beside each plot's heading; their colour keys double as the plot legend.
// `extra` adds unkeyed values after them (the accelerometer's magnitude).
function buildLive(container, extra = []) {
  const keyed = ["x", "y", "z"].map((axis) => `<span style="--key: var(--series-${axis})">${axis.toUpperCase()} <b>–</b></span>`);
  container.innerHTML = [...keyed, ...extra.map((name) => `<span>${name} <b>–</b></span>`)].join("");
}
function setLive(container, values, decimals) {
  values.forEach((value, i) => (container.children[i].lastElementChild.textContent = Number.isFinite(value) ? value.toFixed(decimals) : "–"));
}
buildLive($("gyro-live"));
buildLive($("accel-live"), ["|a|"]);

// ---- orientation --------------------------------------------------------------------------
// A fixed isometric camera looks at the world frame: x toward the front-left, y toward the
// front-right, z up, seen from 30 degrees above the horizon. The board's own X/Y/Z axes are drawn
// rotated by the quaternion, over an outline of the board with its USB-C connector and LEDs.
const CAMERA_AZIMUTH = (-135 * Math.PI) / 180;
const CAMERA_ELEVATION = (30 * Math.PI) / 180;
const AXIS_NAMES = ["X", "Y", "Z"];

// The board is drawn in mm, scaled so its 21 mm length spans 1.8 axis lengths.
const AXIS_LENGTHS_PER_MM = 0.9 / 10.5;

// A rounded rectangle centred on the origin: half-sizes a x b and corner radius r in mm, each
// corner a quarter arc of a few points, placed in the IMU frame by place(u, v) -> [x, y, z] mm.
function roundedRect(a, b, r, place) {
  const points = [];
  for (const [su, sv, start] of [[1, 1, 0], [-1, 1, 90], [-1, -1, 180], [1, -1, 270]]) {
    for (let step = 0; step <= 6; step++) {
      const angle = ((start + step * 15) * Math.PI) / 180;
      const point = place(su * (a - r) + r * Math.cos(angle), sv * (b - r) + r * Math.sin(angle));
      points.push(point.map((mm) => mm * AXIS_LENGTHS_PER_MM));
    }
  }
  return points;
}

// The XIAO in the IMU's x/y plane: 17.8 x 21 mm with ~2 mm corners, its long side along y. Its
// USB-C receptacle sits on top at the +y end, overhanging the edge by ~1 mm: the 8.9 x 7.3 mm
// shell's top face, 3.2 mm up, and its stadium-shaped opening facing out along +y. Seen from above
// with the port away from you, the red LED is to its left (-x) and the green to its right.
const BOARD_OUTLINE = roundedRect(8.9, 10.5, 2, (u, v) => [u, v, 0]);
const USB_SHELL_TOP = roundedRect(4.45, 3.65, 0.5, (u, v) => [u, 7.85 + v, 3.2]);
const USB_OPENING = roundedRect(4.45, 1.6, 1.6, (u, v) => [u, 11.5, 1.6 + v]);
// Corner radius = half-size makes a circle.
const RED_LED = roundedRect(0.9, 0.9, 0.9, (u, v) => [-6.4 + u, 9 + v, 0.4]);
const GREEN_LED = roundedRect(0.9, 0.9, 0.9, (u, v) => [6.4 + u, 9 + v, 0.4]);

// World point -> screen offset (right, up) plus depth (larger is farther from the camera).
function project([x, y, z]) {
  const right = x * Math.cos(CAMERA_AZIMUTH) - y * Math.sin(CAMERA_AZIMUTH);
  const away = x * Math.sin(CAMERA_AZIMUTH) + y * Math.cos(CAMERA_AZIMUTH);
  return {
    right,
    up: z * Math.cos(CAMERA_ELEVATION) + away * Math.sin(CAMERA_ELEVATION),
    depth: away * Math.cos(CAMERA_ELEVATION) - z * Math.sin(CAMERA_ELEVATION),
  };
}

function drawPose() {
  const canvas = $("pose");
  const { ctx, width, height } = fitCanvas(canvas);
  // An axis and its label reach ~1.3 lengths from the origin in any direction.
  const scale = Math.min(width, height) / 2.7;
  const toScreen = (point) => {
    const p = project(point);
    return [width / 2 + p.right * scale, height / 2 - p.up * scale];
  };
  const line = (from, to, color, lineWidth) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(...toScreen(from));
    ctx.lineTo(...toScreen(to));
    ctx.stroke();
  };

  // World frame: ENU axes (x East, y North, z Up) as labelled arrows, so tilt reads against
  // something fixed. Without a magnetometer "East" and "North" are nominal: Zero yaw sets them.
  const WORLD_AXES = [["E", [1.15, 0, 0]], ["N", [0, 1.15, 0]], ["U", [0, 0, 1.15]]];
  ctx.font = `500 11px ${colors.mono}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const [name, tip] of WORLD_AXES) {
    line([0, 0, 0], tip, colors.muted, 1);
    const [sx, sy] = toScreen(tip);
    const [fx, fy] = toScreen([0, 0, 0]);
    const angle = Math.atan2(sy - fy, sx - fx);
    ctx.fillStyle = colors.muted;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx - 8 * Math.cos(angle - 0.4), sy - 8 * Math.sin(angle - 0.4));
    ctx.lineTo(sx - 8 * Math.cos(angle + 0.4), sy - 8 * Math.sin(angle + 0.4));
    ctx.closePath();
    ctx.fill();
    const [lx, ly] = toScreen(tip.map((v) => v * 1.14));
    ctx.fillText(name, lx, ly);
  }
  ctx.textAlign = "start";

  if (!selected?.quat) {
    ctx.fillStyle = colors.muted;
    ctx.font = `12px ${colors.mono}`;
    ctx.textAlign = "center";
    ctx.fillText(selected ? "Waiting for the IMU…" : "Add a board to see orientation", width / 2, height - 14);
    ctx.textAlign = "start";
    return;
  }
  const q = removeYaw(selected.quat, headingChangeDegrees(IDENTITY_QUAT, selected.yawZero));

  const shape = (points, fill, fillAlpha, lineWidth) => {
    ctx.beginPath();
    points.map((point) => toScreen(rotateVector(q, point))).forEach(([sx, sy], i) => (i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy)));
    ctx.closePath();
    ctx.globalAlpha = fillAlpha;
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = colors.board;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  };
  // The opening faces +y: when that points away from the camera, the shell hides it.
  const openingFacesCamera = project(rotateVector(q, [0, 1, 0])).depth < 0;
  shape(BOARD_OUTLINE, colors.board, 0.18, 1.5);
  shape(RED_LED, colors.ledRed, 1, 0.5);
  shape(GREEN_LED, colors.ledGreen, 1, 0.5);
  if (!openingFacesCamera) shape(USB_OPENING, colors.screen, 1, 1);
  shape(USB_SHELL_TOP, colors.board, 0.45, 1);
  if (openingFacesCamera) shape(USB_OPENING, colors.screen, 1, 1);

  // Farthest axis first, so nearer ones draw over it.
  const tips = AXIS_NAMES.map((name, i) => {
    const unit = [0, 0, 0];
    unit[i] = 1;
    const tip = rotateVector(q, unit);
    return { name, color: colors.series[i], tip, depth: project(tip).depth };
  }).sort((a, b) => b.depth - a.depth);

  ctx.font = `500 12px ${colors.mono}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const { name, color, tip } of tips) {
    line([0, 0, 0], tip, color, 2);
    const [sx, sy] = toScreen(tip);
    ctx.beginPath();
    ctx.arc(sx, sy, 4, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = colors.screen;
    ctx.stroke();
    const [lx, ly] = toScreen(tip.map((v) => v * 1.22));
    ctx.fillStyle = colors.text;
    ctx.fillText(name, lx, ly);
  }
  ctx.textAlign = "start";
}

function renderAngles() {
  const quat = selected?.quat;
  $("at-rest").classList.toggle("on", Boolean(selected?.atRest));
  if (!quat) {
    for (const name of ["roll", "pitch", "yaw"]) $(name).textContent = "–";
    return;
  }
  // Roll and pitch come from gravity alone. Yaw is the turn about world up since Zero yaw, not
  // Euler yaw, which a tiny tilt swamps near pitch ±90° (see headingChangeDegrees).
  const { roll, pitch } = quatToEulerDegrees(quat);
  const yaw = headingChangeDegrees(selected.yawZero, quat);
  for (const [name, deg] of Object.entries({ roll, pitch, yaw })) $(name).textContent = `${deg.toFixed(1)}°`;
}

$("zero-yaw").addEventListener("click", () => selected?.zeroYaw());

// ---- traces -------------------------------------------------------------------------------
// The last ~4 s of each IMU sensor (every DISPLAY_DECIMATION-th sample). The vertical range steps
// through `ladder` to fit the biggest value on screen, so it widens on a flick and narrows again
// once the flick scrolls out.
const TRACE_PAD_Y = 8;
function makeTrace(name, ladder, decimals) {
  const canvas = $(`${name}-trace`);
  return { name, canvas, tip: $(`${name}-tip`), hover: trackHover(canvas), ladder, decimals, range: ladder[0] };
}
const traces = {
  gyro: makeTrace("gyro", [250, 500, 1000, 2000], 1),
  accel: makeTrace("accel", [2, 4, 8, 16], 2),
};

function drawTrace(trace, samples) {
  const { canvas } = trace;
  const range = pickRange(peakOf(samples), trace.ladder);
  if (range !== trace.range) {
    trace.range = range;
    $(`${trace.name}-range`).textContent = `±${range}`;
  }
  const { ctx, width, height } = fitCanvas(canvas);
  const plotHeight = height - 2 * TRACE_PAD_Y;
  const toY = (value) => TRACE_PAD_Y + plotHeight / 2 - (Math.max(-1, Math.min(1, value / range)) * plotHeight) / 2;
  // The newest sample sits at the right edge, so a partly filled trace grows in from the right.
  const toX = (i) => ((i + TRACE_POINTS - samples.length) / (TRACE_POINTS - 1)) * width;

  ctx.font = `11px ${colors.mono}`;
  ctx.textBaseline = "middle";
  // Scope graticule: a division every 0.5 s and at half range.
  for (let i = 1; i < 8; i++) hairline(ctx, (i / 8) * width, 0, (i / 8) * width, height, colors.grid);
  for (const value of [range / 2, -range / 2]) hairline(ctx, 0, toY(value), width, toY(value), colors.grid);
  for (const value of [range, 0, -range]) {
    hairline(ctx, 0, toY(value), width, toY(value), value === 0 ? colors.line : colors.grid);
    ctx.fillStyle = colors.muted;
    ctx.fillText(value > 0 ? `+${value}` : `${value}`, 4, toY(value) + (value > 0 ? 8 : -8));
  }

  colors.series.forEach((color, axis) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = ctx.lineCap = "round";
    ctx.beginPath();
    samples.forEach((point, i) => (i ? ctx.lineTo(toX(i), toY(point[axis])) : ctx.moveTo(toX(i), toY(point[axis]))));
    ctx.stroke();
  });

  const { tip, hover } = trace;
  const index = hover.fraction === null ? -1 : Math.round(hover.fraction * (TRACE_POINTS - 1)) - (TRACE_POINTS - samples.length);
  if (index < 0 || index >= samples.length) {
    tip.hidden = true;
    return;
  }
  const x = toX(index);
  const point = samples[index];
  hairline(ctx, x, 0, x, height, colors.muted);
  colors.series.forEach((color, axis) => {
    ctx.beginPath();
    ctx.arc(x, toY(point[axis]), 4, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = colors.screen;
    ctx.stroke();
  });
  const displayRateHz = (selected?.info?.imuRateHz ?? 208) / DISPLAY_DECIMATION;
  const secondsAgo = (samples.length - 1 - index) / displayRateHz;
  showTooltip(tip, canvas, x / width, secondsAgo ? `${secondsAgo.toFixed(2)} s ago` : "now",
    AXIS_NAMES.map((name, axis) => [point[axis].toFixed(trace.decimals), name, colors.series[axis]]));
}

function renderLive() {
  const temperature = selected?.temperatureC;
  $("imu-temp").textContent = Number.isFinite(temperature) ? ` · IMU ${temperature.toFixed(1)} °C` : "";
  const g = selected?.gyro.at(-1);
  const a = selected?.accel.at(-1);
  setLive($("gyro-live"), g ?? [NaN, NaN, NaN], 1);
  setLive($("accel-live"), a ? [...a, Math.hypot(...a)] : [NaN, NaN, NaN, NaN], 2);
}

// ---- microphone ---------------------------------------------------------------------------
// The board's 1 ms peak envelope over the last 4 s, as a dBFS bar graph (one bar per pixel
// column, the loudest window in it), with the claps it heard as orange lines.
const envelopeHover = trackHover($("envelope"));

function drawEnvelope() {
  const canvas = $("envelope");
  const { ctx, width, height } = fitCanvas(canvas);
  const toY = (dbfs) => height - meterFraction(dbfs, ENVELOPE_FLOOR_DBFS) * height;

  ctx.font = `11px ${colors.mono}`;
  ctx.textBaseline = "middle";
  for (let i = 1; i < ENVELOPE_SECONDS * 2; i++) {
    const x = (i / (ENVELOPE_SECONDS * 2)) * width;
    hairline(ctx, x, 0, x, height, colors.grid);
  }
  for (const dbfs of [-20, -40, -60]) hairline(ctx, 0, toY(dbfs), width, toY(dbfs), colors.grid);
  // Drawn last, over the bars, so a noisy room doesn't hide them.
  const drawScale = () => {
    for (const dbfs of [-20, -40, -60]) {
      ctx.fillStyle = colors.muted;
      ctx.fillText(`${dbfs}`, 4, toY(dbfs) - 7);
    }
  };

  const tip = $("envelope-tip");
  const board = selected;
  if (!board?.info || !board.envelope.length) {
    drawScale();
    tip.hidden = true;
    return;
  }
  const windowUs = (1e6 * board.info.envelopeWindowSamples) / board.info.micRateHz;
  const slots = Math.round((ENVELOPE_SECONDS * 1e6) / windowUs);
  const peaks = board.envelope;
  const columns = Math.max(1, Math.floor(width));
  const perColumn = slots / columns;
  const offset = slots - peaks.length; // a partly filled envelope grows in from the right
  const columnPeak = (column) => {
    let peak = 0;
    const from = Math.max(0, Math.floor(column * perColumn) - offset);
    const to = Math.min(peaks.length, Math.floor((column + 1) * perColumn) - offset);
    for (let i = from; i < to; i++) peak = Math.max(peak, peaks[i]);
    return peak;
  };

  ctx.fillStyle = colors.readout;
  for (let x = 0; x < columns; x++) {
    const top = toY(peakToDbfs(columnPeak(x)));
    if (top < height) ctx.fillRect(x, top, 1, height - top);
  }

  const startUs = board.envelopeEndUs - ENVELOPE_SECONDS * 1e6;
  ctx.strokeStyle = colors.signal;
  ctx.fillStyle = colors.signal;
  ctx.lineWidth = 2;
  for (const mark of board.marks) {
    if (mark.tUs < startUs) continue;
    const x = ((mark.tUs - startUs) / (ENVELOPE_SECONDS * 1e6)) * width;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 5, 0);
    ctx.lineTo(x + 5, 0);
    ctx.lineTo(x, 7);
    ctx.closePath();
    ctx.fill();
  }

  drawScale();
  if (envelopeHover.fraction === null) {
    tip.hidden = true;
    return;
  }
  const column = Math.min(columns - 1, Math.floor(envelopeHover.fraction * columns));
  hairline(ctx, column, 0, column, height, colors.muted);
  const dbfs = peakToDbfs(columnPeak(column));
  const secondsAgo = ENVELOPE_SECONDS * (1 - column / columns);
  showTooltip(tip, canvas, column / width, `${secondsAgo.toFixed(2)} s ago`,
    [[Number.isFinite(dbfs) ? `${dbfs.toFixed(1)}` : "–∞", "dBFS peak"]]);
}

// The board's spectrum frames (64 ms each) on the same 4 s as the level above, so a clap's spike
// sits over its stripe: 0 Hz at the bottom to 8 kHz at the top, each bin lit in the readout colour
// by its level. The newest frames lag the level by a frame or two, the time they take to arrive.
const SPECTRUM_DIM_DBFS = -110;
const SPECTRUM_BRIGHT_DBFS = -50;
const spectrumHover = trackHover($("spectrum"));
// One pixel per frame and bin, stretched over the plot.
const spectrumImage = document.createElement("canvas");

function paintSpectrumImage(frames) {
  const bins = frames[0].levels.length;
  if (spectrumImage.width !== frames.length || spectrumImage.height !== bins) {
    spectrumImage.width = frames.length;
    spectrumImage.height = bins;
  }
  const image = spectrumImage.getContext("2d");
  const pixels = image.createImageData(frames.length, bins);
  frames.forEach(({ levels }, x) => {
    for (let b = 0; b < bins; b++) {
      const at = ((bins - 1 - b) * frames.length + x) * 4;
      pixels.data.fill(255, at, at + 3);
      pixels.data[at + 3] = Math.round(levelFraction(levels[b], SPECTRUM_DIM_DBFS, SPECTRUM_BRIGHT_DBFS) * 255);
    }
  });
  // Lightness as alpha, then tinted: no need to parse the theme's colour.
  image.putImageData(pixels, 0, 0);
  image.globalCompositeOperation = "source-in";
  image.fillStyle = colors.readout;
  image.fillRect(0, 0, frames.length, bins);
  image.globalCompositeOperation = "source-over";
}

function drawSpectrum() {
  const canvas = $("spectrum");
  const { ctx, width, height } = fitCanvas(canvas);
  const board = selected;
  const frames = board?.spectrum ?? [];
  const nyquistHz = (board?.info?.micRateHz ?? 16000) / 2;
  const toY = (hz) => height - (hz / nyquistHz) * height;
  const tip = $("spectrum-tip");

  if (frames.length) {
    paintSpectrumImage(frames);
    const endUs = board.envelopeEndUs ?? frames.at(-1).tUs + board.spectrumFrameUs;
    const startUs = endUs - ENVELOPE_SECONDS * 1e6;
    const toX = (tUs) => Math.round(((tUs - startUs) / (ENVELOPE_SECONDS * 1e6)) * width);
    ctx.imageSmoothingEnabled = false;
    frames.forEach(({ tUs }, x) => {
      const left = toX(tUs);
      const right = toX(tUs + board.spectrumFrameUs);
      if (right > left) ctx.drawImage(spectrumImage, x, 0, 1, frames[0].levels.length, left, 0, right - left, height);
    });
  }

  ctx.font = `11px ${colors.mono}`;
  ctx.textBaseline = "middle";
  for (let i = 1; i < ENVELOPE_SECONDS * 2; i++) {
    const x = (i / (ENVELOPE_SECONDS * 2)) * width;
    hairline(ctx, x, 0, x, height, colors.grid);
  }
  for (const khz of [2, 4, 6]) {
    hairline(ctx, 0, toY(khz * 1000), width, toY(khz * 1000), colors.grid);
    ctx.fillStyle = colors.muted;
    ctx.fillText(`${khz}k`, 4, toY(khz * 1000) - 7);
  }

  if (!frames.length || spectrumHover.fraction === null) {
    tip.hidden = true;
    return;
  }
  const endUs = board.envelopeEndUs ?? frames.at(-1).tUs + board.spectrumFrameUs;
  const hoverUs = endUs - ENVELOPE_SECONDS * 1e6 * (1 - spectrumHover.fraction);
  const frame = frames.find(({ tUs }) => hoverUs >= tUs && hoverUs < tUs + board.spectrumFrameUs);
  if (!frame) {
    tip.hidden = true;
    return;
  }
  const bins = frame.levels.length;
  const bin = Math.min(bins - 1, Math.floor((1 - spectrumHover.fractionY) * bins));
  const x = spectrumHover.fraction * width;
  const y = spectrumHover.fractionY * height;
  hairline(ctx, x, 0, x, height, colors.muted);
  hairline(ctx, 0, y, width, y, colors.muted);
  const secondsAgo = (endUs - hoverUs) / 1e6;
  const level = frame.levels[bin];
  showTooltip(tip, canvas, spectrumHover.fraction, `${secondsAgo.toFixed(2)} s ago`, [
    [((bin * nyquistHz) / bins / 1000).toFixed(2), "kHz"],
    [level > -127.5 ? level.toFixed(1) : "floor", "dBFS"],
  ]);
}

function renderMic() {
  const board = selected;
  const levelDbfs = board ? peakToDbfs(recentPeak(board.envelope, 100)) : -Infinity;
  $("mic-level").textContent = board?.envelope.length ? `${Number.isFinite(levelDbfs) ? levelDbfs.toFixed(1) : "–∞"} dBFS` : "–";
  const lit = Boolean(board?.lastMarkHostMs && performance.timeOrigin + performance.now() - board.lastMarkHostMs < MARK_LAMP_MS);
  $("mark-lamp").classList.toggle("on", lit);
  $("mark-count").textContent = !board?.markCount ? "No claps yet" : `${board.markCount} clap${board.markCount === 1 ? "" : "s"} heard`;
  $("spectrum-peak").textContent = spectrumSummary(board);
}

// The loudest frequency in the newest frame, above the lowest bin (what's left of the DC offset).
function spectrumSummary(board) {
  if (board?.connected && !board.hasSpectrum) return "Update this board's firmware to see it";
  const levels = board?.spectrum.at(-1)?.levels;
  if (!levels) return "–";
  const bin = loudestIndex(levels, 1);
  const khz = (bin * board.info.micRateHz) / (2 * levels.length) / 1000;
  return `loudest ${khz.toFixed(2)} kHz · ${levels[bin].toFixed(0)} dBFS`;
}

function drawFrame() {
  // The live panels are hidden while the Replay view is up.
  if (mainEl.hidden) {
    requestAnimationFrame(drawFrame);
    return;
  }
  drawTrace(traces.gyro, selected?.gyro ?? []);
  drawTrace(traces.accel, selected?.accel ?? []);
  drawPose();
  drawEnvelope();
  drawSpectrum();
  renderLive();
  renderAngles();
  renderMic();
  requestAnimationFrame(drawFrame);
}
requestAnimationFrame(drawFrame);

// ---- board list ---------------------------------------------------------------------------
function setStatus(text, { bad = false } = {}) {
  $("status").textContent = text;
  $("status").classList.toggle("bad", bad);
}

function connectedSummary() {
  const count = [...boards.values()].filter((board) => board.connected).length;
  $("link-dot").classList.toggle("on", count > 0);
  $("board-count").textContent = count ? `${count} connected` : "";
  return count;
}

function buildRow(board) {
  const row = document.createElement("tr");
  row.innerHTML = `
    <td class="num name"></td>
    <td><input type="text" placeholder="label" aria-label="Board label"></td>
    <td class="num battery"></td>
    <td class="num imu"></td>
    <td class="num"><span class="bar"><i style="left:0;width:0"></i></span><span class="level"></span></td>
    <td class="num marks"></td>
    <td class="num flash"></td>
    <td class="num fw"></td>
    <td><span class="chip user-lamp" title="Lit while USER is held" aria-label="USER button"></span></td>
    <td class="actions"><button type="button" class="sleep" title="Sleep (press USER on the board to wake it)" aria-label="Sleep">⏾</button><button type="button" class="drop" title="Disconnect" aria-label="Disconnect">✕</button></td>`;
  const input = row.querySelector("input");
  input.value = board.label;
  input.addEventListener("click", (event) => event.stopPropagation());
  input.addEventListener("change", () => board.setLabel(input.value));
  row.querySelector(".drop").addEventListener("click", (event) => {
    event.stopPropagation();
    board.disconnect();
  });
  row.querySelector(".sleep").addEventListener("click", (event) => {
    event.stopPropagation();
    if (confirm(`Put ${board.displayName} to sleep? Press its USER button to wake it.`)) sleepBoards([board]);
  });
  row.addEventListener("click", () => select(board));
  board.row = row;
  $("boards").append(row);
}

function renderBoardRow(board) {
  if (!board.row) buildRow(board);
  const { row } = board;
  row.classList.toggle("selected", board === selected);
  row.querySelector(".name").textContent = board.boardId;
  const input = row.querySelector("input");
  if (document.activeElement !== input && input.value !== board.label) input.value = board.label;
  const lost = board.imuGaps ? ` · ${board.imuGaps} lost` : "";
  row.querySelector(".imu").textContent = `${board.rateHz} Hz${lost}`;
  const dbfs = peakToDbfs(recentPeak(board.envelope, 100));
  row.querySelector(".bar i").style.width = `${meterFraction(dbfs, ENVELOPE_FLOOR_DBFS) * 100}%`;
  row.querySelector(".level").textContent = Number.isFinite(dbfs) ? `${dbfs.toFixed(0)}` : "–∞";
  const ago = board.lastMarkHostMs ? ` · ${Math.round((performance.timeOrigin + performance.now() - board.lastMarkHostMs) / 1000)} s ago` : "";
  row.querySelector(".marks").textContent = `${board.markCount}${ago}`;
  const userLit = board.userPressed || performance.timeOrigin + performance.now() - board.userPressHostMs < USER_LAMP_MIN_MS;
  row.querySelector(".user-lamp").classList.toggle("on", userLit);
  const led = ledDisplayColor(board.led);
  if (led) row.style.setProperty("--led", led);
  else row.style.removeProperty("--led");
  row.querySelector(".flash").textContent = flashSummary(board);
  const job = firmwareJobs.get(board.key);
  row.querySelector(".fw").textContent = job?.stage === "uploading" ? `↑ ${Math.round(job.progress * 100)}%` : board.firmwareVersion || "–";
  const battery = row.querySelector(".battery");
  battery.textContent = batterySummary(board.battery);
  battery.title = batteryDetail(board.battery);
  battery.classList.toggle("bad-text", Boolean(board.battery && (board.battery.state === "fault" ||
    (board.battery.state === "discharging" && board.battery.percent !== null && board.battery.percent <= 15))));
  row.querySelector(".sleep").disabled = !board.chars.power;
}

// The battery at a glance: charge (estimated from voltage) and what it's doing.
function batterySummary(battery) {
  if (!battery) return "–";
  switch (battery.state) {
    case "absent": return "USB, no battery";
    case "fault": return "charger fault";
    case "charging": return `${battery.percent}% ⚡`;
    case "charged": return "charged";
    default: return battery.hoursLeft !== null ? `${battery.percent}% · ~${battery.hoursLeft} h` : `${battery.percent}%`;
  }
}

function batteryDetail(battery) {
  if (!battery) return "This firmware doesn't report the battery.";
  const parts = [`${battery.volts.toFixed(3)} V`, `${battery.currentMa > 0 ? "+" : ""}${battery.currentMa.toFixed(1)} mA`];
  if (battery.tempC !== null) parts.push(`${battery.tempC.toFixed(1)} °C`);
  return parts.join(" · ");
}

async function sleepBoards(list) {
  const results = await Promise.allSettled(list.map((board) => board.sleep()));
  const failed = results.filter((result) => result.status === "rejected").length;
  setStatus(failed ? `${failed} board(s) didn't take the sleep command` : `Sleeping ${list.length} board${list.length === 1 ? "" : "s"}: press USER to wake`, { bad: failed > 0 });
}

$("sleep-all").addEventListener("click", () => {
  const list = [...boards.values()].filter((board) => board.connected && board.chars.power);
  if (list.length && confirm(`Put all ${list.length} connected board${list.length === 1 ? "" : "s"} to sleep? Press each one's USER button to wake it.`)) sleepBoards(list);
});

// The board's flash at a glance: what it's doing and how full it is.
function flashSummary(board) {
  const log = board.log;
  if (!log) return "–";
  const used = `${((100 * log.usedBytes) / log.capacityBytes).toFixed(log.usedBytes ? 1 : 0)}%`;
  const time = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  switch (log.state) {
    case "recording": return `rec ${time(log.recordingS)} · ${used}`;
    case "reading": return board.downloadProgress != null ? `upload ${Math.round(board.downloadProgress * 100)}%` : "reading";
    case "erasing": return "erasing…";
    case "full": return "full";
    case "error": return `${used} · error ${log.error}`;
    default: return used;
  }
}

function renderBoards() {
  for (const board of boards.values()) renderBoardRow(board);
  const count = connectedSummary();
  $("boards-hint").hidden = count > 1;
  $("sleep-all").hidden = count === 0;
  $("settings-board").textContent = selected ? `· ${selected.displayName}` : "";
  renderRecorder();
  renderFirmware();
  renderImuRanges();
}
setInterval(renderBoards, 250);

setInterval(() => {
  for (const board of boards.values()) board.tick();
}, 1000);

function select(board) {
  selected = board;
  renderBoards();
  renderChecks();
  renderMouse();
  renderLatency();
}

async function addBoard() {
  if (!navigator.bluetooth) {
    // Chrome hides Web Bluetooth outside a secure context, so a LAN address (http://192.168...) has none.
    const reason = isSecureContext
      ? "Web Bluetooth isn't available here. Use Chrome or Edge (on Android: Chrome)."
      : "Web Bluetooth needs https or localhost. On a phone, see docs/dashboard.md.";
    setStatus(reason, { bad: true });
    return;
  }
  let device;
  try {
    setStatus("Choose a board in the browser prompt…");
    device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: "nrf-controller" }],
      optionalServices: [DATA_SERVICE, TELEMETRY_SERVICE, LOG_SERVICE, SMP_SERVICE, "device_information"],
    });
  } catch (error) {
    setStatus(connectedSummary() ? `${connectedSummary()} connected` : `No board chosen (${error.message})`);
    return;
  }
  if (boards.get(device.id)?.connected) {
    select(boards.get(device.id));
    setStatus(`${device.name} is already connected`);
    return;
  }
  let board;
  try {
    board = await connectDevice(device);
  } catch (error) {
    // On macOS, Chrome's picker first shows the Mac's saved record of a board it has bonded with,
    // which it can't open over GATT; the board as scanned replaces it a moment later and works.
    const hint = /unsupported device/i.test(error.message)
      ? `Couldn't connect to ${device.name}: that was the Mac's saved record of it. Add board again and wait a moment before picking it`
      : `Couldn't connect: ${error.message}`;
    setStatus(hint, { bad: true });
    return;
  }
  setStatus(`Connected to ${board.displayName}`);
  select(board);
}
$("connect").addEventListener("click", addBoard);

/** Connects to a board the browser already knows (picked once, or back after a firmware update). */
async function connectDevice(device, onStatus = setStatus) {
  boards.get(device.id)?.row?.remove();
  const board = new Board(device);
  board.addEventListener("seen", () => board === selected && renderChecks());
  board.addEventListener("change", () => {
    if (board !== selected) return;
    renderMouse();
    renderLatency();
  });
  board.addEventListener("press", renderBoards);
  board.addEventListener("disconnected", () => onDisconnected(board));
  boards.set(device.id, board);
  try {
    await board.connect(onStatus);
  } catch (error) {
    if (boards.get(device.id) === board) boards.delete(device.id);
    board.row?.remove();
    // Also abandons a connection attempt still in progress.
    device.gatt.disconnect();
    throw error;
  }
  return board;
}

function onDisconnected(board) {
  if (boards.get(board.key) !== board) return;
  boards.delete(board.key);
  board.row?.remove();
  const job = firmwareJobs.get(board.key);
  if (job?.stage === "restarting") setStatus(`${board.displayName} restarting into v${job.version}…`);
  else setStatus(`${board.displayName} disconnected`, { bad: recorder.active && recorder.members.includes(board) });
  if (board === selected) select(boards.values().next().value ?? null);
  else renderBoards();
}

// ---- recording ----------------------------------------------------------------------------
// Local date and time, sortable: 2026-09-30_14-05-09.
function timestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

$("session").value = timestamp();

$("pick-folder").addEventListener("click", async () => {
  if (!window.showDirectoryPicker) {
    $("folder").textContent = "This browser can't write folders; files will download instead.";
    return;
  }
  try {
    recorder.dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    $("folder").textContent = `Saving into ${recorder.dirHandle.name}/<session>/`;
  } catch {
    /* picker dismissed */
  }
});

// A board's folder in the session: its label (if any) and ID, so it is unique and recognisable.
const boardFolder = (board) => safeName(board.label ? `${board.label}_${board.boardId}` : board.boardId);

// Where Record goes: this computer (live, over Bluetooth) or each board's flash. Remembered here.
const targetInputs = () => [...document.querySelectorAll('input[name="rec-target"]')];
const recordTarget = () => targetInputs().find((input) => input.checked)?.value ?? "live";
try {
  const saved = localStorage.getItem("rec-target");
  targetInputs().forEach((input) => (input.checked = input.value === (saved ?? "live")));
} catch {
  /* storage blocked: start on this computer */
}
targetInputs().forEach((input) =>
  input.addEventListener("change", () => {
    try {
      localStorage.setItem("rec-target", recordTarget());
    } catch {
      /* storage blocked: the choice lasts for this page load */
    }
    renderRecorder();
  }));

const flashBoards = () => [...boards.values()].filter((board) => board.connected && board.log);
const flashBusy = { upload: false, erase: false };

function renderRecorder() {
  const flash = recordTarget() === "flash";
  targetInputs().forEach((input) => (input.disabled = recorder.active));
  $("session-label").hidden = flash;
  $("flash-hint").hidden = !flash;
  $("upload").hidden = $("erase").hidden = !flash;
  if (flash) {
    renderFlashRecorder();
    return;
  }
  const connected = [...boards.values()].filter((board) => board.connected && board.info);
  $("record").disabled = !recorder.active && connected.length === 0;
  $("record").textContent = recorder.active ? "Stop" : "Record";
  $("record").classList.toggle("recording", recorder.active);
  $("session").disabled = recorder.active;
  if (!recorder.active) {
    if (!connected.length) $("rec-status").textContent = "Connect a board first.";
    return;
  }
  const seconds = Math.floor((Date.now() - recorder.startedAt.getTime()) / 1000);
  $("rec-elapsed").textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  $("rec-boards").innerHTML = "";
  for (const board of recorder.members) {
    const counts = board.recording?.counts;
    const item = document.createElement("li");
    item.textContent = counts
      ? `${board.displayName}: ${counts.imuSamples} samples · ${counts.syncMarks} claps · ${counts.buttonEvents} button edges`
      : `${board.displayName}: disconnected`;
    if (!board.connected) item.className = "bad-text";
    $("rec-boards").append(item);
  }
}

function startRecording() {
  const members = [...boards.values()].filter((board) => board.connected && board.info);
  const name = safeName($("session").value || timestamp());
  $("session").value = name;
  recorder.active = true;
  recorder.startedAt = new Date();
  recorder.members = members;
  for (const board of members) board.startRecording();
  $("rec-status").textContent = `Recording ${members.length} board${members.length === 1 ? "" : "s"}: clap 2–3 times near all of them now.`;
  renderRecorder();
}

async function writeFile(directory, name, data) {
  const writable = await (await directory.getFileHandle(name, { create: true })).createWritable();
  await writable.write(data);
  await writable.close();
}

function download(name, data, type = "text/csv") {
  const link = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([data], { type })), download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10000);
}

async function stopRecording() {
  recorder.active = false;
  const stoppedAt = new Date();
  const session = $("session").value;
  const results = [];
  for (const board of recorder.members) {
    const result = board.stopRecording();
    if (!result) continue;
    if (board.connected) {
      try {
        await board.refreshInfo();
      } catch {
        /* keep the counts from connect */
      }
    }
    results.push({ board, ...result });
  }
  $("rec-elapsed").textContent = "";
  $("rec-status").textContent = "Saving…";

  const manifest = {
    session,
    started: recorder.startedAt.toISOString(),
    stopped: stoppedAt.toISOString(),
    format: "docs/data-collection.md",
    boards: results.map(({ board, recording, gaps }) => ({
      folder: boardFolder(board),
      board_id: board.boardId,
      name: `nrf-controller-${board.boardId}`,
      label: board.label,
      firmware: board.firmwareVersion,
      imu_rate_hz: board.info.imuRateHz,
      gyro_dps_per_lsb: Math.round(board.info.gyroDpsPerLsb * 1e9) / 1e9,
      accel_g_per_lsb: Math.round(board.info.accelGPerLsb * 1e9) / 1e9,
      mic_rate_hz: board.info.micRateHz,
      envelope_window_samples: board.info.envelopeWindowSamples,
      counts: recording.counts,
      lost_in_recording: gaps,
      imu_dropped_on_board_since_boot: board.info.imuDropped,
    })),
  };

  try {
    if (recorder.dirHandle) {
      const sessionDir = await recorder.dirHandle.getDirectoryHandle(session, { create: true });
      for (const { board, recording } of results) {
        const boardDir = await sessionDir.getDirectoryHandle(boardFolder(board), { create: true });
        for (const [name, text] of Object.entries(recording.files())) await writeFile(boardDir, name, text);
      }
      await writeFile(sessionDir, "session.json", JSON.stringify(manifest, null, 2) + "\n");
    } else {
      for (const { board, recording } of results) {
        for (const [name, text] of Object.entries(recording.files())) download(`${session}__${boardFolder(board)}__${name}`, text);
      }
      download(`${session}__session.json`, JSON.stringify(manifest, null, 2) + "\n", "application/json");
    }
  } catch (error) {
    $("rec-status").textContent = `Save failed: ${error.message}`;
    $("rec-status").className = "bad-text";
    return;
  }

  const fewClaps = results.filter(({ recording }) => recording.counts.syncMarks < 2).map(({ board }) => board.displayName);
  const where = recorder.dirHandle ? `${recorder.dirHandle.name}/${session}/` : "your downloads";
  $("rec-status").className = fewClaps.length ? "bad-text" : "muted";
  $("rec-status").textContent = fewClaps.length
    ? `Saved to ${where}, but ${fewClaps.join(", ")} heard fewer than 2 claps: too few to line up ${fewClaps.length === 1 ? "its clock" : "their clocks"} with the others.`
    : `Saved ${results.length} board${results.length === 1 ? "" : "s"} to ${where}. Open it in Replay to check it.`;
  $("session").value = timestamp();
  renderRecorder();
}

$("record").addEventListener("click", () => {
  if (recordTarget() === "flash") flashRecordingActive() ? stopFlash() : startFlash();
  else recorder.active ? stopRecording() : startRecording();
});

// ---- recording to the boards' flash ------------------------------------------------------
const flashRecordingActive = () => flashBoards().some((board) => board.log.state === "recording");

function renderFlashRecorder() {
  const list = flashBoards();
  const active = flashRecordingActive();
  const busy = flashBusy.upload || flashBusy.erase;
  $("record").disabled = !list.length || busy;
  $("record").textContent = active ? "Stop" : "Record";
  $("record").classList.toggle("recording", active);
  $("upload").disabled = active || busy || !list.some((board) => board.log.usedBytes > 0);
  $("erase").disabled = active || busy || !list.length;
  $("rec-elapsed").textContent = "";
  const noBoardText = ["Connect a board first.", "These boards' firmware can't record on its own. Flash the current build."];
  if (!list.length && !busy) {
    const old = [...boards.values()].some((board) => board.connected && !board.log);
    $("rec-status").textContent = noBoardText[old ? 1 : 0];
  } else if (noBoardText.includes($("rec-status").textContent)) {
    // A board's flash service attaches a moment after it connects, so either message may be stale.
    $("rec-status").textContent = "Ready.";
  }
  $("rec-boards").innerHTML = "";
  for (const board of list) {
    const log = board.log;
    const item = document.createElement("li");
    const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;
    item.textContent = `${board.displayName}: ${flashSummary(board)} · ${kb(log.usedBytes)} of ${(log.capacityBytes / 1048576).toFixed(0)} MB` +
      (log.droppedBytes ? ` · ${log.droppedBytes} bytes dropped` : "");
    if (log.state === "error" || log.droppedBytes) item.className = "bad-text";
    $("rec-boards").append(item);
  }
}

async function forEachFlashBoard(action, verb) {
  const list = flashBoards();
  const results = await Promise.allSettled(list.map((board) => action(board)));
  const failed = results.flatMap((result, i) => (result.status === "rejected" ? [`${list[i].displayName} (${result.reason.message})`] : []));
  if (failed.length) {
    $("rec-status").textContent = `Couldn't ${verb}: ${failed.join(", ")}`;
    $("rec-status").className = "bad-text";
  }
  return failed.length === 0;
}

async function startFlash() {
  // One tag for every board started together, so uploads group into one session: the start time.
  const tag = Math.floor(Date.now() / 1000);
  $("rec-status").className = "muted";
  if (await forEachFlashBoard((board) => board.logStart(tag, Date.now()), "start")) {
    $("rec-status").textContent = "Recording on the boards: clap 2–3 times near all of them now. You can disconnect; they carry on.";
  }
}

async function stopFlash() {
  $("rec-status").className = "muted";
  const recording = flashBoards().filter((board) => board.log.state === "recording");
  const results = await Promise.allSettled(recording.map((board) => board.logStop()));
  const failed = results.filter((result) => result.status === "rejected").length;
  $("rec-status").textContent = failed ? `${failed} board(s) didn't stop; try again.` : "Stopped. Upload when you're ready; the recordings stay on the boards until erased.";
}

$("erase").addEventListener("click", async () => {
  const list = flashBoards();
  if (!confirm(`Erase the recordings on ${list.length} board${list.length === 1 ? "" : "s"}? Upload them first: this can't be undone.`)) return;
  flashBusy.erase = true;
  $("rec-status").className = "muted";
  $("rec-status").textContent = "Erasing (up to a minute)…";
  const ok = await forEachFlashBoard((board) => board.logErase(), "erase");
  flashBusy.erase = false;
  if (ok) $("rec-status").textContent = "Erasing on the boards; each shows 0% when done.";
});

$("upload").addEventListener("click", uploadFlash);

async function uploadFlash() {
  const list = flashBoards().filter((board) => board.log.usedBytes > 0);
  flashBusy.upload = true;
  $("rec-status").className = "muted";
  $("rec-status").textContent = `Uploading from ${list.length} board${list.length === 1 ? "" : "s"}…`;
  const started = Date.now();
  const results = await Promise.allSettled(list.map(async (board) => {
    board.downloadProgress = 0;
    try {
      const bytes = await board.logDownload((fraction) => (board.downloadProgress = fraction));
      return { board, bytes, ...decodeFlashLog(bytes) };
    } finally {
      board.downloadProgress = null;
    }
  }));
  flashBusy.upload = false;

  const uploaded = results.filter((result) => result.status === "fulfilled").map((result) => result.value);
  const failed = results.flatMap((result, i) => (result.status === "rejected" ? [`${list[i].displayName} (${result.reason.message})`] : []));
  try {
    const written = await saveFlashUploads(uploaded);
    const seconds = Math.round((Date.now() - started) / 1000);
    const problems = uploaded.flatMap(({ board, problems }) => problems.map((problem) => `${board.displayName}: ${problem}`));
    $("rec-status").className = failed.length || problems.length ? "bad-text" : "muted";
    $("rec-status").textContent = [
      `Saved ${written.length} session${written.length === 1 ? "" : "s"} (${written.join(", ")}) in ${seconds} s.`,
      failed.length ? `Failed: ${failed.join(", ")}.` : "",
      problems.length ? `Damaged data skipped: ${problems.join("; ")}.` : "",
      written.length ? "Open it in Replay to check it." : "",
    ].filter(Boolean).join(" ");
  } catch (error) {
    $("rec-status").className = "bad-text";
    $("rec-status").textContent = `Save failed: ${error.message}`;
  }
}

/** Writes each recording session (boards grouped by start) as a session folder. Returns names. */
async function saveFlashUploads(uploaded) {
  const groups = groupSessions(uploaded.map(({ board, sessions }) => ({ board, sessions })));
  const stamp = timestamp();
  for (const group of groups) {
    const manifest = {
      session: group.name,
      source: "flash",
      format: "docs/data-collection.md",
      uploaded: new Date().toISOString(),
      boards: group.boards.map(({ board, session }) => ({
        folder: boardFolder(board),
        board_id: session.start.boardId,
        name: `nrf-controller-${session.start.boardId}`,
        label: board.label,
        firmware: board.firmwareVersion,
        session_tag: session.start.sessionTag,
        host_epoch_ms: session.start.hostEpochMs,
        start_us: session.start.startUs,
        imu_rate_hz: session.start.imuRateHz,
        gyro_dps_per_lsb: Math.round(session.start.gyroDpsPerLsb * 1e9) / 1e9,
        accel_g_per_lsb: Math.round(session.start.accelGPerLsb * 1e9) / 1e9,
        counts: {
          imuSamples: session.imu.length,
          syncMarks: session.events.filter((e) => e.type === "sync").length,
          buttonEvents: session.events.filter((e) => e.type !== "sync").length,
        },
        lost_samples: lostSamples(session),
        dropped_bytes: session.end?.droppedBytes ?? null,
        complete: Boolean(session.end),
      })),
    };
    const files = group.boards.map(({ board, session }) => [boardFolder(board), flashSessionFiles(session)]);
    await saveSession(group.name, files, manifest);
  }
  // The raw logs too, so nothing is lost if decoding ever needs redoing.
  for (const { board, bytes } of uploaded) await saveFile(["flash_raw"], `${board.boardId}_${stamp}.bin`, bytes);
  return groups.map((group) => group.name);
}

// Writes into the chosen folder (path = subfolders), or downloads with the path in the file name.
async function saveFile(path, name, data) {
  if (!recorder.dirHandle) {
    download([...path, name].join("__"), data, name.endsWith(".json") ? "application/json" : name.endsWith(".bin") ? "application/octet-stream" : "text/csv");
    return;
  }
  let directory = recorder.dirHandle;
  for (const part of path) directory = await directory.getDirectoryHandle(part, { create: true });
  await writeFile(directory, name, data);
}

async function saveSession(name, boardFiles, manifest) {
  for (const [folder, files] of boardFiles) {
    for (const [file, text] of Object.entries(files)) await saveFile([name, folder], file, text);
  }
  await saveFile([name], "session.json", JSON.stringify(manifest, null, 2) + "\n");
}

// ---- lights -------------------------------------------------------------------------------
function currentLedCommand({ off = false } = {}) {
  const hex = $("led-color").value;
  const level = off ? 0 : Number($("led-level").value) / 255;
  const channel = (offset) => parseInt(hex.slice(offset, offset + 2), 16) * level;
  return { red: channel(1), green: channel(3), blue: channel(5) };
}

async function sendLed(options) {
  if (!selected?.connected) return;
  try {
    await selected.setLed(currentLedCommand(options));
  } catch (error) {
    setStatus(`LED write failed: ${error.message}`, { bad: true });
  }
}
// "Off" is a toggle: while lights are off the button reads "On" and restores the controls' values.
let lightsOff = false;
function setLightsOff(off) {
  lightsOff = off;
  $("led-off").textContent = off ? "On" : "Off";
  $("led-off").setAttribute("aria-pressed", String(off));
}
["led-color", "led-level"].forEach((id) =>
  $(id).addEventListener("input", () => {
    setLightsOff(false); // adjusting a control means the user wants light again
    sendLed();
  }));
$("led-off").addEventListener("click", async () => {
  const off = !lightsOff;
  setLightsOff(off);
  await sendLed({ off });
});

// ---- mouse --------------------------------------------------------------------------------
// The board owns these settings (they persist in its flash); the page shows what it notifies back
// rather than what was last asked for, for the selected board.
function renderMouse() {
  const settings = selected?.mouse;
  const toggle = $("mouse-toggle");
  toggle.disabled = !settings;
  toggle.setAttribute("aria-checked", String(Boolean(settings?.enabled)));
  toggle.title = settings
    ? `${selected.displayName}'s mouse is ${settings.enabled ? "on" : "off"}: click to switch it ${settings.enabled ? "off" : "on"} (saved on the board)`
    : "Connect a board to switch its mouse on or off";
  $("mouse-speed").disabled = !settings;
  if (!settings) {
    $("mouse-status").textContent = "Switch the mouse off on boards you are only recording, so they don't move your cursor.";
    return;
  }
  if (document.activeElement !== $("mouse-speed")) {
    $("mouse-speed").value = settings.speedPercent;
    $("mouse-speed-value").textContent = `${settings.speedPercent}%`;
  }
  $("mouse-status").textContent = settings.enabled
    ? "Turn the board to move the cursor; USER is the left button. Pair it as a mouse to use it."
    : "This board sends no mouse reports. Its data still streams and records.";
}

// ---- IMU ranges ---------------------------------------------------------------------------
// The selected board's full-scale ranges. Fixed while it records (live or to flash) or uploads,
// since a recording's scale is set when it starts.
$("imu-gyro-range").replaceChildren(...GYRO_RANGES_DPS.map((dps) => new Option(`±${dps} °/s`, String(dps))));
$("imu-accel-range").replaceChildren(...ACCEL_RANGES_G.map((g) => new Option(`±${g} g`, String(g))));
let imuRangesBusy = false;

function imuRangesBlocker(board) {
  if (!board?.connected) return "Connect a board to choose its ranges.";
  if (!board.imuRanges) return "This board's firmware runs at ±2000 °/s and ±8 g: update it to choose.";
  if (["recording", "reading", "erasing"].includes(board.log?.state)) return "Fixed while this board records to flash or uploads.";
  if (recorder.active && recorder.members.includes(board)) return "Fixed while this board is recording.";
  return null;
}

function renderImuRanges() {
  const board = selected;
  const blocker = imuRangesBlocker(board);
  for (const id of ["imu-gyro-range", "imu-accel-range"]) $(id).disabled = Boolean(blocker) || imuRangesBusy;
  const ranges = board?.imuRanges;
  if (ranges && !imuRangesBusy && ![$("imu-gyro-range"), $("imu-accel-range")].includes(document.activeElement)) {
    $("imu-gyro-range").value = String(ranges.gyroDps);
    $("imu-accel-range").value = String(ranges.accelG);
  }
  if (imuRangesBusy) return;
  const info = board?.info;
  $("imu-ranges-status").textContent = blocker ?? (info
    ? `One count is ${+(info.gyroDpsPerLsb).toPrecision(3)} °/s and ${+(info.accelGPerLsb * 1000).toPrecision(3)} mg; faster or harder motion clips.`
    : "A narrower range resolves smaller motions but clips faster ones.");
}

async function sendImuRanges() {
  const board = selected;
  if (imuRangesBlocker(board)) return;
  // Read before anything redraws the section, which would put the board's current ranges back.
  const ranges = { gyroDps: Number($("imu-gyro-range").value), accelG: Number($("imu-accel-range").value) };
  imuRangesBusy = true;
  $("imu-ranges-status").textContent = "Setting…";
  renderImuRanges();
  try {
    await board.setImuRanges(ranges);
    imuRangesBusy = false;
  } catch (error) {
    imuRangesBusy = false;
    renderImuRanges();
    $("imu-ranges-status").textContent = `Couldn't change the ranges: ${error.message}`;
    return;
  }
  renderImuRanges();
}
for (const id of ["imu-gyro-range", "imu-accel-range"]) $(id).addEventListener("change", sendImuRanges);

async function sendMouseSettings({ enabled = selected?.mouse?.enabled } = {}) {
  if (!selected?.connected || enabled === undefined) return;
  try {
    await selected.setMouse({ enabled, speedPercent: Number($("mouse-speed").value) });
  } catch (error) {
    $("mouse-status").textContent = `Couldn't change the mouse: ${error.message}`;
  }
}
$("mouse-toggle").addEventListener("click", () => sendMouseSettings({ enabled: !selected?.mouse?.enabled }));
// The label follows the slider as it moves; the board gets the value once it is released, since
// each write is also saved to its flash.
$("mouse-speed").addEventListener("input", () => ($("mouse-speed-value").textContent = `${$("mouse-speed").value}%`));
$("mouse-speed").addEventListener("change", () => sendMouseSettings());

// ---- firmware updates ---------------------------------------------------------------------
// The board side is MCUboot + MCUmgr (src/dfu/); dfu.js has the sequence. A board restarts into
// the new image, so the page reconnects to it and checks that it kept the image rather than
// rolling back. Jobs are kept by device id, since each reconnect makes a new Board.
const RECONNECT_DEADLINE_MS = 90000;
const CONNECT_ATTEMPT_MS = 20000;
const firmwareJobs = new Map();
let firmwareImage = null; // { name, bytes, image }

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The dialog: a drop zone (or file picker) for the image and a row per board to tick. Opening it
// ticks every board that can take the update. A .bin dropped anywhere on the page opens it too.
const fwChosen = new Set(); // device ids ticked
const fwRows = new Map(); // device id -> its <li> in the dialog, kept so a tick survives redraws

function openFirmwareDialog() {
  fwChosen.clear();
  for (const board of boards.values()) if (board.connected && !updateBlocker(board)) fwChosen.add(board.key);
  renderFirmware();
  if (!$("fw-dialog").open) $("fw-dialog").showModal();
}
$("fw-open").addEventListener("click", openFirmwareDialog);
$("fw-close").addEventListener("click", () => $("fw-dialog").close());

async function takeImageFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    firmwareImage = { name: file.name, bytes, image: parseMcubootImage(bytes) };
    setFirmwareStatus("");
  } catch (error) {
    firmwareImage = null;
    setFirmwareStatus(`${file.name}: ${error.message}`, { bad: true });
  }
  renderFirmware();
}
$("fw-file").addEventListener("change", () => {
  const file = $("fw-file").files[0];
  $("fw-file").value = "";
  if (file) takeImageFile(file);
});

// A file dragged over the page would otherwise make the browser open it in place of the page.
const draggingFiles = (event) => [...(event.dataTransfer?.types ?? [])].includes("Files");
window.addEventListener("dragover", (event) => draggingFiles(event) && event.preventDefault());
window.addEventListener("drop", (event) => {
  if (!draggingFiles(event)) return;
  event.preventDefault();
  $("fw-drop").classList.remove("over");
  const file = event.dataTransfer.files[0];
  if (!file) return;
  if (!$("fw-dialog").open) openFirmwareDialog();
  takeImageFile(file);
});
$("fw-drop").addEventListener("dragover", (event) => draggingFiles(event) && $("fw-drop").classList.add("over"));
$("fw-drop").addEventListener("dragleave", () => $("fw-drop").classList.remove("over"));

function setFirmwareStatus(text, { bad = false } = {}) {
  $("fw-status").textContent = text;
  $("fw-status").classList.toggle("bad-text", bad);
}

// Why `board` can't be updated right now, or null if it can.
function updateBlocker(board) {
  if (!board.smp) return "firmware predates Bluetooth updates: flash it over USB once";
  if (["recording", "reading", "erasing"].includes(board.log?.state)) return "stop its flash recording or upload first";
  if (recorder.active && recorder.members.includes(board)) return "stop the recording first";
  if (firmwareJobs.get(board.key)?.active) return "updating";
  return null;
}

function firmwareRow(key) {
  let row = fwRows.get(key);
  if (row) return row;
  row = document.createElement("li");
  row.innerHTML = `<label><input type="checkbox"> <span class="name"></span></label><span class="state"></span>
    <div class="bar" role="progressbar" aria-label="Upload" aria-valuemin="0" aria-valuemax="100" hidden><i></i></div>`;
  row.querySelector("input").addEventListener("change", (event) => {
    if (event.target.checked) fwChosen.add(key);
    else fwChosen.delete(key);
    renderFirmware();
  });
  fwRows.set(key, row);
  $("fw-targets").append(row);
  return row;
}

function renderFirmware() {
  const image = firmwareImage?.image;
  $("fw-image").textContent = image ? `${firmwareImage.name} · v${image.versionText} · ${(firmwareImage.bytes.length / 1024).toFixed(0)} KB` : "No image chosen";

  // Connected boards, and boards away restarting into new firmware.
  const targets = new Map([...boards.values()].filter((board) => board.connected).map((board) => [board.key, board]));
  for (const key of firmwareJobs.keys()) if (!targets.has(key)) targets.set(key, null);
  for (const [key, row] of fwRows) {
    if (!targets.has(key)) {
      row.remove();
      fwRows.delete(key);
    }
  }
  let ready = 0;
  for (const [key, board] of targets) {
    const row = firmwareRow(key);
    const job = firmwareJobs.get(key);
    const blocker = board ? updateBlocker(board) : "updating";
    const input = row.querySelector("input");
    input.disabled = Boolean(blocker);
    input.checked = !blocker && fwChosen.has(key);
    if (input.checked) ready++;
    row.querySelector(".name").textContent = board ? `${board.displayName} · v${board.firmwareVersion || "?"}` : job.name;
    row.querySelector(".state").textContent = job?.text ?? blocker ?? "";
    row.classList.toggle("failed", Boolean(job?.bad));
    const bar = row.querySelector(".bar");
    bar.hidden = !job?.active;
    if (job?.active) {
      const percent = Math.round((job.stage === "uploading" ? job.progress : 1) * 100);
      bar.querySelector("i").style.width = `${percent}%`;
      bar.setAttribute("aria-valuenow", String(percent));
    }
  }
  $("fw-empty").hidden = targets.size > 0;
  $("fw-update").disabled = !image || ready === 0;
  $("fw-update").textContent = ready > 1 ? `Update ${ready} boards` : "Update";
}

function setJob(key, fields) {
  const job = Object.assign(firmwareJobs.get(key) ?? {}, fields);
  firmwareJobs.set(key, job);
  renderFirmware();
  return job;
}

// Tries to reconnect until the deadline: the board is gone for the reset, MCUboot's swap and boot.
async function reconnect(device, key) {
  const deadline = Date.now() + RECONNECT_DEADLINE_MS;
  for (let attempt = 1; Date.now() < deadline; attempt++) {
    setJob(key, { text: attempt === 1 ? "reconnecting…" : `reconnecting (attempt ${attempt})…` });
    let timer;
    try {
      const attemptTimeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timed out")), CONNECT_ATTEMPT_MS);
      });
      return await Promise.race([connectDevice(device, () => {}), attemptTimeout]);
    } catch {
      device.gatt.disconnect();
      await sleepMs(2000);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("the board didn't come back: check it over USB (task monitor)");
}

async function updateBoard(board) {
  const { bytes, image } = firmwareImage;
  const { device, key } = board;
  const name = board.displayName;
  setJob(key, { name, version: image.versionText, active: true, bad: false, stage: "uploading", progress: 0, text: "starting…" });
  try {
    const result = await board.updateFirmware(bytes, {
      onStage: (stage) => setJob(key, { stage, text: stage === "restarting" ? "restarting…" : "uploading 0%" }),
      onProgress: (progress) => setJob(key, { progress, text: `uploading ${Math.round(progress * 100)}%` }),
    });
    if (result.alreadyRunning) {
      setJob(key, { active: false, stage: "done", text: `already runs v${image.versionText}` });
      return;
    }
    // MCUboot is still swapping when the first attempt starts; the retries cover it.
    await sleepMs(3000);
    const fresh = await reconnect(device, key);
    setJob(key, { stage: "verifying", text: "checking…" });
    let verdict = await fresh.verifyFirmware(image);
    for (let tries = 0; verdict.pending && tries < 3; tries++) {
      await sleepMs(2000);
      verdict = await fresh.verifyFirmware(image);
    }
    if (!verdict.ok) throw new Error(verdict.reason);
    setJob(key, { active: false, stage: "done", name: fresh.displayName, text: `✓ running v${image.versionText}` });
    setStatus(`${fresh.displayName} updated to v${image.versionText}`);
    if (!selected) select(fresh);
  } catch (error) {
    setJob(key, { active: false, stage: "failed", bad: true, text: `failed: ${error.message}` });
    setStatus(`${name}: firmware update failed`, { bad: true });
    throw error;
  }
}

async function updateBoards(list) {
  setFirmwareStatus(`Keep ${list.length === 1 ? "the board" : "the boards"} close and this page open.`);
  const results = await Promise.allSettled(list.map(updateBoard));
  const failed = results.filter((result) => result.status === "rejected").length;
  setFirmwareStatus(failed ? `${failed} of ${list.length} update${list.length === 1 ? "" : "s"} failed: see above.` : "Done.", { bad: failed > 0 });
}

$("fw-update").addEventListener("click", () => {
  const list = [...boards.values()].filter((board) => board.connected && fwChosen.has(board.key) && !updateBlocker(board));
  if (firmwareImage && list.length) updateBoards(list);
});

// ---- latency ------------------------------------------------------------------------------
// The board measures (see src/latency/latency_probe.h) and notifies its results about once a
// second; the page only shows them. All results count from the last Reset.
function setLatencyStatus(text, { bad = false } = {}) {
  $("latency-status").textContent = text;
  $("latency-status").classList.toggle("bad-text", bad);
}

function renderLatency() {
  const report = selected?.latency;
  $("latency-reset").disabled = !selected?.connected;
  $("latency-copy").disabled = !report?.reports;
  const empty = !report || report.reports === 0;
  const { tiles, lines } = report ? describeLatency(report) : { tiles: [], lines: [] };
  [...$("latency-tiles").children].forEach((tile, i) => (tile.lastElementChild.textContent = empty ? "–" : tiles[i][1]));
  $("latency-lines").innerHTML = empty ? "" : lines.map((line) => `<li>${line}</li>`).join("");
  if (!selected) setLatencyStatus("Connect to measure.");
  else if (empty) setLatencyStatus("No mouse reports yet: pair the board as a mouse and move it.");
  else setLatencyStatus("");
}

$("latency-reset").addEventListener("click", async () => {
  try {
    await selected?.resetLatency();
  } catch (error) {
    setLatencyStatus(`Couldn't reset: ${error.message}`, { bad: true });
  }
});

$("latency-copy").addEventListener("click", async () => {
  const report = selected?.latency;
  if (!report) return;
  const row = resultRow(report, {
    date: new Date().toISOString().slice(0, 10),
    firmware: selected.firmwareVersion || "?",
    host: "(fill in)",
  });
  try {
    await navigator.clipboard.writeText(row);
    setLatencyStatus("Copied: paste it into the results table in docs/latency-bench-test.md.");
  } catch (error) {
    setLatencyStatus(`Couldn't copy: ${error.message}`, { bad: true });
  }
});

// ---- replay -------------------------------------------------------------------------------
// The Replay key swaps the live panels for a recorded session read back from its folder
// (replay-view.js). Boards stay connected and recordings carry on underneath.
initReplay({ getColors: () => colors });
$("replay-key").addEventListener("click", () => {
  const show = $("replay").hidden;
  $("replay").hidden = !show;
  mainEl.hidden = show;
  $("replay-key").setAttribute("aria-pressed", String(show));
  if (!show) placeSeams();
});

renderBoards();
renderMouse();
renderLatency();
