// Voice model packages: the .voice files training/package.py writes (layout in
// src/voice_package.h), read before uploading so the page can say what a board will listen for and
// refuse a damaged file without bothering the board. The board checks them again itself, against
// its own features and memory. Pure functions only, so tests/dashboard/voicepkg.test.mjs runs them
// in Node on the same fixture the firmware and the training are tested on.
import { crc32, voiceActionName } from "./wire.js";

export const PACKAGE_SUFFIX = ".voice";
const MAGIC = "NRFV";
const VERSION = 1; // VOICE_PACKAGE_VERSION
const VERSION_EMBEDDING = 2; // VOICE_PACKAGE_VERSION_EMBEDDING: learns its words on the board
const HEADER_BYTES = 64;
const NAME_BYTES = 24;
const MODEL_ALIGN = 16;

/**
 * What a package holds: { name, learns, commands: [{ action, phrase }], rule: { averageOver,
 * cooldown, threshold, margin }, modelBytes, totalBytes, crc }, or { problem } saying what's wrong
 * with it. A package that `learns` has no commands: the board is taught them.
 */
export function parseVoicePackage(bytes) {
  if (bytes.length < HEADER_BYTES || String.fromCharCode(...bytes.subarray(0, 4)) !== MAGIC) {
    return { problem: "not a voice model (a .voice file from task training:export)" };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const learns = bytes[4] === VERSION_EMBEDDING;
  if (bytes[4] !== VERSION && !learns) return { problem: `a newer package format (${bytes[4]}): reload the page, or update it` };
  const totalBytes = view.getUint32(8, true);
  if (totalBytes !== bytes.length) return { problem: "the file is cut short or has something appended" };
  const crc = view.getUint32(bytes.length - 4, true);
  if (crc32(bytes.subarray(0, bytes.length - 4)) !== crc) return { problem: "the file is damaged (its checksum doesn't match)" };

  const modelOffset = view.getUint32(12, true);
  const modelBytes = view.getUint32(16, true);
  const labelCount = bytes[20];
  const backgroundCount = bytes[21];
  const labelsFit = learns ? labelCount === 1 && backgroundCount === 1 : backgroundCount < labelCount;
  if (modelOffset % MODEL_ALIGN || modelOffset + modelBytes + 4 !== totalBytes || !labelsFit) {
    return { problem: "the file is damaged (its layout doesn't add up)" };
  }

  const utf8 = new TextDecoder();
  const commands = [];
  let at = HEADER_BYTES;
  for (let i = 0; i < labelCount; i++) {
    const length = bytes[at + 1];
    if (at + 2 + length > modelOffset) return { problem: "the file is damaged (its phrases run into the model)" };
    if (i >= backgroundCount) commands.push({ action: voiceActionName(bytes[at]), phrase: utf8.decode(bytes.subarray(at + 2, at + 2 + length)) });
    at += 2 + length;
  }
  const nameBytes = bytes.subarray(40, 40 + NAME_BYTES);
  const nameEnd = nameBytes.indexOf(0);
  return {
    name: utf8.decode(nameEnd < 0 ? nameBytes : nameBytes.subarray(0, nameEnd)),
    learns,
    commands,
    rule: { averageOver: bytes[22], cooldown: bytes[23], threshold: view.getUint16(24, true), margin: view.getUint16(26, true) },
    modelBytes,
    totalBytes,
    crc,
  };
}
