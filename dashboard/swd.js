// Flashing over USB: the XIAO's onboard SAMD11 is a CMSIS-DAP v2 debug probe wired to the
// nRF54LM20A's SWD port, on a vendor-class bulk interface that Chrome's WebUSB can claim (macOS
// attaches no driver to it). This module speaks CMSIS-DAP to the probe and ARM's debug interface
// (ADIv5) through it to the chip. Only openProbe() touches WebUSB; the rest takes a transport
// ({ packetSize, send(bytes) -> reply }), so tests/dashboard/swd.test.mjs runs it against a
// simulated probe and chip.
//
// Register addresses are Nordic's (nrf54lm20a MDK, pyOCD's target_nRF54L.py) and ARM's (ADIv5,
// ARMv8-M). Checked on a board over Chrome's WebUSB (2026-10-23).

export const PROBE_FILTER = { vendorId: 0x2886, productId: 0x0068 };
export const NRF_CTRL_AP_IDR = 0x32880000;

const CMD = { INFO: 0x00, CONNECT: 0x02, DISCONNECT: 0x03, TRANSFER_CONFIGURE: 0x04, TRANSFER: 0x05, TRANSFER_BLOCK: 0x06, SWJ_CLOCK: 0x11, SWJ_SEQUENCE: 0x12 };
const INFO = { VENDOR: 0x01, PRODUCT: 0x02, SERIAL: 0x03, FIRMWARE: 0x04 };
const ACK = { OK: 1, WAIT: 2, FAULT: 4, NONE: 7 };
const SWD_CLOCK_HZ = 1_000_000; // what the board's own OpenOCD script uses
// The probe retries a WAIT (the bus busy, e.g. RRAM finishing a write) this often before giving up.
const WAIT_RETRIES = 1000;

// DAP_Transfer request bits and the DP registers (by A[3:2]).
const AP_ACCESS = 0x1;
const READ = 0x2;
const DP = { DPIDR: 0x0, ABORT: 0x0, CTRL_STAT: 0x4, SELECT: 0x8 };
const ABORT_CLEAR_ALL = 0x1e; // STKCMPCLR | STKERRCLR | WDERRCLR | ORUNERRCLR
const POWER_UP_REQ = 0x50000000; // CDBGPWRUPREQ | CSYSPWRUPREQ
const POWER_UP_ACK = 0xa0000000;
const TARGETID_BANK = 2; // DPv2: TARGETID is DP register 0x4 in bank 2

// The MEM-AP (AP0, the Cortex-M33's bus) and its registers.
const MEM_AP = 0;
const CSW = 0x00;
const TAR = 0x04;
const DRW = 0x0c;
const AP_IDR = 0xfc;
const CSW_DEVICEEN = 1 << 6; // 0 while the chip's access port protection is on
// Set by default here, but FICR, RRAM and RRAMC fault non-secure accesses (the debug registers
// don't care, which hides it).
const CSW_HNONSEC = 1 << 30;
const CSW_32BIT_AUTOINC = 0x12;
// TAR auto-increment is only guaranteed within a 1 KB window.
const AUTOINC_WINDOW = 0x400;

// Nordic's CTRL-AP (AP2), which works even on a locked chip.
const CTRL_AP = 2;
const CTRL = { RESET: 0x000, ERASEALL: 0x004, ERASEALLSTATUS: 0x008, APPROTECTSTATUS: 0x014 };
const ERASEALL_READYTORESET = 1;
const ERASEALL_ERROR = 3;
const CTRL_RESET_HARD = 2;
const ERASE_TIMEOUT_MS = 30000;

const FICR_DEVICEID = 0x00ffc304;
const FICR_PART = 0x00ffc31c;
const DHCSR = 0xe000edf0;
const DHCSR_KEY = 0xa05f0000;
const DHCSR_C_DEBUGEN = 1 << 0;
const DHCSR_C_HALT = 1 << 1;
const DHCSR_S_HALT = 1 << 17;

// RRAMC: writes go through a write buffer that must be committed (see
// boards/openocd/xiao_nrf54lm20a-rram-commit.cfg for what happens when it isn't).
const RRAMC = 0x5004e000;
const RRAMC_TASKS_COMMITWRITEBUF = RRAMC + 0x008;
const RRAMC_READY = RRAMC + 0x400;
const RRAMC_BUFSTATUS_WRITEBUFEMPTY = RRAMC + 0x418;
const RRAMC_CONFIG = RRAMC + 0x500;
const RRAMC_CONFIG_WRITE_ONE_LINE = 0x101; // WEN, a one-line (16-byte) write buffer

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const le32 = (value) => [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
const u32 = (bytes, at) => (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
const hex = (value) => `0x${(value >>> 0).toString(16).padStart(8, "0")}`;

/**
 * Opens the board's probe (a WebUSB device from requestDevice({ filters: [PROBE_FILTER] })) and
 * claims its CMSIS-DAP v2 interface. Each reply is read as exactly one packet: asking for more
 * waits forever on a reply that fills the packet, as a full-size one never ends the transfer.
 */
export async function openProbe(device) {
  await device.open();
  if (!device.configuration) await device.selectConfiguration(1);
  const iface = device.configuration.interfaces.find((candidate) => candidate.alternate.interfaceClass === 0xff);
  if (!iface) {
    await device.close();
    throw new Error("this USB device has no CMSIS-DAP v2 interface");
  }
  try {
    await device.claimInterface(iface.interfaceNumber);
  } catch {
    await device.close();
    throw new Error("another program has the board's USB programmer (OpenOCD, pyOCD or another tab): close it and try again");
  }
  const endpoints = iface.alternate.endpoints;
  const out = endpoints.find((endpoint) => endpoint.direction === "out" && endpoint.type === "bulk");
  const input = endpoints.find((endpoint) => endpoint.direction === "in" && endpoint.type === "bulk");
  return {
    packetSize: input.packetSize,
    async send(bytes) {
      await device.transferOut(out.endpointNumber, bytes);
      const reply = await device.transferIn(input.endpointNumber, input.packetSize);
      return new Uint8Array(reply.data.buffer, reply.data.byteOffset, reply.data.byteLength);
    },
    async close() {
      await device.releaseInterface(iface.interfaceNumber).catch(() => {});
      await device.close();
    },
  };
}

/** CMSIS-DAP commands and ADIv5 register access over SWD, one command in flight at a time. */
export class Dap {
  constructor(transport) {
    this.transport = transport;
    this.select = null; // DP SELECT as last written
    // DAP_TransferBlock's headers: 4 bytes back on a read, 5 bytes out on a write.
    this.readBlockWords = Math.floor((transport.packetSize - 4) / 4);
    this.writeBlockWords = Math.floor((transport.packetSize - 5) / 4);
  }

  async command(bytes) {
    const reply = await this.transport.send(Uint8Array.from(bytes));
    if (reply[0] !== bytes[0]) throw new Error(`the USB programmer answered command ${bytes[0]} with ${reply[0]}`);
    return reply;
  }

  async infoString(id) {
    const reply = await this.command([CMD.INFO, id]);
    return new TextDecoder().decode(reply.subarray(2, 2 + reply[1])).replace(/\0+$/, "");
  }

  async probeInfo() {
    return {
      vendor: await this.infoString(INFO.VENDOR),
      product: await this.infoString(INFO.PRODUCT),
      serial: await this.infoString(INFO.SERIAL),
      firmware: await this.infoString(INFO.FIRMWARE),
    };
  }

  async connect() {
    const ok = (reply, what) => {
      if (reply[1] !== 0) throw new Error(`the USB programmer refused ${what}`);
    };
    ok(await this.command([CMD.SWJ_CLOCK, ...le32(SWD_CLOCK_HZ)]), "the SWD clock");
    if ((await this.command([CMD.CONNECT, 1]))[1] !== 1) throw new Error("the USB programmer refused SWD mode");
    ok(await this.command([CMD.TRANSFER_CONFIGURE, 0, WAIT_RETRIES & 0xff, WAIT_RETRIES >> 8, 0, 0]), "the transfer settings");
    this.select = null;
  }

  async disconnect() {
    await this.command([CMD.DISCONNECT]);
  }

  async swjSequence(bitCount, bytes) {
    if ((await this.command([CMD.SWJ_SEQUENCE, bitCount, ...bytes]))[1] !== 0) throw new Error("the USB programmer refused an SWD sequence");
  }

  /**
   * Line reset, the JTAG-to-SWD switch, line reset, idle: what an SWD port expects after power-up.
   * (The chip's DP also has a dormant state; it hasn't been seen in it.)
   */
  async wake() {
    const lineReset = [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
    await this.swjSequence(56, lineReset);
    await this.swjSequence(16, [0x9e, 0xe7]);
    await this.swjSequence(56, lineReset);
    await this.swjSequence(8, [0x00]);
    this.select = null;
    return this.readDp(DP.DPIDR);
  }

  static checkAck(reply, ackAt, what) {
    const ack = reply[ackAt] & 0x7;
    if (reply[ackAt] & 0x8) throw new Error(`${what}: SWD protocol error`);
    if (ack === ACK.OK) return;
    if (ack === ACK.NONE) throw new Error(`${what}: the chip doesn't answer on SWD`);
    throw new Error(`${what}: ${ack === ACK.WAIT ? "the chip stayed busy" : "the chip refused the access"}`);
  }

  async transfer(request, value) {
    const body = request & READ ? [request] : [request, ...le32(value)];
    const reply = await this.command([CMD.TRANSFER, 0, 1, ...body]);
    const what = `${request & AP_ACCESS ? "AP" : "DP"} ${request & READ ? "read" : "write"}`;
    Dap.checkAck(reply, 2, what);
    if (reply[1] !== 1) throw new Error(`${what}: not done`);
    return request & READ ? u32(reply, 3) : undefined;
  }

  readDp(register) {
    return this.transfer(READ | (register & 0xc));
  }

  writeDp(register, value) {
    return this.transfer(register & 0xc, value);
  }

  async setSelect(value) {
    if (this.select === value) return;
    await this.writeDp(DP.SELECT, value);
    this.select = value;
  }

  async selectAp(ap, register) {
    await this.setSelect(((ap << 24) | (register & 0xf0)) >>> 0);
  }

  async readAp(ap, register) {
    await this.selectAp(ap, register);
    return this.transfer(AP_ACCESS | READ | (register & 0xc));
  }

  async writeAp(ap, register, value) {
    await this.selectAp(ap, register);
    return this.transfer(AP_ACCESS | (register & 0xc), value);
  }

  async readDpBanked(bank, register) {
    await this.setSelect(bank);
    const value = await this.readDp(register);
    await this.setSelect(0);
    return value;
  }

  /** `count` reads of one AP register (DRW, with TAR auto-incrementing). */
  async readApBlock(ap, register, count) {
    await this.selectAp(ap, register);
    const reply = await this.command([CMD.TRANSFER_BLOCK, 0, count & 0xff, count >> 8, AP_ACCESS | READ | (register & 0xc)]);
    Dap.checkAck(reply, 3, "block read");
    if ((reply[1] | (reply[2] << 8)) !== count) throw new Error("block read: not done");
    return Array.from({ length: count }, (_, i) => u32(reply, 4 + 4 * i));
  }

  async writeApBlock(ap, register, words) {
    await this.selectAp(ap, register);
    const reply = await this.command([CMD.TRANSFER_BLOCK, 0, words.length & 0xff, words.length >> 8, AP_ACCESS | (register & 0xc), ...words.flatMap(le32)]);
    Dap.checkAck(reply, 3, "block write");
    if ((reply[1] | (reply[2] << 8)) !== words.length) throw new Error("block write: not done");
  }

  /** Clears the DP's sticky errors, which otherwise fail every access after one fault. */
  async clearErrors() {
    await this.writeDp(DP.ABORT, ABORT_CLEAR_ALL);
  }

  async powerUp() {
    await this.clearErrors();
    await this.setSelect(0);
    await this.writeDp(DP.CTRL_STAT, POWER_UP_REQ);
    for (let i = 0; i < 100; i++) {
      if (((await this.readDp(DP.CTRL_STAT)) & POWER_UP_ACK) >>> 0 === POWER_UP_ACK) return;
    }
    throw new Error("the chip's debug port didn't power up");
  }

  async powerDown() {
    await this.setSelect(0);
    await this.writeDp(DP.CTRL_STAT, 0);
  }
}

/** The board's BLE name suffix, as src/board_id/ derives it from Zephyr's hwinfo device ID. */
export function boardIdFromDeviceId(deviceId0, deviceId1) {
  // hwinfo's bytes: DEVICEID[1] then DEVICEID[0], each big-endian; then FNV-1a folded to 16 bits.
  const bytes = [deviceId1, deviceId0].flatMap((word) => le32(word).reverse());
  let hash = 2166136261;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
  return ((hash ^ (hash >>> 16)) & 0xffff).toString(16).toUpperCase().padStart(4, "0");
}

/** The nRF54LM20A on the other end of `dap`: identify, erase, write and check its RRAM, reset. */
export class Nrf54lm20a {
  constructor(dap, { sleep = sleepMs } = {}) {
    this.dap = dap;
    this.sleep = sleep;
    this.locked = null;
  }

  /** Connects and checks it's an nRF54L. Resolves with whether its access port protection is on. */
  async attach() {
    await this.dap.connect();
    await this.dap.wake();
    await this.dap.powerUp();
    const ctrlApIdr = await this.dap.readAp(CTRL_AP, AP_IDR);
    if (ctrlApIdr !== NRF_CTRL_AP_IDR) throw new Error(`this isn't an nRF54L (CTRL-AP ID ${hex(ctrlApIdr)})`);
    await this.setUpMemoryAccess();
    return { locked: this.locked, targetId: await this.dap.readDpBanked(TARGETID_BANK, 0x4) };
  }

  async setUpMemoryAccess() {
    const csw = await this.dap.readAp(MEM_AP, CSW);
    this.locked = !(csw & CSW_DEVICEEN);
    if (!this.locked) await this.dap.writeAp(MEM_AP, CSW, ((csw & ~(CSW_HNONSEC | 0x37)) | CSW_32BIT_AUTOINC) >>> 0);
  }

  async read32(address) {
    await this.dap.writeAp(MEM_AP, TAR, address);
    return this.dap.readAp(MEM_AP, DRW);
  }

  async write32(address, value) {
    await this.dap.writeAp(MEM_AP, TAR, address);
    await this.dap.writeAp(MEM_AP, DRW, value);
  }

  async identify() {
    if (this.locked) throw new Error("the chip is locked: erase it first");
    const [deviceId0, deviceId1] = [await this.read32(FICR_DEVICEID), await this.read32(FICR_DEVICEID + 4)];
    return { boardId: boardIdFromDeviceId(deviceId0, deviceId1), part: (await this.read32(FICR_PART)).toString(16) };
  }

  /**
   * Erases all of RRAM and UICR through the CTRL-AP, which also unlocks a protected chip, then
   * resets it. The board's settings go with it; the flash log, on the external SPI flash, stays.
   */
  async eraseAll() {
    const { dap } = this;
    await dap.writeAp(CTRL_AP, CTRL.ERASEALL, 1);
    const deadline = Date.now() + ERASE_TIMEOUT_MS;
    for (;;) {
      const status = await dap.readAp(CTRL_AP, CTRL.ERASEALLSTATUS);
      if (status === ERASEALL_READYTORESET) break;
      if (status === ERASEALL_ERROR) throw new Error("the chip reported an error erasing");
      if (Date.now() > deadline) throw new Error("the chip didn't finish erasing");
      await this.sleep(50);
    }
    await this.hardReset();
    await dap.writeAp(CTRL_AP, CTRL.ERASEALL, 0);
    await this.sleep(200);
    await dap.powerUp();
    await this.setUpMemoryAccess();
    if (this.locked) throw new Error("the chip is still locked after erasing");
  }

  async hardReset() {
    await this.dap.writeAp(CTRL_AP, CTRL.RESET, CTRL_RESET_HARD);
    await this.sleep(10);
    await this.dap.writeAp(CTRL_AP, CTRL.RESET, 0);
  }

  /** Stops the CPU, so nothing runs from RRAM while it's written (after an erase it's locked up). */
  async halt() {
    await this.write32(DHCSR, DHCSR_KEY | DHCSR_C_DEBUGEN | DHCSR_C_HALT);
    for (let i = 0; i < 100; i++) if ((await this.read32(DHCSR)) & DHCSR_S_HALT) return;
    throw new Error("the CPU didn't halt");
  }

  /** Words `[address, address + 4 * count)`, in 1 KB auto-increment windows of block transfers. */
  async forEachWindow(address, count, blockWords, visit) {
    for (let word = 0; word < count; ) {
      const at = address + 4 * word;
      await this.dap.writeAp(MEM_AP, TAR, at);
      const windowEnd = Math.min(count, word + (AUTOINC_WINDOW - (at % AUTOINC_WINDOW)) / 4);
      for (; word < windowEnd; ) {
        const n = Math.min(blockWords, windowEnd - word);
        await visit(word, n);
        word += n;
      }
    }
  }

  /** Writes `bytes` to erased RRAM at `address` (a multiple of 4), the last word padded with 0xFF. */
  async writeRram(address, bytes, onProgress) {
    const padded = new Uint8Array(Math.ceil(bytes.length / 4) * 4).fill(0xff);
    padded.set(bytes);
    const view = new DataView(padded.buffer);
    const count = padded.length / 4;
    await this.write32(RRAMC_CONFIG, RRAMC_CONFIG_WRITE_ONE_LINE);
    await this.forEachWindow(address, count, this.dap.writeBlockWords, async (word, n) => {
      const words = Array.from({ length: n }, (_, i) => view.getUint32(4 * (word + i), true));
      await this.dap.writeApBlock(MEM_AP, DRW, words);
      onProgress?.((word + n) / count);
    });
    // The last line sits in the write buffer until it's committed; a read would still find it there.
    await this.write32(RRAMC_TASKS_COMMITWRITEBUF, 1);
    for (let i = 0; ; i++) {
      if ((await this.read32(RRAMC_BUFSTATUS_WRITEBUFEMPTY)) & 1 && (await this.read32(RRAMC_READY)) & 1) break;
      if (i >= 100) throw new Error("RRAM didn't commit its write buffer");
      await this.sleep(1);
    }
    await this.write32(RRAMC_CONFIG, 0);
  }

  async read(address, length, onProgress) {
    const count = Math.ceil(length / 4);
    const out = new Uint8Array(count * 4);
    const view = new DataView(out.buffer);
    await this.forEachWindow(address, count, this.dap.readBlockWords, async (word, n) => {
      (await this.dap.readApBlock(MEM_AP, DRW, n)).forEach((value, i) => view.setUint32(4 * (word + i), value, true));
      onProgress?.((word + n) / count);
    });
    return out.subarray(0, length);
  }

  /** Lets the CPU go and resets the chip into what's now in RRAM. */
  async reset() {
    await this.write32(DHCSR, DHCSR_KEY);
    await this.hardReset();
  }

  /** Drops the debug power request and releases the SWD lines; never throws. */
  async detach() {
    try {
      await this.dap.clearErrors();
      await this.dap.powerDown();
    } catch {
      /* the chip may be mid-reset: the probe still lets go below */
    }
    await this.dap.disconnect().catch(() => {});
  }
}
