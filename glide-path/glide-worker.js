// Runs GlideCore.reachGrid off the main thread so the map stays smooth while routes round terrain are found.
//   { grid: { id, terr, W } }   keep this terrain grid (sent once per loaded block)
//   { run: {...}, id, gridId }   search it; replies { id, gridId, alt, parent, edge, ms }
importScripts('glide-core.js');
let grid = null;
onmessage = e => {
  const m = e.data;
  if (m.grid) { grid = m.grid; return; }
  if (m.run && grid && grid.id === m.gridId) {
    const t0 = performance.now();
    const r = GlideCore.reachGrid(m.run, grid.terr, grid.W, grid.W);
    postMessage({ id: m.id, gridId: m.gridId, alt: r.alt, parent: r.parent, edge: r.edge, ms: performance.now() - t0 },
      [r.alt.buffer, r.parent.buffer]);
  }
};
