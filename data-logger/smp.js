// Firmware updates: the parts of MCUmgr's SMP protocol the dashboard uses, the CBOR its messages
// are written in, and MCUboot's image format. Pure functions only, no DOM or Bluetooth, so
// tests/dashboard/smp.test.mjs can run them in Node. The board side is Zephyr's own MCUmgr
// (prj.conf, src/dfu/); dfu.js drives an update with these.

export const SMP_SERVICE = "8d53dc1d-1db7-4cd3-868b-8a527460aa84";
export const SMP_CHARACTERISTIC = "da2e7828-fbce-4e01-ae9e-261174997c48";

export const SMP_HEADER_BYTES = 8;
export const OP_READ = 0;
export const OP_WRITE = 2;
export const GROUP_OS = 0;
export const GROUP_IMAGE = 1;
export const OS_RESET = 5;
export const OS_MCUMGR_PARAMS = 6;
export const IMAGE_STATE = 0;
export const IMAGE_UPLOAD = 1;
// SMP version 2 framing: a command group's own errors come back as {err: {group, rc}}.
const SMP_VERSION = 1;

// MGMT_ERR_* (zephyr/mgmt/mcumgr/mgmt/mgmt_defines.h), for an {rc} reply.
const MGMT_ERRORS = [
  "ok", "unknown error", "out of memory", "invalid request", "timed out", "not found", "bad state",
  "message too large", "not supported", "corrupt", "busy", "access denied",
  "protocol too old for the board", "protocol too new for the board",
];
// IMG_MGMT_ERR_* (zephyr/mgmt/mcumgr/grp/img_mgmt/img_mgmt.h), for an {err} reply from the image group.
const IMAGE_ERRORS = [
  "ok", "unknown error", "flash config query failed", "no image", "no TLVs", "invalid TLV",
  "several hashes in the TLVs", "invalid TLV size", "hash not found", "no free slot",
  "flash open failed", "flash read failed", "flash write failed", "flash erase failed",
  "invalid slot", "out of memory", "flash context already set", "flash context not set",
  "flash device missing", "invalid page offset", "invalid offset", "invalid length",
  "invalid image header", "not an MCUboot image (bad header magic)", "invalid hash",
  "invalid flash address", "couldn't read the version", "the board's firmware is newer",
  "an update is already pending", "invalid vector table", "image too large for the slot",
  "image data overrun", "confirmation denied", "can't test the running image",
  "active slot unknown",
];

// ---- CBOR (RFC 8949), the subset SMP uses ------------------------------------------------------
const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder();

/**
 * Encodes integers, strings, booleans, null, Uint8Array (as a byte string), arrays and plain
 * objects (as maps with text keys; undefined members are left out).
 */
export function cborEncode(value) {
  const out = [];
  const head = (major, n) => {
    const type = major << 5;
    if (n < 24) out.push(type | n);
    else if (n < 0x100) out.push(type | 24, n);
    else if (n < 0x10000) out.push(type | 25, n >> 8, n & 0xff);
    else if (n < 0x100000000) out.push(type | 26, n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
    else throw new RangeError(`CBOR value too large: ${n}`);
  };
  const bytes = (major, data) => {
    head(major, data.length);
    for (const byte of data) out.push(byte);
  };
  const item = (v) => {
    if (v === null) out.push(0xf6);
    else if (v === false) out.push(0xf4);
    else if (v === true) out.push(0xf5);
    else if (Number.isInteger(v)) v >= 0 ? head(0, v) : head(1, -1 - v);
    else if (typeof v === "string") bytes(3, utf8.encode(v));
    else if (v instanceof Uint8Array) bytes(2, v);
    else if (Array.isArray(v)) {
      head(4, v.length);
      v.forEach(item);
    } else if (typeof v === "object") {
      const entries = Object.entries(v).filter(([, member]) => member !== undefined);
      head(5, entries.length);
      for (const [key, member] of entries) {
        item(key);
        item(member);
      }
    } else throw new TypeError(`can't CBOR-encode ${v}`);
  };
  item(value);
  return Uint8Array.from(out);
}

const BREAK = Symbol("break");

function halfToFloat(half) {
  const exponent = (half >> 10) & 0x1f;
  const fraction = half & 0x3ff;
  const sign = half & 0x8000 ? -1 : 1;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 31) return fraction ? NaN : sign * Infinity;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

/**
 * Decodes one CBOR item. Byte strings come back as Uint8Array, maps as plain objects. Handles the
 * indefinite-length maps and arrays Zephyr's zcbor writes by default; tags are skipped.
 */
export function cborDecode(input) {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let at = 0;
  const take = (n) => {
    if (at + n > data.length) throw new Error("truncated CBOR");
    const start = at;
    at += n;
    return start;
  };
  const argument = (info) => {
    if (info < 24) return info;
    if (info === 24) return data[take(1)];
    if (info === 25) return view.getUint16(take(2));
    if (info === 26) return view.getUint32(take(4));
    if (info === 27) return Number(view.getBigUint64(take(8)));
    if (info === 31) return null; // indefinite length
    throw new Error(`invalid CBOR length ${info}`);
  };
  const until = (read) => {
    for (;;) {
      const value = item();
      if (value === BREAK) return;
      read(value);
    }
  };
  const item = () => {
    const initial = data[take(1)];
    const major = initial >> 5;
    const info = initial & 0x1f;
    if (major === 7) {
      switch (info) {
        case 20: return false;
        case 21: return true;
        case 22: return null;
        case 23: return undefined;
        case 25: return halfToFloat(view.getUint16(take(2)));
        case 26: return view.getFloat32(take(4));
        case 27: return view.getFloat64(take(8));
        case 31: return BREAK;
        default: return info < 24 ? info : data[take(1)]; // other simple values
      }
    }
    const n = argument(info);
    if (n === null && major < 2) throw new Error("invalid indefinite-length integer");
    switch (major) {
      case 0: return n;
      case 1: return -1 - n;
      case 2:
      case 3: {
        let chunk;
        if (n === null) {
          const parts = [];
          until((part) => parts.push(major === 2 ? part : utf8.encode(part)));
          chunk = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
          parts.reduce((offset, part) => (chunk.set(part, offset), offset + part.length), 0);
        } else {
          const start = take(n);
          chunk = data.slice(start, start + n);
        }
        return major === 2 ? chunk : fromUtf8.decode(chunk);
      }
      case 4: {
        const array = [];
        if (n === null) until((value) => array.push(value));
        else for (let i = 0; i < n; i++) array.push(definite(item()));
        return array;
      }
      case 5: {
        const map = {};
        if (n === null) until((key) => (map[key] = definite(item())));
        else for (let i = 0; i < n; i++) map[definite(item())] = definite(item());
        return map;
      }
      default: return item(); // tag: the tagged item as is
    }
  };
  const definite = (value) => {
    if (value === BREAK) throw new Error("unexpected CBOR break");
    return value;
  };
  return definite(item());
}

// ---- SMP framing -------------------------------------------------------------------------------
/** One request: the 8-byte SMP header (big-endian) and its CBOR body. */
export function encodeSmp({ op, group, id, seq, body = {} }) {
  const payload = cborEncode(body);
  if (payload.length > 0xffff) throw new RangeError("SMP body too large");
  const frame = new Uint8Array(SMP_HEADER_BYTES + payload.length);
  frame.set([(SMP_VERSION << 3) | op, 0, payload.length >> 8, payload.length & 0xff, group >> 8, group & 0xff, seq & 0xff, id]);
  frame.set(payload, SMP_HEADER_BYTES);
  return frame;
}

/** Splits one complete frame into its header fields and decoded body. */
export function decodeSmp(frame) {
  if (frame.length < SMP_HEADER_BYTES) throw new Error("short SMP frame");
  const length = (frame[2] << 8) | frame[3];
  if (frame.length !== SMP_HEADER_BYTES + length) throw new Error("SMP frame length mismatch");
  return {
    op: frame[0] & 0x07,
    group: (frame[4] << 8) | frame[5],
    seq: frame[6],
    id: frame[7],
    body: length ? cborDecode(frame.subarray(SMP_HEADER_BYTES)) : {},
  };
}

/** Joins notifications back into frames: the board splits a reply longer than the ATT MTU. */
export class SmpReassembler {
  constructor() {
    this.pending = new Uint8Array(0);
  }

  /** Adds one notification's bytes; returns the frames now complete (often none or one). */
  push(bytes) {
    const joined = new Uint8Array(this.pending.length + bytes.length);
    joined.set(this.pending);
    joined.set(bytes, this.pending.length);
    this.pending = joined;
    const frames = [];
    while (this.pending.length >= SMP_HEADER_BYTES) {
      const total = SMP_HEADER_BYTES + ((this.pending[2] << 8) | this.pending[3]);
      if (this.pending.length < total) break;
      frames.push(this.pending.slice(0, total));
      this.pending = this.pending.slice(total);
    }
    return frames;
  }

  reset() {
    this.pending = new Uint8Array(0);
  }
}

/** Splits a request into ATT writes; the board reassembles them (MCUMGR_TRANSPORT_BT_REASSEMBLY). */
export function fragments(frame, size) {
  const parts = [];
  for (let offset = 0; offset < frame.length; offset += size) parts.push(frame.subarray(offset, offset + size));
  return parts;
}

/** The error in a reply body as text, or null if it reports success. */
export function smpError(body) {
  const err = body?.err;
  if (err && err.rc) {
    const name = err.group === GROUP_IMAGE ? IMAGE_ERRORS[err.rc] : undefined;
    return `${name ?? "error"} (group ${err.group}, code ${err.rc})`;
  }
  if (body?.rc) return `${MGMT_ERRORS[body.rc] ?? "error"} (code ${body.rc})`;
  return null;
}

// ---- image upload ------------------------------------------------------------------------------
/** The body of one upload request; the first also carries the image's total length. */
export function uploadBody(totalLength, offset, chunk) {
  return offset === 0 ? { image: 0, len: totalLength, off: 0, data: chunk } : { off: offset, data: chunk };
}

/** The most image bytes a request starting at `offset` can carry and still fit `frameLimit`. */
export function uploadChunkLength(frameLimit, totalLength, offset) {
  // The byte string's length header grows by up to 2 bytes once it holds data (< 64 KB).
  const overhead = SMP_HEADER_BYTES + cborEncode(uploadBody(totalLength, offset, new Uint8Array(0))).length + 2;
  return Math.max(0, Math.min(totalLength - offset, frameLimit - overhead));
}

// ---- MCUboot images ----------------------------------------------------------------------------
const IMAGE_MAGIC = 0x96f3b83d;
const TLV_INFO_MAGIC = 0x6907;
const TLV_PROTECTED_INFO_MAGIC = 0x6908;
const HASH_TLVS = { 0x10: "SHA-256", 0x11: "SHA-384", 0x12: "SHA-512" };
// A hash of the public key the image was signed with, as MCUboot finds its key by.
const TLV_KEYHASH = 0x01;

/** "1.2.3" or "1.2.3+4" (MCUboot's build number), as the dashboard shows versions. */
export function formatImageVersion({ major, minor, revision, build }) {
  return `${major}.${minor}.${revision}${build ? `+${build}` : ""}`;
}

/**
 * Reads a signed MCUboot image (zephyr.signed.bin): its version and the hash MCUboot and MCUmgr
 * identify it by, and the hash of its signing key. Throws with a readable reason for anything
 * else, e.g. an unsigned zephyr.bin.
 */
export function parseMcubootImage(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 32 || view.getUint32(0, true) !== IMAGE_MAGIC) {
    throw new Error("not a signed MCUboot image: pick zephyr.signed.bin from the build");
  }
  const headerSize = view.getUint16(8, true);
  const protectedTlvSize = view.getUint16(10, true);
  const imageSize = view.getUint32(12, true);
  const version = {
    major: view.getUint8(20),
    minor: view.getUint8(21),
    revision: view.getUint16(22, true),
    build: view.getUint32(24, true),
  };

  let at = headerSize + imageSize;
  const areaEnd = (magic) => {
    if (at + 4 > bytes.length || view.getUint16(at, true) !== magic) throw new Error("image has no valid TLV area (truncated file?)");
    return at + view.getUint16(at + 2, true);
  };
  let hash = null;
  let hashAlgorithm = null;
  let keyHash = null;
  const scan = (end) => {
    for (let tlv = at + 4; tlv + 4 <= end; ) {
      const type = view.getUint16(tlv, true);
      const length = view.getUint16(tlv + 2, true);
      if (tlv + 4 + length > end) throw new Error("image has a malformed TLV");
      if (HASH_TLVS[type]) {
        hash = bytes.slice(tlv + 4, tlv + 4 + length);
        hashAlgorithm = HASH_TLVS[type];
      }
      if (type === TLV_KEYHASH) keyHash = bytes.slice(tlv + 4, tlv + 4 + length);
      tlv += 4 + length;
    }
    at = end;
  };
  if (protectedTlvSize) scan(areaEnd(TLV_PROTECTED_INFO_MAGIC));
  const end = areaEnd(TLV_INFO_MAGIC);
  if (end > bytes.length) throw new Error("image is truncated");
  scan(end);
  if (!hash) throw new Error("image has no hash TLV");

  return { version, versionText: formatImageVersion(version), imageSize, hash, hashAlgorithm, keyHash };
}

/** Lowercase hex, for comparing and showing hashes. */
export function toHex(bytes) {
  return Array.from(bytes ?? [], (byte) => byte.toString(16).padStart(2, "0")).join("");
}
