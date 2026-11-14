// Synthetic firmware fixtures exported by nrf-controller's task capture-contract.
// Site tests need neither a compiler nor a checkout of the private firmware repository.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export function fixtureStream() {
  const path = join(ROOT, "tests/fixtures/capture/v5/stream.bin");
  return { path, bytes: new Uint8Array(readFileSync(path)) };
}
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
