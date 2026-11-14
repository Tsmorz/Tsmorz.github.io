// task shot -- /glide-path/ --eval-file tests/glide/flight.js --wait 0 --console
// Repeat with --phone. Leave the screenshot near landing to inspect the ground/model scale.
(async () => {
  const el = id => document.getElementById(id), assert = (ok, why) => { if (!ok) throw Error(why); };
  const wait = async (condition, why) => {
    const end = Date.now() + 30000;
    while (!condition()) { if (Date.now() > end) throw Error('Timed out: ' + why); await new Promise(r => setTimeout(r, 50)); }
  };
  el('guide').close();
  await wait(() => el('app').dataset.calc === 'ready', 'initial terrain');
  el('dsEnabled').checked = false; el('dsEnabled').dispatchEvent(new Event('change'));
  windUI.restore({ enabled: false });
  Object.assign(P, { ws: 4, wd: 270 }); setSliders(); afterParams(); compute();
  await wait(() => el('app').dataset.calc === 'ready', 'manual wind');
  await set3d(false);
  map.setZoom(13); windUI.render();
  const count = document.querySelectorAll('.wind-vector').length;
  assert(count > 6 && windUI.features().length === count * 2, 'manual wind has a sparse map-wide direction field without a terrain solve');
  assert(document.querySelector('.wind-vector svg').style.transform === 'rotate(90deg)', 'westerly wind arrows point east');
  map.setZoom(18); windUI.render();
  assert(document.querySelectorAll('.wind-vector').length === count, 'zooming into a ridge preserves screen-space arrow density');
  const old = windUI.features()[0][0]; map.panBy([180, 0], { animate: false });
  assert(!windUI.features()[0][0].equals(old), 'arrows follow panning instead of staying in an old terrain grid');
  el('windArrows').checked = false; el('windArrows').dispatchEvent(new Event('change'));
  assert(!windUI.features().length && !document.querySelectorAll('.wind-vector').length, 'wind arrows can be hidden');
  el('windArrows').checked = true; el('windArrows').dispatchEvent(new Event('change'));
  await set3d(true, 0, 90, launch, 16);
  windUI.render();
  assert(windUI.features().length > 12, 'the rotated view gets the same direction vectors');

  // Follow a short 20 m glide from 2 m AGL to half a metre over the actual terrain.
  const lls = [], d = [], h = [], g = [];
  for (let k = 0; k <= 20; k++) {
    const ground = elevAtENU(k, 0); assert(Number.isFinite(ground), 'flight ground is available');
    d.push(k); g.push(ground); h.push(ground + 2 - 1.5 * k / 20); lls.push(enuToLatLng(k, 0));
  }
  let last = 0;
  view3d.fly({ lls, d, h, g, U, Va: 10, gr: 15, ws: 4, wd: 270 }, k => { last = k; });
  await wait(() => view3d.flying, 'flight starts');
  await wait(() => last >= 18, 'near landing');
  const glyph = document.querySelector('.fly-glider').getBoundingClientRect();
  assert(glyph.width === (innerWidth <= 560 ? 240 : 360), 'the readable glider size on screen is preserved');
  assert(view3d.camera.zoom > 20, 'the landing camera is at model scale, not hundreds of metres away');
  assert(!windUI.features().length, 'ground-vector glyphs do not become enormous objects in the close chase view');
  const hud=document.querySelector('.fly-hud').getBoundingClientRect(), tools=el('mapTools').getBoundingClientRect();
  assert(hud.top>=tools.bottom,'flight readout and Stop stay clear of map interaction controls');
  assert(document.documentElement.scrollWidth <= innerWidth + 1, 'the flight view fits the viewport');
  console.log('PASS: manual wind vectors, zoom/pan density, visibility, rotation and a model-scale landing with the original glider screen size');
})();
