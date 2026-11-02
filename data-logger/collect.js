// Collecting clips in the clips dialog (voice-view.js): what stands between someone and their first
// take, what to try on the next one, how far they've got, and whether a take held a word at all.
// Pure functions only, so tests/dashboard/collect.test.mjs runs them in Node.
import { HOLD_LEAD_SAMPLES } from "./clip-view.js";

export const DEFAULT_TARGET = 30; // clips of each word; docs/voice-commands.md's trial needed about this many

const ROOM_BLOCK_SAMPLES = 320; // 20 ms
const WORD_BLOCKS = 4; // the loudest 80 ms stands for the word
const LEAD_ROOM_BLOCKS = 10; // the lead's first 200 ms: a press's click comes later in it
// Above the take's room noise. The boards' clips (2026-11-01): words 31 dB or more for all but a
// spoiled few, _silence 1-2 dB, _unknown 5-10 dB. Quiet speech is wanted, so this asks only whether
// anything was said; a level in dBFS would turn down the soft and distant takes training lacks.
const HEARD_OVER_ROOM_DB = 10;

/** A way to vary the next take, by how many clips the word has: training needs them to differ. */
const WAYS = [
  "In your normal voice",
  "A little faster",
  "A little slower",
  "Quietly, but not whispered",
  "With the board at arm's length",
  "In your normal voice, looking away",
  "Holding the board in your hand",
  "A little louder",
];

export const wayToSay = (clips) => WAYS[clips % WAYS.length];

/**
 * What has to happen before a take can start, as the words to show, or null when it can. `folder`
 * is "none", "prompt" (chosen, but Chrome wants asking again), "denied", "granted" or "download"
 * (this browser can't write folders). `typing`: Space would go into a text box.
 */
export function nextStep({ connected, capturing, folder, speaker, typing }) {
  if (!connected) return "Add a board to start.";
  if (!capturing) return "This board's firmware can't record clips: update it.";
  if (folder === "none" || folder === "denied") return "Choose the folder clips go in.";
  if (folder === "prompt") return "Allow this page to use your clips folder.";
  if (!speaker.trim()) return "Type your name, so training can tell voices apart.";
  return typing ? "Press Enter when you've finished typing." : null;
}

/** How far a set of words has got: each counts up to `target`, so extras of one don't hide a gap. */
export function progress(phrases, counts, target) {
  const clips = phrases.reduce((sum, { label }) => sum + Math.min(target, counts.get(label) ?? 0), 0);
  return { clips, wanted: phrases.length * target, finished: phrases.every(({ label }) => (counts.get(label) ?? 0) >= target) };
}

const blockPower = (samples, start) => {
  let sum = 0;
  for (let i = start; i < start + ROOM_BLOCK_SAMPLES; i++) sum += samples[i] * samples[i];
  return sum / ROOM_BLOCK_SAMPLES;
};

/** Whether the `kept` part of a take rises above the room heard in its lead. */
export function heardWord(samples, kept) {
  const room = [];
  for (let block = 0; block < LEAD_ROOM_BLOCKS && (block + 1) * ROOM_BLOCK_SAMPLES <= HOLD_LEAD_SAMPLES; block++) room.push(blockPower(samples, block * ROOM_BLOCK_SAMPLES));
  room.sort((a, b) => a - b);
  const floor = Math.max(1, room[room.length >> 1]);
  const powers = [];
  for (let start = kept.start; start + ROOM_BLOCK_SAMPLES <= kept.end; start += ROOM_BLOCK_SAMPLES) powers.push(blockPower(samples, start));
  let loudest = 0;
  for (let i = 0; i + WORD_BLOCKS <= powers.length; i++) {
    let sum = 0;
    for (let j = i; j < i + WORD_BLOCKS; j++) sum += powers[j];
    loudest = Math.max(loudest, sum / WORD_BLOCKS);
  }
  return 10 * Math.log10(Math.max(1, loudest) / floor) >= HEARD_OVER_ROOM_DB;
}
