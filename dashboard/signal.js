// Signal helpers for the plots and the readouts. Pure functions only, no DOM, so
// tests/dashboard/signal.test.mjs can run them in Node.

/** The smallest range in `ladder` (ascending) that holds `peak`, else the largest. */
export function pickRange(peak, ladder) {
  return ladder.find((range) => Math.abs(peak) <= range) ?? ladder[ladder.length - 1];
}

/** Largest absolute value across rows of samples (e.g. [[x, y, z], ...]). */
export function peakOf(rows) {
  let peak = 0;
  for (const row of rows) for (const value of row) peak = Math.max(peak, Math.abs(value));
  return peak;
}

const FULL_SCALE = 32768;

/** A mic envelope peak (|sample - DC|, 0..32767) in dBFS; -Infinity for 0. */
export function peakToDbfs(peak) {
  return peak > 0 ? 20 * Math.log10(peak / FULL_SCALE) : -Infinity;
}

/** Where a level sits on a meter running from floorDbfs (0) to 0 dBFS (1), clamped. */
export function meterFraction(dbfs, floorDbfs = -80) {
  if (!(dbfs > floorDbfs)) return 0;
  return Math.min(1, (dbfs - floorDbfs) / -floorDbfs);
}

/**
 * The CSS colour for an LED reading ({ red, green, blue }, 0-255): its hue at full brightness, since
 * the board runs it dim (status colours are 40 of 255) and a screen swatch that dim reads as black.
 * null when it is off or unknown.
 */
export function ledDisplayColor(led) {
  const brightest = led ? Math.max(led.red, led.green, led.blue) : 0;
  if (!brightest) return null;
  const scale = (channel) => Math.round((channel * 255) / brightest);
  return `rgb(${scale(led.red)} ${scale(led.green)} ${scale(led.blue)})`;
}

/** Largest value in the last `count` entries of an array (0 when empty). */
export function recentPeak(values, count) {
  let peak = 0;
  for (let i = Math.max(0, values.length - count); i < values.length; i++) peak = Math.max(peak, values[i]);
  return peak;
}
