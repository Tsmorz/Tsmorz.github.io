// The computer's speakers as a second actuator. The header's Speakers switch says whether
// actuator playback (Library, Record's "Play on actuator", Recreate) is also heard here; in Demo,
// with no actuator at all, this is how a waveform is checked. One AudioContext for the page.
const KEY = "haptography-speakers";
let ctx = null, current = null;
const box = () => document.getElementById("speakers");

export function bindSpeakers() {
  try { const saved = localStorage.getItem(KEY); if (saved != null && box()) box().checked = saved === "1"; } catch { /* storage blocked */ }
  box()?.addEventListener("change", () => {
    try { localStorage.setItem(KEY, box().checked ? "1" : "0"); } catch { /* storage blocked */ }
    if (!box().checked) stopSpeakers();
  });
}

export const speakersOn = () => Boolean(box()?.checked);

/** Plays mono samples in [-1, 1] at `rate`; resolves when they end or are stopped. */
export async function playOnSpeakers(samples, rate = 16000) {
  stopSpeakers();
  ctx ??= new AudioContext();
  await ctx.resume();
  const buffer = ctx.createBuffer(1, samples.length, rate);
  buffer.copyToChannel(samples instanceof Float32Array ? samples : Float32Array.from(samples), 0);
  const source = ctx.createBufferSource();
  source.buffer = buffer; source.connect(ctx.destination);
  const ended = new Promise((resolve) => { source.onended = () => { if (current?.source === source) current = null; resolve(); }; });
  current = { source };
  source.start();
  return ended;
}

export function stopSpeakers() {
  const playing = current; current = null;
  try { playing?.source.stop(); } catch { /* already ended */ }
}
