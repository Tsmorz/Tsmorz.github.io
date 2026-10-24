// A board's IMU rate as the dashboard shows it. Samples arrive eight to a notification whenever
// the link delivers them, and the page's once-a-second timer can fire late, so a count per tick
// swung by tens of Hz with nothing lost. This averages over the last few seconds and divides by
// the time that actually passed. Pure, so tests/dashboard/rate-meter.test.mjs runs it in Node.

export class RateMeter {
  constructor(windowMs = 5000) {
    this.windowMs = windowMs;
    this.ticks = []; // { ms, samples } per tick, oldest first: samples arrived since the tick before
    this.pending = 0;
  }

  add(count) {
    this.pending += count;
  }

  /** Closes the current tick at host time `ms` and returns the rate in Hz (0 until two ticks). */
  tick(ms) {
    this.ticks.push({ ms, samples: this.pending });
    this.pending = 0;
    while (this.ticks.length > 2 && ms - this.ticks[1].ms >= this.windowMs) this.ticks.shift();
    if (this.ticks.length < 2) return 0;
    const samples = this.ticks.slice(1).reduce((sum, tick) => sum + tick.samples, 0);
    return (1000 * samples) / (ms - this.ticks[0].ms);
  }

  /** Starts again, as after a pause in the stream that shouldn't count as a slow rate. */
  reset() {
    this.ticks = [];
    this.pending = 0;
  }
}
