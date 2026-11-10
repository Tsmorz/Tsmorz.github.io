// Glide Path: the page. The maths is in glide-core.js (no DOM); the route search runs in glide-worker.js.
'use strict';
const G = GlideCore;
const TS = 256, RT = 3;                   // compute on a 7 × 7 block of terrain tiles round the launch
const Z_MAX = 13, Z_MIN = 9;              // zoom 13 is ~14 m per pixel here; long glides drop to coarser zooms
const SAVE_R = RT + 1, SAVE_R_LOW = RT;   // a saved area: 9 × 9 tiles at zoom 13, 7 × 7 at zooms 12 to 9
const SAVED = 'glide-terrain-saved', RUNTIME = 'glide-terrain-runtime';
const terrUrl = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const M_HILL = { lat: 44.0860, lon: -103.2490, snap: 200 };
// Map overlay colours: the light steps of the validated set, since both base maps are light.
const C = { straight: [42, 120, 214], curve: [27, 175, 122], curveDark: [14, 122, 84], steep: [120, 118, 110], out: [110, 108, 100],
            hit: '#eb6834', route: '#0e7a54', line: '#1d1f21', ring: '#1f63b8' };
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const SHORT = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (d, long) => (long ? COMPASS : SHORT)[Math.round(d / 45) % 8];

const LS = {
  get(k, d) { try { const v = localStorage.getItem('glide-reach-' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('glide-reach-' + k, JSON.stringify(v)); } catch (e) {} }
};
const $ = id => document.getElementById(id);
const setStatus = html => { $('status').innerHTML = html; };

if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) navigator.serviceWorker.register('sw.js').catch(() => {});

// Theme colours for the cross-section, read once per theme change rather than on every draw.
let COL = {};
function readColours() {
  const cs = getComputedStyle(document.documentElement), v = n => cs.getPropertyValue(n).trim();
  COL = { straight: v('--s-straight'), curve: v('--s-curve'), hit: v('--s-hit'), terrain: v('--terrain'), terrainEdge: v('--terrain-edge'),
          line: v('--line'), muted: v('--muted'), ink2: v('--ink-2'), surface2: v('--surface-2'), warn: v('--warn') };
}
readColours();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readColours(); drawProfile(); });
$('theme').onclick = () => {
  const root = document.documentElement;
  const dark = root.getAttribute('data-theme') ? root.getAttribute('data-theme') === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.setAttribute('data-theme', dark ? 'light' : 'dark');
  try { localStorage.setItem('theme', dark ? 'light' : 'dark'); } catch (e) {}
  readColours(); drawProfile();
};

// ---------- Units: sliders work in the chosen system; P always holds metric values ----------
// [min, max, step, unit] per system, and k: the factor from metric to imperial; read-outs come from GlideCore.Units.
const SPEC = {
  gr:  { metric: [4, 40, 0.5, ':1'], imperial: [4, 40, 0.5, ':1'], k: 1, def: 15 },
  va:  { metric: [5, 25, 0.5, 'm/s'], imperial: [10, 55, 1, 'mph'], k: G.MPH, def: 10 },
  agl: { metric: [0, 300, 5, 'm'], imperial: [0, 1000, 10, 'ft'], k: G.FT, def: 120 },
  ws:  { metric: [0, 15, 0.5, 'm/s'], imperial: [0, 35, 1, 'mph'], k: G.MPH, def: 0 },
  vis: { metric: [100, 3000, 50, 'm'], imperial: [300, 10000, 100, 'ft'], k: G.FT, def: 600 },
  mg:  { metric: [0, 60, 5, 'm'], imperial: [0, 200, 10, 'ft'], k: G.FT, def: 20 },
  sl:  { metric: [2, 30, 1, '°'], imperial: [2, 30, 1, '°'], k: 1, def: 12 },
};
let units = LS.get('units', (navigator.language || '').toLowerCase() === 'en-us' ? 'imperial' : 'metric');
let U = G.Units[units];
const saved = LS.get('params', {});
const P = {};
for (const k of Object.keys(SPEC)) P[k] = saved[k] != null ? saved[k] : SPEC[k].def;
P.wd = saved.wd != null ? saved.wd : 270;
P.pb = saved.pb != null ? saved.pb : 180;
P.curve = saved.curve !== false;
$('curve').checked = P.curve;

const factor = k => units === 'imperial' ? SPEC[k].k : 1; // metric value × factor = what the slider shows
function setSliders() {
  for (const [k, s] of Object.entries(SPEC)) {
    const [min, max, step] = s[units], el = $(k);
    el.min = min; el.max = max; el.step = step;
    el.value = Math.min(max, Math.max(min, Math.round(P[k] * factor(k) / step) * step));
    showValue(k);
  }
  document.querySelectorAll('[data-units]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.units === units)));
}
function showValue(k) {
  const s = SPEC[k], unit = s[units][3], v = +$(k).value;
  $('v_' + k).textContent = unit === ':1' ? `${v}:1` : unit === '°' ? `${v}°` : `${v} ${unit}`;
}
function save() { LS.set('params', P); }
for (const k of Object.keys(SPEC)) $(k).addEventListener('input', () => {
  P[k] = +$(k).value / factor(k); showValue(k); save(); afterParams(); schedule('all');
});
$('curve').addEventListener('change', () => { P.curve = $('curve').checked; save(); afterParams(); schedule('all'); });
document.querySelectorAll('[data-units]').forEach(b => b.onclick = () => {
  units = b.dataset.units; U = G.Units[units]; LS.set('units', units);
  setSliders(); for (const k of Object.keys(SPEC)) P[k] = +$(k).value / factor(k); save(); afterParams(); if (launch) placeStatus(); schedule('all');
});

function afterParams() {
  $('wdDial').classList.toggle('calm', !P.ws);
  $('windWords').textContent = P.ws ? `From the ${compass(P.wd, true)}, blowing ${compass((P.wd + 180) % 360, true)}.` : 'Calm.';
  const kc = document.getElementById('keyCurve'); if (kc) kc.hidden = !P.curve;
  windBadge();
}
// the wind on the map: an arrow the way it blows (north is always up), its speed and where it comes from
function windBadge() {
  const box = document.getElementById('windMap'); if (!box) return;
  box.classList.toggle('calm', !P.ws);
  box.querySelector('.wind-arrow').style.transform = `rotate(${(P.wd + 180) % 360}deg)`;
  box.querySelector('.wind-text').innerHTML = P.ws ? `<b>${U.v(P.ws)}</b> from ${compass(P.wd)}` : '<b>Calm</b>';
  box.setAttribute('aria-label', P.ws ? `Wind ${U.v(P.ws)} from the ${compass(P.wd, true)}` : 'No wind');
}

// ---------- Terrain tiles: one decoder for the calculation and the shaded map ----------
const tileMem = new Map(); // url -> Promise<Float32Array>, a small LRU
const decodeCanvas = document.createElement('canvas'); decodeCanvas.width = decodeCanvas.height = TS;
const decodeCtx = decodeCanvas.getContext('2d', { willReadFrequently: true });
function loadTerrTile(url) {
  if (tileMem.has(url)) { const p = tileMem.get(url); tileMem.delete(url); tileMem.set(url, p); return p; }
  const p = (async () => {
    const r = await fetch(url, { mode: 'cors' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const bmp = await createImageBitmap(await r.blob());
    decodeCtx.drawImage(bmp, 0, 0);
    const d = decodeCtx.getImageData(0, 0, TS, TS).data, out = new Float32Array(TS * TS);
    for (let i = 0, k = 0; i < out.length; i++, k += 4) out[i] = G.decodeTerrarium(d[k], d[k + 1], d[k + 2]);
    return out;
  })();
  p.catch(() => tileMem.delete(url));
  tileMem.set(url, p);
  if (tileMem.size > 200) tileMem.delete(tileMem.keys().next().value);
  return p;
}

async function loadMosaic(lat, lon, z, onProgress) {
  const [px, py] = G.lonLatToPx(lon, lat, z);
  const tx = Math.floor(px / TS), ty = Math.floor(py / TS), W = (2 * RT + 1) * TS;
  const data = new Float32Array(W * W).fill(NaN);
  let done = 0, failed = 0; const jobs = [];
  for (let j = -RT; j <= RT; j++) for (let i = -RT; i <= RT; i++) {
    jobs.push(loadTerrTile(terrUrl(z, tx + i, ty + j)).then(t => {
      const ox = (i + RT) * TS, oy = (j + RT) * TS;
      for (let y = 0; y < TS; y++) data.set(t.subarray(y * TS, y * TS + TS), (oy + y) * W + ox);
    }).catch(() => { failed++; }).finally(() => onProgress(++done, jobs.length)));
  }
  await Promise.all(jobs);
  let minT = Infinity; for (const v of data) if (v < minT) minT = v;
  return { z, x0: (tx - RT) * TS, y0: (ty - RT) * TS, W, data, failed, total: jobs.length, minT, mpp: G.mppAt(lat, z) };
}

function sample(x, y) { // bilinear on the loaded block; x, y in its pixels, pixel centres at .5
  x -= 0.5; y -= 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  if (x0 < 0 || y0 < 0 || x0 >= M.W - 1 || y0 >= M.W - 1) return NaN;
  const fx = x - x0, fy = y - y0, i = y0 * M.W + x0, d = M.data;
  return (d[i] * (1 - fx) + d[i + 1] * fx) * (1 - fy) + (d[i + M.W] * (1 - fx) + d[i + M.W + 1] * fx) * fy;
}

function slopeGrid() {
  const W = M.W, d = M.data, s = new Float32Array(W * W).fill(90), mpp = M.mpp;
  for (let y = 1; y < W - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    s[i] = Math.atan(Math.hypot((d[i + 1] - d[i - 1]) / (2 * mpp), (d[i + W] - d[i - W]) / (2 * mpp))) * 180 / Math.PI;
  }
  return s;
}

// The route search and the map overlay use a half-resolution grid; each cell takes the highest ground under it,
// so a route never cuts a corner, and the steepest slope under it.
function poolGrid() {
  const GW = M.W / 2, t = new Float32Array(GW * GW), sl = new Float32Array(GW * GW), d = M.data, W = M.W;
  for (let y = 0; y < GW; y++) for (let x = 0; x < GW; x++) {
    const i = 2 * y * W + 2 * x;
    t[y * GW + x] = Math.max(d[i], d[i + 1], d[i + W], d[i + W + 1]); // NaN anywhere stays NaN: no data is a wall
    sl[y * GW + x] = SL[i + W + 1];
  }
  return { GW, terr: t, slope: sl };
}

// ---------- Shaded terrain base map, drawn from the same tiles, so it works offline ----------
const Hillshade = L.GridLayer.extend({
  createTile(c, done) {
    const tile = document.createElement('canvas'); tile.width = tile.height = TS;
    loadTerrTile(terrUrl(c.z, c.x, c.y)).then(e => {
      const lat = G.pxToLonLat(0, (c.y + 0.5) * TS, c.z)[1], mpp = G.mppAt(lat, c.z);
      const ctx = tile.getContext('2d'), img = ctx.createImageData(TS, TS), p = img.data;
      // light from the north-west, 45° up (ESRI convention: rows run south, azimuth turned to a maths angle)
      const zen = 45 * Math.PI / 180, azMath = (360 - 315 + 90) * Math.PI / 180, zf = 1.6;
      const at = (x, y) => e[Math.min(TS - 1, Math.max(0, y)) * TS + Math.min(TS - 1, Math.max(0, x))];
      for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
        const dzdx = (at(x + 1, y) - at(x - 1, y)) / (2 * mpp) * zf, dzdy = (at(x, y + 1) - at(x, y - 1)) / (2 * mpp) * zf;
        const slope = Math.atan(Math.hypot(dzdx, dzdy)), aspect = Math.atan2(dzdy, -dzdx);
        const s = Math.max(0, Math.cos(zen) * Math.cos(slope) + Math.sin(zen) * Math.sin(slope) * Math.cos(azMath - aspect));
        const k = (y * TS + x) * 4, f = 0.5 + 0.5 * s;
        p[k] = 238 * f; p[k + 1] = 234 * f; p[k + 2] = 222 * f; p[k + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      done(null, tile);
    }).catch(err => done(err, tile));
    return tile;
  }
});

// The reach is drawn straight into a canvas that Leaflet positions like an image, so a slider move repaints
// pixels without encoding and decoding a PNG.
const CanvasOverlay = L.ImageOverlay.extend({
  _initImage() {
    const c = this._image = this._url;
    L.DomUtil.addClass(c, 'leaflet-image-layer');
    if (this._zoomAnimated) L.DomUtil.addClass(c, 'leaflet-zoom-animated');
    c.onselectstart = L.Util.falseFn; c.onmousemove = L.Util.falseFn;
  },
  _updateOpacity() {}
});

// ---------- Map ----------
let M = null, SL = null, GRID = null, gridId = 0, launch = null, lpx = 0, lpy = 0, groundAtLaunch = NaN, R = null, loading = false;
let Gres = null, route = null, fitNext = false, GEO = null;
const start = LS.get('launch', null) || M_HILL;
const map = L.map('map', { zoomControl: true }).setView([start.lat, start.lon], 13);
const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' });
const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: '© OpenStreetMap contributors, SRTM | © OpenTopoMap (CC-BY-SA)' });
const shade = new Hillshade({ minNativeZoom: Z_MIN, maxNativeZoom: Z_MAX, minZoom: 8, maxZoom: 18, attribution: 'Terrain: AWS Terrain Tiles' });
let base = navigator.onLine ? osm : shade;
base.addTo(map);
map.on('baselayerchange', e => { base = e.layer; });
L.control.layers({ 'Street map (online)': osm, 'Topo map (online)': topo, 'Shaded terrain (works offline)': shade }, null, { position: 'topright' }).addTo(map);
L.control.scale({ imperial: true }).addTo(map);
const Wind = L.Control.extend({ options: { position: 'topright' }, onAdd() {
  const box = L.DomUtil.create('div', 'wind-box');
  box.id = 'windMap'; box.setAttribute('role', 'img');
  box.innerHTML = '<svg class="wind-arrow" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">' +
    '<path d="M12 21V5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>' +
    '<path d="M12 2.5 6.5 9.5h11z" fill="currentColor"/></svg><span class="wind-text"></span>';
  L.DomEvent.disableClickPropagation(box);
  return box;
} });
new Wind().addTo(map); windBadge();
const Legend = L.Control.extend({ options: { position: 'bottomleft' }, onAdd() {
  // a <details> so it folds away on a small screen, where it would cover the result
  const box = L.DomUtil.create('details', 'legend-box');
  box.open = map.getSize().x >= 560 && map.getSize().y >= 420;
  box.innerHTML = '<summary>Key</summary>';
  const ul = L.DomUtil.create('ul', 'legend', box);
  ul.innerHTML = '<li><span class="key k-straight"></span>Landable, straight glide</li>' +
    '<li id="keyCurve"><span class="key k-curve"></span>Landable by curving round a hill</li>' +
    '<li><span class="key k-steep"></span>Reachable, too steep to land</li>' +
    '<li><span class="key k-out"></span>Reachable, but out of sight</li>' +
    '<li><span class="key k-ring"></span>As far as you can see it</li>' +
    '<li><span class="key k-hit"></span>Straight glide hits a slope</li>' +
    '<li><span class="key k-line"></span>Cross-section (dots: its distance marks)</li>';
  L.DomEvent.disableClickPropagation(box);
  return box;
} });
new Legend().addTo(map);
const Locate = L.Control.extend({ options: { position: 'topleft' }, onAdd() {
  const div = L.DomUtil.create('div', 'leaflet-bar');
  const a = L.DomUtil.create('a', 'locate', div);
  a.href = '#'; a.title = 'Launch from my location'; a.setAttribute('role', 'button'); a.setAttribute('aria-label', 'Launch from my location');
  a.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>';
  L.DomEvent.disableClickPropagation(div);
  L.DomEvent.on(a, 'click', e => { L.DomEvent.preventDefault(e); locate(); });
  return div;
} });
new Locate().addTo(map);

const overlayCanvas = document.createElement('canvas');
let overlay = null;
const outline = L.polyline([], { color: C.line, weight: 1, opacity: .45, interactive: false }).addTo(map);
const hitLines = L.polyline([], { color: C.hit, weight: 4, opacity: .95, interactive: false }).addTo(map);
const ring = L.circle([0, 0], { radius: 1, color: C.ring, weight: 2, dashArray: '8 6', fill: false, interactive: false });
// the cross-section on the map: white casing, solid while the glider flies, dashed past where it meets the ground;
// dots at the cross-section's distance marks, and a probe where the cursor is on either graphic
const profCase = L.polyline([], { color: '#ffffff', weight: 6, opacity: .85, interactive: false }).addTo(map);
const profPast = L.polyline([], { color: C.line, weight: 2, dashArray: '6 6', opacity: .85, interactive: false }).addTo(map);
const profLine = L.polyline([], { color: C.line, weight: 3, opacity: .95, interactive: false }).addTo(map);
const profTicks = L.layerGroup().addTo(map);
const probe = L.circleMarker([0, 0], { radius: 8, color: '#ffffff', weight: 3, fillColor: C.line, fillOpacity: 1, interactive: false });
const routeCase = L.polyline([], { color: '#ffffff', weight: 7, opacity: .9, interactive: false }).addTo(map);
const routeLine = L.polyline([], { color: C.route, weight: 4, interactive: false }).addTo(map);
const routeEnd = L.circleMarker([0, 0], { radius: 7, color: '#ffffff', weight: 2, fillColor: C.route, fillOpacity: 1, interactive: false });
const areaBoxes = L.layerGroup().addTo(map);
const marker = L.marker([start.lat, start.lon], { draggable: true, title: 'Launch', alt: 'Launch' }).addTo(map);
marker.on('dragend', () => setLaunch(marker.getLatLng().lat, marker.getLatLng().lng));
let suppressTap = 0;
map.on('click', e => { if (Date.now() - suppressTap < 700) return; setLaunch(e.latlng.lat, e.latlng.lng); });
let lastRouteAt = 0;
const routeAt = ll => { if (Date.now() - lastRouteAt < 800) return; lastRouteAt = Date.now(); showRoute(ll); };
map.on('contextmenu', e => routeAt(e.latlng));
(() => { // long-press on a touch screen: hold still for half a second (same on iOS and Android)
  const el = map.getContainer(); let t = null, x0 = 0, y0 = 0;
  const cancel = () => { clearTimeout(t); t = null; };
  el.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return cancel();
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
    t = setTimeout(() => { t = null; const r = el.getBoundingClientRect(); suppressTap = Date.now(); routeAt(map.containerPointToLatLng([x0 - r.left, y0 - r.top])); }, 550);
  }, { passive: true });
  el.addEventListener('touchmove', e => { if (t && Math.hypot(e.touches[0].clientX - x0, e.touches[0].clientY - y0) > 10) cancel(); }, { passive: true });
  el.addEventListener('touchend', cancel); el.addEventListener('touchcancel', cancel);
})();

function setNet() {
  const on = navigator.onLine;
  $('net').textContent = 'Offline';
  $('net').hidden = on; // only worth saying when it's true
  $('net').classList.add('off');
  $('btnSave').disabled = !on;
  if (!on && base !== shade) { map.removeLayer(base); shade.addTo(map); base = shade; }
}
addEventListener('online', setNet); addEventListener('offline', setNet);

// A compass dial: drag round it, or use the arrow keys. mode 'from' draws an arrow blowing in from the rim (wind);
// 'to' draws a needle out from the centre (a bearing).
function makeDial(el, { mode, get, set, step }) {
  el.setAttribute('role', 'slider'); el.tabIndex = 0;
  el.setAttribute('aria-valuemin', '0'); el.setAttribute('aria-valuemax', '359');
  el.innerHTML = `<svg viewBox="-50 -50 100 100" aria-hidden="true"><circle class="rim" r="46"/>` +
    [0, 90, 180, 270].map(a => `<line class="tick" x1="0" y1="-46" x2="0" y2="-40" transform="rotate(${a})"/>`).join('') +
    `<text x="0" y="-30">N</text><text x="30" y="0">E</text><text x="0" y="30">S</text><text x="-30" y="0">W</text>` +
    `<g class="arm"><path class="needle"/><path class="head"/></g></svg>`;
  const arm = el.querySelector('.arm');
  if (mode === 'from') { arm.querySelector('.needle').setAttribute('d', 'M0 -44 L0 -8'); arm.querySelector('.head').setAttribute('d', 'M-7 -14 L0 -2 L7 -14 Z'); }
  else { arm.querySelector('.needle').setAttribute('d', 'M0 0 L0 -34'); arm.querySelector('.head').setAttribute('d', 'M-7 -30 L0 -44 L7 -30 Z'); }
  const render = () => {
    const v = get();
    arm.setAttribute('transform', `rotate(${v})`);
    el.setAttribute('aria-valuenow', String(v));
    el.setAttribute('aria-valuetext', `${v}°, ${compass(v, true)}`);
  };
  const put = v => { set(((Math.round(v / step) * step) % 360 + 360) % 360); render(); };
  const fromPointer = e => { const r = el.getBoundingClientRect(); put(Math.atan2(e.clientX - r.left - r.width / 2, -(e.clientY - r.top - r.height / 2)) * 180 / Math.PI); };
  el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); fromPointer(e); });
  el.addEventListener('pointermove', e => { if (el.hasPointerCapture(e.pointerId)) fromPointer(e); });
  el.addEventListener('keydown', e => {
    const big = e.shiftKey ? 45 : step, v = get();
    const d = { ArrowRight: big, ArrowUp: big, ArrowLeft: -big, ArrowDown: -big, PageUp: 45, PageDown: -45 }[e.key];
    if (d !== undefined) { put(v + d); e.preventDefault(); }
    else if (e.key === 'Home') { put(0); e.preventDefault(); }
  });
  render();
  return { render };
}
makeDial($('wdDial'), { mode: 'from', step: 5, get: () => P.wd, set: v => { P.wd = v; save(); afterParams(); schedule('all'); } });
const pbDial = makeDial($('pbDial'), { mode: 'to', step: 1, get: () => P.pb, set: v => { P.pb = v; save(); clearRoute(false); schedule('profile'); } });

let pending = null;
function schedule(what) {
  if (pending === 'all') return;
  pending = what;
  requestAnimationFrame(() => { const w = pending; pending = null; if (w === 'all') compute(); else drawProfile(); });
}

// ---------- Route search in a worker ----------
let worker = null, runId = 0, busy = false, queued = null, inflightKey = null;
try {
  worker = new Worker('glide-worker.js');
  worker.onmessage = e => {
    busy = false;
    if (e.data.gridId === gridId) { Gres = { ...e.data, key: inflightKey }; onGrid(); }
    if (queued) { const q = queued; queued = null; send(q); }
  };
  worker.onerror = () => { worker = null; busy = false; runGrid(); }; // e.g. opened from a file: run on the page instead
} catch (e) { worker = null; }
function send(run) {
  if (!worker) {
    const t0 = performance.now(), r = G.reachGrid(run, GRID.terr, GRID.GW, GRID.GW);
    Gres = { ...r, gridId, key: run.key, ms: performance.now() - t0 }; onGrid(); return;
  }
  if (busy) { queued = run; return; } // only the newest request waits; older ones are dropped
  busy = true; inflightKey = run.key;
  worker.postMessage({ run, id: ++runId, gridId });
}
function postGrid() { if (worker) worker.postMessage({ grid: { id: gridId, terr: GRID.terr.slice(), W: GRID.GW } }); }
function runKey() { return [lpx, lpy, P.agl, P.mg, P.va, P.gr, P.ws, P.wd, P.vis, gridId].join(); }
function runGrid() {
  if (!P.curve || !GRID) { Gres = null; drawOverlay(); return; }
  const key = runKey();
  if (Gres && Gres.key === key && Gres.gridId === gridId) return;
  send({ key, cell: 2 * M.mpp, si: Math.floor((lpx - M.x0) / 2), sj: Math.floor((lpy - M.y0) / 2), h0: groundAtLaunch + P.agl,
         margin: P.mg, Va: P.va, GR: P.gr, windSpeed: P.ws, windFromDeg: P.wd, maxR: P.vis });
}
function onGrid() {
  drawOverlay();
  if (route) refreshRoute();
  checkZoom();
}

// ---------- Launch, terrain and the calculation ----------
async function useMosaic(lat, lon, z) {
  loading = true; setStatus('Loading terrain…');
  try { M = await loadMosaic(lat, lon, z, (d, n) => setStatus(`Loading terrain ${d} of ${n}…`)); }
  finally { loading = false; }
  SL = slopeGrid(); GRID = poolGrid(); gridId++; Gres = null; GEO = null; postGrid();
}

async function setLaunch(lat, lon, snapRadius = 0) {
  if (loading) return;
  const z = M ? M.z : Z_MAX;
  const far = () => {
    if (!M) return true;
    const [x, y] = G.lonLatToPx(lon, lat, M.z);
    return Math.abs(x - (M.x0 + M.W / 2)) > TS * 1.2 || Math.abs(y - (M.y0 + M.W / 2)) > TS * 1.2;
  };
  if (far()) await useMosaic(lat, lon, z);
  if (snapRadius > 0) { // move to the highest point within snapRadius metres
    const [x, y] = G.lonLatToPx(lon, lat, M.z), r = snapRadius / M.mpp;
    let best = -1e9, bx = x, by = y;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const e = sample(x + dx - M.x0, y + dy - M.y0);
      if (e > best) { best = e; bx = x + dx; by = y + dy; }
    }
    [lon, lat] = G.pxToLonLat(bx, by, M.z);
  }
  placeLaunch(lat, lon);
  afterParams();
  compute();
}

function placeLaunch(lat, lon) {
  launch = L.latLng(lat, lon);
  [lpx, lpy] = G.lonLatToPx(lon, lat, M.z);
  groundAtLaunch = sample(lpx - M.x0, lpy - M.y0);
  marker.setLatLng(launch);
  ring.setLatLng(launch);
  LS.set('launch', { lat, lon });
  GEO = null;
  clearRoute(false);
  placeStatus();
}
function placeStatus() {
  if (groundAtLaunch !== groundAtLaunch) {
    setStatus(`<span class="warn">No terrain here. ${navigator.onLine ? 'It failed to download; try again.' : 'This spot is outside your saved areas.'}</span>`);
  } else if (M.failed) {
    setStatus(`<span class="warn">${M.failed} of ${M.total} terrain tiles are missing${navigator.onLine ? '' : ' (outside the saved area)'}, so the reach stops short there.</span>`);
  } else {
    setStatus(`Ground at the launch: ${U.h(groundAtLaunch)} above sea level.`);
  }
}

// A high launch over low ground can glide past the loaded block: pick the zoom whose block holds the whole glide.
let zoomTimer = null;
function checkZoom() {
  clearTimeout(zoomTimer);
  zoomTimer = setTimeout(async () => {
    if (!M || loading || groundAtLaunch !== groundAtLaunch) return;
    const lat = launch.lat;
    const range = Math.max(0, groundAtLaunch + P.agl - P.mg - M.minT) * P.gr * (P.va + P.ws) / P.va;
    let want = G.chooseZoom(range, lat, RT, Z_MAX, Z_MIN);
    const edge = (R && R.kind.some(k => k === 1)) || (Gres && Gres.edge);
    if (edge && want >= M.z && M.z > Z_MIN) want = M.z - 1; // lower ground just outside the block
    if (want === M.z) return;
    await useMosaic(lat, launch.lng, want);
    placeLaunch(lat, launch.lng);
    compute();
  }, 350);
}

const elevAtENU = (e, n) => sample(lpx + e / M.mpp - M.x0, lpy - n / M.mpp - M.y0);
const pxLatLng = (x, y) => { const [lo, la] = G.pxToLonLat(x, y, M.z); return L.latLng(la, lo); };
const enuToLatLng = (e, n) => pxLatLng(lpx + e / M.mpp, lpy - n / M.mpp);
const cellLatLng = i => { const GW = GRID.GW; return pxLatLng(M.x0 + 2 * (i % GW) + 1, M.y0 + 2 * Math.floor(i / GW) + 1); };
const glideOpts = () => ({ n: 720, h0: groundAtLaunch + P.agl, margin: P.mg, Va: P.va, GR: P.gr, windSpeed: P.ws, windFromDeg: P.wd,
                           ds: M.mpp / 2, maxD: M.W * M.mpp });

function compute() {
  if (!M || !launch) return;
  if (groundAtLaunch !== groundAtLaunch) { clearResult(); return; }
  const t0 = performance.now();
  R = G.castRays(glideOpts(), elevAtENU);
  R.h0 = groundAtLaunch + P.agl; R.ms = performance.now() - t0;
  ring.setRadius(P.vis); if (!map.hasLayer(ring)) ring.addTo(map);
  drawOverlay();
  drawProfile();
  runGrid();
  checkZoom();
}

function clearResult() {
  R = null; Gres = null;
  outline.setLatLngs([]); hitLines.setLatLngs([]); clearTrace(); ring.remove(); clearRoute(false);
  if (overlay) { map.removeLayer(overlay); overlay = null; }
  $('stats').innerHTML = '';
  const c = $('profile'); c.getContext('2d').clearRect(0, 0, c.width, c.height);
  $('profWhat').textContent = '';
}

// Each grid cell's ray and distance from the launch only change when the launch or the terrain block does,
// so they're worked out once here instead of on every slider move.
function geometry() {
  if (GEO && GEO.gridId === gridId && GEO.lpx === lpx && GEO.lpy === lpy) return GEO;
  const GW = GRID.GW, N = GW * GW, ray = new Uint16Array(N), dist = new Float32Array(N), mpp = M.mpp, n = 720;
  for (let gy = 0; gy < GW; gy++) for (let gx = 0; gx < GW; gx++) {
    const e = (2 * gx + 1 + M.x0 - lpx) * mpp, nn = -(2 * gy + 1 + M.y0 - lpy) * mpp, i = gy * GW + gx;
    let b = Math.atan2(e, nn); if (b < 0) b += 2 * Math.PI;
    ray[i] = Math.floor(b / (2 * Math.PI) * n) % n; dist[i] = Math.hypot(e, nn);
  }
  return (GEO = { gridId, lpx, lpy, ray, dist });
}

let lastOverlayMs = 0;
function drawOverlay() {
  if (!R) return;
  const t0 = performance.now();
  const GW = GRID.GW, mpp = M.mpp, cellA = (2 * mpp) ** 2 / 1e6, geo = geometry(), n = R.n, dmax = R.dmax, vis = P.vis, slMax = P.sl;
  const useG = Gres && Gres.gridId === gridId && P.curve, galt = useG ? Gres.alt : null, slope = GRID.slope;
  if (overlayCanvas.width !== GW) { overlayCanvas.width = overlayCanvas.height = GW; }
  const ctx = overlayCanvas.getContext('2d'), img = ctx.createImageData(GW, GW), px = img.data;
  let landA = 0, curveLandA = 0, outA = 0;
  for (let gy = 0; gy < GW; gy++) for (let gx = 0; gx < GW; gx++) {
    const i = gy * GW + gx, r0 = geo.ray[i], d = geo.dist[i];
    const straight = d <= Math.min(dmax[r0], dmax[r0 + 1 === n ? 0 : r0 + 1]);
    const curved = !straight && galt !== null && galt[i] > -Infinity;
    if (!straight && !curved) continue;
    const k = i * 4, landable = slope[i] <= slMax, stripe = ((gx + gy) & 3) < 2;
    let c, a;
    if (d > vis) { // reachable, but out of sight: a faint wash; the dashed ring marks where sight ends
      outA += cellA;
      c = C.out; a = 42;
    } else if (!landable) { c = C.steep; a = curved && stripe ? 60 : 85; }
    else if (straight) { c = C.straight; a = 120; landA += cellA; }
    else { c = stripe ? C.curveDark : C.curve; a = stripe ? 190 : 120; landA += cellA; curveLandA += cellA; }
    px[k] = c[0]; px[k + 1] = c[1]; px[k + 2] = c[2]; px[k + 3] = a;
  }
  ctx.putImageData(img, 0, 0);
  const bounds = L.latLngBounds(pxLatLng(M.x0, M.y0 + M.W), pxLatLng(M.x0 + M.W, M.y0));
  if (!overlay) overlay = new CanvasOverlay(overlayCanvas, bounds, { interactive: false }).addTo(map);
  else if (!overlay.getBounds().equals(bounds)) overlay.setBounds(bounds);

  // the straight glide's outline, and the stretches inside the sight ring where it runs into steep ground
  const pts = [], hits = [], steep = new Uint8Array(n);
  let steepHits = 0, maxD = 0, maxB = 0;
  for (let i = 0; i < n; i++) {
    const b = (i / n) * 2 * Math.PI, d = dmax[i];
    pts.push(enuToLatLng(Math.sin(b) * d, Math.cos(b) * d));
    if (R.kind[i] === 0 && d <= vis) {
      const de = d + mpp, x = Math.floor(lpx + Math.sin(b) * de / mpp - M.x0), y = Math.floor(lpy - Math.cos(b) * de / mpp - M.y0);
      if (SL[y * M.W + x] > slMax) { steep[i] = 1; steepHits++; }
    }
    if (d > maxD) { maxD = d; maxB = b; }
  }
  pts.push(pts[0]);
  for (let i = 0; i < n; i++) if (steep[i] && steep[(i + 1) % n]) hits.push([pts[i], pts[i + 1]]);
  outline.setLatLngs(pts); hitLines.setLatLngs(hits);
  if (fitNext) { // fit the sight ring (or the reach, if smaller), clear of the key in the bottom-left corner
    fitNext = false;
    const key = document.querySelector('.legend-box'), kh = key ? key.offsetHeight + 16 : 0;
    const b = maxD < vis ? outline.getBounds() : launch.toBounds(2 * vis);
    map.fitBounds(b, { paddingTopLeft: [24, 24], paddingBottomRight: [24, 24 + kh], maxZoom: 16 });
  }
  lastOverlayMs = performance.now() - t0;

  const rows = [
    ['Glider starts at', `${U.h(R.h0)} above sea level`],
    ['Farthest straight glide', `${U.d(maxD)} toward ${compass(maxB * 180 / Math.PI)}`],
    ['Landable ground in sight', U.a(landA)],
  ];
  if (P.curve) rows.push(['Gained by curving round hills', useG ? `+${U.a(curveLandA)}` : 'working…']);
  if (outA > 0) rows.push(['Reachable but out of sight', U.a(outA)]);
  rows.push(['Directions where a slope stops the glide in sight', `${Math.round(100 * steepHits / n)}%`]);
  rows.push(['Terrain detail', `${U.h(mpp)} per point${M.z < Z_MAX ? ' (coarser, for a long glide)' : ''}`]);
  $('stats').innerHTML = rows.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
}

// ---------- Routes round terrain ----------
function showRoute(ll) {
  if (!Gres || Gres.gridId !== gridId || !P.curve) { setStatus('Turn on curving round hills to see routes.'); return; }
  route = { target: ll };
  refreshRoute();
}
function refreshRoute() {
  const GW = GRID.GW, [x, y] = G.lonLatToPx(route.target.lng, route.target.lat, M.z);
  const gx = Math.floor((x - M.x0) / 2), gy = Math.floor((y - M.y0) / 2);
  const cells = gx >= 0 && gy >= 0 && gx < GW && gy < GW ? G.routeTo(Gres.parent, Gres.alt, gy * GW + gx) : [];
  route.cells = cells;
  if (!cells.length) {
    const far = launch.distanceTo(route.target) > P.vis;
    clearRoute(true);
    setStatus(`<span class="warn">${far ? `That spot is more than ${U.d(P.vis)} away, out of sight.` : 'The glider can\'t reach that spot from this launch.'}</span>`);
    return;
  }
  const pts = cells.map(cellLatLng);
  routeCase.setLatLngs(pts); routeLine.setLatLngs(pts);
  routeEnd.setLatLng(pts[pts.length - 1]).addTo(map);
  $('profBack').hidden = false;
  drawProfile();
}
function clearRoute(redraw) {
  route = null; routeCase.setLatLngs([]); routeLine.setLatLngs([]); routeEnd.remove();
  $('profBack').hidden = true;
  if (redraw) drawProfile();
}
$('profBack').onclick = () => clearRoute(true);

// ---------- Cross-section ----------
let PROF = null; // what's drawn, for the touch / hover read-out
function profileData() {
  if (route && route.cells && route.cells.length > 1) {
    const GW = GRID.GW, cell = 2 * M.mpp, d = [0], ground = [], glide = [];
    route.cells.forEach((c, k) => {
      if (k) { const p = route.cells[k - 1], dx = c % GW - p % GW, dy = Math.floor(c / GW) - Math.floor(p / GW); d.push(d[k - 1] + Math.hypot(dx, dy) * cell); }
      ground.push(GRID.terr[c]); glide.push(Gres.alt[c]);
    });
    const last = route.cells[route.cells.length - 1], arrive = Gres.alt[last] - GRID.terr[last];
    return { d, ground, glide, end: d.length - 1, hit: false, curve: true, lls: route.cells.map(cellLatLng),
             what: `Best route to the spot you picked: ${U.d(d[d.length - 1])} flown, arriving ${U.h(arrive)} above the ground.` };
  }
  const b = P.pb * Math.PI / 180;
  const first = G.glideAlong(glideOpts(), elevAtENU, b, 0), dEnd0 = first.d[first.end] || 0;
  const span = Math.max(dEnd0 * 1.4, Math.min(P.vis * 1.1, M.W * M.mpp / 2), 800);
  const p = G.glideAlong(glideOpts(), elevAtENU, b, Math.max(0, span - dEnd0)); // the same glide, with the ground on past its end
  const dEnd = p.d[p.end] || 0;
  const d = [], ground = [], glide = [];
  for (let k = 0; k < p.d.length && p.d[k] <= span; k++) { d.push(p.d[k]); ground.push(p.ground[k]); glide.push(p.glide[k]); }
  const lls = d.map(s => enuToLatLng(Math.sin(b) * s, Math.cos(b) * s));
  const what = p.kind === 2 ? `Straight toward ${P.pb}°: the wind is too strong to fly this way.`
    : `Straight toward ${P.pb}° (${compass(P.pb, true)}): ${p.kind === 0 ? 'meets the ground' : 'leaves the loaded terrain'} after ${U.d(dEnd)}` +
      (dEnd > P.vis ? `, but it's out of sight after ${U.d(P.vis)}.` : '.');
  return { d, ground, glide, end: Math.min(p.end, d.length - 1), hit: p.kind === 0, curve: false, lls, what };
}

function drawProfile() {
  const cv = $('profile');
  if (!R || !M) return;
  const dpr = window.devicePixelRatio || 1, Wc = cv.clientWidth, Hc = cv.clientHeight;
  if (!Wc || !Hc) return;
  if (cv.width !== Math.round(Wc * dpr) || cv.height !== Math.round(Hc * dpr)) { cv.width = Math.round(Wc * dpr); cv.height = Math.round(Hc * dpr); }
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, Wc, Hc);
  const p = profileData();
  $('profWhat').textContent = p.what;
  const series = p.curve ? COL.curve : COL.straight;
  $('profKeyLine').style.borderTopColor = series; $('profKeyMargin').style.borderTopColor = series;
  if (p.d.length < 2) { PROF = null; clearTrace(); return; }
  const dMax = p.d[p.d.length - 1];
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < p.d.length; k++) { lo = Math.min(lo, p.ground[k]); hi = Math.max(hi, p.ground[k], p.glide[k] || -Infinity); }
  hi = Math.max(hi, R.h0);
  const pad = (hi - lo) * 0.1 + 5; lo -= pad; hi += pad;
  const L0 = 52, B0 = 22, T0 = 8, R0 = 14, isMetric = units === 'metric', hk = isMetric ? 1 : G.FT;
  const X = d => L0 + (d / dMax) * (Wc - L0 - R0), Y = h => T0 + (1 - (h - lo) / (hi - lo)) * (Hc - T0 - B0);
  PROF = { ...p, X, Y, L0, R0, Wc, Hc, B0, T0, dMax };

  // recessive grid: a few height lines (in the chosen unit) and distance ticks
  c.font = '12px system-ui, sans-serif'; c.fillStyle = COL.muted; c.strokeStyle = COL.line; c.lineWidth = 1;
  const hStep = niceStep((hi - lo) * hk / 3) / hk;
  c.textAlign = 'right'; c.textBaseline = 'middle';
  for (let h = Math.ceil(lo / hStep) * hStep; h <= hi; h += hStep) {
    c.beginPath(); c.moveTo(L0, Math.round(Y(h)) + .5); c.lineTo(Wc - R0, Math.round(Y(h)) + .5); c.stroke();
    c.fillText(U.h(h), L0 - 6, Y(h));
  }
  const dUnit = isMetric ? (dMax > 2500 ? 1000 : 1) : (dMax > 0.5 * G.MI ? G.MI : 1 / G.FT);
  const dStep = niceStep(dMax / dUnit / 5) * dUnit;
  c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  const dLabel = d => isMetric ? (dUnit === 1000 ? `${+(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`) : (dUnit === G.MI ? `${+(d / G.MI).toFixed(1)} mi` : `${Math.round(d * G.FT)} ft`);
  const ticks = [];
  for (let d = 0; d <= dMax + 1; d += dStep) { c.fillText(dLabel(d), X(d), Hc - 6); ticks.push(d); }

  // out of sight: shade the part of the strip beyond the sight distance
  if (!p.curve && P.vis < dMax) {
    c.fillStyle = COL.line; c.globalAlpha = 0.5; c.fillRect(X(P.vis), T0, Wc - R0 - X(P.vis), Hc - T0 - B0); c.globalAlpha = 1;
    c.fillStyle = COL.ink2; c.textAlign = 'left'; c.fillText('Out of sight', X(P.vis) + 6, T0 + 14);
  }
  // ground
  c.beginPath(); c.moveTo(X(0), Hc - B0);
  for (let k = 0; k < p.d.length; k++) c.lineTo(X(p.d[k]), Y(p.ground[k]));
  c.lineTo(X(dMax), Hc - B0); c.closePath();
  c.fillStyle = COL.terrain; c.fill(); c.strokeStyle = COL.terrainEdge; c.lineWidth = 1.5; c.stroke();
  // glider − margin (dashed, faint), then the glider (solid)
  const line = (off, color, width, dash) => {
    c.beginPath(); let on = false;
    for (let k = 0; k <= p.end; k++) { const v = p.glide[k]; if (!(v === v)) { on = false; continue; } const yy = Y(v - off); if (on) c.lineTo(X(p.d[k]), yy); else { c.moveTo(X(p.d[k]), yy); on = true; } }
    c.setLineDash(dash); c.strokeStyle = color; c.lineWidth = width; c.lineJoin = 'round'; c.stroke(); c.setLineDash([]);
  };
  c.globalAlpha = 0.6; line(P.mg, series, 2, [5, 4]); c.globalAlpha = 1;
  line(0, series, 2.5, []);
  const ek = p.end, ev = p.glide[ek];
  if (ev === ev) {
    c.beginPath(); c.arc(X(p.d[ek]), Y(ev), 5, 0, 2 * Math.PI);
    c.fillStyle = p.hit ? COL.hit : series; c.fill();
    c.lineWidth = 2; c.strokeStyle = COL.surface2; c.stroke();
  }
  PROF.img = c.getImageData(0, 0, cv.width, cv.height); // the cursor is drawn over this, without redoing the glide
  drawTrace(p, ticks);
  if (cursorK !== null) showCursor(Math.min(cursorK, p.d.length - 1), cursorFrom);
}
function niceStep(raw) { const m = 10 ** Math.floor(Math.log10(raw)), f = raw / m; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * m; }

// ---------- The cross-section on the map, and one cursor for both ----------
function clearTrace() {
  profCase.setLatLngs([]); profLine.setLatLngs([]); profPast.setLatLngs([]); profTicks.clearLayers(); hideCursor();
}
// the point on the trace at distance s, between the profile's points
function llAt(p, s) {
  let k = 0; while (k < p.d.length - 2 && p.d[k + 1] < s) k++;
  const a = p.lls[k], b = p.lls[k + 1] || a, f = p.d[k + 1] > p.d[k] ? Math.min(1, Math.max(0, (s - p.d[k]) / (p.d[k + 1] - p.d[k]))) : 0;
  return L.latLng(a.lat + (b.lat - a.lat) * f, a.lng + (b.lng - a.lng) * f);
}
function drawTrace(p, ticks) {
  profTicks.clearLayers();
  if (p.curve) { profCase.setLatLngs([]); profLine.setLatLngs([]); profPast.setLatLngs([]); } // the route line is the trace
  else {
    const flown = p.lls.slice(0, p.end + 1);
    profCase.setLatLngs(p.lls); profLine.setLatLngs(flown); profPast.setLatLngs(p.lls.slice(p.end));
  }
  for (const s of ticks) if (s > 0) {
    L.circleMarker(llAt(p, s), { radius: 3.5, color: C.line, weight: 1.5, fillColor: '#ffffff', fillOpacity: 1, interactive: false }).addTo(profTicks);
  }
}
let cursorK = null, cursorFrom = null; // where the cursor is (a profile point) and which graphic put it there
function showCursor(k, from) {
  if (!PROF || !PROF.img) return;
  cursorK = k; cursorFrom = from;
  const cv = $('profile'), c = cv.getContext('2d'), X = PROF.X(PROF.d[k]);
  c.putImageData(PROF.img, 0, 0);
  c.strokeStyle = COL.ink2; c.lineWidth = 1; c.beginPath(); c.moveTo(X + .5, PROF.T0); c.lineTo(X + .5, PROF.Hc - PROF.B0); c.stroke();
  const g = PROF.ground[k], v = PROF.glide[k], tip = $('profTip');
  tip.innerHTML = `<b>${U.d(PROF.d[k])}</b> out<br>Ground ${U.h(g)}` + (v === v && k <= PROF.end ? `<br>Glider ${U.h(v)}, ${U.h(v - g)} above it` : '');
  tip.hidden = false;
  tip.style.left = Math.min(Math.max(4, X + 12), cv.clientWidth - tip.offsetWidth - 4) + 'px';
  tip.style.top = '10px';
  probe.setLatLng(PROF.lls[k]); if (!map.hasLayer(probe)) probe.addTo(map);
  // scrubbing the cross-section past the edge of the map pans it just enough to keep the probe in view
  if (from === 'profile') map.panInside(PROF.lls[k], { padding: [36, 36], animate: false });
}
function hideCursor() {
  cursorK = null; cursorFrom = null;
  $('profTip').hidden = true; probe.remove();
  if (PROF && PROF.img) $('profile').getContext('2d').putImageData(PROF.img, 0, 0);
}
// on the cross-section: the cursor follows the pointer (or finger), and the probe shows the same spot on the map
function profHover(e) {
  if (!PROF) return;
  const r = $('profile').getBoundingClientRect(), x = e.clientX - r.left;
  if (x < PROF.L0 || x > PROF.Wc - PROF.R0) { hideCursor(); return; }
  const dq = (x - PROF.L0) / (PROF.Wc - PROF.L0 - PROF.R0) * PROF.dMax;
  let k = 0; while (k < PROF.d.length - 1 && PROF.d[k + 1] < dq) k++;
  if (k < PROF.d.length - 1 && dq - PROF.d[k] > PROF.d[k + 1] - dq) k++;
  showCursor(k, 'profile');
}
$('profile').addEventListener('pointermove', profHover);
$('profile').addEventListener('pointerdown', profHover);
$('profile').addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hideCursor(); });
// on the map: a pointer within a few pixels of the trace moves the cursor on the cross-section too
const NEAR_PX = 18;
map.on('mousemove', e => {
  if (!PROF || !PROF.lls) return;
  let best = -1, bd = NEAR_PX * NEAR_PX;
  for (let k = 0; k < PROF.lls.length; k++) {
    const q = map.latLngToContainerPoint(PROF.lls[k]), dx = q.x - e.containerPoint.x, dy = q.y - e.containerPoint.y;
    if (dx * dx + dy * dy < bd) { bd = dx * dx + dy * dy; best = k; }
  }
  if (best >= 0) showCursor(best, 'map');
  else if (cursorFrom === 'map') hideCursor();
});
map.on('mouseout', () => { if (cursorFrom === 'map') hideCursor(); });

// ---------- Saved areas ----------
const areas = () => LS.get('areas', []);
const areaKeys = a => G.areaTiles(a.lat, a.lon, Z_MAX, SAVE_R, Z_MIN, SAVE_R_LOW).map(([z, x, y]) => terrUrl(z, x, y));
const fmtMB = b => b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : (b / 1e6).toFixed(b < 1e7 ? 1 : 0) + ' MB';
const fmtDate = s => new Date(s + 'T12:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

function areaBounds(a) {
  const [px, py] = G.lonLatToPx(a.lon, a.lat, Z_MAX), tx = Math.floor(px / TS), ty = Math.floor(py / TS);
  const ll = (x, y) => { const [lo, la] = G.pxToLonLat(x, y, Z_MAX); return L.latLng(la, lo); };
  return L.latLngBounds(ll((tx - SAVE_R) * TS, (ty + SAVE_R + 1) * TS), ll((tx + SAVE_R + 1) * TS, (ty - SAVE_R) * TS));
}

async function saveArea() {
  if (!launch || !('caches' in window)) { $('saveStatus').textContent = 'This browser can\'t keep data for offline use.'; return; }
  const a = { id: Date.now().toString(36), lat: launch.lat, lon: launch.lng,
              name: $('areaName').value.trim() || `Near ${launch.lat.toFixed(3)}, ${launch.lng.toFixed(3)}`, date: new Date().toLocaleDateString('en-CA') };
  const keys = areaKeys(a);
  $('btnSave').disabled = true;
  const savedC = await caches.open(SAVED), runtime = await caches.open(RUNTIME);
  let done = 0, bytes = 0, failed = 0, next = 0;
  const pull = async () => {
    while (next < keys.length) {
      const url = keys[next++];
      try {
        let res = await savedC.match(url);
        if (!res) {
          res = await fetch(url, { mode: 'cors' });
          if (!res.ok) throw new Error(res.status);
          await savedC.put(url, res.clone());
          runtime.delete(url); // the service worker may have kept a copy too
        }
        bytes += (await res.blob()).size;
      } catch (e) { failed++; }
      $('saveStatus').textContent = `Saving terrain: ${++done} of ${keys.length} tiles…`;
    }
  };
  await Promise.all(Array.from({ length: 6 }, pull));
  a.bytes = bytes;
  if (failed) { $('saveStatus').innerHTML = `<span class="warn">${failed} tiles didn't download. Check the connection and save again.</span>`; }
  else {
    LS.set('areas', [a, ...areas()]);
    $('areaName').value = '';
    let persisted = false;
    try { persisted = await navigator.storage.persist(); } catch (e) {}
    $('saveStatus').textContent = `Saved "${a.name}" (${fmtMB(bytes)}).` +
      (persisted ? '' : ' The browser may clear it if space runs low; on iPhone, add this page to your Home Screen to keep it.');
  }
  $('btnSave').disabled = !navigator.onLine;
  renderAreas();
}

async function deleteArea(id) {
  const all = areas(), a = all.find(x => x.id === id); if (!a) return;
  const rest = all.filter(x => x.id !== id);
  const gone = G.tilesOnlyIn(areaKeys(a), rest.map(areaKeys));
  const savedC = await caches.open(SAVED);
  await Promise.all(gone.map(u => savedC.delete(u)));
  LS.set('areas', rest);
  $('saveStatus').textContent = `Deleted "${a.name}".`;
  renderAreas();
}

async function renderAreas() {
  const list = areas(), ul = $('areas');
  ul.innerHTML = ''; areaBoxes.clearLayers();
  for (const a of list) {
    const li = document.createElement('li');
    li.innerHTML = `<div class="nm"></div><button class="btn" type="button" data-go>Go</button><button class="btn" type="button" data-del>Delete</button>`;
    li.querySelector('.nm').textContent = a.name;
    const sub = document.createElement('span'); sub.textContent = `${fmtMB(a.bytes || 0)}, saved ${fmtDate(a.date)}`; li.querySelector('.nm').appendChild(sub);
    li.querySelector('[data-go]').setAttribute('aria-label', `Go to ${a.name}`);
    li.querySelector('[data-del]').setAttribute('aria-label', `Delete ${a.name}`);
    li.querySelector('[data-go]').onclick = () => { fitNext = true; map.setView([a.lat, a.lon], 13); setLaunch(a.lat, a.lon); };
    li.querySelector('[data-del]').onclick = () => deleteArea(a.id);
    ul.appendChild(li);
    L.rectangle(areaBounds(a), { color: C.line, weight: 1, dashArray: '2 5', opacity: .6, fill: false, interactive: false }).addTo(areaBoxes);
  }
  if (!list.length) ul.innerHTML = '<li class="hint">No saved areas yet.</li>';
  const savedBytes = list.reduce((s, a) => s + (a.bytes || 0), 0); // the browser's own figure can lag a fresh save
  try {
    const { usage, quota } = await navigator.storage.estimate();
    const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    const used = Math.max(usage, savedBytes);
    $('meterBar').style.width = Math.min(100, 100 * used / quota).toFixed(2) + '%';
    $('storage').textContent = `Using ${fmtMB(used)} of about ${fmtMB(quota)} this browser allows.` + (persisted ? ' Kept until you delete it.' : '');
  } catch (e) { $('storage').textContent = savedBytes ? `Saved areas use ${fmtMB(savedBytes)}.` : ''; }
}

// ---------- Buttons ----------
$('btnSave').onclick = saveArea;
$('btnMHill').onclick = () => { fitNext = true; setLaunch(M_HILL.lat, M_HILL.lon, M_HILL.snap); };
$('btnGeo').onclick = () => locate();
function locate() {
  if (!navigator.geolocation) return setStatus('<span class="warn">This browser can\'t share your location. Tap the map instead.</span>');
  setStatus('Finding your location…');
  navigator.geolocation.getCurrentPosition(
    p => { fitNext = true; map.setView([p.coords.latitude, p.coords.longitude], 13); setLaunch(p.coords.latitude, p.coords.longitude); },
    e => setStatus(`<span class="warn">Couldn't get your location (${e.message}). Tap the map instead.</span>`),
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 });
}
new ResizeObserver(() => schedule('profile')).observe($('profile'));

setSliders();
pbDial.render();
setNet();
renderAreas();
const first = (!navigator.onLine && areas().length && !LS.get('launch', null)) ? areas()[0] : start;
fitNext = true;
setLaunch(first.lat, first.lon, first === M_HILL ? M_HILL.snap : 0);
