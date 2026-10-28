// What's new (whats-new.js shows it): what changed for someone using this page or the boards,
// newest first. The page is published, so the wording is for its users and nothing private goes in.
//
// `firmware` is the firmware release an entry needs: "next" until it ships (`task release` turns
// every "next" here into the new version, in the release commit), or absent for a page-only change.
// The page compares each board's firmware with the newest release named here. Pure, so
// tests/dashboard/changelog.test.mjs runs it in Node.

export const CHANGELOG = [
  {
    id: "2026-10-27-solid-board-model",
    date: "2026-10-27",
    title: "A solid board in the orientation view",
    items: [
      "The orientation view draws the board as a solid: its thickness, the pads down each side, the LEDs, and a complete USB-C port with its opening, so you can tell at a glance which way up and round it is.",
    ],
  },
  {
    id: "2026-10-27-secure-pairing",
    date: "2026-10-27",
    title: "Pairing with a code",
    firmware: "next",
    items: [
      "Boards now pair only with a 6-digit code, so nobody nearby can pair with one without it. Your computer asks for the code: it's shown in the board's USB console, and a phone held to a board's NFC tag opens this page with the code on it. Every pairing gets a new code.",
      "A board takes new pairings only for 2 minutes after a double press of its USER button (the LED flashes cyan), after a phone is held to it, or while it isn't paired with anything. Computers it's already paired with reconnect as before.",
      "After this update, each computer needs to pair with each board again: forget the board in your Bluetooth settings, double-press USER, then Add board.",
    ],
  },
  {
    id: "2026-10-27-wake-and-connect",
    date: "2026-10-27",
    title: "Gentler wake on motion, and a steadier start to each connection",
    firmware: "next",
    items: [
      "With Wake on motion on, lifting or tilting a sleeping board wakes it; it no longer takes a shake. Going to sleep takes 2 s longer while the motion sensor settles.",
      "A board asks for its fast connection a second after connecting rather than five, so the live data loses less while a board connects or reconnects.",
    ],
  },
  {
    id: "2026-10-27-clock-sync-holds",
    date: "2026-10-27",
    title: "Clock sync stays locked",
    firmware: "next",
    items: [
      "A board following the clock source no longer loses it every few seconds.",
      "Boards following the clock source now record clock pairs (about one a second). Before, they showed as synced with 0 pairs, so recordings couldn't be lined up by radio.",
    ],
  },
  {
    id: "2026-10-27-board-list",
    date: "2026-10-27",
    title: "Arrange the board list",
    items: [
      "Drag a board by its ID to move it in the Boards list. The order is remembered in this browser, and a board that reconnects goes back to its place.",
      "The lines between boards are even again, and the line under the list no longer says when a board reconnects (its row shows it).",
      "The angular rate and acceleration readouts hold still: every value has a sign, so its decimal point no longer jumps when it turns negative, and a value at zero no longer flickers between -0.0 and 0.0.",
      "The angular rate readout shows the rotation's overall speed (|ω|) beside X, Y and Z, as acceleration shows |a|.",
    ],
  },
  {
    id: "2026-10-27-battery-in-bluetooth-settings",
    date: "2026-10-27",
    title: "A board's battery shows in your Bluetooth settings",
    firmware: "next",
    items: [
      "Boards report their charge the standard way, so a computer or phone they're paired with can show it next to the board's name with no page open. It updates in steps of 2%.",
    ],
  },
  {
    id: "2026-10-27-notifications-and-sharing",
    date: "2026-10-27",
    title: "Notifications, sharing a recording, and boards that come back by themselves",
    items: [
      "Settings › Notifications › Notify me: while this page isn't the window in front, it tells you when a board's battery reaches 20%, its flash fills or its recording stops on the board, a board drops out and doesn't come back, or a firmware update or upload finishes.",
      "A board that went to sleep by itself (a voice command, a low battery) or dropped out for more than a minute reconnects once it's woken or back in range, without reloading the page.",
      "Share… next to Open in Replay sends the session you just saved (its CSV files and session.json) to mail or another app, where the browser can share files.",
    ],
  },
  {
    id: "2026-10-26-voice-models",
    date: "2026-10-26",
    title: "Choose your own voice commands, and upload them to the boards",
    firmware: "next",
    items: [
      "Settings › Voice › Upload model… sends a voice model (a .voice file from the training) to every connected board. The board checks it, stops listening for the few seconds it takes, and keeps it through restarts. New words or a better model no longer need new firmware; Remove takes a board's model off again.",
      "Words… in the clips dialog sets the phrases and what each one does: mouse on or off, start or stop recording, sleep, or a mark. They're saved next to the clips for training. Two phrases can do the same thing.",
      "Each board's settings show the phrases its model listens for. The ticks choose which actions the board carries out, so they stay the same when the words change.",
      "Erasing a board's recordings leaves its voice model alone, and now erases only the part of the flash that holds recordings.",
    ],
  },
  {
    id: "2026-10-26-restarted-boards",
    date: "2026-10-26",
    title: "Boards that restart mid-recording keep their data apart",
    items: [
      "A board that is put to sleep and woken, or resets, during a recording on this computer comes back with its clock started again. It now carries on in a folder of its own (…_part2) instead of mixing the two runs' times in one file.",
      "Uploading from the boards never writes over an earlier session folder that holds other recordings: the new one goes in a folder ending _2.",
      "Record says so when more than one board is set as the clock source: each listener follows whichever it hears first, so the boards would split between them.",
    ],
  },
  {
    id: "2026-10-26-board-fixes",
    date: "2026-10-26",
    title: "Steadier recording and clock sync on the boards",
    firmware: "next",
    items: [
      "Starting and stopping a flash recording in quick succession, from the page and by voice, no longer starts one recording inside another or loses the stop.",
      "A board set as the clock source tries again by itself if its broadcast fails to start or stops.",
      "The mouse keeps its priority on the link when a second computer or phone that was connected disconnects.",
      "IMU samples lost after a long stall are counted again, rather than every later loss going uncounted.",
      "A listener records a clock pair every second even when it misses the packet that second's pair was waiting for.",
    ],
  },
  {
    id: "2026-10-26-nfc-url",
    date: "2026-10-26",
    title: "Hold a phone to a board to open this page",
    firmware: "next",
    items: [
      "A board with an NFC antenna fitted offers an Android phone held to it this page's address, and its LED flashes white. The page then reads Connect and the board's ID, and the browser prompt lists only that board.",
      "Holding the phone to a sleeping board wakes it. If the board is left unused for a minute after the phone is taken away (nothing connects, USER isn't pressed, it isn't recording), it goes back to sleep.",
      "The XIAO doesn't come with an antenna: it needs a small 13.56 MHz coil soldered to its two NFC pads.",
    ],
  },
  {
    id: "2026-10-25-row-icons",
    date: "2026-10-25",
    title: "Sleep and disconnect buttons on Android",
    items: [
      "Each board's disconnect button shows its ✕ in Chrome on Android, where it was blank, and both it and the sleep button are square on a touchscreen instead of tall and narrow.",
    ],
  },
  {
    id: "2026-10-25-add-board",
    date: "2026-10-25",
    title: "Adding and waking boards without reloading the page",
    items: [
      "A board put to sleep, from the page or by holding USER, reconnects by itself once you wake it, for as long as the page is open.",
      "Add board connects a board the page is still reconnecting (just after the page opens, or after the board dropped out) instead of saying it's already reconnecting.",
      "Add board keeps trying for up to 45 s, enough to accept the pairing prompt, rather than waiting for ever on a connection that hangs; it then says what went wrong.",
    ],
  },
  {
    id: "2026-10-25-voice-service",
    date: "2026-10-25",
    title: "Voice clips from up-to-date boards",
    items: [
      "Settings › Voice no longer says \"This board's firmware can't capture clips\" for a board that can: the page wasn't asking the browser for the board's voice service. A board the browser reconnects by itself keeps its old permission, so add it once more with Add board.",
    ],
  },
  {
    id: "2026-10-25-radio-clock-only",
    date: "2026-10-25",
    title: "Boards are lined up by the radio clock alone",
    firmware: "1.2.0",
    items: [
      "Claps no longer line up the boards' clocks, and the boards no longer detect them: choose a clock source (Settings › Clock sync) before recording several boards. Saving warns about any board that recorded no clock pairs.",
      "Taps and double taps on a board are no longer detected or recorded. To mark a moment, say \"mark this moment\" on a board with voice commands.",
      "Gone with them: the Clap and Tap lamps, the Boards panel's Claps column, the clap lines on the Microphone and Replay plots, and Replay's Claps column. Recordings made before still open, with their claps and taps in events.csv.",
    ],
  },
  {
    id: "2026-10-25-imu-stream",
    date: "2026-10-25",
    title: "The full IMU rate over Bluetooth again",
    firmware: "1.2.0",
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
    firmware: "1.2.0",
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
