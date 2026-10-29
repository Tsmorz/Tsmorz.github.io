// Keyword clips over the USB cable: the board offers a clip in a mailbox at a fixed RAM address
// (src/swd_mailbox_format.h has the layout and the handshake), and the page reads it through the
// board's own USB debug probe (swd.js), in under a second where Bluetooth takes ~5 s. No DOM or
// WebUSB here: it drives an attached Nrf54lm20a, so tests/dashboard/mailbox.test.mjs runs it
// against a simulated board.
import { crc32 } from "./wire.js";

export const MAILBOX_ADDRESS = 0x2007fb00;
export const MAILBOX_MAGIC = 0x4d445753; // "SWDM"
export const MAILBOX_VERSION = 1;
// src/swd_mailbox_format.h's enum swd_mailbox_state.
export const MAILBOX_STATES = ["idle", "ready", "failed"];
const MAILBOX_BYTES = 36;
const TAKEN_OFFSET = 32;
// The app's RAM, below the mailbox: an offer pointing anywhere else is junk.
const RAM = { start: 0x20000000, end: MAILBOX_ADDRESS };

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The mailbox's fields, or null if the firmware hasn't set one up (older firmware, or still booting). */
export function decodeMailbox(bytes) {
  if (bytes.length < MAILBOX_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (at) => view.getUint32(at, true);
  if (u32(0) !== MAILBOX_MAGIC || u32(4) !== MAILBOX_VERSION) return null;
  return {
    state: MAILBOX_STATES[u32(8)] ?? "unknown",
    id: u32(12), address: u32(16), bytes: u32(20), crc32: u32(24), error: view.getInt32(28, true), taken: u32(TAKEN_OFFSET),
  };
}

/** Reads the board's mailbox through `chip` (an attached Nrf54lm20a); null without one. */
export async function readMailbox(chip) {
  return decodeMailbox(await chip.read(MAILBOX_ADDRESS, MAILBOX_BYTES));
}

/**
 * Waits for the board to offer what was asked for under `id`, reads it straight from its RAM and
 * tells the board it has it, so the board can reuse the buffer. Resolves with the bytes; rejects
 * if the board says it won't come, nothing comes within `timeoutMs`, or the checksum is off.
 */
export async function takeFromMailbox(chip, id, { timeoutMs = 12000, pollMs = 20, onProgress, sleep = sleepMs, now = () => performance.now() } = {}) {
  const deadline = now() + timeoutMs;
  for (;;) {
    const box = await readMailbox(chip);
    if (!box) throw new Error("the board's firmware can't hand clips over USB: update it");
    if (box.id === id && box.state === "failed") throw new Error(`the board couldn't capture it (error ${box.error})`);
    if (box.id === id && box.state === "ready") return takeOffer(chip, id, box, onProgress);
    if (now() > deadline) throw new Error("the clip didn't arrive over USB");
    await sleep(pollMs);
  }
}

async function takeOffer(chip, id, box, onProgress) {
  if (box.address < RAM.start || box.address + box.bytes > RAM.end) {
    throw new Error(`the board's mailbox points outside its RAM (0x${box.address.toString(16)}, ${box.bytes} bytes)`);
  }
  const start = box.address - (box.address % 4); // the probe reads whole words
  const words = await chip.read(start, box.address - start + box.bytes, onProgress);
  const bytes = words.slice(box.address - start);
  // Taken even if damaged: the board holds the buffer until then, refusing the next capture.
  await chip.write32(MAILBOX_ADDRESS + TAKEN_OFFSET, id);
  if (crc32(bytes) !== box.crc32) throw new Error("it came over USB damaged: try again");
  return bytes;
}

/** Little-endian 16-bit samples from `bytes`, as the board's int16_t buffer holds them. */
export function samplesFromBytes(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Int16Array.from({ length: Math.floor(bytes.length / 2) }, (_, i) => view.getInt16(2 * i, true));
}
