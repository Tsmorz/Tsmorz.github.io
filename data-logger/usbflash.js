// Flashing a board from scratch over USB, for one with no firmware yet (or none that takes
// Bluetooth updates): MCUboot at 0 and the signed firmware in its primary slot, as `task flash`
// does, on a chip erased first. No DOM or WebUSB here: flashOverUsb() drives an Nrf54lm20a
// (swd.js), so tests/dashboard/swd.test.mjs runs it against a simulated board.
import { parseMcubootImage, toHex } from "./smp.js";

// boot_partition and slot0_partition in the build's devicetree (NCS's nrf54lm20 partition dtsi).
export const BOOTLOADER_PARTITION = { start: 0x0, size: 0xf800 };
export const FIRMWARE_SLOT = { start: 0x10000, size: 0xf2000 };
const RAM = { start: 0x20000000, end: 0x20080000 };

/**
 * Which of the two images `bytes` is: the signed firmware (zephyr.signed.bin) or MCUboot's
 * zephyr.bin (a vector table: initial stack pointer in RAM, reset handler inside the image).
 * Throws with a readable reason for anything else.
 */
export function readImageFile(name, bytes) {
  let image = null;
  try {
    image = parseMcubootImage(bytes);
  } catch {
    /* not signed: perhaps the bootloader */
  }
  if (image) {
    if (bytes.length > FIRMWARE_SLOT.size) throw new Error(`${name} is larger than the firmware slot`);
    return { kind: "firmware", name, bytes, image };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const stack = bytes.length >= 8 ? view.getUint32(0, true) : 0;
  const reset = bytes.length >= 8 ? view.getUint32(4, true) : 0;
  const looksLikeVectors = stack > RAM.start && stack <= RAM.end && reset & 1 && reset < bytes.length;
  if (!looksLikeVectors) throw new Error(`${name} is neither a signed firmware image nor MCUboot's zephyr.bin`);
  if (bytes.length > BOOTLOADER_PARTITION.size) throw new Error(`${name} is larger than MCUboot's partition: is it the app's zephyr.bin?`);
  return { kind: "bootloader", name, bytes };
}

// DER SubjectPublicKeyInfo prefixes of the key types imgtool signs with, as MCUboot embeds them.
const KEY_PREFIXES = [
  { prefix: [0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00], length: 44 }, // Ed25519
  { prefix: [0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00], length: 91 }, // ECDSA P-256
];
const DIGEST_BY_LENGTH = { 32: "SHA-256", 48: "SHA-384", 64: "SHA-512" };

function* embeddedKeys(bytes) {
  for (const { prefix, length } of KEY_PREFIXES) {
    for (let at = bytes.indexOf(prefix[0]); at >= 0 && at + length <= bytes.length; at = bytes.indexOf(prefix[0], at + 1)) {
      if (prefix.every((byte, i) => bytes[at + i] === byte)) yield bytes.subarray(at, at + length);
    }
  }
}

/**
 * Whether the bootloader will accept the firmware's signature: MCUboot only boots an image whose
 * key hash (TLV 0x01) is the hash of a key compiled into it. "match", "mismatch", or "unknown"
 * when the bootloader holds no key this recognizes (or the image carries no key hash).
 */
export async function signingKeyCheck(bootloader, firmware) {
  const keyHash = firmware.image.keyHash;
  const digest = DIGEST_BY_LENGTH[keyHash?.length];
  if (!digest) return "unknown";
  let found = false;
  for (const key of embeddedKeys(bootloader.bytes)) {
    found = true;
    if (toHex(new Uint8Array(await crypto.subtle.digest(digest, key))) === toHex(keyHash)) return "match";
  }
  return found ? "mismatch" : "unknown";
}

/**
 * Erases the chip, writes both images, reads them back and resets the board into them.
 * `onStage` hears "connecting", "erasing", "writing", "verifying", "restarting"; `onProgress`
 * hears 0..1 through writing and verifying. Resolves with the board's ID (its BLE name suffix)
 * and whether the chip was locked before the erase.
 */
export async function flashOverUsb(chip, { bootloader, firmware }, { onStage, onProgress } = {}) {
  const parts = [
    { address: BOOTLOADER_PARTITION.start, bytes: bootloader.bytes },
    { address: FIRMWARE_SLOT.start, bytes: firmware.bytes },
  ];
  const total = parts.reduce((sum, part) => sum + part.bytes.length, 0);
  const progressOver = (before, length) => (fraction) => onProgress?.((before + fraction * length) / total);

  try {
    onStage?.("connecting");
    const { locked } = await chip.attach();
    onStage?.("erasing");
    await chip.eraseAll();
    const { boardId } = await chip.identify();
    await chip.halt();

    onStage?.("writing");
    let done = 0;
    for (const { address, bytes } of parts) {
      await chip.writeRram(address, bytes, progressOver(done, bytes.length));
      done += bytes.length;
    }

    onStage?.("verifying");
    done = 0;
    for (const { address, bytes } of parts) {
      const got = await chip.read(address, bytes.length, progressOver(done, bytes.length));
      const at = got.findIndex((byte, i) => byte !== bytes[i]);
      if (at >= 0) throw new Error(`RRAM at 0x${(address + at).toString(16)} doesn't hold what was written: try again`);
      done += bytes.length;
    }

    onStage?.("restarting");
    await chip.reset();
    return { boardId, wasLocked: locked };
  } finally {
    await chip.detach();
  }
}
