import { WIRING_PROFILES, profileValid } from "./device-health.js";

export function bindProfileEditor(container, { save }) {
  container.innerHTML = `<details><summary>Hardware profile</summary>
    <p data-wiring>No profile received. Update the firmware to configure this board.</p>
    <p>Wiring is fixed by the firmware. Limits and calibration are saved on this board. Stop actuators before saving.</p>
    <form><fieldset disabled><label>Maximum haptic drive (%) <input name="ceiling" type="number" min="1" max="100" required></label>
    <label>Servo minimum (µs) <input name="servoMinUs" type="number" min="500" max="1500" required></label>
    <label>Servo maximum (µs) <input name="servoMaxUs" type="number" min="1500" max="2500" required></label>
    <label><input name="calibrated" type="checkbox"> Use measured joystick calibration</label>
    <p>Enter the measured low, centre and high voltages (mV, 0–3300) for each axis. Leave calibration off to use automatic centring.</p>
    ${["X", "Y"].map((axis, a) => `<div>Joystick ${axis} ${["low", "centre", "high"].map((label, i) => `<label>${label} <input name="axis${a}${i}" aria-label="Joystick ${axis} ${label} mV" type="number" min="0" max="3300" required></label>`).join(" ")}</div>`).join("")}
    <button type="submit">Save on board</button></fieldset></form><p role="status" data-result></p></details>`;
  const form = container.querySelector("form"), fields = form.elements, result = container.querySelector("[data-result]");
  let profile = null, boardKey = null, busy = false, edited = false, available = false;
  form.addEventListener("input", () => { edited = true; });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!profile || busy || !form.reportValidity()) return;
    const next = { ...profile, calibrated: fields.calibrated.checked,
      ceiling: Number(fields.ceiling.value), servoMinUs: Number(fields.servoMinUs.value), servoMaxUs: Number(fields.servoMaxUs.value),
      joystick: [0, 1].map(a => [0, 1, 2].map(i => Number(fields[`axis${a}${i}`].value))) };
    if (!profileValid(next)) { result.textContent = "Invalid limits: joystick points need at least 100 mV between them, and servo limits must span 1500 µs."; return; }
    const savedKey = boardKey;
    busy = true; form.querySelector("fieldset").disabled = true;
    try { await save(next, savedKey); if (savedKey === boardKey) { edited = false; result.textContent = "Saved and read back from the board."; } }
    catch (error) { result.textContent = error.message; }
    finally { busy = false; form.querySelector("fieldset").disabled = !profile || !available; }
  });
  return {
    sync(next, key, connected = true) {
      if (key !== boardKey) { edited = false; result.textContent = ""; }
      boardKey = key;
      available = connected;
      profile = next;
      container.querySelector("[data-wiring]").textContent = next ? `${WIRING_PROFILES[next.wiring] ?? "Unknown wiring"} · drive ceiling ${next.ceiling}%` : "No profile received. Update the firmware to configure this board.";
      form.querySelector("fieldset").disabled = !connected || !next || busy;
      if (!next || edited || busy) return;
      for (const name of ["ceiling", "servoMinUs", "servoMaxUs"]) fields[name].value = next[name];
      fields.calibrated.checked = next.calibrated;
      next.joystick.forEach((axis, a) => axis.forEach((mv, i) => { fields[`axis${a}${i}`].value = mv; }));
    },
  };
}
