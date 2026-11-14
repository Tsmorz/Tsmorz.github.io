// Shared wire formats and health language. Kept byte-identical in the two published dashboards.
export const HEALTH_VERSION = 1;
export const HEALTH_BYTES = 64;
export const PROFILE_BYTES = 20;
export const DEVICE_ROLES = Object.freeze({ 1: "Bluetooth controller", 2: "Capture", 3: "Teleoperation controller", 4: "Teleoperation gateway" });
export const WIRING_PROFILES = Object.freeze({ 1: "Controller · amplifier SD on D16", 2: "Capture · amplifier SD on D1" });
const text = (view, start) => new TextDecoder().decode(new Uint8Array(view.buffer, view.byteOffset + start, 8)).replace(/\0.*$/, "");
export function decodeHealth(view) {
  if (view.byteLength !== HEALTH_BYTES || view.getUint8(0) !== HEALTH_VERSION) return null;
  const age = (at) => view.getUint16(at, true) === 65535 ? null : view.getUint16(at, true);
  return { version: HEALTH_VERSION, role: view.getUint8(1), wiring: view.getUint8(2), flags: view.getUint8(3),
    firmware: text(view, 4), build: text(view, 12), sdk: text(view, 20),
    uptimeMs: view.getUint32(28, true), resetCause: view.getUint32(32, true),
    imuAgeMs: age(36), micAgeMs: age(38), imuRecoveries: view.getUint16(40, true), micRecoveries: view.getUint16(42, true),
    imuDropped: view.getUint32(44, true), sensorErrors: view.getUint32(48, true),
    profileError: view.getInt16(52, true), resultDrops: view.getUint32(56, true), dirty: Boolean(view.getUint8(3) & 128) };
}
export function profileValid(p) {
  const integer = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
  return Boolean(p && p.version === 1 && [1, 2].includes(p.wiring) && typeof p.calibrated === "boolean" &&
    integer(p.ceiling, 1, 100) && integer(p.servoMinUs, 500, 1500) && integer(p.servoMaxUs, 1500, 2500) && p.servoMinUs < p.servoMaxUs &&
    Array.isArray(p.joystick) && p.joystick.length === 2 && p.joystick.every(a => Array.isArray(a) && a.length === 3 &&
      a.every(n => integer(n, 0, 3300)) && a[1] >= a[0] + 100 && a[2] >= a[1] + 100));
}
export function decodeProfile(view) {
  if (view.byteLength !== PROFILE_BYTES || view.getUint8(0) !== 1 || view.getUint8(1) > 1) return null;
  const profile = { version: 1, calibrated: Boolean(view.getUint8(1)), wiring: view.getUint8(2), ceiling: view.getUint8(3),
    servoMinUs: view.getUint16(4, true), servoMaxUs: view.getUint16(6, true),
    joystick: [0, 1].map(axis => [0, 1, 2].map(i => view.getUint16(8 + axis * 6 + i * 2, true))) };
  return profileValid(profile) ? profile : null;
}
export function encodeProfile(profile) {
  if (!profileValid(profile)) return null;
  const bytes = new Uint8Array(PROFILE_BYTES), v = new DataView(bytes.buffer);
  bytes.set([1, profile.calibrated ? 1 : 0, profile.wiring, profile.ceiling]);
  v.setUint16(4, profile.servoMinUs, true); v.setUint16(6, profile.servoMaxUs, true);
  profile.joystick.forEach((axis, a) => axis.forEach((n, i) => v.setUint16(8 + a * 6 + i * 2, n, true)));
  return bytes;
}

export function healthSummary({ connected, health, healthAgeMs = null, rateHz = null, expectedHz = null, lost = 0, bad = 0, clock = null, storage = null, paused = false }) {
  if (!connected) return { state: "disconnected", text: "Disconnected · readings are historical" };
  const issues = [];
  if (healthAgeMs === null || healthAgeMs > 3500) issues.push(health ? "device health is stale" : "device health unavailable: update firmware");
  if (health && [1, 2, 3].includes(health.role) && !(health.flags & 1)) issues.push("IMU unavailable");
  if (health && [1, 2].includes(health.role) && !(health.flags & 2)) issues.push("microphone unavailable");
  if (health) {
    if ((health.flags & 1) && !(health.flags & 16) && health.imuAgeMs >= 1000) issues.push("IMU stalled");
    if ((health.flags & 2) && !(health.flags & 32) && health.micAgeMs >= 1000) issues.push("microphone stalled");
  }
  if (!paused && expectedHz && rateHz !== null && rateHz < expectedHz * 0.9) issues.push("sample rate below target");
  if (lost) issues.push(`${lost} lost`);
  if (bad) issues.push(`${bad} corrupt`);
  if (health?.imuDropped) issues.push(`${health.imuDropped} IMU drops since boot`);
  if (health?.imuRecoveries || health?.micRecoveries) issues.push(`recoveries IMU ${health.imuRecoveries} / mic ${health.micRecoveries}`);
  if (health?.sensorErrors) issues.push(`${health.sensorErrors} sensor errors since boot`);
  if (health?.resultDrops) issues.push(`${health.resultDrops} command results lost`);
  if (health?.profileError && health.profileError !== -115) issues.push("profile save failed");
  if (clock?.state === "failed") issues.push("clock sync failed");
  if (clock?.role === "listener" && clock.state !== "synced") issues.push("clock source not yet heard");
  if (storage === "memory") issues.push("temporary storage: export before closing");
  if (storage === "error") issues.push("recording storage failed");
  const identity = health ? `${DEVICE_ROLES[health.role] ?? "Unknown role"} · ${health.firmware} · ${health.build}${health.dirty ? " (modified)" : ""}` : "Connected";
  return { state: issues.length ? "attention" : "good", text: `${identity} · ${paused ? "live streams paused" : `${rateHz === null ? "—" : rateHz.toFixed(1)} Hz`}${issues.length ? ` · ${issues.join(" · ")}` : " · healthy"}` };
}

export function diagnostics({ boardId, health = null, profile = null, summary, counters = {}, clock = null, recording = null }) {
  return { schema: "nrf-controller-diagnostics/1", exportedAt: new Date().toISOString(), boardId,
    health, profile, summary, counters, clock, recording };
}
export function downloadDiagnostics(report) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2) + "\n"], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url; link.download = `diagnostics-${report.boardId ?? "board"}-${Date.now()}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
