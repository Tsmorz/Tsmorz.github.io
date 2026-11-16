// The Library workspace: common waveforms from _data/haptography.yml (drawn by library-core.js)
// and the versions saved in Recreate. Click a tile to play it on the speakers and/or the actuator;
// star favorites (kept in IndexedDB) and export them for the firmware or another page.
import * as L from "./library-core.js";
import { GRID, peak, wav } from "./haptics-core.js";
import { readColors } from "./plots.js";
import { playOnSpeakers, speakersOn, stopSpeakers } from "./speakers.js";

const $ = (id) => document.getElementById(id);
const node = (tag, text = "", cls = "") => Object.assign(document.createElement(tag), { textContent: text, className: cls });

export async function mountLibrary(api) {
  const content = JSON.parse($("studio-content").textContent);
  const catalog = content.library ?? [], groups = content.library_groups ?? [];
  const drives = new Map(); // id -> the drive's sounding part (no padding), rendered once
  const sounding = (item) => {
    if (!drives.has(item.id)) {
      const d = item.variant ? Float64Array.from(item.variant.result.drive) : L.drive(item, 1);
      drives.set(item.id, item.variant ? d : d.subarray(0, L.render(item, GRID).length));
    }
    return drives.get(item.id);
  };
  const fmtLength = (s) => s < 0.1 ? `${Math.max(1, Math.round(s * 1000))} ms` : `${s.toFixed(2)} s`;
  let favorites = new Set(), filter = "all", playing = null;

  try { favorites = new Set((await api.store().getState("library"))?.favorites ?? []); } catch { /* fresh browser */ }
  const save = () => api.store().putState("library", { favorites: [...favorites] }).catch(() => say("Favorites could not be saved in this browser.", true));
  const say = (text, bad = false) => { $("lib-play-status").textContent = text; $("lib-play-status").className = `status-line${bad ? " bad" : ""}`; };
  const level = () => Number($("lib-level").value) / 100;

  // Saved Recreate versions, newest first, as library items.
  const recorded = () => (api.variants() ?? []).slice().reverse().map((v) => ({
    id: `v:${v.id}`, name: v.name, group: "recordings", variant: v,
    feel: [v.about?.label, v.simulated ? "simulated" : "", v.score ? `band error ${v.score.bandError.toFixed(1)} dB` : ""].filter(Boolean).join(" · ") || "Saved in Recreate",
  }));
  const items = () => [...catalog, ...recorded()];
  const driveOf = (item) => {
    if (item.variant) return Float64Array.from(item.variant.result.drive, (v) => v * level());
    return L.drive(item, level());
  };

  function shown() {
    const all = items();
    if (filter === "all") return all.filter((i) => !i.variant);
    if (filter === "favorites") return all.filter((i) => favorites.has(i.id));
    return all.filter((i) => i.group === filter);
  }

  function render() {
    const grid = $("waveform-grid"), list = shown(), cards = [];
    let group = null;
    for (const item of list) {
      if (filter === "all" || filter === "favorites") {
        const g = item.variant ? "recordings" : item.group;
        if (g !== group) { group = g; cards.push(node("h3", groups.find((x) => x.id === g)?.name ?? "From recordings", "wave-group")); }
      }
      const card = node("div", "", `wave-card${playing === item.id ? " playing" : ""}`);
      card.dataset.id = item.id;
      const play = node("button", "", "wave-play");
      play.type = "button"; play.setAttribute("aria-label", `Play ${item.name}`);
      play.append(node("canvas"), node("b", item.name), node("span", item.feel ?? ""), node("small", fmtLength(sounding(item).length / GRID)));
      const star = node("button", favorites.has(item.id) ? "★" : "☆", "star");
      star.type = "button"; star.setAttribute("aria-pressed", String(favorites.has(item.id)));
      star.setAttribute("aria-label", `Favorite ${item.name}`); star.title = favorites.has(item.id) ? "Remove from favorites" : "Add to favorites";
      card.append(play, star); cards.push(card);
    }
    if (!list.length) cards.push(node("p", filter === "favorites" ? "No favorites yet: star a waveform to keep it here." : "Nothing saved yet. Recreate a recording and press Save to library.", "empty-note"));
    grid.replaceChildren(...cards);
    $("lib-export").disabled = !favorites.size;
    requestAnimationFrame(sparklines);
  }

  // Each tile's drive as a min/max trace. Canvas size comes from CSS; only the buffer is set here.
  function sparklines() {
    const c = readColors();
    for (const card of $("waveform-grid").querySelectorAll(".wave-card")) {
      const item = items().find((i) => i.id === card.dataset.id), canvas = card.querySelector("canvas");
      if (!item || !canvas.clientWidth) continue;
      const dpr = devicePixelRatio || 1, w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      const x = sounding(item), g = canvas.getContext("2d"), mid = h / 2, scale = (h / 2 - 2 * dpr) / (peak(x) || 1);
      g.clearRect(0, 0, w, h);
      g.fillStyle = c.signal; g.globalAlpha = 0.9;
      for (let px = 0; px < w; px++) {
        const a = Math.floor(px / w * x.length), b = Math.max(a + 1, Math.floor((px + 1) / w * x.length));
        let lo = 0, hi = 0;
        for (let i = a; i < b && i < x.length; i++) { lo = Math.min(lo, x[i]); hi = Math.max(hi, x[i]); }
        g.fillRect(px, mid - hi * scale, 1, Math.max(dpr, (hi - lo) * scale));
      }
    }
  }

  async function play(item) {
    const toBoard = $("lib-board").checked && api.canPlay(), toSpeakers = speakersOn();
    if (!toBoard && !toSpeakers) { say(api.source() ? "Turn on Speakers or Actuator to hear it." : "Turn on Speakers (top right), or connect a board.", true); return; }
    api.stopAudio(); stopSpeakers();
    playing = item.id; mark();
    const drive = driveOf(item);
    const where = [toSpeakers && "speakers", toBoard && (api.source()?.kind === "demo" ? "simulated actuator" : "TacHammer")].filter(Boolean).join(" and ");
    say(`${item.name} · ${(peak(drive) * 100).toFixed(0)}% peak drive · on the ${where}`);
    const audio = toSpeakers ? playOnSpeakers(item.variant ? L.driveAudio(drive) : L.speaker(item, level())) : null;
    try {
      // The studio owns the board: it uploads the clip, plays it and sends STOP on failure.
      if (toBoard) await api.playOnce(drive, item.name, { speakers: false });
      await audio;
    } catch (err) { say(err.message, true); }
    if (playing === item.id) { playing = null; mark(); }
  }
  const mark = () => $("waveform-grid").querySelectorAll(".wave-card").forEach((c) => c.classList.toggle("playing", c.dataset.id === playing));

  $("waveform-grid").addEventListener("click", (event) => {
    const card = event.target.closest(".wave-card"); if (!card) return;
    const item = items().find((i) => i.id === card.dataset.id); if (!item) return;
    if (event.target.closest(".star")) {
      favorites.has(item.id) ? favorites.delete(item.id) : favorites.add(item.id);
      save(); render();
      return;
    }
    if (event.target.closest(".wave-play")) play(item);
  });
  for (const radio of document.querySelectorAll("input[name=lib-filter]")) radio.addEventListener("change", () => { filter = radio.value; render(); });
  $("lib-level").addEventListener("input", () => { $("lib-level-out").textContent = `${$("lib-level").value}%`; });

  $("lib-export").addEventListener("click", async () => {
    const picked = items().filter((i) => favorites.has(i.id));
    const data = L.libraryJson(picked.filter((i) => !i.variant), picked.filter((i) => i.variant).map((i) => ({
      id: i.id, name: i.name, source: "recording", about: i.variant.about, settings: i.variant.settings, seconds: i.variant.result.drive.length / GRID,
    })));
    const text = JSON.stringify(data, null, 2);
    try {
      if (window.showDirectoryPicker) {
        const dir = await window.showDirectoryPicker({ id: "haptography-library", mode: "readwrite" });
        const write = async (name, bytes) => { const h = await dir.getFileHandle(name, { create: true }), out = await h.createWritable(); await out.write(bytes); await out.close(); };
        await write("library.json", text);
        for (const i of picked) await write(`${i.id.replace(/[^\w-]+/g, "-")}.wav`, wav(i.variant ? Float64Array.from(i.variant.result.drive) : L.drive(i, 1)));
      } else {
        const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([text], { type: "application/json" })), download: "library.json" });
        a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }
      say(`Exported ${picked.length} favorite${picked.length === 1 ? "" : "s"}.`);
    } catch (err) { if (err.name !== "AbortError") say(err.message, true); }
  });

  new ResizeObserver(() => sparklines()).observe($("waveform-grid"));
  document.addEventListener("haptography-theme", sparklines);
  render();
  return {
    refresh() { drives.forEach((_, k) => k.startsWith("v:") && drives.delete(k)); render(); },
    favorites: () => [...favorites],
  };
}
