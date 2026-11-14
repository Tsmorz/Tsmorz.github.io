// Task workspaces, waveform editing and experiments. The recorder owns the serial connection;
// this module owns no port, raw takes, or capture scores.
import * as H from "./haptics-core.js";
import { pause, checkAbort, measuredVibration } from "./device.js";
import { project, principalAxis, analyze } from "./analysis.js";
import { decodeSession } from "./session.js";
import { Plot, XYPlot, readColors, drawAxis } from "./plots.js";
import { welch } from "./spectrum.js";
import { INFO_IMU_OK, INFO_TACHAMMER_OK, INFO_ERM_OK } from "./wire.js";

const $ = (id) => document.getElementById(id);
const node = (tag, text, cls = "") => Object.assign(document.createElement(tag), { textContent: text, className: cls });
const json = (value) => JSON.stringify(value, (_, v) => ArrayBuffer.isView(v) ? Array.from(v) : v, 2);
const id = () => `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const finiteArray = (x, max, limit = Infinity) => (Array.isArray(x) || ArrayBuffer.isView(x)) && x.length > 0 && x.length <= max && Array.from(x).every((v) => Number.isFinite(v) && Math.abs(v) <= limit);
const sameTarget = (a, b) => a?.kind === "recording" && b?.kind === "recording" && a.take === b.take && a.t0 === b.t0 && a.t1 === b.t1 && a.axis === b.axis;
function download(name, value, type = "application/json") {
  const url = URL.createObjectURL(new Blob([value], { type })), a = node("a", "");
  a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export async function mountStudio(api) {
  const content = JSON.parse($("studio-content").textContent);
  const controls = content.controls;
  let workspace = "collect", rawTarget = null, targetAbout = null, result = null, model = null;
  let busy = false, operation = null, selected = null, dirtyVariant = true, uploaded = false, signalError = "";
  let lastRound = null, variants = [], profiles = [], undo = [], saveTimer, settingsTimer;
  let audioCtx = null, audioSource = null;
  const plots = { target: new Plot($("plot-target")), drive: new Plot($("plot-drive")), erm: new Plot($("plot-erm")), envelope: new Plot($("plot-envelope")) };
  const spectrum = new XYPlot($("plot-drive-spectrum")), bands = new XYPlot($("plot-band-comparison"));
  const responsePlot = new XYPlot($("plot-response")), coherencePlot = new XYPlot($("plot-coherence"));
  const snapshot = () => Object.fromEntries(Array.from($("signal-form").elements).filter((el) => el.name).map((el) => [el.name, el.value]));
  const settings = () => {
    const o = snapshot();
    for (const c of controls) o[c.id] = Number(o[c.id]);
    o.regularization = Number(o.regularization); o.correctionGain = Number(o.correctionGain);
    return o;
  };
  const effectiveModel = () => model && Boolean(model.simulated) === (api.source()?.kind === "demo") ? model : null;
  const message = (text, bad = false) => { $("actuator-status").textContent = text; $("actuator-status").className = `status-line${bad ? " bad" : ""}`; };
  const stopAudio = () => {
    if (audioSource) { audioSource.onended = null; audioSource.stop(); audioSource = null; }
    $("listen-drive").textContent = "Listen on computer";
  };
  const listen = async (drive) => {
    stopAudio(); api.stopAudio();
    audioCtx ??= new AudioContext(); await audioCtx.resume();
    const samples = H.resample(drive, H.GRID, 8000), buffer = audioCtx.createBuffer(1, samples.length, 8000);
    buffer.copyToChannel(Float32Array.from(samples), 0);
    audioSource = audioCtx.createBufferSource(); audioSource.buffer = buffer; audioSource.connect(audioCtx.destination); audioSource.start();
    $("listen-drive").textContent = "Stop listening";
    audioSource.onended = () => { audioSource = null; $("listen-drive").textContent = "Listen on computer"; };
    message("Listening on this computer; this is an audio preview, not an actuator measurement.");
  };

  function showWorkspace(next, focus = false) {
    if (next !== workspace) stopAudio();
    workspace = next;
    document.body.dataset.workspace = next;
    $("studio-title").textContent = next === "compare" ? content.labels.comparison : content.labels.waveform;
    $("workspace").setAttribute("aria-labelledby", `tab-${next}`);
    for (const tab of document.querySelectorAll(".workspace-nav [role=tab]")) {
      const active = tab.dataset.workspace === next;
      tab.setAttribute("aria-selected", String(active)); tab.tabIndex = active ? 0 : -1;
    }
    document.querySelector(".studio-section").hidden = next !== "tune" && next !== "compare";
    document.querySelector(".scope-section").hidden = next === "tune" || next === "compare";
    document.querySelector(".score-section").hidden = next !== "inspect";
    if (next === "collect") api.setMode("live");
    else if (next === "inspect") api.setMode("replay");
    else api.stopAudio();
    $("scope-heading").textContent = next === "collect" ? "Live signals" : "Recorded signals";
    $("selection-tools").hidden = next !== "inspect";
    if (focus) $("workspace").focus({ preventScroll: true });
    api.redraw(); requestAnimationFrame(draw);
  }
  document.querySelectorAll(".workspace-nav [role=tab]").forEach((tab, i, tabs) => {
    tab.addEventListener("click", () => showWorkspace(tab.dataset.workspace));
    tab.addEventListener("keydown", (event) => {
      let at = i;
      if (event.key === "ArrowRight") at = (i + 1) % tabs.length;
      else if (event.key === "ArrowLeft") at = (i + tabs.length - 1) % tabs.length;
      else if (event.key === "Home") at = 0;
      else if (event.key === "End") at = tabs.length - 1;
      else return;
      event.preventDefault(); tabs[at].focus(); showWorkspace(tabs[at].dataset.workspace);
    });
  });

  function fill(values) {
    for (const [name, v] of Object.entries(values)) {
      const el = $("signal-form").elements.namedItem(name);
      if (el) el.value = v;
      if ($(`range-${name}`)) $(`range-${name}`).value = v;
    }
  }

  async function persist() {
    try {
      await api.store().putState("studio", { model, profiles, variants, draft: result ? { settings: settings(), rawTarget, targetAbout, result, lastRound, selected, dirtyVariant } : null });
      $("experiment-storage").textContent = api.store().persistent ? "Saved locally · not exported" : "Memory only · export to keep";
    } catch {
      $("experiment-storage").textContent = "Not saved · export to keep";
      message("Browser storage is full or unavailable. Export this experiment to keep it.", true);
    }
  }
  const scheduleSave = () => { clearTimeout(saveTimer); saveTimer = setTimeout(persist, 400); };

  function controlsChanged() {
    if (busy) return;
    undo.push({ settings: result?.settings ?? settings(), rawTarget, targetAbout, result, lastRound });
    if (undo.length > 30) undo.shift();
    rebuild();
  }
  $("signal-form").addEventListener("submit", (e) => e.preventDefault());
  for (const c of controls) {
    const number = $(`signal-${c.id}`), range = $(`range-${c.id}`);
    range.addEventListener("input", () => { number.value = range.value; clearTimeout(settingsTimer); settingsTimer = setTimeout(controlsChanged, 100); });
    range.addEventListener("change", () => { clearTimeout(settingsTimer); controlsChanged(); });
    number.addEventListener("change", () => { range.value = number.value; controlsChanged(); });
  }
  for (const name of ["kind", "output", "axis", "regularization", "correctionGain"]) $("signal-form").elements.namedItem(name).addEventListener("change", controlsChanged);
  document.querySelectorAll("[data-preset]").forEach((b) => b.addEventListener("click", () => {
    undo.push({ settings: settings(), rawTarget, targetAbout, result, lastRound });
    fill(content.presets[Number(b.dataset.preset)]); rebuild();
  }));
  $("undo-tuning").addEventListener("click", () => {
    const previous = undo.pop(); if (!previous) return;
    fill(previous.settings); rawTarget = previous.rawTarget; targetAbout = previous.targetAbout; result = previous.result; lastRound = previous.lastRound;
    uploaded = false; dirtyVariant = true; refresh(); draw(); scheduleSave();
  });

  function rebuild() {
    uploaded = false; dirtyVariant = true; lastRound = null;
    signalError = "";
    try {
      if (!$("signal-form").checkValidity()) {
        const invalid = $("signal-form").querySelector(":invalid");
        throw new Error(`${invalid?.name || "Signal settings"}: ${invalid?.validationMessage || "check this value"}`);
      }
      const s = settings();
      if (s.high <= s.low) throw new Error("The upper passband frequency must be above the lower frequency.");
      let raw;
      if (s.kind === "recording") {
        if (!rawTarget || !targetAbout) throw new Error("Select a stroke in Inspect, then choose Create actuator signal.");
        if (s.axis !== targetAbout.axis && api.loaded()?.id === targetAbout.take) {
          const made = H.recordingTarget(api.loaded().analysis, targetAbout.t0, targetAbout.t1, s.axis);
          rawTarget = made.target; targetAbout = { ...targetAbout, axis: s.axis };
        } else if (s.axis !== targetAbout.axis) throw new Error("Open the source take in Inspect before changing its axis.");
        raw = rawTarget;
      } else raw = H.makeSignal(s);
      result = { ...H.generate(raw, s, effectiveModel()), settings: s };
      message("Preview updated. Play & measure to test these settings.");
    } catch (err) { result = null; signalError = err.message; message(err.message, true); }
    refresh(); draw(); scheduleSave();
  }

  function refresh() {
    const s = settings(), source = api.source(), info = api.info(), demo = source?.kind === "demo";
    const validModel = effectiveModel();
    $("signal-form").querySelectorAll("input, select, button").forEach((el) => { el.disabled = busy; });
    $("connect").disabled = busy || source?.kind === "demo" || !("serial" in navigator);
    $("demo").disabled = busy || source?.kind === "serial";
    $("record").disabled = busy || !source;
    $("record-another").disabled = busy || !source;
    $("retry-take").disabled = busy || !source;
    const hide = (name, hidden) => { const el = document.querySelector(`[data-control=${name}]`); if (el) el.hidden = hidden; };
    hide("seconds", s.kind === "recording"); hide("frequency", !["sine", "sweep", "pulse"].includes(s.kind));
    hide("endFrequency", s.kind !== "sweep"); hide("width", s.kind !== "pulse"); hide("ermShare", s.output !== "both");
    $("signal-axis").disabled = busy || s.kind !== "recording";
    $("target-source").textContent = s.kind === "recording" && targetAbout ? `${targetAbout.label || "Recording"}: ${targetAbout.t0.toFixed(3)}–${targetAbout.t1.toFixed(3)} s${targetAbout.simulated ? " · simulated source" : ""}` : "To use a recording, select a stroke in Inspect.";
    $("profile-state").textContent = model ? `${model.simulated ? "Simulated" : "Measured"}${validModel ? "" : " · inactive for this source"}` : "Not measured · open to measure or import";
    $("profile-select").replaceChildren(Object.assign(node("option", "No active profile"), { value: "" }), ...profiles.map((p) => Object.assign(node("option", `${p.simulated ? "Demo: " : ""}${p.note || "Imported response"} · ${p.created ? new Date(p.created).toLocaleDateString() : "imported"}`), { value: p.id })));
    $("profile-select").value = model?.id ?? ""; $("profile-select").disabled = busy;
    $("profile-plots").hidden = !model;
    $("profile-description").textContent = model ? `${model.note || "No setup note"} · ${model.created ? new Date(model.created).toLocaleString() : "Imported profile"}${model.board != null ? ` · board ${model.board}` : ""} · delay ${(model.delay / H.GRID * 1000).toFixed(1)} ms${model.erm_gain_g ? ` · ERM ${model.erm_gain_g.toFixed(3)} g/full scale` : " · ERM not measured"}` : "Measure or import a profile to compensate for the actuator's frequency response.";
    $("output-destination").textContent = demo ? "Simulated actuators · no physical output" : source?.kind === "serial" ? `Board ${info?.board_id?.toString(16).toUpperCase() ?? "…"} · ${s.output === "both" ? "TacHammer + ERM" : s.output === "erm" ? "ERM" : "TacHammer"}` : "No device connected";
    const rate = info?.haptic_rate_hz;
    const max = demo ? 6 : rate && info?.clip_max_samples ? info.clip_max_samples / rate : 0;
    $("clip-capacity").textContent = max ? `Clip capacity ${max.toFixed(2)} s${demo ? "" : ` · ${rate.toLocaleString()} samples/s`}` : "Waiting for compatible capture firmware";
    let reason = "";
    if (!source) reason = "Connect a board or start Demo in Collect.";
    else if (api.recording()) reason = "Stop recording before testing actuators.";
    else if (!demo && s.kind === "recording" && targetAbout?.simulated) reason = "This target is simulated. Use Demo to test it, or select a physical recording.";
    else if (result?.calibrated && !validModel) reason = "This drive uses an incompatible response profile. Select a matching profile to regenerate it.";
    else if (!demo && !(info?.flags & INFO_TACHAMMER_OK)) reason = "The capture firmware's I²S output is not ready.";
    else if (!demo && !(info?.flags & INFO_IMU_OK)) reason = "The IMU must be ready to measure a response.";
    else if (!demo && s.output !== "hammer" && !(info?.flags & INFO_ERM_OK)) reason = "The ERM driver is not ready.";
    else if (!demo && (info?.version < 3 || info?.version > 5)) reason = "Actuator playback needs compatible capture firmware (protocols 3–5).";
    else if (!result) reason = signalError || "Choose a valid source and signal settings.";
    else if (!max || result.drive.length / H.GRID > max + 1e-6) reason = `Shorten the signal to fit the device's ${max.toFixed(2)} s clip capacity.`;
    $("play-actuators").disabled = busy || Boolean(reason);
    $("play-actuators").title = reason || "Play this signal and record the actuator response";
    $("play-actuators").textContent = demo ? "Simulate & measure" : "Play & measure";
    if (!busy && reason) message(reason, false);
    else if (!busy && model && !validModel) message("This profile belongs to a different source. Measure or import a matching profile before calibrated playback.", true);
    else if (!busy && model?.board != null && !demo && model.board !== info?.board_id) message("This response profile was measured on another board. Check its setup or measure again.", true);
    $("measure-profile").disabled = busy || !source || api.recording() || (!demo && (!(info?.flags & INFO_IMU_OK) || !(info?.flags & INFO_TACHAMMER_OK) || (info?.version < 3 || info?.version > 5)));
    $("export-profile").disabled = !model; $("import-profile").disabled = busy;
    $("stop-actuators").disabled = !busy;
    $("save-variant").disabled = busy || !result;
    $("undo-tuning").disabled = busy || !undo.length;
    $("listen-drive").disabled = busy || !result || H.peak(result.drive) < 1e-8;
    $("listen-drive").title = result && H.peak(result.drive) < 1e-8 ? "The ERM envelope has no audio waveform; play it on the actuators to feel it." : "Audio preview of the TacHammer command";
    $("refine-drive").disabled = busy || !lastRound?.score || !validModel || !result || s.output === "erm";
    const comparable = variants.filter((v) => v.score && sameTarget(v.about, targetAbout) && v.about.axis === s.axis && v.simulated === demo && v.settings.low === s.low && v.settings.high === s.high && v.settings.attack === s.attack && v.settings.release === s.release);
    $("restore-best").disabled = busy || !comparable.length;
    $("restore-best").onclick = () => loadVariant(comparable.reduce((a, b) => a.score.bandError < b.score.bandError ? a : b));
    if (result) {
      const calibrated = result.calibrated;
      $("signal-summary").textContent = `${s.kind === "recording" ? calibrated ? "Profile-compensated recording" : "Uncalibrated recording · shape normalized to the drive limit" : "Test signal"} · ${(result.drive.length / H.GRID).toFixed(2)} s · ${s.low}–${s.high} Hz · peak ${(H.peak(result.drive) * 100).toFixed(1)}%${result.clipped > 0 ? ` · ${(result.clipped * 100).toFixed(1)}% of samples limited` : ""}${uploaded ? " · played with current settings" : " · current settings not yet played"}${s.output !== "hammer" && !model?.erm_gain_g ? " · ERM level uncalibrated" : ""}`;
      $("target-heading").textContent = s.kind === "recording" ? "Target vibration (g)" : "Source shape (normalized)";
      $("target-readout").textContent = `${H.rms(result.target).toFixed(3)} ${s.kind === "recording" ? "g RMS" : "RMS"}${s.kind === "recording" && (lastRound || result.predicted) ? ` · dashed: ${lastRound ? "measured" : "predicted TacHammer"}` : ""}`;
      $("drive-readout").textContent = `Limit ${s.strength}% · peak ${(H.peak(result.drive) * 100).toFixed(1)}%`;
    } else $("signal-summary").textContent = "Choose a valid source to preview a signal.";
    $("erm-plot-wrap").hidden = !result?.erm;
    const score = lastRound?.score;
    $("metric-band").textContent = score ? score.bandError.toFixed(2) : "—";
    $("metric-envelope").textContent = score?.envelope != null ? score.envelope.toFixed(3) : "—";
    $("metric-rms").textContent = score ? score.nrmse.toFixed(3) : "—";
    $("measurement-kind").textContent = lastRound ? lastRound.simulated ? "Simulated response" : "Measured on board" : "Not measured";
    $("comparison-note").textContent = lastRound ? score ? "Solid: target. Dashed: measured. Both start at the device's playback timestamp; differences include actuator delay." : "Response recorded. This test signal has no acceleration target; select a recording to score reproduction accuracy." : "No measured response yet. A dashed prediction is an estimate of the TacHammer only; ERM contributions require measurement.";
    renderVariants();
  }

  function draw() {
    if (workspace !== "tune" && workspace !== "compare") return;
    const c = readColors(), seconds = result ? result.drive.length / H.GRID : 1;
    if (model) {
      responsePlot.draw({ colors: c, x: [20, 600], xLog: true, xFmt: (f) => `${f} Hz`, yFmt: (v) => `${v.toFixed(0)} dB`, series: [{ x: model.freqs, y: model.h_re.map((r, i) => 20 * Math.log10(Math.hypot(r, model.h_im[i]) + 1e-12)), color: c.signal }] });
      coherencePlot.draw({ colors: c, x: [20, 600], xLog: true, y: [0, 1], xFmt: (f) => `${f} Hz`, yFmt: (v) => v.toFixed(1), series: [{ x: model.freqs, y: model.coherence, color: c.x }, { x: [20, 600], y: [0.5, 0.5], color: c.text, dash: [4, 3] }] });
    }
    const series = (x, color, scale = 1, dt = 1 / H.GRID, dash) => ({ t0: 0, dt, n: x?.length ?? 0, y: x ?? [], color, scale, dash });
    const common = { t0: 0, t1: seconds, colors: c };
    const targets = result ? [series(result.target, c.signal)] : [];
    if (result?.settings.kind === "recording" && result.predicted && !lastRound) targets.push(series(result.predicted, c.x, 1, 1 / H.GRID, [5, 3]));
    if (lastRound) targets.push(series(lastRound.measured, c.x, 1, 1 / H.GRID, [5, 3]));
    // Test-signal shapes are dimensionless and cannot share an axis with measured g.
    plots.target.draw({ ...common, series: result?.settings.kind === "recording" ? targets : result ? [series(result.target, c.signal)] : [], yOptions: { symmetric: true, min: 0.01 } });
    plots.drive.draw({ ...common, series: result ? [series(result.drive, c.signal, 100)] : [], yOptions: { fixed: [-100, 100] } });
    plots.erm.draw({ ...common, series: result?.erm ? [series(result.erm, c.y, 100, 0.01)] : [], yOptions: { fixed: [0, 100] } });
    drawAxis($("target-axis"), 0, seconds, c);
    const spec = result && welch(result.drive, H.GRID, { nfft: 512 });
    spectrum.draw({ colors: c, x: [1, 800], xLog: true, yFloorDb: 80, xFmt: (v) => `${v} Hz`, yFmt: (v) => `${v.toFixed(0)} dB`,
      bands: result ? [{ x0: result.settings.low || 1, x1: result.settings.high, color: getComputedStyle(document.documentElement).getPropertyValue("--band-away").trim() }] : [],
      series: spec ? [{ x: spec.freqs, y: Float64Array.from(spec.psd, (v) => 10 * Math.log10(v + 1e-20)), color: c.signal }] : [] });
    const score = lastRound?.score;
    bands.draw({ colors: c, x: [20, 500], xLog: true, xFmt: (v) => `${v} Hz`, yFmt: (v) => `${v.toFixed(0)} dB`,
      series: score ? [{ x: H.BANDS, y: score.targetBands, color: c.signal }, { x: H.BANDS, y: score.measuredBands, color: c.x, dash: [5, 3] }] : [] });
    plots.envelope.draw({ ...common, series: score ? [series(H.envelope(result.target), c.signal, 1, 0.02), series(H.envelope(lastRound.measured), c.x, 1, 0.02, [5, 3])] : lastRound ? [series(H.envelope(lastRound.measured), c.x, 1, 0.02)] : [], yOptions: { min: 0.005 } });
  }

  function validatePlayback() {
    if (api.recording()) throw new Error("Stop recording before testing actuators.");
    if (!api.source()) throw new Error("Connect a board or start Demo in Collect.");
    const repeats = Number($("play-repeats").value), gap = Number($("play-gap").value);
    if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10 || !Number.isFinite(gap) || gap < 0.1 || gap > 10) throw new Error("Use 1–10 repeats and a pause of 0.1–10 s.");
    return { repeats, gap };
  }
  async function run(work) {
    if (busy) return;
    try { validatePlayback(); } catch (err) { message(err.message, true); return; }
    busy = true; operation = new AbortController();
    api.stopAudio(); stopAudio(); refresh();
    try { await work(operation.signal); }
    catch (err) {
      if (err.name !== "AbortError") {
        await api.client()?.stop().catch(() => {});
        message(err.message, true);
      } else message("Stopped. Your saved takes and variants are unchanged.");
    } finally {
      busy = false; operation = null; $("upload-progress").hidden = true; refresh(); draw(); scheduleSave();
    }
  }
  async function measure(drive, erm, signal) {
    checkAbort(signal);
    if (api.source()?.kind === "demo") {
      message("Simulating actuator playback and measurement…");
      await pause(300 + drive.length / H.GRID * 100, signal);
      return { vibration: H.demoVibration(drive, erm), simulated: true };
    }
    const info = api.info(), client = api.client();
    if (!client) throw new Error("Device disconnected.");
    const played = await client.play(drive, erm, info, signal, (phase, amount) => {
      message(`${phase}${phase === "Uploading" ? ` ${Math.round(amount * 100)}%` : ""} · ${$("output-destination").textContent}`);
      $("upload-progress").hidden = phase !== "Uploading"; $("upload-progress").value = amount;
    });
    const session = decodeSession(played.raw);
    session.info ??= info;
    const analysis = analyze(session);
    return { vibration: measuredVibration(analysis, played.report, drive.length), simulated: false, raw: played.raw, report: played.report };
  }
  async function playResult(signal) {
    const { repeats, gap } = validatePlayback();
    const current = result;
    if (!current) throw new Error("Choose a valid signal first.");
    for (let i = 0; i < repeats; i++) {
      const measured = await measure(current.drive, current.erm, signal);
      const axis = effectiveModel()?.axis ?? principalAxis(measured.vibration);
      const vibration = project(measured.vibration, axis);
      lastRound = { measured: vibration, score: current.settings.kind === "recording" ? H.compare(current.target, vibration) : null, ...measured, vibration: undefined };
      uploaded = true;
      await saveVariant(`Round ${variants.filter((v) => sameTarget(v.about, targetAbout)).length + 1}`, false);
      if (i < repeats - 1) { message(`Repeat ${i + 1}/${repeats} complete. Pausing…`); await pause(gap * 1000, signal); }
    }
    showWorkspace("compare");
    message(`Complete · ${lastRound.simulated ? "simulated response" : "response measured on board"}. Saved with this drive and settings.`);
  }
  $("play-actuators").addEventListener("click", () => run(playResult));
  async function stop() {
    operation?.abort(); stopAudio();
    const client = api.client();
    if (client) {
      try { await client.stop(); }
      catch (err) { message(`Stop command not acknowledged: ${err.message}`, true); }
    }
  }
  $("stop-actuators").addEventListener("click", stop);
  addEventListener("keydown", (e) => { if (e.key === "Escape" && busy) { e.preventDefault(); stop(); } });
  $("listen-drive").addEventListener("click", () => {
    if (audioSource) { stopAudio(); message("Listening stopped."); }
    else if (result) listen(result.drive).catch((err) => message(err.message, true));
  });

  $("measure-profile").addEventListener("click", () => run(async (signal) => {
    const note = $("profile-note").value.trim();
    if (!note) { $("profile-note").focus(); throw new Error("Describe the mounting, grip and supply before measuring a response."); }
    const max = api.source()?.kind === "demo" ? 6 : api.info().clip_max_samples / api.info().haptic_rate_hz;
    if (max < 1) throw new Error("The device needs at least 1 s of clip capacity to measure a response.");
    const seconds = Math.min(2, max), limit = Number($("signal-strength").value) / 100, takes = [];
    for (const [i, scale] of [0.25, 0.5, 1].entries()) {
      const x = H.fade(H.makeSignal({ kind: "sweep", seconds, frequency: 20, endFrequency: 600 }));
      const drive = H.boundDrive(Float64Array.from(x, (v) => v * limit * scale), Math.min(H.PREVIEW_PEAK, limit * 0.95));
      message(`Measuring response ${i + 1}/3…`);
      const measured = await measure(drive, null, signal);
      takes.push({ drive, vibration: measured.vibration });
      await pause(300, signal);
    }
    const next = H.identify(takes);
    if (api.source()?.kind === "demo" || api.info()?.flags & INFO_ERM_OK) {
      const drive = new Float64Array(H.GRID), erm = Float64Array.from({ length: 100 }, (_, i) => i >= 10 && i < 90 ? limit : 0);
      const response = await measure(drive, erm, signal);
      const mag = Float64Array.from({ length: H.GRID }, (_, i) => Math.hypot(...response.vibration.subarray(3 * i, 3 * i + 3)));
      const steady = H.rms(mag.subarray(H.GRID * 0.5, H.GRID * 0.8));
      if (steady > 1e-4) {
        next.erm_gain_g = steady / limit;
        const env = H.envelope(mag, 16), at = env.findIndex((v, i) => i >= 10 && v >= 0.63 * steady);
        next.erm_rise_s = at >= 10 ? (at - 10) / 100 : null;
      }
    }
    model = { ...next, id: id(), note, created: new Date().toISOString(), board: api.info()?.board_id ?? null, simulated: api.source()?.kind === "demo" };
    profiles.push(model);
    document.querySelector(".profile-panel").open = false;
    await persist(); rebuild(); message("Response profile saved. Recorded targets now use this model to generate their drive.");
  }));
  $("import-profile").addEventListener("click", () => $("profile-input").click());
  $("profile-input").addEventListener("change", async () => {
    const file = $("profile-input").files[0]; if (!file) return;
    try {
      if (file.size > 2e6) throw new Error("This profile is too large.");
      model = { ...H.validateModel(JSON.parse(await file.text())), id: id() };
      profiles.push(model); $("profile-note").value = model.note || "";
      rebuild(); await persist();
    } catch (err) { message(err.message, true); }
    $("profile-input").value = "";
  });
  $("export-profile").addEventListener("click", () => model && download("model.json", json(model)));
  $("profile-select").addEventListener("change", () => {
    model = profiles.find((p) => p.id === $("profile-select").value) ?? null;
    $("profile-note").value = model?.note || ""; rebuild();
  });
  document.querySelector(".profile-panel").addEventListener("toggle", draw);
  $("refine-drive").addEventListener("click", () => {
    if (!lastRound?.score || !effectiveModel()) return;
    const s = settings(); undo.push({ settings: s, rawTarget, targetAbout, result, lastRound });
    const drive = H.boundDrive(H.refine(result.drive, result.target, lastRound.measured, effectiveModel(), s.correctionGain, s.regularization, s.strength / 100), Math.min(H.PREVIEW_PEAK, s.strength / 100 * 0.95));
    result = { ...result, drive, predicted: H.predict(drive, effectiveModel()) }; lastRound = null; uploaded = false; dirtyVariant = true;
    showWorkspace("tune"); refresh(); draw(); scheduleSave(); message("Correction applied. Play & measure to evaluate this round.");
  });

  function variantData(name) {
    return { id: id(), created: new Date().toISOString(), name, notes: $("variant-notes").value.trim(), preferred: $("prefer-variant").checked,
      settings: settings(), about: result.settings.kind === "recording" ? targetAbout : { kind: result.settings.kind }, rawTarget: result.settings.kind === "recording" ? rawTarget : null,
      result: structuredClone(result), profile: effectiveModel(), measured: lastRound?.measured ?? null, score: lastRound?.score ?? null,
      raw: lastRound?.raw ?? null, report: lastRound?.report ?? null, simulated: api.source()?.kind === "demo" || Boolean(targetAbout?.simulated && result.settings.kind === "recording") };
  }
  async function saveVariant(name, manual = true) {
    if (!result) return;
    const v = variantData(name || $("variant-name").value.trim() || `Variant ${variants.length + 1}`);
    variants.push(v); selected = v.id; dirtyVariant = false;
    $("variant-name").value = v.name; renderVariants(); await persist();
    if (manual) message(`Saved “${v.name}” with its source, settings and measurement.`);
  }
  $("save-variant").addEventListener("click", () => saveVariant());
  function loadVariant(v) {
    if (busy || !v) return;
    fill(v.settings); result = structuredClone(v.result); rawTarget = v.rawTarget ? Float64Array.from(v.rawTarget) : null; targetAbout = v.about;
    lastRound = v.measured ? { measured: Float64Array.from(v.measured), score: v.score, simulated: v.simulated, raw: v.raw, report: v.report } : null;
    selected = v.id; dirtyVariant = false; uploaded = false;
    $("variant-name").value = v.name; $("variant-notes").value = v.notes || ""; $("prefer-variant").checked = Boolean(v.preferred);
    model = v.profile ?? null;
    if (model) {
      if (!model.id || !profiles.some((p) => p.id === model.id)) { model = { ...model, id: id() }; profiles.push(model); }
      $("profile-note").value = model.note || "";
    }
    refresh(); draw(); scheduleSave();
    if (!$("play-actuators").disabled) message(`Loaded “${v.name}”.${lastRound ? " Showing its saved response." : " Ready to play and measure."}`);
  }
  function renderVariants() {
    const selectValue = (key) => $(key).value;
    const a = selectValue("variant-a"), b = selectValue("variant-b");
    for (const key of ["variant-a", "variant-b"]) {
      $(key).replaceChildren(...variants.map((v) => Object.assign(node("option", `${v.name}${v.simulated ? " (simulated)" : ""}`), { value: v.id })));
      const current = key === "variant-a" ? a : b;
      $(key).value = variants.some((v) => v.id === current) && !(key === "variant-b" && b === a && variants.length > 1) ? current : variants[key === "variant-a" ? 0 : variants.length - 1]?.id ?? "";
    }
    $("variants").replaceChildren(...variants.slice().reverse().map((v) => {
      const li = node("li", ""), button = node("button", `${v.preferred ? "★ " : ""}${v.name}`);
      button.type = "button"; button.setAttribute("aria-pressed", String(v.id === selected && !dirtyVariant));
      button.append(node("small", `${v.simulated ? "Simulated · " : ""}${v.settings.output} · ${(v.result.drive.length / H.GRID).toFixed(2)} s · peak ${(H.peak(v.result.drive) * 100).toFixed(0)}%${v.score ? ` · band error ${v.score.bandError.toFixed(2)} dB` : ""}${v.notes ? ` · ${v.notes}` : ""}`));
      button.disabled = busy; button.addEventListener("click", () => loadVariant(v)); li.append(button); return li;
    }));
    for (const key of ["play-a", "play-b"]) $(key).disabled = busy || !variants.length || !api.source() || api.recording();
    $("export-experiment").disabled = busy || !variants.length; $("import-experiment").disabled = busy;
    $("duplicate-variant").disabled = busy || !selected; $("update-assessment").disabled = busy || !selected || dirtyVariant;
    $("prefer-variant").disabled = busy || !selected || dirtyVariant;
  }
  $("duplicate-variant").addEventListener("click", async () => {
    const original = variants.find((v) => v.id === selected); if (!original) return;
    const copy = { ...structuredClone(original), id: id(), name: `${original.name} copy`, created: new Date().toISOString() };
    variants.push(copy); loadVariant(copy); await persist();
  });
  $("update-assessment").addEventListener("click", async () => {
    const v = variants.find((v) => v.id === selected); if (!v) return;
    v.name = $("variant-name").value.trim() || v.name; v.notes = $("variant-notes").value.trim(); v.preferred = $("prefer-variant").checked;
    renderVariants(); await persist(); message("Assessment saved.");
  });
  for (const [button, selector] of [["play-a", "variant-a"], ["play-b", "variant-b"]]) $(button).addEventListener("click", () => run(async (signal) => {
    const v = variants.find((x) => x.id === $(selector).value); if (!v) return;
    if (Boolean(v.simulated) !== (api.source()?.kind === "demo")) throw new Error("Use the same source type for this A/B test; simulated and physical experiments stay separate.");
    const { repeats, gap } = validatePlayback();
    let factor = 1;
    if ($("match-ab-level").checked) {
      const other = variants.find((x) => x.id === $(selector === "variant-a" ? "variant-b" : "variant-a").value);
      if (other) {
        const amplitude = (r) => Math.max(H.peak(r.drive), r.erm ? H.peak(r.erm) : 0);
        factor = Math.min(amplitude(v.result), amplitude(other.result)) / (amplitude(v.result) || 1);
      }
    }
    const drive = Float64Array.from(v.result.drive, (x) => x * factor), erm = v.result.erm ? Float64Array.from(v.result.erm, (x) => x * factor) : null;
    for (let i = 0; i < repeats; i++) { await measure(drive, erm, signal); if (i < repeats - 1) await pause(gap * 1000, signal); }
    message(`${button === "play-a" ? "A" : "B"}: “${v.name}” played at ${(H.peak(drive) * 100).toFixed(1)}% peak${factor !== 1 ? " (matched drive peak)" : ""}.`);
  }));
  $("export-experiment").addEventListener("click", async () => {
    const data = { format: "haptography-experiment/1", exported: new Date().toISOString(), grid_hz: H.GRID, variants };
    try {
      if (window.showDirectoryPicker) {
        const dir = await window.showDirectoryPicker({ id: "haptography-experiment", mode: "readwrite" });
        const write = async (name, bytes) => { const handle = await dir.getFileHandle(name, { create: true }), out = await handle.createWritable(); await out.write(bytes); await out.close(); };
        await write("experiment.json", json(data));
        for (let i = 0; i < variants.length; i++) {
          const v = variants[i], prefix = `${i + 1}-${v.id}`;
          await write(`${prefix}-drive.wav`, H.wav(v.result.drive));
          if (v.result.erm) await write(`${prefix}-erm.csv`, "level\n" + Array.from(v.result.erm, (x) => Math.round(x * 127)).join("\n") + "\n");
          if (v.raw) await write(`${prefix}-raw.bin`, v.raw instanceof Uint8Array ? v.raw : Uint8Array.from(v.raw));
        }
      } else download("haptography-experiment.json", json(data));
      $("experiment-storage").textContent = "Experiment exported"; message("Exported source targets, drives, profiles, measurements and assessments.");
    } catch (err) { if (err.name !== "AbortError") message(err.message, true); }
  });
  $("import-experiment").addEventListener("click", () => $("experiment-input").click());
  $("experiment-input").addEventListener("change", async () => {
    const file = $("experiment-input").files[0]; if (!file) return;
    try {
      if (file.size > 50e6) throw new Error("This experiment exceeds the 50 MB import limit.");
      const data = JSON.parse(await file.text());
      if (data.format !== "haptography-experiment/1" || data.grid_hz !== H.GRID || !Array.isArray(data.variants) || data.variants.length > 100) throw new Error("Not a Haptography experiment.");
      const imported = data.variants.map((v) => {
        if (!finiteArray(v.result?.drive, H.GRID * 30, 1) || !finiteArray(v.result?.target, H.GRID * 30) || v.result.drive.length !== v.result.target.length ||
          (v.measured && (!finiteArray(v.measured, H.GRID * 30) || v.measured.length !== v.result.target.length)) ||
          (v.result.erm && !finiteArray(v.result.erm, 3000, 1)) || !v.settings || !content.sources.some((s) => s.id === v.settings.kind)) throw new Error("An experiment contains invalid signal data.");
        if (!controls.every((c) => Number.isFinite(v.settings[c.id]) && v.settings[c.id] >= c.min && v.settings[c.id] <= c.max) ||
          !["hammer", "erm", "both"].includes(v.settings.output) || !["principal", "0", "1", "2"].includes(v.settings.axis) ||
          !(v.settings.high > v.settings.low) || !(v.settings.regularization >= 0.005 && v.settings.regularization <= 1) ||
          !(v.settings.correctionGain >= 0.05 && v.settings.correctionGain <= 1) ||
          H.peak(v.result.drive) > v.settings.strength / 100 + 1e-8 ||
          (v.settings.kind === "recording" && (!finiteArray(v.rawTarget, H.GRID * 30) || v.rawTarget.length !== v.result.target.length || !Number.isFinite(v.about?.t0) || !Number.isFinite(v.about?.t1) || v.about.t1 <= v.about.t0)) ||
          (v.result.erm && v.result.erm.length !== Math.floor(v.result.target.length / 16))) throw new Error("An experiment contains invalid source or settings data.");
        if (v.profile) H.validateModel(v.profile);
        return { ...v, id: id(), name: String(v.name || "Imported variant"), notes: String(v.notes || ""), score: v.settings.kind === "recording" && v.measured ? H.compare(Float64Array.from(v.result.target), Float64Array.from(v.measured)) : null,
          result: { ...v.result, settings: v.settings, drive: Float64Array.from(v.result.drive), target: Float64Array.from(v.result.target), erm: v.result.erm ? Float64Array.from(v.result.erm) : null,
            predicted: v.profile ? H.predict(Float64Array.from(v.result.drive), v.profile) : null, calibrated: Boolean(v.profile && v.settings.kind === "recording") }, raw: v.raw ? Uint8Array.from(v.raw) : null };
      });
      variants.push(...imported); if (imported.length) loadVariant(imported[0]); await persist(); message(`Imported ${imported.length} variants.`);
    } catch (err) { message(err.message, true); }
    $("experiment-input").value = "";
  });

  function useSelection() {
    if (busy) return;
    try {
      const loaded = api.loaded(), selectedSpan = api.selection();
      if (!loaded || !selectedSpan) throw new Error("Select a stroke or interval first.");
      const [t0, t1] = selectedSpan;
      if (api.take()?.spans?.some((s) => s.label === "bad" && s.t0 < t1 && s.t1 > t0)) throw new Error("This selection includes an excluded interval. Choose a clean interval or undo its exclusion.");
      rawTarget = H.recordingTarget(loaded.analysis, t0, t1).target;
      const take = api.take();
      targetAbout = { kind: "recording", take: loaded.id, label: take?.label, dataset: take?.dataset, setup: take?.setup, t0, t1, axis: "principal", simulated: take?.simulated ?? false };
      fill({ kind: "recording", axis: "principal" }); rebuild(); showWorkspace("tune", true);
    } catch (err) { api.selectionStatus(err.message); }
  }
  $("create-target").addEventListener("click", useSelection);
  const observer = new ResizeObserver(() => draw()); observer.observe(document.querySelector(".studio-section"));
  document.addEventListener("haptography-theme", draw);
  let saved;
  try { saved = await api.store().getState("studio"); } catch { /* empty state */ }
  if (saved) {
    try {
      model = saved.model ? H.validateModel(saved.model) : null; profiles = (saved.profiles ?? []).map(H.validateModel); variants = saved.variants ?? [];
      if (model && !profiles.some((p) => p.id && p.id === model.id)) { model = { ...model, id: id() }; profiles.push(model); }
      $("profile-note").value = model?.note || "";
      if (saved.draft) { fill(saved.draft.settings); rawTarget = saved.draft.rawTarget; targetAbout = saved.draft.targetAbout; result = saved.draft.result; lastRound = saved.draft.lastRound; selected = saved.draft.selected; dirtyVariant = saved.draft.dirtyVariant; }
    } catch { message("Saved studio settings could not be restored. Import an exported experiment to recover them.", true); }
  }
  if (!result) rebuild(); else refresh();
  showWorkspace("collect");
  return { workspace: showWorkspace, refresh, busy: () => busy, stop,
    sourceChanged() {
      if (busy) operation?.abort();
      uploaded = false;
      // A source change invalidates the measurement and any compensation made for the other
      // source. Saved variants remain intact; the current draft is regenerated explicitly.
      if (!busy) rebuild(); else { refresh(); draw(); }
    },
    takeSelected() { if (workspace === "inspect") api.setMode("replay"); },
  };
}
