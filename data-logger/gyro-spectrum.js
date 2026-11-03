// The gyro spectrum's bookkeeping: the board sends each ~0.6 s frame as one notification per
// channel (x, y, z, |ω|; wire.js decodeGyroSpectrum), which this puts back together, averages over
// the last few frames and searches for the loudest frequency. Pure, so
// tests/dashboard/gyro-spectrum.test.mjs runs it in Node.

import { GYRO_SPECTRUM_CHANNELS } from "./wire.js";

// About 10 s of frames: enough for the longest average the panel offers.
export const GYRO_SPECTRUM_KEEP_FRAMES = 16;
// The averages the panel's key steps through, in frames.
export const GYRO_SPECTRUM_AVERAGES = [1, 4, 16];

/** A new, empty store of frames for one board. */
export function newGyroSpectrum() {
  return { frames: [] };
}

/**
 * Adds one decoded channel to its frame, starting the frame if it is new. A frame index far behind
 * the newest means the board restarted, so the old frames go.
 */
export function addGyroChannel(store, decoded) {
  const newest = store.frames.at(-1);
  if (newest && decoded.frame + GYRO_SPECTRUM_KEEP_FRAMES < newest.frame) store.frames = [];

  let frame = store.frames.find((f) => f.frame === decoded.frame);
  if (!frame) {
    frame = {
      frame: decoded.frame,
      tUs: decoded.tUs,
      rateHz: decoded.rateHz,
      bins: decoded.bins,
      channels: GYRO_SPECTRUM_CHANNELS.map(() => null),
    };
    store.frames.push(frame);
    store.frames.sort((a, b) => a.frame - b.frame);
    while (store.frames.length > GYRO_SPECTRUM_KEEP_FRAMES) store.frames.shift();
  }
  frame.channels[decoded.channel] = decoded.levels;
  return frame;
}

/**
 * Each channel's mean over the last `count` frames that carry it, averaged as power (dB to power
 * and back), as Welch's method does; null for a channel no frame has. Also the newest frame's rate
 * and bin count, or null with no frames.
 */
export function averageGyroSpectrum(store, count) {
  const newest = store.frames.at(-1);
  if (!newest) return null;
  const channels = GYRO_SPECTRUM_CHANNELS.map((_, channel) => {
    const recent = store.frames.filter((f) => f.channels[channel]?.length === newest.bins).slice(-count);
    if (!recent.length) return null;
    const mean = new Float32Array(newest.bins);
    for (let b = 0; b < newest.bins; b++) {
      let power = 0;
      for (const f of recent) power += 10 ** (f.channels[channel][b] / 10);
      mean[b] = 10 * Math.log10(power / recent.length);
    }
    return mean;
  });
  return { rateHz: newest.rateHz, bins: newest.bins, channels };
}

/** The center frequency of bin b, in Hz: bins cover 0 to half the sample rate. */
export function binHz(bin, rateHz, bins) {
  return (bin * rateHz) / (2 * bins);
}

/**
 * The loudest bin at or above minHz (below it is what is left of a slow turn and the mean the board
 * took out), as { bin, hz, db }, or null for no levels.
 */
export function spectrumPeak(levels, rateHz, minHz = 0.5) {
  if (!levels?.length) return null;
  let best = -1;
  for (let b = 0; b < levels.length; b++) {
    if (binHz(b, rateHz, levels.length) < minHz) continue;
    if (best < 0 || levels[b] > levels[best]) best = b;
  }
  return best < 0 ? null : { bin: best, hz: binHz(best, rateHz, levels.length), db: levels[best] };
}
