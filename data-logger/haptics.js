// The Haptics panel's rules (haptics-view.js draws it): which cues it offers and at what level, which
// boards can play them, and what to say afterwards. Pure, so tests/dashboard/haptics.test.mjs runs
// it in Node. The cues are the TacHammer's library (actuators.js, in step with the firmware's).
import { TACHAMMER_WAVEFORMS, tachammerMaxLevel } from "./actuators.js";

/** The cues in the panel's menu: the Drake cues first, then the test patterns. */
export const CUE_GROUPS = [
  { label: "Drake cues", cues: TACHAMMER_WAVEFORMS.filter((entry) => entry.drake) },
  { label: "Patterns", cues: TACHAMMER_WAVEFORMS.filter((entry) => !entry.drake) },
];

export const DEFAULT_CUE = CUE_GROUPS[0].cues[0].id;
export const DEFAULT_LEVEL = 70; // recording/haptics/effects.py's MAX_DEMO_LEVEL

/** The level to play cue id at: the slider's value, held to the cue's ceiling (and at least 1). */
export function cueLevel(id, level) {
  const max = tachammerMaxLevel(id);
  if (!max) return 0;
  return Math.min(max, Math.max(1, Math.round(Number(level) || 1)));
}

/** Why board can't play a cue, or null if it can. */
export function unplayableReason(board) {
  if (!board?.connected) return "Connect a board to play haptics.";
  if (!board.hasActuators) return "This board's firmware has no TacHammer: update it.";
  if (!board.actuators?.tachammerReady) return "This board's I2S didn't start: no TacHammer.";
  return null;
}

/** The boards a cue can play on now, in the order given. */
export const playableBoards = (boards) => [...boards].filter((board) => !unplayableReason(board));

/** Whether a control result's state means the cue is over (control.js's CONTROL_STATES). */
export const finishedState = (state) => state >= 3;

const STATE_WORDS = { 3: "played", 4: "failed", 5: "stopped", 6: "expired" };

/**
 * One line for the outcome of playing cue at level on some boards: results are
 * { name, state } (a CONTROL_STATES number, or null if no result came back) or { name, error }.
 */
export function outcomeText(cue, level, results) {
  const what = `${cue.label} at ${level}%`;
  if (results.length === 1) {
    const [only] = results;
    if (only.error) return `${only.name}: ${only.error}`;
    return `${only.name} · ${what}: ${STATE_WORDS[only.state] ?? "sent"}.`;
  }
  const counts = new Map();
  for (const result of results) {
    const word = result.error ? "refused" : STATE_WORDS[result.state] ?? "sent";
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  const parts = [...counts].map(([word, count]) => `${word} on ${count}`);
  return `${what} on ${results.length} boards: ${parts.join(", ")}.`;
}
