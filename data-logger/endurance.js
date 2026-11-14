// Hardware-facing orchestration, also exercised with deterministic fake adapters in Node.
import { CONTROL_STATES } from "./control.js";

export function percentiles(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? { count: sorted.length, p50: sorted[Math.round((sorted.length - 1) * .5)], p99: sorted[Math.round((sorted.length - 1) * .99)], max: sorted.at(-1) } : { count: 0 };
}
export function phaseProblems(before, after) {
  const problems = [];
  if (!after.connected) problems.push("disconnected during streaming");
  if (!after.health || after.healthAgeMs > 3500) problems.push("health report unavailable or stale");
  if (!after.rateHz || after.rateHz < after.expectedHz * .9) problems.push("sample rate below target");
  if (after.health && (after.health.imuAgeMs === null || after.health.imuAgeMs >= 1000 || after.health.micAgeMs === null || after.health.micAgeMs >= 1000)) problems.push("sensor stream stalled");
  for (const key of ["imuDropped", "imuRecoveries", "micRecoveries", "sensorErrors", "resultDrops"]) {
    if ((after.health?.[key] ?? 0) > (before.health?.[key] ?? 0)) problems.push(`${key} increased`);
  }
  for (const key of ["imuLost", "envelopeLost", "eventsLost"]) if ((after[key] ?? 0) > (before[key] ?? 0)) problems.push(`${key} increased`);
  if (before.health && after.health && ((after.health.uptimeMs - before.health.uptimeMs) >>> 0) > 0x80000000) problems.push("unexpected reset");
  return problems;
}

export async function runEndurance(adapter, { seconds = 60, reconnect = true, update = false, signal, progress = () => {} } = {}) {
  if (!Number.isInteger(seconds) || seconds < 5 || seconds > 3600) throw Error("Test length must be 5–3600 seconds");
  const report = { schema: "nrf-endurance/1", started: new Date().toISOString(), phases: [], observations: [], unverified: ["cold power cycling", "electrical transients, temperature and physical feel"] };
  const terminal = new Set([CONTROL_STATES.completed, CONTROL_STATES.failed, CONTROL_STATES.stopped, CONTROL_STATES.expired]);
  const sent = new Map(), commandMs = [], playbackMs = [];
  const onResult = result => {
    if (result.command !== 2) return;
    const entry = sent.get(result.requestId) ?? {};
    if (result.state === CONTROL_STATES.started) { entry.start = result.atUs; entry.state = result.state; delete entry.end; }
    if (terminal.has(result.state)) {
      entry.end = result.atUs;
      entry.state = result.state;
      if (entry.start !== undefined) playbackMs.push((entry.end - entry.start) / 1000);
    }
    sent.set(result.requestId, entry);
  };
  let unsubscribe = () => {};
  const check = () => { if (signal?.aborted) throw Error("Endurance test stopped"); };
  const phase = async (name, duration, haptics) => {
    check(); progress(name);
    sent.clear();
    const expected = new Set();
    const before = await adapter.snapshot();
    const phaseReport = { name, before, after: null, problems: [] };
    report.phases.push(phaseReport);
    for (let i = 0; i < duration; i++) {
      check();
      if (haptics && i % 2 === 0) {
        const begin = performance.now();
        const result = await adapter.click();
        commandMs.push(performance.now() - begin);
        if (!result || result.state < CONTROL_STATES.started || !Number.isInteger(result.requestId)) throw Error("Missing device-reported actuator start");
        expected.add(result.requestId);
        if (!sent.has(result.requestId)) sent.set(result.requestId, { state: result.state, start: result.atUs });
      }
      await adapter.wait(1000, signal);
      const sample = await adapter.snapshot();
      report.observations.push({ phase: name, second: i + 1, ...sample });
      phaseReport.problems.push(...phaseProblems(before, sample));
    }
    for (const id of expected) if (sent.get(id)?.state !== CONTROL_STATES.completed) phaseReport.problems.push(`actuator ${id} did not complete successfully`);
    phaseReport.after = await adapter.snapshot();
    phaseReport.problems = [...new Set(phaseReport.problems)];
    phaseReport.ok = phaseReport.problems.length === 0;
    if (!phaseReport.ok) throw Error(`${name}: ${phaseReport.problems.join(", ")}`);
  };
  try {
    unsubscribe = adapter.listen(onResult);
    await phase("streaming", 5, false);
    await phase("streaming with finite 10% clicks", seconds, true);
    if (reconnect) {
      await adapter.stop();
      unsubscribe();
      progress("Reconnect test: press USER on the selected board if it goes off air");
      await adapter.reconnect(signal);
      unsubscribe = adapter.listen(onResult);
      await phase("after reconnect", 5, true);
    } else report.unverified.push("disconnect/reconnect");
    if (update) {
      await adapter.stop(); unsubscribe();
      progress("Updating only the selected board with the explicitly chosen signed image");
      const result = await adapter.update(signal);
      if (result === "already-running") report.unverified.push("firmware replacement: chosen image already running");
      unsubscribe = adapter.listen(onResult);
      await phase("after firmware update and confirmation", 5, true);
    } else report.unverified.push("firmware update and warm restart");
    const unfinished = [...sent.values()].filter(x => x.start !== undefined && x.state !== CONTROL_STATES.completed);
    if (unfinished.length) throw Error("One or more actuator playbacks never completed successfully");
  } catch (error) { report.error = error.message; }
  finally {
    unsubscribe();
    try { await adapter.stop(); } catch (error) { report.stopError = error.message; }
    report.finished = new Date().toISOString();
    report.commandStartRoundTripMs = percentiles(commandMs);
    report.playbackDurationMs = percentiles(playbackMs);
    report.ok = !report.error && !report.stopError && report.phases.every(p => p.ok);
  }
  return report;
}
