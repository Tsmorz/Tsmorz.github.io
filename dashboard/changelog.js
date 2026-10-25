// What's new (whats-new.js shows it): what changed for someone using this page or the boards,
// newest first. The page is published, so the wording is for its users and nothing private goes in.
//
// `firmware` is the firmware release an entry needs: "next" until it ships (`task release` turns
// every "next" here into the new version, in the release commit), or absent for a page-only change.
// The page compares each board's firmware with the newest release named here. Pure, so
// tests/dashboard/changelog.test.mjs runs it in Node.

export const CHANGELOG = [
  {
    id: "2026-10-25-imu-stream",
    date: "2026-10-25",
    title: "The full IMU rate over Bluetooth again",
    firmware: "next",
    items: [
      "Since v1.1.0 a board sent only a fraction of its IMU samples live (15 to 35 Hz instead of 208), because its Bluetooth packets stayed at their smallest size. They're full size again, and the board list reads ~208 Hz with nothing lost.",
      "A board whose link falls behind for a moment catches up instead of staying slow until restarted.",
      "With a board's mouse on, its mouse reports go first: the cursor answers in a connection interval or two instead of ~300 ms, and the live data loses samples while you're pointing (a flash recording keeps everything).",
      "With a board's mouse on, its mouse reports go out one at a time: the next one carries all the motion since, in the next connection event, rather than queueing behind earlier ones.",
      "Latency: the percentiles now reach 128 ms before they pile up at the maximum.",
    ],
  },
  {
    id: "2026-10-25-pose-drag",
    date: "2026-10-25",
    title: "Orientation drag and a wider board list",
    items: [
      "Dragging the Orientation view sideways turns it the way you drag.",
      "The Boards panel starts wider (double-click the seam beside it to go back to this after resizing).",
      "Motion: each live value sits right after its own axis label, rather than nearer the next one.",
      "Recording: no \"Ready.\" under Record; the button lighting up says it.",
      "The IMU rate in the board list is averaged over five seconds, so it holds steady near 208 Hz instead of jumping about with the link; samples actually lost still show beside it.",
    ],
  },
  {
    id: "2026-10-24-steadier-page",
    date: "2026-10-24",
    title: "A steadier page",
    items: [
      "Settings show your change at once (voice commands, Listening, Wake on motion, the clock source) instead of flicking back while the board confirms; one that the board refuses is put back.",
      "Panel headings stay on one line in narrow windows, and the Tap lamp keeps its size (a double tap rings it).",
      "On a phone, What's new sits beside Add board.",
    ],
  },
  {
    id: "2026-10-24-mouse-off",
    date: "2026-10-24",
    title: "The mouse starts off",
    firmware: "next",
    items: [
      "A new or freshly flashed board no longer moves the cursor: turn Mouse on in Settings for the board you want to point with. Boards that are only recording stay quiet.",
    ],
  },
  {
    id: "2026-10-24-replay-zoom",
    date: "2026-10-24",
    title: "Replay zoom, USB rescue and clearer status",
    items: [
      "Replay: zoom the values as well as the time (Option-scroll, or scroll over a lane's labels), plot the recorded quaternion, and move around from the whole-session strip at the bottom.",
      "Flash over USB keeps the last firmware that flashed a board here, so a board that needs rescuing can be flashed with no files to hand.",
      "The connection and recording news has its own line under each panel's controls; a double press of USER lights its lamp for each press.",
    ],
  },
  {
    id: "2026-10-24-radio-clock",
    date: "2026-10-24",
    title: "Radio clock, taps, wake on motion and voice settings",
    firmware: "1.1.0",
    items: [
      "Settings › Clock sync: pick one board as the source and the others record its clock about once a second; task align then lines the boards up to about a microsecond, with no clap needed.",
      "Taps: the Tap lamp on Orientation lights for each one, and a double tap marks the moment in the recording (the board's LED flashes cyan).",
      "Settings › Sleep › Wake on motion: picking up a sleeping board wakes it, as a USER press does.",
      "The battery's charge and hours left come from a fuel gauge rather than the voltage alone (approximate until the cell is profiled).",
      "Settings › Voice: whether each board listens and which commands it obeys, and what it heard lately. The clips dialog also records long background audio.",
    ],
  },
  {
    id: "2026-10-24-keyword-clips",
    date: "2026-10-24",
    title: "Recording voice-command clips",
    firmware: "1.1.0",
    items: [
      "Settings › Voice opens a dialog that records clips of the voice-command phrases through a board's own microphone, saved as WAV files for training.",
    ],
  },
  {
    id: "2026-10-23-usb-flash",
    date: "2026-10-23",
    title: "Flash over USB from the browser",
    items: [
      "Settings › Firmware › Flash over USB… flashes a board plugged into this computer, with no tools to install; the last firmware that worked is kept to hand.",
      "Grips on every seam between panels: drag one to resize, double-click to put it back.",
    ],
  },
  {
    id: "2026-10-22-spectrum",
    date: "2026-10-22",
    title: "Mic spectrum, IMU ranges and temperature",
    firmware: "1.1.0",
    items: [
      "The Microphone panel shows the spectrum under the envelope.",
      "Settings › IMU ranges sets each board's gyro and accelerometer full scale, saved on the board.",
      "The IMU's temperature is recorded about once a second.",
    ],
  },
  {
    id: "2026-10-20-replay",
    date: "2026-10-20",
    title: "Replay",
    items: ["Replay in the header opens a recorded session and plots every board on one time axis."],
  },
];

/** [major, minor, patch] of a version like "1.0.1" or "1.0.1+0", or null. */
export function parseVersion(text) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(text ?? "").trim());
  return match ? match.slice(1, 4).map(Number) : null;
}

/** Negative, zero or positive as version a is older than, the same as, or newer than b. */
export function compareVersions(a, b) {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** The newest firmware release the changelog names, or null if none has shipped yet. */
export function latestFirmware(entries = CHANGELOG) {
  const released = entries.map((entry) => entry.firmware).filter((version) => parseVersion(version));
  return released.reduce((newest, version) => (newest && compareVersions(newest, version) >= 0 ? newest : version), null);
}

/** Whether a board reporting `version` runs older firmware than `latest`. Unknown versions aren't flagged. */
export function boardBehind(version, latest = latestFirmware()) {
  return Boolean(latest && parseVersion(version) && compareVersions(version, latest) < 0);
}

/**
 * The entries to mark new: those above the one last seen. Someone who has never opened the list
 * gets only the newest, and so does someone whose last-seen entry has since been dropped.
 */
export function unseen(entries, seenId) {
  const at = entries.findIndex((entry) => entry.id === seenId);
  return at < 0 ? entries.slice(0, 1) : entries.slice(0, at);
}

/** A line on what firmware an entry needs, given the versions of the connected boards; "" if none. */
export function firmwareNote(entry, boardVersions) {
  if (!entry.firmware) return "";
  if (entry.firmware === "next") return "Comes with the next firmware release.";
  const behind = boardVersions.filter((version) => boardBehind(version, entry.firmware)).length;
  if (!behind) return `Firmware v${entry.firmware}${boardVersions.length ? ": your boards have it." : "."}`;
  return `Needs firmware v${entry.firmware}: ${behind} connected board${behind === 1 ? " is" : "s are"} behind (Settings › Firmware).`;
}
