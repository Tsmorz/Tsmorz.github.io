// Panel widths for the dashboard's draggable seams. Pure functions only, no DOM, so
// tests/dashboard/layout.test.mjs can run them in Node.

/**
 * The splits whose seams can be dragged, and how many tracks each divides: the top row's panels,
 * the bottom row's panels, the two rows themselves, and Microphone's two plots.
 */
export const LAYOUT_SPLITS = { top: 2, bottom: 3, rows: 2, mic: 2 };

/**
 * Sizes (px; widths, or heights for the rows) after dragging the seam after track `index` by dx
 * px: the tracks either side trade size, neither going below minWidth. Unchanged if the two can't
 * both fit minWidth.
 */
export function dragSeam(widths, index, dx, minWidth) {
  const pair = widths[index] + widths[index + 1];
  if (pair < 2 * minWidth) return [...widths];
  const left = Math.min(Math.max(widths[index] + dx, minWidth), pair - minWidth);
  const out = [...widths];
  out[index] = left;
  out[index + 1] = pair - left;
  return out;
}

/** Sizes as fractions of their sum, kept rather than pixels so a layout scales with the window. */
export function toFractions(widths) {
  const total = widths.reduce((sum, width) => sum + width, 0);
  return widths.map((width) => Number((width / total).toFixed(4)));
}

/** A grid-template-columns (or -rows) value giving the tracks these fractions of the space. */
export function gridTracks(fractions) {
  return fractions.map((fraction) => `minmax(0, ${fraction}fr)`).join(" ");
}

/** The saved layout ({ top?, bottom?, rows?, mic? } fractions), dropping anything malformed; {} if none. */
export function parseSavedLayout(text) {
  let saved;
  try {
    saved = JSON.parse(text);
  } catch {
    return {};
  }
  const layout = {};
  for (const [split, count] of Object.entries(LAYOUT_SPLITS)) {
    const fractions = saved?.[split];
    const valid = Array.isArray(fractions) && fractions.length === count &&
      fractions.every((fraction) => Number.isFinite(fraction) && fraction > 0);
    if (valid) layout[split] = fractions;
  }
  return layout;
}
