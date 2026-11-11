// The controller's actuators and inputs as the Actuators dialog shows them (actuator-view.js):
// the waveform library, in step with the firmware's src/actuator_library.h (ids go over the air;
// tests/dashboard/firmware-consistency checks the two), and the arithmetic for the readouts. Pure,
// so tests/dashboard/actuators.test.mjs can run it in Node.

// The TacHammer through the I2S amp (src/haptic_waveform.c has the shapes).
export const TACHAMMER_WAVEFORMS = [
  { id: 1, key: "CLICK", label: "Click" },
  { id: 2, key: "DOUBLE_CLICK", label: "Double click" },
  { id: 3, key: "KNOCK", label: "Knock (pulse, then brake)" },
  { id: 4, key: "HEARTBEAT", label: "Heartbeat ×3" },
  { id: 5, key: "TICKS", label: "Ticks, 10 Hz for 1 s" },
  { id: 6, key: "BUZZ_50HZ", label: "Buzz 50 Hz" },
  { id: 7, key: "BUZZ_150HZ", label: "Buzz 150 Hz" },
  { id: 8, key: "RAMP_UP", label: "Ramp up, 80 Hz" },
  { id: 9, key: "SWEEP", label: "Sweep 20 → 250 Hz" },
  { id: 10, key: "ENGINE", label: "Engine rumble, 30 Hz" },
];

// The pancake ERM through the DRV2605L: one effect each from TI's ROM library A.
export const ERM_PRESETS = [
  { id: 1, key: "STRONG_CLICK", effect: 1, label: "Strong click" },
  { id: 2, key: "SHARP_CLICK", effect: 4, label: "Sharp click" },
  { id: 3, key: "SOFT_BUMP", effect: 7, label: "Soft bump" },
  { id: 4, key: "DOUBLE_CLICK", effect: 10, label: "Double click" },
  { id: 5, key: "TRIPLE_CLICK", effect: 12, label: "Triple click" },
  { id: 6, key: "STRONG_BUZZ", effect: 14, label: "Strong buzz" },
  { id: 7, key: "ALERT_750MS", effect: 15, label: "Alert, 750 ms" },
  { id: 8, key: "PULSING", effect: 52, label: "Pulsing" },
  { id: 9, key: "HUM", effect: 64, label: "Hum" },
  { id: 10, key: "RAMP_DOWN", effect: 70, label: "Ramp down" },
  { id: 11, key: "RAMP_UP", effect: 82, label: "Ramp up" },
  { id: 12, key: "LONG_BUZZ", effect: 118, label: "Long buzz (until stopped)" },
];
export const ERM_ROM_EFFECT_MAX = 123;
export const RUMBLE_MS = { min: 10, max: 5000 }; // ACTUATOR_RUMBLE_MIN_MS / MAX_MS

// The feedback servo (src/servo_motion.c has the motions).
export const SERVO_PATTERNS = [
  { id: 1, key: "CENTER", label: "Centre" },
  { id: 2, key: "SLOW_SWEEP", label: "Slow sweep, 4 s each way" },
  { id: 3, key: "STEPS", label: "Steps ±30°" },
  { id: 4, key: "SINE_SLOW", label: "Sine 0.5 Hz" },
  { id: 5, key: "SINE_FAST", label: "Sine 2 Hz" },
  { id: 6, key: "SPRING", label: "Spring (push it by hand)" },
];
export const SERVO_PULSE_US = { min: 500, center: 1500, max: 2500 }; // SERVO_PULSE_*_US

// enum sysid_key in src/sysid_wire.h: the buttons wired to the board's pads, as key events carry them.
export const KEYS = { 1: "up", 2: "down", 3: "left", 4: "right", 5: "stick" };

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** Roughly the servo's angle from centre for a pulse, at the common 90° per 1000 µs. */
export const pulseToDegrees = (pulseUs) => ((pulseUs - SERVO_PULSE_US.center) * 90) / 1000;

/** The servo's measured position, 0-1 along its pot, from the status (null without a supply). */
export function feedbackFraction({ servoFeedbackMv, servoRailMv }) {
  if (!servoRailMv || servoRailMv < 1000) return null; // the rail is off, or nothing is wired
  return clamp(servoFeedbackMv / servoRailMv, 0, 1);
}

/** The stick's position for drawing, -1 to 1 each way, from its voltages on a 3.3 V supply. */
export function stickPoint(xMv, yMv, supplyMv = 3300) {
  const half = supplyMv / 2;
  return { x: clamp((xMv - half) / half, -1, 1), y: clamp((yMv - half) / half, -1, 1) };
}

/** The held keys' names from the status's bitmask (bit key - 1). */
export const heldKeys = (mask) => Object.entries(KEYS).filter(([key]) => mask & (1 << (key - 1))).map(([, name]) => name);

/** The last windowMs of the servo's command and feedback, for the dialog's plot. */
export class ServoTrace {
  constructor(windowMs = 10_000) {
    this.windowMs = windowMs;
    this.points = []; // { tMs, command: 0-1 or null, feedback: 0-1 or null }
  }

  /** Adds a status received at tMs (the page's clock). */
  add(tMs, status) {
    const command = status.servoPulseUs ? (status.servoPulseUs - SERVO_PULSE_US.min) / (SERVO_PULSE_US.max - SERVO_PULSE_US.min) : null;
    this.points.push({ tMs, command, feedback: feedbackFraction(status) });
    while (this.points.length && this.points[0].tMs < tMs - this.windowMs) this.points.shift();
  }

  clear() {
    this.points.length = 0;
  }
}
