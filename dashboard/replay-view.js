// The Replay view: a recorded session read back from its folder and plotted with every board on
// one timebase, to check a session soon after recording it. replay.js does the parsing and the
// maths; this file is the DOM and the drawing. See docs/dashboard.md.
import { fitCanvas, hairline } from "./canvas.js";
import {
  columnExtents,
  findSessions,
  loadBoard,
  lowerBound,
  nearestIndex,
  niceStep,
  panView,
  parseCsv,
  placeBoard,
  sessionTimebase,
  tickTimes,
  zoomView,
} from "./replay.js";
import { pickRange } from "./signal.js";
import { kvGet, kvSet } from "./storage.js";

const $ = (id) => document.getElementById(id);
const MIN_SPAN_S = 0.05;
const PAD_Y = 8;
const ENVELOPE_FLOOR_DBFS = -80;
const Y_LABEL_PX = 44; // a lane's left edge, where its value labels are: scrolling there zooms vertically
const CSV_FILES = { imu: "imu.csv", events: "events.csv", envelope: "mic_envelope.csv", orientation: "orientation.csv" };

// What a lane can show: series(track) gives [times (s), [values per channel]], or null if the
// recording doesn't have it. Ranges step through `ladder` like the live traces. `keys`: each
// channel's colour token, X/Y/Z's unless given.
const SIGNALS = {
  gyro: {
    units: "°/s, raw (bias not removed)", ladder: [250, 500, 1000, 2000], decimals: 1, names: ["X", "Y", "Z"],
    series: (track) => [track.imuT, track.board.imu.gyro],
  },
  accel: {
    units: "g", ladder: [2, 4, 8, 16], decimals: 2, names: ["X", "Y", "Z"],
    series: (track) => [track.imuT, track.board.imu.accel],
  },
  orientation: {
    units: "°, VQF; yaw from the first sample", ladder: [45, 90, 180], decimals: 1, names: ["Roll", "Pitch", "Yaw"], wraps: true,
    series: ({ board: { orientation: o }, orientationT }) => o && [orientationT, [o.roll, o.pitch, o.yaw]],
  },
  quaternion: {
    units: "VQF, as recorded", ladder: [1], decimals: 3, names: ["W", "X", "Y", "Z"],
    keys: ["screen-text", "series-x", "series-y", "series-z"],
    series: ({ board: { orientation: o }, orientationT }) => o && [orientationT, o.quat],
  },
  mic: {
    units: "dBFS, peak per ms", decimals: 1, names: ["Level"],
    series: ({ board: { envelope }, envelopeT }) => envelope && [envelopeT, [envelope.dbfs]],
  },
};

const state = {
  files: new Map(), // picked path -> File
  handles: null, // the folder or file handles they came from, if any
  sessions: [],
  tracks: [], // the session's boards on its timebase (replay.js placeBoard), in session order
  shown: new Set(), // folders whose lanes are shown
  signal: "gyro",
  bounds: null, // { t0, t1 }: the whole session
  view: null, // { t0, t1 }: what the lanes show
  // The lanes' shared vertical range, as { t0: bottom, t1: top } in the signal's units so the time
  // view's zoom and pan work on it too. null follows the data until zoomed or panned vertically;
  // `y` is what was last drawn.
  yView: null,
  y: null,
  hoverT: null,
  lanes: [], // { track, canvas, values }
};
let getColors = () => ({});
let colors = {};

export function initReplay(options) {
  getColors = options.getColors;
  // Chrome's own pickers give handles the page can keep and open again (see "the last session");
  // elsewhere the file inputs do.
  $("replay-open-folder").addEventListener("click", async () => {
    if (!window.showDirectoryPicker) return $("replay-folder").click();
    try {
      openHandles([await window.showDirectoryPicker({ id: "replay", mode: "read" })]);
    } catch {
      /* picker dismissed */
    }
  });
  $("replay-open-files").addEventListener("click", async () => {
    if (!window.showOpenFilePicker) return $("replay-files").click();
    try {
      openHandles(await window.showOpenFilePicker({
        id: "replay", multiple: true, types: [{ description: "Recorded session files", accept: { "text/csv": [".csv"], "application/json": [".json"] } }],
      }));
    } catch {
      /* picker dismissed */
    }
  });
  for (const input of [$("replay-folder"), $("replay-files")]) {
    input.addEventListener("change", () => {
      if (input.files.length) takeFiles([...input.files].map((file) => [file.webkitRelativePath || file.name, file]));
      input.value = "";
    });
  }
  $("replay-pick").addEventListener("change", () => {
    const session = state.sessions[Number($("replay-pick").value)];
    remember(session);
    loadSession(session);
  });
  $("replay-reopen").addEventListener("click", reopen);
  kvGet(SOURCE_KEY).then((source) => {
    lastSource = source ?? null;
    if (!$("replay").hidden) replayShown();
  });
  for (const input of document.querySelectorAll('input[name="replay-signal"]')) {
    input.addEventListener("change", () => {
      state.signal = input.value;
      state.yView = null;
      buildLanes();
    });
  }
  $("replay-fit").addEventListener("click", showAll);
  wireLanes();
  wireOverview();

  const resize = new ResizeObserver(requestDraw);
  resize.observe($("replay-lanes"));
  resize.observe($("replay-overview"));
  // app.js re-reads the theme's colours first; the next draw picks them up.
  new MutationObserver(requestDraw).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", requestDraw);
  buildLanes();
}

function setStatus(text, { bad = false } = {}) {
  $("replay-status").textContent = text;
  $("replay-status").className = bad ? "bad-text" : "muted";
}

// ---- opening a session --------------------------------------------------------------------
// A folder pick or drop gives every file under it with its relative path; files picked or dropped
// on their own (a session that was downloaded rather than saved to a folder) have names like
// session__board__imu.csv. `entries` are [path, File]; oldest first, so that of Chrome's numbered
// copies of a download the newest is kept (findSessions keeps the last). `handles`: the folder or
// file handles they came from, if any, kept so the session can be opened again after a reload.
// `session`: the name of the one to show, else the newest.
function takeFiles(entries, { handles = null, session = null } = {}) {
  const sorted = [...entries].sort(([, a], [, b]) => a.lastModified - b.lastModified);
  state.files = new Map(sorted);
  state.sessions = findSessions(sorted.map(([path]) => path), (path) => state.files.get(path).lastModified);
  state.handles = handles;
  $("replay-reopen").hidden = true;
  const pick = $("replay-pick");
  pick.replaceChildren(...state.sessions.map((found, i) =>
    new Option(`${found.name} · ${found.boards.length} board${found.boards.length === 1 ? "" : "s"}`, String(i))));
  $("replay-pick-label").hidden = state.sessions.length < 2;
  if (!state.sessions.length) {
    setStatus("No recordings there. Pick a session's folder: the one holding session.json and a folder per board.", { bad: true });
    remember(null);
    return;
  }
  const index = Math.max(0, state.sessions.findIndex((found) => found.name === session));
  pick.value = String(index);
  remember(state.sessions[index]);
  loadSession(state.sessions[index]);
}

/** Opens files the page has just saved ([path, File]), or anything else read already, in Replay. */
export function openReplayFiles(entries, options) {
  takeFiles(entries, options);
}

// Every file under folder and file handles, as [path, File], the path starting at each handle's name.
async function entriesOf(handles) {
  const entries = [];
  const walk = async (handle, prefix) => {
    const path = prefix ? `${prefix}/${handle.name}` : handle.name;
    if (handle.kind === "file") entries.push([path, await handle.getFile()]);
    else for await (const child of handle.values()) await walk(child, path);
  };
  for (const handle of handles) await walk(handle, "");
  return entries;
}

async function openHandles(handles, session = null) {
  setStatus("Reading…");
  try {
    takeFiles(await entriesOf(handles), { handles, session });
  } catch (error) {
    setStatus(`Couldn't read them: ${error.message}`, { bad: true });
  }
}

// ---- the last session -----------------------------------------------------------------------
// The session opened last is kept in this browser (its folder or file handles and its name) and
// opened again when Replay next opens: at once if Chrome still allows reading it, else from the
// Reopen key, as Chrome asks once per visit. Files opened through the plain file inputs or an old
// style drop have no handles, so they can't be.
const SOURCE_KEY = "replay-source";
const READ = { mode: "read" };
let lastSource = null; // { handles, session }

function remember(session) {
  lastSource = session && state.handles ? { handles: state.handles, session: session.name } : null;
  kvSet(SOURCE_KEY, lastSource ?? undefined);
}

/** Called by app.js when the Replay view opens. */
export async function replayShown() {
  if (state.tracks.length || !lastSource) return;
  let allowed = false;
  try {
    allowed = (await Promise.all(lastSource.handles.map((handle) => handle.queryPermission(READ)))).every((permission) => permission === "granted");
  } catch {
    /* a handle that no longer works: offered below, and reported if it fails */
  }
  if (allowed) {
    openHandles(lastSource.handles, lastSource.session);
    return;
  }
  $("replay-reopen").textContent = `Reopen ${lastSource.session}`;
  $("replay-reopen").hidden = false;
}

async function reopen() {
  if (!lastSource) return;
  try {
    for (const handle of lastSource.handles) {
      if ((await handle.requestPermission(READ)) !== "granted") {
        setStatus("Chrome wasn't allowed to read it again: open it from the folder instead.", { bad: true });
        return;
      }
    }
  } catch (error) {
    setStatus(`Couldn't reopen it (${error.message}): open it from the folder instead.`, { bad: true });
    return;
  }
  openHandles(lastSource.handles, lastSource.session);
}

/**
 * Opens a recording dropped on the page: a session's folder (or a folder of them), or its .csv and
 * .json files. Returns false, reading nothing, if the drop holds neither.
 */
export function openDroppedRecording(dataTransfer) {
  // Taken now: the drop's items are gone once its event returns.
  const items = [...dataTransfer.items].filter((item) => item.kind === "file");
  const entries = items.map((item) => item.webkitGetAsEntry()).filter(Boolean);
  if (!entries.some((entry) => entry.isDirectory || /\.(csv|json)$/i.test(entry.name))) return false;
  if (items[0].getAsFileSystemHandle) {
    // Handles, as the pickers give, so the session can be opened again later.
    const handles = items.map((item) => item.getAsFileSystemHandle());
    setStatus("Reading the dropped files…");
    Promise.all(handles).then(
      (list) => openHandles(list.filter(Boolean)),
      (error) => setStatus(`Couldn't read the dropped files: ${error.message}`, { bad: true }),
    );
    return true;
  }
  const walk = async (entry) => {
    if (entry.isFile) return [[entry.fullPath.slice(1), await new Promise((resolve, reject) => entry.file(resolve, reject))]];
    const reader = entry.createReader();
    const children = [];
    // A folder's entries come in batches, until an empty one.
    for (let batch; (batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject))).length;) children.push(...batch);
    return (await Promise.all(children.map(walk))).flat();
  };
  setStatus("Reading the dropped files…");
  Promise.all(entries.map(walk)).then(
    (lists) => takeFiles(lists.flat()),
    (error) => setStatus(`Couldn't read the dropped files: ${error.message}`, { bad: true }),
  );
  return true;
}

async function loadSession(session) {
  setStatus(`Reading ${session.name}…`);
  const read = (path) => state.files.get(path).text();
  try {
    const manifest = session.manifest ? JSON.parse(await read(session.manifest)) : {};
    const entries = manifest.boards ?? [];
    const position = (folder) => {
      const index = entries.findIndex((entry) => entry.folder === folder);
      return index < 0 ? entries.length : index;
    };
    const boards = [];
    const empty = [];
    for (const { folder, files } of [...session.boards].sort((a, b) => position(a.folder) - position(b.folder))) {
      const tables = {};
      for (const [key, name] of Object.entries(CSV_FILES)) if (files[name]) tables[key] = parseCsv(await read(files[name]));
      if (!tables.imu.length) empty.push(folder);
      else boards.push(loadBoard(folder, entries[position(folder)] ?? {}, tables));
    }

    const timebase = sessionTimebase(boards);
    state.tracks = boards.map((board) => placeBoard(board, timebase.clocks.get(board.folder)));
    state.shown = new Set(boards.map((board) => board.folder));
    if (state.tracks.length) {
      const t0 = Math.min(...state.tracks.map((track) => track.imuT[0]));
      const t1 = Math.max(...state.tracks.map((track) => track.imuT.at(-1)));
      state.bounds = { t0, t1: Math.max(t1, t0 + MIN_SPAN_S) };
    } else {
      state.bounds = null;
    }
    state.view = state.bounds;
    const live = boards.some((board) => board.imu.hostMs);
    $("replay-name").textContent = `${session.name} · ${manifest.source === "flash" || !live ? "boards' flash" : "live"}`;
    renderTimebase(timebase, empty);
    renderBoards();
    offerSignals();
    buildLanes();
  } catch (error) {
    setStatus(`Couldn't read ${session.name}: ${error.message}`, { bad: true });
  }
}

function renderTimebase(timebase, empty) {
  const text = {
    computer: "Boards are on the computer's clock, good to tens of ms.",
    board: "These files share no clock: each board starts at 0 on its own.",
  }[timebase.kind];
  const skipped = empty.length ? ` No IMU samples from ${empty.join(", ")}.` : "";
  setStatus(text + skipped, { bad: Boolean(empty.length) });
}

// One row per board: what it recorded and anything that would spoil identification.
function renderBoards() {
  const body = $("replay-boards");
  body.replaceChildren();
  const minutes = (s) => {
    const tenths = Math.round(s * 10);
    return `${Math.floor(tenths / 600)}:${((tenths % 600) / 10).toFixed(1).padStart(4, "0")}`;
  };
  for (const track of state.tracks) {
    const { folder } = track.board;
    const { samples, seconds, rateHz, lost, claps, presses } = track.summary;
    const row = document.createElement("tr");
    row.innerHTML = `<td><input type="checkbox" aria-label="Show this board"></td><td class="num name"></td>
      <td class="num"></td><td class="num"></td><td class="num"></td><td class="num"></td><td class="num"></td><td class="num"></td>`;
    const cells = row.querySelectorAll("td");
    [folder, minutes(seconds), samples.toLocaleString(), `${rateHz.toFixed(1)} Hz`, String(lost), String(claps), String(presses)]
      .forEach((text, i) => (cells[i + 1].textContent = text));
    cells[5].classList.toggle("bad-text", lost > 0);
    const box = row.querySelector("input");
    box.checked = state.shown.has(folder);
    const toggle = () => {
      if (box.checked) state.shown.add(folder);
      else state.shown.delete(folder);
      buildLanes();
    };
    box.addEventListener("change", toggle);
    box.addEventListener("click", (event) => event.stopPropagation());
    row.addEventListener("click", () => {
      box.checked = !box.checked;
      toggle();
    });
    body.append(row);
  }
}

// Greys out the signals no board in the session recorded (a flash recording has no mic level,
// only its claps), moving off one that was chosen to gyro.
const MISSING = { mic: "Not in this session: a flash recording keeps only the claps, drawn on every signal", orientation: "Not in this session", quaternion: "Not in this session" };

function offerSignals() {
  for (const input of document.querySelectorAll('input[name="replay-signal"]')) {
    const recorded = !state.tracks.length || state.tracks.some((track) => SIGNALS[input.value].series(track));
    input.disabled = !recorded;
    input.parentElement.title = recorded ? "" : MISSING[input.value] ?? "";
    if (!recorded && input.checked) {
      document.querySelector('input[name="replay-signal"][value="gyro"]').checked = true;
      state.signal = "gyro";
      state.yView = null;
    }
  }
}

// ---- lanes --------------------------------------------------------------------------------
// One lane per shown board for the chosen signal, all on the same time axis and vertical range.

const channelKey = (signal, i) => signal.keys?.[i] ?? `series-${"xyz"[i]}`;
function channelColor(signal, i) {
  const key = channelKey(signal, i);
  return key === "screen-text" ? colors.text : colors.series["xyz".indexOf(key.at(-1))];
}

function buildLanes() {
  const container = $("replay-lanes");
  container.replaceChildren();
  state.lanes = [];
  const signal = SIGNALS[state.signal];
  $("replay-units").textContent = signal.units;
  for (const track of state.tracks) {
    if (!state.shown.has(track.board.folder)) continue;
    const lane = document.createElement("div");
    lane.className = "lane";
    const head = document.createElement("div");
    head.className = "plot-head";
    const name = document.createElement("span");
    name.textContent = track.board.folder;
    const values = document.createElement("span");
    values.className = "live";
    // Keyed values double as the legend, as on the live Motion panel.
    values.innerHTML = signal.names.map((label, i) =>
      `<span${signal.names.length > 1 ? ` style="--key: var(--${channelKey(signal, i)})"` : ""}>${label} <b>–</b></span>`).join("");
    head.append(name, values);
    const plot = document.createElement("div");
    plot.className = "plot trace";
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-label", `${track.board.folder}: ${state.signal}`);
    plot.append(canvas);
    lane.append(head, plot);
    container.append(lane);
    state.lanes.push({ track, canvas, values });
  }
  if (!state.lanes.length) {
    const hint = Object.assign(document.createElement("p"), { className: "hint" });
    hint.textContent = state.tracks.length ? "Tick a board above to plot it." : "Open a session to plot it.";
    container.append(hint);
  }
  requestDraw();
}

let drawQueued = false;
function requestDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => {
    drawQueued = false;
    draw();
  });
}

function setView(view) {
  if (!view) return;
  state.view = view;
  requestDraw();
}

function setYView(yView) {
  state.yView = yView;
  requestDraw();
}

// The whole session, at the vertical range that fits it.
function showAll() {
  state.yView = null;
  setView(state.bounds);
}

// How far the vertical range can go: the signal's largest range (a bit past it, so ±1 has room),
// or the mic's whole scale. Zoomed in no further than a ten-thousandth of that.
function yLimits(signal) {
  const top = signal.ladder?.at(-1);
  return top ? { t0: -1.25 * top, t1: 1.25 * top } : { t0: ENVELOPE_FLOOR_DBFS, t1: 0 };
}
const MIN_Y_FRACTION = 1e-4;

// Values to and from a lane's canvas y; series keep PAD_Y clear above and below, the mic's bars don't.
function yScale(signal, height, { t0: bottom, t1: top }) {
  const pad = signal.ladder ? PAD_Y : 0;
  const plotHeight = height - 2 * pad;
  return {
    plotHeight,
    toY: (value) => pad + ((top - value) / (top - bottom)) * plotHeight,
    valueAt: (y) => top - ((y - pad) / plotHeight) * (top - bottom),
  };
}

// Round values across the range for gridlines and labels, about one per 40 px.
function valueTicks({ t0, t1 }, plotHeight) {
  const step = niceStep(t1 - t0, Math.max(2, Math.floor(plotHeight / 40)));
  return { ticks: tickTimes(t0, t1, step), decimals: Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)) };
}

function draw() {
  if ($("replay").hidden) return;
  colors = getColors();
  const signal = SIGNALS[state.signal];
  const plans = state.lanes.map((lane) => planLane(lane, signal));
  const range = signal.ladder ? pickRange(Math.max(0, ...plans.map((plan) => plan?.peak ?? 0)), signal.ladder) : null;
  state.y = state.yView ?? (range ? { t0: -range, t1: range } : yLimits(signal));
  const { decimals } = valueTicks(state.y, state.lanes[0]?.canvas.clientHeight ?? 100);
  $("replay-range").textContent = state.yView ? ` · ${state.y.t0.toFixed(decimals)} to ${state.y.t1.toFixed(decimals)}` : range ? ` · ±${range}` : "";
  plans.forEach((plan, i) => drawLane(state.lanes[i], plan, signal));
  drawAxis();
  drawOverview();
  renderReadouts(signal, plans);
}

// The time between a series' samples, typically; a longer step is a gap the trace doesn't bridge.
function typicalPeriod(times) {
  return times.length > 1 ? (times.at(-1) - times[0]) / (times.length - 1) : Infinity;
}

// What to draw for one lane: each visible sample if there are few enough, else each pixel
// column's extremes; and the largest magnitude in view, for the shared range.
function planLane({ track, canvas }, signal) {
  const series = signal.series(track);
  if (!series || !state.view) return null;
  const [times, channels] = series;
  const { t0, t1 } = state.view;
  const columns = Math.max(1, Math.floor(canvas.clientWidth));
  const i0 = Math.max(0, lowerBound(times, t0) - 1);
  const i1 = Math.min(times.length, lowerBound(times, t1) + 1);
  const plan = {
    times, channels, i0, i1, columns, period: typicalPeriod(times), wraps: Boolean(signal.wraps), peak: 0,
    colors: channels.map((_, i) => channelColor(signal, i)),
  };
  if (i1 - i0 <= 2 * columns) {
    for (const values of channels) for (let i = i0; i < i1; i++) plan.peak = Math.max(plan.peak, Math.abs(values[i]));
    return plan;
  }
  plan.extents = channels.map((values) => columnExtents(times, values, t0, t1, columns));
  for (const { min, max } of plan.extents) {
    for (let c = 0; c < columns; c++) if (min[c] === min[c]) plan.peak = Math.max(plan.peak, -min[c], max[c]);
  }
  return plan;
}

// Gridlines at the time axis's ticks.
function timeTicks(width) {
  const { t0, t1 } = state.view;
  const step = niceStep(t1 - t0, Math.max(2, Math.floor(width / 90)));
  return { ticks: tickTimes(t0, t1, step), step };
}

function message(ctx, width, height, text) {
  ctx.fillStyle = colors.muted;
  ctx.font = `12px ${colors.mono}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, width / 2, height / 2);
  ctx.textAlign = "start";
}

function drawLane({ track, canvas }, plan, signal) {
  const { ctx, width, height } = fitCanvas(canvas);
  if (!state.view) return;
  const { t0, t1 } = state.view;
  const toX = (t) => ((t - t0) / (t1 - t0)) * width;
  for (const t of timeTicks(width).ticks) hairline(ctx, toX(t), 0, toX(t), height, colors.grid);

  // USER held: shaded.
  ctx.fillStyle = colors.signal;
  ctx.globalAlpha = 0.12;
  for (const { from, to } of track.presses) {
    if (to >= t0 && from <= t1) ctx.fillRect(toX(from), 0, Math.max(1, toX(to) - toX(from)), height);
  }
  ctx.globalAlpha = 1;

  if (!plan) {
    message(ctx, width, height, state.signal === "mic" ? "No mic level from this board: a flash recording keeps only the claps" : "No orientation from this board");
  } else if (state.signal === "mic") {
    drawLevel(ctx, plan, width, height, yScale(signal, height, state.y), toX);
  } else {
    drawSeries(ctx, plan, width, height, yScale(signal, height, state.y), toX);
  }

  // Claps: orange lines topped with a marker, as on the live Microphone panel.
  ctx.strokeStyle = colors.signal;
  ctx.fillStyle = colors.signal;
  ctx.lineWidth = 1.5;
  for (const event of track.events) {
    if (event.type !== "sync" || event.t < t0 || event.t > t1) continue;
    const x = toX(event.t);
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
  // Lost samples: red ticks along the foot.
  ctx.fillStyle = colors.bad;
  for (const gap of track.lost) if (gap.t >= t0 && gap.t <= t1) ctx.fillRect(Math.round(toX(gap.t)) - 1, height - 9, 3, 9);

  if (state.hoverT !== null) hairline(ctx, toX(state.hoverT), 0, toX(state.hoverT), height, colors.muted);
}

function drawSeries(ctx, plan, width, height, { plotHeight, toY: toPlotY }, toX) {
  // Far beyond the canvas is as good as just beyond it, and keeps canvas coordinates sane.
  const toY = (value) => Math.max(-height, Math.min(2 * height, toPlotY(value)));
  const { ticks, decimals } = valueTicks(state.y, plotHeight);
  ctx.font = `11px ${colors.mono}`;
  ctx.textBaseline = "middle";
  ctx.fillStyle = colors.muted;
  for (const value of ticks) {
    const y = toY(value);
    hairline(ctx, 0, y, width, y, value === 0 ? colors.line : colors.grid);
    ctx.fillText(value > 0 ? `+${value.toFixed(decimals)}` : value.toFixed(decimals), 4, y < 14 ? y + 8 : y - 8);
  }

  const { times, i0, i1, extents, columns } = plan;
  const columnWidth = width / columns;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = ctx.lineCap = "round";
  plan.channels.forEach((values, axis) => {
    ctx.strokeStyle = plan.colors[axis];
    ctx.beginPath();
    if (extents) {
      // Each column as a stroke from its lowest to its highest value, joined to the next.
      const { min, max } = extents[axis];
      let joined = false;
      for (let c = 0; c < columns; c++) {
        if (min[c] !== min[c]) {
          joined = false;
          continue;
        }
        const x = (c + 0.5) * columnWidth;
        if (joined) ctx.lineTo(x, toY(min[c]));
        else ctx.moveTo(x, toY(min[c]));
        ctx.lineTo(x, toY(max[c]));
        joined = true;
      }
    } else {
      for (let i = i0; i < i1; i++) {
        // Not across a gap, nor an angle wrapping from +180° to -180°.
        const bridged = i > i0 && times[i] - times[i - 1] <= 3 * plan.period &&
          !(plan.wraps && Math.abs(values[i] - values[i - 1]) > 180);
        if (bridged) ctx.lineTo(toX(times[i]), toY(values[i]));
        else ctx.moveTo(toX(times[i]), toY(values[i]));
      }
    }
    ctx.stroke();
  });
}

// The mic envelope as a dBFS bar graph, the loudest window per pixel column, as on the live panel.
function drawLevel(ctx, plan, width, height, { plotHeight, toY: toPlotY }, toX) {
  const toY = (dbfs) => (dbfs > state.y.t0 ? Math.max(0, toPlotY(dbfs)) : height); // silence draws nothing
  const { ticks, decimals } = valueTicks(state.y, plotHeight);
  for (const dbfs of ticks) hairline(ctx, 0, toY(dbfs), width, toY(dbfs), colors.grid);
  ctx.fillStyle = colors.readout;
  const { times, i0, i1, extents, columns } = plan;
  if (extents) {
    const { max } = extents[0];
    const columnWidth = width / columns;
    for (let c = 0; c < columns; c++) {
      const top = toY(max[c]);
      if (top < height) ctx.fillRect(c * columnWidth, top, Math.max(1, columnWidth), height - top);
    }
  } else {
    const [values] = plan.channels;
    for (let i = i0; i < i1; i++) {
      const top = toY(values[i]);
      const x = toX(times[i]);
      if (top < height) ctx.fillRect(x, top, Math.max(1, toX(times[i] + plan.period) - x), height - top);
    }
  }
  // Over the bars, so a noisy room doesn't hide the scale.
  ctx.font = `11px ${colors.mono}`;
  ctx.textBaseline = "middle";
  ctx.fillStyle = colors.muted;
  for (const dbfs of ticks) if (toY(dbfs) > 14) ctx.fillText(dbfs.toFixed(decimals), 4, toY(dbfs) - 7);
}

function drawAxis() {
  const canvas = $("replay-axis");
  const { ctx, width, height } = fitCanvas(canvas);
  if (!state.view) return;
  const { t0, t1 } = state.view;
  const { ticks, step } = timeTicks(width);
  const decimals = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
  ctx.font = `10.5px ${colors.mono}`;
  ctx.textBaseline = "top";
  ctx.fillStyle = colors.muted;
  for (const t of ticks) {
    const x = ((t - t0) / (t1 - t0)) * width;
    hairline(ctx, x, 0, x, 3, colors.muted);
    const label = `${(Math.abs(t) < step / 2 ? 0 : t).toFixed(decimals)} s`;
    const labelWidth = ctx.measureText(label).width;
    ctx.fillText(label, Math.min(Math.max(0, x - labelWidth / 2), width - labelWidth), 4);
  }
}

// The whole session, a thin row per shown board (its data's extent, claps, presses and lost
// samples), with the lanes' window outlined. Click or drag to move the window.
function drawOverview() {
  const canvas = $("replay-overview");
  const { ctx, width, height } = fitCanvas(canvas);
  if (!state.bounds) {
    message(ctx, width, height, "Open a session folder to replay it");
    return;
  }
  const { t0, t1 } = state.bounds;
  const toX = (t) => ((t - t0) / (t1 - t0)) * width;
  const rows = state.tracks.filter((track) => state.shown.has(track.board.folder));
  const rowHeight = height / Math.max(1, rows.length);
  rows.forEach((track, r) => {
    const top = r * rowHeight;
    const middle = top + rowHeight / 2;
    hairline(ctx, toX(track.imuT[0]), middle, toX(track.imuT.at(-1)), middle, colors.line);
    ctx.fillStyle = colors.signal;
    ctx.globalAlpha = 0.25;
    for (const { from, to } of track.presses) ctx.fillRect(toX(from), top + 2, Math.max(1, toX(to) - toX(from)), rowHeight - 4);
    ctx.globalAlpha = 1;
    for (const event of track.events) if (event.type === "sync") ctx.fillRect(Math.round(toX(event.t)), top + 2, 1.5, rowHeight - 4);
    ctx.fillStyle = colors.bad;
    for (const gap of track.lost) ctx.fillRect(Math.round(toX(gap.t)), middle, 2, rowHeight / 2 - 1);
  });
  const left = toX(state.view.t0);
  const right = toX(state.view.t1);
  ctx.fillStyle = colors.text;
  ctx.globalAlpha = 0.08;
  ctx.fillRect(left, 0, right - left, height);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = colors.signal;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(left + 0.75, 0.75, Math.max(1, right - left - 1.5), height - 1.5);
}

// Each lane's values at the pointer's time, beside its name.
function renderReadouts(signal, plans) {
  $("replay-time").textContent = state.hoverT === null ? "" : `t = ${state.hoverT.toFixed(3)} s`;
  const width = state.lanes[0]?.canvas.clientWidth || 1;
  state.lanes.forEach(({ values }, lane) => {
    const plan = plans[lane];
    let shown = null;
    if (plan && state.hoverT !== null) {
      const i = nearestIndex(plan.times, state.hoverT);
      const tolerance = Math.max(3 * plan.period, (2 * (state.view.t1 - state.view.t0)) / width);
      if (i >= 0 && Math.abs(plan.times[i] - state.hoverT) <= tolerance) shown = plan.channels.map((channel) => channel[i]);
    }
    [...values.children].forEach((cell, axis) => {
      const value = shown?.[axis];
      cell.lastElementChild.textContent = Number.isFinite(value) ? value.toFixed(signal.decimals) : "–";
    });
  });
}

// ---- navigation ---------------------------------------------------------------------------
// Scroll (or pinch) zooms about the pointer, a sideways scroll or a drag pans, double-click shows
// the whole session; with the lanes focused, the arrow keys pan, + and - zoom, 0 shows it all.
// Vertically: Option-scroll, or a scroll over the value labels at a lane's left edge, zooms about
// the pointer's value, ↑ and ↓ zoom, and once zoomed a drag pans up and down too.

function wireLanes() {
  const lanes = $("replay-lanes");
  const box = () => state.lanes[0]?.canvas.getBoundingClientRect();
  const timeAt = (clientX) => {
    const rect = box();
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return state.view.t0 + fraction * (state.view.t1 - state.view.t0);
  };
  const span = () => state.view.t1 - state.view.t0;
  const signal = () => SIGNALS[state.signal];
  const zoomY = (factor, anchor) => {
    if (!state.y) return;
    const limits = yLimits(signal());
    setYView(zoomView(state.y, factor, anchor, limits, MIN_Y_FRACTION * (limits.t1 - limits.t0)));
  };
  let drag = null;

  lanes.addEventListener("pointerdown", (event) => {
    if (!state.view || event.target.tagName !== "CANVAS" || event.button !== 0) return;
    drag = { x: event.clientX, y: event.clientY, view: state.view, yView: state.yView, width: box().width, height: event.target.clientHeight };
    lanes.setPointerCapture(event.pointerId);
    lanes.classList.add("panning");
  });
  lanes.addEventListener("pointermove", (event) => {
    if (!state.view || !state.lanes.length) return;
    if (drag) {
      state.view = panView(drag.view, (-(event.clientX - drag.x) / drag.width) * (drag.view.t1 - drag.view.t0), state.bounds);
      if (drag.yView) {
        const { plotHeight } = yScale(signal(), drag.height, drag.yView);
        const dy = ((event.clientY - drag.y) / plotHeight) * (drag.yView.t1 - drag.yView.t0);
        state.yView = panView(drag.yView, dy, yLimits(signal()));
      }
    }
    state.hoverT = timeAt(event.clientX);
    lanes.classList.toggle("y-zone", !drag && event.target.tagName === "CANVAS" && event.clientX - box().left < Y_LABEL_PX);
    requestDraw();
  });
  const endDrag = () => {
    drag = null;
    lanes.classList.remove("panning");
  };
  lanes.addEventListener("pointerup", endDrag);
  // A touch that turns into a vertical scroll.
  lanes.addEventListener("pointercancel", endDrag);
  lanes.addEventListener("pointerleave", () => {
    state.hoverT = null;
    requestDraw();
  });
  lanes.addEventListener("dblclick", showAll);
  lanes.addEventListener("wheel", (event) => {
    if (!state.view || !state.lanes.length) return;
    event.preventDefault();
    const rect = box();
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.width : 1;
    const overLabels = event.target.tagName === "CANVAS" && event.clientX - rect.left < Y_LABEL_PX;
    if ((event.altKey || overLabels) && event.target.tagName === "CANVAS" && Math.abs(event.deltaY) >= Math.abs(event.deltaX)) {
      const laneBox = event.target.getBoundingClientRect();
      const { valueAt } = yScale(signal(), laneBox.height, state.y);
      zoomY(Math.exp(event.deltaY * scale * (event.ctrlKey ? 0.01 : 0.002)), valueAt(event.clientY - laneBox.top));
    } else if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      setView(panView(state.view, ((event.deltaX * scale) / rect.width) * span(), state.bounds));
    } else {
      // A trackpad pinch arrives as a wheel event with ctrlKey set, in smaller steps.
      const factor = Math.exp(event.deltaY * scale * (event.ctrlKey ? 0.01 : 0.002));
      setView(zoomView(state.view, factor, timeAt(event.clientX), state.bounds, MIN_SPAN_S));
    }
  }, { passive: false });
  lanes.addEventListener("keydown", (event) => {
    if (!state.view) return;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      zoomY(event.key === "ArrowUp" ? 0.5 : 2, (state.y.t0 + state.y.t1) / 2);
      return;
    }
    if (event.key === "0" || event.key === "Home") {
      event.preventDefault();
      showAll();
      return;
    }
    const middle = (state.view.t0 + state.view.t1) / 2;
    const step = event.shiftKey ? span() : span() / 5;
    const views = {
      ArrowLeft: () => panView(state.view, -step, state.bounds),
      ArrowRight: () => panView(state.view, step, state.bounds),
      "+": () => zoomView(state.view, 0.5, middle, state.bounds, MIN_SPAN_S),
      "=": () => zoomView(state.view, 0.5, middle, state.bounds, MIN_SPAN_S),
      "-": () => zoomView(state.view, 2, middle, state.bounds, MIN_SPAN_S),
    };
    if (!views[event.key]) return;
    event.preventDefault();
    setView(views[event.key]());
  });
}

function wireOverview() {
  const canvas = $("replay-overview");
  const centreAt = (event) => {
    if (!state.view) return;
    const rect = canvas.getBoundingClientRect();
    const t = state.bounds.t0 + ((event.clientX - rect.left) / rect.width) * (state.bounds.t1 - state.bounds.t0);
    setView(panView(state.view, t - (state.view.t0 + state.view.t1) / 2, state.bounds));
  };
  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture(event.pointerId);
    centreAt(event);
  });
  canvas.addEventListener("pointermove", (event) => canvas.hasPointerCapture(event.pointerId) && centreAt(event));
}
