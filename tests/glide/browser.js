// task build && task shot -- /glide-path/ --eval-file tests/glide/browser.js --wait 1000
// Also run with --phone: the same controls and map modes exercise the drawer layout.
(async () => {
  const el = id => document.getElementById(id);
  const assert = (ok, why) => { if (!ok) throw new Error(why); };
  const wait = async (condition, why, ms = 30000) => {
    const end = Date.now() + ms;
    while (!condition()) { if (Date.now() > end) throw new Error(`Timed out: ${why}; ${el('calcState').textContent}`); await new Promise(r => setTimeout(r, 80)); }
  };
  el('guide').close();
  const ready = () => el('app').dataset.calc === 'ready';
  await wait(ready, 'terrain and worker ready');
  if (matchMedia('(max-width: 820px), (max-height: 520px)').matches) {
    assert(el('panel').inert, 'closed drawer is outside keyboard navigation');
    el('settingsToggle').click();
    assert(!el('panel').inert && el('settingsToggle').getAttribute('aria-expanded') === 'true', 'settings drawer opens');
    const rect = el('panel').getBoundingClientRect(), mapRect = el('map').getBoundingClientRect();
    assert(rect.top > mapRect.top + 70, 'open drawer keeps the upper map visible');
    el('expandDrawer').click(); assert(el('app').classList.contains('drawer-full'), 'drawer expands');
    el('expandDrawer').click();
  }
  const change = (id, value) => { el(id).value = value; el(id).dispatchEvent(new Event('change', { bubbles: true })); };
  document.querySelector('[data-units=metric]').click();
  change('n_va', '12.345'); change('n_agl', '140.5'); change('n_vis', '850');
  await wait(ready, 'exact input recompute');
  const metric = localStorage.getItem('glide-reach-params');
  for (let n = 0; n < 12; n++) { document.querySelector('[data-units=imperial]').click(); document.querySelector('[data-units=metric]').click(); }
  assert(localStorage.getItem('glide-reach-params') === metric && el('n_va').value === '12.345', 'unit switching preserves exact flight values');
  change('windBearing', '360'); assert(el('windBearing').value === '0', 'numeric wind bearing wraps');
  await wait(ready, 'bearing recompute');
  const original = { lat: +el('launchLat').value, lon: +el('launchLon').value };
  const target = L.latLng(original.lat, original.lon + 0.001);
  map.fire('click', { latlng: target });
  await wait(() => !el('destination').hidden && !el('destination').classList.contains('pending'), 'destination selected');
  assert(+el('launchLon').value === original.lon, 'inspection does not move launch');
  assert(el('destStats').textContent.includes('Arrival AGL') && !el('destStats').querySelector('dd').textContent.includes('—'), 'destination arrival information present');
  el('modeLaunch').click();
  map.fire('click', { latlng: L.latLng(original.lat + 0.0001, original.lon) });
  await wait(() => ready() && +el('launchLat').value !== original.lat, 'launch moved');
  assert(!el('undoLaunch').disabled && el('modeInspect').getAttribute('aria-pressed') === 'true', 'move is undoable and returns to inspection');
  assert(!el('destination').hidden, 'selected destination survives moving the launch');
  el('undoLaunch').click();
  await wait(() => ready() && +el('launchLat').value === original.lat, 'launch undo');
  assert(el('undoLaunch').disabled, 'undo history consumed');
  document.querySelector('[data-sec=plans]').open = true;
  el('retryTerrain').click();
  await wait(() => ready() && !el('retryTerrain').disabled, 'terrain reload');
  assert(!el('destination').hidden && el('n_va').value === '12.345', 'terrain reload preserves destination and flight settings');
  el('planName').value = 'Browser flight'; el('savePlan').click();
  const stored = JSON.parse(localStorage.getItem('glide-reach-plans'))[0];
  assert(stored.plan.target && stored.plan.params.va === 12.345, 'saved plan includes destination and exact settings');
  change('n_agl', '155');
  assert(el('planChanged').textContent.includes('changed') && el('agl').closest('.row').classList.contains('changed'), 'modified setting is marked');
  el('loadPlan').click();
  await wait(() => ready() && el('n_agl').value === '140.5', 'saved plan restored');
  assert(!el('planChanged').textContent.includes('changed') && !el('destination').hidden, 'plan restored with destination');
  el('aircraftName').value = 'Bench sailplane'; el('saveAircraft').click();
  assert(!el('deleteAircraft').disabled, 'custom aircraft saved and selected');
  change('n_gr', '12');
  const aircraft = [...el('aircraftPreset').options].find(o => o.textContent === 'Bench sailplane');
  change('aircraftPreset', aircraft.value);
  assert(el('n_va').value === '12.345' && el('n_agl').value === '140.5', 'aircraft restores its parameters while keeping launch height');
  await wait(ready, 'aircraft recompute');
  map.fire('click', { latlng: L.latLng(original.lat + 0.012, original.lon) });
  assert(el('destState').textContent === 'Outside sight distance' && !el('destination').hidden, 'unreachable destination stays selected with a specific reason');
  el('clearDestination').click(); assert(el('destination').hidden, 'destination clears');
  map.fire('click', { latlng: target });
  let copied;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { copied = text; } } });
  el('sharePlan').click(); await wait(() => copied, 'plan link copied');
  const shared = GlidePlan.decode(new URL(copied).hash.slice(6));
  assert(shared.target && shared.params.va === 12.345, 'share captures current destination and values');
  const iframe = document.createElement('iframe'); iframe.style.cssText = 'position:fixed;left:-10000px;width:390px;height:844px';
  iframe.src = copied; document.body.append(iframe);
  await wait(() => iframe.contentDocument?.getElementById('app')?.dataset.calc === 'ready', 'shared plan reload', 30000);
  assert(iframe.contentDocument.getElementById('n_va').value === '12.345' && !iframe.contentDocument.getElementById('destination').hidden, 'shared URL restores settings and destination in a new page');
  iframe.remove();
  el('profileToggle').click(); el('profileToggle').click();
  assert(el('profile').clientWidth > 0 || el('app').classList.contains('profile-off'), 'cross-section toggles without resizing the map incorrectly');
  if (!el('app').classList.contains('profile-off')) {
    assert(PROF && PROF.X, 'expanded cross-section renders');
    el('profile').dispatchEvent(new PointerEvent('pointermove', { clientX: el('profile').getBoundingClientRect().left + PROF.X(PROF.dMax / 2), clientY: el('profile').getBoundingClientRect().top + 40 }));
    assert(!el('profTip').hidden && el('profTip').textContent.includes('AGL'), 'scrub readout names ground and clearance explicitly');
    el('profile').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    assert(el('cursorStatus').textContent.includes('AGL'), 'keyboard cross-section inspection announces the readout');
  }
  await navigator.serviceWorker.ready;
  el('verifyAreas').click(); await wait(() => !el('verifyAreas').disabled, 'offline verification');
  assert(el('saveStatus').textContent.includes('26/26 page files verified') && el('saveStatus').textContent.includes('Incomplete'), 'offline verification distinguishes page readiness from missing saved terrain');
  // Exercise a partial offline download, retry, eviction and overlapping-area deletion in this disposable profile.
  // Use a valid fetched PNG for cache writes so this does not download 277 more real tiles.
  const tileURLs = areaKeys({ lat: original.lat, lon: original.lon }), realFetch = window.fetch;
  const tile = await (await realFetch(tileURLs.find(u => u.includes('/13/')))).blob();
  let failOne = true;
  window.fetch = async (url, options) => typeof url === 'string' && url.includes('/terrarium/')
    ? (failOne && url === tileURLs[0] ? new Response('', { status: 503 }) : new Response(tile, { status: 200, headers: { 'Content-Type': 'image/png' } }))
    : realFetch(url, options);
  el('areaName').value = 'Browser area'; el('btnSave').click();
  await wait(() => !el('btnSave').disabled, 'partial terrain save');
  assert(el('saveStatus').textContent.includes('Incomplete') && !JSON.parse(localStorage.getItem('glide-reach-areas') || '[]').length, 'partial save cannot claim completion');
  failOne = false; el('btnSave').click(); await wait(() => !el('btnSave').disabled && el('areas').textContent.includes('277/277'), 'terrain save retry');
  assert(el('areas').textContent.includes('277/277') && el('offlineReady').textContent.includes('277/277'), 'retry completes and actual current launch coverage is reported');
  el('verifyAreas').click(); await wait(() => !el('verifyAreas').disabled, 'complete offline check');
  assert(el('saveStatus').textContent.includes('Ready for offline'), 'page and complete terrain verify as ready');
  const savedCache = await caches.open('glide-terrain-saved'); await savedCache.delete(tileURLs[0]);
  el('verifyAreas').click(); await wait(() => !el('verifyAreas').disabled, 'evicted terrain check');
  assert(el('areas').textContent.includes('276/277') && el('saveStatus').textContent.includes('Incomplete'), 'verification detects an evicted terrain tile');
  el('areaName').value = 'Overlapping area'; el('btnSave').click(); await wait(() => !el('btnSave').disabled, 'overlapping area save');
  el('areas').querySelector('[data-del]').click();
  await wait(() => el('areas').querySelectorAll('[data-del]').length === 1, 'overlapping area delete');
  assert((await savedCache.keys()).length === 277, 'deleting an overlapping area keeps the other area terrain');
  el('areas').querySelector('[data-del]').click();
  await wait(() => !el('areas').querySelector('[data-del]'), 'last area delete');
  assert((await savedCache.keys()).length === 0, 'deleting the last area clears its terrain');
  window.fetch = realFetch;
  if (matchMedia('(max-width: 820px), (max-height: 520px)').matches) el('closeDrawer').click();
  assert(document.documentElement.scrollWidth <= innerWidth + 1, 'no horizontal page overflow');
  if (compact.matches) assert(el('settingsToggle').getBoundingClientRect().bottom <= innerHeight + 1, 'settings remain reachable within the viewport');
  console.log('PASS: Glide Path planning, numeric inputs, units, map modes, destination diagnosis, undo, aircraft, saved/shared plans, profile and offline verification');
})();
