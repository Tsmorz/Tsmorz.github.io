// Settings › Sync all boards: copies the selected board's saved settings to another board. Each
// board's own choices stay out of it: whether its mouse is on, its clock role (only one board is
// the source) and its thermometer offset (each sensor's is its own). Pure, so tests/dashboard/settings-sync.test.mjs runs it in Node.

const SYNCED = [
  {
    label: "mouse speed",
    read: (board) => board.mouse?.speedPercent,
    write: (board, speedPercent) => board.setMouse({ enabled: board.mouse.enabled, speedPercent }),
  },
  { label: "IMU ranges", read: (board) => board.imuRanges, write: (board, ranges) => board.setImuRanges(ranges), blockable: true },
  { label: "wake on motion", read: (board) => board.motionWake, write: (board, enabled) => board.setMotionWake(enabled) },
  {
    label: "voice listening",
    read: (board) => board.voice?.listening,
    write: (board, listening) => board.setVoiceSettings({ ...board.voice, listening }),
  },
];

const known = (value) => value !== undefined && value !== null;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Makes `to` match `from`, one setting at a time, carrying on past a failure. `blocker(board)` says
 * why ranges can't change now (it's recording), or null. Resolves with { changed, skipped, failed }:
 * labels of what changed, and "label (why)" for the rest. A setting already equal is neither.
 */
export async function syncBoard(from, to, { blocker = () => null } = {}) {
  const result = { changed: [], skipped: [], failed: [] };
  for (const { label, read, write, blockable } of SYNCED) {
    const wanted = read(from);
    if (!known(wanted)) continue;
    if (!known(read(to))) {
      result.skipped.push(`${label} (its firmware can't)`);
      continue;
    }
    if (same(wanted, read(to))) continue;
    const blocked = blockable ? blocker(to) : null;
    if (blocked) {
      result.skipped.push(`${label} (${blocked})`);
      continue;
    }
    try {
      await write(to, wanted);
      result.changed.push(label);
    } catch (error) {
      result.failed.push(`${label} (${error.message})`);
    }
  }
  return result;
}
