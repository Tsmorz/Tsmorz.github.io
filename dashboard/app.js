import { Board, DISPLAY_DECIMATION, ENVELOPE_SECONDS, TRACE_POINTS } from "./board.js";
import { fitCanvas, hairline } from "./canvas.js";
import { describeLatency, resultRow } from "./latency.js";
import { dragSeam, gridTracks, parseSavedLayout, toFractions } from "./layout.js";
import { headingChangeDegrees, quatToEulerDegrees, removeYaw, rotateVector } from "./pose.js";
import { decodeFlashLog, firstSessionTag, flashSessionFiles, groupSessions, lostSamples, startsWithSession } from "./flashlog.js";
import { BoardRecording, LIVE_FILES, liveFileParts, parseEventRows, safeName } from "./recording.js";
import { initReplay, openDroppedRecording, openReplayFiles, replayShown } from "./replay-view.js";
import { kvGet, kvSet, openSpool } from "./storage.js";
import {
  ledDisplayColor, levelFraction, loudestIndex, meterFraction, peakOf, peakToDbfs, pickRange, recentPeak,
} from "./signal.js";
import { ACCEL_RANGES_G, DATA_SERVICE, GYRO_RANGES_DPS, LOG_SERVICE, TELEMETRY_SERVICE } from "./wire.js";
import { SMP_SERVICE, parseMcubootImage } from "./smp.js";
import { Dap, Nrf54lm20a, PROBE_FILTER, openProbe } from "./swd.js";
import { flashOverUsb, readImageFile, signingKeyCheck } from "./usbflash.js";

const $ = (id) => document.getElementById(id);
const IDENTITY_QUAT = { w: 1, x: 0, y: 0, z: 0 };
const ENVELOPE_FLOOR_DBFS = -80;
const MARK_LAMP_MS = 400;
// A tap is over well within one 250 ms table redraw, so a press keeps the USER lamp lit this long.
const USER_LAMP_MIN_MS = 400;

const boards = new Map(); // by Web Bluetooth device id
let selected = null;
// A live recording: its boards (members, by device id) and where their rows are spooled. See
// "recording live" below.
const recorder = {
  active: false, startedAt: null, members: new Map(), dirHandle: null,
  spool: null, spoolId: null, flushTimer: null, flushing: Promise.resolve(), unflushed: [],
};

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
const firmwareDialogOpen = () => $("fw-dialog").open || $("usb-dialog").open;
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("settings-drawer").hidden && !firmwareDialogOpen()) setSettingsOpen(false);
});
// A press anywhere else closes it too, except on its own key (which toggles it) and in the
// firmware dialogs it opens. The press still does whatever it was for, e.g. picks a board.
document.addEventListener("pointerdown", (event) => {
  const drawer = $("settings-drawer");
  if (drawer.hidden || firmwareDialogOpen()) return;
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
  seam.className = `seam ${split.axis === "x" ? "vertical" : "horizontal"}${split.within ? " within" : ""}`;
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

// ---- info popovers -----------------------------------------------------------------------
// The longer explanations wait behind an (i) key beside their heading, in a popover (the browser
// closes it on a click elsewhere or Escape). It opens under its key, kept inside the window, or
// above the key if there's no room below; it stays invisible until placed, as the toggle event
// comes after the browser has shown it.
const POPOVER_MARGIN_PX = 8;
for (const popover of document.querySelectorAll(".info-pop")) {
  const key = document.querySelector(`[popovertarget="${popover.id}"]`);
  popover.addEventListener("toggle", (event) => {
    const open = event.newState === "open";
    key.classList.toggle("open", open);
    popover.classList.toggle("placed", open);
    if (!open) return;
    const anchor = key.getBoundingClientRect();
    const { offsetWidth: width, offsetHeight: height } = popover;
    const below = anchor.bottom + 6;
    const top = below + height <= innerHeight - POPOVER_MARGIN_PX ? below : Math.max(POPOVER_MARGIN_PX, anchor.top - 6 - height);
    const left = Math.min(Math.max(POPOVER_MARGIN_PX, anchor.left - 12), innerWidth - width - POPOVER_MARGIN_PX);
    Object.assign(popover.style, { top: `${top}px`, left: `${left}px` });
  });
}

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
    board.leaving = true;
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
  for (const board of list) board.leaving = true;
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
  if (reconnecting.has(device.id)) {
    setStatus(`Already reconnecting to ${device.name}: wake it or bring it closer`);
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

/**
 * Connects to a board the browser already knows (picked once, back after a firmware update, or
 * dropped out). During a live recording, a board already in it carries on in its files where its
 * last connection left off, and any other board joins it.
 */
async function connectDevice(device, onStatus = setStatus) {
  boards.get(device.id)?.row?.remove();
  const member = recorder.active ? recorder.members.get(device.id) : undefined;
  const board = new Board(device, member ? { continueFrom: member.lastBoard, recording: member.recording } : {});
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
    board.recording = null;
    // Whatever arrived before it failed is in the recording: the next attempt goes on from there.
    // (Data only flows once the board info has been read.)
    if (member && board.info) member.lastBoard = board;
    // Also abandons a connection attempt still in progress.
    device.gatt.disconnect();
    throw error;
  }
  if (recorder.active && member && recorder.members.get(device.id) === member) resumeMember(member, board);
  else if (recorder.active && !recorder.members.has(device.id)) joinRecording(board, { late: true });
  else board.recording = null; // the recording stopped while it connected
  return board;
}

/** connectDevice(), given up after `ms`: the attempt is then abandoned. */
async function connectWithin(device, ms) {
  let timer;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("timed out")), ms);
    });
    return await Promise.race([connectDevice(device, () => {}), timeout]);
  } catch (error) {
    device.gatt.disconnect();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function onDisconnected(board) {
  if (boards.get(board.key) !== board) return;
  boards.delete(board.key);
  board.row?.remove();
  const member = memberOf(board);
  if (member?.board === board) detachMember(member);
  const job = firmwareJobs.get(board.key);
  if (job?.stage === "restarting") {
    setStatus(`${board.displayName} restarting into v${job.version}…`);
  } else if (board.leaving || job?.active) {
    setStatus(`${board.displayName} disconnected`);
  } else {
    setStatus(`${board.displayName} dropped out: reconnecting…`, { bad: Boolean(member) });
    keepConnected(board.device, board.displayName);
  }
  if (board === selected) select(boards.values().next().value ?? null);
  else renderBoards();
}

// ---- reconnecting -------------------------------------------------------------------------
// A board that drops out (out of range, a flat battery, a radio hiccup) is tried again for
// RECONNECT_WINDOW_MS, or for as long as a live recording it's in runs. Disconnecting or sleeping
// it from the page doesn't count. Chrome needs no click to reconnect a board it already knows.
const RECONNECT_WINDOW_MS = 60000;
const RECONNECT_PAUSE_MS = 2000;
const reconnecting = new Set(); // device ids

async function keepConnected(device, name, { quiet = false } = {}) {
  if (reconnecting.has(device.id)) return;
  reconnecting.add(device.id);
  const until = Date.now() + RECONNECT_WINDOW_MS;
  const wanted = () => !boards.get(device.id)?.connected && !firmwareJobs.get(device.id)?.active &&
    (Date.now() < until || (recorder.active && recorder.members.has(device.id)));
  try {
    while (wanted()) {
      try {
        const board = await connectWithin(device, CONNECT_ATTEMPT_MS);
        setStatus(`${board.displayName} ${quiet ? "connected" : "reconnected"}`);
        if (!selected) select(board);
        else renderBoards();
        return;
      } catch {
        await sleepMs(RECONNECT_PAUSE_MS);
      }
    }
    if (boards.get(device.id)?.connected) return;
    if (!quiet) setStatus(`${name} didn't come back: wake it (USER) and Add board`, { bad: true });
    else if (!connectedSummary() && reconnecting.size <= 1) setStatus("No boards connected");
  } finally {
    reconnecting.delete(device.id);
  }
}

// Boards this browser has connected before, reconnected on load. Only where Chrome lists them:
// getDevices() still needs chrome://flags/#enable-web-bluetooth-new-permissions-backend.
async function reconnectKnownBoards() {
  let devices = [];
  try {
    devices = (await navigator.bluetooth?.getDevices?.()) ?? [];
  } catch {
    return;
  }
  if (!devices.length) return;
  setStatus(`Looking for ${devices.length} board${devices.length === 1 ? "" : "s"} from last time…`);
  for (const device of devices) keepConnected(device, device.name, { quiet: true });
}

// ---- recording ----------------------------------------------------------------------------
// Local date and time, sortable: 2026-09-30_14-05-09.
function timestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

$("session").value = timestamp();

function setRecStatus(text, { bad = false } = {}) {
  $("rec-status").textContent = text;
  $("rec-status").className = bad ? "bad-text" : "muted";
}

// ---- where recordings go
// The chosen folder is remembered in this browser (storage.js) and used again after a reload.
// Chrome asks once per visit to allow writing to it again, at the next Record, Stop or Upload,
// so that's when saveFolder() is called. Without a folder, files download.
const FOLDER_KEY = "save-folder";
const READ_WRITE = { mode: "readwrite" };

function renderFolder(permission) {
  const name = recorder.dirHandle?.name;
  const text = !name ? "No folder: files download instead."
    : permission === "denied" ? `Not allowed to write to ${name}/: files download instead.`
    : permission === "granted" ? `Saving into ${name}/` : `Saving into ${name}/ (Chrome asks to allow it at Record)`;
  $("folder").textContent = text;
  $("folder").className = permission === "denied" ? "bad-text" : "muted";
}

async function restoreFolder() {
  const handle = await kvGet(FOLDER_KEY);
  if (!handle || recorder.dirHandle) return;
  recorder.dirHandle = handle;
  try {
    renderFolder(await handle.queryPermission(READ_WRITE));
  } catch {
    renderFolder("prompt");
  }
}
restoreFolder();

/** The folder to save into, asking Chrome to allow it again if needed; null to download. Call it from a click. */
async function saveFolder() {
  const handle = recorder.dirHandle;
  if (!handle) return null;
  let permission = "denied";
  try {
    permission = await handle.queryPermission(READ_WRITE);
    if (permission !== "granted") permission = await handle.requestPermission(READ_WRITE);
  } catch {
    /* the folder is gone, or the browser refused: download instead */
  }
  renderFolder(permission);
  return permission === "granted" ? handle : null;
}

$("pick-folder").addEventListener("click", async () => {
  if (!window.showDirectoryPicker) {
    $("folder").textContent = "This browser can't write folders; files will download instead.";
    return;
  }
  try {
    recorder.dirHandle = await window.showDirectoryPicker({ id: "recordings", mode: "readwrite" });
  } catch {
    return; // picker dismissed
  }
  kvSet(FOLDER_KEY, recorder.dirHandle);
  renderFolder("granted");
});

// Chrome keeps only the first 10 of a burst of downloads from a page and drops the rest without a
// word (a flash upload of three sessions lost the newest one's events and session.json). Spaced
// 100 ms apart, every one lands (headless Chrome, 2026-10-23), so each waits DOWNLOAD_GAP_MS.
const DOWNLOAD_GAP_MS = 200;
let downloadQueue = Promise.resolve();
function download(file) {
  downloadQueue = downloadQueue.then(async () => {
    const link = Object.assign(document.createElement("a"), { href: URL.createObjectURL(file), download: file.name });
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    await sleepMs(DOWNLOAD_GAP_MS);
  });
  return downloadQueue;
}

const mediaType = (name) => (name.endsWith(".json") ? "application/json" : name.endsWith(".bin") ? "application/octet-stream" : "text/csv");

/**
 * Saves one file into `folder` (path = subfolders), or downloads it with the path in its name.
 * `parts` are strings or bytes, written in order. Returns [path, File] as Replay takes them, so a
 * session just saved can be opened at once.
 */
async function saveFile(folder, path, name, parts) {
  if (!folder) {
    const file = new File(parts, [...path, name].join("__"), { type: mediaType(name) });
    await download(file);
    return [file.name, file];
  }
  let directory = folder;
  for (const part of path) directory = await directory.getDirectoryHandle(part, { create: true });
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  for (const part of parts) await writable.write(part);
  await writable.close();
  return [[folder.name, ...path, name].join("/"), await handle.getFile()];
}

// "Open in Replay" opens what was saved last, without picking it again.
let lastSaved = null; // { entries: [[path, File]], folder, session }
function offerReplay(saved) {
  lastSaved = saved;
  $("rec-replay").hidden = !saved;
}
$("rec-replay").addEventListener("click", () => {
  if (!lastSaved) return;
  showReplay(true);
  openReplayFiles(lastSaved.entries, { handles: lastSaved.folder ? [lastSaved.folder] : null, session: lastSaved.session });
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
let recordBusy = false; // between a Record or Stop click and the recording having started or been saved

function renderRecorder() {
  const flash = recordTarget() === "flash";
  targetInputs().forEach((input) => (input.disabled = recorder.active));
  $("session-label").hidden = flash;
  $("flash-hint").hidden = !flash;
  $("upload").hidden = $("erase").hidden = !flash;
  $("flash-join").hidden ||= !flash;
  if (flash) {
    renderFlashRecorder();
    return;
  }
  const connected = [...boards.values()].filter((board) => board.connected && board.info);
  $("record").disabled = recordBusy || (!recorder.active && connected.length === 0);
  $("record").textContent = recorder.active ? "Stop" : "Record";
  $("record").classList.toggle("recording", recorder.active);
  $("session").disabled = recorder.active;
  if (!recorder.active) {
    if (!connected.length && !recordBusy && !lastSaved) setRecStatus("Connect a board first.");
    return;
  }
  const seconds = Math.floor((Date.now() - recorder.startedAt.getTime()) / 1000);
  $("rec-elapsed").textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  $("rec-boards").innerHTML = "";
  for (const member of recorder.members.values()) {
    const { counts } = member.recording;
    const item = document.createElement("li");
    item.textContent = `${member.lastBoard.displayName}: ${counts.imuSamples} samples · ${counts.syncMarks} claps · ${counts.buttonEvents} button edges` +
      (member.board ? "" : " · dropped out, reconnecting…");
    if (!member.board) item.className = "bad-text";
    $("rec-boards").append(item);
  }
}

// ---- recording live, to this computer
// Each board's rows go into the browser's storage (storage.js) every FLUSH_MS and are put
// together into files at Stop, so a recording survives the page closing or crashing (it's offered
// for saving at the next visit) and a long one doesn't fill the page's memory. A board that drops
// out is reconnected and carries on in the same files, the samples it missed counted as lost; a
// board connected after Record joins in.
const FLUSH_MS = 2000;
// The page holds a lock named after its spool while it records, which the browser lets go of when
// the page closes or crashes: a spool nobody holds is a recording to save. Without locks, one not
// written to for ABANDONED_MS is taken for that.
const ABANDONED_MS = 15000;
const spoolLock = (id) => `recording:${id}`;
const spoolReady = openSpool();

function holdLock(name) {
  let release = () => {};
  navigator.locks?.request(name, () => new Promise((resolve) => (release = resolve)));
  return () => release();
}

const memberOf = (board) => (recorder.active ? recorder.members.get(board.key) : undefined);
const isRecording = (board) => memberOf(board)?.board === board;
const gapCounts = (board) => ({ imu: board.imuGaps, envelope: board.envelopeGaps, events: board.eventGaps });
const NO_GAPS = { imu: 0, envelope: 0, events: 0 };

// What session.json says about a board, kept with the spool so a recovered recording has it too.
function memberMeta(board, late) {
  return {
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
    ...(late && { joined: new Date().toISOString() }),
    reconnects: 0,
  };
}

function saveMembers() {
  const members = Object.fromEntries([...recorder.members].map(([key, member]) => [key, member.meta]));
  return recorder.spool.update(recorder.spoolId, { members }).catch(() => { /* written again at the next change */ });
}

// Adds `board` to the running recording: at Record, or when it connects during one (`late`).
function joinRecording(board, { late = false } = {}) {
  const member = {
    board, lastBoard: board, recording: new BoardRecording(board.info), meta: memberMeta(board, late),
    gaps: { ...NO_GAPS }, gapBase: gapCounts(board),
  };
  board.recording = member.recording;
  recorder.members.set(board.key, member);
  saveMembers();
}

// A member back after dropping out. connectDevice gave the new connection its recording and last
// sequence numbers, so its gap counts already include what was missed while it was away.
function resumeMember(member, board) {
  member.board = member.lastBoard = board;
  member.gapBase = { ...NO_GAPS };
  member.meta.reconnects++;
  saveMembers();
}

// Stops adding the member's board's data (it dropped out, or the recording stopped).
function detachMember(member) {
  const { board } = member;
  if (!board) return;
  for (const [stream, count] of Object.entries(gapCounts(board))) member.gaps[stream] += count - member.gapBase[stream];
  member.meta.imu_dropped_on_board_since_boot = board.info.imuDropped;
  board.recording = null;
  member.board = null;
}

// Moves the rows added since the last flush into the spool. A failed write is tried again with the
// next one, the rows kept in memory meanwhile.
function flushRecording() {
  recorder.flushing = recorder.flushing.then(async () => {
    const chunks = recorder.unflushed;
    for (const [key, member] of recorder.members) {
      for (const [file, text] of Object.entries(member.recording.takePending())) chunks.push({ member: key, file, text });
    }
    if (!chunks.length) return;
    try {
      await recorder.spool.append(recorder.spoolId, chunks);
      recorder.unflushed = [];
    } catch (error) {
      recorder.unflushed = chunks;
      setRecStatus(`Couldn't store the recording in this browser (${error.message}); it's kept in memory meanwhile.`, { bad: true });
    }
  });
  return recorder.flushing;
}

async function startRecording() {
  const folder = await saveFolder(); // asked now, not after the experiment
  const members = [...boards.values()].filter((board) => board.connected && board.info);
  if (!members.length) return;
  const name = safeName($("session").value || timestamp());
  $("session").value = name;
  const { spool, durable } = await spoolReady;
  const startedAt = new Date();
  let record;
  try {
    record = await spool.create({ session: name, started: startedAt.toISOString(), members: {} });
  } catch (error) {
    setRecStatus(`Couldn't start: ${error.message}`, { bad: true });
    return;
  }
  Object.assign(recorder, { active: true, startedAt, members: new Map(), spool, spoolId: record.id, unflushed: [], releaseLock: holdLock(spoolLock(record.id)) });
  for (const board of members) joinRecording(board);
  recorder.flushTimer = setInterval(flushRecording, FLUSH_MS);
  offerReplay(null);
  const notes = [folder ? "" : " (files download at Stop)", durable ? "" : " This browser can't keep it if the page closes."];
  setRecStatus(`Recording ${members.length} board${members.length === 1 ? "" : "s"}${notes[0]}: clap 2–3 times near all of them now.${notes[1]}`);
}

async function stopRecording() {
  const folder = await saveFolder();
  clearInterval(recorder.flushTimer);
  const stopped = new Date();
  for (const member of recorder.members.values()) {
    if (member.board?.connected) {
      try {
        await member.board.refreshInfo(); // for its count of samples dropped on the board
      } catch {
        /* keep the count from connect */
      }
    }
    detachMember(member);
  }
  recorder.active = false;
  $("rec-elapsed").textContent = "";
  await flushRecording();
  const members = Object.fromEntries([...recorder.members].map(([key, member]) => [key, { ...member.meta, lost_in_recording: member.gaps }]));
  const unflushed = recorder.unflushed;
  try {
    await recorder.spool.update(recorder.spoolId, { stopped: stopped.toISOString(), members });
  } catch {
    /* saved from memory below all the same */
  }
  const record = { id: recorder.spoolId, session: $("session").value, started: recorder.startedAt.toISOString(), stopped: stopped.toISOString(), members };
  recorder.members = new Map();
  recorder.unflushed = [];
  recorder.releaseLock();
  setRecStatus("Saving…");
  await saveLiveRecording(record, folder, unflushed);
  $("session").value = timestamp();
}

const rowCount = (chunks) => chunks.reduce((count, chunk) => count + chunk.split("\n").length - 1, 0);

/**
 * Puts a spooled recording together into its session folder (or downloads), with session.json,
 * then frees the spool. `extra`: chunks the spool couldn't take. Reports the result in the status.
 */
async function saveLiveRecording(record, folder, extra = []) {
  const { spool } = await spoolReady;
  const entries = [];
  const saved = [];
  try {
    for (const [key, meta] of Object.entries(record.members)) {
      const chunksOf = async (file) => [
        ...(await spool.chunks(record.id, key, file)),
        ...extra.filter((chunk) => chunk.member === key && chunk.file === file).map((chunk) => chunk.text),
      ];
      const eventChunks = await chunksOf("events.csv");
      const events = parseEventRows(eventChunks.join(""));
      const counts = { imuSamples: 0, envelopeWindows: 0, syncMarks: 0, buttonEvents: 0 };
      for (const { type } of events) counts[type === "sync" ? "syncMarks" : "buttonEvents"]++;
      for (const file of Object.keys(LIVE_FILES)) {
        const chunks = file === "events.csv" ? eventChunks : await chunksOf(file);
        if (file === "temperature.csv" && !chunks.length) continue;
        if (file === "imu.csv") counts.imuSamples = rowCount(chunks);
        if (file === "mic_envelope.csv") counts.envelopeWindows = rowCount(chunks);
        entries.push(await saveFile(folder, [record.session, meta.folder], file, liveFileParts(file, chunks, events)));
      }
      saved.push({ ...meta, counts });
    }
    const manifest = {
      session: record.session,
      started: record.started,
      stopped: record.stopped ?? new Date(record.updated).toISOString(),
      ...(!record.stopped && { recovered: "the page closed while it recorded; stopped is the last data stored" }),
      format: "docs/data-collection.md",
      boards: saved,
    };
    entries.push(await saveFile(folder, [record.session], "session.json", [JSON.stringify(manifest, null, 2) + "\n"]));
  } catch (error) {
    setRecStatus(`Save failed: ${error.message}. The recording is kept in this browser: save it again below.`, { bad: true });
    renderRecovery();
    return;
  }
  await spool.remove(record.id).catch(() => {});
  renderRecovery();

  const where = folder ? `${folder.name}/${record.session}/` : "your downloads";
  const fewClaps = saved.filter((board) => board.counts.syncMarks < 2).map((board) => board.label || board.name);
  setRecStatus(fewClaps.length
    ? `Saved to ${where}, but ${fewClaps.join(", ")} heard fewer than 2 claps: too few to line up ${fewClaps.length === 1 ? "its clock" : "their clocks"} with the others.`
    : `Saved ${saved.length} board${saved.length === 1 ? "" : "s"} to ${where}.`, { bad: fewClaps.length > 0 });
  offerReplay({ entries, folder, session: record.session });
}

// A recording the page didn't get to save (it closed mid-recording, or the save failed), offered
// for saving. A spool still being written to belongs to a recording running in another tab.
let recoverable = null;
async function renderRecovery() {
  const { spool } = await spoolReady;
  let waiting = [];
  try {
    const held = navigator.locks ? new Set((await navigator.locks.query()).held.map((lock) => lock.name)) : null;
    const abandoned = (record) => (held ? !held.has(spoolLock(record.id)) : Date.now() - record.updated > ABANDONED_MS);
    waiting = (await spool.list()).filter((record) => !(recorder.active && record.id === recorder.spoolId) && (record.stopped || abandoned(record)));
  } catch {
    /* nothing to offer */
  }
  for (const record of waiting.filter((record) => !Object.keys(record.members).length)) spool.remove(record.id).catch(() => {});
  recoverable = waiting.filter((record) => Object.keys(record.members).length).sort((a, b) => b.updated - a.updated)[0] ?? null;
  $("rec-recover").hidden = !recoverable;
  if (!recoverable) return;
  const count = Object.keys(recoverable.members).length;
  const last = new Date(recoverable.updated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  $("rec-recover-text").textContent = `${recoverable.session} (${count} board${count === 1 ? "" : "s"}) not saved` +
    (recoverable.stopped ? "." : `: the page closed mid-recording, at ${last}.`);
}
renderRecovery();

$("rec-recover-save").addEventListener("click", async () => {
  if (!recoverable) return;
  const folder = await saveFolder();
  const record = recoverable;
  $("rec-recover").hidden = true;
  setRecStatus("Saving…");
  await saveLiveRecording(record, folder);
});
$("rec-recover-discard").addEventListener("click", async () => {
  if (!recoverable || !confirm(`Discard ${recoverable.session} for good? It can't be got back.`)) return;
  await (await spoolReady).spool.remove(recoverable.id).catch(() => {});
  renderRecovery();
});

$("record").addEventListener("click", async () => {
  if (recordTarget() === "flash") {
    flashRecordingActive() ? stopFlash() : startFlash();
    return;
  }
  if (recordBusy) return;
  recordBusy = true;
  renderRecorder();
  try {
    await (recorder.active ? stopRecording() : startRecording());
  } finally {
    recordBusy = false;
    renderRecorder();
  }
});

// Leaving mid-recording, mid-upload or mid-update stops it, so the browser asks first.
window.addEventListener("beforeunload", (event) => {
  if (recorder.active || flashBusy.upload || [...firmwareJobs.values()].some((job) => job.active)) event.preventDefault();
});
// The last rows, in case the page is closing.
window.addEventListener("pagehide", () => recorder.active && flushRecording());

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
  // Boards connected after Record aren't recording: offered to start them in the same session.
  const idle = active ? list.filter((board) => board.log.state === "idle") : [];
  $("flash-join").hidden = !idle.length;
  $("flash-join").textContent = `Record ${idle.map((board) => board.displayName).join(", ")} too`;
  const noBoardText = ["Connect a board first.", "These boards' firmware can't record on its own. Flash the current build."];
  if (!list.length && !busy) {
    const old = [...boards.values()].some((board) => board.connected && !board.log);
    setRecStatus(noBoardText[old ? 1 : 0]);
  } else if (noBoardText.includes($("rec-status").textContent)) {
    // A board's flash service attaches a moment after it connects, so either message may be stale.
    setRecStatus("Ready.");
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

async function forEachFlashBoard(list, action, verb) {
  const results = await Promise.allSettled(list.map((board) => action(board)));
  const failed = results.flatMap((result, i) => (result.status === "rejected" ? [`${list[i].displayName} (${result.reason.message})`] : []));
  if (failed.length) setRecStatus(`Couldn't ${verb}: ${failed.join(", ")}`, { bad: true });
  return failed.length === 0;
}

async function startFlash() {
  // One tag for every board started together, so uploads group into one session: the start time.
  const tag = Math.floor(Date.now() / 1000);
  setRecStatus("Starting…");
  offerReplay(null);
  if (await forEachFlashBoard(flashBoards(), (board) => board.logStart(tag, Date.now()), "start")) {
    setRecStatus("Recording on the boards: clap 2–3 times near all of them now. You can disconnect; they carry on.");
  }
}

$("flash-join").addEventListener("click", async () => {
  const list = flashBoards();
  const tag = list.find((board) => board.log.state === "recording")?.log.sessionTag;
  const idle = list.filter((board) => board.log.state === "idle");
  if (!tag || !idle.length) return;
  if (await forEachFlashBoard(idle, (board) => board.logStart(tag, Date.now()), "start")) {
    setRecStatus(`${idle.map((board) => board.displayName).join(", ")} joined the recording: clap near ${idle.length === 1 ? "it" : "them"} too.`);
  }
});

async function stopFlash() {
  setRecStatus("Stopping…");
  const recording = flashBoards().filter((board) => board.log.state === "recording");
  const results = await Promise.allSettled(recording.map((board) => board.logStop()));
  const failed = results.filter((result) => result.status === "rejected").length;
  setRecStatus(failed ? `${failed} board(s) didn't stop; try again.` : "Stopped. Upload when you're ready; the recordings stay on the boards until erased.", { bad: failed > 0 });
}

$("erase").addEventListener("click", async () => {
  const list = flashBoards();
  if (!confirm(`Erase the recordings on ${list.length} board${list.length === 1 ? "" : "s"}? Upload them first: this can't be undone.`)) return;
  flashBusy.erase = true;
  setRecStatus("Erasing (up to a minute)…");
  const ok = await forEachFlashBoard(list, (board) => board.logErase(), "erase");
  flashBusy.erase = false;
  for (const board of list) rememberUploaded(board.boardId, null);
  if (ok) setRecStatus("Erasing on the boards; each shows 0% when done.");
});

// What the last upload from each board to this browser read: the log's first recording, to know
// it's still the same log, and how far it got. The next upload reads on from there, so it takes
// only the new recordings and doesn't save the old ones again.
const LOG_HEAD_BYTES = 64;
const uploadedKey = (boardId) => `flash-uploaded:${boardId}`;

function uploadedSoFar(boardId) {
  try {
    const saved = JSON.parse(localStorage.getItem(uploadedKey(boardId)));
    return Number.isInteger(saved?.bytes) && Number.isInteger(saved?.firstTag) ? saved : null;
  } catch {
    return null;
  }
}

function rememberUploaded(boardId, uploaded) {
  try {
    if (uploaded) localStorage.setItem(uploadedKey(boardId), JSON.stringify(uploaded));
    else localStorage.removeItem(uploadedKey(boardId));
  } catch {
    /* storage blocked: the next upload reads the whole log */
  }
}

// The part of the board's log not uploaded yet (all of it unless this browser uploaded from this
// log before): { offset, used, bytes, firstTag }.
async function readNewLog(board, onProgress) {
  const used = board.log.usedBytes;
  const before = uploadedSoFar(board.boardId);
  let offset = 0;
  if (before && before.bytes <= used) {
    const head = await board.logDownload(0, Math.min(used, LOG_HEAD_BYTES));
    if (firstSessionTag(head) === before.firstTag) offset = before.bytes;
  }
  let bytes = await board.logDownload(offset, used - offset, onProgress);
  if (offset && !startsWithSession(bytes)) {
    offset = 0;
    bytes = await board.logDownload(0, used, onProgress);
  }
  return { offset, used, bytes, firstTag: offset ? before.firstTag : firstSessionTag(bytes) };
}

$("upload").addEventListener("click", uploadFlash);

async function uploadFlash() {
  const folder = await saveFolder();
  const list = flashBoards().filter((board) => board.log.usedBytes > 0);
  flashBusy.upload = true;
  offerReplay(null);
  setRecStatus(`Uploading from ${list.length} board${list.length === 1 ? "" : "s"}…`);
  const started = Date.now();
  const results = await Promise.allSettled(list.map(async (board) => {
    board.downloadProgress = 0;
    try {
      const read = await readNewLog(board, (fraction) => (board.downloadProgress = fraction));
      return { board, ...read, ...decodeFlashLog(read.bytes) };
    } finally {
      board.downloadProgress = null;
    }
  }));
  flashBusy.upload = false;

  const uploaded = results.filter((result) => result.status === "fulfilled").map((result) => result.value);
  const failed = results.flatMap((result, i) => (result.status === "rejected" ? [`${list[i].displayName} (${result.reason.message})`] : []));
  try {
    const { names, entries, fewClaps } = await saveFlashUploads(uploaded, folder);
    for (const { board, used, firstTag } of uploaded) if (firstTag !== null) rememberUploaded(board.boardId, { firstTag, bytes: used });
    const seconds = Math.round((Date.now() - started) / 1000);
    const problems = uploaded.flatMap(({ board, problems }) => problems.map((problem) => `${board.displayName}: ${problem}`));
    const where = folder ? `${folder.name}/` : "your downloads";
    setRecStatus([
      names.length ? `Saved ${names.length} session${names.length === 1 ? "" : "s"} (${names.join(", ")}) to ${where} in ${seconds} s.`
        : uploaded.length ? "Nothing new on the boards since the last upload." : "",
      fewClaps.length ? `Fewer than 2 claps, too few to line up the clocks: ${fewClaps.join(", ")}.` : "",
      failed.length ? `Failed: ${failed.join(", ")}.` : "",
      problems.length ? `Damaged data skipped: ${problems.join("; ")}.` : "",
    ].filter(Boolean).join(" "), { bad: Boolean(failed.length || problems.length || fewClaps.length) });
    if (names.length) offerReplay({ entries, folder, session: names.at(-1) });
  } catch (error) {
    setRecStatus(`Save failed: ${error.message}`, { bad: true });
  }
}

/**
 * Writes each recording session (boards grouped by start) as a session folder, and each board's
 * raw log as read. Returns the session names, what was saved (for Replay) and the boards that
 * heard fewer than 2 claps.
 */
async function saveFlashUploads(uploaded, folder) {
  const groups = groupSessions(uploaded.map(({ board, sessions }) => ({ board, sessions })));
  const stamp = timestamp();
  const entries = [];
  const fewClaps = [];
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
    for (const { board, session } of group.boards) {
      for (const [file, text] of Object.entries(flashSessionFiles(session))) entries.push(await saveFile(folder, [group.name, boardFolder(board)], file, [text]));
    }
    entries.push(await saveFile(folder, [group.name], "session.json", [JSON.stringify(manifest, null, 2) + "\n"]));
    for (const board of manifest.boards) if (board.counts.syncMarks < 2) fewClaps.push(`${board.label || board.name} in ${group.name}`);
  }
  // The raw logs too, so nothing is lost if decoding ever needs redoing; named by where they start.
  for (const { board, bytes, offset } of uploaded) {
    if (bytes.length) await saveFile(folder, ["flash_raw"], `${board.boardId}_${stamp}${offset ? `_from${offset}` : ""}.bin`, [bytes]);
  }
  return { names: groups.map((group) => group.name), entries, fewClaps };
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
  if (isRecording(board)) return "Fixed while this board is recording.";
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
  $("usb-drop").classList.remove("over");
  if ($("usb-dialog").open) {
    takeUsbFiles([...event.dataTransfer.files]);
    return;
  }
  // A recording (a session's folder, or its .csv and .json files) opens in Replay instead.
  if (!$("fw-dialog").open && openDroppedRecording(event.dataTransfer)) {
    showReplay(true);
    return;
  }
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
  if (!board.smp) return "firmware predates Bluetooth updates: use Flash over USB once";
  if (["recording", "reading", "erasing"].includes(board.log?.state)) return "stop its flash recording or upload first";
  if (isRecording(board)) return "stop the recording first";
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
    try {
      return await connectWithin(device, CONNECT_ATTEMPT_MS);
    } catch {
      await sleepMs(RECONNECT_PAUSE_MS);
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

// ---- flashing over USB --------------------------------------------------------------------
// For a board with no firmware yet, or firmware too old for Bluetooth updates: the page drives
// the board's own USB programmer over WebUSB (swd.js) and writes MCUboot and the signed firmware
// as `task flash` does, on a chip it erases first (usbflash.js). One board at a time.
const usbImages = { bootloader: null, firmware: null };
let usbKeyCheck = null; // "match", "mismatch" or "unknown" once both images are in
let usbFlashing = false;
const USB_STAGE_TEXT = { connecting: "connecting…", erasing: "erasing the chip…", writing: "writing", verifying: "checking", restarting: "restarting…" };

$("usb-open").addEventListener("click", () => {
  renderUsbFlash();
  if (!$("usb-dialog").open) $("usb-dialog").showModal();
});
$("usb-close").addEventListener("click", () => $("usb-dialog").close());
$("usb-file").addEventListener("change", () => {
  const files = [...$("usb-file").files];
  $("usb-file").value = "";
  takeUsbFiles(files);
});
$("usb-drop").addEventListener("dragover", (event) => draggingFiles(event) && $("usb-drop").classList.add("over"));
$("usb-drop").addEventListener("dragleave", () => $("usb-drop").classList.remove("over"));

function setUsbStatus(text, { bad = false } = {}) {
  $("usb-status").textContent = text;
  $("usb-status").classList.toggle("bad-text", bad);
}

// Each file is sorted by what it holds, so the two can come in either order, or together.
async function takeUsbFiles(files) {
  try {
    for (const file of files) {
      const picked = readImageFile(file.name, new Uint8Array(await file.arrayBuffer()));
      usbImages[picked.kind] = picked;
    }
    setUsbStatus("");
  } catch (error) {
    setUsbStatus(error.message, { bad: true });
  }
  usbKeyCheck = usbImages.bootloader && usbImages.firmware ? await signingKeyCheck(usbImages.bootloader, usbImages.firmware) : null;
  renderUsbFlash();
}

function renderUsbFlash() {
  const { bootloader, firmware } = usbImages;
  const kb = (bytes) => `${(bytes.length / 1024).toFixed(0)} KB`;
  $("usb-bootloader").textContent = `MCUboot: ${bootloader ? `${bootloader.name} · ${kb(bootloader.bytes)}` : "not chosen"}`;
  $("usb-firmware").textContent = `Firmware: ${firmware ? `${firmware.name} · v${firmware.image.versionText} · ${kb(firmware.bytes)}` : "not chosen"}`;
  $("usb-key").hidden = !usbKeyCheck;
  $("usb-key").textContent = {
    match: "✓ Signed with the key this MCUboot trusts",
    mismatch: "This MCUboot won't boot this firmware: they're signed with different keys. Take both from the same build or release.",
    unknown: "Couldn't check the signing key: take both from the same build or release.",
  }[usbKeyCheck] ?? "";
  $("usb-key").classList.toggle("bad-text", usbKeyCheck === "mismatch");
  if (!navigator.usb) setUsbStatus("This browser has no WebUSB: use Chrome or Edge.", { bad: true });
  $("usb-flash").disabled = !navigator.usb || usbFlashing || !bootloader || !firmware || usbKeyCheck === "mismatch";
}

function showUsbProgress(stage, fraction) {
  const percent = Math.round(fraction * 100);
  const counted = stage === "writing" || stage === "verifying";
  setUsbStatus(counted ? `${USB_STAGE_TEXT[stage]} ${percent}%` : USB_STAGE_TEXT[stage]);
  $("usb-bar").hidden = false;
  $("usb-bar").querySelector("i").style.width = `${counted ? percent : stage === "restarting" ? 100 : 0}%`;
  $("usb-bar").setAttribute("aria-valuenow", String(counted ? percent : 0));
}

$("usb-flash").addEventListener("click", async () => {
  let device;
  try {
    device = await navigator.usb.requestDevice({ filters: [PROBE_FILTER] });
  } catch {
    return; // the picker was closed
  }
  usbFlashing = true;
  renderUsbFlash();
  let transport = null;
  let stage = "connecting";
  try {
    transport = await openProbe(device);
    const { boardId, wasLocked } = await flashOverUsb(new Nrf54lm20a(new Dap(transport)), usbImages, {
      onStage: (next) => showUsbProgress((stage = next), 0),
      onProgress: (fraction) => showUsbProgress(stage, fraction),
    });
    const name = `nrf-controller-${boardId}`;
    setUsbStatus(`✓ ${name} runs v${usbImages.firmware.image.versionText}${wasLocked ? " (it was locked: the erase unlocked it)" : ""}. Add it over Bluetooth.`);
    setStatus(`${name} flashed over USB`);
  } catch (error) {
    setUsbStatus(`Failed: ${error.message}`, { bad: true });
  } finally {
    await transport?.close().catch(() => {});
    $("usb-bar").hidden = true;
    usbFlashing = false;
    renderUsbFlash();
  }
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
function showReplay(show) {
  $("replay").hidden = !show;
  mainEl.hidden = show;
  $("replay-key").setAttribute("aria-pressed", String(show));
  if (show) replayShown();
  else placeSeams();
}
$("replay-key").addEventListener("click", () => showReplay($("replay").hidden));

renderBoards();
renderMouse();
renderLatency();
reconnectKnownBoards();
