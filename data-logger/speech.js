// Speech to text from a board's microphone: the pure part. The board streams its mic (ADPCM,
// board.startAudioStream()); AudioTrack lines the decoded chunks up, filling lost ones with
// silence; whisperInput() makes the take what Whisper reads (mono float at 16 kHz); tidySpeech()
// cleans up what it writes. speech-view.js is the button, speech-worker.js runs Whisper. Pure, so
// tests/dashboard/speech.test.mjs runs it in Node.

export const WHISPER_RATE_HZ = 16000;
export const MAX_TAKE_S = 30; // one Whisper window
export const MIN_TAKE_S = 0.3; // shorter is a slip of the finger

/** Lines a stream's chunks up: a gap (a lost chunk) becomes silence, a repeat is dropped. */
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

/** The pieces of a take (Int16Arrays at `rateHz`) as one Float32Array in [-1, 1) at 16 kHz. */
export function whisperInput(pieces, rateHz) {
  const length = pieces.reduce((sum, piece) => sum + piece.length, 0);
  const pcm = new Float32Array(length);
  let at = 0;
  for (const piece of pieces) {
    for (let i = 0; i < piece.length; i++) pcm[at + i] = piece[i] / 32768;
    at += piece.length;
  }
  if (rateHz === WHISPER_RATE_HZ || !length) return pcm;
  // Linear interpolation: the mic's band ends well below either rate's Nyquist.
  const out = new Float32Array(Math.max(1, Math.round((length * WHISPER_RATE_HZ) / rateHz)));
  const step = rateHz / WHISPER_RATE_HZ;
  for (let i = 0; i < out.length; i++) {
    const x = i * step;
    const j = Math.min(length - 1, Math.floor(x));
    const f = x - j;
    out[i] = j + 1 < length ? pcm[j] * (1 - f) + pcm[j + 1] * f : pcm[j];
  }
  return out;
}

/**
 * Whisper's text, tidied: no [BLANK_AUDIO], (music) or *coughs*, single spaces, a capital first
 * and a full stop last. Empty if nothing but noise was heard.
 */
export function tidySpeech(raw) {
  let text = String(raw ?? "").replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, " ").replace(/\s+/g, " ").replace(/\s+([,.!?;:])/g, "$1").trim();
  if (!/[\p{L}\p{N}]/u.test(text)) return "";
  text = text[0].toUpperCase() + text.slice(1);
  if (!/[.!?…]["')\]]?$/.test(text)) text += ".";
  return text;
}

/** m:ss of a take's length, for the button while it records. */
export function takeClock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
