// The joystick's response curve as the board applies it (src/joystick_mouse.c's joystick_counts()),
// for the Joystick curve dialog (joystick-view.js) to draw. Pure, so tests/dashboard/joystick.test.mjs
// checks it against the same numbers as the firmware's host test.
import { stickPoint } from "./actuators.js";

/** Cursor speed in counts a second for a deflection (-1 to 1) at a mouse speed (%). */
export function joystickSpeed(deflection, { deadzonePercent, slowGain, fastGain }, speedPercent = 100) {
  const deadzone = deadzonePercent / 100;
  const magnitude = Math.abs(deflection);
  if (magnitude <= deadzone) return 0;
  const beyond = Math.min(1, (magnitude - deadzone) / (1 - deadzone));
  const speed = ((slowGain * beyond + fastGain * beyond ** 3) * speedPercent) / 100;
  return Math.sign(deflection) * speed;
}

/** The curve from no push to a full one, as `steps + 1` { deflection, speed } points. */
export function curvePoints(tuning, speedPercent = 100, steps = 100) {
  return Array.from({ length: steps + 1 }, (_, i) => ({ deflection: i / steps, speed: joystickSpeed(i / steps, tuning, speedPercent) }));
}

/**
 * Roughly how far the stick is pushed (0-1, whichever way), from the board's status. The board learns
 * the stick's own centre and reach; this assumes the middle of a 3.3 V supply and its full span, so it
 * only places the dot on the curve.
 */
export function stickPush({ joystickXMv, joystickYMv }) {
  const { x, y } = stickPoint(joystickXMv, joystickYMv);
  return Math.min(1, Math.hypot(x, y));
}
