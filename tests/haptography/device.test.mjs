import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DeviceClient, COMMAND, openBoardPort } from '../../haptography/device.js';
import { decodeHealth, decodeProfile, encodeProfile } from '../../haptography/device-health.js';
import { boundDrive, driveSafe, GRID, PREVIEW_PEAK, windowRms, PREVIEW_RMS, recordingTarget } from '../../haptography/haptics-core.js';
import * as W from '../../haptography/wire.js';
const info = { version: 5, flags: W.INFO_TACHAMMER_OK, haptic_rate_hz: 16000, erm_step_us: 10000, clip_max_samples: 96000, clip_max_erm: 0 };
function peer(options = {}) {
  const commands = []; let client, tag, frames = 0, dropped = false;
  client = new DeviceClient(async bytes => {
    const frame = W.cobsDecode(bytes.subarray(0, -1)), view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    const type = view.getUint8(0), number = view.getUint16(1, true);
    commands.push({ type, number, bytes });
    if (options.dropFirst && !dropped) { dropped = true; return; }
    if (type === COMMAND.begin) { frames = view.getUint32(3, true); assert.equal(view.getUint32(7, true), 0, 'no ERM track'); }
    client.feed({ type: W.ACK, body: { command_type: type, command_number: number, status: options.refuse === type ? 2 : 0 } });
    if (type === COMMAND.play) {
      tag = view.getUint16(3, true);
      if (!options.noReport) client.feed({ type: W.PLAYBACK, body: { kind: 2, id: tag, outcome: options.outcome ?? 0, frames, start_us: 1000000, end_us: 1000000 + frames / 16000 * 1e6 } });
    }
  }, { timeout: 5, attempts: 2 });
  return { client, commands };
}
test('Drake-only protocol 5 uploads no ERM, retries keep their number, and completion can arrive before the ACK finishes', async () => {
  const { client, commands } = peer({ dropFirst: true });
  const result = await client.play(new Float64Array(80), null, info);
  assert.equal(result.report.frames, 800);
  assert.deepEqual(commands[0].bytes, commands[1].bytes);
  assert.equal(commands.at(-1).type, COMMAND.stop);
  assert.equal(client.playing, false);
});
test('failed upload, incomplete playback and cancellation finish with STOP', async () => {
  for (const options of [{ refuse: COMMAND.begin }, { outcome: 2 }, { noReport: true }]) {
    const { client, commands } = peer(options);
    const promise = client.play(new Float64Array(160), null, info);
    const failed = assert.rejects(promise);
    if (options.noReport) {
      while (!commands.some(c => c.type === COMMAND.play)) await new Promise(r => setTimeout(r, 5));
      await client.stop();
    }
    await failed;
    assert.equal(commands.at(-1).type, COMMAND.stop); assert.equal(client.playing, false);
  }
});
test('Stop interrupts an upload before PLAY', async () => {
  const { client, commands } = peer();
  let stopped;
  await assert.rejects(client.play(new Float64Array(160), null, info, null, phase => {
    if (phase === 'Uploading') stopped ??= client.stop();
  }));
  await stopped;
  assert.ok(!commands.some(c => c.type === COMMAND.play));
});
test('peak, sustained drive, missing actuator and nonfinite samples are rejected before upload', async () => {
  const { client, commands } = peer();
  for (const [drive, board] of [[new Float64Array([NaN]), info], [new Float64Array([PREVIEW_PEAK + 0.01]), info], [new Float64Array(1600).fill(0.4), info], [new Float64Array(80), { ...info, flags: 0 }]]) {
    await assert.rejects(client.upload(drive, null, board));
  }
  assert.equal(commands.length, 0);
  const bounded = boundDrive(Float64Array.from({ length: GRID }, (_, i) => Math.sin(i * 0.4)));
  assert.ok(driveSafe(bounded)); assert.ok(windowRms(bounded) <= PREVIEW_RMS + 1e-10);
});
test('health and persisted profile decode the actual C fixture', () => {
  const bytes = readFileSync(new URL('../fixtures/capture/v5/health-profile.bin', import.meta.url));
  const h = decodeHealth(new DataView(bytes.buffer, bytes.byteOffset, 64));
  assert.equal(h.build, '12345678'); assert.equal(h.sensorErrors, 7); assert.equal(h.profileError, -5);
  const p = decodeProfile(new DataView(bytes.buffer, bytes.byteOffset + 64, 20));
  assert.equal(p.ceiling, 40); assert.equal(p.wiring, 2);
  assert.deepEqual(Buffer.from(encodeProfile(p)), bytes.subarray(64));
});
test('reconnect reuses one authorized XIAO; ambiguous connections use a filtered chooser', async () => {
  let choices = 0;
  const board = { getInfo: () => ({ usbVendorId: 0x2886, usbProductId: 0x0068 }), open: async options => assert.equal(options.baudRate, 1000000) };
  const serial = { getPorts: async () => [board], requestPort: async options => { choices++; assert.equal(options.filters[0].usbProductId, 0x0068); return board; } };
  assert.equal(await openBoardPort(serial), board); assert.equal(choices, 0);
  serial.getPorts = async () => [board, board];
  assert.equal(await openBoardPort(serial), board); assert.equal(choices, 1);
});

test('recording conversion refuses IMU gaps, invalid samples and still data', () => {
  const t = Float64Array.from({ length: 5000 }, (_, i) => i / 1666);
  const accel = Float64Array.from({ length: t.length * 3 }, (_, i) => Math.sin(2 * Math.PI * 95 * t[Math.floor(i / 3)]));
  const a = { imu: { t, accel } };
  assert.ok(recordingTarget(a, 0.1, 1).target.length > 1000);
  t[1000] += 0.1; assert.throws(() => recordingTarget(a, 0.1, 1), /gap/); t[1000] -= 0.1;
  accel[1500] = NaN; assert.throws(() => recordingTarget(a, 0.1, 1), /invalid/);
  accel.fill(1); assert.throws(() => recordingTarget(a, 0.1, 1), /little vibration/);
});
