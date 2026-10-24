// Keyword clips for training voice commands (docs/voice-commands.md): the phrases, a clip put
// back together from the board's chunks, and the WAV files the training reads. Pure functions
// only, so tests/dashboard/clips.test.mjs runs them in Node.
import { tagName } from "./flashlog.js";

/**
 * What to record under each label: `say` is shown to the speaker. Every command is a phrase of
 * its own, sharing no word with another, so no one syllable has to tell two commands apart. The
 * two labels starting with "_" are what the board must ignore. The label is the clip's folder
 * name, so renaming one starts a new class.
 */
export const KEYWORD_LABELS = [
  { label: "pointer_online", say: "pointer online", does: "mouse on" },
  { label: "freeze_cursor", say: "freeze the cursor", does: "mouse off" },
  { label: "begin_recording", say: "begin recording", does: "start recording to flash" },
  { label: "capture_complete", say: "capture complete", does: "stop recording" },
  { label: "power_down_now", say: "power down now", does: "sleep (said twice)" },
  { label: "mark_this_moment", say: "mark this moment", does: "timed mark in the recording" },
  { label: "_unknown", say: "anything else: other words, and near-misses like “pointer”, “recording”, “complete”", does: "ignored" },
  { label: "_silence", say: "say nothing: room noise, handling, a clap now and then", does: "ignored" },
];

/** Collects one clip's chunks; `add` returns true once every sample has arrived. */
export class ClipAssembler {
  constructor(clipId) {
    this.clipId = clipId;
    this.samples = null;
    this.received = 0;
    this.starts = new Set(); // first sample of each chunk seen, so a repeat isn't counted twice
  }

  add(chunk) {
    if (chunk.clipId !== this.clipId || this.starts.has(chunk.firstSample)) return this.complete;
    this.samples ??= new Int16Array(chunk.totalSamples);
    if (chunk.totalSamples !== this.samples.length || chunk.firstSample + chunk.samples.length > this.samples.length) return this.complete;
    this.samples.set(chunk.samples, chunk.firstSample);
    this.starts.add(chunk.firstSample);
    this.received += chunk.samples.length;
    return this.complete;
  }

  get complete() {
    return this.samples !== null && this.received === this.samples.length;
  }

  /** Fraction received, 0 to 1. */
  get progress() {
    return this.samples ? this.received / this.samples.length : 0;
  }
}

export const WAV_HEADER_BYTES = 44;

/** The 44-byte header of a mono 16-bit PCM WAV file holding `sampleCount` samples at `rateHz`. */
export function wavHeader(sampleCount, rateHz) {
  const bytes = new Uint8Array(WAV_HEADER_BYTES);
  const view = new DataView(bytes.buffer);
  const ascii = (at, text) => [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  ascii(0, "RIFF");
  view.setUint32(4, 36 + sampleCount * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rateHz, true);
  view.setUint32(28, rateHz * 2, true); // bytes per second
  view.setUint16(32, 2, true); // bytes per frame
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, sampleCount * 2, true);
  return bytes;
}

/** Samples as the little-endian bytes a WAV file holds. */
export function pcmBytes(samples) {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((sample, i) => view.setInt16(i * 2, sample, true));
  return bytes;
}

/** A mono 16-bit PCM WAV file of `samples` at `rateHz`. */
export function encodeWav(samples, rateHz) {
  const bytes = new Uint8Array(WAV_HEADER_BYTES + samples.length * 2);
  bytes.set(wavHeader(samples.length, rateHz));
  bytes.set(pcmBytes(samples), WAV_HEADER_BYTES);
  return bytes;
}

/**
 * Puts the background-audio stream's chunks back in order as one track: a lost chunk becomes
 * silence of its length, so the audio keeps its timing, and a late or repeated one is dropped.
 * add() returns the samples to append (possibly none).
 */
export class AudioTrack {
  constructor() {
    this.next = 0; // the sample the track has reached
    this.samples = 0;
    this.lostSamples = 0;
  }

  add({ firstSample, samples }) {
    if (firstSample < this.next) return new Int16Array(0);
    const gap = firstSample - this.next;
    const out = new Int16Array(gap + samples.length);
    out.set(samples, gap);
    this.lostSamples += gap;
    this.next = firstSample + samples.length;
    this.samples += out.length;
    return out;
  }
}

const dbfs = (level) => (level > 0 ? 20 * Math.log10(level / 32768) : -Infinity);

/** How loud a clip is: peak and RMS in dBFS, and how many samples hit full scale. */
export function clipLevels(samples) {
  let peak = 0;
  let sumSquares = 0;
  let clipped = 0;
  for (const sample of samples) {
    const magnitude = Math.abs(sample);
    peak = Math.max(peak, magnitude);
    sumSquares += sample * sample;
    if (magnitude >= 32767) clipped++;
  }
  return { peakDbfs: dbfs(peak), rmsDbfs: dbfs(Math.sqrt(sumSquares / Math.max(1, samples.length))), clipped };
}

/**
 * A clip's file name: who said it, when, and which board heard it, e.g.
 * tony_2026-10-24_14-05-09_D892.wav. training/dataset.py reads the speaker back from it, to score
 * each voice separately.
 */
export function clipFileName(boardId, date, speaker = "") {
  const who = String(speaker).trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "anon";
  return `${who}_${tagName(date.getTime() / 1000)}_${boardId}.wav`;
}
