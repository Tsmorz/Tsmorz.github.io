// The page's stream reader (haptography/wire.js) against the firmware's encoder
// (src/capture_wire.c): the same fixture and values as tests/test_capture_wire.py.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import * as wire from "../../haptography/wire.js";
import { ROOT, fixtureStream, rng } from "./fixture.mjs";


function readAll(bytes, seed = 1) {
  const reader = new wire.StreamReader();
  const rand = rng(seed);
  const packets = [];
  for (let i = 0; i < bytes.length;) {
    const n = 1 + Math.floor(rand() * 40);
    packets.push(...reader.feed(bytes.subarray(i, i + n)));
    i += n;
  }
  return { packets, reader };
}

test("every packet and value of the C fixture", () => {
  const { packets, reader } = readAll(fixtureStream().bytes);
  assert.deepEqual(packets.map((p) => p.type),
    [wire.INFO, wire.IMU, wire.MIC, wire.TOF, wire.STATS, wire.TEXT, wire.ACK, wire.PLAYBACK]);
  // Numbers wrap past 65535; the corrupted ToF packet between MIC and TOF is the one gap
  assert.deepEqual(packets.map((p) => p.number), [65534, 65535, 0, 2, 3, 4, 5, 6]);
  assert.equal(reader.lost, 1);
  assert.equal(reader.bad, 2); // the broken bytes at the start, and the corrupted packet

  const info = packets[0].body;
  assert.equal(info.version, wire.VERSION);
  assert.deepEqual([info.t_us, info.board_id, info.imu_rate_hz, info.mic_rate_hz], [1_000_000, 0xd892, 1666, 16000]);
  assert.ok(Math.abs(info.gyro_dps_per_lsb - 0.07) < 1e-6);
  assert.ok(Math.abs(info.accel_g_per_lsb - 0.000244) < 1e-9);
  assert.deepEqual([info.tof_budget_ms, info.tof_distance_mode], [15, 1]);
  assert.equal(info.flags, wire.INFO_IMU_OK | wire.INFO_MIC_OK | wire.INFO_TOF_OK | wire.INFO_TACHAMMER_OK);
  assert.deepEqual([info.haptic_rate_hz, info.erm_step_us, info.clip_max_samples, info.clip_max_erm], [16000, 10000, 96000, 600]);

  const imu = packets[1].body;
  assert.deepEqual(imu.seq, [100, 101, 102]);
  assert.deepEqual(imu.t_us, [1_000_600, 1_001_200, 1_001_800]);
  assert.deepEqual(imu.gyro[2], [-200, -199, -198]);
  assert.deepEqual(imu.accel[2], [2000, 1999, 1998]);

  const mic = packets[2].body;
  assert.deepEqual([mic.t0_us, mic.first_index, mic.arrival_us], [1_002_000, 16000, 1_012_500]);
  assert.deepEqual([...mic.samples], Array.from({ length: 160 }, (_, i) => i * 200 - 16000));

  assert.deepEqual(packets[3].body, { t_us: 1_015_000, distance_mm: 812, status: 0, signal_per_spad: 3000, ambient: 40, spads: 160 });

  const stats = packets[4].body;
  assert.deepEqual([stats.imu_samples, stats.imu_dropped, stats.tof_errors, stats.tx_dropped, stats.tx_peak_bytes], [1666, 1, 2, 3, 4096]);
  assert.deepEqual([stats.rx_commands, stats.rx_bad, stats.haptic_errors], [12, 1, 0]);
  assert.deepEqual(packets[5].body, { level: 1, text: "ToF: no target" });
  assert.deepEqual(packets[6].body, { command_type: 0x43, command_number: 41, status: 0 });
  assert.deepEqual(packets[7].body, { kind: 2, id: 7, level_percent: 100, outcome: 0, start_us: 1_020_000, end_us: 1_530_000, frames: 8000 });
});

test("piece sizes don't matter", () => {
  const ids = (seed) => readAll(fixtureStream().bytes, seed).packets.map((p) => `${p.type}:${p.number}`);
  const first = ids(1);
  for (let seed = 2; seed < 8; seed++) assert.deepEqual(ids(seed), first);
  assert.equal(readAll(fixtureStream().bytes, 1).packets.length, 8);
});

test("the page's encoders write the C encoder's bytes", () => {
  const bytes = fixtureStream().bytes;
  const { packets } = readAll(bytes);
  const hex = Buffer.from(bytes).toString("hex");
  const encode = ({ type, number, body }) => {
    switch (type) {
      case wire.INFO: return wire.encodePacket(type, number, wire.encodeInfo(body));
      case wire.IMU: return wire.encodePacket(type, number, wire.encodeImu(body.t_us[0], body.seq[0],
        body.t_us.map((t, i) => ({ dt_us: t - body.t_us[0], gyro: body.gyro[i], accel: body.accel[i] }))));
      case wire.MIC: return wire.encodePacket(type, number, wire.encodeMic(body));
      case wire.TOF: return wire.encodePacket(type, number, wire.encodeTof(body));
      case wire.STATS: return wire.encodePacket(type, number, wire.encodeStats(body));
      case wire.TEXT: return wire.encodePacket(type, number, wire.encodeText(body.level, body.text));
      case wire.ACK: return wire.encodePacket(type, number, wire.encodeAck(body));
      case wire.PLAYBACK: return wire.encodePacket(type, number, wire.encodePlayback(body));
    }
  };
  for (const p of packets) {
    assert.ok(hex.includes(Buffer.from(encode(p)).toString("hex")), `packet type ${p.type} re-encodes differently`);
  }
});

test("reader constants match the versioned firmware contract", () => {
  const contract = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/capture/v5/contract.json")));
  assert.equal(wire.VERSION, contract.version);
  for (const [key, value] of Object.entries(contract.limits)) assert.equal(wire[key], value);
  for (const [key, value] of Object.entries(contract.packets)) assert.equal(wire[key], value);
  for (const [key, value] of Object.entries(contract.flags)) assert.equal(wire[`INFO_${key}_OK`], value);
  assert.deepEqual(Object.keys(wire.PLAYBACK_KINDS).map(Number), Object.values(contract.playbackKinds));
  assert.deepEqual(wire.STATS_FIELDS, contract.statsFields);
});

test("the CRC's check value", () => {
  assert.equal(wire.crc16(new TextEncoder().encode("123456789")), 0x29b1);
});

test("COBS: round trips and rejects", () => {
  assert.equal(wire.cobsDecode(Uint8Array.of(3, 0, 1)), null);
  assert.equal(wire.cobsDecode(Uint8Array.of(5, 1)), null);
  assert.deepEqual([...wire.cobsDecode(Uint8Array.of(1, 1, 1))], [0, 0]);
  for (const len of [0, 1, 253, 254, 255, 508, 520]) {
    const data = Uint8Array.from({ length: len }, (_, i) => (i % 7 === 3 ? 0 : 1 + (i % 250)));
    const enc = wire.cobsEncode(data);
    assert.ok(!enc.includes(0));
    assert.deepEqual([...wire.cobsDecode(enc)], [...data]);
  }
});

test("not our stream", () => {
  const reader = new wire.StreamReader();
  assert.deepEqual(reader.feed(new Uint8Array(wire.MAX_ENCODED + 1).fill(1)), []);
  assert.equal(reader.bad, 1);
});

test("outgoing commands match the versioned firmware contract", async () => {
  const { COMMAND } = await import("../../haptography/device.js");
  const contract = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/capture/v5/contract.json")));
  for (const [key, name] of Object.entries({ begin: "CLIP_BEGIN", data: "CLIP_DATA", play: "PLAY_CLIP", waveform: "PLAY_WAVEFORM", effect: "PLAY_ERM_EFFECT", stop: "STOP", setProfile: "SET_PROFILE" })) {
    assert.equal(COMMAND[key], contract.commands[name]);
  }
});
