// task shot -- /glide-path/ --eval-file tests/glide/loading.js --console
// Repeat with --phone. A flat PNG keeps the network-failure fixtures deterministic.
(async () => {
  const el = id => document.getElementById(id);
  const assert = (ok, why) => { if (!ok) throw new Error(why); };
  const wait = async (condition, why) => {
    const end = Date.now() + 30000;
    while (!condition()) { if (Date.now() > end) throw new Error(`Timed out: ${why}`); await new Promise(r => setTimeout(r, 50)); }
  };
  el('guide').close();
  await wait(() => el('app').dataset.calc === 'ready', 'initial terrain');
  assert(!/Loading terrain/.test(el('status').textContent), 'initial completion clears the loading message');
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = TS;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = 'rgb(131,232,0)'; ctx.fillRect(0, 0, TS, TS);
  const tile = await new Promise(resolve => canvas.toBlob(resolve));
  const realFetch = window.fetch, realTimer = window.setTimeout;
  const original = { lat: launch.lat, lon: launch.lng };
  const [x, y] = G.lonLatToPx(original.lon, original.lat, Z_MAX);
  const stalledURL = terrUrl(Z_MAX, Math.floor(x / TS) - RT, Math.floor(y / TS) - RT);
  let mode = 'one', aborted = 0, requests = 0;
  try {
    el('dsEnabled').checked = false; el('dsEnabled').dispatchEvent(new Event('change'));
    windUI.restore({ enabled: false });
    Object.assign(P, { gr: 1, agl: 20, mg: 0, ws: 0, curve: false });
    el('curve').checked = false; setSliders(); afterParams(); clearTimeout(zoomTimer);
    // Exercise the production deadline without spending 12 seconds on each fixture.
    window.setTimeout = (fn, ms, ...args) => realTimer(fn, ms === TERRAIN_TIMEOUT ? 500 : ms, ...args);
    window.fetch = async (url, options) => {
      if (!String(url).includes('/terrarium/')) return realFetch(url, options);
      requests++; options?.signal?.addEventListener('abort', () => aborted++, { once: true });
      if (mode === 'all' || (mode === 'one' && url === stalledURL)) return new Promise(() => {});
      if (mode === 'body' && url === stalledURL) return { ok: true, blob: () => new Promise(() => {}) };
      return new Response(tile, { headers: { 'Content-Type': 'image/png' } });
    };
    tileMem.clear();
    await setLaunch(original.lat, original.lon, 0, { reload: true, history: false });
    assert(!loading && !placingLaunch && M.failed === 1, 'a stalled tile settles as missing and aborts its request');
    assert(aborted === 1 && el('app').dataset.calc === 'partial', 'one missing tile leaves the available terrain usable');
    assert(el('status').textContent.includes('1 of 49 terrain tiles are missing') && !el('retryTerrain').hidden, 'partial terrain replaces Loading with a retryable explanation');
    const partialRequests = requests;
    await new Promise(r => setTimeout(r, 600));
    assert(requests === partialRequests && !loading, 'incomplete terrain does not trigger repeated automatic zoom downloads');

    mode = 'ok'; el('retryTerrain').click();
    await wait(() => !el('retryTerrain').disabled && el('app').dataset.calc === 'ready', 'retry after a stalled tile');
    assert(M.failed === 0 && el('retryTerrain').hidden && el('map').getAttribute('aria-busy') === 'false', 'retry clears the failed tile and busy indicator');

    mode = 'body'; tileMem.clear();
    await setLaunch(original.lat, original.lon, 0, { reload: true, history: false });
    assert(M.failed === 1 && !loading && el('app').dataset.calc === 'partial', 'a stalled response body also has a deadline');

    mode = 'all'; tileMem.clear();
    const firstMove = setLaunch(original.lat, original.lon, 0, { reload: true, history: false });
    const latestLat = original.lat + 0.0001;
    await setLaunch(latestLat, original.lon, 0, { history: false });
    await firstMove;
    assert(!loading && !placingLaunch && !pendingLaunch && launch.lat === latestLat, 'queued launch changes finish even when every tile stalls');
    assert(el('app').dataset.calc === 'missing' && !el('retryTerrain').hidden, 'total failure leaves Loading for Terrain unavailable with Retry');
    assert(!/Loading terrain/.test(el('status').textContent) && el('map').getAttribute('aria-busy') === 'false', 'failed loading does not leave a stale label or busy state');

    mode = 'ok'; el('retryTerrain').click();
    await wait(() => !el('retryTerrain').disabled && el('app').dataset.calc === 'ready', 'retry after total failure');
    setStatus('Loading terrain 49 of 49…', 'terrain'); drawOverlay();
    assert(el('status').textContent.includes('Ground at the launch') && !/Loading terrain/.test(el('status').textContent), 'ready results replace a stale terrain progress message');
    console.log('PASS: terrain deadlines, stalled response bodies, partial/total failure, queued launches, retry, loading text and busy state');
  } finally {
    window.fetch = realFetch; window.setTimeout = realTimer;
  }
})();
