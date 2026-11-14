// Runs GlideCore.reachGrid off the main thread so the map stays smooth while routes round terrain are found.
//   { grid: { id, terr, W } }   keep this terrain grid (sent once per loaded block)
//   { run: {...}, id, gridId }   search it; replies { id, gridId, alt, parent, edge, ms }
importScripts('wind-core.js', 'glide-core.js', 'soaring-core.js');
let grid = null, screenGrid = null;
onmessage = e => {
  const m = e.data;
  if (m.grid) { grid = m.grid; return; }
  if (m.screenGrid) { screenGrid = m.screenGrid; return; }
  if (m.screen) {
    const result = screenGrid && screenGrid.id === m.screenGridId ? SoaringCore.scan({...m.screen,windAt:m.screen.wind?(e,n)=>WindCore.sampleLayer(m.screen.wind,e,n):null}, screenGrid.terr, screenGrid.W) : { state: 'stale', candidates: [] };
    postMessage({ screen: true, gridId: m.gridId, key: m.screen.key, result }); return;
  }
  if(m.run&&(!grid||grid.id!==m.gridId)){postMessage({id:m.id,gridId:m.gridId,key:m.run.key,error:'stale terrain'});return;}
  if (m.run && grid && grid.id === m.gridId) {
    const t0 = performance.now();
    const r = GlideCore.reachGrid(m.run, grid.terr, grid.W, grid.W);
    postMessage({ id: m.id, key:m.run.key, gridId: m.gridId, alt: r.alt, parent: r.parent, midAlt:r.midAlt, edge: r.edge, ms: performance.now() - t0 },
      [r.alt.buffer, r.parent.buffer,r.midAlt.buffer]);
  }
};
