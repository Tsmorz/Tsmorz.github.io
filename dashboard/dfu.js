// Firmware updates over Bluetooth: an SMP client over the board's MCUmgr characteristic and the
// update sequence. No DOM or Web Bluetooth here: the client is handed a write function and fed
// notifications, so tests/dashboard/dfu.test.mjs runs it against a simulated board.
//
// The sequence: upload the image into MCUboot's second slot, mark it for a test boot, and reset.
// MCUboot swaps it in; the new firmware confirms itself once it is up (src/dfu/dfu.c), or the
// next reset swaps the old one back. After reconnecting, verifyUpdate() checks which one runs.
import {
  GROUP_IMAGE, GROUP_OS, IMAGE_STATE, IMAGE_UPLOAD, OP_READ, OP_WRITE, OS_MCUMGR_PARAMS, OS_RESET, SmpReassembler,
  decodeSmp, encodeSmp, fragments, parseMcubootImage, smpError, toHex, uploadBody, uploadChunkLength,
} from "./smp.js";

// One link-layer packet at the board's 251-byte data length (prj.conf). Needs an ATT MTU of at
// least 247, which every Web Bluetooth host negotiates with this board (macOS gets 498).
export const WRITE_BYTES = 244;
// If the board doesn't report its SMP buffer (MCUMGR_PARAMS): Zephyr's default.
const FALLBACK_FRAME_BYTES = 384;
const REPLY_TIMEOUT_MS = 5000;
// The first upload request opens the slot, which can take a while.
const FIRST_UPLOAD_TIMEOUT_MS = 15000;
const MAX_STALLED_REPLIES = 3;
// Upload requests in flight at once, so the next one is on its way while the board answers the
// last: 8.0 -> 11.8 KB/s to a Mac. The board has 4 SMP buffers (MCUMGR_TRANSPORT_NETBUF_COUNT).
export const PIPELINE_DEPTH = 3;

export class SmpClient {
  /** `write(bytes)` sends one ATT write (without response) and resolves once it is queued. */
  constructor(write) {
    this.write = write;
    this.seq = 0;
    this.waiting = new Map(); // by sequence number
    this.reassembler = new SmpReassembler();
    // Requests can overlap, but each one's writes must reach the board back to back.
    this.sending = Promise.resolve();
  }

  /** Feed every notification from the SMP characteristic here. */
  onNotification(bytes) {
    for (const frame of this.reassembler.push(bytes)) {
      let reply;
      try {
        reply = decodeSmp(frame);
      } catch {
        continue;
      }
      const pending = this.waiting.get(reply.seq);
      if (!pending) continue;
      this.settle(reply.seq);
      const error = smpError(reply.body);
      if (error) pending.reject(new Error(error));
      else pending.resolve(reply.body);
    }
  }

  settle(seq) {
    clearTimeout(this.waiting.get(seq)?.timer);
    this.waiting.delete(seq);
  }

  /** Sends one request and resolves with the reply body, or rejects with the board's error. */
  async request(op, group, id, body = {}, { timeoutMs = REPLY_TIMEOUT_MS } = {}) {
    const seq = this.seq;
    this.seq = (this.seq + 1) & 0xff;
    const frame = encodeSmp({ op, group, id, seq, body });
    const reply = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(seq);
        this.reassembler.reset();
        reject(new Error("the board didn't answer"));
      }, timeoutMs);
      this.waiting.set(seq, { resolve, reject, timer });
    });
    const sent = this.sending.then(async () => {
      for (const part of fragments(frame, WRITE_BYTES)) await this.write(part);
    });
    this.sending = sent.catch(() => {});
    try {
      await sent;
    } catch (error) {
      this.settle(seq);
      throw error;
    }
    return reply;
  }

  /** Fails every request still waiting, e.g. when the link drops. */
  close(error) {
    for (const [seq, pending] of this.waiting) {
      this.settle(seq);
      pending.reject(error);
    }
    this.reassembler.reset();
  }

  async imageState() {
    return (await this.request(OP_READ, GROUP_IMAGE, IMAGE_STATE)).images ?? [];
  }
}

/**
 * Uploads `bytes` into the board's second slot, as large a piece per request as the board takes and
 * PIPELINE_DEPTH requests at a time, each starting where the one before should end.
 */
export async function uploadImage(client, bytes, onProgress) {
  let frameLimit = FALLBACK_FRAME_BYTES;
  try {
    const params = await client.request(OP_READ, GROUP_OS, OS_MCUMGR_PARAMS);
    if (params.buf_size > 0) frameLimit = params.buf_size;
  } catch {
    /* older MCUmgr without the params command: keep the fallback */
  }

  const send = (start) => {
    const end = start + uploadChunkLength(frameLimit, bytes.length, start);
    const reply = client.request(OP_WRITE, GROUP_IMAGE, IMAGE_UPLOAD, uploadBody(bytes.length, start, bytes.subarray(start, end)),
      { timeoutMs: start === 0 ? FIRST_UPLOAD_TIMEOUT_MS : REPLY_TIMEOUT_MS });
    reply.catch(() => {}); // awaited in turn below; this only stops an early failure going unhandled
    return { reply, end };
  };
  const checked = (reply) => {
    if (!Number.isInteger(reply.off) || reply.off < 0 || reply.off > bytes.length) {
      throw new Error("the board sent an invalid upload offset");
    }
    return reply.off;
  };

  let acked = 0; // where the board says to continue
  let next = 0; // where the next request starts
  let stalled = 0;
  const inFlight = [];
  onProgress?.(0);
  while (acked < bytes.length) {
    // The first request goes alone: it opens the slot.
    while (inFlight.length < (acked === 0 ? 1 : PIPELINE_DEPTH) && next < bytes.length) {
      const request = send(next);
      inFlight.push(request);
      next = request.end;
    }
    const { reply, end } = inFlight.shift();
    let off = checked(await reply);
    if (off !== end) {
      // The board didn't take this piece whole (or rewound), so it refuses those sent after it.
      // Let them settle, then carry on from where its latest reply says.
      for (const result of await Promise.allSettled(inFlight.splice(0).map((request) => request.reply))) {
        if (result.status === "fulfilled") off = checked(result.value);
      }
      next = off;
    }
    stalled = off > acked ? 0 : stalled + 1;
    if (stalled >= MAX_STALLED_REPLIES) throw new Error("the upload isn't progressing");
    acked = off;
    onProgress?.(acked / bytes.length);
  }
}

/**
 * Puts the image in `bytes` (zephyr.signed.bin) on the board and resets it into the new firmware.
 * `onStage` hears "uploading", "restarting". Resolves with the parsed image once the board has
 * taken the reset command; it then drops the connection. Resolves with `alreadyRunning` instead,
 * without resetting, if the board runs this image already.
 */
export async function updateFirmware(client, bytes, { onStage, onProgress } = {}) {
  const image = parseMcubootImage(bytes);
  const hash = toHex(image.hash);
  const slots = await client.imageState();
  if (slots.some((slot) => slot.active && toHex(slot.hash) === hash)) return { ...image, alreadyRunning: true };

  // An earlier attempt may have got the image across already.
  if (!slots.some((slot) => slot.slot === 1 && toHex(slot.hash) === hash)) {
    onStage?.("uploading");
    await uploadImage(client, bytes, onProgress);
    const uploaded = (await client.imageState()).find((slot) => slot.slot === 1);
    if (toHex(uploaded?.hash) !== hash) throw new Error("the board doesn't hold the uploaded image (hash mismatch)");
  }

  await client.request(OP_WRITE, GROUP_IMAGE, IMAGE_STATE, { hash: image.hash, confirm: false });
  onStage?.("restarting");
  // The board resets ~250 ms after replying, so the link can drop before the reply arrives.
  await client.request(OP_WRITE, GROUP_OS, OS_RESET).catch(() => {});
  return { ...image, alreadyRunning: false };
}

/**
 * After the board comes back: whether it runs `image` and has confirmed it. A board that rolled
 * back runs its previous firmware, the new one swapped back into the second slot. One whose
 * bootloader refused the image (not signed with the key it trusts, or damaged) never ran it, and
 * MCUboot erased it from the second slot.
 */
export async function verifyUpdate(client, image) {
  const slots = await client.imageState();
  const running = slots.find((slot) => slot.active);
  if (!running) return { ok: false, reason: "the board didn't report its running firmware" };
  if (toHex(running.hash) !== toHex(image.hash)) {
    const rolledBack = slots.some((slot) => slot.slot === 1 && toHex(slot.hash) === toHex(image.hash));
    return {
      ok: false,
      reason: rolledBack
        ? `the board rolled back to v${running.version}: the new firmware didn't start properly`
        : `the board refused the image and kept v${running.version}: it isn't signed with the key this board's bootloader trusts (or it was damaged)`,
    };
  }
  if (!running.confirmed) return { ok: false, pending: true, reason: "the new firmware hasn't confirmed itself yet" };
  return { ok: true };
}
