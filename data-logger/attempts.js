// One connection attempt per board at a time. Chrome keeps one GATT connection per device, so two
// attempts at once (Add board while the page is still reconnecting that board) race, and the
// loser's clean-up disconnects the winner. Whoever asks while one is under way shares its outcome
// instead. Pure, so tests/dashboard/attempts.test.mjs runs it in Node.

export class SharedAttempts {
  constructor() {
    this.running = new Map();
  }

  /** The attempt in flight for `key`, or a new one from start() (called at most once per attempt). */
  run(key, start) {
    const running = this.running.get(key);
    if (running) return running;
    const attempt = Promise.resolve()
      .then(start)
      .finally(() => {
        if (this.running.get(key) === attempt) this.running.delete(key);
      });
    this.running.set(key, attempt);
    return attempt;
  }

  has(key) {
    return this.running.has(key);
  }
}

/** `promise`, or a rejection with Error(message) once `ms` pass first. */
export function withTimeout(promise, ms, message = "timed out") {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
