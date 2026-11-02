// Looking closely at a take in the clips dialog (voice-view.js): which samples the waveform shows,
// the highlighted section, and the 2 s file holding only that section. Pure functions only, so
// tests/dashboard/clip-view.test.mjs runs them in Node. Views and sections are { start, end } in
// samples, end excluded.

export const CLIP_SAMPLES = 32000; // a saved file and the longest take: CLIP_CAPTURE_SAMPLES in src/keyword/clip_capture.h
export const HOLD_LEAD_SAMPLES = 4800; // kept from before the press: CLIP_LEAD_SAMPLES in src/clip_lead.h
export const HOLD_TAIL_SAMPLES = 2400; // kept from after the release: CLIP_HOLD_TAIL_SAMPLES in clip_capture.h
const MIN_VIEW_SAMPLES = 800; // 50 ms at 16 kHz: closer than this shows nothing useful
const EDGE_PIXELS = 6; // how near an edge of the section a press takes hold of it
export const MIN_SECTION_SAMPLES = 1600; // 100 ms: anything less was a click, not a selection
const TONE_SAMPLES = 1600; // the stretch of room noise that fills in for the rest
const FADE_SAMPLES = 160; // 10 ms from what was there into the noise, so the join makes no click

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

export const wholeClip = (length) => ({ start: 0, end: length });

/** The part of a take of `length` samples that the key was held for. One that ran to the limit was still held at its end. */
export const heldSection = (length) => ({ start: HOLD_LEAD_SAMPLES, end: length < CLIP_SAMPLES ? length - HOLD_TAIL_SAMPLES : length });

export const sameSection = (a, b) => a.start === b.start && a.end === b.end;

/** The sample under pixel `x` of a plot `width` wide. */
export const sampleAt = (x, width, view) => Math.round(clamp(view.start + (x / width) * (view.end - view.start), view.start, view.end));

/** The pixel over `sample`, which may lie outside the plot. */
export const xOf = (sample, width, view) => ((sample - view.start) / (view.end - view.start)) * width;

/** Which edge of `section` a press at `x` takes hold of, or null. */
export function grabbedEdge(x, width, view, section) {
  const fromStart = Math.abs(x - xOf(section.start, width, view));
  const fromEnd = Math.abs(x - xOf(section.end, width, view));
  if (Math.min(fromStart, fromEnd) > EDGE_PIXELS) return null;
  return fromStart < fromEnd ? "start" : "end";
}

/** The section between where a drag began and where it is now, whichever way it went. */
export const sectionBetween = (anchor, at) => ({ start: Math.min(anchor, at), end: Math.max(anchor, at) });

/** `view` scaled by `factor` (under 1 is closer) with the sample at `at` staying put on screen. */
export function zoomed(view, at, factor, length) {
  const span = clamp((view.end - view.start) * factor, Math.min(MIN_VIEW_SAMPLES, length), length);
  const share = (at - view.start) / (view.end - view.start);
  const start = clamp(at - share * span, 0, length - span);
  return { start, end: start + span };
}

/** `view` moved `by` samples, stopping at the clip's ends. */
export function panned(view, by, length) {
  const span = view.end - view.start;
  const start = clamp(view.start + by, 0, length - span);
  return { start, end: start + span };
}

/** `view`, turned a page on if `sample` has left it, so a zoomed-in plot keeps the playhead in sight. */
export function following(view, sample, length) {
  if (sample >= view.start && sample <= view.end) return view;
  return panned(view, sample - view.start, length);
}

/** Where the clip is quietest: a stretch outside `section` if there's room for one. */
function quietestStart(samples, section) {
  const energyAt = (start) => {
    let sum = 0;
    for (let i = start; i < start + TONE_SAMPLES; i++) sum += samples[i] * samples[i];
    return sum;
  };
  const inside = (start) => start < section.end && start + TONE_SAMPLES > section.start;
  const starts = [];
  for (let start = 0; start + TONE_SAMPLES <= samples.length; start += TONE_SAMPLES / 2) starts.push(start);
  const outside = starts.filter((start) => !inside(start));
  let best = null;
  let quietest = Infinity;
  for (const start of outside.length ? outside : starts) {
    const energy = energyAt(start);
    if (energy < quietest) [best, quietest] = [start, energy];
  }
  return best;
}

/**
 * The file for a take: `section` of it in the middle of `length` samples, with the take's own room
 * noise either side. Training pads a short file with digital zeros, which the board's mic never
 * gives, so a cropped clip would teach a model that a keyword is what comes between stretches of
 * nothing.
 */
export function clipAround(take, section, length = CLIP_SAMPLES) {
  const out = new Int16Array(length);
  const shift = section.start - Math.floor((length - (section.end - section.start)) / 2);
  const start = quietestStart(take, section);
  // Played forwards then backwards, so the noise has no jump where it repeats.
  const tone = (i) => {
    if (start === null) return 0; // too short to hold any room noise
    const at = i % (2 * TONE_SAMPLES);
    return take[start + (at < TONE_SAMPLES ? at : 2 * TONE_SAMPLES - 1 - at)];
  };
  for (let i = 0; i < length; i++) {
    const source = i + shift;
    if (source >= section.start && source < section.end) {
      out[i] = take[source];
      continue;
    }
    const distance = source < section.start ? section.start - source : source - section.end + 1;
    const noise = source < 0 || source >= take.length ? 1 : Math.min(1, distance / FADE_SAMPLES);
    out[i] = Math.round((noise < 1 ? take[source] * (1 - noise) : 0) + tone(i) * noise);
  }
  return out;
}
